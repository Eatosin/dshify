export { VERSION } from './version.js';
export { COMMANDS, run } from './cli.js';
export type { CliIO, Command } from './cli.js';
export type { HarnessAdapter, HarnessId, ScanInput, ScanLimits } from './core/adapter.js';
export { DshifyError, isDshifyError } from './core/errors.js';
export {
  CAPABILITIES,
  HOST_COMMANDS,
  HarnessIRSchema,
  KEBAB_CASE,
  SOURCE_ROOT_KINDS,
} from './core/ir.js';
export type {
  AccessMode,
  Capability,
  Command as CommandIR,
  Finding,
  HarnessIR,
  McpServer,
  Persona,
  Provenance,
  Skill,
  SourceRootKind,
} from './core/ir.js';
export { DEFAULT_SEVERITY, FINDING_CODES, finding, sortFindings } from './core/report.js';
export type { FindingCode } from './core/report.js';
export { getAdapter, listAdapters, scanRepo } from './core/scan.js';
export { DEFAULT_SCAN_LIMITS } from './core/source.js';
