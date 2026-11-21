import assert from 'node:assert/strict';
import { lifecycleTest as test, sealLifecycle } from './completion.mjs';

import { count, id, inv, invButton, obj, seed, types } from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';
import { feudItems, observeItem, tradeAndDrop, transferPair } from './tradeability.mjs';
import { receiptOtherRoutes } from './receipt-routes.mjs';
import { assertOlderDialogueCutover } from './dialogue-audit.mjs';
import {
  actors, begin, buyReceipts, deliver, drink, gangMask, operate, read, relog, stage, talk
} from './fixture.mjs';

test('all Feud item flags and real transfer routes match the item-history audit', () => {
  const untradeable = new Set([
    'feud_mayors_house_keys', 'feud_mayors_jewels', 'feud_fib_hint', 'feud_nos_note',
    'feud_camel_pooh_bucket', 'feud_camel_poison_pooh_bucket', 'feud_camel_receipt',
    'poison_from_hag', 'snake_flute', 'basket_for_snake', 'basket_with_snake',
    'superhot_kebab_sauce', 'blackjack_oak', 'feud_desert_disguise'
  ]);
  for (const name of feudItems) {
    assert.equal(types.ObjType.get(obj(name)).tradeable, !untradeable.has(name),
      `${name}: the packed server-only flag follows the CANDIDATE item-history table`);
    const result = observeItem(name);
    assert.equal(result.offered, untradeable.has(name) ? 0 : 1, `${name}: real trade offer`);
    assert.equal(result.otherPickup, !untradeable.has(name), `${name}: real ground pickup`);
  }
});

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

