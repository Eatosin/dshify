import { describe, expect, it } from 'vitest';
import {
  HOST_COMMANDS,
  HarnessIRSchema,
  KEBAB_CASE,
  type HarnessIR,
} from '../src/core/ir.js';
import { sortFindings } from '../src/core/report.js';

const SHA = 'a'.repeat(64);

function minimalIR(): HarnessIR {
  return {
    harness: 'opencode',
    version: '0.1.0',
    root: '/tmp/repo',
    skills: [],
    commands: [],
    personas: [],
    mcpServers: [],
    warnings: [],
  };
}

describe('HarnessIR schema', () => {
  it('accepts a minimal IR', () => {
    expect(HarnessIRSchema.parse(minimalIR())).toEqual(minimalIR());
  });

  it('rejects unknown fields (the IR is strict: no untyped extras)', () => {
    const ir = { ...minimalIR(), surprise: true };
    expect(HarnessIRSchema.safeParse(ir).success).toBe(false);
  });

  it('rejects a non-kebab skill id', () => {
    const ir = {
      ...minimalIR(),
      skills: [
        {
          id: 'Not Kebab',
          description: 'x',
          body: '',
          invocation: { model: true, user: true },
          resources: [],
          provenance: { path: '/tmp/a/SKILL.md', sha256: SHA, adapter: 'opencode', rootKind: 'default' },
          capability: 'exact',
        },
      ],
    };
    expect(HarnessIRSchema.safeParse(ir).success).toBe(false);
  });

  it('rejects a malformed content hash', () => {
    const ir = {
      ...minimalIR(),
      warnings: [
        { code: 'MISSING_ROOT', severity: 'warning', message: 'gone', path: '.opencode/skills' },
      ],
      agentsMd: { path: '/tmp/AGENTS.md', sha256: 'not-a-hash', adapter: 'opencode', rootKind: 'repo' },
    };
    expect(HarnessIRSchema.safeParse(ir).success).toBe(false);
  });

  it('rejects an unknown capability and severity', () => {
    const base = minimalIR();
    const badFinding = {
      ...base,
      warnings: [{ code: 'X', severity: 'fatal', message: 'm' }],
    };
    expect(HarnessIRSchema.safeParse(badFinding).success).toBe(false);
  });
});

describe('spec rev. 2 host commands', () => {
  it('reserves the six shipped built-ins', () => {
    expect([...HOST_COMMANDS].sort()).toEqual(
      ['compact', 'export', 'feedback', 'goal', 'permission', 'plan'].sort(),
    );
  });

  it('includes feedback and export, the two the original spec missed', () => {
    expect(HOST_COMMANDS).toContain('feedback');
    expect(HOST_COMMANDS).toContain('export');
  });
});

describe('KEBAB_CASE', () => {
  it('accepts kebab-case and rejects the rest', () => {
    for (const value of ['demo-skill', 'a', 'a1-b2']) expect(KEBAB_CASE.test(value)).toBe(true);
    for (const value of ['Demo', 'demo_skill', 'demo skill', '-demo', 'demo-', '']) {
      expect(KEBAB_CASE.test(value)).toBe(false);
    }
  });
});

describe('sortFindings', () => {
  it('orders by code, then path, then message, deterministically', () => {
    const sorted = sortFindings([
      { code: 'Z_CODE', severity: 'info', message: 'z' },
      { code: 'A_CODE', severity: 'info', message: 'b', path: 'b.md' },
      { code: 'A_CODE', severity: 'info', message: 'a', path: 'b.md' },
      { code: 'A_CODE', severity: 'info', message: 'a', path: 'a.md' },
    ]);
    expect(sorted.map((item) => `${item.code}:${item.path ?? ''}:${item.message}`)).toEqual([
      'A_CODE:a.md:a',
      'A_CODE:b.md:a',
      'A_CODE:b.md:b',
      'Z_CODE::z',
    ]);
  });
});
