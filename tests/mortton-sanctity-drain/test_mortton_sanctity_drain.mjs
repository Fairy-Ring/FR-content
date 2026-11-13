/**
 * Real packed wall and shade-death scripts, followed by Player.processTimers.
 * No server is started. Run from the sibling engine after npm run build:
 * node --import tsx ../content/tests/mortton-sanctity-drain/test_mortton_sanctity_drain.mjs
 * The amount/interval are regression expectations, not verified period facts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT, '../engine');
const PACK = path.join(ENGINE, 'data/pack');
const load = async rel => (await import(pathToFileURL(path.join(ENGINE, rel)).href)).default;
const World = await load('src/engine/World.ts');
const Player = await load('src/engine/entity/Player.ts');
const Npc = await load('src/engine/entity/Npc.ts');
const ScriptProvider = await load('src/engine/script/ScriptProvider.ts');
const ScriptRunner = await load('src/engine/script/ScriptRunner.ts');
const ScriptState = await load('src/engine/script/ScriptState.ts');
const { EntityLifeCycle } = await import(pathToFileURL(path.join(ENGINE, 'src/engine/entity/EntityLifeCycle.ts')).href);
const { PlayerStat } = await import(pathToFileURL(path.join(ENGINE, 'src/engine/entity/PlayerStat.ts')).href);
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType', 'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType']) {
  types[name] = await load(`src/cache/config/${name}.ts`);
  types[name].load(PACK);
}
(await load('src/cache/config/DbTableIndex.ts')).init();
assert.ok(ScriptProvider.load(PACK) > 0);
// Match World.reload's shared-variable initialization without starting a world.
const ScriptVarType = await load('src/cache/config/ScriptVarType.ts');
World.vars = Int32Array.from({ length: types.VarSharedType.count }, (_, i) =>
  types.VarSharedType.get(i).type === ScriptVarType.INT ? 0 : -1);
World.varsString = new Array(types.VarSharedType.count);
World.currentTick = 100;
World.gameMap.init();
const packMaps = new Map();
function id(kind, name) {
  if (!packMaps.has(kind)) packMaps.set(kind, new Map(fs.readFileSync(path.join(CONTENT, 'pack', `${kind}.pack`), 'utf8').trim().split(/\r?\n/).map(line => {
    const at = line.indexOf('='); return [line.slice(at + 1), Number(line.slice(0, at))];
  })));
  const result = packMaps.get(kind).get(name);
  assert.notEqual(result, undefined, `missing ${kind} ${name}`);
  return result;
}
function script(name) {
  const result = ScriptProvider.getByName(name);
  assert.ok(result, `missing compiled ${name}`);
  return result;
}
const timerScript = script('[timer,sanctity_drain]');
const varId = name => types.VarPlayerType.getId(name);
const get = (player, name) => player.getVar(varId(name));
const set = (player, name, value) => player.setVar(varId(name), value);
let serial = 0;
function fixture() {
  const slot = ++serial;
  const p = new Player(`mortton_drain_${slot}`, BigInt(slot), BigInt(1000 + slot));
  p.slot = slot; p.pid = slot; p.uid = (slot << 11) | slot;
  p.vars.fill(0); p.stats.fill(130344310); p.baseLevels.fill(99); p.levels.fill(99);
  p.baseLevels[PlayerStat.CRAFTING] = 20; p.levels[PlayerStat.CRAFTING] = 20;
  p.level = 0; p.x = 3505; p.z = 3315; p.lastMovement = 0;
  p.write = () => {}; p.messageGame = () => {}; p.wrappedMessageGame = () => {};
  World.players[slot] = p; World.playerLoop.add(p.hash64, p);
  set(p, 'morttonquest', 50); // own prerequisite only
  const inv = p.getInventory(types.InvType.getId('inv'));
  for (const [name, qty] of [['hammer', 1], ['woodplank', 2], ['limestonebrick', 2], ['swamppaste', 10]]) inv.add(id('obj', name), qty);
  assert.equal(get(p, 'temple_sanctity'), 0);
  assert.equal(p.timers.has(timerScript.id), false);
  return p;
}
function wallRaise(p) {
  const wall = World.getLoc(3504, 3315, 0, id('loc', 'templewall_base'));
  assert.ok(wall, 'real packed west temple wall missing');
  // OPLOC1 schedules the ordinary three-tick repeat; OPLOC3 executes the build.
  let state = ScriptRunner.init(script('[oploc1,_flamtaer_wall]'), p, wall);
  assert.equal(p.runScript(state, true, true), ScriptState.FINISHED);
  World.currentTick = get(p, 'action_delay');
  state = ScriptRunner.init(script('[oploc3,_flamtaer_wall]'), p, wall);
  assert.equal(p.runScript(state, true, true), ScriptState.FINISHED);
  p.stopAction();
}
function shadeRaise(p) {
  const type = id('npc', 'shade_level1');
  const npc = new Npc(0, p.x + 1, p.z, 1, 1, EntityLifeCycle.RESPAWN, 100 + serial, type, types.NpcType.get(type).blockwalk);
  npc.heroPoints.addHero(p.hash64, 10);
  npc.setVar(id('varn', 'npc_aggressive_player'), p.uid);
  const state = ScriptRunner.init(script('[ai_queue3,shade_level1]'), p, npc);
  let result = p.runScript(state, true, true);
  for (let count = 0; result === ScriptState.NPC_SUSPENDED && count < 10; count++) {
    npc.executeScript(state); result = state.execution;
  }
  assert.equal(result, ScriptState.FINISHED, 'real shade-death script completes');
}
const failures = [];
for (const [label, raise] of [['wall', wallRaise], ['shade', shadeRaise]]) {
  try {
    World.currentTick = 1000 + serial * 1000;
    const p = fixture();
    raise(p);
    const first = get(p, 'temple_sanctity');
    assert.ok(first > 0, `${label}: positive control: product raises sanctity`);
    if (label === 'shade') assert.equal(first, 60);
    let timer = p.timers.get(timerScript.id);
    assert.ok(timer, `${label}: absent sanctity_drain timer must start after product raise`);
    assert.equal(timer.interval, 100);
    assert.equal(timer.type, 0, 'PlayerTimerType.NORMAL');
    const firstClock = timer.clock;
    World.currentTick = firstClock + 25;
    raise(p);
    const second = get(p, 'temple_sanctity');
    assert.ok(second > first, `${label}: second positive product write`);
    assert.equal(p.timers.get(timerScript.id).clock, firstClock, `${label}: second raise must not reset running timer`);
    World.currentTick = firstClock + 99;
    p.processTimers(0);
    assert.equal(get(p, 'temple_sanctity'), second, `${label}: no early drain`);
    World.currentTick++;
    p.processTimers(0);
    assert.equal(get(p, 'temple_sanctity'), Math.max(0, second - 30), `${label}: real timer script drains 30`);
    assert.equal(get(p, 'temple_sanctity_p'), Math.floor(Math.max(0, second - 30) / 30), `${label}: percentage follows raw`);
    assert.equal(p.timers.get(timerScript.id).clock, firstClock + 100);
    let previous = get(p, 'temple_sanctity');
    while (previous > 0) {
      World.currentTick += 100; p.processTimers(0);
      const now = get(p, 'temple_sanctity');
      assert.equal(now, Math.max(0, previous - 30)); previous = now;
    }
    World.currentTick += 300; p.processTimers(0);
    assert.equal(get(p, 'temple_sanctity'), 0, `${label}: zero floor remains stable`);
    assert.equal(get(p, 'temple_sanctity_p'), 0);
    timer = p.timers.get(timerScript.id);
    assert.ok(timer, `${label}: inherited timer remains installed at zero`);
    console.log(`PASS ${label}: product raise, timer install, second-raise clock preservation, 100-tick drain, percentage and zero floor`);
  } catch (error) { failures.push(error); console.error(error); }
}
assert.equal(failures.length, 0, `${failures.length} compiled Mortton drain case(s) failed`);
console.log('RESULT PASS mortton-sanctity-drain (both production callers; no server started)');
process.exit(0);
