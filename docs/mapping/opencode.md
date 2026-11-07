# OpenCode V2 → DSH mapping

The v0.1 adapter. This document is the behavior contract for `src/adapters/opencode`; every finding code here is stable API.

## 1. Source inventory

OpenCode V2 reads instruction surface from these places (all relative to the repo root):

| Path | Holds | Discovery |
|---|---|---|
| `.opencode/skills/<id>/SKILL.md` | local skills | automatic |
| `.opencode/agents/<id>.md` | subagents | automatic |
| `.opencode/commands/<id>.md` | slash commands | automatic |
| `skills/` | extra skills | only when listed in `opencode.json` `skills[]` |
| `.agents/skills/<id>/SKILL.md` | installed third-party skills | only when listed in `skills[]` (common convention) |
| `.opencode/vendor/**` | cloned suites, often gitignored | only when listed in `skills[]` |
| `opencode.json` | model, default agent, skill roots, MCP servers, permissions | — |
| `AGENTS.md` | workspace instructions | automatic |

`dshify` reads `opencode.json` for `skills[]` and `mcp.servers`; it treats the four default locations as roots even when not listed (matching OpenCode's own convention), and reports them as `rootKind: "default"` or `"configured"`.

## 2. Capability matrix

| OpenCode construct | DSH target | Capability | Finding |
|---|---|---|---|
| Skill inside a scanned root | copied (or linked) skill under `<dest>/skills/<id>/` | `exact` | — |
| Skill under `.agents/skills` | nothing emitted | `exact` | `DSH_NATIVE_ROOT` (info) |
| Skill resources referenced by body | copied beside the skill | `exact` | — |
| Skill with missing `description` | not emitted | `unsupported` | `MALFORMED_SKILL` (error) |
| Nested `SKILL.md` below a root's direct children | not emitted | `unsupported` | `UNSUPPORTED_NESTED_SKILL` (warning) |
| Slash command | user-invocable skill (`<id>/SKILL.md`, `disable-model-invocation: true`) | `adapted` | — |
| `$ARGUMENTS` in a command | prose sentence naming the text after the token | `adapted` | `ARGS_SUBSTITUTION` (info) |
| `$1`, `$2` positional args | prose sentence listing expected positional values | `adapted` | `POSITIONAL_ARGS` (info) |
| `!command` shell injection | preserved as a fenced example, never executed | `lossy` | `SHELL_INJECTION` (warning) |
| Command frontmatter `agent:` / `subagent:` | first line of the skill body: "Start by loading the `<id>` skill" when a persona with that id exists; otherwise dropped | `adapted` | `COMMAND_AGENT_ROUTING` (info/warning) |
| Command `model:` / `temperature:` | not applied | `unsupported` | `MODEL_OVERRIDE_IGNORED` (warning) |
| Subagent | model-invocable persona skill (`<id>/SKILL.md`) | `adapted` | `SUBAGENT_ISOLATION` (warning) |
| Subagent `permissions: edit deny` | persona states read-only + reports diffs | `adapted` | `EDIT_DENY_ADAPTED` (warning) |
| Same, with `--presets` | preset row with `tool-fs` `write/include/edit/applyPatch: false` | `exact` | `EDIT_DENY_PRESET` (info) |
| Subagent `tools:` map | not translated (presets use tool switches) | `unsupported` | `TOOLS_FRONTMATTER` (warning) |
| Subagent `model:` | not applied | `unsupported` | `MODEL_OVERRIDE_IGNORED` (warning) |
| Subagent `steps:` | not applied | `unsupported` | `STEPS_IGNORED` (warning) |
| Remote MCP server (`type: remote`) | Cordis row `transport: streamable-http` | `adapted` | `MCP_REMOTE` (info) |
| Local MCP server (command/args) | Cordis row `transport: stdio` | `adapted` | `MCP_STDIO` (info) |
| MCP `disabled: true` | row `disabled: true` | `exact` | `MCP_DISABLED` (info) |
| MCP OAuth / `{env:VAR}` / headers with secrets | row `disabled: true`; secret redacted | `manual` | `MCP_AUTH_MANUAL` (warning) |
| `AGENTS.md` | untouched (DSH loads it) | `exact` | `AGENTS_MD_SHARED` (info) |
| `CLAUDE.md` | untouched (DSH loads it as workspace instructions) | `exact` | `CLAUDE_MD_SHARED` (info) |
| OpenCode plugin / custom tools | nothing (never executed) | `unsupported` | `PLUGIN_UNSUPPORTED` (warning) |
| Unknown `opencode.json` / frontmatter keys | ignored, listed | `unsupported` | `UNKNOWN_FIELD` (warning) |
| Malformed or unreadable `opencode.json` | scan continues with defaults | `unsupported` | `MALFORMED_CONFIG` (error) |
| Command with no single-line `description` or a non-kebab filename | not emitted | `unsupported` | `MALFORMED_COMMAND` (error) |
| Subagent with no single-line `description` or a non-kebab filename | not emitted | `unsupported` | `MALFORMED_PERSONA` (error) |
| MCP server name outside `[A-Za-z0-9_-]{1,32}` | skipped | `unsupported` | `MCP_INVALID_NAME` (error) |
| Resource file unreadable, or larger than the size limit | not copied | `unsupported` | `RESOURCE_READ_FAILED` (error) |
| MCP server when `--presets` is not given | not emitted; reported as manual | `manual` | `MCP_PRESETS_REQUIRED` (info) |

## 3. Skills

Scan rules:

- Roots, in order: `.opencode/skills` (default), every entry of `opencode.json` `skills[]` in listed order, then `.agents/skills` (default). Duplicate roots are deduplicated by `realpath`.
- `--root <dir>` (repeatable) is additive: extra roots are scanned after the configured roots and before `.agents/skills`. A root resolved to `.agents/skills` is `native` regardless of how it was declared.
- A root's **direct children** are candidates: `<dir>/SKILL.md` (directory bundle) or `<dir>.md` (flat file).
- Frontmatter must be a YAML mapping with `name` (kebab-case) and `description` (single line). `name` must equal the directory name; a mismatch is `MALFORMED_SKILL` with a rename suggestion, not an automatic rename.
- `.agents/skills` is emitted nothing: DSH already scans it at rank 200. If a `.agents` skill's `name` does not match its directory, report `MALFORMED_SKILL` because DSH would skip it too.
- Body bytes are preserved. A generated file differs only in frontmatter key order and the required invocation flags.
- `resources`: relative links/images in the body that resolve to files under the skill directory are copied. Anything outside the skill directory is `RESOURCE_OUTSIDE_SKILL` (warning) and not copied.

Emission: `<dest>/skills/<name>/SKILL.md` plus copied resources at the same relative paths. `--strategy link` emits one symlink per skill directory (DSH scans direct children only); report `LINK_STRATEGY` so the portability trade-off is visible.

## 4. Commands

Frontmatter read: `description`, `agent`, `subagent`, `model`, `temperature`, `tools`, `argument-hint`. Unknown keys → `UNKNOWN_FIELD`.

Emitted as a user-invocable skill:

```markdown
---
name: code-review
description: Review code for quality, security, and maintainability.
disable-model-invocation: true
user-invocable: true
---

# /code-review

Start by loading the `code-reviewer` skill; it carries the review playbook.

The text you type after the `/code-review` token is this command's argument.
If it is empty, ask for it before proceeding.

<source body with placeholders rewritten>
```

Placeholder rewriting (deterministic):

- `$ARGUMENTS` → the sentence above (exactly; no other change).
- `$1`, `$2`, … → "The first/second/… whitespace-separated part of the argument is `$N`." lines appended after the argument sentence.
- `` !`cmd` `` → replaced by a fenced block labelled `shell (not executed)`, and `SHELL_INJECTION` is reported. dshify never runs it.

Placement (spec §7): the prose argument sentence is its own paragraph after the `# /<name>` title (and any routing line); inside the body the literal `$ARGUMENTS` token becomes `the argument`, so no placeholder DSL reaches the model. A command skill always carries `disable-model-invocation: true` and `user-invocable: true`.

Name collisions: reserved DSH host commands are the six shipped built-ins — `plan`, `compact`, `goal`, `permission`, `feedback`, `export` ([spec §7](../spec.md)). A colliding command is emitted as `<name>-command` and reported `HOST_COMMAND_COLLISION`. A collision with another emitted artifact is `NAME_COLLISION`; the later artifact gets a numeric suffix (`-2`).

Routing: if `agent` names a subagent that is also being converted, the skill opens with "Start by loading the `<agent>` skill." If it names something unknown (e.g. OpenCode's built-in `build`), the field is dropped and `COMMAND_AGENT_ROUTING` warns. `subagent: true` with no `agent` is reported and dropped.

## 5. Subagents (personas)

Frontmatter read: `description`, `mode`, `model`, `temperature`, `steps`, `tools`, `permissions`, `disabled`, `system`/`prompt` (V1 aliases). Body = system prompt.

Emission without `--presets`: a model-invocable skill, body first line "You are the `<id>` specialist…", then the source body. If the source has an edit-deny rule, append the read-only harness note (report the needed edit, do not modify files; no formatters/codegen/commits/config changes) and report `EDIT_DENY_ADAPTED`.

Emission with `--presets`: additionally `.dsh/harness/cordis.patch.yml` with one `@deepseek-ai/dsh-agent-preset` row per persona:

- `config.id` = persona id, `name`, `description`, `order` = 100 + index.
- persona body as `@deepseek-ai/dsh-persona` `prefix`.
- tool groups mirror DSH's shipped `standard` preset: `dsh-agent-instructions`, `dsh-time-context`, `dsh-tool-bash` (disabled on win32), `dsh-tool-fs`, `dsh-tool-fs-search`, `dsh-tool-todo`, `dsh-tool-web`, `dsh-tool-ask-user`, `dsh-skill-filesystem`, `dsh-tool-skill`, the compaction group, and the delegation group.
- read-only personas: `tool-fs: { read: true, write: false, edit: false, applyPatch: false }`.
- every persona preset also carries the converted MCP rows (§6) inside its `plugins`, so the agent can call them.
- Never installs the bundle; the report prints the `plugin_manager install_bundle` target.

`mode: primary`/missing `mode` on an agent file: OpenCode treats it as a session-level agent, not a subagent. dshify still converts it to a persona but reports `AGENT_MODE_UNEXPECTED` (warning) because the user may have intended a session preset.

## 6. MCP servers

`opencode.json` `mcp.servers.<name>`:

| Source shape | Cordis row |
|---|---|
| `{ "type": "remote", "url": "https://…" }` | `{ id: mcp-<name>, name: '@deepseek-ai/dsh-mcp-client', config: { serverName, transport: streamable-http, url } }` |
| `{ "type": "local", "command": [...], "env": {...} }` | `{ …, config: { serverName, transport: stdio, command, args, env } }` where `command[0]` is the executable and the remainder are `args` |

- `disabled: true` is preserved on the row (row-level `disabled`, not inside `config`).
- Any auth construct (`oauth`, `headers.Authorization`, `{env:VAR}` values, `env` containing a secret-looking key) makes the row `disabled: true` and reports `MCP_AUTH_MANUAL` with the key name and a redacted value. dshify never writes a secret into the patch; the user configures auth and flips `disabled`.
- `{env:VAR}` without a secret-looking name is emitted as a `!!js process.env.VAR` expression only with `--mcp-env` (v0.2); v0.1 reports it as manual.
- Server names are normalized to DSH's `[A-Za-z0-9_-]{1,32}`; invalid names are reported and skipped.
- Rows are nested inside each persona preset's `plugins`. With `--presets` and no converted persona there is nothing to attach them to, so they are reported as `MCP_PRESETS_REQUIRED` and nothing is emitted.

## 7. Include files

`AGENTS.md` and `CLAUDE.md` are loaded by DSH's instruction plugin (`instructionFileCandidates`). dshify emits nothing and reports `AGENTS_MD_SHARED`/`CLAUDE_MD_SHARED`; this is the one construct that is already 100% native, and the report should say so.

OpenCode's legacy `instructions` array in `opencode.json` is ignored by OpenCode V2 itself; dshify reports `INSTRUCTIONS_IGNORED` for parity.

## 8. Plugins and custom tools

Nothing is ported. OpenCode plugins are executable code with a harness-specific API; DSH plugins are Cordis bundles with a different lifecycle. `PLUGIN_UNSUPPORTED` lists what was found (`.opencode/plugin*`, `plugins/`, `tools/`) so the user can decide whether to re-implement. dshify never loads or executes them.

## 9. Fixtures

| Fixture | Covers |
|---|---|
| `fixtures/opencode-basic` | one local skill, one configured extra root, one `.agents` already-native skill, one command with `$ARGUMENTS`, one read-only persona, one remote MCP server, `AGENTS.md` |
| `fixtures/opencode-collisions` (v0.1) | command named `plan`, duplicate persona id, skill name collision, unknown frontmatter keys |
| `fixtures/opencode-malformed` (v0.1) | missing description, non-kebab name, invalid YAML, nested `SKILL.md`, missing configured root |
| `fixtures/opencode-mcp-auth` (v0.1) | OAuth remote, `{env:VAR}` header, disabled server, invalid server name |

All fixtures are synthetic and tiny. No third-party content, no real URLs with credentials.

## 10. OpenCode quirks to encode

- `skills[]` entries are repository-relative paths, not globs. Unknown entries are reported, not guessed.
- `.opencode/vendor/**` is commonly gitignored; the plan should warn `VENDOR_ROOT_UNTRACKED` when a configured root is inside a gitignored path (fresh clones and CI will not have it).
- Command names come from filenames (`<id>.md`), not frontmatter; skills use frontmatter `name`. Normalize both for collision checks.
- OpenCode accepts but ignores `opencode.json` `instructions`; do not treat it as a source.
- Agent frontmatter renamed in V2: `prompt`→`system`, `tools`→`permissions`, `mode` now on the entry. If a V1 key appears, report `LEGACY_FIELD` (warning) and still read it where unambiguous.
