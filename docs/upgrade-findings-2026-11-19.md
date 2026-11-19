# dshify findings — 2026-11-19

Source: a fresh port of the Agency OS repository
(`/home/tosin/projects/agency-os`) against DSH `0.2.2-rc.5`, plus live
community research. This note records what failed, what changed, and what is
still deliberately manual.

## Scope and evidence

| Item | Result |
|---|---|
| Agency OS source surface | 12 skills, 6 commands, 6 personas, 1 MCP server, 2 plugin files |
| `dshify scan` | 4 findings: `AGENTS_MD_SHARED`, `INSTRUCTIONS_EXTRA_UNMAPPED`, `MCP_STDIO`, `PLUGIN_UNSUPPORTED` |
| Temp-copy `apply --presets --delegation` | 134 artifacts written |
| `check --verify-live` | exit 0; 24 skills visible, 0 skipped; 7/7 presets composed |
| Tests | 181 passed; typecheck green |

The Agency OS port is the reproduction case. The temp copy existed so the
verification did not rewrite the user's `.dsh/` tree.

## Findings fixed in this change

### 1. The generated parent preset could not load (critical)

The parent preset mounted this planning group:

```yaml
- id: planning
  name: cordis:group
  config:
    - id: plan-mode
      name: '@deepseek-ai/dsh-plan-mode'
```

`@deepseek-ai/dsh-plan-mode` requires a non-empty `section` and throws at
plugin load without it. DSH's shipped `standard` preset carries a long guidance
block; dshify emitted none. This is exactly the failure class static discovery
cannot catch: the files exist, the YAML parses, and the session dies only when
the preset is instantiated.

Fix:

- `src/emit/dsh/bundle.ts` emits the same plan-mode guidance as DSH
  `0.2.2-rc.5`'s `standard.patch.yml`.
- `check` now walks nested preset plugin rows and reports
  `BUNDLE_PATCH_INVALID` when a `@deepseek-ai/dsh-plan-mode` row lacks a
  non-empty `config.section`.
- Pinned fact: `docs/dsh-facts/facts/plan-mode-section.md`.

### 2. Presets had drifted from the new standard preset

`0.2.2-rc.5`'s standard preset differs from the preset dshify mirrored in
three places that matter:

| Row | Shipped standard | dshify before | Now |
|---|---|---|---|
| `tool-office` | present | absent | present |
| `tool-subagent-control` | `config.interrupt: false` | no config (default `true`) | `interrupt: false` |
| `plan-mode` | required `section` | absent | shipped guidance |

`tool-office` is skill-activated, so its absence silently removed document
rendering/conversion from converted presets. `interrupt: false` matches the
built-in policy; the default exposes `interrupt_agent` that shipped presets
hide.

### 3. `--verify-live` was accepted and then ignored

The flag was in `BOOLEAN_FLAGS`, the help text, `docs/cli.md` and spec §8, but
`parseArgs` never stored it and `check` never ran a probe. That is worse than
an absent flag: CI could pass while the generated bundle was never composed.

Implemented as a composition probe:

```text
dsh --profile dshify-probe --from-default-profile web \
    --dump-config --patch .dsh/harness/cordis.patch.yml
```

with `DSH_HOME` pointing at a fresh temp directory. It checks the exit status
and that every generated preset row appears in the composed roster. It reports:

| Code | Meaning | Exit |
|---|---|---|
| `LIVE_UNVERIFIED` | `dsh` missing, no patch, or no presets | 4 |
| `LIVE_PROBE_FAILED` | `dsh` rejected the bundle or timed out | 4 |
| `LIVE_PRESET_MISSING` | bundle composed but a generated preset is absent | 4 |
| `LIVE_VERSION_DRIFT` | installed DSH differs from the checked rules | 0 (info) |

`DSH_BIN` selects the executable. The probe never reads or writes the user's
profile, installs nothing, and makes no network request. The live output is in
the JSON `live` object and in the human `Live` block.

## Live community pain points and the response

The official repository reports zero open issues; the signal lives in
discussions and community write-ups. The recurring themes and how they map to
dshify:

