# map

Walkable map of this repository: one card per load-bearing noun, plus a change-impact index. The map cites the tree and the contract — it is never a second spec. The contract is [`docs/spec.md`](../docs/spec.md).

## Where things live

| Folder | Holds |
|---|---|
| [`objects/`](objects/CONTEXT.md) | one card per noun; catalog in [`objects/_index.md`](objects/_index.md) |
| [`effects/`](effects/CONTEXT.md) | "if you change X, open these cards" — first order only |
| [`_meta/schema.md`](_meta/schema.md) | closed node types and labels |
| [`_templates/`](_templates/object.md) | blank card starters: a new card is a copy |
| `../_tools/` | [`links.py`](../_tools/links.py), [`index.py`](../_tools/index.py), [`walk-test.sh`](../_tools/walk-test.sh) |

## Route by what you are doing

| If | Go to | Stop when |
|---|---|---|
| "what is the IR / adapter / emitter / discovery rules / lockfile / CLI envelope?" | [`objects/_index.md`](objects/_index.md) | the card's **Why this shape** |
| "I am changing X — what else moves?" | [`effects/CONTEXT.md`](effects/CONTEXT.md) | the card's **Hits / Does not hit** |
| "is X implemented, or only specified?" | `objects/_index.md` — read the `implementation:` tag | you can name the ghost files |
| adding a new noun | copy [`_templates/object.md`](_templates/object.md) | the new card passes `walk-test.sh` |
| reporting status | `bash _tools/walk-test.sh` | it prints ghosts, stubs and counts |
| the contract itself | [`../docs/spec.md`](../docs/spec.md) | — |

## The one rule

A card records **status and blast radius**, and cites the spec by section. It never restates the contract: if you need the rule, follow the citation.
