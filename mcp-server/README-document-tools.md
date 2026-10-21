# MCP document tools configuration

The MCP server exposes two read-only document tools in addition to the `reveal_secret` transport smoke test:

- `list_allowed_files`: lists supported files under a configured root (maximum 200 results and recursion depth 5).
- `read_document_as_markdown`: validates a relative path and converts a supported local file using the MarkItDown sidecar.

## Environment

Run the server from `mcp-server/` and set:

- `PIP_MCP_TOKEN`: a long random bearer token. It is never printed by the server. Send it as `Authorization: Bearer <token>`; query-string tokens are not accepted.
- `PIP_ALLOWED_DIRS`: one or more trusted directories, separated by the platform path delimiter (colon on macOS/Linux, semicolon on Windows). The AI client cannot add roots.
- `PIP_AUDIT_LOG`: optional path to a JSON-lines audit log. Prefer a location outside the document roots.
- `PIP_MAX_FILE_BYTES`: maximum input file size (default 20 MiB).
- `PIP_MAX_OUTPUT_BYTES`: maximum Markdown output (default 2 MiB).
- `PIP_CONVERSION_TIMEOUT_MS`: converter timeout (default 30 seconds).
- `PIP_MAX_REQUEST_BYTES`: maximum HTTP request body (default 1 MiB).
- `PIP_PYTHON`: Python executable (default `python3`).
- `PIP_MARKITDOWN_SCRIPT`: optional explicit path to `sidecars/markitdown/convert.py`.

Example (macOS/Linux):

```sh
export PIP_MCP_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export PIP_ALLOWED_DIRS="$HOME/Documents/iWISE"
export PIP_AUDIT_LOG="$HOME/.local/state/iwise/mcp-audit.jsonl"
cd mcp-server
npm run dev
```

Install the Python sidecar's MarkItDown dependency in the Python environment used by the server before calling the document tool.

## Security notes

- Paths are canonicalized with `realpath` and checked using `path.relative`; supported extensions, regular-file status and size are checked before conversion.
- The converter is launched with `spawn` and `shell: false`, with timeout and output caps.
- HTTP request bodies are bounded, and bearer credentials are not accepted in query strings or printed at startup.
- The audit log records tool names, paths, decision and duration—not document contents or credentials.
- This is an initial safety boundary, not a complete sandbox. A local attacker able to change files between validation and conversion may exploit a time-of-check/time-of-use race. Run the service as a least-privileged OS user, keep allowed roots controlled, and do not expose the tunnel without authentication. Audit log storage should be protected by OS permissions and backups; append mode alone is not tamper-proof.
- Document contents may contain malicious prompt instructions. Treat extracted text as untrusted data.
