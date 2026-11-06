import { mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyRepo } from '../src/core/apply.js';
import type { HarnessIR } from '../src/core/ir.js';
import { parseLockfile, readLockfile, serializeLockfile } from '../src/core/lockfile.js';
import { scanRepo } from '../src/core/scan.js';
import { DEFAULT_SCAN_LIMITS, readSourceBytes } from '../src/core/source.js';
import { cleanup, copyFixture, listFiles, treeHash } from './helpers.js';

const limits = DEFAULT_SCAN_LIMITS;
const tempParents: string[] = [];

afterAll(async () => {
  await Promise.all(tempParents.map((parent) => cleanup(parent)));
});

interface Setup {
  readonly root: string;
  readonly ir: HarnessIR;
}

async function setup(): Promise<Setup> {
  const { parent, root } = await copyFixture('opencode-basic');
  tempParents.push(parent);
  const ir = await scanRepo({ root, extraRoots: [], limits });
  return { root, ir };
}

function applyOf(
  ir: HarnessIR,
  root: string,
  overrides: Partial<Parameters<typeof applyRepo>[1]> = {},
) {
  return applyRepo(ir, {
    repoRoot: root,
    dest: '.dsh',
    lockfilePath: '.dshify.lock.json',
    presets: false,
    strategy: 'copy',
    force: false,
    version: '0.1.0',
    readResource: (absolute) => readSourceBytes(absolute, limits),
    ...overrides,
  });
}

async function sourceHash(root: string): Promise<string> {
  const files = (await listFiles(root)).filter(
    (file) => !file.startsWith('.dsh/') && file !== '.dshify.lock.json',
  );
  const hash = await import('node:crypto');
  const digest = hash.createHash('sha256');
  for (const file of files) {
    digest.update(file);
    digest.update(await readFile(path.join(root, file)));
  }
  return digest.digest('hex');
}

