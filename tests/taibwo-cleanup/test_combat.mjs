#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fixture, get, set, home, World, types, PlayerStat, ScriptProvider, ScriptState,
  ServerTriggerType, engineModule, id, obj, inv, invCom, slotOf, count, execute, standAt, map } from '../tai-bwo-cleanup/runtime.mjs';

const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const ScriptPointer = (await engineModule('engine/script/ScriptPointer.ts')).default;
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const NpcStat = (await engineModule('engine/entity/NpcStat.ts')).NpcStat;
const { EntityLifeCycle } = await engineModule('engine/entity/EntityLifeCycle.ts');
const OpNpcU = (await engineModule('network/game/client/model/OpNpcU.ts')).default;
const npcUseHandler = new (await engineModule('network/game/client/handler/OpNpcUHandler.ts')).default();
const rsbuf = await engineModule('network/rsbuf/index.ts');
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
let combatTile;
spawn: for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) {
  const x = home[1] + dx, z = home[2] + dz;
  if (map.isMapBlocked(x, z, home[0])) continue;
  const route = Array.from(map.findPath(home[0], home[1], home[2], x, z));
  if (!route.length) continue;
  const end = CoordGrid.unpackCoord(route.at(-1));
  if (end.x !== x || end.z !== z) continue;
  combatTile = { x, z }; break spawn;
}
assert(combatTile, 'compiled combat fixture has a walkable, reachable NPC tile');
const poisonVar = id('VarPlayerType', 'poison');
const npcAggressivePlayer = id('VarNpcType', 'npc_aggressive_player');
let checks = 0;
function test(name, run) { run(); checks++; console.log(`PASS ${name}`); }
function withRandom(values, action) {
  const original = JavaRandom.nextDouble;
  let draws = 0;
  JavaRandom.nextDouble = () => {
    assert(draws < values.length, `unexpected RNG draw ${draws + 1}`);
    return values[draws++];
  };
  try {
    const result = action();
    assert.equal(draws, values.length, 'attack used the complete controlled RNG tape');
    return result;
  } finally {
    JavaRandom.nextDouble = original;
  }
}
function addNpc(p, name) {
  const type = types.NpcType.getByName(name);
  assert(type, `packed NPC ${name}`);
  const npc = new Npc(p.level, combatTile.x, combatTile.z, type.size, type.size, EntityLifeCycle.DESPAWN,
    World.getNextNid(), type.id, type.blockwalk);
  World.addNpc(npc, -1);
  standAt(p, npc);
  World.processNpcEventQueue();
  npc.lastMovement = World.currentTick - 100;
  npc.setVar(npcAggressivePlayer, p.uid);
  return npc;
}
function removeNpc(npc) {
  if (npc?.isActive) World.removeNpc(npc, -1);
  World.processNpcEventQueue();
}
function runNpc(npc, name, p, args = []) {
  const script = typeof name === 'string' ? ScriptProvider.getByName(name) : name;
  assert(script, `packed NPC script ${name}`);
  const state = ScriptRunner.init(script, npc, p, args);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  npc.executeScript(state);
  assert.notEqual(state.execution, ScriptState.ABORTED, `${script.name} did not abort`);
  assert.equal(state.execution, ScriptState.FINISHED, `${script.name} completes`);
  return state;
}
function poisonQueue(p) {
  return [...p.queue.all()].filter(queue => queue.script.name === '[queue,poison_player]');
}
function settlePlayer(p, ticks = 8) {
  const original = JavaRandom.nextDouble;
  JavaRandom.nextDouble = () => 0;
  try {
    for (let i = 0; i < ticks; i++) {
      World.currentTick++;
      p.processQueues();
    }
  } finally {
    JavaRandom.nextDouble = original;
  }
}
function showNpc(p, npc) {
  rsbuf.addPlayer(p.slot);
  rsbuf.addNpc(npc.nid, npc.type);
  const appearance = p.generateAppearance();
  const hp = PlayerStat.HITPOINTS;
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, appearance, p.lastAppearance,
    p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ,
    p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[hp], p.baseLevels[hp], p.animId, p.animDelay, p.sayMessage,
    p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0,
    p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(npc.x, npc.level, npc.z, npc.nid, npc.type, npc.tele, npc.jump, npc.runDir,
    npc.walkDir, npc.isActive, npc.masks, npc.faceEntity, npc.faceSquareX, npc.faceSquareZ,
    npc.faceAngleX, npc.faceAngleZ, npc.hitmarkDamage, npc.hitmarkType, npc.hitmark2Damage,
    npc.hitmark2Type, npc.levels[NpcStat.HITPOINTS], npc.baseLevels[NpcStat.HITPOINTS],
    npc.animId, npc.animDelay, npc.sayMessage, npc.spotanimId, npc.spotanimHeight, npc.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, npc.nid), 'production visibility encoder includes the selected NPC');
}
function useItemOnNpc(p, npc, item) {
  standAt(p, npc);
  showNpc(p, npc);
  const accepted = npcUseHandler.handle(new OpNpcU(npc.nid, obj(item), slotOf(p, item), invCom), p);
  assert(accepted, `production OPNPCU accepts ${item} on ${types.NpcType.get(npc.type).debugname}`);
  const trigger = p.getOpTrigger();
  assert(trigger, 'production OPNPCU resolves a packed trigger');
  assert.equal(trigger.name, `[opnpcu,${types.NpcType.get(npc.type).debugname}]`);
  p.processInteraction();
}
function captureDrops(action) {
  const drops = [];
  const original = World.addObj;
  World.addObj = function (item, receiver, duration) {
    drops.push({ type: item.type, count: item.count });
    return original.call(this, item, receiver, duration);
  };
  try { action(); return drops; }
  finally { World.addObj = original; }
}
function lethalDeath(npc, attacker, players) {
  const damage = npc.levels[NpcStat.HITPOINTS];
  const state = ScriptRunner.init(ScriptProvider.getByName('[proc,npc_default_damage]'), npc, attacker, [damage]);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  npc.executeScript(state);
  assert.equal(state.execution, ScriptState.FINISHED, 'native default damage finishes');
  assert([...npc.queue.all()].some(request => request.queueId === ServerTriggerType.AI_QUEUE3), 'lethal damage queues AI_QUEUE3');
  for (let tick = 0; tick < 40 && (npc.isActive || npc.activeScript); tick++) {
    World.currentTick++;
    if (npc.isActive) npc.turn();
    for (const player of players) player.processQueues();
  }
  assert.equal(npc.isActive, false, 'native death removes the NPC');
}
function setCombatStats(p) {
  p.baseLevels[PlayerStat.HITPOINTS] = 80;
  p.levels[PlayerStat.HITPOINTS] = 80;
  for (const stat of [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.MAGIC, PlayerStat.RANGED]) {
    p.baseLevels[stat] = 20;
    p.levels[stat] = 20;
  }
}

