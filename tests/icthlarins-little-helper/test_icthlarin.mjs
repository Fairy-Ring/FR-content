#!/usr/bin/env node
// Compiled, offline end-to-end proof for Icthlarin's Little Helper.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EntityLifeCycle, IfSetText, MessageGame, Npc, Player, ScriptProvider,
  ScriptRunner, ScriptState, ServerTriggerType, World, content, engine, floorTiles, locFor, map,
  nativeLocRows, nativeNpcRows, requiredId, types
} from '../regicide-travel/runtime.mjs';
const load = async relative => (await import(pathToFileURL(path.join(engine, 'src', relative)).href)).default;
const [Environment, { getExpByLevel }, { PlayerStat }, { NpcStat }, { NpcMode }, { PlayerTimerType }, rsbuf,
  OpNpc, OpNpcHandler, OpNpcU, OpNpcUHandler, OpLoc, OpLocHandler, OpLocU,
  OpLocUHandler, OpHeld, OpHeldHandler, IfButton, IfButtonHandler,
  ResumePauseButton, ResumePauseButtonHandler, { CoordGrid }, { CollisionType }] = await Promise.all([
  load('util/Environment.ts'),
  import(pathToFileURL(path.join(engine, 'src/engine/entity/Player.ts')).href),
  import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href),
  import(pathToFileURL(path.join(engine, 'src/engine/entity/NpcStat.ts')).href),
  import(pathToFileURL(path.join(engine, 'src/engine/entity/NpcMode.ts')).href),
  import(pathToFileURL(path.join(engine, 'src/engine/entity/EntityTimer.ts')).href),
  import(pathToFileURL(path.join(engine, 'src/network/rsbuf/index.ts')).href),
  'network/game/client/model/OpNpc.ts',
  'network/game/client/handler/OpNpcHandler.ts',
  'network/game/client/model/OpNpcU.ts',
  'network/game/client/handler/OpNpcUHandler.ts',
  'network/game/client/model/OpLoc.ts',
  'network/game/client/handler/OpLocHandler.ts',
  'network/game/client/model/OpLocU.ts',
  'network/game/client/handler/OpLocUHandler.ts',
  'network/game/client/model/OpHeld.ts',
  'network/game/client/handler/OpHeldHandler.ts',
  'network/game/client/model/IfButton.ts',
  'network/game/client/handler/IfButtonHandler.ts',
  'network/game/client/model/ResumePauseButton.ts',
  'network/game/client/handler/ResumePauseButtonHandler.ts',
  import(pathToFileURL(path.join(engine, 'src/engine/CoordGrid.ts')).href),
  import(pathToFileURL(path.join(engine, 'src/engine/routefinder/index.ts')).href)
].map(value => typeof value === 'string' ? load(value) : value));

assert.equal(Environment.NODE_MEMBERS, true, 'compiled quest proof runs with members configs');
assert.equal(Environment.NODE_XPRATE, 1, 'quest XP deltas use the unmultiplied tenths scale');
World.currentTick = 100;
const trapTimerScript = ScriptProvider.getByName('[timer,ics_little_traps]');
assert(trapTimerScript, 'compiled pyramid trap timer exists');

const varp = name => requiredId(types.VarPlayerType, name);
const bit = name => requiredId(types.VarBitType, name);
const obj = name => requiredId(types.ObjType, name);
const npcType = name => requiredId(types.NpcType, name);
const component = name => requiredId(types.Component, name);
const inv = requiredId(types.InvType, 'inv');
const bank = requiredId(types.InvType, 'bank');
const worn = requiredId(types.InvType, 'worn');
const invCom = component('inventory:inv');
const wornCom = component('wornitems:worn');
const questRow = component('questlist:ics_little');
const questpoints = varp('qp');
const stageBit = bit('ics_little_var');
const jarMultiBit = bit('ics_little_jar_multi');
const carpenterMultiBit = bit('ics_little_carpenter_multi');
const followerObj = varp('follower_obj');
const followerUid = varp('follower_uid');
const npcAttackingUid = requiredId(types.VarNpcType, 'npc_attacking_uid');
const npcWalker = new OpNpcHandler();
const npcUse = new OpNpcUHandler();
const locOption = new OpLocHandler();
const locUse = new OpLocUHandler();
const heldOption = new OpHeldHandler();
const buttonHandler = new IfButtonHandler();
const pauseHandler = new ResumePauseButtonHandler();

function integerConstant(relative, name) {
  const source = fs.readFileSync(path.join(content, 'scripts', relative), 'utf8');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\s*\\^${escaped}\\s*=\\s*(-?\\d+)`, 'm').exec(source);
  assert(match, `source constant ${name} exists in ${relative}`);
  return Number(match[1]);
}
function coordinateConstant(relative, name) {
  const source = fs.readFileSync(path.join(content, 'scripts', relative), 'utf8');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\s*\\^${escaped}\\s*=\\s*(\\d+)_(\\d+)_(\\d+)_(\\d+)_(\\d+)`, 'm').exec(source);
  assert(match, `packed-coordinate constant ${name} exists in ${relative}`);
  const [, plane, mapX, mapZ, localX, localZ] = match.map(Number);
  return CoordGrid.unpackCoord(CoordGrid.packCoord(plane, mapX * 64 + localX, mapZ * 64 + localZ));
}
const questComplete = integerConstant('general/configs/quest.constant', 'ics_little_complete');
const questPointsAward = integerConstant('general/configs/quest.constant', 'ics_little_questpoints');
assert.equal(questComplete, 26, 'Icthlarin completion stage is the source-backed stage 26');
assert.equal(questPointsAward, 2, 'the retained period guide awards two quest points');
const questObjectNames = [...fs.readFileSync(path.join(content,
  'scripts/quests/quest_ics_little/configs/quest_ics_little.obj'), 'utf8')
  .matchAll(/^\[([^\]]+)\]$/gm)].map(match => match[1]);
assert(questObjectNames.length > 0, 'the quest-owned object config is present');
for (const name of questObjectNames) {
  assert.equal(types.ObjType.get(obj(name)).tradeable, false, `${name} is untradeable in the compiled pack`);
}

const tileKey = tile => tile.join(',');
const tileOf = entity => [entity.level, entity.x, entity.z];
const unpackTile = packed => [((packed >>> 14) & 0x3fff), (packed & 0x3fff)];

function packedWalk(level, start, destination, bound = 64, blockedTiles = null) {
  if (level < 0 || !floorTiles.has(`${level},${start[0]},${start[1]}`) ||
      !floorTiles.has(`${level},${destination[0]},${destination[1]}`)) return null;
  const key = tile => `${tile[0]},${tile[1]}`;
  const queue = [start];
  const previous = new Map([[key(start), null]]);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let next = 0; next < queue.length && !previous.has(key(destination)); next++) {
    const from = queue[next];
    for (const [dx, dz] of directions) {
      const to = [from[0] + dx, from[1] + dz];
      if (Math.max(Math.abs(to[0] - start[0]), Math.abs(to[1] - start[1])) > bound || previous.has(key(to))) continue;
      if (blockedTiles?.has(`${level},${to[0]},${to[1]}`)) continue;
      if (!floorTiles.has(`${level},${to[0]},${to[1]}`) || map.isMapBlocked(to[0], to[1], level)) continue;
      if (!map.canTravel(level, from[0], from[1], dx, dz, 1, 0, CollisionType.NORMAL)) continue;
      previous.set(key(to), from);
      queue.push(to);
    }
  }
  if (!previous.has(key(destination))) return null;
  const route = [];
  for (let tile = destination; previous.get(key(tile)); tile = previous.get(key(tile))) route.push(tile);
  return route.reverse();
}

function approachFor(target) {
  const { row, type } = target;
  for (let radius = 1; radius <= 12; radius++) {
    const candidates = [];
    for (let x = row.x - radius; x <= row.x + radius; x++) {
      for (let z = row.z - radius; z <= row.z + radius; z++) {
        if (Math.max(Math.abs(x - row.x), Math.abs(z - row.z)) !== radius) continue;
        if (!floorTiles.has(`${row.level},${x},${z}`) || map.isMapBlocked(x, z, row.level)) continue;
        candidates.push([x, z]);
      }
    }
    for (const start of candidates) {
      let route;
      if (target.kind === 'loc') {
        route = map.findPathToLoc(row.level, start[0], start[1], row.x, row.z, 1,
          type.width, type.length, row.angle, row.shape, type.forceapproach);
      } else {
        route = map.findPathToEntity(row.level, start[0], start[1], row.x, row.z, 1, type.size, type.size);
      }
      const last = route.at(-1);
      const stand = last === undefined ? start : unpackTile(last);
      const reached = target.kind === 'loc'
        ? map.reachedLoc(row.level, stand[0], stand[1], row.x, row.z, type.width,
          type.length, 1, row.angle, row.shape, type.forceapproach)
        : map.reachedEntity(row.level, stand[0], stand[1], row.x, row.z, type.size, type.size, 1);
      if (!reached || !floorTiles.has(`${row.level},${stand[0]},${stand[1]}`) || map.isMapBlocked(stand[0], stand[1], row.level)) continue;
      const walk = packedWalk(row.level, start, stand, 32);
      if (walk) return { start: [row.level, ...start], stand: [row.level, ...stand], steps: walk.length };
    }
  }
  return null;
}

function rowDistance(row, anchor) {
  if (row.level !== anchor.level) return Number.MAX_SAFE_INTEGER;
  return Math.abs(row.x - anchor.x) + Math.abs(row.z - anchor.z);
}
function nativeTarget(kind, name, anchor = null) {
  const rows = (kind === 'npc' ? nativeNpcRows(name) : nativeLocRows(name)).slice();
  assert(rows.length, `cache-native map places ${kind} ${name}`);
  if (anchor) rows.sort((a, b) => rowDistance(a, anchor) - rowDistance(b, anchor));
  for (const row of rows) {
    const loc = kind === 'loc' ? locFor(row) : null;
    const target = {
      kind, name, row, loc,
      type: kind === 'npc' ? types.NpcType.get(row.id) : types.LocType.get(loc.type)
    };
    target.approach = approachFor(target);
    if (target.approach) return target;
  }
  assert.fail(`cache-native map has no collision-reachable approach for ${kind} ${name}`);
}

const sphinxAnchor = nativeNpcRows('ics_little_sphinx')[0];
assert(sphinxAnchor, 'the 377 map places the Icthlarin Sphinx');
const jarRoomAnchor = nativeLocRows('ics_little_pot_liver_multi')[0];
assert(jarRoomAnchor, 'the 377 map places the first canopic jar');
const sameMapLocRows = name => nativeLocRows(name).filter(row =>
  row.mx === jarRoomAnchor.mx && row.mz === jarRoomAnchor.mz);
