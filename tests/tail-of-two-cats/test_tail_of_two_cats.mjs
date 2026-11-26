#!/usr/bin/env node
// Compiled quest progression, visible-form dispatch, packed-map reachability and shared-service regressions.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  World, Player, Npc, ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType,
  EntityLifeCycle, BlockWalk, types, map, floorTiles, nativeNpcRows, nativeLocRows,
  locFor, engine, requiredId, ResumePauseButtonHandler, ResumePauseButton
} from '../regicide-travel/runtime.mjs';
const load = async file => import(pathToFileURL(path.join(engine, 'src', file)).href);
const { PlayerStat } = await load('engine/entity/PlayerStat.ts');
const { ActiveRegion } = await load('engine/script/ScriptPointer.ts');
const IfButton = (await load('network/game/client/model/IfButton.ts')).default;
const buttons = new (await load('network/game/client/handler/IfButtonHandler.ts')).default();
const pauses = new ResumePauseButtonHandler();
assert.equal((await load('util/Environment.ts')).default.NODE_XPRATE, 1);
// This map fixture omits World.start's shared-var allocation.
World.vars = new Int32Array(types.VarSharedType.count);
const id = (kind, name) => requiredId(types[kind], name);
const obj = name => id('ObjType', name);
const inv = id('InvType', 'inv'), worn = id('InvType', 'worn'), bank = id('InvType', 'bank');
const v = name => id('VarPlayerType', name), b = name => id('VarBitType', name);
const stage = p => p.getVarBit(b('twocats_quest'));
const bit = (p, name) => p.getVarBit(b(`twocats_chores_${name}`));
const count = (p, name, inventory = inv) => p.invTotal(inventory, obj(name));
const add = (p, name, amount = 1, inventory = inv) => p.invAdd(inventory, obj(name), amount);
const drop = (p, name, inventory = inv) => p.invDel(inventory, obj(name), count(p, name, inventory));
const tile = p => [p.level, p.x, p.z];
const unpack = packed => [(packed >>> 14) & 0x3fff, packed & 0x3fff];
let serial = 0;
function player({ qualified = true, cat = true, amulet = true } = {}) {
  const n = ++serial;
  const p = new Player(`twocat${n}`, BigInt(n), BigInt(n));
  p.pid = n; p.slot = n; p.uid = ((n << 11) | n) >>> 0;
  p.level = 0; p.x = 2918; p.z = 3555; p.isActive = true;
  p.vars.fill(0); p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(1000000);
  p.setVar(v('tutorial'), 1000); p.setVar(v('fluffs'), 6);
  p.setVar(v('druidquest'), 4); p.setVar(v('runemysteries'), 6);
  p.setVarBit(b('ics_little_var'), qualified ? 26 : 0);
  p.packets = []; p.messages = [];
  p.write = packet => p.packets.push(packet);
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = text => p.messages.push(String(text));
  World.players[n] = p; World.playerLoop.add(BigInt(n), p);
  for (const [inventory, component, tab] of [[inv, 'inventory:inv', 3], [worn, 'wornitems:worn', 4]]) {
    const com = id('Component', component);
    p.tabs[tab] = types.Component.get(com).rootLayer;
    p.invListenOnCom(inventory, com, p.uid);
  }
  if (cat) run(p, '[proc,cat_spawn]', [id('NpcType', 'kittenpet1')]);
  if (amulet) add(p, 'ics_little_amulet_of_catspeak', 1, worn);
  return p;
}
function run(p, name, args = [], target = null, choices = []) {
  const script = ScriptProvider.getByName(name); assert(script, name);
  const state = ScriptRunner.init(script, p, target, args);
  p.executeScript(state, true, true);
  finish(p, state, choices);
  return state;
}
function finish(p, state, choices = [], stopAt = null) {
  const remaining = [...choices];
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 240; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, 'compiled script does not abort');
    if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false; p.executeScript(state, true, true);
    } else {
      assert.equal(state.execution, ScriptState.PAUSEBUTTON, `unexpected boundary ${state.execution}`);
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      if (root === stopAt) return;
      if (/^multi[2-5]$/.test(root)) {
        assert(remaining.length, `explicit choice required in ${root}`);
        assert(buttons.handle(new IfButton(id('Component', `${root}:com_${remaining.shift()}`)), p));
      } else assert(pauses.handle(new ResumePauseButton(0), p));
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'interaction finishes');
  assert.equal(remaining.length, 0, 'all specified choices were offered');
}
function button(p, name) { assert(buttons.handle(new IfButton(id('Component', name)), p), name); }
function escape(at, label) {
  const [level, x, z] = at;
  assert(!map.isMapBlocked(x, z, level), `${label}: walkable arrival`);
  for (let radius = 2; radius <= 12; radius++) {
    for (const [dx, dz] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
      const tx = x + dx, tz = z + dz;
      if (map.isMapBlocked(tx, tz, level)) continue;
      const route = map.findPath(level, x, z, tx, tz);
      if (route.length && unpack(route.at(-1)).join() === [tx, tz].join()) return;
    }
  }
  assert.fail(`${label}: no nonempty exact findPath route out`);
}
function target(kind, name) {
  const rows = kind === 'npc' ? nativeNpcRows(name) : nativeLocRows(name);
  assert(rows.length, `native map places ${name}`);
  // Prefer Burthorpe for its quest-specific duplicate placements.
  const row = rows.find(row => row.mx === 45 && row.mz === 55) ?? rows[0];
  const entity = kind === 'loc' ? locFor(row) : new Npc(row.level, row.x, row.z, 1, 1,
    EntityLifeCycle.RESPAWN, World.getNextNid(), row.id, BlockWalk.NONE);
  entity.isActive = true;
  const type = types[kind === 'npc' ? 'NpcType' : 'LocType'].get(row.id);
  for (let radius = 2; radius <= 12; radius++) {
    for (let x = row.x - radius; x <= row.x + radius; x++) for (let z = row.z - radius; z <= row.z + radius; z++) {
      if (!floorTiles.has(`${row.level},${x},${z}`) || map.isMapBlocked(x, z, row.level)) continue;
      const route = kind === 'npc'
        ? map.findPathToEntity(row.level, x, z, row.x, row.z, 1, type.size, type.size)
        : map.findPathToLoc(row.level, x, z, row.x, row.z, 1, type.width, type.length, row.angle, row.shape, type.forceapproach);
      if (!route.length) continue;
      const stand = unpack(route.at(-1));
      const reached = kind === 'npc'
        ? map.reachedEntity(row.level, ...stand, row.x, row.z, type.size, type.size, 1)
        : map.reachedLoc(row.level, ...stand, row.x, row.z, type.width, type.length, 1, row.angle, row.shape, type.forceapproach);
      if (reached && !map.isMapBlocked(...stand, row.level)) return { entity, stand: [row.level, ...stand] };
    }
  }
  assert.fail(`no real packed-map approach to ${name}`);
}
const npcs = Object.fromEntries(['twocats_unferth', 'death_woman_indoors1', 'death_growncat_black',
  'twocats_niete', 'ics_little_sphinx', 'gertrude', 'reldo', 'apothecary'].map(name => [name, target('npc', name)]));
