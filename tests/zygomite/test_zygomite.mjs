#!/usr/bin/env node
/**
 * Mutated zygomite mechanics against the real packed configs and production ScriptRunner.
 * No script handlers are replaced; World.addObj is observed while its original implementation
 * still runs so the queue4 death and drop path remain real.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(here, '../../../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = async relative => import(pathToFileURL(path.join(engine, relative)).href);

const World = (await load('src/engine/World.ts')).default;
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptPointer = (await load('src/engine/script/ScriptPointer.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const Npc = (await load('src/engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const { NpcStat } = await load('src/engine/entity/NpcStat.ts');
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const Environment = (await load('src/util/Environment.ts')).default;
const { ParamHelper } = await load('src/cache/config/ParamHelper.ts');
const configs = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType',
  'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType',
  'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType']) {
  configs[name] = (await load(`src/cache/config/${name}.ts`)).default;
  configs[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
assert.equal(Environment.NODE_PRODUCTION, false, 'run under the non-production script error policy');
assert.equal(Environment.NODE_XPRATE, 1, 'Slayer XP is checked in unmultiplied tenths');
Environment.NODE_MEMBERS = true;
assert(ScriptProvider.load(pack) > 0, 'load real compiled scripts');
World.gameMap.init();
assert(World.gameMap.getTotalLocs() > 0, 'load the packed world map');
World.npcs.reset();
World.currentTick = 100;

const { VarPlayerType, VarNpcType, ParamType, ObjType, NpcType, InvType, CategoryType, EnumType, SeqType } = configs;
const id = (type, name) => {
  const value = type.getId(name);
  assert(value >= 0, `missing packed ${name}`);
  return value;
};
const slayerCategoryParam = ParamType.getByName('slayer_category');
assert(slayerCategoryParam, 'missing packed slayer_category parameter');
const ids = {
  inv: id(InvType, 'inv'),
  worn: id(InvType, 'worn'),
  coins: id(ObjType, 'coins'),
  ashes: id(ObjType, 'ashes'),
  steelAxe: id(ObjType, 'steel_axe'),
  slayerTarget: id(VarPlayerType, 'slayer_target'),
  slayerCount: id(VarPlayerType, 'slayer_count'),
  aggressivePlayer: id(VarNpcType, 'npc_aggressive_player'),
  fungusCategory: id(CategoryType, 'slayer_zygomite_fungus'),
  combatCategory: id(CategoryType, 'slayer_zygomite'),
  sprayCategory: id(CategoryType, 'slayer_fungicide_spray'),
  fungicide: id(ObjType, 'slayer_fungicide'),
  leap: id(SeqType, 'zygomite_leap_out')
};
const SLAYER_MUTATED_ZYGOMITE = 74;
const FORMS = [
  { disguise: 'slayer_mutated_zygomite_adolescent_cap', disguiseId: 3344,
    combat: 'slayer_mutated_zygomite_adolescent', combatId: 3346, maxHp: 65, melee: 7, ranged: 6 },
  { disguise: 'slayer_mutated_zygomite_adult_capt', disguiseId: 3345,
    combat: 'slayer_mutated_zygomite_adult', combatId: 3347, maxHp: 75, melee: 8, ranged: 10 }
];
const chargesEnum = EnumType.getByName('slayer_spray_charges');
const formsEnum = EnumType.getByName('slayer_spray_forms');
assert(chargesEnum, 'missing packed slayer_spray_charges enum');
assert(formsEnum, 'missing packed slayer_spray_forms enum');
const sprayId = charge => {
  const value = formsEnum.values.get(charge);
  assert(Number.isSafeInteger(value) && value >= 0, `missing packed spray form for ${charge} charges`);
  assert.equal(chargesEnum.values.get(value), charge, `spray enum round-trip for ${charge} charges`);
  assert.equal(ObjType.get(value).category, ids.sprayCategory, `spray ${charge} uses the fungicide-spray category`);
  return value;
};
for (let charge = 0; charge <= 10; charge++) sprayId(charge);

let assertions = 0;
function check(label, actual, expected) {
  assert.deepEqual(actual, expected, label);
  assertions++;
}
function requiredTrigger(trigger, type, category, label) {
  const script = ScriptProvider.getByTrigger(trigger, type, category);
  assert(script, `missing packed ${label} trigger`);
  return script;
}
function run(scriptOrName, self, target = null, args = []) {
  const script = typeof scriptOrName === 'string' ? ScriptProvider.getByName(scriptOrName) : scriptOrName;
  assert(script, `missing packed script ${scriptOrName}`);
  const state = ScriptRunner.init(script, self, target, args);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  if (self instanceof Npc) self.executeScript(state);
  else self.executeScript(state, true, true);
  assert.notEqual(state.execution, ScriptState.ABORTED, `${script.name} must not abort`);
  return state;
}
function expectFinished(state, label) {
  assert.equal(state.execution, ScriptState.FINISHED, `${label} must finish`);
  assertions++;
}

let playerSerial = 0;
let npcSerial = 0;
function makePlayer({ taskTarget = 0, taskCount = 0 } = {}) {
  const n = ++playerSerial;
  const hash = BigInt(9000 + n);
  const player = new Player(`zygvm${n}`, hash, hash);
  player.slot = n;
  player.pid = n;
  player.uid = ((Number(hash & 0x1fffffn) << 11) | n) >>> 0;
  player.level = 0;
  player.x = 3100 + n * 8;
  player.z = 3300;
  player.isActive = true;
  player.vars.fill(0);
  player.baseLevels.fill(99);
  player.levels.fill(99);
  player.stats.fill(0);
  player.baseLevels[PlayerStat.SLAYER] = 99;
  player.levels[PlayerStat.SLAYER] = 99;
  player.messages = [];
  player.packets = [];
  player.write = packet => player.packets.push(packet);
  player.messageGame = text => player.messages.push(String(text));
  player.wrappedMessageGame = player.messageGame;
  player.getInventory(ids.inv);
  player.getInventory(ids.worn);
  player.setVar(ids.slayerTarget, taskTarget);
  player.setVar(ids.slayerCount, taskCount);
  World.players[player.slot] = player;
  World.playerLoop.add(player.hash64, player);
  return player;
}
function makeNpc(name, player = null, distance = 1) {
  const type = NpcType.getByName(name);
  assert(type, `missing packed NPC ${name}`);
  const n = ++npcSerial;
  const x = player ? player.x + distance : 3100 + n * 8;
  const z = player ? player.z : 3300;
  const npc = new Npc(0, x, z, type.size, type.size, EntityLifeCycle.RESPAWN, n, type.id, type.blockwalk);
  World.addNpc(npc, -1);
  npc.lastMovement = World.currentTick - 100;
  if (player) {
    npc.setVar(ids.aggressivePlayer, player.uid);
    npc.heroPoints.addHero(player.hash64, type.stats[NpcStat.HITPOINTS]);
  }
  const spawn = requiredTrigger(ServerTriggerType.AI_SPAWN, type.id, type.category, `${name} ai_spawn`);
  expectFinished(run(spawn, npc), `${name} ai_spawn`);
  check(`${name} spawn keeps the mapped type`, npc.type, type.id);
  check(`${name} spawn health`, npc.levels[NpcStat.HITPOINTS], type.stats[NpcStat.HITPOINTS]);
  return npc;
}
function inv(player) {
  const value = player.getInventory(ids.inv);
  assert(value, 'player inventory must exist');
  return value;
}
function useOnNpc(player, npc, item, slot = 0) {
  player.lastUseItem = item;
  player.lastUseSlot = slot;
  const type = NpcType.get(npc.type);
  const trigger = requiredTrigger(ServerTriggerType.OPNPCU, type.id, type.category, `${type.debugname} opnpcu`);
  return run(trigger, player, npc);
}
function withCapturedDrops(action) {
  const drops = [];
  const addObj = World.addObj;
  World.addObj = function (obj, receiver, duration) {
    drops.push({ id: obj.type, count: obj.count, receiver: String(receiver) });
    return addObj.call(this, obj, receiver, duration);
  };
  try {
    action();
    return drops;
  } finally {
    World.addObj = addObj;
  }
}
function withRandom(values, action) {
  const original = JavaRandom.nextDouble;
  let draws = 0;
  JavaRandom.nextDouble = () => {
    assert(draws < values.length, `unexpected RNG draw ${draws + 1}`);
    return values[draws++];
  };
  try {
    const result = action();
    assert.equal(draws, values.length, 'consume the expected deterministic RNG stream');
    return result;
  } finally {
    JavaRandom.nextDouble = original;
  }
}
function withZeroRandom(action) {
  const original = JavaRandom.nextDouble;
  let draws = 0;
  JavaRandom.nextDouble = () => { draws++; return 0; };
  try {
    const result = action();
    assert(draws > 0, 'the real drop table consumes its random roll');
    return result;
  } finally {
    JavaRandom.nextDouble = original;
  }
}
function drainNpc(npc, players, limit = 40) {
  for (let tick = 0; tick < limit; tick++) {
    if (npc.isActive) npc.turn();
    for (const player of players) player.processQueues();
    if (!npc.isActive && !npc.activeScript) {
      World.currentTick++;
      for (const player of players) player.processQueues();
      return;
    }
    World.currentTick++;
  }
  assert.fail(`NPC ${npc.type} did not finish queued scripts within ${limit} ticks`);
}
function settlePlayer(player, ticks = 2) {
  for (let tick = 0; tick < ticks; tick++) {
    World.currentTick++;
    player.processQueues();
  }
}
function queuedDamage(player) {
  return [...player.queue.all()]
    .filter(request => request.script.name === '[queue,combat_damage_player]')
    .map(request => request.args);
}
function pv(player, name, value) {
  player.setVar(id(VarPlayerType, name), value);
}

// The four 377 cache identities resolve to the two disguised, nonmoving fungus forms and
// their same-actor adolescent/adult combat forms. Category dispatch and Slayer identity are packed.
{
  const player = makePlayer();
  player.baseLevels[PlayerStat.SLAYER] = 56;
  player.levels[PlayerStat.SLAYER] = 56;
  const disguise = NpcType.getByName(FORMS[0].disguise);
  const npc = makeNpc(FORMS[0].disguise, player);
  const before = { type: npc.type, animation: npc.animId, target: npc.target };
  const trigger = requiredTrigger(ServerTriggerType.OPNPC1, disguise.id, disguise.category, 'under-level zygomite opnpc1');
  expectFinished(run(trigger, player, npc), 'under-level zygomite pick refusal');
  check('Slayer 56 cannot reveal the disguise', npc.type, before.type);
  check('refused pick does not play the reveal animation', npc.animId, before.animation);
  check('refused pick does not retaliate', npc.target, before.target);
}

for (const form of FORMS) {
  const disguise = NpcType.getByName(form.disguise);
  const combat = NpcType.getByName(form.combat);
  assert(disguise && combat, `packed disguise/combat pair ${form.disguise}`);
  check(`${form.disguise} cache identity`, disguise.id, form.disguiseId);
  check(`${form.combat} cache identity`, combat.id, form.combatId);
  check(`${form.disguise} category`, disguise.category, ids.fungusCategory);
  check(`${form.combat} category`, combat.category, ids.combatCategory);
  check(`${form.disguise} six combat stats`, Array.from(disguise.stats), Array(6).fill(form.maxHp));
  check(`${form.combat} six combat stats`, Array.from(combat.stats), Array(6).fill(form.maxHp));
  check(`${form.combat} Slayer category`, ParamHelper.getIntParam(slayerCategoryParam.id, combat, slayerCategoryParam.defaultInt), SLAYER_MUTATED_ZYGOMITE);

  const player = makePlayer();
  const npc = makeNpc(form.disguise, player);
  check(`${form.disguise} actor initially disguised`, npc.type, form.disguiseId);
  const trigger = requiredTrigger(ServerTriggerType.OPNPC1, disguise.id, disguise.category, `${form.disguise} opnpc1`);
  const state = run(trigger, player, npc);
  assert.notEqual(state.execution, ScriptState.ABORTED, `${form.disguise} reveal must not abort`);
  check(`${form.disguise} morphs the same actor`, npc.type, form.combatId);
  check(`${form.disguise} preserves combat stats`, Array.from(npc.baseLevels), Array(6).fill(form.maxHp));
  check(`${form.disguise} reveals with the cache leap animation`, npc.animId, ids.leap);
  for (let tick = 0; state.execution !== ScriptState.FINISHED && tick < 12; tick++) {
    World.currentTick++;
    if (npc.isActive) npc.turn();
    player.processQueues();
  }
  expectFinished(state, `${form.disguise} reveal and retaliation`);
  check(`${form.disguise} retaliates against the picker`, npc.target === player, true);
}

// A fungicide charge is represented only by the packed enum; every use replaces the exact slot
// with the enum's next form, even while the NPC is still above the finishing threshold.
{
  const player = makePlayer();
  const npc = makeNpc(FORMS[0].combat, player);
  inv(player).set(3, { id: sprayId(10), count: 1 });
  for (let charges = 10; charges > 0; charges--) {
    const current = inv(player).get(3);
    check(`spray starts at ${charges} charges`, current?.id, sprayId(charges));
    expectFinished(useOnNpc(player, npc, current.id, 3), `spray charge ${charges}`);
    check(`spray consumes exactly one charge ${charges}->${charges - 1}`, inv(player).get(3)?.id, sprayId(charges - 1));
    check(`spray above threshold leaves NPC HP untouched at ${charges}`, npc.levels[NpcStat.HITPOINTS], FORMS[0].maxHp);
    check(`spray above threshold queues no death ${charges}`,
      [...npc.queue.all()].some(request => request.queueId === ServerTriggerType.AI_QUEUE4), false);
  }
  const emptyId = inv(player).get(3).id;
  expectFinished(useOnNpc(player, npc, emptyId, 3), 'empty spray');
  check('empty spray remains in its slot', inv(player).get(3)?.id, sprayId(0));
  check('empty spray cannot finish the NPC', npc.isActive, true);
  check('empty spray leaves HP unchanged', npc.levels[NpcStat.HITPOINTS], FORMS[0].maxHp);
  check('empty spray does not queue death', [...npc.queue.all()].some(request => request.queueId === ServerTriggerType.AI_QUEUE4), false);

  inv(player).set(1, { id: ids.coins, count: 1 });
  const before = inv(player).items.map(item => item && { ...item });
  expectFinished(useOnNpc(player, npc, ids.coins, 1), 'unrelated item on zygomite');
  check('unrelated item leaves every inventory slot unchanged', inv(player).items, before);
  check('unrelated item cannot finish the NPC', npc.isActive, true);
  check('unrelated item does not queue death', [...npc.queue.all()].some(request => request.queueId === ServerTriggerType.AI_QUEUE4), false);
}

// Nine HP consumes a charge but does not queue death; eight HP queues queue4, whose real NPC turn
// executes npc_death and the real ash plus data-table drop path.
{
  const player = makePlayer();
  const npc = makeNpc(FORMS[0].combat, player);
  npc.applyDamage(FORMS[0].maxHp - 9, 1);
  inv(player).set(2, { id: sprayId(10), count: 1 });
  expectFinished(useOnNpc(player, npc, sprayId(10), 2), 'fungicide at 9 HP');
  check('nine HP consumes a fungicide charge', inv(player).get(2)?.id, sprayId(9));
  check('nine HP does not queue queue4', [...npc.queue.all()].some(request => request.queueId === ServerTriggerType.AI_QUEUE4), false);
  check('nine HP remains active', npc.isActive, true);
  npc.applyDamage(1, 1);
  expectFinished(useOnNpc(player, npc, sprayId(9), 2), 'fungicide at 8 HP');
  check('eight HP consumes a fungicide charge', inv(player).get(2)?.id, sprayId(8));
  check('eight HP queues the production queue4', [...npc.queue.all()].some(request => request.queueId === ServerTriggerType.AI_QUEUE4), true);
  const drops = withZeroRandom(() => withCapturedDrops(() => drainNpc(npc, [player])));
  check('queue4 calls real npc_death and removes the NPC', npc.isActive, false);
  check('finishing death drops guaranteed ash', drops.some(drop => drop.id === ids.ashes && drop.count === 1), true);
  check('finishing death also runs the packed drop table', drops.some(drop => drop.id === ids.steelAxe && drop.count === 1), true);
}

// Refill dispatch covers both protocol orientations: target spray uses the spray category trigger,
// while target fungicide uses the explicit slayer_fungicide trigger. Every empty through nine-charge
// state restores the same cached spray slot to ten and consumes exactly one refill item.
const sprayRefillTrigger = ScriptProvider.getByTriggerSpecific(ServerTriggerType.OPHELDU, -1, ids.sprayCategory);
const fungicideRefillTrigger = ScriptProvider.getByTriggerSpecific(ServerTriggerType.OPHELDU, ids.fungicide, -1);
assert(sprayRefillTrigger, 'missing packed [opheldu,_slayer_fungicide_spray] trigger');
assert(fungicideRefillTrigger, 'missing packed [opheldu,slayer_fungicide] trigger');
function refill(charge, orientation, fullInventory = false) {
  const player = makePlayer();
  const inventory = inv(player);
  inventory.set(0, { id: sprayId(charge), count: 1 });
  inventory.set(1, { id: ids.fungicide, count: 1 });
  if (fullInventory) {
    for (let slot = 2; slot < inventory.capacity; slot++) inventory.set(slot, { id: ids.coins, count: 1 });
    check(`refill fixture has full inventory at ${charge}`, inventory.freeSlotCount, 0);
  }
  player.lastItem = orientation === 'spray-target' ? sprayId(charge) : ids.fungicide;
  player.lastSlot = orientation === 'spray-target' ? 0 : 1;
  player.lastUseItem = orientation === 'spray-target' ? ids.fungicide : sprayId(charge);
  player.lastUseSlot = orientation === 'spray-target' ? 1 : 0;
  const trigger = orientation === 'spray-target' ? sprayRefillTrigger : fungicideRefillTrigger;
  expectFinished(run(trigger, player), `refill ${charge} charges via ${orientation}`);
  check(`refill ${charge} via ${orientation} selects spray10`, inventory.get(0)?.id, sprayId(10));
  check(`refill ${charge} via ${orientation} consumes one fungicide when charged`, inventory.getItemCount(ids.fungicide), charge === 10 ? 1 : 0);
  return { player, inventory };
}
for (let charge = 0; charge < 10; charge++) {
  refill(charge, charge % 2 === 0 ? 'spray-target' : 'fungicide-target');
  refill(charge, charge % 2 === 0 ? 'fungicide-target' : 'spray-target');
}
for (const orientation of ['spray-target', 'fungicide-target']) {
  const { inventory } = refill(10, orientation);
  check(`full spray via ${orientation} remains ten`, inventory.get(0)?.id, sprayId(10));
  check(`full spray via ${orientation} keeps refill`, inventory.getItemCount(ids.fungicide), 1);
}
const full = refill(4, 'spray-target', true);
check('in-place refill succeeds with a full inventory', full.inventory.get(0)?.id, sprayId(10));
check('full-inventory refill consumes its refill', full.inventory.getItemCount(ids.fungicide), 0);

// A normal lethal hit runs the zygomite ai_queue3 handler: it heals one HP and does not award a
// task kill, XP, or drops. This is separate from the fungicide-only queue4 finish.
for (const form of FORMS) {
  const player = makePlayer({ taskTarget: SLAYER_MUTATED_ZYGOMITE, taskCount: 2 });
  const npc = makeNpc(form.combat, player);
  npc.applyDamage(form.maxHp, 1);
  const trigger = requiredTrigger(ServerTriggerType.AI_QUEUE3, npc.type, NpcType.get(npc.type).category, `${form.combat} ai_queue3`);
  const drops = withCapturedDrops(() => expectFinished(run(trigger, npc), `${form.combat} ordinary lethal regen`));
  check(`${form.combat} ordinary lethal survives at one HP`, npc.levels[NpcStat.HITPOINTS], 1);
  check(`${form.combat} ordinary lethal leaves the NPC active`, npc.isActive, true);
  check(`${form.combat} ordinary lethal does not decrement task`, player.getVar(ids.slayerCount), 2);
  check(`${form.combat} ordinary lethal gives no Slayer XP`, player.stats[PlayerStat.SLAYER], 0);
  check(`${form.combat} ordinary lethal produces no drops`, drops, []);
}

// Real queue4 death and real player queue execution award maximum-HP Slayer XP and one task kill
// for either combat form. A different target gets neither credit nor XP.
function fungicideKill(form, taskTarget, expectedCount, expectedXp, label) {
  const player = makePlayer({ taskTarget, taskCount: 2 });
  const npc = makeNpc(form.combat, player);
  npc.applyDamage(form.maxHp - 8, 1);
  inv(player).set(4, { id: sprayId(10), count: 1 });
  expectFinished(useOnNpc(player, npc, sprayId(10), 4), `${label} fungicide queue`);
  check(`${label} queue4 is scheduled`, [...npc.queue.all()].some(request => request.queueId === ServerTriggerType.AI_QUEUE4), true);
  const drops = withZeroRandom(() => withCapturedDrops(() => drainNpc(npc, [player])));
  check(`${label} real npc_death removes the NPC`, npc.isActive, false);
  check(`${label} task count`, player.getVar(ids.slayerCount), expectedCount);
  check(`${label} Slayer XP in tenths`, player.stats[PlayerStat.SLAYER], expectedXp);
  check(`${label} guaranteed ash`, drops.some(drop => drop.id === ids.ashes && drop.count === 1), true);
  check(`${label} data-table steel axe`, drops.some(drop => drop.id === ids.steelAxe && drop.count === 1), true);
}
for (const form of FORMS) {
  fungicideKill(form, SLAYER_MUTATED_ZYGOMITE, 1, form.maxHp * 10, `${form.combat} matching task`);
}
fungicideKill(FORMS[0], SLAYER_MUTATED_ZYGOMITE - 1, 2, 0, 'adolescent mismatched task');

// The custom attack procs use crush in melee range and ranged at distance; maximum hits are the
// authored 7/8 melee and 6/10 ranged values. Their accuracy uses Magic defence while prayer
// protection follows the delivery style.
for (const form of FORMS) {
  const melee = makePlayer();
  const meleeNpc = makeNpc(form.combat, melee, 1);
  const crushStyle = withRandom([0.999999], () => run('[proc,zygomite_attack_style]', meleeNpc, melee));
  check(`${form.combat} close attack style is crush`, crushStyle.intStack.slice(0, crushStyle.isp), [2]);
  check(`${form.combat} melee max hit`, run('[proc,zygomite_maxhit]', meleeNpc, melee, [2]).intStack.slice(0, 1), [form.melee]);
  const meleeHp = melee.levels[PlayerStat.HITPOINTS];
  withRandom([0.999999, 0.999999, 0, 0.999999], () => run('[proc,zygomite_attack]', meleeNpc, melee));
  check(`${form.combat} crush attack queues its maximum`, queuedDamage(melee), [[form.melee]]);
  settlePlayer(melee);
  check(`${form.combat} crush attack damages the picker`, meleeHp - melee.levels[PlayerStat.HITPOINTS], form.melee);

  const ranged = makePlayer();
  const rangedNpc = makeNpc(form.combat, ranged, 2);
  const rangedStyle = run('[proc,zygomite_attack_style]', rangedNpc, ranged);
  check(`${form.combat} distant attack style is ranged`, rangedStyle.intStack.slice(0, rangedStyle.isp), [3]);
  check(`${form.combat} ranged max hit`, run('[proc,zygomite_maxhit]', rangedNpc, ranged, [3]).intStack.slice(0, 1), [form.ranged]);
  pv(ranged, 'com_magicdef', 0);
  pv(ranged, 'com_rangedef', 1000000);
  const rangedHp = ranged.levels[PlayerStat.HITPOINTS];
  withRandom([0.999999, 0, 0.999999], () => run('[proc,zygomite_attack]', rangedNpc, ranged));
  check(`${form.combat} ranged attack uses Magic rather than Ranged defence`, queuedDamage(ranged), [[form.ranged]]);
  settlePlayer(ranged);
  check(`${form.combat} ranged attack damages the picker`, rangedHp - ranged.levels[PlayerStat.HITPOINTS], form.ranged);

  const highMagicDefense = makePlayer();
  pv(highMagicDefense, 'com_magicdef', 1000000);
  pv(highMagicDefense, 'com_rangedef', 0);
  const highMagicDefenseNpc = makeNpc(form.combat, highMagicDefense, 2);
  withRandom([0.5, 0.999999], () => run('[proc,zygomite_attack]', highMagicDefenseNpc, highMagicDefense));
  check(`${form.combat} high Magic defence blocks the custom ranged accuracy roll`, queuedDamage(highMagicDefense), [[0]]);

  const wrongRangedPrayer = makePlayer();
  pv(wrongRangedPrayer, 'prayer14', 1);
  const wrongRangedPrayerNpc = makeNpc(form.combat, wrongRangedPrayer, 2);
  withRandom([0.999999, 0, 0.999999], () => run('[proc,zygomite_attack]', wrongRangedPrayerNpc, wrongRangedPrayer));
  check(`${form.combat} Protect from Melee does not block ranged spores`, queuedDamage(wrongRangedPrayer), [[form.ranged]]);

  const wrongMeleePrayer = makePlayer();
  pv(wrongMeleePrayer, 'prayer13', 1);
  const wrongMeleePrayerNpc = makeNpc(form.combat, wrongMeleePrayer, 1);
  withRandom([0.999999, 0.999999, 0, 0.999999], () => run('[proc,zygomite_attack]', wrongMeleePrayerNpc, wrongMeleePrayer));
  check(`${form.combat} Protect from Missiles does not block crush spores`, queuedDamage(wrongMeleePrayer), [[form.melee]]);

  const protectedRanged = makePlayer();
  pv(protectedRanged, 'prayer13', 1);
  const protectedRangedNpc = makeNpc(form.combat, protectedRanged, 2);
  withRandom([0.999999, 0], () => run('[proc,zygomite_attack]', protectedRangedNpc, protectedRanged));
  check(`${form.combat} Protect from Missiles blocks ranged spores`, queuedDamage(protectedRanged), [[0]]);

  const protectedMelee = makePlayer();
  pv(protectedMelee, 'prayer14', 1);
  const protectedMeleeNpc = makeNpc(form.combat, protectedMelee, 1);
  withRandom([0.999999, 0.999999, 0], () => run('[proc,zygomite_attack]', protectedMeleeNpc, protectedMelee));
  check(`${form.combat} Protect from Melee blocks crush spores`, queuedDamage(protectedMelee), [[0]]);
}

console.log(`PASS zygomite ${assertions} assertions`);
process.exit(0);