function targetFromLocRow(name, row) {
  const loc = locFor(row);
  const target = { kind: 'loc', name, row, loc, type: types.LocType.get(loc.type) };
  target.approach = approachFor(target);
  assert(target.approach, `${name} has a packed collision-reachable approach`);
  return target;
}
const targetSpecs = {
  wanderer: nativeTarget('npc', 'ics_little_multi_wanderer'),
  sphinx: nativeTarget('npc', 'ics_little_sphinx'),
  highPriest: nativeTarget('npc', 'ics_little_hipriest_town'),
  embalmer: nativeTarget('npc', 'ics_little_embalmer'),
  carpenter: nativeTarget('npc', 'ics_little_carpenter'),
  linen: nativeTarget('npc', 'ics_little_linen1'),
  ceremonyHighPriest: nativeTarget('npc', 'ics_little_hipriest_ceremony'),
  ceremonyPriest: nativeTarget('npc', 'ics_little_priest_ceremony'),
  gate: nativeTarget('loc', 'clue_suggestion_list', sphinxAnchor),
  templeDoor: nativeTarget('loc', 'icthalarins_temple_door', sphinxAnchor),
  rockHole: nativeTarget('loc', 'ics_wall_crack', sphinxAnchor),
  rockPassage: nativeTarget('loc', 'ics_little_entrance_multi', sphinxAnchor),
  water: nativeTarget('loc', 'icthalarins_waters_edge', sphinxAnchor),
  suntrap: nativeTarget('loc', 'icthalarins_suntrap_centre', sphinxAnchor),
  evergreen: nativeTarget('loc', 'evergreen', sphinxAnchor),
  evergreenLarge: nativeTarget('loc', 'evergreen_large', sphinxAnchor),
  pyramidDoor: nativeTarget('loc', 'icthalarins_door', sphinxAnchor),
  puzzleDoor: nativeTarget('loc', 'doorway', jarRoomAnchor),
  secretDoor: nativeTarget('loc', 'icthalarins_tomb_secretdoor', jarRoomAnchor),
  liverJar: nativeTarget('loc', 'ics_little_pot_liver_multi', jarRoomAnchor),
  lungsJar: nativeTarget('loc', 'ics_little_pot_lungs_multi', jarRoomAnchor),
  stomachJar: nativeTarget('loc', 'ics_little_pot_stomach_multi', jarRoomAnchor),
  intestinesJar: nativeTarget('loc', 'ics_little_pot_intestines_multi', jarRoomAnchor),
  sarcophagus: nativeTarget('loc', 'sarcophagus', jarRoomAnchor),
  ceremonyTable: nativeTarget('loc', 'ics_ceremtable', jarRoomAnchor),
  ladder: nativeTarget('loc', 'ics_ladder', jarRoomAnchor)
};
function gateSideStand(target, north) {
  const { row, type } = target;
  const standsOnSide = z => north ? z > 2809 : z <= 2809;
  const isOperableStand = ([level, x, z]) => floorTiles.has(`${level},${x},${z}`) &&
    !map.isMapBlocked(x, z, level) &&
    map.reachedLoc(level, x, z, row.x, row.z, type.width, type.length, 1,
      row.angle, row.shape, type.forceapproach);
  if (!north) {
    const nativeStand = target.approach.stand;
    if (standsOnSide(nativeStand[2]) && isOperableStand(nativeStand)) return nativeStand;
  }
  for (let radius = 1; radius <= 8; radius++) {
    const candidates = [];
    for (let x = row.x - radius; x <= row.x + radius; x++) {
      for (let z = row.z - radius; z <= row.z + radius; z++) {
        if (Math.max(Math.abs(x - row.x), Math.abs(z - row.z)) !== radius || !standsOnSide(z)) continue;
        candidates.push([row.level, x, z]);
      }
    }
    candidates.sort((a, b) => Math.abs(a[1] - row.x) - Math.abs(b[1] - row.x) ||
      Math.abs(a[2] - row.z) - Math.abs(b[2] - row.z));
    for (const stand of candidates) {
      if (isOperableStand(stand)) return stand;
    }
  }
  assert.fail(`the packed city gate has no collision-clear ${north ? 'north' : 'city-side'} interaction bank`);
}
const gateNorthStand = gateSideStand(targetSpecs.gate, true);
const gateCityStand = gateSideStand(targetSpecs.gate, false);
targetSpecs.gate.approach = { start: gateNorthStand, stand: gateNorthStand, steps: 0 };
const pitRows = sameMapLocRows('ics_little_pit_to');
assert.equal(pitRows.length, 8, 'the 377 pyramid map places all eight source-native pit targets');
pitRows.forEach((row, index) => {
  targetSpecs[`pitTo${index + 1}`] = targetFromLocRow(`pitTo${index + 1}`, row);
});
pitRows.forEach((row, index) => {
  const target = targetSpecs[`pitTo${index + 1}`];
  assert(row.angle === 0 || row.angle === 2, `pit ${row.name} has a north/south orientation`);
  const stand = [row.level, row.x, row.z + (row.angle === 0 ? 1 : -1)];
  assert(floorTiles.has(tileKey(stand)), `${row.name} bank approach is packed-map floor`);
  assert.equal(map.isMapBlocked(stand[1], stand[2], stand[0]), false, `${row.name} bank approach is collision-clear`);
  assert(map.reachedLoc(stand[0], stand[1], stand[2], row.x, row.z, target.type.width,
    target.type.length, 1, row.angle, row.shape, target.type.forceapproach),
  `${row.name} bank approach is operable from its native orientation`);
  target.approach = { start: stand, stand, steps: 0 };
});
const jarDoorRows = sameMapLocRows('doorway').sort((a, b) => a.x - b.x);
assert.equal(jarDoorRows.length, 2, 'the 377 pyramid map places both adjacent jar-room doorways');
jarDoorRows.forEach((row, index) => {
  targetSpecs[`jarDoor${index + 1}`] = targetFromLocRow(`jarDoor${index + 1}`, row);
});
function jarDoorBanks(target) {
  const { row, type } = target;
  const insideLanding = [row.level, row.x, row.z - 1];
  const insideStand = [row.level, row.x, row.z];
  const outsideStand = [row.level, row.x, row.z + 1];
  for (const [side, tile] of [['inside landing', insideLanding], ['inside interaction stand', insideStand], ['outside interaction stand', outsideStand]]) {
    assert(floorTiles.has(tileKey(tile)), `${target.name} ${side} is packed-map floor`);
    assert.equal(map.isMapBlocked(tile[1], tile[2], tile[0]), false, `${target.name} ${side} is collision-clear`);
  }
  for (const [side, stand] of [['inside interaction stand', insideStand], ['outside interaction stand', outsideStand]]) {
    assert(map.reachedLoc(stand[0], stand[1], stand[2], row.x, row.z, type.width,
      type.length, 1, row.angle, row.shape, type.forceapproach),
    `${target.name} ${side} is operable from its native orientation`);
  }
  return { insideLanding, insideStand, outsideStand };
}
const westDoorBanks = jarDoorBanks(targetSpecs.jarDoor1);
const eastDoorBanks = jarDoorBanks(targetSpecs.jarDoor2);
const westDoorInside = westDoorBanks.insideLanding;
const westDoorOutside = westDoorBanks.outsideStand;
const eastDoorInside = eastDoorBanks.insideLanding;
const eastDoorInsideStand = eastDoorBanks.insideStand;
const eastDoorOutside = eastDoorBanks.outsideStand;
targetSpecs.jarDoor1.approach = { start: westDoorOutside, stand: westDoorOutside, steps: 0 };
targetSpecs.jarDoor2.approach = { start: eastDoorInsideStand, stand: eastDoorInsideStand, steps: 0 };
targetSpecs.puzzleDoor = targetSpecs.jarDoor1;
targetSpecs.eastSarcophagus = nativeTarget('loc', 'sarcophagus', jarDoorRows.at(-1));
const wallCrusherZones = new Set(['8,16', '24,16', '32,16', '40,16', '40,24', '32,32']);
const wallCrusherRows = sameMapLocRows('deserttreasure_wall_crusher').filter(row =>
  wallCrusherZones.has(`${row.localX & ~7},${row.localZ & ~7}`));
assert(wallCrusherRows.length, 'the 377 pyramid map places a wall-crusher loc in a timer-triggered corridor zone');
const wallCrusherRow = wallCrusherRows[0];
targetSpecs.wallCrusher = targetFromLocRow('wallCrusher', wallCrusherRow);
const pitCenterZ = (Math.min(...pitRows.map(row => row.z)) + Math.max(...pitRows.map(row => row.z))) / 2;
const pitKeyForRow = row => Object.keys(targetSpecs)
  .find(key => key.startsWith('pitTo') && targetSpecs[key].row === row);
function oppositePitRow(row) {
  const opposite = pitRows.filter(candidate =>
    candidate.x === row.x && (candidate.z < pitCenterZ) !== (row.z < pitCenterZ))
    .sort((a, b) => Math.abs(a.z - row.z) - Math.abs(b.z - row.z))[0];
  assert(opposite, `the cache map has a north/south pit counterpart at x=${row.x}`);
  return opposite;
}
const oppositePitKey = row => pitKeyForRow(oppositePitRow(row));
const packedApproaches = Object.entries(targetSpecs).map(([name, target]) => ({
  name,
  kind: target.kind,
  target: { id: target.row.id, x: target.row.x, z: target.row.z, level: target.row.level },
  stand: { x: target.approach.stand[1], z: target.approach.stand[2], level: target.approach.stand[0] }
}));
console.log(`PACKED_APPROACHES ${JSON.stringify(packedApproaches)}`);

const jarCases = [
  { selection: 1, key: 'liverJar', item: 'ics_little_canopic_jar_liver', pot: 'ics_little_pot_liver', visible: bit('ics_liverpot_vis'), guardian: 'ics_little_het' },
  { selection: 2, key: 'intestinesJar', item: 'ics_little_canopic_jar_intestines', pot: 'ics_little_pot_intestines', visible: bit('ics_intestinespot_vis'), guardian: 'ics_little_apmeken' },
  { selection: 3, key: 'stomachJar', item: 'ics_little_canopic_jar_stomach', pot: 'ics_little_pot_stomach', visible: bit('ics_stomachpot_vis'), guardian: 'ics_little_scabaras' },
  { selection: 4, key: 'lungsJar', item: 'ics_little_canopic_jar_lungs', pot: 'ics_little_pot_lungs', visible: bit('ics_lungpot_vis'), guardian: 'ics_little_crondis' }
];
const guardianTypes = new Set(jarCases.map(jar => npcType(jar.guardian)));
const ownedGuardians = p => [...World.npcs].filter(actor => actor.isActive && guardianTypes.has(actor.type) &&
  (Number(actor.getVar(npcAttackingUid)) >>> 0) === p.uid);
const pyramidConstants = 'quests/quest_ics_little/configs/ics_pyramid.constant';
const floorTrapTiles = [1, 2, 3].map(index =>
  tileOf(coordinateConstant(pyramidConstants, `ics_little_floor_trap_${index}`)));
for (const name of [
  'ics_little_amulet_of_catspeak', 'ics_little_canopic_jar_liver', 'ics_little_canopic_jar_intestines',
  'ics_little_canopic_jar_stomach', 'ics_little_canopic_jar_lungs', 'ics_little_holy_symbol',
  'ics_little_unholy_symbol', 'ics_little_linen', 'ics_little_bookofembalming',
  'ics_little_sap_bucket', 'ics_little_pileofsalt', 'ics_little_sphinxstatue', 'ics_little_saltwaterbucket'
]) requiredId(types.ObjType, name);
const originalQuestItems = [...types.ObjType.configNames.keys()].filter(name => name.startsWith('ics_little_'));
assert(originalQuestItems.length >= 13, 'all original Icthlarin quest items are present in the compiled pack');
for (const name of originalQuestItems) {
  assert.equal(types.ObjType.get(obj(name)).tradeable, false, `${name} is untradeable in its packed config`);
}

