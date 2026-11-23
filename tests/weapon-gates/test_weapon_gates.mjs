#!/usr/bin/env node
// Native dispatch for three no-weapon predicates and the dated Mage Arena equipment rule.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  World, ScriptProvider, ScriptState, ServerTriggerType as Trigger, engineModule,
  types, id, obj, inv, worn, player, resumeDialogue, tile, execute, held, inventory,
} from '../swamp-caves/runtime.mjs';

const Runner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const Loc = (await engineModule('engine/entity/Loc.ts')).default;
const { EntityLifeCycle } = await engineModule('engine/entity/EntityLifeCycle.ts');
const { Interaction } = await engineModule('engine/entity/Interaction.ts');
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const constant = (file, name) => {
  const source = readFileSync(new URL(`../../scripts/${file}`, import.meta.url), 'utf8');
  const match = new RegExp(`^\\^${name}\\s*=\\s*(\\d+)\\s*$`, 'm').exec(source);
  assert(match, `missing checked-out constant ${name}`);
  return Number(match[1]);
};
const windStrike = constant('skill_combat/configs/magic/spells.constant', 'wind_strike');
const cannonComplete = constant('general/configs/quest.constant', 'mcannon_complete');
const variable = (p, name, value) => p.setVar(id('VarPlayerType', name), value);
const refusal = {
  entrana: "NO WEAPONS OR ARMOUR are permitted on holy Entrana AT ALL. We will not allow you to travel there in breach of mighty Saradomin's edict.",
  arena: 'You cannot enter the arena while carrying weapons or armour.',
  waterfall: 'But nothing happens.',
  thorvald: 'You may not enter the battleground with any armour or weaponry of any kind.',
  law: 'The power of Saradomin prevents you taking armour or weaponry to Entrana.',
};
const gates = [
  { name: 'Entrana monk', npc: 'shipmonk', at: [0, 3046, 3235], trigger: Trigger.APNPC1,
    script: '[opnpc1,shipmonk]', choices: [2], refusal: refusal.entrana, destination: [1, 2834, 3331] },
  // Official 30 August 2005 news permits armour and weapons, not non-magical combat.
  { name: 'Mage Arena barrier', loc: 'magearena_scan', at: [0, 3100, 3950], stand: [0, 3100, 3951],
    trigger: Trigger.APLOC1, script: '[oploc1,magearena_scan]', refusal: refusal.arena, permitsGear: true,
    setup: p => variable(p, 'magearena', 6), destination: [0, 3100, 3950] },
  ...[1, 2].map(stage => ({ name: `Kolodion ${stage === 1 ? 'first duel' : 'return'}`, npc: 'arenamage1',
    at: [0, 2538, 4714], trigger: Trigger.APNPC1, script: '[opnpc1,arenamage1]', refusal: refusal.arena,
    permitsGear: true, setup: p => variable(p, 'magearena', stage), destination: [0, 3105, 3934] })),
  { name: "Glarial's tomb", loc: 'glarials_tombstone_waterfall_quest', at: [0, 2558, 3445],
    trigger: Trigger.APLOCU, script: '[oplocu,glarials_tombstone_waterfall_quest]', refusal: refusal.waterfall,
    setup: p => { p.invAdd(inv, obj('glarials_pebble_waterfall_quest'), 1); p.lastUseItem = obj('glarials_pebble_waterfall_quest'); },
    destination: [0, 2554, 9844] },
  { name: "Thorvald's trial", loc: 'viking_warrior_ladder', at: [0, 2665, 3695], npcWitness: 'viking_thorvald',
    trigger: Trigger.APLOC2, script: '[oploc2,viking_warrior_ladder]', refusal: refusal.thorvald,
    // ^thorvald_started in bits ^viking_thorvald_start..end (16..17).
    setup: p => variable(p, 'viking_bits', 1 << 16), destination: [2, 2671, 10098] },
  { name: 'Abyss Law rift', loc: 'abyss_exit_to_law', at: [0, 3020, 4820],
    trigger: Trigger.APLOC1, script: '[oploc1,abyss_exit_to_law]', refusal: refusal.law,
    setup: p => variable(p, 'troll_quest', 50), destination: [0, 2464, 4819] },
];

function spawn(name, at) {
  const type = types.NpcType.getByName(name);
  assert(type, `packed NPC ${name}`);
  const [level, x, z] = at;
  const npc = new Npc(level, x, z, type.size, type.size, EntityLifeCycle.DESPAWN,
    World.getNextNid(), type.id, type.blockwalk);
  World.addNpc(npc, -1);
  return npc;
}

