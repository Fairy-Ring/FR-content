#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runtime } from './outcome_runtime.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const content = path.resolve(here, '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = relative => import(pathToFileURL(path.join(engine, relative)).href);
const rt = await runtime(engine, pack);
const {
  NpcType,
  ObjType,
  InvType,
  VarBitType,
  VarNpcType,
  VarPlayerType,
  DbTableType
} = rt.configs;
const [{ default: resolveNpcType }, { default: Trigger }, { NpcStat }, { PlayerStat }] = await Promise.all([
  load('src/engine/entity/resolveNpcType.ts'),
  load('src/engine/script/ServerTriggerType.ts'),
  load('src/engine/entity/NpcStat.ts'),
  load('src/engine/entity/PlayerStat.ts')
]);
const id = rt.id;
const noncombatBases = [
  'troll_block_1', 'troll_block_2',
  'vc_partyrat_multi1', 'vc_partyrat_multi2', 'vc_partyrat_multi3',
  'vc_partyrat_multi4', 'vc_partyrat_multi5', 'vc_partyrat_multi6',
  'elid_ranging_target_multinpc', 'enakh_boneguard_multinpc',
  'enakh_dummy_fountain_multinpc', 'enakh_dummy_furnace_multinpc'
];
const feudBases = [
  'feud_arabian_guard_multi', 'feud_arabian_guard2_multi', 'feud_egyptian_doorman_multi'
];
const standaloneForms = ['fd_trollblock1', 'fd_trollblock2', 'elid_ranging_target'];
const attackGuards = ['[proc,npc_is_attackable]', '[proc,npc_is_attackable_opt]'];
const genericAttacks = [
  '[label,player_melee_attack]', '[label,player_ranged_attack]',
  '[label,player_magic_attack]', '[label,player_special_attack]'
];
const inventoryId = id(InvType, 'inv');
const wornId = id(InvType, 'worn');
const poisonId = id(VarNpcType, 'npc_poison');
const recoilId = id(VarPlayerType, 'ring_of_recoil');
const recoilWearPos = ObjType.getWearPosId('ring');
const necklaceWearPos = ObjType.getWearPosId('front');
const rightHandWearPos = ObjType.getWearPosId('righthand');
const quiverWearPos = ObjType.getWearPosId('quiver');
assert(recoilWearPos >= 0 && necklaceWearPos >= 0 && rightHandWearPos >= 0 && quiverWearPos >= 0);

function named(type, name) {
  const value = type.getByName(name);
  assert(value, `packed ${name}`);
  assert.equal(value.debugname, name, `named pack lookup for ${name}`);
  return value;
}

function namedReference(type, generatedId, label) {
  const referenced = type.get(generatedId);
  assert(referenced?.debugname, `${label} resolves to a named packed config`);
  return named(type, referenced.debugname);
}

function mappedSelectors(base) {
  return base.multinpc.flatMap((generatedId, slot) => {
    if (!Number.isInteger(generatedId) || generatedId < 0) return [];
    return [{ slot, form: namedReference(NpcType, generatedId, `${base.debugname} selector ${slot}`) }];
  });
}

function selectForm(base, player, slot) {
  if (base.multivarp !== -1) {
    const selector = namedReference(VarPlayerType, base.multivarp, `${base.debugname} selector varp`);
    const selectorId = id(VarPlayerType, selector.debugname);
    player.setVar(selectorId, slot);
    assert.equal(player.getVar(selectorId), slot, `${base.debugname} selector varp ${selector.debugname}`);
  } else if (base.multivarbit !== -1) {
    const selector = namedReference(VarBitType, base.multivarbit, `${base.debugname} selector varbit`);
    const selectorId = id(VarBitType, selector.debugname);
    player.setVarBit(selectorId, slot);
    assert.equal(player.getVarBit(selectorId), slot, `${base.debugname} selector varbit ${selector.debugname}`);
  } else {
    assert.fail(`${base.debugname} has no packed multi selector`);
  }

  const generatedFormId = base.multinpc[slot];
  assert(Number.isInteger(generatedFormId) && generatedFormId >= 0, `${base.debugname} selector ${slot} maps to a form`);
  const expected = namedReference(NpcType, generatedFormId, `${base.debugname} selector ${slot}`);
  const visible = resolveNpcType(base, player);
  assert.equal(visible.debugname, expected.debugname, `${base.debugname} selector ${slot} resolves by name`);
  return visible;
}

