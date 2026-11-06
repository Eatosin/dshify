#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { VERSION } from './version.js';
import { describeError, DshifyError, isDshifyError } from './core/errors.js';
import type { Finding } from './core/ir.js';
import { resolveRoots } from './core/paths.js';
import { finding, sortFindings } from './core/report.js';
import { scanRepo } from './core/scan.js';
import { DEFAULT_SCAN_LIMITS } from './core/source.js';

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
  plan    Show artifacts, losses, and conflicts (read-only; not implemented)
  apply   Write the DSH surface and lockfile (not implemented)
  check   Verify artifacts, lockfile, and DSH discovery (not implemented)
  verify  Discovery check only (not implemented)

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
      // --dest/--lockfile/--strategy are accepted for forward compatibility but
      // only plan/apply consume them; scan ignores them.
      continue;
    }
    if (BOOLEAN_FLAGS.has(arg)) {
      if (arg === '--json') json = true;
      if (arg === '--quiet') quiet = true;
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
  return { command, target, json, quiet, roots, help, version };
}

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
  ir: Awaited<ReturnType<typeof scanRepo>>,
  findings: readonly Finding[],
  cwd: string,
): string {
  const displayRoot = path.relative(cwd, root) || '.';
  const copyable = ir.skills.filter((skill) => skill.provenance.rootKind !== 'native').length;
  const native = ir.skills.length - copyable;
  const lines = [
    `dshify scan ${displayRoot} (${ir.harness} adapter ${ir.version})`,
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

async function runScan(
  parsed: ParsedArgs,
  io: CliIO,
  cwd: string,
): Promise<number> {
  const named = parsed.target ?? cwd;
  const resolved = path.isAbsolute(named) ? named : path.resolve(cwd, named);
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

/**
 * Run the CLI and return its exit code.
 *
 * `scan` is implemented (spec §5.1); plan/apply/check/verify remain explicit
 * "not implemented yet" so nothing pretends to write.
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
    if (parsed.command !== 'scan') {
      io.err(`dshify ${parsed.command}: not implemented yet (v0.1 spec: docs/spec.md)`);
      return 1;
    }
    return await runScan(parsed, io, options.cwd ?? process.cwd());
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
