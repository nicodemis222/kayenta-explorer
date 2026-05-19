#!/bin/bash
# Kayenta Explorer — start both server and client with dynamic port handling.
#
# Port-selection model:
#   1. The server scans up from $PORT (default 3001) and writes the actual
#      bound port to server/.port AFTER it's listening.
#   2. We wait for server/.port, then pass that value as KAYENTA_API_PORT to
#      Vite. This avoids a race where lsof says a port is free but another
#      process grabs it between the check and the actual bind.
#   3. Vite runs with strictPort:false, so it auto-bumps if its preferred web
#      port is taken. We parse its stdout for the actual chosen URL.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$DIR/.env" ]; then
  export $(grep -v '^#' "$DIR/.env" | xargs)
fi

WEB_PORT_PREF="${KAYENTA_WEB_PORT:-3000}"
API_PORT_PREF="${PORT:-3001}"

echo "Starting Kayenta Explorer..."
echo ""

# Clear any stale .port file from a previous run so we don't read it by mistake.
rm -f "$DIR/server/.port"

# Write our own PID to .launcher.pid so the in-app Shut Down button can SIGTERM
# us (which triggers the cleanup trap below, killing both server AND client).
# Without this the Shut Down button can only kill the API process and leaves
# the Vite dev server (and its esbuild helper) running.
LAUNCHER_PID_FILE="$DIR/.launcher.pid"
echo "$$" > "$LAUNCHER_PID_FILE"

# Start API server. It will scan up from $PORT for the first free port and
# write the actual bound port to server/.port once listening.
echo "Starting API server (preferred :$API_PORT_PREF)..."
cd "$DIR/server"
PORT="$API_PORT_PREF" node src/index.js &
SERVER_PID=$!

# Wait for server/.port to appear (server writes it after bind succeeds).
# Cap the wait so we surface a clear error instead of hanging forever.
WAIT=0
while [ ! -s "$DIR/server/.port" ] && [ $WAIT -lt 30 ]; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "ERROR: API server exited before binding a port" >&2
    exit 1
  fi
  sleep 0.5
  WAIT=$((WAIT + 1))
done
if [ ! -s "$DIR/server/.port" ]; then
  echo "ERROR: API server did not write server/.port within 15s" >&2
  kill "$SERVER_PID" 2>/dev/null || true
  exit 1
fi

API_PORT=$(cat "$DIR/server/.port")
if [ "$API_PORT" != "$API_PORT_PREF" ]; then
  echo "Note: API port $API_PORT_PREF was in use — API is on $API_PORT"
fi

# Start Vite. strictPort:false in vite.config.js lets it auto-bump the web
# port. KAYENTA_API_PORT must be the *actual* server port so the proxy works
# even after a bump.
echo "Starting React client (preferred :$WEB_PORT_PREF)..."
cd "$DIR/client"
VITE_LOG="$DIR/.vite.log"
: > "$VITE_LOG"
KAYENTA_API_PORT="$API_PORT" KAYENTA_WEB_PORT="$WEB_PORT_PREF" \
  npx vite --port "$WEB_PORT_PREF" 2>&1 | tee "$VITE_LOG" &
CLIENT_PID=$!

# Vite prints `  ➜  Local:   http://localhost:NNNN/` once ready. Parse the
# actual port from that line so the banner reflects reality even if Vite
# bumped to a different port.
WEB_PORT=""
WAIT=0
while [ -z "$WEB_PORT" ] && [ $WAIT -lt 40 ]; do
  WEB_PORT=$(grep -oE 'Local:[[:space:]]+http://localhost:[0-9]+' "$VITE_LOG" 2>/dev/null \
    | head -1 | grep -oE '[0-9]+$')
  if [ -z "$WEB_PORT" ]; then
    sleep 0.5
    WAIT=$((WAIT + 1))
  fi
done
WEB_PORT="${WEB_PORT:-$WEB_PORT_PREF}"
if [ "$WEB_PORT" != "$WEB_PORT_PREF" ]; then
  echo "Note: web port $WEB_PORT_PREF was in use — web is on $WEB_PORT"
fi

echo ""
echo "  Dashboard: http://localhost:$WEB_PORT"
echo "  API:       http://localhost:$API_PORT"
echo ""
echo "Press Ctrl+C to stop both servers."

cleanup() {
  # Send SIGTERM to the direct children first.
  kill "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
  # Give the API server a moment to flush its own cleanup (Chromium close,
  # DB close, .port unlink) before we hammer the rest of the tree.
  sleep 0.5

  # `npm exec vite` becomes the CLIENT_PID we know about, but the real
  # `vite` and `esbuild` processes are grandchildren that don't always die
  # when npm dies. Walk the tree under both children and kill every node.
  kill_tree() {
    local root=$1
    [ -z "$root" ] && return
    # Collect every descendant via pgrep -P chains. Pre-order so children
    # are queued before we kill the parent (avoids reparenting to init).
    local pids=("$root")
    local i=0
    while [ $i -lt ${#pids[@]} ]; do
      local children
      children=$(pgrep -P "${pids[$i]}" 2>/dev/null || true)
      for c in $children; do pids+=("$c"); done
      i=$((i + 1))
    done
    # Kill in reverse so leaves go first.
    for ((j=${#pids[@]}-1; j>=0; j--)); do
      kill "${pids[$j]}" 2>/dev/null || true
    done
  }
  kill_tree "$SERVER_PID"
  kill_tree "$CLIENT_PID"

  # Final sweep: any vite or esbuild process still bound to this project's
  # client/node_modules/.bin path. Belt-and-suspenders for the rare case
  # where vite double-forks or reparents.
  pkill -f "$DIR/client/node_modules/.bin/vite"                   2>/dev/null || true
  pkill -f "$DIR/client/node_modules/@esbuild/.*/bin/esbuild"     2>/dev/null || true

  rm -f "$DIR/.vite.log" "$DIR/server/.port" "$LAUNCHER_PID_FILE"
  exit
}
trap cleanup INT TERM
wait
