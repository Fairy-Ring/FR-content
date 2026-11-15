#!/usr/bin/env node
import assert from 'node:assert/strict';
import { World, PlayerLoading, Packet, PlayerStat, ScriptState, ScriptProvider, types, id, obj, inv, player, seed, inventory, count, slotOf, use, held, execute, button, inputCount, invButton, useLoc, weakCount, tick, settle } from './runtime.mjs';

const cave = id('VarPlayerType', 'goblin_caves');
const learned = id('VarBitType', 'know_how_to_make_lanterns');
const oil = id('VarBitType', 'lamp_oil_still_state');
const crafting = PlayerStat.CRAFTING;
const smithing = PlayerStat.SMITHING;
const firemaking = PlayerStat.FIREMAKING;
const glass = [
  ['beer_glass', 21, 1, 175, false],
  ['vial_empty', 13, 33, 350, false],
  ['stafforb', 17, 46, 525, false],
  ['fishbowl_empty', 37, 42, 625, false],
  ['candle_lantern_empty', 25, 4, 195, true],
  ['oil_lamp_empty', 29, 12, 250, true],
  ['bullseye_lantern_lens', 33, 49, 550, true]
];
const assemblies = [
  ['unlit_candle', 'candle_lantern_empty', 'candle_lantern_unlit', 1, 1],
  ['unlit_black_candle', 'candle_lantern_empty', 'candle_lantern_black_unlit', 1, 1],
  ['lit_candle', 'candle_lantern_empty', 'candle_lantern_lit', 1, 4],
  ['lit_black_candle', 'candle_lantern_empty', 'candle_lantern_black_lit', 1, 4],
  ['oil_lamp_empty', 'oil_lantern_frame', 'oil_lantern_empty', 26, 1],
  ['oil_lamp_unlit', 'oil_lantern_frame', 'oil_lantern_unlit', 26, 1],
  ['bullseye_lantern_lens', 'bullseye_lantern_nolens', 'bullseye_lantern_empty', 49, 1]
];
const containers = [
  ['oil_lamp_empty', 'oil_lamp_unlit', 'oil_lamp_lit', 2],
  ['oil_lantern_empty', 'oil_lantern_unlit', 'oil_lantern_lit', 2],
  ['bullseye_lantern_empty', 'bullseye_lantern_unlit', 'bullseye_lantern_lit', 2],
  ['tog_sapphire_lantern_empty', 'tog_sapphire_lantern_unlit', 'tog_sapphire_lantern_lit', 1]
];
let cases = 0;
let failures = 0;
function test(name, action) {
  cases++;
  try { action(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack ?? error}`); }
}
function fixture(names = [], { knowledge = 1, craft = 99, smith = 99, fm = 99 } = {}) {
  const p = seed(player(fm), names);
  // Keep XP and levels consistent: production stat_advance derives the level from XP.
  p.setLevel(crafting, craft); p.setLevel(smithing, smith); p.setLevel(firemaking, fm);
  p.setVar(cave, 0x5c5d); p.setVarBit(learned, knowledge); p.setVarBit(oil, 0);
  return p;
}
function snapshot(p) { return { items: inventory(p), vars: [...p.vars], xp: [...p.stats], tick: World.currentTick }; }
function conserved(p, before) {
  assert.deepEqual(inventory(p), before.items, 'all inventory slots conserved');
  assert.deepEqual([...p.vars], before.vars, 'all state conserved');
  assert.deepEqual([...p.stats], before.xp, 'all XP conserved');
}
function immediate(p, before, vars = before.vars) {
  assert.deepEqual([...p.stats], before.xp, 'no extra XP in any skill');
  assert.deepEqual([...p.vars], vars, 'no other state or quest writes');
  assert.equal(World.currentTick, before.tick, 'immediate settlement');
  assert.equal(p.activeScript, null); assert.equal(weakCount(p), 0);
  assert.deepEqual(p.messages, [], 'no invented assembly/fill/conversion sentence');
}
function fullBag(p) { while (p.invFreeSpace(inv)) p.invAdd(inv, obj('knife'), 1); }
function chooseGlass(p, base, quantity) {
  assert(use(p, 'glassblowingpipe', 'molten_glass'));
  assert.equal(p.modalMain, id('Component', 'glass_crafting'), 'only original seven-product chooser');
  const offset = { 1: 0, 5: 1, 10: 2, X: 3 }[quantity];
  assert(button(p, `glass_crafting:com_${base - offset}`));
  if (quantity === 'X') assert(inputCount(p, 7));
}
function natural(name, x, z) {
  const loc = World.getLoc(x, z, 0, id('LocType', name));
  assert(loc, `natural ${name} at ${x},${z}`);
  return loc;
}
const anvil = natural('anvil', 3188, 3421);
const still = natural('lamp_oil_still', 2937, 3210);
const regicide = natural('regicide_fractionalizing_still', 2927, 3212);
function stand(p, loc) { p.x = loc.x - 1; p.z = loc.z; p.level = loc.level; }
function atStill(p, name, clientType = still.type) {
  p.x = still.x; p.z = still.z - 1; p.level = still.level;
  assert(useLoc(p, name, still, clientType));
}
function openSmithing(p, bar) {
  stand(p, anvil); assert(useLoc(p, bar, anvil));
  assert.equal(p.modalMain, id('Component', 'smithing'));
}
function reload(p) {
  const bytes = p.save(); assert(PlayerLoading.verify(new Packet(bytes)));
  const q = PlayerLoading.load(p.username, new Packet(bytes), null);
  q.pid = p.pid; q.slot = p.slot; q.uid = ((Number(q.username37 & 0x1fffffn) << 11) | q.slot) >>> 0; q.isActive = true;
  q.messages = []; q.packets = [];
  q.write = packet => q.packets.push(packet);
  q.messageGame = message => q.messages.push(String(message)); q.wrappedMessageGame = q.messageGame;
  World.players[q.pid] = q;
  return q;
}

for (const [product, base, level, xp, lantern] of glass) {
  for (const quantity of [1, 5, 10, 'X']) test(`${product}: original Make ${quantity} packet, quantities and ${xp / 10} XP`, () => {
    const p = fixture(['glassblowingpipe', ...Array(12).fill('molten_glass')], { craft: level, knowledge: lantern ? 1 : 0 });
    const before = p.stats[crafting]; const amount = quantity === 'X' ? 7 : quantity;
    chooseGlass(p, base, quantity); settle(p);
    assert.equal(count(p, product), amount); assert.equal(count(p, 'molten_glass'), 12 - amount);
    assert.equal(count(p, 'glassblowingpipe'), 1); assert.equal(p.stats[crafting] - before, amount * xp);
    assert.equal(p.messages.length, amount); assert(p.messages.every(message => message.startsWith('You make ')));
  });
  if (level > 1) test(`${product}: level ${level - 1} refuses without material or XP loss`, () => {
    const p = fixture(['glassblowingpipe', 'molten_glass'], { craft: level - 1 });
    const before = snapshot(p); chooseGlass(p, base, 1); settle(p);
    assert.deepEqual(inventory(p), before.items); assert.deepEqual([...p.stats], before.xp);
    assert(p.messages.some(message => message.startsWith('You need level ')));
  });
  test(`${product}: full bag replaces glass, supply exhaustion and repeated click conserve quantity`, () => {
    const p = fixture(['glassblowingpipe', 'molten_glass']); fullBag(p);
    const before = p.stats[crafting]; chooseGlass(p, base, 10);
    assert.equal(button(p, `glass_crafting:com_${base - 2}`), false, 'closed chooser rejects duplicate packet');
    settle(p); assert.equal(count(p, product), 1); assert.equal(count(p, 'molten_glass'), 0);
    assert.equal(p.invFreeSpace(inv), 0); assert.equal(p.stats[crafting] - before, xp);
    assert(p.messages.includes('You have run out of molten glass.'));
  });
  test(`${product}: Make X zero and cancel consume nothing`, () => {
    for (const cancel of [false, true]) {
      const p = fixture(['glassblowingpipe', 'molten_glass']); const before = snapshot(p);
      assert(use(p, 'glassblowingpipe', 'molten_glass'));
      assert(button(p, `glass_crafting:com_${base - 3}`));
      assert.equal(p.activeScript?.execution, ScriptState.COUNTDIALOG);
      if (cancel) p.closeModal(); else assert(inputCount(p, 0));
      settle(p); conserved(p, before);
    }
  });
  test(`${product}: processing rechecks pipe, glass and level`, () => {
    for (const removed of ['glassblowingpipe', 'molten_glass', 'level']) {
      if (removed === 'level' && level === 1) continue;
      const p = fixture(['glassblowingpipe', 'molten_glass']); chooseGlass(p, base, 5);
      if (removed === 'level') p.setLevel(crafting, level - 1); else p.invDel(inv, obj(removed), 1);
      const before = snapshot(p); settle(p);
      assert.deepEqual(inventory(p), before.items); assert.deepEqual([...p.stats], before.xp);
    }
  });
  if (lantern) test(`${product}: lesson gates entry and continuation, without gating unrelated glass`, () => {
    const p = fixture(['glassblowingpipe', 'molten_glass'], { knowledge: 0 });
    const before = snapshot(p); chooseGlass(p, base, 1); settle(p); conserved(p, before);
    assert.deepEqual(p.messages, []);
    p.setVarBit(learned, 1); chooseGlass(p, base, 1); p.setVarBit(learned, 0);
    const queued = snapshot(p); settle(p); conserved(p, queued);
    p.setVarBit(learned, 1); chooseGlass(p, base, 1); settle(p); assert.equal(count(p, product), 1);
  });
}

test('old skillmulti3 glass route is removed, not retained as a second chooser', () => {
  const p = fixture(['glassblowingpipe', 'molten_glass']); assert(use(p, 'glassblowingpipe', 'molten_glass'));
  const before = snapshot(p); assert.equal(button(p, 'skillmulti3:com_8'), false); conserved(p, before);
});

for (const [bar, product, level, xp, component] of [
  ['iron_bar', 'oil_lantern_frame', 26, 250, 'smithing:com_147'],
  ['steel_bar', 'bullseye_lantern_nolens', 49, 375, 'smithing:com_147'],
  ['iron_bar', 'iron_dagger', 15, 250, 'smithing:column1'],
  ['steel_bar', 'steel_dagger', 30, 375, 'smithing:column1']
]) {
  for (const [option, amount] of [[1, 1], [2, 5], [3, 10]]) test(`${product}: natural anvil Make ${amount}, one bar each and unchanged XP`, () => {
    const p = fixture(['hammer', ...Array(12).fill(bar)], { smith: level, knowledge: 0 });
    const before = p.stats[smithing]; openSmithing(p, bar); assert(invButton(p, component, product, option)); settle(p);
    assert.equal(count(p, product), amount); assert.equal(count(p, bar), 12 - amount);
    assert.equal(count(p, 'hammer'), 1); assert.equal(p.stats[smithing] - before, amount * xp);
  });
  test(`${product}: anvil low-level and exhausted bars cannot produce`, () => {
    const p = fixture(['hammer', bar], { smith: level - 1 }); const before = snapshot(p);
    stand(p, anvil); assert(useLoc(p, bar, anvil));
    if (product.endsWith('_dagger')) {
      assert.equal(p.modalMain, -1, 'published metal-level guard refuses before the chooser');
      assert(p.packets.some(packet => packet.constructor.name === 'IfSetText' && packet.text.includes('You need a Smithing level of at least')));
    } else {
      assert.equal(p.modalMain, id('Component', 'smithing')); assert(invButton(p, component, product)); settle(p);
    }
    assert.deepEqual(inventory(p), before.items); assert.deepEqual([...p.stats], before.xp);
    p.closeModal(); p.setLevel(smithing, level); p.messages.length = 0; openSmithing(p, bar);
    p.invDel(inv, obj(bar), 1); const missing = snapshot(p); assert(invButton(p, component, product)); settle(p);
    assert.deepEqual(inventory(p), missing.items); assert.deepEqual([...p.stats], missing.xp);
  });
  test(`${product}: full bag replacement, duplicate click after last bar`, () => {
    const p = fixture(['hammer', bar]); fullBag(p); const before = p.stats[smithing];
    openSmithing(p, bar); assert(invButton(p, component, product)); settle(p);
    assert.equal(count(p, product), 1); assert.equal(p.invFreeSpace(inv), 0); assert.equal(p.stats[smithing] - before, xp);
    const made = snapshot(p); invButton(p, component, product); settle(p);
    assert.deepEqual(inventory(p), made.items); assert.deepEqual([...p.stats], made.xp);
  });
}

test('iron/steel layer label and inventory are refreshed on each opening; other metals hide it', () => {
  const p = fixture(['hammer', 'iron_bar', 'steel_bar', 'bronze_bar', 'mithril_bar', 'adamantite_bar', 'runite_bar']);
  for (const bar of ['iron_bar', 'steel_bar', 'bronze_bar', 'mithril_bar', 'adamantite_bar', 'runite_bar', 'steel_bar', 'iron_bar']) {
    p.closeModal(); p.packets.length = 0; openSmithing(p, bar);
    const lanternMetal = bar === 'iron_bar' || bar === 'steel_bar';
    const hidden = p.packets.find(packet => packet.constructor.name === 'IfSetHide' && packet.component === id('Component', 'smithing:com_145'));
    assert(hidden, 'server sends lantern layer visibility'); assert.equal(Boolean(hidden.hidden), !lanternMetal);
    if (lanternMetal) {
      const text = p.packets.find(packet => packet.constructor.name === 'IfSetText' && packet.component === id('Component', 'smithing:com_148'));
      assert.equal(text?.text, bar === 'iron_bar' ? 'Oil lantern frame' : 'Bullseye lantern');
      assert(p.invListeners.some(listener => listener.com === id('Component', 'smithing:com_147') && listener.type === id('InvType', bar === 'iron_bar' ? 'smithing_lamp_iron' : 'smithing_lamp_steel')));
      assert.equal(p.getVar(id('VarPlayerType', 'if2')), 1);
    }
  }
});

for (const [part, frame, product, craft, fm] of assemblies) {
  test(`${product}: both input directions, full bag, exact state, immediate zero-XP assembly`, () => {
    for (const reverse of [false, true]) {
      const p = fixture([part, frame], { craft, fm }); fullBag(p); const before = snapshot(p);
      assert(use(p, ...(reverse ? [frame, part] : [part, frame])));
      assert.equal(count(p, product), 1); assert.equal(count(p, part), 0); assert.equal(count(p, frame), 0);
      assert.equal(count(p, 'knife'), 26); assert.equal(p.invFreeSpace(inv), 1); immediate(p, before);
    }
  });
  test(`${product}: unknown lesson and actual skill boundary conserve both parts`, () => {
    for (const options of [{ knowledge: 0 }, ...(craft > 1 ? [{ craft: craft - 1 }] : []), ...(fm > 1 ? [{ fm: fm - 1 }] : [])]) {
      const p = fixture([part, frame], options); const before = snapshot(p); assert(use(p, part, frame));
      conserved(p, before); immediate(p, before);
    }
  });
  test(`${product}: stale duplicate packet cannot consume a second unrelated input`, () => {
    const p = fixture([part, frame, part, frame]); const partSlot = slotOf(p, part); const frameSlot = slotOf(p, frame);
    assert(use(p, part, frame)); const made = snapshot(p);
    assert.equal(use(p, part, frame, { useSlot: partSlot, targetSlot: frameSlot }), false); conserved(p, made);
    assert.equal(count(p, product), 1); assert.equal(count(p, part), 1); assert.equal(count(p, frame), 1);
  });
}

test('lit oil lamp on frame is the published unsupported-pair result, with no extinction or consumption', () => {
  for (const fm of [1, 25, 26, 99]) {
    const p = fixture(['oil_lamp_lit', 'oil_lantern_frame'], { fm }); const before = snapshot(p);
    assert(use(p, 'oil_lamp_lit', 'oil_lantern_frame')); conserved(p, before);
    assert.deepEqual(p.messages, ['Nothing interesting happens.']);
  }
});
test('wrong assembly materials and mining helmet are never converted by their reverse-stage param', () => {
  for (const [part, frame] of [['swamp_tar', 'candle_lantern_empty'], ['bullseye_lantern_lens', 'oil_lantern_frame'], ['oil_lamp_empty', 'bullseye_lantern_nolens'], ['sapphire', 'cave_goblin_mining_helmet_lit']]) {
    const p = fixture([part, frame]); const before = snapshot(p); assert(use(p, part, frame)); conserved(p, before);
  }
});

test('natural lamp still uses only original personal oil bit and original empty/full morphs', () => {
  const type = types.LocType.get(still.type); assert.equal(type.multivarbit, oil);
  assert.equal(type.multiloc[0], id('LocType', 'lamp_oil_still_0')); assert.equal(type.multiloc[1], id('LocType', 'lamp_oil_still_1'));
  for (const child of ['lamp_oil_still', 'lamp_oil_still_0', 'lamp_oil_still_1']) assert(ScriptProvider.getByName(`[oplocu,${child}]`));
  const p = fixture(['swamp_tar', 'swamp_tar']); const before = snapshot(p); atStill(p, 'swamp_tar');
  const expected = [...before.vars]; expected[cave] |= 1 << types.VarBitType.get(oil).startbit;
  assert.equal(count(p, 'swamp_tar'), 1); assert.equal(p.getVarBit(oil), 1); immediate(p, before, expected);
  const prepared = snapshot(p); atStill(p, 'swamp_tar'); conserved(p, prepared); immediate(p, prepared);
});
for (const [empty, filled, lit, option] of containers) {
  test(`${empty}: one tar/one dose, full bag, duplicate fill and ordinary extinction retain oil`, () => {
    const p = fixture(['swamp_tar', empty, empty, 'tinderbox']); fullBag(p); atStill(p, 'swamp_tar');
    const before = snapshot(p); const emptySlot = slotOf(p, empty); atStill(p, empty);
    assert.equal(inventory(p)[emptySlot].name, filled); assert.equal(count(p, empty), 1); assert.equal(count(p, filled), 1);
    assert.equal(p.getVarBit(oil), 0); const expected = [...before.vars]; expected[cave] &= ~(1 << types.VarBitType.get(oil).startbit);
    immediate(p, before, expected); const made = snapshot(p); atStill(p, empty); conserved(p, made);
    assert(use(p, 'tinderbox', filled)); assert.equal(count(p, lit), 1); assert(held(p, lit, option));
    assert.equal(count(p, filled), 1); assert.equal(p.getVarBit(oil), 0); assert(use(p, 'tinderbox', filled)); assert.equal(count(p, lit), 1);
    assert.deepEqual([...p.stats], before.xp, 'filling and lighting give no extra XP');
  });
  test(`${empty}: missing dose, already-filled and lit states never consume or refill`, () => {
    const p = fixture([empty, filled, lit, 'swamp_tar']); const before = snapshot(p); atStill(p, empty); conserved(p, before);
    atStill(p, 'swamp_tar');
    for (const wrong of [filled, lit]) { const prepared = snapshot(p); atStill(p, wrong); conserved(p, prepared); }
    assert.equal(p.getVarBit(oil), 1);
  });
}
test('wrong material or Regicide still consumes neither tar, prepared oil nor containers', () => {
  const p = fixture(['swamp_tar', 'hammer', 'regicide_barrel_tar', 'oil_lamp_empty']);
  atStill(p, 'swamp_tar');
  for (const item of ['hammer', 'regicide_barrel_tar']) { const before = snapshot(p); atStill(p, item); conserved(p, before); }
  seed(p, ['swamp_tar']);
  for (const item of ['swamp_tar', 'oil_lamp_empty']) {
    const before = snapshot(p); stand(p, regicide); assert(useLoc(p, item, regicide)); conserved(p, before);
    assert.equal(p.messages.at(-1), "You don't want to damage the still.");
  }
});
test('prepared oil is personal, survives real save/load and login, and settles exactly once after relog', () => {
  const p = fixture(['swamp_tar', 'oil_lamp_empty']); atStill(p, 'swamp_tar');
  const other = fixture(['oil_lamp_empty']); const untouched = snapshot(other); atStill(other, 'oil_lamp_empty'); conserved(other, untouched);
  const saved = p.getVar(cave); const q = reload(p); assert.equal(q.getVar(cave), saved); assert.equal(q.getVarBit(oil), 1);
  execute('[login,_]', q); const transientMask = (3 << 1) | (7 << 6);
  assert.equal(q.getVar(cave), saved & ~transientMask); assert.equal(q.getVarBit(oil), 1); assert.equal(q.getVarBit(learned), 1);
  q.messages.length = 0; atStill(q, 'oil_lamp_empty'); assert.equal(count(q, 'oil_lamp_unlit'), 1); assert.equal(q.getVarBit(oil), 0);
  assert.equal(reload(q).getVarBit(oil), 0); assert.equal(other.getVarBit(oil), 0);
});

for (const [source, product] of [['bullseye_lantern_empty', 'tog_sapphire_lantern_empty'], ['bullseye_lantern_unlit', 'tog_sapphire_lantern_unlit']]) {
  test(`${source}: sapphire returns the lens, preserves oil, full bag, both directions, no Crafting gate`, () => {
    for (const reverse of [false, true]) {
      const p = fixture(['sapphire', source], { craft: 1, knowledge: 0 }); fullBag(p); const before = snapshot(p);
      assert(use(p, ...(reverse ? [source, 'sapphire'] : ['sapphire', source])));
      assert.equal(count(p, source), 0); assert.equal(count(p, 'sapphire'), 0); assert.equal(count(p, product), 1);
      assert.equal(count(p, 'bullseye_lantern_lens'), 1); assert.equal(count(p, 'knife'), 26); assert.equal(p.invFreeSpace(inv), 0);
      immediate(p, before);
    }
  });
  test(`${source}: stale duplicate conversion cannot spend a second sapphire or lantern`, () => {
    const p = fixture(['sapphire', source, 'sapphire', source]); const gemSlot = slotOf(p, 'sapphire'); const lanternSlot = slotOf(p, source);
    assert(use(p, 'sapphire', source)); const before = snapshot(p);
    assert.equal(use(p, 'sapphire', source, { useSlot: gemSlot, targetSlot: lanternSlot }), false); conserved(p, before);
    assert.equal(count(p, 'sapphire'), 1); assert.equal(count(p, source), 1); assert.equal(count(p, product), 1); assert.equal(count(p, 'bullseye_lantern_lens'), 1);
  });
}
test('sapphire refuses lit/wrong lanterns and non-sapphire materials without state or inventory writes', () => {
  for (const [part, lantern] of [['sapphire', 'bullseye_lantern_lit'], ['sapphire', 'oil_lantern_unlit'], ['uncut_sapphire', 'bullseye_lantern_unlit'], ['sapphire', 'bullseye_lantern_nolens']]) {
    const p = fixture([part, lantern]); const before = snapshot(p); assert(use(p, part, lantern)); conserved(p, before);
  }
});
test('converted filled sapphire uses the existing FM49 ignition gate and normal extinction/relighting', () => {
  const p = fixture(['sapphire', 'bullseye_lantern_unlit', 'tinderbox'], { fm: 48 });
  assert(use(p, 'sapphire', 'bullseye_lantern_unlit')); const before = snapshot(p); p.messages.length = 0;
  assert(use(p, 'tinderbox', 'tog_sapphire_lantern_unlit')); conserved(p, before); assert.deepEqual(p.messages, []);
  p.setLevel(firemaking, 49); assert(use(p, 'tinderbox', 'tog_sapphire_lantern_unlit')); assert.equal(count(p, 'tog_sapphire_lantern_lit'), 1);
  assert(held(p, 'tog_sapphire_lantern_lit', 1)); assert(use(p, 'tinderbox', 'tog_sapphire_lantern_unlit')); assert.equal(count(p, 'tog_sapphire_lantern_lit'), 1);
});

test('unchanged Regicide distillation: natural still, real controls and packed timer produce one naphtha barrel', () => {
  const p = fixture(['regicide_barrel_tar', ...Array(25).fill('coal')]); const beforeCave = p.getVar(cave); stand(p, regicide);
  assert(useLoc(p, 'regicide_barrel_tar', regicide)); assert.equal(p.modalMain, id('Component', 'regicide_still'));
  assert.equal(count(p, 'regicide_barrel_tar'), 0); assert.equal(count(p, 'regicide_barrel_empty'), 1);
  assert(button(p, 'regicide_still:com_130')); assert(button(p, 'regicide_still:com_132')); assert(button(p, 'regicide_still:com_132'));
  const settings = id('VarPlayerType', 'regicide_still_settings'); const temp = id('VarPlayerType', 'temp'); const total = id('VarPlayerType', 'regicide_still_total');
  for (let n = 0; p.getVar(total) < 26 && n < 80; n++) {
    const heatBits = (p.getVar(settings) >>> 13) & 8191; const heat = Math.log2(heatBits);
    if (heat <= 6 && p.getVar(temp) <= 50) assert(button(p, 'regicide_still:com_120'));
    execute('[softtimer,still_progress]', p);
  }
  assert.equal(p.getVar(total), 26, 'existing still reaches its original completion threshold');
  assert(button(p, 'regicide_still:com_89')); assert.equal(count(p, 'regicide_barrel_naphtha'), 1); assert.equal(count(p, 'regicide_barrel_empty'), 0);
  assert.equal(p.getVar(total), 0); assert.equal(p.getVar(cave), beforeCave, 'Regicide writes no cave oil state');
});

console.log(`SC-02L manufacture: ${cases - failures}/${cases} cases passed`);
process.exit(failures ? 1 : 0);
