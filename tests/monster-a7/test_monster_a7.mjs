#!/usr/bin/env node
/**
 * A7 goblins and cave goblins: exact packed combat rows, spawned levels and the real compiled
 * melee label's XP cap. Reads only the native pack; starts no server. Approved values are the
 * monster-combat-data A7 facts; skill order in the pack is attack, defence, strength, hitpoints,
 * ranged, magic.
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
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const ScriptPointer = (await load('src/engine/script/ScriptPointer.ts')).default;
const Npc = (await load('src/engine/entity/Npc.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const { NpcStat } = await load('src/engine/entity/NpcStat.ts');
const { ParamHelper } = await load('src/cache/config/ParamHelper.ts');
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const configs = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType']) {
  configs[name] = (await load(`src/cache/config/${name}.ts`)).default;
  configs[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
assert(ScriptProvider.load(pack) > 0, 'load a real compiled pack');
const { VarPlayerType, VarNpcType, NpcType, InvType, ParamType } = configs;
const id = (type, name) => {
  const value = type.getId(name);
  assert(value >= 0, `missing packed ${name}`);
  return value;
};

// Facts: a7-cave-goblin-hitpoints/-skills, a7-cave-goblin-miner-hitpoints/-skills,
// a7-cave-goblin-guard-hitpoints, -guard-level-26-skills, -guard-level-24-skills,
// a7-goblin-soldier-hitpoints/-skills, a7-cache-levels.
const FAMILIES = [
  { family: 'cave goblin', level: 3, attack: 1, defence: 1, strength: 1, hitpoints: 10,
    types: [['cave_goblin', 1822], ['cave_goblin2', 1823], ['cave_goblin3', 1824], ['cave_goblin4', 1825]] },
  { family: 'cave goblin miner', level: 11, attack: 10, defence: 7, strength: 12, hitpoints: 10,
    types: [['cave_goblin_miner', 2069], ['cave_goblin_miner2', 2070], ['cave_goblin_miner2_mining', 2076], ['cave_goblin_miner3', 2071], ['cave_goblin_miner4', 2072], ['cave_goblin_miner4_mining', 2078]] },
  { family: 'cave goblin guard level 26', level: 26, attack: 25, defence: 25, strength: 18, hitpoints: 26, types: [['cave_goblin_guard1', 2073]] },
  { family: 'cave goblin guard level 24', level: 24, attack: 22, defence: 22, strength: 16, hitpoints: 26, types: [['cave_goblin_guard2', 2074]] },
  { family: 'goblin soldier', level: 5, attack: 3, defence: 4, strength: 1, hitpoints: 12,
    types: [['goblin_green_soldier_1', 445], ['goblin_red_soldier_1', 444]] }
];
// Ranged and magic are 1 in every selected form and stay at the packed default.
const RANGED = 1, MAGIC = 1;
// A7 sets skills only: these server fields keep the engine's own defaults (no block is copied).
const SERVER_FIELDS = ['regenrate', 'category', 'wanderrange', 'maxrange', 'huntrange', 'timer', 'respawnrate', 'moverestrict',
  'attackrange', 'huntmode', 'defaultmode', 'members', 'blockwalk', 'givechase', 'patrolCoord', 'patrolDelay'];
// M2(b) and unchanged timing, style and bonuses: each effective parameter is the parameter's own default.
const DEFAULT_PARAMS = ['attackrate', 'damagetype', 'attackbonus', 'strengthbonus', 'stabdefence', 'slashdefence', 'crushdefence',
  'rangedefence', 'magicdefence', 'attack_anim', 'defend_anim', 'death_anim', 'attack_sound', 'defend_sound', 'death_sound', 'combat_xp_multiplier'];
const blank = new NpcType(-1);
blank.postDecode();

let assertions = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  assertions++;
  console.log(`PASS ${name} ${JSON.stringify(actual)}`);
}
const combatLevel = (attack, defence, strength, hitpoints, ranged, magic) =>
  Math.floor((10 * (defence + hitpoints) + 13 * Math.max(attack + strength, Math.floor(3 * ranged / 2), Math.floor(3 * magic / 2))) / 40);
const paramInt = (type, name) => {
  const param = ParamType.getByName(name);
  assert(param, `missing packed parameter ${name}`);
  return ParamHelper.getIntParam(param.id, type, param.defaultInt);
};

World.currentTick = 100;
let serial = 0;
function fixture(type) {
  const n = ++serial;
  const player = new Player(`a7vm${n}`, BigInt(7700 + n), BigInt(770000 + n));
  Object.assign(player, { slot: n, pid: n, uid: ((7700 + n) << 11) | n, x: 3500 + n % 32, z: 3500 + Math.floor(n / 32), level: 0, isActive: true });
  player.vars.fill(0);
  player.baseLevels.fill(80);
  player.levels.fill(80);
  player.stats.fill(0);
  player.getInventory(id(InvType, 'worn'));
  player.getInventory(id(InvType, 'inv'));
  player.write = () => {};
  player.messageGame = () => {};
  player.wrappedMessageGame = player.messageGame;
  World.players[n] = player;
  World.playerLoop.add(player.hash64, player);
  const npc = new Npc(0, player.x + 1, player.z, type.size, type.size, EntityLifeCycle.RESPAWN, n, type.id, type.blockwalk);
  World.addNpc(npc, -1);
  npc.lastMovement = -100;
  npc.setVar(id(VarNpcType, 'npc_aggressive_player'), player.uid);
  return { player, npc };
}
function random(values, action) {
  const original = JavaRandom.nextDouble;
  let draws = 0;
  JavaRandom.nextDouble = () => {
    assert(draws < values.length, `unexpected RNG draw ${draws + 1}`);
    return values[draws++];
  };
  try { action(); assert.equal(draws, values.length, 'consume the precise RNG stream'); }
  finally { JavaRandom.nextDouble = original; }
}
function attackLabel(player, npc) {
  const script = ScriptProvider.getByName('[label,player_melee_attack]');
  assert(script, 'missing packed [label,player_melee_attack]');
  const state = ScriptRunner.init(script, npc, player, []);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  player.executeScript(state, true, true);
  assert.equal(state.execution, ScriptState.FINISHED, 'player_melee_attack must finish');
}

for (const family of FAMILIES) {
  const expected = [family.attack, family.defence, family.strength, family.hitpoints, RANGED, MAGIC];
  check(`${family.family} census formula reproduces cache level ${family.level}`, combatLevel(...expected), family.level);
  for (const [name, original] of family.types) {
    const type = NpcType.getByName(name);
    assert(type, `missing packed NPC ${name}`);
    check(`${name} original id`, type.id, original);
    check(`${name} packed skills attack/defence/strength/hitpoints/ranged/magic`, Array.from(type.stats), expected);
    check(`${name} visible level`, type.vislevel, family.level);
    check(`${name} explicit parameters`, [...type.params.keys()], []);
    for (const field of SERVER_FIELDS) check(`${name} ${field} keeps the engine default`, type[field], blank[field]);
    for (const param of DEFAULT_PARAMS) check(`${name} effective ${param} is the parameter default`, paramInt(type, param), ParamType.getByName(param).defaultInt);
    const { player, npc } = fixture(type);
    const levels = [NpcStat.ATTACK, NpcStat.DEFENCE, NpcStat.STRENGTH, NpcStat.HITPOINTS, NpcStat.RANGED, NpcStat.MAGIC];
    check(`${name} spawned levels`, levels.map(stat => npc.levels[stat]), expected);
    check(`${name} spawned base levels`, levels.map(stat => npc.baseLevels[stat]), expected);
    // HP-XP offline: an accurate stab hit rolled at maximum 40 kills from full health; the label caps
    // the XP-bearing damage at the NPC's remaining hitpoints (player_melee.rs2), 40 tenths per point.
    player.setVar(id(VarPlayerType, 'tutorial'), 1000);
    player.setVar(id(VarPlayerType, 'damagestyle'), 0);
    player.setVar(id(VarPlayerType, 'damagetype'), 0);
    player.setVar(id(VarPlayerType, 'com_stabattack'), 1000000);
    player.setVar(id(VarPlayerType, 'com_maxhit'), 40);
    npc.setVar(id(VarNpcType, 'npc_combat_xp_multiplier'), paramInt(type, 'combat_xp_multiplier'));
    random([0.999999, 0, 0.999999], () => attackLabel(player, npc));
    check(`${name} accurate Attack XP tenths for a killing hit of 40 at full health`, player.stats[PlayerStat.ATTACK], 40 * family.hitpoints);
  }
}
console.log(`PASS A7 ${assertions} assertions`);
process.exit(0);
