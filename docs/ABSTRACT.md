# Pip: A Lightweight AI Assistant Window with Safe Local Tool Access

**Category:** iTECH — Software / Programming
**Competition:** iWISE Regional Final 2026, Yogyakarta
**Participants:** Haidar Ali Fawwaz Nasirodin, Faiq Abiyyu Asyam, Avandreda Giano Bestafa

## Abstract

Students use AI chat daily, yet giving it their own documents is still manual. They copy text out of
PDFs, Word files and slides, and the broken formatting burns free-tier limits. The AI cannot see
their files, so every question needs pasted context. Autonomous agents would remove that friction,
but they require paid API keys or capable hardware, which many students do not have.

Pip is a small always-on-top desktop window, built with Tauri and TypeScript, that opens the AI chat
service a user already has beside a set of local tools. A local pipeline built on Microsoft's
MarkItDown converts PDF, DOCX, PPTX and XLSX files, lets the user preview and edit the Markdown, and
shows a token count for the prompt it assembles. A local Model Context Protocol server
gives the AI controlled access to the user's files, guarded by a folder allowlist with path
canonicalization, native confirmation prompts before any write, authenticated connections, output
size limits and an append-only audit log, while the chat webview is deliberately granted no
application permissions. A Pomodoro timer and quick notes sit alongside them.

Pip needs no API key and no local model. The full path from document to tool call was verified on a
free Claude account through a public tunnel, and adversarial testing closed path traversal and
unauthenticated access while exposing an approval bypass that a green test suite had missed. A
separate measurement showed that conversion alone does not reduce token cost; page selection does,
cutting a six-page PDF from 2,067 tokens to 680.

**Keywords:** AI assistant, Model Context Protocol, local tool access, permission boundary, Tauri

<!-- 255 words in the body, excluding headings, category block and keywords. -->
