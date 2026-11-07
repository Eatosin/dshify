#!/usr/bin/env bash
# dshify workspace walk test — the method's walk test, made executable.
#
#   bash _tools/walk-test.sh          # report; exit 1 only on hard failures
#   bash _tools/walk-test.sh --check  # CI: warnings also fail
#
# Checks the structure the map promises: every shelf has a contract, every card
# has its required sections and a resolvable See, every verified card carries a
# date and commit, records have their contracts, and no working folder is empty.
# Prints the status report the repo otherwise only states in prose.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
exec python3 -I - "$@" <<'PY'
import re, sys
from pathlib import Path

ROOT = Path.cwd()
STRICT = "--check" in sys.argv
fail, warn = [], []

def read(p):
    return p.read_text(encoding="utf-8-sig", errors="replace")

def front(text):
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            body = {}
            for line in text[3:end].splitlines():
                m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
                if m:
                    body[m.group(1)] = m.group(2).strip()
            return body
    return {}

def links(text):
    out = []
    for m in re.finditer(r"\[[^\]]*\]\(([^)\s]+)\)", text):
        t = m.group(1)
        if re.match(r"^[a-z]+:", t) or t.startswith("#"):
            continue
        out.append(t.split("#")[0])
    return out

def resolves(base, target):
    return (base / target).resolve().exists()

# 1 — the entry file stays a catalog.
entry = ROOT / "AGENTS.md"
if not entry.exists():
    fail.append("AGENTS.md missing")
else:
    n = len(read(entry).splitlines())
    if n > 60:
        fail.append(f"AGENTS.md is {n} lines (limit 60): move payload to a shelf")

# 2 — every working folder states its own contract.
for d in ["map", "map/objects", "map/effects", "docs", "docs/dsh-facts",
          "docs/dsh-facts/facts", "fixtures"]:
    if not (ROOT / d / "CONTEXT.md").exists():
        fail.append(f"{d}/CONTEXT.md missing")

# 3 — every card carries the required sections and an honest status.
SECTIONS = ["## Why this shape", "## Shape", "## Connected to",
            "## If you change this", "## Surfaces", "## See"]
cards = sorted(p for p in (ROOT / "map/objects").glob("*.md")
               if p.name not in ("_index.md", "CONTEXT.md"))
if not cards:
    fail.append("no object cards found")
for p in cards:
    text = read(p)
    rel = p.relative_to(ROOT).as_posix()
    fm = front(text)
    for key in ("type", "universe", "status", "implementation"):
        if key not in fm:
            fail.append(f"{rel}: frontmatter missing `{key}`")
    if fm.get("type") != "object":
        fail.append(f"{rel}: type is {fm.get('type')!r}, expected 'object'")
    if fm.get("universe") not in ("live", "leftover", "ghost"):
        fail.append(f"{rel}: universe {fm.get('universe')!r} invalid")
    if fm.get("implementation") not in ("ghost", "partial", "live"):
        fail.append(f"{rel}: implementation {fm.get('implementation')!r} invalid")
    for s in SECTIONS:
        if s not in text:
            fail.append(f"{rel}: missing section {s!r}")
    see = text.split("## See", 1)[1] if "## See" in text else ""
    see_links = links(see)
    if not see_links:
        fail.append(f"{rel}: `## See` has no links")
    for t in see_links:
        if not resolves(p.parent, t):
            fail.append(f"{rel}: See link does not resolve: {t}")
    if fm.get("status") == "verified":
        if not re.search(r"\d{4}-\d{2}-\d{2}\s*@\s*[0-9a-f]{7,40}", text):
            fail.append(f"{rel}: status verified but no `verified: YYYY-MM-DD @ <commit>`")
    if len(text) / 4 > 1400:
        warn.append(f"{rel}: ~{len(text)//4} tokens — split the card")

# 4 — every contract cites the spec rather than restating it.
for d in ["map", "map/objects", "map/effects", "docs", "docs/dsh-facts",
          "docs/dsh-facts/facts", "fixtures"]:
    f = ROOT / d / "CONTEXT.md"
    if f.exists() and "spec.md" not in read(f):
        fail.append(f"{d}/CONTEXT.md does not cite docs/spec.md")

