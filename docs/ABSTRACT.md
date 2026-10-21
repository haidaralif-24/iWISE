# Pip: A Lightweight AI Assistant Window with Safe Local Tool Access

**Category:** Software / Programming
**Competition:** iWISE Regional Final

## Abstract

Students and young professionals rely on AI chat services, yet using them effectively remains awkward. Users copy text out of PDFs, Word files and slides by hand, and the AI cannot see the files themselves, so every question needs its context supplied again. Autonomous AI agents could remove this friction, but they usually require a paid API key or a local model, which many students cannot afford.

We present **Pip**, a small always-on-top desktop window built with Tauri and TypeScript, which opens the AI chat service the user already has and adds three things to it.

First, a document-to-Markdown pipeline built on Microsoft's MarkItDown converts PDF, DOCX, PPTX, XLSX, CSV, HTML and plain-text files locally, on the user's own machine. The user selects the pages they need, edits the result, and sees three token counts side by side: what the document would cost pasted by hand, what the clean Markdown costs, and what the prompt will actually cost. We report these separately because they are not the same number — on our samples the Markdown is a few percent *larger* than the raw text, and the saving comes from choosing pages and trimming text, not from the conversion itself.

Second, a local Model Context Protocol (MCP) server gives the AI controlled access to the user's files. Safety is the core focus: a folder allowlist checked against canonicalised paths, a native confirmation prompt before every write, authenticated connections, output size limits, and an append-only audit log — with a chat window that holds no permissions of its own.

Third, offline tools — a Pomodoro timer, an app launcher and notes — work with no internet connection and no AI.

Pip reuses the AI subscription or free tier the user already has, so it needs no API key and no local model.
**Keywords:** AI assistant, Model Context Protocol, document conversion, productivity, privacy and security, Tauri

<!--
Notes before submitting:
- This version is about 295 words. Check the competition's limit.
- Every claim here is backed by a test in the repository. Before submitting,
  check that the demo still works end to end — the demo script lists the exact
  things that must not be claimed on stage.
- The token claim is deliberately split into three figures. Do not collapse it
  back into "saves tokens" — the measurement does not support that, and the
  judges may ask.
- The scanned-PDF limit is not mentioned here for space, but it will come up
  in questions: Pip reads text, not images, and does no OCR.
-->
