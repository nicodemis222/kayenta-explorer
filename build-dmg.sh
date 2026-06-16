#!/usr/bin/env bash
# Build a distributable Kayenta Explorer.dmg.
#
# The DMG contains a self-bootstrapping .app: a fresh Mac that only has
# Node.js installed can mount it, drag the app to Applications, and on first
# launch the app installs its own dependencies + headless browser and starts.
# (Node itself is NOT bundled — it's the one host prerequisite. See README.)
#
# Steps:
#   1. Build the client (so client/dist is bundled — first run skips it).
#   2. Build the .app with the source bundled inside (KAYENTA_BUNDLE_SOURCE=1).
#   3. Lay out a staging folder with the .app + an /Applications symlink.
#   4. hdiutil → compressed .dmg, then ad-hoc sign the result.
#
# Usage:
#   ./build-dmg.sh                       # → dist/Kayenta Explorer.dmg
#   ./build-dmg.sh /path/out.dmg         # → that path
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DMG_OUT="${1:-$REPO_DIR/dist/Kayenta Explorer.dmg}"
VOL_NAME="Kayenta Explorer"

command -v hdiutil >/dev/null 2>&1 || { echo "✗ hdiutil not found (macOS only)" >&2; exit 1; }

echo "▶ Building client (vite build)…"
( cd "$REPO_DIR/client" && npx vite build >/dev/null )

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "▶ Building self-bootstrapping .app (source bundled)…"
KAYENTA_BUNDLE_SOURCE=1 "$REPO_DIR/build-launcher.sh" "$STAGE" >/dev/null

# Drag-to-install affordance.
ln -s /Applications "$STAGE/Applications"

mkdir -p "$(dirname "$DMG_OUT")"
rm -f "$DMG_OUT"

echo "▶ Creating DMG…"
hdiutil create \
  -volname "$VOL_NAME" \
  -srcfolder "$STAGE" \
  -ov -format UDZO \
  "$DMG_OUT" >/dev/null

# Ad-hoc sign the DMG so Gatekeeper's first-open prompt is the normal one.
if command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - "$DMG_OUT" >/dev/null 2>&1 || true
fi

SIZE=$(du -h "$DMG_OUT" | awk '{print $1}')
echo
echo "✓ Built $DMG_OUT ($SIZE)"
echo "  Distribute it; users drag the app to Applications and open it."
echo "  First launch self-installs deps + Chromium (needs Node.js + network)."
