# Day 1-2 Spike Notes

Goal: decide how the AI chat reaches our local tools.

> The spike is done and so is the build. This file is the running record: the original checklist,
> then what was found while building it, then the corrections to the original claims. The
> corrections matter more than the checklist — read the sections at the bottom before quoting any
> number from the top.
>
> **Superseded in one place (2026-10-24):** everything below about `bridge/inject.js` and
> `inject_into_chat` describes code that has since been removed. The notes are kept because they
> record how the page script was tested and why it looked safe; they are not a description of the
> current app. See `PROGRESS.md`, Day 5.

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
- [x] Tunnel exposes it over HTTPS — ngrok first, then cloudflared. `/health` answers through the
      tunnel, and an unauthenticated `POST /mcp` is refused with 401 from the internet, so the
      endpoint is both reachable and closed. Re-verified end to end through a live cloudflared
      tunnel with the final build: health ok, 401 without a token, all five tools listed,
      conversion works, `/etc/passwd` refused.
      - **ngrok has no authtoken on this machine**, so the stable-hostname path is installed but
        unexercised. cloudflared is the path that was actually verified.
- [x] Added as custom connector on a **FREE** Claude account, and the chat can call the tool —
      Claude called `reveal_secret` through the tunnel and got the phrase back. The whole chain
      works: cloud client → tunnel → local MCP server → tool.
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
- Bearer token: `PIP_MCP_TOKEN` if set (minimum 16 characters), otherwise one is generated on first run and saved to `~/.pip/token` (0600), so it survives restarts. (An empty value used to authorise every request; see the 2026-10-22 entry.) No Origin check: the tunneled client is a backend, not a browser, so there is no Origin header to validate — the token is the control.
- **Two ways to present the token**, because connector UIs differ: `Authorization: Bearer <token>` header, or `?token=<token>` on the `/mcp` URL. Compared with `timingSafeEqual`. The model is never told the token — the MCP client attaches it, which is a connector setting, not a prompt.
- `GET /health` returns `ok`, so a tunnel can be checked without speaking MCP.

Verified locally with curl: `initialize` returns the server info, `tools/list` returns `reveal_secret`, `tools/call` returns the phrase, and 401 for a wrong token, a missing token, or no credentials at all — both header and query forms return the secret. Unknown path gets 404.

Next: tunnel it and add it as a connector. **The connector needs the token, so the URL alone is not enough** — either paste the `?token=` URL, or set the header if the dialog allows it. Missing credentials show up as a 401 that looks like a tunnel failure.

### 2026-10-21 — tunnel choice

Both binaries are already installed: `cloudflared 2026.10.0`, `ngrok 3.39.1`.

**Use ngrok.** The free plan assigns one dev domain (`<name>.ngrok-free.app`) that is tied to the
account and stable across restarts, so the connector URL is composed once and never changes:

```
https://<assigned-name>.ngrok-free.app/mcp?token=<token>
```

cloudflared quick tunnels (`cloudflared tunnel --url http://127.0.0.1:8787`) hand out a random
hostname every run, which means re-adding the connector every run. Fine for a five-minute test,
wrong for a demo. A named cloudflared tunnel is stable too, but needs a domain on Cloudflare.

Free-plan limits are not a constraint here: 1 GB/month, 20k requests, 3 online endpoints, and free
endpoints have no idle timeout. The browser interstitial does not apply to API clients; if a
request ever gets it, send `ngrok-skip-browser-warning` with any value.

One-time setup: `ngrok config add-authtoken <token>`.

### 2026-10-21 — tunnel + connector verified (the spike is decided)

The full chain works on a **free** Claude account:

```
Claude (cloud) --HTTPS--> ngrok --> 127.0.0.1:8787 (MCP server) --> reveal_secret
```

- Claude called `reveal_secret` and returned "The eagle lands at midnight."
- `/health` through the tunnel returns `ok`; an unauthenticated `POST /mcp` from the internet
  returns 401, so the endpoint is reachable but closed.
- Tunnel URL: `https://unbounded-passive-ahoy.ngrok-free.dev` — the account's stable dev domain.
- Connector URL is the tunnel host plus `/mcp?token=<PIP_MCP_TOKEN>`. The query-parameter form is
  what was used; no custom header was needed.

