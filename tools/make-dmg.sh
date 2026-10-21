#!/usr/bin/env bash
# Builds a .dmg from the already-built Pip.app.
#
#   tools/make-dmg.sh
#
# Why this exists instead of `npm run tauri build`:
#
# Tauri's bundler uses create-dmg, which drives Finder over AppleScript to
# lay out the disk image window. On this machine that is refused — the
# osascript call comes back with "Finder got an error: AppleEvent timed out"
# — so the .app is built but the .dmg is not.
#
# This script does the same job with hdiutil alone. It needs no GUI
# automation, no AppleScript and no Finder, so it works on a machine where
# the window server is locked down, over SSH, or on a build server.
#
# The result is a plain DMG: drag Pip.app onto the Applications alias.
set -euo pipefail

cd "$(dirname "$0")/.."

BUNDLE="app/src-tauri/target/release/bundle"
APP="$BUNDLE/macos/Pip.app"
OUT_DIR="$BUNDLE/dmg"
VERSION="$(grep -m1 '"version"' app/src-tauri/tauri.conf.json | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
NAME="Pip_${VERSION}_$(uname -m).dmg"

if [ ! -d "$APP" ]; then
  echo "Pip.app has not been built yet. Run this first:" >&2
  echo "  cd app && npm run tauri build -- --bundles app" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

STAGING="$(mktemp -d)"
cleanup() { rm -rf "$STAGING"; }
trap cleanup EXIT

cp -R "$APP" "$STAGING/"
ln -s /Applications "$STAGING/Applications"

# A small readme on the disk image, so it is not a bare folder.
cat > "$STAGING/Read me first.txt" <<'EOF'
Pip — a lightweight AI assistant window.

Drag Pip.app onto the Applications alias to install it, then press
Cmd+Shift+Space to open the window.

Pip needs Python 3.10 or newer for the document converter. The repository
has a setup.sh that creates the environment for you.

Source: https://github.com/haidaralif-24/iWISE
EOF

DMG="$OUT_DIR/$NAME"
rm -f "$DMG"

echo "building ${NAME}..."
hdiutil create \
  -volname "Pip" \
  -srcfolder "$STAGING" \
  -ov \
  -format UDZO \
  -imagekey zlib-level=9 \
  "$DMG" >/dev/null

echo
echo "  $DMG"
echo "  $(du -h "$DMG" | cut -f1)"
echo
echo "  it mounts with:  hdiutil attach \"$DMG\""
echo "  it verifies with: hdiutil verify \"$DMG\""
