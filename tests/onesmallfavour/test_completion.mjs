#!/usr/bin/env node
// Run in the sibling engine after a full build:
// NODE_MEMBERS=true NODE_XPRATE=1 node --import tsx ../content/tests/onesmallfavour/test_completion.mjs
import assert from 'node:assert/strict';
import {
  PlayerStat, ScriptState, button, count, dialoguePage, engineModule, execute,
  id, inv, obj, player, resumeDialogue, seed, startDialogue, types
} from '../swamp-caves/runtime.mjs';

process.on('uncaughtException', error => { console.error(error); process.exit(1); });
process.on('unhandledRejection', error => { console.error(error); process.exit(1); });
const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await engineModule('engine/entity/EntityLifeCycle.ts');
const Environment = (await engineModule('util/Environment.ts')).default;
assert.equal(Environment.NODE_XPRATE, 1, 'measure the script XP argument without a multiplier');
const quest = id('VarPlayerType', 'onesmallfavour');
const qp = id('VarPlayerType', 'qp');
const used = id('VarBitType', 'reward_lamps_used');
// CANDIDATE: registered early-2014 completion predicate; not a proven 377 integer.
const complete = 276;
const lamp = 'thosf_reward_lamp';
const ring = 'favour_key_ring';
const log = 'favour_mahogany_log';
const npcId = id('NpcType', 'shiloantiques');
const yanni = () => new Npc(0, 2835, 2985, 1, 1, EntityLifeCycle.DESPAWN, 1, npcId, types.NpcType.get(npcId).blockwalk);
const points = p => execute('[proc,count_questpoints]', p).popInt();
const texts = p => new Map(p.packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => [packet.component, packet.text]));

