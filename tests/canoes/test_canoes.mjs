// Runs real compiled station and button handlers; starts no world server.
// From the sibling engine: node --import tsx ../content/tests/canoes/test_canoes.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = async rel => (await import(pathToFileURL(path.join(engine, 'src', rel)).href)).default;
const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const map = await import(pathToFileURL(path.join(engine, 'src/engine/GameMap.ts')).href);
const ServerTriggerType = await load('engine/script/ServerTriggerType.ts');
const Environment = await load('util/Environment.ts');
Environment.NODE_MEMBERS = true;
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType', 'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType']) {
  types[name] = await load(`cache/config/${name}.ts`);
  types[name].load(pack);
}
(await load('cache/config/DbTableIndex.ts')).init();
assert.ok(ScriptProvider.load(pack) > 0, 'build the full content pack first');
World.currentTick = 100;
World.gameMap.init();
const inv = types.InvType.getId('inv');
const worn = types.InvType.getId('worn');
const wc = 8;
const stationNames = ['lumbridge', 'championsguild', 'barbarianvillage', 'edgeville'];
const origins = [[3241, 3235], [3200, 3341], [3110, 3409], [3130, 3508]];
const landings = [[3243, 3235], [3202, 3344], [3112, 3409], [3132, 3507], [3148, 3794]];
const hullButtons = [25, 26, 27, 28];
const destinationButtons = [34, 35, 36, 41, 37];
const levels = [12, 27, 42, 57];
const xp = [0, 300, 600, 1200];
const bits = stationNames.map(name => types.VarBitType.getId(`canoestation_state_${name}`));
const startBit = types.VarBitType.getId('canoe_startfrom');
assert.ok(bits.every(id => id >= 0) && startBit >= 0, 'native 377 canoe state must exist');
const locs = origins.map(([x, z], i) => World.getLoc(x, z, 0, types.LocType.getId(`canoeing_canoestation_${stationNames[i]}`)));
assert.ok(locs.every(Boolean), 'all four original cache placements exist');
for (const [x, z] of landings) {
  const source = readFileSync(path.join(content, `maps/m${x >> 6}_${z >> 6}.jm2`), 'utf8');
  assert.ok(source.split('\n').some(line => line.startsWith(`0 ${x & 63} ${z & 63}:`)), `landing ${x},${z} has a native map floor`);
  assert.equal(map.isMapBlocked(x, z, 0), false, `landing ${x},${z} is not collision-blocked`);
}
let serial = 0;
function fixture(level = 99, axe = 'bronze_axe', equipped = false) {
  const n = ++serial;
  const p = new Player(`canoe_${n}`, BigInt(n), BigInt(n));
  p.slot = n; p.pid = n; p.uid = n;
  p.baseLevels.fill(1); p.levels.fill(1); p.vars.fill(0);
  p.baseLevels[wc] = level; p.levels[wc] = level;
  p.x = 3243; p.z = 3235; p.level = 0;
  p.write = () => {};
  if (axe) p.invSet(equipped ? worn : inv, types.ObjType.getId(axe), 1, equipped ? 3 : 0);
  return p;
}
function run(p, name, target = null, args = []) {
  const script = ScriptProvider.getByName(name);
  assert.ok(script, `missing packed handler ${name}; old code must fail here`);
  const state = ScriptRunner.init(script, p, target, args);
  let result = p.runScript(state, true, true);
  let suspensions = 0;
  while (result === ScriptState.SUSPENDED && suspensions++ < 8) {
    World.currentTick = p.delayedUntil;
    p.delayed = false;
    result = p.runScript(state, true, true);
  }
  assert.equal(result, ScriptState.FINISHED, `${name} finishes without abort or unbounded delay`);
  return state;
}
function station(p, index) {
  [p.x, p.z] = landings[index];
  p.target = locs[index];
  p.targetOp = ServerTriggerType.APLOC1;
  const expected = `[oploc1,canoeing_canoestation_${stationNames[index]}]`;
  assert.equal(p.getOpTrigger()?.name, expected, 'native multiloc dispatch reaches the station handler');
  return run(p, expected, locs[index]);
}
function shape(p, hull) { run(p, `[if_button,canoeing:com_${hullButtons[hull - 1]}]`); }
function trip(p, destination) { run(p, `[if_button,canoe_map:com_${destinationButtons[destination - 1]}]`); }
let cases = 0;
function check(name, fn) { fn(); cases++; console.log(`PASS ${name}`); }

