import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scanRepo } from '../src/core/scan.js';
import { DEFAULT_SCAN_LIMITS } from '../src/core/source.js';

const limits = DEFAULT_SCAN_LIMITS;
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRepo(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dshify-config-'));
  roots.push(root);
  for (const [relative, text] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, text, 'utf8');
  }
  return root;
}

function config(serverName: string): string {
  return JSON.stringify({
    mcp: {
      servers: {
        [serverName]: { type: 'local', command: ['npx', '-y', '@playwright/mcp@latest'] },
      },
    },
  });
}

describe('OpenCode config discovery', () => {
  it('reads the project config from .opencode/opencode.json', async () => {
    const root = await makeRepo({ '.opencode/opencode.json': config('playwright') });
    const ir = await scanRepo({ root, extraRoots: [], limits });
    expect(ir.mcpServers.map((server) => server.name)).toEqual(['playwright']);
  });

  it('reads a repository-root opencode.json', async () => {
    const root = await makeRepo({ 'opencode.json': config('root-server') });
    const ir = await scanRepo({ root, extraRoots: [], limits });
    expect(ir.mcpServers.map((server) => server.name)).toEqual(['root-server']);
  });

  it('prefers the project-directory file and reports the ambiguity', async () => {
    const root = await makeRepo({
      '.opencode/opencode.json': config('project-server'),
      'opencode.json': config('root-server'),
    });
    const ir = await scanRepo({ root, extraRoots: [], limits });
    expect(ir.mcpServers.map((server) => server.name)).toEqual(['project-server']);
    expect(ir.warnings.map((warning) => warning.code)).toContain('CONFIG_PRECEDENCE');
  });

  it('names the config file in an MCP finding', async () => {
    const root = await makeRepo({
      '.opencode/opencode.json': JSON.stringify({
        mcp: { servers: { bad: { type: 'remote' } } },
      }),
    });
    const ir = await scanRepo({ root, extraRoots: [], limits });
    const finding = ir.warnings.find((warning) => warning.code === 'MALFORMED_CONFIG');
    expect(finding?.path).toBe('.opencode/opencode.json');
  });
});
