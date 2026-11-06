# dshify — agent instructions

`dshify` ports agent-harness surfaces (OpenCode first, then Claude Code and Codex) to DeepSeek Harness (DSH) and verifies the result. This file is the catalog: it routes and holds no payload. The contract is [`docs/spec.md`](docs/spec.md).

## Invariants

Each line is the rule; the detail lives where it links.

1. **Spec first.** Behavior changes update [`docs/spec.md`](docs/spec.md) (or a doc it cites) in the same PR. If code and spec disagree, the PR is wrong.
2. **Never touch the source harness.** scan/plan read it; apply writes only `<dest>` and the lockfile — not even reformatting.
3. **Dry-run is the default model.** Only `apply` writes; it is idempotent and reports conflicts instead of clobbering user edits ([spec §5.3](docs/spec.md)).
4. **Owned writes.** The lockfile is the ownership record; re-runs update only what dshify created and report everything else.
5. **Determinism.** No timestamps, random ids, absolute paths, or host-specific ordering inside artifacts; golden files compare byte-for-byte.
6. **Verification is part of conversion.** A plan that cannot be verified is incomplete; `check` must fail when DSH discovery would miss an emitted skill ([spec §8](docs/spec.md)).
7. **Offline core.** scan/plan/apply/check make no network calls; no telemetry, ever. `yaml` and `zod` are the only runtime deps.

## Route by task

| If you are… | Go to | Stop at |
|---|---|---|
| orienting, or asking "what is X / what does this change hit" | [`map/AGENTS.md`](map/AGENTS.md) | the card's **Hits** |
| changing behavior or any contract | [`docs/spec.md`](docs/spec.md) | a spec PR first |
| implementing an adapter, emitter, or verifier | [`docs/CONTEXT.md`](docs/CONTEXT.md) → the section it names | the seam card in `map/objects/` |
| changing flags, exit codes, or JSON | [`docs/cli.md`](docs/cli.md) | public API — spec PR |
| adding or fixing a fixture | [`fixtures/CONTEXT.md`](fixtures/CONTEXT.md) | the record's own `CONTEXT.md` |
| style, commits, PR checklist | [`CONTRIBUTING.md`](CONTRIBUTING.md) | its checklist |
| reporting status | `bash _tools/walk-test.sh` | the ghosts and stubs it lists |

## Commands

| Action | Command |
|---|---|
| Install (once) | `npm install` |
| Typecheck | `npm run typecheck` |
| Test | `npm test` |
| Watch tests | `npm run test:watch` |
| Build | `npm run build` |
| Run locally | `npm run build` then `node dist/cli.js --help` (Node's type stripping does not remap `.js` specifiers, so `src/*.ts` cannot run directly) |
| Workspace checks | `bash _tools/walk-test.sh` and `python3 -I _tools/links.py . --skip fixtures` |

## Before you claim done

`npm run typecheck && npm test && npm run build` green; the spec or mapping doc updated where behavior changed; a fixture record and its golden reviewed if the surface changed; the workspace checks above pass.

## Status

`scan` and `plan` are implemented: scan produces a schema-valid IR, and plan computes deterministic artifact bytes plus the loss report without writing. `apply`, `check` and `verify` are specified, not written — they exit 1. Per-module live/ghost status is in [`map/objects/_index.md`](map/objects/_index.md); trust it over any prose that describes a module as existing.
