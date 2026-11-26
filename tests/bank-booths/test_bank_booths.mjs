// Run from the built sibling engine: node --import tsx ../content/tests/bank-booths/test_bank_booths.mjs
import assert from 'node:assert/strict';
import { World, types, map, player, id, count, engineModule, ScriptState, resumeDialogue, invButton } from '../swamp-caves/runtime.mjs';
const { readPlacements } = await import('../loc-option-audit/audit.mts');
const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const OpLocHandler = (await engineModule('network/game/client/handler/OpLocHandler.ts')).default;
const { ScriptOpcode } = await engineModule('engine/script/ScriptOpcode.ts');
const { placements } = readPlacements();

// VERIFIED original cache placements; these are not spawned test scenery.
const built = [
  ['bank_booth', 11, [0, -1]],
  ['elid_bankbooth', 4, [1, 0]],
  ['dwarf_keldagrim_bankbooth', 2, [0, 1]],
  ['pest_bankbooth', 4, [0, -1], false]
];
const left = [
  ['mausoleum', 'mausoleum', null, [1]]
];
const builtFever = [
  ['fever_plunder_deposit', 'fever_plunder_deposit', null, [1, 2]],
  ['fever_multi_chest', 'fever_chestclosed', 0, [1]],
  ['fever_multi_chest', 'fever_chestopen', 1, [1]]
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
      // Keldagrim Use must select its published four-option dwarf conversation,
      // not the generic teller menu whose old bank option was 1.
      const dwarf = name === 'dwarf_keldagrim_bankbooth';
      finish(p, script, loc, option === 1 && teller ? [dwarf ? 4 : 1] : []);
      bank(p);
      const text = p.packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => packet.text).join(' ').replace(/\s+/g, ' ');
      const greeting = text.includes(dwarf ? 'Welcome to the Keldagrim bank! Anything I can help you with?' : 'Good day, how may I help you?');
      assert.equal(greeting, option === 1 && teller, `${name} option ${option} uses the published regional conversation/fallback path`);
      if (dwarf) {
        assert(!p.packets.some(packet => packet.constructor.name === 'IfSetText' && packet.text.includes("Didn't you used to be called the Bank of Varrock?")),
          'Keldagrim booths do not expose the unrelated generic banker conversation');
      }
    }
  }
  console.log(`PASS ${name}: ${expected} natural placements, both client options reach the published bank service`);
}
// Service built; the route to the place is not built: Port Phasmatys town barrier.
const ghostBooths = natural('ahoy_bankbooth');
assert.equal(ghostBooths.length, 4, 'original Port Phasmatys booth placements');
for (const placement of ghostBooths) {
  const loc = locAt(placement);
  for (const amulet of ['absent', 'carried', 'worn']) {
    for (const option of [1, 2]) {
      const p = fixture(placement, [0, 1]);
      assert(!map.isMapBlocked(p.x, p.z, p.level), 'Phasmatys public counter stand is walkable');
      if (amulet !== 'absent') p.invAdd(id('InvType', amulet === 'worn' ? 'worn' : 'inv'), id('ObjType', 'amulet_of_ghostspeak'), 1);
      arm(p, loc, option);
      const script = p.getOpTrigger();
      assert(script, `ahoy_bankbooth option ${option} resolves through production dispatch`);
      const translated = amulet === 'worn';
      finish(p, script, loc, option === 1 && translated ? [1] : []);
      const text = p.packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => packet.text).join(' ');
      if (option === 1 && !translated) {
        assert.equal(p.modalMain, -1, 'untranslated Use does not open a bank');
        assert(text.includes('Woooo wooo wooooo woooo'), 'Use reuses the published ghost refusal');
        assert(!text.includes('Good day'), 'untranslated ghost does not speak human words');
      } else {
        bank(p);
        if (option === 1) assert(text.includes('Good day, how may I help you?'));
      }
      if (option === 2) assert.equal(p.messages.some(message => message.includes('You can still quick-bank')), !translated, 'quick banking reuses the published amulet-dependent message');
    }
  }
}
console.log('PASS Phasmatys: service built; the route to the place is not built: unhandled town barrier; both options match the published ghost banker for absent/carried/worn amulet');
console.log('PASS Pest: service built; the route to the place is not built: missing Port Sarim Squire island-arrival flow');
const pirateBooths = natural('fever_bankbooth');
assert.equal(pirateBooths.length, 3, 'original Mos Le Harmless booth placements');
assert.deepEqual(types.LocType.get(id('LocType', 'fever_bankbooth')).op.slice(0, 2), ['Use', 'Use-quickly']);
const firstPirateBankers = [...World.npcs].filter(npc => npc.type === id('NpcType', 'fever_banker_01'));
assert.equal(firstPirateBankers.length, 2, 'two original first-form pirate bankers cover the three booths');
for (const placement of pirateBooths) {
  assert(firstPirateBankers.some(npc => npc.level === placement.level &&
    (npc.x - placement.x) ** 2 + (npc.z - placement.z) ** 2 <= 4),
  'each original booth already finds a first-form banker within two tiles');
}
for (const placement of pirateBooths) {
  const loc = locAt(placement);
  for (const option of [1, 2]) {
    const p = fixture(placement, [-1, 0]);
    assert(!map.isMapBlocked(p.x, p.z, p.level), 'Mos Le Harmless public counter stand is walkable');
    arm(p, loc, option);
    const script = p.getOpTrigger();
    assert(script, `fever_bankbooth option ${option} reaches its exact handler`);
    assert.equal(script.opcodes.filter(opcode => opcode === ScriptOpcode.NPC_FIND).length, option === 1 ? 1 : 0,
      'compiled booth Use has only the reachable first-form finder; no dead second-form fallback');
    finish(p, script, loc, option === 1 ? [1] : []);
    bank(p);
    const greeting = p.packets.some(packet => packet.constructor.name === 'IfSetText' && packet.text.includes('Aye? Ye got some stuff te stash?'));
    assert.equal(greeting, option === 1, 'Use reuses the published pirate conversation; quick-bank does not speak');
  }
}
console.log('PASS Mos Le Harmless: three natural booths reuse the published pirate bank paths');
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
for (const [root, visible, state, options] of builtFever) {
  const all = natural(root);
  assert(all.length, `${root} has an original placement`);
  for (const placement of all) {
    for (const option of options) {
      const loc = locAt(placement), p = fixture(placement);
      setForm(p, loc, state);
      assert.equal(p.resolveLocTypeForTrigger(types.LocType.get(loc.type)).id, id('LocType', visible), `${root} fixture shows ${visible}`);
      arm(p, loc, option);
      assert.equal(p.getApTrigger(), null, `${visible} option ${option} uses its built OP handler`);
      const script = p.getOpTrigger();
      assert(script, `${visible} option ${option} resolves through production dispatch`);
      assert.equal(script.info.sourceFilePath, 'scripts/quests/quest_fever/scripts/fever_battle.rs2',
        `${visible} option ${option} reaches its owning quest instead of a bank fallback`);
    }
  }
  console.log(`PASS built Cabin Fever: ${root} -> ${visible}, options ${options.join(',')}`);
}
const burghBooths = natural('burgh_bank_booth_multiloc');
assert(burghBooths.length, 'Burgh de Rott booths have original placements');
for (const [visible, state, options] of [
  ['burgh_bankbooth_repaired', 1, [1, 2]],
  ['burgh_bankbooth_damaged', 0, [1]]
]) {
  const gates = state === 0 ? [[50, 0, false]] : [[50, 0, false], [50, 1, false], [70, 1, true], [421, 1, true]];
  for (const placement of burghBooths) {
    for (const [stage, teller, opens] of gates) {
      for (const option of options) {
        const loc = locAt(placement), p = fixture(placement);
        p.setVarBit(id('VarBitType', 'myreque_2_quest'), stage);
        p.setVarBit(id('VarBitType', 'burgh_bank_teller'), teller);
        setForm(p, loc, state);
        assert.equal(p.resolveLocTypeForTrigger(types.LocType.get(loc.type)).id, id('LocType', visible),
          'the original Burgh booth resolves to the intended visible form');
        arm(p, loc, option);
        assert.equal(p.getApTrigger(), null, `${visible} option ${option} uses its built OP handler`);
        const script = p.getOpTrigger();
        assert(script, `${visible} option ${option} resolves through production dispatch`);
        assert.equal(script.info.sourceFilePath, 'scripts/quests/quest_myreque_2/scripts/myreque2_repairs.rs2',
          'Burgh booth operations reach their owning quest');
        finish(p, script, loc);
        assert.equal(p.getVarBit(id('VarBitType', 'myreque_2_quest')), stage, 'using the booth does not write quest progress');
        if (opens) bank(p);
        else {
          assert.notEqual(p.modalMain, component('bank_main'), 'the damaged or unstaffed booth does not open a bank');
          assert(!p.invListeners.some(listener => listener.type === id('InvType', 'bank')),
            'a refused booth operation creates no bank listener');
        }
      }
    }
  }
  console.log(`PASS built Myreque 2: original Burgh booths -> ${visible}, native options ${options.join(',')}, repair and teller gates`);
}
const rfdChests = natural('hundred_goodchest');
assert(rfdChests.length, 'RFD chest has an original placement');
for (const placement of rfdChests) {
  for (const stage of [0, 1, 2, 3]) {
    for (const option of [1, 2, 3]) {
      const loc = locAt(placement), p = fixture(placement);
      // Resolve the native handler from its visible form, then exercise its unlock guard.
      setForm(p, loc, 3);
      arm(p, loc, option);
      assert.equal(p.getApTrigger(), null, `RFD chest option ${option} uses its built OP handler`);
      const script = p.getOpTrigger();
      assert(script, `RFD chest option ${option} resolves through production dispatch`);
      assert.equal(script.info.sourceFilePath, 'scripts/quests/quest_100/scripts/rfd_hub.rs2',
        `RFD chest option ${option} reaches its owning quest`);
      const before = [p.modalMain, p.modalSide, p.invListeners.length];
      setForm(p, loc, stage);
      finish(p, script, loc);
      if (stage < 3) {
        assert.deepEqual([p.modalMain, p.modalSide, p.invListeners.length], before,
          `RFD stage ${stage} cannot open chest option ${option}`);
        continue;
      }
      assert.equal(p.resolveLocTypeForTrigger(types.LocType.get(loc.type)).id,
        id('LocType', 'hundred_goodchest_base'), 'unlocked RFD chest shows its original service form');
      if (option === 1) {
        bank(p);
      } else {
        const stock = id('InvType', option === 2 ? 'hundred_foodchest1' : 'hundred_rewardchest1');
        assert.equal(p.getVar(id('VarPlayerType', 'shop')), stock, 'RFD chest opens the matching first-tier stock');
        assert.equal(p.modalMain, component('shop_template'));
        assert.equal(p.modalSide, component('shop_template_side'));
        for (const [inventory, target] of [[id('InvType', 'inv'), 'shop_template_side:inv'], [stock, 'shop_template:inv']]) {
          assert(p.invListeners.some(l => l.type === inventory && l.com === component(target)),
            `RFD chest option ${option} uses the published ${target} listener`);
        }
      }
    }
  }
}
console.log('PASS RFD chest: all three native OP handlers, unlock guards and published bank/shop listeners');
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