function finish(p, state, choices) {
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 100; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, 'gate handler must not abort');
    if (state.execution === ScriptState.PAUSEBUTTON) {
      const root = types.Component.get(p.modalChat).comName;
      const option = /^multi[2-5]$/.test(root) ? choices.shift() : null;
      assert.notEqual(option, undefined, `unexpected choice ${root}`);
      resumeDialogue(p, option);
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else {
      assert.fail(`unexpected gate suspension ${state.execution}`);
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'gate handler finishes within its fixture bound');
  assert.equal(choices.length, 0, 'every authored choice was consumed');
  assert(!p.messages.some(text => /script error/i.test(text)), `no script error: ${p.messages.join(' | ')}`);
}

function exercise(gate, weapon, location) {
  const p = player();
  const [level, x, z] = gate.at;
  [p.level, p.x, p.z] = gate.stand ?? [level, x + 1, z];
  p.originX = p.x; p.originZ = p.z;
  const start = tile(p);
  const npcsBefore = new Set([...World.npcs]);
  const context = `${gate.name}: ${weapon ?? 'no weapon'} ${location ?? ''}`;
  try {
    gate.setup?.(p);
    if (weapon) {
      const type = types.ObjType.getByName(weapon);
      assert(type, `packed weapon ${weapon}`);
      if (location === 'worn') p.invSet(worn, type.id, 1, type.wearpos);
      else p.invAdd(inv, type.id, 1);
    }
    const target = gate.npc ? spawn(gate.npc, gate.at)
      : new Loc(level, x, z, 1, 1, EntityLifeCycle.RESPAWN, id('LocType', gate.loc), 10, 0);
    target.isActive = true;
    if (gate.npcWitness) spawn(gate.npcWitness, [level, x, z + 1]);
    assert(p.setInteraction(Interaction.ENGINE, target, gate.trigger), `${context}: establish interaction`);
    const script = p.getOpTrigger();
    assert(script, `${context}: engine resolves operation`);
    assert.equal(script.name, gate.script, `${context}: exact engine-dispatched handler`);
    assert.equal(script, ScriptProvider.getByName(gate.script));
    // Test the dispatched handler itself, independent of approach/pathfinding.
    const state = Runner.init(script, p, target);
    p.executeScript(state, true, true);
    finish(p, state, [...(gate.choices ?? [])]);
    const text = [...p.messages, ...p.packets.filter(packet => packet.constructor.name === 'IfSetText')
      .map(packet => packet.text)].join(' ').replaceAll('|', ' ').replace(/\s+/g, ' ');
    if (gate.denied || (weapon && !gate.permitsGear)) {
      assert(text.includes(gate.refusal), `${context}: existing refusal is shown; got ${text}`);
      assert.deepEqual(tile(p), start, `${context}: refused player does not enter`);
    } else {
      assert(!text.includes(gate.refusal), `${context}: no equipment refusal`);
      assert.deepEqual(tile(p), gate.destination, `${context}: admitted player arrives`);
    }
    console.log(`PASS ${context}`);
  } finally {
    for (const npc of World.npcs) if (npc && !npcsBefore.has(npc)) World.removeNpc(npc, -1);
    World.players[p.slot] = null;
    p.unlink(); p.cleanup();
  }
}

function arenaMeleeRefused() {
  const p = player();
  const npcsBefore = new Set([...World.npcs]);
  try {
    [p.level, p.x, p.z] = [0, 3105, 3934];
    p.originX = p.x; p.originZ = p.z;
    variable(p, 'magearena', 6);
    for (const name of ['rune_halberd', 'bronze_platebody']) {
      const item = types.ObjType.getByName(name);
      assert(item, `packed equipment ${name}`);
      p.invSet(worn, item.id, 1, item.wearpos);
    }
    const target = spawn('kolhuman', [0, 3106, 3934]);
    assert.equal(types.NpcType.getByName('kolhuman').op[1], 'Attack', 'Kolodion exposes Attack');
    target.setVar(id('VarNpcType', 'npc_aggressive_player'), p.uid);
    const before = tile(p);
    assert(p.setInteraction(Interaction.ENGINE, target, Trigger.APNPC2), 'native armed Attack interaction');
    const script = p.getOpTrigger();
    assert.equal(script?.name, '[opnpc2,_]', 'native NPC Attack handler');
    const state = Runner.init(script, p, target);
    p.executeScript(state, true, true);
    finish(p, state, []);
    assert(p.messages.includes('Kolodion allows only magical combat within the arena.'),
      'armed melee Attack is refused with the existing magic-only message');
    assert.deepEqual(tile(p), before, 'refused Attack does not move the player');
    assert.equal([...target.queue.all()].filter(request => request.queueId === Trigger.AI_QUEUE2).length, 0,
      'refused melee Attack queues no damage');
    console.log('PASS Mage Arena: armed melee Attack is refused');
  } finally {
    for (const npc of World.npcs) if (npc && !npcsBefore.has(npc)) World.removeNpc(npc, -1);
    World.players[p.slot] = null;
    p.unlink(); p.cleanup();
  }
}

