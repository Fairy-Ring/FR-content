#!/usr/bin/env bash
set -euo pipefail

ENGINE="$(cd "${1:?usage: runtime.sh <engine-dir> [runtime arguments...]}" && pwd)"
shift
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK_DIR="${SKILL_MENU_PACK_DIR:-$ENGINE/data/pack}"
if [[ "$PACK_DIR" != /* ]]; then
  PACK_DIR="$ENGINE/$PACK_DIR"
fi
if [[ ! -f "$PACK_DIR/server/script.dat" ]]; then
  printf 'missing packed server scripts: %s\n' "$PACK_DIR/server/script.dat" >&2
  exit 1
fi
export SKILL_MENU_PACK_DIR="$(cd "$PACK_DIR" && pwd)"
TMP="$(mktemp -d "$ENGINE/.skill-menu-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
cp "$HERE/bootstrap.mts" "$HERE/runtime.mts" "$TMP/"
cd "$ENGINE"
NODE_XPRATE=1 NODE_MEMBERS=true node --import tsx "$TMP/bootstrap.mts" "$@"
