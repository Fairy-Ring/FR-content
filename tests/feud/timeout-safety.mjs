import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Packet, PlayerLoading, PlayerStat, ScriptProvider, ScriptState, ServerTriggerType, World, count, engineModule,
  execute, id, inv, inventory, obj, seed, types
} from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';
import {
  actors, bit, displayNpcType, hasWitness, operate, operateHere, operationStand, read, stage, talk, wield, worldTick
} from './fixture.mjs';
import { followToSeclusion } from './follow.mjs';

const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { NpcStat } = await engineModule('engine/entity/NpcStat.ts');
const { NpcMode } = await engineModule('engine/entity/NpcMode.ts');
const rsbuf = await engineModule('network/rsbuf/index.ts');
const slotVar = id('VarPlayerType', 'feud_trial_villager');
const stateVar = id('VarNpcType', 'feud_villager_state');
const ownerVar = id('VarNpcType', 'feud_villager_owner');
const deadlineVar = id('VarNpcType', 'feud_villager_deadline');
const poisonVar = id('VarNpcType', 'npc_poison');
const repeatFollowVar = id('VarNpcType', 'feud_repeat_follow_deadline');
const repeatKoVar = id('VarNpcType', 'feud_repeat_ko_deadline');
const villagerFormNames = [
  'feud_villager_multi_1', 'feud_villager_multi_2', 'feud_villager_multi_3',
  'feud_villager_1_1', 'feud_villager_1_2', 'feud_villager_1_3',
  'feud_villager_2_1', 'feud_villager_2_2', 'feud_villager_2_3',
  'feud_villager_3_1', 'feud_villager_3_2', 'feud_villager_3_3'
];
const villagerTypes = new Set([1, 2, 3].map(number => id('NpcType', `feud_villager_multi_${number}`)));
const MAX_NPC_CALLBACKS_PER_TICK = 4;

const villagers = () => [...World.npcs].filter(npc => npc.isActive && villagerTypes.has(npc.baseType));
const owned = p => villagers().filter(npc => npc.getVar(stateVar) !== 0 && (npc.getVar(ownerVar) >>> 0) === p.uid);
const xp = p => p.stats[PlayerStat.THIEVING];
const resultSnapshot = p => ({ stage: stage(p), coins: count(p, 'coins'), xp: xp(p), inventory: inventory(p) });

function trialFixture() {
  const p = seed(player(), ['blackjack_oak']);
  // Disclosed own-player pre-trial seed; every tested Feud NPC state is produced by compiled actions.
  p.setVarBit(bit('feud_var'), 6);
  p.setVar(slotVar, -1);
  p.invAdd(inv, obj('coins'), 100);
  wield(p, 'blackjack_oak');
  rsbuf.addPlayer(p.slot);
  return p;
}

function repeatFixture() {
  const p = seed(player(), ['blackjack_oak']);
  // Disclosed own-player post-Feud seed; every tested Feud NPC state is produced by compiled actions.
  p.setVarBit(bit('feud_var'), 28);
  p.setVarBit(bit('feud_npc_multi'), 2);
  p.setVar(slotVar, -1);
  p.setLevel(PlayerStat.THIEVING, 65);
  wield(p, 'blackjack_oak');
  rsbuf.addPlayer(p.slot);
  return p;
}

function availableIdle(npc) {
  return npc.getVar(stateVar) === 0 && [...npc.queue.all()].length === 0 && npc.timerInterval <= 0;
}

function reachDistraction(p) {
  const first = villagers().find(npc => availableIdle(npc) && operationStand(p, npc));
  assert(first, 'an original placed Villager can earn the first theft');
  operate(p, first, 3);
  assert.equal(stage(p), 7);
  assert.equal(read(p, 'feud_npc_multi'), 1);
  talk(p, 'feud_street_urchin');
  assert.equal(stage(p), 8);
  const [target] = owned(p);
  assert(target, 'the compiled urchin action selects an original Villager');
  assert.equal(target.getVar(stateVar), 1);
  assert.equal(p.getVar(slotVar), target.uid);
  assert.equal(target.timerInterval, 1, 'the compiled distraction arms the original NPC timer');
  return target;
}

function secludedTarget(p) {
  const target = villagers().find(npc => availableIdle(npc) && !hasWitness(p, npc) && operationStand(p, npc));
  assert(target, 'an original reachable Villager has no candidate under the native witness predicate');
  return target;
}

function lure(p, target = secludedTarget(p)) {
  const before = resultSnapshot(p);
  operate(p, target, 4);
  assert.equal(stage(p), before.stage === 9 ? 10 : before.stage);
  assert.equal(xp(p), before.xp, 'the real Lure awards no XP');
  assert.equal(count(p, 'coins'), before.coins, 'the real Lure awards no coins');
  assert.equal(target.getVar(stateVar), 2);
  assert.equal(target.getVar(ownerVar), p.uid);
  assert.equal(p.getVar(slotVar), target.uid);
  assert.equal(target.timerInterval, 1, 'the real Lure arms its native timer');
  return target;
}