function handIn(p) {
  const state = startDialogue('[opnpc1,shiloantiques]', p, yanni());
  let choices = 0;
  for (let page = 0; state.execution === ScriptState.PAUSEBUTTON && page < 40; page++) {
    const root = types.Component.get(p.modalChat).comName;
    if (/^multi[2-5]$/.test(root)) {
      assert(dialoguePage(p).includes("Here's the red mahogany you asked for."), 'earned hand-in is offered');
      choices++;
      resumeDialogue(p, 1);
    } else {
      resumeDialogue(p);
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'hand-in finishes without a suspended tail');
  assert.equal(choices, 1, 'one reward hand-in choice');
}

assert.equal(types.VarPlayerType.get(quest).scope, types.VarPlayerType.SCOPE_PERM, 'completion survives logout');
{
  const p = player();
  p.setVar(quest, 42); // Last earned stage, not the terminal produced by the hand-in.
  seed(p, [log]);
  const before = points(p);
  p.setVar(qp, before);
  handIn(p);
  assert.equal(p.getVar(quest), complete, 'Yanni writes the registered completion, not the old stage 45');
  assert.equal(count(p, log), 0, 'red mahogany is consumed');
  assert.equal(count(p, ring), 1, 'one steel key ring');
  assert.equal(count(p, lamp), 2, 'two antique lamps');
  assert.equal(p.getVar(qp), before + 2, 'two quest points awarded immediately');
  assert.equal(points(p), before + 2, 'quest-point recount agrees');
  const rows = texts(p);
  assert.equal(rows.get(id('Component', 'questscroll_death:com_3')), 'You have completed One Small Favour!');
  assert.equal(rows.get(id('Component', 'questscroll_death:com_9')), '2 Quest Points');
  const rewards = [10, 11, 12, 13, 14].map(row => rows.get(id('Component', `questscroll_death:com_${row}`)));
  assert.deepEqual(rewards, ['2 x 10000 experience', 'Steel Keyring', 'Ability to fly to the Feldip', 'Hills', '']);
  assert.equal(p.modalMain, types.Component.get(id('Component', 'questscroll_death:com_3')).rootLayer, 'completion scroll opens');
  p.closeModal();
  p.packets.length = 0;
  execute('[proc,update_questlist]', p);
  assert(p.packets.some(packet => packet.constructor.name === 'IfSetColour' && packet.component === id('Component', 'questlist:onesmallfavour') && packet.colour === 0x3e0), 'login refresh colours completed quest green');
  p.packets.length = 0;
  const repeat = startDialogue('[opnpc1,shiloantiques]', p, yanni());
  resumeDialogue(p); resumeDialogue(p);
  assert(!dialoguePage(p).includes("Here's the red mahogany you asked for."), 'completion cannot repeat the reward branch');
  resumeDialogue(p, 3); resumeDialogue(p); resumeDialogue(p);
  assert.equal(repeat.execution, ScriptState.FINISHED);
  assert.equal(count(p, ring), 1); assert.equal(count(p, lamp), 2);
  assert.equal(p.getVar(qp), before + 2, 'repeat talk awards no extra quest points');
  assert.equal(p.modalMain, -1, 'repeat talk opens no completion scroll');
}
for (const [stage, hasLog] of [[41, true], [42, false]]) {
  const p = player(); p.setVar(quest, stage);
  if (hasLog) seed(p, [log]);
  startDialogue('[opnpc1,shiloantiques]', p, yanni());
  resumeDialogue(p); resumeDialogue(p);
  assert(!dialoguePage(p).includes("Here's the red mahogany you asked for."), 'unearned or missing-log hand-in is not offered');
  assert.equal(p.getVar(quest), stage); assert.equal(count(p, lamp), 0); assert.equal(points(p), 0);
}
for (const [buttonName, stat] of Object.entries({
  attack: 'ATTACK', strength: 'STRENGTH', ranged: 'RANGED', magic: 'MAGIC', defence: 'DEFENCE',
  hitpoints: 'HITPOINTS', prayer: 'PRAYER', agility: 'AGILITY', herblore: 'HERBLORE',
  thieving: 'THIEVING', crafting: 'CRAFTING', runecraft: 'RUNECRAFT', mining: 'MINING',
  smithing: 'SMITHING', fishing: 'FISHING', cooking: 'COOKING', firemaking: 'FIREMAKING',
  woodcutting: 'WOODCUTTING', fletching: 'FLETCHING', slayer: 'SLAYER', farming: 'FARMING'
})) {
  const p = player(); p.setVar(quest, complete);
  p.setVar(id('VarPlayerType', 'druidquest'), 4); p.setVar(id('VarPlayerType', 'runemysteries'), 6);
  const skill = PlayerStat[stat]; assert.notEqual(skill, undefined, stat);
  p.baseLevels[skill] = 31; p.levels[skill] = 31;
  seed(p, [lamp, lamp]);
  const before = p.stats[skill];
  for (let use = 1; use <= 2; use++) {
    execute(`[opheld1,${lamp}]`, p);
    assert(button(p, `xplamp:${buttonName}`), 'real skill button accepted');
    assert(button(p, 'xplamp:confirm'), 'real Confirm button accepted');
    assert.equal(p.stats[skill] - before, use * 100000, '10000 XP per lamp in server tenths');
    assert.equal(count(p, lamp), 2 - use); assert.equal(p.getVarBit(used), use);
    assert.equal(p.getVar(quest), complete, 'Rub does not change completion');
  }
}
{
  const p = player(); seed(p, [lamp]);
  execute(`[opheld1,${lamp}]`, p);
  const before = p.stats[PlayerStat.ATTACK];
  assert(button(p, 'xplamp:confirm'));
  assert.equal(count(p, lamp), 1, 'no selection consumes no lamp');
  assert.equal(p.stats[PlayerStat.ATTACK], before);
  p.baseLevels[PlayerStat.ATTACK] = 30;
  assert(button(p, 'xplamp:attack')); assert(button(p, 'xplamp:confirm'));
  assert.equal(count(p, lamp), 1, 'retained over-30 floor refuses base level 30');
  assert.equal(p.stats[PlayerStat.ATTACK], before); assert.equal(p.getVarBit(used), 0);
  p.invDel(inv, obj(lamp), 1);
  assert(button(p, 'xplamp:confirm'));
  assert.equal(p.stats[PlayerStat.ATTACK], before, 'removed lamp grants no XP');
}
console.log('PASS compiled One Small Favour: earned completion, scroll, QP, permanent scope, login colour, repeat gates, all 21 lamp skills, two uses, no selection, level floor and missing lamp');
process.exit(0);
