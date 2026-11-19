import assert from 'node:assert/strict';
import test from 'node:test';
import './timeout-safety.mjs';
import {
  Packet, PlayerLoading, PlayerStat, World, count, engineModule, id, inv, inventory, obj, seed
} from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';
import {
  bit, displayNpcType, hasWitness, operate, operationStand, read, stage, talk, tickThrough, wield, worldTick
} from './fixture.mjs';

const rsbuf = await engineModule('network/rsbuf/index.ts');
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const slotVar = id('VarPlayerType', 'feud_trial_villager');
const stateVar = id('VarNpcType', 'feud_villager_state');
const ownerVar = id('VarNpcType', 'feud_villager_owner');
const deadlineVar = id('VarNpcType', 'feud_villager_deadline');
const villagerTypes = new Set([1, 2, 3].map(number => id('NpcType', `feud_villager_multi_${number}`)));
const villagers = () => [...World.npcs].filter(npc => npc.isActive && villagerTypes.has(npc.baseType));
const owned = p => villagers().filter(npc => npc.getVar(stateVar) !== 0 && (npc.getVar(ownerVar) >>> 0) === p.uid);
const xp = p => p.stats[PlayerStat.THIEVING];
const nativeSetupWaitTicks = 512; // Existing native-geometry bound from follow.mjs, not a gameplay timeout.

function nativeLogoutAndReload(p) {
  const oldPid = p.pid, oldSlot = p.slot, username = p.username;
  p.clearInteraction();
  for (let tick = 0; tick < 128 && World.currentTick < p.preventLogoutUntil; tick++) worldTick();
  assert(World.currentTick >= p.preventLogoutUntil, 'ordinary logout cooldown expires without bypass');
  const before = { stage: stage(p), coins: count(p, 'coins'), xp: xp(p), inventory: inventory(p) };
  p.requestLogout = true;
  p.lastResponse = World.currentTick;
  worldTick();
  assert(![...World.playerLoop.all()].includes(p), 'production logout removes the old session');
  const request = World.logoutRequests.get(username);
  assert(request?.save, 'production logout supplies its genuine saved player bytes');
  World.logoutRequests.delete(username); // Model the successful login-server save acknowledgement.
  const loaded = PlayerLoading.load(username, new Packet(request.save), null);
  loaded.pid = oldPid; loaded.slot = oldSlot;
  loaded.uid = ((Number(loaded.username37 & 0x1fffffn) << 11) | oldSlot) >>> 0;
  loaded.isActive = true;
  loaded.packets = []; loaded.messages = [];
  loaded.write = packet => loaded.packets.push(packet);
  loaded.messageGame = text => loaded.messages.push(String(text));
  loaded.wrappedMessageGame = loaded.messageGame;
  loaded.lastResponse = loaded.lastConnected = World.currentTick;
  World.players[oldPid] = loaded;
  World.playerLoop.add(loaded.hash64, loaded);
  rsbuf.addPlayer(oldSlot);
  World.gameMap.getZone(loaded.x, loaded.z, loaded.level).enter(loaded);
  World.instances.playerEntered({ level: loaded.level, x: loaded.x, z: loaded.z });
  loaded.onLogin();
  loaded.processEngineQueue();
  assert.equal(stage(loaded), before.stage, 'logout does not change the earned trial checkpoint');
  assert.equal(count(loaded, 'coins'), before.coins, 'logout does not add or remove coins');
  assert.equal(xp(loaded), before.xp, 'logout does not award trial XP');
  assert.deepEqual(inventory(loaded), before.inventory, 'logout preserves ordinary carried items');
  assert.equal(loaded.getVar(slotVar), -1, 'the NPC UID is session state, not saved state');
  return loaded;
}

function trialFixture() {
  const p = seed(player(), ['blackjack_oak']);
  // Disclosed isolated pre-trial fixture. Every tested checkpoint after six is earned by its real action.
  p.setVarBit(bit('feud_var'), 6);
  p.setVar(slotVar, -1); // Undo the generic runtime fixture's vars.fill(0), not production initialization.
  p.invAdd(inv, obj('coins'), 100);
  wield(p, 'blackjack_oak');
  rsbuf.addPlayer(p.slot);
  return p;
}

