// Run from the sibling engine after a full pack: node --import tsx ../content/tests/test_public_test_shop.mjs
// Real packed scripts, the engine's NODE_PUBLIC_TEST startup hook, Player dispatch, dialogue choices
// and the shared shop inventory buttons. No server, no network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BlockWalk, EntityLifeCycle, IfSetText, InvButton, InvButtonHandler, MessageGame, Npc, Player,
  ResumePauseButton, ResumePauseButtonHandler, ScriptProvider, ScriptRunner, ScriptState,
  ServerTriggerType, World, content, engine, floorTiles, map, nativeLocInventory, nativeNpcRows, requiredId, types
} from './regicide-travel/runtime.mjs';

const Environment = (await import(pathToFileURL(path.join(engine, 'src/util/Environment.ts')).href)).default;

const id = (kind, name) => requiredId(types[kind], name);
const inv = id('InvType', 'inv'), coins = id('ObjType', 'coins');
const keeper = id('NpcType', 'generalshopkeeper1');
const pause = new ResumePauseButtonHandler(), button = new InvButtonHandler();
const logs = new WeakMap();
let serial = 0, assertions = 0;

const BANK_TILES = {
  'Varrock West Bank': '0_49_53_46_48',
  'Varrock East Bank': '0_50_53_53_29',
  'Edgeville Bank': '0_48_54_21_39',
  'Draynor Bank': '0_48_50_22_44',
  'Ardougne East South Bank': '0_41_51_29_20',
  'Ardougne East North Bank': '0_40_52_57_5',
  "Seers' Village Bank": '0_42_54_37_36'
};
const LUMBRIDGE = '0_50_50_9_47';
const SHOPS = [
  ['public_test_tools', 'Tools & Basics'],
  ['public_test_rares', 'Rares & Fun Items'],
  ['public_test_runes', 'Runes, Essence & Jewellery'],
  ['public_test_farming', 'Farming Seeds & Supplies'],
  ['public_test_skilling', 'Ores, Bars & Skilling Materials'],
  ['public_test_herblore', 'Herbs & Herblore Secondaries'],
  ['public_test_slayer', 'Slayer Gear & Supplies'],
  ['public_test_food', 'Food & Potions'],
  ['public_test_combat', 'Combat Gear']
];
// Content under test that the free shops must never sell.
const EXCLUDED_DEBUGNAME = /infinity|magictraining|tzhaar|obsidian|onyx|barrows|castlewars|castle_wars|pest_control|pestcontrol|void_knight|^fire_cape|bones_to_peach/i;
const EXCLUDED_NAME = /infinity|master wand|mage's book|teacher wand|beginner wand|apprentice wand|bones to peaches|fire cape|obsidian|tzhaar|toktz|tzhaar-ket|onyx|ahrim|dharok|guthan|karil|torag|verac|castle ?wars|void knight/i;

