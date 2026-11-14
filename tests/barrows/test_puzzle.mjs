#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createRunner, loadPackedRuntime, parseEnum, parseOptions, resolveRoots, run } from './packed.mjs';

const argv = process.argv.slice(2);
const regressionFlags = argv.filter(value => value === '--regression');
assert(regressionFlags.length <= 1, '--regression can be supplied once');
const regression = regressionFlags.length === 1;
const options = parseOptions([process.argv[0], process.argv[1], ...argv.filter(value => value !== '--regression')]);
const roots = resolveRoots(options);
process.chdir(roots.engineRoot);
const CENTRAL = new Set([473, 477, 478, 480]);
const u32 = value => value >>> 0;
const pointKey = point => `${point.level},${point.x},${point.z}`;

function readConstants(contentRoot) {
  const file = path.join(contentRoot, 'scripts/minigames/game_barrows/configs/barrows.constant');
  const values = new Map();
  for (const [index, line] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    const match = line.trim().match(/^\^([A-Za-z0-9_]+)\s*=\s*(-?\d+)\s*$/);
    if (!match) continue;
    assert(!values.has(match[1]), `${file}:${index + 1}: duplicate constant`);
    values.set(match[1], Number(match[2]));
  }
  return values;
}

function readMap(contentRoot) {
  const file = path.join(contentRoot, 'maps/m55_151.jm2');
  const baseX = 55 * 64;
  const baseZ = 151 * 64;
  const floors = new Set();
  const locs = [];
  let section = '';
  for (const [index, line] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    const header = /^====\s*(.*?)\s*====$/.exec(line);
    if (header) { section = header[1]; continue; }
    const row = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
    if (!row) continue;
    const level = Number(row[1]);
    const x = baseX + Number(row[2]);
    const z = baseZ + Number(row[3]);
    if (section === 'MAP' && /(?:^| )(?:f\d+|u\d+|o-?\d+)(?:[; ]|$)/.test(row[4])) floors.add(`${level},${x},${z}`);
    if (section === 'LOC') {
      const fields = row[4].trim().split(/\s+/);
      const id = Number(fields[0]);
      if (Number.isInteger(id)) locs.push({ id, level, x, z });
    }
  }
  return { floors, locs };
}

