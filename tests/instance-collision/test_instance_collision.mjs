import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { World, contentRoot, engineModule, map, CollisionType } from '../swamp-caves/runtime.mjs';

const routeFinder = (await engineModule('engine/routefinder/index.ts')).default;
const { CollisionFlag: F } = await engineModule('engine/routefinder/flags.ts');
const InstanceZone = (await engineModule('engine/zone/InstanceZone.ts')).default;
const flags = routeFinder.collisionFlags;
const occupancy = F.NPC_OCC | F.PLAYER_OCC | F.BLOCK_NPC_AND_PLAYERS;
const directions = [
  [-1, 1, F.WALL_NORTH_WEST, F.WALL_NORTH_WEST_PROJ_BLOCKER],
  [0, 1, F.WALL_NORTH, F.WALL_NORTH_PROJ_BLOCKER],
  [1, 1, F.WALL_NORTH_EAST, F.WALL_NORTH_EAST_PROJ_BLOCKER],
  [1, 0, F.WALL_EAST, F.WALL_EAST_PROJ_BLOCKER],
  [1, -1, F.WALL_SOUTH_EAST, F.WALL_SOUTH_EAST_PROJ_BLOCKER],
  [0, -1, F.WALL_SOUTH, F.WALL_SOUTH_PROJ_BLOCKER],
  [-1, -1, F.WALL_SOUTH_WEST, F.WALL_SOUTH_WEST_PROJ_BLOCKER],
  [-1, 0, F.WALL_WEST, F.WALL_WEST_PROJ_BLOCKER]
];
const directional = directions.reduce((mask, [, , wall, projectile]) => mask | wall | projectile, 0);
const rotateTile = (x, z, rotation) => [[x, z], [7 - z, x], [7 - x, 7 - z], [z, 7 - x]][rotation];
function rotateFlags(value, rotation) {
  let result = value & ~directional & ~occupancy;
  for (let i = 0; i < directions.length; i++) {
    for (const bit of [2, 3]) if (value & directions[i][bit]) result |= directions[(i + rotation * 2) % 8][bit];
  }
  return result >>> 0;
}

// Select real packed zones by property, not by generated IDs or quest coordinates.
const selected = {};
for (const filename of readdirSync(path.join(contentRoot, 'maps')).sort()) {
  const match = /^m(\d+)_(\d+)\.jm2$/.exec(filename);
  if (!match) continue;
  const [, mx, mz] = match.map(Number);
  for (let level = 0; level < 4; level++) for (let east = 0; east < 8; east++) for (let north = 0; north < 8; north++) {
    const source = { level, x: mx * 64 + east * 8, z: mz * 64 + north * 8 };
    const collision = flags.getZone(source.x, source.z, level);
    if (!collision) continue;
    const zone = World.gameMap.getZoneIfExists(source.x, source.z, level);
    if (!zone && collision.every(value => value === F.OPEN)) selected.empty ??= source;
    const floor = collision.findIndex((value, index) => (value & F.FLOOR) && (index & 7) > 0 && (index & 7) < 7 && (index >> 3) > 0 && (index >> 3) < 7);
    if (floor === -1 || !expectedCopy(collision, 0, 24, 8).some((value, index) =>
      value !== F.OPEN && (index % 24 < 8 || index % 24 >= 16 || (index / 24 | 0) < 8 || (index / 24 | 0) >= 16))) continue;
    // Unit-size static locs keep this single-zone control independent of the separate
    // multi-tile loc-placement policy. Inactive locs still contribute store collision.
    if (zone && !selected.materialized && zone.totalLocs > 0 && [...zone.getAllLocsSafe()].every(loc => loc.width === 1 && loc.length === 1)) {
      selected.materialized = { ...source, floor };
    } else if (!zone && !selected.templateOnly) selected.templateOnly = { ...source, floor };
  }
  if (selected.empty && selected.materialized && selected.templateOnly) break;
}
for (const name of ['templateOnly', 'materialized', 'empty']) assert(selected[name], `packed map supplies a ${name} source by property`);
console.log('Selected real source zones:', JSON.stringify(selected));

