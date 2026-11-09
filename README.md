# dshify

[![npm](https://img.shields.io/npm/v/@eatosin/dshify.svg)](https://www.npmjs.com/package/@eatosin/dshify)
[![plugin](https://img.shields.io/npm/v/@eatosin/dshify-plugin.svg?label=plugin)](https://www.npmjs.com/package/@eatosin/dshify-plugin)

Port an agent-harness setup to **DeepSeek Harness (DSH)**. dshify scans the source repository, plans a DSH surface, writes owned files, and checks that DSH discovery can find the result. It reports each capability that it changes or loses.

![dshify demo: scan, plan, apply and check on a small OpenCode repo](docs/assets/demo.gif)

## What it does

dshify has five commands:

| Command | Result | Writes |
|---|---|---|
| `scan` | Read the source harness into a normalized model (IR). | No |
| `plan` | Show the output files, the findings, and the loss report. | No |
| `apply` | Write `.dsh/` and `.dshify.lock.json`. | Yes |
| `check` | Compare the plan, the files, and the lockfile. Run the DSH discovery simulation. | No |
| `verify` | Show what DSH discovery can see in the current tree. | No |

`apply` is the only writer. It is idempotent: a second run changes nothing.

## Demo

The GIF shows one run on a small OpenCode repository. Run the same demo:

```bash
git clone https://github.com/Eatosin/dshify.git
cd dshify
npm install
npm run build
npm run demo
```

## Install

```bash
npm install -g @eatosin/dshify
# or run without installing:
npx @eatosin/dshify --help
```

The package is scoped (`@eatosin/dshify`) because npm reserves the unscoped name. The installed command is `dshify`.

Requires Node.js 22.12 or later. The core is offline: `scan`, `plan`, `apply`, and `check` make no network calls and send no telemetry.

## Use it inside DSH (plugin)

> **Available now.** Install [`@eatosin/dshify-plugin`](https://www.npmjs.com/package/@eatosin/dshify-plugin) from the DSH plugin installation page.

dshify is also a DeepSeek Harness plugin. In DSH, open the plugin installation page and enter:

```text
@eatosin/dshify-plugin
```

The plugin adds the `migrate_harness` tool, the `/migrate` command, and a read-only migration panel in **Settings → Plugins**. It runs the same offline engine. Examples:

```text
/migrate plan
/migrate apply . --presets
/migrate check
```

The plugin never sends your code over the network. `apply` writes files; use a test branch first. See [plugin/README.md](plugin/README.md).

## First run

Use a test branch. Then run these commands in the source repository:

```bash
cd /path/to/opencode-repo
dshify scan .     # inventory the source harness
dshify plan .     # see the files and the loss report
dshify apply .    # write .dsh/ and .dshify.lock.json
dshify check .    # prove that DSH discovery finds each skill
git add .dsh .dshify.lock.json
git commit -m "chore: add the DSH surface"
```

`apply` does not delete your files. It does not overwrite a file that dshify does not own. If you edit a generated file, `apply` reports a conflict and keeps your edit.

## Example output

`scan` reads the source harness:

```text
$ dshify scan .
dshify scan . (opencode adapter 0.1.0)
  skills    1 (1 copyable, 0 native)
  commands  1
  personas  1
  mcp       0
  findings  1
    warning UNKNOWN_FIELD .opencode/agents/auditor.md
```

`plan` shows the files and each loss:

```text
$ dshify plan .
Plan
  persona-skill    .dsh/skills/auditor/SKILL.md adapted
  skill            .dsh/skills/greet/SKILL.md   exact
  command-skill    .dsh/skills/review/SKILL.md  adapted

Losses
  info    ARGS_SUBSTITUTION        .opencode/commands/review.md
  warning SUBAGENT_ISOLATION       .opencode/agents/auditor.md
```

`apply` writes the files and the lockfile:

```text
$ dshify apply .
Apply
  written       .dsh/skills/auditor/SKILL.md
  written       .dsh/skills/greet/SKILL.md
  written       .dsh/skills/review/SKILL.md
Lockfile
  .dshify.lock.json (3 sources, 3 artifacts, written)
```

`check` proves the result:

```text
$ dshify check .
Check
  unchanged  .dsh/skills/auditor/SKILL.md
  unchanged  .dsh/skills/greet/SKILL.md
  unchanged  .dsh/skills/review/SKILL.md

Verification
  roots    .dsh/skills
  visible  3
  skipped  0
```

`check` exits 3 on drift or conflict. It exits 4 when DSH discovery cannot see an emitted skill. Use it in CI.

## What it does not do

- It does not flatten nested skills. It reports `UNSUPPORTED_NESTED_SKILL`.
- It does not support `--strategy link` or `--verify-live` yet.
- It does not support Claude Code or Codex yet. These adapters are on the roadmap.
- It does not run source plugins, commands, or MCP servers.
- It does not repair a human edit. It reports the conflict and keeps the edit.

## How it works

1. **Adapter.** Read the source harness into `HarnessIR`. The IR is the narrow waist.
2. **Emitter.** Build deterministic DSH files. Assign a capability class to each item: `exact`, `adapted`, `lossy`, `manual`, or `unsupported`.
3. **Write matrix.** Compare each artifact with the destination and the lockfile. Then write only the owned files and report the rest.
4. **Verifier.** Simulate DSH discovery: fixed roots, direct children only, strict frontmatter. A conversion that does not verify fails.

Read the contract in [docs/spec.md](docs/spec.md). Read the design in [docs/architecture.md](docs/architecture.md).

## FAQ

**Does dshify change my source repository?**
No. It writes only under `.dsh/` and one lockfile.

**Does dshify need a network connection?**
No. The core is offline. Live verification is opt-in and is not implemented yet.

**What happens if I edit a generated file?**
`check` reports a conflict and exits 3. `apply` keeps your edit. Use `--force` only if you want to replace it.

**What happens if DSH cannot see a generated skill?**
`check` reports `DISCOVERY_MISS` and exits 4.

**Which harnesses are supported?**
OpenCode V2 now. Claude Code is planned for v0.2. Codex is planned for v0.3.

**How do I remove the DSH surface?**
Delete `.dsh/` and `.dshify.lock.json`. The source repository does not change.

## Status and roadmap

The current version is `0.1.3`. It is published as [`@eatosin/dshify`](https://www.npmjs.com/package/@eatosin/dshify) with SLSA provenance.

OpenCode V2 is supported now. The next milestones are the Claude Code adapter, the Codex adapter, and a DSH plugin wrapper. See [docs/roadmap.md](docs/roadmap.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). The most useful contribution is a new adapter: one adapter module, one fixture record, and mapping documentation.

## Security

dshify does not execute source-harness content. Report a vulnerability through [SECURITY.md](SECURITY.md). Do not open a public issue.

## License

[MIT](LICENSE). "OpenCode", "Claude", "Codex", and "DeepSeek" are trademarks of their owners. dshify is not affiliated with them.
