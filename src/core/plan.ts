import path from 'node:path';
import type { Conflict, HarnessIR, PlannedOutput } from './ir.js';
import { DshifyError } from './errors.js';
import { isInside, repoRelative } from './paths.js';
import { finding, sortFindings } from './report.js';
import { planDshBundle, type DelegationRoute, type MainPresetSpec } from '../emit/dsh/bundle.js';
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
  /** Emit the `.dsh/harness/` preset bundle (persona + MCP rows). */
  readonly presets: boolean;
  /** `copy` (portable) or `link` (opt-in, not implemented yet). */
  readonly strategy: 'copy' | 'link';
  /** Reads a referenced resource file; keeps the emitter filesystem-free. */
  readonly readResource: (absolute: string) => Promise<Uint8Array>;
  /** Bundle manifest version; defaults to `0.0.0` for library callers. */
  readonly version?: string;
  /** Namespace for generated preset ids. */
  readonly presetPrefix?: string;
  /** Parent-preset delegation routes; presence enables the v0.2 parent preset. */
  readonly delegation?: readonly DelegationRoute[];
  /** Display identity of the parent preset. */
  readonly mainPreset?: MainPresetSpec;
  /** Extra bundle-local plugin specifiers, relative to the patch file. */
  readonly extraPlugins?: readonly string[];
  /** Package name for the generated bundle. */
  readonly bundleName?: string;
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
  if (options.strategy === 'link') {
    throw DshifyError.unsupported(
      '--strategy link is not implemented yet; the default copy strategy is portable',
    );
  }

  const dest = resolveDest(options.repoRoot, options.dest);
  const delegationTools =
    options.delegation === undefined
      ? undefined
      : new Map(options.delegation.map((route) => [route.persona, route.tool]));
  const emitted = await planDshSkills(ir, {
    dest,
    repoRoot: options.repoRoot,
    readResource: options.readResource,
    ...(delegationTools === undefined ? {} : { delegationTools }),
    presets: options.presets,
    delegation: options.delegation !== undefined,
  });

  const artifacts = [...emitted.artifacts];
  const losses = [...emitted.losses];

  if (options.presets) {
    const bundle = planDshBundle(ir, {
      dest,
      repoRoot: options.repoRoot,
      version: options.version ?? '0.0.0',
      ...(options.presetPrefix === undefined ? {} : { presetPrefix: options.presetPrefix }),
      ...(options.delegation === undefined ? {} : { delegation: options.delegation }),
      ...(options.mainPreset === undefined ? {} : { mainPreset: options.mainPreset }),
      ...(options.extraPlugins === undefined ? {} : { extraPlugins: options.extraPlugins }),
      ...(options.bundleName === undefined ? {} : { bundleName: options.bundleName }),
    });
    artifacts.push(...bundle.artifacts);
    losses.push(...bundle.losses);
  } else {
    for (const server of ir.mcpServers) {
      losses.push(
        finding(
          'MCP_PRESETS_REQUIRED',
          `MCP server "${server.name}" is not emitted without --presets`,
          { path: 'opencode.json', capability: 'manual' },
        ),
      );
    }
  }

  artifacts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const conflicts: Conflict[] = [];
  return {
    artifacts,
    losses: sortFindings(losses),
    conflicts,
  };
}
