import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { COMMANDS, run } from '../src/cli.js';
import { HarnessIRSchema } from '../src/core/ir.js';
import { VERSION } from '../src/version.js';
import { capture, cleanup, copyFixture, fixturePath, repoRoot, treeHash } from './helpers.js';

const cwd = repoRoot();
const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

interface ScanPayload {
  readonly kind: string;
  readonly schemaVersion: number;
  readonly ok: boolean;
  readonly root: string;
  readonly findings: ReadonlyArray<{ code: string; severity: string }>;
  readonly inventory: unknown;
  readonly summary: Readonly<Record<string, number>>;
}

function parsePayload(text: string): ScanPayload {
  return JSON.parse(text) as ScanPayload;
}

describe('cli surface', () => {
  it('prints the version and exits 0', async () => {
    const c = capture();
    expect(await run(['--version'], c.io, { cwd })).toBe(0);
    expect(c.out()).toBe(VERSION);
    expect(c.err()).toBe('');
  });

  it('prints help for no arguments and exits 0', async () => {
    const c = capture();
    expect(await run([], c.io, { cwd })).toBe(0);
    expect(c.out()).toContain('Usage:');
  });

  it('lists every planned command in help', async () => {
    const c = capture();
    expect(await run(['--help'], c.io, { cwd })).toBe(0);
    for (const command of COMMANDS) expect(c.out()).toContain(command);
  });

  it('rejects an unknown command with exit 2', async () => {
    const c = capture();
    expect(await run(['frobnicate'], c.io, { cwd })).toBe(2);
    expect(c.out()).toBe('');
    expect(c.err()).toContain('unknown command "frobnicate"');
  });

  it('rejects an unknown flag with exit 2', async () => {
    const c = capture();
    expect(await run(['scan', '--nope'], c.io, { cwd })).toBe(2);
    expect(c.err()).toContain('unknown flag "--nope"');
  });

  it('requires a value for --root', async () => {
    const c = capture();
    expect(await run(['scan', '--root'], c.io, { cwd })).toBe(2);
    expect(c.err()).toContain('--root requires a value');
  });

});

describe('scan command', () => {
  it('prints a deterministic human summary', async () => {
    const c = capture();
    expect(await run(['scan', fixturePath('opencode-basic')], c.io, { cwd })).toBe(0);
    expect(c.out()).toContain('dshify scan fixtures/opencode-basic (opencode adapter 0.1.0)');
    expect(c.out()).toContain('skills    3 (2 copyable, 1 native)');
    expect(c.out()).toContain('commands  1');
    expect(c.out()).toContain('personas  1');
    expect(c.out()).toContain('mcp       1');
    expect(c.err()).toBe('');
  });

  it('prints one schema-valid JSON envelope', async () => {
    const c = capture();
    expect(await run(['scan', fixturePath('opencode-basic'), '--json'], c.io, { cwd })).toBe(0);
    const payload = parsePayload(c.out());
    expect(payload.kind).toBe('scan');
    expect(payload.schemaVersion).toBe(1);
    expect(payload.ok).toBe(true);
    expect(payload.root.endsWith(path.join('fixtures', 'opencode-basic'))).toBe(true);
    expect(payload.summary.skills).toBe(3);
    expect(payload.summary.copyableSkills).toBe(2);
    expect(payload.summary.nativeSkills).toBe(1);
    expect(payload.summary.commands).toBe(1);
    expect(payload.summary.personas).toBe(1);
    expect(payload.summary.mcpServers).toBe(1);
    expect(HarnessIRSchema.parse(payload.inventory)).toBeDefined();
  });

  it('is byte-identical across two runs', async () => {
    const first = capture();
    const second = capture();
    await run(['scan', fixturePath('opencode-basic'), '--json'], first.io, { cwd });
    await run(['scan', fixturePath('opencode-basic'), '--json'], second.io, { cwd });
    expect(first.out()).toBe(second.out());
  });

  it('suppresses human output under --quiet', async () => {
    const c = capture();
    expect(await run(['scan', fixturePath('opencode-basic'), '--quiet'], c.io, { cwd })).toBe(0);
    expect(c.out()).toBe('');
    expect(c.err()).toBe('');
  });

  it('accepts flags that only later stages consume', async () => {
    const c = capture();
    expect(
      await run(
        ['scan', fixturePath('opencode-basic'), '--dest', '.dsh', '--strategy', 'copy'],
        c.io,
        { cwd },
      ),
    ).toBe(0);
  });

  it('reports ROOT_GUESS for a directory without a repository', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dshify-cli-'));
    tempDirs.push(dir);
    const c = capture();
    expect(await run(['scan', dir, '--json'], c.io, { cwd })).toBe(0);
    const payload = parsePayload(c.out());
    expect(payload.findings.map((item) => item.code)).toContain('ROOT_GUESS');
  });

  it('exits 2 for a missing path', async () => {
    const c = capture();
    expect(await run(['scan', path.join(cwd, 'does-not-exist')], c.io, { cwd })).toBe(2);
    expect(c.err()).toContain('does not exist');
  });
});

