// Packed production dispatch and RuneScript. Run from the built sibling engine:
// node --import tsx ../content/tests/beta-bankers/test_bankers.mjs
import assert from 'node:assert/strict';
import { World, types, map, player, id, count, engineModule, ScriptState, ServerTriggerType, resumeDialogue } from '../swamp-caves/runtime.mjs';
const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;

const forms = [
  ['mourning_elf_bankerm', 1, 3, 'Good day, how may I help you?', [0, -2]],
  ['mourning_elf_bankerf', 1, 3, 'Good day, how may I help you?', [0, -2]],
  ['dwarf_city_banker1', 1, 3, 'Welcome to the Keldagrim bank! Anything I can help you with?', [-2, -2]],
  ['elid_banker', 4, 3, 'Good day, how may I help you?', [2, 0]],
  ['fever_banker_01', 2, 3, 'Aye? Ye got some stuff te stash?', [-2, 0]],
  ['fever_banker_02', 1, 3, 'Aye? Ye got some stuff te stash?', [-2, 0]],
  ['ahoy_ghost_banker', 4, 3, null, [0, 2]],
  ['swan_arnold', 1, 4, null, [-2, -2]]
];
const root = name => id('Component', name);
const npcs = name => [...World.npcs].filter(n => n.baseType === id('NpcType', name));
function fixture(n) {
  const p = player();
  // Public counter-side stands, not isolated decor tiles or the teller enclosure.
  const [, , , , [dx, dz]] = forms.find(row => row[0] === types.NpcType.get(n.baseType).debugname);
  p.x = n.x + dx; p.z = n.z + dz; p.level = n.level; p.originX = p.x; p.originZ = p.z;
  assert(!map.isMapBlocked(p.x, p.z, p.level), 'public interaction stand is walkable');
  assert([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([x, z]) => map.isLineOfWalk(p.level, p.x, p.z, p.x + x, p.z + z)), 'public interaction stand is not an isolated tile');
  return p;
}
function dispatch(p, n, option, op = false) {
  p.target = n; p.targetOp = ServerTriggerType[`APNPC${option}`];
  const script = op ? p.getOpTrigger() : p.getApTrigger();
  assert(script, `${types.NpcType.get(n.type).debugname} ${op ? 'OPNPC' : 'APNPC'}${option} must dispatch through Player`);
  const state = ScriptRunner.init(script, p, n);
  p.executeScript(state, true, true);
  assert.notEqual(state.execution, ScriptState.ABORTED, `${script.name} must not abort`);
  return state;
}
const text = p => p.packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => packet.text.replaceAll('|', ' ')).join(' ').replace(/\s+/g, ' ').trim();
function finish(p, state, choices = []) {
  const pending = [...choices];
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 150; step++) {
    assert.equal(state.execution, ScriptState.PAUSEBUTTON, 'dialogue reaches a real button pause');
    const menu = /^multi[2-5]$/.test(types.Component.get(p.modalChat).comName);
    if (menu) assert(pending.length, `unanswered menu: ${text(p)}`);
    resumeDialogue(p, menu ? pending.shift() : null);
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'bounded dialogue finishes');
  assert.equal(pending.length, 0, 'all branch selections were consumed');
}
function eligible(p, name) {
  if (name === 'ahoy_ghost_banker') p.invAdd(id('InvType', 'worn'), id('ObjType', 'amulet_of_ghostspeak'), 1);
  if (name === 'swan_arnold') p.setVar(id('VarPlayerType', 'swansong_quest'), 200);
}
function conversation(name, choices, expected, expectedRoot = null, seed = 0, prepare = p => eligible(p, name)) {
  const n = npcs(name)[0], p = fixture(n);
  prepare(p);
  JavaRandom.setSeed(seed);
  const state = dispatch(p, n, 1);
  finish(p, state, choices);
  for (const line of expected) assert(text(p).includes(line), `${name} dialogue is missing ${line}`);
  if (expectedRoot) assert.equal(p.modalMain, root(expectedRoot), `${name} opens ${expectedRoot}`);
  return { p, state };
}
function bank(p) {
  assert.equal(p.modalMain, root('bank_main'), 'shared bank main opens');
  assert.equal(p.modalSide, root('bank_side'), 'shared bank side opens');
  for (const [inv, component] of [['inv', 'bank_side:inv'], ['bank', 'bank_main:bank']]) {
    assert(p.invListeners.some(l => l.type === id('InvType', inv) && l.com === root(component)), `${inv} uses the shared bank inventory listener`);
  }
}