function tile(coord) {
  const [level, mx, mz, lx, lz] = coord.split('_').map(Number);
  return { level, x: mx * 64 + lx, z: mz * 64 + lz };
}
function packCoord({ level, x, z }) { return (level << 28) | (x << 14) | z; }
function withPublicTest(enabled, fn) {
  const original = Environment.NODE_PUBLIC_TEST;
  Environment.NODE_PUBLIC_TEST = enabled;
  try { return fn(); } finally { Environment.NODE_PUBLIC_TEST = original; }
}
function keepersAt(coord) {
  const { level, x, z } = tile(coord);
  return [...World.npcs].filter(npc => npc && npc.isActive && npc.type === keeper && npc.level === level && npc.x === x && npc.z === z);
}
function fixture(npc, amount = 0) {
  const p = new Player(`pts_test_${++serial}`, BigInt(serial), 0n);
  p.slot = serial; p.pid = serial; p.uid = (Number(p.username37 & 0x1fffffn) << 11) | serial; p.vars.fill(0);
  const candidates = [];
  for (let x = npc.x - 1; x <= npc.x + npc.width; x++) for (let z = npc.z - 1; z <= npc.z + npc.length; z++) {
    if (floorTiles.has(`${npc.level},${x},${z}`) && !map.isMapBlocked(x, z, npc.level) &&
      map.reachedEntity(npc.level, x, z, npc.x, npc.z, npc.width, npc.length, 1)) candidates.push([npc.level, x, z]);
  }
  assert(candidates.length, `${types.NpcType.get(npc.type).debugname} at ${npc.x},${npc.z} has a normal walkable operate tile`);
  [p.level, p.x, p.z] = candidates[0];
  p.buildArea.originX = Math.floor(p.x / 8) * 8; p.buildArea.originZ = Math.floor(p.z / 8) * 8;
  World.players[p.slot] = p;
  const packets = []; logs.set(p, packets); p.write = packet => packets.push(packet);
  if (amount > 0) p.getInventory(inv).add(coins, amount);
  return p;
}
function texts(p) { return logs.get(p).filter(packet => packet instanceof IfSetText).map(packet => packet.text.replace(/[|\s]+/g, ' ')); }
function messages(p) { return logs.get(p).filter(packet => packet instanceof MessageGame).map(packet => packet.msg); }
function clearLog(p) { logs.get(p).length = 0; }
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
  assert.equal(script?.name, `[opnpc${slot},generalshopkeeper1]`, 'Player dispatch selects the exact generalshopkeeper1 trigger');
  return run(p, script, npc, [...choices]);
}
function proc(p, name, args = []) {
  const state = run(p, ScriptProvider.getByName(`[proc,${name}]`), null, [], args);
  return state.intStack[state.isp - 1];
}
function openShop(p, name, title) {
  assert.equal(p.modalMain, id('Component', 'shop_template'), `${name}: shop interface open`);
  assert.equal(p.modalSide, id('Component', 'shop_template_side'));
  assert(texts(p).includes(title), `${name} title "${title}" appears in the shop interface: ${texts(p).join(' / ')}`);
  assert.equal(p.getVar(id('VarPlayerType', 'shop')), id('InvType', name), `%shop is ${name}`);
  const listener = p.invListeners.find(listener => listener.type === id('InvType', name) && listener.com === id('Component', 'shop_template:inv'));
  assert(listener, 'shop transmits a real inventory');
  return p.getInventoryFromListener(listener);
}
function buttonIndex(component, option) {
  const index = (types.Component.get(id('Component', component)).iop ?? []).findIndex(text => option.test(text ?? ''));
  assert(index >= 0, `${component} has ${option}`); return index + 1;
}
function transact(p, container, item, component, option) {
  const slot = container.getItemIndex(item); assert(slot >= 0, 'item exists in the transmitted container');
  assert(button.handle(new InvButton(buttonIndex(component, option), item, slot, id('Component', component)), p),
    `production inventory button accepted: ${component} ${option}`);
}
const buy = (p, shop, item, n) => transact(p, shop, item, 'shop_template:inv', new RegExp(`\\bbuy\\s*${n}\\b`, 'i'));
const sell = (p, item, n) => transact(p, p.getInventory(inv), item, 'shop_template_side:inv', new RegExp(`\\bsell\\s*${n}\\b`, 'i'));
function check(name, fn) { fn(); assertions++; console.log(`PASS ${name}`); }

function invSource() {
  return readFileSync(path.join(content, 'scripts/public_test/configs/public_test.inv'), 'utf8');
}
function sourceStock() {
  const stock = new Map();
  let current = null;
  for (const line of invSource().split(/\r?\n/)) {
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) { current = header[1]; stock.set(current, []); continue; }
    const row = /^stock(\d+)=([^,]+),(\d+)/.exec(line);
    if (row && current) stock.get(current).push(row[2]);
  }
  return stock;
}
function runWorldProc(name) {
  // The engine's own world-context call (no player, no npc), as World.runPublicTestStartup makes it.
  const state = ScriptRunner.init(ScriptProvider.getByName(`[proc,${name}]`));
  assert.equal(ScriptRunner.execute(state), ScriptState.FINISHED, `${name} finishes`);
}

const lumbridgeTile = tile(LUMBRIDGE);
const lumbridge = [...World.npcs].find(npc => npc && npc.type === keeper && npc.x === lumbridgeTile.x && npc.z === lumbridgeTile.z);

