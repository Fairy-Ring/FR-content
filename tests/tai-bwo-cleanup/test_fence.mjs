#!/usr/bin/env node
/** Packed Tai Bwo Wannai fence dispatch, progression, rewards and gates. */
import assert from 'node:assert/strict';
import {
  World, types, fixture, get, set, id, obj, inv, worn, count,
  PlayerStat, ScriptProvider, ScriptState, ServerTriggerType, engineModule, standAt
} from './runtime.mjs';

const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const OpLocHandler = (await engineModule('network/game/client/handler/OpLocHandler.ts')).default;
const opLocHandler = new OpLocHandler();

const stageNames = [
  'village_fence_rotten',
  'village_fence_fixed1',
  'village_fence_fixed2',
  'village_fence_fixed3',
  'village_fence_fixedcomplete'
];
const stageIds = new Map(stageNames.map(name => [id('LocType', name), name]));

// Find the original map placements from the packed map, not a generated loc id.
const fences = [];
for (let x = 43 * 64; x < 44 * 64; x += 8) {
  for (let z = 47 * 64; z < 48 * 64; z += 8) {
    for (const loc of World.gameMap.getZone(x, z, 0).getAllLocsUnsafe()) {
      if (loc.baseType === id('LocType', 'village_fence_rotten')) fences.push(loc);
    }
  }
}
fences.sort((a, b) => a.x - b.x || a.z - b.z);
assert(fences.length >= 2, 'the two original rotten-fence map placements are packed');

function stageName(loc) {
  return stageIds.get(loc.type) ?? types.LocType.get(loc.type)?.debugname;
}

function readyPlayer(loc) {
  const p = fixture();
  standAt(p, loc);
  set(p, 'cleanup_progress', 1);
  p.originX = p.x;
  p.originZ = p.z;
  return p;
}

function wield(p, name = 'machette') {
  p.getInventory(worn).removeAll();
  p.invAdd(worn, obj(name), 1);
}

function beginFenceAction(p, loc, expectedStage) {
  assert.equal(stageName(loc), expectedStage, `visible loc form is ${expectedStage}`);
  const type = types.LocType.get(loc.type);
  const trigger = ScriptProvider.getByTrigger(ServerTriggerType.OPLOC1, type.id, type.category);
  assert(trigger, `packed OPLOC1 trigger for visible ${expectedStage}`);
  assert.equal(trigger.name, `[oploc1,${expectedStage}]`, `dispatch is bound to visible ${expectedStage}`);
  p.originX = p.x;
  p.originZ = p.z;
  assert.equal(opLocHandler.handle(new OpLoc(1, loc.x, loc.z, loc.type), p), true,
    `native Repair/Reinforce option accepted for ${expectedStage}`);
  const executeScript = p.executeScript;
  let dispatched = null;
  p.executeScript = function (state, ...args) {
    if (state.script.name === trigger.name) dispatched = state;
    return executeScript.call(this, state, ...args);
  };
  try { p.processInteraction(); }
  finally { p.executeScript = executeScript; }
  assert(dispatched, `native location dispatch starts ${trigger.name}`);
  return dispatched;
}

function finishFenceAction(p, state, label) {
  for (let tick = 0; state.execution !== ScriptState.FINISHED && tick < 40; tick++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, `${label} did not abort`);
    assert(
      state.execution === ScriptState.SUSPENDED || state.execution === ScriptState.RUNNING,
      `${label} has a supported interpreter state ${state.execution}`
    );
    World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
    p.delayed = false;
    p.executeScript(state, true, true);
  }
  assert.equal(state.execution, ScriptState.FINISHED, `${label} completes`);
  if (p.activeScript === state) p.activeScript = null;
  p.clearPendingAction();
  p.clearInteraction();
}

function doFenceAction(p, loc, expectedStage) {
  const state = beginFenceAction(p, loc, expectedStage);
  finishFenceAction(p, state, expectedStage);
}

function occupiedSlots(p) {
  const size = types.InvType.get(inv).size;
  let occupied = 0;
  for (let slot = 0; slot < size; slot++) if (p.invGetSlot(inv, slot)) occupied++;
  return occupied;
}

