import assert from 'node:assert/strict';
import test from 'node:test';

import { World, count, id, inv, obj, types } from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';
import { stage, talk } from './fixture.mjs';

// CANDIDATE recipes and fee: retained Ali the Dyer article 218592 and ordinary
// transcript 14342931/14342948; these names are the original 377 cache items.
const recipes = [
  { option: 1, ingredient: 'redberries', quantity: 3, dye: 'reddye', missing: "You don't have enough berries to make the red dye." },
  { option: 2, ingredient: 'onion', quantity: 2, dye: 'yellowdye', missing: "You don't have enough onions to make the yellow dye." },
  { option: 3, ingredient: 'woadleaf', quantity: 2, dye: 'bluedye', missing: "You don't have enough woad leaves to make the blue dye." }
];
const customer = (questStage = 0) => {
  const p = player();
  p.invClear(inv);
  p.setVarBit(id('VarBitType', 'feud_var'), questStage);
  return p;
};
const make = (p, recipe) => talk(p, 'feud_dye_lady', [1, recipe.option, 1]);
const carried = p => p.getInventory(inv).items.filter(Boolean).length;

for (const questStage of [0, 1, 13, 28]) {
  test(`ordinary dye service exchanges all three recipes at Feud checkpoint ${questStage}`, () => {
    const p = customer(questStage);
    p.invAdd(inv, obj('coins'), 100);
    for (const recipe of recipes) {
      assert.notEqual(obj(recipe.dye), -1, 'the dye is a real packed original item');
      p.invAdd(inv, obj(recipe.ingredient), recipe.quantity);
      const money = count(p, 'coins');
      const result = make(p, recipe);
      assert.equal(result.trigger, '[opnpc1,feud_dye_lady]', 'normal Talk-to selects the compiled original NPC handler');
      assert.equal(count(p, 'coins'), money - 25);
      assert.equal(count(p, recipe.ingredient), 0);
      assert.equal(count(p, recipe.dye), 1);
      assert.equal(stage(p), questStage, 'ordinary dyeing never writes quest progress');
      assert.doesNotMatch(result.text, /Rana|Rogue Trader/, 'no later name or progression is imported');
    }
  });
}

for (const recipe of recipes) {
  test(`${recipe.dye} refuses missing ingredients before taking any payment`, () => {
    const p = customer();
    p.invAdd(inv, obj('coins'), 100);
    p.invAdd(inv, obj(recipe.ingredient), recipe.quantity - 1);
    const result = make(p, recipe);
    assert.match(result.text, new RegExp(recipe.missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(count(p, 'coins'), 100);
    assert.equal(count(p, recipe.ingredient), recipe.quantity - 1);
    assert.equal(count(p, recipe.dye), 0);
    assert.equal(stage(p), 0);
  });

  test(`${recipe.dye} refuses 24 coins without taking ingredients`, () => {
    const p = customer();
    p.invAdd(inv, obj('coins'), 24);
    p.invAdd(inv, obj(recipe.ingredient), recipe.quantity);
    assert.match(make(p, recipe).text, /You don't have enough coins to pay for the dye\./);
    assert.equal(count(p, 'coins'), 24);
    assert.equal(count(p, recipe.ingredient), recipe.quantity);
    assert.equal(count(p, recipe.dye), 0);
    assert.equal(stage(p), 0);
  });

  test(`full inventory still exchanges ${recipe.dye} when consumed ingredients free space`, () => {
    const p = customer();
    p.invAdd(inv, obj('coins'), 50);
    p.invAdd(inv, obj(recipe.ingredient), recipe.quantity);
    p.invAdd(inv, obj('bucket_empty'), 28 - carried(p));
    assert.equal(carried(p), 28);
    make(p, recipe);
    assert.equal(count(p, 'coins'), 25);
    assert.equal(count(p, recipe.ingredient), 0);
    assert.equal(count(p, recipe.dye), 1);
    assert.equal(stage(p), 0);
  });
}

test('a full blue-dye exchange uses ordinary owned floor overflow, not loss or silent refusal', () => {
  const p = customer(), recipe = recipes[2];
  assert.equal(types.ObjType.get(obj('woadleaf')).stackable, true, 'the original leaves share one inventory slot');
  p.invAdd(inv, obj('coins'), 50);
  p.invAdd(inv, obj('woadleaf'), 3);
  p.invAdd(inv, obj('bucket_empty'), 26);
  assert.equal(carried(p), 28);
  make(p, recipe);
  assert.equal(count(p, 'coins'), 25, 'normal sale proceeds');
  assert.equal(count(p, 'woadleaf'), 1);
  assert.equal(count(p, 'bluedye'), 0, 'both residual stacks keep the inventory full');
  const dropped = World.getObj(p.x, p.z, p.level, obj('bluedye'), p.hash64);
  assert(dropped, 'published INV_ADD places overflow at the customer\'s feet');
  assert.equal(dropped.count, 1, 'the paid dye is not discarded');
  const other = customer();
  assert(!World.getObj(p.x, p.z, p.level, obj('bluedye'), other.hash64), 'fresh overflow is owned by its customer');
  assert.equal(stage(p), 0);
});

test('exact payment frees its stack slot for blue dye even with surplus leaves and a full inventory', () => {
  const p = customer();
  p.invAdd(inv, obj('coins'), 25);
  p.invAdd(inv, obj('woadleaf'), 3);
  p.invAdd(inv, obj('bucket_empty'), 26);
  assert.equal(carried(p), 28);
  make(p, recipes[2]);
  assert.equal(count(p, 'coins'), 0);
  assert.equal(count(p, 'woadleaf'), 1);
  assert.equal(count(p, 'bluedye'), 1);
  assert.equal(stage(p), 0);
});

test('the complete ordinary conversation keeps its business, directions and decline branches', () => {
  const p = customer();
  p.invAdd(inv, obj('coins'), 100);
  const business = talk(p, 'feud_dye_lady', [2, 2]).text;
  assert.match(business, /mother was a drysalter/);
  assert.match(business, /it's someone who deals with preservatives and dyes/);
  assert.match(business, /It's a dyeing trade!/);
  assert.match(business, /No thanks, I'm just having a look around\./);
  assert.match(talk(p, 'feud_dye_lady', [2, 1, 4]).text, /On second thoughts, I don't think that I need some dye right now\./);
  for (const [index, location] of [[1, /woods south of Varrock/], [2, /farms near Draynor village/], [3, /gardener in Falador/]]) {
    assert.match(talk(p, 'feud_dye_lady', [1, index, 4]).text, location);
    assert.match(talk(p, 'feud_dye_lady', [1, index, 2]).text, /come back when you have them/);
    assert.match(talk(p, 'feud_dye_lady', [1, index, 3]).text, /only source of dye this side of the Shantay pass/);
  }
  assert.equal(count(p, 'coins'), 100, 'information and declining never charge');
  for (const recipe of recipes) assert.equal(count(p, recipe.dye), 0);
  assert.equal(stage(p), 0);
});
