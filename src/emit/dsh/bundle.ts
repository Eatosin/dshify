import { stringify } from 'yaml';
import type { Artifact, Finding, HarnessIR, McpServer, Persona, Provenance } from '../../core/ir.js';
import { repoRelative } from '../../core/paths.js';
import { compareCodeUnits, finding } from '../../core/report.js';

/**
 * Preset bundle emission. Contract: docs/spec.md §7 ("Preset emission") and
 * docs/mapping/opencode.md §5–§6.
 *
 * One `@deepseek-ai/dsh-agent-preset` row per persona, mirroring the
 * tool/compaction/delegation groups from DSH's shipped `standard` preset, with
 * the persona body as the `@deepseek-ai/dsh-persona` prefix.
 *
 * v0.2 adds an optional parent preset that can start each persona:
 * `agentPreset` pins the child composition and `agentOptions` pins the child
 * route. DSH routes differ from OpenCode routes, so the route map is explicit.
 */

export interface DelegationRoute {
  readonly persona: string;
  readonly tool: string;
  readonly provider?: string;
  readonly model?: string;
}

export interface MainPresetSpec {
  readonly id: string;
  readonly name: string;
}

export interface BundleOptions {
  /** Repo-relative destination tree, POSIX. */
  readonly dest: string;
  readonly version: string;
  /** Absolute repository root, used to make finding paths repo-relative. */
  readonly repoRoot: string;
  /** Namespace for preset ids, for example `agency-`. */
  readonly presetPrefix?: string;
  /** Emit a parent preset with model-routed delegation tools. */
  readonly delegation?: readonly DelegationRoute[];
  /** Display identity of the parent preset; defaults to `<prefix>main`. */
  readonly mainPreset?: MainPresetSpec;
  /** Extra bundle-local plugin specifiers, relative to the patch file. */
  readonly extraPlugins?: readonly string[];
  /** Package name for the generated bundle; defaults to `dshify-harness-surface`. */
  readonly bundleName?: string;
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

function compactionGroup(): Row {
  return {
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
  };
}

function delegationGroup(
  routes: readonly DelegationRoute[],
  presetIds: readonly string[],
  prefix: string,
): Row {
  return {
    id: 'delegation',
    name: 'cordis:group',
    group: true,
    isolate: { workflowEngine: true },
    config: [
      { id: 'tool-subagent-control', name: '@deepseek-ai/dsh-tool-subagent-control' },
      {
        id: 'tool-subagent',
        name: '@deepseek-ai/dsh-tool-subagent',
        config: {
          provider: 'spawn',
          toolName: 'subagent',
          modelSelection: true,
          modelDiscovery: true,
          ...(presetIds.length === 0 ? {} : { allowedAgentPresets: [...presetIds] }),
        },
      },
      {
        id: 'tool-subagent-fork',
        name: '@deepseek-ai/dsh-tool-subagent',
        config: { provider: 'fork', toolName: 'subagent_fork' },
      },
      ...routes.map((route) => ({
        id: `tool-delegate-${route.persona}`,
        name: '@deepseek-ai/dsh-tool-subagent',
        config: {
          provider: 'spawn',
          toolName: route.tool,
          agentPreset: `${prefix}${route.persona}`,
          ...(route.provider === undefined || route.model === undefined
            ? {}
            : { agentOptions: { provider: route.provider, model: route.model } }),
        },
      })),
      { id: 'workflow-ptc', name: '@deepseek-ai/dsh-workflow-ptc', config: { provider: 'spawn' } },
      { id: 'tool-workflow', name: '@deepseek-ai/dsh-tool-workflow' },
    ],
  };
}

function baseRows(prefix: string, fsConfig: Record<string, unknown>): Row[] {
  return [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix } },
    {
      id: 'agent-instructions',
      name: '@deepseek-ai/dsh-agent-instructions',
      config: { maxBytes: 65536 },
    },
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
    compactionGroup(),
  ];
}

