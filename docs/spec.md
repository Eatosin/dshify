# dshify v0.1 specification — OpenCode → DeepSeek Harness

- **Status:** Accepted (2026-11-05; revised 2026-11-06)
- **Owner:** maintainer
- **Supersedes:** none
- **Revision:** rev. 2 (2026-11-06) — reserved host commands corrected to the six shipped built-ins (§7, §14, Appendix A).
- **Implementation gate:** cleared — implementation may proceed from this contract. Changes require a spec PR.

## 1. Problem

An agent harness is a set of instruction surfaces: skills, slash commands, subagents/personas, tool policy, MCP servers, and include files. Every harness discovers these from different roots with different rules, and OpenCode, Claude Code, Codex, and DSH disagree on all of them. Moving a working repository between harnesses is currently manual, lossy, and silent on failure: a skill in an unscanned root simply never appears, and the model is blamed for "ignoring" it.

`dshify` converts a source-harness surface into a DSH-native surface, reports every capability that survived, was adapted, or was lost, and verifies that DSH discovery will actually see the result.

## 2. Goals (v0.1)

1. Convert an **OpenCode V2** repository into an additive DSH surface without modifying the OpenCode setup.
2. Cover: skills (all configured roots), slash commands, subagents (personas), MCP servers, `AGENTS.md`.
3. Ship a **plan** that a human can review before any write, with a complete loss report.
4. Produce **deterministic, idempotent, owned** output under a destination tree plus one lockfile.
5. **Verify** the emitted surface against DSH's discovery rules; fail `check` when an emitted skill would be invisible or malformed.
6. Be useful in CI from day one: `dshify check` exits nonzero on drift, conflict, or broken discovery.

## 3. Non-goals (v0.1)

- No Claude Code or Codex adapters (v0.2/v0.3; the IR and contracts are designed for them).
- No DSH plugin yet (v0.4 wraps the same core as a `migrate_harness` tool).
- No reverse conversion (DSH → OpenCode).
- No execution of source-harness content, plugins, or MCP servers.
- No automatic bundle installation into a DSH profile; `apply --presets` writes the bundle, installation stays a documented manual/plugin step.
- No GUI. CLI + JSON only.
- No network calls in scan/plan/apply/check. Live DSH verification is opt-in and experimental.

## 4. Users and jobs

| User | Job |
|---|---|
| An engineer moving a team repo from OpenCode to DSH | Convert once, review the loss report, commit, keep working |
| An OSS maintainer shipping harness configs to both | Re-run `dshify apply --check` in CI so the two surfaces never drift |
| A harness author | Contribute an adapter against the documented IR |

## 5. Pipeline contract

```text
source repo ──scan──▶ IR ──plan──▶ Plan (artifacts + losses + conflicts)
                                    │
                                    ├──apply──▶ files + lockfile
                                    └──check──▶ verify(IR, files, lockfile, discovery)
```

Stages are separable and individually testable. `scan` and `plan` are pure with respect to the filesystem (read-only). `apply` is the only writer. `check` reads and reports.

### 5.1 Scan

- Input: repository root (default cwd), optional extra `--root` dirs.
- Adapter: `src/adapters/opencode` reads `opencode.json` (schema-tolerant; unknown keys preserved as warnings), `.opencode/{skills,commands,agents}`, and every configured skill root.
- Output: `HarnessIR` with provenance for every item: absolute source path, content SHA-256, and the adapter that produced it.
- Malformed content is reported, never silently dropped: a skill without `description` is `MALFORMED_SKILL`, a command with an unknown frontmatter key is `UNKNOWN_FIELD` (warning).
- Missing configured roots are `MISSING_ROOT` (warning); they do not fail the scan.

### 5.2 Plan

