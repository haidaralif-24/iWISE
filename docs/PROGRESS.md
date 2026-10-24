# Progress log

What has been built, what has been proven, and what is still an assumption.

The rule for this file: **a feature is only "done" when someone ran it.** Code that compiles and
looks right is listed as written, not as working. Several things below were corrected after being
measured, and those corrections are kept rather than tidied away — they are the most useful part.

Last updated: 2026-10-22.

---

## Where the project stands

| Tier | Item | State |
|---|---|---|
| **1** | Floating window, always-on-top, hotkey | Done, used daily |
| | Chat window (separate window, docked) | Done |
| | Pomodoro timer, adjustable durations | Done, verified in the app |
| | App / shortcut launcher | **Removed 2026-10-24** |
| | Quick notes | Written |
| **2** | Drag-and-drop a document | Written |
| | Convert to clean Markdown | Done, measured on real files |
| | Page selection | Done, verified end to end (2,067 → 680 tokens) |
| | Editable preview, merge files | Written |
| | Three-figure token readout | Written |
| | Prompt templates | Written |
| | ~~Copy prompt to the clipboard~~ | **Removed 2026-10-24** |
| | ~~Inject into the chat input~~ | **Removed 2026-10-24** |
| **3** | Five MCP tools | Done, called through the public tunnel |
| | Folder allowlist, granted in the app | Done, verified live (grant/revoke, no restart) |
| | Confirmation before writing | Written, wired end to end |
| | Append-only audit log + viewer | Written |
| | Tunnel + free Claude connector | **Done, verified end to end** |

---

## Timeline

### Day 1 — 2026-10-20: the shell

`daf4053` → `90ca798` → `b2fbdc0`

Tauri window that floats above other apps, a global hotkey (`Cmd+Shift+Space`), and the chat opened in
its own window rather than an iframe — chat sites block embedding, so an iframe was never going to
work. Docking put the chat beside Pip as one unit.

**Verified:** hotkey registers on macOS, window toggles, chat window opens and is resizable.

### Day 2 — 2026-10-21: the spike, and the decision it produced

`9fd7a66` → `af891b1` → `f716014` → **`c1458f3`** → `c5c4473`

MarkItDown measured on four real documents before committing to it. The login question settled:
email, not OAuth. The abstract written.

Then the decision that shaped everything: **tunnel + remote MCP only**, with the script-injection
route explicitly dropped and no fallback kept. That was the one true unknown in the project, so it
was tested first.

**Verified, on a free Claude account:**

```
Claude (cloud) → ngrok → 127.0.0.1:8787 → reveal_secret → "The eagle lands at midnight."
```

`/health` answered through the tunnel and an unauthenticated request was refused with 401. The
riskiest assumption in the project became a fact rather than a plan.

Then the Pomodoro timer, and its durations made adjustable.

### Day 2, evening — `28094a0`: Tiers 2 and 3 arrive at once

Faiq built the document bridge and the tool layer in a single 3,900-line commit: conversion with a
JSON envelope, page selection, drag-and-drop UI, five tools, the approval flow over files in
`~/.pip/`, and the audit log.

He also corrected the concept in place, and the corrections matter:

- **Converting to Markdown does not save tokens.** MarkItDown's output is within a few percent of the
  raw text and usually *larger*. The saving comes from **page selection**. Measured: 6 pages =
  2,067 tokens, pages 2–3 = 680. The pitch was rewritten around that.
- **Rust is no longer template-only.** Two narrow commands (`convert_document`, `inject_into_chat`)
  instead of a Tauri shell plugin with a general "run any process" permission.
- **No `Origin` check**, deliberately: the tunneled client is a backend and sends no `Origin`.

### Day 3 — 2026-10-22: review, then security

`9ab481f` → `e9cd81e` → `07be7d5` → `8912011` → `b096012` → `b87929e`

**PR #1 reviewed by running it, not reading it.** The path validation was solid; the auth was not.
`PIP_MCP_TOKEN=""` made the token empty, and an empty token compares equal to a missing
`Authorization` header — so a request with **no credentials at all** returned HTTP 200 and a tool
result. Reproduced, fixed, and the same bypass was then found live on `main`.

The PR was closed as superseded: `main` had moved to a parallel implementation, so merging would have
meant choosing one architecture inside a merge commit. Its security findings were ported instead.

