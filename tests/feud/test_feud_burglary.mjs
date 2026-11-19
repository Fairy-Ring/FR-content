import assert from 'node:assert/strict';
import test from 'node:test';

import { button, count, held, id, inv, obj, player, remove, seed, use, worn } from '../swamp-caves/runtime.mjs';
import { bit, finish, locs, operateLoc, read, relog, stage } from './fixture.mjs';

const set = (p, name, value) => p.setVarBit(bit(name), value);
const cactus = () => locs('feud_cactus_row')[0];
const picture = () => locs('feud_mayors_picture')[0];
const safeRoot = () => id('Component', 'inter_265');
const prefix = p => p.getVar(id('VarPlayerType', 'if2'));
const selected = p => p.getVar(id('VarPlayerType', 'if1'));
const entries = p => read(p, 'feud_safe_digit');

function wear(p, name) {
  if (!count(p, name)) p.invAdd(inv, obj(name), 1);
  assert(held(p, name, 2), `native Wear accepts ${name}`);
  finish(p);
  assert.equal(count(p, name, worn), 1, `${name} is actually equipped`);
}

function disguise(p) {
  seed(p, ['feud_karidian_fakebeard', 'feud_karidian_turban']);
  assert(use(p, 'feud_karidian_turban', 'feud_karidian_fakebeard'), 'native item combination is accepted');
  finish(p);
  assert.equal(count(p, 'feud_karidian_fakebeard'), 0);
  assert.equal(count(p, 'feud_karidian_turban'), 0);
  assert.equal(count(p, 'feud_desert_disguise'), 1);
  wear(p, 'feud_desert_disguise');
}

function burglaryFixture() {
  // Isolated compiled fixture, not a claim that the whole quest was walked.
  const p = player();
  set(p, 'feud_var', 13);
  wear(p, 'leather_gloves');
  disguise(p);
  seed(p, ['feud_mayors_house_keys']);
  return p;
}

function openSafe(p) {
  operateLoc(p, picture());
  assert.equal(p.modalMain, safeRoot(), 'the original safe interface opens');
}

function digit(p, value) {
  assert(button(p, `inter_265:com_${value + 3}`), 'native interface packet is accepted');
  return finish(p);
}

function combination(p) {
  for (const value of [1, 1, 2, 3, 5, 8]) digit(p, value);
}

test('stakeout requires gloves rather than any hand item, and the real combined disguise', () => {
  const p = player();
  assert.match(operateLoc(p, cactus()).text, /no apparent reason/);
  set(p, 'feud_var', 13);
  assert.match(operateLoc(p, cactus()).text, /cover my hands/);
  wear(p, 'leather_vambraces');
  assert.match(operateLoc(p, cactus()).text, /cover my hands/, 'vambraces do not cover the fingers');
  assert.equal(stage(p), 13);
  assert(remove(p, 'leather_vambraces'));
  finish(p);
  wear(p, 'leather_gloves');
  assert.match(operateLoc(p, cactus()).text, /disguise my head/);
  disguise(p);
  assert.match(operateLoc(p, cactus()).text, /coast is clear/);
  assert.equal(stage(p), 14);
  assert.equal(read(p, 'feud_mayor_invis'), 1);
  operateLoc(p, cactus());
  assert.equal(stage(p), 14, 'a repeat stakeout does not invent another checkpoint');
});

for (const name of ['feud_closed_door_left', 'feud_closed_door_right']) {
  test(`${name} checks the entry prerequisites and keeps its sourced persistent unlock`, () => {
    let p = burglaryFixture();
    const door = locs(name)[0], outside = [door.level, door.x, door.z];
    const initial = operateLoc(p, door, { item: 'feud_mayors_house_keys', position: outside });
    assert.match(p.messages.join(' '), /stake the place out first/);
    assert.deepEqual(initial.position, outside);
    assert.equal(read(p, 'feud_var_mayorsdoor'), 0);
    operateLoc(p, cactus());
    assert.deepEqual(operateLoc(p, door, { position: outside }).position, outside, 'an ordinary click cannot substitute for the first key use');
    const unlocked = operateLoc(p, door, { item: 'feud_mayors_house_keys', position: outside });
    assert.match(p.messages.join(' '), /satisfying click/);
    assert.equal(read(p, 'feud_var_mayorsdoor'), 1);
    assert.equal(count(p, 'feud_mayors_house_keys'), 1, 'unlocking retains the borrowed key');
    assert.deepEqual(unlocked.position, [door.level, door.x + 1, door.z], 'entry crosses the original wall, not a teleport to another room');
    p = relog(p);
    assert.equal(read(p, 'feud_var_mayorsdoor'), 1, 'the original unlock field survives the save codec');
    const inside = [door.level, door.x + 1, door.z];
    assert.deepEqual(operateLoc(p, door, { position: inside }).position, outside, 'normal exit remains available');
    set(p, 'feud_var', 28); // A separate post-completion door fixture.
    assert.deepEqual(operateLoc(p, door, { position: outside }).position, inside, 'an already unlocked door remains usable after the quest');
  });
}

