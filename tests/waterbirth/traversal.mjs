import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { World, types, id, player, execute, ScriptProvider, ServerTriggerType, map, tile, CollisionType, contentRoot, startDialogue, resumeDialogue, settle } from '../swamp-caves/runtime.mjs';
import { openCentralRoom } from './support-route.mjs';
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

const actionRows = [...rockyStepsRows, ...iceEntryRows, ...centralToDeepRows, ...deepLadderRows, ...kingsRoomLadderRows];

const objectBounds = location => {
  const entity = locEntities.get(locationKey(location));
  const type = types.LocType.get(id('LocType', location.name));
  assert(entity && type, `${location.name} has its packed loc and type`);
  const angle = Number(entity.angle ?? 0);
  const rotated = Math.abs(angle) % 2 === 1;
  const width = Math.max(1, Number(type.width ?? 1));
  const length = Math.max(1, Number(type.length ?? 1));
  const footprintWidth = rotated ? length : width;
  const footprintLength = rotated ? width : length;
  return {
    entity, type, width, length, angle, shape: Number(entity.shape ?? -1),
    minX: location.x, maxX: location.x + footprintWidth - 1,
    minZ: location.z, maxZ: location.z + footprintLength - 1,
  };
};

const interactionTiles = location => {
  const bounds = objectBounds(location);
  const tiles = [];
  for (let x = bounds.minX - 1; x <= bounds.maxX + 1; x++) {
    for (let z = bounds.minZ - 1; z <= bounds.maxZ + 1; z++) {
      if (x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ) continue;
      const distance = Math.max(bounds.minX - x, x - bounds.maxX, bounds.minZ - z, z - bounds.maxZ);
      if (distance !== 1 || !map.isZoneAllocated(location.level, x, z) || map.isMapBlocked(x, z, location.level)) continue;
      if (!map.reachedLoc(
        location.level, x, z, location.x, location.z, bounds.width, bounds.length, 1,
        bounds.angle, bounds.shape, Number(bounds.type.forceapproach ?? 0),
      )) continue;
      tiles.push({ level: location.level, x, z });
    }
  }
  return tiles;
};

