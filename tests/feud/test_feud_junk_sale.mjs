import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lifecycleTest as test, sealLifecycle } from './completion.mjs';
import {
  ScriptProvider, contentRoot, count, engineModule, id, inv, inventory, obj, startDialogue
} from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';
import { actors, bit, finish, operate, stage, talk } from './fixture.mjs';

const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const CloseModal = (await engineModule('network/game/client/model/CloseModal.ts')).default;
const closeHandler = new (await engineModule('network/game/client/handler/CloseModalHandler.ts')).default();
const { ScriptOpcode } = await engineModule('engine/script/ScriptOpcode.ts');
const junk = ['bronze_pickaxe', 'bucket_empty', 'knife', 'raw_chicken', 'tinderbox'];
const message = 'Despite your best efforts Ali M still manages to sell you some junk.';
const shopRoot = id('Component', 'shop_template');

function open(p) {
  const money = count(p, 'coins'), before = inventory(p), messages = p.messages.length;
  talk(p, 'feud_ali_m', stage(p) === 0 ? [2] : stage(p) < 28 ? [2] : []);
  assert.equal(p.modalMain, shopRoot, 'real Morrisane dialogue opens basic stock');
  assert.deepEqual(inventory(p), before, 'viewing stock alone transfers nothing');
  assert.equal(count(p, 'coins'), money);
  assert(!p.messages.slice(messages).includes(message));
}
function close(p) {
  assert(closeHandler.handle(new CloseModal(), p), 'native close packet is accepted');
  assert.equal(p.modalMain, shopRoot, 'the native request is deferred to player queues');
  p.processQueues();
  assert.equal(p.modalMain, -1, 'the native close request leaves the shop closed');
  assert.equal(p.activeScript, null, 'closing the shop never suspends a script');
  assert.equal([...p.queue.all()].length, 0, 'closing the shop schedules no queue work');
  assert.equal([...p.weakQueue.all()].length, 0);
  assert.equal([...p.engineQueue.all()].length, 0);
}
function totalJunk(p) { return junk.reduce((total, name) => total + count(p, name), 0); }
function refuse(p, choices = [1, 2, 1, 1]) {
  talk(p, 'feud_ali_m', choices);
  assert.equal(p.modalMain, -1, 'refusing wares does not open stock');
  assert.equal(p.activeScript, null, 'the game message is not a dialogue page');
  assert.equal([...p.queue.all()].length, 0, 'the sale schedules no continuation');
  assert.equal([...p.weakQueue.all()].length, 0);
  assert.equal([...p.engineQueue.all()].length, 0);
}

// Independent java.util.Random arithmetic, not the production JavaRandom implementation.
function firstBucket(seed) {
  let state = (BigInt(seed) ^ 0x5deece66dn) & ((1n << 48n) - 1n);
  const next = bits => {
    state = (state * 0x5deece66dn + 11n) & ((1n << 48n) - 1n);
    return Number(state >> BigInt(48 - bits));
  };
  return Math.floor(((next(26) * 0x8000000 + next(27)) / 0x20000000000000) * 5);
}

test('every eligible final wares refusal charges ten and uses the fixed-seed five-way roll', () => {
  const p = player(), seen = new Set();
  const seedBase = 0x3771120; // UNKNOWN fixture seed, not a gameplay parameter.
  for (let sample = 0; sample < 40; sample++) {
    for (const entry of [...p.getInventory(inv).items]) if (entry) p.invDel(inv, entry.id, entry.count);
    p.invAdd(inv, obj('coins'), 20);
    const seed = seedBase + sample * 0x9e3779;
    JavaRandom.setSeed(seed);
    const expected = junk[firstBucket(seed)], beforeMessages = p.messages.length;
    refuse(p);
    assert.equal(count(p, 'coins'), 10, 'one final refusal charges exactly the engineering price');
    assert.equal(totalJunk(p), 1, 'one random item is received');
    assert.equal(count(p, expected), 1, `fixed seed ${seed} selects ${expected}`);
    assert.deepEqual(p.messages.slice(beforeMessages), [message]);
    assert.equal(stage(p), 0, 'declining the errand does not start the quest');
    seen.add(expected);
    p.closeModal();
    assert.equal(count(p, 'coins'), 10, 'closing after the message cannot sell again');
  }
  assert.deepEqual([...seen].sort(), [...junk].sort(), 'the deterministic sequence exercises every sourced item');
  console.log(`Morrisane fixed seeds: base=${seedBase}, samples=40, all five equal-width outcomes checked`);
});

