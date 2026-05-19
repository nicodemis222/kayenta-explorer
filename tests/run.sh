#!/usr/bin/env bash
# Master E2E test runner for Kayenta Explorer.
#
# Behavior:
#   - If the app is already running (server/.port exists and is alive), use it
#     and DO NOT shut it down at the end.
#   - Otherwise, boot via start.sh in the background, wait for both API and
#     Vite to be ready, run both test suites, then shut down the launcher
#     we started (idempotent — leaves a pre-existing dev session alone).
#
# Exit code: non-zero if any test fails.

set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$DIR"

STARTED_BY_US=0

# 1. Boot if needed
if [ -s server/.port ] && [ -s server/.api.pid ] \
   && kill -0 "$(cat server/.api.pid)" 2>/dev/null \
   && [ -s .vite.log ] \
   && grep -qE 'Local:\s+http://localhost:[0-9]+' .vite.log; then
  echo "→ Using existing dev session (API on :$(cat server/.port))"
else
  echo "→ Booting app via start.sh for the test run…"
  nohup bash ./start.sh > .tests-launcher.log 2>&1 &
  STARTED_BY_US=1
  # Wait up to 30s for both .port and .vite.log Local: line.
  for _ in $(seq 1 60); do
    if [ -s server/.port ] && grep -qE 'Local:\s+http://localhost:[0-9]+' .vite.log 2>/dev/null; then
      break
    fi
    sleep 0.5
  done
  if ! [ -s server/.port ] || ! grep -qE 'Local:\s+http://localhost:[0-9]+' .vite.log 2>/dev/null; then
    echo "✗ Boot failed — last 20 lines of launcher log:" >&2
    tail -20 .tests-launcher.log >&2
    exit 2
  fi
  echo "  API on :$(cat server/.port)  |  Web on $(grep -oE 'Local:\s+http://localhost:[0-9]+' .vite.log | tail -1)"
fi

cleanup() {
  if [ "$STARTED_BY_US" = "1" ]; then
    echo ""
    echo "→ Shutting down the session we started…"
    PORT=$(cat server/.port 2>/dev/null || echo "")
    [ -n "$PORT" ] && curl -sS -X POST "http://localhost:$PORT/api/shutdown" --max-time 5 > /dev/null 2>&1 || true
    sleep 2
    rm -f .tests-launcher.log
  fi
}
trap cleanup EXIT

# 2. Run API suite
echo ""
echo "════════════════════════════════════════════════════"
echo " API + contract + data-integrity tests"
echo "════════════════════════════════════════════════════"
node --test --test-reporter=spec tests/api.test.mjs
API_RC=$?

# 3. Run UI suite
echo ""
echo "════════════════════════════════════════════════════"
echo " UI + accessibility + performance tests (Playwright)"
echo "════════════════════════════════════════════════════"
node --test --test-reporter=spec tests/ui.test.mjs
UI_RC=$?

# 4. Summary
echo ""
echo "════════════════════════════════════════════════════"
if [ $API_RC -eq 0 ] && [ $UI_RC -eq 0 ]; then
  echo " ✓ All suites passed"
else
  echo " ✗ Failures — API rc=$API_RC, UI rc=$UI_RC"
fi
echo "════════════════════════════════════════════════════"

exit $(( API_RC | UI_RC ))