// ---------------------------------------------------------------------------------------------
check('generalshopkeeper1 is reused unchanged: native placement only in Lumbridge, Talk-to/Trade ops', () => {
  const type = types.NpcType.get(keeper);
  assert.equal(type.name, 'Shop keeper');
  assert.equal(type.op[0], 'Talk-to'); assert.equal(type.op[2], 'Trade');
  assert.deepEqual(nativeNpcRows('generalshopkeeper1').map(row => row.coord), [LUMBRIDGE]);
  assert(lumbridge, 'the packed map spawns the Lumbridge keeper');
});

check('nine public test invs: <= 40 stock rows, packed objs only, no excluded content, enum mirrors stock', () => {
  const stock = sourceStock();
  assert.deepEqual([...stock.keys()], SHOPS.map(([name]) => name));
  const objNames = new Set(readFileSync(path.join(content, 'pack/obj.pack'), 'utf8').split(/\r?\n/).map(line => line.slice(line.indexOf('=') + 1)));
  const union = new Set();
  for (const [name] of SHOPS) {
    const rows = stock.get(name);
    assert(rows.length > 0 && rows.length <= 40, `${name} has ${rows.length} stock rows`);
    assert.equal(new Set(rows).size, rows.length, `${name} lists each obj once`);
    const type = types.InvType.get(id('InvType', name));
    assert.equal(type.size, 40); assert.equal(type.scope, types.InvType.SCOPE_SHARED);
    assert.equal(type.restock, false); assert.equal(type.allstock, false); assert.equal(type.stackall, true);
    assert.deepEqual([...type.stockobj], rows.map(debugname => id('ObjType', debugname)), `${name} packed stock equals its source`);
    for (const debugname of rows) {
      assert(objNames.has(debugname), `${name}: ${debugname} is in pack/obj.pack`);
      const obj = types.ObjType.get(id('ObjType', debugname));
      assert.equal(obj.certtemplate, -1, `${name}: ${debugname} is not a banknote`);
      assert(!EXCLUDED_DEBUGNAME.test(debugname) && !EXCLUDED_NAME.test(obj.name ?? ''), `${name}: ${debugname} (${obj.name}) is excluded content`);
      union.add(id('ObjType', debugname));
    }
  }
  const map = types.EnumType.get(id('EnumType', 'public_test_shop_obj'));
  const keys = new Set([...map.values.keys()]);
  assert.deepEqual([...keys].sort((a, b) => a - b), [...union].sort((a, b) => a - b), 'enum keys equal the union of all stock');
  // Bulk supplies are given noted; everything else is given as stocked.
  const notedOnly = new Set([
    ...stock.get('public_test_skilling').filter(name => name !== 'glassblowingpipe'),
    ...stock.get('public_test_herblore').filter(name => name !== 'pestle_and_mortar'),
    ...stock.get('public_test_food'),
    'blankrune', 'blankrune_high', 'plantpot_empty', 'bucket_compost', 'bucket_supercompost'
  ].map(name => id('ObjType', name)));
  for (const [key, value] of map.values) {
    const given = types.ObjType.get(value), stocked = types.ObjType.get(key);
    if (notedOnly.has(key)) {
      assert.notEqual(given.certtemplate, -1, `${stocked.debugname} is given noted`);
      assert.equal(given.certlink, key, `${given.debugname} is the note of ${stocked.debugname}`);
    } else {
      assert.equal(value, key, `${stocked.debugname} is given as stocked`);
    }
  }
});

check('bank tiles are walkable, unobstructed floor with no other loc or NPC placement', () => {
  const locs = nativeLocInventory();
  for (const [bank, coord] of Object.entries(BANK_TILES)) {
    const { level, x, z } = tile(coord);
    assert.equal(packCoord({ level, x, z }), packCoord(tile(coord)));
    assert(floorTiles.has(`${level},${x},${z}`), `${bank}: 377 map floor`);
    assert.equal(map.isMapBlocked(x, z, level), false, `${bank}: packed collision leaves ${coord} walkable`);
    const blocking = locs.filter(row => row.level === level && row.x === x && row.z === z && row.shape !== 22);
    assert.deepEqual(blocking.map(row => row.name), [], `${bank}: no wall/scenery loc on ${coord}`);
    const occupied = [...World.npcs].filter(npc => npc && npc.isActive && npc.level === level && npc.x === x && npc.z === z);
    assert.deepEqual(occupied.map(npc => types.NpcType.get(npc.type).debugname), [], `${bank}: no NPC already stands on ${coord}`);
  }
});

