# Demo Script

Roughly four minutes. The point of the demo is that the *whole* chain works on this laptop, with
no API key and no account — so show it working, then show the audit log.

## 0. Before you start (30 seconds, not part of the demo)

```bash
./run.sh --tunnel
```

Wait for the tunnel URL, then paste it into the chat service's connector settings as
`https://<host>/mcp?token=<the token printed by run.sh>`. Do this before you walk up, so the
demo starts with the connector already live.

## 1. The window (30 s)

Press `Cmd+Shift+Space`. Pip appears over whatever you were doing. Ask one quick question in the
chat tab to show it is the real chat, not a mock-up.

*Say:* "Everyone pastes documents into chat by hand. This is the same chat, with a way to prepare
what you paste."

## 2. Drag and drop a document (90 s) — the main event

Drag `tests/samples/Assignment_1…Buoyancy….pdf` onto the Docs tab.

- It converts to Markdown locally, in about a second.
- The counter shows **three** numbers: what pasting by hand would cost, what the clean Markdown
  costs, and what you are actually sending.
- Pick pages **2–3** with the page selector. The "you send" number drops from **2,067 tokens to
  680**.

*Say the honest version:* "Converting to Markdown on its own does not save tokens — it is about the
same size as the raw text, and actually slightly larger. What saves tokens is choosing the two
pages that matter and editing out the rest. The counter is there so you can see that before you
send, not after."

Pick a prompt template from the dropdown, edit the text if you want, then hit **Send to chat**.

## 3. The tools and the permission prompt (60 s)

In the chat, ask: *List the files in my notes folder and write a note called "buoyancy summary"
summarising what you find.*

- The MCP server answers `list_files` straight away.
- `create_note` **stops** and a native macOS dialog asks for permission.
- Approve it. The note appears on disk.
- Switch to the **Log** tab: there is the call, its arguments, and the approval, in the audit log.

*Say:* "The AI can only touch folders we allow. It cannot write anything without asking, and
everything it does is written down. Open the log and you can see every call we made."

## 4. The offline part (30 s)

Turn off Wi-Fi.

- Pomodoro timer runs.
- The launcher opens apps.
- The notes tab keeps working.

*Say:* "None of that needs the internet. It is a local window, not a website."

## 5. Close (15 s)

Show the token counter one more time on the original 6-page PDF, so the last thing on screen is
the number.

*Say:* "No API key, no local model, no account. It is your chat, with the boring parts of your
workflow handled locally."

## Backup plan

- **Record a demo video before the event.** Screen recording permissions are not always available
  on the demo machine — check them the day before.
- If the tunnel does not come up, skip step 3's live call and show the **Log** tab, which still
  shows real calls from earlier. The permissions layer does not need the tunnel to be running.
- If the chat site will not load in the embedded window, use the Docs tab alone — the document
  conversion and the token counter are the part that is definitely working.

## Do not claim these on stage

| Do not say | Say instead |
|---|---|
| "It saves you 67% of your tokens" | "Selecting the two pages you need cuts this document from 2,067 tokens to 680" |
| "It converts to Markdown to save tokens" | "It converts to Markdown so the model gets structure, and the counter lets you trim before sending" |
| "The AI can read your files" | "The AI can read files in folders you allow, and only after you approve anything it writes" |
| "Works with scanned PDFs" | "It reads text, not images — a scan has no text, so it says so and stops" |

## What is actually verified, and how

| Claim | How it was checked |
|---|---|
| The interface renders and fits its window | `node app/ui-audit.mjs` — the real app, driven over the Chrome DevTools Protocol at 420×680, measured for clipped text, content outside the window, and controls too small to hit. Screenshots in `docs/screenshots/`. |
| The drag-and-drop works | The same harness fires a real drop event and the document arrives in the window. |
| The permission prompt appears with the right tool and arguments | The harness records the native dialog and the answer. It cannot picture the dialog, but the calls are checked. |
| PDF, DOCX, PPTX, XLSX, CSV, HTML, TXT and MD all convert | `sidecars/markitdown/test-convert.py` — 26 assertions, one per format, against real sample files. |
| A scanned file is reported as having no text | The same suite, against a real image-only PDF. |
| The page selector cuts the token count | The same suite: 2,067 tokens → 680 for pages 2–3 of the 6-page worksheet. |
| The bridge can find the message box | `bridge/test-inject.js` — 13 assertions against a DOM stub. **Not** proven against a real chat page; that still needs a login. |
| The MCP tools respect the allowlist | `mcp-server/test-tools.sh` — 27 assertions against a live server. |
| The tunnel works from outside | Verified end to end through a cloudflared tunnel. |
| The notification fires | **Not** verified — it needs a real desktop session. The code now says out loud when a notification could not be shown, instead of failing silently. |
