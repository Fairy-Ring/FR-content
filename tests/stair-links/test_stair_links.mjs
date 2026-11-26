/** From the sibling engine after npm run build: node --import tsx ../content/tests/stair-links/test_stair_links.mjs */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { approach, content, execute, locFor, map, reachable, CollisionType, types } from './runtime.mjs';

const manifest = JSON.parse(readFileSync(new URL('./placements.json', import.meta.url), 'utf8'));
const exceptions = JSON.parse(readFileSync(new URL('./inherited-exceptions.json', import.meta.url), 'utf8'));
const legacy = JSON.parse(readFileSync(new URL('./unplaced.json', import.meta.url), 'utf8'));
const key = r => `${r.name}@${r.coord}:${r.trigger}`;
const executionKey = r => `${key(r)}:${r.choice ?? 0}`;
function decode(coord) {
  const [level, mx, mz, lx, lz] = coord.split('_').map(Number);
  return [level, mx * 64 + lx, mz * 64 + lz];
}
function row(entry) {
  const [level, x, z] = decode(entry.coord);
  return { ...entry, level, x, z };
}
const handlers = [];
for (const file of ['stairs.rs2', 'ladders.rs2']) {
  const text = readFileSync(path.join(content, 'scripts/ladders+stairs/scripts', file), 'utf8');
  const headers = [...text.matchAll(/^\[(oploc[1-5]),([^\]]+)\].*$/gm)];
  for (const [index, header] of headers.entries()) {
    const block = text.slice(header.index + header[0].length, headers[index + 1]?.index ?? text.length);
    if ((block.includes('switch_coord') && (block.includes('@unhandled_stairs') || block.includes('unhandled ladder'))) || /if \(\$coord = [0-3]_\d+_\d+_\d+_\d+\) \{[\s\S]*?\} else \{\s*mes\("unhandled ladder/.test(block) || /^\s*~deal_stairs\((?:true|false)\);/m.test(block) || /^\s*~zogre_stairs;/m.test(block) || /^\s*~mep2_temple_(?:circle_)?stairs_(?:up|down);/m.test(block)) {
      handlers.push({ name: header[2], trigger: header[1] });
    }
  }
}
const sharedHandlerCount = handlers.length;
const feudStairNames = new Set([
  'feud_outsidestairs_base', 'feud_outsidestairs_top',
  'feud_insidestairs_base', 'feud_insidestairs_top'
]);
const feudTravel = readFileSync(path.join(content, 'scripts/quests/quest_feud/scripts/feud_travel.rs2'), 'utf8');
const feudHeaders = [...feudTravel.matchAll(/^\[(oploc[1-5]),([^\]]+)\].*$/gm)];
for (const [index, header] of feudHeaders.entries()) {
  const block = feudTravel.slice(header.index + header[0].length, feudHeaders[index + 1]?.index ?? feudTravel.length);
  if (feudStairNames.has(header[2]) && block.includes('switch_coord') && block.includes('@unhandled_stairs')) {
    handlers.push({ name: header[2], trigger: header[1] });
  }
}
assert.equal(handlers.length - sharedHandlerCount, feudStairNames.size, 'all four newly covered Feud stairs have quest travel handlers');
assert.deepEqual(handlers.slice(sharedHandlerCount).map(handler => handler.name).sort(), [...feudStairNames].sort(),
  'each newly covered Feud stair handler is accounted exactly once');
assert.equal(handlers.length, 134, 'every coordinate-dispatched fallback handler is inventoried');
// The four Feud fallbacks did not move players in the starting build. Their new
// map-paired routes are not inherited gameplay; all unrelated parity stays below.
assert.equal(sharedHandlerCount, handlers.length - feudStairNames.size, 'the unrelated shared handlers remain separately accounted');
assert.deepEqual(manifest.filter(entry => feudStairNames.has(entry.name)).map(entry => entry.name).sort(),
  [...feudStairNames].sort(), 'the four newly covered Feud placements are each enumerated once');
assert.ok(manifest.filter(entry => feudStairNames.has(entry.name)).every(entry => entry.status === 'new'),
  'new Feud routes cannot be classified as inherited parity');
