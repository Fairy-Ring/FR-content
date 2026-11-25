/** Native compiled contracts for the 377 tree, fruit-tree, calquat and spirit-tree families. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, Runner, Scripts, State, ScriptOpcode, PlayerStat,
  types, id, inv, player, proc, add, count, use, click, load } from './runtime.mjs';
import { runPotsCases } from './pots_cases.mjs';
import { runNativeNetworkCompatibility } from './trees_native_network.mjs';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const map = await load('engine/GameMap.ts');
const Trigger = (await load('engine/script/ServerTriggerType.ts')).default;
const OpLoc = (await load('network/game/client/model/OpLoc.ts')).default;
const OpLocHandler = (await load('network/game/client/handler/OpLocHandler.ts')).default;
const opLocHandler = new OpLocHandler();
const soilVar = id('VarPlayerType', 'farming_tree_soil');
const careVar = id('VarPlayerType', 'farming_protection');
const growthClock = id('VarPlayerType', 'farming_growth_minute');
const actionDelay = id('VarPlayerType', 'action_delay');
const columnNames = ['first', 'mature', 'last', 'claim', 'level', 'plant_xp', 'check_xp', 'payment', 'quantity'];

const trees = [
  { name: 'oak', row: 'farming_tree_oak', seedling: 'plantpot_oak_sapling', first: 8, mature: 12, last: 13, claim: 13, level: 15, plantXp: 180, checkXp: 4675, payment: 'basket_tomato_5', quantity: 1, roots: 'oak_roots', rootsQuantity: 1 },
  { name: 'willow', row: 'farming_tree_willow', seedling: 'plantpot_willow_sapling', first: 15, mature: 21, last: 22, claim: 22, level: 30, plantXp: 250, checkXp: 14565, payment: 'basket_apple_5', quantity: 1, roots: 'willow_roots', rootsQuantity: 1 },
  { name: 'maple', row: 'farming_tree_maple', seedling: 'plantpot_maple_sapling', first: 24, mature: 32, last: 33, claim: 33, level: 45, plantXp: 450, checkXp: 34030, payment: 'basket_orange_5', quantity: 1, roots: 'maple_roots', rootsQuantity: 1 },
  { name: 'yew', row: 'farming_tree_yew', seedling: 'plantpot_yew_sapling', first: 35, mature: 45, last: 46, claim: 46, level: 60, plantXp: 810, checkXp: 70695, payment: 'cactus_spine', quantity: 10, roots: 'yew_roots', rootsQuantity: 1 },
  { name: 'magic', row: 'farming_tree_magic', seedling: 'plantpot_magic_tree_sapling', first: 48, mature: 60, last: 61, claim: 61, level: 75, plantXp: 1450, checkXp: 137685, payment: 'coconut', quantity: 25, roots: 'magic_roots', rootsQuantity: 1 }
].map(spec => ({ ...spec, family: 'wood', prefix: 'farming_tree', table: 'farming_tree', local: 0, global: 16, patch: 'farming_tree_patch_1', form: `${spec.name}_tree`, soil: 27, growthRow: 'farming_growth_tree', period: 40 }));

const fruitTrees = [
  { name: 'apple', row: 'farming_fruit_tree_apple', seedling: 'plantpot_apple_sapling', first: 8, mature: 14, last: 20, claim: 34, level: 27, plantXp: 220, checkXp: 11990, payment: 'sweetcorn', quantity: 9, produce: 'cooking_apple', harvestXp: 85 },
  { name: 'banana', row: 'farming_fruit_tree_banana', seedling: 'plantpot_banana_sapling', first: 35, mature: 41, last: 47, claim: 61, level: 33, plantXp: 280, checkXp: 17505, payment: 'basket_apple_5', quantity: 4, produce: 'banana', harvestXp: 105 },
  { name: 'orange', row: 'farming_fruit_tree_orange', seedling: 'plantpot_orange_sapling', first: 72, mature: 78, last: 84, claim: 98, level: 39, plantXp: 350, checkXp: 24700, payment: 'basket_strawberry_5', quantity: 3, produce: 'orange', harvestXp: 135 },
  { name: 'curry', row: 'farming_fruit_tree_curry', seedling: 'plantpot_curry_sapling', first: 99, mature: 105, last: 111, claim: 125, level: 42, plantXp: 400, checkXp: 29070, payment: 'basket_banana_5', quantity: 5, produce: 'curry_leaf', harvestXp: 150 },
  { name: 'pineapple', row: 'farming_fruit_tree_pineapple', seedling: 'plantpot_pineapple_sapling', first: 136, mature: 142, last: 148, claim: 162, level: 51, plantXp: 570, checkXp: 46055, payment: 'watermelon', quantity: 10, produce: 'pineapple', harvestXp: 225 },
  { name: 'papaya', row: 'farming_fruit_tree_papaya', seedling: 'plantpot_papaya_sapling', first: 163, mature: 169, last: 175, claim: 189, level: 57, plantXp: 720, checkXp: 61470, payment: 'pineapple', quantity: 10, produce: 'papaya', harvestXp: 270 },
  { name: 'palm', row: 'farming_fruit_tree_palm', seedling: 'plantpot_palm_sapling', first: 200, mature: 206, last: 212, claim: 226, level: 68, plantXp: 1110, checkXp: 101000, payment: 'papaya', quantity: 15, produce: 'coconut', harvestXp: 420 }
].map(spec => ({ ...spec, family: 'fruit', prefix: 'farming_fruit_tree', table: 'farming_fruit_tree', local: 0, global: 20, patch: 'farming_fruit_tree_patch_1', form: `${spec.name}_tree`, soil: 31, growthRow: 'farming_growth_fruit_tree', period: 160 }));

const specialTrees = [
  { name: 'spirit', row: 'farming_special_tree_spirit', seedling: 'plantpot_spirit_tree_sapling', first: 8, mature: 20, last: 20, claim: 44, level: 83, plantXp: 0, checkXp: 193020, local: 0, familyCode: 0, patch: 'farming_spirit_tree_patch_1', soil: 35, form: 'spirit_tree', growthRow: 'farming_growth_spirit_tree', period: 320 },
  { name: 'calquat', row: 'farming_special_tree_calquat', seedling: 'plantpot_calquat_sapling', first: 4, mature: 12, last: 18, claim: 34, level: 72, plantXp: 1300, checkXp: 120960, local: 3, familyCode: 1, patch: 'farming_calquat_tree_patch', soil: 38, form: 'calquat_tree', growthRow: 'farming_growth_calquat', period: 160, produce: 'calquat_fruit', harvestXp: 485 }
].map(spec => ({ ...spec, family: 'special', prefix: 'farming_special_tree', table: 'farming_special_tree', global: null }));

const allSpecs = [...trees, ...fruitTrees, ...specialTrees];
const careSpecs = [...trees, ...fruitTrees];
const growthSpecs = [trees[0], fruitTrees[0], specialTrees[0], specialTrees[1]];
const result = (p, name, ...args) => proc(p, name, ...args).intStack[0];
const api = spec => spec.prefix;
const patchName = spec => spec.patch;
function patchStage(p, spec) { return result(p, `${api(spec)}_patch_stage`, spec.local); }
function patchSet(p, spec, stage) { proc(p, `${api(spec)}_patch_set`, spec.local, stage); }
function advance(p, spec, steps, window = 0) {
  if (spec.family === 'special') proc(p, `${api(spec)}_advance_all`, spec.familyCode, steps, window);
  else proc(p, `${api(spec)}_advance_all`, steps, window);
}
function advanceHealthy(p, spec, steps) {
  const original = Runner.HANDLERS[ScriptOpcode.RANDOM];
  Runner.HANDLERS[ScriptOpcode.RANDOM] = state => {
    const bound = state.popInt();
    state.pushInt(bound - 1);
  };
  try { advance(p, spec, steps); }
  finally { Runner.HANDLERS[ScriptOpcode.RANDOM] = original; }
}
function procAt(p, name, loc, ...args) {
  const script = Scripts.getByName(`[proc,${name}]`);
  assert(script, `compiled proc ${name}`);
  const state = Runner.init(script, p, loc, args);
  assert.equal(p.runScript(state, true, true), State.FINISHED, name);
  return state;
}
function field(row, table, name) {
  const index = table.columnNames.indexOf(name);
  assert(index >= 0, `missing ${table.debugname} field ${name}`);
  return row.getValue(index, 0)[0];
}
const tables = new Map();
const rows = new Map();
for (const spec of allSpecs) {
  if (!tables.has(spec.table)) {
    const table = types.DbTableType.getByName(spec.table);
    assert(table, `compiled ${spec.table} table`);
    for (const name of columnNames) assert(table.columnNames.includes(name), `${spec.table} column ${name}`);
    tables.set(spec.table, table);
  }
  const table = tables.get(spec.table);
  const row = types.DbRowType.get(id('DbRowType', spec.row));
  assert.equal(row.tableId, table.id, `${spec.row} belongs to its family table`);
  rows.set(spec.row, row);
}

const placements = { loc: new Map(), npc: new Map() };
for (const file of fs.readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name))) {
  const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(file).map(Number);
  let section;
  for (const line of fs.readFileSync(path.join(content, 'maps', file), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    if (section !== 'LOC' && section !== 'NPC') continue;
    const match = /^([0-3]) (\d+) (\d+): (\d+)(?: |$)/.exec(line);
    if (!match) continue;
    const [, level, x, z, type] = match.map(Number);
    const kind = section === 'LOC' ? 'LocType' : 'NpcType';
    const name = types[kind].get(type).debugname;
    const wanted = section === 'LOC'
      ? name === 'tree' || /^farming_.*_patch(?:_\d+)?$/.test(name)
      : /^farming_gardener_(tree|fruit)_\d+$/.test(name);
    if (!wanted) continue;
    const target = placements[section === 'LOC' ? 'loc' : 'npc'];
    if (!target.has(name)) target.set(name, []);
    target.get(name).push({ type, level, x: mx * 64 + x, z: mz * 64 + z, file });
  }
}
function standFor(loc, required = true) {
  const config = types.LocType.get(loc.type);
  for (let x = loc.x - 1; x <= loc.x + config.width; x++) for (let z = loc.z - 1; z <= loc.z + config.length; z++) {
    if (!map.isMapBlocked(x, z, loc.level) && map.reachedLoc(loc.level, x, z, loc.x, loc.z,
      config.width, config.length, 1, loc.angle, loc.shape, config.forceapproach)) return { x, z };
  }
  if (required) assert.fail(`no collision-reachable tile for ${config.debugname}`);
  return null;
}
const patchCache = new Map();
function findPatch(name, unique = true) {
  if (patchCache.has(name)) return patchCache.get(name);
  const entries = placements.loc.get(name) ?? [];
  if (unique) assert.equal(entries.length, 1, `one original map placement for ${name}`);
  else assert(entries.length, `original map places ${name}`);
  const at = entries[0], loc = World.getLoc(at.x, at.z, at.level, at.type);
  assert(loc, `loaded original map placement for ${name}`);
  const value = { loc, ...standFor(loc) };
  patchCache.set(name, value);
  return value;
}
function target(spec) { return findPatch(patchName(spec)); }
function fixture(spec, stage = 3, level = 99) {
  const at = target(spec), p = player();
  Object.assign(p, { x: at.x, z: at.z, level: at.loc.level, originX: at.x, originZ: at.z });
  p.setLevel(PlayerStat.FARMING, level);
  p.startFarmXp = p.stats[PlayerStat.FARMING];
  patchSet(p, spec, stage);
  return { p, loc: at.loc };
}
function saveAndLoad(p) {
  const restored = player(p.save());
  // The shared runtime resets position and assigns a zero-hash UID even to a loaded named actor.
  restored.uid = ((Number(restored.username37 & 0x1fffffn) << 11) | restored.pid) >>> 0;
  const inventory = id('Component', 'inventory:inv');
  restored.invStopListenOnCom(inventory);
  restored.invListenOnCom(inv, inventory, restored.uid);
  assert.equal(World.getPlayerByUid(restored.uid), restored, 'saved actor has its authentic engine UID');
  assert.equal(restored.getInventoryFromListener(restored.invListeners.find(listener => listener.com === inventory)),
    restored.getInventory(inv), 'native item-use resolves the restored inventory owner');
  // Retain this case's collision-clear approach and XP baseline.
  Object.assign(restored, { x: p.x, z: p.z, level: p.level, originX: p.x, originZ: p.z, startFarmXp: p.startFarmXp });
  return restored;
}
const xp = p => p.stats[PlayerStat.FARMING] - p.startFarmXp;
function act(p, action) {
  World.currentTick += 3;
  p.setVar(actionDelay, 0);
  assert(action(), 'native location packet accepted');
}
function totalInventory(p) {
  let total = 0;
  for (let slot = 0; slot < types.InvType.get(inv).size; slot++) total += p.invGetSlot(inv, slot)?.count ?? 0;
  return total;
}
function fillInventory(p) {
  for (let slot = 0; slot < types.InvType.get(inv).size; slot++) {
    if (!p.invGetSlot(inv, slot)) p.invSet(inv, id('ObjType', 'bronze_axe'), 1, slot);
  }
}

// The original item cache is the oracle for the 14 soil-filled-pot families.
const potCases = runPotsCases(name => findPatch(name, false));
console.log(`PASS ${potCases} original pot and sapling compiled cases`);

const tableSpecs = [
  ['farming_tree', trees], ['farming_fruit_tree', fruitTrees], ['farming_special_tree', specialTrees]
];
for (const [tableName, specs] of tableSpecs) {
  const table = tables.get(tableName);
  const tableRows = types.DbRowType.getInTable(table.id);
  assert.equal(tableRows.length, specs.length, `${tableName} has only its supported crop rows`);
  for (const spec of specs) {
    const row = rows.get(spec.row);
    assert.equal(field(row, table, 'first'), spec.first, `${spec.name} cache first stage`);
    assert.equal(field(row, table, 'mature'), spec.mature, `${spec.name} cache mature stage`);
    assert.equal(field(row, table, 'last'), spec.last, `${spec.name} last fruit or living-tree stage`);
    assert.equal(field(row, table, 'claim'), spec.claim, `${spec.name} health-check stage`);
    assert.equal(field(row, table, 'level'), spec.level, `${spec.name} Farming level`);
    assert.equal(field(row, table, 'plant_xp'), spec.plantXp, `${spec.name} planting XP in tenths`);
    assert.equal(field(row, table, 'check_xp'), spec.checkXp, `${spec.name} check-health XP in tenths`);
    if (spec.produce) assert.equal(field(row, table, 'produce'), id('ObjType', spec.produce), `${spec.name} harvest produce`);
    if (spec.harvestXp) assert.equal(field(row, table, 'harvest_xp'), spec.harvestXp, `${spec.name} harvest XP`);
    if (spec.roots) {
      assert.equal(field(row, table, 'roots'), id('ObjType', spec.roots), `${spec.name} stump roots`);
      assert.equal(field(row, table, 'roots_quantity'), spec.rootsQuantity, `${spec.name} UNKNOWN one-root default`);
    }
    if (spec.payment) {
      assert.equal(field(row, table, 'payment'), id('ObjType', spec.payment), `${spec.name} period protection item`);
      assert.equal(field(row, table, 'quantity'), spec.quantity, `${spec.name} period protection quantity`);
    }
    const at = target(spec), p = player();
    try {
      for (const stage of new Set([spec.first, spec.mature, field(row, table, 'last'), field(row, table, 'claim')])) {
        const found = procAt(p, `${api(spec)}_crop`, at.loc, stage).intStack[0];
        assert.equal(found, row.id, `${spec.name} crop lookup at stage ${stage}`);
      }
      const patch = types.LocType.get(id('LocType', spec.patch));
      const morphs = patch.multiloc.map((typeId, stage) => ({
        stage,
        name: typeId < 0 ? '' : types.LocType.get(typeId)?.debugname?.toLowerCase() ?? ''
      }));
      const diseased = morphs.filter(form => form.name.startsWith(`${spec.form}_`) && form.name.includes('diseas'));
      const dead = morphs.filter(form => form.name.startsWith(`${spec.form}_`) && form.name.includes('dead'));
      assert(diseased.length, `${spec.name} original diseased cache forms`);
      assert(dead.length, `${spec.name} original dead cache forms`);
      for (const form of [...diseased, ...dead]) {
        const isDisease = diseased.includes(form);
        const livingStage = form.stage - (isDisease ? 64 : 128);
        // Intermediate and full-grown cache failure forms exclude unused base-byte aliases.
        const supported = spec.family !== 'wood' || ((livingStage > spec.first && livingStage < spec.mature) || livingStage === spec.claim);
        assert.equal(procAt(p, `${api(spec)}_crop`, at.loc, form.stage).intStack[0], supported ? row.id : -1,
          `${spec.name} cache failure selector ${form.stage} has its supported growing-row lookup`);
        assert.equal(procAt(p, `${api(spec)}_is_diseased`, at.loc, form.stage).intStack[0], supported && isDisease ? 1 : 0);
        assert.equal(procAt(p, `${api(spec)}_is_dead`, at.loc, form.stage).intStack[0], supported && !isDisease ? 1 : 0);
      }
      const visible = new Set(patch.multiloc.filter(typeId => typeId >= 0));
      for (const typeId of visible) {
        const config = types.LocType.get(typeId);
        assert(Scripts.getByTrigger(Trigger.OPLOC2, config.id, config.category),
          `${spec.name} original Inspect form ${config.debugname}`);
      }
    } finally { p.unlink(); }
  }
}
console.log('PASS all tree-family table rows, cache failure forms and Inspect morph dispatch');

// Every potted species must pass the same native patch planting gates and empty-pot return.
for (const spec of allSpecs) {
  const { p, loc } = fixture(spec, 3, spec.level);
  try {
    add(p, spec.seedling);
    act(p, () => use(p, spec.seedling, loc));
    assert.equal(patchStage(p, spec), 3, `${spec.name} requires the spade`);
    assert.equal(count(p, spec.seedling), 1);
    assert.equal(count(p, 'plantpot_empty'), 0);
    assert.equal(xp(p), 0);
    p.setLevel(PlayerStat.FARMING, Math.max(1, spec.level - 1));
    p.startFarmXp = p.stats[PlayerStat.FARMING];
    add(p, 'spade');
    act(p, () => use(p, spec.seedling, loc));
    assert.equal(patchStage(p, spec), 3, `${spec.name} requires Farming ${spec.level}`);
    assert.equal(count(p, spec.seedling), 1);
    assert.equal(xp(p), 0);
    p.setLevel(PlayerStat.FARMING, spec.level);
    p.startFarmXp = p.stats[PlayerStat.FARMING];
    fillInventory(p);
    const fullCount = totalInventory(p);
    act(p, () => use(p, spec.seedling, loc));
    assert.equal(patchStage(p, spec), spec.first, `${spec.name} native transplant stage`);
    assert.equal(count(p, spec.seedling), 0);
    assert.equal(count(p, 'plantpot_empty'), 1, 'transplant returns the empty pot');
    assert.equal(xp(p), spec.plantXp, `${spec.name} planting XP`);
    assert.equal(totalInventory(p), fullCount, 'a full inventory exchanges the sapling for its empty pot');
    const beforeInspect = p.messages.length;
    act(p, () => click(p, loc, 2));
    assert(p.messages.length > beforeInspect, `${spec.name} native Inspect packet reaches its visible form`);
    assert.equal(patchStage(p, spec), spec.first);
    assert.equal(xp(p), spec.plantXp);
  } finally { p.unlink(); }
}
console.log('PASS native level/tool-gated planting and pot return for all 14 tree species');

// Native rake/compost on one original patch of each later family, plus all 12 packed soil slots.
for (const spec of [trees[0], fruitTrees[0], specialTrees[0], specialTrees[1]]) {
  const { p, loc } = fixture(spec, 0);
  try {
    add(p, 'rake');
    for (let n = 1; n <= 3; n++) {
      act(p, () => use(p, 'rake', loc));
      assert.equal(patchStage(p, spec), n);
    }
    assert.equal(count(p, 'weeds'), 3);
    assert.equal(xp(p), 120);
    add(p, 'bucket_supercompost');
    act(p, () => use(p, 'bucket_supercompost', loc));
    assert.equal(proc(p, 'farming_soil_treatment', spec.soil).intStack[0], 2);
    assert.equal(count(p, 'bucket_empty'), 1);
    assert.equal(patchStage(p, spec), 3, 'soil treatment does not change the tree selector');
  } finally { p.unlink(); }
}
{
  const p = player();
  try {
    assert.equal(soilVar, 246, 'assigned permanent tree-soil save slot');
    assert.equal(types.VarPlayerType.get(soilVar).scope, types.VarPlayerType.SCOPE_PERM);
    assert.equal(types.VarPlayerType.get(soilVar).transmit, false);
    p.setVar(soilVar, 0xff000000);
    const treatments = [1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2];
    for (let index = 0; index < treatments.length; index++) {
      const soil = 27 + index;
      proc(p, 'farming_soil_set_treatment', soil, treatments[index]);
      assert.equal(result(p, 'farming_soil_treatment', soil), treatments[index]);
    }
    assert.equal(p.getVar(soilVar) >>> 24, 0xff, 'unused bits 24..31 survive all treatments');
    const saved = saveAndLoad(p);
    try {
      for (let index = 0; index < treatments.length; index++) {
        assert.equal(result(saved, 'farming_soil_treatment', 27 + index), treatments[index]);
      }
      assert.equal(saved.getVar(soilVar) >>> 24, 0xff, 'reserved high bits persist');
      proc(saved, 'farming_soil_clear', 33);
      assert.equal(result(saved, 'farming_soil_treatment', 33), 0);
      assert.equal(result(saved, 'farming_soil_treatment', 32), treatments[5], 'adjacent soil treatment survives clear');
      assert.equal(saved.getVar(soilVar) >>> 24, 0xff);
    } finally { saved.unlink(); }
  } finally { p.unlink(); }
}
console.log('PASS native tree-family rake, compost, persisted treatment and reserved-bit preservation');

// Reconciliation dispatches the named growth rows online and after real Player save/load.
const oldDate = Runner.HANDLERS[ScriptOpcode.DATE_MINUTES];
const reconcileRandom = Runner.HANDLERS[ScriptOpcode.RANDOM];
Runner.HANDLERS[ScriptOpcode.RANDOM] = state => {
  const bound = state.popInt();
  state.pushInt(bound - 1);
};
let minute = 600;
Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(minute);
try {
  const growthTable = types.DbTableType.getByName('farming_growth');
  assert(growthTable, 'shared named growth table');
  for (const spec of growthSpecs) {
    const growthRow = types.DbRowType.get(id('DbRowType', spec.growthRow));
    assert.equal(growthRow.tableId, growthTable.id);
    assert.equal(field(growthRow, growthTable, 'period'), spec.period, `${spec.growthRow} period`);
    const online = fixture(spec, 3);
    try {
      minute = spec.period * 4;
      proc(online.p, 'farming_login');
      patchSet(online.p, spec, spec.first);
      minute += spec.period - 1;
      proc(online.p, 'farming_reconcile', 0);
      assert.equal(patchStage(online.p, spec), spec.first, `${spec.name} online clock waits for its global window`);
      minute++;
      proc(online.p, 'farming_reconcile', 0);
      assert.equal(patchStage(online.p, spec), spec.first + 1, `${spec.name} online row dispatch`);
    } finally { online.p.unlink(); }
    const offline = fixture(spec, 3);
    try {
      minute = 1000;
      proc(offline.p, 'farming_login');
      patchSet(offline.p, spec, spec.first);
      proc(offline.p, 'farming_logout');
      const loaded = saveAndLoad(offline.p);
      try {
        minute = 1000 + spec.period + 1;
        proc(loaded, 'farming_login');
        assert.equal(patchStage(loaded, spec), spec.first + 1, `${spec.name} inferred offline row dispatch`);
        assert.equal(loaded.getVar(growthClock), minute);
        proc(loaded, 'farming_reconcile', 1);
        assert.equal(patchStage(loaded, spec), spec.first + 1, 'same-window reconciliation is idempotent');
      } finally { loaded.unlink(); }
    } finally { offline.p.unlink(); }
  }
} finally {
  Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = oldDate;
  Runner.HANDLERS[ScriptOpcode.RANDOM] = reconcileRandom;
}
console.log('PASS tree, fruit, calquat and spirit online/offline shared-growth reconciliation');

// Every original fee row debits exact plain or noted resources atomically and marks only its gardener patch.
for (let index = 0; index < careSpecs.length; index++) {
  const spec = careSpecs[index];
  const { p } = fixture(spec, 3);
  try {
    patchSet(p, spec, spec.first);
    const note = `cert_${spec.payment}`;
    const useNote = index % 2 === 1;
    const item = useNote ? note : spec.payment;
    const beforeStage = patchStage(p, spec);
    assert.equal(result(p, 'farming_trees_protection_hire', spec.global + spec.local), 0,
      `${spec.name} cannot hire without payment`);
    if (spec.quantity > 1) add(p, item, spec.quantity - 1);
    assert.equal(result(p, 'farming_trees_protection_hire', spec.global + spec.local), 0,
      `${spec.name} partial payment is atomic`);
    assert.equal(count(p, item), spec.quantity - 1);
    add(p, item, 1);
    assert.equal(result(p, 'farming_trees_protection_hire', spec.global + spec.local), 1,
      `${spec.name} exact ${useNote ? 'noted' : 'plain'} payment`);
    assert.equal(count(p, item), 0);
    assert.equal(patchStage(p, spec), beforeStage, 'hiring care preserves the planted crop');
    assert.equal((p.getVar(careVar) >>> (spec.global + spec.local)) & 1, 1);
  } finally { p.unlink(); }
}
console.log('PASS all 12 sourced tree and fruit protection fees, noted forms, and atomic insufficiency');

// The original eight mapped tree/fruit gardeners clear only their mature patch for 200 coins.
const component = name => id('Component', name);
const normalize = text => text.replace(/[|\s]+/g, ' ').trim();
function talk(p, name, choices) {
  const at = placements.npc.get(name)?.[0];
  assert(at, `original map places ${name}`);
  const npc = [...World.npcs].find(actor => actor.type === at.type && actor.level === at.level && actor.x === at.x && actor.z === at.z);
  assert(npc, `full engine map loads ${name}`);
  const config = types.NpcType.get(npc.type);
  const script = Scripts.getByTrigger(Trigger.OPNPC1, config.id, config.category);
  assert(script, `${name} has native Talk-to dispatch`);
  const packets = [];
  p.write = packet => packets.push(packet);
  const state = Runner.init(script, p, npc);
  p.executeScript(state, true, true);
  for (let step = 0; state.execution !== State.FINISHED && step < 500; step++) {
    if (state.execution === State.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
    } else {
      assert.equal(state.execution, State.PAUSEBUTTON, `${script.name} does not abort`);
      const root = p.modalChat >= 0 ? types.Component.get(p.modalChat)?.comName ?? '' : '';
      if (/^multi[2-5]$/.test(root)) {
        assert(choices.length, `${script.name} requires expected ${root} choice`);
        p.lastCom = component(`${root}:com_${choices.shift()}`);
        assert(p.resumeButtons.includes(p.lastCom), `${root} visibly offers chosen option`);
      }
    }
    p.executeScript(state, true, true);
  }
  assert.equal(state.execution, State.FINISHED, `${script.name} finishes`);
  assert.equal(choices.length, 0, `${script.name} consumes every expected choice`);
  return normalize(packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => packet.text).join(' '));
}
for (let local = 0; local < 4; local++) {
  for (const [spec, name] of [[trees[0], `farming_gardener_tree_${local + 1}`],
    [fruitTrees[0], `farming_gardener_fruit_${local + 1}`]]) {
    const patchSpec = { ...spec, local, soil: spec.soil + local };
    const { p } = fixture(patchSpec, patchSpec.mature);
    try {
      add(p, 'coins', 200);
      talk(p, name, [3, 1]);
      assert.equal(patchStage(p, patchSpec), 3, `${name} clears only its mature original patch`);
      assert.equal(count(p, 'coins'), 0, `${name} takes exactly 200 coins`);
      assert.equal(result(p, 'farming_soil_treatment', patchSpec.soil), 0, `${name} clear resets soil`);
      assert.equal((p.getVar(careVar) >>> (spec.global + local)) & 1, 0, `${name} clear resets care`);
    } finally { p.unlink(); }
  }
}
{
  const spec = trees[0], { p } = fixture(spec, spec.mature);
  try {
    add(p, 'coins', 199);
    const text = talk(p, 'farming_gardener_tree_1', [3, 1]);
    assert.match(text, /200 coins/i);
    assert.equal(patchStage(p, spec), spec.mature, 'insufficient clear payment preserves tree');
    assert.equal(count(p, 'coins'), 199);
  } finally { p.unlink(); }
}
console.log('PASS native Talk-to payment flow for all eight tree gardeners, exact clear fee and insufficient coins');

// Check-health is an exact one-time reward on every crop row, using its actual visible location form.
for (const spec of allSpecs) {
  const checkStage = spec.family === 'wood' ? spec.mature : spec.claim;
  const { p, loc } = fixture(spec, checkStage);
  try {
    assert.equal(xp(p), 0);
    act(p, () => click(p, loc, 1));
    assert.equal(xp(p), spec.checkXp, `${spec.name} one-time check-health reward`);
    assert.equal(patchStage(p, spec), spec.last, `${spec.name} health check records its complete state`);
  } finally { p.unlink(); }
}
console.log('PASS one-time check-health XP for all 14 table rows');
// Spirit uses its 12 original family windows to reach the unique health-check state.
{
  const spec = specialTrees[0], { p, loc } = fixture(spec, spec.first);
  try {
    advanceHealthy(p, spec, 12);
    assert.equal(patchStage(p, spec), spec.claim);
    act(p, () => click(p, loc, 1));
    assert.equal(patchStage(p, spec), spec.last);
    assert.equal(xp(p), spec.checkXp);
  } finally { p.unlink(); }
}
// Paid fruit-tree care must bypass a forced disease roll without touching reserved bits.
{
  const spec = fruitTrees[0], { p } = fixture(spec, spec.first);
  const oldRandom = Runner.HANDLERS[ScriptOpcode.RANDOM];
  try {
    p.setVar(soilVar, 0xff000000);
    add(p, spec.payment, spec.quantity);
    assert.equal(result(p, 'farming_trees_protection_hire', spec.global), 1);
    Runner.HANDLERS[ScriptOpcode.RANDOM] = state => { state.popInt(); state.pushInt(0); };
    advance(p, spec, 6);
    assert.equal(patchStage(p, spec), spec.claim, 'protected fruit reaches health check rather than disease');
    assert.equal(p.getVar(soilVar) >>> 24, 0xff);
  } finally { Runner.HANDLERS[ScriptOpcode.RANDOM] = oldRandom; p.unlink(); }
}
// Disease pruning and dead-tree spading use only original family failure forms.
for (const spec of [trees[0], fruitTrees[0], specialTrees[0], specialTrees[1]]) {
  const row = rows.get(spec.row), table = tables.get(spec.table), at = target(spec);
  const disease = spec.family === 'wood' ? spec.first + 1 + 64 : field(row, table, 'diseased');
  const deadStage = spec.family === 'wood' ? spec.first + 1 + 128 : field(row, table, 'dead');
  const { p } = fixture(spec, disease);
  try {
    add(p, 'secateurs');
    act(p, () => use(p, 'secateurs', at.loc));
    const pruned = spec.family === 'wood' ? disease - 64
      : spec.first + (disease - field(row, table, 'diseased')) + 1;
    assert.equal(patchStage(p, spec), pruned, `${spec.name} disease returns to its living stage`);
    patchSet(p, spec, deadStage);
    add(p, 'spade');
    act(p, () => use(p, 'spade', at.loc));
    assert.equal(patchStage(p, spec), 3, `${spec.name} dead tree is removed by spade`);
  } finally { p.unlink(); }
}
console.log('PASS native disease pruning and dead-tree removal across wood, fruit and special families');

// Fruit-tree and calquat initial growth reach their unique check-health selector.
{
  const spec = fruitTrees[0], { p, loc } = fixture(spec, spec.first);
  try {
    p.setVar(soilVar, 0xff000000);
    advanceHealthy(p, spec, 6);
    assert.equal(patchStage(p, spec), spec.claim, 'six healthy windows reach the unique health-check form');
    act(p, () => click(p, loc, 1));
    assert.equal(xp(p), spec.checkXp);
    assert.equal(patchStage(p, spec), spec.last);
    assert.equal(p.getVar(soilVar) >>> 24, 0xff, 'health selector leaves all reserved bits intact');
    const loaded = saveAndLoad(p);
    try {
      assert.equal(patchStage(loaded, spec), spec.last, 'full-fruit selector survives save/load');
      const checkXp = xp(loaded);
      act(loaded, () => click(loaded, loc, 1));
      assert.equal(count(loaded, spec.produce), 1, 'one named fruit is returned to inventory');
      assert.equal(patchStage(loaded, spec), spec.last - 1);
      assert.equal(xp(loaded), checkXp + spec.harvestXp, 'pick grants only harvest XP');
      advanceHealthy(loaded, spec, 1);
      assert.equal(patchStage(loaded, spec), spec.last, 'picked fruit regrows to the full selector');
      assert.equal(xp(loaded), checkXp + spec.harvestXp, 'regrowth grants no health XP');
      proc(loaded, 'farming_logout');
      const afterLogout = saveAndLoad(loaded);
      try {
        proc(afterLogout, 'farming_login');
        assert.equal(patchStage(afterLogout, spec), spec.last, 'logout/login never re-enters health-check selector');
        assert.equal(xp(afterLogout), checkXp + spec.harvestXp, 'saved health XP remains single');
        patchSet(afterLogout, spec, field(rows.get(spec.row), tables.get(spec.table), 'stump'));
        advanceHealthy(afterLogout, spec, 1);
        assert.equal(patchStage(afterLogout, spec), spec.last, 'one-window stump recovery restores full fruit');
        assert.equal(xp(afterLogout), checkXp + spec.harvestXp, 'stump recovery grants no second health XP');
        assert.equal(afterLogout.getVar(soilVar) >>> 24, 0xff, 'stump recovery preserves unused soil bits');
      } finally { afterLogout.unlink(); }
    } finally { loaded.unlink(); }
  } finally { p.unlink(); }
}
console.log('PASS fruit health XP remains single across pick, regrowth, stump recovery and logout');

// Calquat's unique health-check byte starts six fruits; exhaustion and stump do not regrow.
{
  const spec = specialTrees[1], { p, loc } = fixture(spec, spec.first);
  try {
    p.setVar(soilVar, 0xff000000);
    advanceHealthy(p, spec, 8);
    assert.equal(patchStage(p, spec), spec.claim, 'eight healthy windows reach the unique calquat check form');
    act(p, () => click(p, loc, 1));
    assert.equal(patchStage(p, spec), spec.last, 'calquat health check starts six fruits');
    assert.equal(xp(p), spec.checkXp);
    assert.equal(p.getVar(soilVar) >>> 24, 0xff, 'calquat check leaves all reserved bits untouched');
    const loaded = saveAndLoad(p);
    try {
      assert.equal(patchStage(loaded, spec), spec.last, 'checked fruit selector persists through save/load');
      const checkXp = xp(loaded);
      for (let n = 1; n <= 6; n++) {
        act(loaded, () => click(loaded, loc, 1));
        assert.equal(count(loaded, spec.produce), n, `calquat fruit ${n}`);
        assert.equal(patchStage(loaded, spec), spec.last - n, `calquat stage after fruit ${n}`);
        assert.equal(xp(loaded), checkXp + n * spec.harvestXp, `calquat harvest XP after fruit ${n}`);
      }
      assert.equal(patchStage(loaded, spec), spec.mature, 'sixth fruit leaves the living tree');
      advance(loaded, spec, 1000);
      assert.equal(patchStage(loaded, spec), spec.mature, 'period source forbids calquat fruit regrowth');
      assert.equal(xp(loaded), checkXp + 6 * spec.harvestXp, 'exhaustion grants no second check-health XP');
      assert.equal(loaded.getVar(soilVar) >>> 24, 0xff);
      const afterPick = saveAndLoad(loaded);
      try {
        const patch = types.LocType.get(id('LocType', spec.patch));
        const empty = types.LocType.get(patch.multiloc[spec.mature]);
        assert(!empty.op?.some(label => label?.toLowerCase().startsWith('chop')), 'original empty calquat has no Chop-down action');
        add(afterPick, 'spade'); add(afterPick, spec.seedling);
        act(afterPick, () => use(afterPick, 'spade', loc));
        assert.equal(patchStage(afterPick, spec), 3, 'native spade removes the exhausted calquat before replanting');
        act(afterPick, () => use(afterPick, spec.seedling, loc));
        assert.equal(patchStage(afterPick, spec), spec.first);
        assert.equal(afterPick.getVar(soilVar) >>> 24, 0xff, 'new calquat planting preserves unused varp bits');
      } finally { afterPick.unlink(); }
    } finally { loaded.unlink(); }
  } finally { p.unlink(); }
}
console.log('PASS calquat check selector, six-pick exhaustion, save/load and no fruit regrowth');
{
  const spec = specialTrees[1], table = tables.get(spec.table), row = rows.get(spec.row);
  const stumpStage = field(row, table, 'stump');
  const { p } = fixture(spec, stumpStage);
  try {
    advance(p, spec, 1000);
    assert.equal(patchStage(p, spec), stumpStage, 'calquat stump never regrows through the unused stump branch');
  } finally { p.unlink(); }
}
// Native planted-tree chopping writes only the owner's stump selector and returns its species roots.
{
  const spec = trees[0], row = rows.get(spec.row), table = tables.get(spec.table);
  const owner = fixture(spec, spec.claim), other = fixture(spec, spec.first);
  const p = owner.p, patch = types.LocType.get(id('LocType', spec.patch));
  const stumpStage = field(row, table, 'stump');
  const stumpType = field(row, table, 'stump_loc');
  const otherForm = patch.multiloc[patchStage(other.p, spec)];
  const oldRandom = Runner.HANDLERS[ScriptOpcode.RANDOM];
  const oldStatRandom = Runner.HANDLERS[ScriptOpcode.STAT_RANDOM];
  let stumpSave;
  try {
    assert.equal(patch.multiloc[stumpStage], stumpType, 'stump selector uses its original cache location');
    assert.notEqual(otherForm, stumpType, 'another account begins with its own seedling form');
    p.setLevel(PlayerStat.WOODCUTTING, 99);
    const woodcutXp = p.stats[PlayerStat.WOODCUTTING];
    p.setVar(soilVar, 0xff000000);
    add(p, 'bronze_axe');
    World.currentTick += 3;
    p.setVar(actionDelay, World.currentTick);
    Runner.HANDLERS[ScriptOpcode.RANDOM] = state => {
      const bound = state.popInt();
      state.pushInt(bound === 8 ? 0 : bound - 1);
    };
    Runner.HANDLERS[ScriptOpcode.STAT_RANDOM] = state => {
      state.popInts(3);
      state.pushInt(1);
    };
    assert(click(p, owner.loc, 1), 'native planted-tree chop packet accepted');
    assert.equal(patchStage(p, spec), stumpStage, "successful chop writes the owner's stump byte");
    assert.equal(World.getLoc(owner.loc.x, owner.loc.z, owner.loc.level, owner.loc.type), owner.loc,
      'owner chopping leaves the original shared location in place for other players');
    assert.equal(p.getVar(soilVar) >>> 24, 0xff, 'tree chop leaves reserved soil bits untouched');
    assert.equal(patchStage(other.p, spec), spec.first, 'other account patch byte is unchanged');
    assert.equal(patch.multiloc[patchStage(other.p, spec)], otherForm, 'other account retains its original form');
    assert.equal(count(p, 'oak_logs'), 1, 'successful tree chop awards the native log');
    assert(p.stats[PlayerStat.WOODCUTTING] > woodcutXp, 'successful chop grants Woodcutting XP');
    assert.equal(xp(p), 0, 'chopping a farm tree grants no Farming XP');
    stumpSave = saveAndLoad(p);
    assert.equal(patchStage(stumpSave, spec), stumpStage, 'owner stump byte survives save/load');
    assert.equal(stumpSave.getVar(soilVar) >>> 24, 0xff, 'saved stump leaves reserved soil bits untouched');
    proc(stumpSave, 'farming_tree_stump_regrow', spec.local);
    assert.equal(patchStage(stumpSave, spec), spec.claim, 'the owner stump callback returns the health-checked tree');
    add(p, 'spade');
    const capacity = types.InvType.get(inv).size;
    for (let slotIndex = 0; slotIndex < capacity; slotIndex++) {
      if (!p.invGetSlot(inv, slotIndex)) p.invSet(inv, id('ObjType', 'bronze_axe'), 1, slotIndex);
    }
    assert.equal(Array.from({ length: capacity }, (_, slotIndex) => p.invGetSlot(inv, slotIndex)).filter(Boolean).length, capacity);
    act(p, () => use(p, 'spade', owner.loc));
    assert.equal(patchStage(p, spec), stumpStage, 'a full inventory refuses to clear the stump');
    assert.equal(count(p, spec.roots), 0, 'failed spade action gives no roots');
    p.invClear(inv);
    add(p, 'spade');
    act(p, () => use(p, 'spade', owner.loc));
    assert.equal(patchStage(p, spec), 3, 'spade clears the stump with free inventory');
    assert.equal(count(p, spec.roots), spec.rootsQuantity, 'spade returns the configured species roots');
    add(p, spec.seedling);
    act(p, () => use(p, spec.seedling, owner.loc));
    assert.equal(patchStage(p, spec), spec.first, 'cleared patch accepts a new sapling before the old timer');
    proc(p, 'farming_tree_stump_regrow', spec.local);
    assert.equal(patchStage(p, spec), spec.first, 'a stale owner timer cannot overwrite the replanted selector');
    assert.equal(patch.multiloc[patchStage(p, spec)], patch.multiloc[spec.first], 'replanted form remains unchanged');
    assert.equal(p.getVar(soilVar) >>> 24, 0xff, 'stump clear and replant preserve reserved bits');
    assert.equal(patchStage(other.p, spec), spec.first, 'stale callback leaves the other account untouched');
  } finally {
    Runner.HANDLERS[ScriptOpcode.RANDOM] = oldRandom;
    Runner.HANDLERS[ScriptOpcode.STAT_RANDOM] = oldStatRandom;
    if (stumpSave) stumpSave.unlink();
    p.unlink();
    other.p.unlink();
  }
}
console.log('PASS owner-scoped tree chop, saved stump, roots space gate and stale timer guard');

// A chopped ordinary tree retains its original native woodcutting script, unrelated to Farming morphs.
{
  const entries = placements.loc.get('tree') ?? [];
  assert(entries.length, 'original ordinary tree remains mapped');
  let at;
  for (const entry of entries) {
    const loc = World.getLoc(entry.x, entry.z, entry.level, entry.type);
    if (!loc) continue;
    const stand = standFor(loc, false);
    if (stand) { at = { loc, stand }; break; }
  }
  assert(at, 'ordinary tree has a loaded packed location');
  const config = types.LocType.get(at.loc.type);
  const p = player();
  try {
    Object.assign(p, at.stand, { level: at.loc.level, originX: at.stand.x, originZ: at.stand.z });
    const original = Scripts.getByTrigger(Trigger.OPLOC1, config.id, config.category);
    assert.equal(original?.name, '[oploc1,_tree]', 'ordinary tree still uses the original woodcutting entry');
    p.clearInteraction();
    assert(opLocHandler.handle(new OpLoc(1, at.loc.x, at.loc.z, at.loc.type), p), 'native ordinary-tree packet admitted');
    assert.equal(p.getOpTrigger(), original, 'native packet retains original woodcutting dispatch');
  } finally { p.unlink(); }
}

// Each wood species traverses its own complete growth band and retains its checked state.
for (const spec of trees) {
  const { p, loc } = fixture(spec, spec.first);
  try {
    advanceHealthy(p, spec, spec.mature - spec.first);
    assert.equal(patchStage(p, spec), spec.mature, `${spec.name} complete healthy growth`);
    act(p, () => click(p, loc, 1));
    assert.equal(patchStage(p, spec), spec.claim);
    assert.equal(xp(p), spec.checkXp);
    const saved = saveAndLoad(p);
    try {
      assert.equal(patchStage(saved, spec), spec.claim, `${spec.name} checked selector persists`);
      advanceHealthy(saved, spec, 100);
      assert.equal(patchStage(saved, spec), spec.claim);
      assert.equal(xp(saved), spec.checkXp, `${spec.name} mature growth never repeats health XP`);
    } finally { saved.unlink(); }
  } finally { p.unlink(); }
}
console.log('PASS complete healthy growth and persisted check-health state for all five wood species');

// All seven fruit rows exhaust six fruit, then regrow one without reopening health XP.
for (const spec of fruitTrees) {
  const { p, loc } = fixture(spec, spec.first);
  try {
    advanceHealthy(p, spec, 6);
    assert.equal(patchStage(p, spec), spec.claim, `${spec.name} complete initial growth`);
    act(p, () => click(p, loc, 1));
    for (let n = 1; n <= 6; n++) {
      act(p, () => click(p, loc, 1));
      assert.equal(count(p, spec.produce), n, `${spec.name} fruit ${n}`);
      assert.equal(patchStage(p, spec), spec.last - n);
      assert.equal(xp(p), spec.checkXp + n * spec.harvestXp);
    }
    assert.equal(patchStage(p, spec), spec.mature);
    advanceHealthy(p, spec, 1);
    assert.equal(patchStage(p, spec), spec.mature + 1, `${spec.name} regrows one fruit per window`);
    const saved = saveAndLoad(p);
    try {
      act(saved, () => click(saved, loc, 1));
      assert.equal(count(saved, spec.produce), 7, `${spec.name} regrown fruit survives save/load`);
      assert.equal(patchStage(saved, spec), spec.mature);
      assert.equal(xp(saved), spec.checkXp + 7 * spec.harvestXp, `${spec.name} health XP remains single`);
    } finally { saved.unlink(); }
  } finally { p.unlink(); }
}
console.log('PASS all seven fruit species: six picks, correct produce/XP, regrowth and save/load');

for (const spec of [...fruitTrees, specialTrees[1]]) {
  const { p, loc } = fixture(spec, spec.last);
  try {
    fillInventory(p);
    act(p, () => click(p, loc, 1));
    assert.equal(patchStage(p, spec), spec.last, `${spec.name} full inventory preserves fruit`);
    assert.equal(count(p, spec.produce), 0);
    assert.equal(xp(p), 0);
    p.invClear(inv);
    act(p, () => click(p, loc, 1));
    assert.equal(count(p, spec.produce), 1);
    assert.equal(patchStage(p, spec), spec.last - 1);
    assert.equal(xp(p), spec.harvestXp);
  } finally { p.unlink(); }
}
console.log('PASS full-inventory harvest safety for every fruit row and calquat');

// Force each actual compiled disease/death branch, rather than seeding its result.
for (const spec of allSpecs) {
  const { p, loc } = fixture(spec, spec.first);
  const original = Runner.HANDLERS[ScriptOpcode.RANDOM];
  Runner.HANDLERS[ScriptOpcode.RANDOM] = state => { state.popInt(); state.pushInt(0); };
  try {
    advance(p, spec, 2);
    assert.equal(procAt(p, `${api(spec)}_is_diseased`, loc, patchStage(p, spec)).intStack[0], 1, `${spec.name} disease roll`);
    add(p, 'secateurs');
    act(p, () => use(p, 'secateurs', loc));
    assert.equal(procAt(p, `${api(spec)}_is_diseased`, loc, patchStage(p, spec)).intStack[0], 0, `${spec.name} native pruning`);
    advance(p, spec, 1);
    assert.equal(procAt(p, `${api(spec)}_is_diseased`, loc, patchStage(p, spec)).intStack[0], 1);
    advance(p, spec, 1);
    assert.equal(procAt(p, `${api(spec)}_is_dead`, loc, patchStage(p, spec)).intStack[0], 1, `${spec.name} untreated disease becomes death`);
    add(p, 'spade');
    act(p, () => use(p, 'spade', loc));
    assert.equal(patchStage(p, spec), 3, `${spec.name} dead tree can be cleared and replanted`);
  } finally { Runner.HANDLERS[ScriptOpcode.RANDOM] = original; p.unlink(); }
}
console.log('PASS forced disease, native pruning, death and clearing for all 14 species');

{
  const spec = trees[3], { p } = fixture(spec, spec.first);
  try {
    add(p, spec.payment, 4);
    add(p, `cert_${spec.payment}`, spec.quantity - 4);
    assert.equal(result(p, 'farming_trees_protection_hire', spec.global), 1);
    assert.equal(count(p, spec.payment), 0);
    assert.equal(count(p, `cert_${spec.payment}`), 0);
    assert.equal((p.getVar(careVar) >>> spec.global) & 1, 1);
  } finally { p.unlink(); }
}
console.log('PASS atomic mixed plain/noted tree protection payment');

for (const local of [1, 2]) {
  const spec = specialTrees[0], other = { ...spec, local, soil: spec.soil + local, patch: `farming_spirit_tree_patch_${local + 1}` };
  const { p, loc } = fixture(spec, spec.first);
  const otherAt = target(other);
  try {
    patchSet(p, other, 3);
    add(p, 'spade'); add(p, spec.seedling);
    Object.assign(p, { x: otherAt.x, z: otherAt.z, level: otherAt.loc.level, originX: otherAt.x, originZ: otherAt.z });
    act(p, () => use(p, spec.seedling, otherAt.loc));
    assert.equal(patchStage(p, other), 3, 'a growing spirit tree blocks a second planting');
    assert.equal(count(p, spec.seedling), 1);
    patchSet(p, spec, field(rows.get(spec.row), tables.get(spec.table), 'dead'));
    act(p, () => use(p, spec.seedling, otherAt.loc));
    assert.equal(patchStage(p, other), 3, 'a dead spirit tree still occupies the one-tree limit');
    assert.equal(count(p, spec.seedling), 1);
    const originalAt = target(spec);
    Object.assign(p, { x: originalAt.x, z: originalAt.z, level: loc.level, originX: originalAt.x, originZ: originalAt.z });
    act(p, () => use(p, 'spade', loc));
    assert.equal(patchStage(p, spec), 3);
    Object.assign(p, { x: otherAt.x, z: otherAt.z, level: otherAt.loc.level, originX: otherAt.x, originZ: otherAt.z });
    act(p, () => use(p, spec.seedling, otherAt.loc));
    assert.equal(patchStage(p, other), spec.first, 'clearing releases the limit for the other original patch');
    assert.equal(count(p, spec.seedling), 0);
    assert.equal(count(p, 'plantpot_empty'), 1);
  } finally { p.unlink(); }
}
console.log('PASS spirit one-tree limit, dead-tree occupancy and replanting at both other original patches');

// The original empty-fruit form offers Chop-down; fruit-bearing forms offer only picking.
for (const spec of fruitTrees) {
  const { p, loc } = fixture(spec, spec.mature);
  p.setLevel(PlayerStat.WOODCUTTING, 99);
  const patch = types.LocType.get(id('LocType', spec.patch));
  const form = types.LocType.get(patch.multiloc[spec.mature]);
  assert(form.op, `${spec.name} original visible menu`);
  const chop = form.op.findIndex(label => label?.toLowerCase().startsWith('chop')) + 1;
  assert(chop > 0, `${spec.name} original Chop-down action`);
  try {
    act(p, () => click(p, loc, chop));
    assert.equal(patchStage(p, spec), spec.mature, `${spec.name} chopping requires an axe`);
    add(p, 'bronze_axe');
    const woodcutXp = p.stats[PlayerStat.WOODCUTTING];
    act(p, () => click(p, loc, chop));
    const started = World.currentTick;
    const ready = p.getVar(actionDelay);
    assert.equal(ready - started, 3, `${spec.name} native chopping schedules a three-tick swing`);
    World.currentTick = ready - 1;
    p.processInteraction();
    assert.equal(patchStage(p, spec), spec.mature, `${spec.name} cannot finish before its queued swing`);
    World.currentTick = ready;
    p.processInteraction();
    assert.equal(patchStage(p, spec), field(rows.get(spec.row), tables.get(spec.table), 'stump'), `${spec.name} chopping leaves its original stump`);
    assert.equal(p.stats[PlayerStat.WOODCUTTING], woodcutXp, 'functional fruit-tree chopping awards no Woodcutting XP');
    assert.equal(xp(p), 0);
    assert.equal(count(p, spec.produce), 0, 'chopping does not silently harvest fruit');
    assert.equal(World.getLoc(loc.x, loc.z, loc.level, loc.type), loc);
    add(p, 'spade');
    act(p, () => use(p, 'spade', loc));
    assert.equal(patchStage(p, spec), 3, `${spec.name} spade clears the stump`);
  } finally { p.unlink(); }
}
console.log('PASS native cached chopping, axe gate, queued three-tick swing and stump clearing for all seven fruit species');

runNativeNetworkCompatibility();
console.log('PASS original non-farmed woodcutting and spirit-tree network compatibility');
process.exit(0);
