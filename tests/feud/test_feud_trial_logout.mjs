import { seededWander } from './deterministic-wander.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import './timeout-safety.mjs';
import {
  Packet, PlayerLoading, PlayerStat, ScriptState, ServerTriggerType, World, button, count,
  dialoguePage, engineModule, id, inv, inventory, map, obj, resumeDialogue, seed, types
} from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';
import {
  actors, bit, distractionTicks, displayNpcType, hasWitness, knockoutTicks, openOriginalVillagerCurtain,
  operate, operationStand, read, stage, stand, talk, tickThrough, wield, worldTick
} from './fixture.mjs';

const rsbuf = await engineModule('network/rsbuf/index.ts');
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const moveClickHandler = new (await engineModule('network/game/client/handler/MoveClickHandler.ts')).default();
const HintArrow = (await engineModule('network/game/server/model/HintArrow.ts')).default;
const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const { NpcMode } = await engineModule('engine/entity/NpcMode.ts');
const hints = p => p.packets.filter(packet => packet instanceof HintArrow);
const assertHint = (p, target) => {
  assert.equal(hints(p).at(-1)?.type, 1, 'the acting player receives the native NPC hint arrow');
  assert.equal(hints(p).at(-1)?.nid, target.nid, 'the hint marks the selected original villager');
};
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const slotVar = id('VarPlayerType', 'feud_trial_villager');
const stateVar = id('VarNpcType', 'feud_villager_state');
const ownerVar = id('VarNpcType', 'feud_villager_owner');
const deadlineVar = id('VarNpcType', 'feud_villager_deadline');
const villagerTypes = new Set([1, 2, 3].map(number => id('NpcType', `feud_villager_multi_${number}`)));
const villagers = () => [...World.npcs].filter(npc => npc.isActive && villagerTypes.has(npc.baseType));
const owned = p => villagers().filter(npc => npc.getVar(stateVar) !== 0 && (npc.getVar(ownerVar) >>> 0) === p.uid);
const xp = p => p.stats[PlayerStat.THIEVING];
const nativeSetupWaitTicks = 512; // Existing native-geometry bound from follow.mjs, not a gameplay timeout.
const trialResult = p => ({ stage: stage(p), coins: count(p, 'coins'), xp: xp(p), inventory: inventory(p) });

function nativeLogoutAndReload(p) {
  const oldPid = p.pid, oldSlot = p.slot, username = p.username;
  p.clearInteraction();
  for (let tick = 0; tick < 128 && World.currentTick < p.preventLogoutUntil; tick++) worldTick();
  assert(World.currentTick >= p.preventLogoutUntil, 'ordinary logout cooldown expires without bypass');
  const before = { stage: stage(p), coins: count(p, 'coins'), xp: xp(p), inventory: inventory(p) };
  const hintedTarget = hints(p).at(-1)?.type === 1;
  p.requestLogout = true;
  p.lastResponse = World.currentTick;
  worldTick();
  assert(![...World.playerLoop.all()].includes(p), 'production logout removes the old session');
  if (hintedTarget) assert.equal(hints(p).at(-1)?.type, -1, 'ordinary logout clears the acting player hint');
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
  openOriginalVillagerCurtain(p);
  talk(p, 'feud_street_urchin');
  assert.equal(stage(p), 8);
  assert.equal(owned(p).length, 1);
  assertHint(p, owned(p)[0]);
  assert.equal(p.getVar(slotVar), owned(p)[0].uid);
  return owned(p)[0];
}

