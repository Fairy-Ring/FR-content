import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  contentRoot, World, types, id, engineModule, makePlayer, runPlayer, runProc, stack, tickPlayer, map
} from '../champions-challenge/runtime.mjs';

const IfButtonHandler = (await engineModule('network/game/client/handler/IfButtonHandler.ts')).default;
const IfButton = (await engineModule('network/game/client/model/IfButton.ts')).default;
const buttons = new IfButtonHandler();
const games = ['draughts', 'runelink', 'runesquares', 'runeversi'];
const boardinv = id('InvType', 'boardgames_boardinv');
const baseTable = id('LocType', 'boardgames_table');
const hiddenStool = id('LocType', 'boardgames_barstool_invis');
const room = level => ({ level, x: 2206, z: 4958 });
const challengeRoom = (game, level) => ({ level, x: 2176 + [20, 44, 12, 52][game], z: 4928 + [12, 12, 20, 20][game] });
const sessions = new WeakMap();
let assertions = 0;
function check(label, body) {
  body();
  assertions++;
  console.log(`PASS ${label}`);
}
function get(p, name) {
  const bitId = types.VarBitType.getId(name);
  if (bitId >= 0) {
    const bit = types.VarBitType.get(bitId);
    return (p.getVar(bit.basevar) >>> bit.startbit) & (2 ** (bit.endbit - bit.startbit + 1) - 1);
  }
  return p.getVar(id('VarPlayerType', name));
}
function set(p, name, value) {
  const bitId = types.VarBitType.getId(name);
  if (bitId >= 0) {
    const bit = types.VarBitType.get(bitId);
    const mask = (2 ** (bit.endbit - bit.startbit + 1) - 1) << bit.startbit;
    p.setVar(bit.basevar, (p.getVar(bit.basevar) & ~mask) | ((value << bit.startbit) & mask));
  } else {
    p.setVar(id('VarPlayerType', name), value);
  }
}
const result = (proc, p, args = [], other = null) => stack(runProc(proc, p, args, other)).at(-1);
function player(level = 0) {
  const p = makePlayer(room(level));
  World.gameMap.getZone(p.x, p.z, p.level).enter(p);
  runProc('boardgames_enter', p);
  return p;
}
function pair(game = 2, level = 0) {
  const a = player(level), b = player(level);
  for (const p of [a, b]) {
    Object.assign(p, challengeRoom(game, level));
    set(p, 'boardgames_game', game);
    set(p, `boardgames_${games[game]}_rank`, 1600);
    set(p, 'boardgames_timepermove', 0);
    set(p, 'boardgames_rankedgame', 1);
  }
  set(a, 'boardgames_piece', 1);
  set(b, 'boardgames_piece', 2);
  set(a, 'duel2accept', b.uid);
  set(b, 'duel2accept', a.uid);
  return [a, b];
}
function button(p, name) {
  assert.equal(buttons.handle(new IfButton(id('Component', name)), p), true,
    `native IF_BUTTON ${name}; modal=${p.modalMain}; game=${get(p, 'boardgames_game')}; ingame=${get(p, 'boardgames_ingame')}; ended=${get(p, 'boardgames_gameended')}; viewing=${get(p, 'boardgames_viewing')}`);
}
function expireLocs() {
  World.currentTick++;
  World.processZones();
}
function coord(p) { return `${p.level}:${p.x}:${p.z}`; }
function unpack(value) { return { level: value >>> 28, x: (value >>> 14) & 0x3fff, z: value & 0x3fff }; }
function tableAt(p, number) {
  const c = unpack(result('get_boardgames_table_coord', p, [number]));
  return { ...c, loc: World.getLoc(c.x, c.z, c.level, baseTable) };
}
const newGameControls = { challenge: 'com_67', '15seconds_radio': 'com_81', ranked_radio: 'com_113' };
const optionControl = (game, control) => `boardgames_${games[game]}_options:${game < 2 ? control : newGameControls[control]}`;
function challenge(game, level = 0, ranked = 1) {
  const a = player(level), b = player(level);
  for (const p of [a, b]) {
    Object.assign(p, challengeRoom(game, level));
    set(p, `boardgames_${games[game]}_rank`, 1600);
  }
  runPlayer('[opplayer1,_]', a, b);
  button(a, `boardgames_challenge:${games[game]}_radio`);
  button(a, 'boardgames_challenge:select');
  button(a, optionControl(game, '15seconds_radio'));
  if (!ranked) button(a, optionControl(game, 'ranked_radio'));
  button(a, optionControl(game, 'challenge'));
  runPlayer('[opplayer1,_]', b, a);
  button(b, optionControl(game, 'challenge'));
  assert.equal(get(a, 'boardgames_ingame'), 1, `${games[game]} challenger seated`);
  assert.equal(get(b, 'boardgames_ingame'), 1, `${games[game]} acceptor seated`);
  assert.equal(get(a, 'boardgames_tablenum'), get(b, 'boardgames_tablenum'));
  for (const p of [a, b]) sessions.set(p, { game, level });
  return [a, b];
}
function closePair(a, b) {
  a.closeModal();
  tickPlayer(a, b);
  // Legacy resignation suspends for p_delay(0) before opening both result panels.
  tickPlayer(a, b);
  a.closeModal();
  b.closeModal();
  tickPlayer(a, b);
  expireLocs();
  for (const p of [a, b]) {
    const fixture = sessions.get(p);
    if (fixture?.game >= 2) {
      const minX = 2176 + (fixture.game === 2 ? 8 : 48);
      assert.equal(p.level, fixture.level, 'result returns to the correct normal or experienced plane');
      assert(p.x >= minX && p.x < minX + 8 && p.z >= 4944 && p.z < 4952, 'result returns to the original game rank-room zone');
    }
    assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, 'result exit is collision-clear');
    assert([[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dz]) =>
      !map.isMapBlocked(p.x + dx, p.z + dz, p.level) && map.findPath(p.level, p.x, p.z, p.x + dx, p.z + dz).length
    ), 'result exit has a native route out');
  }
}

