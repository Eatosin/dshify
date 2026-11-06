import { parse } from 'yaml';

/**
 * Markdown frontmatter parsing for source harnesses.
 *
 * The body is returned as the exact substring after the closing delimiter, so
 * body bytes survive conversion unchanged (spec §6: "Body text is byte-preserved
 * except for documented placeholder rewriting").
 */
export class FrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrontmatterError';
  }
}

export interface ParsedMarkdown {
  readonly hasFrontmatter: boolean;
  readonly data: Readonly<Record<string, unknown>>;
  readonly body: string;
}

const DELIMITER = '---';

function isDelimiter(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === DELIMITER || trimmed === '...';
}

/**
 * Split `---` frontmatter from the body.
 *
 * Throws `FrontmatterError` for an unterminated block, invalid YAML, or a
 * non-mapping document — callers turn that into a `MALFORMED_*` finding.
 */
export function parseMarkdown(text: string): ParsedMarkdown {
  // Keep line endings so the body substring is exact.
  const lines = text.split(/(?<=\n)/);
  const first = lines[0];
  if (first === undefined || first.trim() !== DELIMITER) {
    return { hasFrontmatter: false, data: {}, body: text };
  }

  let close = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line !== undefined && isDelimiter(line)) {
      close = index;
      break;
    }
  }
  if (close < 0) {
    throw new FrontmatterError('unterminated frontmatter block (missing closing ---)');
  }

  const yamlText = lines.slice(1, close).join('');
  const body = lines.slice(close + 1).join('');

  let parsed: unknown;
  try {
    parsed = parse(yamlText);
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    throw new FrontmatterError(`invalid YAML frontmatter: ${message ?? 'parse error'}`);
  }
  if (parsed === null || parsed === undefined) {
    return { hasFrontmatter: true, data: {}, body };
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new FrontmatterError('frontmatter must be a YAML mapping');
  }
  return {
    hasFrontmatter: true,
    data: parsed as Record<string, unknown>,
    body,
  };
}

/**
 * The boolean grammar DSH accepts for invocation keys: YAML booleans plus the
 * documented string spellings. Returns `undefined` when the value is not one of
 * them, so the caller can report the skill as malformed instead of guessing.
 *
 * Source: `@deepseek-ai/dsh-skill-filesystem` README ("a rejected spelling or a
 * non-boolean value drops the whole skill with a warning").
 */
export function coerceStrictBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes' || normalized === 'on' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === 'no' || normalized === 'off' || normalized === '0') {
      return false;
    }
  }
  return undefined;
}

/** Single-line, non-empty string check used by several frontmatter fields. */
export function singleLineString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.includes('\n') || trimmed.includes('\r')) return undefined;
  return trimmed;
}

/** Keys not owned by this adapter, reported as `UNKNOWN_FIELD`. */
export function unknownKeys(
  data: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): string[] {
  const allowedSet = new Set(allowed);
  return Object.keys(data)
    .filter((key) => !allowedSet.has(key))
    .sort();
}