interface PlanPayload {
  readonly kind: string;
  readonly schemaVersion: number;
  readonly dest: string;
  readonly findings: ReadonlyArray<{ code: string }>;
  readonly artifacts: ReadonlyArray<{
    path: string;
    kind: string;
    status: string;
    sources: readonly string[];
    content: string;
  }>;
  readonly summary: Readonly<Record<string, number>>;
}

describe('plan command', () => {
  it('prints a grouped report and writes nothing', async () => {
    const before = await treeHash(fixturePath('opencode-basic'));
    const c = capture();
    expect(await run(['plan', fixturePath('opencode-basic')], c.io, { cwd })).toBe(0);
    const out = c.out();
    for (const heading of ['Plan', 'Losses', 'Conflicts', 'Next']) {
      expect(out, heading).toContain(heading);
    }
    expect(out).toContain('.dsh/skills/hello/SKILL.md');
    expect(out).toContain('ARGS_SUBSTITUTION');
    expect(await treeHash(fixturePath('opencode-basic'))).toBe(before);
    expect(c.err()).toBe('');
  });

  it('prints a schema-shaped JSON envelope', async () => {
    const c = capture();
    expect(await run(['plan', fixturePath('opencode-basic'), '--json'], c.io, { cwd })).toBe(0);
    const payload = JSON.parse(c.out()) as PlanPayload;
    expect(payload.kind).toBe('plan');
    expect(payload.schemaVersion).toBe(1);
    expect(payload.dest).toBe('.dsh');
    expect(payload.artifacts.map((artifact) => artifact.path)).toContain(
      '.dsh/skills/hello/SKILL.md',
    );
    expect(payload.artifacts.every((artifact) => artifact.status === 'planned')).toBe(true);
    expect(
      payload.artifacts.every((artifact) => artifact.sources.every((source) => !path.isAbsolute(source))),
    ).toBe(true);
    expect(payload.summary.planned).toBe(5);
    expect(payload.summary.conflicts).toBe(0);
    expect(payload.findings.map((item) => item.code)).toContain('ARGS_SUBSTITUTION');
  });

  it('is byte-identical across two runs', async () => {
    const first = capture();
    const second = capture();
    await run(['plan', fixturePath('opencode-basic'), '--json'], first.io, { cwd });
    await run(['plan', fixturePath('opencode-basic'), '--json'], second.io, { cwd });
    expect(first.out()).toBe(second.out());
  });

  it('refuses --presets and --strategy link with exit 5', async () => {
    const presets = capture();
    expect(await run(['plan', fixturePath('opencode-basic'), '--presets'], presets.io, { cwd })).toBe(5);
    expect(presets.err()).toContain('not implemented yet');
    const link = capture();
    expect(
      await run(['plan', fixturePath('opencode-basic'), '--strategy', 'link'], link.io, { cwd }),
    ).toBe(5);
    expect(link.err()).toContain('not implemented yet');
  });

  it('refuses a destination outside the repository with exit 2', async () => {
    const c = capture();
    expect(
      await run(['plan', fixturePath('opencode-basic'), '--dest', '../outside'], c.io, { cwd }),
    ).toBe(2);
    expect(c.err()).toContain('inside the repository');
  });
});

// --------------------------------------------------------------------------
// apply
// --------------------------------------------------------------------------

const fixtureCopies: string[] = [];

async function freshFixture(): Promise<string> {
  const copied = await copyFixture('opencode-basic');
  fixtureCopies.push(copied.parent);
  return copied.root;
}

afterAll(async () => {
  await Promise.all(fixtureCopies.map((parent) => cleanup(parent)));
});

