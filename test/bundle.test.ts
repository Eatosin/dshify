import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
import { applyRepo } from '../src/core/apply.js';
import { checkRepo } from '../src/core/check.js';
import type { Artifact, HarnessIR } from '../src/core/ir.js';
import { planRepo } from '../src/core/plan.js';
import { scanRepo } from '../src/core/scan.js';
import { DEFAULT_SCAN_LIMITS, readSourceBytes } from '../src/core/source.js';
import { cleanup, copyFixture, fixturePath, repoRoot } from './helpers.js';

const limits = DEFAULT_SCAN_LIMITS;
const repo = repoRoot();
const tempParents: string[] = [];

afterAll(async () => {
  await Promise.all(tempParents.map((parent) => cleanup(parent)));
});

async function scanned(name: string, root?: string): Promise<HarnessIR> {
  return scanRepo({ root: root ?? fixturePath(name), extraRoots: [], limits });
}

async function planned(name: string, overrides: Record<string, unknown> = {}) {
  const ir = await scanned(name);
  const output = await planRepo(ir, {
    repoRoot: repo,
    dest: '.dsh',
    presets: true,
    strategy: 'copy',
    version: '0.1.0',
    readResource: (absolute) => readSourceBytes(absolute, limits),
    ...overrides,
  });
  return { ir, planned: output };
}

function textOf(artifact: Artifact | undefined): string {
  return new TextDecoder().decode(artifact?.bytes ?? new Uint8Array());
}

function harnessArtifact(artifacts: readonly Artifact[], suffix: string): Artifact {
  const found = artifacts.find((artifact) => artifact.path === `.dsh/harness/${suffix}`);
  expect(found, suffix).toBeDefined();
  return found as Artifact;
}

/** Drop the loader tag so the structural YAML can be parsed here. */
function parsePatch(text: string): { insert: Array<Record<string, unknown>> } {
  return parseYaml(text.replace(/!!js /g, '')) as { insert: Array<Record<string, unknown>> };
}

interface Row {
  readonly id?: string;
  readonly name?: string;
  readonly disabled?: boolean;
  readonly config?: Readonly<Record<string, unknown>>;
}

describe('preset bundle — manifest and patch', () => {
  it('emits a dependency-free bundle manifest that declares the patch', async () => {
    const { planned: bundle } = await planned('opencode-basic');
    const manifest = JSON.parse(textOf(harnessArtifact(bundle.artifacts, 'package.json'))) as {
      version: string;
      private?: boolean;
      dependencies?: unknown;
      dsh?: { bundle?: { patch?: string } };
    };
    expect(manifest.version).toBe('0.1.0');
    expect(manifest.private).toBe(true);
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml');
  });

  it('mirrors the standard preset with the persona as the prefix', async () => {
    const { planned: bundle } = await planned('opencode-basic');
    const raw = textOf(harnessArtifact(bundle.artifacts, 'cordis.patch.yml'));
    expect(raw).toContain("!!js process.platform === 'win32'");
    expect(raw).toContain("!!js process.platform !== 'win32'");

    const patch = parsePatch(raw);
    expect(patch.insert).toHaveLength(1);
    const preset = patch.insert[0] as {
      id: string;
      config: { id: string; order: number; plugins: Row[] };
    };
    expect(preset.id).toBe('preset-reviewer');
    expect(preset.config.id).toBe('reviewer');
    expect(preset.config.order).toBe(100);
    const plugins = preset.config.plugins;
    const persona = plugins.find((row) => row.id === 'persona');
    expect(persona?.name).toBe('@deepseek-ai/dsh-persona');
    expect(String(persona?.config?.['prefix'])).toContain('strict reviewer');
    const fsRow = plugins.find((row) => row.id === 'tool-fs');
    expect(fsRow?.config).toEqual({ read: true, write: false, edit: false, applyPatch: false });
    const mcp = plugins.find((row) => row.id === 'mcp-demo-remote');
    expect(mcp?.name).toBe('@deepseek-ai/dsh-mcp-client');
    expect(mcp?.config).toEqual({
      serverName: 'demo-remote',
      transport: 'streamable-http',
      url: 'https://mcp.example.test/mcp',
    });
    expect(mcp?.disabled).toBe(true);
    for (const id of ['agent-instructions', 'tool-bash', 'tool-fs-search', 'skill-filesystem', 'compaction', 'delegation']) {
      expect(plugins.some((row) => row.id === id), id).toBe(true);
    }
  });

  it('keeps write/edit enabled for a writable persona', async () => {
    const { planned: bundle } = await planned('opencode-mcp-auth');
    const patch = parsePatch(textOf(harnessArtifact(bundle.artifacts, 'cordis.patch.yml')));
    const plugins = (patch.insert[0] as { config: { plugins: Row[] } }).config.plugins;
    expect(plugins.find((row) => row.id === 'tool-fs')?.config).toEqual({ applyPatch: false });
  });

  it('emits disabled MCP rows and never exposes a secret', async () => {
    const { planned: bundle } = await planned('opencode-mcp-auth');
    const raw = textOf(harnessArtifact(bundle.artifacts, 'cordis.patch.yml'));
    expect(raw).not.toContain('MCP_TOKEN');
    expect(raw).not.toContain('Authorization');
    expect(raw).not.toContain('example-client');
    const patch = parsePatch(raw);
    const plugins = (patch.insert[0] as { config: { plugins: Row[] } }).config.plugins;
    const mcpRows = plugins.filter((row) => String(row.id).startsWith('mcp-'));
    expect(mcpRows.map((row) => row.id)).toEqual([
      'mcp-disabled-stdio',
      'mcp-env-header',
      'mcp-oauth-remote',
    ]);
    expect(mcpRows.every((row) => row.disabled === true)).toBe(true);
  });

  it('is byte-deterministic across two plans', async () => {
    const first = await planned('opencode-basic');
    const second = await planned('opencode-basic');
    for (const suffix of ['package.json', 'cordis.patch.yml']) {
      expect(textOf(harnessArtifact(first.planned.artifacts, suffix))).toBe(
        textOf(harnessArtifact(second.planned.artifacts, suffix)),
      );
    }
  });
});

