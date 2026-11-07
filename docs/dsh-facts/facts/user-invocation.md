---
type: fact
title: /name invocation and host-command precedence
description: A user-invocable skill loads from /name unless a host command claims the name.
status: verified
package: '@deepseek-ai/dsh-client-ui-skill'
version: 0.2.2-rc.1
source: README.md
sha256: 7a9735bf72b6a5afdb786c4ec2ad2577e6037a0369b7db2bebdf6299c3ec7bfc
spec: docs/spec.md §7; Appendix A
---

# /name invocation and host-command precedence

## Quote

> `dsh-client-ui-skill` lets users invoke a skill by choosing it from the `/` suggestions or typing `/name` directly. The same literal command loads the skill consistently from the Web composer, TUI, and ACP, while a name shared with a host command continues to resolve as that command.
> A name shared with a host command still resolves to the command — adjudication claims the line client-side before it ever becomes a prompt.

## Feeds

The `HOST_COMMAND_COLLISION` rename rule in `src/emit/dsh/skills.ts`; spec §7 reserved names.

## Drift

`python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai`.
