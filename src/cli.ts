#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { VERSION } from './version.js';
import { describeError, DshifyError, isDshifyError } from './core/errors.js';
import type { Finding, HarnessIR } from './core/ir.js';
import { resolveRoots } from './core/paths.js';
import { repoRelative } from './core/paths.js';
import { applyRepo, type ApplyResult } from './core/apply.js';
import { checkRepo, type CheckResult } from './core/check.js';
import { LOCKFILE_NAME } from './core/lockfile.js';
import { planRepo } from './core/plan.js';
import { finding, sortFindings } from './core/report.js';
import { scanRepo } from './core/scan.js';
import { verifyDiscovery, type DiscoveryResult } from './verify/discovery.js';
import { DEFAULT_SCAN_LIMITS, readSourceBytes } from './core/source.js';

/** Output sink so the CLI is testable without touching the process streams. */
export interface CliIO {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const defaultIO: CliIO = {
  out: (text) => process.stdout.write(text.endsWith('\n') ? text : `${text}\n`),
  err: (text) => process.stderr.write(text.endsWith('\n') ? text : `${text}\n`),
};

export const COMMANDS = ['scan', 'plan', 'apply', 'check', 'verify'] as const;
export type Command = (typeof COMMANDS)[number];

const HELP = `dshify ${VERSION} — port agent harness surfaces to DeepSeek Harness

Usage:
  dshify <command> [path] [flags]

Commands:
  scan    Inventory the source harness (read-only; implemented)
  plan    Show artifacts, losses, and conflicts (read-only; implemented)
  apply   Write the DSH surface and lockfile (implemented)
  check   Verify artifacts, lockfile, and DSH discovery (implemented)
  verify  Discovery check only (implemented)

Global flags:
  --json  --quiet  --root <dir>
  --dest <dir>  --lockfile <path>  --strategy <copy|link>
  --presets  --force  --verify-live  --no-color
  --help  --version

Contract: docs/spec.md · docs/cli.md
`;

interface ParsedArgs {
  readonly command: Command | undefined;
  readonly target: string | undefined;
  readonly json: boolean;
  readonly quiet: boolean;
  readonly roots: readonly string[];
  readonly dest: string;
  readonly lockfile: string;
  readonly presets: boolean;
  readonly strategy: 'copy' | 'link';
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly help: boolean;
  readonly version: boolean;
}

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

const VALUE_FLAGS = new Set(['--root', '--dest', '--lockfile', '--strategy']);
const BOOLEAN_FLAGS = new Set([
  '--json',
  '--quiet',
  '--presets',
  '--force',
  '--dry-run',
  '--verify-live',
  '--no-color',
]);

function parseArgs(argv: readonly string[]): ParsedArgs {
  let command: Command | undefined;
  let target: string | undefined;
  let json = false;
  let quiet = false;
  let help = false;
  let version = false;
  let dest = '.dsh';
  let lockfile = LOCKFILE_NAME;
  let presets = false;
  let force = false;
  let dryRun = false;
  let strategy: 'copy' | 'link' = 'copy';
  const roots: string[] = [];
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--version') {
      version = true;
      continue;
    }
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        throw DshifyError.usage(`${arg} requires a value`);
      }
      index += 1;
      if (arg === '--root') roots.push(value);
      if (arg === '--dest') dest = value;
      if (arg === '--lockfile') lockfile = value;
      if (arg === '--strategy') {
        if (value !== 'copy' && value !== 'link') {
          throw DshifyError.usage(`--strategy must be "copy" or "link" (got "${value}")`);
        }
        strategy = value;
      }
      // --lockfile is accepted for forward compatibility; apply consumes it.
      continue;
    }
    if (BOOLEAN_FLAGS.has(arg)) {
      if (arg === '--json') json = true;
      if (arg === '--quiet') quiet = true;
      if (arg === '--presets') presets = true;
      if (arg === '--force') force = true;
      if (arg === '--dry-run') dryRun = true;
      continue;
    }
    if (arg.startsWith('-') && arg !== '-') {
      throw DshifyError.usage(`unknown flag "${arg}"`);
    }
    positional.push(arg);
  }

  const [first, second, ...rest] = positional;
  if (first !== undefined) {
    if (!isCommand(first)) {
      throw DshifyError.usage(`unknown command "${first}"`);
    }
    command = first;
  }
  if (second !== undefined) target = second;
  if (rest.length > 0) {
    throw DshifyError.usage(`unexpected argument "${rest[0] ?? ''}"`);
  }
  return { command, target, json, quiet, roots, dest, lockfile, presets, strategy, force, dryRun, help, version };
}

