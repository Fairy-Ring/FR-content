#!/usr/bin/env node
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createRunner, loadPackedRuntime, packedId, parseEnum, parseOptions, run } from './packed.mjs';

const options = parseOptions(process.argv);

async function main() {
  const runtime = await loadPackedRuntime(options);
  const { contentRoot, World, ScriptProvider, ScriptRunner, ScriptState, VarPlayerType, LocType, NpcType, EnumType, CoordGrid, Component, allocateIfAbsent } = runtime;
  const runner = createRunner(runtime, { prefix: 'barrows_entry' });
  const { makePlayer, call, procVoid, procInt, addNpc, removeFixtures, measureRandom } = runner;
  const varp = name => {
    const id = packedId(contentRoot, 'varp', name);
    assert.equal(VarPlayerType.getId(name), id, `runtime varp identity ${name}`);
    return id;
  };
  const ids = {
    client: varp('barrows'), credit: varp('barrows_kills'), state: varp('barrows_state'),
    generation: varp('barrows_generation'), countdowns: varp('barrows_countdowns')
  };
  const phase = word => (word >>> 3) & 3;
  const set = (player, values) => {
    for (const [key, value] of Object.entries(values)) player.setVar(ids[key], value);
  };
  const snapshot = player => Object.fromEntries(['client', 'credit', 'state', 'generation', 'countdowns']
    .map(key => [key, player.getVar(ids[key]) >>> 0]));
  const u32 = value => value >>> 0;
  const activityModal = Component.getId('inter_234');
  assert.notEqual(activityModal, -1, 'runtime component config contains an unrelated activity modal');

  for (const name of ['barrows_leave', 'barrows_logout', 'barrows_stair_exit', 'barrows_resume']) {
    assert(ScriptProvider.getByName(`[proc,${name}]`), `compiled S02 proc missing [proc,${name}]`);
  }

  const brotherEntries = parseEnum(contentRoot, 'barrows_brother_crypt_entry');
  const stairExits = parseEnum(contentRoot, 'barrows_stair_surface_exit');
  const brothers = ['ahrim', 'dharok', 'guthan', 'karil', 'torag', 'verac'];
  assert.equal(brotherEntries.size, 6, 'crypt entry enum has all six brother keys');
  assert.equal(stairExits.size, 6, 'surface exit enum has all six stair keys');
  const parsedCoordinate = text => {
    const [level, mapX, mapZ, localX, localZ] = text.split('_').map(Number);
    return { level, x: mapX * 64 + localX, z: mapZ * 64 + localZ };
  };
  // Match existing transport-free teleport tests: allocate destination zones only.
  // Live proofs, not this allocation, establish mapped walkability.
  for (const destination of [...brotherEntries.values(), ...stairExits.values()]) {
    const { x, z, level } = parsedCoordinate(destination);
    allocateIfAbsent(x, z, level);
  }
  const entryEnum = EnumType.getByName('barrows_brother_crypt_entry');
  const exitEnum = EnumType.getByName('barrows_stair_surface_exit');
  assert(entryEnum && exitEnum, 'runtime enum configs resolve by their names');
  for (const [npcName, destination] of brotherEntries) {
    const npcId = NpcType.getId(npcName);
    assert.notEqual(npcId, -1, `runtime NPC config resolves ${npcName}`);
    assert.deepEqual(CoordGrid.unpackCoord(entryEnum.values.get(npcId)), parsedCoordinate(destination), `${npcName} packed crypt-entry enum join`);
  }
  for (const [stairName, destination] of stairExits) {
    const locId = LocType.getId(stairName);
    assert.notEqual(locId, -1, `runtime loc config resolves ${stairName}`);
    assert.deepEqual(CoordGrid.unpackCoord(exitEnum.values.get(locId)), parsedCoordinate(destination), `${stairName} packed surface-exit enum join`);
  }
  const expectedBrotherEntries = new Map([
    ['barrows_ahrim', '3_55_151_37_39'], ['barrows_dharok', '3_55_151_36_54'],
    ['barrows_guthan', '3_55_151_15_41'], ['barrows_karil', '3_55_151_27_21'],
    ['barrows_torag', '3_55_151_45_20'], ['barrows_verac', '3_55_151_57_39']
  ]);
  const expectedStairExits = new Map([
    ['barrows_stairs_ahrim', '0_55_51_45_25'], ['barrows_stairs_dharok', '0_55_51_55_34'],
    ['barrows_stairs_guthan', '0_55_51_57_19'], ['barrows_stairs_karil', '0_55_51_46_12'],
    ['barrows_stairs_torag', '0_55_51_33_19'], ['barrows_stairs_verac', '0_55_51_37_34']
  ]);
  assert.deepEqual([...brotherEntries], [...expectedBrotherEntries], 'all six brother enum keys join to their crypt destinations');
  assert.deepEqual([...stairExits], [...expectedStairExits], 'all six stair enum keys join to their surface destinations');
  const locNames = brothers.map(name => `barrows_stairs_${name}`);
  for (const name of locNames) {
    assert(stairExits.has(name), `stair exit enum missing ${name}`);
    assert.notEqual(packedId(contentRoot, 'loc', name), undefined, `packed loc missing ${name}`);
  }
  for (const [npcName, destination] of brotherEntries) {
    assert.match(destination, /^3_55_151_\d+_\d+$/, `${npcName} crypt entry destination`);
    assert.notEqual(packedId(contentRoot, 'npc', npcName), undefined, `packed NPC missing ${npcName}`);
  }
  for (const [stairName, destination] of stairExits) {
    assert.match(destination, /^0_55_51_\d+_\d+$/, `${stairName} surface exit destination`);
    assert.notEqual(packedId(contentRoot, 'loc', stairName), undefined, `packed loc missing ${stairName}`);
    assert(stairExits.has(stairName), `stair exit enum missing ${stairName}`);
    const targetScript = ScriptProvider.getByName(`[oploc1,${stairName}]`);
    assert(targetScript, `compiled stair operation missing for ${stairName}`);
  }

  // Exit proc consumes each real loc config id and reaches that stair's enum destination.
  for (const [stairName, destination] of stairExits) {
    const player = makePlayer(stairName);
    player.level = 3;
    player.x = 3552;
    player.z = 9696;
    set(player, { client: 0x5a5a5a5a, credit: 0x12345678, state: 0x00008012, generation: 37, countdowns: 0x76543210 });
    procVoid(player, 'barrows_stair_exit', [packedId(contentRoot, 'loc', stairName)]);
    const [, level, mapX, mapZ, localX, localZ] = destination.match(/^(\d+)_(\d+)_(\d+)_(\d+)_(\d+)$/).map(Number);
    const x = mapX * 64 + localX;
    const z = mapZ * 64 + localZ;
    assert.deepEqual([player.level, player.x, player.z], [level, x, z], `${stairName} exact exit destination`);
    assert.equal(phase(player.getVar(ids.state)), 0, `${stairName} exit leaves paid phase`);
  }

  // Paid exit: every owned actor is removed through World, before durable state reset;
  // other owners and unowned map placements stay active.
  const paid = makePlayer('paid_exit');
  const paidSeed = { client: 0xa5a5a5a5, credit: 0xfedcba98, state: 0x5a5a8012, generation: 91, countdowns: 0x87654321 };
  set(paid, paidSeed);
  const owned = [
    addNpc('barrows_ahrim', 0, paid.uid, 3548, 9695),
    addNpc('barrows_rat', 3, paid.uid, 3550, 9698)
  ];
  const other = addNpc('barrows_dharok', 3, paid.uid + 1, 3554, 9698);
  const unowned = addNpc('barrows_spider', 0, null, 3556, 9698);
  paid.openMainModal(activityModal);
  paid.openMainOverlay(activityModal);
  const deletionRows = [];
  const removeNpc = World.removeNpc;
  World.removeNpc = function (npc, duration) {
    if (owned.some(row => row.npc === npc)) deletionRows.push(snapshot(paid));
    return removeNpc.call(this, npc, duration);
  };
  try {
    const random = measureRandom(() => procVoid(paid, 'barrows_leave'));
    assert.equal(random.calls, 0, 'leave must not redraw random state');
  } finally { World.removeNpc = removeNpc; }
  assert.equal(deletionRows.length, owned.length, 'leave removes each owned actor using World.removeNpc');
  for (const row of deletionRows) assert.deepEqual(row, { ...paidSeed, generation: paidSeed.generation + 1 }, 'paid reset advances generation before removing actors and clearing durable fields');
  for (const row of owned) assert.equal(row.npc.isActive, false, 'owned actor deleted');
  for (const row of [other, unowned]) assert.equal(row.npc.isActive, true, 'foreign or unowned actor retained');
  assert.equal(phase(paid.getVar(ids.state)), 0, 'paid exit resets phase to idle');
  assert.equal(paid.getVar(ids.credit) >>> 0, 0, 'paid exit clears credit');
  assert.equal((paid.getVar(ids.client) >>> 0) & (0xffff << 10), (0xffff << 10) >>> 0, 'paid exit initializes all locks');
  assert.equal(paid.getVar(ids.state) >>> 0, u32(paidSeed.state & 0xffff0000), 'paid exit retains only the unassigned upper state bits');
  const preservedClientMask = (0x3f | (0x7 << 26)) >>> 0;
  assert.equal(paid.getVar(ids.client) >>> 0, (((paidSeed.client & preservedClientMask) | (0xffff << 10)) >>> 0), 'paid exit retains original client fields and initializes every lock');
  assert.equal((paid.getVar(ids.state) >>> 0) & 0xffff, 0, 'paid exit clears assigned transient state');
  assert.equal(paid.modalMain, -1, 'paid leave closes the active modal');
  assert.equal(paid.pendingModalClose, true, 'disconnected paid fixture retains its real pending close');
  assert(paid.packets.some(packet => packet.constructor.name === 'CamReset'), 'paid leave resets the camera');
  assert.equal(paid.overlay, -1, 'paid leave closes Barrows HUD overlay');
  removeFixtures([other, unowned]);

  // Leave in phase 1 preserves durable fields, removes its actors and consumes no RNG.
  const preloot = makePlayer('preloot_exit');
  const prelootSeed = { client: 0x5a5aa5a5, credit: 0xdeadbeef, state: 0xcafe800a, generation: 123, countdowns: 0x80004321 };
  set(preloot, prelootSeed);
  const prelootActor = addNpc('barrows_bloodworm', 0, preloot.uid, 3550, 9697);
  preloot.openMainModal(activityModal);
  preloot.openMainOverlay(activityModal);
  const prelootRandom = measureRandom(() => procVoid(preloot, 'barrows_leave'));
  assert.equal(prelootRandom.calls, 0, 'phase-1 leave must not redraw random state');
  assert.deepEqual(snapshot(preloot), { ...prelootSeed, state: u32(prelootSeed.state & ~0x8000) }, 'phase-1 leave preserves durable fields and clears only the challenge');
  assert.equal(prelootActor.npc.isActive, false, 'phase-1 leave removes its live actor without credit');
  assert.equal(preloot.modalMain, -1, 'leave closes active modal presentation');
  assert.equal(preloot.pendingModalClose, true, 'disconnected preloot fixture retains its real pending close');
  assert.equal(preloot.overlay, -1, 'phase-1 leave closes Barrows HUD overlay');
  assert(preloot.packets.some(packet => packet.constructor.name === 'CamReset'), 'leave resets camera presentation');
  removeFixtures([prelootActor]);
  for (const phaseNumber of [0, 3]) {
    const player = makePlayer(`leave_nonrun_${phaseNumber}`);
    const seed = { client: 0x11223344, credit: 0x55667788, state: 0xabcd0000 | (phaseNumber << 3) | 0x8000, generation: 45, countdowns: 0x87654321 };
    set(player, seed);
    procVoid(player, 'barrows_leave');
    assert.deepEqual(snapshot(player), { ...seed, state: u32(seed.state & ~0x8000) }, `phase-${phaseNumber} leave clears only transient challenge and invents no run`);
  }

  // Login inside phase 1/2 clears only the challenge and restores the kill counter HUD.
  for (const phaseNumber of [1, 2]) {
    const player = makePlayer(`resume_inside_${phaseNumber}`, 3);
    const state = (0xbeef0000 | (phaseNumber << 3) | 0x8000 | 3) >>> 0;
    const seed = { client: 0x5a5a1234, credit: 0x76543210, state, generation: 404, countdowns: 0xf00dbeef };
    set(player, seed);
    const before = snapshot(player);
    player.packets.length = 0;
    const timersBefore = player.timers.size;
    const measured = measureRandom(() => procVoid(player, 'barrows_resume'));
    assert.equal(measured.calls, 0, 'resume must not redraw layout/random state');
    assert.deepEqual(snapshot(player), { ...before, state: u32(state & ~0x8000) }, 'inside resume only clears active challenge');
    const killCountOverlay = Component.getId('kill_count');
    assert.notEqual(killCountOverlay, -1, 'runtime component config contains kill_count');
    assert.equal(player.overlay, killCountOverlay, 'inside resume restores the Barrows kill-count HUD');
    assert.equal(player.timers.size, timersBefore, 'resume does not add or replace timers');
    assert.equal(player.getVar(ids.countdowns) >>> 0, seed.countdowns, 'resume preserves saved countdowns');
  }

  // Outside paid login reconciles through leave/reset; outside phase 1 retains the
  // run and unrelated activity overlay instead of replacing it with Barrows HUD.
  const paidResume = makePlayer('resume_outside_paid', 0, 3400, 3400);
  const paidResumeSeed = { client: 0x12345678, credit: 900, state: 0x5a5a8012, generation: 66, countdowns: 0x12345678 };
  paidResume.openMainModal(activityModal);
  paidResume.openMainOverlay(activityModal);
  set(paidResume, paidResumeSeed);
  paidResume.packets.length = 0;
  const outside = measureRandom(() => procVoid(paidResume, 'barrows_resume'));
  assert.equal(outside.calls, 0, 'outside paid resume must not redraw random state');
  assert.equal(phase(paidResume.getVar(ids.state)), 0, 'outside paid resume resets phase');
  assert.equal(paidResume.getVar(ids.credit), 0, 'outside paid resume clears credit');
  assert.equal(paidResume.getVar(ids.generation) >>> 0, paidResumeSeed.generation + 1, 'outside paid resume advances generation');
  assert(!paidResume.packets.some(packet => packet.constructor.name === 'IfOpenOverlay'), 'outside resume does not open a Barrows HUD');
  assert.equal(paidResume.overlay, -1, 'outside paid resume closes the HUD overlay');

  const phaseOneOutside = makePlayer('resume_outside_preloot', 0, 3400, 3400);
  const phaseOneSeed = { client: 0x778899aa, credit: 321, state: 0xbeef000a, generation: 81, countdowns: 0x80001234 };
  set(phaseOneOutside, phaseOneSeed);
  phaseOneOutside.openMainModal(activityModal);
  phaseOneOutside.openMainOverlay(activityModal);
  phaseOneOutside.packets.length = 0;
  procVoid(phaseOneOutside, 'barrows_resume');
  assert.deepEqual(snapshot(phaseOneOutside), phaseOneSeed, 'outside phase-1 resume preserves durable fields');
  assert.equal(phaseOneOutside.modalMain, activityModal, 'outside phase-1 resume does not erase another activity modal');
  assert.equal(phaseOneOutside.overlay, activityModal, 'outside phase-1 resume retains another activity overlay');
  assert.equal(phaseOneOutside.pendingModalClose, false, 'outside phase-1 resume does not queue an unrelated modal close');

  // Logout inside clears transient presentation but preserves both phases exactly.
  for (const phaseNumber of [1, 2]) {
    const player = makePlayer(`logout_inside_${phaseNumber}`, 3);
    const state = (0xa5a50000 | (phaseNumber << 3) | 0x8000 | 5) >>> 0;
    const seed = { client: 0x98765432, credit: 0xabcdef01, state, generation: 991, countdowns: 0xfedcba98 };
    set(player, seed);
    const actor = addNpc('barrows_giantrat', 3, player.uid, 3551, 9696);
    player.openMainModal(activityModal);
    player.openMainOverlay(activityModal);
    player.packets.length = 0;
    procVoid(player, 'barrows_logout');
    assert.deepEqual(snapshot(player), { ...seed, state: u32(state & ~0x8000) }, 'logout preserves phase and durable fields, clearing only challenge');
    assert.equal(actor.npc.isActive, false, 'logout removes its owned actor');
    assert.equal(player.overlay, -1, 'logout clears Barrows HUD overlay');
    assert.equal(player.modalMain, -1, 'logout closes modal state');
    assert(!player.packets.some(packet => packet.constructor.name === 'IfOpenOverlay'), 'logout never opens Barrows HUD');
    assert.equal(player.pendingModalClose, true, 'disconnected logout fixture retains its real pending close');
    assert(player.packets.some(packet => packet.constructor.name === 'CamReset'), 'logout resets camera presentation');
  }

  // The map-zone hook is asked after movement: inside Barrows it must not leave,
  // while crossing the zone boundary in paid phase must reset exactly once.
  const zoneHook = ScriptProvider.getByName('[mapzoneexit,0_55_151]');
  assert(zoneHook, 'compiled [mapzoneexit,0_55_151] is missing');
  for (const [level, x, z, phaseNumber, expectedPhase] of [
    [0, 3552, 9696, 2, 2], [3, 3552, 9696, 2, 2], [0, 3400, 3400, 2, 0], [0, 3400, 3400, 1, 1]
  ]) {
    const player = makePlayer(`zone_${level}_${x}_${phaseNumber}`, level, x, z);
    const seed = { client: 0x11223344, credit: 77, state: u32(0xcafe0000 | (phaseNumber << 3)), generation: 73, countdowns: 0x12345678 };
    set(player, seed);
    const state = call(player, '[mapzoneexit,0_55_151]', [], null, true, true);
    assert.equal(state.isp, 0, 'map-zone exit handler is void');
    assert.equal(phase(player.getVar(ids.state)), expectedPhase, 'map-zone exit leaves only outside both Barrows levels');
    if (expectedPhase === 0) {
      assert.equal(player.getVar(ids.credit) >>> 0, 0, 'outside paid map-zone exit clears credit');
      assert.equal(player.getVar(ids.countdowns) >>> 0, 0, 'outside paid map-zone exit clears countdowns');
      assert.equal(player.getVar(ids.state) >>> 0, u32(seed.state & 0xffff0000), 'outside paid map-zone exit clears assigned run fields');
    } else {
      assert.deepEqual(snapshot(player), seed, 'inside and preloot map-zone exits retain all run state');
    }
    assert.equal(player.getVar(ids.generation) >>> 0, expectedPhase === 0 ? seed.generation + 1 : seed.generation, 'map-zone exit generation follows leave');
  }

  // Execute all six real Dig branches through the ordinary delay and resume path.
  const digScript = ScriptProvider.getByName('[proc,barrows_dig]');
  assert(digScript, 'compiled Dig proc is present');
  const moundPlayer = makePlayer('mounds', 0, 3565, 3289);
  let firstEntry;
  for (const [brother, x, z] of [
    ['ahrim', 3565, 3289], ['dharok', 3575, 3298], ['guthan', 3577, 3283],
    ['karil', 3566, 3276], ['torag', 3553, 3283], ['verac', 3557, 3298]
  ]) {
    moundPlayer.level = 0;
    moundPlayer.x = x;
    moundPlayer.z = z;
    const state = ScriptRunner.init(digScript, moundPlayer);
    const measured = measureRandom(() => moundPlayer.executeScript(state, true, true));
    assert.equal(state.execution, ScriptState.SUSPENDED, `${brother} retains the ordinary Dig delay`);
    assert.equal(moundPlayer.activeScript, state, 'ordinary player execution retains the delayed script');
    assert.deepEqual([moundPlayer.level, moundPlayer.x, moundPlayer.z], [0, x, z], 'run initialization precedes the teleport');
    assert.equal(phase(moundPlayer.getVar(ids.state)), 1, 'Dig initializes the unlooted phase before the view');
    assert.equal((moundPlayer.getVar(ids.client) >>> 10) & 0xffff, 0xffff, 'every lock is set before the crypt view');
    assert.equal(measured.calls, firstEntry ? 0 : 1, 'another crypt never redraws the unfinished run');
    // World clears this flag at delayedUntil, then resumes this same script.
    World.currentTick = moundPlayer.delayedUntil;
    moundPlayer.delayed = false;
    moundPlayer.executeScript(state, true, true);
    assert.equal(state.execution, ScriptState.FINISHED, `${brother} Dig resumes to completion`);
    assert.equal(moundPlayer.activeScript, null, 'completed Dig releases its suspended script');
    assert.equal(state.popInt(), 1, 'each measured mound is accepted');
    const destination = parsedCoordinate(expectedBrotherEntries.get(`barrows_${brother}`));
    assert.deepEqual([moundPlayer.level, moundPlayer.x, moundPlayer.z], [destination.level, destination.x, destination.z], `${brother} exact joined crypt destination`);
    assert.equal(moundPlayer.overlay, Component.getId('kill_count'), 'Dig opens the original kill-count HUD');
    firstEntry ??= snapshot(moundPlayer);
    assert.deepEqual(snapshot(moundPlayer), firstEntry, 'all six crypts retain the same unfinished run');
  }
  const offPeak = makePlayer('off_peak', 0, 3540, 3300);
  const beforeOffPeak = snapshot(offPeak);
  assert.equal(procInt(offPeak, 'barrows_dig'), 0, 'off-peak Dig is not a Barrows entry');
  assert.deepEqual(snapshot(offPeak), beforeOffPeak, 'off-peak Dig writes no Barrows state');
  assert.deepEqual([offPeak.level, offPeak.x, offPeak.z], [0, 3540, 3300], 'off-peak Dig stays on the surface');

  removeFixtures();
  console.log('PASS S02 compiled Barrows leave, stair exits, login/logout reconciliation and map-zone exit');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run(main);