function reachDistractionPage(p) {
  if (stage(p) === 6) {
    const first = villagers().find(npc => npc.getVar(stateVar) === 0 && operationStand(p, npc));
    assert(first, 'an original placed villager can earn the first theft');
    operate(p, first, 3);
    assert.equal(stage(p), 7);
  }
  assert([7, 8].includes(stage(p)), 'the final page is reached only through an earned waiting checkpoint');
  openOriginalVillagerCurtain(p);
  const urchin = actors('feud_street_urchin').find(npc => operationStand(p, npc));
  assert(urchin, 'an original Street urchin has a reachable talk stand');
  stand(p, urchin);
  p.clearInteraction();
  p.dialogueMark = p.packets.length;
  assert(p.setInteraction(1, urchin, ServerTriggerType.APNPC1), 'native Talk is accepted');
  p.processInteraction();
  for (let page = 0; page < 240 && p.activeScript; page++) {
    assert.equal(p.activeScript.execution, ScriptState.PAUSEBUTTON, 'the real urchin conversation pauses');
    if (dialoguePage(p).some(text => text === 'Okay, I see them. Here I go!')) {
      const [target] = owned(p);
      assert(target, 'the product has reserved its original villager before the final page');
      assert.equal(owned(p).length, 1, 'the conversation holds only one target');
      assert.equal(p.getVar(slotVar), target.uid);
      assert.equal(p.modalChat, id('Component', 'npcchat1'), 'the short final page uses the registered close root');
      return target;
    }
    resumeDialogue(p);
  }
  assert.fail('the bounded native conversation reaches its final paused page');
}

function assertReleased(p, target) {
  assert.equal(target.getVar(stateVar), 0);
  assert.equal(target.getVar(ownerVar), -1);
  assert.equal(target.getVar(deadlineVar), 0);
  assert.equal(target.timerInterval, 0);
  assert.equal([...target.queue.all()].length, 0);
  assert.equal(p.getVar(slotVar), -1);
  assert.equal(hints(p).at(-1)?.type, -1, 'release clears this player’s distraction arrow');
}

const distractionExitKinds = ['theft', 'refusal', 'expiry', 'page-interruption', 'page-logout', 'window-logout', 'orphaned-page'];
const npcTile = npc => [npc.level, npc.x, npc.z];

