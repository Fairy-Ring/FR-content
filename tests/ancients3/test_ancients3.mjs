#!/usr/bin/env node
// Compiled Ancient autocast, weapon lifecycle, attack continuation and quest reward.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ancientSpells,
  book,
  desertTreasure,
  observatoryReward,
  pickerButtons,
  standardProbe,
  zarosStaffClient,
  zarosStaffCombat,
} from './oracle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const content = path.resolve(here, '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = async relative => import(pathToFileURL(path.join(engine, relative)).href);
const assertFullPack = fs.existsSync(path.join(pack, 'server', 'script.dat'));
assert(assertFullPack, `compiled pack required at ${pack}`);

const World = (await load('src/engine/World.ts')).default;
const Provider = (await load('src/engine/script/ScriptProvider.ts')).default;
const Runner = (await load('src/engine/script/ScriptRunner.ts')).default;
const State = (await load('src/engine/script/ScriptState.ts')).default;
const Trigger = (await load('src/engine/script/ServerTriggerType.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const Npc = (await load('src/engine/entity/Npc.ts')).default;
const Loc = (await load('src/engine/entity/Loc.ts')).default;
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { Interaction } = await load('src/engine/entity/Interaction.ts');
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const Environment = (await load('src/util/Environment.ts')).default;
const ZoneMap = (await load('src/engine/zone/ZoneMap.ts')).default;
const { CoordGrid } = await load('src/engine/CoordGrid.ts');
const IfButton = (await load('src/network/game/client/model/IfButton.ts')).default;
const IfButtonHandler = (await load('src/network/game/client/handler/IfButtonHandler.ts')).default;
const IfSetModel = (await load('src/network/game/server/model/IfSetModel.ts')).default;
const IfSetText = (await load('src/network/game/server/model/IfSetText.ts')).default;

const types = {};
for (const name of [
  'Component', 'DbRowType', 'DbTableType', 'DbTableIndex', 'InvType', 'LocType',
  'CategoryType', 'EnumType', 'NpcType', 'ObjType', 'ParamType', 'VarBitType', 'VarNpcType', 'VarPlayerType',
]) {
  if (name === 'DbTableIndex') continue;
  types[name] = (await load(`src/cache/config/${name}.ts`)).default;
  types[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
assert.equal(Environment.NODE_PRODUCTION, false, 'use the non-production script error policy');
Environment.NODE_MEMBERS = true;
assert(Provider.load(pack) > 0, 'load the packed scripts');
World.gameMap.init();
World.npcs.reset();
for (const request of World.npcEventQueue.all()) request.unlink();
World.currentTick = 1000;

const id = (kind, name) => {
  const value = types[kind].getId(name);
  assert(value >= 0, `missing ${kind}:${name}`);
  return value;
};
const table = types.DbTableType.getByName('magic_spell_table');
const row = name => types.DbRowType.getByName(`magic_spell_${name}`);
const values = (record, key) => record.getValue(table.columnNames.indexOf(key), 0);
const field = (record, key) => values(record, key)[0];
const variable = (player, key, value) => {
  const index = types.VarPlayerType.getId(key);
  if (index >= 0) return value === undefined ? player.getVar(index) : player.setVar(index, value);
  const bit = id('VarBitType', key);
  return value === undefined ? player.getVarBit(bit) : player.setVarBit(bit, value);
};
const npcVariable = (npc, key, value) => {
  const npcVar = id('VarNpcType', key);
  return value === undefined ? npc.getVar(npcVar) : npc.setVar(npcVar, value);
};
const runeNames = [
  'airrune', 'waterrune', 'earthrune', 'firerune', 'mindrune', 'chaosrune',
  'deathrune', 'bloodrune', 'soulrune', 'naturerune',
];
const wornId = id('InvType', 'worn');
const inventoryId = id('InvType', 'inv');
const buttonHandler = new IfButtonHandler();
const spellByName = new Map(ancientSpells.map(spell => [spell.name, spell]));
const ancientRoot = id('Component', 'questscroll_itgronigen');
const standardRoot = id('Component', 'staff_spells');
let playerSerial = 0;

function run(player, name, args = [], target = null) {
  const script = Provider.getByName(name);
  assert(script, `missing packed trigger ${name}`);
  const state = Runner.init(script, player, target, args);
  const result = player.runScript(state, true, true);
  assert.equal(result, State.FINISHED, `${name} did not finish: ${player.messages.join(' | ')}`);
  return state;
}

function click(player, componentName) {
  const component = id('Component', componentName);
  const trigger = Provider.getByTrigger(Trigger.IF_BUTTON, component, -1);
  assert(trigger, `missing IF_BUTTON dispatch for ${componentName}`);
  assert.equal(trigger.name, `[if_button,${componentName}]`);
  assert.equal(buttonHandler.handle(new IfButton(component), player), true,
    `${componentName} must be visible to the real IfButtonHandler`);
  return trigger;
}

function makePlayer() {
  const slot = ++playerSerial;
  const player = new Player(`ancients3_${slot}`, BigInt(slot), BigInt(slot));
  player.slot = player.pid = slot;
  player.uid = (slot << 11) | slot;
  player.isActive = true;
  player.level = 0;
  player.x = 3100 + ((slot - 1) % 4) * 20;
  player.z = 3800;
  player.originX = player.x;
  player.originZ = player.z;
  player.levels.fill(99);
  player.baseLevels.fill(99);
  player.stats.fill(130344310);
  player.stats[3] = 130344310;
  player.messages = [];
  player.packets = [];
  player.messageGame = player.wrappedMessageGame = text => player.messages.push(String(text));
  player.write = packet => player.packets.push(packet);
  World.players[slot] = player;
  World.playerLoop.add(player.hash64, player);
  variable(player, 'tutorial', 1000);
  variable(player, 'deserttreasure', desertTreasure.incomplete);
  variable(player, 'alternate_spells', book.ancient);
  variable(player, 'com_magicattack', 100000);
  variable(player, 'com_magicdef', 1000);
  for (const rune of runeNames) player.invAdd(inventoryId, id('ObjType', rune), 100);
  return player;
}

function disposePlayer(player) {
  World.players[player.slot] = null;
  player.unlink();
  player.cleanup();
}

function equip(player, name, previous = null) {
  const weapon = types.ObjType.getByName(name);
  assert(weapon, `missing packed object ${name}`);
  player.invSet(wornId, weapon.id, 1, weapon.wearpos);
  run(player, '[proc,update_weapon_category]', [previous?.id ?? weapon.id]);
  run(player, '[proc,player_combat_stat]');
  return weapon;
}

function ancientRow(name) {
  const spell = spellByName.get(name);
  assert(spell, `missing oracle spell ${name}`);
  const record = row(name);
  assert(record, `missing packed spell row ${name}`);
  return { spell, record };
}

function selectAncient(player, entry) {
  click(player, 'combat_staff_2:auto_choose');
  assert(player.tabs.includes(ancientRoot), 'eligible Zaros staff opens the Ancient picker');
  click(player, `questscroll_itgronigen:com_${entry.widget}`);
  const { record } = ancientRow(entry.spell);
  assert.equal(variable(player, 'autocast_spell'), field(record, 'spell'),
    `${entry.spell} widget selects its packed spell id`);
}

function runeVector(player) {
  return Object.fromEntries(runeNames.map(name => [
    name,
    player.invTotal(inventoryId, id('ObjType', name)),
  ]));
}

function expectedRunes(before, spell, casts) {
  const expected = { ...before };
  for (const [name, amount] of spell.runes) expected[name] -= amount * casts;
  return expected;
}

function addNpc(player, x, z, { aggressive = false, hp = 200 } = {}) {
  const type = Array.from({ length: types.NpcType.count }, (_, index) => types.NpcType.get(index))
    .find(rowType => rowType?.name === 'Cow' && rowType.op?.[1] === 'Attack');
  assert(type, 'packed Cow Attack fixture exists');
  const npc = new Npc(player.level, x, z, type.size, type.size, EntityLifeCycle.RESPAWN,
    World.getNextNid(), type.id, type.blockwalk);
  World.addNpc(npc, -1);
  World.processNpcEventQueue();
  npc.lastMovement = World.currentTick - 100;
  npc.levels.fill(1);
  npc.baseLevels.fill(1);
  npc.levels[0] = npc.baseLevels[0] = 83;
  npc.levels[3] = npc.baseLevels[3] = hp;
  npcVariable(npc, 'npc_combat_xp_multiplier', 1000);
  if (aggressive) npcVariable(npc, 'npc_aggressive_player', player.uid);
  return npc;
}

function tickWorld() {
  World.processWorld();
  World.processNpcEventQueue();
  World.processNpcs();
  World.processPlayers();
  World.currentTick++;
}

function npcAttackQueue(npc) {
  return [...npc.queue.all()].filter(request => request.queueId === Trigger.AI_QUEUE2);
}

function markMulti(fixture, entity) {
  const key = ZoneMap.zoneIndex(entity.x, entity.z, entity.level);
  if (!fixture.multiBefore.has(key)) {
    fixture.multiBefore.set(key,
      World.gameMap.isMulti(CoordGrid.packCoord(entity.level, entity.x, entity.z)));
  }
  World.gameMap.setMultiZone(key, true);
}

function disposeCombatFixture(fixture) {
  for (const [key, multi] of fixture.multiBefore) World.gameMap.setMultiZone(key, multi);
  for (const npc of fixture.npcs) World.removeNpc(npc, 0);
  disposePlayer(fixture.player);
}

function dispatchAttack(player, npc) {
  player.level = npc.level;
  player.x = npc.x - 1;
  player.z = npc.z;
  player.originX = player.x;
  player.originZ = player.z;
  player.setInteraction(Interaction.ENGINE, npc, Trigger.APNPC2);
  const script = player.getOpTrigger();
  assert(script, 'production Player Attack trigger resolves');
  assert.equal(script.name, '[opnpc2,_]', 'Attack uses the packed OPNPC2 route');
  player.processInteraction();
}

function fixtureFor(spellName, area) {
  const player = makePlayer();
  equip(player, 'staff_of_zaros');
  variable(player, 'deserttreasure', desertTreasure.complete);
  variable(player, 'alternate_spells', book.ancient);
  const entry = pickerButtons.find(button => button.spell === spellName);
  assert(entry, `picker oracle includes ${spellName}`);
  selectAncient(player, entry);
  click(player, 'combat_staff_2:auto_toggle');
  assert.equal(variable(player, 'autocast_set') & 1, 1, 'autocast is enabled by the real combat button');
  const primary = addNpc(player, player.x + 1, player.z, { aggressive: true });
  const npcs = [primary];
  if (area) npcs.push(addNpc(player, player.x + 2, player.z));
  const fixture = { player, npcs, primary, secondary: npcs[1] ?? null, multiBefore: new Map() };
  for (const entity of [player, ...npcs]) markMulti(fixture, entity);
  return fixture;
}

function awaitCasts(fixture, spell, count) {
  const { player, primary, secondary } = fixture;
  const { record } = ancientRow(spell.name);
  const baseXp = field(record, 'experience');
  const xpBefore = player.stats[6];
  const beforeRunes = runeVector(player);
  const beforePrimaryHp = primary.levels[3];
  const beforeSecondaryHp = secondary?.levels[3];

  for (let cast = 1; cast <= count; cast++) {
    const expected = expectedRunes(beforeRunes, spell, cast);
    for (let step = 0; step < 100 && JSON.stringify(runeVector(player)) !== JSON.stringify(expected); step++) {
      tickWorld();
    }
    assert.deepEqual(runeVector(player), expected, `${spell.name} pays exactly once for cast ${cast}`);
    assert(player.stats[6] - xpBefore >= baseXp * cast,
      `${spell.name} awards fresh Magic XP for cast ${cast}`);
  }

  assert(primary.levels[3] < beforePrimaryHp || npcAttackQueue(primary).length > 0,
    `${spell.name} reaches its primary NPC through the compiled APNPCT path`);
  if (secondary) {
    assert(secondary.levels[3] < beforeSecondaryHp || npcAttackQueue(secondary).length > 0,
      `${spell.name} area APNPCT reaches the nearby NPC`);
  }
}

function testStaffClientFields() {
  const staff = types.ObjType.getByName('staff_of_zaros');
  assert(staff, 'read the one packed staff_of_zaros row, not a duplicate overlay');
  const modelIds = new Map(fs.readFileSync(path.join(content, 'pack', 'model.pack'), 'utf8').trim().split('\n')
    .map(line => [line.slice(line.indexOf('=') + 1), Number(line.slice(0, line.indexOf('=')))]));
  assert.equal(staff.name, zarosStaffClient.name);
  assert.equal(staff.desc, zarosStaffClient.desc);
  assert.equal(staff.members, zarosStaffClient.members);
  assert.equal(staff.model, modelIds.get(zarosStaffClient.model));
  assert.equal(staff.xof2d, zarosStaffClient.xof2d);
  assert.equal(staff.yof2d, zarosStaffClient.yof2d);
  assert.equal(staff.zoom2d, zarosStaffClient.zoom2d);
  assert.equal(staff.yan2d, zarosStaffClient.yan2d);
  assert.equal(staff.xan2d, zarosStaffClient.xan2d);
  assert.equal(staff.iop[1], zarosStaffClient.wield);
  assert.equal(staff.manwear, modelIds.get(zarosStaffClient.manwear));
  assert.equal(staff.manwearOffset, zarosStaffClient.manwearOffset);
  assert.equal(staff.womanwear, modelIds.get(zarosStaffClient.womanwear));
  assert.equal(staff.womanwearOffset, zarosStaffClient.womanwearOffset);
  assert.equal(staff.cost, zarosStaffClient.cost);
  assert.equal(staff.wearpos, types.ObjType.getWearPosId(zarosStaffClient.wearpos));
  assert.equal(staff.weight, Math.trunc(zarosStaffClient.weightLb * 453.592));
  assert.equal(staff.category, id('CategoryType', zarosStaffCombat.category),
    'packed staff stays in the existing weapon_staff category');
  for (const [name, expected] of Object.entries(zarosStaffCombat.params)) {
    assert.equal(staff.params.get(id('ParamType', name)), expected, `packed staff ${name} bonus`);
  }
}

function testPicker() {
  assert.equal(pickerButtons.length, 16);
  assert.deepEqual([...pickerButtons.map(button => button.spell)].sort(),
    [...spellByName.keys()].sort(), 'every independent U1/U2 Ancient row has one picker widget');

  const player = makePlayer();
  equip(player, 'staff_of_zaros');
  variable(player, 'deserttreasure', desertTreasure.complete);
  variable(player, 'alternate_spells', book.ancient);
  for (const entry of pickerButtons) {
    const { spell, record } = ancientRow(entry.spell);
    const pickerComponent = id('Component', `questscroll_itgronigen:com_${entry.widget}`);
    assert(pickerComponent >= 0);
    assert.equal(field(record, 'spellcom'), id('Component', `inter_267:com_${spell.widget}`));
    assert.equal(field(record, 'levelrequired'), spell.level);
    assert.equal(field(record, 'experience'), spell.xp * 10);
    assert.equal(field(record, 'continue_by_autocast'), 1,
      `${spell.name} continues through the existing autocast route`);
    selectAncient(player, entry);
  }
  disposePlayer(player);

  function rejectedSelection(label, targetButton, mutate) {
    const candidate = makePlayer();
    equip(candidate, 'staff_of_zaros');
    variable(candidate, 'deserttreasure', desertTreasure.complete);
    variable(candidate, 'alternate_spells', book.ancient);
    selectAncient(candidate, pickerButtons[0]);
    click(candidate, 'combat_staff_2:auto_choose');
    const priorSpell = variable(candidate, 'autocast_spell');
    mutate(candidate);
    const priorRunes = runeVector(candidate);
    click(candidate, `questscroll_itgronigen:com_${targetButton.widget}`);
    assert.equal(variable(candidate, 'autocast_spell'), priorSpell, `${label} does not replace the saved spell`);
    assert.deepEqual(runeVector(candidate), priorRunes, `${label} does not spend runes`);
    disposePlayer(candidate);
  }

  rejectedSelection('incomplete Desert Treasure', pickerButtons[7], candidate => {
    variable(candidate, 'deserttreasure', desertTreasure.incomplete);
  });
  rejectedSelection('Standard book', pickerButtons[2], candidate => {
    variable(candidate, 'alternate_spells', book.standard);
  });
  rejectedSelection('insufficient Magic level', pickerButtons[3], candidate => {
    candidate.levels[6] = ancientRow('ice_barrage').spell.level - 1;
  });
  rejectedSelection('missing spell rune', pickerButtons[4], candidate => {
    const spell = ancientRow('blood_rush').spell;
    const [rune, amount] = spell.runes[0];
    const runeId = id('ObjType', rune);
    candidate.invDel(inventoryId, runeId, candidate.invTotal(inventoryId, runeId) - amount + 1);
  });

  const regularStaff = makePlayer();
  equip(regularStaff, 'staff');
  variable(regularStaff, 'deserttreasure', desertTreasure.complete);
  variable(regularStaff, 'alternate_spells', book.ancient);
  click(regularStaff, 'combat_staff_2:auto_choose');
  assert(!regularStaff.tabs.includes(ancientRoot), 'ordinary weapon_staff cannot open the Ancient picker');
  disposePlayer(regularStaff);

  const stalePicker = makePlayer();
  const zaros = equip(stalePicker, 'staff_of_zaros');
  variable(stalePicker, 'deserttreasure', desertTreasure.complete);
  variable(stalePicker, 'alternate_spells', book.ancient);
  selectAncient(stalePicker, pickerButtons[0]);
  click(stalePicker, 'combat_staff_2:auto_choose');
  const saved = variable(stalePicker, 'autocast_spell');
  const plainStaff = types.ObjType.getByName('staff');
  assert(plainStaff && plainStaff.category === zaros.category, 'fixture staff shares the weapon_staff category');
  stalePicker.invSet(wornId, plainStaff.id, 1, plainStaff.wearpos);
  click(stalePicker, `questscroll_itgronigen:com_${pickerButtons[3].widget}`);
  assert.equal(variable(stalePicker, 'autocast_spell'), saved,
    'a stale Ancient button cannot select for an ordinary staff');
  disposePlayer(stalePicker);

  for (const weaponName of ['staff_of_zaros', 'staff']) {
    const standard = makePlayer();
    equip(standard, weaponName);
    variable(standard, 'alternate_spells', book.standard);
    click(standard, 'combat_staff_2:auto_choose');
    assert(standard.tabs.includes(standardRoot), `${weaponName} retains the Standard picker`);
    click(standard, standardProbe.component);
    assert.equal(variable(standard, 'autocast_spell'), field(row(standardProbe.spell), 'spell'),
      `${weaponName} accepts a Standard spell`);
    disposePlayer(standard);
  }
}

function makeAltar(player) {
  const typeId = id('LocType', 'dt_zaros_altar');
  const type = types.LocType.get(typeId);
  const shape = type.shapes?.[0] ?? 10;
  const altar = new Loc(player.level, player.x + 1, player.z, type.width, type.length,
    EntityLifeCycle.DESPAWN, typeId, shape, 0);
  player.setInteraction(Interaction.ENGINE, altar, Trigger.OPLOC1);
  const script = player.getOpTrigger();
  assert(script, 'production Player OPLOC1 trigger resolves');
  assert.equal(script.name, '[oploc1,dt_zaros_altar]', 'altar interaction selects its real OPLOC1 script');
  run(player, script.name, [], altar);
}

function testLifecycle() {
  const player = makePlayer();
  equip(player, 'staff_of_zaros');
  variable(player, 'deserttreasure', desertTreasure.complete);
  variable(player, 'alternate_spells', book.ancient);
  selectAncient(player, pickerButtons[0]);
  const selected = variable(player, 'autocast_spell');
  click(player, 'combat_staff_2:auto_toggle');
  assert.equal(variable(player, 'autocast_set') & 1, 1);
  click(player, 'combat_staff_2:auto_choose');
  assert.equal(variable(player, 'autocast_set') & 1, 0, 'opening the picker disables autocast');
  assert.equal(variable(player, 'autocast_spell'), selected, 'opening the picker preserves the selection');
  click(player, 'questscroll_itgronigen:com_6');
  assert.equal(variable(player, 'autocast_spell'), selected, 'cancel preserves the saved spell');
  assert.equal(variable(player, 'autocast_set') & 1, 0, 'cancel keeps autocast disabled');
  assert(player.tabs.includes(id('Component', 'inter_267')), 'cancel restores the Ancient spellbook tab');

  click(player, 'combat_staff_2:auto_toggle');
  run(player, '[login,_]');
  assert.equal(variable(player, 'autocast_spell'), selected, 'valid Ancient selection survives login');
  assert.equal(variable(player, 'autocast_set') & 1, 1, 'valid enabled autocast survives login');
  assert(player.tabs.includes(id('Component', 'inter_267')), 'login restores the Ancient spellbook tab');

  const zaros = types.ObjType.getByName('staff_of_zaros');
  const plainStaff = types.ObjType.getByName('staff');
  assert(zaros && plainStaff && zaros.category === plainStaff.category);
  player.invSet(wornId, plainStaff.id, 1, plainStaff.wearpos);
  run(player, '[proc,update_weapon_category]', [zaros.id]);
  assert.notEqual(variable(player, 'autocast_spell'), selected,
    'same-category Zaros-to-ordinary staff change clears the Ancient selection');
  assert.equal(variable(player, 'autocast_set') & 1, 0, 'incompatible weapon clears enabled autocast');
  disposePlayer(player);

  const invalidLogin = makePlayer();
  equip(invalidLogin, 'staff_of_zaros');
  variable(invalidLogin, 'deserttreasure', desertTreasure.complete);
  variable(invalidLogin, 'alternate_spells', book.ancient);
  selectAncient(invalidLogin, pickerButtons[0]);
  variable(invalidLogin, 'alternate_spells', book.standard);
  run(invalidLogin, '[login,_]');
  assert.notEqual(variable(invalidLogin, 'autocast_spell'), field(row('ice_rush'), 'spell'),
    'login clears an Ancient selection incompatible with the saved Standard book');
  assert.equal(variable(invalidLogin, 'autocast_set') & 1, 0);
  assert(invalidLogin.tabs.includes(id('Component', 'magic')), 'login restores the Standard spellbook tab');
  disposePlayer(invalidLogin);

  const altarPlayer = makePlayer();
  equip(altarPlayer, 'staff_of_zaros');
  variable(altarPlayer, 'deserttreasure', desertTreasure.complete);
  variable(altarPlayer, 'alternate_spells', book.ancient);
  selectAncient(altarPlayer, pickerButtons[0]);
  makeAltar(altarPlayer);
  assert.equal(variable(altarPlayer, 'alternate_spells'), book.standard, 'OPLOC1 toggles to Standard');
  assert.notEqual(variable(altarPlayer, 'autocast_spell'), field(row('ice_rush'), 'spell'),
    'OPLOC1 clears Ancient autocast after changing books');
  assert(altarPlayer.tabs.includes(id('Component', 'magic')), 'OPLOC1 restores the Standard spellbook tab');
  disposePlayer(altarPlayer);
}

function testAttackContinuation() {
  const fixture = fixtureFor('ice_rush', false);
  const previousRandom = JavaRandom.nextDouble;
  JavaRandom.nextDouble = function () { return 0.5; };
  try {
    dispatchAttack(fixture.player, fixture.primary);
    awaitCasts(fixture, ancientRow('ice_rush').spell, 2);
    assert.equal(fixture.secondary, null, 'single-target fixture has no extra target');
  } finally {
    JavaRandom.nextDouble = previousRandom;
    disposeCombatFixture(fixture);
  }

  const areaFixture = fixtureFor('ice_burst', true);
  const oldRandom = JavaRandom.nextDouble;
  JavaRandom.nextDouble = function () { return 0.5; };
  try {
    dispatchAttack(areaFixture.player, areaFixture.primary);
    awaitCasts(areaFixture, ancientRow('ice_burst').spell, 2);
    assert.equal(areaFixture.secondary.levels[3] < 200 || npcAttackQueue(areaFixture.secondary).length > 0, true,
      'the published area APNPCT resolver reaches the adjacent secondary');
  } finally {
    JavaRandom.nextDouble = oldRandom;
    disposeCombatFixture(areaFixture);
  }
}

function testStandardFallback() {
  const player = makePlayer();
  equip(player, 'staff_of_zaros');
  variable(player, 'deserttreasure', desertTreasure.complete);
  variable(player, 'alternate_spells', book.standard);
  click(player, 'combat_staff_2:auto_choose');
  assert(player.tabs.includes(standardRoot));
  click(player, standardProbe.component);
  const standardSpell = field(row(standardProbe.spell), 'spell');
  assert.equal(variable(player, 'autocast_spell'), standardSpell, 'Zaros staff selects a Standard spell');
  click(player, 'combat_staff_2:auto_toggle');
  assert.equal(variable(player, 'autocast_set') & 1, 1);

  makeAltar(player);
  assert.equal(variable(player, 'alternate_spells'), book.ancient, 'real OPLOC1 toggles to Ancient');
  assert.notEqual(variable(player, 'autocast_spell'), standardSpell,
    'the book lifecycle clears incompatible Standard autocast');
  assert.equal(variable(player, 'autocast_set') & 1, 0);

  // Select a Standard spell again through its real picker, then attack after the
  // book is switched; the ordinary Attack path must silently use melee.
  variable(player, 'alternate_spells', book.standard);
  run(player, '[proc,dt_restore_spellbook]');
  click(player, 'combat_staff_2:auto_choose');
  click(player, standardProbe.component);
  click(player, 'combat_staff_2:auto_toggle');
  assert.equal(variable(player, 'autocast_spell'), standardSpell);
  assert.equal(variable(player, 'autocast_set') & 1, 1);
  makeAltar(player);
  assert.equal(variable(player, 'alternate_spells'), book.ancient);
  assert.notEqual(variable(player, 'autocast_spell'), standardSpell);
  const messagesBefore = player.messages.length;
  const runesBefore = runeVector(player);
  const magicXpBefore = player.stats[6];
  const meleeXpBefore = player.stats[0] + player.stats[1] + player.stats[2];
  for (const key of ['com_stabattack', 'com_slashattack', 'com_crushattack']) variable(player, key, 100000);
  variable(player, 'com_maxhit', 20);

  const npc = addNpc(player, player.x + 1, player.z, { aggressive: true });
  const previousRandom = JavaRandom.nextDouble;
  JavaRandom.nextDouble = function () { return 0.5; };
  try {
    dispatchAttack(player, npc);
    tickWorld();
    assert(npc.levels[3] < 200 || npcAttackQueue(npc).length > 0,
      'the post-switch ordinary Attack reaches melee, not an Ancient APNPCT spell');
    assert.equal(player.stats[6], magicXpBefore, 'invalid saved spell earns no Magic XP');
    assert.deepEqual(runeVector(player), runesBefore, 'invalid saved spell spends no runes');
    assert.equal(player.messages.length, messagesBefore, 'incompatible fallback adds no message');
    assert(player.stats[0] + player.stats[1] + player.stats[2] > meleeXpBefore,
      'ordinary melee Attack awards its normal combat XP');
  } finally {
    JavaRandom.nextDouble = previousRandom;
    World.removeNpc(npc, 0);
    disposePlayer(player);
  }
}

function testObservatoryReward() {
  const player = makePlayer();
  const originalQuestPoints = 37;
  variable(player, 'qp', originalQuestPoints);
  run(player, '[queue,itgronigen_quest_complete]');
  const genericRoot = id('Component', 'questscroll');
  const ancientRootId = id('Component', 'questscroll_itgronigen');
  assert.equal(player.modalMain, genericRoot, 'Observatory completion opens the generic quest reward');
  assert.equal(player.refreshModal, true, 'the real modal update is pending network emission');
  assert.notEqual(player.modalMain, ancientRootId, 'quest completion never opens the Ancient picker');
  const textAt = component => player.packets
    .filter(packet => packet instanceof IfSetText && packet.component === component)
    .at(-1)?.text;
  assert.equal(textAt(id('Component', 'questscroll:com_3')), observatoryReward.message);
  assert.equal(textAt(id('Component', 'questscroll:com_9')), String(observatoryReward.questPoints));
  assert.equal(textAt(id('Component', 'questscroll:com_10')), 'Quest points.');
  assert(player.packets.some(packet => packet instanceof IfSetModel
    && packet.component === id('Component', 'questscroll:com_4')
    && packet.model === observatoryReward.model), 'generic quest reward keeps its cache model');
  assert.equal(variable(player, 'qp'), originalQuestPoints, 'reward presentation preserves precomputed quest points');
  disposePlayer(player);
}

const selectedCase = process.argv.includes('--case')
  ? process.argv[process.argv.indexOf('--case') + 1]
  : 'all';
const cases = {
  all() {
    testStaffClientFields();
    testPicker();
    testLifecycle();
    testAttackContinuation();
    testStandardFallback();
    testObservatoryReward();
  },
  picker() {
    testStaffClientFields();
    testPicker();
  },
  lifecycle: testLifecycle,
  dispatch() {
    testAttackContinuation();
    testStandardFallback();
  },
  reward: testObservatoryReward,
};
assert(cases[selectedCase], `unknown case selector ${selectedCase}`);
cases[selectedCase]();
console.log(`PASS Ancient U3 compiled ${selectedCase}`);
process.exit(0);