for (const [name, placements, option, greeting] of forms) {
  const natural = npcs(name);
  assert.equal(natural.length, placements, `${name} original map placement count`);
  for (const n of natural) {
    const p = fixture(n);
    // Special eligibility is covered separately below, once per refusal branch.
    eligible(p, name);
    const state = dispatch(p, n, option);
    finish(p, state);
    bank(p);
  }
  if (greeting) {
    const n = natural[0], p = fixture(n), state = dispatch(p, n, 1);
    assert(text(p).includes(greeting), `${name} has its sourced greeting; observed: ${text(p)}`);
    assert.equal(state.execution, ScriptState.PAUSEBUTTON);
  }
  for (const operation of [1, option]) {
    const far = fixture(natural[0]); eligible(far, name);
    far.x = natural[0].x + 5; far.z = natural[0].z;
    const approached = dispatch(far, natural[0], operation);
    assert.equal(approached.execution, ScriptState.FINISHED);
    assert.equal(far.apRange, 2);
    assert.equal(far.apRangeCalled, true);
    assert.notEqual(far.modalMain, root('bank_main'));
  }
  console.log(`PASS ${name}: ${placements} natural placements dispatch Bank${greeting ? ' and sourced Talk-to' : ''}`);
}
for (const name of ['mourning_elf_bankerm', 'mourning_elf_bankerf']) {
  bank(conversation(name, [1], [], 'bank_main').p);
  conversation(name, [2], [], 'bankpin_settings');
  conversation(name, [3], ['What is this place?', 'This is an elven bank. The magic in this place allows you to access your account here in the western lands.']);
}
for (const name of ['fever_banker_01', 'fever_banker_02']) {
  bank(conversation(name, [1], [], 'bank_main').p);
  conversation(name, [2], [], 'bankpin_settings');
  conversation(name, [3, 1], ['This be a branch of the Bank of RuneScape. Ye may have heard of us.', 'And what do you do?', "We keep an eye on yer loot for ye. Leave yer valuables with us if ye want to keep 'em nice and safe."]);
  conversation(name, [3, 2], ['How secure is this place?', "Real secure. Before we got here, people were just dumpin' stuff into a bucket guarded by a man with an iron bar.", 'Since we arrived, we can get all the stuff organised nice and civil like, and with only half as many kneecappins.']);
}
const dwarf = 'dwarf_city_banker1';
conversation(dwarf, [3], [], 'bankpin_settings');
conversation(dwarf, [1, 3], ['Are you with the Bank of RuneScape?', 'Oh yes, we are a branch, but an independent branch.', "We have liaised with the Bank of RuneScape. It's healthy to keep a bit of trade going with the human population, you know.", 'Was there something else you wanted?'], 'bankpin_settings');
conversation(dwarf, [2, 3], ['Business has always gone well here, but now more than ever. We are getting a constant supply of gold from the new gold mine south of the city.', 'Oh yes, I helped to open that up you know!', 'Sure, sure.', 'Was there anything else I can help you with?'], 'bankpin_settings');
const acknowledgements = new Set();
for (const seed of [0, 4096]) {
  const { p } = conversation(dwarf, [4], ["I'd like to access my bank account please."], 'bank_main', seed);
  bank(p);
  for (const line of ['Of course.', 'Naturally.']) if (text(p).includes(line)) acknowledgements.add(line);
}
assert.deepEqual([...acknowledgements].sort(), ['Naturally.', 'Of course.'], 'both sourced bank acknowledgements execute');
const nardah = 'elid_banker';
bank(conversation(nardah, [1], ["I'd like to access my bank account, please."], 'bank_main').p);
conversation(nardah, [2], [], 'bankpin_settings');
conversation(nardah, [3, 1], ['What is this place?', 'This is a branch of the Bank of RuneScape. We have branches in many towns.', 'And what do you do?', 'We will look after your items and money for you. Leave your valuables with us if you want to keep them safe.']);
conversation(nardah, [3, 2], ["Didn't you used to be called the Bank of Varrock?", "Yes we did, but people kept on coming into our branches outside of Varrock and telling us that our signs were wrong. They acted as if we didn't know what town we were in or something."]);
console.log('PASS all regional and shared banker dialogue branches, PIN destinations and both dwarf acknowledgements');

