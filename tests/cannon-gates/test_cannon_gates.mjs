#!/usr/bin/env node
/** Execute packed cannon_fire and its shared caps with the production VM/RNG. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const content = path.resolve(here, '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = async file => import(pathToFileURL(path.join(engine, file)).href);
const World = (await load('src/engine/World.ts')).default;
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const ScriptPointer = (await load('src/engine/script/ScriptPointer.ts')).default;
const { ScriptOpcodeNameMap } = await load('src/engine/script/ScriptOpcode.ts');
const Npc = (await load('src/engine/entity/Npc.ts')).default;
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
assert(ScriptProvider.load(pack) > 0, 'load real packed scripts');
const id = (type, name) => {
  const value = configs[type].getId(name);
  assert(value >= 0, `missing packed ${type} ${name}`);
  return value;
};
const constant = (file, name) => {
  const match = new RegExp(`^\\^${name}\\s*=\\s*(\\d+)\\s*$`, 'm').exec(readFileSync(path.join(content, file), 'utf8'));
  assert(match, `missing checked-out constant ${name}`);
  return Number(match[1]);
};
const questConstants = 'scripts/quests/quest_soulbane/configs/soulbane.constant';
const pv = (p, name, value) => {
  const varp = configs.VarPlayerType.getId(name);
  if (varp >= 0) p.setVar(varp, value);
  else p.setVarBit(id('VarBitType', name), value);
};
const nv = (n, name, value) => n.setVar(id('VarNpcType', name), value);
const worn = id('InvType', 'worn');
World.currentTick = 100;
const sw = World.instances.createInstance(1, 8, 8);
const instance = World.instances.findInstanceByCoord(sw);
assert(instance, 'native owned-region fixture');
const ZoneMap = (await load('src/engine/zone/ZoneMap.ts')).default;
World.gameMap.createInstanceZone(ZoneMap.zoneIndex(sw.x, sw.z, 0));
let serial = 0, checks = 0;
function check(label, actual, expected) {
  assert.deepEqual(actual, expected, label);
  checks++;
}
function fixture(type = 'lesser_demon', style = 3) {
  const n = ++serial;
  const player = new Player(`cgate${n}`, BigInt(5000 + n), BigInt(500000 + n));
  player.slot = n; player.pid = n; player.uid = ((5000 + n) << 11) | n;
  player.level = 0; player.x = 3200; player.z = 3200;
  player.isActive = true;
  player.vars.fill(0); player.baseLevels.fill(80); player.levels.fill(80);
  player.stats.fill(19860680);
  player.getInventory(worn); player.getInventory(id('InvType', 'inv'));
  player.write = () => {}; player.messageGame = () => {}; player.wrappedMessageGame = () => {};
  World.players[n] = player; World.playerLoop.add(player.hash64, player);
  pv(player, 'tutorial', 1000); pv(player, 'rockthrower', 10);
  pv(player, 'ownedmcannon', ((player.x - 2) << 14) | player.z);
  pv(player, 'damagetype', style);
  for (const roll of ['com_stabattack', 'com_slashattack', 'com_crushattack', 'com_rangeattack', 'com_magicattack']) pv(player, roll, 1000000);
  const config = configs.NpcType.getByName(type);
  assert(config, `missing NPC ${type}`);
  const npc = new Npc(0, player.x + 1, player.z, config.size, config.size, EntityLifeCycle.RESPAWN, n, config.id, config.blockwalk);
  World.addNpc(npc, -1); npc.lastMovement = -100;
  nv(npc, 'npc_aggressive_player', player.uid);
  nv(npc, 'npc_combat_xp_multiplier', 1000);
  return { player, npc };
}
function run(name, player, npc, args = []) {
  const script = ScriptProvider.getByName(`[proc,${name}]`);
  assert(script, `missing packed ${name}`);
  const state = ScriptRunner.init(script, player, npc, args);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  player.executeScript(state, true, true);
  assert.equal(state.execution, ScriptState.FINISHED, `${name} finishes`);
  return state.intStack.slice(0, state.isp);
}
function draws(values, action) {
  const original = JavaRandom.nextDouble;
  let count = 0;
  JavaRandom.nextDouble = () => {
    assert(count < values.length, 'no extra random draw');
    return values[count++];
  };
  try { action(); check('precise draw count', count, values.length); }
  finally { JavaRandom.nextDouble = original; }
}
const wear = (p, item) => p.getInventory(worn).set(3, { id: id('ObjType', item), count: 1 });
function maximumCase(label, type, expected, setup = () => {}, admitted = true, style = 3) {
  const { player, npc } = fixture(type, style);
  setup(player, npc);
  check(`${label}: shared cap`, Math.min(30, run('npc_max_dealt', player, npc, [30, 0])[0]), expected);
  const xp = player.stats[PlayerStat.RANGED];
  draws(admitted ? [0.999999, 0, 0.999999] : [], () => run('cannon_fire', player, npc));
  check(`${label}: queued damage`, [...npc.queue.all()].map(q => q.lastInt), admitted ? [0, expected] : []);
  check(`${label}: damage XP`, player.stats[PlayerStat.RANGED] - xp,
    admitted ? Math.min(expected, npc.levels[NpcStat.HITPOINTS]) * 20 : 0);
  check(`${label}: ammunition`, player.getVar(id('VarPlayerType', 'rockthrower')), admitted ? 9 : 10);
}

// Ordinary accuracy is still the native CURRENT-style comparison. For each fixed
// seed, execute that comparison separately, then its conditional damage draw.
// The complete cannon must consume exactly that stream and leave the next draw
// unchanged. No baseline bytecode, recorded trace or generated script ID is used.
const nativeDouble = JavaRandom.nextDouble;
function styleStream(style) {
  let hits = 0, misses = 0;
  const styleFixture = () => {
    const result = fixture('lesser_demon', style);
    for (const [index, name] of ['com_stabattack', 'com_slashattack', 'com_crushattack', 'com_rangeattack', 'com_magicattack'].entries()) {
      pv(result.player, name, index === style ? 10000 : 0);
    }
    return result;
  };
  for (const seed of [1, 7, 31, 377, 65535, 987654321]) {
    const control = styleFixture();
    JavaRandom.setSeed(seed);
    const expectedDraws = [];
    JavaRandom.nextDouble = () => { const value = nativeDouble.call(JavaRandom); expectedDraws.push(value); return value; };
    let hit, damage, suffix;
    try {
      hit = run('player_npc_hit_roll', control.player, control.npc, [style])[0];
      damage = hit ? Math.floor(JavaRandom.nextDouble() * 31) : 0;
      suffix = nativeDouble.call(JavaRandom);
    } finally { JavaRandom.nextDouble = nativeDouble; }
    check('accuracy consumes two draws, successful damage consumes one', expectedDraws.length, hit ? 3 : 2);
    if (hit) hits++; else misses++;
    const actual = styleFixture();
    JavaRandom.setSeed(seed);
    const actualDraws = [];
    JavaRandom.nextDouble = () => { const value = nativeDouble.call(JavaRandom); actualDraws.push(value); return value; };
    try { run('cannon_fire', actual.player, actual.npc); }
    finally { JavaRandom.nextDouble = nativeDouble; }
    check(`style ${style} seed ${seed}: unchanged draw order`, actualDraws, expectedDraws);
    check(`style ${style} seed ${seed}: unchanged native RNG suffix`, nativeDouble.call(JavaRandom), suffix);
    check(`style ${style} seed ${seed}: unchanged damage`, [...actual.npc.queue.all()].map(q => q.lastInt), [0, damage]);
  }
  check(`style ${style}: fixed seeds include a hit`, hits > 0, true);
  check(`style ${style}: fixed seeds include a miss`, misses > 0, true);
}
for (const style of [0, 1, 2, 3, 4]) styleStream(style);

// Isolated wrong-style mutant at the cannon's native accuracy call. No source
// or pack file is changed; the real callee still executes its normal handler.
{
  const cannon = ScriptProvider.getByName('[proc,cannon_fire]');
  const hitRoll = ScriptProvider.getByName('[proc,player_npc_hit_roll]');
  const callOpcode = [...ScriptOpcodeNameMap].find(([, name]) => name === 'GOSUB_WITH_PARAMS')[0];
  const nativeCall = ScriptRunner.HANDLERS[callOpcode];
  ScriptRunner.HANDLERS[callOpcode] = state => {
    if (state.script === cannon && state.intOperand === hitRoll.id) state.intStack[state.isp - 1] = 3;
    nativeCall(state);
  };
  try {
    assert.throws(() => styleStream(0), /style 0 seed .*: unchanged (draw order|damage)/,
      'fixed-Ranged-style mutant must fail the current-style oracle');
  } finally { ScriptRunner.HANDLERS[callOpcode] = nativeCall; }
}
for (let damage = 0; damage <= 30; damage++) {
  const { player, npc } = fixture();
  draws([0.999999, 0, (damage + 0.5) / 31], () => run('cannon_fire', player, npc));
  check(`ordinary successful bin ${damage}`, [...npc.queue.all()].map(q => q.lastInt), [0, damage]);
}
{
  const { player, npc } = fixture();
  draws([0, 0], () => run('cannon_fire', player, npc));
  check('accuracy miss consumes no damage draw', [...npc.queue.all()].map(q => q.lastInt), [0, 0]);
}
maximumCase('Sir Leye male', 'rd_combat_npc_room_3', 0, p => { p.gender = 0; });
maximumCase('Sir Leye female', 'rd_combat_npc_room_3', 30, p => { p.gender = 1; });
maximumCase('harpie bare', 'slayer_harpiebugswarm', 0);
maximumCase('harpie carried lit lantern', 'slayer_harpiebugswarm', 0, p => p.getInventory(id('InvType', 'inv')).set(0, { id: id('ObjType', 'slayer_buglan_on'), count: 1 }));
maximumCase('harpie worn unlit lantern', 'slayer_harpiebugswarm', 0, p => p.getInventory(worn).set(5, { id: id('ObjType', 'slayer_buglan_off'), count: 1 }));
maximumCase('harpie worn lit lantern', 'slayer_harpiebugswarm', 30, p => p.getInventory(worn).set(5, { id: id('ObjType', 'slayer_buglan_on'), count: 1 }));
const enchanted = constant('scripts/quests/quest_fairy_farmers/configs/quest_fairy_farmers.constant', 'ft1_enchanted');
const tangle = (p) => { pv(p, 'fairy_farmers_quest', enchanted); wear(p, 'fairy_enchanted_secateurs'); };
maximumCase('Tanglefoot eligible melee owner', 'fairy_tanglefoot', 30, tangle, true, 0);
maximumCase('Tanglefoot no secateurs', 'fairy_tanglefoot', 0, p => pv(p, 'fairy_farmers_quest', enchanted), true, 0);
maximumCase('Tanglefoot current Ranged style', 'fairy_tanglefoot', 0, tangle);
maximumCase('Tanglefoot wrong quest stage', 'fairy_tanglefoot', 0, (p) => { tangle(p); pv(p, 'fairy_farmers_quest', enchanted - 1); }, true, 0);
maximumCase('Tanglefoot foreign owner', 'fairy_tanglefoot', 0, (p, n) => { tangle(p); nv(n, 'npc_aggressive_player', -1); }, true, 0);
maximumCase('Tanglefoot scaled cap', 'fairy_tanglefoot', 16, p => { tangle(p); p.levels[PlayerStat.FARMING] = 1; }, true, 0);
maximumCase('Tanglefoot scaling cannot exceed cannon maximum', 'fairy_tanglefoot', 30, p => { tangle(p); p.levels[PlayerStat.STRENGTH] = 1; }, true, 0);

function own(p, n, stage) {
  p.x = sw.x + 2; p.z = sw.z + 2; n.x = p.x + 1; n.z = p.z;
  pv(p, 'ownedmcannon', ((p.x - 2) << 14) | p.z);
  pv(p, 'soulbane_instance', instance.uid + 1); pv(p, 'soulbane_prog', stage);
  nv(n, 'npc_attacking_uid', p.uid); nv(n, 'npc_int', instance.uid + 1);
}
const groups = [
  { types: ['soulbane_anger_bear', 'soulbane_anger_unicorn', 'soulbane_anger_rat', 'soulbane_anger_goblin'], stage: 2,
    weapons: ['soulbane_anger_spearq', 'soulbane_anger_swordq', 'soulbane_anger_maceq', 'soulbane_anger_axeq'] },
  { types: ['soulbane_fear_reaper'], stage: 4, extra: p => pv(p, 'soulbane_fear_monspres', 1) },
  { types: ['soulbane_confu_creeper', 'soulbane_confu_creeper_fake1', 'soulbane_confu_creeper_fake2', 'soulbane_confu_creeper_fake3', 'soulbane_confu_creeper_fake4'], stage: constant(questConstants, 'soulbane_confusion_active') },
  { types: ['soulbane_hope_monst3', 'soulbane_hope_monst2', 'soulbane_hope_monst1'], stage: constant(questConstants, 'soulbane_hope_active') },
  { types: ['soulbane_final_tolna1', 'soulbane_final_tolna2', 'soulbane_final_tolna3'], stage: constant(questConstants, 'soulbane_tolna_active') }
];
for (const group of groups) for (const [index, type] of group.types.entries()) {
  const setup = (p, n) => { own(p, n, group.stage); group.extra?.(p); if (group.weapons) wear(p, group.weapons[index]); };
  maximumCase(`${type} eligible`, type, 30, setup);
  maximumCase(`${type} inactive`, type, 0, (p, n) => { setup(p, n); pv(p, 'soulbane_prog', group.stage + 1); }, false);
  maximumCase(`${type} foreign`, type, 0, (p, n) => { setup(p, n); nv(n, 'npc_attacking_uid', -1); }, false);
  if (group.weapons) maximumCase(`${type} wrong weapon`, type, 0, (p, n) => { setup(p, n); p.getInventory(worn).set(3, null); });
}
for (const [type, variable, value] of [
  ['soulbane_anger_bear', 'soulbane_anger_donespecial', 1],
  ['soulbane_fear_reaper', 'soulbane_fear_monspres', 0],
  ['soulbane_fear_reaper', 'soulbane_fear_killedtally', 5],
  ['soulbane_confu_creeper', 'soulbane_confu_door5pres', 1],
  ['soulbane_hope_monst3', 'soulbane_hope_killedtally', constant(questConstants, 'soulbane_hope_creatures')]
]) {
  const group = groups.find(g => g.types.includes(type));
  maximumCase(`${type} ${variable} closed`, type, 0, (p, n) => { own(p, n, group.stage); group.extra?.(p); pv(p, variable, value); }, false);
}
// Equipment checks outside npc_max_dealt are deliberately not moved here.
for (const type of ['slayer_kursk_1', 'slayer_turoth_dad', 'slayer_dustdevil']) maximumCase(`${type} unchanged`, type, 30);
maximumCase('native parameter cap 3', 'macro_triffidseed_angry', 3);
console.log(`PASS cannon gates ${checks} assertions; fixed-seed current-style streams and every shared gate`);
process.exit(0);
