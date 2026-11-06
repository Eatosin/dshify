import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DshifyError } from '../src/core/errors.js';
import { isInside, repoRelative, resolveRoots, toPosix } from '../src/core/paths.js';
import { fixturePath, repoRoot } from './helpers.js';

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dshify-paths-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('isInside', () => {
  it('accepts the root itself and descendants, rejects siblings and escapes', () => {
    expect(isInside('/repo', '/repo')).toBe(true);
    expect(isInside('/repo', '/repo/a/b.md')).toBe(true);
    expect(isInside('/repo', '/repo/../etc/passwd')).toBe(false);
    expect(isInside('/repo', '/repository')).toBe(false);
  });
});

describe('repoRelative / toPosix', () => {
  it('produces POSIX paths regardless of host separator', () => {
    expect(repoRelative('/repo', '/repo/.opencode/skills/demo/SKILL.md')).toBe(
      '.opencode/skills/demo/SKILL.md',
    );
    expect(toPosix(path.join('a', 'b'))).toBe('a/b');
  });
});

describe('resolveRoots', () => {
  it('finds the repository root for the repo itself', async () => {
    const roots = await resolveRoots(repoRoot());
    expect(roots.repoGuessed).toBe(false);
    expect(roots.scanRoot).toBe(roots.repoRoot);
  });

  it('keeps a nested fixture as the scan root while resolving the containing repo', async () => {
    const roots = await resolveRoots(fixturePath('opencode-basic'));
    expect(roots.scanRoot.endsWith(path.join('fixtures', 'opencode-basic'))).toBe(true);
    expect(roots.repoRoot).toBe(roots.scanRoot.slice(0, -'fixtures/opencode-basic'.length - 1));
    expect(roots.repoGuessed).toBe(false);
  });

  it('falls back to the given path and reports a guess when no .git exists', async () => {
    const dir = await tempDir();
    const roots = await resolveRoots(dir);
    expect(roots.scanRoot).toBe(roots.repoRoot);
    expect(roots.repoGuessed).toBe(true);
  });

  it('rejects a missing path with exit code 2', async () => {
    const dir = await tempDir();
    const missing = path.join(dir, 'nope');
    await expect(resolveRoots(missing)).rejects.toMatchObject({ exitCode: 2 });
    await expect(resolveRoots(missing)).rejects.toBeInstanceOf(DshifyError);
  });

  it('rejects a file path with exit code 2', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'file.txt');
    await writeFile(file, 'x', 'utf8');
    await expect(resolveRoots(file)).rejects.toMatchObject({ exitCode: 2 });
  });
});
