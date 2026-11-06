# CLI contract

Stable interface for humans and CI. Everything here is part of the v0.1 spec; changes require a spec PR.

## Invocation

```text
dshify <command> [path] [flags]
```

`path` defaults to the current directory and must be (or contain) a repository root. A repo root is resolved by walking up for `.git`; without one, the given path is used as the root (reported as `ROOT_GUESS`).

## Commands

| Command | Writes | Purpose |
|---|---|---|
| `scan` | no | Inventory the source harness. Prints IR summary; `--json` prints the IR. |
| `plan` | no | Show artifacts, losses, and conflicts. Must be explicit — there is no implicit migrate command. |
| `apply` | yes (dest + lockfile) | Execute the plan. Idempotent; refuses conflicts without `--force`. |
| `check` | no | CI mode: re-plan and verify against destination, lockfile, and discovery. |
| `verify` | no | Discovery check only (does the current destination surface look visible to DSH?). |

## Global flags

| Flag | Default | Meaning |
|---|---|---|
| `--json` | off | One JSON object on stdout; diagnostics on stderr. Schema-stable. |
| `--quiet` | off | Suppress non-error human output. |
| `--root <dir>` | — | Extra source root to scan (repeatable). |
| `--dest <dir>` | `.dsh` | Destination tree, repo-relative; must stay inside the repo. |
| `--lockfile <path>` | `.dshify.lock.json` | Lockfile path, repo-relative. |
| `--strategy <mode>` | `copy` | `copy` or `link` for skills outside `.agents/skills`. |
| `--presets` | off | Also emit `.dsh/harness/` preset bundle from personas. |
| `--force` | off | Overwrite conflicting artifacts (reports `FORCED`). |
| `--verify-live` | off | Experimental: probe the local `dsh` binary with a temp `DSH_HOME`. |
| `--no-color` | auto | Disable ANSI (also honors `NO_COLOR`). |
| `--help`, `--version` | — | Usage / version. |

`--root` is additive to the roots the adapter already reads from source config.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success; nothing to do, or plan/apply/check succeeded |
| `1` | Internal error (bug, unreadable repo, I/O failure) |
| `2` | Usage error (unknown command/flag, bad path) |
| `3` | Drift or conflict (human edit, changed source, orphan) — or `check` found drift |
| `4` | Verification failure (malformed emitted skill, discovery miss, live probe failed) |
| `5` | Unsupported source construct that was explicitly requested (e.g. `--presets` on an adapter without personas) |

Scripts must not parse human output; use `--json` and the exit code.

## Output conventions

- **stdout**: results only (scan summary, plan report, apply summary, check result, JSON object).
- **stderr**: diagnostics, warnings, progress, redacted notes.
- Human output is grouped: `Plan`, `Losses`, `Conflicts`, `Next`.
- Colors are optional and never the only signal (every colored token is also prefixed).
- The report is deterministic: same input → same lines, same order.

## JSON envelopes

All `--json` output is one object with a discriminator, a `schemaVersion`, and `findings`:

```json
{
  "kind": "plan",              // scan | plan | apply | check | verify
  "schemaVersion": 1,
  "ok": true,
  "root": "/abs/repo",
  "dest": ".dsh",
  "harness": { "id": "opencode", "version": "0.1.0" },
  "findings": [
    { "code": "ARGS_SUBSTITUTION", "severity": "info", "capability": "adapted",
      "path": ".opencode/commands/hello.md", "message": "…" }
  ],
  "artifacts": [
    { "path": ".dsh/skills/hello/SKILL.md", "kind": "command-skill",
      "capability": "adapted", "sources": [".opencode/commands/hello.md"],
      "status": "planned" }   // planned | written | unchanged | updated | conflict | repaired | orphan
  ],
  "summary": { "planned": 4, "written": 0, "losses": 2, "conflicts": 0 }
}
```

`scan` replaces `artifacts` with `inventory`; `check` adds `verification: { roots, visible, skipped }`. Findings carry stable codes documented in each mapping doc. Secrets are redacted before serialization.

`apply` reports one `status` per artifact: `written`, `updated`, `unchanged`, `repaired`, `forced`, `conflict`, `name-conflict`, `orphan`. Its finding codes are `REPAIRED`, `UPDATED`, `FORCED`, `CONFLICT`, `NAME_CONFLICT` and `ORPHAN_ARTIFACT`; a run with any conflict or orphan exits 3.

`check` reports `unchanged`, `drift`, `conflict`, `missing` or `orphan` per artifact, and adds `verification: { roots, visible, skipped, complete }` to the envelope. It exits 4 on `MISSING_ARTIFACT` or `DISCOVERY_MISS`, and 3 on `DRIFT`, `CONFLICT`, `LOCKFILE_MISSING` or `ORPHAN_ARTIFACT`. `verify` reports the discovered catalog only and exits 4 when a root could not be read.

## Examples (target behavior for v0.1)

```bash
# Review before touching anything
dshify plan . --presets

# Write the DSH surface + presets, then commit
dshify apply . --presets
git add .dsh .dshify.lock.json && git commit -m "chore: add DSH surface via dshify"

# CI: fail when sources and emitted surface drift
dshify check . --presets --json

# Repair deleted artifacts without touching human edits
dshify apply .
```

## Environment

| Variable | Meaning |
|---|---|
| `NO_COLOR` | Disable ANSI output |
| `DSHIFY_LOG` | `silent`, `normal` (default), `verbose` — diagnostics on stderr only |
| `DSH_HOME` | Used only by `--verify-live` (always overridden with a temp dir) |
| `CI` | Never changes behavior; useful only for default `--no-color` |

## Compatibility

The JSON envelope and finding codes are versioned. `schemaVersion` increments only for breaking changes; additive fields do not bump it. The human output is not a stable API.
