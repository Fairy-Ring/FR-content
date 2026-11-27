import assert from 'node:assert/strict';
import { advance, button, check, coord, count, draws, environmentTick, held, id, obj, player, run, tile, v, O, engineModule } from './runtime.mjs';

const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const moveHandler = new ((await engineModule('network/game/client/handler/MoveClickHandler.ts')).default)();
const CloseModal = (await engineModule('network/game/client/model/CloseModal.ts')).default;
const closeHandler = new ((await engineModule('network/game/client/handler/CloseModalHandler.ts')).default)();
const { ModalState } = await engineModule('engine/entity/ModalState.ts');

const event = 24;
const questionProc = '[proc,macro_quiz_choose_question]';
const components = [5, 6, 7].map(index => id('Component', `pick_the_odd_one_out:com_${index}`));
const nativeModels = [8830, 8831, 8837, 8828, 8834, 8833, 8836, 8838, 8835, 8832];
const question = ({ odd, offset, oddVariant, commonFirst, commonSecond, correct }) => [odd, offset, oddVariant, commonFirst, commonSecond, correct];

function enter(drawsForQuestion) {
  const p = player();
  draws({ [questionProc]: [...drawsForQuestion] }, () => run(p, '[proc,macro_event_general_spawn]', [event]));
  assert.equal(p.getVar(v('macro_event')), event);
  assert.deepEqual(tile(p), [0, 1952, 4769], 'Quiz Master entry reaches the assigned native scene tile');
  assert.equal(p.modalTutorial, id('Component', 'pick_the_odd_one_out'));
  return p;
}
function renderedModels(p) {
  const updates = p.packets
    .filter(packet => packet.constructor.name === 'IfSetModel' && components.includes(packet.component))
    .slice(-3);
  const byComponent = new Map(updates.map(packet => [packet.component, packet.model]));
  return components.map(component => byComponent.get(component));
}
function expectedModels({ odd, offset, oddVariant, commonFirst, commonSecond, correct }) {
  const common = offset >= odd ? offset + 1 : offset;
  let seen = 0;
  return [0, 1, 2].map(slot => {
    if (slot === correct) return nativeModels[odd * 2 + oddVariant];
    const variant = seen++ === 0 ? commonFirst : commonSecond;
    return nativeModels[common * 2 + variant];
  });
}
function answer(p, index) {
  assert(button(p, `pick_the_odd_one_out:com_${5 + index}`), `native answer button ${index} is accepted`);
}
function answerCurrent(p) {
  answer(p, p.getVar(v('xplamp')) % 3);
}
function prizeModels(p) {
  const updates = p.packets
    .filter(packet => packet.constructor.name === 'IfSetObject' && components.slice(0, 2).includes(packet.component))
    .slice(-2)
    .map(packet => [packet.component, packet.obj, packet.scale]);
  assert.deepEqual(updates, [
    [components[0], obj('coins'), 500],
    [components[1], obj('macro_quiz_mystery_box'), 500],
  ]);
}

for (let odd = 0; odd < 5; odd++) {
  for (let oddVariant = 0; oddVariant < 2; oddVariant++) {
    for (let correct = 0; correct < 3; correct++) {
      const spec = { odd, offset: (odd + 1) % 4, oddVariant, commonFirst: 0, commonSecond: 1, correct };
      check(`Quiz native category ${odd} variant ${oddVariant} correct position ${correct}`, () => {
        const p = enter(question(spec));
        assert.deepEqual(renderedModels(p), expectedModels(spec));
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
    const models = renderedModels(p);
    answer(p, 0);
    assert.equal(p.getVar(v('xplamp')), packed);
    assert.equal(p.getVar(v('macro_transmit')), 0);
    assert.deepEqual(renderedModels(p), models);
    answer(p, 2);
    assert.equal(p.getVar(v('macro_transmit')), 1);
    assert.deepEqual(renderedModels(p), expectedModels(second));
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
    const models = renderedModels(p);
    run(p, '[proc,macro_event_logout]');
    p.closeModal();
    p.timers.clear();
    assert.equal(p.modalTutorial, -1, 'logout clears the sticky interface before restoring the question');
    assert.equal(p.modalState & ModalState.TUT, 0);
    run(p, '[queue,macro_event_login]');
    assert.equal(p.getVar(v('macro_event')), event);
    assert.equal(p.getVar(v('macro_transmit')), 1);
    assert.equal(p.getVar(v('xplamp')), packed);
    assert.equal(p.modalTutorial, id('Component', 'pick_the_odd_one_out'));
    assert.deepEqual(renderedModels(p), models);
    answerCurrent(p);
    answerCurrent(p);
    answerCurrent(p);
    assert.equal(p.getVar(v('macro_transmit')), 4);
    assert.equal(p.getVar(v('xplamp')), 3, 'completed task retains the prize-screen sentinel');
    prizeModels(p);
    assert(button(p, 'pick_the_odd_one_out:com_6'), 'native mystery-box prize button is accepted');
  });
  assert.equal(p.getVar(v('macro_event')), 0);
  assert.deepEqual(tile(p), O);
  assert.equal(count(p, 'macro_quiz_mystery_box'), 1);
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
    prizeModels(p);
    assert(moveHandler.handle(new MoveClick([{ x: p.x, z: p.z }], 0, false), p));
    assert(closeHandler.handle(new CloseModal(), p));
    environmentTick(p);
    assert.equal(p.modalTutorial, id('Component', 'pick_the_odd_one_out'), 'prize choices survive viewport and close packets');
    assert(button(p, 'pick_the_odd_one_out:com_5'), 'native coin prize button is accepted');
  });
  assert.equal(p.getVar(v('macro_event')), 0);
  assert.deepEqual(tile(p), O);
  assert.equal(count(p, 'coins'), 1000);
  assert.equal(count(p, 'macro_quiz_mystery_box'), 0);
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

check('Quiz viewport and close packets retain all three native model buttons and exact framing', () => {
  const spec = { odd: 3, offset: 0, oddVariant: 1, commonFirst: 0, commonSecond: 1, correct: 1 };
  const p = enter(question(spec));
  const identity = p.getVar(v('xplamp')), models = renderedModels(p);
  const angles = p.packets.filter(packet => packet.constructor.name === 'IfSetAngle' && components.includes(packet.component)).slice(-3);
  assert.deepEqual(angles.map(packet => [packet.component, packet.xan, packet.yan, packet.zoom]),
    components.map((component, index) => [component, 0, 0, index === 2 ? 446 : 400]),
    'question models restore the cache framing rather than retaining prize object angles');
  assert(p.canAccess(), 'sticky chat does not block ordinary input');
  assert(moveHandler.handle(new MoveClick([{ x: p.x, z: p.z }], 0, false), p));
  assert(closeHandler.handle(new CloseModal(), p));
  environmentTick(p);
  assert.equal(p.modalTutorial, id('Component', 'pick_the_odd_one_out'));
  assert.equal(p.getVar(v('xplamp')), identity);
  assert.deepEqual(renderedModels(p), models);
  answer(p, 0);
  assert.equal(p.getVar(v('macro_transmit')), 0, 'wrong native button still reaches the production handler');
  answerCurrent(p);
  assert.equal(p.getVar(v('macro_transmit')), 1, 'the correct native button remains actionable');
  run(p, '[proc,macro_arena_return]', [event]);
  assert.equal(p.modalTutorial, -1);
  assert(!button(p, 'pick_the_odd_one_out:com_5'), 'stale closed buttons are rejected');
});

console.log('Quiz Master compiled checks passed');
// Native World imports own workers; every assertion above is synchronous and complete.
process.exit(0);
