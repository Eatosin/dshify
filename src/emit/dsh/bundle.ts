import { stringify } from 'yaml';
import type { Artifact, Finding, HarnessIR, McpServer, Persona, Provenance } from '../../core/ir.js';
import { compareCodeUnits, finding } from '../../core/report.js';

/**
 * Preset bundle emission. Contract: docs/spec.md §7 ("Preset emission") and
 * docs/mapping/opencode.md §5–§6.
 *
 * Only with `--presets`: one `@deepseek-ai/dsh-agent-preset` row per persona,
 * mirroring the tool/compaction/delegation groups from DSH's shipped `standard`
 * preset, with the persona body as the `@deepseek-ai/dsh-persona` prefix. MCP
 * rows are attached to every persona preset so the agent can actually call
 * them. The manifest declares `dsh.bundle.patch` and no dependencies; dshify
 * never installs the bundle.
 *
 * Mirrored from `@deepseek-ai/dsh-web-app/presets/standard.patch.yml`
 * (0.2.2-rc.1). The `!!js` tags are the loader's own expression language.
 */

export interface BundleOptions {
  /** Repo-relative destination tree, POSIX. */
  readonly dest: string;
  readonly version: string;
}

export interface BundleResult {
  readonly artifacts: Artifact[];
  readonly losses: Finding[];
}

/** A value emitted as the loader's `!!js <expr>` tag. */
class JsExpr {
  constructor(readonly expr: string) {}
}

const JS_TAG = {
  tag: '!!js',
  identify: (value: unknown): boolean => value instanceof JsExpr,
  resolve: (text: string): JsExpr => new JsExpr(text),
  stringify: (item: { value: JsExpr }): string => item.value.expr,
  default: false,
};

