import './deterministic-wander.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayerStat, World, count, engineModule, execute, id, seed, types } from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';
import {
  actors, bit, hasWitness, openOriginalVillagerCurtain, operate, operationStand, stage, talk, wield, worldTick
} from './fixture.mjs';

const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { NpcMode } = await engineModule('engine/entity/NpcMode.ts');
const { NpcStat } = await engineModule('engine/entity/NpcStat.ts');
const HintArrow = (await engineModule('network/game/server/model/HintArrow.ts')).default;
const stateVar = id('VarNpcType', 'feud_villager_state');
const ownerVar = id('VarNpcType', 'feud_villager_owner');
const deadlineVar = id('VarNpcType', 'feud_villager_deadline');
const slotVar = id('VarPlayerType', 'feud_trial_villager');
const attackVar = id('VarNpcType', 'npc_attacking_uid');
const hints = p => p.packets.filter(packet => packet instanceof HintArrow);
const snapshot = p => [stage(p), count(p, 'coins'), p.stats[PlayerStat.THIEVING]];

function account(checkpoint = 9) {
  const p = seed(player(), ['blackjack_oak']);
  // Disclosed own-player checkpoint fixture; real compiled actions create every NPC state.
  p.setVarBit(bit('feud_var'), checkpoint);
  p.setVarBit(bit('feud_npc_multi'), checkpoint === 7 ? 1 : 2);
  p.setVar(slotVar, -1);
  wield(p, 'blackjack_oak');
  return p;
}

function targetFor(p, bandit = false) {
  const candidates = bandit ? actors('feud_arabian_guard2_multi')
    : [1, 2, 3].flatMap(n => actors(`feud_villager_multi_${n}`));
  const target = candidates.find(npc => npc.getVar(stateVar) === 0 &&
    !hasWitness(p, npc) && operationStand(p, npc));
  assert(target, 'an original idle, reachable, unwitnessed placement is available');
  return target;
}

function arm(p, condition, bandit = false) {
  if (condition === 'distracted') {
    openOriginalVillagerCurtain(p);
    talk(p, 'feud_street_urchin');
    const target = [...World.npcs].find(npc => npc.isActive && npc.getVar(stateVar) === 1 &&
      (npc.getVar(ownerVar) >>> 0) === p.uid);
    assert(target, 'the real urchin conversation creates the hold');
    assert.equal(hints(p).at(-1)?.type, 1);
    return target;
  }
  const target = targetFor(p, bandit);
  operate(p, target, 4);
  assert.equal(target.getVar(stateVar), 2);
  assert.equal(target.target, p);
  if (condition === 'unconscious') {
    const random = JavaRandom.nextDouble;
    try { JavaRandom.nextDouble = () => 0; operate(p, target, 5); }
    finally { JavaRandom.nextDouble = random; }
    assert.equal(target.getVar(stateVar), 3);
  }
  return target;
}

function released(p, target, condition) {
  assert.equal(target.getVar(stateVar), 0, 'the stale condition is released');
  assert.equal(target.getVar(ownerVar), -1);
  assert.equal(target.getVar(deadlineVar), 0);
  assert.equal(target.targetOp, NpcMode.WANDER);
  assert.equal(p.getVar(slotVar), -1, 'the present owner loses only this session reservation');
  if (condition === 'distracted') assert.equal(hints(p).at(-1)?.type, -1, 'release clears the old owner hint');
}

