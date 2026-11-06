import path from 'node:path';
import type { Conflict, HarnessIR, PlannedOutput } from './ir.js';
import { DshifyError } from './errors.js';
import { isInside, repoRelative } from './paths.js';
import { finding, sortFindings } from './report.js';
import { planDshSkills } from '../emit/dsh/skills.js';

/**
 * Plan a DSH surface from an IR. Contract: docs/spec.md §5.2 and §7.
 *
 * Plan is pure with respect to the destination: it computes artifact bytes and
 * reports losses, but never writes. Destination collision detection against the
 * lockfile lands with `apply`, so `conflicts` is empty for now.
 */

export interface PlanOptions {
  /** Absolute repository root; `dest` is validated to stay inside it. */
  readonly repoRoot: string;
  /** Destination tree, repo-relative (`dest`) or absolute. Default `.dsh`. */
  readonly dest: string;
  /** Emit the `.dsh/harness/` preset bundle. Not implemented yet. */
  readonly presets: boolean;
  /** `copy` (portable) or `link` (opt-in, not implemented yet). */
  readonly strategy: 'copy' | 'link';
  /** Reads a referenced resource file; keeps the emitter filesystem-free. */
  readonly readResource: (absolute: string) => Promise<Uint8Array>;
}

/** Resolve and validate the destination tree inside the repository. */
export function resolveDest(repoRoot: string, dest: string): string {
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, dest);
  if (absolute === root || !isInside(root, absolute)) {
    throw DshifyError.usage(
      `--dest must name a directory inside the repository (got "${dest}")`,
    );
  }
  const relative = repoRelative(root, absolute);
  if (relative.startsWith('..')) {
    throw DshifyError.usage(`--dest escapes the repository: "${dest}"`);
  }
  return relative;
}

export async function planRepo(ir: HarnessIR, options: PlanOptions): Promise<PlannedOutput> {
  if (options.presets) {
    throw DshifyError.unsupported(
      '--presets is not implemented yet (the .dsh/harness bundle lands with apply)',
    );
  }
  if (options.strategy === 'link') {
    throw DshifyError.unsupported(
      '--strategy link is not implemented yet; the default copy strategy is portable',
    );
  }

  const dest = resolveDest(options.repoRoot, options.dest);
  const emitted = await planDshSkills(ir, {
    dest,
    repoRoot: options.repoRoot,
    readResource: options.readResource,
  });

  const losses = [...emitted.losses];
  for (const server of ir.mcpServers) {
    losses.push(
      finding(
        'MCP_PRESETS_REQUIRED',
        `MCP server "${server.name}" is not emitted: MCP rows require the --presets bundle, which is not implemented yet`,
        { path: 'opencode.json', capability: 'manual' },
      ),
    );
  }

  const conflicts: Conflict[] = [];
  return {
    artifacts: emitted.artifacts,
    losses: sortFindings(losses),
    conflicts,
  };
}
