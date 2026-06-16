#!/usr/bin/env bash
# Self-bootstrapping run entrypoint for Kayenta Explorer.
#
# Ensures everything the app needs is present, then starts it and opens the
# dashboard. Idempotent — safe to run on every launch. This is what makes the
# app distributable as a DMG: a fresh machine that only has Node installed can
# run it cold and it sets itself up.
#
# It guarantees, in order:
#   1. A writable run directory (the source bundled inside a .app/DMG is
#      read-only, so we sync it into ~/Library/Application Support and run
#      there; a writable dev checkout runs in place).
#   2. Node + npm exist (clear notification if not).
#   3. server/ + client/ dependencies are installed (re-installed when the
#      bundled package-locks change).
#   4. The client production build (client/dist) exists.
#   5. Playwright Chromium is installed (the scrapers need it).
# Then it launches start.sh and opens the browser at the chosen port.
#
# SRC_DIR = the directory holding this script. KAYENTA_BUNDLED=1 (set by the
# packaged .app) forces the writable-copy path.
set -u

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Finder-launched apps inherit a minimal PATH — add the usual Node locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
# A packaged DMG ships its own Node runtime as a sibling of the bundled source
# (Contents/Resources/node), so the app needs NO system Node. Prefer it —
# prepend so it wins even if an (older/newer) system Node is also present.
if [ -x "$SRC_DIR/../node/bin/node" ]; then
  export PATH="$(cd "$SRC_DIR/../node/bin" && pwd):$PATH"
fi

notify() { /usr/bin/osascript -e "display notification \"$1\" with title \"Kayenta Explorer\"" >/dev/null 2>&1 || true; }

# ── 1. Writable run directory ────────────────────────────────────────────
if [ "${KAYENTA_BUNDLED:-0}" = "1" ] || [ ! -w "$SRC_DIR" ]; then
  RUN_DIR="$HOME/Library/Application Support/Kayenta Explorer"
else
  RUN_DIR="$SRC_DIR"
fi
mkdir -p "$RUN_DIR" 2>/dev/null || true
LOG_FILE="$RUN_DIR/.launcher.log"

# Open the dashboard at a port (always IPv4 — matches how start.sh binds Vite).
resolve_web_port() {
  if [ -s "$RUN_DIR/.web.port" ]; then cat "$RUN_DIR/.web.port"; return; fi
  if [ -s "$RUN_DIR/.vite.log" ]; then
    local p
    p=$(grep -oE 'http://(localhost|127\.0\.0\.1):[0-9]+' "$RUN_DIR/.vite.log" 2>/dev/null | tail -1 | grep -oE '[0-9]+$')
    [ -n "$p" ] && { echo "$p"; return; }
  fi
  echo ""
}
open_dashboard() {
  local port="$1"
  [ -z "$port" ] && { notify "Couldn't determine the dashboard port — see .launcher.log"; return; }
  local url="http://127.0.0.1:$port/"
  /usr/bin/osascript -e "open location \"$url\"" >/dev/null 2>&1 \
    || /usr/bin/open "$url" \
    || /usr/bin/open -a "Safari" "$url" 2>/dev/null || true
}