function assertNoWork(p, loc, before, why) {
  assert.equal(stageName(loc), before.stage, `${why}: no fence progression`);
  assert.equal(count(p, 'thatching_spar_light'), before.light, `${why}: no light spar consumed`);
  assert.equal(count(p, 'thatching_spar_med'), before.med, `${why}: no medium spar consumed`);
  assert.equal(count(p, 'thatching_spar_dense'), before.dense, `${why}: no dense spar consumed`);
  assert.equal(get(p, 'vill_comm_points'), before.points, `${why}: no favour awarded`);
  assert.equal(p.stats[PlayerStat.WOODCUTTING], before.xp, `${why}: no Woodcutting XP awarded`);
}

const fence = fences[0];
const p = readyPlayer(fence);
const initial = {
  stage: 'village_fence_rotten', light: 0, med: 0, dense: 0,
  points: get(p, 'vill_comm_points'), xp: p.stats[PlayerStat.WOODCUTTING]
};

// CANDIDATE: speaking to Murcaily after Jungle Potion is required to start work.
set(p, 'cleanup_progress', 0);
const unintroduced = beginFenceAction(p, fence, 'village_fence_rotten');
finishFenceAction(p, unintroduced, 'unintroduced fence attempt');
assertNoWork(p, fence, initial, 'activity not introduced');
assert.equal(get(p, 'cleanup_progress'), 0, 'blocked attempt does not mark the activity introduced');
set(p, 'cleanup_progress', 1);

// CANDIDATE: 2007rshelp says the machete must be wielded; inventory-only is not enough.
p.getInventory(worn).removeAll();
p.invAdd(inv, obj('machette'), 1);
p.invAdd(inv, obj('thatching_spar_light'), 1);
const unwielded = {
  ...initial, light: 1,
  points: get(p, 'vill_comm_points'), xp: p.stats[PlayerStat.WOODCUTTING]
};
const noWield = beginFenceAction(p, fence, 'village_fence_rotten');
finishFenceAction(p, noWield, 'unwielded machete fence attempt');
assertNoWork(p, fence, unwielded, 'machete is not wielded');
assert(p.messages.includes('You need to wield a machete.'), 'plain functional no-machete message is shown');

p.getInventory(inv).removeAll();
wield(p);
const noSpar = {
  ...initial,
  points: get(p, 'vill_comm_points'), xp: p.stats[PlayerStat.WOODCUTTING]
};
const missingSpar = beginFenceAction(p, fence, 'village_fence_rotten');
finishFenceAction(p, missingSpar, 'missing spar fence attempt');
assertNoWork(p, fence, noSpar, 'no spar');
assert(p.messages.includes('You need a thatching spar.'), 'plain functional no-spar message is shown');

// UNKNOWN cost: source text names spars but no per-action count; one is consumed.
// A full inventory remains valid because a repair creates no inventory item.
const inventorySize = types.InvType.get(inv).size;
for (let slot = 0; slot < inventorySize; slot++) p.invAdd(inv, obj('thatching_spar_light'), 1);
assert.equal(count(p, 'thatching_spar_light'), inventorySize, 'full inventory has one spar in every slot');
assert.equal(occupiedSlots(p), inventorySize, 'inventory has no free slot before repair');
const lightXp = p.stats[PlayerStat.WOODCUTTING];
doFenceAction(p, fence, 'village_fence_rotten');
assert.equal(stageName(fence), 'village_fence_fixed1', 'rotten fence advances to partial fence');
assert.equal(count(p, 'thatching_spar_light'), inventorySize - 1, 'one light spar is consumed');
assert.equal(occupiedSlots(p), inventorySize - 1, 'repair creates no item and frees only the consumed spar slot');
assert.equal(p.stats[PlayerStat.WOODCUTTING] - lightXp, 281, 'light spar grants 28.1 Woodcutting XP');
assert.equal(get(p, 'vill_comm_points'), 1, 'light spar adds 0.1% favour in tenths');
assert.equal(get(p, 'favour_percentage'), 0, 'HUD percent floors the first tenth');
assert.equal(get(p, 'cleanup_progress'), 2, 'first successful repair sets the repaired milestone');

