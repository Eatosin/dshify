---
type: fact
title: Skill roots and ranks
description: Where a DSH session looks for project skills and in what order.
status: verified
package: '@deepseek-ai/dsh-skill-filesystem'
version: 0.2.2-rc.1
source: README.md
sha256: f73e09f41d99ca7684bcb96d20f26c5d177331a68c23392b7c36d8182f6bd608
spec: docs/spec.md §8; Appendix A
---

# Skill roots and ranks

## Quote

> | 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
> | 200 | `project-agents` | `<projectRoot>/.agents/skills` |
> The project root is the nearest ancestor containing `.git`; without one, the current cwd is used.

## Feeds

`src/verify/discovery.ts` root order and `src/emit/dsh/skills.ts` destination. Custom and user roots (ranks 300–500) are outside the offline simulation.

## Drift

`python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai` re-hashes the source and checks the quotes.
