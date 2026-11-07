---
type: fact
title: tool-fs switches
description: read/write/edit default true and can be omitted; applyPatch defaults false.
status: verified
package: '@deepseek-ai/dsh-tool-fs'
version: 0.2.2-rc.1
source: README.md
sha256: 96224e904f02ca2ab9805b9acbc5abae490fc310242d8e5f25f63567e0539ba4
spec: docs/spec.md §7
---

# tool-fs switches

## Quote

> All keys are optional. The `read`, `readImage`, `write`, and `edit` switches default to `true`; set a switch to `false` to omit that tool and its guidance. `applyPatch` defaults to `false`

## Feeds

Read-only persona switches in `src/emit/dsh/bundle.ts` (`read: true, write: false, edit: false, applyPatch: false`).

## Drift

`python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai`.
