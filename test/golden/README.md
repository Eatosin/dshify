# Golden outputs

Expected buffers for the OpenCode → DSH emitter: one directory per fixture record,
mirroring the destination tree with the `.dsh/` prefix stripped.

Regenerate after an intended emitter change:

```bash
DSHIFY_UPDATE_GOLDENS=1 npx vitest run test/golden
```

Review the diff before committing — a golden change is a behavior change, and the
test also fails if a committed golden no longer corresponds to a planned artifact.
