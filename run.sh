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
# The MCP server. The token is generated here and printed, so it never has to
# be written down.
# --------------------------------------------------------------------------
if [ -z "${PIP_MCP_TOKEN:-}" ]; then
  PIP_MCP_TOKEN="$(openssl rand -hex 24)"
fi
export PIP_MCP_TOKEN

echo "starting the MCP server…"
(cd mcp-server && npm run dev) &
PIDS+=($!)

# Give it a moment so the health check does not race it.
for _ in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8787/health >/dev/null 2>&1; then
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
  if [ -x sidecars/tunnel/ngrok ] && [ -f "${HOME}/.config/ngrok/ngrok.yml" ]; then
    echo "starting the ngrok tunnel (stable hostname)…"
    (cd sidecars/tunnel && env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
      ./ngrok http 8787 --log=stdout) &
    PIDS+=($!)
  elif [ -x sidecars/tunnel/cloudflared ]; then
    echo "starting the cloudflared tunnel (no account needed, hostname changes)…"
    (cd sidecars/tunnel && env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
      ./cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate) &
    PIDS+=($!)
  else
    echo "no tunnel binary found — run ./setup.sh" >&2
  fi
fi

# --------------------------------------------------------------------------
# The window.
# --------------------------------------------------------------------------
echo "starting Pip…"
(cd app && npm run tauri dev) &
PIDS+=($!)

wait
