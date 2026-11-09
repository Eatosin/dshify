# Plugin roadmap

Tracking for the DSH plugin (`@eatosin/dshify-plugin`). The CLI roadmap is in [`../docs/roadmap.md`](../docs/roadmap.md).

Status key: **done** · **next** · **later**

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | `migrate_harness` tool | done | `scan`, `plan`, `apply`, `check`; owned writes. |
| 2 | `/migrate` command | done | Defaults to `plan`. |
| 3 | Plugin manager metadata | done | Locale title/description and icon. |
| 4 | Read-only Web panel | done | Settings → Plugins → dshify migration: path, dest, presets, scan/plan/check, summary, findings, artifacts, raw JSON. |
| 5 | Apply from the panel | next | Explicit confirmation, conflict review, and force opt-in. The route must stay explicit about writes. |
| 6 | Artifact diff preview | next | Show planned bytes against the current destination before apply. |
| 7 | Panel config schema | next | Persist default destination, presets, and repository path in the plugin Config. |
| 8 | Live discovery check | later | Reuse `--verify-live` when it lands; keep the offline check as default. |
| 9 | More locales | later | Start with `zh`; English ships now. |
| 10 | Marketplace listing | later | Screenshots, short description, compatibility table. |

Tracked in [issue #28](https://github.com/Eatosin/dshify/issues/28).
