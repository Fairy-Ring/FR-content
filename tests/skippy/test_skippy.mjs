/** Compiled Skippy sequence, real NPC dispatch, payment, save/load and Slayer gates. No server. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = relative => import(pathToFileURL(path.join(engine, 'src', relative)).href);
const World = (await load('engine/World.ts')).default;
const { NetworkPlayer } = await load('engine/entity/NetworkPlayer.ts');
const Npc = (await load('engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await load('engine/entity/EntityLifeCycle.ts');
const { PlayerLoading } = await load('engine/entity/PlayerLoading.ts');
const Packet = (await load('io/Packet.ts')).default;
const ScriptProvider = (await load('engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('engine/script/ScriptState.ts')).default;
const Trigger = (await load('engine/script/ServerTriggerType.ts')).default;
const PauseHandler = (await load('network/game/client/handler/ResumePauseButtonHandler.ts')).default;
const ResumePauseButton = (await load('network/game/client/model/ResumePauseButton.ts')).default;
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType',
  'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType',
  'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'Component', 'FontType']) {
  types[name] = (await load(`cache/config/${name}.ts`)).default;
  types[name].load(pack);
}
(await load('cache/config/DbTableIndex.ts')).default.init();
assert(ScriptProvider.load(pack) > 0, 'build the sibling pack first');
const id = (kind, name) => { const value = types[kind].getId(name); assert(value >= 0, `${kind}:${name}`); return value; };
const inv = id('InvType', 'inv');
const bit = id('VarBitType', 'skippy_state');
const root = id('NpcType', 'multi_skippy');
const base = id('VarPlayerType', 'rimmington_extras_var');
const pause = new PauseHandler();
const count = (p, name) => p.invTotal(inv, id('ObjType', name));
let serial = 0;
function player(saved = null) {
  const p = saved ? PlayerLoading.load('skippy_test', new Packet(saved), null) :
    new NetworkPlayer('skippy_test', 0n, 0n, { uuid: 'offline-skippy-fixture' });
  p.uid = ++serial; p.pid = serial; p.x = 2982; p.z = 3196; p.level = 0;
  p.baseLevels.fill(99); p.levels.fill(99);
  p.buildArea.originX = 2900; p.buildArea.originZ = 3100;
  p.packets = []; p.write = message => p.packets.push(message); // Transport capture only.
  return p;
}
function npc(type = root) {
  const t = types.NpcType.get(type);
  const n = new Npc(0, 2983, 3196, t.size, t.size, EntityLifeCycle.RESPAWN, 1, type, t.blockwalk);
  n.isActive = true; n.lastMovement = -100;
  return n;
}
function start(p, op, item = null, type = root) {
  const n = npc(type);
  p.target = n; p.targetOp = op - 7;
  if (item) { p.lastUseItem = id('ObjType', item); p.lastUseSlot = p.getInventory(inv).getItemIndex(p.lastUseItem); }
  const script = p.getOpTrigger();
  assert(script, `production dispatch ${op} at stage ${p.getVarBit(bit)}`);
  assert(script.name.includes('skippy'), `expected Skippy handler, got ${script.name}`);
  const state = ScriptRunner.init(script, p, n);
  p.executeScript(state, true);
  return state;
}
function finish(p, state, choices = []) {
  for (let steps = 0; state.execution !== ScriptState.FINISHED && steps < 200; steps++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, 'compiled script abort');
    if (state.execution === ScriptState.PAUSEBUTTON) {
      let component = 0;
      if (p.modalChat === id('Component', 'multi2')) {
        assert(choices.length, 'test must specify every menu choice');
        component = id('Component', `multi2:com_${choices.shift()}`);
        p.lastCom = component;
      }
      assert(pause.handle(new ResumePauseButton(component), p));
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false; p.executeScript(state, true, true);
    } else assert.fail(`unexpected suspension ${state.execution}`);
  }
  assert.equal(state.execution, ScriptState.FINISHED);
  assert.equal(choices.length, 0, 'every specified menu choice was reached');
}
function proc(p, name, args = []) {
  const script = ScriptProvider.getByName(`[proc,${name}]`); assert(script, name);
  const state = ScriptRunner.init(script, p, null, args);
  p.executeScript(state, true);
  assert.equal(state.execution, ScriptState.FINISHED);
  return state.intStack[state.isp - 1];
}
const text = p => p.packets.map(m => m.text ?? m.msg ?? '').join(' ').replaceAll('|', ' ').replace(/\s+/g, ' ');
const give = (p, name, amount = 1) => p.invAdd(inv, id('ObjType', name), amount);
const taskConstants = fs.readFileSync(path.join(content, 'scripts/skill_slayer/configs/slayer.constant'), 'utf8');
const mogre = Number(taskConstants.match(/^\^slayer_mogre\s*=\s*(\d+)/m)?.[1]);
assert(Number.isInteger(mogre));
assert.equal(base, 597, 'original client varp, not an appended id');
assert.equal(types.VarPlayerType.get(base).scope, types.VarPlayerType.SCOPE_PERM);
assert.equal(types.VarPlayerType.get(base).transmit, true);
assert.equal(types.VarBitType.get(bit).basevar, base);
assert(fs.readFileSync(path.join(content, 'maps/m46_49.jm2'), 'utf8').includes(`0 39 60: ${root}`), 'real map actor');
for (let stage = 0; stage < 4; stage++) {
  const p = player(); p.setVarBit(bit, stage);
  assert.equal(proc(p, 'slayer_skippy_unlocked'), stage === 3 ? 1 : 0);
  assert.equal(proc(p, 'validate_slayer_target', [mogre]), stage === 3 ? 1 : 0);
  finish(p, start(p, Trigger.OPNPC1), stage === 0 ? [1] : stage === 2 ? [2] : []);
  assert.equal(p.getVarBit(bit), stage, 'Talk-to must not grant progress from carried items');
  const child = types.NpcType.get(root).multinpc[stage];
  assert.equal(child, id('NpcType', ['skippy', 'damp_skippy', 'hungover_skippy', 'sober_skippy'][stage]));
  finish(p, start(p, Trigger.OPNPC1, null, child), stage === 0 ? [1] : stage === 2 ? [2] : []);
}
console.log('PASS original morphs and production Talk-to dispatch; Slayer gate is false at 0/1/2, true only at 3');
const p = player();
p.setVarBit(id('VarBitType', 'aquarium'), 17); // Neighbour bits must survive each stage write.
finish(p, start(p, Trigger.OPNPC3));
assert(text(p).includes('cold water')); assert.equal(p.getVarBit(bit), 0);
give(p, 'bucket_water'); give(p, 'bowl_nettletea'); give(p, 'hangover_cure');
for (const item of ['bowl_nettletea', 'hangover_cure']) {
  finish(p, start(p, Trigger.OPNPCU, item)); assert.equal(count(p, item), 1); assert.equal(p.getVarBit(bit), 0);
}
finish(p, start(p, Trigger.OPNPC3), [2]);
assert.equal(count(p, 'bucket_water'), 1); assert.equal(p.getVarBit(bit), 0);
finish(p, start(p, Trigger.OPNPC3), [1]);
assert.equal(p.getVarBit(bit), 1); assert.equal(count(p, 'bucket_water'), 0); assert.equal(count(p, 'bucket_empty'), 1);
assert(text(p).includes('Nettle for preference. Just make sure it\'s hot.'));
let recovered = player(p.save());
assert.equal(recovered.getVarBit(bit), 1); assert.equal(recovered.getVarBit(id('VarBitType', 'aquarium')), 17);
finish(recovered, start(recovered, Trigger.OPNPCU, 'hangover_cure'));
assert.equal(recovered.getVarBit(bit), 1); assert.equal(count(recovered, 'hangover_cure'), 1);
finish(recovered, start(recovered, Trigger.OPNPCU, 'bowl_nettletea'));
assert.equal(recovered.getVarBit(bit), 2); assert.equal(count(recovered, 'bowl_nettletea'), 0);
assert(text(recovered).includes('Take a bucket of milk, a bar of chocolate and some snape grass.'));
recovered = player(recovered.save()); assert.equal(recovered.getVarBit(bit), 2);
finish(recovered, start(recovered, Trigger.OPNPCU, 'hangover_cure'));
assert.equal(recovered.getVarBit(bit), 3); assert.equal(count(recovered, 'hangover_cure'), 0);
assert(text(recovered).includes('Slayer Masters sell these highly volatile potions'));
assert(text(recovered).includes('head south from here until you find Mudskipper Point.'));
const complete = player(recovered.save());
assert.equal(complete.getVarBit(bit), 3); assert.equal(complete.getVarBit(id('VarBitType', 'aquarium')), 17);
assert.equal(proc(complete, 'validate_slayer_target', [mogre]), 1);
give(complete, 'bucket_water'); give(complete, 'bowl_nettletea'); give(complete, 'hangover_cure');
for (const item of ['bucket_water', 'bowl_nettletea', 'hangover_cure']) {
  finish(complete, start(complete, Trigger.OPNPCU, item)); assert.equal(count(complete, item), 1);
}
finish(complete, start(complete, Trigger.OPNPC3));
finish(complete, start(complete, Trigger.OPNPC1));
assert(text(complete).includes('Go south to Mudskipper Point and lob a Fishing Explosive into the sea.'));
assert.equal(complete.getVarBit(bit), 3);
console.log('PASS ordered exact payments, refusal, persistent stages, neighbour-bit preservation, completion and repeat instructions');
const known = player(); known.setVarBit(bit, 1); give(known, 'bowl_nettletea');
const questText = fs.readFileSync(path.join(content, 'scripts/quests/quest_elena/configs/quest_elena.constant'), 'utf8');
known.setVar(id('VarPlayerType', 'elenaquest'), Number(questText.match(/^\^quest_elena_spoke_to_bravek\s*=\s*(\d+)/m)[1]));
finish(known, start(known, Trigger.OPNPCU, 'bowl_nettletea'));
assert(text(known).includes('Yes! That\'s the stuff!')); assert.equal(known.getVarBit(bit), 2);
const slayer = 18; // Stable engine PlayerStat index (existing Slayer gate uses stat_base).
complete.baseLevels[slayer] = 31; assert.equal(proc(complete, 'validate_slayer_target', [mogre]), 0);
complete.baseLevels[slayer] = 32; assert.equal(proc(complete, 'validate_slayer_target', [mogre]), 1);
console.log('PASS known hangover recipe branch and existing level-32 Slayer requirement');
console.log('PASS Skippy compiled sequence');
process.exit(0);
