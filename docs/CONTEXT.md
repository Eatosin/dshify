# docs — the contract shelf

One job: hold the accepted contract and its detail, and send a reader to the one section a task needs.

`spec.md` is the contract. Everything else here expands or sequences it; nothing overrides it, and no other shelf in this repo restates it.

## Inputs

- Reference (every run): `spec.md` — the accepted v0.1 contract (Accepted 2026-11-05)
- Reference (every run): `cli.md` — the public CLI and JSON contract
- Working (this run): the one doc the task names in the table below
- Do NOT load: `architecture.md` §4 or `roadmap.md` unless the task is design or planning — the wrong default is "read everything in docs/"

## Read by task

The docs are not one unit. Load the row, not the folder.

| Task | Read | Do not read |
|---|---|---|
| implement or review the scan stage | `spec.md` §5.1, §6; `mapping/opencode.md` §1–§3 | `architecture.md` §4, `roadmap.md` |
| implement or review plan/apply | `spec.md` §5.2–§5.3, §7, §9 | the adapter mapping |
| implement or review check/verify | `spec.md` §8, Appendix A; `cli.md` exit codes | `roadmap.md` |
| verify or update a DSH discovery fact | `spec.md` §8, Appendix A; `dsh-facts/CONTEXT.md` | `dsh-facts/facts/` |
| change a finding code or loss severity | `mapping/opencode.md` §2, §10; `spec.md` §10 | `cli.md` |
| change flags, exit codes, or JSON | `cli.md`; `spec.md` §10, §14 | the IR sketch |
| add a source harness (v0.2+) | `spec.md` §6; `architecture.md` §3, §7 | `mapping/opencode.md` |
| plan a version | `roadmap.md` | every other doc |
| understand why a seam exists | `architecture.md` §4 | the mapping doc |

## Budget

`spec.md` is ~4.7k tokens, `mapping/opencode.md` ~3k, `cli.md` ~1.2k. Loading all three is ~8.9k — over the ~8k per-step budget. That is why the table above sends you to **sections**, not files: an adapter step needs `spec.md` §5.1/§6 and the mapping doc, and nothing else.

## Which doc is authoritative

| Doc | Status | Authority |
|---|---|---|
| `spec.md` | Accepted 2026-11-05 | the contract; changes require a spec PR |
| `cli.md` | public API per spec §14 | the CLI/JSON contract; changes require a spec PR |
| `mapping/opencode.md` | behavior contract for the adapter | finding codes and per-construct behaviour |
| `architecture.md` | design rationale | explains seams; the code and `map/` win on what exists |
| `roadmap.md` | plan | sequences work; the spec defines done |

`architecture.md` describes the v0.1 shape including files that do not exist yet. Live versus ghost status per module is in [`../map/objects/_index.md`](../map/objects/_index.md) — trust that over prose here.

## Check

`python3 -I _tools/links.py . --skip fixtures` (every link and input resolves) and `bash _tools/walk-test.sh`. A reviewer confirms that no page here contradicts `spec.md`; where two disagree, the spec wins and the other page is wrong.
