# objects — one card per load-bearing noun

One job: hold exactly one card per noun a change can hit, so a later agent does not have to read the tree.

## Inputs

- Reference (every run): [`../../docs/spec.md`](../../docs/spec.md) — the contract each card cites
- Reference (every run): [`../_meta/schema.md`](../_meta/schema.md) — labels and citation format
- Working (this run): [`_index.md`](_index.md) — generated catalog
- Do NOT load: other shelves, or the whole `../../src/` tree

## A card carries

1. One sentence: the noun, and its contract or code name if they differ.
2. **Why this shape** — the load-bearing reason, not a field tour.
3. **Shape** — keys, constraints, owning paths; citations.
4. **Connected to** — owns / owned-by / joins / looks-like-but-is-not.
5. **If you change this** — first-order Hits and Does not hit.
6. **Surfaces** — who reads or writes it.
7. **See** — at least one link that resolves today.

## Adding a card

1. Copy [`../_templates/object.md`](../_templates/object.md).
2. Name it after the noun, kebab-case; set `universe`, `status`, `implementation`.
3. Cite `docs/spec.md` §N; name ghost files in backticks, never as links.
4. Regenerate the catalog: `python3 -I _tools/index.py map/objects`.
5. Run `bash _tools/walk-test.sh` — a card that fails the walk test is not done.

## Check

A cold reader opens the catalog, picks one card, and can answer "what is this" and "what else moves" without opening `src/`. That is the check; `walk-test.sh` enforces the structure, a reviewer confirms the blast radius is true.