function withRandom(value, action) {
  const previous = JavaRandom.nextDouble;
  JavaRandom.nextDouble = () => value;
  try { return action(); } finally { JavaRandom.nextDouble = previous; }
}

function knockOutHere(p, target) {
  assert(p.inOperableDistance(target), 'the player remains beside the lured target; no post-Lure repositioning');
  assert(!hasWitness(p, target), 'the original witness predicate permits this real knock-out');
  const position = [p.level, p.x, p.z];
  withRandom(0, () => operateHere(p, target, 5));
  assert.deepEqual([p.level, p.x, p.z], position, 'the knock-out does not teleport the player');
  assert.equal(target.getVar(stateVar), 3);
  assert.equal(target.getVar(ownerVar), p.uid);
  assert.equal(p.getVar(slotVar), target.uid);
  return target.getVar(deadlineVar);
}

function dispatchSynchronousKnockOut(p, target) {
  assert(p.inOperableDistance(target), 'the lured NPC naturally follows into operation range');
  assert(!hasWitness(p, target), 'the original witness predicate permits this real knock-out');
  p.clearInteraction();
  assert(p.setInteraction(1, target, ServerTriggerType.APNPC1 + 4), 'the native knock-out input is accepted');
  assert(p.getOpTrigger(), 'the visible-form dispatcher resolves the compiled knock-out action');
  withRandom(0, () => p.processInteraction());
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED,
    'the compiled knock-out input completes synchronously without a finish/tick inside the input callback');
  assert.equal(target.getVar(stateVar), 3);
  assert.equal(target.getVar(ownerVar), p.uid);
  assert.equal(p.getVar(slotVar), villagerTypes.has(target.baseType) ? target.uid : -1);
  return target.getVar(deadlineVar);
}

function attackableTarget(p, name, requireNoWitness = false) {
  return actors(name).find(npc => npc.getVar(stateVar) === 0 && [...npc.queue.all()].length === 0 &&
    npc.timerInterval <= 0 && (!requireNoWitness || !hasWitness(p, npc)) && operationStand(p, npc));
}

function assertAttackableQueueBound(npc) {
  const requests = [...npc.queue.all()];
  const timeoutRequests = requests.filter(request => request.queueId === ServerTriggerType.AI_QUEUE19);
  assert.equal(requests.length, timeoutRequests.length, 'the repeat target has no unrelated native queue requests');
  const followCount = timeoutRequests.filter(request => request.lastInt === 0).length;
  const koCount = timeoutRequests.filter(request => request.lastInt === 1).length;
  assert(followCount <= 1, 'at most one follow timeout request is pending');
  assert(koCount <= 1, 'at most one KO timeout request is pending');
  assert.equal(followCount, Number(npc.getVar(repeatFollowVar) !== 0),
    'the follow deadline records exactly one pending callback or none');
  assert.equal(koCount, Number(npc.getVar(repeatKoVar) !== 0),
    'the KO deadline records exactly one pending callback or none');
  assert(requests.length <= 2, 'one follow plus one KO request is the hard per-NPC queue bound');
  return requests.length;
}

function attackableLure(p, target) {
  const before = resultSnapshot(p);
  operate(p, target, 4);
  assert.equal(target.getVar(stateVar), 2);
  assert.equal(target.getVar(ownerVar), p.uid);
  assert.equal(target.target, p);
  assert.equal(target.targetOp, NpcMode.PLAYERFOLLOW);
  assert.equal(p.getVar(slotVar), -1, 'repeat Lure does not acquire the trial-only player reference');
  assert.deepEqual(resultSnapshot(p), before, 'repeat Lure does not change trial rewards');
  assertAttackableQueueBound(target);
  return target.getVar(deadlineVar);
}

function attackableKnockOut(p, target) {
  assert(p.inOperableDistance(target), 'the original NPC remains within native operation range');
  assert(!hasWitness(p, target), 'the original witness predicate permits this native knock-out');
  const position = [p.level, p.x, p.z];
  withRandom(0, () => operateHere(p, target, 5));
  assert.deepEqual([p.level, p.x, p.z], position, 'the native action does not relocate the player');
  assert.equal(target.getVar(stateVar), 3);
  assert.equal(target.getVar(ownerVar), p.uid);
  assert.equal(p.getVar(slotVar), -1);
  assertAttackableQueueBound(target);
  return target.getVar(deadlineVar);
}

function npcSnapshot(npc) {
  return {
    state: npc.getVar(stateVar),
    owner: npc.getVar(ownerVar),
    deadline: npc.getVar(deadlineVar),
    poison: npc.getVar(poisonVar),
    hp: npc.levels[NpcStat.HITPOINTS]
  };
}

