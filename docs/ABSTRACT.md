# Pip: A Lightweight AI Assistant Window with Safe Local Tool Access

**Category:** iTECH — Software / Programming  
**Competition:** iWISE Regional Final 2026, Yogyakarta  
**Participants:** Haidar Ali Fawwaz Nasirodin, Faiq Abiyyu Asyam, Avandreda Giano Bestafa

## Abstract

A student's AI chat can answer questions about the world but cannot open a single file on their own
machine. Everything must be pasted in, and the useful automation — an assistant that reads your
notes, finds your document, saves what it worked out — is reserved for users with a paid API key or
a capable local machine. The capability gap is a pricing gap, and it lands on exactly the users who
would benefit most.

Pip is a small always-on-top desktop window, built with Tauri and TypeScript, that sits beside the AI
chat service a user already has and gives it hands. A local Model Context Protocol server exposes
seven tools — list a folder, read a document, search notes, write a note, render a digest or a quiz —
guarded by a folder allowlist with path canonicalisation, native confirmation before any write,
authenticated connections, output size limits and an append-only audit log, while the chat webview is
deliberately granted no application permissions. One of those seven tools converts PDF, DOCX, PPTX and
XLSX using Microsoft's MarkItDown; the window also carries a Pomodoro timer and quick notes, because a
tool that is not pleasant to keep open does not get used.

Pip needs no API key and no local model. A free Claude account reached the local tool server through
a public tunnel and executed calls end to end, and adversarial testing closed path traversal and
unauthenticated access while exposing an approval bypass that a green test suite had missed. The
document tool was measured and turned out not to save tokens at all — conversion makes a prompt 12%
larger — which is reported as a negative result rather than presented as a feature.

**Keywords:** AI assistant, Model Context Protocol, local tool access, permission boundary, Tauri