check('entry initializes four independent ranks without overwriting a saved rank', () => {
  const p = player();
  for (const game of games) assert.equal(get(p, `boardgames_${game}_rank`), 1000);
  set(p, 'boardgames_runeversi_rank', 1721);
  runProc('boardgames_enter', p);
  assert.equal(get(p, 'boardgames_runeversi_rank'), 1721);
});
check('rank delta uses existing bounded Games Room convention', () => {
  const p = player();
  assert.equal(result('calculate_rank_change', p, [1000, 1000]), 50);
  assert.equal(result('calculate_rank_change', p, [1, 60000]), 1);
  assert.equal(result('calculate_rank_change', p, [60000, 1]), 100);
  for (const [setting, ticks] of [25, 50, 100, 200].entries()) {
    set(p, 'boardgames_timepermove', setting);
    assert.equal(result('get_sandtimer_interval', p), ticks);
  }
});
check('pair admission rejects mismatched, busy, absent, cross-plane and under-ranked opponents', () => {
  const [a, b] = pair(2, 1);
  assert.equal(result('boardgames_admission_ready', a), 1);
  for (const [p, field, bad] of [
    [b, 'duel2accept', 0], [b, 'boardgames_ingame', 1], [a, 'boardgames_ingame', 1],
    [b, 'boardgames_game', 3], [b, 'boardgames_piece', 1],
    [a, 'boardgames_runesquares_rank', 1499], [b, 'boardgames_runesquares_rank', 1499]
  ]) {
    const old = get(p, field); set(p, field, bad);
    assert.equal(result('boardgames_admission_ready', a), 0, field);
    set(p, field, old);
  }
  b.level = 0;
  assert.equal(result('boardgames_admission_ready', a), 0, 'cross plane');
  b.level = 1; b.x = 3200; b.z = 3200;
  assert.equal(result('boardgames_admission_ready', a), 0, 'outside room');
  set(a, 'duel2accept', 0x7fffffff);
  assert.equal(result('boardgames_admission_ready', a), 0, 'absent UID');
});
check('the public level-one entry lobby admits ordinary-rank games to ground-floor tables', () => {
  for (const game of [0, 1, 2, 3]) {
    const [a, b] = pair(game, 1);
    for (const p of [a, b]) {
      Object.assign(p, { level: 1, x: 2206, z: 4934 });
      set(p, `boardgames_${games[game]}_rank`, 1000);
    }
    assert.equal(result('boardgames_admission_ready', a), 1);
    runProc('boardgames_table_setup', a);
    assert.equal(get(a, 'boardgames_challengeroom'), 0);
    assert(get(a, 'boardgames_tablenum') < 48);
    assert.equal(a.level, 0); assert.equal(b.level, 0);
    runProc('boardgames_release_table', a); expireLocs();
  }
});

