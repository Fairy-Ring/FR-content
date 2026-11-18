/** Compiled native-packet tool-action regression checks. Run from sibling engine:
 * node --import tsx ../content/tests/farming/test_tool_actions.mjs
 * Loc/item interactions use the production packet handlers. Repeating actions
 * continue through the real pending OpLoc interaction and World player ticks.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, State, PlayerStat, JavaRandom, types, id, inv, player, add, count, use, click, load } from './runtime.mjs';

const map = await load('engine/GameMap.ts');
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const patchNames = [
  ...Array.from({ length: 4 }, (_, index) => `farming_herb_patch_${index + 1}`),
  'farming_veg_patch_1',
];
const placements = new Map(patchNames.map(name => [name, []]));
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
    if (!placements.has(config.debugname)) continue;
    const loc = World.getLoc(mapX * 64 + x, mapZ * 64 + z, level, type);
    assert(loc, `packed map loc for ${config.debugname} is present in World`);
    placements.get(config.debugname).push(loc);
  }
}
// Allotment beds contain multiple original tile locs sharing one selector.
// A native interaction needs one collision-valid tile, not a unique placement.
for (const name of patchNames) assert(placements.get(name).length > 0, `original-map tile for ${name}`);
const herbPatches = patchNames.slice(0, 4).map(name => placements.get(name)[0]);
const allotmentPatches = patchNames.slice(4).map(name => placements.get(name)[0]);

// VERIFIED: retained period Tip.It herb table. XP values are the independent
// 2006 source oracle in tenths, not copied from compiled farming_herb rows.
const herbs = [
  { name: 'guam', seed: 'guam_seed', produce: 'unidentified_guam', first: 4, plantXp: 110, harvestXp: 125 },
  { name: 'marrentill', seed: 'marrentill_seed', produce: 'unidentified_marentill', first: 11, plantXp: 130, harvestXp: 150 },
  { name: 'tarromin', seed: 'tarromin_seed', produce: 'unidentified_tarromin', first: 18, plantXp: 160, harvestXp: 180 },
  { name: 'harralander', seed: 'harralander_seed', produce: 'unidentified_harralander', first: 25, plantXp: 220, harvestXp: 240 },
  { name: 'ranarr', seed: 'ranarr_seed', produce: 'unidentified_ranarr', first: 32, plantXp: 265, harvestXp: 305 },
  { name: 'toadflax', seed: 'toadflax_seed', produce: 'unidentified_toadflax', first: 39, plantXp: 340, harvestXp: 380 },
  { name: 'irit', seed: 'irit_seed', produce: 'unidentified_irit', first: 46, plantXp: 430, harvestXp: 490 },
  { name: 'avantoe', seed: 'avantoe_seed', produce: 'unidentified_avantoe', first: 53, plantXp: 540, harvestXp: 620 },
  { name: 'kwuarm', seed: 'kwuarm_seed', produce: 'unidentified_kwuarm', first: 68, plantXp: 690, harvestXp: 820 },
  { name: 'snapdragon', seed: 'snapdragon_seed', produce: 'unidentified_snapdragon', first: 75, plantXp: 870, harvestXp: 990 },
  { name: 'cadantine', seed: 'cadantine_seed', produce: 'unidentified_cadantine', first: 82, plantXp: 1070, harvestXp: 1200 },
  { name: 'lantadyme', seed: 'lantadyme_seed', produce: 'unidentified_lantadyme', first: 89, plantXp: 1350, harvestXp: 1515 },
  { name: 'dwarf_weed', seed: 'dwarf_weed_seed', produce: 'unidentified_dwarf_weed', first: 96, plantXp: 1700, harvestXp: 1920 },
  { name: 'torstol', seed: 'torstol_seed', produce: 'unidentified_torstol', first: 103, plantXp: 1995, harvestXp: 2240 },
].map((herb, index) => ({ ...herb, mature: herb.first + 4, diseased: 128 + index * 3 }));

// VERIFIED: the Old School Weeds record gives 4 XP for each weed. Player.stats
// stores XP in tenths, matching the independently sourced herb oracle above.
const WEED_XP_TENTHS = 40;
const WEED_STAGE_COUNT = 3;
const WATERED_STAGE_OFFSET = 64;
// VERIFIED source-history cadence for automatic herb/allotment harvest; its
// use as a 377 behavior remains CANDIDATE. Ordinary rake cadence is UNKNOWN;
// the following limit is only a finite test-run guard, not an action-period claim.
const AUTO_HARVEST_TICKS = 3;
const MAX_RAKE_TICKS = 24;
const MAX_HARVEST_TICKS = AUTO_HARVEST_TICKS * 4;
const ACTION_DELAY = id('VarPlayerType', 'action_delay');
// CANDIDATE: cache evidence chooses human_dig for spade clearing but does not
// establish that this was the historical Farming animation.
const ANIMATION = {
  rake: id('SeqType', 'farming_raking'),
  dibber: id('SeqType', 'farming_seed_dibbing'),
  water: id('SeqType', 'farming_watering'),
  cure: id('SeqType', 'farming_plant_cure'),
  pick: id('SeqType', 'picking_low'),
  clear: id('SeqType', 'human_dig'),
};

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
function watchAnimations(p) {
  p.animationCalls = [];
  const playAnimation = p.playAnimation;
  p.playAnimation = function (sequence, delay) {
    this.animationCalls.push(sequence);
    return playAnimation.call(this, sequence, delay);
  };
  return p.animationCalls;
}
function fixture(loc, initialStage) {
  const p = player();
  const start = approach(loc);
  p.x = start.x; p.z = start.z; p.level = loc.level;
  p.setLevel(PlayerStat.FARMING, 99);
  p.farmingStartXp = p.stats[PlayerStat.FARMING];
  const selector = types.LocType.get(loc.type).multivarbit;
  assert(selector >= 0, `${types.LocType.get(loc.type).debugname} has a packed stage selector`);
  p.setVarBit(selector, initialStage);
  p.setVar(ACTION_DELAY, 0);
  watchAnimations(p);
  return p;
}
const stage = (p, loc) => p.getVarBit(types.LocType.get(loc.type).multivarbit);
const farmingXp = p => p.stats[PlayerStat.FARMING] - p.farmingStartXp;
const inventorySnapshot = p => Array.from({ length: types.InvType.get(inv).size }, (_, slot) => {
  const item = p.invGetSlot(inv, slot);
  return item ? { id: item.id, count: item.count } : null;
});
function randomSeedForDraw(range, expected) {
  for (let seed = 0; seed < 200000; seed++) {
    JavaRandom.setSeed(seed);
    if (Math.floor(JavaRandom.nextDouble() * range) === expected) return seed;
  }
  assert.fail(`no JavaRandom witness for ${expected}/${range}`);
}
const drawZeroSeed = randomSeedForDraw(256, 0);

// Use the real World.processPlayers pass without starting its recurring cycle timer.
function withPlayerTick(p, action) {
  World.playerLoop.add(2130706433n, p);
  try { return action(); }
  finally { p.unlink(); }
}
function playerTick() {
  World.currentTick++;
  World.processPlayers();
}
function finishDelayedAction(p, { maxResumes = 2, verify = () => {} } = {}) {
  let resumes = 0;
  verify();
  while (p.activeScript) {
    assert(resumes < maxResumes, `one-shot action finishes within ${maxResumes} interpreter resumes`);
    const suspended = p.activeScript;
    assert.equal(suspended.execution, State.SUSPENDED);
    assert.equal(p.delayed, true);
    const due = p.delayedUntil;
    assert(due > World.currentTick);
    World.currentTick = due - 1;
    World.processPlayers();
    assert.equal(p.activeScript, suspended, 'the real scheduler keeps the script suspended before its due tick');
    assert.equal(p.delayed, true);
    World.currentTick = due;
    World.processPlayers();
    resumes++;
    verify();
  }
  assert.equal(p.delayed, false);
  verify();
  return resumes;
}
function assertRefused(p, loc, action, expectedItems = {}) {
  const beforeStage = stage(p, loc);
  const beforeXp = farmingXp(p);
  const beforeInventory = inventorySnapshot(p);
  assert(action(), 'native packet is accepted before product-level refusal');
  assert.equal(stage(p, loc), beforeStage, 'refusal leaves the patch stage unchanged');
  assert.equal(farmingXp(p), beforeXp, 'refusal grants no Farming XP');
  assert.deepEqual(inventorySnapshot(p), beforeInventory, 'refusal leaves every inventory slot unchanged');
  assert.equal(p.animationCalls.some(sequence => sequence >= 0), false, 'refusal starts no animation');
  assert.equal(p.activeScript, null, 'refusal leaves no active player script');
  assert.equal(p.delayed, false, 'refusal does not delay the player');
  assert.equal(p.hasInteraction(), false, 'refusal leaves no pending action');
  for (const [name, amount] of Object.entries(expectedItems)) assert.equal(count(p, name), amount);
}
function assertNoSuspension(p) {
  assert.equal(p.activeScript, null, 'repeating actions use pending OpLoc continuation, not activeScript suspension');
  assert.equal(p.delayed, false, 'pending action delays are driven by action_delay/map_clock, not player delay');
}
function assertRakeProgress(p, loc, lastStage) {
  const current = stage(p, loc);
  assert(current >= lastStage && current <= WEED_STAGE_COUNT, `rake stage remains monotonic and bounded (${current})`);
  assert(current - lastStage <= 1, 'each successful rake cycle advances one weed stage');
  assert.equal(count(p, 'weeds'), current, 'each cleared stage yields exactly one weeds item');
  assert.equal(farmingXp(p), current * WEED_XP_TENTHS, 'each cleared stage awards exactly 4 XP');
  assert.equal(p.animationCalls.filter(sequence => sequence === ANIMATION.rake).length, current,
    'each cleared stage plays farming_raking once');
  assertNoSuspension(p);
  return current;
}

let cases = 0, failures = 0;
function test(name, action) {
  cases++;
  try { JavaRandom.setSeed(0); action(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack ?? error}`); }
}

const rakeTargets = [
  ['herb', herbPatches[0]],
  ['allotment', allotmentPatches[0]],
];
for (const [family, loc] of rakeTargets) {
  test(`${family} rake: one native use clears 0→1→2→3 with one weed and 4 XP per stage`, () => {
    const p = fixture(loc, 0);
    add(p, 'rake');
    withPlayerTick(p, () => {
      assert(use(p, 'rake', loc), 'one native OpLocU packet starts the rake action');
      let lastStage = assertRakeProgress(p, loc, 0);
      let ticks = 0;
      while (stage(p, loc) < WEED_STAGE_COUNT || p.hasInteraction()) {
        assert(ticks < MAX_RAKE_TICKS, `one rake use terminates within ${MAX_RAKE_TICKS} production player ticks`);
        playerTick();
        ticks++;
        lastStage = assertRakeProgress(p, loc, lastStage);
      }
      assert.equal(stage(p, loc), WEED_STAGE_COUNT);
      assert.equal(count(p, 'weeds'), WEED_STAGE_COUNT);
      assert.equal(farmingXp(p), WEED_STAGE_COUNT * WEED_XP_TENTHS);
      assert.equal(count(p, 'rake'), 1, 'the rake is retained');
      assert.equal(p.animationCalls.filter(sequence => sequence === ANIMATION.rake).length, WEED_STAGE_COUNT);
      assert.equal(p.hasInteraction(), false, 'the final weed terminates the pending OpLoc action');
    });
  });

  test(`${family} rake: full inventory and wrong tool refuse without animation or reward`, () => {
    const full = fixture(loc, 0);
    const capacity = types.InvType.get(inv).size;
    for (let slot = 0; slot < capacity - 1; slot++) add(full, 'potato');
    add(full, 'rake');
    assert(inventorySnapshot(full).every(item => item !== null), 'rake is present in a genuinely full inventory');
    withPlayerTick(full, () => assertRefused(full, loc, () => use(full, 'rake', loc), { potato: capacity - 1, rake: 1 }));

    const wrong = fixture(loc, 0);
    add(wrong, 'spade');
    withPlayerTick(wrong, () => assertRefused(wrong, loc, () => use(wrong, 'spade', loc), { spade: 1, weeds: 0 }));
  });

  test(`${family} rake: stopAction between stages prevents later weeds, XP, and animation`, () => {
    const p = fixture(loc, 0);
    add(p, 'rake');
    withPlayerTick(p, () => {
      assert(use(p, 'rake', loc));
      let ticks = 0;
      while (stage(p, loc) === 0) {
        assert(ticks < MAX_RAKE_TICKS, 'first rake stage is reached within the finite action window');
        playerTick();
        ticks++;
      }
      assert.equal(stage(p, loc), 1, 'cancel fixture is between the first and second stages');
      assert.equal(count(p, 'weeds'), 1);
      assert.equal(farmingXp(p), WEED_XP_TENTHS);
      assert(p.hasInteraction(), 'p_oploc continuation is pending between rake stages');
      assertNoSuspension(p);
      playerTick();
      assert.equal(stage(p, loc), 1, 'the player is still waiting between rake stages');
      assert(p.getVar(ACTION_DELAY) > World.currentTick, 'the next action is scheduled for a future map-clock tick');
      const before = { stage: stage(p, loc), weeds: count(p, 'weeds'), xp: farmingXp(p), anims: p.animationCalls.length };
      p.stopAction();
      assert.equal(p.hasInteraction(), false, 'stopAction clears the pending OpLoc continuation');
      for (let tick = 0; tick < MAX_RAKE_TICKS; tick++) {
        playerTick();
        assert.equal(stage(p, loc), before.stage);
        assert.equal(count(p, 'weeds'), before.weeds);
        assert.equal(farmingXp(p), before.xp);
        assert.equal(p.animationCalls.length, before.anims, 'cancelled continuation starts no later animation');
      }
    });
  });

  test(`${family} rake: filling the last inventory slot stops subsequent weed stages`, () => {
    const p = fixture(loc, 0);
    const capacity = types.InvType.get(inv).size;
    for (let slot = 0; slot < capacity - 2; slot++) add(p, 'potato');
    add(p, 'rake');
    withPlayerTick(p, () => {
      assert(use(p, 'rake', loc));
      assert.equal(stage(p, loc), 1);
      assert.equal(count(p, 'weeds'), 1);
      assert.equal(p.invFreeSpace(inv), 0);
      for (let tick = 0; tick < MAX_RAKE_TICKS; tick++) {
        playerTick();
        assert.equal(stage(p, loc), 1);
        assert.equal(count(p, 'weeds'), 1);
        assert.equal(farmingXp(p), WEED_XP_TENTHS);
      }
      assert.equal(p.animationCalls.filter(sequence => sequence === ANIMATION.rake).length, 1);
      assert.equal(p.hasInteraction(), false);
      assertNoSuspension(p);
    });
  });
}

test('dibber: native seed use animates and plants once; missing dibber refuses cleanly', () => {
  const loc = herbPatches[0];
  const p = fixture(loc, 3);
  add(p, 'guam_seed'); add(p, 'dibber');
  withPlayerTick(p, () => {
    assert(use(p, 'guam_seed', loc), 'native seed-on-patch packet is accepted');
    finishDelayedAction(p);
  });
  assert.equal(stage(p, loc), herbs[0].first);
  assert.equal(count(p, 'guam_seed'), 0);
  assert.equal(count(p, 'dibber'), 1);
  assert.equal(farmingXp(p), herbs[0].plantXp);
  assert(p.animationCalls.includes(ANIMATION.dibber), 'successful dibbing uses farming_seed_dibbing');
  assert.equal(p.hasInteraction(), false, 'planting is a single action');

  const refused = fixture(loc, 3);
  add(refused, 'guam_seed');
  withPlayerTick(refused, () => assertRefused(refused, loc, () => use(refused, 'guam_seed', loc), { guam_seed: 1, dibber: 0 }));
});

test('watering: native can use animates and charges once; empty can refuses cleanly', () => {
  const loc = allotmentPatches[0];
  const unwateredStage = 14;
  const p = fixture(loc, unwateredStage);
  add(p, 'watering_can_8');
  withPlayerTick(p, () => {
    assert(use(p, 'watering_can_8', loc), 'native can-on-patch packet is accepted');
    finishDelayedAction(p);
  });
  assert.equal(stage(p, loc), unwateredStage + WATERED_STAGE_OFFSET);
  assert.equal(count(p, 'watering_can_8'), 0);
  assert.equal(count(p, 'watering_can_7'), 1);
  assert.equal(farmingXp(p), 0, 'watering awards no Farming XP');
  assert(p.animationCalls.includes(ANIMATION.water), 'successful watering uses farming_watering');
  assert.equal(p.hasInteraction(), false, 'watering is a single action');

  const refused = fixture(loc, unwateredStage);
  add(refused, 'watering_can_0');
  withPlayerTick(refused, () => assertRefused(refused, loc, () => use(refused, 'watering_can_0', loc), { watering_can_0: 1, watering_can_7: 0 }));
});

test('cure: native diseased-form use animates and consumes cure; healthy form refuses cleanly', () => {
  const loc = herbPatches[0];
  const p = fixture(loc, herbs[0].diseased);
  add(p, 'plant_cure');
  withPlayerTick(p, () => {
    assert(use(p, 'plant_cure', loc), 'native cure-on-patch packet is accepted');
    finishDelayedAction(p);
  });
  assert.equal(stage(p, loc), herbs[0].first + 1);
  assert.equal(count(p, 'plant_cure'), 0);
  assert.equal(count(p, 'vial_empty'), 1);
  assert.equal(farmingXp(p), 0, 'curing awards no Farming XP');
  assert(p.animationCalls.includes(ANIMATION.cure), 'successful cure uses farming_plant_cure');
  assert.equal(p.hasInteraction(), false, 'curing is a single action');

  const refused = fixture(loc, herbs[0].first + 1);
  add(refused, 'plant_cure');
  withPlayerTick(refused, () => assertRefused(refused, loc, () => use(refused, 'plant_cure', loc), { plant_cure: 1, vial_empty: 0 }));
});

test('spade clearing: native dead-herb form animates and clears; wrong tool refuses', () => {
  const loc = herbPatches[0];
  const deadStage = 170;
  const p = fixture(loc, deadStage);
  add(p, 'spade');
  withPlayerTick(p, () => {
    assert(use(p, 'spade', loc), 'native spade-on-dead-patch packet is accepted');
    finishDelayedAction(p);
  });
  assert.equal(stage(p, loc), 3, 'spade clears the dead herb and returns the patch to weeded');
  assert.equal(count(p, 'spade'), 1);
  assert.equal(farmingXp(p), 0, 'clearing awards no Farming XP');
  assert(p.animationCalls.includes(ANIMATION.clear), 'successful dead clearing uses the selected human_dig CANDIDATE');
  assert.equal(p.hasInteraction(), false, 'clearing is a single action');

  const refused = fixture(loc, deadStage);
  add(refused, 'rake');
  withPlayerTick(refused, () => assertRefused(refused, loc, () => use(refused, 'rake', loc), { rake: 1, spade: 0 }));
});

test('herb Pick requires a spade and a full inventory refuses without rewards or animation', () => {
  const loc = herbPatches[0];
  const herb = herbs[0];
  const mature = fixture(loc, herb.mature);
  withPlayerTick(mature, () => assertRefused(mature, loc, () => click(mature, loc, 1), { [herb.produce]: 0, spade: 0 }));

  const full = fixture(loc, herb.mature);
  const capacity = types.InvType.get(inv).size;
  for (let slot = 0; slot < capacity - 1; slot++) add(full, 'potato');
  add(full, 'spade');
  assert(inventorySnapshot(full).every(item => item !== null), 'spade is present in a genuinely full inventory');
  withPlayerTick(full, () => assertRefused(full, loc, () => click(full, loc, 1), { potato: capacity - 1, spade: 1, [herb.produce]: 0 }));
});

// VERIFIED: Game tick and Action lengths histories retain the three-tick
// automatic-harvest sentence. Applying that later OSRS behavior to revision 377 is CANDIDATE.
for (const herb of herbs) {
  test(`${herb.name}: one native Pick automatically yields sourced per-herb rewards and animates`, () => {
    const loc = herbPatches[0];
    const p = fixture(loc, herb.mature);
    add(p, 'spade');
    let previousPicks = 0;
    let previousPickTick = null;
    const observe = () => {
      const picked = count(p, herb.produce);
      assert(picked >= previousPicks && picked <= WEED_STAGE_COUNT, 'automatic harvest is monotonic and finite');
      assert.equal(farmingXp(p), picked * herb.harvestXp, 'each pick grants this herb species’ independent XP reward');
      if (picked > previousPicks) {
        assert.equal(picked, previousPicks + 1, 'one auto-harvest cycle produces exactly one herb');
        if (previousPickTick !== null) assert.equal(World.currentTick - previousPickTick, AUTO_HARVEST_TICKS, 'automatic herb harvest repeats every three ticks');
        assert.equal(stage(p, loc), picked === WEED_STAGE_COUNT ? 3 : herb.mature + picked,
          'each harvested herb consumes exactly one guaranteed life');
        assert.equal(p.animationCalls.filter(sequence => sequence === ANIMATION.pick).length, picked,
          'every herb pick plays picking_low');
        previousPickTick = World.currentTick;
        previousPicks = picked;
      }
      assertNoSuspension(p);
    };
    withPlayerTick(p, () => {
      JavaRandom.setSeed(drawZeroSeed);
      assert(click(p, loc, 1), 'one native OpLoc Pick packet is accepted');
      observe();
      let ticks = 0;
      while (previousPicks < WEED_STAGE_COUNT || p.hasInteraction()) {
        assert(ticks < MAX_HARVEST_TICKS, `three-tick automatic harvest terminates within ${MAX_HARVEST_TICKS} production ticks`);
        World.currentTick++;
        JavaRandom.setSeed(drawZeroSeed);
        World.processPlayers();
        ticks++;
        observe();
      }
      assert.equal(previousPicks, WEED_STAGE_COUNT);
      assert.equal(count(p, herb.produce), WEED_STAGE_COUNT);
      assert.equal(farmingXp(p), WEED_STAGE_COUNT * herb.harvestXp);
      assert.equal(count(p, 'spade'), 1, 'the spade is retained');
      assert.equal(p.animationCalls.filter(sequence => sequence === ANIMATION.pick).length, WEED_STAGE_COUNT);
      assert.equal(p.hasInteraction(), false, 'the depleted patch ends the pending Pick action');
    });
  });
}

// VERIFIED period Tip.It per-item XP; CANDIDATE OSRS automatic cadence.
for (const [name, mature, harvestXp] of [
  ['potato', 10, 90], ['onion', 17, 110], ['cabbage', 24, 115],
  ['tomato', 31, 140], ['sweetcorn', 40, 190], ['strawberry', 49, 290],
  ['watermelon', 60, 545],
]) {
  test(`${name}: one native Harvest animates and automatically consumes three harvest lives`, () => {
    const loc = allotmentPatches[0];
    const p = fixture(loc, mature);
    add(p, 'spade');
    let previousPicks = 0, previousPickTick = null;
    const observe = () => {
      const picked = count(p, name);
      assert(picked >= previousPicks && picked <= 3);
      assert.equal(farmingXp(p), picked * harvestXp);
      if (picked > previousPicks) {
        assert.equal(picked, previousPicks + 1);
        if (previousPickTick !== null) assert.equal(World.currentTick - previousPickTick, AUTO_HARVEST_TICKS);
        assert.equal(stage(p, loc), picked === 3 ? 3 : mature + picked);
        assert.equal(p.animationCalls.filter(sequence => sequence === ANIMATION.pick).length, picked);
        previousPickTick = World.currentTick;
        previousPicks = picked;
      }
      assertNoSuspension(p);
    };
    withPlayerTick(p, () => {
      JavaRandom.setSeed(drawZeroSeed);
      assert(click(p, loc, 1));
      observe();
      let ticks = 0;
      while (previousPicks < 3 || p.hasInteraction()) {
        assert(ticks < MAX_HARVEST_TICKS);
        World.currentTick++;
        JavaRandom.setSeed(drawZeroSeed);
        World.processPlayers();
        ticks++;
        observe();
      }
      assert.equal(previousPicks, 3);
      assert.equal(count(p, 'spade'), 1);
      assert.equal(p.hasInteraction(), false);
    });
  });
}

test('manual Pick waits two ticks; stopping the pending harvest prevents later rewards', () => {
  const herb = herbs[0], loc = herbPatches[0];
  const p = fixture(loc, herb.mature);
  add(p, 'spade');
  withPlayerTick(p, () => {
    JavaRandom.setSeed(drawZeroSeed);
    assert(click(p, loc, 1));
    assert.equal(count(p, herb.produce), 1);
    World.currentTick++;
    assert(click(p, loc, 1));
    assert.equal(count(p, herb.produce), 1, 'a click after one tick grants no second herb');
    World.currentTick++;
    JavaRandom.setSeed(drawZeroSeed);
    assert(click(p, loc, 1));
    assert.equal(count(p, herb.produce), 2, 'a click after two ticks grants one second herb');
    assert.equal(farmingXp(p), herb.harvestXp * 2);
    p.stopAction();
    for (let tick = 0; tick < MAX_HARVEST_TICKS; tick++) playerTick();
    assert.equal(count(p, herb.produce), 2);
    assert.equal(farmingXp(p), herb.harvestXp * 2);
    assert.equal(p.hasInteraction(), false);
    assertNoSuspension(p);
  });
});

console.log(`Farming tool-action checks: ${cases - failures}/${cases} passed`);
process.exit(failures ? 1 : 0);
