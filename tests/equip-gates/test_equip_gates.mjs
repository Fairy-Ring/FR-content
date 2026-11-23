#!/usr/bin/env node
// Executes the same packed type/category/global lookup as an inventory operation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ungatedWearReport } from './wear_scan.mjs';

const CONTENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_ROOT = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_ROOT, '../engine');
const PACK_DIR = path.join(ENGINE_ROOT, 'data/pack');
assert(fs.existsSync(path.join(PACK_DIR, 'server/script.dat')), 'build the sibling engine first');
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
const viking = VarPlayerType.getId('viking');
assert(inv >= 0 && worn >= 0 && viking >= 0, 'required packed inventory/quest identities');
const generic = 'You are not a high enough level to use this item.';
const questMessage = ['Only Fremenniks are worthy of wearing this helm.', 'You need to complete The Fremennik Trials first.'];
const defence = level => [generic, `You need to have a defence level of ${level}.`];
const ranged = level => [generic, `You need to have a Ranged level of ${level}.`];
const magic = level => [generic, `You need to have a Magic level of ${level}.`];
const staff = level => [generic, `You need to have a Magic level of ${level} and an Attack level of ${level}.`];
const cases = [
  ['black_plateskirt_gold', 3473, { DEFENCE: 10 }, defence(10)],
  ['black_plateskirt_trim', 3472, { DEFENCE: 10 }, defence(10)],
  ['black_dart', 3093, { RANGED: 10 }, ranged(10)],
  ['black_dart_p', 3094, { RANGED: 10 }, ranged(10)],
  ['boots_wizard', 2579, { MAGIC: 20 }, magic(20)],
  ['viking_sword', 3757, { ATTACK: 30 }, [generic, 'You need to have an attack level of 30.'], true],
  ['viking_helmet', 3748, { DEFENCE: 30 }, defence(30), true],
  // Keep completed: RS wiki rev84110 (2007-03-17) outranks the later OSRS started claim.
  ['viking_shield', 3758, { DEFENCE: 30 }, defence(30), true],
  ['adamant_plateskirt_trim', 3474, { DEFENCE: 30 }, defence(30)],
  ['adamant_plateskirt_gold', 3475, { DEFENCE: 30 }, defence(30)],
  ['lava_battlestaff', 3053, { MAGIC: 30, ATTACK: 30 }, staff(30)],
  ['rune_plateskirt_trim', 3477, { DEFENCE: 40 }, defence(40)],
  ['rune_plateskirt_gold', 3476, { DEFENCE: 40 }, defence(40)],
  ['rune_plateskirt_guthix', 3480, { DEFENCE: 40 }, defence(40)],
  ['rune_plateskirt_saradomin', 3479, { DEFENCE: 40 }, defence(40)],
  ['rune_plateskirt_zamorak', 3478, { DEFENCE: 40 }, defence(40)],
  ['mystic_lava_staff', 3054, { MAGIC: 40, ATTACK: 40 }, staff(40)],
  ['granite_shield', 3122, { DEFENCE: 50, STRENGTH: 50 }, [generic, 'You need to have Defence and Strength levels of 50.']],
  ['tbwt_dragon_spear_kp', 3176, { ATTACK: 60 }, [generic, 'You need to have an Attack level of 60.']]
];

function attempt(row, levels, questStage) {
  const [name, id] = row;
  assert.equal(ObjType.getId(name), id, `${name}: revision-377 cache identity`);
  const type = ObjType.get(id);
  assert(['Wear', 'Wield'].includes(type.iop[1]), `${name}: second inventory option is Wear/Wield`);
  const player = new Player('equipgatetest', 0n, 0n);
  player.uid = 1;
  player.pid = 1;
  player.baseLevels.fill(1);
  player.levels.fill(1);
  for (const [stat, level] of Object.entries(levels)) {
    player.baseLevels[PlayerStat[stat]] = level;
    player.levels[PlayerStat[stat]] = level;
  }
  player.setVar(viking, questStage);
  player.messages = [];
  player.write = packet => { if (typeof packet.text === 'string') player.messages.push(packet.text); };
  player.messageGame = text => player.messages.push(text);
  player.wrappedMessageGame = text => player.messages.push(text);
  player.invSet(inv, id, 1, 0);
  player.lastItem = id;
  player.lastSlot = 0;
  const handler = ScriptProvider.getByTrigger(ServerTriggerType.OPHELD2, id, type.category);
  assert(handler, `${name}: packed inventory dispatch`);
  const state = ScriptRunner.init(handler, player);
  assert.equal(player.runScript(state, true, true), ScriptState.FINISHED, `${name}: packed handler finishes`);
  return { player, type, handler: handler.name };
}
function refused(row, levels, questStage, expected, label) {
  const { player, type, handler } = attempt(row, levels, questStage);
  assert.equal(player.invTotal(inv, type.id), 1, `${row[0]} ${label}: refusal must retain the inventory item (handler ${handler})`);
  assert.equal(player.invTotal(worn, type.id), 0, `${row[0]} ${label}: refusal must not equip`);
  for (const text of expected) assert(player.messages.includes(text), `${row[0]} ${label}: missing refusal ${JSON.stringify(text)}; got ${JSON.stringify(player.messages)}`);
}
function equipped(row, levels, questStage) {
  const { player, type } = attempt(row, levels, questStage);
  assert.equal(player.invTotal(inv, type.id), 0, `${row[0]}: successful wear removes the inventory item`);
  assert.equal(player.invGetSlot(worn, type.wearpos)?.id, type.id, `${row[0]}: successful wear uses the actual worn slot`);
  assert.equal(player.invTotal(worn, type.id), 1, `${row[0]}: successful wear conserves the item`);
  for (const text of [...row[3], ...questMessage]) {
    assert(!player.messages.includes(text), `${row[0]}: no refusal at the requirement`);
  }
}

let failures = 0;
for (const row of cases) {
  try {
    const [, , requirements, messages, quest] = row;
    // An audit-row failure must be behavioral even before the item-specific trigger exists.
    refused(row, {}, 0, quest ? questMessage : messages, 'level 1/no quest');
    for (const [stat, threshold] of Object.entries(requirements)) {
      refused(row, { ...requirements, [stat]: threshold - 1 }, quest ? 10 : 0, messages, `${stat} one below`);
    }
    if (quest) {
      refused(row, requirements, 0, questMessage, 'qualified stats without quest');
      if (row[0] === 'viking_shield') refused(row, requirements, 1, questMessage, 'started is not completed (near-target source)');
      refused(row, requirements, 9, questMessage, 'quest one stage below completion');
    }
    equipped(row, requirements, quest ? 10 : 0);
    console.log(`PASS ${row[0]}: refusal, independent stat boundaries${quest ? ', published quest completion boundary' : ''}, and wear`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${row[0]}: ${error.message}`);
  }
}
console.log(`EQUIPMENT_ROWS ${cases.length} PASS ${cases.length - failures} FAIL ${failures}`);
// Report only: out-of-scope missing handlers do not weaken the behavioral assertions above.
const report = ungatedWearReport(ObjType, ScriptProvider, ServerTriggerType);
console.log(`UNGATED_WEAR_REPORT ${JSON.stringify(report)}`);
console.log(failures ? 'RESULT FAIL' : 'RESULT PASS (19 packed equipment gates; helper exercised by granite shield)');
// World owns background workers; no server was started.
process.exit(failures ? 1 : 0);
