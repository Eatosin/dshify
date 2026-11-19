---
type: fact
title: Plan mode requires a non-empty section
description: A plan-mode row must carry deployment-owned guidance; omitting it fails at load.
status: verified
package: '@deepseek-ai/dsh-plan-mode'
version: 0.2.2-rc.5
source: README.md
sha256: 52127a3cfed26c9054d63cde1b633b8457f93c00cfb7ac74023ca1324ce4dc37
spec: docs/spec.md §7
---

# Plan mode requires a non-empty section

## Quote

> | `section` | required | Guidance rendered as the `plan:policy` prompt section while plan mode is active |

## Feeds

`src/emit/dsh/bundle.ts` `planning` group. The emitted `plan-mode` row carries
the same guidance text as DSH's shipped `standard` preset. A row without a
non-empty `section` throws during plugin load, so a generated parent preset
would fail before a session starts.

## Drift

`python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai`.