const locs = Object.fromEntries(['twocats_bed', 'twocats_fireplace', 'twocats_table', 'twocats_patch',
  'twocats_bookcase'].map(name => [name, target('loc', name)]));
function interact(p, fixture, trigger, item = null, choices = [], stopAt = null) {
  p.closeModal(); [p.level, p.x, p.z] = fixture.stand; p.originX = p.x; p.originZ = p.z;
  p.target = fixture.entity; p.targetOp = trigger - 7;
  if (item) p.lastUseItem = obj(item);
  const script = p.getOpTrigger(); assert(script, 'production visible-form dispatch');
  const state = ScriptRunner.init(script, p, fixture.entity);
  p.executeScript(state, true, true); finish(p, state, choices, stopAt);
  return script.name;
}
const talk = (p, name, choices = [], stopAt = null) => interact(p, npcs[name], ServerTriggerType.OPNPC1, null, choices, stopAt);
const useLoc = (p, item, name) => interact(p, locs[name], ServerTriggerType.OPLOCU, item);
const useNpc = (p, item, name) => interact(p, npcs[name], ServerTriggerType.OPNPCU, item);
const points = p => run(p, '[proc,count_questpoints]').popInt();
function earnStart(p) { talk(p, 'twocats_unferth', [1]); assert.equal(stage(p), 1); }
function fill(p) { while (p.invFreeSpace(inv) > 0) add(p, 'bronze_dagger'); }
function makeSpace(p, n = 28) { p.invDel(inv, obj('bronze_dagger'), n); }

