// Run from the sibling engine: node --import tsx ../content/tests/wilderness-shops/test_wilderness_shops.mjs
// Real packed scripts, Player dispatch, dialogue packets and shared shop inventory buttons. No server.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BlockWalk, EntityLifeCycle, IfSetText, InvButton, InvButtonHandler, Npc, Player,
  ResumePauseButton, ResumePauseButtonHandler, ScriptProvider, ScriptRunner, ScriptState,
  ServerTriggerType, World, content, floorTiles, map, nativeNpcRows, requiredId, types
} from '../regicide-travel/runtime.mjs';

const id = (kind, name) => requiredId(types[kind], name);
const inv = id('InvType', 'inv'), coins = id('ObjType', 'coins');
const pause = new ResumePauseButtonHandler(), button = new InvButtonHandler();
const logs = new WeakMap();
let serial = 0, assertions = 0;
function fixture(npc, amount = 10000) {
  const p = new Player(`n618_test_${++serial}`, BigInt(serial), 0n);
  p.slot = serial; p.pid = serial; p.uid = (Number(p.username37 & 0x1fffffn) << 11) | serial; p.vars.fill(0);
  const candidates = [];
  for (let x = npc.x - 1; x <= npc.x + npc.width; x++) for (let z = npc.z - 1; z <= npc.z + npc.length; z++) {
    if (floorTiles.has(`${npc.level},${x},${z}`) && !map.isMapBlocked(x, z, npc.level) &&
      map.reachedEntity(npc.level, x, z, npc.x, npc.z, npc.width, npc.length, 1)) candidates.push([npc.level, x, z]);
  }
  assert(candidates.length, `${types.NpcType.get(npc.type).debugname} has a normal walkable operate tile`);
  [p.level, p.x, p.z] = candidates[0];
  p.buildArea.originX = Math.floor(p.x / 8) * 8; p.buildArea.originZ = Math.floor(p.z / 8) * 8;
  World.players[p.slot] = p;
  const packets = []; logs.set(p, packets); p.write = packet => packets.push(packet);
  p.getInventory(inv).add(coins, amount);
  return p;
}
function nativeNpc(row) {
  const type = types.NpcType.get(row.id), nid = World.npcs.next();
  const npc = new Npc(row.level, row.x, row.z, type.size, type.size, EntityLifeCycle.RESPAWN, nid, type.id, BlockWalk.NONE);
  World.addNpc(npc, -1); return npc;
}
function texts(p) { return logs.get(p).filter(packet => packet instanceof IfSetText).map(packet => packet.text.replace(/[|\s]+/g, ' ')); }
function transcript(p) { return texts(p).join(' ').replace(/\s+/g, ' ').trim(); }
function run(p, script, target = null, choices = [], args = []) {
  assert(script, 'production dispatch must select a packed script');
  const state = ScriptRunner.init(script, p, target, args); p.executeScript(state, true);
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 100; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, `${script.name} aborted`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      const menu = /^\[proc,p_choice([2345])(?:_header)?\]$/.exec(state.script.name);
      let com = 0;
      if (menu) {
        assert(choices.length, `unexpected choice in ${script.name}: ${texts(p).join(' / ')}`);
        com = id('Component', `multi${menu[1]}:com_${choices.shift()}`);
        p.lastCom = com;
      }
      assert(pause.handle(new ResumePauseButton(com), p), 'production Continue/choice accepted');
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil); p.delayed = false; p.executeScript(state, true, true);
    } else assert.fail(`unexpected execution ${state.execution}`);
  }
  assert.equal(state.execution, ScriptState.FINISHED, `${script.name} finishes within 100 steps`);
  assert.equal(choices.length, 0, `${script.name} consumes every requested choice`);
  return state;
}
function op(p, npc, slot, choices = []) {
  p.target = npc; p.targetOp = ServerTriggerType.OPNPC1 + slot - 1 - 7;
  const script = p.getOpTrigger();
  assert.equal(script?.name, `[opnpc${slot},${types.NpcType.get(npc.type).debugname}]`, 'Player dispatch selects visible exact NPC form');
  return run(p, script, npc, [...choices]);
}
function proc(p, name, args = []) {
  const state = run(p, ScriptProvider.getByName(`[proc,${name}]`), null, [], args);
  return state.intStack[state.isp - 1];
}
function openShop(p, name, title) {
  assert.equal(p.modalMain, id('Component', 'shop_template'));
  assert.equal(p.modalSide, id('Component', 'shop_template_side'));
  assert(texts(p).includes(title), `${name} title appears in the shop interface`);
  assert.equal(p.getVar(id('VarPlayerType', 'shop')), id('InvType', name));
  const listener = p.invListeners.find(listener => listener.type === id('InvType', name) && listener.com === id('Component', 'shop_template:inv'));
  assert(listener, 'shop transmits a real inventory');
  const playerListener = p.invListeners.find(listener => listener.type === inv && listener.com === id('Component', 'shop_template_side:inv'));
  assert(playerListener, 'shop transmits the real player inventory');
  assert.equal(p.getInventoryFromListener(playerListener), p.getInventory(inv), 'native UID resolves the transmitted player inventory');
  return p.getInventoryFromListener(listener);
}
function buttonIndex(component, option) {
  const index = (types.Component.get(id('Component', component)).iop ?? []).findIndex(text => option.test(text ?? ''));
  assert(index >= 0, `${component} has ${option}`); return index + 1;
}
function transact(p, container, item, component, option) {
  const slot = container.getItemIndex(item); assert(slot >= 0, 'item exists in the transmitted container');
  assert(button.handle(new InvButton(buttonIndex(component, option), item, slot, id('Component', component)), p),
    `production inventory button accepted: ${JSON.stringify({ component, item, slot, delayed: p.delayed, main: p.modalMain, side: p.modalSide, root: types.Component.get(id('Component', component)).rootLayer, listeners: p.invListeners.map(listener => ({ type: listener.type, com: listener.com })) })}`);
}
function purchaseAndSale(p, shop, item, quantity, rate, buyPrice, sellPrice) {
  assert.equal(shop.getItemCount(item), quantity, 'stock starts at the configured base quantity');
  assert.equal(proc(p, 'adjusted_item_cost_buying', [item, quantity]), buyPrice, 'base purchase price');
  assert.equal(proc(p, 'adjusted_item_cost_selling', [item, quantity]), sellPrice, 'base sale price');
  const money = p.invTotal(inv, coins), held = p.invTotal(inv, item);
  transact(p, shop, item, 'shop_template:inv', /\bbuy\s*1\b/i);
  assert.equal(p.invTotal(inv, coins), money - buyPrice, 'shared shop charges the exact price');
  assert.equal(p.invTotal(inv, item), held + 1, 'shared shop transfers the purchased item');
  assert.equal(shop.getItemCount(item), quantity - 1, 'purchase reduces shared stock');
  World.currentTick = Math.ceil((World.currentTick + 1) / rate) * rate;
  World.processCleanup();
  assert.equal(shop.getItemCount(item), quantity, 'production restock replenishes the missing item');
  transact(p, p.getInventory(inv), item, 'shop_template_side:inv', /\bsell\s*1\b/i);
  assert.equal(p.invTotal(inv, coins), money - buyPrice + sellPrice, 'shared shop pays the exact base sale price');
  assert.equal(p.invTotal(inv, item), held, 'shared shop takes the sold item');
  assert.equal(shop.getItemCount(item), quantity + 1, 'sale increases shared stock');
  World.currentTick += rate; World.processCleanup();
  assert.equal(shop.getItemCount(item), quantity, 'production restock removes excess stock');
}
function check(name, fn) { fn(); assertions++; console.log(`PASS ${name}`); }

