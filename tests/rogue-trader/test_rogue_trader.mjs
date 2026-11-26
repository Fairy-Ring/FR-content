import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PlayerStat, button, count, engineModule, execute, id, inv, invButton, inventory, obj, types
} from '../swamp-caves/runtime.mjs';
import { player } from '../feud/player.mjs';
import { actors, bit, finish, operate, operationStand, read, relog, stage, talk } from '../feud/fixture.mjs';

const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { getExpByLevel } = await engineModule('engine/entity/Player.ts');
const value = (p, name) => p.getVar(id('VarPlayerType', name));
const rt = (p, name) => read(p, `roguetrader_${name}`);
function stall(p, name) {
  const base = types.LocType.get(id('LocType', 'roguetrader_alim_multi_stall'));
  assert.equal(base.multivarbit, bit('roguetrader_stallvar'));
  assert.equal(base.multiloc[p.getVarBit(base.multivarbit)], id('LocType', name), 'the native transmitted selector chooses the expected original model');
}
const complete = () => {
  const p = player();
  p.stats.fill(getExpByLevel(99));
  p.setVarBit(bit('feud_var'), 28);
  p.setVar(id('VarPlayerType', 'runemysteries'), 6);
  p.setVarBit(bit('ics_little_var'), 26);
  p.invAdd(inv, obj('coins'), 100000);
  return p;
};
const ali = (p, choices) => talk(p, 'feud_ali_m', choices);
const seller = p => actors('feud_black_jack_seller_multi').find(n => n.startX === 3351 && n.startZ === 2971);
function random(values, action) {
  const previous = JavaRandom.nextDouble, rolls = [...values];
  JavaRandom.nextDouble = () => { assert(rolls.length, 'no unexpected success roll'); return rolls.shift(); };
  try { const result = action(); assert.equal(rolls.length, 0, 'each expected roll executes'); return result; }
  finally { JavaRandom.nextDouble = previous; }
}
function buy(p, name, expectedShop, expectedPrice, close = true) {
  assert.equal(p.modalMain, id('Component', 'shop_template'), 'real shop interface opens');
  assert.equal(value(p, 'shop'), id('InvType', expectedShop));
  const com = id('Component', 'shop_template:inv');
  const stock = p.getInventoryFromListener(p.invListeners.find(listener => listener.com === com));
  assert(stock, 'native shop listener supplies shared stock');
  const index = stock.getItemIndex(obj(name)); assert(index >= 0, `${name} is stocked`);
  const before = { count: count(p, name), coins: count(p, 'coins'), stock: stock.getItemCount(obj(name)) };
  const option = types.Component.get(com).iop.findIndex(text => /buy[^\d]*1\b/i.test(text ?? '')) + 1;
  assert(option > 0);
  assert(invButton(p, 'shop_template:inv', name, option, index), 'native inventory button accepts Buy 1');
  assert.equal(count(p, name), before.count + 1);
  assert.equal(stock.getItemCount(obj(name)), before.stock - 1);
  assert(count(p, 'coins') < before.coins, 'stock is purchased, not granted');
  if (expectedPrice !== undefined) assert.equal(before.coins - count(p, 'coins'), expectedPrice, `${name}: native Buy 1 charges the expected unit price`);
  if (close) p.closeModal();
}

test('pre-Feud Morrisane stays on the existing wares route and all unlocks remain gated', () => {
  const p = player(); p.invAdd(inv, obj('coins'), 100);
  ali(p, [2]);
  assert.equal(stage(p), 0); assert.equal(value(p, 'roguetrader_var'), 0);
  assert.equal(value(p, 'shop'), id('InvType', 'feud_morrisanes'));
  p.closeModal();
  execute('[proc,roguetrader_ali]', p);
  assert.equal(value(p, 'roguetrader_var'), 0);
  assert.equal(types.NpcType.get(id('NpcType', 'feud_ali_m')).op.filter(Boolean).join(','), 'Talk-to');
});