function resolveTarget(named: string | undefined, cwd: string): string {
  const value = named ?? cwd;
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}

function displayRoot(root: string, cwd: string): string {
  return path.relative(cwd, root) || '.';
}

// --------------------------------------------------------------------------
// scan
// --------------------------------------------------------------------------

interface ScanEnvelope {
  readonly kind: 'scan';
  readonly schemaVersion: 1;
  readonly ok: boolean;
  readonly root: string;
  readonly harness: { readonly id: string; readonly version: string };
  readonly findings: readonly Finding[];
  readonly inventory: unknown;
  readonly summary: {
    readonly skills: number;
    readonly copyableSkills: number;
    readonly nativeSkills: number;
    readonly commands: number;
    readonly personas: number;
    readonly mcpServers: number;
    readonly findings: number;
  };
}

function renderScanHuman(
  root: string,
  ir: HarnessIR,
  findings: readonly Finding[],
  cwd: string,
): string {
  const copyable = ir.skills.filter((skill) => skill.provenance.rootKind !== 'native').length;
  const native = ir.skills.length - copyable;
  const lines = [
    `dshify scan ${displayRoot(root, cwd)} (${ir.harness} adapter ${ir.version})`,
    `  skills    ${ir.skills.length} (${copyable} copyable, ${native} native)`,
    `  commands  ${ir.commands.length}`,
    `  personas  ${ir.personas.length}`,
    `  mcp       ${ir.mcpServers.length}`,
    `  findings  ${findings.length}`,
  ];
  for (const item of findings) {
    const where = item.path === undefined ? '' : ` ${item.path}`;
    lines.push(`    ${item.severity.padEnd(7)} ${item.code}${where}`);
  }
  return lines.join('\n');
}

async function runScan(parsed: ParsedArgs, io: CliIO, cwd: string): Promise<number> {
  const resolved = resolveTarget(parsed.target, cwd);
  const roots = await resolveRoots(resolved);
  const ir = await scanRepo({
    root: roots.scanRoot,
    extraRoots: parsed.roots,
    limits: DEFAULT_SCAN_LIMITS,
  });

  const findings: Finding[] = [...ir.warnings];
  if (roots.repoGuessed) {
    findings.push(
      finding('ROOT_GUESS', 'no .git ancestor found; using the given path as the repository root', {
        path: '.',
      }),
    );
  }
  const orderedFindings = sortFindings(findings);
  const copyable = ir.skills.filter((skill) => skill.provenance.rootKind !== 'native').length;

  if (parsed.json) {
    const envelope: ScanEnvelope = {
      kind: 'scan',
      schemaVersion: 1,
      ok: true,
      root: ir.root,
      harness: { id: ir.harness, version: ir.version },
      findings: orderedFindings,
      inventory: ir,
      summary: {
        skills: ir.skills.length,
        copyableSkills: copyable,
        nativeSkills: ir.skills.length - copyable,
        commands: ir.commands.length,
        personas: ir.personas.length,
        mcpServers: ir.mcpServers.length,
        findings: orderedFindings.length,
      },
    };
    io.out(JSON.stringify(envelope, null, 2));
    return 0;
  }

  if (!parsed.quiet) {
    io.out(renderScanHuman(ir.root, ir, orderedFindings, cwd));
  }
  return 0;
}

// --------------------------------------------------------------------------
// plan
// --------------------------------------------------------------------------

interface PlanEnvelope {
  readonly kind: 'plan';
  readonly schemaVersion: 1;
  readonly ok: boolean;
  readonly root: string;
  readonly dest: string;
  readonly harness: { readonly id: string; readonly version: string };
  readonly findings: readonly Finding[];
  readonly artifacts: ReadonlyArray<{
    readonly path: string;
    readonly kind: string;
    readonly capability: string;
    readonly status: 'planned';
    readonly sources: readonly string[];
    readonly content: string;
  }>;
  readonly summary: {
    readonly planned: number;
    readonly losses: number;
    readonly conflicts: number;
  };
}

