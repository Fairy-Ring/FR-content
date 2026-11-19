import assert from 'node:assert/strict';
import test from 'node:test';

import {
  World, count, engineModule, id, inv, obj, types
} from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';
import {
  actors, bit, locs, operate, operateLoc, read, relog, stage, talk
} from './fixture.mjs';

const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const set = (p, name, value) => p.setVarBit(bit(name), value);
const bowl = () => locs('feud_money_bowl')[0];
const trough = () => locs('feud_foodtrough')[0];
const table = () => locs('feud_poison_beer_table')[0];

function withDraw(value, action) {
  const original = JavaRandom.nextDouble;
  JavaRandom.nextDouble = () => value;
  try {
    return action();
  } finally {
    JavaRandom.nextDouble = original;
  }
}

function dungPlacement(base, name) {
  return { ...base, name, type: id('LocType', name), shape: 22, angle: 0 };
}

function placedAt(base, name) {
  return World.getLoc(base.x, base.z, base.level, id('LocType', name));
}

test('the snake-charmer charges one coin and only supplies kit items that fit', () => {
  const moneyPot = bowl();
  const fresh = player();
  fresh.invAdd(inv, obj('coins'), 1);
  operateLoc(fresh, moneyPot, { item: 'coins' });
  assert.equal(count(fresh, 'coins'), 0, 'the candidate one-coin pot cost is paid');
  assert.equal(count(fresh, 'snake_flute'), 1);
  assert.equal(count(fresh, 'basket_for_snake'), 1);

  const partial = player();
  partial.invAdd(inv, obj('coins'), 1);
  partial.invAdd(inv, obj('snake_flute'), 1);
  operateLoc(partial, moneyPot, { item: 'coins' });
  assert.equal(count(partial, 'coins'), 0);
  assert.equal(count(partial, 'snake_flute'), 1);
  assert.equal(count(partial, 'basket_for_snake'), 1, 'one missing kit item needs one slot');

  const complete = player();
  complete.invAdd(inv, obj('coins'), 2);
  complete.invAdd(inv, obj('bucket_empty'), 25);
  complete.invAdd(inv, obj('snake_flute'), 1);
  complete.invAdd(inv, obj('basket_for_snake'), 1);
  const noNewKit = operateLoc(complete, moneyPot, { item: 'coins' });
  assert.match(noNewKit.text, /You have your own snake charming flute/);
  assert.equal(count(complete, 'coins'), 1, 'one coin is spent even when the kit is already held');
  assert.equal(count(complete, 'snake_flute'), 1);
  assert.equal(count(complete, 'basket_for_snake'), 1);

  const cramped = player();
  cramped.invAdd(inv, obj('coins'), 1);
  cramped.invAdd(inv, obj('bucket_empty'), 27);
  const refusal = operateLoc(cramped, moneyPot, { item: 'coins' });
  assert.match(refusal.text, /clearly over burdened/);
  assert.equal(count(cramped, 'coins'), 0);
  assert.equal(count(cramped, 'snake_flute'), 0);
  assert.equal(count(cramped, 'basket_for_snake'), 0, 'one free slot cannot hold the two-item kit');
});

