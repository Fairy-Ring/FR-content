/** Native packed stall dispatch, reward and lifecycle checks. Run from the sibling engine. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, State, PlayerStat, JavaRandom, types, id, inv, player, proc, count, click, load } from '../farming/runtime.mjs';

const map = await load('engine/GameMap.ts');
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Published native outcomes are the compatibility oracle, except the period gem-XP correction.
const published = [
  ['bakery', 'bakers_stall_stealing', 5, 160, 8, [['cake', 13], ['bread', 5], ['chocolate_slice', 2]], 1],
  ['tea', 'tea_stall', 5, 160, 16, [['cup_of_tea', 128]], 7],
  ['silk', 'silk_stall_stealing', 20, 240, 16, [['silk', 128]], 2],
  ['fur', 'fur_stall_stealing', 35, 360, 32, [['grey_wolf_fur', 128]], 3],
  ['silver', 'silver_stall_stealing', 50, 540, 100, [['silver_ore', 128]], 4],
  ['spice', 'spice_stall_stealing', 65, 810, 166, [['spicespot', 128]], 5],
  ['gem', 'gem_stall_stealing', 75, 160, 600, [['uncut_sapphire', 105], ['uncut_emerald', 17], ['uncut_ruby', 5], ['uncut_diamond', 1]], 6]
];
const selectedIds = new Set(published.map(([, key]) => id('LocType', key)));
const placements = [];
for (const filename of fs.readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name))) {
  const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(filename).map(Number);
  let section;
  for (const line of fs.readFileSync(path.join(content, 'maps', filename), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    if (section !== 'LOC') continue;
    const match = /^([0-3]) (\d+) (\d+): (\d+)(?: (\d+))?(?: (\d+))?$/.exec(line);
    if (!match || !selectedIds.has(Number(match[4]))) continue;
    const [level, x, z, type] = match.slice(1, 5).map(Number);
    const loc = World.getLoc(mx * 64 + x, mz * 64 + z, level, type);
    assert(loc, `original ${filename}:${line} is packed`);
    placements.push(loc);
  }
}
const snapshot = p => Array.from({ length: types.InvType.get(inv).size }, (_, slot) => {
  const obj = p.invGetSlot(inv, slot);
  return obj ? [obj.id, obj.count] : null;
});
function approaches(loc) {
  const config = types.LocType.get(loc.type), points = [];
  for (let x = loc.x - 1; x <= loc.x + Math.max(config.width, config.length); x++) {
    for (let z = loc.z - 1; z <= loc.z + Math.max(config.width, config.length); z++) {
      if (!map.isMapBlocked(x, z, loc.level) && map.reachedLoc(loc.level, x, z,
        loc.x, loc.z, config.width, config.length, 1, loc.angle, loc.shape, config.forceapproach)) points.push({ x, z });
    }
  }
  return points;
}
function catchers(row, point, level) {
  const ids = new Set([row.getValue(1, 0)[0], ...Array.from({ length: row.columnValues[2]?.length ?? 0 }, (_, index) => row.getValue(2, index)[0])]);
  return [...World.npcs].filter(npc => npc.isActive && npc.level === level && ids.has(npc.type) &&
    Math.max(Math.abs(npc.x - point.x), Math.abs(npc.z - point.z)) <= 5 &&
    map.isLineOfSight(level, npc.x, npc.z, point.x, point.z));
}
function reachable(loc, point) {
  const config = types.LocType.get(loc.type);
  return [[-8, 0], [8, 0], [0, -8], [0, 8]].some(([dx, dz]) => {
    const start = { x: point.x + dx, z: point.z + dz };
    if (map.isMapBlocked(start.x, start.z, loc.level)) return false;
    const route = map.findPathToLoc(loc.level, start.x, start.z, loc.x, loc.z,
      1, config.width, config.length, loc.angle, loc.shape, config.forceapproach);
    if (!route.length) return false;
    const end = route[route.length - 1];
    return map.reachedLoc(loc.level, (end >>> 14) & 0x3fff, end & 0x3fff,
      loc.x, loc.z, config.width, config.length, 1, loc.angle, loc.shape, config.forceapproach) &&
      map.findPath(loc.level, start.x, start.z, point.x, point.z).length > 0;
  });
}
function fixture(row, locs, level, caught = false) {
  for (const loc of locs) {
    const point = approaches(loc).find(point => Boolean(catchers(row, point, loc.level).length) === caught && reachable(loc, point));
    if (!point) continue;
    const p = player();
    p.x = point.x; p.z = point.z; p.level = loc.level;
    p.setLevel(PlayerStat.THIEVING, level);
    return { p, loc, xp: p.stats[PlayerStat.THIEVING] };
  }
  assert.fail(`${row.debugname} has an original reachable ${caught ? 'observed' : 'unobserved'} interaction side`);
}
function execute(p, loc) {
  World.playerLoop.add(BigInt(p.pid), p);
  try {
    assert(click(p, loc, 2), 'native OpLoc2 accepts the original stall');
    for (let tick = 0; p.activeScript?.execution === State.SUSPENDED && tick < 4; tick++) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      World.processPlayers();
    }
    assert.notEqual(p.activeScript?.execution, State.SUSPENDED, 'bounded native scheduler finishes the attempt');
  } finally { p.unlink(); }
}
function restore(loc, empty, original) {
  assert.equal(loc.type, id('LocType', empty));
  const duration = loc.lifecycleTick;
  assert(duration > 0);
  for (let tick = 1; tick <= duration; tick++) {
    World.currentTick++;
    World.processZones();
    assert.equal(loc.type, tick < duration ? id('LocType', empty) : original, 'only the empty/original lifecycle is visible');
  }
  assert.equal(World.getLoc(loc.x, loc.z, loc.level, original), loc);
}
function expectedReward(seed, loot) {
  JavaRandom.setSeed(seed);
  let remaining = loot.reduce((sum, [, weight]) => sum + weight, 0);
  for (let index = loot.length - 1; index >= 0; index--) {
    JavaRandom.nextIntBound(1); // The published selector first draws the fixed quantity.
    if (JavaRandom.nextIntBound(remaining) < loot[index][1]) return index;
    remaining -= loot[index][1];
  }
  assert.fail('complete loot table has no empty outcome');
}
let cases = 0;
function test(name, action) { action(); cases++; console.log(`PASS ${name}`); }
for (const [kind, key, level, xp, ticks, loot, bit] of published) {
  const row = types.DbRowType.getByName(`stealing_${kind}_stall`);
  assert(row, `missing compiled ${kind} row`);
  const original = id('LocType', key), locs = placements.filter(loc => loc.type === original);
  assert(locs.length, `${key} has original packed map placements`);
  test(`${key}: published table, XP, timer and complete loot`, () => {
    assert.deepEqual(row.getValue(0, 0), [original]);
    assert.deepEqual(row.getValue(3, 0), [level]);
    assert.deepEqual(row.getValue(4, 0), [xp]);
    assert.deepEqual(row.getValue(5, 0), [ticks]);
    assert.deepEqual(row.getValue(7, 0), [loot.reduce((sum, [, weight]) => sum + weight, 0)]);
    assert.equal(row.columnValues[6].length, loot.length * 5);
    for (const [index, [name, weight]] of loot.entries()) {
      assert.deepEqual(row.getValue(6, index).slice(0, 4), [id('ObjType', name), 1, 1, weight]);
    }
  });
  const witnesses = new Map();
  for (let seed = 0; seed < 100000 && witnesses.size < loot.length; seed++) {
    const index = expectedReward(seed, loot);
    if (!witnesses.has(index)) witnesses.set(index, seed);
  }
  assert.equal(witnesses.size, loot.length);
  for (const [index, seed] of witnesses) test(`${key}: native reward ${loot[index][0]} only`, () => {
    const p = player();
    JavaRandom.setSeed(seed);
    proc(p, 'stealing_check_for_reward', row.id);
    assert.equal(count(p, loot[index][0]), 1);
    assert.equal(snapshot(p).filter(Boolean).length, 1);
  });
  test(`${key}: native steal, published lockout bit, empty and automatic return`, () => {
    const { p, loc, xp: before } = fixture(row, locs, level);
    const duration = Math.trunc(ticks * (4000 - Math.min(World.getTotalPlayers() + 1, 2000)) / 4000);
    execute(p, loc);
    assert.equal(p.stats[PlayerStat.THIEVING] - before, xp);
    const produced = snapshot(p).filter(Boolean);
    assert.equal(produced.length, 1);
    assert.equal(produced[0][1], 1);
    assert(loot.some(([name]) => id('ObjType', name) === produced[0][0]));
    assert.equal(p.getVar(id('VarPlayerType', 'thieving_stall_timer')), 1 << bit);
    assert.equal(loc.lifecycleTick, duration);
    restore(loc, 'market', original);
  });
  test(`${key}: below-level native attempt has no reward, XP or depletion`, () => {
    const { p, loc, xp: before } = fixture(row, locs, level - 1);
    execute(p, loc);
    assert.equal(p.stats[PlayerStat.THIEVING], before);
    assert.equal(snapshot(p).filter(Boolean).length, 0);
    assert.equal(loc.type, original);
  });
  test(`${key}: full inventory native attempt has no reward, XP or depletion`, () => {
    const { p, loc, xp: before } = fixture(row, locs, level);
    p.invAdd(inv, id('ObjType', 'logs'), 28);
    const beforeInv = snapshot(p);
    execute(p, loc);
    assert.deepEqual(snapshot(p), beforeInv);
    assert.equal(p.stats[PlayerStat.THIEVING], before);
    assert.equal(loc.type, original);
  });
  test(`${key}: original owner/guard seeing theft prevents reward and depletion`, () => {
    const { p, loc, xp: before } = fixture(row, locs, level, true);
    execute(p, loc);
    assert.equal(p.stats[PlayerStat.THIEVING], before);
    assert.equal(snapshot(p).filter(Boolean).length, 0);
    assert.equal(loc.type, original);
  });
}
console.log(`${cases} native stall checks passed`);
process.exit(0);
