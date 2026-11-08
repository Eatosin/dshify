## Summary

What changes, and why.

## Contract

- [ ] Behavior changes update `docs/spec.md` (or a doc it cites) in this PR.
- [ ] Finding codes, flags, or JSON changes are recorded in `docs/cli.md` and the mapping doc.

## Verification

- [ ] `npm run typecheck && npm test && npm run build`
- [ ] `bash _tools/walk-test.sh` and `python3 -I _tools/links.py . --skip fixtures`
- [ ] Fixture record and golden reviewed if the surface changed.
- [ ] No network calls, no secrets, no source-harness writes.