function reachDistraction(p) {
  const target = villagers().find(npc => npc.getVar(stateVar) === 0 && operationStand(p, npc));
  assert(target, 'an original placed villager is idle');
  operate(p, target, 3);
  assert.equal(stage(p), 7);
  assert.equal(read(p, 'feud_npc_multi'), 1, 'the first theft exposes the original second client form');
  talk(p, 'feud_street_urchin');
  assert.equal(stage(p), 8);
  assert.equal(owned(p).length, 1);
  assert.equal(p.getVar(slotVar), owned(p)[0].uid);
  return owned(p)[0];
}

function secludedTarget(p) {
  const target = villagers().find(npc => npc.getVar(stateVar) === 0 && !hasWitness(p, npc) && operationStand(p, npc));
  assert(target, 'a real packed villager has no candidate under the native witness predicate');
  return target;
}

function lure(p, target = secludedTarget(p)) {
  const before = { stage: stage(p), xp: xp(p), coins: count(p, 'coins') };
  operate(p, target, 4);
  assert.equal(stage(p), before.stage === 9 ? 10 : before.stage);
  assert.equal(xp(p), before.xp, 'luring or replaying the lure awards no XP');
  assert.equal(count(p, 'coins'), before.coins, 'luring or replaying the lure awards no coins');
  assert.equal(p.getVar(slotVar), target.uid);
  assert.equal(owned(p).length, 1);
  assert.equal(target.getVar(stateVar), 2);
  return target;
}

function knockOut(p, target) {
  const before = { stage: stage(p), xp: xp(p), coins: count(p, 'coins') };
  const previous = JavaRandom.nextDouble;
  JavaRandom.nextDouble = () => 0;
  try { operate(p, target, 5); } finally { JavaRandom.nextDouble = previous; }
  assert.equal(stage(p), 11);
  assert.equal(target.getVar(stateVar), 3);
  assert.equal(owned(p).length, 1);
  assert.equal(count(p, 'coins'), before.coins);
  assert.equal(xp(p) - before.xp, before.stage === 10 ? 80 : 0, 'only the first earned knock-out awards its eight XP');
}

function reachLure(p) {
  const admissionDeadline = World.currentTick + nativeSetupWaitTicks;
  let distracted = reachDistraction(p);
  while (distracted.getVar(stateVar) !== 1 || !operationStand(p, distracted)) {
    assert(World.currentTick < admissionDeadline,
      'a genuinely distracted original Villager becomes reachable within the existing native-geometry setup bound');
    if (distracted.getVar(stateVar) === 1) {
      worldTick();
    } else {
      // Native wandering may leave the selected target without a reachable operation stand.
      // Let the earned distraction expire, then use the actual offered repeat conversation.
      const before = { stage: stage(p), xp: xp(p), coins: count(p, 'coins') };
      talk(p, 'feud_street_urchin');
      assert.deepEqual({ stage: stage(p), xp: xp(p), coins: count(p, 'coins') }, before,
        'repeating an expired distraction does not manufacture progress or rewards');
      [distracted] = owned(p);
      assert(distracted, 'the repeated compiled urchin action earns another original target');
    }
  }
  operate(p, distracted, 3);
  assert.equal(stage(p), 9);
  assert.equal(read(p, 'feud_npc_multi'), 2, 'the second theft exposes the original third client form');
  assert.equal(owned(p).length, 0);
  return lure(p);
}

function completeThirdTheft(p, target) {
  const before = { xp: xp(p), coins: count(p, 'coins') };
  operate(p, target, 3);
  assert.equal(stage(p), 12);
  assert.equal(read(p, 'feud_npc_multi'), 2, 'the third theft does not hide all original villager forms');
  assert.equal(xp(p), before.xp, 'the third theft does not repeat knock-out XP');
  assert.equal(count(p, 'coins') - before.coins, 3);
}

