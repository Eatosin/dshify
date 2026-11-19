---
type: fact
title: Preset rows carry a stable id
description: An agent preset is declared as a row with a required stable identifier.
status: verified
package: '@deepseek-ai/dsh-agent-preset'
version: 0.2.2-rc.5
source: README.md
sha256: b3e3f513a8346b7a6c07254c9d3e0f1f2c4e8c1e84cf7951fdd51846ee2a32a7
spec: docs/spec.md §7
---

# Preset rows carry a stable id

## Quote

> | `id` | required | Stable preset identifier |

## Feeds

`src/emit/dsh/bundle.ts` preset row shape (`config.id` = persona id).

## Drift

`python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai`.
