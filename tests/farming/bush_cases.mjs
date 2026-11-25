/** Native packed-packet bush checks for the original four selectors. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, JavaRandom, PlayerStat, types, id, inv, player, proc, add, count, use, click, load } from './runtime.mjs';

const map = await load('engine/GameMap.ts');
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const patchNames = ['farming_bush_patch_1', 'farming_bush_patch_2', 'farming_bush_patch_3', 'farming_bush_patch_4'];
const crops = [
  { name: 'redberry', seed: 'redberry_bush_seed', produce: 'redberries', prefix: 'redberry_bush', first: 5, mature: 10, last: 14, claim: 250, level: 10, seedCount: 1, plantXp: 85, checkXp: 640, harvestXp: 40, plural: 'redberries' },
  { name: 'cadavaberry', seed: 'cadavaberry_bush_seed', produce: 'cadavaberries', prefix: 'cadavaberry_bush', first: 15, mature: 21, last: 25, claim: 251, level: 22, seedCount: 1, plantXp: 185, checkXp: 1020, harvestXp: 70, plural: 'cadavaberries' },
  { name: 'dwellberry', seed: 'dwellberry_bush_seed', produce: 'dwellberries', prefix: 'dwellberry_bush', first: 26, mature: 33, last: 37, claim: 252, level: 36, seedCount: 1, plantXp: 310, checkXp: 1775, harvestXp: 120, plural: 'dwellberries' },
  { name: 'jangerberry', seed: 'jangerberry_bush_seed', produce: 'jangerberries', prefix: 'jangerberry_bush', first: 38, mature: 46, last: 50, claim: 253, level: 48, seedCount: 1, plantXp: 505, checkXp: 2845, harvestXp: 190, plural: 'jangerberries' },
  { name: 'whiteberry', seed: 'whiteberry_bush_seed', produce: 'white_berries', prefix: 'whiteberry_bush', first: 51, mature: 59, last: 63, claim: 254, level: 59, seedCount: 1, plantXp: 780, checkXp: 4370, harvestXp: 290, plural: 'white berries' },
  { name: 'poison_ivy', seed: 'poisonivy_bush_seed', produce: 'poisonivy_berries', prefix: 'poisonivy_bush', first: 197, mature: 205, last: 209, claim: 255, level: 70, seedCount: 1, plantXp: 1200, checkXp: 6740, harvestXp: 450, plural: 'poison ivy berries' },
];
// Independent period Farmer charge-table oracle.
const fees = [
  ['sack_cabbage_10', 4], ['basket_tomato_5', 3], ['basket_strawberry_5', 3],
  ['watermelon', 6], ['bittercap_mushroom', 8], ['coconut', 15]
];
const selectorsByName = ['farming_bush_varp_0_7', 'farming_bush_varp_8_15', 'farming_bush_varp_16_23', 'farming_bush_varp_24_31'];

function findPatch(name) {
  const type = id('LocType', name);
  for (const file of fs.readdirSync(path.join(content, 'maps')).filter(x => /^m[0-9]+_[0-9]+[.]jm2$/.test(x))) {
    const [, mx, mz] = /^m([0-9]+)_([0-9]+)[.]jm2$/.exec(file).map(Number);
    let section;
    for (const line of fs.readFileSync(path.join(content, 'maps', file), 'utf8').split(/\r?\n/)) {
      if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
      if (section !== 'LOC') continue;
      const match = /^([0-3]) ([0-9]+) ([0-9]+): ([0-9]+)(?: |$)/.exec(line);
      if (!match || Number(match[4]) !== type) continue;
      const loc = World.getLoc(mx * 64 + Number(match[2]), mz * 64 + Number(match[3]), Number(match[1]), type);
      if (!loc) continue;
      const config = types.LocType.get(type);
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const x = loc.x + dx, z = loc.z + dz;
        if (!map.isMapBlocked(x, z, loc.level)
          && map.reachedLoc(loc.level, x, z, loc.x, loc.z, config.width, config.length, 1, loc.angle, loc.shape, config.forceapproach)) return { loc, x, z };
      }
    }
  }
  assert.fail(`no collision-reachable original ${name}`);
}

function findSeedForDraw(range, draw) {
  for (let seed = 0; seed < 200000; seed++) {
    JavaRandom.setSeed(seed);
    if (Math.floor(JavaRandom.nextDouble() * range) === draw) return seed;
  }
  assert.fail(`no JavaRandom witness for draw ${draw} in ${range}`);
}

function visibleName(parent, stage) {
  return types.LocType.get(parent.multiloc[stage]).debugname;
}
function bushForm(crop, stage) {
  if (stage === crop.first) return `${crop.prefix}_seedling`;
  if (stage < crop.mature) return `${crop.prefix}_${stage - crop.first}`;
  if (stage === crop.mature) return `${crop.prefix}_fullygrown`;
  return `${crop.prefix}_berry_${stage - crop.mature}`;
}
function diseaseForm(crop, base) {
  return base === crop.mature ? `${crop.prefix}_fullygrown_diseased` : `${crop.prefix}_${base - crop.first}_diseased`;
}
function deadForm(crop, base) {
  return base === crop.mature ? `${crop.prefix}_fullygrown_dead` : `${crop.prefix}_${base - crop.first}_dead`;
}
function patchFixture(specs, selectors, patchIndex = 0, level = 99, stages = [3, 3, 3, 3]) {
  const p = player();
  p.x = specs[patchIndex].x;
  p.z = specs[patchIndex].z;
  p.level = specs[patchIndex].loc.level;
  p.setLevel(PlayerStat.FARMING, level);
  p.startXp = p.stats[PlayerStat.FARMING];
  p.setVar(id('VarPlayerType', 'action_delay'), 0);
  stages.forEach((value, index) => p.setVarBit(selectors[index], value));
  return p;
}
function withPlayerTick(p, action) {
  World.playerLoop.add(2130706433n, p);
  try { return action(); }
  finally { p.unlink(); }
}
const stageOf = (p, selectors, index = 0) => p.getVarBit(selectors[index]);
const setStage = (p, selectors, value, index = 0) => p.setVarBit(selectors[index], value);
const farmingXp = p => p.stats[PlayerStat.FARMING] - p.startXp;

export function assertBushCases() {
  const specs = patchNames.map(name => ({ name, ...findPatch(name) }));
  const selectors = specs.map(spec => types.LocType.get(spec.loc.type).multivarbit);
  assert.deepEqual(selectors, selectorsByName.map(name => id('VarBitType', name)), 'four original bush selector bytes are unchanged');
  const bushVarp = types.VarBitType.get(selectors[0]).basevar;
  assert(selectors.every(selector => types.VarBitType.get(selector).basevar === bushVarp), 'bush selectors share the original transmitted varp');
  const careVar = id('VarPlayerType', 'farming_protection');

  const bushTable = types.DbTableType.getByName('farming_bush');
  assert(bushTable, 'compiled farming_bush table is required');
  const column = name => {
    const index = bushTable.columnNames.indexOf(name);
    assert(index >= 0, `missing farming_bush column ${name}`);
    return index;
  };
  const columns = Object.fromEntries(['seed', 'produce', 'first', 'mature', 'last', 'claim', 'level', 'seed_count', 'plant_xp', 'check_xp', 'harvest_xp', 'plural']
    .map(name => [name, column(name)]));
  const value = (row, name) => row.getValue(columns[name], 0)[0];
  const rows = types.DbRowType.getInTable(bushTable.id);
  assert.equal(rows.length, crops.length, 'the bush table has exactly the six cache crops');
  const rowsBySeed = new Map(rows.map(row => [value(row, 'seed'), row]));
  const probe = player();

  for (const crop of crops) {
    const row = rowsBySeed.get(id('ObjType', crop.seed));
    assert(row, `${crop.name} data row is keyed by its cache seed`);
    for (const [field, expected] of [
      ['seed', id('ObjType', crop.seed)], ['produce', id('ObjType', crop.produce)],
      ['first', crop.first], ['mature', crop.mature], ['last', crop.last], ['claim', crop.claim],
      ['level', crop.level], ['seed_count', 1], ['plant_xp', crop.plantXp],
      ['check_xp', crop.checkXp], ['harvest_xp', crop.harvestXp], ['plural', crop.plural],
    ]) assert.equal(value(row, field), expected, `${crop.name} ${field}`);
    assert.equal(proc(probe, 'farming_bush_seed', id('ObjType', crop.seed)).popInt(), row.id, `${crop.name} seed dispatch`);
    for (let stage = crop.first; stage <= crop.last; stage++) {
      assert.equal(proc(probe, 'farming_bush_crop', stage).popInt(), row.id, `${crop.name} normal stage ${stage}`);
    }
    assert.equal(proc(probe, 'farming_bush_crop', crop.claim).popInt(), row.id, `${crop.name} check-health stage`);

    if (crop.name !== 'poison_ivy') {
      for (let stage = crop.first + 65; stage <= crop.mature + 64; stage++) {
        assert.equal(proc(probe, 'farming_bush_crop', stage).popInt(), row.id, `${crop.name} diseased stage ${stage}`);
        assert.equal(proc(probe, 'farming_bush_is_diseased', stage).popInt(), 1, `${crop.name} disease predicate ${stage}`);
      }
      for (let stage = crop.first + 129; stage <= crop.mature + 128; stage++) {
        assert.equal(proc(probe, 'farming_bush_crop', stage).popInt(), row.id, `${crop.name} dead stage ${stage}`);
        assert.equal(proc(probe, 'farming_bush_is_dead', stage).popInt(), 1, `${crop.name} dead predicate ${stage}`);
      }
    } else {
      for (let stage = crop.first + 13; stage < crop.mature + 12; stage++) {
        assert.equal(proc(probe, 'farming_bush_crop', stage).popInt(), row.id, `poison ivy diseased stage ${stage}`);
        assert.equal(proc(probe, 'farming_bush_is_diseased', stage).popInt(), 1, `poison ivy disease predicate ${stage}`);
      }
      assert.equal(proc(probe, 'farming_bush_crop', 225).popInt(), row.id, 'poison ivy fully-grown diseased stage');
      assert.equal(proc(probe, 'farming_bush_is_diseased', 225).popInt(), 1, 'poison ivy fully-grown disease predicate');
      for (let stage = crop.first + 20; stage <= crop.mature + 19; stage++) {
        assert.equal(proc(probe, 'farming_bush_crop', stage).popInt(), row.id, `poison ivy dead stage ${stage}`);
        assert.equal(proc(probe, 'farming_bush_is_dead', stage).popInt(), 1, `poison ivy dead predicate ${stage}`);
      }
    }
  }

  for (const spec of specs) {
    const parent = types.LocType.get(spec.loc.type);
    for (const crop of crops) {
      for (let stage = crop.first; stage <= crop.last; stage++) {
        assert.equal(visibleName(parent, stage), bushForm(crop, stage), `${spec.name} ${crop.name} stage ${stage}`);
      }
      assert.equal(visibleName(parent, crop.claim), `${crop.prefix}_claim_xp`, `${spec.name} ${crop.name} claim form`);
      if (crop.name !== 'poison_ivy') {
        for (let stage = crop.first + 65; stage <= crop.mature + 64; stage++) {
          assert.equal(visibleName(parent, stage), diseaseForm(crop, stage - 64), `${spec.name} ${crop.name} disease ${stage}`);
        }
        for (let stage = crop.first + 129; stage <= crop.mature + 128; stage++) {
          assert.equal(visibleName(parent, stage), deadForm(crop, stage - 128), `${spec.name} ${crop.name} dead ${stage}`);
        }
      } else {
        for (let stage = crop.first + 13; stage < crop.mature + 12; stage++) {
          assert.equal(visibleName(parent, stage), diseaseForm(crop, stage - 12), `${spec.name} poison ivy disease ${stage}`);
        }
        assert.equal(visibleName(parent, 225), `${crop.prefix}_fullygrown_diseased`, `${spec.name} poison ivy fully-grown disease`);
        for (let stage = crop.first + 20; stage <= crop.mature + 19; stage++) {
          assert.equal(visibleName(parent, stage), deadForm(crop, stage - 19), `${spec.name} poison ivy dead ${stage}`);
        }
      }
    }
  }

  const growthTable = types.DbTableType.getByName('farming_growth');
  assert(growthTable, 'compiled farming_growth table is required');
  const growthColumn = name => growthTable.columnNames.indexOf(name);
  const growthRows = types.DbRowType.getInTable(growthTable.id);
  const bushGrowth = growthRows.filter(row => row.getValue(growthColumn('handler'), 0)[0] === 6);
  assert.equal(bushGrowth.length, 1, 'one handler row dispatches bush growth');
  assert.equal(bushGrowth[0].getValue(growthColumn('period'), 0)[0], 20, 'parent-selected candidate bush period is twenty minutes');
  assert.equal(bushGrowth[0].getValue(growthColumn('disease_period'), 0)[0], 40, 'parent-selected disease hold is forty minutes');

  const red = crops[0];
  const lowDiseaseSeed = findSeedForDraw(128, 0);
  const healthySeed = findSeedForDraw(128, 127);
  JavaRandom.setSeed(lowDiseaseSeed);
  assert.equal(proc(probe, 'farming_bush_advance', red.first + 1, 1, 0, 0).popInt(), red.first + 65, 'ordinary bush cache adds disease at its +64 band');
  JavaRandom.setSeed(healthySeed);
  assert.equal(proc(probe, 'farming_bush_advance', red.first + 1, 1, 0, 0).popInt(), red.first + 2, 'ordinary bush can advance without disease');
  assert.equal(proc(probe, 'farming_bush_advance', red.first + 65, 1, 0, 20).popInt(), red.first + 65, 'disease waits for its next growth tier');
  assert.equal(proc(probe, 'farming_bush_advance', red.first + 65, 1, 0, 40).popInt(), red.first + 129, 'ordinary bush disease maps to the cache dead band');
  const poison = crops[5];
  JavaRandom.setSeed(lowDiseaseSeed);
  assert.equal(proc(probe, 'farming_bush_advance', poison.first + 1, 1, 0, 0).popInt(), poison.first + 2, 'assigned poison ivy immunity bypasses disease rolls');
  assert.equal(proc(probe, 'farming_bush_advance', red.mature, 4, 0, 0).popInt(), red.last, 'berry stages grow through four cache forms');

  for (let cropIndex = 0; cropIndex < crops.length; cropIndex++) {
    const crop = crops[cropIndex];
    const patchIndex = cropIndex % specs.length;
    const before = [5, 15, 26, 38];
    before[patchIndex] = 3;
    const p = patchFixture(specs, selectors, patchIndex, crop.level, before);
    add(p, crop.seed, crop.seedCount);
    add(p, 'dibber', 1);
    assert(use(p, crop.seed, specs[patchIndex].loc), `${crop.name} seed-on-patch packet is accepted`);
    const expected = before.slice(); expected[patchIndex] = crop.first;
    assert.deepEqual(selectors.map((_, index) => stageOf(p, selectors, index)), expected, `${crop.name} planting changes only the selected byte`);
    assert.equal(count(p, crop.seed), 0, `${crop.name} seed is consumed`);
    assert.equal(count(p, 'dibber'), 1, 'dibber is retained');
    assert.equal(farmingXp(p), crop.plantXp, `${crop.name} plant XP is in tenths`);
    const packed = expected.reduce((word, value, index) => word | (value << (index * 8)), 0);
    assert.equal(p.getVar(bushVarp), packed, 'native planting writes the original packed bush varp');
    const [payment, quantity] = fees[cropIndex], unrelated = 0x51000003, watched = 1 << (12 + patchIndex);
    p.setVar(careVar, unrelated);
    add(p, payment, quantity - 1);
    assert.equal(proc(p, 'farming_protection_hire', 12 + patchIndex).popInt(), 0, `${crop.name} partial payment is refused`);
    assert.equal(count(p, payment), quantity - 1, 'partial payment takes nothing');
    assert.equal(p.getVar(careVar), unrelated, 'refusal writes no care bit');
    add(p, payment, 1);
    assert.equal(proc(p, 'farming_protection_hire', 12 + patchIndex).popInt(), 1, `${crop.name} exact period payment is accepted`);
    assert.equal(count(p, payment), 0);
    assert.equal(p.getVar(careVar), unrelated | watched, 'only this bush protection bit is written');
    assert.equal(proc(p, 'farming_protection_hire', 12 + patchIndex).popInt(), 0, 'a paid planting cannot charge twice');
    const saved = player(p.save());
    assert.equal(saved.getVar(careVar), unrelated | watched, 'bush care survives save/load');
    assert.equal(stageOf(saved, selectors, patchIndex), crop.first, 'planted bush survives save/load');
    saved.unlink();
    for (let step = 1; step <= crop.mature - crop.first; step++) {
      JavaRandom.setSeed(lowDiseaseSeed); // OFFLINE RNG fixture: protection must defeat the disease draw.
      proc(p, 'farming_bush_advance_all', 1, step * 20);
      assert.equal(stageOf(p, selectors, patchIndex), step === crop.mature - crop.first ? crop.claim : crop.first + step,
        `${crop.name} protected growth reaches every original stage`);
    }
    withPlayerTick(p, () => assert(click(p, specs[patchIndex].loc, 1), `${crop.name} native Check-health`));
    assert.equal(stageOf(p, selectors, patchIndex), crop.last, 'original claim model retains its four berries after Check-health');
    assert.equal(farmingXp(p), crop.plantXp + crop.checkXp);
    for (let picked = 1; picked <= 4; picked++) {
      withPlayerTick(p, () => assert(click(p, specs[patchIndex].loc, 1), `${crop.name} native berry pick`));
      assert.equal(count(p, crop.produce), picked);
      assert.equal(stageOf(p, selectors, patchIndex), crop.last - picked);
      assert.equal(farmingXp(p), crop.plantXp + crop.checkXp + picked * crop.harvestXp);
    }
    proc(p, 'farming_bush_advance_all', 1, 200);
    assert.equal(stageOf(p, selectors, patchIndex), crop.mature + 1, `${crop.name} regrows its first berry`);
    proc(p, 'farming_bush_advance_all', 3, 220);
    assert.equal(stageOf(p, selectors, patchIndex), crop.last, `${crop.name} regrows all four berries`);
    assert.equal(farmingXp(p), crop.plantXp + crop.checkXp + 4 * crop.harvestXp, 'passive regrowth awards no XP');
    add(p, 'spade', 1);
    withPlayerTick(p, () => assert(use(p, 'spade', specs[patchIndex].loc), `${crop.name} native clearing`));
    assert.equal(stageOf(p, selectors, patchIndex), 3);
    assert.equal(p.getVar(careVar), unrelated, 'clearing ends only this planting protection');
    if (crop.name !== 'poison_ivy') for (let normal = crop.first + 1; normal < crop.mature; normal++) {
      const diseased = normal + 64, dead = normal + 128;
      assert.equal(proc(p, 'farming_bush_advance', diseased, 1, 0, 40).popInt(), dead, `${crop.name} disease progresses to its matching dead form`);
      const sick = patchFixture(specs, selectors, patchIndex);
      setStage(sick, selectors, diseased, patchIndex); add(sick, 'secateurs', 1);
      withPlayerTick(sick, () => assert(use(sick, 'secateurs', specs[patchIndex].loc), `${crop.name} native pruning at stage ${normal}`));
      assert.equal(stageOf(sick, selectors, patchIndex), normal);
      assert.equal(count(sick, 'secateurs'), 1, 'pruning retains secateurs');
      assert.equal(farmingXp(sick), 0);
      setStage(sick, selectors, dead, patchIndex); add(sick, 'spade', 1);
      withPlayerTick(sick, () => assert(use(sick, 'spade', specs[patchIndex].loc), `${crop.name} native dead-bush removal`));
      assert.equal(stageOf(sick, selectors, patchIndex), 3);
    }
  }

  const under = patchFixture(specs, selectors, 0, poison.level - 1);
  add(under, poison.seed, 1); add(under, 'dibber', 1);
  assert(use(under, poison.seed, specs[0].loc));
  assert.equal(stageOf(under, selectors), 3, 'under-level bush planting leaves the patch weeded');
  assert.equal(count(under, poison.seed), 1, 'under-level planting consumes no seed');
  assert.equal(farmingXp(under), 0, 'under-level planting grants no XP');

  const lifecycle = patchFixture(specs, selectors, 0, 99);
  add(lifecycle, red.seed, 1); add(lifecycle, 'dibber', 1);
  assert(use(lifecycle, red.seed, specs[0].loc), 'native redberry planting starts the lifecycle');
  setStage(lifecycle, selectors, red.mature - 1);
  JavaRandom.setSeed(healthySeed);
  proc(lifecycle, 'farming_bush_advance_all', 1, 0);
  assert.equal(stageOf(lifecycle, selectors), red.claim, 'first maturity exposes the cache check-health state');
  withPlayerTick(lifecycle, () => assert(click(lifecycle, specs[0].loc, 1), 'native Check-health action is accepted'));
  assert.equal(stageOf(lifecycle, selectors), red.last, 'Check-health preserves the four-berry cache model');
  assert.equal(farmingXp(lifecycle), red.plantXp + red.checkXp, 'check-health grants the cached XP once');
  proc(lifecycle, 'farming_bush_advance_all', 4, 0);
  assert.equal(stageOf(lifecycle, selectors), red.last, 'four growth steps produce the four-berry cache stage');
  for (let picked = 0; picked < 4; picked++) {
    withPlayerTick(lifecycle, () => assert(click(lifecycle, specs[0].loc, 1), 'native Pick-from action is accepted'));
    assert.equal(count(lifecycle, red.produce), picked + 1, 'one berry is picked per native action');
    assert.equal(stageOf(lifecycle, selectors), red.last - picked - 1, 'each pick removes one berry form');
  }
  assert.equal(farmingXp(lifecycle), red.plantXp + red.checkXp + 4 * red.harvestXp, 'all four picks grant period XP');
  proc(lifecycle, 'farming_bush_advance_all', 1, 20);
  assert.equal(stageOf(lifecycle, selectors), red.mature + 1, 'a picked bush regrows berries when left');

  const care = patchFixture(specs, selectors, 0, 99);
  setStage(care, selectors, red.first + 65);
  add(care, 'plant_cure', 1);
  withPlayerTick(care, () => assert(use(care, 'plant_cure', specs[0].loc), 'native plant-cure item-on-patch packet is accepted'));
  assert.equal(stageOf(care, selectors), red.first + 1, 'plant cure maps the +64 diseased form to its healthy stage');
  assert.equal(count(care, 'vial_empty'), 1, 'plant cure returns an empty vial');
  setStage(care, selectors, red.first + 129);
  add(care, 'spade', 1);
  withPlayerTick(care, () => assert(use(care, 'spade', specs[0].loc), 'native spade item-on-patch packet is accepted'));
  assert.equal(stageOf(care, selectors), 3, 'spade clears a dead bush');
}

export const testBushes = assertBushCases;
