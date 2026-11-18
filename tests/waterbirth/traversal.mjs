import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { World, types, id, player, execute, ScriptProvider, ServerTriggerType, map, tile, CollisionType, contentRoot, resumeDialogue, settle } from '../swamp-caves/runtime.mjs';
import { proveFootpath } from './footpath.mjs';
import { traversalLocs, deepLadderPairs, rockyStepsRows, iceEntryRows, centralToDeepRows, deepLadderRows, kingsRoomLadderRows, findKingsRoute } from './traversal-data.mjs';

function unpack(coord) {
  const [level, mapX, mapZ, localX, localZ] = coord.split('_').map(Number);
  return { level, mapX, mapZ, localX, localZ, x: mapX * 64 + localX, z: mapZ * 64 + localZ };
}

const locationKey = location => {
  const point = location.coord ? unpack(location.coord) : location;
  return `${location.name}@${point.level}:${point.x}:${point.z}`;
};
const mapSources = new Map();
const mappedLocations = [
  ...Object.values(traversalLocs),
  ...deepLadderPairs.flatMap(pair => [pair.down, pair.up]),
];
assert.equal(deepLadderPairs.length, 17, 'the complete Dagexp ladder network has 17 directional pairs');
const deepNames = new Set(deepLadderPairs.flatMap(pair => [pair.down.name, pair.up.name]));
assert.equal(deepNames.size, 34, 'all 34 numbered Dagexp ladder aliases are represented');
for (let number = 1; number <= 34; number++) {
  assert(deepNames.has(`dagexp_ladder${number}`), `numbered Dagexp ladder ${number} is represented`);
}
assert.equal(new Set(mappedLocations.map(locationKey)).size, mappedLocations.length, 'every location fixture is unique');

const locEntities = new Map();
for (const location of mappedLocations) {
  const coord = unpack(location.coord);
  const mapName = `m${coord.mapX}_${coord.mapZ}.jm2`;
  let source = mapSources.get(mapName);
  if (source === undefined) {
    source = readFileSync(path.join(contentRoot, 'maps', mapName), 'utf8');
    mapSources.set(mapName, source);
  }
  const locId = id('LocType', location.name);
  assert(source.includes(`${coord.level} ${coord.localX} ${coord.localZ}: ${locId} 10`), `${location.name} is the original packed map placement`);
  const target = World.getLoc(coord.x, coord.z, coord.level, locId);
  assert(target, `${location.name} exists in the loaded world at ${location.coord}`);
  locEntities.set(locationKey(location), target);
}

const isNoPathAssertion = error => error?.name === 'AssertionError' &&
  (error.message.startsWith('fixed tile ') || error.message.startsWith('no native footpath from 20 tiles away'));
const approachOffsets = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
function findApproach(location, required = true) {
  const coord = unpack(location.coord);
  for (const [dx, dz] of approachOffsets) {
    const x = coord.x + dx, z = coord.z + dz;
    if (!map.isZoneAllocated(coord.level, x, z) || map.isMapBlocked(x, z, coord.level)) continue;
    try {
      proveFootpath(x, z, coord.level);
      return { level: coord.level, x, z };
    } catch (error) {
      if (!isNoPathAssertion(error)) throw error;
    }
  }
  if (required) assert.fail(`no >=20-tile packed footpath to an interaction tile at ${location.name} ${location.coord}`);
  return null;
}

const approaches = new Map();
const actionRows = [...rockyStepsRows, ...iceEntryRows, ...centralToDeepRows, ...deepLadderRows, ...kingsRoomLadderRows];
for (const row of actionRows) {
  const location = mappedLocations.find(candidate => locationKey(candidate) === locationKey(row.from));
  assert(location, `${row.from.name} action maps to a packed placement`);
  if (!approaches.has(locationKey(location))) approaches.set(locationKey(location), findApproach(location));
}
const upperSupportApproach = findApproach(traversalLocs.supportLadderUp, false);
console.log(upperSupportApproach
  ? 'INFO support-room p1 ladder has a >=20-tile reachable adjacent component; it remains placement-only without a source-backed route edge'
  : 'INFO support-room p1 ladder has no >=20-tile reachable adjacent component; it is not a player landing');

