#!/usr/bin/env node
/** CANDIDATE poison trigger rule. Runs the real packed VM, never a server.
 * Only JavaRandom is controlled; the effect-command observer calls every real handler.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(here, '../../../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = relative => import(pathToFileURL(path.join(engine, relative)).href);
const World = (await load('src/engine/World.ts')).default;
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const ScriptPointer = (await load('src/engine/script/ScriptPointer.ts')).default;
const { ScriptOpcodeMap } = await load('src/engine/script/ScriptOpcode.ts');
const Npc = (await load('src/engine/entity/Npc.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const { NpcStat } = await load('src/engine/entity/NpcStat.ts');
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const Environment = (await load('src/util/Environment.ts')).default;
const { ParamHelper } = await load('src/cache/config/ParamHelper.ts');
const configs = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType']) {
  configs[name] = (await load(`src/cache/config/${name}.ts`)).default;
  configs[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
assert(ScriptProvider.load(pack) > 0, 'a real built pack is required');
const { VarPlayerType, VarNpcType, NpcType, InvType, ParamType, DbTableType, DbRowType } = configs;
const id = (type, name) => { const n = type.getId(name); assert(n >= 0, `packed ${name}`); return n; };
const poisonId = id(VarPlayerType, 'poison');
const timerScript = ScriptProvider.getByName('[timer,poison]');
const spellTable = DbTableType.getByName('magic_spell_table');
const windStrike = DbRowType.getByName('magic_spell_wind_strike');
assert(spellTable && windStrike, 'real named Wind Strike data');
const spellValue = name => {
  const column = spellTable.columnNames.indexOf(name); assert(column >= 0, name);
  return windStrike.getValue(column, 0)[0];
};
let serial = 0, checks = 0, hitTape = null;
const check = (label, actual, expected) => { assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`); };

// Slime/spider/cow have no natural ranged projectile. Borrow only valid delivery
// metadata from a real packed ranged NPC to exercise the shared ranged proc.
// Accuracy, damage stats, poison severity and the selected flag are not changed.
const deliveryNames = ['rangeattack_sound', 'proj_launch', 'proj_travel'];
const deliveryParams = deliveryNames.map(name => ParamType.getByName(name));
const deliveryDonor = NpcType.getByName('ardougne_archer');
assert(deliveryDonor && deliveryParams.every(param => ParamHelper.getIntParam(param.id, deliveryDonor, param.defaultInt) >= 0), 'named real packed ranged delivery donor');
function withDelivery(style, f, action) {
  if (style !== 'ranged') return action();
  const config = NpcType.get(f.npc.type), original = config.params;
  config.params = new Map(original);
  for (const param of deliveryParams) config.params.set(param.id, ParamHelper.getIntParam(param.id, deliveryDonor, param.defaultInt));
  try { return action(); } finally { config.params = original; }
}

// Observe actual delivered hits while retaining the production handler. Actor
// identities are symbolic; no generated ids or saved command traces are compared.
const damageOpcode = ScriptOpcodeMap.get('DAMAGE');
const realDamage = ScriptRunner.HANDLERS[damageOpcode];
ScriptRunner.HANDLERS[damageOpcode] = state => {
  if (hitTape) {
    const [uid, type, damage] = state.intStack.slice(state.isp - 3, state.isp);
    assert.equal(uid, state.activePlayer.uid, 'damage targets the fixture player');
    hitTape.push({ target: 'player', type, damage });
  }
  realDamage(state);
};
function fixture(name) {
  const n = ++serial;
  World.currentTick = 100;
  const player = new Player(`poisonvm${n}`, BigInt(1000 + n), BigInt(100000 + n));
  player.slot = n; player.pid = n; player.uid = ((1000 + n) << 11) | n;
  player.x = 3500; player.z = 3500; player.level = 0; player.isActive = true;
  player.vars.fill(0); player.baseLevels.fill(80); player.levels.fill(80); player.stats.fill(0);
  player.getInventory(id(InvType, 'worn')); player.getInventory(id(InvType, 'inv'));
  player.testMessages = [];
  player.write = () => {};
  player.messageGame = text => player.testMessages.push(String(text));
  player.wrappedMessageGame = player.messageGame;
  for (const defence of ['com_stabdef', 'com_slashdef', 'com_crushdef', 'com_rangedef', 'com_magicdef']) player.setVar(id(VarPlayerType, defence), 0);
  World.players[n] = player; World.playerLoop.add(player.hash64, player);
  const config = NpcType.getByName(name); assert(config, name);
  const npc = new Npc(0, player.x + 1, player.z, config.size, config.size, EntityLifeCycle.RESPAWN, n, config.id, config.blockwalk);
  World.addNpc(npc, -1); npc.lastMovement = -100;
  npc.setVar(id(VarNpcType, 'npc_aggressive_player'), player.uid);
  return { player, npc };
}
function run(name, self, target = null, args = []) {
  const script = ScriptProvider.getByName(name); assert(script, name);
  const state = ScriptRunner.init(script, self, target, args);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  if (self instanceof Npc) self.executeScript(state); else self.executeScript(state, true, true);
  assert.equal(state.execution, ScriptState.FINISHED, `${name} finishes in the real VM`);
  return state.intStack.slice(0, state.isp);
}
function random(values, action) {
  const original = JavaRandom.nextDouble; let draws = 0;
  JavaRandom.nextDouble = () => { assert(draws < values.length, 'unexpected attack RNG draw'); return values[draws++]; };
  try { action(); assert.equal(draws, values.length, 'precise attack RNG consumption'); }
  finally { JavaRandom.nextDouble = original; }
}
function settle(player, ticks = 5) {
  const original = JavaRandom.nextDouble; JavaRandom.nextDouble = () => 0;
  try { for (let i = 0; i < ticks; i++) { World.currentTick++; player.processQueues(); } }
  finally { JavaRandom.nextDouble = original; }
}
function attack(style, outcome, f, prayer = null) {
  const protectedStyle = outcome === 'prayer' ? style : prayer;
  if (protectedStyle) f.player.setVar(id(VarPlayerType, protectedStyle === 'melee' ? 'prayer14' : protectedStyle === 'ranged' ? 'prayer13' : 'prayer12'), 1);
  const hiddenPoisonRoll = style === 'melee' && severityOf(NpcType.get(f.npc.type).debugname) > 0;
  const blockedAtAccuracy = protectedStyle === style && !hiddenPoisonRoll;
  const rolls = outcome === 'miss' ? [0, 0] : blockedAtAccuracy ? [0.999999, 0] : [0.999999, 0, outcome === 'zero' ? 0 : 0.999999];
  const ammo = ParamType.getByName('npc_ammo');
  if (style === 'ranged' && ParamHelper.getIntParam(ammo.id, NpcType.get(f.npc.type), ammo.defaultInt) !== -1) rolls.push(0.999999);
  withDelivery(style, f, () => random(rolls, () => {
    if (style === 'melee') run('[proc,npc_meleeattack]', f.npc, f.player);
    else if (style === 'ranged') run('[proc,npc_rangeattack]', f.npc, f.player);
    else run('[proc,npc_cast_spell]', f.npc, f.player, [spellValue('spell'), 4]);
  }));
}
const styles = ['melee', 'ranged', 'magic'];
Environment.NODE_MEMBERS = true;
// Rule assertions use pack-local effects, not stored command traces or bytecode.
// The old ranged/magic poisonous fixtures still test the published zero rule.
// Only melee is naturally reachable by the sixteen positive-severity types.
const samples = ['swamp_cave_slime', 'poisonspider', 'tribesman', 'slayer_cave_crawler_1', 'cow'];
const severityParam = ParamType.getByName('poison_severity'); assert(severityParam);
const severityOf = name => ParamHelper.getIntParam(severityParam.id, NpcType.getByName(name), severityParam.defaultInt);
const maxHit = (style, f) => style === 'magic' ? spellValue('maxhit') : run(style === 'melee' ? '[proc,npc_melee_maxhit]' : '[proc,npc_ranged_maxhit]', f.npc, f.player)[0];
const flag = ParamType.getByName('poison_without_damage'); assert(flag, 'server poison flag packed');
check('zero-damage flag defaults to no', flag.defaultInt, 0);
check('zero-damage flag is autodisabled when unused', flag.autodisable, true);
const flagged = [];
for (let i = 0; i < NpcType.count; i++) {
  const config = NpcType.get(i);
  if (ParamHelper.getIntParam(flag.id, config, flag.defaultInt)) flagged.push(config.debugname);
}
check('only the named cave slime is flagged', flagged, ['swamp_cave_slime']);
for (const style of styles) {
  for (const type of samples) {
    const severity = severityOf(type);
    check(`${style} ${type} sample poison severity classification`, severity > 0, type !== 'cow');
    for (const outcome of ['zero', 'positive', 'miss', 'prayer']) {
      const f = fixture(type);
      const damage = outcome === 'positive' ? maxHit(style, f) : 0;
      if (outcome === 'positive') assert(damage > 0, `${style} ${type} positive fixture has a configured damaging hit`);
      if (outcome === 'positive') console.log(`CONFIG ${style} ${type} maxhit=${damage} poison_severity=${severity}`);
      hitTape = []; attack(style, outcome, f);
      const poisonQueues = [...f.player.queue.all()].filter(q => q.script.name === '[queue,poison_player]');
      const expected = severity > 0 && (outcome === 'positive' || (style === 'melee' && outcome === 'prayer') || (type === 'swamp_cave_slime' && outcome === 'zero')) ? severity : 0;
      check(`${style} ${type} ${outcome} poison queue count`, poisonQueues.length, expected ? 1 : 0);
      check(`${style} ${type} ${outcome} queued poison severity`, poisonQueues.map(q => q.args), expected ? [[severity]] : []);
      settle(f.player);
      check(`${style} ${type} ${outcome} delivered hit`, hitTape, style === 'magic' && ['miss', 'prayer'].includes(outcome) ? [] : [{ target: 'player', type: damage > 0 ? 1 : 0, damage }]);
      hitTape = null;
      check(`${style} ${type} ${outcome} hitpoints follow the tested pack`, f.player.levels[PlayerStat.HITPOINTS], 80 - damage);
      check(`${style} ${type} ${outcome} poison result`, f.player.getVar(poisonId), expected);
      check(`${style} ${type} ${outcome} messages`, f.player.testMessages, expected ? ['You have been poisoned!'] : []);
      check(`${style} ${type} ${outcome} poison timer presence`, f.player.timers.has(timerScript.id), expected > 0);
      if (expected) {
        const timer = f.player.timers.get(timerScript.id);
        check(`${style} ${type} poison timer interval`, timer.interval, 30);
        const hp = f.player.levels[PlayerStat.HITPOINTS];
        World.currentTick = timer.clock + 29; f.player.processTimers(timer.type); settle(f.player, 0);
        check(`${style} ${type} no poison before tick 30`, f.player.getVar(poisonId), expected);
        World.currentTick++; f.player.processTimers(timer.type); settle(f.player);
        check(`${style} ${type} first poison damage`, hp - f.player.levels[PlayerStat.HITPOINTS], Math.floor((expected + 4) / 5));
        check(`${style} ${type} decay remains one`, f.player.getVar(poisonId), expected - 1);
      }
    }
  }
  for (const initial of [-10, 55]) {
    const f = fixture('swamp_cave_slime'); f.player.setVar(poisonId, initial);
    attack(style, 'zero', f); settle(f.player);
    check(`${style} immune/stronger player ${initial} unchanged`, f.player.getVar(poisonId), initial);
    check(`${style} immune/stronger player no new message ${initial}`, f.player.testMessages, []);
  }
  Environment.NODE_MEMBERS = false;
  for (const outcome of ['zero', 'positive']) {
    const f = fixture('swamp_cave_slime'); attack(style, outcome, f); settle(f.player);
    check(`${style} f2p ${outcome} poison unchanged`, f.player.getVar(poisonId), 0);
    check(`${style} f2p ${outcome} no poison timer`, f.player.timers.has(timerScript.id), false);
  }
  Environment.NODE_MEMBERS = true;
}
// Compare effects within this run. A real non-poisonous cow's published prayed
// attack is its ordinary accuracy-miss path: one zero hit, two RNG draws, and the
// same timing/retaliation. Neither config flags nor handlers are replaced.
function effects(style, outcome, type, prayer = null) {
  const f = fixture(type);
  hitTape = []; attack(style, outcome, f, prayer);
  const queues = [...f.player.queue.all()].map(q => ({
    script: q.script.name, args: q.args.map(value => value === f.npc.uid ? 'npc' : value)
  }));
  settle(f.player);
  const result = {
    hits: hitTape, poison: f.player.getVar(poisonId), messages: [...f.player.testMessages],
    levels: [...f.player.levels], experience: [...f.player.stats], queues,
    poisonTimer: f.player.timers.has(timerScript.id),
    actionDelay: f.npc.getVar(id(VarNpcType, 'npc_action_delay')),
    attacksPlayer: f.npc.getVar(id(VarNpcType, 'npc_attacking_uid')) === f.player.uid
  };
  hitTape = null;
  return result;
}
check('real cow prayed effects equal its published miss effects in the same run',
  effects('melee', 'positive', 'cow', 'melee'), effects('melee', 'miss', 'cow'));
for (const [style, type] of [['ranged', 'ardougne_archer'], ['magic', 'bearded_dark_wizard']]) {
  check(`${style} real control has no generic poison`, severityOf(type), 0);
  check(`${style} real control matching-prayer effects remain its published miss`,
    effects(style, 'positive', type, style), effects(style, 'miss', type));
}
for (const type of samples) {
  for (const outcome of ['positive', 'zero', 'miss']) {
    const result = effects('melee', outcome, type, 'melee');
    const expected = severityOf(type) > 0 && (outcome === 'positive' || (type === 'swamp_cave_slime' && outcome === 'zero')) ? severityOf(type) : 0;
    check(`prayed melee ${type} would-be ${outcome} poison`, result.poison, expected);
    check(`prayed melee ${type} would-be ${outcome} zero hit`, result.hits, [{ target: 'player', type: 0, damage: 0 }]);
    check(`prayed melee ${type} would-be ${outcome} hitpoints`, result.levels[PlayerStat.HITPOINTS], 80);
    check(`prayed melee ${type} would-be ${outcome} messages`, result.messages, expected ? ['You have been poisoned!'] : []);
    check(`prayed melee ${type} would-be ${outcome} poison timer`, result.poisonTimer, expected > 0);
    check(`wrong prayer leaves melee ${type} ${outcome} effects unchanged`,
      effects('melee', outcome, type, 'magic'), effects('melee', outcome, type));
  }
}
for (const initial of [-10, 55]) {
  const f = fixture('swamp_cave_slime'); f.player.setVar(poisonId, initial);
  attack('melee', 'zero', f, 'melee'); settle(f.player);
  check(`prayed slime immunity/stronger poison ${initial} unchanged`, f.player.getVar(poisonId), initial);
  check(`prayed slime immunity/stronger poison ${initial} no message`, f.player.testMessages, []);
}
Environment.NODE_MEMBERS = false;
{
  const result = effects('melee', 'positive', 'poisonspider', 'melee');
  check('prayed positive poison remains members-only', result.poison, 0);
  check('prayed free-world attack has no poison timer', result.poisonTimer, false);
}
Environment.NODE_MEMBERS = true;
{
  const f = fixture('swamp_cave_slime');
  attack('melee', 'zero', f); settle(f.player);
  const severity = severityOf('swamp_cave_slime');
  const timer = f.player.timers.get(timerScript.id);
  const hp = f.player.levels[PlayerStat.HITPOINTS];
  Environment.NODE_MEMBERS = false;
  World.currentTick = timer.clock + 30;
  f.player.processTimers(timer.type); settle(f.player);
  check('existing poison still deals its first damage on a free world', hp - f.player.levels[PlayerStat.HITPOINTS], Math.floor((severity + 4) / 5));
  check('existing poison still decays on a free world', f.player.getVar(poisonId), severity - 1);
  check('existing poison timer remains on a free world', f.player.timers.has(timerScript.id), true);
  Environment.NODE_MEMBERS = true;
}
{
  const f = fixture('swamp_cave_slime'); f.npc.levels[NpcStat.HITPOINTS] = 0;
  attack('melee', 'zero', f); settle(f.player);
  check('dead melee NPC cannot poison through the additional zero branch', f.player.getVar(poisonId), 0);
}
{
  const f = fixture('swamp_cave_slime'); f.npc.levels[NpcStat.HITPOINTS] = 0;
  attack('melee', 'positive', f, 'melee'); settle(f.player);
  check('dead prayed melee NPC cannot poison', f.player.getVar(poisonId), 0);
  check('dead prayed melee NPC cannot damage', f.player.levels[PlayerStat.HITPOINTS], 80);
}
console.log(`PASS poison rule: ${checks} assertions, real melee/ranged/magic scripts, no server`);
process.exit(0);