// All own objects retain their original IDs and are private/untradeable.
for (const [offset, name] of ['twocats_mouse_toy', 'twocats_present', 'twocats_rewardlamp', 'twocats_amuletofcatspeak',
  'twocats_chores', 'twocats_recipe', 'twocats_doctors_hat', 'twocats_nurses_hat'].entries()) {
  assert.equal(obj(name), 6541 + offset); assert.equal(types.ObjType.get(obj(name)).tradeable, false);
}
assert.equal(types.VarPlayerType.get(v('twocats_varbit')).scope, types.VarPlayerType.SCOPE_PERM);
assert.equal(v('twocats_planted_at'), 326);
assert.equal(types.VarPlayerType.get(v('twocats_planted_at')).scope, types.VarPlayerType.SCOPE_PERM);
for (const options of [{ qualified: false }, { cat: false }, { amulet: false }]) {
  const p = player(options); talk(p, 'twocats_unferth'); assert.equal(stage(p), 0, 'missing prerequisite refuses start');
}
{
  const p = player({ cat: false }); p.setVar(v('follower_obj'), obj('kittenobject'));
  talk(p, 'twocats_unferth'); assert.equal(stage(p), 0, 'fake follower metadata is not a real cat');
}
// The compass follows the actual packed-world Bob, never a cutscene lookalike.
{
  let bob;
  for (const actor of World.npcs) if (actor.type === id('NpcType', 'death_growncat_black')) { bob = actor; break; }
  assert(bob, 'the original roaming Bob is present in the packed world');
  const q = player(); add(q, 'twocats_amuletofcatspeak');
  run(q, '[ai_spawn,death_growncat_black]', [], bob);
  const bearings = [[0, 20], [20, 20], [20, 0], [20, -20], [0, -20], [-20, -20], [-20, 0], [-20, 20]];
  for (const [bearing, [dx, dz]] of bearings.entries()) {
    q.level = bob.level; q.x = bob.x - dx; q.z = bob.z - dz;
    assert.equal(run(q, '[proc,twocats_bob_bearing]').popInt(), bearing);
  }
  q.x = bob.x; q.z = bob.z;
  assert.equal(run(q, '[proc,twocats_bob_bearing]').popInt(), 8, 'nearby Bob lights every orientation');
  run(q, '[opheld3,twocats_amuletofcatspeak]');
  assert.equal(q.modalMain, id('Component', 'inter_311'));
  button(q, 'inter_311:com_6'); assert.equal(q.getVarBit(b('twocats_locator_direction')), 1);
  button(q, 'inter_311:com_5'); button(q, 'inter_311:com_5');
  assert.equal(q.getVarBit(b('twocats_locator_direction')), 7, 'whiskers wrap through eight directions');
  q.closeModal();
}
const p = player(), baseline = points(p); p.setVar(v('qp'), baseline);
earnStart(p);
add(p, 'deathrune', 4); talk(p, 'death_woman_indoors1');
assert.equal(stage(p), 1); assert.equal(count(p, 'deathrune'), 4);
add(p, 'deathrune', 2); fill(p); talk(p, 'death_woman_indoors1');
assert.equal(count(p, 'deathrune'), 6, 'full inventory cannot consume runes or worn amulet');
assert.equal(count(p, 'ics_little_amulet_of_catspeak', worn), 1);
makeSpace(p); talk(p, 'death_woman_indoors1'); assert.equal(stage(p), 10);
assert.equal(count(p, 'deathrune'), 1); assert.equal(count(p, 'twocats_amuletofcatspeak'), 1);
run(p, '[proc,equip]', [p.getInventory(inv).items.findIndex(item => item?.id === obj('twocats_amuletofcatspeak'))]);
assert.equal(count(p, 'twocats_amuletofcatspeak', worn), 1);
talk(p, 'death_growncat_black'); assert.equal(stage(p), 20);
talk(p, 'gertrude', [1]); assert.equal(stage(p), 30);
talk(p, 'reldo', [1]); assert.equal(stage(p), 35); assert.equal(p.getVarBit(b('twocats_reldo')), 1);
talk(p, 'death_growncat_black'); assert.equal(stage(p), 40);
fill(p); talk(p, 'ics_little_sphinx', [1]); assert.equal(stage(p), 40, 'scene cannot strand a full inventory');
makeSpace(p); talk(p, 'ics_little_sphinx', [1, 1]); assert.equal(stage(p), 50, 'complete memory earns chores');
assert.equal(bit(p, 'tidyhuman'), 4); assert.equal(bit(p, 'feedhuman'), 1);
assert.equal(count(p, 'twocats_chores'), 1);
assert.equal(p.level, 0); assert(Math.abs(p.x - 2918) < 6 && Math.abs(p.z - 3558) < 6, 'Sphinx returns to mapped Unferth house');
escape(tile(p), 'Sphinx return');
drop(p, 'twocats_chores'); talk(p, 'death_growncat_black'); assert.equal(count(p, 'twocats_chores'), 1);
talk(p, 'twocats_unferth'); assert.equal(stage(p), 50, 'unfinished chores do not advance');
interact(p, locs.twocats_bed, ServerTriggerType.OPLOC1); assert.equal(bit(p, 'tidyhouse'), 1);
add(p, 'logs'); add(p, 'tinderbox');
useLoc(p, 'tinderbox', 'twocats_fireplace'); assert.equal(bit(p, 'warmhuman'), 0);
useLoc(p, 'logs', 'twocats_fireplace'); assert.equal(bit(p, 'warmhuman'), 1); assert.equal(count(p, 'logs'), 0);
useLoc(p, 'tinderbox', 'twocats_fireplace'); assert.equal(bit(p, 'warmhuman'), 2);
add(p, 'bucket_milk'); add(p, 'chocolate_cake');
useLoc(p, 'bucket_milk', 'twocats_table'); assert.equal(bit(p, 'feedhuman'), 2); assert.equal(count(p, 'bucket_empty'), 1);
useLoc(p, 'chocolate_cake', 'twocats_table'); assert.equal(bit(p, 'feedhuman'), 4);
add(p, 'shears');
for (let hair = 4; hair < 8; hair++) {
  const handler = useNpc(p, 'shears', 'twocats_unferth');
  assert(handler.startsWith('[opnpcu,twocats_unferth_')); assert.equal(bit(p, 'tidyhuman'), hair + 1);
}
add(p, 'rake'); add(p, 'dibber'); add(p, 'potato_seed', 4);
for (let weed = 0; weed < 3; weed++) { useLoc(p, 'rake', 'twocats_patch'); assert.equal(bit(p, 'tidygarden'), weed + 1); }
useLoc(p, 'potato_seed', 'twocats_patch'); assert.equal(bit(p, 'tidygarden'), 4); assert.equal(count(p, 'potato_seed'), 0);
// Timestamp fixture ages only a wait; it does not seed the product's completion field.
p.setVar(v('twocats_planted_at'), p.getVar(v('twocats_planted_at')) - 1);
run(p, '[opheld1,twocats_chores]'); assert.equal(bit(p, 'tidygarden'), 8);
interact(p, locs.twocats_bookcase, ServerTriggerType.OPLOC1); assert.equal(count(p, 'twocats_recipe'), 1);
drop(p, 'twocats_recipe'); interact(p, locs.twocats_bookcase, ServerTriggerType.OPLOC1); assert.equal(count(p, 'twocats_recipe'), 1);
talk(p, 'twocats_unferth'); assert.equal(stage(p), 55);
talk(p, 'apothecary', [1, 1]); assert.equal(stage(p), 60); assert.equal(count(p, 'twocats_doctors_hat'), 1);
drop(p, 'twocats_doctors_hat'); talk(p, 'apothecary', [1, 2]); assert.equal(count(p, 'twocats_nurses_hat'), 1);
add(p, 'vial_water'); talk(p, 'twocats_unferth'); assert.equal(stage(p), 60); assert.equal(count(p, 'vial_water'), 1);
for (const name of ['twocats_nurses_hat', 'desert_shirt', 'desert_robe']) {
  if (!count(p, name)) add(p, name);
  run(p, '[proc,equip]', [p.getInventory(inv).items.findIndex(item => item?.id === obj(name))]);
}
add(p, 'bronze_dagger');
run(p, '[proc,equip]', [p.getInventory(inv).items.findIndex(item => item?.id === obj('bronze_dagger'))]);
talk(p, 'twocats_unferth'); assert.equal(stage(p), 60, 'weapon invalidates disguise');
drop(p, 'bronze_dagger', worn);
talk(p, 'twocats_unferth'); assert.equal(stage(p), 65); assert.equal(count(p, 'vial_water'), 0);
talk(p, 'twocats_niete'); talk(p, 'death_growncat_black'); assert.equal(stage(p), 69, 'all holiday scenes finish');
escape(tile(p), 'holiday return');
fill(p); talk(p, 'twocats_unferth'); assert.equal(stage(p), 70);
assert.equal(p.getVar(v('qp')), baseline + 2); assert.equal(points(p), baseline + 2);
assert(p.packets.some(packet => packet.constructor.name === 'IfSetText' && packet.text === 'You have completed A Tail of Two Cats!'));
assert.equal(count(p, 'twocats_present'), 0, 'full inventory defers rather than drops present');
makeSpace(p); talk(p, 'twocats_unferth'); assert.equal(count(p, 'twocats_present'), 1);
drop(p, 'twocats_present'); talk(p, 'twocats_unferth'); assert.equal(count(p, 'twocats_present'), 1);
fill(p); run(p, '[opheld1,twocats_present]'); assert.equal(count(p, 'twocats_present'), 1);
makeSpace(p); run(p, '[opheld1,twocats_present]');
assert.equal(count(p, 'twocats_rewardlamp'), 2); assert.equal(count(p, 'twocats_mouse_toy'), 1);
talk(p, 'twocats_unferth'); assert.equal(count(p, 'twocats_present'), 0); assert.equal(p.getVar(v('qp')), baseline + 2);

