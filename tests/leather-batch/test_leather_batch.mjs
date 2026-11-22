#!/usr/bin/env node
/**
 * Compiled soft-leather regression through production Player scripts, interface
 * button dispatch, and the real weak queue. Run after building the sibling engine:
 *   node --import tsx ../content/tests/leather-batch/test_leather_batch.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_DIR = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_DIR, '../engine');
const PACK_DIR = path.resolve(process.env.LEATHER_PACK_DIR ?? path.join(ENGINE_DIR, 'data/pack'));
const SCRIPT_DAT = path.join(PACK_DIR, 'server/script.dat');
if (process.argv.length !== 2) {
  throw new Error('Usage: test_leather_batch.mjs');
}
assert.ok(fs.existsSync(SCRIPT_DAT), `missing compiled script pack at ${SCRIPT_DAT} — build the sibling engine or set LEATHER_PACK_DIR`);

const eng = rel => import(pathToFileURL(path.join(ENGINE_DIR, rel)).href);
const load = async rel => (await eng(rel)).default;
const World = await load('src/engine/World.ts');
const Player = await load('src/engine/entity/Player.ts');
const PlayerStatModule = await eng('src/engine/entity/PlayerStat.js');
const { PlayerStatMap } = PlayerStatModule;
const ScriptProvider = await load('src/engine/script/ScriptProvider.ts');
const ScriptRunner = await load('src/engine/script/ScriptRunner.ts');
const ScriptState = await load('src/engine/script/ScriptState.ts');
const ServerTriggerType = await load('src/engine/script/ServerTriggerType.ts');
const IfButtonHandler = await load('src/network/game/client/handler/IfButtonHandler.ts');
const IfButton = await load('src/network/game/client/model/IfButton.ts');
const Environment = await load('src/util/Environment.ts');
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
assert.ok(ScriptProvider.load(PACK_DIR) > 0, 'no compiled server scripts were loaded');
World.currentTick = 100;
Environment.NODE_XPRATE = 1;
Environment.NODE_DEBUG = false;

function namedId(type, name, kind) {
  const id = type.getId(name);
  assert.ok(Number.isInteger(id) && id >= 0, `${kind} ${name} is missing from the loaded pack`);
  return id;
}

const inventoryId = namedId(InvType, 'inv', 'inventory');
const leatherId = namedId(ObjType, 'leather', 'object');
const needleId = namedId(ObjType, 'needle', 'object');
const threadId = namedId(ObjType, 'thread', 'object');
const leatherInterfaceId = namedId(Component, 'leather_crafting', 'interface');
const threadUsedVarp = namedId(VarPlayerType, 'thread_used', 'varp');
const craftingStat = PlayerStatMap.get('CRAFTING');
assert.ok(Number.isInteger(craftingStat), 'Crafting stat index is missing');
const tableId = namedId(DbTableType, 'craft_leather_table', 'DBTable');
const table = DbTableType.get(tableId);
assert.ok(table, 'craft_leather_table is missing');
const columnIndices = new Map(table.columnNames.map((name, index) => [name, index]));
function fieldValues(row, field) {
  const index = columnIndices.get(field);
  assert.notEqual(index, undefined, `craft_leather_table is missing ${field}`);
  return row.getValue(index, 0);
}
function scalar(row, field) {
  const values = fieldValues(row, field);
  assert.equal(values.length, 1, `${row.debugname}.${field} should contain one value`);
  return values[0];
}

// Authored from configs/leather/leather.dbrow. Do not derive expectations from packed rows.
const expectedRecipes = [
  {
    rowName: 'craft_leather_body',
    productName: 'leather_armour',
    name: 'a Leather Body',
    productExp: 250,
    levelRequired: 14,
    membersOnly: false,
    make1: 'com_113',
    make5: 'com_112',
    make10: 'com_111'
  },
  {
    rowName: 'craft_leather_gloves',
    productName: 'leather_gloves',
    name: 'a pair of Leather Gloves',
    productExp: 138,
    levelRequired: 1,
    membersOnly: false,
    make1: 'com_116',
    make5: 'com_115',
    make10: 'com_114'
  },
  {
    rowName: 'craft_leather_boots',
    productName: 'leather_boots',
    name: 'a pair of Leather Boots',
    productExp: 163,
    levelRequired: 7,
    membersOnly: false,
    make1: 'com_119',
    make5: 'com_118',
    make10: 'com_117'
  },
  {
    rowName: 'craft_leather_vambraces',
    productName: 'leather_vambraces',
    name: 'a pair of Leather Vambraces',
    productExp: 220,
    levelRequired: 11,
    membersOnly: false,
    make1: 'com_122',
    make5: 'com_121',
    make10: 'com_120'
  },
  {
    rowName: 'craft_leather_chaps',
    productName: 'leather_chaps',
    name: 'some Leather Chaps',
    productExp: 270,
    levelRequired: 18,
    membersOnly: false,
    make1: 'com_125',
    make5: 'com_124',
    make10: 'com_123'
  },
  {
    rowName: 'craft_coif',
    productName: 'coif',
    name: 'a Coif',
    productExp: 370,
    levelRequired: 38,
    membersOnly: true,
    make1: 'com_128',
    make5: 'com_127',
    make10: 'com_126'
  },
  {
    rowName: 'craft_leather_cowl',
    productName: 'leather_cowl',
    name: 'a Leather Cowl',
    productExp: 185,
    levelRequired: 9,
    membersOnly: false,
    make1: 'com_131',
    make5: 'com_130',
    make10: 'com_129'
  }
];
const recipes = expectedRecipes.map(expected => {
  const rowId = namedId(DbRowType, expected.rowName, 'DBRow');
  const row = DbRowType.get(rowId);
  assert.ok(row, `DBRow ${expected.rowName} is missing`);
  const product = namedId(ObjType, expected.productName, 'product object');
  const leather = fieldValues(row, 'leather');
  assert.equal(leather.length, 2, `${expected.rowName}.leather should contain item and quantity`);
  assert.equal(Number(leather[0]), leatherId, `${expected.rowName} should use soft leather`);
  assert.equal(Number(leather[1]), 1, `${expected.rowName} should use one piece of soft leather`);
  assert.equal(Number(scalar(row, 'product')), product, `${expected.rowName} should make ${expected.productName}`);
  assert.equal(scalar(row, 'name'), expected.name, `${expected.rowName} display name`);
  assert.equal(Number(scalar(row, 'productexp')), expected.productExp, `${expected.rowName} Crafting XP`);
  assert.equal(Number(scalar(row, 'levelrequired')), expected.levelRequired, `${expected.rowName} Crafting level`);
  assert.equal(Boolean(scalar(row, 'members')), expected.membersOnly, `${expected.rowName} world restriction`);
  return {
    ...expected,
    product,
    ingredient: leatherId,
    ingredientCount: 1,
    make1: namedId(Component, `leather_crafting:${expected.make1}`, 'component'),
    make5: namedId(Component, `leather_crafting:${expected.make5}`, 'component'),
    make10: namedId(Component, `leather_crafting:${expected.make10}`, 'component')
  };
});
assert.equal(recipes.length, 7, 'all seven soft-leather product rows must be covered');
assert.equal(new Set(recipes.map(recipe => recipe.product)).size, recipes.length, 'each soft-leather row must make a distinct product');
assert.ok(recipes.find(recipe => recipe.rowName === 'craft_coif')?.membersOnly, 'the Coif row must retain its members-only restriction');

const buttonHandler = new IfButtonHandler();
const baseCraftingXp = 130344310;
const membersFeatureMessage = "You need to be on a members' server to use this feature.";
let playerSerial = 0;

function inventoryOf(player) {
  const inventory = player.getInventory(inventoryId);
  assert.ok(inventory, 'player inventory is missing');
  return inventory;
}
function itemCount(player, itemId) {
  return inventoryOf(player).getItemCount(itemId);
}
function queueCount(player) {
  return Array.from(player.weakQueue.all()).length;
}
function withMembers(enabled, action) {
  const previous = Environment.NODE_MEMBERS;
  Environment.NODE_MEMBERS = enabled;
  try {
    return action();
  } finally {
    Environment.NODE_MEMBERS = previous;
  }
}

function makePlayer(recipe, {
  leatherUnits = recipe.ingredientCount,
  threadCount = 2,
  threadUsed = 0,
  craftingLevel = 99
} = {}) {
  const serial = ++playerSerial;
  const player = new Player(`leather_batch_${serial}`, BigInt(1000 + serial), BigInt(5000 + serial));
  player.uid = serial;
  player.pid = serial;
  player.slot = serial;
  player.staffModLevel = 0;
  player.vars.fill(0);
  player.stats.fill(baseCraftingXp);
  player.baseLevels.fill(99);
  player.levels.fill(99);
  player.baseLevels[craftingStat] = craftingLevel;
  player.levels[craftingStat] = craftingLevel;
  player.lastMovement = World.currentTick - 20;
  player.messages = [];
  player.packets = [];
  player.write = packet => player.packets.push(packet);
  player.messageGame = text => player.messages.push(text);
  player.wrappedMessageGame = text => player.messages.push(text);
  player.animations = [];
  const playAnimation = player.playAnimation.bind(player);
  player.playAnimation = (id, delay) => {
    player.animations.push({ id, delay, tick: World.currentTick });
    playAnimation(id, delay);
  };

  const inventory = inventoryOf(player);
  inventory.add(needleId, 1);
  if (leatherUnits > 0) inventory.add(recipe.ingredient, leatherUnits);
  if (threadCount > 0) inventory.add(threadId, threadCount);
  player.lastUseItem = needleId;
  player.lastUseSlot = 0;
  player.setVar(threadUsedVarp, threadUsed);
  openLeatherInterface(player);
  return player;
}

function openLeatherInterface(player) {
  const script = ScriptProvider.getByName('[opheldu,leather]');
  assert.ok(script, 'compiled [opheldu,leather] trigger is missing');
  const state = ScriptRunner.init(script, player);
  assert.equal(player.runScript(state, true, true), ScriptState.FINISHED, '[opheldu,leather] did not finish');
  assert.equal(player.modalMain, leatherInterfaceId, 'the packed leather crafting interface did not open');
  // The published soft-leather recipe does not require a needle once its interface is open.
  inventoryOf(player).remove(needleId, 1);
  assert.equal(itemCount(player, needleId), 0, 'the no-needle fixture must actually omit its needle');
}

function packetStrings(value, result = [], visited = new Set()) {
  if (typeof value === 'string') {
    result.push(value);
    return result;
  }
  if (value === null || typeof value !== 'object' || visited.has(value)) return result;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return result;
  visited.add(value);
  for (const key of Object.keys(value)) packetStrings(value[key], result, visited);
  return result;
}
function allText(player) {
  return [...player.messages, ...packetStrings(player.packets)].join('\n');
}
function packetTypePresent(player, type) {
  return player.packets.some(packet => packet?.constructor?.name === type);
}
function assertClosedModals(player, label) {
  assert.equal(player.modalMain, -1, `${label}: main modal should be closed`);
  assert.equal(player.modalChat, -1, `${label}: chat modal should be closed`);
  assert.equal(player.modalSide, -1, `${label}: side modal should be closed`);
}
function assertChatbox(player, message, label) {
  assert.ok(packetTypePresent(player, 'IfSetText'), `${label}: chatbox text packet is missing`);
  assert.ok(packetTypePresent(player, 'IfOpenChat'), `${label}: chatbox open packet is missing`);
  // mesbox splits long messages across the active chatbox's text components.
  const text = player.packets
    .filter(packet => packet?.constructor?.name === 'IfSetText' &&
      Component.get(packet.component).rootLayer === player.modalChat)
    .map(packet => packet.text).join(' ').replace(/\s+/g, ' ').trim();
  assert.equal(text, message, `${label}: exact chatbox message`);
  assert.equal(player.modalMain, -1, `${label}: crafting interface should close before chatbox`);
  assert.notEqual(player.modalChat, -1, `${label}: chatbox should be open`);
  assert.equal(player.modalSide, -1, `${label}: side modal should stay closed`);
}
function assertThreadWarningBox(player, label) {
  const message = 'You need some thread to make anything out of leather.';
  assertChatbox(player, message, label);
  assert.ok(packetTypePresent(player, 'IfSetPosition'), `${label}: object box position packet is missing`);
  assert.ok(
    player.packets.some(packet => packet?.constructor?.name === 'IfSetObject' && packet.obj === threadId),
    `${label}: object box should display thread`
  );
}

function clickButton(player, component, label) {
  const trigger = ScriptProvider.getByTriggerSpecific(ServerTriggerType.IF_BUTTON, component, -1);
  assert.ok(trigger, `compiled ${label} trigger is missing; normal mode requires the restored batch buttons`);
  assert.equal(buttonHandler.handle(new IfButton(component), player), true, `${label} was not accepted by the production IfButtonHandler`);
}
function makeOneScenarios() {
  const scenarios = [];
  for (const recipe of recipes) {
    for (const threadUsed of [0, 4]) {
      scenarios.push({
        key: `${recipe.rowName}:success-thread-${threadUsed}`,
        kind: 'success',
        recipe,
        threadUsed,
        threadCount: 2,
        leatherUnits: recipe.ingredientCount,
        craftingLevel: 99,
        members: true
      });
    }
    scenarios.push({
      key: `${recipe.rowName}:below-level`,
      kind: 'below-level',
      recipe,
      threadUsed: 4,
      threadCount: 2,
      leatherUnits: recipe.ingredientCount,
      craftingLevel: recipe.levelRequired - 1,
      members: true
    });
    scenarios.push({
      key: `${recipe.rowName}:insufficient-leather`,
      kind: 'insufficient-leather',
      recipe,
      threadUsed: 4,
      threadCount: 2,
      leatherUnits: Math.max(0, recipe.ingredientCount - 1),
      craftingLevel: 99,
      members: true
    });
    scenarios.push({
      key: `${recipe.rowName}:no-thread`,
      kind: 'no-thread',
      recipe,
      threadUsed: 4,
      threadCount: 1,
      leatherUnits: recipe.ingredientCount,
      craftingLevel: 99,
      removeThreadAfterOpen: true,
      members: true
    });
  }
  const coif = recipes.find(recipe => recipe.rowName === 'craft_coif');
  scenarios.push({
    key: 'craft_coif:free-world',
    kind: 'members-only',
    recipe: coif,
    threadUsed: 4,
    threadCount: 2,
    leatherUnits: coif.ingredientCount,
    craftingLevel: 99,
    members: false
  });
  return scenarios;
}

function runMakeOne(scenario) {
  return withMembers(scenario.members, () => {
    const { recipe } = scenario;
    const player = makePlayer(recipe, scenario);
    if (scenario.removeThreadAfterOpen) {
      inventoryOf(player).remove(threadId, itemCount(player, threadId));
      assert.equal(itemCount(player, threadId), 0, 'no-thread fixture must remove its reel after opening the interface');
    }
    const initial = captureInitialEffects(player, recipe);
    clickButton(player, recipe.make1, `${recipe.rowName} Make1`);
    assertMakeOneOutcome(player, scenario, initial, scenario.key);
  });
}
const make1Scenarios = makeOneScenarios();

for (const recipe of recipes) {
  for (const [amount, component] of [[5, recipe.make5], [10, recipe.make10]]) {
    const trigger = ScriptProvider.getByTriggerSpecific(ServerTriggerType.IF_BUTTON, component, -1);
    assert.ok(trigger, `${recipe.rowName} Make${amount} trigger is missing; old packs intentionally fail normal mode`);
  }
}

// Check Make1 against authored recipe rules, player-visible outcomes, and resource settlement.
for (const scenario of make1Scenarios) runMakeOne(scenario);

function advanceTick(player) {
  World.currentTick += 1;
  player.processQueues();
}
function drainWeakQueue(player, label, expectedMaxCrafts) {
  const maxTicks = 3 * (expectedMaxCrafts + 2) + 4;
  for (let tick = 0; tick < maxTicks && queueCount(player) > 0; tick++) advanceTick(player);
  assert.equal(queueCount(player), 0, `${label}: weak queue did not drain after ${maxTicks} real Player queue ticks`);
}
function dispatchBatch(player, recipe, amount) {
  clickButton(player, amount === 5 ? recipe.make5 : recipe.make10, `${recipe.rowName} Make${amount}`);
}
function expectedMessages(recipe, initialThreadUsed, crafted, finalMessage = null) {
  const messages = [];
  for (let index = 1; index <= crafted; index++) {
    if ((initialThreadUsed + index) % 5 === 0) messages.push('You use up one of your reels of Thread.');
    messages.push(`You make ${recipe.name}.`);
  }
  if (finalMessage) messages.push(finalMessage);
  return messages;
}
function captureInitialEffects(player, recipe) {
  return {
    initialLeather: itemCount(player, recipe.ingredient),
    initialThread: itemCount(player, threadId),
    initialThreadUsed: player.getVar(threadUsedVarp),
    initialXp: player.stats[craftingStat]
  };
}
function assertEffects(player, recipe, {
  initialLeather,
  initialThread,
  initialThreadUsed,
  initialXp,
  crafted,
  label
}) {
  assert.equal(itemCount(player, recipe.ingredient), initialLeather - crafted * recipe.ingredientCount, `${label}: exact leather debit`);
  for (const output of recipes) {
    const expectedCount = output.product === recipe.product ? crafted : 0;
    assert.equal(itemCount(player, output.product), expectedCount, `${label}: exact ${output.productName} count`);
  }
  assert.equal(itemCount(player, threadId), initialThread - Math.floor((initialThreadUsed + crafted) / 5), `${label}: exact reel debit`);
  assert.equal(player.getVar(threadUsedVarp), (initialThreadUsed + crafted) % 5, `${label}: exact thread_used counter`);
  assert.equal(player.stats[craftingStat] - initialXp, crafted * recipe.productExp, `${label}: exact Crafting XP`);
  assert.equal(itemCount(player, needleId), 0, `${label}: no needle is held after the interface opens`);
}
function assertMakeOneOutcome(player, scenario, initial, label) {
  const { recipe } = scenario;
  const crafted = scenario.kind === 'success' ? 1 : 0;
  assertEffects(player, recipe, { ...initial, crafted, label });
  assert.equal(player.levels[craftingStat], scenario.craftingLevel, `${label}: Crafting level should stay unchanged`);
  assert.deepEqual(player.animations, [], `${label}: Make1 should not animate`);

  switch (scenario.kind) {
    case 'success':
      assert.deepEqual(player.messages, expectedMessages(recipe, initial.initialThreadUsed, 1), `${label}: exact product and reel messages`);
      assertClosedModals(player, label);
      break;
    case 'below-level':
      assert.deepEqual(player.messages, [], `${label}: level refusal uses the chatbox`);
      assertChatbox(player, `You need a Crafting level of ${recipe.levelRequired} to make ${recipe.name}.`, label);
      break;
    case 'insufficient-leather':
      assert.deepEqual(player.messages, [`You don't have enough leather to make ${recipe.name}.`], `${label}: exact leather refusal message`);
      assertClosedModals(player, label);
      break;
    case 'no-thread':
      assert.deepEqual(player.messages, [], `${label}: thread refusal uses the object box`);
      assertThreadWarningBox(player, label);
      break;
    case 'members-only':
      assert.deepEqual(player.messages, [membersFeatureMessage], `${label}: exact members-world refusal message`);
      assertClosedModals(player, label);
      break;
    default:
      assert.fail(`${label}: unsupported Make1 behavior case ${scenario.kind}`);
  }
}

// Every Make5/Make10 refusal must settle like the authored Make1 refusal rules at dispatch.
for (const scenario of make1Scenarios.filter(scenario => scenario.kind !== 'success')) {
  for (const amount of [5, 10]) {
    withMembers(scenario.members, () => {
      const { recipe } = scenario;
      const label = `${scenario.key} Make${amount} immediate refusal`;
      const player = makePlayer(recipe, scenario);
      if (scenario.removeThreadAfterOpen) inventoryOf(player).remove(threadId, itemCount(player, threadId));
      const initial = captureInitialEffects(player, recipe);
      const pressTick = World.currentTick;
      dispatchBatch(player, recipe, amount);
      assert.equal(World.currentTick, pressTick, `${label}: refusal must occur on the press tick`);
      assert.equal(queueCount(player), 0, `${label}: refusal must not queue a batch`);
      assertMakeOneOutcome(player, scenario, initial, label);
    });
  }
}

// Each of the seven real Make5/Make10 interface buttons crafts exactly the requested amount.
for (const recipe of recipes) {
  for (const amount of [5, 10]) {
    const label = `${recipe.rowName} Make${amount} exact inventory`;
    const threadCount = Math.ceil(amount / 5);
    const player = makePlayer(recipe, {
      leatherUnits: amount * recipe.ingredientCount,
      threadCount,
      threadUsed: 0
    });
    const initialXp = player.stats[craftingStat];
    dispatchBatch(player, recipe, amount);
    assert.equal(itemCount(player, recipe.product), 0, `${label}: batch must use the delayed weak queue, not craft inline`);
    assert.equal(queueCount(player), 1, `${label}: one delayed batch request should be queued`);
    for (let tick = 1; tick <= amount * 3; tick++) {
      advanceTick(player);
      assert.equal(itemCount(player, recipe.product), Math.floor(tick / 3), `${label}: exactly one new product every three ticks (tick ${tick})`);
    }
    assert.equal(queueCount(player), 0, `${label}: completed batch leaves no queued item`);
    assertEffects(player, recipe, {
      initialLeather: amount * recipe.ingredientCount,
      initialThread: threadCount,
      initialThreadUsed: 0,
      initialXp,
      crafted: amount,
      label
    });
    assert.deepEqual(player.messages, expectedMessages(recipe, 0, amount), `${label}: published per-item and reel messages`);
  }
}

// One fewer leather unit than requested stops cleanly after all available products, for every button.
for (const recipe of recipes) {
  for (const amount of [5, 10]) {
    const label = `${recipe.rowName} Make${amount} limited leather`;
    const availableCrafts = amount - 1;
    const leatherUnits = availableCrafts * recipe.ingredientCount;
    const threadCount = Math.ceil(availableCrafts / 5);
    const player = makePlayer(recipe, {
      leatherUnits,
      threadCount,
      threadUsed: 0
    });
    const initialXp = player.stats[craftingStat];
    dispatchBatch(player, recipe, amount);
    drainWeakQueue(player, label, amount);
    assertEffects(player, recipe, {
      initialLeather: leatherUnits,
      initialThread: threadCount,
      initialThreadUsed: 0,
      initialXp,
      crafted: availableCrafts,
      label
    });
    assert.deepEqual(
      player.messages,
      expectedMessages(recipe, 0, availableCrafts, `You don't have enough leather to make ${recipe.name}.`),
      `${label}: stop at the leather limit and report the refusal`
    );
  }
}

// Re-check the live level gate at each batch size without consuming any inputs or thread.
for (const recipe of recipes) {
  for (const amount of [5, 10]) {
    const label = `${recipe.rowName} Make${amount} below-level refusal`;
    const threadUsed = 4;
    const threadCount = 2;
    const leatherUnits = amount * recipe.ingredientCount;
    const player = makePlayer(recipe, {
      leatherUnits,
      threadCount,
      threadUsed,
      craftingLevel: recipe.levelRequired - 1
    });
    const initialXp = player.stats[craftingStat];
    dispatchBatch(player, recipe, amount);
    drainWeakQueue(player, label, amount);
    assertEffects(player, recipe, {
      initialLeather: leatherUnits,
      initialThread: threadCount,
      initialThreadUsed: threadUsed,
      initialXp,
      crafted: 0,
      label
    });
    assert.ok(allText(player).includes(`Crafting level of ${recipe.levelRequired}`), `${label}: packed level refusal message is missing`);
  }
}

// The interface can be opened while a reel exists, then every new batch size must refuse when it is gone.
for (const recipe of recipes) {
  for (const amount of [5, 10]) {
    const label = `${recipe.rowName} Make${amount} no-thread refusal`;
    const threadUsed = 4;
    const leatherUnits = amount * recipe.ingredientCount;
    const player = makePlayer(recipe, {
      leatherUnits,
      threadCount: 1,
      threadUsed
    });
    inventoryOf(player).remove(threadId, 1);
    const initialXp = player.stats[craftingStat];
    dispatchBatch(player, recipe, amount);
    drainWeakQueue(player, label, amount);
    assertEffects(player, recipe, {
      initialLeather: leatherUnits,
      initialThread: 0,
      initialThreadUsed: threadUsed,
      initialXp,
      crafted: 0,
      label
    });
    assert.ok(allText(player).includes('You need some thread to make anything out of leather.'), `${label}: packed thread refusal message is missing`);
  }
}

// Coifs remain members-only in both batch sizes; no recipe state changes on a free world.
{
  const recipe = recipes.find(candidate => candidate.rowName === 'craft_coif');
  for (const amount of [5, 10]) {
    const label = `Coif Make${amount} free-world refusal`;
    withMembers(false, () => {
      const threadUsed = 4;
      const threadCount = 2;
      const leatherUnits = amount * recipe.ingredientCount;
      const player = makePlayer(recipe, { leatherUnits, threadCount, threadUsed });
      const initialXp = player.stats[craftingStat];
      dispatchBatch(player, recipe, amount);
      drainWeakQueue(player, label, amount);
      assertEffects(player, recipe, {
        initialLeather: leatherUnits,
        initialThread: threadCount,
        initialThreadUsed: threadUsed,
        initialXp,
        crafted: 0,
        label
      });
      assert.deepEqual(player.messages, [membersFeatureMessage], `${label}: exact members-world refusal message`);
    });
  }
}


// One reel from a fresh counter supports exactly five products, even for Make10.
{
  const recipe = recipes[0];
  const amount = 10;
  const player = makePlayer(recipe, {
    leatherUnits: amount * recipe.ingredientCount,
    threadCount: 1,
    threadUsed: 0
  });
  const initialXp = player.stats[craftingStat];
  dispatchBatch(player, recipe, amount);
  drainWeakQueue(player, 'one-reel thread exhaustion', amount);
  assertEffects(player, recipe, {
    initialLeather: amount * recipe.ingredientCount,
    initialThread: 1,
    initialThreadUsed: 0,
    initialXp,
    crafted: 5,
    label: 'one-reel thread exhaustion'
  });
  assert.deepEqual(player.messages, expectedMessages(recipe, 0, 5), 'one reel must preserve the five published soft-leather Make1 messages');
  assert.ok(allText(player).includes('You need some thread to make anything out of leather.'), 'the sixth attempt should report exhausted thread');
}

// The real Player stopAction method cancels the delayed weak queue before any craft begins.
{
  const recipe = recipes[0];
  const amount = 10;
  const leatherUnits = amount * recipe.ingredientCount;
  const threadCount = 2;
  const threadUsed = 0;
  const player = makePlayer(recipe, { leatherUnits, threadCount, threadUsed });
  const initialXp = player.stats[craftingStat];
  dispatchBatch(player, recipe, amount);
  assert.equal(queueCount(player), 1, 'stopAction fixture needs a real pending weak-queue request');
  player.stopAction();
  assert.equal(queueCount(player), 0, 'Player.stopAction should cancel the pending weak queue');
  for (let tick = 0; tick < 6; tick++) advanceTick(player);
  assertEffects(player, recipe, {
    initialLeather: leatherUnits,
    initialThread: threadCount,
    initialThreadUsed: threadUsed,
    initialXp,
    crafted: 0,
    label: 'stopAction interruption'
  });
}

console.log(`RESULT PASS (36 authored Make1 behavior cases, 14 exact batches, 14 leather-limited batches, level/thread/member refusals, queue cadence, exhaustion and stopAction interruption)`);
process.exit(0);