function observeNativeCallbacks(targets, action, observeCallback = null) {
  const original = Npc.prototype.executeScript;
  let callbacks = 0;
  let currentTick = null;
  let callbacksThisTick = 0;
  let maxCallbacksInOneTick = 0;
  Npc.prototype.executeScript = function (script) {
    if (!targets.has(this)) return original.call(this, script);
    const tick = World.currentTick;
    if (tick !== currentTick) {
      currentTick = tick;
      callbacksThisTick = 0;
    }
    callbacks++;
    callbacksThisTick++;
    maxCallbacksInOneTick = Math.max(maxCallbacksInOneTick, callbacksThisTick);
    if (callbacksThisTick > MAX_NPC_CALLBACKS_PER_TICK) {
      throw new Error(`native Feud NPC callback fuse exceeded ${MAX_NPC_CALLBACKS_PER_TICK} in one world tick`);
    }
    const before = npcSnapshot(this);
    const result = original.call(this, script);
    observeCallback?.({
      npc: this, tick, before, after: npcSnapshot(this)
    });
    return result;
  };
  try {
    action();
    return { callbacks, maxCallbacksInOneTick };
  } finally {
    Npc.prototype.executeScript = original;
  }
}

function countedWorldTick(targets, beforeNpcInput = null, observeCallback = null) {
  const summary = observeNativeCallbacks(targets, () => worldTick(beforeNpcInput), observeCallback);
  assert(summary.callbacks <= MAX_NPC_CALLBACKS_PER_TICK, 'the native callback count stayed within its explicit bound');
  return summary.callbacks;
}

function boundedTicksThrough(targets, deadline, observeTick = null, observeCallback = null) {
  assert(Number.isInteger(deadline) && deadline >= World.currentTick);
  let totalCallbacks = 0;
  while (World.currentTick < deadline) {
    const callbacks = countedWorldTick(targets, null, observeCallback);
    totalCallbacks += callbacks;
    observeTick?.(callbacks, World.currentTick);
  }
  assert.equal(World.currentTick, deadline, 'native ticks stop at the requested logical clock');
  return totalCallbacks;
}

function countedDeadlineTick(targets, deadline) {
  assert(deadline > World.currentTick, 'the exact native callback deadline is still ahead');
  boundedTicksThrough(targets, deadline - 1);
  assert.equal(World.currentTick, deadline - 1, 'the next native frame is the exact deadline frame');
  const callbacks = countedWorldTick(targets);
  assert.equal(World.currentTick, deadline, 'one worldTick advances exactly to the logical deadline');
  assert(callbacks > 0, 'the real NPC timeout entry executed on this tick');
  assert(callbacks <= MAX_NPC_CALLBACKS_PER_TICK, 'the real NPC timeout entry count is bounded');
  return callbacks;
}

function assertStillOwned(p, target, expectedState, deadline, expectedResults) {
  assert.equal(target.getVar(stateVar), expectedState);
  assert.equal(target.getVar(ownerVar), p.uid);
  assert.equal(target.getVar(deadlineVar), deadline);
  assert.equal(p.getVar(slotVar), target.uid);
  assert.deepEqual(resultSnapshot(p), expectedResults);
}

function assertReleased(p, target, expectedResults) {
  assert.equal(target.getVar(stateVar), 0);
  assert.equal(target.getVar(ownerVar), -1);
  assert.equal(target.getVar(deadlineVar), 0);
  if (villagerTypes.has(target.baseType)) {
    assert.equal(target.timerInterval, 0, 'the Villager-only timer is cleared with its condition');
  }
  if (p) assert.equal(p.getVar(slotVar), -1);
  assert.deepEqual(resultSnapshot(p), expectedResults);
}

function drainTargetQueues(targets) {
  const queued = [...targets].flatMap(npc => [...npc.queue.all()].map(request => request.delay));
  if (!queued.length) return;
  boundedTicksThrough(targets, World.currentTick + Math.max(1, ...queued));
  for (const npc of targets) assert.equal([...npc.queue.all()].length, 0, 'native timeout callbacks drain without residual queue growth');
}

function nativeLogout(p, tick = worldTick) {
  const username = p.username, pid = p.pid, slot = p.slot, uid = p.uid;
  p.clearInteraction();
  for (let step = 0; step < 128 && World.currentTick < p.preventLogoutUntil; step++) tick();
  assert(World.currentTick >= p.preventLogoutUntil, 'ordinary logout cooldown expires without bypass');
  const before = resultSnapshot(p);
  p.requestLogout = true;
  p.lastResponse = World.currentTick;
  tick();
  assert(![...World.playerLoop.all()].includes(p), 'production logout removes the old session');
  assert(!World.getPlayerByUid(uid), 'the logged-out owner is absent from native UID lookup');
  const request = World.logoutRequests.get(username);
  assert(request?.save, 'production logout supplies genuine saved player bytes');
  World.logoutRequests.delete(username); // Model the successful login-server save acknowledgement.
  assert.equal(p.getVar(slotVar), -1, 'the session target reference is cleared by ordinary logout');
  assert.deepEqual(resultSnapshot(p), before, 'ordinary logout preserves earned stage, items, coins and XP');
  return { username, save: request.save, pid, slot, expected: before };
}

