import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const load = async relative => (await import(pathToFileURL(path.join(engine, 'src', relative)).href)).default;
const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const OpLoc = await load('network/game/client/model/OpLoc.ts');
const OpLocHandler = await load('network/game/client/handler/OpLocHandler.ts');
const JavaRandom = await load('util/JavaRandom.ts');
const { PlayerStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const map = await import(pathToFileURL(path.join(engine, 'src/engine/GameMap.ts')).href);
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'Component', 'FontType']) {
  types[name] = await load(`cache/config/${name}.ts`);
  types[name].load(path.join(engine, 'data/pack'));
}
(await load('cache/config/DbTableIndex.ts')).init();
assert(ScriptProvider.load(path.join(engine, 'data/pack')) > 0);
World.currentTick = 100;
World.gameMap.init();
const expected = JSON.parse(readFileSync(new URL('./rocks.json', import.meta.url), 'utf8'));
const id = (kind, name) => {
  const value = types[kind].getId(name);
  assert(value >= 0, `packed ${kind}: ${name}`);
  return value;
};
const param = (type, name) => type.params.get(id('ParamType', name));
const tableId = id('DbTableType', 'mining_table');
const table = types.DbTableType.get(tableId);
const rows = types.DbRowType.getInTable(tableId);
const field = (row, column) => row.getValue(table.columnNames.indexOf(column), 0);
const rockColumn = table.columnNames.indexOf('rock');
const inv = id('InvType', 'inv');
const actionDelay = id('VarPlayerType', 'action_delay');
const handler = new OpLocHandler();
const placements = new Map();
for (const file of readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name)).sort()) {
  const [mx, mz] = file.slice(1).split('_').map(Number.parseFloat);
  let section = '';
  for (const line of readFileSync(path.join(content, 'maps', file), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) section = line;
    if (!section.includes('LOC')) continue;
    const match = line.match(/^(\d+) (\d+) (\d+): (\d+) (\d+)(?: (\d+))?/);
    if (!match) continue;
    const [, level, x, z, type, shape, angle = '0'] = match.map(Number);
    const list = placements.get(type) ?? [];
    list.push({ level, x: mx * 64 + x, z: mz * 64 + z, shape, angle: Number(angle) });
    placements.set(type, list);
  }
}
function native(name) {
  const type = id('LocType', name);
  for (const row of placements.get(type) ?? []) {
    const loc = World.getLoc(row.x, row.z, row.level, type);
    if (loc && approach(loc)) return loc;
  }
  assert.fail(`${name}: native packed loc with a walkable approach must exist`);
}
function approach(loc) {
  const type = types.LocType.get(loc.type);
  for (let radius = 1; radius <= 3; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const x = loc.x + dx, z = loc.z + dz;
        if (map.isMapBlocked(x, z, loc.level)) continue;
        if (map.reachedLoc(loc.level, x, z, loc.x, loc.z, type.width, type.length, 1, loc.angle, loc.shape, type.forceapproach)) return [x, z];
      }
    }
  }
  return null;
}
let serial = 0;
function player(loc) {
  const p = new Player(`rocktest${++serial}`, BigInt(serial), BigInt(serial));
  p.pid = p.slot = p.uid = serial;
  p.vars.fill(0);
  p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(100000);
  p.setVar(id('VarPlayerType', 'tutorial'), 1000);
  p.level = loc.level;
  const stand = approach(loc);
  assert(stand, `${types.LocType.get(loc.type).debugname}: walkable native approach`);
  [p.x, p.z] = stand;
  p.originX = p.x; p.originZ = p.z;
  p.messages = [];
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = text => p.messages.push(String(text));
  p.invAdd(inv, id('ObjType', 'bronze_pickaxe'), 1);
  return p;
}
function dispatch(p, loc, option) {
  assert.equal(handler.handle(new OpLoc(option, loc.x, loc.z, loc.type), p), true);
  assert.equal(p.target, loc);
  assert.equal(p.getApTrigger(), null, 'Mining uses native operate dispatch');
  return p.getOpTrigger();
}
function execute(p, loc, option, expectedName) {
  const script = dispatch(p, loc, option);
  assert(script, `${types.LocType.get(loc.type).debugname}: native option ${option} dispatch`);
  assert.equal(script.name, expectedName);
  const state = ScriptRunner.init(script, p, loc);
  let execution = p.runScript(state, true, true);
  for (let boundary = 0; execution === ScriptState.SUSPENDED && boundary < 8; boundary++) {
    World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
    p.delayed = false;
    execution = p.runScript(state, true, true);
  }
  assert.equal(execution, ScriptState.FINISHED, `${script.name}: native interpreter finishes`);
  return state;
}
for (const [ore, values] of Object.entries(expected.ores)) {
  const row = types.DbRowType.getByName(values.row);
  assert(row, `${ore}: existing row`);
  assert.deepEqual(field(row, 'ore_name'), [values.name]);
  assert.deepEqual(field(row, 'rock_output'), [id('ObjType', values.output)]);
  assert.deepEqual(field(row, 'rock_level'), [values.level]);
  assert.deepEqual(field(row, 'rock_exp'), [values.xp]);
  assert.deepEqual(field(row, 'rock_successchance'), values.chance);
  assert.deepEqual(field(row, 'rock_respawnrate'), [values.respawn]);
}
for (const spec of expected.built) {
  const ore = expected.ores[spec.ore];
  const type = types.LocType.get(id('LocType', spec.name));
  const matches = rows.filter(row => row.columnValues[rockColumn].includes(type.id));
  assert.equal(matches.length, 1, `${spec.name}: exactly one ore row`);
  assert.equal(matches[0].debugname, ore.row);
  assert.equal(type.category, id('CategoryType', spec.category));
  const empty = id('LocType', spec.empty);
  assert.equal(param(type, 'next_loc_stage_mining'), empty, `${spec.name}: depleted stage`);
  assert.equal(param(types.LocType.get(empty), 'mining_rock_empty'), 1);
  if (spec.name.startsWith('mineral_vein')) {
    assert(type.models, `${spec.name}: native vein model`);
    const counterparts = expected.veinEmpty.filter(name => {
      const models = types.LocType.get(id('LocType', name)).models;
      return models && models.length === type.models.length && models.every((model, index) => model === type.models[index]);
    });
    assert.deepEqual(counterparts, [spec.empty], `${spec.name}: UNKNOWN engineering counterpart is unique by identical model`);
  }
  const loc = native(spec.name);
  const p = player(loc);
  const base = [loc.type, loc.shape, loc.angle];
  execute(p, loc, 2, `[oploc2,_${spec.category}]`);
  assert.deepEqual(p.messages, ['You examine the rock for ores...', `This rock contains ${ore.name}.`]);
  p.messages.length = 0;
  p.setVar(actionDelay, World.currentTick);
  const xp = p.stats[PlayerStat.MINING];
  // Fixture seed 3 gives native non-gem roll 187 and ore roll 18. Production RNG is unchanged.
  JavaRandom.setSeed(3);
  execute(p, loc, 1, `[oploc1,_${spec.category}]`);
  assert.equal(p.invTotal(inv, id('ObjType', ore.output)), 1, `${spec.name}: native ore reward`);
  assert.equal(p.stats[PlayerStat.MINING] - xp, ore.xp, `${spec.name}: unchanged ore XP`);
  assert.equal(loc.type, empty, `${spec.name}: native depletion changes visible form`);
  assert.equal(loc.lifecycleTick, ore.respawn, `${spec.name}: unchanged respawn (zero world players)`);
  const remaining = loc.lifecycleTick;
  const emptyCategory = types.CategoryType.get(types.LocType.get(empty).category).debugname;
  p.messages.length = 0;
  execute(p, loc, 2, `[oploc2,_${emptyCategory}]`);
  assert(p.messages.includes('There is no ore left in this rock.'));
  p.messages.length = 0;
  execute(p, loc, 1, `[oploc1,_${emptyCategory}]`);
  assert(p.messages.includes('There is no ore currently available in this rock.'));
  assert.equal(p.invTotal(inv, id('ObjType', ore.output)), 1, 'empty rock awards nothing');
  for (let tick = 1; tick < remaining; tick++) { World.currentTick++; loc.turn(); }
  assert.equal(loc.type, empty, 'rock remains depleted before its deadline');
  World.currentTick++; loc.turn();
  assert.deepEqual([loc.type, loc.shape, loc.angle], base, `${spec.name}: native lifecycle restores type, shape and angle`);
  assert.equal(loc.lifecycleTick, -1);
  console.log(`PASS ${spec.name}: ${ore.name}; Prospect, Mine, empty refusals, depletion and respawn`);
}
for (const name of expected.left) {
  const loc = native(name);
  const p = player(loc);
  for (const option of [1, 2]) assert.equal(dispatch(p, loc, option), null, `${name}: left option ${option} still has no handler`);
}
console.log(`RESULT PASS mining rocks: ${expected.built.length} built types; ${expected.left.length} left types; unchanged ordinary ore rules`);
process.exit(0);
