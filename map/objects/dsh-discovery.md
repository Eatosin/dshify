---
type: object
cluster: contract
title: DSH discovery
description: The verification noun — simulate what a DSH session would catalog, from fixed roots and frontmatter rules.
universe: live
status: verified
implementation: ghost
verified: 2026-11-05 @ 7598ff3
entity: docs/spec.md §8 + Appendix A (contract); src/verify/discovery.ts (ghost)
---

# DSH discovery — what a session would actually catalog

The rules a DSH session uses to find skills, reimplemented offline so `check` can prove an emitted skill is visible. Contract: `docs/spec.md` §8 — the roots, ranks and frontmatter grammar are recorded there (Appendix A) and are not repeated here. Code name `src/verify/discovery.ts` — **ghost**.

## Why this shape

Static simulation is the only verification that works offline, in CI, on every platform, without launching a harness — and it is the layer that catches the product's signature failure: an artifact that exists but is invisible. It must mirror *documented* behaviour, so each rule cites the shipped README it derives from; a DSH change then becomes a visible maintenance task instead of a silent regression. One rule is load-bearing at the card level: **discovery is one level deep** — only direct children are bundles, and nested skill trees are deliberately ignored.

**Known drift (2026-11-05).** The spec reserves four host commands; shipped `@deepseek-ai/dsh-commands` 0.2.2-rc.1 declares six — it adds `feedback` and `export` (with zh spellings). A source command named `feedback` or `export` would lose its `/name` to the host command. This needs a spec PR; it is recorded here so the collision rule is not implemented against a stale list, and it is the reason a checked fact register (`docs/dsh-facts/`, P2) exists.

Citations: `docs/spec.md` §7 (reserved commands), §8, Appendix A; `@deepseek-ai/dsh-skill-filesystem` README at 0.2.2-rc.1; `@deepseek-ai/dsh-commands` `lib/types/builtin.js` at 0.2.2-rc.1.

## Shape

- Input: a repository root plus limits. Output: what a session would catalog (visible), what it skipped and why, which roots existed, and whether the read was complete.
- A planned-but-invisible artifact fails `check` with `DISCOVERY_MISS` (verification exit code). Malformed entries are skipped *with a reason*, never silently.
- The optional live probe compares the simulation against a real session in a temporary `DSH_HOME`, never the user's profile; failing to launch DSH is `LIVE_UNVERIFIED`, not a pass.
- Documented source of truth today: the shipped package READMEs at 0.2.2-rc.1. When they drift from the recorded facts, the fact register is updated first (P2), then the spec in a spec PR.

## Connected to

- **owns:** the visibility verdict used by `check` and the optional live probe.
- **owned-by:** `check`/`verify` in the CLI; the discovered tree comes from [`emitter-contract`](emitter-contract.md) via apply.
- **joins:** [`cli-json-envelope`](cli-json-envelope.md) (`verification` field, exit code), [`emitter-contract`](emitter-contract.md) (must emit what this can see).
- **looks-like-but-is-not:** the OpenCode scan roots — same word "root", different harness and different rules.

## If you change this

- **Hits:** `docs/spec.md` §8 and Appendix A (spec PR first), `docs/mapping/opencode.md` §3 (nested-skill and name rules), the `check` exit code, discovery fixture tests, `src/verify/live.ts` (ghost), and the emitted frontmatter in [`emitter-contract`](emitter-contract.md).
- **Does not hit:** adapters (they never read DSH rules), or the lockfile — the wrong next noun is `lockfile-write-matrix`.

## Surfaces

| Surface | Role |
|---|---|
| `check` / `verify` | reads the verdict |
| `src/verify/live.ts` (ghost, opt-in) | compares against a real session |
| emitted `.dsh/skills/**` | subject of the simulation |
| CI | consumes the exit code |

## See

- Contract: [`docs/spec.md`](../../docs/spec.md) §8 and Appendix A
- Design check: [`docs/architecture.md`](../../docs/architecture.md) §3.3
- Converted-skill rules: [`docs/mapping/opencode.md`](../../docs/mapping/opencode.md) §3
