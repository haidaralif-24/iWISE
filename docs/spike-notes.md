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
- [ ] Minimal MCP server (one `ping` tool) over Streamable HTTP
- [ ] Tunnel exposes it over HTTPS
- [ ] Added as custom connector on a FREE Claude account, and the chat can call `ping`
- [ ] Same test on Le Chat (Mistral) free

## Decision

Nothing to decide yet — the decision depends on the last four items above. Do not tick one of these
until `ping` is reachable from a free account.

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
