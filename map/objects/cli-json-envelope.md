---
type: object
cluster: contract
title: CLI and JSON envelope
description: The only public interface — stable JSON, stable exit codes, stdout results and stderr diagnostics.
universe: live
status: verified
implementation: partial
verified: 2026-11-05 @ 7598ff3
entity: docs/cli.md (contract); src/cli.ts (exists, commands unimplemented)
---

# CLI and JSON envelope — the public interface

`dshify <command> [path] [flags]`, one JSON object under `--json`, exit codes `0`–`5`. Contract: `docs/cli.md`. `src/cli.ts` exists today (`partial`): it parses commands, prints help/version, and returns `1` "not implemented yet" — the envelopes and commands are not built.

## Why this shape

CI scripts must never parse human output, so the JSON envelope and the finding codes are versioned public API while the human report explicitly is not. The exit code carries the verdict — that is what lets `check` fail a build without parsing anything. Keeping stdout for results and stderr for diagnostics lets a pipeline consume the result without filtering noise.

## Shape

- Five commands (`scan`, `plan`, `apply`, `check`, `verify`) and one JSON object per run, with a `schemaVersion` whose additive/breaking rule is public API. Everything about the envelope, flags, exit codes and redaction is defined in `docs/cli.md` — **do not copy it here**.
- The shape worth knowing without opening the contract: results on stdout, diagnostics on stderr, `--json` schema-stable, secrets redacted before serialization, and the exit code is the only verdict a script should trust.
- `schemaVersion` increments only for breaking changes; additive fields do not bump it.

Citations: `docs/cli.md`; `docs/spec.md` §10, §14 (decisions 6–7).

## Connected to

- **owns:** the public contract for scripts and CI.
- **owned-by:** nothing — it is the outermost surface; `src/index.ts` re-exports `run`/`COMMANDS` as the library form.
- **joins:** [`dsh-discovery`](dsh-discovery.md) (`verification` + verification exit code), [`lockfile-write-matrix`](lockfile-write-matrix.md) (statuses + drift exit code), the report model in the future command modules.
- **looks-like-but-is-not:** the IR — the envelope is a report about a run, not the model; the v0.4 plugin wrapper will reuse this surface, not replace it.

## If you change this

- **Hits:** `docs/cli.md` and `docs/spec.md` §10/§14 (public API — spec PR first), `test/cli.test.ts`, the future human renderer, and the v0.4 plugin wrapper's contract.
- **Does not hit:** the IR shape, adapters, or emitters — the wrong next noun is `ir`.

## Surfaces

| Surface | Role |
|---|---|
| humans and CI scripts | read stdout / exit code |
| `package.json#bin` / `#exports` | ships it |
| `test/cli.test.ts` | asserts it |
| v0.4 DSH plugin (planned) | wraps the same functions |

## See

- Public contract: [`docs/cli.md`](../../docs/cli.md)
- Reporting and exit codes: [`docs/spec.md`](../../docs/spec.md) §10, §14
- Current implementation: [`src/cli.ts`](../../src/cli.ts)
- Tests: [`test/cli.test.ts`](../../test/cli.test.ts)
