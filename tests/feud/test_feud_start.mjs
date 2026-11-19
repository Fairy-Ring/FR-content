import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Packet, PlayerLoading, ScriptState, ServerTriggerType, World, count, dialoguePage,
  engineModule, id, inv, invButton, map, obj, player, resumeDialogue, seed, tick, tile, types
} from '../swamp-caves/runtime.mjs';

const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const bit = name => id('VarBitType', name);
const read = (p, name) => p.getVarBit(bit(name));
const stage = p => read(p, 'feud_var');
const gangMask = p => read(p, 'feud_var_comp_gangs');
const operationOffsets = {
  feud_ali_m: [1, 0],
  feud_drunken_ali: [1, 0],
  feud_egyptian_doorman_multi: [0, -1],
  feud_egyptian_minder: [1, 0]
};
const actors = name => {
  const type = id('NpcType', name);
  const found = [...World.npcs].filter(n => n.isActive && (n.baseType === type || n.type === type));
  assert(found.length, `original packed NPC placement ${name}`);
  return found;
};

function stand(p, n) {
  const candidates = [];
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    p.level = n.level; p.x = n.x + dx; p.z = n.z + dz;
    if (map.isMapBlocked(p.x, p.z, p.level) || !p.inOperableDistance(n)) continue;
    candidates.push(tile(p));
  }
  assert(candidates.length, `packed collision permits an ordinary stand beside NPC ${n.baseType}`);
  const [dx, dz] = operationOffsets[types.NpcType.get(n.baseType).debugname] ?? [-1, 0];
  const destination = candidates.find(point => point[1] === n.x + dx && point[2] === n.z + dz);
  assert(destination, 'the headed cell uses this same map-checked operation stand');
  // Verify an actual map route, not just a guessed adjacent coordinate.
  let route = null;
  for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
    const x = destination[1] + dx, z = destination[2] + dz;
    if (map.isMapBlocked(x, z, destination[0])) continue;
    const found = [...map.findPath(destination[0], x, z, destination[1], destination[2])];
    if (!found.length) continue;
    const last = CoordGrid.unpackCoord(found.at(-1));
    if (last.x === destination[1] && last.z === destination[2]) { route = found; break; }
  }
  assert(route, `pathfinder reaches the real operation stand ${destination}`);
  [p.level, p.x, p.z] = destination;
  p.originX = p.x; p.originZ = p.z;
  return destination;
}

function finish(p, choices = []) {
  const options = [...choices], pages = [];
  for (let step = 0; step < 240 && p.activeScript; step++) {
    const state = p.activeScript;
    assert.notEqual(state.execution, ScriptState.ABORTED, 'compiled dialogue does not abort');
    if (state.execution === ScriptState.FINISHED) break;
    if (state.execution === ScriptState.PAUSEBUTTON) {
      pages.push(...dialoguePage(p));
      const root = types.Component.get(p.modalChat).comName;
      if (/^multi[2-5]$/.test(root)) {
        assert(options.length, `unanswered choice ${root}: ${pages.at(-1)}`);
        const choice = options.shift();
        const selected = typeof choice === 'number' ? choice : Array.from({ length: Number(root.at(-1)) }, (_, i) => i + 1)
          .find(option => p.packets.slice(p.dialogueMark).some(packet => packet.constructor.name === 'IfSetText'
            && packet.component === id('Component', `${root}:com_${option}`) && packet.text === choice));
        assert(selected, `offered dialogue choice ${choice}`);
        resumeDialogue(p, selected);
      } else resumeDialogue(p);
    } else if (state.execution === ScriptState.SUSPENDED) tick(p);
    else assert.fail(`unexpected compiled dialogue state ${state.execution}`);
  }
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED, 'dialogue finishes within its bound');
  assert.equal(options.length, 0, 'every selected option was offered');
  return pages.join(' ');
}

