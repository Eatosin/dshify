# dshify upgrade findings — 2026-11-13

Source: the Agency OS port (`/home/tosin/projects/agency-os`) to DeepSeek Harness.
The port scanned 12 skills, 6 commands, 6 personas, 1 MCP server, and 2 plugin
files. The surface was installed and verified live: 7 presets are `active`, and
the new skills appear in the session catalog.

This note records what the port exposed. It separates defects fixed in this
change from the emitter work that is still needed.

## Fixed in this change

### 1. The bundle patch had the wrong root shape (critical)

DSH requires `cordis.patch.yml` to be a **top-level YAML array** of loader patch
entries. The emitter wrote a mapping (`insert:` at the root). The DSH plugin
manager rejected the bundle at install time:

```text
dsh: overlay .../cordis.patch.yml must be a top-level YAML array of loader patch entries
```

This broke `apply --presets` for every user: the files were written, and the
bundle could never install.

- Fix: `src/emit/dsh/bundle.ts` now stringifies `[{ insert: rows }]`.
- Guard: `test/bundle.test.ts` asserts the top-level array shape.
- Guard: `check` now validates the installed patch.

### 2. `.opencode/opencode.json` was ignored

`readConfig` read only `<root>/opencode.json`. OpenCode V2 keeps the project
config at `.opencode/opencode.json`. The Agency OS repository uses that path, so
the scan lost the MCP server, the model hints, the permissions, and the
instructions list. Evidence: `dshify scan` reported `mcp 0` before the fix and
`mcp 1` after it, with the finding path `.opencode/opencode.json`.

- Fix: `src/adapters/opencode/scan.ts` tries `.opencode/opencode.json` first,
  then `opencode.json`.
- When both files exist, the project-directory file wins and a new
  `CONFIG_PRECEDENCE` info finding reports the ambiguity.
- `OpenCodeConfig` now carries `relPath`, so findings name the file that was read.

### 3. `check` did not validate the bundle patch

`check` verified skill discovery and byte drift, but it skipped `bundle-patch`
artifacts. That is why defect 1 shipped.

- Fix: `src/core/check.ts` parses the destination patch, requires a top-level
  array, and rejects duplicate row ids and duplicate preset `config.id` values.
- New finding code: `BUNDLE_PATCH_INVALID` (error). Exit code 4.
- Guard: a test applies a bundle, overwrites the patch with the old mapping
  shape, and asserts exit 4.

## Findings not implemented (v0.2 emitter spec)

### 4. Delegation and model routing are lost (highest value)

Today `--presets` emits one preset per persona. It does not emit a parent preset
that can start them, and it reports every `model:` hint as
`MODEL_OVERRIDE_IGNORED`. The Agency OS harness had to add this by hand:

- one `@deepseek-ai/dsh-tool-subagent` row per persona,
- `agentPreset: <preset-id>` to pin the child composition,
- `agentOptions: { provider, model }` to pin the child route,
- `allowedAgentPresets` on the generic `subagent` tool.

DSH routes differ from OpenCode routes. A model map is required; it cannot be
inferred. Agency OS uses:

| Persona | OpenCode hint | DSH route |
|---|---|---|
| planner, architect, reviewers | `opencode-go/deepseek-v4-pro` | `deepseek-official/deepseek-v4-pro` |
| implementer, doc-updater | `opencode-go/minimax-m3` | `deepseek-official/deepseek-flash` |

### 5. Preset ids collide across repositories

Preset ids are the bare persona id (`planner`, `planner`). DSH rejects duplicate
preset ids in one profile, so two generated harnesses cannot be installed
together. The Agency OS bundle uses an `agency-` prefix.

Proposal: `--preset-prefix <prefix>` applies to both the Loader row id
(`preset-<prefix><id>`) and `config.id`. The same prefix feeds `agentPreset`.

### 6. MCP `env` and `cwd` are dropped

`scanMcp` keeps command, args, and url only. A stdio server often needs `env`
(for example `PATH` for `npx`) and `cwd`. Add both to the IR and the emitted row.
Do not pass secret-looking values; keep the current redaction rule.

### 7. `whenToUse` is not preserved

The skill grammar supports `whenToUse`, and the catalog pays for it once per
session. The IR stores description, body, invocation, and resources only. Parse
and emit `whenToUse`; fall back to the description when the source omits it.

### 8. Command routing does not use the delegation tools

A command with `agent: code-reviewer` becomes a skill that says "Start by
loading the `code-reviewer` skill". The main agent then does the review itself:
the child route and the read-only isolation are lost. With change 4, emit:

```text
Delegate this task with the `subagent_code_reviewer` tool.
If the tool is unavailable, load the `code-reviewer` skill and follow it directly.
```

### 9. Plugin and custom-tool surfaces have no port manifest

