# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows the release policy in [docs/roadmap.md](docs/roadmap.md#release-policy).

## [0.2.1] — 2026-11-14

### Fixed

- The plan report claimed losses that `--presets` and `--delegation` already
  prevent. With `--presets`, `EDIT_DENY_ADAPTED` and `SUBAGENT_ISOLATION` are no
  longer emitted. With `--delegation`, `MODEL_OVERRIDE_IGNORED` is not emitted.
- A delegation route without `provider` and `model` now reports
  `MODEL_ROUTE_UNMAPPED`; the child inherits the parent model.
- The mapping doc no longer names the nonexistent `EDIT_DENY_PRESET` code.

### Notes

- Tests: 172 passed (was 170). No CLI, schema, or artifact-byte change.

## [0.2.0] — 2026-11-13

### Added

- Parent preset emission: `--delegation` adds a preset that starts each
  converted persona through a named `@deepseek-ai/dsh-tool-subagent` row with
  `agentPreset` and `agentOptions`. Child presets stay free of delegation, so a
  child cannot recurse into another writable worker.
- `--model-map <file>`: explicit persona-to-DSH-route map. DSH routes differ
  from OpenCode routes, so the mapping cannot be inferred. Unmapped personas
  with a source `model:` hint report `MODEL_ROUTE_UNMAPPED`.
- `--preset-prefix <prefix>`: namespaces Loader row ids, preset `config.id`, and
  `agentPreset` references, so two generated harnesses can share one profile.
- `--extra-plugin <specifier>`: bundle-local plugin rows, relative to
  `cordis.patch.yml`. The plugin file stays user-authored.
- The bundle package name derives from the repository directory, for example
  `agency-os-dsh-harness`.
- `whenToUse` is preserved from source frontmatter and falls back to the
  description. Command skills with an `agent:` target route to the named
  delegation tool when delegation is on.
- MCP `env` and `cwd` pass through. The adapter reads both the OpenCode `env`
  and `environment` spellings and drops secret-looking keys and values.
- Plugin port manifest: `.dsh/harness/PLUGINS.md` lists each plugin surface and
  its statically extracted tools. Source plugins are never loaded or executed.
- New finding codes: `INSTRUCTIONS_EXTRA_UNMAPPED`, `MODEL_ROUTE_UNMAPPED`,
  `PRESET_PROFILE_GLOBAL`, `CONFIG_PRECEDENCE`, `BUNDLE_PATCH_INVALID`.

### Fixed

- `cordis.patch.yml` was a mapping. DSH requires a top-level YAML array of
  loader patch entries, so every generated bundle failed to install.
- OpenCode project config was read only from `<root>/opencode.json`. The adapter
  now reads `.opencode/opencode.json` first and reports `CONFIG_PRECEDENCE` when
  both exist.
- `check` skipped `bundle-patch` artifacts. It now parses the installed patch,
  requires the array root, and rejects duplicate row and preset ids (exit 4).
- Read-only persona presets no longer mount the delegation group.

### Notes

- Tests: 170 passed (was 154). Typecheck green.
- Additive JSON change: `schemaVersion` stays `1`.
- Plugin `@eatosin/dshify-plugin` 0.3.0 accepts the new fields and depends on
  this engine.

## [0.1.3] — 2026-11-09

### Added

- Every `--json` envelope now carries `rules`: the versioned DSH discovery rule
  set the report assumes (`rulesVersion`, `dshVersion`, `source`, `packages`).
- `check` and `verify` show the rule set in the human report.

### Notes

- Additive change: `schemaVersion` stays `1`. Closes #24.
- `rulesVersion` increases when the simulated rules change; the pinned quotes
  live in `docs/dsh-facts/`.

## [0.1.2] — 2026-11-08

### Changed

- The README now uses clear technical English. It has a demonstration, real output
  examples, a "what it does not do" section, and a FAQ.
- The npm package ships `docs/assets/demo.gif`, so the README demonstration shows
  on the npm page.

### Notes

- Documentation only. No CLI, IR, lockfile, or finding-code change.

## [0.1.1] — 2026-11-08

### Changed

- Releases publish through npm **Trusted Publishing** (GitHub Actions OIDC); the
  bootstrap `NPM_TOKEN` is retired. Provenance is still SLSA v1.

### Notes

- No CLI, IR, lockfile or finding-code change.

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
