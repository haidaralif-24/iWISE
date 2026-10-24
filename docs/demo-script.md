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
copy, not after."

Pick a prompt template from the dropdown, edit the text if you want, then hit **Copy prompt** and
paste it into the chat. Say why it is a paste: *"We removed the automatic paste. It depended on the
chat site's own markup, and we could not test it without a live account — one manual paste is worth
not having it break in front of a judge."*

## 3. The tools and the permission prompt (60 s)

In the chat, ask: *List the files in my notes folder and write a note called "buoyancy summary"
summarising what you find.*

- The MCP server answers `list_files` straight away.
- `create_note` **stops** and a native macOS dialog asks for permission.
- Approve it. The note appears on disk.
- Switch to the **Log** tab: there is the call, its arguments, and the approval, in the audit log.

*Say:* "The AI can only touch folders we allow. It cannot write anything without asking, and
everything it does is written down. Open the log and you can see every call we made."

## 4. Local, not cloud (20 s)

Point at the window: the document pipeline, the timer and the notes all run on this machine, with no
server involved.

*Say:* "Conversion happens on this laptop. The only thing that leaves it is the text you choose to
paste into your own chat."

Do not turn off Wi-Fi for this. The chat tab is a live web page and Tier 3 needs the tunnel — cutting
the network mid-demo kills both. The claim is *where the processing happens*, not *works without
internet*, and it is safer to say the smaller true thing.

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
| "It converts to Markdown to save tokens" | "It converts to Markdown so the model gets structure, and the counter lets you trim before copying" |
| "The AI can read your files" | "The AI can read files in folders you allow, and only after you approve anything it writes" |
| "Works with scanned PDFs" | "Scanned PDFs are not tested yet — that is the next thing to build" |
| "It works offline" | "Conversion runs on this laptop; the only thing that leaves it is what you paste" |
| "It sends the prompt into the chat for you" | "It prepares the prompt and copies it — the paste is still yours" |
