# Pip

A tiny always-on-top AI chat window that gives the AI you already use safe access
to your files, plus a few offline productivity tools.
No API key, no local model.

iWISE Regional Final, Software / Programming.

## Layout

| Folder | Purpose |
|---|---|
| `app/` | Tauri app (floating window, UI, timer, notes, launcher). Created with `npm create tauri-app@latest` |
| `mcp-server/` | TypeScript MCP server + permission and audit layer |
| `sidecars/markitdown/` | Python MarkItDown wrapper (document to Markdown) |
| `sidecars/tunnel/` | Tunnel binary notes (cloudflared / ngrok) |
| `bridge/` | Page-script helper for inserting Markdown into the chat input (Tier 2). Not a tool bridge — tool access goes through MCP |
| `docs/` | Concept, abstract, slides, spike notes, pilot survey, demo and recording scripts |
| `tools/` | Build helpers: slide renderer, DMG builder |
| `tests/samples/` | Test files: textbook PDF, DOCX, slides, spreadsheet, CSV, HTML, text, and a scanned PDF |

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
cd app && npm run tauri dev                      # the window
cd mcp-server && PIP_MCP_TOKEN=... npm run dev   # the tool server on 127.0.0.1:8787
```

The MCP server prints the token and the connector URL on boot. `PIP_MCP_TOKEN` is optional — if it is
not set, a token is generated and written to `~/.pip/control.json` (mode 0600).

## Tests

```bash
./test.sh                                        # everything below, in one go
```

Or individually:

```bash
cd mcp-server && ./test-tools.sh                 # the tool layer: allowlist, approvals, audit log
cd app/src-tauri && cargo test                   # the app's command layer
node bridge/test-inject.js                       # the page script that writes into the chat box
sidecars/markitdown/.venv/bin/python \
  sidecars/markitdown/test-convert.py            # every format the converter claims to read
node app/ui-audit.mjs                            # the interface, rendered and measured
cd app && npm run build                          # frontend type-check + production bundle
```

`node app/ui-audit.mjs` renders the real interface in headless Chrome at its real window size
(420×680), measures it for clipped text, content outside the window and controls too small to hit,
and writes a screenshot of every screen to `docs/screenshots/`. It needs a Chrome binary; set
`CHROME=/path/to/chrome` if it is not in the usual place.

## Building a release

```bash
cd app && npm run tauri build -- --bundles app   # the .app
./tools/make-dmg.sh                              # the .dmg
```

`tools/make-dmg.sh` exists because Tauri's own bundler drives Finder over AppleScript to lay out
the disk image, and that is refused on some machines (including this one, where the call comes back
with "AppleEvent timed out"). The script uses `hdiutil` alone, so it needs no GUI automation and
works over SSH or on a build server.

## The talk

```bash
node tools/slides-to-html.mjs    # docs/slides.md -> docs/slides.html
```

Open `docs/slides.html` in a browser and press the arrow keys. `n` shows the speaker notes, `f` goes
full screen, and `cmd+p` prints it to a PDF, one slide per page.

See `docs/spike-notes.md` for the verified checklist, the measured findings and every gotcha, and
`docs/tunnel-setup.md` for getting the chat client to reach the local MCP server (cloudflared needs
no account; ngrok needs one command and gives a stable URL).

## How it fits together

```
Pip window  ──drop a PDF──▶  Python (MarkItDown)  ──▶ clean Markdown + token count
      │                                                       │
      │                                          preview, edit, select pages
      │                                                       │
      └──────── inject ──▶ chat window (no Tauri permissions)  │
                                                                │
Claude (cloud) ──HTTPS──▶ ngrok ──▶ 127.0.0.1:8787 ──▶ MCP tools ──▶ allowlist + approval + audit
```

The chat window hosts a third-party page and is deliberately absent from
`app/src-tauri/capabilities/default.json`, so it has no Tauri permissions at all. The AI's file
access goes through the local MCP server instead, which enforces the folder allowlist, asks before
writing anything, and writes every call to an append-only audit log.
