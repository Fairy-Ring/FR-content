#!/usr/bin/env node
/** Execute published death triggers and their real queues without a server. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engineRoot = process.env.HARNESS_ENGINE_DIR ?? path.resolve(contentRoot, '../engine');
const packDir = path.join(engineRoot, 'data/pack');
const load = async relative => import(pathToFileURL(path.join(engineRoot, relative)).href);
const World = (await load('src/engine/World.ts')).default;
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const { ScriptOpcode } = await load('src/engine/script/ScriptOpcode.ts');
const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const Npc = (await load('src/engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { NpcStat } = await load('src/engine/entity/NpcStat.ts');
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const Environment = (await load('src/util/Environment.ts')).default;
assert.equal(Environment.NODE_PRODUCTION, false, 'use the non-production slot error policy');
assert.equal(Environment.NODE_XPRATE, 1, 'the oracle uses unmultiplied XP in tenths');
const configs = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'ParamType', 'ObjType',
  'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType',
  'MesanimType', 'DbTableType', 'DbRowType', 'Component', 'FontType']) {
  configs[name] = (await load(`src/cache/config/${name}.ts`)).default;
  configs[name].load(packDir);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
assert(ScriptProvider.load(packDir) > 0, 'build the sibling engine pack first');
const digest = relative => createHash('sha256').update(readFileSync(path.join(packDir, relative))).digest('hex');
console.log(`PACK ${JSON.stringify({ scriptDat: digest('server/script.dat'), scriptIdx: digest('server/script.idx') })}`);
const ids = {
  target: configs.VarPlayerType.getId('slayer_target'),
  count: configs.VarPlayerType.getId('slayer_count'),
  attacker: configs.VarNpcType.getId('npc_aggressive_player'),
  category: configs.ParamType.getId('slayer_category')
};
for (const [name, id] of Object.entries(ids)) assert(id >= 0, `missing packed ${name}`);

const cases = [
  { name: 'online-sole-attacker', online: true, last: 'hero', taskA: true, taskB: false, credit: [1, 0], xp: [80, 0], loot: true },
  { name: 'online-split-both-tasks', online: true, last: 'finisher', taskA: true, taskB: true, credit: [1, 1], xp: [40, 40], loot: true },
  { name: 'offline-hero-online-finisher', online: false, last: 'finisher', taskA: true, taskB: true, credit: [0, 1], xp: [0, 80], loot: false },
  { name: 'offline-hero-no-last-attacker', online: false, last: null, taskA: true, taskB: true, credit: [0, 0], xp: [0, 0], loot: false },
  { name: 'no-slayer-category', npc: 'shade_level1', online: true, last: 'hero', taskA: true, taskB: true, credit: [0, 0], xp: [0, 0], loot: true },
  { name: 'online-split-only-hero-task', online: true, last: 'finisher', taskA: true, taskB: false, credit: [1, 0], xp: [40, 0], loot: true },
  { name: 'online-split-only-finisher-task', online: true, last: 'finisher', taskA: false, taskB: true, credit: [0, 1], xp: [0, 40], loot: true },
  { name: 'online-sole-no-task', online: true, last: 'hero', taskA: false, taskB: false, credit: [0, 0], xp: [0, 0], loot: true },
  { name: 'offline-hero-finisher-no-task', online: false, last: 'finisher', taskA: true, taskB: false, credit: [0, 0], xp: [0, 0], loot: false },
  { name: 'online-hero-no-last-attacker', online: true, last: null, taskA: true, taskB: true, credit: [1, 0], xp: [80, 0], loot: true },
  { name: 'no-category-offline-hero', npc: 'shade_level1', online: false, last: 'finisher', taskA: true, taskB: true, credit: [0, 0], xp: [0, 0], loot: false }
];
let serial = 0;
function player(online, task) {
  const slot = ++serial;
  const hash = BigInt(1000 + slot);
  const actor = new Player(`npdeath${slot}`, hash, hash);
  actor.slot = slot;
  actor.pid = slot;
  actor.uid = ((Number(hash & 0x1fffffn) << 11) | slot) >>> 0;
  actor.vars.fill(0);
  actor.setVar(ids.target, task ? 6 : 0);
  actor.setVar(ids.count, task ? 5 : 0);
  const packets = [];
  actor.write = packet => packets.push(packet); // Capture transport, never replace gameplay.
  actor.baseLevels.fill(99);
  actor.levels.fill(99);
  if (online) {
    World.players[slot] = actor;
    World.playerLoop.add(hash, actor);
  }
  return actor;
}
function runCase(test, index) {
  const checks = [];
  const check = (label, actual, expected) => checks.push({ label, actual, expected, pass: JSON.stringify(actual) === JSON.stringify(expected) });
  const hero = player(test.online, test.taskA);
  const finisher = player(true, test.taskB);
  const actors = [hero, finisher];
  const before = actors.map(actor => ({ count: actor.getVar(ids.count), xp: actor.stats[PlayerStat.SLAYER] }));
  const type = configs.NpcType.getByName(test.npc ?? 'cow');
  assert(type, 'published fixture NPC missing');
  const npc = new Npc(0, 3200 + index * 4, 3200, type.size, type.size,
    EntityLifeCycle.RESPAWN, index + 1, type.id, type.blockwalk);
  World.addNpc(npc, -1);
  const spawn = ScriptProvider.getByTrigger(ServerTriggerType.AI_SPAWN, type.id, type.category);
  assert(spawn, 'published spawn trigger missing');
  const spawned = ScriptRunner.init(spawn, npc);
  npc.executeScript(spawned);
  assert.equal(spawned.execution, ScriptState.FINISHED, 'published spawn sets the combat XP scale');
  npc.lastMovement = -100;
  if (!test.npc) assert.equal(npc.baseLevels[NpcStat.HITPOINTS], 8, 'published cow oracle is 8 HP');
  const last = test.last === 'hero' ? hero : test.last === 'finisher' ? finisher : null;
  npc.setVar(ids.attacker, last?.uid ?? -1);
  npc.heroPoints.addHero(hero.hash64, test.last === 'hero' ? 8 : 7);
  if (test.last === 'finisher') npc.heroPoints.addHero(finisher.hash64, 1);
  check('top damage hero is not reassigned', npc.heroPoints.findHero().toString(), hero.hash64.toString());
  check('hero lookup visibility', Boolean(World.getPlayerByHash64(hero.hash64)), test.online);
  const trigger = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, type.id, type.category);
  assert(trigger, 'published death trigger missing');
  const state = ScriptRunner.init(trigger, npc);
  assert.equal(state._activeNpc2, null, 'a death queue does not receive a second NPC');
  const objects = [];
  let deleteCalls = 0;
  const originalAddObj = World.addObj;
  const originalDelete = ScriptRunner.HANDLERS[ScriptOpcode.NPC_DEL];
  World.addObj = function (obj, receiver, duration) {
    objects.push({ id: obj.type, count: obj.count, receiver: receiver.toString() });
    return originalAddObj.call(this, obj, receiver, duration);
  };
  ScriptRunner.HANDLERS[ScriptOpcode.NPC_DEL] = current => {
    deleteCalls++;
    return originalDelete(current);
  };
  try {
    npc.applyDamage(npc.levels[NpcStat.HITPOINTS], 1);
    npc.executeScript(state);
    for (let tick = 0; state.execution === ScriptState.NPC_SUSPENDED && tick < 20; tick++) {
      for (const actor of actors) if (World.players[actor.slot] === actor) actor.processQueues();
      World.currentTick = Math.max(World.currentTick + 1, npc.delayedUntil);
      npc.delayed = false;
      npc.executeScript(state);
    }
    for (const actor of actors) if (World.players[actor.slot] === actor) actor.processQueues();
    const observed = {
      case: test.name, npc: { id: type.id, name: type.debugname, trigger: trigger.name },
      execution: state.execution, failingScript: state.execution === ScriptState.ABORTED ? state.script.name : null,
      secondaryOperand: state.execution === ScriptState.ABORTED ? state.intOperand : null,
      active: npc.isActive, lifecycleTick: npc.lifecycleTick, deleteCalls, objects,
      credit: actors.map((actor, i) => before[i].count - actor.getVar(ids.count)),
      xp: actors.map((actor, i) => actor.stats[PlayerStat.SLAYER] - before[i].xp)
    };
    check('death script finishes', state.execution, ScriptState.FINISHED);
    check('NPC removed once', deleteCalls, 1);
    check('NPC enters inactive respawn state', !npc.isActive && npc.lifecycleTick > 0, true);
    check('task count decrements', observed.credit, test.credit);
    check('Slayer XP in tenths', observed.xp, test.xp);
    const expectedObjects = test.loot ? (test.npc ? ['shade_bones1'] : ['bones', 'raw_beef', 'cow_hide']).map(name => ({
      id: configs.ObjType.getId(name), count: 1, receiver: hero.hash64.toString()
    })).sort((a, b) => a.id - b.id) : [];
    check('one drop batch or existing offline-hero suppression', objects.sort((a, b) => a.id - b.id), expectedObjects);
    if (state.execution === ScriptState.FINISHED && !npc.isActive) {
      World.currentTick++;
      npc.turn();
      check('no duplicate deletion after next NPC turn', deleteCalls, 1);
      check('no duplicate drop after next NPC turn', objects, expectedObjects);
    }
    const verdict = checks.every(item => item.pass) ? 'PASS' : 'FAIL';
    console.log(`CASE ${verdict} ${JSON.stringify({ ...observed, checks })}`);
    return verdict;
  } finally {
    World.addObj = originalAddObj;
    ScriptRunner.HANDLERS[ScriptOpcode.NPC_DEL] = originalDelete;
    for (const actor of actors) {
      if (World.players[actor.slot] === actor) {
        World.players[actor.slot] = null;
        actor.unlink();
      }
    }
  }
}
World.currentTick = 10;
const results = cases.map(runCase);
const failed = results.filter(result => result === 'FAIL').length;
console.log(`RESULT ${failed ? 'FAIL' : 'PASS'} npc-death: ${results.length - failed}/${results.length} cases passed`);
process.exit(failed ? 1 : 0);