const capeSuffixes = [1, 3, 4, 5, 6, 7, 8, 9, 10];
check('every native cape seller form and duplicate William placement is reachable on the packed map', () => {
  for (const suffix of capeSuffixes) {
    const name = `wilderness_capeseller_${suffix}`, rows = nativeNpcRows(name);
    assert.equal(rows.length, suffix === 1 ? 2 : 1, `${name} native placement count`);
    for (const row of rows) {
      const npc = nativeNpc(row), p = fixture(npc);
      const coord = (row.level << 28) | (row.x << 14) | row.z;
      const wildernessLevel = proc(p, 'wilderness_level', [coord]);
      console.log(`PLACEMENT ${name} ${row.coord} Wilderness=${wildernessLevel} operate=${p.level}_${p.x}_${p.z}`);
      assert.equal(wildernessLevel, row.z < 3520 ? 0 : Math.floor((row.z - 3520) / 8) + 1);
    }
  }
  assert.equal(nativeNpcRows('wilderness_capeseller_2').length, 0, 'Ian has no native placement and no NPC is added');
});
check('merchant additions define only scoped exact NPC handlers, never category/global dispatch', () => {
  const allowed = new Set([...capeSuffixes.map(n => `wilderness_capeseller_${n}`), 'dt_bandit_shopkeeper']);
  for (const file of ['scripts/areas/area_wilderness/scripts/wilderness_capesellers.rs2', 'scripts/areas/area_desert/scripts/n618_desert_bandit_shop.rs2']) {
    const source = readFileSync(`${content}/${file}`, 'utf8');
    for (const match of source.matchAll(/^\[(?:apnpc|opnpc)\d,([^\]]+)\]/gm)) assert(allowed.has(match[1]), `unscoped NPC handler ${match[0]}`);
  }
  const player = new Player('n618_dispatch', 1900n, 0n);
  for (const line of readFileSync(`${content}/pack/npc.pack`, 'utf8').split(/\r?\n/)) {
    const match = /^(\d+)=(.+)$/.exec(line);
    if (!match || allowed.has(match[2]) || match[2] === 'fourdiamonds_bartender') continue;
    const type = types.NpcType.get(Number(match[1]));
    if (!type) continue;
    player.target = new Npc(0, 3100, 3519, type.size, type.size, EntityLifeCycle.RESPAWN, 1, type.id, BlockWalk.NONE);
    for (let slot = 1; slot <= 5; slot++) {
      player.targetOp = ServerTriggerType.OPNPC1 + slot - 1 - 7;
      const script = player.getOpTrigger();
      if (!script) continue;
      const target = /^\[(?:apnpc|opnpc)\d,([^\]]+)\]$/.exec(script.name)?.[1];
      assert(!allowed.has(target), `${type.debugname} must not dispatch to a scoped merchant handler`);
    }
  }
});

