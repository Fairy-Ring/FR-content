import assert from 'node:assert/strict';
import { map, CollisionType } from '../swamp-caves/runtime.mjs';

// Select a start from the real packed floor, never from a hand-authored walkable
// grid. Native routefinding must reach the exact goal from at least 20 tiles
// away, and every expanded walking step must pass native collision.
export function proveFootpath(x, z, level = 0) {
  assert.equal(map.isMapBlocked(x, z, level), false, `fixed tile ${x},${z},${level} is not blocked`);
  for (let distance = 20; distance <= 40; distance++) {
    for (let offset = -distance; offset <= distance; offset++) {
      for (const [sx, sz] of [[x + offset, z - distance], [x + offset, z + distance], [x - distance, z + offset], [x + distance, z + offset]]) {
        if (!map.isZoneAllocated(level, sx, sz) || map.isMapBlocked(sx, sz, level)) continue;
        const route = map.findPath(level, sx, sz, x, z);
        const last = route.at(-1);
        if (last === undefined || ((last >>> 14) & 0x3fff) !== x || (last & 0x3fff) !== z) continue;
        let px = sx, pz = sz, steps = 0;
        for (const packed of route) {
          const tx = (packed >>> 14) & 0x3fff, tz = packed & 0x3fff;
          while (px !== tx || pz !== tz) {
            const dx = Math.sign(tx - px), dz = Math.sign(tz - pz);
            assert(map.canTravel(level, px, pz, dx, dz, 1, 0, CollisionType.NORMAL), 'every native pathfinder step obeys packed collision');
            px += dx; pz += dz; steps++;
          }
        }
        assert(steps >= 20);
        console.log(`PASS packed footpath ${sx},${sz},${level} -> ${x},${z},${level}: ${steps} walking steps`);
        return;
      }
    }
  }
  assert.fail(`no native footpath from 20 tiles away to fixed tile ${x},${z},${level}`);
}
