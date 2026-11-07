---
type: fact
title: AGENTS.md is loaded as workspace instructions
description: Project AGENTS.md-compatible files reach the agent without dshify copying them.
status: verified
package: '@deepseek-ai/dsh-agent-instructions'
version: 0.2.2-rc.1
source: README.md
sha256: e084b89a94b63d4e4deb455feb5ca7f101326086409d3aa4513e445b18b8ae9a
spec: docs/spec.md §7; Appendix A
---

# AGENTS.md is loaded as workspace instructions

## Quote

> `dsh-agent-instructions` gives agents workspace guidance from user-global and project-level `AGENTS.md`-compatible files.

## Feeds

Why `AGENTS.md`/`CLAUDE.md` are reported and left untouched by scan and emit (`AGENTS_MD_SHARED`, `CLAUDE_MD_SHARED`).

## Drift

`python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai`.
