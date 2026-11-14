import type { Dirent } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ScanInput } from '../../core/adapter.js';
import type {
  AccessMode,
  Command,
  Finding,
  HarnessIR,
  McpAuth,
  McpServer,
  Persona,
  Placeholder,
  PluginSurface,
  Provenance,
  Skill,
  SourceRootKind,
} from '../../core/ir.js';
import { KEBAB_CASE } from '../../core/ir.js';
import {
  FrontmatterError,
  coerceStrictBoolean,
  parseMarkdown,
  singleLineString,
  unknownKeys,
} from '../../core/frontmatter.js';
import { compareCodeUnits, finding, sortFindings } from '../../core/report.js';
import { isInside, repoRelative, toPosix } from '../../core/paths.js';
import { DshifyError } from '../../core/errors.js';
import {
  SourceEncodingError,
  SourceLimitError,
  readSourceText,
  sha256OfFile,
} from '../../core/source.js';

/**
 * OpenCode V2 scan. Behaviour contract: docs/mapping/opencode.md.
 *
 * Read-only by construction: every helper below either reads or returns data.
 * User-content problems become findings so a malformed unit is reported and
 * skipped, never silently dropped and never fatal.
 */

export const ADAPTER_VERSION = '0.1.0';

const ADAPTER_ID = 'opencode';

const SKILL_KEYS = [
  'name',
  'description',
  'disable-model-invocation',
  'user-invocable',
  'whenToUse',
  'metadata',
  'license',
  'allowed-tools',
] as const;

const COMMAND_KEYS = [
  'name',
  'description',
  'agent',
  'subagent',
  'model',
  'temperature',
  'tools',
  'argument-hint',
] as const;

const PERSONA_KEYS = [
  'name',
  'description',
  'mode',
  'model',
  'temperature',
  'steps',
  'tools',
  'permissions',
  'disabled',
  'system',
  'prompt',
] as const;

const MCP_NAME = /^[A-Za-z0-9_-]{1,32}$/;
const SECRET_KEY = /(TOKEN|KEY|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL)/i;
const ENV_INTERPOLATION = /\{env:[A-Za-z_][A-Za-z0-9_]*\}/;
const PLACEHOLDER_ORDER: readonly Placeholder[] = ['arguments', 'positional', 'shell-injection'];

interface OpenCodeConfig {
  readonly data: Readonly<Record<string, unknown>>;
  /** Absolute path of the selected config file, when it exists. */
  readonly path: string | null;
  /** Repo-relative path of the selected config file; used in findings. */
  readonly relPath: string;
  readonly sha256: string | null;
}

interface SkillRoot {
  readonly abs: string;
  readonly kind: SourceRootKind;
  readonly declared: string;
}

