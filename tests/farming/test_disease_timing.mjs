/** Compiled timing proof, not a claim about historical disease rates.
 * node --import tsx ../content/tests/farming/test_disease_timing.mjs
 * Optional --baseline-pack PATH compares healthy traces with a retained pack.
 * No baseline traces or generated identities enter the registered test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  World, Runner, Scripts, ScriptOpcode, JavaRandom, types, id, player, proc,
  add, count, use, load
} from './runtime.mjs';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const clock = id('VarPlayerType', 'farming_growth_minute');
const protection = id('VarPlayerType', 'farming_protection');
const map = await load('engine/GameMap.ts');
const families = [
  { name: 'allotment', table: 'farming_allotment', growth: 'potato', period: 10, diseasePeriod: 20,
    advance: 'farming_allotment_advance', word: 'farming_allotment_varp_1', patch: 'farming_veg_patch_1', waterable: true },
  { name: 'flower', table: 'farming_flower', growth: 'flower', period: 5, diseasePeriod: 10,
    advance: 'farming_flower_advance', word: 'farming_flower_varp', patch: 'farming_flower_patch_1', waterable: true },
  { name: 'herb', table: 'farming_herb', growth: 'herb', period: 20, diseasePeriod: 40,
    advance: 'farming_herb_advance', word: 'varp515_bits', patch: 'farming_herb_patch_1', waterable: false },
  { name: 'hops', table: 'farming_hops', growth: 'hops', period: 10, diseasePeriod: 20,
    advance: 'farming_hops_advance', word: 'farming_hops_varp', patch: 'farming_hops_patch_1', waterable: true }
];
function field(table, row, name) {
  const column = table.columnNames.indexOf(name);
  assert(column >= 0, `missing compiled ${table.debugname}:${name}`);
  return row.getValue(column, 0)[0];
}
function crops(family) {
  const table = types.DbTableType.getByName(family.table);
  assert(table);
  return types.DbRowType.getInTable(table.id).map(row => ({
    row: row.id, name: row.debugname,
    first: field(table, row, 'first'), mature: field(table, row, 'mature'),
    diseased: family.name === 'herb' ? field(table, row, 'diseased') : field(table, row, 'first') + 129,
    dead: family.name === 'herb' ? 170 : field(table, row, 'first') + 193
  }));
}
const set = (p, family, value) => p.setVar(id('VarPlayerType', family.word), value);
const stage = (p, family) => p.getVar(id('VarPlayerType', family.word)) & 255;
function fixture(family, value, last) {
  const p = player();
  p.setVar(clock, last);
  set(p, family, value);
  return p;
}
let minute = 640;
const dateHandler = Runner.HANDLERS[ScriptOpcode.DATE_MINUTES];
Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(minute);
function reconcile(p, at, offline = false) {
  minute = at;
  proc(p, 'farming_reconcile', offline ? 1 : 0);
}
function witness(draw) {
  for (let seed = 0; seed < 200000; seed++) {
    JavaRandom.setSeed(seed);
    if (Math.floor(JavaRandom.nextDouble() * 128) === draw) return seed;
  }
  assert.fail(`no native RNG witness for ${draw}/128`);
}
const diseaseSeed = witness(0), healthySeed = witness(127), waterSeed = witness(15);
let cases = 0, sweepCases = 0;
function test(name, action) {
  action();
  cases++;
  console.log(`PASS ${name}`);
}

// Resolve native care against original map parents, not a synthetic loc.
const patches = new Map(families.map(family => [family.patch, null]));
for (const filename of fs.readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name))) {
  const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(filename).map(Number);
  let section;
  for (const line of fs.readFileSync(path.join(content, 'maps', filename), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    if (section !== 'LOC') continue;
    const match = /^([0-3]) (\d+) (\d+): (\d+)(?: |$)/.exec(line);
    if (!match) continue;
    const [level, x, z, type] = match.slice(1).map(Number);
    const name = types.LocType.get(type).debugname;
    if (patches.has(name) && !patches.get(name)) patches.set(name, World.getLoc(mx * 64 + x, mz * 64 + z, level, type));
  }
}
function approach(p, family) {
  const loc = patches.get(family.patch);
  assert(loc, `original ${family.patch} exists`);
  const config = types.LocType.get(loc.type);
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    if (!map.isMapBlocked(loc.x + dx, loc.z + dz, loc.level) &&
      map.reachedLoc(loc.level, loc.x + dx, loc.z + dz, loc.x, loc.z, config.width,
        config.length, 1, loc.angle, loc.shape, config.forceapproach)) {
      p.x = loc.x + dx; p.z = loc.z + dz; p.level = loc.level;
      return loc;
    }
  }
  assert.fail(`no reachable adjacent tile for ${family.patch}`);
}

try {
  for (const family of families) {
    test(`${family.name}: UNKNOWN next tier is ${family.diseasePeriod} minutes; healthy period stays ${family.period}`, () => {
      const table = types.DbTableType.getByName('farming_growth');
      const row = types.DbRowType.get(id('DbRowType', `farming_growth_${family.growth}`));
      assert.equal(field(table, row, 'period'), family.period);
      assert.equal(field(table, row, 'disease_period'), family.diseasePeriod);
    });
    test(`${family.name}: every crop and diseased stage waits through healthy-only windows, then dies once`, () => {
      for (const crop of crops(family)) for (let offset = 0; offset < crop.mature - crop.first - 1; offset++) {
        const p = fixture(family, crop.diseased + offset, 640);
        reconcile(p, 640 + family.period);
        assert.equal(stage(p, family), crop.diseased + offset, crop.name);
        reconcile(p, 640 + family.period + 4);
        assert.equal(stage(p, family), crop.diseased + offset, 'same window never repeats');
        reconcile(p, 640 + family.diseasePeriod);
        assert.equal(stage(p, family), crop.dead + offset, crop.name);
        reconcile(p, 640 + family.diseasePeriod + 4);
        reconcile(p, 640 + family.diseasePeriod * 2);
        assert.equal(stage(p, family), crop.dead + offset, 'death remains terminal');
        p.unlink();
      }
    });
    test(`${family.name}: native cure works at every minute before the first later slow window`, () => {
      const crop = crops(family)[0];
      for (const diseaseAt of [640, 640 + family.period]) {
        const deadline = 640 + family.diseasePeriod;
        for (let cureAt = diseaseAt; cureAt < deadline; cureAt++) {
          const p = fixture(family, crop.first + 1, diseaseAt - 1);
          JavaRandom.setSeed(diseaseSeed);
          reconcile(p, diseaseAt);
          assert.equal(stage(p, family), crop.diseased, 'entry consumes this step, even on a slow window');
          reconcile(p, cureAt);
          assert.equal(stage(p, family), crop.diseased);
          add(p, 'plant_cure');
          assert(use(p, 'plant_cure', approach(p, family)));
          assert.equal(stage(p, family), crop.first + 1);
          assert.equal(count(p, 'plant_cure'), 0);
          assert.equal(count(p, 'vial_empty'), 1);
          JavaRandom.setSeed(healthySeed);
          reconcile(p, deadline);
          assert.equal(stage(p, family), crop.first + 2, 'cure restores growth, not a dead crop');
          p.unlink();
        }
      }
    });
    test(`${family.name}: logout/save/load preserves disease until the completed slow window`, () => {
      const crop = crops(family)[0];
      const p = fixture(family, crop.diseased, 640);
      minute = 641; proc(p, 'farming_logout');
      const loaded = player(p.save());
      assert.equal(stage(loaded, family), crop.diseased);
      minute = 640 + family.period + 5; proc(loaded, 'farming_login');
      assert.equal(stage(loaded, family), crop.diseased, 'healthy-only offline window does not kill');
      const again = player(loaded.save());
      minute = 640 + family.diseasePeriod + 4; proc(again, 'farming_login');
      assert.equal(stage(again, family), crop.diseased, 'an open offline window is not replayed early');
      // A fresh save checkpoint is still before that slow window. Login does
      // not reconstruct time already consumed by a different online session.
      const completed = player(p.save());
      minute = 640 + family.diseasePeriod + 5; proc(completed, 'farming_login');
      assert.equal(stage(completed, family), crop.dead);
      proc(completed, 'farming_reconcile', 1);
      assert.equal(stage(completed, family), crop.dead);
      for (const q of [p, loaded, again, completed]) q.unlink();
    });
    if (family.waterable) test(`${family.name}: the published dry/watered disease thresholds and one-cycle water remain`, () => {
      const crop = crops(family)[0];
      for (const wet of [false, true]) {
        const p = fixture(family, crop.first + 1 + (wet ? 64 : 0), 640);
        JavaRandom.setSeed(waterSeed);
        reconcile(p, 640 + family.period);
        assert.equal(stage(p, family), wet ? crop.first + 2 : crop.diseased);
        JavaRandom.setSeed(healthySeed);
        reconcile(p, 640 + family.diseasePeriod);
        assert.equal(stage(p, family), wet ? crop.first + 3 : crop.dead);
        p.unlink();
      }
    });
    test(`${family.name}: exhaustive start-minute and end-minute sweep agrees with online completed windows`, () => {
      const crop = crops(family).reduce((a, b) => a.mature - a.first >= b.mature - b.first ? a : b);
      const initial = [crop.first, crop.first + 1, crop.diseased];
      if (family.waterable) initial.push(crop.first + 65);
      const horizon = (crop.mature - crop.first + 2) * family.period + 5;
      const online = player(), offline = player();
      for (let phase = 0; phase < family.diseasePeriod; phase++) {
        const start = 640 + phase;
        for (const value of initial) for (const seed of [0, diseaseSeed, healthySeed]) {
          set(online, family, value); online.setVar(clock, start); JavaRandom.setSeed(seed);
          const states = [value], ends = [];
          // Enumerate window starts independently, without copying the product
          // divide/subtract formula. Each oracle step runs production online.
          for (let at = start + 1; at <= start + horizon; at++) if (at % family.period === 0) {
            reconcile(online, at + 4);
            states.push(stage(online, family)); ends.push(at + 5);
          }
          for (let elapsed = 0; elapsed <= horizon; elapsed++) {
            const now = start + elapsed;
            const seen = ends.filter(end => end <= now).length;
            set(offline, family, value); offline.setVar(clock, start); JavaRandom.setSeed(seed);
            reconcile(offline, now, true);
            assert.equal(stage(offline, family), states[seen],
              `${family.name} start=${start} now=${now} initial=${value} seed=${seed} completed=${seen}`);
            assert.equal(proc(offline, 'farming_growth_steps', start, now, family.period, 1).popInt(), seen);
            reconcile(offline, now, true);
            assert.equal(stage(offline, family), states[seen], 'same checkpoint is idempotent');
            sweepCases++;
          }
        }
      }
      online.unlink(); offline.unlink();
    });
  }
  test('flower, scarecrow and paid protection prevent new disease but do not cure or accelerate existing disease', () => {
    const family = families[0];
    for (const [cropName, flower, paid] of [
      ['farming_allotment_potato', 12, false],
      ['farming_allotment_sweetcorn', 36, false],
      ['farming_allotment_potato', 0, true]
    ]) {
      const crop = crops(family).find(row => row.name === cropName);
      assert(crop);
      for (const diseased of [false, true]) {
        const p = fixture(family, diseased ? crop.diseased : crop.first + 1, 640);
        p.setVar(id('VarPlayerType', 'farming_flower_varp'), flower);
        if (paid) p.setVar(protection, 1);
        JavaRandom.setSeed(diseaseSeed); reconcile(p, 650);
        assert.equal(stage(p, family), diseased ? crop.diseased : crop.first + 2);
        JavaRandom.setSeed(diseaseSeed); reconcile(p, 660);
        assert.equal(stage(p, family), diseased ? crop.dead : crop.first + 3);
        p.unlink();
      }
    }
    const hops = families[3], crop = crops(hops)[0];
    for (const diseased of [false, true]) {
      const p = fixture(hops, diseased ? crop.diseased : crop.first + 1, 640);
      p.setVar(protection, 1 << 8);
      JavaRandom.setSeed(diseaseSeed); reconcile(p, 650);
      assert.equal(stage(p, hops), diseased ? crop.diseased : crop.first + 2);
      JavaRandom.setSeed(diseaseSeed); reconcile(p, 660);
      assert.equal(stage(p, hops), diseased ? crop.dead : crop.first + 3);
      p.unlink();
    }
  });
  test('long potato absence cannot truncate the later slow window after final-stage disease', () => {
    let seed;
    for (let candidate = 0; candidate < 200000; candidate++) {
      JavaRandom.setSeed(candidate);
      const draws = Array.from({ length: 3 }, () => Math.floor(JavaRandom.nextDouble() * 128));
      if (draws[0] >= 20 && draws[1] >= 20 && draws[2] < 20) { seed = candidate; break; }
    }
    assert.notEqual(seed, undefined);
    const p = fixture(families[0], 6, 640);
    JavaRandom.setSeed(seed); reconcile(p, 705, true);
    assert.equal(stage(p, families[0]), 201, '650 seed, 660 growth, 670 growth, 680 disease, 700 death');
    p.unlink();
  });
  const baselineIndex = process.argv.indexOf('--baseline-pack');
  if (baselineIndex >= 0) test('all healthy growth and disease-entry byte traces match the retained published pack', () => {
    const baseline = process.argv[baselineIndex + 1];
    assert(baseline, '--baseline-pack requires a directory');
    const current = path.join(engine, 'data/pack');
    function traces(legacy) {
      const result = [];
      const p = player();
      for (const family of families) for (const crop of crops(family)) {
        for (let initial = crop.first; initial < crop.mature; initial++) {
          for (const wet of family.waterable ? [false, true] : [false]) for (let seed = 0; seed < 32; seed++) {
            let value = initial + (wet ? 64 : 0);
            JavaRandom.setSeed(seed);
            const bytes = [value];
            for (let step = 0; step < crop.mature - crop.first; step++) {
              const args = [value, 1];
              if (family.name === 'allotment') args.push(crop.row);
              if (!legacy) args.push(640 + step * family.period);
              value = proc(p, family.advance, ...args).popInt();
              bytes.push(value);
              if (value >= 128 || value >= crop.mature && value < 64) break;
            }
            result.push([family.name, crop.name, initial, wet, seed, bytes]);
          }
        }
      }
      p.unlink();
      return Buffer.from(JSON.stringify(result));
    }
    const actual = traces(false);
    try {
      for (const type of Object.values(types)) type.load(baseline);
      assert(Scripts.load(baseline) > 0);
      assert.equal(Buffer.compare(actual, traces(true)), 0, 'healthy states and disease-entry states are byte-identical');
    } finally {
      for (const type of Object.values(types)) type.load(current);
      assert(Scripts.load(current) > 0);
    }
  });
} finally {
  Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = dateHandler;
}
console.log(`Farming disease timing compiled checks: ${cases}/${cases} passed; exhaustive ranges=${sweepCases}`);
process.exit(0);