describe('apply command', () => {
  it('writes the surface and lockfile, then reports the summary', async () => {
    const root = await freshFixture();
    const c = capture();
    expect(await run(['apply', root], c.io, { cwd })).toBe(0);
    expect(c.out()).toContain('Apply');
    expect(c.out()).toContain('written');
    expect(c.out()).toContain('Lockfile');
    expect(await readFile(path.join(root, '.dsh/skills/hello/SKILL.md'), 'utf8')).toContain(
      '# /hello',
    );
    expect((await stat(path.join(root, '.dshify.lock.json'))).isFile()).toBe(true);
  });

  it('prints a JSON envelope with statuses', async () => {
    const root = await freshFixture();
    const c = capture();
    expect(await run(['apply', root, '--json'], c.io, { cwd })).toBe(0);
    const payload = JSON.parse(c.out()) as {
      kind: string;
      ok: boolean;
      lockfile: string;
      artifacts: Array<{ path: string; status: string; sources: string[] }>;
      summary: Record<string, number>;
    };
    expect(payload.kind).toBe('apply');
    expect(payload.ok).toBe(true);
    expect(payload.lockfile).toBe('.dshify.lock.json');
    expect(payload.artifacts).toHaveLength(5);
    expect(payload.artifacts.every((artifact) => artifact.status === 'written')).toBe(true);
    expect(payload.summary.written).toBe(5);
    expect(payload.summary.conflicts).toBe(0);
  });

  it('is a no-op on the second run', async () => {
    const root = await freshFixture();
    await run(['apply', root], capture().io, { cwd });
    const lockBefore = await readFile(path.join(root, '.dshify.lock.json'), 'utf8');
    const second = capture();
    expect(await run(['apply', root, '--json'], second.io, { cwd })).toBe(0);
    const payload = JSON.parse(second.out()) as { summary: Record<string, number> };
    expect(payload.summary.unchanged).toBe(5);
    expect(payload.summary.written).toBe(0);
    expect(await readFile(path.join(root, '.dshify.lock.json'), 'utf8')).toBe(lockBefore);
  });

  it('exits 3 on a human edit, preserves it, and --force overwrites', async () => {
    const root = await freshFixture();
    await run(['apply', root], capture().io, { cwd });
    const target = path.join(root, '.dsh/skills/reviewer/SKILL.md');
    await writeFile(target, 'human edit\n');
    const blocked = capture();
    expect(await run(['apply', root], blocked.io, { cwd })).toBe(3);
    expect(blocked.out()).toContain('CONFLICT');
    expect(await readFile(target, 'utf8')).toBe('human edit\n');
    const forced = capture();
    expect(await run(['apply', root, '--force'], forced.io, { cwd })).toBe(0);
    expect(forced.out()).toContain('forced');
    expect(await readFile(target, 'utf8')).toContain('reviewer');
  });

  it('--dry-run writes nothing and behaves like plan', async () => {
    const root = await freshFixture();
    const before = await treeHash(root);
    const c = capture();
    expect(await run(['apply', root, '--dry-run'], c.io, { cwd })).toBe(0);
    expect(c.out()).toContain('Plan');
    expect(await treeHash(root)).toBe(before);
    await expect(stat(path.join(root, '.dsh'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('exits 2 for a missing path', async () => {
    const c = capture();
    expect(await run(['apply', path.join(cwd, 'nope')], c.io, { cwd })).toBe(2);
  });
});

// --------------------------------------------------------------------------
// check / verify
// --------------------------------------------------------------------------

describe('check command', () => {
  it('passes after apply, shows verification, and writes nothing', async () => {
    const root = await freshFixture();
    await run(['apply', root], capture().io, { cwd });
    const before = await treeHash(root);
    const c = capture();
    expect(await run(['check', root], c.io, { cwd })).toBe(0);
    expect(c.out()).toContain('Verification');
    expect(c.out()).toContain('unchanged');
    expect(await treeHash(root)).toBe(before);
  });

  it('exits 4 for a missing artifact', async () => {
    const root = await freshFixture();
    await run(['apply', root], capture().io, { cwd });
    await rm(path.join(root, '.dsh/skills/hello/SKILL.md'));
    const c = capture();
    expect(await run(['check', root], c.io, { cwd })).toBe(4);
    expect(c.out()).toContain('MISSING_ARTIFACT');
  });

  it('exits 3 on a human edit', async () => {
    const root = await freshFixture();
    await run(['apply', root], capture().io, { cwd });
    await writeFile(path.join(root, '.dsh/skills/reviewer/SKILL.md'), 'human edit\n');
    const c = capture();
    expect(await run(['check', root], c.io, { cwd })).toBe(3);
    expect(c.out()).toContain('CONFLICT');
  });

  it('prints a JSON envelope with verification', async () => {
    const root = await freshFixture();
    await run(['apply', root], capture().io, { cwd });
    const c = capture();
    expect(await run(['check', root, '--json'], c.io, { cwd })).toBe(0);
    const payload = JSON.parse(c.out()) as {
      kind: string;
      ok: boolean;
      verification: { visible: unknown[]; roots: string[]; skipped: unknown[] };
      summary: Record<string, number>;
    };
    expect(payload.kind).toBe('check');
    expect(payload.ok).toBe(true);
    expect(payload.verification.roots).toEqual(['.dsh/skills', '.agents/skills']);
    expect(payload.verification.visible).toHaveLength(5);
    expect(payload.verification.skipped).toEqual([]);
    expect(payload.summary.unchanged).toBe(5);
  });
});

describe('verify command', () => {
  it('lists the discovered catalog and exits 0', async () => {
    const root = await freshFixture();
    await run(['apply', root], capture().io, { cwd });
    const c = capture();
    expect(await run(['verify', root], c.io, { cwd })).toBe(0);
    expect(c.out()).toContain('visible  5');
    expect(c.out()).toContain('.dsh/skills/hello/SKILL.md');
  });

  it('prints a JSON envelope', async () => {
    const root = await freshFixture();
    await run(['apply', root], capture().io, { cwd });
    const c = capture();
    expect(await run(['verify', root, '--json'], c.io, { cwd })).toBe(0);
    const payload = JSON.parse(c.out()) as {
      kind: string;
      ok: boolean;
      summary: Record<string, number>;
      verification: { visible: Array<{ name: string }> };
    };
    expect(payload.kind).toBe('verify');
    expect(payload.ok).toBe(true);
    expect(payload.summary.visible).toBe(5);
    expect(payload.verification.visible.map((skill) => skill.name).sort()).toEqual([
      'demo-skill',
      'extra-skill',
      'hello',
      'marketing-demo',
      'reviewer',
    ]);
  });
});
