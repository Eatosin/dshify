import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  Artifact,
  ArtifactKind,
  Capability,
  Conflict,
  Finding,
  HarnessIR,
  PlannedOutput,
} from './ir.js';
import { DshifyError } from './errors.js';
import { isInside, repoRelative } from './paths.js';
import { planRepo, resolveDest } from './plan.js';
import { finding, sortFindings } from './report.js';
import { sha256Hex } from './source.js';
import {
  GENERATOR_NAME,
  LOCKFILE_NAME,
  LOCKFILE_VERSION,
  canonicalLockfile,
  lockArtifactFor,
  lossEntriesFor,
  readLockfile,
  resolveLockfileLocation,
  serializeLockfile,
  sourcesFromEntries,
  sourceRootsFor,
  type DshifyLockfile,
  type LockArtifact,
} from './lockfile.js';

/**
 * Apply. Contract: docs/spec.md §5.3 and §9.
 *
 * The only writer in the product, and it writes only inside `dest` plus the
 * lockfile. Conflict rows are reported and skipped unless `--force`; the
 * lockfile is written last, and only after the artifact loop has finished.
 */

export type ApplyStatus =
  | 'written'
  | 'updated'
  | 'unchanged'
  | 'repaired'
  | 'forced'
  | 'conflict'
  | 'name-conflict'
  | 'orphan';

export interface ApplyArtifactResult {
  readonly path: string;
  readonly kind: ArtifactKind;
  readonly capability: Capability;
  readonly status: ApplyStatus;
}

export interface ApplyOptions {
  readonly repoRoot: string;
  readonly dest: string;
  readonly lockfilePath: string;
  readonly presets: boolean;
  readonly strategy: 'copy' | 'link';
  readonly force: boolean;
  readonly version: string;
  readonly readResource: (absolute: string) => Promise<Uint8Array>;
  readonly presetPrefix?: string;
  readonly delegation?: readonly import('../emit/dsh/bundle.js').DelegationRoute[];
  readonly mainPreset?: import('../emit/dsh/bundle.js').MainPresetSpec;
  readonly extraPlugins?: readonly string[];
  readonly bundleName?: string;
}

export interface ApplyResult {
  readonly planned: PlannedOutput;
  readonly results: readonly ApplyArtifactResult[];
  readonly conflicts: readonly Conflict[];
  readonly findings: readonly Finding[];
  readonly lockfile: DshifyLockfile;
  readonly lockfilePath: string;
  readonly lockfileWritten: boolean;
  readonly ok: boolean;
}

async function isFile(absolute: string): Promise<boolean> {
  try {
    return (await stat(absolute)).isFile();
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error &&
        (error as { code?: unknown }).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/** Refuse to write through a symlink anywhere between `dest` and the target. */
async function assertNoSymlink(destAbs: string, targetAbs: string): Promise<void> {
  try {
    const destInfo = await lstat(destAbs);
    if (destInfo.isSymbolicLink()) {
      throw DshifyError.internal('refusing to write through a symlinked destination tree');
    }
  } catch (error) {
    if (
      !(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'ENOENT'
      )
    ) {
      throw error;
    }
  }
  const relative = path.relative(destAbs, targetAbs);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw DshifyError.internal(`refusing to write outside ${destAbs}: ${targetAbs}`);
  }
  const segments = relative.split(path.sep).filter((segment) => segment !== '');
  let current = destAbs;
  for (const segment of segments) {
    current = path.join(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error &&
          (error as { code?: unknown }).code === 'ENOENT') {
        return; // rest does not exist yet
      }
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw DshifyError.internal(
        `refusing to write through symlink ${repoRelative(destAbs, current)} under the destination`,
      );
    }
  }
}

async function writeAtomic(targetAbs: string, bytes: Uint8Array, destAbs: string): Promise<void> {
  const tmpDir = path.join(destAbs, '.dshify-tmp');
  await mkdir(tmpDir, { recursive: true, mode: 0o755 });
  const tmpPath = path.join(tmpDir, sha256Hex(bytes));
  await writeFile(tmpPath, bytes, { mode: 0o644 });
  await mkdir(path.dirname(targetAbs), { recursive: true, mode: 0o755 });
  await rename(tmpPath, targetAbs);
}

async function writeLockfileAtomic(lockfileAbs: string, text: string): Promise<void> {
  const tmpPath = `${lockfileAbs}.dshify-tmp`;
  await writeFile(tmpPath, text, { mode: 0o644 });
  try {
    await rename(tmpPath, lockfileAbs);
  } finally {
    await rm(tmpPath, { force: true });
  }
}


function statusFinding(status: ApplyStatus, relativePath: string): Finding | undefined {
  switch (status) {
    case 'repaired':
      return finding('REPAIRED', 'artifact was missing and has been recreated', {
        path: relativePath,
      });
    case 'updated':
      return finding('UPDATED', 'source changed; artifact updated', { path: relativePath });
    case 'forced':
      return finding('FORCED', 'conflicting artifact overwritten because --force was given', {
        path: relativePath,
      });
    case 'written':
      return undefined;
    case 'unchanged':
      return undefined;
    case 'conflict':
    case 'name-conflict':
    case 'orphan':
      return undefined;
  }
}

