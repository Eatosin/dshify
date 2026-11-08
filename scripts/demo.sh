#!/usr/bin/env bash
# Deterministic demo: builds a small OpenCode repo, then runs scan -> plan ->
# apply -> check with the local build. Use it for a quick tour or to record
# the README demo GIF.
set -euo pipefail
cd "$(dirname "$0")/.."
CLI=(node "$PWD/dist/cli.js")
if [ ! -f dist/cli.js ]; then
  echo "dist/cli.js is missing. Run: npm run build" >&2
  exit 1
fi
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/.opencode/skills/greet" "$WORK/.opencode/commands" "$WORK/.opencode/agents"
cat > "$WORK/opencode.json" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "example/model",
  "skills": []
}
JSON
cat > "$WORK/.opencode/skills/greet/SKILL.md" <<'MD'
---
name: greet
description: Greets the user in a friendly voice.
---

Say hello to the user. Keep the greeting short.
MD
cat > "$WORK/.opencode/commands/review.md" <<'MD'
---
description: Review a change.
---

Review $ARGUMENTS. List correctness and security issues.
MD
cat > "$WORK/.opencode/agents/auditor.md" <<'MD'
---
description: Audits changes without editing files.
mode: subagent
permission:
  edit: deny
---

You audit changes. Report findings. Do not edit files.
MD
cd "$WORK"
git init -q
echo "demo repo: $WORK"
"${CLI[@]}" scan .
echo
"${CLI[@]}" plan .
echo
"${CLI[@]}" apply .
echo
"${CLI[@]}" check .
