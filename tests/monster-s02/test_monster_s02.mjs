#!/usr/bin/env node
/** S02 uses the real compiled scripts. RNG is controlled only for hit-boundary cases. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(here, '../../../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
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
function unrelated() {
  const rows = [];
  for (const name of ['man', 'chicken', 'cow', 'lesser_demon', 'slayer_banshee_1', 'slayer_cockatrice', 'slayer_dustdevil', 'slayer_harpiebugswarm']) {
    if (!NpcType.getByName(name)) continue;
    for (const style of [0, 3, 4]) {
      const { player, npc } = fixture(name);
      pv(player, 'damagetype', style);
      const spell = id(configs.DbRowType, 'magic_spell_wind_strike');
      player.getInventory(invId).set(0, { id: id(ObjType, 'airrune'), count: 100 });
      player.getInventory(invId).set(1, { id: id(ObjType, 'mindrune'), count: 100 });
      rows.push({ name, style,
        admission: run('[proc,player_in_combat_check]', player, npc),
        attackable: run('[proc,npc_is_attackable]', player, npc),
        attackableOpt: run('[proc,npc_is_attackable_opt]', player, npc),
        spellChecks: run('[proc,pvm_combat_spell_checks]', player, npc, [spell]),
        messages: player.testMessages.filter(p => p.text).map(p => p.text),
        type: NpcType.get(npc.type).debugname,
        actionDelay: player.getVar(id(VarPlayerType, 'action_delay')),
        queues: [...npc.queue.all()].map(q => ({ name: q.script.name, delay: q.delay, lastInt: q.lastInt })) });
    }
  }
  assert(rows.length >= 15, 'sample at least five unrelated types in three styles');
  const { player } = fixture();
  player.level = 1; player.x = 3104; player.z = 3362;
  run('[oploc1,draynor_spiralstairs]', player, loc('draynor_spiralstairs', 1, 3104, 3362));
  return { rows, unquestedStairs: { level: player.level, x: player.x, z: player.z,
    portal: player.getVarBit(id(VarBitType, 'slayer_killerwatt_portal_check')), messages: player.testMessages.filter(p => p.text).map(p => p.text) } };
}
if (process.argv.includes('--baseline')) {
  fs.writeFileSync(path.join(here, 'published-paths.json'), `${JSON.stringify({ contentCommit: '7b07e3d3ae144aeec4fd1f450e353d58f433b513', ...unrelated() }, null, 2)}\n`);
  console.log('PASS captured published unrelated paths and unquested stairs');
  process.exit(0);
}
const baseline = JSON.parse(fs.readFileSync(path.join(here, 'published-paths.json'), 'utf8'));
check('shared spell/admission results and ordinary stairs match published pack', unrelated(), { rows: baseline.rows, unquestedStairs: baseline.unquestedStairs });

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
  player.levels[PlayerStat.SLAYER] = 36;
  check(`${name} below Slayer 37 refused by published admission`, run('[proc,player_in_combat_check]', player, npc), [0]);
  check('published Slayer refusal text', player.testMessages.filter(p => p.text).at(-1)?.text, 'You need a higher Slayer level to know how to wound this monster.');
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
  check('no-ammunition attempt queues no damage', [...npc.queue.all()].length, 0);
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
    queues: [...npc.queue.all()].map(q => ({ queue: q.queueId, delay: q.delay, damage: q.lastInt })),
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
for (const [distance, prayer, blocked] of [[1, 'prayer14', true], [2, 'prayer12', true], [1, 'prayer12', false], [2, 'prayer14', false]]) {
  const { player, npc } = fixture('slayer_killerwatt', distance);
  wear(player, 'slayer_boots');
  pv(player, prayer, 1);
  rng(blocked ? [0, 0] : [0.999999, 0, 0.999999], () => run('[proc,killerwatt_attack]', npc, player));
  check(`distance ${distance}, ${prayer} protection`, [...player.queue.all()].filter(q => q.script.name === '[queue,combat_damage_player]').map(q => q.args), [[blocked ? 0 : distance === 1 ? 6 : 8]]);
}
{
  const { player, npc } = fixture();
  player.getInventory(invId).set(0, { id: id(ObjType, 'slayer_boots'), count: 1 });
  check('carried boots do not protect', run('[proc,killerwatt_maxhit]', npc, player, [4]), [15]);
}
{
  const { player, npc } = fixture();
  const clock = World.currentTick;
  run('[proc,killerwatt_wake]', player, npc);
  npc.levels[NpcStat.HITPOINTS] = 31;
  World.currentTick = clock + 7;
  run('[ai_timer,slayer_killerwatt]', npc);
  check('form stays awake before engineering inactivity interval', npc.type, biped);
  World.currentTick++;
  run('[ai_timer,slayer_killerwatt]', npc);
  check('deserted form returns at engineering inactivity boundary', npc.type, ball);
  check('return preserves damage rather than healing', npc.levels[NpcStat.HITPOINTS], 31);
  check('ball return stops owned timer', npc.timerInterval, 0);
}
{
  const { player, npc } = fixture();
  run('[proc,killerwatt_wake]', player, npc);
  npc.levels[NpcStat.HITPOINTS] = 31;
  npc.resetDefaults();
  check('native combat reset retains the one-tick form timer', npc.timerInterval, 1);
  World.currentTick += 8;
  npc.turn();
  check('native NPC turn returns the deserted form after a combat reset', npc.type, ball);
  check('native reset return preserves damage', npc.levels[NpcStat.HITPOINTS], 31);
  check('native reset return stops the ball timer', npc.timerInterval, 0);
}
{
  const { player, npc } = fixture();
  run('[proc,killerwatt_wake]', player, npc);
  rng([0, 0], () => run('[proc,killerwatt_attack]', npc, player));
  World.currentTick += 8;
  run('[ai_timer,slayer_killerwatt]', npc);
  check('living engaged target holds the awake form beyond inactivity interval', npc.type, biped);
  player.x -= 20;
  run('[ai_timer,slayer_killerwatt]', npc);
  check('withdrawal beyond owned attack range permits return', npc.type, ball);
}
{
  const { player, npc } = fixture();
  run('[proc,npc_default_damage]', player, npc, [5]);
  check('non-selection damage does not invent a form transition', npc.type, ball);
  check('ball still takes damage through the published path', npc.levels[NpcStat.HITPOINTS], 46);
}
const portalBit = id(VarBitType, 'slayer_killerwatt_portal_check');
const warningBit = id(VarBitType, 'slayer_killerwatt_strobe_warning');
const portalBase = id(VarPlayerType, 'slayer_killerwatt_var');
const hidden = LocType.getByName('draynor_killerwatt_portal_hidden');
const visible = LocType.getByName('draynor_killerwatt_portal');
for (const quest of [0, 3]) {
  const { player } = fixture();
  pv(player, 'haunted', quest);
  player.level = 1; player.x = 3104; player.z = 3362;
  run('[oploc1,draynor_spiralstairs]', player, loc('draynor_spiralstairs', 1, 3104, 3362));
  check(`quest ${quest} ordinary stairs destination`, [player.level, player.x, player.z], [2, 3105, 3364]);
  check(`quest ${quest} portal visibility`, player.getVarBit(portalBit), Number(quest === 3));
  const resolved = player.resolveLocTypeForTrigger(hidden);
  check(`quest ${quest} actual multiloc trigger resolution`, resolved.id, quest === 3 ? visible.id : hidden.id);
  check(`quest ${quest} client Enter option`, resolved.op?.[0] ?? null, quest === 3 ? 'Enter' : null);
}
{
  const { player, npc: professor } = fixture('professor_oddenstein', 1, [2, 3106, 3364]);
  const config = NpcType.getByName('questchicken');
  const chicken = new Npc(2, 3108, 3364, config.size, config.size, EntityLifeCycle.RESPAWN, ++serial, config.id, config.blockwalk);
  World.addNpc(chicken, -1);
  pv(player, 'haunted', 2);
  for (const [slot, item] of ['pressure_gauge', 'oil_can', 'rubber_tube'].entries()) {
    player.getInventory(invId).set(slot, { id: id(ObjType, item), count: 1 });
  }
  dialogue(player, start('[opnpc1,professor_oddenstein]', player, professor));
  check('native quest completion on portal floor completes Ernest', player.getVar(id(VarPlayerType, 'haunted')), 3);
  check('native quest completion reveals portal without another climb', player.getVarBit(portalBit), 1);
  check('quest still transforms Ernest through its published proc', chicken.type, id(NpcType, 'ernest'));
  check('quest still consumes its three items', [0, 1, 2].map(slot => player.getInventory(invId).get(slot)), [null, null, null]);
}
const Environment = (await load('src/util/Environment.ts')).default;
Environment.NODE_MEMBERS = true;
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
