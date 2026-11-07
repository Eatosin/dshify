# dsh-facts — checked facts the verifier depends on

One job: hold the shipped-DSH facts that `src/verify/discovery.ts` and the emitter rely on, each with the exact source text, the package version, and a content hash so drift is detectable.

This shelf is reference material, not a second spec: the contract is [`../spec.md`](../spec.md), where these facts appear in §8 and Appendix A. A fact note quotes the shipped README or source file verbatim; it does not paraphrase.

## What it holds

| Path | Holds |
|---|---|
| [`facts/`](facts/CONTEXT.md) | one note per fact: quote, package, version, source path, sha256, and the spec clause it feeds |
| [`_meta/schema.md`](_meta/schema.md) | the closed note type and required fields |
| [`_templates/fact.md`](_templates/fact.md) | the stamp for a new fact |
| `../../_tools/check-dsh-facts.py` | local verifier: re-hashes each source and re-checks every quote |

## How to use it

1. Changing a discovery rule or an emitted frontmatter field? Open the fact that backs it, not just the spec.
2. Verify against a local DSH install (see [`facts/CONTEXT.md`](facts/CONTEXT.md)):
   `python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai`
3. On drift: update the fact (and its pinned digest) first, then the spec in a spec PR. The code follows.

## Check

`python3 -I _tools/links.py . --skip fixtures` and `bash _tools/walk-test.sh` validate structure; the local fact checker validates content against the installed DSH package tree. The checker is deliberately not in CI — CI has no DSH install, and the core stays offline.

## See

- Contract: [`../spec.md`](../spec.md) §8 and Appendix A
- Verifier: [`../../src/verify/discovery.ts`](../../src/verify/discovery.ts)
- Discovery card: [`../../map/objects/dsh-discovery.md`](../../map/objects/dsh-discovery.md)
