#!/usr/bin/env bash
# Build (or rebuild) the macOS .app launcher for Kayenta Explorer.
#
# The .app's executable is a thin shim that execs bootstrap.sh — the
# self-bootstrapping entrypoint that ensures Node deps / build / Chromium are
# present, then starts the app and opens the dashboard. Two modes:
#
#   Dev (default): the shim points at this repo in place (baked path).
#       ./build-launcher.sh                # → ~/Desktop/Kayenta Explorer.app
#       ./build-launcher.sh /Applications  # → that parent dir
#
#   Bundle (KAYENTA_BUNDLE_SOURCE=1): a pruned copy of the source is bundled
#       inside Contents/Resources/app and the shim runs from a writable
#       per-user copy. This is what build-dmg.sh uses to make a distributable
#       .app/.dmg that bootstraps itself on a fresh machine.
#
# Idempotent: rerun any time.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_PARENT="${1:-$HOME/Desktop}"
APP_PATH="$DEST_PARENT/Kayenta Explorer.app"

if [ ! -f "$REPO_DIR/start.sh" ]; then
  echo "✗ build-launcher must be run from inside the kayenta-explorer repo (no start.sh next to it)" >&2
  exit 1
fi

echo "Repo:     $REPO_DIR"
echo "Bundle:   $APP_PATH"
echo

# ── 1. Clean + scaffold ──────────────────────────────────────────────────
rm -rf "$APP_PATH"
mkdir -p "$APP_PATH/Contents/MacOS" "$APP_PATH/Contents/Resources"

# ── 2. Info.plist ────────────────────────────────────────────────────────
cat > "$APP_PATH/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Kayenta Explorer</string>
    <key>CFBundleDisplayName</key>
    <string>Kayenta Explorer</string>
    <key>CFBundleIdentifier</key>
    <string>com.local.kayenta-explorer.launcher</string>
    <key>CFBundleVersion</key>
    <string>1.2</string>
    <key>CFBundleShortVersionString</key>
    <string>1.2</string>
    <key>CFBundleExecutable</key>
    <string>KayentaExplorer</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST

# ── 3. Executable shim → bootstrap.sh ────────────────────────────────────
# All run logic (deps, build, Chromium, launch, browser-open) lives in
# bootstrap.sh. The shim only resolves where the source is and execs it.
EXE="$APP_PATH/Contents/MacOS/KayentaExplorer"
if [ "${KAYENTA_BUNDLE_SOURCE:-0}" = "1" ]; then
  # Distributable: source is bundled in the .app; bootstrap runs it from a
  # writable per-user copy (KAYENTA_BUNDLED=1).
  cat > "$EXE" <<'LAUNCHER'
#!/usr/bin/env bash
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
SRC_DIR="$(cd "$(dirname "$0")/../Resources/app" && pwd)"
export KAYENTA_BUNDLED=1
[ -f "$SRC_DIR/bootstrap.sh" ] || { /usr/bin/osascript -e 'display notification "App source missing — rebuild the DMG" with title "Kayenta Explorer"'; exit 1; }
exec /bin/bash "$SRC_DIR/bootstrap.sh"
LAUNCHER
else
  # Dev: point at this repo in place (path baked at build time).
  ESC_REPO_DIR="${REPO_DIR//\\/\\\\}"; ESC_REPO_DIR="${ESC_REPO_DIR//\"/\\\"}"
  cat > "$EXE" <<LAUNCHER
#!/usr/bin/env bash
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:\${PATH:-}"
SRC_DIR="$ESC_REPO_DIR"
[ -f "\$SRC_DIR/bootstrap.sh" ] || { /usr/bin/osascript -e 'display notification "Source missing — rerun build-launcher.sh" with title "Kayenta Explorer"'; exit 1; }
exec /bin/bash "\$SRC_DIR/bootstrap.sh"
LAUNCHER
fi
chmod +x "$EXE"

