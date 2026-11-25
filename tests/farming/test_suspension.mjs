/** Real compiled Player continuation while Farming reconciliation advances a protected crop. */
import assert from 'node:assert/strict';
import { World, Runner, Scripts, State, ScriptOpcode, PlayerStat,
  types, id, player, proc, add, count, load } from './runtime.mjs';

const Trigger = (await load('engine/script/ServerTriggerType.ts')).default;
const reconcile = Scripts.getByName('[proc,farming_reconcile]');
assert(reconcile, 'the shared Farming reconciliation procedure is compiled');
const clock = id('VarPlayerType', 'farming_growth_minute');
const allotment = id('VarPlayerType', 'farming_allotment_varp_1');
const protection = id('VarPlayerType', 'farming_protection');
const gardenerType = types.NpcType.get(id('NpcType', 'elstan'));
const gardener = [...World.npcs].find(npc => npc.type === gardenerType.id);
assert(gardener, 'the original map supplies Elstan for native Talk-to dispatch');
const talk = Scripts.getByTrigger(Trigger.OPNPC1, gardenerType.id, gardenerType.category);
assert(talk, 'the compiled native Talk-to trigger reaches the gardener dialogue');

const oldDate = Runner.HANDLERS[ScriptOpcode.DATE_MINUTES];
const oldRandom = Runner.HANDLERS[ScriptOpcode.RANDOM];
const oldTick = World.currentTick;
let minute = 609;
let p;
Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(minute);
Runner.HANDLERS[ScriptOpcode.RANDOM] = state => {
  const range = state.popInt();
  state.pushInt(range - 1);
};

try {
  World.currentTick = 1000;
  p = player();
  p.setVar(allotment, 9); // Seed the potato from growth stage 9, one step before maturity.
  p.setVar(clock, minute);
  add(p, 'bucket_compost', 2);
  proc(p, 'farming_login');

  const initialXp = p.stats[PlayerStat.FARMING];
  const initialMessages = p.messages.length;
  const state = Runner.init(talk, p, gardener);
  p.executeScript(state, true, true);

  const choices = [3, 1, 1]; // Pay for care, choose the north allotment, then accept.
  let menuCount = 0;
  for (let resumes = 0; state.execution !== State.FINISHED && resumes < 500; resumes++) {
    if (state.execution === State.SUSPENDED) {
      assert(p.delayed, 'a delayed Player continuation remains suspended');
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
    } else {
      assert.equal(state.execution, State.PAUSEBUTTON, 'dialogue waits for a player response');
      const root = p.modalChat >= 0 ? types.Component.get(p.modalChat)?.comName ?? '' : '';
      if (/^multi[2-5]$/.test(root)) {
        const choice = choices[menuCount++];
        assert.notEqual(choice, undefined, 'the dialogue presents only expected choices');
        if (menuCount === 3) {
          assert.equal(p.getVar(allotment) & 255, 9, 'the crop is immature at the confirmation menu');
          minute = 610;
          const reconcileState = Runner.init(reconcile, p, null, [false]);
          p.executeScript(reconcileState, false);
          assert.equal(reconcileState.execution, State.FINISHED,
            'the compiled online reconciliation runs while the dialogue remains paused');
          assert.equal(p.getVar(allotment) & 255, 10, 'online reconciliation matures the crop while the choice is open');
          assert.equal(state.execution, State.PAUSEBUTTON, 'the gardener dialogue remains paused after growth');
        }
        p.lastCom = id('Component', `${root}:com_${choice}`);
        assert(p.resumeButtons.includes(p.lastCom), `${root} exposes the selected native menu row`);
      }
    }
    p.executeScript(state, true, true);
  }

  assert.equal(state.execution, State.FINISHED, 'the real gardener Player continuation completes');
  assert.equal(menuCount, choices.length, 'the test answered all three native dialogue menus');
  assert.equal(p.getVar(allotment) & 255, 10, 'growth remains intact after the dialogue resumes');
  assert.equal(count(p, 'bucket_compost'), 2, 'a crop that matured during confirmation is not charged');
  assert.equal(p.getVar(protection) & 1, 0, 'a mature crop does not receive a protection flag');
  assert.equal(p.stats[PlayerStat.FARMING], initialXp, 'the refusal grants no Farming XP');
  assert.deepEqual(p.messages.slice(initialMessages), ['Nothing interesting happens.'],
    'a changed crop receives the published default refusal after the stale offer');
  console.log('PASS Farming reconciliation during gardener confirmation refuses without charge or state loss');
} finally {
  if (p) p.unlink();
  Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = oldDate;
  Runner.HANDLERS[ScriptOpcode.RANDOM] = oldRandom;
  World.currentTick = oldTick;
}
process.exit(0);
