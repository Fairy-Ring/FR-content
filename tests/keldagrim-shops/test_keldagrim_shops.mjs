import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BlockWalk, EntityLifeCycle, IfSetText, InvButton, InvButtonHandler, MessageGame, Npc,
  Player, ResumePauseButton, ResumePauseButtonHandler, ScriptRunner, ScriptState,
  ServerTriggerType, World, floorTiles, map, nativeNpcRows, requiredId, types, walkable
} from '../regicide-travel/runtime.mjs';

// Source-backed expectations, not a copy of the compiled inventory under test.
const shops = JSON.parse(readFileSync(new URL('./shops.json', import.meta.url), 'utf8'));
const dialogue = JSON.parse(readFileSync(new URL('./dialogue.json', import.meta.url), 'utf8'));
const handlers = [...readFileSync(new URL('../../scripts/areas/area_keldagrim/scripts/keldagrim_shops.rs2', import.meta.url), 'utf8')
  .matchAll(/^\[(opnpc[1-5]),([^\]]+)\]/gm)].map(match => `${match[1]},${match[2]}`).sort();
assert.deepEqual(handlers, shops.flatMap(shop => [`opnpc1,${shop.npc}`, `opnpc3,${shop.npc}`]).sort(),
  'only the twenty-six assigned exact NPC option dispatches are added');
assert.equal(shops.length, 13, 'the assigned census unit contains thirteen shopkeepers');
assert.deepEqual(dialogue.map(entry => entry.npc).sort(), shops.map(shop => shop.npc).sort());
const packets = new WeakMap();
const pause = new ResumePauseButtonHandler();
const inventoryButton = new InvButtonHandler();
const id = (kind, name) => requiredId(types[kind], name);
const component = name => id('Component', name);
const invId = id('InvType', 'inv');
const coins = id('ObjType', 'coins');
let serial = 0;
let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, error: String(error.stack ?? error) }); console.error(`FAIL ${name}: ${error}`); }
}
function player(row) {
  const n = ++serial;
  const p = new Player(`keldagrim_shop_${n}`, BigInt(n), 0n);
  p.slot = n; p.pid = n;
  p.uid = ((Number(p.username37 & 0x1fffffn) << 11) | n) >>> 0;
  p.vars.fill(0); p.levels.fill(99); p.baseLevels.fill(99);
  p.level = row.level; p.x = row.x; p.z = row.z;
  p.buildArea.originX = Math.floor(p.x / 8) * 8;
  p.buildArea.originZ = Math.floor(p.z / 8) * 8;
  World.players[n] = p;
  packets.set(p, []); p.write = packet => packets.get(p).push(packet);
  return p;
}
function text(p) {
  return packets.get(p).filter(packet => packet instanceof IfSetText || packet instanceof MessageGame)
    .map(packet => packet instanceof MessageGame ? packet.msg : packet.text).join(' ').replace(/\s+/g, ' ');
}
function finish(p, state, choices) {
  const remaining = [...choices];
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 100; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, 'packed dialogue must not abort');
    if (state.execution === ScriptState.PAUSEBUTTON) {
      let selected = 0;
      const menu = [2, 3, 4, 5].find(count => p.modalChat === component(`multi${count}`));
      if (menu) {
        const expected = remaining.shift();
        assert.ok(expected, `unexpected ${menu}-choice menu: ${text(p)}`);
        const option = packets.get(p).filter(packet => packet instanceof IfSetText)
          .findLast(packet => packet.text === expected && types.Component.get(packet.component).rootLayer === component(`multi${menu}`));
        assert.ok(option, `missing expected choice ${expected}`);
        selected = option.component; p.lastCom = selected;
      }
      assert.ok(pause.handle(new ResumePauseButton(selected), p), 'production Continue/choice handler accepts the dialogue');
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false; p.executeScript(state, true, true);
    } else assert.fail(`unexpected script state ${state.execution}`);
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'dialogue finishes within 100 steps');
  assert.deepEqual(remaining, [], 'every supplied choice is consumed');
}
function dispatch(p, npc, operation, choices = []) {
  p.target = npc; p.targetOp = operation - 7;
  const script = p.getOpTrigger();
  assert.ok(script, 'production NPC dispatch resolves the visible option');
  const slot = operation === ServerTriggerType.OPNPC1 ? 1 : 3;
  assert.equal(script.name, `[opnpc${slot},${types.NpcType.get(npc.type).debugname}]`);
  const state = ScriptRunner.init(script, p, npc);
  p.executeScript(state, true); finish(p, state, choices);
}
function opened(p, shop) {
  assert.equal(p.modalMain, component('shop_template'));
  assert.equal(p.modalSide, component('shop_template_side'));
  assert.ok(text(p).includes(shop.title), `shop title ${shop.title}`);
  for (const [name, expected] of [['shop', id('InvType', shop.inventory)], ['shop_buy', shop.buyMultiplier], ['shop_sell', shop.sellMultiplier], ['shop_haggle', shop.delta]]) {
    assert.equal(p.getVar(id('VarPlayerType', name)), expected, name);
  }
  const listener = (type, com) => p.invListeners.find(entry => entry.type === type && entry.com === com);
  const shopCom = component('shop_template:inv'), playerCom = component('shop_template_side:inv');
  const stockListener = listener(id('InvType', shop.inventory), shopCom), playerListener = listener(invId, playerCom);
  assert.ok(stockListener && playerListener, 'production shop transmits both inventories');
  return { stock: p.getInventoryFromListener(stockListener), held: p.getInventoryFromListener(playerListener), shopCom, playerCom };
}
function button(p, com, expression, obj, slot) {
  const options = types.Component.get(com).iop;
  const op = options.findIndex(option => expression.test(option ?? '')) + 1;
  assert.ok(op > 0, `interface option ${expression}`);
  assert.ok(inventoryButton.handle(new InvButton(op, obj, slot, com), p), 'production inventory button accepts request');
}
function value(p, com, obj, slot, expected, direction) {
  packets.get(p).length = 0;
  button(p, com, /value/i, obj, slot);
  assert.ok(text(p).includes(`${direction} ${expected} gp.`), `price ${expected}: ${text(p)}`);
}