function renderPlanHuman(
  root: string,
  dest: string,
  ir: HarnessIR,
  planned: { artifacts: readonly { path: string; kind: string; capability: string }[]; losses: readonly Finding[]; conflicts: readonly { code: string; path: string }[] },
  cwd: string,
): string {
  const width = Math.max(0, ...planned.artifacts.map((artifact) => artifact.path.length));
  const lines = [
    `dshify plan ${displayRoot(root, cwd)} (${ir.harness} adapter ${ir.version})`,
    `  dest      ${dest} (strategy copy)`,
    '',
    'Plan',
  ];
  for (const artifact of planned.artifacts) {
    lines.push(`  ${artifact.kind.padEnd(16)} ${artifact.path.padEnd(width)} ${artifact.capability}`);
  }
  if (planned.artifacts.length === 0) lines.push('  none');
  lines.push('', 'Losses');
  for (const loss of planned.losses) {
    const where = loss.path === undefined ? '' : ` ${loss.path}`;
    lines.push(`  ${loss.severity.padEnd(7)} ${loss.code.padEnd(24)}${where}`);
  }
  if (planned.losses.length === 0) lines.push('  none');
  lines.push('', 'Conflicts');
  if (planned.conflicts.length === 0) lines.push('  none');
  for (const conflict of planned.conflicts) {
    lines.push(`  ${conflict.code.padEnd(16)} ${conflict.path}`);
  }
  lines.push('', 'Next', `  dshify apply ${displayRoot(root, cwd)}`);
  return lines.join('\n');
}

async function runPlan(parsed: ParsedArgs, io: CliIO, cwd: string): Promise<number> {
  const resolved = resolveTarget(parsed.target, cwd);
  const roots = await resolveRoots(resolved);
  const ir = await scanRepo({
    root: roots.scanRoot,
    extraRoots: parsed.roots,
    limits: DEFAULT_SCAN_LIMITS,
  });
  const planned = await planRepo(ir, {
    repoRoot: roots.repoRoot,
    dest: parsed.dest,
    presets: parsed.presets,
    strategy: parsed.strategy,
    readResource: (absolute) => readSourceBytes(absolute, DEFAULT_SCAN_LIMITS),
  });
  const dest = repoRelative(roots.repoRoot, path.resolve(roots.repoRoot, parsed.dest));
  const findings = sortFindings([...ir.warnings, ...planned.losses]);

  if (parsed.json) {
    const envelope: PlanEnvelope = {
      kind: 'plan',
      schemaVersion: 1,
      ok: true,
      root: ir.root,
      dest,
      harness: { id: ir.harness, version: ir.version },
      findings,
      artifacts: planned.artifacts.map((artifact) => ({
        path: artifact.path,
        kind: artifact.kind,
        capability: artifact.capability,
        status: 'planned' as const,
        sources: artifact.sources.map((source) => repoRelative(roots.repoRoot, source.path)),
        content: new TextDecoder().decode(artifact.bytes),
      })),
      summary: {
        planned: planned.artifacts.length,
        losses: planned.losses.length,
        conflicts: planned.conflicts.length,
      },
    };
    io.out(JSON.stringify(envelope, null, 2));
    return 0;
  }

  if (!parsed.quiet) {
    io.out(renderPlanHuman(ir.root, dest, ir, planned, cwd));
  }
  return 0;
}

// --------------------------------------------------------------------------
// apply
// --------------------------------------------------------------------------

interface ApplyEnvelope {
  readonly kind: 'apply';
  readonly schemaVersion: 1;
  readonly ok: boolean;
  readonly root: string;
  readonly dest: string;
  readonly lockfile: string;
  readonly harness: { readonly id: string; readonly version: string };
  readonly findings: readonly Finding[];
  readonly artifacts: ReadonlyArray<{
    readonly path: string;
    readonly kind: string;
    readonly capability: string;
    readonly status: string;
    readonly sources: readonly string[];
  }>;
  readonly summary: {
    readonly planned: number;
    readonly written: number;
    readonly updated: number;
    readonly unchanged: number;
    readonly repaired: number;
    readonly forced: number;
    readonly conflicts: number;
    readonly orphans: number;
  };
}

