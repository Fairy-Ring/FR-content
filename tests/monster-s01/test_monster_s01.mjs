#!/usr/bin/env node
/** S01 executes the real packed VM; only its documented RNG seam is controlled. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(here, '../../../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = async relative => import(pathToFileURL(path.join(engine, relative)).href);
const World = (await load('src/engine/World.ts')).default;
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const ScriptPointer = (await load('src/engine/script/ScriptPointer.ts')).default;
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
assert(ScriptProvider.load(pack) > 0, 'load a real compiled pack');
const { VarPlayerType, VarNpcType, NpcType, ObjType, InvType } = configs;
const id = (type, name) => {
  const value = type.getId(name);
  assert(value >= 0, `missing packed ${name}`);
  return value;
};
const wornId = id(InvType, 'worn');
const invId = id(InvType, 'inv');
World.currentTick = 100;
let serial = 0;
let assertions = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  assertions++;
  console.log(`PASS ${name} ${JSON.stringify(actual)}`);
}
function fixture(type) {
  const n = ++serial;
  const player = new Player(`s01vm${n}`, BigInt(1000 + n), BigInt(100000 + n));
  player.slot = n;
  player.pid = n;
  player.uid = ((1000 + n) << 11) | n;
  player.x = 3500 + n % 32;
  player.z = 3500 + Math.floor(n / 32);
  player.level = 0;
  player.isActive = true;
  player.vars.fill(0);
  player.baseLevels.fill(80);
  player.levels.fill(80);
  player.stats.fill(0);
  player.getInventory(wornId);
  player.getInventory(invId);
  player.testMessages = [];
  player.write = packet => player.testMessages.push(packet);
  player.messageGame = text => player.testMessages.push({ text: String(text) });
  player.wrappedMessageGame = player.messageGame;
  World.players[n] = player;
  World.playerLoop.add(player.hash64, player);
  const config = typeof type === 'number' ? NpcType.get(type) : NpcType.getByName(type);
  assert(config, `missing NPC ${type}`);
  const npc = new Npc(0, player.x + 1, player.z, config.size, config.size, EntityLifeCycle.RESPAWN, n, config.id, config.blockwalk);
  World.addNpc(npc, -1);
  npc.lastMovement = -100;
  npc.setVar(id(VarNpcType, 'npc_aggressive_player'), player.uid);
  return { player, npc };
}
function run(name, self, target = null, args = []) {
  const script = typeof name === 'string' ? ScriptProvider.getByName(name) : name;
  assert(script, `missing packed script ${name}`);
  const state = ScriptRunner.init(script, self, target, args);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  if (self instanceof Npc) self.executeScript(state);
  else self.executeScript(state, true, true);
  assert.equal(state.execution, ScriptState.FINISHED, `${script.name} must finish`);
  return state.intStack.slice(0, state.isp);
}
function random(values, action) {
  const original = JavaRandom.nextDouble;
  let draws = 0;
  JavaRandom.nextDouble = () => {
    assert(draws < values.length, `unexpected RNG draw ${draws + 1}`);
    return values[draws++];
  };
  try { const result = action(); assert.equal(draws, values.length, 'consume the precise RNG stream'); return result; }
  finally { JavaRandom.nextDouble = original; }
}
function settle(player, ticks = 4) {
  for (let n = 0; n < ticks; n++) { World.currentTick++; player.processQueues(); }
}
function wear(player, slot, name) {
  player.getInventory(wornId).set(slot, name ? { id: id(ObjType, name), count: 1 } : null);
}
function cap(player, npc, style, maximum = 23) {
  player.setVar(id(VarPlayerType, 'damagetype'), style);
  return run('[proc,npc_max_dealt]', player, npc, [maximum, 0])[0];
}
function unrelatedCaps() {
  const rows = [];
  for (const type of [1, 41, 81, 1154, 1604, 1612, 1831, 2690, NpcType.getByName('rd_combat_npc_room_3').id]) {
    for (const style of [0, 3, 4]) {
      const { player, npc } = fixture(type);
      rows.push({ type, debugname: NpcType.get(type).debugname, style, maximum: 23, cap: cap(player, npc, style) });
    }
  }
  return rows;
}
const baselineAt = process.argv.indexOf('--baseline');
if (baselineAt >= 0) {
  const rows = unrelatedCaps();
  writeFileSync(process.argv[baselineAt + 1], `${JSON.stringify({ contentCommit: 'fd897df92a72b94c536c5e6a27c0d2ae31771103', rows }, null, 2)}\n`);
  console.log(`PASS published damage-cap baseline ${rows.length} rows`);
  process.exit(0);
}
check('other NPC caps match the published pack in melee/ranged/magic', unrelatedCaps(), JSON.parse(readFileSync(path.join(here, 'published-max-dealt.json'), 'utf8')).rows);
for (const [name, hp] of [['slayer_dustdevil', 105], ['slayer_harpiebugswarm', 25], ['swamp_cave_slime', 25]]) {
  const { npc } = fixture(name);
  check(`${name} spawned HP`, npc.levels[NpcStat.HITPOINTS], hp);
}
for (const [name, item, slot] of [['slayer_dustdevil', 'slayer_facemask', 0], ['slayer_harpiebugswarm', 'slayer_buglan_on', 5]]) {
  for (const style of [0, 3, 4]) {
    const { player, npc } = fixture(name);
    check(`${name} no item style ${style}`, cap(player, npc, style), 0);
    player.getInventory(invId).set(0, { id: id(ObjType, item), count: 1 });
    check(`${name} carried item style ${style}`, cap(player, npc, style), 0);
    wear(player, slot, item);
    check(`${name} worn item style ${style}`, cap(player, npc, style), 23);
  }
}
{
  const { player, npc } = fixture('slayer_harpiebugswarm');
  wear(player, 5, 'slayer_buglan_off');
  check('unlit worn bug lantern does not qualify', cap(player, npc, 0), 0);
}
for (const protectedMelee of [false, true]) {
  const { player, npc } = fixture('slayer_dustdevil');
  if (protectedMelee) player.setVar(id(VarPlayerType, 'prayer14'), 1);
  run('[ai_opplayer2,slayer_dustdevil]', npc, player);
  check(`unmasked stat drain, prayer=${protectedMelee}`, ['ATTACK', 'STRENGTH', 'RANGED', 'MAGIC', 'DEFENCE', 'PRAYER', 'AGILITY'].map(s => player.levels[PlayerStat[s]]), [0, 0, 0, 0, 40, 40, 40]);
  settle(player);
  check(`unmasked damage, prayer=${protectedMelee}`, player.levels[PlayerStat.HITPOINTS], protectedMelee ? 80 : 66);
  npc.setVar(id(VarNpcType, 'npc_action_delay'), 0);
  run('[ai_opplayer2,slayer_dustdevil]', npc, player);
  check('drain is repeated on each unmasked attack', player.levels[PlayerStat.DEFENCE], 20);
}
{
  const { player, npc } = fixture('slayer_dustdevil');
  wear(player, 0, 'slayer_facemask');
  random([0, 0], () => run('[ai_opplayer2,slayer_dustdevil]', npc, player));
  check('facemask keeps ordinary stats', [...player.levels], [...player.baseLevels]);
}
for (const [label, rolls, expectedPoison] of [['accuracy miss', [0, 0], 0], ['successful zero at damage threshold below one', [0.999999, 0, 0.1], 0], ['positive hit at damage threshold above zero', [0.999999, 0, 0.5], 15]]) {
  const { player, npc } = fixture('swamp_cave_slime');
  player.setVar(id(VarPlayerType, 'com_stabdef'), 0);
  random(rolls, () => run('[proc,npc_meleeattack]', npc, player));
  settle(player);
  check(`published poison seam: ${label}`, player.getVar(id(VarPlayerType, 'poison')), expectedPoison);
  if (expectedPoison) {
    const before = player.levels[PlayerStat.HITPOINTS];
    run('[timer,poison]', player);
    settle(player);
    check('first slime poison damage is three', before - player.levels[PlayerStat.HITPOINTS], 3);
    check('published severity decay remains one', player.getVar(id(VarPlayerType, 'poison')), 14);
  }
}
{
  const { player, npc } = fixture('swamp_cave_slime');
  player.setVar(id(VarPlayerType, 'poison'), -10);
  random([0.999999, 0, 0.5], () => run('[proc,npc_meleeattack]', npc, player));
  settle(player);
  check('published antipoison immunity rejects slime poison', player.getVar(id(VarPlayerType, 'poison')), -10);
}
// Invoke real compiled attack labels, not just the cap helper: a refusal must
// precede damage-derived XP. Spell base-cast XP is intentionally unaffected.
for (const [name, item] of [['slayer_dustdevil', 'slayer_facemask'], ['slayer_harpiebugswarm', 'slayer_buglan_on']]) {
  for (const equipped of [false, true]) {
    for (const style of ['melee', 'ranged', 'magic']) {
      const { npc, player } = fixture(name);
      player.setVar(id(VarPlayerType, 'tutorial'), 1000);
      npc.setVar(id(VarNpcType, 'npc_combat_xp_multiplier'), 1000);
      player.setVar(id(VarPlayerType, 'damagestyle'), style === 'ranged' ? 4 : 0);
      player.setVar(id(VarPlayerType, 'damagetype'), style === 'ranged' ? 3 : 0);
      player.setVar(id(VarPlayerType, 'com_stabattack'), 1000000);
      player.setVar(id(VarPlayerType, 'com_rangeattack'), 1000000);
      player.setVar(id(VarPlayerType, 'com_magicattack'), 1000000);
      player.setVar(id(VarPlayerType, 'com_maxhit'), 10);
      if (equipped) wear(player, item === 'slayer_facemask' ? 0 : 5, item);
      if (style === 'melee') {
        random([0.999999, 0, 0.999999], () => run('[label,player_melee_attack]', npc, player));
        check(`${name} melee damage XP ${equipped}`, player.stats[PlayerStat.ATTACK], equipped ? 400 : 0);
      } else if (style === 'ranged') {
        const dart = id(ObjType, 'bronze_dart');
        player.getInventory(wornId).set(3, { id: dart, count: 10 });
        random([0.999999, 0, 0.999999, 0], () => run('[label,player_ranged_attack]', npc, player));
        check(`${name} ranged damage XP ${equipped}`, player.stats[PlayerStat.RANGED], equipped ? 400 : 0);
      } else {
        player.getInventory(invId).set(0, { id: id(ObjType, 'airrune'), count: 100 });
        player.getInventory(invId).set(1, { id: id(ObjType, 'mindrune'), count: 100 });
        random([0.999999, 0, 0.999999], () => run('[apnpct,magic:wind_strike]', npc, player));
        check(`${name} magic base plus damage XP ${equipped}`, player.stats[PlayerStat.MAGIC], equipped ? 95 : 55);
      }
      check(`${name} ${style} damage-derived HP XP ${equipped}`, player.stats[PlayerStat.HITPOINTS], equipped ? (style === 'magic' ? 26 : 133) : 0);
    }
  }
}
console.log(`PASS S01 ${assertions} assertions`);
process.exit(0);