Then, in order:

- **Token:** fail-fast was the wrong shape — it protected the server and left the user with nothing
  to do. Now resolved as `PIP_MCP_TOKEN` → `~/.pip/token` → generate and save. Same token every run.
- **Folder access:** the default was `~/Documents` and `~/Desktop`, so the AI could read a personal
  folder the user never chose. Now nothing is shared until the user adds it in the app, and the
  server re-reads the list on every call.
- **A missing `pypdf`** made every PDF report zero pages, which silently disabled the page selector —
  the feature the headline saving depends on. The only symptom was one failing test. The bare
  `except` that hid it now warns, and `--pages` fails rather than quietly sending the whole file.
- **`run.sh`** was rotating the token on every launch and could never find ngrok on macOS. Both
  fixed; `--tunnel` now prints the finished connector URL and token.

### Day 3, evening — the suite went green, and what it exposed

Running `./test.sh` after the folder-access change turned up three things worth keeping:

1. **The test token was too short** for the new minimum, so the test server refused to start. Fixed
   in `test.sh` and `test-tools.sh`.
2. **The tool tests were passing on borrowed time.** They never declared an allowlist, and
   `tests/samples` sits inside `~/Documents` — so they only worked because the over-broad default
   shared the whole folder. Removing that default exposed it. They now set `PIP_ALLOWED_FOLDERS`
   explicitly, which is what a test should do.
3. **`PIP_ALLOWED_FOLDERS` was dropping the notes folder.** Setting the override returned early and
   skipped the always-shared notes directory, so `create_note` and `search_notes` broke under the
   test configuration. Notes are now included in every mode.

Also: every curl in the test scripts went through `HTTP_PROXY` and failed with 502 on a machine that
has a proxy configured. Both scripts now set `no_proxy` for loopback.

Result: `./test.sh` → **exit 0**, 13 Rust tests, 9 bridge tests, all tool-layer assertions.

### Day 5 — 2026-10-24: scope reduction before the exhibition

Five days out from the iWISE Regional Final, three things came out of the build. None of them is a
fix; all of them are decisions about what to claim.

**Chat injection is gone, and nothing replaced it.** `inject_into_chat`, `bridge/inject.js` and its
test file were removed. The command evaluated a page script into the chat webview to write the prompt
into the message box. It worked against a DOM stub and had never run against a live page, and the page
is a third-party site whose markup can change without notice. A link that fails on stage is worse
than a link that was never promised.

A clipboard button was written as the replacement and then removed as well, on the same reasoning
taken one step further: the preview is already a plain editable text box, so selecting the text and
pressing `Cmd+C` needs no code, no permission and cannot break. The app now has **no path out to the
chat at all** — Tier 2 ends with the prompt on screen.

This is a real loss of scope and it is the honest one: **Pip prepares the prompt, it does not deliver
it.** The claim in the abstract, the poster and the demo has to say that, and the report has to say
why.

**The launcher is gone.** It was a hard-coded list of twelve apps and folders opened through the
opener plugin. macOS Spotlight does the same thing better, it was never run, and it added a tab a
judge would reasonably ask about. Deleted.

**The offline claim is gone.** The README, abstract and demo script all claimed "offline productivity
tools". Only the Pomodoro had ever been run; the launcher and notes had not. The claim is now the
smaller true one: conversion happens on this machine, and the only thing that leaves it is what the
user pastes.

Also removed: `bundled_helper`, dead since the converter resolution moved to
`resolve_converter_from` — it had been emitting a dead-code warning on every build.

Net effect on the test suite: the bridge section is gone, so `./test.sh` now runs 13 Rust tests, no
bridge tests, and the tool-layer assertions. The count went down and the coverage did not.

### Day 5, later — the model can ask what it may read

Two changes to the tool layer, both about the same thing: the boundary should be legible from inside
the conversation, not discovered by bumping into it.

**Discovery.** The server now sends `instructions` on connect, listing the shared folders by name and
saying what the tools do. `list_files` takes no `folder` argument to mean "list the shared folders",
returning names and entry counts. Names resolve on the next call because `checkFolder` matches a bare
name against the roots before treating it as a subfolder — which also fixed a documented behaviour
that had never worked: the comment claimed `list_files("Documents")` resolved, but the candidate path
was built as `~/Documents/Documents`.