function reloadAccount(receipt) {
  const loaded = PlayerLoading.load(receipt.username, new Packet(receipt.save), null);
  loaded.varsString ??= [];
  loaded.pid = receipt.pid;
  loaded.slot = receipt.slot;
  loaded.isActive = true;
  loaded.uid = ((Number(loaded.username37 & 0x1fffffn) << 11) | loaded.slot) >>> 0;
  loaded.packets = [];
  loaded.messages = [];
  loaded.write = packet => loaded.packets.push(packet);
  loaded.messageGame = text => loaded.messages.push(String(text));
  loaded.wrappedMessageGame = loaded.messageGame;
  loaded.lastResponse = loaded.lastConnected = World.currentTick;
  World.players[loaded.pid] = loaded;
  World.playerLoop.add(loaded.hash64, loaded);
  rsbuf.addPlayer(loaded.slot);
  World.gameMap.getZone(loaded.x, loaded.z, loaded.level).enter(loaded);
  World.instances.playerEntered({ level: loaded.level, x: loaded.x, z: loaded.z });
  loaded.onLogin();
  loaded.processEngineQueue();
  assert.deepEqual(resultSnapshot(loaded), receipt.expected, 'native login preserves the saved trial results');
  assert.equal(loaded.getVar(slotVar), -1, 'the transient target reference is not saved');
  return loaded;
}


function nextNpcTimerTick(npc) {
  assert(npc.timerInterval > 0);
  const remaining = npc.timerInterval - npc.timerClock;
  assert(remaining > 0, 'the native timer is between callbacks');
  return World.currentTick + remaining;
}

test('all twelve original Villager forms own an unset, type-specific timer and cannot take poison', () => {
  const p = player();
  for (const name of villagerFormNames) {
    const type = types.NpcType.get(id('NpcType', name));
    assert.equal(type.timer, -1, `${name} does not configure a pre-existing NPC timer`);
    assert.notEqual(type.op?.[1], 'Attack', `${name} has no Attack option 2`);
    const specific = ScriptProvider.getByTriggerSpecific(ServerTriggerType.AI_TIMER, type.id);
    assert.equal(specific?.name, `[ai_timer,${name}]`, `${name} has its own Feud timer handler`);
    assert.equal(ScriptProvider.getByTrigger(ServerTriggerType.AI_TIMER, type.id, type.category), specific,
      `${name} resolves its Feud handler before the generic category/global poison handler`);
  }
  const placed = villagers();
  assert(placed.length, 'the original placed Villagers are loaded');
  for (const npc of placed) {
    const initialTimer = types.NpcType.get(npc.baseType).timer;
    assert.equal(npc.timerInterval, initialTimer, 'an original placed Villager retains its unarmed config timer');
    assert.equal([...npc.queue.all()].length, 0, 'an original placed Villager starts without a timeout queue');
    execute('[proc,npc_poison_start]', p, [20], { target: npc });
    assert.equal(npc.getVar(poisonVar), 0, 'the native poison guard refuses a non-attackable Villager');
    assert.equal(npc.timerInterval, initialTimer, 'refused poison does not arm or change the global poison timer');
  }
});

test('the original distracted Villager turn returns at clock 109 with deadline 110', () => {
  const previousOwner = trialFixture();
  const p = trialFixture();
  for (const account of [previousOwner, p]) {
    const first = villagers().find(npc => availableIdle(npc) && operationStand(account, npc));
    assert(first, 'an original reachable Villager can earn the first theft');
    operate(account, first, 3);
    assert.equal(stage(account), 7);
  }
  // Test-only clock anchor. Two real account actions expose a stale queued timeout
  // without injecting requests: the old implementation kept the first owner's queue.
  World.currentTick = 99;
  const tracked = new Set();
  let target;
  countedWorldTick(tracked, () => {
    talk(previousOwner, 'feud_street_urchin');
    [target] = owned(previousOwner);
    assert(target);
    tracked.add(target);
  });
  assert.equal(World.currentTick, 100);
  nativeLogout(previousOwner, () => countedWorldTick(tracked));
  assert.equal(World.currentTick, 101);
  assert.equal(target.getVar(stateVar), 0, 'ordinary logout releases the first earned distraction');
  countedWorldTick(tracked, () => {
    talk(p, 'feud_street_urchin');
    assert.equal(owned(p)[0], target, 'the second real conversation selects the same original placement');
  });
  assert.equal(World.currentTick, 102);
  assert.equal(stage(p), 8);
  assert.equal(target.getVar(stateVar), 1);
  assert.equal(target.getVar(deadlineVar), 110);
  const expected = resultSnapshot(p);
  boundedTicksThrough(tracked, 108);
  assert.equal(countedWorldTick(tracked), 1, 'the original clock-109 native turn returns after one callback');
  assert.equal(World.currentTick, 109);
  assertStillOwned(p, target, 1, 110, expected);
  assert.equal(countedWorldTick(tracked), 1, 'the deadline turn executes one real cleanup callback');
  assert.equal(World.currentTick, 110);
  assertReleased(p, target, expected);
  assert.equal([...target.queue.all()].length, 0);
});