function cmp(a: string, b: string): number {
  return compareCodeUnits(a, b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

async function canonicalize(absolute: string): Promise<string> {
  try {
    return await realpath(absolute);
  } catch {
    return path.resolve(absolute);
  }
}

async function isFile(absolute: string): Promise<boolean> {
  try {
    return (await stat(absolute)).isFile();
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function isDirectory(absolute: string): Promise<boolean> {
  try {
    return (await stat(absolute)).isDirectory();
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function listDirect(absolute: string): Promise<Dirent[]> {
  try {
    const entries = await readdir(absolute, { withFileTypes: true });
    return [...entries].sort((a, b) => cmp(a.name, b.name));
  } catch (error) {
    if (isNotFound(error)) return [];
    const detail = error instanceof Error ? error.message : String(error);
    throw DshifyError.scanFailed(`cannot read directory ${absolute}: ${detail}`);
  }
}

function assertItemBudget(label: string, count: number, input: ScanInput): void {
  if (count > input.limits.maxItems) {
    throw DshifyError.scanFailed(
      `${label} exceed the ${input.limits.maxItems}-item scan limit`,
    );
  }
}

function checkAbort(input: ScanInput): void {
  if (input.signal?.aborted) {
    throw DshifyError.internal('scan aborted');
  }
}

/** Map a per-file read failure to a finding; re-throw anything infrastructural. */
function fileProblem(
  error: unknown,
  absolute: string,
): { message: string; path: string } | undefined {
  if (error instanceof SourceLimitError || error instanceof SourceEncodingError) {
    return { message: error.message, path: absolute };
  }
  if (error instanceof DshifyError) throw error;
  return undefined;
}

// --------------------------------------------------------------------------
// config
// --------------------------------------------------------------------------

const CONFIG_CANDIDATES = (root: string): string[] => [
  path.join(root, '.opencode', 'opencode.json'),
  path.join(root, 'opencode.json'),
];

async function readConfig(input: ScanInput, warnings: Finding[]): Promise<OpenCodeConfig> {
  const existing: string[] = [];
  for (const candidate of CONFIG_CANDIDATES(input.root)) {
    if (await isFile(candidate)) existing.push(candidate);
  }
  if (existing.length === 0) {
    return { data: {}, path: null, relPath: 'opencode.json', sha256: null };
  }
  // OpenCode V2 reads the project config from `.opencode/opencode.json`; a
  // repository-root `opencode.json` is the older spelling. When both exist, the
  // project-directory file wins and the ambiguity is reported.
  const absolute = existing[0]!;
  const rel = repoRelative(input.root, absolute);
  if (existing.length > 1) {
    warnings.push(
      finding(
        'CONFIG_PRECEDENCE',
        `${rel} is used; ${repoRelative(input.root, existing[1]!)} is ignored when both config files exist`,
        { path: rel, capability: 'adapted' },
      ),
    );
  }
  const canonical = await canonicalize(absolute);
  const sha256 = await sha256OfFile(absolute, input.limits);

  let text: string;
  try {
    text = await readSourceText(absolute, input.limits);
  } catch (error) {
    const problem = fileProblem(error, absolute);
    if (problem === undefined) {
      const detail = error instanceof Error ? error.message : String(error);
      throw DshifyError.scanFailed(`cannot read ${absolute}: ${detail}`);
    }
    warnings.push(finding('MALFORMED_CONFIG', problem.message, { path: rel }));
    return { data: {}, path: canonical, relPath: rel, sha256 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warnings.push(finding('MALFORMED_CONFIG', `invalid JSON: ${detail}`, { path: rel }));
    return { data: {}, path: canonical, relPath: rel, sha256 };
  }
  if (!isRecord(parsed)) {
    warnings.push(finding('MALFORMED_CONFIG', 'root value must be an object', { path: rel }));
    return { data: {}, path: canonical, relPath: rel, sha256 };
  }
  return { data: parsed, path: canonical, relPath: rel, sha256 };
}

function readConfiguredRoots(
  config: OpenCodeConfig,
  scanRoot: string,
  warnings: Finding[],
): string[] {
  const raw = config.data.skills;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push(
      finding('MALFORMED_CONFIG', '"skills" must be an array of repository-relative paths', {
        path: config.relPath,
      }),
    );
    return [];
  }
  const roots: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      warnings.push(
        finding('MALFORMED_CONFIG', 'ignored a non-string entry in "skills"', {
          path: config.relPath,
        }),
      );
      continue;
    }
    roots.push(entry.trim());
  }
  void scanRoot;
  return roots;
}

// --------------------------------------------------------------------------
// skill roots
// --------------------------------------------------------------------------

async function collectSkillRoots(
  input: ScanInput,
  config: OpenCodeConfig,
  warnings: Finding[],
): Promise<SkillRoot[]> {
  const scanRoot = input.root;
  const nativeAbs = await canonicalize(path.join(scanRoot, '.agents/skills'));
  const declared: Array<{ declared: string; kind: SourceRootKind; required: boolean }> = [
    { declared: '.opencode/skills', kind: 'default', required: false },
  ];
  for (const configured of readConfiguredRoots(config, scanRoot, warnings)) {
    declared.push({ declared: configured, kind: 'configured', required: true });
  }
  for (const extra of input.extraRoots) {
    declared.push({ declared: extra, kind: 'configured', required: true });
  }
  declared.push({ declared: '.agents/skills', kind: 'native', required: false });

  const seen = new Set<string>();
  const roots: SkillRoot[] = [];
  for (const spec of declared) {
    const absolute = path.isAbsolute(spec.declared)
      ? spec.declared
      : path.resolve(scanRoot, spec.declared);
    const canonical = await canonicalize(absolute);
    if (seen.has(canonical)) continue;

    if (!(await isDirectory(absolute))) {
      if (spec.required) {
        warnings.push(
          finding('MISSING_ROOT', `configured skill root does not exist: ${spec.declared}`, {
            path: repoRelative(scanRoot, absolute),
          }),
        );
      }
      continue;
    }
    seen.add(canonical);
    const kind: SourceRootKind = canonical === nativeAbs ? 'native' : spec.kind;
    roots.push({ abs: absolute, kind, declared: spec.declared });
  }
  return roots;
}

// --------------------------------------------------------------------------
// skills
// --------------------------------------------------------------------------

async function collectResources(
  body: string,
  baseDir: string,
): Promise<{ resources: string[]; outside: string[] }> {
  const resources = new Set<string>();
  const outside = new Set<string>();
  const linkPattern = /\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

  for (const match of body.matchAll(linkPattern)) {
    const raw = match[1] ?? match[2];
    if (raw === undefined) continue;
    if (
      /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) ||
      raw.startsWith('#') ||
      raw.startsWith('//') ||
      raw.includes('{')
    ) {
      continue;
    }
    const target = raw.split('#')[0]?.split('?')[0] ?? '';
    if (target === '') continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      continue;
    }
    const absolute = path.resolve(baseDir, decoded);
    if (!isInside(baseDir, absolute)) {
      outside.add(raw);
      continue;
    }
    if (await isFile(absolute)) {
      resources.add(toPosix(path.relative(baseDir, absolute)));
    }
  }
  return {
    resources: [...resources].sort(cmp),
    outside: [...outside].sort(cmp),
  };
}

const SKILL_FILE_EXCLUDES = new Set(['SKILL.md', '.DS_Store']);
const SKILL_DIR_EXCLUDES = new Set(['node_modules', '.git', '__pycache__']);

/**
 * Every regular file in the skill directory, relative to it.
 *
 * A skill is a folder, not one file. It may load references, templates,
 * scripts, data and licence files by path, and it may mention those paths in
 * prose or code spans rather than as markdown links. Copying only linked files
 * produced a DSH skill that pointed at files it did not carry.
 */
async function collectSkillResources(baseDir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKILL_DIR_EXCLUDES.has(entry.name)) continue;
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        if (SKILL_FILE_EXCLUDES.has(entry.name)) continue;
        files.push(toPosix(path.relative(baseDir, path.join(dir, entry.name))));
      }
    }
  }
  await walk(baseDir);
  return files.sort(cmp);
}

