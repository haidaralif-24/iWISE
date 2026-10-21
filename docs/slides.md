# Pip — iWISE Regional Final

<!--
  The deck. Written in Markdown so it can be edited in any editor and diffed
  in a pull request.

  Render it:

      node tools/slides-to-html.mjs

  then open docs/slides.html and press the arrow keys.

  Rules for this file, learned the hard way:
  - Every number in here has to be a number we measured. If it is a guess,
    say it is a guess.
  - The token slide says three numbers, never one. The single number is the
    claim we disproved.
  - There is a slide about what does not work. Keep it. It is the reason the
    rest of the deck is believable.
-->

---

# Pip

### A small always-on-top window that gives the AI you already use
### a safe way to see your documents

Notes:
Open with the hotkey. Do not explain the stack yet.

Say: "Everyone here pastes documents into an AI chat by hand. Pip is the same
chat, with a way to prepare what you paste — and a way to let the AI read a
few files you approve."

Five minutes. Four slides are about safety, because that is the part that
is actually hard.

---

## The problem

- You copy text out of PDFs, Word files and slides **by hand**
- The formatting comes out wrong — tables break, headings vanish
- The AI cannot see your files, so every question needs the context again
- Real AI agents need a paid API key or a local model

Notes:
Do not say "and it wastes your tokens". We measured that and it is not true.

The honest problem is time and attention, not tokens. The token claim is a
separate slide and it is more interesting.

---

## The idea

One small window, three additions to the chat you already use.

1. **Document to Markdown** — drop a file, get clean text, trim it, send it
2. **A safe "hands" layer** — the AI can read a few folders you allow
3. **Offline tools** — Pomodoro, launcher, notes

No API key. No local model. No account.

Notes:
"No account" is worth saying: it reuses whatever free tier or subscription
the student already has. That is the part that makes it reachable.

---

## Drop a file

- Drag it onto the window — it converts **locally**, on your machine
- PDF, DOCX, PPTX, XLSX, CSV, HTML, TXT, MD
- Read it, edit it, choose the pages
- One button sends it to the chat

Notes:
Demo this live if you can. The conversion takes about a second for a
6-page worksheet.

The PDF is a real 6-page worksheet — the kind a teacher actually hands out.

---

## Three numbers, not one

| | tokens |
|---|---|
| if you pasted it by hand | ~2,067 |
| the clean Markdown | ~2,140 |
| what you actually send, pages 2–3 | **~680** |

- Markdown is a few percent **larger** than the raw text — we measured it
- The saving is **choosing pages and editing**, not converting
- So the counter shows all three, and never claims a saving it cannot prove

Notes:
This is the slide that separates us from every other student claiming to
"save tokens". We tried the obvious claim. It was false. We measured it and
showed the measurement.

If a judge asks "so does it save tokens?" — the answer is: not by converting.
Yes, by trimming. Here is the number.

---

## Letting the AI read files

The AI asks Pip, Pip asks you.

```
Claude or Le Chat
      │  HTTPS, one bearer token
      ▼
  tunnel  ──▶  local MCP server  ──▶  your files
                    │
                    └──▶ you get a native "allow this?" prompt
```

- The chat window itself holds **no permissions**
- Five tools: list, read, search notes, create note, reveal secret

Notes:
The chat window having no permissions is the key architectural point. The
AI cannot reach the file system directly. Everything goes through a server
that asks first.

The tunnel is because the chat service is in the cloud and the files are on
your laptop. That is the one genuinely awkward part, and we would rather
show it than hide it.

---

## The safety rules

- **Allowlist** — only folders you named, checked against the real path
- **Approval** — every write needs a native macOS prompt
- **Authentication** — 127.0.0.1 only, bearer token, compared in constant time
- **Limits** — output is capped so one file cannot flood the model
- **Audit log** — append-only, and you can read it in the app

Notes:
"Checked against the real path" — we resolve symlinks first, so a symlink
pointing at /etc/passwd is refused. We have a test for it.

The audit log viewer is in the Log tab of the window. Open it on stage if
there is time.

---

## Offline tools

- **Pomodoro** with notifications — works with no AI, no internet
- **Launcher** for apps and folders
- **Notes and to-dos**

They are not the clever part. They are the reason the window is worth
keeping open.

Notes:
This slide is short on purpose. It is not the pitch, it is the retention
argument.

---

## What it is built on

| | |
|---|---|
| Shell | Tauri 2, Rust |
| Interface | React, TypeScript |
| Conversion | Microsoft MarkItDown, Python |
| Tools | Model Context Protocol server, TypeScript |
| Size | one small window, no bundled model |

Notes:
If asked about cost: everything is free and open source except the AI chat
the user already pays for.

---

## What does not work

We would rather say this than have you find it.

- **Scanned PDFs** — no OCR. Pip reads text, not images, and says so
- **The bridge into the chat page** — tested against a DOM stub, never a live page
- **No AI has driven Pip end to end** — we could not sign in to a chat account
- **The pilot has not run** — no user numbers yet

Notes:
Say this quickly and do not apologise for it. "We tested this against a DOM
stub, not a live page" is a better answer than silence.

If a judge offers to log in, that is the best possible outcome — say yes
immediately.

---

## What is next

- OCR for scans, locally
- Packaging the converter so there is no Python install
- Watch the AI's own thinking while it works
- The pilot, with real numbers

Notes:
---

## Try it

```
git clone https://github.com/haidaralif-24/iWISE
cd iWISE
./setup.sh
./run.sh
```

- The window opens with `Cmd+Shift+Space`
- `./test.sh` runs every test in the repository
- Screenshots of every screen: `docs/screenshots/`

Notes:
Leave this up during questions so people can photograph the URL.

---

## Thank you

### Pip — a lightweight AI assistant window with safe local tool access

- No API key
- No local model
- Your files stay on your machine

Notes:
The three lines at the bottom are the three things to remember if nobody
remembers anything else.
