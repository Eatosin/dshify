# dshify — agent instructions

`dshify` ports agent-harness surfaces (OpenCode first, then Claude Code and Codex) to DeepSeek Harness (DSH) and verifies the result. This file routes; the contract is in [docs/spec.md](docs/spec.md).

## Non-negotiables

1. **Spec first.** Behavior changes update `docs/spec.md` (or a doc it cites) before or in the same PR. If code and spec disagree, the PR is wrong.
2. **Never touch the source harness.** Scan/plan read it; apply writes only `<dest>` and the lockfile. No exceptions, not even reformatting.
3. **Dry-run is the default model.** Only `apply` writes. `apply` is idempotent and refuses to clobber user-edited artifacts — it reports conflicts instead.
4. **Determinism.** No timestamps, random ids, absolute paths, or host-specific ordering inside artifacts. Tests compare golden files byte-for-byte.
5. **Verification is part of conversion.** A plan that cannot be verified is incomplete; `check` must fail when DSH discovery would miss an emitted skill.
6. **Offline core.** scan/plan/apply/check make no network calls. No telemetry, ever.
7. **No secrets.** Fixtures are synthetic. Never commit a real token, URL with credentials, or private repository content.
8. **Small dependencies.** Every runtime dependency needs a justification in the PR. Prefer `node:` built-ins; `yaml` and `zod` are the approved baseline.

## Layout

| Path | Holds |
|---|---|
| `src/cli.ts` | argument parsing, exit codes, human/JSON output |
| `src/core/` | IR types, lockfile, report model, path safety |
| `src/adapters/<harness>/` | scan source harness → IR (one dir per harness) |
| `src/emit/dsh/` | IR → `.dsh/skills`, `.dsh/harness/` bundle |
| `src/verify/` | DSH discovery simulation + optional live check |
| `docs/mapping/<harness>.md` | capability matrix and loss codes per source harness |
| `fixtures/<harness>-*/` | tiny synthetic source repos, committed |
| `test/` | unit, golden, idempotency, and fixture round-trip tests |

## Commands

| Action | Command |
|---|---|
| Install (once) | `npm install` |
| Typecheck | `npm run typecheck` |
| Test | `npm test` |
| Watch tests | `npm run test:watch` |
| Build | `npm run build` |
| Run locally | `node --experimental-strip-types src/cli.ts --help` (or `npm run build` then `node dist/cli.js`) |

## Definition of done for a feature

- Spec/doc updated (mapping doc for adapter work).
- Tests: happy path, malformed input, idempotent re-run, conflict preservation.
- Fixture added or extended; golden output reviewed.
- `npm run typecheck && npm test && npm run build` green.
- No source-harness writes, no network calls, no secrets.

## Review checklist for a PR

- Does it preserve the "scan → plan → apply → check" boundary?
- Are new failure modes typed and reported (not thrown as generic errors)?
- Are paths validated against traversal and symlink escape?
- Would a second run produce byte-identical files?
- Is the loss report truthful — no silent "best effort" conversions?

## Style

TypeScript strict, ESM, NodeNext. Conventional commits (`feat(adapter): ...`, `fix(lockfile): ...`). Keep functions small and pure where possible; side effects live in `apply` and the CLI only.
