#!/usr/bin/env bash
# Runs every test in the repository.
#
#   ./test.sh
#
# Exits non-zero if anything fails. Safe to run while the app is open: the
# MCP tests get their own server on their own port with their own state
# folder, so they never touch your running server or your real notes.
set -uo pipefail

cd "$(dirname "$0")"

export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"

FAILED=0

section() { printf '\n\033[1;36m== %s\033[0m\n' "$1"; }
fail() { printf '\033[31mFAILED: %s\033[0m\n' "$1"; FAILED=1; }

# ----------------------------------------------------------------- the app
section "Tauri app — Rust command layer"
cargo_log="$(mktemp)"
if (cd app/src-tauri && cargo test) >"$cargo_log" 2>&1; then
  grep -E "^test result" "$cargo_log"
else
  grep -E "^test result|^error|panicked" "$cargo_log" | head -20
  fail "cargo test"
fi
rm -f "$cargo_log"

# ----------------------------------------------------------------- frontend
section "Frontend — type check and production build"
if (cd app && npx tsc --noEmit && npm run build) 2>&1 | tail -6; then
  :
else
  fail "frontend build"
fi

# ----------------------------------------------------------------- bridge
section "Bridge — the script that writes into the chat page"
if node bridge/test-inject.js; then
  :
else
  fail "bridge tests"
fi

# ---------------------------------------------------------------- the converter
section "Converter — every format Pip claims to handle"
CONVERTER_PY="sidecars/markitdown/.venv/bin/python"
if [ -x "$CONVERTER_PY" ]; then
  if "$CONVERTER_PY" sidecars/markitdown/test-convert.py; then
    :
  else
    fail "converter tests"
  fi
else
  fail "converter tests — $CONVERTER_PY is missing (run setup.sh)"
fi

# ----------------------------------------------------------------- mcp server
section "MCP server — type check"
if (cd mcp-server && npx tsc --noEmit); then
  echo "typecheck clean"
else
  fail "mcp-server typecheck"
fi

section "MCP server — tool layer"

# The tests get their own server on their own port, with their own state
# folder. That way they never collide with a server you are already running,
# and they never write into your real notes folder or audit log.
TEST_PORT="${PIP_TEST_PORT:-8788}"
TEST_STATE="$(mktemp -d)"
export PIP_MCP_PORT="$TEST_PORT"
export PIP_MCP_TOKEN=testtoken123
export PIP_STATE_DIR="$TEST_STATE"
export PIP_NOTES_DIR="$TEST_STATE/notes"
export PIP_MCP_BASE="http://127.0.0.1:$TEST_PORT"

(cd mcp-server && npm run dev >/tmp/pip-test-mcp.log 2>&1 &)

ready=0
for _ in $(seq 1 60); do
  if curl -sf "$PIP_MCP_BASE/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done

if [ "$ready" != "1" ]; then
  echo "the test server did not come up — see /tmp/pip-test-mcp.log"
  tail -20 /tmp/pip-test-mcp.log
  fail "mcp-server tool tests"
else
  if (cd mcp-server && ./test-tools.sh); then
    :
  else
    fail "mcp-server tool tests"
  fi
fi

# Stop only the server we started: find whatever is holding the test port.
for pid in $(lsof -ti "tcp:$TEST_PORT" 2>/dev/null); do
  kill "$pid" 2>/dev/null || true
done
sleep 0.5
rm -rf "$TEST_STATE"

# Put the environment back for anything that runs after this script.
unset PIP_MCP_PORT PIP_MCP_TOKEN PIP_STATE_DIR PIP_NOTES_DIR PIP_MCP_BASE

# ------------------------------------------------------------------- the ui
# The interface is rendered for real in headless Chrome and measured: text
# clipped by its box, content outside the window, controls too small to hit.
# It needs a Chrome binary, so it is skipped when there is none.
section "UI — the interface rendered and measured"
if node app/ui-audit.mjs --out "$PWD/docs/screenshots" 2>&1 | tail -14; then
  :
else
  fail "ui audit"
fi

# ----------------------------------------------------------------- result
printf '\n'
if [ "$FAILED" = "0" ]; then
  printf '\033[32mEverything passed.\033[0m\n'
else
  printf '\033[31mSomething failed.\033[0m\n'
  exit 1
fi
