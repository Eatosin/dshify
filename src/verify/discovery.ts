import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ScanLimits } from '../core/adapter.js';
import { coerceStrictBoolean, parseMarkdown, singleLineString } from '../core/frontmatter.js';
import { KEBAB_CASE } from '../core/ir.js';
import { repoRelative } from '../core/paths.js';

/**
 * Static DSH discovery simulation. Contract: docs/spec.md §8 and architecture §3.3.
 *
 * This is the offline, cross-platform verification layer: it re-implements what
 * a DSH session would catalog from the repository skill roots, so `check` can
 * prove an emitted skill is visible without launching a harness.
 *
 * Every rule below cites the shipped README it derives from:
 *
 * - Roots and ranks — `@deepseek-ai/dsh-skill-filesystem` README (0.2.2-rc.1):
 *   project roots are `<projectRoot>/.dsh/skills` (rank 100) and
 *   `<projectRoot>/.agents/skills` (rank 200); custom and user roots (300/400/500)
 *   are outside this offline simulation.
 * - One level deep — same README: "Discovery is one level deep — only
 *   `<root>/<name>/SKILL.md` and `<root>/<name>.md` are recognized; nested skill
 *   trees and package manifests are ignored."
 * - Frontmatter — same README: `name` must be kebab-case, `description` is
 *   required, and the invocation keys resolve through a strict boolean grammar;
 *   "a rejected spelling or a non-boolean value drops the whole skill with a
 *   warning".
 * - Missing roots are valid empty state ("Confirmed missing paths are valid
 *   empty state; malformed or non-text entries warn and skip").
 */

export interface DiscoveryLimits {
  readonly maxFileBytes: number;
  /** Repository-relative roots to simulate. Defaults to the two project roots. */
  readonly roots?: readonly string[];
}

export const DEFAULT_DISCOVERY_ROOTS = ['.dsh/skills', '.agents/skills'] as const;

export type SkipReason =
  | 'invalid-frontmatter'
  | 'missing-name'
  | 'invalid-name'
  | 'name-mismatch'
  | 'missing-description'
  | 'invalid-invocation'
  | 'unreadable';

export interface VisibleSkill {
  /** Repo-relative path of the discovered bundle or flat file. */
  readonly path: string;
  readonly name: string;
  readonly description: string;
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
  /** Repo-relative root that supplied it. */
  readonly root: string;
}

export interface SkippedEntry {
  readonly path: string;
  readonly reason: SkipReason;
}

export interface DiscoveryResult {
  readonly visible: VisibleSkill[];
  readonly skipped: SkippedEntry[];
  /** Roots that existed. */
  readonly roots: string[];
  /** False when a root could not be read (I/O failure), not when it is absent. */
  readonly complete: boolean;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

async function listDirect(absolute: string): Promise<Dirent[] | undefined> {
  try {
    const entries = await readdir(absolute, { withFileTypes: true });
    return [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (error) {
    if (isNotFound(error)) return [];
    return undefined; // unreadable root: incomplete observation
  }
}

async function isFile(absolute: string): Promise<boolean> {
  try {
    return (await stat(absolute)).isFile();
  } catch {
    return false;
  }
}

interface ParseResult {
  readonly visible?: VisibleSkill;
  readonly skip?: SkipReason;
}

async function inspectCandidate(
  file: string,
  expectedName: string,
  rootRelative: string,
  repoRoot: string,
  limits: DiscoveryLimits,
): Promise<ParseResult> {
  let text: string;
  try {
    const bytes = await readFile(file);
    if (bytes.length > limits.maxFileBytes) return { skip: 'unreadable' };
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  } catch {
    return { skip: 'unreadable' };
  }

  let parsed;
  try {
    parsed = parseMarkdown(text);
  } catch {
    return { skip: 'invalid-frontmatter' };
  }
  if (!parsed.hasFrontmatter) return { skip: 'missing-name' };

  const nameValue = parsed.data.name;
  if (typeof nameValue !== 'string') return { skip: 'missing-name' };
  if (!KEBAB_CASE.test(nameValue)) return { skip: 'invalid-name' };
  if (nameValue !== expectedName) return { skip: 'name-mismatch' };

  const description = singleLineString(parsed.data.description);
  if (description === undefined) return { skip: 'missing-description' };

  const disableRaw = parsed.data['disable-model-invocation'];
  const userRaw = parsed.data['user-invocable'];
  const disable = disableRaw === undefined ? false : coerceStrictBoolean(disableRaw);
  const user = userRaw === undefined ? true : coerceStrictBoolean(userRaw);
  if (disable === undefined || user === undefined) return { skip: 'invalid-invocation' };

  return {
    visible: {
      path: repoRelative(repoRoot, file),
      name: nameValue,
      description,
      modelInvocable: !disable,
      userInvocable: user,
      root: rootRelative,
    },
  };
}

/**
 * Simulate what a DSH session would catalog from `repoRoot`.
 *
 * Never throws for user content: malformed entries are listed in `skipped`.
 */
export async function verifyDiscovery(
  repoRoot: string,
  limits: DiscoveryLimits,
): Promise<DiscoveryResult> {
  const rootsToScan = limits.roots ?? DEFAULT_DISCOVERY_ROOTS;
  const visible: VisibleSkill[] = [];
  const skipped: SkippedEntry[] = [];
  const roots: string[] = [];
  let complete = true;

  for (const rootRelative of rootsToScan) {
    const rootAbs = path.join(repoRoot, rootRelative);
    const entries = await listDirect(rootAbs);
    if (entries === undefined) {
      complete = false;
      continue;
    }
    if (entries.length === 0 && !(await isFile(rootAbs))) {
      // A missing directory is valid empty state; distinguish existing-empty.
      try {
        const info = await stat(rootAbs);
        if (!info.isDirectory()) continue;
      } catch {
        continue;
      }
    }
    roots.push(rootRelative);

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        const file = path.join(rootAbs, entry.name, 'SKILL.md');
        if (!(await isFile(file))) continue; // not a bundle: ignored, not an error
        const result = await inspectCandidate(file, entry.name, rootRelative, repoRoot, limits);
        if (result.visible !== undefined) visible.push(result.visible);
        if (result.skip !== undefined) {
          skipped.push({ path: repoRelative(repoRoot, file), reason: result.skip });
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const expected = entry.name.slice(0, -3);
        const file = path.join(rootAbs, entry.name);
        const result = await inspectCandidate(file, expected, rootRelative, repoRoot, limits);
        if (result.visible !== undefined) visible.push(result.visible);
        if (result.skip !== undefined) {
          skipped.push({ path: repoRelative(repoRoot, file), reason: result.skip });
        }
      }
    }
  }

  visible.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { visible, skipped, roots, complete };
}
