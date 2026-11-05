import { describe, expect, it } from 'vitest';
import { COMMANDS, run, type CliIO } from '../src/cli.js';
import { VERSION } from '../src/version.js';

interface Capture {
  readonly io: CliIO;
  readonly out: () => string;
  readonly err: () => string;
}

function capture(): Capture {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

describe('cli scaffold', () => {
  it('prints the version and exits 0', () => {
    const c = capture();
    expect(run(['--version'], c.io)).toBe(0);
    expect(c.out()).toBe(VERSION);
    expect(c.err()).toBe('');
  });

  it('prints help for no arguments and exits 0', () => {
    const c = capture();
    expect(run([], c.io)).toBe(0);
    expect(c.out()).toContain('Usage:');
  });

  it('lists every planned command in help', () => {
    const c = capture();
    expect(run(['--help'], c.io)).toBe(0);
    for (const command of COMMANDS) {
      expect(c.out()).toContain(command);
    }
  });

  it('rejects an unknown command with exit 2', () => {
    const c = capture();
    expect(run(['frobnicate'], c.io)).toBe(2);
    expect(c.out()).toBe('');
    expect(c.err()).toContain('unknown command "frobnicate"');
  });

  it('reports a known but unimplemented command with exit 1', () => {
    const c = capture();
    expect(run(['scan', '.'], c.io)).toBe(1);
    expect(c.err()).toContain('not implemented yet');
  });
});
