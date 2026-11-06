import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Artifact, Finding, HarnessIR } from './ir.js';
import { SeveritySchema } from './ir.js';
import { DshifyError } from './errors.js';
import { repoRelative } from './paths.js';
import { compareCodeUnits } from './report.js';
import { sha256Hex } from './source.js';

/**
 * Ownership + drift record. Contract: docs/spec.md §9.
 *
 * Committed in the target repo. Rules: sorted arrays, no timestamps, hashes are
 * lowercase hex SHA-256 of the exact bytes. `generatedBy.version` is
 * informational — drift comparison looks only at `sources` and `artifacts`.
 */

export const LOCKFILE_VERSION = 1;
export const LOCKFILE_NAME = '.dshify.lock.json';
export const GENERATOR_NAME = 'dshify';

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const LockSourceRefSchema = z
  .object({ path: z.string().min(1), sha256: Sha256Schema })
  .strict();
export type LockSourceRef = z.infer<typeof LockSourceRefSchema>;

export const LockArtifactSchema = z
  .object({
    path: z.string().min(1),
    kind: z.string().min(1),
    sha256: Sha256Schema,
    sources: z.array(LockSourceRefSchema),
  })
  .strict();
export type LockArtifact = z.infer<typeof LockArtifactSchema>;

export const LockSourceRootSchema = z
  .object({
    harness: z.string().min(1),
    path: z.string().min(1),
    kind: z.string().min(1),
  })
  .strict();
export type LockSourceRoot = z.infer<typeof LockSourceRootSchema>;

export const LockLossSchema = z
  .object({
    code: z.string().min(1),
    severity: SeveritySchema,
    detail: z.string().min(1),
  })
  .strict();
export type LockLoss = z.infer<typeof LockLossSchema>;

export const DshifyLockfileSchema = z
  .object({
    lockfileVersion: z.literal(LOCKFILE_VERSION),
    generatedBy: z
      .object({ name: z.literal(GENERATOR_NAME), version: z.string().min(1) })
      .strict(),
    sourceRoots: z.array(LockSourceRootSchema),
    sources: z.array(LockSourceRefSchema),
    artifacts: z.array(LockArtifactSchema),
    losses: z.array(LockLossSchema),
  })
  .strict();
export type DshifyLockfile = z.infer<typeof DshifyLockfileSchema>;

function sortByPath<T extends { path: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareCodeUnits(a.path, b.path));
}

function dedupeSources(items: readonly LockSourceRef[]): LockSourceRef[] {
  const byPath = new Map<string, LockSourceRef>();
  for (const item of items) {
    if (!byPath.has(item.path)) byPath.set(item.path, item);
  }
  return sortByPath([...byPath.values()]);
}

/** Canonical form: fixed key order, sorted arrays, deduped sources. */
export function canonicalLockfile(value: DshifyLockfile): DshifyLockfile {
  return {
    lockfileVersion: LOCKFILE_VERSION,
    generatedBy: { name: GENERATOR_NAME, version: value.generatedBy.version },
    sourceRoots: [...value.sourceRoots].sort(
      (a, b) => compareCodeUnits(a.path, b.path) || compareCodeUnits(a.kind, b.kind),
    ),
    sources: dedupeSources(value.sources),
    artifacts: sortByPath(
      value.artifacts.map((artifact) => ({
        path: artifact.path,
        kind: artifact.kind,
        sha256: artifact.sha256,
        sources: dedupeSources(artifact.sources),
      })),
    ),
    losses: [...value.losses].sort(
      (a, b) => compareCodeUnits(a.code, b.code) || compareCodeUnits(a.detail, b.detail),
    ),
  };
}

/** The exact bytes written to disk: canonical JSON, two spaces, trailing newline. */
export function serializeLockfile(value: DshifyLockfile): string {
  return `${JSON.stringify(canonicalLockfile(value), null, 2)}\n`;
}

export function parseLockfile(text: string, source: string): DshifyLockfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw DshifyError.internal(`invalid lockfile ${source}: ${detail}`);
  }
  const result = DshifyLockfileSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue === undefined ? 'unknown' : issue.path.join('.');
    throw DshifyError.internal(`invalid lockfile ${source}: ${where} ${issue?.message ?? ''}`.trim());
  }
  return canonicalLockfile(result.data);
}

export async function readLockfile(absolute: string): Promise<DshifyLockfile | undefined> {
  let text: string;
  try {
    text = await readFile(absolute, 'utf8');
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return undefined;
    }
    throw DshifyError.internal(`cannot read lockfile ${absolute}: ${String(error)}`);
  }
  return parseLockfile(text, absolute);
}

/** Drift comparison looks only at `sources` and `artifacts` (spec §9). */
export function lockfileContentEqual(a: DshifyLockfile, b: DshifyLockfile): boolean {
  return (
    JSON.stringify(canonicalLockfile(a).sources) === JSON.stringify(canonicalLockfile(b).sources) &&
    JSON.stringify(canonicalLockfile(a).artifacts) ===
      JSON.stringify(canonicalLockfile(b).artifacts)
  );
}

export function lockArtifactFor(artifact: Artifact, repoRoot: string): LockArtifact {
  return {
    path: artifact.path,
    kind: artifact.kind,
    sha256: sha256Hex(artifact.bytes),
    sources: dedupeSources(
      artifact.sources.map((source) => ({
        path: repoRelative(repoRoot, source.path),
        sha256: source.sha256,
      })),
    ),
  };
}

export function sourceRootsFor(ir: HarnessIR, repoRoot: string): LockSourceRoot[] {
  const roots = (ir.roots ?? []).map((root) => ({
    harness: ir.harness,
    path: repoRelative(repoRoot, root.path),
    kind: 'skills',
  }));
  const seen = new Set<string>();
  return roots
    .filter((root) => {
      if (seen.has(root.path)) return false;
      seen.add(root.path);
      return true;
    })
    .sort((a, b) => compareCodeUnits(a.path, b.path) || compareCodeUnits(a.kind, b.kind));
}

export function lossEntriesFor(losses: readonly Finding[]): LockLoss[] {
  return losses
    .map((loss) => ({
      code: loss.code,
      severity: loss.severity,
      detail: loss.message,
    }))
    .sort((a, b) => compareCodeUnits(a.code, b.code) || compareCodeUnits(a.detail, b.detail));
}

export function sourcesFromArtifacts(artifacts: readonly Artifact[], repoRoot: string): LockSourceRef[] {
  return dedupeSources(artifacts.flatMap((artifact) => lockArtifactFor(artifact, repoRoot).sources));
}

/** Union of the source references across lockfile artifact entries. */
export function sourcesFromEntries(entries: readonly LockArtifact[]): LockSourceRef[] {
  return dedupeSources(entries.flatMap((entry) => entry.sources));
}
