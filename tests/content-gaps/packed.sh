#!/usr/bin/env bash
# Run after a full build of the matching isolated engine. No server is started.
set -euo pipefail
ENGINE="${1:?Usage: bash tests/content-gaps/packed.sh /absolute/path/to/engine}"
ENGINE="$(cd "$ENGINE" && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d "$ENGINE/.content-gaps-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
cp "$HERE/bootstrap.mts" "$HERE/packed.mts" "$TMP/"
cd "$ENGINE"
NODE_MEMBERS=true node --import tsx "$TMP/bootstrap.mts"
