#!/usr/bin/env node
// Run from the sibling engine: node --import tsx ../content/tests/skill-guides/test_skill_guides.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = async relative => import(pathToFileURL(path.join(engine, 'src', relative)).href);
const defaultExport = async relative => (await load(relative)).default;
const World = await defaultExport('engine/World.ts');
const Player = await defaultExport('engine/entity/Player.ts');
const ScriptProvider = await defaultExport('engine/script/ScriptProvider.ts');
const ScriptRunner = await defaultExport('engine/script/ScriptRunner.ts');
const ServerTriggerType = await defaultExport('engine/script/ServerTriggerType.ts');
const { PlayerStat } = await load('engine/entity/PlayerStat.ts');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'Component', 'FontType']) {
  types[name] = await defaultExport(`cache/config/${name}.ts`);
  types[name].load(pack);
}
(await defaultExport('cache/config/DbTableIndex.ts')).init();
assert(ScriptProvider.load(pack) > 0, 'build the full sibling engine pack first');
const IfButton = await defaultExport('network/game/client/model/IfButton.ts');
const buttonHandler = new (await defaultExport('network/game/client/handler/IfButtonHandler.ts'))();
const id = (kind, name) => {
  const value = types[kind].getId(name);
  assert(value >= 0, `missing packed ${kind} ${name}`);
  return value;
};
const table = name => types.DbTableType.get(id('DbTableType', name));
const column = (name, field) => {
  const value = table(name).columnNames.indexOf(field);
  assert(value >= 0, `${name}:${field} column exists`);
  return value;
};
const value = (row, field, index = 0) => {
  const indexOfColumn = column('skill_guides', field);
  return row.columnValues[indexOfColumn] ? row.getValue(indexOfColumn, index) : table('skill_guides').getDefault(indexOfColumn);
};
const unlocks = row => {
  const values = row.columnValues[column('skill_guides', 'unlock')];
  return Array.from({ length: values.length / 2 }, (_, index) => value(row, 'unlock', index));
};
const originalObjects = new Map(fs.readFileSync(path.join(content, 'pack/obj.pack'), 'utf8').trim().split('\n').map(line => {
  const split = line.indexOf('=');
  return [line.slice(split + 1), Number(line.slice(0, split))];
}));
const cacheIds = new Set(originalObjects.values());
const rows = types.DbRowType.getInTable(id('DbTableType', 'skill_guides'));
let iconCount = 0;
for (const row of rows) {
  const entries = unlocks(row);
  assert(entries.length <= 40, `${row.debugname}: all rows fit original guide interface`);
  let previous = 0;
  for (const [level] of entries) {
    if (level === -1) continue; // instructional rows have no level
    assert(level >= previous && level >= 1 && level <= 99, `${row.debugname}: levels ascend (${previous}, ${level})`);
    previous = level;
  }
  const [inventoryId] = value(row, 'inv');
  if (inventoryId === -1) continue;
  const inventory = types.InvType.get(inventoryId);
  assert(inventory, `${row.debugname}: packed icon inventory exists`);
  for (let slot = 0; slot < (inventory.stockobj?.length ?? 0); slot++) {
    if (!inventory.stockcount[slot]) continue;
    const objectId = inventory.stockobj[slot];
    assert(cacheIds.has(objectId), `${row.debugname} slot ${slot}: icon ${objectId} exists in original 377 object mapping`);
    const object = types.ObjType.get(objectId);
    assert.equal(originalObjects.get(object.debugname), objectId, `${row.debugname}: icon keeps its cache identity`);
    assert(slot < entries.length, `${row.debugname}: no orphan icon at ${slot}`);
    iconCount++;
  }
}
console.log(`PASS ${rows.length} packed guide categories: ascending levels, <=40 rows, ${iconCount} original-cache icons`);

