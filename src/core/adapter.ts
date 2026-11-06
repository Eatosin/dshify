import type { Capability, HarnessIR } from './ir.js';

/**
 * The seams adapters and emitters implement. Contract: docs/architecture.md §3.
 *
 * Kept free of I/O so the interface can be imported by tests and by the future
 * DSH plugin wrapper without pulling in Node-specific code.
 */

export type HarnessId = 'opencode' | 'claude-code' | 'codex';

export interface ScanLimits {
  /** Reject a single source file larger than this (spec §12: 1 MiB bodies). */
  readonly maxFileBytes: number;
  /** Reject a scan that would produce more than this many items. */
  readonly maxItems: number;
}

export interface ScanInput {
  /** Absolute scan root, already resolved by the caller. */
  readonly root: string;
  /** Extra roots from `--root`, absolute or scan-root-relative. */
  readonly extraRoots: readonly string[];
  readonly limits: ScanLimits;
  readonly signal?: AbortSignal;
}

export interface HarnessAdapter {
  readonly id: HarnessId;
  readonly displayName: string;
  /** Adapter version, reported in the IR and the JSON envelope. */
  readonly version: string;
  /** Read the source repo. Pure with respect to the filesystem. */
  scan(input: ScanInput): Promise<HarnessIR>;
  /** Declare which source capabilities the adapter can even observe. */
  readonly capabilities: Readonly<Record<string, Capability>>;
}
