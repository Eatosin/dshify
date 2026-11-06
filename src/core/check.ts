import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  ArtifactKind,
  Capability,
  Conflict,
  Finding,
  HarnessIR,
  PlannedOutput,
} from './ir.js';
import type { ScanLimits } from './adapter.js';
import {
  readLockfile,
  resolveLockfileLocation,
  sourcesFromArtifacts,
  type DshifyLockfile,
} from './lockfile.js';
import { repoRelative } from './paths.js';
import { planRepo, resolveDest, type PlanOptions } from './plan.js';
import { finding, sortFindings } from './report.js';
import { sha256Hex } from './source.js';
import { verifyDiscovery, type DiscoveryResult } from '../verify/discovery.js';

/**
 * Check. Contract: docs/spec.md §5.4 and §8.
 *
 * Recomputes scan + plan, compares against the destination and the lockfile,
 * then runs the static discovery simulation. Exit codes: 4 for verification
 * failure (missing/malformed/invisible), 3 for drift or conflict, 0 otherwise.
 * Writes nothing.
 */

export type CheckStatus = 'unchanged' | 'drift' | 'conflict' | 'missing' | 'orphan';

export interface CheckArtifactResult {
  readonly path: string;
  readonly kind: ArtifactKind;
  readonly capability: Capability;
  readonly status: CheckStatus;
}

export interface CheckOptions extends PlanOptions {
  readonly lockfilePath: string;
  readonly limits: ScanLimits;
}

export interface CheckResult {
  readonly planned: PlannedOutput;
  readonly lockfile: DshifyLockfile | undefined;
  readonly verification: DiscoveryResult;
  readonly results: readonly CheckArtifactResult[];
  readonly conflicts: readonly Conflict[];
  readonly findings: readonly Finding[];
  readonly exitCode: 0 | 3 | 4;
  readonly ok: boolean;
}

async function isFile(absolute: string): Promise<boolean> {
  try {
    return (await stat(absolute)).isFile();
  } catch {
    return false;
  }
}

