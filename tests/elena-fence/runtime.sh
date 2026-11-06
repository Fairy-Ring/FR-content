#!/usr/bin/env bash
# Run after a full build of the matching isolated engine. Starts no server.
set -euo pipefail
ENGINE="${1:?Usage: bash tests/elena-fence/runtime.sh /absolute/path/to/engine}"
ENGINE="$(cd "$ENGINE" && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d "$ENGINE/.elena-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
cp "$HERE/bootstrap.mts" "$HERE/runtime.mts" "$TMP/"
cd "$ENGINE"
NODE_XPRATE=1 NODE_MEMBERS=true node --import tsx "$TMP/bootstrap.mts"
