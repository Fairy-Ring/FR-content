/** Compare repeatable native operations, including automatic door expiry, at level 99. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { content, World, map, types } from '../stair-links/runtime.mjs';

const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const load = async rel => (await import(pathToFileURL(path.join(engine, 'src', rel)).href)).default;
const Player = await load('engine/entity/Player.ts');
const JavaRandom = await load('util/JavaRandom.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const OpLocHandler = await load('network/game/client/handler/OpLocHandler.ts');
const OpLoc = await load('network/game/client/model/OpLoc.ts');
const { PlayerStatMap } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const thieving = PlayerStatMap.get('THIEVING');
const hamBit = types.VarBitType.getId('ham_thief');
const lockpick = types.ObjType.getId('lockpick'), inv = types.InvType.getId('inv');
const door = { name: 'door_2555', level: 1, x: 2572, z: 3288 };
const ham = { name: 'ham_multi_trapdoor', level: 0, x: 3166, z: 3252 };
let serial = 0;
function player(row, x = row.x, z = row.z) {
  const id = ++serial;
  const p = new Player(`pickrate_${id}`, BigInt(id), BigInt(id));
  p.slot = p.pid = id; p.uid = BigInt(id); p.vars.fill(0);
  [p.level, p.x, p.z] = [row.level, x, z];
  p.setLevel(thieving, 99); p.getInventory(inv).add(lockpick, 1);
  assert.equal(map.isMapBlocked(x, z, row.level), false, 'initial native standing tile is walkable');
  return p;
}
function seedFor(method, succeeds, reward = 0) {
  for (let seed = 0; seed < 100000; seed++) {
    JavaRandom.setSeed(seed);
    const draw = JavaRandom.nextDouble();
    const success = method === 'door' ? Math.floor(draw * 100) >= 50 : Math.floor(draw * 256) < 255;
    if (success !== succeeds) continue;
    if (method === 'ham' && !succeeds && Math.floor(JavaRandom.nextDouble() * 2) !== reward) continue;
    JavaRandom.setSeed(seed);
    return;
  }
  assert.fail('bounded native RNG fixture exists');
}
function input(p, row, slot) {
  const loc = World.getLoc(row.x, row.z, row.level, types.LocType.getId(row.name));
  if (!loc) return false; // The real automatic door is still an invisible wall.
  p.originX = p.x; p.originZ = p.z;
  return new OpLocHandler().handle(new OpLoc(slot, row.x, row.z, loc.type), p);
}
function frame(p, action = () => {}) {
  // World.cycle: client input, suspended script/player interaction, then real zone expiry.
  action();
  if (p.delayed && World.currentTick >= p.delayedUntil) p.delayed = false;
  if (!p.delayed && p.activeScript?.execution === ScriptState.SUSPENDED) p.executeScript(p.activeScript, true, true);
  p.processInteraction();
  World.processZones();
  p.resetEntity(false);
  World.currentTick++;
}
function drain(p) {
  for (let i = 0; i < 20 && (p.activeScript || [...World.locObjTracker.all()].length); i++) frame(p);
  assert.equal(p.activeScript, null);
  assert.equal([...World.locObjTracker.all()].length, 0, 'native temporary doors expired without a manual reset');
}
function run(method, successes, ticks = 100, failureReward = 0) {
  const row = method === 'door' ? door : ham;
  const p = player(row, method === 'door' ? row.x : 3165, row.z);
  const before = p.stats[thieving], begin = World.currentTick;
  const rewards = [], attempts = [], returns = [];
  let attempt = 0;
  for (let tick = 0; tick < ticks; tick++) {
    const xp = p.stats[thieving];
    frame(p, () => {
      if (method === 'ham' && p.getVarBit(hamBit) !== 0) {
        if (input(p, row, 2)) returns.push(tick);
      } else if (method === 'door' && p.z !== row.z) {
        if (input(p, row, 1)) returns.push(tick);
      } else {
        const succeeds = successes(attempt);
        seedFor(method, succeeds, failureReward);
        if (input(p, row, method === 'door' ? 2 : 5)) { attempts.push(tick); attempt++; }
      }
    });
    if (p.stats[thieving] > xp) rewards.push(tick);
  }
  const xp = (p.stats[thieving] - before) / 10;
  drain(p);
  return { xp, rewards, attempts, returns, elapsed: World.currentTick - begin };
}

// Native success paths have no forced post-fixture movement. Open walks back through the door.
const doorMax = run('door', () => true);
const hamMax = run('ham', () => true);
assert.deepEqual(doorMax.rewards, Array.from({ length: 17 }, (_, i) => i * 6), 'both three-tick automatic closes and return Open are counted');
assert.deepEqual(doorMax.returns, Array.from({ length: 17 }, (_, i) => i * 6 + 3).filter(t => t < 100));
assert.deepEqual(hamMax.rewards, Array.from({ length: 50 }, (_, i) => i * 2), 'standing Pick-Lock and Close occupy separate input ticks');
assert.equal(doorMax.xp, 850);
assert.equal(hamMax.xp, 200);
assert.ok(hamMax.xp <= doorMax.xp, 'maximum HAM XP per 100 ticks cannot exceed the best published locked-door rate at the same level');

// Failures are real native draws. The H.A.M. drain is not reset during a run.
const doorFailure = run('door', () => false, 1);
const hamFailure0 = run('ham', () => false, 1, 1);
const hamFailure1 = run('ham', () => false, 1, 0);
assert.equal(doorFailure.xp, 0);
assert.equal(hamFailure0.xp, 0);
assert.equal(hamFailure1.xp, 1);
const doorSuccessTicks = doorMax.rewards[1] - doorMax.rewards[0];
const hamSuccessTicks = hamMax.rewards[1] - hamMax.rewards[0];
const doorReward = doorMax.xp / doorMax.rewards.length;
const hamReward = hamMax.xp / hamMax.rewards.length;
const failureTicks = 1;
const sameChance = 0.5; // Published random(100) < 50; comparison only, never a product override.
const expectedRate = (reward, duration, failureXp) => 100 * (sameChance * reward + (1 - sameChance) * failureXp)
  / (sameChance * duration + (1 - sameChance) * failureTicks);
const doorRate = expectedRate(doorReward, doorSuccessTicks, doorFailure.xp);
const hamRate = expectedRate(hamReward, hamSuccessTicks, (hamFailure0.xp + hamFailure1.xp) / 2);
assert.ok(hamRate <= doorRate, 'same-level, same-success-rule HAM rate cannot exceed the published family');
assert.ok(100 * Math.max(hamReward / hamSuccessTicks, hamFailure1.xp / failureTicks) <= doorRate,
  'even the HAM all-success/failure ceiling stays below the published 50-percent rate');
console.log(`RESULT PASS picklock rate: level=99 maximum/100 ticks door=${doorMax.xp} HAM=${hamMax.xp}; same 50% rule door=${doorRate.toFixed(6)} HAM=${hamRate.toFixed(6)}; success cycles door=${doorSuccessTicks} HAM=${hamSuccessTicks}`);
process.exit(0);