test('the post-Feud business request earns the existing half-price carpet fare', () => {
  const p = complete(), money = count(p, 'coins');
  assert.equal(execute('[proc,magic_carpet_fare]', p).popInt(), 200);
  ali(p, [2, 1]);
  assert.equal(rt(p, 'started'), 1); assert.equal(rt(p, 'cheapflights'), 1);
  assert.equal(execute('[proc,magic_carpet_fare]', p).popInt(), 100);
  assert.equal(count(p, 'coins'), money, 'agreeing does not charge an errand fee');
  ali(p, [1]); assert.equal(value(p, 'shop'), id('InvType', 'feud_morrisanes'));
  p.closeModal();
  const loaded = relog(p);
  assert.equal(rt(loaded, 'cheapflights'), 1, 'earned fare persists through the real save codec');
});

test('Siamun accepts only three matching unnoted supplies and both clothes shops remain purchasable', () => {
  const p = complete(); ali(p, [3]); assert.equal(rt(p, 'clothes'), 1);
  for (const name of ['reddye', 'yellowdye', 'bluedye']) p.invAdd(inv, obj(name), 1);
  const before = inventory(p);
  talk(p, 'ics_little_linen2', [1]);
  assert.deepEqual(inventory(p), before, 'period guide requires dyes of one colour, not three mixed colours');
  p.invAdd(inv, obj('cert_cow_hide'), 3);
  talk(p, 'ics_little_linen2', [2]);
  assert.equal(rt(p, 'clothes'), 1, 'bank notes do not satisfy pelts');
  p.invAdd(inv, obj('village_snake_skin'), 3);
  const withSnakeskin = inventory(p);
  talk(p, 'ics_little_linen2', [2]);
  assert.deepEqual(inventory(p), withSnakeskin, 'snakeskin is outside the retained period pelt list');
  assert.equal(rt(p, 'clothes'), 1);
  p.invAdd(inv, obj('cow_hide'), 3);
  talk(p, 'ics_little_linen2', [2]);
  assert.equal(count(p, 'cow_hide'), 0); assert.equal(count(p, 'cert_cow_hide'), 3);
  assert.equal(rt(p, 'clothes'), 3); assert.equal(rt(p, 'stallvar'), 3);
  stall(p, 'roguetrader_ali_m_stall_fez');
  ali(p, [3, 1]); buy(p, 'roguetrader_fez_hat', 'roguetrader_alim_carpetclothes_inv');
  ali(p, [3, 2]); assert.equal(rt(p, 'clothes'), 3, 'a new order never removes the earned stock');
  p.invAdd(inv, obj('reddye'), 2);
  talk(p, 'ics_little_linen2', [1]);
  assert.equal(count(p, 'reddye'), 0); assert.equal(count(p, 'yellowdye'), 1);
  assert.equal(rt(p, 'clothes'), 4); assert.equal(rt(p, 'stallvar'), 5);
  stall(p, 'roguetrader_ali_m_stall_clothes');
  ali(p, [3, 1]); buy(p, 'roguetrader_menaphite_hat', 'roguetrader_alim_meanpclothes_inv');
  p.invAdd(inv, obj('reddye'), 3);
  const after = inventory(p); talk(p, 'ics_little_linen2', [1]);
  assert.deepEqual(inventory(p), after, 'an unchanged style cannot consume another set');
  const loaded = relog(p); assert.equal(rt(loaded, 'clothes'), 4);
});

