#!/usr/bin/env node
/**
 * Compiled soft-leather regression through production Player scripts, interface
 * button dispatch, and the real weak queue. Run after building the sibling engine:
 *   node --import tsx ../content/tests/leather-batch/test_leather_batch.mjs
 *
 * Before the leather script change, capture the published Make1 oracle with:
 *   LEATHER_PACK_DIR=/path/to/published-pack node --import tsx \
 *     ../content/tests/leather-batch/test_leather_batch.mjs --capture-one \
 *     ../content/tests/leather-batch/make1-baseline.json
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_DIR = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_DIR, '../engine');
const PACK_DIR = path.resolve(process.env.LEATHER_PACK_DIR ?? path.join(ENGINE_DIR, 'data/pack'));
const SCRIPT_DAT = path.join(PACK_DIR, 'server/script.dat');
const captureOne = process.argv[2] === '--capture-one';
if (captureOne ? process.argv.length !== 4 : process.argv.length !== 2) {
  throw new Error('Usage: test_leather_batch.mjs [--capture-one <json-path>]');
}
const capturePath = captureOne ? path.resolve(process.argv[3]) : null;
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

const recipes = [
  ['craft_leather_body', 'leather_crafting:com_113', 'leather_crafting:com_112', 'leather_crafting:com_111'],
  ['craft_leather_gloves', 'leather_crafting:com_116', 'leather_crafting:com_115', 'leather_crafting:com_114'],
  ['craft_leather_boots', 'leather_crafting:com_119', 'leather_crafting:com_118', 'leather_crafting:com_117'],
  ['craft_leather_vambraces', 'leather_crafting:com_122', 'leather_crafting:com_121', 'leather_crafting:com_120'],
  ['craft_leather_chaps', 'leather_crafting:com_125', 'leather_crafting:com_124', 'leather_crafting:com_123'],
  ['craft_coif', 'leather_crafting:com_128', 'leather_crafting:com_127', 'leather_crafting:com_126'],
  ['craft_leather_cowl', 'leather_crafting:com_131', 'leather_crafting:com_130', 'leather_crafting:com_129']
].map(([rowName, make1Name, make5Name, make10Name]) => {
  const rowId = namedId(DbRowType, rowName, 'DBRow');
  const row = DbRowType.get(rowId);
  assert.ok(row, `DBRow ${rowName} is missing`);
  const leather = fieldValues(row, 'leather');
  assert.equal(leather.length, 2, `${rowName}.leather should contain item and quantity`);
  const product = scalar(row, 'product');
  assert.ok(ObjType.get(product), `${rowName} product is missing from ObjType`);
  assert.equal(leather[0], leatherId, `${rowName} should use soft leather`);
  return {
    rowName,
    name: scalar(row, 'name'),
    product: Number(product),
    productName: ObjType.get(product).debugname,
    productExp: Number(scalar(row, 'productexp')),
    levelRequired: Number(scalar(row, 'levelrequired')),
    membersOnly: Boolean(scalar(row, 'members')),
    ingredient: Number(leather[0]),
    ingredientCount: Number(leather[1]),
    make1: namedId(Component, make1Name, 'component'),
    make5: namedId(Component, make5Name, 'component'),
    make10: namedId(Component, make10Name, 'component')
  };
});
assert.equal(recipes.length, 7, 'all seven soft-leather product rows must be covered');
assert.ok(recipes.find(recipe => recipe.rowName === 'craft_coif')?.membersOnly, 'the Coif row must retain its members-only restriction');

const buttonHandler = new IfButtonHandler();
const baseCraftingXp = 130344310;
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
function snapshot(player, recipe) {
  const inventory = inventoryOf(player);
  return {
    leather: inventory.getItemCount(recipe.ingredient),
    product: inventory.getItemCount(recipe.product),
    thread: inventory.getItemCount(threadId),
    needle: inventory.getItemCount(needleId),
    threadUsed: player.getVar(threadUsedVarp),
    craftingXp: player.stats[craftingStat],
    craftingLevel: player.levels[craftingStat],
    messages: [...player.messages],
    packetTypes: player.packets.map(packet => packet?.constructor?.name ?? typeof packet),
    packetText: packetStrings(player.packets),
    modal: [player.modalMain, player.modalChat, player.modalSide]
  };
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
      recipe,
      threadUsed: 4,
      threadCount: 2,
      leatherUnits: recipe.ingredientCount,
      craftingLevel: recipe.levelRequired - 1,
      members: true
    });
    scenarios.push({
      key: `${recipe.rowName}:insufficient-leather`,
      recipe,
      threadUsed: 4,
      threadCount: 2,
      leatherUnits: Math.max(0, recipe.ingredientCount - 1),
      craftingLevel: 99,
      members: true
    });
    scenarios.push({
      key: `${recipe.rowName}:no-thread`,
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
    clickButton(player, recipe.make1, `${recipe.rowName} Make1`);
    assert.deepEqual(player.animations, [], `${scenario.key}: published Make1 has no animation`);
    return snapshot(player, recipe);
  });
}

const make1Scenarios = makeOneScenarios();
if (captureOne) {
  const cases = {};
  for (const scenario of make1Scenarios) cases[scenario.key] = runMakeOne(scenario);
  fs.mkdirSync(path.dirname(capturePath), { recursive: true });
  fs.writeFileSync(capturePath, `${JSON.stringify({ schema: 1, cases }, null, 2)}\n`);
  console.log(`RESULT PASS (captured ${Object.keys(cases).length} published Make1 cases)`);
  process.exit(0);
}

for (const recipe of recipes) {
  for (const [amount, component] of [[5, recipe.make5], [10, recipe.make10]]) {
    const trigger = ScriptProvider.getByTriggerSpecific(ServerTriggerType.IF_BUTTON, component, -1);
    assert.ok(trigger, `${recipe.rowName} Make${amount} trigger is missing; old packs intentionally fail normal mode`);
  }
}

const baselinePath = path.join(CONTENT_DIR, 'tests/leather-batch/make1-baseline.json');
assert.ok(fs.existsSync(baselinePath), 'published Make1 baseline is missing; run this test once with --capture-one against the retained pre-change pack');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
assert.equal(baseline.schema, 1, 'unsupported Make1 baseline schema');
assert.deepEqual(Object.keys(baseline.cases).sort(), make1Scenarios.map(scenario => scenario.key).sort(), 'Make1 baseline case inventory changed');
for (const scenario of make1Scenarios) {
  assert.deepEqual(
    runMakeOne(scenario),
    baseline.cases[scenario.key],
    `${scenario.key}: changed Make1 must match the published packed behavior exactly`
  );
}

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
function assertEffects(player, recipe, {
  initialLeather,
  initialThread,
  initialThreadUsed,
  initialXp,
  crafted,
  label
}) {
  assert.equal(itemCount(player, recipe.ingredient), initialLeather - crafted * recipe.ingredientCount, `${label}: exact leather debit`);
  assert.equal(itemCount(player, recipe.product), crafted, `${label}: exact product count`);
  assert.equal(itemCount(player, threadId), initialThread - Math.floor((initialThreadUsed + crafted) / 5), `${label}: exact reel debit`);
  assert.equal(player.getVar(threadUsedVarp), (initialThreadUsed + crafted) % 5, `${label}: exact thread_used counter`);
  assert.equal(player.stats[craftingStat] - initialXp, crafted * recipe.productExp, `${label}: exact Crafting XP`);
}

// All published refusal classes must match Make1 at dispatch, before any queue tick.
for (const scenario of make1Scenarios.filter(scenario => !scenario.key.includes(':success-'))) {
  for (const amount of [5, 10]) {
    withMembers(scenario.members, () => {
      const { recipe } = scenario;
      const label = `${scenario.key} Make${amount} immediate refusal`;
      const player = makePlayer(recipe, scenario);
      if (scenario.removeThreadAfterOpen) inventoryOf(player).remove(threadId, itemCount(player, threadId));
      const pressTick = World.currentTick;
      dispatchBatch(player, recipe, amount);
      assert.equal(World.currentTick, pressTick, `${label}: refusal must occur on the press tick`);
      assert.equal(queueCount(player), 0, `${label}: refusal must not queue a batch`);
      assert.deepEqual(player.animations, [], `${label}: refusal must not animate`);
      assert.deepEqual(snapshot(player, recipe), baseline.cases[scenario.key], `${label}: same text, packets and interface state as published Make1`);
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
  const publishedMemberMessages = baseline.cases['craft_coif:free-world'].messages;
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
      assert.ok(publishedMemberMessages.some(message => player.messages.includes(message)), `${label}: published members-feature refusal message is missing`);
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

console.log(`RESULT PASS (36 published Make1 cases, 14 exact batches, 14 leather-limited batches, level/thread/member refusals, queue cadence, exhaustion and stopAction interruption)`);
process.exit(0);
