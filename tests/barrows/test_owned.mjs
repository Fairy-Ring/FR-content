#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRunner, loadPackedRuntime, parseOptions, run } from './packed.mjs';

await run(async () => {
  const runtime = await loadPackedRuntime(parseOptions());
  const { World, Loc, LocType, NpcType, VarPlayerType, VarNpcType, ScriptProvider, ScriptRunner, ScriptState, EntityLifeCycle, NpcMode, allocateIfAbsent, CoordGrid } = runtime;
  const { changeLocCollision, isMapBlocked, isLineOfWalk } = await import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/GameMap.ts')).href);
  const [{ default: ServerTriggerType }, { NpcStatMap }] = await Promise.all([
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/script/ServerTriggerType.ts')).href),
    import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/entity/NpcStat.ts')).href)
  ]);
  const hpIndex = NpcStatMap.get('HITPOINTS');
  assert.notEqual(hpIndex, undefined, 'native hitpoint identity exists');
  for (const name of ['barrows_sarc_search', 'barrows_brother_identity', 'barrows_brother_slain', 'barrows_brother_find', 'barrows_actor_spawn', 'barrows_actor_attackable', 'barrows_actor_tick']) {
    assert(ScriptProvider.getByName(`[proc,${name}]`), `compiled S03 proc missing [proc,${name}]`);
  }
  const runner = createRunner(runtime, { prefix: 'barrows_owned' });
  const { makePlayer, procInt, procVoid, call, addNpc } = runner;
  const vars = Object.fromEntries(['barrows', 'barrows_kills', 'barrows_state', 'barrows_generation', 'barrows_countdowns'].map(name => {
    const id = VarPlayerType.getId(name);
    assert.notEqual(id, -1, `missing player field ${name}`);
    return [name, id];
  }));
  const owner = VarNpcType.getId('npc_barrows_owner');
  const generation = VarNpcType.getId('npc_barrows_generation');
  const combatTarget = VarNpcType.getId('npc_attacking_uid');
  const attackDelay = VarNpcType.getId('npc_action_delay');
  assert.notEqual(attackDelay, -1, 'native combat attack-delay field exists');
  for (const [name, id] of [['owner', owner], ['generation', generation], ['combat target', combatTarget]]) assert.notEqual(id, -1, `missing NPC ${name}`);
  const rows = [
    ['ahrim', 3555, 9698, 0], ['dharok', 3554, 9714, 3], ['guthan', 3538, 9703, 1],
    ['karil', 3550, 9682, 0], ['torag', 3569, 9685, 0], ['verac', 3573, 9705, 0]
  ];
  const actors = () => Array.from(World.npcs).filter(npc => npc.isActive);
  const owned = player => actors().filter(npc => npc.getVar(owner) === player.uid && npc.getVar(generation) > 0);
  const snapshot = player => Object.fromEntries(Object.entries(vars).map(([name, id]) => [name, player.getVar(id) >>> 0]));
  const players = [];
  function player(label, identity = 3, gen = 7) {
    const serial = players.length + 1;
    const p = new runtime.Player(`barrows_owned_${label}_${serial}`, BigInt(serial), 0x100000000000000n + BigInt(serial));
    [p.level, p.x, p.z] = [3, 3556, 9714];
    p.slot = p.pid = serial;
    p.uid = (Number(p.username37 & 0x1fffffn) << 11) | serial;
    p.messages = [];
    p.packets = [];
    p.write = packet => p.packets.push(packet);
    p.messageGame = message => p.messages.push(message);
    p.wrappedMessageGame = message => p.messages.push(message);
    p.isActive = true;
    World.players[p.slot] = p;
    World.playerLoop.add(0x70000000n + BigInt(serial), p);
    assert.equal(World.getPlayerByHash64(p.hash64), p, 'normal killer attribution resolves the registered owner');
    players.push(p);
    p.setVar(vars.barrows_state, 0x12340008 | identity);
    p.setVar(vars.barrows_generation, gen);
    p.setVar(vars.barrows_countdowns, 0x80004321);
    return p;
  }
  function sarc(row) {
    const [name, x, z, angle] = row;
    const id = LocType.getId(`barrow_${name}_sarcophagus`);
    assert.notEqual(id, -1, `missing original ${name} sarcophagus`);
    const type = LocType.get(id);
    // Apply the packed loc's real shape, rotation and clipping. Other terrain is
    // still a live concern; empty allocated tiles are not a placement proof.
    for (let dx = -4; dx <= 6; dx++) for (let dz = -4; dz <= 6; dz++) allocateIfAbsent(x + dx, z + dz, 3);
    const loc = new Loc(3, x, z, type.width, type.length, EntityLifeCycle.RESPAWN, id, 10, angle);
    clipSarc(loc, true);
    return loc;
  }
  const sarcs = rows.map(sarc);
  function clipSarc(loc, add) {
    const type = LocType.get(loc.type);
    changeLocCollision(loc.shape, loc.angle, type.blockrange, type.length, type.width, type.active, loc.x, loc.z, loc.level, add);
  }
  function approach(p, index) {
    const loc = sarcs[index];
    const type = LocType.get(loc.type);
    p.level = loc.level;
    p.x = loc.x + ((loc.angle & 1) === 1 ? type.length : type.width);
    p.z = loc.z;
  }
  function search(p, index = 1) {
    approach(p, index);
    call(p, `[oploc1,barrow_${rows[index][0]}_sarcophagus]`, [], sarcs[index]);
  }
  function tick(npc) {
    const name = NpcType.get(npc.type).debugname;
    const script = ScriptProvider.getByName(`[ai_timer,${name}]`);
    assert(script, `compiled owned-actor timer missing for ${name}`);
    const state = ScriptRunner.init(script, npc);
    npc.executeScript(state);
    assert.equal(state.execution, ScriptState.FINISHED, `${name} owner timer must finish without a suspension or abort`);
  }
  try {
    World.currentTick = 100;
    for (let index = 0; index < rows.length; index++) {
      const name = rows[index][0];
      const identity = index + 1;
      const p = player(name, identity === 6 ? 1 : identity + 1, 100 + identity);
      const bystander = player(`${name}_bystander`);
      approach(bystander, index);
      const type = NpcType.getId(`barrows_${name}`);
      assert.equal(procInt(p, 'barrows_brother_identity', [type]), identity, `${name} consumes its original slain-name join`);
      assert.equal(procInt(p, 'barrows_brother_slain', [identity]), 0, 'fresh identity is uncredited');
      const before = snapshot(p);
      search(p, index);
      const first = owned(p);
      assert.equal(first.length, 1, `real ${name} Search creates one owned encounter`);
      const actor = first[0];
      assert.equal(actor.type, type, `${name} joins to its own brother`);
      assert.equal(actor.getVar(generation), 100 + identity, 'actor captures the run generation');
      assert.equal(actor.sayMessage, 'You dare disturb my rest!', `${name} uses the sourced CANDIDATE 2007-base overhead line`);
      assert.equal(actor.targetOp, NpcMode.OPPLAYER2, `${name} starts the published player-attack mode without a scripted delay`);
      assert.equal(actor.target, p, `${name} targets its searching owner at spawn`);
      assert.notEqual(actor.target, bystander, `${name} does not target the second player on the owner's tile`);
      assert.equal(actor.timerInterval, 1, 'spawn arms the one-tick native ownership timer');
      const distanceFromOwner = Math.max(Math.abs(actor.x - p.x), Math.abs(actor.z - p.z));
      assert(distanceFromOwner >= 1 && distanceFromOwner <= 2, 'spawn stays in the configured open ring around the searching owner');
      assert.equal(actor.level, 3, 'crypt actor stays on the crypt level');
      assert.equal(isMapBlocked(p.x, p.z, p.level), false, `${name} owner has a legal approach square`);
      assert.equal(isMapBlocked(sarcs[index].x, sarcs[index].z, 3), true, `${name} sarcophagus anchor is clipped`);
      assert.equal(isMapBlocked(actor.x, actor.z, actor.level), false, `${name} does not spawn in the clipped sarcophagus`);
      assert.equal(isLineOfWalk(3, actor.x, actor.z, p.x, p.z), true, `${name} spawn can approach its searching owner`);
      for (let turn = 0; turn < 3 && actor.getVar(attackDelay) <= World.currentTick; turn++) {
        World.currentTick++;
        // Normal World turn preparation after the spawn's INSTANT frame.
        actor.lastTickX = actor.x;
        actor.lastTickZ = actor.z;
        actor.moveSpeed = actor.defaultMoveSpeed();
        actor.walkDir = -1;
        actor.runDir = -1;
        actor.turn();
      }
      assert(actor.getVar(attackDelay) > World.currentTick, `${name} native turns begin ordinary combat without owner retaliation`);
      assert.deepEqual(snapshot(p), before, 'Search itself grants no credit or run mutation');
      search(p, index);
      assert.deepEqual(owned(p), [actor], 'same owner and generation cannot duplicate a living resident');
      World.removeNpc(actor, -1);
      p.setVar(vars.barrows_kills, 1 << index);
      assert.equal(procInt(p, 'barrows_brother_slain', [identity]), 1, 'original identity bit is read');
      search(p, index);
      assert.equal(owned(p).length, 0, 'credited resident does not respawn');
      p.setVar(vars.barrows_kills, 0);
      p.setVar(vars.barrows_state, 0x12340008 | identity);
      approach(p, index);
      const selected = ScriptRunner.init(ScriptProvider.getByName(`[oploc1,barrow_${name}_sarcophagus]`), p, sarcs[index]);
      p.executeScript(selected, true, true);
      assert.equal(selected.execution, ScriptState.PAUSEBUTTON, 'selected tunnel crypt opens the existing Continue prompt');
      assert.equal(owned(p).length, 0, 'selected tunnel crypt has no resident');
      p.closeModal();
      assert.equal(p.activeScript, null, 'cancelling the selected prompt releases its script');
      p.setVar(vars.barrows_state, 0x12340010 | (identity === 6 ? 1 : identity + 1));
      search(p, index);
      assert.equal(owned(p).length, 0, 'paid Search never creates a crypt encounter');
    }
    // Player hits normally enter AI_QUEUE2. This packed witness starts at its
    // real lethal damage, then uses the one owner-interaction window before
    // the genuine AI_QUEUE3 and owner-credit queues run.
    for (let index = 0; index < rows.length; index++) {
      const identity = index + 1;
      const p = player(`pending_${identity}`, identity === 6 ? 1 : identity + 1, 400 + identity);
      approach(p, index);
      const resident = addNpc(`barrows_${rows[index][0]}`, 3, p.uid, p.x, p.z + 1).npc;
      resident.setVar(generation, p.getVar(vars.barrows_generation));
      resident.levels[hpIndex] = 1;
      resident.heroPoints.addHero(p.hash64, 1);
      const hit = ScriptRunner.init(ScriptProvider.getByName('[proc,npc_default_damage]'), resident, null, [1]);
      resident.executeScript(hit);
      assert.equal(hit.execution, ScriptState.FINISHED, 'compiled ordinary lethal damage completes');
      assert.equal(resident.levels[hpIndex], 0, 'real lethal damage leaves the resident at zero HP');
      assert(Array.from(resident.queue.all()).some(request => request.queueId === ServerTriggerType.AI_QUEUE3), 'real death request is pending');
      assert.equal(procInt(p, 'barrows_brother_slain', [identity]), 0, 'the lethal hit has not yet credited');
      const before = snapshot(p);
      const beforeActors = actors();
      search(p, index);
      assert.deepEqual(actors(), beforeActors, `S03 repair: crypt ${identity} pending death suppresses a duplicate`);
      assert.deepEqual(snapshot(p), before, 'the pending-death Search grants and mutates nothing');
      let turns = 0;
      while ((resident.isActive || Array.from(p.queue.all()).length) && turns < 12) {
        World.currentTick++;
        if (resident.isActive) resident.turn();
        p.processQueues();
        turns++;
      }
      assert(turns < 12, 'ordinary death and owner credit finish within the fixture bound');
      assert.equal(resident.isActive, false, 'ordinary death removes the original resident');
      assert.equal(procInt(p, 'barrows_brother_slain', [identity]), 1, 'only the original death credits the identity');
      assert.equal(p.getVar(vars.barrows_kills) >>> 17, 1, 'exactly one displayed kill is earned');
      assert.equal((p.getVar(vars.barrows_kills) >>> 6) & 1023, NpcType.get(resident.type).vislevel, 'exactly one brother level is earned');
      for (const negative of ['foreign', 'stale']) {
        p.setVar(vars.barrows_kills, 0);
        const dead = addNpc(`barrows_${rows[index][0]}`, 3, negative === 'foreign' ? players[0].uid : p.uid, p.x, p.z + 1).npc;
        dead.setVar(generation, p.getVar(vars.barrows_generation) - (negative === 'stale' ? 1 : 0));
        dead.levels[hpIndex] = 0;
        const old = new Set(actors());
        search(p, index);
        const spawned = actors().filter(npc => !old.has(npc));
        assert.equal(spawned.length, 1, `${negative} zero-HP crypt actor does not suppress this owner/current run`);
        assert.equal(spawned[0].getVar(owner), p.uid);
        assert.equal(spawned[0].getVar(generation), p.getVar(vars.barrows_generation));
        World.removeNpc(spawned[0], -1);
        World.removeNpc(dead, -1);
      }
      console.log(`PASS S03 pending death: crypt identity=${identity}, native death/credit turns=${turns}, foreign/stale controls`);
    }
    const enclosed = player('enclosed_ring', 3, 777);
    approach(enclosed, 1);
    const clippedRing = [];
    try {
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        const x = enclosed.x + dx;
        const z = enclosed.z + dz;
        if ((dx === 0 && dz === 0) || isMapBlocked(x, z, 3)) continue;
        changeLocCollision(10, 0, false, 1, 1, 0, x, z, 3, true);
        clippedRing.push({ x, z });
      }
      assert.equal(isMapBlocked(enclosed.x, enclosed.z, 3), false, 'sealed-ring owner is a legal origin control');
      search(enclosed);
      assert.equal(owned(enclosed).length, 0, 'no eligible square does not spawn on the returned owner-origin sentinel');
    } finally {
      for (const { x, z } of clippedRing) changeLocCollision(10, 0, false, 1, 1, 0, x, z, 3, false);
    }
    search(enclosed);
    assert.equal(owned(enclosed).length, 1, 'restored open ring is a positive spawn control');
    World.removeNpc(owned(enclosed)[0], -1);
    assert.equal(procInt(players[0], 'barrows_brother_identity', [NpcType.getId('barrows_rat')]), 0, 'ordinary monster has no brother identity');
    for (const identity of [-1, 0, 7]) assert.equal(procInt(players[0], 'barrows_brother_slain', [identity]), 0, 'invalid identity cannot read another bit');

    const a = player('owner_a', 3, 44);
    const b = player('owner_b', 3, 44);
    search(a);
    const actorA = owned(a)[0];
    assert(actorA, 'A has a positive resident control');
    actorA.setVar(combatTarget, b.uid); // mutable combat targeting is not ownership.
    for (const guard of ['npc_is_attackable', 'npc_is_attackable_opt']) {
      assert.equal(procInt(b, guard, [], actorA), 0, `${guard} rejects B on A's actor`);
      assert.equal(procInt(a, guard, [], actorA), 1, `${guard} still admits the owner despite a different combat target`);
    }
    assert(b.messages.includes('Someone else is fighting that.'), 'owner exclusion reuses the existing refusal');
    search(b);
    const actorB = owned(b)[0];
    assert(actorB && actorB !== actorA, 'B Search is not globally suppressed by A');
    assert.equal(actors().length, 2, 'two searching owners have two independent residents');
    const beforeLogout = snapshot(a);
    procVoid(a, 'barrows_logout');
    assert.equal(actorA.isActive, false, 'logout removes only A live actor');
    assert.equal(actorB.isActive, true, 'B actor is a positive survival control');
    assert.deepEqual(snapshot(a), beforeLogout, 'logout retains the uncredited run and countdowns');
    search(a);
    const retryA = owned(a)[0];
    assert(retryA && retryA !== actorA, 'natural Search retries the uncredited actor');
    assert.equal(owned(b)[0], actorB, 'retry does not replace B actor');
    const mapActor = addNpc('barrows_rat', 3, null, 3555, 9714).npc;
    mapActor.setVar(combatTarget, a.uid);
    procVoid(a, 'barrows_remove_owned');
    assert.equal(retryA.isActive, false, 'leave removes the private owner actor');
    assert.equal(mapActor.isActive, true, 'a map monster targeting A is not an owned summon');
    assert.equal(actorB.isActive, true, 'foreign owner survives cleanup');
    for (const guard of ['npc_is_attackable', 'npc_is_attackable_opt']) assert.equal(procInt(b, guard, [], mapActor), 1, 'ordinary map attribution keeps normal attackability');

    const tile = CoordGrid.packCoord(3, 3555, 9714);
    const handle = procInt(a, 'barrows_actor_spawn', [NpcType.getId('barrows_dharok'), tile, 1000]);
    const stale = World.getNpcByUid(handle);
    assert(stale, 'constructor returns a handle resolving to the spawned actor');
    assert.equal(stale.type, NpcType.getId('barrows_dharok'), 'returned handle identifies the requested NPC type');
    assert.equal(stale.getVar(owner), a.uid, 'returned handle identifies the searching owner actor');
    assert.equal(stale.getVar(generation), 44, 'returned handle carries the current run generation');
    assert(stale, 'current generation can spawn before the stale-generation control');
    a.setVar(vars.barrows_generation, 45);
    assert.equal(procInt(a, 'barrows_brother_find', [stale.type]), 0, 'old generation never suppresses the current encounter');
    for (const guard of ['npc_is_attackable', 'npc_is_attackable_opt']) assert.equal(procInt(a, guard, [], stale), 0, 'stale owned actor cannot be claimed even by its former owner');
    const staleBefore = snapshot(a);
    tick(stale);
    assert.equal(stale.isActive, false, 'owner timer removes a generation mismatch');
    assert.deepEqual(snapshot(a), staleBefore, 'generation cleanup grants no credit');
    tick(actorB);
    assert.equal(actorB.isActive, true, 'matching present owner is a positive timer control');
    b.x = b.z = 3200;
    tick(actorB);
    assert.equal(actorB.isActive, false, 'owner departure cleans its actor');
    b.x = 3556; b.z = 9714;
    assert.notEqual(procInt(b, 'barrows_actor_spawn', [NpcType.getId('barrows_dharok'), tile, 1000]), -1, 'present owner receives an actor handle');
    const offline = owned(b)[0];
    assert(offline, 'present owner can spawn before the logout control');
    delete World.players[b.slot];
    tick(offline);
    assert.equal(offline.isActive, false, 'owner disappearance removes its actor');
    World.players[b.slot] = b;
    const noSpawnBefore = actors().length;
    a.setVar(vars.barrows_state, 0);
    assert.equal(procInt(a, 'barrows_actor_spawn', [NpcType.getId('barrows_dharok'), tile, 1000]), -1, 'idle constructor returns no actor handle');
    assert.equal(actors().length, noSpawnBefore, 'idle state cannot construct a run actor');
    console.log('PASS S03 six compiled Searches, sourced spawn text, immediate owner targeting, attack gates and cleanup/retry');
  } finally {
    for (const loc of sarcs) clipSarc(loc, false);
    for (const npc of Array.from(World.npcs)) if (npc.isActive) World.removeNpc(npc, -1);
    for (const p of players) {
      delete World.players[p.slot];
      p.unlink();
      p.isActive = false;
    }
  }
});