`PLUGIN_UNSUPPORTED` is a single warning. Users cannot see what they lost. Emit a
machine-readable manifest (`.dsh/harness/PLUGINS.md` plus a JSON file) that lists
each plugin file, the tool names and descriptions found statically, and the DSH
porting recipe. Never execute the source plugin. The Agency OS port hand-wrote
`.dsh/harness/tools/index.js`; that is the expected manual step.

### 10. Extra instruction files are lost

`opencode.json.instructions` can list additional files. DSH loads `AGENTS.md`
and `CLAUDE.md` only. Report `INSTRUCTIONS_EXTRA_UNMAPPED` with the file list and
the remediation: fold the content into `AGENTS.md`, or add the file name to the
`agent-instructions` `instructionFileCandidates` and place it at the project root.

### 11. Preset duplication is large

Each preset repeats the full standard tool list. A six-persona harness is about
650 lines, and an eight-persona harness about 1,900. `cordis:include` can load a
shared entry list from a file. Test whether a preset's `plugins` list accepts a
`cordis:include` row; if it does, factor the common list into one file. If it
does not, document the duplication as a known cost.

### 12. Preset selection is profile-global

Presets cannot be scoped to a project. A generated harness appears in the picker
for every repository in the profile. Do not override
`agent-preset-registry.default` in generated output; document the Settings →
General step instead. Add this to the plan report as `PRESET_PROFILE_GLOBAL`.

## Proposed `.dshify.json` (optional, repository root)

```json
{
  "preset": {
    "prefix": "agency-",
    "main": {
      "id": "agency-main",
      "name": "Agency OS",
      "delegation": [
        { "persona": "planner", "tool": "subagent_planner", "provider": "deepseek-official", "model": "deepseek-v4-pro" },
        { "persona": "implementer", "tool": "subagent_implementer", "provider": "deepseek-official", "model": "deepseek-flash" }
      ],
      "extraPlugins": [
        { "id": "agency-tools", "name": "./tools/index.js" }
      ]
    }
  },
  "mcp": { "placement": "main" },
  "skills": { "whenToUse": "derive" }
}
```

Rules:

- The file is optional. Without it, behavior stays today's behavior.
- Paths in `extraPlugins.name` are relative to the patch file. dshify writes the
  row but never the plugin file; the user authors it.
- `mcp.placement: "main"` puts MCP rows in the parent preset instead of every
  persona preset.
- Validate with zod. Unknown keys fail the scan. Report the file in the plan.

## Test plan

| Change | Test |
|---|---|
| 1 patch array | `test/bundle.test.ts` top-level array + invalid-patch check |
| 2 config discovery | `test/config-discovery.test.ts` (4 cases) |
| 3 check validation | `test/bundle.test.ts` exit 4 on mapping-shaped patch |
| 4 delegation | new `test/bundle-delegation.test.ts`; assert one row per persona, unique tool names, `agentPreset`, `agentOptions` |
| 5 prefix | prefix flows to row id, `config.id`, `agentPreset`; two prefixes in one plan |
| 6 MCP env/cwd | extend `opencode-mcp-auth` fixture; assert no secret value in output |
| 7 whenToUse | scan + emit test; golden update |
| 8 command routing | assert the delegation sentence when a route exists |
| 9 plugin manifest | new fixture with a plugin dir; assert manifest content |
| 10 instructions | assert `INSTRUCTIONS_EXTRA_UNMAPPED` and its file list |

## Verification commands

```bash
cd /home/tosin/projects/dshify
npm run typecheck          # green
npm test                   # 160 passed after this change
npm run build
node dist/cli.js scan /home/tosin/projects/agency-os   # mcp 1, config finding path correct
node dist/cli.js check /home/tosin/projects/agency-os  # lockfile intentionally absent
```

The installed DSH plugin still uses the published `@eatosin/dshify` engine. To
exercise these fixes inside DSH, publish a new engine version and bump the
plugin dependency, or install the plugin from this checkout.

## Status

| Item | State |
|---|---|
| 1 array-shaped patch | fixed, tested |
| 2 project config discovery | fixed, tested |
| 3 bundle validation in check | fixed, tested |
| 4 delegation and model routes | implemented (`--delegation`, `--model-map`) |
| 5 preset prefix | implemented (`--preset-prefix`) |
| 6 MCP env/cwd | implemented (both spellings, secret-safe) |
| 7 `whenToUse` | implemented (preserved, description fallback) |
| 8 command routing | implemented (named delegation tool) |
| 9 plugin manifest | implemented (`PLUGINS.md`, static extraction) |
| 10 extra instructions | implemented (`INSTRUCTIONS_EXTRA_UNMAPPED`) |
| 11 preset duplication | open |
| 12 profile-global presets | reported (`PRESET_PROFILE_GLOBAL`), not solved |
