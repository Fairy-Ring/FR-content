import assert from 'node:assert/strict';
import { advance, button, check, count, draws, environmentTick, id, player, run, ScriptState, tile, v, World, PlayerStat, ScriptRunner, op, types } from './runtime.mjs';

const event = 21;
const actionComponent = index => `macro_mime_emotes:com_${index + 2}`;
function answer(p, index) {
  assert(button(p, actionComponent(index)), `native Mime button ${index} is accepted`);
  const state = p.activeScript;
  if (state?.execution === ScriptState.SUSPENDED) advance(p, state);
  environmentTick(p);
}
function assertMimeActor() {
  const actor = [...World.npcs].find(n => n.isActive && n.type === id('NpcType', 'macro_mime') && n.level === 1 && n.x === 2007 && n.z === 4764);
  assert(actor, 'the native mime actor is created on the stage');
}

check('Mime copies a three-step native interface routine and grants one missing reward group', () => {
  const p = player();
  draws({ '[proc,macro_mime_choose_action]': [6, 2, 1], '[proc,macro_mime_reward]': [4] }, () => {
    run(p, '[proc,macro_event_general_spawn]', [event]);
    assert.equal(p.getVar(v('macro_event')), event);
    assert.deepEqual(tile(p), [1, 2014, 4764]);
    assertMimeActor();
    assert.equal(p.getVar(v('macro_transmit')), 6);
    answer(p, 6);
    assert.equal(p.getVar(v('xplamp')), 1);
    assert.equal(p.getVar(v('macro_transmit')), 2);
    answer(p, 2);
    assert.equal(p.getVar(v('xplamp')), 2);
    assert.equal(p.getVar(v('macro_transmit')), 1);
    answer(p, 1);
  });
  assert.deepEqual(tile(p), [0, 3222, 3218]);
  assert.equal(p.getVar(v('macro_event')), 0);
  assert.equal(p.getVar(v('macro_event_origin_coord')), -1);
  assert.equal(count(p, 'macro_mime_mask'), 1);
});

check('Mime wrong action restarts the performance without invented damage or teleport', () => {
  const p = player();
  const hitpoints = p.levels[PlayerStat.HITPOINTS];
  draws({ '[proc,macro_mime_choose_action]': [6, 2] }, () => {
    run(p, '[proc,macro_event_general_spawn]', [event]);
    assertMimeActor();
    answer(p, 0);
  });
  assert.equal(p.getVar(v('macro_event')), event);
  assert.equal(p.getVar(v('xplamp')), 0);
  assert.equal(p.getVar(v('macro_transmit')), 2);
  assert.deepEqual(tile(p), [1, 2014, 4764]);
  assert.equal(p.levels[PlayerStat.HITPOINTS], hitpoints);
  assert.equal(count(p, 'macro_mime_mask'), 0);
  run(p, '[proc,macro_arena_return]', [event]);
});

check('Mime login preserves copied-action progress and completes exactly once', () => {
  const p = player();
  draws({ '[proc,macro_mime_choose_action]': [6, 2, 1], '[proc,macro_mime_reward]': [0] }, () => {
    run(p, '[proc,macro_event_general_spawn]', [event]);
    answer(p, 6);
    assert.equal(p.getVar(v('xplamp')), 1);
    const expected = p.getVar(v('macro_transmit'));
    run(p, '[proc,macro_event_logout]');
    p.closeModal(); p.timers.clear();
    World.currentTick += 1000;
    run(p, '[queue,macro_event_login]');
    assert.equal(p.getVar(v('macro_event')), event);
    assert.equal(p.getVar(v('xplamp')), 1);
    assert.equal(p.getVar(v('macro_transmit')), expected);
    assertMimeActor();
    answer(p, 2);
    answer(p, 1);
  });
  assert.deepEqual(tile(p), [0, 3222, 3218]);
  assert.equal(p.getVar(v('macro_event')), 0);
  assert.equal(p.getVar(v('xplamp')), 0);
  assert.equal(p.getVar(v('emote_access')) & 1, 1, 'the selected reward group unlocks the native emote_glasswall varbit');
});

check('Mime seven reward groups avoid bank and worn duplicates and award 500 coins after completion', () => {
  const p = player();
  for (const group of [0, 1, 2, 3, 4, 6]) run(p, '[proc,macro_mime_grant_group]', [group]);
  const bank = id('InvType', 'bank'), worn = id('InvType', 'worn');
  p.invAdd(bank, id('ObjType', 'macro_mime_top'), 1);
  p.invAdd(worn, id('ObjType', 'macro_mime_boots'), 1);
  run(p, '[proc,macro_mime_reward]');
  assert.equal(count(p, 'macro_mime_top', bank), 1);
  assert.equal(count(p, 'macro_mime_top'), 0);
  assert.equal(count(p, 'macro_mime_boots', worn), 1);
  assert.equal(count(p, 'macro_mime_boots'), 0);
  assert.equal(count(p, 'coins'), 500);
});

