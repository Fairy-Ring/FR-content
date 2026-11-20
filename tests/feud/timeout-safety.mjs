import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Packet, PlayerLoading, PlayerStat, ScriptProvider, ScriptState, ServerTriggerType, World, count, engineModule,
  execute, id, inv, inventory, map, obj, seed, types, weakCount
} from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';
import {
  actors, bit, displayNpcType, hasWitness, isWitness, locs, openOriginalVillagerCurtain, operate, operateHere,
  distractionTicks, knockoutTicks, operationStand, read, stage, talk, wield, worldTick
} from './fixture.mjs';
import { followToSeclusion } from './follow.mjs';

const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { NpcStat } = await engineModule('engine/entity/NpcStat.ts');
const { NpcMode } = await engineModule('engine/entity/NpcMode.ts');
const rsbuf = await engineModule('network/rsbuf/index.ts');
const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const moveClickHandler = new (await engineModule('network/game/client/handler/MoveClickHandler.ts')).default();
const OpNpc = (await engineModule('network/game/client/model/OpNpc.ts')).default;
const OpNpcHandler = (await engineModule('network/game/client/handler/OpNpcHandler.ts')).default;
const opNpcHandler = new OpNpcHandler();
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const opLocHandler = new (await engineModule('network/game/client/handler/OpLocHandler.ts')).default();
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const slotVar = id('VarPlayerType', 'feud_trial_villager');
const stateVar = id('VarNpcType', 'feud_villager_state');
const ownerVar = id('VarNpcType', 'feud_villager_owner');
const deadlineVar = id('VarNpcType', 'feud_villager_deadline');
const poisonVar = id('VarNpcType', 'npc_poison');
const repeatFollowVar = id('VarNpcType', 'feud_repeat_follow_deadline');
const repeatKoVar = id('VarNpcType', 'feud_repeat_ko_deadline');
const autoRetaliateVar = id('VarPlayerType', 'option_nodef');
const poisonTimerTicks = 30;
const villagerFormNames = [
  'feud_villager_multi_1', 'feud_villager_multi_2', 'feud_villager_multi_3',
  'feud_villager_1_1', 'feud_villager_1_2', 'feud_villager_1_3',
  'feud_villager_2_1', 'feud_villager_2_2', 'feud_villager_2_3',
  'feud_villager_3_1', 'feud_villager_3_2', 'feud_villager_3_3'
];
const villagerTypes = new Set([1, 2, 3].map(number => id('NpcType', `feud_villager_multi_${number}`)));
const MAX_NPC_CALLBACKS_PER_TICK = 4;
const nativeSetupWaitTicks = 512; // Existing native-geometry bound from follow.mjs, not a gameplay timeout.

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
  openOriginalVillagerCurtain(p);
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

function withRandomSequence(values, action) {
  const previous = JavaRandom.nextDouble;
  const draws = [];
  JavaRandom.nextDouble = () => {
    assert(draws.length < values.length, 'native Attack uses only the declared deterministic RNG draws');
    const value = values[draws.length];
    draws.push(value);
    return value;
  };
  try { action(); }
  finally { JavaRandom.nextDouble = previous; }
  return { draws, restored: JavaRandom.nextDouble === previous };
}

function showNpcForNativeClick(p, npc) {
  rsbuf.addPlayer(p.slot);
  rsbuf.addNpc(npc.nid, npc.type);
  const appearance = p.generateAppearance();
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, appearance, p.lastAppearance,
    p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ,
    p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[PlayerStat.HITPOINTS], p.baseLevels[PlayerStat.HITPOINTS], p.animId, p.animDelay,
    p.sayMessage, p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0,
    p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(npc.x, npc.level, npc.z, npc.nid, npc.type, npc.tele, npc.jump,
    npc.runDir, npc.walkDir, npc.isActive, npc.masks, npc.faceEntity,
    npc.faceSquareX, npc.faceSquareZ, npc.faceAngleX, npc.faceAngleZ,
    npc.hitmarkDamage, npc.hitmarkType, npc.hitmark2Damage, npc.hitmark2Type,
    npc.levels[NpcStat.HITPOINTS], npc.baseLevels[NpcStat.HITPOINTS], npc.animId,
    npc.animDelay, npc.sayMessage, npc.spotanimId, npc.spotanimHeight, npc.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, npc.nid), 'the production visibility encoder includes the original NPC');
}

function selectVisibleNpc(p, npc, option, expectedTrigger) {
  showNpcForNativeClick(p, npc);
  assert(p.inOperableDistance(npc), 'the player is at an ordinary collision-reachable operation stand');
  assert(opNpcHandler.handle(new OpNpc(option, npc.nid), p), `native OPNPC${option} accepts the visible target`);
  assert.equal(p.target, npc);
  assert.equal(p.targetOp, ServerTriggerType.APNPC1 + option - 1);
  assert.equal(p.getOpTrigger()?.name, expectedTrigger, 'native dispatch selects the packed visible-form action');
}

