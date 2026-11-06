import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyRepo } from '../src/core/apply.js';
import { checkRepo } from '../src/core/check.js';
import type { HarnessIR } from '../src/core/ir.js';
import { scanRepo } from '../src/core/scan.js';
import { DEFAULT_SCAN_LIMITS, readSourceBytes } from '../src/core/source.js';
import { cleanup, copyFixture } from './helpers.js';

const limits = DEFAULT_SCAN_LIMITS;
const tempParents: string[] = [];

afterAll(async () => {
  await Promise.all(tempParents.map((parent) => cleanup(parent)));
});

async function setup(): Promise<{ root: string; ir: HarnessIR }> {
  const { parent, root } = await copyFixture('opencode-basic');
  tempParents.push(parent);
  const ir = await scanRepo({ root, extraRoots: [], limits });
  return { root, ir };
}

function options(root: string, overrides: Record<string, unknown> = {}) {
  return {
    repoRoot: root,
    dest: '.dsh',
    lockfilePath: '.dshify.lock.json',
    presets: false,
    strategy: 'copy' as const,
    force: false,
    version: '0.1.0',
    readResource: (absolute: string) => readSourceBytes(absolute, limits),
    ...overrides,
  };
}

async function applied(): Promise<{ root: string; ir: HarnessIR }> {
  const { root, ir } = await setup();
  await applyRepo(ir, options(root));
  return { root, ir };
}

function check(root: string, ir: HarnessIR, overrides: Record<string, unknown> = {}) {
  return checkRepo(ir, {
    repoRoot: root,
    dest: '.dsh',
    lockfilePath: '.dshify.lock.json',
    presets: false,
    strategy: 'copy',
    readResource: (absolute: string) => readSourceBytes(absolute, limits),
    limits,
    ...overrides,
  });
}

describe('check — clean surface', () => {
  it('passes after apply and reports the discovered catalog', async () => {
    const { root, ir } = await applied();
    const result = await check(root, ir);
    expect(result.exitCode).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.results.every((item) => item.status === 'unchanged')).toBe(true);
    expect(result.verification.visible).toHaveLength(5);
    expect(result.verification.complete).toBe(true);
  });

  it('writes nothing', async () => {
    const { root, ir } = await applied();
    const before = await readFile(path.join(root, '.dshify.lock.json'), 'utf8');
    await check(root, ir);
    expect(await readFile(path.join(root, '.dshify.lock.json'), 'utf8')).toBe(before);
  });
});

describe('check — verification failures (exit 4)', () => {
  it('reports a missing artifact', async () => {
    const { root, ir } = await applied();
    await rm(path.join(root, '.dsh/skills/hello/SKILL.md'));
    const result = await check(root, ir);
    expect(result.exitCode).toBe(4);
    expect(result.results.some((item) => item.status === 'missing')).toBe(true);
    expect(result.findings.map((item) => item.code)).toContain('MISSING_ARTIFACT');
  });

  it('reports a discovery miss when the destination is not a DSH root', async () => {
    const { root, ir } = await setup();
    await applyRepo(ir, options(root, { dest: 'custom' }));
    const result = await check(root, ir, { dest: 'custom' });
    expect(result.exitCode).toBe(4);
    expect(result.findings.filter((item) => item.code === 'DISCOVERY_MISS')).toHaveLength(4);
    expect(result.verification.visible.map((skill) => skill.path)).toEqual([
      '.agents/skills/marketing-demo/SKILL.md',
    ]);
  });
});

describe('check — drift and conflict (exit 3)', () => {
  it('reports a human edit as conflict', async () => {
    const { root, ir } = await applied();
    await writeFile(path.join(root, '.dsh/skills/reviewer/SKILL.md'), 'human edit\n');
    const result = await check(root, ir);
    expect(result.exitCode).toBe(3);
    expect(result.results.some((item) => item.status === 'conflict')).toBe(true);
    expect(result.findings.map((item) => item.code)).toContain('CONFLICT');
  });

  it('reports a changed source as drift', async () => {
    const { root } = await applied();
    const source = path.join(root, '.opencode/skills/demo-skill/SKILL.md');
    const original = await readFile(source, 'utf8');
    await writeFile(source, `${original}\nAn added line.\n`);
    const rescanned = await scanRepo({ root, extraRoots: [], limits });
    const result = await check(root, rescanned);
    expect(result.exitCode).toBe(3);
    expect(result.results.some((item) => item.status === 'drift')).toBe(true);
    expect(result.findings.map((item) => item.code)).toContain('DRIFT');
  });

  it('reports a missing lockfile as drift', async () => {
    const { root, ir } = await applied();
    await rm(path.join(root, '.dshify.lock.json'));
    const result = await check(root, ir);
    expect(result.exitCode).toBe(3);
    expect(result.findings.map((item) => item.code)).toContain('LOCKFILE_MISSING');
  });

  it('reports an orphaned artifact', async () => {
    const { root } = await applied();
    await rm(path.join(root, '.opencode/commands/hello.md'));
    const rescanned = await scanRepo({ root, extraRoots: [], limits });
    const result = await check(root, rescanned);
    expect(result.exitCode).toBe(3);
    expect(result.results.some((item) => item.status === 'orphan')).toBe(true);
    expect(result.findings.map((item) => item.code)).toContain('ORPHAN_ARTIFACT');
    await expect(stat(path.join(root, '.dsh/skills/hello/SKILL.md'))).resolves.toBeDefined();
  });
});
