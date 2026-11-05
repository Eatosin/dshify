# map — how to walk this repo's nouns and their blast radius

One job: answer "what is X" and "if I change X, what else moves" for dshify, without reading the whole tree.

## Inputs

- Reference (every run): [`../docs/spec.md`](../docs/spec.md) — the contract; open the cited section only
- Reference (every run): [`_meta/schema.md`](_meta/schema.md) — node types and labels
- Working (this run): `objects/` — the cards (via the generated catalog)
- Do NOT load: the whole `src/` tree, the fixtures, or [`../docs/architecture.md`](../docs/architecture.md) §4 unless a card points there

## How to read

1. Find the noun in [`objects/_index.md`](objects/_index.md).
2. Read the card: one sentence, why this shape, shape, connections.
3. Before editing, read **If you change this** — Hits first, then Does not hit (the wrong next noun is named there).
4. Need the actual rule? Follow the card's citation into `docs/spec.md`. The card is not authoritative; the contract is.

## Universes and implementation state

`universe` says whether the thing is in force (`live`), superseded (`leftover`), or named-but-unwired (`ghost`). `implementation` says what exists on disk (`ghost` / `partial` / `live`).

Today: five of six nouns are **binding contracts whose files are ghosts** — `spec` is accepted, `src/` holds only `src/cli.ts`, `src/index.ts`, `src/version.ts`. That gap is the map's most important fact: an agent must not edit `src/core/plan.ts` because a contract mentions it.

## The four stages are the spec, not folders

The product's pipeline is `docs/spec.md` §5.1–§5.4. It is not a numbered folder sequence here: the stages are behavior the CLI performs on a *target* repo, not files an agent produces, and copying them would restate the contract. Each stage ends at a check — cite it, do not reproduce it.

| Stage | Check it must pass | Where the check is defined |
|---|---|---|
| scan | malformed/missing roots reported, never silently dropped | [spec §5.1](../docs/spec.md) |
| plan | deterministic artifact order; losses and conflicts complete | [spec §5.2](../docs/spec.md) |
| apply | write matrix honored; source bytes unchanged; lockfile last | [spec §5.3](../docs/spec.md) and [§9](../docs/spec.md) |
| check | nonzero on drift, conflict, or discovery miss | [spec §5.4](../docs/spec.md) and [§8](../docs/spec.md) |

Acceptance for all four is [spec §13](../docs/spec.md) plus the tests — those are the checks; this table only routes.

## Name collisions

- "spec" here always means `docs/spec.md`; "map" never means a JSON schema.
- "record" means a fixture record (`fixtures/CONTEXT.md`), not a lockfile entry.
- "stage" means a spec stage; there are no stage folders, so no numbering scheme exists to learn.
- Product language vs code name: *harness surface* = the IR; *persona* = a converted subagent.

## Check

`bash _tools/walk-test.sh` from the repo root: required folders have contracts, every card has its sections and a resolvable `See`, every `verified` card carries a date and commit, and it prints the ghost/stub summary. Link checking is `python3 -I _tools/links.py . --skip fixtures`.
