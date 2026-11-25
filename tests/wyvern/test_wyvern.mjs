#!/usr/bin/env node
/** Real packed skeletal-wyvern combat, Slayer admission, death and cave travel. */
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
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType',
  'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType',
  'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType',
  'IdkType', 'Component', 'FontType']) {
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

const { VarPlayerType, VarNpcType, ParamType, ObjType, NpcType, LocType, InvType, CategoryType, SeqType } = configs;
const id = (type, name) => {
  const value = type.getId(name);
  assert(value >= 0, `missing packed ${name}`);
  return value;
};
const ids = {
  inv: id(InvType, 'inv'),
  worn: id(InvType, 'worn'),
  slayerTarget: id(VarPlayerType, 'slayer_target'),
  slayerCount: id(VarPlayerType, 'slayer_count'),
  prayerMagic: id(VarPlayerType, 'prayer12'),
  prayerMissiles: id(VarPlayerType, 'prayer13'),
  prayerMelee: id(VarPlayerType, 'prayer14'),
  slashDefence: id(VarPlayerType, 'com_slashdef'),
  rangedDefence: id(VarPlayerType, 'com_rangedef'),
  aggressivePlayer: id(VarNpcType, 'npc_aggressive_player'),
  attackingUid: id(VarNpcType, 'npc_attacking_uid'),
  actionDelay: id(VarNpcType, 'npc_action_delay'),
  wyvernCategory: id(CategoryType, 'slayer_wyvern'),
  runeScimitar: id(ObjType, 'rune_scimitar'),
  elementalShield: id(ObjType, 'elemental_shield'),
  antiDragonShield: id(ObjType, 'antidragonbreathshield'),
  wyvernBones: id(ObjType, 'wyvern_bones'),
  slayerCategory: id(ParamType, 'slayer_category'),
  breathAnimation: id(SeqType, 'wyvern_skeleton_ice_breath')
};
const slayerCategoryParam = ParamType.get(ids.slayerCategory);
const FORMS = [
  { name: 'skeletal_wyvern1', id: 3068 },
  { name: 'skeletal_wyvern2', id: 3069 },
  { name: 'skeletal_wyvern3', id: 3070 },
  { name: 'skeletal_wyvern4', id: 3071 }
];
const wyvernSlayerRequirement = 72;

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
  check(`${label} finishes`, state.execution, ScriptState.FINISHED);
  return state;
}
const pv = (player, name, value) => player.setVar(id(VarPlayerType, name), value);
const nv = (npc, name, value) => npc.setVar(id(VarNpcType, name), value);

