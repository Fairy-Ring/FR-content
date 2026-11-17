#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRunner, loadPackedRuntime, parseOptions, run } from './packed.mjs';

const BROTHERS = [
  ['barrows_ahrim', 98], ['barrows_dharok', 115], ['barrows_guthan', 115],
  ['barrows_karil', 98], ['barrows_torag', 115], ['barrows_verac', 115]
];
const ORDINARY = [
  ['barrows_rat', 43], ['barrows_bloodworm', 52], ['barrows_spider', 56],
  ['barrows_giantrat', 76], ['barrows_skeleton_unarmed', 77],
  ['barrows_skeleton_armed', 77], ['barrows_giantspider', 79]
];
const NPC_NAMES = [...BROTHERS, ...ORDINARY].map(([name]) => name);
const PHASE_SHIFT = 3;
const KILL_MASK = 0x3f;
const POTENTIAL_MASK = 0x3ff;
const CHEST_BIT = 1 << 16;
const MAX_KILLS = 32767;
const MAX_POTENTIAL = 1000;
const u32 = value => value >>> 0;
const bitField = (value, shift, mask) => (u32(value) >>> shift) & mask;

function creditWord({ slain = 0, potential = 0, chest = 0, count = 0 } = {}) {
  return u32(
    (slain & KILL_MASK) |
    ((potential & POTENTIAL_MASK) << 6) |
    ((chest & 1) << 16) |
    ((count & 0x7fff) << 17)
  );
}

function stateWord({ phase = 1, identity = 1, retained = 0x5a5a0000 } = {}) {
  return u32((retained & 0xffff0000) | (identity & 0x7) | ((phase & 0x3) << PHASE_SHIFT));
}