function cannonFireCase(label, ownerAt, targetAt, fires) {
  const p = player();
  const originalRandom = JavaRandom.nextDouble;
  let target;
  try {
    [p.level, p.x, p.z] = ownerAt;
    p.originX = p.x; p.originZ = p.z;
    variable(p, 'magearena', 1);
    const staff = types.ObjType.getByName('staff_of_air');
    assert(staff, 'packed autocast staff');
    p.invSet(worn, staff.id, 1, staff.wearpos);
    p.setVarBit(id('VarBitType', 'autocast_spell'), windStrike);
    p.setVarBit(id('VarBitType', 'autocast_set'), 1);
    variable(p, 'rockthrower', 5);
    variable(p, 'ownedmcannon', (p.level << 28) | ((p.x - 2) << 14) | p.z);
    target = spawn('kolhuman', targetAt);
    target.setVar(id('VarNpcType', 'npc_aggressive_player'), p.uid);
    // Deterministic accurate roll, as in the existing cannon-gate fixture.
    JavaRandom.nextDouble = () => 0.0001;
    execute('[proc,cannon_fire]', p, [], { target });
    assert.equal(p.getVar(id('VarPlayerType', 'rockthrower')), fires ? 4 : 5,
      `${label}: ${fires ? 'one cannonball spent' : 'no cannonball spent'}`);
    assert.equal([...target.queue.all()].filter(request => request.queueId === Trigger.AI_QUEUE2).length,
      fires ? 1 : 0, `${label}: ${fires ? 'one cannon hit queued' : 'no cannon hit queued'}`);
    assert.deepEqual(p.messages, [], `${label}: cannon firing/refusal is silent`);
    console.log(`PASS Mage Arena cannon: ${label}`);
  } finally {
    JavaRandom.nextDouble = originalRandom;
    if (target) World.removeNpc(target, -1);
    World.players[p.slot] = null;
    p.unlink(); p.cleanup();
  }
}

function arenaCannonSetupRefused() {
  const p = player();
  try {
    [p.level, p.x, p.z] = [0, 3105, 3934];
    p.originX = p.x; p.originZ = p.z;
    variable(p, 'mcannon', cannonComplete);
    variable(p, 'ownedmcannon', -1);
    for (const name of ['twpart1', 'twpart2', 'twpart3', 'twpart4']) p.invAdd(inv, obj(name), 1);
    const before = inventory(p);
    assert(held(p, 'twpart1', 1), 'native cannon Set-up inventory operation is accepted');
    assert.equal(p.activeScript, null, 'refused cannon setup finishes without delay');
    assert.deepEqual(p.messages, ["You can't set up a cannon here."], 'existing generic setup refusal');
    assert.deepEqual(inventory(p), before, 'refused setup retains every cannon part');
    assert.equal(p.getVar(id('VarPlayerType', 'ownedmcannon')), -1, 'no cannon ownership created');
    assert.equal(p.getVar(id('VarPlayerType', 'dropcannon')), 0, 'no assembly stage written');
    assert.equal(p.getVar(id('VarPlayerType', 'rockthrower')), 0, 'no loaded ammunition written');
    assert(![...World.gameMap.getZone(p.x - 1, p.z - 1, p.level).getAllLocsSafe()]
      .some(loc => loc.x === p.x - 1 && loc.z === p.z - 1 && loc.type === id('LocType', 'multicannon_base')),
    'refused setup creates no cannon base');
    console.log('PASS Mage Arena cannon: native Set-up is refused');
  } finally {
    World.players[p.slot] = null;
    p.unlink(); p.cleanup();
  }
}

for (const gate of gates) {
  const equipment = ['rune_halberd', 'abyssal_whip', 'rune_claws'];
  if (gate.permitsGear) equipment.push('bronze_platebody');
  for (const item of equipment) {
    for (const location of ['inventory', 'worn']) exercise(gate, item, location);
  }
  exercise(gate, null, null);
}
exercise({ ...gates[1], name: 'Mage Arena barrier without permission',
  setup: p => variable(p, 'magearena', 0), denied: true,
  refusal: 'You cannot enter without the permission of Kolodion.' }, 'rune_halberd', 'worn');
arenaMeleeRefused();
cannonFireCase('autocast owner inside', [0, 3105, 3934], [0, 3108, 3934], false);
cannonFireCase('autocast owner outside, target inside', [0, 3105, 3910], [0, 3108, 3915], false);
cannonFireCase('outside control still fires', [0, 3220, 3220], [0, 3223, 3220], true);
arenaCannonSetupRefused();
console.log('PASS weapon-gates: three weapon bans, unrestricted Mage Arena equipment, Kolodion permission, magic-only combat and cannon refusal');
process.exit(0);