test('the cunning plan charges once and unlocks defensive blackjacks after reporting back', () => {
  let p = complete(); ali(p, [4]);
  assert.equal(rt(p, 'blackjacks'), 1);
  operate(p, seller(p), 1, [1]); assert.equal(rt(p, 'bjtold_ali'), 1);
  const money = count(p, 'coins');
  talk(p, 'feud_street_urchin', [2]); assert.equal(count(p, 'coins'), money);
  talk(p, 'feud_street_urchin', [1]);
  assert.equal(count(p, 'coins'), money - 100); assert.equal(rt(p, 'bj_urchingloat'), 1);
  p = relog(p);
  talk(p, 'feud_street_urchin'); assert.equal(count(p, 'coins'), money - 100, 'saved payment is not charged again');
  operate(p, seller(p), 1);
  assert.equal(rt(p, 'justchanged_weapons'), 2);
  ali(p, [4, 1]);
  assert.equal(rt(p, 'blackjacks'), 4); assert.equal(rt(p, 'stallvar'), 2);
  buy(p, 'roguetrader_bj_defend_oak', 'roguetrader_alim_defendbj_inv');
  stall(p, 'roguetrader_ali_m_stall_bjacks');
  random([0, 0], () => operate(p, seller(p), 1, [2]));
  assert.equal(rt(p, 'blackjacks'), 4, 'the earned shop remains until the new design is reported');
  ali(p, [4, 1]);
  assert.equal(rt(p, 'blackjacks'), 3, 'returning directly to the seller can switch designs');
  buy(p, 'roguetrader_bj_assault_willow', 'roguetrader_alim_assaultbj_inv');
});

test('the offensive challenge requires both Defence rolls and failure is retryable', () => {
  const p = complete(); p.levels[1] = 1; p.baseLevels[1] = 1;
  ali(p, [4]);
  const hp = p.levels[3];
  random([0.99, 0], () => operate(p, seller(p), 1, [2]));
  assert.equal(p.levels[3], hp - 3); assert.equal(rt(p, 'justchanged_weapons'), 0);
  random([0, 0.99, 0], () => operate(p, seller(p), 1, [2]));
  assert.equal(p.levels[3], hp - 6); assert.equal(rt(p, 'justchanged_weapons'), 0, 'passing the first hit is insufficient');
  random([0, 0], () => operate(p, seller(p), 1, [2]));
  assert.equal(rt(p, 'justchanged_weapons'), 1);
  ali(p, [4, 1]); assert.equal(rt(p, 'blackjacks'), 3);
  buy(p, 'roguetrader_bj_assault_oak', 'roguetrader_alim_assaultbj_inv');
  assert.equal(stage(p), 28, 'Rogue Trader never rewrites Feud progress');
});

test('Rune Mysteries gates the order and Aubury advances once without replacing his existing services', () => {
  const p = complete(); p.setVar(id('VarPlayerType', 'runemysteries'), 0);
  ali(p, [5]); assert.equal(rt(p, 'runes'), 0);
  p.setVar(id('VarPlayerType', 'runemysteries'), 6);
  ali(p, [5]); assert.equal(rt(p, 'runes'), 1);
  talk(p, 'aubury'); assert.equal(rt(p, 'runes'), 2);
  talk(p, 'aubury', [1]);
  assert.equal(value(p, 'shop'), types.NpcType.get(id('NpcType', 'aubury')).params.get(id('ParamType', 'owned_shop')));
  p.closeModal();
  ali(p, [5, 2, 1]); assert.equal(rt(p, 'runes'), 3, 'large casket force never unlocks the stock');
  assert.equal(rt(p, 'justobt_runes'), 0);
});

test('supplier agreement completes the errands even when no casket is solved', () => {
  const p = complete();
  p.setVarBit(bit('roguetrader_blackjacks'), 3);
  p.setVarBit(bit('roguetrader_clothes'), 3);
  p.setVarBit(bit('roguetrader_runes'), 2);
  ali(p, [5, 2, 1]);
  assert.equal(rt(p, 'runes'), 3);
  assert.equal(rt(p, 'started'), 2);
  assert.equal(rt(p, 'cheapflights'), 1);
  assert.equal(rt(p, 'justobt_runes'), 0);
  ali(p, [2, 2]);
  assert.equal(rt(p, 'started'), 2, 'repeating the introduction cannot downgrade completion');
  const loaded = relog(p);
  assert.equal(rt(loaded, 'runes'), 3);
  assert.equal(rt(loaded, 'started'), 2);
  assert.equal(execute('[proc,magic_carpet_fare]', loaded).popInt(), 100);
});

const runeOrder = () => {
  const p = complete();
  ali(p, [5]); talk(p, 'aubury');
  return p;
};
const elemental = ['firerune', 'waterrune', 'airrune', 'earthrune'];
const bulkPrice = () => Math.max(1, Math.trunc(elemental.reduce((price, name) => price + types.ObjType.get(obj(name)).cost * 20, 0) * 90 / 100));

