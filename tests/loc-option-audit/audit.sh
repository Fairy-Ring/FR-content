#!/usr/bin/env bash
set -euo pipefail
USAGE='Usage: bash tests/loc-option-audit/audit.sh <engine-dir> <existing-output-dir> [content-root]'
ENGINE="$(cd "${1:?$USAGE}" && pwd)"
OUTPUT="$(cd "${2:?$USAGE}" && pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTENT="$(cd "${3:-$HERE/../..}" && pwd)"
[[ -f "$ENGINE/tsconfig.json" && -f "$ENGINE/data/pack/server/loc.dat" && -f "$ENGINE/data/pack/client/config" ]] || { echo 'A built engine pack is required' >&2; exit 1; }
cd "$ENGINE"
TSX_TSCONFIG_PATH="$ENGINE/tsconfig.json" NODE_PRODUCTION=true NODE_XPRATE=1 NODE_MEMBERS=true node --import tsx "$HERE/audit-bootstrap.mts" "$CONTENT" "$OUTPUT"
