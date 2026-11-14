#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRunner, loadPackedRuntime, packedId, parseEnum, parseOptions, run } from './packed.mjs';

const options = parseOptions(process.argv);

async function main() {
  const runtime = await loadPackedRuntime(options);
  const { contentRoot, World, ScriptProvider, ScriptRunner, ScriptState, VarPlayerType, LocType, NpcType, EnumType, CoordGrid, Component, allocateIfAbsent } = runtime;
  const runner = createRunner(runtime, { prefix: 'barrows_entry' });
  const { makePlayer, call, procVoid, procInt, addNpc, removeFixtures, measureRandom } = runner;
  const { default: ServerTriggerType } = await import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/script/ServerTriggerType.ts')).href);
  const { default: VarSharedType } = await import(pathToFileURL(path.join(runtime.engineRoot, 'src/cache/config/VarSharedType.ts')).href);
  VarSharedType.load(runtime.packDir);
  World.vars = new Int32Array(VarSharedType.count);
  const runLifecycleTrigger = (player, name) => {
    const triggerName = `[${name},_]`;
    const triggerType = name === 'login' ? ServerTriggerType.LOGIN : ServerTriggerType.LOGOUT;
    const script = ScriptProvider.getByTriggerSpecific(triggerType, -1, -1);
    assert(script, `compiled ${triggerName} server trigger is present`);
    assert.equal(script, ScriptProvider.getByName(triggerName), `${triggerName} resolves through the engine's server-trigger lookup`);
    const state = ScriptRunner.init(script, player);
    const execution = player.runScript(state, true);
    assert.equal(execution, ScriptState.FINISHED, `${triggerName} finishes synchronously`);
    assert.equal(state.execution, ScriptState.FINISHED, `${triggerName} completes the compiled trigger`);
    assert.equal(player.delayed, false, `${triggerName} does not leave a delay`);
    assert.equal(player.activeScript, null, `${triggerName} does not leave a suspended script`);
    assert.equal(player.protect, false, `${triggerName} releases protected access`);
  };
  const varp = name => {
    const id = packedId(contentRoot, 'varp', name);
    assert.equal(VarPlayerType.getId(name), id, `runtime varp identity ${name}`);
    return id;
  };
  const ids = {
    client: varp('barrows'), credit: varp('barrows_kills'), state: varp('barrows_state'),
    generation: varp('barrows_generation'), countdowns: varp('barrows_countdowns')
  };
  const assertLayout = player => {
    const state = player.getVar(ids.state) >>> 0;
    const client = player.getVar(ids.client) >>> 0;
    assert.equal((client >>> 6) & 15, 1 << ((state >>> 5) & 3), 'exactly the selected ladder is visible');
    const locks = (client >>> 10) & 0xffff;
    for (const [entrance, bit] of [4, 8, 9, 11].entries()) assert.equal((locks >>> bit) & 1, entrance === ((state >>> 7) & 3) ? 0 : 1, 'one central entrance matches its stored selector');
    for (const [a, b] of [[3, 5], [2, 10], [6, 12], [13, 14]]) assert.notEqual(((locks >>> a) & 1) + ((locks >>> b) & 1), 2, 'each side room retains a corner route');
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
  const paidPreviousCorner = (paidSeed.state >>> 5) & 3;
  const paidPreviousEntrance = (paidSeed.state >>> 7) & 3;
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
    assert.equal(random.calls, 1, 'paid leave redraws one idle layout rank');
  } finally { World.removeNpc = removeNpc; }
  assert.equal(deletionRows.length, owned.length, 'leave removes each owned actor using World.removeNpc');
  for (const row of deletionRows) assert.deepEqual(row, { ...paidSeed, generation: paidSeed.generation + 1 }, 'paid reset advances generation before removing actors and clearing durable fields');
  for (const row of owned) assert.equal(row.npc.isActive, false, 'owned actor deleted');
  for (const row of [other, unowned]) assert.equal(row.npc.isActive, true, 'foreign or unowned actor retained');
  assert.equal(phase(paid.getVar(ids.state)), 0, 'paid exit resets phase to idle');
  assert.equal(paid.getVar(ids.credit) >>> 0, 0, 'paid exit clears credit');
  assertLayout(paid);
  assert.equal((paid.getVar(ids.state) >>> 5) & 3, paidPreviousCorner, 'paid leave retains the previous ladder corner');
  assert.equal((paid.getVar(ids.state) >>> 7) & 3, paidPreviousEntrance, 'paid leave retains the previous central entrance');
  assert.equal((paid.getVar(ids.state) & ~0x1e0) >>> 0, u32(paidSeed.state & 0xffff0000), 'paid exit retains upper state bits and only idle layout selectors');
  const preservedClientMask = (0x3f | (0x7 << 26)) >>> 0;
  assert.equal(paid.getVar(ids.client) & preservedClientMask, paidSeed.client & preservedClientMask, 'paid exit preserves unrelated original client fields');
  assert.equal((paid.getVar(ids.state) >>> 0) & (0xffff & ~0x1e0), 0, 'paid exit clears progression and retains only idle layout selectors');
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
    assert.equal(player.timers.size, timersBefore + 1, 'resume arms the one-tick Barrows timer');
    assert.equal(player.getVar(ids.countdowns) >>> 0, seed.countdowns, 'resume preserves saved countdowns');
  }
  // Execute the exact compiled login server trigger through the engine's trigger
  // lookup, not only its Barrows helper proc. A live actor distinguishes resume
  // from the shared leave hook: resuming restores the HUD without deleting it.
  const killCountOverlay = Component.getId('kill_count');
  assert.notEqual(killCountOverlay, -1, 'runtime component config contains kill_count');
  const loginRun = makePlayer('login_trigger_run', 3);
  const loginRunSeed = {
    client: 0x5a5a1234, credit: 0x76543210,
    state: (0xbeef0000 | (1 << 3) | 0x8000 | 5) >>> 0,
    generation: 404, countdowns: 0xf00dbeef
  };
  set(loginRun, loginRunSeed);
  const loginRunActor = addNpc('barrows_giantrat', 3, loginRun.uid, 3551, 9696);
  loginRun.packets.length = 0;
  runLifecycleTrigger(loginRun, 'login');
  assert.deepEqual(snapshot(loginRun), { ...loginRunSeed, state: u32(loginRunSeed.state & ~0x8000) }, '[login,_] preserves the unfinished run and clears only its active challenge');
  assert.equal(phase(loginRun.getVar(ids.state)), 1, '[login,_] preserves an unlooted run');
  assert.equal(loginRun.overlay, killCountOverlay, '[login,_] restores the kill-count HUD for an active run');
  assert.equal(loginRunActor.npc.isActive, true, '[login,_] resumes without removing the owner’s live actor');

  // A player inside the crypt without a run must not acquire one from login.
  const loginNoRun = makePlayer('login_trigger_no_run', 3);
  const loginNoRunSeed = {
    client: 0x12345678, credit: 0, state: 0xcafe8000,
    generation: 0, countdowns: 0
  };
  set(loginNoRun, loginNoRunSeed);
  runLifecycleTrigger(loginNoRun, 'login');
  assert.deepEqual(snapshot(loginNoRun), { ...loginNoRunSeed, state: u32(loginNoRunSeed.state & ~0x8000) }, '[login,_] does not invent a run and clears only the stale challenge');
  assert.equal(phase(loginNoRun.getVar(ids.state)), 0, '[login,_] keeps a no-run player idle');
  assert.notEqual(loginNoRun.overlay, killCountOverlay, '[login,_] does not open the kill-count HUD without a run');


  // Outside paid login reconciles through leave/reset; outside phase 1 retains the
  // run and unrelated activity overlay instead of replacing it with Barrows HUD.
  const paidResume = makePlayer('resume_outside_paid', 0, 3400, 3400);
  const paidResumeSeed = { client: 0x12345678, credit: 900, state: 0x5a5a8012, generation: 66, countdowns: 0x12345678 };
  const paidResumePreviousCorner = (paidResumeSeed.state >>> 5) & 3;
  const paidResumePreviousEntrance = (paidResumeSeed.state >>> 7) & 3;
  paidResume.openMainModal(activityModal);
  paidResume.openMainOverlay(activityModal);
  set(paidResume, paidResumeSeed);
  paidResume.packets.length = 0;
  const outside = measureRandom(() => procVoid(paidResume, 'barrows_resume'));
  assert.equal(outside.calls, 1, 'outside paid resume draws one idle layout rank');
  assert.equal(phase(paidResume.getVar(ids.state)), 0, 'outside paid resume resets phase');
  assert.equal(paidResume.getVar(ids.credit), 0, 'outside paid resume clears credit');
  assert.equal(paidResume.getVar(ids.generation) >>> 0, paidResumeSeed.generation + 1, 'outside paid resume advances generation');
  assert.equal((paidResume.getVar(ids.state) >>> 5) & 3, paidResumePreviousCorner, 'outside paid resume retains the previous ladder corner');
  assert.equal((paidResume.getVar(ids.state) >>> 7) & 3, paidResumePreviousEntrance, 'outside paid resume retains the previous central entrance');
  assertLayout(paidResume);
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
  // The logout server trigger must dispatch Barrows cleanup for both a live
  // unfinished run and an idle player, without deleting a foreign owner’s actor.
  const logoutRun = makePlayer('logout_trigger_run', 3);
  const logoutRunSeed = {
    client: 0x98765432, credit: 0xabcdef01,
    state: (0xa5a50000 | (1 << 3) | 0x8000 | 5) >>> 0,
    generation: 991, countdowns: 0xfedcba98
  };
  set(logoutRun, logoutRunSeed);
  const logoutRunActor = addNpc('barrows_giantrat', 3, logoutRun.uid, 3551, 9696);
  const logoutRunForeignActor = addNpc('barrows_dharok', 3, logoutRun.uid + 1_000_000, 3552, 9697);
  logoutRun.openMainModal(activityModal);
  logoutRun.openMainOverlay(killCountOverlay);
  logoutRun.packets.length = 0;
  runLifecycleTrigger(logoutRun, 'logout');
  assert.deepEqual(snapshot(logoutRun), { ...logoutRunSeed, state: u32(logoutRunSeed.state & ~0x8000) }, '[logout,_] preserves the unfinished run and clears only its active challenge');
  assert.equal(phase(logoutRun.getVar(ids.state)), 1, '[logout,_] does not reset an unfinished run');
  assert.equal(logoutRunActor.npc.isActive, false, '[logout,_] removes the player’s owned actor');
  assert.equal(logoutRunForeignActor.npc.isActive, true, '[logout,_] retains a foreign owner’s actor');
  assert.equal(logoutRun.modalMain, -1, '[logout,_] closes modal presentation');
  assert.equal(logoutRun.pendingModalClose, true, '[logout,_] records the disconnected modal close');
  assert.equal(logoutRun.overlay, -1, '[logout,_] closes the Barrows HUD');
  assert(logoutRun.packets.some(packet => packet.constructor.name === 'CamReset'), '[logout,_] resets camera presentation');
  assert(!logoutRun.packets.some(packet => packet.constructor.name === 'IfOpenOverlay'), '[logout,_] does not reopen an overlay');

  const logoutNoRun = makePlayer('logout_trigger_no_run', 3);
  const logoutNoRunSeed = {
    client: 0x11223344, credit: 0, state: 0xabcd8000,
    generation: 0, countdowns: 0
  };
  set(logoutNoRun, logoutNoRunSeed);
  const logoutNoRunActor = addNpc('barrows_bloodworm', 3, logoutNoRun.uid, 3550, 9697);
  const logoutNoRunForeignActor = addNpc('barrows_ahrim', 3, logoutNoRun.uid + 1_000_000, 3553, 9698);
  logoutNoRun.openMainModal(activityModal);
  logoutNoRun.openMainOverlay(killCountOverlay);
  logoutNoRun.packets.length = 0;
  runLifecycleTrigger(logoutNoRun, 'logout');
  assert.deepEqual(snapshot(logoutNoRun), { ...logoutNoRunSeed, state: u32(logoutNoRunSeed.state & ~0x8000) }, '[logout,_] does not invent or reset a run');
  assert.equal(phase(logoutNoRun.getVar(ids.state)), 0, '[logout,_] keeps a no-run player idle');
  assert.equal(logoutNoRunActor.npc.isActive, false, '[logout,_] removes only the no-run player’s own actor');
  assert.equal(logoutNoRunForeignActor.npc.isActive, true, '[logout,_] retains a foreign actor without a run');
  assert.equal(logoutNoRun.modalMain, -1, '[logout,_] closes no-run modal presentation');
  assert.equal(logoutNoRun.pendingModalClose, true, '[logout,_] records no-run modal close');
  assert.equal(logoutNoRun.overlay, -1, '[logout,_] closes no-run overlay presentation');
  assert(logoutNoRun.packets.some(packet => packet.constructor.name === 'CamReset'), '[logout,_] resets no-run camera presentation');


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
      assert.equal((player.getVar(ids.state) & ~0x1e0) >>> 0, u32(seed.state & 0xffff0000), 'outside paid map-zone exit clears progression and writes idle layout selectors');
      assertLayout(player);
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
    assertLayout(moundPlayer);
    assert.equal(measured.calls, firstEntry ? 0 : 2, 'first Dig draws identity and one global layout seam, another crypt never redraws');
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
  console.log('PASS S02 compiled Barrows leave, stair exits, actual login/logout triggers and map-zone exit');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run(main);