// --- NODE_PUBLIC_TEST=false ----------------------------------------------------------------------
check('NODE_PUBLIC_TEST=false: engine hook and content proc spawn no bank keepers', () => {
  withPublicTest(false, () => {
    assert.equal(World.runPublicTestStartup(), false, 'engine hook is a no-op');
    runWorldProc('world_startup_public_test');
    for (const coord of Object.values(BANK_TILES)) assert.equal(keepersAt(coord).length, 0, `no keeper at ${coord}`);
  });
});

check('NODE_PUBLIC_TEST=false: Lumbridge keeper is unchanged and a keeper on a bank tile gives no free shop', () => {
  withPublicTest(false, () => {
    const trade = fixture(lumbridge, 1000); op(trade, lumbridge, 3);
    openShop(trade, 'generalshop1', 'Lumbridge General Store');
    const talk = fixture(lumbridge); op(talk, lumbridge, 1, [2]);
    assert(texts(talk).includes('Can I help you at all?'), 'Lumbridge Talk-to keeps the general store help');
    assert.notEqual(talk.modalMain, id('Component', 'shop_template'));

    // Fixture only: a keeper placed on a bank tile by the test (the product never does this with the flag off).
    const t = tile(BANK_TILES['Varrock West Bank']);
    const stray = new Npc(t.level, t.x, t.z, 1, 1, EntityLifeCycle.DESPAWN, World.getNextNid(), keeper, BlockWalk.NPC);
    World.addNpc(stray, -1);
    try {
      const strayTrade = fixture(stray); op(strayTrade, stray, 3);
      openShop(strayTrade, 'generalshop1', 'Lumbridge General Store');
      const strayTalk = fixture(stray); op(strayTalk, stray, 1, [2]);
      assert(texts(strayTalk).includes('Can I help you at all?'));
    } finally {
      World.removeNpc(stray, -1);
    }

    // Fixture only: %shop forced to a public test inv with the flag off still charges and still buys.
    const forced = fixture(lumbridge);
    run(forced, ScriptProvider.getByName('[proc,openshop]'), null, [], [id('InvType', 'public_test_tools'), 1000, 1000, 0, 'forced']);
    const shop = openShop(forced, 'public_test_tools', 'forced');
    const axe = id('ObjType', 'bronze_axe');
    assert(proc(forced, 'adjusted_item_cost_buying', [axe, shop.getItemCount(axe)]) >= 1, 'flag off: price is the normal >= 1 gp');
    buy(forced, shop, axe, 1);
    assert.equal(forced.invTotal(inv, axe), 0, 'flag off: no coins, no axe');
    assert(messages(forced).includes("You don't have enough gp."), messages(forced).join(' / '));
  });
});

// --- NODE_PUBLIC_TEST=true -----------------------------------------------------------------------
let bankKeepers = {};
check('NODE_PUBLIC_TEST=true: the engine hook spawns exactly one keeper on each of the 7 bank tiles', () => {
  withPublicTest(true, () => {
    assert.equal(World.runPublicTestStartup(), true, 'engine hook runs the content proc');
    runWorldProc('world_startup_public_test'); // a second run must not duplicate
    for (const [bank, coord] of Object.entries(BANK_TILES)) {
      const found = keepersAt(coord);
      assert.equal(found.length, 1, `${bank}: one keeper at ${coord}`);
      const { level, x, z } = tile(coord);
      assert(floorTiles.has(`${level},${x},${z}`) && !map.isMapBlocked(x, z, level), `${bank}: keeper stands on walkable floor`);
      bankKeepers[bank] = found[0];
      console.log(`SPAWN ${bank} ${coord} nid=${found[0].nid}`);
    }
    assert.equal(keepersAt(LUMBRIDGE).length, 1, 'Lumbridge still has its single native keeper');
  });
});

