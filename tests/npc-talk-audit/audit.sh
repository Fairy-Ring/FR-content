#!/usr/bin/env bash
set -euo pipefail

USAGE='Usage: bash tests/npc-talk-audit/audit.sh <engine-dir> <output-dir> [content-root]'
ENGINE="$(cd "${1:?$USAGE}" && pwd)"
OUTPUT_DIR="${2:?$USAGE}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTENT_ROOT="${3:-$(cd "$HERE/../.." && pwd)}"

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

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
CONTENT_ROOT="$(cd "$CONTENT_ROOT" && pwd)"
cd "$ENGINE"
TSX_TSCONFIG_PATH="$ENGINE/tsconfig.json" NODE_XPRATE=1 NODE_MEMBERS=true node --import tsx "$HERE/audit-bootstrap.mts" "$CONTENT_ROOT" "$OUTPUT_DIR"
