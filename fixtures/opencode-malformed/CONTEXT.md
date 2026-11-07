---
type: fixture
title: opencode-malformed
description: Unparseable and missing sources — malformed skills, commands, personas and a missing configured root.
status: verified
verified: 2026-11-07 @ 1b799e1
covers: spec §13.11, MALFORMED_SKILL, MALFORMED_COMMAND, MALFORMED_PERSONA, MISSING_ROOT
golden: none — scan assertions live in the fixture test
---

# opencode-malformed — report, skip, continue

Every malformed surface is reported with a stable code and skipped; the valid skill beside them still converts. Nothing fails the scan.

## What it pins

| Surface | File | Proves |
|---|---|---|
| missing description | `.opencode/skills/no-description/SKILL.md` | `MALFORMED_SKILL`, not emitted |
| invalid identity | `.opencode/skills/Bad_Name/SKILL.md` | `MALFORMED_SKILL`, not emitted |
| invalid YAML | `.opencode/skills/bad-yaml/SKILL.md` | `MALFORMED_SKILL`, not emitted |
| nested bundle | `.opencode/skills/valid/nested/SKILL.md` | never discovered (one level deep) |
| command filename | `.opencode/commands/Check.md` | `MALFORMED_COMMAND`, not emitted |
| persona description | `.opencode/agents/no-desc.md` | `MALFORMED_PERSONA`, not emitted |
| missing root | `opencode.json` `skills: ["skills", "missing-root"]` | `MISSING_ROOT` warning |
| valid neighbour | `skills/valid/SKILL.md` | still scanned and emitted |

## Why this shape

The failure mode dshify exists to prevent is silence: a unit that is dropped without a finding. This record makes every drop observable and proves the scan continues.

Nested-bundle *reporting* (`UNSUPPORTED_NESTED_SKILL`) is not implemented yet — the record pins that nested bundles are not emitted, and the code-name question is tracked as a spec PR follow-up.

## Connected to

- **owned-by:** the record library contract [`../CONTEXT.md`](../CONTEXT.md).
- **joins:** spec §5.1 (malformed handling), §7 (nested skills); `docs/mapping/opencode.md` §2–§3.
- **looks-like-but-is-not:** `opencode-collisions` — colliding but valid units.

## If you change this

- **Hits:** the expected finding codes in `test/fixtures.test.ts`, and the finding table in `docs/mapping/opencode.md`.
- **Does not hit:** emitted artifact goldens (nothing here should be emitted except `valid`).

## Check

`test/fixtures.test.ts` asserts the codes and that `valid` is the only emitted skill.

## See

- Scan contract: [`../../docs/spec.md`](../../docs/spec.md) §5.1
- Finding codes: [`../../docs/mapping/opencode.md`](../../docs/mapping/opencode.md) §2
- Adapter card: [`../../map/objects/adapter-contract.md`](../../map/objects/adapter-contract.md)