const optionTriggers = [ServerTriggerType.OPLOC1, ServerTriggerType.OPLOC2, ServerTriggerType.OPLOC3];
function useRouteOption(p, row, approachOverride = null) {
  const { from, landing } = row;
  const fromId = id('LocType', from.name);
  const locType = types.LocType.get(fromId);
  const optionIndex = locType.op.findIndex(option => String(option).toLowerCase() === from.option.toLowerCase());
  assert(optionIndex >= 0 && optionIndex < optionTriggers.length, `${from.name} exposes ${from.option}`);
  const dispatch = ScriptProvider.getByTrigger(optionTriggers[optionIndex], fromId, locType.category);
  assert(dispatch, `${from.name} ${from.option} has a registered player handler`);
  const target = locEntities.get(locationKey(from));
  const approach = approachOverride ?? approaches.get(locationKey(from));
  assert(target && approach, `${from.name} has its packed target and walkable interaction tile`);
  if (approachOverride) {
    assert.deepEqual(tile(p), [approach.level, approach.x, approach.z], `${from.name} was reached by its native walking leg`);
  } else {
    p.teleport(approach.x, approach.z, approach.level);
  }
  execute(dispatch.name, p, [], { target });

  const [actualLevel, actualX, actualZ] = tile(p);
  assert.equal(actualLevel, landing.level, `${from.name} lands on the expected floor`);
  assert(Math.max(Math.abs(actualX - landing.x), Math.abs(actualZ - landing.z)) <= 1,
    `${from.name} lands on or beside its packed destination`);
  proveFootpath(actualX, actualZ, actualLevel);
  console.log(`PASS ${from.name} ${from.option} -> ${actualX},${actualZ},${actualLevel}`);
}
function chooseCentralLadder(selection, landing) {
  const from = centralToDeepRows[0].from;
  const fromId = id('LocType', from.name);
  const locType = types.LocType.get(fromId);
  const dispatch = ScriptProvider.getByTrigger(ServerTriggerType.OPLOC1, fromId, locType.category);
  const target = locEntities.get(locationKey(from));
  const approach = approaches.get(locationKey(from));
  assert(dispatch && target && approach, 'central Climb choice has its packed handler and approach');
  const p = player();
  p.teleport(approach.x, approach.z, approach.level);
  execute(dispatch.name, p, [], { allowPause: true, target });
  resumeDialogue(p, selection);
  settle(p);
  const [actualLevel, actualX, actualZ] = tile(p);
  assert.equal(actualLevel, landing.level, `central Climb choice ${selection} reaches the expected floor`);
  assert(Math.max(Math.abs(actualX - landing.x), Math.abs(actualZ - landing.z)) <= 1,
    `central Climb choice ${selection} lands on or beside its packed destination`);
  proveFootpath(actualX, actualZ, actualLevel);
  console.log(`PASS central Climb choice ${selection} -> ${actualX},${actualZ},${actualLevel}`);
}

chooseCentralLadder(1, iceEntryRows[1].landing);
chooseCentralLadder(2, centralToDeepRows[0].landing);


function walkToOperationRange(start, destination) {
  const [level, startX, startZ] = start;
  assert.equal(level, destination.level, `${destination.name} is reached by walking on the same floor`);
  for (const [dx, dz] of approachOffsets) {
    const x = destination.x + dx, z = destination.z + dz;
    if (!map.isZoneAllocated(level, x, z) || map.isMapBlocked(x, z, level)) continue;
    if (startX === x && startZ === z) return { level, x, z };
    const route = map.findPath(level, startX, startZ, x, z);
    const last = route.at(-1);
    if (last === undefined || ((last >>> 14) & 0x3fff) !== x || (last & 0x3fff) !== z) continue;

    let px = startX, pz = startZ;
    for (const packed of route) {
      const tx = (packed >>> 14) & 0x3fff, tz = packed & 0x3fff;
      while (px !== tx || pz !== tz) {
        const stepX = Math.sign(tx - px), stepZ = Math.sign(tz - pz);
        assert(map.canTravel(level, px, pz, stepX, stepZ, 1, 0, CollisionType.NORMAL),
          `${destination.name} walking leg obeys native packed collision`);
        px += stepX;
        pz += stepZ;
      }
    }
    assert.equal(px, x);
    assert.equal(pz, z);
    return { level, x, z };
  }
  assert.fail(`native packed path from ${startX},${startZ},${level} cannot reach operation range of ${destination.name} at ${destination.x},${destination.z}`);
}

const p = player();
for (const row of rockyStepsRows) useRouteOption(p, row);
for (const row of centralToDeepRows) useRouteOption(p, row);
useRouteOption(p, iceEntryRows[1]);
useRouteOption(p, iceEntryRows[0]);
for (const row of deepLadderRows) useRouteOption(p, row);
for (const row of kingsRoomLadderRows) useRouteOption(p, row);

const kingsRoute = findKingsRoute({ World, types, map });
assert(kingsRoute?.length, 'packed collision connects the central deep entry to the Kings ladder');
assert.equal(kingsRoute.at(-1), kingsRoomLadderRows[0], 'the connected route ends with the Kings-room descent');
assert(kingsRoute.length <= deepLadderRows.length + 1, 'the route uses no more than the complete directed ladder network');
useRouteOption(p, centralToDeepRows[0]);
for (const row of kingsRoute) {
  const approach = walkToOperationRange(tile(p), row.from);
  p.teleport(approach.x, approach.z, approach.level);
  useRouteOption(p, row, approach);
}
console.log(`PASS continuous central-to-Kings route: ${kingsRoute.map(row => row.from.name).join(' -> ')}`);

// Native world workers keep the harness process alive after its assertions.
process.exit(0);
