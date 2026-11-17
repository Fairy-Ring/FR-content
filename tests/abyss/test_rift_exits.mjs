#!/usr/bin/env node
/**
 * Execute every native Abyss rift exit from the built pack, without starting a server.
 * From the sibling engine after npm run build:
 * node --import tsx ../content/tests/abyss/test_rift_exits.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const packDir = path.join(engine, 'data/pack');
assert.ok(existsSync(path.join(packDir, 'server/script.dat')), 'build the sibling engine first');
const load = async rel => (await import(pathToFileURL(path.join(engine, 'src', rel)).href)).default;
const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const { PlayerStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const map = await import(pathToFileURL(path.join(engine, 'src/engine/GameMap.ts')).href);
const { CollisionType } = await import(pathToFileURL(path.join(engine, 'src/engine/routefinder/index.ts')).href);
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType', 'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType']) {
  types[name] = await load(`cache/config/${name}.ts`);
  types[name].load(packDir);
}
(await load('cache/config/DbTableIndex.ts')).init();
assert.ok(ScriptProvider.load(packDir) > 0, 'a complete packed world is required');
World.currentTick = 100;
World.gameMap.init();

const runes = ['air', 'mind', 'water', 'earth', 'fire', 'body', 'cosmic', 'chaos', 'nature', 'law', 'death', 'blood', 'soul'];
const ordinaryRunes = runes.slice(0, 11);
const riftNames = new Set(runes.map(rune => `abyss_exit_to_${rune}`));
const altarNames = new Set(ordinaryRunes.map(rune => `${rune}_altar`));
const tileKey = (level, x, z) => `${level},${x},${z}`;
const mapRoot = path.join(content, 'maps');
const locPack = readFileSync(path.join(content, 'pack/loc.pack'), 'utf8');
const locNames = new Map(locPack.trim().split(/\r?\n/).map(line => {
  const separator = line.indexOf('=');
  assert.ok(separator > 0, `invalid generated loc.pack row: ${line}`);
  const id = Number(line.slice(0, separator));
  assert.ok(Number.isInteger(id), `invalid generated loc.pack id: ${line}`);
  return [id, line.slice(separator + 1)];
}));
const floors = new Set();
const riftPlacements = [];
const altars = new Map([...altarNames].map(name => [name, []]));
const mapFiles = readdirSync(mapRoot).filter(name => /^m\d+_\d+\.jm2$/.test(name)).sort();
assert.ok(mapFiles.includes('m47_75.jm2'), 'the native Abyss map is present');

for (const filename of mapFiles) {
  const [, mapX, mapZ] = /^m(\d+)_(\d+)\.jm2$/.exec(filename);
  const mx = Number(mapX);
  const mz = Number(mapZ);
  let section = '';
  for (const line of readFileSync(path.join(mapRoot, filename), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) {
      section = line.split(' ')[1];
      continue;
    }
    const match = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
    if (!match) continue;
    const level = Number(match[1]);
    const x = mx * 64 + Number(match[2]);
    const z = mz * 64 + Number(match[3]);
    const values = match[4];
    if (section === 'MAP' && /(?:^| )(?:u\d+|o-?\d+)(?:[; ]|$)/.test(values)) {
      floors.add(tileKey(level, x, z));
    }
    if (section !== 'LOC') continue;
    const [id, shape = 10, angle = 0] = values.split(/\s+/).map(Number);
    const name = locNames.get(id);
    if (!name) continue;
    const placement = { name, level, x, z, shape, angle, coord: `${level}_${mx}_${mz}_${x & 63}_${z & 63}` };
    if (filename === 'm47_75.jm2' && riftNames.has(name)) riftPlacements.push(placement);
    if (altarNames.has(name)) altars.get(name).push(placement);
  }
}

const expectedRifts = [...riftNames].sort();
assert.equal(riftPlacements.length, 13, 'all 13 rifts are native placements in m47_75.jm2');
assert.deepEqual([...new Set(riftPlacements.map(row => row.name))].sort(), expectedRifts, 'the map and generated loc.pack identify every rune rift');
assert.equal(new Set(riftPlacements.map(row => `${row.name}@${row.coord}`)).size, 13, 'each rune rift has one native map placement');
const riftByName = new Map(riftPlacements.map(row => [row.name, row]));
for (const rune of ordinaryRunes) {
  assert.ok(altars.get(`${rune}_altar`)?.length, `native 377 placement exists for ${rune}_altar`);
}

function nativeLoc(row) {
  const id = types.LocType.getId(row.name);
  assert.ok(id >= 0, `packed loc type is named ${row.name}`);
  const loc = World.getLoc(row.x, row.z, row.level, id);
  assert.ok(loc, `native packed placement exists for ${row.name} at ${row.coord}`);
  assert.equal(loc.angle, row.angle, `${row.name} packed rotation matches the source map`);
  return { loc, type: types.LocType.get(id) };
}
function approaches(row, type) {
  const found = [];
  for (let x = row.x - 5; x <= row.x + 5; x++) {
    for (let z = row.z - 5; z <= row.z + 5; z++) {
      if (!floors.has(tileKey(row.level, x, z)) || map.isMapBlocked(x, z, row.level)) continue;
      if (map.reachedLoc(row.level, x, z, row.x, row.z, type.width, type.length, 1, row.angle, row.shape, type.forceapproach)) {
        found.push([row.level, x, z]);
      }
    }
  }
  found.sort((a, b) => Math.abs(a[1] - row.x) + Math.abs(a[2] - row.z) - Math.abs(b[1] - row.x) - Math.abs(b[2] - row.z) || a[1] - b[1] || a[2] - b[2]);
  assert.ok(found.length, `a walkable native approach exists for ${row.name} ${row.coord}`);
  return found[0];
}

let serial = 0;
const invType = types.InvType.getId('inv');
const wornType = types.InvType.getId('worn');
assert.ok(invType >= 0 && wornType >= 0, 'packed inventory types are available');
function requireId(config, name, label) {
  const id = config.getId(name);
  assert.ok(id >= 0, `packed ${label} is named ${name}`);
  return id;
}
const varpId = name => requireId(types.VarPlayerType, name, 'varp');
const varbitId = name => requireId(types.VarBitType, name, 'varbit');
const itemId = name => requireId(types.ObjType, name, 'item');
function execute(row, { varps = {}, varbits = {}, inventory = [], worn = [] } = {}) {
  const slot = ++serial;
  const player = new Player(`abyss_rift_${slot}`, BigInt(slot), BigInt(slot));
  player.slot = slot;
  player.pid = slot;
  player.uid = slot;
  player.vars.fill(0);
  player.baseLevels.fill(1);
  player.levels.fill(1);
  const start = approaches(row, nativeLoc(row).type);
  [player.level, player.x, player.z] = start;
  const messages = [];
  player.messageGame = text => messages.push(text);
  player.wrappedMessageGame = text => messages.push(text);
  for (const [name, value] of Object.entries(varps)) player.setVar(varpId(name), value);
  for (const [name, value] of Object.entries(varbits)) player.setVarBit(varbitId(name), value);
  for (const name of inventory) assert.equal(player.invAdd(invType, itemId(name), 1), 1, `${name} fits in the fixture inventory`);
  for (const name of worn) {
    const id = itemId(name);
    const type = types.ObjType.get(id);
    assert.ok(type.wearpos >= 0, `${name} has a worn slot`);
    assert.equal(player.invGetSlot(wornType, type.wearpos), null, `${name} worn slot is free`);
    player.invSet(wornType, id, 1, type.wearpos);
  }

  const trigger = `[oploc1,${row.name}]`;
  const script = ScriptProvider.getByName(trigger);
  assert.ok(script, `packed production trigger exists: ${trigger}`);
  const state = ScriptRunner.init(script, player, World.getLoc(row.x, row.z, row.level, types.LocType.getId(row.name)));
  let result = player.runScript(state, true, true);
  for (let resumes = 0; result !== ScriptState.FINISHED && resumes < 12; resumes++) {
    if (result !== ScriptState.SUSPENDED) assert.fail(`${trigger}: unexpected interpreter boundary ${result}`);
    World.currentTick = Math.max(World.currentTick + 1, player.delayedUntil);
    player.delayed = false;
    result = player.runScript(state, true, true);
  }
  assert.equal(result, ScriptState.FINISHED, `${trigger}: packed execution finishes`);
  return { player, start, destination: [player.level, player.x, player.z], messages };
}
function assertStationary(result, label) {
  assert.deepEqual(result.destination, result.start, `${label}: refused exit does not move the player`);
  assert.ok(result.messages.length > 0, `${label}: a sourced refusal is shown`);
}
function canReachAltar(start, altar) {
  if (start[0] !== altar.level) return false;
  const altarTypeId = types.LocType.getId(altar.name);
  assert.ok(altarTypeId >= 0, `packed altar loc type is named ${altar.name}`);
  const altarType = types.LocType.get(altarTypeId);
  const pending = [start];
  const visited = new Set([tileKey(...start)]);
  // Match the engine pathfinder's 128-tile search window centered on the landing.
  for (let index = 0; index < pending.length; index++) {
    const [level, x, z] = pending[index];
    if (map.reachedLoc(level, x, z, altar.x, altar.z, altarType.width, altarType.length, 1, altar.angle, altar.shape, altarType.forceapproach)) return true;
    for (const [dx, dz] of [[-1, 0], [0, -1], [1, 0], [0, 1]]) {
      const nextX = x + dx;
      const nextZ = z + dz;
      if (Math.abs(nextX - start[1]) > 63 || Math.abs(nextZ - start[2]) > 63) continue;
      const key = tileKey(level, nextX, nextZ);
      if (visited.has(key) || !floors.has(key) || map.isMapBlocked(nextX, nextZ, level)) continue;
      if (!map.canTravel(level, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
      visited.add(key);
      pending.push([level, nextX, nextZ]);
    }
  }
  return false;
}
const expectedLandings = new Map([
  ['body', '0_39_75_27_38'],
  ['law', '0_38_75_32_19'],
  ['death', '0_34_75_32_30']
]);
function decodeCoord(coord) {
  const [level, mapX, mapZ, localX, localZ] = coord.split('_').map(Number);
  return [level, mapX * 64 + localX, mapZ * 64 + localZ];
}
function assertLanding(rune, result) {
  const [level, x, z] = result.destination;
  assert.ok(floors.has(tileKey(level, x, z)), `${rune} landing has a 377 map floor`);
  assert.equal(map.isMapBlocked(x, z, level), false, `${rune} landing is unblocked by engine collision`);
  if (rune === 'chaos') assert.equal(level, 0, 'chaos exits directly to the bottom altar floor, not the maze roof');
  const targetAltar = `${rune}_altar`;
  const destinations = altars.get(targetAltar) ?? [];
  assert.ok(destinations.length, `native 377 map placement exists for ${targetAltar}`);
  assert.ok(destinations.some(altar => altar.level === level && canReachAltar(result.destination, altar)), `${rune} landing has an engine-collision path to its own altar on the correct level`);
  const expected = expectedLandings.get(rune);
  if (expected) assert.deepEqual(result.destination, decodeCoord(expected), `${rune} rift lands at the requested native altar entrance`);
}
function assertLowLevelBare(player, label) {
  assert.equal(player.baseLevels[PlayerStat.RUNECRAFT], 1, `${label}: base Runecraft is level 1`);
  assert.equal(player.levels[PlayerStat.RUNECRAFT], 1, `${label}: current Runecraft is level 1`);
  assert.equal(player.getInventory(invType).itemsFiltered.length, 0, `${label}: no talisman or tiara (or other inventory item) is required`);
  assert.equal(player.getInventory(wornType).itemsFiltered.length, 0, `${label}: no talisman or tiara is worn`);
}

const unrestrictedRunes = ['air', 'mind', 'water', 'earth', 'fire', 'body', 'chaos', 'nature'];
for (const rune of unrestrictedRunes) {
  const result = execute(riftByName.get(`abyss_exit_to_${rune}`));
  assertLowLevelBare(result.player, `${rune} rift`);
  assertLanding(rune, result);
}

const cosmicRift = riftByName.get('abyss_exit_to_cosmic');
const lostCityIncomplete = execute(cosmicRift, { varps: { zanaris: 5 } });
assertStationary(lostCityIncomplete, 'cosmic rift before Lost City completion');
const cosmic = execute(cosmicRift, { varps: { zanaris: 6 } });
assertLowLevelBare(cosmic.player, 'cosmic rift');
assertLanding('cosmic', cosmic);

const lawRift = riftByName.get('abyss_exit_to_law');
assertStationary(execute(lawRift, { varps: { troll_quest: 49 } }), 'law rift before Troll Stronghold completion');
const restrictedGear = ['bronze_sword', 'bronze_platebody'];
for (const storage of ['inventory', 'worn']) {
  for (const name of restrictedGear) {
    const result = execute(lawRift, {
      varps: { troll_quest: 50 },
      [storage]: [name]
    });
    assertStationary(result, `law rift with ${name} in ${storage}`);
    const id = itemId(name);
    assert.equal(result.player.invTotal(invType, id), storage === 'inventory' ? 1 : 0, `${name} remains in the expected inventory state`);
    assert.equal(result.player.invTotal(wornType, id), storage === 'worn' ? 1 : 0, `${name} remains in the expected worn state`);
  }
}
const bareLaw = execute(lawRift, { varps: { troll_quest: 50 } });
assertLowLevelBare(bareLaw.player, 'law rift');
assertLanding('law', bareLaw);
const lawWithSafeItem = execute(lawRift, { varps: { troll_quest: 50 }, inventory: ['coins'] });
assert.equal(lawWithSafeItem.player.invTotal(invType, itemId('coins')), 1, 'safe inventory item remains carried');
assertLanding('law', lawWithSafeItem);

const deathRift = riftByName.get('abyss_exit_to_death');
assertStationary(execute(deathRift, { varbits: { mourning_quest_main: 59 } }), 'death rift before MEP2 completion');
const death = execute(deathRift, { varbits: { mourning_quest_main: 60 } });
assertLowLevelBare(death.player, 'death rift');
assertLanding('death', death);

for (const rune of ['blood', 'soul']) {
  const result = execute(riftByName.get(`abyss_exit_to_${rune}`));
  assertStationary(result, `${rune} rift has no teleport`);
}

console.log(`RESULT PASS abyss rift exits: ${riftPlacements.length} native placements; 11 altar destinations, all three quest gates, Entrana equipment gate, and blood/soul non-teleports verified`);