test('eligibility is checked at the final refusal without spending the final coin slot as free space', () => {
  for (const money of [0, 9, 10, 11]) for (const full of [false, true]) {
    const p = player();
    if (money) p.invAdd(inv, obj('coins'), money);
    if (full) p.invAdd(inv, obj('knife'), money ? 27 : 28);
    const before = inventory(p), messages = p.messages.length;
    refuse(p);
    if (money < 10 || full) {
      assert.deepEqual(inventory(p), before, `${money} coins, full=${full}: no transfer`);
      assert.deepEqual(p.messages.slice(messages), [], 'no invented refusal message');
    } else {
      assert.equal(count(p, 'coins'), money - 10);
      assert.equal(totalJunk(p), 1);
      assert.deepEqual(p.messages.slice(messages), [message]);
    }
  }
  const p = player();
  p.invAdd(inv, obj('coins'), 10);
  startDialogue('[label,feud_ali_m_wares]', p, actors('feud_ali_m')[0]);
  p.invDel(inv, obj('coins'), 1);
  const before = inventory(p); finish(p, [1]);
  assert.deepEqual(inventory(p), before, 'spending below ten before the final answer prevents a sale');
  p.invAdd(inv, obj('coins'), 1);
  p.invAdd(inv, obj('knife'), 27);
  startDialogue('[label,feud_ali_m_wares]', p, actors('feud_ali_m')[0]);
  p.invDel(inv, obj('knife'), 1);
  finish(p, [1]);
  assert.equal(count(p, 'coins'), 0, 'freeing a slot before the final answer permits the transaction');
  assert.equal(totalJunk(p), 27);
});

test('a price above the threshold requires the whole charge before giving junk', () => {
  const sale = ScriptProvider.getByName('[proc,feud_morrisane_junk_sale]');
  assert(sale);
  const lines = readFileSync(`${contentRoot}/scripts/quests/quest_feud/scripts/feud_morrisane_junk.rs2`, 'utf8').split('\n');
  const operands = sale.intOperands;
  // Vary only this compiled constant's loads, identified by current source/debug
  // lines rather than stored bytecode offsets. The real NPC refusal still runs.
  sale.intOperands = [...operands];
  let priceLoads = 0;
  for (let pc = 0; pc < sale.opcodes.length; pc++) {
    if (sale.opcodes[pc] === ScriptOpcode.PUSH_CONSTANT_INT && operands[pc] === 10 &&
        lines[sale.lineNumber(pc) - 1]?.includes('^feud_junk_price')) {
      sale.intOperands[pc] = 11; // UNKNOWN regression fixture, not the product price.
      priceLoads++;
    }
  }
  try {
    assert(priceLoads > 0, 'the fixture varies the compiled price, not the threshold');
    for (const money of [10, 11, 12]) {
      const p = player(); p.invAdd(inv, obj('coins'), money);
      const before = inventory(p), messages = p.messages.length;
      refuse(p);
      if (money < 11) {
        assert.deepEqual(inventory(p), before, 'meeting the threshold cannot permit an underpaid sale');
        assert.deepEqual(p.messages.slice(messages), []);
      } else {
        assert.equal(count(p, 'coins'), money - 11);
        assert.equal(totalJunk(p), 1);
        assert.deepEqual(p.messages.slice(messages), [message]);
      }
    }
  } finally {
    sale.intOperands = operands;
  }
});

test('shop viewing, ordinary closes and interruption before the final answer do not sell junk', () => {
  const p = player(); p.invAdd(inv, obj('coins'), 100);
  const before = inventory(p);
  open(p); close(p);
  assert.deepEqual(inventory(p), before, 'viewing and closing basic stock is free');
  open(p); p.clearPendingAction();
  assert.deepEqual(inventory(p), before, 'an interrupted stock view is free');
  startDialogue('[label,feud_ali_m_wares]', p, actors('feud_ali_m')[0]);
  p.clearPendingAction();
  assert.deepEqual(inventory(p), before, 'interruption before the final answer cannot trigger the sale');
  operate(p, actors('feud_marketseller')[0], 3); close(p);
  assert.deepEqual(inventory(p), before, 'unrelated shops remain unchanged');
  assert(!p.messages.includes(message));
});

test('both opening refusals, acceptance and active repeat reach the shared final refusal', () => {
  for (const [choices, expectedStage] of [
    [[1, 1, 1], 0], [[1, 2, 1, 1], 0], [[1, 2, 2, 1], 1]
  ]) {
    const p = player(); p.invAdd(inv, obj('coins'), 20);
    refuse(p, choices);
    assert.equal(stage(p), expectedStage);
    assert.equal(count(p, 'coins'), 10);
    assert.equal(totalJunk(p), 1);
  }
  const p = player(); p.invAdd(inv, obj('coins'), 30);
  p.setVarBit(bit('feud_var'), 1); // Disclosed active-branch fixture, not earned quest proof.
  refuse(p, [1]); refuse(p, [1]);
  assert.equal(stage(p), 1, 'repeat sales do not advance the quest');
  assert.equal(count(p, 'coins'), 10, 'each active final refusal can sell once');
  assert.equal(totalJunk(p), 2);
  p.setVarBit(bit('feud_var'), 28); // Disclosed completed-repeat fixture.
  const before = inventory(p); open(p); close(p);
  assert.deepEqual(inventory(p), before, 'completed repeat opens stock, not the final-refusal branch');
});

sealLifecycle();