check('all numbered capes exist in the 377 pack and the inherited shops contain only their five original numbers', () => {
  for (let suffix = 1; suffix <= 10; suffix++) {
    const shop = types.InvType.get(id('InvType', `wildernesscapeshop${suffix}`));
    const expected = Array.from({ length: 5 }, (_, index) => id('ObjType', `wilderness_cape_${suffix + index * 10}`));
    assert.equal(shop.scope, types.InvType.SCOPE_SHARED);
    assert.equal(shop.size, 40); assert.equal(shop.stackall, true); assert.equal(shop.restock, true); assert.equal(shop.allstock, false);
    assert.deepEqual([...shop.stockobj], expected);
    assert.deepEqual([...shop.stockcount], [100, 100, 100, 100, 100]);
    assert.deepEqual([...shop.stockrate], [100, 100, 100, 100, 100]);
    for (const item of expected) {
      const type = types.ObjType.get(item);
      assert.equal(type.cost, 50); assert.equal(type.members, true);
    }
  }
});

check('the m49_46 Bandit shop is in the desert and retains only original-cache supply stock', () => {
  const row = nativeNpcRows('dt_bandit_shopkeeper')[0]; assert(row, 'native desert shopkeeper');
  assert.equal(row.mx, 49); assert.equal(row.mz, 46);
  const npc = nativeNpc(row), p = fixture(npc);
  assert.equal(proc(p, 'wilderness_level', [(row.level << 28) | (row.x << 14) | row.z]), 0);
  const stock = types.InvType.get(id('InvType', 'dt_bandit_shop'));
  const names = ['water_skin4', 'water_skin0', 'jug_water', 'bowl_water', 'bucket_water', 'jug_empty', 'bowl_empty', 'bucket_empty', 'desert_boots', 'desert_shirt', 'desert_robe', 'knife'];
  assert.deepEqual([...stock.stockobj], names.map(name => id('ObjType', name)));
  assert.deepEqual([...stock.stockcount], Array(12).fill(5));
  assert.deepEqual([...stock.stockrate], [100, 100, 100, 100, 100, 100, 100, 100, 500, 500, 500, 100]);
});