for (let seedNumber = 1; seedNumber <= 16; seedNumber++) for (const exit of distractionExitKinds) {
  test(`stationary distraction seed ${seedNumber}: ${exit} releases the original villager to native wandering`, () => {
    const p = trialFixture();
    let selected, selectedPosition, selectionWalks = 0, freshWanderChoices = 0;
    const ownsQueueWaypoint = Object.hasOwn(Npc.prototype, 'queueWaypoint');
    const queueWaypoint = Npc.prototype.queueWaypoint, wander = Npc.prototype.wander, wanderMode = Npc.prototype.wanderMode;
    const random = seededWander(seedNumber);
    // Observe the compiled current-tile walk at selection, without writing NPC state.
    Npc.prototype.queueWaypoint = function (x, z) {
      if (this.getVar(stateVar) === 1 && (this.getVar(ownerVar) >>> 0) === p.uid &&
          p.getVar(slotVar) === this.uid) {
        selectionWalks++;
        assert.equal(x, this.x, 'selection replaces any residual destination with the current tile');
        assert.equal(z, this.z);
        selected = this;
        selectedPosition ??= npcTile(this);
      }
      return queueWaypoint.call(this, x, z);
    };
    Npc.prototype.wander = function (range) {
      if (this === selected && this.getVar(stateVar) === 1) freshWanderChoices++;
      return wander.call(this, range);
    };
    // Reproducible native wander outcomes for this actor only; no actor is moved,
    // frozen or replaced, and other NPCs retain the suite's fixed random stream.
    Npc.prototype.wanderMode = function () {
      if (this !== selected) return wanderMode.call(this);
      const previous = Math.random;
      Math.random = random;
      try { return wanderMode.call(this); }
      finally { Math.random = previous; }
    };
    try {
      const target = reachDistractionPage(p);
      assert(selected === target, 'the compiled reservation performs the published current-tile hold on its selected NPC');
      const heldResult = trialResult(p), paused = p.activeScript;
      const assertHeld = () => {
        assert.deepEqual(npcTile(target), selectedPosition, 'no drift occurs after selection');
        assert.equal(target.targetOp, NpcMode.NONE, 'the selected villager stays in stationary mode');
        assert.equal(target.getVar(stateVar), 1);
        assert.equal(target.getVar(ownerVar) >>> 0, p.uid);
        assert.equal(target.timerInterval, 1, 'the existing single NPC timer remains armed');
        assert.equal([...target.queue.all()].length, 0, 'holding never appends a callback');
        assert.equal(selectionWalks, 1, 'there is no replacement path while held');
        assert.equal(freshWanderChoices, 0, 'the former fresh wander choices are now zero');
      };
      // The diagnostic's 128-turn page produced 26 fresh paths on the old code.
      for (let held = 0; held <= 128; held++) {
        assertHeld();
        assert.equal(target.getVar(deadlineVar), 0);
        assert.equal(p.activeScript, paused);
        assert.equal(p.modalChat, id('Component', 'npcchat1'));
        if (held < 128) worldTick();
      }
      assert.deepEqual(trialResult(p), heldResult);
      const timed = ['theft', 'refusal', 'expiry', 'window-logout'].includes(exit);
      if (timed) {
        resumeDialogue(p);
        assert.equal(stage(p), 8);
        assertHint(p, target);
        const deadline = target.getVar(deadlineVar);
        assert.equal(deadline, World.currentTick + distractionTicks);
        // Logout is completed by the next native turn, before the expiry timer.
        const inputTick = deadline - (exit === 'window-logout' ? 2 : 1);
        while (World.currentTick < inputTick) {
          assertHeld();
          worldTick();
        }
        assertHeld();
      }
      const beforeExit = trialResult(p), hp = p.levels[PlayerStat.HITPOINTS];
      if (exit === 'theft') {
        operate(p, target, 3);
        assert.equal(stage(p), 9);
        assert.equal(count(p, 'coins') - beforeExit.coins, 3);
        assert.equal(xp(p) - beforeExit.xp, 80);
        assert.equal(p.levels[PlayerStat.HITPOINTS], hp);
      } else if (exit === 'refusal') {
        worldTick(() => {
          assert.equal(World.currentTick, target.getVar(deadlineVar));
          assertHeld();
          operate(p, target, 3);
          assert.equal(target.sayMessage, "You won't get my purse.",
            'inspect the native overhead before the same turn broadcasts and clears it');
          assert.equal(hp - p.levels[PlayerStat.HITPOINTS], 2);
        });
        assert.deepEqual(trialResult(p), beforeExit);
      } else if (exit === 'expiry') {
        worldTick();
        assert.deepEqual(trialResult(p), beforeExit);
      } else if (exit === 'page-interruption') {
        const destination = [[p.x + 1, p.z], [p.x - 1, p.z], [p.x, p.z + 1], [p.x, p.z - 1]]
          .find(([x, z]) => !map.isMapBlocked(x, z, p.level) &&
            [...map.findPath(p.level, p.x, p.z, x, z)].at(-1) === CoordGrid.packCoord(p.level, x, z));
        assert(destination, 'the original map admits an ordinary walking interruption');
        assert(moveClickHandler.handle(new MoveClick([{ x: destination[0], z: destination[1] }], 0, false), p));
        assert.equal(p.activeScript, null);
        assert.deepEqual(trialResult(p), beforeExit);
      } else if (exit === 'page-logout' || exit === 'window-logout') {
        p.tabs[10] = types.Component.get(id('Component', 'logout:try_logout')).rootLayer;
        assert(button(p, 'logout:try_logout'), 'the real logout-tab action is accepted');
        assert(p.requestLogout);
        assert.deepEqual(trialResult(p), beforeExit);
        if (exit === 'window-logout') {
          const deadline = target.getVar(deadlineVar);
          worldTick();
          assert.equal(World.currentTick, deadline - 1, 'production logout runs before ordinary expiry');
          assert(![...World.playerLoop.all()].includes(p), 'production logout removes the old session');
          assert.deepEqual(trialResult(p), beforeExit);
        }
      } else {
        // Independent orphan timer path, with no content logout hook.
        p.clearInteraction(); p.unlink(); p.isActive = false;
        World.players[p.pid] = null;
        worldTick();
        assert.deepEqual(trialResult(p), beforeExit);
      }
      if (exit !== 'refusal' && exit !== 'expiry' && exit !== 'orphaned-page') {
        assert.deepEqual(npcTile(target), selectedPosition, 'the release action itself does not move its target');
      }
      if (exit !== 'orphaned-page') assertReleased(p, target);
      else {
        assert.equal(target.getVar(stateVar), 0);
        assert.equal(target.getVar(ownerVar), -1);
        assert.equal(target.getVar(deadlineVar), 0);
        assert.equal(target.timerInterval, 0);
        assert.equal([...target.queue.all()].length, 0);
      }
      assert.equal(freshWanderChoices, 0);
      assert.equal(selectionWalks, 1);
      assert.equal(target.targetOp, NpcMode.WANDER, 'every exit restores ordinary wandering');
      const releasedPosition = npcTile(target);
      for (let waited = 0; waited < nativeSetupWaitTicks &&
          npcTile(target).every((value, index) => value === releasedPosition[index]); waited++) worldTick();
      assert.notDeepEqual(npcTile(target), releasedPosition, 'the released original actor actually walks again within the unchanged native observation bound');
      assert.equal(target.getVar(stateVar), 0);
      assert.equal(target.timerInterval, 0);
      assert.equal([...target.queue.all()].length, 0);
    } finally {
      if (ownsQueueWaypoint) Npc.prototype.queueWaypoint = queueWaypoint;
      else delete Npc.prototype.queueWaypoint;
      Npc.prototype.wander = wander;
      Npc.prototype.wanderMode = wanderMode;
    }
  });
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
  assert.equal(knockoutTicks, 8, 'the constant split preserves the original eight-tick engineering knockout');
  assert.equal(target.getVar(deadlineVar), World.currentTick + knockoutTicks,
    'the compiled villager knockout uses its own unchanged window');
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
  assert(World.currentTick <= admissionDeadline, 'earned distraction admission does not extend the setup bound');
  operate(p, distracted, 3);
  assert.equal(stage(p), 9);
  assert.equal(read(p, 'feud_npc_multi'), 2, 'the second theft exposes the original third client form');
  assert.equal(owned(p).length, 0);
  assert.equal(hints(p).at(-1)?.type, -1, 'the theft clears its cue before the lure and knockout path');
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

test('the distraction window starts only after the final native Continue, however long that page is held', () => {
  const observer = trialFixture(), p = trialFixture(), target = reachDistractionPage(p);
  const before = trialResult(p), page = p.activeScript;
  assert.equal(hints(p).length, 0, 'the reserved page does not show an active-distraction cue');
  for (let held = 0; held <= distractionTicks * 2; held++) {
    assert.equal(target.getVar(stateVar), 1, 'the pending reservation survives every paused turn');
    assert.equal(target.getVar(ownerVar) >>> 0, p.uid);
    assert.equal(target.getVar(deadlineVar), 0, 'a paused page has no active theft deadline');
    assert.equal(target.timerInterval, 1, 'one existing native timer owns cleanup');
    assert.equal([...target.queue.all()].length, 0, 'holding the page never appends a callback');
    assert.equal(p.activeScript, page, 'native turns preserve the same paused continuation');
    if (held < distractionTicks * 2) worldTick();
  }
  assert.deepEqual(trialResult(p), before, 'reading the page changes no checkpoint, money, item or XP');
  resumeDialogue(p);
  assert.equal(stage(p), 8);
  assert.equal(target.getVar(deadlineVar), World.currentTick + 12,
    'Continue arms the authorized twelve-tick distraction, not the eight-tick knockout');
  assertHint(p, target);
  assert.equal(hints(observer).length, 0, 'another player receives neither the target hint nor its changes');
  const coins = count(p, 'coins'), beforeXp = xp(p), hp = p.levels[PlayerStat.HITPOINTS];
  operate(p, target, 3);
  assert.equal(stage(p), 9, 'the genuinely continued distraction can earn its second theft');
  assert.equal(count(p, 'coins') - coins, 3);
  assert.equal(xp(p) - beforeXp, 80);
  assert.equal(p.levels[PlayerStat.HITPOINTS], hp);
  assertReleased(p, target);
  assert.equal(hints(observer).length, 0, 'the acting player’s theft does not clear another player’s hint');
});

test('an ordinary native walking click interrupts the pending page and releases it like expiry', () => {
  const p = trialFixture(), target = reachDistractionPage(p);
  const before = trialResult(p);
  const destination = [[p.x + 1, p.z], [p.x - 1, p.z], [p.x, p.z + 1], [p.x, p.z - 1]]
    .find(([x, z]) => !map.isMapBlocked(x, z, p.level) &&
      [...map.findPath(p.level, p.x, p.z, x, z)].at(-1) === CoordGrid.packCoord(p.level, x, z));
  assert(destination, 'the original map supplies an ordinary adjacent walking destination');
  assert(moveClickHandler.handle(new MoveClick([{ x: destination[0], z: destination[1] }], 0, false), p),
    'the production non-operation walking packet is accepted');
  assert.equal(p.activeScript, null, 'the interrupted dialogue cannot resume its old continuation');
  assertReleased(p, target);
  assert.deepEqual(trialResult(p), before);
  talk(p, 'feud_street_urchin');
  assert.equal(stage(p), 8, 'ordinary re-distraction is still available without a stage rewrite');
  assert.equal(count(p, 'coins'), before.coins, 're-distraction charges no additional fee');
});

for (const checkpoint of [7, 8]) {
  test(`the native logout tab releases a pending final page at earned stage ${checkpoint} and permits retry`, () => {
    let p = trialFixture();
    if (checkpoint === 8) {
      const previous = reachDistraction(p);
      tickThrough(previous.getVar(deadlineVar));
      assert.equal(stage(p), 8, 'ordinary expiry preserves the earned waiting checkpoint');
    }
    const target = reachDistractionPage(p), before = trialResult(p);
    // Match normal logout-tab visibility; the generic fixture opens only inventory and worn tabs.
    p.tabs[10] = types.Component.get(id('Component', 'logout:try_logout')).rootLayer;
    assert(button(p, 'logout:try_logout'), 'the real logout-tab button is accepted');
    assert(p.requestLogout, 'the compiled logout-tab script requests ordinary logout');
    assertReleased(p, target);
    assert.deepEqual(trialResult(p), before);
    p = nativeLogoutAndReload(p);
    assert.equal(stage(p), checkpoint, 'logout does not award or remove an earned waiting checkpoint');
    talk(p, 'feud_street_urchin');
    assert.equal(stage(p), 8, 'the saved account can obtain a new ordinary distraction');
    assert.equal(count(p, 'coins'), before.coins);
  });
}

test('a disconnected owner cannot leave the pending final page reserved indefinitely', () => {
  const p = trialFixture(), target = reachDistractionPage(p);
  const before = trialResult(p);
  // Model a lost in-memory session without invoking the content logout hook.
  p.clearInteraction(); p.unlink(); p.isActive = false;
  World.players[p.pid] = null;
  worldTick();
  assert.equal(target.getVar(stateVar), 0, 'the one NPC timer independently releases an absent owner');
  assert.equal(target.getVar(ownerVar), -1);
  assert.equal(target.getVar(deadlineVar), 0);
  assert.equal(target.timerInterval, 0);
  assert.equal([...target.queue.all()].length, 0);
  assert.deepEqual(trialResult(p), before);
});

test('a continued distraction still expires into the visible two-damage refusal', () => {
  const p = trialFixture(), target = reachDistractionPage(p);
  resumeDialogue(p);
  assert.equal(stage(p), 8);
  tickThrough(target.getVar(deadlineVar));
  assertReleased(p, target);
  const before = trialResult(p), hp = p.levels[PlayerStat.HITPOINTS];
  operate(p, target, 3);
  assert.equal(target.sayMessage, "You won't get my purse.", 'the native NPC overhead carries the refusal');
  assert.equal(hp - p.levels[PlayerStat.HITPOINTS], 2);
  assert.deepEqual(trialResult(p), before, 'expiry consumes no item, checkpoint, money or XP');
});

test('a pickpocket at the deadline clears the arrow through the compiled refusal before the NPC timer runs', () => {
  const p = trialFixture(), target = reachDistractionPage(p);
  resumeDialogue(p);
  assertHint(p, target);
  World.currentTick = target.getVar(deadlineVar);
  const before = trialResult(p), hp = p.levels[PlayerStat.HITPOINTS];
  operate(p, target, 3);
  assertReleased(p, target);
  assert.equal(target.sayMessage, "You won't get my purse.");
  assert.equal(hp - p.levels[PlayerStat.HITPOINTS], 2);
  assert.deepEqual(trialResult(p), before, 'the refused attempt changes no saved progress or rewards');
});

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
    openOriginalVillagerCurtain(p);
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