check('all 96 allocated coordinates equal real packed-map tables and every seat has an exit', () => {
  const expected = new Set();
  const tableId = baseTable;
  const locText = fs.readFileSync(path.join(contentRoot, 'maps/m34_77.jm2'), 'utf8').split('==== LOC ====')[1];
  assert(locText, 'map has a LOC section');
  for (const line of locText.split('\n')) {
    const m = /^(\d+) (\d+) (\d+): (\d+)(?: |$)/.exec(line);
    if (m && Number(m[4]) === tableId) expected.add(`${m[1]}:${34 * 64 + Number(m[2])}:${77 * 64 + Number(m[3])}`);
  }
  assert.equal(expected.size, 96);
  const found = new Set();
  const [a, b] = pair(2);
  const claimed = [];
  for (let number = 0; number < 96; number++) {
    const level = number < 48 ? 0 : 1;
    for (const p of [a, b]) Object.assign(p, challengeRoom(2, level));
    const { level: y, x, z, loc } = tableAt(a, number);
    assert(loc, `real table ${number}`);
    found.add(`${y}:${x}:${z}`);
    runProc('boardgames_table_setup', a);
    assert.equal(get(a, 'boardgames_tablenum'), number, 'allocator reaches each distinct table in order');
    assert.equal(a.level, level); assert.equal(b.level, level);
    const changed = World.getLoc(x, z, level, id('LocType', 'boardgames_table_runesquares'));
    assert(changed, 'game table installed'); claimed.push(changed);
    for (const p of [a, b]) {
      assert(World.getLoc(p.x, p.z, level, hiddenStool), `seat ${number} matches original stool`);
      // Original stools block entry; the native route out and standing-up landings prove safety.
      let route = false;
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (!map.isMapBlocked(p.x + dx, p.z + dz, level) && map.findPath(level, p.x, p.z, p.x + dx, p.z + dz).length) route = true;
      }
      assert(route, `seat ${number} has a native collision route out`);
    }
  }
  assert.deepEqual(found, expected, 'no duplicate, missing or invented table coordinates');
  for (const loc of claimed) World.revertLoc(loc);
  // Restore only the stools changed by this fixture, through the normal world lifecycle.
  for (const key of expected) {
    const [level, x, z] = key.split(':').map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const stool = World.getLoc(x + dx, z + dz, level, hiddenStool);
      if (stool) World.revertLoc(stool);
    }
  }
});
check('full tables refuse all four games on both planes without initializing a board', () => {
  for (const level of [0, 1]) {
    const occupied = [];
    const probe = player(level);
    for (let i = level * 48; i < level * 48 + 48; i++) {
      const { loc } = tableAt(probe, i);
      World.changeLoc(loc, id('LocType', 'boardgames_table_runelink'), loc.shape, loc.angle, 0x7fffffff);
      occupied.push(loc);
    }
    for (const game of [0, 1, 2, 3]) {
      const [a, b] = pair(game, level);
      const before = [coord(a), coord(b)];
      runProc('open_boardgames_options', a);
      button(a, optionControl(game, 'challenge'));
      assert.equal(get(a, 'boardgames_ingame'), 0, `${games[game]} full-table refusal`);
      assert.equal(get(b, 'boardgames_ingame'), 0);
      assert.deepEqual([coord(a), coord(b)], before);
      assert(a.messages.some(m => m.includes('All tables are currently full')));
      assert.equal(a.getInventory(boardinv).items.filter(Boolean).length, 0, 'no board allocated');
    }
    for (const loc of occupied) World.revertLoc(loc);
  }
});

check('ordinary logout leaves unrelated Games Room rank and option state intact', () => {
  const p = makePlayer({ level: 0, x: 3222, z: 3218 });
  set(p, 'boardgames_runesquares_rank', 1873);
  set(p, 'boardgames_runeversi_rank', 1542);
  set(p, 'boardgames_game', 3);
  set(p, 'boardgames_timepermove', 2);
  const options = get(p, 'boardgames_varbit');
  runPlayer('[logout,_]', p);
  assert.equal(get(p, 'last_logout'), World.currentTick);
  assert.equal(get(p, 'boardgames_varbit'), options, 'guard does not reset an inactive game');
  assert.equal(get(p, 'boardgames_runesquares_rank'), 1873);
  assert.equal(get(p, 'boardgames_runeversi_rank'), 1542);
});

check('RuneLink and Draughts retain real challenge, turn timer and modal-close cleanup', () => {
  for (const game of [0, 1]) for (const level of [0, 1]) {
    const [a, b] = challenge(game, level);
    const n = get(a, 'boardgames_tablenum');
    const c = unpack(result('get_boardgames_table_coord', a, [n]));
    const active = get(a, 'boardgames_myturn') ? a : b;
    const before = a.getInventory(boardinv).items.map(item => item?.id ?? -1);
    if (game === 1) button(active, 'boardgames_runelink:column_1');
    else for (let tick = 0; tick < 26; tick++) tickPlayer(a, b);
    const after = a.getInventory(boardinv).items.map(item => item?.id ?? -1);
    assert.notDeepEqual(after, before, `${games[game]} native move updates the board`);
    const otherBoard = b.getInventory(boardinv).items.slice();
    if (game === 0) otherBoard.reverse();
    assert.deepEqual(a.getInventory(boardinv).items, otherBoard, 'legacy boards preserve Draughts rotation and RuneLink orientation');
    closePair(a, b);
    assert.equal(get(a, 'boardgames_ingame'), 0);
    assert.equal(get(b, 'boardgames_ingame'), 0);
    assert(World.getLoc(c.x, c.z, c.level, baseTable), 'legacy close releases the table');
  }
});

