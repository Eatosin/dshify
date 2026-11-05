# effects — changing X: what moves

One job: be the index a change starts from. It answers "I am changing X, what inside the tree moves?" — it does not copy waterfalls. If this index and a card disagree, the card is wrong and gets fixed.

## Inputs

- Reference (every run): [`../../docs/spec.md`](../../docs/spec.md) — the contract behind every row
- Working (this run): [`../objects/_index.md`](../objects/_index.md) — the cards this index points at
- Do NOT load: the whole `objects/` shelf — open only the cards named here

## By what you are changing

| Change | Open first | Then check | Do not touch |
|---|---|---|---|
| an IR field, type, or capability value | [ir](../objects/ir.md) | [emitter-contract](../objects/emitter-contract.md), [lockfile-write-matrix](../objects/lockfile-write-matrix.md) | `docs/cli.md` unless the envelope gains a field |
| a finding code, severity, or message | [adapter-contract](../objects/adapter-contract.md), [dsh-discovery](../objects/dsh-discovery.md) | `docs/mapping/opencode.md`, goldens, lockfile `losses` | `src/cli.ts` |
| emitted `SKILL.md` frontmatter or file order | [emitter-contract](../objects/emitter-contract.md) | [dsh-discovery](../objects/dsh-discovery.md), goldens, determinism tests | adapters |
| DSH discovery roots or frontmatter rules | [dsh-discovery](../objects/dsh-discovery.md) | [spec §8 App. A](../../docs/spec.md), `docs/dsh-facts/` (P2), check exit 4 | emitters |
| lockfile fields or the write matrix | [lockfile-write-matrix](../objects/lockfile-write-matrix.md) | [spec §9](../../docs/spec.md), idempotency + conflict tests | adapters, emitters |
| exit codes, flags, JSON envelope | [cli-json-envelope](../objects/cli-json-envelope.md) | [cli.md](../../docs/cli.md) — public API, spec PR first | internal IR |
| adapter source-root handling | [adapter-contract](../objects/adapter-contract.md) | `docs/mapping/opencode.md`, fixture records | `docs/cli.md` |

First order only. "Then check" names the next card or the test that fails first; it is not a transitive closure.

## What points in from outside the tree

Nothing inside the repo can see these, so no card names them until someone looks. Current list (verified 2026-11-05):

| Outside consumer | Uses | Breaks silently as |
|---|---|---|
| npm installers (`dshify` bin + exports) | `package.json#bin`, `#main`, `#exports` | renamed/moved `dist` entry |
| GitHub Actions (`.github/workflows/ci.yml`) | `npm run typecheck/test/build` script names | renamed scripts |
| DSH sessions in a converted repo | emitted `.dsh/skills/**` + `.dshify.lock.json` | changed discovery rules |
| DSH itself (upstream packages) | the discovery contract the verifier mirrors | upstream README/drift — see `docs/dsh-facts/` (P2) |

No scheduled jobs, agent configs, or other repositories were found pointing into this one (searched `~/.agents`, `~/.config`, `~/.dsh` on 2026-11-05). Re-check at each restructure.

## Check

A cold reader names, for one stated change, both what it hits and what it does not. If a row sends them to a card that does not exist, the index is wrong.
