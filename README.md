# Pip

A tiny always-on-top AI chat window that gives the AI you already use safe access
to your files.
No API key, no local model.

iWISE Regional Final, iTECH — Software / Programming.

## Layout

| Folder | Purpose |
|---|---|
| `app/` | Tauri app (floating window, UI, timer, notes, document pipeline) |
| `mcp-server/` | TypeScript MCP server + permission and audit layer |
| `sidecars/markitdown/` | Python MarkItDown wrapper (document to Markdown) |
| `sidecars/tunnel/` | Tunnel binary notes (cloudflared / ngrok) |
| `docs/` | Abstract, research plan, concept, spike notes, progress log, demo script |
| `tests/samples/` | Real test files: textbook PDF, PPTX, DOCX, scanned PDF |

## Quick start

```bash
./setup.sh          # one-time: Rust, Python 3.13 + MarkItDown venv, ngrok/cloudflared, npm deps
./run.sh            # starts the MCP tool server and the Pip window
./run.sh --tunnel   # also starts an ngrok tunnel for the cloud chat connector
```

`setup.sh` is safe to re-run — every step is skipped if it is already in place. It never touches
your system Python: the MarkItDown environment lives in `sidecars/markitdown/.venv`.

To run the pieces by hand:

```bash
cd app && npm run tauri dev        # the window
cd mcp-server && npm run dev       # the tool server on 127.0.0.1:8787
```

The MarkItDown sidecar is not a separate process: the window runs `convert.py` from the sidecar venv
whenever it converts a document, so there is nothing else to start.

`PIP_MCP_TOKEN` is optional. If you set it, it must be at least 16 characters and it wins over
everything else. If you don't, the server generates one on first run and saves it to
`~/.pip/token` (mode 0600) — the same token is reused on every later run, so a connector configured
once keeps working. It is printed on boot so you can paste it into a connector.

The app never needs the token: it talks to the server through `~/.pip/pending` and
`~/.pip/decisions`, not over HTTP. The server also writes `~/.pip/control.json` (0600) containing the
token, but nothing reads it today — it is left over from the design where the app connected directly.

The connector URL is `https://<tunnel-host>/mcp` with an `Authorization: Bearer <token>` header. If
your connector UI cannot send headers, start the server with `PIP_ALLOW_QUERY_TOKEN=1` and use
`https://<tunnel-host>/mcp?token=<token>` instead — query strings end up in tunnel and proxy logs,
which is why it is off by default.

## Tests

```bash
./test.sh                                        # everything below, in one go
```

Or individually:

```bash
cd mcp-server && ./test-tools.sh                 # the tool layer: allowlist, approvals, audit log
cd app/src-tauri && cargo test                   # the app's command layer
cd app && npm run build                          # frontend type-check + production bundle
```

See `docs/spike-notes.md` for the verified checklist, the measured findings and every gotcha, and
`docs/tunnel-setup.md` for getting the chat client to reach the local MCP server (cloudflared needs
no account; ngrok needs one command and gives a stable URL).

## How it fits together

```
Pip window  ──drop a PDF──▶  Python (MarkItDown)  ──▶ clean Markdown + token count
      │                                                       │
      │                                          preview, edit, select pages
      │                                                       │
      └──────── copy prompt ──▶ chat window (no Tauri permissions)
                                                                │
Claude (cloud) ──HTTPS──▶ ngrok ──▶ 127.0.0.1:8787 ──▶ MCP tools ──▶ allowlist + approval + audit
```

The chat window hosts a third-party page and is deliberately absent from
`app/src-tauri/capabilities/default.json`, so it has no Tauri permissions at all. The AI's file
access goes through the local MCP server instead, which enforces the folder allowlist, asks before
writing anything, and writes every call to an append-only audit log.

### Folder access

**Nothing is shared by default.** The AI can read documents in the folders you add in the
**Access** tab, and nowhere else. The notes folder is always shared, because the AI writes notes
there.

The list lives in `~/.pip/allowlist.json` (mode 0600) and the server reads it on every tool call, so
adding or removing a folder takes effect immediately — no restart, no reconnecting the tunnel.
Removing a folder revokes access for the next request, not the one in flight.
