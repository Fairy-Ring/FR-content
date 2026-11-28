import assert from 'node:assert/strict';
import { advance, button, check, coord, count, draws, environmentTick, finish, held, id, obj, player, run, tile, v, O, engineModule } from './runtime.mjs';

const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const moveHandler = new ((await engineModule('network/game/client/handler/MoveClickHandler.ts')).default)();
const CloseModal = (await engineModule('network/game/client/model/CloseModal.ts')).default;
const closeHandler = new ((await engineModule('network/game/client/handler/CloseModalHandler.ts')).default)();
const { ModalState } = await engineModule('engine/entity/ModalState.ts');
const IfOpenChat = (await engineModule('network/game/server/model/IfOpenChat.ts')).default;

const event = 24;
const questionProc = '[proc,macro_quiz_choose_question]';
const components = [5, 6, 7].map(index => id('Component', `pick_the_odd_one_out:com_${index}`));
const nativeObjs = [
  'macro_quiz_food1', 'macro_quiz_food2',
  'macro_quiz_weapon1', 'macro_quiz_weapon2',
  'macro_quiz_armour1', 'macro_quiz_armour2',
  'macro_quiz_tool1', 'macro_quiz_tool2',
  'macro_quiz_jewel1', 'macro_quiz_jewel2',
].map(name => obj(name));
const question = ({ odd, offset, oddVariant, commonFirst, correct }) => [odd, offset, oddVariant, commonFirst, correct];

function enter(drawsForQuestion) {
  const p = player();
  draws({ [questionProc]: [...drawsForQuestion] }, () => run(p, '[proc,macro_event_general_spawn]', [event]));
  assert.equal(p.getVar(v('macro_event')), event);
  assert.deepEqual(tile(p), [1, 1952, 4764], 'Quiz Master entry reaches the native L1 contestant chair tile');
  assert.equal(p.modalChat, id('Component', 'pick_the_odd_one_out'));
  assert.equal(p.modalTutorial, -1, 'questions use chat modal so sarnie_rotate animates');
  return p;
}
function renderedObjs(p) {
  const updates = p.packets
    .filter(packet => packet.constructor.name === 'IfSetObject' && components.includes(packet.component))
    .slice(-3);
  const byComponent = new Map(updates.map(packet => [packet.component, [packet.obj, packet.scale]]));
  return components.map(component => byComponent.get(component));
}
function expectedObjs({ odd, offset, oddVariant, commonFirst, correct }) {
  const common = offset >= odd ? offset + 1 : offset;
  const commonSecond = 1 - commonFirst;
  let seen = 0;
  return [0, 1, 2].map(slot => {
    if (slot === correct) return [nativeObjs[odd * 2 + oddVariant], 180];
    const variant = seen++ === 0 ? commonFirst : commonSecond;
    return [nativeObjs[common * 2 + variant], 180];
  });
}
function answer(p, index) {
  assert(button(p, `pick_the_odd_one_out:com_${5 + index}`), `native answer button ${index} is accepted`);
}
function answerCurrent(p) {
  answer(p, p.getVar(v('xplamp')) % 3);
}
function openPrizeDialogue(p) {
  p.processQueues();
  assert.notEqual(p.modalChat, id('Component', 'pick_the_odd_one_out'), 'prize uses Quiz Master dialogue, not the 3-slot quiz board');
  assert(p.activeScript, 'prize dialogue script is active and waiting for player input');
}

for (let odd = 0; odd < 5; odd++) {
  for (let oddVariant = 0; oddVariant < 2; oddVariant++) {
    for (let correct = 0; correct < 3; correct++) {
      const spec = { odd, offset: (odd + 1) % 4, oddVariant, commonFirst: 0, correct };
      check(`Quiz native category ${odd} variant ${oddVariant} correct position ${correct}`, () => {
        const p = enter(question(spec));
        const shown = renderedObjs(p);
        assert.deepEqual(shown, expectedObjs(spec));
        assert.equal(new Set(shown.map(([o]) => o)).size, 3, 'all three displayed items are distinct');
        assert.equal(p.getVar(v('macro_transmit')), 0);
        assert.equal(p.getVar(v('xplamp')) % 3, correct);
        run(p, '[proc,macro_arena_return]', [event]);
      });
    }
  }
}