interface Row {
  [key: string]: unknown;
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function toolsFor(persona: Persona): Row[] {
  // Read-only personas get the exact switches from spec §7; writable personas
  // mirror the shipped standard preset (applyPatch off by default).
  const fsConfig =
    persona.access === 'read-only'
      ? { read: true, write: false, edit: false, applyPatch: false }
      : { applyPatch: false };

  return [
    {
      id: 'persona',
      name: '@deepseek-ai/dsh-persona',
      config: { prefix: persona.body.replace(/^\n+/, '').replace(/\s+$/, '') },
    },
    { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
    { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
    {
      id: 'tool-bash',
      name: '@deepseek-ai/dsh-tool-bash',
      disabled: new JsExpr("process.platform === 'win32'"),
    },
    {
      id: 'tool-pwsh',
      name: '@deepseek-ai/dsh-tool-pwsh',
      disabled: new JsExpr("process.platform !== 'win32'"),
    },
    { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs', config: fsConfig },
    {
      id: 'tool-fs-search',
      name: '@deepseek-ai/dsh-tool-fs-search',
      config: { sampleOverCapGlobResults: false },
    },
    { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
    {
      id: 'tool-web',
      name: '@deepseek-ai/dsh-tool-web',
      config: { fetch: true, searchTimeoutMs: 60000 },
    },
    { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
    { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
    { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
    {
      id: 'compaction',
      name: 'cordis:group',
      group: true,
      isolate: { compaction: true, toolResultPruner: true },
      config: [
        { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
        { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
        {
          id: 'tool-result-pruner',
          name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
          config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
        },
      ],
    },
    {
      id: 'delegation',
      name: 'cordis:group',
      group: true,
      isolate: { workflowEngine: true },
      config: [
        { id: 'tool-subagent-control', name: '@deepseek-ai/dsh-tool-subagent-control' },
        {
          id: 'tool-subagent',
          name: '@deepseek-ai/dsh-tool-subagent',
          config: { provider: 'spawn', toolName: 'subagent', modelSelection: true, modelDiscovery: true },
        },
        {
          id: 'tool-subagent-fork',
          name: '@deepseek-ai/dsh-tool-subagent',
          config: { provider: 'fork', toolName: 'subagent_fork' },
        },
        { id: 'workflow-ptc', name: '@deepseek-ai/dsh-workflow-ptc', config: { provider: 'spawn' } },
        { id: 'tool-workflow', name: '@deepseek-ai/dsh-tool-workflow' },
      ],
    },
  ];
}

/** One MCP row. Secret values never reach the IR, so none can reach the patch. */
function mcpRow(server: McpServer): Row {
  const config: Record<string, unknown> = {
    serverName: server.name,
    transport: server.transport,
  };
  if (server.url !== undefined) config['url'] = server.url;
  if (server.command !== undefined) config['command'] = server.command;
  if (server.args !== undefined && server.args.length > 0) config['args'] = [...server.args];

  const row: Row = { id: `mcp-${server.name}`, name: '@deepseek-ai/dsh-mcp-client', config };
  if (server.disabled) row['disabled'] = true;
  return row;
}

function presetRows(ir: HarnessIR): Row[] {
  const servers = [...ir.mcpServers].sort((a, b) => compareCodeUnits(a.name, b.name));
  return [...ir.personas]
    .sort((a, b) => compareCodeUnits(a.id, b.id))
    .map((persona, index) => ({
      id: `preset-${persona.id}`,
      name: '@deepseek-ai/dsh-agent-preset',
      config: {
        id: persona.id,
        name: persona.id,
        description: persona.description,
        order: 100 + index,
        plugins: [...toolsFor(persona), ...servers.map(mcpRow)],
      },
    }));
}

function manifestBytes(version: string): Uint8Array {
  return encode(
    `${JSON.stringify(
      {
        name: 'dshify-harness-surface',
        version,
        private: true,
        type: 'module',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      },
      null,
      2,
    )}\n`,
  );
}

function patchBytes(rows: readonly Row[]): Uint8Array {
  const text = stringify(
    { insert: rows },
    { customTags: [JS_TAG as never], lineWidth: 0, aliasDuplicateObjects: false },
  );
  return encode(text.endsWith('\n') ? text : `${text}\n`);
}

function provenanceOf(ir: HarnessIR): Provenance[] {
  const seen = new Set<string>();
  const sources: Provenance[] = [];
  for (const persona of [...ir.personas].sort((a, b) => compareCodeUnits(a.provenance.path, b.provenance.path))) {
    if (seen.has(persona.provenance.path)) continue;
    seen.add(persona.provenance.path);
    sources.push(persona.provenance);
  }
  for (const server of [...ir.mcpServers].sort((a, b) => compareCodeUnits(a.provenance.path, b.provenance.path))) {
    if (seen.has(server.provenance.path)) continue;
    seen.add(server.provenance.path);
    sources.push(server.provenance);
  }
  return sources;
}

/** Plan `.dsh/harness/` when `--presets` is on. */
export function planDshBundle(ir: HarnessIR, options: BundleOptions): BundleResult {
  const rows = presetRows(ir);
  if (rows.length === 0) {
    const losses: Finding[] = [];
    if (ir.mcpServers.length > 0) {
      losses.push(
        finding(
          'MCP_PRESETS_REQUIRED',
          'MCP rows need at least one converted persona to attach to; nothing was emitted',
          { path: 'opencode.json', capability: 'manual' },
        ),
      );
    }
    return { artifacts: [], losses };
  }

  const sources = provenanceOf(ir);
  const harness = `${options.dest}/harness`;
  return {
    artifacts: [
      {
        path: `${harness}/package.json`,
        kind: 'bundle-manifest',
        bytes: manifestBytes(options.version),
        sources,
        capability: 'adapted',
      },
      {
        path: `${harness}/cordis.patch.yml`,
        kind: 'bundle-patch',
        bytes: patchBytes(rows),
        sources,
        capability: 'adapted',
      },
    ],
    losses: [],
  };
}
