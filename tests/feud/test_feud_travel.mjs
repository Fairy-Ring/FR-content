import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { finish } from './fixture.mjs';
import {
  CollisionType, ScriptState, World, contentRoot, engineModule, id, map, player, tile, types
} from '../swamp-caves/runtime.mjs';

const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const { default: OpLoc } = await engineModule('network/game/client/model/OpLoc.ts');
const { default: OpLocHandler } = await engineModule('network/game/client/handler/OpLocHandler.ts');
const locActionHandler = new OpLocHandler();
const regionX = 52, regionZ = 46;
const tileKey = (level, x, z) => `${level}:${x}:${z}`;
const typeNames = new Map(readFileSync(path.join(contentRoot, 'pack/loc.pack'), 'utf8').trim().split('\n').map(line => {
  const split = line.indexOf('=');
  return [Number(line.slice(0, split)), line.slice(split + 1)];
}));

function readMap(file) {
  const match = /^m(\d+)_(\d+)\.jm2$/.exec(file);
  assert(match, `map filename ${file}`);
  const mapX = Number(match[1]), mapZ = Number(match[2]);
  let section = '';
  const rows = [], floors = new Set();
  for (const line of readFileSync(path.join(contentRoot, 'maps', file), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) {
      section = line.slice(5).split(' ')[0];
      continue;
    }
    const row = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
    if (!row) continue;
    const level = Number(row[1]), localX = Number(row[2]), localZ = Number(row[3]);
    const x = mapX * 64 + localX, z = mapZ * 64 + localZ;
    if (section === 'MAP' && /(?:^| )(?:u\d+|o-?\d+)(?:[; ]|$)/.test(row[4])) {
      floors.add(tileKey(level, x, z));
    }
    if (section !== 'LOC') continue;
    const [cacheId, shape = 10, angle = 0] = row[4].split(' ').map(Number);
    rows.push({
      name: typeNames.get(cacheId), level, localX, localZ, x, z, shape, angle,
      coord: `${level}_${mapX}_${mapZ}_${localX}_${localZ}`
    });
  }
  return { rows, floors };
}

const region = readMap('m52_46.jm2');
const feudNames = new Set([
  'feud_ladder', 'feud_laddertop_norim',
  'feud_outsidestairs_base', 'feud_outsidestairs_top',
  'feud_insidestairs_base', 'feud_insidestairs_top'
]);
const feudRows = region.rows.filter(row => feudNames.has(row.name));
const sourceRows = rows => rows.map(({ name, level, localX, localZ, shape, angle }) => ({
  name, level, localX, localZ, shape, angle
})).sort((a, b) => `${a.name}@${a.level}:${a.localX}:${a.localZ}`.localeCompare(`${b.name}@${b.level}:${b.localX}:${b.localZ}`));
const expectedMapRows = [
  { name: 'feud_ladder', level: 0, localX: 22, localZ: 19, shape: 10, angle: 1 },
  { name: 'feud_ladder', level: 0, localX: 36, localZ: 59, shape: 10, angle: 0 },
  { name: 'feud_ladder', level: 0, localX: 41, localZ: 47, shape: 10, angle: 1 },
  { name: 'feud_ladder', level: 1, localX: 28, localZ: 37, shape: 10, angle: 2 },
  { name: 'feud_laddertop_norim', level: 1, localX: 22, localZ: 19, shape: 10, angle: 1 },
  { name: 'feud_laddertop_norim', level: 1, localX: 36, localZ: 59, shape: 10, angle: 0 },
  { name: 'feud_laddertop_norim', level: 1, localX: 41, localZ: 47, shape: 10, angle: 1 },
  { name: 'feud_laddertop_norim', level: 2, localX: 28, localZ: 37, shape: 10, angle: 2 },
  { name: 'feud_outsidestairs_base', level: 0, localX: 25, localZ: 14, shape: 10, angle: 0 },
  { name: 'feud_outsidestairs_top', level: 1, localX: 25, localZ: 14, shape: 10, angle: 0 },
  { name: 'feud_insidestairs_base', level: 0, localX: 45, localZ: 34, shape: 10, angle: 2 },
  { name: 'feud_insidestairs_top', level: 1, localX: 45, localZ: 34, shape: 10, angle: 2 }
];
assert.deepEqual(sourceRows(feudRows), sourceRows(expectedMapRows), 'the original Pollnivneach placement names, planes, footprints and angles are enumerated');
assert.equal(feudRows.filter(row => row.name === 'feud_ladder' || row.name === 'feud_laddertop_norim').length, 8, 'all eight original ladder ends are exercised');
for (const [name, length] of [
  ['feud_ladder', 1], ['feud_laddertop_norim', 1],
  ['feud_outsidestairs_base', 3], ['feud_outsidestairs_top', 3],
  ['feud_insidestairs_base', 2], ['feud_insidestairs_top', 2]
]) {
  const type = types.LocType.get(id('LocType', name));
  assert.equal(type.width, 1, `${name} keeps its cache width`);
  assert.equal(type.length, length, `${name} keeps its cache length`);
}

