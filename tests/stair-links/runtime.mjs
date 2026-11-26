import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const load = async rel => (await import(pathToFileURL(path.join(engine, 'src', rel)).href)).default;
export const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
export const map = await import(pathToFileURL(path.join(engine, 'src/engine/GameMap.ts')).href);
export const { CollisionType } = await import(pathToFileURL(path.join(engine, 'src/engine/routefinder/index.ts')).href);
export const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType', 'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType']) {
  types[name] = await load(`cache/config/${name}.ts`);
  types[name].load(path.join(engine, 'data/pack'));
}
(await load('cache/config/DbTableIndex.ts')).init();
assert.ok(ScriptProvider.load(path.join(engine, 'data/pack')) > 0, 'a complete packed world is required');
World.currentTick = 100;
World.gameMap.init();

export const tile = p => [p.level, p.x, p.z];
export function locFor(row) {
  const loc = World.getLoc(row.x, row.z, row.level, types.LocType.getId(row.name));
  assert.ok(loc, `native packed placement missing: ${row.name} ${row.coord}`);
  assert.equal(loc.angle, row.angle, 'packed rotation agrees with source map');
  return loc;
}
export function reachable(at, row) {
  const type = types.LocType.get(types.LocType.getId(row.name));
  return at[0] === row.level && map.reachedLoc(at[0], at[1], at[2], row.x, row.z, type.width, type.length, 1, row.angle, row.shape, type.forceapproach);
}
export function approach(row) {
  const candidates = [];
  for (let x = row.x - 5; x <= row.x + 5; x++) {
    for (let z = row.z - 5; z <= row.z + 5; z++) {
      const at = [row.level, x, z];
      if (!map.isMapBlocked(x, z, row.level) && reachable(at, row)) candidates.push(at);
    }
  }
  candidates.sort((a, b) => Math.abs(a[1] - row.x) + Math.abs(a[2] - row.z) - Math.abs(b[1] - row.x) - Math.abs(b[2] - row.z) || a[1] - b[1] || a[2] - b[2]);
  assert.ok(candidates.length, `walkable native approach required: ${row.name} ${row.coord}`);
  return candidates[0];
}
let serial = 0;
export function execute(row, choice = null, start = approach(row)) {
  const slot = ++serial;
  const p = new Player(`stairs_${slot}`, BigInt(slot), BigInt(slot));
  p.slot = slot; p.pid = slot; p.uid = slot;
  p.vars.fill(0);
  for (const [name, value] of Object.entries(row.varbits ?? {})) {
    const id = types.VarBitType.getId(name);
    assert.notEqual(id, -1, `fixture varbit exists: ${name}`);
    p.setVarBit(id, value);
  }
  [p.level, p.x, p.z] = start;
  const messages = [];
  p.messageGame = text => messages.push(text);
  const name = `[${row.trigger},${row.name}]`;
  const script = ScriptProvider.getByName(name);
  assert.ok(script, `missing packed trigger ${name}`);
  const state = ScriptRunner.init(script, p, locFor(row));
  let result = p.runScript(state, true, true);
  let pauses = 0;
  for (let boundaries = 0; boundaries < 12 && result !== ScriptState.FINISHED; boundaries++) {
    if (result === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
    } else if (result === ScriptState.PAUSEBUTTON) {
      assert.equal(p.modalChat, types.Component.getId('multi2'), `${name}: only the real two-way staircase menu may pause`);
      assert.ok(choice === 1 || choice === 2, `${name}: explicit up/down choice required`);
      const component = types.Component.getId(`multi2:com_${choice}`);
      assert.ok(p.resumeButtons.includes(component), `${name}: choice is an offered button`);
      p.lastCom = component;
      pauses++;
    } else {
      assert.fail(`${name}: unexpected interpreter boundary ${result}`);
    }
    result = p.runScript(state, true, true);
  }
  assert.equal(result, ScriptState.FINISHED, `${name}: packed execution finishes`);
  return { start, destination: tile(p), messages, pauses };
}
