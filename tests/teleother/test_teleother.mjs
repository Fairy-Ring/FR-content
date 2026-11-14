/**
 * Compiled production Teleother handlers exercised through real Player triggers.
 * Run from the sibling engine: node --import tsx ../content/tests/teleother/test_teleother.mjs
 * This loads packs and map data but never starts a world server.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_DIR = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_DIR, '../engine');
const PACK_DIR = path.join(ENGINE_DIR, 'data/pack');
assert.ok(fs.existsSync(path.join(PACK_DIR, 'server/script.dat')), 'built production scripts are missing; build the sibling engine first');

const eng = async rel => import(pathToFileURL(path.join(ENGINE_DIR, rel)).href);
const load = async rel => (await eng(rel)).default;
const World = await load('src/engine/World.ts');
const Player = await load('src/engine/entity/Player.ts');
const Npc = await load('src/engine/entity/Npc.ts');
const ScriptProvider = await load('src/engine/script/ScriptProvider.ts');
const ScriptState = await load('src/engine/script/ScriptState.ts');
const ServerTriggerType = await load('src/engine/script/ServerTriggerType.ts');
const IfButtonHandler = await load('src/network/game/client/handler/IfButtonHandler.ts');
const IfButton = await load('src/network/game/client/model/IfButton.ts');
const IfSetText = await load('src/network/game/server/model/IfSetText.ts');
const { Interaction } = await eng('src/engine/entity/Interaction.js');
const { EntityLifeCycle } = await eng('src/engine/entity/EntityLifeCycle.js');
const { BlockWalk } = await eng('src/engine/entity/BlockWalk.js');
const { PlayerStat } = await eng('src/engine/entity/PlayerStat.js');
const { CoordGrid } = await eng('src/engine/CoordGrid.ts');
const VarPlayerType = await load('src/cache/config/VarPlayerType.ts');
const VarBitType = await load('src/cache/config/VarBitType.ts');
const VarNpcType = await load('src/cache/config/VarNpcType.ts');
const NpcType = await load('src/cache/config/NpcType.ts');
const LocType = await load('src/cache/config/LocType.ts');
const SeqType = await load('src/cache/config/SeqType.ts');
const SpotanimType = await load('src/cache/config/SpotanimType.ts');
const InvType = await load('src/cache/config/InvType.ts');
const ObjType = await load('src/cache/config/ObjType.ts');
const FontType = await load('src/cache/config/FontType.ts');
const Component = await load('src/cache/config/Component.ts');
const DbRowType = await load('src/cache/config/DbRowType.ts');
const DbTableType = await load('src/cache/config/DbTableType.ts');
const DbTableIndex = await load('src/cache/config/DbTableIndex.ts');
const EnumType = await load('src/cache/config/EnumType.ts');
const ParamType = await load('src/cache/config/ParamType.ts');
const CategoryType = await load('src/cache/config/CategoryType.ts');
const StructType = await load('src/cache/config/StructType.ts');
const MesanimType = await load('src/cache/config/MesanimType.ts');

for (const config of [
  VarPlayerType,
  VarBitType,
  VarNpcType,
  NpcType,
  LocType,
  SeqType,
  SpotanimType,
  InvType,
  ObjType,
  FontType,
  Component,
  DbRowType,
  DbTableType,
  EnumType,
  ParamType,
  CategoryType,
  StructType,
  MesanimType
]) {
  config.load(PACK_DIR);
}
DbTableIndex.init();
assert.ok(FontType.get(3), 'FontType q8_full is missing');
assert.ok(ScriptProvider.load(PACK_DIR) > 0, 'ScriptProvider.load returned no compiled scripts');
World.currentTick = 100;
World.gameMap.init();

const idCache = new Map();
function packedId(kind, name) {
  if (!idCache.has(kind)) {
    const lines = fs.readFileSync(path.join(CONTENT_DIR, 'pack', `${kind}.pack`), 'utf8').split(/\r?\n/);
    const values = new Map();
    for (const line of lines) {
      const split = line.indexOf('=');
      if (split > 0 && /^\d+$/.test(line.slice(0, split))) {
        values.set(line.slice(split + 1).trim(), Number(line.slice(0, split)));
      }
    }
    idCache.set(kind, values);
  }
  const value = idCache.get(kind).get(name);
  assert.notEqual(value, undefined, `pack/${kind}.pack is missing ${name}`);
  return value;
}

const magicTableId = DbTableType.getId('magic_spell_table');
assert.notEqual(magicTableId, -1, 'magic_spell_table is missing');
const magicTable = DbTableType.get(magicTableId);
const magicColumns = new Map(magicTable.columnNames.map((name, index) => [name, index]));
function values(row, column) {
  const index = magicColumns.get(column);
  assert.notEqual(index, undefined, `magic_spell_table is missing ${column}`);
  return row.getValue(index, 0);
}
function scalar(row, column) {
  const result = values(row, column);
  assert.equal(result.length, 1, `${row.debugname}.${column} should have one value`);
  return result[0];
}

const spells = [
  {
    row: 'magic_spell_teleother_lumbridge',
    selector: 61,
    component: 'magic:com_511',
    name: 'Teleother Lumbridge',
    destination: 'Lumbridge',
    level: 74,
    runes: [{ name: 'soulrune', count: 1 }, { name: 'lawrune', count: 1 }, { name: 'earthrune', count: 1 }],
    xp: 840,
    center: { level: 0, x: 3221, z: 3218 },
    staffSubstitute: { rune: 'earthrune', item: 'staff_of_earth' }
  },
  {
    row: 'magic_spell_teleother_falador',
    selector: 62,
    component: 'magic:com_521',
    name: 'Teleother Falador',
    destination: 'Falador',
    level: 82,
    runes: [{ name: 'soulrune', count: 1 }, { name: 'lawrune', count: 1 }, { name: 'waterrune', count: 1 }],
    xp: 920,
    center: { level: 0, x: 2965, z: 3378 },
    staffSubstitute: { rune: 'waterrune', item: 'staff_of_water' }
  },
  {
    row: 'magic_spell_teleother_camelot',
    selector: 63,
    component: 'magic:com_541',
    name: 'Teleother Camelot',
    destination: 'Camelot',
    level: 90,
    runes: [{ name: 'soulrune', count: 2 }, { name: 'lawrune', count: 1 }],
    xp: 1000,
    center: { level: 0, x: 2757, z: 3478 }
  }
];

const targetInterface = Component.getId('teleport_option');
const casterText = Component.getId('teleport_option:com_89');
const destinationText = Component.getId('teleport_option:com_91');
const acceptButton = Component.getId('teleport_option:com_97');
const declineButton = Component.getId('teleport_option:com_99');
const pendingVarp = VarPlayerType.getId('teleother_spell');
const aidVarp = VarPlayerType.getId('option_aid');
const invId = InvType.getId('inv');
const wornId = InvType.getId('worn');
for (const [name, value] of Object.entries({ targetInterface, casterText, destinationText, acceptButton, declineButton, pendingVarp, aidVarp, invId, wornId })) {
  assert.ok(value >= 0, `missing Teleother binding ${name}`);
}

for (const spell of spells) {
  const row = DbRowType.getByName(spell.row);
  assert.ok(row, `compiled DB row ${spell.row} is missing`);
  assert.equal(row.tableId, magicTableId, `${spell.row} is in magic_spell_table`);
  assert.equal(scalar(row, 'spell'), spell.selector, `${spell.row} selector`);
  assert.equal(scalar(row, 'spellcom'), Component.getId(spell.component), `${spell.row} target component`);
  assert.equal(scalar(row, 'name'), spell.name, `${spell.row} name`);
  assert.equal(scalar(row, 'members'), 1, `${spell.row} members flag`);
  assert.equal(scalar(row, 'levelrequired'), spell.level, `${spell.row} Magic level`);
  assert.deepEqual(
    values(row, 'runesrequired').slice(0, spell.runes.length * 2),
    spell.runes.flatMap(({ name, count }) => [ObjType.getId(name), count]),
    `${spell.row} exact rune pairs`
  );
  assert.equal(scalar(row, 'experience'), spell.xp, `${spell.row} XP in tenths`);
  assert.equal(
    scalar(row, 'tele_coord'),
    CoordGrid.packCoord(spell.center.level, spell.center.x, spell.center.z),
    `${spell.row} existing self-teleport center`
  );
  assert.equal(scalar(row, 'anim'), packedId('seq', 'human_teleport_other_casting'), `${spell.row} caster animation`);
  assert.equal(scalar(row, 'spotanim_origin'), packedId('spotanim', 'teleport_other_casting'), `${spell.row} caster spotanim`);
  assert.deepEqual(values(row, 'spotanim_target'), [packedId('spotanim', 'teleport_other_impact'), 92], `${spell.row} recipient spotanim`);
  assert.equal(scalar(row, 'sound_cast'), packedId('synth', 'tele_other_cast'), `${spell.row} caster sound`);
  assert.equal(scalar(row, 'sound_hit'), packedId('synth', 'teleport_all'), `${spell.row} recipient sound`);
  spell.componentId = Component.getId(spell.component);
  spell.rowData = row;
}

const buttonHandler = new IfButtonHandler();
const home = { level: 0, x: 3200, z: 3218 };
let nextSlot = 1;
function createPlayer(name, account = null) {
  const slot = nextSlot++;
  const username37 = account?.username37 ?? BigInt(slot + 1000);
  const hash64 = account?.hash64 ?? BigInt(slot + 5000);
  const player = new Player(name, username37, hash64);
  player.slot = slot;
  player.pid = slot;
  player.uid = ((Number(player.username37 & 0x1fffffn) << 11) | slot) >>> 0;
  player.vars.fill(0);
  player.stats.fill(130344310);
  player.baseLevels.fill(99);
  player.levels.fill(99);
  player.level = home.level;
  player.x = home.x;
  player.z = home.z;
  player.lastMovement = World.currentTick - 20;
  player.isActive = true;
  player.packets = [];
  player.messages = [];
  player.write = packet => player.packets.push(packet);
  player.messageGame = text => player.messages.push(text);
  player.wrappedMessageGame = text => player.messages.push(text);
  World.players[slot] = player;
  return player;
}
function removePlayer(player) {
  if (player.slot >= 0 && World.players[player.slot] === player) {
    delete World.players[player.slot];
  }
  player.cleanup();
}
function dispose(...players) {
  for (const player of players) {
    if (player.modalMain !== -1 || player.modalChat !== -1 || player.modalSide !== -1) player.closeModal();
    removePlayer(player);
  }
}
function getVar(player, name) {
  const varp = VarPlayerType.getId(name);
  assert.notEqual(varp, -1, `varp ${name} is missing`);
  return player.getVar(varp);
}
function setVar(player, name, value) {
  const varp = VarPlayerType.getId(name);
  assert.notEqual(varp, -1, `varp ${name} is missing`);
  player.setVar(varp, value);
}
function inventory(player, type = invId) {
  const value = player.getInventory(type);
  assert.ok(value, `inventory ${type} is missing`);
  return value;
}
function itemCount(player, name, type = invId) {
  const item = ObjType.getId(name);
  assert.ok(item >= 0, `object ${name} is missing`);
  return inventory(player, type).getItemCount(item);
}
function addRunes(player, spell, omitted = null) {
  for (const { name } of spell.runes) {
    if (name !== omitted) inventory(player).add(ObjType.getId(name), 10);
  }
}
function placeCasterAdjacent(caster, recipient) {
  caster.level = recipient.level;
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    caster.x = recipient.x + dx;
    caster.z = recipient.z + dz;
    if (caster.inApproachDistance(1, recipient)) return true;
  }
  return false;
}
function placePairInZone({ caster, recipient }, minX, minZ, maxX, maxZ, label) {
  // Keep the recipient inside the actual restriction rectangle while choosing
  // a cached corridor, rather than placing either player in a solid border.
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      recipient.x = x;
      recipient.z = z;
      if (placeCasterAdjacent(caster, recipient)) return;
    }
  }
  assert.fail(`${label}: no adjacent production line of sight inside its zone`);
}
function makePair(spell, { aid = 1, missingRune = null, staff = null, recipientCoord = home } = {}) {
  const caster = createPlayer(`telec${nextSlot}`);
  const recipient = createPlayer(`teler${nextSlot}`);
  setVar(recipient, 'option_aid', aid);
  addRunes(caster, spell, missingRune ?? staff?.rune ?? null);
  addRunes(recipient, spell);
  if (staff) inventory(caster, wornId).set(3, { id: ObjType.getId(staff.item), count: 1 });
  recipient.level = recipientCoord.level;
  recipient.x = recipientCoord.x;
  recipient.z = recipientCoord.z;
  assert.ok(placeCasterAdjacent(caster, recipient), `${spell.name}: adjacent fixture has production line of sight`);
  return { caster, recipient };
}
function economy(player, spell) {
  return {
    xp: player.stats[PlayerStat.MAGIC],
    runes: spell.runes.map(({ name }) => [name, itemCount(player, name)])
  };
}
function assertSameEconomy(player, spell, expected, label) {
  const actual = economy(player, spell);
  assert.equal(actual.xp, expected.xp, `${label}: Magic XP unchanged`);
  assert.deepEqual(actual.runes, expected.runes, `${label}: rune inventory unchanged`);
}
function assertFeeAtCast(caster, recipient, spell, beforeCaster, beforeRecipient, substitute = null) {
  assert.equal(caster.stats[PlayerStat.MAGIC] - beforeCaster.xp, spell.xp, `${spell.name}: caster receives exactly the approved cast XP`);
  const expectedRunes = beforeCaster.runes.map(([name, count]) => [name, count - (name === substitute ? 0 : spell.runes.find(rune => rune.name === name).count)]);
  assert.deepEqual(economy(caster, spell).runes, expectedRunes, `${spell.name}: exact cast-time rune fee`);
  assertSameEconomy(recipient, spell, beforeRecipient, `${spell.name}: recipient is not charged or awarded XP`);
}
function lastText(player, component) {
  const matches = player.packets.filter(packet => packet instanceof IfSetText && packet.component === component);
  assert.ok(matches.length, `recipient did not receive IfSetText for ${component}`);
  return matches[matches.length - 1].text;
}
function dispatchPlayerCast(caster, recipient, spell) {
  const component = Component.get(spell.componentId);
  assert.ok(component, `${spell.component}: target component is missing`);
  const root = Component.get(component.rootLayer);
  assert.ok(root, `${spell.component}: parent interface is missing`);
  assert.equal(caster.setInteraction(Interaction.ENGINE, recipient, ServerTriggerType.APPLAYERT, spell.componentId), true, `${spell.name}: real Player target interaction is accepted`);
  const trigger = caster.getApTrigger();
  assert.ok(trigger, `${spell.name}: compiled APPLAYERT trigger is missing`);
  assert.equal(caster.getOpTrigger(), null, `${spell.name}: target dispatch must not fall through to an OPPLAYERT handler`);
  assert.equal(caster.inApproachDistance(caster.apRange, recipient), true, `${spell.name}: fixture is adjacent with production line of sight`);
  assert.equal(caster.tryInteract(false), true, `${spell.name}: Player.tryInteract dispatches the compiled trigger`);
}
function assertOffer(pair, spell) {
  assert.equal(getVar(pair.caster, 'teleother_spell'), 0, 'pending selector belongs only to the recipient');
  assert.equal(getVar(pair.recipient, 'teleother_spell'), spell.selector, `${spell.name}: recipient pending selector`);
  assert.equal(pair.recipient.modalMain, targetInterface, `${spell.name}: recipient sees the Teleother offer root`);
  assert.equal(lastText(pair.recipient, casterText), pair.caster.displayName, `${spell.name}: complete caster display name`);
  assert.equal(lastText(pair.recipient, destinationText), spell.destination, `${spell.name}: destination text`);
}
function button(player, component) {
  return buttonHandler.handle(new IfButton(component), player);
}
function tile(player) {
  return { level: player.level, x: player.x, z: player.z };
}
function finishDelayedScript(player) {
  let boundaries = 0;
  while (player.activeScript) {
    assert.ok(boundaries++ < 10, 'finite Teleother response script');
    const state = player.activeScript;
    assert.equal(state.execution, ScriptState.SUSPENDED, 'Teleother acceptance suspends only for the selected travel delay');
    assert.ok(player.delayed, 'delayed script marks the recipient busy');
    assert.ok(player.delayedUntil > World.currentTick, 'acceptance delay is in the future');
    World.currentTick = player.delayedUntil;
    player.delayed = false;
    player.executeScript(state, true, true);
  }
  assert.equal(player.delayed, false, 'travel delay is complete');
}
function assertRadiusDestination(player, spell) {
  assert.equal(player.level, spell.center.level, `${spell.name}: destination plane`);
  assert.ok(Math.abs(player.x - spell.center.x) <= 2, `${spell.name}: x is within radius 2 of the configured center`);
  assert.ok(Math.abs(player.z - spell.center.z) <= 2, `${spell.name}: z is within radius 2 of the configured center`);
}
function assertNoFee(pair, spell, beforeCaster, beforeRecipient, modalBefore, label) {
  assertSameEconomy(pair.caster, spell, beforeCaster, `${label}: caster`);
  assertSameEconomy(pair.recipient, spell, beforeRecipient, `${label}: recipient`);
  assert.equal(getVar(pair.recipient, 'teleother_spell'), 0, `${label}: no pending offer`);
  assert.equal(pair.recipient.modalMain, modalBefore, `${label}: no new main interface`);
}
function castAndCheck(pair, spell, { substitute = null } = {}) {
  const beforeCaster = economy(pair.caster, spell);
  const beforeRecipient = economy(pair.recipient, spell);
  dispatchPlayerCast(pair.caster, pair.recipient, spell);
  assertOffer(pair, spell);
  assertFeeAtCast(pair.caster, pair.recipient, spell, beforeCaster, beforeRecipient, substitute);
  return { beforeCaster, beforeRecipient };
}

try {
  for (const spell of spells) {
    const pair = makePair(spell);
    if (spell.selector === 63) {
      const clock = World.currentTick;
      setVar(pair.caster, 'lastcombat', clock);
      setVar(pair.caster, 'lastcombat_pvp', clock);
      setVar(pair.recipient, 'lastcombat', clock);
      setVar(pair.recipient, 'lastcombat_pvp', clock);
    }
    const beforeCaster = economy(pair.caster, spell);
    const beforeRecipient = economy(pair.recipient, spell);
    const casterStart = tile(pair.caster);
    const recipientStart = tile(pair.recipient);
    dispatchPlayerCast(pair.caster, pair.recipient, spell);
    assertOffer(pair, spell);
    assertFeeAtCast(pair.caster, pair.recipient, spell, beforeCaster, beforeRecipient);
    const paidCaster = economy(pair.caster, spell);
    const paidRecipient = economy(pair.recipient, spell);
    assert.equal(button(pair.recipient, acceptButton), true, `${spell.name}: real IfButtonHandler accepts visible offer`);
    assert.equal(pair.recipient.modalMain, -1, `${spell.name}: accept closes the offer root`);
    assert.equal(getVar(pair.recipient, 'teleother_spell'), 0, `${spell.name}: accept consumes pending state before travel`);
    finishDelayedScript(pair.recipient);
    assertRadiusDestination(pair.recipient, spell);
    assert.deepEqual(tile(pair.caster), casterStart, `${spell.name}: caster remains at the casting tile`);
    assertSameEconomy(pair.caster, spell, paidCaster, `${spell.name}: accept and travel do not charge again`);
    assertSameEconomy(pair.recipient, spell, paidRecipient, `${spell.name}: accept does not charge the recipient`);
    assert.equal(button(pair.recipient, acceptButton), false, `${spell.name}: repeated stale Accept is rejected by real component visibility`);
    assertSameEconomy(pair.caster, spell, paidCaster, `${spell.name}: repeated Accept cannot charge again`);
    console.log(`PASS ${spell.name}: real APPLAYERT cast, exact cast settlement, recipient UI, visible Accept and radius-2 arrival`);
    dispose(pair.caster, pair.recipient);
  }

  for (const spell of spells) {
    for (const invalid of [
      {
        label: `${spell.name} insufficient current Magic`,
        options: {},
        setup: ({ caster }) => { caster.levels[PlayerStat.MAGIC] = spell.level - 1; }
      },
      {
        label: `${spell.name} missing ${spell.runes[0].name}`,
        options: { missingRune: spell.runes[0].name },
        setup: () => {}
      }
    ]) {
      const pair = makePair(spell, invalid.options);
      invalid.setup(pair);
      const beforeCaster = economy(pair.caster, spell);
      const beforeRecipient = economy(pair.recipient, spell);
      const modalBefore = pair.recipient.modalMain;
      dispatchPlayerCast(pair.caster, pair.recipient, spell);
      assertNoFee(pair, spell, beforeCaster, beforeRecipient, modalBefore, invalid.label);
      dispose(pair.caster, pair.recipient);
    }
  }
  console.log('PASS shared spell-requirement checks reject low Magic and missing runes without charging');

  const invalidTargetCases = [
    { label: 'Accept Aid off', options: { aid: 0 }, setup: () => {} },
    { label: 'delayed recipient', options: {}, setup: ({ recipient }) => { recipient.delayed = true; } },
    { label: 'modal-busy recipient', options: {}, setup: ({ recipient }) => { recipient.openMainModal(Component.get(Component.getId('magic:com_511')).rootLayer); } },
    { label: 'dead recipient', options: {}, setup: ({ recipient }) => { recipient.levels[PlayerStat.HITPOINTS] = 0; } },
    { label: 'recipient Wilderness above level 20', options: {}, setup: ({ recipient }) => { recipient.x = 3200; recipient.z = 3680; } },
    // Carried Ana: tests/ana-barrel covers real-dispatch offer, one fee, and the drop at Accept.
    { label: 'Trawler wreck restriction', options: {}, setup: ({ recipient }) => { recipient.x = 1921; recipient.z = 4801; } },
    { label: 'Trawler game restriction', options: {}, setup: ({ recipient }) => { recipient.x = 1985; recipient.z = 4801; } },
    { label: 'Mime event restriction', options: {}, setup: ({ recipient }) => { recipient.x = 1985; recipient.z = 4737; } },
    { label: 'Maze event restriction', options: {}, setup: pair => placePairInZone(pair, 2880, 4544, 2943, 4607, 'Maze') },
    { label: 'Duel Arena fight restriction', options: {}, setup: ({ recipient }) => { recipient.x = 3336; recipient.z = 3250; } },
    { label: 'Castle Wars arena restriction', options: {}, setup: ({ recipient }) => { recipient.x = 2369; recipient.z = 3073; } },
    { label: 'Castle Wars waiting-room restriction', options: {}, setup: pair => placePairInZone(pair, 2368, 9472, 2393, 9497, 'Castle Wars waiting room') }
  ];
  const lumbridge = spells[0];
  for (const invalid of invalidTargetCases) {
    const pair = makePair(lumbridge, invalid.options);
    invalid.setup(pair);
    assert.ok(placeCasterAdjacent(pair.caster, pair.recipient), `${invalid.label}: adjacent fixture has production line of sight`);
    const beforeCaster = economy(pair.caster, lumbridge);
    const beforeRecipient = economy(pair.recipient, lumbridge);
    const modalBefore = pair.recipient.modalMain;
    dispatchPlayerCast(pair.caster, pair.recipient, lumbridge);
    assertNoFee(pair, lumbridge, beforeCaster, beforeRecipient, modalBefore, invalid.label);
    dispose(pair.caster, pair.recipient);
  }
  console.log('PASS Aid, busy/dead/Wilderness, and every shared pre_tele_checks restriction reject offers without a fee');

  for (const spell of spells.filter(value => value.staffSubstitute)) {
    const pair = makePair(spell, { staff: spell.staffSubstitute });
    const beforeCaster = economy(pair.caster, spell);
    const beforeRecipient = economy(pair.recipient, spell);
    dispatchPlayerCast(pair.caster, pair.recipient, spell);
    assertOffer(pair, spell);
    assertFeeAtCast(pair.caster, pair.recipient, spell, beforeCaster, beforeRecipient, spell.staffSubstitute.rune);
    assert.equal(itemCount(pair.caster, spell.staffSubstitute.item, wornId), 1, `${spell.name}: supported staff remains worn`);
    pair.recipient.closeModal();
    assert.equal(getVar(pair.recipient, 'teleother_spell'), 0, `${spell.name}: staff case close clears recipient state`);
    dispose(pair.caster, pair.recipient);
  }
  console.log('PASS Earth and Water staff substitutions use the existing shared rune resolver');

  {
    const pair = makePair(lumbridge);
    const beforeCaster = economy(pair.caster, lumbridge);
    const beforeRecipient = economy(pair.recipient, lumbridge);
    dispatchPlayerCast(pair.caster, pair.recipient, lumbridge);
    assertOffer(pair, lumbridge);
    assertFeeAtCast(pair.caster, pair.recipient, lumbridge, beforeCaster, beforeRecipient);
    const paidCaster = economy(pair.caster, lumbridge);
    const paidRecipient = economy(pair.recipient, lumbridge);
    const origin = tile(pair.recipient);
    assert.equal(button(pair.recipient, declineButton), true, 'real IfButtonHandler dispatches Decline');
    assert.equal(pair.recipient.modalMain, -1, 'Decline closes the offer');
    assert.equal(getVar(pair.recipient, 'teleother_spell'), 0, 'Decline clears pending state');
    assert.deepEqual(tile(pair.recipient), origin, 'Decline does not move the recipient');
    assertSameEconomy(pair.caster, lumbridge, paidCaster, 'Decline does not refund or charge caster');
    assertSameEconomy(pair.recipient, lumbridge, paidRecipient, 'Decline does not affect recipient economy');
    dispose(pair.caster, pair.recipient);
  }
  {
    const pair = makePair(lumbridge);
    const beforeCaster = economy(pair.caster, lumbridge);
    const beforeRecipient = economy(pair.recipient, lumbridge);
    dispatchPlayerCast(pair.caster, pair.recipient, lumbridge);
    assertOffer(pair, lumbridge);
    assertFeeAtCast(pair.caster, pair.recipient, lumbridge, beforeCaster, beforeRecipient);
    const paidCaster = economy(pair.caster, lumbridge);
    pair.recipient.closeModal();
    assert.equal(pair.recipient.modalMain, -1, 'actual Player.closeModal closes the offer');
    assert.equal(getVar(pair.recipient, 'teleother_spell'), 0, 'actual IF_CLOSE clears pending state');
    assertSameEconomy(pair.caster, lumbridge, paidCaster, 'close does not refund or charge caster');
    assertSameEconomy(pair.recipient, lumbridge, beforeRecipient, 'close does not affect recipient economy');
    dispose(pair.caster, pair.recipient);
  }
  console.log('PASS Decline and actual Player.closeModal/IF_CLOSE clear pending state without refund');

  {
    const pair = makePair(lumbridge);
    dispatchPlayerCast(pair.caster, pair.recipient, lumbridge);
    assertOffer(pair, lumbridge);
    const oldCasterUid = pair.caster.uid;
    const oldCasterName = pair.caster.username;
    const account = { username37: pair.caster.username37, hash64: pair.caster.hash64 };
    removePlayer(pair.caster);
    assert.equal(World.getPlayerByUid(oldCasterUid), null, 'logged-out caster UID is absent');
    const reloggedCaster = createPlayer(oldCasterName, account);
    assert.notEqual(reloggedCaster.uid, oldCasterUid, 'relogin uses a new player UID');
    assert.equal(getVar(pair.recipient, 'teleother_spell'), lumbridge.selector, 'paid invitation remains recipient-owned through caster relog');
    const paidCaster = economy(pair.caster, lumbridge);
    const paidRecipient = economy(pair.recipient, lumbridge);
    assert.equal(button(pair.recipient, acceptButton), true, 'recipient can accept while original caster is logged out');
    finishDelayedScript(pair.recipient);
    assertRadiusDestination(pair.recipient, lumbridge);
    assertSameEconomy(pair.caster, lumbridge, paidCaster, 'caster logout cannot create another fee or XP award');
    assertSameEconomy(pair.recipient, lumbridge, paidRecipient, 'accept after caster relog does not charge recipient');
    dispose(reloggedCaster, pair.recipient);
  }
  {
    const pair = makePair(lumbridge);
    dispatchPlayerCast(pair.caster, pair.recipient, lumbridge);
    assertOffer(pair, lumbridge);
    const recipientName = pair.recipient.username;
    const account = { username37: pair.recipient.username37, hash64: pair.recipient.hash64 };
    pair.recipient.closeModal();
    assert.equal(getVar(pair.recipient, 'teleother_spell'), 0, 'recipient IF_CLOSE clears pending state before logout');
    removePlayer(pair.recipient);
    const reloggedRecipient = createPlayer(recipientName, account);
    assert.equal(getVar(reloggedRecipient, 'teleother_spell'), 0, 'new recipient session has no temporary pending invitation');
    assert.equal(reloggedRecipient.modalMain, -1, 'new recipient session has no stale offer modal');
    dispose(pair.caster, reloggedRecipient);
  }
  console.log('PASS caster relog cannot cancel a paid offer; recipient close/logout does not retain temporary state');

  {
    const pair = makePair(lumbridge);
    const beforeCaster = economy(pair.caster, lumbridge);
    const beforeRecipient = economy(pair.recipient, lumbridge);
    dispatchPlayerCast(pair.caster, pair.recipient, lumbridge);
    assertOffer(pair, lumbridge);
    const paidLumbridge = economy(pair.caster, lumbridge);
    const replacementRoot = Component.get(Component.get(lumbridge.componentId).rootLayer).id;
    pair.recipient.openMainModal(replacementRoot);
    assert.equal(pair.recipient.modalMain, replacementRoot, 'a new main modal replaces the Teleother offer');
    assert.equal(button(pair.recipient, acceptButton), false, 'real IfButtonHandler rejects stale Accept for hidden Teleother root');
    assert.equal(pair.recipient.modalMain, replacementRoot, 'stale Accept leaves replacement window unchanged');
    assert.equal(getVar(pair.recipient, 'teleother_spell'), lumbridge.selector, 'stale Accept does not invoke the response script');
    assertSameEconomy(pair.caster, lumbridge, paidLumbridge, 'stale Accept cannot charge again');
    pair.recipient.closeModal();
    assert.equal(getVar(pair.recipient, 'teleother_spell'), lumbridge.selector, 'replacing the main modal does not run the old IF_CLOSE trigger');

    const camelot = spells[2];
    const beforeCamelotCaster = economy(pair.caster, camelot);
    const beforeCamelotRecipient = economy(pair.recipient, camelot);
    dispatchPlayerCast(pair.caster, pair.recipient, camelot);
    assertOffer(pair, camelot);
    assertFeeAtCast(pair.caster, pair.recipient, camelot, beforeCamelotCaster, beforeCamelotRecipient);
    assert.equal(getVar(pair.recipient, 'teleother_spell'), camelot.selector, 'new valid offer overwrites stale recipient selector');
    const paidCamelotCaster = economy(pair.caster, camelot);
    assert.equal(button(pair.recipient, acceptButton), true, 'the newly visible offer can be accepted');
    finishDelayedScript(pair.recipient);
    assertRadiusDestination(pair.recipient, camelot);
    assertSameEconomy(pair.caster, camelot, paidCamelotCaster, 'replacement offer response charges no more runes or XP');
    dispose(pair.caster, pair.recipient);
  }
  console.log('PASS stale Accept is rejected by IfButtonHandler and cannot alter replacement modal; new offer overwrites state');

  {
    const npcType = Array.from({ length: NpcType.count }, (_, index) => NpcType.get(index)).find(type => type && type.id >= 0);
    assert.ok(npcType, 'no packed NPC type is available for the target-routing check');
    let nid = 1;
    for (const spell of spells) {
      const pair = makePair(spell);
      const npc = new Npc(0, home.x, home.z, 1, 1, EntityLifeCycle.RESPAWN, nid++, npcType.id, BlockWalk.NONE);
      npc.isActive = true;
      npc.lastMovement = World.currentTick - 20;
      const beforeCaster = economy(pair.caster, spell);
      const beforeRecipient = economy(pair.recipient, spell);
      assert.equal(pair.caster.setInteraction(Interaction.ENGINE, npc, ServerTriggerType.APNPCT, spell.componentId), true, `${spell.name}: NPC target interaction is valid`);
      assert.equal(pair.caster.getApTrigger(), null, `${spell.name}: no Teleother APNPCT combat trigger is registered`);
      assert.equal(pair.caster.getOpTrigger(), null, `${spell.name}: no NPC OP trigger captures Teleother`);
      assert.equal(pair.caster.tryInteract(false), false, `${spell.name}: NPC target does not start a combat handler`);
      assertSameEconomy(pair.caster, spell, beforeCaster, `${spell.name}: NPC attempt does not charge caster`);
      assertSameEconomy(pair.recipient, spell, beforeRecipient, `${spell.name}: NPC attempt does not charge recipient`);
      assert.equal(getVar(pair.recipient, 'teleother_spell'), 0, `${spell.name}: NPC attempt does not create an offer`);
      dispose(pair.caster, pair.recipient);
    }
  }
  console.log('PASS all Teleother NPC-target components stay out of APNPCT/OP combat dispatch');

  {
    const pair = makePair(lumbridge);
    const beforeCaster = economy(pair.caster, lumbridge);
    const beforeRecipient = economy(pair.recipient, lumbridge);
    dispatchPlayerCast(pair.caster, pair.recipient, lumbridge);
    assertOffer(pair, lumbridge);
    const paidCaster = economy(pair.caster, lumbridge);
    const paidRecipient = economy(pair.recipient, lumbridge);
    pair.recipient.level = 0;
    pair.recipient.x = 3200;
    pair.recipient.z = 3680;
    assert.equal(button(pair.recipient, acceptButton), true, 'Accept remains a real visible button after recipient state changes');
    assert.equal(getVar(pair.recipient, 'teleother_spell'), 0, 'response consumes state before rechecking travel restrictions');
    assert.equal(pair.recipient.modalMain, -1, 'restricted response closes the offer');
    assert.equal(pair.recipient.x, 3200, 'Wilderness restriction prevents response travel');
    assert.equal(pair.recipient.z, 3680, 'Wilderness restriction prevents response travel');
    assertSameEconomy(pair.caster, lumbridge, paidCaster, 'response restriction does not add a fee or refund');
    assertSameEconomy(pair.recipient, lumbridge, paidRecipient, 'response restriction does not charge recipient');
    assert.equal(beforeCaster.xp < paidCaster.xp, true, 'the original valid offer was paid at cast time');
    assert.equal(beforeRecipient.xp, paidRecipient.xp, 'recipient received no XP');
    dispose(pair.caster, pair.recipient);
  }
  console.log('PASS Accept rechecks recipient Wilderness restrictions after the offer was paid');

  console.log('RESULT PASS Teleother compiled production scripts: three rows, settlement, recipient UI/lifecycle, restrictions, target routing');
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