let playerSerial = 0;
function newPlayer() {
  const serial = ++playerSerial;
  const username37 = BigInt(50000 + serial);
  const hash64 = BigInt(100000 + serial);
  const p = new Player(`ics_little_test_${serial}`, username37, hash64);
  p.pid = serial;
  p.slot = serial;
  p.uid = ((Number(username37 & 0x1fffffn) << 11) | p.slot) >>> 0;
  p.vars.fill(0);
  p.stats.fill(getExpByLevel(99));
  p.baseLevels.fill(99);
  p.levels.fill(99);
  p.level = 0;
  p.x = 0;
  p.z = 0;
  p.originX = 0;
  p.originZ = 0;
  p.lastMovement = 0;
  p.isActive = true;
  p.packets = [];
  p.messages = [];
  p.write = packet => p.packets.push(packet);
  p.messageGame = message => p.messages.push(String(message));
  p.wrappedMessageGame = message => p.messages.push(String(message));
  p.tabs[3] = types.Component.get(invCom).rootLayer;
  p.tabs[4] = types.Component.get(wornCom).rootLayer;
  p.getInventory(inv);
  p.getInventory(worn);
  p.getInventory(bank);
  p.invListenOnCom(inv, invCom, p.uid);
  p.invListenOnCom(worn, wornCom, p.uid);
  p.setVar(varp('tutorial'), 1000);
  World.players[p.slot] = p;
  World.playerLoop.add(p.hash64, p);
  rsbuf.addPlayer(p.slot);
  return p;
}
function tickPlayer(p, count = 1) {
  for (let n = 0; n < count; n++) {
    p.resetEntity(false);
    World.currentTick++;
    if (p.delayed && World.currentTick >= p.delayedUntil) p.delayed = false;
    if (!p.delayed && p.activeScript?.execution === ScriptState.SUSPENDED) {
      p.executeScript(p.activeScript, true, true);
    }
    p.processQueues();
    if (!p.loggingOut) {
      p.processTimers(PlayerTimerType.NORMAL);
      p.processTimers(PlayerTimerType.SOFT);
    }
    p.processEngineQueue();
    p.processInteraction();
  }
}
function positionAtTile(p, tile, label = 'native tile', moveFollower = true) {
  const [level, x, z] = tile;
  assert(floorTiles.has(`${level},${x},${z}`), `${label} comes from packed-map floor`);
  assert.equal(map.isMapBlocked(x, z, level), false, `${label} is collision-clear in the packed map`);
  p.level = level;
  p.x = x;
  p.z = z;
  p.originX = x;
  p.originZ = z;
  p.buildArea.rebuild();
  const uid = p.getVar(followerUid);
  const follower = World.getNpcByUid(uid);
  if (moveFollower && follower && Number(follower.getVar(npcAttackingUid)) === p.uid) {
    follower.level = level;
    follower.x = x;
    follower.z = z;
    follower.lastMovement = World.currentTick;
  }
}
function positionAt(p, key) {
  positionAtTile(p, targetSpecs[key].approach.stand, `${key} stand`);
}
function positionAtEntityApproach(p, entity, label) {
  const target = {
    kind: 'npc',
    row: { level: entity.level, x: entity.x, z: entity.z },
    type: types.NpcType.get(entity.type)
  };
  const approach = approachFor(target);
  assert.notDeepEqual(approach.stand, tileOf(entity), `${label} stays off the NPC's occupied tile`);
  positionAtTile(p, approach.stand, label, false);
  assert(p.inOperableDistance(entity), `${label} is a collision-proved native interaction stand`);
}
const stage = p => p.getVarBit(stageBit);
const count = (p, name, inventory = inv) => p.invTotal(inventory, obj(name));
function give(p, name, amount = 1, inventory = inv) {
  assert.equal(p.invAdd(inventory, obj(name), amount), amount, `${name} is added to inventory ${inventory}`);
}
function removeItem(p, name, inventory = inv) {
  const items = p.getInventory(inventory);
  const slot = items.getItemIndex(obj(name));
  assert.notEqual(slot, -1, `${name} exists in inventory ${inventory}`);
  items.set(slot, null);
}
function removeSlot(p, slot) {
  assert(p.getInventory(inv).get(slot), `inventory slot ${slot} is occupied`);
  p.getInventory(inv).set(slot, null);
}
function fillInventory(p, name = 'coins') {
  const items = p.getInventory(inv);
  for (let slot = 0; slot < items.capacity; slot++) items.set(slot, { id: obj(name), count: 1 });
}
function textSince(p, packetStart = 0, messageStart = 0) {
  const packets = p.packets.slice(packetStart).map(packet => packet.text ?? packet.msg ?? '').filter(value => typeof value === 'string');
  return [...packets, ...p.messages.slice(messageStart)].join(' ').replace(/[|\s]+/g, ' ').trim();
}
function captureScripts(p, action) {
  const states = [];
  const execute = p.executeScript;
  p.executeScript = function(state, ...args) {
    const script = state.script;
    states.push({ state, script, name: script.name });
    return execute.call(this, state, ...args);
  };
  try { action(); }
  finally { p.executeScript = execute; }
  return states;
}
function finish(p, state, choices = []) {
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 500; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, `${state.script.name} does not abort`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      p.activeScript = state;
      const root = p.modalChat >= 0 ? types.Component.get(p.modalChat)?.comName ?? '' : '';
      if (/^multi[2-5]$/.test(root)) {
        assert(choices.length, `${state.script.name} supplies an explicit ${root} choice`);
        const selected = component(`${root}:com_${choices.shift()}`);
        assert(p.resumeButtons.includes(selected), `${root} offers the selected choice`);
        p.lastCom = selected;
        assert(buttonHandler.handle(new IfButton(selected), p), `${root} button handler accepts the choice`);
      } else {
        assert(pauseHandler.handle(new ResumePauseButton(0), p), `${state.script.name} continue button is accepted`);
      }
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else {
      assert.fail(`${state.script.name} has unexpected execution state ${state.execution}`);
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, `${state.script.name} finishes within the compiled VM bound`);
  assert.equal(choices.length, 0, `${state.script.name} consumes every selected dialogue answer`);
  p.delayed = false;
  return state;
}
function run(p, name, args = [], target = null) {
  const script = ScriptProvider.getByName(name);
  assert(script, `compiled script exists: ${name}`);
  const state = ScriptRunner.init(script, p, target, args);
  p.executeScript(state, true, true);
  return finish(p, state);
}
function runProc(p, name, args = [], target = null) { return run(p, `[proc,${name}]`, args, target); }
function runProcInt(p, name, args = [], target = null) { return runProc(p, name, args, target).popInt(); }
function nativeNpcActor(key) {
  const { row, type } = targetSpecs[key];
  const existing = [...World.npcs].find(npc => npc.type === row.id && npc.level === row.level && npc.x === row.x && npc.z === row.z);
  if (existing) return existing;
  const actor = new Npc(row.level, row.x, row.z, type.size, type.size, EntityLifeCycle.RESPAWN,
    World.npcs.next(), type.id, type.blockwalk);
  actor.lastMovement = -100;
  actor.baseLevels[NpcStat.HITPOINTS] = type.hitpoints;
  actor.levels[NpcStat.HITPOINTS] = type.hitpoints;
  World.addNpc(actor, -1);
  return actor;
}
function nativeTypeActor(p, name) {
  const type = types.NpcType.get(npcType(name));
  const actor = new Npc(p.level, p.x, p.z, type.size, type.size, EntityLifeCycle.RESPAWN,
    World.npcs.next(), type.id, type.blockwalk);
  actor.lastMovement = -100;
  actor.baseLevels[NpcStat.HITPOINTS] = type.hitpoints;
  actor.levels[NpcStat.HITPOINTS] = type.hitpoints;
  World.addNpc(actor, -1);
  return actor;
}
const actors = Object.fromEntries(Object.keys(targetSpecs)
  .filter(key => targetSpecs[key].kind === 'npc').map(key => [key, nativeNpcActor(key)]));
