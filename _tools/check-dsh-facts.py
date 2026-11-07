#!/usr/bin/env python3
"""Verify the DSH fact register against a local installed DSH package tree.

    python3 -I _tools/check-dsh-facts.py --dsh-root <path>/node_modules/@deepseek-ai

Each note in docs/dsh-facts/facts/ pins a package, version, source file and
SHA-256, and carries verbatim `> ` quotes. This checker re-hashes the source,
compares the package version, and requires every quote to appear verbatim.

Local files only: no network, no harness launch. Exit 1 on drift, 2 on usage.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

FACTS = Path(__file__).resolve().parent.parent / "docs" / "dsh-facts" / "facts"


def frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    data: dict[str, str] = {}
    for line in text[3:end].splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        data[key.strip()] = value
    return data, text[end + 4 :]


def quotes(body: str) -> list[str]:
    # Preserve everything after "> " so indented code quotes stay exact.
    return [line[2:] for line in body.splitlines() if line.startswith("> ") and line[2:].strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsh-root", required=True, help="installed @deepseek-ai directory")
    parser.add_argument("--facts", default=str(FACTS), help="fact notes directory")
    args = parser.parse_args()

    root = Path(args.dsh_root)
    if not root.is_dir():
        print(f"error: DSH root not found: {root}", file=sys.stderr)
        return 2

    failures: list[str] = []
    checked = 0
    for path in sorted(Path(args.facts).glob("*.md")):
        if path.name in ("_index.md", "CONTEXT.md"):
            continue
        data, body = frontmatter(path.read_text(encoding="utf-8"))
        package = data.get("package", "")
        source = data.get("source", "")
        digest = data.get("sha256", "")
        version = data.get("version", "")
        if not (package and source and digest):
            failures.append(f"{path.name}: missing package/source/sha256")
            continue

        # --dsh-root is the scope directory (node_modules/@deepseek-ai).
        package_dir = root / package.split("/")[-1]
        target = package_dir / source
        rel = f"{package}/{source}"
        if not target.is_file():
            failures.append(f"{path.name}: missing {rel}")
            continue

        manifest_path = package_dir / "package.json"
        if manifest_path.is_file():
            shipped = json.loads(manifest_path.read_text(encoding="utf-8")).get("version")
            if shipped and version and shipped != version:
                failures.append(f"{path.name}: pinned version {version} != installed {shipped}")
                continue

        actual = hashlib.sha256(target.read_bytes()).hexdigest()
        if actual != digest:
            failures.append(f"{path.name}: {rel} digest {actual} != pinned {digest}")
            continue

        text = target.read_text(encoding="utf-8")
        missing = [q for q in quotes(body) if q not in text]
        if missing:
            failures.append(f"{path.name}: {len(missing)} quote(s) not found in {rel}")
            continue

        checked += 1

    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        print(f"fact register: {len(failures)} drift(s)")
        return 1
    print(f"fact register: {checked} note(s) verified against {root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