test('Morrisane opens the candidate thirteen-entry shop through dialogue without a later Trade option', () => {
  const p = player();
  p.invAdd(inv, obj('coins'), 100);
  talk(p, 'feud_ali_m', [2]);
  assert.equal(stage(p), 0);
  assert.equal(p.modalMain, id('Component', 'shop_template'));
  assert.equal(count(p, 'coins'), 100, 'opening stock does not charge before the close callback');
  const expected = [
    ['pot_empty', 3, 100], ['jug_empty', 2, 100], ['water_skin3', 10, 300],
    ['desert_shirt', 3, 12], ['desert_boots', 2, 100], ['bucket_empty', 19, 400],
    ['feud_karidian_fakebeard', 11, 10], ['feud_karidian_turban', 12, 10],
    ['papyrus', 50, 10], ['knife', 5, 100], ['tinderbox', 11, 100],
    ['bronze_pickaxe', 23, 100], ['raw_chicken', 15, 100]
  ];
  const shop = id('InvType', 'feud_morrisanes'), config = types.InvType.get(shop);
  assert.deepEqual(Array.from(config.stockobj), expected.map(([name]) => obj(name)));
  assert.deepEqual(Array.from(config.stockcount), expected.map(([, quantity]) => quantity));
  assert.deepEqual(Array.from(config.stockrate), expected.map(([, , rate]) => rate));
  assert.equal(p.getVar(id('VarPlayerType', 'shop')), shop);
  assert.deepEqual(types.NpcType.get(id('NpcType', 'feud_ali_m')).op.filter(Boolean), ['Talk-to'],
    'the dated 2021 Trade option is not imported into the original client definition');
  const component = id('Component', 'shop_template:inv');
  const stock = p.getInventoryFromListener(p.invListeners.find(entry => entry.com === component));
  const buy = types.Component.get(component).iop.findIndex(text => /buy[^\d]*1\b/i.test(text ?? '')) + 1;
  for (const name of ['feud_karidian_fakebeard', 'feud_karidian_turban']) {
    assert(invButton(p, 'shop_template:inv', name, buy, stock.getItemIndex(obj(name))));
    assert.equal(count(p, name), 1, 'the period-guide disguise can be bought from Morrisane');
  }
  p.closeModal();
  const money = count(p, 'coins');
  const refusal = talk(p, 'feud_ali_m', [1, 2, 1, 1]);
  assert.match(refusal.text, /I'm far too busy to carry out errands for shopkeepers - maybe later\./);
  assert.doesNotMatch(refusal.text, /manages to sell you some junk/);
  assert.equal(stage(p), 0);
  assert.equal(count(p, 'coins'), money, 'refusing without viewing stock does not trigger a sale');
});

test('barman small-talk remains available without producing quest progress', () => {
  const p = player(), result = talk(p, 'feud_ali_the_barman', [2, 1]);
  assert.match(result.text, /Nothing much really, the same as you would expect of any border town on the edge of the desert\./);
  assert.match(result.text, /Nothing much to say really about them\. They're all paying customers so I won't rock the boat if you don't mind\./);
  assert.equal(stage(p), 0);
  assert.equal(read(p, 'feud_report_drink'), 0, 'ordinary small-talk cannot identify the traitor drink');
  assert.notEqual(p.modalMain, id('Component', 'shop_template'), 'the non-trading branch opens no shop');
  for (const [choice, reply] of [
    ["I'm looking for Ali from Pollnivneach.", "Everyone in the town have uncles called Ali."],
    ["The 'Asp and Snake'? What a strange name for a bar.", "I admit it appears so, seeing as everybody and every other establishment in this town has the name 'Ali' in it."]
  ]) {
    const ordinary = player(), response = talk(ordinary, 'feud_ali_the_barman', [choice, 1]);
    assert(response.text.includes(reply), 'the older ordinary Barman branch remains available');
    assert.equal(stage(ordinary), 0);
    assert.equal(read(ordinary, 'feud_report_drink'), 0, 'older ordinary topics cannot identify the traitor drink');
    assert.notEqual(ordinary.modalMain, id('Component', 'shop_template'), 'ordinary topics open no shop');
  }
});

test('removed optional chatter and later lore do not remain in the compiled Feud unit', () => {
  assertOlderDialogueCutover();
});

test('start refusal, early item use, and compatible acceptance use native dispatch', () => {
  const p = seed(player(), ['beer']);
  talk(p, 'feud_ali_m', [1, 1, 1]);
  assert.equal(stage(p), 0);
  operate(p, actors('feud_drunken_ali')[0], 1, [], 'beer');
  assert.equal(count(p, 'beer'), 1, 'no beer is consumed before the quest starts');
  assert.equal(read(p, 'feud_var_drink'), 0);
  begin(p);
});

test('the first boundary is played from zero, saved, recruited and never reset', () => {
  let p = player(); begin(p); drink(p);
  p = relog(p);
  assert.equal(stage(p), 2, 'the sourced inquiry checkpoint survives the real save codec');
  assert.equal(read(p, 'feud_var_drink'), 3, 'three-beer progress survives the real save codec');
  talk(p, 'feud_egyptian_doorman_multi');
  talk(p, 'feud_arabian_guard_multi');
  assert.equal(read(p, 'feud_var_talk_gangs'), 3, 'both distinct gang inquiries are remembered');
  buyReceipts(p); deliver(p);
  p = relog(p);
  assert.equal(stage(p), 5);
  assert.equal(gangMask(p), 3, 'distinct receipt progress survives logout');
  const villager = actors('feud_villager_multi_1')[0];
  const coinsBefore = count(p, 'coins');
  operate(p, villager, 3);
  assert.equal(read(p, 'feud_talk_villager'), 0, 'the trial cannot start before Operator acceptance');
  assert.equal(count(p, 'coins'), coinsBefore, 'early pickpocket cannot award trial loot');
  talk(p, 'feud_egyptian_minder', [2, 2]);
  assert.equal(stage(p), 5, 'declining recruitment preserves the hand-ins');
  talk(p, 'feud_egyptian_minder', [1, 2]);
  assert.equal(stage(p), 6, 'accepting the sourced trial briefing records recruitment');
  talk(p, 'feud_ali_m', [1]);
  assert.equal(stage(p), 6, 'Morrisane never restarts an active quest');
  p = relog(p);
  assert.equal(stage(p), 6, 'recruitment survives the real save codec');
  talk(p, 'feud_egyptian_minder', [2, 2]);
  assert.equal(stage(p), 6, 'the repeat Operator path cannot reset recruitment');
});

test('a published stage-one save retains its start meaning without migration', () => {
  let p = player(); begin(p);
  p = relog(p);
  assert.equal(stage(p), 1);
  assert.equal(read(p, 'feud_var_drink'), 0);
  assert.equal(read(p, 'feud_var_talk_gangs'), 0);
  assert.equal(gangMask(p), 0);
  talk(p, 'feud_ali_m', [1]);
  assert.equal(stage(p), 1, 'the original accepted-start value is unchanged');
  drink(p);
  assert.equal(stage(p), 2, 'the saved start continues through ordinary beer actions');
});

test('sourced pre-start gang greetings preserve progress and the early camel reply remains available after starting', () => {
  const p = player();
  for (const name of ['feud_drunken_ali', 'feud_ali_the_discount_camel_seller']) {
    assert.equal(talk(p, name).text, '', `${name} has no sourced pre-start dialogue`);
  }
  for (const name of ['feud_egyptian_doorman_multi', 'feud_arabian_guard_multi', 'feud_arabian_guard_coward']) {
    const greeting = talk(p, name);
    assert.match(greeting.text, /I'm new to town and wanted to get to know the locals\./);
    assert.match(greeting.text, /Come back if you have some business to discuss with us\./);
    assert.equal(stage(p), 0);
    assert.equal(read(p, 'feud_var_talk_gangs'), 0, 'a pre-start greeting is not a gang inquiry');
  }
  begin(p);
  assert.match(talk(p, 'feud_drunken_ali').text, /Ahh, a kind stranger\./);
  for (const name of ['feud_egyptian_doorman_multi', 'feud_arabian_guard_multi', 'feud_arabian_guard_coward']) {
    assert.equal(talk(p, name).text, '', `${name} has no retained post-start dialogue before the beers`);
  }
  const early = talk(p, 'feud_ali_the_discount_camel_seller', [4, 2]);
  assert.match(early.text, /Those two camels around the side are already sold\./);
  assert.match(early.text, /Come back later if you're still interested\./);
  assert.equal(count(p, 'feud_camel_receipt'), 0);
  assert.equal(stage(p), 1);
});

for (const [banditsFirst, coward] of [[false, false], [true, false], [true, true]]) {
  test(`saved inquiries gate the sale, and distinct receipts work ${banditsFirst ? 'Bandits' : 'Menaphites'} first${coward ? ' with the Cowardly Bandit' : ''}`, () => {
    let p = player(); begin(p); drink(p);
    p.invAdd(inv, obj('coins'), 1000);
    const first = banditsFirst ? (coward ? 'feud_arabian_guard_coward' : 'feud_arabian_guard_multi') : 'feud_egyptian_doorman_multi';
    const second = banditsFirst ? 'feud_egyptian_doorman_multi' : 'feud_arabian_guard_multi';
    const assertNoSale = () => {
      const before = count(p, 'coins');
      const result = talk(p, 'feud_ali_the_discount_camel_seller', [4, 2]);
      assert.match(result.text, /Come back later if you're still interested\./);
      assert.equal(count(p, 'coins'), before, 'an early visit charges nothing');
      assert.equal(count(p, 'feud_camel_receipt'), 0, 'coins alone cannot skip the gang inquiries');
      assert.equal(stage(p), 2);
    };
    assertNoSale();
    const inquiry = talk(p, first);
    assert.doesNotMatch(inquiry.text, /Maybe if I got both gangs a camel/, 'the first gang alone does not cause the joint-plan musing');
    assert.equal(read(p, 'feud_var_talk_gangs'), banditsFirst ? 2 : 1);
    p = relog(p);
    assertNoSale();
    talk(p, first);
    assert.equal(read(p, 'feud_var_talk_gangs'), banditsFirst ? 2 : 1, 'one repeated inquiry is not both gangs');
    assertNoSale();
    assert.match(talk(p, second).text, /Maybe if I got both gangs a camel/);
    assert.equal(read(p, 'feud_var_talk_gangs'), 3);
    assert.equal(stage(p), 3, 'the second distinct inquiry advances the sourced checkpoint');
    p = relog(p);
    assert.equal(read(p, 'feud_var_talk_gangs'), 3, 'the purchase reads both inquiries from the real saved state');
    buyReceipts(p, banditsFirst);
    deliver(p, banditsFirst, coward);
    p = relog(p);
    assert.equal(stage(p), 5);
    assert.equal(gangMask(p), 3);
    talk(p, 'feud_egyptian_minder', [1, 2]);
    assert.equal(stage(p), 6);
    assert.match(talk(p, 'feud_arabian_guard_multi').text, /Get out of here, you Menaphite dog!/);
    assert.match(talk(p, 'feud_arabian_guard_coward').text, /don't kill me, please!/);
    assert.match(talk(p, 'feud_egyptian_doorman_multi').text, /You're better off asking Ali the Operator\./);
  });
}

for (const generous of [false, true]) {
  test(`the ${generous ? 1000 : 500}-coin offer preserves money and progress on sourced refusals`, () => {
    const p = player(); begin(p); drink(p);
    talk(p, 'feud_egyptian_doorman_multi');
    talk(p, 'feud_arabian_guard_multi');
    p.invDel(inv, obj('coins'), count(p, 'coins'));
    const offer = generous ? 4 : 3;
    const poor = talk(p, 'feud_ali_the_discount_camel_seller', [4, offer]);
    assert.match(poor.text, /money|afford|gold|coins/i, 'the sourced insufficient-money reply is shown');
    assert.equal(count(p, 'feud_camel_receipt'), 0);
    assert.equal(stage(p), 3);
    p.invAdd(inv, obj('coins'), 1000);
    p.invAdd(inv, obj('bucket_empty'), 27);
    const before = count(p, 'coins');
    assert.match(talk(p, 'feud_ali_the_discount_camel_seller', [4, offer]).text, /inventory - full at the moment/);
    assert.equal(count(p, 'coins'), before);
    assert.equal(count(p, 'feud_camel_receipt'), 0, 'a full inventory never drops or loses a receipt');
    assert.equal(stage(p), 3);
    p.invDel(inv, obj('bucket_empty'), 27);
    buyReceipts(p, generous);
  });
}

test('a second account cannot obtain the buyer receipts through actual trade or ground pickup', () => {
  const p = player(), q = player(); begin(p); drink(p);
  talk(p, 'feud_egyptian_doorman_multi');
  talk(p, 'feud_arabian_guard_multi');
  buyReceipts(p);
  begin(q); drink(q);
  transferPair(p, q);
  const result = tradeAndDrop(p, q, 'feud_camel_receipt');
  assert.equal(result.offered, 0);
  assert.equal(result.transferred, 0);
  assert.equal(result.otherVisibleAtReveal, false);
  assert.equal(result.otherPickup, false);
  assert.equal(count(p, 'feud_camel_receipt'), 2, 'only the actual buyer can recover the private drop');
  assert.equal(count(q, 'feud_camel_receipt'), 0, 'no foreign receipt was seeded or acquired');
  assert.equal(stage(p), 4, 'transfers cannot replace the buyer hand-ins');
  assert.equal(stage(q), 2, 'failed transfers do not advance the other account');
  assert.equal(gangMask(q), 0);
  assert.equal(read(q, 'feud_var_talk_gangs'), 0);
});

test('shop, duel, death and telegrab cannot transfer the buyer camel receipts', () => {
  const p = player(), q = player(); begin(p); drink(p);
  talk(p, 'feud_egyptian_doorman_multi');
  talk(p, 'feud_arabian_guard_multi');
  buyReceipts(p);
  begin(q); drink(q);
  assert.deepEqual(receiptOtherRoutes(p, q, () => operate(p, actors('feud_marketseller')[0], 3)),
    { shop: false, duelStake: false, npcDeath: false, pvpDeath: false, telegrab: false });
  assert.equal(stage(p), 4);
  assert.equal(stage(q), 2);
});

test('lost purchase-state camel receipts are replaced free without another sale or progress write', () => {
  let p = player(); begin(p); drink(p);
  talk(p, 'feud_egyptian_doorman_multi');
  talk(p, 'feud_arabian_guard_multi');
  buyReceipts(p);
  const money = count(p, 'coins');
  assert.equal(types.ObjType.get(obj('feud_camel_receipt')).iop[4], 'Drop',
    'the original receipt can normally be lost through its visible Drop operation');
  assert.match(talk(p, 'feud_ali_the_discount_camel_seller', [1]).text, /trying to con me/);
  assert.equal(count(p, 'feud_camel_receipt'), 2, 'asking with both receipts produces no extra copy');
  // Banked receipts also suppress free replacement after a relog.
  const bank = id('InvType', 'bank'), receipt = obj('feud_camel_receipt');
  p.invDel(inv, receipt, 2);
  p.invAdd(bank, receipt, 2);
  p = relog(p);
  assert.equal(p.invTotal(bank, receipt), 2);
  assert.match(talk(p, 'feud_ali_the_discount_camel_seller', [1]).text, /trying to con me/);
  assert.equal(count(p, 'feud_camel_receipt'), 0);
  assert.equal(p.invTotal(bank, receipt), 2, 'the refusal preserves banked receipts');
  assert.equal(count(p, 'coins'), money);
  assert.equal(stage(p), 4);
  p.invDel(bank, receipt, 2);
  p.invAdd(inv, receipt, 2);


  // Own-inventory loss fixture; replacement itself uses the visible native Talk route.
  p.invDel(inv, obj('feud_camel_receipt'), 1);
  p = relog(p);
  assert.match(talk(p, 'feud_ali_the_discount_camel_seller', [1]).text, /No problem, There you go\./);
  assert.equal(count(p, 'feud_camel_receipt'), 2, 'one missing receipt is replaced');
  assert.equal(count(p, 'coins'), money);
  assert.equal(stage(p), 4);
  assert.equal(gangMask(p), 0, 'replacement never substitutes for a hand-in');

  p.invDel(inv, obj('feud_camel_receipt'), 2);
  p.invAdd(inv, obj('bucket_empty'), 27);
  const full = talk(p, 'feud_ali_the_discount_camel_seller', [1]);
  assert.match(full.text, /Come back to me when you're not so burdened\./);
  assert.equal(count(p, 'feud_camel_receipt'), 0, 'insufficient space cannot lose one replacement');
  assert.equal(count(p, 'coins'), money);
  assert.equal(stage(p), 4);
  p.invDel(inv, obj('bucket_empty'), 2);
  talk(p, 'feud_ali_the_discount_camel_seller', [1]);
  assert.equal(count(p, 'feud_camel_receipt'), 2, 'exactly enough space accepts both replacements');
  assert.equal(count(p, 'coins'), money, 'neither replacement route charges again');
  p.invDel(inv, obj('bucket_empty'), 25);
  deliver(p);
  const ordinary = talk(p, 'feud_ali_the_discount_camel_seller', ["I'm looking for Ali from Pollnivneach."]);
  assert.doesNotMatch(ordinary.text, /Not Sandy and Lumps!/);
  assert.doesNotMatch(ordinary.text, /About those camels\. I've lost the receipt/);
  assert.doesNotMatch(ordinary.text, /Would (?:500|1000) gold coins/);
  assert.equal(count(p, 'feud_camel_receipt'), 0, 'after both hand-ins the source menu no longer offers recovery');
  assert.equal(stage(p), 5);
});

test('the ordinary kebab service sells both sourced foods before the quest without changing progress', () => {
  const p = player();
  p.invAdd(inv, obj('coins'), 8);
  assert.match(talk(p, 'feud_kebabman', [1, 2]).text, /That will be three gold coins\./);
  assert.equal(count(p, 'kebab'), 1);
  assert.equal(count(p, 'coins'), 5);
  assert.match(talk(p, 'feud_kebabman', [2, 2]).text, /One super kebab coming up!/);
  assert.equal(count(p, 'super_kebab'), 1);
  assert.equal(count(p, 'coins'), 0);
  assert.equal(stage(p), 0, 'ordinary purchases do not start or advance The Feud');
});

test('kebab refusals and both non-sale conversations leave inventory and progress unchanged', () => {
  const p = player();
  p.invAdd(inv, obj('coins'), 2);
  for (const option of [1, 2]) {
    assert.match(talk(p, 'feud_kebabman', [option, 2]).text, /I seem to be short on coins\. Sorry\./);
    assert.equal(count(p, 'coins'), 2);
    assert.equal(count(p, 'kebab') + count(p, 'super_kebab'), 0);
  }
  assert.match(talk(p, 'feud_kebabman', [5, 2]).text, /gossip I am not/);
  assert.match(talk(p, 'feud_kebabman', [4, 4]).text, /You should have told me you were from the union/);
  assert.equal(stage(p), 0);
  assert.equal(count(p, 'coins'), 2);
});

test('free reusable sauce is capacity-safe and unavailable while another bottle is held or banked', () => {
  let p = player();
  p.invAdd(inv, obj('bucket_empty'), 28);
  assert.match(talk(p, 'feud_kebabman', [3, 2]).text, /I'm a bit overburdened as it is/);
  assert.equal(count(p, 'superhot_kebab_sauce'), 0);
  p.invDel(inv, obj('bucket_empty'), 1);
  assert.match(talk(p, 'feud_kebabman', [3, 2]).text, /potent enough to give a camel the runs/);
  assert.equal(count(p, 'superhot_kebab_sauce'), 1, 'exactly one free slot receives the bottle');
  assert.equal(stage(p), 0, 'the supported ordinary service has no invented Feud-stage gate');
  assert.match(talk(p, 'feud_kebabman', [3, 3]).text, /Kebab construction is a cut-throat industry/);
  assert.equal(count(p, 'superhot_kebab_sauce'), 1, 'the unavailable sauce choice is not offered with a bottle held');
  p.invDel(inv, obj('superhot_kebab_sauce'), 1);
  p.invAdd(id('InvType', 'bank'), obj('superhot_kebab_sauce'), 1);
  p = relog(p);
  assert.match(talk(p, 'feud_kebabman', [4, 2]).text, /gossip I am not/);
  assert.equal(count(p, 'superhot_kebab_sauce'), 0, 'a banked bottle also excludes the sauce choice');
  assert.equal(p.invTotal(id('InvType', 'bank'), obj('superhot_kebab_sauce')), 1);
  assert.equal(stage(p), 0);
});
sealLifecycle();
