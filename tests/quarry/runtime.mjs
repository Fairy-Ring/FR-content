import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const load = async relative => (await import(pathToFileURL(path.join(engine, 'src', relative)).href)).default;
export const World = await load('engine/World.ts');
export const Player = await load('engine/entity/Player.ts');
export const ScriptRunner = await load('engine/script/ScriptRunner.ts');
export const ScriptState = await load('engine/script/ScriptState.ts');
export const ScriptProvider = await load('engine/script/ScriptProvider.ts');
export const JavaRandom = await load('util/JavaRandom.ts');
const OpLoc = await load('network/game/client/model/OpLoc.ts');
const OpLocHandler = await load('network/game/client/handler/OpLocHandler.ts');
export const { PlayerStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const map = await import(pathToFileURL(path.join(engine, 'src/engine/GameMap.ts')).href);
export const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'Component', 'FontType']) {
  types[name] = await load(`cache/config/${name}.ts`);
  types[name].load(path.join(engine, 'data/pack'));
}
(await load('cache/config/DbTableIndex.ts')).init();
assert(ScriptProvider.load(path.join(engine, 'data/pack')) > 0);
World.currentTick = 100;
World.gameMap.init();
export function id(kind, name) {
  const value = types[kind].getId(name);
  assert(value >= 0, `packed ${kind}: ${name}`);
  return value;
}
export const inv = id('InvType', 'inv');
export const actionDelay = id('VarPlayerType', 'action_delay');
export const param = (type, name) => type.params.get(id('ParamType', name));
const handler = new OpLocHandler();
export const placements = new Map();
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
export function approach(loc) {
  const type = types.LocType.get(loc.type);
  for (let radius = 1; radius <= 3; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const x = loc.x + dx, z = loc.z + dz;
        if (!map.isMapBlocked(x, z, loc.level) && map.reachedLoc(loc.level, x, z, loc.x, loc.z, type.width, type.length, 1, loc.angle, loc.shape, type.forceapproach)) return [x, z];
      }
    }
  }
  return null;
}
export function native(name) {
  const type = id('LocType', name);
  for (const tile of placements.get(type) ?? []) {
    const loc = World.getLoc(tile.x, tile.z, tile.level, type);
    if (loc && approach(loc)) return loc;
  }
  assert.fail(`${name}: original packed placement with a walkable approach`);
}
let serial = 0;
export function player(loc, level = 99, pickaxe = 'bronze_pickaxe') {
  const p = new Player(`quarrytest${++serial}`, BigInt(serial), BigInt(serial));
  p.pid = p.slot = p.uid = serial;
  p.vars.fill(0);
  p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(100000);
  p.baseLevels[PlayerStat.MINING] = p.levels[PlayerStat.MINING] = level;
  p.setVar(id('VarPlayerType', 'tutorial'), 1000);
  p.level = loc.level;
  [p.x, p.z] = approach(loc);
  p.originX = p.x; p.originZ = p.z;
  p.messages = [];
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = text => p.messages.push(String(text));
  if (pickaxe) p.invAdd(inv, id('ObjType', pickaxe), 1);
  return p;
}
export function dispatch(p, loc, option) {
  assert.equal(handler.handle(new OpLoc(option, loc.x, loc.z, loc.type), p), true);
  assert.equal(p.target, loc);
  assert.equal(p.getApTrigger(), null);
  return p.getOpTrigger();
}
export function execute(p, loc, option) {
  return executeScript(dispatch(p, loc, option), p, loc);
}
export function continueMining(p, loc) {
  assert.equal(p.target, loc, 'published p_oploc retains the native target');
  return executeScript(p.getOpTrigger(), p, loc);
}
function executeScript(script, p, loc) {
  assert(script, `${types.LocType.get(loc.type).debugname}: native loc trigger dispatch`);
  const state = ScriptRunner.init(script, p, loc);
  let execution = p.runScript(state, true, true);
  for (let boundary = 0; execution === ScriptState.SUSPENDED && boundary < 8; boundary++) {
    World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
    p.delayed = false;
    execution = p.runScript(state, true, true);
  }
  assert([ScriptState.FINISHED, ScriptState.PAUSEBUTTON].includes(execution), `${script.name}: finishes or presents the native refusal dialogue`);
  return { script, state, execution };
}
export function restore(loc) {
  if (loc.isChanged()) World.revertLoc(loc);
}
export function runProc(name, p, loc, args = []) {
  const script = ScriptProvider.getByName(`[proc,${name}]`);
  assert(script, name);
  const state = ScriptRunner.init(script, p, loc, args);
  assert.equal(p.runScript(state, true, true), ScriptState.FINISHED, name);
  return state;
}