test('a native KO input at clock 102 returns at clock 109 with deadline 110 instead of spinning', () => {
  const p = repeatFixture();
  const target = attackableTarget(p, 'feud_arabian_guard2_multi', true);
  assert(target, 'an original unwitnessed Bandit41 placement is available');
  // Test-only clock anchor; the following Lure and real input create all NPC state.
  World.currentTick = 101;
  const tracked = new Set([target]);
  const initialTimer = target.timerInterval;
  attackableLure(p, target);
  assert.equal(World.currentTick, 101);

  let deadline;
  countedWorldTick(tracked, () => { deadline = dispatchSynchronousKnockOut(p, target); },
    ({ npc }) => assertAttackableQueueBound(npc));
  assert.equal(World.currentTick, 102, 'the real synchronous input runs before the native NPC phase at 102');
  assert.equal(deadline, 110, 'the compiled eight-tick KO timeout is anchored at 102');
  const expected = resultSnapshot(p);

  let callbacksAt109 = null;
  boundedTicksThrough(tracked, 109, (callbacks, tick) => {
    assertAttackableQueueBound(target);
    if (tick === 109) callbacksAt109 = callbacks;
  }, ({ npc }) => assertAttackableQueueBound(npc));
  assert.equal(callbacksAt109, 1, 'the remaining-one timeout callback returns once and safely rearms for delay 2');
  assert.equal(target.getVar(stateVar), 3, 'the KO remains active one tick before its exact deadline');
  assert.equal(target.getVar(ownerVar), p.uid);
  assert.equal(target.getVar(deadlineVar), 110);

  const callbacksAt110 = countedWorldTick(tracked, null, ({ npc }) => assertAttackableQueueBound(npc));
  assert.equal(World.currentTick, 110);
  assert(callbacksAt110 <= 1, 'the deadline frame cannot reenter the same callback');
  if (callbacksAt110 === 0) {
    assert.equal(target.getVar(stateVar), 3, 'a successor not visited on its append frame retains the KO at the deadline');
    assert.equal(target.getVar(ownerVar), p.uid);
    assert.equal(target.getVar(deadlineVar), 110);
    assert.equal(countedWorldTick(tracked, null, ({ npc }) => assertAttackableQueueBound(npc)), 1,
      'the safe delay expires no later than the approved one-tick-late edge');
    assert.equal(World.currentTick, 111);
  }
  assertReleased(p, target, expected);
  assert.equal(target.timerInterval, initialTimer, 'the Bandit timeout preserves its independent unarmed timer');
  drainTargetQueues(tracked);
});

test('a distracted Villager expires in one bounded native callback at its exact deadline', () => {
  const p = trialFixture();
  const target = reachDistraction(p);
  const deadline = target.getVar(deadlineVar);
  const expected = resultSnapshot(p);
  assert(deadline > World.currentTick);
  countedDeadlineTick(new Set([target]), deadline);
  assertReleased(p, target, expected);
  assert.equal([...target.queue.all()].length, 0);
});

test('a lured Villager expires in one bounded native callback at its exact deadline', () => {
  const p = trialFixture();
  const target = lure(p, (() => {
    const distracted = reachDistraction(p);
    operate(p, distracted, 3);
    assert.equal(stage(p), 9);
    return secludedTarget(p);
  })());
  const deadline = target.getVar(deadlineVar);
  const expected = resultSnapshot(p);
  countedDeadlineTick(new Set([target]), deadline);
  assertReleased(p, target, expected);
  assert.equal([...target.queue.all()].length, 0);
});

test('a real KO replaces the Villager timer deadline and clears its timer when waking', () => {
  const p = trialFixture();
  const distracted = reachDistraction(p);
  operate(p, distracted, 3);
  assert.equal(stage(p), 9);
  const target = lure(p);
  const lureDeadline = target.getVar(deadlineVar);
  const wakeDeadline = knockOutHere(p, target);
  assert.notEqual(wakeDeadline, lureDeadline, 'the real second action replaces the earlier Lure deadline');
  assert.equal(stage(p), 11);
  const expected = resultSnapshot(p);
  countedDeadlineTick(new Set([target]), wakeDeadline);
  assertReleased(p, target, expected);
  assert(wakeDeadline < lureDeadline);
  const staleCallbacks = boundedTicksThrough(new Set([target]), lureDeadline);
  assert.equal(staleCallbacks, 0, 'the cleared NPC timer has no stale Lure callback at its former deadline');
  assertReleased(p, target, expected);
  assert.equal([...target.queue.all()].length, 0);
});