interface SkillFileArgs {
  readonly file: string;
  readonly baseDir: string;
  readonly expectedName: string;
  readonly root: SkillRoot;
  readonly input: ScanInput;
  readonly out: Skill[];
  readonly warnings: Finding[];
}

async function addSkill(args: SkillFileArgs): Promise<void> {
  const { file, baseDir, expectedName, root, input, out, warnings } = args;
  const rel = repoRelative(input.root, file);

  const malformed = (message: string): void => {
    warnings.push(
      finding('MALFORMED_SKILL', message, { path: rel, capability: 'unsupported' }),
    );
  };

  let text: string;
  try {
    text = await readSourceText(file, input.limits);
  } catch (error) {
    const problem = fileProblem(error, file);
    if (problem === undefined) {
      const detail = error instanceof Error ? error.message : String(error);
      throw DshifyError.scanFailed(`cannot read ${file}: ${detail}`);
    }
    malformed(problem.message);
    return;
  }

  let parsed;
  try {
    parsed = parseMarkdown(text);
  } catch (error) {
    malformed(error instanceof FrontmatterError ? error.message : 'invalid frontmatter');
    return;
  }
  if (!parsed.hasFrontmatter) {
    malformed('missing YAML frontmatter (a skill needs `name` and `description`)');
    return;
  }

  const nameValue = parsed.data.name;
  if (typeof nameValue !== 'string' || !KEBAB_CASE.test(nameValue)) {
    malformed('frontmatter "name" is required and must be kebab-case');
    return;
  }
  const description = singleLineString(parsed.data.description);
  if (description === undefined) {
    malformed('frontmatter "description" is required and must be a single line');
    return;
  }
  if (nameValue !== expectedName) {
    malformed(
      `frontmatter name "${nameValue}" does not match the directory "${expectedName}" (DSH requires them equal; rename one)`,
    );
    return;
  }

  const whenToUse =
    parsed.data.whenToUse === undefined ? undefined : singleLineString(parsed.data.whenToUse);
  if (parsed.data.whenToUse !== undefined && whenToUse === undefined) {
    warnings.push(
      finding('MALFORMED_SKILL', 'frontmatter "whenToUse" must be a single line; ignored', {
        path: rel,
        capability: 'adapted',
      }),
    );
  }

  const disableRaw = parsed.data['disable-model-invocation'];
  const disableModel = disableRaw === undefined ? false : coerceStrictBoolean(disableRaw);
  if (disableModel === undefined) {
    malformed('"disable-model-invocation" must be a boolean');
    return;
  }
  const userRaw = parsed.data['user-invocable'];
  const userInvocable = userRaw === undefined ? true : coerceStrictBoolean(userRaw);
  if (userInvocable === undefined) {
    malformed('"user-invocable" must be a boolean');
    return;
  }

  for (const key of unknownKeys(parsed.data, SKILL_KEYS)) {
    warnings.push(
      finding('UNKNOWN_FIELD', `unknown skill frontmatter key "${key}"`, {
        path: rel,
        capability: 'unsupported',
      }),
    );
  }

  const linked = await collectResources(parsed.body, baseDir);
  const resources = [
    ...new Set([...linked.resources, ...(await collectSkillResources(baseDir))]),
  ].sort(cmp);
  for (const target of linked.outside) {
    warnings.push(
      finding(
        'RESOURCE_OUTSIDE_SKILL',
        `resource outside the skill directory is not copied: ${target}`,
        { path: rel, capability: 'lossy' },
      ),
    );
  }

  if (root.kind === 'native') {
    warnings.push(
      finding(
        'DSH_NATIVE_ROOT',
        'skill is already under .agents/skills, which DSH scans natively; it is reported and not emitted',
        { path: rel, capability: 'exact' },
      ),
    );
  }

  const canonical = await canonicalize(file);
  const sha256 = await sha256OfFile(file, input.limits);
  out.push({
    id: nameValue,
    description,
    ...(whenToUse === undefined ? {} : { whenToUse }),
    body: parsed.body,
    invocation: { model: !disableModel, user: userInvocable },
    resources,
    provenance: {
      path: canonical,
      sha256,
      adapter: ADAPTER_ID,
      rootKind: root.kind,
    },
    capability: 'exact',
  });
}

