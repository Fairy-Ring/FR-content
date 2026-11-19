/** Compiled native seed-stall checks. Run from the sibling engine:
 * node --import tsx ../content/tests/farming/test_seed_stall.mjs
 * No script opcode, RNG method, catcher, map loc or reward is replaced.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, State, PlayerStat, JavaRandom, types, id, inv, player, proc, count, click, load } from './runtime.mjs';

const map = await load('engine/GameMap.ts');
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// CANDIDATE independent oracle: Old School Seed Stall revision 15328061,
// primary table only. All seventeen seeds existed in the 377 cache; Rocky did not.
const loot = [
  ['hammerstone_hop_seed', 120], ['potato_seed', 119], ['marigold_seed', 119],
  ['barley_seed', 118], ['onion_seed', 89], ['asgarnian_hop_seed', 83],
  ['cabbage_seed', 71], ['yanillian_hop_seed', 47], ['rosemary_seed', 36],
  ['nasturtium_seed', 35], ['tomato_seed', 35], ['jute_seed', 35],
  ['sweetcorn_seed', 30], ['krandorian_hop_seed', 24], ['strawberry_seed', 18],
  ['wildblood_hop_seed', 12], ['watermelon_seed', 9],
];
const row = types.DbRowType.getByName('stealing_seed_stall');
assert(row, 'missing packed seed-stall producer; build the changed content');
const stallId = id('LocType', 'seed_stall');
const emptyId = id('LocType', 'market');
const ownerId = id('NpcType', 'seed_merchant');
const guardId = id('NpcType', 'farming_market_guard');
const snapshot = p => Array.from({ length: types.InvType.get(inv).size }, (_, slot) => {
  const item = p.invGetSlot(inv, slot);
  return item ? [item.id, item.count] : null;
});
const stalls = [];
for (const filename of fs.readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name))) {
  const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(filename).map(Number);
  let section;
  for (const line of fs.readFileSync(path.join(content, 'maps', filename), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    if (section !== 'LOC') continue;
    const match = /^([0-3]) (\d+) (\d+): (\d+)(?: (\d+))?(?: (\d+))?$/.exec(line);
    if (!match || Number(match[4]) !== stallId) continue;
    const [level, x, z] = match.slice(1, 4).map(Number);
    const loc = World.getLoc(mx * 64 + x, mz * 64 + z, level, stallId);
    assert(loc, `original seed stall ${filename}:${line} is in the packed World`);
    stalls.push(loc);
  }
}
assert.equal(stalls.length, 4, 'all original-map seed-stall placements, including the duplicate map');

function approaches(loc) {
  const config = types.LocType.get(stallId);
  const points = [];
  for (let x = loc.x - 1; x <= loc.x + config.width; x++) {
    for (let z = loc.z - 1; z <= loc.z + config.length; z++) {
      if (!map.isMapBlocked(x, z, loc.level) && map.reachedLoc(loc.level, x, z,
        loc.x, loc.z, config.width, config.length, 1, loc.angle, loc.shape, config.forceapproach)) points.push({ x, z });
    }
  }
  return points;
}
function catchers(point, level) {
  return [...World.npcs].filter(npc => npc.isActive && npc.level === level &&
    (npc.type === ownerId || npc.type === guardId) &&
    Math.max(Math.abs(npc.x - point.x), Math.abs(npc.z - point.z)) <= 5 &&
    map.isLineOfSight(level, npc.x, npc.z, point.x, point.z));
}
function reachable(loc, point) {
  const config = types.LocType.get(stallId);
  for (const [dx, dz] of [[-8, 0], [8, 0], [0, -8], [0, 8]]) {
    const start = { x: point.x + dx, z: point.z + dz };
    if (map.isMapBlocked(start.x, start.z, loc.level)) continue;
    const route = map.findPathToLoc(loc.level, start.x, start.z, loc.x, loc.z,
      1, config.width, config.length, loc.angle, loc.shape, config.forceapproach);
    if (!route.length) continue;
    const end = route[route.length - 1];
    if (map.reachedLoc(loc.level, (end >>> 14) & 0x3fff, end & 0x3fff,
      loc.x, loc.z, config.width, config.length, 1, loc.angle, loc.shape, config.forceapproach) &&
      map.findPath(loc.level, start.x, start.z, point.x, point.z).length) return true;
  }
  return false;
}
function fixture(loc, level = 27, caught = false) {
  const point = approaches(loc).find(point => Boolean(catchers(point, loc.level).length) === caught && reachable(loc, point));
  assert(point, `${loc.x},${loc.z} has a reachable ${caught ? 'observed' : 'unobserved'} interaction side`);
  const p = player();
  p.x = point.x; p.z = point.z; p.level = loc.level;
  p.setLevel(PlayerStat.THIEVING, level);
  p.thievingStartXp = p.stats[PlayerStat.THIEVING];
  return p;
}
function execute(p, action) {
  World.playerLoop.add(BigInt(p.pid), p);
  try {
    assert(action(), 'the native OpLoc2 packet is accepted');
    for (let tick = 0; p.activeScript?.execution === State.SUSPENDED && tick < 4; tick++) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      World.processPlayers();
    }
    assert.notEqual(p.activeScript?.execution, State.SUSPENDED, 'bounded real scheduler resumes finish the one-shot attempt');
  } finally { p.unlink(); }
}
function restoreByTimer(loc) {
  assert.equal(loc.type, emptyId, 'successful theft uses the shared empty market loc');
  const duration = loc.lifecycleTick;
  assert(duration > 0);
  for (let tick = 1; tick <= duration; tick++) {
    World.currentTick++;
    World.processZones();
    assert.equal(loc.type, tick < duration ? emptyId : stallId, `shared lifecycle respawn at tick ${tick}/${duration}`);
  }
  assert.equal(World.getLoc(loc.x, loc.z, loc.level, stallId), loc, 'the original stall returns, not a new spawn');
}
// The published selector consumes a quantity draw and then a decreasing-range
// selection draw, working backwards. This independent oracle locates real RNG
// seeds for every outcome; the compiled selector executes each witness itself.
function expectedReward(seed) {
  JavaRandom.setSeed(seed);
  let denominator = 1000;
  for (let index = loot.length - 1; index >= 0; index--) {
    JavaRandom.nextDouble();
    const roll = Math.floor(JavaRandom.nextDouble() * denominator);
    denominator -= loot[index][1];
    if (roll >= denominator) return index;
  }
  assert.fail('a complete primary table must select one seed');
}
const witnesses = new Map();
for (let seed = 0; seed < 100000 && witnesses.size < loot.length; seed++) {
  const outcome = expectedReward(seed);
  if (!witnesses.has(outcome)) witnesses.set(outcome, seed);
}
assert.equal(witnesses.size, loot.length, 'native JavaRandom witnesses cover every primary loot row');
let cases = 0;
function test(name, action) { action(); cases++; console.log(`PASS ${name}`); }

test('period level/XP and complete candidate primary weights are packed unchanged', () => {
  assert.deepEqual(row.getValue(0, 0), [stallId]);
  assert.deepEqual(row.getValue(1, 0), [ownerId]);
  assert.deepEqual(row.getValue(2, 0), [guardId]);
  assert.deepEqual(row.getValue(3, 0), [27]);
  assert.deepEqual(row.getValue(4, 0), [100]);
  assert.deepEqual(row.getValue(5, 0), [15]);
  assert.deepEqual(row.getValue(7, 0), [1000]);
  assert.equal(row.columnValues[6].length, loot.length * 5, 'no omitted or added primary row');
  let remaining = 1000;
  let reachNumerator = 1n, reachDenominator = 1n;
  for (let index = loot.length - 1; index >= 0; index--) {
    const [name, weight] = loot[index];
    assert.deepEqual(row.getValue(6, index).slice(0, 4), [id('ObjType', name), 1, 1, weight]);
    // P(reach this row) * P(select it | reached) = weight / 1000.
    assert.equal(reachNumerator * BigInt(weight) * 1000n,
      BigInt(weight) * reachDenominator * BigInt(remaining));
    reachNumerator *= BigInt(remaining - weight);
    reachDenominator *= BigInt(remaining);
    remaining -= weight;
  }
  assert.equal(remaining, 0, 'the complete 1000 weights leave no no-reward branch');
});
for (const [index, seed] of witnesses) test(`native reward roll produces ${loot[index][0]} and nothing else`, () => {
  const p = player();
  JavaRandom.setSeed(seed);
  proc(p, 'stealing_check_for_reward', row.id);
  assert.equal(count(p, loot[index][0]), 1);
  assert.equal(snapshot(p).filter(Boolean).length, 1, 'exactly one inventory slot is produced');
});
for (const loc of stalls) test(`original ${loc.x},${loc.z} stall is reachable and native theft empties then respawns it`, () => {
  const p = fixture(loc);
  const duration = Math.trunc(15 * (4000 - Math.min(World.getTotalPlayers() + 1, 2000)) / 4000);
  execute(p, () => click(p, loc, 2));
  assert.equal(p.activeScript, null);
  assert.equal(p.stats[PlayerStat.THIEVING] - p.thievingStartXp, 100, 'one successful steal awards ten XP');
  const produced = snapshot(p).filter(Boolean);
  assert.equal(produced.length, 1);
  assert.equal(produced[0][1], 1);
  assert(loot.some(([name]) => id('ObjType', name) === produced[0][0]), 'only a source-table seed is produced');
  assert.equal(loc.lifecycleTick, duration, 'the inherited player-count scaling determines the respawn');
  restoreByTimer(loc);
});
test('native level-26 attempt awards no item, XP or empty stall', () => {
  const loc = stalls[0], p = fixture(loc, 26);
  const before = snapshot(p);
  execute(p, () => click(p, loc, 2));
  assert.deepEqual(snapshot(p), before);
  assert.equal(p.stats[PlayerStat.THIEVING], p.thievingStartXp);
  assert.equal(loc.type, stallId);
});
test('a real original owner or market guard seeing the thief prevents the reward', () => {
  const loc = stalls.find(loc => approaches(loc).some(point => catchers(point, loc.level).length && reachable(loc, point)));
  assert(loc, 'an original stall has an original catcher in range and line of sight');
  const p = fixture(loc, 27, true);
  execute(p, () => click(p, loc, 2));
  assert.equal(snapshot(p).filter(Boolean).length, 0);
  assert.equal(p.stats[PlayerStat.THIEVING], p.thievingStartXp);
  assert.equal(loc.type, stallId);
});
test('the kept published catcher model has one owner and does not make Master Farmer a guard', () => {
  // The period table's Master Farmer conflicts with the published row. Keep the
  // operator's owner-plus-guards decision; farming.seed-stall-catcher-disagreement records it.
  assert.equal(row.columnValues[1].length, 1);
  assert.equal(row.columnValues[2].length, 1);
  assert(!types.NpcType.get(id('NpcType', 'master_farmer_1')).op[1],
    'Master Farmer is not attackable and the published guard iterator excludes him');
});
console.log(`${cases} seed-stall checks passed`);
process.exit(0);
