/**
 * Exercise the packed Miscellania service scripts through production dispatch
 * and ScriptRunner without starting a world server.
 * From the sibling engine after a full content build:
 * node --import tsx ../content/tests/misc-services/test_misc_services.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const importEngine = rel => import(pathToFileURL(path.join(engine, 'src', rel)).href);
const load = async rel => (await importEngine(rel)).default;

const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const Npc = await load('engine/entity/Npc.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const ServerTriggerType = await load('engine/script/ServerTriggerType.ts');
const { EntityLifeCycle } = await importEngine('engine/entity/EntityLifeCycle.ts');
const { BlockWalk } = await importEngine('engine/entity/BlockWalk.ts');
const { PlayerQueueType } = await importEngine('engine/entity/PlayerQueueRequest.ts');
const ResumePauseButtonHandler = await load('network/game/client/handler/ResumePauseButtonHandler.ts');
const ResumePauseButton = await load('network/game/client/model/ResumePauseButton.ts');
const InvButtonHandler = await load('network/game/client/handler/InvButtonHandler.ts');
const InvButton = await load('network/game/client/model/InvButton.ts');
const IfSetText = await load('network/game/server/model/IfSetText.ts');
const IfSetAnim = await load('network/game/server/model/IfSetAnim.ts');
const MessageGame = await load('network/game/server/model/MessageGame.ts');
const JavaRandom = await load('util/JavaRandom.ts');

const types = {};
for (const name of [
  'VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'NpcType',
  'LocType', 'SeqType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType',
  'DbTableType', 'EnumType', 'CategoryType', 'StructType', 'MesanimType'
]) {
  const Type = await load(`cache/config/${name}.ts`);
  Type.load(pack);
  types[name] = Type;
}
const DbTableIndex = await load('cache/config/DbTableIndex.ts');
DbTableIndex.init();
assert.ok(ScriptProvider.load(pack) > 0, 'a full compiled content pack is required');
World.currentTick = 100;
World.gameMap.init();

const {
  VarPlayerType, VarBitType, ParamType, NpcType, LocType, SeqType,
  InvType, ObjType, Component, DbRowType, DbTableType
} = types;
const pauseHandler = new ResumePauseButtonHandler();
const invButtonHandler = new InvButtonHandler();
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

function componentId(name) {
  return requiredId(Component, name);
}

function packed(name) {
  const script = ScriptProvider.getByName(name);
  assert.ok(script, `missing packed script ${name}`);
  return script;
}

function player(x = 2580, z = 3845) {
  const slot = ++serial;
  const p = new Player(`misc_services_${slot}`, BigInt(slot), 0n);
  p.slot = slot;
  p.pid = slot;
  p.uid = ((Number(p.username37 & 0x1fffffn) << 11) | slot) >>> 0;
  World.players[slot] = p;
  p.vars.fill(0);
  p.baseLevels.fill(99);
  p.levels.fill(99);
  p.level = 0;
  p.x = x;
  p.z = z;
  p.buildArea.originX = 2500;
  p.buildArea.originZ = 3300;
  const output = [];
  packetLog.set(p, output);
  // Transport capture only: dispatch, button handling, and script opcodes stay production code.
  p.write = message => output.push(message);
  return p;
}

function npc(name, x = 2580, z = 3845) {
  const type = NpcType.getByName(name);
  assert.ok(type, `missing packed npc ${name}`);
  const n = new Npc(0, x, z, 1, 1, EntityLifeCycle.RESPAWN, nextNid++, type.id, BlockWalk.NONE);
  n.isActive = true;
  n.lastMovement = -100;
  return n;
}

function text(p) {
  return packetLog.get(p)
    .filter(message => message instanceof IfSetText || message instanceof MessageGame)
    .map(message => message instanceof MessageGame ? message.msg : message.text)
    .join(' ');
}

function varp(p, name, value) {
  const id = requiredId(VarPlayerType, name);
  if (value !== undefined) p.setVar(id, value);
  return p.getVar(id);
}

function varbit(p, name, value) {
  const id = requiredId(VarBitType, name);
  if (value !== undefined) p.setVarBit(id, value);
  return p.getVarBit(id);
}

function startScript(p, script, target = null) {
  const state = ScriptRunner.init(script, p, target);
  p.executeScript(state, true);
  assert.notEqual(state.execution, ScriptState.ABORTED, `${script.name} aborted on entry`);
  return state;
}

function startNpcOp(p, n, trigger, header) {
  p.target = n;
  p.targetOp = trigger - 7;
  const script = p.getOpTrigger();
  assert.ok(script, `production NPC dispatch missed ${header}`);
  assert.equal(script.name, header, 'NPC dispatch must select the exact packed trigger');
  return startScript(p, script, n);
}

function startNpcAp(p, n, trigger, header) {
  p.target = n;
  p.targetOp = trigger;
  const script = p.getApTrigger();
  assert.ok(script, `production AP dispatch missed ${header}`);
  assert.equal(script.name, header, 'AP dispatch must select the exact packed trigger');
  return startScript(p, script, n);
}

function resumeMessage(p, state) {
  assert.equal(state.execution, ScriptState.PAUSEBUTTON, 'expected a Continue pause');
  assert.ok(pauseHandler.handle(new ResumePauseButton(0), p), 'production Continue handler rejected the pause');
  assert.notEqual(state.execution, ScriptState.ABORTED, 'script aborted after Continue');
}

function choose(p, state, count, index) {
  assert.equal(state.execution, ScriptState.PAUSEBUTTON, 'expected a choice pause');
  const com = componentId(`multi${count}:com_${index + 1}`);
  p.lastCom = com;
  assert.ok(pauseHandler.handle(new ResumePauseButton(com), p), 'production choice resume was rejected');
  assert.notEqual(state.execution, ScriptState.ABORTED, 'script aborted after choice');
}

function finish(p, state) {
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 100; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, 'script aborted');
    if (state.execution === ScriptState.PAUSEBUTTON) {
      resumeMessage(p, state);
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else {
      assert.fail(`unexpected script suspension ${state.execution}`);
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'script did not finish within 100 offline steps');
}

function initializeTabs(p) {
  const state = startScript(p, packed('[proc,initalltabs]'));
  finish(p, state);
  assert.ok(p.tabs.some(tab => tab !== -1), 'initalltabs did not initialize the fixture tabs');
  return [...p.tabs];
}

function openShop(p, shopName, title) {
  const main = componentId('shop_template');
  const side = componentId('shop_template_side');
  assert.equal(p.modalMain, main, `${shopName}: shop main interface`);
  assert.equal(p.modalSide, side, `${shopName}: shop side interface`);
  assert.ok(text(p).includes(title), `${shopName}: packed title ${title}`);
  const shopInventory = requiredId(InvType, shopName);
  const playerInventory = requiredId(InvType, 'inv');
  const shopCom = componentId('shop_template:inv');
  const playerCom = componentId('shop_template_side:inv');
  const shopListener = p.invListeners.find(listener => listener.type === shopInventory && listener.com === shopCom);
  const playerListener = p.invListeners.find(listener => listener.type === playerInventory && listener.com === playerCom);
  assert.ok(shopListener, `${shopName}: shop inventory is not listening`);
  assert.ok(playerListener, `${shopName}: player inventory is not listening`);
  const shopInv = p.getInventoryFromListener(shopListener);
  const playerInv = p.getInventoryFromListener(playerListener);
  assert.ok(shopInv && playerInv, `${shopName}: listener inventory did not resolve`);
  return { shopInv, playerInv, shopCom, playerCom };
}

function optionIndex(comName, pattern) {
  const com = Component.get(componentId(comName));
  const index = (com.iop ?? []).findIndex(option => typeof option === 'string' && pattern.test(option));
  assert.ok(index >= 0, `${comName} lacks option ${pattern}`);
  return index + 1;
}

function useInventoryButton(p, op, obj, slot, com) {
  assert.ok(invButtonHandler.handle(new InvButton(op, obj, slot, com), p), `inventory button ${op} on ${com} was rejected`);
}

function assertJourney(p, state, initialTabs, destination, arrivalText) {
  const shipRoot = componentId('misc_shipjourney');
  const animationComponent = componentId('misc_shipjourney:com_6');
  const animation = requiredId(SeqType, 'misc_shipjourney_to_misc');
  const journeyTick = World.currentTick;
  const hiddenTabs = [0, 1, 2, 3, 4, 5, 6, 10, 11, 12, 13];
  const visibleTabs = [7, 8, 9];

  assert.equal(state.execution, ScriptState.SUSPENDED, 'journey suspends after its non-pausing aboard message');
  assert.equal(p.modalMain, shipRoot, 'longship journey interface is open');
  assert.ok(packetLog.get(p).some(message => message instanceof IfSetAnim && message.component === animationComponent && message.seq === animation), 'journey animation is not the packed ship sequence');
  assert.ok(text(p).includes('You board the longship...'));
  for (const tab of hiddenTabs) assert.equal(p.tabs[tab], -1, `tab ${tab} should be hidden during travel`);
  for (const tab of visibleTabs) assert.equal(p.tabs[tab], initialTabs[tab], `tab ${tab} should remain visible during travel`);

  // P_DELAY schedules the six following ticks after the current admission tick.
  assert.equal(p.delayedUntil - journeyTick - 1, 6, 'longship delay argument is exactly six ticks');
  assert.deepEqual([p.x, p.z, p.level], destination, 'journey destination');
  World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
  p.delayed = false;
  p.executeScript(state, true, true);
  assert.equal(state.execution, ScriptState.PAUSEBUTTON, 'journey should finish on the arrival message');
  assert.notEqual(p.modalMain, shipRoot, 'journey interface closes after the crossing');
  assert.deepEqual(p.tabs, initialTabs, 'initalltabs restores the original tab layout');
  assert.ok(text(p).includes('You board the longship...'));
  resumeMessage(p, state);
  assert.equal(state.execution, ScriptState.FINISHED);
  assert.ok(text(p).includes(arrivalText), `missing final ship message: ${arrivalText}`);
}

const requiredTriggers = [
  '[apnpc1,misc_banker]', '[apnpc3,misc_banker]',
  '[label,misc_banker_q1]', '[label,misc_banker_q2]', '[label,misc_banker_bank]',
  '[opnpc1,etc_fish_monger]', '[opnpc3,etc_fish_monger]',
  '[opnpc1,etc_veg_monger]', '[opnpc3,etc_veg_monger]',
  '[opnpc1,misc_fish_monger]', '[opnpc3,misc_fish_monger]',
  '[opnpc1,misc_veg_monger]', '[opnpc3,misc_veg_monger]',
  '[opnpc1,misc_flowergirl]', '[opnpc1,misc_sailor]',
  '[label,flower_girl_enough_coins]', '[label,flower_girl_yes_please]',
  '[label,flower_girl_no_thanks]', '[label,flower_girl_not_enough_coins]',
  '[opnpc1,viking_sailor]', '[oploc1,misc_dummy_coalrock1]',
  '[oploc2,misc_dummy_coalrock1]', '[proc,misc_longship_sail]'
];
const theftQueues = [
  ['etc_fish_monger', 'stolen_from_stall_etcfish', 'marketthief_etcfish'],
  ['etc_veg_monger', 'stolen_from_stall_etcveg', 'marketthief_etcveg'],
  ['misc_fish_monger', 'stolen_from_stall_miscfish', 'marketthief_miscfish'],
  ['misc_veg_monger', 'stolen_from_stall_miscveg', 'marketthief_miscveg']
];

check('all required packed service triggers and theft queues exist', () => {
  for (const name of requiredTriggers) packed(name);
  for (const [, queue] of theftQueues) packed(`[queue,${queue}]`);
  requiredId(ParamType, 'market_guard');
});

const fishStock = [
  ['net', 5, 100], ['fishing_rod', 5, 100], ['fly_fishing_rod', 5, 100],
  ['harpoon', 2, 400], ['lobster_pot', 2, 400], ['fishing_bait', 1500, 1],
  ['feather', 1000, 1], ['big_net', 5, 100], ['raw_shrimp', 0, 300],
  ['raw_sardine', 200, 1], ['raw_herring', 0, 900], ['raw_mackerel', 0, 1000],
  ['raw_cod', 0, 1100], ['raw_anchovies', 0, 1200], ['raw_trout', 0, 1500],
  ['raw_pike', 0, 1800], ['raw_salmon', 0, 2100], ['raw_tuna', 0, 2300],
  ['raw_lobster', 0, 2600], ['raw_bass', 0, 2700], ['raw_swordfish', 0, 2900],
  ['raw_shark', 0, 3500]
];
const vegStock = [
  ['cabbage', 10, 100], ['potato', 10, 100], ['onion', 10, 100],
  ['tomato', 10, 100], ['garlic', 2, 400]
];
const shops = [
  { npc: 'etc_fish_monger', shop: 'etc_fishmonger', title: 'Etceteria Fish', buy: 700, sell: 1300, delta: 30, greeting: 'My fish is fresher than any in Miscellania!', stock: fishStock, sample: 'net' },
  { npc: 'etc_veg_monger', shop: 'etc_greengrocer', title: 'Island Greengrocer', buy: 950, sell: 1200, delta: 20, greeting: 'right place for yer greens!', stock: vegStock, sample: 'cabbage' },
  { npc: 'misc_fish_monger', shop: 'misc_fishmonger', title: 'Island Fishmonger', buy: 700, sell: 1300, delta: 30, greeting: "I've heard that the Etceterian fish is stored in a cow shed.", stock: fishStock, sample: 'net' },
  { npc: 'misc_veg_monger', shop: 'misc_greengrocer', title: 'Greengrocer of Miscellania', buy: 950, sell: 1200, delta: 20, greeting: 'finest and freshest vegetables!', stock: vegStock, sample: 'cabbage' }
];

for (const shop of shops) {
  check(`${shop.npc} packed parameters, talk/trade and real shop buttons`, () => {
    const type = NpcType.getByName(shop.npc);
    assert.ok(type, `missing merchant npc ${shop.npc}`);
    const params = {
      owned_shop: requiredId(ParamType, 'owned_shop'),
      shop_title: requiredId(ParamType, 'shop_title'),
      shop_buy_multiplier: requiredId(ParamType, 'shop_buy_multiplier'),
      shop_sell_multiplier: requiredId(ParamType, 'shop_sell_multiplier'),
      shop_delta: requiredId(ParamType, 'shop_delta')
    };
    assert.equal(type.params.get(params.owned_shop), requiredId(InvType, shop.shop));
    assert.equal(type.params.get(params.shop_title), shop.title);
    assert.equal(type.params.get(params.shop_buy_multiplier), shop.buy);
    assert.equal(type.params.get(params.shop_sell_multiplier), shop.sell);
    assert.equal(type.params.get(params.shop_delta), shop.delta);

    const inventoryType = InvType.getByName(shop.shop);
    assert.ok(inventoryType?.stockobj && inventoryType.stockcount && inventoryType.stockrate, `${shop.shop} has packed stock`);
    const actualStock = Array.from(inventoryType.stockobj, (id, index) => [ObjType.get(id).debugname, inventoryType.stockcount[index], inventoryType.stockrate[index]]);
    assert.deepEqual(actualStock, shop.stock, `${shop.shop} stock matches the committed inventory definition`);

    const talkPlayer = player();
    varp(talkPlayer, 'misc_quest', 0);
    const talkNpc = npc(shop.npc);
    const talkState = startNpcOp(talkPlayer, talkNpc, ServerTriggerType.OPNPC1, `[opnpc1,${shop.npc}]`);
    finish(talkPlayer, talkState);
    assert.ok(text(talkPlayer).includes(shop.greeting), `${shop.npc} talk branch`);
    openShop(talkPlayer, shop.shop, shop.title);

    const tradePlayer = player();
    const tradeNpc = npc(shop.npc);
    const tradeState = startNpcOp(tradePlayer, tradeNpc, ServerTriggerType.OPNPC3, `[opnpc3,${shop.npc}]`);
    finish(tradePlayer, tradeState);
    const { shopInv, playerInv, shopCom, playerCom } = openShop(tradePlayer, shop.shop, shop.title);
    assert.equal(varp(tradePlayer, 'shop'), requiredId(InvType, shop.shop));
    assert.equal(varp(tradePlayer, 'shop_buy'), shop.buy);
    assert.equal(varp(tradePlayer, 'shop_sell'), shop.sell);
    assert.equal(varp(tradePlayer, 'shop_haggle'), shop.delta);
    const item = requiredId(ObjType, shop.sample);
    const coins = requiredId(ObjType, 'coins');
    const beforeStock = shopInv.getItemCount(item);
    const stockSlot = shopInv.getItemIndex(item);
    assert.ok(beforeStock > 0 && stockSlot >= 0, `${shop.shop} contains ${shop.sample}`);
    playerInv.add(coins, 10000);
    const buyOne = optionIndex('shop_template:inv', /buy[^\d]*1\b/i);
    const sellOne = optionIndex('shop_template_side:inv', /sell[^\d]*1\b/i);
    const coinCount = playerInv.getItemCount(coins);
    useInventoryButton(tradePlayer, buyOne, item, stockSlot, shopCom);
    assert.equal(playerInv.getItemCount(item), 1, `${shop.shop} buy button transfers one item`);
    assert.equal(shopInv.getItemCount(item), beforeStock - 1);
    assert.ok(playerInv.getItemCount(coins) < coinCount, `${shop.shop} buy button charges coins`);
    const playerSlot = playerInv.getItemIndex(item);
    useInventoryButton(tradePlayer, sellOne, item, playerSlot, playerCom);
    assert.equal(playerInv.getItemCount(item), 0, `${shop.shop} sell button transfers the item back`);
    assert.equal(shopInv.getItemCount(item), beforeStock, `${shop.shop} stock is restored by the sale`);
  });
}

for (const shop of shops.filter(shop => shop.npc.startsWith('misc_'))) {
  check(`${shop.npc} uses the completed-Kingdom greeting`, () => {
    const p = player();
    varp(p, 'misc_quest', 100);
    const state = startNpcOp(p, npc(shop.npc), ServerTriggerType.OPNPC1, `[opnpc1,${shop.npc}]`);
    finish(p, state);
    assert.ok(text(p).includes('Your Royal Highness'));
    openShop(p, shop.shop, shop.title);
  });
}

for (const [merchant, queueName] of theftQueues) {
  for (const [operation, trigger] of [
    ['Talk-to', ServerTriggerType.OPNPC1],
    ['Trade-with', ServerTriggerType.OPNPC3]
  ]) {
    check(`${merchant} ${operation} refuses while its theft queue is pending`, () => {
      const p = player();
      const n = npc(merchant);
      const shopName = shops.find(shop => shop.npc === merchant).shop;
      const queued = packed(`[queue,${queueName}]`);
      p.enqueueScript(queued, PlayerQueueType.LONG, 0, [0]);
      assert.ok(p.queue.all().some(request => request.script.id === queued.id), 'offline fixture has the real packed queue request');
      const state = startNpcOp(p, n, trigger, `[${trigger === ServerTriggerType.OPNPC1 ? 'opnpc1' : 'opnpc3'},${merchant}]`);
      finish(p, state);
      assert.ok(!p.invListeners.some(listener => listener.type === requiredId(InvType, shopName)), 'queued theft must prevent the shop listener');
      assert.notEqual(p.modalMain, componentId('shop_template'), 'queued theft must not open the shop');
      assert.ok(p.queue.all().some(request => request.script.id === queued.id), 'interaction must not consume the pending theft queue');
    });
  }
}

for (const [, queueName, varbitName] of theftQueues) {
  check(`${queueName} clears only ${varbitName}`, () => {
    const p = player();
    const target = VarBitType.get(requiredId(VarBitType, varbitName));
    const varbits = theftQueues.map(([, , name]) => VarBitType.get(requiredId(VarBitType, name)));
    assert.ok(varbits.every(bit => bit.basevar === target.basevar), 'theft bits share the committed marketthief varp');
    assert.ok(varbits.every(bit => bit.endbit === bit.startbit), 'each marketthief flag is a single inclusive bit');
    let before = 0x13579bdf;
    for (const bit of varbits) before |= 1 << bit.startbit;
    p.setVar(target.basevar, before);
    const approval = requiredId(VarBitType, 'misc_approval');
    p.setVarBit(approval, 73);
    const queued = packed(`[queue,${queueName}]`);
    p.enqueueScript(queued, PlayerQueueType.LONG, 0, [0]);
    p.processQueue();
    const expected = before & ~(1 << target.startbit);
    assert.equal(p.getVar(target.basevar), expected, 'queue clears only its own marketthief bit');
    for (const bit of varbits) {
      const value = (p.getVar(bit.basevar) >> bit.startbit) & 1;
      assert.equal(value, bit === target ? 0 : 1, `${bit.debugname} flag`);
    }
    assert.equal(p.getVarBit(approval), 73, 'unrelated Kingdom approval is unchanged');
  });
}

check('banker APNPC1 conversation reaches q1, q2 and bank; bank buttons deposit and withdraw', () => {
  const p = player();
  const n = npc('misc_banker');
  p.x = n.x + 2;
  const inv = requiredId(InvType, 'inv');
  const bank = requiredId(InvType, 'bank');
  const pickaxe = requiredId(ObjType, 'bronze_pickaxe');
  p.getInventory(inv).add(pickaxe, 1);
  const state = startNpcAp(p, n, ServerTriggerType.APNPC1, '[apnpc1,misc_banker]');
  resumeMessage(p, state);
  choose(p, state, 3, 0);
  for (let i = 0; i < 3; i++) resumeMessage(p, state);
  choose(p, state, 2, 0);
  for (let i = 0; i < 3; i++) resumeMessage(p, state);
  choose(p, state, 2, 1);
  resumeMessage(p, state);
  assert.equal(state.execution, ScriptState.FINISHED);
  assert.equal(p.modalMain, componentId('bank_main'));
  assert.equal(p.modalSide, componentId('bank_side'));

  const bankInvCom = componentId('bank_main:bank');
  const playerInvCom = componentId('bank_side:inv');
  const bankListener = p.invListeners.find(listener => listener.type === bank && listener.com === bankInvCom);
  const playerListener = p.invListeners.find(listener => listener.type === inv && listener.com === playerInvCom);
  assert.ok(bankListener && playerListener, 'openbank transmits both bank and player inventories');
  const bankInventory = p.getInventoryFromListener(bankListener);
  const playerInventory = p.getInventoryFromListener(playerListener);
  assert.ok(bankInventory && playerInventory);
  const deposit = optionIndex('bank_side:inv', /deposit[^\d]*1\b/i);
  const withdraw = optionIndex('bank_main:bank', /withdraw[^\d]*1\b/i);
  useInventoryButton(p, deposit, pickaxe, playerInventory.getItemIndex(pickaxe), playerInvCom);
  assert.equal(playerInventory.getItemCount(pickaxe), 0);
  assert.equal(bankInventory.getItemCount(pickaxe), 1);
  useInventoryButton(p, withdraw, pickaxe, bankInventory.getItemIndex(pickaxe), bankInvCom);
  assert.equal(bankInventory.getItemCount(pickaxe), 0);
  assert.equal(playerInventory.getItemCount(pickaxe), 1);
});

check('banker APNPC1 and APNPC3 set range 2 beyond reach; APNPC3 opens bank within reach', () => {
  const bankRoot = componentId('bank_main');
  for (const trigger of [ServerTriggerType.APNPC1, ServerTriggerType.APNPC3]) {
    const p = player();
    const n = npc('misc_banker');
    p.x = n.x + 5;
    const header = trigger === ServerTriggerType.APNPC1 ? '[apnpc1,misc_banker]' : '[apnpc3,misc_banker]';
    const state = startNpcAp(p, n, trigger, header);
    assert.equal(state.execution, ScriptState.FINISHED);
    assert.equal(p.apRange, 2);
    assert.equal(p.apRangeCalled, true);
    assert.notEqual(p.modalMain, bankRoot);
  }
  const p = player();
  const n = npc('misc_banker');
  p.x = n.x + 2;
  const state = startNpcAp(p, n, ServerTriggerType.APNPC3, '[apnpc3,misc_banker]');
  assert.equal(state.execution, ScriptState.FINISHED);
  assert.equal(p.modalMain, bankRoot);
  assert.equal(p.modalSide, componentId('bank_side'));
});

function flowerAtCoins(coins) {
  const p = player();
  const n = npc('misc_flowergirl');
  p.getInventory(requiredId(InvType, 'inv')).add(requiredId(ObjType, 'coins'), coins);
  return { p, n, state: startNpcOp(p, n, ServerTriggerType.OPNPC1, '[opnpc1,misc_flowergirl]') };
}

check('flower girl refuses below 15 coins', () => {
  const { p, state } = flowerAtCoins(14);
  finish(p, state);
  assert.ok(text(p).includes("I don't have enough money."));
  assert.equal(p.getInventory(requiredId(InvType, 'inv')).getItemCount(requiredId(ObjType, 'coins')), 14);
  assert.equal(p.getInventory(requiredId(InvType, 'inv')).getItemCount(requiredId(ObjType, 'flowers_waterfall_quest_mixed')), 0);
});

check('flower girl decline spends nothing; yes buys flowers and caps approval at 127', () => {
  const declined = flowerAtCoins(15);
  for (let i = 0; i < 3; i++) resumeMessage(declined.p, declined.state);
  choose(declined.p, declined.state, 2, 1);
  finish(declined.p, declined.state);
  assert.ok(text(declined.p).includes('No, thank you.'));
  assert.equal(declined.p.getInventory(requiredId(InvType, 'inv')).getItemCount(requiredId(ObjType, 'coins')), 15);
  assert.equal(declined.p.getInventory(requiredId(InvType, 'inv')).getItemCount(requiredId(ObjType, 'flowers_waterfall_quest_mixed')), 0);

  const accepted = flowerAtCoins(15);
  for (let i = 0; i < 3; i++) resumeMessage(accepted.p, accepted.state);
  varbit(accepted.p, 'misc_approval', 127);
  choose(accepted.p, accepted.state, 2, 0);
  finish(accepted.p, accepted.state);
  const inv = accepted.p.getInventory(requiredId(InvType, 'inv'));
  assert.equal(inv.getItemCount(requiredId(ObjType, 'coins')), 0);
  assert.equal(inv.getItemCount(requiredId(ObjType, 'flowers_waterfall_quest_mixed')), 1);
  assert.equal(varbit(accepted.p, 'misc_approval'), 127);
});

check('flower girl rechecks the funds after the affirmative choice', () => {
  const { p, state } = flowerAtCoins(15);
  for (let i = 0; i < 3; i++) resumeMessage(p, state);
  choose(p, state, 2, 0);
  const inventory = p.getInventory(requiredId(InvType, 'inv'));
  inventory.remove(requiredId(ObjType, 'coins'), 15);
  finish(p, state);
  assert.equal(inventory.getItemCount(requiredId(ObjType, 'coins')), 0);
  assert.equal(inventory.getItemCount(requiredId(ObjType, 'flowers_waterfall_quest_mixed')), 0);
});

check('flower girl preserves both approval-roll outcomes below the cap', () => {
  for (const [seed, expected] of [[0, 42], [4096, 43]]) {
    const { p, state } = flowerAtCoins(15);
    for (let i = 0; i < 3; i++) resumeMessage(p, state);
    varbit(p, 'misc_approval', 42);
    choose(p, state, 2, 0);
    // Only the production RNG seed is a fixture, not the purchase or approval result.
    JavaRandom.setSeed(seed);
    finish(p, state);
    assert.equal(varbit(p, 'misc_approval'), expected);
    assert.equal(p.getInventory(requiredId(InvType, 'inv')).getItemCount(requiredId(ObjType, 'coins')), 0);
    assert.equal(p.getInventory(requiredId(InvType, 'inv')).getItemCount(requiredId(ObjType, 'flowers_waterfall_quest_mixed')), 1);
  }
});

check('flower girl preserves the completed-Kingdom greeting and offer', () => {
  const p = player();
  varp(p, 'misc_quest', 100);
  p.getInventory(requiredId(InvType, 'inv')).add(requiredId(ObjType, 'coins'), 15);
  const state = startNpcOp(p, npc('misc_flowergirl'), ServerTriggerType.OPNPC1, '[opnpc1,misc_flowergirl]');
  for (let i = 0; i < 3; i++) resumeMessage(p, state);
  assert.ok(text(p).includes('Good day, Your Royal Highness.'));
  assert.ok(text(p).includes('Would you like some, Your Royal Highness?'));
  choose(p, state, 2, 1);
  finish(p, state);
});

check('Miscellania coal loc dispatch refuses mining and prospect resolves its coal db row', () => {
  const rockType = requiredId(LocType, 'misc_dummy_coalrock1');
  const rock = World.getLoc(2526, 3892, 0, rockType);
  assert.ok(rock, 'the committed Miscellania coal loc is present on the packed map');
  const coalRow = DbRowType.getByName('coal_rock_table');
  assert.ok(coalRow, 'packed coal_rock_table row exists');
  assert.equal(coalRow.tableId, requiredId(DbTableType, 'mining_table'));
  const rockColumn = DbTableType.get(coalRow.tableId).columnNames.indexOf('rock');
  assert.ok(rockColumn >= 0, 'mining_table has its rock column');
  const entryCount = coalRow.columnValues[rockColumn].length / coalRow.types[rockColumn].length;
  const rocks = Array.from({ length: entryCount }, (_, index) => coalRow.getValue(rockColumn, index)[0]);
  assert.equal(rocks.filter(id => id === rockType).length, 1, 'coal table contains the Miscellania dummy coal loc once');

  const miner = player(2526, 3892);
  const pickaxe = requiredId(ObjType, 'bronze_pickaxe');
  miner.getInventory(requiredId(InvType, 'worn')).set(3, { id: pickaxe, count: 1 });
  const mineInventory = miner.getInventory(requiredId(InvType, 'inv'));
  const beforeMineItems = structuredClone(mineInventory.items);
  const beforeMineXp = [...miner.stats];
  const mineState = startNpcOp(miner, rock, ServerTriggerType.OPLOC1, '[oploc1,misc_dummy_coalrock1]');
  finish(miner, mineState);
  assert.ok(text(miner).includes('Miner Magnus is already mining that.'));
  assert.deepEqual(mineInventory.items, beforeMineItems, 'Mine grants no inventory item');
  assert.deepEqual([...miner.stats], beforeMineXp, 'Mine grants no XP');

  const prospector = player(2526, 3892);
  const prospectInventory = prospector.getInventory(requiredId(InvType, 'inv'));
  const beforeProspectItems = structuredClone(prospectInventory.items);
  const beforeProspectXp = [...prospector.stats];
  const prospectState = startNpcOp(prospector, rock, ServerTriggerType.OPLOC2, '[oploc2,misc_dummy_coalrock1]');
  finish(prospector, prospectState);
  assert.ok(text(prospector).includes('You examine the rock for ores...'));
  assert.ok(text(prospector).includes('This rock contains coal.'));
  assert.deepEqual(prospectInventory.items, beforeProspectItems, 'Prospect grants no inventory item');
  assert.deepEqual([...prospector.stats], beforeProspectXp, 'Prospect grants no XP');
});

check('Miscellania sailor decline stays put; return trip uses the six-tick longship journey', () => {
  const declined = player();
  const n = npc('misc_sailor');
  initializeTabs(declined);
  const noState = startNpcOp(declined, n, ServerTriggerType.OPNPC1, '[opnpc1,misc_sailor]');
  resumeMessage(declined, noState);
  resumeMessage(declined, noState);
  choose(declined, noState, 2, 1);
  finish(declined, noState);
  assert.deepEqual([declined.x, declined.z, declined.level], [2580, 3845, 0]);
  assert.notEqual(declined.modalMain, componentId('misc_shipjourney'));

  const returning = player();
  const sailor = npc('misc_sailor');
  const tabs = initializeTabs(returning);
  const state = startNpcOp(returning, sailor, ServerTriggerType.OPNPC1, '[opnpc1,misc_sailor]');
  resumeMessage(returning, state);
  resumeMessage(returning, state);
  choose(returning, state, 2, 0);
  resumeMessage(returning, state);
  assertJourney(returning, state, tabs, [2629, 3692, 0], 'The ship arrives at Rellekka.');
});

check('viking sailor only offers the outward ride after completion and reuses the longship journey', () => {
  const viking = requiredId(VarPlayerType, 'viking');
  for (const stage of [0, 1]) {
    const p = player(2629, 3692);
    varp(p, 'viking', stage);
    const n = npc('viking_sailor', 2629, 3692);
    const state = startNpcOp(p, n, ServerTriggerType.OPNPC1, '[opnpc1,viking_sailor]');
    finish(p, state);
    assert.deepEqual([p.x, p.z, p.level], [2629, 3692, 0], `quest stage ${stage} does not sail`);
    assert.notEqual(p.modalMain, componentId('misc_shipjourney'));
  }

  // Quest-stage values from quest.constant are values, not cache IDs.
  const notGoing = player(2629, 3692);
  notGoing.setVar(viking, 10);
  const noNpc = npc('viking_sailor', 2629, 3692);
  const noState = startNpcOp(notGoing, noNpc, ServerTriggerType.OPNPC1, '[opnpc1,viking_sailor]');
  resumeMessage(notGoing, noState);
  resumeMessage(notGoing, noState);
  choose(notGoing, noState, 2, 1);
  finish(notGoing, noState);
  assert.deepEqual([notGoing.x, notGoing.z, notGoing.level], [2629, 3692, 0]);
  assert.notEqual(notGoing.modalMain, componentId('misc_shipjourney'));

  const going = player(2629, 3692);
  going.setVar(viking, 10);
  const sailor = npc('viking_sailor', 2629, 3692);
  const tabs = initializeTabs(going);
  const state = startNpcOp(going, sailor, ServerTriggerType.OPNPC1, '[opnpc1,viking_sailor]');
  resumeMessage(going, state);
  resumeMessage(going, state);
  choose(going, state, 2, 0);
  resumeMessage(going, state);
  assertJourney(going, state, tabs, [2580, 3845, 0], 'The ship arrives at Miscellania.');
});

console.log(`RESULT ${failures.length ? 'FAIL' : 'PASS'} misc-services: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