function countStatus(result: ApplyResult, status: ApplyResult['results'][number]['status']): number {
  return result.results.filter((item) => item.status === status).length;
}

function applySummary(result: ApplyResult): ApplyEnvelope['summary'] {
  return {
    planned: result.planned.artifacts.length,
    written: countStatus(result, 'written'),
    updated: countStatus(result, 'updated'),
    unchanged: countStatus(result, 'unchanged'),
    repaired: countStatus(result, 'repaired'),
    forced: countStatus(result, 'forced'),
    conflicts: countStatus(result, 'conflict') + countStatus(result, 'name-conflict'),
    orphans: countStatus(result, 'orphan'),
  };
}

function renderApplyHuman(
  root: string,
  dest: string,
  ir: HarnessIR,
  result: ApplyResult,
  cwd: string,
): string {
  const lines = [
    `dshify apply ${displayRoot(root, cwd)} (${ir.harness} adapter ${ir.version})`,
    `  dest      ${dest}`,
    `  lockfile  ${result.lockfilePath}`,
    '',
    'Apply',
  ];
  for (const item of result.results) {
    lines.push(`  ${item.status.padEnd(13)} ${item.path}`);
  }
  if (result.results.length === 0) lines.push('  none');
  lines.push('', 'Conflicts');
  if (result.conflicts.length === 0) lines.push('  none');
  for (const conflict of result.conflicts) {
    lines.push(`  ${conflict.code.padEnd(14)} ${conflict.path}`);
  }
  lines.push(
    '',
    'Lockfile',
    `  ${result.lockfilePath} (${result.lockfile.sources.length} sources, ${result.lockfile.artifacts.length} artifacts${result.lockfileWritten ? ', written' : ', unchanged'})`,
    '',
    'Next',
    `  dshify check ${displayRoot(root, cwd)}`,
  );
  return lines.join('\n');
}

async function runApply(parsed: ParsedArgs, io: CliIO, cwd: string): Promise<number> {
  // `--dry-run` is accepted but redundant: the dry run is `plan` (spec §5.3).
  if (parsed.dryRun) return runPlan(parsed, io, cwd);

  const resolved = resolveTarget(parsed.target, cwd);
  const roots = await resolveRoots(resolved);
  const ir = await scanRepo({
    root: roots.scanRoot,
    extraRoots: parsed.roots,
    limits: DEFAULT_SCAN_LIMITS,
  });
  const result = await applyRepo(ir, {
    repoRoot: roots.repoRoot,
    dest: parsed.dest,
    lockfilePath: parsed.lockfile,
    presets: parsed.presets,
    strategy: parsed.strategy,
    force: parsed.force,
    version: VERSION,
    readResource: (absolute) => readSourceBytes(absolute, DEFAULT_SCAN_LIMITS),
  });
  const dest = repoRelative(roots.repoRoot, path.resolve(roots.repoRoot, parsed.dest));
  const findings = sortFindings([...ir.warnings, ...result.planned.losses, ...result.findings]);
  const sourcesByPath = new Map(
    result.planned.artifacts.map((artifact) => [
      artifact.path,
      artifact.sources.map((source) => repoRelative(roots.repoRoot, source.path)),
    ]),
  );

  if (parsed.json) {
    const envelope: ApplyEnvelope = {
      kind: 'apply',
      schemaVersion: 1,
      ok: result.ok,
      root: ir.root,
      dest,
      lockfile: result.lockfilePath,
      harness: { id: ir.harness, version: ir.version },
      findings,
      artifacts: result.results.map((item) => ({
        path: item.path,
        kind: item.kind,
        capability: item.capability,
        status: item.status,
        sources: sourcesByPath.get(item.path) ?? [],
      })),
      summary: applySummary(result),
    };
    io.out(JSON.stringify(envelope, null, 2));
  } else if (!parsed.quiet) {
    io.out(renderApplyHuman(ir.root, dest, ir, result, cwd));
  }
  return result.ok ? 0 : 3;
}

// --------------------------------------------------------------------------
// check / verify
// --------------------------------------------------------------------------

interface VerificationView {
  readonly roots: readonly string[];
  readonly visible: ReadonlyArray<{ path: string; name: string; description: string }>;
  readonly skipped: ReadonlyArray<{ path: string; reason: string }>;
  readonly complete: boolean;
}