function operate(p, n, option = 1, choices = [], item = null) {
  p.clearInteraction(); stand(p, n);
  if (item) { p.lastUseItem = obj(item); p.lastUseSlot = p.getInventory(inv).items.findIndex(entry => entry?.id === obj(item)); }
  const operation = item ? ServerTriggerType.APNPCU : ServerTriggerType.APNPC1 + option - 1;
  assert(p.setInteraction(1, n, operation), 'ordinary engine interaction is accepted');
  assert(p.inOperableDistance(n), 'the player can operate from the path-checked stand');
  const trigger = p.getOpTrigger();
  assert(trigger, 'production visible-form dispatcher finds a compiled handler');
  p.dialogueMark = p.packets.length;
  p.processInteraction();
  return { text: finish(p, choices), trigger: trigger.name };
}
const talk = (p, name, choices = []) => operate(p, actors(name)[0], 1, choices);
function begin(p) {
  assert.equal(stage(p), 0);
  talk(p, 'feud_ali_m', [1]);
  assert.equal(stage(p), 1, 'accepting Morrisane starts the compatible published stage');
}
function buyBeers(p) {
  p.invAdd(inv, obj('coins'), 100);
  talk(p, 'feud_ali_the_barman', ["Yes, I'd like a drink please."]);
  assert.equal(p.modalMain, id('Component', 'shop_template'), 'the drink option opens the real shop');
  const config = types.InvType.get(id('InvType', 'feud_alispub'));
  const expected = [
    ['beer', 83, 10], ['whisky', 10, 100], ['jug_wine', 13, 150],
    ['vodka', 5, 5], ['brandy', 4, 1500], ['grog', 12, 2500]
  ];
  assert.deepEqual(Array.from(config.stockobj), expected.map(([name]) => obj(name)), 'the pre-2021 six-drink stock is retained');
  assert.deepEqual(Array.from(config.stockcount), expected.map(([, quantity]) => quantity));
  assert.deepEqual(Array.from(config.stockrate), expected.map(([, , rate]) => rate));
  const component = id('Component', 'shop_template:inv');
  const listener = p.invListeners.find(entry => entry.com === component);
  assert(listener, 'the shop inventory is transmitted to the player');
  const stock = p.getInventoryFromListener(listener);
  const option = types.Component.get(component).iop.findIndex(text => /buy[^\d]*1\b/i.test(text ?? '')) + 1;
  assert(option > 0, 'the original shop component offers Buy 1');
  for (let n = 1; n <= 3; n++) {
    const money = count(p, 'coins'), available = stock.getItemCount(obj('beer'));
    assert(invButton(p, 'shop_template:inv', 'beer', option, stock.getItemIndex(obj('beer'))),
      'the production inventory packet buys beer');
    assert.equal(count(p, 'beer'), n, 'beer is purchased, not seeded');
    assert.equal(stock.getItemCount(obj('beer')), available - 1, 'a real shared-stock item is sold');
    assert.equal(money - count(p, 'coins'), 2, 'the candidate pub policy charges two coins, not the unscaled shop default');
  }
  p.closeModal();
}
function drink(p) {
  buyBeers(p);
  const drunk = actors('feud_drunken_ali')[0];
  for (let n = 1; n <= 3; n++) {
    operate(p, drunk, 1, [], 'beer');
    assert.equal(read(p, 'feud_var_drink'), n, `beer ${n} is recorded by the quest`);
    assert.equal(count(p, 'beer'), 3 - n, `beer ${n} is consumed once`);
    assert.equal(stage(p), 1, 'beer count does not overwrite stage bits');
  }
}
function buyReceipts(p) {
  p.invAdd(inv, obj('coins'), 500);
  const before = count(p, 'coins');
  talk(p, 'feud_ali_the_discount_camel_seller', [4, 2, 3, 5]);
  assert.equal(count(p, 'feud_camel_receipt'), 2, 'one purchase produces two original camel receipts');
  assert.equal(before - count(p, 'coins'), 500, 'candidate transcript pair offer is charged once');
}
function deliver(p) {
  talk(p, 'feud_egyptian_doorman_multi');
  assert.equal(gangMask(p), 1, 'the Menaphites accept only their receipt');
  assert.equal(count(p, 'feud_camel_receipt'), 1);
  talk(p, 'feud_egyptian_doorman_multi');
  assert.equal(gangMask(p), 1, 'a repeated hand-in cannot substitute for the other gang');
  assert.equal(count(p, 'feud_camel_receipt'), 1, 'a repeated hand-in consumes nothing');
  talk(p, 'feud_arabian_guard_multi');
  assert.equal(gangMask(p), 3);
  assert.equal(count(p, 'feud_camel_receipt'), 0);
  assert.equal(stage(p), 2, 'both distinct hand-ins reach the next named checkpoint');
}

