#!/usr/bin/env bash
# Compile (optional) and execute Salve melee helpers against the SUPPORT engine.
# Usage:
#   HM_SALVE_ENGINE_DIR=/path/to/engine-worktree tests/run-hm-salve-runtime.sh
#   tests/run-hm-salve-runtime.sh /path/to/engine-worktree
# Env:
#   HM_SALVE_ENGINE_DIR  SUPPORT engine worktree (required unless argv1)
#   HM_SALVE_CONTENT_DIR content worktree (defaults to repo root of this script)
#   HM_SALVE_SKIP_COMPILE=1  skip scripts-only compile
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTENT_DIR="${HM_SALVE_CONTENT_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
ENGINE_DIR="${1:-${HM_SALVE_ENGINE_DIR:-}}"

if [[ -z "${ENGINE_DIR}" ]]; then
  echo "error: pass SUPPORT engine path or set HM_SALVE_ENGINE_DIR" >&2
  exit 2
fi
if [[ ! -d "${ENGINE_DIR}" ]]; then
  echo "error: engine dir not found: ${ENGINE_DIR}" >&2
  exit 2
fi
if [[ ! -f "${ENGINE_DIR}/tools/compile-scripts-only.ts" ]]; then
  echo "error: not an engine worktree (missing tools/compile-scripts-only.ts): ${ENGINE_DIR}" >&2
  exit 2
fi

ENGINE_DIR="$(cd "${ENGINE_DIR}" && pwd)"
TMP_DIR="${ENGINE_DIR}/.tmp"
mkdir -p "${TMP_DIR}"

if [[ "${HM_SALVE_SKIP_COMPILE:-}" != "1" ]]; then
  # CompileServerScript also scans ../content/scripts independently of BUILD_SRC_DIR.
  # Fail visibly instead of compiling a different worktree or relying on hidden setup.
  if [[ ! -d "${ENGINE_DIR}/../content/scripts" ]] ||
     [[ "$(cd "${ENGINE_DIR}/../content/scripts" && pwd -P)" != "$(cd "${CONTENT_DIR}/scripts" && pwd -P)" ]]; then
    echo "error: compiler sibling ../content/scripts must resolve to ${CONTENT_DIR}/scripts; arrange the isolated engine/content layout before compiling" >&2
    exit 2
  fi
  echo "compile: cwd=${ENGINE_DIR} BUILD_SRC_DIR=${CONTENT_DIR}"
  (
    cd "${ENGINE_DIR}"
    BUILD_SRC_DIR="${CONTENT_DIR}" npx tsx tools/compile-scripts-only.ts
  )
fi

cp "${SCRIPT_DIR}/hm-salve-runtime.mts" "${TMP_DIR}/hm-salve-runtime.mts"
cp "${SCRIPT_DIR}/hm-salve-runtime-body.mts" "${TMP_DIR}/hm-salve-runtime-body.mts"
echo "execute: ${TMP_DIR}/hm-salve-runtime.mts"
(
  cd "${ENGINE_DIR}"
  ./node_modules/.bin/tsx "${TMP_DIR}/hm-salve-runtime.mts"
)
