"""Pip MarkItDown wrapper.

Usage:
    convert.py <path-to-file>            # Markdown to stdout (backwards compatible)
    convert.py <path-to-file> --json     # JSON envelope: markdown + raw text + stats
    convert.py <path-to-file> --pages 1-3,5 --json   # only those PDF pages

Security (enforced by the caller BEFORE this script runs, and re-checked here):
  - only local file paths inside the allowlist; no http(s): or data: URIs
  - MarkItDown's convert_local() is used, never convert()/convert_url(), so a
    URI can never be fetched
  - output is size-capped so one huge file cannot flood the UI or the model

The `--json` envelope also reports the "raw" text of the same document, which is
what a user would get by copying it out of Word or a PDF viewer by hand. The app
uses the two numbers to show a before/after token readout.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

MAX_MARKDOWN_CHARS = 400_000
MAX_RAW_CHARS = 200_000

BLOCKED_PREFIXES = (
    "http://",
    "https://",
    "data:",
    "file://",
    "ftp://",
    "ftps://",
    "//",
)


def die(message: str, code: int = 1) -> int:
    print(message, file=sys.stderr)
    return code


def check_path(raw: str) -> Path:
    """Reject anything that is not a plain local path."""
    lowered = raw.strip().lower()
    if lowered.startswith(BLOCKED_PREFIXES):
        raise ValueError(
            "only local file paths are accepted (no http, https, data or file URIs)"
        )
    path = Path(raw).expanduser()
    if not path.exists():
        raise ValueError(f"no such file: {path}")
    if not path.is_file():
        raise ValueError(f"not a regular file: {path}")
    return path.resolve()


def parse_pages(spec: str | None, total: int) -> list[int]:
    """Turn "1-3,5" into a sorted list of 0-based page indexes."""
    if not spec:
        return list(range(total))

    wanted: set[int] = set()
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" in chunk:
            start_text, _, end_text = chunk.partition("-")
            try:
                start = int(start_text)
                end = int(end_text)
            except ValueError:
                raise ValueError(f"bad page range: {chunk}") from None
            if start > end:
                start, end = end, start
            wanted.update(range(start - 1, end))
        else:
            try:
                wanted.add(int(chunk) - 1)
            except ValueError:
                raise ValueError(f"bad page number: {chunk}") from None

    if not wanted:
        raise ValueError(f"no pages selected: {spec}")

    valid = sorted(index for index in wanted if 0 <= index < total)
    if not valid:
        raise ValueError(f"page selection {spec} is outside 1-{total}")
    return valid


def select_pdf_pages(path: Path, pages: list[int], total: int) -> Path:
    """Write the selected pages to a temporary PDF and return its path.

    Selection is the one place where this app genuinely saves tokens: the user
    sends page 4 of a 6 page worksheet instead of the whole file.
    """
    import tempfile

    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(str(path))
    writer = PdfWriter()
    for index in pages:
        writer.add_page(reader.pages[index])

    handle = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    handle.close()
    writer.write(handle.name)
    return Path(handle.name)


# --------------------------------------------------------------------------
# Whitespace normalisation
#
# Justified text and PDF layout leave runs of 2+ spaces and 3+ blank lines in
# the output. They cost tokens and mean nothing. Measured on the sample
# documents this is worth roughly 3-5% of the tokens on prose.
# --------------------------------------------------------------------------

_MULTI_SPACE = re.compile(r"[ \t ]{2,}")
_MULTI_BLANK = re.compile(r"\n{3,}")
_TRAILING = re.compile(r"[ \t]+$", re.MULTILINE)


def normalise(text: str) -> str:
    """Collapse layout whitespace without touching Markdown structure."""
    if not text:
        return ""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _MULTI_SPACE.sub(" ", text)
    text = _TRAILING.sub("", text)
    text = _MULTI_BLANK.sub("\n\n", text)
    return text.strip()


def estimate_tokens(text: str) -> int:
    """Rough token estimate. The app uses the same rule, so the numbers agree."""
    if not text:
        return 0
    chars = len(text)
    non_ascii = sum(1 for ch in text if ord(ch) > 127)
    return max(1, int(chars / 4 + non_ascii * 0.5))


# --------------------------------------------------------------------------
# Raw text extraction
#
# What the user would get by copy-pasting the document by hand. Used for the
# before/after token readout. Every extractor is optional: if the library for
# that format is not installed, we fall back to the Markdown itself.
# --------------------------------------------------------------------------


def raw_text_pdf(path: Path, pages: list[int] | None = None) -> tuple[str, int]:
    import pdfplumber

    chunks: list[str] = []
    with pdfplumber.open(str(path)) as pdf:
        indexes = pages if pages is not None else range(len(pdf.pages))
        for index in indexes:
            chunks.append(pdf.pages[index].extract_text() or "")
        return "\n\n".join(chunks), len(pdf.pages)


def raw_text_docx(path: Path, pages: list[int] | None = None) -> tuple[str, int]:
    import mammoth

    with open(path, "rb") as handle:
        result = mammoth.extract_raw_text(handle)
    return result.value, 0


def raw_text_pptx(path: Path, pages: list[int] | None = None) -> tuple[str, int]:
    from pptx import Presentation

    presentation = Presentation(str(path))
    slides: list[str] = []
    for slide in presentation.slides:
        lines: list[str] = []
        for shape in slide.shapes:
            if shape.has_text_frame and shape.text_frame.text.strip():
                lines.append(shape.text_frame.text)
        slides.append("\n".join(lines))
    return "\n\n".join(slides), len(presentation.slides._sldIdLst)


def raw_text_xlsx(path: Path, pages: list[int] | None = None) -> tuple[str, int]:
    import openpyxl

    workbook = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    sheets: list[str] = []
    for sheet in workbook.worksheets:
        sheets.append(f"# {sheet.title}")
        for row in sheet.iter_rows(values_only=True):
            cells = ["" if cell is None else str(cell) for cell in row]
            if any(cell.strip() for cell in cells):
                sheets.append(", ".join(cells))
    return "\n".join(sheets), len(workbook.worksheets)


RAW_EXTRACTORS = {
    ".pdf": raw_text_pdf,
    ".docx": raw_text_docx,
    ".pptx": raw_text_pptx,
    ".xlsx": raw_text_xlsx,
}


def extract_raw(path: Path, pages: list[int] | None = None) -> tuple[str, int]:
    extractor = RAW_EXTRACTORS.get(path.suffix.lower())
    if extractor is None:
        return "", 0
    try:
        return extractor(path, pages)
    except Exception:  # noqa: BLE001 - a missing extra must not break conversion
        return "", 0


# --------------------------------------------------------------------------


def main() -> int:
    argv = sys.argv[1:]
    args = [arg for arg in argv if not arg.startswith("--")]
    as_json = "--json" in argv

    pages_spec: str | None = None
    if "--pages" in argv:
        index = argv.index("--pages")
        if index + 1 >= len(argv):
            return die("--pages needs a value, for example --pages 1-3,5", 2)
        pages_spec = argv[index + 1]
        args = [arg for arg in args if arg != pages_spec]

    if len(args) != 1:
        return die("usage: convert.py <path> [--json] [--pages 1-3,5]", 2)

    try:
        path = check_path(args[0])
    except ValueError as err:
        return die(str(err), 3)

    # Page selection only makes sense for PDFs. For everything else the whole
    # document is used.
    selected: list[int] | None = None
    total_pages = 0

    if path.suffix.lower() == ".pdf":
        try:
            import pypdf

            total_pages = len(pypdf.PdfReader(str(path)).pages)
        except Exception as err:  # noqa: BLE001
            total_pages = 0
            # This used to be a bare `total_pages = 0`. pypdf was listed in
            # requirements.txt but missing from the venv, so every PDF reported
            # zero pages and the page selector silently did nothing — which is
            # the feature the token saving depends on. Say so instead.
            print(
                f"warning: could not count PDF pages ({err}); page selection unavailable",
                file=sys.stderr,
            )
            if pages_spec:
                return die("--pages was requested but this PDF's page count could not be read", 3)

        if total_pages:
            try:
                selected = parse_pages(pages_spec, total_pages)
            except ValueError as err:
                return die(str(err), 3)

    # convert_local() only ever touches the local filesystem. convert() and
    # convert_url() would happily fetch a remote URI, which is exactly what the
    # security model forbids.
    from markitdown import MarkItDown

    converter = MarkItDown()
    whole_document = selected is None or selected == list(range(total_pages))

    if whole_document:
        try:
            result = converter.convert_local(path)
        except Exception as err:  # noqa: BLE001
            return die(f"conversion failed: {err}", 4)
        markdown = normalise(result.text_content or "")
    else:
        # One conversion per page, so the model can cite. Converting the whole
        # selection in a single pass loses the page boundaries, and a marker the
        # model can quote ("[p.3]") is the difference between "the document says"
        # and "page 3 says".
        chunks: list[str] = []
        for number in selected:
            try:
                temp = select_pdf_pages(path, [number], total_pages)
            except Exception as err:  # noqa: BLE001
                return die(f"could not select page {number + 1}: {err}", 4)
            try:
                page = converter.convert_local(temp)
                page_text = normalise(page.text_content or "")
            except Exception as err:  # noqa: BLE001
                return die(f"conversion failed on page {number + 1}: {err}", 4)
            finally:
                temp.unlink(missing_ok=True)
            chunks.append(f"[p.{number + 1}]\n\n{page_text}".strip())
        markdown = "\n\n".join(chunks)

    truncated = False
    if len(markdown) > MAX_MARKDOWN_CHARS:
        markdown = markdown[:MAX_MARKDOWN_CHARS]
        truncated = True

    raw, _ = extract_raw(path, selected)
    raw = normalise(raw)
    if len(raw) > MAX_RAW_CHARS:
        raw = raw[:MAX_RAW_CHARS]

    if not as_json:
        print(markdown)
        return 0

    payload = {
        "ok": True,
        "source": str(path),
        "name": path.name,
        "extension": path.suffix.lower(),
        "bytes": path.stat().st_size,
        "pages": total_pages,
        "selectedPages": [index + 1 for index in selected] if selected else [],
        "markdown": markdown,
        "rawText": raw,
        "truncated": truncated,
        "stats": {
            "markdownChars": len(markdown),
            "rawChars": len(raw),
            "markdownTokens": estimate_tokens(markdown),
            "rawTokens": estimate_tokens(raw),
        },
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
