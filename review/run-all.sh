#!/usr/bin/env bash
# Run every repro / check script against the board in the repo root (or BOARD_ROOT if set).
# Needs node + the preinstalled Playwright/Chromium and python3 (for http.server).
cd "$(dirname "$0")"
for f in repro-*.js check-*.js; do
  echo "=== $f"
  timeout 180 node "$f" 2>&1 | grep -v "^page errors: \[\] \[\]$"
done
echo "=== sim-fairness.js (line maker, ${BOARD_ROOT:-..}/lines.js)"
OK=1 node sim-fairness.js "${BOARD_ROOT:-..}/lines.js"
