import { pathToFileURL } from 'node:url';
import { assert, check, player, run, give, count, reconnect, v, id, types, World, inv, coord, tile, origin, engine } from './runtime.mjs';
const { default: Environment } = await import(pathToFileURL(`${engine}/src/util/Environment.ts`).href);
const { default: IfButtonHandler } = await import(pathToFileURL(`${engine}/src/network/game/client/handler/IfButtonHandler.ts`).href);
const { default: IfButton } = await import(pathToFileURL(`${engine}/src/network/game/client/model/IfButton.ts`).href);
const bank = id(types.InvType, 'bank');
function button(p, suffix) {
  assert(new IfButtonHandler().handle(new IfButton(id(types.Component, `inter_64:${suffix}`)), p), `native lock button ${suffix}`);
}
function open(p) {
  const npc = World.getNpcByUid(p.getVar(v('macro_event_uid')));
  assert(npc, 'real Arnav actor exists');
  run(p, '[opnpc1,macro_combilock_pirate]', [], { npc });
  assert.equal(p.modalMain, id(types.Component, 'inter_64'));
}
function solve(p) {
  open(p);
  for (const [column, component] of [[0, 'com_20'], [1, 'com_21'], [2, 'com_22']]) {
    const word = p.getVar(v('macro_transmit'));
    const selected = (word >> (2 * column)) & 3;
    const target = (word >> (6 + 2 * column)) & 3;
    for (let i = 0; i < ((target - selected + 4) & 3); i++) button(p, component);
  }
  button(p, 'com_19');
}
export default function register() {
  check('Arnav native reel completion stays at the current tile and grants once after real relog', () => {
    let p = player();
    run(p, '[debugproc,macro_arena1]', ['arnav'], { protect: false });
    assert.equal(p.getVar(v('macro_event')), 15);
    assert.equal(p.getVar(v('macro_event_origin_coord')), coord(...origin));
    open(p);
    button(p, 'com_20');
    const progress = p.getVar(v('macro_transmit'));
    p.closeModal();
    p = reconnect(p);
    assert.equal(p.getVar(v('macro_transmit')), progress, 'native save/load retains reels');
    const completionTile = [origin[0], origin[1] + 1, origin[2] + 1];
    [p.level, p.x, p.z] = completionTile;
    const actorUid = p.getVar(v('macro_event_uid'));
    solve(p);
    assert.equal(count(p, 'coins'), 240);
    assert.deepEqual(tile(p), completionTile, 'in-place success does not teleport to the saved departure');
    assert(!World.getNpcByUid(actorUid), 'successful completion removes the owned Arnav actor');
    assert.equal(p.getVar(v('macro_event')), 0);
    run(p, '[if_button,inter_64:com_19]');
    assert.equal(count(p, 'coins'), 240, 'stale unlock cannot repeat reward');
  });
  check('Arnav wrong combination permits retry then dismisses without reward', () => {
    const p = player(); run(p, '[proc,macro_arnav_start]'); open(p);
    // Select a wrong reel using genuine buttons, never seed the puzzle state.
    const word = p.getVar(v('macro_transmit'));
    if ((word & 63) === ((word >> 6) & 63)) button(p, 'com_20');
    button(p, 'com_19');
    assert.equal(p.getVar(v('macro_event')), 15);
    assert(p.messages.some(m => m.msg === 'Arrr! That be nowhere near close! Did ye not listen the first time around?'));
    button(p, 'com_19'); button(p, 'com_19');
    assert.equal(count(p, 'coins'), 0);
    assert.notDeepEqual(tile(p), origin, 'period failure sends the player elsewhere');
    assert.equal(p.getVar(v('macro_event')), 0);
  });
  check('Arnav ignores another player and banks a full-inventory reward', () => {
    const p = player(), other = player(); run(p, '[proc,macro_arnav_start]');
    const npc = World.getNpcByUid(p.getVar(v('macro_event_uid')));
    run(other, '[opnpc1,macro_combilock_pirate]', [], { npc });
    assert.equal(other.modalMain, -1);
    for (let i = 0; i < 28; i++) give(p, 'bronze_dagger');
    solve(p);
    assert.equal(count(p, 'coins', bank), 240);
    assert.equal(count(p, 'bronze_dagger'), 28);
  });
  check('Arnav native Unlock leaves full-bank overflow at the current tile, not the saved origin', () => {
    const p = player();
    run(p, '[proc,macro_arnav_start]');
    const completionTile = [origin[0], origin[1] + 1, origin[2] + 4];
    [p.level, p.x, p.z] = completionTile;
    for (let slot = 0; slot < 28; slot++) give(p, 'bronze_dagger');
    const coinId = id(types.ObjType, 'coins');
    const bankSize = types.InvType.get(bank).size;
    const fillers = types.ObjType.configs.filter(item => item?.tradeable && item.dummyitem === 0
      && item.certtemplate === -1 && item.id !== coinId).slice(0, bankSize);
    assert.equal(fillers.length, bankSize, 'packed ordinary item types can fill the native bank');
    for (const [slot, item] of fillers.entries()) p.invSet(bank, item.id, 1, slot);
    solve(p);
    assert.deepEqual(tile(p), completionTile);
    assert.equal(p.getVar(v('macro_event')), 0);
    assert.equal(count(p, 'coins'), 0);
    assert.equal(count(p, 'coins', bank), 0);
    const reward = World.getObj(completionTile[1], completionTile[2], completionTile[0], coinId, p.username37);
    assert(reward, 'native reward object is owned and visible at the completion tile');
    assert.equal(reward.count, 240);
    assert.equal(World.getObj(origin[1], origin[2], origin[0], coinId, p.username37), null);
    run(p, '[if_button,inter_64:com_19]');
    assert.equal(reward.count, 240, 'stale success cannot duplicate the ground reward');
  });
  check('Lost and Found ordinary spell diversion charges once and pays earned compensation once', () => {
    let p = player();
    for (const [name, quantity] of [['lawrune', 1], ['airrune', 3], ['earthrune', 1]]) give(p, name, quantity);
    const enabled = Environment.NODE_RANDOM_EVENTS;
    try {
      Environment.NODE_RANDOM_EVENTS = true;
      p.afkEventReady = true;
      run(p, '[if_button,magic:lumbridge_teleport]');
    } finally { Environment.NODE_RANDOM_EVENTS = enabled; }
    assert.equal(p.getVar(v('macro_event')), 7, 'real ordinary spell enters owned diversion');
    assert.deepEqual(tile(p), [0, 2338, 4747]);
    assert.equal(count(p, 'lawrune'), 0); assert.equal(count(p, 'airrune'), 0); assert.equal(count(p, 'earthrune'), 0);
    const destination = p.getVar(v('macro_event_target_coord'));
    const state = p.getVar(v('macro_transmit'));
    p = reconnect(p);
    assert.equal(p.getVar(v('macro_event_target_coord')), destination);
    assert.equal(p.getVar(v('macro_transmit')), state);
    const states = [0, 5, 10, 15].map(shift => (state >> shift) & 31);
    const correct = states.findIndex(value => states.filter(other => other === value).length === 1);
    const wrong = (correct + 1) % 4;
    const magic = p.levels[6];
    run(p, `[oploc1,macro_laf_appendage_${wrong + 1}]`);
    assert(p.levels[6] < magic, 'wrong appendage drains Magic');
    assert.equal(p.getVar(v('macro_event')), 7);
    const afterWrong = p.getVar(v('macro_transmit'));
    const arrangement = [0, 5, 10, 15].map(shift => (afterWrong >> shift) & 31);
    const answer = arrangement.findIndex(value => arrangement.filter(other => other === value).length === 1);
    run(p, `[oploc1,macro_laf_appendage_${answer + 1}]`);
    assert.equal(coord(...tile(p)), destination);
    assert.equal(p.getVar(v('macro_event')), 0);
    assert.equal(count(p, 'lawrune'), 1); assert.equal(count(p, 'airrune'), 3);
    run(p, '[proc,macro_laf_complete]');
    assert.equal(count(p, 'lawrune'), 1); assert.equal(count(p, 'airrune'), 3);
  });
  check('Lost and Found gate-off spell and valid escape grant no compensation', () => {
    const p = player();
    for (const [name, quantity] of [['lawrune', 1], ['airrune', 3], ['earthrune', 1]]) give(p, name, quantity);
    const enabled = Environment.NODE_RANDOM_EVENTS;
    try {
      Environment.NODE_RANDOM_EVENTS = false; p.afkEventReady = true;
      run(p, '[if_button,magic:lumbridge_teleport]');
    } finally { Environment.NODE_RANDOM_EVENTS = enabled; }
    assert.equal(p.getVar(v('macro_event')), 0);
    assert.equal(count(p, 'lawrune'), 0);
    run(p, '[proc,macro_laf_start]', [coord(...origin)]);
    run(p, '[proc,player_teleport_normal]', [coord(...origin)]);
    assert.equal(p.getVar(v('macro_event')), 0);
    assert.equal(count(p, 'lawrune'), 0); assert.equal(count(p, 'airrune'), 0);
  });
  check('Lost and Found diversion cannot bypass ordinary rune requirements', () => {
    const p = player();
    const enabled = Environment.NODE_RANDOM_EVENTS;
    try {
      Environment.NODE_RANDOM_EVENTS = true; p.afkEventReady = true;
      run(p, '[if_button,magic:lumbridge_teleport]');
    } finally { Environment.NODE_RANDOM_EVENTS = enabled; }
    assert.equal(p.getVar(v('macro_event')), 0);
    assert.deepEqual(tile(p), origin);
    assert.equal(count(p, 'lawrune'), 0);
    assert.equal(p.afkEventReady, true, 'failed requirements never consume readiness');
  });
  check('Lost and Found completion banks compensation when inventory is full', () => {
    const p = player();
    for (let i = 0; i < 28; i++) give(p, 'bronze_dagger');
    run(p, '[proc,macro_laf_start]', [coord(...origin)]);
    const word = p.getVar(v('macro_transmit'));
    const states = [0, 5, 10, 15].map(shift => (word >> shift) & 31);
    const answer = states.findIndex(value => states.filter(other => other === value).length === 1);
    run(p, `[oploc1,macro_laf_appendage_${answer + 1}]`);
    assert.equal(count(p, 'lawrune', bank), 1);
    assert.equal(count(p, 'airrune', bank), 3);
    assert.equal(count(p, 'bronze_dagger'), 28);
    assert.deepEqual(tile(p), origin);
  });
}
