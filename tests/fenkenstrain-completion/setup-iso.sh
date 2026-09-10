#!/usr/bin/env bash
# Isolated compiler/engine layout for CoF handler tests.
# Informed by sibling .worktrees/r377-fenkenstrain-content/.tmp/fenk-iso-compile-r422
# but does NOT copy RSA keys or write shared vendor/content/pack.
set -euo pipefail
WT="$(cd "$(dirname "$0")/../.." && pwd)"
ISO="${WT}/.tmp/fenk-iso-compile-r422"
SIBLING="/Users/acfrazier/experiments/FR-vault/.worktrees/r377-fenkenstrain-content/.tmp/fenk-iso-compile-r422"

mkdir -p "${ISO}"

if [[ ! -d "${SIBLING}/engine" || ! -d "${SIBLING}/content" ]]; then
  echo "error: sibling ISO layout missing at ${SIBLING}" >&2
  exit 2
fi

echo "rsync sibling ISO engine (exclude pems/sqlite)"
rsync -a --delete \
  --exclude 'data/config/*.pem' \
  --exclude 'db.sqlite' \
  "${SIBLING}/engine/" "${ISO}/engine/"

echo "rsync sibling ISO content then overlay exclusive CoF + teleport hook"
rsync -a --delete "${SIBLING}/content/" "${ISO}/content/"
rsync -a "${WT}/scripts/quests/quest_creatureoffenkenstrain/" \
  "${ISO}/content/scripts/quests/quest_creatureoffenkenstrain/"
cp "${WT}/scripts/skill_magic/scripts/spells/teleport.rs2" \
  "${ISO}/content/scripts/skill_magic/scripts/spells/teleport.rs2"

mkdir -p "${ISO}/engine/data/config"
if [[ ! -f "${ISO}/engine/data/config/private.pem" ]]; then
  echo "generate isolated RSA keys (not copied)"
  openssl genrsa -out "${ISO}/engine/data/config/private.pem" 1024 2>/dev/null
  openssl rsa -in "${ISO}/engine/data/config/private.pem" -pubout -out "${ISO}/engine/data/config/public.pem" 2>/dev/null
fi

cp "${SIBLING}/compile-isolated.mjs" "${ISO}/compile-isolated.mjs"
cp "${SIBLING}/pack-server-configs.mjs" "${ISO}/pack-server-configs.mjs"

echo "compile scripts BUILD_SRC_DIR=${ISO}/content"
(
  cd "${ISO}/engine"
  BUILD_SRC_DIR="${ISO}/content" npx tsx "${ISO}/compile-isolated.mjs"
)

echo "ISO_SETUP_OK ${ISO}"
