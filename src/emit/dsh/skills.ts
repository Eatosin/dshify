import path from 'node:path';
import type {
  Artifact,
  Command,
  Finding,
  HarnessIR,
  Persona,
  Provenance,
  Skill,
} from '../../core/ir.js';
import { HOST_COMMANDS } from '../../core/ir.js';
import { repoRelative } from '../../core/paths.js';
import { compareCodeUnits, finding } from '../../core/report.js';
import { sha256Hex } from '../../core/source.js';

/**
 * DSH skill emission. Contract: docs/spec.md §7 and docs/mapping/opencode.md.
 *
 * Pure: the emitter never touches the filesystem. Resource bytes arrive through
 * the injected `readResource`, so golden tests can assert bytes without writing
 * and `apply` remains the only writer (architecture §3.2).
 */

export interface EmitOptions {
  /** Repo-relative destination tree, POSIX (e.g. `.dsh`). */
  readonly dest: string;
  /** Repository root, used only to make finding paths repo-relative. */
  readonly repoRoot: string;
  /** Read one referenced resource file (absolute path). */
  readonly readResource: (absolute: string) => Promise<Uint8Array>;
  /** Persona id to named delegation tool, when v0.2 delegation is on. */
  readonly delegationTools?: ReadonlyMap<string, string>;
}

export interface EmitResult {
  readonly artifacts: Artifact[];
  readonly losses: Finding[];
}

type Unit =
  | { readonly kind: 'skill'; readonly name: string; readonly source: Skill }
  | { readonly kind: 'command'; readonly name: string; readonly source: Command }
  | { readonly kind: 'persona'; readonly name: string; readonly source: Persona };

const ORDINALS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
] as const;

function ordinal(index: number): string {
  return ORDINALS[index - 1] ?? `${index}th`;
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * YAML scalar with deterministic quoting: a safe plain word stays plain, anything
 * that could be re-parsed differently is emitted as a JSON string (valid YAML).
 */
function yamlScalar(value: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9 .,_()/'-]*$/.test(value) && !value.endsWith(' ')) {
    return value;
  }
  return JSON.stringify(value);
}

/** Frontmatter in the exact key order from spec §7. */
function frontmatter(
  name: string,
  description: string,
  disableModel: boolean,
  whenToUse?: string,
): string {
  const lines = ['---', `name: ${yamlScalar(name)}`, `description: ${yamlScalar(description)}`];
  if (whenToUse !== undefined) lines.push(`whenToUse: ${yamlScalar(whenToUse)}`);
  if (disableModel) lines.push('disable-model-invocation: true');
  lines.push('user-invocable: true', '---', '');
  return lines.join('\n');
}

/** A complete markdown document with exactly one blank line after the frontmatter. */
function document(
  name: string,
  description: string,
  disableModel: boolean,
  body: string,
  whenToUse?: string,
): Uint8Array {
  const clean = body.replace(/^\n+/, '').replace(/\s+$/, '');
  return encode(`${frontmatter(name, description, disableModel, whenToUse)}\n${clean}\n`);
}

function relative(repoRoot: string, absolute: string): string {
  return repoRelative(repoRoot, absolute);
}

/**
 * Assign emitted names. Order is the adapter's: skills, then commands, then
 * personas. Host-command collisions get `-command`, persona collisions get
 * `-persona`, and any remaining collision gets a numeric suffix — all reported
 * (spec §7).
 */
