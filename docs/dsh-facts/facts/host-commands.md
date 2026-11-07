---
type: fact
title: The shipped host-command set
description: The exact built-ins that win /name over a skill, read from shipped code.
status: verified
package: '@deepseek-ai/dsh-commands'
version: 0.2.2-rc.1
source: lib/types/builtin.js
sha256: b4edc7c4bb6ee763fbf95c233ff931567443547ff6f84c0669b52d05274007b5
spec: docs/spec.md §7; Appendix A
---

# The shipped host-command set

## Quote

>     goal: '@deepseek-ai/dsh-command-goal',
>     plan: '@deepseek-ai/dsh-plan-mode',
>     feedback: '@deepseek-ai/dsh-command-feedback',
>     compact: '@deepseek-ai/dsh-command-compact',
>     permission: '@deepseek-ai/dsh-permission-presets',
>     export: '@deepseek-ai/dsh-session-log-export',

## Feeds

`HOST_COMMANDS` in `src/core/ir.ts` and the rename rule in `src/emit/dsh/skills.ts`. This is the fact spec rev. 2 corrected: the original spec reserved four, the shipped code has six.

## Drift

`python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai`. If a built-in is added or removed, update this note, `HOST_COMMANDS`, and the spec in a spec PR.