for (const number of [1, 2, 3]) for (const checkpoint of [7, 8]) {
  test(`original villager ${number} early Lure at earned stage ${checkpoint} preserves trials and recovers through real logout`, () => {
    let p = trialFixture();
    if (checkpoint === 8) {
      const distracted = reachDistraction(p);
      // Let the real NPC queue expire this earned distraction, without rewriting its checkpoint.
      tickThrough(distracted.getVar(deadlineVar));
      assert.equal(distracted.getVar(stateVar), 0);
      assert.equal(p.getVar(slotVar), -1);
    } else {
      const first = villagers().find(npc => npc.getVar(stateVar) === 0 && operationStand(p, npc));
      assert(first, 'an original placed villager can earn the first theft');
      operate(p, first, 3);
    }
    assert.equal(stage(p), checkpoint);
    assert.equal(read(p, 'feud_npc_multi'), 1);
    const baseType = id('NpcType', `feud_villager_multi_${number}`);
    const target = villagers().find(npc => npc.baseType === baseType && npc.getVar(stateVar) === 0 &&
      operationStand(p, npc));
    assert(target, `an original idle villager ${number} exposes its middle form`);
    const before = { coins: count(p, 'coins'), xp: xp(p) };
    lure(p, target);
    assert.equal(displayNpcType(p, target).id, id('NpcType', `feud_villager_${number}_2`),
      'native dispatch uses the original middle form, not the later blackjack form');
    const second = villagers().find(npc => npc !== target && npc.getVar(stateVar) === 0 && operationStand(p, npc));
    assert(second, 'a second real target is available to prove the reservation rejection');
    operate(p, second, 4);
    assert.equal(owned(p).length, 1);
    assert.equal(p.getVar(slotVar), target.uid, 'an early lure cannot stack another target');
    talk(p, 'feud_street_urchin');
    assert.equal(stage(p), checkpoint, 'the active early lure cannot become an urchin distraction');
    operate(p, target, 3);
    assert.equal(stage(p), checkpoint, 'following cannot substitute for the required distracted theft');
    assert.equal(count(p, 'coins'), before.coins);
    assert.equal(xp(p), before.xp);
    assert(World.currentTick + 1 < target.getVar(deadlineVar),
      'production logout, not expiry, must release this early lure');
    p = nativeLogoutAndReload(p);
    assert.equal(target.getVar(stateVar), 0);
    assert.equal(target.getVar(ownerVar), -1);
    assert.equal(target.getVar(deadlineVar), 0);
    assert.equal(owned(p).length, 0);
    talk(p, 'feud_street_urchin');
    assert.equal(stage(p), 8, 'the player must still obtain the actual distraction');
    const distracted = owned(p)[0];
    assert(distracted);
    assert.equal(distracted.getVar(stateVar), 1);
    operate(p, distracted, 3);
    assert.equal(stage(p), 9);
    assert.equal(owned(p).length, 0, 'the real second theft releases its distraction');
    assert.equal(p.getVar(slotVar), -1);
    const later = secludedTarget(p), beforeKoXp = xp(p);
    operate(p, later, 5);
    assert.equal(stage(p), 9, 'an earlier lure does not credit the later lure checkpoint');
    assert.equal(xp(p), beforeKoXp);
    lure(p, later);
    assert.equal(stage(p), 10, 'a fresh stage-nine Lure is still required');
    knockOut(p, later);
    completeThirdTheft(p, later);
    p = nativeLogoutAndReload(p);
    assert.equal(stage(p), 12);
    assert.equal(owned(p).length, 0);
  });
}

