#!/usr/bin/env python3
"""Tests for sidecars/markitdown/convert.py.

The converter is the piece that turns a file into the Markdown Pip sends, so
it is checked on every format Pip claims to handle — including the one it
cannot handle (a scan), which has to fail loudly rather than silently return
nothing.

Run it with the project's own virtualenv:

    sidecars/markitdown/.venv/bin/python sidecars/markitdown/test-convert.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SAMPLES = ROOT / "tests" / "samples"
CONVERT = HERE / "convert.py"

passed = 0
failed = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        print(f"  \033[32mPASS\033[0m {name}")
        passed += 1
    else:
        print(f"  \033[31mFAIL\033[0m {name}")
        if detail:
            print(f"       {detail}")
        failed += 1


def run(*args: str) -> tuple[int, dict | None, str]:
    """Runs the converter and parses its JSON envelope."""
    result = subprocess.run(
        [sys.executable, str(CONVERT), *args],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        return result.returncode, None, result.stderr.strip()
    try:
        return 0, json.loads(result.stdout), result.stderr.strip()
    except json.JSONDecodeError as error:
        return 0, None, f"the output was not JSON: {error}"


def sample(name: str) -> Path:
    path = SAMPLES / name
    if not path.exists():
        raise SystemExit(
            f"missing sample: {path}\nRun: sidecars/markitdown/.venv/bin/python "
            f"tests/samples/make-samples.py"
        )
    return path


print("sidecars/markitdown/convert.py")

# --------------------------------------------------------------- every format
FORMATS = [
    ("Activity_1.docx", "a Word document"),
    ("Activity_1.pdf", "a PDF with a text layer"),
    ("Physics_Revision_Slides.pptx", "a slide deck"),
    ("Lab_Results.xlsx", "a spreadsheet"),
    ("Lab_Results.csv", "a CSV"),
    ("Physics_Revision.html", "an HTML page"),
    ("Physics_Revision.txt", "a plain text file"),
]

for filename, description in FORMATS:
    code, envelope, error = run(str(sample(filename)), "--json")
    if envelope is None:
        check(f"converts {description}", False, error or "no output")
        continue

    stats = envelope.get("stats", {})
    check(
        f"converts {description}",
        code == 0
        and envelope.get("ok") is True
        and len(envelope.get("markdown", "")) > 0
        and len(envelope.get("rawText", "")) > 0,
        f"markdown={len(envelope.get('markdown', ''))} "
        f"raw={len(envelope.get('rawText', ''))} {error}",
    )
    check(
        f"reports three honest figures for {description}",
        stats.get("markdownTokens", 0) > 0
        and stats.get("rawTokens", 0) > 0
        and stats.get("markdownChars", 0) == len(envelope.get("markdown", "")),
        f"stats={stats}",
    )

# ------------------------------------------------------------- the scan case
code, envelope, error = run(str(sample("Scanned_Worksheet.pdf")), "--json")
if envelope is None:
    check("says a scanned PDF has no text layer", False, error or "no output")
else:
    check(
        "says a scanned PDF has no text layer",
        envelope.get("noTextLayer") is True and envelope.get("markdown", "") == "",
        f"noTextLayer={envelope.get('noTextLayer')} "
        f"markdown={len(envelope.get('markdown', ''))!r}",
    )
    check(
        "does not claim a scanned PDF is empty in the token figures",
        envelope["stats"]["markdownTokens"] == 0 and envelope["stats"]["rawTokens"] == 0,
        f"stats={envelope['stats']}",
    )

# ------------------------------------------------------------- page selection
assignment = sample("Assignment_1._IB_Physics_Buoyancy_Haidar_Worksheet_Term_2__25_26_.pdf")
code, whole, error = run(str(assignment), "--json")
code, part, error = run(str(assignment), "--pages", "2-3", "--json")

if whole is None or part is None:
    check("page selection cuts the token count", False, error or "no output")
else:
    whole_tokens = whole["stats"]["markdownTokens"]
    part_tokens = part["stats"]["markdownTokens"]
    check(
        "page selection cuts the token count",
        0 < part_tokens < whole_tokens,
        f"whole={whole_tokens} part={part_tokens}",
    )
    check(
        "page selection reports the pages it read",
        part.get("selectedPages") == [2, 3] and part.get("pages") == whole.get("pages"),
        f"selectedPages={part.get('selectedPages')} pages={part.get('pages')}",
    )

# ------------------------------------------------------------------ refusals
for bad in ("http://example.com/x.pdf", "https://example.com/x.pdf", "file:///etc/passwd"):
    code, envelope, error = run(bad, "--json")
    check(
        f"refuses the URI {bad}",
        code != 0 and envelope is None,
        f"exit={code} envelope={envelope}",
    )

code, envelope, error = run(str(SAMPLES), "--json")
check(
    "refuses a directory",
    code != 0 and "not a regular file" in error.lower(),
    f"exit={code} error={error!r}",
)

code, envelope, error = run(str(SAMPLES / "does-not-exist.pdf"), "--json")
check(
    "reports a missing file clearly",
    code != 0 and "no such file" in error.lower(),
    f"exit={code} error={error!r}",
)

# ------------------------------------------------------------- html handling
code, envelope, error = run(str(sample("Physics_Revision.html")), "--json")
if envelope is None:
    check("does not pull scripts or styles out of HTML", False, error)
else:
    raw = envelope.get("rawText", "")
    check(
        "does not pull scripts or styles out of HTML",
        "console.log" not in raw and "font-family" not in raw,
        f"raw={raw[:200]!r}",
    )
    check(
        "keeps the visible text of HTML",
        "Archimedes" in raw and "Buoyancy revision" in raw,
        f"raw={raw[:200]!r}",
    )

# ----------------------------------------------------------- token estimation
code, envelope, error = run(str(sample("Physics_Revision.txt")), "--json")
if envelope is None:
    check("estimates about four characters per token", False, error)
else:
    stats = envelope["stats"]
    expected = max(1, int(stats["markdownChars"] / 4))
    check(
        "estimates about four characters per token",
        abs(stats["markdownTokens"] - expected) <= 1,
        f"tokens={stats['markdownTokens']} expected={expected}",
    )

print()
if failed == 0:
    print(f"\033[32mAll {passed} converter tests passed.\033[0m")
else:
    print(f"\033[31m{failed} of {passed + failed} converter tests failed.\033[0m")
    sys.exit(1)