interface WalkBudget {
  count: number;
}

/**
 * Find nested SKILL.md files below a root's direct child. Bounded depth and entry count;
 * symlinks and dot-directories are skipped. Never throws for user content.
 */
async function findNestedSkillFiles(
  dirAbs: string,
  skipAbs: string | undefined,
  input: ScanInput,
  budget: WalkBudget,
): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || budget.count >= input.limits.maxItems) return;
    let entries: Dirent[];
    try {
      entries = await listDirect(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      checkAbort(input);
      if (entry.name.startsWith('.') || budget.count >= input.limits.maxItems) continue;
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1);
      } else if (entry.isFile() && entry.name === 'SKILL.md' && absolute !== skipAbs) {
        found.push(absolute);
        budget.count += 1;
      }
    }
  };
  await walk(dirAbs, 0);
  return found;
}

async function scanSkillRoot(
  root: SkillRoot,
  input: ScanInput,
  out: Skill[],
  warnings: Finding[],
  nestedSeen: Set<string>,
  budget: WalkBudget,
): Promise<void> {
  const entries = await listDirect(root.abs);
  for (const entry of entries) {
    checkAbort(input);
    if (entry.name.startsWith('.')) continue;
    const absolute = path.join(root.abs, entry.name);
    if (entry.isDirectory()) {
      const file = path.join(absolute, 'SKILL.md');
      const hasBundle = await isFile(file);
      if (hasBundle) {
        await addSkill({
          file,
          baseDir: absolute,
          expectedName: entry.name,
          root,
          input,
          out,
          warnings,
        });
      }
      const nestedFiles = await findNestedSkillFiles(
        absolute,
        hasBundle ? file : undefined,
        input,
        budget,
      );
      for (const nestedFile of nestedFiles) {
        const nestedRelative = repoRelative(input.root, nestedFile);
        if (nestedSeen.has(nestedRelative)) continue;
        nestedSeen.add(nestedRelative);
        warnings.push(
          finding(
            'UNSUPPORTED_NESTED_SKILL',
            'nested SKILL.md is not discovered by DSH; reported and skipped',
            { path: nestedRelative, capability: 'unsupported' },
          ),
        );
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      await addSkill({
        file: absolute,
        baseDir: root.abs,
        expectedName: entry.name.slice(0, -3),
        root,
        input,
        out,
        warnings,
      });
    }
  }
}

// --------------------------------------------------------------------------
// commands
// --------------------------------------------------------------------------

function detectPlaceholders(body: string): Placeholder[] {
  const found = new Set<Placeholder>();
  if (body.includes('$ARGUMENTS')) found.add('arguments');
  if (/\$\d+/.test(body)) found.add('positional');
  if (/(^|[\s(])!`[^`\n]+`/.test(body)) found.add('shell-injection');
  return PLACEHOLDER_ORDER.filter((placeholder) => found.has(placeholder));
}

async function scanCommands(
  input: ScanInput,
  out: Command[],
  warnings: Finding[],
): Promise<void> {
  const dir = path.join(input.root, '.opencode/commands');
  if (!(await isDirectory(dir))) return;

  for (const entry of await listDirect(dir)) {
    checkAbort(input);
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    const name = entry.name.slice(0, -3);
    const file = path.join(dir, entry.name);
    const rel = repoRelative(input.root, file);
    const malformed = (message: string): void => {
      warnings.push(
        finding('MALFORMED_COMMAND', message, { path: rel, capability: 'unsupported' }),
      );
    };

    if (!KEBAB_CASE.test(name)) {
      malformed(`command filename "${entry.name}" must be kebab-case (<name>.md)`);
      continue;
    }

    let text: string;
    try {
      text = await readSourceText(file, input.limits);
    } catch (error) {
      const problem = fileProblem(error, file);
      if (problem === undefined) throw error;
      malformed(problem.message);
      continue;
    }
    let parsed;
    try {
      parsed = parseMarkdown(text);
    } catch (error) {
      malformed(error instanceof FrontmatterError ? error.message : 'invalid frontmatter');
      continue;
    }
    if (!parsed.hasFrontmatter) {
      malformed('missing frontmatter (a command needs a `description`)');
      continue;
    }
    const description = singleLineString(parsed.data.description);
    if (description === undefined) {
      malformed('frontmatter "description" is required and must be a single line');
      continue;
    }
    for (const key of unknownKeys(parsed.data, COMMAND_KEYS)) {
      warnings.push(
        finding('UNKNOWN_FIELD', `unknown command frontmatter key "${key}"`, {
          path: rel,
          capability: 'unsupported',
        }),
      );
    }

    const agentRaw = parsed.data.agent;
    const agent =
      typeof agentRaw === 'string' && agentRaw.trim() !== '' ? agentRaw.trim() : undefined;
    if (agentRaw !== undefined && agent === undefined) {
      warnings.push(
        finding('COMMAND_AGENT_ROUTING', 'non-string "agent" routing hint is dropped', {
          path: rel,
          capability: 'adapted',
        }),
      );
    }
    const subagentRaw = parsed.data.subagent;
    if (subagentRaw !== undefined) {
      const subagent = coerceStrictBoolean(subagentRaw);
      if (subagent === true && agent === undefined) {
        warnings.push(
          finding(
            'COMMAND_AGENT_ROUTING',
            '"subagent: true" without an "agent" target is dropped (no routing possible)',
            { path: rel, capability: 'adapted' },
          ),
        );
      } else if (subagent === undefined) {
        warnings.push(
          finding('UNKNOWN_FIELD', '"subagent" must be a boolean', {
            path: rel,
            capability: 'unsupported',
          }),
        );
      }
    }

    const canonical = await canonicalize(file);
    const sha256 = await sha256OfFile(file, input.limits);
    out.push({
      name,
      description,
      body: parsed.body,
      placeholders: detectPlaceholders(parsed.body),
      ...(agent === undefined ? {} : { targetAgent: agent }),
      provenance: { path: canonical, sha256, adapter: ADAPTER_ID, rootKind: 'default' },
      capability: 'adapted',
    });
  }
  assertItemBudget('commands', out.length, input);
}

// --------------------------------------------------------------------------
// personas
// --------------------------------------------------------------------------

function personaAccess(data: Readonly<Record<string, unknown>>): AccessMode {
  const permissions = data.permissions;
  if (Array.isArray(permissions)) {
    for (const rule of permissions) {
      if (!isRecord(rule)) continue;
      const action = rule.action;
      const effect = rule.effect;
      const edits = action === 'edit' || (Array.isArray(action) && action.includes('edit'));
      if (edits && effect === 'deny') return 'read-only';
    }
  }
  const tools = data.tools;
  if (isRecord(tools) && tools.edit === false) return 'read-only';
  return 'writable';
}

async function scanPersonas(
  input: ScanInput,
  out: Persona[],
  warnings: Finding[],
): Promise<void> {
  const dir = path.join(input.root, '.opencode/agents');
  if (!(await isDirectory(dir))) return;

  for (const entry of await listDirect(dir)) {
    checkAbort(input);
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    const id = entry.name.slice(0, -3);
    const file = path.join(dir, entry.name);
    const rel = repoRelative(input.root, file);
    const malformed = (message: string): void => {
      warnings.push(
        finding('MALFORMED_PERSONA', message, { path: rel, capability: 'unsupported' }),
      );
    };

    if (!KEBAB_CASE.test(id)) {
      malformed(`agent filename "${entry.name}" must be kebab-case (<id>.md)`);
      continue;
    }

    let text: string;
    try {
      text = await readSourceText(file, input.limits);
    } catch (error) {
      const problem = fileProblem(error, file);
      if (problem === undefined) throw error;
      malformed(problem.message);
      continue;
    }
    let parsed;
    try {
      parsed = parseMarkdown(text);
    } catch (error) {
      malformed(error instanceof FrontmatterError ? error.message : 'invalid frontmatter');
      continue;
    }
    if (!parsed.hasFrontmatter) {
      malformed('missing frontmatter (an agent needs a `description`)');
      continue;
    }
    const description = singleLineString(parsed.data.description);
    if (description === undefined) {
      malformed('frontmatter "description" is required and must be a single line');
      continue;
    }
    for (const key of unknownKeys(parsed.data, PERSONA_KEYS)) {
      warnings.push(
        finding('UNKNOWN_FIELD', `unknown agent frontmatter key "${key}"`, {
          path: rel,
          capability: 'unsupported',
        }),
      );
    }

    if ('prompt' in parsed.data) {
      warnings.push(
        finding(
          'LEGACY_FIELD',
          'V1 key "prompt" is read as the system prompt; V2 spells it "system"',
          { path: rel, capability: 'adapted' },
        ),
      );
    }
    if (isRecord(parsed.data.tools)) {
      warnings.push(
        finding(
          'TOOLS_FRONTMATTER',
          'a "tools" map is not translated; presets use tool switches instead',
          { path: rel, capability: 'unsupported' },
        ),
      );
    }

    const mode = parsed.data.mode;
    if (mode !== undefined && mode !== 'subagent') {
      warnings.push(
        finding(
          'AGENT_MODE_UNEXPECTED',
          `agent mode ${JSON.stringify(mode)} is not "subagent"; converting it as a persona anyway`,
          { path: rel, capability: 'adapted' },
        ),
      );
    }

    const system = singleLineString(parsed.data.system);
    const legacyPrompt = singleLineString(parsed.data.prompt);
    const body = system ?? legacyPrompt ?? parsed.body;
    const modelHint = singleLineString(parsed.data.model);

    // Isolation is a conversion loss, reported by the planner, not a scan fact.
    const canonical = await canonicalize(file);
    const sha256 = await sha256OfFile(file, input.limits);
    out.push({
      id,
      description,
      body,
      access: personaAccess(parsed.data),
      ...(modelHint === undefined ? {} : { modelHint }),
      provenance: {
        path: canonical,
        sha256,
        adapter: ADAPTER_ID,
        rootKind: 'default',
      },
      capability: 'adapted',
    });
  }
  assertItemBudget('personas', out.length, input);
}

// --------------------------------------------------------------------------
// MCP servers
// --------------------------------------------------------------------------

function hasSecretValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return ENV_INTERPOLATION.test(value) || SECRET_KEY.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => hasSecretValue(item));
  if (isRecord(value)) {
    return Object.entries(value).some(
      ([key, entry]) => SECRET_KEY.test(key) || hasSecretValue(entry),
    );
  }
  return false;
}

function detectAuth(entry: Readonly<Record<string, unknown>>): McpAuth {
  if ('oauth' in entry || entry.auth === 'oauth') return 'oauth';
  const headers = entry.headers;
  if (isRecord(headers)) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'authorization' || SECRET_KEY.test(key)) return 'header';
    }
  }
  if (hasSecretValue(entry.env) || (typeof entry.url === 'string' && ENV_INTERPOLATION.test(entry.url))) {
    return 'unknown';
  }
  return 'none';
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

async function scanMcp(
  config: OpenCodeConfig,
  input: ScanInput,
  out: McpServer[],
  warnings: Finding[],
): Promise<void> {
  const mcp = config.data.mcp;
  if (!isRecord(mcp)) return;
  const servers = mcp.servers;
  if (!isRecord(servers)) return;
  if (config.path === null || config.sha256 === null) return;

  for (const name of Object.keys(servers).sort(cmp)) {
    checkAbort(input);
    if (!MCP_NAME.test(name)) {
      warnings.push(
        finding('MCP_INVALID_NAME', `MCP server name "${name}" must match [A-Za-z0-9_-]{1,32}; skipped`, {
          path: config.relPath,
          capability: 'unsupported',
        }),
      );
      continue;
    }
    const raw = servers[name];
    if (!isRecord(raw)) {
      warnings.push(
        finding('MALFORMED_CONFIG', `MCP server "${name}" is not an object; skipped`, {
          path: config.relPath,
        }),
      );
      continue;
    }

    const type = raw.type;
    let transport: McpServer['transport'];
    let command: string | undefined;
    let args: string[] | undefined;
    let url: string | undefined;

    if (type === 'remote' || (type === undefined && typeof raw.url === 'string')) {
      if (typeof raw.url !== 'string' || raw.url === '') {
        warnings.push(
          finding('MALFORMED_CONFIG', `remote MCP server "${name}" has no url; skipped`, {
            path: config.relPath,
          }),
        );
        continue;
      }
      transport = 'streamable-http';
      url = raw.url;
      warnings.push(
        finding('MCP_REMOTE', `MCP server "${name}" is remote (streamable-http)`, {
          path: config.relPath,
          capability: 'adapted',
        }),
      );
    } else if (type === 'local' || raw.command !== undefined) {
      const rawCommand = raw.command;
      if (Array.isArray(rawCommand)) {
        const [executable, ...rest] = rawCommand;
        if (typeof executable !== 'string' || executable === '') {
          warnings.push(
            finding('MALFORMED_CONFIG', `local MCP server "${name}" has an invalid command; skipped`, {
              path: config.relPath,
            }),
          );
          continue;
        }
        command = executable;
        args = rest.map((item) => (typeof item === 'string' ? item : ''));
      } else if (typeof rawCommand === 'string' && rawCommand !== '') {
        command = rawCommand;
      } else {
        warnings.push(
          finding('MALFORMED_CONFIG', `local MCP server "${name}" has no command; skipped`, {
            path: config.relPath,
          }),
        );
        continue;
      }
      transport = 'stdio';
      warnings.push(
        finding('MCP_STDIO', `MCP server "${name}" is local (stdio)`, {
          path: config.relPath,
          capability: 'adapted',
        }),
      );
    } else {
      warnings.push(
        finding('MALFORMED_CONFIG', `MCP server "${name}" has no recognized transport; skipped`, {
          path: config.relPath,
        }),
      );
      continue;
    }

    const envRaw = isRecord(raw.env) ? raw.env : isRecord(raw.environment) ? raw.environment : undefined;
    const env: Record<string, string> = {};
    if (envRaw !== undefined) {
      for (const [key, value] of Object.entries(envRaw)) {
        if (typeof value !== 'string' || value === '') continue;
        if (SECRET_KEY.test(key) || hasSecretValue(value)) continue;
        env[key] = value;
      }
    }
    const cwd = typeof raw.cwd === 'string' && raw.cwd !== '' ? raw.cwd : undefined;

    const auth = detectAuth(raw);
    let disabled = raw.disabled === true;
    let capability: McpServer['capability'] = 'adapted';
    if (auth !== 'none') {
      capability = 'manual';
      disabled = true;
      warnings.push(
        finding(
          'MCP_AUTH_MANUAL',
          `MCP server "${name}" uses ${auth} auth; emitted disabled with a redacted secret and manual follow-up`,
          { path: config.relPath, capability: 'manual' },
        ),
      );
    }
    if (disabled) {
      warnings.push(
        finding('MCP_DISABLED', `MCP server "${name}" stays disabled`, {
          path: config.relPath,
          capability,
        }),
      );
    }

    out.push({
      name,
      transport,
      ...(command === undefined ? {} : { command }),
      ...(args === undefined ? {} : { args }),
      ...(url === undefined ? {} : { url }),
      ...(Object.keys(env).length === 0 ? {} : { env }),
      ...(cwd === undefined ? {} : { cwd }),
      auth,
      disabled,
      provenance: {
        path: config.path,
        sha256: config.sha256,
        adapter: ADAPTER_ID,
        rootKind: 'repo',
      },
      capability,
    });
  }
  assertItemBudget('MCP servers', out.length, input);
}

// --------------------------------------------------------------------------
// include files, plugins
// --------------------------------------------------------------------------

async function scanIncludeFiles(
  input: ScanInput,
  warnings: Finding[],
): Promise<Provenance | undefined> {
  let agentsMd: Provenance | undefined;
  for (const candidate of ['AGENTS.md', 'CLAUDE.md']) {
    const absolute = path.join(input.root, candidate);
    if (!(await isFile(absolute))) continue;
    const canonical = await canonicalize(absolute);
    const sha256 = await sha256OfFile(absolute, input.limits);
    const provenance: Provenance = {
      path: canonical,
      sha256,
      adapter: ADAPTER_ID,
      rootKind: 'repo',
    };
    if (candidate === 'AGENTS.md') {
      agentsMd = provenance;
      warnings.push(
        finding(
          'AGENTS_MD_SHARED',
          'AGENTS.md is loaded natively by DSH; it is reported and not touched',
          { path: candidate, capability: 'exact' },
        ),
      );
    } else {
      warnings.push(
        finding(
          'CLAUDE_MD_SHARED',
          'CLAUDE.md is loaded natively by DSH as workspace instructions; it is reported and not touched',
          { path: candidate, capability: 'exact' },
        ),
      );
    }
  }
  return agentsMd;
}

const PLUGIN_DIRS = ['.opencode/plugin', '.opencode/plugins', 'plugins', 'tools'] as const;
const PLUGIN_TOOL = /\bname:\s*['"]([a-z][a-z0-9_]*)['"]\s*,\s*description:\s*(['"])([\s\S]*?)\2/g;

async function scanPlugins(input: ScanInput, warnings: Finding[]): Promise<PluginSurface[]> {
  const surfaces: PluginSurface[] = [];
  for (const candidate of PLUGIN_DIRS) {
    const absolute = path.join(input.root, candidate);
    const file = await isFile(absolute);
    if (!file && !(await isDirectory(absolute))) continue;

    const tools: Array<{ name: string; description: string }> = [];
    if (!file) {
      for (const entry of await listDirect(absolute)) {
        checkAbort(input);
        if (!entry.isFile() || !/\.(?:ts|js|mjs|cjs)$/i.test(entry.name)) continue;
        try {
          const text = await readSourceText(path.join(absolute, entry.name), input.limits);
          for (const match of text.matchAll(PLUGIN_TOOL)) {
            const name = match[1];
            const description = match[3];
            if (name === undefined || description === undefined) continue;
            tools.push({ name, description: description.replace(/\s+/g, ' ').trim() });
          }
        } catch {
          // A file that cannot be read is reported by its own scan findings.
        }
      }
    }
    tools.sort((a, b) => cmp(a.name, b.name));
    warnings.push(
      finding(
        'PLUGIN_UNSUPPORTED',
        `${candidate} is a plugin/custom-tool surface; it is reported and never loaded or executed (${tools.length} tool(s) listed statically)`,
        { path: candidate, capability: 'unsupported' },
      ),
    );
    surfaces.push({ path: candidate, tools });
  }
  return surfaces;
}

// --------------------------------------------------------------------------
// entry
// --------------------------------------------------------------------------

export async function scanOpencode(input: ScanInput): Promise<HarnessIR> {
  checkAbort(input);
  const warnings: Finding[] = [];
  const skills: Skill[] = [];
  const commands: Command[] = [];
  const personas: Persona[] = [];
  const mcpServers: McpServer[] = [];

  const config = await readConfig(input, warnings);
  const extraInstructions: string[] = [];
  if (Array.isArray(config.data.instructions)) {
    for (const entry of config.data.instructions) {
      if (typeof entry !== 'string' || entry.trim() === '') continue;
      const normalized = entry.trim();
      if (normalized === 'AGENTS.md' || normalized === 'CLAUDE.md') continue;
      extraInstructions.push(normalized);
    }
  }
  if (extraInstructions.length > 0) {
    warnings.push(
      finding(
        'INSTRUCTIONS_EXTRA_UNMAPPED',
        `extra instruction files are not loaded by DSH: ${extraInstructions.join(', ')}; fold them into AGENTS.md or add them to the preset\'s instructionFileCandidates`,
        { path: config.relPath, capability: 'manual' },
      ),
    );
  }
  const roots = await collectSkillRoots(input, config, warnings);
  const nestedSeen = new Set<string>();
  const walkBudget: WalkBudget = { count: 0 };
  for (const root of roots) {
    await scanSkillRoot(root, input, skills, warnings, nestedSeen, walkBudget);
    assertItemBudget('skills', skills.length, input);
  }

  await scanCommands(input, commands, warnings);
  await scanPersonas(input, personas, warnings);
  const agentsMd = await scanIncludeFiles(input, warnings);
  await scanMcp(config, input, mcpServers, warnings);
  const pluginSurfaces = await scanPlugins(input, warnings);

  skills.sort((a, b) => cmp(a.id, b.id));
  commands.sort((a, b) => cmp(a.name, b.name));
  personas.sort((a, b) => cmp(a.id, b.id));
  mcpServers.sort((a, b) => cmp(a.name, b.name));

  return {
    harness: 'opencode',
    version: ADAPTER_VERSION,
    root: input.root,
    skills,
    commands,
    personas,
    mcpServers,
    ...(agentsMd === undefined ? {} : { agentsMd }),
    ...(pluginSurfaces.length === 0 ? {} : { pluginSurfaces }),
    ...(extraInstructions.length === 0 ? {} : { extraInstructions }),
    roots: roots.map((root) => ({ path: root.abs, kind: root.kind })),
    warnings: sortFindings(warnings),
  };
}
