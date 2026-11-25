#!/usr/bin/env node
/** Execute the real packed Kings scripts, native accuracy, death and lifecycle. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertKingLootTables } from './loot-oracle.mjs';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = async relative => import(pathToFileURL(path.join(engine, relative)).href);
const World = (await load('src/engine/World.ts')).default;
const Provider = (await load('src/engine/script/ScriptProvider.ts')).default;
const Runner = (await load('src/engine/script/ScriptRunner.ts')).default;
const State = (await load('src/engine/script/ScriptState.ts')).default;
const Pointer = (await load('src/engine/script/ScriptPointer.ts')).default;
const Trigger = (await load('src/engine/script/ServerTriggerType.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const Npc = (await load('src/engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const { NpcStat } = await load('src/engine/entity/NpcStat.ts');
const { NpcModeMap } = await load('src/engine/entity/NpcMode.ts');
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const Environment = (await load('src/util/Environment.ts')).default;
const { ParamHelper } = await load('src/cache/config/ParamHelper.ts');
const configs = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType']) {
  configs[name] = (await load(`src/cache/config/${name}.ts`)).default;
  configs[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
assert(Provider.load(pack) > 0, 'build the sibling engine pack first');
assert.equal(Environment.NODE_PRODUCTION, false, 'offline non-production VM policy');
assert.equal(Environment.NODE_XPRATE, 1, 'unmultiplied native Slayer XP');
Environment.NODE_MEMBERS = true;
const { VarPlayerType, VarNpcType, NpcType, ObjType, InvType, ParamType, SeqType, SpotanimType, HuntType } = configs;
const id = (type, name) => { const value = type.getId(name); assert(value >= 0, `packed ${name}`); return value; };
const param = (npc, name) => { const p = ParamType.getByName(name); assert(p, name); return ParamHelper.getIntParam(p.id, npc, p.defaultInt); };
const constant = (relative, name) => {
  const rows = [...readFileSync(path.join(content, relative), 'utf8').matchAll(new RegExp(`^\\s*\\^${name}\\s*=\\s*(-?\\d+)\\s*(?:\\/\\/.*)?$`, 'gm'))];
  assert.equal(rows.length, 1, `one named ${name}`); return Number(rows[0][1]);
};
const styles = Object.fromEntries(['stab', 'slash', 'crush', 'ranged', 'magic'].map(name => [name,
  constant('scripts/skill_combat/configs/combat_damagetypes.constant', `${name}_style`)]));
const checks = { definitions: 0, styleCases: 0, weaknessCases: 0, attacks: 0, hunts: 0, lootCases: 0, lifecycleCases: 0 };
const same = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks.definitions++; };
const originalRandom = JavaRandom.nextDouble;
let serial = 0;
World.currentTick = 1000;

function fixture(name, distance = 1) {
  const hash = BigInt(20000 + ++serial);
  const player = new Player(`kings${serial}`, hash, hash);
  player.slot = 1; player.pid = 1; player.uid = ((Number(hash & 0x1fffffn) << 11) | 1) >>> 0;
  player.isActive = true; player.level = 0; player.x = 3200; player.z = 3200;
  player.vars.fill(0); player.baseLevels.fill(99); player.levels.fill(99);
  player.getInventory(id(InvType, 'worn')); player.getInventory(id(InvType, 'inv'));
  player.write = () => {}; player.messageGame = () => {};
  World.players[1] = player; World.playerLoop.add(hash, player);
  World.gameMap.getZone(player.x, player.z, player.level).enter(player);
  const type = NpcType.getByName(name); assert(type, name);
  const npc = new Npc(0, player.x + distance, player.z, type.size, type.size, EntityLifeCycle.RESPAWN, World.npcs.next(), type.id, type.blockwalk);
  World.addNpc(npc, -1); World.processNpcEventQueue(); npc.lastMovement = -100;
  assert.strictEqual(World.npcs.get(npc.nid), npc, 'native registered fixture');
  return { player, npc, type };
}
function dispose({ player, npc }) {
  if (npc.isActive) World.removeNpc(npc, -1);
  if (World.npcs.get(npc.nid) === npc) { World.npcs.remove(npc.nid); npc.cleanup(); }
  World.gameMap.getZone(player.x, player.z, player.level).leave(player);
  if (World.players[player.slot] === player) World.players[player.slot] = null;
  player.unlink();
}
function random(values, action) {
  let cursor = 0;
  JavaRandom.nextDouble = () => {
    assert(cursor < values.length, 'fixture supplied all native RNG draws'); return values[cursor++];
  };
  try { return action(); } finally { JavaRandom.nextDouble = originalRandom; }
}
function run(name, f, args = [], playerFirst = false) {
  const script = Provider.getByName(name); assert(script, `packed ${name}`);
  const state = Runner.init(script, playerFirst ? f.player : f.npc, playerFirst ? f.npc : f.player, args);
  state.pointerAdd(Pointer.ProtectedActivePlayer);
  if (playerFirst) f.player.executeScript(state, true, true); else f.npc.executeScript(state);
  assert.equal(state.execution, State.FINISHED, `${name} must finish`);
  return state;
}
function settlePlayer(player, bound = 20) {
  for (let tick = 0; player.queue.all().some(row => row.script?.name === '[queue,combat_damage_player]') && tick < bound; tick++) {
    player.processQueues(); World.currentTick++;
  }
  player.processQueues();
  assert(!player.queue.all().some(row => row.script?.name === '[queue,combat_damage_player]'), 'native player damage queue completed');
}
function trigger(f, kind) {
  const script = Provider.getByTrigger(Trigger[kind], f.type.id, f.type.category);
  assert(script, `${f.type.debugname}: native ${kind} dispatch`); return script;
}
function observe(target, method, records) {
  const had = Object.hasOwn(target, method), original = target[method];
  target[method] = function (...args) { records.push({ args, tick: World.currentTick }); return original.apply(this, args); };
  return () => { if (had) target[method] = original; else delete target[method]; };
}

// Independent numeric oracle: waterbirth-monsters.kings-candidate-combat-vectors-and-cycles.
// Defences are Stab/Slash/Crush/Magic/Ranged, not values read from the NPC config.
// The dated 2017 Supreme Ranged increase is undone; 2025 Earth weakness is excluded.
const kings = [
  { name: 'dagcave_ranged_boss', display: 'Dagannoth Supreme', npcId: 2881, effective: 'melee',
    stats: [255, 255, 255, 128, 255, 255], defence: [10, 10, 10, 255, 255], style: 'ranged', max: 30,
    animation: 'dagannoth_meganoth_attack_range', mode: 'APPLAYER2', hunt: 'aggressive_ranged', range: 8, huntRadius: 8 },
  { name: 'dagcave_magic_boss', display: 'Dagannoth Prime', npcId: 2882, effective: 'ranged',
    stats: [255, 255, 255, 255, 255, 0], defence: [255, 255, 255, 255, 10], style: 'magic', max: 50,
    animation: 'dagannoth_meganoth_attack_mage', mode: 'APPLAYER2', hunt: 'aggressive_ranged', range: 8, huntRadius: 8 },
  { name: 'dagcave_melee_boss', display: 'Dagannoth Rex', npcId: 2883, effective: 'magic',
    stats: [332, 255, 255, 255, 0, 255], defence: [255, 255, 255, 10, 255], style: 'slash', max: 26,
    animation: 'dagannoth_meganoth_attack_melee', mode: 'OPPLAYER2', hunt: 'aggressive_melee', range: 1, huntRadius: 5 },
];
const statNames = ['HITPOINTS', 'ATTACK', 'STRENGTH', 'DEFENCE', 'MAGIC', 'RANGED'];
for (const king of kings) {
  const type = NpcType.getByName(king.name); assert(type, king.name);
  same(type.id, king.npcId, `${king.name}: original 377 identity`);
  same(type.name, king.display, `${king.name}: original display name`);
  same(type.size, 3, `${king.name}: original three-tile footprint`);
  same(type.vislevel, 303, `${king.name}: original displayed combat level`);
  for (const [index, stat] of statNames.entries()) same(type.stats[NpcStat[stat]], king.stats[index], `${king.name}: ${stat}`);
  for (const [index, name] of ['stabdefence', 'slashdefence', 'crushdefence', 'magicdefence', 'rangedefence'].entries())
    same(param(type, name), king.defence[index], `${king.name}: ${name}`);
  for (const name of ['attackbonus', 'strengthbonus', 'rangeattack', 'rangebonus', 'magicattack'])
    same(param(type, name), 0, `${king.name}: ${name}`);
  same(param(type, 'damagetype'), styles[king.style], `${king.name}: outgoing attack style`);
  same(param(type, 'attackrate'), 4, `${king.name}: four-tick attack interval`);
  same(type.attackrange, king.range, `${king.name}: named engineering attack range`);
  same(type.huntrange, king.huntRadius, `${king.name}: named engineering hunt radius`);
  same(type.wanderrange, 5, `${king.name}: named engineering wander radius`);
  same(type.maxrange, 16, `${king.name}: named engineering pursuit radius`);
  same(type.respawnrate, 150, `${king.name}: candidate respawn interval`);
  same(type.huntmode, id(HuntType, king.hunt), `${king.name}: native aggression`);
  same(param(type, 'slayer_category'), constant('scripts/skill_slayer/configs/slayer.constant', 'slayer_dagannoth'), `${king.name}: published dagannoth Slayer category`);

  for (const [name, style] of Object.entries(styles)) {
    const f = fixture(king.name);
    try {
      f.player.setVar(id(VarPlayerType, 'damagetype'), style);
      const control = fixture('cow');
      try {
        control.player.setVar(id(VarPlayerType, 'damagetype'), style);
        // Every ordinary/special caller uses the unchanged published pre-XP seam.
        for (const spell of [0, 1]) {
          const cap = run('[proc,npc_max_dealt]', f, [23, spell], true);
          const baseline = run('[proc,npc_max_dealt]', control, [23, spell], true);
          same(cap.intStack.slice(0, cap.isp), baseline.intStack.slice(0, baseline.isp), `${king.name}: ${name}, spell ${spell}: published control cap`);
          same(cap.intStack.slice(0, cap.isp), [23], `${king.name}: no style-specific cap`);
        }
      } finally { dispose(control); }
      checks.styleCases++;
    } finally { dispose(f); }
  }

  // Exercise native presentation, damage queues and XP against a control NPC.
  for (const style of ['melee', 'ranged', 'magic']) {
    const outcomes = [];
    for (const name of [king.name, 'cow']) {
      const f = fixture(name), { player, npc } = f;
      try {
        // Equal base/current HP avoids the control cow's cap and overstat decay.
        npc.baseLevels[NpcStat.HITPOINTS] = npc.levels[NpcStat.HITPOINTS] = king.stats[0];
        player.stats.fill(0);
        player.setVar(id(VarPlayerType, 'tutorial'), 1000);
        npc.setVar(id(VarNpcType, 'npc_combat_xp_multiplier'), 1000);
        player.setVar(id(VarPlayerType, 'damagestyle'), style === 'ranged' ? 4 : 0);
        player.setVar(id(VarPlayerType, 'damagetype'), styles[style === 'melee' ? 'stab' : style]);
        for (const key of ['com_stabattack', 'com_rangeattack', 'com_magicattack']) player.setVar(id(VarPlayerType, key), 1000000);
        player.setVar(id(VarPlayerType, 'com_maxhit'), 10);
        const before = npc.levels[NpcStat.HITPOINTS];
        if (style === 'melee') {
          random([0.999999, 0, 0.999999], () => run('[label,player_melee_attack]', f));
          same(player.stats[PlayerStat.ATTACK], 400, `${name}: real melee damage XP`);
        } else if (style === 'ranged') {
          player.getInventory(id(InvType, 'worn')).set(3, { id: id(ObjType, 'bronze_dart'), count: 10 });
          random([0.999999, 0, 0.999999, 0], () => run('[label,player_ranged_attack]', f));
          same(player.stats[PlayerStat.RANGED], 400, `${name}: real ranged damage XP`);
        } else {
          player.getInventory(id(InvType, 'inv')).set(0, { id: id(ObjType, 'airrune'), count: 100 });
          player.getInventory(id(InvType, 'inv')).set(1, { id: id(ObjType, 'mindrune'), count: 100 });
          random([0.999999, 0, 0.999999], () => run('[apnpct,magic:wind_strike]', f));
          same(player.stats[PlayerStat.MAGIC], 95, `${name}: real Magic base plus damage XP`);
        }
        same(player.stats[PlayerStat.HITPOINTS], style === 'magic' ? 26 : 133, `${name}: real damage-derived Hitpoints XP`);
        for (let tick = 0; tick < 8; tick++) { World.currentTick++; npc.turn(); }
        const damage = before - npc.levels[NpcStat.HITPOINTS];
        same(damage, style === 'magic' ? 2 : 10, `${name}: native ${style} hit reaches NPC`);
        outcomes.push({ damage, xp: [...player.stats] });
      } finally { dispose(f); }
    }
    same(outcomes[0], outcomes[1], `${king.name}: successful ${style} matches published control with identical rolls`);
    checks.styleCases++;
  }

  // Fixed attacker: level 99, no Prayer, zero equipment bonus, +9 effective levels.
  // Published roll procs supply A/D for randominc(A) > randominc(D).
  // The exact discrete chance is compared by direction, not a pinned percentage.
  {
    const f = fixture(king.name), chances = {};
    try {
      const effective = run('[proc,combat_effective_stat]', f, [99, 100], true).intStack[0] + 9;
      const attack = run('[proc,combat_stat]', f, [effective, 0], true).intStack[0];
      for (const name of ['com_stabattack', 'com_rangeattack', 'com_magicattack']) f.player.setVar(id(VarPlayerType, name), attack);
      for (const style of ['melee', 'ranged', 'magic']) {
        const kind = styles[style === 'melee' ? 'stab' : style];
        const a = run('[proc,player_attack_roll_specific]', f, [kind], true).intStack[0];
        const d = run('[proc,npc_defence_roll_specific]', f, [kind], true).intStack[0];
        chances[style] = a <= d ? a / (2 * (d + 1)) : 1 - (d + 2) / (2 * (a + 1));
      }
      for (const style of ['melee', 'ranged', 'magic'].filter(style => style !== king.effective)) {
        assert(chances[king.effective] > chances[style], `${king.name}: ${king.effective} accuracy exceeds ${style}: ${JSON.stringify(chances)}`);
        checks.weaknessCases++;
      }
    } finally { dispose(f); }
  }

  // A native melee special retains published damage and XP for every King.
  {
    const f = fixture(king.name);
    try {
      f.player.stats.fill(0);
      f.player.setVar(id(VarPlayerType, 'tutorial'), 1000);
      f.player.setVar(id(VarPlayerType, 'damagetype'), styles.stab);
      f.player.setVar(id(VarPlayerType, 'damagestyle'), 0);
      f.player.setVar(id(VarPlayerType, 'com_stabattack'), 1000000);
      f.player.setVar(id(VarPlayerType, 'com_maxhit'), 10);
      f.player.getInventory(id(InvType, 'worn')).set(constant('scripts/player/configs/equip.constant', 'wearpos_rhand'), { id: id(ObjType, 'dragon_dagger'), count: 1 });
      f.npc.setVar(id(VarNpcType, 'npc_combat_xp_multiplier'), 1000);
      random([0.999999, 0, 0.999999], () => run('[proc,pvm_dragon_dagger_spec_hit]', f));
      same(f.player.stats[PlayerStat.ATTACK], 440, `${king.name}: native dagger special has no King-specific cap`);
      checks.styleCases++;
    } finally { dispose(f); }
  }
}

for (const king of kings) {
  const f = fixture(king.name);
  try {
    const hunt = HuntType.get(f.type.huntmode);
    for (const skill of [1, 99]) {
      f.player.baseLevels.fill(skill); f.player.levels.fill(skill); f.player.combatLevel = f.player.getCombatLevel();
      f.npc.huntTarget = null; f.npc.huntClock = hunt.rate; f.npc.huntAll(hunt);
      assert.strictEqual(f.npc.huntTarget, f.player, `${king.name}: native aggression includes combat ${f.player.combatLevel}`);
      checks.hunts++;
    }
  } finally { dispose(f); }

  for (const protectedStyle of [false, true]) {
    const f = fixture(king.name), animations = [], projectiles = [];
    const restoreAnimation = observe(f.npc, 'playAnimation', animations);
    const restoreProjectile = observe(World, 'mapProjAnim', projectiles);
    try {
      const prayer = king.style === 'magic' ? 'prayer12' : king.style === 'ranged' ? 'prayer13' : 'prayer14';
      if (protectedStyle) f.player.setVar(id(VarPlayerType, prayer), 1);
      for (const name of ['com_rangedef', 'com_magicdef', 'com_slashdef']) f.player.setVar(id(VarPlayerType, name), 0);
      f.player.setVar(id(VarPlayerType, 'com_defendanim'), id(SeqType, 'human_unarmedblock'));
      f.npc.setVar(id(VarNpcType, 'npc_aggressive_player'), f.player.uid);
      f.npc.enqueueScript(Trigger.AI_QUEUE1);
      const expected = id(SeqType, king.animation);
      random(Array.from({ length: 512 }, (_, index) => index % 3 === 1 ? 0 : 0.999999), () => {
        f.npc.turn();
        for (let tick = 0; !animations.some(row => row.args[0] === expected) && tick < 20; tick++) { World.currentTick++; f.npc.turn(); }
      });
      assert.strictEqual(f.npc.target, f.player, `${king.name}: native retaliation target`);
      same(f.npc.targetOp, NpcModeMap.get(king.mode), `${king.name}: native dispatch mode`);
      const attack = animations.find(row => row.args[0] === expected); assert(attack, `${king.name}: native attack animation`);
      same(f.npc.getVar(id(VarNpcType, 'npc_action_delay')), attack.tick + 4, `${king.name}: four-tick action delay`);
      if (king.style === 'slash') same(projectiles.length, 0, `${king.name}: melee produces no projectile`);
      else {
        same(projectiles.length, 1, `${king.name}: one target projectile`);
        same(projectiles[0].args[6], id(SpotanimType, king.style === 'ranged' ? 'dagannoth_arrow_spotanim_travel' : 'waterwave_travel'), `${king.name}: named presentation projectile`);
      }
      const before = f.player.levels[PlayerStat.HITPOINTS]; settlePlayer(f.player);
      same(before - f.player.levels[PlayerStat.HITPOINTS], protectedStyle ? 0 : king.max, `${king.name}: native accuracy, maximum and matching protection`);
      checks.attacks++;
    } finally { restoreProjectile(); restoreAnimation(); dispose(f); }
  }
}

// Preserve native poison/recoil controls without a King-specific style rule.
// Positive poisoned melee may poison; an ordinary zero roll cannot start poison.
{
  const f = fixture('dagcave_ranged_boss');
  try {
    f.player.stats.fill(0);
    f.player.setVar(id(VarPlayerType, 'tutorial'), 1000);
    f.player.setVar(id(VarPlayerType, 'damagetype'), styles.stab);
    f.player.setVar(id(VarPlayerType, 'damagestyle'), 0);
    f.player.setVar(id(VarPlayerType, 'com_stabattack'), 1000000);
    f.player.setVar(id(VarPlayerType, 'com_maxhit'), 10);
    f.npc.setVar(id(VarNpcType, 'npc_combat_xp_multiplier'), 1000);
    f.player.getInventory(id(InvType, 'worn')).set(3, { id: id(ObjType, 'dragon_dagger_p'), count: 1 });
    random([0.999999, 0, 0.999999, 0], () => run('[label,player_melee_attack]', f));
    const severity = f.npc.getVar(id(VarNpcType, 'npc_poison')); assert(severity > 0, 'positive melee can start native poison');
    f.player.setVar(id(VarPlayerType, 'damagetype'), styles.ranged);
    const before = f.npc.levels[NpcStat.HITPOINTS]; run('[proc,npc_poison_timer]', f);
    same(before - f.npc.levels[NpcStat.HITPOINTS], Math.floor((severity + 3) / 5), 'native poison timer still damages Supreme after ranged style selected');
  } finally { dispose(f); }
}
{
  const f = fixture('dagcave_magic_boss');
  try {
    f.player.setVar(id(VarPlayerType, 'tutorial'), 1000);
    f.player.setVar(id(VarPlayerType, 'damagetype'), styles.stab);
    f.player.setVar(id(VarPlayerType, 'damagestyle'), 0);
    f.player.setVar(id(VarPlayerType, 'com_stabattack'), 1000000);
    f.player.setVar(id(VarPlayerType, 'com_maxhit'), 10);
    f.player.getInventory(id(InvType, 'worn')).set(3, { id: id(ObjType, 'dragon_dagger_p'), count: 1 });
    random([0.999999, 0, 0], () => run('[label,player_melee_attack]', f));
    same(f.npc.getVar(id(VarNpcType, 'npc_poison')), 0, 'native zero damage roll cannot start poison');
  } finally { dispose(f); }
}
{
  const f = fixture('dagcave_ranged_boss');
  try {
    f.player.getInventory(id(InvType, 'worn')).set(constant('scripts/player/configs/equip.constant', 'wearpos_ring'), { id: id(ObjType, 'ring_of_recoil'), count: 1 });
    f.player.setVar(id(VarPlayerType, 'aggressive_npc'), f.npc.uid);
    f.npc.setVar(id(VarNpcType, 'npc_attacking_uid'), f.player.uid);
    f.player.setVar(id(VarPlayerType, 'damagetype'), styles.ranged);
    run('[queue,combat_damage_player]', f, [20], true);
    for (let tick = 0; tick < 3; tick++) { f.npc.turn(); World.currentTick++; }
    same(f.npc.levels[NpcStat.HITPOINTS], 252, 'native recoil damages Supreme by three independently of selected Ranged style');
    same(f.player.levels[PlayerStat.HITPOINTS], 79, 'native incoming hit still damages recoil wearer');
  } finally { dispose(f); }
}

{
  const f = fixture('cow');
  try {
    assertKingLootTables((name, fractions, args = []) => random(fractions, () => {
      const state = run(`[proc,${name}]`, f, args);
      checks.lootCases++;
      return state.intStack.slice(0, state.isp);
    }), name => id(ObjType, name));
  } finally { dispose(f); }
}

// Exercise the three original map placements, not replacement or test-spawned Kings.
World.gameMap.init();
World.processNpcEventQueue();
const placedKings = new Map(kings.map(king => [king.name, [...World.npcs].filter(npc => npc.isActive && npc.type === id(NpcType, king.name))]));
for (const [name, placements] of placedKings) same(placements.length, 1, `${name}: one unchanged original map placement`);
const actorFixture = fixture('cow');
const originalAddObj = World.addObj, drops = [];
World.addObj = function (object, receiver, duration) {
  drops.push({ object, receiver, duration });
  return originalAddObj.call(this, object, receiver, duration);
};
try {
  const { isMapBlocked, reachedEntity } = await load('src/engine/GameMap.ts');
  for (const king of kings) {
    const npc = placedKings.get(king.name)[0], player = actorFixture.player;
    const site = [
      [npc.x - 1, npc.z], [npc.x + npc.width, npc.z],
      [npc.x, npc.z - 1], [npc.x, npc.z + npc.length]
    ].find(([x, z]) => !isMapBlocked(x, z, npc.level) && reachedEntity(npc.level, npc.x, npc.z, x, z, 1, 1, npc.width));
    assert(site, `${king.name}: collision-grounded adjacent hero tile`);
    World.gameMap.getZone(player.x, player.z, player.level).leave(player);
    [player.x, player.z] = site; player.level = npc.level;
    World.gameMap.getZone(player.x, player.z, player.level).enter(player);
    const before = drops.length, originalBase = npc.baseType;
    npc.heroPoints.addHero(player.hash64, npc.levels[NpcStat.HITPOINTS]);
    npc.enqueueScript(Trigger.AI_QUEUE2, 0, npc.levels[NpcStat.HITPOINTS]);
    random(Array(64).fill(0), () => {
      for (let tick = 0; tick < 10 && npc.isActive; tick++) { World.currentTick++; npc.turn(); World.processNpcEventQueue(); }
    });
    same(npc.isActive, false, `${king.name}: real damage/death queue removes the placed King`);
    const selected = drops.slice(before);
    for (const name of ['dagannoth_king_bones', 'dagganoth_hide']) {
      const guaranteed = selected.filter(drop => drop.object.type === id(ObjType, name));
      same(guaranteed.length, 1, `${king.name}: exactly one guaranteed ${name} drop`);
      same(guaranteed[0].object.count, 1, `${king.name}: guaranteed ${name} quantity`);
    }
    same(selected.length, 3, `${king.name}: two guarantees accompany exactly one ordinary main-table drop`);
    assert(selected.every(drop => drop.receiver === player.hash64), `${king.name}: native hero owns all drops`);
    same(npc.lifecycle, EntityLifeCycle.RESPAWN, `${king.name}: native respawn lifecycle`);
    const ticks = World.scaleByPlayerCount(NpcType.get(npc.type).respawnrate);
    same(npc.lifecycleTick, ticks - 1, `${king.name}: resumed death turn consumes the first native countdown tick`);
    for (let tick = 1; tick < ticks - 1; tick++) { World.currentTick++; npc.turn(); World.processNpcEventQueue(); }
    same(npc.isActive, false, `${king.name}: does not return before the selected respawn interval`);
    World.currentTick++; npc.turn(); World.processNpcEventQueue();
    same(npc.isActive, true, `${king.name}: native respawn returns the same placed King`);
    same(npc.baseType, originalBase, `${king.name}: respawn preserves original base identity`);
    same(npc.type, originalBase, `${king.name}: respawn restores original form`);
    same(npc.levels[NpcStat.HITPOINTS], king.stats[0], `${king.name}: respawn restores sourced Hitpoints`);
    checks.lifecycleCases++;
  }
} finally {
  World.addObj = originalAddObj;
  for (const drop of drops) if (drop.object.isActive) World.removeObj(drop.object, -1);
  dispose(actorFixture);
}

console.log(JSON.stringify({ result: 'PASS', suite: 'waterbirth-kings', checks }));
process.exit(0);