export function reconciliationTests() {
for (const removed of [false, true]) for (const sameOwner of removed ? [false] : [false, true]) {
  test(`floor-change follow with a cleared timer is reclaimed by ${sameOwner ? 'the same' : 'a second'} player, owner removed=${removed}`, () => {
    const owner = account();
    const target = arm(owner, 'following');
    const deadline = target.getVar(deadlineVar);
    owner.level = (target.level + 1) % 4; // The predicate a floor-changing teleport changes.
    worldTick(); worldTick();
    assert.equal(target.targetOp, NpcMode.WANDER);
    assert.equal(target.timerInterval, -1, 'validateTarget/resetDefaults discarded the native timer');
    assert.equal(target.getVar(stateVar), 2, 'the reader, not a surviving callback, must recover this state');
    assert(World.currentTick < deadline);
    if (removed) World.removePlayer(owner); // Deliberately no LOGOUT trigger.
    const next = sameOwner ? owner : account();
    operate(next, target, 4);
    assert.equal(target.getVar(stateVar), 2);
    assert.equal(target.getVar(ownerVar) >>> 0, next.uid, 'reconciliation preserves the acting player pointer');
    assert.equal(target.target, next);
    assert.equal(target.timerInterval, 1);
    assert.equal(next.getVar(slotVar), target.uid);
    if (!sameOwner && !removed) assert.equal(owner.getVar(slotVar), -1);
  });
}

for (const condition of ['distracted', 'following', 'unconscious']) {
  for (const loss of ['defaults', 'owner-removed', 'expired']) {
    test(`${condition} reconciles ${loss} before another player's native Pickpocket`, () => {
      const owner = account(condition === 'distracted' ? 7 : 9);
      const target = arm(owner, condition);
      const earned = snapshot(owner);
      if (loss === 'defaults') {
        target.resetDefaults(); // Explicit engine-reset fixture: also loses the NPC timer.
        assert.equal(target.timerInterval, -1);
      } else {
        target.setTimer(0); // Isolate presence/deadline recovery from the normal timer path.
      }
      if (loss === 'owner-removed') World.removePlayer(owner);
      if (loss === 'expired') World.currentTick = target.getVar(deadlineVar);
      const next = account(6);
      operate(next, target, 3);
      assert.equal(stage(next), 7, 'the free villager permits the first trial theft');
      assert.equal(target.getVar(stateVar), 0);
      assert.equal(target.getVar(ownerVar), -1);
      assert.equal(target.getVar(deadlineVar), 0);
      assert.deepEqual(snapshot(owner), earned, 'reconciliation never changes saved progress or rewards');
      if (loss !== 'owner-removed') released(owner, target, condition);
    });
  }
}

for (const condition of ['following', 'unconscious']) {
  test(`attackable ${condition} reconciles defaults before a second player's Lure`, () => {
    const owner = account(28), target = arm(owner, condition, true);
    target.resetDefaults();
    const next = account(28);
    const before = snapshot(next);
    operate(next, target, 4);
    assert.equal(target.getVar(stateVar), 2);
    assert.equal(target.getVar(ownerVar) >>> 0, next.uid);
    assert.equal(target.target, next);
    assert.deepEqual(snapshot(next), before);
    assert([...target.queue.all()].length <= 2, 'existing kind callbacks remain singly owned');
  });
}

test('a follow whose owner marker no longer matches is reconciled before native Knock-Out', () => {
  const owner = account(), target = arm(owner, 'following'), other = account();
  target.setVar(attackVar, other.uid); // Explicit corrupted-follow engine-state fixture.
  const before = snapshot(owner);
  operate(owner, target, 5);
  released(owner, target, 'following');
  assert.deepEqual(snapshot(owner), before);
});

for (const condition of ['distracted', 'following', 'unconscious']) {
  test(`ordinary ${condition} survives other readers and a modal owner before its deadline`, () => {
    const owner = account(condition === 'distracted' ? 7 : 9), target = arm(owner, condition);
    const before = [target.getVar(stateVar), target.getVar(ownerVar), target.getVar(deadlineVar)];
    const next = account();
    owner.delayedUntil = World.currentTick + 20; // Present but not protectable is not absent.
    operate(next, target, 4);
    assert.deepEqual([target.getVar(stateVar), target.getVar(ownerVar), target.getVar(deadlineVar)], before);
    worldTick();
    assert.deepEqual([target.getVar(stateVar), target.getVar(ownerVar), target.getVar(deadlineVar)], before);
    owner.delayedUntil = 0;
  });
}

test('death and native respawn reuse the index without allowing an old trial UID to release the new owner', () => {
  const owner = account(), target = arm(owner, 'following');
  const oldUid = target.uid, oldIndex = target.nid;
  // Test-only lethal hit, through the ordinary compiled damage/death mechanism.
  execute('[proc,npc_default_damage]', owner, [target.levels[NpcStat.HITPOINTS]], { target });
  for (let i = 0; i < 16 && target.isActive; i++) worldTick();
  assert.equal(target.isActive, false, 'the native death queue removes the old life');
  const respawnBound = types.NpcType.get(target.baseType).respawnrate + 16;
  for (let i = 0; i < respawnBound && !target.isActive; i++) worldTick();
  assert(target.isActive, 'the original placed NPC respawns on its own native lifecycle');
  assert.equal(target.nid, oldIndex);
  assert.equal(target.uid, oldUid, 'the engine UID contains type and index, not a life generation');
  assert.equal(target.getVar(stateVar), 0);
  assert.equal(target.getVar(ownerVar), -1);
  const next = account();
  operate(next, target, 4);
  assert.equal(target.getVar(ownerVar) >>> 0, next.uid);
  execute('[proc,feud_trial_release]', owner, [], { target });
  assert.equal(owner.getVar(slotVar), -1, 'the stale reservation is dropped');
  assert.equal(target.getVar(ownerVar) >>> 0, next.uid, 'UID reuse alone never authorizes release');
  assert.equal(target.getVar(stateVar), 2);
  assert.equal(next.getVar(slotVar), target.uid);
});
}