function personaTools(persona: Persona): Row[] {
  const fsConfig =
    persona.access === 'read-only'
      ? { read: true, write: false, edit: false, applyPatch: false }
      : { applyPatch: false };
  return baseRows(
    persona.body.replace(/^\n+/, '').replace(/\s+$/, ''),
    fsConfig,
  );
}

function mainTools(
  options: BundleOptions,
  presetIds: readonly string[],
  servers: readonly McpServer[],
): Row[] {
  const routes = options.delegation ?? [];
  return [
    ...baseRows('You are a coding agent powered by the {{model}} model.', { applyPatch: false }),
    { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
    { id: 'tool-schedule', name: '@deepseek-ai/dsh-tool-schedule' },
    { id: 'command-goal', name: '@deepseek-ai/dsh-command-goal' },
    { id: 'tool-goal', name: '@deepseek-ai/dsh-tool-goal' },
    {
      id: 'planning',
      name: 'cordis:group',
      group: true,
      isolate: { planMode: true },
      config: [{ id: 'plan-mode', name: '@deepseek-ai/dsh-plan-mode' }],
    },
    delegationGroup(routes, presetIds, options.presetPrefix ?? ''),
    { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
    {
      id: 'tool-plugin-manager',
      name: '@deepseek-ai/dsh-plugin-manager/tools',
      disabled: new JsExpr('"!ctx.get(\'profileContext\')"'),
    },
    { id: 'tool-plugin-market', name: '@deepseek-ai/dsh-plugin-market/tools', disabled: true },
    ...(options.extraPlugins ?? []).map((name, index) => ({ id: `extra-plugin-${index + 1}`, name })),
    ...servers.map(mcpRow),
  ];
}

function toolsFor(persona: Persona): Row[] {
  return personaTools(persona);
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
  if (server.env !== undefined) config['env'] = { ...server.env };
  if (server.cwd !== undefined) config['cwd'] = server.cwd;

  const row: Row = { id: `mcp-${server.name}`, name: '@deepseek-ai/dsh-mcp-client', config };
  if (server.disabled) row['disabled'] = true;
  return row;
}

function presetRows(ir: HarnessIR, options: BundleOptions): Row[] {
  const prefix = options.presetPrefix ?? '';
  const servers = [...ir.mcpServers].sort((a, b) => compareCodeUnits(a.name, b.name));
  const personaPresets = [...ir.personas]
    .sort((a, b) => compareCodeUnits(a.id, b.id))
    .map((persona, index) => ({
      id: `preset-${prefix}${persona.id}`,
      name: '@deepseek-ai/dsh-agent-preset',
      config: {
        id: `${prefix}${persona.id}`,
        name: persona.id,
        description: persona.description,
        order: 100 + index,
        plugins:
          options.delegation === undefined
            ? [
                ...toolsFor(persona),
                ...(options.extraPlugins ?? []).map((name, index) => ({
                  id: `extra-plugin-${index + 1}`,
                  name,
                })),
                ...servers.map(mcpRow),
              ]
            : toolsFor(persona),
      },
    }));

  if (options.delegation === undefined) return personaPresets;

  const main = options.mainPreset ?? { id: `${prefix}main`, name: 'Main' };
  const presetIds = ir.personas.map((persona) => `${prefix}${persona.id}`);
  const mainPreset = {
    id: `preset-${main.id}`,
    name: '@deepseek-ai/dsh-agent-preset',
    config: {
      id: main.id,
      name: main.name,
      description: 'Primary agent with model-routed delegation to the converted personas.',
      order: 10,
      plugins: mainTools(options, presetIds, servers),
    },
  };

  return [mainPreset, ...personaPresets];
}

function manifestBytes(version: string, name: string): Uint8Array {
  return encode(
    `${JSON.stringify(
      {
        name,
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
  const text = stringify([{ insert: rows }], {
    customTags: [JS_TAG as never],
    lineWidth: 0,
    aliasDuplicateObjects: false,
  });
  return encode(text.endsWith('\n') ? text : `${text}\n`);
}

function provenanceOf(ir: HarnessIR): Provenance[] {
  const seen = new Set<string>();
  const sources: Provenance[] = [];
  const add = (provenance: Provenance): void => {
    if (seen.has(provenance.path)) return;
    seen.add(provenance.path);
    sources.push(provenance);
  };
  for (const persona of [...ir.personas].sort((a, b) =>
    compareCodeUnits(a.provenance.path, b.provenance.path),
  )) {
    add(persona.provenance);
  }
  for (const server of [...ir.mcpServers].sort((a, b) =>
    compareCodeUnits(a.provenance.path, b.provenance.path),
  )) {
    add(server.provenance);
  }
  return sources;
}

function pluginManifest(ir: HarnessIR): Uint8Array | undefined {
  const surfaces = ir.pluginSurfaces ?? [];
  if (surfaces.length === 0) return undefined;
  const lines = [
    '# Plugin port manifest',
    '',
    'These source plugin surfaces are reported, never loaded or executed. Port each',
    'tool to a DSH bundle-local plugin that registers a tool definition on',
    '`ctx.tools`. The tool names and descriptions below are extracted statically and',
    'may be incomplete.',
    '',
  ];
  for (const surface of [...surfaces].sort((a, b) => compareCodeUnits(a.path, b.path))) {
    lines.push(`## ${surface.path}`, '');
    if (surface.tools.length === 0) {
      lines.push('No tool declarations found. Inspect the file by hand.', '');
      continue;
    }
    lines.push('| Tool | Description |', '|---|---|');
    for (const tool of surface.tools) {
      lines.push(`| \`${tool.name}\` | ${tool.description.replace(/\|/g, '\\|')} |`);
    }
    lines.push('');
  }
  if ((ir.extraInstructions ?? []).length > 0) {
    lines.push('## Extra instruction files', '', 'Not loaded by DSH:', '');
    for (const file of ir.extraInstructions ?? []) lines.push(`- \`${file}\``);
    lines.push('');
  }
  return encode(`${lines.join('\n')}\n`);
}

/** Plan `.dsh/harness/` when `--presets` is on. */
export function planDshBundle(ir: HarnessIR, options: BundleOptions): BundleResult {
  const rows = presetRows(ir, options);
  const losses: Finding[] = [];
  if (rows.length === 0) {
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

  if (options.delegation !== undefined) {
    const personas = new Set(ir.personas.map((persona) => persona.id));
    for (const route of options.delegation) {
      if (!personas.has(route.persona)) {
        losses.push(
          finding(
            'MODEL_ROUTE_UNMAPPED',
            `delegation route names persona "${route.persona}", which was not converted`,
            { path: 'opencode.json', capability: 'manual' },
          ),
        );
      }
    }
    const routed = new Set(options.delegation.map((route) => route.persona));
    for (const persona of ir.personas) {
      if (persona.modelHint === undefined || routed.has(persona.id)) continue;
      losses.push(
        finding(
          'MODEL_ROUTE_UNMAPPED',
          `persona "${persona.id}" has model hint "${persona.modelHint}" but no DSH route; the child inherits the parent model`,
          {
            path: repoRelative(options.repoRoot, persona.provenance.path),
            capability: 'manual',
          },
        ),
      );
    }
    losses.push(
      finding(
        'PRESET_PROFILE_GLOBAL',
        'presets are profile-global; choose the parent preset in Settings → General for new sessions',
        { path: 'opencode.json', capability: 'adapted' },
      ),
    );
  }

  const sources = provenanceOf(ir);
  const harness = `${options.dest}/harness`;
  const artifacts: Artifact[] = [
    {
      path: `${harness}/package.json`,
      kind: 'bundle-manifest',
      bytes: manifestBytes(options.version, options.bundleName ?? 'dshify-harness-surface'),
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
  ];
  const manifest = pluginManifest(ir);
  if (manifest !== undefined) {
    artifacts.push({
      path: `${harness}/PLUGINS.md`,
      kind: 'port-manifest',
      bytes: manifest,
      sources: [],
      capability: 'manual',
    });
  }
  return { artifacts, losses };
}
