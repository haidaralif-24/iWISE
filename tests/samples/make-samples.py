#!/usr/bin/env python3
"""Generates the sample documents Pip is tested against.

The repository only had a DOCX and some PDFs. The other formats Pip claims to
handle — spreadsheet, slides, plain text, HTML — had no sample at all, so
there was no way to tell whether they worked. This script writes one of each,
plus a scanned PDF (a page with no text layer at all), which is the case that
MarkItDown cannot read without OCR.

Run it with the project's own virtualenv:

    sidecars/markitdown/.venv/bin/python tests/samples/make-samples.py

Everything it writes is synthetic — no student work is copied.
"""
from __future__ import annotations

from pathlib import Path

HERE = Path(__file__).resolve().parent


def make_pptx(path: Path) -> None:
    from pptx import Presentation
    from pptx.util import Inches, Pt

    deck = Presentation()
    deck.slide_width = Inches(10)
    deck.slide_height = Inches(7.5)

    def add(title: str, bullets: list[str]) -> None:
        slide = deck.slides.add_slide(deck.slide_layouts[1])
        slide.shapes.title.text = title
        body = slide.placeholders[1].text_frame
        body.text = bullets[0]
        for line in bullets[1:]:
            paragraph = body.add_paragraph()
            paragraph.text = line
            paragraph.font.size = Pt(20)
        for paragraph in body.paragraphs:
            paragraph.font.size = Pt(20)

    add(
        "Buoyancy — revision 3",
        [
            "Archimedes' principle",
            "An object floats when its density is less than the fluid's",
            "Pressure at depth: p = p0 + rho g h",
        ],
    )
    add(
        "Worked example",
        [
            "A 1000 cm3 block of wood, density 600 kg/m3, held underwater",
            "Weight of displaced water: Fb = 1000 x 9.81 x 0.001 = 9.81 N",
            "Weight of the block: W = 600 x 9.81 x 0.001 = 5.89 N",
            "Net upward force: 3.92 N",
        ],
    )
    add(
        "Exam checklist",
        [
            "State the principle in one sentence",
            "Name the three forces on a floating object",
            "Calculate a buoyant force from a diagram",
        ],
    )

    deck.save(path)


def make_xlsx(path: Path) -> None:
    from openpyxl import Workbook
    from openpyxl.styles import Font

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Lab results"

    headings = ["Trial", "Volume (cm3)", "Mass (g)", "Buoyant force (N)"]
    sheet.append(headings)
    for cell in sheet[1]:
        cell.font = Font(bold=True)

    for row in [
        (1, 100, 60, 0.981),
        (2, 200, 120, 1.962),
        (3, 300, 180, 2.943),
        (4, 400, 240, 3.924),
    ]:
        sheet.append(row)

    notes = workbook.create_sheet("Notes")
    notes.append(["Wood block, density 600 kg/m3, water at 1000 kg/m3."])
    notes.append(["Buoyant force equals the weight of the displaced fluid."])

    workbook.save(path)


def make_csv(path: Path) -> None:
    path.write_text(
        "Trial,Volume (cm3),Mass (g),Buoyant force (N)\n"
        "1,100,60,0.981\n"
        "2,200,120,1.962\n"
        "3,300,180,2.943\n"
        "4,400,240,3.924\n",
        encoding="utf-8",
    )


def make_html(path: Path) -> None:
    path.write_text(
        """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Buoyancy revision</title>
    <style>
      body { font-family: sans-serif; }
    </style>
    <script>
      // Scripts and styles must not end up in the extracted text.
      console.log("this must not be extracted");
    </script>
  </head>
  <body>
    <h1>Buoyancy revision</h1>
    <p>Archimedes' principle states that the upward force on a submerged
    object is equal to the weight of the fluid it displaces.</p>
    <h2>Key ideas</h2>
    <ul>
      <li>Buoyant force = weight of displaced fluid</li>
      <li>An object floats when its density is less than the fluid's</li>
      <li>Pressure at depth: p = p0 + rho g h</li>
    </ul>
    <h2>Worked example</h2>
    <p>A 1000 cm3 block of wood (density 600 kg/m3) is held underwater.
    What is the buoyant force?</p>
  </body>
</html>
""",
        encoding="utf-8",
    )


def make_txt(path: Path) -> None:
    path.write_text(
        "BUOYANCY - QUICK REVISION NOTES\n"
        "\n"
        "Archimedes' principle: the upward force on a submerged object is equal\n"
        "to the weight of the fluid it displaces.\n"
        "\n"
        "KEY IDEAS\n"
        "1. Buoyant force = weight of displaced fluid\n"
        "2. An object floats when its density is less than the fluid's\n"
        "3. Pressure at depth: p = p0 + rho g h\n"
        "\n"
        "WORKED EXAMPLE\n"
        "A 1000 cm3 block of wood (density 600 kg/m3) is held underwater.\n"
        "Fb = 1000 x 9.81 x 0.001 = 9.81 N\n"
        "W  =  600 x 9.81 x 0.001 = 5.89 N\n"
        "Net upward force = 3.92 N\n",
        encoding="utf-8",
    )


def make_scanned_pdf(path: Path) -> None:
    """A PDF with no text layer — the page is a picture of text.

    This is what a document off a scanner looks like. MarkItDown has no OCR,
    so it returns nothing for it. Having the file in the repository means the
    limitation is tested rather than assumed.
    """
    from PIL import Image, ImageDraw

    lines = [
        ("BUOYANCY WORKSHEET", 34, 70),
        ("Name: Haidar", 24, 140),
        ("", 24, 180),
        ("1. State Archimedes' principle.", 24, 220),
        ("", 24, 260),
        ("2. A 1000 cm3 block of wood (density 600 kg/m3) is held", 24, 300),
        ("   underwater. Calculate the buoyant force.", 24, 330),
        ("", 24, 370),
        ("3. Why does a steel sink while a wooden ship floats?", 24, 410),
        ("", 24, 450),
        ("4. Pressure at depth h = 2 m in water?", 24, 490),
    ]

    image = Image.new("RGB", (1240, 1754), "white")
    draw = ImageDraw.Draw(image)
    for text, size, y in lines:
        draw.text((90, y), text, fill="black")

    # PIL writes each page as an image, so there is no text to extract.
    image.save(path, "PDF", resolution=150.0)


def main() -> int:
    targets = [
        ("Physics_Revision_Slides.pptx", make_pptx),
        ("Lab_Results.xlsx", make_xlsx),
        ("Lab_Results.csv", make_csv),
        ("Physics_Revision.html", make_html),
        ("Physics_Revision.txt", make_txt),
        ("Scanned_Worksheet.pdf", make_scanned_pdf),
    ]

    for name, builder in targets:
        path = HERE / name
        builder(path)
        print(f"  {name}  ({path.stat().st_size:,} bytes)")

    print(f"\nWrote {len(targets)} samples into {HERE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
