---
type: fact
title: Skill frontmatter grammar
description: name kebab-case, description required, invocation booleans resolved strictly.
status: verified
package: '@deepseek-ai/dsh-skill-filesystem'
version: 0.2.2-rc.1
source: README.md
sha256: f73e09f41d99ca7684bcb96d20f26c5d177331a68c23392b7c36d8182f6bd608
spec: docs/spec.md §8; Appendix A
---

# Skill frontmatter grammar

## Quote

> The file starts with YAML frontmatter: required `name` and `description`, plus optional `whenToUse`, `metadata`, `disable-model-invocation`, and `user-invocable`.
> `disable-model-invocation: true` keeps the skill out of model-facing catalogs and loaders; `user-invocable: false` keeps it out of human-facing commands, and omitted fields default to permitting their surface.

## Feeds

`src/verify/discovery.ts` skip reasons (`missing-name`, `invalid-name`, `name-mismatch`, `missing-description`, `invalid-invocation`) and `src/emit/dsh/skills.ts` frontmatter order.

## Drift

`python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai`.
