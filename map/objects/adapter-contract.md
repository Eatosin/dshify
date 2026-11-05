---
type: object
cluster: contract
title: adapter contract
description: The source-harness seam — one directory per harness, scan reads and reports, never throws on user content.
universe: live
status: verified
implementation: ghost
verified: 2026-11-05 @ 7598ff3
entity: docs/architecture.md §3.1 (interface); src/adapters/opencode/ (ghost)
---

# adapter contract — the source-harness seam

One directory per harness under `src/adapters/<harness>/`, implementing `HarnessAdapter.scan(input) → HarnessIR`. Today only `src/adapters/opencode/` is planned; **ghost**.

## Why this shape

Adapters must be able to express *source* facts and nothing about DSH, or the seam leaks target knowledge and the second adapter contradicts the first. Throwing is reserved for infrastructure failure (permissions, unreadable roots), because user-content problems are findings — a skipped skill that nobody reports is the exact silent failure dshify exists to prevent.

## Shape

- Interface: `id`, `displayName`, `version`, `scan(input)`, `capabilities: Record<string, Capability>`.
- `ScanInput`: `root`, `extraRoots`, `limits`, `signal`.
- Findings, not throws, for malformed content (`MALFORMED_SKILL`, `UNKNOWN_FIELD`, `MISSING_ROOT`); `SCAN_FAILED` wraps only infrastructure errors.
- One adapter per directory; a new harness adds a directory, a fixture record, a mapping doc, tests — no `core/` branches.
- OpenCode specifics (roots, `skills[]`, V2 quirks) belong in `docs/mapping/opencode.md`, not here.

Citations: `docs/architecture.md` §3.1; `docs/spec.md` §5.1.

## Connected to

- **owns:** the scan stage's behavior (spec §5.1).
- **owned-by:** `src/core/scan.ts` (ghost) dispatches; the CLI selects.
- **joins:** [`ir`](ir.md) (produces it), [`dsh-discovery`](dsh-discovery.md) (unrelated — adapters never read DSH rules).
- **looks-like-but-is-not:** the emitter contract — same shape of seam, opposite direction.

## If you change this

- **Hits:** `docs/spec.md` §5.1, `docs/mapping/opencode.md`, the harness's fixture record under `fixtures/`, adapter snapshot tests, `src/core/scan.ts` (ghost), and [`ir`](ir.md) if new facts are needed.
- **Does not hit:** `docs/cli.md`, `src/emit/`, the discovery rules — the wrong next noun is `cli-json-envelope`.

## Surfaces

| Surface | Role |
|---|---|
| `src/core/scan.ts` (ghost) | invokes |
| `src/emit/dsh/` (ghost) | none — never reads harness files |
| tests + fixtures | exercise |
| the loss report | consumes its findings |

## See

- Interface: [`docs/architecture.md`](../../docs/architecture.md) §3.1
- Stage contract: [`docs/spec.md`](../../docs/spec.md) §5.1
- OpenCode behavior: [`docs/mapping/opencode.md`](../../docs/mapping/opencode.md)