check('Bandit Bargains opens from both original options and trades every retained supply item through shared shop code', () => {
  const npc = nativeNpc(nativeNpcRows('dt_bandit_shopkeeper')[0]);
  const trade = fixture(npc); op(trade, npc, 3);
  const shop = openShop(trade, 'dt_bandit_shop', 'Bandit Bargains');
  assert.equal(trade.getVar(id('VarPlayerType', 'shop_buy')), 700);
  assert.equal(trade.getVar(id('VarPlayerType', 'shop_sell')), 1000);
  assert.equal(trade.getVar(id('VarPlayerType', 'shop_haggle')), 10);
  for (const [name, rate, price, payout] of [
    ['water_skin4', 100, 30, 21], ['water_skin0', 100, 15, 10],
    ['jug_water', 100, 1, 0], ['bowl_water', 100, 4, 2], ['bucket_water', 100, 6, 4],
    ['jug_empty', 100, 1, 0], ['bowl_empty', 100, 4, 2], ['bucket_empty', 100, 2, 1],
    ['desert_boots', 500, 20, 14], ['desert_shirt', 500, 40, 28], ['desert_robe', 500, 40, 28],
    ['knife', 100, 6, 4],
  ]) purchaseAndSale(trade, shop, id('ObjType', name), 5, rate, price, payout);
  const talk = fixture(npc); op(talk, npc, 1, [1]); openShop(talk, 'dt_bandit_shop', 'Bandit Bargains');
  assert(texts(talk).includes('Hello.')); assert(texts(talk).includes('Stuff for sale. You buying?'));
  const decline = fixture(npc); op(decline, npc, 1, [2]);
  assert(texts(decline).includes("No? 'Bye then."));
  assert.notEqual(decline.modalMain, id('Component', 'shop_template'));
});

check('each placed cape seller opens the original shop from Trade and Talk and trades all five capes through shared handlers', () => {
  for (const suffix of capeSuffixes) {
    const npc = nativeNpc(nativeNpcRows(`wilderness_capeseller_${suffix}`)[0]);
    const shopName = `wildernesscapeshop${suffix}`;
    const title = `${types.NpcType.get(npc.type).name}'s Wilderness Cape Shop.`;
    const trade = fixture(npc); op(trade, npc, 3);
    const stock = openShop(trade, shopName, title);
    assert.equal(trade.getVar(id('VarPlayerType', 'shop_buy')), 600);
    assert.equal(trade.getVar(id('VarPlayerType', 'shop_sell')), 1000);
    assert.equal(trade.getVar(id('VarPlayerType', 'shop_haggle')), 10);
    assert.equal(proc(trade, 'adjusted_item_cost_buying', [id('ObjType', `wilderness_cape_${suffix}`), 90]), 55, 'ten missing capes produce the sourced 1% adjustment per item');
    for (let number = suffix; number <= 50; number += 10) {
      purchaseAndSale(trade, stock, id('ObjType', `wilderness_cape_${number}`), 100, 100, 50, 30);
    }
    const talk = fixture(npc); op(talk, npc, 1, [2]);
    openShop(talk, shopName, title);
    assert(transcript(talk).includes('Hello there, are you interested in buying one of my special capes?'), transcript(talk));
    const explained = fixture(npc); op(explained, npc, 1, [1, 2]);
    openShop(explained, shopName, title);
    assert(texts(explained).includes('So would you like to buy one?'));
    assert(transcript(explained).includes("They're very useful when out in the wilderness with friends or anyone else you don't want to harm."));
    const decline = fixture(npc); op(decline, npc, 1, [3]);
    assert.notEqual(decline.modalMain, id('Component', 'shop_template'), 'declining the dialogue offer does not open a shop');
    assert(texts(decline).includes('No thanks.'));
  }
});

