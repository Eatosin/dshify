---
type: fact
title: Discovery is one level deep
description: Only direct children of a root are skills; nested bundles are deliberately ignored.
status: verified
package: '@deepseek-ai/dsh-skill-filesystem'
version: 0.2.2-rc.1
source: README.md
sha256: f73e09f41d99ca7684bcb96d20f26c5d177331a68c23392b7c36d8182f6bd608
spec: docs/spec.md §8; Appendix A
---

# Discovery is one level deep

## Quote

> A skill is either a directory bundle `<name>/SKILL.md` or a flat file `<name>.md` at the top level of a scanned root; nested `**/SKILL.md` files are deliberately not discovered.
> - **Discovery is one level deep** — only `<root>/<name>/SKILL.md` and `<root>/<name>.md` are recognized; nested skill trees and package manifests are ignored.

## Feeds

`src/verify/discovery.ts` candidate rules and scan's `UNSUPPORTED_NESTED_SKILL` reporting.

## Drift

`python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai`.
