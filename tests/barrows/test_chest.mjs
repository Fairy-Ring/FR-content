#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createRunner, loadPackedRuntime, parseOptions, resolveRoots, run } from './packed.mjs';

function parseTestOptions(argv) {
  const forwarded = argv.slice(0, 2);
  let regression = false;
  let baselinePack = null;
  for (let index = 2; index < argv.length; index++) {
    const [name, inlineValue] = argv[index].split(/=(.*)/s, 2);
    if (name === '--regression') {
      assert.equal(inlineValue, undefined, '--regression takes no value');
      assert.equal(regression, false, '--regression can be supplied once');
      regression = true;
      continue;
    }
    if (name === '--baseline-pack') {
      assert.equal(baselinePack, null, '--baseline-pack can be supplied once');
      const value = inlineValue ?? argv[++index];
      assert(value && !value.startsWith('--'), '--baseline-pack requires a pack directory');
      baselinePack = path.resolve(value);
      continue;
    }
    forwarded.push(argv[index]);
  }
  assert(baselinePack === null || regression, '--baseline-pack requires --regression');
  return { options: parseOptions(forwarded), regression, baselinePack };
}

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
  assert(map, `${filename}: expected a packed mapsquare name`);
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

function readLocBlock(contentRoot, name) {
  const file = path.join(contentRoot, 'scripts/_unpack/377/all.loc');
  const text = fs.readFileSync(file, 'utf8');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`\\[${escaped}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\[|$)`));
  assert(match, `missing [${name}] in ${file}`);
  const fields = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const row = line.match(/^([^=]+)=(.*)$/);
    if (row) fields.set(row[1], row[2]);
  }
  return fields;
}

function roomOf(point) {
  if (point.x <= 3528) return 9;
  if (point.x >= 3575) return 10;
  if (point.z <= 9671) return 11;
  if (point.z >= 9718) return 12;
  const column = point.x >= 3529 && point.x <= 3540 ? 0
    : point.x >= 3546 && point.x <= 3557 ? 1
      : point.x >= 3563 && point.x <= 3574 ? 2 : -1;
  const row = point.z >= 9672 && point.z <= 9683 ? 0
    : point.z >= 9689 && point.z <= 9700 ? 1
      : point.z >= 9706 && point.z <= 9717 ? 2 : -1;
  return column < 0 || row < 0 ? -1 : row * 3 + column;
}

const u32 = value => value >>> 0;
const pointKey = point => `${point.level},${point.x},${point.z}`;
const chebyshev = (left, right) => Math.max(Math.abs(left.x - right.x), Math.abs(left.z - right.z));
const { options, regression, baselinePack } = parseTestOptions(process.argv);
const roots = resolveRoots(options);
process.chdir(roots.engineRoot);

