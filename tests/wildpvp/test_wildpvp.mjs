#!/usr/bin/env node
// Transport-free proof against the checked-out content's compiled scripts and map.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = relative => import(pathToFileURL(path.join(engine, relative)).href);
const World = (await load('src/engine/World.ts')).default;
const Provider = (await load('src/engine/script/ScriptProvider.ts')).default;
const Runner = (await load('src/engine/script/ScriptRunner.ts')).default;
const State = (await load('src/engine/script/ScriptState.ts')).default;
const Pointer = (await load('src/engine/script/ScriptPointer.ts')).default;
const Trigger = (await load('src/engine/script/ServerTriggerType.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const Environment = (await load('src/util/Environment.ts')).default;
const { Interaction } = await load('src/engine/entity/Interaction.ts');
const { CoordGrid } = await load('src/engine/CoordGrid.ts');
const GameMap = await load('src/engine/GameMap.ts');
const SetPlayerOp = (await load('src/network/game/server/model/SetPlayerOp.ts')).default;
const { CollisionFlag, CollisionType } = await load('src/engine/routefinder/index.ts');
const configs = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType',
  'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType',
  'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'HuntType',
  'IdkType', 'Component', 'FontType']) {
  configs[name] = (await load(`src/cache/config/${name}.ts`)).default;
  configs[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
assert(Provider.load(pack) > 0, 'load compiled scripts');
assert.equal(Environment.NODE_XPRATE, 1, 'XP oracle uses tenths without multipliers');
Environment.NODE_MEMBERS = true;
Environment.NODE_DEBUG_PROFILE = false;
World.gameMap.init();
World.currentTick = 1000;
World.vars = new Int32Array(configs.VarSharedType.count);
World.varsString = new Array(configs.VarSharedType.count).fill('');
World.processNpcEventQueue();
const id = (kind, name) => {
  const value = configs[kind].getId(name);
  assert(value >= 0, `packed ${kind}:${name}`);
  return value;
};
const variable = (p, name, value) => value === undefined
  ? p.getVar(id('VarPlayerType', name)) : p.setVar(id('VarPlayerType', name), value);
const inv = id('InvType', 'inv');
const worn = id('InvType', 'worn');
let serial = 0;
let passed = 0;
function check(label, body) { body(); passed++; console.log(`PASS ${label}`); }
function player(x = 3100, z = 3600) {
  const slot = ++serial;
  const p = new Player(`wildpvp_${slot}`, BigInt(1000 + slot), BigInt(1000 + slot));
  Object.assign(p, { slot, pid: slot, uid: ((1000 + slot) << 11) | slot,
    level: 0, x, z, originX: x, originZ: z, isActive: true, lastMovement: -100 });
  p.baseLevels.fill(80); p.levels.fill(80); p.stats.fill(0);
  p.messages = []; p.packets = [];
  p.write = packet => p.packets.push(packet);
  p.messageGame = p.wrappedMessageGame = text => p.messages.push(String(text));
  World.players[slot] = p; World.playerLoop.add(p.hash64, p);
  p.moveSpeed = p.defaultMoveSpeed();
  variable(p, 'tutorial', 1000);
  p.getInventory(inv); p.getInventory(worn);
  return p;
}
function dispose(p) {
  p.clearInteraction(); World.players[p.slot] = null; p.unlink(); p.cleanup();
}
function run(p, name, target = null, args = []) {
  const script = typeof name === 'string' ? Provider.getByName(name) : name;
  assert(script, `packed ${name}`);
  const state = Runner.init(script, p, target, args);
  state.pointerAdd(Pointer.ProtectedActivePlayer);
  if (target instanceof Player) state.pointerAdd(Pointer.ProtectedActivePlayer2);
  p.executeScript(state, true, true);
  assert.equal(state.execution, State.FINISHED, `${script.name}: ${p.messages.join(' | ')}`);
  return state;
}
function integer(p, name, target = null, args = []) {
  const state = run(p, `[proc,${name}]`, target, args);
  assert.equal(state.isp, 1, `${name} returns one value`);
  return state.intStack[0];
}
function rng(body) {
  const previous = JavaRandom.nextDouble;
  let draw = 0;
  // Attacker wins accuracy, defender loses, then positive damage; later audio/ammo draws fixed.
  JavaRandom.nextDouble = () => [0.999999, 0, 0.999999][draw++] ?? 0.5;
  try { return body(); } finally { JavaRandom.nextDouble = previous; }
}
function equip(p, name) {
  const type = configs.ObjType.getByName(name); assert(type, name);
  p.invSet(worn, type.id, 1, type.wearpos);
  run(p, '[proc,update_weapon_category]', null, [type.id]);
  run(p, '[proc,player_combat_stat]');
}
function prepare(p, style) {
  equip(p, style === 'ranged' ? 'shortbow' : 'bronze_sword');
  if (style === 'ranged') p.invSet(worn, id('ObjType', 'bronze_arrow'), 100,
    configs.ObjType.getByName('bronze_arrow').wearpos);
  for (const name of ['airrune', 'mindrune']) p.invAdd(inv, id('ObjType', name), 100);
  for (const name of ['com_stabattack', 'com_slashattack', 'com_crushattack', 'com_rangeattack', 'com_magicattack'])
    variable(p, name, 1000000);
  variable(p, 'com_maxhit', 10);
  variable(p, 'action_delay', 0);
}
function attack(p, q, style) {
  if (style === 'magic') {
    const component = id('Component', 'magic:wind_strike');
    const trigger = Provider.getByTrigger(Trigger.APPLAYERT, component, -1);
    assert.equal(trigger?.name, '[applayert,magic:wind_strike]', 'real spell component dispatch');
    run(p, trigger, q);
  } else {
    assert(p.setInteraction(Interaction.ENGINE, q, Trigger.APPLAYER2));
    assert.equal(p.getOpTrigger()?.name, '[opplayer2,_]', 'native player Attack dispatch');
    p.processInteraction();
  }
}
function settle(p, q, limit = 8) {
  p.clearInteraction();
  for (let i = 0; i < limit; i++) {
    World.currentTick++;
    p.processQueues(); q.processQueues();
  }
}
function pairCase(style, scenario) {
  const [x, z] = scenario.area === 'castle' ? [2400, 3100]
    : scenario.area === 'duel' ? [3340, 3250] : [3100, 3600];
  const p = player(x, z); const q = player(x + 1, z);
  try {
    prepare(p, style); prepare(q, 'melee');
    for (const name of ['com_stabdef', 'com_slashdef', 'com_crushdef', 'com_rangedef', 'com_magicdef'])
      variable(q, name, 1);
    if (scenario.area === 'castle') {
      variable(p, 'castlewars_team', scenario.team ?? 0);
      variable(q, 'castlewars_team', scenario.sameTeam ? scenario.team ?? 0 : 1);
    }
    if (scenario.area === 'duel') {
      variable(p, 'duel2accept', scenario.wrongOpponent ? -1 : q.uid);
      variable(q, 'duel2accept', p.uid);
      variable(p, 'duelstatus', scenario.notStarted ? 5 : 6);
      variable(q, 'duelstatus', 6);
      variable(p, 'dueloptions', scenario.rules ?? 0);
    }
    if (scenario.safeAttacker) { p.z = 3519; q.z = 3520; }
    if (scenario.safeTarget) { p.z = 3520; q.z = 3519; }
    if (scenario.outOfRange) { q.baseLevels.fill(1); q.levels.fill(1); q.levels[3] = 80; }
    if (scenario.busy) {
      variable(q, 'lastcombat', World.currentTick); variable(q, 'pk_predator1', 999999);
    }
    const permission = integer(p, style === 'magic' ? 'pvp_is_attackable_opt' : 'pvp_is_attackable', q);
    const permissionAllowed = scenario.allowPermission ?? scenario.allow;
    assert.equal(permission, permissionAllowed ? 1 : 0, `${style} ${scenario.label}: explicit permission`);
    if (scenario.message) assert(p.messages.includes(scenario.message), `${style} ${scenario.label}: permission refusal message`);
    p.messages.length = 0;
    const hp = q.levels[3]; const xp = [...p.stats];
    const runes = p.invTotal(inv, id('ObjType', 'mindrune'));
    rng(() => attack(p, q, style));
    const hits = [...q.queue.all()].filter(request => request.script.name === '[queue,pvp_damage]');
    if (scenario.allow) {
      assert.equal(hits.length, 1, `${style} ${scenario.label}: native queued hit`);
      assert(hits[0].args[0] > 0, `${style} ${scenario.label}: positive deterministic damage`);
      if (!scenario.area) assert(variable(p, 'pk_skull') > World.currentTick, 'unprovoked Wilderness attack skulls');
      assert.equal(variable(q, 'pk_predator1'), p.uid, 'real attack writes victim aggressor');
      rng(() => settle(p, q));
      assert(q.levels[3] < hp, `${style} ${scenario.label}: native damage settles`);
      assert(p.stats.some((value, index) => value > xp[index]), 'combat grants real XP');
      assert.equal(q.target, p, 'real retaliation queue selects the aggressor');
      if (!scenario.area) assert.equal(variable(q, 'pk_skull'), 0, 'defender retaliation is not skulled');
      if (style === 'magic') assert.equal(p.invTotal(inv, id('ObjType', 'mindrune')), runes - 1);
    } else {
      assert.equal(hits.length, 0, `${style} ${scenario.label}: no damage queue`);
      assert.equal(q.levels[3], hp); assert.deepEqual([...p.stats], xp);
      assert.equal(variable(p, 'pk_skull'), 0, 'refused attack never skulls');
      assert.equal(p.invTotal(inv, id('ObjType', 'mindrune')), runes, 'refused spell costs no runes');
      assert(p.messages.length > 0, `${style} ${scenario.label}: refusal is player-visible`);
      if (scenario.message) assert(p.messages.includes(scenario.message), `${style} ${scenario.label}: native refusal message`);
    }
  } finally { dispose(p); dispose(q); }
}

for (const style of ['melee', 'ranged', 'magic']) {
  for (const scenario of [
    { label: 'Wilderness within level range', allow: true },
    { label: 'safe attacker', safeAttacker: true, allow: false },
    { label: 'safe target', safeTarget: true, allow: false },
    { label: 'outside combat-level range', outOfRange: true, allow: false },
    { label: 'single-way occupied opponent', busy: true, allow: false },
    { label: 'Saradomin ally', area: 'castle', sameTeam: true, team: 0,
      message: "Saradomin won't let you attack your allies!", allow: false },
    { label: 'Zamorak ally', area: 'castle', sameTeam: true, team: 1,
      message: "Zamorak wants you to kill your enemies!", allow: false },
    { label: 'Castle Wars enemy', area: 'castle', team: 0, allow: true },
    { label: 'started duel', area: 'duel', allow: true },
    { label: 'wrong duel opponent', area: 'duel', wrongOpponent: true, allow: false },
    { label: 'duel countdown', area: 'duel', notStarted: true, allow: false },
    { label: 'duel style rule', area: 'duel', rules: 1 << ({ melee: 5, ranged: 4, magic: 6 }[style]),
      allowPermission: style !== 'magic', allow: false },
  ]) check(`${style}: ${scenario.label}`, () => pairCase(style, scenario));
}

function attackOption(p) {
  return p.packets.filter(packet => packet instanceof SetPlayerOp && packet.op === 2).at(-1)?.value;
}
function transition(p, x, z) {
  p.teleport(x, z, 0); p.processEngineQueue(); p.processQueues();
}
function walk(p, x, z, label) {
  p.resetEntity(false); p.moveSpeed = p.defaultMoveSpeed(); p.queueWaypoint(x, z);
  for (let step = 0; (p.x !== x || p.z !== z) && step < 4; step++) {
    p.updateMovement(); p.processEngineQueue(); p.processQueues();
    p.resetEntity(false); p.moveSpeed = p.defaultMoveSpeed();
  }
  assert.deepEqual([p.x, p.z], [x, z], `${label}: native walking reaches destination`);
}
function danger(p, underground, label) {
  assert.equal(p.overlay, id('Component', underground ? 'wilderness_underground_overlay' : 'wilderness_overlay'), label);
  assert.equal(attackOption(p), 'Attack', `${label}: Attack enabled`);
  assert.equal(variable(p, 'wilderness'), 1, `${label}: warning consumed`);
  assert(integer(p, 'wilderness_level', null, [CoordGrid.packCoord(0, p.x, p.z)]) > 0);
}
function safe(p, label) {
  assert.equal(p.overlay, -1, `${label}: danger overlay cleared`);
  assert.equal(attackOption(p), 'null', `${label}: native null sentinel removes Attack`);
  assert.equal(variable(p, 'wilderness'), 1, `${label}: warning stays consumed until relog`);
}
check('every Wilderness mapzone has a functioning paired exit, including 0_52_57', () => {
  const regions = [];
  for (let x = 46; x <= 52; x++) for (let z = 55; z <= 61; z++) regions.push([x, z, false]);
  for (const [x, z] of [[46, 161], [47, 160], [47, 161], [48, 155], [48, 156]]) regions.push([x, z, true]);
  for (const [x, z, underground] of regions) {
    const p = player(3200, 3400);
    try {
      transition(p, 3200, 3401);
      transition(p, x * 64 + 16, z * 64 + 16);
      danger(p, underground, `${x}_${z} entry`);
      transition(p, 3200, 3400);
      safe(p, `${x}_${z} teleport exit`);
    } finally { dispose(p); }
  }
});
check('0_52_57 login, real walk crossings and teleport exit; normal border walk-out', () => {
  let crossing;
  // The east edge is coastline. Walk the real western land boundary instead.
  for (let z = 3648; z < 3712; z++) {
    if (World.gameMap.hasZone(3327, z, 0) && World.gameMap.hasZone(3328, z, 0)
      && !GameMap.isMapBlocked(3327, z, 0) && !GameMap.isMapBlocked(3328, z, 0)
      && GameMap.canTravel(0, 3327, z, 1, 0, 1, CollisionFlag.BLOCK_NPC_AND_PLAYERS, CollisionType.NORMAL)) {
      crossing = z; break;
    }
  }
  assert(crossing, 'real packed collision has a walkable western boundary');
  const p = player(3328, crossing);
  try {
    p.onLogin(); p.processEngineQueue(); p.processQueues();
    danger(p, false, 'initial login in 0_52_57');
    walk(p, 3327, crossing, 'walk out of 0_52_57');
    danger(p, false, 'neighbouring Wilderness reopens danger after exit');
    walk(p, 3328, crossing, 'walk into 0_52_57');
    danger(p, false, 'internal entry to 0_52_57');
    transition(p, 3200, 3400); safe(p, '0_52_57 teleport to mainland');
    transition(p, 3100, 3520); danger(p, false, 'normal southern Wilderness border');
    walk(p, 3100, 3519, 'walk south of level-one border');
    safe(p, 'south of level-one border');
    p.closeModal();
    run(p, '[queue,wilderness_warning]');
    assert.equal(p.modalMain, -1, 'return to band does not warn twice');
    const relogged = player(3100, 3513);
    try {
      assert.equal(variable(relogged, 'wilderness'), 0, 'new login has fresh temporary flag');
      run(relogged, '[queue,wilderness_warning]');
      assert.equal(relogged.modalMain, id('Component', 'wilderness_warning'), 'new login rearms warning');
    } finally { dispose(relogged); }
  } finally { dispose(p); }
});
check('Falador men retain original identities and restored combat profiles; real kill grants XP and loot', () => {
  const targets = [
    ['falador_man1', 3222, 3],
    ['falador_man2', 3223, 1],
    ['falador_man3', 3224, 1],
    ['falador_man4', 3225, 1],
  ];
  for (const [name, cacheId, strength] of targets) {
    const type = configs.NpcType.getByName(name);
    assert.equal(type?.id, cacheId, `${name}: original cache identity`);
    assert.equal(type.op[1], 'Attack');
    const npc = [...World.npcs].find(actor => actor.type === type.id && actor.isActive);
    assert(npc, `${name}: natural packed Falador spawn`);
    assert.deepEqual([...npc.baseLevels], [1, 1, strength, 7, 1, 1], `${name}: UNKNOWN adopted server stats`);
  }
  const npc = [...World.npcs].find(actor => actor.type === id('NpcType', 'falador_man2') && actor.isActive);
  assert(npc.x >= 2944 && npc.x < 3072 && npc.z >= 3328 && npc.z < 3456, 'real target is in Falador');
  let start;
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    if (!GameMap.isMapBlocked(npc.x + dx, npc.z + dz, npc.level)
      && GameMap.isLineOfWalk(npc.level, npc.x + dx, npc.z + dz, npc.x, npc.z)) {
      start = [npc.x + dx, npc.z + dz]; break;
    }
  }
  assert(start, 'real target has an accessible adjacent tile on the packed map');
  const p = player(...start); p.level = npc.level;
  const drops = []; const addObj = World.addObj;
  World.addObj = function (obj, owner, duration) {
    drops.push({ type: obj.type, count: obj.count, owner });
    return addObj.call(this, obj, owner, duration);
  };
  try {
    prepare(p, 'melee');
    const xp = [...p.stats];
    assert(p.setInteraction(Interaction.ENGINE, npc, Trigger.APNPC2));
    assert.equal(p.getOpTrigger()?.name, '[opnpc2,_]', 'ordinary native NPC Attack dispatch');
    rng(() => p.processInteraction());
    p.clearInteraction();
    for (let tick = 0; npc.isActive && tick < 20; tick++) {
      World.currentTick++;
      rng(() => { npc.turn(); p.processQueues(); });
    }
    assert.equal(npc.levels[3], 0, 'native attack removes all seven HP');
    assert.equal(npc.isActive, false, 'native damage/death queue kills real target');
    assert.equal(p.stats[0] - xp[0], 280, 'seven damage grants 28 Attack XP in tenths');
    assert.equal(p.stats[3] - xp[3], 93, 'seven damage grants truncated 9.3 HP XP in tenths');
    assert(drops.some(drop => drop.type === id('ObjType', 'bones') && drop.count === 1), 'ordinary death drops bones');
    assert(drops.every(drop => drop.owner === p.hash64), 'drop ownership is the real damage hero');
  } finally { World.addObj = addObj; dispose(p); }
});
console.log(`RESULT PASS wildpvp ${passed} compiled cases`);
process.exit(0);