describe('apply — first run', () => {
  it('writes every planned artifact and the lockfile last', async () => {
    const { root, ir } = await setup();
    const result = await applyOf(ir, root);
    expect(result.ok).toBe(true);
    expect(result.results.map((item) => item.status)).toEqual([
      'written',
      'written',
      'written',
      'written',
      'written',
    ]);
    for (const artifact of result.planned.artifacts) {
      const onDisk = await readFile(path.join(root, artifact.path));
      expect(Buffer.compare(onDisk, Buffer.from(artifact.bytes))).toBe(0);
    }
    const lock = await readLockfile(path.join(root, '.dshify.lock.json'));
    expect(lock).toBeDefined();
    expect(lock?.artifacts).toHaveLength(5);
    expect(lock?.sources.length).toBeGreaterThan(0);
    expect(lock?.sourceRoots.map((entry) => entry.path)).toEqual([
      '.agents/skills',
      '.opencode/skills',
      'skills',
    ]);
    expect(result.lockfileWritten).toBe(true);
  });

  it('leaves no temp directory behind', async () => {
    const { root, ir } = await setup();
    await applyOf(ir, root);
    await expect(stat(path.join(root, '.dsh/.dshify-tmp'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('never modifies the source harness', async () => {
    const { root, ir } = await setup();
    const before = await sourceHash(root);
    await applyOf(ir, root);
    expect(await sourceHash(root)).toBe(before);
  });

  it('writes no absolute paths into the lockfile', async () => {
    const { root, ir } = await setup();
    const result = await applyOf(ir, root);
    const text = serializeLockfile(result.lockfile);
    expect(text.includes(root)).toBe(false);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe('apply — idempotency and repair', () => {
  it('is a no-op on a second run (same bytes, same lockfile, no rewrite)', async () => {
    const { root, ir } = await setup();
    const first = await applyOf(ir, root);
    const firstText = serializeLockfile(first.lockfile);
    const before = await treeHash(root);

    const second = await applyOf(ir, root);
    expect(second.results.every((item) => item.status === 'unchanged')).toBe(true);
    expect(second.lockfileWritten).toBe(false);
    expect(await treeHash(root)).toBe(before);
    expect(serializeLockfile(second.lockfile)).toBe(firstText);
  });

  it('recreates a deleted artifact and reports REPAIRED', async () => {
    const { root, ir } = await setup();
    await applyOf(ir, root);
    await rm(path.join(root, '.dsh/skills/hello/SKILL.md'));
    const repaired = await applyOf(ir, root);
    const hello = repaired.results.find((item) => item.path.endsWith('hello/SKILL.md'));
    expect(hello?.status).toBe('repaired');
    expect(repaired.findings.map((finding) => finding.code)).toContain('REPAIRED');
    expect(await readFile(path.join(root, '.dsh/skills/hello/SKILL.md'), 'utf8')).toContain(
      '# /hello',
    );
  });
});

describe('apply — conflicts', () => {
  it('preserves a human edit and exits non-ok', async () => {
    const { root, ir } = await setup();
    await applyOf(ir, root);
    const target = path.join(root, '.dsh/skills/reviewer/SKILL.md');
    await writeFile(target, '---\nname: reviewer\ndescription: edited\nuser-invocable: true\n---\n\nhuman edit\n');

    const result = await applyOf(ir, root);
    expect(result.ok).toBe(false);
    const reviewer = result.results.find((item) => item.path.endsWith('reviewer/SKILL.md'));
    expect(reviewer?.status).toBe('conflict');
    expect(result.conflicts).toHaveLength(1);
    expect(await readFile(target, 'utf8')).toBe(
      '---\nname: reviewer\ndescription: edited\nuser-invocable: true\n---\n\nhuman edit\n',
    );
  });

  it('overwrites with --force and reports FORCED', async () => {
    const { root, ir } = await setup();
    await applyOf(ir, root);
    const target = path.join(root, '.dsh/skills/reviewer/SKILL.md');
    await writeFile(target, 'human edit\n');
    const result = await applyOf(ir, root, { force: true });
    expect(result.ok).toBe(true);
    const reviewer = result.results.find((item) => item.path.endsWith('reviewer/SKILL.md'));
    expect(reviewer?.status).toBe('forced');
    expect(result.findings.map((item) => item.code)).toContain('FORCED');
    expect(await readFile(target, 'utf8')).toContain('You are the `reviewer` specialist.');
  });

  it('refuses to adopt an unowned file under dest without --force', async () => {
    const { root, ir } = await setup();
    const unowned = path.join(root, '.dsh/skills/demo-skill/SKILL.md');
    await mkdir(path.dirname(unowned), { recursive: true });
    await writeFile(unowned, 'not ours\n');
    const blocked = await applyOf(ir, root);
    expect(blocked.ok).toBe(false);
    expect(blocked.conflicts[0]?.code).toBe('NAME_CONFLICT');
    expect(await readFile(unowned, 'utf8')).toBe('not ours\n');

    const forced = await applyOf(ir, root, { force: true });
    expect(forced.ok).toBe(true);
    expect(await readFile(unowned, 'utf8')).toContain('name: demo-skill');
  });
});

describe('apply — orphans and safety', () => {
  it('keeps an orphaned artifact and reports it', async () => {
    const { root, ir } = await setup();
    await applyOf(ir, root);
    await rm(path.join(root, '.opencode/commands/hello.md'));
    const rescanned = await scanRepo({ root, extraRoots: [], limits });
    const result = await applyOf(rescanned, root);
    expect(result.ok).toBe(false);
    const orphan = result.results.find((item) => item.status === 'orphan');
    expect(orphan?.path).toBe('.dsh/skills/hello/SKILL.md');
    expect(result.findings.map((item) => item.code)).toContain('ORPHAN_ARTIFACT');
    expect(await stat(path.join(root, '.dsh/skills/hello/SKILL.md'))).toBeDefined();
  });

  it('refuses to write through a symlinked destination', async () => {
    const { root, ir } = await setup();
    const outside = path.join(root, '..', 'outside');
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(root, '.dsh'));
    await expect(applyOf(ir, root)).rejects.toMatchObject({ exitCode: 1 });
    await rm(path.join(root, '.dsh'), { force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('refuses an invalid existing lockfile', async () => {
    const { root, ir } = await setup();
    await writeFile(path.join(root, '.dshify.lock.json'), '{ broken');
    await expect(applyOf(ir, root)).rejects.toMatchObject({ exitCode: 1 });
  });

  it('never writes outside dest and the lockfile', async () => {
    const { root, ir } = await setup();
    const before = (await listFiles(root)).filter(
      (file) => !file.startsWith('.dsh/') && file !== '.dshify.lock.json',
    );
    await applyOf(ir, root);
    const after = (await listFiles(root)).filter(
      (file) => !file.startsWith('.dsh/') && file !== '.dshify.lock.json',
    );
    expect(after).toEqual(before);
  });
});

describe('apply — determinism', () => {
  it('produces the same lockfile bytes for two clean copies', async () => {
    const first = await setup();
    const second = await setup();
    const a = await applyOf(first.ir, first.root);
    const b = await applyOf(second.ir, second.root);
    expect(serializeLockfile(a.lockfile)).toBe(serializeLockfile(b.lockfile));
    expect(a.results.map((item) => item.path)).toEqual(b.results.map((item) => item.path));
  });

  it('parses back to the same canonical lockfile it wrote', async () => {
    const { root, ir } = await setup();
    const result = await applyOf(ir, root);
    const text = await readFile(path.join(root, '.dshify.lock.json'), 'utf8');
    expect(serializeLockfile(parseLockfile(text, 'round-trip'))).toBe(
      serializeLockfile(result.lockfile),
    );
  });
});
