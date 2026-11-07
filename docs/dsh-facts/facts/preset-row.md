---
type: fact
title: Preset rows carry a stable id
description: An agent preset is declared as a row with a required stable identifier.
status: verified
package: '@deepseek-ai/dsh-agent-preset'
version: 0.2.2-rc.1
source: README.md
sha256: 3bff455be098ec17094a43cfd418ede99afbe6d6b4d3cb874840ee7ccf1f9101
spec: docs/spec.md §7
---

# Preset rows carry a stable id

## Quote

> | `id` | required | Stable preset identifier |

## Feeds

`src/emit/dsh/bundle.ts` preset row shape (`config.id` = persona id).

## Drift

`python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai`.