const directions = [-1, 0, 1].flatMap(dy => [-1, 0, 1].filter(dx => dx || dy).map(dx => [dx, dy]));
const board = p => Array.from({ length: 64 }, (_, slot) => p.getInventory(boardinv).get(slot)?.id ?? -1);
const rune = p => result('get_boardgames_player_rune', p, [get(p, 'boardgames_piece')]);
function flips(cells, slot, own, opponent) {
  if (slot < 0 || slot >= 64 || cells[slot] !== -1) return [];
  const captured = [];
  for (const [dx, dy] of directions) {
    let x = slot % 8 + dx, y = Math.floor(slot / 8) + dy;
    const line = [];
    while (x >= 0 && x < 8 && y >= 0 && y < 8 && cells[y * 8 + x] === opponent) {
      line.push(y * 8 + x); x += dx; y += dy;
    }
    if (line.length && x >= 0 && x < 8 && y >= 0 && y < 8 && cells[y * 8 + x] === own) captured.push(...line);
  }
  return captured;
}
const legal = (cells, own, opponent) => cells.flatMap((_, slot) => flips(cells, slot, own, opponent).length ? [slot] : []);
function seedBoard(a, b, cells) {
  a.invClear(boardinv); b?.invClear(boardinv);
  cells.forEach((obj, slot) => {
    if (obj !== -1) { a.invSet(boardinv, obj, 1, slot); b?.invSet(boardinv, obj, 1, 63 - slot); }
  });
}
check('Runeversi validates all eight bracket directions without row wrapping', () => {
  const [a, b] = pair(3);
  const own = rune(a), other = rune(b), cells = Array(64).fill(-1);
  for (const [dx, dy] of directions) {
    cells[(3 + dy) * 8 + 3 + dx] = other;
    cells[(3 + 2 * dy) * 8 + 3 + 2 * dx] = own;
  }
  seedBoard(a, b, cells);
  assert.equal(result('runeversi_flip_count', a, [27, own, other]), 8);
  assert.equal(result('runeversi_is_legal_move', a, [27, own, other]), 1);
  assert.equal(result('runeversi_flip_count', a, [-1, own, other]), 0);
  assert.equal(result('runeversi_flip_count', a, [64, own, other]), 0);
  const wrap = Array(64).fill(-1); wrap[7] = other; wrap[8] = own;
  seedBoard(a, b, wrap);
  assert.equal(result('runeversi_flip_count', a, [6, own, other]), 0, 'a horizontal ray cannot wrap to the next row');
});
check('Runeversi native buttons play a full independently scored game and reject illegal clicks', () => {
  const [a, b] = challenge(3);
  let cells = board(a), moves = 0;
  const initial = cells.slice();
  const wrong = get(a, 'boardgames_myturn') ? b : a;
  button(wrong, 'inter_349:com_161');
  assert.deepEqual(board(a), initial, 'wrong-turn click does not mutate the board');
  while (!get(a, 'boardgames_gameended') && moves < 61) {
    const mover = get(a, 'boardgames_myturn') ? a : b, opponent = mover === a ? b : a;
    const own = rune(mover), other = rune(opponent);
    const choices = legal(cells, own, other);
    assert(choices.length, 'product automatically passes a player with no legal moves');
    const slot = choices[0], captured = flips(cells, slot, own, other);
    const before = board(a);
    const occupied = cells.findIndex(obj => obj !== -1);
    button(mover, `inter_349:com_${161 + (mover === a ? occupied : 63 - occupied)}`);
    assert.deepEqual(board(a), before, 'occupied-slot click is refused');
    assert.equal(get(mover, 'boardgames_ingame'), 1,
      `occupied move ${moves}/${occupied} keeps the session`);
    button(mover, `inter_349:com_${161 + (mover === a ? slot : 63 - slot)}`);
    cells[slot] = own; captured.forEach(at => { cells[at] = own; });
    assert.deepEqual(board(a), cells, 'all and only bracketed discs flip');
    assert.deepEqual(board(b).slice().reverse(), cells, 'opponent sees the same board rotated 180 degrees');
    assert.equal(get(a, 'boardgames_ingame'), get(a, 'boardgames_gameended') ? 0 : 1, 'legal move leaves a running or explicitly settled game');
    assert.equal(get(b, 'boardgames_ingame'), get(b, 'boardgames_gameended') ? 0 : 1, 'opponent game lifecycle agrees');
    moves++;
    const next = opponent;
    if (legal(cells, rune(next), rune(mover)).length && !get(a, 'boardgames_gameended')) assert.equal(get(next, 'boardgames_myturn'), 1);
  }
  assert(moves >= 4 && moves <= 60);
  assert.equal(get(a, 'boardgames_gameended'), 1, 'full board or neither-player-can-move ends the game');
  const aCount = cells.filter(obj => obj === rune(a)).length, bCount = cells.filter(obj => obj === rune(b)).length;
  assert.equal(get(a, 'boardgames_runeversi_rank'), 1600 + Math.sign(aCount - bCount) * 50);
  assert.equal(get(b, 'boardgames_runeversi_rank'), 1600 - Math.sign(aCount - bCount) * 50);
  closePair(a, b);
});
check('Runeversi automatically passes a blocked opponent and finishes the remaining legal turn', () => {
  const [a, b] = challenge(3, 1), own = rune(a), other = rune(b);
  const cells = Array(64).fill(own);
  cells[0] = -1; cells[3] = -1; cells[1] = other; cells[4] = other;
  seedBoard(a, b, cells); set(a, 'boardgames_myturn', 1); set(b, 'boardgames_myturn', 0);
  button(a, 'inter_349:com_161');
  cells[0] = own; cells[1] = own;
  assert.deepEqual(board(a), cells);
  assert.equal(get(a, 'boardgames_myturn'), 1, 'automatic pass retains the only player with a legal move');
  assert.equal(get(a, 'boardgames_gameended'), 0);
  button(a, 'inter_349:com_164');
  assert.equal(get(a, 'boardgames_gameended'), 1);
  closePair(a, b);
});
check('Runeversi scores a full-board tie and ends with empty cells when neither player can move', () => {
  for (const tied of [true, false]) {
    const [a, b] = challenge(3), own = rune(a), other = rune(b);
    const cells = Array(64).fill(tied ? other : own);
    cells[0] = -1; cells[1] = other;
    if (tied) for (let slot = 2; slot <= 31; slot++) cells[slot] = own;
    else cells[63] = -1;
    seedBoard(a, b, cells);
    for (const p of [a, b]) set(p, 'boardgames_numturns', 4);
    set(a, 'boardgames_myturn', 1); set(b, 'boardgames_myturn', 0);
    button(a, 'inter_349:com_161');
    assert.equal(get(a, 'boardgames_gameended'), 1);
    assert.equal(get(b, 'boardgames_gameended'), 1);
    assert.equal(result('runeversi_count_empty', a), tied ? 0 : 1);
    assert.equal(get(a, 'boardgames_runeversi_rank'), tied ? 1600 : 1650);
    assert.equal(get(b, 'boardgames_runeversi_rank'), tied ? 1600 : 1550);
    closePair(a, b);
  }
});

