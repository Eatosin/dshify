/**
 * dshify migration plugin for DeepSeek Harness.
 *
 * Host half: registers the model-facing `migrate_harness` tool and the
 * human-facing `/migrate` command. All work happens in @eatosin/dshify, the
 * offline CLI engine. The plugin adds no network access.
 *
 * Loader contract: `apply(ctx)` registers resources through `ctx.effect`.
 * The tool definition is plain JSON Schema data; no harness package import is
 * needed, so the bundle has no peer dependencies.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_SCAN_LIMITS,
  VERSION,
  applyRepo,
  checkRepo,
  planRepo,
  scanRepo,
} from '@eatosin/dshify';

export const name = 'dshify';
export const inject = ['tools'];

const ACTIONS = ['scan', 'plan', 'apply', 'check'];
const LOCKFILE = '.dshify.lock.json';

const TOOL_DESCRIPTION =
  'Port an OpenCode repository to a DeepSeek Harness (DSH) surface. ' +
  'Actions: "scan" lists the source skills, commands, personas and MCP servers (read-only); ' +
  '"plan" shows the DSH artifacts, findings and losses (read-only); ' +
  '"apply" writes .dsh/ and .dshify.lock.json (writes files; use a test branch); ' +
  '"check" verifies the files, the lockfile and DSH discovery (read-only). ' +
  'apply never deletes user files and refuses to overwrite files it does not own.';

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  description: 'Counts for the completed action.',
};

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ACTIONS, description: 'Action that ran.' },
    ok: { type: 'boolean', description: 'True when the action found no blocking problem.' },
    root: { type: 'string', description: 'Absolute repository root.' },
    exitCode: { type: 'integer', description: '0, 3 (drift or conflict) or 4 (verification failed).' },
    summary: SUMMARY_SCHEMA,
    findings: { type: 'array', items: { type: 'object', additionalProperties: true } },
    artifacts: { type: 'array', items: { type: 'object', additionalProperties: true } },
    verification: { type: 'object', additionalProperties: true },
  },
  required: ['action', 'ok', 'root'],
};

const TOOL = {
  name: 'migrate_harness',
  description: TOOL_DESCRIPTION,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ACTIONS,
        description: 'scan, plan, apply or check.',
      },
      path: {
        type: 'string',
        description: 'Repository path. A relative path resolves from the working directory. Default: ".".',
      },
      dest: {
        type: 'string',
        description: 'Destination tree inside the repository. Default: ".dsh".',
      },
      presets: {
        type: 'boolean',
        description: 'Also emit the .dsh/harness/ preset bundle (persona and MCP rows).',
      },
      force: {
        type: 'boolean',
        description: 'Replace human-edited artifacts during apply. Use with care.',
      },
    },
    required: ['action'],
  },
  output: {
    schema: OUTPUT_SCHEMA,
    render(_args, value) {
      return [{ type: 'text', text: formatResult(value) }];
    },
  },
  presentCall(args) {
    const action = typeof args?.action === 'string' ? args.action : 'migration';
    return { card: 'generic', title: `dshify ${action}`, kind: 'other', rawInput: args };
  },
  async execute(rawArgs) {
    const input = validateInput(rawArgs);
    return await runAction(input);
  },
};

const COMMAND = {
  name: 'migrate',
  description: 'Port an OpenCode repository to DSH (scan, plan, apply, check).',
  handler: async (invocation) => {
    try {
      const input = parseCommand(invocation.rawInput);
      return { kind: 'success', text: formatResult(await runAction(input)) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: 'error', text: message };
    }
  },
};

/**
 * Register the tool and, when the profile has the command service, /migrate.
 * @param {object} ctx - Cordis context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(TOOL));

  const commands = typeof ctx.get === 'function' ? ctx.get('commands') : undefined;
  if (commands !== undefined && typeof commands.register === 'function') {
    ctx.effect(() => commands.register(COMMAND));
  }
}

/**
 * Validate model input. The registry enforces the JSON Schema; this adds the
 * path and enum guarantees the action bodies rely on.
 * @param {unknown} value
 */
function validateInput(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('migrate_harness: arguments must be an object');
  }
  const input = /** @type {Record<string, unknown>} */ (value);
  const action = input['action'];
  if (typeof action !== 'string' || !ACTIONS.includes(action)) {
    throw new Error(`migrate_harness: action must be one of ${ACTIONS.join(', ')}`);
  }
  const readString = (key) => {
    const field = input[key];
    if (field === undefined) return undefined;
    if (typeof field !== 'string' || field.length === 0) {
      throw new Error(`migrate_harness: ${key} must be a non-empty string`);
    }
    return field;
  };
  const readBoolean = (key) => {
    const field = input[key];
    if (field === undefined) return false;
    if (typeof field !== 'boolean') throw new Error(`migrate_harness: ${key} must be a boolean`);
    return field;
  };
  for (const key of Object.keys(input)) {
    if (!['action', 'path', 'dest', 'presets', 'force'].includes(key)) {
      throw new Error(`migrate_harness: unknown argument ${key}`);
    }
  }
  return {
    action,
    path: readString('path'),
    dest: readString('dest') ?? '.dsh',
    presets: readBoolean('presets'),
    force: readBoolean('force'),
  };
}

/**
 * Resolve the scan root and its repository root without importing CLI internals.
 * @param {string} target
 */