test('a second native action updates the timer deadline before the earlier deadline', () => {
  const p = trialFixture();
  const distracted = reachDistraction(p);
  operate(p, distracted, 3);
  assert.equal(stage(p), 9);
  const target = lure(p);
  const oldDeadline = target.getVar(deadlineVar);
  boundedTicksThrough(new Set([target]), oldDeadline - 3);
  assert.equal(World.currentTick, oldDeadline - 3);
  assert(p.inOperableDistance(target), 'the lured Villager reaches the stationary owner through native following');
  assert(!hasWitness(p, target));
  const beforePosition = [p.level, p.x, p.z];
  const inputTickCallbacks = countedWorldTick(new Set([target]), () => dispatchSynchronousKnockOut(p, target));
  assert.equal(World.currentTick, oldDeadline - 2);
  assert(inputTickCallbacks <= MAX_NPC_CALLBACKS_PER_TICK);
  assert.deepEqual([p.level, p.x, p.z], beforePosition, 'the synchronous input does not relocate either actor');
  assert.equal(target.getVar(stateVar), 3);
  const newDeadline = target.getVar(deadlineVar);
  assert(newDeadline > oldDeadline, 'the real second action moves the timeout deadline later');
  assert.equal(target.timerInterval, 1);
  const expected = resultSnapshot(p);

  const oldCallbackCount = countedDeadlineTick(new Set([target]), oldDeadline);
  assert(oldCallbackCount > 0);
  assertStillOwned(p, target, 3, newDeadline, expected);
  assert.deepEqual([p.level, p.x, p.z], beforePosition);

  const beforeNewDeadlineCallbacks = boundedTicksThrough(new Set([target]), newDeadline - 1);
  assert(beforeNewDeadlineCallbacks <= (newDeadline - oldDeadline) * MAX_NPC_CALLBACKS_PER_TICK);
  assertStillOwned(p, target, 3, newDeadline, expected);
  const expiryCallbacks = countedWorldTick(new Set([target]));
  assert.equal(World.currentTick, newDeadline);
  assert(expiryCallbacks > 0, 'the real NPC timer reaches the changed deadline');
  assert(expiryCallbacks <= MAX_NPC_CALLBACKS_PER_TICK);
  assertReleased(p, target, expected);
});

test('ordinary native logout clears a Villager owner and its armed timer', () => {
  const p = trialFixture();
  const distracted = reachDistraction(p);
  operate(p, distracted, 3);
  assert.equal(stage(p), 9);
  const target = lure(p);
  const deadline = target.getVar(deadlineVar);
  const expected = resultSnapshot(p);
  let logoutCallbacks = 0;
  const receipt = nativeLogout(p, () => {
    logoutCallbacks += countedWorldTick(new Set([target]));
  });
  assert.equal(target.getVar(stateVar), 0);
  assert.equal(target.getVar(ownerVar), -1);
  assert.equal(target.getVar(deadlineVar), 0);
  assert.equal(target.timerInterval, 0);
  assert(logoutCallbacks > 0, 'the real timer callback runs during the ordinary logout frame');
  assert(deadline > World.currentTick);
  assert.deepEqual(resultSnapshot(p), expected);
  assert.equal([...target.queue.all()].length, 0);
  assert.equal(receipt.expected.stage, expected.stage);
});

test('clearing only the owner session reference does not change the native timeout result', () => {
  const p = trialFixture();
  const distracted = reachDistraction(p);
  operate(p, distracted, 3);
  assert.equal(stage(p), 9);
  const target = lure(p);
  const deadline = target.getVar(deadlineVar);
  // The compiled Lure has already written its genuine NPC UID; this only perturbs the owner's session reference.
  p.setVar(slotVar, -1);
  assert.equal(target.getVar(stateVar), 2);
  assert.equal(target.getVar(ownerVar), p.uid);
  assert.equal(target.getVar(deadlineVar), deadline);
  const expected = resultSnapshot(p);
  countedDeadlineTick(new Set([target]), deadline);
  assertReleased(p, target, expected);
  assert.equal([...target.queue.all()].length, 0);
});

