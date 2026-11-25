/** Built-pack flower and scarecrow behavior checks. Run from sibling engine:
 * node --import tsx ../content/tests/farming/test_flowers.mjs
 * Patch and item interactions use production native packet handlers.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  World, Runner, Scripts, ScriptOpcode, PlayerTimerType, PlayerStat, JavaRandom,
  types, id, inv, player, proc, add, count, slot, use, click, load
} from './runtime.mjs';

const map = await load('engine/GameMap.ts');
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ServerTriggerType = (await load('engine/script/ServerTriggerType.ts')).default;
const OpHeldU = (await load('network/game/client/model/OpHeldU.ts')).default;
const OpHeldUHandler = (await load('network/game/client/handler/OpHeldUHandler.ts')).default;
const heldU = new OpHeldUHandler();
const inventoryComponent = id('Component', 'inventory:inv');

// VERIFIED 377 cache bands and 28 April 2006 Tip.It table. XP is tenths.
// Fixed flower yields and one pick transaction are retained by the guide.
const flowers = [
  { name: 'marigold', seed: 'marigold_seed', produce: 'marigold', first: 8, mature: 12, level: 2, plantXp: 85, harvestXp: 470, yield: 1 },
  { name: 'rosemary', seed: 'rosemary_seed', produce: 'rosemary', first: 13, mature: 17, level: 11, plantXp: 120, harvestXp: 670, yield: 1 },
  { name: 'nasturtium', seed: 'nasturtium_seed', produce: 'nasturtium', first: 18, mature: 22, level: 24, plantXp: 200, harvestXp: 1110, yield: 1 },
  { name: 'woad', seed: 'woad_seed', produce: 'woadleaf', first: 23, mature: 27, level: 25, plantXp: 205, harvestXp: 1155, yield: 3 },
  { name: 'limpwurt', seed: 'limpwurt_seed', produce: 'limpwurt_root', first: 28, mature: 32, level: 26, plantXp: 210, harvestXp: 1200, yield: 3 },
];
const patchNames = [1, 2, 3, 4].map(index => `farming_flower_patch_${index}`);
const patchMap = new Map(patchNames.map(name => [name, []]));
const allotmentNames = Array.from({ length: 8 }, (_, index) => `farming_veg_patch_${index + 1}`);
const allotmentMap = new Map(allotmentNames.map(name => [name, []]));
const hayTypes = [
  'haystack', 'haystack2', 'haystack3', 'haybail', 'hay_bale', 'hay_bale_stack',
  'hay_bale_thin', 'hay_bale_stack_thin', 'hay_bales', 'hay_bales_10085',
  'haystack_10086', 'vc_haystack2'
];
const hayMap = new Map(hayTypes.map(name => [name, []]));
for (const filename of fs.readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name))) {
  const [, mapX, mapZ] = /^m(\d+)_(\d+)\.jm2$/.exec(filename).map(Number);
  let section;
  for (const line of fs.readFileSync(path.join(content, 'maps', filename), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    if (section !== 'LOC') continue;
    const match = /^([0-3]) (\d+) (\d+): (\d+)(?: (\d+))?(?: (\d+))?$/.exec(line);
    if (!match) continue;
    const [, level, x, z, type] = match.map(Number);
    const config = types.LocType.get(type);
    const name = config.debugname;
    const loc = World.getLoc(mapX * 64 + x, mapZ * 64 + z, level, type);
    if (patchMap.has(name)) patchMap.get(name).push(loc);
    if (allotmentMap.has(name)) allotmentMap.get(name).push(loc);
    if (hayMap.has(name)) hayMap.get(name).push(loc);
  }
}
for (const name of patchNames) {
  assert.equal(patchMap.get(name).length, 1, `one original-map placement for ${name}`);
  assert(patchMap.get(name)[0], `${name} placement exists in the collision world`);
}
const patchLocs = patchNames.map(name => patchMap.get(name)[0]);
const selectors = patchLocs.map(loc => types.LocType.get(loc.type).multivarbit);
assert.equal(new Set(selectors).size, 4, 'the four flower parents have independent selector bytes');
const flowerVarp = id('VarPlayerType', 'farming_flower_varp');
assert.equal(flowerVarp, 508, 'flower selectors retain original permanent varp 508');
assert(selectors.every(bit => types.VarBitType.get(bit).basevar === flowerVarp),
  'all four original flower selectors share varp 508');
const flowerWord = values => values.reduce((word, value, index) => word | (value << (index * 8)), 0);
const stage = (p, patchIndex = 0) => p.getVarBit(selectors[patchIndex]);
const setStage = (p, value, patchIndex = 0) => p.setVarBit(selectors[patchIndex], value);
const farmingXp = p => p.stats[PlayerStat.FARMING] - p.farmingStartXp;

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
function fixture({ patchIndex = 0, level = 99, stage: initialStage = 3 } = {}) {
  const p = player();
  const loc = patchLocs[patchIndex];
  const tile = approach(loc);
  p.x = tile.x; p.z = tile.z; p.level = loc.level;
  p.setLevel(PlayerStat.FARMING, level);
  p.farmingStartXp = p.stats[PlayerStat.FARMING];
  if (initialStage !== null) setStage(p, initialStage, patchIndex);
  return p;
}
function witness(range, draw) {
  for (let seed = 0; seed < 200000; seed++) {
    JavaRandom.setSeed(seed);
    if (Math.floor(JavaRandom.nextDouble() * range) === draw) return seed;
  }
  assert.fail(`no native random witness ${draw}/${range}`);
}
const draws128 = new Map([0, 9, 10, 19, 20, 127].map(draw => [draw, witness(128, draw)]));
const healthySeed = (() => {
  for (let seed = 0; seed < 200000; seed++) {
    JavaRandom.setSeed(seed);
    if (Array.from({ length: 16 }, () => Math.floor(JavaRandom.nextDouble() * 128)).every(draw => draw >= 20)) return seed;
  }
  assert.fail('no native sixteen-cycle healthy witness');
})();
const growthTimer = Scripts.getByName('[softtimer,farming_growth]');
assert(growthTimer, 'shared compiled farming growth timer is required');
const flowerTable = types.DbTableType.getByName('farming_flower');
assert(flowerTable, 'compiled farming_flower table is required');
function column(table, name) {
  const index = table.columnNames.indexOf(name);
  assert(index >= 0, `missing ${table.debugname} column ${name}`);
  return index;
}
const flowerColumns = Object.fromEntries(
  ['seed', 'produce', 'first', 'mature', 'level', 'plant_xp', 'harvest_xp', 'yield', 'name']
    .map(name => [name, column(flowerTable, name)])
);
const flowerRows = types.DbRowType.getInTable(flowerTable.id);
const rowValue = (row, name) => row.getValue(flowerColumns[name], 0)[0];
const rowForSeed = new Map(flowerRows.map(row => [rowValue(row, 'seed'), row]));
const stageSymbol = (flower, rank) => rank === 0 ? `${flower.name}_seed`
  : rank === 4 ? `${flower.name}_fullygrown` : `${flower.name}_${rank}`;
const cropRank = symbol => {
  const match = /^(marigold|rosemary|nasturtium|woad|limpwurt)_(seed|[1-3]|fullygrown)(?:_(?:watered|diseased|dead))?$/.exec(symbol ?? '');
  if (!match) return null;
  return match[2] === 'seed' ? 0 : match[2] === 'fullygrown' ? 4 : Number(match[2]);
};
const isDiseased = symbol => String(symbol ?? '').endsWith('_diseased');
const isDead = symbol => String(symbol ?? '').endsWith('_dead');
const weedStages = [
  ['flower_patch_weeds_3', 0], ['flower_patch_weeds_2', 1],
  ['flower_patch_weeds_1', 2], ['flower_patch_weeded', 3]
];
function packVisibleName(config, value) {
  const type = config.multiloc[value];
  assert(Number.isInteger(type) && type >= 0, `${config.debugname} has no multiloc for byte ${value}`);
  return types.LocType.get(type).debugname;
}
function addFlowerRows(p, name, count = 1) {
  add(p, name, count);
}
function useHeldOnHeld(p, targetName, usedName) {
  const targetId = id('ObjType', targetName);
  const usedId = id('ObjType', usedName);
  const accepted = heldU.handle(new OpHeldU(
    targetId, slot(p, targetName), inventoryComponent,
    usedId, slot(p, usedName), inventoryComponent
  ), p);
  if (accepted) p.processInteraction();
  return accepted;
}

let cases = 0, failures = 0;
function test(name, action) {
  cases++;
  try { JavaRandom.setSeed(0); action(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack ?? error}`); }
}

const dateHandler = Runner.HANDLERS[ScriptOpcode.DATE_MINUTES];
let minute = 605;
Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(minute);
try {
  test('five independent source-pinned flower rows drive seed and cache decoders', () => {
    assert.equal(flowerRows.length, flowers.length, 'ordinary flower table has exactly five rows');
    const p = player();
    for (const flower of flowers) {
      const row = rowForSeed.get(id('ObjType', flower.seed));
      assert(row, `row for ${flower.seed}`);
      assert.equal(rowValue(row, 'produce'), id('ObjType', flower.produce), `${flower.name} fixed produce`);
      assert.equal(rowValue(row, 'first'), flower.first, `${flower.name} first byte`);
      assert.equal(rowValue(row, 'mature'), flower.mature, `${flower.name} mature byte`);
      assert.equal(rowValue(row, 'level'), flower.level, `${flower.name} Farming gate`);
      assert.equal(rowValue(row, 'plant_xp'), flower.plantXp, `${flower.name} planting XP tenths`);
      assert.equal(rowValue(row, 'harvest_xp'), flower.harvestXp, `${flower.name} one-pick XP tenths`);
      assert.equal(rowValue(row, 'yield'), flower.yield, `${flower.name} fixed yield`);
      assert.equal(rowValue(row, 'name'), flower.name, `${flower.name} display name`);
      assert.equal(proc(p, 'farming_flower_seed', id('ObjType', flower.seed)).popInt(), row.id,
        `${flower.name} base seed lookup`);
      for (let variant = 2; variant <= 5; variant++) {
        assert.equal(proc(p, 'farming_flower_seed', id('ObjType', `${flower.seed}_${variant}`)).popInt(), row.id,
          `${flower.name} seed variant ${variant}`);
      }
      for (let value = flower.first; value <= flower.mature; value++) {
        assert.equal(proc(p, 'farming_flower_crop', value).popInt(), row.id,
          `${flower.name} healthy cache byte ${value}`);
      }
      assert.equal(proc(p, 'farming_flower_crop', flower.mature + 64).popInt(), -1,
        `${flower.name} has no watered mature crop form`);
      assert.equal(proc(p, 'farming_flower_crop', flower.first + 128).popInt(), -1,
        `${flower.name} has no diseased seed form`);
      assert.equal(proc(p, 'farming_flower_crop', flower.mature + 128).popInt(), -1,
        `${flower.name} has no diseased mature form`);
      assert.equal(proc(p, 'farming_flower_crop', flower.first + 192).popInt(), -1,
        `${flower.name} has no dead seed form`);
      for (let value = flower.first; value < flower.mature; value++) {
        assert.equal(proc(p, 'farming_flower_crop', value + 64).popInt(), row.id,
          `${flower.name} watered cache byte ${value + 64}`);
      }
      for (let value = flower.first + 1; value < flower.mature; value++) {
        assert.equal(proc(p, 'farming_flower_crop', value + 128).popInt(), row.id,
          `${flower.name} diseased cache byte ${value + 128}`);
        assert.equal(proc(p, 'farming_flower_crop', value + 192).popInt(), row.id,
          `${flower.name} dead cache byte ${value + 192}`);
      }
      assert.equal(proc(p, 'farming_flower_crop', flower.mature + 192).popInt(), row.id,
        `${flower.name} dead mature form is recognized for spade clearing`);
    }
    for (const value of [0, 3, 4, 7, 33, 36, 63, 64, 127, 128, 191, 192, 255]) {
      assert.equal(proc(p, 'farming_flower_crop', value).popInt(), -1, `unsupported flower byte ${value} stays unowned`);
    }
  });

  test('all four original map parents expose exact healthy, wet, disease, and death bands', () => {
    for (const [patchIndex, name] of patchNames.entries()) {
      const config = types.LocType.get(id('LocType', name));
      assert.equal(config.multivarbit, selectors[patchIndex], `${name} owns its original selector`);
      const patchWeeds = patchIndex === 3
        ? weedStages.map(([symbol, value]) => [symbol === 'flower_patch_weeded' ? symbol : `${symbol}_mory`, value])
        : weedStages;
      for (const [symbol, value] of patchWeeds) assert.equal(packVisibleName(config, value), symbol,
        `${name} initial weed byte ${value}`);
      for (let value = 4; value <= 7; value++) {
        assert.equal(packVisibleName(config, value), patchIndex === 3 ? 'flower_patch_weeds_3_mory' : 'flower_patch_weeds_3',
          `${name} unused seed-band byte ${value}`);
      }
      assert.equal(packVisibleName(config, 36), 'farming_scarecrow', `${name} installed scarecrow byte`);
      for (const flower of flowers) {
        for (let rank = 0; rank <= 4; rank++) {
          assert.equal(packVisibleName(config, flower.first + rank), stageSymbol(flower, rank),
            `${name} ${flower.name} healthy stage ${rank}`);
        }
        for (let rank = 0; rank < 4; rank++) {
          assert.equal(packVisibleName(config, flower.first + rank + 64), `${stageSymbol(flower, rank)}_watered`,
            `${name} ${flower.name} watered stage ${rank}`);
        }
        for (let rank = 1; rank < 4; rank++) {
          assert.equal(packVisibleName(config, flower.first + rank + 128), `${stageSymbol(flower, rank)}_diseased`,
            `${name} ${flower.name} diseased stage ${rank}`);
          assert.equal(packVisibleName(config, flower.first + rank + 192), `${stageSymbol(flower, rank)}_dead`,
            `${name} ${flower.name} dead stage ${rank}`);
        }
        assert.equal(packVisibleName(config, flower.mature + 192), `${flower.name}_fullygrown_dead`,
          `${name} ${flower.name} dead mature form`);
      }
    }
    for (const name of ['marigold_fullygrown_watered', 'rosemary_fullygrown_watered',
      'nasturtium_fullygrown_watered', 'woad_fullygrown_watered', 'limpwurt_fullygrown_watered']) {
      assert.equal(types.LocType.getId(name), -1, `${name} is not a revision-377 visible form`);
    }
  });

  for (const flower of flowers) {
    test(`${flower.name}: native planting enforces level, dibber, one seed, and exact XP`, () => {
      const under = fixture({ level: flower.level - 1 });
      addFlowerRows(under, flower.seed, 2); add(under, 'dibber');
      assert(use(under, flower.seed, patchLocs[0]), 'native item-on-loc packet reaches the product handler');
      assert.equal(stage(under), 3, 'under-level planting leaves the weeded selector unchanged');
      assert.equal(count(under, flower.seed), 2, 'under-level planting consumes no seed');
      assert.equal(farmingXp(under), 0, 'under-level planting awards no XP');

      const noDibber = fixture({ level: flower.level });
      add(noDibber, flower.seed);
      assert(use(noDibber, flower.seed, patchLocs[0]));
      assert.equal(stage(noDibber), 3, 'planting without a dibber leaves the patch weeded');
      assert.equal(count(noDibber, flower.seed), 1, 'planting without a dibber consumes no seed');
      assert.equal(farmingXp(noDibber), 0, 'planting without a dibber awards no XP');

      const planted = fixture({ level: flower.level });
      addFlowerRows(planted, flower.seed, 2); add(planted, 'dibber');
      assert(use(planted, flower.seed, patchLocs[0]));
      assert.equal(stage(planted), flower.first, 'one seed writes its exact first cache byte');
      assert.equal(count(planted, flower.seed), 1, 'flowers are planted one seed at a time');
      assert.equal(count(planted, 'dibber'), 1, 'planting retains the dibber');
      assert.equal(farmingXp(planted), flower.plantXp, 'planting XP is recorded in tenths');
    });

    test(`${flower.name}: native Pick is one fixed-yield transaction with one XP award`, () => {
      const noSpade = fixture({ level: 1, stage: flower.mature });
      assert(click(noSpade, patchLocs[0], 1), 'native Pick reaches the UNKNOWN spade gate');
      assert.equal(stage(noSpade), flower.mature, 'missing-spade Pick leaves the mature crop intact');
      assert.equal(count(noSpade, flower.produce), 0, 'missing-spade Pick gives no produce');
      assert.equal(farmingXp(noSpade), 0, 'missing-spade Pick gives no XP');
      assert.deepEqual(noSpade.messages, ['You need a spade to do that.'],
        'missing-spade Pick uses the published shared refusal line');

      const p = fixture({ level: 1, stage: flower.mature });
      add(p, 'spade');
      const xpBefore = farmingXp(p);
      assert(click(p, patchLocs[0], 1), 'visible fully-grown flower uses native OpLoc1');
      assert.equal(count(p, flower.produce), flower.yield, `one pick gives exactly ${flower.yield} fixed produce`);
      assert.equal(stage(p), 3, 'one pick clears the patch without harvest-life rolls');
      assert.equal(farmingXp(p) - xpBefore, flower.harvestXp, 'picking XP is awarded once per patch, not per item');
      assert.equal(count(p, 'spade'), 1, 'the spade is retained');
      assert.equal(count(p, 'dibber'), 0, 'picking does not require a dibber');

      p.setLevel(PlayerStat.FARMING, flower.level);
      const replantedXp = farmingXp(p);
      add(p, flower.seed); add(p, 'dibber');
      assert(use(p, flower.seed, patchLocs[0]), 'cleared patch accepts a new native seed packet');
      assert.equal(stage(p), flower.first, 'the cleared patch can be replanted');
      assert.equal(farmingXp(p) - replantedXp, flower.plantXp, 'replanting has its ordinary planting XP');
    });
  }

  test('native flower care waters, cures, and clears every species at its visible stages', () => {
    for (const flower of flowers) {
      for (let value = flower.first; value < flower.mature; value++) {
        const p = fixture({ stage: value });
        add(p, 'watering_can_8');
        const xpBefore = farmingXp(p);
        assert(use(p, 'watering_can_8', patchLocs[0]));
        assert.equal(stage(p), value + 64, `${flower.name} byte ${value} gains the wet offset`);
        assert.equal(count(p, 'watering_can_8'), 0, 'one watering consumes the charged dose');
        assert.equal(count(p, 'watering_can_7'), 1, 'one lower-dose can is returned');
        assert.equal(farmingXp(p), xpBefore, 'watering awards no XP');
        assert(use(p, 'watering_can_7', patchLocs[0]));
        assert.equal(stage(p), value + 64, 'repeated watering does not consume another dose');
        assert.equal(count(p, 'watering_can_7'), 1, 'repeated watering retains the can');
      }
      for (let value = flower.first + 1; value < flower.mature; value++) {
        const p = fixture({ stage: value + 128 });
        add(p, 'plant_cure');
        const xpBefore = farmingXp(p);
        assert(use(p, 'plant_cure', patchLocs[0]));
        assert.equal(stage(p), value, `${flower.name} cure restores the same growth rank`);
        assert.equal(count(p, 'plant_cure'), 0);
        assert.equal(count(p, 'vial_empty'), 1);
        assert.equal(farmingXp(p), xpBefore, 'curing awards no XP');
      }
      for (let value = flower.first + 1; value <= flower.mature; value++) {
        const dead = fixture({ stage: value + 192 });
        add(dead, 'spade');
        const deadXp = farmingXp(dead);
        assert(use(dead, 'spade', patchLocs[0]));
        assert.equal(stage(dead), 3, `${flower.name} dead stage ${value} is cleared`);
        assert.equal(count(dead, 'spade'), 1, 'clearing retains the spade');
        assert.equal(farmingXp(dead), deadXp, 'clearing awards no XP');
      }
    }
  });

  test('flower growth has four five-minute family advances, finite disease/death, and mature stasis', () => {
    const table = types.DbTableType.getByName('farming_growth');
    assert(table, 'shared farming_growth table is compiled');
    const periodColumn = column(table, 'period');
    const handlerColumn = column(table, 'handler');
    const flowerRows = types.DbRowType.getInTable(table.id)
      .filter(row => row.getValue(handlerColumn, 0)[0] === 3);
    assert.equal(flowerRows.length, 1, 'one shared growth row dispatches flowers');
    assert.equal(flowerRows[0].getValue(periodColumn, 0)[0], 5,
      'CANDIDATE pre-rework five-minute flower clock is the compiled row');

    const probe = player();
    for (const flower of flowers) {
      JavaRandom.setSeed(draws128.get(0));
      assert.equal(proc(probe, 'farming_flower_advance', flower.first, 1, 0, 0).popInt(), flower.first + 1,
        `${flower.name} seed advances without a disease roll`);
      for (let value = flower.first + 1; value < flower.mature; value++) {
        JavaRandom.setSeed(draws128.get(19));
        assert.equal(proc(probe, 'farming_flower_advance', value, 1, 0, 0).popInt(), value + 128,
          `${flower.name} dry disease maps to stage byte ${value + 128}`);
        JavaRandom.setSeed(draws128.get(20));
        assert.equal(proc(probe, 'farming_flower_advance', value, 1, 0, 0).popInt(), value + 1,
          `${flower.name} dry healthy boundary advances to the next byte`);
        JavaRandom.setSeed(draws128.get(9));
        assert.equal(proc(probe, 'farming_flower_advance', value + 64, 1, 0, 0).popInt(), value + 128,
          `${flower.name} watered disease maps back to its unwatered base`);
        JavaRandom.setSeed(draws128.get(10));
        assert.equal(proc(probe, 'farming_flower_advance', value + 64, 1, 0, 0).popInt(), value + 1,
          `${flower.name} watered healthy boundary advances once`);
        JavaRandom.setSeed(draws128.get(127));
        assert.equal(proc(probe, 'farming_flower_advance', value + 128, 1, 0, 0).popInt(), value + 192,
          `${flower.name} uncured disease dies on its next cycle`);
      }
      JavaRandom.setSeed(healthySeed);
      assert.equal(proc(probe, 'farming_flower_advance', flower.first, 1000000, 0, 0).popInt(), flower.mature,
        `${flower.name} bounded catch-up stops at maturity`);
      for (const value of [flower.mature, flower.mature + 64, flower.mature + 192]) {
        assert.equal(proc(probe, 'farming_flower_advance', value, 1000000, 0, 0).popInt(), value,
          `${flower.name} terminal or mature byte ${value} is stable`);
      }
    }
  });

  test('actual shared timer advances all four independent flower selectors and survives save/load', () => {
    minute = 605;
    const p = fixture({ stage: null });
    flowers.slice(0, 4).forEach((flower, index) => setStage(p, flower.first, index));
    proc(p, 'farming_login');
    assert.equal(p.timers.get(growthTimer.id).interval, 500);
    assert.equal(p.timers.get(growthTimer.id).type, PlayerTimerType.SOFT);
    for (let step = 1; step <= 4; step++) {
      minute = 605 + step * 5;
      JavaRandom.setSeed(healthySeed);
      World.currentTick += 500;
      p.processTimers(PlayerTimerType.SOFT);
      flowers.slice(0, 4).forEach((flower, index) => {
        assert.equal(stage(p, index), Math.min(flower.mature, flower.first + step),
          `${flower.name} advances once through shared timer window ${step}`);
      });
    }
    const snapshot = player(p.save());
    flowers.slice(0, 4).forEach((flower, index) => assert.equal(stage(snapshot, index), flower.mature,
      `${flower.name} mature selector persists through Player.save/load`));
    const before = patchNames.map((_, index) => stage(snapshot, index));
    minute = 630; proc(snapshot, 'farming_reconcile', 1);
    assert.deepEqual(patchNames.map((_, index) => stage(snapshot, index)), before,
      'same-minute reconcile cannot repeat flower advancement');
  });

  test('offline flower growth catches up only completed five-minute windows once', () => {
    minute = 605;
    const p = fixture({ stage: flowers[0].first });
    proc(p, 'farming_login');
    minute = 609; proc(p, 'farming_logout');
    assert.equal(p.timers.get(growthTimer.id), undefined, 'logout clears the shared timer');
    const loaded = player(p.save());
    assert.equal(stage(loaded), flowers[0].first, 'the saved seed stage is unchanged before login reconciliation');
    minute = 615; JavaRandom.setSeed(healthySeed); proc(loaded, 'farming_login');
    assert.equal(stage(loaded), flowers[0].first + 1, 'one completed offline flower window advances once');
    proc(loaded, 'farming_reconcile', 1);
    assert.equal(stage(loaded), flowers[0].first + 1, 'same-minute reconcile is idempotent');
    assert.equal(stage(player(loaded.save())), flowers[0].first + 1, 'offline growth persists through another save/load');
  });

  test('flower advance-all preserves all four bytes and unrelated permanent state', () => {
    const p = player();
    flowers.slice(0, 4).forEach((flower, index) => setStage(p, flower.first + 1, index));
    const unrelated = id('VarPlayerType', 'option_music');
    p.setVar(unrelated, 3);
    const before = p.getVar(flowerVarp);
    JavaRandom.setSeed(healthySeed);
    proc(p, 'farming_flower_advance_all', 1, 0);
    assert.deepEqual(patchNames.map((_, index) => stage(p, index)),
      flowers.slice(0, 4).map(flower => flower.first + 2));
    assert.equal(p.getVar(flowerVarp), flowerWord(flowers.slice(0, 4).map(flower => flower.first + 2)),
      'the packed flower word contains only the four independently advanced selector bytes');
    assert.notEqual(before, p.getVar(flowerVarp), 'the original flower word is advanced');
    assert.equal(p.getVar(unrelated), 3, 'advance-all does not touch unrelated state');
    const loaded = player(p.save());
    assert.deepEqual(patchNames.map((_, index) => stage(loaded, index)),
      flowers.slice(0, 4).map(flower => flower.first + 2), 'all flower bytes survive save/load');
  });

  test('native flower care and rake packets reach each original collision-valid parent only', () => {
    const initial = [8, 13, 18, 23];
    const actionDelay = id('VarPlayerType', 'action_delay');
    for (let target = 0; target < patchLocs.length; target++) {
      const loc = patchLocs[target];
      const p = fixture({ patchIndex: target, level: 99, stage: null });
      const values = [...initial]; values[target] = 0;
      values.forEach((value, index) => setStage(p, value, index));
      p.setVar(actionDelay, 0);
      p.setLevel(PlayerStat.FARMING, 99);
      p.farmingStartXp = p.stats[PlayerStat.FARMING];
      add(p, 'rake');
      const expectedPacked = flowerWord(values);
      assert.equal(p.getVar(flowerVarp), expectedPacked, 'test fixture begins with four independent bytes');
      let last = stage(p, target);
      let ticks = 0;
      const playerTick = () => { World.currentTick++; World.processPlayers(); };
      World.playerLoop.add(2130706433n, p);
      try {
        assert(use(p, 'rake', loc), 'one native OpLocU packet starts the raking action');
        last = stage(p, target);
        assert(last === 0 || last === 1, 'the first server rake step is immediate or pending');
        while (stage(p, target) < 3 || p.hasInteraction()) {
          assert(ticks < 24, 'one rake use clears the flower weeds within a finite production tick bound');
          playerTick(); ticks++;
          const current = stage(p, target);
          assert(current >= last && current <= 3, 'flower rake progress is monotonic and bounded');
          assert(current - last <= 1, 'each rake cycle advances at most one weed stage');
          last = current;
          assert.equal(count(p, 'weeds'), current, 'each rake cycle returns one weeds item');
          assert.equal(farmingXp(p), current * 40, 'each cleared weed awards the published four XP');
          for (let index = 0; index < selectors.length; index++) {
            assert.equal(stage(p, index), index === target ? current : values[index],
              `raking ${patchNames[target]} leaves ${patchNames[index]} isolated`);
          }
        }
      } finally { p.unlink(); }
      assert.equal(stage(p, target), 3, `${patchNames[target]} ends weeded`);
      assert.equal(p.getVar(flowerVarp), flowerWord(values.map((value, index) => index === target ? 3 : value)),
        'rake changes only its original selector byte');
      assert.equal(count(p, 'rake'), 1, 'the rake is retained');
    }
  });

  test('protection pairs follow the original map and isolate all eight allotment selectors', () => {
    const allotments = allotmentNames.map(name => {
      const placements = allotmentMap.get(name);
      assert(placements.length > 0, `${name} has original-map placements`);
      assert(placements.every(Boolean), `${name} exists in the collision world`);
      return placements[0];
    });
    const allotmentBits = allotments.map(loc => types.LocType.get(loc.type).multivarbit);
    for (const [index, loc] of allotments.entries()) {
      const distances = patchLocs.map(flower => Math.abs(flower.x - loc.x) + Math.abs(flower.z - loc.z));
      const nearest = distances.indexOf(Math.min(...distances));
      assert.equal(nearest, Math.floor(index / 2), `${allotmentNames[index]} uses its nearest flower patch`);
      assert.equal(distances.filter(distance => distance === distances[nearest]).length, 1,
        'the original map gives a unique nearest flower patch');
      for (const tile of allotmentMap.get(allotmentNames[index])) {
        const tileDistances = patchLocs.map(flower => Math.abs(flower.x - tile.x) + Math.abs(flower.z - tile.z));
        assert.equal(tileDistances.indexOf(Math.min(...tileDistances)), nearest,
          'every tile of the multi-loc allotment has the same nearest flower patch');
      }
      for (const protectedPair of [true, false]) {
        const p = player();
        allotmentBits.forEach(bit => p.setVarBit(bit, 0));
        p.setVarBit(allotmentBits[index], 7);
        selectors.forEach(bit => p.setVarBit(bit, 3));
        setStage(p, 12, protectedPair ? nearest : (nearest + 1) % patchLocs.length);
        JavaRandom.setSeed(draws128.get(0));
        proc(p, 'farming_potato_advance_all', 1, 0);
        assert.equal(p.getVarBit(allotmentBits[index]), protectedPair ? 8 : 135,
          `${allotmentNames[index]} receives only its own mature marigold protection`);
        allotmentBits.forEach((bit, other) => {
          if (other !== index) assert.equal(p.getVarBit(bit), 0, 'unplanted allotment bytes stay unchanged');
        });
      }
    }
  });

  test('VERIFIED flower protection pairs suppress new disease only in the matching crop bands', () => {
    const p = player();
    const protects = (flower, crop) => proc(p, 'farming_flower_protects', flower, crop).popInt() === 1;
    for (const crop of [6, 19, 27, 33]) assert(protects(12, crop), `mature marigold protects crop byte ${crop}`);
    for (const crop of [20, 26]) assert(protects(17, crop), `mature rosemary protects crop byte ${crop}`);
    for (const crop of [52, 62]) assert(protects(22, crop), `mature nasturtium protects crop byte ${crop}`);
    for (const flower of [33, 34, 35, 36]) for (const crop of [34, 42]) {
      assert(protects(flower, crop), `installed scarecrow byte ${flower} protects sweetcorn byte ${crop}`);
    }
    for (const [flower, crop] of [[11, 7], [12, 20], [17, 27], [22, 51], [23, 54], [32, 35], [33, 33], [36, 43]]) {
      assert.equal(protects(flower, crop), false, `unmatched or immature pair ${flower}/${crop} is not protected`);
    }

    setStage(p, 12, 0); setStage(p, 17, 1); setStage(p, 34, 2); setStage(p, 22, 3);
    const firstWord = flowerWord([7, 14, 0, 0]);
    JavaRandom.setSeed(draws128.get(0));
    const first = proc(p, 'farming_potato_advance_word', firstWord, 1, 0, 0).popInt();
    const byte = (word, index) => (word >>> (index * 8)) & 255;
    assert.deepEqual([0, 1, 2, 3].map(index => byte(first, index)), [8, 15, 0, 0],
      'mature marigold protects its paired potato and onion bytes');

    const secondWord = flowerWord([35, 35, 53, 53]);
    JavaRandom.setSeed(draws128.get(0));
    const second = proc(p, 'farming_potato_advance_word', secondWord, 1, 16, 0).popInt();
    assert.deepEqual([0, 1, 2, 3].map(index => byte(second, index)), [36, 36, 54, 54],
      'scarecrow and nasturtium protect their corresponding sweetcorn and watermelon bytes');

    setStage(p, 12, 0);
    JavaRandom.setSeed(draws128.get(127));
    const alreadyDiseased = proc(p, 'farming_potato_advance_word', flowerWord([135, 0, 0, 0]), 1, 0, 0).popInt();
    assert.equal(byte(alreadyDiseased, 0), 199, 'protection does not cure an already-diseased crop');
    assert.deepEqual(selectors.map((_, index) => stage(p, index)), [12, 17, 34, 22],
      'crop advancement does not change flower protection state');
  });

  test('published scarecrow item assembly has all hay aliases and awards 25 XP only on completion', () => {
    for (const name of hayTypes) {
      const locId = id('LocType', name);
      assert(Scripts.getByTriggerSpecific(ServerTriggerType.OPLOCU, locId, -1),
        `${name} has a native item-on-loc hay-bale handler`);
    }
    const hayLoc = hayTypes.flatMap(name => hayMap.get(name)).find(Boolean);
    assert(hayLoc, 'the original map provides a reachable hay bale for a native packet test');
    const p = fixture({ stage: 3 });
    const hayTile = approach(hayLoc);
    p.x = hayTile.x; p.z = hayTile.z; p.level = hayLoc.level;
    p.setLevel(PlayerStat.FARMING, 22);
    add(p, 'sack_empty');
    const xpBefore = farmingXp(p);
    assert(use(p, 'sack_empty', hayLoc), 'native sack-on-hay packet is accepted');
    assert.equal(count(p, 'sack_empty'), 0);
    assert.equal(count(p, 'scarecrow_torso'), 1, 'hay fills the sack into a torso');
    assert.equal(farmingXp(p), xpBefore, 'hay filling awards no XP');

    add(p, 'bronze_spear');
    assert(useHeldOnHeld(p, 'scarecrow_torso', 'bronze_spear'), 'native item-on-item packet is accepted');
    assert.equal(count(p, 'bronze_spear'), 0);
    assert.equal(count(p, 'scarecrow_torso'), 0);
    assert.equal(count(p, 'scarecrow_torso_spear'), 1, 'bronze spear assembles the torso-spear');
    assert.equal(farmingXp(p), xpBefore, 'partial assembly awards no XP');

    add(p, 'watermelon');
    assert(useHeldOnHeld(p, 'scarecrow_torso_spear', 'watermelon'));
    assert.equal(count(p, 'watermelon'), 1, 'level 22 rejection preserves the watermelon');
    assert.equal(count(p, 'scarecrow_torso_spear'), 1, 'level 22 rejection preserves the torso-spear');
    assert.equal(count(p, 'scarecrow_complete'), 0);
    assert.equal(farmingXp(p), xpBefore, 'rejected final assembly awards no XP');

    p.setLevel(PlayerStat.FARMING, 23);
    const completedXp = farmingXp(p);
    assert(useHeldOnHeld(p, 'scarecrow_torso_spear', 'watermelon'));
    assert.equal(count(p, 'watermelon'), 0, 'level 23 final assembly consumes the head');
    assert.equal(count(p, 'scarecrow_torso_spear'), 0);
    assert.equal(count(p, 'scarecrow_complete'), 1, 'final assembly produces a complete scarecrow');
    assert.equal(farmingXp(p), completedXp + 250, 'one completed scarecrow awards 25 XP exactly once');

    p.x = approach(patchLocs[0]).x; p.z = approach(patchLocs[0]).z; p.level = patchLocs[0].level;
    add(p, 'spade');
    const madeXp = farmingXp(p);
    assert(use(p, 'scarecrow_complete', patchLocs[0]));
    assert.equal(stage(p), 36, 'installing on a weeded flower patch keeps the weed byte');
    assert.equal(count(p, 'scarecrow_complete'), 0);
    assert.equal(farmingXp(p), madeXp, 'installation awards no XP');
    assert(use(p, 'spade', patchLocs[0]));
    assert.equal(stage(p), 3, 'spade removal restores the prior weed state');
    assert.equal(count(p, 'scarecrow_complete'), 1, 'removed scarecrow is reusable');
    assert.equal(farmingXp(p), madeXp, 'removal awards no XP');
    assert(use(p, 'scarecrow_complete', patchLocs[0]));
    assert.equal(stage(p), 36, 'the completed scarecrow can be reinstalled');
    assert(use(p, 'spade', patchLocs[0]));
    assert.equal(stage(p), 3);
    assert.equal(count(p, 'scarecrow_complete'), 1);
    assert.equal(farmingXp(p), madeXp, 'install/reuse/remove never repeats assembly XP');
  });
} finally {
  Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = dateHandler;
}
console.log(`Flower compiled checks: ${cases - failures}/${cases} passed`);
process.exit(failures ? 1 : 0);
