# @eatosin/dshify-plugin

[![npm](https://img.shields.io/npm/v/@eatosin/dshify-plugin.svg)](https://www.npmjs.com/package/@eatosin/dshify-plugin)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/Eatosin/dshify/blob/main/LICENSE)

> **Released.** `@eatosin/dshify-plugin@0.2.0` is live. Compatibility: DSH `0.2.2-rc.1` and later. The Web panel is read-only; apply stays in the tool and command.

DeepSeek Harness (DSH) plugin for [dshify](https://github.com/Eatosin/dshify). It ports an OpenCode repository to a DSH surface from inside a session.

## Install

In DSH, open the plugin installation page and enter the package name:

```text
@eatosin/dshify-plugin
```

Compatibility: DSH `0.2.2-rc.1` and later. The plugin requires Node.js 22.12 or later. It depends on `@eatosin/dshify`, which contains the migration engine and the offline core.

### Troubleshooting: `spawn pnpm ENOENT`

The DSH plugin manager uses pnpm for lookup and install. If the Add plugin dialog fails with `spawn pnpm ENOENT`, install pnpm once, then retry:

```bash
npm install -g pnpm
```

## What it adds

The plugin adds one model-facing tool, one human command, and a read-only Web panel.

| Name | Purpose |
|---|---|
| `migrate_harness` tool | Run `scan`, `plan`, `apply`, or `check` on a repository. |
| `/migrate` command | The same actions from the composer. Default action is `plan`. |
| Web panel | Settings → Plugins → **dshify migration**: repository path, destination, presets, and **Scan** / **Plan** / **Check**. Shows the summary, findings, artifacts and raw JSON. |

The tool input:

| Field | Type | Default | Notes |
|---|---|---|---|
| `action` | `scan` \| `plan` \| `apply` \| `check` | required | `apply` writes files. |
| `path` | string | `.` | Repository path. Relative paths use the session working directory. |
| `dest` | string | `.dsh` | Destination tree inside the repository. |
| `presets` | boolean | `false` | Also emit the `.dsh/harness/` preset bundle. |
| `force` | boolean | `false` | Replace human-edited artifacts during `apply`. |

`apply` writes only inside `dest` and the lockfile. It never deletes user files. If a file is not owned by dshify, `apply` reports a conflict.

## Web panel

Open **Settings → Plugins → dshify migration**. The panel runs `scan`, `plan` and `check` against a repository path (empty means the current workspace). It shows the summary, findings, artifact list, and raw JSON.

The panel is read-only. It has no **Apply** button, and its route refuses `apply`. Write the surface with the tool or `/migrate apply`, after you review the plan.

## Command

```text
/migrate plan                 # show the conversion plan
/migrate apply . --presets    # write the surface and the preset bundle
/migrate check                # verify files, lockfile and DSH discovery
```

## Security

- The migration engine is offline. `scan`, `plan`, and `check` never make network calls.
- `apply` writes files. Use a test branch first.
- No secret value from the source repository enters the tool output.

## License

MIT. See [LICENSE](LICENSE).
