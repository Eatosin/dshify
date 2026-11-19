---
type: fact
title: tool-fs switches
description: read/write/edit default true and can be omitted; applyPatch defaults false.
status: verified
package: '@deepseek-ai/dsh-tool-fs'
version: 0.2.2-rc.5
source: README.md
sha256: 189cf12e7d6488b95b99486eaaf3c8a4a89141c6d8d444a52a59c60a41834136
spec: docs/spec.md §7
---

# tool-fs switches

## Quote

> All keys are optional. The `read`, `readImage`, `write`, and `edit` switches default to `true`; set a switch to `false` to omit that tool and its guidance. `applyPatch` defaults to `false`

## Feeds

Read-only persona switches in `src/emit/dsh/bundle.ts` (`read: true, write: false, edit: false, applyPatch: false`).

## Drift

`python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai`.
