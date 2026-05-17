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
  kill "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
  rm -f "$DIR/.vite.log" "$DIR/server/.port"
  exit
}
trap cleanup INT TERM
wait