check('Runeversi agreed draw preserves ranks and closing the board resigns exactly once', () => {
  let [a, b] = challenge(3);
  for (let offer = 0; offer < 2; offer++) {
    button(a, 'inter_349:com_95');
    for (const p of [a, b]) {
      assert.equal(get(p, 'boardgames_ingame'), 1, 'a repeated offer cannot end Runeversi');
      assert.equal(get(p, 'boardgames_gameended'), 0, 'the Runeversi offerer cannot accept their own draw');
    }
  }
  button(b, 'inter_349:com_95');
  for (const p of [a, b]) {
    assert.equal(get(p, 'boardgames_ingame'), 0, 'opponent acceptance ends Runeversi');
    assert.equal(get(p, 'boardgames_gameended'), 1, 'both players see the agreed Runeversi draw');
  }
  assert.equal(get(a, 'boardgames_runeversi_rank'), 1600);
  assert.equal(get(b, 'boardgames_runeversi_rank'), 1600);
  closePair(a, b);
  [a, b] = challenge(3);
  a.closeModal(); tickPlayer(a, b);
  assert.equal(get(b, 'boardgames_gameended'), 1, 'close is a resignation');
  const ranks = [get(a, 'boardgames_runeversi_rank'), get(b, 'boardgames_runeversi_rank')];
  runProc('boardgames_logout', a); runProc('boardgames_logout', a);
  assert.deepEqual([get(a, 'boardgames_runeversi_rank'), get(b, 'boardgames_runeversi_rank')], ranks, 'disconnect cannot settle twice');
  closePair(a, b);
});

