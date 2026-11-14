#!/usr/bin/env node
/** CANDIDATE poison trigger rule. Runs the real packed VM, never a server.
 * Only JavaRandom is controlled; the effect-command observer calls every real handler.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
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
const { VarPlayerType, VarNpcType, NpcType, InvType, ParamType } = configs;
const id = (type, name) => { const n = type.getId(name); assert(n >= 0, `packed ${name}`); return n; };
const poisonId = id(VarPlayerType, 'poison');
const timerScript = ScriptProvider.getByName('[timer,poison]');
let serial = 0, checks = 0, tape = null;
const check = (label, actual, expected) => { assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`); };

// Slime/spider/cow have no natural ranged projectile. Borrow only valid delivery
// metadata from a real packed ranged NPC to exercise the shared ranged proc.
// Accuracy, damage stats, poison severity and the selected flag are not changed.
const deliveryNames = ['rangeattack_sound', 'proj_launch', 'proj_travel'];
const deliveryParams = deliveryNames.map(name => ParamType.getByName(name));
const deliveryDonor = Array.from({ length: NpcType.count }, (_, i) => NpcType.get(i)).find(npc =>
  deliveryParams.every(param => ParamHelper.getIntParam(param.id, npc, param.defaultInt) >= 0));
assert(deliveryDonor, 'real packed ranged delivery donor');
function withDelivery(style, f, action) {
  if (style !== 'ranged') return action();
  const config = NpcType.get(f.npc.type), original = config.params;
  config.params = new Map(original);
  for (const param of deliveryParams) config.params.set(param.id, ParamHelper.getIntParam(param.id, deliveryDonor, param.defaultInt));
  try { return action(); } finally { config.params = original; }
}

// Observe effect commands, not arithmetic, local variables or config reads. Keeping
// real handlers distinguishes a production queue/timer/damage from a fake outcome.
const effects = ['IF_CLOSE', 'QUEUE', 'QUEUE*', 'WEAKQUEUE', 'WEAKQUEUE*', 'STRONGQUEUE', 'STRONGQUEUE*', 'LONGQUEUE', 'LONGQUEUE*', 'CLEARQUEUE', 'SETTIMER', 'CLEARTIMER', 'POP_VARP', 'POP_VARN', 'POP_VARBIT', 'MES', 'DAMAGE', 'ANIM', 'NPC_ANIM', 'NPC_SETMODE', 'SOUND_SYNTH', 'SPOTANIM_PL', 'SPOTANIM_NPC', 'PROJANIM_MAP', 'PROJANIM_PL', 'PROJANIM_NPC'];
for (const name of effects) {
  const opcode = ScriptOpcodeMap.get(name), original = ScriptRunner.HANDLERS[opcode];
  assert(original, `real handler ${name}`);
  ScriptRunner.HANDLERS[opcode] = state => {
    if (tape) tape.push({ command: name, operand: state.intOperand, ints: state.intStack.slice(0, state.isp), strings: state.stringStack.slice(0, state.ssp) });
    original(state);
  };
}
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
function attack(style, outcome, f) {
  const rolls = outcome === 'miss' ? [0, 0] : [0.999999, 0, outcome === 'zero' ? 0 : 0.999999];
  withDelivery(style, f, () => random(rolls, () => {
    if (style === 'melee') run('[proc,npc_meleeattack]', f.npc, f.player);
    else if (style === 'ranged') run('[proc,npc_rangeattack]', f.npc, f.player);
    else run('[proc,npc_cast_spell]', f.npc, f.player, [51, 4]); // real Wind Strike spell constant
  }));
}
function snapshot(f) {
  const { player, npc } = f;
  return {
    poison: player.getVar(poisonId), hp: player.levels[PlayerStat.HITPOINTS], messages: player.testMessages,
    timer: [...player.timers.values()].map(t => ({ script: t.script.name, interval: t.interval, clock: t.clock })),
    queues: [...player.queue.all()].map(q => ({ script: q.script.name, args: q.args, delay: q.delay })),
    npcDelay: npc.getVar(id(VarNpcType, 'npc_action_delay'))
  };
}
const styles = ['melee', 'ranged', 'magic'];
Environment.NODE_MEMBERS = true;
// Fixed order also keeps actual entity UID arguments identical to the baseline.
const controls = [];
for (const style of styles) {
  for (const [type, outcome] of [['swamp_cave_slime', 'positive'], ['poisonspider', 'positive'], ['poisonspider', 'zero'], ['poisonspider', 'miss'], ['cow', 'positive']]) {
    const f = fixture(type); tape = []; attack(style, outcome, f); settle(f.player);
    controls.push({ style, type, outcome, commands: tape, result: snapshot(f) }); tape = null;
  }
}
const baselineArg = process.argv.indexOf('--record-published');
if (baselineArg !== -1) {
  for (const style of styles) {
    const f = fixture('swamp_cave_slime'); attack(style, 'zero', f); settle(f.player);
    check(`published ${style} successful zero does not poison`, f.player.getVar(poisonId), 0);
  }
  writeFileSync(process.argv[baselineArg + 1], `${JSON.stringify({ contentCommit: '7b07e3d3ae144aeec4fd1f450e353d58f433b513', controls }, null, 2)}\n`);
  console.log(`PASS published poison baseline ${controls.length} real effect-command traces`);
  process.exit(0);
}
const baseline = JSON.parse(readFileSync(path.join(here, 'published-commands.json'), 'utf8'));
check('published positive hits and unnamed/nonpoisonous controls retain identical real effect commands', controls, baseline.controls);
const flag = ParamType.getByName('poison_without_damage'); assert(flag, 'server poison flag packed');
check('zero-damage flag defaults to no', flag.defaultInt, 0);
check('zero-damage flag remains server-only', flag.autodisable, true);
const flagged = [];
for (let i = 0; i < NpcType.count; i++) {
  const config = NpcType.get(i);
  if (ParamHelper.getIntParam(flag.id, config, flag.defaultInt)) flagged.push(config.debugname);
}
check('only the named cave slime is flagged', flagged, ['swamp_cave_slime']);
for (const style of styles) {
  for (const [type, severity] of [['swamp_cave_slime', 15], ['poisonspider', 27], ['cow', 0]]) {
    for (const outcome of ['zero', 'positive', 'miss']) {
      const f = fixture(type); attack(style, outcome, f);
      const poisonQueues = [...f.player.queue.all()].filter(q => q.script.name === '[queue,poison_player]');
      const expected = severity > 0 && (outcome === 'positive' || (type === 'swamp_cave_slime' && outcome === 'zero')) ? severity : 0;
      check(`${style} ${type} ${outcome} poison queue count`, poisonQueues.length, expected ? 1 : 0);
      settle(f.player);
      check(`${style} ${type} ${outcome} poison result`, f.player.getVar(poisonId), expected);
      if (expected) {
        check(`${style} ${type} first poison message`, f.player.testMessages.filter(s => s === 'You have been poisoned!').length, 1);
        const timer = f.player.timers.get(timerScript.id);
        check(`${style} ${type} published timer interval`, timer.interval, 30);
        check(`${style} ${type} no immediate poison damage`, f.player.levels[PlayerStat.HITPOINTS], 80 - (outcome === 'zero' ? 0 : style === 'magic' ? 2 : run(style === 'melee' ? '[proc,npc_melee_maxhit]' : '[proc,npc_ranged_maxhit]', f.npc, f.player)[0]));
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
  const f = fixture('swamp_cave_slime');
  f.player.setVar(id(VarPlayerType, style === 'melee' ? 'prayer14' : style === 'ranged' ? 'prayer13' : 'prayer12'), 1);
  withDelivery(style, f, () => random([0.999999, 0], () => {
    if (style === 'melee') run('[proc,npc_meleeattack]', f.npc, f.player);
    else if (style === 'ranged') run('[proc,npc_rangeattack]', f.npc, f.player);
    else run('[proc,npc_cast_spell]', f.npc, f.player, [51, 4]);
  }));
  settle(f.player); check(`${style} matching protection prayer defeats a favorable accuracy roll without poison`, f.player.getVar(poisonId), 0);
}
{
  const f = fixture('swamp_cave_slime');
  attack('melee', 'zero', f); settle(f.player);
  const timer = f.player.timers.get(timerScript.id);
  const hp = f.player.levels[PlayerStat.HITPOINTS];
  Environment.NODE_MEMBERS = false;
  World.currentTick = timer.clock + 30;
  f.player.processTimers(timer.type); settle(f.player);
  check('existing poison still deals its first damage on a free world', hp - f.player.levels[PlayerStat.HITPOINTS], 3);
  check('existing poison still decays on a free world', f.player.getVar(poisonId), 14);
  check('existing poison timer remains on a free world', f.player.timers.has(timerScript.id), true);
  Environment.NODE_MEMBERS = true;
}
{
  const f = fixture('swamp_cave_slime'); f.npc.levels[NpcStat.HITPOINTS] = 0;
  attack('melee', 'zero', f); settle(f.player);
  check('dead melee NPC cannot poison through the additional zero branch', f.player.getVar(poisonId), 0);
}
console.log(`PASS poison rule: ${checks} assertions, real melee/ranged/magic scripts, no server`);
process.exit(0);
