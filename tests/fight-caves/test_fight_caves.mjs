import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runtime } from '../npc-combat/outcome_runtime.mjs';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = path.resolve(content, '../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = name => import(pathToFileURL(path.join(engine, name)).href);
const rt = await runtime(engine, pack);
const [
  { default: Trigger },
  { default: Runner },
  { CoordGrid },
  { PlayerStat },
  { NpcStat },
  { NpcMode },
  routefinder,
  { CollisionFlag: Flag, CollisionType },
] = await Promise.all([
  load('src/engine/script/ServerTriggerType.ts'),
  load('src/engine/script/ScriptRunner.ts'),
  load('src/engine/CoordGrid.ts'),
  load('src/engine/entity/PlayerStat.ts'),
  load('src/engine/entity/NpcStat.ts'),
  load('src/engine/entity/NpcMode.ts'),
  load('src/engine/GameMap.ts'),
  load('src/engine/routefinder/flags.ts'),
]);
const { World, Provider, State, Pointer, configs, id, param } = rt;
const { NpcType, LocType, ObjType, InvType, VarPlayerType, VarNpcType } = configs;
const nv = name => id(VarNpcType, name);
const pv = name => id(VarPlayerType, name);
const playerHp = PlayerStat.HITPOINTS;
const npcHp = NpcStat.HITPOINTS;
const contentScripts = path.join(content, 'scripts');
let passed = 0;

function check(label, action) {
  action();
  passed++;
  console.log(`PASS ${label}`);
}

function run(name, fixture, args = []) {
  const selector = name.startsWith('[') ? name : `[proc,${name}]`;
  let result;
  if (selector === '[proc,fightcaves_coord]') {
    // This internal coordinate proc inherits the caller's native region pointer.
    const region = World.instances.findInstanceByCoord(fixture.player);
    assert(region, 'coordinate fixture is inside a native instance');
    const state = Runner.init(Provider.getByName(selector), fixture.npc, fixture.player, args);
    state._activeRegion = region.sw;
    state._activeRegionUid = region.uid;
    state.pointerAdd(Pointer.ActiveRegion);
    state.pointerAdd(Pointer.ProtectedActivePlayer);
    fixture.npc.executeScript(state);
    result = { state, values: state.intStack.slice(0, state.isp) };
  } else {
    result = rt.run(selector, fixture, args);
  }
  assert.equal(result.state.execution, State.FINISHED, `${selector} completed`);
  return result;
}

function procInt(name, fixture, args = []) {
  const { state, values } = run(name, fixture, args);
  assert.equal(state.isp, 1, `${name} returns one integer`);
  return values[0];
}

function tickPlayer(player) {
  World.currentTick++;
  if (player.delayed && World.currentTick >= player.delayedUntil) player.delayed = false;
  if (!player.delayed && player.activeScript?.execution === State.SUSPENDED) {
    player.executeScript(player.activeScript, true, true);
  }
  player.processQueues();
}

function runPlayerScript(name, player, target = null, args = []) {
  const script = typeof name === 'string' ? Provider.getByName(name) : name;
  assert(script, `compiled player script ${typeof name === 'string' ? name : ''}`);
  const state = Runner.init(script, player, target, args);
  player.executeScript(state, true, true);
  for (let i = 0; state.execution === State.SUSPENDED && i < 12; i++) tickPlayer(player);
  assert.equal(state.execution, State.FINISHED, `${script.name} completed`);
  assert.equal(player.protect, false, `${script.name} released the protected player`);
  return state;
}

function parseConstant(file, name) {
  const text = fs.readFileSync(file, 'utf8');
  const match = new RegExp(`^\\s*\\^?${name}\\s*=\\s*(-?\\d+)\\s*$`, 'm').exec(text);
  assert(match, `source constant ${name} exists in ${path.basename(file)}`);
  return Number(match[1]);
}

function parseFightCoord(text, name) {
  const match = new RegExp(`^${name}=([0-3])_(\\d+)_(\\d+)_(\\d+)_(\\d+)\\s*$`, 'm').exec(text);
  assert(match, `fight_caves.constant has ${name}`);
  const [, level, mapX, mapZ, localX, localZ] = match;
  return {
    level: Number(level), mapX: Number(mapX), mapZ: Number(mapZ),
    localX: Number(localX), localZ: Number(localZ),
    x: Number(mapX) * 64 + Number(localX), z: Number(mapZ) * 64 + Number(localZ),
  };
}

function findMapLoc(mapX, mapZ, locId, label) {
  const mapName = `m${mapX}_${mapZ}.jm2`;
  const text = fs.readFileSync(path.join(content, 'maps', mapName), 'utf8');
  const entries = [];
  const row = /^(\d+)\s+(\d+)\s+(\d+):\s+(\d+)\s+10(?:\s|$)/gm;
  for (const match of text.matchAll(row)) {
    if (Number(match[4]) === locId) {
      entries.push({ level: Number(match[1]), x: mapX * 64 + Number(match[2]), z: mapZ * 64 + Number(match[3]) });
    }
  }
  assert.equal(entries.length, 1, `${label} has one packed shape-10 placement in ${mapName}`);
  return entries[0];
}

function reachable(point) {
  return routefinder.isZoneAllocated(point.level, point.x, point.z)
    && !routefinder.isFlagged(point.x, point.z, point.level, Flag.WALK_BLOCKED);
}

function assertFootprint(point, size, label) {
  for (let x = point.x; x < point.x + size; x++) {
    for (let z = point.z; z < point.z + size; z++) {
      assert(reachable({ ...point, x, z }), `${label} footprint tile ${x},${z} is in copied floor and walkable`);
    }
  }
}

function nativePath(start, finish, label) {
  assert.equal(start.level, finish.level, `${label} stays on its source plane`);
  const route = [...routefinder.findPath(start.level, start.x, start.z, finish.x, finish.z)];
  assert(route.length, `${label} has a non-empty engine route`);
  let current = { ...start };
  for (const packed of route) {
    const waypoint = CoordGrid.unpackCoord(packed);
    const dx = Math.sign(waypoint.x - current.x);
    const dz = Math.sign(waypoint.z - current.z);
    while (current.x !== waypoint.x || current.z !== waypoint.z) {
      assert(routefinder.canTravel(current.level, current.x, current.z, dx, dz, 1, 0, CollisionType.NORMAL),
        `${label} follows native walkable transitions`);
      current.x += dx;
      current.z += dz;
      assert(reachable(current), `${label} route tile ${current.x},${current.z} remains walkable`);
    }
  }
  assert.equal(current.x, finish.x, `${label} reaches destination x`);
  assert.equal(current.z, finish.z, `${label} reaches destination z`);
  return route;
}

function pathToLoc(start, loc, label) {
  const blockAccess = Number(LocType.get(loc.type).forceapproach ?? 0);
  const route = [...routefinder.findPathToLoc(start.level, start.x, start.z, loc.x, loc.z,
    1, loc.width, loc.length, loc.angle, loc.shape, blockAccess)];
  assert(route.length, `${label} has a non-empty native loc-interaction route`);
  const end = CoordGrid.unpackCoord(route.at(-1));
  assert(routefinder.reachedLoc(start.level, end.x, end.z, loc.x, loc.z,
    loc.width, loc.length, 1, loc.angle, loc.shape, blockAccess), `${label} ends at an admissible loc stand`);
  return route;
}

function distanceToActor(actor, point) {
  const dx = point.x < actor.x ? actor.x - point.x : point.x >= actor.x + actor.width ? point.x - (actor.x + actor.width - 1) : 0;
  const dz = point.z < actor.z ? actor.z - point.z : point.z >= actor.z + actor.length ? point.z - (actor.z + actor.length - 1) : 0;
  return Math.max(dx, dz);
}

function farReachableTile(start, actor, origin) {
  const minX = origin.x, maxX = origin.x + 63, minZ = origin.z, maxZ = origin.z + 63;
  const queue = [{ ...start, steps: 0 }];
  const seen = new Map([[`${start.x},${start.z}`, queue[0]]]);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const [dx, dz] of directions) {
      const x = current.x + dx, z = current.z + dz, key = `${x},${z}`;
      if (x < minX || x > maxX || z < minZ || z > maxZ || seen.has(key)) continue;
      const next = { level: start.level, x, z };
      if (!reachable(next) || !routefinder.canTravel(start.level, current.x, current.z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
      const node = { ...next, steps: current.steps + 1 };
      seen.set(key, node);
      queue.push(node);
    }
  }
  const candidates = [...seen.values()].filter(point => distanceToActor(actor, point) > NpcType.get(actor.type).attackrange + 1)
    .sort((a, b) => distanceToActor(actor, a) - distanceToActor(actor, b) || a.steps - b.steps);
  for (const point of candidates) {
    if (distanceToActor(actor, point) > NpcType.get(actor.type).maxrange) continue;
    const playerRoute = routefinder.findPath(start.level, start.x, start.z, point.x, point.z);
    if (!playerRoute.length) continue;
    const npcRoute = routefinder.findPathToEntity(actor.level, actor.x, actor.z, point.x, point.z, actor.width, 1, 1);
    if (!npcRoute.length) continue;
    const end = CoordGrid.unpackCoord(npcRoute.at(-1));
    if (!routefinder.reachedEntity(actor.level, end.x, end.z, point.x, point.z, 1, 1, actor.width)) continue;
    const naive = routefinder.findNaivePath(actor.level, actor.x, actor.z, point.x, point.z,
      actor.width, actor.length, 1, 1, 0, CollisionType.NORMAL);
    const first = CoordGrid.unpackCoord(naive[0]);
    if (first.x === actor.x && first.z === actor.z) continue;
    return point;
  }
  assert.fail(`${NpcType.get(actor.type).debugname} has no clear far pursuit tile within configured maxrange`);
}

function movePlayerTo(player, point, label) {
  const route = nativePath({ level: player.level, x: player.x, z: player.z }, point, label);
  for (const packed of route) {
    const tile = CoordGrid.unpackCoord(packed);
    player.teleport(tile.x, tile.z, tile.level ?? player.level);
  }
  assert.equal(player.x, point.x, `${label} player x`);
  assert.equal(player.z, point.z, `${label} player z`);
}

function adjacentStand(actor) {
  const candidates = [
    { level: actor.level, x: actor.x + actor.width, z: actor.z },
    { level: actor.level, x: actor.x - 1, z: actor.z },
    { level: actor.level, x: actor.x, z: actor.z + actor.length },
    { level: actor.level, x: actor.x, z: actor.z - 1 },
  ];
  return candidates.find(point => reachable(point) && routefinder.findPath(actor.level, player.x, player.z, point.x, point.z).length);
}

function playerQueue(player) {
  return [...player.queue.all()].map(request => ({ script: request.script.name, args: [...request.args], delay: request.delay }));
}

function ownedActors(player) {
  return [...World.npcs].filter(npc => npc.isActive
    && NpcType.get(npc.type)?.category === caveCategory
    && npc.getVar(ownerVar) === player.uid).sort((a, b) => a.nid - b.nid);
}

function clearOwned(player) {
  for (const npc of ownedActors(player)) {
    const nid = npc.nid;
    World.removeNpc(npc, -1);
    World.npcs.remove(nid);
    if (npc.nid >= 0) npc.cleanup();
  }
  player.queue.clear();
  player.setVar(pv('lastcombat'), 0);
  player.setVar(pv('aggressive_npc'), 0);
}

function spawnOwned(player, fixture, typeName, point) {
  const typeId = id(NpcType, typeName);
  run('fightcaves_spawn', fixture, [typeId, CoordGrid.packCoord(point.level, point.x, point.z)]);
  const npc = ownedActors(player).find(actor => actor.type === typeId && actor.x === point.x && actor.z === point.z);
  assert(npc?.isActive, `${typeName} is spawned by the production spawn proc`);
  return npc;
}

function processNpcQueue(npc, trigger, lastInt = 0) {
  npc.enqueueScript(trigger, 0, lastInt);
  npc.processQueue();
  for (let tick = 0; npc.activeScript && tick < 12; tick++) {
    World.currentTick++;
    npc.turn();
  }
  assert.equal(npc.activeScript, null, 'native NPC queue completes through its delayed turns');
}

function runNpcHandler(name, player, npc, args = [], variant = 'hit', rng = null) {
  const result = rt.observe(name, { player, npc }, args, variant, rng);
  assert.equal(result.snapshot.execution, State.FINISHED, `${name} completes`);
  assert.equal(result.snapshot.error, null, `${name} has no VM error`);
  return result;
}

function runLifecycle(player, name) {
  const trigger = name === 'login' ? Trigger.LOGIN : Trigger.LOGOUT;
  const script = Provider.getByTriggerSpecific(trigger, -1, -1);
  assert.equal(script?.name, `[${name},_]`, `native shared ${name} trigger selected`);
  runPlayerScript(script, player);
  assert.equal(player.activeScript, null, `${name} releases active script`);
  assert.equal(player.delayed, false, `${name} releases delay`);
}

function interactLoc(player, loc, expectedName) {
  player.target = loc;
  player.targetOp = Trigger.OPLOC1 - 7;
  const script = player.getOpTrigger();
  assert.equal(script?.name, expectedName, `native loc option selects ${expectedName}`);
  runPlayerScript(script, player, loc);
}

const constantPath = path.join(contentScripts, 'minigames/game_tzhaar/configs/fight_caves.constant');
const constantText = fs.readFileSync(constantPath, 'utf8');
const source = parseFightCoord(constantText, 'fightcaves_source');
const outside = parseFightCoord(constantText, 'fightcaves_outside');
const entry = parseFightCoord(constantText, 'fightcaves_entry');
const spawnTemplates = Array.from({ length: 6 }, (_, index) => parseFightCoord(constantText, `fightcaves_spawn${index}`));
const combatStylePath = path.join(contentScripts, 'skill_combat/configs/combat_damagetypes.constant');
const styles = Object.fromEntries(['melee_style', 'stab_style', 'crush_style', 'ranged_style', 'magic_style']
  .map(name => [name, parseConstant(combatStylePath, name)]));
const waveRows = [
  '100000','200000','010000','110000','210000','020000','001000','101000','201000','011000','111000','211000','021000','002000',
  '000100','100100','200100','010100','110100','210100','020100','001100','101100','201100','011100','111100','211100','021100','002100',
  '000200','000010','100010','200010','010010','110010','210010','020010','001010','101010','201010','011010','111010','211010','021010','002010',
  '000110','100110','200110','010110','110110','210110','020110','001110','101110','201110','011110','111110','211110','021110','002110','000210','000020','000001',
];
const tiers = [
  ['tzhaar_fightcave_swarm_1a', 'tzhaar_fightcave_swarm_1b'],
  ['tzhaar_fightcave_swarm_2a', 'tzhaar_fightcave_swarm_2b'],
  ['tzhaar_fightcave_swarm_3a', 'tzhaar_fightcave_swarm_3b'],
  ['tzhaar_fightcave_swarm_4a', 'tzhaar_fightcave_swarm_4b'],
  ['tzhaar_fightcave_swarm_5a', 'tzhaar_fightcave_swarm_5b'],
  ['tzhaar_fightcave_swarm_boss'],
];

await World.gameMap.init();
rt.dispose();
const fixture = rt.fixture('tzhaar_fightcave_master');
const player = fixture.player;
const caveCategory = NpcType.get(id(NpcType, tiers[0][0])).category;
const ownerVar = nv('npc_attacking_uid');
const stateVar = pv('fightcaves_state');
const actionDelayVar = nv('npc_action_delay');
const damageTypeVar = pv('damagetype');
const ownerUid = player.uid;
const exitLocId = id(LocType, 'cave_entrance_9357');
const entranceLocId = id(LocType, 'cave_entrance_9356');
const exitTemplate = findMapLoc(37, 79, exitLocId, 'inside cave exit');
const outsideLocPoint = findMapLoc(38, 80, entranceLocId, 'city cave entrance');
const exitLoc = World.getLoc(exitTemplate.x, exitTemplate.z, exitTemplate.level, exitLocId);
const outsideLoc = World.getLoc(outsideLocPoint.x, outsideLocPoint.z, outsideLocPoint.level, entranceLocId);
assert(exitLoc, 'packed inside cave exit resolves to a native Loc');
assert(outsideLoc, 'packed city entrance resolves to a native Loc');
const exitApproachTemplate = { level: exitTemplate.level, x: exitTemplate.x + 1, z: exitTemplate.z - 1 };

try {
  check('63-wave count and type tables match every compiled selector', () => {
    assert.equal(waveRows.length, 63);
    for (let wave = 1; wave <= 63; wave++) {
      const row = waveRows[wave - 1];
      for (let tier = 0; tier < 6; tier++) {
        const expectedCount = Number(row[tier]);
        assert.equal(procInt('fightcaves_wave_count', fixture, [wave, tier]), expectedCount, `wave ${wave}, tier ${tier}`);
      }
      assert.equal(procInt('fightcaves_wave_count', fixture, [wave, -1]), 0, `wave ${wave}: negative tier`);
      assert.equal(procInt('fightcaves_wave_count', fixture, [wave, 6]), 0, `wave ${wave}: high tier`);
    }
    for (let tier = 0; tier < tiers.length; tier++) {
      for (let variant = 0; variant < (tier === 5 ? 1 : 2); variant++) {
        const typeId = procInt('fightcaves_wave_type', fixture, [tier, variant]);
        assert.equal(NpcType.get(typeId).debugname, tiers[tier][variant], `tier ${tier}, variant ${variant}`);
      }
    }
    assert.equal(procInt('fightcaves_wave_count', fixture, [0, 0]), 0);
    assert.equal(procInt('fightcaves_wave_count', fixture, [64, 0]), 0);
  });

  check('all 13 encounter types admit the configured cave pursuit range', () => {
    const names = [...tiers.flat(), 'tzhaar_fightcave_swarm_2spawn', 'tzhaar_fightcave_swarm_boss_cleric'];
    assert.equal(new Set(names).size, 13);
    for (const name of names) {
      const type = NpcType.get(id(NpcType, name));
      assert.equal(type.maxrange, 64, `${name} maxrange covers the copied cave`);
    }
    for (const name of [...tiers[2], ...tiers[4], tiers[5][0]]) {
      assert.equal(NpcType.get(id(NpcType, name)).attackrange, 15, `${name} has its configured ranged attack reach`);
    }
  });

  check('packed city route and original cave exit approach are native-reachable', () => {
    assert(reachable(outside), 'the source outside landing is a packed clear floor tile');
    pathToLoc(outside, outsideLoc, 'city outside landing to cave entrance');
    nativePath(outside, { level: outsideLocPoint.level, x: outsideLocPoint.x + 9, z: outsideLocPoint.z + 3 },
      'outside landing to the original TzHaar city path');
    assert(reachable(exitApproachTemplate), 'the source exit interaction stand is a clear floor tile');
    assert(routefinder.reachedLoc(exitApproachTemplate.level, exitApproachTemplate.x, exitApproachTemplate.z,
      exitTemplate.x, exitTemplate.z, exitLoc.width, exitLoc.length, 1, exitLoc.angle, exitLoc.shape,
      Number(LocType.get(exitLocId).forceapproach ?? 0)), 'source exit approach reaches the native cave-exit loc');
    nativePath(entry, exitApproachTemplate, 'source entry to cave exit');
    nativePath(exitApproachTemplate, entry, 'source cave exit to entry');
  });

  player.teleport(outside.x, outside.z, outside.level);
  interactLoc(player, outsideLoc, '[oploc1,cave_entrance_9356]');
  assert.equal(procInt('fightcaves_owned', fixture), 1, 'entry owns a live region');
  assert.equal(procInt('fightcaves_current_wave', fixture), 1, 'entry starts wave one');
  const instance = World.instances.findInstanceByCoord(player);
  assert(instance, 'native entrance creates an instance for the player');
  const instanceOriginPacked = procInt('fightcaves_coord', fixture, [CoordGrid.packCoord(source.level, source.x, source.z)]);
  const instanceOrigin = CoordGrid.unpackCoord(instanceOriginPacked);
  const instanceEntry = CoordGrid.unpackCoord(procInt('fightcaves_coord', fixture,
    [CoordGrid.packCoord(entry.level, entry.x, entry.z)]));
  const instanceExit = CoordGrid.unpackCoord(procInt('fightcaves_coord', fixture,
    [CoordGrid.packCoord(exitTemplate.level, exitTemplate.x, exitTemplate.z)]));
  const instanceExitApproach = CoordGrid.unpackCoord(procInt('fightcaves_coord', fixture,
    [CoordGrid.packCoord(exitApproachTemplate.level, exitApproachTemplate.x, exitApproachTemplate.z)]));
  const instanceSpawns = spawnTemplates.map(point => CoordGrid.unpackCoord(procInt('fightcaves_coord', fixture,
    [CoordGrid.packCoord(point.level, point.x, point.z)])));
  const instanceExitLoc = World.getLoc(instanceExit.x, instanceExit.z, instanceExit.level, exitLocId);
  assert(instanceExitLoc, 'copied instance contains the original native exit loc');
  clearOwned(player);

  check('entry copies actual map squares and provides clear native routes and spawn footprints', () => {
    assert.equal(instanceEntry.level, entry.level, 'copied entry preserves its source plane');
    const sourceZone = World.gameMap.getZoneIfExists(instanceEntry.x, instanceEntry.z, instanceEntry.level);
    assert(sourceZone?.hasAssignedTemplate, 'instance entry zone has a source template');
    assert.deepEqual(sourceZone.source, {
      level: source.level,
      x: (source.x >> 3) + ((entry.x - source.x) >> 3),
      z: (source.z >> 3) + ((entry.z - source.z) >> 3),
    }, 'entry zone comes from the configured original square');
    assertFootprint(instanceEntry, 1, 'instance entry');
    assertFootprint(instanceExitApproach, 1, 'instance exit approach');
    nativePath(instanceEntry, instanceExitApproach, 'instance entry to exit approach');
    nativePath(instanceExitApproach, instanceEntry, 'instance exit approach to entry');
    assert(routefinder.reachedLoc(instanceExitApproach.level, instanceExitApproach.x, instanceExitApproach.z,
      instanceExitLoc.x, instanceExitLoc.z, instanceExitLoc.width, instanceExitLoc.length, 1,
      instanceExitLoc.angle, instanceExitLoc.shape, Number(LocType.get(exitLocId).forceapproach ?? 0)),
    'native interaction geometry reaches the copied exit loc');
    for (let index = 0; index < instanceSpawns.length; index++) {
      assertFootprint(instanceSpawns[index], 5, `configured spawn ${index} maximum 5x5 actor footprint`);
      nativePath(instanceEntry, instanceSpawns[index], `entry to spawn ${index}`);
      const npcRoute = [...routefinder.findPathToEntity(instanceSpawns[index].level, instanceSpawns[index].x,
        instanceSpawns[index].z, instanceEntry.x, instanceEntry.z, 5, 1, 1)];
      assert(npcRoute.length || routefinder.reachedEntity(instanceSpawns[index].level, instanceSpawns[index].x,
        instanceSpawns[index].z, instanceEntry.x, instanceEntry.z, 1, 1, 5),
      `5x5 NPC at spawn ${index} has a native return route or already reaches the player`);
    }
  });

  check('every wave spawns its exact tier composition at configured native coordinates', () => {
    for (let wave = 1; wave <= 63; wave++) {
      clearOwned(player);
      run('fightcaves_wave', fixture, [wave]);
      assert.equal(procInt('fightcaves_current_wave', fixture), wave, `wave ${wave} stored`);
      const expected = [];
      let spawnIndex = 0;
      for (let tier = 5; tier >= 0; tier--) {
        const count = Number(waveRows[wave - 1][tier]);
        for (let variant = 0; variant < count; variant++) {
          expected.push({ name: tiers[tier][variant], point: instanceSpawns[spawnIndex++] });
        }
      }
      const actual = ownedActors(player);
      assert.equal(actual.length, expected.length, `wave ${wave} actor count`);
      assert.deepEqual(actual.map(npc => ({ name: NpcType.get(npc.type).debugname, x: npc.x, z: npc.z })),
        expected.map(({ name, point }) => ({ name, x: point.x, z: point.z })), `wave ${wave} tier order and anchor coordinates`);
    }
  });

  check('native ranged mode pursues from a far reachable cave tile and attacks inside configured reach', () => {
    clearOwned(player);
    run('fightcaves_wave', fixture, [7]);
    let xil = ownedActors(player)[0];
    assert.equal(NpcType.get(xil.type).debugname, tiers[2][0]);
    const far = farReachableTile(instanceEntry, xil, instanceOrigin);
    assert(distanceToActor(xil, far) > NpcType.get(xil.type).attackrange, 'test stand is beyond attack range');
    assert(distanceToActor(xil, far) <= NpcType.get(xil.type).maxrange, 'test stand is inside maxrange');
    movePlayerTo(player, far, 'entry to far Xil stand');
    assert.equal(xil.targetOp, NpcMode.APPLAYER2, 'production spawn selects native AP pursuit');
    assert.equal(xil.target, player, 'Xil retains its owner target at a far tile');
    assert.equal(xil.targetWithinMaxRange(), true, 'native mode admits the far tile');
    const startDistance = distanceToActor(xil, far);
    let moved = false;
    for (let tick = 0; tick < 220; tick++) {
      World.currentTick++;
      xil.resetEntity(false);
      xil.turn();
      if (distanceToActor(xil, far) < startDistance) { moved = true; break; }
    }
    assert(moved, 'native AP mode moves toward a far player rather than resetting to defaults');
    const type = NpcType.get(xil.type);
    const rangedDistance = type.attackrange;
    for (let tick = 0; tick < 220; tick++) {
      if (distanceToActor(xil, far) <= rangedDistance && distanceToActor(xil, far) > 1
        && xil.getVar(actionDelayVar) > World.currentTick) break;
      World.currentTick++;
      xil.resetEntity(false);
      xil.turn();
    }
    assert(xil.getVar(actionDelayVar) > 0, 'native AP dispatch ran the Xil ranged attack');
    assert(playerQueue(player).some(request => request.script === '[queue,combat_damage_player]'),
      'native ranged attack queued its resolved player damage');
  });

  check('Tz-Kih attempts drain Prayer on a miss and clamp at zero', () => {
    clearOwned(player);
    run('fightcaves_wave', fixture, [1]);
    const kih = ownedActors(player)[0];
    const stand = adjacentStand(kih);
    assert(stand, 'a clear adjacent stand is native-reachable for Tz-Kih');
    movePlayerTo(player, stand, 'player to Tz-Kih contact');
    player.setVar(pv('prayer14'), 0);
    player.levels[PlayerStat.PRAYER] = 1;
    const beforeHp = player.levels[playerHp];
    const attack = runNpcHandler('[ai_opplayer2,tzhaar_fightcave_swarm_1a]', player, kih, [], 'miss');
    assert.equal(attack.snapshot.levels[PlayerStat.PRAYER], 0, 'an attempted miss drains exactly one Prayer');
    assert.equal(attack.snapshot.levels[playerHp], beforeHp, 'the forced miss deals no damage');
    player.levels[PlayerStat.PRAYER] = 0;
    kih.setVar(actionDelayVar, World.currentTick);
    player.setVar(pv('lastcombat'), 0);
    const zero = runNpcHandler('[ai_opplayer2,tzhaar_fightcave_swarm_1a]', player, kih, [], 'miss');
    assert.equal(zero.snapshot.levels[PlayerStat.PRAYER], 0, 'Prayer cannot drain below zero');
  });

  check('Tz-Kek recoil is one point for a zero-damage melee hit, not a ranged hit', () => {
    clearOwned(player);
    run('fightcaves_wave', fixture, [3]);
    const kek = ownedActors(player)[0];
    const beforeHp = player.levels[playerHp];
    player.queue.clear();
    player.setVar(damageTypeVar, styles.stab_style);
    processNpcQueue(kek, Trigger.AI_QUEUE2, 0);
    assert(playerQueue(player).some(request => request.script === '[queue,combat_damage_player]' && request.args[0] === 1),
      'zero-damage melee still queues one recoil point');
    rt.settle(fixture, 1);
    assert.equal(player.levels[playerHp], beforeHp - 1, 'native combat queue applies the recoil point');
    player.queue.clear();
    const rangedHp = player.levels[playerHp];
    player.setVar(damageTypeVar, styles.ranged_style);
    processNpcQueue(kek, Trigger.AI_QUEUE2, 0);
    assert.equal(playerQueue(player).some(request => request.script === '[queue,combat_damage_player]'), false,
      'zero-damage ranged hit does not recoil');
    rt.settle(fixture, 1);
    assert.equal(player.levels[playerHp], rangedHp, 'ranged hit causes no recoil damage');
  });

  check('Tz-Kek corpse waits for its two native death-queue splits before the heartbeat advances', () => {
    const kek = ownedActors(player).find(npc => NpcType.get(npc.type).debugname === tiers[1][0]);
    assert(kek, 'wave three Tz-Kek remains alive after recoil checks');
    kek.levels[npcHp] = 0;
    run('[timer,fightcaves_tick]', fixture);
    assert.equal(procInt('fightcaves_current_wave', fixture), 3, 'a zero-HP parent still owns its pending death queue');
    processNpcQueue(kek, Trigger.AI_QUEUE3, 0);
    const babies = ownedActors(player).filter(npc => NpcType.get(npc.type).debugname === 'tzhaar_fightcave_swarm_2spawn');
    assert.equal(babies.length, 2, 'native death queue creates exactly two Tz-Kek splits');
    run('[timer,fightcaves_tick]', fixture);
    assert.equal(procInt('fightcaves_current_wave', fixture), 3, 'a corpse/split wave cannot advance before deletion');
    for (let index = 0; index < babies.length; index++) {
      babies[index].levels[npcHp] = 0;
      processNpcQueue(babies[index], Trigger.AI_QUEUE3, 0);
      run('[timer,fightcaves_tick]', fixture);
      if (index === 0) assert.equal(procInt('fightcaves_current_wave', fixture), 3, 'one living split keeps its wave active');
    }
    assert.equal(procInt('fightcaves_current_wave', fixture), 4, 'wave advances only after both split deaths are processed');
    assert.deepEqual(ownedActors(player).map(npc => NpcType.get(npc.type).debugname), [tiers[1][0], tiers[0][0]], 'wave four spawns after final split deletion');
  });

  check('hybrid melee uses crush defence for Tok-Xil and stab defence for Ket-Zek and Jad', () => {
    clearOwned(player);
    run('fightcaves_wave', fixture, [7]);
    const xil = ownedActors(player)[0];
    let stand = adjacentStand(xil);
    assert(stand);
    movePlayerTo(player, stand, 'player to Tok-Xil melee stand');
    xil.setVar(actionDelayVar, World.currentTick);
    const xilTrace = runNpcHandler('[proc,fightcaves_melee]', player, xil);
    assert(xilTrace.visited.includes('[proc,player_defence_roll_specific]'), 'Xil executes the native defence roll');
    assert(xilTrace.events.some(event => event.op === 'PUSH_VARP' && event.variable === pv('com_crushdef')),
      'Tok-Xil ranged style reads the crush defence roll for melee');
    assert.equal(xilTrace.events.some(event => event.op === 'PUSH_VARP' && event.variable === pv('com_rangedef')), false,
      'Tok-Xil does not use ranged defence for its melee attack');

    clearOwned(player);
    run('fightcaves_wave', fixture, [31]);
    const zek = ownedActors(player)[0];
    stand = adjacentStand(zek);
    assert(stand);
    movePlayerTo(player, stand, 'player to Ket-Zek melee stand');
    zek.setVar(actionDelayVar, World.currentTick);
    const zekTrace = runNpcHandler('[proc,fightcaves_melee]', player, zek);
    assert(zekTrace.visited.includes('[proc,player_defence_roll_specific]'), 'Zek executes the native defence roll');
    assert(zekTrace.events.some(event => event.op === 'PUSH_VARP' && event.variable === pv('com_stabdef')),
      'Ket-Zek magic style reads the stab defence roll for melee');
    assert.equal(zekTrace.events.some(event => event.op === 'PUSH_VARP' && event.variable === pv('com_magicdef')), false,
      'Ket-Zek does not use magic defence for its melee attack');
    assert.equal(param(NpcType.get(zek.type), 'damagetype'), styles.magic_style, 'Ket-Zek is magic-damage configured');
    assert.equal(param(NpcType.get(xil.type), 'damagetype'), styles.ranged_style, 'Tok-Xil is ranged-damage configured');
    clearOwned(player);
    run('fightcaves_wave', fixture, [63]);
    const jad = ownedActors(player)[0];
    stand = adjacentStand(jad);
    assert(stand);
    movePlayerTo(player, stand, 'player to Jad melee stand');
    jad.setVar(actionDelayVar, World.currentTick);
    const jadTrace = runNpcHandler('[proc,fightcaves_melee]', player, jad);
    assert(jadTrace.visited.includes('[proc,player_defence_roll_specific]'), 'Jad executes the native defence roll');
    assert(jadTrace.events.some(event => event.op === 'PUSH_VARP' && event.variable === pv('com_stabdef')),
      'Jad ranged configuration still selects stab defence for its melee attack');
    assert.equal(jadTrace.events.some(event => event.op === 'PUSH_VARP' && event.variable === pv('com_magicdef')), false,
      'Jad does not use magic defence for its melee attack');
    assert.equal(param(NpcType.get(jad.type), 'damagetype'), styles.ranged_style,
      'Jad keeps its ranged default while its melee attack reads stab defence');
  });

  check('Tok-Xil and Ket-Zek native AP handlers execute their ranged and magic attacks', () => {
    clearOwned(player);
    run('fightcaves_wave', fixture, [7]);
    const xil = ownedActors(player)[0];
    movePlayerTo(player, instanceEntry, 'player beyond hybrid melee contact');
    const xilTrace = runNpcHandler('[ai_applayer2,tzhaar_fightcave_swarm_3a]', player, xil, [], 'hit');
    assert(xilTrace.visited.includes('[proc,player_projectile]'), 'Tok-Xil launches its native spine projectile');
    assert(xilTrace.snapshot.npcVars[actionDelayVar] > World.currentTick, 'Tok-Xil sets ranged attack delay');
    clearOwned(player);
    run('fightcaves_wave', fixture, [31]);
    const zek = ownedActors(player)[0];
    const zekTrace = runNpcHandler('[ai_applayer2,tzhaar_fightcave_swarm_5a]', player, zek, [], 'hit');
    assert(zekTrace.visited.includes('[proc,player_projectile]'), 'Ket-Zek launches its native fire projectile');
    assert(zekTrace.snapshot.queued.some(request => request.script === '[queue,combat_damage_player]'),
      'Ket-Zek queues its resolved magic damage');
  });

  check('Jad ranged and magic telegraphs sample protection only at delayed impact', () => {
    clearOwned(player);
    run('fightcaves_wave', fixture, [63]);
    const jad = ownedActors(player)[0];
    assert(distanceToActor(jad, player) > 1, 'the telegraph fixture is beyond Jad melee contact');
    player.queue.clear();
    player.setVar(pv('prayer13'), 0); player.setVar(pv('prayer12'), 0);
    player.setVar(pv('lastcombat'), 0); jad.setVar(actionDelayVar, World.currentTick);
    const ranged = runNpcHandler('[ai_applayer2,tzhaar_fightcave_swarm_boss]', player, jad, [], 'hit', { draws: [0] });
    const rangedImpact = ranged.snapshot.queued.find(request => request.script === '[queue,fightcaves_jad_impact]');
    assert(rangedImpact, 'Jad queues its three-tick ranged impact after the telegraph');
    assert.equal(rangedImpact.delay, 3);
    assert.equal(rangedImpact.args[1], styles.ranged_style, 'ranged telegraph carries the ranged damage style');
    assert(ranged.events.some(event => /ANIM|SPOTANIM/.test(event.op)), 'ranged attack emits its animation/spot-animation telegraph');
    const rangedHp = player.levels[playerHp];
    player.setVar(pv('prayer13'), 1);
    rt.settle(fixture, 4);
    assert.equal(player.levels[playerHp], rangedHp, 'late Protect from Missiles blocks the impact');

    player.queue.clear();
    jad.setVar(actionDelayVar, World.currentTick);
    jad.setVar(nv('npc_lastcombat'), 0);
    player.setVar(pv('lastcombat'), 0); player.setVar(pv('aggressive_npc'), 0);
    player.setVar(pv('prayer13'), 0); player.setVar(pv('prayer12'), 0);
    const magic = runNpcHandler('[ai_applayer2,tzhaar_fightcave_swarm_boss]', player, jad, [], 'hit', { draws: [0.999999] });
    const magicImpact = magic.snapshot.queued.find(request => request.script === '[queue,fightcaves_jad_impact]');
    assert(magicImpact, 'Jad queues its three-tick magic impact after the telegraph');
    assert.equal(magicImpact.delay, 3);
    assert.equal(magicImpact.args[1], styles.magic_style, 'magic telegraph carries the magic damage style');
    const magicHp = player.levels[playerHp];
    player.setVar(pv('prayer12'), 1);
    rt.settle(fixture, 4);
    assert.equal(player.levels[playerHp], magicHp, 'late Protect from Magic blocks the impact');
  });

  check('Tok-Mej heals only below half health, and Jad healers switch permanently after a player hit', () => {
    clearOwned(player);
    run('fightcaves_wave', fixture, [15]);
    const yt = ownedActors(player)[0];
    assert.equal(NpcType.get(yt.type).debugname, tiers[3][0]);
    const targetStand = { level: yt.level, x: yt.x + yt.width, z: yt.z };
    assertFootprint(targetStand, 1, 'Tok-Mej test target');
    const target = spawnOwned(player, fixture, tiers[0][0], targetStand);
    target.levels[npcHp] = 5;
    const half = Math.floor(NpcType.get(yt.type).stats[npcHp] / 2);
    yt.levels[npcHp] = half;
    runNpcHandler('[ai_timer,_tzhaar_fightcave]', player, yt);
    assert.equal(target.levels[npcHp], 5, 'Tok-Mej does not heal at exactly half health');
    yt.levels[npcHp] = half - 1;
    runNpcHandler('[ai_timer,_tzhaar_fightcave]', player, yt);
    assert.equal(target.levels[npcHp], 10, 'Tok-Mej heals its injured owned cave actor five hitpoints below half');

    clearOwned(player);
    run('fightcaves_wave', fixture, [63]);
    const jad = ownedActors(player)[0];
    const baseHp = NpcType.get(jad.type).stats[npcHp];
    const threshold = Math.floor(baseHp / 2);
    jad.levels[npcHp] = threshold + 2;
    processNpcQueue(jad, Trigger.AI_QUEUE2, 1);
    assert.equal(jad.levels[npcHp], threshold + 1, 'Jad remains one above the inclusive healer threshold');
    assert.equal(ownedActors(player).filter(npc => NpcType.get(npc.type).debugname === 'tzhaar_fightcave_swarm_boss_cleric').length, 0);
    processNpcQueue(jad, Trigger.AI_QUEUE2, 1);
    assert.equal(jad.levels[npcHp], threshold, 'one further damage reaches the inclusive half-health threshold');
    const healers = ownedActors(player).filter(npc => NpcType.get(npc.type).debugname === 'tzhaar_fightcave_swarm_boss_cleric');
    assert.equal(healers.length, 4, 'Jad spawns four healers at half health');
    assert(healers.every(npc => npc.getVar(ownerVar) === ownerUid && npc.getVar(nv('npc_int')) === 0
      && npc.targetOp === NpcMode.NONE), 'healers inherit owner and begin in passive healing mode');
    jad.levels[npcHp] = 50;
    const healer = healers[0];
    runNpcHandler('[ai_timer,_tzhaar_fightcave]', player, healer);
    assert.equal(jad.levels[npcHp], 55, 'a passive Hurkot heals its owned Jad by five');
    jad.levels[npcHp] = 50;
    processNpcQueue(healer, Trigger.AI_QUEUE1, 0);
    assert.equal(healer.getVar(nv('npc_int')), 1, 'a player hit moves the healer to combat');
    runNpcHandler('[ai_timer,_tzhaar_fightcave]', player, healer);
    assert.equal(jad.levels[npcHp], 50, 'combat-mode Hurkot no longer heals Jad');
  });

  check('safe death preserves items and grants only completed-wave Tokkul', () => {
    clearOwned(player);
    run('fightcaves_wave', fixture, [5]);
    const spade = id(ObjType, 'spade');
    const token = id(ObjType, 'tzhaar_token');
    const invId = id(InvType, 'inv');
    const inv = player.getInventory(invId);
    inv.items.fill(null);
    player.invAdd(invId, spade, 1);
    player.levels[playerHp] = 0;
    player.setVar(pv('death'), 1);
    const deathQueue = Provider.getByName('[queue,player_death_default]');
    player.enqueueScript(deathQueue);
    for (let tick = 0; tick < 8; tick++) tickPlayer(player);
    assert.equal(procInt('fightcaves_owned', fixture), 0, 'safe death leaves the instance');
    assert.equal(player.x, outside.x); assert.equal(player.z, outside.z); assert.equal(player.level, outside.level);
    assert.equal(player.invTotal(invId, spade), 1, 'safe death retains the carried spade');
    assert.equal(player.invTotal(invId, token), 20, 'four completed waves award exactly twenty Tokkul');
  });

  check('teleport guard, logout queue cleanup, wave recovery, and native exit interaction work end to end', () => {
    player.teleport(outside.x, outside.z, outside.level);
    interactLoc(player, outsideLoc, '[oploc1,cave_entrance_9356]');
    run('fightcaves_wave', fixture, [7]);
    const currentEntry = CoordGrid.unpackCoord(procInt('fightcaves_coord', fixture,
      [CoordGrid.packCoord(entry.level, entry.x, entry.z)]));
    const currentSpawns = spawnTemplates.slice(0, 2).map(point => CoordGrid.unpackCoord(procInt('fightcaves_coord', fixture,
      [CoordGrid.packCoord(point.level, point.x, point.z)])));
    assert.equal(procInt('fightcaves_teleport_check', fixture, [CoordGrid.packCoord(outside.level, outside.x, outside.z)]), 0,
      'teleport outside the owned copy is rejected');
    assert.equal(procInt('pre_tele_checks', fixture,
      [CoordGrid.packCoord(player.level, player.x, player.z)]), 0,
    'the real shared teleport caller rejects the departure coordinate inside the owned copy');
    assert.equal(player.x, currentEntry.x); assert.equal(player.z, currentEntry.z);
    assert.equal(procInt('fightcaves_owned', fixture), 1, 'rejected teleport keeps the owned cave intact');
    clearOwned(player);
    const zek = spawnOwned(player, fixture, tiers[4][0], currentSpawns[0]);
    const jad = spawnOwned(player, fixture, tiers[5][0], currentSpawns[1]);
    player.queue.clear();
    player.setVar(pv('lastcombat'), 0); player.setVar(pv('prayer13'), 0); player.setVar(pv('prayer12'), 0);
    runNpcHandler('[ai_applayer2,tzhaar_fightcave_swarm_5a]', player, zek, [], 'hit');
    runNpcHandler('[ai_applayer2,tzhaar_fightcave_swarm_boss]', player, jad, [], 'hit', { draws: [0] });
    const before = playerQueue(player).map(request => request.script);
    assert(before.includes('[queue,combat_damage_player]'), 'combat damage is pending before logout');
    assert(before.includes('[queue,fightcaves_jad_impact]'), 'Jad impact is pending before logout');
    const savedWave = procInt('fightcaves_current_wave', fixture);
    runLifecycle(player, 'logout');
    assert.equal(player.getVar(stateVar), savedWave, 'logout persists only the current wave bits');
    assert.equal(procInt('fightcaves_owned', fixture), 0, 'logout clears region ownership');
    assert.equal(player.x, outside.x); assert.equal(player.z, outside.z); assert.equal(player.level, outside.level);
    assert.equal(playerQueue(player).some(request => request.script === '[queue,combat_damage_player]'), false,
      'logout clears pending combat damage');
    assert.equal(playerQueue(player).some(request => request.script === '[queue,fightcaves_jad_impact]'), false,
      'logout clears pending Jad impact');
    assert.equal(player.timers.has(Provider.getByName('[timer,fightcaves_tick]').id), false, 'logout clears encounter heartbeat');
    runLifecycle(player, 'login');
    assert.equal(procInt('fightcaves_current_wave', fixture), savedWave, 'login preserves the saved wave');
    interactLoc(player, outsideLoc, '[oploc1,cave_entrance_9356]');
    assert.equal(procInt('fightcaves_current_wave', fixture), savedWave, 're-entry starts at the saved wave');
    assert.equal(procInt('fightcaves_owned', fixture), 1, 're-entry creates a new owned instance');
    const exitStand = CoordGrid.unpackCoord(procInt('fightcaves_coord', fixture,
      [CoordGrid.packCoord(exitApproachTemplate.level, exitApproachTemplate.x, exitApproachTemplate.z)]));
    movePlayerTo(player, exitStand, 'recovered wave to copied cave exit');
    const recoveredExit = CoordGrid.unpackCoord(procInt('fightcaves_coord', fixture,
      [CoordGrid.packCoord(exitTemplate.level, exitTemplate.x, exitTemplate.z)]));
    const loc = World.getLoc(recoveredExit.x, recoveredExit.z, recoveredExit.level, exitLocId);
    assert(loc && routefinder.reachedLoc(player.level, player.x, player.z, loc.x, loc.z,
      loc.width, loc.length, 1, loc.angle, loc.shape, Number(LocType.get(exitLocId).forceapproach ?? 0)),
    'player reaches the copied exit through native loc geometry');
    interactLoc(player, loc, '[oploc1,cave_entrance_9357]');
    assert.equal(procInt('fightcaves_owned', fixture), 0, 'native exit clears ownership');
    assert.equal(player.x, outside.x); assert.equal(player.z, outside.z); assert.equal(player.level, outside.level);
    assert.equal(player.invTotal(id(InvType, 'inv'), id(ObjType, 'tzhaar_token')), 62,
      'leaving after six completed waves awards the exact partial Tokkul reward');
  });

  check('Jad death after all 63 waves delivers full rewards privately when inventory is full', () => {
    player.teleport(outside.x, outside.z, outside.level);
    interactLoc(player, outsideLoc, '[oploc1,cave_entrance_9356]');
    clearOwned(player);
    run('fightcaves_wave', fixture, [63]);
    const jad = ownedActors(player)[0];
    assert.equal(NpcType.get(jad.type).debugname, tiers[5][0]);
    const invId = id(InvType, 'inv');
    const inventory = player.getInventory(invId);
    inventory.items.fill(null);
    const spade = id(ObjType, 'spade');
    for (let slot = 0; slot < inventory.capacity; slot++) inventory.set(slot, { id: spade, count: 1 });
    const cape = id(ObjType, 'tzhaar_cape_fire');
    const token = id(ObjType, 'tzhaar_token');
    assert.equal(inventory.items.filter(Boolean).length, inventory.capacity, 'inventory is full before victory');
    jad.levels[npcHp] = 0;
    processNpcQueue(jad, Trigger.AI_QUEUE3, 0);
    run('[timer,fightcaves_tick]', fixture);
    assert.equal(procInt('fightcaves_owned', fixture), 0, 'Jad death heartbeat finishes and destroys the copy');
    assert.equal(player.x, outside.x); assert.equal(player.z, outside.z); assert.equal(player.level, outside.level);
    assert.equal(player.invTotal(invId, spade), inventory.capacity, 'victory keeps every pre-existing item');
    const capeDrop = World.getObj(player.x, player.z, player.level, cape, player.hash64);
    const tokenDrop = World.getObj(player.x, player.z, player.level, token, player.hash64);
    assert.equal(capeDrop?.count, 1, 'private fire cape is delivered when no inventory slot is available');
    assert.equal(tokenDrop?.count, 8032, 'private full-completion Tokkul is delivered when no inventory slot is available');
    assert.equal(ObjType.get(token).tradeable, false, 'Tokkul remains configured untradeable');
    assert.equal(ObjType.get(cape).tradeable, false, 'fire cape remains configured untradeable');
    assert(!World.getObj(player.x, player.z, player.level, cape, player.hash64 + 1n), 'another account cannot receive the private cape');
    assert(!World.getObj(player.x, player.z, player.level, token, player.hash64 + 1n), 'another account cannot receive the private Tokkul');
    inventory.set(0, null);
    inventory.set(1, null);
    for (const object of [capeDrop, tokenDrop]) {
      player.target = object;
      player.targetOp = Trigger.OPOBJ3 - 7;
      const take = player.getOpTrigger();
      assert.equal(take?.name, '[opobj3,_]', 'native ground Take resolves the ordinary pickup handler');
      runPlayerScript(take, player, object);
    }
    assert.equal(player.invTotal(invId, cape), 1, 'the owner recovers the full-inventory fire cape through native Take');
    assert.equal(player.invTotal(invId, token), 8032, 'the owner recovers all full-inventory Tokkul through native Take');
    run('[timer,fightcaves_tick]', fixture);
    assert.equal(player.invTotal(invId, cape), 1, 'a later heartbeat cannot repeat the cape entitlement');
    assert.equal(player.invTotal(invId, token), 8032, 'a later heartbeat cannot repeat the Tokkul entitlement');
  });

  check('ordinary logout, login, teleport and death retain their native mainland behavior', () => {
    assert.equal(player.getVar(stateVar), 0, 'ordinary fixture has no cave state');
    const invId = id(InvType, 'inv');
    const spade = id(ObjType, 'spade');
    player.getInventory(invId).items.fill(null);
    player.invAdd(invId, spade, 1);
    runLifecycle(player, 'logout');
    runLifecycle(player, 'login');
    assert.equal(player.getVar(stateVar), 0, 'ordinary lifecycle creates no cave state');
    assert.equal(player.x, outside.x); assert.equal(player.z, outside.z);
    assert.equal(player.invTotal(invId, spade), 1, 'ordinary lifecycle preserves its carried item');
    const departure = CoordGrid.packCoord(player.level, player.x, player.z);
    assert.equal(procInt('pre_tele_checks', fixture, [departure]), 1,
      'the native shared teleport eligibility caller admits an ordinary departure');
    const mainland = { level: 0, x: 3221, z: 3218 };
    runPlayerScript('[proc,player_teleport_normal]', player, null,
      [CoordGrid.packCoord(mainland.level, mainland.x, mainland.z)]);
    assert.equal(player.x, mainland.x); assert.equal(player.z, mainland.z); assert.equal(player.level, mainland.level);
    assert.equal(player.invTotal(invId, spade), 1, 'ordinary teleport preserves its carried item');
    player.levels[playerHp] = 0;
    player.setVar(pv('death'), 1);
    player.enqueueScript(Provider.getByName('[queue,player_death_default]'));
    for (let tick = 0; tick < 8; tick++) tickPlayer(player);
    assert.equal(player.activeScript, null, 'ordinary death finishes through the native death queue');
    assert(player.testMessages.includes('Oh dear you are dead!'), 'ordinary death retains its original death message');
    assert.equal(player.level, 0);
    assert(Math.abs(player.x - 3221) <= 2 && Math.abs(player.z - 3218) <= 2,
      'ordinary death uses the native Lumbridge respawn search, not the cave exit');
    assert.equal(player.getVar(stateVar), 0, 'ordinary death creates no cave state');
    assert.equal(player.invTotal(invId, spade), 1, 'ordinary unskulled death keeps its single carried item');
    assert.equal(player.invTotal(invId, id(ObjType, 'tzhaar_token')), 0, 'ordinary death grants no cave reward');
  });
} finally {
  rt.dispose();
}

console.log(`PASS Fight Caves compiled suite (${passed} checks)`);
// World retains native workers after offline execution, as in the combat census.
process.exit(0);
