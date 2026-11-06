import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HarnessIR } from '../src/core/ir.js';
import { planRepo } from '../src/core/plan.js';
import { scanRepo } from '../src/core/scan.js';
import { DEFAULT_SCAN_LIMITS, readSourceBytes } from '../src/core/source.js';
import { fixturePath, repoRoot, treeHash } from './helpers.js';

const limits = DEFAULT_SCAN_LIMITS;
const repo = repoRoot();
const fixture = fixturePath('opencode-basic');
const SHA = 'a'.repeat(64);

async function scanFixture(): Promise<HarnessIR> {
  return scanRepo({ root: fixture, extraRoots: [], limits });
}

function planOf(ir: HarnessIR, overrides: Partial<Parameters<typeof planRepo>[1]> = {}) {
  return planRepo(ir, {
    repoRoot: repo,
    dest: '.dsh',
    presets: false,
    strategy: 'copy',
    readResource: (absolute) => readSourceBytes(absolute, limits),
    ...overrides,
  });
}

async function planFixture(overrides: Partial<Parameters<typeof planRepo>[1]> = {}) {
  return planOf(await scanFixture(), overrides);
}

function prov(relativePath: string) {
  return {
    path: path.join(repo, relativePath),
    sha256: SHA,
    adapter: 'opencode',
    rootKind: 'default' as const,
  };
}

function syntheticIR(): HarnessIR {
  return {
    harness: 'opencode',
    version: '0.1.0',
    root: repo,
    skills: [
      {
        id: 'shared',
        description: 'A skill named shared.',
        body: '\nShared body.\n',
        invocation: { model: true, user: true },
        resources: [],
        provenance: prov('.opencode/skills/shared/SKILL.md'),
        capability: 'exact',
      },
    ],
    commands: [
      {
        name: 'shared',
        description: 'A command named shared.',
        body: '\nDo $ARGUMENTS.\n',
        placeholders: ['arguments'],
        provenance: prov('.opencode/commands/shared.md'),
        capability: 'adapted',
      },
      {
        name: 'plan',
        description: 'A command that collides with a host command.',
        body: '\nPlan things.\n',
        placeholders: [],
        provenance: prov('.opencode/commands/plan.md'),
        capability: 'adapted',
      },
    ],
    personas: [
      {
        id: 'shared',
        description: 'A persona named shared.',
        body: '\nPersona body.\n',
        access: 'writable',
        provenance: prov('.opencode/agents/shared.md'),
        capability: 'adapted',
      },
    ],
    mcpServers: [],
    warnings: [],
  };
}

