#!/usr/bin/env python3
"""Markdown -> PDF for the iWISE paperwork.

pandoc gives clean HTML, xhtml2pdf renders it. Both are already installed; no
LaTeX, no LibreOffice, no system packages.
"""
import subprocess
import sys
from pathlib import Path

from xhtml2pdf import pisa

CSS = """
@page {
  size: 210mm 297mm;
  margin: 20mm 18mm 18mm 18mm;
  @bottom-center { content: counter(page); font: 8pt Helvetica; color: #777; }
}
body { font-family: "Times-Roman"; font-size: 10.5pt; line-height: 1.45; color: #1a1a1a; }
h1 { font-family: "Helvetica-Bold"; font-size: 19pt; color: #272E57; margin: 0 0 10pt 0; line-height: 1.2; }
h2 { font-family: "Helvetica-Bold"; font-size: 13pt; color: #272E57; margin: 18pt 0 6pt 0;
     border-bottom: 1.5pt solid #BBA74F; padding-bottom: 3pt; page-break-after: avoid; }
h3 { font-family: "Helvetica-Bold"; font-size: 11pt; color: #272E57; margin: 13pt 0 4pt 0;
     page-break-after: avoid; }
p { margin: 0 0 6pt 0; text-align: justify; }
ul, ol { margin: 0 0 7pt 0; padding-left: 16pt; }
li { margin-bottom: 3pt; text-align: justify; }
table { width: 100%; border-collapse: collapse; margin: 8pt 0 12pt 0; font-size: 9pt; }
th { background: #272E57; color: #ffffff; font-family: "Helvetica-Bold"; font-size: 8.5pt;
     text-align: left; padding: 4pt 5pt; border: 0.5pt solid #272E57; }
td { padding: 3.5pt 5pt; border: 0.5pt solid #d8d8d8; vertical-align: top; }
tr:nth-child(even) td { background: #f7f7f9; }
blockquote { margin: 8pt 0; padding: 6pt 10pt; background: #f4f5f8;
             border-left: 3pt solid #BBA74F; font-size: 10pt; }
blockquote p { margin: 0 0 4pt 0; }
code { font-family: "Courier"; font-size: 9pt; background: #f2f2f4; }
hr { border: 0; border-top: 0.5pt solid #cfcfcf; margin: 12pt 0; }
strong { font-family: "Helvetica-Bold"; }
em { font-family: "Helvetica-Oblique"; }
"""
WRAP = """<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head>
<body>{body}</body></html>"""


def convert(md_path: Path, pdf_path: Path) -> bool:
    html = subprocess.run(
        ["pandoc", str(md_path), "-f", "markdown", "-t", "html", "--no-highlight"],
        capture_output=True, text=True, check=True,
    ).stdout

    # The standard PDF fonts have no glyph for U+2212 MINUS SIGN, so "-63%"
    # would print as a box. An en dash is the nearest thing Times actually has.
    html = html.replace("\u2212", "\u2013").replace("\u2192", "->")

    document = WRAP.format(css=CSS, body=html)
    with open(pdf_path, "wb") as handle:
        result = pisa.CreatePDF(document, dest=handle, encoding="utf-8")
    return not result.err


if __name__ == "__main__":
    docs = Path(__file__).parent
    pairs = [
        ("ABSTRACT.md", "Pip-Abstract.pdf"),
        ("RESEARCH-PLAN.md", "Pip-Research-Plan.pdf"),
        ("REPORT.md", "Pip-Project-Report.pdf"),
    ]
    failed = 0
    for source, target in pairs:
        src, dst = docs / source, docs / target
        if not src.exists():
            print(f"  skip {source}")
            continue
        ok = convert(src, dst)
        size = dst.stat().st_size // 1024 if dst.exists() else 0
        print(f"  {'OK  ' if ok else 'FAIL'} {target:28} {size} KB")
        failed += 0 if ok else 1
    sys.exit(1 if failed else 0)