function expectedCopy(sourceFlags, rotation, size, offset) {
  const expected = new Uint32Array(size * size);
  const add = (x, z, value) => {
    if (x >= 0 && x < size && z >= 0 && z < size) expected[x + z * size] |= value;
  };
  for (let i = 0; i < 64; i++) {
    const [x, z] = rotateTile(i & 7, i >> 3, rotation);
    const value = rotateFlags(sourceFlags[i], rotation);
    add(offset + x, offset + z, value);
    // Mirror only outbound edge walls, as a neighbor zone was not assigned.
    for (let d = 0; d < directions.length; d++) {
      const [dx, dz] = directions[d];
      const outward = (dx === 0 || (dx < 0 ? x === 0 : x === 7)) && (dz === 0 || (dz < 0 ? z === 0 : z === 7));
      if (!outward) continue;
      for (const bit of [2, 3]) if (value & directions[d][bit]) add(offset + x + dx, offset + z + dz, directions[(d + 4) % 8][bit]);
    }
  }
  return expected;
}
function assertFootprint(sw, size, expected, label) {
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const zone = flags.getZone(sw.x + x, sw.z + z, sw.level);
    const actual = zone ? flags.get(sw.x + x, sw.z + z, sw.level) : F.OPEN;
    assert.equal(actual >>> 0, expected[x + z * size] >>> 0, `${label} tile ${x},${z}: every static flag, no occupancy or stale flags`);
  }
}
function destroy(sw, size) {
  World.instances.playerEntered(sw);
  World.instances.playerLeft(sw);
  assert.equal(World.instances.findInstanceByCoord(sw), null, 'normal empty-region leave destroys the region');
  for (let z = 0; z < size; z += 8) for (let x = 0; x < size; x += 8) {
    assert.equal(World.gameMap.getZoneIfExists(sw.x + x, sw.z + z, sw.level), null, 'teardown removes assigned and mirror-only World zones');
    assert.equal(flags.getZone(sw.x + x, sw.z + z, sw.level), undefined, 'teardown deallocates collision, including mirror-only neighbors');
  }
}

for (const name of ['templateOnly', 'materialized']) {
  const source = selected[name];
  const original = flags.getZone(source.x, source.z, source.level).slice();
  try {
    // Disclosed transient-occupancy seed only. Static map flags remain unchanged.
    routeFinder.changeNpc(source.x, source.z, source.level, 1, true);
    routeFinder.changePlayerOcc(source.x, source.z, source.level, 1, true);
    routeFinder.changeBlock(source.x, source.z, source.level, 1, true);
    assert.equal(Boolean(World.gameMap.getZoneIfExists(source.x, source.z, source.level)), name === 'materialized', 'collision seeding does not materialize the source World zone');
    for (let rotation = 0; rotation < 4; rotation++) {
      const sw = World.instances.createInstance(1, 3, 3);
      const uid = World.instances.findInstanceByCoord(sw).uid;
      try {
        World.instances.copyZone(sw, { level: 0, x: 1, z: 1 }, source, rotation);
        const zone = World.gameMap.getZoneIfExists(sw.x + 8, sw.z + 8, sw.level);
        assert(zone instanceof InstanceZone && zone.hasAssignedTemplate, 'both source kinds assign a real instance template');
        assert.deepEqual(zone.source, { level: source.level, x: source.x >> 3, z: source.z >> 3 });
        assert.equal(zone.rotation, rotation);
        const expected = expectedCopy(original, rotation, 24, 8);
        assertFootprint(sw, 24, expected, `${name} rotation ${rotation}`);
        const [floorX, floorZ] = rotateTile(source.floor & 7, source.floor >> 3, rotation);
        assert.equal(map.canTravel(sw.level, sw.x + 8 + floorX - 1, sw.z + 8 + floorZ, 1, 0, 1, 0, CollisionType.NORMAL), false, 'production movement validator refuses stepping onto the copied blocked floor');
        assert.throws(() => World.instances.copyZone(sw, { level: 0, x: 1, z: 1 }, selected.empty, (rotation + 1) % 4), /already been copied/, 'region_set cannot replace an already assigned zone');
        assert.equal(zone.rotation, rotation, 'rejected reassignment preserves template rotation');
        assertFootprint(sw, 24, expected, 'rejected reassignment preserves all collision');
      } finally {
        destroy(sw, 24);
      }
      World.instances.nextInstancePointer = uid; // Disclosed allocator fixture: force the freed slot to be reused now.
      const reused = World.instances.createInstance(1, 1, 1);
      assert.deepEqual(reused, sw, 'a smaller region reuses the exact freed slot');
      try {
        World.instances.copyZone(reused, { level: 0, x: 0, z: 0 }, selected.empty, 0);
        assertFootprint(reused, 8, new Uint32Array(64), 'different source has exactly its own open flags');
        for (let z = 0; z < 24; z += 8) for (let x = 0; x < 24; x += 8) {
          if (x === 0 && z === 0) continue;
          assert.equal(flags.getZone(sw.x + x, sw.z + z, sw.level), undefined, 'smaller reused region inherits no collision outside its footprint');
        }
      } finally {
        destroy(reused, 8);
      }
    }
  } finally {
    flags.setZone(source.x, source.z, source.level, original);
  }
}
console.log('PASS instance collision: real template-only and materialized sources, four rotations, static flags, occupancy masking, edge mirrors, movement, duplicate assignment, teardown and smaller-slot reuse');
process.exit(0);