const nativePathToTile = (start, destination) => {
  if (start.level !== destination.level) return null;
  if (start.x === destination.x && start.z === destination.z) return { route: [], steps: 0 };
  const route = map.findPath(start.level, start.x, start.z, destination.x, destination.z);
  const last = route.at(-1);
  if (last === undefined || ((last >>> 14) & 0x3fff) !== destination.x || (last & 0x3fff) !== destination.z) return null;
  let x = start.x, z = start.z, steps = 0;
  for (const packed of route) {
    const targetX = (packed >>> 14) & 0x3fff, targetZ = packed & 0x3fff;
    while (x !== targetX || z !== targetZ) {
      const dx = Math.sign(targetX - x), dz = Math.sign(targetZ - z);
      if (!map.canTravel(start.level, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) return null;
      x += dx; z += dz; steps++;
    }
  }
  return { route, steps };
};

const pathToTile = (start, destination) => {
  const direct = nativePathToTile(start, destination);
  if (direct || start.level !== destination.level) return direct;
  // Native searches cover 128 tiles and emit at most 25 waypoints. For a
  // longer corridor, choose local walking goals from actual packed collision,
  // then require the unchanged native pathfinder to reach every goal exactly.
  const localStepBound = 24; // UNKNOWN engineering fixture bound, not a game rule.
  const key = (x, z) => (x << 14) | z;
  const startKey = key(start.x, start.z), goalKey = key(destination.x, destination.z);
  const queue = [startKey], parents = new Map([[startKey, null]]);
  for (let index = 0; index < queue.length && !parents.has(goalKey); index++) {
    const point = queue[index], x = (point >>> 14) & 0x3fff, z = point & 0x3fff;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      const nx = x + dx, nz = z + dz, next = key(nx, nz);
      if (parents.has(next) || !mapSources.has(`m${nx >> 6}_${nz >> 6}.jm2`) ||
          !map.isZoneAllocated(start.level, nx, nz) || map.isMapBlocked(nx, nz, start.level) ||
          !map.canTravel(start.level, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
      parents.set(next, point);
      queue.push(next);
    }
  }
  if (!parents.has(goalKey)) return null;
  const points = [];
  for (let point = goalKey; point !== null; point = parents.get(point)) points.push(point);
  points.reverse();
  const route = [];
  let from = start, steps = 0;
  for (let index = Math.min(localStepBound, points.length - 1); ; index = Math.min(index + localStepBound, points.length - 1)) {
    const point = points[index], to = { level: start.level, x: (point >>> 14) & 0x3fff, z: point & 0x3fff };
    const leg = nativePathToTile(from, to);
    if (!leg) return null;
    route.push(...leg.route);
    steps += leg.steps;
    if (index === points.length - 1) return { route, steps };
    from = to;
  }
};

function walkToOperationRange(actor, location, minimumSteps = 0) {
  const start = { level: actor.level, x: actor.x, z: actor.z };
  assert.equal(start.level, location.level, `${location.name} is reached by walking on its own floor`);
  const candidates = interactionTiles(location)
    .map(point => ({ point, path: pathToTile(start, point) }))
    .filter(candidate => candidate.path && candidate.path.steps >= minimumSteps)
    .sort((left, right) => left.path.steps - right.path.steps);
  assert(candidates.length, `native packed path from ${start.x},${start.z},${start.level} reaches ${location.name} operation range${minimumSteps ? ` in at least ${minimumSteps} steps` : ''}`);
  const { point, path } = candidates[0];

  for (const packed of path.route) {
    const targetX = (packed >>> 14) & 0x3fff, targetZ = packed & 0x3fff;
    while (actor.x !== targetX || actor.z !== targetZ) {
      const dx = Math.sign(targetX - actor.x), dz = Math.sign(targetZ - actor.z);
      assert(map.canTravel(actor.level, actor.x, actor.z, dx, dz, 1, 0, CollisionType.NORMAL),
        `${location.name} walking leg obeys packed collision`);
      actor.teleport(actor.x + dx, actor.z + dz, actor.level);
    }
  }
  assert.deepEqual(tile(actor), [point.level, point.x, point.z], `${location.name} reached an exact native operation tile`);
  console.log(`PASS packed walk ${start.x},${start.z},${start.level} -> ${location.name} operation range: ${path.steps} steps`);
  return { ...point, steps: path.steps };
}

const ring = (bounds, distance) => {
  const points = [];
  const minX = bounds.minX - distance, maxX = bounds.maxX + distance;
  const minZ = bounds.minZ - distance, maxZ = bounds.maxZ + distance;
  for (let x = minX; x <= maxX; x++) points.push({ x, z: minZ }, { x, z: maxZ });
  for (let z = minZ + 1; z < maxZ; z++) points.push({ x: minX, z }, { x: maxX, z });
  return points;
};

const farIslandStart = location => {
  const bounds = objectBounds(location);
  const targets = interactionTiles(location);
  for (let distance = 20; distance <= 40; distance++) {
    for (const start of ring(bounds, distance)) {
      if (!map.isZoneAllocated(location.level, start.x, start.z) || map.isMapBlocked(start.x, start.z, location.level)) continue;
      if (targets.some(target => pathToTile({ ...start, level: location.level }, target)?.steps >= 20)) {
        return { ...start, level: location.level };
      }
    }
  }
  assert.fail(`no island start at least 20 packed-collision steps from ${location.name}`);
};

const assertSafeLanding = (landing, label) => {
  assert(map.isZoneAllocated(landing.level, landing.x, landing.z), `${label} landing is in an allocated packed zone`);
  assert.equal(map.isMapBlocked(landing.x, landing.z, landing.level), false, `${label} exact landing is unblocked`);
};

const resolveHandler = row => {
  const fromId = id('LocType', row.from.name);
  const locType = types.LocType.get(fromId);
  const optionIndex = locType.op.findIndex(option => String(option).toLowerCase() === row.from.option.toLowerCase());
  assert(optionIndex >= 0 && optionIndex < 3, `${row.from.name} exposes ${row.from.option}`);
  const dispatch = ScriptProvider.getByTrigger(
    [ServerTriggerType.OPLOC1, ServerTriggerType.OPLOC2, ServerTriggerType.OPLOC3][optionIndex],
    fromId, locType.category,
  );
  const target = locEntities.get(locationKey(row.from));
  assert(dispatch && target, `${row.from.name} ${row.from.option} has its packed player handler and target`);
  return { dispatch, target };
};

for (const row of actionRows) {
  resolveHandler(row);
  assertSafeLanding(row.landing, `${row.from.name} ${row.from.option}`);
}
console.log('INFO support-room p1 ladder remains placement-only; the route starts with the western island entrance');
console.log('INFO dagexp_exit_ladder remains excluded: no source-backed paired destination is available');

function useRouteOption(actor, row, minimumSteps = 0) {
  const { from, landing, destination } = row;
  const { dispatch, target } = resolveHandler(row);
  walkToOperationRange(actor, from, minimumSteps);
  execute(dispatch.name, actor, [], { target });

  assert.deepEqual(tile(actor), [landing.level, landing.x, landing.z],
    `${from.name} ${from.option} lands exactly at safe ${destination.name}`);
  assertSafeLanding(landing, `${from.name} ${from.option}`);
  console.log(`PASS ${from.name} ${from.option} -> ${landing.x},${landing.z},${landing.level}`);
}

function chooseCentralLadder(actor, selection) {
  const from = centralToDeepRows[0].from;
  const fromId = id('LocType', from.name);
  const locType = types.LocType.get(fromId);
  const dispatch = ScriptProvider.getByTrigger(ServerTriggerType.OPLOC1, fromId, locType.category);
  const target = locEntities.get(locationKey(from));
  assert(dispatch && target, 'central Climb choice has its packed handler and loc');
  walkToOperationRange(actor, from);
  startDialogue(dispatch.name, actor, target);
  resumeDialogue(actor, selection);
  settle(actor);

  const row = selection === 1 ? iceEntryRows[1] : centralToDeepRows[0];
  assert.deepEqual(tile(actor), [row.landing.level, row.landing.x, row.landing.z],
    `central Climb choice ${selection} lands exactly at safe ${row.destination.name}`);
  assertSafeLanding(row.landing, `central Climb choice ${selection}`);
  console.log(`PASS central Climb choice ${selection} -> ${row.landing.x},${row.landing.z},${row.landing.level}`);
}

const sameEndpoint = (left, right) =>
  left.name === right.name && left.level === right.level && left.x === right.x && left.z === right.z;
const reverseOf = row => actionRows.find(candidate =>
  sameEndpoint(candidate.from, row.destination) && sameEndpoint(candidate.destination, row.from));

const p = player();
const islandStart = farIslandStart(rockyStepsRows[0].from);
p.teleport(islandStart.x, islandStart.z, islandStart.level);
useRouteOption(p, rockyStepsRows[0], 20);
// Check both western entrance directions before walking into the door puzzle.
useRouteOption(p, rockyStepsRows[1]);
useRouteOption(p, rockyStepsRows[0]);

// The compiled western entrance reaches the first room before the ordinary
// three-player support sequence opens its barriers.
openCentralRoom(p);
assert.deepEqual(tile(p), [0, 2544, 10143], 'the ordinary support route leaves main inside the first room');


// The island ice branch and central choice are later roundtrips, not the
// initial entrance used to open the first-room supports.
useRouteOption(p, iceEntryRows[1]);
useRouteOption(p, iceEntryRows[0]);
chooseCentralLadder(p, 1);
useRouteOption(p, iceEntryRows[0]);
chooseCentralLadder(p, 2);
useRouteOption(p, centralToDeepRows[1]);
useRouteOption(p, centralToDeepRows[0]);

// Cover every supplied deep traversal from the same island-started player.
// A reverse transition returns to the current connected walking component;
// no new player position is seeded for a small platform or side branch.
const exploredDeepRows = new Set();
function exploreDeepLadders() {
  for (const row of deepLadderRows) {
    if (exploredDeepRows.has(row) || p.level !== row.from.level) continue;
    const start = { level: p.level, x: p.x, z: p.z };
    if (!interactionTiles(row.from).some(goal => pathToTile(start, goal))) continue;
    const reverse = reverseOf(row);
    assert(reverse, `${row.from.name} has its supplied reverse traversal`);
    exploredDeepRows.add(row);
    exploredDeepRows.add(reverse);
    useRouteOption(p, row);
    exploreDeepLadders();
    useRouteOption(p, reverse);
  }
}
exploreDeepLadders();
assert.equal(exploredDeepRows.size, deepLadderRows.length,
  `every supplied deep ladder is reached from the island route; missing: ${deepLadderRows.filter(row => !exploredDeepRows.has(row)).map(row => row.from.name).join(', ')}`);

const kingsRoute = findKingsRoute({ World, types, map });
assert(kingsRoute?.length, 'packed collision connects the deep entrance to the Kings ladder after support destruction');
assert.equal(kingsRoute.at(-1), kingsRoomLadderRows[0], 'the connected route ends with the Kings-room descent');
assert(kingsRoute.length <= deepLadderRows.length + 1, 'the route uses no more than the complete directed ladder network');
for (const row of kingsRoute) {
  const reverse = reverseOf(row);
  assert(reverse, `${row.from.name} has a reverse handler on the route`);
  useRouteOption(p, row);
  useRouteOption(p, reverse);
  useRouteOption(p, row);
}
assert.deepEqual(tile(p), [
  kingsRoomLadderRows[0].landing.level, kingsRoomLadderRows[0].landing.x, kingsRoomLadderRows[0].landing.z,
], 'the route ends on the exact safe Kings-room landing');
console.log(`PASS multi-level island-to-Kings route from ${islandStart.x},${islandStart.z},${islandStart.level}; ladder legs: ${kingsRoute.map(row => row.from.name).join(' -> ')}`);

// Native world workers keep the harness process alive after its assertions.
process.exit(0);
