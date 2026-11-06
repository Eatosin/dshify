import type { HarnessAdapter, HarnessId, ScanInput } from './adapter.js';
import { DshifyError, describeError } from './errors.js';
import type { HarnessIR } from './ir.js';
import { HarnessIRSchema } from './ir.js';
import { opencodeAdapter } from '../adapters/opencode/index.js';

/**
 * Adapter dispatch and IR validation. Contract: docs/spec.md §5.1.
 *
 * The dispatcher owns infrastructure failure only: user-content problems are
 * findings produced by the adapter (architecture §3.1). Whatever an adapter
 * returns is validated against the IR schema before any downstream stage trusts
 * it, so a bug becomes a loud internal error rather than silent bad output.
 */

const ADAPTERS: readonly HarnessAdapter[] = [opencodeAdapter];

export function listAdapters(): readonly HarnessAdapter[] {
  return ADAPTERS;
}

export function getAdapter(id: HarnessId): HarnessAdapter {
  const adapter = ADAPTERS.find((candidate) => candidate.id === id);
  if (adapter === undefined) {
    throw DshifyError.internal(`no adapter registered for harness "${id}"`);
  }
  return adapter;
}

/** Run the adapter for `input` and return schema-validated IR. */
export async function scanRepo(input: ScanInput): Promise<HarnessIR> {
  if (input.signal?.aborted) {
    throw DshifyError.internal('scan aborted before it started');
  }
  const adapter = ADAPTERS[0];
  if (adapter === undefined) {
    throw DshifyError.internal('no harness adapter registered');
  }

  let ir: HarnessIR;
  try {
    ir = await adapter.scan(input);
  } catch (error) {
    if (error instanceof DshifyError) throw error;
    throw DshifyError.scanFailed(`scan failed: ${describeError(error)}`);
  }

  const validated = HarnessIRSchema.safeParse(ir);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    const where = issue === undefined ? 'unknown' : issue.path.join('.');
    const detail = issue === undefined ? 'invalid IR' : issue.message;
    throw DshifyError.internal(`internal error: adapter "${adapter.id}" produced invalid IR at ${where}: ${detail}`);
  }
  return validated.data;
}