interface CheckEnvelope {
  readonly kind: 'check';
  readonly schemaVersion: 1;
  readonly ok: boolean;
  readonly root: string;
  readonly dest: string;
  readonly lockfile: string;
  readonly harness: { readonly id: string; readonly version: string };
  readonly findings: readonly Finding[];
  readonly artifacts: ReadonlyArray<{
    readonly path: string;
    readonly kind: string;
    readonly capability: string;
    readonly status: string;
    readonly sources: readonly string[];
  }>;
  readonly verification: VerificationView;
  readonly summary: {
    readonly planned: number;
    readonly unchanged: number;
    readonly drift: number;
    readonly conflicts: number;
    readonly missing: number;
    readonly orphans: number;
    readonly visible: number;
    readonly skipped: number;
  };
}

interface VerifyEnvelope {
  readonly kind: 'verify';
  readonly schemaVersion: 1;
  readonly ok: boolean;
  readonly root: string;
  readonly verification: VerificationView;
  readonly summary: { readonly roots: number; readonly visible: number; readonly skipped: number };
}

function verificationView(result: DiscoveryResult): VerificationView {
  return {
    roots: result.roots,
    visible: result.visible.map((skill) => ({
      path: skill.path,
      name: skill.name,
      description: skill.description,
    })),
    skipped: result.skipped.map((entry) => ({ path: entry.path, reason: entry.reason })),
    complete: result.complete,
  };
}

function countCheck(result: CheckResult, status: CheckResult['results'][number]['status']): number {
  return result.results.filter((item) => item.status === status).length;
}

function renderCheckHuman(
  root: string,
  dest: string,
  ir: HarnessIR,
  result: CheckResult,
  cwd: string,
): string {
  const lines = [
    `dshify check ${displayRoot(root, cwd)} (${ir.harness} adapter ${ir.version})`,
    `  dest      ${dest}`,
    `  lockfile  .dshify.lock.json`,
    '',
    'Check',
  ];
  for (const item of result.results) {
    lines.push(`  ${item.status.padEnd(10)} ${item.path}`);
  }
  if (result.results.length === 0) lines.push('  none');
  lines.push('', 'Verification');
  lines.push(`  roots    ${result.verification.roots.join(', ') || 'none'}`);
  lines.push(`  visible  ${result.verification.visible.length}`);
  lines.push(`  skipped  ${result.verification.skipped.length}`);
  lines.push('', 'Findings');
  if (result.findings.length === 0) lines.push('  none');
  for (const item of result.findings) {
    const where = item.path === undefined ? '' : ` ${item.path}`;
    lines.push(`  ${item.severity.padEnd(7)} ${item.code.padEnd(20)}${where}`);
  }
  lines.push('', 'Next');
  lines.push(
    result.ok
      ? '  none — the destination, lockfile and discovery all agree'
      : `  dshify apply ${displayRoot(root, cwd)}`,
  );
  return lines.join('\n');
}

async function runCheck(parsed: ParsedArgs, io: CliIO, cwd: string): Promise<number> {
  const resolved = resolveTarget(parsed.target, cwd);
  const roots = await resolveRoots(resolved);
  const ir = await scanRepo({
    root: roots.scanRoot,
    extraRoots: parsed.roots,
    limits: DEFAULT_SCAN_LIMITS,
  });
  const result = await checkRepo(ir, {
    repoRoot: roots.repoRoot,
    dest: parsed.dest,
    lockfilePath: parsed.lockfile,
    presets: parsed.presets,
    strategy: parsed.strategy,
    readResource: (absolute) => readSourceBytes(absolute, DEFAULT_SCAN_LIMITS),
    limits: DEFAULT_SCAN_LIMITS,
  });
  const dest = repoRelative(roots.repoRoot, path.resolve(roots.repoRoot, parsed.dest));
  const sourcesByPath = new Map(
    result.planned.artifacts.map((artifact) => [
      artifact.path,
      artifact.sources.map((source) => repoRelative(roots.repoRoot, source.path)),
    ]),
  );

  if (parsed.json) {
    const envelope: CheckEnvelope = {
      kind: 'check',
      schemaVersion: 1,
      ok: result.ok,
      root: ir.root,
      dest,
      lockfile: parsed.lockfile,
      harness: { id: ir.harness, version: ir.version },
      findings: result.findings,
      artifacts: result.results.map((item) => ({
        path: item.path,
        kind: item.kind,
        capability: item.capability,
        status: item.status,
        sources: sourcesByPath.get(item.path) ?? [],
      })),
      verification: verificationView(result.verification),
      summary: {
        planned: result.planned.artifacts.length,
        unchanged: countCheck(result, 'unchanged'),
        drift: countCheck(result, 'drift'),
        conflicts: countCheck(result, 'conflict'),
        missing: countCheck(result, 'missing'),
        orphans: countCheck(result, 'orphan'),
        visible: result.verification.visible.length,
        skipped: result.verification.skipped.length,
      },
    };
    io.out(JSON.stringify(envelope, null, 2));
  } else if (!parsed.quiet) {
    io.out(renderCheckHuman(ir.root, dest, ir, result, cwd));
  }
  return result.exitCode;
}