function relog(p) {
  const saved = p.save(), slot = p.slot, uid = p.uid, pid = p.pid;
  p.unlink(); World.players[slot] = null;
  const loaded = PlayerLoading.load(p.username, new Packet(saved), null);
  loaded.varsString ??= [];
  loaded.slot = slot; loaded.uid = uid; loaded.pid = pid; loaded.isActive = true;
  loaded.messages = []; loaded.packets = [];
  loaded.write = packet => loaded.packets.push(packet);
  loaded.messageGame = text => loaded.messages.push(String(text));
  loaded.wrappedMessageGame = loaded.messageGame;
  World.players[slot] = loaded; World.playerLoop.add(loaded.hash64, loaded);
  return loaded;
}

test('the original market Trade option supplies both required disguise items before the quest', () => {
  const p = player();
  p.invAdd(inv, obj('coins'), 100);
  operate(p, actors('feud_marketseller')[0], 3);
  assert.equal(stage(p), 0, 'using an ordinary town shop does not start the quest');
  assert.equal(p.modalMain, id('Component', 'shop_template'));
  const expected = [
    ['pot_empty', 3, 100], ['jug_empty', 2, 100], ['water_skin3', 20, 10],
    ['desert_shirt', 3, 12], ['desert_boots', 2, 100], ['bucket_empty', 12, 400],
    ['feud_karidian_fakebeard', 11, 10], ['feud_karidian_turban', 12, 10],
    ['cheese', 5, 200], ['lime', 5, 200], ['orange', 5, 200], ['tomato', 5, 200],
    ['jug_water', 5, 10], ['bowl_water', 7, 10], ['bucket_water', 8, 10]
  ];
  const shop = id('InvType', 'pollnivneach_generalstore'), config = types.InvType.get(shop);
  assert.equal(config.scope, 2, 'the ordinary store has shared stock');
  assert.equal(config.allstock, true, 'the sourced normal-general-store change is retained');
  assert.equal(config.restock, true);
  assert.deepEqual(Array.from(config.stockobj), expected.map(([name]) => obj(name)), 'only the fifteen sourced non-pack rows are stocked');
  assert.deepEqual(Array.from(config.stockcount), expected.map(([, quantity]) => quantity));
  assert.deepEqual(Array.from(config.stockrate), expected.map(([, , rate]) => rate));
  for (const [name, value] of [['shop', shop], ['shop_sell', 1000], ['shop_buy', 550], ['shop_haggle', 10]]) {
    assert.equal(p.getVar(id('VarPlayerType', name)), value, `the candidate table's ${name} is used`);
  }
  const component = id('Component', 'shop_template:inv');
  const stock = p.getInventoryFromListener(p.invListeners.find(entry => entry.com === component));
  const option = types.Component.get(component).iop.findIndex(text => /buy[^\d]*1\b/i.test(text ?? '')) + 1;
  assert(option > 0, 'the visible shop offers Buy 1');
  for (const name of ['feud_karidian_fakebeard', 'feud_karidian_turban']) {
    const quantity = stock.getItemCount(obj(name)), money = count(p, 'coins');
    assert(invButton(p, 'shop_template:inv', name, option, stock.getItemIndex(obj(name))));
    assert.equal(count(p, name), 1, `${name} is bought through the real interface`);
    assert.equal(stock.getItemCount(obj(name)), quantity - 1);
    assert(count(p, 'coins') < money, 'the required item is not awarded for free');
  }
  p.closeModal();
  assert.match(talk(p, 'feud_marketseller', [2]).text, /No thanks\./);
  assert.notEqual(p.modalMain, id('Component', 'shop_template'), 'declining the existing Talk route leaves the shop closed');
  talk(p, 'feud_marketseller', [1]);
  assert.equal(p.modalMain, id('Component', 'shop_template'), 'Talk and Trade open the same real shop');
  const talkStock = p.getInventoryFromListener(p.invListeners.find(entry => entry.com === component));
  assert.equal(talkStock, stock, 'both visible options share one inventory');
  p.closeModal();
});