const native = [];
const floors = new Set();
const locs = [];
const pack = new Map(readFileSync(path.join(content, 'pack/loc.pack'), 'utf8').trim().split('\n').map(line => { const split = line.indexOf('='); return [Number(line.slice(0, split)), line.slice(split + 1)]; }));
for (const name of readdirSync(path.join(content, 'maps')).filter(n => /^m\d+_\d+\.jm2$/.test(n)).sort()) {
  const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(name).map(Number);
  let section = '';
  for (const line of readFileSync(path.join(content, 'maps', name), 'utf8').split('\n')) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    const match = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
    if (!match) continue;
    const [level, x, z] = [Number(match[1]), mx * 64 + Number(match[2]), mz * 64 + Number(match[3])];
    if (section === 'MAP' && /(?:^| )(?:u\d+|o-?\d+)(?:[; ]|$)/.test(match[4])) floors.add(`${level},${x},${z}`);
    if (section !== 'LOC') continue;
    const [id, shape = 10, angle = 0] = match[4].split(' ').map(Number);
    const loc = { name: pack.get(id), level, x, z, shape, angle, coord: `${level}_${mx}_${mz}_${x & 63}_${z & 63}` };
    locs.push(loc);
    for (const handler of handlers.filter(h => h.name === loc.name)) native.push({ ...loc, trigger: handler.trigger });
  }
}
assert.equal(new Set(native.map(r => `${r.name}@${r.coord}`)).size, 397, 'all native placements, not just examples');
assert.equal(native.length, 427, 'all native operations');
assert.deepEqual([...new Set(manifest.map(key))].sort(), native.map(key).sort(), 'every native operation has an explicit linked or untouched-fallback expectation');
assert.equal(new Set(manifest.map(executionKey)).size, manifest.length, 'choice expectations are unique');
assert.deepEqual(legacy.map(r => `${r.trigger}:${r.name}`).sort(), handlers.filter(h => !native.some(r => r.name === h.name)).map(h => `${h.trigger}:${h.name}`).sort(), 'unplaced legacy triggers stay explicitly named');
const regionExceptions = new Map(exceptions.regionsAndLevels.map(r => [executionKey(r), r]));
const collisionExceptions = new Map(exceptions.blockedOrFloorless.map(r => [executionKey(r), r]));
assert.equal(regionExceptions.size, exceptions.regionsAndLevels.length);
assert.equal(regionExceptions.size, 30, 'exact inherited remote-region and non-adjacent-level exceptions');
assert.equal(collisionExceptions.size, 2, 'exactly the two inherited Fenkenstrain up landings');
for (const [list, classification] of [[regionExceptions, 'inherited link to another region or a non-adjacent level'], [collisionExceptions, 'inherited landing that the collision data calls blocked or floorless']]) {
  for (const [id, exception] of list) {
    assert.equal(exception.class, classification);
    const entry = manifest.find(r => executionKey(r) === id);
    assert.equal(entry?.status, 'inherited', 'new cases may not use inherited exceptions');
    assert.deepEqual({ destination: entry.destination, destinationBounds: entry.destinationBounds }, { destination: exception.destination, destinationBounds: exception.destinationBounds });
  }
}
function routeEnd(start, accepts) {
  const pending = [start];
  const visited = new Set([start.join(',')]);
  for (let i = 0; i < pending.length; i++) {
    const t = pending[i];
    if (accepts(t)) return t;
    for (const [dx, dz] of [[-1, 0], [0, -1], [1, 0], [0, 1]]) {
      const next = [t[0], t[1] + dx, t[2] + dz];
      if (Math.max(Math.abs(next[1] - start[1]), Math.abs(next[2] - start[2])) > 10 || visited.has(next.join(',')) || !floors.has(next.join(','))) continue;
      if (!map.canTravel(t[0], t[1], t[2], dx, dz, 1, 0, CollisionType.NORMAL)) continue;
      visited.add(next.join(',')); pending.push(next);
    }
  }
  return null;
}
const fallback = messages => messages.some(m => /unhandled (?:stairs|ladder)/i.test(m));
function walkable(destination) {
  const [level, x, z] = destination;
  assert.equal(map.isMapBlocked(x, z, level), false, 'engine-loaded collision leaves the landing walkable');
  assert.ok(floors.has(destination.join(',')), 'the landing has a 377 floor');
}
// Native Jiggig flights connect levels 0 and 2, unlike the adjacent-level stairs.
const jiggigLinks = new Map([
  ['ogre_stairs_down:0_38_47_53_34:0', { destination: [2, 2478, 9436], counterpart: { name: 'ogre_stairs', coord: '2_38_147_46_29', angle: 1 } }],
  ['ogre_stairs:2_38_147_46_29:1', { destination: [0, 2485, 3045], counterpart: { name: 'ogre_stairs_down', coord: '0_38_47_53_34', angle: 0 } }],
  ['ogre_stairs_down:2_38_147_11_9:1', { destination: [0, 2443, 9416], counterpart: { name: 'ogre_stairs', coord: '0_38_147_11_9', angle: 1 } }],
  ['ogre_stairs:0_38_147_11_9:1', { destination: [2, 2443, 9420], counterpart: { name: 'ogre_stairs_down', coord: '2_38_147_11_9', angle: 1 } }]
]);
// The native factory and cellar stairs connect two level-zero map regions.
const blastFurnaceLinks = new Map([
  ['blast_furnace_stairs_up:0_30_77_19_28:2', { destination: [0, 2931, 10195], counterpart: { name: 'dwarf_keldagrim_factory_stairs', coord: '0_45_159_50_20', angle: 1 } }],
  ['dwarf_keldagrim_factory_stairs:0_45_159_50_20:1', { destination: [0, 1939, 4958], counterpart: { name: 'blast_furnace_stairs_up', coord: '0_30_77_19_28', angle: 2 } }]
]);
// Original 377 walls and light block enclose this single-tile stair alcove.
// Its immediate return climb must provide the non-empty escape upstairs.
const returnOnlyAlcoves = new Set([
  'mourning_temple_stairs_top@2_29_72_37_50:oploc1:0'
]);
const failures = [];
const counts = { inherited: 0, new: 0, fallback: 0, roundTrips: 0 };
for (const entry of manifest) {
  try {
    const source = row(entry);
    locFor(source);
    if (!entry.inaccessibleApproach) {
      assert.equal(map.isMapBlocked(entry.start[1], entry.start[2], entry.start[0]), false, 'fixture is a walkable native approach');
      assert.ok(reachable(entry.start, source), 'fixture can perform the native operation');
    } else {
      assert.equal(entry.status, 'fallback', 'only an explicitly excluded inaccessible placement may be invoked without a reachable fixture');
      assert.ok(entry.reason);
    }
    const result = execute(source, entry.choice, entry.start);
    if (entry.destinationBounds) {
      assert.equal(result.destination[0], entry.destinationBounds.min[0], 'inherited random destination keeps its level');
      assert.equal(entry.destinationBounds.max[0], entry.destinationBounds.min[0]);
      for (const axis of [1, 2]) {
        assert.ok(Number.isInteger(result.destination[axis]) && result.destination[axis] >= entry.destinationBounds.min[axis] && result.destination[axis] <= entry.destinationBounds.max[axis], 'inherited random destination stays in its exact authored rectangle');
      }
    } else {
      assert.deepEqual(result.destination, entry.destination, 'packed destination is exact');
    }
    if (entry.status === 'fallback') {
      assert.ok(entry.reason, 'every retained fallback is named and classified');
      assert.ok(fallback(result.messages), 'untouched placement still reaches the real fallback');
      assert.deepEqual(result.destination, entry.start, 'fallback does not move the player');
    } else {
      assert.equal(fallback(result.messages), false, 'linked operation never prints the fallback');
      const region = regionExceptions.get(executionKey(entry));
      const collision = collisionExceptions.get(executionKey(entry));
      const jiggig = jiggigLinks.get(`${entry.name}:${entry.coord}:${entry.angle}`);
      const blastFurnace = blastFurnaceLinks.get(`${entry.name}:${entry.coord}:${entry.angle}`);
      if (entry.name === '100_dave_celler_stairs') {
        assert.deepEqual(result.destination, [0, 3077, 3492], 'Dave cellar stairs return beside the original surface trapdoor');
        assert.equal(entry.status, 'new', 'Dave link is not inherited parity');
        walkable(result.destination);
        const trapdoor = locs.find(r => r.name === '100_dave_celler_trapdoor' && r.coord === '0_48_54_5_37');
        assert.ok(trapdoor, 'original trapdoor is the surface counterpart');
        assert.ok(routeEnd(result.destination, t => reachable(t, trapdoor)), 'landing reaches the native trapdoor');
        const wrapper = types.LocType.get(types.LocType.getId(trapdoor.name));
        assert.equal(wrapper.multiloc[0], types.LocType.getId('100_dave_celler_trapdoor_closed'));
        assert.equal(wrapper.multiloc[1], types.LocType.getId('100_dave_celler_trapdoor_open'));
        // The S2 suite sends native visible-form Open/Go-down/Close operations.
        counts.new++;
        continue;
      }
      if (blastFurnace) {
        assert.deepEqual(result.destination, blastFurnace.destination, 'Blast Furnace has the exact packed landing and level');
        assert.deepEqual(entry.counterpart, blastFurnace.counterpart, 'Blast Furnace uses its exact native counterpart');
        assert.equal(result.destination[0], decode(blastFurnace.counterpart.coord)[0], 'Blast Furnace arrives on its native counterpart level');
      } else if (jiggig) {
        assert.deepEqual(result.destination, jiggig.destination, 'Jiggig has the exact packed landing and level');
        assert.deepEqual(entry.counterpart, jiggig.counterpart, 'Jiggig uses its exact native counterpart');
        assert.equal(result.destination[0], decode(jiggig.counterpart.coord)[0], 'Jiggig arrives on its native counterpart level');
      } else if (!region) assert.equal(Math.abs(result.destination[0] - source.level), 1, 'adjacent-level link');
      else assert.ok(Math.abs(result.destination[0] - source.level) !== 1 || (result.destination[1] >> 6) !== (source.x >> 6) || (result.destination[2] >> 6) !== (source.z >> 6), 'the named inherited region/level exception remains an exception');
      if (!collision) walkable(result.destination);
      else {
        assert.equal(map.isMapBlocked(result.destination[1], result.destination[2], result.destination[0]), true, 'inherited blocked Fenkenstrain landing is preserved');
        assert.equal(floors.has(result.destination.join(',')), false, 'inherited floorless Fenkenstrain landing is preserved');
      }
      if (entry.status === 'new') assert.ok(!region && !collision, 'new links have no exception');
      if (entry.counterpart) {
        const counterpart = locs.find(r => r.name === entry.counterpart.name && r.coord === entry.counterpart.coord && r.angle === entry.counterpart.angle);
        assert.ok(counterpart, 'matching counterpart is a verified native map placement');
        assert.equal(counterpart.level, result.destination[0]);
        const end = routeEnd(result.destination, t => reachable(t, counterpart));
        assert.ok(end, 'landing can reach its counterpart without crossing walls');
        const returnOnly = returnOnlyAlcoves.has(executionKey(entry));
        if (returnOnly) {
          assert.deepEqual(result.destination, [1, 1896, 4658], 'the original return-only alcove has its independently measured stand');
          assert.equal(counterpart.name, 'mourning_temple_stairs_base');
          assert.equal(counterpart.coord, '1_29_72_37_50');
          assert.ok(reachable(result.destination, counterpart), 'the return-only alcove can immediately operate its native staircase');
        } else {
          assert.ok(routeEnd(result.destination, t => Math.max(Math.abs(t[1] - result.destination[1]), Math.abs(t[2] - result.destination[2])) >= 2), 'landing is not enclosed');
        }
        const type = types.LocType.get(types.LocType.getId(counterpart.name));
        const returningDown = counterpart.level > source.level;
        const trigger = type.op[returningDown ? 2 : 1] ? `oploc${returningDown ? 3 : 2}` : 'oploc1';
        const returned = execute({ ...counterpart, trigger }, null, end);
        assert.equal(fallback(returned.messages), false, 'counterpart has a real return operation');
        assert.equal(returned.destination[0], source.level, 'round trip returns to the original level');
        walkable(returned.destination);
        assert.ok(routeEnd(returned.destination, t => reachable(t, source)), 'round trip returns to a tile from which the original staircase is reachable');
        if (returnOnly) {
          assert.ok(reachable(returned.destination, source), 'the native return climb immediately reaches the original upper staircase');
          assert.ok(routeEnd(returned.destination, t => Math.max(Math.abs(t[1] - returned.destination[1]), Math.abs(t[2] - returned.destination[2])) >= 2),
            'the return-only alcove has a non-empty walkable escape on its returned floor');
        }
        counts.roundTrips++;
      }
    }
    counts[entry.status]++;
  } catch (error) {
    failures.push({ key: executionKey(entry), message: error.stack ?? String(error) });
    console.error(`FAIL ${executionKey(entry)}: ${error.message}`);
  }
}
console.log(`RESULT ${failures.length ? 'FAIL' : 'PASS'} stair-links: ${JSON.stringify(counts)}; ${failures.length} failed`);
if (failures.length && process.env.STAIR_LINK_FAILURES) {
  console.error(JSON.stringify(failures, null, 2));
}
process.exit(failures.length ? 1 : 0);