World.currentTick = 100;
test('spider poisoning is rare; snake and tribesman hits poison more often', () => {
  for (const [name, script, severity, tape] of [
    ['tbwcu_village_snake', '[ai_opplayer2,_]', 10, [0.999999, 0, 0.999999]],
    ['tbwcu_tribesman', '[ai_opplayer2,_]', 55, [0.999999, 0, 0.999999]],
    ['tbwcu_jungle_spider', '[ai_opplayer2,tbwcu_jungle_spider]', 10, [0.999999, 0, 0.999999, 0]]
  ]) {
    const p = fixture(); setCombatStats(p);
    const npc = addNpc(p, name);
    try {
      withRandom(tape, () => runNpc(npc, script, p));
      assert.deepEqual(poisonQueue(p).map(queue => queue.args), [[severity]], `${name} successful attack queues poison`);
      settlePlayer(p);
      assert.equal(p.getVar(poisonVar), severity, `${name} applies its packed poison severity`);
    } finally { removeNpc(npc); }
  }
  const p = fixture(); setCombatStats(p);
  const spider = addNpc(p, 'tbwcu_jungle_spider');
  try {
    withRandom([0.999999, 0, 0.999999, 0.999999], () => runNpc(spider, '[ai_opplayer2,tbwcu_jungle_spider]', p));
    assert.equal(poisonQueue(p).length, 0, 'the spider does not poison on every successful hit');
  } finally { removeNpc(spider); }
});

