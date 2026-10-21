// Page-script helper for the chat window (stub)
//
// Runs inside the embedded chat page (untrusted!). Scope is deliberately small:
//  - insert converted Markdown into the chat input box (Tier 2)
//  - never touch privileged Tauri commands
//
// It does NOT carry tool calls. Tool access goes through the local MCP server over
// the tunnel; script injection was rejected as a bridge — see docs/CONCEPT.md §5.

console.log("Pip bridge stub: implement me");
