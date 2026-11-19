#!/usr/bin/env bash
set -euo pipefail
USAGE='Usage: bash tests/loc-option-audit/runtime.sh <engine-dir>'
ENGINE="$(cd "${1:?$USAGE}" && pwd)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$ENGINE/tsconfig.json" && -f "$ENGINE/data/pack/server/loc.dat" && -f "$ENGINE/data/pack/client/config" ]] || { echo 'A built engine pack is required' >&2; exit 1; }
cd "$ENGINE"
TSX_TSCONFIG_PATH="$ENGINE/tsconfig.json" NODE_PRODUCTION=true NODE_XPRATE=1 NODE_MEMBERS=true node --import tsx "$HERE/runtime-bootstrap.mts"