// Independent pre-cutoff tables: Tip.It 2006-05-01, RuneHQ 2005-12-02.
// The inherited 2007-derived requirements were bronze 10, opal 11, pearl 41.
assert.deepEqual(unlocks(types.DbRowType.getByName('skill_guide_fletching_darts')), [
  [1, 'Bronze darts.'], [22, 'Iron darts.'], [37, 'Steel darts.'],
  [52, 'Mithril darts.'], [67, 'Adamant darts.'], [81, 'Rune darts.']
]);
assert.deepEqual(unlocks(types.DbRowType.getByName('skill_guide_fletching_bolts')), [
  [17, 'Opal-tipped bolts.'], [33, 'Pearl-tipped bolts.'], [51, 'Barbed-tipped bolts.']
]);
console.log('PASS period Fletching requirements: bronze darts 1, opal bolts 17, pearl bolts 33');

const expected = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'period-guides.json'), 'utf8'));
let serial = 0;
function player() {
  const slot = ++serial;
  const p = new Player(`guide${slot}`, BigInt(slot), BigInt(slot));
  p.pid = slot; p.slot = slot; p.uid = ((slot << 11) | slot) >>> 0;
  p.isActive = true; p.level = 0; p.x = 3222; p.z = 3218;
  p.vars.fill(0); p.baseLevels.fill(99); p.levels.fill(99);
  p.setVar(id('VarPlayerType', 'tutorial'), 1000);
  p.packets = []; p.messages = [];
  p.write = packet => p.packets.push(packet);
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = p.messageGame;
  World.players[slot] = p;
  return p;
}
function press(p, component) {
  p.packets.length = 0;
  assert.equal(buttonHandler.handle(new IfButton(id('Component', component)), p), true, component);
  assert.equal(p.activeScript, null, `${component}: no script left suspended`);
}
const texts = p => new Map(p.packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => [packet.component, packet.text]));
function assertPage(p, category) {
  const sent = texts(p);
  const guide = types.DbRowType.getByName(category.guide);
  assert(guide, category.guide);
  assert.equal(sent.get(id('Component', 'skill_guide:skill_name')), `@dre@${category.title}`);
  for (let index = 0; index < 40; index++) {
    const entry = category.rows[index];
    assert.equal(sent.get(id('Component', `skill_guide:level${index + 1}`)), entry && entry.level !== -1 ? String(entry.level) : '', `${category.guide}: level ${index}`);
    assert.equal(sent.get(id('Component', `skill_guide:text${index + 1}`)), entry?.text ?? '', `${category.guide}: text ${index}`);
  }
  assert.equal(p.messages.length, 0, `${category.guide}: no missing-data fallback`);
  assert(p.packets.some(packet => packet.constructor.name === 'IfSetScrollPos' && packet.component === id('Component', 'skill_guide:back') && packet.y === 0), `${category.guide}: scroll resets`);
  assert.equal(p.modalMain, id('Component', 'skill_guide'), `${category.guide}: main guide modal opens`);
}
for (const [skill, guide] of Object.entries(expected)) {
  const family = types.DbRowType.getByName(`skill_guide_${skill}`);
  assert(family, `${skill}: guide family exists (regression fails on missing old data)`);
  assert.equal(family.getValue(column('skill_guide_ops', 'lookup'), 0)[0], PlayerStat[skill.toUpperCase()]);
  const ops = family.columnValues[column('skill_guide_ops', 'op')];
  assert.equal(ops.length, guide.categories.length * 2, `${skill}: complete period category count`);
  for (const [index, category] of guide.categories.entries()) {
    assert.deepEqual(family.getValue(column('skill_guide_ops', 'op'), index), [category.op, id('DbRowType', category.guide)]);
    const packed = types.DbRowType.getByName(category.guide);
    assert.deepEqual(unlocks(packed), category.rows.map(row => [row.level, row.text]), `${category.guide}: source-backed rows, no later additions`);
    const inventory = types.InvType.get(id('InvType', category.inventory));
    assert.equal(value(packed, 'inv')[0], inventory.id);
    for (const [slot, row] of category.rows.entries()) {
      assert.equal(typeof row.obj, 'string', `${category.guide}: row ${slot} requires an original icon`);
      assert.equal(inventory.stockobj[slot], id('ObjType', row.obj), `${category.guide}: row ${slot} original icon`);
      assert.equal(inventory.stockcount[slot], 1, `${category.guide}: row ${slot} icon must not be blank`);
    }
  }
  const p = player();
  p.tabs[1] = types.Component.get(id('Component', `stats:${skill}`)).rootLayer;
  press(p, `stats:${skill}`);
  assertPage(p, guide.categories[0]);
  for (let index = 1; index < guide.categories.length; index++) {
    press(p, `skill_guide:op${index + (guide.categories.length < 7 ? 2 : 1)}`);
    assertPage(p, guide.categories[index]);
  }
  // Reopening from the stats tab resets a previous category to page zero.
  press(p, `stats:${skill}`);
  assertPage(p, guide.categories[0]);
  console.log(`PASS ${skill}: stats-tab dispatch, all ${guide.categories.length} categories, exact row levels/text/icons, clear and reopen`);
}
// The original cache has 1,065 Guide forms. Goutweed is not plantable in this
// build; Main explicitly excludes those eleven forms until that gameplay exists.
const unplantableGoutweed = new Set([
  'goutweed_seed', 'goutweed_1', 'goutweed_2', 'goutweed_3', 'goutweed_fullygrown',
  'goutweed_1_diseased', 'goutweed_2_diseased', 'goutweed_3_diseased',
  'goutweed_1_dead', 'goutweed_2_dead', 'goutweed_3_dead'
]);
const originalLocIds = fs.readFileSync(path.join(content, 'pack/loc.pack'), 'utf8').trim().split('\n').map(line => Number(line.slice(0, line.indexOf('='))));
const patchPlayer = player();
patchPlayer.tabs[1] = types.Component.get(id('Component', 'stats:farming')).rootLayer;
const patchScript = ScriptProvider.getByName('[oploc4,_farming_patch_guide]');
assert(patchScript, 'shared Farming patch Guide handler exists (fails on the old pack)');
let guideForms = 0;
let excludedForms = 0;
for (const locId of originalLocIds) {
  const loc = types.LocType.get(locId);
  if (loc.op?.[3] !== 'Guide') continue;
  guideForms++;
  const dispatched = ScriptProvider.getByTrigger(ServerTriggerType.OPLOC4, locId, loc.category);
  if (unplantableGoutweed.has(loc.debugname)) {
    assert.equal(dispatched, undefined, `${loc.debugname}: unreachable Goutweed remains outside this unit`);
    excludedForms++;
    continue;
  }
  assert.equal(loc.category, id('CategoryType', 'farming_patch_guide'), `${loc.debugname}: shared server-only category`);
  assert.equal(dispatched, patchScript, `${loc.debugname}: real loc/category dispatch selects the shared handler`);
  // Start from Herbs each time: Guide must select the first section, not retain
  // the previous page or route to the modern patch-specific section.
  press(patchPlayer, 'stats:farming');
  press(patchPlayer, 'skill_guide:op4');
  assertPage(patchPlayer, expected.farming.categories[3]);
  patchPlayer.packets.length = 0;
  patchPlayer.executeScript(ScriptRunner.init(dispatched, patchPlayer), true);
  assert.equal(patchPlayer.activeScript, null, `${loc.debugname}: Guide completes without suspending`);
  assertPage(patchPlayer, expected.farming.categories[0]);
}
assert.equal(guideForms, 1065, 'complete original-cache Guide option census');
assert.equal(excludedForms, unplantableGoutweed.size, 'only the eleven explicitly excluded Goutweed forms');
console.log(`PASS patch Guide: all ${guideForms - excludedForms} supported forms open the first Farming section; ${excludedForms} unplantable Goutweed forms excluded`);

console.log('RESULT PASS revision-377 skill guides');
process.exit(0);