test('barman small-talk remains available without producing quest progress', () => {
  const p = player(), result = talk(p, 'feud_ali_the_barman', [2, 1]);
  assert.match(result.text, /Nothing much really\. About what you'd expect from a sleepy little town like ours\./);
  assert.match(result.text, /They're paying customers, so I won't rock the boat if you don't mind\./);
  assert.equal(stage(p), 0);
  assert.equal(read(p, 'feud_report_drink'), 0, 'ordinary small-talk cannot identify the traitor drink');
  assert.notEqual(p.modalMain, id('Component', 'shop_template'), 'the non-trading branch opens no shop');
});

test('start refusal, early item use, and compatible acceptance use native dispatch', () => {
  const p = seed(player(), ['beer']);
  talk(p, 'feud_ali_m', [2]);
  assert.equal(stage(p), 0);
  operate(p, actors('feud_drunken_ali')[0], 1, [], 'beer');
  assert.equal(count(p, 'beer'), 1, 'no beer is consumed before the quest starts');
  assert.equal(read(p, 'feud_var_drink'), 0);
  begin(p);
});

test('the first boundary is played from zero, saved, recruited and never reset', () => {
  let p = player(); begin(p); drink(p);
  p = relog(p);
  assert.equal(stage(p), 1, 'start stage survives the real save codec');
  assert.equal(read(p, 'feud_var_drink'), 3, 'three-beer progress survives the real save codec');
  talk(p, 'feud_egyptian_doorman_multi');
  talk(p, 'feud_arabian_guard_multi');
  assert.equal(read(p, 'feud_var_talk_gangs'), 3, 'both distinct gang inquiries are remembered');
  buyReceipts(p); deliver(p);
  p = relog(p);
  assert.equal(stage(p), 2);
  assert.equal(gangMask(p), 3, 'distinct receipt progress survives logout');
  const villager = actors('feud_villager_multi_1')[0];
  const coinsBefore = count(p, 'coins');
  operate(p, villager, 3);
  assert.equal(read(p, 'feud_talk_villager'), 0, 'the trial cannot start before Operator acceptance');
  assert.equal(count(p, 'coins'), coinsBefore, 'early pickpocket cannot award trial loot');
  talk(p, 'feud_egyptian_minder', [2, 2]);
  assert.equal(stage(p), 2, 'declining recruitment preserves the hand-ins');
  talk(p, 'feud_egyptian_minder', [1, 2]);
  assert.equal(stage(p), 3, 'accepting the sourced trial briefing records recruitment');
  talk(p, 'feud_ali_m');
  assert.equal(stage(p), 3, 'Morrisane never restarts an active quest');
  p = relog(p);
  assert.equal(stage(p), 3, 'recruitment survives the real save codec');
  talk(p, 'feud_egyptian_minder', [2, 2]);
  assert.equal(stage(p), 3, 'the repeat Operator path cannot reset recruitment');
});

test('a published stage-one save keeps its completed hand-ins and trial progress', () => {
  let p = player(); begin(p); drink(p);
  talk(p, 'feud_egyptian_doorman_multi');
  talk(p, 'feud_arabian_guard_multi');
  buyReceipts(p); deliver(p);
  // Legacy fixture: the published scripts kept stage 1 after both hand-ins.
  p.setVarBit(bit('feud_var'), 1);
  p = relog(p);
  talk(p, 'feud_egyptian_minder', [1, 2]);
  assert.equal(stage(p), 3, 'the old hand-in state can accept recruitment without buying again');
  assert.equal(gangMask(p), 3);
  assert.equal(count(p, 'feud_camel_receipt'), 0);
  // Legacy fixture: the published first pick also retained stage 1.
  p.setVarBit(bit('feud_var'), 1);
  p.setVarBit(bit('feud_talk_villager'), 1);
  p = relog(p);
  talk(p, 'feud_egyptian_minder', [2, 2]);
  assert.equal(stage(p), 3, 'existing trial progress proves prior recruitment');
  assert.equal(read(p, 'feud_talk_villager'), 1, 'migration does not repeat or discard the first pick');
});
