/**
 * Shared migration actions for the dshify plugin.
 *
 * Used by the model tool, the /migrate command, and the read-only Web settings
 * panel route. The engine is @eatosin/dshify, which is offline.
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

export const ACTIONS = ['scan', 'plan', 'apply', 'check'];
const LOCKFILE = '.dshify.lock.json';

/**
 * Validate model input. The registry enforces the JSON Schema; this adds the
 * path and enum guarantees the action bodies rely on.
 * @param {unknown} value
 */
export function validateInput(value) {
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
export async function runAction(input) {
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
export function parseCommand(rawInput) {
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
export function formatResult(value) {
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
