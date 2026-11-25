/** Native packed-packet checks for N025/N026/N027/N038/N041. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, Runner, ScriptOpcode, PlayerStat, JavaRandom, Scripts, types, id,
  inv, player, proc, add, count, use, click, load } from './runtime.mjs';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const map = await load('engine/GameMap.ts');
const specs = [
  { name: 'belladonna', patch: 'farming_belladonna_patch', seed: 'belladonna_seed', produce: 'nightshade', first: 4, mature: 8, last: 8, disease: 9, dead: 12, level: 63, plant: 910, check: 0, pick: 5120, yield: 1, handler: 8, period: 80, soil: 25 },
  { name: 'cactus', patch: 'farming_cactus_patch', seed: 'cactus_seed', produce: 'cactus_spine', first: 8, mature: 15, last: 18, disease: 19, dead: 25, level: 55, plant: 570, check: 3740, pick: 250, yield: 3, handler: 7, period: 80, soil: 24 },
  { name: 'mushroom', patch: 'farming_mushroom_patch', seed: 'mushroom_seed', produce: 'bittercap_mushroom', first: 4, mature: 10, last: 15, disease: 16, dead: 21, level: 53, plant: 410, check: 0, pick: 570, yield: 6, handler: 9, period: 40, soil: 26 },
];
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
      const cfg = types.LocType.get(type);
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const x = loc.x + dx, z = loc.z + dz;
        if (!map.isMapBlocked(x, z, loc.level) && map.reachedLoc(loc.level, x, z, loc.x, loc.z, cfg.width, cfg.length, 1, loc.angle, loc.shape, cfg.forceapproach)) return { loc, x, z };
      }
    }
  }
  assert.fail('no collision-reachable original ' + name);
}
for (const spec of specs) {
  Object.assign(spec, findPatch(spec.patch));
  spec.selector = types.LocType.get(spec.loc.type).multivarbit;
  spec.row = id('DbRowType', 'farming_special_' + spec.name);
}
const delay = id('VarPlayerType', 'action_delay');
function fixture(spec, stage = 3, level = 99) {
  const p = player();
  p.x = spec.x; p.z = spec.z; p.level = spec.loc.level;
  p.setLevel(PlayerStat.FARMING, level);
  p.setLevel(PlayerStat.HITPOINTS, 99);
  p.startXp = p.stats[PlayerStat.FARMING];
  p.setVarBit(spec.selector, stage);
  return p;
}
const stage = (p, spec) => p.getVarBit(spec.selector);
const xp = p => p.stats[PlayerStat.FARMING] - p.startXp;
function act(p, fn) { World.currentTick += 3; p.setVar(delay, 0); assert(fn(), 'native packet accepted'); }
function healthySeed() {
  for (let seed = 0; seed < 10000; seed++) {
    JavaRandom.setSeed(seed);
    if (Array.from({ length: 8 }, () => Math.floor(JavaRandom.nextDouble() * 128)).every(x => x >= 20)) return seed;
  }
  assert.fail('healthy native random witness');
}
const healthy = healthySeed();
for (const s of specs) {
  const p = fixture(s, 0);
  add(p, 'rake'); add(p, 'dibber'); add(p, 'spade'); add(p, s.seed);
  for (let n = 0; n < 3; n++) { act(p, () => use(p, 'rake', s.loc)); assert.equal(stage(p, s), n + 1); }
  assert.equal(count(p, 'weeds'), 3); assert.equal(xp(p), 120);
  act(p, () => use(p, s.seed, s.loc));
  assert.equal(stage(p, s), s.first, s.name + ' seed');
  assert.equal(count(p, s.seed), 0); assert.equal(xp(p), s.plant + 120);
  const messagesBeforeInspect = p.messages.length;
  act(p, () => click(p, s.loc, 2));
  assert(p.messages.length > messagesBeforeInspect, s.name + ' planted native Inspect');
  assert.equal(stage(p, s), s.first); assert.equal(xp(p), s.plant + 120);
  JavaRandom.setSeed(healthy);
  proc(p, 'farming_growth_dispatch', s.handler, s.mature - s.first, 0);
  assert.equal(stage(p, s), s.name === 'cactus' ? 31 : s.mature, s.name + ' shared growth dispatch');
  if (s.check) {
    act(p, () => click(p, s.loc)); assert.equal(stage(p, s), 18);
    assert.equal(xp(p), s.plant + s.check + 120);
  }
  if (s.name === 'belladonna') {
    const hp = p.levels[PlayerStat.HITPOINTS];
    act(p, () => click(p, s.loc));
    assert.equal(p.levels[PlayerStat.HITPOINTS], hp - 2, 'bare-hand poison hit');
    assert.equal(stage(p, s), s.mature); assert.equal(count(p, s.produce), 0);
    assert.equal(p.getVar(id('VarPlayerType', 'poison')), 0, 'sting is not continuing poison');
    p.invSet(id('InvType', 'worn'), id('ObjType', 'leather_gloves'), 1, 9);
  }
  for (let n = 0; n < s.yield; n++) {
    act(p, () => click(p, s.loc));
    assert.equal(count(p, s.produce), n + 1, s.name + ' pick count');
    assert.equal(xp(p), s.plant + s.check + (n + 1) * s.pick + 120, s.name + ' rewards');
  }
  assert.equal(stage(p, s), s.name === 'cactus' ? 15 : 3);
  proc(p, 'farming_growth_dispatch', s.handler, 30, 0);
  assert.equal(stage(p, s), s.name === 'cactus' ? 15 : 3, 'period specialty no regrowth');
  if (s.name === 'cactus') {
    act(p, () => use(p, 'spade', s.loc)); assert.equal(stage(p, s), 3);
  }
  console.log('PASS ' + s.name + ' rake/plant/grow/harvest/clear/XP');

  for (let index = 0; index < s.mature - s.first - 1; index++) {
    const q = fixture(s, s.disease + index);
    add(q, 'plant_cure');
    act(q, () => use(q, 'plant_cure', s.loc));
    assert.equal(stage(q, s), s.first + 1 + index, s.name + ' cure restores exact stage');
    assert.equal(count(q, 'vial_empty'), 1); assert.equal(count(q, 'plant_cure'), 0);
    q.setVarBit(s.selector, s.disease + index);
    proc(q, 'farming_growth_dispatch', s.handler, 1, 0);
    assert.equal(stage(q, s), s.dead + index, s.name + ' next disease tier death');
    add(q, 'spade'); act(q, () => use(q, 'spade', s.loc));
    assert.equal(stage(q, s), 3, s.name + ' remove dead crop'); assert.equal(xp(q), 0);
  }
  const dry = fixture(s, s.first + 1);
  JavaRandom.setSeed(0); // java.util.Random seed0 does not promise a chosen disease roll.
  let diseaseSeed;
  for (let seed = 0; seed < 10000; seed++) { JavaRandom.setSeed(seed); if (Math.floor(JavaRandom.nextDouble() * 128) < 20) { diseaseSeed = seed; break; } }
  assert.notEqual(diseaseSeed, undefined);
  JavaRandom.setSeed(diseaseSeed); proc(dry, 'farming_growth_dispatch', s.handler, 1, 0);
  assert.equal(stage(dry, s), s.disease, s.name + ' native disease roll');
  console.log('PASS ' + s.name + ' every disease/cure/death form');

  for (const level of [s.level - 1, s.level]) {
    const q = fixture(s, 3, level); add(q, s.seed); add(q, 'dibber');
    act(q, () => use(q, s.seed, s.loc));
    assert.equal(stage(q, s), level < s.level ? 3 : s.first);
    assert.equal(count(q, s.seed), level < s.level ? 1 : 0);
  }
  const missing = fixture(s); add(missing, s.seed);
  act(missing, () => use(missing, s.seed, s.loc));
  assert.equal(stage(missing, s), 3); assert.equal(count(missing, s.seed), 1); assert.equal(xp(missing), 0);
  const treated = fixture(s); add(treated, 'bucket_supercompost');
  act(treated, () => use(treated, 'bucket_supercompost', s.loc));
  assert.equal(proc(treated, 'farming_soil_treatment', s.soil).popInt(), 2);
  assert.equal(count(treated, 'bucket_empty'), 1);
  const word = treated.getVar(id('VarPlayerType', 'cactus_compost_varbit_basevar'));
  assert.equal(stage(treated, s), 3, 'treatment preserves crop selector');
  const restored = player(treated.save());
  assert.equal(restored.getVar(id('VarPlayerType', 'cactus_compost_varbit_basevar')), word, 'specialty soil persists');
  const grown = fixture(s, s.name === 'cactus' ? 18 : s.mature);
  for (let n = 0; n < 28; n++) add(grown, 'bronze_dagger');
  const before = xp(grown); act(grown, () => click(grown, s.loc));
  assert.equal(xp(grown), before); assert.equal(count(grown, s.produce), 0);
  const cleared = fixture(s, s.first); add(cleared, 'spade');
  proc(cleared, 'farming_soil_set_treatment', s.soil, 2);
  act(cleared, () => use(cleared, 'spade', s.loc));
  assert.equal(stage(cleared, s), 3); assert.equal(proc(cleared, 'farming_soil_treatment', s.soil).popInt(), 0);
  console.log('PASS ' + s.name + ' gates/treatment/save/space/clear');
}

const soilWord = id('VarPlayerType', 'farming_state_temp_3');
const soilPlayer = player();
soilPlayer.setVar(soilWord, 0x6a5a005a);
for (let index = 20; index < 24; index++) {
  proc(soilPlayer, 'farming_soil_set_treatment', index, 2);
  assert.equal(proc(soilPlayer, 'farming_soil_treatment', index).popInt(), 2);
}
assert.equal(soilPlayer.getVar(soilWord), 0x6a5aaa5a, 'bush soil preserves the original low-byte varbit and uncovered high bits');
const savedSoil = player(soilPlayer.save());
assert.equal(savedSoil.getVar(soilWord), 0x6a5aaa5a, 'all four bush treatments persist');
proc(savedSoil, 'farming_soil_clear', 21);
assert.equal(savedSoil.getVar(soilWord), 0x6a5aa25a, 'clearing one bush preserves all neighbouring state');

const oldDate = Runner.HANDLERS[ScriptOpcode.DATE_MINUTES];
try {
  Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(640);
  for (const s of specs) {
    const p = fixture(s, s.first);
    p.setVar(id('VarPlayerType', 'farming_growth_minute'), 639);
    proc(p, 'farming_reconcile', 0);
    assert.equal(stage(p, s), s.first + 1, s.name + ' shared timer keeps DB cursor');
  }
} finally { Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = oldDate; }

// Independent all-family modules exercise the same compiled runtime and real packets.
const pots = await import('./pots_cases.mjs');
const bushes = await import('./bush_cases.mjs');
console.log(`PASS ${pots.runPotsCases(findPatch)} native plant-pot cases`);
await bushes.testBushes();
console.log('PASS farming specialty and pot lifecycle');
process.exit(0);