function allocate(ir: HarnessIR, repoRoot: string): { units: Unit[]; losses: Finding[] } {
  const taken = new Set<string>();
  const units: Unit[] = [];
  const losses: Finding[] = [];

  const claim = (base: string): string => {
    let candidate = base;
    let suffix = 2;
    while (taken.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    taken.add(candidate);
    return candidate;
  };

  for (const skill of ir.skills) {
    if (skill.provenance.rootKind === 'native') continue;
    const name = claim(skill.id);
    if (name !== skill.id) {
      losses.push(
        finding('NAME_COLLISION', `skill "${skill.id}" was emitted as "${name}"`, {
          path: relative(repoRoot, skill.provenance.path),
          capability: 'adapted',
        }),
      );
    }
    units.push({ kind: 'skill', name, source: skill });
  }

  for (const command of ir.commands) {
    const reserved = (HOST_COMMANDS as readonly string[]).includes(command.name);
    const base = reserved ? `${command.name}-command` : command.name;
    if (reserved) {
      losses.push(
        finding(
          'HOST_COMMAND_COLLISION',
          `command "${command.name}" collides with a DSH host command; emitted as "${base}"`,
          { path: relative(repoRoot, command.provenance.path), capability: 'adapted' },
        ),
      );
    }
    const name = claim(base);
    if (name !== base) {
      losses.push(
        finding('NAME_COLLISION', `command "${command.name}" was emitted as "${name}"`, {
          path: relative(repoRoot, command.provenance.path),
          capability: 'adapted',
        }),
      );
    }
    units.push({ kind: 'command', name, source: command });
  }

  for (const persona of ir.personas) {
    const base = taken.has(persona.id) ? `${persona.id}-persona` : persona.id;
    const name = claim(base);
    if (name !== persona.id) {
      losses.push(
        finding('NAME_COLLISION', `persona "${persona.id}" was emitted as "${name}"`, {
          path: relative(repoRoot, persona.provenance.path),
          capability: 'adapted',
        }),
      );
    }
    units.push({ kind: 'persona', name, source: persona });
  }

  return { units, losses };
}

function maxPositional(body: string): number {
  let max = 0;
  for (const match of body.matchAll(/\$(\d+)/g)) {
    const value = Number.parseInt(match[1] ?? '0', 10);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max;
}

/** A command becomes a user-invocable skill with the placeholders made prose. */
function commandDocument(
  name: string,
  command: Command,
  emittedPersonas: ReadonlyMap<string, string>,
  repoRoot: string,
  delegationTools: ReadonlyMap<string, string> | undefined,
): { body: string; losses: Finding[] } {
  const losses: Finding[] = [];
  const sourcePath = relative(repoRoot, command.provenance.path);
  const paragraphs: string[] = [`# /${name}`];

  if (command.targetAgent !== undefined) {
    const emitted = emittedPersonas.get(command.targetAgent);
    const tool = delegationTools?.get(command.targetAgent);
    if (tool !== undefined) {
      paragraphs.push(
        `Delegate this task with the \`${tool}\` tool.\nIf that tool is unavailable, load the \`${emitted}\` skill and follow it directly.`,
      );
      losses.push(
        finding(
          'COMMAND_AGENT_ROUTING',
          `routes to the converted "${command.targetAgent}" skill and the "${tool}" delegation tool`,
          { path: sourcePath, capability: 'adapted' },
        ),
      );
    } else if (emitted !== undefined) {
      paragraphs.push(`Start by loading the \`${emitted}\` skill.`);
      losses.push(
        finding('COMMAND_AGENT_ROUTING', `routes to the converted "${command.targetAgent}" skill`, {
          path: sourcePath,
          capability: 'adapted',
        }),
      );
    } else {
      losses.push(
        finding(
          'COMMAND_AGENT_ROUTING',
          `agent "${command.targetAgent}" is not being converted; the routing hint is dropped`,
          { path: sourcePath, capability: 'adapted' },
        ),
      );
    }
  }

  const hasArguments = command.placeholders.includes('arguments');
  const hasPositional = command.placeholders.includes('positional');
  if (hasArguments || hasPositional) {
    paragraphs.push(
      `The text you type after the \`/${name}\` token is this command's argument.\nIf it is empty, ask for it before proceeding.`,
    );
  }
  if (hasArguments) {
    losses.push(
      finding('ARGS_SUBSTITUTION', '$ARGUMENTS is replaced by a prose argument sentence', {
        path: sourcePath,
        capability: 'adapted',
      }),
    );
  }
  if (hasPositional) {
    const count = maxPositional(command.body);
    const lines: string[] = [];
    for (let index = 1; index <= count; index += 1) {
      lines.push(
        `The ${ordinal(index)} whitespace-separated part of the argument is \`$${index}\`.`,
      );
    }
    if (lines.length > 0) paragraphs.push(lines.join('\n'));
    losses.push(
      finding(
        'POSITIONAL_ARGS',
        'positional placeholders are documented as prose and not substituted',
        { path: sourcePath, capability: 'adapted' },
      ),
    );
  }

  let body = command.body.replace(/^\n+/, '');
  if (command.placeholders.includes('shell-injection')) {
    body = body.replace(
      /!`([^`\n]+)`/g,
      (_match, commandText: string) =>
        `\n\n\`\`\`text\nshell (not executed)\n${commandText}\n\`\`\`\n`,
    );
    losses.push(
      finding(
        'SHELL_INJECTION',
        'shell injection is preserved as a non-executed fenced example',
        { path: sourcePath, capability: 'lossy' },
      ),
    );
  }
  body = body.replace(/\$ARGUMENTS/g, 'the argument');
  const trimmed = body.replace(/\s+$/, '');
  if (trimmed !== '') paragraphs.push(trimmed);

  return { body: `${paragraphs.join('\n\n')}\n`, losses };
}