await run(async () => {
  const runtime = await loadPackedRuntime(parseOptions());
  const { World, Player, NpcType, VarPlayerType, VarNpcType, ScriptProvider, ScriptRunner, ScriptState } = runtime;
  const runner = createRunner(runtime, { prefix: 'barrows_credit', firstUid: 9300 });
  const { procInt, procVoid, addNpc } = runner;
  const [{ default: ServerTriggerType }, { NpcStatMap }] = await Promise.all([
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/script/ServerTriggerType.ts')).href),
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/entity/NpcStat.ts')).href)
  ]);
  const { default:HuntType } = await import(pathToFileURL(path.join(runtime.engineRoot, 'src/cache/config/HuntType.ts')).href);
  HuntType.load(runtime.packDir);
  const hitpointsIndex = NpcStatMap.get('HITPOINTS');
  assert.notEqual(hitpointsIndex, undefined, 'native NPC hitpoint index is available');

  const playerVarIds = Object.fromEntries([
    'barrows', 'barrows_kills', 'barrows_state', 'barrows_generation', 'barrows_countdowns'
  ].map(name => {
    const id = VarPlayerType.getId(name);
    assert.notEqual(id, -1, `missing Barrows player var ${name}`);
    return [name, id];
  }));
  const npcVarIds = Object.fromEntries([
    'npc_barrows_owner', 'npc_barrows_generation', 'npc_barrows_public', 'npc_attacking_uid', 'npc_aggressive_player'
  ].map(name => {
    const id = VarNpcType.getId(name);
    assert.notEqual(id, -1, `missing NPC var ${name}`);
    return [name, id];
  }));
  const npcTypes = Object.fromEntries(NPC_NAMES.map(name => {
    const id = NpcType.getId(name);
    assert.notEqual(id, -1, `missing original NPC type ${name}`);
    return [name, id];
  }));

  for (const name of [
    'barrows_npc_level', 'barrows_credit', 'barrows_npc_credit', 'barrows_npc_death',
    'barrows_run_reset', 'barrows_run_begin'
  ]) {
    assert(ScriptProvider.getByName(`[proc,${name}]`), `compiled S04 proc missing [proc,${name}]`);
  }
  const creditQueue = ScriptProvider.getByName('[queue,barrows_credit_kill]');
  assert(creditQueue, 'compiled S04 queue missing [queue,barrows_credit_kill]');
  assert(ScriptProvider.getByName('[proc,npc_default_death]'), 'native ordinary NPC death proc is present');
  assert(ScriptProvider.getByName('[proc,check_progress_task]'), 'native progress-task proc is present');
  const aiQueue3 = new Map();
  for (const name of NPC_NAMES) {
    const script = ScriptProvider.getByName(`[ai_queue3,${name}]`);
    assert(script, `${name} has a compiled ai_queue3 death wrapper`);
    aiQueue3.set(name, script);
  }

  World.currentTick = 1;
  let nextSlot = 1;
  const players = [];
  function makePlayer(label, { level = 3, x = 3556, z = 9714 } = {}) {
    const serial = players.length + 1;
    const hash64 = 0x100000000000000n + BigInt(serial);
    const player = new Player(`barrows_credit_${label}_${serial}`, BigInt(200000 + serial), hash64);
    player.slot = nextSlot++;
    player.uid = (Number(player.username37 & 0x1fffffn) << 11) | player.slot;
    player.pid = player.slot;
    player.isActive = true;
    player.staffModLevel = 0;
    player.level = level;
    player.x = x;
    player.z = z;
    player.messages = [];
    player.packets = [];
    player.lastMovement = 0;
    player.write = message => player.packets.push(message);
    player.messageGame = message => player.messages.push(message);
    player.wrappedMessageGame = message => player.messages.push(message);
    World.players[player.slot] = player;
    World.playerLoop.add(0x70000000n + BigInt(player.slot), player);
    assert.equal(World.getPlayerByHash64(hash64), player, 'native World player registry resolves each distinct hash64');
    assert.equal(World.getPlayerByUid(player.uid), player, 'native World UID resolves the registered slot and username hash');
    players.push(player);
    return player;
  }

  function setRun(player, {
    generation = 1, phase = 1, identity = 1, level = 3, x = 3556, z = 9714,
    credit = 0, client = 0xe1234567, retained = 0x5a5a0000, countdowns = 0x89abcdef
  } = {}) {
    player.level = level;
    player.x = x;
    player.z = z;
    player.setVar(playerVarIds.barrows, client);
    player.setVar(playerVarIds.barrows_state, stateWord({ phase, identity, retained }));
    player.setVar(playerVarIds.barrows_generation, generation);
    player.setVar(playerVarIds.barrows_kills, credit);
    player.setVar(playerVarIds.barrows_countdowns, countdowns);
  }

  function getCredit(player) {
    return u32(player.getVar(playerVarIds.barrows_kills));
  }

  function creditSnapshot(player) {
    return {
      client: u32(player.getVar(playerVarIds.barrows)),
      state: u32(player.getVar(playerVarIds.barrows_state)),
      generation: u32(player.getVar(playerVarIds.barrows_generation)),
      credit: getCredit(player),
      countdowns: u32(player.getVar(playerVarIds.barrows_countdowns))
    };
  }

  function deliver(player, generation, npcName, level) {
    procVoid(player, 'barrows_credit', [generation, npcTypes[npcName], level]);
  }

  function capturedCreditRequests(player) {
    return Array.from(player.queue.all()).filter(request => request.script === creditQueue);
  }

  function captureCredit(player, label) {
    const requests = capturedCreditRequests(player);
    assert.equal(requests.length, 1, `${label} produced exactly one native queued credit event`);
    return requests[0];
  }

  function assertNoCreditRequest(player, label) {
    assert.equal(capturedCreditRequests(player).length, 0, `${label} produced no queued credit`);
  }

  function assertCaptured(request, generation, npcName, level, label) {
    assert.equal(request.script, creditQueue, `${label} retains the packed barrows_credit_kill queue handler`);
    assert.deepEqual(request.args, [generation, npcTypes[npcName], level], `${label} captures generation, NPC type and level`);
  }

  function replayCredit(player, request, label) {
    assert.equal(player.canAccess(), true, `${label} player can execute the native queue`);
    const savedArgs = request.args.slice();
    player.queue.addTail(request);
    let ticks = 0;
    while (capturedCreditRequests(player).includes(request) && ticks < 256) {
      player.processQueues();
      ticks++;
    }
    assert(!capturedCreditRequests(player).includes(request), `${label} executes and removes the captured native queue request`);
    assert.deepEqual(request.args, savedArgs, `${label} keeps the genuinely captured event arguments available for replay`);
    assert.equal(player.protect, false, `${label} native queue releases protected access`);
  }

  function actor(name, level, ownerUid = null, x = 3556, z = 9714) {
    const record = addNpc(name, level, ownerUid, x, z);
    return record.npc;
  }

  function seedActor(npc, { owner = 0, generation = 0, aggressor = 0, hp = 0 } = {}) {
    npc.setVar(npcVarIds.npc_barrows_owner, owner);
    npc.setVar(npcVarIds.npc_barrows_generation, generation);
    npc.setVar(npcVarIds.npc_attacking_uid, aggressor);
    npc.setVar(npcVarIds.npc_aggressive_player, aggressor);
    npc.levels[hitpointsIndex] = hp;
  }

  function npcProc(npc, name, args = []) {
    const script = ScriptProvider.getByName(`[proc,${name}]`);
    assert(script, `compiled NPC proc is missing: ${name}`);
    const state = ScriptRunner.init(script, npc, null, args);
    npc.executeScript(state);
    assert.equal(state.execution, ScriptState.FINISHED, `${name} must finish synchronously in native NPC context`);
    assert.equal(npc.activeScript, null, `${name} must not leave a suspended NPC proc`);
    assert.equal(npc.delayed, false, `${name} must not leave an NPC delay`);
    return state;
  }

  try {
    const levelPlayer = makePlayer('level_join');
    setRun(levelPlayer, { generation: 11 });
    const rows = [...BROTHERS, ...ORDINARY];
    for (let index = 0; index < rows.length; index++) {
      const [name, level] = rows[index];
      assert.equal(procInt(levelPlayer, 'barrows_npc_level', [npcTypes[name]]), level, `${name} retains its original visible level`);
    }
    let unrelatedType = -1;
    for (let id = 0; id < NpcType.count; id++) {
      const type = NpcType.get(id);
      if (type && !NPC_NAMES.includes(type.debugname)) {
        unrelatedType = id;
        break;
      }
    }
    assert.notEqual(unrelatedType, -1, 'a non-Barrows NPC type is available as the unknown-level case');
    assert.equal(procInt(levelPlayer, 'barrows_npc_level', [unrelatedType]), 0, 'unknown NPC level maps to zero');
    assert.equal(procInt(levelPlayer, 'barrows_npc_level', [-1]), 0, 'invalid NPC level maps to zero');

    for (let identity = 1; identity <= BROTHERS.length; identity++) {
      const [name, level] = BROTHERS[identity - 1];
      const player = makePlayer(`brother_${identity}`);
      const unrelatedSlain = 1 << (identity % BROTHERS.length);
      const initialCredit = creditWord({ slain: unrelatedSlain, chest: 1 });
      setRun(player, { generation: 20 + identity, credit: initialCredit });
      assert.equal(procInt(player, 'barrows_brother_identity', [npcTypes[name]]), identity, `${name} has original unique identity ${identity}`);
      const before = creditSnapshot(player);
      deliver(player, 20 + identity, name, level);
      let actual = getCredit(player);
      assert.equal(actual & KILL_MASK, unrelatedSlain | (1 << (identity - 1)), `${name} sets only its original slain bit`);
      assert.equal(bitField(actual, 6, POTENTIAL_MASK), level, `${name} adds its visible level once to potential`);
      assert.equal(bitField(actual, 17, 0x7fff), 1, `${name} increments count once`);
      assert.equal(actual & CHEST_BIT, CHEST_BIT, `${name} preserves the chest bit`);
      assert.deepEqual({ ...creditSnapshot(player), credit: before.credit }, before, `${name} leaves client fields, phase, generation and countdown data untouched`);
      const firstDeath = actual;
      deliver(player, 20 + identity, name, level);
      actual = getCredit(player);
      assert.equal(actual, firstDeath, `${name} twin death changes no credit after the unique identity is slain`);
    }

    for (const [name, level] of ORDINARY) {
      const player = makePlayer(`ordinary_${name}`);
      const initialCredit = creditWord({ slain: 0x25, chest: 0 });
      setRun(player, { generation: 40 + ORDINARY.indexOf(ORDINARY.find(row => row[0] === name)), credit: initialCredit });
      const before = creditSnapshot(player);
      const generation = u32(player.getVar(playerVarIds.barrows_generation));
      deliver(player, generation, name, level);
      let actual = getCredit(player);
      assert.equal(actual & KILL_MASK, 0x25, `${name} does not alter brother identity bits`);
      assert.equal(bitField(actual, 6, POTENTIAL_MASK), level, `${name} adds its visible level to potential`);
      assert.equal(bitField(actual, 17, 0x7fff), 1, `${name} increments displayed count`);
      assert.equal(actual & CHEST_BIT, 0, `${name} preserves a clear chest bit`);
      assert.equal(u32(player.getVar(playerVarIds.barrows)), before.client, `${name} preserves unrelated client varp data`);
      assert.equal(u32(player.getVar(playerVarIds.barrows_state)), before.state, `${name} preserves run state and reserved state bits`);
      assert.equal(u32(player.getVar(playerVarIds.barrows_generation)), before.generation, `${name} preserves generation`);
      assert.equal(u32(player.getVar(playerVarIds.barrows_countdowns)), before.countdowns, `${name} preserves saved countdown data`);
      deliver(player, generation, name, level);
      actual = getCredit(player);
      assert.equal(bitField(actual, 6, POTENTIAL_MASK), 2 * level, `${name} ordinary kills always add potential again`);
      assert.equal(bitField(actual, 17, 0x7fff), 2, `${name} ordinary kills always count again`);
      assert.equal(actual & CHEST_BIT, 0, `${name} repeated ordinary credit preserves the clear chest bit`);
    }

    const potentialCapPlayer = makePlayer('potential_cap');
    setRun(potentialCapPlayer, { generation: 61, credit: creditWord({ slain: 0x2d, potential: 995, chest: 1, count: 17 }) });
    deliver(potentialCapPlayer, 61, 'barrows_giantspider', 79);
    assert.equal(bitField(getCredit(potentialCapPlayer), 6, POTENTIAL_MASK), MAX_POTENTIAL, 'potential saturates at 1000 instead of wrapping');
    assert.equal(bitField(getCredit(potentialCapPlayer), 17, 0x7fff), 18, 'potential saturation still increments count');
    assert.equal(getCredit(potentialCapPlayer) & KILL_MASK, 0x2d, 'potential saturation preserves all slain identity bits');
    assert.equal(getCredit(potentialCapPlayer) & CHEST_BIT, CHEST_BIT, 'potential saturation preserves the chest bit');
    deliver(potentialCapPlayer, 61, 'barrows_giantspider', 79);
    assert.equal(bitField(getCredit(potentialCapPlayer), 6, POTENTIAL_MASK), MAX_POTENTIAL, 'potential remains capped on later kills');
    assert.equal(bitField(getCredit(potentialCapPlayer), 17, 0x7fff), 19, 'later eligible kills continue counting at the potential cap');

    const countCapPlayer = makePlayer('count_cap');
    setRun(countCapPlayer, { generation: 62, credit: creditWord({ slain: 0x12, chest: 0, count: MAX_KILLS - 1 }) });
    deliver(countCapPlayer, 62, 'barrows_rat', 43);
    assert.equal(bitField(getCredit(countCapPlayer), 17, 0x7fff), MAX_KILLS, 'displayed count saturates at 32767');
    assert.equal(bitField(getCredit(countCapPlayer), 6, POTENTIAL_MASK), 43, 'count saturation still adds eligible potential');
    assert.equal(getCredit(countCapPlayer) & KILL_MASK, 0x12, 'count saturation preserves slain identity bits');
    assert.equal(getCredit(countCapPlayer) & CHEST_BIT, 0, 'count saturation preserves a clear chest bit');
    deliver(countCapPlayer, 62, 'barrows_rat', 43);
    assert.equal(bitField(getCredit(countCapPlayer), 17, 0x7fff), MAX_KILLS, 'displayed count remains capped on later kills');
    assert.equal(bitField(getCredit(countCapPlayer), 6, POTENTIAL_MASK), 86, 'eligible potential continues increasing after count saturation');

    for (const phase of [0, 2, 3]) {
      const player = makePlayer(`phase_${phase}`);
      const sentinel = creditWord({ slain: 0x2a, potential: 731, chest: 1, count: 1234 });
      setRun(player, { generation: 70 + phase, phase, credit: sentinel });
      deliver(player, 70 + phase, 'barrows_rat', 43);
      assert.equal(getCredit(player), sentinel, `phase ${phase} never receives delivery credit`);
    }
    for (const capturedGeneration of [0, 80]) {
      const player = makePlayer(`generation_${capturedGeneration}`);
      const sentinel = creditWord({ slain: 0x15, potential: 333, chest: 1, count: 99 });
      setRun(player, { generation: 81, phase: 1, credit: sentinel });
      deliver(player, capturedGeneration, 'barrows_rat', 43);
      assert.equal(getCredit(player), sentinel, `captured generation ${capturedGeneration} never receives credit for current generation 81`);
    }
    for (const position of [
      { level: 0, x: 3200, z: 3200, label: 'surface outside map55_151' },
      { level: 3, x: 3200, z: 3200, label: 'tunnel outside map55_151' },
      { level: 2, x: 3556, z: 9714, label: 'unsupported level inside map55_151' }
    ]) {
      const player = makePlayer(`outside_${position.label.replaceAll(' ', '_')}`);
      const sentinel = creditWord({ slain: 0x0b, potential: 552, chest: 1, count: 234 });
      setRun(player, { generation: 91, phase: 1, credit: sentinel, ...position });
      deliver(player, 91, 'barrows_rat', 43);
      assert.equal(getCredit(player), sentinel, `${position.label} never receives credit`);
    }
    for (const level of [0, 3]) {
      const player = makePlayer(`inside_level_${level}`, { level });
      setRun(player, { generation: 100 + level, phase: 1, level, credit: 0 });
      deliver(player, 100 + level, 'barrows_rat', 43);
      assert.equal(bitField(getCredit(player), 6, POTENTIAL_MASK), 43, `phase-one delivery is admitted inside map55_151 on level ${level}`);
      assert.equal(bitField(getCredit(player), 17, 0x7fff), 1, `phase-one inside delivery counts on level ${level}`);
    }

    const ownedOwner = makePlayer('owned_owner');
    const foreignKiller = makePlayer('owned_foreign_killer');
    setRun(ownedOwner, { generation: 121, phase: 1, credit: 0 });
    setRun(foreignKiller, { generation: 122, phase: 1, credit: 0 });
    const foreignOwnedNpc = actor('barrows_rat', 3, ownedOwner.uid);
    seedActor(foreignOwnedNpc, { owner: ownedOwner.uid, generation: 121, aggressor: foreignKiller.uid, hp: 0 });
    foreignOwnedNpc.target = foreignKiller;
    foreignOwnedNpc.heroPoints.addHero(ownedOwner.hash64, 13);
    foreignOwnedNpc.heroPoints.addHero(foreignKiller.hash64, 31);
    const ownedBefore = creditSnapshot(ownedOwner);
    const killerBefore = creditSnapshot(foreignKiller);
    npcProc(foreignOwnedNpc, 'barrows_npc_credit');
    assertNoCreditRequest(ownedOwner, 'owned actor killed by a foreign hero');
    assertNoCreditRequest(foreignKiller, 'owned actor killed by a foreign hero');
    assert.deepEqual(creditSnapshot(ownedOwner), ownedBefore, 'foreign killer receives no owned-actor credit');
    assert.deepEqual(creditSnapshot(foreignKiller), killerBefore, 'owned actor owner receives no foreign-kill credit');

    const lastAggressor = makePlayer('map_last_aggressor', { level: 0 });
    const highestDamageHero = makePlayer('map_highest_damage', { level: 0 });
    setRun(lastAggressor, { generation: 131, phase: 1, level: 0, credit: 0 });
    setRun(highestDamageHero, { generation: 132, phase: 1, level: 0, credit: 0 });
    const mapNpc = actor('barrows_rat', 0, null);
    seedActor(mapNpc, { owner: 0, generation: 0, aggressor: lastAggressor.uid, hp: 0 });
    mapNpc.target = lastAggressor;
    mapNpc.heroPoints.addHero(lastAggressor.hash64, 22);
    mapNpc.heroPoints.addHero(highestDamageHero.hash64, 37);
    assert.equal(mapNpc.heroPoints.findHero(), highestDamageHero.hash64, 'native damage ledger identifies the highest-damage hero');
    const lastAggressorBefore = creditSnapshot(lastAggressor);
    const highestDamageBefore = creditSnapshot(highestDamageHero);
    npcProc(mapNpc, 'barrows_npc_credit');
    assertNoCreditRequest(lastAggressor, 'ordinary map actor uses native killer attribution, not last aggressor');
    const mapEvent = captureCredit(highestDamageHero, 'ordinary map actor');
    assertCaptured(mapEvent, 132, 'barrows_rat', 43, 'ordinary map actor');
    assert.deepEqual(creditSnapshot(lastAggressor), lastAggressorBefore, 'last aggressor receives no map-actor credit');
    assert.deepEqual(creditSnapshot(highestDamageHero), highestDamageBefore, 'map-actor credit waits for its native queue handler');
    replayCredit(highestDamageHero, mapEvent, 'matching-generation map actor');
    assert.equal(bitField(getCredit(highestDamageHero), 6, POTENTIAL_MASK), 43, 'map actor credits the normal highest-damage hero');
    assert.equal(bitField(getCredit(highestDamageHero), 17, 0x7fff), 1, 'map actor increments the normal killer count');
    assert.deepEqual(creditSnapshot(lastAggressor), lastAggressorBefore, 'map actor leaves the last aggressor unchanged');

    const departingOwner = makePlayer('departing_owner');
    setRun(departingOwner, { generation: 141, phase: 1, credit: 0 });
    const departureNpc = actor('barrows_rat', 3, departingOwner.uid);
    seedActor(departureNpc, { owner: departingOwner.uid, generation: 141, aggressor: departingOwner.uid, hp: 0 });
    departureNpc.heroPoints.addHero(departingOwner.hash64, 10);
    npcProc(departureNpc, 'barrows_npc_credit');
    const departureEvent = captureCredit(departingOwner, 'owned actor before owner departure');
    assertCaptured(departureEvent, 141, 'barrows_rat', 43, 'owned actor before owner departure');
    const departureBefore = getCredit(departingOwner);
    departureEvent.unlink();
    departingOwner.level = 0;
    departingOwner.x = 3200;
    departingOwner.z = 3200;
    replayCredit(departingOwner, departureEvent, 'queued owned kill delivered after owner departure');
    assert.equal(getCredit(departingOwner), departureBefore, 'departure before delivery grants no credit');

    const despawnOwner = makePlayer('despawn_owner');
    setRun(despawnOwner, { generation: 151, phase: 1, credit: 0 });
    const despawnNpc = actor('barrows_rat', 3, despawnOwner.uid);
    seedActor(despawnNpc, { owner: despawnOwner.uid, generation: 151, aggressor: despawnOwner.uid, hp: 9 });
    const beforeDespawn = creditSnapshot(despawnOwner);
    procVoid(despawnOwner, 'barrows_remove_owned', [], despawnNpc);
    assert.equal(despawnNpc.isActive, true, 'ordinary door-type cleanup releases rather than removes the living actor');
    assert.equal(despawnNpc.getVar(npcVarIds.npc_barrows_public), 1, 'ordinary cleanup makes public access permanent');
    assertNoCreditRequest(despawnOwner, 'real Barrows actor removal');
    assert.deepEqual(creditSnapshot(despawnOwner), beforeDespawn, 'departure/despawn itself never grants credit');

    const staleOwner = makePlayer('stale_replay_owner');
    const resetGeneration = 161;
    setRun(staleOwner, { generation: resetGeneration, phase: 1, credit: 0 });
    const staleNpc = actor('barrows_rat', 3, staleOwner.uid);
    seedActor(staleNpc, { owner: staleOwner.uid, generation: resetGeneration, aggressor: staleOwner.uid, hp: 0 });
    staleNpc.heroPoints.addHero(staleOwner.hash64, 17);
    npcProc(staleNpc, 'barrows_npc_credit');
    const capturedOldEvent = captureCredit(staleOwner, 'real owned NPC producer');
    assertCaptured(capturedOldEvent, resetGeneration, 'barrows_rat', 43, 'real owned NPC producer');
    capturedOldEvent.unlink();
    const capturedArgs = capturedOldEvent.args.slice();

    staleOwner.setVar(playerVarIds.barrows_state, stateWord({ phase: 2, identity: 1 }));
    procVoid(staleOwner, 'barrows_run_reset', [], staleNpc);
    assert.equal(staleNpc.isActive, true, 'real run reset retains the ordinary actor for its original lifetime');
    assert.equal(staleNpc.getVar(npcVarIds.npc_barrows_public), 1, 'real run reset permanently releases the old actor');
    assert.equal(u32(staleOwner.getVar(playerVarIds.barrows_generation)), resetGeneration + 1, 'reset advances the captured generation');
    assert.equal(procInt(staleOwner, 'barrows_phase'), 0, 'reset leaves the player idle');
    assert.equal(getCredit(staleOwner), 0, 'reset clears credit before replay');
    replayCredit(staleOwner, capturedOldEvent, 'old captured event after reset');
    assert.deepEqual(capturedOldEvent.args, capturedArgs, 'reset replay retained the exact captured generation/type/level payload');
    assert.equal(getCredit(staleOwner), 0, 'actual packed queue handler rejects the old event after reset');

    assert.equal(procInt(staleOwner, 'barrows_run_begin'), 1, 'new run begins after reset');
    assert.equal(u32(staleOwner.getVar(playerVarIds.barrows_generation)), resetGeneration + 2, 'new begin advances beyond the old generation');
    assert.equal(procInt(staleOwner, 'barrows_phase'), 1, 'new run is in the creditable phase');
    assert.equal(getCredit(staleOwner), 0, 'new run starts with zero credit');
    replayCredit(staleOwner, capturedOldEvent, 'old captured event after new begin');
    assert.deepEqual(capturedOldEvent.args, capturedArgs, 'second replay retains the same captured event payload');
    assert.equal(getCredit(staleOwner), 0, 'actual packed queue handler rejects the old event after a new begin');

    const positiveMapNpc = actor('barrows_rat', 3, null);
    seedActor(positiveMapNpc, { owner: 0, generation: 0, aggressor: staleOwner.uid, hp: 0 });
    positiveMapNpc.heroPoints.addHero(staleOwner.hash64, 19);
    npcProc(positiveMapNpc, 'barrows_npc_credit');
    const matchingEvent = captureCredit(staleOwner, 'matching-generation ordinary map kill');
    const newGeneration = u32(staleOwner.getVar(playerVarIds.barrows_generation));
    assertCaptured(matchingEvent, newGeneration, 'barrows_rat', 43, 'matching-generation ordinary map kill');
    replayCredit(staleOwner, matchingEvent, 'matching-generation positive control');
    assert.equal(bitField(getCredit(staleOwner), 6, POTENTIAL_MASK), 43, 'matching-generation queue control adds potential');
    assert.equal(bitField(getCredit(staleOwner), 17, 0x7fff), 1, 'matching-generation queue control increments count');

    for (const regenDue of [false, true]) {
      const label = regenDue ? 'lethal_damage_regen_due' : 'lethal_damage';
      const lethalOwner = makePlayer(label);
      const generation = regenDue ? 169 : 168;
      setRun(lethalOwner, { generation, phase: 1, credit: 0 });
      const lethalNpc = actor('barrows_ahrim', 3, lethalOwner.uid);
      seedActor(lethalNpc, { owner: lethalOwner.uid, generation, aggressor: lethalOwner.uid, hp: 100 });
      lethalNpc.setTimer(1);
      lethalNpc.turn();
      assert.equal(lethalNpc.isActive, true, `${label} survives a normal live actor turn`);
      assert.equal(lethalNpc.regenInterval, NpcType.get(npcTypes.barrows_ahrim).regenrate, `${label} warms the native regeneration interval`);
      lethalNpc.heroPoints.addHero(lethalOwner.hash64, 100);
      if (regenDue) lethalNpc.regenClock = lethalNpc.regenInterval - 1;
      npcProc(lethalNpc, 'npc_default_damage', [100]);
      assert.equal(lethalNpc.levels[hitpointsIndex], 0, `${label} applies real lethal NPC damage`);
      assert(Array.from(lethalNpc.queue.all()).some(request => request.queueId === ServerTriggerType.AI_QUEUE3), `${label} naturally queues the native death trigger`);
      World.currentTick++;
      lethalNpc.turn();
      const hpAfterTurn = lethalNpc.levels[hitpointsIndex];
      assert.equal(hpAfterTurn, regenDue ? 1 : 0, `${label} observes native regeneration before queued death`);
      const lethalEvent = captureCredit(lethalOwner, `${label} (HP ${hpAfterTurn}; regeneration interval ${lethalNpc.regenInterval})`);
      assertCaptured(lethalEvent, generation, 'barrows_ahrim', 98, label);
      let turns = 0;
      while ((lethalNpc.isActive || capturedCreditRequests(lethalOwner).length > 0) && turns < 1024) {
        World.currentTick++;
        lethalOwner.processQueues();
        if (lethalNpc.isActive) lethalNpc.turn();
        turns++;
      }
      assert.equal(lethalNpc.isActive, false, `${label} completes the unchanged normal death`);
      assert.equal(capturedCreditRequests(lethalOwner).length, 0, `${label} delivers its captured event through native player queues`);
      assert.equal(getCredit(lethalOwner), creditWord({ slain: 1, potential: 98, count: 1 }), `${label} credits the natural first Ahrim death exactly once`);
    }

    const noHero = makePlayer('no_hero_aggressor');
    setRun(noHero, { generation: 171, phase: 1, credit: 0 });
    const noHeroNpc = actor('barrows_rat', 3, null);
    seedActor(noHeroNpc, { owner: 0, generation: 0, aggressor: noHero.uid, hp: 0 });
    noHeroNpc.target = noHero;
    assert.equal(noHeroNpc.heroPoints.findHero(), -1n, 'death fixture has an aggressive player but no damage-ledger hero');
    assert.equal(World.getPlayerByHash64(noHero.hash64), noHero, 'aggressive player is registered in native World');
    assert.equal(noHeroNpc.getVar(npcVarIds.npc_aggressive_player), noHero.uid, 'native Slayer fallback has a present aggressive player');
    assert.equal(noHeroNpc.levels[hitpointsIndex], 0, 'death fixture is a genuine native HP-zero NPC');
    const noHeroBefore = creditSnapshot(noHero);
    noHeroNpc.enqueueScript(ServerTriggerType.AI_QUEUE3, 0);
    assert.equal(Array.from(noHeroNpc.queue.all()).length, 1, 'native NPC queue receives the real ai_queue3 trigger');
    noHeroNpc.turn();
    const suspendedDeath = noHeroNpc.activeScript;
    assert(suspendedDeath, 'native ordinary death suspends instead of bypassing its delay');
    assert(suspendedDeath.debugFrames.slice(0, suspendedDeath.debugFp).some(frame => frame.script === aiQueue3.get('barrows_rat')), 'native queue executes the packed barrows_rat ai_queue3 wrapper');
    assert.equal(suspendedDeath.script, ScriptProvider.getByName('[proc,npc_death]'), 'wrapper delegates to the unchanged native death proc before suspension');
    assert.equal(suspendedDeath.execution, ScriptState.NPC_SUSPENDED, 'ordinary death reaches a real NPC script suspension');
    assert.equal(suspendedDeath._activeNpc, noHeroNpc, 'death script retains the primary NPC pointer');
    assert.equal(suspendedDeath._activeNpc2, noHeroNpc, 'barrows_npc_death binds the secondary NPC pointer before ordinary death');
    assert.equal(noHeroNpc.delayed, true, 'native NPC death delay is active at suspension');
    assertNoCreditRequest(noHero, 'dead NPC without a valid damage-ledger hero');

    let resumed = false;
    let turns = 0;
    while (noHeroNpc.isActive && turns < 1024) {
      const active = noHeroNpc.activeScript;
      const pcBefore = active?.pc;
      World.currentTick++;
      noHeroNpc.turn();
      if (active && (active !== noHeroNpc.activeScript || active.execution !== ScriptState.NPC_SUSPENDED || active.pc !== pcBefore)) {
        resumed = true;
      }
      turns++;
    }
    assert(resumed, 'ordinary death resumes its suspended native script');
    assert.equal(noHeroNpc.isActive, false, 'unchanged native ordinary death completes through its normal lifecycle despawn');
    assert.equal(noHeroNpc.activeScript, null, 'completed ordinary death leaves no suspended script');
    assert.deepEqual(creditSnapshot(noHero), noHeroBefore, 'no-hero death gives no Barrows credit');
    assertNoCreditRequest(noHero, 'completed no-hero ordinary death');

    for (const [name, level] of ORDINARY.filter(([name]) => ['barrows_rat', 'barrows_bloodworm', 'barrows_skeleton_unarmed'].includes(name))) {
      for (const outcome of ['owner hero', 'stranger hero', 'offline hero']) {
        const owner = makePlayer(`${name}_${outcome}_a`, { level:0 });
        const finisher = makePlayer(`${name}_${outcome}_b`, { level:0 });
        setRun(owner, { generation:181, phase:1, level:0, credit:0 });
        setRun(finisher, { generation:182, phase:1, level:0, credit:0 });
        const npc = actor(name, 0, owner.uid);
        seedActor(npc, { owner:owner.uid, generation:181, aggressor:finisher.uid, hp:1 });
        npc.setVar(npcVarIds.npc_barrows_public, 1); // Native fixture: an already abandoned door actor.
        npc.heroPoints.addHero(owner.hash64, outcome === 'stranger hero' ? 13 : 31);
        npc.heroPoints.addHero(finisher.hash64, outcome === 'stranger hero' ? 31 : 13);
        npc.heroPoints.addHero(finisher.hash64, 1); // B's real final damage below.
        const hero = outcome === 'stranger hero' ? finisher : owner;
        assert.equal(npc.heroPoints.findHero(), hero.hash64, 'the normal damage ledger selects the highest-damage hero');
        if (outcome === 'offline hero') {
          delete World.players[owner.slot]; owner.unlink(); owner.isActive = false;
          assert.equal(World.getPlayerByHash64(owner.hash64), undefined, 'the original highest-damage hero is genuinely offline');
        }
        const zone = World.gameMap.getZone(npc.x, npc.z, npc.level);
        const tile = runtime.CoordGrid.packZoneCoord(npc.x, npc.z);
        const before = new Set(zone.getObjsUnsafe(tile));
        npcProc(npc, 'npc_default_damage', [1]);
        assert([...npc.queue.all()].some(q => q.queueId === ServerTriggerType.AI_QUEUE3), 'B final damage queues the real death trigger');
        let turns = 0;
        while ((npc.isActive || capturedCreditRequests(owner).length || capturedCreditRequests(finisher).length) && turns < 1024) {
          World.currentTick++;
          if (npc.isActive) npc.turn();
          if (owner.isActive) owner.processQueues();
          finisher.processQueues();
          turns++;
        }
        assert(turns < 1024 && !npc.isActive, `${name}: native death completes for ${outcome}`);
        assert.equal(getCredit(owner), outcome === 'owner hero' ? creditWord({ potential:level, count:1 }) : 0,
          `${name}: A credit follows original ownership and the native hero, not B's lethal damage`);
        assert.equal(getCredit(finisher), 0, `${name}: B never earns Barrows credit for a foreign door actor`);
        const drops = [...zone.getObjsUnsafe(tile)].filter(obj => !before.has(obj) && obj.isActive);
        assert.equal(drops.length, outcome === 'offline hero' ? 0 : 1, `${name}: ${outcome} preserves native drop lookup`);
        if (drops.length) {
          assert.equal(drops[0].type, runtime.ObjType.getId('bones'), 'the configured ordinary default drop remains bones');
          assert.equal(drops[0].count, 1);
          assert.equal(drops[0].receiver64, hero.hash64, 'the ordinary drop belongs to the same native combat hero');
          World.removeObj(drops[0], 0);
        }
        console.log(`PASS BC-02 ${name}: ${outcome}, unchanged native credit and ordinary drop`);
      }
    }

    console.log('PASS S04 packed NPC levels, unique and ordinary credit, native killer/queue attribution, caps, phase/location/generation guards, replay and secondary-pointer death');
  } finally {
    runner.removeFixtures();
    for (const npc of Array.from(World.npcs)) {
      if (npc.isActive) World.removeNpc(npc, -1);
    }
    for (const player of players) {
      delete World.players[player.slot];
      player.unlink();
      player.isActive = false;
    }
  }
});
