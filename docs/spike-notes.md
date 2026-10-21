# Day 1-2 Spike Notes

Goal: decide how the AI chat reaches our local tools.

## Checklist

State as of 2026-10-21. `[x]` = verified on this machine, `[ ]` = not done or only partly done.

- [x] Tauri window opens, always-on-top works on my OS — macOS, both the Pip window and the chat window
- [x] Can I log in to the chat site inside the Tauri webview? (try email login if Google blocks it)
  - **Yes, with email + password.** That is the supported path.
  - Google sign-in is blocked by Google policy inside embedded windows — not a bug, not fixable
    by retrying or upgrading. See findings below.
  - Product consequence: the app must tell users to use email, because the failure is silent and
    looks like a broken app.
- [ ] MarkItDown tested on: textbook PDF / PPTX / DOCX / scanned PDF
  - PDF — done (3 files: 2-page image-heavy, 6-page worksheet, 2-page essay)
  - DOCX — done
  - PPTX — **not tested**, no sample yet
  - scanned PDF — **not tested**, all three PDFs have real text layers
- [x] Minimal MCP server over Streamable HTTP — `POST /mcp` on 127.0.0.1:8787, one tool
      `reveal_secret`. Verified with curl: `initialize`, `tools/list`, `tools/call` all answer, and
      a wrong bearer token gets 401. `GET /health` returns `ok` for tunnel checks.
- [ ] Tunnel exposes it over HTTPS
- [ ] Added as custom connector on a FREE Claude account, and the chat can call the tool
- [ ] Same test on Le Chat (Mistral) free

## Decision

**Decided 2026-10-21: tunnel + remote MCP.** Script injection is rejected and will not be built.

- [x] Option A (tunnel + MCP) — **chosen**. Build this.
- [ ] Option B (script injection) — rejected. See `CONCEPT.md` §5 for the reasoning.
- [ ] Tier 1 + Tier 2 only — the fallback *only* if the tunnel spike fails on a free account.

Nothing above the line can be ticked until `ping` is reachable from a free account. If it is not,
the project ships Tier 1 + Tier 2 and the pitch drops the MCP claim.

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

### 2026-10-21 — chat login test (macOS)

- **Google sign-in fails inside the Tauri webview.** Expected, not a bug: Google's OAuth policy
  rejects embedded user agents ("This browser or app may not be secure"), and it has been that way
  for years. It will not be fixed by retrying or by a Tauri upgrade.
- Options, in order of cost:
  1. **Email + password login** on the chat site. Works in a webview. Zero code. **← chosen**
  2. **Use a provider that allows it** — Le Chat (Mistral) or ChatGPT, neither of which gates on
     Google's embedded-browser rule.
  3. **System-browser OAuth** — open the login in the user's real browser, then hand the session
     back. Real work (custom protocol handler + cookie/token transfer), not a day-1 item.
- Do **not** spoof the user agent to get around it. It breaks Google's terms and fails unpredictably.
- Always-on-top confirmed working on macOS for both the Pip window and the chat window.

### 2026-10-21 — MarkItDown on four real files (markitdown 0.1.8, Python 3.13.12)

Samples are in `tests/samples/`. Command: `convert.py <file> > out.md`.

| File | Pages | Size | MD chars | ~tokens (chars/4) | Time |
|---|---|---|---|---|---|
| `Activity_1.docx` | — | 17 KB | 2,316 | 579 | 1.8 s |
| `Activity_1.pdf` | 2 | 501 KB | 2,923 | 730 | **22.2 s** |
| `Assignment_1…Buoyancy….pdf` | 6 | 206 KB | 8,025 | 2,006 | 2.3 s |
| `Essay_Kartun_Sensus_Penduduk.pdf` | 2 | 6.4 KB | 6,298 | 1,574 | 1.9 s |

All four exited 0. Text fidelity is good — prose comes out clean and readable.

**Problems found, in order of how much they hurt:**