check('NODE_PUBLIC_TEST=true: Trade on every bank keeper opens Tools & Basics; Lumbridge keeps its shop', () => {
  withPublicTest(true, () => {
    for (const [bank, npc] of Object.entries(bankKeepers)) {
      const p = fixture(npc); op(p, npc, 3); openShop(p, 'public_test_tools', 'Tools & Basics');
      console.log(`TRADE ${bank} -> public_test_tools`);
    }
    const trade = fixture(lumbridge, 1000); op(trade, lumbridge, 3);
    openShop(trade, 'generalshop1', 'Lumbridge General Store');
    const talk = fixture(lumbridge); op(talk, lumbridge, 1, [2]);
    assert(texts(talk).includes('Can I help you at all?'), 'Lumbridge Talk-to falls through to the general store help');
  });
});

check('NODE_PUBLIC_TEST=true: Talk-to reaches all 9 categories over two choice pages', () => {
  withPublicTest(true, () => {
    const npc = bankKeepers['Edgeville Bank'];
    SHOPS.forEach(([name, title], index) => {
      const choices = index < 4 ? [index + 1] : [5, index - 3];
      const p = fixture(npc); op(p, npc, 1, choices);
      const page = index < 4 ? SHOPS.slice(0, 4) : SHOPS.slice(4);
      for (const [, label] of page) assert(texts(p).includes(label), `menu lists ${label}: ${texts(p).join(' / ')}`);
      if (index >= 4) assert(texts(p).includes('More shops...'), 'page one offers the second page');
      openShop(p, name, title);
    });
  });
});

check('NODE_PUBLIC_TEST=true: 0gp purchases (Buy 1/5/10, stackable and not) never deplete stock and stop on a full pack', () => {
  withPublicTest(true, () => {
    const npc = bankKeepers['Draynor Bank'];
    const p = fixture(npc); op(p, npc, 3);
    const shop = openShop(p, 'public_test_tools', 'Tools & Basics');
    const axe = id('ObjType', 'bronze_axe'), feather = id('ObjType', 'feather'), bait = id('ObjType', 'fishing_bait');
    const base = { axe: shop.getItemCount(axe), feather: shop.getItemCount(feather), bait: shop.getItemCount(bait) };
    assert.equal(p.invTotal(inv, coins), 0, 'buyer carries no coins');

    transact(p, shop, axe, 'shop_template:inv', /^value$/i);
    assert(messages(p).includes('Bronze axe: currently costs 0 gp.'), messages(p).join(' / '));

    buy(p, shop, axe, 1); assert.equal(p.invTotal(inv, axe), 1, 'Buy 1');
    buy(p, shop, axe, 5); assert.equal(p.invTotal(inv, axe), 6, 'Buy 5');
    buy(p, shop, axe, 10); assert.equal(p.invTotal(inv, axe), 16, 'Buy 10');
    buy(p, shop, feather, 10); assert.equal(p.invTotal(inv, feather), 10, 'stackable Buy 10 fills one stack');
    buy(p, shop, feather, 5); assert.equal(p.invTotal(inv, feather), 15, 'stackable Buy 5 adds to the stack');
    assert.equal(p.getInventory(inv).freeSlotCount, 28 - 17, '16 axes + 1 feather stack');
    assert.equal(p.invTotal(inv, coins), 0, 'no coins were needed or created');
    assert(!messages(p).includes("You don't have enough inventory space."));

    clearLog(p);
    buy(p, shop, axe, 10); assert.equal(p.invTotal(inv, axe), 26, 'Buy 10 with exactly 11 free slots');
    buy(p, shop, axe, 10); assert.equal(p.invTotal(inv, axe), 27, 'Buy 10 stops after the last free slot');
    assert.equal(p.getInventory(inv).freeSlotCount, 0, 'inventory is full');
    assert.deepEqual(messages(p), ["You don't have enough inventory space."], 'exactly one clean stop message');

    clearLog(p);
    buy(p, shop, feather, 10); assert.equal(p.invTotal(inv, feather), 25, 'held stackable still stacks into a full pack');
    buy(p, shop, bait, 1); assert.equal(p.invTotal(inv, bait), 0, 'new stackable needs a slot');
    buy(p, shop, axe, 1); assert.equal(p.invTotal(inv, axe), 27, 'non-stackable refused when full');
    assert.deepEqual(messages(p), ["You don't have enough inventory space.", "You don't have enough inventory space."]);

    assert.deepEqual({ axe: shop.getItemCount(axe), feather: shop.getItemCount(feather), bait: shop.getItemCount(bait) }, base, 'shop stock is unchanged');
  });
});

