#!/usr/bin/env node
// Packed-map RFD Dwarf route: native guest, NPC, item, and ground-object actions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  World, PlayerStat, ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType, types,
  nativeLoc, nativeLocRows, nativeNpc, locFor, stand, operate, talk, useItems, useLoc,
  run, player, give, count, bit, setBit, setVar, id, worn, bank, remove, clear, load, capture, text
} from './runtime.mjs';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const config = path.join(content, 'scripts/quests/quest_100/configs');
const dwarfConstants = fs.readFileSync(path.join(config, 'rfd_dwarf.constant'), 'utf8');
const hubConstants = fs.readFileSync(path.join(config, 'rfd_hub.constant'), 'utf8');
const questConstants = fs.readFileSync(path.join(content, 'scripts/general/configs/quest.constant'), 'utf8');
function constant(source, name) {
  const match = source.match(new RegExp(`^\\^${name}\\s*=\\s*(\\d+)\\s*$`, 'm'));
  assert(match, `checked-out ${name} constant exists`);
  return Number(match[1]);
}
function coordConstant(source, name) {
  const match = source.match(new RegExp(`^\\^${name}\\s*=\\s*([0-3]_\\d+_\\d+_\\d+_\\d+)\\s*$`, 'm'));
  assert(match, `checked-out ${name} coordinate exists`);
  const [level, mapX, mapZ, localX, localZ] = match[1].split('_').map(Number);
  return [level, mapX * 64 + localX, mapZ * 64 + localZ];
}
const stage = name => constant(dwarfConstants, name);
const tableTile = coordConstant(dwarfConstants, 'rfd_dwarf_cake_table_coord');
const tableRow = nativeLocRows('bigtable2').find(row =>
  row.level === tableTile[0] && row.x === tableTile[1] && row.z === tableTile[2]);
assert(tableRow, 'cake spawn coordinate is an original bigtable2 map tile');
const table = locFor(tableRow);
const hotId = types.ObjType.getId('hundred_dwarf_hot_rockcake');
const groundTakeOption = types.ObjType.get(hotId).op.findIndex(option => option === 'Take') + 1;
assert.equal(groundTakeOption, 3, 'packed hot cake exposes the native Take option 3');
const OpObj = await load('network/game/client/model/OpObj.ts');
const OpObjHandler = await load('network/game/client/handler/OpObjHandler.ts');
const takeObject = new OpObjHandler();
const engine = path.resolve(content, '../engine');
const { NpcStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/NpcStat.ts')).href);

function groundCake(p) {
  return World.getObj(tableTile[1], tableTile[2], tableTile[0], hotId, p.hash64);
}
let cakeStand = null;

function takeHotCake(p) {
  const ground = groundCake(p);
  assert(ground, 'the player-owned hot cake exists on the packed table tile');
  const selectedStand = stand(p, table);
  if (cakeStand === null) cakeStand = selectedStand;
  assert(p.inOperableDistance(ground), 'a collision-safe tile beside the packed table reaches the cake');
  capture(p, () => {
    assert(takeObject.handle(new OpObj(groundTakeOption, ground.x, ground.z, ground.type), p),
      'production OpObj accepts the cake from beside the table');
    assert.equal(p.getOpTrigger()?.name, '[opobj3,hundred_dwarf_hot_rockcake]', 'native Take resolves the direct option-3 entry');
    p.processInteraction();
  });
  assert(ScriptProvider.getByName('[apobj3,hundred_dwarf_hot_rockcake]'), 'native approach option-3 recovery is compiled');
}
function killIcefiend(p) {
  const icefiend = nativeNpc('slayer_icefiend_1', rows => rows.find(row => row.x === 2995 && row.z === 3468));
  stand(p, icefiend);
  const type = types.NpcType.get(icefiend.type);
  const script = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, type.id, type.category);
  assert.equal(script?.name, '[ai_queue3,slayer_icefiend_1]', 'real packed Icefiend has its native death hook');
  icefiend.heroPoints.clear();
  icefiend.heroPoints.addHero(p.hash64, icefiend.levels[NpcStat.HITPOINTS]);
  const state = ScriptRunner.init(script, icefiend);
  icefiend.applyDamage(icefiend.levels[NpcStat.HITPOINTS], 1);
  icefiend.executeScript(state);
  for (let step = 0; state.execution === ScriptState.NPC_SUSPENDED && step < 40; step++) {
    p.processQueues();
    World.currentTick = Math.max(World.currentTick + 1, icefiend.delayedUntil);
    icefiend.delayed = false;
    icefiend.executeScript(state);
  }
  p.processQueues();
  assert.equal(state.execution, ScriptState.FINISHED, 'native Icefiend death settles');
  assert(World.getObj(icefiend.x, icefiend.z, icefiend.level, types.ObjType.getId('ashes'), p.hash64),
    'the original Icefiend ashes drop survives the RFD cooling hook');
}