1. **`Activity_1.pdf` takes 22 seconds for 2 pages.** It is image-heavy (501 KB, only 2,317 chars of text layer). Conversion time is not proportional to page count or text volume, so the UI cannot predict it. Needs a progress state and a cancel path, not a spinner that might be a hang.
2. **PDF tables come out broken.** In `Activity_1.pdf` the header row splits across lines (`Al 8000-series alloy (Al + about` / `0.4–1% Fe)`) and cells land in the wrong columns. This is a PDF table-extraction limit, not a bug we can fix by upgrading. It makes the Tier 2 **preview and edit** step load-bearing rather than optional — the user has to be able to repair the Markdown before sending it.
3. **Justified text produces double spaces.** The essay has 325 runs of 2+ spaces, an artefact of justification. Pure token waste. A whitespace-normalisation pass in `convert.py` is a cheap win — probably 3–5% of tokens on prose documents.
4. **DOCX headings are lost.** `Activity_1.docx` uses only the `ListParagraph` style with manual bold; it has no `Heading 1..5` applied, even though those styles exist in the file. mammoth is correct to emit `**bold**`. GIGO — the converter can only preserve structure the document actually has. Worth saying in the pitch: structure in, structure out.
5. **Maths breaks.** Subscripts in the physics worksheet split onto their own lines (`Fᵦ = ρ V g (ρ.g.V)` / `fluid. displaced.`). Expect to hand-fix formulas.

**Still missing from the checklist: a genuinely scanned PDF.** All three PDFs here have real text layers (2,317 / 7,008 / 6,029 chars). The scanned case — where MarkItDown returns nothing and OCR would be required — remains untested. Get one before the final; §12 already promises to state that limit honestly.

**Dependency footprint (matters for day 4 packaging):**

| Install | Packages | Size |
|---|---|---|
| `markitdown[all]` | 53 | 366 MB |
| `markitdown[pdf,docx,pptx,xlsx]` | 37 | 310 MB |

Dropping `[all]` saves only 56 MB, because `magika` (file-type detection) is a **core** dependency and pulls `onnxruntime` (80 MB), and the `xlsx` extra pulls `pandas` (70 MB). A PyInstaller sidecar will therefore be large no matter what. Decide on day 4 between: bundle it and accept ~300 MB, or ship `pip install markitdown` and say so honestly (the concept already allows this).

`requirements.txt` now pins `markitdown[pdf,docx,pptx,xlsx]` instead of `[all]` — audio transcription, YouTube, Outlook and the Azure readers are not in scope. Verified: the narrowed set produces **byte-identical** output on all four samples. Env is built with `uv` (see below), CPython 3.14.3, 241 MB on disk.

### 2026-10-21 — MCP server rewritten against the v2 SDK

The first attempt did not start: it imported `SSEServerTransport` from `@modelcontextprotocol/server`, which has no `./sse` export. Two SDK generations were installed at once (`sdk@1.32.1` and `server@2.3.1`), which is what made the import look plausible. v2 removed SSE entirely.

Rewritten from zero, ~120 lines, one file:

- `@modelcontextprotocol/server@2.3.1` only; the v1 `sdk` package was removed (94 packages pruned).
- `createMcpHandler(() => buildServer())` + a small `node:http` adapter that converts the request to a web `Request` and the reply back. No express, no extra dependencies.
- Streamable HTTP at `POST /mcp`. Bound to `127.0.0.1`, port 8787.
- Bearer token required, from `PIP_MCP_TOKEN` or generated on boot and printed. No Origin check: the tunneled client is a backend, not a browser, so there is no Origin header to validate — the token is the control.
- `GET /health` returns `ok`, so a tunnel can be checked without speaking MCP.

Verified locally with curl: `initialize` returns the server info, `tools/list` returns `reveal_secret`, `tools/call` returns the phrase, a wrong token gets 401, no token gets 401, an unknown path gets 404.

Next: tunnel it and add it as a connector. Note that the connector needs the `Authorization` header, so the tunnel URL alone is not enough.
