# @eatosin/dshify-plugin

[![Status: pre-release](https://img.shields.io/badge/status-pre--release%20%C2%B7%20final%20verification-orange)](https://github.com/Eatosin/dshify)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/Eatosin/dshify/blob/main/LICENSE)

> **Launching soon.** Version `0.1.0` is staged for release. Final verification runs now: unit tests, a packed install, and a real DSH composition check. Installation below becomes available after npm approval. Watch the repository for the release notice.

DeepSeek Harness (DSH) plugin for [dshify](https://github.com/Eatosin/dshify). It ports an OpenCode repository to a DSH surface from inside a session.

## Install

In DSH, open the plugin installation page and enter the package name:

```text
@eatosin/dshify-plugin
```

Compatibility: DSH `0.2.2-rc.1` and later. The plugin requires Node.js 22.12 or later. It depends on `@eatosin/dshify`, which contains the migration engine and the offline core.

## What it adds

The plugin adds one model-facing tool and one human command.

| Name | Purpose |
|---|---|
| `migrate_harness` tool | Run `scan`, `plan`, `apply`, or `check` on a repository. |
| `/migrate` command | The same actions from the composer. Default action is `plan`. |

The tool input:

| Field | Type | Default | Notes |
|---|---|---|---|
| `action` | `scan` \| `plan` \| `apply` \| `check` | required | `apply` writes files. |
| `path` | string | `.` | Repository path. Relative paths use the session working directory. |
| `dest` | string | `.dsh` | Destination tree inside the repository. |
| `presets` | boolean | `false` | Also emit the `.dsh/harness/` preset bundle. |
| `force` | boolean | `false` | Replace human-edited artifacts during `apply`. |

`apply` writes only inside `dest` and the lockfile. It never deletes user files. If a file is not owned by dshify, `apply` reports a conflict.

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
