import { describe, expect, it } from 'vitest';
import {
  DshifyLockfileSchema,
  GENERATOR_NAME,
  LOCKFILE_VERSION,
  canonicalLockfile,
  lockfileContentEqual,
  parseLockfile,
  serializeLockfile,
  type DshifyLockfile,
} from '../src/core/lockfile.js';

const SHA = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function rawLockfile(): DshifyLockfile {
  return {
    lockfileVersion: LOCKFILE_VERSION,
    generatedBy: { name: GENERATOR_NAME, version: '0.1.0' },
    sourceRoots: [
      { harness: 'opencode', path: 'skills', kind: 'skills' },
      { harness: 'opencode', path: '.opencode/skills', kind: 'skills' },
    ],
    sources: [
      { path: 'b.md', sha256: SHA },
      { path: 'a.md', sha256: SHA },
    ],
    artifacts: [
      {
        path: '.dsh/skills/b/SKILL.md',
        kind: 'skill',
        sha256: SHA,
        sources: [
          { path: 'b-src.md', sha256: SHA },
          { path: 'a-src.md', sha256: SHA },
        ],
      },
      { path: '.dsh/skills/a/SKILL.md', kind: 'skill', sha256: SHA_B, sources: [] },
    ],
    losses: [
      { code: 'Z_CODE', severity: 'info', detail: 'z' },
      { code: 'A_CODE', severity: 'warning', detail: 'a' },
    ],
  };
}

describe('lockfile schema and canonical form', () => {
  it('round-trips through the schema', () => {
    expect(DshifyLockfileSchema.parse(rawLockfile())).toBeDefined();
  });

  it('sorts every array and dedupes sources', () => {
    const canonical = canonicalLockfile(rawLockfile());
    expect(canonical.sourceRoots.map((root) => root.path)).toEqual([
      '.opencode/skills',
      'skills',
    ]);
    expect(canonical.sources.map((source) => source.path)).toEqual(['a.md', 'b.md']);
    expect(canonical.artifacts.map((artifact) => artifact.path)).toEqual([
      '.dsh/skills/a/SKILL.md',
      '.dsh/skills/b/SKILL.md',
    ]);
    expect(canonical.artifacts[1]?.sources.map((source) => source.path)).toEqual([
      'a-src.md',
      'b-src.md',
    ]);
    expect(canonical.losses.map((loss) => loss.code)).toEqual(['A_CODE', 'Z_CODE']);
  });

  it('serializes with stable key order and a trailing newline', () => {
    const text = serializeLockfile(rawLockfile());
    expect(text.endsWith('\n')).toBe(true);
    expect(text.indexOf('"lockfileVersion"')).toBeLessThan(text.indexOf('"generatedBy"'));
    expect(text.indexOf('"generatedBy"')).toBeLessThan(text.indexOf('"sourceRoots"'));
    expect(text.indexOf('"sourceRoots"')).toBeLessThan(text.indexOf('"sources"'));
    expect(text.indexOf('"sources"')).toBeLessThan(text.indexOf('"artifacts"'));
    expect(text.indexOf('"artifacts"')).toBeLessThan(text.indexOf('"losses"'));
    expect(serializeLockfile(rawLockfile())).toBe(text);
  });

  it('contains no timestamps', () => {
    expect(serializeLockfile(rawLockfile())).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('ignores generatedBy.version when comparing content', () => {
    const left = rawLockfile();
    const right: DshifyLockfile = {
      ...rawLockfile(),
      generatedBy: { name: GENERATOR_NAME, version: '9.9.9' },
    };
    expect(lockfileContentEqual(left, right)).toBe(true);
    const changed = {
      ...rawLockfile(),
      artifacts: [{ path: 'x', kind: 'skill', sha256: SHA, sources: [] }],
    };
    expect(lockfileContentEqual(left, changed)).toBe(false);
  });

  it('rejects a wrong version, bad hash and unknown fields', () => {
    const badVersion = { ...rawLockfile(), lockfileVersion: 2 };
    expect(DshifyLockfileSchema.safeParse(badVersion).success).toBe(false);
    const badHash = { ...rawLockfile(), sources: [{ path: 'a.md', sha256: 'nope' }] };
    expect(DshifyLockfileSchema.safeParse(badHash).success).toBe(false);
    const extra = { ...rawLockfile(), surprise: true };
    expect(DshifyLockfileSchema.safeParse(extra).success).toBe(false);
  });

  it('parses malformed JSON as a typed internal failure (exit 1)', () => {
    expect(() => parseLockfile('{not json', 'x')).toThrowError(/invalid lockfile/);
    expect(() => parseLockfile(JSON.stringify({ lockfileVersion: 1 }), 'x')).toThrowError(
      /invalid lockfile/,
    );
  });
});