- Input: IR + options (destination, strategy, presets on/off).
- Output: ordered `Artifact[]` (each with `path`, `kind`, `sources[]`, `content`), `Loss[]`, `Conflict[]`, and a summary.
- Path planning is deterministic: artifacts sorted by destination path; naming rules in §7 and the mapping doc.
- `plan` never reads the destination except to compute conflicts (previous lockfile) — see `apply` for the write-time conflict check.
- Human output is a reviewable report; `--json` output validates against the schema in [cli.md](cli.md).

### 5.3 Apply

- Recomputes scan + plan, then writes. `--dry-run` is accepted but redundant (same as plan).
- Writes only inside `dest` (default `.dsh/` at repo root) and the lockfile (default `.dshify.lock.json`).
- Refuses to write when: destination escapes the repo root; a destination component is a symlink pointing outside `dest`; a source file is larger than the configured limit (1 MiB for a skill body).
- Atomic per file: write to `<dest>/.dshify-tmp/<hash>` then `rename`; cleanup on failure. Mode `0644`; directories `0755`.
- Never deletes files in v0.1. A source that disappears is reported as `ORPHAN_ARTIFACT`; pruning is opt-in in v0.2.
- On success: writes the lockfile last, and only after every artifact write succeeded.

### 5.4 Check

- Recomputed scan + plan vs the existing destination and lockfile; then the verifier.
- Fails (exit 4) when a planned artifact is missing, malformed, unverifiable, or present but user-edited in a way that no longer matches its source (conflict).
- Fails (exit 3) on drift: source hash changed since lockfile, or emitted content changed by a human (reported as conflict, not auto-fixed).
- Fails (exit 4) when static discovery simulation cannot see an artifact it just verified as well-formed.
- Designed for CI: no writes, no network, stable JSON.

## 6. Normalized IR

Defined in `src/core/ir.ts` as zod schemas plus inferred types. Sketch:

```ts
type Capability = 'exact' | 'adapted' | 'lossy' | 'manual' | 'unsupported';

interface Provenance { path: string; sha256: string; adapter: string; }

interface Skill {
  id: string;                    // kebab-case identity
  description: string;
  body: string;                  // markdown, frontmatter excluded
  invocation: { model: boolean; user: boolean };
  resources: string[];           // relative paths referenced from the body (best-effort)
  provenance: Provenance;
  capability: Capability;
}

interface Command {
  name: string; description: string; body: string;
  placeholders: Array<'arguments' | 'positional' | 'shell-injection'>;
  targetAgent?: string;          // source harness routing hint
  provenance: Provenance; capability: Capability;
}

interface Persona {
  id: string; description: string; body: string;
  access: 'read-only' | 'writable'; // inferred from source permission rules
  modelHint?: string;              // source model override, reported not applied
  provenance: Provenance; capability: Capability;
}

interface McpServer {
  name: string; transport: 'stdio' | 'streamable-http';
  command?: string; args?: string[]; url?: string;
  auth: 'none' | 'header' | 'oauth' | 'unknown';
  disabled: boolean;
  provenance: Provenance; capability: Capability;
}

interface HarnessIR {
  harness: 'opencode';
  version: string;               // adapter version
  root: string;
  skills: Skill[]; commands: Command[]; personas: Persona[];
  mcpServers: McpServer[];
  agentsMd?: Provenance;         // already-compatible include file
  warnings: Loss[];              // scan-time findings
}
```

Rules:

- Every IR item has provenance and a capability status. No untyped extras.
- `id`/`name` are normalized to kebab-case at scan time; the original spelling is retained for the report when it differs.
- Body text is byte-preserved except for documented placeholder rewriting (mapping doc).
- Ordering is stable and adapter-defined (lexicographic by identity).

## 7. DSH emit contract

Destination layout (all under `dest`, default `.dsh/`):

```text
.dsh/skills/<id>/SKILL.md        generated skills (commands, personas, copied roots)
.dsh/skills/<id>/**              referenced resources, copied with the skill
.dsh/harness/package.json        only with --presets
.dsh/harness/cordis.patch.yml    only with --presets
.dshify.lock.json                ownership + drift record (repo root)
```

