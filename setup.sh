#!/usr/bin/env bash
# One-time setup: installs everything Pip needs on this machine.
#
#   ./setup.sh
#
# It is safe to run again — each step is skipped if it is already in place.
set -euo pipefail

cd "$(dirname "$0")"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$1"; }
ok() { printf '   \033[32mok\033[0m %s\n' "$1"; }
warn() { printf '   \033[33m!\033[0m %s\n' "$1"; }

# --------------------------------------------------------------------------
say "Node"
if command -v node >/dev/null 2>&1; then
  ok "node $(node -v)"
else
  warn "node is missing — install Node 20+ from https://nodejs.org"
fi

# --------------------------------------------------------------------------
say "Rust (needed to build the Tauri app)"
if command -v cargo >/dev/null 2>&1 || [ -x "$HOME/.cargo/bin/cargo" ]; then
  ok "$("$HOME/.cargo/bin/cargo" -V 2>/dev/null || cargo -V)"
else
  warn "installing rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --profile minimal
  ok "rust installed — run 'source \$HOME/.cargo/env' in your shell"
fi

if ! xcode-select -p >/dev/null 2>&1; then
  warn "installing the Xcode command line tools"
  xcode-select --install || true
fi

# --------------------------------------------------------------------------
say "uv (used to build the Python environment)"
if ! command -v uv >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/uv" ]; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ok "uv installed"
else
  ok "uv present"
fi
export PATH="$HOME/.local/bin:$PATH"

# --------------------------------------------------------------------------
say "Python environment for MarkItDown"
cd sidecars/markitdown
if [ -x .venv/bin/python ]; then
  ok "venv already exists"
else
  # MarkItDown needs Python 3.10 or newer. uv fetches a matching interpreter
  # if the machine does not have one.
  uv python install 3.13
  uv venv --python 3.13 .venv
  ok "venv created"
fi
uv pip install --python .venv/bin/python -r requirements.txt
ok "markitdown installed ($(.venv/bin/python -c 'import markitdown; print(markitdown.__version__)'))"
cd ../..

# --------------------------------------------------------------------------
say "Tunnel binaries"
cd sidecars/tunnel
if [ ! -x ngrok ]; then
  case "$(uname -m)" in
    arm64) NGROK_ARCH=arm64; CF_ARCH=arm64 ;;
    *)     NGROK_ARCH=amd64; CF_ARCH=amd64 ;;
  esac
  warn "downloading ngrok"
  curl -sSL -o ngrok.zip "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-darwin-${NGROK_ARCH}.zip"
  unzip -o -q ngrok.zip && rm ngrok.zip && chmod +x ngrok
  ok "ngrok installed"
fi
if [ ! -x cloudflared ]; then
  case "$(uname -m)" in
    arm64) CF_ARCH=arm64 ;;
    *)     CF_ARCH=amd64 ;;
  esac
  warn "downloading cloudflared"
  curl -sSL -o cf.tgz "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${CF_ARCH}.tgz"
  tar xzf cf.tgz && rm cf.tgz && chmod +x cloudflared
  ok "cloudflared installed"
fi
cd ../..

# --------------------------------------------------------------------------
say "Node dependencies"
(cd app && npm install --silent)
ok "app dependencies installed"
(cd mcp-server && npm install --silent)
ok "mcp-server dependencies installed"

# --------------------------------------------------------------------------
say "Ready"
cat <<'EOF'

Start everything with:

    ./run.sh

Or run the pieces by hand:

    cd app && npm run tauri dev
    cd mcp-server && PIP_MCP_TOKEN=... npm run dev

EOF