function textOf(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe('plan — artifacts', () => {
  it('emits the copyable skills, the command, the persona and the resource', async () => {
    const planned = await planFixture();
    expect(planned.artifacts.map((artifact) => artifact.path)).toEqual([
      '.dsh/skills/demo-skill/SKILL.md',
      '.dsh/skills/demo-skill/references/example.md',
      '.dsh/skills/extra-skill/SKILL.md',
      '.dsh/skills/hello/SKILL.md',
      '.dsh/skills/reviewer/SKILL.md',
    ]);
    expect(planned.artifacts.map((artifact) => artifact.kind)).toEqual([
      'skill',
      'skill-resource',
      'skill',
      'command-skill',
      'persona-skill',
    ]);
  });

  it('does not duplicate the already-native .agents skill', async () => {
    const planned = await planFixture();
    expect(planned.artifacts.some((artifact) => artifact.path.includes('marketing-demo'))).toBe(
      false,
    );
  });

  it('copies a resource byte for byte', async () => {
    const planned = await planFixture();
    const resource = planned.artifacts.find((artifact) => artifact.kind === 'skill-resource');
    expect(resource).toBeDefined();
    const source = await readSourceBytes(
      path.join(fixture, '.opencode/skills/demo-skill/references/example.md'),
      limits,
    );
    expect(Buffer.compare(Buffer.from(resource?.bytes ?? []), source)).toBe(0);
  });

  it('preserves a copied skill body with regenerated frontmatter', async () => {
    const planned = await planFixture();
    const skill = planned.artifacts.find(
      (artifact) => artifact.path === '.dsh/skills/demo-skill/SKILL.md',
    );
    const text = textOf(skill?.bytes ?? new Uint8Array());
    expect(text.startsWith('---\nname: demo-skill\ndescription: ')).toBe(true);
    expect(text).toContain('user-invocable: true\n---\n\n# Demo skill');
    expect(text).toContain('Use this skill to prove directory bundles');
  });

  it('emits a command as a user-invocable skill with prose arguments', async () => {
    const planned = await planFixture();
    const command = planned.artifacts.find(
      (artifact) => artifact.path === '.dsh/skills/hello/SKILL.md',
    );
    const text = textOf(command?.bytes ?? new Uint8Array());
    expect(text).toContain('disable-model-invocation: true');
    expect(text).toContain('user-invocable: true');
    expect(text).toContain('# /hello');
    expect(text).toContain("The text you type after the `/hello` token is this command's argument.");
    expect(text).not.toContain('$ARGUMENTS');
    expect(text).toContain('the argument');
  });

  it('emits a read-only persona with the harness note', async () => {
    const planned = await planFixture();
    const persona = planned.artifacts.find(
      (artifact) => artifact.path === '.dsh/skills/reviewer/SKILL.md',
    );
    const text = textOf(persona?.bytes ?? new Uint8Array());
    expect(text).toContain('You are the `reviewer` specialist.');
    expect(text).toContain('Read-only mode: report the needed edit as a patch.');
    expect(text).not.toContain('disable-model-invocation');
  });
});

describe('plan — misses', () => {
  it('reports the documented losses for the fixture', async () => {
    const planned = await planFixture();
    const codes = planned.losses.map((loss) => loss.code);
    for (const expected of [
      'ARGS_SUBSTITUTION',
      'COMMAND_AGENT_ROUTING',
      'EDIT_DENY_ADAPTED',
      'MCP_PRESETS_REQUIRED',
      'SUBAGENT_ISOLATION',
    ]) {
      expect(codes, expected).toContain(expected);
    }
    expect(planned.conflicts).toEqual([]);
  });

  it('leaks no absolute path or timestamp into artifact bytes', async () => {
    const planned = await planFixture();
    for (const artifact of planned.artifacts) {
      const text = textOf(artifact.bytes);
      expect(text.includes(repo), artifact.path).toBe(false);
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('keeps loss paths repo-relative', async () => {
    const planned = await planFixture();
    for (const loss of planned.losses) {
      if (loss.path !== undefined) expect(path.isAbsolute(loss.path)).toBe(false);
    }
  });
});

describe('plan — naming and collisions', () => {
  it('renames a host-command collision and reports it', async () => {
    const planned = await planOf(syntheticIR());
    const paths = planned.artifacts.map((artifact) => artifact.path);
    expect(paths).toContain('.dsh/skills/plan-command/SKILL.md');
    expect(planned.losses.some((loss) => loss.code === 'HOST_COMMAND_COLLISION')).toBe(true);
  });

  it('suffixes cross-kind collisions deterministically', async () => {
    const planned = await planOf(syntheticIR());
    const names = planned.artifacts.map((artifact) =>
      artifact.path.split('/').slice(-2, -1)[0] ?? '',
    );
    expect(names).toContain('shared');
    expect(names).toContain('shared-2');
    expect(names).toContain('shared-persona');
    expect(planned.losses.filter((loss) => loss.code === 'NAME_COLLISION')).toHaveLength(2);
  });
});

describe('plan — guarantees', () => {
  it('writes nothing (fixture tree hash is unchanged)', async () => {
    const before = await treeHash(fixture);
    await planFixture();
    await planFixture({ presets: false });
    expect(await treeHash(fixture)).toBe(before);
  });

  it('is deterministic across two plans', async () => {
    const first = await planFixture();
    const second = await planFixture();
    expect(first.artifacts.map((artifact) => [artifact.path, textOf(artifact.bytes)])).toEqual(
      second.artifacts.map((artifact) => [artifact.path, textOf(artifact.bytes)]),
    );
    expect(first.losses).toEqual(second.losses);
  });

  it('refuses a destination outside the repository', async () => {
    const ir = await scanFixture();
    await expect(planOf(ir, { dest: '../outside' })).rejects.toMatchObject({ exitCode: 2 });
    await expect(planOf(ir, { dest: '.' })).rejects.toMatchObject({ exitCode: 2 });
  });

  it('refuses the not-yet-implemented presets and link strategies with exit 5', async () => {
    const ir = await scanFixture();
    await expect(planOf(ir, { presets: true })).rejects.toMatchObject({ exitCode: 5 });
    await expect(planOf(ir, { strategy: 'link' })).rejects.toMatchObject({ exitCode: 5 });
  });
});