test('forcing a small casket awards the two skill gains and unlocks stock without buying the offer', () => {
  const p = runeOrder(), before = [...p.stats];
  random([0, 0], () => ali(p, [5, 1, 1, 3]));
  assert.equal(p.stats[PlayerStat.STRENGTH] - before[PlayerStat.STRENGTH], 25);
  assert.equal(p.stats[PlayerStat.AGILITY] - before[PlayerStat.AGILITY], 25);
  assert.equal(rt(p, 'justobt_runes'), 1);
  assert(p.messages.some(message => message.includes('You hear the locking mechanism click open!')));
  ali(p, [5, 3, 1]);
  assert.equal(value(p, 'shop_haggle'), 0, 'period rune prices stay fixed while the shop is open');
  buy(p, 'airrune', 'roguetrader_alim_runeretail_inv');
  const loaded = relog(p);
  assert.equal(rt(loaded, 'justobt_runes'), 1);
});

test('picking a small casket works without a lockpick; a large one never opens by force or picking', () => {
  const p = runeOrder(), before = p.stats[PlayerStat.THIEVING];
  random([0], () => ali(p, [5, 1, 2, 3]));
  assert.equal(p.stats[PlayerStat.THIEVING] - before, 50);
  assert.equal(rt(p, 'justobt_runes'), 1);
  for (const method of [1, 2]) {
    const levels = [...p.levels];
    ali(p, [5, 2, method]);
    assert.equal(rt(p, 'runes'), 3, 'large stock requires the actual puzzle');
    const skills = method === 1 ? [PlayerStat.STRENGTH, PlayerStat.AGILITY] : [PlayerStat.THIEVING];
    for (const skill of skills) assert(p.levels[skill] >= levels[skill] - 3 && p.levels[skill] <= levels[skill]);
  }
});

test('failed small-casket attempts drain only the relevant skills and a broken lockpick gives only its failure experience', () => {
  const p = runeOrder(), levels = [...p.levels], before = [...p.stats];
  random([0.99, 0.5], () => ali(p, [5, 1, 1]));
  const drain = levels[PlayerStat.STRENGTH] - p.levels[PlayerStat.STRENGTH];
  assert(drain >= 0 && drain <= 3);
  assert.equal(levels[PlayerStat.AGILITY] - p.levels[PlayerStat.AGILITY], drain);
  assert.equal(rt(p, 'justobt_runes'), 0);
  assert.deepEqual([...p.stats], before, 'failed force awards no experience');
  p.invAdd(inv, obj('lockpick'), 1);
  random([0.99, 0, 0], () => ali(p, [5, 1, 2]));
  assert.equal(count(p, 'lockpick'), 0);
  assert.equal(p.stats[PlayerStat.THIEVING] - before[PlayerStat.THIEVING], 5);
  assert.equal(p.levels[PlayerStat.THIEVING], levels[PlayerStat.THIEVING], 'the zero drain roll does not drain another skill');
  assert.equal(rt(p, 'justobt_runes'), 0);
});

test('the unseen casket offer is an atomic whole-bundle purchase and insufficient money, space or stack capacity loses nothing', () => {
  for (const refusal of ['coins', 'space', 'stack']) {
    const p = runeOrder();
    if (refusal === 'coins') p.invDel(inv, obj('coins'), count(p, 'coins'));
    else if (refusal === 'space') p.invAdd(inv, obj('knife'), 27);
    else p.invAdd(inv, obj('airrune'), 2147483640);
    const before = inventory(p);
    random([0, 0], () => ali(p, [5, 1, 1, 1]));
    assert.deepEqual(inventory(p), before, refusal);
    assert.equal(rt(p, 'justobt_runes'), 1, 'a refused purchase does not revoke the earned unlock');
  }
  const p = runeOrder(), price = bulkPrice();
  p.invDel(inv, obj('coins'), count(p, 'coins') - price);
  p.invAdd(inv, obj('knife'), 24);
  random([0, 0], () => ali(p, [5, 1, 1, 1]));
  assert.equal(count(p, 'coins'), 0, 'the spent coin stack supplies the fourth new slot');
  for (const rune of elemental) assert.equal(count(p, rune), 20);
  assert.equal(p.invFreeSpace(inv), 0);
});

