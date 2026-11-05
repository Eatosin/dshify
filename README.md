# dshify

Port an existing agent-harness setup to **DeepSeek Harness (DSH)** — with verification, owned writes, and an honest loss report. Not a `sed` script.

> **Status: pre-alpha (spec phase).** The v0.1 contract lives in [docs/spec.md](docs/spec.md). The CLI skeleton exists; no adapter is implemented yet. Do not run it against a repo you cannot restore from git.

## The problem

Every harness says it is "markdown-native", then disagrees about everything else: which roots it scans, whether nested `SKILL.md` files exist, how slash commands are defined, what a subagent even is, how MCP auth is expressed. Moving a real repository from OpenCode, Claude Code, or Codex to DSH means re-deriving all of that by hand, and the failure mode is silence — the agent simply never sees the skill.

`dshify` makes the switch explicit:

1. **Scan** the source harness into a normalized model.
2. **Plan** a DSH-native surface and print every capability you win, adapt, or lose.
3. **Apply** the plan as owned, idempotent files under `.dsh/`.
4. **Check** that DSH actually discovers what was written — in CI, not by vibes.

## Roadmap

| Version | Scope |
|---|---|
| **v0.1** | OpenCode V2 → DSH. Skills, commands, subagents, skill roots, MCP servers. CLI + verifier + fixtures. |
| v0.2 | Claude Code adapter (`.claude/{commands,agents,skills}`, `CLAUDE.md`, MCP). |
| v0.3 | Codex adapter (`AGENTS.md`, prompts) and multi-source repos. |
| v0.4 | DSH plugin wrapper (`migrate_harness` tool, `/migrate` command, bundle install/rollback). |

Detailed exit criteria: [docs/roadmap.md](docs/roadmap.md).

## Planned CLI (v0.1)

```text
dshify scan  [path]   inventory the source harness, write nothing
dshify plan  [path]   show the conversion plan + loss report, write nothing
dshify apply [path]   write .dsh/ and .dshify.lock.json
dshify check [path]   verify artifacts, lockfile, and DSH discovery (CI mode)
dshify verify [path]  discovery check only
```

All commands accept `--json`, `--dest <dir>`, `--root <dir>` (repeatable), `--quiet`. `apply` is the only command that writes, and only inside the destination tree. Full contract: [docs/cli.md](docs/cli.md).

## Design principles

- **Verify, don't assume.** After emitting, simulate DSH discovery (fixed roots, frontmatter rules, direct-children-only) and optionally assert against a live DSH session. A conversion that does not verify fails.
- **Owned writes.** Never modify the source harness. Write only under `.dsh/` plus one lockfile. Re-runs update only files dshify created and the user has not edited; conflicts are reported, never clobbered.
- **Honest lossiness.** Every unsupported or adapted behavior carries a code and severity: `exact`, `adapted`, `lossy`, `manual`, `unsupported`. The report is a deliverable, not log noise.
- **Deterministic output.** Sorted keys, stable file order, no timestamps in artifacts. Same input + same version = byte-identical output.
- **Offline by default.** No network calls from scan/plan/apply/check. Live verification is opt-in.

## Repository layout

```text
src/            CLI + core (IR, adapters, emitters, verifier)
docs/           spec, architecture, CLI contract, per-harness mapping, roadmap
fixtures/       synthetic source-harness repos (committed, tiny, no secrets)
test/           unit and golden tests
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Adapter contributions are the most valuable: each source harness gets one adapter module plus a fixture plus mapping docs. The v0.1 spec is the contract — changes to it go through a spec PR before code.

## Security

`dshify` never executes source-harness content and never writes outside the destination tree. Report vulnerabilities via [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). "OpenCode", "Claude", "Codex", and "DeepSeek" are trademarks of their owners; `dshify` is unaffiliated and names them only to describe compatibility.