function squaresModel(order) {
  const vertical = Array(56).fill(false), horizontal = Array(56).fill(false), owners = Array(64).fill(-1);
  let turn = 0;
  const states = [];
  for (const [orientation, index] of order) {
    (orientation === 0 ? vertical : horizontal)[index] = true;
    const claimed = [];
    for (let box = 0; box < 64; box++) {
      const row = Math.floor(box / 8), col = box % 8;
      if (owners[box] === -1 && (col === 0 || vertical[row * 7 + col - 1]) &&
          (col === 7 || vertical[row * 7 + col]) && (row === 0 || horizontal[(row - 1) * 8 + col]) &&
          (row === 7 || horizontal[row * 8 + col])) {
        owners[box] = turn; claimed.push(box);
      }
    }
    const mover = turn;
    if (!claimed.length) turn = 1 - turn;
    states.push({ orientation, index, mover, next: turn, claimed, owners: owners.slice() });
  }
  return states;
}
const allEdges = [0, 1].flatMap(orientation => Array.from({ length: 56 }, (_, index) => [orientation, index]));
function playSquares(order) {
  const [a, b] = challenge(2);
  const first = get(a, 'boardgames_myturn') ? a : b;
  const sides = [first, first === a ? b : a];
  const runes = sides.map(rune);
  const states = squaresModel(order);
  for (const state of states) {
    const mover = sides[state.mover], other = sides[1 - state.mover];
    const before = ['va', 'vb', 'ha', 'hb'].map(suffix => get(a, `boardgames_runesquares_${suffix}`));
    button(other, `boardgames_runesquares:com_${(state.orientation === 0 ? 293 : 349) + state.index}`);
    assert.deepEqual(['va', 'vb', 'ha', 'hb'].map(suffix => get(a, `boardgames_runesquares_${suffix}`)), before, 'wrong turn cannot draw an edge');
    button(mover, `boardgames_runesquares:com_${(state.orientation === 0 ? 293 : 349) + state.index}`);
    assert.equal(result('runesquares_edge_value', a, [state.orientation, state.index]), 1, 'selected edge is drawn');
    assert.deepEqual(board(a), state.owners.map(owner => owner < 0 ? -1 : runes[owner]), 'exactly completed boxes gain the mover rune');
    assert.deepEqual(board(b), board(a), 'both box ownership boards agree');
    if (!get(a, 'boardgames_gameended')) {
      assert.equal(get(sides[state.next], 'boardgames_myturn'), 1, state.claimed.length ? 'capture grants an extra turn' : 'noncapture transfers turn');
      button(sides[state.next], `boardgames_runesquares:com_${(state.orientation === 0 ? 293 : 349) + state.index}`);
      assert.deepEqual(board(a), state.owners.map(owner => owner < 0 ? -1 : runes[owner]), 'duplicate edge does not award a box again');
    }
  }
  const scores = [0, 1].map(owner => states.at(-1).owners.filter(value => value === owner).length);
  assert.equal(scores[0] + scores[1], 64);
  assert.equal(get(a, 'boardgames_gameended'), 1, 'all boxes filled ends the game');
  for (const [owner, p] of sides.entries()) assert.equal(get(p, 'boardgames_runesquares_rank'), 1600 + Math.sign(scores[owner] - scores[1 - owner]) * 50);
  closePair(a, b);
  return scores;
}
check('RuneSquares native edge buttons play all 112 edges with legal ownership and bonus turns', () => {
  const p = player();
  assert.equal(result('runesquares_is_legal_edge', p, [0, -1]), 0);
  assert.equal(result('runesquares_is_legal_edge', p, [1, 56]), 0);
  assert.equal(result('runesquares_is_legal_edge', p, [2, 0]), 0);
  assert.deepEqual(playSquares(allEdges), [64, 0]);
});
check('RuneSquares independently constructed tied full board settles without rank movement', () => {
  let tied;
  for (let seed = 1; seed <= 10000 && !tied; seed++) {
    const order = allEdges.slice(); let random = seed;
    for (let i = order.length - 1; i > 0; i--) {
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
      const j = (random >>> 0) % (i + 1); [order[i], order[j]] = [order[j], order[i]];
    }
    if (squaresModel(order).at(-1).owners.filter(owner => owner === 0).length === 32) tied = order;
  }
  assert(tied, 'independent deterministic tied-game fixture');
  assert.deepEqual(playSquares(tied), [32, 32]);
});

