#!/usr/bin/env node
// Packed production VM, original map placements and real item-use dispatch. No server.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  engine, World, Player, Npc, ScriptProvider, ScriptRunner, ScriptState,
  ServerTriggerType, types, map, nativeNpcRows, nativeLocRows, locFor, walkable
} from '../regicide-travel/runtime.mjs';
const load = async relative => (await import(pathToFileURL(path.join(engine, 'src', relative)).href)).default;
const ScriptPointer = await load('engine/script/ScriptPointer.ts');
const Environment = await load('util/Environment.ts');
const OpHeldU = await load('network/game/client/model/OpHeldU.ts');
const OpHeldUHandler = await load('network/game/client/handler/OpHeldUHandler.ts');
const route = await import(pathToFileURL(path.join(engine, 'src/engine/routefinder/index.ts')).href);
const { PlayerStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const Packet = await load('io/Packet.ts');
const { PlayerLoading } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerLoading.ts')).href);
Environment.NODE_MEMBERS = true;
Environment.NODE_XPRATE = 1;
const id = (Type, name) => {
  const value = Type.getId(name);
  assert(value >= 0, `packed ${Type.name}: ${name}`);
  return value;
};
const obj = name => id(types.ObjType, name);
const npc = name => id(types.NpcType, name);
const bit = name => id(types.VarBitType, name);
const variable = name => id(types.VarPlayerType, name);
const inv = id(types.InvType, 'inv');
const bank = id(types.InvType, 'bank');
const stage = p => p.getVarBit(bit('handsand_quest'));
const count = (p, name, container = inv) => p.invTotal(container, obj(name));
const add = (p, name, n = 1) => p.invAdd(inv, obj(name), n);
const remove = (p, name) => p.invDel(inv, obj(name), count(p, name));
let serial = 0;
function player(initial = 0) {
  const n = ++serial;
  const p = new Player(`handsandcompiled${n}`, BigInt(n), BigInt(n));
  p.pid = n; p.slot = n; p.uid = (n << 11) | n; p.isActive = true;
  p.level = 0; p.x = 2598; p.z = 3086;
  p.vars.fill(0); p.setVarBit(bit('handsand_quest'), initial);
  p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(130344310);
  p.packets = []; p.messages = [];
  p.write = packet => p.packets.push(packet);
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = p.messageGame;
  p.getInventory(inv); p.getInventory(bank);
  World.players[p.slot] = p;
  World.playerLoop.add(p.hash64, p);
  return p;
}
function actor(name) {
  const child = types.NpcType.get(npc(name));
  const parent = types.NpcType.configs.find(type => type && (type.id === child.id || type.multinpc?.includes(child.id)) && nativeNpcRows(type.debugname).length);
  if (parent) {
    const row = nativeNpcRows(parent.debugname)[0];
    const original = [...World.npcs].find(n => n.type === parent.id && n.x === row.x && n.z === row.z && n.level === row.level);
    assert(original, `original map NPC ${name} is loaded`);
    return original;
  }
  const summoned = [...World.npcs].find(n => n.type === child.id);
  assert(summoned, `${name} is summoned by the real bell script`);
  return summoned;
}
function finish(p, state, choices = []) {
  for (let steps = 0; state.execution !== ScriptState.FINISHED && steps < 300; steps++) {
    if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
    } else {
      assert.equal(state.execution, ScriptState.PAUSEBUTTON, `${state.script.name} has a supported visible pause`);
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      if (/^multi[2-5]$/.test(root)) {
        assert(choices.length, `choice required in ${state.script.name}`);
        p.lastCom = id(types.Component, `${root}:com_${choices.shift()}`);
        assert(p.resumeButtons.includes(p.lastCom), 'selected option is offered');
      }
    }
    p.executeScript(state, true, true);
    assert.notEqual(state.execution, ScriptState.ABORTED, 'script never aborts');
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'bounded compiled script completes');
  assert.equal(choices.length, 0, 'all supplied choices were used');
  p.closeModal();
}
function run(p, name, target = null, args = [], choices = []) {
  const script = ScriptProvider.getByName(name);
  assert(script, `packed handler ${name}`);
  const state = ScriptRunner.init(script, p, target, args);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  p.executeScript(state, true, true);
  finish(p, state, [...choices]);
  return state.intStack.slice(0, state.isp);
}
function talk(p, name, choices = []) {
  const target = actor(name);
  const type = types.NpcType.get(target.type);
  if (type.multinpc?.length) {
    const selector = type.multivarbit >= 0 ? p.getVarBit(type.multivarbit) : p.getVar(type.multivarp);
    assert.equal(type.multinpc[selector], npc(name), 'dispatch uses the actual visible form');
  }
  const selected = ScriptProvider.getByTriggerSpecific(ServerTriggerType.OPNPC1, npc(name));
  assert.equal(selected?.name, `[opnpc1,${name}]`, 'production dispatcher resolves visible talk form');
  run(p, selected.name, target, [], choices);
}
function held(p, name) {
  const selected = ScriptProvider.getByTriggerSpecific(ServerTriggerType.OPHELD1, obj(name));
  assert(selected, `held action ${name}`);
  p.lastItem = obj(name);
  run(p, selected.name);
}
function useLoc(p, baseName, visibleName, item, approach = false) {
  const rows = nativeLocRows(baseName);
  assert(rows.length, `native loc ${baseName}`);
  const target = locFor(rows[0]);
  const selected = ScriptProvider.getByTriggerSpecific(approach ? ServerTriggerType.APLOCU : ServerTriggerType.OPLOCU, id(types.LocType, visibleName));
  assert(selected, `visible use handler ${visibleName}`);
  p.lastUseItem = obj(item);
  run(p, selected.name, target);
}
function useItems(p, targetName, usedName) {
  const inventory = p.getInventory(inv);
  const slot = inventory.items.findIndex(item => item?.id === obj(targetName));
  const useSlot = inventory.items.findIndex(item => item?.id === obj(usedName));
  assert(slot >= 0 && useSlot >= 0, 'both used items are genuinely held');
  const com = types.Component.get(id(types.Component, 'inventory:inv'));
  p.tabs[3] = com.rootLayer;
  p.invListenOnCom(inv, com.id, p.uid);
  const executions = [];
  const execute = p.executeScript;
  p.executeScript = function(state, ...args) { executions.push(state); return execute.call(this, state, ...args); };
  try {
    assert(new OpHeldUHandler().handle(new OpHeldU(obj(targetName), slot, com.id, obj(usedName), useSlot, com.id), p));
  } finally { p.executeScript = execute; }
  assert.equal(executions.length, 1, 'real item-use dispatch starts exactly one script');
  finish(p, executions[0]);
}
function recover(p, item, action) {
  remove(p, item); action();
  assert.equal(count(p, item), 1, `${item} has a real loss recovery path at stage ${stage(p)}`);
}
function pathOut(tile, destination, label) {
  walkable(tile, label);
  walkable(destination, `${label} counterpart`);
  assert(route.findPath(tile[0], tile[1], tile[2], destination[1], destination[2], 1, 1, 1, 0, -1, false, 0, 64, route.CollisionType.NORMAL).length > 0,
    `${label} has a nonempty packed-collision route to its intended area`);
}

