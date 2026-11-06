import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CliIO } from '../src/cli.js';

export interface Capture {
  readonly io: CliIO;
  readonly out: () => string;
  readonly err: () => string;
}

export function capture(): Capture {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

/** Absolute path to a committed fixture record. */
export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

export function repoRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url));
}

/**
 * Copy a fixture to a temp directory so a test can mutate it.
 * Returns the temporary parent; the caller removes it.
 */
export async function copyFixture(name: string): Promise<{ parent: string; root: string }> {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'dshify-fixture-'));
  const root = path.join(parent, name);
  await cp(fixturePath(name), root, { recursive: true });
  return { parent, root };
}

export async function cleanup(parent: string): Promise<void> {
  await rm(parent, { recursive: true, force: true });
}
