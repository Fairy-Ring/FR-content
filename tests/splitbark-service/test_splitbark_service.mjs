/**
 * Exercise the packed Splitbark Wizard conversation and purchases through the
 * production NPC dispatcher and ScriptRunner, without starting a world server.
 * From the sibling engine after a full content build:
 *   node --import tsx ../content/tests/splitbark-service/test_splitbark_service.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_DIR = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_DIR, '../engine');
const PACK_DIR = path.join(ENGINE_DIR, 'data/pack');
process.chdir(ENGINE_DIR);
const eng = rel => import(pathToFileURL(path.join(ENGINE_DIR, 'src', rel)).href);
const load = async rel => (await eng(rel)).default;

const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const Npc = await load('engine/entity/Npc.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const ServerTriggerType = await load('engine/script/ServerTriggerType.ts');
const Environment = await load('util/Environment.ts');
const { EntityLifeCycle } = await eng('engine/entity/EntityLifeCycle.ts');
const { BlockWalk } = await eng('engine/entity/BlockWalk.ts');
const ResumePauseButtonHandler = await load('network/game/client/handler/ResumePauseButtonHandler.ts');
const ResumePauseButton = await load('network/game/client/model/ResumePauseButton.ts');
const ResumePCountDialogHandler = await load('network/game/client/handler/ResumePCountDialogHandler.ts');
const ResumePCountDialog = await load('network/game/client/model/ResumePCountDialog.ts');
const IfOpenChat = await load('network/game/server/model/IfOpenChat.ts');
const IfSetModel = await load('network/game/server/model/IfSetModel.ts');
const IfSetObject = await load('network/game/server/model/IfSetObject.ts');
const IfSetPosition = await load('network/game/server/model/IfSetPosition.ts');
const IfSetText = await load('network/game/server/model/IfSetText.ts');
const MessageGame = await load('network/game/server/model/MessageGame.ts');

const config = {};
for (const name of [
  'VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'NpcType',
  'LocType', 'SeqType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType',
  'DbTableType', 'EnumType', 'CategoryType', 'StructType', 'MesanimType'
]) {
  const Type = await load(`cache/config/${name}.ts`);
  Type.load(PACK_DIR);
  config[name] = Type;
}
const ScriptVarType = await load('cache/config/ScriptVarType.ts');
(await load('cache/config/DbTableIndex.ts')).init();
assert.ok(ScriptProvider.load(PACK_DIR) > 0, 'a complete compiled content pack is required');
World.currentTick = 100;
World.vars = Int32Array.from({ length: config.VarSharedType.count }, (_, id) =>
  config.VarSharedType.get(id).type === ScriptVarType.INT ? 0 : -1
);
World.varsString = new Array(config.VarSharedType.count);
World.gameMap.init();

const { NpcType, InvType, ObjType, Component } = config;
const pauseHandler = new ResumePauseButtonHandler();
const countDialogHandler = new ResumePCountDialogHandler();
const packetLog = new WeakMap();
const failures = [];
let passed = 0;
let serial = 0;
let nextNid = 1;

function check(name, run) {
  try {
    run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ name, message });
    console.error(`FAIL ${name}: ${message}`);
  }
}

function requiredId(Type, name) {
  const id = Type.getId(name);
  assert.ok(Number.isInteger(id) && id >= 0, `missing packed ${Type.name ?? 'config'} ${name}`);
  return id;
}

function packed(name) {
  const script = ScriptProvider.getByName(name);
  assert.ok(script, `missing packed production script ${name}`);
  assert.equal(script.fileName, 'armourmaking_wizard.rs2', `${name} belongs to the packed Wizard script`);
  return script;
}

const LABELS = [
  'do', 'what', 'goodluck', 'wearing', 'make', 'go', 'howmuch',
  'make_please', 'splitbark', 'thanks'
].map(suffix => `[label,armourmaking_wizard_${suffix}]`);
const TALK_NAME = '[opnpc1,armourmaking_wizard]';
const talkScript = packed(TALK_NAME);
for (const name of LABELS) packed(name);

const INV = requiredId(InvType, 'inv');
const WIZARD_ID = requiredId(NpcType, 'armourmaking_wizard');
const BARK = requiredId(ObjType, 'hollow_bark');
const CLOTH = requiredId(ObjType, 'fine_cloth');
const COINS = requiredId(ObjType, 'coins');
const RECIPES = [
  {
    product: 'splitbark_helm', per: 2, price: 6000, title: 'splitbark helm',
    short: 'You need 2 pieces of bark, 2 pieces of fine cloth and 6,000 coins for a splitbark helm.',
    stop: "I'm afraid I can't make you any more now. You need 2 pieces of bark, 2 pieces of fine cloth and 6,000 coins for a splitbark helm."
  },
  {
    product: 'splitbark_body', per: 4, price: 37000, title: 'splitbark body',
    short: 'You need 4 pieces of bark, 4 pieces of fine cloth and 37,000 coins for a splitbark body.',
    stop: "I'm afraid I can't make you any more now. You need 4 pieces of bark, 4 pieces of fine cloth and 37,000 coins for a splitbark body."
  },
  {
    product: 'splitbark_legs', per: 3, price: 32000, title: 'splitbark legs',
    short: 'You need 3 pieces of bark, 3 pieces of fine cloth and 32,000 coins for splitbark legs.',
    stop: "I'm afraid I can't make you any more now. You need 3 pieces of bark, 3 pieces of fine cloth and 32,000 coins for splitbark legs."
  },
  {
    product: 'splitbark_gauntlets', per: 1, price: 1000, title: 'splitbark gauntlets',
    short: 'You need 1 piece of bark, 1 piece of fine cloth and 1,000 coins for splitbark gauntlets.',
    stop: "I'm afraid I can't make you any more now. You need 1 piece of bark, 1 piece of fine cloth and 1,000 coins for splitbark gauntlets."
  },
  {
    product: 'splitbark_greaves', per: 1, price: 1000, title: 'splitbark greaves',
    short: 'You need 1 piece of bark, 1 piece of fine cloth and 1,000 coins for splitbark greaves.',
    stop: "I'm afraid I can't make you any more now. You need 1 piece of bark, 1 piece of fine cloth and 1,000 coins for splitbark greaves."
  }
].map(recipe => ({ ...recipe, productId: requiredId(ObjType, recipe.product) }));

function componentId(name) {
  return requiredId(Component, name);
}

function player() {
  const id = ++serial;
  const p = new Player(`splitbark_${id}`, BigInt(id), 0n);
  p.slot = id;
  p.pid = id;
  p.uid = ((Number(p.username37 & 0x1fffffn) << 11) | id) >>> 0;
  World.players[id] = p;
  p.vars.fill(0);
  p.baseLevels.fill(99);
  p.levels.fill(99);
  p.level = 0;
  p.x = 2580;
  p.z = 3845;
  p.buildArea.originX = 2500;
  p.buildArea.originZ = 3300;
  const output = [];
  packetLog.set(p, output);
  p.write = message => output.push(message);
  return p;
}

function wizard() {
  const type = NpcType.get(WIZARD_ID);
  assert.ok(type, 'the packed armour-making wizard NpcType is loaded');
  const n = new Npc(0, 2580, 3845, type.size, type.size, EntityLifeCycle.RESPAWN, nextNid++, WIZARD_ID, BlockWalk.NONE);
  n.isActive = true;
  n.lastMovement = -100;
  return n;
}

function visibleText(p) {
  return packetLog.get(p)
    .filter(message => message instanceof IfSetText || message instanceof MessageGame)
    .map(message => message instanceof MessageGame ? message.msg : message.text)
    .join(' ')
    .replaceAll('|', ' ')
    .replace(/\s+/g, ' ');
}

function assertText(p, expected) {
  assert.ok(visibleText(p).includes(expected), `missing dialogue text: ${expected}`);
}

function startScript(p, script, target = null) {
  const state = ScriptRunner.init(script, p, target);
  p.executeScript(state, true);
  assert.notEqual(state.execution, ScriptState.ABORTED, `${script.name} aborted on entry`);
  return state;
}

function startTalk(p) {
  const n = wizard();
  p.target = n;
  p.targetOp = ServerTriggerType.OPNPC1 - 7;
  const script = p.getOpTrigger();
  assert.ok(script, `production NPC dispatch missed ${TALK_NAME}`);
  assert.equal(script.id, talkScript.id, 'Talk-to dispatch selects the exact packed production trigger');
  return startScript(p, script, n);
}

function resumeMessage(p, state) {
  assert.equal(state.execution, ScriptState.PAUSEBUTTON, 'expected a Continue pause');
  assert.ok(pauseHandler.handle(new ResumePauseButton(0), p), 'production Continue handler rejected the pause');
  assert.notEqual(state.execution, ScriptState.ABORTED, 'script aborted after Continue');
}

function resumeDelay(p, state) {
  assert.equal(state.execution, ScriptState.SUSPENDED, 'expected a delayed script pause');
  World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
  p.delayed = false;
  p.executeScript(state, true, true);
  assert.notEqual(state.execution, ScriptState.ABORTED, 'script aborted after its delay');
}

function menuButtons(menuName) {
  if (menuName === 'skillmulti5') {
    return Array.from({ length: 20 }, (_, i) => componentId(`skillmulti5:com_${i + 7}`));
  }
  const match = /^multi([0-9]+)$/.exec(menuName);
  assert.ok(match, `unknown packed menu ${menuName}`);
  const count = Number(match[1]);
  return Array.from({ length: count }, (_, i) => componentId(`${menuName}:com_${i + 1}`));
}

function advanceToMenu(p, state, menuName) {
  const root = componentId(menuName);
  const buttons = menuButtons(menuName);
  for (let step = 0; step < 100; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, 'script aborted while advancing dialogue');
    if (state.execution === ScriptState.PAUSEBUTTON && p.modalChat === root && buttons.every(id => p.resumeButtons.includes(id))) {
      return;
    }
    if (state.execution === ScriptState.PAUSEBUTTON) {
      resumeMessage(p, state);
    } else if (state.execution === ScriptState.SUSPENDED) {
      resumeDelay(p, state);
    } else {
      assert.fail(`expected dialogue or ${menuName} menu, got ${state.execution}`);
    }
  }
  assert.fail(`did not reach packed ${menuName} menu within 100 dialogue steps`);
}

function chooseMenu(p, state, menuName, option) {
  advanceToMenu(p, state, menuName);
  const component = componentId(`${menuName}:com_${option}`);
  assert.ok(p.resumeButtons.includes(component), `${menuName} offers option ${option}`);
  p.lastCom = component;
  assert.ok(pauseHandler.handle(new ResumePauseButton(component), p), `production choice handler rejected ${menuName} option ${option}`);
  assert.notEqual(state.execution, ScriptState.ABORTED, 'script aborted after dialogue choice');
}

function finish(p, state) {
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 100; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, 'script aborted');
    if (state.execution === ScriptState.PAUSEBUTTON) {
      resumeMessage(p, state);
    } else if (state.execution === ScriptState.SUSPENDED) {
      resumeDelay(p, state);
    } else {
      assert.fail(`unexpected terminal script suspension ${state.execution}`);
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'script did not finish within 100 offline steps');
}

function productMenu(p) {
  const state = startTalk(p);
  chooseMenu(p, state, 'multi4', 3);
  advanceToMenu(p, state, 'skillmulti5');
  assertProductMenu(p);
  assertText(p, 'Certainly, what would you like me to make?');
  return state;
}

function normalizedInterfaceText(value) {
  return value.replace(/\\+n/g, '\n').replace(/\r\n/g, '\n');
}

function assertProductMenu(p) {
  const menuComponent = componentId('skillmulti5');
  const packets = packetLog.get(p);
  const openIndex = packets.findIndex(message => message instanceof IfOpenChat && message.component === menuComponent);
  assert.ok(openIndex >= 0, 'skillmulti5 sends its IfOpenChat packet');
  for (const [index, message] of packets.entries()) {
    if ((message instanceof IfSetText || message instanceof IfSetModel ||
         message instanceof IfSetObject || message instanceof IfSetPosition) &&
        (message.component === menuComponent || Component.get(message.component).rootLayer === menuComponent)) {
      assert.ok(index < openIndex,
        `skillmulti5 must open after every menu setter: ${message.constructor.name} for ${Component.get(message.component).comName} arrives after IfOpenChat`);
    }
  }

  const modelComponents = RECIPES.map((_, index) => componentId(`skillmulti5:com_${index + 2}`));
  const modelPackets = packetLog.get(p)
    .filter(message => message instanceof IfSetObject && modelComponents.includes(message.component))
    .map(message => [message.component, message.obj, message.scale]);
  assert.deepEqual(modelPackets, RECIPES.map((recipe, index) => [modelComponents[index], recipe.productId, 175]),
    'skillmulti5 shows all five donor products, in order, at scale 175');

  const positionPackets = packetLog.get(p)
    .filter(message => message instanceof IfSetPosition && modelComponents.includes(message.component))
    .map(message => [message.component, message.x, message.y]);
  assert.deepEqual(positionPackets, modelComponents.map(component => [component, 0, -5]),
    'all five product models receive the donor 0,-5 position offset');

  const headerComponent = componentId('skillmulti5:com_27');
  const labelComponents = RECIPES.map((_, index) => componentId(`skillmulti5:com_${10 + index * 4}`));
  const promptLabels = packetLog.get(p)
    .filter(message => message instanceof IfSetText && (message.component === headerComponent || labelComponents.includes(message.component)))
    .map(message => [message.component, normalizedInterfaceText(message.text)]);
  assert.deepEqual(promptLabels, [
    [headerComponent, 'Splitbark Armour'],
    ...labelComponents.map((component, index) => [component, '\n'.repeat(4) + ['Helm', 'Body', 'Legs', 'Gauntlets', 'Greaves'][index]])
  ], 'the published header and five product labels match the donor order');

  assert.equal(p.modalChat, componentId('skillmulti5'), 'the published five-product selector is open');
  const amountLabels = ['Make X', 'Make 10', 'Make 5', 'Make 1'];
  for (let productIndex = 0; productIndex < RECIPES.length; productIndex++) {
    for (let amountIndex = 0; amountIndex < amountLabels.length; amountIndex++) {
      const id = componentId(`skillmulti5:com_${7 + productIndex * 4 + amountIndex}`);
      assert.ok(p.resumeButtons.includes(id), `${RECIPES[productIndex].product} offers ${amountLabels[amountIndex]}`);
      assert.equal(Component.get(id).option, amountLabels[amountIndex],
        `${RECIPES[productIndex].product} option ${amountLabels[amountIndex]}`);
    }
  }
}

function inventory(p) {
  const inv = p.getInventory(INV);
  assert.ok(inv, 'player inventory is available');
  return inv;
}

function addItem(p, id, count) {
  assert.equal(inventory(p).add(id, count), count, `fixture can add ${count} of packed item ${id}`);
}

function seed(p, recipe, quantity, { bark = quantity * recipe.per, cloth = quantity * recipe.per, coins = quantity * recipe.price } = {}) {
  if (bark > 0) addItem(p, BARK, bark);
  if (cloth > 0) addItem(p, CLOTH, cloth);
  if (coins > 0) addItem(p, COINS, coins);
}

function inventoryCounts(p) {
  const counts = new Map();
  for (const item of inventory(p).itemsFiltered) counts.set(item.id, (counts.get(item.id) ?? 0) + item.count);
  return counts;
}

function canonicalCounts(counts) {
  return [...counts.entries()].filter(([, count]) => count > 0).sort(([left], [right]) => left - right);
}

function snapshot(p) {
  return new Map(inventoryCounts(p));
}

function expectedAfter(before, recipe, amount) {
  const expected = new Map(before);
  const spend = (id, count) => {
    const next = (expected.get(id) ?? 0) - count;
    assert.ok(next >= 0, `fixture held enough of packed item ${id}`);
    if (next === 0) expected.delete(id);
    else expected.set(id, next);
  };
  spend(BARK, amount * recipe.per);
  spend(CLOTH, amount * recipe.per);
  spend(COINS, amount * recipe.price);
  expected.set(recipe.productId, (expected.get(recipe.productId) ?? 0) + amount);
  return expected;
}

function assertTransaction(p, before, recipe, amount, context) {
  assert.deepEqual(canonicalCounts(inventoryCounts(p)), canonicalCounts(expectedAfter(before, recipe, amount)),
    `${context}: exact product and input delta; unrelated inventory is unchanged`);
  assert.equal(inventory(p).getItemCount(recipe.productId), (before.get(recipe.productId) ?? 0) + amount,
    `${context}: exact ${recipe.product} count`);
  assert.equal(inventory(p).getItemCount(BARK), (before.get(BARK) ?? 0) - amount * recipe.per,
    `${context}: exact bark consumption`);
  assert.equal(inventory(p).getItemCount(CLOTH), (before.get(CLOTH) ?? 0) - amount * recipe.per,
    `${context}: exact fine-cloth consumption`);
  assert.equal(inventory(p).getItemCount(COINS), (before.get(COINS) ?? 0) - amount * recipe.price,
    `${context}: exact coin consumption`);
}

function packNames(kind) {
  const file = path.join(CONTENT_DIR, 'pack', `${kind}.pack`);
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
    const at = line.indexOf('=');
    if (at < 0 || !/^\d+$/.test(line.slice(0, at).trim())) return [];
    const name = line.slice(at + 1).trim();
    return name ? [name] : [];
  });
}

const OBJECT_NAMES = packNames('obj');
const productIds = new Set([BARK, CLOTH, COINS, ...RECIPES.map(recipe => recipe.productId)]);
function fillInventory(p) {
  const inv = inventory(p);
  for (const name of OBJECT_NAMES) {
    if (inv.freeSlotCount === 0) break;
    const id = requiredId(ObjType, name);
    if (productIds.has(id) || inv.getItemCount(id) > 0) continue;
    assert.equal(inv.add(id, 1), 1, `add one filler item resolved by name ${name}`);
  }
  assert.equal(inv.freeSlotCount, 0, 'fixture fills every normal inventory slot');
}

function recipeSlots(recipe, quantity) {
  const itemSlots = (id, count) => {
    if (count === 0) return 0;
    return ObjType.get(id).stackable ? 1 : count;
  };
  return itemSlots(BARK, quantity * recipe.per)
    + itemSlots(CLOTH, quantity * recipe.per)
    + itemSlots(COINS, quantity * recipe.price);
}

function maxSeedable(recipe, requested) {
  const capacity = InvType.get(INV).size;
  let amount = requested;
  while (amount > 0 && recipeSlots(recipe, amount) > capacity) amount--;
  assert.ok(amount > 0, `${recipe.product} can be seeded at least once in a normal inventory`);
  return amount;
}

function selectProduct(p, state, recipeIndex, amountKind, amount) {
  const base = 7 + recipeIndex * 4;
  const offset = { x: 0, 10: 1, 5: 2, 1: 3 }[amountKind];
  assert.notEqual(offset, undefined, `known published amount option ${amountKind}`);
  const button = componentId(`skillmulti5:com_${base + offset}`);
  assert.ok(p.resumeButtons.includes(button), `${RECIPES[recipeIndex].product} offers Make ${amountKind}`);
  p.lastCom = button;
  assert.ok(pauseHandler.handle(new ResumePauseButton(button), p), `production choice handler accepted Make ${amountKind}`);
  assert.notEqual(state.execution, ScriptState.ABORTED, 'script aborted after product/amount selection');
  if (amountKind === 'x') {
    assert.equal(state.execution, ScriptState.COUNTDIALOG, 'Make X opens the production count dialog');
    assert.ok(countDialogHandler.handle(new ResumePCountDialog(amount), p), 'production count-dialog handler accepted the submitted amount');
    assert.notEqual(state.execution, ScriptState.ABORTED, 'script aborted after Make X count submission');
  } else {
    assert.notEqual(state.execution, ScriptState.COUNTDIALOG, `Make ${amountKind} does not open the count dialog`);
  }
}

function runPurchase(recipeIndex, amountKind, requested) {
  const recipe = RECIPES[recipeIndex];
  const amount = amountKind === 'x' ? requested : maxSeedable(recipe, requested);
  const p = player();
  seed(p, recipe, amount);
  const before = snapshot(p);
  const state = productMenu(p);
  selectProduct(p, state, recipeIndex, amountKind, requested);
  finish(p, state);
  assertTransaction(p, before, recipe, amount, `${recipe.product} Make ${amountKind}`);
  if (amount < requested) assertText(p, recipe.stop);
  else assertText(p, 'There you go, enjoy your new armour!');
}

for (let recipeIndex = 0; recipeIndex < RECIPES.length; recipeIndex++) {
  const recipe = RECIPES[recipeIndex];
  for (const [amountKind, requested] of [['x', 2], ['10', 10], ['5', 5], ['1', 1]]) {
    check(`${recipe.product}: Make ${amountKind} selects the right model and charges exactly`, () => {
      runPurchase(recipeIndex, amountKind, requested);
    });
  }
}

for (const [recipeIndex, recipe] of RECIPES.entries()) {
  for (const shortage of ['bark', 'cloth', 'coins']) {
    check(`${recipe.product}: one-${shortage}-short refusal consumes nothing`, () => {
      const p = player();
      const quantities = {
        bark: { bark: recipe.per - 1, cloth: recipe.per, coins: recipe.price },
        cloth: { bark: recipe.per, cloth: recipe.per - 1, coins: recipe.price },
        coins: { bark: recipe.per, cloth: recipe.per, coins: recipe.price - 1 }
      }[shortage];
      seed(p, recipe, 1, quantities);
      const before = snapshot(p);
      const state = productMenu(p);
      selectProduct(p, state, recipeIndex, '1', 1);
      finish(p, state);
      assert.deepEqual(canonicalCounts(inventoryCounts(p)), canonicalCounts(before), 'an initial shortage changes no inventory item');
      assert.equal(inventory(p).getItemCount(recipe.productId), 0, 'an initial shortage grants no product');
      assertText(p, recipe.short);
      assert.ok(!visibleText(p).includes(recipe.stop),
        `${recipe.product}: an initial shortage must show the initial refusal, not the partial-batch stop line`);
    });
  }
}

for (const [recipeIndex, recipe] of RECIPES.entries()) {
  for (const shortage of ['bark', 'cloth', 'coins']) {
    check(`${recipe.product}: ${shortage} shortage stops after two affordable exchanges`, () => {
      const p = player();
      const quantities = {
        bark: { bark: 2 * recipe.per, cloth: 3 * recipe.per, coins: 3 * recipe.price },
        cloth: { bark: 3 * recipe.per, cloth: 2 * recipe.per, coins: 3 * recipe.price },
        coins: { bark: 3 * recipe.per, cloth: 3 * recipe.per, coins: 2 * recipe.price }
      }[shortage];
      seed(p, recipe, 3, quantities);
      const before = snapshot(p);
      const state = productMenu(p);
      selectProduct(p, state, recipeIndex, 'x', 3);
      finish(p, state);
      assertTransaction(p, before, recipe, 2, `${recipe.product} after ${shortage}-limited Make X 3`);
      assertText(p, recipe.stop);
    });
  }
}

check('Make X accepts zero without consuming inventory or granting a product', () => {
  const recipe = RECIPES[0];
  const p = player();
  seed(p, recipe, 1);
  const before = snapshot(p);
  const state = productMenu(p);
  selectProduct(p, state, 0, 'x', 0);
  finish(p, state);
  assert.deepEqual(canonicalCounts(inventoryCounts(p)), canonicalCounts(before), 'zero count preserves every inventory item');
  assert.equal(inventory(p).getItemCount(recipe.productId), 0, 'zero count grants no product');
  assert.equal(visibleText(p).includes('There you go, enjoy your new armour!'), false, 'zero count returns before the success line');
});

check('Talk-to explanation branches reach do, what and good luck labels', () => {
  const p = player();
  const state = startTalk(p);
  chooseMenu(p, state, 'multi4', 1);
  chooseMenu(p, state, 'multi2', 1);
  chooseMenu(p, state, 'multi2', 1);
  finish(p, state);
  assertText(p, "I've been studying the practice of making split-bark armour.");
  assertText(p, "Split-bark armour is special armour for mages. It's much more resistant to physical attacks than normal robes.");
  assertText(p, 'Well good luck with that.');
});

check('Talk-to wearing and make explanation reaches the go label', () => {
  const p = player();
  const state = startTalk(p);
  chooseMenu(p, state, 'multi4', 2);
  chooseMenu(p, state, 'multi2', 2);
  chooseMenu(p, state, 'multi2', 1);
  finish(p, state);
  assertText(p, 'This is split-bark armour, it\'s special armour for mages.');
  assertText(p, 'hollow tree');
  assertText(p, 'fine cloth');
  assertText(p, 'Morytania');
  assertText(p, 'tombs of shades');
  assertText(p, 'discounted price');
  assertText(p, 'Okay, guess I\'ll go looking then!');
});

check('Talk-to make explanation reaches how-much and go labels', () => {
  const p = player();
  const state = startTalk(p);
  chooseMenu(p, state, 'multi4', 1);
  chooseMenu(p, state, 'multi2', 2);
  chooseMenu(p, state, 'multi2', 2);
  finish(p, state);
  assertText(p, '1 piece of each for either gloves or greaves');
  assertText(p, '2 pieces of each for a hat');
  assertText(p, '3 pieces of each for leggings');
  assertText(p, '4 pieces of each for a top');
  assertText(p, '1,000 coins');
  assertText(p, '6,000 coins');
  assertText(p, '32,000 coins');
  assertText(p, '37,000 for a top');
  assertText(p, 'Okay, guess I\'ll go looking then!');
});

check('Talk-to no-thanks branch reaches thanks label', () => {
  const p = player();
  const state = startTalk(p);
  chooseMenu(p, state, 'multi4', 4);
  finish(p, state);
  assertText(p, 'No thanks.');
});

for (const branch of ['make', 'make_please']) {
  check(`free-world ${branch} entry refuses without touching inventory or showing products`, () => {
    const oldMembers = Environment.NODE_MEMBERS;
    Environment.NODE_MEMBERS = false;
    try {
      const recipe = RECIPES[0];
      const p = player();
      seed(p, recipe, 1);
      const before = snapshot(p);
      const state = startTalk(p);
      if (branch === 'make') {
        chooseMenu(p, state, 'multi4', 1);
        chooseMenu(p, state, 'multi2', 2);
      } else {
        chooseMenu(p, state, 'multi4', 3);
      }
      finish(p, state);
      assertText(p, "I'm sorry, but I can't do that right now.");
      assert.deepEqual(canonicalCounts(inventoryCounts(p)), canonicalCounts(before), `${branch} free-world refusal preserves inventory`);
      assert.equal(inventory(p).getItemCount(recipe.productId), 0, `${branch} free-world refusal grants no product`);
      const shown = packetLog.get(p).some(message => message instanceof IfSetObject);
      assert.equal(shown, false, `${branch} free-world refusal does not open the product selector`);
    } finally {
      Environment.NODE_MEMBERS = oldMembers;
    }
  });
}

check('full inventory exchange frees inputs before grant and loses no unrelated item', () => {
  const recipe = RECIPES[3];
  const p = player();
  seed(p, recipe, 1);
  fillInventory(p);
  assert.equal(inventory(p).freeSlotCount, 0, 'the test begins with a full 28-slot inventory');
  const before = snapshot(p);
  const state = productMenu(p);
  selectProduct(p, state, 3, '1', 1);
  finish(p, state);
  assertTransaction(p, before, recipe, 1, 'full inventory gauntlet exchange');
  assertText(p, 'There you go, enjoy your new armour!');
  assert.equal(inventory(p).freeSlotCount, 2, 'three consumed input slots make room for one product');
});

console.log(`RESULT ${failures.length ? 'FAIL' : 'PASS'} splitbark-service: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