check('bartender Trade sells the sourced drink through dialogue without opening an invented shop or changing later quest stages', () => {
  const npc = nativeNpc(nativeNpcRows('fourdiamonds_bartender')[0]);
  const stage = id('VarBitType', 'deserttreasure'), brew = id('ObjType', 'bandit_brew');
  for (const before of [1, 5, 6, 7, 14]) {
    const p = fixture(npc, 650); p.setVarBit(stage, before);
    op(p, npc, 3, [1]);
    assert(transcript(p).includes("What's that? You wanna buy a beer? It'll cost ya 650 coins."));
    assert(!transcript(p).includes("If you're not buying anything, I have nothing to say to you."), 'Trade skips the Talk-only greeting and first menu');
    assert.equal(p.invTotal(inv, coins), 0); assert.equal(p.invTotal(inv, brew), 1);
    assert.equal(p.getVarBit(stage), before === 5 ? 6 : before);
    assert.notEqual(p.modalMain, id('Component', 'shop_template'), 'the bar uses dialogue, not a stock interface');
  }
  for (const [money, choices] of [[649, [1]], [650, [2]]]) {
    const p = fixture(npc, money); p.setVarBit(stage, 1); op(p, npc, 3, choices);
    assert.equal(p.invTotal(inv, coins), money); assert.equal(p.invTotal(inv, brew), 0);
    assert.notEqual(p.modalMain, id('Component', 'shop_template'));
  }
  const full = fixture(npc, 650); full.setVarBit(stage, 1); full.invAdd(inv, id('ObjType', 'pot_empty'), 27);
  op(full, npc, 3, [1]);
  assert.equal(full.invTotal(inv, coins), 650); assert.equal(full.invTotal(inv, brew), 0);
});

check('bartender refuses unstarted accounts and exposes the sourced bar only after genuine quest completion', () => {
  const npc = nativeNpc(nativeNpcRows('fourdiamonds_bartender')[0]), stage = id('VarBitType', 'deserttreasure');
  for (const [option, line] of [[1, 'Get out of here. I have nothing to say to the likes of you.'], [3, "Get out of here, we don't like your sort in these parts."]]) {
    const p = fixture(npc, 650); op(p, npc, option);
    assert(transcript(p).includes(line)); assert.equal(p.invTotal(inv, coins), 650);
    assert.equal(p.invTotal(inv, id('ObjType', 'bandit_brew')), 0);
    assert.notEqual(p.modalMain, id('Component', 'shop_template'));
  }
  const type = types.InvType.get(id('InvType', 'fd_bandit_bar')), brew = id('ObjType', 'bandit_brew');
  assert.deepEqual([...type.stockobj], [brew]); assert.deepEqual([...type.stockcount], [10]); assert.deepEqual([...type.stockrate], [100]);
  const trade = fixture(npc); trade.setVarBit(stage, 15); op(trade, npc, 3);
  const shop = openShop(trade, 'fd_bandit_bar', 'The Big Heist Lodge');
  purchaseAndSale(trade, shop, brew, 10, 100, 650, 350);
  assert.equal(trade.getVarBit(stage), 15);
  for (const [gender, word] of [[0, 'fella'], [1, 'lass']]) {
    const p = fixture(npc); p.gender = gender; p.setVarBit(stage, 15); op(p, npc, 1, [1]);
    openShop(p, 'fd_bandit_bar', 'The Big Heist Lodge');
    assert(transcript(p).includes(`So you're the ${word} that freed Azzanadra, huh? Fair play to ya. What will you have?`));
  }
  const decline = fixture(npc); decline.setVarBit(stage, 15); op(decline, npc, 1, [2]);
  assert(transcript(decline).includes("Didn't feel like a drink after all, huh? Well, stop by anytime, hero."));
  assert.notEqual(decline.modalMain, id('Component', 'shop_template'));
});

check('existing bartender Talk purchase and four-diamonds progression remain intact', () => {
  const row = nativeNpcRows('fourdiamonds_bartender')[0]; assert(row, 'native desert bartender');
  const npc = nativeNpc(row), brew = id('ObjType', 'bandit_brew'), stage = id('VarBitType', 'deserttreasure');
  assert.equal(row.mx, 49); assert.equal(row.mz, 46);
  for (const [before, money, choices, after, drinks] of [[0, 649, [], 0, 0], [1, 649, [1], 1, 0], [5, 650, [1, 1], 6, 1], [6, 0, [2], 7, 0]]) {
    const p = fixture(npc, money); p.setVarBit(stage, before);
    op(p, npc, 1, choices);
    assert.equal(p.getVarBit(stage), after, 'only existing successful purchase or rumor advances the quest');
    assert.equal(p.invTotal(inv, brew), drinks);
    assert.equal(p.invTotal(inv, coins), drinks ? money - 650 : money);
  }
});

console.log(`RESULT PASS N618 Wilderness shops: ${assertions} compiled checks`);
process.exit(0);
