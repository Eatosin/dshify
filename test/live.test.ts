import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { presetIdentities, probeComposedBundle } from '../src/verify/live.js';

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const PATCH = `- insert:
    - id: preset-agency-main
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: agency-main
        plugins: []
    - id: preset-agency-planner
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: agency-planner
        plugins: []
`;

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dshify-live-test-'));
  roots.push(root);
  await writeFile(path.join(root, 'cordis.patch.yml'), PATCH, 'utf8');
  return root;
}

async function fakeDsh(body: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dshify-fake-dsh-'));
  roots.push(root);
  const file = path.join(root, 'dsh');
  await writeFile(file, `#!/bin/sh\n${body}\n`, 'utf8');
  await chmod(file, 0o755);
  return file;
}

describe('live composition probe', () => {
  it('reads every preset identity from the patch', () => {
    expect(presetIdentities(PATCH)).toEqual([
      { rowId: 'preset-agency-main', presetId: 'agency-main' },
      { rowId: 'preset-agency-planner', presetId: 'agency-planner' },
    ]);
  });

  it('verifies a bundle whose presets appear in the composed tree', async () => {
    const root = await workspace();
    const bin = await fakeDsh(
      [
        'if [ "$1" = "--version" ]; then echo 0.2.2-rc.5; exit 0; fi',
        "printf '%s\\n' '- id: preset-agency-main' '- id: preset-agency-planner'",
      ].join('\n'),
    );
    const result = await probeComposedBundle({
      repoRoot: root,
      patchPath: path.join(root, 'cordis.patch.yml'),
      bin,
    });
    expect(result.status).toBe('verified');
    expect(result.seenPresetIds).toEqual(['agency-main', 'agency-planner']);
    expect(result.findings).toEqual([]);
  });

  it('fails when DSH rejects the patch', async () => {
    const root = await workspace();
    const bin = await fakeDsh('echo "unknown package @deepseek-ai/nope" >&2; exit 1');
    const result = await probeComposedBundle({
      repoRoot: root,
      patchPath: path.join(root, 'cordis.patch.yml'),
      bin,
    });
    expect(result.status).toBe('failed');
    expect(result.findings.map((item) => item.code)).toContain('LIVE_PROBE_FAILED');
  });

  it('fails when a generated preset is missing from the roster', async () => {
    const root = await workspace();
    const bin = await fakeDsh("printf '%s\\n' '- id: preset-agency-main'");
    const result = await probeComposedBundle({
      repoRoot: root,
      patchPath: path.join(root, 'cordis.patch.yml'),
      bin,
    });
    expect(result.status).toBe('failed');
    expect(result.findings.map((item) => item.code)).toContain('LIVE_PRESET_MISSING');
  });

  it('fails closed when dsh is not installed', async () => {
    const root = await workspace();
    const result = await probeComposedBundle({
      repoRoot: root,
      patchPath: path.join(root, 'cordis.patch.yml'),
      bin: path.join(root, 'missing-dsh'),
    });
    expect(result.status).toBe('unverified');
    expect(result.findings.map((item) => item.code)).toContain('LIVE_UNVERIFIED');
  });
});
