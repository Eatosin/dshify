# Changelog

## [0.3.0] — 2026-11-13

### Added

- `migrate_harness` accepts `delegation`, `presetPrefix`, `modelMap`, and
  `extraPlugins`, matching engine 0.2.0.
- `/migrate` accepts `--delegation` and `--preset-prefix <prefix>`.

### Changed

- Dependency: `@eatosin/dshify` `^0.2.0`.

## [0.2.0] — 2026-11-09

### Added

- Read-only Web panel in **Settings → Plugins → dshify migration**: repository
  path, destination, presets, Scan / Plan / Check, summary, findings, artifact
  list, and raw JSON.
- Host route `POST /api/dshify/migrate` for the panel. It accepts `scan`,
  `plan`, and `check`; it refuses `apply` with `403`.
- Shared action module (`migrate.js`) used by the tool, the command, and the
  route.

### Notes

- The client half is `dsh.client` with `platform: web`; it injects
  `@deepseek-ai/dsh-client-ui-settings-plugins`.
- Apply is still available only through the tool and `/migrate apply`.

## [0.1.0] — 2026-11-08

- First release: `migrate_harness` tool, `/migrate` command, bundle metadata.
