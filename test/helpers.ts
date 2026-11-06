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
  return path.resolve(fileURLToPath(new URL('..', import.meta.url)));
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

/** Recursive list of regular files (relative POSIX paths, sorted). */
export async function listFiles(root: string, prefix = ''): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

/**
 * Content hash of a whole tree (file names + bytes). Used to prove that a
 * read-only command wrote nothing.
 */
export async function treeHash(root: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  const { readFile } = await import('node:fs/promises');
  const hash = createHash('sha256');
  for (const file of await listFiles(root)) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(path.join(root, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}
