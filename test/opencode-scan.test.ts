import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { HarnessIRSchema, type HarnessIR } from '../src/core/ir.js';
import { sortFindings } from '../src/core/report.js';
import { scanRepo } from '../src/core/scan.js';
import { DEFAULT_SCAN_LIMITS } from '../src/core/source.js';
import { cleanup, copyFixture, fixturePath } from './helpers.js';

const limits = DEFAULT_SCAN_LIMITS;
const tempParents: string[] = [];

afterAll(async () => {
  await Promise.all(tempParents.map((parent) => cleanup(parent)));
});

async function scanFixture(): Promise<HarnessIR> {
  return scanRepo({ root: fixturePath('opencode-basic'), extraRoots: [], limits });
}

async function mutatedFixture(): Promise<string> {
  const { parent, root } = await copyFixture('opencode-basic');
  tempParents.push(parent);
  return root;
}

describe('opencode scan — acceptance criterion 1', () => {
  it('inventories the fixture exactly as spec §13.1 describes', async () => {
    const ir = await scanFixture();
    expect(ir.harness).toBe('opencode');
    expect(ir.skills.map((skill) => skill.id)).toEqual([
      'demo-skill',
      'extra-skill',
      'marketing-demo',
    ]);
    expect(ir.commands.map((command) => command.name)).toEqual(['hello']);
    expect(ir.personas.map((persona) => persona.id)).toEqual(['reviewer']);
    expect(ir.mcpServers.map((server) => server.name)).toEqual(['demo-remote']);
    expect(ir.agentsMd).toBeDefined();
  });

  it('distinguishes default, configured and already-native skill roots', async () => {
    const ir = await scanFixture();
    expect(ir.skills.map((skill) => skill.provenance.rootKind)).toEqual([
      'default',
      'configured',
      'native',
    ]);
    expect(ir.warnings.map((warning) => warning.code)).toContain('DSH_NATIVE_ROOT');
  });

  it('produces IR that validates against the schema', async () => {
    const ir = await scanFixture();
    expect(HarnessIRSchema.parse(ir)).toEqual(ir);
  });

  it('copies resource references relative to the skill directory', async () => {
    const ir = await scanFixture();
    const demo = ir.skills.find((skill) => skill.id === 'demo-skill');
    expect(demo?.resources).toEqual(['references/example.md']);
    expect(demo?.body).toContain('Use this skill to prove');
    expect(demo?.capability).toBe('exact');
    expect(demo?.invocation).toEqual({ model: true, user: true });
  });

  it('reads command arguments and the source routing hint', async () => {
    const ir = await scanFixture();
    const hello = ir.commands.find((command) => command.name === 'hello');
    expect(hello?.placeholders).toEqual(['arguments']);
    expect(hello?.targetAgent).toBe('build');
    expect(hello?.capability).toBe('adapted');
    expect(hello?.body).toContain('$ARGUMENTS');
  });

  it('converts an edit-deny subagent to a read-only persona', async () => {
    const ir = await scanFixture();
    const reviewer = ir.personas.find((persona) => persona.id === 'reviewer');
    expect(reviewer?.access).toBe('read-only');
    expect(reviewer?.body).toContain('strict reviewer');
  });

  it('preserves the remote MCP server and its disabled flag', async () => {
    const ir = await scanFixture();
    const server = ir.mcpServers.find((candidate) => candidate.name === 'demo-remote');
    expect(server?.transport).toBe('streamable-http');
    expect(server?.url).toBe('https://mcp.example.test/mcp');
    expect(server?.disabled).toBe(true);
    expect(server?.auth).toBe('none');
    const codes = ir.warnings.map((warning) => warning.code);
    expect(codes).toContain('MCP_REMOTE');
    expect(codes).toContain('MCP_DISABLED');
  });

  it('hashes the include file it reports but never touches', async () => {
    const ir = await scanFixture();
    const bytes = await readFile(path.join(fixturePath('opencode-basic'), 'AGENTS.md'));
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(ir.agentsMd?.sha256).toBe(digest);
    expect(ir.agentsMd?.rootKind).toBe('repo');
    expect(ir.warnings.map((warning) => warning.code)).toContain('AGENTS_MD_SHARED');
  });

  it('emits findings in deterministic order and no absolute paths', async () => {
    const ir = await scanFixture();
    expect(ir.warnings).toEqual(sortFindings(ir.warnings));
    for (const warning of ir.warnings) {
      if (warning.path !== undefined) {
        expect(path.isAbsolute(warning.path), `absolute finding path: ${warning.path}`).toBe(
          false,
        );
      }
    }
  });

  it('is deterministic across two scans', async () => {
    expect(await scanFixture()).toEqual(await scanFixture());
  });
});