test('the safe requires the stakeout, clothing and unlocked door before original-interface input can progress it', () => {
  const p = burglaryFixture();
  operateLoc(p, picture());
  assert.notEqual(p.modalMain, safeRoot());
  assert.equal(stage(p), 13);
  operateLoc(p, cactus());
  operateLoc(p, picture());
  assert.notEqual(p.modalMain, safeRoot(), 'the stakeout alone does not unlock the house');
  set(p, 'feud_var_mayorsdoor', 1); // Isolated interior fixture; the two preceding tests prove the key operation.
  assert(remove(p, 'leather_gloves'));
  finish(p);
  operateLoc(p, picture());
  assert.notEqual(p.modalMain, safeRoot());
  wear(p, 'leather_gloves');
  openSafe(p);
  assert.equal(prefix(p), 0);
  assert.equal(selected(p), 0);
  p.closeModal();
});

test('a wrong first digit fails only at the sixth entry, and the correct sequence then works', () => {
  const p = burglaryFixture();
  operateLoc(p, cactus());
  set(p, 'feud_var_mayorsdoor', 1); // Isolated interior fixture.
  openSafe(p);
  for (const [index, value] of [9, 1, 2, 3, 5].entries()) {
    assert.doesNotMatch(digit(p, value), /combination wrong/, 'a partial attempt is not evaluated');
    assert.equal(entries(p), index + 1, 'original varbit 325 counts every entry, including the wrong first digit');
    assert.equal(selected(p), value, 'the cache interface reflects the selected number');
    assert.equal(stage(p), 14);
    assert.equal(count(p, 'feud_mayors_jewels'), 0);
  }
  assert.match(digit(p, 8), /combination wrong/);
  assert.equal(entries(p), 0);
  assert.equal(prefix(p), 0);
  assert.equal(stage(p), 14);
  combination(p);
  assert.equal(stage(p), 15, 'a correct attempt immediately after failure still unlocks the safe');
  assert.equal(count(p, 'feud_mayors_jewels'), 1);
});

test('Reset, close and reopen clear partial input; 112358 gives one recoverable jewel item', () => {
  let p = burglaryFixture();
  operateLoc(p, cactus());
  set(p, 'feud_var_mayorsdoor', 1); // Isolated interior fixture, not a bypass in the linked live walk.
  openSafe(p);
  digit(p, 1); digit(p, 1);
  assert.equal(entries(p), 2);
  assert.equal(prefix(p), 11);
  assert(button(p, 'inter_265:com_13'));
  finish(p);
  assert.equal(prefix(p), 0);
  assert.equal(entries(p), 0);
  assert.equal(selected(p), 0);
  assert.match(p.messages.join(' '), /safe resetting itself/);
  digit(p, 1); digit(p, 1); digit(p, 2);
  p.closeModal();
  assert.equal(prefix(p), 0);
  assert.equal(entries(p), 0);
  assert.equal(selected(p), 0);
  p = relog(p);
  assert.equal(stage(p), 14);
  assert.equal(read(p, 'feud_var_mayorsdoor'), 1);
  openSafe(p);
  assert.equal(prefix(p), 0);
  assert.equal(entries(p), 0);
  combination(p);
  assert.equal(stage(p), 15);
  assert.equal(count(p, 'feud_mayors_jewels'), 1);
  assert.notEqual(p.modalMain, safeRoot(), 'successful retrieval closes the safe');
  openSafe(p); combination(p);
  assert.equal(count(p, 'feud_mayors_jewels'), 1, 'reopening cannot duplicate a carried quest item');
  assert(held(p, 'feud_mayors_jewels', 5), 'native Drop creates the recoverable-item case');
  finish(p);
  assert.equal(count(p, 'feud_mayors_jewels'), 0);
  openSafe(p); combination(p);
  assert.equal(count(p, 'feud_mayors_jewels'), 1, 'the player can recover dropped jewels before delivering them');
  assert.equal(stage(p), 15);
});

test('a full inventory neither loses the safe reward nor advances the checkpoint, and normal inventory space permits retry', () => {
  const p = burglaryFixture();
  operateLoc(p, cactus());
  set(p, 'feud_var_mayorsdoor', 1); // Isolated interior fixture.
  p.invDel(inv, obj('feud_mayors_house_keys'), 1);
  p.invAdd(inv, obj('bucket_empty'), 28);
  openSafe(p);
  let last;
  for (const value of [1, 1, 2, 3, 5, 8]) last = digit(p, value);
  assert.match(last, /no room in your inventory/);
  assert.equal(stage(p), 14);
  assert.equal(count(p, 'feud_mayors_jewels'), 0);
  p.closeModal();
  assert(held(p, 'bucket_empty', 5));
  finish(p);
  openSafe(p); combination(p);
  assert.equal(stage(p), 15);
  assert.equal(count(p, 'feud_mayors_jewels'), 1);
});

test('both original clue searches and Read options disclose the sourced Fibonacci hints without duplicate notes', () => {
  const p = burglaryFixture();
  operateLoc(p, cactus());
  for (const [name, note, expected] of [
    ['feud_mayors_desk', 'feud_nos_note', /These numbers contained within,.*1,1,2,3,5/],
    ['feud_mayors_bed', 'feud_fib_hint', /word 'Fibonacci' scrawled on it/]
  ]) {
    operateLoc(p, locs(name)[0]);
    assert.equal(count(p, note), 1);
    p.dialogueMark = p.packets.length;
    assert(held(p, note, 1));
    assert.match(finish(p), expected);
    operateLoc(p, locs(name)[0]);
    assert.equal(count(p, note), 1, 'repeat Search does not duplicate a carried hint');
  }
});