const at = (name, level, localX, localZ) => {
  const row = feudRows.find(entry => entry.name === name && entry.level === level && entry.localX === localX && entry.localZ === localZ);
  assert(row, `original map placement ${name}@${level}:${localX},${localZ}`);
  return row;
};
const point = (level, localX, localZ) => ({ level, x: regionX * 64 + localX, z: regionZ * 64 + localZ });
const ladderPairs = [
  {
    name: 'ladder 22,19 angle 1',
    lower: at('feud_ladder', 0, 22, 19), upper: at('feud_laddertop_norim', 1, 22, 19),
    up: point(1, 21, 19), down: point(0, 21, 19)
  },
  {
    name: 'ladder 36,59 angle 0',
    lower: at('feud_ladder', 0, 36, 59), upper: at('feud_laddertop_norim', 1, 36, 59),
    up: point(1, 36, 58), down: point(0, 36, 58)
  },
  {
    name: 'ladder 41,47 angle 1',
    lower: at('feud_ladder', 0, 41, 47), upper: at('feud_laddertop_norim', 1, 41, 47),
    up: point(1, 40, 47), down: point(0, 40, 47)
  },
  {
    name: 'ladder 28,37 angle 2',
    lower: at('feud_ladder', 1, 28, 37), upper: at('feud_laddertop_norim', 2, 28, 37),
    up: point(2, 28, 38), down: point(1, 28, 38)
  }
];
const stairPairs = [
  {
    name: 'outside stairs',
    lower: at('feud_outsidestairs_base', 0, 25, 14), upper: at('feud_outsidestairs_top', 1, 25, 14),
    up: point(1, 26, 14), down: point(0, 25, 17)
  },
  {
    name: 'mayor-house inside stairs',
    // The level-1 south-side lead is not the top's forced side: angle 2 turns forceapproach=west to east.
    lower: at('feud_insidestairs_base', 0, 45, 34), upper: at('feud_insidestairs_top', 1, 45, 34),
    up: point(1, 46, 34), down: point(0, 45, 33), insideFixture: true
  }
];

function locFor(row) {
  const typeId = id('LocType', row.name);
  const type = types.LocType.get(typeId);
  const loc = World.getLoc(row.x, row.z, row.level, typeId);
  assert(type && loc, `packed type and native placement ${row.name} ${row.coord}`);
  assert.equal(loc.angle, row.angle, `${row.name} uses its cache rotation`);
  return { typeId, type, loc };
}