function inventoryState(inventory) {
  return inventory.items.map(item => {
    if (!item) return null;
    const type = namedReference(ObjType, item.id, 'inventory item');
    return { name: type.debugname, count: item.count };
  });
}

function queueState(actor) {
  return [...actor.queue.all()].map(request => ({
    script: request.script?.name ?? null,
    args: [...request.args],
    delay: request.delay,
    type: request.type
  }));
}

function effects(f) {
  return {
    npcHp: f.npc.levels[NpcStat.HITPOINTS],
    playerHp: f.player.levels[PlayerStat.HITPOINTS],
    playerXp: [...f.player.stats],
    poison: f.npc.getVar(poisonId),
    recoil: f.player.getVar(recoilId),
    npcQueue: queueState(f.npc),
    playerQueue: queueState(f.player),
    inventory: inventoryState(f.player.getInventory(inventoryId)),
    worn: inventoryState(f.player.getInventory(wornId))
  };
}

function observe(name, f, args = []) {
  const result = rt.observe(name, f, args);
  assert.equal(result.snapshot.execution, rt.State.FINISHED, `${name} finished in the real VM`);
  return result;
}

function assertNoNpcHasop(result, label) {
  assert.equal(result.events.filter(event => event.op === 'NPC_HASOP').length, 0, `${label}: base marker rejects before NPC_HASOP`);
}

function assertBlocked(result, f, before, label) {
  assert.equal(result.values[0], 0, `${label}: refused`);
  assert(result.visited.includes('[proc,npc_combat_hasop]'), `${label}: shared noncombat gate ran`);
  assertNoNpcHasop(result, label);
  assert.deepEqual(effects(f), before, `${label}: HP, XP, poison, queues, recoil charge, and inventory stay unchanged`);
}

function addCrumbleRunes(player) {
  const spell = rt.spell('crumble_undead');
  const table = DbTableType.getByName('magic_spell_table');
  assert(table, 'packed magic spell table');
  const column = table.columnNames.indexOf('runesrequired');
  assert(column >= 0, 'packed Crumble Undead rune requirements');
  const values = spell.getValue(column, 0);
  assert(values.length > 0 && values.length % 2 === 0, 'Crumble Undead has packed rune/count pairs');
  const inventory = player.getInventory(inventoryId);
  for (let index = 0; index < values.length; index += 2) {
    const rune = namedReference(ObjType, values[index], 'Crumble Undead rune');
    const count = Number(values[index + 1]);
    assert(Number.isInteger(count) && count > 0, `${rune.debugname} has a positive packed requirement`);
    assert.equal(inventory.add(id(ObjType, rune.debugname), count), count, `${rune.debugname} fixture runes added`);
  }
}

function equip(player, name, slot) {
  player.getInventory(wornId).set(slot, { id: id(ObjType, name), count: 1 });
}

function assertRecoilRefused(script, f, args, label) {
  const before = effects(f);
  const result = observe(script, f, args);
  assert(result.visited.includes('[proc,npc_combat_hasop]'), `${label}: shared noncombat gate ran`);
  const after = effects(f);
  assert.equal(after.playerHp, before.playerHp - 10, `${label}: the incoming hit still damages the player`);
  assert.equal(after.npcHp, before.npcHp, `${label}: the NPC takes no recoil damage`);
  assert.deepEqual(after.playerXp, before.playerXp, `${label}: no combat XP`);
  assert.equal(after.poison, before.poison, `${label}: poison is unchanged`);
  assert.equal(after.recoil, before.recoil, `${label}: recoil charges are unchanged`);
  assert.deepEqual(after.npcQueue, before.npcQueue, `${label}: no recoil hit is queued`);
  assert.deepEqual(after.playerQueue, before.playerQueue, `${label}: no player queue changes`);
  assert.deepEqual(after.inventory, before.inventory, `${label}: runes and inventory are unchanged`);
  assert.deepEqual(after.worn, before.worn, `${label}: the charged recoil ring remains worn`);
}

