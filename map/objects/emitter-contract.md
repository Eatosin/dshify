---
type: object
cluster: contract
title: emitter contract
description: The target seam — IR to deterministic artifact bytes in memory; never touches the filesystem.
universe: live
status: verified
implementation: ghost
verified: 2026-11-05 @ 7598ff3
entity: docs/architecture.md §3.2 (interface); src/emit/dsh/ (ghost)
---

# emitter contract — the target seam

`TargetEmitter.plan(ir, options) → PlannedOutput`, returning artifact **bytes in memory**. Writing is `apply`'s job alone. Code name `src/emit/dsh/` — **ghost**.

## Why this shape

Bytes in memory are what make golden tests possible without writing anything, and what makes the second run a true no-op. If the emitter wrote files, `plan` could not be pure, conflicts would be discovered too late, and determinism would be asserted against a mutable tree. Keeping emission pure also holds the "dry-run is the default model" invariant structurally rather than by discipline.

## Shape

- `TargetEmitter`: `id`, `plan(ir, options) → PlannedOutput { artifacts, losses, conflicts }`.
- `Artifact`: `path` (repo-relative), `kind` (`skill` | `skill-resource` | `bundle-manifest` | `bundle-patch`), `bytes`, `sources: Provenance[]`, `capability`.
- Deterministic order: sorted by destination path, byte-wise, locale-independent.
- Fixed frontmatter key order and a fixed YAML emitter — never the user's style. No timestamps, absolute paths, usernames, hostnames, or random ids.
- Destination layout, naming and collision rules are the contract: `docs/spec.md` §7. This card does not copy them.

Citations: `docs/architecture.md` §3.2, §5; `docs/spec.md` §7.

## Connected to

- **owns:** planned artifact bytes and their loss/conflict computation.
- **owned-by:** `src/core/plan.ts` (ghost) calls it; [`ir`](ir.md) is its input.
- **joins:** [`lockfile-write-matrix`](lockfile-write-matrix.md) (receives the artifacts and decides writes), [`dsh-discovery`](dsh-discovery.md) (must see what was emitted).
- **looks-like-but-is-not:** `apply` — apply writes; the emitter never does. `--presets` rows are still bytes here.

## If you change this

- **Hits:** `docs/spec.md` §7 (naming, collisions, frontmatter order), every golden file, determinism and path-leak tests, [`lockfile-write-matrix`](lockfile-write-matrix.md) if artifact `kind`/`path` change, and `src/core/plan.ts` (ghost).
- **Does not hit:** adapter scanning, or `docs/cli.md` unless the summary changes — the wrong next noun is `adapter-contract`.

## Surfaces

| Surface | Role |
|---|---|
| `src/core/plan.ts` (ghost) | invokes |
| `src/core/apply.ts` (ghost) | writes the returned bytes |
| golden tests | assert the bytes |
| `check` | compares planned vs present |

## See

- Interface: [`docs/architecture.md`](../../docs/architecture.md) §3.2
- Emit contract: [`docs/spec.md`](../../docs/spec.md) §7
- Per-construct mapping: [`docs/mapping/opencode.md`](../../docs/mapping/opencode.md) §3–§6
