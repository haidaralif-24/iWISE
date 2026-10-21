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
| `docs/` | Concept, spike notes, pilot survey, demo script |
| `tests/samples/` | Real test files: textbook PDF, PPTX, DOCX, scanned PDF |

## Quick start

See `docs/spike-notes.md` for the day-1 checklist.
