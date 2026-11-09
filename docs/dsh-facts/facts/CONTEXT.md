# facts — one verifiable claim per note

One job: hold the shipped-DSH facts the verifier cites, each pinned to a package version and a source digest.

## What a note carries

The fields and body sections are defined in [`../_meta/schema.md`](../_meta/schema.md). The quote is verbatim; the note never restates the contract.

## Reported rule set

`check` and `verify` report `rules` with `rulesVersion`, `dshVersion` and `packages`. Bump `rulesVersion` when these facts change, and update `src/core/rules.ts` in the same PR.

## Verify

```bash
python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai
```

The checker reads the local package tree only — no network. It fails when a pinned source file changed or a quote no longer appears.

## Adding a fact

1. Copy [`../_templates/fact.md`](../_templates/fact.md).
2. Quote the exact source line(s); record the package version and `sha256sum` of the source file.
3. Run the checker against a local DSH install; then run `python3 -I _tools/index.py docs/dsh-facts/facts`.
4. A fact change that alters behaviour goes through a spec PR before code.

## Check

The checker exit code; `walk-test.sh` verifies the required fields and that every note carries at least one quote.

## See

- Contract: [`../../spec.md`](../../spec.md) §8
- Discovery card: [`../../../map/objects/dsh-discovery.md`](../../../map/objects/dsh-discovery.md)