// Actual map anchors, never destinations read back from the quest's own constants.
const pitRow = nativeLocRows('handsand_sandpit_anim')[0];
const bellRow = nativeLocRows('zogre_outdoor_bell')[0];
const counterRow = nativeLocRows('handsand_counter_multiloc')[0];
assert(pitRow && bellRow && counterRow);
// Bert's house is behind its original closed door; the scene lands at the public pit.
pathOut([0, 2545, 3100], [pitRow.level, pitRow.x + 1, pitRow.z - 3], 'sandpit scene landing to the pit apron');
pathOut([0, 2598, 3086], [bellRow.level, bellRow.x - 1, bellRow.z], 'summoned wizard to the guild bell');
pathOut([0, 3015, 3259], [0, counterRow.x + 1, counterRow.z + 1], 'inside magic-shop doorway to counter');
pathOut([0, 3018, 3259], [0, 3020, 3259], 'optional Port Sarim teleport to the public street');

// Missing scripts make this suite fail on the original starter implementation.
const p = player();
const bell = locFor(bellRow);
run(p, '[oploc1,zogre_outdoor_bell]', bell);
const wizard = actor('zogre_human_zavistic_rarve');
const teleport = player(8);
add(teleport, 'vial_empty');
teleport.lastUseItem = obj('vial_empty');
run(teleport, '[opnpcu,zogre_human_zavistic_rarve]', wizard);
assert.deepEqual([teleport.level, teleport.x, teleport.z], [0, 3018, 3259]);
assert.equal(count(teleport, 'vial_empty'), 0, 'optional teleport spends the offered vial');
for (const [skill, level] of [[PlayerStat.THIEVING, 16], [PlayerStat.CRAFTING, 48]]) {
  const low = player(); low.levels[skill] = level;
  talk(low, 'handsand_bert'); assert.equal(stage(low), 0, 'prerequisite refuses start');
  assert.equal(count(low, 'handsand_sandyhand'), 0);
}
const full = player();
for (let slot = 0; slot < 28; slot++) full.getInventory(inv).set(slot, { id: obj('spade'), count: 1 });
talk(full, 'handsand_bert', [1]); assert.equal(stage(full), 0, 'full inventory does not start without the evidence');
const lowCaptain = player(1);
lowCaptain.levels[PlayerStat.THIEVING] = 16;
add(lowCaptain, 'beer'); add(lowCaptain, 'handsand_sandyhand');
talk(lowCaptain, 'handsand_guard_captain'); assert.equal(stage(lowCaptain), 1);
assert.equal(count(lowCaptain, 'beer'), 1, 'failed captain requirement does not take beer');
talk(p, 'handsand_bert', [1]); assert.equal(stage(p), 1);
recover(p, 'handsand_sandyhand', () => talk(p, 'handsand_bert'));
talk(p, 'handsand_guard_captain'); assert.equal(stage(p), 1, 'beer is required');
add(p, 'beer'); talk(p, 'handsand_guard_captain'); assert.equal(stage(p), 2);
recover(p, 'handsand_beerhand', () => talk(p, 'handsand_guard_captain'));
talk(p, 'zogre_human_zavistic_rarve'); assert.equal(stage(p), 3);
talk(p, 'handsand_bert'); assert.equal(stage(p), 4);
recover(p, 'handsand_rota_bert', () => talk(p, 'handsand_bert'));
talk(p, 'handsand_sandy0'); assert.equal(stage(p), 5);
const desk = locFor(nativeLocRows('handsand_desk')[0]);
run(p, '[oploc1,handsand_desk]', desk);
recover(p, 'handsand_rota_sandy', () => run(p, '[oploc1,handsand_desk]', desk));
useItems(p, 'handsand_rota_bert', 'handsand_rota_sandy'); assert.equal(stage(p), 6);
talk(p, 'handsand_bert'); assert.equal(stage(p), 7);
recover(p, 'handsand_scroll_magic', () => talk(p, 'handsand_bert'));
talk(p, 'zogre_human_zavistic_rarve'); assert.equal(stage(p), 8);
recover(p, 'handsand_orb_storage', () => talk(p, 'zogre_human_zavistic_rarve'));
add(p, 'vial_empty'); talk(p, 'betty');
recover(p, 'handsand_bottle_water', () => { add(p, 'vial_empty'); talk(p, 'betty'); });
add(p, 'redberries'); useItems(p, 'handsand_bottle_water', 'redberries');
// Loss of an intermediate mixture restarts its recipe with real fresh ingredients.
remove(p, 'handsand_redberry_juice'); add(p, 'vial_empty'); talk(p, 'betty');
add(p, 'redberries'); useItems(p, 'redberries', 'handsand_bottle_water');
assert.equal(count(p, 'handsand_redberry_juice'), 1);
add(p, 'white_berries'); useItems(p, 'handsand_redberry_juice', 'white_berries');
remove(p, 'handsand_pink_dye'); add(p, 'vial_empty'); talk(p, 'betty');
add(p, 'redberries'); useItems(p, 'handsand_bottle_water', 'redberries');
add(p, 'white_berries'); useItems(p, 'white_berries', 'handsand_redberry_juice');
assert.equal(count(p, 'handsand_pink_dye'), 1);
add(p, 'bullseye_lantern_lens'); useItems(p, 'bullseye_lantern_lens', 'handsand_pink_dye');
remove(p, 'handsand_rose_lens'); add(p, 'vial_empty'); talk(p, 'betty');
add(p, 'redberries'); useItems(p, 'redberries', 'handsand_bottle_water');
add(p, 'white_berries'); useItems(p, 'handsand_redberry_juice', 'white_berries');
add(p, 'bullseye_lantern_lens'); useItems(p, 'handsand_pink_dye', 'bullseye_lantern_lens');
talk(p, 'betty'); assert.equal(p.getVarBit(bit('handsand_counter_multi')), 1);
p.x = 3014; p.z = 3259;
useLoc(p, 'handsand_counter_multiloc', 'handsand_counter', 'handsand_rose_lens', true);
assert.equal(stage(p), 8, 'counter requires the doorway, not a convenient adjacent tile');
p.x = 3015;
useLoc(p, 'handsand_counter_multiloc', 'handsand_counter', 'handsand_rose_lens', true);
assert.equal(stage(p), 9);
recover(p, 'handsand_truthserum', () => talk(p, 'betty'));
const sandy = actor('handsand_sandy0');
run(p, '[opnpc3,handsand_sandy0]', sandy);
recover(p, 'handsand_sand', () => run(p, '[opnpc3,handsand_sandy0]', sandy));
talk(p, 'betty'); assert.equal(stage(p), 10);
recover(p, 'handsand_truthserum', () => talk(p, 'betty'));
useLoc(p, 'handsand_coffee_multiloc', 'handsand_coffee', 'handsand_truthserum');
assert.equal(stage(p), 10, 'undistracted coffee is protected');
const rightDistraction = p.getVarBit(bit('handsand_serum')) - 3;
talk(p, 'handsand_sandy0', [rightDistraction % 3 + 1]);
assert.equal(p.getVarBit(bit('handsand_sandy_multi')), 0, 'wrong distraction does not open coffee');
talk(p, 'handsand_sandy0', [rightDistraction]);
assert.equal(p.getVarBit(bit('handsand_sandy_multi')), 1);
run(p, '[timer,handsand_attention]');
assert.equal(p.getVarBit(bit('handsand_sandy_multi')), 0, 'attention timeout closes the window');
talk(p, 'handsand_sandy0', [rightDistraction]);
useLoc(p, 'handsand_coffee_multiloc', 'handsand_coffee', 'handsand_truthserum');
assert.equal(stage(p), 11); assert.equal(count(p, 'handsand_truthserum'), 0);
held(p, 'handsand_orb_storage');
recover(p, 'handsand_orb_recording', () => { talk(p, 'zogre_human_zavistic_rarve'); held(p, 'handsand_orb_storage'); });
for (const question of [1, 2]) { talk(p, 'handsand_sandy0', [question]); assert.equal(stage(p), 11); }
talk(p, 'handsand_sandy0', [3]); assert.equal(stage(p), 12);
recover(p, 'handsand_orb_recording', () => { talk(p, 'zogre_human_zavistic_rarve'); held(p, 'handsand_orb_storage'); });
talk(p, 'zogre_human_zavistic_rarve'); assert.equal(stage(p), 12, 'spell requires ingredients');
add(p, 'earthrune', 5); add(p, 'bucket_sand');
p.x = 2598; p.z = 3086;
talk(p, 'zogre_human_zavistic_rarve'); assert.equal(stage(p), 13);
assert.deepEqual([p.level, p.x, p.z], [0, 2598, 3086], 'scene returns to actual guild departure tile');
assert.equal(count(p, 'earthrune'), 0); assert.equal(count(p, 'bucket_sand'), 0);
talk(p, 'handsand_naziom'); assert.equal(stage(p), 14);
recover(p, 'handsand_wizhead', () => talk(p, 'handsand_naziom'));
const beforeXp = [p.stats[PlayerStat.THIEVING], p.stats[PlayerStat.CRAFTING]];
talk(p, 'zogre_human_zavistic_rarve'); assert.equal(stage(p), 160);
assert.deepEqual([p.stats[PlayerStat.THIEVING] - beforeXp[0], p.stats[PlayerStat.CRAFTING] - beforeXp[1]], [10000, 90000], 'period XP rewards use tenths');
assert.equal(p.getVar(variable('qp')), 1);
assert(p.packets.some(packet => packet.constructor.name === 'IfSetText' && packet.text?.includes('You have completed The Hand in the Sand!')), 'completion scroll text was sent');
const terminalXp = [...p.stats];
talk(p, 'zogre_human_zavistic_rarve'); assert.deepEqual([...p.stats], terminalXp, 'rewards cannot repeat');
talk(p, 'handsand_bert'); assert.equal(count(p, 'bucket_sand', bank), 84);
const deliveryClock = p.getVar(variable('handsand_last_sand_minutes'));
assert(deliveryClock > 0);
talk(p, 'handsand_bert'); assert.equal(count(p, 'bucket_sand', bank), 84, 'same-day delivery refuses');
p.setVarBit(bit('handsand_sandy_multi'), 1);
const saved = PlayerLoading.load(p.username, new Packet(p.save()), null);
assert.equal(stage(saved), 160, 'earned completion survives normal save/load');
assert.equal(saved.getVar(variable('handsand_last_sand_minutes')), deliveryClock, 'daily lock survives normal save/load');
assert.equal(saved.getVarBit(bit('handsand_sandy_multi')), 0, 'temporary distracted morph never survives logout');
assert.equal(count(saved, 'bucket_sand', bank), 84, 'bank delivery survives save/load');
p.setVar(variable('handsand_last_sand_minutes'), deliveryClock - 1440);
talk(p, 'handsand_bert'); assert.equal(count(p, 'bucket_sand', bank), 168, 'next delivery opens after one day');
const blocked = player(160);
const bankInventory = blocked.getInventory(bank);
for (let slot = 0; slot < bankInventory.capacity; slot++) bankInventory.set(slot, { id: obj('spade'), count: 1 });
talk(blocked, 'handsand_bert');
assert.equal(blocked.getVar(variable('handsand_last_sand_minutes')), 0, 'full bank does not spend daily delivery');

