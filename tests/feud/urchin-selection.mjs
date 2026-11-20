import './deterministic-wander.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { World, count, engineModule, execute, id, inv, obj, seed, types } from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';
import { actors, bit, openOriginalVillagerCurtain, operate, operationStand, read, stand, talk } from './fixture.mjs';

const { NpcIterator } = await engineModule('engine/script/ScriptIterators.ts');
const { NpcIteratorType } = await engineModule('engine/entity/NpcIteratorType.ts');
const { NpcMode } = await engineModule('engine/entity/NpcMode.ts');
const stateVar = id('VarNpcType', 'feud_villager_state');
const ownerVar = id('VarNpcType', 'feud_villager_owner');
const slotVar = id('VarPlayerType', 'feud_trial_villager');
const priorities = [2, 3, 1].map(n => id('NpcType', `feud_villager_multi_${n}`));

function account(checkpoint = 7) {
  const p = seed(player(), ['blackjack_oak']);
  // Disclosed own-player checkpoint. Native Lure or urchin dialogue creates each NPC state.
  p.setVarBit(bit('feud_var'), checkpoint);
  p.setVarBit(bit('feud_npc_multi'), checkpoint === 9 ? 2 : 1);
  p.setVar(slotVar, -1);
  return p;
}

function expectedSelection(p) {
  for (const type of priorities) {
    let selected = null, distance = Infinity;
    for (const npc of new NpcIterator(World.currentTick, p.level, p.x, p.z, 10, 0, NpcIteratorType.DISTANCE)) {
      if (npc.type !== type || npc.getVar(stateVar) !== 0) continue;
      const squared = (p.x - npc.x) ** 2 + (p.z - npc.z) ** 2;
      if (squared <= distance) { selected = npc; distance = squared; }
    }
    if (selected) return selected;
  }
  return null;
}

function release(p) { execute('[proc,feud_trial_release]', p); }

export function urchinSelectionTests() {
for (const condition of ['held', 'led']) {
  test(`the native urchin selects the next free villager instead of one another player ${condition}`, () => {
    const owner = account(condition === 'led' ? 9 : 7), next = account();
    openOriginalVillagerCurtain(next);
    const urchin = actors('feud_street_urchin').find(npc => operationStand(next, npc));
    assert(urchin);
    stand(next, urchin);
    const occupied = expectedSelection(next);
    assert(occupied, 'the original map supplies the initially preferred villager');
    if (condition === 'held') {
      talk(owner, 'feud_street_urchin');
      assert.equal(owner.getVar(slotVar), occupied.uid);
      assert.equal(occupied.getVar(stateVar), 1);
      assert.equal(occupied.targetOp, NpcMode.NONE);
    } else {
      operate(owner, occupied, 4);
      assert.equal(occupied.getVar(stateVar), 2);
      assert.equal(occupied.targetOp, NpcMode.PLAYERFOLLOW);
      assert.equal(occupied.target, owner);
    }
    stand(next, urchin);
    const expected = expectedSelection(next);
    assert(expected && expected !== occupied, 'a different original free villager remains in range');
    const result = talk(next, 'feud_street_urchin');
    assert.match(result.text, /Okay, I see them/);
    assert.equal(next.getVar(slotVar), expected.uid);
    assert.equal(expected.getVar(stateVar), 1);
    assert.equal(expected.getVar(ownerVar) >>> 0, next.uid);
    assert.equal(occupied.getVar(ownerVar) >>> 0, owner.uid, 'the first player keeps their own reservation');
    assert.equal(occupied.getVar(stateVar), condition === 'held' ? 1 : 2);
    release(next); release(owner);
  });
}

test('free urchin selection preserves native type priority, radius, nearest distance and iterator tie order', () => {
  const p = account();
  const positions = priorities.flatMap(type => actors(types.NpcType.get(type).debugname)).map(npc => [npc.level, npc.x, npc.z]);
  positions.push(operationStand(p, actors('feud_street_urchin')[0]));
  assert(positions.every(Boolean));
  for (const position of positions) {
    [p.level, p.x, p.z] = position;
    const expected = expectedSelection(p);
    const result = execute('[proc,feud_urchin_find_villager]', p);
    assert.equal(result.intStack[0], expected?.uid ?? -1, `unchanged native order at ${position.join(',')}`);
  }
});

for (const [gender, address] of [[0, 'sir'], [1, "ma'am"]]) {
  test(`urchin thanks the paying player as ${address}`, () => {
    const p = account(9);
    p.gender = gender;
    p.invAdd(inv, obj('coins'), 10);
    const before = count(p, 'coins');
    const result = talk(p, 'feud_street_urchin', [2, 2]);
    assert.match(result.text, new RegExp(`Thanks ${address}, I didn't think you would hold up your side of the deal`));
    assert.equal(count(p, 'coins'), before - 10);
    assert.equal(read(p, 'feud_var_urchin'), 1);
  });
}

test('the urchin reconciles an abandoned hold before filtering busy villagers', () => {
  const owner = account(), next = account();
  openOriginalVillagerCurtain(next);
  talk(owner, 'feud_street_urchin');
  const target = [...World.npcs].find(npc => npc.isActive && npc.uid === owner.getVar(slotVar));
  assert(target);
  assert.equal(target.getVar(stateVar), 1);
  target.resetDefaults(); // Same engine reset whose lost timer leaves a stale hold.
  talk(next, 'feud_street_urchin');
  assert.equal(next.getVar(slotVar), target.uid, 'the former first choice is free after reconciliation');
  assert.equal(target.getVar(ownerVar) >>> 0, next.uid);
  assert.equal(owner.getVar(slotVar), -1);
  release(next);
});
}