check('Mime earns all seven unique groups through complete routines, then coins, then replaces only lost clothing', () => {
  const p = player();
  const routine = () => draws({ '[proc,macro_mime_choose_action]': [0,1,2], '[proc,macro_mime_reward]': [0] }, () => {
    run(p, '[proc,macro_event_general_spawn]', [event]);
    for (const action of [0,1,2]) answer(p, action);
    assert.equal(p.getVar(v('macro_event')), 0); assert.deepEqual(tile(p), [0,3222,3218]);
  });
  for (let completed = 0; completed < 7; completed++) routine();
  for (const bit of ['emote_glasswall','emote_glassbox','emote_lean','emote_climbrope']) assert.equal(p.getVarBit(id('VarBitType', bit)), 1);
  const clothing = ['macro_mime_mask','macro_mime_top','macro_mime_boots','macro_mime_gloves','macro_mime_legs'];
  for (const item of clothing) assert.equal(count(p,item), 1, `one earned ${item}`);
  routine(); assert.equal(count(p,'coins'), 500, 'complete collection gets the sourced favourable coin fallback');
  // Labelled compiled loss fixture: remove one actually earned piece, never seed a reward.
  p.invDel(id('InvType','inv'), id('ObjType','macro_mime_boots'), 1);
  routine();
  for (const item of clothing) assert.equal(count(p,item), 1, 'replacement never duplicates an owned companion piece');
  assert.equal(count(p,'coins'), 500, 'lost-piece replacement is not also a fallback coin award');
});

const mimeActions = [
  ['Cry', 'emote_cry'], ['Think', 'emote_think'], ['Laugh', 'emote_laugh'], ['Dance', 'emote_dance'],
  ['Climb Rope', 'emote_climbing_rope'], ['Lean on air', 'emote_mime_lean'],
  ['Glass Wall', 'emote_glass_wall'], ['Glass Box', 'emote_glass_box']
];
for (const [index, [label, sequence]] of mimeActions.entries()) check(`Mime native ${label} demonstrates and copies its original animation`, () => {
  const p = player(), seen = [];
  const playerAnim = ScriptRunner.HANDLERS[op.ANIM], npcAnim = ScriptRunner.HANDLERS[op.NPC_ANIM];
  ScriptRunner.HANDLERS[op.ANIM] = state => { seen.push(['player', state.intStack[state.isp - 2]]); playerAnim(state); };
  ScriptRunner.HANDLERS[op.NPC_ANIM] = state => { seen.push(['mime', state.intStack[state.isp - 2]]); npcAnim(state); };
  try {
    draws({ '[proc,macro_mime_choose_action]': [index, index] }, () => {
      run(p, '[proc,macro_event_general_spawn]', [event]);
      assert.equal(types.Component.get(id('Component', actionComponent(index))).text, label);
      answer(p, index);
      assert.equal(p.getVar(v('xplamp')), 1, 'matching native choice advances exactly one step');
    });
    assert(seen.some(([who, seq]) => who === 'mime' && seq === id('SeqType', sequence)));
    assert(seen.some(([who, seq]) => who === 'player' && seq === id('SeqType', sequence)));
    const actor = p.getVar(v('macro_event_uid'));
    run(p, '[proc,macro_event_logout]');
    assert(!World.getNpcByUid(actor)?.isActive, 'logout removes only the owned performance actor');
    assert.equal(p.getVar(v('macro_event')), event, 'logout retains durable task progress');
    run(p, '[queue,macro_event_login]');
    const replacement = p.getVar(v('macro_event_uid'));
    assert(World.getNpcByUid(replacement)?.isActive, 'login recreates a real owned performer');
    run(p, '[proc,macro_arena_return]', [event]);
    assert(!World.getNpcByUid(replacement)?.isActive, 'return removes the replacement without orphaning an NPC');
  } finally { ScriptRunner.HANDLERS[op.ANIM] = playerAnim; ScriptRunner.HANDLERS[op.NPC_ANIM] = npcAnim; }
});

console.log('Mime compiled checks passed');
// Native World imports own workers; every assertion above is synchronous and complete.
process.exit(0);
