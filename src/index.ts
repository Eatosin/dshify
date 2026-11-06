export { VERSION } from './version.js';
export { COMMANDS, run } from './cli.js';
export type { CliIO, Command } from './cli.js';
export type { HarnessAdapter, HarnessId, ScanInput, ScanLimits } from './core/adapter.js';
export { DshifyError, isDshifyError } from './core/errors.js';
export {
  ARTIFACT_KINDS,
  CAPABILITIES,
  HOST_COMMANDS,
  HarnessIRSchema,
  KEBAB_CASE,
  SOURCE_ROOT_KINDS,
} from './core/ir.js';
export type {
  AccessMode,
  Artifact,
  ArtifactKind,
  Capability,
  Command as CommandIR,
  Conflict,
  Finding,
  HarnessIR,
  McpServer,
  Persona,
  PlannedOutput,
  Provenance,
  Skill,
  SourceRootKind,
} from './core/ir.js';
export { applyRepo } from './core/apply.js';
export type {
  ApplyArtifactResult,
  ApplyOptions,
  ApplyResult,
  ApplyStatus,
} from './core/apply.js';
export {
  DshifyLockfileSchema,
  LOCKFILE_NAME,
  LOCKFILE_VERSION,
  canonicalLockfile,
  lockfileContentEqual,
  parseLockfile,
  readLockfile,
  serializeLockfile,
} from './core/lockfile.js';
export type {
  DshifyLockfile,
  LockArtifact,
  LockLoss,
  LockSourceRef,
  LockSourceRoot,
} from './core/lockfile.js';
export { planRepo, resolveDest } from './core/plan.js';
export type { PlanOptions } from './core/plan.js';
export { DEFAULT_SEVERITY, FINDING_CODES, finding, sortFindings } from './core/report.js';
export type { FindingCode } from './core/report.js';
export { getAdapter, listAdapters, scanRepo } from './core/scan.js';
export { DEFAULT_SCAN_LIMITS } from './core/source.js';
