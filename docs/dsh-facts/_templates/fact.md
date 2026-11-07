---
type: fact
title: {the claim in a few words}
description: {one sentence for the generated index}
status: verified
package: '@deepseek-ai/{package}'
version: {exact version}
source: {README.md | lib/....js}
sha256: {64 lowercase hex}
spec: docs/spec.md §{N}; Appendix A
---

# {The claim}

## Quote

> {verbatim line from the source; one blockquote line per source line}

## Feeds

{Which code or contract clause consumes this fact. Cite; do not restate.}

## Drift

`python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai` re-checks the digest and every quote. On drift: update this note and its digest, then the spec in a spec PR.