test('the inspected casket uses a private inventory, not another player or the permanent rune stock', () => {
  const first = runeOrder(), second = runeOrder();
  random([0, 0], () => ali(first, [5, 1, 1, 2]));
  random([0, 0], () => ali(second, [5, 1, 1, 2]));
  assert.equal(value(first, 'shop'), id('InvType', 'roguetrader_alim_runedump'));
  assert.equal(first.invTotal(id('InvType', 'roguetrader_alim_runedump'), obj('airrune')), 20);
  buy(first, 'airrune', 'roguetrader_alim_runedump');
  assert.equal(second.invTotal(id('InvType', 'roguetrader_alim_runedump'), obj('airrune')), 20);
  buy(second, 'waterrune', 'roguetrader_alim_runedump');
});

test('native suppliers and the carpet merchant have reachable packed-map operation stands', () => {
  const p = complete(), approaches = [];
  for (const name of ['feud_ali_m', 'ics_little_linen2', 'feud_black_jack_seller_multi', 'feud_street_urchin', 'aubury', 'magic_carpet_seller1']) {
    const candidates = actors(name);
    const npc = name === 'feud_black_jack_seller_multi' ? seller(p) : candidates.find(npc => operationStand(p, npc));
    assert(npc, `${name}: original placed target`);
    const stand = operationStand(p, npc);
    assert(stand, `${name}: nonblocked stand with a nonempty route from outside`);
    approaches.push({ name, stand: { level: stand[0], x: stand[1], z: stand[2] }, npc: { level: npc.level, x: npc.x, z: npc.z } });
  }
  console.log(`PACKED_APPROACHES ${JSON.stringify(approaches)}`);
});

test('Siamun refuses an unfinished prerequisite without consuming supplies', () => {
  const p = complete(); p.setVarBit(bit('ics_little_var'), 25);
  ali(p, [3]); p.invAdd(inv, obj('cow_hide'), 3);
  const before = inventory(p);
  talk(p, 'ics_little_linen2');
  assert.deepEqual(inventory(p), before);
  assert.equal(rt(p, 'clothes'), 1);
});

const puzzleRunes = large => (large
  ? ['naturerune', 'lawrune', 'chaosrune', 'deathrune', 'mindrune', 'bodyrune', 'bloodrune', 'cosmicrune', 'soulrune']
  : elemental).map(obj);