describe('opencode scan — malformed and missing input', () => {
  it('reports a skill without a description and does not emit it', async () => {
    const root = await mutatedFixture();
    await writeFile(
      path.join(root, '.opencode/skills/demo-skill/SKILL.md'),
      '---\nname: demo-skill\n---\n\nbody\n',
      'utf8',
    );
    const ir = await scanRepo({ root, extraRoots: [], limits });
    expect(ir.skills.map((skill) => skill.id)).not.toContain('demo-skill');
    expect(
      ir.warnings.some(
        (warning) =>
          warning.code === 'MALFORMED_SKILL' && warning.path?.includes('demo-skill') === true,
      ),
    ).toBe(true);
  });

  it('reports a frontmatter name that does not match its directory', async () => {
    const root = await mutatedFixture();
    await writeFile(
      path.join(root, 'skills/extra-skill/SKILL.md'),
      '---\nname: different-name\ndescription: mismatch\n---\n\nbody\n',
      'utf8',
    );
    const ir = await scanRepo({ root, extraRoots: [], limits });
    expect(ir.skills.map((skill) => skill.id)).not.toContain('different-name');
    expect(ir.skills.map((skill) => skill.id)).not.toContain('extra-skill');
    expect(ir.warnings.some((warning) => warning.code === 'MALFORMED_SKILL')).toBe(true);
  });

  it('warns on a configured root that does not exist, without failing', async () => {
    const root = await mutatedFixture();
    await rm(path.join(root, 'skills'), { recursive: true, force: true });
    const ir = await scanRepo({ root, extraRoots: [], limits });
    expect(ir.skills.map((skill) => skill.id)).toEqual(['demo-skill', 'marketing-demo']);
    expect(ir.warnings.some((warning) => warning.code === 'MISSING_ROOT')).toBe(true);
  });

  it('does not discover nested skill bundles', async () => {
    const root = await mutatedFixture();
    await mkdir(path.join(root, '.opencode/skills/demo-skill/nested'), { recursive: true });
    await writeFile(
      path.join(root, '.opencode/skills/demo-skill/nested/SKILL.md'),
      '---\nname: nested\ndescription: nested bundle\n---\n\nbody\n',
      'utf8',
    );
    const ir = await scanRepo({ root, extraRoots: [], limits });
    expect(ir.skills.map((skill) => skill.id)).not.toContain('nested');
  });

  it('reports plugin surfaces without reading them', async () => {
    const root = await mutatedFixture();
    await mkdir(path.join(root, '.opencode/plugin'), { recursive: true });
    await writeFile(path.join(root, '.opencode/plugin/index.ts'), 'throw new Error("never run");\n');
    const ir = await scanRepo({ root, extraRoots: [], limits });
    expect(ir.warnings.some((warning) => warning.code === 'PLUGIN_UNSUPPORTED')).toBe(true);
  });

  it('fails the scan when the item budget is exceeded', async () => {
    await expect(
      scanRepo({
        root: fixturePath('opencode-basic'),
        extraRoots: [],
        limits: { maxFileBytes: limits.maxFileBytes, maxItems: 1 },
      }),
    ).rejects.toMatchObject({ exitCode: 1 });
  });
});
