import { stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { DshifyError } from './errors.js';

/**
 * Path resolution and containment (spec §11).
 *
 * The scanned root is the path the caller named. The containing repository root
 * (nearest ancestor with `.git`) is resolved separately because it governs where
 * `apply` may write — a fixture inside this repo is still a valid scan root, but
 * it is not where artifacts belong.
 */

export interface ResolvedRoots {
  /** Absolute, real path of the directory being scanned. */
  readonly scanRoot: string;
  /** Absolute, real path of the containing repository (scanRoot when none). */
  readonly repoRoot: string;
  /** True when no `.git` ancestor was found (reported as `ROOT_GUESS`). */
  readonly repoGuessed: boolean;
}

async function assertDirectory(absolute: string, label: string): Promise<string> {
  let stats;
  try {
    stats = await stat(absolute);
  } catch {
    throw DshifyError.usage(`${label} does not exist: ${absolute}`);
  }
  if (!stats.isDirectory()) {
    throw DshifyError.usage(`${label} is not a directory: ${absolute}`);
  }
  return realpath(absolute);
}

async function directoryExists(absolute: string): Promise<boolean> {
  try {
    return (await stat(absolute)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve the scan root and its containing repository.
 *
 * Throws `DshifyError` (exit 2) when the path is missing or not a directory.
 */
export async function resolveRoots(input: string): Promise<ResolvedRoots> {
  const scanRoot = await assertDirectory(path.resolve(input), 'path');
  let current = scanRoot;
  for (;;) {
    if (await directoryExists(path.join(current, '.git'))) {
      return { scanRoot, repoRoot: current, repoGuessed: false };
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return { scanRoot, repoRoot: scanRoot, repoGuessed: true };
    }
    current = parent;
  }
}

/** True when `candidate` is `root` itself or inside it. Both must be absolute. */
export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === '') return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Repo-relative POSIX path, used anywhere a report or artifact path is written. */
export function repoRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/');
}

/** POSIX form of a path, for artifact and report output. */
export function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}
