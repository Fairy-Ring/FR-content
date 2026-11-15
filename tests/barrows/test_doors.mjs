#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createRunner, loadPackedRuntime, parseEnum, parseOptions, resolveRoots, run } from './packed.mjs';

const args = process.argv.slice(2);
const regressionFlags = args.filter(arg => arg === '--regression');
assert(regressionFlags.length <= 1, '--regression can be supplied once');
const regression = regressionFlags.length === 1;
const placementRegression = args.includes('--placement-regression');
const options = parseOptions([
  process.argv[0], process.argv[1], ...args.filter(arg => arg !== '--regression' && arg !== '--placement-regression')
]);
const roots = resolveRoots(options);
process.chdir(roots.engineRoot);

const BROTHERS = [
  ['barrows_ahrim', 1], ['barrows_dharok', 2], ['barrows_guthan', 3],
  ['barrows_karil', 4], ['barrows_torag', 5], ['barrows_verac', 6]
];
const DOOR_TYPES = {
  skeleton: 'barrows_skeleton_unarmed',
  bloodworm: 'barrows_bloodworm',
  crypt_rat: 'barrows_rat'
};
const CENTRAL_LOCKS = new Set([473, 477, 478, 480]);
const u32 = value => value >>> 0;
const pointKey = point => `${point.level},${point.x},${point.z}`;
const chebyshev = (left, right) => Math.max(Math.abs(left.x - right.x), Math.abs(left.z - right.z));
let activeRuntime;
let activeHitpointsIndex;
let activeNpcVars;
let activeServerTrigger;
let activeCreditQueue;
let runtimePlayers = [];

function readConstants(contentRoot) {
  const file = path.join(contentRoot, 'scripts/minigames/game_barrows/configs/barrows.constant');
  const values = new Map();
  for (const [index, line] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    const match = line.trim().match(/^\^([A-Za-z0-9_]+)\s*=\s*(-?\d+)\s*$/);
    if (!match) continue;
    assert(!values.has(match[1]), `${file}:${index + 1}: duplicate numeric constant`);
    values.set(match[1], Number(match[2]));
  }
  return values;
}

function readMapRows(contentRoot, filename) {
  const file = path.join(contentRoot, 'maps', filename);
  const map = /^m(\d+)_(\d+)\.jm2$/.exec(filename);
  assert(map, `${filename}: expected a packed map name`);
  const baseX = Number(map[1]) * 64;
  const baseZ = Number(map[2]) * 64;
  const floorTiles = new Set();
  const locs = [];
  let section = '';
  for (const [index, line] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    const header = /^====\s*(.*?)\s*====$/.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    const row = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
    if (!row) continue;
    const level = Number(row[1]);
    const x = baseX + Number(row[2]);
    const z = baseZ + Number(row[3]);
    if (section === 'MAP') {
      if (/(?:^| )(?:f\d+|u\d+|o-?\d+)(?:[; ]|$)/.test(row[4])) floorTiles.add(`${level},${x},${z}`);
      continue;
    }
    if (section !== 'LOC') continue;
    const fields = row[4].trim().split(/\s+/);
    const id = Number(fields[0]);
    if (!Number.isInteger(id)) continue;
    locs.push({
      id,
      level,
      x,
      z,
      shape: Number(fields[1] ?? 10),
      angle: Number(fields[2] ?? 0),
      line: index + 1
    });
  }
  return { floorTiles, locs };
}

function expectedRoom(x, z) {
  if (x <= 3528) return 9;
  if (x >= 3575) return 10;
  if (z <= 9671) return 11;
  if (z >= 9718) return 12;
  const column = x >= 3529 && x <= 3540 ? 0
    : x >= 3546 && x <= 3557 ? 1
      : x >= 3563 && x <= 3574 ? 2 : -1;
  const row = z >= 9672 && z <= 9683 ? 0
    : z >= 9689 && z <= 9700 ? 1
      : z >= 9706 && z <= 9717 ? 2 : -1;
  return column < 0 || row < 0 ? -1 : row * 3 + column;
}