const ghost = 'ahoy_ghost_banker';
const unheard = conversation(ghost, [], ['Woooo wooo wooooo woooo'], null, 0, () => {});
assert.equal(unheard.p.modalMain, -1, 'untranslated ghost Talk-to does not open the bank');
assert(!text(unheard.p).includes('Good day'), 'untranslated ghost does not speak understandable lines');
const carried = conversation(ghost, [], ['Woooo wooo wooooo woooo'], null, 0, p => p.invAdd(id('InvType', 'inv'), id('ObjType', 'amulet_of_ghostspeak'), 1));
assert.equal(carried.p.modalMain, -1, 'carried but unworn amulet does not translate Talk-to');
bank(conversation(ghost, [1], ['Good day, how may I help you?'], 'bank_main').p);
conversation(ghost, [2], [], 'bankpin_settings');
conversation(ghost, [3], ['What is this place?', 'This is a branch of the Bank of RuneScape. We have branches in many towns.', 'And what do you do?', 'We will look after your items and money for you. Leave your valuables with us if you want to keep them safe.']);
for (const n of npcs(ghost)) {
  const p = fixture(n), state = dispatch(p, n, 3);
  finish(p, state);
  assert(p.messages.includes('The ghost banker wails incomprehensibly at you, but seems to understand that you wish to access your bank account. You can still quick-bank, but will have to communicate via a series of hand gestures.'), 'quick Bank keeps the sourced explanation without a dialogue pause');
  bank(p);
}
const arnold = 'swan_arnold';
for (const stage of [0, 199]) {
  for (const operation of [1, 4]) {
    const n = npcs(arnold)[0], p = fixture(n);
    p.setVar(id('VarPlayerType', 'swansong_quest'), stage);
    const state = dispatch(p, n, operation);
    finish(p, state);
    assert.equal(p.modalMain, -1, `Arnold operation ${operation} before Swan Song completion does not open bank`);
    assert.equal(text(p), '', 'no unsupported pre-completion Arnold wording is printed');
  }
}
bank(conversation(arnold, [1], ['Ah, you come back! What you want from Arnold, heh?'], 'bank_main').p);
conversation(arnold, [2], [], 'bankpin_settings');
const gift = conversation(arnold, [3], ['Nothing, I just came to chat.', 'Ah, that is nice - always I like to chat, but Herr Caranos tell me to get back to work! Here, you been nice, so have a present:', 'A cabbage?', 'Ja, cabbage is good for you!', 'Um... thanks!']).p;
assert.equal(count(gift, 'cabbage'), 1, 'ordinary Arnold chat awards the sourced single cabbage');
console.log('PASS special banker dialogue, ghostspeak refusal, quick bank and Swan Song eligibility');
for (const [name, option] of [[ghost, 3], [arnold, 4]]) {
  for (const operation of [1, option]) {
    const n = npcs(name)[0], p = fixture(n); eligible(p, name);
    const state = dispatch(p, n, operation, true);
    finish(p, state, operation === 1 ? [1] : []);
    bank(p);
  }
}
console.log('PASS special bankers also resolve and execute native OP-phase Talk and Bank');
process.exit(0);