/** A subagent becomes a model-invocable persona skill (decision 7). */
function personaDocument(
  name: string,
  persona: Persona,
  repoRoot: string,
): { body: string; losses: Finding[] } {
  const sourcePath = relative(repoRoot, persona.provenance.path);
  const losses: Finding[] = [
    finding(
      'SUBAGENT_ISOLATION',
      "a persona skill keeps the instructions but not the subagent's tool isolation (use --presets for that)",
      { path: sourcePath, capability: 'adapted' },
    ),
  ];
  if (persona.modelHint !== undefined) {
    losses.push(
      finding(
        'MODEL_OVERRIDE_IGNORED',
        `model hint "${persona.modelHint}" is reported, not applied`,
        { path: sourcePath, capability: 'unsupported' },
      ),
    );
  }

  let body = `You are the \`${name}\` specialist.\n\n${persona.body.replace(/^\n+/, '').replace(/\s+$/, '')}`;
  if (persona.access === 'read-only') {
    body += `\n\nRead-only mode: report the needed edit as a patch. Do not modify files, run formatters or code generators, or make commits or configuration changes.`;
    losses.push(
      finding(
        'EDIT_DENY_ADAPTED',
        'edit-deny is stated in the persona body; --presets would enforce it as tool switches',
        { path: sourcePath, capability: 'adapted' },
      ),
    );
  }
  return { body: `${body}\n`, losses };
}

/** Plan the whole skill surface: copied skills, command skills, persona skills. */
export async function planDshSkills(ir: HarnessIR, options: EmitOptions): Promise<EmitResult> {
  const { units, losses } = allocate(ir, options.repoRoot);
  const emittedPersonas = new Map<string, string>();
  for (const unit of units) {
    if (unit.kind === 'persona') emittedPersonas.set(unit.source.id, unit.name);
  }

  const artifacts: Artifact[] = [];

  for (const unit of units) {
    const dir = `${options.dest}/skills/${unit.name}`;
    if (unit.kind === 'skill') {
      artifacts.push({
        path: `${dir}/SKILL.md`,
        kind: 'skill',
        bytes: document(
          unit.name,
          unit.source.description,
          !unit.source.invocation.model,
          unit.source.body,
          unit.source.whenToUse ?? unit.source.description,
        ),
        sources: [unit.source.provenance],
        capability: 'exact',
      });
      for (const resource of [...unit.source.resources].sort(compareCodeUnits)) {
        const absolute = path.join(path.dirname(unit.source.provenance.path), resource);
        try {
          const bytes = await options.readResource(absolute);
          const provenance: Provenance = {
            path: absolute,
            sha256: sha256Hex(bytes),
            adapter: unit.source.provenance.adapter,
            rootKind: unit.source.provenance.rootKind,
          };
          artifacts.push({
            path: `${dir}/${resource}`,
            kind: 'skill-resource',
            bytes,
            sources: [provenance],
            capability: 'exact',
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          losses.push(
            finding('RESOURCE_READ_FAILED', `could not copy resource "${resource}": ${detail}`, {
              path: relative(options.repoRoot, absolute),
              capability: 'unsupported',
            }),
          );
        }
      }
    } else if (unit.kind === 'command') {
      const built = commandDocument(
        unit.name,
        unit.source,
        emittedPersonas,
        options.repoRoot,
        options.delegationTools,
      );
      losses.push(...built.losses);
      artifacts.push({
        path: `${dir}/SKILL.md`,
        kind: 'command-skill',
        bytes: document(unit.name, unit.source.description, true, built.body, unit.source.description),
        sources: [unit.source.provenance],
        capability: 'adapted',
      });
    } else {
      const built = personaDocument(unit.name, unit.source, options.repoRoot);
      losses.push(...built.losses);
      artifacts.push({
        path: `${dir}/SKILL.md`,
        kind: 'persona-skill',
        bytes: document(
          unit.name,
          unit.source.description,
          false,
          built.body,
          unit.source.description,
        ),
        sources: [unit.source.provenance],
        capability: 'adapted',
      });
    }
  }

  artifacts.sort((a, b) => compareCodeUnits(a.path, b.path));
  return { artifacts, losses };
}