| Pain point | Evidence | dshify response |
|---|---|---|
| Upgrades break sessions and presets | [Community Pulse #4](https://dshbase.com/blog/community-pulse-4/) describes the rc.1 upgrade as the new failure mode; sessions refused to compose | `LIVE_VERSION_DRIFT` surfaces a version mismatch; `--verify-live` composes the bundle before a user starts a session |
| One bad plugin or bundle stops boot | [Community bug report](https://dshbase.com/blog/dsh-bug-report/) collects plugin/bundle boot failures; a pending entry can block startup | `check` validates the patch shape, nested required config, and now composes it with real DSH |
| Skills are invisible when the path is wrong | [Patch-stack field notes](https://dshbase.com/blog/wx-dsh-patch-stack-field-notes/) call skills discovery the top papercut; [Community Pulse #1](https://dshbase.com/blog/community-pulse-1/) tracks session and plugin failures | Static discovery simulation plus live catalog check; `DISCOVERY_MISS` is exit 4, never a silent pass |
| Config layering is hard to reason about | Same field notes: five patch layers, `--dump-config` is the debugging tool | dshify emits one transparent bundle patch and reports `CONFIG_PRECEDENCE`; the live probe uses the same composition path users boot |
| Subagent models inherit the parent route | [Bug report §7](https://dshbase.com/blog/dsh-bug-report/) lists silent model-override loss | `--model-map` writes explicit `agentOptions`; an unmapped hint is `MODEL_ROUTE_UNMAPPED`, not silently ignored |
| Presets are profile-global and collide | [Feature-request analysis](https://dshbase.com/blog/dsh-feature-requests/) and [Pulse #2](https://dshbase.com/blog/community-pulse-2/) show multi-agent friction | `--preset-prefix` namespaces ids; `PRESET_PROFILE_GLOBAL` states the remaining limitation |
| Install/upgrade churn is the dominant failure mode | [Pulse #2](https://dshbase.com/blog/community-pulse-2/) is almost entirely install hangs | Out of scope for a file emitter, but live composition removes the "it applied and cannot load" class |

The strongest message from the community is not "more features": it is
"verify the thing actually composes". That is why the live probe is the main
change here rather than another emitter option.

## New DSH release facts

`@deepseek-ai/dsh` latest is `0.2.2-rc.5` (tags `latest` and `next`). The
installed checkout and the fact register now agree on it.

Upgrade guides between the previously pinned `0.2.2-rc.1` and `rc.5` that touch
converted surfaces:

- `v0.2.2-rc.1`: built-in presets set `interrupt: false`; subagent control and
  Team tools address agents by name; Node.js 24.9+ is required.
- `v0.2.2-alpha.3`: subagent catalogs write payload version 3; office skills
  and tools replace the older Office CLI surface.
- `v0.2.2-rc.3`: DeepSeek refusal code rename (`MALFORMED_RESPONSE` →
  `CONTENT_REFUSED`).
- `v0.2.2-rc.4`: web search on DeepSeek models defaults to legacy Messages
  search.

dshify's delegation rows still match the current `@deepseek-ai/dsh-tool-subagent`
contract: `agentPreset`, optional `agentOptions: { provider, model }`, and
`allowedAgentPresets` on the generic tool. The name-addressed subagent tools do
not change the emitted configuration.

## Remaining and deliberately manual

| Item | State |
|---|---|
| Preset duplication (open item 11 from 2026-11-13) | Open. Each preset repeats the common rows; `cordis:include` is a plugin, not a preset-list row, so a naive include row is not a drop-in fix. |
| Presets are profile-global (item 12) | Reported (`PRESET_PROFILE_GLOBAL`), not solved. |
| Plugin/custom-tool port | `PLUGINS.md` lists statically extracted tools; the user authors the DSH plugin. Never executed. |
| Extra instruction files | `INSTRUCTIONS_EXTRA_UNMAPPED`; fold into `AGENTS.md` or add to `instructionFileCandidates`. |
| Live probe depth | It proves composition, not a full session start. A required config inside a plugin that only validates at session creation is still caught by the static `BUNDLE_PATCH_INVALID` checks we know about (plan-mode), not by `--dump-config`. |
| Node floor | dshify runs on Node >= 22.12; DSH itself requires Node >= 24.9. `--verify-live` therefore needs a Node 24 runtime for `dsh`. |

## Commands used

```bash
cd /home/tosin/projects/dshify
npm run typecheck
npm test                    # 181 passed
npm run build
python3 -I _tools/check-dsh-facts.py \
  --dsh-root /home/tosin/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai

# temp copy of the Agency OS source surface
dshify apply "$TMP" --presets --delegation --model-map "$TMP/.dsh/model-map.json"
dshify check "$TMP" --presets --delegation \
  --model-map "$TMP/.dsh/model-map.json" --verify-live
```
