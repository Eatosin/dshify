# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows the release policy in [docs/roadmap.md](docs/roadmap.md#release-policy).

## [0.1.0] — 2026-11-07

First release: **OpenCode V2 → DSH**, verified.

### Added

- `dshify scan`, `plan`, `apply`, `check` and `verify`, with one `--json` envelope each (`schemaVersion: 1`) and human output for terminals.
- OpenCode V2 adapter: skills with their resources, commands (`$ARGUMENTS`, positional `$N`, shell-injection rewriting), subagents/personas, MCP servers (auth classified, `disabled` preserved, secrets never copied), `AGENTS.md`, configured roots, and plugins reported as unsupported.
- Deterministic DSH emitter: kebab-case skill frontmatter, resource copies, collision renaming (`plan-command`, `-persona`, numeric suffixes) with a finding per rename.
- `--presets`: a dependency-free `.dsh/harness/package.json` plus a Cordis `cordis.patch.yml` mirroring DSH's shipped `standard` preset — one `@deepseek-ai/dsh-agent-preset` row per persona, read-only `tool-fs` switches, and MCP rows.
- Owned writes: `.dshify.lock.json`, the seven-row write matrix, atomic writes, conflict/force/repair handling, and orphan retention.
- Static DSH discovery simulation and `check`: exit 3 on drift/conflict, exit 4 when DSH would not discover an emitted skill; `verify` reports the catalog.
- Checked `docs/dsh-facts/` register (11 facts pinned to package version, source path and SHA-256) with the local `_tools/check-dsh-facts.py` verifier.
- Fixtures `opencode-basic`, `opencode-collisions`, `opencode-malformed`, `opencode-mcp-auth`; golden tests; no-network guard; path-leak and determinism tests.
- ICM workspace map, fixture record library, and the executable `_tools/walk-test.sh`.

### Changed

- Spec rev. 3 pins the command-skill body layout and the `UNSUPPORTED_NESTED_SKILL` code; nested skills are reported, never flattened.
- `--presets` emits the harness bundle; `MCP_PRESETS_REQUIRED` is now reported only when presets are off.

### Known limitations

- `--strategy link` and `--verify-live` are not implemented (`link` exits 5; live verification stays experimental).
- OpenCode V2 only; Claude Code and Codex adapters are planned for v0.2/v0.3.
- Nested skill flattening and orphan pruning are explicitly deferred.

### Notes

- Published as **`@eatosin/dshify`**; npm's name-similarity policy reserves the unscoped `dshify` (it flagged it as too similar to `tsify`). The installed command is `dshify`.
- Node >= 22.12; runtime dependencies are `yaml` and `zod` only. The core is offline.
- `--json` `schemaVersion` and finding codes are stable within the `0.x` line.
