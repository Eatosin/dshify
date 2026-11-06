import { z } from 'zod';

/**
 * Normalized IR for a source harness. Contract: docs/spec.md §6.
 *
 * The spec sketch is the intent; this file is the authoritative schema. Extra
 * typed fields are allowed by §6 ("no untyped extras"), and each one is
 * justified at its declaration.
 */

export const CAPABILITIES = ['exact', 'adapted', 'lossy', 'manual', 'unsupported'] as const;
export const CapabilitySchema = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof CapabilitySchema>;

export const SEVERITIES = ['info', 'warning', 'error'] as const;
export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof SeveritySchema>;

/** Kebab-case identity shared by emitted names and emitted directory names. */
export const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * DSH host commands that win `/name` over a skill. Spec §7 rev. 2: the six
 * shipped built-ins from `@deepseek-ai/dsh-commands` 0.2.2-rc.1. Keeping this
 * list in one place is what makes the collision rule checkable.
 */
export const HOST_COMMANDS = [
  'plan',
  'compact',
  'goal',
  'permission',
  'feedback',
  'export',
] as const;

/**
 * Where a source file came from: a harness default root, a root listed in the
 * harness config, the already-native `.agents/skills` root, or the repo itself
 * (include files such as `AGENTS.md`). `native` matters to the planner: DSH
 * scans that root already, so those skills are reported and never duplicated.
 */
export const SOURCE_ROOT_KINDS = ['default', 'configured', 'native', 'repo'] as const;
export const SourceRootKindSchema = z.enum(SOURCE_ROOT_KINDS);
export type SourceRootKind = z.infer<typeof SourceRootKindSchema>;

export const ProvenanceSchema = z
  .object({
    /** Absolute source path (spec §5.1); relative paths are computed for reports. */
    path: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    adapter: z.string().min(1),
    rootKind: SourceRootKindSchema,
  })
  .strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** One reported fact. Shape from spec §10. */
export const FindingSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    severity: SeveritySchema,
    message: z.string().min(1),
    path: z.string().min(1).optional(),
    capability: CapabilitySchema.optional(),
  })
  .strict();
export type Finding = z.infer<typeof FindingSchema>;

export const InvocationSchema = z
  .object({ model: z.boolean(), user: z.boolean() })
  .strict();
export type Invocation = z.infer<typeof InvocationSchema>;

export const SkillSchema = z
  .object({
    id: z.string().regex(KEBAB_CASE),
    description: z.string().min(1),
    body: z.string(),
    invocation: InvocationSchema,
    /** Paths relative to the skill directory, sorted. */
    resources: z.array(z.string().min(1)),
    provenance: ProvenanceSchema,
    capability: CapabilitySchema,
    /** Source spelling when it differs from the normalized `id` (spec §6). */
    sourceName: z.string().min(1).optional(),
  })
  .strict();
export type Skill = z.infer<typeof SkillSchema>;

export const PLACEHOLDERS = ['arguments', 'positional', 'shell-injection'] as const;
export const PlaceholderSchema = z.enum(PLACEHOLDERS);
export type Placeholder = z.infer<typeof PlaceholderSchema>;

export const CommandSchema = z
  .object({
    name: z.string().regex(KEBAB_CASE),
    description: z.string().min(1),
    body: z.string(),
    placeholders: z.array(PlaceholderSchema),
    targetAgent: z.string().min(1).optional(),
    provenance: ProvenanceSchema,
    capability: CapabilitySchema,
  })
  .strict();
export type Command = z.infer<typeof CommandSchema>;

export const ACCESS_MODES = ['read-only', 'writable'] as const;
export const AccessModeSchema = z.enum(ACCESS_MODES);
export type AccessMode = z.infer<typeof AccessModeSchema>;

export const PersonaSchema = z
  .object({
    id: z.string().regex(KEBAB_CASE),
    description: z.string().min(1),
    body: z.string(),
    access: AccessModeSchema,
    modelHint: z.string().min(1).optional(),
    provenance: ProvenanceSchema,
    capability: CapabilitySchema,
  })
  .strict();
export type Persona = z.infer<typeof PersonaSchema>;

export const TRANSPORTS = ['stdio', 'streamable-http'] as const;
export const TransportSchema = z.enum(TRANSPORTS);
export type Transport = z.infer<typeof TransportSchema>;

export const MCP_AUTH_KINDS = ['none', 'header', 'oauth', 'unknown'] as const;
export const McpAuthSchema = z.enum(MCP_AUTH_KINDS);
export type McpAuth = z.infer<typeof McpAuthSchema>;

/** MCP row. Secret values are never stored — only the auth shape (spec §11). */
export const McpServerSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
    transport: TransportSchema,
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    url: z.string().min(1).optional(),
    auth: McpAuthSchema,
    disabled: z.boolean(),
    provenance: ProvenanceSchema,
    capability: CapabilitySchema,
  })
  .strict();
export type McpServer = z.infer<typeof McpServerSchema>;

/**
 * Planned artifact. Contract: docs/architecture.md §3.2 and docs/spec.md §5.2.
 * Bytes are computed in memory; `apply` is the only writer.
 */
export const ARTIFACT_KINDS = [
  'skill',
  'command-skill',
  'persona-skill',
  'skill-resource',
  'bundle-manifest',
  'bundle-patch',
] as const;
export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export interface Artifact {
  /** Repo-relative POSIX destination path. */
  readonly path: string;
  readonly kind: ArtifactKind;
  readonly bytes: Uint8Array;
  readonly sources: readonly Provenance[];
  readonly capability: Capability;
}

/** A blocking or reportable conflict detected while planning. */
export interface Conflict {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/** Plan output. Contract: docs/spec.md §5.2. */
export interface PlannedOutput {
  readonly artifacts: readonly Artifact[];
  readonly losses: readonly Finding[];
  readonly conflicts: readonly Conflict[];
}

export const HarnessIRSchema = z
  .object({
    harness: z.literal('opencode'),
    /** Adapter version, not the DSH version. */
    version: z.string().min(1),
    /** The scanned root (absolute). */
    root: z.string().min(1),
    skills: z.array(SkillSchema),
    commands: z.array(CommandSchema),
    personas: z.array(PersonaSchema),
    mcpServers: z.array(McpServerSchema),
    agentsMd: ProvenanceSchema.optional(),
    /** Scan-time findings; plan adds the loss/conflict report. */
    warnings: z.array(FindingSchema),
  })
  .strict();
export type HarnessIR = z.infer<typeof HarnessIRSchema>;
