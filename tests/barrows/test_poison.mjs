#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRunner, loadPackedRuntime, parseOptions, run } from './packed.mjs';

await run(async () => {
  const runtime = await loadPackedRuntime(parseOptions());
  const { World, NpcType, VarNpcType, VarPlayerType, CoordGrid, allocateIfAbsent } = runtime;
  const { NpcStatMap } = await import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/entity/NpcStat.ts')).href);
  const hp = NpcStatMap.get('HITPOINTS');
  const poison = VarNpcType.getId('npc_poison');
  const owner = VarNpcType.getId('npc_barrows_owner');
  const runner = createRunner(runtime, { prefix: 'barrows_poison' });
  const p = runner.makePlayer('owner', 3, 3556, 9714);
  p.slot = p.pid = p.uid = 1;
  p.isActive = true;
  World.players[p.slot] = p;
  p.setVar(VarPlayerType.getId('barrows_state'), 11);
  p.setVar(VarPlayerType.getId('barrows_generation'), 7);
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) allocateIfAbsent(p.x + dx, p.z + dz, 3);
  const turn = npc => {
    World.currentTick++;
    npc.lastTickX = npc.x;
    npc.lastTickZ = npc.z;
    npc.walkDir = npc.runDir = -1;
    npc.moveSpeed = npc.defaultMoveSpeed();
    npc.turn();
  };
  const freezeRegen = npc => { npc.regenInterval = 100000; npc.regenClock = 0; };
  const selected = process.env.BARROWS_POISON_CASE ?? 'all';
  assert(['all', 'unowned', 'owned'].includes(selected), 'BARROWS_POISON_CASE must be all, unowned or owned');
  try {
    if (selected !== 'owned') {
      for (const name of ['barrows_rat', 'barrows_bloodworm', 'barrows_spider', 'barrows_giantrat', 'barrows_skeleton_unarmed', 'barrows_skeleton_armed', 'barrows_giantspider', 'barrows_ahrim', 'barrows_dharok', 'barrows_guthan', 'barrows_karil', 'barrows_torag', 'barrows_verac', 'goblin']) {
        const npc = runner.addNpc(name, 3, null, 3557, 9714).npc;
        freezeRegen(npc);
        const before = npc.levels[hp];
        runner.procVoid(p, 'npc_poison_start', [20], npc);
        assert.equal(npc.timerInterval, 30, `${name} unowned poison starts the published 30-tick timer`);
        for (let tick = 1; tick <= 30; tick++) {
          turn(npc);
          assert.equal(npc.levels[hp], before - (tick === 30 ? 4 : 0), `${name} published first poison damage at tick ${tick}`);
        }
        assert.equal(npc.getVar(poison), 19, `${name} performs exactly one published countdown`);
        assert.equal(npc.timerInterval, 30, `${name} keeps the default timer interval`);
        if (name === 'barrows_rat') assert.deepEqual([before, npc.levels[hp]], [35, 31], 'base-pack tunnel-rat witness is unchanged');
        World.removeNpc(npc, -1);
      }
    }
    if (selected !== 'unowned') {
      const spawn = () => {
        const handle = runner.procInt(p, 'barrows_actor_spawn', [NpcType.getId('barrows_ahrim'), CoordGrid.packCoord(3, 3557, 9714), 1000]);
        const npc = World.getNpcByUid(handle);
        assert(npc && npc.getVar(owner) === p.uid, 'owned fixture binds the exact native constructor handle');
        freezeRegen(npc);
        return npc;
      };
      const npc = spawn();
      runner.procVoid(p, 'npc_poison_start', [20], npc);
      assert.equal(npc.timerInterval, 1, 'poison start cannot postpone the next owned-actor check');
      let expectedHp = npc.levels[hp];
      let expectedSeverity = 20;
      for (let tick = 1; tick <= 600; tick++) {
        if (tick % 30 === 0) {
          expectedSeverity--;
          if (expectedSeverity > 0) expectedHp -= Math.floor((expectedSeverity + 4) / 5);
        }
        turn(npc);
        assert.equal(npc.getVar(poison), expectedSeverity, `owned published poison countdown on tick ${tick}`);
        assert.equal(npc.levels[hp], expectedHp, `owned published poison damage on tick ${tick}`);
        assert.equal(npc.timerInterval, 1, `ownership timer survives poison on tick ${tick}`);
        assert.equal(npc.isActive, true, 'present owner is a positive survival control');
      }
      assert.equal(npc.getVar(poison), 0, 'poison ends through the published countdown');
      p.x = p.z = 3200;
      turn(npc);
      assert.equal(npc.isActive, false, 'owner leaving after poison ended removes the actor within one tick');
      p.x = 3556; p.z = 9714;
      for (const elapsed of [0, 17, 30]) {
        const poisoned = spawn();
        runner.procVoid(p, 'npc_poison_start', [20], poisoned);
        for (let tick = 0; tick < elapsed; tick++) turn(poisoned);
        const before = p.getVar(VarPlayerType.getId('barrows_kills'));
        p.x = p.z = 3200;
        turn(poisoned);
        assert.equal(poisoned.isActive, false, `owner leaving ${elapsed} ticks after poison start removes actor within one tick`);
        assert.equal(p.getVar(VarPlayerType.getId('barrows_kills')), before, 'poisoned departure grants no death credit');
        p.x = 3556; p.z = 9714;
      }
    }
    console.log(`PASS Barrows poison ${selected}: published tunnel damage, owned cadence and one-tick removal before/after poison ends`);
  } finally {
    runner.removeFixtures();
    for (const npc of Array.from(World.npcs)) if (npc.isActive) World.removeNpc(npc, -1);
    delete World.players[p.slot];
  }
});
