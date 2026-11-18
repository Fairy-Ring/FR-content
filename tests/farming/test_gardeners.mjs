/** Built-pack gardener payment, protection, persistence and dialogue contracts.
 * Run from sibling engine: node --import tsx ../content/tests/farming/test_gardeners.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, Runner, Scripts, State, ScriptOpcode, PlayerStat, PlayerTimerType,
  types, id, inv, player, proc, add, count, use, click, load } from './runtime.mjs';
const Trigger = (await load('engine/script/ServerTriggerType.ts')).default;
const map = await load('engine/GameMap.ts');
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const care = id('VarPlayerType', 'farming_protection');
assert.equal(care, 519, 'assigned original slot, not an appended varp');
assert.equal(types.VarPlayerType.get(care).transmit, false, 'care is server-only');
const careBits = types.VarBitType.configs.filter(row => row && row.basevar === care);
assert.equal(careBits.length, 0, 'no original or new client varbit reads care');
const all = [id('VarPlayerType', 'farming_allotment_varp_1'), id('VarPlayerType', 'farming_allotment_varp_2'), id('VarPlayerType', 'farming_hops_varp')];
const setStage = (p, patch, stage) => p.setVar(all[Math.floor(patch / 4)], (p.getVar(all[Math.floor(patch / 4)]) & ~(255 << ((patch % 4) * 8))) | (stage << ((patch % 4) * 8)));
const stage = (p, patch) => (p.getVar(all[Math.floor(patch / 4)]) >>> ((patch % 4) * 8)) & 255;
const watched = (p, patch) => (p.getVar(care) >>> patch) & 1;
const result = (p, name, ...args) => proc(p, name, ...args).intStack[0];
// Independent oracle: retained Tip.It 28 April 2006 Farmer charge tables.
const crops = [
  ['allotment_potato', 6, 10, 12, 'bucket_compost', 2],
  ['allotment_onion', 13, 17, 19, 'sack_potato_10', 1],
  ['allotment_cabbage', 20, 24, 26, 'sack_onion_10', 1],
  ['allotment_tomato', 27, 31, 33, 'sack_cabbage_10', 2],
  ['allotment_sweetcorn', 34, 40, 42, 'jute_fibre', 10],
  ['allotment_strawberry', 43, 49, 51, 'basket_apple_5', 1],
  ['allotment_watermelon', 52, 60, 62, 'curry_leaf', 10],
  ['hops_hammerstone', 4, 8, 10, 'marigold', 1],
  ['hops_asgarnian', 11, 16, 18, 'sack_onion_10', 1],
  ['hops_yanillian', 19, 25, 27, 'basket_tomato_5', 1],
  ['hops_krandorian', 28, 35, 37, 'sack_cabbage_10', 3],
  ['hops_wildblood', 38, 46, 48, 'nasturtium', 1],
  ['hops_barley', 49, 53, 55, 'bucket_compost', 3],
  ['hops_jute', 56, 61, 63, 'barley_malt', 6]
];
let checks = 0;
function test(name, action) { action(); checks++; console.log(`PASS ${name}`); }
// The same period table retains later-family fees without enabling their care.
const futurePayments = [
  ['bush_redberry', 'sack_cabbage_10', 4], ['bush_cadavaberry', 'basket_tomato_5', 3],
  ['bush_dwellberry', 'basket_strawberry_5', 3], ['bush_jangerberry', 'watermelon', 6],
  ['bush_whiteberry', 'bittercap_mushroom', 8], ['bush_poison_ivy', 'coconut', 15],
  ['wood_oak', 'basket_tomato_5', 1], ['wood_willow', 'basket_apple_5', 1],
  ['wood_maple', 'basket_orange_5', 1], ['wood_yew', 'cactus_spine', 10], ['wood_magic', 'coconut', 25],
  ['fruit_apple', 'sweetcorn', 9], ['fruit_banana', 'basket_apple_5', 4],
  ['fruit_orange', 'basket_strawberry_5', 3], ['fruit_curry', 'basket_banana_5', 5],
  ['fruit_pineapple', 'watermelon', 10], ['fruit_papaya', 'pineapple', 10], ['fruit_palm', 'papaya', 15]
];
test('all eighteen future-family fees are compiled data, not enabled crop costs', () => {
  const p = player();
  let table;
  for (const [name, payment, quantity] of futurePayments) {
    const rowId = id('DbRowType', `farming_protection_future_${name}`), row = types.DbRowType.get(rowId);
    table ??= row.tableId;
    assert.equal(row.tableId, table);
    assert.deepEqual(row.getValue(0, 0), [id('ObjType', payment)]);
    assert.deepEqual(row.getValue(1, 0), [quantity]);
    const unavailable = proc(p, 'farming_protection_cost', rowId);
    assert.deepEqual(unavailable.intStack.slice(0, unavailable.isp), [-1, 0]);
  }
  assert.equal(types.DbRowType.getInTable(table).length, futurePayments.length);
  p.unlink();
});
for (const [name, first, mature, last, payment, quantity] of crops) {
  const patch = name.startsWith('hops_') ? 8 : 0;
  test(`${name}: exact full-item cost and atomic missing/duplicate payment`, () => {
    const p = player();
    setStage(p, patch, first);
    const cost = proc(p, 'farming_protection_cost', id('DbRowType', `farming_${name}`));
    assert.deepEqual(cost.intStack.slice(0, cost.isp), [id('ObjType', payment), quantity]);
    if (quantity > 1) add(p, payment, quantity - 1);
    const before = count(p, payment);
    assert.equal(result(p, 'farming_protection_hire', patch), 0);
    assert.equal(count(p, payment), before);
    assert.equal(p.getVar(care), 0);
    add(p, payment, quantity - before);
    assert.equal(result(p, 'farming_protection_hire', patch), 1);
    assert.equal(count(p, payment), 0);
    assert.equal(p.getVar(care), 1 << patch);
    add(p, payment, quantity);
    assert.equal(result(p, 'farming_protection_hire', patch), 0);
    assert.equal(count(p, payment), quantity);
    p.unlink();
  });
  test(`${name}: notes and mixed payments buy exactly one planting`, () => {
    for (const plain of new Set([0, Math.min(1, quantity)])) {
      const p = player(); setStage(p, patch, first + 64);
      if (plain) add(p, payment, plain);
      if (quantity > plain) add(p, `cert_${payment}`, quantity - plain);
      assert.equal(result(p, 'farming_protection_hire', patch), 1);
      assert.equal(count(p, payment), 0); assert.equal(count(p, `cert_${payment}`), 0);
      assert.equal(watched(p, patch), 1);
      p.unlink();
    }
  });
  test(`${name}: seed/growth/watered eligibility, no empty/mature/dead hire`, () => {
    for (const value of [0, 3, mature, last, first + 129, first + 193]) {
      const p = player(); setStage(p, patch, value); add(p, payment, quantity);
      assert.equal(result(p, 'farming_protection_hire', patch), 0, `refuse ${value}`);
      assert.equal(count(p, payment), quantity); assert.equal(p.getVar(care), 0);
      p.unlink();
    }
  });
  test(`${name}: watched growth makes no disease roll, caps at maturity`, () => {
    const p = player();
    const original = Runner.HANDLERS[ScriptOpcode.RANDOM];
    Runner.HANDLERS[ScriptOpcode.RANDOM] = () => assert.fail('watched healthy crop must not roll disease');
    try {
      for (const value of [first, first + 1, first + 64, mature, last]) {
        setStage(p, patch, value); p.setVar(care, 1 << patch);
        proc(p, patch < 8 ? 'farming_potato_advance_all' : 'farming_hops_advance_all', 30);
        assert.equal(stage(p, patch), value >= mature && value < 64 ? value : mature);
        assert.equal(watched(p, patch), 1, 'maturity retains the current planting flag');
      }
    } finally { Runner.HANDLERS[ScriptOpcode.RANDOM] = original; p.unlink(); }
  });
}
const placements = { loc: new Map(), npc: new Map() };
for (const file of fs.readdirSync(path.join(content, 'maps')).filter(file => /^m\d+_\d+\.jm2$/.test(file))) {
  const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(file).map(Number);
  let section;
  for (const line of fs.readFileSync(path.join(content, 'maps', file), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    const row = /^([0-3]) (\d+) (\d+): (\d+)(?: |$)/.exec(line);
    if (!row || !['LOC', 'NPC'].includes(section)) continue;
    const [level, x, z, type] = row.slice(1).map(Number);
    const name = types[section === 'LOC' ? 'LocType' : 'NpcType'].get(type).debugname;
    if (!/^farming_(veg|hops|bush|tree|fruit_tree)_patch_[1-8]$/.test(name) &&
      !/^farming_gardener_/.test(name) && !['elstan', 'dantaera', 'kragen', 'lyra', 'francis'].includes(name) &&
      !/^farming_shopkeeper_[1-4]$/.test(name)) continue;
    const target = section === 'LOC' ? placements.loc : placements.npc;
    if (!target.has(name)) target.set(name, []);
    target.get(name).push({ type, level, x: mx * 64 + x, z: mz * 64 + z, file });
  }
}
test('map determines four reserved patches per later family, each beside its gardener', () => {
  for (const family of ['bush', 'tree', 'fruit_tree']) {
    const rows = [...placements.loc.keys()].filter(name => name.startsWith(`farming_${family}_patch_`));
    assert.equal(rows.length, 4);
    for (const name of rows) {
      const number = name.split('_').at(-1);
      const gardener = `farming_gardener_${family === 'fruit_tree' ? 'fruit' : family}_${number}`;
      assert.equal(placements.loc.get(name).length, 1);
      assert.equal(placements.npc.get(gardener).length, 1);
      const patch = placements.loc.get(name)[0], actor = placements.npc.get(gardener)[0];
      assert.equal(patch.level, actor.level);
      assert(Math.max(Math.abs(patch.x - actor.x), Math.abs(patch.z - actor.z)) <= 3);
    }
  }
});
function patchLoc(patch) {
  const name = patch < 8 ? `farming_veg_patch_${patch + 1}` : `farming_hops_patch_${patch - 7}`;
  const at = placements.loc.get(name)[0];
  return World.getLoc(at.x, at.z, at.level, at.type);
}
function approach(p, loc) {
  const config = types.LocType.get(loc.type);
  for (let x = loc.x - 1; x <= loc.x + config.width; x++) for (let z = loc.z - 1; z <= loc.z + config.length; z++) {
    if (!map.isMapBlocked(x, z, loc.level) && map.reachedLoc(loc.level, x, z, loc.x, loc.z,
      config.width, config.length, 1, loc.angle, loc.shape, config.forceapproach)) {
      p.x = x; p.z = z; p.level = loc.level; return;
    }
  }
  assert.fail('original patch has no packed-collision interaction tile');
}
for (let patch = 0; patch < 12; patch++) {
  test(`patch ${patch}: native harvest/clear removes only its own flag`, () => {
    const p = player(); p.setLevel(PlayerStat.FARMING, 99); add(p, 'spade');
    const loc = patchLoc(patch); assert(loc); approach(p, loc);
    const first = patch < 8 ? 6 : 4, last = patch < 8 ? 12 : 10;
    setStage(p, patch, last); p.setVar(care, 0x7fffffff);
    const original = Runner.HANDLERS[ScriptOpcode.RANDOM];
    Runner.HANDLERS[ScriptOpcode.RANDOM] = state => { state.popInt(); state.pushInt(0); };
    try { assert(click(p, loc)); } finally { Runner.HANDLERS[ScriptOpcode.RANDOM] = original; }
    assert.equal(stage(p, patch), 3);
    assert.equal(p.getVar(care), 0x7fffffff & ~(1 << patch));
    assert.equal(count(p, patch < 8 ? 'potato' : 'hammerstone_hops'), 1);
    setStage(p, patch, first + 193); p.setVar(care, 0x7fffffff);
    assert(use(p, 'spade', loc));
    assert.equal(stage(p, patch), 3); assert.equal(watched(p, patch), 0);
    p.unlink();
  });
}
test('saved flags survive serialization and retain other families/reserved bits', () => {
  const p = player(); p.setVar(care, 0x7fffffff); setStage(p, 0, 7); setStage(p, 8, 5);
  const q = player(p.save());
  assert.equal(q.getVar(care), 0x7fffffff); assert.equal(stage(q, 0), 7); assert.equal(stage(q, 8), 5);
  p.unlink(); q.unlink();
});
test('all twelve paid plantings survive save/load and the real online/offline scheduler', () => {
  const date = Runner.HANDLERS[ScriptOpcode.DATE_MINUTES];
  const random = Runner.HANDLERS[ScriptOpcode.RANDOM];
  let minute = 605;
  Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(minute);
  Runner.HANDLERS[ScriptOpcode.RANDOM] = () => assert.fail('paid healthy timer transition must not roll disease');
  const p = player();
  let q;
  try {
    add(p, 'bucket_compost', 16); add(p, 'marigold', 4);
    for (let patch = 0; patch < 12; patch++) {
      setStage(p, patch, patch < 8 ? 6 : 4);
      assert.equal(result(p, 'farming_protection_hire', patch), 1);
    }
    assert.equal(p.getVar(care), 0xfff);
    proc(p, 'farming_login');
    const timer = Scripts.getByName('[timer,farming_growth]');
    assert.equal(p.timers.get(timer.id).interval, 500);
    minute = 610; World.currentTick += 500;
    p.processTimers(PlayerTimerType.NORMAL);
    for (let patch = 0; patch < 12; patch++) assert.equal(stage(p, patch), patch < 8 ? 7 : 5);
    q = player(p.save());
    assert.equal(q.getVar(care), 0xfff);
    minute = 625;
    proc(q, 'farming_login');
    for (let patch = 0; patch < 12; patch++) assert.equal(stage(q, patch), patch < 8 ? 8 : 6);
    proc(q, 'farming_reconcile', 1);
    for (let patch = 0; patch < 12; patch++) assert.equal(stage(q, patch), patch < 8 ? 8 : 6);
    minute = 660;
    proc(q, 'farming_reconcile', 1);
    for (let patch = 0; patch < 12; patch++) {
      assert.equal(stage(q, patch), patch < 8 ? 10 : 8);
      assert.equal(watched(q, patch), 1);
    }
  } finally {
    Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = date;
    Runner.HANDLERS[ScriptOpcode.RANDOM] = random;
    p.unlink(); q?.unlink();
  }
});

const component = name => id('Component', name);
const normalize = text => text.replace(/[|\s]+/g, ' ').trim();
function talk(p, name, choices, textPackets) {
  const at = placements.npc.get(name)?.[0];
  assert(at, `original map places ${name}`);
  const npc = [...World.npcs].find(npc => npc.type === at.type && npc.level === at.level && npc.x === at.x && npc.z === at.z);
  assert(npc, `full engine map loads ${name}`);
  const config = types.NpcType.get(npc.type);
  const script = Scripts.getByTrigger(Trigger.OPNPC1, config.id, config.category);
  assert(script, `visible ${name} has native Talk-to dispatch`);
  const packets = [];
  p.write = packet => packets.push(packet);
  const state = Runner.init(script, p, npc);
  p.executeScript(state, true, true);
  for (let step = 0; state.execution !== State.FINISHED && step < 500; step++) {
    if (state.execution === State.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
    } else {
      assert.equal(state.execution, State.PAUSEBUTTON, `${script.name} does not abort`);
      const root = p.modalChat >= 0 ? types.Component.get(p.modalChat)?.comName ?? '' : '';
      if (/^multi[2-5]$/.test(root)) {
        assert(choices.length, `${script.name} requires an expected ${root} choice`);
        p.lastCom = component(`${root}:com_${choices.shift()}`);
        assert(p.resumeButtons.includes(p.lastCom), `${root} visibly offers the choice`);
      }
    }
    p.executeScript(state, true, true);
  }
  assert.equal(state.execution, State.FINISHED, `${script.name} finishes in 500 steps`);
  assert.equal(choices.length, 0, `${script.name} consumed every expected choice`);
  const texts = packets.filter(packet => packet.constructor.name === 'IfSetText');
  if (textPackets) textPackets.push(...texts);
  return normalize(texts.map(packet => packet.text).join(' '));
}
for (let number = 1; number <= 4; number++) {
  const name = `farming_shopkeeper_${number}`;
  test(`${name}: Talk-to opens the actor's shop, not another shop`, () => {
    const p = player();
    assert(talk(p, name, [1]).includes('Hello. How can I help you?'));
    assert.equal(p.modalMain, component('shop_template'));
    assert.equal(p.getVar(id('VarPlayerType', 'shop')), id('InvType', `farming_shop_${number}`));
    const actor = types.NpcType.getByName(name);
    const trade = Scripts.getByTrigger(Trigger.OPNPC3, actor.id, actor.category);
    assert.equal(trade.name, '[opnpc3,_shop_keeper]', 'existing category Trade remains selected');
    p.unlink();
  });
  test(`${name}: sourced advice and farewell are reachable`, () => {
    const p = player();
    const text = talk(p, name, number === 1 ? [2, 4] : [2]);
    assert(text.includes('Can you give me any Farming advice?'));
    assert(text.includes('Yes - ask a gardener.'));
    if (number === 1) assert(text.includes("I'm okay, thank you."));
    else assert(talk(p, name, [3]).includes("I'm okay, thank you."));
    p.unlink();
  });
}
for (const [choice, expected] of [
  [1, "Well, the best sacks are made with jute fibres; you can grow jute yourself in a hops patch. I'd say about 4 jute fibres should be enough to weave a sack."],
  [2, "You can cut the branches with a standard pair of secateurs. You will probably need about 6 willow branches to weave a complete basket."],
  [3, "Thank you, that's very kind."]
]) test(`Sarah: sourced loom branch ${choice}`, () => {
  const p = player(), text = talk(p, 'farming_shopkeeper_1', [3, choice]);
  assert(text.includes("Well, it's actually my loom, but I don't mind you using it, if you like. You can use it to weave sacks and baskets in which you can put vegetables and fruit."));
  assert(text.includes(expected)); p.unlink();
});
const advice = [
  'The only way to cure a bush or tree of disease is to prune away the diseased leaves with a pair of secateurs. For all other crops I would just apply some plant-cure.',
  'Tree seeds must be grown in a plantpot of soil into a sapling, and then transferred to a tree patch to continue growing to adulthood.',
  "You can put up to ten potatoes, cabbages or onions in vegetable sacks, although you can't have a mix in the same sack.",
  'You can buy all the farming tools from farming shops, which can be found close to the allotments.',
  'Bittercap mushrooms can only be grown in a special patch in Morytania, near the Mort Myre swamp. There the ground is especially dank and suited to growing poisonous fungii.',
  'Supercompost is far better than normal compost, but more expensive to make.',
  "There is a special patch for growing Belladonna - I believe that it is somewhere near Draynor Manor, where the ground is a tad 'unblessed'.",
  'Applying compost to a patch will not only reduce the chance that your crops will get diseased, but you will also grow more crops to harvest.',
  'You can fill plantpots with soil from any empty patch, if you have a gardening trowel.',
  "Hops are good for brewing ales. I believe there's a brewery up in Keldagrim somewhere, and I've heard rumours that a place called Phasmatys used to be good for that type of thing. 'Fore they all died, of course.",
  'Vegetables, hops and flowers need constant watering - if you ignore my advice, you will sooner or later find yourself in possession of a dead farming patch.',
  "You can put up to five tomatoes, strawberries, apples, bananas or oranges into a fruit basket, although you can't have a mix in the same basket.",
  "Don't just throw away your weeds after you've raked a patch - put them in a compost bin and make some compost.",
  "If you want to make your own sacks and baskets you'll need to use the loom that's near the Farming shop in Falador. If you're a good enough craftsman, that is.",
  "You don't have to buy all your plantpots you know, you can make them yourself on a pottery wheel. If you're a good enough craftsman, that is."
];
function adviceTalk(p, name, index) {
  const old = [Runner.HANDLERS[ScriptOpcode.RANDOM], Runner.HANDLERS[ScriptOpcode.RANDOMINC]];
  const choose = state => {
    const bound = state.popInt();
    assert([14, 15].includes(bound), 'advice makes its one documented fifteen-way choice');
    state.pushInt(index);
  };
  Runner.HANDLERS[ScriptOpcode.RANDOM] = choose; Runner.HANDLERS[ScriptOpcode.RANDOMINC] = choose;
  try { return talk(p, name, [4]); }
  finally { [Runner.HANDLERS[ScriptOpcode.RANDOM], Runner.HANDLERS[ScriptOpcode.RANDOMINC]] = old; }
}
const gardeners = [...placements.npc.keys()].filter(name => !name.startsWith('farming_shopkeeper_'));
assert.equal(gardeners.length, 20, 'all twenty original mapped gardeners are exercised');
const fairy = id('VarBitType', 'fairy_farmers_quest'), visited = id('VarPlayerType', 'fairy_gardeners_visited');
const garden = id('VarBitType', 'garden_quest');
for (const name of gardeners) test(`${name}: ordinary advice and preserved GAG/exit dispatch`, () => {
  const p = player(); p.setVarBit(fairy, 1); p.setVarBit(garden, 1);
  assert(adviceTalk(p, name, 0).includes(advice[0]));
  assert.equal(p.getVarBit(fairy), 1); assert.equal(p.getVarBit(garden), 1); assert.equal(p.getVar(visited), 0);
  assert(talk(p, name, [2]).includes("I'll come back another time."));
  assert.equal(p.getVarBit(fairy), 1); assert.equal(p.getVarBit(garden), 1);
  p.setVarBit(garden, 0);
  assert(talk(p, name, [1]).includes("Martin has asked me to investigate why all the crops are failing."));
  assert.equal(p.getVarBit(fairy), 2, 'published first GAG theory still advances');
  assert.notEqual(p.getVar(visited), 0, 'published per-player gardener mask still records this actor');
  p.unlink();
});
for (let index = 0; index < advice.length; index++) test(`sourced random advice ${index + 1}`, () => {
  const p = player(); assert(adviceTalk(p, 'elstan', index).includes(advice[index])); p.unlink();
});
// Independent caption oracle: each original plot pair and its retained transcript.
const allotmentCaptions = new Map([
  ['elstan', ['The north-western allotment.', 'The south-eastern allotment.']],
  ['dantaera', ['The northern allotment.', 'The southern allotment.']],
  ['kragen', ['The northern allotment.', 'The southern allotment.']],
  ['lyra', ['The north-western allotment.', 'The south-eastern allotment.']]
]);
const owners = [['elstan', 0], ['dantaera', 2], ['kragen', 4], ['lyra', 6],
  ['farming_gardener_hops_1', 8], ['francis', 9], ['farming_gardener_hops_3', 10], ['farming_gardener_hops_4', 11]];
for (const [name, base] of owners.filter(([, base]) => base < 8)) test(`${name}: caption directions match both original map plots`, () => {
  const north = placements.loc.get(`farming_veg_patch_${base + 1}`);
  const south = placements.loc.get(`farming_veg_patch_${base + 2}`);
  const range = (plots, axis) => [Math.min(...plots.map(plot => plot[axis])), Math.max(...plots.map(plot => plot[axis]))];
  const [northX, southX, northZ, southZ] = [range(north, 'x'), range(south, 'x'), range(north, 'z'), range(south, 'z')];
  assert(northZ[0] + northZ[1] > southZ[0] + southZ[1], 'option 1 is north of option 2');
  if (['elstan', 'lyra'].includes(name)) assert(northX[1] < southX[0], 'option 1 is west of option 2');
  else assert.deepEqual(northX, southX, 'the north/south plots share their east/west extent');
});
for (const [name, base] of owners) for (let offset = 0; offset < (base < 8 ? 2 : 1); offset++) {
  const patch = base + offset, choices = base < 8 ? [3, offset + 1] : [3];
  test(`${name}: native menu buys only mapped patch ${patch}`, () => {
    const p = player(); p.setVarBit(fairy, 1); p.setVarBit(garden, 1);
    setStage(p, patch, patch < 8 ? 6 : 4);
    const payment = patch < 8 ? 'bucket_compost' : 'marigold', quantity = patch < 8 ? 2 : 1;
    add(p, payment, quantity);
    const textPackets = [], text = talk(p, name, [...choices, 1], textPackets);
    assert(text.includes("Leave it with me - I'll make sure that patch grows for you."));
    if (base < 8) {
      const captions = allotmentCaptions.get(name);
      const menu = [component('multi2:com_1'), component('multi2:com_2')];
      for (let option = 0; option < 2; option++) {
        assert(textPackets.some(packet => packet.component === menu[option] && normalize(packet.text) === captions[option]),
          `${name} visibly names mapped plot ${base + option}`);
      }
      const echoes = textPackets.filter(packet => !menu.includes(packet.component)).map(packet => normalize(packet.text));
      assert(echoes.includes(captions[offset]), 'player echoes the selected plot');
      assert(!echoes.includes(captions[1 - offset]), 'player does not echo the other plot');
    }
    assert.equal(count(p, payment), 0); assert.equal(p.getVar(care), 1 << patch);
    assert.equal(p.getVarBit(fairy), 1); assert.equal(p.getVarBit(garden), 1); assert.equal(p.getVar(visited), 0);
    for (let other = 0; other < 12; other++) assert.equal(stage(p, other), other === patch ? (patch < 8 ? 6 : 4) : 0);
    add(p, payment, quantity);
    assert(talk(p, name, [...choices]).includes("I'm already looking after that patch for you."));
    assert.equal(count(p, payment), quantity); assert.equal(p.getVar(care), 1 << patch);
    p.unlink();
  });
  test(`${name}: decline and crop-state refusals consume nothing for patch ${patch}`, () => {
    const p = player(), first = patch < 8 ? 6 : 4;
    const payment = patch < 8 ? 'bucket_compost' : 'marigold', quantity = patch < 8 ? 2 : 1;
    add(p, payment, quantity); setStage(p, patch, first);
    assert(talk(p, name, [...choices, 2]).includes("Well, I'm not wasting my time for free."));
    for (const [value, expected] of [[0, "You don't have any seeds planted in that patch."],
      [patch < 8 ? 10 : 8, 'That patch is already fully grown!'],
      [first + 129, 'That patch is diseased - you should cure it'],
      [first + 193, "That patch is dead - it's too late"]]) {
      setStage(p, patch, value); assert(talk(p, name, [...choices]).includes(expected));
      assert.equal(count(p, payment), quantity); assert.equal(p.getVar(care), 0);
    }
    p.unlink();
  });
}
for (const name of gardeners.filter(name => !owners.some(([owner]) => owner === name))) {
  test(`${name}: unbuilt crop family has no care service or charge`, () => {
    const p = player(); add(p, 'bucket_compost', 2);
    assert(talk(p, name, [3]).includes("You don't have any seeds planted in that patch."));
    assert.equal(p.getVar(care), 0); assert.equal(count(p, 'bucket_compost'), 2); p.unlink();
  });
}
// Kragen's concrete allotment invoices retain "one"; the shared invoice template
// expands the same singular form and the period fee table for the seven hops.
const invoices = new Map([
  ['allotment_potato', 'If you like, but I want 2 buckets of compost for that.'],
  ['allotment_onion', 'If you like, but I want one sack of potatoes for that.'],
  ['allotment_cabbage', 'If you like, but I want one sack of onions for that.'],
  ['allotment_tomato', 'If you like, but I want 2 sacks of cabbages for that.'],
  ['allotment_sweetcorn', 'If you like, but I want 10 jute fibres for that.'],
  ['allotment_strawberry', 'If you like, but I want one basket of apples for that.'],
  ['allotment_watermelon', 'If you like, but I want 10 curry leaves for that.'],
  ['hops_hammerstone', 'If you like, but I want one marigold for that.'],
  ['hops_asgarnian', 'If you like, but I want one sack of onions for that.'],
  ['hops_yanillian', 'If you like, but I want one basket of tomatoes for that.'],
  ['hops_krandorian', 'If you like, but I want 3 sacks of cabbages for that.'],
  ['hops_wildblood', 'If you like, but I want one nasturtium for that.'],
  ['hops_barley', 'If you like, but I want 3 buckets of compost for that.'],
  ['hops_jute', 'If you like, but I want 6 barley malt for that.']
]);
for (const [name, first, , , payment, quantity] of crops) test(`${name}: compiled invoice, missing and partial payment wording`, () => {
  const hops = name.startsWith('hops_'), p = player(), choices = hops ? [3] : [3, 1];
  const actor = hops ? 'farming_gardener_hops_1' : 'elstan';
  setStage(p, hops ? 8 : 0, first);
  let text = talk(p, actor, [...choices]);
  assert(text.includes(invoices.get(name)));
  assert(text.includes("I'm afraid I don't have any of those at the moment."));
  if (quantity > 1) {
    add(p, payment, quantity - 1); text = talk(p, actor, [...choices]);
    assert(text.includes("I'm afraid I don't have enough of those at the moment."));
    assert.equal(count(p, payment), quantity - 1);
  }
  assert.equal(p.getVar(care), 0); p.unlink();
});
// Six-item/page oracle: retained Dantaera RS3 2021 layout, Old School quote wording.
const sales = [
  ['plant_cure', 25, [1], 'Some plant cure.', "Plant cure, eh? I might have some put aside for myself. Tell you what, I'll sell you some plant cure for 25 coins if you like."],
  ['bucket_compost', 35, [2], 'A bucket of compost.', "A bucket of compost, eh? I might have one spare... tell you what, I'll sell it to you for 35 coins if you like."],
  ['rake', 15, [3], 'A rake.', "A rake, eh? I might have one spare... tell you what, I'll sell it to you for 15 coins if you like."],
  ['watering_can_0', 25, [4, 1], 'A watering can.', "A watering can, eh? I might have one spare... tell you what, I'll sell it to you for 25 coins if you like."],
  ['gardening_trowel', 15, [4, 2], 'A gardening trowel.', "A gardening trowel, eh? I might have one spare... tell you what, I'll sell it to you for 15 coins if you like."],
  ['dibber', 15, [4, 3], 'A seed dibber.', "A seed dibber, eh? I might have one spare... tell you what, I'll sell it to you for 15 coins if you like."]
];
const yesSale = 'Yes, that sounds like a fair price.', noSale = 'No thanks, I can get that much cheaper elsewhere.';
test('native sale pages retain six-item order and never offer the later plant pot', () => {
  const p = player(), packets = [];
  talk(p, 'kragen', [5, 4, 5], packets);
  const options = (root, length) => Array.from({ length }, (_, index) =>
    packets.filter(packet => packet.component === id('Component', `${root}:com_${index + 1}`)).at(-1)?.text);
  assert.deepEqual(options('multi4', 4), ['Some plant cure.', 'A bucket of compost.', 'A rake.', '(See more items)']);
  assert.deepEqual(options('multi5', 5), ['A watering can.', 'A gardening trowel.', 'A seed dibber.', '(See previous items)', 'Forget it.']);
  assert(!packets.some(packet => packet.text === 'A plant pot.'));
  assert.equal(count(p, 'plantpot_empty'), 0); p.unlink();
});
for (const [item, price, route, request, offer] of sales) {
  test(`${item}: native dialogue buys one plain item for exactly ${price} coins`, () => {
    const p = player(); add(p, 'coins', price);
    const text = talk(p, 'kragen', [5, ...route, 1]);
    assert(text.includes("That depends on whether I have it to sell. What is it that you're looking for?"));
    assert(text.includes(request)); assert(text.includes(offer)); assert(text.includes(yesSale));
    assert(text.includes('Kragen hands over your purchase.'));
    assert.equal(count(p, 'coins'), 0); assert.equal(count(p, item), 1);
    assert.equal(count(p, `cert_${item}`), 0);
    for (const [other] of sales) if (other !== item) assert.equal(count(p, other), 0);
    assert.equal(p.getVar(care), 0); p.unlink();
  });
  test(`${item}: insufficient funds, decline and full inventory preserve the exchange`, () => {
    for (const money of [0, price - 1]) {
      const p = player(); if (money) add(p, 'coins', money);
      const text = talk(p, 'kragen', [5, ...route]);
      assert(text.includes(offer)); assert(text.includes("I don't have enough money for that, I'm afraid."));
      assert(!text.includes('Kragen hands over your purchase.'));
      assert.equal(count(p, 'coins'), money); assert.equal(count(p, item), 0); p.unlink();
    }
    const p = player(); add(p, 'coins', price);
    const declined = talk(p, 'kragen', [5, ...route, 2]);
    assert(declined.includes(noSale)); assert.equal(count(p, 'coins'), price); assert.equal(count(p, item), 0); p.unlink();
    const full = player(); add(full, 'coins', price + 1); add(full, 'rake', 27);
    const before = count(full, item), refused = talk(full, 'kragen', [5, ...route]);
    assert(refused.includes("Actually, I don't think I'd be able to carry it."));
    assert.equal(count(full, 'coins'), price + 1); assert.equal(count(full, item), before); full.unlink();
  });
}
for (const name of gardeners) test(`${name}: native sell option preserves quest and care state`, () => {
  const p = player(); p.setVarBit(fairy, 1); p.setVarBit(garden, 1); p.setVar(care, 0x555);
  add(p, 'coins', 50);
  const actor = types.NpcType.getByName(name);
  for (let purchase = 1; purchase <= 2; purchase++) {
    assert(talk(p, name, [5, 1, 1]).includes(`${actor.name} hands over your purchase.`));
    assert.equal(count(p, 'coins'), 50 - 25 * purchase); assert.equal(count(p, 'plant_cure'), purchase);
  }
  assert.equal(p.getVarBit(fairy), 1); assert.equal(p.getVarBit(garden), 1);
  assert.equal(p.getVar(visited), 0); assert.equal(p.getVar(care), 0x555); p.unlink();
});
test('native sale previous-items and forget branches do not make a purchase', () => {
  const p = player(); add(p, 'coins', 25);
  const text = talk(p, 'kragen', [5, 4, 4, 4, 5]);
  assert(text.includes("Forget it, you don't have anything I need."));
  assert.equal(count(p, 'coins'), 25); assert.equal(count(p, 'plant_cure'), 0); p.unlink();
});
test('native sale previous-items branch returns to the original purchase menu', () => {
  const p = player(); add(p, 'coins', 25);
  assert(talk(p, 'kragen', [5, 4, 4, 1, 1]).includes('Kragen hands over your purchase.'));
  assert.equal(count(p, 'coins'), 0); assert.equal(count(p, 'plant_cure'), 1); p.unlink();
});
console.log(`${checks} gardener compiled checks passed`);
process.exit(0);