// Both lamps use the shared native selector and exact tenths-of-XP scale.
for (const [skill, stat] of [['attack', PlayerStat.ATTACK], ['farming', PlayerStat.FARMING]]) {
  const before = p.stats[stat]; p.baseLevels[stat] = 30;
  run(p, '[opheld1,twocats_rewardlamp]'); button(p, `xplamp:${skill}`); button(p, 'xplamp:confirm');
  assert.equal(p.stats[stat] - before, 25000); if (p.activeScript) finish(p, p.activeScript);
}
assert.equal(count(p, 'twocats_rewardlamp'), 0);
{
  const q = player(); add(q, 'twocats_rewardlamp'); q.baseLevels[PlayerStat.ATTACK] = 29;
  const before = q.stats[PlayerStat.ATTACK]; run(q, '[opheld1,twocats_rewardlamp]');
  button(q, 'xplamp:confirm'); assert.equal(count(q, 'twocats_rewardlamp'), 1);
  button(q, 'xplamp:attack'); button(q, 'xplamp:confirm'); assert.equal(count(q, 'twocats_rewardlamp'), 1);
  assert.equal(q.stats[PlayerStat.ATTACK], before);
  drop(q, 'twocats_rewardlamp'); button(q, 'xplamp:confirm'); assert.equal(q.stats[PlayerStat.ATTACK], before);
}
for (const skill of ['attack', 'strength', 'ranged', 'magic', 'defence', 'hitpoints', 'prayer', 'agility',
  'herblore', 'thieving', 'crafting', 'runecraft', 'mining', 'smithing', 'fishing', 'cooking',
  'firemaking', 'woodcutting', 'fletching', 'slayer', 'farming']) {
  const stat = PlayerStat[skill.toUpperCase()]; assert.equal(typeof stat, 'number', skill);
  const q = player(); add(q, 'twocats_rewardlamp'); q.baseLevels[stat] = 30;
  const before = [...q.stats];
  run(q, '[opheld1,twocats_rewardlamp]'); button(q, `xplamp:${skill}`); button(q, 'xplamp:confirm');
  for (let index = 0; index < before.length; index++) assert.equal(q.stats[index] - before[index], index === stat ? 25000 : 0, skill);
  assert.equal(count(q, 'twocats_rewardlamp'), 0);
  if (q.activeScript) finish(q, q.activeScript);
}
for (const [lamp, amount, level] of [['macro_genilamp', 9900, 99], ['thosf_reward_lamp', 100000, 31]]) {
  const q = player(); add(q, 'twocats_rewardlamp'); add(q, lamp); q.baseLevels[PlayerStat.ATTACK] = level;
  run(q, '[opheld1,twocats_rewardlamp]'); run(q, `[opheld1,${lamp}]`);
  const before = q.stats[PlayerStat.ATTACK]; button(q, 'xplamp:attack'); button(q, 'xplamp:confirm');
  assert.equal(q.stats[PlayerStat.ATTACK] - before, amount, `${lamp} retains its own XP path`);
  assert.equal(count(q, 'twocats_rewardlamp'), 1); assert.equal(count(q, lamp), 0);
  if (q.activeScript) finish(q, q.activeScript);
}
// The Sphinx's original amulet service remains reachable while this quest is active.
{
  const q = player({ amulet: false }); q.setVarBit(b('twocats_quest'), 40);
  talk(q, 'ics_little_sphinx', [2]); assert.equal(count(q, 'ics_little_amulet_of_catspeak'), 1);
}
// Shared quests/services take their normal branches after opting out of Two Cats.
{
  const q = player(); q.setVarBit(b('twocats_quest'), 30); q.setVar(v('phoenixgang'), 2);
  talk(q, 'reldo'); assert.equal(q.getVar(v('phoenixgang')), 3, 'Arrav book turn-in retains precedence');
  assert.equal(stage(q), 30);
  q.setVarBit(b('twocats_quest'), 60); talk(q, 'apothecary', [2, 3]);
  assert.equal(stage(q), 60, 'ordinary potion service leaves Two Cats untouched');
}
{
  const q = player({ cat: false }); q.setVarBit(b('twocats_quest'), 30); add(q, 'coins', 100);
  talk(q, 'gertrude', [2, 1], 'pick_a_kitten');
  assert.equal(q.modalChat, id('Component', 'pick_a_kitten')); assert.equal(count(q, 'coins'), 0);
  assert.equal(stage(q), 30, 'kitten purchase remains available while Bob needs Gertrude');
  q.closeModal();
}
{
  const q = player(); q.setVar(v('fluffs'), 0); q.setVarBit(b('twocats_quest'), 20);
  talk(q, 'gertrude', [1]); assert.equal(q.getVar(v('fluffs')), 1); assert.equal(stage(q), 20);
}
{
  const q = player(); q.setVarBit(b('twocats_quest'), 30); q.setVarBit(b('lost_tribe_quest'), 5);
  add(q, 'lost_tribe_brooch'); talk(q, 'reldo', [1]);
  assert.equal(q.getVarBit(b('lost_tribe_contact')), 1); assert.equal(stage(q), 30, 'Lost Tribe retains precedence');
}
{
  const q = player(); q.setVarBit(b('twocats_quest'), 30); q.setVar(v('squire'), 1);
  talk(q, 'reldo', [2, 4]); assert.equal(q.getVar(v('squire')), 2); assert.equal(stage(q), 30);
}
{
  const q = player(); q.setVarBit(b('twocats_quest'), 30); q.setVarBit(b('giantdwarf_quest'), 3);
  add(q, 'dwarf_battleaxe_old'); talk(q, 'reldo', [2, 4]);
  assert(q.packets.some(packet => packet.constructor.name === 'IfSetText' && /surviving Imcando/.test(packet.text)));
  assert.equal(stage(q), 30, 'Giant Dwarf redberry-pie lead remains available');
}
{
  const q = player(); q.setVarBit(b('twocats_quest'), 60); q.setVar(v('rjquest'), 40);
  talk(q, 'apothecary', [2]); assert.equal(q.getVar(v('rjquest')), 50); assert.equal(stage(q), 60);
  add(q, 'cadavaberries'); talk(q, 'apothecary', [2]); assert.equal(count(q, 'cadava'), 1);
}
{
  const q = player(); q.setVarBit(b('twocats_quest'), 60); q.setVar(v('onesmallfavour'), 9);
  talk(q, 'apothecary', [2, 1, 1]);
  assert.equal(q.getVar(v('onesmallfavour')), 10); assert.equal(count(q, 'favour_herbal_tincture'), 1);
  assert.equal(stage(q), 60);
}
// Every intermediate quest-item loss has an actual NPC or bookcase recovery path.
for (const current of [10, 20, 30, 35, 40, 50, 55, 60, 65, 69, 70]) {
  const q = player(); q.setVarBit(b('twocats_quest'), current); add(q, 'deathrune', 5);
  talk(q, 'death_woman_indoors1'); assert.equal(count(q, 'twocats_amuletofcatspeak'), 1); assert.equal(stage(q), current);
}
for (const current of [50, 55, 60, 65, 69]) {
  const q = player(); q.setVarBit(b('twocats_quest'), current);
  interact(q, locs.twocats_bookcase, ServerTriggerType.OPLOC1);
  assert.equal(count(q, 'twocats_chores'), 1); assert.equal(count(q, 'twocats_recipe'), 1);
}
for (const current of [55, 60, 65, 69, 70]) {
  const q = player(); q.setVarBit(b('twocats_quest'), current);
  talk(q, 'apothecary', [1, 1]); drop(q, 'twocats_doctors_hat');
  talk(q, 'apothecary', [1, 2]); assert.equal(count(q, 'twocats_nurses_hat'), 1);
}
{
  const q = player(); q.setVarBit(b('twocats_quest'), 50); run(q, '[proc,twocats_chores_start]');
  add(q, 'chocolate_cake', 2); add(q, 'bucket_milk', 2);
  useLoc(q, 'chocolate_cake', 'twocats_table'); assert.equal(bit(q, 'feedhuman'), 3);
  useLoc(q, 'chocolate_cake', 'twocats_table'); assert.equal(count(q, 'chocolate_cake'), 1);
  useLoc(q, 'bucket_milk', 'twocats_table'); assert.equal(bit(q, 'feedhuman'), 4);
  useLoc(q, 'bucket_milk', 'twocats_table'); assert.equal(count(q, 'bucket_milk'), 1);
  add(q, 'potato_seed', 3);
  useLoc(q, 'potato_seed', 'twocats_patch'); assert.equal(bit(q, 'tidygarden'), 0);
  useLoc(q, 'rake', 'twocats_patch'); assert.equal(bit(q, 'tidygarden'), 0, 'missing tool cannot clear weeds');
  add(q, 'rake'); for (let weed = 0; weed < 3; weed++) useLoc(q, 'rake', 'twocats_patch');
  useLoc(q, 'potato_seed', 'twocats_patch'); assert.equal(bit(q, 'tidygarden'), 3, 'dibber required');
  add(q, 'dibber'); useLoc(q, 'potato_seed', 'twocats_patch'); assert.equal(bit(q, 'tidygarden'), 3, 'four seeds required');
  assert.equal(count(q, 'potato_seed'), 3); add(q, 'potato_seed');
  useLoc(q, 'potato_seed', 'twocats_patch'); assert.equal(bit(q, 'tidygarden'), 4);
}
// Every private scene source viewer tile is independently in the intended native area.
for (const [at, label] of [[[0, 1896, 4522], 'Dragonkin castle'], [[0, 3298, 2784], 'Sophanem'],
  [[0, 2272, 4698], 'King Black Dragon lair'], [[1, 1886, 4825], 'trawler deck']]) {
  assert(floorTiles.has(at.join()), `${label} has native floor data`); escape(at, label);
}
// Normal and interrupted cleanup remove only scene actors, never the player's follower.
for (const interrupted of [false, true]) {
  const q = player({ cat: false }); q.setVarBit(b('twocats_quest'), 40);
  const before = tile(q); const begun = run(q, '[proc,twocats_scene_begin]', [(29 * 64 + 24) * 16384 + 70 * 64 + 32, 16, 10]);
  const origin = begun.popInt(), scene = begun.popInt(); assert.notDeepEqual(tile(q), before);
  run(q, '[proc,cat_spawn]', [id('NpcType', 'kittenpet1')]);
  const followerUid = q.getVar(v('follower_uid')), follower = World.getNpc(followerUid & 0xffff);
  assert(follower && follower.x === q.x && follower.z === q.z, 'real follower is inside the private scene');
  // This internal proc inherits the native region pointer from scene_begin.
  const actorState = ScriptRunner.init(ScriptProvider.getByName('[proc,twocats_scene_actor]'), q, null,
    [16, 12, id('NpcType', 'twocats_robert_cutscene')]);
  actorState._activeRegion = begun._activeRegion; actorState._activeRegionUid = begun._activeRegionUid;
  actorState.pointerAdd(ActiveRegion[0]);
  q.executeScript(actorState, true, true); finish(q, actorState);
  const actor = [...World.npcs].find(npc => npc.type === id('NpcType', 'twocats_robert_cutscene') &&
    npc.level === q.level && npc.x === q.x && npc.z === q.z + 2);
  assert(actor, 'the same scene contains a quest-owned actor');
  if (interrupted) {
    q.closeModal(); run(q, '[softtimer,twocats_scene_watch]', [scene, origin]);
  } else run(q, '[proc,twocats_scene_end]', [scene, origin]);
  assert.deepEqual(tile(q), before); assert.equal(stage(q), 40);
  assert.equal(q.getVar(v('follower_uid')), followerUid, 'cleanup preserves the actual follower UID');
  assert(World.getNpc(follower.nid) === follower, 'cleanup does not delete the follower');
  assert.deepEqual(tile(follower), before, 'follower leaves before private-region reclamation');
  assert(!World.getNpc(actor.nid), 'cleanup removes its own actor');
  assert.equal(q.timers.get(ScriptProvider.getByName('[softtimer,twocats_scene_watch]').id), undefined);
}
console.log('PASS A Tail of Two Cats: end-to-end 0→70, five chores, visible forms, packed-map approaches/returns, recovery, once-only 2 QP and rewards, lamps and shared services');
process.exit(0);
