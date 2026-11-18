#!/usr/bin/env node
/** Giant Mole: compiled scripts, production packets, and the packed 377 map. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  World, ScriptProvider, ScriptState, ServerTriggerType, PlayerStat, PlayerTimerType,
  types, map, CollisionType, engineModule, contentRoot, id, obj, inv, invCom,
  player, seed, inventory, count, slotOf, held, execute, tile, settle,
  environmentTick, resumeDialogue
} from '../swamp-caves/runtime.mjs';

const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await engineModule('engine/entity/EntityLifeCycle.ts');
const { NpcStat } = await engineModule('engine/entity/NpcStat.ts');
const { NpcMode } = await engineModule('engine/entity/NpcMode.ts');
const { PlayerQueueType } = await engineModule('engine/entity/PlayerQueueRequest.ts');
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const rsbuf = await engineModule('network/rsbuf/index.ts');
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const OpLocU = (await engineModule('network/game/client/model/OpLocU.ts')).default;
const OpNpc = (await engineModule('network/game/client/model/OpNpc.ts')).default;
const OpNpcU = (await engineModule('network/game/client/model/OpNpcU.ts')).default;
const locHandler = new ((await engineModule('network/game/client/handler/OpLocHandler.ts')).default)();
const locUseHandler = new ((await engineModule('network/game/client/handler/OpLocUHandler.ts')).default)();
const npcHandler = new ((await engineModule('network/game/client/handler/OpNpcHandler.ts')).default)();
const npcUseHandler = new ((await engineModule('network/game/client/handler/OpNpcUHandler.ts')).default)();

const constants = readFileSync(path.join(contentRoot, 'scripts/areas/area_falador/configs/giant_mole.constant'), 'utf8');
const npcSource = readFileSync(path.join(contentRoot, 'scripts/areas/area_falador/configs/giant_mole.npc'), 'utf8');
function constant(name) {
  const match = new RegExp(`^\\^${name}\\s*=\\s*(\\d+)\\s*$`, 'm').exec(constants);
  assert(match, `checked-out constant ${name}`);
  return Number(match[1]);
}
function coordConstant(name) {
  const match = new RegExp(`^\\^${name}\\s*=\\s*([0-3]_\\d+_\\d+_\\d+_\\d+)\\s*$`, 'm').exec(constants);
  assert(match, `checked-out coordinate ${name}`);
  const [level, mx, mz, lx, lz] = match[1].split('_').map(Number);
  return { level, x: mx * 64 + lx, z: mz * 64 + lz };
}
function sectionValue(source, sectionName, key) {
  const start = source.indexOf(`[${sectionName}]`);
  assert(start >= 0, `checked-out [${sectionName}] section`);
  const next = source.indexOf('\n[', start + 1);
  const block = source.slice(start, next < 0 ? source.length : next);
  const match = new RegExp(`^${key}=([^\\r\\n]+)$`, 'm').exec(block);
  assert(match, `checked-out ${sectionName}.${key}`);
  return match[1];
}
const entry = coordConstant('giant_mole_entrance');
const exit = coordConstant('giant_mole_exit');
const darkTicks = constant('giant_mole_dark_ticks');
const moleType = types.NpcType.getByName('mole_giant');
const moleId = id('NpcType', 'mole_giant');
const hillId = id('LocType', 'mole_hill');
const ropeId = id('LocType', 'mole_rope_02');
const wellId = id('LocType', 'well_11793');
const moleConfigRespawn = Number(sectionValue(npcSource, 'mole_giant', 'respawnrate'));
const burrowEnum = types.EnumType.getByName('giant_mole_burrow_coords');
assert(burrowEnum, 'compiled Giant Mole burrow destinations exist');
const burrows = [...burrowEnum.values.entries()]
  .sort(([a], [b]) => a - b)
  .map(([key, packed]) => ({ key, ...CoordGrid.unpackCoord(packed) }));
const environmentTimer = ScriptProvider.getByName('[softtimer,giant_mole_environment]');
const hitpoint = NpcStat.HITPOINTS;
const playerHitpoint = PlayerStat.HITPOINTS;
const aggressivePlayer = id('VarNpcType', 'npc_aggressive_player');
const attackingUid = id('VarNpcType', 'npc_attacking_uid');
const aiDamage = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE2, moleId, moleType.category);
const aiDeath = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, moleId, moleType.category);
const aiBurrow = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE5, moleId, moleType.category);
const downAnim = id('SeqType', 'mole_burrow_down');
const upAnim = id('SeqType', 'mole_burrow_up');
const mudTimer = ScriptProvider.getByName('[timer,giant_mole_mud]');
const mudOverlay = id('Component', 'inter_365');
const mudSpot = id('SpotanimType', 'mole_mud_splat_spotanim');
const mudTicks = Math.ceil(types.SeqType.get(id('SeqType', 'mole_mud_splat_interface')).duration / 30);
const downTicks = Math.ceil(types.SeqType.get(downAnim).duration / 30);
assert(mudTimer && mudTicks > 0, 'packed mud overlay animation and expiry script exist');

assert(World.gameMap.getTotalLocs() > 0, 'load the real packed world map');
assert(moleType && environmentTimer && aiDamage && aiDeath && aiBurrow, 'compiled mole scripts/configs are present');
assert.equal(moleType.size, 3);
assert.equal(moleType.op?.[1], 'Attack', 'the ordinary second NPC operation remains Attack');
assert.equal(moleType.respawnrate, moleConfigRespawn, 'respawn interval comes from the checked-out NPC config');
assert(burrows.length > 1 && burrows.every((row, index) => row.key === index), 'burrow enum keys are contiguous');

const naturalMole = [...World.npcs].find(n => n.type === moleId && n.level === 0 && n.x === 1759 && n.z === 5189);
assert(naturalMole, 'the original natural 3x3 mole placement is loaded');
assert.equal(naturalMole.width, 3);
assert.equal(naturalMole.length, 3);

const coordKey = t => `${t.level}:${t.x}:${t.z}`;
function allocatedWalkable(t, label) {
  assert(map.isZoneAllocated(t.level, t.x, t.z), `${label}: packed zone allocated at ${coordKey(t)}`);
  assert.equal(map.isMapBlocked(t.x, t.z, t.level), false, `${label}: packed collision leaves ${coordKey(t)} walkable`);
}
function insideBounds(t, bounds) {
  return t.x >= bounds.minX && t.x <= bounds.maxX && t.z >= bounds.minZ && t.z <= bounds.maxZ;
}
function regionBounds(center, rx, rz) {
  const mx = Math.floor(center.x / 64), mz = Math.floor(center.z / 64);
  return { minX: (mx - rx) * 64, maxX: (mx + rx + 1) * 64 - 1,
    minZ: (mz - rz) * 64, maxZ: (mz + rz + 1) * 64 - 1 };
}
const reachableByOrigin = new Map();
function pathExists(from, to) {
  if (from.level !== to.level) return false;
  const origin = coordKey(from);
  let reachable = reachableByOrigin.get(origin);
  if (!reachable) {
    const bounds = regionBounds(from, 1, 2);
    const encode = (x, z) => x * 16384 + z;
    const start = encode(from.x, from.z);
    reachable = new Set([start]);
    const queue = [start];
    // Prove connectedness with native clipping edges, not the local finder's
    // moveNear fallback or search-window limit.
    for (let head = 0; head < queue.length; head++) {
      const x = Math.floor(queue[head] / 16384), z = queue[head] % 16384;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const nextX = x + dx, nextZ = z + dz, next = encode(nextX, nextZ);
        if (!insideBounds({ x: nextX, z: nextZ }, bounds) || reachable.has(next) ||
            !map.isZoneAllocated(from.level, nextX, nextZ)) continue;
        if (!map.canTravel(from.level, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
        reachable.add(next);
        queue.push(next);
      }
    }
    reachableByOrigin.set(origin, reachable);
  }
  return reachable.has(to.x * 16384 + to.z);
}
function perimeter(rect) {
  const tiles = [];
  for (let dx = -1; dx <= rect.width; dx++) {
    tiles.push({ level: rect.level, x: rect.x + dx, z: rect.z - 1 });
    tiles.push({ level: rect.level, x: rect.x + dx, z: rect.z + rect.length });
  }
  for (let dz = 0; dz < rect.length; dz++) {
    tiles.push({ level: rect.level, x: rect.x - 1, z: rect.z + dz });
    tiles.push({ level: rect.level, x: rect.x + rect.width, z: rect.z + dz });
  }
  return [...new Map(tiles.map(t => [coordKey(t), t])).values()];
}
const geometryPlayer = new (await engineModule('engine/entity/Player.ts')).default('mole-geometry', 1n, 1n);
function operableStand(rect, { reachableFrom = null, label = 'target' } = {}) {
  for (const stand of perimeter(rect)) {
    if (reachableFrom && !pathExists(reachableFrom, stand)) continue;
    try { allocatedWalkable(stand, label); } catch { continue; }
    geometryPlayer.level = stand.level;
    geometryPlayer.x = stand.x;
    geometryPlayer.z = stand.z;
    if (geometryPlayer.inOperableDistance(rect)) return stand;
  }
  assert.fail(`${label}: no actual packed, operable stand tile around ${coordKey(rect)}`);
}
function locsInBounds(typeId, level, bounds) {
  const found = new Map();
  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
      const loc = World.getLoc(x, z, level, typeId);
      if (loc) found.set(coordKey(loc), loc);
    }
  }
  return [...found.values()];
}
function rectForNpc(npc) {
  return { level: npc.level, x: npc.x, z: npc.z, width: npc.width, length: npc.length };
}

// The source map places the rope on raw plane 1. The loaded packed map lowers it
// through LINK_BELOW; use its runtime object and collision, not the raw plane.
const rope = World.getLoc(1752, 5136, 0, ropeId);
assert(rope, 'bridge-lowered packed rope placement is on runtime plane 0');
assert.equal(World.getLoc(1752, 5136, 1, ropeId), null, 'no duplicate rope remains on raw plane 1');
assert.deepEqual([rope.level, rope.x, rope.z], [0, 1752, 5136]);
const ropeStand = { level: 0, x: 1752, z: 5137 };
allocatedWalkable(ropeStand, 'mole exit rope stand');
assert.equal(map.isMapBlocked(1753, 5136, 0), true, 'the east tile is blocked and is not used as the exit stand');
geometryPlayer.level = ropeStand.level;
geometryPlayer.x = ropeStand.x;
geometryPlayer.z = ropeStand.z;
assert(geometryPlayer.inOperableDistance(rope), 'north stand can operate the lowered rope');

allocatedWalkable(entry, 'mole entry landing');
allocatedWalkable(exit, 'surface exit landing');
const caveBounds = regionBounds(entry, 1, 2);
const surfaceBounds = regionBounds(exit, 1, 2);
const hillPlacements = locsInBounds(hillId, 0, surfaceBounds);
assert(hillPlacements.length > 0, 'actual packed mole hills exist near the Falador exit');
const well = World.getLoc(2985, 3314, 0, wellId);
assert(well, 'original Falador well placement is loaded');
const surfaceHill = hillPlacements.map(loc => ({ loc, stand: operableStand(loc, { label: 'mole hill' }) }))
  .find(row => pathExists(exit, row.stand));
assert(surfaceHill, 'at least one mole hill has a real collision-safe reachable stand');
geometryPlayer.level = exit.level; geometryPlayer.x = exit.x; geometryPlayer.z = exit.z;
assert(geometryPlayer.inOperableDistance(well), 'surface landing is operable from the original well-side tile');
assert(pathExists(exit, surfaceHill.stand), 'packed surface collision routes from exit landing to a real mole hill');

const caveStandByBurrow = new Map();
const headedHill = World.getLoc(2984, 3387, 0, hillId);
assert(headedHill, 'headed cell uses an actual original mole hill');
const headedHillStand = { level: 0, x: 2985, z: 3387 };
allocatedWalkable(headedHillStand, 'headed mole hill stand');
geometryPlayer.level = headedHillStand.level;
geometryPlayer.x = headedHillStand.x; geometryPlayer.z = headedHillStand.z;
assert(geometryPlayer.inOperableDistance(headedHill), 'headed hill stand operates its real target');
for (const destination of burrows) {
  assert(insideBounds(destination, caveBounds), `burrow ${destination.key} remains in the packed lair region`);
  for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 3; dz++) {
    allocatedWalkable({ level: destination.level, x: destination.x + dx, z: destination.z + dz },
      `3x3 burrow footprint ${destination.key}`);
  }
  const probe = new Npc(destination.level, destination.x, destination.z, 3, 3,
    EntityLifeCycle.DESPAWN, -1, moleId, moleType.blockwalk);
  const stand = { level: destination.level, x: destination.x + 3, z: destination.z + 1 };
  allocatedWalkable(stand, `headed burrow chase ${destination.key}`);
  geometryPlayer.level = stand.level; geometryPlayer.x = stand.x; geometryPlayer.z = stand.z;
  assert(geometryPlayer.inOperableDistance(probe), `headed chase stand operates burrow ${destination.key}`);
  assert(pathExists(entry, stand), `player can walk from the packed entrance to the headed stand for burrow ${destination.key}`);
  caveStandByBurrow.set(destination.key, stand);
}
const naturalStand = caveStandByBurrow.get(0);
// UNKNOWN fixture search stands, not product destinations. WANDER remains tied
// to the original spawn after telejump, so searching only the four holes is incomplete.
const searchTiles = JSON.parse(readFileSync(path.join(contentRoot, 'tests/giant-mole/search-tiles.json'), 'utf8'));
for (const stand of searchTiles) {
  allocatedWalkable(stand, 'headed whole-lair search');
  assert(pathExists(entry, stand), `headed search stand ${coordKey(stand)} is reachable from the real entrance`);
}
for (let x = 1728; x < 1792; x++) for (let z = 5120; z < 5248; z++) {
  let footprintWalkable = true;
  for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 3; dz++) {
    if (!map.isZoneAllocated(0, x + dx, z + dz) || map.isMapBlocked(x + dx, z + dz, 0)) footprintWalkable = false;
  }
  if (footprintWalkable) assert(searchTiles.some(stand => Math.max(Math.abs(stand.x - x), Math.abs(stand.z - z)) <= 13),
    `headed search covers the packed 3x3 NPC origin ${x},${z} inside the receive radius`);
}

const players = new Set();
const huntZones = new Map();
const dynamicNpcs = new Set();
function makePlayer(items = [], position = surfaceHill.stand) {
  const p = seed(player(), items);
  [p.level, p.x, p.z] = [position.level, position.x, position.z];
  p.originX = p.x; p.originZ = p.z;
  p.baseLevels[playerHitpoint] = 99; p.levels[playerHitpoint] = 99;
  players.add(p);
  return p;
}
function showNpc(p, npc) {
  rsbuf.addPlayer(p.slot);
  rsbuf.addNpc(npc.nid, npc.type);
  const appearance = p.generateAppearance();
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, appearance, p.lastAppearance,
    p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ,
    p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[playerHitpoint], p.baseLevels[playerHitpoint], p.animId, p.animDelay, p.sayMessage,
    p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0,
    p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(npc.x, npc.level, npc.z, npc.nid, npc.type, npc.tele, npc.jump, npc.runDir,
    npc.walkDir, npc.isActive, npc.masks, npc.faceEntity, npc.faceSquareX, npc.faceSquareZ,
    npc.faceAngleX, npc.faceAngleZ, npc.hitmarkDamage, npc.hitmarkType, npc.hitmark2Damage,
    npc.hitmark2Type, npc.levels[hitpoint], npc.baseLevels[hitpoint], npc.animId, npc.animDelay,
    npc.sayMessage, npc.spotanimId, npc.spotanimHeight, npc.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, npc.nid), 'real visibility encoder includes the target NPC');
}
function clickLoc(p, loc, option = 1) {
  p.originX = p.x; p.originZ = p.z;
  const accepted = locHandler.handle(new OpLoc(option, loc.x, loc.z, loc.type), p);
  if (accepted) p.processInteraction();
  return accepted;
}
function useLocWith(p, item, loc) {
  p.originX = p.x; p.originZ = p.z;
  const accepted = locUseHandler.handle(new OpLocU(loc.x, loc.z, loc.type,
    obj(item), slotOf(p, item), invCom), p);
  if (accepted) p.processInteraction();
  return accepted;
}
function useOnNpc(p, npc, item) {
  showNpc(p, npc);
  p.originX = p.x; p.originZ = p.z;
  const accepted = npcUseHandler.handle(new OpNpcU(npc.nid, obj(item), slotOf(p, item), invCom), p);
  assert(accepted, `production OPNPCU accepts ${item} on visible ${npc.type}`);
  assert.equal(p.getOpTrigger()?.name, '[opnpcu,wyson]', 'real AP/OP NPC dispatch selects Wyson item-use script');
  p.processInteraction();
  settle(p);
}
function talkTo(p, npc) {
  showNpc(p, npc);
  p.originX = p.x; p.originZ = p.z;
  const accepted = npcHandler.handle(new OpNpc(1, npc.nid), p);
  assert(accepted, 'production OPNPC1 accepts visible Wyson');
  assert.equal(p.getOpTrigger()?.name, '[opnpc1,wyson]', 'real NPC dispatch selects Wyson conversation');
  p.processInteraction();
}
function chooseDialogue(p, choice) {
  let selected = false;
  for (let turn = 0; turn < 80 && p.activeScript; turn++) {
    if (p.activeScript.execution !== ScriptState.PAUSEBUTTON) {
      settle(p, 20);
      continue;
    }
    const root = types.Component.get(p.modalChat).comName;
    if (/^multi[2-5]$/.test(root)) {
      assert(!selected, 'trade conversation offers one explicit trade choice');
      resumeDialogue(p, choice);
      selected = true;
    } else {
      resumeDialogue(p);
    }
  }
  assert(selected, 'the visible dialogue offered and accepted the requested choice');
  assert.equal(p.activeScript, null, 'Wyson dialogue settles without a pending continuation');
}
function makeMole(position) {
  const npc = new Npc(position.level, position.x, position.z, moleType.size, moleType.size,
    EntityLifeCycle.RESPAWN, World.npcs.next(), moleId, moleType.blockwalk);
  World.addNpc(npc, -1);
  npc.resetDefaults();
  npc.lastMovement = World.currentTick - 100;
  npc.targetOp = NpcMode.NONE;
  npc.setVar(aggressivePlayer, -1);
  npc.setVar(attackingUid, -1);
  npc.turn(); // Complete the normal first-turn regen setup before damage is seeded.
  dynamicNpcs.add(npc);
  return npc;
}
function npcFrame(npc, actors = []) {
  World.currentTick = Math.max(World.currentTick + 1, npc.delayedUntil);
  if (npc.isActive) npc.turn();
  for (const actor of actors) actor.processQueues();
}
function driveNpc(npc, done, actors = [], maxTicks = 80) {
  for (let tick = 0; tick < maxTicks; tick++) {
    if (done()) return;
    npcFrame(npc, actors);
  }
  assert.fail(`mole NPC did not reach expected state in ${maxTicks} turns`);
}
function withRandom(values, action) {
  const original = JavaRandom.nextDouble;
  let draws = 0;
  JavaRandom.nextDouble = () => {
    assert(draws < values.length, `unexpected random draw ${draws + 1}`);
    return values[draws++];
  };
  try {
    const result = action();
    assert.equal(draws, values.length, 'consume the exact deterministic script RNG stream');
    return result;
  } finally {
    JavaRandom.nextDouble = original;
  }
}
function withDrops(action) {
  const drops = [];
  const original = World.addObj;
  World.addObj = function (ground, receiver, duration) {
    drops.push({ name: types.ObjType.get(ground.type).debugname, count: ground.count, receiver: String(receiver) });
    return original.call(this, ground, receiver, duration);
  };
  try { action(); return drops; } finally { World.addObj = original; }
}
function withMapAnimations(action) {
  const effects = [];
  const original = World.animMap;
  World.animMap = function (level, x, z, spotanim, height, delay) {
    effects.push({ tick: World.currentTick, level, x, z, spotanim, height, delay });
    return original.call(this, level, x, z, spotanim, height, delay);
  };
  try { action(); return effects; } finally { World.animMap = original; }
}
function finishPlayer(p) {
  const huntZone = huntZones.get(p);
  if (huntZone) { huntZone.leave(p); huntZones.delete(p); }
  p.delayed = false;
  p.activeScript = null;
  p.clearInteraction();
  p.weakQueue.clear();
  if (p.timers.has(environmentTimer.id)) execute('[proc,giant_mole_environment_release]', p);
  p.queue.clear();
  p.timers.clear();
  rsbuf.removePlayer(p.slot);
  p.clearInteraction();
  p.isActive = false;
  World.players[p.pid] = null;
  p.unlink();
}
function finishNpc(npc) {
  npc.activeScript = null;
  npc.delayed = false;
  npc.queue.clear();
  if (npc.isActive) World.removeNpc(npc, -1);
}

const originalMathRandom = Math.random;
Math.random = () => 0.5; // Keep unrelated native wander RNG out of scripted boundary streams.
try {
  // Production loc-use gate, the real held-spade entry, and the bridge-lowered exit.
  for (const items of [
    ['spade', 'tinderbox'],
    ['spade', 'bullseye_lantern_lit'],
    ['hammer', 'tinderbox', 'bullseye_lantern_lit']
  ]) {
    const p = makePlayer(items);
    const before = inventory(p);
    assert(useLocWith(p, items.includes('hammer') ? 'hammer' : 'spade', surfaceHill.loc));
    settle(p);
    assert.deepEqual(tile(p), [surfaceHill.stand.level, surfaceHill.stand.x, surfaceHill.stand.z]);
    assert.deepEqual(inventory(p), before, 'refused digging conserves every carried item');
    assert.equal(p.timers.has(environmentTimer.id), false, 'refused digging does not start darkness');
    finishPlayer(p);
  }
  {
    const p = makePlayer(['spade', 'tinderbox', 'bullseye_lantern_lit'], surfaceHill.stand);
    assert(useLocWith(p, 'spade', surfaceHill.loc), 'real OPLOCU spade packet is accepted on the mole hill');
    settle(p);
    assert.deepEqual(tile(p), [entry.level, entry.x, entry.z], 'item-on-hill dig uses the packed entrance coordinate');
    assert(p.timers.has(environmentTimer.id), 'item-on-hill entry starts the real SOFT darkness timer');
    finishPlayer(p);
  }

  {
    const outside = { level: 0, x: 3222, z: 3218 };
    const p = makePlayer(['spade', 'tinderbox', 'bullseye_lantern_lit'], outside);
    const before = inventory(p);
    assert(held(p, 'spade', 1));
    settle(p);
    assert.deepEqual(tile(p), [outside.level, outside.x, outside.z], 'off-hill digging retains its published position');
    assert.deepEqual(inventory(p), before, 'off-hill digging does not consume the mole tools');
    assert(p.messages.includes('Nothing interesting happens.'), 'the shared spade fallback still runs');
    assert.equal(p.timers.has(environmentTimer.id), false, 'ordinary digging does not enter the mole environment');
    finishPlayer(p);
  }

  {
    const p = makePlayer(['spade', 'tinderbox', 'bullseye_lantern_lit'], surfaceHill.loc);
    assert(held(p, 'spade', 1), 'real OPHELD1 spade packet is accepted on the mole hill');
    assert.equal(p.activeScript?.execution, ScriptState.SUSPENDED);
    settle(p);
    assert.deepEqual(tile(p), [entry.level, entry.x, entry.z], 'successful dig uses the packed entrance coordinate');
    assert(p.timers.has(environmentTimer.id), 'entry starts the real SOFT darkness timer');
    environmentTick(p);
    assert.notEqual(p.overlay, -1, 'lit cave opens the real overlay before exit');
    p.level = ropeStand.level; p.x = ropeStand.x; p.z = ropeStand.z;
    execute('[queue,giant_mole_dirt]', p, [CoordGrid.packCoord(ropeStand.level, ropeStand.x, ropeStand.z)]);
    assert.equal(p.overlay, mudOverlay, 'the real dirt queue opens the cached screen effect');
    assert(p.timers.has(mudTimer.id), 'mud owns its real animation expiry timer');
    assert(clickLoc(p, rope), 'OPLOC1 on the runtime-plane rope is accepted from the real adjacent stand');
    settle(p);
    assert.deepEqual(tile(p), [exit.level, exit.x, exit.z], 'rope exit uses the packed surface landing');
    assert.equal(p.timers.has(environmentTimer.id), false, 'exit clears the cave timer');
    assert.equal(p.overlay, -1, 'exit closes the cave overlay');
    assert.equal(p.timers.has(mudTimer.id), false, 'rope exit cancels pending mud expiry');
    finishPlayer(p);
  }

  // Natural attack option goes through the real visibility encoder and OPNPC dispatcher.
  {
    const p = makePlayer([], naturalStand);
    showNpc(p, naturalMole);
    assert.equal(types.NpcType.get(naturalMole.type).op?.[1], 'Attack');
    assert(npcHandler.handle(new OpNpc(2, naturalMole.nid), p), 'production OPNPC2 accepts the natural giant mole');
    assert.equal(p.target, naturalMole);
    assert.equal(p.targetOp, ServerTriggerType.APNPC2);
    assert.equal(p.getOpTrigger(), ScriptProvider.getByTrigger(ServerTriggerType.OPNPC2, moleId, moleType.category));
    p.processInteraction();
    settle(p);
    finishPlayer(p);
  }

  // AI_QUEUE2 applies damage, the half-HP boundary burrows, animations and aggression reset are real.
  {
    const start = burrows[1];
    const npc = makeMole(start);
    npc.levels[hitpoint] = npc.baseLevels[hitpoint];
    npc.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, 99);
    npcFrame(npc);
    assert.equal(npc.levels[hitpoint], 101, 'damage hook applies the requested nonlethal damage');
    assert.deepEqual([npc.level, npc.x, npc.z], [start.level, start.x, start.z], 'above-half HP does not burrow');
    finishNpc(npc);
  }
  {
    const start = burrows[1];
    const npc = makeMole(start);
    npc.levels[hitpoint] = npc.baseLevels[hitpoint];
    npc.setVar(aggressivePlayer, 321);
    npc.setVar(attackingUid, 654);
    const effects = withMapAnimations(() => withRandom([0, 0.75, 0.25], () => {
      npc.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, 100);
      driveNpc(npc, () => npc.delayed && npc.animId === downAnim);
      assert.equal(npc.levels[hitpoint], npc.baseLevels[hitpoint] / 2, 'exactly half HP is eligible');
      assert.equal(npc.animId, downAnim, 'burrow-down animation plays before relocation');
      driveNpc(npc, () => npc.level !== start.level || npc.x !== start.x || npc.z !== start.z);
    }));
    assert.deepEqual(effects.map(effect => effect.spotanim), [
      id('SpotanimType', 'mole_mud_cloud_spotanim'),
      id('SpotanimType', 'mole_mude_hole_spotanim'),
      id('SpotanimType', 'mole_mud_hole_up_spotanim')
    ], 'native map animation dispatch emits the original cloud, departure hole and arrival hole');
    assert.deepEqual(effects.slice(0, 2).map(effect => [effect.level, effect.x, effect.z]),
      Array(2).fill([start.level, start.x + 1, start.z + 1]), 'departure effects use the real 3x3 footprint centre');
    assert.equal(effects[1].tick - effects[0].tick, downTicks, 'departure animation runs for its cache-derived tick duration');
    const chosen = burrows.find(destination => destination.level === npc.level && destination.x === npc.x && destination.z === npc.z);
    assert(chosen, 'burrow relocation selects a packed enum destination');
    assert.notEqual(chosen.key, start.key, 'burrow never selects its current destination');
    assert.deepEqual([effects[2].level, effects[2].x, effects[2].z],
      [chosen.level, chosen.x + 1, chosen.z + 1], 'arrival effect uses the chosen packed destination');
    assert.equal(npc.animId, upAnim, 'burrow-up animation plays after relocation');
    assert.equal(npc.getVar(aggressivePlayer), -1, 'burrow resets aggressive player');
    assert.equal(npc.getVar(attackingUid), -1, 'burrow resets attacking uid');
    finishNpc(npc);
  }
  // No later <=10 HP immunity: a nonlethal one-HP mole still takes the candidate roll.
  {
    const start = burrows[2];
    const npc = makeMole(start);
    npc.levels[hitpoint] = 1;
    withRandom([0, 0.75, 0.25], () => {
      npc.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, 0);
      driveNpc(npc, () => npc.delayed && npc.animId === downAnim);
      assert.equal(npc.levels[hitpoint], 1, 'zero damage preserves one HP');
      driveNpc(npc, () => npc.level !== start.level || npc.x !== start.x || npc.z !== start.z);
    });
    const destination = burrows.find(row => row.level === npc.level && row.x === npc.x && row.z === npc.z);
    assert(destination && destination.key !== start.key, 'one-HP nonlethal mole burrows away from its current destination');
    finishNpc(npc);
  }


  // A successful dirt event sees both real nearby players and extinguishes only open lights.
  {
    const start = burrows[0];
    const npc = makeMole(start);
    const standTiles = perimeter(rectForNpc(npc)).filter(t => {
      try { allocatedWalkable(t, 'dirt player stand'); } catch { return false; }
      geometryPlayer.level = t.level; geometryPlayer.x = t.x; geometryPlayer.z = t.z;
      return geometryPlayer.inOperableDistance(npc);
    });
    assert(standTiles.length >= 2, 'packed collision provides two actual player stands around the mole');
    const open = makePlayer(['lit_candle'], standTiles[0]);
    const covered = makePlayer(['bullseye_lantern_lit'], standTiles[1]);
    assert(open.inOperableDistance(npc) && covered.inOperableDistance(npc));
    for (const p of [open, covered]) execute('[proc,giant_mole_environment_start]', p);
    for (const p of [open, covered]) {
      const zone = World.gameMap.getZone(p.x, p.z, p.level);
      zone.enter(p);
      huntZones.set(p, zone);
    }
    showNpc(open, npc); showNpc(covered, npc);
    npc.levels[hitpoint] = npc.baseLevels[hitpoint];
    withRandom([0, 0, 0.75], () => {
      npc.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, npc.baseLevels[hitpoint] / 2);
      driveNpc(npc, () => npc.level !== start.level || npc.x !== start.x || npc.z !== start.z, [open, covered]);
    });
    assert.equal(count(open, 'lit_candle'), 0, 'nearby open candle is extinguished');
    assert.equal(count(open, 'unlit_candle'), 1, 'extinguishing conserves the candle');
    assert.equal(count(covered, 'bullseye_lantern_lit'), 1, 'covered lantern remains lit');
    for (const p of [open, covered]) {
      assert.equal(p.overlay, mudOverlay, 'both affected players receive the original mud interface');
      assert.equal(p.spotanimId, mudSpot, 'both affected players receive the original mud splat spotanim');
      assert.equal(p.timers.get(mudTimer.id)?.interval, mudTicks, 'overlay lifetime rounds its cache duration up to server ticks');
    }
    const mudEnds = open.timers.get(mudTimer.id).clock + mudTicks;
    while (World.currentTick < mudEnds) {
      environmentTick(open, covered);
      if (World.currentTick < mudEnds) {
        assert.equal(open.overlay, mudOverlay, 'darkness does not replace an active mud animation');
        assert.equal(covered.overlay, mudOverlay, 'covered-light overlay does not replace an active mud animation');
      }
    }
    assert.equal(open.overlay, id('Component', 'inter_387'), 'expiry restores darkness after the candle went out');
    assert.equal(covered.overlay, id('Component', 'inter_249'), 'expiry restores the covered light overlay');
    for (const p of [open, covered]) assert.equal(p.timers.has(mudTimer.id), false, 'expiry clears itself');
    finishPlayer(open); finishPlayer(covered); finishNpc(npc);
  }

  // Lethal queue2 delegates to queue3; normal death processing and the guaranteed loot run once.
  for (const [skinRoll, expectedSkin] of [[0, 1], [0.99, 3]]) {
    const start = burrows[2];
    const npc = makeMole(start);
    const stand = caveStandByBurrow.get(start.key);
    const hero = makePlayer([], stand);
    showNpc(hero, npc);
    npc.heroPoints.addHero(hero.hash64, npc.baseLevels[hitpoint]);
    npc.setVar(aggressivePlayer, hero.uid);
    npc.levels[hitpoint] = 1;
    const drops = withDrops(() => withRandom([skinRoll, 0], () => {
      npc.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, 1);
      driveNpc(npc, () => !npc.isActive && !npc.activeScript);
    }));
    const amount = name => drops.filter(drop => drop.name === name).reduce((sum, drop) => sum + drop.count, 0);
    assert.equal(amount('big_bones'), 1, 'exactly one guaranteed big bones drop');
    assert.equal(amount('mole_claw'), 1, 'hero receives one mole claw');
    assert.equal(amount('mole_skin'), expectedSkin, 'skin amount follows the 1-3 roll');
    assert.equal(amount('adamant_longsword'), 1, 'zero rare-table roll selects the first table entry');
    assert.equal(drops.length, expectedSkin + 3, 'native unstackable skins split into one ground object per skin');
    assert.equal(npc.isActive, false, 'normal npc_death enters inactive respawn state');
    assert(npc.lifecycleTick > 0, 'normal npc_death schedules the configured respawn');
    assert.equal(npc.baseType, moleId);
    finishPlayer(hero); finishNpc(npc);
  }

  const ordinaryLoot = [
    [0, 9, 'adamant_longsword', 1], [10, 18, 'mithril_platebody', 1],
    [19, 25, 'amulet_of_strength', 1], [26, 27, 'mithril_axe', 1],
    [28, 28, 'mithril_battleaxe', 1], [29, 29, 'rune_med_helm', 1],
    [30, 49, 'airrune', 105], [50, 68, 'bloodrune', 15],
    [69, 79, 'firerune', 105], [80, 89, 'iron_arrow', 690],
    [90, 94, 'lawrune', 15], [95, 97, 'deathrune', 50],
    [98, 107, 'cert_yew_logs', 100], [108, 111, 'shark', 4],
    [112, 114, 'mithril_bar', 1], [115, 116, 'cert_iron_ore', 100],
    [117, 117, 'bigoysterpearls', 1],
    [118, 121, 'naturerune', 67, 0], [122, 127, 'uncut_sapphire', 1, 0]
  ];
  for (const [low, high, name, quantity, sharedRoll] of ordinaryLoot) {
    for (const roll of new Set([low, high])) {
      const npc = makeMole(burrows[2]);
      const hero = makePlayer([], caveStandByBurrow.get(2));
      npc.heroPoints.addHero(hero.hash64, npc.baseLevels[hitpoint]);
      npc.setVar(aggressivePlayer, hero.uid);
      npc.levels[hitpoint] = 1;
      const draws = [0, (roll + 0.5) / 128];
      if (sharedRoll !== undefined) draws.push(sharedRoll);
      const drops = withDrops(() => withRandom(draws, () => {
        npc.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, 1);
        driveNpc(npc, () => !npc.isActive && !npc.activeScript);
      }));
      const amounts = new Map();
      for (const drop of drops) {
        assert.equal(drop.receiver, String(hero.hash64), 'the damage hero owns each natural loot object');
        amounts.set(drop.name, (amounts.get(drop.name) ?? 0) + drop.count);
      }
      assert.deepEqual([...amounts], [
        ['big_bones', 1], ['mole_claw', 1], ['mole_skin', 1], [name, quantity]
      ], `ordinary loot roll ${roll} preserves the candidate cutoff and amount`);
      finishPlayer(hero); finishNpc(npc);
    }
  }

  // The lethal darkness timer releases its own overlay before scheduling strongqueue death.
  {
    const p = makePlayer(['spade', 'tinderbox', 'bullseye_lantern_lit'], surfaceHill.loc);
    p.levels[playerHitpoint] = 1;
    assert(held(p, 'spade', 1));
    settle(p);
    assert.deepEqual(tile(p), [entry.level, entry.x, entry.z]);
    p.getInventory(inv).set(slotOf(p, 'bullseye_lantern_lit'), null);
    for (let tick = 0; tick < darkTicks + 4 && p.levels[playerHitpoint] > 0; tick++) environmentTick(p);
    assert.equal(p.levels[playerHitpoint], 0, 'dark cave timer reaches lethal damage');
    assert.equal(p.timers.has(environmentTimer.id), false, 'lethal timer releases itself');
    assert.equal(p.overlay, -1, 'lethal timer closes the owned overlay before death dispatch');
    const death = [...p.queue.all()].find(request => request.script.name === '[queue,player_death_default]');
    assert(death, 'death is pending rather than already run');
    assert.equal(death.type, PlayerQueueType.STRONG, 'death remains in the strong queue after release');
    finishPlayer(p);
  }

  // Visible Wyson item-use, note refusal, and the real choice dialogue each settle exactly one nest per part.
  const wysonType = types.NpcType.getByName('wyson');
  assert(wysonType, 'packed Wyson NPC exists');
  const wyson = [...World.npcs].find(n => n.type === wysonType.id);
  assert(wyson, 'original natural Wyson spawn is loaded');
  const wysonStand = operableStand(rectForNpc(wyson), { label: 'Wyson' });
  for (const [part, random, expectedNest] of [
    ['mole_claw', 0, 'bird_nest_cheapseeds'],
    ['mole_skin', 0.75, 'bird_nest_ring'],
    ['mole_skin', 0.95, 'bird_nest_empty']
  ]) {
    const p = makePlayer([part], wysonStand);
    withRandom([random], () => useOnNpc(p, wyson, part));
    assert.equal(count(p, part), 0, `${part} is consumed once`);
    assert.equal(count(p, expectedNest), 1, `one ${expectedNest} is returned`);
    assert.equal(['bird_nest_cheapseeds', 'bird_nest_ring', 'bird_nest_empty']
      .reduce((sum, name) => sum + count(p, name), 0), 1, 'one nest per one input part');
    finishPlayer(p);
  }
  for (const noted of ['cert_mole_claw', 'cert_mole_skin']) {
    const p = makePlayer([noted], wysonStand);
    const before = inventory(p);
    useOnNpc(p, wyson, noted);
    assert.deepEqual(inventory(p), before, 'noted parts are refused and conserved');
    assert.equal(count(p, 'bird_nest_cheapseeds') + count(p, 'bird_nest_ring') + count(p, 'bird_nest_empty'), 0);
    finishPlayer(p);
  }
  {
    const parts = ['mole_claw', 'mole_skin', 'mole_skin'];
    const p = makePlayer(parts, wysonStand);
    withRandom([0, 0.75, 0.95], () => {
      talkTo(p, wyson);
      chooseDialogue(p, 1);
    });
    for (const part of ['mole_claw', 'mole_skin']) assert.equal(count(p, part), 0, 'dialogue consumes every offered unnoted part');
    assert.equal(count(p, 'bird_nest_cheapseeds'), 1);
    assert.equal(count(p, 'bird_nest_ring'), 1);
    assert.equal(count(p, 'bird_nest_empty'), 1);
    assert.equal(count(p, 'bird_nest_cheapseeds') + count(p, 'bird_nest_ring') + count(p, 'bird_nest_empty'), parts.length,
      'dialogue never duplicates or loses a nest');
    finishPlayer(p);
  }
  {
    const p = makePlayer(['mole_claw', 'mole_skin'], wysonStand);
    const before = inventory(p);
    talkTo(p, wyson);
    chooseDialogue(p, 3);
    assert.deepEqual(inventory(p), before, 'declining Wyson preserves both parts and creates no nest');
    finishPlayer(p);
  }
  const nestSeeds = [
    [0, 99, 'cabbage_seed', 9], [100, 199, 'limpwurt_seed', 2],
    [200, 299, 'onion_seed', 11], [300, 499, 'potato_seed', 14],
    [500, 589, 'strawberry_seed', 3], [590, 709, 'sweetcorn_seed', 3],
    [710, 819, 'tomato_seed', 6], [820, 909, 'watermelon_seed', 2],
    [910, 939, 'acorn', 1], [940, 959, 'ranarr_seed', 1],
    [960, 979, 'willow_seed', 1], [980, 989, 'maple_seed', 1],
    [990, 997, 'yew_seed', 1], [998, 998, 'magic_tree_seed', 1],
    [999, 999, 'spirit_tree_seed', 1]
  ];
  for (const [low, high, seedName, quantity] of nestSeeds) {
    for (const roll of new Set([low, high])) {
      const p = makePlayer(['bird_nest_cheapseeds'], wysonStand);
      withRandom([(roll + 0.5) / 1000], () => {
        assert(held(p, 'bird_nest_cheapseeds', 1), 'native Search dispatch accepts the original Wyson nest');
        settle(p);
      });
      assert.equal(count(p, 'bird_nest_cheapseeds'), 0);
      assert.equal(count(p, 'bird_nest_empty'), 1, 'searching conserves the empty nest');
      assert.equal(count(p, seedName), quantity, `original nest roll ${roll} yields the candidate seed amount`);
      assert.equal(inventory(p).filter(Boolean).length, 2, 'search emits only the empty nest and its seed stack');
      finishPlayer(p);
    }
  }
  {
    const p = makePlayer(['bird_nest_cheapseeds', ...Array(types.InvType.get(inv).size - 1).fill('hammer')], wysonStand);
    const before = inventory(p);
    assert(held(p, 'bird_nest_cheapseeds', 1));
    assert.deepEqual(inventory(p), before, 'a full inventory preserves the unopened nest and every item');
    finishPlayer(p);
  }
  console.log(`PASS giant-mole: packed entry, rope plane=${rope.level}, rope stand=${coordKey(ropeStand)}, ${burrows.length} burrow destinations, dispatch, darkness, death, and Wyson exchange`);
} finally {
  Math.random = originalMathRandom;
  for (const p of players) finishPlayer(p);
  for (const npc of dynamicNpcs) finishNpc(npc);
}

process.exit(0);
