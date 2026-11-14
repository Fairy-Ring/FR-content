#!/usr/bin/env bash
# Run against the matching full build. Starts no server and modifies no live world.
set -euo pipefail
ENGINE="${1:?Usage: bash tests/desert-treasure/s5_death_runtime.sh /absolute/path/to/engine}"
ENGINE="$(cd "$ENGINE" && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d "$ENGINE/.dt-s5-death-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
cp "$HERE/s5_death_bootstrap.mts" "$HERE/s5_death_runtime.mts" "$TMP/"
cd "$ENGINE"
NODE_XPRATE=1 NODE_MEMBERS=true node --import tsx "$TMP/s5_death_bootstrap.mts"
