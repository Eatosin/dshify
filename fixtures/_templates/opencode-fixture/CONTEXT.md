---
type: fixture
title: {harness}-{case}
description: {One sentence: the one behaviour this record pins.}
status: template
covers: {spec §13 item numbers this record will prove}
golden: pending — lands with the emitter (P2)
---

# {harness}-{case} — {the one behaviour}

{Two sentences: what this record exists to prove, and what it deliberately does not cover.}

## What it pins

| Surface | File | Proves |
|---|---|---|
| {surface} | `{path}` | {the behaviour} |

## Why this shape

{The load-bearing reason for this record's particular content — usually the smallest input that makes the behaviour observable.}

## Connected to

- **owned-by:** the record library contract [`../CONTEXT.md`](../CONTEXT.md); the stamp `../_templates/opencode-fixture/`.
- **joins:** `docs/spec.md` §13; `docs/mapping/opencode.md`; the tests that read it.
- **looks-like-but-is-not:** {the neighbouring record it is easily confused with}.

## If you change this

- **Hits:** {the spec §13 item, the mapping section, the test, the golden output}.
- **Does not hit:** other records, or `src/`. A new behaviour gets a new record.

## Check

`bash _tools/walk-test.sh` confirms the record has its contract; a reviewer confirms it is synthetic, tiny, and proves exactly one behaviour.