describe('preset bundle — apply and check', () => {
  it('writes the harness bundle, records it in the lockfile, and still verifies', async () => {
    const { parent, root } = await copyFixture('opencode-basic');
    tempParents.push(parent);
    const ir = await scanned('opencode-basic', root);
    const applied = await applyRepo(ir, {
      repoRoot: root,
      dest: '.dsh',
      lockfilePath: '.dshify.lock.json',
      presets: true,
      strategy: 'copy',
      force: false,
      version: '0.1.0',
      readResource: (absolute) => readSourceBytes(absolute, limits),
    });
    expect(applied.ok).toBe(true);
    expect(await readFile(path.join(root, '.dsh/harness/cordis.patch.yml'), 'utf8')).toContain(
      'preset-reviewer',
    );
    const lockText = await readFile(path.join(root, '.dshify.lock.json'), 'utf8');
    expect(lockText).toContain('.dsh/harness/cordis.patch.yml');
    expect(lockText).not.toContain(root);

    const checked = await checkRepo(ir, {
      repoRoot: root,
      dest: '.dsh',
      lockfilePath: '.dshify.lock.json',
      presets: true,
      strategy: 'copy',
      readResource: (absolute) => readSourceBytes(absolute, limits),
      limits,
      version: '0.1.0',
    });
    expect(checked.exitCode).toBe(0);
  });

  it('keeps secrets out of the lockfile for auth-bearing MCP servers', async () => {
    const { parent, root } = await copyFixture('opencode-mcp-auth');
    tempParents.push(parent);
    const ir = await scanned('opencode-mcp-auth', root);
    await applyRepo(ir, {
      repoRoot: root,
      dest: '.dsh',
      lockfilePath: '.dshify.lock.json',
      presets: true,
      strategy: 'copy',
      force: false,
      version: '0.1.0',
      readResource: (absolute) => readSourceBytes(absolute, limits),
    });
    const lockText = await readFile(path.join(root, '.dshify.lock.json'), 'utf8');
    expect(lockText).not.toContain('MCP_TOKEN');
    expect(lockText).not.toContain('Authorization');
    expect(lockText).not.toContain('example-client');
  });
});
