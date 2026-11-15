#!/usr/bin/env node
import assert from 'node:assert/strict';
import { World, PlayerLoading, Packet, ScriptProvider, ServerTriggerType, types, id, obj, inv, player, inventory, count, execute, startDialogue, resumeDialogue, dialoguePage } from './runtime.mjs';

// Exact registered CANDIDATE transcript: lumbridge-swamp-caves.dlg.candle-seller.
// These are conversation expectations, not a second implementation of the service.
const text = {
  opening: 'Do you want a lit candle for 1000 gold?',
  yes: 'Yes please.', price: 'One thousand gold?!',
  decline: "No thanks, I'd rather curse the darkness.",
  buy: "All right, you win, I'll buy a candle.",
  how: 'How do you make lanterns?',
  pricePages: [
    "Look, you're not going to be able to survive down that hole without a light source.",
    'So you could go off to the candle shop to buy one more cheaply. You could even make your own lantern which is a lot better.',
    "But I bet you want to find out what's down there right now, don't you? And you can pay me 1000 gold for the privilege!"
  ],
  here: 'Here you go then.',
  warning: "I should warn you, though, it can be dangerous to take a naked flame down there. You'd be better off making a lantern.",
  danger: "What's so dangerous about a naked flame?",
  heh: "Heh heh... You'll find out.", bye: 'Thanks, bye.',
  poor: "But I don't have that kind of money on me.", noCandle: 'Well then, no candle for you!',
  lesson: [
    'Out of glass. The more advanced lanterns have a metal component as well.',
    "Firstly you can make a simple candle lantern out of glass. It's just like a candle, but the flame isn't exposed, so it's safer.",
    'Then you can make an oil lamp, which is brighter but has an exposed flame. But if you make an iron frame for it you can turn it into an oil lantern.',
    "Finally there's the bullseye lantern. You'll need to make a frame out of steel and add a glass lens.",
    "Once you've made your lamp or lantern, you'll need to make lamp oil for it. The chemist near Rimmington has a machine for that.",
    "For any light source, you'll need a tinderbox to light it. Keep your tinderbox handy in case it goes out!",
    "But if all that's too complicated you can buy a candle right here for 1000 gold!"
  ]
};
const cave = id('VarPlayerType', 'goblin_caves');
const learned = id('VarBitType', 'know_how_to_make_lanterns');
const sellerId = id('NpcType', 'swamp_candle_guy');
assert.equal(sellerId, 1834);
const seller = [...World.npcs].find(npc => npc.type === sellerId);
assert(seller, 'real map contains the natural candle seller');
const talk = '[opnpc1,swamp_candle_guy]';
const learnMask = 1 << 9;
const transientMask = (3 << 1) | (7 << 6);
let cases = 0;
let failures = 0;
function test(name, fn) {
  cases++;
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack ?? error}`); }
}
function fixture(coins = 2000, knowledge = 0, conversation = 1) {
  const p = player();
  // Labelled personal-state fixtures preserve every other original and high bit.
  p.setVar(cave, (0x55aa0dff & ~learnMask & ~(1 << 10)) | (knowledge << 9) | (conversation << 10));
  if (coins) assert.equal(p.invAdd(inv, obj('coins'), coins), coins);
  p.before = { vars: [...p.vars], items: inventory(p), xp: [...p.stats] };
  return p;
}
function checkState(p, knowledge, items = p.before.items) {
  const vars = [...p.before.vars];
  vars[cave] = (vars[cave] & ~learnMask) | (knowledge << 9);
  assert.deepEqual([...p.vars], vars, 'only original learning bit may change');
  assert.deepEqual(inventory(p), items, 'exact inventory settlement');
  assert.deepEqual([...p.stats], p.before.xp, 'no teaching or sale XP');
  assert.deepEqual(p.messages, [], 'no invented game messages');
  assert(!p.packets.some(packet => /Synth|Spotanim/.test(packet.constructor.name)), 'no added sound or spotanim');
}
function speech(p, who, expected) {
  const page = dialoguePage(p);
  assert.equal(page[0], who === 'npc' ? 'Candle seller' : p.displayName, 'speaker');
  assert.equal(page.slice(1).join(' '), expected, 'exact printed page');
}
function say(p, who, expected) { speech(p, who, expected); return resumeDialogue(p); }
function menu(p, options, choice) {
  assert.deepEqual(dialoguePage(p), ['Select an Option', ...options], 'exact offered choices');
  const root = types.Component.get(p.modalChat).comName;
  for (let option = 1; option <= options.length; option++) assert(p.resumeButtons.includes(id('Component', `${root}:com_${option}`)));
  if (choice !== undefined) return resumeDialogue(p, choice);
}
function opening(p, choice) {
  p.closeModal();
  p.target = seller; p.targetOp = ServerTriggerType.OPNPC1 - 7;
  assert.equal(p.getOpTrigger()?.id, ScriptProvider.getByName(talk).id, 'real NPC operation selects direct packed trigger');
  startDialogue(talk, p, seller);
  say(p, 'npc', text.opening);
  const options = [text.yes, text.price, text.decline];
  if (p.getVarBit(learned)) options.push(text.how);
  return menu(p, options, choice);
}
function done(p) { assert.equal(p.activeScript, null); assert.equal(p.modalChat, -1); }
function decline(p) { say(p, 'player', text.decline); done(p); }
function price(p, choice) {
  say(p, 'player', text.price);
  for (const line of text.pricePages) say(p, 'npc', line);
  return menu(p, [text.buy, 'No way.', text.how], choice);
}
function warning(p, choice) {
  say(p, 'npc', text.here); say(p, 'npc', text.warning);
  return menu(p, [text.danger, text.how, text.bye], choice);
}
function insufficient(p) { say(p, 'player', text.poor); say(p, 'npc', text.noCandle); done(p); }
function teaching(p, choice = 2) {
  const already = p.getVarBit(learned);
  const items = inventory(p);
  say(p, 'player', text.how);
  for (const line of text.lesson) {
    assert.equal(p.getVarBit(learned), already, 'no learning before the final page is acknowledged');
    assert.deepEqual(inventory(p), items, 'no free lesson item');
    say(p, 'npc', line);
  }
  assert.equal(p.getVarBit(learned), 1, 'complete lesson records knowledge');
  assert.deepEqual(inventory(p), items, 'teaching alone grants no item');
  menu(p, [text.buy, text.decline], choice ?? undefined);
}
function boughtItems(p, coins, candles = 1) {
  const before = p.before.items.filter(item => item?.name !== 'coins');
  // Exact slot layout is checked independently in full-bag and interruption cases.
  assert.equal(count(p, 'coins'), coins);
  assert.equal(count(p, 'lit_candle'), candles);
  assert.equal(count(p, 'unlit_candle'), 0);
  assert.equal(inventory(p).filter(Boolean).length, before.filter(Boolean).length + (coins ? 1 : 0) + candles);
  return inventory(p);
}
for (const knowledge of [0, 1]) for (const conversation of [0, 1]) {
  test(`opening ${knowledge ? 'learned' : 'fresh'}, bit 284=${conversation}: decline changes nothing`, () => {
    const p = fixture(2000, knowledge, conversation); opening(p, 3); decline(p); checkState(p, knowledge);
  });
  test(`price explanation, No way, knowledge=${knowledge}, bit 284=${conversation}`, () => {
    const p = fixture(2000, knowledge, conversation); opening(p, 2); price(p, 2);
    say(p, 'player', 'No way.'); done(p); checkState(p, knowledge);
  });
}
for (const route of ['opening', 'price']) for (const answer of [1, 3]) {
  test(`${route} purchase: exact warning answer ${answer}, 1000 own coins`, () => {
    const p = fixture(1000);
    opening(p, route === 'opening' ? 1 : 2);
    if (route === 'price') { price(p, 1); say(p, 'player', text.buy); }
    else say(p, 'player', text.yes);
    const items = boughtItems(p, 0);
    warning(p, answer);
    if (answer === 1) { say(p, 'player', text.danger); say(p, 'npc', text.heh); }
    else say(p, 'player', text.bye);
    done(p); checkState(p, 0, items);
  });
}
for (const route of ['price', 'purchase', 'repeat']) for (const answer of [1, 2]) {
  test(`${route} complete teaching, final answer ${answer}, repeat preserves other bits`, () => {
    const p = fixture(2000, route === 'repeat' ? 1 : 0, 0);
    opening(p, route === 'repeat' ? 4 : route === 'price' ? 2 : 1);
    if (route === 'price') price(p, 3);
    else if (route === 'purchase') { say(p, 'player', text.yes); warning(p, 2); }
    teaching(p, answer);
    const boughtBefore = route === 'purchase' ? 1 : 0;
    if (answer === 2) decline(p);
    else { say(p, 'player', text.buy); warning(p, 3); say(p, 'player', text.bye); done(p); }
    const candles = boughtBefore + (answer === 1 ? 1 : 0);
    const items = candles ? boughtItems(p, 2000 - candles * 1000, candles) : p.before.items;
    checkState(p, 1, items);
    opening(p); menu(p, [text.yes, text.price, text.decline, text.how], 3); decline(p);
    checkState(p, 1, items);
  });
}
for (const coins of [0, 999]) for (const route of ['opening', 'price', 'teaching']) {
  test(`${coins} coins refuses through ${route}, with no item or free-candle state`, () => {
    const p = fixture(coins); opening(p, route === 'opening' ? 1 : 2);
    if (route === 'price') { price(p, 1); say(p, 'player', text.buy); }
    else if (route === 'teaching') { price(p, 3); teaching(p, 1); say(p, 'player', text.buy); }
    else say(p, 'player', text.yes);
    insufficient(p); checkState(p, route === 'teaching' ? 1 : 0);
  });
}
for (const coins of [999, 1000, 1001, 2000]) {
  test(`full bag, ${coins} coins: exact final-stack capacity settlement`, () => {
    const p = fixture(coins);
    assert.equal(p.invAdd(inv, obj('knife'), p.invFreeSpace(inv)), 27);
    p.before.items = inventory(p);
    opening(p, 1); say(p, 'player', text.yes);
    if (coins < 1000) { insufficient(p); checkState(p, 0); }
    else if (coins > 1000) { done(p); checkState(p, 0); assert.deepEqual(dialoguePage(p), [], 'unknown full-bag wording stays silent'); }
    else {
      const expected = p.before.items.map(item => item?.name === 'coins' ? { name: 'lit_candle', count: 1 } : item);
      assert.deepEqual(inventory(p), expected, 'only final coin stack becomes the candle slot');
      warning(p, 3); say(p, 'player', text.bye); done(p); checkState(p, 0, expected);
    }
  });
}
test('a different account and own bank coins cannot pay this account\'s bill', () => {
  const wealthy = fixture(1000); const p = fixture(999);
  p.invAdd(id('InvType', 'bank'), obj('coins'), 1000);
  opening(p, 1); say(p, 'player', text.yes); insufficient(p); checkState(p, 0);
  assert.equal(count(wealthy, 'coins'), 1000); assert.equal(p.invTotal(id('InvType', 'bank'), obj('coins')), 1000);
});
for (let stop = 0; stop <= text.lesson.length; stop++) {
  test(`interrupt teaching page ${stop}: no early knowledge, reopening is fresh`, () => {
    const p = fixture(); opening(p, 2); price(p, 3);
    for (let page = 0; page < stop; page++) resumeDialogue(p);
    speech(p, stop === 0 ? 'player' : 'npc', stop === 0 ? text.how : text.lesson[stop - 1]);
    assert.equal(p.getVarBit(learned), 0);
    p.closeModal(); done(p); checkState(p, 0);
    opening(p, 3); decline(p); checkState(p, 0);
  });
}
test('interrupt after the final teaching Continue: knowledge survives, no reward', () => {
  const p = fixture(); opening(p, 2); price(p, 3); teaching(p, null);
  p.closeModal(); done(p); checkState(p, 1);
  opening(p, 4); teaching(p, 2); decline(p); checkState(p, 1);
});
test('closing the Yes page does not buy; closing the receipt never refunds or duplicates', () => {
  const p = fixture(); opening(p, 1); speech(p, 'player', text.yes);
  p.closeModal(); done(p); checkState(p, 0);
  opening(p, 1); say(p, 'player', text.yes); speech(p, 'npc', text.here);
  const first = boughtItems(p, 1000); p.closeModal(); done(p); checkState(p, 0, first);
  opening(p, 1); say(p, 'player', text.yes); warning(p, 3); say(p, 'player', text.bye); done(p);
  checkState(p, 0, boughtItems(p, 0, 2));
});
test('purchase rechecks money and capacity at settlement, not at the opening offer', () => {
  const p = fixture(1000); opening(p, 1); speech(p, 'player', text.yes);
  p.invDel(inv, obj('coins'), 1); p.before.items = inventory(p);
  resumeDialogue(p); insufficient(p); checkState(p, 0);
  const q = fixture(2000); opening(q, 1); speech(q, 'player', text.yes);
  q.invAdd(inv, obj('knife'), q.invFreeSpace(inv)); q.before.items = inventory(q);
  resumeDialogue(q); done(q); checkState(q, 0);
});
function reload(p) {
  const bytes = p.save();
  assert(PlayerLoading.verify(new Packet(bytes)), 'production save checksum is valid');
  const loaded = PlayerLoading.load(p.username, new Packet(bytes), null);
  loaded.pid = p.pid; loaded.slot = p.slot; loaded.uid = p.uid; loaded.isActive = true;
  loaded.packets = []; loaded.messages = [];
  loaded.write = packet => loaded.packets.push(packet);
  loaded.messageGame = message => loaded.messages.push(String(message));
  loaded.wrappedMessageGame = loaded.messageGame;
  World.players[p.pid] = loaded;
  return loaded;
}
test('real learned save/load, login clears only 278/282, repeat branch survives a second save', () => {
  const p = fixture(); opening(p, 2); price(p, 3); teaching(p, 2); decline(p);
  const saved = p.getVar(cave);
  const q = reload(p);
  assert.equal(q.getVar(cave), saved, 'real save/load preserves learning and every other parent bit');
  assert.deepEqual(inventory(q), p.before.items);
  execute('[login,_]', q);
  assert.equal(q.getVar(cave), saved & ~transientMask, 'login clears only brightness and gas');
  assert.equal(q.getVarBit(learned), 1);
  q.before = { vars: [...q.vars], items: inventory(q), xp: [...q.stats] }; q.messages.length = 0;
  opening(q, 4); teaching(q, 2); decline(q); checkState(q, 1);
  assert.equal(reload(q).getVar(cave), saved & ~transientMask);
});
test('pre-change temporary save loads unchanged, with absent 425 defaulting to zero', () => {
  const p = fixture();
  const definition = types.VarPlayerType.get(cave);
  const scope = definition.scope;
  let bytes;
  try { definition.scope = types.VarPlayerType.SCOPE_TEMP; bytes = p.save(); }
  finally { definition.scope = scope; }
  const q = PlayerLoading.load(p.username, new Packet(bytes), null);
  assert.equal(q.getVar(cave), 0, 'old writer omits temporary parent, new loader keeps zero default');
  assert.equal(q.getVar(id('VarPlayerType', 'tutorial')), p.getVar(id('VarPlayerType', 'tutorial')));
  assert.deepEqual(inventory(q), inventory(p), 'the genuine old-format save preserves its inventory');
});
test('original permanent slot and transmit remain policy-visible after the move', () => {
  const definition = types.VarPlayerType.get(cave);
  assert.equal(cave, 425); assert.equal(definition.scope, types.VarPlayerType.SCOPE_PERM); assert.equal(definition.transmit, true);
  for (let bit = 277; bit <= 285; bit++) assert.equal(types.VarBitType.get(bit).basevar, 425);
});
console.log(`SC02 seller: ${cases - failures}/${cases} passed, ${failures} failed`);
// World owns workers, but this transport-free suite starts no server.
process.exit(failures ? 1 : 0);
