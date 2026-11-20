import assert from 'node:assert/strict';
import {
  World, count, engineModule, execute, id, inv, invButton, obj, settle, slotOf, types
} from '../swamp-caves/runtime.mjs';
import { transferPair } from './tradeability.mjs';

const OpPlayer = (await engineModule('network/game/client/model/OpPlayer.ts')).default;
const playerAction = new (await engineModule('network/game/client/handler/OpPlayerHandler.ts')).default();
const OpObj = (await engineModule('network/game/client/model/OpObj.ts')).default;
const groundAction = new (await engineModule('network/game/client/handler/OpObjHandler.ts')).default();
const OpObjT = (await engineModule('network/game/client/model/OpObjT.ts')).default;
const groundSpell = new (await engineModule('network/game/client/handler/OpObjTHandler.ts')).default();
const CloseModal = (await engineModule('network/game/client/model/CloseModal.ts')).default;
const closeAction = new (await engineModule('network/game/client/handler/CloseModalHandler.ts')).default();
const Obj = (await engineModule('engine/entity/Obj.ts')).default;
const receipt = 'feud_camel_receipt';

function take(p, ground) {
  p.resetEntity(false);
  p.x = ground.x; p.z = ground.z; p.originX = p.x; p.originZ = p.z;
  assert(groundAction.handle(new OpObj(3, ground.x, ground.z, ground.type), p));
  p.processInteraction();
}

function reveal(ground) {
  if (ground.reveal === -1) return;
  for (let tick = 0; tick < Obj.REVEAL; tick++) {
    World.currentTick++;
    World.processZones();
  }
  assert(ground.isActive, 'the real death drop survives its complete reveal interval');
}

export function receiptOtherRoutes(p, q, openShop) {
  assert.equal(types.ObjType.get(obj(receipt)).tradeable, false);
  assert.equal(count(p, receipt), 2, 'the buyer starts with both genuinely purchased receipts');
  assert.equal(count(q, receipt), 0, 'the other account has no seeded receipt');

  openShop();
  const shop = id('InvType', 'pollnivneach_generalstore');
  const stock = p.getInventoryFromListener(p.invListeners.find(entry => entry.com === id('Component', 'shop_template:inv')));
  assert.equal(stock.getItemCount(obj(receipt)), 0, 'no receipt is stocked before the attempted sale');
  assert(invButton(p, 'shop_template_side:inv', receipt, 2, slotOf(p, receipt)));
  assert.equal(stock.getItemCount(obj(receipt)), 0, 'an untradeable receipt never enters shared shop stock');
  assert.equal(count(p, receipt), 2);
  p.invAdd(inv, obj('shortbow'), 1); // Disclosed ordinary-item shop positive control.
  const bowsInShop = stock.getItemCount(obj('shortbow'));
  assert(invButton(p, 'shop_template_side:inv', 'shortbow', 2, slotOf(p, 'shortbow')));
  assert.equal(stock.getItemCount(obj('shortbow')), bowsInShop + 1, 'the same general store can buy ordinary items');
  assert(closeAction.handle(new CloseModal(), p));
  p.processQueues();
  assert.equal(types.InvType.get(shop).allstock, true);

  // Disclosed challenge-area travel fixture: between the packed fight-zone rectangles.
  transferPair(p, q, { x: 3359, z: 3224 });
  for (const [who, other] of [[p, q], [q, p]]) {
    p.resetEntity(false); q.resetEntity(false);
    assert(playerAction.handle(new OpPlayer(1, other.slot), who));
    who.processInteraction();
  }
  assert.equal(p.modalMain, id('Component', 'duel_select_type'));
  assert.equal(q.modalMain, id('Component', 'duel_select_type'));
  assert(invButton(p, 'duel_side:inv', receipt, 1, slotOf(p, receipt)));
  assert.equal(count(p, receipt, id('InvType', 'dueloffer')), 0, 'a receipt cannot enter a duel stake');
  assert.equal(count(p, receipt), 2);
  p.invAdd(inv, obj('shortbow'), 1); // Disclosed ordinary-item stake positive control.
  assert(invButton(p, 'duel_side:inv', 'shortbow', 1, slotOf(p, 'shortbow')));
  assert.equal(count(p, 'shortbow', id('InvType', 'dueloffer')), 1);
  assert(closeAction.handle(new CloseModal(), p));
  p.processQueues();
  assert.equal(count(p, 'shortbow'), 1, 'declining the real duel returns the positive-control stake');

  // Disclosed death-allocation boundary: a normally reachable skulled account in the Wilderness.
  transferPair(p, q, { x: 3213, z: 3600 });
  p.setVar(id('VarPlayerType', 'pk_skull'), 1);
  for (const pvp of [false, true]) {
    const state = execute(pvp ? '[proc,pvp_death_lose_items]' : '[proc,player_death_lose_items]',
      p, [], { target: pvp ? q : null });
    assert(state, 'native death item allocation ran');
    assert.equal(count(p, receipt), 0, 'both receipts actually leave the dead owner inventory');
    assert.equal(count(q, receipt), 0, 'death does not directly grant the killer a receipt');
    const first = World.getObj(p.x, p.z, p.level, obj(receipt), p.hash64);
    assert(first, 'the buyer can see the actual private death drop');
    reveal(first);
    assert.equal(World.getObj(p.x, p.z, p.level, obj(receipt), q.hash64), null);
    q.resetEntity(false); q.originX = q.x; q.originZ = q.z;
    assert.equal(groundAction.handle(new OpObj(3, p.x, p.z, obj(receipt)), q), false,
      'the other account cannot Take either kind of private death drop');

    const bow = World.getObj(p.x, p.z, p.level, obj('shortbow'), q.hash64);
    assert(bow, 'the other account can see the ordinary death-loot positive control');
    if (!pvp) {
      q.invAdd(inv, obj('lawrune'), 1); q.invAdd(inv, obj('airrune'), 1);
      const spell = id('Component', 'magic:telekinetic_grab');
      assert.equal(groundSpell.handle(new OpObjT(p.x, p.z, obj(receipt), spell), q), false,
        'Telekinetic Grab cannot address another account\'s private receipt');
      assert.equal(count(q, 'lawrune'), 1, 'refused foreign telegrab consumes no rune');
      const before = count(q, 'shortbow');
      assert(groundSpell.handle(new OpObjT(bow.x, bow.z, bow.type, spell), q),
        'the same account and spell can address ordinary public loot');
      q.processInteraction(); settle(q);
      assert.equal(count(q, 'shortbow'), before + 1, 'the positive-control telegrab completes');
      assert.equal(count(q, 'lawrune'), 0);
    } else {
      take(q, bow);
    }
    for (let copy = 0; copy < 2; copy++) {
      const ground = World.getObj(p.x, p.z, p.level, obj(receipt), p.hash64);
      assert(ground, 'each receipt remains recoverable by its own buyer');
      reveal(ground);
      assert.equal(World.getObj(p.x, p.z, p.level, obj(receipt), q.hash64), null);
      take(p, ground);
    }
    assert.equal(count(p, receipt), 2);
    assert.equal(count(q, receipt), 0);
    if (!pvp) p.invAdd(inv, obj('shortbow'), 1); // Next death has its own ordinary-item control.
  }
  return { shop: false, duelStake: false, npcDeath: false, pvpDeath: false, telegrab: false };
}
