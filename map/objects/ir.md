---
type: object
cluster: contract
title: HarnessIR
description: The narrow waist — adapters produce it, emitters consume it, the report derives from it.
universe: live
status: verified
implementation: partial
verified: 2026-11-07 @ 1b799e1
entity: docs/spec.md §6 (contract); src/core/ir.ts (schema implemented)
---

# HarnessIR — the normalized model between harnesses

The single in-memory model an adapter fills from a source harness and an emitter reads to plan the DSH surface. Contract: `docs/spec.md` §6. Code name `src/core/ir.ts` — implemented and schema-validated on every scan (`partial`: apply/check and the preset bundle are still ghost).

## Why this shape

A direct OpenCode→DSH translator encodes one harness pair in one function; the third harness multiplies the code. The IR is the narrow waist: adapters express only source facts (including source-only capabilities as explicit losses), emitters render only target facts. It also makes the loss report *derivable* rather than hand-written, and it puts `capability` on every item so loss granularity is item-level — which is exactly where silent failure hides.

## Shape

- zod schemas plus inferred types in `src/core/ir.ts` (authoritative; the spec sketch is the intent): `HarnessIR`, `Skill`, `Command`, `Persona`, `McpServer`.
- Every item carries `provenance: { path, sha256, adapter }` and `capability: 'exact' | 'adapted' | 'lossy' | 'manual' | 'unsupported'`. No untyped extras.
- Identity normalized to kebab-case at scan time; original spelling retained for the report.
- Body text byte-preserved except documented placeholder rewriting (`docs/mapping/opencode.md` §4).
- Ordering stable and adapter-defined (lexicographic by identity).
- Scan-time findings live in `warnings: Loss[]`, using the same `{code, severity}` vocabulary as the report.

Citations: `docs/spec.md` §6; `docs/architecture.md` §3.1–§3.2.

## Connected to

- **owns:** nothing yet — it is the model, not a store.
- **owned-by:** [`adapter-contract`](adapter-contract.md) produces it; [`emitter-contract`](emitter-contract.md) consumes it.
- **joins:** [`lockfile-write-matrix`](lockfile-write-matrix.md) persists `provenance` refs as `sources[]`; [`dsh-discovery`](dsh-discovery.md) never sees it (it reads the emitted tree).
- **looks-like-but-is-not:** the CLI JSON envelope ([`cli-json-envelope`](cli-json-envelope.md)) — that is a report shape, not the IR; and the lockfile — that is ownership, not the model.

## If you change this

- **Hits:** `docs/spec.md` §6 (contract change — spec PR first), `src/core/ir.ts`, `src/adapters/opencode/scan.ts`, `test/ir.test.ts`, the capability matrix in `docs/mapping/opencode.md` §2, both seam cards, and every golden file that embeds an artifact (`src/core/plan.ts` is still ghost).
- **Does not hit:** `docs/cli.md` unless the envelope gains a field; fixtures (they are inputs); the discovery simulation.

## Surfaces

| Surface | Role |
|---|---|
| `src/adapters/<harness>/` (ghost) | writes |
| `src/emit/dsh/` (ghost) | reads |
| golden/snapshot tests | read |
| the loss report and lockfile | read (derived) |

## See

- Contract: [`docs/spec.md`](../../docs/spec.md) §6
- Seams: [`docs/architecture.md`](../../docs/architecture.md) §3.1, §3.2
- Per-harness detail: [`docs/mapping/opencode.md`](../../docs/mapping/opencode.md) §2
