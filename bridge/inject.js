// Option B: script-injection bridge (stub)
//
// Runs inside the embedded chat page (untrusted!). It must:
//  - watch AI replies for a tool-call block (e.g. a fenced ```pip-tool JSON block)
//  - forward it to the local bridge over an AUTHENTICATED localhost channel
//  - type the result back into the chat input
//  - never get access to privileged Tauri commands
//
// Also reused by Tier 2 to insert converted Markdown into the chat input box.

console.log("Pip bridge stub: implement me");
