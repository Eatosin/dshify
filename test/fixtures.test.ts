import { describe, expect, it } from 'vitest';
import type { HarnessIR } from '../src/core/ir.js';
import { planRepo } from '../src/core/plan.js';
import { scanRepo } from '../src/core/scan.js';
import { DEFAULT_SCAN_LIMITS, readSourceBytes } from '../src/core/source.js';
import { fixturePath, repoRoot } from './helpers.js';

const limits = DEFAULT_SCAN_LIMITS;
const repo = repoRoot();

async function scanFixture(name: string): Promise<HarnessIR> {
  return scanRepo({ root: fixturePath(name), extraRoots: [], limits });
}

function planOf(ir: HarnessIR) {
  return planRepo(ir, {
    repoRoot: repo,
    dest: '.dsh',
    presets: false,
    strategy: 'copy',
    version: '0.1.0',
    readResource: (absolute) => readSourceBytes(absolute, limits),
  });
}

describe('fixture — opencode-collisions', () => {
  it('scans every unit, including the colliding ones', async () => {
    const ir = await scanFixture('opencode-collisions');
    expect(ir.skills.map((skill) => skill.id)).toEqual(['reviewer']);
    expect(ir.commands.map((command) => command.name)).toEqual(['plan', 'reviewer']);
    expect(ir.personas.map((persona) => persona.id)).toEqual(['reviewer']);
    expect(ir.warnings.map((warning) => warning.code)).toContain('UNKNOWN_FIELD');
  });

  it('renames every collision deterministically and reports it', async () => {
    const planned = await planOf(await scanFixture('opencode-collisions'));
    expect(planned.artifacts.map((artifact) => artifact.path)).toEqual([
      '.dsh/skills/plan-command/SKILL.md',
      '.dsh/skills/reviewer-2/SKILL.md',
      '.dsh/skills/reviewer-persona/SKILL.md',
      '.dsh/skills/reviewer/SKILL.md',
    ]);
    const codes = planned.losses.map((loss) => loss.code);
    expect(codes).toContain('HOST_COMMAND_COLLISION');
    expect(planned.losses.filter((loss) => loss.code === 'NAME_COLLISION')).toHaveLength(2);
  });
});

describe('fixture — opencode-malformed', () => {
  it('reports each malformed unit and still converts the valid neighbour', async () => {
    const ir = await scanFixture('opencode-malformed');
    expect(ir.skills.map((skill) => skill.id)).toEqual(['valid']);
    const codes = ir.warnings.map((warning) => warning.code);
    expect(codes).toContain('MALFORMED_SKILL');
    expect(codes).toContain('MALFORMED_COMMAND');
    expect(codes).toContain('MALFORMED_PERSONA');
    expect(codes).toContain('MISSING_ROOT');
    expect(ir.skills.some((skill) => skill.id === 'nested')).toBe(false);

    const planned = await planOf(ir);
    expect(planned.artifacts.map((artifact) => artifact.path)).toEqual([
      '.dsh/skills/valid/SKILL.md',
    ]);
  });
});

describe('fixture — opencode-mcp-auth', () => {
  it('classifies auth, skips an invalid name and never carries a secret', async () => {
    const ir = await scanFixture('opencode-mcp-auth');
    expect(ir.mcpServers.map((server) => server.name)).toEqual([
      'disabled-stdio',
      'env-header',
      'oauth-remote',
    ]);
    const byName = new Map(ir.mcpServers.map((server) => [server.name, server]));
    expect(byName.get('oauth-remote')?.auth).toBe('oauth');
    expect(byName.get('oauth-remote')?.disabled).toBe(true);
    expect(byName.get('oauth-remote')?.capability).toBe('manual');
    expect(byName.get('env-header')?.auth).toBe('header');
    expect(byName.get('env-header')?.disabled).toBe(true);
    expect(byName.get('disabled-stdio')?.transport).toBe('stdio');
    expect(byName.get('disabled-stdio')?.command).toBe('node');
    expect(byName.get('disabled-stdio')?.args).toEqual(['server.js']);

    const codes = ir.warnings.map((warning) => warning.code);
    expect(codes.filter((code) => code === 'MCP_AUTH_MANUAL')).toHaveLength(2);
    expect(codes).toContain('MCP_INVALID_NAME');

    const serialized = JSON.stringify(ir);
    expect(serialized).not.toContain('MCP_TOKEN');
    expect(serialized).not.toContain('example-client');
    expect(serialized).not.toContain('Authorization');

    expect(ir.personas.map((persona) => persona.id)).toEqual(['operator']);
    expect(ir.personas[0]?.access).toBe('writable');
  });
});
