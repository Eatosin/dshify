---
type: fixture
title: opencode-basic
description: Happy-path OpenCode V2 repo — two copyable skills, one native .agents skill, one command, one read-only persona, one disabled remote MCP server.
status: verified
verified: 2026-11-05 @ 7598ff3
covers: spec §13.1, §13.2, §13.3, §13.6, §13.8, §13.9, §13.10
golden: pending — lands with the emitter (P2)
---

# opencode-basic — the happy path

The record that every other fixture is contrasted against. Synthetic; safe to copy and mutate in a temp dir.

## What it pins

| Surface | File | Proves |
|---|---|---|
| directory skill + resource | `.opencode/skills/demo-skill/SKILL.md` + `references/example.md` | a bundle and its referenced resource survive conversion |
| configured extra root | `skills/extra-skill/SKILL.md` (listed in `opencode.json` `skills[]`) | roots in config are scanned |
| already-native skill | `.agents/skills/marketing-demo/SKILL.md` | DSH's own root is reported, never duplicated |
| command with arguments | `.opencode/commands/hello.md` (`$ARGUMENTS`) | placeholder rewriting and `ARGS_SUBSTITUTION` |
| read-only persona | `.opencode/agents/reviewer.md` (`permissions: edit deny`) | subagent → persona, edit-deny adaptation |
| MCP server | `opencode.json` `mcp.servers.demo-remote` | remote transport, `disabled: true` preserved |
| include file | `AGENTS.md` | already native, reported not touched |

That is the six-item IR in spec §13.1: two copyable skills, one `.agents` skill, one command, one persona, one remote MCP server.

## Why this shape

The fixture mirrors OpenCode's four default locations **and** a configured extra root, so one record exercises both discovery paths. The MCP server is remote and disabled so it is provable offline with no credentials; the persona is read-only so the edit-deny adaptation is visible without a mutation.

## Connected to

- **owned-by:** the record library contract [`../CONTEXT.md`](../CONTEXT.md); the stamp `../_templates/opencode-fixture/`.
- **joins:** `docs/spec.md` §13 acceptance criteria; `docs/mapping/opencode.md` §9 (fixture table); the adapter tests.
- **looks-like-but-is-not:** the real repository that motivated dshify — that is a manual validation target and is never committed.

## If you change this

- **Hits:** spec §13.1's expected IR counts, `docs/mapping/opencode.md` §9, the adapter snapshot test, and later the golden output under `test/golden/opencode-basic/`.
- **Does not hit:** other fixtures, or any file under `src/`. The wrong next noun is `other fixtures` — a new behaviour gets a new record.

## Check

`bash _tools/walk-test.sh` confirms the record has its contract; a reviewer confirms it is still synthetic and tiny. Once the emitter exists (P2), `test/golden/opencode-basic/` is generated from it and compared byte-for-byte.

## See

- Acceptance it proves: [`../../docs/spec.md`](../../docs/spec.md) §13
- Adapter behaviour: [`../../docs/mapping/opencode.md`](../../docs/mapping/opencode.md) §3–§6
- The stamp: [`../_templates/opencode-fixture/CONTEXT.md`](../_templates/opencode-fixture/CONTEXT.md)
