/**
 * Run the packed rowboat journeys without starting a world server.
 * From the sibling engine after npm run build:
 * node --import tsx ../content/tests/rowboat/test_rowboat.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = async rel => (await import(pathToFileURL(path.join(engine, 'src', rel)).href)).default;
const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType', 'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType']) {
  types[name] = await load(`cache/config/${name}.ts`);
  types[name].load(pack);
}
(await load('cache/config/DbTableIndex.ts')).init();
assert.ok(ScriptProvider.load(pack) > 0, 'a full compiled content pack is required');
World.currentTick = 100;
World.gameMap.init();
const quest = types.VarPlayerType.getId('routequest');
assert.ok(quest >= 0);
const invType = types.InvType.getId('inv');
const coins = types.ObjType.getId('coins');
assert.ok(invType >= 0 && coins >= 0);
const mortton = World.getLoc(3523, 3284, 0, types.LocType.getId('route_rowboat_mortton'));
const hollows = World.getLoc(3498, 3377, 0, types.LocType.getId('route_rowboat_hollows'));
assert.ok(mortton && hollows, 'both native boats exist in the packed maps');
let serial = 0;
function fixture(stage, returning = false) {
  const slot = ++serial;
  const p = new Player(`rowboat_${slot}`, BigInt(slot), BigInt(slot));
  p.slot = slot; p.pid = slot; p.uid = slot;
  p.vars.fill(0);
  p.level = 0; p.x = returning ? 3498 : 3522; p.z = returning ? 3380 : 3284;
  p.setVar(quest, stage); // fixture input only, never the journey result
  p.getInventory(invType).add(coins, 10);
  return p;
}
function journey(p, name, target = null) {
  const script = ScriptProvider.getByName(name);
  assert.ok(script, `missing packed ${name}`);
  const state = ScriptRunner.init(script, p, target);
  let result = p.runScript(state, true, true);
  assert.equal(result, ScriptState.SUSPENDED, `${name}: real boat delay starts`);
  assert.equal(p.delayedUntil, World.currentTick + 14, `${name}: thirteen-tick boat delay`);
  World.currentTick = p.delayedUntil;
  p.delayed = false;
  result = p.runScript(state, true, true);
  if (result === ScriptState.PAUSEBUTTON) {
    // The outward arrival mesbox has a Continue, not another game action.
    result = p.runScript(state, true, true);
  }
  assert.equal(result, ScriptState.FINISHED, `${name}: journey finishes without script abort`);
}
const failures = [];
let passed = 0;
function check(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, message: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
const stages = [20, ...Array.from({ length: 76 }, (_, i) => 25 + i), 105];
for (const stage of stages) {
  for (const entry of ['[label,travel_to_hollow]', '[oploc2,route_rowboat_mortton]']) {
    check(`${entry} stage ${stage}`, () => {
      const p = fixture(stage);
      journey(p, entry, entry.startsWith('[oploc') ? mortton : null);
      assert.deepEqual([p.x, p.z, p.level], [3498, 3380, 0], 'outward destination');
      if (entry.startsWith('[oploc')) assert.equal(p.getInventory(invType).getItemCount(coins), 0, 'native paid op consumes ten coins');
      assert.equal(p.getVar(quest), stage === 20 ? 25 : stage, `quest must advance 20 to 25, never lower stage ${stage}`);
    });
  }
}
for (const stage of stages.filter(value => value >= 25)) {
  check(`return stage ${stage}`, () => {
    const p = fixture(stage, true);
    journey(p, '[oploc1,route_rowboat_hollows]', hollows);
    assert.deepEqual([p.x, p.z, p.level], [3522, 3284, 0], 'return destination');
    assert.equal(p.getVar(quest), stage, 'return keeps quest stage');
    assert.equal(p.getInventory(invType).getItemCount(coins), 10, 'return remains free');
  });
}
console.log(`RESULT ${failures.length ? 'FAIL' : 'PASS'} rowboat: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
