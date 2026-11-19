---
type: fact
title: MCP row fields and tool naming
description: transport and serverName are required; tools appear as mcp__<serverName>__<tool>.
status: verified
package: '@deepseek-ai/dsh-mcp-client'
version: 0.2.2-rc.5
source: README.md
sha256: 74db776ebeb4a458fccfb1b6a297ec6985a1031148846e9f59080f5a40b77b94
spec: docs/spec.md §7; Appendix A
---

# MCP row fields and tool naming

## Quote

> | `transport` | required | `stdio` or `streamable-http` |
> | `serverName` | required | Namespace for the server's tool names; `[A-Za-z0-9_-]{1,32}`, unique inside one registration scope |
> The model sees each tool under a stable server-qualified name: `mcp__<serverName>__<rawName>`, for example `mcp__github__create_issue` — the same naming shape Claude Code and Codex use.

## Feeds

MCP row shape in `src/emit/dsh/bundle.ts` and the server-name validation in `src/adapters/opencode/scan.ts`.

## Drift

`python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai`.
