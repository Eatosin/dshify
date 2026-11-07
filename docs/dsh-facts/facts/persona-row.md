---
type: fact
title: Persona is a preset-mounted row
description: A persona is registered per agent by mounting the persona row inside a preset.
status: verified
package: '@deepseek-ai/dsh-persona'
version: 0.2.2-rc.1
source: README.md
sha256: 214628a5cbaa47adcffe0528ebcf26f5c8db58e51b0dfa5c3c774668d5dc56ba
spec: docs/spec.md §7
---

# Persona is a preset-mounted row

## Quote

> `dsh-persona` gives one agent its own persona: a preset mounts this composable row to register persona prefix and suffix sections, shadowing the deployment-wide defaults for that session.

## Feeds

`src/emit/dsh/bundle.ts`: the persona body becomes the `dsh-persona` `prefix` inside each preset.

## Drift

`python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai`.