{
  echo "=== bootstrap $(date) — src=$SRC_DIR run=$RUN_DIR bundled=${KAYENTA_BUNDLED:-0} ==="
  echo "node: $(command -v node 2>/dev/null || echo none) ($(node --version 2>/dev/null || echo n/a))"

  # ── 2. Node / npm present? ─────────────────────────────────────────────
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    notify "Node.js is required. Install it from nodejs.org, then reopen Kayenta Explorer."
    echo "ERROR: node/npm not on PATH ($PATH)" >&2
    exit 1
  fi

  # ── 3. Sync bundled source into the writable run dir ───────────────────
  # node_modules, the SQLite DB, and runtime dotfiles live only in RUN_DIR and
  # are excluded so an app update can't wipe them. (No --delete: additive.)
  if [ "$RUN_DIR" != "$SRC_DIR" ]; then
    # Exclude *.log so the sync can't clobber the .launcher.log we're writing
    # to right now (replacing the file mid-run would orphan our open fd).
    rsync -a \
      --exclude '.git' --exclude 'node_modules' --exclude 'server/data' \
      --exclude '*.log' --exclude '.web.port' --exclude '.launcher.pid' \
      --exclude 'server/.port' --exclude 'server/.api.pid' --exclude '.deps-stamp' \
      "$SRC_DIR"/ "$RUN_DIR"/ || { notify "Setup failed copying app files — see .launcher.log"; exit 1; }
  fi

  cd "$RUN_DIR" || { notify "cd failed: $RUN_DIR"; exit 1; }

  # ── 4. Already running? Just open the browser. ─────────────────────────
  if [ -s server/.port ] && [ -s server/.api.pid ]; then
    PORT=$(cat server/.port); OUR_PID=$(cat server/.api.pid)
    LIVE=$(lsof -ti:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)
    if kill -0 "$OUR_PID" 2>/dev/null && [ -n "$LIVE" ] && [ "$LIVE" = "$OUR_PID" ]; then
      notify "Already running — opening dashboard."
      open_dashboard "$(resolve_web_port)"
      exit 0
    fi
  fi

  # ── 5. Dependencies — install on first run or when package-locks change ─
  # Install when node_modules are missing, OR when a PREVIOUS stamp exists and
  # no longer matches the current locks (an update changed deps). A missing
  # stamp with deps already present (e.g. existing dev checkout) does NOT force
  # a reinstall — we just record the stamp.
  DEPS_HASH=$(cat server/package-lock.json client/package-lock.json 2>/dev/null | shasum 2>/dev/null | awk '{print $1}')
  NEED_INSTALL=0
  if [ ! -d server/node_modules ] || [ ! -d client/node_modules ]; then
    NEED_INSTALL=1
  elif [ -f .deps-stamp ] && [ -n "$DEPS_HASH" ] && [ "$(cat .deps-stamp 2>/dev/null)" != "$DEPS_HASH" ]; then
    NEED_INSTALL=1
  fi
  if [ "$NEED_INSTALL" = "1" ]; then
    notify "First-run setup — installing dependencies (this can take a few minutes)…"
    # --legacy-peer-deps: the client devDeps (ESLint 9 + its plugins) have a
    # peer-range conflict that a strict resolver rejects; the app's runtime
    # deps (vite, react) install fine under it. Applied to both for robustness.
    ( cd server && npm install --no-audit --no-fund --legacy-peer-deps ) \
      || { notify "Setup failed installing server dependencies — see .launcher.log"; exit 1; }
    ( cd client && npm install --no-audit --no-fund --legacy-peer-deps ) \
      || { notify "Setup failed installing client dependencies — see .launcher.log"; exit 1; }
    SETUP_RAN=1
  fi
  # Record current locks so a later dependency change is detected.
  [ -n "$DEPS_HASH" ] && echo "$DEPS_HASH" > .deps-stamp 2>/dev/null || true

  # ── 6. Client production build ─────────────────────────────────────────
  if [ ! -f client/dist/index.html ]; then
    notify "First-run setup — building the dashboard…"
    ( cd client && npx vite build ) || true
  fi

  # ── 7. Playwright Chromium (the scrapers need it) ──────────────────────
  if ! ls "$HOME/Library/Caches/ms-playwright"/chromium* >/dev/null 2>&1; then
    notify "First-run setup — installing the headless browser…"
    ( cd server && npx playwright install chromium ) || true
  fi

  [ "${SETUP_RAN:-0}" = "1" ] && notify "Setup complete — starting Kayenta Explorer…"

  # ── 8. Launch + open the dashboard ─────────────────────────────────────
  notify "Starting Kayenta Explorer…"
  nohup bash "$RUN_DIR/start.sh" >> "$LOG_FILE" 2>&1 &
  disown || true

  # Poll for the definitive .web.port (start.sh writes it once Vite answers).
  for _ in $(seq 1 120); do
    if [ -s "$RUN_DIR/.web.port" ]; then
      open_dashboard "$(resolve_web_port)"
      notify "Kayenta Explorer is running."
      exit 0
    fi
    sleep 0.5
  done
  notify "Startup taking longer than expected — see .launcher.log"
  open_dashboard "$(resolve_web_port)"
} >> "$LOG_FILE" 2>&1