await run(async () => {
  const runtime = await loadPackedRuntime(options);
  const { World, LocType, VarPlayerType, ParamType, ScriptProvider, ScriptRunner, ScriptState,
    JavaRandom, CoordGrid, Component, SeqType, ObjType } = runtime;
  const runner = createRunner(runtime, { prefix: 'barrows_puzzle', firstUid: 32100 });
  const { makePlayer } = runner;
  const [{ default: VarSharedType }, { unzipSync }, { default: ServerTriggerType },
    { default: IfButtonHandler }, { default: IfButton }, { default: IfSetModel },
    { PlayerTimerType }, { default: Packet }, { PlayerLoading }] = await Promise.all([
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/cache/config/VarSharedType.ts')).href),
    Promise.resolve(createRequire(path.join(runtime.engineRoot, 'package.json'))('fflate')),
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/script/ServerTriggerType.ts')).href),
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/network/game/client/handler/IfButtonHandler.ts')).href),
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/network/game/client/model/IfButton.ts')).href),
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/network/game/server/model/IfSetModel.ts')).href),
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/entity/EntityTimer.ts')).href),
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/io/Packet.ts')).href),
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/entity/PlayerLoading.ts')).href)
  ]);
  VarSharedType.load(runtime.packDir);
  World.vars = new Int32Array(VarSharedType.count);
  World.currentTick = 100;
  const packedMaps = unzipSync(fs.readFileSync(path.join(runtime.packDir, '.cache/maps-server.zip')));
  assert(packedMaps.m55_151?.length && packedMaps.l55_151?.length, 'native Barrows map and loc pack are available');
  const square = Object.fromEntries(['m', 'l', 'n', 'o'].map(kind => [kind, packedMaps[`${kind}55_151`] ?? new Uint8Array()]));
  World.gameMap.packed.set((55 << 8) | 151, square);
  World.gameMap.zonemap.beginInitialization();
  World.gameMap.loadPackedMapsquare(square, 55 << 6, 151 << 6);
  World.gameMap.zonemap.endInitialization();
  const map = readMap(runtime.contentRoot);
  const constants = readConstants(runtime.contentRoot);
  const c = name => { assert(constants.has(name), `missing Barrows constant ${name}`); return constants.get(name); };
  const vars = Object.fromEntries(['barrows', 'barrows_kills', 'barrows_state', 'barrows_generation', 'barrows_countdowns'].map(name => {
    const id = VarPlayerType.getId(name); assert.notEqual(id, -1, `packed player var ${name}`); return [name, id];
  }));
  const bits = {
    puzzle: [c('barrows_puzzle_start'), c('barrows_puzzle_end')],
    identity: [c('barrows_identity_start'), c('barrows_identity_end')],
    phase: [c('barrows_phase_start'), c('barrows_phase_end')],
    corner: [c('barrows_corner_start'), c('barrows_corner_end')],
    entrance: [c('barrows_entrance_start'), c('barrows_entrance_end')],
    family: [c('barrows_family_start'), c('barrows_family_end')],
    permutation: [c('barrows_permutation_start'), c('barrows_permutation_end')]
  };
  const mask = ([lo, hi]) => u32((2 ** (hi - lo + 1) - 1) << lo);
  const get = (word, [lo, hi]) => (u32(word) >>> lo) & (2 ** (hi - lo + 1) - 1);
  const put = (word, value, range) => u32((u32(word) & ~mask(range)) | ((value << range[0]) & mask(range)));
  const pack = point => CoordGrid.packCoord(point.level, point.x, point.z);
  const decode = value => CoordGrid.unpackCoord(value);
  const layoutLocks = parseEnum(runtime.contentRoot, 'barrows_layout_locks');
  const centralLocks = [...CENTRAL];
  const centralBits = centralLocks.map(lock => lock - 469);
  const roomEdges = parseEnum(runtime.contentRoot, 'barrows_room_edges_by_lock');
  const edgesByBit = [...roomEdges].map(([lock, edges]) => [Number(lock) - 469, edges.split('|')]);
  const rooms = ['nw', 'n', 'ne', 'w', 'center', 'e', 'sw', 's', 'se'];
  const cornerRooms = ['nw', 'ne', 'sw', 'se'];
  function assertLayout(p, label) {
    const client = p.getVar(vars.barrows);
    const state = p.getVar(vars.barrows_state);
    const locks = get(client, [c('barrows_locks_start'), c('barrows_locks_end')]);
    const corner = get(state, bits.corner);
    const entrance = get(state, bits.entrance);
    assert.equal(get(client, [c('barrows_ladder_start'), c('barrows_ladder_end')]), 1 << corner,
      `${label}: exactly the selected ladder is visible`);
    assert.deepEqual(centralBits.filter(bit => (locks & (1 << bit)) === 0), [centralBits[entrance]],
      `${label}: exactly the selected central entrance opens`);
    const cornerBits = edgesByBit.filter(([, edges]) => edges.some(edge => edge.split('>').includes(cornerRooms[corner]))).map(([bit]) => bit);
    assert.equal(cornerBits.length, 4, `${label}: the measured ladder room has four doors`);
    assert.equal(cornerBits.filter(bit => (locks & (1 << bit)) === 0).length, 1,
      `${label}: exactly one door opens in the ladder room`);
    const adjacency = new Map();
    for (const [bit, edges] of edgesByBit) {
      for (const edge of edges) {
        const [left, right] = edge.split('>');
        if (!adjacency.has(left)) adjacency.set(left, new Set());
        if (!adjacency.has(right)) adjacency.set(right, new Set());
        if ((locks & (1 << bit)) !== 0) continue;
        adjacency.get(left).add(right);
        adjacency.get(right).add(left);
      }
    }
    const seen = new Set([cornerRooms[corner]]);
    for (const node of seen) for (const next of adjacency.get(node)) seen.add(next);
    assert.deepEqual(rooms.filter(room => seen.has(room)), rooms, `${label}: all nine rooms remain connected`);
  }
  let serial = 0;
  function player(label) {
    const p = makePlayer(`${label}_${++serial}`);
    p.slot = serial;
    p.pid = p.slot;
    p.uid = (Number(p.username37 & 0x1fffffn) << 11) | p.slot;
    p.isActive = true;
    p.baseLevels[3] = p.levels[3] = 99;
    p.messages = [];
    p.packets = [];
    p.write = message => p.packets.push(message);
    p.messageGame = message => p.messages.push(message);
    p.wrappedMessageGame = p.messageGame;
    World.players[p.slot] = p;
    World.playerLoop.add(0x73000000n + BigInt(p.slot), p);
    return p;
  }
  function restorePlayer(source) {
    const restored = PlayerLoading.load(source.username, new Packet(source.save()), null);
    restored.uid = source.uid;
    restored.pid = source.pid;
    restored.packets = [];
    restored.messages = [];
    restored.write = message => restored.packets.push(message);
    restored.messageGame = message => restored.messages.push(message);
    restored.wrappedMessageGame = restored.messageGame;
    return restored;
  }
  function seed(p, lock, source, { stateHigh = 0x28000000, clientLow = 0x35, raw = 4, countdown = 0x00070006, credit = 0x6122457f } = {}) {
    let state = stateHigh;
    state = put(state, 1, bits.identity);
    state = put(state, 1, bits.phase);
    state = put(state, 0, bits.corner);
    state = put(state, centralLocks.indexOf(lock), bits.entrance);
    state = put(state, 0, bits.family);
    state = put(state, 0, bits.permutation);
    state &= ~(1 << c('barrows_solved_bit'));
    state &= ~(1 << c('barrows_challenge_bit'));
    let client = put(clientLow, raw, bits.puzzle);
    const locks = Number(layoutLocks.get('0')) & ~(1 << (lock - 469));
    client = put(client, 1, [c('barrows_ladder_start'), c('barrows_ladder_end')]);
    client = put(client, locks, [c('barrows_locks_start'), c('barrows_locks_end')]);
    p.setVar(vars.barrows, client);
    p.setVar(vars.barrows_state, state);
    p.setVar(vars.barrows_generation, 700 + serial);
    p.setVar(vars.barrows_kills, credit);
    p.setVar(vars.barrows_countdowns, countdown);
    p.teleport(source.x, source.z, source.level);
    return { client: u32(client), state: u32(state), generation: 700 + serial, credit: u32(credit), countdown: u32(countdown) };
  }
  function call(p, name, args = [], target = null) {
    const script = ScriptProvider.getByName(name.startsWith('[') ? name : `[proc,${name}]`);
    assert(script, `packed script missing ${name}`);
    const state = ScriptRunner.init(script, p, target, args);
    p.executeScript(state, true);
    assert.notEqual(state.execution, ScriptState.ABORTED, `${name} not aborted`);
    return state;
  }
  function controlled(choices, fn) {
    const original = JavaRandom.nextDouble;
    let i = 0;
    JavaRandom.nextDouble = function () {
      assert(i < choices.length, 'unexpected script random draw');
      const [value, bound] = choices[i++];
      assert(value >= 0 && value < bound);
      return (value + 0.25) / bound;
    };
    try { const result = fn(); assert.equal(i, choices.length, 'all controlled draws consumed'); return result; }
    finally { JavaRandom.nextDouble = original; }
  }
  function assertDone(p, label) {
    assert.equal(p.delayed, false, `${label}: no player delay remains`);
    assert.equal(p.activeScript, null, `${label}: no script continuation remains`);
    assert.equal(p.protect, false, `${label}: protected access released`);
  }
  function resumeOneTick(p) {
    if (p.delayed) {
      World.currentTick = Math.max(World.currentTick, p.delayedUntil);
      p.delayed = false;
    }
    if (p.activeScript?.execution === ScriptState.SUSPENDED) p.executeScript(p.activeScript, true, true);
  }
  function nativeDoor(p, crossing) {
    p.target = crossing.loc;
    p.targetOp = ServerTriggerType.OPLOC1 - 7;
    const trigger = p.getOpTrigger();
    assert(trigger, 'real OPLOC1 resolves an unlocked map child');
    const state = ScriptRunner.init(trigger, p, crossing.loc, []);
    p.executeScript(state, true);
    return state;
  }
  function seededWrongDraw(p, corner) {
    const occupied = p.x <= 3528 ? 1 : p.x >= 3575 ? 7 : p.z <= 9671 ? 15 : p.z >= 9718 ? 0 : -1;
    const counts = [0,1,2,3].map(value => occupied === -1 ? c('barrows_layout_count')
      : Number(layoutCorridorCount.get(String(value * 16 + occupied))));
    assert(counts[corner] > 0, `corner ${corner} has a valid layout for the captured room`);
    const index = counts.slice(0, corner).reduce((sum, value) => sum + value, 0);
    return { index, bound: counts.reduce((sum, value) => sum + value, 0) * 3 };
  }
  function click(p, name) {
    const handler = new IfButtonHandler();
    const component = Component.getId(name);
    assert.notEqual(component, -1, `real button component ${name}`);
    assert(handler.handle(new IfButton(component), p), `real IfButtonHandler accepts ${name}`);
  }
  function snapshot(p) {
    return [u32(p.getVar(vars.barrows)), u32(p.getVar(vars.barrows_state)), u32(p.getVar(vars.barrows_generation)),
      u32(p.getVar(vars.barrows_kills)), u32(p.getVar(vars.barrows_countdowns))];
  }
  function centralCrossing() {
    const lockParam = ParamType.getId('barrows_room_edge_lock');
    assert.notEqual(lockParam, -1, 'door lock parameter packed');
    const rows = map.locs.filter(row => CENTRAL.has(LocType.get(row.id)?.params?.get(lockParam)));
    assert(rows.length > 0, 'real map contains central doors');
    for (const row of rows) {
      const parent = LocType.get(row.id);
      const loc = World.getLoc(row.x, row.z, row.level, row.id);
      assert(loc, 'map door is a native loc');
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const source = { level: row.level, x: row.x + dx, z: row.z + dz };
        const destinationValue = call(probe, 'barrows_door_destination', [
          pack({ level: row.level, x: row.x, z: row.z }), pack(source)
        ]).popInt();
        if (destinationValue === -1 || !map.floors.has(pointKey(source))) continue;
        const destination = decode(destinationValue);
        if (!map.floors.has(pointKey(destination))) continue;
        return { id: row.id, lock: parent.params.get(lockParam), loc, anchor: { level: row.level, x: row.x, z: row.z }, source, destination };
      }
    }
    assert.fail('native map has a central door with two walkable room-side tiles');
  }

  const probe = player('probe');
  if (regression) {
    const candidate = centralCrossing();
    const regressionPlayer = player('regression');
    seed(regressionPlayer, candidate.lock, candidate.source);
    const state = nativeDoor(regressionPlayer, candidate);
    assert.equal(state.execution, ScriptState.PAUSEBUTTON, 'S08 public central door path must suspend on the real puzzle in S09');
    assert.equal(regressionPlayer.activeScript, state, 'regression path owns a real continuation');
    assert.equal(regressionPlayer.modalMain, Component.getId('next_shape'), 'regression path opens the real main puzzle interface');
    return;
  }
  assert(ScriptProvider.getByName('[proc,barrows_puzzle_render]'), 'real puzzle renderer is packed');
  assert(ScriptProvider.getByName('[proc,barrows_puzzle_answer]'), 'real semantic answer predicate is packed');
  assert(ScriptProvider.getByName('[proc,barrows_puzzle_open]'), 'real protected puzzle opener is packed');
  const prompts = [6734,6735,6736,6716,6717,6718,6722,6723,6724,6728,6727,6730];
  const answers = [6731,6732,6733,6714,6715,6713,6721,6719,6720,6726,6729,6725];
  const correct = [0,2,1,2];
  const permutation = parseEnum(runtime.contentRoot, 'barrows_puzzle_permutation');
  const correctTable = parseEnum(runtime.contentRoot, 'barrows_puzzle_correct_answer');
  const permAt = index => Number(permutation.get(String(index)));
  assert.equal(permutation.size, 18, 'six permutations define three displayed semantic answers each');
  assert.deepEqual([...correctTable], correct.map((value, index) => [String(index), String(value)]), 'all family semantic correct-answer identities are mapped');
  const promptTable = parseEnum(runtime.contentRoot, 'barrows_puzzle_prompt_model');
  const layoutCorridorCount = parseEnum(runtime.contentRoot, 'barrows_layout_corridor_count');
  const answerTable = parseEnum(runtime.contentRoot, 'barrows_puzzle_answer_model');
  assert.deepEqual([...promptTable], prompts.map((value, index) => [String(index), String(value)]), 'all twelve prompt model joins match the four families');
  assert.deepEqual([...answerTable], answers.map((value, index) => [String(index), String(value)]), 'all twelve answer model joins match semantic models');
  const packetStart = probe.packets.length;
  for (let family = 0; family < 4; family++) {
    for (let perm = 0; perm < 6; perm++) {
      call(probe, 'barrows_puzzle_render', [family, perm]);
      const updates = probe.packets.slice(packetStart).filter(packet => packet instanceof IfSetModel);
      const root = Component.getId('next_shape');
      const ids = ['com_1','com_2','com_3','com_6','com_7','com_8'].map(name => Component.getId(`next_shape:${name}`));
      assert(ids.every(id => id !== -1), 'all six native puzzle components exist');
      const latest = new Map(updates.filter(packet => ids.includes(packet.component)).map(packet => [packet.component, packet.model]));
      assert.deepEqual(ids.map(id => latest.get(id)), [0,1,2].map(i => prompts[family * 3 + i]).concat([0,1,2].map(slot => {
        const semantic = permAt(perm * 3 + slot);
        return answers[family * 3 + semantic];
      })), `family ${family}, permutation ${perm} renders native prompt and shuffled real answer models`);
      assert(root >= 0);
      for (let slot = 0; slot < 3; slot++) {
        const semantic = permAt(perm * 3 + slot);
        const got = call(probe, 'barrows_puzzle_answer', [family, perm, slot]).popInt();
        assert.equal(got, semantic === correct[family] ? 1 : 0, `family ${family}, permutation ${perm}, button slot ${slot} uses semantic model`);
      }
    }
  }
  // Identical original models remain distinct ids and neither is the correct rising bar.
  assert.equal(answers[10], 6729);
  assert.equal(answers[9], 6726);
  assert.equal(prompts[10], 6727, 'the prompt uses the original 6727 bar model id');
  assert.equal(answers[10], 6729, 'the identical distractor uses the distinct original 6729 model id');
  assert.notEqual(answers[11], 6729, 'neither equivalent distractor id is the correct 6725 model');
  const uniqueOrders = new Set();
  for (let perm = 0; perm < 6; perm++) {
    const slots = [0,1,2].map(slot => permAt(perm * 3 + slot));
    assert.equal(new Set(slots).size, 3, `permutation ${perm} is a full semantic ordering`);
    assert(slots.includes(correct[3]), `rising-bars permutation ${perm} includes the correct top-bar identity`);
    assert.equal(slots.filter(value => value === correct[3]).length, 1, `rising-bars permutation ${perm} has exactly one semantic correct answer`);
    uniqueOrders.add(slots.join(','));
  }
  assert.equal(uniqueOrders.size, 6, 'all six semantic permutations are distinct');
  for (const [family, perm, slot] of [[-1,0,0],[4,0,0],[0,-1,0],[0,6,0],[0,0,-1],[0,0,3]])
    assert.equal(call(probe, 'barrows_puzzle_answer', [family, perm, slot]).popInt(), 0, 'invalid family/permutation/button is safely incorrect');
  assert.equal(call(probe, 'barrows_puzzle_answer', [3,0,0]).popInt(), 0, 'duplicate-id distractor never authorizes the rising-bars answer');
  const crossing = centralCrossing();
  const lock = crossing.lock;
  assert(CENTRAL.has(lock));

  // Every amendment event uses the actual lifecycle proc and the measured graph.
  const lifecycle = player('draw-events');
  lifecycle.teleport(3565, 3289, 0);
  const begin = controlled([[0,6],[0,1024]], () => call(lifecycle, 'barrows_run_begin'));
  assert.equal(begin.popInt(), 1, 'generation-zero begin starts a real run');
  assertLayout(lifecycle, 'initial begin');
  const previousCorner = get(lifecycle.getVar(vars.barrows_state), bits.corner);
  const previousEntrance = get(lifecycle.getVar(vars.barrows_state), bits.entrance);
  const beforeSearch = u32(lifecycle.getVar(vars.barrows));
  const search = controlled([], () => call(lifecycle, 'barrows_search_latch', [lifecycle.getVar(vars.barrows_generation)]));
  assert.equal(search.popInt(), 1, 'the private Search transition remains callable by the compiled fixture');
  assert.equal(u32(lifecycle.getVar(vars.barrows)), beforeSearch, 'Search draws nothing and preserves the entire client layout and raw puzzle field');
  assertLayout(lifecycle, 'Search without a draw');
  controlled([[17,64]], () => call(lifecycle, 'barrows_run_reset'));
  assert.equal(get(lifecycle.getVar(vars.barrows_state), bits.corner), previousCorner, 'reset retains its previous corner');
  assert.equal(get(lifecycle.getVar(vars.barrows_state), bits.entrance), previousEntrance, 'reset retains its previous central selector');
  assertLayout(lifecycle, 'paid reset');
  const nextBegin = controlled([[1,6],[0,576]], () => call(lifecycle, 'barrows_run_begin'));
  assert.equal(nextBegin.popInt(), 1, 'a consecutive begin starts a real run');
  assert.notEqual(get(lifecycle.getVar(vars.barrows_state), bits.corner), previousCorner, 'consecutive begin excludes the previous corner');
  assert.notEqual(get(lifecycle.getVar(vars.barrows_state), bits.entrance), previousEntrance, 'consecutive begin excludes the previous central selector');
  assertLayout(lifecycle, 'consecutive begin');

  // A real main-modal pause freezes the shared normal timer, not the client face.
  const modalClock = player('modal-clock');
  seed(modalClock, lock, crossing.source, { countdown: 0xa35d0001, credit: 0x61224541 });
  modalClock.baseLevels[5] = 99;
  modalClock.levels[5] = 100;
  modalClock.lowMemory = false;
  call(modalClock, 'barrows_resume');
  const timerScript = ScriptProvider.getByName('[timer,barrows_timer_tick]');
  assert(timerScript, 'the native repeating Barrows timer is packed');
  const sharedTimer = modalClock.timers.get(timerScript.id);
  assert(sharedTimer, 'resume arms the actual shared timer');
  assert.equal(sharedTimer.type, PlayerTimerType.NORMAL, 'the shared timer uses the normal access lane');
  World.currentTick++;
  controlled([[0,1]], () => modalClock.processTimers(PlayerTimerType.NORMAL));
  assert.equal(modalClock.levels[5], 100 - c('barrows_prayer_base_drain') - 1, 'a due native callback drains Prayer before the modal opens');
  const greenFace = ObjType.getId('barrows_interface_ahrim_green');
  const faceSlot = Component.getId('kill_count:com_1');
  assert(greenFace >= 0 && faceSlot >= 0, 'the original tunnel face and its overlay slot are packed');
  assert(modalClock.packets.some(packet => packet.constructor.name === 'IfSetObject' && packet.component === faceSlot && packet.obj === greenFace),
    'the compiled due callback displays the actual slain face');
  assert(modalClock.packets.some(packet => packet.constructor.name === 'IfSetAnim' && packet.component === faceSlot && packet.seq === SeqType.getId('barrows_chathead_fade')),
    'the displayed face starts its original pulsing sequence');
  const clockBeforeModal = sharedTimer.clock;
  const countdownBeforeModal = u32(modalClock.getVar(vars.barrows_countdowns));
  const prayerBeforeModal = modalClock.levels[5];
  const overlayBeforeModal = modalClock.overlay;
  assert.equal(overlayBeforeModal, Component.getId('kill_count'), 'the real face overlay is open before the puzzle');
  const facePacketStart = modalClock.packets.length;
  const clockPuzzle = controlled([[0,4],[0,6]], () => nativeDoor(modalClock, crossing));
  assert.equal(clockPuzzle.execution, ScriptState.PAUSEBUTTON, 'the timer fixture holds a native puzzle continuation');
  for (let tick = 0; tick < 18; tick++) {
    World.currentTick++;
    controlled([], () => modalClock.processTimers(PlayerTimerType.NORMAL));
    assert.equal(u32(modalClock.getVar(vars.barrows_countdowns)), countdownBeforeModal, 'an open puzzle freezes both saved countdown halves');
    assert.equal(modalClock.levels[5], prayerBeforeModal, 'an open puzzle causes no further Prayer drain');
    assert.equal(modalClock.timers.get(timerScript.id), sharedTimer, 'an open puzzle retains the same native timer');
    assert.equal(sharedTimer.clock, clockBeforeModal, 'an open puzzle does not advance the native callback clock');
    assert.equal(modalClock.overlay, overlayBeforeModal, 'the puzzle does not replace the existing face overlay');
  }
  assert.equal(modalClock.packets.slice(facePacketStart).filter(packet => packet.constructor.name === 'IfSetObject').length, 0,
    'the modal does not clear or replay the displayed face, whose client sequence can keep pulsing');
  controlled([], () => modalClock.closeModal());
  const fadeTicks = Math.ceil(SeqType.get(SeqType.getId('barrows_chathead_fade')).duration / c('barrows_client_cycles_per_tick'));
  assert(fadeTicks > 0 && fadeTicks < c('barrows_prayer_interval_ticks'), 'the original face completes before the next due drain');
  for (let elapsed = 1; elapsed <= fadeTicks; elapsed++) {
    if (elapsed > 1) World.currentTick++;
    controlled([], () => modalClock.processTimers(PlayerTimerType.NORMAL));
    assert.equal(modalClock.getVar(vars.barrows_countdowns) & 0xffff, (countdownBeforeModal & 0xffff) - elapsed,
      'closing the puzzle resumes one saved tick per callback without catching up the blocked time');
    assert.equal(u32(modalClock.getVar(vars.barrows_countdowns)) >>> 16, countdownBeforeModal >>> 16, 'resumed Prayer callbacks preserve the collapse half');
  }
  const clearedFaces = modalClock.packets.slice(facePacketStart).filter(packet => packet.constructor.name === 'IfSetObject' && (packet.obj & 0xffff) === 65535);
  assert.deepEqual(clearedFaces.map(packet => packet.component).sort((a, b) => a - b),
    [1,2,3,4,5,6].map(slot => Component.getId(`kill_count:com_${slot}`)).sort((a, b) => a - b),
    'the resumed native callback clears all six original face slots at the retained fade remainder');

  // The real incoming NPC hit path closes the modal before its queued damage.
  const attacked = player('combat-interruption');
  seed(attacked, lock, crossing.source);
  call(attacked, 'barrows_resume');
  const combatTimer = attacked.timers.get(timerScript.id);
  const interrupted = controlled([[1,4],[3,6]], () => nativeDoor(attacked, crossing));
  assert.equal(interrupted.execution, ScriptState.PAUSEBUTTON, 'combat interrupts an actual open puzzle');
  const beforeHit = snapshot(attacked);
  const attacker = runner.addNpc('barrows_skeleton_unarmed', crossing.source.level, null, crossing.source.x + 1, crossing.source.z).npc;
  const hitScript = ScriptProvider.getByName('[proc,playerhit_n_melee]');
  assert(hitScript, 'the real incoming melee path is packed');
  const hitState = ScriptRunner.init(hitScript, attacker, attacked, [1,4]);
  controlled([], () => attacker.executeScript(hitState));
  assert.equal(hitState.execution, ScriptState.FINISHED, 'native NPC execution finishes the incoming hit path');
  assert.equal(attacked.activeScript, null, 'incoming melee cancels the native puzzle continuation');
  assert.equal(attacked.modalMain, -1, 'incoming melee closes the actual main modal');
  assert.deepEqual(attacked.resumeButtons, [], 'incoming melee invalidates all real answer buttons');
  assert.deepEqual(snapshot(attacked), [beforeHit[0], u32(beforeHit[1] & ~(1 << c('barrows_challenge_bit'))), ...beforeHit.slice(2)],
    'incoming melee clears only challenge activity, preserving layout, selection, credit, generation and both countdowns');
  assert.equal(attacked.timers.get(timerScript.id), combatTimer, 'combat does not replace or stop the shared timer');
  const staleCombatSlot = [0,1,2].find(slot => permAt(3 * 3 + slot) === correct[1]);
  const afterHit = snapshot(attacked);
  controlled([], () => new IfButtonHandler().handle(new IfButton(Component.getId(`next_shape:com_${6 + staleCombatSlot}`)), attacked));
  assert.deepEqual(snapshot(attacked), afterHit, 'an old correct button after combat cannot solve, redraw or grant credit');
  assert.deepEqual([attacked.level,attacked.x,attacked.z], [crossing.source.level,crossing.source.x,crossing.source.z], 'combat and a stale button never transfer the player');
  const damageScript = ScriptProvider.getByName('[queue,combat_damage_player]');
  assert([...attacked.queue.all()].some(request => request.script === damageScript), 'the actual incoming hit queued the real damage script');
  controlled([[0,3]], () => {
    for (let tick = 0; tick < 2 && attacked.levels[3] === 99; tick++) {
      World.currentTick++;
      attacked.processQueues();
    }
  });
  assert.equal(attacked.levels[3], 98, 'the real protected damage queue applies the incoming melee hit');
  controlled([], () => attacked.processTimers(PlayerTimerType.NORMAL));
  assert.equal(attacked.getVar(vars.barrows_countdowns) & 0xffff, (beforeHit[4] & 0xffff) - 1, 'combat close resumes the shared saved remainder once');
  assert.equal(u32(attacked.getVar(vars.barrows_countdowns)) >>> 16, beforeHit[4] >>> 16, 'combat close preserves the collapse countdown half');
  runner.removeFixtures();
  const failed = player('unavailable');
  const original = seed(failed, lock, crossing.source);
  const invalid = call(failed, 'barrows_puzzle_open', [crossing.id, pack({ level: crossing.anchor.level, x: crossing.anchor.x + 8, z: crossing.anchor.z })], crossing.loc);
  assert.equal(invalid.popInt(), 0, 'invalid parent is rejected');
  assert.deepEqual(snapshot(failed), [original.client, original.state, original.generation, original.credit, original.countdown], 'invalid opening changes no durable state');
  const cancelled = player('cancelled');
  const cancelBefore = seed(cancelled, lock, crossing.source);
  const cancelScript = controlled([[2,4],[5,6]], () => nativeDoor(cancelled, crossing));
  assert.equal(cancelScript.execution, ScriptState.PAUSEBUTTON, 'cancel fixture opens a real protected challenge');
  const cancelOpen = snapshot(cancelled);
  cancelled.closeModal();
  assert.deepEqual(snapshot(cancelled), [cancelOpen[0], u32(cancelOpen[1] & ~(1 << c('barrows_challenge_bit'))), cancelOpen[2], cancelOpen[3], cancelOpen[4]],
    'closing the challenge clears only bit 15 and preserves client puzzle field, selectors, solved state, run and countdowns');
  assert.equal(cancelled.activeScript, null, 'native modal close cancels the paused continuation');
  assert.equal(get(cancelled.getVar(vars.barrows_state), [c('barrows_challenge_bit'), c('barrows_challenge_bit')]), 0, 'native close clears only challenge activity');
  assert.equal(get(cancelled.getVar(vars.barrows_state), bits.family), 2, 'cancel preserves selected family');
  assert.equal(get(cancelled.getVar(vars.barrows_state), bits.permutation), 5, 'cancel preserves selected permutation');
  assert.equal(get(cancelled.getVar(vars.barrows), bits.puzzle), 2, 'cancel retains the client puzzle field');
  assert.equal(u32(cancelled.getVar(vars.barrows_generation)), cancelBefore.generation, 'cancel preserves run generation');
  assert.equal(u32(cancelled.getVar(vars.barrows_kills)), cancelBefore.credit, 'cancel grants no encounter credit');
  assert.deepEqual([cancelled.level,cancelled.x,cancelled.z], [crossing.source.level,crossing.source.x,crossing.source.z], 'cancel never transfers');

  const stale = player('stale');
  const staleBefore = seed(stale, lock, crossing.source);
  const staleScript = controlled([[1,4],[4,6]], () => nativeDoor(stale, crossing));
  assert.equal(staleScript.execution, ScriptState.PAUSEBUTTON);
  stale.setVar(vars.barrows_generation, staleBefore.generation + 1);
  const staleSlot = [0,1,2].find(slot => permAt(4 * 3 + slot) === correct[1]);
  click(stale, `next_shape:com_${6 + staleSlot}`);
  assert.equal(get(stale.getVar(vars.barrows_state), [c('barrows_solved_bit'), c('barrows_solved_bit')]), 0, 'generation-stale answer cannot solve');
  assert.deepEqual([stale.level,stale.x,stale.z], [crossing.source.level,crossing.source.x,crossing.source.z], 'generation-stale answer cannot transfer');
  assert.equal(u32(stale.getVar(vars.barrows_kills)), staleBefore.credit, 'generation-stale answer cannot grant credit');
  stale.closeModal();
  assert.equal(stale.activeScript, null, 'closing a stale modal cancels its remaining presentation');
  assert.equal(get(stale.getVar(vars.barrows_state), [c('barrows_challenge_bit'), c('barrows_challenge_bit')]), 0, 'stale modal close clears challenge');

  // Exercise all three real button positions through the public door and native handler.
  for (let family = 0; family < 4; family++) {
    for (let perm = 0; perm < 6; perm++) {
      const correctSemantic = correct[family];
      for (let slot = 0; slot < 3; slot++) {
        const p = player(`case_${family}_${perm}_${slot}`);
        const before = seed(p, lock, crossing.source);
        const state = controlled([[family,4],[perm,6]], () => nativeDoor(p, crossing));
        assert.equal(state.execution, ScriptState.PAUSEBUTTON, `family ${family}/${perm} is a native paused interaction`);
        assert.equal(p.activeScript, state, 'paused handler is retained by player');
        assert.equal(get(p.getVar(vars.barrows_state), bits.family), family, 'family writes to server state');
        assert.equal(get(p.getVar(vars.barrows_state), bits.permutation), perm, 'permutation writes to server state');
        assert.equal(get(p.getVar(vars.barrows), bits.puzzle), family, 'client puzzle field records selected family');
        assert.equal(get(p.getVar(vars.barrows_state), [c('barrows_challenge_bit'), c('barrows_challenge_bit')]), 1, 'challenge bit is active while modal is open');
        assert.equal(p.modalMain, Component.getId('next_shape'), 'public door opens the native main puzzle interface');
        const npcNidsBeforeAnswer = new Set(Array.from(World.npcs).filter(npc => npc.isActive).map(npc => npc.nid));
        const isCorrect = permAt(perm * 3 + slot) === correctSemantic;
        const targetCorner = (family + perm + slot) % 2 === 0 ? 1 : 0;
        const hpBeforeAnswer = p.levels[3];
        const answerPacketStart = p.packets.length;
        if (isCorrect) controlled([[0,128]], () => click(p, `next_shape:com_${6 + slot}`));
        else {
          const draw = seededWrongDraw(p, targetCorner);
          controlled([[draw.index, draw.bound]], () => click(p, `next_shape:com_${6 + slot}`));
        }
        if (!isCorrect) {
          assert.equal(p.activeScript?.execution, ScriptState.SUSPENDED, 'wrong answer waits in the real one-tick error delay');
          assert.equal(p.delayedUntil, World.currentTick + c('barrows_puzzle_error_shake_ticks'), 'wrong answer holds exactly its declared error delay');
          const shakes = p.packets.slice(answerPacketStart).filter(packet => packet.constructor.name === 'CamShake');
          assert.deepEqual(shakes.map(({ axis, random, amplitude, rate }) => [axis, random, amplitude, rate]),
            [[c('barrows_puzzle_error_shake_axis'), c('barrows_puzzle_error_shake_random'), 0, 0]], 'wrong answer sends the native nonverbal camera shake');
        }
        resumeOneTick(p);
        assertDone(p, 'answered puzzle');
        assert.equal(state.execution, ScriptState.FINISHED, 'the retained native door continuation finishes without a script abort');
        assert.equal(p.levels[3], hpBeforeAnswer, 'neither answer inflicts deferred wrong-answer rock damage');
        assert.equal(p.packets.slice(answerPacketStart).filter(packet => packet.constructor.name === 'CamReset').length, isCorrect ? 0 : 1,
          'only the completed wrong-answer delay resets the native camera');
        assert.equal(get(p.getVar(vars.barrows_state), [c('barrows_challenge_bit'), c('barrows_challenge_bit')]), 0, 'answer closes active challenge');
        if (permAt(perm * 3 + slot) === correctSemantic) {
          assert.equal(get(p.getVar(vars.barrows_state), [c('barrows_solved_bit'), c('barrows_solved_bit')]), 1, 'semantic correct answer sets solved authorization');
          assert.deepEqual([p.level,p.x,p.z], [crossing.destination.level,crossing.destination.x,crossing.destination.z], 'correct answer transfers to measured other side');
        } else {
          assert.equal(get(p.getVar(vars.barrows_state), [c('barrows_solved_bit'), c('barrows_solved_bit')]), 0, 'wrong answer grants no crossing authorization');
          assert.deepEqual([p.level,p.x,p.z], [crossing.source.level,crossing.source.x,crossing.source.z], 'wrong answer never transfers');
          assert.equal(u32(p.getVar(vars.barrows_kills)), before.credit, 'wrong answer grants no encounter credit');
          assert.equal(u32(p.getVar(vars.barrows_countdowns)), before.countdown, 'wrong answer preserves both countdown halves');
          assert.deepEqual(snapshot(p), [u32(p.getVar(vars.barrows)), u32(p.getVar(vars.barrows_state)), before.generation, before.credit, before.countdown],
            'wrong answer changes only puzzle/layout state, not run identity, credit or timers');
          assert.equal(Array.from(World.npcs).filter(npc => npc.isActive && !npcNidsBeforeAnswer.has(npc.nid)).length, 0,
            'wrong answer creates no native encounter actor');
          const corner = get(p.getVar(vars.barrows_state), bits.corner);
          assert.equal(corner, targetCorner, 'seeded wrong-answer draw selects a changed or repeated ladder corner');
          const visibility = get(p.getVar(vars.barrows), [c('barrows_ladder_start'), c('barrows_ladder_end')]);
          assert.notEqual(get(p.getVar(vars.barrows_state), bits.entrance), get(before.state, bits.entrance),
            'wrong answer changes the reachable central entrance');
          assertLayout(p, `wrong answer ${family}/${perm}/${slot}`);
          assert.equal(visibility, 1 << corner, 'every wrong-answer layout draw leaves exactly its selected ladder visible');
          assert.equal([0,1,2,3].filter(candidate => (visibility & (1 << candidate)) !== 0).length, 1, 'wrong-answer draw never exposes multiple ladders');
        }
      }
    }
  }
  const relog = player('solved-relog');
  seed(relog, lock, crossing.source);
  const relogFamily = 2;
  const relogPermutation = 5;
  const relogScript = controlled([[relogFamily,4],[relogPermutation,6]], () => nativeDoor(relog, crossing));
  assert.equal(relogScript.execution, ScriptState.PAUSEBUTTON, 'relog fixture is a live native puzzle session');
  const relogSlot = [0,1,2].find(slot => permAt(relogPermutation * 3 + slot) === correct[relogFamily]);
  controlled([[0,128]], () => click(relog, `next_shape:com_${6 + relogSlot}`));
  resumeOneTick(relog);
  const saved = snapshot(relog);
  assert.equal(get(saved[1], [c('barrows_solved_bit'), c('barrows_solved_bit')]), 1, 'relog fixture has solved authorization');
  const restored = restorePlayer(relog);
  assert.deepEqual(snapshot(restored), saved, 'clean player save/load retains solved authorization, family, permutation, raw puzzle field and saved countdowns');
  assert.equal(get(restored.getVar(vars.barrows_state), [c('barrows_challenge_bit'), c('barrows_challenge_bit')]), 0, 'relog never restores an active challenge');
  console.log('PASS S09 semantic puzzle: 24 native renderings, 72 real button positions, duplicate equivalence, all amended draw events, modal timer and face retention, native incoming melee cancellation, wrong-answer error and correct transfer');
});
