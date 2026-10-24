# Productivity Window — Concept

> A tiny always-on-top AI chat window that gives the AI you already use safe access to your files and a few offline productivity tools. No API key, no local model.

Competition: iWISE Regional Final (Software / Programming)
Timeline: 7 days
Stack: Tauri (Rust for the native shell, TypeScript for everything the user sees) + one Python sidecar

> **Build status: 2026-10-21.** Tiers 1, 2 and 3 are implemented and verified on this machine.
> Where the implementation diverged from this document, the document has been corrected in place
> and the reasoning is recorded in `spike-notes.md`. The three corrections worth knowing about:
> the Rust side is no longer "template only" (§6), there is deliberately no `Origin` check (§7),
> and the token saving comes from page selection and editing rather than from Markdown being
> smaller than raw text (§8).
>
> **Scope reduced 2026-10-24.** Three things in this document are no longer true of the shipped app:
> the chat-input injection (§4 Tier 2, §10), the app launcher (§4 Tier 1), and the "offline
> productivity tools" framing (§2). Injection and the launcher were removed; the offline claim was
> narrowed to "processing happens locally". See `PROGRESS.md`, Day 5, for the reasoning. This
> document is kept as the design record and is not retro-edited.

---

## 1. Problem

People who use AI chat for work and study repeat the same chores all day:

- Copy-pasting text out of PDFs, Word files and slides into the chat, with messy formatting that wastes tokens and free-tier limits.
- Switching between the browser tab, a timer, notes and other apps.
- The AI cannot see their files, so every question needs manual context.
- Real AI agents normally need paid API keys or powerful hardware, which many students and budget users do not have.

## 2. Solution

**Productivity Window** is a small floating desktop window (always on top, summoned by a global hotkey) that embeds an AI web chat the user already has, and adds:

1. **Document-to-Markdown prompt prep** — drop a file, get clean Markdown, preview it, see the token savings, send it to the chat in one click.
2. **A safe "hands" layer (MCP)** — the AI can read allowed folders and convert documents through a local MCP server the user controls.
3. **Offline productivity tools** — Pomodoro timer, app/shortcut launcher, quick notes. They work with no internet and no AI.

**Core claim (worded carefully):** it reuses the AI account or free tier you already have. It does not make AI free, and it does not work with every chatbot (see section 5).

## 3. Target users

Primary: students and budget-conscious workers who use free-tier AI chat daily and lose time and tokens on copy-paste and context switching.

Secondary: people in regions where API costs or high-end hardware are out of reach.

## 4. Feature tiers

Build in this order. Each tier is a complete project on its own.

### Tier 1 — Guaranteed core (days 1-3)
- Always-on-top floating window loading the AI chat site
- Global hotkey to show/hide
- Pomodoro timer with notifications
- App/shortcut launcher
- Quick notes / to-do (local storage)

### Tier 2 — Manual document bridge (days 2-4)
- Drag-and-drop file (PDF, DOCX, PPTX, XLSX, CSV, HTML)
- Convert to Markdown with Microsoft MarkItDown
- Preview and edit the Markdown before sending
- Token count before vs after conversion
- Select pages/sections, merge several files into one prompt
- Inject the result into the chat input box
- Saved prompt templates

### Tier 3 — AI "hands" via MCP (spike on day 1-2, build days 4-6 only if it works)
- Local MCP server with 3-4 tools, for example:
  - `list_files(folder)` inside an allowed folder
  - `read_document_as_markdown(path)` (wraps MarkItDown)
  - `search_notes(query)`
  - `create_note(title, text)` (requires confirmation)
- Folder allowlist, confirmation prompts, append-only audit log (section 7)

**Build status (2026-10-21).** All of Tier 1 and Tier 2 is built and verified, including saved
prompt templates. Tier 3 is built: all four tools above, the allowlist, the native confirmation
prompt and the append-only audit log, with an audit viewer in the window.

## 5. How the chat reaches the tools