function showNpc(p, actor) {
  p.buildArea.rebuild();
  const appearance = p.generateAppearance();
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump, p.runDir, p.walkDir,
    p.visibility, p.isActive, p.masks, appearance, p.lastAppearance, p.faceEntity, p.faceSquareX, p.faceSquareZ,
    p.faceAngleX, p.faceAngleZ, p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[PlayerStat.HITPOINTS], p.baseLevels[PlayerStat.HITPOINTS], p.animId, p.animDelay, p.sayMessage,
    p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0, p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(actor.x, actor.level, actor.z, actor.nid, actor.type, actor.tele, actor.jump, actor.runDir, actor.walkDir,
    actor.isActive, actor.masks, actor.faceEntity, actor.faceSquareX, actor.faceSquareZ, actor.faceAngleX, actor.faceAngleZ,
    actor.hitmarkDamage, actor.hitmarkType, actor.hitmark2Damage, actor.hitmark2Type, actor.levels[NpcStat.HITPOINTS],
    actor.baseLevels[NpcStat.HITPOINTS], actor.animId, actor.animDelay, actor.sayMessage, actor.spotanimId,
    actor.spotanimHeight, actor.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, actor.nid), 'real map NPC is visible in the production client-info encoder');
}
function runInteraction(p, expected, choices, action) {
  const states = captureScripts(p, action);
  const dispatched = states.find(entry => entry.name === expected);
  assert(dispatched, `native packet dispatch executes ${expected}`);
  assert.equal(ScriptProvider.getByName(expected), dispatched.script, `${expected} is the packed compiled handler`);
  return finish(p, dispatched.state, choices);
}
function talkNpc(p, key, expected, choices = [], option = 1) {
  positionAt(p, key);
  const actor = actors[key];
  showNpc(p, actor);
  assert(npcWalker.handle(new OpNpc(option, actor.nid), p), `${key} client packet is accepted`);
  assert.equal(p.target, actor, `${key} is the real interaction target`);
  assert(p.validateTarget(), `${key} remains a valid native target`);
  assert(p.inOperableDistance(actor), `${key} packed-map stand is operable`);
  assert.equal(p.getOpTrigger()?.name, expected, `${key} selects its visible-form handler`);
  return runInteraction(p, expected, choices, () => p.processInteraction());
}
function useItemOnNpc(p, item, key, expected, choices = []) {
  positionAt(p, key);
  const actor = actors[key];
  showNpc(p, actor);
  const itemId = obj(item);
  const slot = p.getInventory(inv).getItemIndex(itemId);
  assert.notEqual(slot, -1, `${item} is carried for use on ${key}`);
  assert(npcUse.handle(new OpNpcU(actor.nid, itemId, slot, invCom), p), `native Use ${item} on ${key} is accepted`);
  assert.equal(p.lastUseItem, itemId, `${key} dispatch records the selected held item`);
  assert.equal(p.target, actor, `${key} remains the real item-use target`);
  assert(p.validateTarget(), `${key} is a valid native item-use target`);
  assert.equal(p.getOpTrigger()?.name, expected, `${key} resolves the visible item-use handler`);
  return runInteraction(p, expected, choices, () => p.processInteraction());
}
function useItemOnLoc(p, item, key, expected, choices = []) {
  positionAt(p, key);
  const target = targetSpecs[key].loc;
  const itemId = obj(item);
  const slot = p.getInventory(inv).getItemIndex(itemId);
  assert.notEqual(slot, -1, `${item} is carried for use on ${key}`);
  assert(p.inOperableDistance(target), `${key} native location has a packed-map interaction stand`);
  assert(locUse.handle(new OpLocU(target.x, target.z, target.type, itemId, slot, invCom), p),
    `native Use ${item} on ${key} packet is accepted`);
  assert.equal(p.target, target, `${key} is the real loc target`);
  assert(p.validateTarget(), `${key} remains valid after native Use`);
  assert.equal(p.getOpTrigger()?.name, expected, `${key} selects its visible location handler`);
  return runInteraction(p, expected, choices, () => p.processInteraction());
}
function interactLoc(p, key, option, expected, choices = [], standTile = null) {
  if (standTile) positionAtTile(p, standTile, `${key} requested native stand`);
  else positionAt(p, key);
  const target = targetSpecs[key].loc;
  assert(p.inOperableDistance(target), `${key} native location has a packed-map interaction stand`);
  assert(locOption.handle(new OpLoc(option, target.x, target.z, target.type), p), `${key} native option packet is accepted`);
  assert.equal(p.target, target, `${key} is the real loc target`);
  assert(p.validateTarget(), `${key} remains valid as a native location`);
  assert.equal(p.getOpTrigger()?.name, expected, `${key} resolves the visible native location form`);
  return runInteraction(p, expected, choices, () => p.processInteraction());
}
function clickPuzzleCell(p, row, column) {
  const name = `inter_96:com_${4 + row * 5 + column}`;
  const button = component(name);
  assert.notEqual(button, -1, `cache-native puzzle button ${name} exists`);
  assert(buttonHandler.handle(new IfButton(button), p), `native tile-puzzle packet accepts ${name}`);
}
function itemOption(p, name, option = 5, choices = []) {
  const itemId = obj(name);
  const slot = p.getInventory(inv).getItemIndex(itemId);
  assert.notEqual(slot, -1, `${name} is present for its native inventory option`);
  const type = types.ObjType.get(itemId);
  const expected = ScriptProvider.getByTrigger(ServerTriggerType.OPHELD1 + option - 1, type.id, type.category);
  const executions = captureScripts(p, () => {
    assert(heldOption.handle(new OpHeld(option, itemId, slot, invCom), p), `${name} inventory option ${option} packet is accepted`);
  });
  const dispatched = executions.at(-1);
  if (expected) assert.equal(dispatched?.name, expected.name, `${name} selects its packed item-option handler`);
  if (dispatched) finish(p, dispatched.state, choices);
  else assert.equal(choices.length, 0, `${name} has no unconsumed item-option choices`);
  return dispatched?.state ?? null;
}
function assertQuestColour(p, value) {
  const start = p.packets.length;
  run(p, '[proc,update_questlist]');
  const packet = p.packets.slice(start).filter(item => item.constructor.name === 'IfSetColour' && item.component === questRow).at(-1);
  assert(packet, `quest-list refresh emits Icthlarin's Little Helper colour at stage ${value}`);
  const expected = value === 0 ? 31 << 10 : value >= questComplete ? 31 << 5 : (31 << 10) | (31 << 5);
  assert.equal(packet.colour, expected, `stage ${value} has the correct quest-list state`);
}
function assertPackedArrival(entity, label) {
  const tile = tileOf(entity);
  assert(floorTiles.has(tileKey(tile)), `${label} lands on cache-native floor`);
  assert.equal(map.isMapBlocked(tile[1], tile[2], tile[0]), false, `${label} lands on an unblocked packed tile`);
}
function assertRouteTo(p, key, label) {
  const destination = targetSpecs[key].approach.stand;
  const route = packedWalk(p.level, [p.x, p.z], [destination[1], destination[2]], 96);
  assert(route, `${label} has a real packed collision route to ${key}`);
  return route;
}
function assertNonemptyRouteTo(p, key, label) {
  const route = assertRouteTo(p, key, label);
  assert(route.length > 0, `${label} has a nonempty route to independent native target ${key}`);
  return route;
}
function assertIndependentPathOut(entity, label, blockedTiles = null) {
  const [level, x, z] = tileOf(entity);
  for (let radius = 2; radius <= 12; radius++) {
    const candidates = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const candidate = [x + dx, z + dz];
        const key = `${level},${candidate[0]},${candidate[1]}`;
        if (!floorTiles.has(key) || map.isMapBlocked(candidate[0], candidate[1], level) ||
            blockedTiles?.has(key)) continue;
        candidates.push(candidate);
      }
    }
    for (const [targetX, targetZ] of candidates) {
      const route = packedWalk(level, [x, z], [targetX, targetZ], 96, blockedTiles);
      if (route?.length) return { tile: [level, targetX, targetZ], route };
    }
  }
  assert.fail(`${label} has no nonempty collision-clear route to an independent same-area map tile`);
}
function jumpPit(p, key, label) {
  const source = targetSpecs[key].row;
  const stageBefore = stage(p);
  const energyBefore = p.runenergy;
  assert(energyBefore >= 2000, `${label} starts above the sourced 20% run-energy threshold`);
  interactLoc(p, key, 2, '[oploc2,ics_little_pit_to]');
  assertPackedArrival(p, label);
  assert.equal(p.level, source.level, `${label} stays on the source pit's packed map plane`);
  assert.equal(p.x, source.x, `${label} preserves the native pit x-coordinate`);
  assert.notEqual(p.z < pitCenterZ, source.z < pitCenterZ, `${label} crosses to the opposite north/south bank`);
  assertIndependentPathOut(p, `${label} landing`);
  assert.equal(p.runenergy, energyBefore, `${label} does not drain unsourced run energy`);
  assert.equal(stage(p), stageBefore === 7 ? 8 : stageBefore === 12 ? 13 : stageBefore,
    `${label} advances only the sourced stage-7 or stage-12 crossing`);
  if (stageBefore === 12) {
    assert.equal(count(p, 'ics_little_holy_symbol'), 0, `${label} transforms the holy symbol`);
    assert.equal(count(p, 'ics_little_unholy_symbol'), 1, `${label} produces the unholy symbol`);
  }
  const routeKey = oppositePitKey(source);
  assertRouteTo(p, routeKey, `${label} opposite bank`);
  return routeKey;
}
function addOwnedCat(p, catName = 'kittenpet1') {
  const id = npcType(catName);
  runProc(p, 'cat_spawn', [id]);
  const catUid = p.getVar(followerUid);
  const cat = World.getNpcByUid(catUid);
  assert(cat && cat.isActive, 'cat_spawn creates a live native NPC follower');
  assert.equal(p.getVar(followerObj), obj('kittenobject'), 'the follower item is the real kitten object');
  assert.equal(Number(cat.getVar(npcAttackingUid)) >>> 0, p.uid, 'the cat NPC stores this player as its owner');
  assert.equal(cat.targetOp, NpcMode.PLAYERFOLLOW, 'the actual cat is in the player-follow mode');
  return cat;

}
function pickUpOwnedCat(p, cat) {
  positionAtEntityApproach(p, cat, 'owned-cat Pick-up stand');
  showNpc(p, cat);
  const catUid = cat.uid;
  assert(npcWalker.handle(new OpNpc(1, cat.nid), p), 'native Pick-up packet targets the player’s actual cat');
  assert.equal(p.target, cat, 'Pick-up is dispatched to the current follower entity');
  assert.equal(p.getOpTrigger()?.name, '[opnpc1,_petcat]', 'the client selects the native pet Pick-up handler');
  runInteraction(p, '[opnpc1,_petcat]', [], () => p.processInteraction());
  assert.equal(count(p, 'kittenobject'), 1, 'native Pick-up returns the kitten object to inventory');
  assert(!cat.isActive || World.getNpcByUid(catUid) !== cat, 'native Pick-up removes the live follower NPC');
}

// The start gate requires Gertrude's Cat and the player's real owned follower.
const noCat = newPlayer();
noCat.setVar(varp('fluffs'), 6);
positionAt(noCat, 'wanderer');
const noCatTextStart = noCat.packets.length;
talkNpc(noCat, 'wanderer', '[opnpc1,ics_little_redheadlady]');
assert.equal(stage(noCat), 0, 'no cat leaves the quest unstarted');
assert(textSince(noCat, noCatTextStart).includes('Bring your cat'), 'the Wanderer explains the missing follower gate');

const fakeCat = newPlayer();
fakeCat.setVar(varp('fluffs'), 6);
fakeCat.setVar(followerObj, obj('kittenobject'));
fakeCat.setVar(followerUid, -1);
const fakeStart = fakeCat.packets.length;
talkNpc(fakeCat, 'wanderer', '[opnpc1,ics_little_redheadlady]');
assert.equal(stage(fakeCat), 0, 'a fake follower_obj without a live NPC does not start the quest');
assert(textSince(fakeCat, fakeStart).includes('Bring your cat'), 'the fake follower is rejected by the native quest gate');

const foreignOwner = newPlayer();
foreignOwner.setVar(varp('fluffs'), 6);
positionAt(foreignOwner, 'wanderer');
const foreignCat = addOwnedCat(foreignOwner);
const foreignPlayer = newPlayer();
foreignPlayer.setVar(varp('fluffs'), 6);
foreignPlayer.setVar(followerObj, foreignOwner.getVar(followerObj));
foreignPlayer.setVar(followerUid, foreignOwner.getVar(followerUid));
const foreignStart = foreignPlayer.packets.length;
talkNpc(foreignPlayer, 'wanderer', '[opnpc1,ics_little_redheadlady]');
assert.equal(stage(foreignPlayer), 0, 'another player’s cat cannot satisfy the owned-follower prerequisite');
assert.equal(Number(foreignCat.getVar(npcAttackingUid)) >>> 0, foreignOwner.uid, 'foreign cat ownership stays with its real owner');
assert(textSince(foreignPlayer, foreignStart).includes('Bring your cat'), 'Wanderer rejects the other player’s cat');

const unfinishedGertrude = newPlayer();
unfinishedGertrude.setVar(varp('fluffs'), 5);
addOwnedCat(unfinishedGertrude);
const unfinishedStart = unfinishedGertrude.packets.length;
talkNpc(unfinishedGertrude, 'wanderer', '[opnpc1,ics_little_redheadlady]');
assert.equal(stage(unfinishedGertrude), 0, 'incomplete Gertrude’s Cat leaves Icthlarin unstarted');
assert(textSince(unfinishedGertrude, unfinishedStart).includes('Gertrude'), 'Wanderer names the required prerequisite');

// Mainline starts only after the real follower and prerequisite both pass.
const p = newPlayer();
p.setVar(varp('fluffs'), 6);
const cat = addOwnedCat(p);
assert.equal(Number(cat.getVar(npcAttackingUid)) >>> 0, p.uid);
assertQuestColour(p, 0);
const declined = p.packets.length;
talkNpc(p, 'wanderer', '[opnpc1,ics_little_redheadlady]', [2]);
assert.equal(stage(p), 0, 'declining the Wanderer does not start the quest');
assertQuestColour(p, 0);
talkNpc(p, 'wanderer', '[opnpc1,ics_little_redheadlady]', [1]);
assert.equal(stage(p), 1, 'accepting the Wanderer writes the supplies stage');
assertQuestColour(p, 1);
pickUpOwnedCat(p, cat);
assert.equal(stage(p), 1, 'the accepted quest remains in stage 1 after picking up the cat');

