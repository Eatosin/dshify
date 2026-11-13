import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
import type { Artifact, HarnessIR } from '../src/core/ir.js';
import { planRepo } from '../src/core/plan.js';
import { scanRepo } from '../src/core/scan.js';
import { DEFAULT_SCAN_LIMITS, readSourceBytes } from '../src/core/source.js';

const limits = DEFAULT_SCAN_LIMITS;
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const FILES: Record<string, string> = {
  'AGENTS.md': '# Test\n',
  '.opencode/skills/alpha/SKILL.md':
    '---\nname: alpha\ndescription: Alpha skill.\nwhenToUse: Use when testing alpha.\n---\n\nAlpha body.\n',
  '.opencode/agents/reviewer.md':
    '---\ndescription: Reviews code.\nmodel: opencode-go/deepseek-v4-pro\npermissions:\n  - action: edit\n    resource: "*"\n    effect: deny\n---\n\nRead-only reviewer.\n',
  '.opencode/agents/writer.md':
    '---\ndescription: Writes code.\nmodel: opencode-go/deepseek-v4-flash\n---\n\nWritable writer.\n',
  '.opencode/agents/solo.md':
    '---\ndescription: A persona with no DSH route.\nmodel: opencode-go/glm-5.3\n---\n\nSolo worker.\n',
  '.opencode/commands/review.md':
    '---\ndescription: Review it.\nagent: reviewer\nsubagent: true\n---\n\nReview the change. $ARGUMENTS\n',
  '.opencode/opencode.json': JSON.stringify({
    instructions: ['docs/README.md'],
    mcp: {
      servers: {
        local: {
          type: 'local',
          command: ['node', 'server.js'],
          env: { PATH: '/usr/bin', API_TOKEN: 'do-not-copy' },
          cwd: '/tmp/work',
        },
      },
    },
  }),
  '.opencode/plugins/tools.ts':
    "editor.add({ name: 'eval_gate', description: 'Run the eval gate.', input: {} })\n",
};

const ROUTES = [
  { persona: 'reviewer', tool: 'subagent_reviewer', provider: 'deepseek-official', model: 'deepseek-v4-pro' },
  { persona: 'writer', tool: 'subagent_writer', provider: 'deepseek-official', model: 'deepseek-flash' },
];

async function scenario(): Promise<{ ir: HarnessIR; artifacts: Artifact[]; losses: HarnessIR['warnings'] }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dshify-v2-'));
  roots.push(root);
  for (const [relative, text] of Object.entries(FILES)) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, text, 'utf8');
  }
  const ir = await scanRepo({ root, extraRoots: [], limits });
  const planned = await planRepo(ir, {
    repoRoot: root,
    dest: '.dsh',
    presets: true,
    strategy: 'copy',
    version: '0.2.0',
    presetPrefix: 'agency-',
    delegation: ROUTES,
    mainPreset: { id: 'agency-main', name: 'Main' },
    extraPlugins: ['./tools/index.js'],
    readResource: (absolute) => readSourceBytes(absolute, limits),
  });
  return { ir, artifacts: [...planned.artifacts], losses: planned.losses as HarnessIR['warnings'] };
}

function textOf(artifacts: readonly Artifact[], suffix: string): string {
  const artifact = artifacts.find((item) => item.path.endsWith(suffix));
  expect(artifact, suffix).toBeDefined();
  return new TextDecoder().decode(artifact!.bytes);
}

interface Row {
  readonly id?: string;
  readonly name?: string;
  readonly disabled?: boolean;
  readonly config?: Record<string, unknown>;
}

interface PresetRow {
  readonly id: string;
  readonly config: { id: string; plugins: Row[] };
}

function patchRows(artifacts: readonly Artifact[]): PresetRow[] {
  const raw = textOf(artifacts, 'cordis.patch.yml').replace(/!!js /g, '');
  const document = parseYaml(raw) as unknown;
  expect(Array.isArray(document)).toBe(true);
  const entries = (document as Array<{ insert?: PresetRow[] }>)[0];
  return entries?.insert ?? [];
}

