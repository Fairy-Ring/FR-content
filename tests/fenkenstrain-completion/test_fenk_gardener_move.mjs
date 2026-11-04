/**
 * Engine movement proof for CoF gardener follower (R3 blocker + root reclaim).
 *
 * Requirements (orch 17:00):
 * - allocate a deterministic engine collision area (no live World/services)
 * - put follower + multi on valid unblocked tiles
 * - enqueue reachable waypoint
 * - execute real Npc.updateMovement (no monkeypatch of updateMovement/processMovement/canTravel)
 * - assert follower coordinate CHANGES toward waypoint
 * - assert multi coordinate does NOT change
 * - exceptions must FAIL (never OK-on-throw / OK-on-unchanged)
 *
 * Prerequisite: npm run build in the stopped sibling engine.
 *
 * Run from that engine directory:
 *   node --import tsx ../content/tests/fenkenstrain-completion/test_fenk_gardener_move.mjs
 *
 * Does NOT touch shared live packs. Not a live client proof.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ISO_ENGINE = process.env.HARNESS_ENGINE_DIR ?? path.resolve(WT, '../engine');
const PACK_DIR = path.join(ISO_ENGINE, 'data/pack');
const NPC_DAT = path.join(PACK_DIR, 'server/npc.dat');

function fail(msg) {
  console.error('FAIL', msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log('OK', msg);
}

function assert(cond, msg) {
  if (!cond) {
    fail(msg);
    throw new Error(msg);
  }
}

if (!fs.existsSync(NPC_DAT)) {
  fail(`missing compiled npc.dat at ${NPC_DAT} — run npm run build in the sibling engine`);
  process.exit(1);
}

// Import World first (engine circular dependency order; root probe recipe).
const eng = (rel) => import(pathToFileURL(path.join(ISO_ENGINE, rel)).href);

const WorldMod = await eng('src/engine/World.ts');
const World = WorldMod.default;
const { allocateIfAbsent, canTravel, CollisionType, CollisionFlag } = await eng(
  'src/engine/routefinder/index.ts'
);
const { default: NpcType } = await eng('src/cache/config/NpcType.ts');
const { default: VarNpcType } = await eng('src/cache/config/VarNpcType.ts');
const { MoveRestrict } = await eng('src/engine/entity/MoveRestrict.js');
const { MoveSpeed } = await eng('src/engine/entity/MoveSpeed.js');
const { BlockWalk } = await eng('src/engine/entity/BlockWalk.js');
const { EntityLifeCycle } = await eng('src/engine/entity/EntityLifeCycle.js');
const { default: Npc } = await eng('src/engine/entity/Npc.ts');

VarNpcType.load(PACK_DIR);
NpcType.load(PACK_DIR);

const packNpc = fs.readFileSync(path.join(WT, 'pack/npc.pack'), 'utf8');
function idOf(name) {
  const m = packNpc.match(new RegExp(`^(\\d+)=${name}$`, 'm'));
  if (!m) throw new Error(`pack/npc.pack missing ${name}`);
  return Number(m[1]);
}

const idFollower = idOf('fenk_gardener');
const idMulti = idOf('fenk_gardener_multi');
const idMulti2 = idOf('fenk_gardener_multi_2');

const tFollower = NpcType.get(idFollower);
const tMulti = NpcType.get(idMulti);
const tMulti2 = NpcType.get(idMulti2);

assert(tFollower && tMulti && tMulti2, 'NpcType.get returned null for gardener types');
ok(
  `loaded types follower=${idFollower} mr=${tFollower.moverestrict} multi=${idMulti} mr=${tMulti.moverestrict} multi2=${idMulti2} mr=${tMulti2.moverestrict}`
);

assert(
  tFollower.moverestrict !== MoveRestrict.NOMOVE,
  'fenk_gardener packed moverestrict is NOMOVE — follower cannot walk'
);
assert(
  tMulti.moverestrict === MoveRestrict.NOMOVE,
  'fenk_gardener_multi packed moverestrict is not NOMOVE — courtyard unpinned'
);
assert(
  tMulti2.moverestrict === MoveRestrict.NOMOVE,
  'fenk_gardener_multi_2 packed moverestrict is not NOMOVE — courtyard unpinned'
);
ok('packed moverestrict: follower mobile, multi parents NOMOVE');

// Deterministic open collision area (no map load, no services).
// Use a quiet mid-zone tile so one-step move stays in-zone (avoids zone leave/enter).
const LEVEL = 0;
const BASE_X = 3200; // zone-aligned-ish interior
const BASE_Z = 3200;
const STEP = 3; // several walk ticks toward waypoint
const DEST_X = BASE_X + STEP;
const DEST_Z = BASE_Z;

// Allocate collision zones covering start, dest, and neighbors.
for (let x = BASE_X - 2; x <= DEST_X + 2; x++) {
  for (let z = BASE_Z - 2; z <= BASE_Z + 2; z++) {
    allocateIfAbsent(x, z, LEVEL);
  }
}
ok(`allocated collision zone tiles around ${BASE_X},${BASE_Z} → ${DEST_X},${DEST_Z}`);

// Prove canTravel is open on the path (real engine canTravel, not stubbed).
for (let i = 0; i < STEP; i++) {
  const x = BASE_X + i;
  const open = canTravel(LEVEL, x, BASE_Z, 1, 0, 1, 0, CollisionType.NORMAL);
  assert(open, `canTravel failed at ${x},${BASE_Z} dx=1 (collision not open)`);
}
ok('canTravel open along follower path');

// Minimal zone stub so refreshZonePresence does not need a live World startup.
// Do NOT monkeypatch updateMovement / processMovement / canTravel.
const originalGameMap = World.gameMap;
const noopZone = { enter() {}, leave() {} };
Object.defineProperty(World, 'gameMap', {
  configurable: true,
  value: {
    getZone: () => noopZone,
    isMulti: () => false,
    isFreeToPlay: () => true
  }
});
World.currentTick = 1;

function makeNpc(typeId, x, z, nid) {
  const t = NpcType.get(typeId);
  const size = t.size ?? 1;
  const block = t.blockwalk ?? BlockWalk.NPC;
  const npc = new Npc(LEVEL, x, z, size, size, EntityLifeCycle.DESPAWN, nid, typeId, block);
  // Match end-of-tick reset baseline so moved = (lastTick ≠ current) is meaningful.
  npc.lastTickX = x;
  npc.lastTickZ = z;
  npc.lastLevel = LEVEL;
  // Default ctor moveSpeed is INSTANT; processMovement no-ops on INSTANT.
  // Live tick path resets to defaultMoveSpeed (WALK) before movement.
  npc.moveSpeed = MoveSpeed.WALK;
  npc.walkDir = -1;
  npc.runDir = -1;
  return npc;
}

try {
  const follower = makeNpc(idFollower, BASE_X, BASE_Z, 1);
  const multi = makeNpc(idMulti2, BASE_X, BASE_Z + 2, 2);

  follower.queueWaypoint(DEST_X, DEST_Z);
  multi.queueWaypoint(DEST_X, DEST_Z + 2);

  // --- Multi parent: NOMOVE short-circuit; position frozen ---
  const multiStart = { x: multi.x, z: multi.z };
  let multiResult;
  try {
    multiResult = multi.updateMovement();
  } catch (e) {
    fail(`multi updateMovement threw: ${e?.stack ?? e}`);
    throw e;
  }
  assert(multiResult === false, `multi updateMovement returned ${multiResult}; expected false (NOMOVE)`);
  assert(
    multi.x === multiStart.x && multi.z === multiStart.z,
    `multi moved under NOMOVE to ${multi.x},${multi.z}`
  );
  ok(`multi parent frozen at ${multi.x},${multi.z} (updateMovement=false)`);

  // --- Follower: must CHANGE coordinates toward waypoint ---
  const fStart = { x: follower.x, z: follower.z };
  let steps = 0;
  const maxSteps = STEP + 2;
  while (steps < maxSteps && (follower.x !== DEST_X || follower.z !== DEST_Z)) {
    // Re-baseline lastTick like a real tick boundary.
    follower.lastTickX = follower.x;
    follower.lastTickZ = follower.z;
    follower.moveSpeed = MoveSpeed.WALK;
    follower.walkDir = -1;
    follower.runDir = -1;
    // Keep waypoint if prior step consumed it early (shouldn't for multi-tile dest).
    if (follower.waypointIndex === -1) {
      follower.queueWaypoint(DEST_X, DEST_Z);
    }
    let moved;
    try {
      moved = follower.updateMovement();
    } catch (e) {
      fail(`follower updateMovement threw on step ${steps}: ${e?.stack ?? e}`);
      throw e;
    }
    steps++;
    if (follower.x === fStart.x && follower.z === fStart.z && steps === 1) {
      // First step must move; unchanged is failure (root reclaim).
      fail(
        `follower did not move on first updateMovement (returned ${moved}) at ${follower.x},${follower.z}; waypointIndex=${follower.waypointIndex}`
      );
      throw new Error('follower non-movement');
    }
    if (!moved && follower.x === fStart.x && follower.z === fStart.z) {
      fail(`follower stuck after ${steps} steps at ${follower.x},${follower.z}`);
      throw new Error('follower stuck');
    }
  }

  assert(
    follower.x !== fStart.x || follower.z !== fStart.z,
    `follower coordinates unchanged after ${steps} steps`
  );
  // Must move toward dest (east, +x).
  assert(follower.x > fStart.x, `follower x ${follower.x} did not increase toward dest ${DEST_X}`);
  assert(follower.z === fStart.z, `follower z drifted unexpectedly to ${follower.z}`);
  ok(
    `follower moved ${fStart.x},${fStart.z} → ${follower.x},${follower.z} toward ${DEST_X},${DEST_Z} in ${steps} updateMovement steps`
  );

  // Multi still frozen after follower movement ticks.
  multi.lastTickX = multi.x;
  multi.lastTickZ = multi.z;
  multi.moveSpeed = MoveSpeed.WALK;
  multi.queueWaypoint(DEST_X, DEST_Z + 2);
  let multi2;
  try {
    multi2 = multi.updateMovement();
  } catch (e) {
    fail(`multi second updateMovement threw: ${e?.stack ?? e}`);
    throw e;
  }
  assert(multi2 === false, `multi second updateMovement returned ${multi2}`);
  assert(
    multi.x === multiStart.x && multi.z === multiStart.z,
    `multi drifted to ${multi.x},${multi.z} after follower steps`
  );
  ok('multi remains frozen after repeated updateMovement');

  // Engine source still has unconditional NOMOVE gate (assumption anchor).
  const npcSrc = fs.readFileSync(path.join(ISO_ENGINE, 'src/engine/entity/Npc.ts'), 'utf8');
  assert(
    /updateMovement\s*\(\s*\)\s*:\s*boolean\s*\{[\s\S]*?moverestrict\s*===\s*MoveRestrict\.NOMOVE[\s\S]*?return false;/.test(
      npcSrc
    ),
    'Npc.ts updateMovement NOMOVE short-circuit not found — engine assumption changed'
  );
  ok('Npc.ts updateMovement still short-circuits on MoveRestrict.NOMOVE');
} finally {
  Object.defineProperty(World, 'gameMap', { configurable: true, value: originalGameMap });
}

if (process.exitCode) {
  console.log('RESULT FAIL');
  process.exit(1);
}
console.log('RESULT PASS (real Npc.updateMovement coordinate change + multi NOMOVE freeze)');
// World import starts background workers; force exit so the harness does not hang.
process.exit(0);
