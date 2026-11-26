import assert from 'node:assert/strict';
import { World, types, nativeLocRows, nativeLoc, player, id, com, bit, setBit, run, operate, capture, load, text, PlayerStat } from '../rfd-s1/runtime.mjs';
const IfButton = await load('network/game/client/model/IfButton.ts');
const IfButtonHandler = await load('network/game/client/handler/IfButtonHandler.ts');
const p = player();
setBit(p, 'hundred_main_quest_var', 3);
const guests = [
  ['hundred_dwarf_quest', '100dwarfvisible', 'hundred_dwarf_ambassador_base', 10, { COOKING: 10000, SLAYER: 10000 }, 'empty_chair'],
  ['100goblin', '100goblinsvisible', 'hundred_goblin1_base', 10, { COOKING: 10000, CRAFTING: 10000, FARMING: 10000 }, null],
  ['100_pirate_quest_var', '100piratevisible', 'hundred_pirate_base', 10, { COOKING: 10000, CRAFTING: 10000, FISHING: 10000, SMITHING: 10000 }, 'empty_chair'],
  ['100guide_prog', '100guidevisible', 'hundred_guide_base', 10, { COOKING: 25000, MAGIC: 25000 }, 'empty_chair'],
  ['hundred_dave_main', '100davevisible', 'hundred_dave_base', 7, { COOKING: 70000 }, 'empty_chair'],
  ['100_ogre_prog', '100ogrevisible', 'hundred_ogre_base', 10, { COOKING: 15000, CRAFTING: 15000, WOODCUTTING: 15000, RANGED: 15000 }, 'empty_chair_ogre']
];
for (const [, visible] of guests) setBit(p, visible, 1);
run(p, '[proc,rfd_prepare_banquet]');
run(p, '[proc,update_questpoints]');
const qp = () => p.getVar(id('VarPlayerType', 'qp'));
const initialQP = qp();
assert.equal(initialQP, 1, 'the introduction contributes one QP before any guest is rescued');
const chest = nativeLoc('hundred_goodchest');
for (let index = 0; index < guests.length; index++) {
  const [stage, visible, base, completion, xp, rescuedType] = guests[index];
  const before = { xp: [...p.stats], qp: qp() };
  run(p, '[proc,rfd_guest_reward]', { args: [index + 1] });
  assert.deepEqual([...p.stats], before.xp, 'no reward before guest completion');
  assert.equal(bit(p, 'hundred_subquest_tally'), index);
  setBit(p, stage, completion); // Settlement unit fixture; route tests produce this state natively.
  run(p, '[proc,rfd_guest_reward]', { args: [index + 1] });
  assert.equal(bit(p, visible), 0);
  assert.equal(bit(p, 'hundred_subquest_tally'), index + 1);
  assert.equal(qp(), before.qp + 1);
  for (let skill = 0; skill < p.stats.length; skill++) {
    const amount = Object.entries(xp).find(([name]) => PlayerStat[name] === skill)?.[1] ?? 0;
    assert.equal(p.stats[skill] - before.xp[skill], amount, `guest ${index + 1}, stat ${skill}`);
  }
  const row = nativeLocRows(base)[0];
  const wrapper = World.getLoc(row.x, row.z, row.level, id('LocType', base.replace(/_base$/, '_multi')));
  const type = types.LocType.get(wrapper.type);
  assert.equal(type.multiloc[p.getVarBit(type.multivarbit)], rescuedType === null ? -1 : id('LocType', rescuedType), 'original per-guest rescued rendering');
  const once = { xp: [...p.stats], qp: qp() };
  run(p, '[proc,rfd_guest_reward]', { args: [index + 1] });
  assert.deepEqual({ xp: [...p.stats], qp: qp() }, once, 'visibility latch makes reward idempotent');
  for (const [op, prefix] of [[2, 'hundred_foodchest'], [3, 'hundred_rewardchest']]) {
    operate(p, chest, op);
    assert.equal(p.getVar(id('VarPlayerType', 'shop')), id('InvType', `${prefix}${index + 2}`));
  }
}
assert.equal(qp() - initialQP, 6, 'six rescued guests add six QP beside the introduction point');
assert.equal(qp(), 7, 'the introduction plus six guests contributes seven total RFD QP');
assert.equal(bit(p, 'hundred_main_quest_var'), 3, 'six guests do not finish the whole quest');
const skrachJournal = types.Component.get(com('recipe_for_disaster:com_7'));
assert.equal(skrachJournal.buttonType, types.Component.BUTTON, 'Skrach uses a normal Quest Journal button');
assert.equal(skrachJournal.text, "Skrach 'Bone Cruncher' Uglogwee");
const closeWindow = types.Component.get(com('recipe_for_disaster:com_10'));
assert.equal(closeWindow.buttonType, types.Component.CLOSE_BUTTON);
assert.equal(closeWindow.text, 'Close Window');
for (const [button, title] of [[5, 'Lumbridge Guide'], [6, 'Evil Dave'], [7, 'Skrach Uglogwee']]) {
  const packetStart = p.packets.length;
  run(p, '[if_button,questlist:hundred_main]');
  assert.equal(p.modalMain, com('recipe_for_disaster'));
  const colours = p.packets.slice(packetStart).filter(packet => packet.constructor.name === 'IfSetColour');
  assert(colours.some(packet => packet.component === skrachJournal.id), 'Skrach journal row receives progress colour');
  assert(!colours.some(packet => packet.component === closeWindow.id), 'Close Window is never recoloured');
  capture(p, () => assert(new IfButtonHandler().handle(new IfButton(com(`recipe_for_disaster:com_${button}`)), p)));
  assert.match(text(p), new RegExp(title));
  assert.match(text(p), /GUEST RESCUED/);
}
operate(p, chest, 1);
assert.equal(p.modalMain, com('bank_main'));
console.log('PASS RFD S2 six-guest reward/QP/chest progression, idempotence and three native journals');
process.exit(0);
