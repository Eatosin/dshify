import type { Capability, Finding, Severity } from './ir.js';

/**
 * Finding codes and their default severity. Codes are stable public API
 * (spec §10, §14); the per-construct list and meaning live in
 * `docs/mapping/opencode.md`, which is the single home for that table.
 *
 * New codes are added here and documented in the mapping doc in the same PR.
 */
export const FINDING_CODES = {
  // scan: roots, config, include files
  MALFORMED_CONFIG: 'MALFORMED_CONFIG',
  MISSING_ROOT: 'MISSING_ROOT',
  ROOT_GUESS: 'ROOT_GUESS',
  AGENTS_MD_SHARED: 'AGENTS_MD_SHARED',
  CLAUDE_MD_SHARED: 'CLAUDE_MD_SHARED',
  PLUGIN_UNSUPPORTED: 'PLUGIN_UNSUPPORTED',

  // scan: skills
  MALFORMED_SKILL: 'MALFORMED_SKILL',
  UNSUPPORTED_NESTED_SKILL: 'UNSUPPORTED_NESTED_SKILL',
  DSH_NATIVE_ROOT: 'DSH_NATIVE_ROOT',
  RESOURCE_OUTSIDE_SKILL: 'RESOURCE_OUTSIDE_SKILL',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',

  // scan: commands
  MALFORMED_COMMAND: 'MALFORMED_COMMAND',
  COMMAND_AGENT_ROUTING: 'COMMAND_AGENT_ROUTING',

  // scan: personas
  MALFORMED_PERSONA: 'MALFORMED_PERSONA',
  SUBAGENT_ISOLATION: 'SUBAGENT_ISOLATION',
  AGENT_MODE_UNEXPECTED: 'AGENT_MODE_UNEXPECTED',
  LEGACY_FIELD: 'LEGACY_FIELD',
  TOOLS_FRONTMATTER: 'TOOLS_FRONTMATTER',

  // scan: MCP
  MCP_REMOTE: 'MCP_REMOTE',
  MCP_STDIO: 'MCP_STDIO',
  MCP_DISABLED: 'MCP_DISABLED',
  MCP_AUTH_MANUAL: 'MCP_AUTH_MANUAL',
  MCP_INVALID_NAME: 'MCP_INVALID_NAME',

  // plan / emit
  ARGS_SUBSTITUTION: 'ARGS_SUBSTITUTION',
  POSITIONAL_ARGS: 'POSITIONAL_ARGS',
  SHELL_INJECTION: 'SHELL_INJECTION',
  MODEL_OVERRIDE_IGNORED: 'MODEL_OVERRIDE_IGNORED',
  EDIT_DENY_ADAPTED: 'EDIT_DENY_ADAPTED',
  NAME_COLLISION: 'NAME_COLLISION',
  HOST_COMMAND_COLLISION: 'HOST_COMMAND_COLLISION',
  MCP_PRESETS_REQUIRED: 'MCP_PRESETS_REQUIRED',
  RESOURCE_READ_FAILED: 'RESOURCE_READ_FAILED',

  // apply / lockfile
  REPAIRED: 'REPAIRED',
  UPDATED: 'UPDATED',
  FORCED: 'FORCED',
  CONFLICT: 'CONFLICT',
  ORPHAN_ARTIFACT: 'ORPHAN_ARTIFACT',
  NAME_CONFLICT: 'NAME_CONFLICT',

  // check / verify
  MISSING_ARTIFACT: 'MISSING_ARTIFACT',
  DRIFT: 'DRIFT',
  LOCKFILE_MISSING: 'LOCKFILE_MISSING',
  DISCOVERY_MISS: 'DISCOVERY_MISS',
} as const;

export type FindingCode = keyof typeof FINDING_CODES;

export const DEFAULT_SEVERITY: Readonly<Record<FindingCode, Severity>> = {
  MALFORMED_CONFIG: 'error',
  MISSING_ROOT: 'warning',
  ROOT_GUESS: 'info',
  AGENTS_MD_SHARED: 'info',
  CLAUDE_MD_SHARED: 'info',
  PLUGIN_UNSUPPORTED: 'warning',

  MALFORMED_SKILL: 'error',
  UNSUPPORTED_NESTED_SKILL: 'warning',
  DSH_NATIVE_ROOT: 'info',
  RESOURCE_OUTSIDE_SKILL: 'warning',
  UNKNOWN_FIELD: 'warning',

  MALFORMED_COMMAND: 'error',
  COMMAND_AGENT_ROUTING: 'warning',

  MALFORMED_PERSONA: 'error',
  SUBAGENT_ISOLATION: 'warning',
  AGENT_MODE_UNEXPECTED: 'warning',
  LEGACY_FIELD: 'warning',
  TOOLS_FRONTMATTER: 'warning',

  MCP_REMOTE: 'info',
  MCP_STDIO: 'info',
  MCP_DISABLED: 'info',
  MCP_AUTH_MANUAL: 'warning',
  MCP_INVALID_NAME: 'error',

  ARGS_SUBSTITUTION: 'info',
  POSITIONAL_ARGS: 'info',
  SHELL_INJECTION: 'warning',
  MODEL_OVERRIDE_IGNORED: 'warning',
  EDIT_DENY_ADAPTED: 'warning',
  NAME_COLLISION: 'info',
  HOST_COMMAND_COLLISION: 'info',
  MCP_PRESETS_REQUIRED: 'info',
  RESOURCE_READ_FAILED: 'error',

  REPAIRED: 'info',
  UPDATED: 'info',
  FORCED: 'warning',
  CONFLICT: 'warning',
  ORPHAN_ARTIFACT: 'warning',
  NAME_CONFLICT: 'warning',

  MISSING_ARTIFACT: 'error',
  DRIFT: 'warning',
  LOCKFILE_MISSING: 'warning',
  DISCOVERY_MISS: 'error',
};

export interface FindingInput {
  readonly path?: string;
  readonly capability?: Capability;
  readonly severity?: Severity;
}

/** Build a finding with the code's default severity. */
export function finding(
  code: FindingCode,
  message: string,
  input: FindingInput = {},
): Finding {
  return {
    code,
    severity: input.severity ?? DEFAULT_SEVERITY[code],
    message,
    ...(input.path === undefined ? {} : { path: input.path }),
    ...(input.capability === undefined ? {} : { capability: input.capability }),
  };
}

/** Locale-independent string compare, so output never depends on host locale. */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Deterministic finding order: code, then path, then message. */
export function sortFindings(items: readonly Finding[]): Finding[] {
  return [...items].sort(
    (a, b) =>
      compareCodeUnits(a.code, b.code) ||
      compareCodeUnits(a.path ?? '', b.path ?? '') ||
      compareCodeUnits(a.message, b.message),
  );
}

/** Findings of `error` severity block `apply` (spec §10); useful to callers. */
export function hasBlockingFindings(items: readonly Finding[]): boolean {
  return items.some((item) => item.severity === 'error');
}