**Decision (2026-10-21): tunnel + remote MCP only.** The script-injection route was considered and dropped — there is no fallback to it. If the tunnel spike fails on a free account, Tier 3 is cut and the project ships Tier 1 + Tier 2.

### The bridge

```
AI chat (cloud) --HTTPS--> tunnel --> localhost MCP server (TS) --> tools
```

- The chat service connects to a public HTTPS URL, which a tunnel (cloudflared or ngrok, bundled as a sidecar) forwards to the local server.
- The MCP server must use Streamable HTTP, not only stdio.
- The user adds the URL once as a custom connector in the chat site's settings, and our app shows a copy button and a short guide.
- Verified in research (Oct 2026): Claude allows custom connectors on the Free plan, limited to one connector. Mistral Le Chat supports custom MCP connectors on Free. ChatGPT custom MCP (developer mode) is not available on Free, so **ChatGPT is out of scope** for this project. Re-check these before the final, since plan rules change.
- Risks: random tunnel URLs change on restart (look for a stable domain option); a public URL to a file-capable server **must** be authenticated; connector setup is a one-time manual step.

### Rejected: script injection

Considered and dropped on 2026-10-21. Kept here because the reasoning is part of the pitch.

- It is **not MCP**. The abstract and the security story are built on the protocol; a custom JSON convention would make both inaccurate.
- It needs a full extra model turn per tool call — the model writes a block, then re-reads the result and answers again.
- It depends on the model reliably emitting the format, which it will not always do in long conversations.
- It breaks on any DOM change in the host page: silent, unpredictable failure, worst possible during a demo.
- It runs our code inside an untrusted page and gives that page a channel into the local bridge, which weakens the zero-permission claim in section 7.

Tier 2 still injects converted Markdown into the chat input box, which uses the same page-script technique. That work is separate from tool access and stays.

## 6. Architecture

```
┌────────────────────────── Tauri app ───────────────────────────┐
│  Main UI window (TS)        Chat window (untrusted web page)   │
│  - settings, permissions    - loads chat site                  │
│  - confirm dialogs          - ZERO Tauri permissions           │
│  - audit log viewer         - optional injected helper script  │
│  - notes, timer, launcher                                      │
└───────────────┬────────────────────────────────────────────────┘
                │ stdio / local authenticated socket
        ┌───────▼────────┐        ┌──────────────────┐
        │ TS MCP server  │───────▶│ MarkItDown (py)  │
        │ (sidecar)      │        │ sidecar / CLI    │
        │ permission +   │        └──────────────────┘
        │ audit layer    │
        └───────┬────────┘
                │
        ┌───────▼────────┐
        │ tunnel sidecar │───▶ public HTTPS URL ───▶ AI chat service
        └────────────────┘
```

- **Tauri's Rust side is no longer template-only** (corrected 2026-10-21). The original plan was that
  every line we wrote would be TypeScript. Two things could not be done from the frontend:
  spawning the Python converter, and writing into the chat window's DOM. Both are now small Rust
  commands (`convert_document`, `inject_into_chat`), and the frontend is still TypeScript for
  everything the user touches. The alternative — a Tauri shell plugin with wide `execute`
  permissions — would have handed the frontend a general "run any process" capability, which is
  worse for the security story in §7 than a handful of narrow commands.
- The chat window is its own window, not an iframe, because many sites block embedding.
- Python is used only for MarkItDown. Package it as a sidecar executable (PyInstaller) if time allows. Otherwise require `pip install markitdown` and say so honestly.
- Fallback if Python packaging fails: JS libraries (mammoth for DOCX, pdfjs-dist for PDF, SheetJS for XLSX), with slightly lower quality.
- The app talks to the MCP server over **files in `~/.pip/`**, not over a socket. The server drops a
  request in `pending/` and waits for the app's answer in `decisions/`. This keeps the bearer token
  inside the server — the app never sees it — and means the app needs no HTTP client of its own.