test('Broodoo magic attacks use normal damage and the yellow form drains stats with hitmark 3', () => {
  for (const [name, disease, severity] of [
    ['tbwcu_broodoo_poison', false, 10],
    ['tbwcu_broodoo_combat', false, 0],
    ['tbwcu_broodoo_disease', true, 0]
  ]) {
    const p = fixture(); setCombatStats(p);
    const npc = addNpc(p, name);
    const hp = p.levels[PlayerStat.HITPOINTS];
    try {
      withRandom([0.999999, 0, 0.999999], () => runNpc(npc, `[ai_opplayer2,${name}]`, p));
      if (severity) assert.deepEqual(poisonQueue(p).map(queue => queue.args), [[severity]]);
      else assert.equal(poisonQueue(p).length, 0);
      if (disease) {
        for (const stat of [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.MAGIC, PlayerStat.RANGED]) {
          assert(p.levels[stat] < 20, `yellow Broodoo drains stat ${stat}`);
        }
        assert.equal(p.hitmarkType, 3, 'yellow Broodoo emits disease hitmark 3');
        assert.equal(p.levels[PlayerStat.HITPOINTS], hp, 'disease hitmark 3 itself deals no extra HP damage before the magic hit lands');
        assert(p.messages.some(message => String(message).includes('You feel weakened.')));
      }
      settlePlayer(p);
      assert(p.levels[PlayerStat.HITPOINTS] < hp, `${name} deals an ordinary magic hit`);
      assert.equal(p.getVar(poisonVar), severity, `${name} poison result`);
    } finally { removeNpc(npc); }
  }
});
test('ordinary player attacks respect the period Broodoo two-damage cap before XP and hero points', () => {
  for (const name of ['tbwcu_broodoo_disease', 'tbwcu_broodoo_poison', 'tbwcu_broodoo_combat']) {
    const p = fixture(), npc = addNpc(p, name);
    try {
      for (const incoming of [0, 1, 100]) {
        const state = execute('[proc,npc_max_dealt]', p, [incoming, 0], { target: npc });
        assert.equal(state.popInt(), Math.min(incoming, 2), `${name} caps ordinary player damage`);
      }
    } finally { removeNpc(npc); }
  }
});

test('each Broodoo colour accepts only its period-guide weakness through production OPNPCU', () => {
  const cases = [
    { npc: 'tbwcu_broodoo_disease', correct: 'relicyms_balm4', next: 'relicyms_balm3', wrong: '4doseantipoison' },
    { npc: 'tbwcu_broodoo_poison', correct: '4doseantipoison', next: '3doseantipoison', wrong: 'pineapple_chunks' },
    { npc: 'tbwcu_broodoo_poison', correct: '4dose2antipoison', next: '3dose2antipoison', wrong: 'relicyms_balm4' },
    { npc: 'tbwcu_broodoo_combat', correct: 'pineapple_chunks', next: null, wrong: 'relicyms_balm4' }
  ];
  for (const completed of [false, true]) for (const row of cases) {
    const p = fixture();
    set(p, 'druidquest', completed ? 4 : 0);
    const cookingXp = p.stats[PlayerStat.COOKING], herbloreXp = p.stats[PlayerStat.HERBLORE];
    p.invAdd(inv, obj(row.correct), 1);
    p.invAdd(inv, obj(row.wrong), 1);
    const npc = addNpc(p, row.npc);
    const hp = npc.levels[NpcStat.HITPOINTS];
    try {
      useItemOnNpc(p, npc, row.wrong);
      assert.equal(npc.levels[NpcStat.HITPOINTS], hp, `${row.npc} ignores the wrong weakness item`);
      assert.equal(count(p, row.wrong), 1, `${row.npc} does not consume the wrong item`);
      useItemOnNpc(p, npc, row.correct);
      assert.equal(npc.levels[NpcStat.HITPOINTS], hp - 20, `${row.npc} takes the configured heavy weakness hit: ${JSON.stringify({ item: count(p, row.correct), active: p.activeScript?.script?.name, execution: p.activeScript?.execution, protect: p.protect, modalChat: p.modalChat, messages: p.messages })}`);
      assert.equal(count(p, row.correct), 0, `${row.npc} consumes one correct item use`);
      if (row.next) assert.equal(count(p, row.next), 1, `${row.npc} advances the potion to its next dose`);
      assert.equal(npc.heroPoints.findHero(), p.hash64, `${row.npc} records the real item user as damage hero`);
      assert.equal(p.stats[PlayerStat.COOKING] - cookingXp, row.next ? 0 : 400, 'food gives two Cooking XP per damage');
      assert.equal(p.stats[PlayerStat.HERBLORE] - herbloreXp, row.next && completed ? 400 : 0, 'potion XP requires completed Druidic Ritual');
    } finally { removeNpc(npc); }
  }
});

