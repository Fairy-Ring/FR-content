/** Compiled compost application and crop-treatment matrix. Run from sibling engine:
 * node --import tsx ../content/tests/farming/test_compost.mjs
 * Native item-on-loc and loc-click packets exercise the packed patch dispatch.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  World, Runner, ScriptOpcode, PlayerStat, JavaRandom,
  types, id, player, proc, add, count, use, click, load
} from './runtime.mjs';

const gameMap = await load('engine/GameMap.ts');
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const groupSpecs = [
  {
    family: 'allotment', baseIndex: 0, handler: 1,
    advanceAll: 'farming_potato_advance_all',
    patchNames: Array.from({ length: 8 }, (_, index) => `farming_veg_patch_${index + 1}`),
    selectorVars: ['farming_allotment_varp_1', 'farming_allotment_varp_2'],
    waterable: true,
  },
  {
    family: 'hops', baseIndex: 8, handler: 4,
    advanceAll: 'farming_hops_advance_all',
    patchNames: Array.from({ length: 4 }, (_, index) => `farming_hops_patch_${index + 1}`),
    selectorVars: ['farming_hops_varp'], waterable: true,
  },
  {
    family: 'flower', baseIndex: 12, handler: 3,
    advanceAll: 'farming_flower_advance_all',
    patchNames: Array.from({ length: 4 }, (_, index) => `farming_flower_patch_${index + 1}`),
    selectorVars: ['farming_flower_varp'], waterable: true,
  },
  {
    family: 'herb', baseIndex: 16, handler: 2,
    advanceAll: 'farming_herb_advance_all',
    patchNames: Array.from({ length: 4 }, (_, index) => `farming_herb_patch_${index + 1}`),
    selectorVars: ['varp515_bits'], waterable: false,
  },
];
const allPatchNames = groupSpecs.flatMap(group => group.patchNames);
const mapPlacements = new Map(allPatchNames.map(name => [name, []]));
for (const filename of fs.readdirSync(path.join(content, 'maps'))
  .filter(name => /^m\d+_\d+\.jm2$/.test(name)).sort()) {
  const [, mapX, mapZ] = /^m(\d+)_(\d+)\.jm2$/.exec(filename).map(Number);
  let section;
  for (const line of fs.readFileSync(path.join(content, 'maps', filename), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    if (section !== 'LOC') continue;
    const match = /^([0-3]) (\d+) (\d+): (\d+)(?: (\d+))?(?: (\d+))?$/.exec(line);
    if (!match) continue;
    const [, level, x, z, type] = match.map(Number);
    const name = types.LocType.get(type).debugname;
    if (!mapPlacements.has(name)) continue;
    const loc = World.getLoc(mapX * 64 + x, mapZ * 64 + z, level, type);
    assert(loc, `original map contains packed ${name}`);
    mapPlacements.get(name).push(loc);
  }
}
const patches = new Map();
for (const name of allPatchNames) {
  const placements = mapPlacements.get(name);
  assert(placements.length > 0, `original map placement for ${name}`);
  placements.sort((a, b) => a.x - b.x || a.z - b.z || a.level - b.level);
  const loc = placements[0];
  const selector = types.LocType.get(loc.type).multivarbit;
  assert(Number.isInteger(selector) && selector >= 0, `${name} retains its original patch-byte selector`);
  patches.set(name, { name, loc, selector });
}
const selectorIds = [...patches.values()].map(patch => patch.selector);
assert.equal(new Set(selectorIds).size, 20, 'all 20 original patch selectors are independent');
for (const group of groupSpecs) {
  const expectedVars = group.selectorVars.map(name => id('VarPlayerType', name));
  for (const [offset, patchName] of group.patchNames.entries()) {
    const patch = patches.get(patchName);
    const basevar = types.VarBitType.get(patch.selector).basevar;
    const expected = group.family === 'allotment' && offset >= 4 ? expectedVars[1] : expectedVars[0];
    assert.equal(basevar, expected, `${patchName} is on its original selector word`);
  }
}

function column(table, name) {
  const index = table.columnNames.indexOf(name);
  assert(index >= 0, `missing ${table.debugname} column ${name}`);
  return index;
}
function readRows(tableName, fields) {
  const table = types.DbTableType.getByName(tableName);
  assert(table, `compiled ${tableName} table`);
  const columns = Object.fromEntries(fields.map(name => [name, column(table, name)]));
  return types.DbRowType.getInTable(table.id).map(row => ({
    ...Object.fromEntries(fields.map(name => [name, row.getValue(columns[name], 0)[0]])),
    row,
  }));
}
const cropRows = {
  allotment: readRows('farming_allotment', ['seed', 'produce', 'first', 'mature', 'last', 'harvest_xp', 'singular']),
  hops: readRows('farming_hops', ['seed', 'produce', 'first', 'mature', 'last', 'seed_count', 'harvest_xp', 'plural']),
  flower: readRows('farming_flower', ['seed', 'produce', 'first', 'mature', 'yield', 'harvest_xp', 'name']),
  herb: readRows('farming_herb', ['seed', 'produce', 'first', 'mature', 'last', 'diseased', 'harvest_xp', 'name']),
};
const cropLabel = {
  allotment: crop => crop.singular,
  hops: crop => crop.plural,
  flower: crop => crop.name,
  herb: crop => crop.name,
};
for (const group of groupSpecs) {
  cropRows[group.family].sort((a, b) => String(cropLabel[group.family](a)).localeCompare(String(cropLabel[group.family](b))));
}
const growthTable = types.DbTableType.getByName('farming_growth');
assert(growthTable, 'compiled farming_growth table');
const growthHandlerColumn = column(growthTable, 'handler');
const growthPeriodColumn = column(growthTable, 'period');
const growthDiseasePeriodColumn = column(growthTable, 'disease_period');
const growthRows = types.DbRowType.getInTable(growthTable.id);
function periodFor(group, disease = false) {
  const row = growthRows.find(candidate => candidate.getValue(growthHandlerColumn, 0)[0] === group.handler);
  assert(row, `one growth row for ${group.family}`);
  return row.getValue(disease ? growthDiseasePeriodColumn : growthPeriodColumn, 0)[0];
}

const stageIndex = patchName => {
  const group = groupSpecs.find(candidate => candidate.patchNames.includes(patchName));
  assert(group, `patch family for ${patchName}`);
  return group.baseIndex + group.patchNames.indexOf(patchName);
};
const treatment = (p, index) => proc(p, 'farming_soil_treatment', index).popInt();
const extra = (p, index) => proc(p, 'farming_soil_extra', index).popInt();
const allTreatments = p => Array.from({ length: 20 }, (_, index) => treatment(p, index));
const allExtras = p => Array.from({ length: 20 }, (_, index) => extra(p, index));
const farmingXp = p => p.stats[PlayerStat.FARMING] - p.farmingStartXp;
function setPosition(p, patch) {
  const config = types.LocType.get(patch.loc.type);
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const x = patch.loc.x + dx, z = patch.loc.z + dz;
    if (gameMap.isMapBlocked(x, z, patch.loc.level)) continue;
    if (!gameMap.reachedLoc(patch.loc.level, x, z, patch.loc.x, patch.loc.z,
      config.width, config.length, 1, patch.loc.angle, patch.loc.shape, config.forceapproach)) continue;
    p.x = x; p.z = z; p.level = patch.loc.level;
    return;
  }
  assert.fail(`${patch.name} has no collision-valid adjacent approach`);
}
function fixture(patchName, initialStage = 3) {
  const p = player();
  const patch = patches.get(patchName);
  assert(patch, `packed patch ${patchName}`);
  setPosition(p, patch);
  p.setLevel(PlayerStat.FARMING, 99);
  p.farmingStartXp = p.stats[PlayerStat.FARMING];
  p.setVar(id('VarPlayerType', 'action_delay'), 0);
  p.setVarBit(patch.selector, initialStage);
  return p;
}
function useBucket(p, patchName, bucket) {
  const patch = patches.get(patchName);
  setPosition(p, patch);
  return use(p, bucket, patch.loc);
}
function useSpade(p, patchName) {
  const patch = patches.get(patchName);
  setPosition(p, patch);
  return use(p, 'spade', patch.loc);
}
function clickPatch(p, patchName) {
  const patch = patches.get(patchName);
  setPosition(p, patch);
  return click(p, patch.loc, 1);
}
function setStage(p, patchName, stage) {
  p.setVarBit(patches.get(patchName).selector, stage);
}
function getStage(p, patchName) {
  return p.getVarBit(patches.get(patchName).selector);
}
function itemCount(p, name) {
  return count(p, name);
}
function itemName(itemId) {
  return types.ObjType.get(itemId).debugname;
}
function assertTreatmentState(p, expected) {
  assert.deepEqual(allTreatments(p), expected);
}
function witness(range, draw) {
  for (let seed = 0; seed < 200000; seed++) {
    JavaRandom.setSeed(seed);
    if (Math.floor(JavaRandom.nextDouble() * range) === draw) return seed;
  }
  assert.fail(`no JavaRandom witness for ${draw}/${range}`);
}
function sequenceWitness(range, minimum, draws) {
  for (let seed = 0; seed < 200000; seed++) {
    JavaRandom.setSeed(seed);
    let valid = true;
    for (let index = 0; index < draws; index++) {
      if (Math.floor(JavaRandom.nextDouble() * range) < minimum) { valid = false; break; }
    }
    if (valid) return seed;
  }
  assert.fail(`no JavaRandom seed for ${draws} draws >= ${minimum}/${range}`);
}
function discard(p) {
  delete World.players[p.pid];
}

function restore(saved) {
  const p = player(saved);
  // PlayerLoading derives a real name hash; the anonymous fixture's serial-only
  // UID cannot resolve a loaded player's inventory listener through World.
  const oldUid = p.uid;
  p.uid = ((Number(p.username37 & 0x1fffffn) << 11) | p.pid) >>> 0;
  for (const listener of p.invListeners) {
    if (listener.source === oldUid) listener.source = p.uid;
  }
  return p;
}

const treatmentModes = [
  { bucket: 'bucket_compost', code: 1, xp: 180, diseaseDivisor: 2, extraLives: 1 },
  { bucket: 'bucket_supercompost', code: 2, xp: 260, diseaseDivisor: 5, extraLives: 2 },
];
// VERIFIED: Tip.It 28 April 2006 says to rake, treat the soil, then plant, and
// lists application XP as 18/26. CANDIDATE: the pre-rework OSRS Farming page
// (revision 1660775, 21 April 2016) says compost is applied before seed; its
// later Fertile Soil spell path is not a bucket-on-patch action in this test.
// CANDIDATE: later OSRS rules add one/two harvest lives and reduce risk by
// 50%/80%. The target's base 20/128 and 10/128 disease risks remain UNKNOWN.
const EMPTY_TREATMENTS = Array(20).fill(0);
const extraLivesVarp = id('VarPlayerType', 'farming_soil_lives');
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
test('bonus harvest lives use saved server-only varp state', () => {
  const type = types.VarPlayerType.get(extraLivesVarp);
  assert.equal(type.scope, types.VarPlayerType.SCOPE_PERM);
  assert.equal(type.transmit, false);
});

const applicationMessages = {
  allotment: ['You treat the allotment with compost.', 'You treat the allotment with supercompost.'],
  flower: ['You treat the flower patch with compost.', 'You treat the flower patch with supercompost.'],
  herb: ['You treat the herb patch with compost.', 'You treat the herb patch with supercompost.'],
  hops: ['You treat the hops patch with compost.', 'You treat the hops patch with supercompost.'],
};

test('one operator-recalled template renders both treatments for all 20 patch fields', () => {
  // CANDIDATE: both verbatim operator answers are retained on 19 November 2026.
  const p = fixture(groupSpecs[0].patchNames[0]);
  try {
    for (const group of groupSpecs) for (const patchName of group.patchNames) {
      for (const [modeIndex, mode] of treatmentModes.entries()) {
        assert.equal(proc(p, 'farming_soil_application_message', stageIndex(patchName), mode.code).popString(),
          applicationMessages[group.family][modeIndex], `${patchName}/${mode.bucket} exact sourced wording`);
      }
    }
  } finally { discard(p); }
});

const dateHandler = Runner.HANDLERS[ScriptOpcode.DATE_MINUTES];
let minute = 0;
Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(minute);
try {
  test('native compost and supercompost map and persist all 20 original patch fields', () => {
    const p = fixture(groupSpecs[0].patchNames[0], 3);
    let loaded = null;
    try {
      for (const patchName of allPatchNames) setStage(p, patchName, 3);
      add(p, treatmentModes[0].bucket, 10);
      add(p, treatmentModes[1].bucket, 10);
      assertTreatmentState(p, EMPTY_TREATMENTS);
      const expected = EMPTY_TREATMENTS.slice();
      const inputCounts = new Map(treatmentModes.map(mode => [mode.bucket, 10]));
      for (const group of groupSpecs) for (const patchName of group.patchNames) {
        const index = stageIndex(patchName);
        const mode = treatmentModes[index % treatmentModes.length];
        const beforeXp = farmingXp(p);
        const beforeEmpty = itemCount(p, 'bucket_empty');
        const beforeMessages = p.messages.length;
        assert(useBucket(p, patchName, mode.bucket), `${patchName} accepts native item-on-loc compost`);
        assert.deepEqual(p.messages.slice(beforeMessages), [applicationMessages[group.family][mode.code - 1]],
          `${patchName} invokes exactly one recalled native game message`);
        assert.equal(getStage(p, patchName), 3, `${patchName} remains weeded`);
        inputCounts.set(mode.bucket, inputCounts.get(mode.bucket) - 1);
        assert.equal(itemCount(p, mode.bucket), inputCounts.get(mode.bucket), `${patchName} consumes one bucket`);
        assert.equal(itemCount(p, 'bucket_empty'), beforeEmpty + 1, `${patchName} returns one empty bucket`);
        assert.equal(farmingXp(p) - beforeXp, mode.xp, `${patchName} grants exact application XP`);
        expected[index] = mode.code;
        assertTreatmentState(p, expected);
        assert.equal(extra(p, index), 0, 'harvest lives initialize only when the crop matures');
        assert.equal(p.getVar(extraLivesVarp), 0, 'application does not initialize saved harvest lives');
      }
      assert.equal(itemCount(p, treatmentModes[0].bucket), 0);
      assert.equal(itemCount(p, treatmentModes[1].bucket), 0);
      assert.equal(itemCount(p, 'bucket_empty'), 20);
      const expectedXp = 10 * treatmentModes.reduce((sum, mode) => sum + mode.xp, 0);
      assert.equal(farmingXp(p), expectedXp);
      const startXp = p.farmingStartXp;
      loaded = restore(p.save());
      loaded.farmingStartXp = startXp;
      assertTreatmentState(loaded, expected);
      for (const patchName of allPatchNames) assert.equal(getStage(loaded, patchName), 3);
      assert.equal(itemCount(loaded, 'bucket_empty'), 20);
      assert.equal(farmingXp(loaded), expectedXp, 'both application XP values survive save/load');
    } finally {
      discard(p);
      if (loaded) discard(loaded);
    }
  });

  test('a full inventory replaces only the used filled bucket in each family', () => {
    for (const group of groupSpecs) for (const mode of treatmentModes) {
      const patchName = group.patchNames[0];
      const p = fixture(patchName);
      try {
        add(p, 'spade', 27);
        add(p, mode.bucket);
        assert.equal(itemCount(p, 'spade'), 27);
        assert.equal(itemCount(p, mode.bucket), 1);
        assert.equal(itemCount(p, 'bucket_empty'), 0);
        assert(useBucket(p, patchName, mode.bucket));
        assert.equal(itemCount(p, 'spade'), 27);
        assert.equal(itemCount(p, mode.bucket), 0);
        assert.equal(itemCount(p, 'bucket_empty'), 1);
        assert.equal(farmingXp(p), mode.xp);
        assert.equal(treatment(p, stageIndex(patchName)), mode.code);
      } finally { discard(p); }
    }
  });


  test('both bucket types are refused on weeds, growing, watered, diseased, dead, and mature stages in every family', () => {
    for (const group of groupSpecs) {
      const patchName = group.patchNames[0];
      const crop = cropRows[group.family][0];
      const deadStage = group.family === 'herb' ? 170 : crop.first + 1 + 192;
      const refused = new Set([0, 1, 2, crop.first, crop.first + 1, crop.mature, deadStage]);
      if (group.waterable) {
        refused.add(crop.first + 1 + 64);
        refused.add(crop.first + 1 + 128);
      } else {
        refused.add(crop.diseased);
      }
      for (const stage of refused) {
        for (const mode of treatmentModes) {
          const p = fixture(patchName, stage);
          try {
            add(p, mode.bucket);
            const before = {
              stage: getStage(p, patchName),
              inventory: [itemCount(p, mode.bucket), itemCount(p, 'bucket_empty')],
              xp: farmingXp(p),
            };
            assert(useBucket(p, patchName, mode.bucket), `${group.family} stage ${stage} reaches its native refusal`);
            assert.equal(getStage(p, patchName), before.stage);
            assert.deepEqual([itemCount(p, mode.bucket), itemCount(p, 'bucket_empty')], before.inventory);
            assert.equal(farmingXp(p), before.xp);
            assertTreatmentState(p, EMPTY_TREATMENTS);
            assert.equal(extra(p, stageIndex(patchName)), 0);
          } finally { discard(p); }
        }
      }
    }
  });

  test('a patch accepts only one soil treatment for its next planting', () => {
    for (const group of groupSpecs) {
      const patchName = group.patchNames[0];
      const p = fixture(patchName, 3);
      try {
        add(p, 'bucket_compost', 2);
        assert(useBucket(p, patchName, 'bucket_compost'));
        const before = {
          stage: getStage(p, patchName),
          compost: itemCount(p, 'bucket_compost'),
          buckets: itemCount(p, 'bucket_empty'),
          xp: farmingXp(p),
          treatment: treatment(p, stageIndex(patchName)),
          extra: extra(p, stageIndex(patchName)),
        };
        assert(useBucket(p, patchName, 'bucket_compost'), `${group.family} duplicate reaches refusal`);
        assert.equal(getStage(p, patchName), before.stage);
        assert.equal(itemCount(p, 'bucket_compost'), before.compost);
        assert.equal(itemCount(p, 'bucket_empty'), before.buckets);
        assert.equal(farmingXp(p), before.xp);
        assert.equal(treatment(p, stageIndex(patchName)), before.treatment);
        assert.equal(extra(p, stageIndex(patchName)), before.extra);
      } finally { discard(p); }
    }
  });

  // CANDIDATE disease witnesses use later OSRS 50%/80% reductions over the
  // explicitly UNKNOWN existing engineering risks (20/128 dry, 10/128 wet).
  // The outcomes are pinned at the integer boundary and run through the real
  // family advance-all loops, not the helper proc in isolation.
  test('compost risk boundaries and disease-to-death transition traverse every family loop', () => {
    const modes = [
      { code: 0, bucket: null, divisor: 1 },
      ...treatmentModes.map(mode => ({ code: mode.code, bucket: mode.bucket, divisor: mode.diseaseDivisor })),
    ];
    for (const group of groupSpecs) {
      const patchName = group.patchNames[0];
      const crop = cropRows[group.family][0];
      for (const mode of modes) {
        const wetOptions = group.waterable ? [false, true] : [false];
        for (const watered of wetOptions) {
          const baseChance = watered ? 10 : 20;
          const threshold = Math.floor(baseChance / mode.divisor);
          for (const draw of [threshold - 1, threshold]) {
            const p = fixture(patchName, 3);
            try {
              if (mode.bucket) {
                add(p, mode.bucket);
                assert(useBucket(p, patchName, mode.bucket));
                assert.equal(treatment(p, stageIndex(patchName)), mode.code);
              }
              const inputStage = crop.first + 1 + (watered ? 64 : 0);
              setStage(p, patchName, inputStage);
              JavaRandom.setSeed(witness(128, draw));
              proc(p, group.advanceAll, 1, 0);
              const diseased = draw < threshold;
              const expectedStage = diseased
                ? group.family === 'herb' ? crop.diseased : crop.first + 1 + 128
                : crop.first + 2;
              assert.equal(getStage(p, patchName), expectedStage,
                `${group.family}/${mode.code}/${watered ? 'watered' : 'dry'} draw ${draw}`);
              if (diseased) {
                const seed = witness(128, 127);
                JavaRandom.setSeed(seed);
                const nextDraw = JavaRandom.nextDouble();
                JavaRandom.setSeed(seed);
                proc(p, group.advanceAll, 1, periodFor(group));
                assert.equal(getStage(p, patchName), expectedStage,
                  `${group.family}/${mode.code} disease survives the healthy-only window`);
                assert.equal(JavaRandom.nextDouble(), nextDraw, 'disease does not roll the soil-adjusted healthy risk');
                JavaRandom.setSeed(seed);
                proc(p, group.advanceAll, 1, periodFor(group, true));
                const deadStage = group.family === 'herb' ? 170 : crop.first + 1 + 192;
                assert.equal(getStage(p, patchName), deadStage,
                  `${group.family}/${mode.code} untreated and treated disease die at the same slower window`);
                assert.equal(JavaRandom.nextDouble(), nextDraw, 'certain death does not consume a disease draw');
              }
            } finally { discard(p); }
          }
        }
      }
    }
  });

  test('treated and untreated disease share exact slower windows through online reconciliation and saved offline login', () => {
    const modes = [{ code: 0, bucket: null }, ...treatmentModes];
    for (const group of groupSpecs) for (const mode of modes) for (const offline of [false, true]) {
      const patchName = group.patchNames[0];
      const crop = cropRows[group.family][0];
      const diseased = group.family === 'herb' ? crop.diseased : crop.first + 1 + 128;
      const dead = group.family === 'herb' ? 170 : crop.first + 1 + 192;
      const period = periodFor(group), slow = periodFor(group, true);
      let p = fixture(patchName, 3);
      try {
        if (mode.bucket) {
          add(p, mode.bucket);
          assert(useBucket(p, patchName, mode.bucket));
        }
        setStage(p, patchName, diseased);
        p.setVar(id('VarPlayerType', 'farming_growth_minute'), slow);
        const offlineStart = offline ? p.save() : null;
        const seed = witness(128, 127);
        JavaRandom.setSeed(seed);
        const nextDraw = JavaRandom.nextDouble();
        for (const [window, expected] of [[slow + period, diseased], [slow * 2, dead]]) {
          if (offline) {
            // Independent absences: a previous login inside the next flower
            // window would itself consume that window in the published clock.
            discard(p);
            p = restore(offlineStart);
          }
          minute = window + (offline ? 5 : 0);
          JavaRandom.setSeed(seed);
          if (offline) proc(p, 'farming_login');
          else proc(p, 'farming_reconcile', 0);
          assert.equal(getStage(p, patchName), expected,
            `${group.family}/${mode.code}/${offline ? 'offline' : 'online'} at window ${window}`);
          assert.equal(JavaRandom.nextDouble(), nextDraw, 'existing disease consumes no healthy risk draw');
          assert.equal(treatment(p, stageIndex(patchName)), mode.code);
        }
      } finally { discard(p); }
    }
  });

  test('fixed disease witnesses also run through the actual offline reconciliation dispatch', () => {
    const modes = [
      { code: 0, bucket: null, divisor: 1 },
      ...treatmentModes.map(mode => ({ code: mode.code, bucket: mode.bucket, divisor: mode.diseaseDivisor })),
    ];
    for (const group of groupSpecs) {
      const patchName = group.patchNames[0];
      const crop = cropRows[group.family][0];
      const wetOptions = group.waterable ? [false, true] : [false];
      for (const mode of modes) for (const watered of wetOptions) {
        const threshold = Math.floor((watered ? 10 : 20) / mode.divisor);
        for (const draw of [threshold - 1, threshold]) {
          const p = fixture(patchName, 3);
          try {
            if (mode.bucket) {
              add(p, mode.bucket);
              assert(useBucket(p, patchName, mode.bucket));
            }
            setStage(p, patchName, crop.first + 1 + (watered ? 64 : 0));
            const period = periodFor(group);
            minute = period + 5;
            p.setVar(id('VarPlayerType', 'farming_growth_minute'), period - 1);
            JavaRandom.setSeed(witness(128, draw));
            proc(p, 'farming_reconcile', 1); // RuneScript booleans are integer arguments.
            const diseased = draw < threshold;
            const expectedStage = diseased
              ? group.family === 'herb' ? crop.diseased : crop.first + 1 + 128
              : crop.first + 2;
            assert.equal(getStage(p, patchName), expectedStage,
              `${group.family} offline ${mode.code}/${watered ? 'watered' : 'dry'} draw ${draw}`);
            assert.equal(p.getVar(id('VarPlayerType', 'farming_growth_minute')), minute);
          } finally { discard(p); }
        }
      }
    }
  });
  test('positive saved checkpoints replay disease to death during actual offline login', () => {
    const modes = [
      { code: 0, bucket: null, divisor: 1 },
      ...treatmentModes.map(mode => ({ code: mode.code, bucket: mode.bucket, divisor: mode.diseaseDivisor })),
    ];
    for (const group of groupSpecs) {
      const patchName = group.patchNames[0];
      const crop = cropRows[group.family][0];
      const index = stageIndex(patchName);
      for (const mode of modes) {
        const p = fixture(patchName, 3);
        let loaded = null;
        try {
          if (mode.bucket) {
            add(p, mode.bucket);
            assert(useBucket(p, patchName, mode.bucket));
          }
          setStage(p, patchName, crop.first + 1);
          add(p, 'spade');
          const period = periodFor(group);
          const checkpoint = period - 1;
          assert(checkpoint > 0, 'offline catch-up starts from a positive saved checkpoint');
          p.setVar(id('VarPlayerType', 'farming_growth_minute'), checkpoint);
          loaded = restore(p.save());
          loaded.farmingStartXp = p.farmingStartXp;
          minute = period * 2 + 5;
          const threshold = Math.floor(20 / mode.divisor);
          JavaRandom.setSeed(witness(128, threshold - 1));
          proc(loaded, 'farming_login');
          const deadStage = group.family === 'herb' ? 170 : crop.first + 1 + 192;
          assert.equal(getStage(loaded, patchName), deadStage,
            `${group.family}/${mode.code} crop dies at the slower offline window`);
          assert.equal(loaded.getVar(id('VarPlayerType', 'farming_growth_minute')), minute);
          assert.equal(treatment(loaded, index), mode.code, 'treatment remains until dead crop is cleared');
          assert.deepEqual(allExtras(loaded), Array(20).fill(0), 'dead crop has no saved harvest lives');
          assert(useSpade(loaded, patchName), `${group.family} offline dead crop accepts the native spade`);
          assert.equal(getStage(loaded, patchName), 3);
          assert.equal(treatment(loaded, index), 0, 'offline dead clearing resets treatment');
          assert.equal(extra(loaded, index), 0);
        } finally {
          discard(p);
          if (loaded) discard(loaded);
        }
      }
    }
  });


  function growToMaturity(p, group, patchName, crop) {
    const patch = patches.get(patchName);
    const seed = itemName(crop.seed);
    add(p, 'dibber');
    const seedCount = group.family === 'allotment' ? 3 : group.family === 'hops' ? crop.seed_count : 1;
    add(p, seed, seedCount);
    setPosition(p, patch);
    assert(use(p, seed, patch.loc), `${group.family} native seed planting`);
    assert.equal(getStage(p, patchName), crop.first, 'one seed set starts at its crop-specific first stage');
    const index = stageIndex(patchName);
    const code = treatment(p, index);
    assert(code === 1 || code === 2, 'soil treatment remains associated through planting');
    assert.equal(extra(p, index), 0, 'bonus harvest lives do not exist before maturity');
    const steps = crop.mature - crop.first;
    assert(steps > 1, `${group.family} has growth after its seed stage`);
    JavaRandom.setSeed(sequenceWitness(128, 20, steps - 1));
    proc(p, group.advanceAll, steps, 0);
    assert.equal(getStage(p, patchName), crop.mature, `${group.family} reaches sourced cache maturity`);
    const expected = EMPTY_TREATMENTS.slice(); expected[index] = code;
    assertTreatmentState(p, expected);
    p.farmingStartXp = p.stats[PlayerStat.FARMING];
  }

  test('added lives initialize at maturity, survive save/load mid-harvest, set exact minimum yield, then clear', () => {
    const cases = [];
    for (const group of groupSpecs.filter(candidate => candidate.family !== 'flower')) {
      for (const [patchOffset, patchName] of group.patchNames.entries()) {
        const crop = cropRows[group.family][patchOffset % cropRows[group.family].length];
        cases.push({ group, crop, patchName });
      }
    }
    for (const { group, crop, patchName } of cases) for (const mode of treatmentModes) {
      const index = stageIndex(patchName);
      const p = fixture(patchName, 3);
      let loaded = null;
      try {
        add(p, mode.bucket);
        assert(useBucket(p, patchName, mode.bucket));
        assert.equal(treatment(p, index), mode.code);
        growToMaturity(p, group, patchName, crop);
        assert.equal(extra(p, index), mode.extraLives, `${cropLabel[group.family](crop)} bonus-life count at maturity`);
        const baseLives = crop.last - crop.mature + 1;
        assert(baseLives > 0, `${group.family} cache row has harvest lives after maturity`);
        const expectedExtras = Array(20).fill(0); expectedExtras[index] = mode.extraLives;
        assert.deepEqual(allExtras(p), expectedExtras, 'only the matured patch receives added lives');
        const startXp = p.farmingStartXp;
        add(p, 'spade');
        World.currentTick += 2;
        JavaRandom.setSeed(witness(256, 0));
        assert(clickPatch(p, patchName), `${group.family} first manual harvest dispatch`);
        assert.equal(itemCount(p, itemName(crop.produce)), 1);
        assert.equal(extra(p, index), mode.extraLives - 1, 'the failed life roll consumes one added life first');
        expectedExtras[index] = mode.extraLives - 1;
        assert.deepEqual(allExtras(p), expectedExtras, 'one added life is spent before base harvest life');
        loaded = restore(p.save());
        loaded.farmingStartXp = startXp;
        setPosition(loaded, patches.get(patchName));
        assert.equal(treatment(loaded, index), mode.code, 'treatment identity survives save/load');
        assert.equal(extra(loaded, index), mode.extraLives - 1, 'remaining added lives survive save/load');
        assert.deepEqual(allExtras(loaded), expectedExtras, 'all extra-life fields survive save/load');
        assert.equal(getStage(loaded, patchName), crop.mature, 'the mid-harvest crop stage survives save/load');
        assert.equal(itemCount(loaded, itemName(crop.produce)), 1);
        for (let pick = 1; pick < baseLives + mode.extraLives; pick++) {
          World.currentTick += 2;
          JavaRandom.setSeed(witness(256, 0));
          assert(clickPatch(loaded, patchName), `${group.family} minimum-yield pick ${pick + 1}`);
        }
        assert.equal(itemCount(loaded, itemName(crop.produce)), baseLives + mode.extraLives,
          `${cropLabel[group.family](crop)} minimum is original lives plus compost lives`);
        assert.equal(farmingXp(loaded), crop.harvest_xp * (baseLives + mode.extraLives));
        assert.equal(getStage(loaded, patchName), 3, 'the patch clears after its exact minimum yield');
        assert.equal(treatment(loaded, index), 0, 'treatment clears with the empty patch');
        assert.equal(extra(loaded, index), 0, 'all added lives clear with the empty patch');
        assert.deepEqual(allExtras(loaded), Array(20).fill(0), 'depletion clears every extra-life field');
      } finally {
        discard(p);
        if (loaded) discard(loaded);
      }
    }
  });

  test('flower treatment keeps its fixed yield, has no extra lives, and clears on harvest', () => {
    const group = groupSpecs.find(candidate => candidate.family === 'flower');
    const patchName = group.patchNames[0];
    const crop = cropRows.flower[0];
    const index = stageIndex(patchName);
    for (const mode of treatmentModes) {
      const p = fixture(patchName, 3);
      try {
        add(p, mode.bucket);
        assert(useBucket(p, patchName, mode.bucket));
        growToMaturity(p, group, patchName, crop);
        assert.equal(extra(p, index), 0, 'flowers keep their existing fixed harvest yield');
        assert.equal(p.getVar(extraLivesVarp), 0, 'flowers do not consume the allotment/hops/herb life bytes');
        add(p, 'spade');
        World.currentTick += 2;
        assert(clickPatch(p, patchName));
        assert.equal(itemCount(p, itemName(crop.produce)), crop.yield);
        assert.equal(farmingXp(p), crop.harvest_xp, 'flower harvest XP is paid once');
        assert.equal(getStage(p, patchName), 3);
        assert.equal(treatment(p, index), 0);
        assert.equal(extra(p, index), 0);
        assert.equal(p.getVar(extraLivesVarp), 0);
      } finally { discard(p); }
    }
  });

  test('dead-plant clearing removes treatment on all four families', () => {
    for (const group of groupSpecs) {
      const patchName = group.patchNames[0];
      const crop = cropRows[group.family][0];
      const deadStage = group.family === 'herb' ? 170 : crop.first + 1 + 192;
      const index = stageIndex(patchName);
      const p = fixture(patchName, 3);
      try {
        add(p, 'bucket_compost'); add(p, 'spade');
        assert(useBucket(p, patchName, 'bucket_compost'));
        assert.equal(treatment(p, index), 1);
        setStage(p, patchName, deadStage);
        assert(useSpade(p, patchName), `${group.family} dead-stage spade dispatch`);
        assert.equal(getStage(p, patchName), 3, 'dead crop returns to the weeded patch');
        assert.equal(treatment(p, index), 0, 'dead clearing releases the soil treatment');
        assert.equal(extra(p, index), 0);
        assert.equal(farmingXp(p), 180, 'clearing a dead crop grants no additional Farming XP');
      } finally { discard(p); }
    }
  });

  test('every crop keeps its existing no-treatment harvest, XP, and stage behavior', () => {
    for (const group of groupSpecs) {
      const patchName = group.patchNames[0];
      for (const crop of cropRows[group.family]) {
        const p = fixture(patchName, crop.mature);
        try {
          p.setLevel(PlayerStat.FARMING, 99);
          p.farmingStartXp = p.stats[PlayerStat.FARMING];
          add(p, 'spade');
          assert.equal(treatment(p, stageIndex(patchName)), 0);
          assert.equal(extra(p, stageIndex(patchName)), 0);
          World.currentTick += 2;
          JavaRandom.setSeed(witness(256, 255));
          assert(clickPatch(p, patchName), `${group.family} ${cropLabel[group.family](crop)} native harvest`);
          assert.equal(itemCount(p, itemName(crop.produce)), group.family === 'flower' ? crop.yield : 1);
          assert.equal(farmingXp(p), crop.harvest_xp);
          // The published potato path spends a base life deterministically.
          const expectedStage = group.family === 'flower' ? 3
            : crop.produce === id('ObjType', 'potato') ? crop.mature + 1 : crop.mature;
          assert.equal(getStage(p, patchName), expectedStage);
          assert.equal(treatment(p, stageIndex(patchName)), 0);
          assert.equal(extra(p, stageIndex(patchName)), 0);
        } finally { discard(p); }
      }
    }
  });
} finally {
  Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = dateHandler;
}
console.log(`Compost compiled checks: ${cases - failures}/${cases} passed`);
process.exit(failures ? 1 : 0);
