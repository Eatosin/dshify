#!/usr/bin/env python3
"""Build an asciicast v2 file from the real dshify demo output.

    python3 _tools/demo-cast.py /tmp/demo.cast
    agg /tmp/demo.cast docs/assets/demo.gif

The cast uses the real CLI output from a temporary demo repository. Keep this
script so the README GIF can be rebuilt when the CLI output changes.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLI = ["node", str(ROOT / "dist" / "cli.js")]
WIDTH, HEIGHT = 96, 30


def setup(work: Path) -> None:
    (work / ".opencode/skills/greet").mkdir(parents=True)
    (work / ".opencode/commands").mkdir(parents=True)
    (work / ".opencode/agents").mkdir(parents=True)
    (work / "opencode.json").write_text(
        '{\n  "$schema": "https://opencode.ai/config.json",\n'
        '  "model": "example/model",\n  "skills": []\n}\n',
        encoding="utf-8",
    )
    (work / ".opencode/skills/greet/SKILL.md").write_text(
        "---\nname: greet\ndescription: Greets the user in a friendly voice.\n---\n\n"
        "Say hello to the user. Keep the greeting short.\n",
        encoding="utf-8",
    )
    (work / ".opencode/commands/review.md").write_text(
        "---\ndescription: Review a change.\n---\n\n"
        "Review $ARGUMENTS. List correctness and security issues.\n",
        encoding="utf-8",
    )
    (work / ".opencode/agents/auditor.md").write_text(
        "---\ndescription: Audits changes without editing files.\nmode: subagent\n"
        "permission:\n  edit: deny\n---\n\n"
        "You audit changes. Report findings. Do not edit files.\n",
        encoding="utf-8",
    )


def run(args: list[str], cwd: Path) -> str:
    result = subprocess.run(CLI + args, cwd=cwd, text=True, capture_output=True)
    return result.stdout


def main() -> int:
    output = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/demo.cast")
    work = Path(tempfile.mkdtemp())
    try:
        setup(work)
        events: list[str] = [
            json.dumps(
                {
                    "version": 2,
                    "width": WIDTH,
                    "height": HEIGHT,
                    "timestamp": int(time.time()),
                    "env": {"SHELL": "/bin/bash", "TERM": "xterm-256color"},
                }
            )
        ]
        clock = 0.0

        def emit(text: str, delay: float = 0.02) -> None:
            nonlocal clock
            clock += delay
            events.append(json.dumps([round(clock, 3), "o", text]))

        def type_line(text: str) -> None:
            for char in text:
                emit(char, 0.018)

        def show(command: str, args: list[str]) -> None:
            type_line(f"$ dshify {command}\n")
            for line in run(args, work).splitlines(keepends=True):
                emit(line, 0.015)
            emit("\n", 0.45)

        emit("")
        for command, args in (
            ("scan .", ["scan", "."]),
            ("plan .", ["plan", "."]),
            ("apply .", ["apply", "."]),
            ("check .", ["check", "."]),
        ):
            show(command, args)
        clock += 1.5
        output.write_text("\n".join(events) + "\n", encoding="utf-8")
        print(f"wrote {output} ({len(events) - 1} events, {clock:.1f}s)")
    finally:
        shutil.rmtree(work)
    return 0


if __name__ == "__main__":
    sys.exit(main())