function renderVerifyHuman(root: string, verification: DiscoveryResult, cwd: string): string {
  const lines = [
    `dshify verify ${displayRoot(root, cwd)}`,
    `  roots    ${verification.roots.join(', ') || 'none'}`,
    `  visible  ${verification.visible.length}`,
    `  skipped  ${verification.skipped.length}`,
    `  complete ${verification.complete ? 'yes' : 'no'}`,
  ];
  for (const skill of verification.visible) {
    lines.push(`    visible ${skill.path}`);
  }
  for (const entry of verification.skipped) {
    lines.push(`    skipped ${entry.path} (${entry.reason})`);
  }
  return lines.join('\n');
}

async function runVerify(parsed: ParsedArgs, io: CliIO, cwd: string): Promise<number> {
  const resolved = resolveTarget(parsed.target, cwd);
  const roots = await resolveRoots(resolved);
  const verification = await verifyDiscovery(roots.repoRoot, {
    maxFileBytes: DEFAULT_SCAN_LIMITS.maxFileBytes,
  });
  const ok = verification.complete;
  if (parsed.json) {
    const envelope: VerifyEnvelope = {
      kind: 'verify',
      schemaVersion: 1,
      ok,
      root: roots.repoRoot,
      verification: verificationView(verification),
      summary: {
        roots: verification.roots.length,
        visible: verification.visible.length,
        skipped: verification.skipped.length,
      },
    };
    io.out(JSON.stringify(envelope, null, 2));
  } else if (!parsed.quiet) {
    io.out(renderVerifyHuman(roots.repoRoot, verification, cwd));
  }
  return ok ? 0 : 4;
}

// --------------------------------------------------------------------------
// entry
// --------------------------------------------------------------------------

/**
 * Run the CLI and return its exit code.
 *
 * `scan` and `plan` are implemented (spec §5.1–§5.2); `apply`/`check`/`verify`
 * remain explicit "not implemented yet" so nothing pretends to write.
 */
export async function run(
  argv: readonly string[],
  io: CliIO = defaultIO,
  options: { readonly cwd?: string } = {},
): Promise<number> {
  try {
    const parsed = parseArgs(argv);
    if (parsed.version) {
      io.out(VERSION);
      return 0;
    }
    if (parsed.help || parsed.command === undefined) {
      io.out(HELP);
      return 0;
    }
    if (parsed.command === 'scan') {
      return await runScan(parsed, io, options.cwd ?? process.cwd());
    }
    if (parsed.command === 'plan') {
      return await runPlan(parsed, io, options.cwd ?? process.cwd());
    }
    if (parsed.command === 'apply') {
      return await runApply(parsed, io, options.cwd ?? process.cwd());
    }
    if (parsed.command === 'check') {
      return await runCheck(parsed, io, options.cwd ?? process.cwd());
    }
    if (parsed.command === 'verify') {
      return await runVerify(parsed, io, options.cwd ?? process.cwd());
    }
    io.err(`dshify ${parsed.command}: not implemented yet (v0.1 spec: docs/spec.md)`);
    return 1;
  } catch (error) {
    if (isDshifyError(error)) {
      io.err(`dshify: ${error.message}`);
      return error.exitCode;
    }
    io.err(`dshify: internal error: ${describeError(error)}`);
    return 1;
  }
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = await run(process.argv.slice(2));
}