check('NODE_PUBLIC_TEST=true: bulk supplies arrive noted in one stack; tools stay unnoted', () => {
  withPublicTest(true, () => {
    const npc = bankKeepers['Varrock East Bank'];
    const p = fixture(npc); op(p, npc, 1, [5, 1]);
    const shop = openShop(p, 'public_test_skilling', 'Ores, Bars & Skilling Materials');
    const coal = id('ObjType', 'coal'), notedCoal = id('ObjType', 'cert_coal'), pipe = id('ObjType', 'glassblowingpipe');
    const stock = shop.getItemCount(coal);
    buy(p, shop, coal, 10); buy(p, shop, coal, 10); buy(p, shop, coal, 5); buy(p, shop, coal, 1);
    assert.equal(p.invTotal(inv, coal), 0, 'no unnoted coal');
    assert.equal(p.invTotal(inv, notedCoal), 26, 'Buy 10/10/5/1 gives 26 noted coal');
    assert.equal(p.getInventory(inv).freeSlotCount, 27, 'noted coal takes one slot');
    buy(p, shop, pipe, 1);
    assert.equal(p.invTotal(inv, pipe), 1, 'the glassblowing pipe (a tool) arrives unnoted');
    assert.equal(shop.getItemCount(coal), stock, 'shop stock is unchanged');
  });
});

check('NODE_PUBLIC_TEST=true: the free shops refuse every sale and value check', () => {
  withPublicTest(true, () => {
    const npc = bankKeepers['Seers\' Village Bank'];
    const p = fixture(npc, 500); op(p, npc, 1, [5, 4]);
    const shop = openShop(p, 'public_test_food', 'Food & Potions');
    const shark = id('ObjType', 'shark'), notedShark = id('ObjType', 'cert_shark'), axe = id('ObjType', 'bronze_axe');
    buy(p, shop, shark, 1);
    assert.equal(p.invTotal(inv, notedShark), 1, 'food arrives noted');
    p.getInventory(inv).add(axe, 1);
    const stock = shop.getItemCount(shark);
    clearLog(p);
    sell(p, notedShark, 1);
    sell(p, axe, 1);
    transact(p, p.getInventory(inv), notedShark, 'shop_template_side:inv', /^value$/i);
    assert.equal(p.invTotal(inv, notedShark), 1, 'noted shark kept'); assert.equal(p.invTotal(inv, axe), 1, 'unstocked item kept');
    assert.equal(p.invTotal(inv, coins), 500, 'no coins paid');
    assert.equal(shop.getItemCount(shark), stock); assert.equal(shop.getItemCount(axe), 0, 'nothing was dumped into the shop');
    assert.deepEqual(messages(p), Array(3).fill("You can't sell items to this shop."));
  });
});

check('normal shops charge >= 1 gp, deplete stock and buy items identically with the flag on and off', () => {
  const outcome = enabled => withPublicTest(enabled, () => {
    const p = fixture(lumbridge, 1000); op(p, lumbridge, 3);
    const shop = openShop(p, 'generalshop1', 'Lumbridge General Store');
    const item = shop.get(0).id, stock = shop.getItemCount(item);
    const price = proc(p, 'adjusted_item_cost_buying', [item, stock]);
    buy(p, shop, item, 1);
    const result = { price, paid: 1000 - p.invTotal(inv, coins), got: p.invTotal(inv, item), depleted: stock - shop.getItemCount(item) };
    sell(p, item, 1);
    result.restored = shop.getItemCount(item) === stock;
    result.sellRefused = messages(p).includes("You can't sell items to this shop.");
    return result;
  });
  const off = outcome(false), on = outcome(true);
  assert(off.price >= 1, `normal price ${off.price}`);
  assert.deepEqual(on, off, 'flag on and off are identical for the Lumbridge general store');
  assert.deepEqual({ paid: on.paid, got: on.got, depleted: on.depleted, restored: on.restored, sellRefused: on.sellRefused }, { paid: on.price, got: 1, depleted: 1, restored: true, sellRefused: false });
});

console.log(`public test shop: ${assertions} checks passed`);
process.exit(0);