check('adjacent upstairs games keep spectator ownership, moves and settlement isolated', () => {
  for (const game of [2, 3]) {
    const probe = player(1), occupied = [];
    for (const number of [48, 49]) {
      const { loc } = tableAt(probe, number);
      World.changeLoc(loc, id('LocType', 'boardgames_table_runelink'), loc.shape, loc.angle, 0x7fffffff);
      occupied.push(loc);
    }
    const [a, b] = challenge(game, 1), [c, d] = challenge(game, 1);
    const firstTable = get(a, 'boardgames_tablenum');
    assert.equal(firstTable, 50); assert.equal(get(c, 'boardgames_tablenum'), 51);
    const tile = unpack(result('get_boardgames_table_coord', a, [firstTable]));
    for (const p of [a, b, c, d]) World.gameMap.getZone(p.x, p.z, p.level).enter(p);
    const spectator = player(1);
    Object.assign(spectator, { level: 1, x: tile.x, z: tile.z + 1 });
    World.gameMap.getZone(spectator.x, spectator.z, spectator.level).enter(spectator);
    runPlayer(`[oploc1,boardgames_table_${games[game]}]`, spectator,
      World.getLoc(tile.x, tile.z, 1, id('LocType', `boardgames_table_${games[game]}`)));
    assert.equal(get(spectator, 'boardgames_tablenum'), firstTable, 'viewer selects the clicked table only');
    const spectatorBoard = () => {
      if (game === 2) return board(spectator);
      const listener = spectator.invListeners.find(listener => listener.com === id('Component', 'inter_352:com_138'));
      assert(listener, 'Runeversi viewer receives the native inventory subscription');
      assert([a.uid, b.uid].includes(listener.source), 'viewer subscribes to the clicked game, not its neighbor');
      const inventory = spectator.getInventoryFromListener(listener);
      return Array.from({ length: 64 }, (_, slot) => inventory.get(slot)?.id ?? -1);
    };
    const spectatorState = () => ({
      cells: spectatorBoard(),
      edges: ['va', 'vb', 'ha', 'hb'].map(suffix => get(spectator, `boardgames_runesquares_${suffix}`))
    });
    const before = spectatorState();
    const move = (one, two, edge) => {
      const mover = get(one, 'boardgames_myturn') ? one : two, opponent = mover === one ? two : one;
      if (game === 2) button(mover, `boardgames_runesquares:com_${293 + edge}`);
      else button(mover, `inter_349:com_${161 + legal(board(mover), rune(mover), rune(opponent))[0]}`);
    };
    move(c, d, 0);
    assert.deepEqual(spectatorState(), before, 'neighbor game cannot overwrite this viewer');
    move(a, b, 1);
    if (game === 2) assert.equal(get(spectator, 'boardgames_runesquares_va'), 2);
    else assert.notDeepEqual(spectatorBoard(), before.cells, 'watched inventory updates through native invother_transmit');
    closePair(c, d);
    for (let tick = 0; tick < 20; tick++) tickPlayer(spectator);
    assert.equal(get(spectator, 'boardgames_viewing'), 1, 'neighbor settlement cannot dismiss this viewer');
    closePair(a, b);
    for (let tick = 0; tick < 20; tick++) tickPlayer(spectator);
    assert.equal(get(spectator, 'boardgames_viewing'), 0);
    for (const loc of occupied) World.revertLoc(loc);
  }
});

check('both new games time out legally, expose spectators and release sessions on logout or teleport', () => {
  for (const game of [2, 3]) for (const departure of ['logout', 'teleport']) {
    const [a, b] = challenge(game, departure === 'teleport' ? 1 : 0);
    const c = unpack(result('get_boardgames_table_coord', a, [get(a, 'boardgames_tablenum')]));
    for (const p of [a, b]) World.gameMap.getZone(p.x, p.z, p.level).enter(p);
    const spectator = player(c.level);
    Object.assign(spectator, { x: c.x, z: c.z - 1 });
    World.gameMap.getZone(spectator.x, spectator.z, spectator.level).enter(spectator);
    const loc = World.getLoc(c.x, c.z, c.level, id('LocType', `boardgames_table_${games[game]}`));
    runPlayer(`[oploc1,boardgames_table_${games[game]}]`, spectator, loc);
    assert.equal(get(spectator, 'boardgames_viewing'), 1, `${games[game]} real table spectator`);
    const before = board(a);
    const edgeBefore = ['va', 'vb', 'ha', 'hb'].map(suffix => get(a, `boardgames_runesquares_${suffix}`));
    for (let tick = 0; tick < 26; tick++) tickPlayer(a, b, spectator);
    if (game === 3) assert.notDeepEqual(board(a), before, 'timeout selects a legal Reversi placement');
    else assert.notDeepEqual(['va', 'vb', 'ha', 'hb'].map(suffix => get(a, `boardgames_runesquares_${suffix}`)), edgeBefore, 'timeout draws an unused edge');
    if (departure === 'logout') {
      runPlayer('[logout,_]', a);
    } else {
      Object.assign(a, { level: 0, x: 3200, z: 3200 });
      runProc('boardgames_leave', a);
      assert.equal(coord(a), '0:3200:3200', 'cleanup preserves the external teleport destination');
    }
    for (let tick = 0; tick < 20; tick++) tickPlayer(a, b, spectator);
    expireLocs();
    assert.equal(get(a, 'boardgames_ingame'), 0, 'departing player detached');
    assert.equal(get(b, 'boardgames_ingame'), 0, 'opponent detached');
    assert.equal(get(spectator, 'boardgames_viewing'), 0, 'spectator released after game end');
    assert(World.getLoc(c.x, c.z, c.level, baseTable), 'no permanent table lock');
    b.closeModal(); tickPlayer(b); expireLocs();
  }
});