function approachTiles(row, floors) {
  const { type, loc } = locFor(row);
  const rotated = row.angle % 2 === 1;
  const width = rotated ? type.length : type.width;
  const length = rotated ? type.width : type.length;
  const maxX = row.x + width - 1, maxZ = row.z + length - 1;
  const candidates = [];
  for (let x = row.x - 1; x <= maxX + 1; x++) for (let z = row.z - 1; z <= maxZ + 1; z++) {
    if (x >= row.x && x <= maxX && z >= row.z && z <= maxZ) continue;
    const distance = Math.max(row.x - x, x - maxX, row.z - z, z - maxZ);
    if (distance !== 1 || !floors.has(tileKey(row.level, x, z)) || map.isMapBlocked(x, z, row.level)) continue;
    if (!map.reachedLoc(row.level, x, z, row.x, row.z, type.width, type.length, 1, loc.angle, row.shape, type.forceapproach)) continue;
    candidates.push({ level: row.level, x, z });
  }
  return candidates.sort((a, b) => Math.abs(a.x - row.x) + Math.abs(a.z - row.z) - Math.abs(b.x - row.x) - Math.abs(b.z - row.z) || a.x - b.x || a.z - b.z);
}

function nativePath(start, destination, floors) {
  if (start.level !== destination.level || !floors.has(tileKey(start.level, start.x, start.z)) || !floors.has(tileKey(destination.level, destination.x, destination.z))) return null;
  if (start.x === destination.x && start.z === destination.z) return { points: [], steps: 0 };
  const packed = [...map.findPath(start.level, start.x, start.z, destination.x, destination.z)];
  if (!packed.length) return null;
  const points = [];
  let x = start.x, z = start.z, steps = 0;
  for (const value of packed) {
    const target = CoordGrid.unpackCoord(value);
    points.push({ x: target.x, z: target.z });
    while (x !== target.x || z !== target.z) {
      const dx = Math.sign(target.x - x), dz = Math.sign(target.z - z);
      if (!map.canTravel(start.level, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) return null;
      x += dx; z += dz; steps++;
      if (!floors.has(tileKey(start.level, x, z))) return null;
    }
  }
  if (x !== destination.x || z !== destination.z) return null;
  return { points, steps };
}

function operationRoute(row, floors, from = null) {
  const stands = approachTiles(row, floors);
  assert(stands.length, `a normal player can stand in range of ${row.name} ${row.coord}`);
  if (from) {
    const paths = stands.map(stand => ({ stand, path: nativePath(from, stand, floors) })).filter(candidate => candidate.path)
      .sort((a, b) => a.path.steps - b.path.steps || a.stand.x - b.stand.x || a.stand.z - b.stand.z);
    assert(paths.length, `the landing pathfinds to ${row.name} ${row.coord}`);
    return { start: from, ...paths[0] };
  }

  // Test-only start-position search uses the existing stair-links five-tile approach bound.
  for (const stand of stands) for (let radius = 2; radius <= 5; radius++) {
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      const start = { level: stand.level, x: stand.x + dx, z: stand.z + dz };
      if (!floors.has(tileKey(start.level, start.x, start.z)) || map.isMapBlocked(start.x, start.z, start.level)) continue;
      const path = nativePath(start, stand, floors);
      if (path?.steps) return { start, stand, path };
    }
  }
  assert.fail(`the native pathfinder cannot reach an operation stand for ${row.name} ${row.coord}`);
}

function walkFixtureToStand(p, plan, floors) {
  p.level = plan.start.level; p.x = plan.start.x; p.z = plan.start.z;
  p.originX = p.x; p.originZ = p.z;
  for (const point of plan.path.points) {
    while (p.x !== point.x || p.z !== point.z) {
      const dx = Math.sign(point.x - p.x), dz = Math.sign(point.z - p.z);
      assert(map.canTravel(p.level, p.x, p.z, dx, dz, 1, 0, CollisionType.NORMAL), 'fixture follows only collision-valid native steps');
      p.x += dx; p.z += dz;
      assert(floors.has(tileKey(p.level, p.x, p.z)), 'fixture stays on the original map floor');
    }
  }
  assert.deepEqual(tile(p), [plan.stand.level, plan.stand.x, plan.stand.z]);
}

