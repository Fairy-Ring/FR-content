import assert from 'node:assert/strict';
import { World, types, id, inv, actionDelay, native, player, execute, restore, runProc, JavaRandom, PlayerStat, ScriptState, param } from './runtime.mjs';

// Independent expectations from the retained cache and checked source tables.
// Requirements/XP/low-high/respawn are CANDIDATE except the period granite level;
// these sweeps verify the built older rule, not authentic May 2006 probabilities.
const stones = [
  { rock: 'rocks_10946', row: 'quarry_sandstone_rock', name: 'sandstone', level: 35, empty: 'rocks_10944', blocks: [
    ['enakh_sandstone_large', 600, 4, 50], ['enakh_sandstone_medium', 500, 8, 75],
    ['enakh_sandstone_small', 400, 16, 100], ['enakh_sandstone_tiny', 300, 25, 200]
  ] },
  { rock: 'rocks_10947', row: 'quarry_granite_rock', name: 'granite', level: 45, empty: 'rocks_10945', blocks: [
    ['enakh_granite_medium', 750, 6, 64], ['enakh_granite_small', 600, 8, 75], ['enakh_granite_tiny', 500, 16, 100]
  ] }
];
const miningId = id('DbTableType', 'mining_table');
const mining = types.DbTableType.get(miningId);
const miningRows = types.DbRowType.getInTable(miningId);
const blockTableId = id('DbTableType', 'quarry_blocks');
const blockTable = types.DbTableType.get(blockTableId);
const blockRows = types.DbRowType.getInTable(blockTableId);
assert.equal(blockRows.length, stones.length, 'only the two sourced stone product lists');
const field = (row, table, column, index = 0) => row.getValue(table.columnNames.indexOf(column), index);
const products = stones.flatMap(stone => stone.blocks.map(([name]) => id('ObjType', name)));
const gems = ['uncut_opal', 'uncut_jade', 'uncut_red_topaz', 'uncut_sapphire', 'uncut_emerald', 'uncut_ruby', 'uncut_diamond'].map(name => id('ObjType', name));
function random(values, action) {
  const original = JavaRandom.nextDouble;
  let draws = 0;
  JavaRandom.nextDouble = () => {
    assert(draws < values.length, `unexpected RNG draw ${draws + 1}`);
    return values[draws++];
  };
  try { const result = action(); assert.equal(draws, values.length, 'exact conditional RNG consumption; no gem roll'); return result; }
  finally { JavaRandom.nextDouble = original; }
}
function noReward(p, before, loc, original) {
  assert.equal(p.stats[PlayerStat.MINING], before, 'refusal/failure awards no XP');
  assert.equal(products.reduce((sum, item) => sum + p.invTotal(inv, item), 0), 0, 'refusal/failure awards no block');
  assert.equal(loc.type, original, 'refusal/failure leaves the original rock');
}
// Independently encode the published pre-2023 separate-floor formula.
const successes = (level, low, high) => Math.floor(low * (99 - level) / 98) + Math.floor(high * (level - 1) / 98) + 1;
for (const stone of stones) {
  const full = id('LocType', stone.rock);
  const empty = id('LocType', stone.empty);
  const row = types.DbRowType.getByName(stone.row);
  assert(row, `${stone.row}: new compiled mining row`);
  const matches = miningRows.filter(candidate => candidate.columnValues[mining.columnNames.indexOf('rock')].includes(full));
  assert.deepEqual(matches.map(candidate => candidate.debugname), [stone.row], 'exactly one stone row per rock');
  assert.deepEqual(field(row, mining, 'ore_name'), [stone.name]);
  assert.deepEqual(field(row, mining, 'rock_level'), [stone.level]);
  assert.deepEqual(field(row, mining, 'rock_respawnrate'), [9]);
  const lists = blockRows.filter(candidate => field(candidate, blockTable, 'stone')[0] === row.id);
  assert.equal(lists.length, 1);
  const blockColumn = blockTable.columnNames.indexOf('block');
  assert.equal(lists[0].columnValues[blockColumn].length, stone.blocks.length * 4, 'no unsourced size');
  stone.blocks.forEach(([name, ...values], index) => assert.deepEqual(field(lists[0], blockTable, 'block', index), [id('ObjType', name), ...values]));
  assert.equal(param(types.LocType.get(full), 'next_loc_stage_mining'), empty);
  const loc = native(stone.rock);
  const original = [loc.type, loc.shape, loc.angle];
  const prospector = player(loc);
  assert.equal(execute(prospector, loc, 2).execution, ScriptState.FINISHED);
  assert.deepEqual(prospector.messages, ['You examine the rock for ores...', `This rock contains ${stone.name}.`]);
  for (const gate of ['below-level', 'no-pickaxe', 'full-inventory']) {
    const p = player(loc, gate === 'below-level' ? stone.level - 1 : stone.level, gate === 'no-pickaxe' ? null : 'bronze_pickaxe');
    if (gate === 'full-inventory') p.invAdd(inv, id('ObjType', 'bronze_pickaxe'), 27);
    p.setVar(actionDelay, World.currentTick);
    const xp = p.stats[PlayerStat.MINING];
    assert.equal(random([], () => execute(p, loc, 1)).execution, ScriptState.PAUSEBUTTON, `${gate}: native refusal dialogue`);
    noReward(p, xp, loc, full);
  }
  for (let index = 0; index < stone.blocks.length; index++) {
    const [name, xp] = stone.blocks[index];
    const p = player(loc, stone.level);
    const before = p.stats[PlayerStat.MINING];
    p.setVar(actionDelay, World.currentTick);
    const rolls = [...Array(index).fill(0.999999), 0];
    const result = random(rolls, () => execute(p, loc, index === 0 ? 3 : 1));
    assert.equal(result.execution, ScriptState.FINISHED);
    assert.equal(result.script.name, `[oploc${index === 0 ? 3 : 1},${stone.rock}]`);
    for (const product of products) assert.equal(p.invTotal(inv, product), product === id('ObjType', name) ? 1 : 0, `${name}: exactly the selected sourced size`);
    for (const gem of gems) assert.equal(p.invTotal(inv, gem), 0, 'quarry does not roll gems');
    assert.equal(p.stats[PlayerStat.MINING] - before, xp, `${name}: size-specific XP in tenths`);
    assert.equal(loc.type, empty);
    assert.equal(loc.lifecycleTick, 9, 'candidate base respawn at zero world players');
    for (let tick = 1; tick < 9; tick++) { World.currentTick++; loc.turn(); assert.equal(loc.type, empty); }
    World.currentTick++; loc.turn();
    assert.deepEqual([loc.type, loc.shape, loc.angle], original, 'native lifecycle restores this placement');
    assert.equal(loc.lifecycleTick, -1);
  }
  {
    const p = player(loc, stone.level);
    const xp = p.stats[PlayerStat.MINING];
    p.setVar(actionDelay, World.currentTick);
    random(Array(stone.blocks.length).fill(0.999999), () => execute(p, loc, 1));
    noReward(p, xp, loc, full);
  }
  {
    const p = player(loc, stone.level);
    const xp = p.stats[PlayerStat.MINING];
    p.setVar(actionDelay, 0);
    random([], () => execute(p, loc, 1));
    const due = World.currentTick + param(types.ObjType.get(id('ObjType', 'bronze_pickaxe')), 'mining_rate');
    assert.equal(p.getVar(actionDelay), due, 'published pickaxe cadence arms the first swing');
    noReward(p, xp, loc, full);
    World.currentTick = due;
    random([0], () => execute(p, loc, 1));
    assert.equal(p.invTotal(inv, id('ObjType', stone.blocks[0][0])), 1, 'first reward is due at the published swing clock');
    restore(loc);
  }
  for (const level of [stone.level, 65, 99]) {
    const p = player(loc, level);
    const actual = [];
    for (let stage = 0; stage < stone.blocks.length; stage++) {
      let hits = 0;
      for (let roll = 0; roll < 256; roll++) {
        const threshold = successes(level, stone.blocks[stage][2], stone.blocks[stage][3]);
        const wins = roll < threshold;
        const values = [...Array(stage).fill(0.999999), (roll + 0.5) / 256];
        if (!wins) values.push(...Array(stone.blocks.length - stage - 1).fill(0.999999));
        const state = random(values, () => runProc('quarry_roll_block', p, loc, [row.id]));
        const returned = state.intStack.slice(0, state.isp);
        assert.deepEqual(returned, wins ? [id('ObjType', stone.blocks[stage][0]), stone.blocks[stage][1]] : [-1, 0], `${stone.name} level ${level}, stage ${stage}, exhaustive roll ${roll}`);
        if (wins) hits++;
      }
      assert.equal(hits, successes(level, stone.blocks[stage][2], stone.blocks[stage][3]));
      actual.push(hits);
    }
    let remaining = 1;
    const probabilities = actual.map(hits => { const probability = remaining * hits / 256; remaining *= 1 - hits / 256; return probability; });
    assert.equal(probabilities.reduce((sum, probability) => sum + probability, remaining), 1);
    console.log(`PASS ${stone.name} level ${level}: exhaustive 256-roll conditional sweeps; thresholds=${actual.join('/')}; built size probabilities=${probabilities.join('/')}; failure=${remaining}`);
  }
  console.log(`PASS ${stone.name}: Prospect; level, pickaxe and inventory gates; every size/XP; first-swing clock; no gems; depletion and return`);
}
// All four original quarry types coexist while sharing two empty definitions.
// No loc is spawned, replaced or reassigned by the fixture.
const neighbours = [
  ...stones.map(stone => ({ name: stone.rock, empty: stone.empty, row: stone.row, quarry: true })),
  { name: 'rocks_10948', empty: 'rocks_10944', row: 'coal_rock_table' },
  { name: 'rocks_10949', empty: 'rocks_10945', row: 'clay_rock_table' }
].map(spec => ({ ...spec, loc: native(spec.name) }));
const bases = neighbours.map(({ loc }) => [loc.type, loc.shape, loc.angle]);
for (const spec of neighbours) {
  const config = types.LocType.get(id('LocType', spec.name));
  assert.deepEqual(config.models, types.LocType.get(id('LocType', spec.empty)).models, `${spec.name}: exact same-model empty`);
  assert.equal(Math.floor(spec.loc.x / 64), 49);
  assert.equal(Math.floor(spec.loc.z / 64), 45);
  const p = player(spec.loc);
  p.setVar(actionDelay, World.currentTick);
  random(spec.quarry ? [0] : [0.9, 0], () => execute(p, spec.loc, 1));
  assert.equal(spec.loc.type, id('LocType', spec.empty));
  spec.duration = spec.loc.lifecycleTick;
}
assert.equal(neighbours.filter(spec => spec.loc.isChanged()).length, 4, 'all four original nearby placements are depleted together');
for (let tick = 1; tick <= Math.max(...neighbours.map(spec => spec.duration)); tick++) {
  World.currentTick++;
  neighbours.forEach((spec, index) => {
    if (spec.loc.isChanged()) spec.loc.turn();
    if (tick < spec.duration) assert.equal(spec.loc.type, id('LocType', spec.empty));
    else assert.deepEqual([spec.loc.type, spec.loc.shape, spec.loc.angle], bases[index], `${spec.name}: sharing an empty form does not confuse its own return`);
  });
}
console.log('PASS quarry neighbours: sandstone/coal share 10944 and granite/clay share 10945; four independent native returns');
console.log('RESULT PASS desert quarry: two rocks, seven sourced sizes, three-level exhaustive distribution, gates, shared cadence and four-placement lifecycle');
process.exit(0);
