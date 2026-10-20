# Pip: A Lightweight AI Assistant Window with Safe Local Tool Access

**Category:** Software / Programming
**Competition:** iWISE Regional Final

## Abstract

Students and young professionals increasingly rely on AI chat services, yet using them effectively remains inefficient. Users repeatedly copy and paste text from PDFs, Word files, and slides into the chat, and the messy formatting wastes tokens and free-tier usage limits. The AI also cannot see the user's files, so every question needs manual context. Autonomous AI agents could remove this friction, but they usually require paid API keys or powerful hardware, which many students cannot afford.

We present **Pip**, a small always-on-top desktop window, built with Tauri and TypeScript, that embeds the AI chat service a user already has and adds three capabilities. First, a document-to-Markdown pipeline built on Microsoft's MarkItDown converts PDF, DOCX, PPTX, and XLSX files locally, lets the user preview and edit the result, and shows a token count before and after conversion. Second, a local Model Context Protocol (MCP) server gives the AI controlled access to the user's files. Safety is the core design focus: a folder allowlist with path canonicalization, confirmation prompts shown in native UI, authenticated connections, output size limits, and an append-only audit log, together with a zero-permission sandbox for the embedded chat page. Third, offline tools (Pomodoro timer, app launcher, and notes) work without internet access or AI.

Pip reuses the AI account or free tier the user already has, so it needs no API key and no local model. W
**Keywords:** AI assistant, Model Context Protocol, document conversion, productivity, privacy and security, Tauri

<!--
Notes before submitting:
- Replace [N], [X], [Y] with real pilot numbers, or delete the "Preliminary results" sentence if you have none.
- Only keep claims about features that are actually working in your demo (for example, remove the MCP sentence if the tunnel spike fails).
- Check the competition's word limit and format. This version is about 250 words.
-->