// Talk and native Use preserve supplies until a complete pair is delivered.
const talkSuppliesStart = p.packets.length;
talkNpc(p, 'wanderer', '[opnpc1,ics_little_redheadlady]');
assert.equal(stage(p), 1, 'talking without supplies keeps stage 1 retryable');
assert(textSince(p, talkSuppliesStart).includes('waterskin'), 'the Wanderer requests a full waterskin and tinderbox');
give(p, 'water_skin4');
useItemOnNpc(p, 'water_skin4', 'wanderer', '[opnpcu,ics_little_redheadlady]');
assert.equal(count(p, 'water_skin4'), 1, 'a partial supply is not consumed');
assert.equal(stage(p), 1, 'a partial supply does not start hypnosis');
give(p, 'tinderbox');
const hypnosisBefore = p.packets.length;
useItemOnNpc(p, 'water_skin4', 'wanderer', '[opnpcu,ics_little_redheadlady]');
assert.equal(count(p, 'water_skin4'), 0, 'successful hypnosis consumes one full waterskin');
assert.equal(count(p, 'tinderbox'), 0, 'successful hypnosis consumes one tinderbox');
assert.equal(stage(p), 2, 'the actual Use-on-Wanderer action writes stage 2');
itemOption(p, 'kittenobject', 5);
assert.equal(count(p, 'kittenobject'), 0, 'native drop turns the stored kitten item back into a follower');
const restoredCat = World.getNpcByUid(p.getVar(followerUid));
assert(restoredCat?.isActive, 'the actual cat is restored as a live follower before the Sphinx visit');
assert.equal(Number(restoredCat.getVar(npcAttackingUid)) >>> 0, p.uid, 'the restored cat remains owned by this player');
assertQuestColour(p, 2);
assertPackedArrival(p, 'hypnosis wake');
assertNonemptyRouteTo(p, 'templeDoor', 'hypnosis wake');
assert.equal(p.getVarBit(bit('ics_ent_open')), 1, 'hypnosis writes the visible rock-entrance morph');
assertNonemptyRouteTo(p, 'rockHole', 'hypnosis wake');
interactLoc(p, 'rockHole', 1, '[oploc1,ics_wall_crack]');
assert.equal(stage(p), 2, 'the wall-crack escape leaves stage 2 unchanged');
assertPackedArrival(p, 'wall-crack escape landing');
assertIndependentPathOut(p, 'wall-crack escape landing');
assertNonemptyRouteTo(p, 'rockPassage', 'wall-crack escape landing');
interactLoc(p, 'rockPassage', 1, '[oploc1,icthal_entrance_open]');
assert.equal(stage(p), 2, 'the opened rock passage leaves stage 2 unchanged');
assertPackedArrival(p, 'opened rock-passage landing');
assertIndependentPathOut(p, 'opened rock-passage landing');
assertNonemptyRouteTo(p, 'templeDoor', 'opened rock-passage landing');
interactLoc(p, 'templeDoor', 1, '[oploc1,icthalarins_temple_door]');
assert.equal(stage(p), 2, 'Touch enters the pyramid without skipping the first jar puzzle');
assertPackedArrival(p, 'native temple-door entry');
assertNonemptyRouteTo(p, 'ladder', 'native temple-door entry');
const northPitRow = pitRows.reduce((north, row) => row.z < north.z ? row : north);
const northPitKey = pitKeyForRow(northPitRow);
assertNonemptyRouteTo(p, northPitKey, 'entered pyramid');
const southPitKey = jumpPit(p, northPitKey, 'stage-2 native Jump-Across');
assert.equal(southPitKey, pitKeyForRow(oppositePitRow(northPitRow)), 'north pit root faces its same-x southern counterpart');
const returnPitKey = jumpPit(p, southPitKey, 'stage-2 return Jump-Across');
assert.equal(returnPitKey, northPitKey, 'south pit root returns to the north bank');
assertNonemptyRouteTo(p, 'ladder', 'stage-2 pyramid return');
interactLoc(p, 'ladder', 1, '[oploc1,ics_ladder]');
assert.equal(stage(p), 2, 'the native ladder exit does not alter quest progress');
assertPackedArrival(p, 'native ladder exit');
assertNonemptyRouteTo(p, 'templeDoor', 'safe pyramid exit');
assert(textSince(p, hypnosisBefore).includes('wake in Sophanem'), 'hypnosis displays the wake-up text');
interactLoc(p, 'templeDoor', 1, '[oploc1,icthalarins_temple_door]');
assert.equal(stage(p), 2, 'a second Touch re-enters the stage-2 pyramid');
assertPackedArrival(p, 'stage-2 re-entry');
assertNonemptyRouteTo(p, northPitKey, 'stage-2 southern re-entry');
jumpPit(p, northPitKey, 'stage-2 re-entry Jump-Across');
assertNonemptyRouteTo(p, 'puzzleDoor', 'stage-2 west-chamber puzzle route');
const puzzleHp = p.baseLevels[PlayerStat.HITPOINTS];
p.levels[PlayerStat.HITPOINTS] = 1;
interactLoc(p, 'puzzleDoor', 1, '[oploc1,doorway]');
clickPuzzleCell(p, 0, 0);
clickPuzzleCell(p, 2, 2);
clickPuzzleCell(p, 4, 4);
assert.equal(stage(p), 3, 'the actual tile-button sequence completes the native west-door puzzle');
const selectedJar = jarCases.find(jar => jar.selection === p.getVarBit(jarMultiBit));
assert(selectedJar, 'puzzle completion records one of the four native jar selections');
for (const jar of jarCases) {
  assert.equal(count(p, jar.item), jar === selectedJar ? 1 : 0,
    `puzzle completion awards only the selected ${jar.item}`);
}
assert.equal(p.levels[PlayerStat.HITPOINTS], puzzleHp, 'native puzzle completion restores all Hitpoints');
assertPackedArrival(p, 'native puzzle completion surface landing');
assertNonemptyRouteTo(p, 'templeDoor', 'native puzzle completion surface landing');

function fixtureStage(p, value) {
  p.setVarBit(stageBit, value);
  assert.equal(stage(p), value, `offline fixture begins at reachable quest stage ${value}`);
}
const closedGate = newPlayer();
fixtureStage(closedGate, 2);
positionAt(closedGate, 'rockPassage');
assertNonemptyRouteTo(closedGate, 'gate', 'stage-2 outside restricted-gate approach');
const closedGateTextStart = closedGate.packets.length;
interactLoc(closedGate, 'gate', 1, '[oploc1,clue_suggestion_list]');
assert.equal(stage(closedGate), 2, 'the restricted gate leaves stage 2 unchanged');
assert.deepEqual(tileOf(closedGate), gateNorthStand, 'stage-2 gate refusal leaves the player on the approach bank');
assert(textSince(closedGate, closedGateTextStart).includes('The city is closed'),
  'the native gate rejects the restricted stage-2 route');
assertNonemptyRouteTo(closedGate, 'rockPassage', 'stage-2 gate refusal outside route');

const cityGate = newPlayer();
fixtureStage(cityGate, 2);
positionAt(cityGate, 'templeDoor');
const cityGateRoute = packedWalk(cityGate.level, [cityGate.x, cityGate.z],
  [gateCityStand[1], gateCityStand[2]], 96);
assert(cityGateRoute?.length, 'the stage-2 city-side approach has a nonempty packed collision route');
interactLoc(cityGate, 'gate', 1, '[oploc1,clue_suggestion_list]', [], gateCityStand);
assert.equal(stage(cityGate), 2, 'the ordinary city-gate teleport leaves stage 2 unchanged');
assertPackedArrival(cityGate, 'stage-2 city-gate landing');
assertIndependentPathOut(cityGate, 'stage-2 city-gate landing');
assertNonemptyRouteTo(cityGate, 'rockPassage', 'stage-2 city-gate outside landing');

const openGate = newPlayer();
fixtureStage(openGate, 5);
positionAt(openGate, 'rockPassage');
assertNonemptyRouteTo(openGate, 'gate', 'stage-5 outside restricted-gate approach');
interactLoc(openGate, 'gate', 1, '[oploc1,clue_suggestion_list]');
assert.equal(stage(openGate), 5, 'the open pyramid gate leaves stage 5 unchanged');
assertPackedArrival(openGate, 'stage-5 pyramid-gate landing');
assertIndependentPathOut(openGate, 'stage-5 pyramid-gate landing');
assertNonemptyRouteTo(openGate, 'templeDoor', 'stage-5 pyramid-gate landing');

const touchWithoutCat = newPlayer();
fixtureStage(touchWithoutCat, 2);
assert.equal(count(touchWithoutCat, 'kittenobject'), 0, 'stage-2 Touch fixture has no cat item');
assert.equal(count(touchWithoutCat, 'ics_little_amulet_of_catspeak'), 0, 'stage-2 Touch needs no Catspeak amulet');
interactLoc(touchWithoutCat, 'templeDoor', 1, '[oploc1,icthalarins_temple_door]');
assert.equal(stage(touchWithoutCat), 2, 'stage-2 Touch enters without a cat or amulet');
assertPackedArrival(touchWithoutCat, 'stage-2 Touch without cat');
assertIndependentPathOut(touchWithoutCat, 'stage-2 Touch without cat');
assertNonemptyRouteTo(touchWithoutCat, 'ladder', 'stage-2 Touch without cat');

// Stage 3: only a real follower can answer the Sphinx; answer two is nine.
const sphinxNoCat = newPlayer();
fixtureStage(sphinxNoCat, 3);
const noCatSphinxStart = sphinxNoCat.packets.length;
talkNpc(sphinxNoCat, 'sphinx', '[opnpc1,ics_little_sphinx]');
assert.equal(stage(sphinxNoCat), 3, 'the Sphinx will not advance without the owned cat');
assert(textSince(sphinxNoCat, noCatSphinxStart).includes('cat'), 'the Sphinx explains the missing follower');

const wrongRiddle = newPlayer();
fixtureStage(wrongRiddle, 3);
addOwnedCat(wrongRiddle);
const wrongRiddleStart = wrongRiddle.packets.length;
talkNpc(wrongRiddle, 'sphinx', '[opnpc1,ics_little_sphinx]', [1]);
assert.equal(stage(wrongRiddle), 3, 'an incorrect family answer is retryable');
assert.equal(count(wrongRiddle, 'ics_little_sphinxstatue'), 0, 'an incorrect answer awards no token');
assert(textSince(wrongRiddle, wrongRiddleStart).includes('not the answer'), 'the Sphinx rejects the incorrect answer');

const tokenQuest = newPlayer();
fixtureStage(tokenQuest, 3);
addOwnedCat(tokenQuest);
fillInventory(tokenQuest);
talkNpc(tokenQuest, 'sphinx', '[opnpc1,ics_little_sphinx]', [2]);
assert.equal(stage(tokenQuest), 3, 'a full inventory prevents the Sphinx token stage change');
assert.equal(count(tokenQuest, 'ics_little_sphinxstatue'), 0, 'the token is not lost into a full inventory');
removeSlot(tokenQuest, 0);
talkNpc(tokenQuest, 'sphinx', '[opnpc1,ics_little_sphinx]', [2]);
assert.equal(stage(tokenQuest), 4, 'the correct answer writes the token stage');
assert.equal(count(tokenQuest, 'ics_little_sphinxstatue'), 1, 'the correct answer awards the Sphinx token');
assertQuestColour(tokenQuest, 4);
itemOption(tokenQuest, 'ics_little_sphinxstatue', 5);
talkNpc(tokenQuest, 'highPriest', '[opnpc1,ics_little_hipriest_vis]');
assert.equal(stage(tokenQuest), 4, 'the High Priest does not accept a missing token');
assert.equal(count(tokenQuest, 'ics_little_sphinxstatue'), 0, 'missing-token retry does not synthesize a token');
talkNpc(tokenQuest, 'sphinx', '[opnpc1,ics_little_sphinx]');
assert.equal(count(tokenQuest, 'ics_little_sphinxstatue'), 1, 'the Sphinx replaces a dropped token at stage 4');
talkNpc(tokenQuest, 'highPriest', '[opnpc1,ics_little_hipriest_vis]');
assert.equal(stage(tokenQuest), 5, 'the High Priest accepts the returned token and advances to stage 5');
assert.equal(count(tokenQuest, 'ics_little_sphinxstatue'), 0, 'the High Priest consumes the returned token');
assertQuestColour(tokenQuest, 5);

