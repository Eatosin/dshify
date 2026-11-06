import { describe, expect, it } from 'vitest';
import {
  FrontmatterError,
  coerceStrictBoolean,
  parseMarkdown,
  singleLineString,
  unknownKeys,
} from '../src/core/frontmatter.js';

describe('parseMarkdown', () => {
  it('splits frontmatter from the body without altering body bytes', () => {
    const text = '---\nname: demo\ndescription: Demo skill.\n---\n\n# Body\n\nText.\n';
    const parsed = parseMarkdown(text);
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.data).toEqual({ name: 'demo', description: 'Demo skill.' });
    expect(parsed.body).toBe('\n# Body\n\nText.\n');
  });

  it('preserves CRLF line endings in the body', () => {
    const text = '---\r\nname: demo\r\n---\r\nline one\r\nline two\r\n';
    const parsed = parseMarkdown(text);
    expect(parsed.body).toBe('line one\r\nline two\r\n');
  });

  it('returns the whole text as body when there is no frontmatter', () => {
    const text = '# No frontmatter\n\nBody only.\n';
    expect(parseMarkdown(text)).toEqual({
      hasFrontmatter: false,
      data: {},
      body: text,
    });
  });

  it('accepts an empty frontmatter block', () => {
    const parsed = parseMarkdown('---\n---\nbody\n');
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe('body\n');
  });

  it('throws on an unterminated block', () => {
    expect(() => parseMarkdown('---\nname: demo\nbody-without-close\n')).toThrow(
      FrontmatterError,
    );
  });

  it('throws on invalid YAML', () => {
    expect(() => parseMarkdown('---\nname: [unclosed\n---\nbody\n')).toThrow(FrontmatterError);
  });

  it('throws when the document is not a mapping', () => {
    expect(() => parseMarkdown('---\n- one\n- two\n---\nbody\n')).toThrow(FrontmatterError);
  });
});

describe('coerceStrictBoolean', () => {
  it('accepts booleans and the documented spellings', () => {
    expect(coerceStrictBoolean(true)).toBe(true);
    expect(coerceStrictBoolean(false)).toBe(false);
    for (const value of ['true', 'TRUE', 'yes', 'on', '1']) {
      expect(coerceStrictBoolean(value)).toBe(true);
    }
    for (const value of ['false', 'No', 'OFF', '0']) {
      expect(coerceStrictBoolean(value)).toBe(false);
    }
  });

  it('rejects everything else, so the caller can mark the skill malformed', () => {
    expect(coerceStrictBoolean('maybe')).toBeUndefined();
    expect(coerceStrictBoolean(1)).toBeUndefined();
    expect(coerceStrictBoolean(null)).toBeUndefined();
  });
});

describe('singleLineString', () => {
  it('trims and accepts a non-empty single line', () => {
    expect(singleLineString('  Review code.  ')).toBe('Review code.');
  });

  it('rejects empty, whitespace-only, non-string and multi-line values', () => {
    expect(singleLineString('   ')).toBeUndefined();
    expect(singleLineString('two\nlines')).toBeUndefined();
    expect(singleLineString(42)).toBeUndefined();
  });
});

describe('unknownKeys', () => {
  it('returns unknown keys sorted, ignoring allowed ones', () => {
    const data = { name: 'x', description: 'y', zebra: 1, alpha: 2 };
    expect(unknownKeys(data, ['name', 'description'])).toEqual(['alpha', 'zebra']);
  });
});