// Both native item orders preserve ordinary recipes during the quest.
for (const reverse of [false, true]) {
  const ordinary = player(8); ordinary.setVar(variable('druidquest'), 4);
  add(ordinary, 'redberries'); add(ordinary, 'pie_shell');
  useItems(ordinary, reverse ? 'redberries' : 'pie_shell', reverse ? 'pie_shell' : 'redberries');
  assert.equal(count(ordinary, 'uncooked_redberry_pie'), 1, 'redberry pie remains available');
  add(ordinary, 'white_berries'); add(ordinary, 'ranarrvial');
  useItems(ordinary, reverse ? 'white_berries' : 'ranarrvial', reverse ? 'ranarrvial' : 'white_berries');
  assert.equal(count(ordinary, '3dose1defense'), 1, 'Herblore defence potion remains available');
}
for (const outside of [0, 160]) {
  const shop = player(outside);
  talk(shop, 'betty', [2]);
  assert(shop.packets.some(packet => packet.text?.includes('Welcome to the magic emporium.')), 'Betty normal dialogue survives outside quest task');
}
for (const name of ['handsand_sandyhand', 'handsand_beerhand', 'handsand_rota_bert', 'handsand_rota_sandy', 'handsand_scroll_magic', 'handsand_orb_storage', 'handsand_orb_recording', 'handsand_truthserum', 'handsand_bottle_water', 'handsand_redberry_juice', 'handsand_pink_dye', 'handsand_rose_lens', 'handsand_wizhead', 'handsand_sand']) {
  assert.equal(types.ObjType.get(obj(name)).tradeable, false, `${name} is private and untradeable`);
}
assert.equal(types.VarPlayerType.get(variable('handsand_last_sand_minutes')).scope, 1, 'daily clock persists');
console.log('PASS Hand in the Sand: native dispatch, full quest, recovery, rewards, packed routes and daily sand');
process.exit(0);