test('Feud poison preparation advances through snake, dung, Hag recovery, and the reported drink', () => {
  let p = player();
  set(p, 'feud_var', 17);
  set(p, 'feud_found_trait', 1);
  const poison = types.ObjType.get(obj('poison_from_hag'));
  assert.equal(poison.cost, 1, 'the original value is unchanged');
  assert.equal(poison.tradeable, false, 'the candidate untradeable rule prevents a repeat-recovery trade farm');

  talk(p, 'feud_hag');
  assert.equal(read(p, 'feud_hag_list'), 1, 'the first Hag talk uses the original list bit');
  const noSnake = talk(p, 'feud_hag');
  assert.match(noSnake.text, /Have you got a snake yet/);
  assert.equal(stage(p), 17);

  p.invAdd(inv, obj('coins'), 1);
  operateLoc(p, bowl(), { item: 'coins' });
  assert.equal(count(p, 'snake_flute'), 1);
  assert.equal(count(p, 'basket_for_snake'), 1);
  operate(p, actors('feud_desert_snake')[0], 1, [], 'snake_flute');
  assert.equal(count(p, 'basket_for_snake'), 0);
  assert.equal(count(p, 'basket_with_snake'), 1);
  talk(p, 'feud_hag');
  assert.equal(stage(p), 18);
  assert.equal(read(p, 'feud_hag_list'), 2);

  talk(p, 'feud_kebabman', [3, 2]);
  assert.equal(count(p, 'superhot_kebab_sauce'), 1, 'the native Kebab seller talk grants the reusable sauce');
  const originalTrough = trough();
  p.invAdd(inv, obj('bucket_empty'), 1);

  withDraw(0.079, () => operateLoc(p, originalTrough, { item: 'superhot_kebab_sauce' }));
  const green = dungPlacement(originalTrough, 'feud_ugthanki_pooh_poisoned');
  const brown = dungPlacement(originalTrough, 'feud_ugthanki_pooh');
  assert(placedAt(originalTrough, green.name), 'the lower-probability green dung uses the existing poisoned form');
  assert(!placedAt(originalTrough, brown.name));

  let from = p.messages.length;
  withDraw(0.079, () => operateLoc(p, green));
  assert.match(p.messages.slice(from).join(' '), /You're kidding me! I'm not picking that up/);
  const greenBucketUse = withDraw(0.079, () => operateLoc(p, green, { item: 'bucket_empty' }));
  assert.match(greenBucketUse.text, /I'm not going near that - it's just far too stinky/);
  assert.equal(count(p, 'bucket_empty'), 1, 'green dung cannot be collected with a bucket');

  withDraw(0.08, () => operateLoc(p, originalTrough, { item: 'superhot_kebab_sauce' }));
  assert(!placedAt(originalTrough, green.name), 'using sauce again replaces the green dung');
  assert(placedAt(originalTrough, brown.name), 'the complementary 92% result is brown dung');
  from = p.messages.length;
  withDraw(0.079, () => operateLoc(p, brown));
  assert.match(p.messages.slice(from).join(' '), /You're kidding me! I'm not picking that up/);
  from = p.messages.length;
  operateLoc(p, brown, { item: 'bucket_empty' });
  assert.match(p.messages.slice(from).join(' '), /You scoop up some camel dung into the bucket/);
  assert.equal(count(p, 'bucket_empty'), 0);
  assert.equal(count(p, 'feud_camel_pooh_bucket'), 1);
  assert(!placedAt(originalTrough, brown.name), 'collecting brown dung removes the temporary loc');

  talk(p, 'feud_hag');
  assert.equal(stage(p), 22);
  assert.equal(read(p, 'feud_hag_list'), 2);
  assert.equal(count(p, 'feud_camel_pooh_bucket'), 0);
  assert.equal(count(p, 'poison_from_hag'), 1);

  const greedy = talk(p, 'feud_hag');
  assert.match(greedy.text, /being greedy and wanted another batch/);
  const bank = id('InvType', 'bank');
  p.invDel(inv, obj('poison_from_hag'), 1);
  p.invAdd(bank, obj('poison_from_hag'), 1);
  const banked = talk(p, 'feud_hag');
  assert.match(banked.text, /being greedy and wanted another batch/);
  assert.equal(count(p, 'poison_from_hag'), 0, 'a banked vial cannot be duplicated');
  assert.equal(p.invTotal(bank, obj('poison_from_hag')), 1);
  p.invDel(bank, obj('poison_from_hag'), 1);
  for (let loss = 1; loss <= 2; loss++) {
    if (loss === 2) p.invDel(inv, obj('poison_from_hag'), 1);
    const coinsBefore = count(p, 'coins');
    const recovery = talk(p, 'feud_hag');
    assert.match(recovery.text, /I lost the first batch/);
    assert.match(recovery.text, /give you another batch this once/);
    assert.equal(count(p, 'poison_from_hag'), 1, `loss ${loss} cannot strand stage 22`);
    assert.equal(count(p, 'coins'), coinsBefore, 'the transcript gives the replacement free');
    assert.equal(count(p, 'feud_camel_pooh_bucket'), 0, 'replacement requires no fresh ingredients');
    assert.equal(read(p, 'feud_hag_list'), 2, 'no unsourced one-time marker is written');
    assert.equal(stage(p), 22);
  }

  const beerTable = table();
  from = p.messages.length;
  operateLoc(p, beerTable, { item: 'poison_from_hag' });
  assert.equal(p.messages.length, from, 'table use is blocked until the source-named Barman report bit is set');
  assert.equal(stage(p), 22);
  assert.equal(count(p, 'poison_from_hag'), 1);
  const barmanReport = talk(p, 'feud_ali_the_barman', [3, 1]);
  assert.match(barmanReport.text, /His drink is over there on the table/);
  assert.equal(read(p, 'feud_var_drink_found'), 1, 'the native Barman conversation identifies the drink');
  from = p.messages.length;
  operateLoc(p, beerTable, { item: 'poison_from_hag' });
  assert.match(p.messages.slice(from).join(' '), /You poison the drink/);
  assert.equal(stage(p), 23);
  assert.equal(read(p, 'feud_boss_vis'), 1);
  assert.equal(count(p, 'poison_from_hag'), 0);

  p = relog(p);
  assert.equal(stage(p), 23);
  assert.equal(read(p, 'feud_boss_vis'), 1);
  assert.equal(read(p, 'feud_var_drink_found'), 1);
  p.invAdd(inv, obj('poison_from_hag'), 1);
  const alreadyPoisoned = operateLoc(p, beerTable, { item: 'poison_from_hag' });
  assert.match(alreadyPoisoned.text, /I've poisoned the drink\. I'd better leave it alone now/);
  assert.equal(count(p, 'poison_from_hag'), 1, 'later item use does not consume another vial');
});