await run(async () => {
  const runtime = await loadPackedRuntime(options);
  const enginePath = relative => pathToFileURL(path.join(runtime.engineRoot, relative)).href;
  const [{ default: VarSharedType }, { default: ServerTriggerType }, { default: Packet }, { PlayerLoading },
    { NpcStatMap }, { default: DbRowType }, { default: DbTableType }, { default: DbTableIndex },
    mapApi, route] = await Promise.all([
    import(enginePath('src/cache/config/VarSharedType.ts')),
    import(enginePath('src/engine/script/ServerTriggerType.ts')),
    import(enginePath('src/io/Packet.ts')),
    import(enginePath('src/engine/entity/PlayerLoading.ts')),
    import(enginePath('src/engine/entity/NpcStat.ts')),
    import(enginePath('src/cache/config/DbRowType.ts')),
    import(enginePath('src/cache/config/DbTableType.ts')),
    import(enginePath('src/cache/config/DbTableIndex.ts')),
    import(enginePath('src/engine/GameMap.ts')),
    import(enginePath('src/engine/routefinder/index.ts'))
  ]);

  if (baselinePack !== null) {
    assert(fs.existsSync(path.join(baselinePack, 'server/script.dat')), `missing baseline script.dat in ${baselinePack}`);
    for (const Type of [runtime.VarPlayerType, runtime.VarBitType, runtime.VarNpcType, runtime.LocType,
      runtime.NpcType, runtime.EnumType, DbRowType, DbTableType, runtime.InvType, runtime.ObjType,
      runtime.FontType, runtime.ParamType, runtime.SeqType, runtime.Component]) Type.load(baselinePack);
    DbTableIndex.init();
    assert(runtime.FontType.get(3), `baseline pack is missing FontType q8_full: ${baselinePack}`);
    assert(runtime.ScriptProvider.load(baselinePack) > 0, `baseline pack contains no compiled scripts: ${baselinePack}`);
    runtime.packDir = baselinePack;
  }

  VarSharedType.load(runtime.packDir);
  runtime.World.vars = new Int32Array(VarSharedType.count);
  runtime.World.currentTick = 100;
  const { World, Player, LocType, NpcType, VarPlayerType, VarBitType, VarNpcType, EnumType,
    InvType, ObjType, ScriptProvider, ScriptRunner, ScriptState, JavaRandom, EntityLifeCycle, NpcMode, CoordGrid,
    allocateIfAbsent } = runtime;
  const runner = createRunner(runtime, { prefix: 'barrows_chest', firstUid: 8100 });
  const { makePlayer: makeRunnerPlayer, procInt, procVoid, addNpc } = runner;
  const { unzipSync } = createRequire(path.join(runtime.engineRoot, 'package.json'))('fflate');
  const packedMaps = unzipSync(fs.readFileSync(path.join(runtime.packDir, '.cache/maps-server.zip')));
  assert(packedMaps.m55_151?.length && packedMaps.l55_151?.length, 'the selected pack contains the native Barrows mapsquare');
  const packedSquare = Object.fromEntries(['m', 'l', 'n', 'o'].map(kind => [kind, packedMaps[`${kind}55_151`] ?? new Uint8Array()]));
  World.gameMap.packed.set((55 << 8) | 151, packedSquare);
  World.gameMap.zonemap.beginInitialization();
  World.gameMap.loadPackedMapsquare(packedSquare, 55 << 6, 151 << 6);
  World.gameMap.zonemap.endInitialization();

  const map = readMapRows(runtime.contentRoot, 'm55_151.jm2');
  const constants = readConstants(runtime.contentRoot);
  const c = name => {
    assert(constants.has(name), `missing Barrows constant ^${name}`);
    return constants.get(name);
  };
  const ranges = {
    identity: [c('barrows_identity_start'), c('barrows_identity_end')],
    phase: [c('barrows_phase_start'), c('barrows_phase_end')],
    corner: [c('barrows_corner_start'), c('barrows_corner_end')],
    entrance: [c('barrows_entrance_start'), c('barrows_entrance_end')],
    family: [c('barrows_family_start'), c('barrows_family_end')],
    permutation: [c('barrows_permutation_start'), c('barrows_permutation_end')]
  };
  const varIds = Object.fromEntries(['barrows', 'barrows_kills', 'barrows_state', 'barrows_generation', 'barrows_countdowns'].map(name => {
    const id = VarPlayerType.getId(name);
    assert.notEqual(id, -1, `packed player var ${name} exists`);
    return [name, id];
  }));
  const chestVarp = varIds.barrows_kills;
  assert.equal(chestVarp, 453, 'the original chest transform uses varp 453');
  const openMask = 1 << 16;
  const parentTypeId = LocType.getId('barrows_stone_chest');
  const closedChildId = LocType.getId('barrows_stone_chest_closed');
  const openChildId = LocType.getId('barrows_stone_chest_open');
  assert.equal(parentTypeId, 10284, 'the loaded chest is original loc 10284');
  assert.equal(closedChildId, 6774, 'the closed visual is original child 6774');
  assert.equal(openChildId, 6775, 'the open visual is original child 6775');
  const chestAnchor = { level: 0, x: 3551, z: 9695 };
  const chestRows = map.locs.filter(row => row.id === parentTypeId && pointKey(row) === pointKey(chestAnchor));
  assert.equal(chestRows.length, 1, 'the original map places the chest once at its exact anchor');
  assert.deepEqual([chestRows[0].shape, chestRows[0].angle], [10, 0], 'the original chest anchor is shape 10, angle 0');
  const chest = World.getLoc(chestAnchor.x, chestAnchor.z, chestAnchor.level, parentTypeId);
  assert(chest, 'the original chest is a native World loc');
  assert.equal(chest.type, parentTypeId, 'the shared map loc retains its parent type');
  assert.deepEqual([chest.width, chest.length, chest.shape, chest.angle], [2, 2, 10, 0], 'the native parent has its original 2x2 footprint');

  const ownerVar = VarNpcType.getId('npc_barrows_owner');
  const npcGenerationVar = VarNpcType.getId('npc_barrows_generation');
  assert.notEqual(ownerVar, -1, 'packed NPC owner field exists');
  assert.notEqual(npcGenerationVar, -1, 'packed NPC generation field exists');
  const hpIndex = NpcStatMap.get('HITPOINTS');
  assert.notEqual(hpIndex, undefined, 'native NPC hitpoint index is available');
  const activePlayers = [];
  let nextSlot = 1;
  const loopKey = slot => 0x74000000n + BigInt(slot);
  const wirePlayer = player => {
    player.messages = [];
    player.packets = [];
    player.write = message => player.packets.push(message);
    player.messageGame = message => player.messages.push(message);
    player.wrappedMessageGame = message => player.messages.push(message);
    // Shared logout reads worn items and legitimately materializes this empty
    // native container. Start every fixture with the same logged-in inventory.
    assert(player.getInventory(InvType.getId('worn')), 'native worn inventory exists before lifecycle snapshots');
  };
  function registerPlayer(player, slot, uid) {
    player.slot = slot;
    player.pid = slot;
    player.uid = uid;
    player.isActive = true;
    World.players[slot] = player;
    World.playerLoop.add(loopKey(slot), player);
    if (!activePlayers.includes(player)) activePlayers.push(player);
    return player;
  }
  function makePlayer(label, position = { level: 0, x: 3551, z: 9694 }) {
    const serial = nextSlot++;
    const player = makeRunnerPlayer(label, position.level, position.x, position.z);
    player.slot = serial;
    player.pid = serial;
    player.uid = (Number(player.username37 & 0x1fffffn) << 11) | serial;
    player.isActive = true;
    wirePlayer(player);
    World.players[player.slot] = player;
    World.playerLoop.add(loopKey(player.slot), player);
    activePlayers.push(player);
    player.teleport(position.x, position.z, position.level);
    return player;
  }
  function unregisterPlayer(player) {
    if (World.players[player.slot] === player) delete World.players[player.slot];
    if (player.isActive) player.unlink();
    player.isActive = false;
  }
  function restorePlayer(source) {
    const restored = PlayerLoading.load(source.username, new Packet(source.save()), null);
    restored.slot = source.slot;
    restored.pid = source.pid;
    restored.uid = source.uid;
    wirePlayer(restored);
    registerPlayer(restored, source.slot, source.uid);
    return restored;
  }
  function movePlayer(player, point) {
    if (player.level !== point.level || player.x !== point.x || player.z !== point.z) {
      player.teleport(point.x, point.z, point.level);
    }
    assert.deepEqual([player.level, player.x, player.z], [point.level, point.x, point.z], 'native player reaches the selected tile');
  }
  const rangeMask = ([start, end]) => u32((2 ** (end - start + 1) - 1) << start);
  const setRange = (word, value, range) => {
    const mask = rangeMask(range);
    return u32((u32(word) & ~mask) | ((value << range[0]) & mask));
  };
  const getRange = (word, [start, end]) => (u32(word) >>> start) & (2 ** (end - start + 1) - 1);
  function setRun(player, {
    identity = 1,
    generation = 1,
    phase = c('barrows_phase_unlooted'),
    slain = 0,
    solved = true,
    open = false,
    position = { level: 0, x: 3551, z: 9694 }
  } = {}) {
    const client = u32(0x5a6b7c9d);
    let state = u32(0xa5c39e71);
    state = setRange(state, identity, ranges.identity);
    state = setRange(state, phase, ranges.phase);
    state = setRange(state, 2, ranges.corner);
    state = setRange(state, 1, ranges.entrance);
    state = setRange(state, 2, ranges.family);
    state = setRange(state, 5, ranges.permutation);
    state = u32(state & ~(1 << c('barrows_challenge_bit')));
    if (solved) state = u32(state | (1 << c('barrows_solved_bit')));
    else state = u32(state & ~(1 << c('barrows_solved_bit')));
    const kills = u32((0x6abec000 & ~(0x3f | openMask)) | (slain & 0x3f) | (open ? openMask : 0));
    player.setVar(varIds.barrows, client);
    player.setVar(varIds.barrows_state, state);
    player.setVar(varIds.barrows_generation, generation);
    player.setVar(varIds.barrows_kills, kills);
    player.setVar(varIds.barrows_countdowns, 0x76543210);
    movePlayer(player, position);
  }
  const varSnapshot = player => Array.from(player.vars, value => u32(value));
  function inventorySnapshot(player) {
    return [...player.invs.entries()].sort(([left], [right]) => left - right).map(([id, inventory]) => [
      id,
      inventory.capacity,
      Array.from({ length: inventory.capacity }, (_, slot) => {
        const item = inventory.get(slot);
        return item ? [item.id, item.count] : null;
      })
    ]);
  }
  const openFromVarp = player => (u32(player.getVar(chestVarp)) >>> 16) & 1;
  function assertOpenOnlyMutation(player, before, label) {
    const expected = [...before];
    expected[chestVarp] = u32(expected[chestVarp] | openMask);
    assert.deepEqual(varSnapshot(player), expected, `${label}: only varp 453 bit 16 changes`);
    assert.equal(openFromVarp(player), 1, `${label}: chest-open is exactly varp 453 bit 16`);
  }
  function assertNoPlayerMutation(player, varsBefore, inventoryBefore, label) {
    assert.deepEqual(varSnapshot(player), varsBefore, `${label}: no varp changes`);
    assert.deepEqual(inventorySnapshot(player), inventoryBefore, `${label}: no inventory or payment changes`);
  }
  function withoutScriptRandom(label, action) {
    const original = JavaRandom.nextDouble;
    let calls = 0;
    JavaRandom.nextDouble = function () {
      calls++;
      throw new Error(`${label}: unexpected packed-script random draw`);
    };
    try {
      const result = action();
      assert.equal(calls, 0, `${label}: packed script consumed no random draw`);
      return result;
    } finally {
      JavaRandom.nextDouble = original;
    }
  }
  function gate(player, name, generation, label) {
    const varsBefore = varSnapshot(player);
    const inventoryBefore = inventorySnapshot(player);
    const result = withoutScriptRandom(label, () => procInt(player, name, [generation]));
    assertNoPlayerMutation(player, varsBefore, inventoryBefore, label);
    return result;
  }
  function nativeLocTrigger(player, op, loc = chest) {
    player.target = loc;
    player.targetOp = ServerTriggerType[`OPLOC${op}`] - 7;
    return player.getOpTrigger();
  }
  function nativeOpen(player, label) {
    const trigger = nativeLocTrigger(player, 1);
    if (!trigger) {
      player.defaultOp();
      return { trigger: null, state: null };
    }
    const state = ScriptRunner.init(trigger, player, chest, []);
    player.executeScript(state, true);
    assert.equal(state.execution, ScriptState.FINISHED, `${label}: native OPLOC1 finishes synchronously`);
    assert.equal(player.delayed, false, `${label}: native OPLOC1 leaves no delay`);
    assert.equal(player.activeScript, null, `${label}: native OPLOC1 leaves no continuation`);
    return { trigger, state };
  }
  function runNativeSearch(player, label) {
    const before = varSnapshot(player);
    const inventoryBefore = inventorySnapshot(player);
    const saved = JavaRandom.nextDouble;
    let result;
    JavaRandom.nextDouble = () => 0.5;
    try { result = nativeOpen(player, label); }
    finally { JavaRandom.nextDouble = saved; }
    assert.equal(result.trigger?.name, '[oploc1,barrows_stone_chest_open]', `${label}: native dispatch selects the shown Search child`);
    assert.equal(result.state.activeLoc, chest, `${label}: Search keeps the original parent active loc`);
    const expected = [...before];
    expected[varIds.barrows_state] = u32(setRange(before[varIds.barrows_state], c('barrows_phase_paid'), ranges.phase)
      & ~rangeMask([c('barrows_solved_bit'), c('barrows_challenge_bit')]));
    expected[varIds.barrows_generation]++;
    assert.deepEqual(varSnapshot(player), expected, `${label}: Search pays once without changing layout or credit`);
    assert.notDeepEqual(inventorySnapshot(player), inventoryBefore, `${label}: native Search grants the real nonzero-potential reward`);
  }
  function assertClosedChildDispatch(player, result, label) {
    assert(result.trigger, `${label}: actual closed-child Open trigger is present`);
    assert.equal(result.trigger.name, '[oploc1,barrows_stone_chest_closed]', `${label}: native dispatch selects shown child 6774`);
    assert.equal(result.state.activeLoc, chest, `${label}: activeLoc remains the native parent map loc`);
    assert.equal(result.state.activeLoc.type, parentTypeId, `${label}: script receives parent loc type 10284`);
  }
  function displayedChestType(player) {
    const parent = LocType.get(parentTypeId);
    return LocType.get(parent.multiloc[player.getVarBit(parent.multivarbit)]);
  }
  function runNativeClose(player, label) {
    const displayed = displayedChestType(player);
    assert.equal(displayed.id, openChildId, `${label}: native Close targets the displayed open child`);
    assert.equal(displayed.op[1], 'Close', `${label}: original open-child operation text is retained`);
    player.messages.length = 0;
    assert.equal(nativeLocTrigger(player, 2), null, `${label}: Close has no Barrows handler`);
    player.defaultOp();
    assert.equal(player.messages.at(-1), 'Nothing interesting happens.', `${label}: native engine default refuses without payment`);
  }
  function activeNpcs() {
    return Array.from(World.npcs).filter(npc => npc.isActive);
  }
  function clearNpcs() {
    for (const npc of activeNpcs()) World.removeNpc(npc, -1);
  }
  const spawnDelta = before => activeNpcs().filter(npc => !before.has(npc.nid));
  function npcType(name) {
    const id = NpcType.getId(name);
    assert.notEqual(id, -1, `packed NPC type ${name} exists`);
    return id;
  }
  function addFixtureNpc(name, point, { ownerUid = null, generation = 0, hitpoints = 1 } = {}) {
    const record = addNpc(name, point.level, ownerUid, point.x, point.z);
    const npc = record.npc;
    if (ownerUid !== null) {
      npc.setVar(ownerVar, ownerUid);
      npc.setVar(npcGenerationVar, generation);
    }
    npc.levels[hpIndex] = hitpoints;
    return npc;
  }
  const overlap = (left, leftSize, right) => left.level === right.level
    && left.x < right.x + right.width && right.x < left.x + leftSize
    && left.z < right.z + right.length && right.z < left.z + leftSize;
  const tileWalkable = point => map.floorTiles.has(pointKey(point))
    && !mapApi.isMapBlocked(point.x, point.z, point.level)
    && route.isZoneAllocated(point.x, point.z, point.level);
  function footprintWalkable(point, size, expectedRoom = roomOf(point)) {
    if (expectedRoom < 0) return false;
    for (let dx = 0; dx < size; dx++) {
      for (let dz = 0; dz < size; dz++) {
        const tile = { level: point.level, x: point.x + dx, z: point.z + dz };
        if (roomOf(tile) !== expectedRoom || !tileWalkable(tile)) return false;
      }
    }
    return true;
  }
  function findCentralEnemies(count, origin) {
    const rat = NpcType.get(npcType('barrows_rat'));
    const chosen = [];
    for (let x = 3520; x < 3584 && chosen.length < count; x++) {
      for (let z = 9664; z < 9728 && chosen.length < count; z++) {
        const point = { level: 0, x, z };
        if (roomOf(point) !== 4 || chebyshev(point, origin) <= 2 || !footprintWalkable(point, rat.size, 4)) continue;
        if (chosen.some(previous => overlap(point, rat.size, { ...previous, width: rat.size, length: rat.size }))) continue;
        chosen.push(point);
      }
    }
    assert.equal(chosen.length, count, `native central room has ${count} walkable rat footprints outside the chest spawn ring`);
    return chosen;
  }
  function blockSpawnRegion(origin) {
    const changed = [];
    for (let x = origin.x - 2; x <= origin.x + 2; x++) {
      for (let z = origin.z - 2; z <= origin.z + 2; z++) {
        if (!route.isZoneAllocated(x, z, origin.level) || mapApi.isMapBlocked(x, z, origin.level)) continue;
        mapApi.changeLocCollision(10, 0, false, 1, 1, 0, x, z, origin.level, true);
        changed.push({ level: origin.level, x, z });
      }
    }
    assert(changed.length > 0, 'native collision fixture blocks open chest spawn candidates');
    return changed;
  }
  function restoreBlocks(points) {
    for (const point of [...points].reverse()) {
      mapApi.changeLocCollision(10, 0, false, 1, 1, 0, point.x, point.z, point.level, false);
    }
  }
  const brotherNames = ['ahrim', 'dharok', 'guthan', 'karil', 'torag', 'verac'];
  const controlTile = (() => {
    const maxSize = Math.max(...brotherNames.map(name => NpcType.get(npcType(`barrows_${name}`)).size));
    for (let x = 3529; x <= 3540; x++) {
      for (let z = 9672; z <= 9683; z++) {
        const point = { level: 0, x, z };
        if (roomOf(point) === 0 && chebyshev(point, { level: 0, x: 3551, z: 9694 }) > 2 + maxSize
          && footprintWalkable(point, maxSize, 0)) return point;
      }
    }
    assert.fail('native map has a remote room-zero footprint for the independent owner control');
  })();
  for (const point of [{ level: 3, x: 3555, z: 9698 }, { level: 0, x: 3200, z: 3200 }]) {
    allocateIfAbsent(point.x, point.z, point.level);
  }
  const main = makePlayer('main');
  const other = makePlayer('other', { level: 0, x: 3552, z: 9694 });
  setRun(main, { identity: 1, generation: 801, position: { level: 0, x: 3551, z: 9694 } });
  setRun(other, { identity: 1, generation: 801, position: { level: 0, x: 3552, z: 9694 } });
  clearNpcs();

  try {
    // This is intentionally the first S10 assertion: an actual native OPLOC1 on
    // the map parent must open varp 453 bit 16. A pre-S10 pack reaches this
    // observable failure even when no chest procedure is available to look up.
    const firstBefore = varSnapshot(main);
    const firstInventory = inventorySnapshot(main);
    main.packets.length = 0;
    const firstOpen = withoutScriptRandom('first native chest Open', () => nativeOpen(main, 'first native chest Open'));
    assert.equal(openFromVarp(main), 1, 'native public Open changes the real chest-open bit');
    if (regression) {
      console.log('PASS S10 public Open regression witness: native OPLOC1 sets the real chest bit');
      return;
    }

    assertClosedChildDispatch(main, firstOpen, 'first native Open');
    assertOpenOnlyMutation(main, firstBefore, 'first native Open');
    assert.deepEqual(inventorySnapshot(main), firstInventory, 'first native Open awards or consumes no item');
    assert.equal(LocType.get(chest.type).debugname, 'barrows_stone_chest', 'the shared loc remains its parent after one player opens it');
    assert.equal(World.getLoc(chestAnchor.x, chestAnchor.z, chestAnchor.level, parentTypeId), chest, 'the native world keeps the one shared parent loc');

    const openVarbitId = VarBitType.getId('barrows_chest_open');
    assert.notEqual(openVarbitId, -1, 'the packed player chest transform bit exists');
    const openVarbit = VarBitType.get(openVarbitId);
    assert.deepEqual([openVarbit.basevar, openVarbit.startbit, openVarbit.endbit], [chestVarp, 16, 16], 'the chest visual is varp 453 bit 16');
    const parentType = LocType.get(parentTypeId);
    const closedType = LocType.get(closedChildId);
    const openType = LocType.get(openChildId);
    assert.equal(parentType.multivarbit, openVarbitId, 'the actual parent transform reads the chest-open varbit');
    assert.deepEqual(parentType.multiloc.slice(0, 2), [closedChildId, openChildId], 'the original map loc selects closed and open children per player');
    assert.deepEqual([closedType.width, closedType.length, openType.width, openType.length], [2, 2, 2, 2], 'both visible children retain their original 2x2 footprint');
    assert.deepEqual([closedType.op[0], openType.op[0], openType.op[1]], ['Open', 'Search', 'Close'], 'the original child operations are Open, Search and Close');
    const closedSource = readLocBlock(runtime.contentRoot, 'barrows_stone_chest_closed');
    const openSource = readLocBlock(runtime.contentRoot, 'barrows_stone_chest_open');
    assert.deepEqual([closedSource.get('forceapproach'), closedSource.get('width'), closedSource.get('length'), closedSource.get('op1')],
      ['south', '2', '2', 'Open'], 'original closed child uses south approach and its 2x2 Open operation');
    assert.deepEqual([openSource.get('forceapproach'), openSource.get('width'), openSource.get('length'), openSource.get('op1'), openSource.get('op2')],
      ['south', '2', '2', 'Search', 'Close'], 'original open child uses south approach and its 2x2 Search/Close operations');
    assert.equal(closedType.forceapproach, openType.forceapproach, 'packed children retain the same native south-side approach mask');

    const identityEnumId = EnumType.getId('barrows_identity_brother');
    assert.notEqual(identityEnumId, -1, 'the original final-brother identity enum is packed');
    const identityEnum = EnumType.get(identityEnumId);
    assert.equal(identityEnum.values.size, 6, 'all six final brother identities are mapped');
    const brotherId = identity => {
      const id = identityEnum.values.get(identity);
      assert(Number.isInteger(id) && id >= 0, `identity ${identity} resolves through barrows_identity_brother`);
      return id;
    };
    for (const [index, name] of brotherNames.entries()) {
      const id = brotherId(index + 1);
      assert.equal(id, npcType(`barrows_${name}`), `${name} is the exact identity-enum final NPC`);
    }

    assert.equal(displayedChestType(main).id, openChildId, 'the opener alone sees the original open child');
    assert.equal(displayedChestType(other).id, closedChildId, 'another registered player still sees the original closed child');
    const otherClosedTrigger = nativeLocTrigger(other, 1);
    assert(otherClosedTrigger, 'the second real player resolves the closed chest operation');
    assert.equal(otherClosedTrigger.name, '[oploc1,barrows_stone_chest_closed]', 'another player dispatches to the unchanged closed child');

    const mainOwned = () => activeNpcs().filter(npc => npc.getVar(ownerVar) === main.uid);
    const firstActor = mainOwned().find(npc => npc.type === brotherId(1));
    assert(firstActor, 'native Open constructs its exact selected final brother');
    const assertForcedActor = (player, actor, identity, generation, label) => {
      assert(actor && actor.isActive, `${label}: exact owned actor is active`);
      assert.equal(actor.type, brotherId(identity), `${label}: actor is the exact enum-selected final identity`);
      assert.equal(actor.getVar(ownerVar), player.uid, `${label}: actor owns the valid registered UID`);
      assert.equal(actor.getVar(npcGenerationVar), generation, `${label}: actor captures the exact run generation`);
      assert.equal(actor.sayMessage, 'You dare steal from us!', `${label}: actor carries the CANDIDATE overhead line`);
      assert.equal(actor.target, player, `${label}: actor targets its owner, not a bystander`);
      assert.equal(actor.targetOp, NpcMode.OPPLAYER2, `${label}: actor starts native opplayer2 mode`);
      assert.equal(actor.level, 0, `${label}: final encounter stays in tunnels`);
      assert(chebyshev(actor, player) <= 2, `${label}: native map_findsquare stays within the legal 0..2 ring`);
      assert.equal(roomOf(actor), 4, `${label}: final brother remains in the central tunnel room`);
      assert(footprintWalkable({ level: actor.level, x: actor.x, z: actor.z }, NpcType.get(actor.type).size, 4), `${label}: complete native NPC footprint is walkable in-room`);
      assert.equal(actor.lifecycle, EntityLifeCycle.DESPAWN, `${label}: the summon uses native despawn lifecycle`);
      assert.equal(actor.lifecycleTick, c('barrows_chest_summon_lifetime'), `${label}: native lifetime is the configured 1000 ticks`);
      assert.equal(actor.timerInterval, c('barrows_owner_check_ticks'), `${label}: actor keeps the native owner timer`);
      const hints = player.packets.filter(packet => packet.constructor.name === 'HintArrow');
      assert(hints.some(packet => packet.type === 1 && packet.nid === actor.nid), `${label}: owner receives the native NPC hint`);
      return actor;
    };
    assert.equal(c('barrows_chest_summon_lifetime'), 1000, 'forced chest lifetime remains 1000 ticks');
    assert.equal(c('barrows_solved_bit'), 9, 'the real solved authorization is bit 9');
    assert.equal(c('barrows_door_spawn_min_radius'), 0, 'forced placement reuses the native zero minimum radius');
    assert.equal(c('barrows_door_spawn_radius'), 2, 'forced placement reuses the native two-tile maximum radius');
    assert.equal(c('barrows_door_room_cap'), 11, 'the ordinary D4 room cap remains eleven');
    assertForcedActor(main, firstActor, 1, 801, 'first forced final');
    assert.equal(mainOwned().length, 1, 'first Open creates exactly one owned encounter');
    assert.equal(gate(main, 'barrows_chest_authorized', 801, 'authorized before Search'), 1, 'shared chest context is authorized for an unlooted solved run');
    assert.equal(gate(main, 'barrows_chest_search_allowed', 801, 'Search gate after real Open'), 1, 'Search gate is true while the selected final is alive and B is zero');
    assert.equal(gate(main, 'barrows_chest_search_allowed', 800, 'stale Search generation'), 0, 'stale generation cannot use the Search gate');

    const repeatedVars = varSnapshot(main);
    const repeatedInventory = inventorySnapshot(main);
    const repeatedNids = new Set(activeNpcs().map(npc => npc.nid));
    withoutScriptRandom('repeated direct chest Open', () => procVoid(main, 'barrows_chest_open', [parentTypeId, CoordGrid.packCoord(0, 3551, 9695)]));
    assertNoPlayerMutation(main, repeatedVars, repeatedInventory, 'repeated direct chest Open');
    assert.deepEqual(spawnDelta(repeatedNids), [], 'repeated Open cannot duplicate the selected final actor');
    runNativeSearch(main, 'open-child Search');
    const paidVars = varSnapshot(main);
    const paidInventory = inventorySnapshot(main);
    runNativeClose(main, 'open-child Close');
    assertNoPlayerMutation(main, paidVars, paidInventory, 'open-child Close default');
    assert.equal(World.getLoc(chestAnchor.x, chestAnchor.z, chestAnchor.level, parentTypeId), chest, 'Search and Close do not globally replace the shared loc');

    const invId = InvType.getId('inv');
    const coinsId = ObjType.getId('coins');
    assert.notEqual(invId, -1, 'native player inventory config exists');
    assert.notEqual(coinsId, -1, 'native coins item config exists');
    assert.equal(main.invAdd(invId, coinsId, 37), 37, 'inventory marker is a real native stack');
    assert.equal(other.invAdd(invId, coinsId, 19), 19, 'second owner receives an independent native inventory marker');

    // A valid context authorizes Open before the visual bit is set, but the
    // public Search gate additionally requires a real open chest.
    clearNpcs();
    setRun(main, { identity: 1, generation: 900, solved: true });
    const gateBefore = varSnapshot(main);
    assert.equal(gate(main, 'barrows_chest_authorized', 900, 'closed chest authorization'), 1, 'shared authorization does not depend on the visual open bit');
    assert.equal(gate(main, 'barrows_chest_search_allowed', 900, 'closed chest Search gate'), 0, 'Search remains false until native Open sets its bit');
    assert.deepEqual(varSnapshot(main), gateBefore, 'both pre-open predicates preserve every player varp');

    const uncredited = [];
    for (let identity = 1; identity <= 6; identity++) {
      clearNpcs();
      const generation = 1000 + identity;
      const position = { level: 0, x: identity % 2 === 0 ? 3552 : 3551, z: 9694 };
      setRun(main, { identity, generation, slain: 0, solved: true, position });
      let foreign = null;
      if (identity === 1) {
        setRun(other, { identity, generation, solved: true, position: { level: 0, x: 3552, z: 9694 } });
        const handle = withoutScriptRandom('foreign same-generation owner spawn', () => procInt(other, 'barrows_actor_spawn', [
          brotherId(identity), CoordGrid.packCoord(controlTile.level, controlTile.x, controlTile.z), c('barrows_chest_summon_lifetime')
        ]));
        foreign = World.getNpcByUid(handle);
        assert(foreign && foreign.isActive, 'foreign owner has a real same-generation living brother in the tunnel area');
        assert.equal(foreign.getVar(ownerVar), other.uid, 'foreign control is tagged with the second registered UID');
        assert.equal(foreign.getVar(npcGenerationVar), generation, 'foreign control deliberately shares the opener generation');
      }
      assert.equal(gate(main, 'barrows_chest_authorized', generation, `identity ${identity} authorization before Open`), 1, `identity ${identity} is authorized before opening`);
      assert.equal(gate(main, 'barrows_chest_search_allowed', generation, `identity ${identity} Search before Open`), 0, `identity ${identity} cannot Search before real Open`);
      const beforeVars = varSnapshot(main);
      const beforeInventory = inventorySnapshot(main);
      const beforeNids = new Set(activeNpcs().map(npc => npc.nid));
      main.packets.length = 0;
      other.packets.length = 0;
      const opened = withoutScriptRandom(`identity ${identity} native Open`, () => nativeOpen(main, `identity ${identity} native Open`));
      assertClosedChildDispatch(main, opened, `identity ${identity} native Open`);
      assertOpenOnlyMutation(main, beforeVars, `identity ${identity} native Open`);
      assert.deepEqual(inventorySnapshot(main), beforeInventory, `identity ${identity} Open changes no inventory, potential, count or reward`);
      const spawned = spawnDelta(beforeNids);
      assert.equal(spawned.length, 1, `identity ${identity} has exactly one forced final actor`);
      const actor = spawned[0];
      assertForcedActor(main, actor, identity, generation, `identity ${identity} final`);
      assert.equal(gate(main, 'barrows_chest_search_allowed', generation, `identity ${identity} Search after Open`), 1, `identity ${identity} permits Search without final death or B=6`);
      if (foreign) {
        assert.equal(foreign.isActive, true, 'foreign same-generation brother remains a separate living actor');
        assert.equal(foreign.target, null, 'foreign owner control is not retargeted by the opener');
        assert(!other.packets.some(packet => packet.constructor.name === 'HintArrow' && packet.type === 1 && packet.nid === actor.nid), 'forced actor hint is not broadcast to the foreign owner');
      }
      uncredited.push({ identity, generation, actorNid: actor.nid });
      if (identity === 1) {
        assert.equal(main.getVar(varIds.barrows_state) >>> 0, beforeVars[varIds.barrows_state], 'Open preserves phase, layout, puzzle solution and challenge fields');
        assert.equal(main.getVar(varIds.barrows_kills) >>> 0, u32(beforeVars[varIds.barrows_kills] | openMask), 'Open preserves credit, potential and count apart from the original open bit');
      }
    }
    assert.deepEqual(uncredited.map(row => row.identity), [1, 2, 3, 4, 5, 6], 'all six final identities are forced in enum order, never randomly selected');

    for (let identity = 1; identity <= 6; identity++) {
      clearNpcs();
      const generation = 1100 + identity;
      setRun(main, { identity, generation, slain: 1 << (identity - 1), solved: true });
      const beforeVars = varSnapshot(main);
      const beforeInventory = inventorySnapshot(main);
      const beforeNids = new Set(activeNpcs().map(npc => npc.nid));
      const opened = withoutScriptRandom(`credited identity ${identity} Open`, () => nativeOpen(main, `credited identity ${identity} Open`));
      assertClosedChildDispatch(main, opened, `credited identity ${identity} Open`);
      assertOpenOnlyMutation(main, beforeVars, `credited identity ${identity} Open`);
      assert.deepEqual(inventorySnapshot(main), beforeInventory, `credited identity ${identity} Open has no item effect`);
      assert.deepEqual(spawnDelta(beforeNids), [], `credited final identity ${identity} is not summoned again`);
      assert.equal(gate(main, 'barrows_chest_search_allowed', generation, `credited identity ${identity} Search gate`), 1, `Search gate does not require an uncredited final brother`);
    }

    // Exhaust every B mask, not just the seven possible counts. Identity one
    // remains the exact final selection; only its own slain bit suppresses it.
    for (let mask = 0; mask < 64; mask++) {
      clearNpcs();
      const generation = 1200 + mask;
      setRun(main, { identity: 1, generation, slain: mask, solved: true });
      const beforeVars = varSnapshot(main);
      const beforeInventory = inventorySnapshot(main);
      const beforeNids = new Set(activeNpcs().map(npc => npc.nid));
      assert.equal(gate(main, 'barrows_chest_search_allowed', generation, `B mask ${mask} Search before Open`), 0, `B mask ${mask} still needs real Open`);
      const opened = withoutScriptRandom(`B mask ${mask} native Open`, () => nativeOpen(main, `B mask ${mask} native Open`));
      assertClosedChildDispatch(main, opened, `B mask ${mask} native Open`);
      assertOpenOnlyMutation(main, beforeVars, `B mask ${mask} native Open`);
      assert.deepEqual(inventorySnapshot(main), beforeInventory, `B mask ${mask} Open changes no inventory or payment state`);
      const spawned = spawnDelta(beforeNids);
      assert.equal(spawned.length, (mask & 1) === 0 ? 1 : 0, `B mask ${mask}: only identity one's credit suppresses its exact final`);
      if (spawned.length) assert.equal(spawned[0].type, brotherId(1), `B mask ${mask}: exact identity-one enum result`);
      assert.equal(gate(main, 'barrows_chest_search_allowed', generation, `B mask ${mask} Search after Open`), 1, `B mask ${mask}: Search does not require final death or all six credits`);
    }

    // A matching living owner/generation suppresses the forced actor on either
    // original encounter plane, while the chest still opens normally.
    for (let identity = 1; identity <= 6; identity++) {
      for (const level of [0, 3]) {
        clearNpcs();
        const generation = 1400 + identity * 10 + level;
        setRun(main, { identity, generation, solved: true });
        const residentPoint = { level, x: 3555, z: 9698 };
        if (level === 3) allocateIfAbsent(residentPoint.x, residentPoint.z, residentPoint.level);
        const resident = addFixtureNpc(`barrows_${brotherNames[identity - 1]}`, residentPoint, {
          ownerUid: main.uid, generation, hitpoints: 1
        });
        const beforeVars = varSnapshot(main);
        const beforeInventory = inventorySnapshot(main);
        const beforeNids = new Set(activeNpcs().map(npc => npc.nid));
        const opened = withoutScriptRandom(`identity ${identity} resident L${level} Open`, () => nativeOpen(main, `identity ${identity} resident L${level} Open`));
        assertClosedChildDispatch(main, opened, `identity ${identity} resident L${level} Open`);
        assertOpenOnlyMutation(main, beforeVars, `identity ${identity} resident L${level} Open`);
        assert.deepEqual(inventorySnapshot(main), beforeInventory, `resident L${level} Open changes no inventory`);
        assert.deepEqual(spawnDelta(beforeNids), [], `same owner, generation, selected living brother at L${level} suppresses duplication`);
        assert.equal(resident.isActive, true, `selected L${level} resident survives Open`);
        assert.equal(gate(main, 'barrows_chest_search_allowed', generation, `resident L${level} Search gate`), 1, `living selected final does not block future Search`);
      }
    }

    // Open can arrive after lethal damage but before the normal death/credit
    // queues. Keep that actual pending actor in the duplicate check on both planes.
    for (let identity = 1; identity <= 6; identity++) {
      for (const level of [0, 3]) {
        clearNpcs();
        const generation = 1470 + identity * 10 + level;
        setRun(main, { identity, generation, slain: 0, solved: true });
        const resident = addFixtureNpc(`barrows_${brotherNames[identity - 1]}`, { level, x: 3555, z: 9698 }, {
          ownerUid: main.uid, generation, hitpoints: 1
        });
        resident.heroPoints.addHero(main.hash64, 1);
        const damage = ScriptProvider.getByName('[proc,npc_default_damage]');
        assert(damage, 'pending-death witness uses the ordinary compiled damage procedure');
        const hit = ScriptRunner.init(damage, resident, null, [1]);
        resident.executeScript(hit);
        assert.equal(hit.execution, ScriptState.FINISHED, 'native lethal damage completes');
        assert.equal(resident.levels[hpIndex], 0, 'the selected brother has just taken lethal native damage');
        assert(Array.from(resident.queue.all()).some(request => request.queueId === ServerTriggerType.AI_QUEUE3),
          'the genuine native death trigger is pending');
        assert.equal(procInt(main, 'barrows_brother_slain', [identity]), 0, 'credit has not arrived before Open');
        const beforeVars = varSnapshot(main);
        const beforeInventory = inventorySnapshot(main);
        const beforeNids = new Set(activeNpcs().map(npc => npc.nid));
        const opened = withoutScriptRandom('pending-death Open', () => nativeOpen(main, 'pending-death Open'));
        assertClosedChildDispatch(main, opened, 'pending-death Open');
        assertOpenOnlyMutation(main, beforeVars, 'pending-death Open');
        assert.deepEqual(inventorySnapshot(main), beforeInventory, 'pending-death Open grants no item');
        assert.deepEqual(spawnDelta(beforeNids), [], `same-owner selected brother with death pending at L${level} suppresses duplication`);
        const creditTick = World.currentTick;
        let turns = 0;
        while ((resident.isActive || Array.from(main.queue.all()).length > 0) && turns < 12) {
          World.currentTick++;
          if (resident.isActive) resident.turn();
          main.processQueues();
          turns++;
        }
        assert(turns < 12, 'native death and player credit queues finish within their bound');
        assert.equal(resident.isActive, false, 'ordinary death removes the pending brother');
        assert.equal(procInt(main, 'barrows_brother_slain', [identity]), 1, 'the original pending death earns the selected credit');
        assert.equal(main.getVarBit(VarBitType.getId('barrows_killed_count')),
          Math.min(c('barrows_kill_count_max'), (beforeVars[chestVarp] >>> 17) + 1), 'the pending brother credits exactly one kill');
        assert.equal(openFromVarp(main), 1, 'credit preserves the open chest');
        console.log(`PASS S10 pending death: identity=${identity} level=${level} lethalTick=${creditTick} completedTurns=${turns}`);
      }
    }

    // Foreign UID, stale generation, wrong identity and outside-area actors
    // cannot suppress this owner's current final, living or with death pending.
    const negativeResidents = [
      { label: 'foreign owner, same generation', owner: 'other', generation: 'same', hitpoints: 1, level: 0, type: 'barrows_ahrim', point: { level: 0, x: 3555, z: 9698 } },
      { label: 'stale generation', owner: 'main', generation: 'stale', hitpoints: 1, level: 0, type: 'barrows_ahrim', point: { level: 0, x: 3555, z: 9698 } },
      { label: 'foreign pending death', owner: 'other', generation: 'same', hitpoints: 0, level: 0, type: 'barrows_ahrim', point: { level: 0, x: 3555, z: 9698 } },
      { label: 'stale pending death', owner: 'main', generation: 'stale', hitpoints: 0, level: 0, type: 'barrows_ahrim', point: { level: 0, x: 3555, z: 9698 } },
      { label: 'out of area', owner: 'main', generation: 'same', hitpoints: 1, level: 0, type: 'barrows_ahrim', point: { level: 0, x: 3200, z: 3200 } },
      { label: 'different brother', owner: 'main', generation: 'same', hitpoints: 1, level: 0, type: 'barrows_dharok', point: { level: 0, x: 3555, z: 9698 } }
    ];
    for (const [index, row] of negativeResidents.entries()) {
      clearNpcs();
      const generation = 1500 + index;
      setRun(main, { identity: 1, generation, solved: true });
      setRun(other, { identity: 1, generation, solved: true, position: { level: 0, x: 3552, z: 9694 } });
      const ownerUid = row.owner === 'other' ? other.uid : main.uid;
      const residentGeneration = row.generation === 'stale' ? generation - 1 : generation;
      const residentPoint = row.point;
      if (residentPoint.x === 3200) allocateIfAbsent(residentPoint.x, residentPoint.z, residentPoint.level);
      const resident = addFixtureNpc(row.type, residentPoint, {
        ownerUid, generation: residentGeneration, hitpoints: row.hitpoints
      });
      const beforeVars = varSnapshot(main);
      const beforeInventory = inventorySnapshot(main);
      const beforeNids = new Set(activeNpcs().map(npc => npc.nid));
      const opened = withoutScriptRandom(`${row.label} native Open`, () => nativeOpen(main, `${row.label} native Open`));
      assertClosedChildDispatch(main, opened, `${row.label} native Open`);
      assertOpenOnlyMutation(main, beforeVars, `${row.label} native Open`);
      assert.deepEqual(inventorySnapshot(main), beforeInventory, `${row.label} Open has no inventory effect`);
      const spawned = spawnDelta(beforeNids);
      assert.equal(spawned.length, 1, `${row.label} does not suppress the selected final encounter`);
      assert.equal(spawned[0].type, brotherId(1), `${row.label} still forces exact identity one`);
      assert.equal(resident.isActive, true, `${row.label} control remains distinct from the forced actor`);
    }

    // Eleven living central enemies exceed the D4 encounter cap, but never
    // block the mandatory selected final encounter or alter any player state.
    clearNpcs();
    setRun(main, { identity: 4, generation: 1600, solved: true });
    const centralEnemies = findCentralEnemies(11, main);
    const rats = centralEnemies.map(point => addFixtureNpc('barrows_rat', point, { hitpoints: 1 }));
    assert.equal(rats.filter(npc => npc.levels[hpIndex] > 0 && roomOf(npc) === 4).length, 11, 'eleven living enemies occupy the native central room');
    const capVars = varSnapshot(main);
    const capInventory = inventorySnapshot(main);
    const capNids = new Set(activeNpcs().map(npc => npc.nid));
    const capOpen = withoutScriptRandom('eleven-enemy chest Open', () => nativeOpen(main, 'eleven-enemy chest Open'));
    assertClosedChildDispatch(main, capOpen, 'eleven-enemy chest Open');
    assertOpenOnlyMutation(main, capVars, 'eleven-enemy chest Open');
    assert.deepEqual(inventorySnapshot(main), capInventory, 'eleven-enemy Open changes no inventory');
    const capSpawn = spawnDelta(capNids);
    assert.equal(capSpawn.length, 1, 'mandatory forced encounter bypasses the D4 cap of eleven');
    assertForcedActor(main, capSpawn[0], 4, 1600, 'eleven-enemy forced final');

    // With every native origin in the legal 0..2 placement ring blocked, Open
    // must leave the chest closed and retry successfully after collision clears.
    clearNpcs();
    setRun(main, { identity: 2, generation: 1700, solved: true });
    const blockedOrigins = blockSpawnRegion(main);
    try {
      const blockedVars = varSnapshot(main);
      const blockedInventory = inventorySnapshot(main);
      const blockedNids = new Set(activeNpcs().map(npc => npc.nid));
      const failedOpen = withoutScriptRandom('blocked native placement Open', () => nativeOpen(main, 'blocked native placement Open'));
      assertClosedChildDispatch(main, failedOpen, 'blocked native placement Open');
      assert.equal(openFromVarp(main), 0, 'native placement refusal leaves the closed chest retryable');
      assertNoPlayerMutation(main, blockedVars, blockedInventory, 'blocked native placement Open');
      assert.deepEqual(spawnDelta(blockedNids), [], 'failed native placement creates no owned actor');
    } finally {
      restoreBlocks(blockedOrigins);
    }
    const retryVars = varSnapshot(main);
    const retryInventory = inventorySnapshot(main);
    const retryNids = new Set(activeNpcs().map(npc => npc.nid));
    const retryOpen = withoutScriptRandom('restored native placement retry', () => nativeOpen(main, 'restored native placement retry'));
    assertClosedChildDispatch(main, retryOpen, 'restored native placement retry');
    assertOpenOnlyMutation(main, retryVars, 'restored native placement retry');
    assert.deepEqual(inventorySnapshot(main), retryInventory, 'placement retry changes no inventory');
    const retried = spawnDelta(retryNids);
    assert.equal(retried.length, 1, 'restoring legal native terrain permits the natural retry');
    assertForcedActor(main, retried[0], 2, 1700, 'placement retry final');

    // Bad loc/anchor arguments are rejected by the actual packed proc, while
    // invalid player context never changes the public chest or any other varp.
    clearNpcs();
    setRun(main, { identity: 3, generation: 1800, solved: true });
    for (const [label, parent, anchor] of [
      ['wrong parent', closedChildId, CoordGrid.packCoord(0, chestAnchor.x, chestAnchor.z)],
      ['wrong anchor', parentTypeId, CoordGrid.packCoord(0, chestAnchor.x, chestAnchor.z + 1)]
    ]) {
      const beforeVars = varSnapshot(main);
      const beforeInventory = inventorySnapshot(main);
      const beforeNids = new Set(activeNpcs().map(npc => npc.nid));
      withoutScriptRandom(`${label} packed guard`, () => procVoid(main, 'barrows_chest_open', [parent, anchor]));
      assertNoPlayerMutation(main, beforeVars, beforeInventory, `${label} packed guard`);
      assert.deepEqual(spawnDelta(beforeNids), [], `${label} packed guard creates no encounter`);
      assert.equal(openFromVarp(main), 0, `${label} packed guard leaves chest closed`);
    }

    const rejectedContexts = [
      { label: 'unsolved puzzle', run: { solved: false } },
      { label: 'idle phase', run: { phase: c('barrows_phase_idle') } },
      { label: 'paid phase', run: { phase: c('barrows_phase_paid') } },
      { label: 'invalid phase', run: { phase: 3 } },
      { label: 'zero generation', run: { generation: 0 } },
      { label: 'zero identity', run: { identity: 0 } },
      { label: 'negative generation', run: { generation: -1 } },
      { label: 'identity above six', run: { identity: 7 } },
      { label: 'wrong level', position: { level: 3, x: 3551, z: 9694 } },
      { label: 'wrong south-side x', position: { level: 0, x: 3550, z: 9694 } },
      { label: 'wrong east-side x', position: { level: 0, x: 3553, z: 9694 } },
      { label: 'too far from chest', position: { level: 0, x: 3551, z: 9693 } },
      { label: 'outside Barrows', position: { level: 0, x: 3200, z: 3200 } }
    ];
    let invalidGeneration = 1900;
    for (const scenario of rejectedContexts) {
      clearNpcs();
      const generation = scenario.run?.generation ?? invalidGeneration++;
      setRun(main, {
        identity: scenario.run?.identity ?? 1,
        generation,
        phase: scenario.run?.phase ?? c('barrows_phase_unlooted'),
        solved: scenario.run?.solved ?? true,
        position: scenario.position ?? { level: 0, x: 3551, z: 9694 }
      });
      const beforeVars = varSnapshot(main);
      const beforeInventory = inventorySnapshot(main);
      assert.equal(gate(main, 'barrows_chest_authorized', generation, `${scenario.label} authorization`), 0, `${scenario.label} is not authorized`);
      assert.equal(gate(main, 'barrows_chest_search_allowed', generation, `${scenario.label} Search gate`), 0, `${scenario.label} Search gate remains false`);
      const beforeNids = new Set(activeNpcs().map(npc => npc.nid));
      const rejected = withoutScriptRandom(`${scenario.label} native Open`, () => nativeOpen(main, `${scenario.label} native Open`));
      assertClosedChildDispatch(main, rejected, `${scenario.label} native Open`);
      assert.equal(openFromVarp(main), 0, `${scenario.label} leaves the chest closed`);
      assertNoPlayerMutation(main, beforeVars, beforeInventory, `${scenario.label} native Open`);
      assert.deepEqual(spawnDelta(beforeNids), [], `${scenario.label} creates no forced actor`);
    }

    // A valid open chest still rejects a stale generation and all out-of-context
    // gate calls. Open itself remains a per-player varp, not a World loc change.
    clearNpcs();
    setRun(main, { identity: 6, generation: 2000, solved: true });
    const beforeGateOpenVars = varSnapshot(main);
    const beforeGateOpenInv = inventorySnapshot(main);
    const validOpen = withoutScriptRandom('gate positive native Open', () => nativeOpen(main, 'gate positive native Open'));
    assertClosedChildDispatch(main, validOpen, 'gate positive native Open');
    assertOpenOnlyMutation(main, beforeGateOpenVars, 'gate positive native Open');
    assert.equal(gate(main, 'barrows_chest_search_allowed', 2000, 'valid final identity Search gate'), 1, 'valid identity six can use the open Search gate');
    assert.equal(gate(main, 'barrows_chest_search_allowed', 1999, 'stale open Search gate'), 0, 'stale generation remains rejected after Open');
    movePlayer(main, { level: 0, x: 3550, z: 9694 });
    assert.equal(gate(main, 'barrows_chest_authorized', 2000, 'wrong-side open authorization'), 0, 'open chest still requires the original south-side context');
    assert.equal(gate(main, 'barrows_chest_search_allowed', 2000, 'wrong-side open Search gate'), 0, 'open Search gate rejects the wrong side');
    movePlayer(main, { level: 0, x: 3551, z: 9694 });
    assert.equal(gate(main, 'barrows_chest_search_allowed', 2000, 'restored open Search gate'), 1, 'returning to the exact south-side context restores authorization');
    assert.equal(openFromVarp(other), 0, 'another player retains the closed varp transform');
    assert.equal(displayedChestType(other).id, closedChildId, 'another player retains child 6774 while the opener sees child 6775');
    assert.equal(World.getLoc(chestAnchor.x, chestAnchor.z, chestAnchor.level, parentTypeId), chest, 'no player operation globally changes the original map loc');
    assert.deepEqual(inventorySnapshot(main), beforeGateOpenInv, 'gate reads do not affect inventory');

    // Save/load the real native player record, then run the shared logout/login
    // triggers with both owners registered. The saved player keeps its open,
    // unlooted progress; logout removes only its owned final encounter.
    clearNpcs();
    setRun(main, { identity: 1, generation: 2100, slain: 0x12, solved: true });
    setRun(other, { identity: 1, generation: 2100, slain: 0x08, solved: true, position: { level: 0, x: 3552, z: 9694 } });
    const controlHandle = withoutScriptRandom('independent owner actor spawn', () => procInt(other, 'barrows_actor_spawn', [
      brotherId(1), CoordGrid.packCoord(controlTile.level, controlTile.x, controlTile.z), c('barrows_chest_summon_lifetime')
    ]));
    const otherActor = World.getNpcByUid(controlHandle);
    assert(otherActor && otherActor.isActive, 'second registered owner has a living same-generation control actor');
    assert.equal(otherActor.getVar(ownerVar), other.uid, 'control actor resolves the second native player UID');
    assert.equal(otherActor.getVar(npcGenerationVar), 2100, 'control actor uses the shared generation positive control');
    const lifecycleVars = varSnapshot(main);
    const lifecycleInventory = inventorySnapshot(main);
    const lifecycleNids = new Set(activeNpcs().map(npc => npc.nid));
    const lifecycleOpen = withoutScriptRandom('logout control native Open', () => nativeOpen(main, 'logout control native Open'));
    assertClosedChildDispatch(main, lifecycleOpen, 'logout control native Open');
    assertOpenOnlyMutation(main, lifecycleVars, 'logout control native Open');
    assert.deepEqual(inventorySnapshot(main), lifecycleInventory, 'logout control Open pays nothing');
    const ownedForLogout = activeNpcs().find(npc => !lifecycleNids.has(npc.nid) && npc.getVar(ownerVar) === main.uid);
    assertForcedActor(main, ownedForLogout, 1, 2100, 'logout owner final');
    const savedVars = varSnapshot(main);
    const savedInventory = inventorySnapshot(main);
    const savedCredit = u32(main.getVar(varIds.barrows_kills));
    const savedState = u32(main.getVar(varIds.barrows_state));
    const savedClient = u32(main.getVar(varIds.barrows));
    unregisterPlayer(main);
    const roundTrip = restorePlayer(main);
    assert.deepEqual(varSnapshot(roundTrip), savedVars, 'native Player.save/PlayerLoading.load preserves every varp and open progress');
    assert.deepEqual(inventorySnapshot(roundTrip), savedInventory, 'native save/load preserves inventory without payment');
    assert.equal(openFromVarp(roundTrip), 1, 'native save/load retains the open visual');
    assert.equal(displayedChestType(roundTrip).id, openChildId, 'native save/load still displays original open child 6775');
    assert.equal(getRange(roundTrip.getVar(varIds.barrows_state), ranges.phase), c('barrows_phase_unlooted'), 'native save/load retains unlooted phase');
    assert.equal((u32(roundTrip.getVar(varIds.barrows_state)) >>> c('barrows_solved_bit')) & 1, 1, 'native save/load retains solved puzzle authorization');
    assert.equal(u32(roundTrip.getVar(varIds.barrows_kills)), savedCredit, 'native save/load retains partial B and potential/count values');
    assert.equal(u32(roundTrip.getVar(varIds.barrows_state)), savedState, 'native save/load retains the complete puzzle/layout word');
    assert.equal(u32(roundTrip.getVar(varIds.barrows)), savedClient, 'native save/load retains the full client layout word');

    const runLifecycleTrigger = (player, name) => {
      const triggerType = name === 'login' ? ServerTriggerType.LOGIN : ServerTriggerType.LOGOUT;
      const triggerName = `[${name},_]`;
      const script = ScriptProvider.getByTriggerSpecific(triggerType, -1, -1);
      assert(script, `compiled shared ${triggerName} trigger is present`);
      assert.equal(script.name, triggerName, `${triggerName} resolves through native shared trigger lookup`);
      const state = ScriptRunner.init(script, player);
      const execution = player.runScript(state, true);
      assert.equal(execution, ScriptState.FINISHED, `${triggerName} completes through the real ScriptRunner`);
      assert.equal(state.execution, ScriptState.FINISHED, `${triggerName} has no suspended continuation`);
      assert.equal(player.delayed, false, `${triggerName} leaves no player delay`);
      assert.equal(player.activeScript, null, `${triggerName} leaves no active script`);
      assert.equal(player.protect, false, `${triggerName} releases protected access`);
    };
    runLifecycleTrigger(roundTrip, 'logout');
    assert.equal(ownedForLogout.isActive, false, 'real shared logout removes only the relogged owner actor');
    assert.equal(otherActor.isActive, true, "real shared logout preserves the other owner's living actor");
    assert.equal(u32(roundTrip.getVar(varIds.barrows_kills)), savedCredit, 'real shared logout grants no kill credit or payment');
    assert.equal(openFromVarp(roundTrip), 1, 'real shared logout preserves the open chest bit');
    assert.equal(getRange(roundTrip.getVar(varIds.barrows_state), ranges.phase), c('barrows_phase_unlooted'), 'real shared logout preserves unlooted phase');
    assert.deepEqual(inventorySnapshot(roundTrip), savedInventory, 'real shared logout preserves native inventory');
    const afterLogoutVars = varSnapshot(roundTrip);
    unregisterPlayer(roundTrip);

    // Shared login also initializes unrelated appearance, music and option
    // varps. Measure those real root-trigger effects on an independent native
    // account with identical general state, location and inventory but no run.
    // Keep the comparison over every varp; only the five Barrows words must
    // remain exactly as saved rather than acquire the inert login's defaults.
    const inertLogin = makePlayer('inert_login', { level: roundTrip.level, x: roundTrip.x, z: roundTrip.z });
    inertLogin.vars.set(roundTrip.vars);
    const barrowsVarIds = new Set(Object.values(varIds));
    for (const id of barrowsVarIds) inertLogin.setVar(id, 0);
    for (const [id, inventory] of roundTrip.invs) {
      assert(inertLogin.getInventory(id), `native login control inventory ${id} exists`);
      for (let slot = 0; slot < inventory.capacity; slot++) {
        const item = inventory.get(slot);
        if (item) inertLogin.invSet(id, item.id, item.count, slot);
      }
    }
    const inertVarsBefore = varSnapshot(inertLogin);
    const inertInventoryBefore = inventorySnapshot(inertLogin);
    runLifecycleTrigger(inertLogin, 'login');
    const inertVarsAfter = varSnapshot(inertLogin);
    for (const id of barrowsVarIds) {
      assert.equal(inertVarsAfter[id], inertVarsBefore[id], `native no-run login control preserves Barrows word ${id}`);
    }
    assert.deepEqual(inventorySnapshot(inertLogin), inertInventoryBefore, 'native no-run login control grants no item');
    const expectedLoginVars = inertVarsAfter.map((value, id) => barrowsVarIds.has(id) ? afterLogoutVars[id] : value);

    const loggedIn = restorePlayer(roundTrip);
    runLifecycleTrigger(loggedIn, 'login');
    assert.deepEqual(varSnapshot(loggedIn), expectedLoginVars, 'real shared login preserves every Barrows word and matches independent native general-login effects');
    assert.equal(openFromVarp(loggedIn), 1, 'real shared login retains the open chest visual');
    assert.equal(displayedChestType(loggedIn).id, openChildId, 'real shared login resolves original open child 6775');
    assert.equal(u32(loggedIn.getVar(varIds.barrows_kills)), savedCredit, 'real shared login preserves credit without payment');
    assert.equal(getRange(loggedIn.getVar(varIds.barrows_state), ranges.phase), c('barrows_phase_unlooted'), 'real shared login preserves the unlooted phase');
    assert.equal((u32(loggedIn.getVar(varIds.barrows_state)) >>> c('barrows_solved_bit')) & 1, 1, 'real shared login preserves the solved puzzle bit');
    assert.equal(otherActor.isActive, true, "other owner's live control survives real logout and login");
    const finalVars = varSnapshot(loggedIn);
    const finalInventory = inventorySnapshot(loggedIn);
    const postLoginNids = new Set(activeNpcs().map(npc => npc.nid));
    withoutScriptRandom('already-open post-login repeat', () => procVoid(loggedIn, 'barrows_chest_open', [
      parentTypeId, CoordGrid.packCoord(0, chestAnchor.x, chestAnchor.z)
    ]));
    assert.deepEqual(spawnDelta(postLoginNids), [], 'already-open post-login repeat cannot replace the cleaned-up final');
    assertNoPlayerMutation(loggedIn, finalVars, finalInventory, 'already-open post-login repeat');
    runNativeSearch(loggedIn, 'post-login native Search');
    const postSearchVars = varSnapshot(loggedIn);
    const postSearchInventory = inventorySnapshot(loggedIn);
    withoutScriptRandom('post-login repeat Search', () => nativeOpen(loggedIn, 'post-login repeat Search'));
    assertNoPlayerMutation(loggedIn, postSearchVars, postSearchInventory, 'post-login repeat Search');
    runNativeClose(loggedIn, 'post-login native Close');
    assertNoPlayerMutation(loggedIn, postSearchVars, postSearchInventory, 'post-login native Close');
    assert.equal(openFromVarp(loggedIn), 1, 'repeat native Search and Close do not close the chest');
    assert.equal(u32(loggedIn.getVar(varIds.barrows_kills)), savedCredit, 'paid native Search freezes credit');
    assert.equal(World.getLoc(chestAnchor.x, chestAnchor.z, chestAnchor.level, parentTypeId), chest, 'save/load/login and native Search leave the shared World loc unchanged');

    console.log('PASS S10 packed chest Open: native child dispatch, per-player visual, exact six identities, owner/generation and hint');
    console.log('PASS S10 packed chest gates: all 64 slain masks, credited/uncredited final, invalid context and no state/RNG mutation');
    console.log('PASS S10 forced placement: both-level duplicate suppression, negative residents, 11-enemy cap bypass and retry');
    console.log('PASS S10/S12 boundary: Open never rewards, native save/load and shared logout/login preserve authorization; Search pays once and Close stays a refusal');
  } finally {
    clearNpcs();
    for (const player of activePlayers) unregisterPlayer(player);
  }
});
