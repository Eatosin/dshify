import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { COMMANDS, run } from '../src/cli.js';
import { HarnessIRSchema } from '../src/core/ir.js';
import { VERSION } from '../src/version.js';
import { capture, fixturePath, repoRoot } from './helpers.js';

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

  it('reports known but unimplemented commands with exit 1', async () => {
    for (const command of ['plan', 'apply', 'check', 'verify']) {
      const c = capture();
      expect(await run([command], c.io, { cwd })).toBe(1);
      expect(c.err()).toContain('not implemented yet');
    }
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