test('an earned Villager form change preserves the new timer through the old distraction deadline', () => {
  const p = trialFixture();
  const target = reachDistraction(p);
  const formBefore = displayNpcType(p, target).id;
  const oldDeadline = target.getVar(deadlineVar);
  operate(p, target, 3);
  assert.equal(stage(p), 9);
  assert.equal(read(p, 'feud_npc_multi'), 2);
  assert.notEqual(displayNpcType(p, target).id, formBefore, 'the real theft changes the original target display form');
  assert.equal(target.getVar(stateVar), 0);
  assert.equal(target.timerInterval, 0, 'the real theft clears the completed distraction timer');
  // Re-lure the same original NPC in its newly earned form; no second active target is fabricated.
  lure(p, target);
  const newDeadline = target.getVar(deadlineVar);
  assert(newDeadline > oldDeadline);
  const expected = resultSnapshot(p);
  const tracked = new Set([target]);
  boundedTicksThrough(tracked, oldDeadline);
  assertStillOwned(p, target, 2, newDeadline, expected);
  assert.equal(target.timerInterval, 1);
  assert.equal([...target.queue.all()].length, 0, 'no obsolete queued distraction callback can reset the new condition');
  countedDeadlineTick(tracked, newDeadline);
  assertReleased(p, target, expected);
});

test('native poison keeps its 30-tick cadence while both attackable Feud states are active', {
  skip: 'ENGINE LIMIT: NPC_HASOP reads the base multi type, so native poison start refuses original Bandit/Thug placements; this is not a Feud quest step.'
}, () => {
  for (const name of ['feud_arabian_guard2_multi', 'feud_egyptian_doorman_multi']) {
    const p = repeatFixture();
    const target = attackableTarget(p, name);
    assert(target, `an original ${name} placement is available`);
    const poisonTimer = ScriptProvider.getByTrigger(ServerTriggerType.AI_TIMER, target.type,
      types.NpcType.get(target.type).category);
    assert.equal(poisonTimer?.name, '[ai_timer,_]', `${name} keeps the generic native poison timer`);
    const initialTimer = target.timerInterval;
    attackableLure(p, target);
    assert.equal(target.timerInterval, initialTimer, 'the repeat timeout does not replace an unrelated timer');
    execute('[proc,npc_poison_start]', p, [20], { target });
    assert.equal(target.getVar(poisonVar), 20);
    assert.equal(target.timerInterval, 30, 'the real poison start arms its published timer interval');

    const tracked = new Set([target]);
    const events = [];
    if (hasWitness(p, target)) {
      const startTick = World.currentTick;
      const route = observeNativeCallbacks(tracked, () => followToSeclusion(p, target),
        event => events.push(event));
      assert(route.maxCallbacksInOneTick <= MAX_NPC_CALLBACKS_PER_TICK);
      assert(World.currentTick > startTick, 'following uses native ticks while the NPC is poisoned');
    }
    assert.equal(target.getVar(stateVar), 2, 'the original compiled Lure remains active while following');
    assert.equal(target.getVar(poisonVar) > 0, true);
    const firstPoisonTick = nextNpcTimerTick(target);
    boundedTicksThrough(tracked, firstPoisonTick, null, event => events.push(event));
    const firstHit = events.find(event => event.tick === firstPoisonTick &&
      event.before.poison > event.after.poison && event.before.state === 2 && event.after.state === 2);
    assert(firstHit, 'the first due poison timer executes while following');
    assert.equal(firstHit.before.poison - firstHit.after.poison, 1);
    assert.equal(firstHit.before.hp - firstHit.after.hp, 4);

    if (hasWitness(p, target)) {
      const startTick = World.currentTick;
      const route = observeNativeCallbacks(tracked, () => followToSeclusion(p, target),
        event => events.push(event));
      assert(route.maxCallbacksInOneTick <= MAX_NPC_CALLBACKS_PER_TICK);
      assert(World.currentTick > startTick, 'following reaches seclusion using native ticks while poisoned');
    }
    const followingHits = events.filter(event => event.before.poison > event.after.poison &&
      event.before.state === 2 && event.after.state === 2);
    const followingHit = followingHits.at(-1);
    const nextPoisonTick = nextNpcTimerTick(target);
    assert.equal(nextPoisonTick - followingHit.tick, 30, 'the next native poison callback remains exactly 30 ticks later');
    const koInputTick = nextPoisonTick - 8;
    boundedTicksThrough(tracked, koInputTick - 1, null, event => events.push(event));
    assert.equal(target.getVar(stateVar), 2);
    assert.equal(target.timerClock, 21, 'the KO input is placed eight native ticks before the next poison event');

    let koDeadline;
    countedWorldTick(tracked, () => { koDeadline = attackableKnockOut(p, target); },
      ({ npc }) => assertAttackableQueueBound(npc));
    assert.equal(World.currentTick, koInputTick);
    assert.equal(koDeadline, nextPoisonTick, 'the real KO deadline aligns to the next poison tick');
    assert.equal(target.timerClock, 22);
    assert.equal(target.getVar(stateVar), 3);
    assert.equal(target.getVar(poisonVar), followingHit.after.poison);

    boundedTicksThrough(tracked, koDeadline, null, event => events.push(event));
    const koPoisonHit = events.find(event => event.tick === koDeadline &&
      event.before.poison > event.after.poison);
    assert(koPoisonHit, 'the published poison callback still runs on the KO deadline');
    assert.equal(koPoisonHit.before.state, 3, 'poison damage executes while the NPC is unconscious');
    assert.equal(koPoisonHit.after.state, 3, 'poison does not replace the KO timeout state');
    assert.equal(koPoisonHit.before.poison - koPoisonHit.after.poison, 1);
    assert.equal(koPoisonHit.before.hp - koPoisonHit.after.hp, 4);
    assert.equal(koPoisonHit.tick - followingHit.tick, 30, 'poison cadence is unchanged across both Feud states');
    assert.equal(target.getVar(stateVar), 0, 'the real KO timeout still cleans up on its deadline');
    assert.equal(target.getVar(ownerVar), -1);
    assert.equal(target.getVar(deadlineVar), 0);
    assert.equal(target.timerInterval, 30, 'Feud reset preserves the independent poison timer');

    execute('[proc,npc_poison_clear]', p, [], { target });
    assert.equal(target.getVar(poisonVar), 0);
    assert.equal(target.timerInterval, 0, 'the compiled poison cleanup clears its timer');
    drainTargetQueues(tracked);
    assertAttackableQueueBound(target);
  }
});