function dispatch(row, floors, from = null) {
  const plan = operationRoute(row, floors, from);
  const p = player();
  walkFixtureToStand(p, plan, floors);
  const { typeId, loc } = locFor(row);
  assert(p.inOperableDistance(loc), `the source stand is in native interaction range for ${row.name}`);
  p.clearInteraction();
  assert.equal(locActionHandler.handle(new OpLoc(1, row.x, row.z, typeId), p), true, 'production OPLOC packet handler accepts option 1');
  const trigger = p.getOpTrigger();
  assert.equal(trigger?.name, `[oploc1,${row.name}]`, 'production visible-form dispatch selects the exact loc handler');
  assert(p.inOperableDistance(loc), 'the selected loc is reachable from the normal pathfinder stand');
  p.processInteraction();
  finish(p);
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED, 'native travel script finishes');
  assert.equal(p.messages.some(message => /unhandled (?:stairs|ladder)/i.test(message)), false, `${row.name} never falls through to an unhandled travel path`);
  return { p, destination: tile(p), trigger: trigger.name };
}

function verifyLanding(pairName, destination, counterpart, floors) {
  assert.equal(destination[0], counterpart.level, `${pairName}: landing is on the paired floor`);
  assert(floors.has(tileKey(destination[0], destination[1], destination[2])), `${pairName}: landing is an original 377 floor tile`);
  assert.equal(map.isMapBlocked(destination[1], destination[2], destination[0]), false, `${pairName}: landing is collision-passable`);
  const { type, loc } = locFor(counterpart);
  assert(map.reachedLoc(destination[0], destination[1], destination[2], counterpart.x, counterpart.z, type.width, type.length, 1, loc.angle, counterpart.shape, type.forceapproach), `${pairName}: landing is on the paired loc's forced-approach side`);
  const escaped = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]
    .some(([dx, dz]) => {
      const target = { level: destination[0], x: destination[1] + dx, z: destination[2] + dz };
      return nativePath({ level: destination[0], x: destination[1], z: destination[2] }, target, floors)?.steps === 1;
    });
  assert(escaped, `${pairName}: collision-aware pathfinding can leave the landing tile`);
}

function exercisePair(pair) {
  if (pair.insideFixture) {
    // Test-only own-position fixture begins inside the mayor's house to exercise these stairs.
    // It does not invoke or bypass the house door predicate; the parent whole-quest test proves entry.
    assert.equal(pair.lower.name, 'feud_insidestairs_base');
    assert.equal(pair.upper.name, 'feud_insidestairs_top');
  }
  const up = dispatch(pair.lower, region.floors);
  assert.deepEqual(up.destination, [pair.up.level, pair.up.x, pair.up.z], `${pair.name}: climb-up destination is exact`);
  verifyLanding(`${pair.name} up`, up.destination, pair.upper, region.floors);

  const down = dispatch(pair.upper, region.floors, pair.up);
  assert.deepEqual(down.destination, [pair.down.level, pair.down.x, pair.down.z], `${pair.name}: climb-down destination is exact`);
  verifyLanding(`${pair.name} down`, down.destination, pair.lower, region.floors);
  return { up, down };
}

for (const pair of [...ladderPairs, ...stairPairs]) exercisePair(pair);

// A generic cache ladder in the Lumbridge town region must retain the shared handler, not Feud travel.
const otherRegion = readMap('m50_50.jm2');
const otherLadder = otherRegion.rows.find(row => row.name === 'ladder' && row.level === 0 && row.localX === 29 && row.localZ === 13);
assert(otherLadder, 'original Lumbridge generic ladder placement outside Pollnivneach');
const otherResult = dispatch(otherLadder, otherRegion.floors);
assert.equal(otherResult.trigger, '[oploc1,ladder]', 'another region keeps the shared exact-type ladder handler');
assert.deepEqual(otherResult.destination, [otherLadder.level + 1, otherLadder.x, otherLadder.z], 'the generic ladder is not captured by Feud destinations');

console.log(`RESULT PASS feud-travel: ${ladderPairs.length} original ladder pairs and ${stairPairs.length} stair pairs round-tripped through native OPLOC dispatch; mayor-house interior position was a test fixture, not a door proof; other-region generic ladder stayed generic`);
