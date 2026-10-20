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

### 2026-10-20 — window + hotkey (verified on macOS, Tauri 2.12.4)

- `tauri-plugin-global-shortcut` 2.4.1 registered `CmdOrCtrl+Shift+Space` on first launch:
  `[pip] hotkey CmdOrCtrl+Shift+Space registered`. No Accessibility permission requested.
- `cargo check` and `cargo build` clean, no warnings. `tsc --noEmit` and `vite build` clean.
- Window config: 420x680, `alwaysOnTop: true`, `decorations: false`, drag region on the title bar.
- Chat window is created at runtime by the `open_chat` command. It is not in
  `capabilities/default.json` (which lists `windows: ["main"]` only), so the third-party page
  has no Tauri IPC access. **Login inside the webview still untested — needs a human.**
- Gotcha hit: `npm run tauri dev` fails with `Port 1420 is already in use` if a vite dev
  server is still alive from a previous run. Kill it, then retry.
- Wayland is untested and expected to fail (compositors do not expose global hotkeys to clients).
