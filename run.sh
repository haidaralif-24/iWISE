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
if [ "$WITH_TUNNEL" = "1" ]; then
  # ngrok gives a stable hostname, but only with an account. cloudflared needs
  # no account but the hostname changes every time. Prefer ngrok when it is
  # set up, fall back to cloudflared when it is not.
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
    echo "starting the ngrok tunnel (stable hostname)…"
    env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
      "$NGROK_BIN" http 8787 --log=stdout &
    PIDS+=($!)
  elif [ -n "$CF_BIN" ]; then
    echo "starting the cloudflared tunnel (no account needed, hostname changes)…"
    env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
      "$CF_BIN" tunnel --url http://127.0.0.1:8787 --no-autoupdate &
    PIDS+=($!)
  else
    echo "no tunnel binary found — run ./setup.sh, or install ngrok or cloudflared" >&2
  fi
fi

# --------------------------------------------------------------------------
# The window.
# --------------------------------------------------------------------------
echo "starting Pip…"
(cd app && npm run tauri dev) &
PIDS+=($!)

wait