async function resolveRoots(target) {
  const requested = path.resolve(process.cwd(), target);
  let scanRoot;
  try {
    scanRoot = await realpath(requested);
  } catch {
    throw new Error(`path does not exist: ${target}`);
  }
  const info = await stat(scanRoot);
  if (!info.isDirectory()) throw new Error(`path is not a directory: ${target}`);

  let current = scanRoot;
  for (;;) {
    try {
      await stat(path.join(current, '.git'));
      return { scanRoot, repoRoot: current };
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return { scanRoot, repoRoot: scanRoot };
      current = parent;
    }
  }
}

async function readResource(absolute) {
  return new Uint8Array(await readFile(absolute));
}

/**
 * Run one action through the dshify engine.
 * @param {{action: string, path?: string, dest: string, presets: boolean, force: boolean}} input
 */
async function runAction(input) {
  const { scanRoot, repoRoot } = await resolveRoots(input.path ?? '.');
  const ir = await scanRepo({ root: scanRoot, extraRoots: [], limits: DEFAULT_SCAN_LIMITS });
  const base = {
    repoRoot,
    dest: input.dest,
    presets: input.presets,
    strategy: 'copy',
    version: VERSION,
    readResource,
  };
  const findings = [...ir.warnings];

  if (input.action === 'scan') {
    return {
      action: 'scan',
      ok: true,
      root: repoRoot,
      summary: {
        skills: ir.skills.length,
        commands: ir.commands.length,
        personas: ir.personas.length,
        mcpServers: ir.mcpServers.length,
        findings: findings.length,
      },
      findings,
    };
  }

  if (input.action === 'plan') {
    const planned = await planRepo(ir, base);
    return {
      action: 'plan',
      ok: planned.conflicts.length === 0,
      root: repoRoot,
      summary: {
        artifacts: planned.artifacts.length,
        losses: planned.losses.length,
        conflicts: planned.conflicts.length,
      },
      findings: [...findings, ...planned.losses],
      artifacts: planned.artifacts.map((artifact) => ({
        path: artifact.path,
        kind: artifact.kind,
        capability: artifact.capability,
      })),
    };
  }

  if (input.action === 'apply') {
    const applied = await applyRepo(ir, { ...base, lockfilePath: LOCKFILE, force: input.force });
    const counts = {};
    for (const result of applied.results) {
      counts[result.status] = (counts[result.status] ?? 0) + 1;
    }
    return {
      action: 'apply',
      ok: applied.ok,
      root: repoRoot,
      exitCode: applied.ok ? 0 : 3,
      summary: { ...counts, conflicts: applied.conflicts.length, lockfile: applied.lockfilePath },
      findings: [...findings, ...applied.findings],
      artifacts: applied.results.map((result) => ({
        path: result.path,
        kind: result.kind,
        capability: result.capability,
        status: result.status,
      })),
    };
  }

  const checked = await checkRepo(ir, { ...base, lockfilePath: LOCKFILE, limits: DEFAULT_SCAN_LIMITS });
  return {
    action: 'check',
    ok: checked.ok,
    root: repoRoot,
    exitCode: checked.exitCode,
    summary: {
      planned: checked.planned.artifacts.length,
      visible: checked.verification.visible.length,
      skipped: checked.verification.skipped.length,
      findings: checked.findings.length,
    },
    findings: [...findings, ...checked.findings],
    verification: {
      roots: checked.verification.roots,
      visible: checked.verification.visible.map((skill) => skill.path),
      skipped: checked.verification.skipped,
      complete: checked.verification.complete,
    },
    artifacts: checked.results.map((result) => ({
      path: result.path,
      kind: result.kind,
      capability: result.capability,
      status: result.status,
    })),
  };
}

/**
 * Parse `/migrate [action] [path] [--presets] [--force]`.
 * @param {string} rawInput
 */
function parseCommand(rawInput) {
  const tokens = rawInput.trim().split(/\s+/).filter(Boolean);
  let action = 'plan';
  if (tokens.length > 0 && ACTIONS.includes(tokens[0])) action = tokens.shift();
  let presets = false;
  let force = false;
  const positional = [];
  for (const token of tokens) {
    if (token === '--presets') presets = true;
    else if (token === '--force') force = true;
    else positional.push(token);
  }
  const target = positional[0];
  return { action, path: target, dest: '.dsh', presets, force };
}

/**
 * Model-facing text for one result.
 * @param {object} value
 */
function formatResult(value) {
  const lines = [`dshify ${value.action}: ${value.ok ? 'ok' : 'needs attention'}`];
  if (value.exitCode !== undefined) lines.push(`exit code: ${value.exitCode}`);
  lines.push(`root: ${value.root}`);
  if (value.summary !== undefined) {
    const summary = Object.entries(value.summary)
      .map(([key, count]) => `${key}=${count}`)
      .join(' ');
    if (summary !== '') lines.push(`summary: ${summary}`);
  }
  if (Array.isArray(value.findings) && value.findings.length > 0) {
    lines.push('findings:');
    for (const finding of value.findings) {
      const where = finding.path === undefined ? '' : ` ${finding.path}`;
      lines.push(`- ${finding.code ?? finding.code} (${finding.severity ?? 'info'})${where}`);
    }
  }
  if (Array.isArray(value.artifacts) && value.artifacts.length > 0) {
    lines.push('artifacts:');
    for (const artifact of value.artifacts.slice(0, 50)) {
      const status = artifact.status === undefined ? '' : ` [${artifact.status}]`;
      lines.push(`- ${artifact.path} (${artifact.capability})${status}`);
    }
  }
  lines.push('', JSON.stringify(value, null, 2));
  return lines.join('\n');
}