check('free worlds cannot start canoe construction', () => {
  Environment.NODE_MEMBERS = false;
  try {
    const p = fixture();
    station(p, 0);
    assert.equal(p.getVarBit(bits[0]), 0);
    assert.equal(p.getVarBit(startBit), 0);
  } finally { Environment.NODE_MEMBERS = true; }
});
check('chop level and axe gates leave the tree and XP unchanged', () => {
  for (const [level, axe] of [[11, 'bronze_axe'], [12, null], [12, 'rune_axe']]) {
    const p = fixture(level, axe);
    const before = p.stats[wc];
    station(p, 0);
    assert.equal(p.getVarBit(bits[0]), 0);
    assert.equal(p.stats[wc], before);
  }
});
check('a wielded axe can chop and shape without an inventory axe', () => {
  const p = fixture(12, 'bronze_axe', true);
  station(p, 0); station(p, 0); shape(p, 1);
  assert.equal(p.getVarBit(bits[0]), 1);
});
for (let s = 0; s < 4; s++) {
  for (let h = 1; h <= 4; h++) {
    check(`${stationNames[s]} hull ${h}: chop, level gate, shape XP, float, map`, () => {
      const p = fixture(levels[h - 1] - 1);
      // For the log, chopping itself needs 12; lower the stat only after chopping.
      p.levels[wc] = Math.max(12, p.levels[wc]);
      station(p, s);
      assert.equal(p.getVarBit(bits[s]), 10, 'tree becomes fallen only through its handler');
      assert.equal(p.getVarBit(startBit), s + 1);
      station(p, s);
      p.levels[wc] = levels[h - 1] - 1;
      const before = p.stats[wc];
      shape(p, h);
      assert.equal(p.getVarBit(bits[s]), 10, 'one below hull requirement refuses');
      assert.equal(p.stats[wc], before, 'refusal gives no XP');
      p.levels[wc] = levels[h - 1];
      shape(p, h);
      assert.equal(p.getVarBit(bits[s]), h);
      assert.equal(p.stats[wc] - before, xp[h - 1], 'shaping gives exact tenths of XP');
      shape(p, h);
      assert.equal(p.stats[wc] - before, xp[h - 1], 'replayed shape gives no duplicate XP');
      station(p, s);
      assert.equal(p.getVarBit(bits[s]), h + 4, 'float transforms only this station');
      for (let other = 0; other < 4; other++) if (other !== s) assert.equal(p.getVarBit(bits[other]), 0);
      station(p, s);
      assert.equal(p.getVarBit(types.VarBitType.getId('canoe_type')), h, 'map hull comes from actual station');
      for (let d = 1; d <= 5; d++) {
        const expected = d !== s + 1 && (d === 5 ? h === 4 : Math.abs(d - (s + 1)) <= h);
        const state = run(p, '[proc,canoe_can_travel]', null, [h, s + 1, d]);
        assert.equal(state.intStack[0], Number(expected), `reachable hull ${h}, station ${s + 1} to ${d}`);
      }
    });
  }
}
for (let s = 0; s < 4; s++) for (let h = 1; h <= 4; h++) for (let d = 1; d <= 5; d++) {
  check(`actual destination button hull ${h}: ${s + 1} -> ${d}`, () => {
    const p = fixture();
    station(p, s); station(p, s); shape(p, h); station(p, s); station(p, s);
    const before = [p.x, p.z, p.level];
    const allowed = d !== s + 1 && (d === 5 ? h === 4 : Math.abs(d - (s + 1)) <= h);
    trip(p, d);
    assert.deepEqual([p.x, p.z, p.level], allowed ? [...landings[d - 1], 0] : before);
    assert.equal(p.getVarBit(bits[s]), allowed ? 0 : h + 4, 'only a valid trip consumes canoe');
    if (allowed) {
      const arrived = [p.x, p.z, p.level];
      trip(p, d);
      assert.deepEqual([p.x, p.z, p.level], arrived, 'consumed canoe cannot be replayed');
    }
  });
}
check('Wilderness has no origin or return route', () => {
  const p = fixture();
  for (let d = 1; d <= 5; d++) assert.equal(run(p, '[proc,canoe_can_travel]', null, [4, 5, d]).intStack[0], 0);
});
check('axe removed before shaping refuses without XP', () => {
  const p = fixture(); station(p, 0); station(p, 0);
  p.getInventory(inv).remove(types.ObjType.getId('bronze_axe'), 1);
  const before = p.stats[wc]; shape(p, 1);
  assert.equal(p.getVarBit(bits[0]), 10); assert.equal(p.stats[wc], before);
});
console.log(`RESULT PASS canoes: ${cases} compiled cases`);
process.exit(0);
