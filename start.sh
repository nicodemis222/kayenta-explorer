#!/bin/bash
# Kayenta Explorer — Start both server and client

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load .env if it exists
if [ -f "$DIR/.env" ]; then
  export $(grep -v '^#' "$DIR/.env" | xargs)
fi

echo "Starting Kayenta Explorer..."
echo ""

# Start server
echo "Starting API server on :3001..."
cd "$DIR/server"
node src/index.js &
SERVER_PID=$!

# Start client dev server
echo "Starting React client on :3000..."
cd "$DIR/client"
npx vite --port 3000 &
CLIENT_PID=$!

echo ""
echo "  Dashboard: http://localhost:3000"
echo "  API:       http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $SERVER_PID $CLIENT_PID 2>/dev/null; exit" INT TERM
wait