## 7. Security model (our headline feature)

Giving an AI "hands" is risky, so the safety layer is the part to show off.

1. **Chat window gets no Tauri permissions.** Only our own UI windows may call commands or plugins (Tauri capabilities config).
2. **Permission checks live in the process that does the work.** Resolve every path with `fs.realpath`, then check it is inside an allowed folder using `path.relative`, to block `../` tricks and symlinks.
   **The user grants folders one at a time, in the Pip window, and nothing is shared by default**
   (corrected 2026-10-22). The list lives in `~/.pip/allowlist.json`, which the server re-reads on
   every tool call, so a grant or a revocation applies immediately without restarting anything. The
   only folder that is always shared is `~/.pip/notes`, because the AI writes notes there. The
   previous default — `~/Documents` and `~/Desktop` — was removed: it let the AI read a whole
   personal folder that the user had never chosen, which is exactly what this section promises not
   to happen.
3. **Confirm prompts are shown in our native UI**, never in the web page. The MCP server writes the
   pending request to `~/.pip/pending/` and waits; the Pip window polls that folder, shows a native
   macOS dialog, and writes the answer to `~/.pip/decisions/`. If the window is closed, or nobody
   answers within the timeout, the request is **denied** — failing closed is the only safe default.
4. **Authentication always on.** Bind to 127.0.0.1 and require a token, compared with
   `timingSafeEqual`. The token is presented as `Authorization: Bearer <token>` or `?token=<token>`,
   because connector UIs differ. **There is deliberately no `Origin` check** (corrected 2026-10-21):
   the tunneled client is a backend, not a browser, so it sends no `Origin` header to validate — and
   a check that only ever sees one value would be theatre. The token is the control; without it the
   endpoint answers 401 from anywhere in the world.
5. **Restrict MarkItDown inputs.** Allow only local file paths inside the allowlist. Block `http(s):`,
   `data:` and `file:` URIs so the AI cannot be steered to internal network URLs. The converter calls
   MarkItDown's `convert_local()`, never `convert()` or `convert_url()`, so a URI cannot be fetched
   even if a check were missed.
6. **Cap output size.** Return a token estimate first, then paged or truncated content with a clear "truncated" note.
7. **Treat document text as untrusted** (prompt injection). Wrap returned text in clear delimiters. Destructive tools always need confirmation.
8. **Append-only audit log** of every tool call, its arguments, and whether the user approved it. The
   log is only ever opened in append mode, and the Pip window has a viewer for it.

**Paths are resolved before they are checked.** Every candidate path goes through `fs.realpath` first,
and only then is tested against the allowed folders with `path.relative`. Resolving first is what
makes symlinks safe: a link that points out of the allowlist resolves to its target and is refused,
rather than being allowed because its own location looked fine. This is covered by tests.

## 8. Differentiation

A floating chat window alone is not new. What is ours:

- Local document-to-Markdown with a **measurable token readout** and prompt preview/edit.
- A **permissioned, audited** local tool layer that works with the user's existing free-tier chat.
- Offline tools bundled in the same small window.
- A deliberate, documented choice of connection route (tunnel + MCP), with the rejected alternative explained rather than hidden.

> **Correction (2026-10-21): the token saving is not where the original pitch said it was.** The
> first draft of this document promised that converting a document to Markdown would *save* tokens.
> Measured on the four real samples, it does not: MarkItDown's output is within a few percent of the
> raw text, and is usually slightly **larger**, because the Markdown syntax costs more characters
> than the whitespace it removes. The honest version of the claim is:
>
> - Markdown is about the same size as the raw text but **structured**, which is what the model
>   actually needs — and PDF tables are broken in raw text, so the clean Markdown is the only
>   usable form.
> - The real saving comes from **page selection and editing**: sending pages 2–3 of a 6-page
>   worksheet instead of the whole file measured **2,067 tokens → 680 tokens, a 67% cut**. The
>   counter's job is to let the user see that number *before* they send.
>
> The app therefore shows three figures — what pasting by hand would cost, what the clean Markdown
> costs, and what you are actually sending — and states the saving only when there is one.

