#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const loadEngine = relative => import(pathToFileURL(path.join(engine, 'src', relative)).href);
const Environment = (await loadEngine('util/Environment.ts')).default;
Environment.NODE_MEMBERS = true;

const { JavaRandom, Runner, Scripts, State, World, id, load, player, types } = await import('./runtime.mjs');
const ServerTriggerType = (await load('engine/script/ServerTriggerType.ts')).default;
const Npc = (await load('engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await load('engine/entity/EntityLifeCycle.ts');
const { NpcStat } = await load('engine/entity/NpcStat.ts');

// Regression expectations from the existing script, not target-era proof.
const outcomes = [
  { name: 'potato_seed', count: 4, start: 0, end: 368 },
  { name: 'onion_seed', count: 4, start: 368, end: 644 },
  { name: 'cabbage_seed', count: 4, start: 644, end: 828 },
  { name: 'tomato_seed', count: 3, start: 828, end: 920 },
  { name: 'sweetcorn_seed', count: 3, start: 920, end: 966 },
  { name: 'strawberry_seed', count: 2, start: 966, end: 989 },
  { name: 'watermelon_seed', count: 2, start: 989, end: 1000 }
];
assert.equal(outcomes[outcomes.length - 1].end, 1000, 'native inner table spans random(1000)');

function scriptRoll(bound) {
  return Math.floor(JavaRandom.nextDouble() * bound);
}

function seedForLizard(level, outcome, fractionRange = null) {
  for (let seed = 1; seed <= 100_000; seed++) {
    JavaRandom.setSeed(seed);
    const outer = scriptRoll(128);
    if (outer < 14 || outer >= 23) continue;
    const fraction = JavaRandom.nextDouble();
    if (fractionRange && (fraction < fractionRange.start || fraction >= fractionRange.end)) continue;
    if (Math.floor(fraction * level * 10) >= 484) continue;
    const inner = scriptRoll(1000);
    if (inner >= outcome.start && inner < outcome.end) return seed;
  }
  assert.fail(`no native JavaRandom seed found for level ${level} and ${outcome.name}`);
}

function runLizardDrop(typeName, level, outcome, seed) {
  const type = types.NpcType.get(id('NpcType', typeName));
  const queue = Scripts.getByTrigger(ServerTriggerType.AI_QUEUE4, type.id, type.category);
  assert.equal(queue, Scripts.getByName('[ai_queue4,_slayer_lizard]'), `${typeName} uses the compiled lizard death queue`);

  const collector = player();
  let npc;
  try {
    npc = new Npc(collector.level, collector.x + type.size + 1, collector.z, type.size, type.size,
      EntityLifeCycle.RESPAWN, World.getNextNid(), type.id, type.blockwalk);
    World.addNpc(npc, -1);
    World.processNpcEventQueue();
    World.playerLoop.add(BigInt(collector.pid), collector);

    const spawn = Scripts.getByTrigger(ServerTriggerType.AI_SPAWN, type.id, type.category);
    if (spawn) {
      const spawnState = Runner.init(spawn, npc);
      npc.executeScript(spawnState);
      assert.equal(spawnState.execution, State.FINISHED, `${typeName} spawn trigger finishes`);
    }
    npc.lastMovement = -100;
    npc.heroPoints.addHero(collector.hash64, 8);
    npc.setVar(id('VarNpcType', 'npc_aggressive_player'), collector.uid);
    npc.applyDamage(npc.levels[NpcStat.HITPOINTS], 1);

    const state = Runner.init(queue, npc);
    const objects = [];
    const originalAddObj = World.addObj;
    World.addObj = function (object, receiver, duration) {
      objects.push(object);
      return originalAddObj.call(this, object, receiver, duration);
    };
    try {
      JavaRandom.setSeed(seed);
      npc.executeScript(state);
      for (let tick = 0; state.execution === State.NPC_SUSPENDED && tick < 20; tick++) {
        collector.processQueues();
        World.currentTick = Math.max(World.currentTick + 1, npc.delayedUntil);
        npc.delayed = false;
        npc.executeScript(state);
      }
      collector.processQueues();
    } finally {
      World.addObj = originalAddObj;
    }

    assert.equal(state.execution, State.FINISHED, `${typeName} AI_QUEUE4 death dispatch finishes`);
    const expectedId = id('ObjType', outcome.name);
    const produced = objects.filter(object => object.type === expectedId);
    assert.equal(produced.length, 1, `${typeName} dispatch produces one ${outcome.name}`);
    assert.equal(produced[0].count, outcome.count, `${typeName} dispatch produces ${outcome.count} ${outcome.name}`);
    assert.equal(produced[0].x, npc.x);
    assert.equal(produced[0].z, npc.z);
  } finally {
    if (npc) World.removeNpc(npc, -1);
    if (World.players[collector.pid] === collector) World.players[collector.pid] = null;
    collector.unlink();
  }
}

// src.slayer-runevillage-guide-20060214 lists visible levels 12, 24, and 42.
// Exercise every configured lizard variant on the compiled AI_QUEUE4 handler.
const lizards = [
  { type: 'slayer_lizard_small1_green', level: 12 },
  { type: 'slayer_lizard_small2_sandy', level: 12 },
  { type: 'slayer_lizard_large1_green', level: 24 },
  { type: 'slayer_lizard_large2_sandy', level: 24 },
  { type: 'slayer_lizard_large3_sandy', level: 24 },
  { type: 'slayer_lizard_massive', level: 42 }
];
World.currentTick = 100;
let witnesses = 0;
for (const lizard of lizards) {
  for (const outcome of outcomes) {
    const seed = seedForLizard(lizard.level, outcome);
    runLizardDrop(lizard.type, lizard.level, outcome, seed);
    witnesses++;
  }
}

// A near-one native RNG sample still maps below 420 at the highest sourced level;
// with an unsupported random(1000) bound it would enter a later table tier instead.
const highestLizard = lizards.find(lizard => lizard.level === 42);
assert(highestLizard, 'the highest sourced lizard form is present');
const highestRollWitness = seedForLizard(highestLizard.level, outcomes[0], { start: 0.995, end: 1 });
runLizardDrop(highestLizard.type, highestLizard.level, outcomes[0], highestRollWitness);
witnesses++;
console.log(`PASS: ${witnesses} compiled lizard AI_QUEUE4 native JavaRandom general-table witnesses`);
process.exit(0);
