#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { VERSION } from './version.js';

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
  scan    Inventory the source harness (read-only)
  plan    Show artifacts, losses, and conflicts (read-only)
  apply   Write the DSH surface and lockfile
  check   Verify artifacts, lockfile, and DSH discovery (CI mode)
  verify  Discovery check only

Global flags:
  --json  --quiet  --root <dir>  --dest <dir>  --lockfile <path>
  --strategy <copy|link>  --presets  --force  --verify-live
  --help  --version

Contract: docs/spec.md · docs/cli.md
`;

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

/**
 * Run the CLI and return its exit code.
 *
 * v0.1 scaffold: argument handling only. Adapters and commands land after the
 * spec in `docs/spec.md` is signed off.
 */
export function run(argv: readonly string[], io: CliIO = defaultIO): number {
  const args = [...argv];

  if (args.includes('--version')) {
    io.out(VERSION);
    return 0;
  }

  const command = args[0];
  if (command === undefined || command === '--help' || command === '-h') {
    io.out(HELP);
    return 0;
  }

  if (!isCommand(command)) {
    io.err(`dshify: unknown command "${command}"`);
    io.err('Run `dshify --help` for usage.');
    return 2;
  }

  io.err(`dshify ${command}: not implemented yet (v0.1 spec: docs/spec.md)`);
  return 1;
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
  process.exitCode = run(process.argv.slice(2));
}