await run(async () => {
  const runtime = await loadPackedRuntime(options);
  const {
    World, Player, LocType, NpcType, VarPlayerType, VarNpcType, ParamType,
    ScriptProvider, ScriptRunner, ScriptState, JavaRandom, EntityLifeCycle, CoordGrid
  } = runtime;
  const runner = createRunner(runtime, { prefix: 'barrows_doors', firstUid: 30100 });
  const { procInt, procVoid, addNpc } = runner;
  const [{ default: VarSharedType }, mapApi, route, { default: ServerTriggerType }, { NpcStatMap }, { default: Environment }, { default: EnumType }] = await Promise.all([
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/cache/config/VarSharedType.ts')).href),
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/GameMap.ts')).href),
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/routefinder/index.ts')).href),
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/script/ServerTriggerType.ts')).href),
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/entity/NpcStat.ts')).href),
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/util/Environment.ts')).href),
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/cache/config/EnumType.ts')).href)
  ]);
  VarSharedType.load(runtime.packDir);
  World.vars = new Int32Array(VarSharedType.count);
  World.currentTick = 100;

  const { unzipSync } = createRequire(path.join(runtime.engineRoot, 'package.json'))('fflate');
  const packedMaps = unzipSync(fs.readFileSync(path.join(runtime.packDir, '.cache/maps-server.zip')));
  assert(packedMaps.m55_151?.length && packedMaps.l55_151?.length, 'the real packed Barrows map and loc files exist');
  const packedSquare = Object.fromEntries(['m', 'l', 'n', 'o'].map(kind => [kind, packedMaps[`${kind}55_151`] ?? new Uint8Array()]));
  World.gameMap.packed.set((55 << 8) | 151, packedSquare);
  World.gameMap.zonemap.beginInitialization();
  World.gameMap.loadPackedMapsquare(packedSquare, 55 << 6, 151 << 6);
  World.gameMap.zonemap.endInitialization();

  const mapInventory = readMapRows(runtime.contentRoot, 'm55_151.jm2');
  const constants = readConstants(runtime.contentRoot);
  const constant = name => {
    assert(constants.has(name), `missing packed Barrows constant ^${name}`);
    return constants.get(name);
  };
  const ranges = {
    identity: [constant('barrows_identity_start'), constant('barrows_identity_end')],
    phase: [constant('barrows_phase_start'), constant('barrows_phase_end')],
    corner: [constant('barrows_corner_start'), constant('barrows_corner_end')],
    entrance: [constant('barrows_entrance_start'), constant('barrows_entrance_end')],
    locks: [constant('barrows_locks_start'), constant('barrows_locks_end')],
    slain: [constant('barrows_slain_start'), constant('barrows_slain_end')],
    potential: [constant('barrows_potential_start'), constant('barrows_potential_end')],
    count: [constant('barrows_count_start'), constant('barrows_count_end')]
  };
  const rangeMask = ([start, end]) => u32((2 ** (end - start + 1) - 1) << start);
  const setRange = (word, value, range) => {
    const mask = rangeMask(range);
    return u32((u32(word) & ~mask) | ((value << range[0]) & mask));
  };
  const readRange = (word, [start, end]) => (u32(word) >>> start) & (2 ** (end - start + 1) - 1);
  const vars = Object.fromEntries(['barrows', 'barrows_kills', 'barrows_state', 'barrows_generation', 'barrows_countdowns'].map(name => {
    const id = VarPlayerType.getId(name);
    assert.notEqual(id, -1, `packed player var ${name} exists`);
    return [name, id];
  }));
  const npcVars = Object.fromEntries(['npc_barrows_owner', 'npc_barrows_generation', 'npc_attacking_uid', 'npc_aggressive_player'].map(name => {
    const id = VarNpcType.getId(name);
    assert.notEqual(id, -1, `packed NPC var ${name} exists`);
    return [name, id];
  }));
  const hpIndex = NpcStatMap.get('HITPOINTS');
  assert.notEqual(hpIndex, undefined, 'native NPC hitpoint index is available');
  const activePlayers = [];
  const manualBlocks = [];
  let nextSlot = 1;

  function makePlayer(label) {
    const serial = nextSlot++;
    const hash64 = 0x1000000000000n + BigInt(serial);
    const player = new Player(`doors_${label}_${serial}`, BigInt(200000 + serial), hash64);
    player.slot = serial;
    player.uid = (Number(player.username37 & 0x1fffffn) << 11) | player.slot;
    player.pid = player.slot;
    player.isActive = true;
    player.staffModLevel = 0;
    player.level = 0;
    player.x = 3551;
    player.z = 9694;
    player.messages = [];
    player.packets = [];
    player.lastMovement = 0;
    player.write = message => player.packets.push(message);
    player.messageGame = message => player.messages.push(message);
    player.wrappedMessageGame = message => player.messages.push(message);
    World.players[player.slot] = player;
    World.playerLoop.add(0x72000000n + BigInt(player.slot), player);
    activePlayers.push(player);
    setPosition(player, { level: 0, x: 3551, z: 9694 });
    return player;
  }

  function setPosition(player, point) {
    player.teleport(point.x, point.z, point.level);
    assert.deepEqual([player.level, player.x, player.z], [point.level, point.x, point.z], 'native player transfer reaches the selected map tile');
  }

  function setRun(player, {
    phase = 1, identity = 1, generation = 1, slain = 0, openLock = null, solved = false,
    position = { level: 0, x: 3551, z: 9694 }
  } = {}) {
    let state = 0;
    state = setRange(state, identity, ranges.identity);
    state = setRange(state, phase, ranges.phase);
    state = setRange(state, 0, ranges.corner);
    state = setRange(state, 0, ranges.entrance);
    if (solved) state = u32(state | (1 << constant('barrows_solved_bit')));
    let locks = 0xffff;
    if (openLock !== null) locks &= ~(1 << (openLock - 469));
    player.setVar(vars.barrows, setRange(0, locks, ranges.locks));
    player.setVar(vars.barrows_state, state);
    player.setVar(vars.barrows_generation, generation);
    player.setVar(vars.barrows_kills, setRange(0, slain, ranges.slain));
    player.setVar(vars.barrows_countdowns, 0x76543210);
    if (player.level !== position.level || player.x !== position.x || player.z !== position.z) setPosition(player, position);
  }

  function withDraws(draws, action, label) {
    const original = JavaRandom.nextDouble;
    const values = draws.map(([choice, bound]) => {
      assert(Number.isInteger(choice) && choice >= 0 && choice < bound, `${label}: controlled choice fits random(${bound})`);
      return (choice + 0.25) / bound;
    });
    let index = 0;
    JavaRandom.nextDouble = function () {
      assert(index < values.length, `${label}: packed call consumed an unexpected random draw`);
      return values[index++];
    };
    try {
      const value = action();
      assert.equal(index, values.length, `${label}: packed call consumes every specified draw exactly once`);
      return { value, calls: index };
    } finally {
      JavaRandom.nextDouble = original;
    }
  }
  function withMapDraws(draws, action, label) {
    const original = Math.random;
    let index = 0;
    Math.random = function () {
      assert(index < draws.length, `${label}: map_findsquare consumed an unexpected native draw`);
      const value = draws[index++];
      assert(Number.isFinite(value) && value >= 0 && value < 1, `${label}: native draw is in [0,1)`);
      return value;
    };
    try {
      const value = action();
      assert.equal(index, draws.length, `${label}: map_findsquare consumes every specified native draw exactly once`);
      return { value, calls: index };
    } finally {
      Math.random = original;
    }
  }

  function activeNpcs() {
    return Array.from(World.npcs).filter(npc => npc.isActive);
  }

  function clearNpcs() {
    for (const npc of activeNpcs()) World.removeNpc(npc, -1);
  }

  function roomOf(point) {
    return expectedRoom(point.x, point.z);
  }

  function tileWalkable(point) {
    return mapInventory.floorTiles.has(pointKey(point))
      && !mapApi.isMapBlocked(point.x, point.z, point.level)
      && route.isZoneAllocated(point.x, point.z, point.level);
  }

  function footprintWalkable(point, size, room = roomOf(point)) {
    if (room < 0) return false;
    for (let dx = 0; dx < size; dx++) {
      for (let dz = 0; dz < size; dz++) {
        const tile = { level: point.level, x: point.x + dx, z: point.z + dz };
        if (roomOf(tile) !== room || !tileWalkable(tile)) return false;
      }
    }
    return true;
  }
  function overlapsFootprint(point, width, length, entity) {
    return entity.level === point.level
      && point.x < entity.x + entity.width && entity.x < point.x + width
      && point.z < entity.z + entity.length && entity.z < point.z + length;
  }
  function nativeSquareCandidates(origin, minRadius = null, maxRadius = null) {
    if (minRadius === null) minRadius = constant('barrows_door_spawn_min_radius');
    if (maxRadius === null) maxRadius = constant('barrows_door_spawn_radius');
    const candidates = [];
    outer: for (let x = origin.x - maxRadius; x <= origin.x + maxRadius; x++) {
      for (let z = origin.z - maxRadius; z <= origin.z + maxRadius; z++) {
        const distance = Math.max(Math.abs(x - origin.x), Math.abs(z - origin.z));
        if (distance < minRadius || distance > maxRadius) continue;
        if (!Environment.NODE_MEMBERS && !World.gameMap.isFreeToPlay(x, z)) continue;
        if (mapApi.isMapBlocked(x, z, origin.level)) continue;
        if (!mapApi.isLineOfWalk(origin.level, x, z, origin.x, origin.z)) continue;
        candidates.push({ level: origin.level, x, z });
        if (candidates.length >= 100) break outer;
      }
    }
    return candidates;
  }

  function validTileCandidates(origin, typeId) {
    const size = NpcType.get(typeId).size;
    const room = roomOf(origin);
    return nativeSquareCandidates(origin).filter(candidate =>
      footprintWalkable(candidate, size, room)
      && activeNpcs().every(npc => !overlapsFootprint(candidate, size, size, npc)));
  }
  function withSquareChoice(origin, typeId, destination, action, label) {
    const candidates = validTileCandidates(origin, typeId);
    const rank = candidates.findIndex(candidate => pointKey(candidate) === pointKey(destination));
    assert.notEqual(rank, -1, `${label}: chosen tile has a fully valid unoccupied footprint`);
    return withDraws([[rank, candidates.length]], action, label);
  }
  function withOptionalSquareChoice(origin, destination, action, label) {
    const candidates = nativeSquareCandidates(origin, 0, 2);
    const rank = candidates.findIndex(candidate => pointKey(candidate) === pointKey(destination));
    assert.notEqual(rank, -1, `${label}: chosen tile is one native MAP_FINDSQUARE candidate`);
    const draw = (rank + 0.25) / candidates.length;
    const original = Math.random;
    let calls = 0;
    Math.random = function () {
      assert(calls < 1, `${label}: public door action must not reroll native tile placement`);
      calls++;
      return draw;
    };
    try {
      return { value: action(), calls };
    } finally {
      Math.random = original;
    }
  }

  function roomTiles(room, size = 1) {
    const points = [];
    for (let x = 3520; x < 3584; x++) {
      for (let z = 9664; z < 9728; z++) {
        const point = { level: 0, x, z };
        if (roomOf(point) === room && footprintWalkable(point, size, room)) points.push(point);
      }
    }
    return points;
  }

  function npcId(name) {
    const id = NpcType.getId(name);
    assert.notEqual(id, -1, `packed NPC type ${name} exists`);
    return id;
  }

  function addFixtureNpc(typeName, point, ownerUid = null, generation = 0, hitpoints = null) {
    const typeId = npcId(typeName);
    const record = addNpc(typeName, point.level, ownerUid, point.x, point.z);
    const npc = record.npc;
    if (ownerUid !== null) {
      npc.setVar(npcVars.npc_barrows_owner, ownerUid);
      npc.setVar(npcVars.npc_barrows_generation, generation);
    }
    if (hitpoints !== null) npc.levels[hpIndex] = hitpoints;
    else if (npc.levels[hpIndex] <= 0) npc.levels[hpIndex] = 1;
    assert.equal(npc.type, typeId, `${typeName} fixture keeps its requested native type`);
    return npc;
  }

  function spawnDelta(beforeNids) {
    return activeNpcs().filter(npc => !beforeNids.has(npc.nid));
  }

  function pack(point) {
    return CoordGrid.packCoord(point.level, point.x, point.z);
  }

  function decode(coord) {
    assert.notEqual(coord, -1, 'packed coordinate result is not null');
    return CoordGrid.unpackCoord(coord);
  }

  function mapDoorCrossings(probe) {
    const lockParam = ParamType.getId('barrows_room_edge_lock');
    assert.notEqual(lockParam, -1, 'packed door locs expose their measured lock parameter');
    const rows = mapInventory.locs.filter(row => /^barrows_door_[a-p]_[rl]$/.test(LocType.get(row.id)?.debugname ?? ''));
    assert.equal(rows.length, 64, 'all 64 original Barrows parent-door placements come from the native map inventory');
    const crossings = [];
    const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const row of rows) {
      const parent = LocType.get(row.id);
      const lock = parent.params?.get(lockParam);
      assert(Number.isInteger(lock) && lock >= 469 && lock <= 484, `${parent.debugname} carries one measured door lock`);
      const loc = World.getLoc(row.x, row.z, row.level, row.id);
      assert(loc, `${parent.debugname} is loaded as a native loc`);
      const side = parent.debugname.slice(-1);
      const anchor = { level: row.level, x: row.x, z: row.z };
      for (const [dx, dz] of offsets) {
        const source = { level: row.level, x: row.x + dx, z: row.z + dz };
        if (!tileWalkable(source) || roomOf(source) < 0) continue;
        const destinationValue = procInt(probe, 'barrows_door_destination', [pack(anchor), pack(source)]);
        if (destinationValue === -1) continue;
        const destination = decode(destinationValue);
        if (roomOf(destination) < 0 || roomOf(destination) === roomOf(source) || !tileWalkable(destination)) continue;
        crossings.push({ id: row.id, lock, side, loc, anchor, source, destination, sourceRoom: roomOf(source), destinationRoom: roomOf(destination) });
      }
    }
    assert(crossings.some(crossing => !CENTRAL_LOCKS.has(crossing.lock)), 'a measured non-central door has walkable source and destination tiles');
    assert(crossings.some(crossing => CENTRAL_LOCKS.has(crossing.lock)), 'a measured central door has walkable source and destination tiles');
    return crossings;
  }

  function nativeLocTrigger(player, loc) {
    player.target = loc;
    player.targetOp = ServerTriggerType.OPLOC1 - 7;
    return player.getOpTrigger();
  }

  function runLocAction(player, crossing, expected = ScriptState.FINISHED) {
    const trigger = nativeLocTrigger(player, crossing.loc);
    assert(trigger, `${LocType.get(crossing.id).debugname}: native OPLOC1 dispatch selects the unlocked child`);
    assert.equal(trigger.name, `[oploc1,barrows_door_unlocked_${crossing.side}]`, `${LocType.get(crossing.id).debugname}: native OPLOC1 selects the measured unlocked side`);
    const state = ScriptRunner.init(trigger, player, crossing.loc, []);
    player.executeScript(state, true);
    assert.equal(state.execution, expected, 'native door loc action reaches its expected continuation state');
    assert.equal(player.delayed, false, 'native door loc action leaves no delay');
    if (expected === ScriptState.PAUSEBUTTON) {
      assert.equal(player.activeScript, state, 'the unanswered puzzle retains its native continuation');
      assert.equal(player.protect, true, 'the unanswered puzzle retains protected access');
    } else {
      assert.equal(player.activeScript, null, 'native completed door action leaves no suspended script');
      assert.equal(player.protect, false, 'native completed door action releases protected access');
    }
    return state;
  }

  function activeRoomNpcs(room) {
    return activeNpcs().filter(npc => npc.level === 0 && roomOf(npc) === room && npc.levels[hpIndex] > 0);
  }

  function availableSpawnTile(landing, size, candidates = nativeSquareCandidates(landing)) {
    const room = roomOf(landing);
    return candidates.find(candidate => {
      if (roomOf(candidate) !== room || !footprintWalkable(candidate, size, room)) return false;
      return activeNpcs().every(npc => !overlapsFootprint(candidate, size, size, npc));
    });
  }

  function addSpreadFixtures(room, rows, avoidSearch = null) {
    const chosen = [];
    for (const row of rows) {
      const type = NpcType.get(npcId(row.type));
      const radius = constant('barrows_door_spawn_radius');
      const point = roomTiles(room, type.size).find(candidate => {
        const clearOfSearch = avoidSearch === null
          || candidate.x + type.size <= avoidSearch.x - radius
          || candidate.x >= avoidSearch.x + radius + 1
          || candidate.z + type.size <= avoidSearch.z - radius
          || candidate.z >= avoidSearch.z + radius + 1;
        return clearOfSearch && chosen.every(previous =>
          candidate.x + type.size <= previous.point.x || previous.point.x + previous.size <= candidate.x
            || candidate.z + type.size <= previous.point.z || previous.point.z + previous.size <= candidate.z
        );
      });
      assert(point, `${row.type} receives a distinct legal tile in room ${room}`);
      const npc = addFixtureNpc(row.type, point, row.ownerUid ?? null, row.generation ?? 0, row.hitpoints ?? 1);
      chosen.push({ npc, point, size: type.size });
    }
    return chosen;
  }

  function withDoorSpawn(landing, typeId, draws, action, label) {
    const candidates = validTileCandidates(landing, typeId);
    assert(candidates.length > 0, `${label}: a legal unoccupied destination-side NPC footprint exists`);
    const result = withDraws([...draws, [0, candidates.length]], action, label);
    return {
      value: result.value,
      scriptCalls: draws.length,
      tileCalls: result.calls - draws.length,
      tile: candidates[0]
    };
  }

  function blockRoomRadius(origin, room) {
    const changed = [];
    for (let x = origin.x - 2; x <= origin.x + 2; x++) {
      for (let z = origin.z - 2; z <= origin.z + 2; z++) {
        const point = { level: origin.level, x, z };
        if (roomOf(point) !== room || !route.isZoneAllocated(x, z, origin.level) || mapApi.isMapBlocked(x, z, origin.level)) continue;
        mapApi.changeLocCollision(10, 0, false, 1, 1, 0, x, z, origin.level, true);
        changed.push(point);
        manualBlocks.push(point);
      }
    }
    assert(changed.length > 0, 'the invalid-placement fixture blocks every open candidate near the measured landing');
    for (let x = origin.x - 2; x <= origin.x + 2; x++) {
      for (let z = origin.z - 2; z <= origin.z + 2; z++) {
        const point = { level: origin.level, x, z };
        if (roomOf(point) === room && route.isZoneAllocated(x, z, origin.level)) {
          assert(mapApi.isMapBlocked(x, z, origin.level), 'every walkable same-room candidate in radius two is blocked');
        }
      }
    }
    return changed;
  }

  function restoreBlocks(points) {
    for (const point of points) {
      mapApi.changeLocCollision(10, 0, false, 1, 1, 0, point.x, point.z, point.level, false);
      const index = manualBlocks.findIndex(candidate => pointKey(candidate) === pointKey(point));
      if (index >= 0) manualBlocks.splice(index, 1);
    }
  }

  const players = activePlayers;
  try {
    const probe = makePlayer('probe');
    const crossings = mapDoorCrossings(probe);
    const bloodwormBaseId = npcId(DOOR_TYPES.bloodworm);
    const bloodwormBaseType = NpcType.get(bloodwormBaseId);
    const ordinaryCrossing = crossings.find(crossing => !CENTRAL_LOCKS.has(crossing.lock)
      && nativeSquareCandidates(crossing.destination, 0, 2).some(candidate =>
        roomOf(candidate) === crossing.destinationRoom
        && footprintWalkable(candidate, bloodwormBaseType.size, crossing.destinationRoom)
      )
    );
    const centralCrossing = crossings.find(crossing => CENTRAL_LOCKS.has(crossing.lock));
    assert(ordinaryCrossing, 'a native non-central crossing has a full-footprint spawn candidate within radius two');
    assert(centralCrossing, 'a native central crossing supports the puzzle-refusal control');
    assert(ScriptProvider.getByName('[proc,barrows_door_use]'), 'the previous public barrows_door_use proc is packed');

    if (placementRegression) {
      const owner = makePlayer('crowded-placement-regression');
      setRun(owner, { phase: 2, generation: 401, slain: 62, openLock: ordinaryCrossing.lock, position: ordinaryCrossing.source });
      const typeId = npcId('barrows_ahrim');
      const size = NpcType.get(typeId).size;
      const candidates = nativeSquareCandidates(ordinaryCrossing.destination);
      const occupied = availableSpawnTile(ordinaryCrossing.destination, size, candidates);
      assert(occupied, 'placement regression has an initially free footprint');
      const blocker = addFixtureNpc('barrows_rat', occupied);
      const alternative = availableSpawnTile(ordinaryCrossing.destination, size, candidates);
      assert(alternative, 'placement regression retains a second fully valid tile');
      const before = new Set(activeNpcs().map(npc => npc.nid));
      const rank = candidates.findIndex(tile => pointKey(tile) === pointKey(occupied));
      const java = JavaRandom.nextDouble;
      const math = Math.random;
      JavaRandom.nextDouble = () => 0;
      Math.random = () => (rank + 0.25) / candidates.length;
      let state;
      try { state = runLocAction(owner, ordinaryCrossing); }
      finally { JavaRandom.nextDouble = java; Math.random = math; }
      const actors = spawnDelta(before);
      console.log(JSON.stringify({ case: 'occupied-native-pick-with-free-alternative', commands: state.opcount,
        occupied, alternative, spawned: actors.map(npc => ({ type: npc.type, x: npc.x, z: npc.z })) }));
      assert.deepEqual([owner.level, owner.x, owner.z],
        [ordinaryCrossing.destination.level, ordinaryCrossing.destination.x, ordinaryCrossing.destination.z],
        'crowded placement does not prevent traversal');
      assert.equal(actors.length, 1, 'a paid door must summon its eligible brother when another valid tile exists');
      assert.equal(actors[0].type, typeId, 'the paid guarantee keeps its one uncredited identity');
      assert(!overlapsFootprint(actors[0], size, size, blocker), 'the brother never overlaps the occupied footprint');
      console.log('PASS placement regression: an occupied old pick cannot suppress a valid paid encounter');
      return;
    }
    if (regression) {
      const redPlayer = makePlayer('regression');
      setRun(redPlayer, { phase: 1, generation: 401, openLock: ordinaryCrossing.lock, position: ordinaryCrossing.source });
      const regressionMaxSize = Math.max(
        ...BROTHERS.map(([name]) => NpcType.get(npcId(name)).size),
        ...Object.values(DOOR_TYPES).map(name => NpcType.get(npcId(name)).size)
      );
      const regressionCandidates = nativeSquareCandidates(ordinaryCrossing.destination, 0, 2);
      const regressionTile = regressionCandidates.find(candidate =>
        roomOf(candidate) === ordinaryCrossing.destinationRoom
        && footprintWalkable(candidate, regressionMaxSize, ordinaryCrossing.destinationRoom)
      );
      assert(regressionTile, 'regression door landing has a legal native tile for every possible Barrows encounter type');
      const beforeNids = new Set(activeNpcs().map(npc => npc.nid));
      withOptionalSquareChoice(
        ordinaryCrossing.destination,
        regressionTile,
        () => runLocAction(redPlayer, ordinaryCrossing),
        'baseline public door regression'
      );
      assert.deepEqual(
        [redPlayer.level, redPlayer.x, redPlayer.z],
        [ordinaryCrossing.destination.level, ordinaryCrossing.destination.x, ordinaryCrossing.destination.z],
        'the baseline regression control completes a valid public door crossing'
      );
      const spawned = spawnDelta(beforeNids);
      assert.equal(spawned.length, 1, 'S08 regression control: old public barrows_door_use must spawn one encounter after valid crossing');
      console.log('PASS S08 regression traversal: the selected public door crossed and spawned one actor');
      return;
    }

    for (const name of [
      'barrows_door_room', 'barrows_door_brother', 'barrows_door_select',
      'barrows_door_tile', 'barrows_door_encounter', 'barrows_door_destination'
    ]) assert(ScriptProvider.getByName(`[proc,${name}]`), `compiled S08 proc [proc,${name}] exists`);
    for (const name of ['barrows_actor_spawn', 'barrows_remove_owned', 'barrows_npc_credit', 'barrows_npc_level', 'barrows_credit']) {
      assert(ScriptProvider.getByName(`[proc,${name}]`), `compiled S04 hook [proc,${name}] exists`);
    }
    const creditQueue = ScriptProvider.getByName('[queue,barrows_credit_kill]');
    assert(creditQueue, 'the existing native Barrows credit queue is packed');
    activeRuntime = runtime;
    activeHitpointsIndex = hpIndex;
    activeNpcVars = npcVars;
    activeServerTrigger = ServerTriggerType;
    runtimePlayers = activePlayers;
    activeCreditQueue = creditQueue;

    assert.equal(constant('barrows_door_spawn_min_radius'), 0, 'door tile minimum radius remains zero');
    assert.equal(constant('barrows_door_spawn_radius'), 2, 'door tile maximum radius remains two');
    assert.equal(constant('barrows_door_summon_lifetime'), 1000, 'door summon lifetime remains the configured 1000 ticks');
    assert.equal(constant('barrows_owner_check_ticks'), 1, 'owned actors retain the one-tick owner timer');

    const drawClass = parseEnum(runtime.contentRoot, 'barrows_door_draw_class');
    const expectedDrawClass = Array.from({ length: 128 }, (_, draw) => [
      String(draw), draw < 12 ? 'brother' : draw < 64 ? 'skeleton' : draw < 96 ? 'bloodworm' : 'crypt_rat'
    ]);
    assert.equal(drawClass.size, 128, 'the draw enum contains all 128 outcomes');
    assert.deepEqual([...drawClass], expectedDrawClass, 'every exact draw row matches 12/52/32/32 classes in order');
    const classNpc = EnumType.getByName('barrows_door_class_npc');
    assert(classNpc, 'the native packed door-class enum exists');
    assert.deepEqual([...classNpc.values], [
      [0, npcId(DOOR_TYPES.skeleton)], [1, npcId(DOOR_TYPES.bloodworm)], [2, npcId(DOOR_TYPES.crypt_rat)]
    ], 'door monster classes join to the configured original NPC types');
    assert.equal(classNpc.defaultInt, -1, 'an unknown class has no fallback NPC');

    const brothers = BROTHERS.map(([name]) => ({ name, id: npcId(name) }));
    const doorNpc = Object.fromEntries(Object.entries(DOOR_TYPES).map(([name, type]) => [name, npcId(type)]));
    const selector = makePlayer('selector');
    setRun(selector, { phase: 1, generation: 402 });
    const eligibleFor = mask => brothers.filter((_, index) => (mask & (1 << index)) === 0);

    for (let mask = 0; mask < 64; mask++) {
      const eligible = eligibleFor(mask);
      for (let rank = 0; rank < eligible.length; rank++) {
        setRun(selector, { phase: 1, generation: 402, slain: mask });
        const brother = withDraws([[rank, eligible.length]], () => procInt(selector, 'barrows_door_brother'), `brother mask ${mask}, rank ${rank}`);
        assert.equal(brother.calls, 1, `brother mask ${mask}, rank ${rank}: one uniform eligible-rank draw`);
        assert.equal(brother.value, eligible[rank].id, `brother mask ${mask}, rank ${rank}: exact unset identity`);
        const preLoot = withDraws([[0, 128], [rank, eligible.length]], () => procInt(selector, 'barrows_door_select'), `unlooted mask ${mask}, rank ${rank}`);
        assert.equal(preLoot.calls, 2, `unlooted mask ${mask}, rank ${rank}: one 128-way draw and one eligible-rank draw`);
        assert.equal(preLoot.value, eligible[rank].id, `unlooted mask ${mask}, rank ${rank}: exact brother identity`);
        setRun(selector, { phase: 2, generation: 402, slain: mask });
        const paid = withDraws([[rank, eligible.length]], () => procInt(selector, 'barrows_door_select'), `paid mask ${mask}, rank ${rank}`);
        assert.equal(paid.calls, 1, `paid mask ${mask}, rank ${rank}: no 128-way draw`);
        assert.equal(paid.value, eligible[rank].id, `paid mask ${mask}, rank ${rank}: guaranteed unset brother`);
      }
    }

    setRun(selector, { phase: 1, generation: 402, slain: 63 });
    const emptyBrother = withDraws([], () => procInt(selector, 'barrows_door_brother'), 'empty brother pool');
    assert.equal(emptyBrother.value, -1, 'empty brother pool returns null');
    assert.equal(emptyBrother.calls, 0, 'empty brother pool consumes no rank draw');
    const emptyPreLoot = withDraws([[0, 128]], () => procInt(selector, 'barrows_door_select'), 'empty pre-loot pool');
    assert.equal(emptyPreLoot.value, -1, 'pre-loot brother outcome with an empty pool returns null');
    assert.equal(emptyPreLoot.calls, 1, 'empty pre-loot pool consumes no rank draw and does not reroll');
    setRun(selector, { phase: 2, generation: 402, slain: 63 });
    const emptyPaid = withDraws([], () => procInt(selector, 'barrows_door_select'), 'empty paid pool');
    assert.equal(emptyPaid.value, -1, 'empty paid pool returns null');
    assert.equal(emptyPaid.calls, 0, 'empty paid pool consumes no random draw');
    for (const phase of [0, 3]) {
      setRun(selector, { phase, generation: 402, slain: 0 });
      const inactive = withDraws([], () => procInt(selector, 'barrows_door_select'), `inactive phase ${phase}`);
      assert.equal(inactive.value, -1, `phase ${phase} returns null`);
      assert.equal(inactive.calls, 0, `phase ${phase} consumes no random draw`);
    }

    setRun(selector, { phase: 1, generation: 403, slain: 0x2d });
    const allEligible = eligibleFor(0x2d);
    assert.equal(allEligible.length, 2, 'controlled class table leaves two eligible identities');
    const outcomeCounts = { brother: 0, skeleton: 0, bloodworm: 0, crypt_rat: 0 };
    for (let draw = 0; draw < 128; draw++) {
      const group = draw < 12 ? 'brother' : draw < 64 ? 'skeleton' : draw < 96 ? 'bloodworm' : 'crypt_rat';
      const choices = [[draw, 128]];
      const expected = group === 'brother'
        ? allEligible[draw % allEligible.length].id
        : doorNpc[group === 'crypt_rat' ? 'crypt_rat' : group];
      if (group === 'brother') choices.push([draw % allEligible.length, allEligible.length]);
      const selected = withDraws(choices, () => procInt(selector, 'barrows_door_select'), `exact draw ${draw}`);
      assert.equal(selected.calls, choices.length, `draw ${draw}: exact random call count`);
      assert.equal(selected.value, expected, `draw ${draw}: exact selected NPC type`);
      outcomeCounts[group]++;
    }
    assert.deepEqual(outcomeCounts, { brother: 12, skeleton: 52, bloodworm: 32, crypt_rat: 32 }, 'compiled selector yields every exact class count');

    const roomProbe = makePlayer('room-probe');
    withDraws([], () => {
      for (let x = 3520; x < 3584; x++) {
        for (let z = 9664; z < 9728; z++) {
          const expected = expectedRoom(x, z);
          const actual = procInt(roomProbe, 'barrows_door_room', [CoordGrid.packCoord(0, x, z)]);
          assert.equal(actual, expected, `physical room classifier at ${x},${z}`);
        }
      }
    }, 'room classifier');

    const destinationRoom = ordinaryCrossing.destinationRoom;
    const tileTypes = [
      ['barrows_ahrim', npcId('barrows_ahrim')],
      [DOOR_TYPES.skeleton, doorNpc.skeleton],
      [DOOR_TYPES.bloodworm, doorNpc.bloodworm],
      [DOOR_TYPES.crypt_rat, doorNpc.crypt_rat]
    ];
    for (const [name, typeId] of tileTypes) {
      const type = NpcType.get(typeId);
      const origin = roomTiles(destinationRoom, type.size)[0];
      assert(origin, `${name}: original map has a legal room tile for the full NPC footprint`);
      const originResult = withSquareChoice(
        origin, typeId, origin, () => procInt(selector, 'barrows_door_tile', [pack(origin), typeId]), `${name} origin tile`
      );
      assert.equal(originResult.calls, 1, `${name}: exactly one uniform valid-tile rank draw`);
      assert.deepEqual(decode(originResult.value), origin, `${name}: min radius zero accepts the valid origin`);
      for (let dx = 0; dx < type.size; dx++) {
        for (let dz = 0; dz < type.size; dz++) {
          const footprint = { level: origin.level, x: origin.x + dx, z: origin.z + dz };
          assert.equal(roomOf(footprint), destinationRoom, `${name}: legal footprint stays in its room`);
          assert(tileWalkable(footprint), `${name}: legal footprint is collision-free on the native map`);
        }
      }
    }

    const nativeTypes = Array.from({ length: NpcType.count }, (_, id) => NpcType.get(id));
    const footprintType = nativeTypes.find(type => type && type.size > 1 && type.size <= 12
      && typeof type.debugname === 'string' && type.stats?.[hpIndex] > 0);
    const blockerType = nativeTypes.find(type => type && type.size === 1
      && typeof type.debugname === 'string' && type.stats?.[hpIndex] > 0);
    assert(footprintType, 'native NPC inventory contains a living multi-tile footprint for collision testing');
    assert(blockerType, 'native NPC inventory contains a living one-tile occupancy fixture');
    const footprintTypeId = NpcType.getId(footprintType.debugname);
    const occupiedLanding = roomTiles(destinationRoom, footprintType.size).find(origin => {
      const farCorner = {
        level: origin.level,
        x: origin.x + footprintType.size - 1,
        z: origin.z + footprintType.size - 1
      };
      return footprintWalkable(farCorner, blockerType.size, destinationRoom)
        && activePlayers.every(player => !overlapsFootprint(origin, footprintType.size, footprintType.size, player));
    });
    assert(occupiedLanding, 'native map has a room-contained multi-tile footprint for overlap checks');
    for (const [label, dx, dz] of [
      ['occupied origin', 0, 0],
      ['occupied far footprint tile', footprintType.size - 1, footprintType.size - 1]
    ]) {
      const occupiedPoint = { level: occupiedLanding.level, x: occupiedLanding.x + dx, z: occupiedLanding.z + dz };
      const blocker = addFixtureNpc(blockerType.debugname, occupiedPoint);
      try {
        assert.equal(mapApi.isMapBlocked(occupiedPoint.x, occupiedPoint.z, occupiedPoint.level), false,
          `${label}: native NPC occupancy is not a static MAP_FINDSQUARE collision`);
        const candidates = validTileCandidates(occupiedLanding, footprintTypeId);
        assert(candidates.every(tile => !overlapsFootprint(tile, footprintType.size, footprintType.size, blocker)),
          `${label}: independent oracle removes the entire occupied footprint`);
        if (candidates.length === 0) {
          assert.equal(withDraws([], () => procInt(selector, 'barrows_door_tile',
            [pack(occupiedLanding), footprintTypeId]), label).value, -1, `${label}: an empty valid set consumes no draw`);
        }
        for (const [rank, expected] of candidates.entries()) {
          const selected = withDraws([[rank, candidates.length]], () => procInt(selector, 'barrows_door_tile',
            [pack(occupiedLanding), footprintTypeId]), `${label}, rank ${rank}`);
          assert.deepEqual(decode(selected.value), expected, `${label}: every rank selects exactly one free full footprint`);
          assert(!overlapsFootprint(decode(selected.value), footprintType.size, footprintType.size, blocker),
            `${label}: neither origin nor far footprint tile can overlap an NPC`);
        }
      } finally {
        if (blocker.isActive) World.removeNpc(blocker, -1);
      }
    }
    clearNpcs();
    const crowdedOwner = makePlayer('one-free-footprint');
    const crowdedTiles = validTileCandidates(ordinaryCrossing.destination, doorNpc.bloodworm);
    assert(crowdedTiles.length > 1, 'crowded control starts with several valid footprint origins');
    const onlyFree = crowdedTiles.find(tile => pointKey(tile) === pointKey(ordinaryCrossing.destination));
    assert(onlyFree, 'the landing itself is the sole-free-tile control, with a zero-length walk line');
    const crowdedBlocks = [];
    for (const tile of crowdedTiles.filter(tile => pointKey(tile) !== pointKey(onlyFree))) {
      mapApi.changeLocCollision(10, 0, false, 1, 1, 0, tile.x, tile.z, tile.level, true);
      manualBlocks.push(tile);
      crowdedBlocks.push(tile);
    }
    try {
      addSpreadFixtures(destinationRoom, Array.from({ length: constant('barrows_door_room_cap') - 1 },
        () => ({ type: 'barrows_rat' })), ordinaryCrossing.destination);
      for (const [phase, typeId, draws] of [
        [1, doorNpc.bloodworm, [[64, 128]]],
        [2, npcId('barrows_ahrim'), [[0, 1]]]
      ]) {
        setRun(crowdedOwner, { phase, generation: 430 + phase, slain: 62,
          openLock: ordinaryCrossing.lock, position: ordinaryCrossing.source });
        assert.deepEqual(validTileCandidates(ordinaryCrossing.destination, typeId), [onlyFree],
          `phase ${phase}: exactly one valid full footprint remains below the shared cap`);
        const before = new Set(activeNpcs().map(npc => npc.nid));
        const result = withDoorSpawn(ordinaryCrossing.destination, typeId, draws,
          () => runLocAction(crowdedOwner, ordinaryCrossing), `phase ${phase} one-free-tile traversal`);
        const spawned = spawnDelta(before);
        assert.equal(spawned.length, 1, `phase ${phase}: an encounter is not lost while one valid tile exists`);
        assert.deepEqual({ level: spawned[0].level, x: spawned[0].x, z: spawned[0].z }, onlyFree,
          `phase ${phase}: the ordinary monster or guaranteed brother uses the sole free tile`);
        assert.equal(spawned[0].type, typeId, `phase ${phase}: placement never rerolls the selected class`);
        assert.equal(activeRoomNpcs(destinationRoom).length, constant('barrows_door_room_cap'),
          `phase ${phase}: ten shared living enemies admit the eleventh`);
        console.log(JSON.stringify({ case: 'one-free-valid-tile', phase, commands: result.value.opcount, tile: onlyFree }));
        World.removeNpc(spawned[0], -1);
      }
    } finally {
      restoreBlocks(crowdedBlocks);
      clearNpcs();
    }

    // UNKNOWN engineering test policy: deterministic xorshift32 sample, 500
    // observations per valid origin and an 18% relative tolerance (over 4 sigma).
    const tileSeed = 0x377b4;
    const trialsPerTile = 500;
    const relativeTolerance = 0.18;
    const uniformTiles = validTileCandidates(ordinaryCrossing.destination, doorNpc.bloodworm);
    assert(uniformTiles.length > 1, 'uniformity control contains multiple valid origins');
    const frequencies = new Map(uniformTiles.map(tile => [pointKey(tile), 0]));
    const samples = uniformTiles.length * trialsPerTile;
    let randomState = tileSeed;
    let tileDraws = 0;
    const originalTileRandom = JavaRandom.nextDouble;
    JavaRandom.nextDouble = () => {
      tileDraws++;
      randomState ^= randomState << 13;
      randomState ^= randomState >>> 17;
      randomState ^= randomState << 5;
      return (randomState >>> 0) / 2 ** 32;
    };
    try {
      for (let trial = 0; trial < samples; trial++) {
        const selected = decode(procInt(selector, 'barrows_door_tile', [pack(ordinaryCrossing.destination), doorNpc.bloodworm]));
        const key = pointKey(selected);
        assert(frequencies.has(key), 'uniform sample selects only independently valid full footprints');
        frequencies.set(key, frequencies.get(key) + 1);
      }
    } finally {
      JavaRandom.nextDouble = originalTileRandom;
    }
    assert.equal(tileDraws, samples, 'one and only one placement rank is drawn per nonempty valid set');
    for (const [key, count] of frequencies) assert(Math.abs(count - trialsPerTile) <= trialsPerTile * relativeTolerance,
      `${key}: uniform frequency ${count} is within the stated seeded tolerance`);
    console.log(JSON.stringify({ case: 'uniform-valid-tiles', seed: tileSeed, samples, trialsPerTile,
      relativeTolerance, frequencies: [...frequencies] }));


    const invalidBlocks = blockRoomRadius(ordinaryCrossing.destination, destinationRoom);
    try {
      const invalidTile = withMapDraws(
        [],
        () => withDraws([], () => procInt(selector, 'barrows_door_tile', [pack(ordinaryCrossing.destination), doorNpc.bloodworm]), 'no legal tile'),
        'no legal tile'
      );
      assert.equal(invalidTile.value.value, -1, 'no legal destination footprint returns null');
      assert.equal(invalidTile.value.calls, 0, 'failed tile search consumes no script RNG');
      assert.equal(invalidTile.calls, 0, 'empty valid set consumes no native map draw');

      const invalidPlayer = makePlayer('invalid-placement');
      setRun(invalidPlayer, { phase: 1, generation: 404, openLock: ordinaryCrossing.lock, position: ordinaryCrossing.source });
      const beforeNids = new Set(activeNpcs().map(npc => npc.nid));
      const invalidCrossing = withMapDraws(
        [],
        () => withDraws([[64, 128]], () => runLocAction(invalidPlayer, ordinaryCrossing), 'crossing with no placement'),
        'crossing with no placement'
      );
      assert.equal(invalidCrossing.value.calls, 1, 'invalid placement performs one class selection attempt');
      assert.equal(invalidCrossing.calls, 0, 'invalid placement consumes no native map draw or reroll');
      assert.deepEqual(
        [invalidPlayer.level, invalidPlayer.x, invalidPlayer.z],
        [ordinaryCrossing.destination.level, ordinaryCrossing.destination.x, ordinaryCrossing.destination.z],
        'invalid placement does not cancel the successful room transfer'
      );
      assert.equal(spawnDelta(beforeNids).length, 0, 'invalid placement creates no source-side or invalid NPC');
    } finally {
      restoreBlocks(invalidBlocks);
    }

    clearNpcs();
    const traversalOwner = makePlayer('traversal-owner');
    setRun(traversalOwner, { phase: 1, generation: 405, openLock: ordinaryCrossing.lock, position: ordinaryCrossing.source });
    const bloodwormType = NpcType.get(doorNpc.bloodworm);
    const candidateTiles = new Set(nativeSquareCandidates(ordinaryCrossing.destination)
      .filter(point => roomOf(point) === destinationRoom && footprintWalkable(point, bloodwormType.size, destinationRoom))
      .map(point => `${point.x},${point.z}`));
    assert(candidateTiles.size > 0, 'the real destination has an open full-footprint tile within radius two');
    const beforeNids = new Set(activeNpcs().map(npc => npc.nid));
    const traversal = withDoorSpawn(
      ordinaryCrossing.destination,
      doorNpc.bloodworm,
      [[64, 128]],
      () => runLocAction(traversalOwner, ordinaryCrossing),
      'valid monster traversal'
    );
    assert.equal(traversal.scriptCalls, 1, 'one successful door transfer makes one class draw');
    assert.equal(traversal.tileCalls, 1, 'placement makes exactly one uniform valid-tile rank draw');
    assert.deepEqual(
      [traversalOwner.level, traversalOwner.x, traversalOwner.z],
      [ordinaryCrossing.destination.level, ordinaryCrossing.destination.x, ordinaryCrossing.destination.z],
      'native door transfer reaches the measured destination landing'
    );
    const doorActors = spawnDelta(beforeNids);
    assert.equal(doorActors.length, 1, 'one successful traversal attempts exactly one spawn');
    const bloodworm = doorActors[0];
    assert.equal(bloodworm.type, doorNpc.bloodworm, 'draw 64 spawns the configured bloodworm');
    assert.equal(bloodworm.level, ordinaryCrossing.destination.level, 'spawn uses the measured destination plane');
    assert.equal(`${bloodworm.x},${bloodworm.z}`, `${traversal.tile.x},${traversal.tile.z}`, 'controlled valid-tile rank selects the asserted destination tile');
    assert(candidateTiles.has(`${bloodworm.x},${bloodworm.z}`), 'spawn tile is native-map legal and within radius two of the destination');
    assert.equal(roomOf(bloodworm), destinationRoom, 'spawn is wholly on the destination side, never the source side');
    assert.equal(bloodworm.width, bloodwormType.size, 'spawn uses the original NPC width');
    assert.equal(bloodworm.length, bloodwormType.size, 'spawn uses the original NPC length');
    for (let dx = 0; dx < bloodwormType.size; dx++) {
      for (let dz = 0; dz < bloodwormType.size; dz++) {
        assert.equal(roomOf({ level: bloodworm.level, x: bloodworm.x + dx, z: bloodworm.z + dz }), destinationRoom, 'spawn footprint remains wholly inside its destination room');
      }
    }
    assert.equal(bloodworm.getVar(npcVars.npc_barrows_owner), traversalOwner.uid, 'door actor stores its owner uid');
    assert.equal(bloodworm.getVar(npcVars.npc_barrows_generation), 405, 'door actor captures the current run generation');
    assert.equal(bloodworm.lifecycle, EntityLifeCycle.DESPAWN, 'door actor uses the owned summon despawn lifecycle');
    assert.equal(bloodworm.lifecycleTick, constant('barrows_door_summon_lifetime'), 'door actor captures the configured 1000-tick lifetime');
    assert.equal(bloodworm.lastLifecycleTick, World.currentTick, 'door actor lifetime begins on the spawn tick');
    assert.equal(bloodworm.timerInterval, constant('barrows_owner_check_ticks'), 'door actor arms the one-tick owner timer');
    assert.equal(bloodworm.timerClock, 0, 'door actor timer starts at its first native tick');
    const bloodwormLevel = procInt(traversalOwner, 'barrows_npc_level', [doorNpc.bloodworm]);
    assert.equal(bloodwormLevel, 52, 'the existing S04 NPC-level join supplies bloodworm credit level');
    killThroughNative(bloodworm, traversalOwner, traversalOwner, 'owned bloodworm death');
    const bloodwormCredit = u32(traversalOwner.getVar(vars.barrows_kills));
    assert.equal(readRange(bloodwormCredit, ranges.slain), 0, 'ordinary door monster death sets no brother identity bit');
    assert.equal(readRange(bloodwormCredit, ranges.potential), bloodwormLevel, 'owner killer receives the monster combat-level potential');
    assert.equal(readRange(bloodwormCredit, ranges.count), 1, 'owner killer receives one normal displayed-kill credit');

    const blockedPlayer = makePlayer('locked-control');
    setRun(blockedPlayer, { phase: 1, generation: 406, position: ordinaryCrossing.source });
    const lockedTrigger = nativeLocTrigger(blockedPlayer, ordinaryCrossing.loc);
    assert.equal(lockedTrigger, null, 'a locked child has no native OPLOC1 trigger');
    const lockedBefore = new Set(activeNpcs().map(npc => npc.nid));
    const locked = withMapDraws([], () => withDraws(
      [], () => procVoid(blockedPlayer, 'barrows_door_use', [ordinaryCrossing.id, pack(ordinaryCrossing.anchor)], ordinaryCrossing.loc), 'locked door refusal'
    ), 'locked door refusal');
    assert.equal(locked.calls, 0, 'locked door refusal consumes no native tile draw');
    assert.equal(locked.value.calls, 0, 'locked door refusal consumes no script selection draw');
    assert.deepEqual(
      [blockedPlayer.level, blockedPlayer.x, blockedPlayer.z],
      [ordinaryCrossing.source.level, ordinaryCrossing.source.x, ordinaryCrossing.source.z],
      'locked public helper does not transfer the player'
    );
    assert.equal(spawnDelta(lockedBefore).length, 0, 'locked door refusal spawns no actor');

    const puzzlePlayer = makePlayer('unsolved-central');
    setRun(puzzlePlayer, { phase: 1, generation: 407, openLock: centralCrossing.lock, solved: false, position: centralCrossing.source });
    const puzzleBefore = new Set(activeNpcs().map(npc => npc.nid));
    const unsolved = withMapDraws([], () => withDraws(
      [[2, 4], [3, 6]], () => runLocAction(puzzlePlayer, centralCrossing, ScriptState.PAUSEBUTTON), 'unsolved central door'
    ), 'unsolved central door');
    assert.equal(unsolved.calls, 0, 'unsolved central door does not attempt a native tile draw');
    assert.equal(unsolved.value.calls, 2, 'the unanswered puzzle draws only its family and permutation');
    assert.deepEqual(
      [puzzlePlayer.level, puzzlePlayer.x, puzzlePlayer.z],
      [centralCrossing.source.level, centralCrossing.source.x, centralCrossing.source.z],
      'unsolved central door does not transfer the player'
    );
    assert.equal(spawnDelta(puzzleBefore).length, 0, 'unsolved central door spawns no actor');
    withMapDraws([], () => withDraws([], () => puzzlePlayer.closeModal(), 'cancel unanswered puzzle'), 'cancel unanswered puzzle');
    assert.equal(puzzlePlayer.activeScript, null, 'cancellation removes the unanswered door continuation');
    assert.equal(readRange(u32(puzzlePlayer.getVar(vars.barrows_state)), [15, 15]), 0, 'cancellation clears only the active challenge');
    assert.equal(spawnDelta(puzzleBefore).length, 0, 'canceling the puzzle never creates a door actor');

    clearNpcs();
    const occupancyOwner = makePlayer('occupancy-owner');
    const otherOwner = makePlayer('occupancy-other-owner');
    setRun(occupancyOwner, { phase: 1, generation: 408, position: ordinaryCrossing.destination });
    setRun(otherOwner, { phase: 1, generation: 409, position: ordinaryCrossing.destination });
    const outsideRoom = destinationRoom === 0 ? 1 : 0;
    const unrelatedEnemy = Array.from({ length: NpcType.count }, (_, id) => NpcType.get(id)).find(type =>
      type && typeof type.debugname === 'string' && !type.debugname.startsWith('barrows_')
      && type.stats?.[hpIndex] > 0 && type.size > 0
    );
    assert(unrelatedEnemy, 'packed NPC inventory contains an unrelated combat enemy for shared occupancy');
    const insideRows = [
      { type: 'barrows_rat', ownerUid: otherOwner.uid, generation: 409 },
      { type: 'barrows_spider' },
      { type: 'barrows_bloodworm' },
      { type: 'barrows_skeleton_armed', ownerUid: otherOwner.uid, generation: 409 },
      { type: 'barrows_giantrat' },
      { type: 'barrows_giantspider' },
      { type: 'barrows_ahrim', ownerUid: otherOwner.uid, generation: 409 },
      { type: 'barrows_rat' },
      { type: unrelatedEnemy.debugname },
      { type: 'barrows_bloodworm' },
      { type: 'barrows_skeleton_unarmed', hitpoints: 0 }
    ];
    const insideFixtures = addSpreadFixtures(destinationRoom, insideRows, ordinaryCrossing.destination);
    const outsideRows = Array.from({ length: 11 }, (_, index) => ({
      type: index % 2 === 0 ? 'barrows_rat' : 'barrows_spider',
      ownerUid: index % 2 === 0 ? otherOwner.uid : null,
      generation: 409
    }));
    addSpreadFixtures(outsideRoom, outsideRows);
    assert.equal(activeRoomNpcs(destinationRoom).length, 10, 'shared room has ten living NPCs after dead-NPC exclusion');
    assert.equal(activeRoomNpcs(outsideRoom).length, 11, 'other room contains eleven living control NPCs');
    assert(insideFixtures.some(({ npc }) => npc.type === npcId(unrelatedEnemy.debugname)), 'a non-Barrows enemy occupies the destination room');
    assert(insideFixtures.some(({ npc }) => npc.getVar(npcVars.npc_barrows_owner) === otherOwner.uid), 'another owner has living actors in the destination room');

    const beforeTen = new Set(activeNpcs().map(npc => npc.nid));
    const atTen = withDoorSpawn(
      ordinaryCrossing.destination,
      doorNpc.crypt_rat,
      [[96, 128]],
      () => procVoid(occupancyOwner, 'barrows_door_encounter', [pack(ordinaryCrossing.destination)]),
      'ten living shared occupants'
    );
    assert.equal(atTen.scriptCalls, 1, 'the tenth living shared occupant permits one class draw');
    assert.equal(atTen.tileCalls, 1, 'cap-ten spawn uses exactly one valid-tile draw');
    const atTenSpawn = spawnDelta(beforeTen);
    assert.equal(atTenSpawn.length, 1, 'ten living NPCs allow the room to grow to eleven');
    assert.equal(atTenSpawn[0].type, doorNpc.crypt_rat, 'draw 96 resolves to the configured crypt rat');
    assert.equal(`${atTenSpawn[0].x},${atTenSpawn[0].z}`, `${atTen.tile.x},${atTen.tile.z}`, 'cap-ten actor uses the controlled free tile');
    assert.equal(roomOf(atTenSpawn[0]), destinationRoom, 'cap-bound spawn remains in the measured destination room');
    assert.equal(activeRoomNpcs(destinationRoom).length, 11, 'one spawn raises shared occupancy from ten to eleven');

    const capPlayer = makePlayer('cap-eleven-transfer');
    setRun(capPlayer, { phase: 1, generation: 410, openLock: ordinaryCrossing.lock, position: ordinaryCrossing.source });
    const beforeEleven = new Set(activeNpcs().map(npc => npc.nid));
    const atEleven = withMapDraws([], () => withDraws(
      [], () => runLocAction(capPlayer, ordinaryCrossing), 'eleven living shared occupants'
    ), 'eleven living shared occupants');
    assert.equal(atEleven.calls, 0, 'eleven living NPCs suppress every native tile draw');
    assert.equal(atEleven.value.calls, 0, 'eleven living NPCs suppress every selection draw');
    assert.deepEqual(
      [capPlayer.level, capPlayer.x, capPlayer.z],
      [ordinaryCrossing.destination.level, ordinaryCrossing.destination.x, ordinaryCrossing.destination.z],
      'the room cap suppresses only the spawn and permits traversal'
    );
    assert.equal(spawnDelta(beforeEleven).length, 0, 'eleven living NPCs suppress the spawn');
    assert.equal(activeRoomNpcs(destinationRoom).length, 11, 'cap suppression leaves the shared room occupancy unchanged');

    clearNpcs();
    const paidOwner = makePlayer('paid-guarantee');
    const paidMask = 0x15;
    const paidEligible = eligibleFor(paidMask);
    setRun(paidOwner, { phase: 2, generation: 411, slain: paidMask, openLock: ordinaryCrossing.lock, position: ordinaryCrossing.source });
    const beforePaid = new Set(activeNpcs().map(npc => npc.nid));
    const paidTraversal = withDoorSpawn(
      ordinaryCrossing.destination,
      paidEligible[0].id,
      [[0, paidEligible.length]],
      () => runLocAction(paidOwner, ordinaryCrossing),
      'paid guaranteed brother'
    );
    assert.equal(paidTraversal.scriptCalls, 1, 'paid door uses only the unset-brother rank draw');
    assert.equal(paidTraversal.tileCalls, 1, 'paid brother uses exactly one valid-tile draw');
    assert.deepEqual(
      [paidOwner.level, paidOwner.x, paidOwner.z],
      [ordinaryCrossing.destination.level, ordinaryCrossing.destination.x, ordinaryCrossing.destination.z],
      'paid encounter follows the successful door transfer'
    );
    const paidActors = spawnDelta(beforePaid);
    assert.equal(paidActors.length, 1, 'paid traversal guarantees one eligible brother below the room cap');
    assert.equal(paidActors[0].type, paidEligible[0].id, 'paid traversal selects the exact unset identity');
    assert.equal(`${paidActors[0].x},${paidActors[0].z}`, `${paidTraversal.tile.x},${paidTraversal.tile.z}`, 'paid brother uses the controlled legal tile');
    assert.equal(paidActors[0].getVar(npcVars.npc_barrows_owner), paidOwner.uid, 'paid actor keeps its owner');
    assert.equal(paidActors[0].getVar(npcVars.npc_barrows_generation), 411, 'paid actor captures its paid-run generation');
    const paidCreditBefore = u32(paidOwner.getVar(vars.barrows_kills));
    killThroughNative(paidActors[0], paidOwner, paidOwner, 'paid brother death');
    assert.equal(u32(paidOwner.getVar(vars.barrows_kills)), paidCreditBefore, 'phase-two paid brother death grants no credit');

    clearNpcs();
    const emptyPaidOwner = makePlayer('paid-empty-pool');
    setRun(emptyPaidOwner, { phase: 2, generation: 412, slain: 63, openLock: ordinaryCrossing.lock, position: ordinaryCrossing.source });
    const beforeEmptyPaid = new Set(activeNpcs().map(npc => npc.nid));
    const noPaidBrother = withMapDraws([], () => withDraws(
      [], () => runLocAction(emptyPaidOwner, ordinaryCrossing), 'paid empty brother pool'
    ), 'paid empty brother pool');
    assert.equal(noPaidBrother.calls, 0, 'paid empty pool consumes no native tile draw');
    assert.equal(noPaidBrother.value.calls, 0, 'paid empty pool consumes no selection draw');
    assert.deepEqual(
      [emptyPaidOwner.level, emptyPaidOwner.x, emptyPaidOwner.z],
      [ordinaryCrossing.destination.level, ordinaryCrossing.destination.x, ordinaryCrossing.destination.z],
      'empty paid brother pool does not block traversal'
    );
    assert.equal(spawnDelta(beforeEmptyPaid).length, 0, 'paid full slain mask does not spawn or reroll');

    clearNpcs();
    const twinOwner = makePlayer('living-twins');
    const twinLanding = ordinaryCrossing.destination;
    setRun(twinOwner, { phase: 1, generation: 413, slain: 0, position: twinLanding });
    const twinA = withDoorSpawn(
      twinLanding,
      npcId('barrows_ahrim'),
      [[0, 128], [0, 6]],
      () => procVoid(twinOwner, 'barrows_door_encounter', [pack(twinLanding)]),
      'first Ahrim twin'
    );
    assert.equal(twinA.scriptCalls, 2, 'brother encounter consumes one class draw and one identity-rank draw');
    assert.equal(twinA.tileCalls, 1, 'first twin uses one valid-tile draw');
    const livingFirstTwin = activeNpcs().find(npc => npc.type === npcId('barrows_ahrim'));
    assert(livingFirstTwin, 'first eligible Ahrim encounter is alive');
    assert.deepEqual([livingFirstTwin.x, livingFirstTwin.z], [twinA.tile.x, twinA.tile.z], 'first twin uses its controlled legal tile');
    const stillEligible = withDraws([[0, 6]], () => procInt(twinOwner, 'barrows_door_brother'), 'living twin remains eligible');
    assert.equal(stillEligible.value, npcId('barrows_ahrim'), 'an active same-identity brother does not leave the unset pool');
    const twinB = withDoorSpawn(
      twinLanding,
      npcId('barrows_ahrim'),
      [[0, 128], [0, 6]],
      () => procVoid(twinOwner, 'barrows_door_encounter', [pack(twinLanding)]),
      'second Ahrim twin'
    );
    assert.equal(twinB.scriptCalls, 2, 'living twin encounter consumes one class draw and one identity-rank draw');
    assert.equal(twinB.tileCalls, 1, 'second twin uses one valid-tile draw');
    const twins = activeNpcs().filter(npc => npc.type === npcId('barrows_ahrim'));
    assert.equal(twins.length, 2, 'door encounters allow two living actors of one unset identity');
    const secondTwin = twins.find(npc => npc !== livingFirstTwin);
    assert.deepEqual([secondTwin.x, secondTwin.z], [twinB.tile.x, twinB.tile.z], 'second twin uses a distinct controlled legal tile');
    assert(twins[0].x + twins[0].width <= twins[1].x || twins[1].x + twins[1].width <= twins[0].x
      || twins[0].z + twins[0].length <= twins[1].z || twins[1].z + twins[1].length <= twins[0].z,
    'two living twins have nonoverlapping native footprints');
    const ahrimLevel = procInt(twinOwner, 'barrows_npc_level', [npcId('barrows_ahrim')]);
    assert.equal(ahrimLevel, 98, 'the existing S04 NPC-level join supplies Ahrim credit level');
    killThroughNative(twins[0], twinOwner, twinOwner, 'first unique Ahrim death');
    const firstTwinCredit = u32(twinOwner.getVar(vars.barrows_kills));
    assert.equal(readRange(firstTwinCredit, ranges.slain), 1, 'first Ahrim death sets only Ahrim identity credit');
    assert.equal(readRange(firstTwinCredit, ranges.potential), ahrimLevel, 'first Ahrim death adds its existing level once');
    assert.equal(readRange(firstTwinCredit, ranges.count), 1, 'first Ahrim death increments the displayed count once');
    killThroughNative(twins[1], twinOwner, twinOwner, 'second unique Ahrim twin death');
    assert.equal(u32(twinOwner.getVar(vars.barrows_kills)), firstTwinCredit, 'second twin death cannot credit the already-slain identity twice');

    clearNpcs();
    const foreignOwner = makePlayer('foreign-owner');
    const foreignKiller = makePlayer('foreign-killer');
    setRun(foreignOwner, { phase: 1, generation: 414, position: twinLanding });
    setRun(foreignKiller, { phase: 1, generation: 415, position: twinLanding });
    const foreignBefore = new Set(activeNpcs().map(npc => npc.nid));
    const foreignActorSetup = withDoorSpawn(
      twinLanding,
      doorNpc.bloodworm,
      [[64, 128]],
      () => procVoid(foreignOwner, 'barrows_door_encounter', [pack(twinLanding)]),
      'foreign-killer actor setup'
    );
    const foreignActor = spawnDelta(foreignBefore)[0];
    assert.equal(foreignActorSetup.scriptCalls, 1, 'foreign-killer actor setup uses one class draw');
    assert.equal(foreignActorSetup.tileCalls, 1, 'foreign-killer actor setup uses one valid-tile draw');
    assert(foreignActor, 'door encounter creates an owned actor for the foreign-killer control');
    assert.deepEqual([foreignActor.x, foreignActor.z], [foreignActorSetup.tile.x, foreignActorSetup.tile.z], 'foreign-killer actor uses its controlled tile');
    const ownerCreditBefore = u32(foreignOwner.getVar(vars.barrows_kills));
    const killerCreditBefore = u32(foreignKiller.getVar(vars.barrows_kills));
    killThroughNative(foreignActor, foreignKiller, foreignOwner, 'foreign player kills owned actor');
    assert.equal(u32(foreignOwner.getVar(vars.barrows_kills)), ownerCreditBefore, 'foreign killing blow grants no owned-summon credit to its owner');
    assert.equal(u32(foreignKiller.getVar(vars.barrows_kills)), killerCreditBefore, 'foreign killing blow grants no owned-summon credit to the killer');

    clearNpcs();
    const cleanupOwner = makePlayer('cleanup-owner');
    const cleanupPeer = makePlayer('cleanup-peer');
    setRun(cleanupOwner, { phase: 1, generation: 416, position: twinLanding });
    setRun(cleanupPeer, { phase: 1, generation: 417, position: twinLanding });
    const cleanupBefore = new Set(activeNpcs().map(npc => npc.nid));
    const cleanupActorSetup = withDoorSpawn(
      twinLanding,
      doorNpc.bloodworm,
      [[64, 128]],
      () => procVoid(cleanupOwner, 'barrows_door_encounter', [pack(twinLanding)]),
      'owned cleanup actor'
    );
    const cleanupActor = spawnDelta(cleanupBefore)[0];
    assert.equal(cleanupActorSetup.scriptCalls, 1, 'owned cleanup actor setup uses one class draw');
    assert.equal(cleanupActorSetup.tileCalls, 1, 'owned cleanup actor setup uses one valid-tile draw');
    assert(cleanupActor && cleanupActor.getVar(npcVars.npc_barrows_owner) === cleanupOwner.uid, 'cleanup control has an owned door actor');
    assert.deepEqual([cleanupActor.x, cleanupActor.z], [cleanupActorSetup.tile.x, cleanupActorSetup.tile.z], 'owner cleanup actor uses its controlled tile');
    const peerBefore = new Set(activeNpcs().map(npc => npc.nid));
    const peerActorSetup = withDoorSpawn(
      twinLanding,
      doorNpc.crypt_rat,
      [[96, 128]],
      () => procVoid(cleanupPeer, 'barrows_door_encounter', [pack(twinLanding)]),
      'foreign cleanup survivor'
    );
    const peerActor = spawnDelta(peerBefore)[0];
    assert.equal(peerActorSetup.scriptCalls, 1, 'foreign cleanup actor setup uses one class draw');
    assert.equal(peerActorSetup.tileCalls, 1, 'foreign cleanup actor setup uses one valid-tile draw');
    assert(peerActor && peerActor.getVar(npcVars.npc_barrows_owner) === cleanupPeer.uid, 'cleanup control has a second owner actor');
    assert.deepEqual([peerActor.x, peerActor.z], [peerActorSetup.tile.x, peerActorSetup.tile.z], 'peer cleanup actor uses its controlled tile');
    assert(cleanupActor.x + cleanupActor.width <= peerActor.x || peerActor.x + peerActor.width <= cleanupActor.x
      || cleanupActor.z + cleanupActor.length <= peerActor.z || peerActor.z + peerActor.length <= cleanupActor.z,
    'owner and peer summons use distinct nonoverlapping tiles');
    const mapTile = roomTiles(destinationRoom, NpcType.get(npcId('barrows_spider')).size).find(point =>
      activeNpcs().every(npc => chebyshev(npc, point) > 2)
    );
    assert(mapTile, 'native map has an unoccupied tile for the unrelated map actor control');
    const mapActor = addFixtureNpc('barrows_spider', mapTile);
    const cleanupCredit = u32(cleanupOwner.getVar(vars.barrows_kills));
    procVoid(cleanupOwner, 'barrows_remove_owned');
    assert.equal(cleanupActor.isActive, false, 'owner cleanup removes the caller’s door summon');
    assert.equal(peerActor.isActive, true, 'owner cleanup preserves another player’s door summon');
    assert.equal(mapActor.isActive, true, 'owner cleanup preserves an unrelated map placement');
    assert.equal(u32(cleanupOwner.getVar(vars.barrows_kills)), cleanupCredit, 'owner cleanup grants no death credit');

    clearNpcs();
    const finalEmptyOwner = makePlayer('preloot-empty-pool');
    setRun(finalEmptyOwner, { phase: 1, generation: 418, slain: 63, openLock: ordinaryCrossing.lock, position: ordinaryCrossing.source });
    const finalEmptyBefore = new Set(activeNpcs().map(npc => npc.nid));
    const preLootEmptyEncounter = withMapDraws([], () => withDraws(
      [[0, 128]], () => runLocAction(finalEmptyOwner, ordinaryCrossing), 'pre-loot empty brother branch'
    ), 'pre-loot empty brother branch');
    assert.equal(preLootEmptyEncounter.calls, 0, 'pre-loot empty pool consumes no native tile draw');
    assert.equal(preLootEmptyEncounter.value.calls, 1, 'pre-loot empty pool consumes only the 128-way class draw');
    assert.deepEqual(
      [finalEmptyOwner.level, finalEmptyOwner.x, finalEmptyOwner.z],
      [ordinaryCrossing.destination.level, ordinaryCrossing.destination.x, ordinaryCrossing.destination.z],
      'empty pre-loot brother pool does not block traversal'
    );
    assert.equal(spawnDelta(finalEmptyBefore).length, 0, 'empty pre-loot brother pool creates no actor and does not reroll');
    const inactiveOwner = makePlayer('inactive-encounter');
    setRun(inactiveOwner, { phase: 0, generation: 419, position: ordinaryCrossing.destination });
    const beforeInactive = new Set(activeNpcs().map(npc => npc.nid));
    const inactiveEncounter = withMapDraws([], () => withDraws(
      [], () => procVoid(inactiveOwner, 'barrows_door_encounter', [pack(ordinaryCrossing.destination)]), 'inactive encounter phase'
    ), 'inactive encounter phase');
    assert.equal(inactiveEncounter.calls, 0, 'inactive phase consumes no native map tile draw');
    assert.equal(inactiveEncounter.value.calls, 0, 'inactive phase consumes no script selection draw');
    assert.equal(spawnDelta(beforeInactive).length, 0, 'inactive phase creates no encounter actor');

    const ungeneratedOwner = makePlayer('ungenerated-encounter');
    setRun(ungeneratedOwner, { phase: 1, generation: 0, position: ordinaryCrossing.destination });
    const beforeUngenerated = new Set(activeNpcs().map(npc => npc.nid));
    const ungeneratedEncounter = withMapDraws([], () => withDraws(
      [], () => procVoid(ungeneratedOwner, 'barrows_door_encounter', [pack(ordinaryCrossing.destination)]), 'zero-generation encounter'
    ), 'zero-generation encounter');
    assert.equal(ungeneratedEncounter.calls, 0, 'zero generation consumes no native map tile draw');
    assert.equal(ungeneratedEncounter.value.calls, 0, 'zero generation consumes no script selection draw');
    assert.equal(spawnDelta(beforeUngenerated).length, 0, 'zero generation creates no encounter actor');

    console.log('PASS S08 room classifier: all 4096 coordinates across the Barrows mapsquare');
    console.log('PASS S08 exact selector: 128 rows, 12/52/32/32 outcomes, all slain masks and eligible ranks');
    console.log('PASS S08 native doors: destination-side footprint, origin radius zero, invalid tile, lock and puzzle guards');
    console.log('PASS S08 occupancy: shared living cap at 10/11, other owners, unrelated enemies, dead NPCs and other rooms');
    console.log('PASS S08 ownership and credit: paid guarantee, native death hooks, twin idempotence and owner-only cleanup');
    console.log('PASS S08 encounter admission: inactive phase and zero generation consume no draws or spawns');
  } finally {
    for (const point of [...manualBlocks].reverse()) {
      mapApi.changeLocCollision(10, 0, false, 1, 1, 0, point.x, point.z, point.level, false);
    }
    for (const npc of activeNpcs()) World.removeNpc(npc, -1);
    for (const player of players) {
      delete World.players[player.slot];
      player.unlink();
      player.isActive = false;
    }
  }
});

