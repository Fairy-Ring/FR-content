#!/usr/bin/env node
/**
 * Run from the sibling engine after its full content build:
 * node --import tsx ../content/tests/mage-arena-levers/test_mage_arena_levers.mjs
 *
 * Loads the packed runtime and full map, then exercises the native Mage Arena
 * levers without starting a server or constructing either lever.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const packDir = path.join(engine, 'data/pack');
assert.ok(existsSync(path.join(packDir, 'server/script.dat')), 'build the sibling engine first');
process.chdir(engine);
const load = async relative => (await import(pathToFileURL(path.join(engine, 'src', relative)).href)).default;

// World is deliberately the first engine import: offline config/map loading may
// start worker threads, which this process terminates after fixture cleanup.
const World = await load('engine/World.ts');
let exitCode = 1;
const fixturePlayers = new Set();
const fixtureNpcs = new Set();
let baselineNpcObjects = new Set();
let leverRowsForCleanup = [];
let mapReady = false;

try {
  const Player = await load('engine/entity/Player.ts');
  const Npc = await load('engine/entity/Npc.ts');
  const ScriptProvider = await load('engine/script/ScriptProvider.ts');
  const ScriptRunner = await load('engine/script/ScriptRunner.ts');
  const ScriptState = await load('engine/script/ScriptState.ts');
  const ServerTriggerType = await load('engine/script/ServerTriggerType.ts');
  const ResumePauseButtonHandler = await load('network/game/client/handler/ResumePauseButtonHandler.ts');
  const ResumePauseButton = await load('network/game/client/model/ResumePauseButton.ts');
  const MessageGame = await load('network/game/server/model/MessageGame.ts');
  const IfSetText = await load('network/game/server/model/IfSetText.ts');
  const { EntityLifeCycle } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/EntityLifeCycle.ts')).href);
  const { BlockWalk } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/BlockWalk.ts')).href);
  const map = await import(pathToFileURL(path.join(engine, 'src/engine/GameMap.ts')).href);
  const { CollisionType } = await import(pathToFileURL(path.join(engine, 'src/engine/routefinder/index.ts')).href);
  const { PlayerStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
  const { NpcStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/NpcStat.ts')).href);

  const types = {};
  for (const name of [
    'VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType',
    'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType',
    'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType'
  ]) {
    types[name] = await load(`cache/config/${name}.ts`);
    types[name].load(packDir);
  }
  (await load('cache/config/DbTableIndex.ts')).init();
  assert.ok(ScriptProvider.load(packDir) > 0, 'a complete packed world is required');
  World.currentTick = 100;
  World.gameMap.init();
  mapReady = true;
  assert.ok(World.gameMap.getTotalZones() > 0, 'the packed map initialized');
  assert.ok(World.gameMap.getTotalLocs() > 0, 'the packed map contains native locations');
  baselineNpcObjects = new Set([...World.npcs].filter(Boolean));

  const requireId = (type, name, label = type.name ?? 'config') => {
    const id = type.getId(name);
    assert.ok(Number.isInteger(id) && id >= 0, `packed ${label} is named ${name}`);
    return id;
  };
  const tileKey = (level, x, z) => `${level},${x},${z}`;
  const tileOf = entity => [entity.level, entity.x, entity.z];
  const constantPath = path.join(content, 'scripts/areas/area_mage_arena/configs/mage_arena.constant');
  const constantSource = readFileSync(constantPath, 'utf8');
  const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function integerConstant(name) {
    const match = new RegExp(`^\\^${escapeRegExp(name)}\\s*=\\s*(-?\\d+)\\s*$`, 'm').exec(constantSource);
    assert.ok(match, `Mage Arena config defines ${name}`);
    return Number(match[1]);
  }

  function coordConstant(name) {
    const match = new RegExp(`^\\^${escapeRegExp(name)}\\s*=\\s*([0-3]_\\d+_\\d+_\\d+_\\d+)\\s*$`, 'm').exec(constantSource);
    assert.ok(match, `Mage Arena config defines ${name}`);
    const [level, mapX, mapZ, localX, localZ] = match[1].split('_').map(Number);
    assert.ok(localX >= 0 && localX < 64 && localZ >= 0 && localZ < 64, `${name} has valid mapsquare-local coordinates`);
    return [level, mapX * 64 + localX, mapZ * 64 + localZ];
  }

  function readNameTable(kind) {
    const source = readFileSync(path.join(content, 'pack', `${kind}.pack`), 'utf8').trim();
    assert.ok(source, `generated ${kind}.pack is present`);
    return new Map(source.split(/\r?\n/).map(line => {
      const separator = line.indexOf('=');
      assert.ok(separator > 0, `invalid generated ${kind}.pack row: ${line}`);
      const id = Number(line.slice(0, separator));
      assert.ok(Number.isInteger(id), `invalid generated ${kind}.pack id: ${line}`);
      return [id, line.slice(separator + 1)];
    }));
  }

  const locNames = readNameTable('loc');
  const mapRoot = path.join(content, 'maps');
  const mapFiles = readdirSync(mapRoot).filter(file => /^m\d+_\d+\.jm2$/.test(file)).sort();
  assert.ok(mapFiles.length > 0, 'the complete source map set is present');
  const floorTiles = new Set();
  const nativeLocs = new Map([
    ['magearena_lever_in', []],
    ['magearena_lever_out', []]
  ]);

  for (const file of mapFiles) {
    const match = /^m(\d+)_(\d+)\.jm2$/.exec(file);
    assert.ok(match, `valid mapsquare name ${file}`);
    const mapX = Number(match[1]);
    const mapZ = Number(match[2]);
    const groundFlags = new Map();
    let section = '';
    for (const line of readFileSync(path.join(mapRoot, file), 'utf8').split(/\r?\n/)) {
      if (line.startsWith('====')) {
        section = line.slice(4).trim().split(/\s+/)[0];
        continue;
      }
      const row = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
      if (!row) continue;
      const level = Number(row[1]);
      const localX = Number(row[2]);
      const localZ = Number(row[3]);
      const x = mapX * 64 + localX;
      const z = mapZ * 64 + localZ;
      const values = row[4];
      if (section === 'MAP') {
        const flags = /(?:^| )f(\d+)(?: |$)/.exec(values);
        groundFlags.set(`${level},${localX},${localZ}`, flags ? Number(flags[1]) : 0);
        if (/(?:^| )(?:u\d+|o-?\d+)(?:[; ]|$)/.test(values)) {
          floorTiles.add(tileKey(level, x, z));
        }
        continue;
      }
      if (section !== 'LOC') continue;
      const fields = values.trim().split(/\s+/).map(Number);
      const id = fields[0];
      if (!Number.isInteger(id)) continue;
      const name = locNames.get(id);
      if (!nativeLocs.has(name)) continue;
      const bridged = ((groundFlags.get(`1,${localX},${localZ}`) ?? 0) & 2) !== 0;
      const actualLevel = bridged ? level - 1 : level;
      if (actualLevel < 0) continue;
      nativeLocs.get(name).push({
        name, id, level: actualLevel, x, z, localX, localZ, mapX, mapZ,
        shape: fields[1] ?? 10, angle: fields[2] ?? 0,
        coord: `${actualLevel}_${mapX}_${mapZ}_${localX}_${localZ}`
      });
    }
  }

  function walkable(tile, label) {
    const [level, x, z] = tile;
    assert.ok(floorTiles.has(tileKey(level, x, z)), `${label}: destination has a packed map floor`);
    assert.equal(map.isMapBlocked(x, z, level), false, `${label}: loaded engine collision leaves the tile walkable`);
  }

  function nativeLoc(name) {
    const rows = nativeLocs.get(name);
    assert.ok(rows, `native source map parser tracks ${name}`);
    assert.equal(rows.length, 1, `${name} has one native source-map placement`);
    const row = rows[0];
    const id = requireId(types.LocType, name, 'loc type');
    assert.equal(row.id, id, `${name} map placement resolves through packed loc names and types`);
    const type = types.LocType.get(id);
    assert.ok(type.op?.[0] && type.op[0] !== 'hidden', `${name} exposes its first native operation`);
    const loc = World.getLoc(row.x, row.z, row.level, id);
    assert.ok(loc, `${name} is loaded at native ${row.coord}`);
    assert.equal(loc.type, id, `${name} is the loaded packed map location, not a constructed fixture`);
    assert.equal(loc.shape, row.shape, `${name} loaded shape matches its source placement`);
    assert.equal(loc.angle, row.angle, `${name} loaded angle matches its source placement`);
    return { row, id, type, loc };
  }

  function reachedLoc(tile, info) {
    const [level, x, z] = tile;
    const { row, type } = info;
    return level === row.level && map.reachedLoc(
      level, x, z, row.x, row.z, type.width, type.length, 1,
      row.angle, row.shape, type.forceapproach
    );
  }

  function collisionComponent(start, radius = 63) {
    const pending = [start];
    const visited = new Set([tileKey(...start)]);
    for (let index = 0; index < pending.length; index++) {
      const [level, x, z] = pending[index];
      for (const [dx, dz] of [[-1, 0], [0, -1], [1, 0], [0, 1]]) {
        const nextX = x + dx;
        const nextZ = z + dz;
        if (Math.max(Math.abs(nextX - start[1]), Math.abs(nextZ - start[2])) > radius) continue;
        const key = tileKey(level, nextX, nextZ);
        if (visited.has(key) || !floorTiles.has(key) || map.isMapBlocked(nextX, nextZ, level)) continue;
        if (!map.canTravel(level, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
        visited.add(key);
        pending.push([level, nextX, nextZ]);
      }
    }
    return visited;
  }

  const arenaStart = coordConstant('mage_arena_start_coord');
  const incoming = coordConstant('mage_arena_lever_in_coord');
  const outgoing = coordConstant('mage_arena_lever_out_coord');
  const entrance = nativeLoc('magearena_lever_in');
  const exit = nativeLoc('magearena_lever_out');
  leverRowsForCleanup = [entrance.row, exit.row];
  const arenaRegion = collisionComponent(arenaStart);
  walkable(arenaStart, 'Mage Arena start constant');
  walkable(incoming, 'Mage Arena inward-arrival constant');
  walkable(outgoing, 'Mage Arena outward-arrival constant');
  assert.equal(incoming[0], arenaStart[0], 'inward arrival shares the arena start plane');
  assert.equal(outgoing[0], arenaStart[0], 'outward arrival shares the arena start plane');
  assert.notDeepEqual(incoming, outgoing, 'inward and outward destinations are distinct');
  assert.ok(arenaRegion.has(tileKey(...incoming)), 'inward arrival is in the collision-flood component of mage_arena_start_coord');
  assert.equal(arenaRegion.has(tileKey(...outgoing)), false, 'outward arrival is outside that component; the destinations are not swapped');
  assert.ok(reachedLoc(incoming, exit), 'the exit lever is operable from the inward arrival');
  assert.ok(reachedLoc(outgoing, entrance), 'the entrance lever is operable from the outward arrival');

  // The exit is outside the arena, not outside its web-closed entrance room.
  const exitRoom = collisionComponent(outgoing);
  assert.equal(exitRoom.size, 7, 'the exit landing has the seven-tile closed walking component of the original map');
  const webId = requireId(types.LocType, 'bigweb_slashable', 'loc type');
  const borderingWebs = new Map();
  for (const key of exitRoom) {
    const [level, x, z] = key.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const web = World.getLoc(x + dx, z + dz, level, webId);
      if (web) borderingWebs.set(`${web.x},${web.z}`, web);
    }
  }
  assert.deepEqual([...borderingWebs.keys()].sort(), ['3105,3958', '3106,3958'], 'two native webs close the lever-room doorway');
  for (const [x, z] of [[3095, 3957], [3093, 3957]]) {
    assert.ok(World.getLoc(x, z, 0, webId), `the further cellar-approach web exists at ${x},${z}`);
  }
  const cellarId = requireId(types.LocType, 'magearena_lever_to_cellar', 'loc type');
  const cellar = World.getLoc(3090, 3956, 0, cellarId);
  assert.ok(cellar, 'the original cellar lever is loaded');
  const cellarType = types.LocType.get(cellarId);
  assert.equal([...exitRoom].some(key => {
    const [level, x, z] = key.split(',').map(Number);
    return map.reachedLoc(level, x, z, cellar.x, cellar.z, cellarType.width, cellarType.length,
      1, cellar.angle, cellar.shape, cellarType.forceapproach);
  }), false, 'the closed exit room cannot operate the cellar lever');
  console.log('PASS packed web-room limit: seven closed tiles, two doorway webs, two further cellar-approach webs');

  const stageConstants = [
    'mage_arena_started', 'mage_arena_ogre', 'mage_arena_arachnid', 'mage_arena_ethereal',
    'mage_arena_demon', 'mage_arena_complete', 'mage_arena_prayed_at_statue', 'mage_arena_staff_given'
  ].map(integerConstant);
  const stages = [...new Set([0, ...stageConstants])].sort((a, b) => a - b);
  assert.deepEqual(stages, [0, 1, 2, 3, 4, 5, 6, 7, 8], 'the fixture covers every configured Mage Arena state');

  const packetLog = new WeakMap();
  let playerSerial = 0;
  const invId = requireId(types.InvType, 'inv', 'inventory type');
  const wornId = requireId(types.InvType, 'worn', 'inventory type');
  const gear = ['bronze_sword', 'bronze_platebody'].map(name => {
    const id = requireId(types.ObjType, name, 'item');
    const type = types.ObjType.get(id);
    assert.ok(type.wearpos >= 0, `${name} has a worn slot`);
    return { name, id, slot: type.wearpos };
  });
  const stageVarp = requireId(types.VarPlayerType, 'magearena', 'varp');
  const varNpcLastCombat = requireId(types.VarNpcType, 'npc_lastcombat', 'NPC varp');
  const pauseHandler = new ResumePauseButtonHandler();
  const multi2 = requireId(types.Component, 'multi2', 'component');

  function playerAt(tile) {
    const slot = ++playerSerial;
    assert.equal(World.players[slot], undefined, `offline player slot ${slot} is unused`);
    const player = new Player(`magearena_lever_fixture_${slot}`, BigInt(slot), BigInt(slot));
    player.slot = slot;
    player.pid = slot;
    player.uid = slot;
    player.vars.fill(0);
    player.baseLevels.fill(1);
    player.levels.fill(1);
    [player.level, player.x, player.z] = tile;
    player.buildArea.originX = Math.floor(player.x / 8) * 8;
    player.buildArea.originZ = Math.floor(player.z / 8) * 8;
    const packets = [];
    packetLog.set(player, packets);
    // Capture transport only; Player dispatch, ScriptRunner, packets and map collision stay production code.
    player.write = message => packets.push(message);
    World.players[slot] = player;
    World.playerLoop.add(player.hash64, player);
    fixturePlayers.add(player);
    for (const item of gear) player.invSet(wornId, item.id, 1, item.slot);
    assert.equal(player.invGetSlot(wornId, gear[0].slot)?.id, gear[0].id, 'the low-level fixture wears a weapon');
    assert.equal(player.invGetSlot(wornId, gear[1].slot)?.id, gear[1].id, 'the low-level fixture wears armour');
    packets.length = 0;
    return player;
  }

  function clearPlayer(player) {
    player.clearPendingAction();
    player.activeScript = null;
    player.delayed = false;
    player.protect = false;
    player.target = null;
    player.unlink();
    if (World.players[player.slot] === player) delete World.players[player.slot];
    fixturePlayers.delete(player);
  }

  function resumeScript(player, state, allowDialogue = false) {
    let delays = 0;
    let pauses = 0;
    for (let step = 0; state.execution !== ScriptState.FINISHED && step < 128; step++) {
      assert.notEqual(state.execution, ScriptState.ABORTED, `${state.script?.name ?? 'script'} does not abort`);
      if (state.execution === ScriptState.SUSPENDED) {
        delays++;
        World.currentTick = Math.max(World.currentTick + 1, player.delayedUntil);
        player.delayed = false;
        player.executeScript(state, true, true);
      } else if (state.execution === ScriptState.PAUSEBUTTON && allowDialogue) {
        assert.notEqual(player.modalChat, multi2, 'the selected Mage Arena path does not require a choice');
        pauses++;
        assert.ok(pauseHandler.handle(new ResumePauseButton(), player), 'production Continue handler resumes dialogue');
      } else {
        assert.fail(`unexpected ${state.execution} boundary in ${state.script?.name ?? 'script'}`);
      }
    }
    assert.equal(state.execution, ScriptState.FINISHED, `${state.script?.name ?? 'script'} finishes within 128 offline steps`);
    assert.equal(player.delayed, false, 'all player delays have settled');
    return { delays, pauses };
  }

  function settleLever(info) {
    const zone = World.gameMap.getZone(info.row.x, info.row.z, info.row.level);
    const locs = [...zone.getAllLocsUnsafe()].filter(loc =>
      loc.x === info.row.x && loc.z === info.row.z && loc.level === info.row.level
    );
    for (const loc of locs) {
      for (let steps = 0; loc.lifecycleTick > 0 && steps < 128; steps++) loc.turn();
      assert.equal(loc.lifecycleTick, -1, `${info.row.name} native lifecycle settles to its inactive-timer sentinel`);
    }
  }

  function runLever(player, info, destination, label) {
    const start = tileOf(player);
    walkable(start, `${label} start`);
    assert.ok(player.isInWilderness(), `${label} action starts at the actual Mage Arena Wilderness location`);
    const loc = World.getLoc(info.row.x, info.row.z, info.row.level, info.id);
    assert.ok(loc, `${label} resolves the current native lever after lifecycle settlement`);
    assert.ok(player.inOperableDistance(loc), `${label} arrival can directly operate the native lever`);
    assert.ok(reachedLoc(start, info), `${label} arrival passes the native loc reach predicate`);

    player.target = loc;
    player.targetOp = ServerTriggerType.OPLOC1 - 7;
    const script = player.getOpTrigger();
    assert.ok(script, `${label} native Player dispatch resolves an operation handler`);
    assert.equal(script.name, `[oploc1,${info.row.name}]`, `${label} resolves the exact packed native trigger`);
    const stageBefore = player.getVar(stageVarp);
    const packets = packetLog.get(player);
    packets.length = 0;
    const state = ScriptRunner.init(script, player, loc);
    player.executeScript(state, true);
    assert.notEqual(state.execution, ScriptState.ABORTED, `${label} production script runs`);
    const { delays } = resumeScript(player, state);
    assert.ok(delays > 0, `${label} resumes real timed ScriptRunner suspensions`);
    assert.equal(player.getVar(stageVarp), stageBefore, `${label} leaves magearena unchanged`);
    assert.ok(
      packets.some(packet => packet instanceof MessageGame && packet.msg === 'You pull the lever...'),
      `${label} emits the real 'You pull the lever...' game-message packet`
    );
    assert.deepEqual(tileOf(player), destination, `${label} arrives at its configured destination`);
    walkable(tileOf(player), `${label} landing`);
    assert.ok(player.isInWilderness(), `${label} landing remains in the actual Wilderness region`);
    settleLever(info);
    const restored = World.getLoc(info.row.x, info.row.z, info.row.level, info.id);
    assert.ok(restored, `${label} native lever is restored for the next operation`);
    assert.equal(restored.type, info.id, `${label} lever lifecycle restores the original packed loc`);
  }

  const bossEnumId = requireId(types.EnumType, 'mage_arena_bosses', 'enum');
  const bossEnum = types.EnumType.get(bossEnumId);
  const bossTypeByStage = new Map([1, 2, 3, 4, 5].map(stage => {
    const typeId = bossEnum.values.get(stage);
    assert.ok(Number.isInteger(typeId) && typeId >= 0, `packed Mage Arena enum maps stage ${stage} to an NPC type`);
    return [stage, typeId];
  }));
  const bossTypeIds = new Set(bossTypeByStage.values());

  function activeArenaBosses() {
    return [...World.npcs]
      .filter(npc => npc?.isActive && bossTypeIds.has(npc.type))
      .sort((a, b) => a.nid - b.nid);
  }

  function assertSameBossObjects(expected, label) {
    const current = activeArenaBosses();
    assert.equal(current.length, expected.length, `${label}: no arena boss was added or removed`);
    for (let index = 0; index < expected.length; index++) {
      assert.equal(current[index], expected[index], `${label}: an existing spawned boss object/form is untouched`);
    }
  }

  function addNpcFixture(name, tile) {
    const id = requireId(types.NpcType, name, 'NPC type');
    const type = types.NpcType.get(id);
    const npc = new Npc(
      tile[0], tile[1], tile[2], type.size, type.size,
      EntityLifeCycle.DESPAWN, World.npcs.next(), id, BlockWalk.NONE
    );
    npc.lastMovement = -100;
    World.addNpc(npc, -1);
    fixtureNpcs.add(npc);
    return npc;
  }

  function removeAddedNpcs(beforeObjects) {
    for (const npc of [...World.npcs]) {
      if (npc && !beforeObjects.has(npc) && npc.isActive) World.removeNpc(npc, 0);
    }
  }

  for (const stage of stages) {
    const player = playerAt(outgoing);
    player.setVar(stageVarp, stage);
    assert.equal(player.getVar(stageVarp), stage, `fixture seeds Mage Arena state ${stage}`);
    let existingBoss = null;
    if (stage >= 1 && stage <= 5) {
      const typeId = bossTypeByStage.get(stage);
      const type = types.NpcType.get(typeId);
      const spawn = [arenaStart[0], arenaStart[1] + 5, arenaStart[2]];
      existingBoss = addNpcFixture(type.debugname, spawn);
      existingBoss.setVar(varNpcLastCombat, 0);
      assert.ok(existingBoss.isActive, `stage ${stage} has a seeded existing arena form`);
      assert.equal(existingBoss.type, typeId, `stage ${stage} seed uses its packed enum form`);
    }
    const bossesBefore = activeArenaBosses();
    if (existingBoss) assert.ok(bossesBefore.includes(existingBoss), `stage ${stage} existing boss is in the loaded world`);

    runLever(player, entrance, incoming, `stage ${stage} entrance`);
    assertSameBossObjects(bossesBefore, `stage ${stage} entrance`);
    runLever(player, exit, outgoing, `stage ${stage} exit`);
    assertSameBossObjects(bossesBefore, `stage ${stage} exit`);
    assert.equal(player.getVar(stageVarp), stage, `stage ${stage} completes a round trip unchanged`);
    if (existingBoss) {
      assert.ok(existingBoss.isActive, `stage ${stage} leaves the existing boss active`);
      assert.equal(existingBoss.type, bossTypeByStage.get(stage), `stage ${stage} leaves the current boss form unchanged`);
      World.removeNpc(existingBoss, 0);
    }
    clearPlayer(player);
  }

  function npcApproach(npc) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const tile = [npc.level, npc.x + dx, npc.z + dz];
      if (!floorTiles.has(tileKey(...tile)) || map.isMapBlocked(tile[1], tile[2], tile[0])) continue;
      if (map.reachedEntity(tile[0], tile[1], tile[2], npc.x, npc.z, npc.width, npc.length, 1)) return tile;
    }
    assert.fail('a packed-floor approach exists beside the Mage Arena NPC fixture');
  }

  function renderedText(player) {
    return packetLog.get(player)
      .filter(packet => packet instanceof IfSetText)
      .map(packet => packet.text)
      .join(' ')
      .replace(/\s+/g, ' ');
  }

  for (const stage of [1, 2, 3, 4, 5]) {
    const beforeObjects = new Set([...World.npcs].filter(Boolean));
    const kolodion = addNpcFixture('arenamage1', arenaStart);
    const typeId = bossTypeByStage.get(stage);
    const bossName = types.NpcType.get(typeId).debugname;
    const oldBoss = addNpcFixture(bossName, [arenaStart[0], arenaStart[1] + 5, arenaStart[2]]);
    oldBoss.setVar(varNpcLastCombat, 0);
    const player = playerAt(npcApproach(kolodion));
    const expectedRestart = [...arenaStart];
    if (stage === integerConstant('mage_arena_arachnid') || stage === integerConstant('mage_arena_demon')) {
      // These existing restart forms exact-move the player two tiles away from
      // the relative boss spawn; they do not leave the player on arenaStart.
      const dx = kolodion.x - player.x + 1;
      const dz = kolodion.z - player.z + 1;
      if (Math.abs(dx) > Math.abs(dz)) expectedRestart[1] += dx > 0 ? -2 : 2;
      else expectedRestart[2] += dz > 0 ? -2 : 2;
    }
    player.setVar(stageVarp, stage);
    player.target = kolodion;
    player.targetOp = ServerTriggerType.OPNPC1 - 7;
    const script = player.getOpTrigger();
    assert.ok(script, `Kolodion op dispatch exists at stage ${stage}`);
    assert.equal(script.name, '[opnpc1,arenamage1]', `stage ${stage} selects Kolodion's packed op trigger`);
    const state = ScriptRunner.init(script, player, kolodion);
    player.executeScript(state, true);
    assert.notEqual(state.execution, ScriptState.ABORTED, `Kolodion restart script runs at stage ${stage}`);
    const { delays, pauses } = resumeScript(player, state, true);
    assert.ok(pauses > 0, `stage ${stage} resumes the compiled dialogue`);
    assert.ok(delays > 0, `stage ${stage} resumes the compiled teleport delays`);
    assert.equal(player.getVar(stageVarp), stage, `Kolodion restart preserves stage ${stage}`);
    assert.deepEqual(tileOf(player), expectedRestart, `Kolodion restart preserves stage ${stage}'s existing teleport/exact-move endpoint`);
    const text = renderedText(player);
    if (stage === 1) assert.ok(text.includes("Okay, let's fight."), 'state 1 follows Kolodion lets_fight dialogue');
    else assert.ok(text.includes('You return, young conjurer.'), `state ${stage} follows Kolodion return dialogue`);
    assert.equal(oldBoss.isActive, false, `stage ${stage} removes the previous idle boss form`);
    const newBosses = activeArenaBosses().filter(npc => !beforeObjects.has(npc));
    assert.equal(newBosses.length, 1, `stage ${stage} creates exactly one current arena form after cleanup`);
    assert.notEqual(newBosses[0], oldBoss, `stage ${stage} replaces rather than retaining the old idle form`);
    assert.equal(newBosses[0].type, typeId, `stage ${stage} uses the current form from mage_arena_bosses`);
    assert.equal(newBosses[0].isActive, true, `stage ${stage} current form is active`);
    removeAddedNpcs(beforeObjects);
    clearPlayer(player);
  }

  function attackable(player, npc) {
    const script = ScriptProvider.getByName('[proc,npc_is_attackable_opt]');
    assert.ok(script, 'the production NPC attackability procedure is packed');
    const state = ScriptRunner.init(script, player, npc);
    ScriptRunner.execute(state);
    assert.equal(state.execution, ScriptState.FINISHED, 'the real form attackability check finishes');
    assert.ok(state.isp > 0, 'the attackability procedure returns a stack value');
    const result = state.intStack[state.isp - 1];
    assert.ok(result === 0 || result === 1, 'the returned attackability value is boolean');
    return result;
  }

  // Later forms already reject non-matching stages before a cast can earn credit.
  for (const [formStage, typeId] of bossTypeByStage) {
    if (formStage === integerConstant('mage_arena_started')) continue;
    const npc = addNpcFixture(types.NpcType.get(typeId).debugname, arenaStart);
    const player = playerAt(incoming);
    for (const stage of stages) {
      player.setVar(stageVarp, stage);
      assert.equal(attackable(player, npc), Number(stage === formStage),
        `form ${formStage} accepts only its matching stage, not stage ${stage}`);
    }
    World.removeNpc(npc, 0);
    clearPlayer(player);
  }

  function finishDeath(state) {
    for (let step = 0; state.execution !== ScriptState.FINISHED && step < 128; step++) {
      assert.notEqual(state.execution, ScriptState.ABORTED, 'human kill-credit script does not abort');
      if (state.execution === ScriptState.NPC_SUSPENDED) {
        const actor = state.activeNpc;
        World.currentTick = Math.max(World.currentTick + 1, actor.delayedUntil);
        actor.delayed = false;
        actor.executeScript(state);
      } else if (state.execution === ScriptState.SUSPENDED) {
        const actor = state.activePlayer;
        World.currentTick = Math.max(World.currentTick + 1, actor.delayedUntil);
        actor.delayed = false;
        actor.executeScript(state, true, true);
      } else {
        assert.fail(`unexpected human kill-credit suspension ${state.execution}`);
      }
    }
    assert.equal(state.execution, ScriptState.FINISHED, 'the human kill-credit branch completes');
  }

  function humanCreditCase(stage, magic, credit = true) {
    const player = playerAt(outgoing);
    player.baseLevels[PlayerStat.MAGIC] = magic;
    player.levels[PlayerStat.MAGIC] = magic;
    player.setVar(stageVarp, stage);
    runLever(player, entrance, incoming, `human-credit stage ${stage} Magic ${magic} entrance`);
    const beforeObjects = new Set([...World.npcs].filter(Boolean));
    const human = addNpcFixture('kolhuman', arenaStart);
    human.setVar(varNpcLastCombat, 0);
    assert.equal(attackable(player, human), 1, 'the unchanged enum still permits the human attack at stages zero and one');
    if (credit) human.heroPoints.addHero(player.hash64, 30);
    assert.equal(World.getPlayerByHash64(player.hash64), player, 'native hero lookup sees the fixture player');
    const type = types.NpcType.get(human.type);
    const script = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, human.type, type.category);
    assert.ok(script, 'the human death trigger resolves through packed dispatch');
    assert.equal(script.name, '[ai_queue3,kolhuman]', 'the actual human-form death queue is selected');
    human.applyDamage(human.levels[NpcStat.HITPOINTS], 1);
    const state = ScriptRunner.init(script, human);
    human.executeScript(state);
    finishDeath(state);
    const advances = credit && stage === integerConstant('mage_arena_started');
    assert.equal(player.getVar(stageVarp), advances ? integerConstant('mage_arena_ogre') : stage,
      `credited human death at stage ${stage}, Magic ${magic}, credit=${credit} preserves the challenge gate`);
    assert.equal(human.isActive, false, 'the human form dies, including the no-credit branch');
    const successors = activeArenaBosses().filter(npc => !beforeObjects.has(npc));
    assert.equal(successors.length, advances ? 1 : 0, 'only a started challenger receives a successor form');
    if (advances) {
      assert.equal(successors[0].type, bossTypeByStage.get(integerConstant('mage_arena_ogre')),
        'the legitimate stage-one kill still creates the original ogre form');
    }
    removeAddedNpcs(beforeObjects);
    clearPlayer(player);
  }

  for (let magic = 1; magic <= 99; magic++) humanCreditCase(0, magic);
  humanCreditCase(integerConstant('mage_arena_started'), 60);
  humanCreditCase(integerConstant('mage_arena_started'), 60, false);
  console.log('PASS human kill credit: stage zero unchanged at every Magic level 1–99; stage one advances with the original ogre; no-hero death unchanged; later forms reject all non-matching stages');

  console.log(`RESULT PASS Mage Arena levers: ${stages.length} states round-trip through both native locs; packed collision sides, Wilderness arrivals, dispatch, delays, messages and Kolodion restarts verified`);
  // player_teleport_normal has no checked-out Tele Block gameplay state/gate;
  // the fixture therefore uses real Wilderness coordinates rather than inventing a status varp.
  exitCode = 0;
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  if (mapReady) {
    for (const row of leverRowsForCleanup) {
      try {
        const locs = [...World.gameMap.getZone(row.x, row.z, row.level).getAllLocsUnsafe()]
          .filter(loc => loc.x === row.x && loc.z === row.z && loc.level === row.level);
        for (const loc of locs) {
          for (let steps = 0; loc.lifecycleTick > 0 && steps < 128; steps++) loc.turn();
        }
      } catch (error) {
        console.error(`failed to settle ${row.name} lifecycle during cleanup:`, error);
        exitCode = 1;
      }
    }
  }
  for (const npc of [...World.npcs]) {
    if (npc && !baselineNpcObjects.has(npc) && npc.isActive) {
      try {
        World.removeNpc(npc, 0);
      } catch (error) {
        console.error(`failed to remove test NPC ${npc.nid}:`, error);
        exitCode = 1;
      }
    }
  }
  for (const npc of fixtureNpcs) {
    if (npc?.isActive) {
      try {
        World.removeNpc(npc, 0);
      } catch (error) {
        console.error(`failed to remove fixture NPC ${npc.nid}:`, error);
        exitCode = 1;
      }
    }
  }
  for (const player of fixturePlayers) {
    try {
      player.clearPendingAction();
      player.activeScript = null;
      player.delayed = false;
      player.protect = false;
      player.unlink();
      if (World.players[player.slot] === player) delete World.players[player.slot];
    } catch (error) {
      console.error(`failed to remove fixture player ${player.slot}:`, error);
      exitCode = 1;
    }
  }
  // Offline World imports may own workers; no server or background process survives this test.
  process.exit(exitCode);
}
