import assert from 'node:assert/strict';
import { lifecycleTest as test, sealLifecycle } from './completion.mjs';
import {
  Packet, PlayerLoading, World, count, engineModule, execute, id, inv, inventory, obj
} from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';
import { actors, bit, operate, stage, talk, worldTick } from './fixture.mjs';

const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const CloseModal = (await engineModule('network/game/client/model/CloseModal.ts')).default;
const closeHandler = new (await engineModule('network/game/client/handler/CloseModalHandler.ts')).default();
const rsbuf = await engineModule('network/rsbuf/index.ts');
const junk = ['bronze_pickaxe', 'bucket_empty', 'knife', 'raw_chicken', 'tinderbox'];
const message = 'Despite your best efforts Ali Morrisane, the greatest salesman in the world, still manages to sell you some junk.';
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
  assert.equal(p.modalMain, -1, 'the close callback leaves the shop closed');
  assert.equal(p.activeScript, null, 'the callback never suspends a script');
  assert.equal([...p.queue.all()].length, 0, 'the callback schedules no queue work');
  assert.equal([...p.weakQueue.all()].length, 0);
  assert.equal([...p.engineQueue.all()].length, 0);
}
function totalJunk(p) { return junk.reduce((total, name) => total + count(p, name), 0); }

// Independent java.util.Random arithmetic, not the production JavaRandom implementation.
function firstBucket(seed) {
  let state = (BigInt(seed) ^ 0x5deece66dn) & ((1n << 48n) - 1n);
  const next = bits => {
    state = (state * 0x5deece66dn + 11n) & ((1n << 48n) - 1n);
    return Number(state >> BigInt(48 - bits));
  };
  return Math.floor(((next(26) * 0x8000000 + next(27)) / 0x20000000000000) * 5);
}

test('every eligible basic-stock close charges ten and uses the fixed-seed five-way roll', () => {
  const p = player(), seen = new Set();
  const seedBase = 0x3771120; // UNKNOWN fixture seed, not a gameplay parameter.
  for (let sample = 0; sample < 40; sample++) {
    for (const entry of [...p.getInventory(inv).items]) if (entry) p.invDel(inv, entry.id, entry.count);
    p.invAdd(inv, obj('coins'), 20);
    open(p);
    const seed = seedBase + sample * 0x9e3779;
    JavaRandom.setSeed(seed);
    const expected = junk[firstBucket(seed)], beforeMessages = p.messages.length;
    close(p);
    assert.equal(count(p, 'coins'), 10, 'one close charges exactly the engineering price');
    assert.equal(totalJunk(p), 1, 'one random item is received');
    assert.equal(count(p, expected), 1, `fixed seed ${seed} selects ${expected}`);
    assert.deepEqual(p.messages.slice(beforeMessages), [message]);
    assert.equal(stage(p), 0, 'the sale does not start the quest');
    seen.add(expected);
    p.closeModal();
    assert.equal(count(p, 'coins'), 10, 'closing an already closed modal cannot sell again');
  }
  assert.deepEqual([...seen].sort(), [...junk].sort(), 'the deterministic sequence exercises every sourced item');
  console.log(`Morrisane fixed seeds: base=${seedBase}, samples=40, all five equal-width outcomes checked`);
});

test('eligibility is checked at close and never spends the final coin slot as free space', () => {
  for (const money of [0, 9, 10, 11]) for (const full of [false, true]) {
    const p = player();
    if (money) p.invAdd(inv, obj('coins'), money);
    if (full) p.invAdd(inv, obj('knife'), money ? 27 : 28);
    open(p);
    const before = inventory(p), messages = p.messages.length;
    close(p);
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
  p.invAdd(inv, obj('coins'), 10); open(p);
  p.invDel(inv, obj('coins'), 1);
  const before = inventory(p); close(p);
  assert.deepEqual(inventory(p), before, 'spending below ten while viewing stock prevents a sale');
  p.invAdd(inv, obj('coins'), 1); open(p);
  p.invAdd(inv, obj('knife'), 27);
  const full = inventory(p); close(p);
  assert.deepEqual(inventory(p), full, 'filling the last slot while viewing stock prevents a sale');
  open(p); p.invDel(inv, obj('knife'), 1); close(p);
  assert.equal(count(p, 'coins'), 0, 'freeing a slot before close permits the transaction');
  assert.equal(totalJunk(p), 27);
});

test('refusal, another shop and other interface closes cannot invoke Morrisane sales', () => {
  const p = player(); p.invAdd(inv, obj('coins'), 100);
  const before = inventory(p);
  talk(p, 'feud_ali_m', [1, 1, 1]);
  assert.deepEqual(inventory(p), before, 'declining without viewing stock is free');
  assert(!p.messages.includes(message));
  operate(p, actors('feud_marketseller')[0], 3);
  close(p);
  assert.deepEqual(inventory(p), before, 'the shared shop close keeps unrelated shops unchanged');
  assert(!p.messages.includes(message));
});

test('repeat and completed-quest shop visits each sell once, with no saved one-time flag', () => {
  const p = player(); p.invAdd(inv, obj('coins'), 30);
  for (const checkpoint of [0, 1, 28]) {
    p.setVarBit(bit('feud_var'), checkpoint); // Disclosed branch fixture, not earned quest proof.
    open(p); close(p);
    assert.equal(stage(p), checkpoint);
  }
  assert.equal(count(p, 'coins'), 0);
  assert.equal(totalJunk(p), 3);
  assert.equal(p.messages.filter(text => text === message).length, 3);
});

test('an interrupting interface closes stock atomically without reopening or requeueing', () => {
  const p = player(); p.invAdd(inv, obj('coins'), 20); open(p);
  p.clearPendingAction(); // The native interruption path closes the old modal before its next action.
  execute('[proc,openshop]', p, [id('InvType', 'pollnivneach_generalstore'), 550, 1000, 10, 'Other shop']);
  assert.equal(p.modalMain, shopRoot, 'the requested replacement interface remains open');
  assert.equal(p.getVar(id('VarPlayerType', 'shop')), id('InvType', 'pollnivneach_generalstore'));
  assert.equal(count(p, 'coins'), 10, 'the interrupted Morrisane stock completes its single charge');
  assert.equal(totalJunk(p), 1);
  close(p);
  assert.equal(count(p, 'coins'), 10, 'the other shop close is not another Morrisane transaction');
});

test('native logout closes stock before saving both charge and item without a stall', () => {
  for (const money of [9, 10, 20]) {
    const p = player(); p.invAdd(inv, obj('coins'), money); open(p);
    const username = p.username;
    rsbuf.addPlayer(p.slot);
    p.requestLogout = true;
    p.lastResponse = p.lastConnected = World.currentTick;
    assert(World.currentTick >= p.preventLogoutUntil);
    worldTick();
    assert(![...World.playerLoop.all()].includes(p), 'logout finishes in its native processing cycle');
    assert.equal(p.activeScript, null);
    assert.equal([...p.queue.all()].length, 0);
    assert.equal([...p.engineQueue.all()].length, 0);
    const request = World.logoutRequests.get(username);
    assert(request?.save, 'native logout supplies the real save bytes');
    const loaded = PlayerLoading.load(username, new Packet(request.save), null);
    World.logoutRequests.delete(username); // Persistence acknowledgement in this transport-free fixture.
    assert.equal(count(loaded, 'coins'), money >= 10 ? money - 10 : money);
    assert.equal(totalJunk(loaded), money >= 10 ? 1 : 0, 'saved inventory contains both sides or neither');
    assert.equal(loaded.modalMain, -1, 'no modal or pending sale survives logout');
  }
});

sealLifecycle();
