#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRunner, loadPackedRuntime, parseOptions, run } from './packed.mjs';

await run(async () => {
  const runtime = await loadPackedRuntime(parseOptions());
  const { World, NpcType, VarNpcType, VarPlayerType, ScriptProvider, ScriptRunner, ScriptState, CoordGrid, allocateIfAbsent } = runtime;
  const runner = createRunner(runtime, { prefix: 'barrows_hint' });
  const players = [];
  const vars = Object.fromEntries(['barrows_state', 'barrows_generation'].map(name => [name, VarPlayerType.getId(name)]));
  const owner = VarNpcType.getId('npc_barrows_owner');
  const playerZone = World.gameMap.getZone(3556, 9714, 3);
  const make = label => {
    const p = runner.makePlayer(label, 3, 3556, 9714);
    p.slot = p.pid = p.uid = players.length + 1;
    p.isActive = true;
    p.setVar(vars.barrows_state, 11);
    p.setVar(vars.barrows_generation, 44);
    World.players[p.slot] = p;
    playerZone.enter(p);
    players.push(p);
    return p;
  };
  const hints = p => p.packets.filter(packet => packet.constructor.name === 'HintArrow');
  const npcScript = (npc, name) => {
    const script = ScriptProvider.getByName(name);
    assert(script, `missing packed hint lifecycle script ${name}`);
    const state = ScriptRunner.init(script, npc);
    npc.executeScript(state);
    assert.notEqual(state.execution, ScriptState.ABORTED, `${name} must not abort`);
    return state;
  };
  const a = make('a');
  const b = make('b');
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) allocateIfAbsent(a.x + dx, a.z + dz, 3);
  const spawn = (p, name = 'barrows_ahrim') => {
    p.packets.length = 0;
    const other = p === a ? b : a;
    other.packets.length = 0;
    const handle = runner.procInt(p, 'barrows_actor_spawn', [NpcType.getId(name), CoordGrid.packCoord(3, 3557, 9714), 1000]);
    const actor = Array.from(World.npcs).find(npc => npc.isActive && npc.getVar(owner) === p.uid);
    assert(actor && handle !== -1, 'real constructor supplies a living owned actor');
    assert.deepEqual(hints(p).map(({ type, nid }) => ({ type, nid })), [{ type: 1, nid: actor.nid }], 'spawn sends the NPC hint packet only to the owner');
    assert.equal(hints(other).length, 0, 'spawn sends no hint to the second player');
    p.packets.length = 0;
    return actor;
  };
  const cleared = (p, label) => {
    const other = p === a ? b : a;
    assert(hints(p).some(packet => packet.type === -1), `${label} clears the owner hint`);
    assert.equal(hints(other).length, 0, `${label} sends no clear to another player`);
  };
  try {
    for (const name of ['barrows_ahrim', 'barrows_dharok', 'barrows_guthan', 'barrows_karil', 'barrows_torag', 'barrows_verac']) {
      const actor = spawn(a, name);
      runner.procVoid(a, 'barrows_remove_owned');
      assert.equal(actor.isActive, false, `${name} product removal deletes the actor`);
      cleared(a, `${name} removal`);
    }
    const dying = spawn(a);
    npcScript(dying, '[ai_queue3,barrows_ahrim]');
    cleared(a, 'ordinary brother death');
    assert.equal(hints(b).length, 0, 'death never clears another owner hint');
    World.removeNpc(dying, -1);

    const departing = spawn(a);
    a.x = a.z = 3200;
    npcScript(departing, '[ai_timer,barrows_ahrim]');
    assert.equal(departing.isActive, false, 'owner-timer departure removes the actor');
    cleared(a, 'owner-timer departure');
    a.x = 3556; a.z = 9714;

    const logoutActor = spawn(a);
    runner.procVoid(a, 'barrows_logout');
    assert.equal(logoutActor.isActive, false, 'logout removes the owned brother');
    cleared(a, 'logout');
    a.packets.length = b.packets.length = 0;
    runner.procVoid(a, 'barrows_logout');
    cleared(a, 'logout with no surviving actor');

    a.packets.length = b.packets.length = 0;
    runner.procInt(a, 'barrows_actor_spawn', [NpcType.getId('barrows_rat'), CoordGrid.packCoord(3, 3557, 9714), 1000]);
    assert.equal(hints(a).length, 0, 'ordinary owned tunnel monster has no brother hint');
    assert.equal(hints(b).length, 0, 'ordinary monster never sets a second player hint');
    console.log('PASS Barrows owner-only NPC hint packets for six brothers, death, removal, timer departure and logout');
  } finally {
    for (const npc of Array.from(World.npcs)) if (npc.isActive) World.removeNpc(npc, -1);
    for (const p of players) {
      playerZone.leave(p);
      delete World.players[p.slot];
    }
  }
});