const puzzleRoot = large => large ? 'inter_295' : 'inter_296';
const boardInventory = () => id('InvType', 'roguetrader_toughsudukuinv');
const clueInventory = () => id('InvType', 'roguetrader_sudoku_clueinv');
function board(p, large) {
  const runes = puzzleRunes(large), size = large ? 81 : 16;
  return Array.from({ length: size }, (_, slot) => {
    const item = p.getInventory(boardInventory()).items[slot];
    if (!item) return 0;
    const value = runes.indexOf(item.id) + 1;
    assert(value > 0, 'the board contains only its own native rune set');
    return value;
  });
}
function openPuzzle(p, large) {
  ali(p, [5, large ? 2 : 1, 3]);
  assert.equal(p.modalMain, id('Component', puzzleRoot(large)));
  assert.equal(rt(p, 'playing_sudoku'), 1);
  return board(p, large);
}
function place(p, large, slot, value) {
  const root = puzzleRoot(large), selector = (large ? 121 : 57) + value;
  assert(button(p, `${root}:com_${selector}`), 'native rune selector accepted');
  assert(button(p, `${root}:com_${(large ? 11 : 20) + slot}`), 'native Place-rune button accepted');
}
function submit(p, large, choices = []) {
  assert(button(p, `${puzzleRoot(large)}:com_${large ? 9 : 41}`), 'native Open casket accepted');
  finish(p, choices);
}
function groups(board, side) {
  const box = Math.sqrt(side), rows = [], columns = [], boxes = [];
  for (let n = 0; n < side; n++) {
    rows.push(Array.from({ length: side }, (_, m) => board[n * side + m]));
    columns.push(Array.from({ length: side }, (_, m) => board[m * side + n]));
    boxes.push(Array.from({ length: side }, (_, m) => board[(Math.floor(n / box) * box + Math.floor(m / box)) * side + n % box * box + m % box]));
  }
  return { rows, columns, boxes };
}
const validUnits = units => units.every(unit => !unit.includes(0) && new Set(unit).size === unit.length);
function solveBoard(clues, side, boxes = true, requireBadBox = false) {
  const result = [...clues], box = Math.sqrt(side);
  function search() {
    let selected = -1, candidates;
    for (let slot = 0; slot < result.length; slot++) {
      if (result[slot]) continue;
      const row = Math.floor(slot / side), column = slot % side, allowed = [];
      for (let value = 1; value <= side; value++) {
        let valid = true;
        for (let n = 0; n < side; n++) {
          const inBox = (Math.floor(row / box) * box + Math.floor(n / box)) * side + Math.floor(column / box) * box + n % box;
          if (result[row * side + n] === value || result[n * side + column] === value || boxes && result[inBox] === value) { valid = false; break; }
        }
        if (valid) allowed.push(value);
      }
      if (!allowed.length) return false;
      if (selected < 0 || allowed.length < candidates.length) { selected = slot; candidates = allowed; }
    }
    if (selected < 0) return !requireBadBox || !validUnits(groups(result, side).boxes);
    for (const value of candidates) { result[selected] = value; if (search()) return true; }
    result[selected] = 0; return false;
  }
  assert(search(), 'independent constraint search finds the required board');
  return result;
}
function fillPuzzle(p, large, clues, values) {
  for (let slot = 0; slot < clues.length; slot++) if (!clues[slot]) place(p, large, slot, values[slot]);
  assert.deepEqual(board(p, large), values, 'all placements arrived through native cell handlers');
}

test('the native small board protects clues, permits correction, rejects invalid boards and resets through close/reopen', () => {
  const p = runeOrder();
  p.setVar(id('VarPlayerType', 'rogue_suduku1'), 0xa155);
  const clues = openPuzzle(p, false), mutable = clues.indexOf(0), fixed = clues.findIndex(Boolean);
  assert(mutable >= 0 && fixed >= 0, 'a playable puzzle has clues and empty cells');
  place(p, false, fixed, clues[fixed] % 4 + 1);
  assert.deepEqual(board(p, false), clues, 'an original clue is immutable');
  place(p, false, mutable, 1); assert.equal(board(p, false)[mutable], 1);
  place(p, false, mutable, 2); assert.equal(board(p, false)[mutable], 2, 'a placed mistake can be replaced');
  submit(p, false);
  assert.equal(rt(p, 'justobt_runes'), 0, 'an incomplete grid cannot unlock a shop');
  for (let slot = 0; slot < clues.length; slot++) if (!clues[slot]) place(p, false, slot, 1);
  submit(p, false);
  assert.equal(rt(p, 'justobt_runes'), 0, 'a full grid with duplicate runes is not a solution');
  assert.equal(p.modalMain, id('Component', 'inter_296'), 'an invalid attempt leaves the puzzle open');
  assert(button(p, 'inter_296:com_42'));
  assert.equal(p.modalMain, -1);
  assert.equal(rt(p, 'playing_sudoku'), 0);
  for (const which of [boardInventory(), clueInventory()]) assert(p.getInventory(which).items.every(item => !item), 'close tears down private puzzle items');
  assert.equal((value(p, 'rogue_suduku1') >>> 16) & 31, 0, 'close clears size and selection');
  assert.equal(value(p, 'rogue_suduku1') & 0xffff, 0xa155, 'all original low-bit fields survive');
  const fresh = openPuzzle(p, false);
  assert.notDeepEqual(fresh, clues, 'closing and reopening resets to a different puzzle');
  const solved = solveBoard(fresh, 4);
  fillPuzzle(p, false, fresh, solved); submit(p, false, [3]);
  assert.equal(rt(p, 'justobt_runes'), 1);
  assert.equal(rt(p, 'playing_sudoku'), 0);
  assert.equal(p.modalMain, -1);
  stall(p, 'roguetrader_ali_m_stall_casket');
  assert.equal(rt(relog(p), 'justobt_runes'), 1, 'solving survives logout without preserving a transient board');
});