export async function checkRepo(ir: HarnessIR, options: CheckOptions): Promise<CheckResult> {
  const planned = await planRepo(ir, options);
  const destRel = resolveDest(options.repoRoot, options.dest);
  const destAbs = path.join(options.repoRoot, destRel);
  const lockfileLocation = resolveLockfileLocation(
    options.repoRoot,
    options.lockfilePath,
    destAbs,
  );
  const lockfile = await readLockfile(lockfileLocation.absolute);

  const findings: Finding[] = [];
  const conflicts: Conflict[] = [];
  const results: CheckArtifactResult[] = [];
  const verifiedWellFormed = new Set<string>();
  let verificationFailure = false;
  let drift = false;

  const lockfileRelative = repoRelative(options.repoRoot, lockfileLocation.absolute);
  if (lockfile === undefined) {
    drift = true;
    findings.push(
      finding('LOCKFILE_MISSING', 'no lockfile found; run apply to record ownership', {
        path: lockfileRelative,
      }),
    );
  }

  const priorByPath = new Map(
    (lockfile?.artifacts ?? []).map((artifact) => [artifact.path, artifact]),
  );

  for (const artifact of planned.artifacts) {
    const absolute = path.join(options.repoRoot, artifact.path);
    const prior = priorByPath.get(artifact.path);
    const plannedHash = sha256Hex(artifact.bytes);

    if (!(await isFile(absolute))) {
      results.push({
        path: artifact.path,
        kind: artifact.kind,
        capability: artifact.capability,
        status: 'missing',
      });
      findings.push(
        finding('MISSING_ARTIFACT', 'planned artifact is missing from the destination', {
          path: artifact.path,
        }),
      );
      verificationFailure = true;
      continue;
    }

    const destHash = sha256Hex(await readFile(absolute));
    let status: CheckStatus;
    if (destHash === plannedHash) {
      if (prior === undefined) {
        status = 'drift';
        drift = true;
        findings.push(
          finding('DRIFT', 'artifact is present but not recorded in the lockfile; run apply', {
            path: artifact.path,
          }),
        );
      } else if (prior.sha256 !== plannedHash) {
        status = 'drift';
        drift = true;
        findings.push(
          finding('DRIFT', 'source changed since the lockfile; run apply', {
            path: artifact.path,
          }),
        );
      } else {
        status = 'unchanged';
      }
    } else if (prior !== undefined && destHash === prior.sha256) {
      status = 'drift';
      drift = true;
      findings.push(
        finding('DRIFT', 'source changed since the lockfile; run apply', { path: artifact.path }),
      );
    } else {
      status = 'conflict';
      drift = true;
      conflicts.push({
        code: 'CONFLICT',
        path: artifact.path,
        message: 'emitted artifact was edited by a human',
      });
      findings.push(
        finding('CONFLICT', 'emitted artifact was edited by a human; not auto-fixed', {
          path: artifact.path,
        }),
      );
    }
    results.push({
      path: artifact.path,
      kind: artifact.kind,
      capability: artifact.capability,
      status,
    });
    if (status === 'unchanged') verifiedWellFormed.add(artifact.path);
  }

  const plannedPaths = new Set(planned.artifacts.map((artifact) => artifact.path));
  for (const priorArtifact of lockfile?.artifacts ?? []) {
    if (plannedPaths.has(priorArtifact.path)) continue;
    if (!(await isFile(path.join(options.repoRoot, priorArtifact.path)))) continue;
    results.push({
      path: priorArtifact.path,
      kind: priorArtifact.kind as ArtifactKind,
      capability: 'adapted',
      status: 'orphan',
    });
    findings.push(
      finding('ORPHAN_ARTIFACT', 'source disappeared but the artifact is still present', {
        path: priorArtifact.path,
      }),
    );
    drift = true;
  }

  if (lockfile !== undefined) {
    const current = sourcesFromArtifacts(planned.artifacts, options.repoRoot);
    const currentByPath = new Map(current.map((source) => [source.path, source.sha256]));
    const beforeByPath = new Map(lockfile.sources.map((source) => [source.path, source.sha256]));
    const changed = [...new Set([...currentByPath.keys(), ...beforeByPath.keys()])]
      .filter((sourcePath) => currentByPath.get(sourcePath) !== beforeByPath.get(sourcePath))
      .sort();
    for (const sourcePath of changed) {
      drift = true;
      findings.push(
        finding('DRIFT', 'source file changed since the lockfile; run apply', {
          path: sourcePath,
        }),
      );
    }
  }

  const verification = await verifyDiscovery(options.repoRoot, {
    maxFileBytes: options.limits.maxFileBytes,
  });
  const visiblePaths = new Set(verification.visible.map((skill) => skill.path));
  const skippedByPath = new Map(verification.skipped.map((entry) => [entry.path, entry.reason]));
  // Discovery is asserted only for artifacts check just verified as well-formed
  // (spec §5.4): a conflict or drift is already reported, and a malformed edit
  // must not upgrade a conflict into a verification failure.
  for (const artifact of planned.artifacts) {
    if (!verifiedWellFormed.has(artifact.path)) continue;
    if (artifact.kind === 'skill-resource' || artifact.kind === 'bundle-manifest' || artifact.kind === 'bundle-patch') {
      continue;
    }
    if (visiblePaths.has(artifact.path)) continue;
    const reason = skippedByPath.get(artifact.path);
    verificationFailure = true;
    findings.push(
      finding(
        'DISCOVERY_MISS',
        reason === undefined
          ? 'emitted skill is not visible to DSH discovery'
          : `emitted skill is skipped by DSH discovery: ${reason}`,
        { path: artifact.path },
      ),
    );
  }

  const ordered = [...results].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const exitCode: 0 | 3 | 4 = verificationFailure ? 4 : drift ? 3 : 0;

  return {
    planned,
    lockfile,
    verification,
    results: ordered,
    conflicts,
    findings: sortFindings(findings),
    exitCode,
    ok: exitCode === 0,
  };
}
