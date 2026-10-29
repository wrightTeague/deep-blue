#!/usr/bin/env bash
# Apply suggested-fixes.diff to a temporary copy of the board and run every script against it.
# With the fixes in, each finding they cover should print "not reproduced".
set -e
cd "$(dirname "$0")"
tmp=$(mktemp -d)
cp ../index.html ../app.js ../lines.js ../ascii.js ../ocean.js ../styles.css ../supabase.js ../version.json "$tmp"/
(cd "$tmp" && patch -p1 --quiet < "$OLDPWD/suggested-fixes.diff")
echo "patched copy: $tmp"
BOARD_ROOT="$tmp" ./run-all.sh