## 9. Evidence plan (day 5)

Pilot with 10-20 classmates:

- Before: survey how often they copy-paste documents into AI chat and how long it takes.
- After: time the same task using Productivity Window.
- Record: time saved, tokens saved (from the counter), and one-line feedback.

Present real numbers, even small ones, rather than claims.

## 10. Demo flow

1. Press the hotkey; the small window appears over another app. Ask a quick question.
2. Drag a messy PDF in. Show the Markdown preview and "X tokens saved." Send it to the chat.
3. (If Tier 3 works) Ask the AI to summarize a notes folder. Show the permission prompt and the audit log entry.
4. Show Pomodoro, launcher and notes working with Wi-Fi off.
5. Show the pilot results slide.

Record a **backup demo video** in case the chat site or internet misbehaves on the day.

## 11. Seven-day schedule

| Day | Goal |
|---|---|
| 1 | Install Rust + Tauri, floating window, hotkey. **Test chat login inside the webview.** Quick MarkItDown test on 3-4 real files (include a scanned PDF). Start tunnel spike: minimal TS MCP server with a `ping` tool exposed through a tunnel, added as a custom connector on a free Claude account. |
| 2 | Confirm the tunnel spike works on a free account. If it does not, cut Tier 3 and say so. Pomodoro timer. Drag-and-drop to Markdown. |
| 3 | Launcher + notes. Markdown preview and inject into chat input. |
| 4 | Token counter, merge files, MarkItDown packaging attempt. Start permission layer if Tier 3 is a go. |
| 5 | Tier 3 tools + audit log (if go). Pilot with classmates. |
| 6 | Bug fixes, slides, demo script, backup video. |
| 7 | Buffer. No new features. |

## 12. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Chat site blocks login in embedded webview | Try email login or another service; test on day 1 |
| Tunnel/connector fails on free plan | Cut Tier 3. Ship Tier 1 + Tier 2, which is already a complete project |
| Python packaging too heavy | Require pip install for the demo, or JS converters |
| Scanned PDFs return no text | State the limit honestly; OCR only if time allows |
| Terms of service concerns | Position as an integration layer, read each service's policy, say so in the pitch |
| Always-on-top misbehaves over fullscreen apps | Test on the demo machine early |
| Running out of time | Tier 1 + Tier 2 is already a complete project |

## 13. Pitch (draft)

> Students and workers paste messy documents into AI chat and waste time and free-tier limits on formatting noise, while the AI still cannot see their files. Productivity Window is a small floating assistant that converts documents to clean Markdown locally, shows exactly what the prompt will cost before you send it — so you can trim to the pages you actually need instead of the whole file — and, with a permissioned and audited tool layer, lets the AI you already use work with your files safely. No API key, no local model, and offline tools included.

## 14. Credits and licensing notes

- Document conversion uses Microsoft's MarkItDown. Credit it clearly and check its current license.
- Our own contribution: the UI, batching and merging, token estimator, prompt tooling, the permission and audit layer, and the connection bridge.

## 15. Open questions

- Which free account to test first: Claude or Le Chat?
- Demo on our own laptop only, or installable by others (decides Python bundling)?
- Does the competition publish specific judging criteria or themes?
- ~~Stable tunnel URL option available for free?~~ **Answered (2026-10-21):** yes. The ngrok free plan
  includes one assigned dev domain (`<name>.ngrok-free.app`) that stays the same across restarts, so
  the connector URL is stable and only has to be added once. cloudflared quick tunnels give a random
  hostname per run and are only good for throwaway tests. ngrok free limits: 1 GB/month, 20k
  requests, 3 online endpoints — ample. The browser interstitial does not apply to programmatic
  clients; if it ever does, send `ngrok-skip-browser-warning`.
