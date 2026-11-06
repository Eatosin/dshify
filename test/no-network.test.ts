import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './helpers.js';

/**
 * Offline-core guard (spec §13.13): the product never makes network calls.
 * `src/` is scanned as text so a hidden import cannot slip in through a
 * generated file.
 */
async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(absolute)));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(absolute);
  }
  return files;
}

const NETWORK_IMPORT =
  /(?:from\s+|require\()\s*['"]node:(?:http|https|net|dns|tls|dgram)['"]/;
const NETWORK_CALL = /\bfetch\s*\(/;

describe('offline core', () => {
  it('has no network imports or calls under src/', async () => {
    const root = repoRoot();
    const files = await sourceFiles(path.join(root, 'src'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      const relative = path.relative(root, file);
      expect(text, `${relative} imports a network module`).not.toMatch(NETWORK_IMPORT);
      expect(text, `${relative} calls fetch`).not.toMatch(NETWORK_CALL);
    }
  });
});
