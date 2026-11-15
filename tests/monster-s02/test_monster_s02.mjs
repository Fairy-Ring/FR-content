#!/usr/bin/env node
/** S02 uses the real compiled scripts. RNG is controlled only for hit-boundary cases. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(here, '../../../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const content = path.resolve(here, '../..');
const cannonComplete = /^\^mcannon_complete\s*=\s*(\d+)\s*$/m.exec(
  readFileSync(path.join(content, 'scripts/general/configs/quest.constant'), 'utf8'));
assert(cannonComplete, 'checked-out Dwarf Cannon completion constant');
const slayerRefusal = /if \(stat\(slayer\)[^\n]+\) \{[\s\S]*?\bmes\("([^"]+)"\);/.exec(
  readFileSync(path.join(content, 'scripts/skill_combat/scripts/player/player_combat.rs2'), 'utf8'));
assert(slayerRefusal, 'checked-out Slayer admission refusal');
const load = async relative => import(pathToFileURL(path.join(engine, relative)).href);
const World = (await load('src/engine/World.ts')).default;
const mapGeometry = await load('src/engine/GameMap.ts');
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const ScriptPointer = (await load('src/engine/script/ScriptPointer.ts')).default;
const Npc = (await load('src/engine/entity/Npc.ts')).default;
const Loc = (await load('src/engine/entity/Loc.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const { NpcStat } = await load('src/engine/entity/NpcStat.ts');
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const Environment = (await load('src/util/Environment.ts')).default;
const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
Environment.NODE_MEMBERS = true;
const configs = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType']) {
  configs[name] = (await load(`src/cache/config/${name}.ts`)).default;
  configs[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
assert(ScriptProvider.load(pack) > 0, 'load a real compiled pack');
World.gameMap.init();
assert(World.gameMap.getTotalLocs() > 0, 'load the real static map and teleport allocations');
World.npcs.reset();
const { VarPlayerType, VarBitType, VarNpcType, NpcType, ObjType, LocType, InvType } = configs;
const id = (type, name) => { const value = type.getId(name); assert(value >= 0, `missing packed ${name}`); return value; };
const wornId = id(InvType, 'worn');
const invId = id(InvType, 'inv');
const pv = (player, name, value) => player.setVar(id(VarPlayerType, name), value);
const nv = (npc, name, value) => npc.setVar(id(VarNpcType, name), value);
World.currentTick = 100;
let serial = 0;
let assertions = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  assertions++;
  console.log(`PASS ${name} ${JSON.stringify(actual)}`);
}
function fixture(type = 'slayer_killerwatt_ball', distance = 1, position = [0, 3100, 3300]) {
  const n = ++serial;
  const player = new Player(`s02vm${n}`, BigInt(2000 + n), BigInt(200000 + n));
  player.slot = n;
  player.pid = n;
  player.uid = ((2000 + n) << 11) | n;
  [player.level, player.x, player.z] = position;
  player.isActive = true;
  player.vars.fill(0);
  player.baseLevels.fill(80);
  player.levels.fill(80);
  player.stats.fill(19860680); // Level-80 XP, so real combat XP does not reset fixture stats.
  player.getInventory(wornId);
  player.getInventory(invId);
  player.testMessages = [];
  player.write = packet => player.testMessages.push(packet);
  player.messageGame = text => player.testMessages.push({ text: String(text) });
  player.wrappedMessageGame = player.messageGame;
  World.players[n] = player;
  World.playerLoop.add(player.hash64, player);
  pv(player, 'tutorial', 1000);
  const config = NpcType.getByName(type);
  assert(config, `missing NPC ${type}`);
  const npc = new Npc(player.level, player.x + distance, player.z, config.size, config.size, EntityLifeCycle.RESPAWN, n, config.id, config.blockwalk);
  World.addNpc(npc, -1);
  npc.lastMovement = -100;
  nv(npc, 'npc_aggressive_player', player.uid);
  return { player, npc };
}
function start(name, self, target = null, args = []) {
  const script = typeof name === 'string' ? ScriptProvider.getByName(name) : name;
  assert(script, `missing packed script ${name}`);
  const state = ScriptRunner.init(script, self, target, args);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  if (self instanceof Npc) self.executeScript(state);
  else self.executeScript(state, true, true);
  return state;
}
function run(name, self, target = null, args = []) {
  const state = start(name, self, target, args);
  assert.equal(state.execution, ScriptState.FINISHED, `${state.script.name} must finish`);
  return state.intStack.slice(0, state.isp);
}
function wear(player, name) { player.getInventory(wornId).set(10, name ? { id: id(ObjType, name), count: 1 } : null); }
function loc(name, level, x, z) {
  const config = LocType.getByName(name);
  assert(config, `missing loc ${name}`);
  return new Loc(level, x, z, config.width, config.length, EntityLifeCycle.RESPAWN, config.id, 10, 0);
}
// These are S02 invariants, not snapshots of another unit's current behaviour.
let controls = 0;
for (const name of ['man', 'chicken', 'cow', 'lesser_demon', 'slayer_banshee_1', 'slayer_cockatrice', 'slayer_dustdevil', 'slayer_harpiebugswarm']) {
  if (!NpcType.getByName(name)) continue;
  controls++;
  for (const style of [0, 3, 4]) {
    const { player, npc } = fixture(name);
    pv(player, 'damagetype', style);
    player.getInventory(invId).set(0, { id: id(ObjType, 'airrune'), count: 100 });
    player.getInventory(invId).set(1, { id: id(ObjType, 'mindrune'), count: 100 });
    nv(npc, 'killerwatt_awake_clock', 73);
    npc.timerInterval = 17;
    npc.timerClock = 11;
    const ownState = () => ({ type: npc.type, awake: npc.getVar(id(VarNpcType, 'killerwatt_awake_clock')),
      interval: npc.timerInterval, clock: npc.timerClock });
    for (const proc of ['player_in_combat_check', 'npc_is_attackable', 'npc_is_attackable_opt', 'pvm_combat_spell_checks']) {
      const before = ownState();
      run(`[proc,${proc}]`, player, npc, proc === 'pvm_combat_spell_checks' ? [id(configs.DbRowType, 'magic_spell_wind_strike')] : []);
      check(`${name} style ${style} ${proc} leaves S02 state untouched`, ownState(), before);
    }
  }
}
// Three independent NPC controls keep the shared-branch check meaningful without pinning every other unit's names.
check('at least three available unrelated NPC controls ran', controls >= 3, true);

const ball = id(NpcType, 'slayer_killerwatt_ball');
const biped = id(NpcType, 'slayer_killerwatt');
const wind = id(configs.DbRowType, 'magic_spell_wind_strike');
function runes(player) {
  player.getInventory(invId).set(0, { id: id(ObjType, 'airrune'), count: 100 });
  player.getInventory(invId).set(1, { id: id(ObjType, 'mindrune'), count: 100 });
}
function rng(values, action) {
  const original = JavaRandom.nextDouble;
  let draws = 0;
  JavaRandom.nextDouble = () => { assert(draws < values.length, 'unexpected RNG draw'); return values[draws++]; };
  try { const result = action(); assert.equal(draws, values.length, 'consume precise RNG stream'); return result; }
  finally { JavaRandom.nextDouble = original; }
}
function settle(player, ticks = 2) {
  for (let n = 0; n < ticks; n++) { World.currentTick++; player.processQueues(); }
}
function dialogue(player, state, choices = []) {
  let pauses = 0;
  while ((state.execution === ScriptState.PAUSEBUTTON || state.execution === ScriptState.SUSPENDED) && pauses++ < 100) {
    if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = player.delayedUntil;
      player.delayed = false;
    }
    const menu = state.script.name.match(/^\[proc,p_choice([2345])(?:_header)?\]$/);
    if (menu) {
      assert(choices.length > 0, `unanswered ${state.script.name}`);
      player.lastCom = id(configs.Component, `multi${menu[1]}:com_${choices.shift()}`);
    }
    player.runScript(state, true, true);
    assert.notEqual(state.execution, ScriptState.ABORTED, `dialogue aborted at ${state.script.name}`);
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'dialogue finishes');
  assert.equal(choices.length, 0, 'all offered choices consumed');
}
for (const name of ['slayer_killerwatt_ball', 'slayer_killerwatt']) {
  const { player, npc } = fixture(name);
  check(`${name} six native levels`, ['HITPOINTS', 'ATTACK', 'STRENGTH', 'DEFENCE', 'MAGIC', 'RANGED'].map(s => npc.baseLevels[NpcStat[s]]), [51, 50, 50, 40, 67, 67]);
  for (const parameter of ['attack_anim', 'defend_anim', 'death_anim', 'attack_sound', 'defend_sound', 'death_sound']) {
    check(`${name} M2 leaves ${parameter} on the published default`, NpcType.get(npc.type).params.has(id(configs.ParamType, parameter)), false);
  }
  player.levels[PlayerStat.SLAYER] = 36;
  check(`${name} below Slayer 37 refused by published admission`, run('[proc,player_in_combat_check]', player, npc), [0]);
  check('published Slayer refusal from the checked-out tree', player.testMessages.filter(p => p.text).at(-1)?.text, slayerRefusal[1]);
  player.levels[PlayerStat.SLAYER] = 37;
  check(`${name} Slayer 37 admitted`, run('[proc,player_in_combat_check]', player, npc), [1]);
}
for (const level of [36, 37]) {
  const { player } = fixture();
  player.baseLevels[PlayerStat.SLAYER] = level;
  player.lastSlot = 0;
  player.getInventory(invId).set(0, { id: id(ObjType, 'slayer_boots'), count: 1 });
  run('[opheld2,slayer_boots]', player);
  check(`boots wear at base Slayer ${level}`, player.getInventory(wornId).get(10)?.id ?? -1, level === 37 ? id(ObjType, 'slayer_boots') : -1);
  check(`boots leave inventory only when worn at ${level}`, player.getInventory(invId).get(0)?.id ?? -1, level === 37 ? -1 : id(ObjType, 'slayer_boots'));
  if (level === 36) check('no unsourced boots-refusal wording', player.testMessages.filter(p => p.text).map(p => p.text), []);
}
for (const trigger of ['[opnpc2,slayer_killerwatt_ball]', '[apnpc2,slayer_killerwatt_ball]', '[apnpct,magic:wind_strike]']) {
  const { player, npc } = fixture();
  runes(player);
  player.levels[PlayerStat.SLAYER] = 36;
  const before = { type: npc.type, vars: [...npc.vars], queue: [...npc.queue.all()], mode: npc.targetOp };
  run(trigger, player, npc);
  check(`${trigger} target refusal changes no NPC state`, { type: npc.type, vars: [...npc.vars], queue: [...npc.queue.all()], mode: npc.targetOp }, before);
}
for (const trigger of ['[opnpc2,slayer_killerwatt_ball]', '[apnpc2,slayer_killerwatt_ball]']) {
  const { player, npc } = fixture();
  pv(player, 'damagetype', 3);
  player.getInventory(wornId).set(3, { id: id(ObjType, 'shortbow'), count: 1 });
  run(trigger, player, npc);
  check(`${trigger} wakes before missing ammunition refusal`, npc.type, biped);
  check('no-ammunition attempt queues no damage', [...npc.queue.all()].filter(q => q.queueId === ServerTriggerType.AI_QUEUE2).length, 0);
}
{
  const { player, npc } = fixture();
  run('[apnpct,magic:wind_strike]', player, npc);
  check('manual spell without runes retains published resource-first order', npc.type, ball);
}
function firstAttack(name, trigger, ranged = false) {
  const { player, npc } = fixture(name);
  if (ranged) {
    pv(player, 'damagetype', 3);
    player.getInventory(wornId).set(3, { id: id(ObjType, 'shortbow'), count: 1 });
    player.getInventory(wornId).set(13, { id: id(ObjType, 'bronze_arrow'), count: 100 });
  }
  runes(player);
  rng(trigger.startsWith('[apnpc2,') && !ranged ? [] : ranged ? [0, 0, 0] : [0, 0], () => run(trigger, player, npc));
  return { player, npc, profile: {
    actionDelay: player.getVar(id(VarPlayerType, 'action_delay')) - World.currentTick,
    queues: [...npc.queue.all()].filter(q => q.queueId !== ServerTriggerType.AI_QUEUE19).map(q => ({ queue: q.queueId, delay: q.delay, damage: q.lastInt })),
    playerQueues: [...player.queue.all()].map(q => ({ name: q.script.name, delay: q.delay, args: q.args.map(v => v === npc.uid ? 'target' : v) })),
    targetOp: player.targetOp, hasTarget: player.target === npc,
    approachRange: player.apRange,
    messages: player.testMessages.filter(p => p.text).map(p => p.text),
    animation: player.animId, animationDelay: player.animDelay,
    xp: [...player.stats]
  } };
}
for (const [entry, ranged] of [['opnpc2', false], ['apnpc2', false], ['opnpc2', true], ['apnpc2', true], ['apnpct', false]]) {
  const own = entry === 'apnpct' ? '[apnpct,magic:wind_strike]' : `[${entry},slayer_killerwatt_ball]`;
  const ordinary = entry === 'apnpct' ? own : `[${entry},_]`;
  const control = firstAttack('man', ordinary, ranged);
  const changed = firstAttack('slayer_killerwatt_ball', own, ranged);
  check(`${entry} ranged=${ranged} published attack or approach scheduling`, changed.profile, control.profile);
  check(`${entry} ranged=${ranged} expected form after this phase`, changed.npc.type, entry === 'apnpc2' && !ranged ? ball : biped);
  check('form transition preserves native hitpoints', changed.npc.levels[NpcStat.HITPOINTS], 51);
}
for (const distance of [1, 2, 13]) {
  for (const boots of [false, true]) {
    const { player, npc } = fixture('slayer_killerwatt', distance);
    if (boots) wear(player, 'slayer_boots');
    const style = distance === 1 ? 2 : 4; // Retain the published default crush subtype.
    const maximum = boots ? (distance === 1 ? 6 : 8) : 15;
    check(`distance ${distance} style`, run('[proc,killerwatt_attack_style]', npc, player), [style]);
    check(`distance ${distance}, boots=${boots} maximum`, run('[proc,killerwatt_maxhit]', npc, player, [style]), [maximum]);
    const levels = [...player.levels];
    rng([0.999999, 0, 0.999999], () => run('[proc,killerwatt_attack]', npc, player));
    check('owned attack interval is two ticks', npc.getVar(id(VarNpcType, 'npc_action_delay')), World.currentTick + 2);
    check(`boots=${boots} attack queues the sourced maximum`, [...player.queue.all()].filter(q => q.script.name === '[queue,combat_damage_player]').map(q => q.args), [[maximum]]);
    check('no unsourced immediate stat drain', [...player.levels], levels);
    settle(player);
    check(`distance ${distance}, boots=${boots} damage received`, levels[PlayerStat.HITPOINTS] - player.levels[PlayerStat.HITPOINTS], maximum);
  }
}
for (const distance of [1, 2, 13]) {
  for (const prayer of ['prayer12', 'prayer13', 'prayer14']) {
    const { player, npc } = fixture('slayer_killerwatt', distance);
    wear(player, 'slayer_boots');
    pv(player, prayer, 1);
    const blocked = prayer === (distance === 1 ? 'prayer14' : 'prayer13');
    // The same accuracy draws hit without protection. A block consumes no damage draw.
    rng(blocked ? [0.999999, 0] : [0.999999, 0, 0.999999], () => run('[proc,killerwatt_attack]', npc, player));
    check(`distance ${distance}, ${prayer} protection`, [...player.queue.all()].filter(q => q.script.name === '[queue,combat_damage_player]').map(q => q.args), [[blocked ? 0 : distance === 1 ? 6 : 8]]);
  }
}
for (const magicDefence of [0, 1000000]) {
  const { player, npc } = fixture('slayer_killerwatt', 3);
  wear(player, 'slayer_boots');
  pv(player, 'prayer12', 1);
  pv(player, 'com_magicdef', magicDefence);
  pv(player, 'com_rangedef', magicDefence === 0 ? 1000000 : 0);
  const hit = magicDefence === 0;
  rng(hit ? [0.5, 0.999999, 0.999999] : [0.5, 0.999999], () => run('[proc,killerwatt_attack]', npc, player));
  check('distance attack uses Magic defence, not Ranged defence or Protect from Magic',
    [...player.queue.all()].filter(q => q.script.name === '[queue,combat_damage_player]').map(q => q.args), [[hit ? 8 : 0]]);
}

function poisonTrace(type, engaged = false, poisonBeforeWake = false) {
  const { player, npc } = fixture(type, 1, [2, 2660, 5210]);
  npc.turn(); // Prime native regeneration at full health, as in the reviewer's man probe.
  const hpBefore = npc.levels[NpcStat.HITPOINTS], started = World.currentTick;
  if (type === 'slayer_killerwatt_ball' && !poisonBeforeWake) run('[proc,killerwatt_wake]', player, npc);
  run('[proc,npc_poison_start]', player, npc, [20]);
  check(`${type} real npc_poison_start severity`, npc.getVar(id(VarNpcType, 'npc_poison')), 20);
  if (engaged) {
    player.levels[PlayerStat.HITPOINTS] = 10000; // Keep the real target alive, without modifying the NPC.
    rng([0, 0], () => run('[proc,killerwatt_attack]', npc, player));
  }
  const changes = [], forms = [];
  let previousHp = hpBefore, previousPoison = 20, previousType = npc.type;
  for (let turn = 1; turn <= 31; turn++) {
    World.currentTick = started + turn;
    if (poisonBeforeWake && turn === 5) run('[proc,killerwatt_wake]', player, npc);
    npc.turn();
    const hp = npc.levels[NpcStat.HITPOINTS], poison = npc.getVar(id(VarNpcType, 'npc_poison'));
    if (poison !== previousPoison) changes.push({ turn, damage: previousHp - hp, poison });
    if (npc.type !== previousType) forms.push({ turn, type: npc.type, poison, hp, timer: npc.timerInterval });
    previousHp = hp; previousPoison = poison; previousType = npc.type;
  }
  return { npc, hpBefore, hpAfter: npc.levels[NpcStat.HITPOINTS], changes, forms };
}
const ordinaryPoison = poisonTrace('man');
check('ordinary man probe takes four poison damage at native turn 30', [ordinaryPoison.hpBefore, ordinaryPoison.hpAfter, ordinaryPoison.changes],
  [7, 3, [{ turn: 30, damage: 4, poison: 19 }]]);
const awakePoison = poisonTrace('slayer_killerwatt_ball', true);
check('awake killerwatt poison has exactly the ordinary damage and turns', awakePoison.changes, ordinaryPoison.changes);
check('engaged poisoned killerwatt stays awake', awakePoison.npc.type, biped);
const returningPoison = poisonTrace('slayer_killerwatt_ball');
check('poisoned biped returns on the original eight-turn boundary without clearing poison', returningPoison.forms,
  [{ turn: 8, type: ball, poison: 20, hp: 51, timer: 30 }]);
check('returned ball still takes ordinary poison on the original turn', returningPoison.changes, ordinaryPoison.changes);
const wakingPoison = poisonTrace('slayer_killerwatt_ball', false, true);
check('waking an already-poisoned ball preserves the original poison deadline', wakingPoison.changes, ordinaryPoison.changes);
{
  const { player, npc } = fixture();
  player.getInventory(invId).set(0, { id: id(ObjType, 'slayer_boots'), count: 1 });
  check('carried boots do not protect', run('[proc,killerwatt_maxhit]', npc, player, [4]), [15]);
}
{
  const { player, npc } = fixture();
  npc.turn();
  const clock = World.currentTick, timer = npc.timerInterval;
  run('[proc,killerwatt_wake]', player, npc);
  npc.levels[NpcStat.HITPOINTS] = 31;
  for (let turn = 1; turn <= 7; turn++) { World.currentTick = clock + turn; npc.turn(); }
  check('form stays awake before engineering inactivity interval', npc.type, biped);
  World.currentTick++;
  npc.turn();
  check('deserted form returns at engineering inactivity boundary', npc.type, ball);
  check('return preserves damage rather than healing', npc.levels[NpcStat.HITPOINTS], 31);
  check('unpoisoned return leaves the native timer untouched', npc.timerInterval, timer);
}
{
  const { player, npc } = fixture();
  npc.turn();
  run('[proc,killerwatt_wake]', player, npc);
  npc.levels[NpcStat.HITPOINTS] = 31;
  npc.resetDefaults();
  check('native combat reset leaves the pending form check intact',
    [...npc.queue.all()].some(q => q.queueId === ServerTriggerType.AI_QUEUE19), true);
  World.currentTick += 8;
  npc.turn();
  check('native NPC turn returns the deserted form after a combat reset', npc.type, ball);
  check('native reset return preserves damage', npc.levels[NpcStat.HITPOINTS], 31);
  check('return owns no native poison timer', npc.timerInterval, NpcType.get(biped).timer);
}
{
  const { player, npc } = fixture();
  run('[proc,killerwatt_wake]', player, npc);
  rng([0, 0], () => run('[proc,killerwatt_attack]', npc, player));
  World.currentTick += 8;
  npc.turn();
  check('living engaged target holds the awake form beyond inactivity interval', npc.type, biped);
  player.x -= 20;
  World.currentTick++;
  npc.turn();
  check('withdrawal beyond owned attack range permits return', npc.type, ball);
}
{
  const { player } = fixture('slayer_killerwatt_ball', 3, [2, 2660, 5199]);
  pv(player, 'mcannon', Number(cannonComplete[1]));
  pv(player, 'ownedmcannon', -1);
  player.getInventory(invId).set(0, { id: id(ObjType, 'twpart1'), count: 1 });
  const origin = { x: player.x - 1, z: player.z - 1, level: player.level };
  dialogue(player, start('[opheld1,twpart1]', player));
  check('legal plane cannon setup records its owned origin', player.getVar(id(VarPlayerType, 'ownedmcannon')),
    (origin.level << 28) | (origin.x << 14) | origin.z);
  check('ordinary quest-complete account places the base at that origin',
    World.getLoc(origin.x, origin.z, origin.level, id(LocType, 'multicannon_base'))?.type, id(LocType, 'multicannon_base'));
  check('legal plane cannon setup consumes the carried base', player.getInventory(invId).get(0), null);
}
{
  const { player, npc } = fixture('slayer_killerwatt_ball', 3, [2, 2660, 5210]);
  // The real cannon proc only needs its owned origin, ammo and admitted target.
  // A packed coordinate is a native coord value, not a generated config id.
  pv(player, 'ownedmcannon', (2 << 28) | ((player.x - 1) << 14) | (player.z - 1));
  pv(player, 'rockthrower', 1);
  pv(player, 'com_stabattack', 1); // Nonzero native accuracy for the explicit maximum/zero accuracy draws.
  rng([0.999999, 0, 0.2], () => run('[proc,cannon_fire]', player, npc));
  const damage = [...npc.queue.all()].find(q => q.queueId === ServerTriggerType.AI_QUEUE2)?.lastInt;
  check('real cannon hit queues positive non-selection damage', damage > 0, true);
  for (let turn = 0; turn < 10 && npc.type === ball; turn++) { World.currentTick++; npc.turn(); }
  check('first cannon damage wakes the ball through native damage dispatch', npc.type, biped);
  check('non-selection wake preserves the published cannon damage', npc.levels[NpcStat.HITPOINTS], 51 - damage);
  const { npc: control } = fixture('slayer_killerwatt', 3);
  run('[proc,npc_default_retaliate_ap]', control);
  check('non-selection wake uses the same distant retaliation mode', npc.targetOp, control.targetOp);
}

function cannonMiss(player, npc) {
  pv(player, 'option_nodef', 1); // Observe NPC retaliation before the owner's manual Attack.
  pv(player, 'ownedmcannon', (2 << 28) | ((player.x - 1) << 14) | (player.z - 1));
  pv(player, 'rockthrower', 1);
  pv(player, 'com_stabattack', 1);
  rng([0, 0.999999], () => run('[proc,cannon_fire]', player, npc));
  const hit = [...npc.queue.all()].find(q => q.queueId === ServerTriggerType.AI_QUEUE2);
  check('real cannon miss queues zero damage', hit?.lastInt, 0);
  return Math.max(1, hit.delay);
}
function npcTurn(npc, draws = []) {
  World.currentTick++;
  rng(draws, () => npc.turn());
}
const wakeFailures = [];
function wakeCase(name, action) {
  try { action(); console.log(`PASS ${name}`); }
  catch (error) { wakeFailures.push({ name, error }); console.error(`FAIL ${name}: ${error.stack}`); }
}
for (const distance of [1, 2, 13]) {
  wakeCase(`cannon zero immediate wake and S02 style at distance ${distance}`, () => {
    const { player, npc } = fixture('slayer_killerwatt_ball', distance, [2, 2660, 5210]);
    wear(player, 'slayer_boots');
    // At the far boundary the ball wandered five tiles from its spawn. The owner
    // remains eight tiles from that spawn, inside the published OP retaliation guard.
    if (distance === 13) npc.startX -= 5;
    const flight = cannonMiss(player, npc);
    for (let turn = 0; turn < flight; turn++) npcTurn(npc);
    check('first state after zero cannon damage is the biped', npc.type, biped);
    check('zero cannon damage preserves full NPC hitpoints', npc.levels[NpcStat.HITPOINTS], 51);
    check('zero cannon wake admits AP retaliation, not published ball melee', npc.targetOp, 13);
    pv(player, distance === 1 ? 'prayer13' : 'prayer12', 1);
    npcTurn(npc, [0.999999, 0, 0.999999]);
    check('woken biped uses S02 boots maximum and the nonmatching prayer does not block',
      [...player.queue.all()].filter(q => q.script.name === '[queue,combat_damage_player]').map(q => q.args), [[distance === 1 ? 6 : 8]]);
    player.processQueues();
    pv(player, distance === 1 ? 'prayer13' : 'prayer12', 0);
    pv(player, distance === 1 ? 'prayer14' : 'prayer13', 1);
    npcTurn(npc);
    npcTurn(npc, [0.999999, 0]);
    check('woken biped obeys the S02 matching protection prayer',
      [...player.queue.all()].filter(q => q.script.name === '[queue,combat_damage_player]').map(q => q.args), [[0]]);
  });
}
wakeCase('cannon zero then later hit does not stall either combatant', () => {
  const { player, npc } = fixture('slayer_killerwatt_ball', 1, [2, 2660, 5210]);
  cannonMiss(player, npc);
  for (let turn = 1; turn <= 4; turn++) {
    npcTurn(npc, turn % 2 === 0 ? [0.999999, 0, 0.5] : []);
    player.processQueues();
  }
  // This is the reviewer's stalled sequence. The old head first fights as a ball,
  // then changes uid on this positive hit while the player still holds the ball uid.
  pv(player, 'rockthrower', 1);
  rng([0.999999, 0, 0.2], () => run('[proc,cannon_fire]', player, npc));
  npcTurn(npc);
  check('manual Attack admission after the cannon miss and later hit', run('[proc,player_in_combat_check]', player, npc), [1]);
  player.testMessages.length = 0;
  rng([0, 0], () => run('[opnpc2,_]', player, npc));
  check('manual Attack actually queues its own hit', [...npc.queue.all()].some(q => q.queueId === ServerTriggerType.AI_QUEUE2), true);
  check('manual Attack receives no combat refusal', player.testMessages.filter(p => p.text).map(p => p.text), []);
  npcTurn(npc, [0.999999, 0, 0.5]);
  check('biped fights back after the manual Attack', [...player.queue.all()].some(q => q.script.name === '[queue,combat_damage_player]'), true);
});
for (const positive of [false, true]) {
  wakeCase(`recoil ring after cannon zero, incoming ${positive ? 'positive' : 'zero'} hit`, () => {
    const { player, npc } = fixture('slayer_killerwatt_ball', 1, [2, 2660, 5210]);
    wear(player, 'slayer_boots');
    player.getInventory(wornId).set(12, { id: id(ObjType, 'ring_of_recoil'), count: 1 });
    cannonMiss(player, npc);
    npcTurn(npc);
    npcTurn(npc, positive ? [0.999999, 0, 0.999999] : [0, 0]);
    check('first attack with the recoil ring is already a biped attack, never a ball attack', npc.type, biped);
    const awake = npc.getVar(id(VarNpcType, 'killerwatt_awake_clock'));
    player.processQueues(); // Real combat_damage_player, including its recoil callback.
    check('published recoil queues damage only for a positive incoming hit',
      [...npc.queue.all()].filter(q => q.queueId === ServerTriggerType.AI_QUEUE2).map(q => q.lastInt), positive ? [1] : []);
    npcTurn(npc);
    check('recoil preserves the biped and does not wake twice', [npc.type, npc.getVar(id(VarNpcType, 'killerwatt_awake_clock'))], [biped, awake]);
    check('recoil damage uses the published queue and is retained', npc.levels[NpcStat.HITPOINTS], positive ? 50 : 51);
    check('recoil path leaves the owner admitted against the biped', run('[proc,player_in_combat_check]', player, npc), [1]);
  });
}
assert.equal(wakeFailures.length, 0, `cannon/recoil regressions: ${wakeFailures.map(failure => failure.name).join(', ')}`);
const portalBit = id(VarBitType, 'slayer_killerwatt_portal_check');
const warningBit = id(VarBitType, 'slayer_killerwatt_strobe_warning');
const portalBase = id(VarPlayerType, 'slayer_killerwatt_var');
const hidden = LocType.getByName('draynor_killerwatt_portal_hidden');
const visible = LocType.getByName('draynor_killerwatt_portal');
const stairs = [];
for (const quest of [0, 3]) {
  const { player } = fixture();
  pv(player, 'haunted', quest);
  player.level = 1; player.x = 3104; player.z = 3362;
  run('[oploc1,draynor_spiralstairs]', player, loc('draynor_spiralstairs', 1, 3104, 3362));
  stairs.push({ tile: [player.level, player.x, player.z], messages: player.testMessages.filter(p => p.text).map(p => p.text),
    portal: player.getVar(id(VarPlayerType, 'slayer_killerwatt_var')) });
  check(`quest ${quest} portal visibility`, player.getVarBit(portalBit), Number(quest === 3));
  const resolved = player.resolveLocTypeForTrigger(hidden);
  check(`quest ${quest} actual multiloc trigger resolution`, resolved.id, quest === 3 ? visible.id : hidden.id);
  check(`quest ${quest} client Enter option`, resolved.op?.[0] ?? null, quest === 3 ? 'Enter' : null);
}
check('quested and unquested ordinary stairs have the same published destination and messages',
  { tile: stairs[1].tile, messages: stairs[1].messages, otherBits: stairs[1].portal & ~1 },
  { tile: stairs[0].tile, messages: stairs[0].messages, otherBits: stairs[0].portal & ~1 });
{
  const { player, npc: professor } = fixture('professor_oddenstein', 1, [2, 3106, 3364]);
  // The published Ernest scene has its own suite. S02 owns only the portal-bit write.
  pv(player, 'haunted', 2);
  for (const [slot, item] of ['pressure_gauge', 'oil_can', 'rubber_tube'].entries()) {
    player.getInventory(invId).set(slot, { id: id(ObjType, item), count: 1 });
  }
  dialogue(player, start('[opnpc1,professor_oddenstein]', player, professor));
  check('native quest completion reveals portal without another climb', player.getVarBit(portalBit), 1);
}
for (const [boots, suppressed, choices, enters, remembers] of [
  [true, false, [3], false, false], [true, false, [1], true, false],
  [true, false, [2], true, true], [true, true, [], true, true],
  [false, true, [2], false, true], [false, true, [3], true, true],
  [false, true, [1, 1], false, true], [false, true, [1, 2], true, true]
]) {
  const { player } = fixture();
  player.level = 2; player.x = 3110; player.z = 3363;
  player.setVarBit(portalBit, 1);
  player.setVarBit(warningBit, Number(suppressed));
  if (boots) wear(player, 'slayer_boots');
  dialogue(player, start('[oploc1,draynor_killerwatt_portal]', player, loc('draynor_killerwatt_portal', 2, 3110, 3362)), [...choices]);
  if (!suppressed) {
    const emitted = player.testMessages.filter(packet => packet.constructor.name === 'IfSetText').map(packet => packet.text).join(' ').replace(/\s+/g, ' ');
    check('strobe warning emits the native formatted player name', emitted.includes(`${player.displayName} before you go through there I must warn you`), true);
  }
  check(`portal boots=${boots} suppressed=${suppressed} choices=${choices} destination`, [player.level, player.x, player.z], enters ? [2, 2677, 5214] : [2, 3110, 3363]);
  check('only explicit suppression changes warning choice', player.getVarBit(warningBit), Number(remembers));
  if (enters) {
    run('[oploc1,draynor_killerwatt_portal2]', player, loc('draynor_killerwatt_portal2', 2, 2678, 5214));
    check('home portal returns to manor beside the rift', [player.level, player.x, player.z], [2, 3110, 3363]);
    check('home portal return tile is unblocked', mapGeometry.isMapBlocked(player.x, player.z, player.level), false);
    check('home portal return can reach the natural manor rift', mapGeometry.reachedLoc(player.level, player.x, player.z, 3110, 3362, hidden.width, hidden.length, 1, 0, 10, hidden.forceapproach), true);
  }
}
{
  const { player } = fixture();
  const { PlayerLoading } = await load('src/engine/entity/PlayerLoading.ts');
  const Packet = (await load('src/io/Packet.ts')).default;
  player.setVarBit(portalBit, 1); player.setVarBit(warningBit, 1);
  const saved = player.save();
  const restored = PlayerLoading.load('s02reload', new Packet(saved), null);
  check('both portal choices survive native save/load', [restored.getVarBit(portalBit), restored.getVarBit(warningBit)], [1, 1]);
  check('portal varp stays permanent', VarPlayerType.get(portalBase).scope, VarPlayerType.SCOPE_PERM);
}
console.log(`PASS S02 packed mechanics ${assertions} assertions`);
process.exit(0); // The real World import owns background timers, as in other packed-map tests.
