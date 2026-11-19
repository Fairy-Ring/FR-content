// Run from the built sibling engine: node --import tsx ../content/tests/bank-booths/test_bank_booths.mjs
import assert from 'node:assert/strict';
import { World, types, map, player, id, count, engineModule, ScriptState, resumeDialogue, invButton } from '../swamp-caves/runtime.mjs';
const { readPlacements } = await import('../loc-option-audit/audit.mts');
const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const OpLocHandler = (await engineModule('network/game/client/handler/OpLocHandler.ts')).default;
const { placements } = readPlacements();

// VERIFIED original cache placements; these are not spawned test scenery.
const built = [
  ['bank_booth', 11, [0, -1]],
  ['elid_bankbooth', 4, [1, 0]],
  ['dwarf_keldagrim_bankbooth', 2, [0, 1]],
  ['pest_bankbooth', 4, [0, -1], false]
];
const left = [
  ['ahoy_bankbooth', 'ahoy_bankbooth', null, [1, 2]],
  ['fever_bankbooth', 'fever_bankbooth', null, [1, 2]],
  ['burgh_bank_booth_multiloc', 'burgh_bankbooth_repaired', 1, [1, 2]],
  ['burgh_bank_booth_multiloc', 'burgh_bankbooth_damaged', 0, [1]],
  ['hundred_goodchest', 'hundred_goodchest_base', 3, [1, 2, 3]],
  ['magictraining_coin_collector', 'magictraining_coin_collector', null, [1]],
  ['magictraining_grave_foodshute', 'magictraining_grave_foodshute', null, [1]],
  ['hole_10803', 'hole_10803', null, [1]],
  ['fever_plunder_deposit', 'fever_plunder_deposit', null, [1, 2]],
  ['fever_multi_chest', 'fever_chestclosed', 0, [1]],
  ['fever_multi_chest', 'fever_chestopen', 1, [1]],
  ['mausoleum', 'mausoleum', null, [1]]
];
const natural = name => placements.filter(p => p.type === id('LocType', name));
const component = name => id('Component', name);
function fixture(placement, [dx, dz] = [0, 1]) {
  const p = player();
  p.x = p.originX = placement.x + dx;
  p.z = p.originZ = placement.z + dz;
  p.level = placement.level;
  return p;
}
function locAt(placement) {
  const loc = World.getLoc(placement.x, placement.z, placement.level, placement.type);
  assert(loc, `natural loc ${types.LocType.get(placement.type).debugname} at ${placement.x},${placement.z}`);
  return loc;
}
function setForm(p, loc, state) {
  if (state === null) return;
  const type = types.LocType.get(loc.type);
  if (type.multivarp !== -1) p.setVar(type.multivarp, state);
  else p.setVarBit(type.multivarbit, state);
}
function arm(p, loc, option) {
  assert(new OpLocHandler().handle(new OpLoc(option, loc.x, loc.z, loc.type), p), 'production loc packet accepted');
  assert.equal(p.target, loc, 'production packet selects the natural booth');
}
function finish(p, script, loc, choices = []) {
  const state = ScriptRunner.init(script, p, loc);
  p.executeScript(state, true, true);
  const pending = [...choices];
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 30; step++) {
    assert.equal(state.execution, ScriptState.PAUSEBUTTON, `${script.name} reaches a real dialogue pause`);
    const menu = /^multi[2-5]$/.test(types.Component.get(p.modalChat).comName);
    if (menu) assert(pending.length, 'bank dialogue has its expected choice');
    resumeDialogue(p, menu ? pending.shift() : null);
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'bounded bank dialogue finishes');
  assert.equal(pending.length, 0, 'all bank choices consumed');
}
function bank(p) {
  assert.equal(p.modalMain, component('bank_main'));
  assert.equal(p.modalSide, component('bank_side'));
  for (const [inventory, target] of [['inv', 'bank_side:inv'], ['bank', 'bank_main:bank']]) {
    assert(p.invListeners.some(l => l.type === id('InvType', inventory) && l.com === component(target)), `${inventory} uses the published bank listener`);
  }
}
for (const [name, expected, stand, teller = true] of built) {
  const all = natural(name);
  assert.equal(all.length, expected, `${name} original placement count`);
  assert.deepEqual(types.LocType.get(id('LocType', name)).op.slice(0, 2), ['Use', 'Use-quickly']);
  for (const placement of all) {
    const loc = locAt(placement);
    for (const option of [1, 2]) {
      const p = fixture(placement, stand);
      assert(!map.isMapBlocked(p.x, p.z, p.level), `${name} public stand is walkable`);
      assert([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => map.isLineOfWalk(p.level, p.x, p.z, p.x + dx, p.z + dz)), 'public stand is not an isolated floor tile');
      arm(p, loc, option);
      const script = p.getOpTrigger();
      assert(script, `${name} option ${option} dispatches through Player.getOpTrigger`);
      // Use follows the published nearby-teller conversation or its no-teller fallback.
      finish(p, script, loc, option === 1 && teller ? [1] : []);
      bank(p);
      const greeting = p.packets.some(packet => packet.constructor.name === 'IfSetText' && packet.text.includes('Good day, how may I help you?'));
      assert.equal(greeting, option === 1 && teller, `${name} option ${option} uses the published conversation/fallback path`);
    }
  }
  console.log(`PASS ${name}: ${expected} natural placements, both client options reach the published bank service`);
}
// Transaction checks use the actual bank interface packet handler and its listeners.
const transactionLoc = locAt(natural('elid_bankbooth')[0]);
const transaction = fixture(natural('elid_bankbooth')[0], [1, 0]);
transaction.invAdd(id('InvType', 'inv'), id('ObjType', 'bronze_dagger'), 1);
arm(transaction, transactionLoc, 2);
finish(transaction, transaction.getOpTrigger(), transactionLoc);
bank(transaction);
assert(invButton(transaction, 'bank_side:inv', 'bronze_dagger', 1, 0), 'real deposit interface packet accepted');
assert.equal(count(transaction, 'bronze_dagger'), 0);
assert.equal(count(transaction, 'bronze_dagger', id('InvType', 'bank')), 1);
assert(invButton(transaction, 'bank_main:bank', 'bronze_dagger', 1, 0), 'real withdraw interface packet accepted');
assert.equal(count(transaction, 'bronze_dagger'), 1);
assert.equal(count(transaction, 'bronze_dagger', id('InvType', 'bank')), 0);
console.log('PASS deposit and withdraw one item through the published bank interfaces');
for (const [root, visible, state, options] of left) {
  const all = natural(root);
  assert(all.length, `${root} has an original placement`);
  for (const placement of all) {
    const loc = locAt(placement), p = fixture(placement);
    setForm(p, loc, state);
    assert.equal(p.resolveLocTypeForTrigger(types.LocType.get(loc.type)).id, id('LocType', visible), `${root} fixture shows ${visible}`);
    for (const option of options) {
      arm(p, loc, option);
      assert.equal(p.getApTrigger(), null, `${visible} option ${option} remains unanswered (AP)`);
      assert.equal(p.getOpTrigger(), null, `${visible} option ${option} remains unanswered (OP)`);
    }
  }
  console.log(`PASS left to its owning unit: ${root} -> ${visible}, options ${options.join(',')}`);
}
process.exit(0);
