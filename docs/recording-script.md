# Demo Recording Script

A recording is not the demo. **Live is better** — the whole point is that it
runs on this laptop, with no account and no API key. But if you need a
recording (for a submission form, or in case the room's wifi dies), this is
the plan.

**Length:** 4 minutes 30 seconds. Do not go longer.
**Format:** screen capture of the Pip window and the chat window, no face
camera, no music. Voice over is fine.

## Before you record

Do these four things first. Each has cost time in the past.

1. **Start the stack and wait for the tunnel URL.**
   ```bash
   ./run.sh --tunnel
   ```
   The URL changes every time unless you have an ngrok authtoken. If you are
   recording, set up the connector in the chat site *before* you press record.

2. **Copy the connector URL with the token.** `run.sh` prints it. Put it in
   the chat site's MCP settings now and confirm the tools are listed.

3. **Open the chat window and sign in.** Email and password — Google blocks
   sign-in inside an embedded window. Do not try to sign in on stage.

4. **Put the files where you can reach them.** Drag `tests/samples/Assignment_1…Buoyancy….pdf`
   onto the Desktop so the drag is fast and obvious.

## Shot list

| # | What is on screen | What you say | Time |
|---|---|---|---|
| 1 | The chat window, a real question typed and answered | "This is the chat you already use. Pip is the same thing, with a way to prepare what you paste." | 0:00 |
| 2 | Pip's window — the Chat tab, hotkey caption visible | "One small window. Cmd+Shift+Space brings it up over anything." | 0:20 |
| 3 | The Documents tab, empty | "You drop a file on it." | 0:35 |
| 4 | The drag happening, then the Markdown preview filling in | "It converts locally, on this machine. Nothing is uploaded." | 0:40 |
| 5 | The three token numbers, cursor pointing at them | "Three numbers, because they are not the same number. Two thousand and sixty-seven if I pasted the whole file by hand. Six hundred and eighty if I send only the two pages I need." | 1:05 |
| 6 | The page selector being changed to 2–3, the number dropping | "That is where the saving is — choosing pages. Converting to Markdown does not make the text smaller; it makes it structured." | 1:35 |
| 7 | The chat window, Pip's text injected into the composer | "One button puts it in the chat." | 2:00 |
| 8 | Pip asking for a permission, the native prompt | "Now the AI gets hands. It asks Pip, Pip asks me." | 2:15 |
| 9 | The prompt showing the tool and the arguments | "It says what it is about to do, with the arguments, before it does it." | 2:30 |
| 10 | The Log tab, the audit entries | "And every action is in an append-only log I can read." | 2:50 |
| 11 | The Timer tab | "The timer, the launcher and the notes work with no internet and no AI. That is why you keep the window open." | 3:10 |
| 12 | Back to the chat, the summary coming back | "No API key. No local model. Your files stayed here." | 3:35 |
| 13 | The terminal showing `./test.sh` passing | "And every claim in this talk has a test in the repository." | 3:55 |
| 14 | Title card: Pip, and the GitHub URL | "Pip. It is open source." | 4:15 |

## If something breaks on camera

Do not restart the app. Say what is happening and move on — the recovery is
part of the demo.

- **The connector is not listed.** Say: "The tunnel just changed its
  hostname, which is the one weakness of this design — it is why there is an
  ngrok path for a stable address." Then jump to shot 11.
- **The conversion is slow.** It is about a second for the 6-page worksheet.
  If it is slower than that, the Python environment is not warm; skip to
  shot 6 and say the preview is already there.
- **The chat is not signed in.** Jump to shot 2 and show the window, then
  shot 10 (the audit log). Those do not need a chat at all.
- **The whole tunnel is down.** Skip to shot 11. The offline tools are a
  complete demonstration of their own claim.

## What not to show

- The terminal with your token on screen. Crop it, or close it.
- The keychain, or anything from `security find-internet-password`.
- The `~/.pip/control.json` file.
- Any real student work that is not the synthetic sample in `tests/samples/`.

## The fallback: a slideshow instead of a recording

`docs/screenshots/` has every screen of the app rendered at its real size
(420×680), produced by `node app/ui-audit.mjs`. Those are real renders, not
mock-ups, so they can be assembled into a video or shown as a still
sequence if a recording is not possible.

They do **not** cover the chat window or the native permission prompt — those
are the two moments that need a real screen.