// Stage 5 Open is cat-gated, while the west wall crossing itself does not spawn a guardian.
const stage5NoCat = newPlayer();
fixtureStage(stage5NoCat, 5);
positionAt(stage5NoCat, 'templeDoor');
const stage5NoCatStand = tileOf(stage5NoCat);
interactLoc(stage5NoCat, 'templeDoor', 3, '[oploc3,icthalarins_temple_door]');
assert.equal(stage(stage5NoCat), 5, 'stage-5 temple Open without the owned cat is refused');
assert.deepEqual(tileOf(stage5NoCat), stage5NoCatStand, 'refused Open leaves the player outside');
assert.equal(count(stage5NoCat, 'ics_little_amulet_of_catspeak'), 0, 'stage-5 Open does not require the Catspeak amulet');
assert.equal(ownedGuardians(stage5NoCat).length, 0, 'a refused Open creates no guardian');

const firstGuardian = jarCases[0];
const stage5Owner = newPlayer();
fixtureStage(stage5Owner, 5);
const stage5Cat = addOwnedCat(stage5Owner);
give(stage5Owner, firstGuardian.item);
stage5Owner.setVarBit(jarMultiBit, firstGuardian.selection);
stage5Owner.setVarBit(firstGuardian.visible, 0);
interactLoc(stage5Owner, 'templeDoor', 3, '[oploc3,icthalarins_temple_door]');
assert.equal(stage(stage5Owner), 5, 'owned-cat Open enters without skipping stage 5');
assert.equal(count(stage5Owner, 'ics_little_amulet_of_catspeak'), 0, 'owned-cat Open works without the amulet');
assertPackedArrival(stage5Owner, 'stage-5 owned-cat Open landing');
assertIndependentPathOut(stage5Owner, 'stage-5 owned-cat Open landing');
assertNonemptyRouteTo(stage5Owner, northPitKey, 'stage-5 southern temple entry');
jumpPit(stage5Owner, northPitKey, 'stage-5 native entry Jump-Across');
assertNonemptyRouteTo(stage5Owner, 'puzzleDoor', 'stage-5 owned-cat Open landing');
interactLoc(stage5Owner, 'puzzleDoor', 1, '[oploc1,doorway]', [], westDoorOutside);
assert.deepEqual(tileOf(stage5Owner), westDoorInside, 'west doorway Open lands at the native inside counterpart');
assertPackedArrival(stage5Owner, 'stage-5 west doorway crossing');
assertNonemptyRouteTo(stage5Owner, firstGuardian.key, 'stage-5 west doorway crossing');
assert.equal(stage(stage5Owner), 5, 'the west doorway crossing leaves stage 5 unchanged');
assert.equal(ownedGuardians(stage5Owner).length, 0, 'the west doorway does not spawn a guardian before pot Take');
interactLoc(stage5Owner, firstGuardian.key, 1, `[oploc1,${firstGuardian.pot}]`);
assert.equal(stage(stage5Owner), 6, 'the selected pot Take starts the stage-5 guardian');
assert.equal(count(stage5Owner, firstGuardian.item), 1, 'taking a pot does not duplicate the already-carried jar');
const stage5Guardians = ownedGuardians(stage5Owner);
assert.equal(stage5Guardians.length, 1, 'stage-5 pot Take creates one owner-bound guardian');
assert.equal(stage5Guardians[0].type, npcType(firstGuardian.guardian), 'stage-5 pot selects the native guardian');
World.removeNpc(stage5Guardians[0], -1);
World.removeNpc(stage5Cat, -1);

const admissionProcs = ['npc_is_attackable', 'npc_is_attackable_opt', 'npc_is_attackable_opt_quiet'];
function assertAdmissions(p, actor, expected, label) {
  for (const proc of admissionProcs) {
    assert.equal(runProcInt(p, proc, [], actor), expected, `${label}: ${proc} admission`);
  }
}
// Each stage-6 selected pot restarts its owner encounter; a missing jar is recovered only once.
for (const jar of jarCases) {
  const p = newPlayer();
  fixtureStage(p, 6);
  const cat = addOwnedCat(p);
  p.setVarBit(jarMultiBit, jar.selection);
  p.setVarBit(jar.visible, 0);
  if (jar.selection !== firstGuardian.selection) give(p, jar.item);
  else assert.equal(count(p, jar.item), 0, 'stage-6 missing-jar fixture starts without its selected item');
  interactLoc(p, jar.key, 1, `[oploc1,${jar.pot}]`);
  assert.equal(stage(p), 6, `${jar.pot} Take keeps the guardian stage retryable`);
  assert.equal(count(p, jar.item), 1, `${jar.pot} Take restores or preserves exactly one selected jar`);
  const owners = ownedGuardians(p);
  assert.equal(owners.length, 1, `${jar.guardian} is spawned once and owned by this player`);
  const guardian = owners[0];
  assert.equal(guardian.type, npcType(jar.guardian), `${jar.pot} selects its native guardian`);
  let activeGuardian = guardian;
  assert.equal(runProcInt(p, 'ics_little_guardian', [], guardian), 1,
    `${jar.guardian} is in the compiled magic-immunity set`);
  assert.equal(runProcInt(p, 'npc_is_attackable', [], guardian), 1, `${jar.guardian} owner retains melee admission`);
  assert.equal(runProcInt(p, 'npc_is_attackable_opt', [], guardian), 0, `${jar.guardian} rejects magic admission`);
  assert.equal(runProcInt(p, 'npc_is_attackable_opt_quiet', [], guardian), 0,
    `${jar.guardian} rejects quiet area-scan magic admission`);
  if (jar === firstGuardian) {
    const foreign = newPlayer();
    fixtureStage(foreign, 6);
    positionAt(foreign, jar.key);
    assertAdmissions(foreign, guardian, 0, 'foreign player cannot attack another owner’s guardian');
    p.setVarBit(stageBit, 7);
    assertAdmissions(p, guardian, 0, 'guardian admission closes after its stage');
    p.setVarBit(stageBit, 6);
    positionAt(p, 'templeDoor');
    assertAdmissions(p, guardian, 0, 'guardian admission closes when its owner leaves the pyramid');
    const ordinaryMan = nativeTypeActor(p, 'man');
    assert.equal(runProcInt(p, 'ics_little_guardian', [], ordinaryMan), 0,
      'an ordinary NPC is not classified as a guardian');
    assertAdmissions(p, ordinaryMan, 1, 'ordinary NPCs retain all attack admission');
    World.removeNpc(ordinaryMan, -1);
    World.removeNpc(guardian, -1);
    interactLoc(p, jar.key, 1, `[oploc1,${jar.pot}]`);
    const retried = ownedGuardians(p);
    assert.equal(retried.length, 1, `${jar.pot} Take retries a missing stage-6 guardian`);
    assert.notEqual(retried[0], guardian, 'the guardian retry creates a new native actor');
    assert.equal(count(p, jar.item), 1, `${jar.pot} retry does not duplicate the restored jar`);
    activeGuardian = retried[0];
  }
  World.removeNpc(activeGuardian, -1);
  World.removeNpc(cat, -1);
}

const trapDamage = integerConstant('quests/quest_ics_little/configs/ics_pyramid.constant', 'ics_little_trap_damage');
const trapTimer = p => p.timers.get(trapTimerScript.id);
for (const [index, tile] of floorTrapTiles.entries()) {
  const p = newPlayer();
  fixtureStage(p, 2);
  assert(floorTiles.has(tileKey(tile)), `floor trap ${index + 1} is on packed-map floor`);
  assert.equal(map.isMapBlocked(tile[1], tile[2], tile[0]), false, `floor trap ${index + 1} is reachable floor`);
  const hp = p.levels[PlayerStat.HITPOINTS];
  p.teleport(tile[1], tile[2], tile[0]);
  tickPlayer(p);
  assert(trapTimer(p), `floor trap ${index + 1} enters its native zone timer`);
  tickPlayer(p, 2);
  assert.equal(hp - p.levels[PlayerStat.HITPOINTS], trapDamage, `floor trap ${index + 1} damages through the timer`);
  assert.equal(stage(p), 2, `floor trap ${index + 1} does not alter quest progress`);
  assertPackedArrival(p, `floor trap ${index + 1} fail landing`);
  assertIndependentPathOut(p, `floor trap ${index + 1} fail landing`);
}

const wallCrusher = targetSpecs.wallCrusher;
assert.equal(wallCrusher.row.id, requiredId(types.LocType, 'deserttreasure_wall_crusher'),
  'the timer target is the original cache-native wall-crusher loc');
const wallCrusherPlayer = newPlayer();
fixtureStage(wallCrusherPlayer, 2);
const wallCrusherHp = wallCrusherPlayer.levels[PlayerStat.HITPOINTS];
wallCrusherPlayer.teleport(wallCrusher.row.x, wallCrusher.row.z, wallCrusher.row.level);
tickPlayer(wallCrusherPlayer);
assert(trapTimer(wallCrusherPlayer), 'wall-crusher corridor entry starts its native timer');
tickPlayer(wallCrusherPlayer);
assert.equal(wallCrusherHp - wallCrusherPlayer.levels[PlayerStat.HITPOINTS], trapDamage,
  'the first wall-crusher timer firing damages on its original loc');
tickPlayer(wallCrusherPlayer);
assert.equal(wallCrusherHp - wallCrusherPlayer.levels[PlayerStat.HITPOINTS], 2 * trapDamage,
  'remaining on the wall crusher takes damage on the next timer firing');
assert.deepEqual(tileOf(wallCrusherPlayer), [wallCrusher.row.level, wallCrusher.row.x, wallCrusher.row.z],
  'the wall-crusher timer does not substitute a teleport landing');

const trapTiles = new Set([
  ...floorTrapTiles.map(tileKey),
  ...wallCrusherRows.map(row => tileKey([row.level, row.x, row.z]))
]);
const safeWalker = newPlayer();
fixtureStage(safeWalker, 2);
const safeStart = targetSpecs.ladder.approach.stand;
safeWalker.teleport(safeStart[1], safeStart[2], safeStart[0]);
tickPlayer(safeWalker);
assert(trapTimer(safeWalker), 'walking fixture enters the native timer zone');
const safePath = assertIndependentPathOut(safeWalker, 'collision-safe trap alternative', trapTiles);
const safeHp = safeWalker.levels[PlayerStat.HITPOINTS];
safeWalker.queueWaypoints(safePath.route.map(([x, z]) => CoordGrid.packCoord(safeStart[0], x, z)));
const walkedTiles = [tileOf(safeWalker)];
for (let step = 0; step < safePath.route.length + 8 &&
    tileKey(tileOf(safeWalker)) !== tileKey(safePath.tile); step++) {
  tickPlayer(safeWalker);
  walkedTiles.push(tileOf(safeWalker));
}
assert.deepEqual(tileOf(safeWalker), safePath.tile, 'native movement reaches the packed collision-safe alternative');
assert(walkedTiles.every(tile => !trapTiles.has(tileKey(tile))), 'the actual walked route avoids every configured trap');
assert.equal(safeWalker.levels[PlayerStat.HITPOINTS], safeHp, 'the collision-safe route avoids trap damage');

