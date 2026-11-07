---
type: fixture
title: opencode-collisions
description: Naming collisions — a host command, a skill/command/persona id clash, and an unknown frontmatter key.
status: verified
verified: 2026-11-07 @ 1b799e1
covers: spec §13.7, HOST_COMMAND_COLLISION, NAME_COLLISION, UNKNOWN_FIELD
golden: none — plan assertions live in the fixture test
---

# opencode-collisions — every rename is reported

The record that proves the deterministic naming rules: a unit keeps its name unless it is taken, host commands win, and every rename is reported rather than silently applied.

## What it pins

| Surface | File | Proves |
|---|---|---|
| skill id | `.opencode/skills/reviewer/SKILL.md` | the first unit keeps `reviewer` |
| host command | `.opencode/commands/plan.md` | emitted as `plan-command` + `HOST_COMMAND_COLLISION` |
| cross-kind clash | `.opencode/commands/reviewer.md` | emitted as `reviewer-2` + `NAME_COLLISION` |
| persona clash | `.opencode/agents/reviewer.md` | emitted as `reviewer-persona` + `NAME_COLLISION` |
| unknown key | `.opencode/commands/reviewer.md` frontmatter | `UNKNOWN_FIELD` warning, command still converted |

## Why this shape

Four units, three collision shapes, one fixture: the smallest set that exercises the ordering rule (skills, then commands, then personas) and shows that the outcome is a report, not a silent rename.

## Connected to

- **owned-by:** the record library contract [`../CONTEXT.md`](../CONTEXT.md).
- **joins:** spec §7 naming rules; `docs/mapping/opencode.md` §4; the plan tests.
- **looks-like-but-is-not:** `opencode-malformed` — that record is about unparseable units, this one about colliding valid units.

## If you change this

- **Hits:** the expected emitted names and loss codes in `test/fixtures.test.ts`, and the naming rules in [`emitter-contract`](../../map/objects/emitter-contract.md).
- **Does not hit:** `opencode-basic` goldens, or the discovery simulation.

## Check

`python3 -I _tools/index.py fixtures` refreshes the catalog; `test/fixtures.test.ts` asserts the emitted names and findings.

## See

- Naming rules: [`../../docs/spec.md`](../../docs/spec.md) §7
- Adapter behaviour: [`../../docs/mapping/opencode.md`](../../docs/mapping/opencode.md) §4
- Emitter card: [`../../map/objects/emitter-contract.md`](../../map/objects/emitter-contract.md)
