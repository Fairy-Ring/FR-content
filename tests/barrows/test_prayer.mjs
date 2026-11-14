#!/usr/bin/env node
/**
 * S06 Prayer/faces regression through compiled scripts and native Player timers.
 * Run after packing from the sibling engine:
 *   node --import tsx ../content/tests/barrows/test_prayer.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRunner, loadPackedRuntime, packedId, parseOptions, run } from './packed.mjs';

function parseTestOptions(argv) {
  const forwarded = argv.slice(0, 2);
  let regression = null;
  for (let index = 2; index < argv.length; index++) {
    const [name, inlineValue] = argv[index].split(/=(.*)/s, 2);
    if (name !== '--regression') {
      forwarded.push(argv[index]);
      continue;
    }
    assert.equal(regression, null, '--regression may be supplied only once');
    const value = inlineValue ?? argv[++index];
    assert(['prayer-zero', 'face-clear'].includes(value), `unknown or missing regression: ${value ?? ''}`);
    regression = value;
  }
  return { options: parseOptions(forwarded), regression };
}

const { options, regression } = parseTestOptions(process.argv);
const PRAYER = 5;
const COUNTDOWN_MASK = 0xffff;
const COUNTDOWN_HIGH_MASK = 0xffff0000;
const COUNTDOWN_INTERVAL = 17;
const CYCLES_PER_TICK = 30;
const BROTHERS = [
  { name: 'ahrim', originalId: 4761, slot: 'kill_count:com_1' },
  { name: 'dharok', originalId: 4763, slot: 'kill_count:com_2' },
  { name: 'guthan', originalId: 4765, slot: 'kill_count:com_3' },
  { name: 'karil', originalId: 4767, slot: 'kill_count:com_4' },
  { name: 'torag', originalId: 4769, slot: 'kill_count:com_5' },
  { name: 'verac', originalId: 4771, slot: 'kill_count:com_6' }
];

const u32 = value => value >>> 0;
const low = value => u32(value) & COUNTDOWN_MASK;
const high = value => u32(value) >>> 16;
const popcount = value => value.toString(2).split('1').length - 1;
const phaseWord = phase => u32(0x6a5a0000 | ((phase & 3) << 3) | 1);
const countdownWord = (highHalf, lowHalf) => u32(((highHalf & COUNTDOWN_MASK) << 16) | (lowHalf & COUNTDOWN_MASK));
const packetKind = message => message?.constructor?.name ?? '';

await run(async () => {
  const runtime = await loadPackedRuntime(options);
  const { contentRoot, World, VarPlayerType, ObjType, Component, SeqType, ScriptProvider, ScriptRunner,
    ScriptState, JavaRandom } = runtime;
  const eng = relative => import(pathToFileURL(path.join(runtime.engineRoot, 'src', relative)).href);
  const [{ PlayerLoading }, { default: Packet }, { default: VarSharedType },
    { PlayerTimerType }, { default: ServerTriggerType }, { default: ColorConversion },
    { default: IfSetObject }, { default: IfSetHide }, { default: IfSetObjectEncoder }, { default: ServerGameProt }] = await Promise.all([
    eng('engine/entity/PlayerLoading.ts'),
    eng('io/Packet.ts'),
    eng('cache/config/VarSharedType.ts'),
    eng('engine/entity/EntityTimer.ts'),
    eng('engine/script/ServerTriggerType.ts'),
    eng('util/ColorConversion.ts'),
    eng('network/game/server/model/IfSetObject.ts'),
    eng('network/game/server/model/IfSetHide.ts'),
    eng('network/game/server/codec/IfSetObjectEncoder.ts'),
    eng('network/game/server/ServerGameProt.ts')
  ]);
  const ifSetObjectEncoder = new IfSetObjectEncoder();
  assert.equal(ifSetObjectEncoder.prot, ServerGameProt.IF_SETOBJECT);
  assert.equal(ifSetObjectEncoder.prot.id, 21, 'native IF_SETOBJECT uses client packet 21');
  assert.equal(ifSetObjectEncoder.prot.length, 6, 'native IF_SETOBJECT encodes a six-byte payload');

  // Shared logout reaches castlewars_logout before Barrows; match the native lifecycle fixture.
  VarSharedType.load(runtime.packDir);
  World.vars = new Int32Array(VarSharedType.count);
  World.currentTick = Math.max(1, World.currentTick);

  const runner = createRunner(runtime, { prefix: 'barrows_prayer', firstUid: 10900 });
  const { makePlayer, call, procVoid, procInt } = runner;
  const ids = Object.fromEntries(['barrows', 'barrows_kills', 'barrows_state', 'barrows_generation', 'barrows_countdowns']
    .map(name => {
      const id = packedId(contentRoot, 'varp', name);
      assert.equal(VarPlayerType.getId(name), id, `native varp identity for ${name}`);
      return [name, id];
    }));
  assert.deepEqual(Object.values(ids), [452, 453, 654, 659, 660], 'S06 uses the original saved Barrows varps');
  const prayerVarps = Array.from({ length: 15 }, (_, index) => {
    const name = `prayer${index}`;
    const id = VarPlayerType.getId(name);
    assert.notEqual(id, -1, `native prayer activation state ${name} is packed`);
    return id;
  });
  assert.equal(VarPlayerType.get(ids.barrows_countdowns).scope, VarPlayerType.SCOPE_PERM,
    'the shared 660 countdown is in the ordinary persistent player save');

  const timerScript = ScriptProvider.getByName('[timer,barrows_timer_tick]');
  assert(timerScript, 'compiled repeating [timer,barrows_timer_tick] exists');
  for (const name of [
    'barrows_timer_resume', 'barrows_timer_stop', 'barrows_slain_count', 'barrows_face_identity',
    'barrows_face_show', 'barrows_face_clear', 'barrows_resume', 'barrows_close_presentation',
    'barrows_generation_advance', 'barrows_search_latch', 'barrows_run_reset'
  ]) assert(ScriptProvider.getByName(`[proc,${name}]`), `compiled S06/lifecycle proc exists: ${name}`);

  const faces = BROTHERS.map(brother => {
    const name = `barrows_interface_${brother.name}`;
    const greenName = `${name}_green`;
    const objectId = packedId(contentRoot, 'obj', name);
    const slotId = packedId(contentRoot, 'interface', brother.slot);
    assert.equal(ObjType.getId(name), objectId, `${name} resolves in native ObjType`);
    const object = ObjType.get(objectId);
    assert(object, `original ${brother.name} face object is loaded`);
    assert(object.model > 0, `${brother.name} face object has a real original model`);
    assert.deepEqual(Array.from(object.recol_s ?? []), [], `${brother.name} normal object keeps its original palette`);
    assert.deepEqual(Array.from(object.recol_d ?? []), [], `${brother.name} normal object has no recolor destinations`);
    assert.equal(objectId, brother.originalId, `${name} is original object ${brother.originalId}`);

    assert.equal(Component.getId(brother.slot), slotId, `${brother.slot} resolves as its original packed child`);
    const slot = Component.get(slotId);
    assert(slot, `${brother.slot} is loaded from the original interface`);
    assert.equal(slot.comType, Component.TYPE_MODEL, `${brother.slot} remains an original model child`);
    assert.equal(slot.comType, 6, `${brother.slot} retains original client interface type 6`);
    assert([0, -1].includes(slot.model), `${brother.slot} remains blank in the original interface`);
    assert([0, -1].includes(slot.activeModel), `${brother.slot} has no active model in the original interface`);
    assert.equal(slot.anim, -1, `${brother.slot} has no default animation`);
    assert.equal(slot.activeAnim, -1, `${brother.slot} has no active animation`);
    return { ...brother, objectName: name, greenName, objectId, slotId };
  });

  const fadeId = packedId(contentRoot, 'seq', 'barrows_chathead_fade');
  assert.equal(fadeId, 2085, 'the original face fade remains sequence 2085');
  assert.equal(SeqType.getId('barrows_chathead_fade'), fadeId, 'the original fade sequence resolves in native SeqType');
  const fadeSequence = SeqType.get(fadeId);
  assert(fadeSequence.duration > 0, 'the native fade sequence has a measured duration');
  assert(fadeSequence.duration < COUNTDOWN_INTERVAL * CYCLES_PER_TICK,
    'the original fade completes before the next 17-tick Prayer drain');
  const fadeTicks = Math.ceil(fadeSequence.duration / CYCLES_PER_TICK);

  const constantsPath = path.join(contentRoot, 'scripts/minigames/game_barrows/configs/barrows.constant');
  const constantsText = fs.readFileSync(constantsPath, 'utf8');
  const constants = new Map([...constantsText.matchAll(/^\^([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/gm)]
    .map(([, name, value]) => [name, value.replace(/^"|"$/g, '')]));
  assert.equal(Number(constants.get('barrows_prayer_start')), 0);
  assert.equal(Number(constants.get('barrows_prayer_end')), 15);
  assert.equal(Number(constants.get('barrows_collapse_start')), 16);
  assert.equal(Number(constants.get('barrows_collapse_end')), 31);
  const faceDecisionLines = constantsText.split(/\r?\n/)
    .filter(line => /^\s*\^barrows_[A-Za-z0-9_]*(?:face|head)[A-Za-z0-9_]*\s*=/.test(line));
  const faceDecisionText = faceDecisionLines.join('\n');
  for (const face of faces) {
    assert(faceDecisionText.includes(face.objectName), `${face.objectName} palette choice is declared in barrows.constant`);
    assert(faceDecisionText.includes(face.slot), `${face.slot} slot choice is declared in barrows.constant`);
  }

  function setRun(player, {
    phase = 1, generation = 37, level = 3, x = 3552, z = 9696, slainMask = 0,
    highHalf = 0xa35d, remainder = 17, prayer = 100
  } = {}) {
    player.level = level;
    player.x = x;
    player.z = z;
    player.setVar(ids.barrows, 0x4e1b5a5a);
    player.setVar(ids.barrows_state, phaseWord(phase));
    player.setVar(ids.barrows_generation, generation);
    player.setVar(ids.barrows_kills, u32(0x6b3dffc0 | (slainMask & 0x3f)));
    player.setVar(ids.barrows_countdowns, countdownWord(highHalf, remainder));
    player.baseLevels[PRAYER] = 99;
    player.levels[PRAYER] = prayer;
  }

  function makeRun(label, state = {}) {
    const player = makePlayer(label);
    setRun(player, state);
    const write = player.write;
    player.write = message => {
      write(message);
      applyClientMessage(player, message);
    };
    return player;
  }

  const timer = player => player.timers.get(timerScript.id);
  const tick = player => {
    World.currentTick++;
    player.processTimers(PlayerTimerType.NORMAL);
  };
  const ticks = (player, count) => { for (let i = 0; i < count; i++) tick(player); };
  const countdown = player => u32(player.getVar(ids.barrows_countdowns));
  const prayerRemaining = player => low(countdown(player));
  const countdownHigh = player => high(countdown(player));
  const runSnapshot = player => ({
    client: u32(player.getVar(ids.barrows)),
    kills: u32(player.getVar(ids.barrows_kills)),
    state: u32(player.getVar(ids.barrows_state)),
    generation: u32(player.getVar(ids.barrows_generation)),
    countdowns: countdown(player),
    prayer: player.levels[PRAYER]
  });
  const queueHasTimer = player => ['queue', 'weakQueue', 'engineQueue'].some(name =>
    Array.from(player[name].all()).some(request => request.script === timerScript));
  const assertNoQueuedTimer = (player, label) => assert.equal(queueHasTimer(player), false, `${label} does not self-requeue the timer`);
  function decodeIfSetObject(message) {
    assert.equal(packetKind(message), 'IfSetObject', 'packet decoder receives a native IfSetObject message');
    const packet = new Packet(new Uint8Array(ifSetObjectEncoder.prot.length));
    ifSetObjectEncoder.encode(packet, message);
    assert.equal(packet.pos, ifSetObjectEncoder.prot.length, 'engine encoder writes the complete packet 21 payload');
    packet.pos = 0;
    const decoded = { scale: packet.g2(), obj: packet.g2_alt1(), component: packet.g2_alt3() };
    assert.equal(packet.available, 0, 'packet 21 decoder consumes the complete encoded payload');
    return decoded;
  }
  const decodeSetObjects = messages => messages.filter(message => packetKind(message) === 'IfSetObject')
    .map(decodeIfSetObject);
  const clientSlotStates = new WeakMap();
  const ensureClientSlots = player => {
    let slots = clientSlotStates.get(player);
    if (!slots) {
      slots = new Map(faces.map(face => {
        const component = Component.get(face.slotId);
        return [face.slotId, {
          component: face.slotId, interfaceType: component.comType, modelType: 0,
          obj: component.model, scale: null, hidden: false
        }];
      }));
      clientSlotStates.set(player, slots);
    }
    return slots;
  };
  function applyClientMessage(player, message) {
    const slots = ensureClientSlots(player);
    const kind = packetKind(message);
    if (kind === 'IfSetObject') {
      const decoded = decodeIfSetObject(message);
      const slot = slots.get(decoded.component);
      if (!slot) return;
      slot.obj = decoded.obj;
      slot.scale = decoded.scale;
      if (decoded.obj === 65535) {
        slot.modelType = 0;
      } else {
        assert(decoded.obj >= 0 && decoded.obj < 65535, 'non-null packet 21 object is a valid unsigned object id');
        assert(ObjType.get(decoded.obj), `client packet 21 object ${decoded.obj} is loaded`);
        slot.modelType = 4;
      }
    } else if (kind === 'IfSetHide') {
      const slot = slots.get(message.component);
      if (slot && slot.interfaceType !== Component.TYPE_MODEL) slot.hidden = message.hidden;
    }
  }
  const clientSlots = player => {
    const slots = ensureClientSlots(player);
    for (const message of player.packets) applyClientMessage(player, message);
    return slots;
  };
  const visibleObjects = player => [...clientSlots(player).values()]
    .filter(slot => slot.modelType === 4 && slot.obj !== 65535 && !slot.hidden)
    .map(({ component, obj, scale }) => ({ component, obj, scale }));
  const clearObjectPackets = player => decodeSetObjects(player.packets).filter(({ obj }) => obj === 65535);
  function assertAllFaceSlotsCleared(player, label) {
    assert.deepEqual(clearObjectPackets(player).map(({ component, obj, scale }) => [component, obj, scale]),
      faces.map(face => [face.slotId, 65535, 1]),
      `${label} sends native packet 21 object 65535 at each exact face component`);
    const slots = clientSlots(player);
    for (const face of faces) {
      assert.equal(slots.get(face.slotId).modelType, 0, `${label} sets ${face.slot} client model type to none`);
      assert.equal(slots.get(face.slotId).obj, 65535, `${label} retains the null object in ${face.slot}`);
    }
    assert.deepEqual(visibleObjects(player), [], `${label} leaves no face visible in any of the six client slots`);
  }
  function assertHideDoesNotClearModelComponent() {
    const player = makeRun('hide_is_not_clear');
    const face = faces[0];
    player.packets.push(new IfSetObject(face.slotId, face.objectId, 1), new IfSetHide(face.slotId, true));
    const slot = clientSlots(player).get(face.slotId);
    assert.equal(slot.interfaceType, 6, 'original face component is a type-6 model interface');
    assert.equal(slot.modelType, 4, 'hide does not change the client model type of a set object');
    assert.equal(slot.hidden, false, 'IF_SETHIDE is not honored for a type-6 model component');
    assert.deepEqual(visibleObjects(player).map(({ component, obj }) => [component, obj]),
      [[face.slotId, face.objectId]], 'client still renders the face after a hide-only message');
  }
  const fadePackets = player => player.packets.filter(message =>
    packetKind(message) === 'IfSetAnim' && message.seq === fadeId);
  function withRandom(value, action) {
    const original = JavaRandom.nextDouble;
    let calls = 0;
    JavaRandom.nextDouble = () => { calls++; return value; };
    try { return { value: action(), calls }; } finally { JavaRandom.nextDouble = original; }
  }
  function displayOneFace(player, mask, selectedRank) {
    const candidates = faces.filter((_, index) => mask & (1 << index));
    assert(candidates.length > 0, 'face display control has at least one slain brother');
    player.packets.length = 0;
    const draw = (selectedRank + 0.25) / candidates.length;
    const measured = withRandom(draw, () => procVoid(player, 'barrows_face_show'));
    assert.equal(measured.calls, 1, 'every nonempty slain mask consumes exactly one uniform face draw');
    const identity = candidates[selectedRank];
    const expectedObject = player.level === 0 ? identity.greenId : identity.objectId;
    assert.deepEqual(visibleObjects(player).map(({ component, obj }) => [component, obj]),
      [[identity.slotId, expectedObject]],
      `exactly one ${player.level === 0 ? 'green tunnel' : 'normal crypt'} object is set in its corresponding original slot`);
    assert.equal(clientSlots(player).get(identity.slotId).modelType, 4,
      'a valid encoded packet 21 object sets the client model type to 4');
    assert.deepEqual(fadePackets(player).map(message => [message.component, message.seq]),
      [[identity.slotId, fadeId]], 'the selected original slot receives barrows_chathead_fade(2085)');
    return identity;
  }

  function testPrayerZeroShutdown() {
    const assertActivePrayers = player => prayerVarps
      .map((id, index) => player.getVar(id) ? index : -1)
      .filter(index => index >= 0);
    const activatePrayer = (player, name, index) => {
      call(player, `[if_button,prayer:prayer_${name}]`);
      assert.equal(player.getVar(prayerVarps[index]), 1, `packed prayer button activates prayer${index}`);
    };
    const positive = makeRun('prayer_zero_positive', { slainMask: 0, remainder: 1, prayer: 20 });
    procVoid(positive, 'barrows_timer_resume');
    activatePrayer(positive, 'thickskin', 0);
    const positiveDrain = withRandom(0.5, () => tick(positive));
    assert.equal(positive.levels[PRAYER], 12, 'positive control drains Prayer but leaves points above zero');
    assert.deepEqual(assertActivePrayers(positive), [0], 'nonzero Prayer drain leaves the packed prayer active');
    assert.equal(positiveDrain.calls, 0, 'B=0 positive control needs no face draw');

    const zero = makeRun('prayer_zero_shutdown', { slainMask: 0, remainder: 1, prayer: 3 });
    procVoid(zero, 'barrows_timer_resume');
    activatePrayer(zero, 'thickskin', 0);
    activatePrayer(zero, 'rapidrestore', 6);
    assert.deepEqual(assertActivePrayers(zero), [0, 6], 'packed buttons activate multiple compatible prayers');
    const zeroDrain = withRandom(0.5, () => tick(zero));
    assert.equal(zero.levels[PRAYER], 0, 'due Barrows callback clamps Prayer to zero');
    assert.equal(zeroDrain.calls, 0, 'B=0 zero-shutdown case needs no face draw');
    assert.deepEqual(assertActivePrayers(zero), [],
      'Prayer-zero shutdown: the due Barrows callback deactivates every active prayer before returning');
  }

  if (regression === 'prayer-zero') {
    // This path precedes R4/R6 checks so the old pack fails only the named zero-shutdown behavior.
    testPrayerZeroShutdown();
    console.log('OK targeted Barrows Prayer-zero shutdown regression');
    return;
  }

  if (regression === 'face-clear') {
    assertHideDoesNotClearModelComponent();
    const player = makeRun('face_clear_packet21', { slainMask: 0b111111 });
    for (const face of faces) player.packets.push(new IfSetObject(face.slotId, face.objectId, 1));
    assert.deepEqual(visibleObjects(player).map(({ component, obj }) => [component, obj]),
      faces.map(face => [face.slotId, face.objectId]), 'fixture places a normal face in all six client slots');
    procVoid(player, 'barrows_face_clear');
    assertAllFaceSlotsCleared(player, 'barrows_face_clear');
    console.log('OK targeted Barrows face-clear packet 21 regression');
    return;
  }

  assertHideDoesNotClearModelComponent();

  // CANDIDATE: the operator's Old School description and paired source-cache objects select normal crypt faces and green tunnel faces.
  for (const face of faces) {
    face.greenId = packedId(contentRoot, 'obj', face.greenName);
    assert.equal(ObjType.getId(face.greenName), face.greenId, `${face.greenName} resolves in native ObjType`);
    const normal = ObjType.get(face.objectId);
    const green = ObjType.get(face.greenId);
    assert(green, `original ${face.name} green face object is loaded`);
    assert.equal(face.greenId, face.originalId + 1, `${face.greenName} is the adjacent cached palette object`);
    assert.equal(normal.model, green.model, `${face.name} normal and green objects retain their shared original model`);
    assert.deepEqual(Array.from(green.recol_s ?? []),
      [16487, 18601, 27255].map(colour => ColorConversion.rgb15toHsl16(colour)),
      `${face.name} green object retains its original recolor sources`);
    assert.deepEqual(Array.from(green.recol_d ?? []),
      [4423, 6537, 20308].map(colour => ColorConversion.rgb15toHsl16(colour)),
      `${face.name} green object retains its original recolor destinations`);
    assert(faceDecisionText.includes(face.greenName),
      `${face.greenName} is declared for candidate crypt/tunnel face selection in barrows.constant`);
  }

  // The packed pure rank selector visits the complete six-bit space, including invalid ranks.
  const rankPlayer = makeRun('all_masks');
  for (let mask = 0; mask < 64; mask++) {
    rankPlayer.setVar(ids.barrows_kills, u32(0x6b3dffc0 | mask));
    rankPlayer.packets.length = 0;
    const before = runSnapshot(rankPlayer);
    const expected = faces.filter((_, index) => mask & (1 << index)).map((face, index) => face);
    const count = procInt(rankPlayer, 'barrows_slain_count');
    assert.equal(count, popcount(mask), `slain count for mask ${mask.toString(2).padStart(6, '0')}`);
    for (let rank = -1; rank <= 7; rank++) {
      const measured = runner.measureRandom(() => procInt(rankPlayer, 'barrows_face_identity', [rank]));
      const identity = rank >= 1 && rank <= expected.length ? faces.indexOf(expected[rank - 1]) + 1 : 0;
      assert.equal(measured.value, identity, `mask ${mask.toString(2).padStart(6, '0')} rank ${rank} returns the nth slain identity or zero`);
      assert.equal(measured.calls, 0, 'pure face identity selection consumes no random state');
    }
    assert.deepEqual(runSnapshot(rankPlayer), before, `count/rank lookup for mask ${mask} is pure`);
    assert.equal(rankPlayer.packets.length, 0, 'pure rank selection emits no face packets');
  }

  // R5: the Barrows zero-point callback shuts down real active prayers before it returns.
  testPrayerZeroShutdown();

  // B=0 draws nothing in either location; every nonempty mask/rank gets one exact draw
  // in crypts (normal palette) and tunnels (green palette).
  const faceZeroPlayer = makeRun('face_zero');
  for (const level of [3, 0]) {
    faceZeroPlayer.level = level;
    faceZeroPlayer.packets.length = 0;
    const measured = withRandom(0.5, () => procVoid(faceZeroPlayer, 'barrows_face_show'));
    assert.equal(measured.calls, 0, `B=0 at level ${level} needs no random face draw`);
    assert.deepEqual(visibleObjects(faceZeroPlayer), [], `B=0 at level ${level} displays no face`);
    assert.deepEqual(fadePackets(faceZeroPlayer), [], `B=0 at level ${level} starts no face animation`);
  }
  const facePlayer = makeRun('face_selection');
  for (let mask = 1; mask < 64; mask++) {
    const candidates = faces.filter((_, index) => mask & (1 << index));
    facePlayer.setVar(ids.barrows_kills, u32(0x6b3dffc0 | mask));
    for (const level of [3, 0]) {
      facePlayer.level = level;
      for (let rank = 0; rank < candidates.length; rank++) {
        displayOneFace(facePlayer, mask, rank);
      }
    }
  }

  // Seed all six original slots with actual packet-21 objects, then clear every client slot.
  const allSixSlots = makeRun('all_six_slots', { slainMask: 0b111111 });
  for (const face of faces) allSixSlots.packets.push(new IfSetObject(face.slotId, face.objectId, 1));
  assert.deepEqual(visibleObjects(allSixSlots).map(({ component, obj }) => [component, obj]),
    faces.map(face => [face.slotId, face.objectId]), 'all six original components hold client model type 4 faces');
  procVoid(allSixSlots, 'barrows_face_clear');
  assertAllFaceSlotsCleared(allSixSlots, 'six-slot clear');

  // Natural compiled draws clear the prior slot before setting the next; repeated selections never pile up.
  const repeated = makeRun('natural_face_repeat', { slainMask: 0b111111 });
  const firstDraw = runner.measureRandom(() => procVoid(repeated, 'barrows_face_show'));
  assert.equal(firstDraw.calls, 1, 'first natural packed face selection consumes exactly one random draw');
  const firstFace = visibleObjects(repeated)[0];
  assert(firstFace, 'first natural packed face selection renders one face');
  const secondStart = repeated.packets.length;
  const secondDraw = runner.measureRandom(() => procVoid(repeated, 'barrows_face_show'));
  assert.equal(secondDraw.calls, 1, 'later natural packed face selection consumes exactly one random draw');
  const secondPackets = decodeSetObjects(repeated.packets.slice(secondStart));
  const lastClearIndex = secondPackets.reduce((last, packet, index) => packet.obj === 65535 ? index : last, -1);
  const nextShowIndex = secondPackets.findIndex(packet => packet.obj !== 65535);
  assert(secondPackets.some(packet => packet.component === firstFace.component && packet.obj === 65535),
    'next natural selection clears the previously shown component');
  assert(lastClearIndex >= 0 && lastClearIndex < nextShowIndex,
    'all native null-object clears precede the next face set');
  assert.equal(visibleObjects(repeated).length, 1, 'repeated natural selections do not pile faces into multiple slots');

  // Direct clear and timer resume erase every slot; resume never replays a face or fade.
  const presentation = makeRun('presentation', { slainMask: 0b100101, remainder: 8 });
  displayOneFace(presentation, 0b100101, 1);
  presentation.packets.length = 0;
  procVoid(presentation, 'barrows_face_clear');
  assertAllFaceSlotsCleared(presentation, 'barrows_face_clear');
  assert.deepEqual(fadePackets(presentation), [], 'barrows_face_clear stops the face fade');
  displayOneFace(presentation, 0b100101, 0);
  presentation.packets.length = 0;
  procVoid(presentation, 'barrows_timer_resume');
  assert(timer(presentation), 'eligible resume arms the native Barrows timer');
  assertAllFaceSlotsCleared(presentation, 'timer resume');
  assert.deepEqual(fadePackets(presentation), [], 'resume never replays an old fade');
  // Prayer setter and every ordinary countdown tick preserve the unrelated 660 high half.
  const setter = makeRun('prayer_set');
  for (const [input, expected] of [[-1, 0], [0, 0], [1, 1], [17, 17], [65535, 65535], [65536, 65535]]) {
    const retainedHigh = 0xdda7;
    setter.setVar(ids.barrows_countdowns, countdownWord(retainedHigh, 0x1234));
    procVoid(setter, 'barrows_prayer_set', [input]);
    assert.equal(countdownHigh(setter), retainedHigh, `Prayer low write ${input} preserves 660 collapse half`);
    assert.equal(prayerRemaining(setter), expected, `Prayer setter clamps ${input} to ${expected}`);
  }

  // Resume initializes zero only, preserves positive remainder, and does not reset an existing native timer.
  const resumeZero = makeRun('resume_zero', { remainder: 0, highHalf: 0xc31e });
  procVoid(resumeZero, 'barrows_timer_resume');
  const firstTimer = timer(resumeZero);
  assert(firstTimer, 'eligible zero-remainder resume arms a real timer');
  assert.equal(firstTimer.type, PlayerTimerType.NORMAL, 'Prayer uses the native protected normal timer lane');
  assert.equal(firstTimer.interval, 1, 'Prayer timer repeats once per native tick');
  assert.deepEqual(firstTimer.args, [37], 'the repeating callback captures the positive run generation');
  assert.equal(prayerRemaining(resumeZero), COUNTDOWN_INTERVAL, 'unarmed Prayer remainder initializes to 17');
  assert.equal(countdownHigh(resumeZero), 0xc31e, 'initialization preserves the high half of 660');
  const initialClock = firstTimer.clock;
  World.currentTick += 4;
  procVoid(resumeZero, 'barrows_timer_resume');
  assert.equal(timer(resumeZero), firstTimer, 'repeated resume leaves the same native timer installed');
  assert.equal(firstTimer.clock, initialClock, 'repeated resume does not postpone the native next tick');
  assert.equal(prayerRemaining(resumeZero), COUNTDOWN_INTERVAL, 'repeated resume does not treat gettimer clock as saved remainder');
  assertNoQueuedTimer(resumeZero, 'repeated resume');

  const resumePositive = makeRun('resume_positive', { remainder: 6, highHalf: 0xb61d });
  procVoid(resumePositive, 'barrows_timer_resume');
  assert.equal(prayerRemaining(resumePositive), 6, 'resume preserves any positive saved Prayer remainder');
  assert.equal(countdownHigh(resumePositive), 0xb61d, 'positive-remainder resume preserves collapse remainder');
  assert.equal(timer(resumePositive).interval, 1, 'positive-remainder resume still uses one native tick');

  // A real native repeat stalls behind Player access, then executes once and cannot double-fire in one tick.
  const stalled = makeRun('normal_timer_stall', { remainder: 10, highHalf: 0x9d37, slainMask: 1 });
  procVoid(stalled, 'barrows_timer_resume');
  const stalledTimer = timer(stalled);
  const beforeStall = runSnapshot(stalled);
  stalled.delayed = true;
  ticks(stalled, 4);
  assert.deepEqual(runSnapshot(stalled), beforeStall, 'busy normal timer does not consume or duplicate a Prayer tick');
  assert.equal(timer(stalled), stalledTimer, 'busy access retains the native repeating timer');
  stalled.delayed = false;
  const beforeUnblockTick = World.currentTick;
  stalled.processTimers(PlayerTimerType.NORMAL);
  assert.equal(World.currentTick, beforeUnblockTick, 'unblocking does not invent a world tick');
  assert.equal(prayerRemaining(stalled), 9, 'one overdue native callback consumes exactly one saved tick');
  assert.equal(stalledTimer.clock, World.currentTick, 'native timer clock advances to the actual callback tick');
  assert.equal(stalled.protect, false, 'normal timer callback releases protected access');
  assertNoQueuedTimer(stalled, 'unblocked timer');
  stalled.processTimers(PlayerTimerType.NORMAL);
  assert.equal(prayerRemaining(stalled), 9, 'a second processTimers call in the same tick cannot double-fire');
  tick(stalled);
  assert.equal(prayerRemaining(stalled), 8, 'the next native repeat fires exactly once on the next tick');
  assert.equal(timer(stalled), stalledTimer, 'ordinary repeats retain the same native timer entry');
  assertNoQueuedTimer(stalled, 'ordinary repeat');

  // Every active phase/location combination has an actual native positive callback control.
  for (const phase of [1, 2]) for (const level of [0, 3]) {
    const control = makeRun(`positive_${phase}_${level}`, { phase, level, remainder: 2, highHalf: 0x82c4 });
    procVoid(control, 'barrows_timer_resume');
    tick(control);
    assert.equal(prayerRemaining(control), 1, `phase ${phase}, level ${level} in map55_151 consumes one native tick`);
    assert(timer(control), `phase ${phase}, level ${level} positive control keeps its timer`);
    assert.equal(countdownHigh(control), 0x82c4, `phase ${phase}, level ${level} positive control retains high half`);
  }

  // Each guard is tested against the same eligible native positive control, then an otherwise identical blocked state.
  const guardCases = [
    ['idle phase', player => player.setVar(ids.barrows_state, phaseWord(0))],
    ['invalid phase', player => player.setVar(ids.barrows_state, phaseWord(3))],
    ['level 1', player => { player.level = 1; }],
    ['level 2', player => { player.level = 2; }],
    ['outside from crypt', player => { player.level = 3; player.x = 3488; }],
    ['outside from tunnel', player => { player.level = 0; player.z = 9632; }],
    ['zero current generation', player => player.setVar(ids.barrows_generation, 0)],
    ['stale captured generation', player => player.setVar(ids.barrows_generation, 38)]
  ];
  for (const [label, invalidate] of guardCases) {
    const control = makeRun(`guard_control_${label.replaceAll(' ', '_')}`, { remainder: 2, highHalf: 0xa9b2, slainMask: 1 });
    procVoid(control, 'barrows_timer_resume');
    tick(control);
    assert.equal(prayerRemaining(control), 1, `${label} has a valid eligible positive control`);
    assert(timer(control), `${label} positive control retains its repeating timer`);

    const blocked = makeRun(`guard_blocked_${label.replaceAll(' ', '_')}`, { remainder: 2, highHalf: 0xa9b2, slainMask: 1 });
    procVoid(blocked, 'barrows_timer_resume');
    assert(timer(blocked), `${label} blocked case starts from a real captured generation timer`);
    invalidate(blocked);
    const before = runSnapshot(blocked);
    blocked.packets.length = 0;
    tick(blocked);
    assert.deepEqual(runSnapshot(blocked), before, `${label} callback stops before consuming state or Prayer`);
    assert.equal(timer(blocked), undefined, `${label} callback stops and clears the native timer`);
    assert.deepEqual(visibleObjects(blocked), [], `${label} callback has no face effect`);
    assertNoQueuedTimer(blocked, label);
  }

  // B=0..6 drains exactly 8+B at remainder one; both ordinary and clamped Prayer values are checked.
  const masksByCount = [0, 0b000001, 0b000011, 0b000111, 0b001111, 0b011111, 0b111111];
  for (let slain = 0; slain <= 6; slain++) {
    const mask = masksByCount[slain];
    const drain = 8 + slain;
    const healthy = makeRun(`drain_${slain}`, { slainMask: mask, remainder: 1, highHalf: 0xc17e, prayer: 100 });
    procVoid(healthy, 'barrows_timer_resume');
    const healthyDraw = withRandom(0.61, () => tick(healthy));
    assert.equal(healthy.levels[PRAYER], 100 - drain, `B=${slain} drains exactly 8+B Prayer points`);
    assert.equal(prayerRemaining(healthy), COUNTDOWN_INTERVAL, `B=${slain} reloads 17 in the due callback`);
    assert.equal(countdownHigh(healthy), 0xc17e, `B=${slain} due low write preserves high-half 660`);
    assert.equal(healthyDraw.calls, slain === 0 ? 0 : 1,
      `B=${slain} consumes exactly one face draw when nonempty and none at B=0`);
    if (slain === 0) {
      assert.deepEqual(visibleObjects(healthy), [], 'B=0 displays no non-null face');
      assert.equal(healthyDraw.calls, 0, 'B=0 needs no random face draw');
      assert.deepEqual(fadePackets(healthy), [], 'B=0 plays no fade');
    } else {
      const candidates = faces.filter((_, index) => mask & (1 << index));
      const choice = Math.min(candidates.length - 1, Math.floor(0.61 * candidates.length));
      const chosen = candidates[choice];
      assert.deepEqual(visibleObjects(healthy).map(message => [message.component, message.obj]),
        [[chosen.slotId, chosen.objectId]], `B=${slain} chooses exactly one slain original crypt object in its slot`);
      assert.deepEqual(fadePackets(healthy).map(message => [message.component, message.seq]),
        [[chosen.slotId, fadeId]], `B=${slain} starts the original fade in the chosen slot`);
    }

    const clamped = makeRun(`clamp_${slain}`, { slainMask: mask, remainder: 1, highHalf: 0xe47b, prayer: 3, level: 0 });
    clamped.lowMemory = true;
    procVoid(clamped, 'barrows_timer_resume');
    const clampedDraw = withRandom(0.5, () => tick(clamped));
    assert.equal(clamped.levels[PRAYER], 0, `B=${slain} clamps a short Prayer level at zero`);
    assert.equal(prayerRemaining(clamped), COUNTDOWN_INTERVAL, `B=${slain} clamp callback reloads the full remainder`);
    assert.equal(countdownHigh(clamped), 0xe47b, `B=${slain} clamped low write preserves high-half 660`);
    assert.equal(clampedDraw.calls, 0, `B=${slain} low-memory callback does not choose a face`);
    assert.deepEqual(visibleObjects(clamped), [], `B=${slain} low-memory callback sets no non-null face`);
    assert.deepEqual(fadePackets(clamped), [], `B=${slain} low-memory callback starts no fade`);
  }

  // Low-memory suppression has a paired HD positive control, both using the native repeating callback.
  const hd = makeRun('hd_face_control', { slainMask: 0b000101, remainder: 1, highHalf: 0x9876 });
  procVoid(hd, 'barrows_timer_resume');
  const hdDraw = withRandom(0.25, () => tick(hd));
  assert.equal(hdDraw.calls, 1, 'HD positive control chooses one face on its due drain');
  assert.equal(visibleObjects(hd).length, 1, 'HD positive control displays one slain face');
  assert.equal(fadePackets(hd).length, 1, 'HD positive control animates its selected face');
  const laterHdDraw = withRandom(0.25, () => ticks(hd, COUNTDOWN_INTERVAL));
  assert.equal(laterHdDraw.calls, 1, 'every later nonempty due drain still makes one uniform face draw');
  assert.equal(visibleObjects(hd).length, 1, 'later natural due drain replaces rather than piles up the prior face');
  const ld = makeRun('ld_face_absence', { slainMask: 0b000101, remainder: 1, highHalf: 0x9876 });
  ld.lowMemory = true;
  procVoid(ld, 'barrows_timer_resume');
  const ldDraw = withRandom(0.25, () => tick(ld));
  assert.equal(ld.levels[PRAYER], 90, 'LD still drains 8+B Prayer with B=2');
  assert.equal(prayerRemaining(ld), COUNTDOWN_INTERVAL, 'LD reloads saved Prayer remainder');
  assert.equal(ldDraw.calls, 0, 'LD never performs a face-selection draw');
  assert.deepEqual(visibleObjects(ld), [], 'LD Prayer drain has no non-null face object');
  assert.deepEqual(fadePackets(ld), [], 'LD Prayer drain has no face animation');

  // Fade cleanup is measured from the updated saved remainder and the original native sequence duration.
  const fading = makeRun('fade_cleanup', { slainMask: 1, remainder: 1, highHalf: 0xd41a });
  procVoid(fading, 'barrows_timer_resume');
  withRandom(0.25, () => tick(fading));
  assert.equal(visibleObjects(fading).length, 1, 'fade cleanup positive control first displays the original face');
  assert.equal(prayerRemaining(fading), COUNTDOWN_INTERVAL, 'the due invocation reloads before elapsed-fade accounting');
  const beforeFadeVars = Array.from(fading.vars);
  for (let elapsed = 1; elapsed <= fadeTicks; elapsed++) {
    fading.packets.length = 0;
    tick(fading);
    assert.equal(prayerRemaining(fading), COUNTDOWN_INTERVAL - elapsed, `fade elapsed ${elapsed} is derived from updated 660 low half`);
    assert.equal(countdownHigh(fading), 0xd41a, `fade elapsed ${elapsed} preserves collapse high half`);
    const changedVars = Array.from(fading.vars, (value, id) => value !== beforeFadeVars[id] ? id : -1).filter(id => id >= 0);
    assert.deepEqual(changedVars, [ids.barrows_countdowns], 'fade cleanup stores no additional saved face cursor');
    if (elapsed < fadeTicks) {
      assert.equal(clearObjectPackets(fading).length, 0,
        `original face receives no null object before its native sequence duration (${elapsed}/${fadeTicks})`);
      assert.equal(clientSlots(fading).get(faces[0].slotId).modelType, 4,
        `original client object remains model type 4 until sequence duration (${elapsed}/${fadeTicks})`);
    }
  }
  assertAllFaceSlotsCleared(fading, `native timer after ${fadeSequence.duration} cycles`);

  // Run reset and generation advance stop the old timer; Search resumes only the new captured generation.
  const generationAdvance = makeRun('generation_advance', { remainder: 7, highHalf: 0x82ab });
  procVoid(generationAdvance, 'barrows_timer_resume');
  const oldGeneration = generationAdvance.getVar(ids.barrows_generation);
  procVoid(generationAdvance, 'barrows_generation_advance');
  assert.equal(generationAdvance.getVar(ids.barrows_generation), oldGeneration + 1, 'generation advance retains native run behavior');
  assert.equal(timer(generationAdvance), undefined, 'generation advance stops the old Prayer timer');
  assert.equal(prayerRemaining(generationAdvance), 7, 'generation advance alone retains the saved remainder');
  assert.equal(countdownHigh(generationAdvance), 0x82ab, 'generation advance retains both countdown halves');

  const search = makeRun('search_resume', { level: 0, remainder: 9, highHalf: 0xb3c7 });
  procVoid(search, 'barrows_timer_resume');
  const searchGeneration = search.getVar(ids.barrows_generation);
  assert.equal(procInt(search, 'barrows_search_latch', [searchGeneration]), 1, 'eligible Search latch succeeds');
  assert.equal((u32(search.getVar(ids.barrows_state)) >>> 3) & 3, 2, 'Search commits the paid phase');
  assert.equal(search.getVar(ids.barrows_generation), searchGeneration + 1, 'Search advances the run generation');
  assert(timer(search), 'Search re-arms the Barrows timer for the new generation');
  assert.deepEqual(timer(search).args, [searchGeneration + 1], 'Search timer captures the current post-latch generation');
  assert.equal(timer(search).interval, 1, 'Search uses one native repeat, not self-requeue');
  assert.equal(prayerRemaining(search), 9, 'Search and generation advance preserve Prayer remainder');
  assert.equal(countdownHigh(search), 0xb3c7, 'Search preserves the unrelated collapse half');
  assertNoQueuedTimer(search, 'Search latch');

  const reset = makeRun('paid_reset', { phase: 2, remainder: 11, highHalf: 0xf18d });
  procVoid(reset, 'barrows_timer_resume');
  procVoid(reset, 'barrows_run_reset');
  assert.equal(timer(reset), undefined, 'paid reset clears the native Prayer timer');
  assert.equal(countdown(reset), 0, 'paid reset clears both halves of shared countdown 660');
  assert.equal((u32(reset.getVar(ids.barrows_state)) >>> 3) & 3, 0, 'paid reset returns to idle phase');

  // Logout uses the shared world lifecycle and keeps the exact saved countdown without a runtime timer.
  function lifecycle(player, name) {
    const type = name === 'login' ? ServerTriggerType.LOGIN : ServerTriggerType.LOGOUT;
    const triggerName = `[${name},_]`;
    const script = ScriptProvider.getByTriggerSpecific(type, -1, -1);
    assert(script, `native shared ${triggerName} trigger is present`);
    assert.equal(script, ScriptProvider.getByName(triggerName), `${triggerName} resolves through native lifecycle lookup`);
    const state = ScriptRunner.init(script, player);
    const result = player.runScript(state, true);
    assert.equal(result, ScriptState.FINISHED, `${triggerName} finishes synchronously`);
    assert.equal(state.execution, ScriptState.FINISHED, `${triggerName} completes the packed lifecycle script`);
    assert.equal(player.delayed, false, `${triggerName} does not leave a delayed script`);
    assert.equal(player.activeScript, null, `${triggerName} does not leave a suspended script`);
    assert.equal(player.protect, false, `${triggerName} releases protected access`);
  }
  const logout = makeRun('shared_logout', { remainder: 13, highHalf: 0x769b });
  procVoid(logout, 'barrows_timer_resume');
  const logoutSaved = countdown(logout);
  lifecycle(logout, 'logout');
  assert.equal(timer(logout), undefined, 'shared logout stops and clears the native Prayer timer');
  assert.equal(countdown(logout), logoutSaved, 'shared logout keeps the exact saved countdown halves');

  // A native respawn outside Barrows is an ineligible next callback, with the same positive control above.
  const deathRespawn = makeRun('death_respawn_guard', { remainder: 2, highHalf: 0xe02c, slainMask: 1 });
  procVoid(deathRespawn, 'barrows_timer_resume');
  deathRespawn.level = 0;
  deathRespawn.x = 3221;
  deathRespawn.z = 3218;
  const deathState = runSnapshot(deathRespawn);
  deathRespawn.packets.length = 0;
  tick(deathRespawn);
  assert.deepEqual(runSnapshot(deathRespawn), deathState, 'post-death respawn callback has no Prayer or saved-state effect');
  assert.equal(timer(deathRespawn), undefined, 'post-death respawn clears the Barrows timer');
  assert.deepEqual(visibleObjects(deathRespawn), [], 'post-death respawn produces no face');
  assertNoQueuedTimer(deathRespawn, 'post-death respawn');

  // Real Player.save/PlayerLoading.load across clean transient timer state: offline time changes nothing.
  function attachFixtureIO(player, uid) {
    player.uid = uid;
    player.pid = uid;
    player.messages = [];
    player.packets = [];
    player.lastMovement = 0;
    player.write = message => player.packets.push(message);
    player.messageGame = message => player.messages.push(message);
    player.wrappedMessageGame = message => player.messages.push(message);
    return player;
  }
  const savedSource = makeRun('saved_remainder', { remainder: 9, highHalf: 0x83f1, slainMask: 0b101001 });
  procVoid(savedSource, 'barrows_timer_resume');
  ticks(savedSource, 4);
  assert.equal(prayerRemaining(savedSource), 5, 'native repeats save the current partially elapsed remainder');
  assert.equal(countdownHigh(savedSource), 0x83f1, 'pre-save ticks preserve high-half state');
  const saveBytes = Uint8Array.from(savedSource.save());
  savedSource.cleanup();
  assert.equal(savedSource.timers.size, 0, 'native Player.cleanup clears all transient timers');
  World.currentTick += 50000;
  const loaded = attachFixtureIO(PlayerLoading.load('barrows_prayer_saved', new Packet(saveBytes), null), 11901);
  assert.equal(loaded.timers.size, 0, 'ordinary player load starts with clean transient timer state');
  assert.equal(prayerRemaining(loaded), 5, 'serialized save/load preserves the exact Prayer remainder');
  assert.equal(countdownHigh(loaded), 0x83f1, 'serialized save/load preserves the exact collapse remainder');
  lifecycle(loaded, 'login');
  assert.equal(prayerRemaining(loaded), 5, 'login does not refresh a positive saved remainder');
  assert.equal(countdownHigh(loaded), 0x83f1, 'login resume preserves the high half');
  assert(timer(loaded), 'shared login re-arms the native timer');
  assert.deepEqual(timer(loaded).args, [loaded.getVar(ids.barrows_generation)], 'login captures the restored current generation');
  assert.equal(timer(loaded).interval, 1, 'login re-arms one native tick, never the saved remainder');
  assert.deepEqual(visibleObjects(loaded), [], 'login never replays a transient face from the save');
  assert.deepEqual(fadePackets(loaded), [], 'login never replays the transient face animation');
  assertNoQueuedTimer(loaded, 'clean login');
  const loadedBeforeTick = runSnapshot(loaded);
  tick(loaded);
  assert.equal(prayerRemaining(loaded), 4, 'only the next real native callback consumes one post-login tick');
  assert.equal(countdownHigh(loaded), 0x83f1, 'post-login native tick preserves saved collapse remainder');
  assert.equal(u32(loaded.getVar(ids.barrows_state)), loadedBeforeTick.state, 'post-login tick retains serialized run state');

  // A shown face is transient even when its exact saved countdown is serialized and resumed.
  const savedFaceSource = makeRun('saved_face', { remainder: 1, highHalf: 0xc8a4, slainMask: 1 });
  procVoid(savedFaceSource, 'barrows_timer_resume');
  withRandom(0.25, () => tick(savedFaceSource));
  assert.equal(visibleObjects(savedFaceSource).length, 1, 'save-replay positive control first shows a real face');
  const faceSave = Uint8Array.from(savedFaceSource.save());
  savedFaceSource.cleanup();
  const faceLoaded = attachFixtureIO(PlayerLoading.load('barrows_prayer_face_saved', new Packet(faceSave), null), 11902);
  World.currentTick += 50000;
  lifecycle(faceLoaded, 'login');
  assert.equal(prayerRemaining(faceLoaded), COUNTDOWN_INTERVAL, 'save/load retains the exact due-tick reload');
  assert.equal(countdownHigh(faceLoaded), 0xc8a4, 'save/load retains high-half countdown beside transient face');
  assert.deepEqual(visibleObjects(faceLoaded), [], 'process-like load never replays the old face object');
  assert.deepEqual(fadePackets(faceLoaded), [], 'process-like load never replays the old face sequence');
  assert(timer(faceLoaded), 'process-like login arms a fresh runtime timer from saved counters');

  // Resume/stop/close are safe on repeated calls and leave durable counters alone.
  const stop = makeRun('timer_stop', { slainMask: 1, remainder: 4, highHalf: 0xa812 });
  procVoid(stop, 'barrows_timer_resume');
  displayOneFace(stop, 1, 0);
  const beforeStop = countdown(stop);
  stop.packets.length = 0;
  procVoid(stop, 'barrows_timer_stop');
  assertAllFaceSlotsCleared(stop, 'timer stop');
  procVoid(stop, 'barrows_timer_stop');
  assert.equal(timer(stop), undefined, 'explicit stop is idempotent and clears the timer');
  assert.equal(countdown(stop), beforeStop, 'explicit stop does not consume or erase either saved half');
  procVoid(stop, 'barrows_timer_resume');
  displayOneFace(stop, 1, 0);
  stop.packets.length = 0;
  procVoid(stop, 'barrows_close_presentation');
  assertAllFaceSlotsCleared(stop, 'closing presentation');
  assert.equal(timer(stop), undefined, 'closing presentation stops the native Prayer timer');
  assert.equal(countdown(stop), beforeStop, 'closing presentation preserves exact saved countdown state');

  console.log('OK compiled S06 Prayer/faces: 64 masks, pure ranks, native one-tick persistence, Prayer arithmetic, original face slots and lifecycle cleanup');
});