function pluginsOf(rows: readonly PresetRow[], id: string): Row[] {
  const preset = rows.find((row) => row.config.id === id);
  expect(preset, id).toBeDefined();
  return preset!.config.plugins;
}

describe('v0.2 preset bundle', () => {
  it('emits a parent preset with model-routed delegation tools', async () => {
    const { artifacts } = await scenario();
    const rows = patchRows(artifacts);
    expect(rows.map((row) => row.id).sort()).toEqual([
      'preset-agency-main',
      'preset-agency-reviewer',
      'preset-agency-solo',
      'preset-agency-writer',
    ]);
    const plugins = pluginsOf(rows, 'agency-main');
    const delegation = plugins.find((row) => row.id === 'delegation');
    expect(delegation).toBeDefined();
    const children = (delegation!.config as unknown as Row[]) ?? [];
    const reviewer = children.find((row) => row.id === 'tool-delegate-reviewer');
    expect(reviewer?.config).toMatchObject({
      provider: 'spawn',
      toolName: 'subagent_reviewer',
      agentPreset: 'agency-reviewer',
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    });
    const writer = children.find((row) => row.id === 'tool-delegate-writer');
    expect(writer?.config).toMatchObject({ agentPreset: 'agency-writer' });
    const generic = children.find((row) => row.id === 'tool-subagent');
    expect((generic?.config as Record<string, unknown>)['allowedAgentPresets']).toEqual([
      'agency-reviewer',
      'agency-solo',
      'agency-writer',
    ]);
  });

  it('adds bundle-local plugin rows relative to the patch', async () => {
    const { artifacts } = await scenario();
    const plugin = pluginsOf(patchRows(artifacts), 'agency-main').find((row) => row.id === 'extra-plugin-1');
    expect(plugin?.name).toBe('./tools/index.js');
  });

  it('keeps child presets free of delegation so they cannot recurse', async () => {
    const { artifacts } = await scenario();
    const rows = patchRows(artifacts);
    for (const id of ['agency-reviewer', 'agency-writer', 'agency-solo']) {
      expect(pluginsOf(rows, id).some((row) => row.id === 'delegation')).toBe(false);
    }
  });

  it('preserves whenToUse and routes commands to the named tool', async () => {
    const { artifacts } = await scenario();
    const alpha = textOf(artifacts, 'skills/alpha/SKILL.md');
    expect(alpha).toContain('whenToUse: Use when testing alpha.');
    const review = textOf(artifacts, 'skills/review/SKILL.md');
    expect(review).toContain('subagent_reviewer');
    expect(review).not.toContain('Start by loading the `reviewer` skill.');
  });

  it('passes non-secret MCP env and cwd, and never a secret', async () => {
    const { artifacts } = await scenario();
    const rows = patchRows(artifacts);
    const mcp = pluginsOf(rows, 'agency-main').find((row) => row.id === 'mcp-local');
    expect(mcp?.config).toMatchObject({ env: { PATH: '/usr/bin' }, cwd: '/tmp/work' });
    const raw = textOf(artifacts, 'cordis.patch.yml');
    expect(raw).not.toContain('do-not-copy');
    expect(raw).not.toContain('API_TOKEN');
  });

  it('emits a plugin port manifest', async () => {
    const { artifacts } = await scenario();
    const manifest = textOf(artifacts, 'PLUGINS.md');
    expect(manifest).toContain('eval_gate');
    expect(manifest).toContain('.opencode/plugins');
  });

  it('reports extra instruction files and unmapped model hints', async () => {
    const { ir, losses } = await scenario();
    expect(ir.extraInstructions).toEqual(['docs/README.md']);
    expect(ir.warnings.map((finding) => finding.code)).toContain('INSTRUCTIONS_EXTRA_UNMAPPED');
    const codes = losses.map((finding) => finding.code);
    expect(codes).toContain('MODEL_ROUTE_UNMAPPED');
    expect(codes).toContain('PRESET_PROFILE_GLOBAL');
  });
});
