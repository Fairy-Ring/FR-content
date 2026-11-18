#!/usr/bin/env bash
set -euo pipefail

USAGE='Usage: bash tests/npc-talk-audit/runtime.sh <engine-dir> [content-root]'
ENGINE="$(cd "${1:?$USAGE}" && pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTENT_ROOT="${2:-$(cd "$HERE/../.." && pwd)}"

if [[ ! -f "$ENGINE/tsconfig.json" ]]; then
  printf 'missing engine TypeScript config: %s/tsconfig.json\n' "$ENGINE" >&2
  exit 1
fi
if [[ ! -f "$ENGINE/data/pack/server/npc.dat" ]]; then
  printf 'missing built server NPC pack: %s/data/pack/server/npc.dat\n' "$ENGINE" >&2
  exit 1
fi
if [[ ! -d "$CONTENT_ROOT/maps" ]]; then
  printf 'missing content maps directory: %s/maps\n' "$CONTENT_ROOT" >&2
  exit 1
fi

CONTENT_ROOT="$(cd "$CONTENT_ROOT" && pwd)"
cd "$ENGINE"
TSX_TSCONFIG_PATH="$ENGINE/tsconfig.json" NODE_PRODUCTION=true NODE_XPRATE=1 NODE_MEMBERS=true node --import tsx "$HERE/runtime-bootstrap.mts" "$CONTENT_ROOT"
