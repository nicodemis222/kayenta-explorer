#!/bin/bash
# Kayenta Explorer — Start both server and client.
# Picks free ports if 3001 (API) or 3000 (web) are taken by another process.

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load .env if it exists
if [ -f "$DIR/.env" ]; then
  export $(grep -v '^#' "$DIR/.env" | xargs)
fi

# Find the first free port at or above $1.
find_free_port() {
  local port=$1
  local max=$((port + 20))
  while [ $port -lt $max ]; do
    if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "$port"
      return 0
    fi
    port=$((port + 1))
  done
  echo "ERROR: no free port near $1" >&2
  exit 1
}

WEB_PORT_PREF="${KAYENTA_WEB_PORT:-3000}"
API_PORT_PREF="${PORT:-3001}"

WEB_PORT=$(find_free_port "$WEB_PORT_PREF")
API_PORT=$(find_free_port "$API_PORT_PREF")

if [ "$WEB_PORT" != "$WEB_PORT_PREF" ]; then
  echo "Note: web port $WEB_PORT_PREF in use — using $WEB_PORT"
fi
if [ "$API_PORT" != "$API_PORT_PREF" ]; then
  echo "Note: API port $API_PORT_PREF in use — using $API_PORT"
fi

echo "Starting Kayenta Explorer..."
echo ""

# Start server with chosen API port
echo "Starting API server on :$API_PORT..."
cd "$DIR/server"
PORT="$API_PORT" node src/index.js &
SERVER_PID=$!

# Give the server a moment to write its .port file (so Vite's proxy reads the right value)
sleep 1

# Start client; Vite will read server/.port to set the API proxy target
echo "Starting React client on :$WEB_PORT..."
cd "$DIR/client"
KAYENTA_API_PORT="$API_PORT" KAYENTA_WEB_PORT="$WEB_PORT" npx vite --port "$WEB_PORT" &
CLIENT_PID=$!

echo ""
echo "  Dashboard: http://localhost:$WEB_PORT"
echo "  API:       http://localhost:$API_PORT"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $SERVER_PID $CLIENT_PID 2>/dev/null; exit" INT TERM
wait