function npcProc(runtime, npc, name, args = []) {
  const script = runtime.ScriptProvider.getByName(`[proc,${name}]`);
  assert(script, `compiled NPC proc [proc,${name}] exists`);
  const state = runtime.ScriptRunner.init(script, npc, null, args);
  npc.executeScript(state);
  assert.equal(state.execution, runtime.ScriptState.FINISHED, `${name} finishes in native NPC context`);
  assert.equal(npc.activeScript, null, `${name} leaves no suspended NPC proc`);
  assert.equal(npc.delayed, false, `${name} leaves no NPC delay`);
  return state;
}

function capturedCreditRequests(player, queue) {
  return Array.from(player.queue.all()).filter(request => request.script === queue);
}

function killThroughNative(npc, killer, creditOwner, label) {
  const runtime = activeRuntime;
  const hpIndex = activeHitpointsIndex;
  assert(npc.isActive, `${label}: actor is alive before normal damage`);
  const hitpoints = npc.levels[hpIndex];
  assert(hitpoints > 0, `${label}: actor has positive native hitpoints`);
  npc.setVar(activeNpcVars.npc_attacking_uid, killer.uid);
  npc.setVar(activeNpcVars.npc_aggressive_player, killer.uid);
  npc.target = killer;
  npc.heroPoints.addHero(killer.hash64, hitpoints);
  npcProc(runtime, npc, 'npc_default_damage', [hitpoints]);
  assert.equal(npc.levels[hpIndex], 0, `${label}: native damage reduces the actor to zero hitpoints`);
  assert(Array.from(npc.queue.all()).some(request => request.queueId === activeServerTrigger.AI_QUEUE3), `${label}: lethal damage queues the native death trigger`);
  let turns = 0;
  while ((npc.isActive || runtimePlayers.some(player => capturedCreditRequests(player, activeCreditQueue).length > 0)) && turns < 1024) {
    runtime.World.currentTick++;
    if (npc.isActive) npc.turn();
    for (const player of runtimePlayers) if (player.isActive) player.processQueues();
    turns++;
  }
  assert(turns < 1024, `${label}: native death and credit queues complete`);
  assert.equal(npc.isActive, false, `${label}: ordinary NPC death removes the actor`);
  assert.equal(capturedCreditRequests(creditOwner, activeCreditQueue).length, 0, `${label}: owner credit queue has no pending delivery`);
}

