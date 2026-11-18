/** Built-pack allotment matrix. Run from sibling engine:
 * node --import tsx ../content/tests/farming/test_allotments.mjs
 * Native item/loc packets resolve handlers from each visible multiloc.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, Runner, ScriptOpcode, types, id, inv, player, proc, add, count, use, click, load, JavaRandom, PlayerStat } from './runtime.mjs';
const map = await load('engine/GameMap.ts');
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// VERIFIED: 377 cache bands; retained 28 April 2006 Tip.It levels and XP.
const crops = [
  ['onion', 13, 17, 19, 5, 100, 110],
  ['cabbage', 20, 24, 26, 7, 100, 115],
  ['tomato', 27, 31, 33, 12, 125, 140],
  ['sweetcorn', 34, 40, 42, 20, 170, 190],
  ['strawberry', 43, 49, 51, 31, 260, 290],
  ['watermelon', 52, 60, 62, 47, 480, 545],
];
const patches = new Map();
for (const filename of fs.readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name))) {
  const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(filename).map(Number);
  let section;
  for (const line of fs.readFileSync(path.join(content, 'maps', filename), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    if (section !== 'LOC') continue;
    const match = /^([0-3]) (\d+) (\d+): (\d+)(?: (\d+))?(?: (\d+))?$/.exec(line);
    if (!match) continue;
    const [, level, x, z, type] = match.map(Number);
    const config = types.LocType.get(type);
    if (!/^farming_veg_patch_[1-8]$/.test(config.debugname ?? '')) continue;
    if (!patches.has(config.debugname)) patches.set(config.debugname, []);
    patches.get(config.debugname).push(World.getLoc(mx * 64 + x, mz * 64 + z, level, type));
  }
}
assert.equal(patches.size, 8, 'all eight original-cache patch selectors exist');
const patch = World.getLoc(3050, 3307, 0, id('LocType', 'farming_veg_patch_1'));
assert(patch);
const bit = types.LocType.get(patch.type).multivarbit;
const set = (p, value) => p.setVarBit(bit, value);
const stage = p => p.getVarBit(bit);
function fixture(level = 99) {
  const p = player(); p.setLevel(PlayerStat.FARMING, level);
  p.farmingStartXp = p.stats[PlayerStat.FARMING];
  add(p, 'spade'); add(p, 'dibber');
  set(p, 3); return p;
}
const xp = p => p.stats[PlayerStat.FARMING] - p.farmingStartXp;
function witness(draw) {
  for (let seed = 0; seed < 200000; seed++) {
    JavaRandom.setSeed(seed);
    if (Math.floor(JavaRandom.nextDouble() * 128) === draw) return seed;
  }
  assert.fail(`native random witness ${draw}`);
}
const draws = new Map([0, 9, 10, 19, 20, 127].map(draw => [draw, witness(draw)]));
const healthySeed = (() => {
  for (let seed = 0; seed < 200000; seed++) {
    JavaRandom.setSeed(seed);
    if (Array.from({ length: 8 }, () => Math.floor(JavaRandom.nextDouble() * 128)).every(draw => draw >= 20)) return seed;
  }
  assert.fail('no native eight-cycle healthy witness');
})();
function advance(p, value, steps = 1, draw = 127) {
  JavaRandom.setSeed(draw === 127 && steps > 1 ? healthySeed : draws.get(draw));
  return proc(p, 'farming_allotment_advance', value, steps, proc(p, 'farming_allotment_crop', value).popInt()).popInt();
}
let cases = 0, failed = 0;
function test(name, run) {
  cases++;
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack ?? error}`); }
}
for (const [name, first, mature, last, level, plantXp, harvestXp] of crops) {
  test(`${name}: all eight packed patches expose every healthy and care form`, () => {
    for (const locs of patches.values()) for (const loc of locs) {
      assert(loc, 'placement from checked-out map exists in packed collision world');
      const config = types.LocType.get(loc.type);
      for (let value = first; value <= last; value++) assert.equal(config.multiloc[value], id('LocType', value < mature ? value === first ? `${name}_seed` : `${name}_${value - first}` : `${name}_fullygrown`));
      for (let value = first; value < mature; value++) assert.equal(config.multiloc[value + 64], id('LocType', value === first ? `${name}_seed_watered` : `${name}_${value - first}_watered`));
      for (let value = first + 1; value < mature; value++) for (const [offset, suffix] of [[128, 'diseased'], [192, 'dead']]) assert.equal(config.multiloc[value + offset], id('LocType', `${name}_${value - first}_${suffix}`));
    }
  });
  test(`${name}: native level, tools, exact three seeds and planting XP`, () => {
    const p = fixture(level - 1); add(p, `${name}_seed`, 3);
    assert(use(p, `${name}_seed`, patch)); assert.equal(stage(p), 3); assert.equal(count(p, `${name}_seed`), 3); assert.equal(xp(p), 0);
    p.setLevel(PlayerStat.FARMING, level); p.farmingStartXp = p.stats[PlayerStat.FARMING];
    assert(use(p, `${name}_seed`, patch)); assert.equal(stage(p), first); assert.equal(count(p, `${name}_seed`), 0); assert.equal(xp(p), plantXp);
    const short = fixture(level); add(short, `${name}_seed`, 2);
    assert(use(short, `${name}_seed`, patch)); assert.equal(stage(short), 3); assert.equal(count(short, `${name}_seed`), 2);
    const noTool = player(); noTool.setLevel(PlayerStat.FARMING, level); set(noTool, 3); add(noTool, `${name}_seed`, 3);
    assert(use(noTool, `${name}_seed`, patch)); assert.equal(stage(noTool), 3); assert.equal(count(noTool, `${name}_seed`), 3);
  });
  test(`${name}: native care for every visible stage, precise dose, cure, death and recovery`, () => {
    const p = fixture(); add(p, 'watering_can_8'); add(p, 'plant_cure', mature - first);
    for (let value = first; value < mature; value++) {
      set(p, value); add(p, 'watering_can_8');
      const before = count(p, 'watering_can_8');
      assert(use(p, 'watering_can_8', patch)); assert.equal(stage(p), value + 64); assert.equal(count(p, 'watering_can_8'), before - 1);
      const wetCount = count(p, 'watering_can_7'); assert(use(p, 'watering_can_7', patch)); assert.equal(stage(p), value + 64); assert.equal(count(p, 'watering_can_7'), wetCount);
      assert.equal(advance(p, value + 64), value + 1);
      if (value === first) { assert.equal(advance(p, value, 1, 0), value + 1); continue; }
      assert.equal(advance(p, value, 1, 0), value + 128);
      assert.equal(advance(p, value + 128), value + 192);
      set(p, value + 128); const cure = count(p, 'plant_cure');
      assert(use(p, 'plant_cure', patch)); assert.equal(stage(p), value); assert.equal(count(p, 'plant_cure'), cure - 1);
      set(p, value + 192); assert(use(p, 'spade', patch)); assert.equal(stage(p), 3);
    }
    assert.equal(xp(p), 0);
    for (let value = mature; value <= last; value++) assert.equal(advance(p, value, 1000000, 0), value);
    set(p, first); add(p, 'watering_can_0'); assert(use(p, 'watering_can_0', patch)); assert.equal(stage(p), first);
  });
  test(`${name}: disease thresholds, finite catch-up, saving, and isolation`, () => {
    const p = fixture();
    for (const draw of [0, 9, 10, 19, 20, 127]) {
      assert.equal(advance(p, first + 1, 1, draw), draw < 20 ? first + 129 : first + 2);
      assert.equal(advance(p, first + 65, 1, draw), draw < 10 ? first + 129 : first + 2);
    }
    assert.equal(advance(p, first, 1000000, 127), mature);
    assert.equal(advance(p, first, 1000000, 0), first + 193);
    for (const value of [first, first + 64, first + 129, first + 193, mature, last]) {
      set(p, value); const loaded = player(p.save()); assert.equal(stage(loaded), value);
    }
    for (const value of [first + 64, first + 129, first + 193]) { set(p, value); proc(p, 'farming_potato_advance_all', 1); assert.equal(stage(p), advance(p, value)); }
  });
  test(`${name}: harvest lives, XP per item, inventory/tool gates and replant`, () => {
    const p = fixture(level); set(p, mature);
    // The native zero draw loses a life. The three cache mature states encode
    // remaining lives, not a cap of three successful harvests.
    for (let value = mature; value <= last; value++) {
      JavaRandom.setSeed(draws.get(0)); assert(click(p, patch));
      assert.equal(stage(p), value === last ? 3 : value + 1);
    }
    assert.equal(count(p, name), 3); assert.equal(xp(p), harvestXp * 3);
    set(p, mature); JavaRandom.setSeed(draws.get(127)); assert(click(p, patch)); assert.equal(stage(p), mature, 'successful life save permits more than three items');
    const loaded = player(p.save()); assert.equal(stage(loaded), mature);
    const noTool = player(); noTool.setLevel(PlayerStat.FARMING, level); set(noTool, mature);
    assert(click(noTool, patch)); assert.equal(count(noTool, name), 0); assert.equal(stage(noTool), mature);
    const full = fixture(); set(full, mature); while (full.invFreeSpace(inv) > 0) add(full, 'spade');
    assert(click(full, patch)); assert.equal(stage(full), mature); assert.equal(count(full, name), 0);
    set(p, 3); add(p, `${name}_seed`, 3); assert(use(p, `${name}_seed`, patch)); assert.equal(stage(p), first);
  });
  test(`${name}: real login clock catches offline windows once and stops at maturity`, () => {
    const oldDate = Runner.HANDLERS[ScriptOpcode.DATE_MINUTES];
    let minute = 605;
    Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(minute);
    try {
      const p = fixture(level);
      proc(p, 'farming_login'); add(p, `${name}_seed`, 3); assert(use(p, `${name}_seed`, patch));
      minute = 609; proc(p, 'farming_logout');
      const loaded = player(p.save());
      minute = 615; JavaRandom.setSeed(draws.get(127)); proc(loaded, 'farming_login'); assert.equal(stage(loaded), first + 1);
      proc(loaded, 'farming_reconcile', 1); assert.equal(stage(loaded), first + 1);
      minute = 10000000; JavaRandom.setSeed(healthySeed); proc(loaded, 'farming_reconcile', 1);
      assert.equal(stage(loaded), mature);
    } finally { Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = oldDate; }
  });
}
test('UNKNOWN yield endpoints use the sourced level interpolation, not a fixed three-item yield', () => {
  for (const [level, loss] of [[1, 191], [50, 159], [99, 127]]) {
    const p = fixture(level);
    assert.equal(proc(p, 'farming_allotment_life_loss').popInt(), loss);
  }
});
test('all eight packed selectors have reachable native approaches and independent care dispatch', () => {
  for (const [patchName, locs] of patches) {
    let reached = false;
    for (const loc of locs) {
      const config = types.LocType.get(loc.type);
      for (const [dx, dz] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const x = loc.x + dx, z = loc.z + dz;
        if (map.isMapBlocked(x, z, loc.level) || !map.reachedLoc(loc.level, x, z, loc.x, loc.z, config.width, config.length, 1, loc.angle, loc.shape, config.forceapproach)) continue;
        const p = player(); p.x = x; p.z = z; p.level = loc.level;
        const selected = config.multivarbit; p.setVarBit(selected, 14); add(p, 'watering_can_8');
        assert(use(p, 'watering_can_8', loc), patchName); assert.equal(p.getVarBit(selected), 78, patchName);
        for (const [otherName, otherLocs] of patches) if (otherName !== patchName) assert.equal(p.getVarBit(types.LocType.get(otherLocs[0].type).multivarbit), 0);
        reached = true; break;
      }
      if (reached) break;
    }
    assert(reached, `${patchName} has a collision-valid approach`);
  }
});
console.log(`Allotment compiled checks: ${cases - failed}/${cases} passed`);
process.exit(failed ? 1 : 0);