// After a stage-7 crossing exposes the selected pot, Take recovers a lost jar.
for (const jar of jarCases) {
  const p = newPlayer();
  fixtureStage(p, 8);
  p.setVarBit(jarMultiBit, jar.selection);
  p.setVarBit(jar.visible, 0);
  interactLoc(p, jar.key, 1, `[oploc1,${jar.pot}]`);
  assert.equal(stage(p), 8, `${jar.pot} recovery does not skip the native Drop step`);
  assert.equal(count(p, jar.item), 1, `${jar.pot} Take recovers the selected lost jar`);
  positionAt(p, 'ladder');
  itemOption(p, jar.item, 5);
  assert.equal(count(p, jar.item), 0, `${jar.item} can be dropped away from its return pot`);
  assert.equal(stage(p), 8, `${jar.item} Drop away from its pot does not return it`);
  interactLoc(p, jar.key, 1, `[oploc1,${jar.pot}]`);
  assert.equal(count(p, jar.item), 1, `${jar.pot} replaces the natively dropped jar`);
  assert.equal(stage(p), 8, `${jar.pot} replacement keeps the return step pending`);
}

// Stage 8 returns each selected jar through its native Drop option at the original pot tile.
for (const jar of jarCases) {
  const p = newPlayer();
  fixtureStage(p, 8);
  p.setVarBit(jarMultiBit, jar.selection);
  give(p, jar.item);
  positionAt(p, jar.key);
  const pot = targetSpecs[jar.key].row;
  assert(Math.max(Math.abs(p.x - pot.x), Math.abs(p.z - pot.z)) <= 1,
    `${jar.item} Drop stand is within one tile of its original cache-native pot`);
  itemOption(p, jar.item, 5);
  assert.equal(stage(p), 9, `${jar.item} Drop advances to stage 9`);
  assert.equal(count(p, jar.item), 0, `${jar.item} is consumed by the native Drop`);
  const ground = World.getObj(p.x, p.z, p.level, obj(jar.item), p.hash64);
  assert(ground, `${jar.item} Drop creates an owner-private ground item at the player tile`);
}

// Stage 9: supply work is driven by native inventory, item-use, and NPC packets.
const supplies = newPlayer();
fixtureStage(supplies, 9);
talkNpc(supplies, 'highPriest', '[opnpc1,ics_little_hipriest_vis]');
assert.equal(stage(supplies), 10, 'the High Priest starts the ceremony-supplies stage');
assertQuestColour(supplies, 10);
talkNpc(supplies, 'embalmer', '[opnpc1,ics_little_embalmer]');
assert.equal(count(supplies, 'ics_little_bookofembalming'), 1, 'the Embalmer provides the instruction book');
itemOption(supplies, 'ics_little_bookofembalming', 1);
itemOption(supplies, 'ics_little_bookofembalming', 5);
assert.equal(count(supplies, 'ics_little_bookofembalming'), 0, 'the instruction book is natively dropped before replacement');
talkNpc(supplies, 'embalmer', '[opnpc1,ics_little_embalmer]');
assert.equal(count(supplies, 'ics_little_bookofembalming'), 1, 'the Embalmer replaces a lost instruction book');

give(supplies, 'bucket_empty');
give(supplies, 'knife');
useItemOnLoc(supplies, 'knife', 'evergreen', '[oplocu,_tree]');
assert.equal(count(supplies, 'ics_little_sap_bucket'), 1, 'native Use of a knife and empty bucket collects tree sap');
assert.equal(count(supplies, 'bucket_empty'), 0, 'sap collection consumes the empty bucket');
itemOption(supplies, 'ics_little_sap_bucket', 5);
assert.equal(count(supplies, 'ics_little_sap_bucket'), 0, 'the sap bucket is dropped through its native inventory option');
give(supplies, 'bucket_empty');
useItemOnLoc(supplies, 'knife', 'evergreen', '[oplocu,_tree]');
assert.equal(count(supplies, 'ics_little_sap_bucket'), 1, 'tree sap can be collected again after a native Drop');
give(supplies, 'bucket_empty');
useItemOnLoc(supplies, 'bucket_empty', 'water', '[oplocu,icthalarins_waters_edge]');
assert.equal(count(supplies, 'ics_little_saltwaterbucket'), 1, 'native Use of an empty bucket collects salt water');
itemOption(supplies, 'ics_little_saltwaterbucket', 5);
assert.equal(count(supplies, 'ics_little_saltwaterbucket'), 0, 'the salt-water bucket is natively dropped');
give(supplies, 'bucket_empty');
useItemOnLoc(supplies, 'bucket_empty', 'water', '[oplocu,icthalarins_waters_edge]');
assert.equal(count(supplies, 'ics_little_saltwaterbucket'), 1, 'salt water can be collected again after a native Drop');
useItemOnLoc(supplies, 'ics_little_saltwaterbucket', 'suntrap', '[oplocu,icthalarins_suntrap_centre]');
assert.equal(count(supplies, 'ics_little_saltwaterbucket'), 0, 'the suntrap consumes the salt water');
assert.equal(count(supplies, 'bucket_empty'), 1, 'evaporation returns the empty bucket');
interactLoc(supplies, 'suntrap', 1, '[oploc1,icthalarins_suntrap_centre]');
assert.equal(count(supplies, 'ics_little_pileofsalt'), 1, 'searching the suntrap collects its evaporated salt');
itemOption(supplies, 'ics_little_pileofsalt', 5);
assert.equal(count(supplies, 'ics_little_pileofsalt'), 0, 'the evaporated salt is natively dropped');
useItemOnLoc(supplies, 'bucket_empty', 'water', '[oplocu,icthalarins_waters_edge]');
useItemOnLoc(supplies, 'ics_little_saltwaterbucket', 'suntrap', '[oplocu,icthalarins_suntrap_centre]');
interactLoc(supplies, 'suntrap', 1, '[oploc1,icthalarins_suntrap_centre]');
assert.equal(count(supplies, 'ics_little_pileofsalt'), 1, 'the suntrap produces replacement salt after a native Drop');

give(supplies, 'coins', 29);
const linenShortStart = supplies.packets.length;
talkNpc(supplies, 'linen', '[opnpc1,ics_little_linen1]');
assert.equal(count(supplies, 'ics_little_linen'), 0, '29 coins cannot buy the period-priced linen');
assert(textSince(supplies, linenShortStart).includes('30 coins'), 'the linen seller states the 30-coin price');
give(supplies, 'coins', 1);
talkNpc(supplies, 'linen', '[opnpc1,ics_little_linen1]');
assert.equal(count(supplies, 'coins'), 0, 'the linen sale consumes exactly 30 coins');
assert.equal(count(supplies, 'ics_little_linen'), 1, 'the native NPC sale provides one sheet of linen');
itemOption(supplies, 'ics_little_linen', 5);
assert.equal(count(supplies, 'ics_little_linen'), 0, 'the linen is natively dropped');
give(supplies, 'coins', 30);
talkNpc(supplies, 'linen', '[opnpc1,ics_little_linen1]');
assert.equal(count(supplies, 'ics_little_linen'), 1, 'replacement linen can be bought after a native Drop');
assert.equal(count(supplies, 'coins'), 0, 'replacement linen still costs thirty coins');

give(supplies, 'willow_logs');
talkNpc(supplies, 'carpenter', '[opnpc1,ics_little_carpenter]');
assert.equal(count(supplies, 'willow_logs'), 0, 'the Carpenter consumes the willow log');
assert.equal(supplies.getVarBit(carpenterMultiBit), 1, 'the Carpenter records the prepared holy symbol');
assert.equal(stage(supplies), 10, 'the ceremony remains at stage 10 until all supplies arrive');
itemOption(supplies, 'ics_little_bookofembalming', 5);
assert.equal(count(supplies, 'ics_little_bookofembalming'), 0, 'stage 11 supply completion does not depend on the optional instruction book');
talkNpc(supplies, 'embalmer', '[opnpc1,ics_little_embalmer]');
assert.equal(count(supplies, 'ics_little_sap_bucket'), 0, 'the Embalmer receives the collected sap');
assert.equal(count(supplies, 'ics_little_pileofsalt'), 0, 'the Embalmer receives the collected salt');
assert.equal(count(supplies, 'ics_little_linen'), 0, 'the Embalmer receives the purchased linen');
assert.equal(stage(supplies), 11, 'all ceremony supplies advance the quest to stage 11');
assertQuestColour(supplies, 11);
talkNpc(supplies, 'carpenter', '[opnpc1,ics_little_carpenter]');
assert.equal(count(supplies, 'ics_little_holy_symbol'), 1, 'the Carpenter gives the prepared holy symbol');
assert.equal(stage(supplies), 12, 'receiving the holy symbol advances to stage 12');
assertQuestColour(supplies, 12);
// The stage-7 Jump-Across reveals a pot; 20% run energy is admitted without being consumed.
const stage7Pit = newPlayer();
fixtureStage(stage7Pit, 7);
jumpPit(stage7Pit, northPitKey, 'stage-7 native Jump-Across');

const belowPitEnergy = newPlayer();
fixtureStage(belowPitEnergy, 7);
belowPitEnergy.runenergy = 1999;
interactLoc(belowPitEnergy, northPitKey, 2, '[oploc2,ics_little_pit_to]');
assert.equal(stage(belowPitEnergy), 7, 'below-threshold pit crossing does not advance the stage');
assert.equal(belowPitEnergy.runenergy, 1999, 'failed pit crossing preserves run energy');
assertPackedArrival(belowPitEnergy, 'below-threshold pit-failure landing');
assertIndependentPathOut(belowPitEnergy, 'below-threshold pit-failure landing');

const thresholdPitEnergy = newPlayer();
fixtureStage(thresholdPitEnergy, 7);
thresholdPitEnergy.runenergy = 2000;
jumpPit(thresholdPitEnergy, northPitKey, 'exact 20% run-energy pit crossing');

// Stage 12 becomes stage 13 only after the native pit action changes the symbol.
jumpPit(supplies, northPitKey, 'stage-12 native Jump-Across');
assert.equal(stage(supplies), 13, 'the stage-12 native pit crossing enters possession');
assertQuestColour(supplies, 13);
const eastRoomEntryRoute = packedWalk(supplies.level, [supplies.x, supplies.z],
  [eastDoorOutside[1], eastDoorOutside[2]], 96);
assert(eastRoomEntryRoute?.length, 'the stage-13 pit landing has a nonempty route to the exterior eastern doorway');
interactLoc(supplies, 'jarDoor2', 1, '[oploc1,doorway]', [], eastDoorOutside);
assert.deepEqual(tileOf(supplies), eastDoorInside, 'the native eastern doorway enters the burial chamber');
assertPackedArrival(supplies, 'stage-13 eastern burial chamber entry');
assert.equal(stage(supplies), 13, 'entering the burial chamber keeps the unhidden-symbol stage');
assertNonemptyRouteTo(supplies, 'eastSarcophagus', 'stage-13 east burial chamber route');
const unholyInventory = supplies.getInventory(inv);
const inventoryBeforeSearch = Array.from({ length: unholyInventory.capacity }, (_, slot) => {
  const item = unholyInventory.get(slot);
  return item ? { id: item.id, count: item.count } : null;
});
const sarcophagusHp = supplies.levels[PlayerStat.HITPOINTS];
const sarcophagusDamage = integerConstant('quests/quest_ics_little/configs/ics_pyramid.constant',
  'ics_little_sarcophagus_damage');
interactLoc(supplies, 'eastSarcophagus', 1, '[oploc1,sarcophagus]');
assert.equal(stage(supplies), 13, 'searching the east sarcophagus does not hide the symbol');
assert.equal(count(supplies, 'ics_little_unholy_symbol'), 1, 'sarcophagus Search leaves the symbol in inventory');
assert.equal(sarcophagusHp - supplies.levels[PlayerStat.HITPOINTS], sarcophagusDamage,
  'searching the east sarcophagus causes its compiled trap damage');
