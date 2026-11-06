import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { verifyDiscovery } from '../src/verify/discovery.js';

const limits = { maxFileBytes: 1024 * 1024 };
const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function repo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dshify-discovery-'));
  tempDirs.push(dir);
  return dir;
}

async function write(root: string, relative: string, text: string): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
}

function skillDoc(name: string, description: string, extra = ''): string {
  return `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\nbody\n`;
}

describe('DSH discovery simulation', () => {
  it('discovers directory and flat bundles in both project roots', async () => {
    const root = await repo();
    await write(root, '.dsh/skills/bundle/SKILL.md', skillDoc('bundle', 'A bundle skill.'));
    await write(root, '.dsh/skills/flat.md', skillDoc('flat', 'A flat skill.'));
    await write(root, '.agents/skills/native/SKILL.md', skillDoc('native', 'Native root.'));

    const result = await verifyDiscovery(root, limits);
    expect(result.roots).toEqual(['.dsh/skills', '.agents/skills']);
    expect(result.visible.map((skill) => skill.path)).toEqual([
      '.agents/skills/native/SKILL.md',
      '.dsh/skills/bundle/SKILL.md',
      '.dsh/skills/flat.md',
    ]);
    expect(result.visible.every((skill) => skill.modelInvocable)).toBe(true);
    expect(result.skipped).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it('skips malformed entries with a reason instead of failing', async () => {
    const root = await repo();
    await write(root, '.dsh/skills/no-description/SKILL.md', '---\nname: no-description\n---\nbody\n');
    await write(root, '.dsh/skills/Bad_Name/SKILL.md', skillDoc('Bad_Name', 'bad name'));
    await write(
      root,
      '.dsh/skills/mismatch/SKILL.md',
      skillDoc('other-name', 'name does not match directory'),
    );
    await write(
      root,
      '.dsh/skills/bad-bool/SKILL.md',
      skillDoc('bad-bool', 'bad boolean', 'disable-model-invocation: maybe\n'),
    );
    await write(root, '.dsh/skills/bad-yaml/SKILL.md', '---\nname: [unclosed\n---\nbody\n');

    const result = await verifyDiscovery(root, limits);
    expect(result.visible).toEqual([]);
    const reasons = result.skipped.map((entry) => entry.reason).sort();
    expect(reasons).toEqual([
      'invalid-frontmatter',
      'invalid-invocation',
      'invalid-name',
      'missing-description',
      'name-mismatch',
    ]);
    expect(result.complete).toBe(true);
  });

  it('is one level deep: nested SKILL.md is not discovered', async () => {
    const root = await repo();
    await write(root, '.dsh/skills/bundle/SKILL.md', skillDoc('bundle', 'Top bundle.'));
    await write(root, '.dsh/skills/bundle/nested/SKILL.md', skillDoc('nested', 'Nested.'));
    const result = await verifyDiscovery(root, limits);
    expect(result.visible.map((skill) => skill.name)).toEqual(['bundle']);
  });

  it('ignores directories that are not bundles without reporting them', async () => {
    const root = await repo();
    await mkdir(path.join(root, '.dsh/skills/not-a-bundle'), { recursive: true });
    const result = await verifyDiscovery(root, limits);
    expect(result.visible).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('treats missing roots as valid empty state', async () => {
    const root = await repo();
    const result = await verifyDiscovery(root, limits);
    expect(result.roots).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it('parses the invocation flags', async () => {
    const root = await repo();
    await write(
      root,
      '.dsh/skills/user-only/SKILL.md',
      skillDoc(
        'user-only',
        'User-only skill.',
        'disable-model-invocation: true\nuser-invocable: true\n',
      ),
    );
    await write(
      root,
      '.dsh/skills/model-only/SKILL.md',
      skillDoc('model-only', 'Model-only skill.', 'user-invocable: false\n'),
    );
    const result = await verifyDiscovery(root, limits);
    const byName = new Map(result.visible.map((skill) => [skill.name, skill]));
    expect(byName.get('user-only')?.modelInvocable).toBe(false);
    expect(byName.get('user-only')?.userInvocable).toBe(true);
    expect(byName.get('model-only')?.modelInvocable).toBe(true);
    expect(byName.get('model-only')?.userInvocable).toBe(false);
  });

  it('honours a custom root list', async () => {
    const root = await repo();
    await write(root, 'custom/skills/one/SKILL.md', skillDoc('one', 'Custom root.'));
    const result = await verifyDiscovery(root, { ...limits, roots: ['custom/skills'] });
    expect(result.roots).toEqual(['custom/skills']);
    expect(result.visible.map((skill) => skill.path)).toEqual(['custom/skills/one/SKILL.md']);
  });
});
