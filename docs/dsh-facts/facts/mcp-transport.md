---
type: fact
title: MCP row fields and tool naming
description: transport and serverName are required; tools appear as mcp__<serverName>__<tool>.
status: verified
package: '@deepseek-ai/dsh-mcp-client'
version: 0.2.2-rc.1
source: README.md
sha256: 92d8f0fc08518fbfd30550be89e87490db9fb5906493fb6a86c86bf7c8e3291b
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