for (const checkpoint of [8, 10, 11]) {
  test(`native logout at earned trial stage ${checkpoint} releases its villager and the player can finish stage 12`, () => {
    let p = trialFixture();
    let target = checkpoint === 8 ? reachDistraction(p) : reachLure(p);
    if (checkpoint === 11) knockOut(p, target);
    assert(World.currentTick + 1 < target.getVar(deadlineVar), 'logout occurs before the NPC-side expiry can release this held condition');
    assert.equal(stage(p), checkpoint);
    const oldUid = p.uid;
    p = nativeLogoutAndReload(p);
    assert.equal(target.getVar(stateVar), 0, 'the shared logout hook releases the condition immediately');
    assert.equal(target.getVar(ownerVar), -1);
    assert.equal(target.getVar(deadlineVar), 0);
    assert(!villagers().some(npc => npc.getVar(stateVar) !== 0 && (npc.getVar(ownerVar) >>> 0) === oldUid));

    if (checkpoint === 8) {
      const before = { xp: xp(p), coins: count(p, 'coins') };
      talk(p, 'feud_street_urchin');
      assert.equal(stage(p), 8, 'replay preserves the earned waiting checkpoint');
      assert.equal(xp(p), before.xp);
      assert.equal(count(p, 'coins'), before.coins);
      target = owned(p)[0];
      assert(target);
      talk(p, 'feud_street_urchin');
      assert.equal(owned(p).length, 1, 'repeating distraction cannot stack active targets');
      assert.equal(p.getVar(slotVar), target.uid);
      assert.equal(xp(p), before.xp);
      assert.equal(count(p, 'coins'), before.coins);
      operate(p, target, 3);
      assert.equal(stage(p), 9);
      target = lure(p);
    } else {
      target = lure(p);
    }
    const heldTarget = target.uid, heldXp = xp(p), heldCoins = count(p, 'coins');
    const secondTarget = villagers().find(npc => npc !== target && npc.getVar(stateVar) === 0 && operationStand(p, npc));
    assert(secondTarget, 'a different idle placed villager is available for the stacking rejection');
    operate(p, secondTarget, 4);
    assert.equal(owned(p).length, 1, 'a second lure cannot stack active target conditions');
    assert.equal(p.getVar(slotVar), heldTarget);
    assert.equal(xp(p), heldXp);
    assert.equal(count(p, 'coins'), heldCoins);
    knockOut(p, target);
    completeThirdTheft(p, target);
    // Release the final short-lived condition through the real hook too, before the next case.
    p = nativeLogoutAndReload(p);
    assert.equal(stage(p), 12);
    assert.equal(owned(p).length, 0);
  });
}

test('native logout without a trial villager is a no-op for saved quest, items, coins and XP', () => {
  let p = trialFixture();
  assert.equal(owned(p).length, 0);
  p = nativeLogoutAndReload(p);
  assert.equal(stage(p), 6);
  assert.equal(owned(p).length, 0);
});

test('the NPC queue independently expires a held lure and permits a non-rewarding replay', () => {
  const p = trialFixture();
  const target = reachLure(p);
  const deadline = target.getVar(deadlineVar), beforeXp = xp(p), beforeCoins = count(p, 'coins');
  assert(deadline > World.currentTick);
  // Run every native world phase through the scheduled deadline; the queue counts processed ticks.
  tickThrough(deadline);
  assert.equal(target.getVar(stateVar), 0);
  assert.equal(target.getVar(ownerVar), -1);
  assert.equal(p.getVar(slotVar), -1);
  assert.equal(stage(p), 10);
  assert.equal(xp(p), beforeXp);
  assert.equal(count(p, 'coins'), beforeCoins);
  const replayed = lure(p);
  knockOut(p, replayed);
  completeThirdTheft(p, replayed);
});

test('an orphaned villager cleans up on its own queued deadline without running the player logout hook', () => {
  const p = trialFixture(), target = reachLure(p);
  const deadline = target.getVar(deadlineVar);
  // Deliberately model loss of an in-memory session without invoking [logout,_].
  p.clearInteraction(); p.unlink(); p.isActive = false;
  World.players[p.pid] = null;
  tickThrough(deadline);
  assert.equal(target.getVar(stateVar), 0, 'the NPC-side queue is an independent cleanup path');
  assert.equal(target.getVar(ownerVar), -1);
  assert.equal(target.getVar(deadlineVar), 0);
});
