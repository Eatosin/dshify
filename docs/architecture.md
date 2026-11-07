# Architecture

How `dshify` is put together, and why each seam exists.

> **Status: implemented for OpenCode V2.** All five commands and the `--presets` bundle work end to end, and `src/verify/discovery.ts` enforces discovery in `check`. Still open: `--verify-live`, a checked DSH fact register (`docs/dsh-facts/`) and nested-skill reporting. Module-level live/ghost status and change impact live in [`map/AGENTS.md`](../map/AGENTS.md). Keep this page for the design rationale (§4) — the map cites it and never restates it.

## 1. Shape

```text
             ┌─────────────── src/adapters/<harness> ───────────────┐
 target repo │ scan(openCode) → HarnessIR                           │
   (read)    └───────────────────────┬──────────────────────────────┘
                                     ▼
                          src/core/plan.ts  (artifacts, losses, conflicts)
                            │                    │
              src/emit/dsh/ │                    │ src/verify/
              (skills,      │                    │ static discovery
               bundle)      ▼                    ▼ (and opt-in live probe)
                        .dsh/ + .dshify.lock.json
                                     │
                            src/cli.ts (human + --json output)
```

The CLI is a thin shell. Everything testable lives behind pure-ish functions that take a root and options and return data.

## 2. Modules

| Module | Responsibility | Allowed side effects |
|---|---|---|
| `src/cli.ts` | parse argv, select command, render output, map findings to exit codes | stdout/stderr, process exit |
| `src/core/ir.ts` | zod schemas + types for IR, artifacts, findings | none |
| `src/core/adapter.ts` | `HarnessAdapter`/`ScanInput` seam and scan limits | none |
| `src/core/frontmatter.ts` | markdown frontmatter parsing and the strict boolean grammar | read |
| `src/core/source.ts` | bounded read-only source reads, hashing, default limits | read |
| `src/core/errors.ts` | typed usage/infrastructure failure and exit codes | none |
| `src/core/scan.ts` | adapter dispatch, root resolution, hashing, limits | read |
| `src/core/plan.ts` | collision rules, emission paths, capability/loss computation, prior-lockfile conflict detection | read |
| `src/core/apply.ts` | write matrix, atomic writes, symlink/path guards, lockfile write | write into dest + lockfile |
| `src/core/lockfile.ts` | schema, canonical serialization, comparison | read/write only via apply |
| `src/core/paths.ts` | repo-root detection, containment checks, safe joins, symlink validation | read/stat |
| `src/core/report.ts` | finding codes/severities, redaction, deterministic ordering | none |
| `src/adapters/opencode/` | `opencode.json` + directory scanning → IR | read |
| `src/emit/dsh/skills.ts` | IR → `SKILL.md` bytes and resource copies | none (returns artifacts) |
| `src/emit/dsh/bundle.ts` | personas + MCP → Cordis patch rows (YAML) | none |
| `src/verify/discovery.ts` | DSH discovery simulation over a tree | read |
| `src/verify/live.ts` | opt-in probe through the `dsh` binary with a temp `DSH_HOME` | spawn (`dsh` only) |

No module imports `node:http`/`https`; the no-network test enforces it.

## 3. Contracts

### 3.1 Adapter

```ts
interface HarnessAdapter {
  readonly id: 'opencode' | 'claude-code' | 'codex';
  readonly displayName: string;
  readonly version: string;
  /** Read the source repo. Pure with respect to the filesystem. */
  scan(input: ScanInput): Promise<HarnessIR>;
  /** Declare which source capabilities the adapter can even observe. */
  readonly capabilities: Readonly<Record<string, Capability>>;
}

interface ScanInput {
  root: string;              // repo root (already resolved)
  extraRoots: string[];      // --root
  limits: ScanLimits;        // max file bytes, max items
  signal: AbortSignal;
}
```

Adapters emit findings instead of throwing for user-content problems. Throwing is reserved for infrastructure failure (permission denied, roots unreadable) and is wrapped as `SCAN_FAILED` by `core/scan.ts`.

### 3.2 Emitter

```ts
interface TargetEmitter {
  readonly id: 'dsh';
  plan(ir: HarnessIR, options: EmitOptions): PlannedOutput;
}

interface PlannedOutput {
  artifacts: Artifact[];       // deterministic order, path + bytes + source refs
  losses: Loss[];
  conflicts: Conflict[];
}

interface Artifact {
  path: string;                // repo-relative destination
  kind: 'skill' | 'command-skill' | 'persona-skill'
      | 'skill-resource' | 'bundle-manifest' | 'bundle-patch';
  bytes: Uint8Array;
  sources: Provenance[];
  capability: Capability;
}
```

