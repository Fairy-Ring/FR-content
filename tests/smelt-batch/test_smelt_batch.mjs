#!/usr/bin/env node
/**
 * Packed smelting triggers through the production ScriptProvider, Player and handlers.
 * Run from the sibling engine after npm run build:
 *   node --import tsx ../content/tests/smelt-batch/test_smelt_batch.mjs
 * Set SMELT_GROUP=T1 (or --group T1) to run one independently selectable group.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_DIR = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_DIR, '../engine');
const groupArgIndex = process.argv.indexOf('--group');
const groupInlineArg = process.argv.find(argument => argument.startsWith('--group='));
const groupFromArg = groupInlineArg
  ? groupInlineArg.slice('--group='.length)
  : groupArgIndex >= 0 ? (process.argv[groupArgIndex + 1] ?? '') : null;
const requestedGroup = process.env.SMELT_TEST_GROUP ?? process.env.SMELT_GROUP ?? groupFromArg;
assert.ok(requestedGroup == null || ['T1', 'T2', 'T3', 'T4'].includes(requestedGroup), `unknown smelt test group ${requestedGroup}`);
const runGroup = name => requestedGroup == null || requestedGroup === name;
const PACK_DIR = path.resolve(
  process.env.SMELT_PACK ?? process.env.SMELT_PACK_DIR ?? path.join(ENGINE_DIR, 'data/pack')
);
const SCRIPT_DAT = path.join(PACK_DIR, 'server/script.dat');
assert.ok(fs.existsSync(SCRIPT_DAT), `compiled content pack is missing at ${SCRIPT_DAT}`);
const synthNames = new Map(fs.readFileSync(path.join(CONTENT_DIR, 'pack/synth.pack'), 'utf8')
  .split(/\r?\n/).filter(Boolean).map(line => {
    const at = line.indexOf('=');
    return [Number(line.slice(0, at)), line.slice(at + 1)];
  }));

const eng = async relative => import(pathToFileURL(path.join(ENGINE_DIR, relative)).href);
const load = async relative => (await eng(relative)).default;
const World = await load('src/engine/World.ts');
const Player = await load('src/engine/entity/Player.ts');
const Loc = await load('src/engine/entity/Loc.ts');
const JavaRandom = await load('src/util/JavaRandom.ts');
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
World.gameMap.init();
World.currentTick = 100;

const id = (type, name) => {
  const value = type.getId(name);
  assert.ok(value >= 0, `missing packed ${type.name ?? 'config'} ${name}`);
  return value;
};
const inventoryId = id(InvType, 'inv');
const wornInventoryId = id(InvType, 'worn');
const ringVarpId = id(VarPlayerType, 'ring_of_forging');
const actionDelayVarpId = id(VarPlayerType, 'action_delay');
const vikingVarpId = id(VarPlayerType, 'viking');
const vikingComplete = 10;
const smithingStat = PlayerStat.SMITHING;
const smeltingStructParam = id(ParamType, 'smelting_struct');
const recipeParamId = name => id(ParamType, name);
const valueOf = (struct, name) => struct.params.get(recipeParamId(name));
const namedObject = name => id(ObjType, name);
const menuBars = [
  { name: 'bronze_bar', primary: 'copper_ore', secondary: 'tin_ore', buttonBase: 12 },
  { name: 'iron_bar', primary: 'iron_ore', secondary: null, buttonBase: 16 },
  { name: 'silver_bar', primary: 'silver_ore', secondary: null, buttonBase: 20 },
  { name: 'steel_bar', primary: 'iron_ore', secondary: 'coal', buttonBase: 24 },
  { name: 'gold_bar', primary: 'gold_ore', secondary: null, buttonBase: 28 },
  { name: 'mithril_bar', primary: 'mithril_ore', secondary: 'coal', buttonBase: 32 },
  { name: 'adamantite_bar', primary: 'adamantite_ore', secondary: 'coal', buttonBase: 36 },
  { name: 'runite_bar', primary: 'runite_ore', secondary: 'coal', buttonBase: 40 }
];
const recipeSpecs = [
  ...menuBars,
  { name: 'perfect_gold_bar', primary: 'perfect_gold_ore', secondary: null, buttonBase: 28, menuBarName: 'gold_bar' }
];
const amountButtons = [
  { amount: 'X', offset: 0 }, { amount: 10, offset: 1 },
  { amount: 5, offset: 2 }, { amount: 1, offset: 3 }
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

const recipes = new Map(recipeSpecs.map(spec => [
  spec.name,
  {
    ...recipeFor(spec.name, spec.primary, spec.secondary),
    name: spec.name,
    buttonBase: spec.buttonBase,
    menuBarName: spec.menuBarName ?? spec.name
  }
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
  player.traceEvents = [];
  player.write = packet => {
    player.packets.push(packet);
    if (packet instanceof IfSetText) {
      const component = Component.get(packet.component);
      assert.ok(component, `IfSetText refers to unknown component ${packet.component}`);
      player.textEvents.push({ kind: 'interface', component: component.comName, text: packet.text });
      player.traceEvents.push({ kind: 'interface_text', text: packet.text });
    } else if (packet.constructor.name === 'SynthSound') {
      const synth = synthNames.get(packet.synth);
      assert.ok(synth, `unknown emitted synth ${packet.synth}`);
      player.traceEvents.push({
        kind: 'sound', synth, loops: packet.loops, delay: packet.delay
      });
    }
  };
  const recordMessage = text => {
    player.messages.push(text);
    player.textEvents.push({ kind: 'game', text });
    player.traceEvents.push({ kind: 'game', text });
  };
  const playAnimation = player.playAnimation.bind(player);
  player.playAnimation = (sequence, delay) => {
    player.traceEvents.push({
      kind: 'animation',
      sequence: SeqType.get(sequence)?.debugname ?? sequence,
      delay
    });
    return playAnimation(sequence, delay);
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
function countWorn(player, itemName) {
  const worn = player.getInventory(wornInventoryId);
  assert.ok(worn, 'player worn inventory is missing');
  return worn.getItemCount(namedObject(itemName));
}
function addWorn(player, itemName, quantity) {
  if (quantity > 0) player.getInventory(wornInventoryId).add(namedObject(itemName), quantity);
}
function setCountedItems(player, items) {
  let slot = 0;
  for (const [name, quantity] of Object.entries(items)) {
    if (quantity <= 0) continue;
    assert.ok(slot < inventory(player).capacity, 'counted packed fixture exceeds inventory slots');
    inventory(player).set(slot++, { id: namedObject(name), count: quantity });
  }
}
function interfaceText(player) {
  return player.textEvents.filter(event => event.kind === 'interface').map(event => event.text).join(' ');
}
function withForcedRandom(value, callback) {
  const original = JavaRandom.nextDouble;
  JavaRandom.nextDouble = () => value;
  try {
    return callback();
  } finally {
    JavaRandom.nextDouble = original;
  }
}
function traceFrame(player, scenario, experienceBefore, tick) {
  const events = player.traceEvents.splice(0);
  const dialogTextParts = events.filter(event => event.kind === 'interface_text').map(event => event.text);
  const traceEvents = events.filter(event => event.kind !== 'interface_text');
  return {
    tick,
    delayed: player.delayed,
    inventory: {
      primary: count(player, scenario.primary),
      secondary: scenario.secondary === null ? 0 : count(player, scenario.secondary),
      bar: scenario.bar === null ? 0 : count(player, scenario.bar),
      wornRing: countWorn(player, 'ring_of_forging'),
      wornGauntlets: countWorn(player, 'gauntlets_of_goldsmithing')
    },
    experience: player.stats[smithingStat] - experienceBefore,
    ringCharge: player.vars[ringVarpId],
    dialogOpen: player.modalChat !== -1,
    dialogText: dialogTextParts.length === 0 ? null : dialogTextParts.join(' '),
    events: traceEvents
  };
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
function furnace(typeName = 'furnace') {
  const locId = id(LocType, typeName);
  const type = LocType.get(locId);
  assert.ok(type, `${typeName} LocType is missing`);
  return new Loc(
    0, 3272, 3185, type.width, type.length,
    EntityLifeCycle.RESPAWN, locId, 10, 0
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
  assert.equal(weakQueueLength(player), expectQueued ? 1 : 0, `${bar.name} ${amount} pending completion`);
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

function readRequiredFixture(name) {
  const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name);
  assert.ok(fs.existsSync(fixturePath), `required committed smelt fixture is missing: ${name}`);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

if (runGroup('T1')) {
  const fixture = readRequiredFixture('single-smelt-donor-trace.json');
  assert.equal(fixture.entryDelay, 2, 'donor single smelt must enter the weak queue with delay 2');
  assert.equal(fixture.finishTick, fixture.triggerTick + 3, 'donor single smelt must finish three ticks after triggering');
  assert.deepEqual(fixture.ticks, [100, 101, 102, 103], 'single trace must include trigger through finish ticks');
  const trigger = ScriptProvider.getByName('[oplocu,_smithing_furnace]');
  assert.ok(trigger, 'packed item-on-furnace trigger is missing');

  for (const scenario of fixture.cases) {
    World.currentTick = fixture.triggerTick;
    const player = makePlayer(scenario.level);
    for (const [itemName, quantity] of Object.entries(scenario.items)) add(player, itemName, quantity);
    for (const [itemName, quantity] of Object.entries(scenario.worn)) addWorn(player, itemName, quantity);
    player.vars[ringVarpId] = scenario.ringCharge;
    player.lastUseItem = namedObject(scenario.use);
    player.lastUseSlot = inventory(player).getItemIndex(player.lastUseItem);
    const state = ScriptRunner.init(trigger, player, furnace());
    const experienceBefore = player.stats[smithingStat];
    const observe = () => {
      player.executeScript(state, true, true);
      const frames = [traceFrame(player, scenario, experienceBefore, World.currentTick)];
      for (const tick of fixture.ticks.slice(1)) {
        advancePlayerTick(player);
        if (scenario.walkAt === World.currentTick) {
          const movement = new MoveClickHandler();
          assert.equal(
            movement.handle(new MoveClick([{ x: player.x + 1, z: player.z }], 0, false), player),
            true,
            `${scenario.name} walk before finish must be accepted`
          );
          assert.equal(weakQueueLength(player), 0, `${scenario.name} walk must cancel the weak-queue finish`);
        }
        frames.push(traceFrame(player, scenario, experienceBefore, World.currentTick));
      }
      return frames;
    };
    const frames = scenario.forceRandom === null
      ? observe()
      : withForcedRandom(scenario.forceRandom, observe);
    const actual = {
      ticks: frames.map(frame => frame.tick),
      delayed: frames.map(frame => frame.delayed),
      inventory: frames.map(frame => frame.inventory),
      experience: frames.map(frame => frame.experience),
      ringCharge: frames.map(frame => frame.ringCharge),
      dialogOpen: frames.map(frame => frame.dialogOpen),
      dialogText: frames.map(frame => frame.dialogText),
      events: frames.map(frame => frame.events)
    };
    assert.deepEqual(actual.ticks, fixture.ticks, `${scenario.name} observed tick sequence`);
    assert.deepEqual(actual.delayed, scenario.expected.delayed, `${scenario.name} delayed state per tick`);
    assert.deepEqual(actual.inventory, scenario.expected.inventory, `${scenario.name} inventory per tick`);
    assert.deepEqual(actual.experience, scenario.expected.experience, `${scenario.name} Smithing XP per tick`);
    assert.deepEqual(actual.ringCharge, scenario.expected.ringCharge, `${scenario.name} ring charge per tick`);
    assert.deepEqual(actual.dialogOpen, scenario.expected.dialogOpen, `${scenario.name} dialog state per tick`);
    assert.deepEqual(actual.dialogText, scenario.expected.dialogText, `${scenario.name} dialog text per tick`);
    assert.deepEqual(actual.events, scenario.expected.events, `${scenario.name} animation, sound and message trace`);
  }
  console.log(`RESULT PASS smelt-batch T1: ${fixture.cases.length} donor-traced single cases`);
}

if (runGroup('T2')) {
  const stock = {
    copper_ore: 12, tin_ore: 12, iron_ore: 12, silver_ore: 12,
    gold_ore: 12, mithril_ore: 12, adamantite_ore: 12, runite_ore: 12,
    coal: 200
  };
  const passingCases = [];
  for (const bar of menuBars) {
    const recipe = recipes.get(bar.name);
    for (const { amount } of amountButtons) {
      World.currentTick = 100;
      const player = makePlayer(99);
      setCountedItems(player, stock);
      const experienceBefore = player.stats[smithingStat];
      openSmeltingInterface(player);
      const quantity = amount === 'X' ? 3 : amount;
      selectAmount(player, recipe, amount, amount === 'X' ? quantity : null);
      withForcedRandom(0.1, () => driveUntilIdle(player, 120));

      const produced = {};
      for (const item of inventory(player).items) {
        if (!item) continue;
        const itemName = ObjType.get(item.id)?.debugname;
        if (itemName?.endsWith('_bar')) produced[itemName] = (produced[itemName] ?? 0) + item.count;
      }
      assert.deepEqual(produced, { [recipe.barName]: quantity }, `${bar.name} ${amount} exact bar type and count`);
      assert.equal(
        count(player, recipe.primaryName),
        stock[recipe.primaryName] - recipe.primaryCount * quantity,
        `${bar.name} ${amount} exact primary ore consumption`
      );
      if (recipe.secondaryName !== null) {
        assert.equal(
          count(player, recipe.secondaryName),
          stock[recipe.secondaryName] - recipe.secondaryCount * quantity,
          `${bar.name} ${amount} exact secondary ore consumption`
        );
      }
      assert.equal(
        player.stats[smithingStat] - experienceBefore,
        recipe.experience * quantity,
        `${bar.name} ${amount} exact Smithing XP`
      );
      assert.deepEqual(
        player.messages,
        expectedMessages(recipe, quantity),
        `${bar.name} ${amount} must contain only the exact process/product messages`
      );
      assert.equal(player.modalChat, -1, `${bar.name} ${amount} must not open a refusal or stop dialog`);
      assert.equal(
        player.textEvents.some(event => event.kind === 'interface'),
        false,
        `${bar.name} ${amount} must not emit refusal or stop text`
      );
      assert.equal(weakQueueLength(player), 0, `${bar.name} ${amount} must drain the queue`);
      passingCases.push(`${bar.name}:${amount}`);
    }
  }
  assert.equal(passingCases.length, 32, 'all 32 packed amount buttons must execute');
  console.log('RESULT PASS smelt-batch T2: all 32 packed buttons, Make-X below stock');
}

if (runGroup('T3')) {
  const donorFixture = readRequiredFixture('queueore-donor-messages.json');
  assert.ok(donorFixture.queueore, 'donor queueore text map is missing');

  function runExhaustion(recipe, shortage) {
    const message = donorFixture.queueore[recipe.barName]?.[shortage];
    assert.equal(typeof message, 'string', `${recipe.barName} donor ${shortage} exhaustion text is missing`);
    const items = {};
    if (shortage === 'primary') {
      items[recipe.primaryName] = recipe.primaryCount;
      if (recipe.secondaryName !== null) items[recipe.secondaryName] = recipe.secondaryCount * 2;
    } else {
      items[recipe.primaryName] = recipe.primaryCount * 2;
      items[recipe.secondaryName] = recipe.secondaryCount;
    }
    World.currentTick = 100;
    const player = makePlayer(99);
    setCountedItems(player, items);
    const experienceBefore = player.stats[smithingStat];
    openSmeltingInterface(player);
    selectAmount(player, recipe, 5);
    withForcedRandom(0.1, () => driveUntilIdle(player, 80));
    assert.equal(player.modalChat, -1, `${recipe.barName} ${shortage} runout must not open a dialog`);
    assert.equal(
      player.textEvents.some(event => event.kind === 'interface'),
      false,
      `${recipe.barName} ${shortage} runout must not emit dialog text`
    );
    assert.equal(count(player, recipe.barName), 1, `${recipe.barName} ${shortage} runout should finish one bar`);
    assert.equal(
      count(player, recipe.primaryName),
      items[recipe.primaryName] - recipe.primaryCount,
      `${recipe.barName} ${shortage} runout primary inventory`
    );
    if (recipe.secondaryName !== null) {
      assert.equal(
        count(player, recipe.secondaryName),
        (items[recipe.secondaryName] ?? 0) - recipe.secondaryCount,
        `${recipe.barName} ${shortage} runout secondary inventory`
      );
    }
    assert.equal(
      player.stats[smithingStat] - experienceBefore,
      recipe.experience,
      `${recipe.barName} ${shortage} runout XP`
    );
    assert.deepEqual(
      player.messages,
      [recipe.processMessage, recipe.productMessage, message],
      `${recipe.barName} ${shortage} runout must print the committed donor message`
    );
    assert.equal(weakQueueLength(player), 0, `${recipe.barName} ${shortage} runout must leave no queued work`);
  }

  for (const spec of recipeSpecs) {
    const recipe = recipes.get(spec.name);
    runExhaustion(recipe, 'primary');
    if (recipe.secondaryName !== null && ['steel_bar', 'mithril_bar', 'adamantite_bar', 'runite_bar'].includes(recipe.barName)) {
      runExhaustion(recipe, 'secondary');
    }
  }

  for (const spec of recipeSpecs) {
    const recipe = recipes.get(spec.name);
    assert.equal(typeof recipe.failureMessage, 'string', `${recipe.barName} processfailure must be a string`);
    assert.notEqual(recipe.failureMessage, '', `${recipe.barName} processfailure must not be empty`);
  }
  for (const bar of menuBars) {
    const recipe = recipes.get(bar.name);
    const shortageModes = recipe.secondaryName === null ? ['primary'] : ['primary', 'secondary'];
    for (const shortage of shortageModes) {
      const items = {};
      if (shortage === 'secondary') items[recipe.primaryName] = recipe.primaryCount;
      World.currentTick = 100;
      const player = makePlayer(99);
      setCountedItems(player, items);
      const experienceBefore = player.stats[smithingStat];
      openSmeltingInterface(player);
      selectAmount(player, recipe, 1, null, false);
      assert.notEqual(player.modalChat, -1, `${recipe.barName} ${shortage} initial shortage must open a dialog`);
      assert.equal(
        interfaceText(player),
        recipe.failureMessage,
        `${recipe.barName} ${shortage} initial refusal must exactly match struct processfailure`
      );
      assert.deepEqual(player.messages, [], `${recipe.barName} ${shortage} initial refusal is not a plain game message`);
      assert.equal(count(player, recipe.barName), 0, `${recipe.barName} ${shortage} initial refusal makes no bar`);
      assert.equal(
        player.stats[smithingStat] - experienceBefore,
        0,
        `${recipe.barName} ${shortage} initial refusal awards no XP`
      );
      assert.equal(weakQueueLength(player), 0, `${recipe.barName} ${shortage} initial refusal queues no work`);
    }
  }
  // No gold menu button can select perfect gold without a perfect-gold ore. Exercise its
  // struct refusal through the matching item trigger so its required text is still tested.
  {
    const recipe = recipes.get('perfect_gold_bar');
    World.currentTick = 100;
    const player = makePlayer(99);
    player.lastUseItem = namedObject('perfect_gold_ore');
    player.lastUseSlot = -1;
    const trigger = ScriptProvider.getByName('[oplocu,_smithing_furnace]');
    const experienceBefore = player.stats[smithingStat];
    player.executeScript(ScriptRunner.init(trigger, player, furnace()), true, true);
    assert.notEqual(player.modalChat, -1, 'empty perfect gold validation must open a dialog');
    assert.equal(interfaceText(player), recipe.failureMessage, 'empty perfect gold refusal must match struct processfailure');
    assert.deepEqual(player.messages, [], 'empty perfect gold refusal is a dialog, not a plain game message');
    assert.equal(count(player, recipe.barName), 0, 'empty perfect gold validation makes no bar');
    assert.equal(player.stats[smithingStat] - experienceBefore, 0, 'empty perfect gold validation awards no XP');
    assert.equal(weakQueueLength(player), 0, 'empty perfect gold validation queues no work');
  }

  for (const bar of [menuBars[2], menuBars[3]]) {
    const recipe = recipes.get(bar.name);
    World.currentTick = 100;
    const player = makePlayer(recipe.level - 1);
    addRecipeInputs(player, recipe, 1);
    const experienceBefore = player.stats[smithingStat];
    openSmeltingInterface(player);
    selectAmount(player, recipe, 1, null, false);
    assert.equal(interfaceText(player), recipe.levelFailure, `${bar.name} level refusal text`);
    assert.equal(count(player, recipe.barName), 0, `${bar.name} below-level batch must not produce a bar`);
    assert.equal(count(player, recipe.primaryName), recipe.primaryCount, `${bar.name} below-level primary ore is retained`);
    if (recipe.secondaryName !== null) {
      assert.equal(count(player, recipe.secondaryName), recipe.secondaryCount, `${bar.name} below-level secondary ore is retained`);
    }
    assert.equal(player.stats[smithingStat] - experienceBefore, 0, `${bar.name} below-level batch awards no XP`);
    assert.equal(weakQueueLength(player), 0, `${bar.name} below-level batch queues no work`);
  }

  {
    const recipe = recipes.get('silver_bar');
    World.currentTick = 100;
    const player = makePlayer(99);
    add(player, recipe.primaryName, recipe.primaryCount * 5);
    const experienceBefore = player.stats[smithingStat];
    openSmeltingInterface(player);
    selectAmount(player, recipe, 5);
    advancePlayerTick(player);
    assert.equal(player.delayed, false, 'a batch must not hold the player with p_delay');
    assert.equal(count(player, recipe.primaryName), recipe.primaryCount * 5, 'unfinished bar must retain its ore');
    const movement = new MoveClickHandler();
    assert.equal(movement.handle(new MoveClick([{ x: player.x + 1, z: player.z }], 0, false), player), true);
    assert.equal(weakQueueLength(player), 0, 'movement must cancel the unfinished completion');
    driveUntilIdle(player, 24);
    assert.equal(count(player, recipe.barName), 0, 'cancelled unfinished bar must not be made');
    assert.equal(count(player, recipe.primaryName), recipe.primaryCount * 5, 'cancelled unfinished bar must keep all ore');
    assert.equal(player.stats[smithingStat], experienceBefore, 'cancelled unfinished bar must give no XP');
  }

  for (const offset of [1, 2]) {
    const recipe = recipes.get('silver_bar');
    World.currentTick = 100;
    const player = makePlayer(99);
    add(player, recipe.primaryName, recipe.primaryCount * 5);
    const experienceBefore = player.stats[smithingStat];
    openSmeltingInterface(player);
    selectAmount(player, recipe, 5);
    for (let tick = 0; tick < 12 && count(player, recipe.barName) === 0; tick++) advancePlayerTick(player);
    assert.equal(count(player, recipe.barName), 1, 'first bar must complete before between-bar cancellation');
    for (let tick = 0; tick < offset; tick++) advancePlayerTick(player);
    assert.equal(player.delayed, false, 'between-bar movement must be admitted at arbitrary interior ticks');
    assert.equal(count(player, recipe.primaryName), recipe.primaryCount * 4, 'next unfinished bar must retain its ore');
    const movement = new MoveClickHandler();
    assert.equal(movement.handle(new MoveClick([{ x: player.x + 1, z: player.z }], 0, false), player), true);
    assert.equal(weakQueueLength(player), 0, 'movement must clear every staged weak continuation');
    driveUntilIdle(player, 24);
    assert.equal(count(player, recipe.barName), 1, 'no further bar may complete after between-bar movement');
    assert.equal(count(player, recipe.primaryName), recipe.primaryCount * 4, 'movement must preserve unfinished ore');
    assert.equal(player.stats[smithingStat] - experienceBefore, recipe.experience, 'only the completed bar gives XP');
  }
  console.log('RESULT PASS smelt-batch T3: nine bar recipes, all specified shortages and cancellations');
}

if (runGroup('T4')) {
  const silver = recipes.get('silver_bar');
  World.currentTick = 100;
  const delayedPlayer = makePlayer(99);
  add(delayedPlayer, silver.primaryName, 1);
  delayedPlayer.vars[actionDelayVarpId] = 105;
  openSmeltingInterface(delayedPlayer);
  selectAmount(delayedPlayer, silver, 1);
  assert.deepEqual(delayedPlayer.traceEvents.splice(0), [], 'future action_delay must queue without starting immediately');
  assert.equal(weakQueueLength(delayedPlayer), 1, 'future action_delay must leave a queued start');
  const animationTicks = [];
  let startEvents = [];
  for (let tick = 101; tick <= 105; tick++) {
    advancePlayerTick(delayedPlayer);
    const events = delayedPlayer.traceEvents.splice(0);
    if (events.some(event => event.kind === 'animation')) {
      animationTicks.push(World.currentTick);
      startEvents = events;
    }
  }
  assert.deepEqual(animationTicks, [105], 'first furnace animation must wait for the future action-delay tick');
  assert.deepEqual(
    startEvents.filter(event => event.kind === 'game'),
    [{ kind: 'game', text: silver.processMessage }],
    'the delayed start must print its process message on the animation tick'
  );
  assert.equal(delayedPlayer.vars[actionDelayVarpId], 108, 'starting a bar must set the donor action-delay window');
  assert.equal(count(delayedPlayer, silver.barName), 0, 'the delayed start has not yet finished the bar');

  const itemTrigger = ScriptProvider.getByName('[oplocu,_smithing_furnace]');
  assert.ok(itemTrigger, 'packed item-on-furnace trigger is missing');
  for (const furnaceName of ['viking_furnace', 'viking_furnace2']) {
    for (const progress of [vikingComplete - 1, vikingComplete]) {
      World.currentTick = 100;
      const player = makePlayer(99);
      add(player, 'iron_ore', 1);
      player.lastUseItem = namedObject('iron_ore');
      player.lastUseSlot = inventory(player).getItemIndex(player.lastUseItem);
      player.vars[vikingVarpId] = progress;
      const state = ScriptRunner.init(itemTrigger, player, furnace(furnaceName));
      player.executeScript(state, true, true);
      if (progress < vikingComplete) {
        assert.deepEqual(player.messages, ['Only Fremenniks may use this furnace.'], `${furnaceName} below quest threshold message`);
        assert.equal(player.traceEvents.some(event => event.kind === 'animation'), false, `${furnaceName} below threshold must not start smelting`);
        assert.equal(count(player, 'iron_ore'), 1, `${furnaceName} below threshold must retain the ore`);
        assert.equal(count(player, 'iron_bar'), 0, `${furnaceName} below threshold must make no bar`);
        assert.equal(weakQueueLength(player), 0, `${furnaceName} below threshold must queue no work`);
      } else {
        const iron = recipes.get('iron_bar');
        assert.deepEqual(player.messages, [iron.processMessage], `${furnaceName} at quest threshold must start smelting`);
        assert.equal(player.traceEvents.filter(event => event.kind === 'animation').length, 1, `${furnaceName} at threshold must play the furnace animation`);
        assert.equal(player.traceEvents.filter(event => event.kind === 'sound').length, 1, `${furnaceName} at threshold must play the furnace sound`);
        assert.equal(count(player, 'iron_ore'), 1, `${furnaceName} at threshold consumes ore only at the finish`);
        assert.equal(count(player, 'iron_bar'), 0, `${furnaceName} at threshold has not finished yet`);
      }
    }
  }
  console.log('RESULT PASS smelt-batch T4: action-delay start and both Rellekka furnace gates');
}

console.log(`RESULT PASS smelt-batch groups: ${requestedGroup ?? 'T1,T2,T3,T4'}`);
// Production imports retain engine resources; match the standalone packed-test lifecycle.
process.exit(0);
