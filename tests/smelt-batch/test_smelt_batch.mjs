#!/usr/bin/env node
/**
 * Packed smelting triggers through the production ScriptProvider, Player and handlers.
 * Run from the sibling engine after npm run build:
 *   node --import tsx ../content/tests/smelt-batch/test_smelt_batch.mjs
 *
 * SMELT_PACK selects a pack directory. Set SMELT_BASELINE_ONLY=1 against the published
 * pack to emit the single-smelt oracle; set BASELINE_PACK on the changed-pack run to
 * compare that oracle automatically. SMELT_BASELINE_JSON may instead name a saved JSON
 * snapshot emitted by the baseline-only mode.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_DIR = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_DIR, '../engine');
const BASELINE_ONLY = process.env.SMELT_BASELINE_ONLY === '1' || process.argv.includes('--baseline-only');
const BASELINE_PACK = process.env.BASELINE_PACK;
const PACK_DIR = path.resolve(
  process.env.SMELT_PACK ?? process.env.SMELT_PACK_DIR ??
    (BASELINE_ONLY && BASELINE_PACK ? BASELINE_PACK : path.join(ENGINE_DIR, 'data/pack'))
);
const SCRIPT_DAT = path.join(PACK_DIR, 'server/script.dat');
assert.ok(fs.existsSync(SCRIPT_DAT), `compiled content pack is missing at ${SCRIPT_DAT}`);

const eng = async relative => import(pathToFileURL(path.join(ENGINE_DIR, relative)).href);
const load = async relative => (await eng(relative)).default;
const World = await load('src/engine/World.ts');
const Player = await load('src/engine/entity/Player.ts');
const Loc = await load('src/engine/entity/Loc.ts');
const ScriptProvider = await load('src/engine/script/ScriptProvider.ts');
const ScriptRunner = await load('src/engine/script/ScriptRunner.ts');
const ScriptState = await load('src/engine/script/ScriptState.ts');
const ServerTriggerType = await load('src/engine/script/ServerTriggerType.ts');
const IfButtonHandler = await load('src/network/game/client/handler/IfButtonHandler.ts');
const ResumePCountDialogHandler = await load('src/network/game/client/handler/ResumePCountDialogHandler.ts');
const MoveClickHandler = await load('src/network/game/client/handler/MoveClickHandler.ts');
const IfButton = await load('src/network/game/client/model/IfButton.ts');
const ResumePCountDialog = await load('src/network/game/client/model/ResumePCountDialog.ts');
const MoveClick = await load('src/network/game/client/model/MoveClick.ts');
const IfSetText = await load('src/network/game/server/model/IfSetText.ts');
const { EntityLifeCycle } = await eng('src/engine/entity/EntityLifeCycle.js');
const { PlayerStat } = await eng('src/engine/entity/PlayerStat.js');
const { default: VarPlayerType } = await eng('src/cache/config/VarPlayerType.ts');
const { default: VarBitType } = await eng('src/cache/config/VarBitType.ts');
const { default: VarNpcType } = await eng('src/cache/config/VarNpcType.ts');
const { default: VarSharedType } = await eng('src/cache/config/VarSharedType.ts');
const { default: NpcType } = await eng('src/cache/config/NpcType.ts');
const { default: LocType } = await eng('src/cache/config/LocType.ts');
const { default: SeqType } = await eng('src/cache/config/SeqType.ts');
const { default: SpotanimType } = await eng('src/cache/config/SpotanimType.ts');
const { default: InvType } = await eng('src/cache/config/InvType.ts');
const { default: ObjType } = await eng('src/cache/config/ObjType.ts');
const { default: FontType } = await eng('src/cache/config/FontType.ts');
const { default: Component } = await eng('src/cache/config/Component.ts');
const { default: DbRowType } = await eng('src/cache/config/DbRowType.ts');
const { default: DbTableType } = await eng('src/cache/config/DbTableType.ts');
const { default: DbTableIndex } = await eng('src/cache/config/DbTableIndex.ts');
const { default: EnumType } = await eng('src/cache/config/EnumType.ts');
const { default: ParamType } = await eng('src/cache/config/ParamType.ts');
const { default: CategoryType } = await eng('src/cache/config/CategoryType.ts');
const { default: StructType } = await eng('src/cache/config/StructType.ts');
const { default: MesanimType } = await eng('src/cache/config/MesanimType.ts');

for (const config of [
  VarPlayerType, VarBitType, VarNpcType, VarSharedType, NpcType, LocType, SeqType,
  SpotanimType, InvType, ObjType, FontType, Component, DbRowType, DbTableType,
  EnumType, ParamType, CategoryType, StructType, MesanimType
]) {
  config.load(PACK_DIR);
}
DbTableIndex.init();
assert.ok(FontType.get(3), 'FontType q8_full is missing');
assert.ok(ScriptProvider.load(PACK_DIR) > 0, 'ScriptProvider.load returned no compiled scripts');
World.currentTick = 100;

const id = (type, name) => {
  const value = type.getId(name);
  assert.ok(value >= 0, `missing packed ${type.name ?? 'config'} ${name}`);
  return value;
};
const inventoryId = id(InvType, 'inv');
const furnaceId = id(LocType, 'furnace');
const furnaceType = LocType.get(furnaceId);
assert.ok(furnaceType, 'Furnace LocType is missing');
const smithingStat = PlayerStat.SMITHING;
const smeltingStructParam = id(ParamType, 'smelting_struct');
const recipeParamId = name => id(ParamType, name);
const valueOf = (struct, name) => struct.params.get(recipeParamId(name));
const namedObject = name => id(ObjType, name);
const barNames = [
  'bronze_bar', 'iron_bar', 'silver_bar', 'steel_bar',
  'gold_bar', 'mithril_bar', 'adamantite_bar', 'runite_bar'
];
const amountButtons = [
  { amount: 'X', offset: 0 }, { amount: 10, offset: 1 },
  { amount: 5, offset: 2 }, { amount: 1, offset: 3 }
];
const testedBars = [
  { name: 'silver_bar', primary: 'silver_ore', secondary: null, buttonBase: 20 },
  { name: 'steel_bar', primary: 'iron_ore', secondary: 'coal', buttonBase: 24 }
];

function recipeFor(barName, primaryName, secondaryName) {
  const barId = namedObject(barName);
  const obj = ObjType.get(barId);
  const structId = obj.params.get(smeltingStructParam);
  assert.equal(typeof structId, 'number', `${barName} must resolve its packed smelting_struct`);
  const struct = StructType.get(structId);
  assert.ok(struct, `${barName} smelting struct is missing`);
  const recipe = {
    barName,
    barId,
    primaryName,
    primaryId: namedObject(primaryName),
    primaryCount: valueOf(struct, 'bar_count'),
    secondaryName,
    secondaryId: secondaryName === null ? null : namedObject(secondaryName),
    secondaryCount: valueOf(struct, 'ingredient_secondary_count') ?? 0,
    level: valueOf(struct, 'levelrequired'),
    experience: valueOf(struct, 'productexp'),
    processMessage: valueOf(struct, 'processmessage'),
    productMessage: valueOf(struct, 'productmessage'),
    failureMessage: valueOf(struct, 'processfailure'),
    levelFailure: valueOf(struct, 'levelfailure')
  };
  assert.equal(valueOf(struct, 'ingredient'), recipe.primaryId, `${barName} primary ingredient`);
  assert.equal(valueOf(struct, 'ingredient_secondary') ?? null, recipe.secondaryId, `${barName} secondary ingredient`);
  for (const key of ['primaryCount', 'level', 'experience']) {
    assert.equal(typeof recipe[key], 'number', `${barName} recipe ${key} must be numeric`);
  }
  assert.equal(typeof recipe.processMessage, 'string', `${barName} process message is missing`);
  assert.equal(typeof recipe.productMessage, 'string', `${barName} product message is missing`);
  assert.equal(typeof recipe.levelFailure, 'string', `${barName} level refusal is missing`);
  if (secondaryName !== null) assert.equal(typeof recipe.secondaryCount, 'number', `${barName} secondary count`);
  return recipe;
}

const recipes = new Map(testedBars.map(bar => [
  bar.name,
  recipeFor(bar.name, bar.primary, bar.secondary)
]));

let nextPlayer = 0;
function makePlayer(smithingLevel = 99) {
  const slot = ++nextPlayer;
  const player = new Player(`smelt_batch_${slot}`, BigInt(slot), BigInt(slot));
  player.uid = slot;
  player.pid = slot;
  player.vars.fill(0);
  player.stats.fill(0);
  player.baseLevels.fill(1);
  player.levels.fill(1);
  player.setLevel(smithingStat, smithingLevel);
  player.level = 0;
  player.x = 3272;
  player.z = 3185;
  player.lastMovement = 0;
  player.messages = [];
  player.packets = [];
  player.textEvents = [];
  player.write = packet => {
    player.packets.push(packet);
    if (packet instanceof IfSetText) {
      const component = Component.get(packet.component);
      assert.ok(component, `IfSetText refers to unknown component ${packet.component}`);
      player.textEvents.push({ kind: 'interface', component: component.comName, text: packet.text });
    }
  };
  const recordMessage = text => {
    player.messages.push(text);
    player.textEvents.push({ kind: 'game', text });
  };
  player.messageGame = recordMessage;
  player.wrappedMessageGame = recordMessage;
  return player;
}

function inventory(player) {
  const value = player.getInventory(inventoryId);
  assert.ok(value, 'player inventory is missing');
  return value;
}
function count(player, itemName) {
  return inventory(player).getItemCount(namedObject(itemName));
}
function add(player, itemName, quantity) {
  if (quantity > 0) inventory(player).add(namedObject(itemName), quantity);
}
function addRecipeInputs(player, recipe, bars) {
  const primaryCount = recipe.primaryCount * bars;
  const secondaryCount = recipe.secondaryCount * bars;
  if (primaryCount + secondaryCount > inventory(player).capacity) {
    // Ten steel bars need thirty unstackable ores; seed counted slots for this packed-only case.
    inventory(player).set(0, { id: recipe.primaryId, count: primaryCount });
    if (recipe.secondaryId !== null) inventory(player).set(1, { id: recipe.secondaryId, count: secondaryCount });
    return;
  }
  add(player, recipe.primaryName, primaryCount);
  if (recipe.secondaryName !== null) add(player, recipe.secondaryName, secondaryCount);
}
function weakQueueLength(player) {
  return Array.from(player.weakQueue.all()).length;
}
function furnace() {
  return new Loc(
    0, 3272, 3185, furnaceType.width, furnaceType.length,
    EntityLifeCycle.RESPAWN, furnaceId, 10, 0
  );
}
function openSmeltingInterface(player) {
  const target = furnace();
  player.target = target;
  player.targetOp = ServerTriggerType.OPLOC2 - 7;
  const trigger = player.getOpTrigger();
  const expected = ScriptProvider.getByName('[oploc2,_smithing_furnace]');
  assert.ok(expected, 'packed [oploc2,_smithing_furnace] is missing');
  assert.equal(trigger, expected, 'furnace op2 must resolve through the packed loc category trigger');
  const state = ScriptRunner.init(trigger, player, target);
  player.executeScript(state, true, true);
  assert.equal(state.execution, ScriptState.FINISHED, 'furnace Smelt option should finish opening the interface');
  const chat = id(Component, 'smelting');
  assert.equal(player.modalChat, chat, 'smelting menu must open in the chat area');
  assert.equal(player.modalMain, -1, 'smelting menu must not replace the main viewport interface');
}

const buttonHandler = new IfButtonHandler();
const countDialogHandler = new ResumePCountDialogHandler();
function selectAmount(player, bar, amount, countDialogValue = null, expectQueued = true) {
  const selected = amountButtons.find(button => button.amount === amount);
  assert.ok(selected, `unsupported smelt amount ${amount}`);
  const componentName = `smelting:com_${bar.buttonBase + selected.offset}`;
  const component = id(Component, componentName);
  assert.ok(ScriptProvider.getByName(`[if_button,${componentName}]`), `packed button trigger is missing for ${componentName}`);
  assert.equal(buttonHandler.handle(new IfButton(component), player), true, `${bar.name} ${amount} button should be accepted`);
  if (amount === 'X') {
    assert.ok(player.activeScript, `${bar.name} Make-X should open the count dialog`);
    assert.equal(player.activeScript.execution, ScriptState.COUNTDIALOG, `${bar.name} Make-X should suspend for a count`);
    assert.equal(typeof countDialogValue, 'number', 'Make-X needs a numeric count-dialog input');
    assert.equal(countDialogHandler.handle(new ResumePCountDialog(countDialogValue), player), true, 'count dialog input should resume the Make-X script');
  }
  const hasContinuation = expectQueued && (amount === 'X' ? countDialogValue : amount) > 1;
  assert.equal(weakQueueLength(player), hasContinuation ? 1 : 0, `${bar.name} ${amount} continuation admission`);
}

function advancePlayerTick(player) {
  World.currentTick++;
  if (player.delayed && World.currentTick >= player.delayedUntil) player.delayed = false;
  if (!player.delayed && player.activeScript && player.activeScript.execution === ScriptState.SUSPENDED) {
    player.executeScript(player.activeScript, true, true);
  }
  player.processQueues();
}
function driveUntilIdle(player, maxTicks = 120) {
  for (let tick = 0; tick < maxTicks; tick++) {
    const state = player.activeScript?.execution;
    if (state === ScriptState.COUNTDIALOG || state === ScriptState.PAUSEBUTTON) return;
    if (!player.activeScript && weakQueueLength(player) === 0) return;
    advancePlayerTick(player);
  }
  assert.fail(`player did not settle: active=${player.activeScript?.execution} weak=${weakQueueLength(player)}`);
}
function expectedMessages(recipe, bars) {
  return Array.from({ length: bars }, () => [recipe.processMessage, recipe.productMessage]).flat();
}
function countTextEvents(player, value) {
  return player.textEvents.filter(event => event.text === value).length;
}

// The baseline-only run is intentionally limited to the legacy item-on-furnace route,
// so it works with the published pack that has none of the new interface triggers.
const singleObservations = [];
for (const bar of testedBars) {
  const recipe = recipes.get(bar.name);
  const player = makePlayer(99);
  World.currentTick = 100;
  add(player, recipe.primaryName, recipe.primaryCount);
  if (recipe.secondaryName !== null) add(player, recipe.secondaryName, recipe.secondaryCount);
  player.lastUseItem = recipe.primaryId;
  player.lastUseSlot = 0;
  const trigger = ScriptProvider.getByName('[oplocu,_smithing_furnace]');
  assert.ok(trigger, 'published item-on-furnace trigger is missing');
  const state = ScriptRunner.init(trigger, player, furnace());
  const experienceBefore = player.stats[smithingStat];
  player.executeScript(state, true, true);
  driveUntilIdle(player, 16);
  assert.equal(state.execution, ScriptState.FINISHED, `${recipe.barName} item-on-furnace smelt should finish`);
  assert.equal(count(player, recipe.primaryName), 0, `${recipe.barName} item-on-furnace primary consumption`);
  if (recipe.secondaryName !== null) assert.equal(count(player, recipe.secondaryName), 0, `${recipe.barName} item-on-furnace secondary consumption`);
  assert.equal(count(player, recipe.barName), 1, `${recipe.barName} item-on-furnace product`);
  const observation = {
    bar: recipe.barName,
    produced: count(player, recipe.barName),
    primaryRemaining: count(player, recipe.primaryName),
    secondaryRemaining: recipe.secondaryName === null ? 0 : count(player, recipe.secondaryName),
    experience: player.stats[smithingStat] - experienceBefore,
    messages: player.textEvents
  };
  assert.equal(observation.experience, recipe.experience, `${recipe.barName} single-smelt XP`);
  assert.equal(player.messages.filter(text => text === recipe.processMessage).length, 1, `${recipe.barName} single-smelt process message`);
  assert.equal(player.messages.filter(text => text === recipe.productMessage).length, 1, `${recipe.barName} single-smelt product message`);
  singleObservations.push(observation);
}

if (BASELINE_ONLY) {
  process.stdout.write(`SMELT_SINGLE_BASELINE=${JSON.stringify(singleObservations)}\n`);
  process.exit(0);
}
World.gameMap.init();

// Every interface button must resolve by its name; generated IDs are resolved from the
// built pack at runtime rather than copied into the test.
for (let barIndex = 0; barIndex < barNames.length; barIndex++) {
  const base = 12 + barIndex * 4;
  for (const button of amountButtons) {
    const componentName = `smelting:com_${base + button.offset}`;
    id(Component, componentName);
    assert.ok(
      ScriptProvider.getByName(`[if_button,${componentName}]`),
      `packed ${button.amount} button is missing for ${barNames[barIndex]}`
    );
  }
}
assert.ok(ScriptProvider.getByName('[label,smelt_ore]'), 'published single-smelt ore label is missing');
assert.ok(ScriptProvider.getByName('[label,smelt_ore_makex]'), 'packed Make-X label is missing');
assert.ok(ScriptProvider.getByName('[queue,smelt_ore_weakqueue]'), 'packed smelting weak queue is missing');

if (!BASELINE_PACK && !process.env.SMELT_BASELINE_JSON) {
  console.warn('BASELINE_PACK or SMELT_BASELINE_JSON not set; published single-smelt comparison was not run');
} else {
  let baseline;
  if (process.env.SMELT_BASELINE_JSON) {
    const serialized = fs.readFileSync(path.resolve(process.env.SMELT_BASELINE_JSON), 'utf8');
    const line = serialized.split(/\r?\n/).find(value => value.startsWith('SMELT_SINGLE_BASELINE='));
    baseline = line ? JSON.parse(line.slice('SMELT_SINGLE_BASELINE='.length)) : JSON.parse(serialized);
  } else {
    const baselinePack = path.resolve(BASELINE_PACK);
    const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        SMELT_PACK: baselinePack,
        SMELT_BASELINE_ONLY: '1'
      }
    });
    assert.equal(result.status, 0, `published baseline capture failed: ${result.stderr || result.stdout}`);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('SMELT_SINGLE_BASELINE='));
    assert.ok(line, `published baseline capture emitted no snapshot: ${result.stdout}`);
    baseline = JSON.parse(line.slice('SMELT_SINGLE_BASELINE='.length));
  }
  assert.deepEqual(singleObservations, baseline, 'item-on-furnace consumption, Smithing XP and messages must match the published pack');
}

// Check every fixed quantity and Make-X on both a deterministic single-ore bar and a
// deterministic ore-plus-coal bar. Each run uses the actual packed button and input handler.
const passingCases = [];
for (const bar of testedBars) {
  const recipe = recipes.get(bar.name);
  for (const { amount } of amountButtons) {
    const quantity = amount === 'X' ? 7 : amount;
    World.currentTick = 100;
    const player = makePlayer(99);
    addRecipeInputs(player, recipe, quantity);
    const experienceBefore = player.stats[smithingStat];
    openSmeltingInterface(player);
    const startTick = World.currentTick;
    selectAmount(player, bar, amount, amount === 'X' ? quantity : null);
    const productTicks = [];
    let observedProducts = 0;
    for (let tick = 0; tick < quantity * 6 + 12; tick++) {
      const state = player.activeScript?.execution;
      if (state === ScriptState.COUNTDIALOG || state === ScriptState.PAUSEBUTTON) break;
      if (!player.activeScript && weakQueueLength(player) === 0) break;
      advancePlayerTick(player);
      const products = count(player, recipe.barName);
      while (observedProducts < products) {
        productTicks.push(World.currentTick);
        observedProducts++;
      }
    }
    assert.equal(observedProducts, quantity, `${bar.name} ${amount} product count`);
    assert.equal(count(player, recipe.primaryName), 0, `${bar.name} ${amount} primary ore consumption`);
    if (recipe.secondaryName !== null) assert.equal(count(player, recipe.secondaryName), 0, `${bar.name} ${amount} secondary coal consumption`);
    assert.equal(count(player, recipe.barName), quantity, `${bar.name} ${amount} bars produced`);
    assert.equal(player.stats[smithingStat] - experienceBefore, recipe.experience * quantity, `${bar.name} ${amount} Smithing XP`);
    assert.deepEqual(player.messages, expectedMessages(recipe, quantity), `${bar.name} ${amount} process/product messages`);
    assert.equal(productTicks[0], startTick + 4, `${bar.name} ${amount} first bar interval`);
    assert.deepEqual(
      productTicks.slice(1).map((tick, index) => tick - productTicks[index]),
      Array(quantity - 1).fill(4),
      `${bar.name} ${amount} bars must be produced at four-tick intervals`
    );
    assert.equal(weakQueueLength(player), 0, `${bar.name} ${amount} must finish without pending weak work`);
    passingCases.push(`${bar.name} ${amount}`);
  }
}

// Exhausted silver ore stops a requested batch after the available three bars.
{
  const recipe = recipes.get('silver_bar');
  World.currentTick = 100;
  const player = makePlayer(99);
  add(player, recipe.primaryName, recipe.primaryCount * 3);
  const experienceBefore = player.stats[smithingStat];
  openSmeltingInterface(player);
  selectAmount(player, testedBars[0], 10);
  driveUntilIdle(player, 80);
  assert.equal(count(player, recipe.barName), 3, 'silver smelting must stop when silver ore runs out');
  assert.equal(count(player, recipe.primaryName), 0, 'silver ore depletion must be exact');
  assert.equal(player.stats[smithingStat] - experienceBefore, recipe.experience * 3, 'silver depletion Smithing XP');
  assert.deepEqual(player.messages, expectedMessages(recipe, 3), 'silver depletion must retain exactly three single-smelt messages');
  assert.equal(weakQueueLength(player), 0, 'silver depletion must leave no weak continuation');
}

// Steel depletion is specifically coal exhaustion: spare iron proves no extra bar can be made.
{
  const recipe = recipes.get('steel_bar');
  World.currentTick = 100;
  const player = makePlayer(99);
  add(player, recipe.primaryName, recipe.primaryCount * 5);
  add(player, recipe.secondaryName, recipe.secondaryCount);
  const experienceBefore = player.stats[smithingStat];
  openSmeltingInterface(player);
  selectAmount(player, testedBars[1], 10);
  driveUntilIdle(player, 80);
  assert.equal(count(player, recipe.barName), 1, 'steel smelting must stop when coal runs out');
  assert.equal(count(player, recipe.primaryName), recipe.primaryCount * 4, 'coal depletion must not consume spare iron');
  assert.equal(count(player, recipe.secondaryName), 0, 'steel coal depletion must be exact');
  assert.equal(player.stats[smithingStat] - experienceBefore, recipe.experience, 'steel depletion Smithing XP');
  assert.deepEqual(player.messages, expectedMessages(recipe, 1), 'steel depletion must preserve the one completed smelt messages');
  assert.equal(countTextEvents(player, recipe.failureMessage), 1, 'published steel ingredient refusal must be shown once');
  assert.equal(weakQueueLength(player), 0, 'steel depletion must leave no weak continuation');
}

// A level refusal runs the packed failure text and consumes no item or experience.
for (const bar of testedBars) {
  const recipe = recipes.get(bar.name);
  World.currentTick = 100;
  const player = makePlayer(recipe.level - 1);
  add(player, recipe.primaryName, recipe.primaryCount);
  if (recipe.secondaryName !== null) add(player, recipe.secondaryName, recipe.secondaryCount);
  const experienceBefore = player.stats[smithingStat];
  openSmeltingInterface(player);
  selectAmount(player, bar, 1, null, false);
  driveUntilIdle(player, 16);
  assert.equal(count(player, recipe.barName), 0, `${bar.name} below level must not make a bar`);
  assert.equal(count(player, recipe.primaryName), recipe.primaryCount, `${bar.name} below level must preserve primary ore`);
  if (recipe.secondaryName !== null) assert.equal(count(player, recipe.secondaryName), recipe.secondaryCount, `${bar.name} below level must preserve coal`);
  assert.equal(player.stats[smithingStat] - experienceBefore, 0, `${bar.name} below level must award no XP`);
  assert.equal(countTextEvents(player, recipe.levelFailure), 1, `${bar.name} published level refusal must be shown once`);
  assert.equal(weakQueueLength(player), 0, `${bar.name} level refusal must not queue another smelt`);
}

// Exercise the actual MoveClickHandler path after the action delay expires.
// Dispatch before draining player queues; the in-flight smelt completes but its
// weak-queued continuation is cleared by Player.clearPendingAction.
{
  const recipe = recipes.get('silver_bar');
  World.currentTick = 100;
  const player = makePlayer(99);
  add(player, recipe.primaryName, recipe.primaryCount * 5);
  openSmeltingInterface(player);
  selectAmount(player, testedBars[0], 5);
  assert.equal(weakQueueLength(player), 1, 'batch continuation must be pending before movement');
  World.currentTick = player.delayedUntil;
  player.delayed = false;
  const movement = new MoveClickHandler();
  assert.equal(
    movement.handle(new MoveClick([{ x: player.x + 1, z: player.z }], 0, false), player),
    true,
    'movement must be accepted after the action delay expires'
  );
  assert.equal(weakQueueLength(player), 0, 'accepted movement must clear the engine weak queue');
  driveUntilIdle(player, 24);
  assert.equal(count(player, recipe.barName), 1, 'the in-flight smelt may finish, but walking must stop the batch');
  assert.equal(count(player, recipe.primaryName), recipe.primaryCount * 4, 'walking must preserve the unprocessed silver ore');
  assert.equal(weakQueueLength(player), 0, 'movement interruption must not leave a continuation');
}

console.log(`RESULT PASS smelt-batch: ${passingCases.length} amount/button cases, depletion, level refusal, movement interruption and packed single-smelt baseline`);
// Production imports retain engine resources; match the standalone packed-test lifecycle.
process.exit(0);