function processSelectedInteraction(p) {
  p.processInteraction();
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED,
    'the native player interaction finishes synchronously');
}

function ordinaryPoisonedAttack(p, npc, visibleForm) {
  const stand = operationStand(p, npc);
  assert(stand, 'the original NPC has a collision-reachable operation stand');
  [p.level, p.x, p.z] = stand;
  p.originX = p.x;
  p.originZ = p.z;
  const visible = displayNpcType(p, npc);
  assert.equal(visible.debugname, visibleForm);
  assert.equal(visible.op?.[1], 'Attack');
  assert.equal(count(p, 'bronze_dagger_p', id('InvType', 'worn')), 1,
    'the ordinary poisoned dagger is worn before the native Attack input');
  assert.equal(types.ObjType.get(obj('bronze_dagger_p')).params?.get(id('ParamType', 'poison_severity')), 20,
    'the worn item has its published poison severity');
  assert(p.inOperableDistance(npc));
  selectVisibleNpc(p, npc, 2, '[opnpc2,_]');
  const rng = withRandomSequence([0.999999, 0, 0.999999, 0], () => processSelectedInteraction(p));
  assert.equal(rng.restored, true);
  assert.deepEqual(rng.draws, [0.999999, 0, 0.999999, 0],
    'the draws select a successful hit, positive damage, and the native one-in-four poison branch');
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

function walkIntoNativeRange(p, target, tick, deadline) {
  const destination = operationStand(p, target);
  assert(destination, 'the original follower has a collision-reachable operation stand');
  const route = [...map.findPath(p.level, p.x, p.z, destination[1], destination[2])];
  assert(route.length, 'the owner has a real walking route to the original follower');
  const end = CoordGrid.unpackCoord(route.at(-1));
  assert.deepEqual([end.level, end.x, end.z], destination, 'the native route reaches that exact stand');
  const path = route.map(coord => {
    const point = CoordGrid.unpackCoord(coord);
    return { x: point.x, z: point.z };
  });
  assert(moveClickHandler.handle(new MoveClick(path, 0, false), p), 'native MoveClick accepts the owner approach');
  const arrived = () => p.level === destination[0] && p.x === destination[1] && p.z === destination[2];
  for (let ticks = 0; ticks < nativeSetupWaitTicks && World.currentTick < deadline &&
    (!arrived() || !p.inOperableDistance(target)); ticks++) tick();
  assert(arrived() && p.inOperableDistance(target),
    'the owner walks into actual operation range without extending the original deadline or relocating an actor');
}

function prepareLateInput(p, target, tracked, deadline) {
  const searchRadius = 32; // UNKNOWN fixture geometry bound, as in follow.mjs.
  const travelBudget = deadline - World.currentTick;
  assert.equal(travelBudget, nativeSetupWaitTicks, 'late-input preparation retains exactly its original 512 turns');
  // The original curtain automatically restores after 200 native turns. The
  // long Lure wait must not leave this ordinary exit closed during preparation.
  const closedType = id('LocType', 'curtain_1528'), openType = id('LocType', 'curtain_1529');
  const curtains = locs('curtain_1528').filter(row => row.level === p.level &&
    CoordGrid.distanceToSW(p, row) <= searchRadius).sort((a, b) =>
    CoordGrid.distanceToSW(p, a) - CoordGrid.distanceToSW(p, b));
  let closed = null, curtainPath = null;
  for (const row of curtains) {
    const candidate = World.getLoc(row.x, row.z, row.level, closedType);
    if (!candidate) continue;
    const force = types.LocType.get(candidate.type).forceapproach;
    const path = [...map.findPathToLoc(p.level, p.x, p.z, candidate.x, candidate.z, p.width,
      candidate.width, candidate.length, candidate.angle, candidate.shape, force)];
    const end = path.length ? CoordGrid.unpackCoord(path.at(-1)) : p;
    if (!map.reachedLoc(p.level, end.x, end.z, candidate.x, candidate.z,
      candidate.width, candidate.length, p.width, candidate.angle, candidate.shape, force)) continue;
    closed = candidate;
    curtainPath = path;
    break;
  }
  if (closed) {
    const before = [p.level, p.x, p.z], tick = World.currentTick;
    const curtain = closed;
    if (!p.inOperableDistance(closed)) {
      assert(curtainPath.length, 'native loc routing reaches an Open stand beside this original curtain');
      const steps = curtainPath.map(coord => {
        const point = CoordGrid.unpackCoord(coord);
        return { x: point.x, z: point.z };
      });
      assert(moveClickHandler.handle(new MoveClick(steps, 0, false), p),
        'native MoveClick supplies the ordinary curtain-approach path before OPLOC1');
      while (World.currentTick < deadline && !p.inOperableDistance(closed)) countedWorldTick(tracked);
      assert(p.inOperableDistance(closed), `the owner really walks into curtain operation range within the original setup budget: ${JSON.stringify({
        before, player: [p.level, p.x, p.z], curtain: [closed.level, closed.x, closed.z], path: steps
      })}`);
    }
    assert(opLocHandler.handle(new OpLoc(1, curtain.x, curtain.z, closedType), p),
      'native OPLOC1 accepts Open on the naturally restored original curtain');
    while (World.currentTick < deadline && World.getLoc(curtain.x, curtain.z, curtain.level, closedType)) {
      countedWorldTick(tracked);
    }
    assert(World.getLoc(curtain.x, curtain.z, curtain.level, openType),
      'ordinary player walking and the compiled Open expose the original exit within the same setup budget');
    console.log(JSON.stringify({ kind: 'late-input-native-curtain', before, after: [p.level, p.x, p.z],
      ticks: World.currentTick - tick, remaining: deadline - World.currentTick }));
  }
  const remainingTravel = deadline - World.currentTick;
  const margin = 5 + Math.max(target.width, target.length, p.width); // Native witness radius plus every follower stand.
  const distance = (x, z, bounds) => Math.max(
    Math.max(bounds.minX - x, x - bounds.maxX, 0),
    Math.max(bounds.minZ - z, z - bounds.maxZ, 0));
  const footprints = [];
  for (const npc of World.npcs) {
    if (!npc.isActive || npc.level !== target.level || npc.uid === target.uid) continue;
    const range = types.NpcType.get(npc.type).wanderrange;
    // Native NPC movement is WALK (one tile per turn). Intersect home-wander
    // destinations with what can be reached during this unchanged preparation
    // window, also covering the native reset-to-home. A distant pet's enormous
    // configured range does not let it cross the world in one turn.
    const bounds = {
      minX: Math.max(Math.min(npc.x, npc.startX - range), Math.min(npc.x, npc.startX) - remainingTravel),
      maxX: Math.min(Math.max(npc.x, npc.startX + range), Math.max(npc.x, npc.startX) + remainingTravel),
      minZ: Math.max(Math.min(npc.z, npc.startZ - range), Math.min(npc.z, npc.startZ) - remainingTravel),
      maxZ: Math.min(Math.max(npc.z, npc.startZ + range), Math.max(npc.z, npc.startZ) + remainingTravel),
      name: types.NpcType.get(npc.type).debugname, current: [npc.x, npc.z], home: [npc.startX, npc.startZ], range
    };
    if (distance(target.x, target.z, bounds) > searchRadius + margin) continue;
    assert([NpcMode.NONE, NpcMode.WANDER].includes(npc.targetOp),
      'nearby fixture actors have normal stationary or home-bounded native wandering');
    // Including animals and invisible forms is conservative: neither can make
    // a nominally safe holding tile depend on a later visible form or RNG draw.
    footprints.push(bounds);
  }
  let destination = null, route = null, safeTiles = 0;
  for (let radius = 1; radius <= searchRadius && !destination; radius++) {
    for (let x = target.x - radius; x <= target.x + radius && !destination; x++) {
      for (let z = target.z - radius; z <= target.z + radius; z++) {
        if (Math.max(Math.abs(x - target.x), Math.abs(z - target.z)) !== radius ||
            map.isMapBlocked(x, z, target.level) ||
            footprints.some(bounds => distance(x, z, bounds) <= margin)) continue;
        safeTiles++;
        const path = [...map.findPath(p.level, p.x, p.z, x, z)];
        if (!path.length) continue;
        const end = CoordGrid.unpackCoord(path.at(-1));
        if (end.level !== target.level || end.x !== x || end.z !== z) continue;
        destination = { level: end.level, x, z };
        route = path.map(coord => CoordGrid.unpackCoord(coord));
        break;
      }
    }
  }
  assert(destination, `an exact native walking route reaches a holding point outside every nearby NPC wander footprint: ${JSON.stringify({
    tick: World.currentTick, player: [p.level, p.x, p.z], npc: [target.level, target.x, target.z], safeTiles, footprints
  })}`);
  const startingNpcTile = [target.level, target.x, target.z];
  let waypoint = 0;
  for (let turns = 0; turns < nativeSetupWaitTicks && World.currentTick < deadline; turns++) {
    while (waypoint < route.length && p.x === route[waypoint].x && p.z === route[waypoint].z) waypoint++;
    // Naive following can stop at diagonal adjacency even when a corner
    // blocks operation range. Let the owner lead from that adjacent tile;
    // the actual later input still requires native operation range.
    if (!p.hasWaypoints() && CoordGrid.distanceTo(p, target) <= 1 && waypoint < route.length) {
      const point = route[waypoint];
      // A compressed path may span several tiles. Lead one actual tile at a
      // time and let PLAYERFOLLOW catch up before rounding the next corner.
      const next = { x: p.x + Math.sign(point.x - p.x), z: p.z + Math.sign(point.z - p.z) };
      assert(moveClickHandler.handle(new MoveClick([next], 0, false), p),
        'native MoveClick accepts the next collision-found owner step');
    }
    countedWorldTick(tracked);
  }
  assert.deepEqual([p.level, p.x, p.z], [destination.level, destination.x, destination.z],
    `ordinary owner walking reaches the wander-independent holding point inside the original setup budget: ${JSON.stringify({
      target: [target.level, target.x, target.z], mode: target.targetOp, waypoint, route
    })}`);
  assert.notDeepEqual([target.level, target.x, target.z], startingNpcTile,
    'native PLAYERFOLLOW moves the original Villager, not a fixture relocation');
  assert.equal(target.target, p);
  assert.equal(target.targetOp, NpcMode.PLAYERFOLLOW);
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
  for (let ticks = 0; ticks <= nativeSetupWaitTicks; ticks++) {
    const target = actors(name).find(npc => npc.getVar(stateVar) === 0 && [...npc.queue.all()].length === 0 &&
      npc.timerInterval <= 0 && (!requireNoWitness || !hasWitness(p, npc)) && operationStand(p, npc));
    if (target) return target;
    if (ticks < nativeSetupWaitTicks) worldTick();
  }
}

function assertAttackableQueueBound(npc) {
  const requests = [...npc.queue.all()];
  const timeoutRequests = requests.filter(request => request.queueId === ServerTriggerType.AI_QUEUE19);
  assert.equal(requests.length, timeoutRequests.length,
    'the repeat target has no unrelated native queue requests: ' + JSON.stringify({
      hp: npc.levels[NpcStat.HITPOINTS], poison: npc.getVar(poisonVar),
      requests: requests.map(({ queueId, lastInt }) => ({ queueId, lastInt }))
    }));
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
  let observationError = null;
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
    try {
      observeCallback?.({
        npc: this, tick, before, after: npcSnapshot(this)
      });
    } catch (error) {
      // Native turn processing catches script errors. Re-throw the assertion
      // outside that catch so an observer failure cannot become a logged pass.
      observationError ??= error;
    }
    return result;
  };
  try {
    try { action(); } catch (error) { throw observationError ?? error; }
    if (observationError) throw observationError;
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
  openOriginalVillagerCurtain(p);
  // Test-only clock anchor. Two real account actions expose a stale queued timeout
  // without injecting requests: the old implementation kept the first owner's queue.
  World.currentTick = 107 - distractionTicks;
  const tracked = new Set();
  let target;
  countedWorldTick(tracked, () => {
    talk(previousOwner, 'feud_street_urchin');
    [target] = owned(previousOwner);
    assert(target);
    tracked.add(target);
  });
  assert.equal(World.currentTick, 108 - distractionTicks);
  nativeLogout(previousOwner, () => countedWorldTick(tracked));
  assert.equal(World.currentTick, 109 - distractionTicks);
  assert.equal(target.getVar(stateVar), 0, 'ordinary logout releases the first earned distraction');
  countedWorldTick(tracked, () => {
    talk(p, 'feud_street_urchin');
    assert.equal(owned(p)[0], target, 'the second real conversation selects the same original placement');
  });
  assert.equal(World.currentTick, 110 - distractionTicks);
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

test(`a native KO input at clock ${110 - knockoutTicks} returns at clock 109 with deadline 110 instead of spinning`, () => {
  const p = repeatFixture();
  const target = attackableTarget(p, 'feud_arabian_guard2_multi', true);
  assert(target, 'an original unwitnessed Bandit41 placement is available');
  // Test-only clock anchor; the following Lure and real input create all NPC state.
  World.currentTick = 109 - knockoutTicks;
  const tracked = new Set([target]);
  const initialTimer = target.timerInterval;
  attackableLure(p, target);
  assert.equal(World.currentTick, 109 - knockoutTicks);

  let deadline;
  countedWorldTick(tracked, () => { deadline = dispatchSynchronousKnockOut(p, target); },
    ({ npc }) => assertAttackableQueueBound(npc));
  assert.equal(World.currentTick, 110 - knockoutTicks, 'the real synchronous input precedes its native NPC phase');
  assert.equal(deadline, 110, 'the compiled independent KO window is anchored at its real input');
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
  const tracked = new Set([target]);
  const setupDeadline = oldDeadline - 3;
  boundedTicksThrough(tracked, setupDeadline - nativeSetupWaitTicks);
  // A nearby witness can wander back into view on the final preparation tick.
  // Use real owner movement to a point beyond every nearby home-wander footprint,
  // retaining the original 512-turn budget and exact late-input schedule.
  prepareLateInput(p, target, tracked, setupDeadline);
  assert.equal(World.currentTick, oldDeadline - 3);
  assert(p.inOperableDistance(target), `the actual late input is in native operation range: ${JSON.stringify({
    player: [p.level, p.x, p.z], npc: [target.level, target.x, target.z],
    mode: target.targetOp, followsOwner: target.target === p, state: target.getVar(stateVar)
  })}`);
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

test('native poison keeps its 30-tick cadence through ordinary completed-Feud Lure/KO', () => {
  assert.equal(knockoutTicks, 8, 'the independent knockout duration remains unchanged');
  for (const [name, initialHp, visibleForm] of [
    ['feud_arabian_guard2_multi', 30, 'feud_arabian_guard2_2'],
    ['feud_egyptian_doorman_multi', 60, 'feud_egyptian_doorman_2']
  ]) {
    const originalRandom = JavaRandom.nextDouble;
    const p = repeatFixture();
    // Disclosed own-player fixture state only: low Strength preserves the original
    // target, and auto-retaliation is disabled so NPC retaliation cannot create a
    // second player Attack. No NPC HP, poison, timer, or queue state is seeded.
    assert.equal(p.getVar(autoRetaliateVar), 0, 'the player fixture begins with auto-retaliation on');
    p.setVar(autoRetaliateVar, 1);
    p.invAdd(inv, obj('bronze_dagger_p'), 1);
    p.baseLevels[PlayerStat.STRENGTH] = 1;
    p.levels[PlayerStat.STRENGTH] = 1;
    p.baseLevels[PlayerStat.ATTACK] = 99;
    p.levels[PlayerStat.ATTACK] = 99;
    wield(p, 'bronze_dagger_p');
    execute('[proc,player_combat_stat]', p);

    const target = attackableTarget(p, name, true);
    assert(target, `an original unwitnessed ${name} placement is available`);
    assert.equal(target.baseType, id('NpcType', name));
    assert.equal(target.levels[NpcStat.HITPOINTS], initialHp);
    assert.equal(target.getVar(stateVar), 0);
    assert.equal(target.getVar(poisonVar), 0, 'poison is not seeded');
    assert.equal([...target.queue.all()].length, 0, 'the NPC queue is not seeded');
    assert(target.timerInterval <= 0, 'the NPC timer is not seeded');
    const poisonTimer = ScriptProvider.getByTrigger(ServerTriggerType.AI_TIMER, target.type,
      types.NpcType.get(target.type).category);
    assert.equal(poisonTimer?.name, '[ai_timer,_]', 'the original form resolves the generic native poison timer');

    const weaponSeverity = types.ObjType.get(obj('bronze_dagger_p')).params?.get(id('ParamType', 'poison_severity'));
    assert.equal(weaponSeverity, 20);
    assert.equal(count(p, 'bronze_dagger_p', id('InvType', 'worn')), 1);
    const attackHpBefore = target.levels[NpcStat.HITPOINTS];
    ordinaryPoisonedAttack(p, target, visibleForm);
    assert.equal(target.getVar(poisonVar), weaponSeverity,
      'ordinary player_melee_attack reads poison severity from the worn weapon');
    assert.equal(target.timerInterval, poisonTimerTicks, 'native npc_poison_start arms the 30-tick timer');
    assert.equal(target.getVar(stateVar), 0, 'normal Attack does not fabricate a Feud state');
    const attackQueue = [...target.queue.all()].filter(request => request.queueId === ServerTriggerType.AI_QUEUE2);
    assert.equal(attackQueue.length, 1, 'the real melee hit queues one native damage callback');
    const attackDamage = attackQueue[0].lastInt;
    assert(attackDamage > 0);

    // Use normal Wear and Player.stopAction, then let the ordinary retaliation and
    // damage queues resolve before the Feud interaction. The test player cannot
    // auto-retaliate into a second poisoned-weapon Attack.
    wield(p, 'blackjack_oak');
    p.stopAction();
    assert.notEqual(p.getOpTrigger()?.name, '[opnpc2,_]');
    const tracked = new Set([target]);
    countedWorldTick(tracked);
    assert.equal(target.levels[NpcStat.HITPOINTS], attackHpBefore - attackDamage,
      'the queued ordinary Attack damage lands exactly once');
    assert(target.levels[NpcStat.HITPOINTS] > 0, 'the Strength-1 hit leaves the original placement alive');
    assert.equal(target.getVar(poisonVar), weaponSeverity);
    assert.equal(target.timerInterval, poisonTimerTicks);
    assertAttackableQueueBound(target);
    assert.equal([...target.queue.all()].length, 0, 'ordinary attack and retaliation queues have resolved');

    selectVisibleNpc(p, target, 4, `[opnpc4,${visibleForm}]`);
    processSelectedInteraction(p);
    assert.equal(target.getVar(stateVar), 2, 'ordinary completed-Feud Lure starts following');
    assert.equal(target.getVar(ownerVar), p.uid);
    assert.equal(target.target, p);
    assert.equal(target.targetOp, NpcMode.PLAYERFOLLOW);
    assert.equal(p.getVar(slotVar), -1, 'repeat Lure does not acquire the trial-only player reference');
    const expectedStage = stage(p);
    assert.equal(expectedStage, 28, 'the completed-Feud stage remains 28');
    assertAttackableQueueBound(target);
    assert.equal([...target.queue.all()].length, 1, 'Lure owns exactly one native follow timeout request');

    const events = [];
    const preparationDeadline = World.currentTick + nativeSetupWaitTicks;
    let previousPoisonTick = null;
    let poisonHits = 0;
    const observeQueueAndPoison = event => {
      assertAttackableQueueBound(event.npc);
      if (event.before.poison > event.after.poison) {
        const severityBefore = event.before.poison;
        // The weapon starts at 20 and each native hit decrements once. This
        // positive-hit proof ends before the published terminal clear at one.
        assert(Number.isInteger(severityBefore) && severityBefore >= 2 && severityBefore <= weaponSeverity,
          'a positive poison tick reads a severity in the weapon-produced range 2..20');
        assert.equal(severityBefore, weaponSeverity - poisonHits,
          'no weapon-produced severity was skipped or reseeded before this tick');
        const expectedDamage = Math.floor((severityBefore + 3) / 5);
        assert(expectedDamage > 0);
        assert.equal(event.before.hp - event.after.hp, expectedDamage,
          'every native poison hit matches the published decrement-then-damage formula exactly');
        assert.equal(event.after.poison, severityBefore - 1);
        poisonHits++;
        if (previousPoisonTick !== null) {
          assert.equal(event.tick - previousPoisonTick, poisonTimerTicks,
            'every observed native poison hit remains thirty ticks apart during preparation');
        }
        previousPoisonTick = event.tick;
      }
      events.push(event);
    };
    if (hasWitness(p, target)) {
      const startTick = World.currentTick;
      const route = observeNativeCallbacks(tracked, () => followToSeclusion(p, target), observeQueueAndPoison);
      assert(route.maxCallbacksInOneTick <= MAX_NPC_CALLBACKS_PER_TICK);
      assert(World.currentTick > startTick, 'native following advances while the original NPC is poisoned');
    }
    assert.equal(target.getVar(stateVar), 2);
    assert(target.getVar(poisonVar) > 0);
    assert(!hasWitness(p, target), 'the original witness predicate permits ordinary Knock-Out');
    assert(p.inOperableDistance(target));

    let followingHit = events.filter(event => event.before.poison > event.after.poison &&
      event.before.state === 2 && event.after.state === 2).at(-1);
    if (!followingHit) {
      const firstPoisonTick = nextNpcTimerTick(target);
      boundedTicksThrough(tracked, firstPoisonTick, null, observeQueueAndPoison);
      followingHit = events.find(event => event.tick === firstPoisonTick &&
        event.before.poison > event.after.poison && event.before.state === 2 && event.after.state === 2);
    }
    assert(followingHit, 'a native poison callback damages the original NPC while Lure is active');
    assert.equal(followingHit.before.poison - followingHit.after.poison, 1);

    let nextPoisonTick, koInputTick, koDeadline, koInput;
    while (koDeadline === undefined) {
      assert(World.currentTick < preparationDeadline, 'native poison/KO preparation stays within 512 turns');
      walkRepeatToSeclusion(p, target,
        () => countedWorldTick(tracked, null, observeQueueAndPoison), preparationDeadline);
      assert.equal(target.getVar(stateVar), 2, 'preparation preserves the actual earned Lure');
      followingHit = events.filter(event => event.before.poison > event.after.poison &&
        event.before.state === 2 && event.after.state === 2).at(-1);
      assert(followingHit, 'preparation retains a real following-state poison hit');
      nextPoisonTick = nextNpcTimerTick(target);
      assert.equal(nextPoisonTick - followingHit.tick, poisonTimerTicks,
        'the next native poison callback remains exactly 30 ticks after the preceding hit');
      if (nextPoisonTick - World.currentTick <= knockoutTicks) {
        assert(nextPoisonTick <= preparationDeadline, 'the next phase fits the unchanged preparation bound');
        boundedTicksThrough(tracked, nextPoisonTick, null, observeQueueAndPoison);
        continue;
      }
      koInputTick = nextPoisonTick - knockoutTicks;
      assert(koInputTick > World.currentTick && koInputTick <= preparationDeadline);
      boundedTicksThrough(tracked, koInputTick - 1, null, observeQueueAndPoison);
      assert.equal(target.getVar(stateVar), 2);
      assert.equal(target.timerClock, poisonTimerTicks - knockoutTicks - 1);
      countedWorldTick(tracked, () => {
        // Admit the real input on this frame, not from a witness check made before the phase wait.
        if (hasWitness(p, target) || !p.inOperableDistance(target)) return;
        koInput = { tick: World.currentTick, name, player: [p.level, p.x, p.z],
          target: [target.level, target.x, target.z], hp: target.levels[NpcStat.HITPOINTS],
          witnesses: [...World.npcs].filter(npc => isWitness(p, target, npc))
            .map(npc => [npc.uid, npc.x, npc.z]) };
        withRandom(0, () => {
          selectVisibleNpc(p, target, 5, `[opnpc5,${visibleForm}]`);
          processSelectedInteraction(p);
        });
        koDeadline = target.getVar(deadlineVar);
      }, observeQueueAndPoison);
    }
    assert.equal(JavaRandom.nextDouble, originalRandom, 'native Knock-Out restores the process RNG');
    assert.equal(World.currentTick, koInputTick);
    assert.equal(target.getVar(stateVar), 3, 'the native KO succeeds: ' + JSON.stringify({
      koInput, state: target.getVar(stateVar), overhead: target.sayMessage,
      targetMode: target.targetOp, hp: target.levels[NpcStat.HITPOINTS],
      witnesses: [...World.npcs].filter(npc => isWitness(p, target, npc))
        .map(npc => [npc.uid, npc.x, npc.z]), messages: p.messages }));
    assert.equal(target.getVar(ownerVar), p.uid);
    assert.equal(p.getVar(slotVar), -1);
    assertAttackableQueueBound(target);
    assert.equal(koDeadline, nextPoisonTick,
      'the checked-out Feud duration aligns the KO deadline with the next native poison tick');
    assert.equal(target.timerClock, poisonTimerTicks - knockoutTicks);
    assert.equal(target.getVar(poisonVar), followingHit.after.poison,
      'Lure and Knock-Out do not reseed native poison');

    boundedTicksThrough(tracked, koDeadline, null, observeQueueAndPoison);
    const koPoisonHit = events.find(event => event.tick === koDeadline && event.before.poison > event.after.poison);
    assert(koPoisonHit, 'native poison runs on the completed-Feud KO deadline');
    assert.equal(koPoisonHit.before.state, 3);
    assert.equal(koPoisonHit.after.state, 3);
    assert.equal(koPoisonHit.before.poison - koPoisonHit.after.poison, 1);
    assert.equal(koPoisonHit.tick - followingHit.tick, poisonTimerTicks,
      'the following and KO-overlap poison hits remain exactly 30 native ticks apart');
    assert.equal(target.getVar(stateVar), 3, 'the same-pass-safe Feud timeout remains queued at the deadline');
    assert.equal(target.getVar(ownerVar), p.uid);
    assert.equal(target.getVar(deadlineVar), koDeadline);
    assertAttackableQueueBound(target);

    // FEUD-TIMEOUT-REARM-01 documents cleanup no later than one tick after the
    // stored deadline; the poison callback above is still exactly on that deadline.
    boundedTicksThrough(tracked, koDeadline + 1, null, observeQueueAndPoison);
    assert.equal(target.getVar(stateVar), 0);
    assert.equal(target.getVar(ownerVar), -1);
    assert.equal(target.getVar(deadlineVar), 0);
    assert.equal(target.timerInterval, poisonTimerTicks, 'Feud reset preserves the independent poison timer');
    assertAttackableQueueBound(target);

    execute('[proc,npc_poison_clear]', p, [], { target });
    assert.equal(target.getVar(poisonVar), 0);
    assert.equal(target.timerInterval, 0);
    drainTargetQueues(tracked);
    assertAttackableQueueBound(target);
    assert.equal([...target.queue.all()].length, 0, 'the original NPC has no leaked native queue jobs');
    assert.equal(JavaRandom.nextDouble, originalRandom, 'all deterministic RNG substitutions are restored');
    assert.equal(stage(p), expectedStage);
    assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED);
    assert.equal(weakCount(p), 0, 'the fixture player has no leaked weak-queue jobs');
  }
});

function walkRepeatToSeclusion(p, target, tick, setupDeadline = World.currentTick + nativeSetupWaitTicks) {
  const searchRadius = 32; // UNKNOWN test geometry bound, reused from follow.mjs, not a gameplay distance.
  const destinations = [];
  let destination = null;
  let remainingWaypoints = [];
  let previousPositions = null;
  for (; World.currentTick < setupDeadline;) {
    const positions = [p.x, p.z, target.x, target.z];
    const stationary = previousPositions?.every((value, index) => value === positions[index]);
    previousPositions = positions;
    if (stationary && !p.hasWaypoints() && !p.inOperableDistance(target)) {
      // A naive follower can stop diagonally across a wall. Walk the owner to
      // an actual operation stand instead of waiting forever for it to path.
      walkIntoNativeRange(p, target, tick, setupDeadline);
      destination = null;
      remainingWaypoints = [];
    }
    if (!hasWitness(p, target) && p.inOperableDistance(target) &&
      (!destination || (p.x === destination.x && p.z === destination.z))) return;
    if (!destination || ((p.x === destination.x && p.z === destination.z) &&
      !remainingWaypoints.length && p.inOperableDistance(target))) {
      // Five witness tiles plus the follower's one-tile finishing neighborhood.
      const nearby = [...World.npcs].filter(npc => npc.isActive && npc.level === target.level &&
        CoordGrid.distanceToSW(target, npc) <= searchRadius + 6);
      let route = null;
      search: for (let radius = 2; radius <= searchRadius; radius++) {
        for (let x = target.x - radius; x <= target.x + radius; x++) {
          candidateTile: for (let z = target.z - radius; z <= target.z + radius; z++) {
            if (Math.max(Math.abs(x - target.x), Math.abs(z - target.z)) !== radius ||
              map.isMapBlocked(x, z, target.level) ||
              destinations.some(tile => tile.x === x && tile.z === z)) continue;
            for (let dx = -1; dx <= 1; dx++) {
              for (let dz = -1; dz <= 1; dz++) {
                const projected = { uid: target.uid, level: target.level, x: x + dx, z: z + dz };
                if (!map.isMapBlocked(projected.x, projected.z, projected.level) &&
                  nearby.some(npc => isWitness(p, projected, npc))) continue candidateTile;
              }
            }
            const candidate = [...map.findPath(p.level, p.x, p.z, x, z)];
            if (!candidate.length) continue;
            const end = CoordGrid.unpackCoord(candidate.at(-1));
            if (end.level !== p.level || end.x !== x || end.z !== z) continue;
            destination = { x, z };
            route = candidate.map(value => {
              const point = CoordGrid.unpackCoord(value);
              return { x: point.x, z: point.z };
            });
            break search;
          }
        }
      }
      assert(route, 'native collision provides another unwitnessed destination within the existing search bound');
      destinations.push(destination);
      remainingWaypoints = route;
    }
    // PLAYERFOLLOW is naive; finish each ordinary A* turning point with the
    // follower still operable before leading it around the next corner.
    if (remainingWaypoints.length && !p.hasWaypoints() && p.inOperableDistance(target)) {
      assert(moveClickHandler.handle(new MoveClick([remainingWaypoints.shift()], 0, false), p),
        'ordinary MoveClick accepts the next paced native seclusion waypoint');
    }
    tick();
  }
  assert(!hasWitness(p, target) && p.inOperableDistance(target),
    'native follow and wandering witnesses permit the actual KO within the existing setup bound: ' +
    JSON.stringify({ player: [p.x, p.z, p.level], target: [target.x, target.z, target.level],
      destinations, witnessed: hasWitness(p, target), operable: p.inOperableDistance(target) }));
}

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
    // Continue walking if a new witness enters a destination during the real follow.
    walkRepeatToSeclusion(p, target, tick);
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

test('a native callback observer assertion cannot be swallowed by script error handling', () => {
  const p = trialFixture();
  const target = reachDistraction(p);
  const original = Npc.prototype.executeScript;
  const failure = new Error('deliberate native observer regression');
  assert.throws(() => countedWorldTick(new Set([target]), null, () => { throw failure; }),
    error => error === failure);
  assert.equal(Npc.prototype.executeScript, original, 'the native executor is restored after an observer failure');
  boundedTicksThrough(new Set([target]), target.getVar(deadlineVar) + 1);
});