// Inspect is the guest start; an invitation alone or an incomplete Fishing Contest cannot start it.
const locked = player();
setBit(locked, 'hundred_main_quest_var', constant(hubConstants, 'rfd_feast_ready'));
setVar(locked, 'fishingcompo', constant(questConstants, 'fishingcompo_complete'));
setBit(locked, '100dwarfvisible', 1);
operate(locked, nativeLoc('hundred_dwarf_ambassador_base'), 1);
assert.equal(bit(locked, 'hundred_dwarf_quest'), 0, 'Inspect before the frozen feast does not skip ahead');

const incompleteContest = player();
setBit(incompleteContest, 'hundred_main_quest_var', constant(hubConstants, 'rfd_frozen'));
setVar(incompleteContest, 'fishingcompo', constant(questConstants, 'fishingcompo_complete') - 1);
setBit(incompleteContest, '100dwarfvisible', 1);
operate(incompleteContest, nativeLoc('hundred_dwarf_ambassador_base'), 1);
assert.equal(bit(incompleteContest, 'hundred_dwarf_quest'), 0, 'Fishing Contest is a real start prerequisite');

const p = player();
setBit(p, 'hundred_main_quest_var', constant(hubConstants, 'rfd_frozen'));
setVar(p, 'fishingcompo', constant(questConstants, 'fishingcompo_complete'));
setBit(p, '100dwarfvisible', 1);
give(p, 'coins', 312);
operate(p, nativeLoc('hundred_dwarf_ambassador_base'), 1);
assert.equal(bit(p, 'hundred_dwarf_quest'), stage('rfd_dwarf_inspected'));
const aris = nativeNpc('hundred_aris');
talk(p, aris, [1]);
assert.equal(bit(p, 'hundred_dwarf_quest'), stage('rfd_dwarf_aris_spoken'), 'actual Aris Talk-to choice 1 advances the dwarf route');
const dad = nativeNpc('hundred_dwarf_dad_multi', rows => rows.find(row => row.x === 2865 && row.z === 9876));
talk(p, dad);
assert.equal(bit(p, 'hundred_dwarf_quest'), stage('rfd_dwarf_father_spoken'));
assert.equal(bit(p, 'hundred_dwarf_multi_dad'), 1, 'the original multi changes to Rohak');
const barmaid = nativeNpc('risingsun_barmaid');
talk(p, barmaid, [1]);
assert.equal(bit(p, 'hundred_dwarf_quest'), stage('rfd_dwarf_recipe_paid'));
assert.equal(count(p, 'coins'), 112, 'barmaid charges the verified 200-coin recipe fee');
for (let ale = 0; ale < 4; ale++) {
  talk(p, barmaid, [1]);
  assert.equal(count(p, 'asgarnian_ale'), ale + 1, 'the existing pub menu sells each ordinary ale');
}
for (let ale = 0; ale < 4; ale++) {
  useItems(p, 'coins', 'asgarnian_ale');
  assert.equal(count(p, 'hundred_dwarf_asgarnian_ale'), ale + 1, 'one coin on one ale makes one gold ale');
}
assert.equal(count(p, 'coins'), 100, 'four ales and four added coins use the sourced route quantities');
talk(p, dad);
assert.equal(bit(p, 'hundred_dwarf_quest'), stage('rfd_dwarf_rohak_drunk'));
assert.equal(bit(p, 'hundred_dwarf_multi_dad'), 2, 'Rohak moves to the original drunk morph');
const drunk = nativeNpc('hundred_dwarf_drunk_multi', rows => rows.find(row => row.x === 2865 && row.z === 9877));
give(p, 'bucket_milk');
give(p, 'pot_flour');
give(p, 'egg');
give(p, 'bowl_water');
talk(p, drunk);
assert.equal(bit(p, 'hundred_dwarf_quest'), stage('rfd_dwarf_cake_table'));
assert.equal(count(p, 'bucket_milk'), 0);
assert.equal(count(p, 'pot_flour'), 0);
assert.equal(count(p, 'egg'), 0);
assert.equal(count(p, 'bowl_water'), 0);
assert(groundCake(p), 'Rohak places the original hot cake on the map-derived table tile');