**Gotcha:** ngrok exits with `ERR_NGROK_9009` when `HTTP_PROXY`/`HTTPS_PROXY` are set in the
environment — the free plan does not allow an agent behind a proxy. Launch it with the proxy
variables stripped:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy ngrok http 8787
```

**Consequence for the project:** Tier 3 is viable. Option A (tunnel + MCP) was the whole risk, and
it is now proven end to end rather than assumed. The remaining Tier 3 work is the real tool set
(`list_files`, `read_document_as_markdown`, …) behind the permission and audit layer, not the
transport.

---

### 2026-10-21 — toolchain brought up from nothing

The machine had **none** of the toolchain the earlier notes assumed. Installed in this order, all
from scratch, no Homebrew:

| Tool | Version | How |
|---|---|---|
| Rust | 1.99.1 | `rustup` (stable, minimal profile) |
| Python | 3.13.16 | `uv python install 3.13` — the system Python was 3.9.6, below MarkItDown's floor of 3.10 |
| uv | 0.13.4 | astral.sh install script |
| ngrok | 3.39.11 | binary dropped into `sidecars/tunnel/` |
| cloudflared | 2026.10.2 | binary dropped into `sidecars/tunnel/` |

The MarkItDown environment lives at `sidecars/markitdown/.venv` and is built with `uv`, so the
machine's system Python is never touched. `setup.sh` does all of the above and is safe to re-run.

**Note the earlier environment claims were wrong for this machine** — `docs/spike-notes.md` said
cloudflared 2026.10.0, ngrok 3.39.1, CPython 3.14.3 and uv were already present. They were not.
Everything below is what was actually measured *after* the reinstall.

**`Activity_1.pdf` is not slow.** The 22.2 s recorded earlier was a **cold start** — the first run
downloads and warms the `magika`/`onnxruntime` model. Warm, the same file takes **0.9 s**. The
conversion time is not a problem and the UI does not need a progress bar for it; the 180 s timeout
in the Rust command is generous headroom rather than a real requirement.

### 2026-10-21 — the token-saving claim needed correcting

The original promise was "convert to Markdown and save tokens". Measured properly, that is not what
happens. `convert.py` now returns **both** the clean Markdown and the raw text of the same document
(what you would get copy-pasting it by hand), so the two can be compared directly:

| File | Raw text | Clean Markdown | Verdict |
|---|---|---|---|
| `Activity_1.docx` | 552 tok | 577 tok | Markdown is 4% **larger** |
| `Activity_1.pdf` | 571 tok | 652 tok | Markdown is 14% **larger** |
| `Assignment_1…Buoyancy….pdf` | 1,844 tok | 2,067 tok | Markdown is 12% **larger** |
| `Essay_Kartun_Sensus_Penduduk.pdf` | 1,496 tok | 1,498 tok | A wash |

The whitespace-normalisation saving claimed earlier (3–5%) **does not show up on these samples** —
`pdfplumber` and `mammoth` already collapse runs of spaces, so there is nothing left to collapse.
The normalisation is kept because it costs nothing and does help genuinely justified text, but it is
not the headline.

**Where the saving actually is: page selection.** Selecting pages of a PDF writes just those pages
to a temporary PDF (`pypdf`) and converts that, so the token count drops with the page count:

```
Assignment_1…Buoyancy….pdf, all 6 pages   2,067 tokens
Assignment_1…Buoyancy….pdf, pages 2-3        680 tokens   -> 67% less
```

That is a real, measurable, user-driven saving, and it is the number the app leads with. The UI
therefore shows three figures — *paste by hand*, *clean Markdown*, *you send* — and only claims a
saving when there is one. When there is not, it says the Markdown is about the same size as the raw
text but structured, which is what the model actually needs (and PDF tables are unusable in raw
form). See the correction in `CONCEPT.md` §8.

### 2026-10-21 — Tier 3 tool layer, built and tested

`mcp-server/` grew from one file with one tool to six files and five tools:

| Tool | What it does | Needs approval |
|---|---|---|
| `list_files(folder)` | lists an allowed folder | no |
| `read_document_as_markdown(path, pages)` | converts a document, optionally page-selected | no |
| `search_notes(query, folder)` | greps text notes for a phrase | no |
| `create_note(title, text)` | writes a note | **yes** |
| `reveal_secret` | the original spike tool | no |

**Permission layer.** `permissions.ts` resolves the candidate path with `fs.realpath` **first**, then
tests it against the allowed folders with `path.relative`. Resolving first is the whole point: a
symlink inside an allowed folder that points at `/etc` resolves to `/etc` and is refused, instead of
being allowed because its own location looked innocent. URI schemes (`http:`, `https:`, `data:`,
`file:`, `ftp:`) are rejected outright. Default allowlist is `~/.pip/notes`, `~/Documents` and
`~/Desktop`; `PIP_ALLOWED_FOLDERS` overrides it.

**Confirmation.** The server writes `~/.pip/pending/<id>.json` and waits for
`~/.pip/decisions/<id>.json`. The Pip window polls the pending folder every 1.2 s, shows a native
macOS dialog, and writes the answer. **No answer means denied.** Files rather than a second HTTP
port, because that keeps the bearer token inside the server — the app never handles it — and means
the app needs no HTTP client of its own.

**Audit log.** `~/.pip/audit.log`, one JSON object per line, opened in append mode only. Records the
tool, its arguments, whether it was allowed, and whether the user approved. The window has a viewer
for it on the Log tab.

**Tests.** `mcp-server/test-tools.sh` covers the whole layer: tool listing, the allowlist, symlink
and `../` traversal refusals, URI refusals, document conversion, page selection, notes search, both
the approve and the decline path of a confirmation, the audit log, and the auth rules (401 without a
token, 404 on an unknown path). **All pass.**

### 2026-10-21 — the Tauri app, built and tested

Seven Rust unit tests (`cargo test` in `app/src-tauri/`) cover the sidecar discovery, the converter,
the page-selection token cut, the missing-file error, the approval file round trip, and the URL rule
that keeps the chat window to `http(s)` only. **All pass.** The frontend type-checks with `tsc` and
builds with `vite build`.

Two Rust commands exist because two things cannot be done from TypeScript, and both are narrow:

- `convert_document(path, pages)` — spawns the Python sidecar on a worker thread, with a 180 s
  timeout and a hard kill. The path allowlist for the app is *not* the MCP server's: the user
  dropped the file, so the user chose it.
- `inject_into_chat(text)` — evaluates `bridge/inject.js` into the chat webview. The chat window has
  no Tauri permissions by design, so there is no IPC bridge to use; evaluating the script directly
  is the only channel it has, and the only thing the script does is write text into the message box.
  `bridge/inject.js` is embedded in the binary with `include_str!`, so the shipped app carries it.

`bridge/inject.js` handles both kinds of input: a `textarea` (Le Chat) gets the native value setter
plus an `input` event, because React swallows a plain `element.value = text`; a ProseMirror
`contenteditable` (Claude) gets `document.execCommand('insertText')`, which is the only thing that
produces the `beforeinput`/`input` pair those editors listen for. It shows a small toast in the page
confirming the insert.

**The confirmation dialog is a real macOS alert**, via `tauri-plugin-dialog`, not a div in the app —
so it appears even when the Pip window is hidden.

### 2026-10-21 — gotchas worth remembering

- **TypeScript 7 needs `"types": ["node"]`** in `tsconfig.json`. Without it, every `node:fs` import
  fails to resolve and `process.env` is `any`. The `mcp-server` tsconfig had to change.
- **A `Buffer` is not a valid `Request` body** under the TS 7 DOM types — `Buffer` can be backed by
  a `SharedArrayBuffer`. Copy it: `new Uint8Array(raw)`.
- **`tauri-plugin-dialog` v2's `confirm()` has no `detail` field.** The arguments have to be
  appended to the message.
- **`cargo test` in a Tauri crate works** for anything that does not touch `tauri::generate_context!`.
  The crate has to be a lib target for the tests to be picked up; it already was.
- The `test-tools.sh` suite and the Rust tests both need the venv to exist. `setup.sh` builds it.

### 2026-10-21 — closing the gaps, and one bug found by reading the code

**Prompt templates (the last item in Tier 2) are built.** Six built-in ones — summarise, study
notes, explain simply, key ideas, quiz me, exam questions — plus the user can save their own,
stored in local storage next to the Pomodoro settings. The instruction is kept **separate from the
document body**, so the two stay independently editable, and it sits above the document in the
outgoing prompt.

**The bridge got its own test file.** `bridge/inject.js` is the only part of Pip that runs inside a
third-party page, and it cannot be exercised through the GUI here. So it was tested on its own
against a small DOM stub (`bridge/test-inject.js`, 9 assertions): finding the textarea, the native
prototype setter that React requires, the `input`/`change` pair, the ProseMirror `insertText` path,
the fallback when `execCommand` is refused, and the failure case when there is no message box.

Writing that test found the one thing worth finding: **the first two stubs were wrong, and the
bridge was right.** A stub that sets `this._value` does not match a real textarea, where the
prototype setter assigns the element's own `value`. Worth remembering when a test fails — check
whether the test is wrong before you change the code.

**A real bug, found by reading rather than by running.** Drag-and-drop was handled inside the
Documents tab, which is only mounted while that tab is showing. **Drop a file while you are on the
Timer tab and nothing would happen** — the handler was not registered. The drop handler now lives
in `App`, which is always mounted, and hands the paths down. The same pass found a missing
`dialog:allow-confirm` permission: **`dialog:default` does not include it.** The plugin's default
set is `allow-message`, `allow-save`, `allow-open` and nothing else, so every native confirmation
dialog would have failed at runtime with a permission error that looks like nothing happening.

**One test script, one command.** `./test.sh` runs everything: the Rust tests, the frontend
type-check and production build, the bridge tests, the MCP type-check and the 27-assertion tool
suite. The MCP tests start **their own server on their own port (8788) with their own state
folder**, so they never collide with a server you are already running and never write into your
real notes or audit log. The first version of this did collide — the tests were talking to the
already-running server, which had a different token, and every assertion failed. A test suite that
shares state with production is a test suite that only works if nothing else is running.

### Still open

- **A genuinely scanned PDF.** All three PDFs here have real text layers. The OCR case remains
  untested — §12 already promises to state that limit honestly.
- **A PPTX sample.** `tests/samples/` still has no slides file, so the PPTX path is exercised only by
  the extractor code, not by a real file.
- **Le Chat connector.** The tunnel + connector chain was verified on Claude only.
- **ngrok has no authtoken on this machine**, so the stable-hostname path is installed but
  unexercised. cloudflared is the path that was actually verified, end to end, from outside.
- **Packaging MarkItDown as a PyInstaller sidecar** — not attempted. The app currently requires the
  `uv` venv to exist, which `setup.sh` creates.
- **The screen cannot be captured on this machine**, so the UI was verified by building it, type-
  checking it and driving the code paths underneath it — never by looking at it. The layout and
  styling have not been seen by anyone.
