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
    if (
      ![
        'action',
        'path',
        'dest',
        'presets',
        'force',
        'delegation',
        'presetPrefix',
        'modelMap',
        'extraPlugins',
      ].includes(key)
    ) {
      throw new Error(`migrate_harness: unknown argument ${key}`);
    }
  }
  const delegation = readBoolean('delegation');
  const presets = readBoolean('presets');
  if (delegation && !presets) {
    throw new Error('migrate_harness: delegation requires presets');
  }
  const presetPrefix = input['presetPrefix'];
  if (presetPrefix !== undefined) {
    if (typeof presetPrefix !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*-?$/.test(presetPrefix)) {
      throw new Error('migrate_harness: presetPrefix must be lowercase letters, digits and hyphens');
    }
  }
  const modelMap = input['modelMap'];
  if (modelMap !== undefined) {
    if (modelMap === null || typeof modelMap !== 'object' || Array.isArray(modelMap)) {
      throw new Error('migrate_harness: modelMap must be an object keyed by persona id');
    }
    for (const [persona, entry] of Object.entries(modelMap)) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`migrate_harness: modelMap entry "${persona}" must be an object`);
      }
      for (const key of ['provider', 'model', 'tool']) {
        const value = /** @type {Record<string, unknown>} */ (entry)[key];
        if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
          throw new Error(`migrate_harness: modelMap entry "${persona}.${key}" must be a string`);
        }
      }
    }
  }
  const extraPlugins = input['extraPlugins'];
  if (extraPlugins !== undefined) {
    if (!Array.isArray(extraPlugins) || extraPlugins.some((entry) => typeof entry !== 'string' || entry === '')) {
      throw new Error('migrate_harness: extraPlugins must be an array of non-empty strings');
    }
  }
  return {
    action,
    path: readString('path'),
    dest: readString('dest') ?? '.dsh',
    presets,
    force: readBoolean('force'),
    delegation,
    presetPrefix: presetPrefix ?? (delegation ? '' : undefined),
    modelMap: modelMap ?? {},
    extraPlugins: extraPlugins ?? [],
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
 * Build delegation routes for the plugin input.
 * @param {import('@eatosin/dshify').HarnessIR} ir
 * @param {Record<string, {provider?: string, model?: string, tool?: string}>} modelMap
 */
function delegationRoutes(ir, modelMap) {
  const routes = [];
  const seen = new Set();
  const add = (persona, entry) => {
    const tool = entry?.tool ?? `subagent_${persona.replaceAll('-', '_')}`;
    if (seen.has(tool)) throw new Error(`migrate_harness: duplicate delegation tool ${tool}`);
    seen.add(tool);
    routes.push({
      persona,
      tool,
      ...(entry?.provider === undefined || entry?.model === undefined
        ? {}
        : { provider: entry.provider, model: entry.model }),
    });
  };
  for (const persona of ir.personas) add(persona.id, modelMap[persona.id]);
  const known = new Set(ir.personas.map((persona) => persona.id));
  for (const [persona, entry] of Object.entries(modelMap)) {
    if (!known.has(persona)) add(persona, entry);
  }
  return routes;
}

/**
 * Run one action through the dshify engine.
 * @param {{action: string, path?: string, dest: string, presets: boolean, force: boolean}} input
 */
export async function runAction(input) {
  const { scanRoot, repoRoot } = await resolveRoots(input.path ?? '.');
  const ir = await scanRepo({ root: scanRoot, extraRoots: [], limits: DEFAULT_SCAN_LIMITS });
  const bundleName = `${path.basename(repoRoot).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'dshify'}-dsh-harness`;
  const base = {
    repoRoot,
    dest: input.dest,
    presets: input.presets,
    strategy: 'copy',
    version: VERSION,
    bundleName,
    readResource,
    ...(input.presetPrefix === undefined ? {} : { presetPrefix: input.presetPrefix }),
    ...(input.delegation
      ? { delegation: delegationRoutes(ir, input.modelMap ?? {}), mainPreset: { id: `${input.presetPrefix ?? ''}main`, name: 'Main' } }
      : {}),
    ...((input.extraPlugins ?? []).length === 0 ? {} : { extraPlugins: input.extraPlugins }),
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
  let delegation = false;
  let presetPrefix;
  const positional = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--presets') presets = true;
    else if (token === '--force') force = true;
    else if (token === '--delegation') delegation = true;
    else if (token === '--preset-prefix') {
      presetPrefix = tokens[index + 1];
      index += 1;
    } else positional.push(token);
  }
  const target = positional[0];
  return {
    action,
    path: target,
    dest: '.dsh',
    presets,
    force,
    delegation: delegation && presets,
    ...(presetPrefix === undefined ? {} : { presetPrefix }),
    extraPlugins: [],
  };
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