Frontmatter emitted (exact key order, deterministic):

```yaml
---
name: <id>                      # kebab-case; equals directory
description: <single line>      # required
disable-model-invocation: true # command skills only
user-invocable: true           # always
---
```

Mapping rules:

| Source | Emitted | Capability | Notes |
|---|---|---|---|
| OpenCode skill under a scan root | `.dsh/skills/<id>/` | exact (copy) / adapted (link) | resources copied when the body references them |
| Skill under `.agents/skills` | nothing | exact | already a native DSH root; reported, not duplicated |
| Command | user-invocable skill | adapted | `$ARGUMENTS` → prose sentence; shell injection → manual loss |
| Subagent | model-invocable persona skill | adapted | isolation loss unless `--presets` |
| Subagent + `--presets` | persona skill **and** preset row | adapted→exact for tool policy | `edit: deny` → `tool-fs` `write/edit/applyPatch: false` |
| MCP server | `.dsh/harness/cordis.patch.yml` row | adapted | disabled preserved; auth constructs become `manual` and force `disabled: true` |
| `AGENTS.md` | not touched | exact | DSH loads it natively |
| Plugin / custom tools | nothing | unsupported | report `PLUGIN_UNSUPPORTED`; never execute |

Naming and collision rules (deterministic, all reported):