test('four real attackable Lure/KO cycles survive ordinary logout with bounded queues over 1,200 ticks', () => {
  let p = repeatFixture();
  const target = attackableTarget(p, 'feud_arabian_guard2_multi', true);
  assert(target, 'an original unwitnessed Bandit41 placement is available for the repeated native case');
  const tracked = new Set([target]);
  const startTick = World.currentTick;
  let totalCallbacks = 0;
  let maxCallbacksInOneTick = 0;
  let maxQueueDepth = 0;
  const observeCallback = ({ npc }) => {
    maxQueueDepth = Math.max(maxQueueDepth, assertAttackableQueueBound(npc));
  };
  const accountTick = callbacks => {
    totalCallbacks += callbacks;
    maxCallbacksInOneTick = Math.max(maxCallbacksInOneTick, callbacks);
    maxQueueDepth = Math.max(maxQueueDepth, assertAttackableQueueBound(target));
  };
  const tick = () => {
    const callbacks = countedWorldTick(tracked, null, observeCallback);
    accountTick(callbacks);
  };

  for (let cycle = 0; cycle < 4; cycle++) {
    assert.equal(target.getVar(stateVar), 0, 'each cycle begins after the prior real KO timeout');
    const cycleStart = World.currentTick;
    attackableLure(p, target);
    if (hasWitness(p, target)) {
      const follow = observeNativeCallbacks(tracked, () => followToSeclusion(p, target), observeCallback);
      totalCallbacks += follow.callbacks;
      maxCallbacksInOneTick = Math.max(maxCallbacksInOneTick, follow.maxCallbacksInOneTick);
      maxQueueDepth = Math.max(maxQueueDepth, assertAttackableQueueBound(target));
    }
    const wakeDeadline = attackableKnockOut(p, target);
    const ownerUid = p.uid;
    const receipt = nativeLogout(p, tick);
    assert.equal(target.getVar(stateVar), 3, 'ordinary logout leaves the attackable KO to its real NPC timeout');
    assert.equal(target.getVar(ownerVar), ownerUid);
    if (World.currentTick < wakeDeadline) {
      boundedTicksThrough(tracked, wakeDeadline, callbacks => accountTick(callbacks), observeCallback);
    }
    assert.equal(target.getVar(stateVar), 0, 'the native timeout releases the logged-out owner');
    assert.equal(target.getVar(ownerVar), -1);
    assert.equal(target.getVar(deadlineVar), 0);

    const soakDeadline = cycleStart + 300;
    if (World.currentTick < soakDeadline) {
      boundedTicksThrough(tracked, soakDeadline, callbacks => accountTick(callbacks), observeCallback);
    }
    assertAttackableQueueBound(target);
    if (cycle < 3) p = reloadAccount(receipt);
  }

  assert(World.currentTick - startTick >= 1200, 'the native attackable soak spans at least 1,200 ticks');
  assert(maxCallbacksInOneTick <= MAX_NPC_CALLBACKS_PER_TICK);
  assert(maxQueueDepth <= 2);
  assert(totalCallbacks > 0, 'the soak observed real native timeout callbacks');
  const queued = [...target.queue.all()].map(request => request.delay);
  if (queued.length) {
    const end = World.currentTick + Math.max(1, ...queued);
    boundedTicksThrough(tracked, end, callbacks => accountTick(callbacks), observeCallback);
  }
  assert.equal([...target.queue.all()].length, 0, 'the final stale follow callback drains without rearming');
  assert(maxCallbacksInOneTick <= MAX_NPC_CALLBACKS_PER_TICK);
  assert(maxQueueDepth <= 2);
});
