# Roadmap

OpenCode first, then the other harnesses, then the DSH plugin wrapper. Each version ships only when its exit criteria are met.

## v0.1 — OpenCode → DSH (current)

**Contract:** this page sequences the work; what "done" means is [spec.md §13](spec.md). Where the two overlap, the spec wins.

**Status (2026-11-07):** implementation complete; every §13 criterion is covered by CI tests. Published as [`@eatosin/dshify@0.1.0`](https://www.npmjs.com/package/@eatosin/dshify) with SLSA provenance from tag `v0.1.0`; the first-time-user check is verified, the manual migration round-trip remains. Release tooling: `0.1.1` publishes through npm Trusted Publishing (OIDC) and retires the bootstrap token.

**Deliverables**

- `scan`, `plan`, `apply`, `check`, `verify` commands with the contract in [cli.md](cli.md).
- IR + zod schemas, OpenCode adapter, DSH skill emitter (copy/link), preset bundle emitter (`--presets`), MCP row emitter.
- Static DSH discovery verifier; deterministic lockfile and write matrix.
- Fixtures `opencode-basic`, `opencode-collisions`, `opencode-malformed`, `opencode-mcp-auth`.
- Golden tests, idempotency test, conflict/force/repair matrix, no-network guard, path-leak test.
- README quickstart, mapping doc, JSON schema doc, CI on Node 22/24, npm publish as `@eatosin/dshify@0.1.0` (provenance). Unscoped `dshify` is blocked by npm's similarity policy (too similar to `tsify`), so the scope is the supported name; the command remains `dshify`.

**Exit criteria**

- [x] Every acceptance criterion in [spec.md §13](spec.md#13-acceptance-criteria-for-v01) is covered by CI tests.
- [ ] The migration this project was born from round-trips cleanly as a manual validation target (never committed as a fixture).
- [x] `dshify check` catches a deliberately deleted artifact and a human-edited artifact in CI.
- [x] Zero network calls and zero source-tree writes demonstrated by tests.
- [x] A first-time user can go from `npx @eatosin/dshify plan .` to a committed DSH surface using only the README. *(Verified 2026-11-08 by walking the published `0.1.0` package through install → scan → plan → apply → check → commit on a fresh repo.)*

**Explicitly deferred from v0.1:** recursive/nested skill flattening, pruning orphan artifacts, `--mcp-env`, live verification as a requirement, Claude/Codex adapters, plugin packaging.

## v0.2 — Claude Code adapter + hardening

**Sources to learn:** `.claude/skills/<name>/SKILL.md`, `.claude/commands/*.md` (with `$ARGUMENTS`, `!`bash``, `allowed-tools`, `argument-hint`, `model`), `.claude/agents/*.md` (`name`, `description`, `tools`, `model`), `CLAUDE.md`, project `.mcp.json`.

**Work**

- Second adapter against the same IR; no `core/` changes expected beyond new fields (spec PR).
- `--mcp-env` env interpolation support for both adapters.
- `--prune` for owned orphans, behind explicit opt-in and reported.
- `--verify-live` graduates from experimental to a documented CI recipe using a temp `DSH_HOME`.
- Recursive skill flattening with a deterministic naming rule (`<parent>-<child>`), reported as adapted.
- `--check` gains `--strict-losses` for teams that want exit 3 on `warning`-severity findings.

**Exit criteria:** Claude Code fixture parity with OpenCode; both adapters pass the same conformance suite; quickstart covers both.

## v0.3 — Codex adapter + multi-source repos

**Sources to learn:** `AGENTS.md` (already native in DSH), Codex custom prompts (`~/.codex/prompts/*.md` and any repo-local convention), project MCP configuration in `config.toml`, per-profile model settings.

**Work**

- Codex adapter; prompt files map to user-invocable skills with a documented argument convention.
- Multi-source scan: one repo using OpenCode for some teams and Claude Code for others; merge with a deterministic precedence and `SOURCE_CONFLICT` findings.
- Adapter conformance kit published for third-party adapters (`dshify-adapter-*` packages).

**Exit criteria:** three adapters pass the conformance kit; a merged multi-source fixture verifies end-to-end.

## v0.4 — DSH plugin + community surface

**Status (2026-11-08):** the plugin wrapper landed early as `@eatosin/dshify-plugin@0.1.0` (Host-only bundle): the `migrate_harness` tool, the `/migrate` command, locale and icon display metadata, and a Trusted Publishing release workflow. Version `0.2.0` adds the read-only Web migration panel (Settings → Plugins). The panel runs `scan`, `plan` and `check`; apply stays in the tool. Future versions release through the plugin Trusted Publishing workflow. The marketplace listing, `install_bundle` step and rollback remain open.

**Work**

- Publish `@dshify/plugin` as a Cordis bundle: `migrate_harness` tool (scan/plan/apply/check as tool calls with JSON results) and a `/migrate` command.
- Optional `install_bundle` step after a successful `--presets` apply, gated behind explicit confirmation and a report of the affected profile.
- Docs site generated from `docs/`, `good first issue` label with adapter-template issues, adapter authoring guide, release automation (provenance + changesets or release-please).

**Exit criteria:** the plugin installs in a clean DSH profile, migrates a fixture in-session, and the report matches the CLI's; community adapter template is documented and tested.

## Beyond

- Reverse conversion (DSH → harness) using the same IR, if the community asks.
- Drift-safe two-way sync for repos that must keep both surfaces authoritative (`dshify check --both`).
- A hosted "harness compatibility report" for OSS repos is explicitly **not** planned; dshify stays local and offline-first.

## Release policy

- `0.x` semver: minor versions may change the CLI, but `--json` `schemaVersion` and finding codes remain stable within a minor line.
- Every release: fixtures pass, changelog, npm provenance, and a short migration note if finding codes changed.
