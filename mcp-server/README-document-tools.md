# MCP document tools configuration

The MCP server exposes two read-only document tools in addition to the `reveal_secret` transport smoke test:

- `list_allowed_files`: lists supported files under a configured root (maximum 200 results and recursion depth 5).
- `read_document_as_markdown`: validates a relative path and converts a supported local file using the MarkItDown sidecar.

## Environment

Run the server from `mcp-server/` and set:

- `PIP_MCP_TOKEN`: **required**, at least 16 characters. The server refuses to start without it, because an unauthenticated server that reads files is not a safe default. It is never printed. Send it as `Authorization: Bearer <token>`.
- `PIP_ALLOW_QUERY_TOKEN`: set to `1` to also accept `?token=<token>` on `/mcp`. Off by default — query strings end up in tunnel and proxy logs. Needed only for connector UIs that cannot send an `Authorization` header.
- `PIP_ALLOWED_DIRS`: one or more trusted directories, separated by the platform path delimiter (colon on macOS/Linux, semicolon on Windows). The AI client cannot add roots.
- `PIP_AUDIT_LOG`: optional path to a JSON-lines audit log. Prefer a location outside the document roots.
- `PIP_MAX_FILE_BYTES`: maximum input file size (default 20 MiB).
- `PIP_MAX_OUTPUT_BYTES`: maximum Markdown output (default 2 MiB).
- `PIP_CONVERSION_TIMEOUT_MS`: converter timeout (default 60 seconds — a cold conversion of an image-heavy PDF measured 22s).
- `PIP_MAX_REQUEST_BYTES`: maximum HTTP request body (default 1 MiB).
- `PIP_PYTHON`: Python executable. Defaults to `sidecars/markitdown/.venv/bin/python` when that venv exists, otherwise `python3`. The system Python will not have MarkItDown installed.
- `PIP_MARKITDOWN_SCRIPT`: optional explicit path to `sidecars/markitdown/convert.py`. Defaults to the copy in this repository, resolved relative to the module rather than the working directory.

Example (macOS/Linux):

```sh
export PIP_MCP_TOKEN="$(openssl rand -hex 32)"
export PIP_ALLOWED_DIRS="$HOME/Documents/iWISE"
export PIP_AUDIT_LOG="$HOME/.local/state/iwise/mcp-audit.jsonl"
# Only if your connector cannot send an Authorization header:
# export PIP_ALLOW_QUERY_TOKEN=1
cd mcp-server
npm run dev
```

Set up the converter once before using the document tool:

```sh
cd sidecars/markitdown && uv venv .venv && uv pip install -r requirements.txt
```

## Security notes

- Paths are canonicalized with `realpath` and checked using `path.relative`; supported extensions, regular-file status and size are checked before conversion.
- The converter is launched with `spawn` and `shell: false`, with timeout and output caps.
- HTTP request bodies are bounded, and bearer credentials are not printed at startup. Query-string tokens are refused unless `PIP_ALLOW_QUERY_TOKEN=1` is set explicitly.
- An unset, empty or short `PIP_MCP_TOKEN` stops the server from starting. An empty token previously compared equal to a missing `Authorization` header, which authorised every request.
- The audit log records tool names, paths, decision and duration—not document contents or credentials. `decision` distinguishes `deny` (policy refusal) from `error` (conversion failed after the path was approved).
- This is an initial safety boundary, not a complete sandbox. A local attacker able to change files between validation and conversion may exploit a time-of-check/time-of-use race. Run the service as a least-privileged OS user, keep allowed roots controlled, and do not expose the tunnel without authentication. Audit log storage should be protected by OS permissions and backups; append mode alone is not tamper-proof.
- Document contents may contain malicious prompt instructions. Treat extracted text as untrusted data.
