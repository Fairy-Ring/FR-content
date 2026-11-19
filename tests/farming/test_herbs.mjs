/** Compiled native-packet herb family checks. Run from sibling engine:
 * node --import tsx ../content/tests/farming/test_herbs.mjs
 * Product interactions use real OpLocU/OpLoc packets against packed-map locs;
 * JavaRandom witnesses choose repeatable production draws, not a substitute RNG.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, Runner, Scripts, ScriptOpcode, PlayerTimerType, PlayerStat,
  JavaRandom, types, id, inv, player, proc, add, count, use, click, load } from './runtime.mjs';

const map = await load('engine/GameMap.ts');
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// CANDIDATE: the 377 herb visuals are generic; this species-to-band assignment
// follows seed-pack order. Levels/XP are the retained 28 April 2006 Tip.It table;
// XP is pinned in the row's tenths-of-a-player-XP unit, independently of dbrows.
const herbs = [
  { name: 'guam', seed: 'guam_seed', produce: 'unidentified_guam', first: 4, level: 9, plantXp: 110, harvestXp: 125 },
  { name: 'marrentill', seed: 'marrentill_seed', produce: 'unidentified_marentill', first: 11, level: 14, plantXp: 130, harvestXp: 150 },
  { name: 'tarromin', seed: 'tarromin_seed', produce: 'unidentified_tarromin', first: 18, level: 19, plantXp: 160, harvestXp: 180 },
  { name: 'harralander', seed: 'harralander_seed', produce: 'unidentified_harralander', first: 25, level: 26, plantXp: 220, harvestXp: 240 },
  { name: 'ranarr', seed: 'ranarr_seed', produce: 'unidentified_ranarr', first: 32, level: 32, plantXp: 265, harvestXp: 305 },
  { name: 'toadflax', seed: 'toadflax_seed', produce: 'unidentified_toadflax', first: 39, level: 38, plantXp: 340, harvestXp: 380 },
  { name: 'irit', seed: 'irit_seed', produce: 'unidentified_irit', first: 46, level: 44, plantXp: 430, harvestXp: 490 },
  { name: 'avantoe', seed: 'avantoe_seed', produce: 'unidentified_avantoe', first: 53, level: 50, plantXp: 540, harvestXp: 620 },
  { name: 'kwuarm', seed: 'kwuarm_seed', produce: 'unidentified_kwuarm', first: 68, level: 56, plantXp: 690, harvestXp: 820 },
  { name: 'snapdragon', seed: 'snapdragon_seed', produce: 'unidentified_snapdragon', first: 75, level: 62, plantXp: 870, harvestXp: 990 },
  { name: 'cadantine', seed: 'cadantine_seed', produce: 'unidentified_cadantine', first: 82, level: 67, plantXp: 1070, harvestXp: 1200 },
  { name: 'lantadyme', seed: 'lantadyme_seed', produce: 'unidentified_lantadyme', first: 89, level: 73, plantXp: 1350, harvestXp: 1515 },
  { name: 'dwarf_weed', seed: 'dwarf_weed_seed', produce: 'unidentified_dwarf_weed', first: 96, level: 79, plantXp: 1700, harvestXp: 1920 },
  { name: 'torstol', seed: 'torstol_seed', produce: 'unidentified_torstol', first: 103, level: 85, plantXp: 1995, harvestXp: 2240 },
].map((herb, index) => ({
  ...herb,
  mature: herb.first + 4,
  last: herb.first + 6,
  diseased: 128 + index * 3,
}));
const patchNames = [1, 2, 3, 4].map(index => `farming_herb_patch_${index}`);

// Resolve the four parents from the checked-out revision-377 map files, then
// require every operation below to use its actual World loc and native packet.
const patches = new Map(patchNames.map(name => [name, []]));
for (const filename of fs.readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name))) {
  const [, mapX, mapZ] = /^m(\d+)_(\d+)\.jm2$/.exec(filename).map(Number);
  let section;
  for (const line of fs.readFileSync(path.join(content, 'maps', filename), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    if (section !== 'LOC') continue;
    const match = /^([0-3]) (\d+) (\d+): (\d+)(?: (\d+))?(?: (\d+))?$/.exec(line);
    if (!match) continue;
    const [level, x, z, type] = match.slice(1, 5).map(Number);
    const config = types.LocType.get(type);
    if (!patches.has(config.debugname)) continue;
    const loc = World.getLoc(mapX * 64 + x, mapZ * 64 + z, level, type);
    assert(loc, `packed map loc for ${config.debugname} is present in World`);
    patches.get(config.debugname).push(loc);
  }
}
assert.equal(patches.size, 4);
for (const name of patchNames) assert.equal(patches.get(name).length, 1, `one original-map placement for ${name}`);
const patchLocs = patchNames.map(name => patches.get(name)[0]);
const selectors = patchLocs.map(loc => types.LocType.get(loc.type).multivarbit);
assert.equal(new Set(selectors).size, 4, 'the four packed parents have independent selector bytes');
const herbVarp = id('VarPlayerType', 'varp515_bits');
assert(selectors.every(bit => types.VarBitType.get(bit).basevar === herbVarp), 'all four original selectors share their original packed varp');

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
function fixture({ patchIndex = 0, level = 99, stage = 3 } = {}) {
  const loc = patchLocs[patchIndex];
  const p = player();
  const start = approach(loc);
  p.x = start.x; p.z = start.z; p.level = loc.level;
  p.setLevel(PlayerStat.FARMING, level);
  p.farmingStartXp = p.stats[PlayerStat.FARMING];
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
const draws256 = new Map([0, 174, 175, 190, 191, 255].map(draw => [draw, witness(256, draw)]));
const clock = id('VarPlayerType', 'farming_growth_minute');
const growthTimer = Scripts.getByName('[timer,farming_growth]');
assert(growthTimer, 'shared compiled farming growth timer is required');

let cases = 0, failures = 0;
function test(name, action) {
  cases++;
  try { JavaRandom.setSeed(0); action(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack ?? error}`); }
}

const herbTable = types.DbTableType.getByName('farming_herb');
assert(herbTable, 'compiled farming_herb table is required');
function column(table, name) {
  const index = table.columnNames.indexOf(name);
  assert(index >= 0, `missing ${table.debugname} column ${name}`);
  return index;
}
const herbColumns = Object.fromEntries(['seed', 'produce', 'first', 'mature', 'last', 'diseased', 'level', 'plant_xp', 'harvest_xp', 'name']
  .map(name => [name, column(herbTable, name)]));
const herbRows = types.DbRowType.getInTable(herbTable.id);
const rowValue = (row, name) => row.getValue(herbColumns[name], 0)[0];
const rowForSeed = new Map(herbRows.map(row => [rowValue(row, 'seed'), row]));

const dateHandler = Runner.HANDLERS[ScriptOpcode.DATE_MINUTES];
let minute = 600;
Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(minute);
try {
  test('14 independently pinned herb rows drive direct seed and stage cases', () => {
    assert.equal(herbRows.length, herbs.length, 'ordinary herb table has exactly fourteen rows');
    const p = player();
    for (const herb of herbs) {
      const row = rowForSeed.get(id('ObjType', herb.seed));
      assert(row, `row for ${herb.seed}`);
      assert.equal(rowValue(row, 'produce'), id('ObjType', herb.produce), `${herb.name} unidentified produce`);
      assert.equal(rowValue(row, 'first'), herb.first, `${herb.name} first byte`);
      assert.equal(rowValue(row, 'mature'), herb.mature, `${herb.name} mature byte`);
      assert.equal(rowValue(row, 'last'), herb.last, `${herb.name} final harvest byte`);
      assert.equal(rowValue(row, 'diseased'), herb.diseased, `${herb.name} compressed diseased byte`);
      assert.equal(rowValue(row, 'level'), herb.level, `${herb.name} Farming gate`);
      assert.equal(rowValue(row, 'plant_xp'), herb.plantXp, `${herb.name} planting XP tenths`);
      assert.equal(rowValue(row, 'harvest_xp'), herb.harvestXp, `${herb.name} per-pick XP tenths`);
      assert.equal(rowValue(row, 'name'), herb.name.replace('_', ' '), `${herb.name} display key`);
      assert.equal(proc(p, 'farming_herb_seed', id('ObjType', herb.seed)).popInt(), row.id, `${herb.name} seed switch`);
      for (let value = herb.first; value <= herb.last; value++) {
        assert.equal(proc(p, 'farming_herb_crop', value).popInt(), row.id, `${herb.name} healthy stage ${value}`);
      }
      for (let offset = 0; offset < 3; offset++) {
        assert.equal(proc(p, 'farming_herb_crop', herb.diseased + offset).popInt(), row.id,
          `${herb.name} diseased stage ${herb.diseased + offset}`);
      }
    }
  });

  test('all four cache parents expose every healthy, compressed disease, and shared death form', () => {
    for (const name of patchNames) {
      const config = types.LocType.get(id('LocType', name));
      const visibleName = value => types.LocType.get(config.multiloc[value]).debugname;
      for (const herb of herbs) {
        for (let offset = 0; offset <= 6; offset++) {
          const visible = offset === 0 ? 'herb_seed'
            : offset < 4 ? `herb_${offset}` : 'herb_fullygrown';
          assert.equal(visibleName(herb.first + offset), visible, `${name} byte ${herb.first + offset}`);
        }
        for (let offset = 0; offset < 3; offset++) {
          assert.equal(visibleName(herb.diseased + offset), `herb_${offset + 1}_diseased`,
            `${name} compressed disease byte ${herb.diseased + offset}`);
          assert.equal(visibleName(170 + offset), `herb_${offset + 1}_dead`, `${name} shared death byte ${170 + offset}`);
        }
      }
      assert.equal(config.multivarbit, selectors[patchNames.indexOf(name)], `${name} owns its cache selector`);
    }
    for (const name of ['herb_seed_watered', 'herb_1_watered', 'herb_2_watered', 'herb_3_watered']) {
      assert.equal(types.LocType.getId(name), -1, `${name} is not a revision-377 visible form`);
    }
  });

  for (const herb of herbs) {
    test(`${herb.name}: native seed packet enforces level, one seed, dibber, and planting XP`, () => {
      const under = fixture({ level: herb.level - 1 });
      add(under, herb.seed); add(under, 'dibber');
      assert(use(under, herb.seed, patchLocs[0]));
      assert.equal(stage(under), 3); assert.equal(count(under, herb.seed), 1); assert.equal(farmingXp(under), 0);

      const noDibber = fixture({ level: herb.level });
      add(noDibber, herb.seed);
      assert(use(noDibber, herb.seed, patchLocs[0]));
      assert.equal(stage(noDibber), 3); assert.equal(count(noDibber, herb.seed), 1); assert.equal(farmingXp(noDibber), 0);

      const planted = fixture({ level: herb.level });
      add(planted, herb.seed); add(planted, 'dibber');
      assert(use(planted, herb.seed, patchLocs[0]));
      assert.equal(stage(planted), herb.first);
      assert.equal(count(planted, herb.seed), 0, 'one seed is consumed');
      assert.equal(count(planted, 'dibber'), 1, 'dibber is retained');
      assert.equal(farmingXp(planted), herb.plantXp, 'planting XP is recorded in tenths');
    });
  }

  test('herb clock row is 20 minutes and four actual shared-timer windows reach maturity', () => {
    // CANDIDATE: pre-rework OSRS Farming revision 5658331 explicitly gives
    // herbs 20-minute cycles. Period Tip.It instead reports five-minute ticks
    // and 75 minutes total; the original index-to-tick mapping is unresolved.
    const growthTable = types.DbTableType.getByName('farming_growth');
    assert(growthTable);
    const periodColumn = column(growthTable, 'period');
    const handlerColumn = column(growthTable, 'handler');
    const herbGrowthRows = types.DbRowType.getInTable(growthTable.id)
      .filter(row => row.getValue(handlerColumn, 0)[0] === 2);
    assert.equal(herbGrowthRows.length, 1, 'one shared row dispatches the herb family');
    assert.equal(herbGrowthRows[0].getValue(periodColumn, 0)[0], 20);

    const herb = herbs[0];
    const p = fixture({ level: 99, stage: herb.first });
    minute = 605; proc(p, 'farming_login');
    assert.equal(p.timers.get(growthTimer.id).interval, 500);
    assert.equal(p.timers.get(growthTimer.id).type, PlayerTimerType.NORMAL);
    for (const [at, expected] of [[610, herb.first], [620, herb.first + 1], [640, herb.first + 2],
      [660, herb.first + 3], [680, herb.mature]]) {
      minute = at;
      JavaRandom.setSeed(draws128.get(127));
      World.currentTick += 500;
      p.processTimers(PlayerTimerType.NORMAL);
      assert.equal(stage(p), expected, `herb advances at shared clock minute ${at}`);
    }
  });

  test('compressed herb disease rolls, cure, and the three shared dead forms use native packets', () => {
    const probe = player();
    const herb = herbs[0];
    for (const draw of [0, 19]) {
      JavaRandom.setSeed(draws128.get(draw));
      assert.equal(proc(probe, 'farming_herb_advance', herb.first + 1, 1, 0).popInt(), herb.diseased);
    }
    for (const draw of [20, 127]) {
      JavaRandom.setSeed(draws128.get(draw));
      assert.equal(proc(probe, 'farming_herb_advance', herb.first + 1, 1, 0).popInt(), herb.first + 2);
    }
    JavaRandom.setSeed(draws128.get(0));
    assert.equal(proc(probe, 'farming_herb_advance', herb.first, 1, 0).popInt(), herb.first + 1,
      'the seed stage advances without a disease roll');
    assert.equal(proc(probe, 'farming_herb_advance', herb.mature, 1000, 0).popInt(), herb.mature,
      'mature herbs stop advancing');

    for (const crop of herbs) {
      for (let offset = 0; offset < 3; offset++) {
        JavaRandom.setSeed(draws128.get(0));
        assert.equal(proc(probe, 'farming_herb_advance', crop.first + 1 + offset, 1, 0).popInt(), crop.diseased + offset,
          `${crop.name} growth maps to compressed disease byte ${crop.diseased + offset}`);
        JavaRandom.setSeed(draws128.get(127));
        assert.equal(proc(probe, 'farming_herb_advance', crop.diseased + offset, 1, 0).popInt(), 170 + offset,
          `${crop.name} disease advances to shared dead byte ${170 + offset}`);
      }
      JavaRandom.setSeed(draws128.get(0));
      assert.equal(proc(probe, 'farming_herb_advance', crop.first, 1, 0).popInt(), crop.first + 1);
      assert.equal(proc(probe, 'farming_herb_advance', crop.mature, 1000, 0).popInt(), crop.mature);
      for (let offset = 1; offset <= 3; offset++) {
        JavaRandom.setSeed(draws128.get(127));
        assert.equal(proc(probe, 'farming_herb_advance', crop.first + offset, 1, 0).popInt(), crop.first + offset + 1,
          `${crop.name} healthy growing stage ${offset} advances without crossing its band`);
      }
    }
    for (const crop of herbs) {
      for (let offset = 0; offset < 3; offset++) {
        const diseased = fixture({ stage: crop.diseased + offset });
        add(diseased, 'plant_cure');
        const xp = farmingXp(diseased);
        assert(use(diseased, 'plant_cure', patchLocs[0]));
        assert.equal(stage(diseased), crop.first + 1 + offset);
        assert.equal(count(diseased, 'plant_cure'), 0);
        assert.equal(count(diseased, 'vial_empty'), 1);
        assert.equal(farmingXp(diseased), xp, 'curing awards no Farming XP');
      }
    }
    for (let offset = 0; offset < 3; offset++) {
      const dead = fixture({ stage: 170 + offset });
      add(dead, 'spade');
      const deadXp = farmingXp(dead);
      assert(use(dead, 'spade', patchLocs[0]));
      assert.equal(stage(dead), 3, 'spade clears the shared dead form');
      assert.equal(count(dead, 'spade'), 1, 'spade is retained');
      assert.equal(farmingXp(dead), deadXp, 'clearing awards no XP');
    }
  });

  test('watering cans have no herb effect, dose cost, or watered cache state', () => {
    for (const herb of herbs) {
      for (let offset = 1; offset <= 3; offset++) {
        const p = fixture({ stage: herb.first + offset });
        add(p, 'watering_can_8');
        const beforeXp = farmingXp(p);
        assert(use(p, 'watering_can_8', patchLocs[0]));
        assert.equal(stage(p), herb.first + offset, `${herb.name} stage ${offset} is unchanged`);
        assert.equal(count(p, 'watering_can_8'), 1, 'full can retains its dose');
        assert.equal(count(p, 'watering_can_7'), 0, 'no charged can is created');
        assert.equal(farmingXp(p), beforeXp, 'watering grants no XP');
      }
    }
  });

  for (const herb of herbs) {
    test(`${herb.name}: native Pick requires a spade and yields three unidentified herbs with XP per pick`, () => {
      const p = fixture({ level: 1, stage: herb.mature });
      add(p, 'spade');
      for (let pick = 0; pick < 3; pick++) {
        World.currentTick += 2; // CANDIDATE OSRS manual harvest interval.
        JavaRandom.setSeed(draws256.get(0));
        assert(click(p, patchLocs[0], 1));
        assert.equal(count(p, herb.produce), pick + 1, `pick ${pick + 1} gives one ${herb.produce}`);
        assert.equal(farmingXp(p), herb.harvestXp * (pick + 1), `pick ${pick + 1} grants its own XP`);
        assert.equal(stage(p), pick < 2 ? herb.mature + pick + 1 : 3, `pick ${pick + 1} spends one life`);
      }
      assert.equal(count(p, 'spade'), 1, 'harvesting retains the required spade');
      assert.equal(count(p, 'dibber'), 0, 'harvesting does not require a dibber');
    });
  }

  test('herb life-saving interpolation retains three minimum harvest lives', () => {
    const lowLevel = fixture({ level: 1, stage: herbs[0].mature });
    const highLevel = fixture({ level: 99, stage: herbs[0].mature });
    assert.equal(proc(lowLevel, 'farming_herb_life_loss').popInt(), 191);
    assert.equal(proc(highLevel, 'farming_herb_life_loss').popInt(), 175,
      'herb high endpoint is 80/256, distinct from the allotment endpoint');
    for (const [level, draw, expected] of [
      [1, 190, herbs[0].mature + 1], [1, 191, herbs[0].mature],
      [99, 174, herbs[0].mature + 1], [99, 175, herbs[0].mature],
    ]) {
      const p = fixture({ level, stage: herbs[0].mature });
      add(p, 'spade');
      JavaRandom.setSeed(draws256.get(draw));
      assert(click(p, patchLocs[0], 1));
      assert.equal(stage(p), expected, `life loss boundary at level ${level}, draw ${draw}`);
    }
    const p = fixture({ level: 99, stage: herbs[0].mature });
    add(p, 'spade');
    JavaRandom.setSeed(draws256.get(255));
    assert(click(p, patchLocs[0], 1));
    assert.equal(stage(p), herbs[0].mature, 'a high random draw saves the life');
    assert.equal(count(p, herbs[0].produce), 1);
    assert.equal(farmingXp(p), herbs[0].harvestXp);
    for (let pick = 0; pick < 3; pick++) {
      World.currentTick += 2;
      JavaRandom.setSeed(draws256.get(0));
      assert(click(p, patchLocs[0], 1));
    }
    assert.equal(stage(p), 3);
    assert.equal(count(p, herbs[0].produce), 4, 'successful life save permits more than three picks');
    assert.equal(farmingXp(p), herbs[0].harvestXp * 4);
  });

  test('full inventory refuses native picking without reward or life loss', () => {
    const herb = herbs[0];
    const p = fixture({ stage: herb.mature });
    while (p.invFreeSpace(inv) > 0) add(p, 'spade');
    assert.equal(p.invFreeSpace(inv), 0);
    const xp = farmingXp(p);
    JavaRandom.setSeed(draws256.get(0));
    assert(click(p, patchLocs[0], 1));
    assert.equal(count(p, herb.produce), 0);
    assert.equal(stage(p), herb.mature);
    assert.equal(farmingXp(p), xp);
  });

  test('all four original-map parents are collision-reachable; rake packets clear only their selector byte', () => {
    const baseline = [5, 12, 19, 26];
    for (let target = 0; target < patchLocs.length; target++) {
      const p = fixture({ patchIndex: target, level: 1, stage: null });
      const expected = [...baseline]; expected[target] = 0;
      expected.forEach((value, index) => setStage(p, value, index));
      const pack = values => values.reduce((word, value, index) => word | (value << (index * 8)), 0);
      assert.equal(p.getVar(herbVarp), pack(expected), 'four selector bytes start isolated in original varp 515');
      add(p, 'rake');
      for (let next = 1; next <= 3; next++) {
        assert(use(p, 'rake', patchLocs[target]));
        expected[target] = next;
        assert.deepEqual(selectors.map(bit => p.getVarBit(bit)), expected,
          `${patchNames[target]} rake ${next} leaves the other three selector bytes untouched`);
        assert.equal(p.getVar(herbVarp), pack(expected), 'raw packed selector word changes only in selected byte');
      }
      assert.equal(count(p, 'rake'), 1, 'rake is retained');
    }
  });

  test('one shared reconciliation advances potato and herbs without corrupting the growth-row cursor', () => {
    const potatoSelector = id('VarBitType', 'farming_allotment_varp_1_0_7');
    const p = player();
    setStage(p, herbs[0].first);
    p.setVarBit(potatoSelector, 6);
    p.setVar(clock, 595);
    minute = 616;
    JavaRandom.setSeed(draws128.get(127));
    proc(p, 'farming_reconcile', 1);
    assert.equal(stage(p), herbs[0].first + 1, 'one completed 20-minute herb window is dispatched');
    assert.equal(p.getVarBit(potatoSelector), 8, 'both potato windows still dispatch after the herb family');
    assert.equal(p.getVar(clock), minute, 'shared checkpoint is consumed once');
  });

  test('herb selector and growth checkpoint survive save/load and offline reconciliation is idempotent', () => {
    const herb = herbs[0];
    const p = fixture({ stage: herb.first });
    minute = 605; proc(p, 'farming_login');
    minute = 609; proc(p, 'farming_logout');
    assert.equal(p.timers.get(growthTimer.id), undefined, 'logout clears the shared timer');
    const loaded = player(p.save());
    assert.equal(stage(loaded), herb.first);
    assert.equal(loaded.getVar(clock), 609);
    minute = 625;
    JavaRandom.setSeed(draws128.get(127));
    proc(loaded, 'farming_login');
    assert.equal(stage(loaded), herb.first + 1, 'one completed offline 20-minute window advances the saved herb');
    assert(loaded.timers.get(growthTimer.id), 'login restores the shared timer');
    proc(loaded, 'farming_reconcile', 1);
    assert.equal(stage(loaded), herb.first + 1, 'same-minute reconciliation does not repeat growth');
    const savedAgain = player(loaded.save());
    assert.equal(stage(savedAgain), herb.first + 1, 'advanced herb selector survives another save/load');
  });

  test('herb catch-up terminates at maturity or shared death and preserves non-herb bytes', () => {
    const p = player();
    for (const herb of herbs) {
      JavaRandom.setSeed(draws128.get(0));
      assert.equal(proc(p, 'farming_herb_advance', herb.first + 3, 1000000, 0).popInt(), 172,
        `${herb.name} last growing stage can disease and die during long catch-up`);
      for (let life = herb.mature; life <= herb.last; life++) {
        assert.equal(proc(p, 'farming_herb_advance', life, 1000000, 0).popInt(), life,
          `${herb.name} catch-up never consumes a harvest life`);
      }
    }
    for (const value of [0, 1, 2, 3, 60, 67, 110, 127, 170, 171, 172, 173, 191, 192, 203, 255]) {
      assert.equal(proc(p, 'farming_herb_advance', value, 1000000).popInt(), value,
        `unsupported or terminal byte ${value}, including quest goutweed, stays exact`);
    }
  });
} finally {
  Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = dateHandler;
}
console.log(`Herb compiled checks: ${cases - failures}/${cases} passed`);
process.exit(failures ? 1 : 0);