// Isolate each spar type so every reward and exact consumption path is exercised.
p.getInventory(inv).removeAll();
const rewardSteps = [
  { stage: 'village_fence_fixed1', next: 'village_fence_fixed2', spar: 'thatching_spar_med', xp: 421, favour: 3, points: 4 },
  { stage: 'village_fence_fixed2', next: 'village_fence_fixed3', spar: 'thatching_spar_dense', xp: 651, favour: 5, points: 9 },
  { stage: 'village_fence_fixed3', next: 'village_fence_fixedcomplete', spar: 'thatching_spar_light', xp: 281, favour: 1, points: 10 }
];
for (const step of rewardSteps) {
  p.invAdd(inv, obj(step.spar), 1);
  const xp = p.stats[PlayerStat.WOODCUTTING];
  const points = get(p, 'vill_comm_points');
  doFenceAction(p, fence, step.stage);
  assert.equal(stageName(fence), step.next, `${step.stage} advances to ${step.next}`);
  assert.equal(count(p, step.spar), 0, `${step.spar} is consumed exactly once`);
  assert.equal(p.stats[PlayerStat.WOODCUTTING] - xp, step.xp, `${step.spar} grants its source-backed XP`);
  assert.equal(get(p, 'vill_comm_points') - points, step.favour, `${step.spar} grants its source-backed favour`);
  assert.equal(get(p, 'vill_comm_points'), step.points, 'exact favour points accumulate in tenths of one percent');
  assert.equal(get(p, 'favour_percentage'), Math.floor(step.points / 10), 'whole-percent HUD is updated');
}

// CANDIDATE: the completed fence can be reinforced the same way; its visible
// form remains complete and reinforcement refreshes the existing decay timer.
set(p, 'cleanup_progress', 3);
p.invAdd(inv, obj('thatching_spar_med'), 1);
fence.setLifeCycle(10); // Simulate an aging completed fence without pinning its configured lifetime.
const priorLifecycle = fence.lifecycleTick;
const reinforceXp = p.stats[PlayerStat.WOODCUTTING];
const reinforcePoints = get(p, 'vill_comm_points');
doFenceAction(p, fence, 'village_fence_fixedcomplete');
assert.equal(stageName(fence), 'village_fence_fixedcomplete', 'reinforcing keeps the completed visible form');
assert(fence.lifecycleTick > priorLifecycle, 'reinforcement refreshes the fence decay lifecycle');
assert.equal(count(p, 'thatching_spar_med'), 0, 'reinforcement consumes exactly one medium spar');
assert.equal(p.stats[PlayerStat.WOODCUTTING] - reinforceXp, 421, 'reinforcement grants medium-spar XP');
assert.equal(get(p, 'vill_comm_points') - reinforcePoints, 3, 'reinforcement adds 0.3% favour');
assert.equal(get(p, 'vill_comm_points'), 13, 'reinforcement preserves exact cumulative favour points');
assert.equal(get(p, 'favour_percentage'), 1, 'favour HUD reflects the accumulated whole percent');
assert.equal(get(p, 'cleanup_progress'), 3, 'repair milestone does not overwrite a later progress stage');

// Two simultaneous attempts on one visible form may not double-advance or
// charge the stale second interaction after the first stage change.
const contested = fences[1];
const first = readyPlayer(contested);
const second = readyPlayer(contested);
for (const actor of [first, second]) {
  wield(actor);
  actor.invAdd(inv, obj('thatching_spar_light'), 1);
}
const firstBefore = first.stats[PlayerStat.WOODCUTTING];
const secondBefore = second.stats[PlayerStat.WOODCUTTING];
const firstState = beginFenceAction(first, contested, 'village_fence_rotten');
const secondState = beginFenceAction(second, contested, 'village_fence_rotten');
finishFenceAction(first, firstState, 'first concurrent repair');
finishFenceAction(second, secondState, 'stale concurrent repair');
assert.equal(stageName(contested), 'village_fence_fixed1', 'only one concurrent attempt advances this stage');
assert.equal(count(first, 'thatching_spar_light'), 0, 'successful concurrent attempt consumes one spar');
assert.equal(count(second, 'thatching_spar_light'), 1, 'stale concurrent attempt consumes no spar');
assert.equal(first.stats[PlayerStat.WOODCUTTING] - firstBefore, 281, 'successful concurrent attempt earns XP once');
assert.equal(second.stats[PlayerStat.WOODCUTTING], secondBefore, 'stale concurrent attempt earns no XP');
assert.equal(get(first, 'vill_comm_points'), 1, 'successful concurrent attempt earns favour once');
assert.equal(get(second, 'vill_comm_points'), 0, 'stale concurrent attempt earns no favour');
assert(second.messages.includes('The fence has changed; try again.'), 'stale concurrent attempt receives a functional recheck message');

console.log('RESULT PASS tai-bwo-cleanup fence: gates, all visible stages, reinforcement, rewards, full inventory and concurrent recheck');
process.exit(0);
