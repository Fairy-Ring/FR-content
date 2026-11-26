#!/usr/bin/env bash
# Run from any directory after a full build of the matching isolated engine.
set -euo pipefail
ENGINE="${1:?Usage: bash tests/fletching-choice/runtime.sh /absolute/path/to/engine}"
ENGINE="$(cd "$ENGINE" && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d "$ENGINE/.fletching-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
cp "$HERE/bootstrap.mts" "$HERE/runtime.mts" "$TMP/"
cd "$ENGINE"
NODE_XPRATE=1 NODE_MEMBERS=true node --import tsx "$TMP/bootstrap.mts" \
  "$HERE/../../scripts/skill_cooking/configs/cooking_source/cooking_generic.dbrow" \
  "$HERE/../../scripts/quests/quest_swansong/configs/swan_cooking.dbrow"