export async function applyRepo(ir: HarnessIR, options: ApplyOptions): Promise<ApplyResult> {
  const planned = await planRepo(ir, {
    repoRoot: options.repoRoot,
    dest: options.dest,
    presets: options.presets,
    strategy: options.strategy,
    readResource: options.readResource,
    version: options.version,
    ...(options.presetPrefix === undefined ? {} : { presetPrefix: options.presetPrefix }),
    ...(options.delegation === undefined ? {} : { delegation: options.delegation }),
    ...(options.mainPreset === undefined ? {} : { mainPreset: options.mainPreset }),
    ...(options.extraPlugins === undefined ? {} : { extraPlugins: options.extraPlugins }),
    ...(options.bundleName === undefined ? {} : { bundleName: options.bundleName }),
  });

  const destRel = resolveDest(options.repoRoot, options.dest);
  const destAbs = path.join(options.repoRoot, destRel);
  const lockfileLocation = resolveLockfileLocation(
    options.repoRoot,
    options.lockfilePath,
    destAbs,
  );
  const lockfileRel = lockfileLocation.relative;
  const lockfileAbs = lockfileLocation.absolute;

  const prior = await readLockfile(lockfileAbs);
  const priorByPath = new Map<string, LockArtifact>(
    (prior?.artifacts ?? []).map((artifact) => [artifact.path, artifact]),
  );

  const results: ApplyArtifactResult[] = [];
  const conflicts: Conflict[] = [];
  const findings: Finding[] = [];
  const owned: LockArtifact[] = [];
  const tmpDir = path.join(destAbs, '.dshify-tmp');

  try {
    for (const artifact of planned.artifacts) {
      const relative = artifact.path;
      const targetAbs = path.join(options.repoRoot, relative);
      if (!isInside(destAbs, targetAbs)) {
        throw DshifyError.internal(`artifact escapes the destination tree: ${relative}`);
      }
      await assertNoSymlink(destAbs, targetAbs);

      const priorEntry = priorByPath.get(relative);
      const plannedHash = sha256Hex(artifact.bytes);
      const exists = await isFile(targetAbs);
      const destHash = exists ? sha256Hex(await readFile(targetAbs)) : undefined;

      let status: ApplyStatus;
      let write = false;

      if (!exists) {
        status = priorEntry === undefined ? 'written' : 'repaired';
        write = true;
      } else if (priorEntry === undefined) {
        if (options.force) {
          status = 'forced';
          write = true;
          findings.push(
            finding('NAME_CONFLICT', 'existing file under dest was not owned; overwritten with --force', {
              path: relative,
            }),
          );
        } else {
          status = 'name-conflict';
          conflicts.push({
            code: 'NAME_CONFLICT',
            path: relative,
            message: 'an existing file under dest is not owned by dshify',
          });
          findings.push(
            finding('NAME_CONFLICT', 'existing file under dest is not owned by dshify; skipped', {
              path: relative,
            }),
          );
        }
      } else if (destHash === priorEntry.sha256) {
        if (plannedHash === priorEntry.sha256) {
          status = 'unchanged';
        } else {
          status = 'updated';
          write = true;
        }
      } else if (options.force) {
        status = 'forced';
        write = true;
        findings.push(
          finding('CONFLICT', 'artifact was edited by a human; overwritten because --force was given', {
            path: relative,
          }),
        );
      } else {
        status = 'conflict';
        conflicts.push({
          code: 'CONFLICT',
          path: relative,
          message: 'artifact no longer matches the lockfile and appears to be human-edited',
        });
        findings.push(
          finding('CONFLICT', 'artifact was edited by a human; skipped (use --force to overwrite)', {
            path: relative,
          }),
        );
      }

      if (write) {
        await writeAtomic(targetAbs, artifact.bytes, destAbs);
      }
      const statusNote = statusFinding(status, relative);
      if (statusNote !== undefined) findings.push(statusNote);

      results.push({
        path: relative,
        kind: artifact.kind,
        capability: artifact.capability,
        status,
      });

      if (status === 'conflict') {
        if (priorEntry !== undefined) owned.push(priorEntry);
      } else if (status !== 'name-conflict') {
        owned.push(lockArtifactFor(artifact, options.repoRoot));
      }
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  // Sources that disappeared: keep owned orphans (v0.1 never deletes), prune
  // entries whose file is already gone.
  let orphanCount = 0;
  const plannedPaths = new Set(planned.artifacts.map((artifact) => artifact.path));
  for (const priorArtifact of prior?.artifacts ?? []) {
    if (plannedPaths.has(priorArtifact.path)) continue;
    const exists = await isFile(path.join(options.repoRoot, priorArtifact.path));
    if (!exists) continue; // prune
    orphanCount += 1;
    results.push({
      path: priorArtifact.path,
      kind: (priorArtifact.kind as ArtifactKind) ?? 'skill',
      capability: 'adapted',
      status: 'orphan',
    });
    findings.push(
      finding('ORPHAN_ARTIFACT', 'source disappeared; the artifact is kept (pruning is v0.2)', {
        path: priorArtifact.path,
        capability: 'manual',
      }),
    );
    owned.push(priorArtifact);
  }

  results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const lockfile = canonicalLockfile({
    lockfileVersion: LOCKFILE_VERSION,
    generatedBy: { name: GENERATOR_NAME, version: options.version },
    sourceRoots: sourceRootsFor(ir, options.repoRoot),
    sources: sourcesFromEntries(owned),
    artifacts: [...owned].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    losses: lossEntriesFor(planned.losses),
  });

  const shouldWriteLockfile = prior !== undefined || planned.artifacts.length > 0;
  const lockfileText = serializeLockfile(lockfile);
  const priorText = prior === undefined ? undefined : serializeLockfile(prior);
  const lockfileWritten = shouldWriteLockfile && lockfileText !== priorText;
  if (lockfileWritten) {
    await writeLockfileAtomic(lockfileAbs, lockfileText);
  }

  return {
    planned,
    results,
    conflicts,
    findings: sortFindings(findings),
    lockfile,
    lockfilePath: lockfileRel,
    lockfileWritten,
    ok: conflicts.length === 0 && orphanCount === 0,
  };
}

export { LOCKFILE_NAME };
