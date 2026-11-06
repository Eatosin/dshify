import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ScanLimits } from './adapter.js';

/**
 * Reading source files with the limits from spec §12.
 *
 * Nothing here mutates the source tree: every helper is read-only, which is what
 * makes the "never touch the source harness" invariant structural rather than a
 * matter of discipline.
 */

export const DEFAULT_SCAN_LIMITS: ScanLimits = {
  maxFileBytes: 1024 * 1024,
  maxItems: 5000,
};

/** A file exceeded `limits.maxFileBytes`. A per-item problem, not infrastructure. */
export class SourceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceLimitError';
  }
}

/** A file is not valid UTF-8 (spec §12: only UTF-8 text is converted). */
export class SourceEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceEncodingError';
  }
}

export async function readSourceBytes(absolute: string, limits: ScanLimits): Promise<Buffer> {
  const buffer = await readFile(absolute);
  if (buffer.length > limits.maxFileBytes) {
    throw new SourceLimitError(
      `file is ${buffer.length} bytes, over the ${limits.maxFileBytes}-byte limit`,
    );
  }
  return buffer;
}

/** UTF-8 text with a leading BOM stripped. Throws on invalid UTF-8. */
export async function readSourceText(absolute: string, limits: ScanLimits): Promise<string> {
  const buffer = await readSourceBytes(absolute, limits);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new SourceEncodingError('file is not valid UTF-8');
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function sha256OfFile(absolute: string, limits: ScanLimits): Promise<string> {
  return sha256Hex(await readSourceBytes(absolute, limits));
}
