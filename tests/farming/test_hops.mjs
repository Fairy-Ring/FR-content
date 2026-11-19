/** Compiled native-packet hops checks. Run from the sibling engine:
 * node --import tsx ../content/tests/farming/test_hops.mjs
 * The oracle independently pins the retained 28 April 2006 Tip.It table and
 * the original 377 map parents; it does not replace native script handlers.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, Runner, State, ScriptOpcode, PlayerTimerType, PlayerStat, JavaRandom,
  Scripts, types, id, inv, player, proc, add, count, use, click, load } from './runtime.mjs';

const map = await load('engine/GameMap.ts');
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// VERIFIED: levels and XP tenths follow the 28 April 2006 Tip.It Farming guide.
// The guide's general four-seed instruction applies to all seven crops.
const crops = [
  { name: 'hammerstone', seed: 'hammerstone_hop_seed', produce: 'hammerstone_hops', cache: 'hammer_hops', first: 4, mature: 8, last: 10, level: 4, seedCount: 4, plantXp: 90, harvestXp: 100, plural: 'Hammerstone Hops' },
  { name: 'asgarnian', seed: 'asgarnian_hop_seed', produce: 'asgarnian_hops', cache: 'asgarnian_hops', first: 11, mature: 16, last: 18, level: 8, seedCount: 4, plantXp: 110, harvestXp: 120, plural: 'Asgarnian Hops' },
  { name: 'yanillian', seed: 'yanillian_hop_seed', produce: 'yanillian_hops', cache: 'yanillian_hops', first: 19, mature: 25, last: 27, level: 16, seedCount: 4, plantXp: 145, harvestXp: 160, plural: 'Yanillian Hops' },
  { name: 'krandorian', seed: 'krandorian_hop_seed', produce: 'krandorian_hops', cache: 'krandorian_hops', first: 28, mature: 35, last: 37, level: 21, seedCount: 4, plantXp: 170, harvestXp: 195, plural: 'Krandorian Hops' },
  { name: 'wildblood', seed: 'wildblood_hop_seed', produce: 'wildblood_hops', cache: 'wildblood_hops', first: 38, mature: 46, last: 48, level: 28, seedCount: 4, plantXp: 230, harvestXp: 260, plural: 'Wildblood Hops' },
  { name: 'barley', seed: 'barley_seed', produce: 'barley', cache: 'barley', first: 49, mature: 53, last: 55, level: 3, seedCount: 4, plantXp: 110, harvestXp: 95, plural: 'barley' },
  { name: 'jute', seed: 'jute_seed', produce: 'jute_fibre', cache: 'jute', first: 56, mature: 61, last: 63, level: 13, seedCount: 4, plantXp: 130, harvestXp: 145, plural: 'jute fibres' },
];
const patchSpecs = [
  { name: 'farming_hops_patch_1', square: 'm40_48.jm2', minX: 2574, maxX: 2577, minZ: 3103, maxZ: 3106, selector: 'farming_hops_varp_0_7' },
  { name: 'farming_hops_patch_2', square: 'm43_52.jm2', minX: 2809, maxX: 2812, minZ: 3335, maxZ: 3338, selector: 'farming_hops_varp_8_15' },
  { name: 'farming_hops_patch_3', square: 'm50_51.jm2', minX: 3227, maxX: 3231, minZ: 3313, maxZ: 3317, selector: 'farming_hops_varp_16_23' },
  { name: 'farming_hops_patch_4', square: 'm41_55.jm2', minX: 2664, maxX: 2669, minZ: 3523, maxZ: 3528, selector: 'farming_hops_varp_24_31' },
];
const patchNames = patchSpecs.map(row => row.name);
const placements = new Map(patchNames.map(name => [name, []]));
for (const filename of fs.readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name))) {
  const [, mapX, mapZ] = /^m(\d+)_([0-9]+)\.jm2$/.exec(filename).map(Number);
  let section;
  for (const line of fs.readFileSync(path.join(content, 'maps', filename), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    if (section !== 'LOC') continue;
    const match = /^([0-3]) (\d+) (\d+): (\d+)(?: (\d+))?(?: (\d+))?$/.exec(line);
    if (!match) continue;
    const [level, x, z, type] = match.slice(1, 5).map(Number);
    const config = types.LocType.get(type);
    if (!placements.has(config.debugname)) continue;
    const loc = World.getLoc(mapX * 64 + x, mapZ * 64 + z, level, type);
    assert(loc, `packed map loc for ${config.debugname} is present in World`);
    placements.get(config.debugname).push({ filename, loc });
  }
}
assert.equal(placements.size, 4);
for (const spec of patchSpecs) {
  const rows = placements.get(spec.name);
  assert(rows.length > 0, `original-map placement for ${spec.name}`);
  assert.deepEqual([...new Set(rows.map(row => row.filename))], [spec.square], `${spec.name} stays on its original map square`);
  const actual = rows.map(({ loc }) => [loc.x, loc.z, loc.level]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const expected = [];
  for (let x = spec.minX; x <= spec.maxX; x++) for (let z = spec.minZ; z <= spec.maxZ; z++) expected.push([x, z, 0]);
  expected.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  assert.deepEqual(actual, expected, `${spec.name} retains every original packed parent tile`);
}
const patchLocs = patchSpecs.map(spec => {
  const row = placements.get(spec.name).find(({ loc }) => loc.x === spec.minX && loc.z === spec.minZ && loc.level === 0);
  assert(row, `${spec.name} has its original southwest parent tile`);
  return row.loc;
});
const selectors = patchLocs.map(loc => types.LocType.get(loc.type).multivarbit);
assert.deepEqual(selectors, patchSpecs.map(spec => id('VarBitType', spec.selector)), 'each original patch keeps its own cache selector');
const hopsVarp = types.VarBitType.get(selectors[0]).basevar;
assert(selectors.every(bit => types.VarBitType.get(bit).basevar === hopsVarp), 'all four cache selectors share the original transmitted hops varp');

function approach(loc) {
  const config = types.LocType.get(loc.type);
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const x = loc.x + dx, z = loc.z + dz;
    if (map.isMapBlocked(x, z, loc.level)) continue;
    if (map.reachedLoc(loc.level, x, z, loc.x, loc.z, config.width, config.length,
      1, loc.angle, loc.shape, config.forceapproach)) return { x, z };
  }
  assert.fail(`${config.debugname} has no collision-valid adjacent tile`);
}
function assertRouteToLoc(loc) {
  const config = types.LocType.get(loc.type);
  const near = approach(loc);
  for (const [dx, dz] of [[-8, 0], [8, 0], [0, -8], [0, 8]]) {
    const start = { x: near.x + dx, z: near.z + dz };
    if (map.isMapBlocked(start.x, start.z, loc.level)) continue;
    const route = map.findPathToLoc(loc.level, start.x, start.z, loc.x, loc.z,
      1, config.width, config.length, loc.angle, loc.shape, config.forceapproach);
    if (!route.length) continue;
    const end = route[route.length - 1];
    const endX = (end >>> 14) & 0x3fff, endZ = end & 0x3fff;
    if (map.reachedLoc(loc.level, endX, endZ, loc.x, loc.z, config.width,
      config.length, 1, loc.angle, loc.shape, config.forceapproach) &&
      map.findPath(loc.level, start.x, start.z, near.x, near.z).length) return;
  }
  assert.fail(`${types.LocType.get(loc.type).debugname} has no packed-collision findPathToLoc route`);
}
function fixture({ patchIndex = 0, level = 99, stage = 3 } = {}) {
  const loc = patchLocs[patchIndex];
  const p = player();
  const start = approach(loc);
  p.x = start.x; p.z = start.z; p.level = loc.level;
  p.setLevel(PlayerStat.FARMING, level);
  p.farmingStartXp = p.stats[PlayerStat.FARMING];
  p.setVar(id('VarPlayerType', 'action_delay'), 0);
  if (stage !== null) p.setVarBit(selectors[patchIndex], stage);
  return p;
}
const stage = (p, patchIndex = 0) => p.getVarBit(selectors[patchIndex]);
const setStage = (p, value, patchIndex = 0) => p.setVarBit(selectors[patchIndex], value);
const farmingXp = p => p.stats[PlayerStat.FARMING] - p.farmingStartXp;
function witness(range, draw) {
  for (let seed = 0; seed < 200000; seed++) {
    JavaRandom.setSeed(seed);
    if (Math.floor(JavaRandom.nextDouble() * range) === draw) return seed;
  }
  assert.fail(`no native JavaRandom witness for ${draw}/${range}`);
}
const draws128 = new Map([0, 19, 20, 127].map(draw => [draw, witness(128, draw)]));
const draws256 = new Map([0, 126, 127, 190, 191, 255].map(draw => [draw, witness(256, draw)]));
const zeroDraw = draws256.get(0);

const growthTimer = Scripts.getByName('[timer,farming_growth]');
assert(growthTimer, 'shared compiled farming growth timer is required');
const clock = id('VarPlayerType', 'farming_growth_minute');
const dateHandler = Runner.HANDLERS[ScriptOpcode.DATE_MINUTES];
let minute = 605;
Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(minute);
const hopsTable = types.DbTableType.getByName('farming_hops');
assert(hopsTable, 'compiled farming_hops table is required');
function column(table, name) {
  const index = table.columnNames.indexOf(name);
  assert(index >= 0, `missing ${table.debugname} column ${name}`);
  return index;
}
const hopsColumns = Object.fromEntries(
  ['seed', 'produce', 'first', 'mature', 'last', 'level', 'seed_count', 'plant_xp', 'harvest_xp', 'plural']
    .map(name => [name, column(hopsTable, name)])
);
const hopsRows = types.DbRowType.getInTable(hopsTable.id);
const rowValue = (row, name) => row.getValue(hopsColumns[name], 0)[0];
const rowForSeed = new Map(hopsRows.map(row => [rowValue(row, 'seed'), row]));
assert.equal(rowForSeed.size, crops.length);
const growthTable = types.DbTableType.getByName('farming_growth');
assert(growthTable, 'compiled farming_growth table is required');
const growthColumns = {
  period: column(growthTable, 'period'),
  handler: column(growthTable, 'handler')
};
const growthRows = types.DbRowType.getInTable(growthTable.id);
const growthValue = (row, name) => row.getValue(growthColumns[name], 0)[0];
const hopsGrowthRows = growthRows.filter(row => growthValue(row, 'handler') === 4);
assert.equal(hopsGrowthRows.length, 1, 'one shared row dispatches the hops family');
assert.equal(growthValue(hopsGrowthRows[0], 'period'), 10, 'published candidate family period is ten minutes');

function sequenceWitness(range, minDraw, draws) {
  for (let seed = 0; seed < 200000; seed++) {
    JavaRandom.setSeed(seed);
    let valid = true;
    for (let index = 0; index < draws; index++) {
      if (Math.floor(JavaRandom.nextDouble() * range) < minDraw) { valid = false; break; }
    }
    if (valid) return seed;
  }
  assert.fail(`no native JavaRandom witness for ${draws} draws in ${range} with minimum ${minDraw}`);
}
const healthyAdvanceSeed = sequenceWitness(128, 20, 16);
const actionDelay = id('VarPlayerType', 'action_delay');
const weeded = 3;
const autoTicks = 3; // CANDIDATE: shared three-tick automatic harvest convention.
const maxHarvestTicks = autoTicks * 4;
const saveLow = 64, saveHigh = 128; // UNKNOWN hops life-save endpoints, retained as named assignment constants.

function withPlayerTick(p, action) {
  World.playerLoop.add(2130706433n, p);
  try { return action(); }
  finally { p.unlink(); }
}
function playerTick() {
  World.currentTick++;
  World.processPlayers();
}
function finishDelayedAction(p, maxResumes = 2) {
  let resumes = 0;
  while (p.activeScript) {
    assert(resumes < maxResumes, `one-shot care action finishes within ${maxResumes} interpreter resumes`);
    const suspended = p.activeScript;
    assert.equal(suspended.execution, State.SUSPENDED);
    assert.equal(p.delayed, true);
    const due = p.delayedUntil;
    assert(due > World.currentTick);
    World.currentTick = due;
    World.processPlayers();
    resumes++;
  }
  assert.equal(p.delayed, false);
}
function inventorySnapshot(p) {
  return Array.from({ length: types.InvType.get(inv).size }, (_, slotIndex) => {
    const item = p.invGetSlot(inv, slotIndex);
    return item ? [item.id, item.count] : null;
  });
}
function assertRefused(p, loc, action) {
  const before = { stage: stage(p), xp: farmingXp(p), inventory: inventorySnapshot(p) };
  assert(action(), 'native OpLoc packet reaches the product-level gate');
  assert.equal(stage(p), before.stage, 'refusal leaves the hops selector unchanged');
  assert.equal(farmingXp(p), before.xp, 'refusal grants no Farming XP');
  assert.deepEqual(inventorySnapshot(p), before.inventory, 'refusal leaves every inventory slot unchanged');
  assert.equal(p.activeScript, null, 'refusal leaves no active script');
  assert.equal(p.delayed, false, 'refusal does not suspend the player');
  assert.equal(p.hasInteraction(), false, 'refusal does not queue a continuation');
  assert.equal(loc.type, patchLocs[0].type, 'native packet uses the original patch parent');
}

let cases = 0, failures = 0;
function test(name, action) {
  cases++;
  try {
    JavaRandom.setSeed(0);
    action();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.stack ?? error}`);
  }
}

try {
  test('seven independently pinned rows drive seed, healthy, watered, diseased, and dead cache bands', () => {
    assert.equal(hopsRows.length, crops.length, 'ordinary hops table has exactly seven rows');
    const p = player();
    for (const crop of crops) {
      const row = rowForSeed.get(id('ObjType', crop.seed));
      assert(row, `row for ${crop.seed}`);
      for (const [field, want] of [
        ['seed', id('ObjType', crop.seed)], ['produce', id('ObjType', crop.produce)],
        ['first', crop.first], ['mature', crop.mature], ['last', crop.last],
        ['level', crop.level], ['seed_count', 4], ['plant_xp', crop.plantXp],
        ['harvest_xp', crop.harvestXp], ['plural', crop.plural]
      ]) assert.equal(rowValue(row, field), want, `${crop.name} ${field}`);
      assert.equal(proc(p, 'farming_hops_seed', id('ObjType', crop.seed)).popInt(), row.id, `${crop.name} base seed switch`);
      for (let variant = 2; variant <= 5; variant++) {
        assert.equal(proc(p, 'farming_hops_seed', id('ObjType', `${crop.seed}_${variant}`)).popInt(), row.id,
          `${crop.name} alternate seed ${variant}`);
      }
      for (let value = crop.first; value <= crop.last; value++) {
        assert.equal(proc(p, 'farming_hops_crop', value).popInt(), row.id, `${crop.name} healthy stage ${value}`);
      }
      for (let value = crop.first; value < crop.mature; value++) {
        assert.equal(proc(p, 'farming_hops_crop', value + 64).popInt(), row.id, `${crop.name} watered stage ${value + 64}`);
      }
      for (let value = crop.first + 1; value < crop.mature; value++) {
        assert.equal(proc(p, 'farming_hops_crop', value + 128).popInt(), row.id, `${crop.name} diseased stage ${value + 128}`);
        assert.equal(proc(p, 'farming_hops_crop', value + 192).popInt(), row.id, `${crop.name} dead stage ${value + 192}`);
      }
    }
    const form = (crop, value) => value === crop.first ? `${crop.cache}_seed`
      : value < crop.mature ? `${crop.cache}_${value - crop.first}` : `${crop.cache}_fullygrown`;
    for (const patchName of patchNames) {
      const config = types.LocType.get(id('LocType', patchName));
      const visibleName = value => types.LocType.get(config.multiloc[value]).debugname;
      for (const crop of crops) {
        for (let value = crop.first; value <= crop.last; value++) {
          assert.equal(visibleName(value), form(crop, value), `${patchName} stage ${value}`);
        }
        for (let value = crop.first; value < crop.mature; value++) {
          const base = value === crop.first ? `${crop.cache}_seed` : `${crop.cache}_${value - crop.first}`;
          assert.equal(visibleName(value + 64), `${base}_watered`, `${patchName} watered stage ${value + 64}`);
        }
        for (let value = crop.first + 1; value < crop.mature; value++) {
          const growing = `${crop.cache}_${value - crop.first}`;
          assert.equal(visibleName(value + 128), `${growing}_diseased`, `${patchName} diseased stage ${value + 128}`);
          assert.equal(visibleName(value + 192), `${growing}_dead`, `${patchName} dead stage ${value + 192}`);
        }
      }
    }
  });

  test('four original patch selectors are packed, collision-reachable, pathable, and independently written by native planting', () => {
    const baseline = [8, 12, 20, 29];
    for (let target = 0; target < patchLocs.length; target++) {
      const loc = patchLocs[target];
      assertRouteToLoc(loc);
      const p = fixture({ patchIndex: target, level: 3, stage: null });
      const values = [...baseline]; values[target] = weeded;
      values.forEach((value, index) => setStage(p, value, index));
      const packed = values.reduce((word, value, index) => word | (value << (index * 8)), 0);
      assert.equal(p.getVar(hopsVarp), packed, 'four original selector bytes share the transmitted cache varp');
      add(p, 'barley_seed', 4); add(p, 'dibber');
      assert(use(p, 'barley_seed', loc), 'native seed-on-patch packet is accepted');
      values[target] = crops.find(crop => crop.name === 'barley').first;
      assert.deepEqual(selectors.map((_, index) => stage(p, index)), values,
        `${patchNames[target]} planting changes only its own selector`);
      const expectedWord = values.reduce((word, value, index) => word | (value << (index * 8)), 0);
      assert.equal(p.getVar(hopsVarp), expectedWord, 'native planting writes only the selected packed byte');
      assert.equal(count(p, 'barley_seed'), 0);
      assert.equal(count(p, 'dibber'), 1);
      assert.equal(farmingXp(p), crops.find(crop => crop.name === 'barley').plantXp);
    }
  });

  for (const crop of crops) {
    test(`${crop.name}: native planting enforces level, dibber, four seeds, and period XP`, () => {
      const under = fixture({ level: crop.level - 1 });
      add(under, crop.seed, 4); add(under, 'dibber');
      assert(use(under, crop.seed, patchLocs[0]));
      assert.equal(stage(under), weeded); assert.equal(count(under, crop.seed), 4); assert.equal(farmingXp(under), 0);

      const noDibber = fixture({ level: crop.level });
      add(noDibber, crop.seed, 4);
      assert(use(noDibber, crop.seed, patchLocs[0]));
      assert.equal(stage(noDibber), weeded); assert.equal(count(noDibber, crop.seed), 4); assert.equal(farmingXp(noDibber), 0);

      const short = fixture({ level: crop.level });
      add(short, crop.seed, crop.seedCount - 1); add(short, 'dibber');
      assert(use(short, crop.seed, patchLocs[0]));
      assert.equal(stage(short), weeded); assert.equal(count(short, crop.seed), crop.seedCount - 1);
      assert.equal(farmingXp(short), 0, 'insufficient seeds cannot plant partially');

      const planted = fixture({ level: crop.level });
      add(planted, crop.seed, crop.seedCount); add(planted, 'dibber');
      assert(use(planted, crop.seed, patchLocs[0]));
      assert.equal(stage(planted), crop.first);
      assert.equal(count(planted, crop.seed), 0, 'all four seeds are consumed');
      assert.equal(count(planted, 'dibber'), 1, 'dibber is retained');
      assert.equal(farmingXp(planted), crop.plantXp, 'planting XP is in tenths');
    });
  }

  test('shared growth handler 4 advances all four selector bytes and compiled barley growth writes mature byte 53', () => {
    const p = player();
    const starts = ['barley', 'asgarnian', 'yanillian', 'krandorian']
      .map(name => crops.find(crop => crop.name === name).first);
    starts.forEach((value, index) => setStage(p, value, index));
    const unrelated = id('VarPlayerType', 'option_music');
    p.setVar(unrelated, 3);
    const before = p.getVar(hopsVarp);
    JavaRandom.setSeed(healthyAdvanceSeed);
    proc(p, 'farming_hops_advance_all', 4);
    const expected = starts.map(value => value + 4);
    assert.deepEqual(selectors.map((_, index) => stage(p, index)), expected);
    assert.equal(expected[0], 53, 'four native hops growth advances write barley mature value 53');
    const packed = expected.reduce((word, value, index) => word | (value << (index * 8)), 0);
    assert.equal(p.getVar(hopsVarp), packed, 'advance-all changes only the four original hops bytes');
    assert.notEqual(packed, before);
    assert.equal(p.getVar(unrelated), 3, 'advance-all leaves unrelated permanent state unchanged');
  });

  test('ten-minute shared timer and offline reconciliation advance hops once and survive save/load', () => {
    const period = growthValue(hopsGrowthRows[0], 'period');
    assert.equal(period, 10);
    const barley = crops.find(crop => crop.name === 'barley');
    const p = fixture({ level: 99, stage: barley.first });
    minute = 605;
    proc(p, 'farming_login');
    assert.equal(p.timers.get(growthTimer.id).interval, 500);
    assert.equal(p.timers.get(growthTimer.id).type, PlayerTimerType.NORMAL);
    for (const [at, expected] of [[610, 50], [620, 51], [630, 52], [640, 53]]) {
      minute = at;
      JavaRandom.setSeed(draws128.get(127));
      World.currentTick += 500;
      p.processTimers(PlayerTimerType.NORMAL);
      assert.equal(stage(p), expected, `one stage at global ten-minute window ${at}`);
    }
    assert.equal(p.getVar(clock), 640, 'shared checkpoint is consumed once per timer window');

    const offline = fixture({ level: 99, stage: barley.first });
    offline.setVar(clock, 605);
    minute = 615;
    JavaRandom.setSeed(draws128.get(127));
    proc(offline, 'farming_login');
    assert.equal(stage(offline), 50, 'one completed offline window advances barley once');
    assert(offline.timers.get(growthTimer.id), 'login restores the shared timer');
    const loaded = player(offline.save());
    assert.equal(stage(loaded), 50, 'hops selector persists through save/load');
    assert.equal(loaded.getVar(clock), 615);
    proc(loaded, 'farming_reconcile', 1);
    assert.equal(stage(loaded), 50, 'same-minute reconciliation is idempotent');
    assert.equal(stage(player(loaded.save())), 50, 'offline advancement survives another save/load');
  });

  test('shared crop care advances, waters, cures, and clears every hops family through native packets', () => {
    const probe = player();
    for (const crop of crops) {
      JavaRandom.setSeed(draws128.get(0));
      assert.equal(proc(probe, 'farming_hops_advance', crop.first, 1, 0).popInt(), crop.first + 1,
        `${crop.name} first stage advances without a disease roll`);
      JavaRandom.setSeed(draws128.get(0));
      assert.equal(proc(probe, 'farming_hops_advance', crop.first + 1, 1, 0).popInt(), crop.first + 129,
        `${crop.name} dry growing stage can become diseased at the shared low boundary`);
      JavaRandom.setSeed(draws128.get(127));
      assert.equal(proc(probe, 'farming_hops_advance', crop.first + 1, 1, 0).popInt(), crop.first + 2,
        `${crop.name} dry stage advances without disease above the shared threshold`);
      JavaRandom.setSeed(draws128.get(127));
      assert.equal(proc(probe, 'farming_hops_advance', crop.first + 1 + 64, 1, 0).popInt(), crop.first + 2,
        `${crop.name} watered growth advances from the base cache byte`);
      assert.equal(proc(probe, 'farming_hops_advance', crop.mature, 1000, 0).popInt(), crop.mature,
        `${crop.name} mature plants never grow beyond their mature stage`);
      assert.equal(proc(probe, 'farming_hops_advance', crop.first + 1 + 128, 1, 0).popInt(), crop.first + 1 + 192,
        `${crop.name} disease becomes the corresponding dead stage`);

      const watered = fixture({ level: crop.level, stage: crop.first + 1 });
      add(watered, 'watering_can_8');
      withPlayerTick(watered, () => {
        assert(use(watered, 'watering_can_8', patchLocs[0]));
        finishDelayedAction(watered);
      });
      assert.equal(stage(watered), crop.first + 1 + 64);
      assert.equal(count(watered, 'watering_can_8'), 0);
      assert.equal(count(watered, 'watering_can_7'), 1);
      assert.equal(farmingXp(watered), 0, 'watering awards no Farming XP');

      const cured = fixture({ level: crop.level, stage: crop.first + 1 + 128 });
      add(cured, 'plant_cure');
      withPlayerTick(cured, () => {
        assert(use(cured, 'plant_cure', patchLocs[0]));
        finishDelayedAction(cured);
      });
      assert.equal(stage(cured), crop.first + 1);
      assert.equal(count(cured, 'plant_cure'), 0);
      assert.equal(count(cured, 'vial_empty'), 1);
      assert.equal(farmingXp(cured), 0, 'curing awards no Farming XP');

      const dead = fixture({ level: crop.level, stage: crop.first + 1 + 192 });
      add(dead, 'spade');
      withPlayerTick(dead, () => {
        assert(use(dead, 'spade', patchLocs[0]));
        finishDelayedAction(dead);
      });
      assert.equal(stage(dead), weeded, 'spade clears the dead hops patch');
      assert.equal(count(dead, 'spade'), 1);
      assert.equal(farmingXp(dead), 0, 'clearing awards no Farming XP');
    }
  });

  test('UNKNOWN 64/128 hops life-save endpoints feed shared interpolation', () => {
    const barley = crops.find(crop => crop.name === 'barley');
    const low = fixture({ level: 1, stage: barley.mature });
    const high = fixture({ level: 99, stage: barley.mature });
    assert.equal(proc(low, 'farming_hops_life_loss').popInt(), 256 - (saveLow + 1));
    assert.equal(proc(high, 'farming_hops_life_loss').popInt(), 256 - (saveHigh + 1));
    for (const [level, draw, expected] of [[1, 190, 54], [1, 191, 53], [99, 126, 54], [99, 127, 53]]) {
      const p = fixture({ level, stage: barley.mature });
      add(p, 'spade');
      withPlayerTick(p, () => {
        JavaRandom.setSeed(draws256.get(draw));
        assert(click(p, patchLocs[0], 1));
      });
      assert.equal(stage(p), expected, `life-save boundary at Farming ${level}, draw ${draw}`);
      assert.equal(count(p, barley.produce), 1);
      assert.equal(farmingXp(p), barley.harvestXp);
    }
  });

  test('native Harvest requires a spade and space; one packet auto-continues three guaranteed lives', () => {
    const barley = crops.find(crop => crop.name === 'barley');
    const loc = patchLocs[0];
    const noSpade = fixture({ level: 1, stage: barley.mature });
    withPlayerTick(noSpade, () => assertRefused(noSpade, loc, () => click(noSpade, loc, 1)));

    const full = fixture({ level: 1, stage: barley.mature });
    const capacity = types.InvType.get(inv).size;
    for (let slotIndex = 0; slotIndex < capacity - 1; slotIndex++) add(full, 'potato');
    add(full, 'spade');
    assert(inventorySnapshot(full).every(Boolean), 'spade is present in a genuinely full inventory');
    withPlayerTick(full, () => assertRefused(full, loc, () => click(full, loc, 1)));

    const immature = fixture({ level: 1, stage: barley.first + 1 });
    add(immature, 'spade');
    const immatureInventory = inventorySnapshot(immature);
    withPlayerTick(immature, () => {
      assert.equal(click(immature, loc, 1), false, 'visible immature form offers no native Harvest action');
      assert.equal(stage(immature), barley.first + 1);
      assert.equal(farmingXp(immature), 0);
      assert.deepEqual(inventorySnapshot(immature), immatureInventory);
      assert.equal(immature.activeScript, null);
      assert.equal(immature.delayed, false);
      assert.equal(immature.hasInteraction(), false);
    });

    const p = fixture({ level: 1, stage: barley.mature });
    add(p, 'spade');
    let picks = 0, previousPickTick = null, ticks = 0;
    const observe = () => {
      const countPicked = count(p, barley.produce);
      assert(countPicked >= picks && countPicked <= 3, 'automatic harvest is monotonic and finite');
      assert.equal(farmingXp(p), countPicked * barley.harvestXp, 'each pick grants sourced per-item XP');
      if (countPicked > picks) {
        assert.equal(countPicked, picks + 1, 'one automatic cycle produces one barley');
        if (previousPickTick !== null) assert.equal(World.currentTick - previousPickTick, autoTicks,
          'automatic continuation follows the labelled three-tick candidate');
        assert.equal(stage(p), countPicked === 3 ? weeded : barley.mature + countPicked);
        previousPickTick = World.currentTick;
        picks = countPicked;
      }
      assert.equal(p.activeScript, null, 'repeated harvest is pending OpLoc, not a suspended script');
      assert.equal(p.delayed, false);
    };
    withPlayerTick(p, () => {
      JavaRandom.setSeed(zeroDraw);
      assert(click(p, loc, 1), 'one native OpLoc Harvest packet starts the action');
      observe();
      while (picks < 3 || p.hasInteraction()) {
        assert(ticks < maxHarvestTicks, 'automatic harvest clears barley within its finite tick bound');
        World.currentTick++;
        JavaRandom.setSeed(zeroDraw);
        World.processPlayers();
        ticks++;
        observe();
      }
    });
    assert.equal(picks, 3);
    assert.equal(count(p, barley.produce), 3);
    assert.equal(farmingXp(p), 3 * barley.harvestXp);
    assert.equal(count(p, 'spade'), 1);
    assert.equal(p.hasInteraction(), false, 'the last life ends automatic continuation');
  });

  test('stopping native harvest cancels its pending automatic continuation', () => {
    const barley = crops.find(crop => crop.name === 'barley');
    const p = fixture({ level: 1, stage: barley.mature });
    add(p, 'spade');
    withPlayerTick(p, () => {
      JavaRandom.setSeed(zeroDraw);
      assert(click(p, patchLocs[0], 1));
      assert.equal(count(p, barley.produce), 1);
      assert.equal(stage(p), barley.mature + 1);
      assert(p.hasInteraction(), 'one native harvest leaves an automatic continuation pending');
      p.stopAction();
      assert.equal(p.hasInteraction(), false, 'stopAction cancels the pending harvest');
      const xp = farmingXp(p);
      for (let tick = 0; tick < maxHarvestTicks; tick++) {
        playerTick();
        assert.equal(count(p, barley.produce), 1);
        assert.equal(stage(p), barley.mature + 1);
        assert.equal(farmingXp(p), xp);
      }
    });
  });
} finally {
  Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = dateHandler;
}
console.log(`Hops compiled checks: ${cases - failures}/${cases} passed`);
process.exit(failures ? 1 : 0);