let playerSerial = 0;
let npcSerial = 0;
function makePlayer({ slayer = 99, taskTarget = 0, taskCount = 0, position = null } = {}) {
  const n = ++playerSerial;
  const hash = BigInt(9000 + n);
  const player = new Player(`wyvtest${n}`, hash, hash);
  player.slot = n;
  player.pid = n;
  player.uid = ((Number(hash & 0x1fffffn) << 11) | n) >>> 0;
  player.level = 0;
  player.x = position?.x ?? 3200 + ((n - 1) % 8) * 8;
  player.z = position?.z ?? 3300 + Math.floor((n - 1) / 8) * 8;
  player.isActive = true;
  player.vars.fill(0);
  player.baseLevels.fill(99);
  player.levels.fill(99);
  player.stats.fill(130344310);
  player.baseLevels[PlayerStat.SLAYER] = slayer;
  player.levels[PlayerStat.SLAYER] = slayer;
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
function makeNpc(name, player, distance = 1) {
  const type = NpcType.getByName(name);
  assert(type, `missing packed NPC ${name}`);
  const n = ++npcSerial;
  const npc = new Npc(0, player.x + distance, player.z, type.size, type.size,
    EntityLifeCycle.RESPAWN, n, type.id, type.blockwalk);
  World.addNpc(npc, -1);
  npc.lastMovement = World.currentTick - 100;
  nv(npc, 'npc_aggressive_player', player.uid);
  nv(npc, 'npc_attacking_uid', player.uid);
  npc.heroPoints.addHero(player.hash64, type.stats[NpcStat.HITPOINTS]);
  const spawn = requiredTrigger(ServerTriggerType.AI_SPAWN, type.id, type.category, `${name} ai_spawn`);
  expectFinished(run(spawn, npc), `${name} ai_spawn`);
  check(`${name} spawn preserves packed hitpoints`, npc.levels[NpcStat.HITPOINTS], type.stats[NpcStat.HITPOINTS]);
  return npc;
}
function fixture(name, options = {}) {
  const player = makePlayer(options);
  const npc = makeNpc(name, player, options.distance ?? 1);
  return { player, npc, type: NpcType.getByName(name) };
}
function queuedDamage(player) {
  return [...player.queue.all()]
    .filter(request => request.script.name === '[queue,combat_damage_player]')
    .map(request => request.args);
}
function seedForRoll(maxInclusive, result) {
  for (let seed = 0; seed < 1000000; seed++) {
    JavaRandom.setSeed(seed);
    if (Math.floor(JavaRandom.nextDouble() * (maxInclusive + 1)) === result) return seed;
  }
  assert.fail(`no JavaRandom seed maps to ${result} in 0..${maxInclusive}`);
}
function selectStats(player) {
  return [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.RANGED, PlayerStat.MAGIC]
    .map(stat => player.levels[stat]);
}
function withCapturedDrops(action) {
  const drops = [];
  const addObj = World.addObj;
  World.addObj = function (obj, receiver, duration) {
    drops.push({ id: obj.type, count: obj.count });
    return addObj.call(this, obj, receiver, duration);
  };
  try {
    action();
    return drops;
  } finally {
    World.addObj = addObj;
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
function firstDamage(player) {
  const values = queuedDamage(player);
  assert.equal(values.length, 1, 'one production attack queues one player hit');
  return values[0][0];
}

// Cache identity and category dispatch are checked for each of the four real 377 NPC forms.
for (const form of FORMS) {
  const type = NpcType.getByName(form.name);
  assert(type, `packed NPC ${form.name}`);
  check(`${form.name} 377 identity`, type.id, form.id);
  check(`${form.name} shared Slayer category`, type.category, ids.wyvernCategory);
  check(`${form.name} task category`, ParamHelper.getIntParam(ids.slayerCategory, type, slayerCategoryParam.defaultInt), wyvernSlayerRequirement);
  check(`${form.name} 200 HP`, type.stats[NpcStat.HITPOINTS], 200);

  for (const [event, trigger] of [
    ['ai_applayer2', ServerTriggerType.AI_APPLAYER2],
    ['ai_opplayer2', ServerTriggerType.AI_OPPLAYER2]
  ]) {
    const { player, npc } = fixture(form.name, { slayer: wyvernSlayerRequirement });
    const handler = requiredTrigger(trigger, type.id, type.category, `${form.name} ${event}`);
    check(`${form.name} ${event} resolves category handler`, handler.name, `[${event},_slayer_wyvern]`);
    World.currentTick++;
    JavaRandom.setSeed(seedForRoll(2, 2)); // Real PRNG selects the compiled breath branch at melee reach.
    expectFinished(run(handler, npc, player), `${form.name} ${event}`);
    check(`${form.name} ${event} breath animation`, npc.animId, ids.breathAnimation);
    check(`${form.name} ${event} attack cadence`, npc.getVar(ids.actionDelay), World.currentTick + 6);
    check(`${form.name} ${event} queues breath damage`, queuedDamage(player).length, 1);
  }
}

// The actual player Attack route uses the shared production Slayer gate: 71 cannot damage,
// while 72 enters the real melee attack and schedules positive NPC damage.
{
  const type = NpcType.getByName(FORMS[0].name);
  const attackTrigger = requiredTrigger(ServerTriggerType.OPNPC2, type.id, type.category, 'wyvern player Attack');
  check('wyvern player Attack uses the ordinary interaction handler', attackTrigger.name, '[opnpc2,_]');
  const low = fixture(FORMS[0].name, { slayer: 71 });
  low.player.getInventory(ids.worn).set(3, { id: ids.runeScimitar, count: 1 });
  run('[proc,player_combat_stat]', low.player);
  const lowHitpoints = low.npc.levels[NpcStat.HITPOINTS];
  expectFinished(run(attackTrigger, low.player, low.npc), 'Slayer 71 Attack refusal');
  check('Slayer 71 queues no NPC combat damage', [...low.npc.queue.all()].filter(q => q.queueId === ServerTriggerType.AI_QUEUE2).length, 0);
  check('Slayer 71 leaves wyvern hitpoints intact', low.npc.levels[NpcStat.HITPOINTS], lowHitpoints);
  check('Slayer 71 does not start attacking the wyvern', low.player.target === low.npc, false);

  let allowed = null;
  for (let seed = 0; seed < 256 && !allowed; seed++) {
    const attempt = fixture(FORMS[0].name, { slayer: wyvernSlayerRequirement });
    attempt.player.getInventory(ids.worn).set(3, { id: ids.runeScimitar, count: 1 });
    run('[proc,player_combat_stat]', attempt.player);
    JavaRandom.setSeed(seed);
    expectFinished(run(attackTrigger, attempt.player, attempt.npc), `Slayer 72 Attack seed ${seed}`);
    const damage = [...attempt.npc.queue.all()]
      .filter(q => q.queueId === ServerTriggerType.AI_QUEUE2)
      .map(q => q.lastInt)
      .find(value => value > 0);
    if (damage) allowed = { player: attempt.player, npc: attempt.npc, damage };
  }
  assert(allowed, 'Slayer 72 permits a real positive player hit against a skeletal wyvern');
  check('Slayer 72 positive damage is within wyvern HP', allowed.damage > 0 && allowed.damage <= 200, true);
}

// Reach-dependent attack styles exercise melee/ranged/breath selection without replacing RNG
// or handlers. Close reach can select all three; beyond one tile it can never select melee.
for (const [distance, expected] of [[1, [0, 1, 2]], [5, [1, 2]]]) {
  const { player, npc } = fixture(FORMS[0].name, { distance });
  const seen = new Set();
  JavaRandom.setSeed(0);
  for (let seed = 0; seed < 256 && seen.size < expected.length; seed++) {
    const state = run('[proc,wyvern_attack_style]', npc, player);
    expectFinished(state, `style selector at reach ${distance}, seed ${seed}`);
    seen.add(state.intStack[0]);
  }
  check(`reach ${distance} available attack styles`, [...seen].sort(), expected);
}

// Both normal physical branches cap at 13 and obey only their matching protection prayer.
function maxPhysicalDamage(proc, defenceVar) {
  const { player, npc } = fixture(FORMS[0].name);
  pv(player, defenceVar, 0);
  let maximum = 0;
  JavaRandom.setSeed(0);
  for (let seed = 0; seed < 512 && maximum < 13; seed++) {
    const prior = queuedDamage(player).length;
    expectFinished(run(`[proc,${proc}]`, npc, player), `${proc} seed ${seed}`);
    const queued = queuedDamage(player).slice(prior);
    for (const args of queued) maximum = Math.max(maximum, args[0]);
  }
  return maximum;
}
check('melee branch reaches its 13 maximum', maxPhysicalDamage('wyvern_melee', 'com_slashdef'), 13);
check('ranged branch reaches its 13 maximum', maxPhysicalDamage('wyvern_ranged', 'com_rangedef'), 13);

function physicalHit(proc, defenceVar, prayer = null) {
  const { player, npc } = fixture(FORMS[0].name);
  pv(player, defenceVar, 0);
  if (prayer) pv(player, prayer, 1);
  JavaRandom.setSeed(0);
  expectFinished(run(`[proc,${proc}]`, npc, player), `${proc} prayer=${prayer ?? 'none'}`);
  return firstDamage(player);
}
const meleeHit = physicalHit('wyvern_melee', 'com_slashdef');
assert(meleeHit > 0 && meleeHit <= 13, 'unprotected melee branch hits within its cap');
check('Protect from Melee blocks melee', physicalHit('wyvern_melee', 'com_slashdef', 'prayer14'), 0);
check('Protect from Missiles does not block melee', physicalHit('wyvern_melee', 'com_slashdef', 'prayer13'), meleeHit);
const rangedHit = physicalHit('wyvern_ranged', 'com_rangedef');
assert(rangedHit > 0 && rangedHit <= 13, 'unprotected ranged branch hits within its cap');
check('Protect from Missiles blocks ranged', physicalHit('wyvern_ranged', 'com_rangedef', 'prayer13'), 0);
check('Protect from Melee does not block ranged', physicalHit('wyvern_ranged', 'com_rangedef', 'prayer14'), rangedHit);

// The shield is counted only in the worn inventory. With identical real PRNG state, no shield
// permits the 50 maximum; a worn elemental shield caps it at 10 and suppresses current-stat drain.
const breathSeed = seedForRoll(50, 50);
function breathCase({ equipment = null, inventoryOnly = false, prayer = null } = {}) {
  const { player, npc } = fixture(FORMS[0].name, { slayer: wyvernSlayerRequirement });
  for (const stat of [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.RANGED, PlayerStat.MAGIC]) {
    player.baseLevels[stat] = 99;
    player.levels[stat] = 80;
  }
  if (equipment) player.getInventory(ids.worn).set(5, { id: id(ObjType, equipment), count: 1 });
  if (inventoryOnly) player.getInventory(ids.inv).set(0, { id: ids.elementalShield, count: 1 });
  if (prayer) pv(player, prayer, 1);
  const beforeBase = [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.RANGED, PlayerStat.MAGIC]
    .map(stat => player.baseLevels[stat]);
  JavaRandom.setSeed(breathSeed);
  expectFinished(run('[proc,wyvern_breath]', npc, player), `breath equipment=${equipment ?? 'none'}`);
  return { player, damage: firstDamage(player), beforeBase };
}
const bareBreath = breathCase();
check('unshielded breath reaches the 50 maximum', bareBreath.damage, 50);
check('unshielded breath drains ten percent of current combat stats', selectStats(bareBreath.player), [72, 72, 72, 72, 72]);
check('unshielded breath does not change base combat levels', bareBreath.beforeBase, [99, 99, 99, 99, 99]);
check('unshielded breath leaves prayer and Slayer unchanged', [bareBreath.player.levels[PlayerStat.PRAYER], bareBreath.player.levels[PlayerStat.SLAYER]], [99, 72]);
const wornElemental = breathCase({ equipment: 'elemental_shield' });
check('worn elemental shield caps breath at ten', wornElemental.damage, 10);
check('worn elemental shield prevents all five current-stat drains', selectStats(wornElemental.player), [80, 80, 80, 80, 80]);
const carriedElemental = breathCase({ inventoryOnly: true });
check('inventory-only elemental shield does not reduce breath', carriedElemental.damage, 50);
check('inventory-only elemental shield does not stop current-stat drain', selectStats(carriedElemental.player), [72, 72, 72, 72, 72]);
const wornAntiDragon = breathCase({ equipment: 'antidragonbreathshield' });
check('worn anti-dragon shield does not reduce icy breath', wornAntiDragon.damage, 50);
check('worn anti-dragon shield does not stop current-stat drain', selectStats(wornAntiDragon.player), [72, 72, 72, 72, 72]);
const meleePrayerBreath = breathCase({ prayer: 'prayer14' });
check('Protect from Melee blocks breath damage', meleePrayerBreath.damage, 0);
check('Melee prayer does not prevent unshielded breath stat drain', selectStats(meleePrayerBreath.player), [72, 72, 72, 72, 72]);
const shieldedPrayerBreath = breathCase({ equipment: 'elemental_shield', prayer: 'prayer14' });
check('elemental shield plus Melee prayer blocks breath', shieldedPrayerBreath.damage, 0);
check('shielded Melee prayer breath leaves current stats intact', selectStats(shieldedPrayerBreath.player), [80, 80, 80, 80, 80]);
const magicPrayerBreath = breathCase({ prayer: 'prayer12' });
check('Protect from Magic caps unshielded breath at twenty', magicPrayerBreath.damage, 20);
check('Protect from Magic does not prevent breath stat drain', selectStats(magicPrayerBreath.player), [72, 72, 72, 72, 72]);
const shieldedMagicPrayerBreath = breathCase({ equipment: 'elemental_shield', prayer: 'prayer12' });
check('worn elemental shield caps Protect from Magic breath at ten', shieldedMagicPrayerBreath.damage, 10);
check('shielded Magic-prayer breath leaves current stats intact', selectStats(shieldedMagicPrayerBreath.player), [80, 80, 80, 80, 80]);

// The trigger sets exactly the packed six-tick attack rate, ignores intervening callbacks, and
// becomes ready on the sixth tick. This uses the live ai_opplayer2 category dispatch.
{
  const { player, npc, type } = fixture(FORMS[0].name, { slayer: wyvernSlayerRequirement });
  const trigger = requiredTrigger(ServerTriggerType.AI_OPPLAYER2, type.id, type.category, 'wyvern six-tick cadence');
  const startTick = World.currentTick;
  JavaRandom.setSeed(seedForRoll(2, 2));
  expectFinished(run(trigger, npc, player), 'first wyvern attack');
  check('first attack waits six ticks', npc.getVar(ids.actionDelay), startTick + 6);
  const firstQueueCount = queuedDamage(player).length;
  World.currentTick = startTick + 5;
  JavaRandom.setSeed(seedForRoll(2, 2));
  expectFinished(run(trigger, npc, player), 'attack before six ticks');
  check('no second attack occurs before tick six', queuedDamage(player).length, firstQueueCount);
  check('early callback preserves original attack deadline', npc.getVar(ids.actionDelay), startTick + 6);
  World.currentTick = startTick + 6;
  JavaRandom.setSeed(seedForRoll(2, 2));
  expectFinished(run(trigger, npc, player), 'attack at tick six');
  check('attack repeats at tick six', queuedDamage(player).length, firstQueueCount + 1);
  check('second attack begins another six-tick interval', npc.getVar(ids.actionDelay), startTick + 12);
}

// Real category queue3 death pays one matching Slayer task kill and 200 XP, drops bones and the
// period common table, and never manufactures the later draconic visage.
for (const form of FORMS) {
  const player = makePlayer({ taskTarget: wyvernSlayerRequirement, taskCount: 2 });
  const npc = makeNpc(form.name, player);
  const type = NpcType.getByName(form.name);
  const death = requiredTrigger(ServerTriggerType.AI_QUEUE3, type.id, type.category, `${form.name} ai_queue3`);
  check(`${form.name} death dispatches through wyvern category`, death.name, '[ai_queue3,_slayer_wyvern]');
  const slayerXpBefore = player.stats[PlayerStat.SLAYER];
  expectFinished(run('[proc,npc_default_damage]', npc, player, [npc.levels[NpcStat.HITPOINTS]]), `${form.name} real lethal damage`);
  check(`${form.name} lethal damage queues real queue3`, [...npc.queue.all()].some(request => request.queueId === ServerTriggerType.AI_QUEUE3), true);
  JavaRandom.setSeed(0);
  const drops = withCapturedDrops(() => drainNpc(npc, [player]));
  check(`${form.name} real death removes NPC`, npc.isActive, false);
  check(`${form.name} decrements matching task once`, player.getVar(ids.slayerCount), 1);
  check(`${form.name} awards 200 Slayer XP in tenths`, player.stats[PlayerStat.SLAYER] - slayerXpBefore, 2000);
  check(`${form.name} drops wyvern bones`, drops.some(drop => drop.id === ids.wyvernBones && drop.count === 1), true);
  check(`${form.name} includes a common table item`, drops.length > 1, true);
  const visage = ObjType.getId('draconic_visage');
  check(`${form.name} death does not drop a draconic visage`, visage >= 0 && drops.some(drop => drop.id === visage), false);
}

// Both real packed location handlers work at Slayer 0 and use UNKNOWN engineering
// opposite-mouth landings. Packed collision and connectivity have a separate test.
function runLoc(name, x, z, destination) {
  const player = makePlayer({ slayer: 0, position: { x, z } });
  const type = LocType.getByName(name);
  assert(type, `packed location ${name}`);
  const loc = World.getLoc(x, z, 0, type.id);
  assert(loc, `native packed location ${name}`);
  const trigger = requiredTrigger(ServerTriggerType.OPLOC1, type.id, type.category, `${name} oploc1`);
  check(`${name} uses its named packed handler`, trigger.name, `[oploc1,${name}]`);
  expectFinished(run(trigger, player, loc), `${name} traversal`);
  check(`${name} teleports at Slayer 0`, [player.level, player.x, player.z], destination);
}
runLoc('wyvern_snow_cave_entrance', 3055, 9560, [0, 3056, 9555]);
runLoc('wyvern_snow_cave_exit', 3055, 9556, [0, 3056, 9562]);

console.log(`PASS wyvern ${assertions} assertions`);
process.exit(0);
