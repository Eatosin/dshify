import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyRepo } from '../src/core/apply.js';
import { serializeLockfile } from '../src/core/lockfile.js';
import { planRepo } from '../src/core/plan.js';
import { scanRepo } from '../src/core/scan.js';
import { DEFAULT_SCAN_LIMITS, readSourceBytes } from '../src/core/source.js';
import { cleanup, copyFixture, fixturePath, listFiles, repoRoot } from './helpers.js';

/**
 * Golden outputs for the OpenCode → DSH emitter.
 *
 * A golden change is a behavior change: regenerate with
 * `DSHIFY_UPDATE_GOLDENS=1 npx vitest run test/golden`, then review the diff.
 */

const limits = DEFAULT_SCAN_LIMITS;
const repo = repoRoot();
const fixture = fixturePath('opencode-basic');
const goldenRoot = path.join(repo, 'test/golden/opencode-basic');
const update = process.env['DSHIFY_UPDATE_GOLDENS'] === '1';
const DEST_PREFIX = '.dsh/';

describe('golden output — opencode-basic', () => {
  it('matches the committed bytes for every planned artifact', async () => {
    const ir = await scanRepo({ root: fixture, extraRoots: [], limits });
    const planned = await planRepo(ir, {
      repoRoot: repo,
      dest: '.dsh',
      presets: false,
      strategy: 'copy',
      readResource: (absolute) => readSourceBytes(absolute, limits),
    });

    const expected = new Map<string, Uint8Array>();
    for (const artifact of planned.artifacts) {
      expect(artifact.path.startsWith(DEST_PREFIX)).toBe(true);
      expected.set(artifact.path.slice(DEST_PREFIX.length), artifact.bytes);
    }

    if (update) {
      for (const [relative, bytes] of expected) {
        const target = path.join(goldenRoot, relative);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes);
      }
      return;
    }

    for (const [relative, bytes] of expected) {
      const actual = await readFile(path.join(goldenRoot, relative));
      expect(Buffer.compare(Buffer.from(bytes), actual), relative).toBe(0);
    }

    const committed = (await listFiles(goldenRoot)).filter(
      (file) => file !== 'README.md' && file !== '.dshify.lock.json',
    );
    expect([...expected.keys()].sort()).toEqual(committed.sort());
  });

  it('matches the committed lockfile', async () => {
    const { parent, root } = await copyFixture('opencode-basic');
    try {
      const ir = await scanRepo({ root, extraRoots: [], limits });
      const result = await applyRepo(ir, {
        repoRoot: root,
        dest: '.dsh',
        lockfilePath: '.dshify.lock.json',
        presets: false,
        strategy: 'copy',
        force: false,
        version: '0.1.0',
        readResource: (absolute) => readSourceBytes(absolute, limits),
      });
      const text = serializeLockfile(result.lockfile);
      const target = path.join(goldenRoot, '.dshify.lock.json');
      if (update) {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, text);
        return;
      }
      expect(await readFile(target, 'utf8')).toBe(text);
    } finally {
      await cleanup(parent);
    }
  });
});
