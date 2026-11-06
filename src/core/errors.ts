/**
 * Typed failure modes.
 *
 * User-content problems are findings, not exceptions (see `report.ts`); this
 * class is reserved for infrastructure failure, usage error, and bugs. The CLI
 * maps `exitCode` straight through, so the codes here are part of the public
 * contract in `docs/cli.md`.
 */
export type DshifyErrorCode = 'USAGE' | 'SCAN_FAILED' | 'INTERNAL' | 'UNSUPPORTED';

export class DshifyError extends Error {
  readonly code: DshifyErrorCode;
  readonly exitCode: number;

  constructor(code: DshifyErrorCode, message: string, exitCode: number) {
    super(message);
    this.name = 'DshifyError';
    this.code = code;
    this.exitCode = exitCode;
  }

  static usage(message: string): DshifyError {
    return new DshifyError('USAGE', message, 2);
  }

  static scanFailed(message: string): DshifyError {
    return new DshifyError('SCAN_FAILED', message, 1);
  }

  static internal(message: string): DshifyError {
    return new DshifyError('INTERNAL', message, 1);
  }

  /** An explicitly requested construct this version does not support (exit 5). */
  static unsupported(message: string): DshifyError {
    return new DshifyError('UNSUPPORTED', message, 5);
  }
}

export function isDshifyError(value: unknown): value is DshifyError {
  return value instanceof DshifyError;
}

/** Human-readable one-liner for stderr. Never includes a stack. */
export function describeError(value: unknown): string {
  if (isDshifyError(value)) return value.message;
  if (value instanceof Error) return value.message;
  return String(value);
}