function dispatchedOp2(f) {
  f.player.target = f.npc;
  f.player.targetOp = Trigger.OPNPC2 - 7;
  const script = f.player.getOpTrigger();
  assert(script, `${resolveNpcType(NpcType.get(f.npc.type), f.player).debugname} keeps its op2 handler`);
  return script;
}

let checkedForms = 0;
let feudMode = null;
try {
  for (const baseName of noncombatBases) {
    const base = named(NpcType, baseName);
    assert.equal(rt.param(base, 'npc_noncombat_multi'), 1, `${baseName} carries the packed noncombat marker`);
    const cases = mappedSelectors(base);
    assert(cases.length > 0, `${baseName} has packed selector forms`);
    const defaultForm = cases.find(entry => entry.slot === 0)?.form;
    assert(defaultForm?.op?.[1], `${baseName} default visible form has op2`);
    assert.notEqual(defaultForm.op[1], 'Attack', `${baseName} default op2 is not Attack`);

    for (const { slot, form: expectedForm } of cases) {
      const f = rt.fixture(baseName);
      try {
        const form = selectForm(base, f.player, slot);
        assert.equal(form.debugname, expectedForm.debugname, `${baseName} selector ${slot} uses the named form`);
        assert.equal(rt.param(form, 'npc_noncombat_multi'), 0, `${form.debugname} remains unflagged as a standalone form`);
        equip(f.player, 'ring_of_recoil', recoilWearPos);
        equip(f.player, 'crystalshard_necklace', necklaceWearPos);
        f.player.setVar(recoilId, 39);
        addCrumbleRunes(f.player);

        const before = effects(f);
        const helper = observe('[proc,npc_combat_hasop]', f);
        assert.deepEqual(helper.values, [0], `${baseName} selector ${slot}: shared gate refuses`);
        assertNoNpcHasop(helper, `${baseName} selector ${slot}`);
        assert.deepEqual(effects(f), before, `${baseName} selector ${slot}: shared gate has no effects`);

        for (const guard of attackGuards) {
          assertBlocked(observe(guard, f), f, before, `${baseName} selector ${slot} ${guard}`);
        }
        for (const attack of genericAttacks) {
          const result = observe(attack, f);
          assert(result.visited.includes('[proc,npc_combat_hasop]'), `${baseName} selector ${slot} ${attack}: shared gate ran`);
          assertNoNpcHasop(result, `${baseName} selector ${slot} ${attack}`);
          assert.deepEqual(effects(f), before, `${baseName} selector ${slot} ${attack}: no combat effects`);
        }

        const poison = observe('[proc,npc_poison_start]', f, [20]);
        assert(poison.visited.includes('[proc,npc_combat_hasop]'), `${baseName} selector ${slot}: poison uses the shared gate`);
        assert.deepEqual(effects(f), before, `${baseName} selector ${slot}: poison does not start`);

        const salve = observe('[proc,player_npc_salve_active]', f);
        assert.deepEqual(salve.values, [0], `${baseName} selector ${slot}: salve admission refuses`);
        assert(salve.visited.includes('[proc,npc_combat_hasop]'), `${baseName} selector ${slot}: salve uses the shared gate`);
        assert.deepEqual(effects(f), before, `${baseName} selector ${slot}: salve has no combat effects`);

        const crumble = observe('[proc,pvm_crumble_undead]', f);
        assert(crumble.visited.includes('[proc,check_spell_requirements]'), `${baseName} selector ${slot}: packed Crumble runes pass their check`);
        assert(crumble.visited.includes('[proc,player_in_combat_check2]'), `${baseName} selector ${slot}: Crumble combat check passes`);
        assert(crumble.visited.includes('[proc,npc_combat_hasop]'), `${baseName} selector ${slot}: Crumble uses the shared gate`);
        assert(crumble.snapshot.messages.includes("You can't attack this npc."), `${baseName} selector ${slot}: Crumble refuses at op2 admission`);
        assert(!crumble.visited.includes('[proc,npc_is_attackable_opt]'), `${baseName} selector ${slot}: Crumble stops before spell admission`);
        assert.deepEqual(effects(f), before, `${baseName} selector ${slot}: Crumble spends no runes or combat resources`);

        f.player.setVar(id(VarPlayerType, 'aggressive_npc'), f.npc.uid);
        f.npc.setVar(id(VarNpcType, 'npc_attacking_uid'), f.player.uid);
        assertRecoilRefused('[queue,combat_damage_player]', f, [10], `${baseName} selector ${slot} standard recoil`);
        assertRecoilRefused('[queue,combat_viking_damage_player]', f, [10, f.npc.uid], `${baseName} selector ${slot} Viking recoil`);
        checkedForms++;
      } finally {
        rt.dispose();
      }
    }
  }

  for (const name of standaloneForms) {
    const form = named(NpcType, name);
    assert.equal(rt.param(form, 'npc_noncombat_multi'), 0, `${name} has no shared noncombat marker`);
    const f = rt.fixture(name);
    try {
      const before = effects(f);
      const helper = observe('[proc,npc_combat_hasop]', f);
      assert.deepEqual(helper.values, [1], `${name} keeps its raw op2 admission`);
      assert.equal(helper.events.filter(event => event.op === 'NPC_HASOP').length, 1, `${name} reaches native NPC_HASOP`);
      assert.equal(rt.param(form, 'npc_noncombat_multi'), 0, `${name} remains unflagged`);
      for (const guard of attackGuards) {
        assert.deepEqual(observe(guard, f).values, [1], `${name} ${guard} remains admitted by its visible option`);
      }
      assert.deepEqual(effects(f), before, `${name}: admission checks have no effects`);
    } finally {
      rt.dispose();
    }
  }

  for (const baseName of feudBases) {
    const base = named(NpcType, baseName);
    assert.equal(rt.param(base, 'npc_noncombat_multi'), 0, `${baseName} is not in the noncombat list`);
    const attackForm = mappedSelectors(base).find(entry => entry.form.op?.[1] === 'Attack');
    assert(attackForm, `${baseName} has a selected Attack form`);
    assert.equal(Boolean(base.op?.[1]), false, `${baseName} base has no op2`);
    const f = rt.fixture(baseName);
    try {
      const form = selectForm(base, f.player, attackForm.slot);
      assert.equal(form.debugname, attackForm.form.debugname);
      assert.equal(form.op?.[1], 'Attack');
      const native = observe('[proc,npc_combat_hasop]', f);
      assert.equal(native.events.filter(event => event.op === 'NPC_HASOP').length, 1, `${baseName}: native NPC_HASOP was executed`);
      const nativeHasop = native.events.find(event => event.op === 'NPC_HASOP');
      assert.deepEqual(nativeHasop.in, [2], `${baseName}: native NPC_HASOP checks option 2`);
      const nativeResult = nativeHasop.out[0];
      const selectedResult = Number(Boolean(form.op?.[1]));
      const baseResult = Number(Boolean(base.op?.[1]));
      assert(nativeResult === selectedResult || nativeResult === baseResult, `${baseName}: native result matches the selected form or op-less base`);
      const mode = nativeResult === selectedResult ? 'visible-form' : 'base';
      if (feudMode === null) feudMode = mode;
      assert.equal(mode, feudMode, 'NPC_HASOP semantics are consistent across the three Feud fixtures');
      const expected = mode === 'visible-form' ? selectedResult : baseResult;
      assert.deepEqual(native.values, [expected], `${baseName}: shared helper preserves native NPC_HASOP`);
      for (const guard of attackGuards) {
        const result = observe(guard, f);
        assert.deepEqual(result.values, [expected], `${baseName} ${guard}: follows native NPC_HASOP`);
        assert(result.visited.includes('[proc,npc_combat_hasop]'), `${baseName} ${guard}: shared helper ran`);
      }
    } finally {
      rt.dispose();
    }
  }

  const ice = named(NpcType, 'troll_block_1');
  const iceCase = mappedSelectors(ice).find(entry => entry.form.debugname === 'fd_trollblock1');
  assert(iceCase, 'troll block has its original Smash-ice form');
  const iceFixture = rt.fixture(ice.debugname);
  try {
    const iceForm = selectForm(ice, iceFixture.player, iceCase.slot);
    const iceBefore = effects(iceFixture);
    const iceTrigger = dispatchedOp2(iceFixture);
    const iceClick = observe(iceTrigger.name, iceFixture);
    assert(iceClick.visited.includes('[proc,dt_ice_smash]'), 'DT Smash-ice click still dispatches to its quest handler');
    assert.deepEqual(effects(iceFixture), iceBefore, `${iceForm.debugname}: fresh quest state does not start generic combat`);
  } finally {
    rt.dispose();
  }

  const elid = named(NpcType, 'elid_ranging_target_multinpc');
  const elidCase = mappedSelectors(elid).find(entry => entry.form.debugname === 'elid_ranging_target');
  assert(elidCase, 'Elid target has its original Shoot form');
  const elidFixture = rt.fixture(elid.debugname);
  try {
    const form = selectForm(elid, elidFixture.player, elidCase.slot);
    elidFixture.player.setVarBit(id(VarBitType, 'elid_rangingchannel'), 0);
    equip(elidFixture.player, 'magic_shortbow', rightHandWearPos);
    elidFixture.player.getInventory(wornId).set(quiverWearPos, { id: id(ObjType, 'bronze_arrow'), count: 3 });
    const before = effects(elidFixture);
    const trigger = dispatchedOp2(elidFixture);
    const click = observe(trigger.name, elidFixture);
    assert(click.visited.includes('[label,elid_ranging_shoot]'), 'Elid Shoot click still executes its original handler');
    assert.equal(elidFixture.player.getVarBit(id(VarBitType, 'elid_rangingchannel')), 1, 'Elid Shoot completes the channel');
    assert.equal(elidFixture.player.getInventory(wornId).get(quiverWearPos)?.count, 2, 'Elid Shoot consumes one equipped arrow');
    const after = effects(elidFixture);
    assert.equal(after.npcHp, before.npcHp, `${form.debugname}: Shoot does not use generic combat`);
    assert.equal(after.playerHp, before.playerHp, `${form.debugname}: Shoot does not damage the player`);
    assert.deepEqual(after.playerXp, before.playerXp, `${form.debugname}: Shoot grants no combat XP`);
    assert.deepEqual(after.npcQueue, before.npcQueue, `${form.debugname}: Shoot queues no combat hit`);
    assert.deepEqual(after.playerQueue, before.playerQueue, `${form.debugname}: Shoot queues no player damage`);
    assert.equal(after.poison, before.poison, `${form.debugname}: Shoot does not poison`);
    assert.equal(after.recoil, before.recoil, `${form.debugname}: Shoot does not charge recoil`);
  } finally {
    rt.dispose();
  }

  assert.equal(checkedForms > 0, true, 'all 12 original bases have selector coverage');
  assert.equal(feudBases.length, 3, 'all three Feud controls ran');
  console.log(`PASS ${checkedForms} packed selector/form cases across 12 noncombat bases`);
  console.log(`PASS three Feud controls follow native NPC_HASOP semantics (${feudMode})`);
  console.log('PASS standalone visible forms and DT/Elid op2 handlers remain intact');
} catch (error) {
  console.error(error.stack ?? error);
  process.exitCode = 1;
} finally {
  rt.dispose();
  process.exit(process.exitCode ?? 0);
}
