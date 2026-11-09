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

interface CapturedRoute {
  readonly kind: string;
  readonly path: string;
  handler(req: any, res: any): Promise<void>;
}

function responseRecorder() {
  const state = { status: 0, headers: {}, body: '' };
  return {
    state,
    res: {
      writeHead(status: number, headers: Record<string, string>) {
        state.status = status;
        state.headers = headers;
      },
      end(body: string) {
        state.body = body;
      },
    },
  };
}

async function serverContext() {
  const tools: RegisteredTool[] = [];
  const routes: CapturedRoute[] = [];
  const ctx = {
    tools: {
      register(definition: RegisteredTool) {
        tools.push(definition);
        return () => undefined;
      },
    },
    get(service: string) {
      if (service === 'webServer') {
        return {
          register(route: CapturedRoute) {
            routes.push(route);
            return () => undefined;
          },
        };
      }
      if (service === 'workingDirectory') return { defaultDirectory: process.cwd() };
      return undefined;
    },
    effect(effect: () => unknown) {
      return effect();
    },
  };
  applyPlugin(ctx);
  const route = routes[0];
  if (route === undefined) throw new Error('route was not registered');
  return { route, tools };
}

function postRequest(body: unknown) {
  const text = JSON.stringify(body);
  return {
    method: 'POST',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(text, 'utf8');
    },
    destroy() {},
  };
}

describe('read-only Web route', () => {
  it('registers the exact JSON route', async () => {
    const { route } = await serverContext();
    expect(route.kind).toBe('exact');
    expect(route.path).toBe('/api/dshify/migrate');
  });

  it('runs scan for the panel', async () => {
    const root = await fixtureCopy();
    const { route } = await serverContext();
    const { res, state } = responseRecorder();
    await route.handler(postRequest({ action: 'scan', path: root }), res);
    expect(state.status).toBe(200);
    const payload = JSON.parse(state.body) as { ok: boolean; result: { action: string; summary: any } };
    expect(payload.ok).toBe(true);
    expect(payload.result.action).toBe('scan');
    expect(payload.result.summary.skills).toBeGreaterThan(0);
  });

  it('refuses apply, non-POST methods, and invalid bodies', async () => {
    const root = await fixtureCopy();
    const { route } = await serverContext();

    const applyRes = responseRecorder();
    await route.handler(postRequest({ action: 'apply', path: root }), applyRes.res);
    expect(applyRes.state.status).toBe(403);

    const getRes = responseRecorder();
    await route.handler({ method: 'GET' }, getRes.res);
    expect(getRes.state.status).toBe(405);

    const badRes = responseRecorder();
    await route.handler(postRequest({ action: 'publish' }), badRes.res);
    expect(badRes.state.status).toBe(400);
  });
});

describe('client half', () => {
  it('registers the settings tab with locale text', async () => {
    const { readFile } = await import('node:fs/promises');
    const vm = await import('node:vm');
    const code = await readFile(new URL('../plugin/client.js', import.meta.url), 'utf8');

    const registrations: Array<{ options: any; component: any }> = [];
    const dictionaries: Array<{ ns: string; locale: string; dict: any }> = [];
    const react = {
      createElement: (...args: unknown[]) => ({ args }),
      useState: (value: unknown) => [value, () => undefined],
      useCallback: (callback: unknown) => callback,
    };

    const fakeWindow = {
      __ModuleLoader__: {
        load(entry: { id: string; factory: (require: (name: string) => unknown) => any }) {
          const module = entry.factory((name: string) => (name === 'react' ? react : {}));
          const ctx = {
            effect(effect: () => unknown) {
              return effect();
            },
            locale: {
              register(ns: string, locale: string, dict: any) {
                dictionaries.push({ ns, locale, dict });
                return () => undefined;
              },
              bind: () => (key: string) => key,
            },
            slots: {
              inject(_name: string, callback: () => unknown) {
                callback();
                return () => undefined;
              },
              register(options: any, component: any) {
                registrations.push({ options, component });
                return () => undefined;
              },
            },
          };
          module.apply(ctx);
        },
      },
    };

    vm.runInNewContext(code, { window: fakeWindow });
    expect(dictionaries).toHaveLength(1);
    expect(dictionaries[0]?.dict.title).toContain('Migrate');
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.options.name).toBe('settings.plugins.tab');
    expect(registrations[0]?.options.id).toBe('dshify');
    expect(typeof registrations[0]?.component).toBe('function');
  });
});
