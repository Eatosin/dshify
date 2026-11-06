# Contributing to dshify

Thanks for helping make harness switches boring. The highest-value contribution is a **new adapter** or a **mapping correction** for an existing one.

Project layout, invariants and commands live in [AGENTS.md](AGENTS.md); this file covers how to contribute, not what the repo is.

## Before you write code

1. Read [docs/spec.md](docs/spec.md) and the mapping doc for your harness.
2. For behavior changes, open a spec PR first (docs only). Code follows the spec, not the other way around.
3. For a new adapter, open an issue titled `adapter: <harness> <version>` with the source-harness inventory you intend to support.

## Setup

```bash
git clone https://github.com/Eatosin/dshify.git
cd dshify
npm install
npm run typecheck && npm test
```

Node 22.12+ (see `engines`), npm 10+.

## What to contribute

| Area | Where | Notes |
|---|---|---|
| Adapter | `src/adapters/<harness>/` | Implements the `HarnessAdapter` contract in [docs/architecture.md §3.1](docs/architecture.md) (planned file `src/core/adapter.ts`) |
| Emitter | `src/emit/dsh/` | Changes here affect every adapter; include golden fixtures |
| Verification | `src/verify/` | Discovery rules must cite a DSH package/README in a comment |
| Mapping | `docs/mapping/<harness>.md` | Every loss code needs an example and a severity |
| Fixtures | `fixtures/<harness>-<case>/` | Synthetic, tiny, no secrets, no third-party content |
| CLI UX | `src/cli.ts` | Keep stdout for results, stderr for diagnostics, `--json` stable |

### Adding an adapter

1. Create `src/adapters/<harness>/` with `scan.ts` (filesystem → IR) and `index.ts` (adapter metadata + capability matrix).
2. Add a fixture under `fixtures/<harness>-basic/` exercising: a skill, a command, a persona/subagent, an extra skill root, and one lossy construct.
3. Document the mapping in `docs/mapping/<harness>.md`, including every unsupported field.
4. Add tests: scan produces expected IR (snapshot), plan report contains the documented loss codes.
5. Do not add harness-specific branches to `src/core/`. If the IR cannot express it, propose an IR change in the spec PR.

## Tests

- Unit tests next to behavior; integration tests under `test/`.
- Golden files are reviewable artifacts: if a golden diff is expected, say why in the PR.
- Every bug fix gets a regression test that fails before the fix.
- `npm test` must pass on Node 22 and 24 (CI matrix).

## Commits and PRs

- Conventional commits: `feat(adapter): ...`, `fix(emit): ...`, `docs(mapping): ...`, `test: ...`, `chore: ...`.
- One logical change per PR. Spec + code for that change may ship together.
- PR checklist:
  - [ ] spec/mapping updated when behavior changed
  - [ ] tests added (including idempotency + conflict case when relevant)
  - [ ] `npm run typecheck && npm test && npm run build`
  - [ ] no source-harness writes, no network calls in core, no secrets
  - [ ] report/loss codes remain truthful
- Sign off commits with `git commit -s` (DCO).

## Code of conduct

By participating you agree to [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

Do not report vulnerabilities in public issues; see [SECURITY.md](SECURITY.md).