test('the native large casket checks boxes as well as rows and columns, then unlocks non-elemental purchases', () => {
  const p = runeOrder(), clues = openPuzzle(p, true);
  const invalid = solveBoard(clues, 9, false, true), units = groups(invalid, 9);
  assert(validUnits(units.rows) && validUnits(units.columns) && !validUnits(units.boxes), 'box failure is isolated from row/column failure');
  fillPuzzle(p, true, clues, invalid); submit(p, true);
  assert.equal(rt(p, 'runes'), 3, 'a Latin square with an invalid box does not solve Sudoku');
  assert.equal(p.modalMain, id('Component', 'inter_295'));
  const solved = solveBoard(clues, 9);
  assert(Object.values(groups(solved, 9)).every(validUnits));
  fillPuzzle(p, true, clues, solved); submit(p, true, [3]);
  assert.equal(rt(p, 'runes'), 4);
  assert.equal(rt(p, 'playing_sudoku'), 0);
  stall(p, 'roguetrader_ali_m_stall_casketbig');
  const loaded = relog(p);
  assert.equal(rt(loaded, 'runes'), 4);
  ali(loaded, [5, 3, 2]);
  buy(loaded, 'naturerune', 'roguetrader_alim_runewholesale_inv');
});

test('simultaneous puzzles and selectors belong to their own player', () => {
  const first = runeOrder(), second = runeOrder();
  const firstClues = openPuzzle(first, false), secondClues = openPuzzle(second, true);
  const firstSlot = firstClues.indexOf(0), secondSlot = secondClues.indexOf(0);
  place(first, false, firstSlot, 2);
  assert.deepEqual(board(second, true), secondClues);
  place(second, true, secondSlot, 7);
  assert.equal(board(first, false)[firstSlot], 2);
  assert(button(first, 'inter_296:com_42'));
  assert.equal(board(second, true)[secondSlot], 7, 'closing one board cannot clear the other');
  assert.equal(rt(second, 'playing_sudoku'), 1);
  assert(button(second, 'inter_295:com_10'));
});

test('permanent rune shops and inspected caskets use the period 105 percent price bound, with the unchanged Cosmic exception', () => {
  const p = runeOrder();
  assert.equal(types.ObjType.get(obj('cosmicrune')).cost, 50, 'the cached Cosmic value is not changed to fit the guide anomaly');
  const smallPrices = elemental.map(name => [name, 4]);
  const largePrices = [
    ['naturerune', 189], ['lawrune', 252], ['chaosrune', 94], ['deathrune', 189],
    ['mindrune', 3], ['bodyrune', 3], ['bloodrune', 420], ['cosmicrune', 52], ['soulrune', 315]
  ];
  function checkPrices(stock, prices) {
    for (const [name, price] of prices) {
      assert.equal(Math.trunc(types.ObjType.get(obj(name)).cost * 105 / 100), price, `${name}: 105 percent of unchanged cache cost`);
      buy(p, name, stock, price, false);
    }
    p.closeModal();
  }
  random([0, 0], () => ali(p, [5, 1, 1, 2]));
  checkPrices('roguetrader_alim_runedump', smallPrices);
  ali(p, [5, 3, 1]);
  checkPrices('roguetrader_alim_runeretail_inv', smallPrices);
  const clues = openPuzzle(p, true);
  fillPuzzle(p, true, clues, solveBoard(clues, 9));
  submit(p, true, [2]);
  checkPrices('roguetrader_alim_runedump', largePrices);
  ali(p, [5, 3, 2]);
  checkPrices('roguetrader_alim_runewholesale_inv', largePrices);
});
