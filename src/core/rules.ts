/**
 * Discovery rule-set metadata.
 *
 * A report must name the rules it used. The simulated DSH discovery rules are
 * versioned here; the quotes and digests that back them live in
 * `docs/dsh-facts/` (skill roots, one-level depth, frontmatter grammar, and the
 * catalog injection that makes visibility matter).
 *
 * Bump `rulesVersion` when the simulated rules change. Update `dshVersion`,
 * `packages`, and the fact register together.
 */

export interface DiscoveryRules {
  /** Rule-set revision owned by dshify. Increase when the rules change. */
  readonly rulesVersion: number;
  /** Shipped DSH package version the rules mirror. */
  readonly dshVersion: string;
  /** Checked fact register that records the source quotes. */
  readonly source: 'docs/dsh-facts';
  /** Packages whose documented behaviour the rules mirror. */
  readonly packages: readonly string[];
}

export const DISCOVERY_RULES: DiscoveryRules = {
  rulesVersion: 1,
  dshVersion: '0.2.2-rc.1',
  source: 'docs/dsh-facts',
  packages: ['@deepseek-ai/dsh-skill-filesystem', '@deepseek-ai/dsh-tool-skill'],
};