check('Quiz wrong answers preserve the complete question and a correct answer advances once', () => {
  const first = { odd: 2, offset: 1, oddVariant: 1, commonFirst: 0, commonSecond: 1, correct: 2 };
  const second = { odd: 0, offset: 2, oddVariant: 0, commonFirst: 1, commonSecond: 0, correct: 1 };
  const p = player();
  draws({ [questionProc]: [...question(first), ...question(second)] }, () => {
    run(p, '[proc,macro_event_general_spawn]', [event]);
    const packed = p.getVar(v('xplamp'));
    const objs = renderedObjs(p);
    const wrongPacketStart = p.packets.length;
    answer(p, 0);
    assert.equal(p.getVar(v('xplamp')), packed);
    assert.equal(p.getVar(v('macro_transmit')), 0);
    assert.deepEqual(renderedObjs(p), objs);
    const retryPackets = p.packets.slice(wrongPacketStart);
    const textIndex = retryPackets.findIndex(packet => packet.constructor.name === 'IfSetText'
      && packet.component === id('Component', 'pick_the_odd_one_out:com_8') && packet.text === 'Wrong. Try again.');
    const repaintIndex = retryPackets.findIndex(packet => packet instanceof IfOpenChat
      && packet.component === id('Component', 'pick_the_odd_one_out'));
    assert(textIndex >= 0, 'the wrong answer updates the native retry text');
    assert(repaintIndex > textIndex, 'the chat root is reopened after its text update to repaint the chatbox');
    answer(p, 2);
    assert.equal(p.getVar(v('macro_transmit')), 1);
    assert.deepEqual(renderedObjs(p), expectedObjs(second));
  });
  run(p, '[proc,macro_arena_return]', [event]);
});

check('Quiz relog preserves round/question, then four correct answers choose the mystery box and return', () => {
  const questions = [
    { odd: 0, offset: 1, oddVariant: 1, commonFirst: 0, commonSecond: 1, correct: 2 },
    { odd: 4, offset: 0, oddVariant: 0, commonFirst: 1, commonSecond: 0, correct: 1 },
    { odd: 2, offset: 3, oddVariant: 1, commonFirst: 0, commonSecond: 1, correct: 0 },
    { odd: 1, offset: 2, oddVariant: 0, commonFirst: 1, commonSecond: 0, correct: 2 },
  ];
  const p = player();
  draws({ [questionProc]: questions.flatMap(question) }, () => {
    run(p, '[proc,macro_event_general_spawn]', [event]);
    answerCurrent(p);
    const packed = p.getVar(v('xplamp'));
    const objs = renderedObjs(p);
    run(p, '[proc,macro_event_logout]');
    p.closeModal();
    p.timers.clear();
    assert.equal(p.modalChat, -1, 'logout closes the chat interface before restoring the question');
    run(p, '[queue,macro_event_login]');
    assert.equal(p.getVar(v('macro_event')), event);
    assert.equal(p.getVar(v('macro_transmit')), 1);
    assert.equal(p.getVar(v('xplamp')), packed);
    assert.equal(p.modalChat, id('Component', 'pick_the_odd_one_out'));
    assert.deepEqual(renderedObjs(p), objs);
    answerCurrent(p);
    answerCurrent(p);
    answerCurrent(p);
    assert.equal(p.getVar(v('macro_transmit')), 4);
    assert.equal(p.getVar(v('xplamp')), 3, 'completed task retains the prize-screen sentinel');
    openPrizeDialogue(p);
    finish(p, [2]);
  });
  assert.equal(p.getVar(v('macro_event')), 0);
  assert.deepEqual(tile(p), O);
  assert.equal(count(p, 'macro_quiz_mystery_box'), 1);
  assert.equal(p.modalChat, -1);
  assert.equal(p.modalTutorial, -1);
  assert.equal(p.modalState & ModalState.TUT, 0);
});

check('Quiz cash choice awards exactly 1000 coins and returns after four correct answers', () => {
  const questions = [
    { odd: 0, offset: 0, oddVariant: 0, commonFirst: 0, commonSecond: 1, correct: 0 },
    { odd: 1, offset: 0, oddVariant: 1, commonFirst: 1, commonSecond: 0, correct: 1 },
    { odd: 2, offset: 0, oddVariant: 0, commonFirst: 0, commonSecond: 1, correct: 2 },
    { odd: 3, offset: 0, oddVariant: 1, commonFirst: 1, commonSecond: 0, correct: 0 },
  ];
  const p = player();
  draws({ [questionProc]: questions.flatMap(question) }, () => {
    run(p, '[proc,macro_event_general_spawn]', [event]);
    for (let round = 0; round < 4; round++) answerCurrent(p);
    openPrizeDialogue(p);
    // Dismissing the prize dialogue via viewport click/close recovers via keepalive softtimer.
    assert(moveHandler.handle(new MoveClick([{ x: p.x, z: p.z }], 0, false), p));
    assert(closeHandler.handle(new CloseModal(), p));
    environmentTick(p);
    environmentTick(p);
    run(p, '[softtimer,macro_quiz_keepalive]');
    openPrizeDialogue(p);
    finish(p, [1]);
  });
  assert.equal(p.getVar(v('macro_event')), 0);
  assert.deepEqual(tile(p), O);
  assert.equal(count(p, 'coins'), 1000);
  assert.equal(count(p, 'macro_quiz_mystery_box'), 0);
  assert.equal(p.modalChat, -1);
  assert.equal(p.modalTutorial, -1);
  assert.equal(p.modalState & ModalState.TUT, 0);
});

