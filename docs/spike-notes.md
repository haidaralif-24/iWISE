# Day 1-2 Spike Notes

Goal: decide how the AI chat reaches our local tools.

## Checklist
- [ ] Tauri window opens, always-on-top works on my OS
- [ ] Can I log in to the chat site inside the Tauri webview? (try email login if Google blocks it)
- [ ] MarkItDown tested on: textbook PDF / PPTX / DOCX / scanned PDF
- [ ] Minimal MCP server (one `ping` tool) over Streamable HTTP
- [ ] Tunnel exposes it over HTTPS
- [ ] Added as custom connector on a FREE Claude account, and the chat can call `ping`
- [ ] Same test on Le Chat (Mistral) free

## Decision
- [ ] Option A (tunnel + MCP)
- [ ] Option B (script injection)
- [ ] Tier 1 + Tier 2 only

## Findings
(write what worked / failed here)
