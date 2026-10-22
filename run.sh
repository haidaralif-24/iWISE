#!/usr/bin/env bash
# Starts Pip: the MCP tool server and the Tauri window.
#
#   ./run.sh          start both
#   ./run.sh --tunnel also start a cloudflared tunnel
#
# Ctrl-C stops everything.
set -uo pipefail

cd "$(dirname "$0")"

export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"

WITH_TUNNEL=0
for arg in "$@"; do
  case "$arg" in
    --tunnel) WITH_TUNNEL=1 ;;
  esac
done

PIDS=()
cleanup() {
  echo
  echo "stopping…"
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --------------------------------------------------------------------------
# The MCP server. It resolves its own token: PIP_MCP_TOKEN if set, otherwise
# the one saved in ~/.pip/token, generating and saving one on first run. Do not
# generate a token here — that would rotate it on every launch and break a
# connector that was already configured.
# --------------------------------------------------------------------------

echo "starting the MCP server…"
(cd mcp-server && npm run dev) &
PIDS+=($!)

# Give it a moment so the health check does not race it.
for _ in $(seq 1 40); do
  if curl -sf --noproxy '*' http://127.0.0.1:8787/health >/dev/null 2>&1; then
    echo "the MCP server is up on http://127.0.0.1:8787/mcp"
    break
  fi
  sleep 0.25
done

# --------------------------------------------------------------------------
# The tunnel. Only needed for the cloud chat connector.
# --------------------------------------------------------------------------
# --------------------------------------------------------------------------
# The tunnel. Only needed for the cloud chat connector.
#
# ngrok is the intended tunnel: with an account it gives a stable hostname, so
# a connector configured once keeps working. cloudflared remains as a fallback
# because it needs no account, but its hostname changes on every launch.
# --------------------------------------------------------------------------

print_connector() {
  local host=""
  for _ in $(seq 1 40); do
    host="$(curl -s --noproxy '*' http://127.0.0.1:4040/api/tunnels 2>/dev/null \
      | sed -n 's/.*"public_url":"\(https[^"]*\)".*/\1/p' | head -1)"
    if [ -n "$host" ]; then break; fi
    sleep 0.25
  done

  local token="${PIP_MCP_TOKEN:-}"
  local state="${PIP_STATE_DIR:-$HOME/.pip}"
  if [ -z "$token" ] && [ -f "$state/token" ]; then
    token="$(tr -d '\n' < "$state/token")"
  fi

  echo
  if [ -z "$host" ]; then
    echo "could not read the tunnel URL — check http://127.0.0.1:4040" >&2
    return
  fi

  echo "connector URL:"
  echo "  ${host}/mcp"
  if [ -n "$token" ]; then
    echo "  Authorization: Bearer ${token}"
  fi
  if [ "${PIP_ALLOW_QUERY_TOKEN:-}" = "1" ]; then
    echo "  or as one URL: ${host}/mcp?token=${token}"
  else
    echo "  (a client that cannot send headers needs PIP_ALLOW_QUERY_TOKEN=1)"
  fi
  echo
}

if [ "$WITH_TUNNEL" = "1" ]; then
  # The config lives in different places per platform, and a Homebrew install is
  # just as good as a vendored copy, so check both before giving up.
  NGROK_CONFIG=""
  for candidate in \
    "${HOME}/Library/Application Support/ngrok/ngrok.yml" \
    "${HOME}/.config/ngrok/ngrok.yml"
  do
    if [ -f "$candidate" ]; then NGROK_CONFIG="$candidate"; break; fi
  done

  NGROK_BIN=""
  for candidate in sidecars/tunnel/ngrok "$(command -v ngrok || true)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then NGROK_BIN="$candidate"; break; fi
  done

  CF_BIN=""
  for candidate in sidecars/tunnel/cloudflared "$(command -v cloudflared || true)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then CF_BIN="$candidate"; break; fi
  done

  if [ -n "$NGROK_BIN" ] && [ -n "$NGROK_CONFIG" ]; then
    echo "starting the ngrok tunnel…"
    env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
      "$NGROK_BIN" http 8787 --log=stdout &
    PIDS+=($!)
    print_connector
  elif [ -n "$CF_BIN" ]; then
    echo "ngrok is not configured; falling back to cloudflared." >&2
    echo "its hostname changes every launch, so the connector must be updated each time." >&2
    env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
      "$CF_BIN" tunnel --url http://127.0.0.1:8787 --no-autoupdate &
    PIDS+=($!)
    echo "the public URL is in the cloudflared output above."
  else
    echo "ngrok is not installed or has no authtoken." >&2
    echo "install it and run: ngrok config add-authtoken <token>" >&2
  fi
fi

# --------------------------------------------------------------------------
# The window.
# --------------------------------------------------------------------------
echo "starting Pip…"
(cd app && npm run tauri dev) &
PIDS+=($!)

wait
