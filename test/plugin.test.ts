import { stat } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { apply as applyPlugin, inject, name } from '../plugin/index.js';
import { cleanup, copyFixture } from './helpers.js';

interface RegisteredTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly output: { readonly schema: Record<string, unknown> };
  execute(args: unknown): Promise<Record<string, any>>;
}

interface RegisteredCommand {
  readonly name: string;
  readonly description: string;
  handler(invocation: { rawInput: string }): Promise<{ kind: string; text?: string }>;
}

const parents: string[] = [];

afterAll(async () => {
  await Promise.all(parents.map((parent) => cleanup(parent)));
});

function fakeContext() {
  const tools: RegisteredTool[] = [];
  const commands: RegisteredCommand[] = [];
  const ctx = {
    tools: {
      register(definition: RegisteredTool) {
        tools.push(definition);
        return () => undefined;
      },
    },
    get(service: string) {
      if (service !== 'commands') return undefined;
      return {
        register(command: RegisteredCommand) {
          commands.push(command);
          return () => undefined;
        },
      };
    },
    effect(effect: () => unknown) {
      return effect();
    },
  };
  return { ctx, tools, commands };
}

async function fixtureCopy() {
  const { parent, root } = await copyFixture('opencode-basic');
  parents.push(parent);
  return root;
}

async function load() {
  const fake = fakeContext();
  applyPlugin(fake.ctx);
  const tool = fake.tools[0];
  if (tool === undefined) throw new Error('tool was not registered');
  return { ...fake, tool };
}

describe('plugin registration', () => {
  it('declares the loader metadata and registers the tool and command', async () => {
    expect(name).toBe('dshify');
    expect(inject).toContain('tools');
    const { tools, commands } = await load();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('migrate_harness');
    expect(tools[0]?.description).toContain('apply');
    expect(commands.map((command) => command.name)).toEqual(['migrate']);
    expect(commands[0]?.description).toContain('OpenCode');
  });
});

describe('migrate_harness tool', () => {
  it('scans a repository without writing', async () => {
    const root = await fixtureCopy();
    const { tool } = await load();
    const result = await tool.execute({ action: 'scan', path: root });
    expect(result['action']).toBe('scan');
    expect(result['ok']).toBe(true);
    expect(result['summary']['skills']).toBeGreaterThan(0);
    expect(Array.isArray(result['findings'])).toBe(true);
    await expect(stat(path.join(root, '.dsh'))).rejects.toBeDefined();
  });

  it('plans artifacts and losses without writing', async () => {
    const root = await fixtureCopy();
    const { tool } = await load();
    const result = await tool.execute({ action: 'plan', path: root, dest: '.dsh' });
    expect(result['summary']['artifacts']).toBeGreaterThanOrEqual(5);
    const codes = (result['findings'] as Array<{ code: string }>).map((item) => item.code);
    expect(codes).toContain('ARGS_SUBSTITUTION');
    await expect(stat(path.join(root, '.dsh'))).rejects.toBeDefined();
  });

  it('applies the surface and then checks it', async () => {
    const root = await fixtureCopy();
    const { tool } = await load();
    const applied = await tool.execute({ action: 'apply', path: root, dest: '.dsh' });
    expect(applied['ok']).toBe(true);
    expect(applied['exitCode']).toBe(0);
    expect(applied['summary']['written']).toBeGreaterThanOrEqual(5);
    expect(await stat(path.join(root, '.dsh/skills'))).toBeDefined();

    const checked = await tool.execute({ action: 'check', path: root, dest: '.dsh' });
    expect(checked['ok']).toBe(true);
    expect(checked['exitCode']).toBe(0);
    expect(checked['verification']['visible'].length).toBeGreaterThanOrEqual(4);
  });

  it('rejects invalid input with a clear message', async () => {
    const { tool } = await load();
    await expect(tool.execute({ action: 'publish' })).rejects.toThrow(/action must be/);
    await expect(tool.execute({ action: 'scan', extra: true })).rejects.toThrow(/unknown argument/);
    await expect(tool.execute({ action: 'scan', path: '/definitely/missing/path' })).rejects.toThrow(
      /does not exist/,
    );
  });
});

describe('/migrate command', () => {
  it('runs scan through the command handler', async () => {
    const root = await fixtureCopy();
    const { commands } = await load();
    const handler = commands[0]?.handler;
    if (handler === undefined) throw new Error('command was not registered');
    const result = await handler({ rawInput: `scan ${root}` });
    expect(result.kind).toBe('success');
    expect(result.text).toContain('dshify scan');
  });

  it('defaults to plan and reports parse errors as command errors', async () => {
    const root = await fixtureCopy();
    const { commands } = await load();
    const handler = commands[0]?.handler;
    if (handler === undefined) throw new Error('command was not registered');
    const planned = await handler({ rawInput: root });
    expect(planned.kind).toBe('success');
    expect(planned.text).toContain('dshify plan');

    const failed = await handler({ rawInput: 'scan /definitely/missing/path' });
    expect(failed.kind).toBe('error');
    expect(failed.text).toContain('does not exist');
  });
});