**No more path leaks.** Refusals used to print every shared folder's absolute path. They now print
names, and echo back only what the caller asked for. A refusal is not the place to hand over the
layout of the machine.

**The fence gap.** `search_notes` returned raw file lines with no fence and no size cap, while
`read_document_as_markdown` fenced its output as untrusted data. A note containing "ignore previous
instructions" arrived at the model as ordinary text — and since `create_note` lets the model write
into that folder, it could plant text it would read back later. Fixed: search results now go through
`asUntrustedDocument` and `MAX_CONTENT_CHARS` like everything else.

That is the second time reading the code found something the tests did not. The first was the empty
token. Both are in the research plan as evidence for the secondary question.


---

## Verified, and how

| Claim | How it was checked |
|---|---|
| Free Claude account can call a local tool | Live call through ngrok, phrase returned |
| Page selection cuts tokens | `2,067 → 680` on a real 6-page PDF |
| Path traversal is blocked | `../../etc/passwd` and `/etc/passwd` both refused |
| Folder access applies without a restart | Revoked and re-granted against a running server |
| Empty token cannot authorise | Reproduced, then fixed and re-tested |
| Whole test suite | `./test.sh` → exit 0: 13 Rust tests, all tool-layer assertions |

## Not verified

- **The window end to end.** The UI compiles and the commands are tested, but nobody has watched a
  document go from drag-and-drop to injected prompt in one run. This is the biggest gap.
- **Windows.** Path handling and the sidecar lookup are untested there.
- **A hostile symlink.** `permissions.ts` resolves with `realpath` before the containment check, but
  no test constructs an actual escaping symlink.
- **The approval dialog on screen.** The server half and the app half are both wired and unit-tested;
  the two have not been watched talking to each other.

## Known issues

| Issue | Notes |
|---|---|
| Not distributable yet | See the packaging note below |
| Tiers 2 and 3 arrived in one commit | Nothing was demoed in between, so the demo depends on paths nobody has watched |
| `setup.sh` does not install `pypdf` | Works here because it was installed by hand; a fresh machine silently loses page selection |
| `~/.pip/control.json` is written but never read | Left over from the socket design; an extra copy of the token on disk |
| TOCTOU between `realpath` and conversion | Documented in the concept; needs OS-level isolation, not fixable in JS |
| PR #2 open, 44 files | Adds slides, screenshots, a dev harness, and the PPTX / scanned-PDF samples that were missing |

## Packaging — not distributable yet

A `.app` built today opens and converts nothing. The app found its converter by walking up from the
**working directory** looking for `sidecars/markitdown/convert.py`; launched from Finder the working
directory is `/`, so the lookup could never succeed. The MCP server has the same problem — it only
exists as `npm run dev` inside a checkout.

**Phase 0 is done (2026-10-23).** Resolution is now: `PIP_CONVERT_SCRIPT` → a `markitdown-helper`
binary in the app's `Contents/Resources` → the repository checkout. A bundled helper is run
directly; a checkout still runs `convert.py` with the sidecar venv. Covered by two tests.

Still needed before anyone can install it:

| Phase | Work |
|---|---|
| 1 | Build the helper with PyInstaller and list it in `bundle.resources` |
| 2 | Bundle the MCP server (esbuild + a `node` binary) and have the app spawn it |
| 3 | Bundle ngrok, plus a first-run panel that takes an authtoken and shows the connector URL |
| 4 | DMG + the signing decision |

Two steps cannot be automated away: the user's own ngrok account, and adding the connector in the
chat service.

## Who did what

| | |
|---|---|
| Dadarzz2405 | Window, hotkey, chat window, spike, MCP server, connector verification, Pomodoro, review, security fixes, folder access, tunnel |
| Faiq-10A | Tier 2 document bridge, Tier 3 tool layer, approvals, audit log, tests, concept corrections |
| Avandreda | PR #1 — the path-validation module the review was built on |
| Vons-School | PR #2 — slides, screenshots, test samples, UI audit |

## Running it

```bash
./setup.sh          # once
./run.sh            # MCP server + window
./run.sh --tunnel   # also an ngrok tunnel, and it prints the connector URL
./test.sh           # everything
```

Two processes, not three: the MarkItDown sidecar is spawned per conversion, never left running.
