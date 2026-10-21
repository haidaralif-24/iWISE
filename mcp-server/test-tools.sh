#!/usr/bin/env bash
# Functional test for the Pip MCP tool layer.
# Exercises: tool listing, the allowlist, document conversion, notes search,
# the approval round trip, and the audit log.
set -uo pipefail

BASE="${PIP_MCP_BASE:-http://127.0.0.1:8787}"
TOKEN="${PIP_MCP_TOKEN:-testtoken123}"
STATE_DIR="${PIP_STATE_DIR:-$HOME/.pip}"
NOTES_DIR="${PIP_NOTES_DIR:-$STATE_DIR/notes}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

call() {
  local payload="$1"
  curl -s -X POST "$BASE/mcp" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "$payload"
}

# The server answers with SSE frames; strip the "data: " prefix.
strip() { sed -n 's/^data: //p'; }

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILED=1; }
FAILED=0

expect_contains() {
  local haystack="$1" needle="$2" label="$3"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then pass "$label"; else
    fail "$label (expected to contain: $needle)"
    printf '       got: %s\n' "$(printf '%s' "$haystack" | head -c 400)"
  fi
}

echo "== 1. tool list =="
TOOLS=$(call '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | strip)
for tool in list_files read_document_as_markdown search_notes create_note reveal_secret; do
  expect_contains "$TOOLS" "\"$tool\"" "tool '$tool' is registered"
done

echo
echo "== 2. allowlist: allowed path is accepted =="
OUT=$(call '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_files","arguments":{"folder":"'"$REPO"'/tests/samples"}}}' | strip)
expect_contains "$OUT" "Activity_1.pdf" "list_files sees files inside an allowed folder"

echo
echo "== 3. allowlist: outside path is refused =="
OUT=$(call '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_files","arguments":{"folder":"/etc"}}}' | strip)
expect_contains "$OUT" "Not allowed" "list_files refuses /etc"
expect_contains "$OUT" "outside the allowed folders" "refusal explains why"

echo
echo "== 4. allowlist: traversal and symlink tricks are refused =="
mkdir -p "$NOTES_DIR/sub"
ln -sfn /etc "$NOTES_DIR/escape" 2>/dev/null
OUT=$(call '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"read_document_as_markdown","arguments":{"path":"'"$HOME"'/.pip/notes/escape/passwd"}}}' | strip)
expect_contains "$OUT" "Not allowed" "symlink pointing out of the allowlist is refused"

OUT=$(call '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"read_document_as_markdown","arguments":{"path":"'"$REPO"'/tests/samples/../../../../etc/passwd"}}}' | strip)
expect_contains "$OUT" "Not allowed" "../ traversal is refused"

OUT=$(call '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"read_document_as_markdown","arguments":{"path":"https://example.com/x.pdf"}}}' | strip)
expect_contains "$OUT" "Not allowed" "http(s) URI is refused"

echo
echo "== 5. document conversion =="
OUT=$(call '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"read_document_as_markdown","arguments":{"path":"'"$REPO"'/tests/samples/Activity_1.docx"}}}' | strip)
expect_contains "$OUT" "UNTRUSTED DOCUMENT" "returned text is fenced as untrusted"
expect_contains "$OUT" "tokens" "returns a token estimate"

OUT=$(call '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"read_document_as_markdown","arguments":{"path":"'"$REPO"'/tests/samples/Assignment_1._IB_Physics_Buoyancy_Haidar_Worksheet_Term_2__25_26_.pdf","pages":"2-3"}}}' | strip)
expect_contains "$OUT" "sent: 2, 3" "page selection is reported back"

echo
echo "== 6. notes search =="
printf 'Physics notes: buoyancy and displacement.\n' > "$NOTES_DIR/physics.md"
OUT=$(call '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"search_notes","arguments":{"query":"buoyancy"}}}' | strip)
expect_contains "$OUT" "buoyancy" "search_notes finds the phrase"

echo
echo "== 7. approval round trip =="
rm -f "$NOTES_DIR/approved-note.md"
call '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"create_note","arguments":{"title":"approved note","text":"written after approval"}}}' > /tmp/pip-create.out 2>&1 &
CALL_PID=$!
sleep 2
PENDING=$(curl -s "$BASE/pending" -H "Authorization: Bearer $TOKEN")
expect_contains "$PENDING" "approved note" "pending request is visible to the app"
REQ_ID=$(printf '%s' "$PENDING" | sed -n 's/.*"id":"\([a-f0-9]*\)".*/\1/p' | head -1)
if [ -n "$REQ_ID" ]; then
  pass "pending request has an id"
  curl -s -X POST "$BASE/approve" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"id":"'"$REQ_ID"'","approved":true}' > /dev/null
  wait $CALL_PID
  if [ -f "$NOTES_DIR/approved-note.md" ]; then
    pass "approved note was written to disk"
  else
    fail "approved note was NOT written to disk"
  fi
  expect_contains "$(cat "$NOTES_DIR/approved-note.md" 2>/dev/null)" "written after approval" "note body is correct"
else
  fail "could not read the pending request id"
fi

echo
echo "== 8. denied approval writes nothing =="
rm -f "$NOTES_DIR/denied-note.md"
call '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"create_note","arguments":{"title":"denied note","text":"should not exist"}}}' > /tmp/pip-create2.out 2>&1 &
CALL_PID=$!
sleep 2
PENDING=$(curl -s "$BASE/pending" -H "Authorization: Bearer $TOKEN")
REQ_ID=$(printf '%s' "$PENDING" | sed -n 's/.*"id":"\([a-f0-9]*\)".*/\1/p' | head -1)
curl -s -X POST "$BASE/approve" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"'"$REQ_ID"'","approved":false}' > /dev/null
wait $CALL_PID
if [ ! -f "$NOTES_DIR/denied-note.md" ]; then
  pass "declined note was not written"
else
  fail "declined note WAS written"
fi

echo
echo "== 9. audit log =="
AUDIT="$STATE_DIR/audit.log"
if [ -f "$AUDIT" ]; then
  LINES=$(wc -l < "$AUDIT" | tr -d ' ')
  if [ "$LINES" -ge 8 ]; then pass "audit log has $LINES entries"; else fail "audit log only has $LINES entries"; fi
  expect_contains "$(cat "$AUDIT")" "create_note" "audit log records create_note"
  expect_contains "$(cat "$AUDIT")" '"approved":true' "audit log records the approval"
  expect_contains "$(cat "$AUDIT")" '"approved":false' "audit log records the refusal"
  expect_contains "$(cat "$AUDIT")" '"allowed":false' "audit log records refused paths"
else
  fail "no audit log at $AUDIT"
fi

echo
echo "== 10. auth =="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/mcp" -d '{}')
if [ "$CODE" = "401" ]; then pass "no token gets 401"; else fail "no token got $CODE"; fi
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/pending")
if [ "$CODE" = "401" ]; then pass "/pending needs a token"; else fail "/pending got $CODE without a token"; fi
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/nope")
if [ "$CODE" = "404" ]; then pass "unknown path gets 404"; else fail "unknown path got $CODE"; fi

echo
if [ "$FAILED" = "0" ]; then
  printf '\033[32mAll MCP tool-layer tests passed.\033[0m\n'
else
  printf '\033[31mSome tests failed.\033[0m\n'
  exit 1
fi
