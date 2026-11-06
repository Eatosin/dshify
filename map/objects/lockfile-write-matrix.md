---
type: object
cluster: contract
title: lockfile and write matrix
description: The ownership record and the per-artifact write decision — the whole conflict strategy.
universe: live
status: verified
implementation: live
verified: 2026-11-06 @ aa30e42
entity: docs/spec.md §9 (contract); src/core/lockfile.ts + src/core/apply.ts + src/core/check.ts (write matrix and drift comparison implemented)
---

# lockfile and write matrix — who owns which file

`.dshify.lock.json` at the repo root records what dshify wrote and from which source bytes; the write matrix decides one action per artifact on every `apply`. Contract: `docs/spec.md` §9. `src/core/lockfile.ts`, `src/core/apply.ts` and `src/core/check.ts` implement the write matrix, drift comparison, atomic writes, ownership and orphan retention (`live`).

## Why this shape

Without the lockfile, a re-run cannot distinguish "dshify wrote this and the source changed" from "a human edited this" — and the second case must never be overwritten. The ownership record is therefore the whole conflict strategy; every other rule (repair, update, orphan, conflict) is one row of one table in the contract. It is committed because CI on a fresh clone must reproduce the same decisions.

## Shape

- One file, the lockfile: versioned schema, sorted arrays, no timestamps, lowercase hex SHA-256 of the exact bytes written.
- The write matrix is the contract's table (`docs/spec.md` §9) — every source-hash × destination-state pair maps to exactly one action, and a human edit is a conflict, never a clobber. **Do not copy the table here.**
- What matters structurally: the lockfile is written **last**, and only after every artifact write succeeded; writes are atomic per file; nothing is deleted in v0.1; `generatedBy.version` is informational and ignored by drift comparison.
- Path safety (inside repo, inside `dest`, no symlink escape) is a precondition of every row, not a row.

Citations: `docs/spec.md` §5.3, §9, §11.

## Connected to

- **owns:** ownership of every emitted file; the idempotency guarantee.
- **owned-by:** `apply` (the only writer); `check` reads it for drift.
- **joins:** [`emitter-contract`](emitter-contract.md) (artifact set + bytes), [`ir`](ir.md) (source provenance), [`cli-json-envelope`](cli-json-envelope.md) (statuses and the drift exit code).
- **looks-like-but-is-not:** git or mtimes — neither proves ownership; only this file does.

## If you change this

- **Hits:** `docs/spec.md` §9 and §5.3 (spec PR first), `src/core/lockfile.ts`, `src/core/apply.ts`, `test/apply.test.ts`, `test/lockfile.test.ts`, the committed golden lockfile, and the `check` drift comparison (ghost).
- **Does not hit:** adapters, or the emitter's byte production — the bytes are the input to this decision, not part of it. The wrong next noun is `emitter-contract`.

## Surfaces

| Surface | Role |
|---|---|
| `src/core/apply.ts` (ghost) | writes |
| `src/core/check.ts` (ghost) | reads for drift |
| CI | commits and verifies it |
| humans | review the diff — it is a deliverable |

## See

- Contract: [`docs/spec.md`](../../docs/spec.md) §9 (and the write matrix table)
- Safety rules: [`docs/spec.md`](../../docs/spec.md) §11
- Determinism: [`docs/architecture.md`](../../docs/architecture.md) §5