// A despawn is recoverable through Rohak; the test removes only the product-created private drop.
const expiredCake = groundCake(p);
World.removeObj(expiredCake, 0);
assert.equal(groundCake(p), null, 'the cake has despawned from its table tile');
talk(p, drunk);
assert(groundCake(p), 'Rohak restores the missing cake without duplicating a live drop');

// Take remains native and reachable across the table; bare hands do not consume the hot cake.
takeHotCake(p);
assert.equal(bit(p, 'hundred_dwarf_quest'), stage('rfd_dwarf_cake_table'));
assert.equal(count(p, 'hundred_dwarf_hot_rockcake'), 0);
assert(groundCake(p), 'a failed bare-handed take leaves the hot cake in the world');
give(p, 'bronze_dagger', 28);
takeHotCake(p);
assert.equal(count(p, 'hundred_dwarf_hot_rockcake'), 0, 'a full inventory cannot take the cake');
assert(groundCake(p), 'a full inventory leaves the private table cake intact');
clear(p);
give(p, 'ice_gloves', 1, worn);
takeHotCake(p);
assert.equal(bit(p, 'hundred_dwarf_quest'), stage('rfd_dwarf_cool_cake'), 'worn Ice Gloves cool the cake during native Take');
assert.equal(count(p, 'hundred_dwarf_cool_rockcake'), 1);
assert.equal(groundCake(p), null);

// Loss after cooling recovers a new private table cake, but a banked cake is not duplicated.
remove(p, 'hundred_dwarf_cool_rockcake');
give(p, 'hundred_dwarf_cool_rockcake', 1, bank);
talk(p, drunk);
assert.equal(groundCake(p), null, 'a banked cool cake prevents duplicate recovery');
remove(p, 'hundred_dwarf_cool_rockcake', bank);
give(p, 'hundred_dwarf_hot_rockcake', 1, bank);
talk(p, drunk);
assert.equal(bit(p, 'hundred_dwarf_quest'), stage('rfd_dwarf_hot_cake'), 'a surviving banked hot cake restores the cooling route after cool-cake loss');
assert.equal(groundCake(p), null, 'a banked hot cake is recovered, not duplicated');
remove(p, 'hundred_dwarf_hot_rockcake', bank);
talk(p, drunk);
assert(groundCake(p), 'losing a cooled cake is recoverable without new ingredients or fees');
takeHotCake(p);
assert.equal(count(p, 'hundred_dwarf_cool_rockcake'), 1);
run(p, '[proc,update_questpoints]');
const questPointsBefore = p.getVar(id('VarPlayerType', 'qp'));
const frozenDwarf = nativeLoc('hundred_dwarf_ambassador_base');
const tallyBefore = bit(p, 'hundred_subquest_tally');
const slayerXpBefore = p.stats[PlayerStat.SLAYER];
const cookingXpBefore = p.stats[PlayerStat.COOKING];
useLoc(p, 'hundred_dwarf_cool_rockcake', frozenDwarf);
assert.equal(bit(p, 'hundred_dwarf_quest'), constant(hubConstants, 'rfd_guest_complete'), 'terminal stage is written before reward');
assert.equal(bit(p, '100dwarfvisible'), 0, 'the common reward unfreezes the guest');
assert.equal(bit(p, 'hundred_subquest_tally'), tallyBefore + 1);
assert.equal(p.stats[PlayerStat.SLAYER] - slayerXpBefore, 10000, 'period reward is exactly 1000 Slayer XP in tenths');
assert.equal(p.stats[PlayerStat.COOKING] - cookingXpBefore, 10000, 'period reward is exactly 1000 Cooking XP in tenths');
assert.equal(p.getVar(id('VarPlayerType', 'qp')), questPointsBefore + 1, 'period reward is exactly one quest point');
run(p, '[proc,rfd_guest_reward]', { args: [1] });
assert.equal(bit(p, 'hundred_subquest_tally'), tallyBefore + 1, 'the shared reward remains once-only');
assert.equal(p.stats[PlayerStat.SLAYER], slayerXpBefore + 10000, 'repeated reward gives no more Slayer XP');
assert.equal(p.stats[PlayerStat.COOKING], cookingXpBefore + 10000, 'repeated reward gives no more Cooking XP');
assert.equal(p.getVar(id('VarPlayerType', 'qp')), questPointsBefore + 1, 'repeated reward gives no more quest points');
for (const name of ['hundred_dwarf_asgarnian_ale', 'hundred_dwarf_hot_rockcake', 'hundred_dwarf_cool_rockcake']) {
  assert.equal(types.ObjType.get(types.ObjType.getId(name)).tradeable, false, `${name} cannot be traded or stolen`);
}

