"""Pip MarkItDown wrapper (stub).

Usage: python convert.py <path-to-file>
Prints Markdown to stdout.

Security (enforced by the MCP server BEFORE calling this):
  - only local file paths inside the allowlist; no http(s): or data: URIs
"""
import sys

from markitdown import MarkItDown


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: convert.py <path>", file=sys.stderr)
        return 2
    result = MarkItDown().convert(sys.argv[1])
    print(result.text_content)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