# ── 3b. Bundle a pruned source copy for distribution ─────────────────────
if [ "${KAYENTA_BUNDLE_SOURCE:-0}" = "1" ]; then
  echo "Bundling app source into the .app…"
  mkdir -p "$APP_PATH/Contents/Resources/app"
  # Include client/dist (prebuilt) so first run skips the build; exclude
  # node_modules + the DB + runtime files (installed/created per-user).
  rsync -a \
    --exclude '.git' --exclude 'node_modules' --exclude 'server/data' \
    --exclude '.web.port' --exclude '.launcher.pid' --exclude '.vite.log' \
    --exclude 'server/.port' --exclude 'server/.api.pid' --exclude '.deps-stamp' \
    --exclude '*.dmg' --exclude '*.log' \
    "$REPO_DIR"/ "$APP_PATH/Contents/Resources/app"/
fi

# ── 4. App icon ──────────────────────────────────────────────────────────
# Derive AppIcon.icns from client/public/favicon.svg so the bundle stays
# in sync with the in-app theme. SVG → 1024 PNG via qlmanage, then
# downscale and assemble with iconutil.
ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
SVG="$REPO_DIR/client/public/favicon.svg"

if [ -f "$SVG" ] && command -v qlmanage >/dev/null 2>&1 && command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
  echo "Rendering favicon.svg → AppIcon.icns…"
  TMPDIR_RENDER="$(mktemp -d)"
  # qlmanage renders the Quick Look preview; for SVG that's a clean raster.
  qlmanage -t -s 1024 -o "$TMPDIR_RENDER" "$SVG" >/dev/null 2>&1
  BASE_PNG="$TMPDIR_RENDER/$(basename "$SVG").png"
  if [ -f "$BASE_PNG" ]; then
    for s in 16 32 64 128 256 512 1024; do
      sips -z "$s" "$s" "$BASE_PNG" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    done
    # @2x slots reuse the next size up — Apple's expected iconset layout
    cp "$ICONSET/icon_32x32.png"     "$ICONSET/icon_16x16@2x.png"
    cp "$ICONSET/icon_64x64.png"     "$ICONSET/icon_32x32@2x.png"
    cp "$ICONSET/icon_256x256.png"   "$ICONSET/icon_128x128@2x.png"
    cp "$ICONSET/icon_512x512.png"   "$ICONSET/icon_256x256@2x.png"
    cp "$ICONSET/icon_1024x1024.png" "$ICONSET/icon_512x512@2x.png"
    # 64 and 1024 are intermediates, not part of the canonical iconset
    rm -f "$ICONSET/icon_64x64.png" "$ICONSET/icon_1024x1024.png"
    iconutil -c icns "$ICONSET" -o "$APP_PATH/Contents/Resources/AppIcon.icns"
  else
    echo "  (qlmanage did not produce a PNG — bundle will use the default icon)"
  fi
  rm -rf "$TMPDIR_RENDER"
else
  echo "  (skipping icon generation — missing one of: favicon.svg, qlmanage, sips, iconutil)"
fi
rm -rf "$(dirname "$ICONSET")"

# ── 5. Ad-hoc sign so Gatekeeper allows it to launch ─────────────────────
# Unsigned .app bundles get blocked on first run with "cannot be opened"
# on modern macOS. An ad-hoc signature (identity '-') is enough for a
# locally-built launcher.
if command -v codesign >/dev/null 2>&1; then
  # Strip resource forks / Finder xattrs that qlmanage + tempdir IO leave
  # behind; codesign refuses to operate when those are present.
  xattr -cr "$APP_PATH" 2>/dev/null || true
  codesign --force --deep --sign - "$APP_PATH" >/dev/null 2>&1 || true
fi

# Bust Finder/LaunchServices icon cache so the new icon shows up right away.
touch "$APP_PATH"

echo
echo "✓ Built $APP_PATH"
echo "  Double-click it on the Desktop to launch Kayenta Explorer."