test('Broodoo counter-item XP and hero damage exclude overkill', () => {
  for (const [name, item, skill] of [
    ['tbwcu_broodoo_combat', 'pineapple_chunks', PlayerStat.COOKING],
    ['tbwcu_broodoo_disease', 'relicyms_balm1', PlayerStat.HERBLORE],
    ['tbwcu_broodoo_poison', '1dose2antipoison', PlayerStat.HERBLORE]
  ]) {
    const p = fixture(), npc = addNpc(p, name);
    set(p, 'druidquest', 4);
    p.invAdd(inv, obj(item), 1);
    npc.levels[NpcStat.HITPOINTS] = 3;
    const xp = p.stats[skill];
    try {
      useItemOnNpc(p, npc, item);
      assert.equal(npc.levels[NpcStat.HITPOINTS], 0);
      assert.equal(p.stats[skill] - xp, 60, 'three actual damage gives six XP, not forty');
      assert.equal(npc.heroPoints.findHero(), p.hash64);
      assert.equal(count(p, item), 0);
      if (skill === PlayerStat.HERBLORE) assert.equal(count(p, 'vial_empty'), 1, 'last potion dose leaves its vial');
    } finally { removeNpc(npc); }
  }
});

test('native deaths drop the cache reward and give favour only to the highest-damage village hero', () => {
  const encounters = [
    ['tbwcu_village_snake', 'village_snake_hide', 10],
    ['tbwcu_jungle_spider', 'village_spider_carcass', 10],
    ['tbwcu_tribesman', 'bones', 10],
    ['tbwcu_broodoo_poison', 'broodoomask_poison', 30],
    ['tbwcu_broodoo_disease', 'broodoomask_disease', 30],
    ['tbwcu_broodoo_combat', 'broodoomask_combat', 30]
  ];
  for (const [name, drop, favour] of encounters) {
    const attacker = fixture();
    const winner = fixture();
    set(attacker, 'cleanup_progress', 1);
    set(winner, 'cleanup_progress', 1);
    const npc = addNpc(attacker, name);
    npc.heroPoints.addHero(attacker.hash64, 1);
    npc.heroPoints.addHero(winner.hash64, npc.levels[NpcStat.HITPOINTS]);
    try {
      const drops = captureDrops(() => lethalDeath(npc, attacker, [attacker, winner]));
      assert.deepEqual(drops.map(item => [item.type, item.count]), [[obj(drop), 1]], `${name} drops its cache item`);
      assert.equal(get(attacker, 'vill_comm_points'), 0, `${name} does not reward the final hitter when another hero dealt most damage`);
      assert.equal(get(winner, 'vill_comm_points'), favour, `${name} awards favour to npc_findhero's actual killer`);
    } finally { removeNpc(npc); }
  }
});

test('encounter drops remain available when the Cleanup and village favour gates are closed', () => {
  for (const [progress, outside] of [[0, false], [1, true]]) {
    const p = fixture();
    set(p, 'cleanup_progress', progress);
    const npc = addNpc(p, 'tbwcu_village_snake');
    npc.heroPoints.addHero(p.hash64, npc.levels[NpcStat.HITPOINTS]);
    if (outside) {
      p.x = home[1] + 1000;
      p.z = home[2] + 1000;
      p.originX = p.x;
      p.originZ = p.z;
    }
    try {
      const drops = captureDrops(() => lethalDeath(npc, p, [p]));
      assert.deepEqual(drops.map(item => [item.type, item.count]), [[obj('village_snake_hide'), 1]]);
      assert.equal(get(p, 'vill_comm_points'), 0, 'favor requires started Cleanup and the village location');
    } finally { removeNpc(npc); }
  }
});

console.log(`PASS ${checks} combat integration groups`);
process.exit(0);