check('both new games release the actual table when the opponent is no longer in the world', () => {
  for (const game of [2, 3]) for (const level of [0, 1]) {
    const [a, b] = challenge(game, level);
    const c = unpack(result('get_boardgames_table_coord', a, [get(a, 'boardgames_tablenum')]));
    // Abrupt-departure fixture: remove lookup/zone membership without running the opponent's logout hook.
    World.gameMap.getZone(b.x, b.z, b.level).leave(b);
    b.unlink(); delete World.players[b.slot]; b.isActive = false;
    set(a, 'boardgames_myturn', 1);
    if (game === 2) button(a, 'boardgames_runesquares:com_293');
    else button(a, 'inter_349:com_161');
    tickPlayer(a); expireLocs();
    assert.equal(get(a, 'boardgames_ingame'), 0);
    assert.equal(a.modalMain, -1, 'missing opponent closes the abandoned board');
    assert.equal(a.getInventory(boardinv).items.filter(Boolean).length, 0);
    assert(World.getLoc(c.x, c.z, c.level, baseTable), 'actual table is reusable');
    assert.equal(a.level, level);
    const minX = 2176 + (game === 2 ? 8 : 48);
    assert(a.x >= minX && a.x < minX + 8 && a.z >= 4944 && a.z < 4952);
    assert.equal(map.isMapBlocked(a.x, a.z, a.level), false);
    assert([[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dz]) =>
      !map.isMapBlocked(a.x + dx, a.z + dz, a.level) && map.findPath(a.level, a.x, a.z, a.x + dx, a.z + dz).length
    ), 'missing-opponent landing has a native route out');
    assert.equal(get(a, `boardgames_${games[game]}_rank`), 1600, 'an absent opponent cannot change ranks');
  }
});

check('RuneSquares agreed draw and early resignation preserve the existing rank threshold', () => {
  let [a, b] = challenge(2);
  for (let offer = 0; offer < 2; offer++) {
    button(a, 'boardgames_runesquares:com_95');
    for (const p of [a, b]) {
      assert.equal(get(p, 'boardgames_ingame'), 1, 'a repeated offer cannot end RuneSquares');
      assert.equal(get(p, 'boardgames_gameended'), 0, 'the RuneSquares offerer cannot accept their own draw');
    }
  }
  button(b, 'boardgames_runesquares:com_95');
  for (const p of [a, b]) {
    assert.equal(get(p, 'boardgames_ingame'), 0, 'opponent acceptance ends RuneSquares');
    assert.equal(get(p, 'boardgames_gameended'), 1, 'both players see the agreed RuneSquares draw');
  }
  assert.equal(get(a, 'boardgames_runesquares_rank'), 1600);
  assert.equal(get(b, 'boardgames_runesquares_rank'), 1600);
  closePair(a, b);
  [a, b] = challenge(2);
  a.closeModal(); tickPlayer(a, b);
  assert.equal(get(b, 'boardgames_gameended'), 1, 'modal close resigns');
  const ranks = [get(a, 'boardgames_runesquares_rank'), get(b, 'boardgames_runesquares_rank')];
  runProc('boardgames_logout', a); runProc('boardgames_logout', a);
  assert.deepEqual([get(a, 'boardgames_runesquares_rank'), get(b, 'boardgames_runesquares_rank')], ranks);
  closePair(a, b);
});

function playFourMoves(game, a, b) {
  for (let move = 0; move < 4; move++) {
    const mover = get(a, 'boardgames_myturn') ? a : b;
    if (game === 2) button(mover, `boardgames_runesquares:com_${293 + move}`);
    else {
      const opponent = mover === a ? b : a;
      const slot = legal(board(mover), rune(mover), rune(opponent))[0];
      assert.notEqual(slot, undefined);
      button(mover, `inter_349:com_${161 + slot}`);
    }
  }
}

check('ranked resignation after four legal moves settles once while unranked play preserves ranks', () => {
  for (const game of [2, 3]) for (const ranked of [0, 1]) {
    const [a, b] = challenge(game, 0, ranked);
    playFourMoves(game, a, b);
    a.closeModal(); tickPlayer(a, b);
    assert.equal(get(a, `boardgames_${games[game]}_rank`), ranked ? 1550 : 1600);
    assert.equal(get(b, `boardgames_${games[game]}_rank`), ranked ? 1650 : 1600);
    closePair(a, b);
  }
});

check('both new games clamp settled ranks to the existing 1..60000 range', () => {
  for (const game of [2, 3]) for (const rank of [1, 59990]) {
    const [a, b] = challenge(game);
    for (const p of [a, b]) set(p, `boardgames_${games[game]}_rank`, rank);
    playFourMoves(game, a, b);
    a.closeModal(); tickPlayer(a, b);
    assert.equal(get(a, `boardgames_${games[game]}_rank`), Math.max(1, rank - 50));
    assert.equal(get(b, `boardgames_${games[game]}_rank`), Math.min(60000, rank + 50));
    closePair(a, b);
  }
});

console.log(`PASS boardgames: ${assertions} compiled contract groups`);
// World retains native workers; all assertions above are synchronous offline work.
process.exit(0);