const inventoryAfterSearch = Array.from({ length: unholyInventory.capacity }, (_, slot) => {
  const item = unholyInventory.get(slot);
  return item ? { id: item.id, count: item.count } : null;
});
assert.deepEqual(inventoryAfterSearch, inventoryBeforeSearch, 'sarcophagus Search leaves the full inventory unchanged');
useItemOnLoc(supplies, 'ics_little_unholy_symbol', 'eastSarcophagus', '[oplocu,sarcophagus]');
assert.equal(stage(supplies), 14, 'hiding the unholy symbol in the east sarcophagus writes stage 14');
assertQuestColour(supplies, 14);
interactLoc(supplies, 'jarDoor2', 1, '[oploc1,doorway]', [], eastDoorInsideStand);
assert.deepEqual(tileOf(supplies), eastDoorOutside, 'eastern doorway Open lands on the native outside counterpart');
assertPackedArrival(supplies, 'stage-14 eastern doorway exit');
assertIndependentPathOut(supplies, 'stage-14 eastern doorway exit', trapTiles);
assert.equal(stage(supplies), 15, 'the eastern doorway exit writes stage 15');
assertQuestColour(supplies, 15);
interactLoc(supplies, 'jarDoor2', 1, '[oploc1,doorway]', [], eastDoorOutside);
assert.deepEqual(tileOf(supplies), eastDoorInside, 'eastern doorway re-entry lands on the native inside counterpart');
assertPackedArrival(supplies, 'stage-15 eastern doorway re-entry');
assertNonemptyRouteTo(supplies, 'eastSarcophagus', 'stage-15 eastern doorway re-entry');
assert.equal(stage(supplies), 19, 're-entering through the eastern doorway writes ceremony stage 19');
assertQuestColour(supplies, 19);
talkNpc(supplies, 'ceremonyHighPriest', '[opnpc1,ics_little_hipriest_vis]');
assert.equal(stage(supplies), 19, 'the High Priest spawns the possessed priest without skipping stage 19');
const possessedType = npcType('ics_little_possessedpriest');
const possessedOwnedByPlayer = () => [...World.npcs].filter(actor => actor.isActive && actor.type === possessedType &&
  (Number(actor.getVar(npcAttackingUid)) >>> 0) === supplies.uid);
let possessed = possessedOwnedByPlayer();
assert.equal(possessed.length, 1, 'the ceremony creates exactly one owner-bound possessed priest');
const originalPossessed = possessed[0];
assertPackedArrival(originalPossessed, 'possessed-priest native spawn');
assertIndependentPathOut(originalPossessed, 'possessed-priest native spawn');
talkNpc(supplies, 'ceremonyHighPriest', '[opnpc1,ics_little_hipriest_vis]');
assert.equal(possessedOwnedByPlayer().length, 1, 'repeating the ceremony talk does not duplicate the active priest');
const originalPossessedNid = originalPossessed.nid;
originalPossessed.lifecycle = EntityLifeCycle.DESPAWN;
World.removeNpc(originalPossessed, -1);
assert.equal(World.getNpc(originalPossessedNid), undefined, 'the ceremony retry fixture removes the missing native actor');
assert.equal(possessedOwnedByPlayer().length, 0, 'no active owner priest remains before the retry');
assert.equal(stage(supplies), 19, 'a missing possessed priest leaves the ceremony retryable');
talkNpc(supplies, 'ceremonyHighPriest', '[opnpc1,ics_little_hipriest_vis]');
possessed = possessedOwnedByPlayer();
assert.equal(possessed.length, 1, 'repeating the ceremony talk recreates one missing owner priest');
assert.notEqual(possessed[0], originalPossessed, 'the retry creates a replacement native NPC actor');
assertPackedArrival(possessed[0], 'possessed-priest retry spawn');
assertIndependentPathOut(possessed[0], 'possessed-priest retry spawn');
assert.equal(stage(supplies), 19, 'spawning or restoring the priest does not count as its defeat');

const ordinaryMan = nativeTypeActor(supplies, 'man');
assert.equal(runProcInt(supplies, 'ics_little_guardian', [], ordinaryMan), 0,
  'ordinary NPCs are not accidentally classified as guardian immune');
assert.equal(runProcInt(supplies, 'npc_is_attackable', [], ordinaryMan), 1,
  'ordinary NPCs retain melee attack admission');
assert.equal(runProcInt(supplies, 'npc_is_attackable_opt', [], ordinaryMan), 1,
  'ordinary NPCs retain magic attack admission');
assert.equal(runProcInt(supplies, 'npc_is_attackable_opt_quiet', [], ordinaryMan), 1,
  'ordinary NPCs retain quiet area-scan magic admission');
World.removeNpc(ordinaryMan, -1);


// The Embalmer accepts the period-compatible Slayer salt-bag alternative.
const saltBagSupplies = newPlayer();
fixtureStage(saltBagSupplies, 10);
saltBagSupplies.setVarBit(carpenterMultiBit, 0);
give(saltBagSupplies, 'ics_little_sap_bucket');
give(saltBagSupplies, 'slayer_bag_of_salt');
give(saltBagSupplies, 'ics_little_linen');
give(saltBagSupplies, 'willow_logs');
talkNpc(saltBagSupplies, 'carpenter', '[opnpc1,ics_little_carpenter]');
talkNpc(saltBagSupplies, 'embalmer', '[opnpc1,ics_little_embalmer]');
assert.equal(stage(saltBagSupplies), 11, 'the Slayer salt-bag alternative completes ceremony supplies');
assert.equal(count(saltBagSupplies, 'slayer_bag_of_salt'), 0, 'the Embalmer consumes the alternative salt source');

// Lost symbol recovery is exercised at reachable preparation stages.
const holyRecovery = newPlayer();
fixtureStage(holyRecovery, 12);
holyRecovery.setVarBit(carpenterMultiBit, 1);
talkNpc(holyRecovery, 'carpenter', '[opnpc1,ics_little_carpenter]');
assert.equal(count(holyRecovery, 'ics_little_holy_symbol'), 1, 'the Carpenter restores a missing holy symbol');
itemOption(holyRecovery, 'ics_little_holy_symbol', 5);
assert.equal(count(holyRecovery, 'ics_little_holy_symbol'), 0, 'the holy symbol is natively dropped before replacement');
talkNpc(holyRecovery, 'carpenter', '[opnpc1,ics_little_carpenter]');
assert.equal(stage(holyRecovery), 12, 'restoring the holy symbol does not move the stage');
assert.equal(count(holyRecovery, 'ics_little_holy_symbol'), 1, 'the holy symbol can be recovered after being dropped');

const unholyRecovery = newPlayer();
fixtureStage(unholyRecovery, 13);
unholyRecovery.setVarBit(carpenterMultiBit, 1);
talkNpc(unholyRecovery, 'carpenter', '[opnpc1,ics_little_carpenter]');
assert.equal(count(unholyRecovery, 'ics_little_unholy_symbol'), 1, 'the Carpenter restores a missing unholy symbol');
itemOption(unholyRecovery, 'ics_little_unholy_symbol', 5);
assert.equal(count(unholyRecovery, 'ics_little_unholy_symbol'), 0, 'the unholy symbol is natively dropped before replacement');
talkNpc(unholyRecovery, 'carpenter', '[opnpc1,ics_little_carpenter]');
assert.equal(stage(unholyRecovery), 13, 'restoring the unholy symbol keeps the possession stage retryable');
assert.equal(count(unholyRecovery, 'ics_little_unholy_symbol'), 1, 'the unholy symbol can be recovered after being dropped');

// Stage 25: full-inventory refusal is side-effect free; reward completion is one-shot.
const rewards = newPlayer();
fixtureStage(rewards, 25);
assertQuestColour(rewards, 25);
const xpBeforeReward = rewards.stats.slice();
const qpBeforeReward = rewards.getVar(questpoints);
fillInventory(rewards);
const fullRewardStart = rewards.packets.length;
talkNpc(rewards, 'highPriest', '[opnpc1,ics_little_hipriest_vis]');
assert.equal(stage(rewards), 25, 'a full inventory leaves the reward-ready stage intact');
assert.equal(count(rewards, 'ics_little_amulet_of_catspeak'), 0, 'a full inventory prevents the amulet award');
assert.deepEqual(rewards.stats, xpBeforeReward, 'a full inventory grants no experience');
assert.equal(rewards.getVar(questpoints), qpBeforeReward, 'a full inventory grants no quest points');
assert(textSince(rewards, fullRewardStart).includes('Make room'), 'the High Priest explains the reward-space requirement');
removeSlot(rewards, 0);
talkNpc(rewards, 'highPriest', '[opnpc1,ics_little_hipriest_vis]');
assert.equal(stage(rewards), questComplete, 'the reward dialogue completes the quest');
assert.equal(count(rewards, 'ics_little_amulet_of_catspeak'), 1, 'completion grants one Catspeak amulet');
assert.equal(rewards.stats[PlayerStat.THIEVING] - xpBeforeReward[PlayerStat.THIEVING], 45000);
assert.equal(rewards.stats[PlayerStat.AGILITY] - xpBeforeReward[PlayerStat.AGILITY], 40000);
assert.equal(rewards.stats[PlayerStat.WOODCUTTING] - xpBeforeReward[PlayerStat.WOODCUTTING], 40000);
assert.equal(rewards.getVar(questpoints) - qpBeforeReward, questPointsAward, 'completion grants exactly two quest points');
assertQuestColour(rewards, questComplete);
const xpAfterReward = rewards.stats.slice();
const qpAfterReward = rewards.getVar(questpoints);
talkNpc(rewards, 'highPriest', '[opnpc1,ics_little_hipriest_vis]');
assert.equal(stage(rewards), questComplete, 'the completed High Priest dialogue remains complete');
assert.deepEqual(rewards.stats, xpAfterReward, 'repeated completion grants no duplicate experience');
assert.equal(rewards.getVar(questpoints), qpAfterReward, 'repeated completion grants no duplicate quest points');
itemOption(rewards, 'ics_little_amulet_of_catspeak', 5);
assert.equal(count(rewards, 'ics_little_amulet_of_catspeak'), 0, 'the completed amulet is natively dropped before replacement');
talkNpc(rewards, 'sphinx', '[opnpc1,ics_little_sphinx]');
assert.equal(count(rewards, 'ics_little_amulet_of_catspeak'), 1, 'the Sphinx replaces a dropped Catspeak amulet');
itemOption(rewards, 'ics_little_amulet_of_catspeak', 5);
assert.equal(count(rewards, 'ics_little_amulet_of_catspeak'), 0, 'the replacement amulet is natively dropped before the bank fixture');
give(rewards, 'ics_little_amulet_of_catspeak', 1, bank);
talkNpc(rewards, 'sphinx', '[opnpc1,ics_little_sphinx]');
assert.equal(count(rewards, 'ics_little_amulet_of_catspeak'), 0, 'a banked Catspeak amulet is not duplicated');
assert.equal(count(rewards, 'ics_little_amulet_of_catspeak', bank), 1);
removeItem(rewards, 'ics_little_amulet_of_catspeak', bank);
talkNpc(rewards, 'sphinx', '[opnpc1,ics_little_sphinx]');
assert.equal(count(rewards, 'ics_little_amulet_of_catspeak'), 1, 'the Sphinx replaces the amulet after it is no longer banked');

console.log('PASS Icthlarin compiled proofs: native cat prereqs and supplies, stage-3 Sphinx/token, stage-9 preparation/salt routes, symbol recovery, stage-25 rewards and item recovery, plus packed map approaches.');
process.exit(0);
