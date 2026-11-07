---
type: fact
title: The skill catalog is injected durably
description: A confirmed skill list reaches the model before the first request.
status: verified
package: '@deepseek-ai/dsh-tool-skill'
version: 0.2.2-rc.1
source: README.md
sha256: b04159a645f4acb7a708e3deebba63888030e6b463361bcd931729c7c938b8a9
spec: docs/spec.md §7; Appendix A
---

# The skill catalog is injected durably

## Quote

> Agents can discover and load skills during a session. When the `skill` tool is visible, model-invocable skills or incomplete discovery produce a durable catalog before the first request.

## Feeds

Why `description` is paid for once per session and why an invisible skill is silently useless — the failure `check` exists to catch.

## Drift

`python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai`.