const mysteryBoxOutcomes = [
  [0, 'cabbage', 1],
  [1, 'steel_platebody', 1],
  [2, 'bucket_empty', 1],
  [3, 'flier', 1],
  [4, 'old_boot', 1],
  [5, 'naturerune', 20],
  [6, 'uncut_ruby', 1],
];
for (const [outcome, reward, amount] of mysteryBoxOutcomes) check(`Quiz mystery box native Open yields outcome ${outcome}`, () => {
  const p = player();
  p.invAdd(id('InvType', 'inv'), id('ObjType', 'macro_quiz_mystery_box'), 1);
  const draw = outcome === 6 ? [outcome, 2] : [outcome];
  draws({ '[proc,macro_quiz_open_box]': draw }, () => {
    assert(held(p, 'macro_quiz_mystery_box', 1), 'native inventory Open action is accepted outside an event');
    if (p.activeScript) advance(p, p.activeScript);
  });
  assert.equal(p.getVar(v('macro_event')), 0);
  assert.equal(count(p, 'macro_quiz_mystery_box'), 0, 'one box is consumed');
  assert.equal(count(p, reward), amount, `outcome ${outcome} grants ${amount} ${reward}`);
});

check('Quiz escape closes the native interface and returns without a prize', () => {
  const spec = { odd: 2, offset: 1, oddVariant: 0, commonFirst: 0, commonSecond: 1, correct: 0 };
  const p = enter(question(spec));
  const coins = count(p, 'coins');
  p.closeModal();
  run(p, '[proc,p_telejump_safe]', [coord(O)]);
  run(p, '[softtimer,macro_arena_guard]');
  environmentTick(p);
  assert.equal(p.getVar(v('macro_event')), 0);
  assert.equal(count(p, 'coins'), coins);
  assert.equal(count(p, 'macro_quiz_mystery_box'), 0);
  assert.deepEqual(tile(p), O);
  assert.equal(p.modalMain, -1);
  assert.equal(p.modalChat, -1);
  assert.equal(p.modalTutorial, -1);
  assert.equal(p.modalState & ModalState.TUT, 0);
});

check('Quiz viewport and close packets recover via keepalive softtimer with exact question objects', () => {
  const spec = { odd: 3, offset: 0, oddVariant: 1, commonFirst: 0, commonSecond: 1, correct: 1 };
  const p = enter(question(spec));
  const identity = p.getVar(v('xplamp')), objs = renderedObjs(p);
  assert(moveHandler.handle(new MoveClick([{ x: p.x, z: p.z }], 0, false), p));
  assert(closeHandler.handle(new CloseModal(), p));
  environmentTick(p);
  assert.equal(p.modalChat, -1, 'CloseModal dismisses the chat modal');
  run(p, '[softtimer,macro_quiz_keepalive]');
  p.processQueues();
  assert.equal(p.modalChat, id('Component', 'pick_the_odd_one_out'), 'keepalive reopens the active quiz question');
  assert.equal(p.getVar(v('xplamp')), identity);
  assert.deepEqual(renderedObjs(p), objs);
  answer(p, 0);
  assert.equal(p.getVar(v('macro_transmit')), 0, 'wrong native button still reaches the production handler');
  answerCurrent(p);
  assert.equal(p.getVar(v('macro_transmit')), 1, 'the correct native button remains actionable');
  run(p, '[proc,macro_arena_return]', [event]);
  assert.equal(p.modalChat, -1);
  assert.equal(p.modalTutorial, -1);
  assert(!button(p, 'pick_the_odd_one_out:com_5'), 'stale closed buttons are rejected');
});

console.log('Quiz Master compiled checks passed');
// Native World imports own workers; every assertion above is synchronous and complete.
process.exit(0);
