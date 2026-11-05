# Security policy

## Supported versions

`dshify` is pre-alpha. Only the latest `main` and the latest published pre-release receive fixes.

## Reporting a vulnerability

Do **not** open a public issue. Use GitHub's private vulnerability reporting on
<https://github.com/Eatosin/dshify/security/advisories/new>, or contact the
maintainer through the GitHub profile <https://github.com/Eatosin>.

Include: affected version/commit, a minimal reproduction (fixture or command),
and the impact you believe it has. We aim to acknowledge within 72 hours.

## Threat model (relevant for review)

`dshify` reads untrusted repository content and writes files into a target tree.
The following are in scope:

- **Path traversal / symlink escape** when emitting artifacts — destinations must
  resolve inside the destination root, and symlinks that point outside it are refused.
- **Clobbering user files** — only dshify-owned artifacts may be replaced; user edits
  are reported as conflicts, never overwritten.
- **Secret leakage** — scan output and reports must redact credential-like values
  from MCP configs; fixtures must never contain real secrets.
- **Command execution** — the core must never execute harness content. Verification
  may invoke the local `dsh` binary only when the user explicitly opts in
  (`--verify-live`), with a scrubbed environment.
- **Dependency compromise** — runtime dependencies are limited to `yaml` and `zod`;
  additions require justification in a PR.

Out of scope: the behavior of source-harness plugins or MCP servers themselves;
DSH's own security model; repositories the user points `dshify` at.