- A unit keeps its source name unless the name is already taken in the plan or is reserved.
- Reserved DSH host commands are the six shipped built-ins: `plan`, `compact`, `goal`, `permission`, `feedback`, `export`. A command that collides is emitted as `<name>-command` (`HOST_COMMAND_COLLISION`, adapted). The zh spellings resolve as input aliases to these commands, never as separate names.
- Two personas with the same id: first by adapter order, second gets `<id>-persona` (`NAME_COLLISION`, adapted).
- Any collision with an existing file under `dest` that dshify does not own is a `NAME_CONFLICT` (blocking in `apply` unless `--force`).
- Nested skills (`**/SKILL.md` below a root's direct children) are not discovered by DSH: `UNSUPPORTED_NESTED_SKILL` in v0.1. They are reported, skipped, and never flattened silently.

Skill-root strategy:

- `--strategy copy` (default): copy source skill directories into `.dsh/skills/`, so a fresh clone and CI work without symlink support.
- `--strategy link`: emit committed symlinks (one per skill, because DSH scans direct children only). Report `LINK_STRATEGY` so reviewers know the portability trade-off.
- `.agents/skills` is never copied or linked — DSH already scans it.

Preset emission (`--presets`):

- One `@deepseek-ai/dsh-agent-preset` row per persona, `config.id` = persona id, persona body as the `@deepseek-ai/dsh-persona` prefix, and the standard tool/compaction/delegation groups from DSH's shipped `standard` preset.
- Read-only personas set `tool-fs` `{ read: true, write: false, edit: false, applyPatch: false }`.
- The bundle manifest declares `dsh.bundle.patch` and no dependencies; dshify never installs it.

## 8. Verification contract

`verify` has two layers:

1. **Static discovery simulation (mandatory, v0.1).** Reimplement DSH's documented discovery rules in `src/verify/discovery.ts`: roots `.dsh/skills` and `.agents/skills` relative to the repo root; direct children only (`<name>/SKILL.md`); YAML frontmatter with kebab-case `name` equal to the directory, non-empty single-line `description`, boolean `disable-model-invocation`/`user-invocable`; malformed entries are skipped. Every rule cites the DSH package README it derives from in a code comment. The simulation reports what a DSH session would catalog, and `check` compares it against the plan.
2. **Live check (opt-in, experimental).** With `--verify-live`, if a `dsh` binary is on `PATH`, run a discovery probe against a temporary `DSH_HOME` (never the user's profile) and compare the catalog. Failure to launch DSH is `LIVE_UNVERIFIED`, not a silent pass. This layer is not an acceptance gate for v0.1.

## 9. Lockfile

`dshify.lock.json`, committed in the target repo:

```json
{
  "lockfileVersion": 1,
  "generatedBy": { "name": "dshify", "version": "0.1.0" },
  "sourceRoots": [{ "harness": "opencode", "path": ".opencode/skills", "kind": "skills" }],
  "sources": [{ "path": ".opencode/commands/hello.md", "sha256": "…" }],
  "artifacts": [
    {
      "path": ".dsh/skills/hello/SKILL.md",
      "kind": "command-skill",
      "sha256": "…",
      "sources": [{ "path": ".opencode/commands/hello.md", "sha256": "…" }]
    }
  ],
  "losses": [{ "code": "ARGS_SUBSTITUTION", "severity": "info", "detail": "…" }]
}
```

Rules: sorted arrays; no timestamps; `generatedBy.version` is informational and ignored by drift comparison; hashes are lowercase hex SHA-256 of the exact bytes written. `check` compares `sources` and `artifacts` only.

Write/update matrix for `apply` (per artifact):

| Source hash | Destination state | Action |
|---|---|---|
| unchanged | missing | recreate, report `REPAIRED` |
| unchanged | matches lockfile | no-op |
| unchanged | differs from lockfile (human edit) | `CONFLICT`, skip unless `--force` |
| changed | matches lockfile | update, report `UPDATED` |
| changed | edited by human | `CONFLICT`, skip unless `--force` |
| removed | still owned | `ORPHAN_ARTIFACT`, keep (v0.1) |
| removed | missing | prune from lockfile |

## 10. Reporting

Every finding has `{ code, severity, message, path?, capability }`. Severity: `info` (adapted, expected), `warning` (manual follow-up), `error` (blocks apply). Codes are stable identifiers documented in the mapping doc. Human output groups by severity; JSON output is stable and zod-validated.

## 11. Safety

- Path safety: every destination must resolve inside the repository root and inside `dest`; `realpath` is checked after creation; symlinked destination directories are refused.
- Source safety: read-only; never chmod/chown, never reformat, never delete.
- Secret handling: reports redact values that look like credentials (`*_TOKEN`, `API_KEY`, `Authorization` headers, private keys) and record `[REDACTED]` with the key name.
- No execution of harness content; no shelling out except the opt-in `dsh` probe.
- No telemetry, no network in the core.

## 12. Limits

- Skill body ≤ 1 MiB; total emitted bytes ≤ 32 MiB or 5,000 artifacts (whichever first), configurable.
- Only UTF-8 text files are converted; binary assets are copied only when referenced resources are supported (v0.1 copies files listed in `resources`, with a size limit).
- Single-threaded; no watch mode in v0.1.

## 13. Acceptance criteria for v0.1

1. `dshify scan fixtures/opencode-basic --json` returns a schema-valid IR containing: two copyable skills, one `.agents` skill marked already-compatible, one command, one persona, one remote MCP server.
2. `dshify plan` lists each artifact with source, kind, capability, and every documented loss code; writes nothing (verified by tree hash).
3. `dshify apply` produces the expected tree, updates the lockfile last, and leaves every source file byte-identical (hash comparison).
4. A second `apply` is a no-op: no file mtimes need to change, and `check` passes with exit 0.
5. Editing an emitted artifact then re-running `apply` reports `CONFLICT`, exits 3, and preserves the edit; `--force` overwrites and reports `FORCED`.
6. Deleting an emitted artifact and running `check` fails with `MISSING_ARTIFACT` (exit 4); `apply` recreates it (`REPAIRED`).
7. A command named `plan` emits `plan-command` plus a `HOST_COMMAND_COLLISION` finding.
8. A command containing `$ARGUMENTS` emits the documented prose-argument sentence and an `ARGS_SUBSTITUTION` finding; `$1` and shell injection produce `warning`/`manual` findings without being silently dropped.
9. A subagent with `effect: deny` on edit emits a persona skill; with `--presets`, the preset's `tool-fs` switches disable write/edit/applyPatch, and `dsh --profile web --dump-config --patch <bundle>` exits 0 when `dsh` is available (skipped with a clear message otherwise).
10. An MCP server with OAuth or env interpolation emits a row with `disabled: true` and `MCP_AUTH_MANUAL`; no secret value appears in output or lockfile.
11. A malformed source skill (missing `description`) yields `MALFORMED_SKILL` and no emitted artifact.
12. Determinism: two clean runs produce byte-identical destinations and lockfile; no timestamp, absolute path, or host-specific value appears in any emitted file (asserted by golden tests and a path-leak test).
13. No-network test: a guard fails the suite if `http`/`https`/`fetch` is used outside the opt-in probe.
14. Every emitted skill passes static discovery simulation; `check` fails if the simulation is made to skip it.

## 14. Decisions (accepted 2026-11-05)

All seven defaults were accepted by the maintainer on 2026-11-05; implementation may proceed.

| # | Decision | Accepted value |
|---|---|---|
| 1 | Skill-root default strategy | `copy` (portable); `--strategy link` opt-in |
| 2 | `--presets` scope | opt-in only; writes `.dsh/harness/`, never installs a bundle |
| 3 | Collision suffixes | `-command` for commands, `-persona` for personas |
| 4 | `--verify-live` in v0.1 | implemented but experimental; never an acceptance gate |
| 5 | Lockfile location/name | `.dshify.lock.json` at repo root |
| 6 | Exit codes | `0` ok, `1` internal, `2` usage, `3` drift/conflict, `4` verification failure, `5` unsupported request |
| 7 | Persona invocation | model-invocable **and** user-invocable (`/planner` works) |

Changing any row requires a spec PR. Finding codes, flag names, and the JSON `schemaVersion` are public API from v0.1.

**Revision 2026-11-06 (rev. 2):** §7's reserved host-command set was corrected from four to the six shipped built-ins (`feedback` and `export` were missing) after checking `@deepseek-ai/dsh-commands@0.2.2-rc.1`. This is the spec PR for that correction; no other decision row changed.

## Appendix A — DSH discovery facts this spec depends on

| Fact | Source |
|---|---|
| Project skill roots: `<repo>/.dsh/skills` (rank 100), `<repo>/.agents/skills` (rank 200), custom dirs (300), user roots (400/500) | `@deepseek-ai/dsh-skill-filesystem` README |
| Only direct child bundles `<name>/SKILL.md` or flat `<name>.md` are discovered; nested `**/SKILL.md` are not | same |
| Frontmatter requires kebab-case `name`, non-empty `description`; `disable-model-invocation` / `user-invocable` must be booleans | same |
| Model catalog is injected durably; each description is paid for once per session | `@deepseek-ai/dsh-tool-skill` README |
| `/name` for a user-invocable skill injects the body; a host command with the same name wins | `@deepseek-ai/dsh-client-ui-skill` README |
| Host command set is `goal`, `plan`, `feedback`, `compact`, `permission`, `export` (zh input aliases exist) | `@deepseek-ai/dsh-commands@0.2.2-rc.1` — `lib/types/builtin.js` (`BUILTINS`, `builtinCommandTokens`) |
| Persona/presets: `@deepseek-ai/dsh-agent-preset` + `@deepseek-ai/dsh-persona`; read-only via `@deepseek-ai/dsh-tool-fs` switches | package READMEs |
| MCP rows: `@deepseek-ai/dsh-mcp-client`, `serverName` + stdio/streamable-http | package README |
| `AGENTS.md` / `CLAUDE.md` are loaded as workspace instructions | `@deepseek-ai/dsh-agent-instructions` README |

> Rows sourced from shipped code are cited by package, version and path; they are not README quotes. README-cited rows follow the §8 rule.
