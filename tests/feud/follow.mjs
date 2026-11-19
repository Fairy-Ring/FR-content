import assert from 'node:assert/strict';
import { engineModule, map, World } from '../swamp-caves/runtime.mjs';
import { hasWitness, isWitness, worldTick } from './fixture.mjs';

const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const MoveClickHandler = new (await engineModule('network/game/client/handler/MoveClickHandler.ts')).default();
const { NpcMode } = await engineModule('engine/entity/NpcMode.ts');
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const witnessRadius = 5; // Matches the predicate in fixture.mjs.
const seclusionSearchRadius = 32; // UNKNOWN test-fixture geometry bound, not a gameplay distance.
const nativeFollowWaitTicks = 512; // UNKNOWN test-fixture wait bound, not the NPC timeout.


function projectedWitnesses(p, target, x, z) {
  const projected = { uid: target.uid, level: target.level, x, z };
  return [...World.npcs].filter(npc => isWitness(p, projected, npc));
}

function occludedOriginalWitness(target, witnesses, x, z) {
  return witnesses.some(npc => npc.isActive && npc.level === target.level &&
    npc.targetOp !== NpcMode.OPPLAYER2 &&
    CoordGrid.distanceToSW({ x, z }, npc) <= witnessRadius &&
    !map.isLineOfSight(target.level, npc.x, npc.z, x, z));
}

function exactRoute(level, startX, startZ, endX, endZ) {
  const route = [...map.findPath(level, startX, startZ, endX, endZ)];
  if (!route.length) return null;
  const end = CoordGrid.unpackCoord(route.at(-1));
  if (end.level !== level || end.x !== endX || end.z !== endZ) return null;
  return route;
}

function walkRoute(p, route) {
  const clickPath = route.map(value => {
    const point = CoordGrid.unpackCoord(value);
    return { x: point.x, z: point.z };
  });
  assert(MoveClickHandler.handle(new MoveClick(clickPath, 0, false), p),
    'native MoveClick accepts the collision-found route behind the building');
}

function secludedDestination(p, target, witnesses, visited) {
  const nearby = [...World.npcs].filter(npc => npc.isActive && npc.level === target.level &&
    CoordGrid.distanceToSW(target, npc) <= seclusionSearchRadius + witnessRadius);
  // The exact native follower stand is checked after movement, not guessed here.
  for (let radius = 2; radius <= seclusionSearchRadius; radius++) {
    for (let x = target.x - radius; x <= target.x + radius; x++) {
      for (let z = target.z - radius; z <= target.z + radius; z++) {
        if (Math.max(Math.abs(x - target.x), Math.abs(z - target.z)) !== radius ||
          map.isMapBlocked(x, z, target.level) || visited.some(tile => tile.x === x && tile.z === z)) continue;
        const projected = { uid: target.uid, level: target.level, x, z };
        if (nearby.some(npc => isWitness(p, projected, npc)) ||
          !occludedOriginalWitness(target, witnesses, x, z)) continue;
        const route = exactRoute(p.level, p.x, p.z, x, z);
        if (!route) continue;
        return { destination: { level: target.level, x, z }, route };
      }
    }
  }
  assert.fail('no native collision-reachable tile screens the Thug from its original witnesses behind a building');
}

export function followToSeclusion(p, target) {
  assert(target.isActive, 'the original packed NPC is active');
  assert.equal(target.level, p.level, 'the lured NPC and player share a collision plane');
  assert.equal(target.target, p, 'native Lure assigned the owning player as the follow target');
  assert.equal(target.targetOp, NpcMode.PLAYERFOLLOW, 'native Lure selected PLAYERFOLLOW');
  assert(hasWitness(p, target), 'the original NPC begins visible to a nearby witness');
  const originalWitnesses = [...World.npcs].filter(npc => isWitness(p, target, npc));
  const startingNpcTile = [target.level, target.x, target.z];
  const destinations = [];
  let { destination, route } = secludedDestination(p, target, originalWitnesses, destinations);
  destinations.push(destination);
  let routeLength = route.length;
  walkRoute(p, route);

  let ticks = 0;
  for (; ticks < nativeFollowWaitTicks; ticks++) {
    worldTick();
    if (p.level === destination.level && p.x === destination.x && p.z === destination.z &&
      !hasWitness(p, target) && p.inOperableDistance(target) &&
      occludedOriginalWitness(target, originalWitnesses, target.x, target.z) &&
      projectedWitnesses(p, target, p.x, p.z).length === 0 &&
      occludedOriginalWitness(p, originalWitnesses, p.x, p.z)) break;
    if (p.level === destination.level && p.x === destination.x && p.z === destination.z) {
      // A wandering witness or a blocked follower corner can invalidate this stand.
      // Continue ordinary walking within the same total native-turn budget.
      ({ destination, route } = secludedDestination(p, target, originalWitnesses, destinations));
      destinations.push(destination);
      routeLength += route.length;
      walkRoute(p, route);
    }
  }
  assert(ticks < nativeFollowWaitTicks, `native player movement and NPC follow reach the screened destination: ${JSON.stringify({
    tick: World.currentTick, destination, player: [p.level, p.x, p.z],
    destinations,
    npc: [target.level, target.x, target.z], followMode: target.targetOp,
    followsOwner: target.target === p, operable: p.inOperableDistance(target),
    npcWitnesses: projectedWitnesses(p, target, target.x, target.z).map(npc => [npc.uid, npc.x, npc.z]),
    playerWitnesses: projectedWitnesses(p, target, p.x, p.z).map(npc => [npc.uid, npc.x, npc.z]),
    originalWitnesses: originalWitnesses.map(npc => ({
      uid: npc.uid, tile: [npc.level, npc.x, npc.z], active: npc.isActive,
      screensNpc: occludedOriginalWitness(target, [npc], target.x, target.z),
      screensPlayer: occludedOriginalWitness(p, [npc], p.x, p.z)
    }))
  })}`);
  assert.deepEqual([p.level, p.x, p.z], [destination.level, destination.x, destination.z],
    'the player reaches the exact MoveClick destination');
  assert.notDeepEqual([target.level, target.x, target.z], startingNpcTile,
    'native NPC follow moves the original Thug from its starting tile');
  assert.equal(target.target, p, 'the NPC remains attached to the actual native player target');
  assert.equal(target.targetOp, NpcMode.PLAYERFOLLOW, 'the NPC remains in native PLAYERFOLLOW mode');
  assert(!hasWitness(p, target), 'the naturally-followed NPC is out of every witness line of sight');
  assert(originalWitnesses.some(npc => occludedOriginalWitness(target, [npc], target.x, target.z)),
    'an original nearby witness is screened by the intervening building');
  assert.equal(projectedWitnesses(p, target, p.x, p.z).length, 0,
    'the player is also outside every witness line of sight');
  assert(originalWitnesses.some(npc => occludedOriginalWitness(p, [npc], p.x, p.z)),
    'the player and the Thug are screened from an original nearby witness');
  return { destination, routeLength, ticks: ticks + 1 };
}