# 5 — no empty shelves; catalog exists.
if (ROOT / "map/processes").is_dir():
    if not list((ROOT / "map/processes").glob("*.md")):
        fail.append("map/processes/ exists but is empty — delete it until a verb is real")
for idx in ["map/objects/_index.md", "fixtures/_index.md",
            "docs/dsh-facts/facts/_index.md"]:
    if not (ROOT / idx).exists():
        fail.append(f"{idx} missing — run `python3 -I _tools/index.py map/objects fixtures docs/dsh-facts/facts`")

# 6 — fixture records have contracts, and declared goldens exist.
records = sorted(d for d in (ROOT / "fixtures").iterdir()
                 if d.is_dir() and not d.name.startswith((".", "_")))
for d in records:
    c = d / "CONTEXT.md"
    rel = c.relative_to(ROOT).as_posix()
    if not c.exists():
        fail.append(f"{d.name}: record has no CONTEXT.md")
        continue
    fm = front(read(c))
    if fm.get("type") != "fixture":
        fail.append(f"{rel}: type {fm.get('type')!r}, expected 'fixture'")
    golden = fm.get("golden", "")
    if "/" in golden and not resolves(d, golden):
        fail.append(f"{rel}: declared golden path does not exist: {golden}")

# 7 — heuristic: a card that pastes the exit-code table is becoming a second spec.
for p in cards:
    if re.search(r"^\|\s*`?[0-5]`?\s*\|", read(p), re.M):
        warn.append(f"{p.relative_to(ROOT).as_posix()}: looks like a copied exit-code table — cite cli.md")

# 8 — fact notes pin a source digest and carry a verbatim quote.
facts_dir = ROOT / "docs/dsh-facts/facts"
fact_notes = sorted(p for p in facts_dir.glob("*.md")
                    if p.name not in ("_index.md", "CONTEXT.md")) if facts_dir.is_dir() else []
for p in fact_notes:
    text = read(p)
    rel = p.relative_to(ROOT).as_posix()
    fm = front(text)
    if fm.get("type") != "fact":
        fail.append(f"{rel}: type {fm.get('type')!r}, expected 'fact'")
    for key in ("title", "description", "package", "version", "source", "sha256", "spec"):
        if not fm.get(key):
            fail.append(f"{rel}: fact missing `{key}`")
    if not re.fullmatch(r"[0-9a-f]{64}", fm.get("sha256", "")):
        fail.append(f"{rel}: fact sha256 is not 64 lowercase hex")
    if "spec.md" not in fm.get("spec", ""):
        fail.append(f"{rel}: fact does not cite docs/spec.md")
    if not any(line.startswith("> ") for line in text.splitlines()):
        fail.append(f"{rel}: fact has no verbatim quote")

# --- report ---------------------------------------------------------------
def count(key, val):
    return sum(1 for p in cards if front(read(p)).get(key) == val)

impl_ghost = [p for p in cards if front(read(p)).get("implementation") == "ghost"]
impl_partial = [p for p in cards if front(read(p)).get("implementation") == "partial"]
stubs = [p for p in cards if front(read(p)).get("status") == "stub"]
entry_lines = len(read(entry).splitlines()) if entry.exists() else 0
print("dshify workspace walk test")
print(f"  entry      AGENTS.md {entry_lines} lines (~{len(read(entry))//4 if entry.exists() else 0} tokens)")
print(f"  cards      {len(cards)} (live {count('universe','live')}, "
      f"leftover {count('universe','leftover')}, ghost {count('universe','ghost')})")
print(f"  impl       ghost {len(impl_ghost)}, partial {len(impl_partial)}, "
      f"live {count('implementation','live')}")
if impl_ghost:
    print(f"  ghost files {', '.join(p.stem for p in impl_ghost)}")
print(f"  fixtures   {len(records)} record(s), contracts "
      f"{sum((d/'CONTEXT.md').exists() for d in records)}/{len(records)}")
print(f"  stubs      {len(stubs)}" + (f" ({', '.join(p.stem for p in stubs)})" if stubs else ""))
print(f"  facts      {len(fact_notes)} note(s)")
for w in warn:
    print(f"  WARN {w}")
for f in fail:
    print(f"  FAIL {f}")
print(f"result: {'pass' if not fail else 'fail'} ({len(fail)} failures, {len(warn)} warnings)")
sys.exit(1 if fail or (STRICT and warn) else 0)
PY
