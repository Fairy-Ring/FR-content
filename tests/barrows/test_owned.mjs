#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRunner, loadPackedRuntime, parseOptions, run } from './packed.mjs';

await run(async () => {
  const runtime = await loadPackedRuntime(parseOptions());
  const { World, Loc, LocType, NpcType, VarPlayerType, VarNpcType, ScriptProvider, ScriptRunner, ScriptState, EntityLifeCycle, NpcMode, allocateIfAbsent, CoordGrid } = runtime;
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
    const p = makePlayer(label, 3, 3556, 9714);
    p.slot = p.pid = p.uid = players.length + 1;
    p.isActive = true;
    World.players[p.slot] = p;
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
    // This transport-free fixture allocates only the placement search radius.
    // Natural live Search supplies the actual terrain/walkability proof.
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) allocateIfAbsent(x + dx, z + dz, 3);
    return new Loc(3, x, z, type.width, type.length, EntityLifeCycle.RESPAWN, id, 10, angle);
  }
  const sarcs = rows.map(sarc);
  function search(p, index = 1) {
    const row = rows[index];
    p.level = 3;
    p.x = row[1] + 2;
    p.z = row[2];
    call(p, `[oploc1,barrow_${row[0]}_sarcophagus]`, [], sarcs[index]);
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
    for (let index = 0; index < rows.length; index++) {
      const name = rows[index][0];
      const identity = index + 1;
      const p = player(name, identity === 6 ? 1 : identity + 1, 100 + identity);
      const bystander = player(`${name}_bystander`);
      bystander.x = rows[index][1] + 2;
      bystander.z = rows[index][2];
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
      assert(Math.max(Math.abs(actor.x - rows[index][1]), Math.abs(actor.z - rows[index][2])) <= 2, 'spawn stays within the configured crypt radius');
      assert.equal(actor.level, 3, 'crypt actor stays on the crypt level');
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
      search(p, index);
      assert.equal(owned(p).length, 0, 'selected tunnel crypt has no resident before S05');
      p.setVar(vars.barrows_state, 0x12340010 | (identity === 6 ? 1 : identity + 1));
      search(p, index);
      assert.equal(owned(p).length, 0, 'paid Search never creates a crypt encounter');
    }
    assert.equal(procInt(players[0], 'barrows_brother_identity', [NpcType.getId('barrows_rat')]), 0, 'ordinary monster has no brother identity');
    for (const identity of [-1, 0, 7]) assert.equal(procInt(players[0], 'barrows_brother_slain', [identity]), 0, 'invalid identity cannot read another bit');

    const a = player('owner_a', 3, 44);
    const b = player('owner_b', 3, 55);
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
    assert.notEqual(procInt(a, 'barrows_actor_spawn', [NpcType.getId('barrows_dharok'), tile, 1000]), -1, 'constructor returns the native actor handle');
    const stale = owned(a)[0];
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
    for (const npc of Array.from(World.npcs)) if (npc.isActive) World.removeNpc(npc, -1);
    for (const p of players) delete World.players[p.slot];
  }
});
