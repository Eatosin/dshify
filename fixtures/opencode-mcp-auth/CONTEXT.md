---
type: fixture
title: opencode-mcp-auth
description: Auth-bearing MCP servers — OAuth, env-interpolated headers, a disabled stdio server and an invalid name.
status: verified
verified: 2026-11-07 @ 1b799e1
covers: spec §13.10, MCP_AUTH_MANUAL, MCP_INVALID_NAME, writable preset switches
golden: none — preset assertions live in the bundle test
---

# opencode-mcp-auth — secrets never leave the source

MCP servers whose auth cannot be expressed safely are emitted `disabled: true` with a manual finding; no secret value ever appears in output, the preset bundle or the lockfile.

## What it pins

| Surface | `opencode.json` entry | Proves |
|---|---|---|
| OAuth remote | `oauth-remote` | auth `oauth`, `disabled: true`, `MCP_AUTH_MANUAL` |
| env-interpolated header | `env-header` (`Authorization: "{env:MCP_TOKEN}"`) | auth `header`, `disabled: true`, `MCP_AUTH_MANUAL` |
| disabled stdio | `disabled-stdio` | transport stdio, `disabled: true` preserved |
| invalid name | `bad name!` | `MCP_INVALID_NAME`, skipped |
| writable persona | `.opencode/agents/operator.md` | preset `tool-fs` keeps write/edit enabled |
| normal skill | `.opencode/skills/helper/SKILL.md` | the fixture still has a convertible surface |

## Why this shape

Auth is where a migration leaks credentials. The fixture contains only synthetic names and an obviously fake env reference; the tests assert that `MCP_TOKEN` and the client id never appear in the IR, the bundle patch or the lockfile.

## Connected to

- **owned-by:** the record library contract [`../CONTEXT.md`](../CONTEXT.md).
- **joins:** spec §11 (secret handling); `docs/mapping/opencode.md` §6; the preset emitter.
- **looks-like-but-is-not:** `opencode-basic`'s disabled no-auth server — that one is `exact` on the disabled flag, this one is `manual`.

## If you change this

- **Hits:** `test/fixtures.test.ts` and `test/bundle.test.ts` secret-free assertions, and the MCP row shape in `docs/mapping/opencode.md` §6.
- **Does not hit:** discovery — the bundle is not a skill root.

## Check

`test/fixtures.test.ts` scans the record, `test/bundle.test.ts` emits presets from it and asserts the rows are disabled and secret-free.

## See

- Secret handling: [`../../docs/spec.md`](../../docs/spec.md) §11
- MCP mapping: [`../../docs/mapping/opencode.md`](../../docs/mapping/opencode.md) §6
- Emitter card: [`../../map/objects/emitter-contract.md`](../../map/objects/emitter-contract.md)
