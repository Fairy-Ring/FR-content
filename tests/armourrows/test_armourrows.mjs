#!/usr/bin/env node
// Source-derived expected.json is independent of the authored object rows.
// Level-1 source minima are normal account baselines, not unreachable-state guards.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_ROOT = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_ROOT, '../engine');
const PACK_DIR = path.join(ENGINE_ROOT, 'data/pack');
assert(fs.existsSync(path.join(PACK_DIR, 'server/script.dat')), 'build the sibling engine first');
const expected = JSON.parse(fs.readFileSync(new URL('./expected.json', import.meta.url), 'utf8'));
const eng = rel => import(pathToFileURL(path.join(ENGINE_ROOT, rel)).href);
const World = (await eng('src/engine/World.ts')).default;
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'MesanimType', 'DbTableType', 'DbRowType', 'Component', 'FontType']) {
  (await eng(`src/cache/config/${name}.ts`)).default.load(PACK_DIR);
}
(await eng('src/cache/config/DbTableIndex.ts')).default.init();
const { default: ObjType } = await eng('src/cache/config/ObjType.ts');
const { default: InvType } = await eng('src/cache/config/InvType.ts');
const { default: VarPlayerType } = await eng('src/cache/config/VarPlayerType.ts');
const { default: Player } = await eng('src/engine/entity/Player.ts');
const { default: ScriptProvider } = await eng('src/engine/script/ScriptProvider.ts');
const { default: ScriptRunner } = await eng('src/engine/script/ScriptRunner.ts');
const { default: ScriptState } = await eng('src/engine/script/ScriptState.ts');
const { default: ServerTriggerType } = await eng('src/engine/script/ServerTriggerType.ts');
const { PlayerStat } = await eng('src/engine/entity/PlayerStat.ts');
assert(ScriptProvider.load(PACK_DIR) > 0, 'packed scripts must load');
World.currentTick = 1;
const inv = InvType.getId('inv');
const worn = InvType.getId('worn');
assert(inv >= 0 && worn >= 0, 'packed inventory identities');
const bonuses = ['stabattack', 'slashattack', 'crushattack', 'magicattack', 'rangeattack', 'stabdefence', 'slashdefence', 'crushdefence', 'magicdefence', 'rangedefence', 'strengthbonus', 'prayerbonus', 'rangebonus'];
const bonusScript = ScriptProvider.getByName('[proc,equip_get_bonuses]');
assert(bonusScript, 'packed equipment bonus calculation');
assert.equal(expected.length, 113, 'complete assigned scope, including five authorised blue Mystic rows');
assert.equal(new Set(expected.map(row => row.name)).size, expected.length, 'unique source cases');

function attempt(row, base = row.requirements, quests = row.quests, boosted = false) {
  const id = ObjType.getId(row.name);
  assert(id >= 0, `${row.name}: packed identity`);
  const type = ObjType.get(id);
  assert.equal(type.iop[1], row.inventory_option ?? 'Wear', `${row.name}: real inventory option two`);
  const player = new Player('armourrowtest', 0n, 0n);
  player.uid = 1;
  player.pid = 1;
  player.baseLevels.fill(1);
  player.levels.fill(boosted ? 99 : 1);
  for (const [stat, level] of Object.entries(base)) {
    const statId = PlayerStat[stat.toUpperCase()];
    assert.notEqual(statId, undefined, `${row.name}: known skill ${stat}`);
    player.baseLevels[statId] = level;
    if (!boosted) player.levels[statId] = level;
  }
  for (const [name, value] of Object.entries(quests)) {
    const varp = VarPlayerType.getId(name);
    assert(varp >= 0, `${row.name}: packed quest ${name}`);
    player.setVar(varp, value);
  }
  if (row.position) [player.x, player.z, player.level] = row.position;
  player.write = () => {};
  player.messageGame = () => {};
  player.wrappedMessageGame = () => {};
  player.invSet(inv, id, 1, 0);
  player.lastItem = id;
  player.lastSlot = 0;
  const handler = ScriptProvider.getByTrigger(ServerTriggerType.OPHELD2, id, type.category);
  assert(handler, `${row.name}: packed type/category/global wear dispatch`);
  assert.equal(player.runScript(ScriptRunner.init(handler, player), true, true), ScriptState.FINISHED, `${row.name}: wear handler finishes`);
  return { player, type };
}

function refused(row, base, quests, label) {
  const { player, type } = attempt(row, base, quests, true);
  assert.equal(player.invTotal(inv, type.id), 1, `${row.name} ${label}: item retained`);
  assert.equal(player.invTotal(worn, type.id), 0, `${row.name} ${label}: not worn`);
}

let failures = 0;
let refusals = 0;
for (const row of expected) {
  try {
    for (const [stat, minimum] of Object.entries(row.requirements)) {
      refused(row, { ...row.requirements, [stat]: minimum - 1 }, row.quests, `${stat} one below with boosted current level`);
      refusals++;
    }
    for (const [quest, minimum] of Object.entries(row.quests)) {
      refused(row, row.requirements, { ...row.quests, [quest]: minimum - 1 }, `${quest} one below`);
      refusals++;
    }
    const { player, type } = attempt(row);
    assert.equal(player.invTotal(inv, type.id), 0, `${row.name}: wear removes inventory item`);
    assert.equal(player.invGetSlot(worn, type.wearpos)?.id, type.id, `${row.name}: actual worn slot`);
    assert.equal(player.invTotal(worn, type.id), 1, `${row.name}: wear conserves item`);
    const state = ScriptRunner.init(bonusScript, player);
    assert.equal(player.runScript(state, true, true), ScriptState.FINISHED, `${row.name}: equipment calculation finishes`);
    const actual = state.intStack.slice(0, state.isp);
    assert.equal(actual.length, bonuses.length, `${row.name}: complete bonus tuple`);
    for (const [index, name] of bonuses.entries()) {
      if (Object.hasOwn(row.bonuses, name)) assert.equal(actual[index], row.bonuses[name], `${row.name}: worn ${name}`);
      // No scoped item supplies ranged strength. This checks the engine default,
      // not a historical claim for an unsupported numeric field.
      else if (name === 'rangebonus') assert.equal(actual[index], 0, `${row.name}: no ranged-strength contribution`);
    }
    console.log(`PASS ${row.name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${row.name}: ${error.stack ?? error}`);
  }
}
console.log(`ARMOUR_ROWS ${expected.length} PASS ${expected.length - failures} FAIL ${failures} REFUSALS ${refusals}`);
console.log(failures ? 'RESULT FAIL' : 'RESULT PASS');
// World owns background workers; no server was started.
process.exit(failures ? 1 : 0);