const poor = player();
setBit(poor, 'hundred_dwarf_quest', stage('rfd_dwarf_father_spoken'));
give(poor, 'coins', 199);
give(poor, 'ring_of_charos_unlocked');
talk(poor, barmaid, [4]);
assert.equal(bit(poor, 'hundred_dwarf_quest'), stage('rfd_dwarf_father_spoken'), 'an unworn ring does not waive an unaffordable recipe fee');
assert.equal(count(poor, 'coins'), 199, 'a rejected recipe purchase consumes no coins');
assert.match(text(poor), /what ales are you serving/i, 'an unaffordable recipe does not block the normal bar menu');
talk(poor, barmaid, [1]);
assert.equal(count(poor, 'asgarnian_ale'), 1, 'a poor player can still buy an ordinary ale');
assert.equal(count(poor, 'coins'), 197);
assert.equal(bit(poor, 'hundred_dwarf_quest'), stage('rfd_dwarf_father_spoken'));

for (const affordable of [false, true]) {
  const barcrawl = player();
  setBit(barcrawl, 'hundred_dwarf_quest', stage('rfd_dwarf_father_spoken'));
  give(barcrawl, 'coins', affordable ? 312 : 199);
  give(barcrawl, 'barcrawl_card');
  talk(barcrawl, barmaid, affordable ? [2, 2] : [2]);
  assert.notEqual(barcrawl.getVar(id('VarPlayerType', 'barcrawl')), 0, 'the normal Barcrawl branch still signs the card');
  assert.equal(count(barcrawl, 'coins'), (affordable ? 312 : 199) - 70, 'Barcrawl charges only its original price');
  assert.equal(bit(barcrawl, 'hundred_dwarf_quest'), stage('rfd_dwarf_father_spoken'), 'Barcrawl does not purchase the Dwarf recipe');
}

const declined = player();
setBit(declined, 'hundred_dwarf_quest', stage('rfd_dwarf_father_spoken'));
give(declined, 'coins', 312);
talk(declined, barmaid, [2, 1]);
assert.equal(count(declined, 'asgarnian_ale'), 1, 'declining the Dwarf topic reaches the ordinary ale menu');
assert.equal(count(declined, 'coins'), 310, 'declining the topic does not charge the recipe fee');
assert.equal(bit(declined, 'hundred_dwarf_quest'), stage('rfd_dwarf_father_spoken'));

// The worn ring waives only the separate recipe fee; it is not a purchase or inventory check.
const ringCase = player();
setBit(ringCase, 'hundred_dwarf_quest', stage('rfd_dwarf_father_spoken'));
give(ringCase, 'ring_of_charos_unlocked', 1, worn);
give(ringCase, 'coins', 17);
talk(ringCase, barmaid, [1]);
assert.equal(bit(ringCase, 'hundred_dwarf_quest'), stage('rfd_dwarf_recipe_paid'));
assert.equal(count(ringCase, 'coins'), 17);

// The alternate period route starts with a carried hot cake and cools it on a real Icefiend death.
const cooler = player();
setBit(cooler, 'hundred_dwarf_quest', stage('rfd_dwarf_hot_cake'));
give(cooler, 'hundred_dwarf_hot_rockcake');
give(cooler, 'leather_gloves', 1, worn);
killIcefiend(cooler);
assert.equal(bit(cooler, 'hundred_dwarf_quest'), stage('rfd_dwarf_cool_cake'));
assert.equal(count(cooler, 'hundred_dwarf_hot_rockcake'), 0);
assert.equal(count(cooler, 'hundred_dwarf_cool_rockcake'), 1);

console.log(`PASS RFD Mountain Dwarf inspect, native guest route, recipe, recovery, rock cake and once-only reward; cake stand ${cakeStand.join(',')}`);
process.exit(0);
