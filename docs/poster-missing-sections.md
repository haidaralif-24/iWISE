# Poster — the seven missing sections

`docs/pip-poster-print.pdf` has 7 of the 14 mandated headings. These seven are absent. The deck
requires them on the poster, so paste these blocks in before printing.

Ordered by column, with a target height at 157 × 210 cm. Body copy is written to sit at 30–34 pt.

---

## 1. Background Research

**Target: ~28 cm tall, column 1**

> **Model Context Protocol** — an open standard for exposing tools to an AI client over a transport
> it already speaks. It is what lets a cloud chat service call a process on the user's own machine.
>
> **MarkItDown** — converts PDF, DOCX, PPTX and XLSX to Markdown. Chosen because conversion is a
> solved problem and the interesting one is the permission boundary.
>
> **Tauri** — a Rust shell rendering the system webview. Chosen over Electron so that spawning a
> process is an explicit, reviewable command.
>
> *Existing AI desktop clients give an assistant file access, but the boundary is set by the vendor
> and the account is normally paid. The gap is the student on a free tier who wants both.*

---

## 2. Methods / Procedures

**Target: ~24 cm tall, column 2**

> Built in three tiers over seven days, so each tier is a complete project if time runs out. The
> riskiest unknown — whether a free account can reach a local server at all — was tested on day two,
> before the document pipeline was started.
>
> Evaluated on three axes. **Function:** the chain split into seven links, each pass, fail or
> untested, and a link counts only when observed running. **Safety:** adversarial testing, where a
> case passes only if the attempt is refused *and* the refusal is logged. **Cost:** marginal cost to
> the student, with token efficiency as one sub-metric.

---

## 3. Data Graph / Table

**Target: ~22 cm tall, column 2**

Two bars, one real measurement. Do not invent a corpus.

| | Tokens |
|---|---|
| Paste the file by hand | 1,844 |
| Converted, whole file | 2,067 |
| Pages 2–3 only | 686 |

> One six-page worksheet, measured. Converting alone makes the prompt 12% **larger**; selecting two
> pages cuts it by 63%. Six of the 686 tokens are the `[p.2]` / `[p.3]` markers that let the model
> cite.

If a chart is easier than a table: three horizontal bars — 1,844 (89%), 2,067 (100%), 686 (33%) —
with the third one highlighted.

**Do not label 2,067 as "paste by hand".** That is the converted whole document. Pasting by hand is
1,844. The distinction is the point of the section: conversion made it worse.

---

## 4. Errors and Limitation Gaps

**Target: ~26 cm tall, column 3**

> **No delivery.** Pip prepares the prompt; the paste is manual. The automatic paste depended on the
> chat vendor's markup and could not be verified without a live account, so it was removed rather
> than risked.
>
> **Tier 3 needs the internet.** The chat client is cloud-hosted, so the tunnel must be up.
>
> **No user study.** The survey instrument exists and was not administered. No claim about usability
> is made.
>
> **macOS only.** Windows path handling is untested.
>
> **Open by design.** A folder can be swapped between validation and conversion. Closing that needs
> OS-level isolation, not JavaScript.
>
> **Not packaged.** The app runs from a checkout.

---

## 5. Future Research

**Target: ~14 cm tall, column 3**

> **Package it.** Bundle the converter and the tool server, add a first-run panel, sign it.
>
> **Administer the survey.** Ten to twenty students, timed task, before and after.
>
> **Scanned PDFs.** Currently return zero pages; needs OCR.
>
> **Windows**, and a per-tool rate limit.

---

## 6. References

**Target: ~9 cm tall, column 3, 22–24 pt**

> Anthropic. *Model Context Protocol specification.* modelcontextprotocol.io
>
> Microsoft. *MarkItDown.* github.com/microsoft/markitdown
>
> Tauri Contributors. *Tauri 2 documentation.* tauri.app
>
> Model Context Protocol. *Authorization specification.*

---

## 7. Acknowledgements

**Target: ~7 cm tall, column 3**

> Supervising teacher Muhammad Hasan, Ph.D., for the print run and the deadline. Our families, for the laptops. The
> MarkItDown, Tauri and MCP maintainers, whose work this stands on.

---

## Also fix before printing

**The file is 45.7 × 61.0 cm, not 157 × 210 cm.** That is Canva's 18 × 24 inch poster preset. The
required size is 156.9 × 210 cm — about 3.44× larger, and the aspect ratio happens to match exactly
(0.749 vs 0.748), so nothing is distorted.

Two options:

1. **Resize in Canva** to a custom 1569 × 2100 mm design and re-export. Cleanest, but you would relayout.
2. **Tell the print shop to scale 344%** to 157 × 210 cm. The text is vector — I checked, it extracts
   as text — so it scales without blurring. Say the target size in writing on the order.

Option 2 is faster and safe. Put it on the order slip: *"scale to 1570 × 2100 mm"*.