for (const shop of shops) {
  check(`${shop.npc}: original placement, packed inventory, all prices, Trade and Talk-to`, () => {
    const rows = nativeNpcRows(shop.npc);
    assert.equal(rows.length, 1, 'one original map placement');
    const row = rows[0];
    assert.deepEqual([row.mx, row.mz], shop.map, 'shop belongs to the sourced city/Blast Furnace map');
    // Check the actual native floor, not a guessed city label from the census join.
    walkable([row.level, row.x, row.z], shop.npc);
    const type = types.NpcType.get(id('NpcType', shop.npc));
    assert.equal(type.category, -1, 'the original NPC category is not changed to broaden dispatch');
    assert.equal(type.op[0], 'Talk-to'); assert.equal(type.op[2], 'Trade');
    const npc = new Npc(row.level, row.x, row.z, 1, 1, EntityLifeCycle.RESPAWN, ++serial, type.id, BlockWalk.NONE);
    npc.isActive = true; npc.lastMovement = -100;
    const p = player(row);
    dispatch(p, npc, ServerTriggerType.OPNPC3);
    const { stock, held, shopCom, playerCom } = opened(p, shop);
    const config = types.InvType.get(id('InvType', shop.inventory));
    assert.equal(config.scope, 2, 'stock is shared');
    assert.equal(config.restock, true);
    assert.equal(config.allstock, shop.allstock);
    assert.equal(config.stackall, true);
    assert.deepEqual(Array.from(config.stockobj), shop.stock.map(item => id('ObjType', item.item)), 'no later stock is imported');
    assert.deepEqual(Array.from(config.stockcount), shop.stock.map(item => item.count));
    assert.deepEqual(Array.from(config.stockrate), shop.stock.map(item => item.restock));
    const approach = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [row.level, row.x + dx, row.z + dz])
      .find(([level, x, z]) => floorTiles.has(`${level},${x},${z}`) && !map.isMapBlocked(x, z, level) && map.reachedEntity(level, x, z, row.x, row.z, 1, 1, 1));
    assert.ok(approach, 'a normal player can stand beside the placed shopkeeper');
    console.log(`FIXTURE ${shop.npc} approach=${approach.join(',')}`);
    for (const item of shop.stock) {
      const object = id('ObjType', item.item);
      assert.equal(types.ObjType.get(object).cost, item.cost, 'the unchanged 377 base value');
      assert.equal(stock.getItemCount(object), item.count);
      value(p, shopCom, object, stock.getItemIndex(object), item.buy, 'currently costs');
      held.add(object, 1);
      value(p, playerCom, object, held.getItemIndex(object), item.sell, 'will buy for');
      held.remove(object, 1);
    }
    // Every ordinary source-backed branch runs in the production dialogue interpreter.
    for (const path of dialogue.find(entry => entry.npc === shop.npc).paths) {
      check(`${shop.npc}: dialogue ${path.choices.join(' / ')}`, () => {
        const talker = player(row);
        dispatch(talker, npc, ServerTriggerType.OPNPC1, path.choices);
        const spoken = text(talker).replace(/<[^>]*>/g, '').replace(/\|/g, ' ').replace(/\s+/g, ' ');
        for (const line of path.lines) assert.ok(spoken.includes(line), `missing dialogue: ${line}`);
        if (path.opens) {
          assert.deepEqual(path.choices, shop.choices, 'the documented shop route');
          assert.equal(opened(talker, shop).stock, stock, 'Talk and Trade share actual shop stock');
        } else assert.notEqual(talker.modalMain, component('shop_template'), 'non-trading branch does not open a shop');
        World.players[talker.slot] = null;
      });
    }

    // Execute a real sale and purchase via the existing shared shop interface code.
    const selected = shop.stock.find(item => item.count > 0) ?? shop.stock[0];
    const object = id('ObjType', selected.item);
    held.add(coins, 1000000); held.add(object, 1);
    const coinsBefore = held.getItemCount(coins), stockBefore = stock.getItemCount(object);
    button(p, playerCom, /sell[^\d]*1\b/i, object, held.getItemIndex(object));
    assert.equal(held.getItemCount(object), 0);
    assert.equal(held.getItemCount(coins), coinsBefore + selected.sell);
    assert.equal(stock.getItemCount(object), stockBefore + 1);
    button(p, shopCom, /buy[^\d]*1\b/i, object, stock.getItemIndex(object));
    assert.equal(held.getItemCount(object), 1);
    assert.equal(held.getItemCount(coins), coinsBefore + selected.sell - selected.buyAfterSale);
    assert.equal(stock.getItemCount(object), stockBefore);

    // Specialist/general resale policy is production can_sell_obj, not a local substitute.
    const other = id('ObjType', 'logs');
    assert.ok(!shop.stock.some(item => item.item === 'logs'), 'policy fixture is outside normal stock');
    held.add(other, 1);
    const money = held.getItemCount(coins);
    button(p, playerCom, /sell[^\d]*1\b/i, other, held.getItemIndex(other));
    assert.equal(held.getItemCount(other), shop.allstock ? 0 : 1);
    if (!shop.allstock) assert.equal(held.getItemCount(coins), money);
    World.players[p.slot] = null;
  });
}
console.log(`RESULT ${failures.length ? 'FAIL' : 'PASS'} keldagrim-shops: ${passed} passed, ${failures.length} failed`);
if (failures.length) console.error(JSON.stringify(failures, null, 2));
process.exit(failures.length ? 1 : 0);