Emitters never touch the filesystem. Bytes are computed in memory so golden tests can assert them without writing.

### 3.3 Verifier

```ts
interface DiscoveryResult {
  visible: VisibleSkill[];     // what a DSH session would catalog
  skipped: SkippedEntry[];     // with reason: malformed frontmatter, not a bundle, ...
  roots: string[];             // roots that existed
  complete: boolean;           // false when a root could not be read
}

verifyDiscovery(repoRoot: string, limits: Limits): Promise<DiscoveryResult>;
```

`check` compares the planned artifacts that are supposed to be visible against `DiscoveryResult.visible`; a planned-but-invisible artifact fails with `DISCOVERY_MISS`.

## 4. Design decisions

**Why an IR instead of direct OpenCode→DSH translation.** A direct translator encodes one harness pair in one function; a third harness multiplies the code. The IR is the narrow waist: adapters only have to express source facts (including source-only capabilities as explicit losses), emitters only have to render target facts. It also makes the loss report derivable rather than hand-written.

**Why capability status is per IR item.** Users need to know the *granularity* of loss (`this command lost argument substitution`) not just a repo-level "some things changed". It also forces adapters to be honest at the item level, which is where silent failure hides.

**Why dry-run is not the default for `apply`.** The product's primary risk is writing into a working repo. There is no implicit "migrate" command; writing requires the explicit verb `apply`, and the refusal cases are errors, not prompts (CI-safe, no interactive state).

**Why the lockfile is the source of truth for ownership.** Without it, re-runs cannot distinguish "dshify wrote this and the source changed" from "the human edited this". The write matrix in the spec is the whole conflict strategy; everything else follows from the lockfile being correct and committed.

**Why static discovery simulation is mandatory.** It is the only verification that works offline, in CI, on every platform, and without launching a harness. It must mirror DSH's documented rules, and those rules are cited in code comments so a DSH change is a visible maintenance task, not a silent regression.

**Why emit is additive under `.dsh/`.** The source harness must keep working during the transition. Nothing in the source tree is moved, renamed, or deleted; the DSH surface is a sibling. A team can ship DSH, compare, and roll back by deleting one directory.

## 5. Determinism and idempotency

- Artifacts are sorted by destination path (byte-wise, locale-independent).
- YAML is serialized with sorted keys and a fixed emitter (never the user's preferred style); markdown frontmatter is emitted in a fixed key order.
- No timestamps, absolute paths, usernames, hostnames, or random ids in artifacts. The lockfile's `generatedBy` carries the version only.
- `apply` computes the desired bytes first; if the destination already has identical bytes, it skips the write (no mtime churn). That is what makes the second run a true no-op.
- Tests assert byte-equality across two runs from a pristine copy.

## 6. Testing strategy

| Layer | What | How |
|---|---|---|
| Schema | IR/findings/lockfile schemas reject malformed data | zod + table tests |
| Adapter | OpenCode scan on fixtures | IR snapshots |
| Emitter | planned bytes | golden files per fixture |
| Apply | write matrix rows, conflict/force/repair | temp-dir tests |
| Verifier | malformed/hidden/missing skills | temp-dir + unit tests |
| Determinism | second run identical | hash comparison |
| Safety | traversal, symlink escape, secret redaction, no network | targeted tests + import guard |
| Round-trip | `cli` end-to-end on fixtures | spawn the built CLI in a sandbox dir |

Fixtures are synthetic. A real repository (including the one this product was born from) is used as a manual validation target only and never committed as a fixture.

## 7. Extending

**New source harness (v0.2+):** add `src/adapters/<harness>/`, a fixture, `docs/mapping/<harness>.md`, and tests. No changes to `core/` should be needed beyond new IR fields, which are a spec PR.

**New target (later):** add `src/emit/<target>/` implementing `TargetEmitter`. The IR stays; verification becomes target-specific.

**DSH plugin wrapper (v0.4):** a separate package that imports the core and registers a `migrate_harness` tool plus a `/migrate` command. It shells nothing: it calls the same `plan`/`apply` functions and can offer `plugin_manager install_bundle` after a successful apply. Publishing that wrapper is a bundle, not a CLI — both live in this monorepo once the core is stable.

## 8. Dependencies

Runtime: `yaml` (frontmatter + Cordis patch serialization), `zod` (IR/lockfile/report schemas). Everything else is `node:` built-ins.

Dev: `typescript`, `vitest`, `@types/node`. Adding a runtime dependency requires a PR justification (supply-chain surface is part of the threat model).
