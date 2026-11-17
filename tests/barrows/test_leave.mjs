import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createRunner, loadPackedRuntime, parseEnum, parseOptions, run } from './packed.mjs';

await run(async () => {
  const runtime = await loadPackedRuntime(parseOptions());
  const { World, Player, LocType, NpcType, VarPlayerType, VarNpcType, InvType, ScriptProvider, ScriptRunner, ScriptState, JavaRandom, allocateIfAbsent } = runtime;
  const { default: ServerTriggerType } = await import(pathToFileURL(path.join(runtime.engineRoot, 'src/engine/script/ServerTriggerType.ts')).href);
  const { unzipSync } = createRequire(path.join(runtime.engineRoot, 'package.json'))('fflate');
  const maps = unzipSync(fs.readFileSync(path.join(runtime.packDir, '.cache/maps-server.zip')));
  World.gameMap.zonemap.beginInitialization();
  const square = Object.fromEntries(['m', 'l', 'n', 'o'].map(kind => [kind, maps[`${kind}55_151`] ?? new Uint8Array()]));
  World.gameMap.packed.set((55 << 8) | 151, square);
  World.gameMap.loadPackedMapsquare(square, 55 << 6, 151 << 6);
  World.gameMap.zonemap.endInitialization();
  const chest = World.getLoc(3551, 9695, 0, LocType.getId('barrows_stone_chest'));
  assert(chest, 'S14 original native chest exists');
  const runner = createRunner(runtime, { prefix: 'barrows_leave' });
  const vars = Object.fromEntries(['barrows', 'barrows_kills', 'barrows_state', 'barrows_generation', 'barrows_countdowns'].map(name => [name, VarPlayerType.getId(name)]));
  const npcGeneration = VarNpcType.getId('npc_barrows_generation');
  const inv = InvType.getId('inv');
  const creditQueue = ScriptProvider.getByName('[queue,barrows_credit_kill]');
  const [stairName, destination] = [...parseEnum(runtime.contentRoot, 'barrows_stair_surface_exit')][0];
  const stairId = LocType.getId(stairName);
  const [surfaceLevel, surfaceMapX, surfaceMapZ, surfaceLocalX, surfaceLocalZ] = destination.split('_').map(Number);
  allocateIfAbsent(surfaceMapX * 64 + surfaceLocalX, surfaceMapZ * 64 + surfaceLocalZ, surfaceLevel);
  assert.notEqual(stairId, -1, 'S14 an original crypt stair supplies the real surface-exit proc');
  const players = [];
  const snapshot = p => Object.fromEntries(Object.entries(vars).map(([name, key]) => [name, p.getVar(key) >>> 0]));
  const contents = p => p.getInventory(inv).items.map(item => item ? [item.id, item.count] : null);
  const phase = p => (p.getVar(vars.barrows_state) >>> 3) & 3;
  const selectors = p => ({ corner: (p.getVar(vars.barrows_state) >>> 5) & 3, entrance: (p.getVar(vars.barrows_state) >>> 7) & 3 });
  function random(value, action) {
    const java = JavaRandom.nextDouble, math = Math.random;
    JavaRandom.nextDouble = typeof value === 'function' ? value : () => value;
    Math.random = () => 0.5;
    try { return action(); } finally { JavaRandom.nextDouble = java; Math.random = math; }
  }
  function fixture() {
    const serial = players.length + 1;
    const p = new Player(`barrows_leave_${serial}`, BigInt(serial), 0x1b0000000000000n + BigInt(serial));
    p.slot = p.pid = serial;
    p.uid = (Number(p.username37 & 0x1fffffn) << 11) | serial;
    p.isActive = true; p.lastMovement = 0;
    p.baseLevels.fill(99); p.levels.fill(99);
    [p.level, p.x, p.z] = [0, 3551, 9694];
    p.buildArea.originX = Math.floor(p.x / 8) * 8; p.buildArea.originZ = Math.floor(p.z / 8) * 8;
    p.messages = []; p.packets = [];
    p.write = packet => p.packets.push(packet);
    p.messageGame = message => p.messages.push(message);
    p.wrappedMessageGame = message => p.messages.push(message);
    p.setVar(vars.barrows, 0xe000003f);
    p.setVar(vars.barrows_state, 0xa5a50000);
    World.players[serial] = p;
    World.playerLoop.add(0x78000000n + BigInt(serial), p);
    players.push(p);
    random(0.5, () => assert.equal(runner.procInt(p, 'barrows_run_begin'), 1));
    p.setVar(vars.barrows_kills, 1 | (1 << 16) | (123 << 6) | (3 << 17));
    p.setVar(vars.barrows_state, p.getVar(vars.barrows_state) | (1 << 9));
    return p;
  }
  function search(p) {
    p.target = chest; p.targetOp = ServerTriggerType.OPLOC1 - 7;
    const script = p.getOpTrigger();
    assert.equal(script?.name, '[oploc1,barrows_stone_chest_open]', 'S14 native operation resolves the shown open child');
    const state = ScriptRunner.init(script, p, chest, []);
    p.executeScript(state, true);
    assert.equal(state.execution, ScriptState.FINISHED, 'S14 native Search is one non-suspending invocation');
  }
  function actor(p, name, level, owner = p.uid) {
    const npc = runner.addNpc(name, level, owner, 3554, 9694).npc;
    if (owner !== null) npc.setVar(npcGeneration, p.getVar(vars.barrows_generation));
    return npc;
  }
  function capture(p, npc) {
    npc.heroPoints.addHero(p.hash64, 10);
    const state = ScriptRunner.init(ScriptProvider.getByName('[proc,barrows_npc_credit]'), npc, null, []);
    npc.executeScript(state);
    assert.equal(state.execution, ScriptState.FINISHED, 'S14 the real NPC producer finishes synchronously');
    const requests = [...p.queue.all()].filter(request => request.script === creditQueue);
    assert.equal(requests.length, 1, 'S14 the real producer emits one retained native credit request');
    const request = requests[0];
    request.unlink();
    return request;
  }
  function deliver(p, request) {
    const args = request.args.slice();
    p.queue.addTail(request);
    for (let i = 0; i < 3 && [...p.queue.all()].includes(request); i++) { World.currentTick++; p.processQueues(); }
    assert(![...p.queue.all()].includes(request), 'S14 the native queue actually delivers the captured request');
    assert.deepEqual(request.args, args, 'S14 the captured generation/type/level payload stays unchanged');
    assert.equal(p.protect, false);
  }
  try {
    const paid = fixture();
    random(0.5, () => search(paid));
    assert.equal(phase(paid), 2, 'S14 native Search earns and receives the reward before departure');
    const paidWords = snapshot(paid), paidItems = contents(paid), paidSelectors = selectors(paid);
    assert(paidItems.some(Boolean), 'S14 native payment really adds treasure');
    random(() => { assert.fail('S14 repeat Search before exit may not draw another reward'); }, () => search(paid));
    assert.deepEqual(snapshot(paid), paidWords, 'S14 repeat Search before exit preserves the paid escape run');
    assert.deepEqual(contents(paid), paidItems, 'S14 repeat Search before exit pays nothing');

    const owned = [actor(paid, 'barrows_rat', 0), actor(paid, 'barrows_ahrim', 3)];
    const ordinaryLifetime = owned[0].lifecycleTick;
    const foreign = actor(paid, 'barrows_dharok', 0, paid.uid + 10000);
    const unowned = actor(paid, 'barrows_spider', 0, null);
    const oldKill = capture(paid, owned[0]);
    assert.equal(oldKill.args[0], paidWords.barrows_generation, 'S14 pending kill captures the completed run generation');
    const deletion = [], draws = [];
    const removeNpc = World.removeNpc;
    World.removeNpc = function (npc, duration) {
      if (owned.includes(npc)) deletion.push(snapshot(paid));
      return removeNpc.call(this, npc, duration);
    };
    try {
      random(() => {
        draws.push({
          words: snapshot(paid), actorsGone: !owned[1].isActive, tile: [paid.level, paid.x, paid.z],
          ordinary: [owned[0].isActive, owned[0].isActive && owned[0].getVar(VarNpcType.getId('npc_barrows_released')), owned[0].lifecycleTick]
        });
        return 0.25;
      }, () => runner.procVoid(paid, 'barrows_stair_exit', [stairId]));
    } finally { World.removeNpc = removeNpc; }
    assert.equal(deletion.length, owned.length - 1, 'S14 paid reset removes only the transient brother through World');
    assert.deepEqual([owned[0].isActive, owned[0].isActive && owned[0].getVar(VarNpcType.getId('npc_barrows_released')), owned[0].lifecycleTick],
      [true, 1, ordinaryLifetime], 'S14 paid reset releases the ordinary door actor with its original lifetime');
    for (const words of deletion) assert.deepEqual(words, { ...paidWords, barrows_generation: paidWords.barrows_generation + 1 },
      'S14 paid reset advances the generation and removes actors before clearing or drawing');
    assert.equal(draws.length, 1, 'S14 paid reset makes exactly one idle-layout rank draw');
    assert.equal(draws[0].actorsGone, true, 'S14 idle redraw follows brother removal');
    assert.deepEqual(draws[0].ordinary, [true, 1, ordinaryLifetime], 'S14 idle redraw follows ordinary door actor release with its original lifetime');
    assert.equal(draws[0].words.barrows_kills, 0, 'S14 idle redraw follows credit clearing');
    assert.equal(draws[0].words.barrows_countdowns, 0, 'S14 idle redraw follows both countdown clears');
    assert.equal((draws[0].words.barrows_state >>> 3) & 3, 0, 'S14 idle redraw follows the paid-to-idle transition');
    assert.deepEqual(draws[0].tile, [0, 3551, 9694], 'S14 reset completes before the native stair telejump');
    assert.equal(phase(paid), 0);
    assert.equal(paid.getVar(vars.barrows_generation), paidWords.barrows_generation + 1);
    assert.equal(paid.getVar(vars.barrows_kills), 0);
    assert.equal(paid.getVar(vars.barrows_countdowns), 0);
    assert.deepEqual(selectors(paid), paidSelectors, 'S14 idle layout retains the completed run selectors for the next begin');
    assert.equal(foreign.isActive, true); assert.equal(unowned.isActive, true);
    assert.deepEqual(contents(paid), paidItems, 'S14 the paid reset never removes the granted inventory');
    const [, level, mapX, mapZ, localX, localZ] = destination.match(/^(\d+)_(\d+)_(\d+)_(\d+)_(\d+)$/).map(Number);
    assert.deepEqual([paid.level, paid.x, paid.z], [level, mapX * 64 + localX, mapZ * 64 + localZ], 'S14 original stair reaches its exact surface destination');
    console.log('PASS S14 native Search/repeat and paid stair exit: generation/brother removal and ordinary release before clearing/draw, one idle redraw, preserved reward and selectors, foreign actors untouched');

    const resetWords = snapshot(paid);
    deliver(paid, oldKill);
    assert.deepEqual(snapshot(paid), resetWords, 'S14 old queued kill after paid reset gives no credit');
    random(0.5, () => assert.equal(runner.procInt(paid, 'barrows_run_begin'), 1));
    [paid.level, paid.x, paid.z] = [3, 3556, 9714];
    assert.equal(phase(paid), 1, 'S14 the next begin is in a genuinely creditable crypt');
    assert.equal(paid.getVar(vars.barrows_generation), paidWords.barrows_generation + 2, 'S14 next begin advances beyond the reset generation');
    assert.notEqual(selectors(paid).corner, paidSelectors.corner, 'S14 next begin excludes the completed ladder corner');
    assert.notEqual(selectors(paid).entrance, paidSelectors.entrance, 'S14 next begin excludes the completed central entrance');
    const newWords = snapshot(paid);
    deliver(paid, oldKill);
    assert.deepEqual(snapshot(paid), newWords, 'S14 old queued kill after new begin gives no credit');
    const matching = capture(paid, actor(paid, 'barrows_rat', 3, null));
    assert.equal(matching.args[0], paid.getVar(vars.barrows_generation));
    assert.equal(matching.args[1], NpcType.getId('barrows_rat'));
    deliver(paid, matching);
    assert.equal((paid.getVar(vars.barrows_kills) >>> 6) & 1023, matching.args[2], 'S14 same-generation real producer supplies the positive credit control');
    assert.equal(paid.getVar(vars.barrows_kills) >>> 17, 1);
    assert.deepEqual(contents(paid), paidItems, 'S14 old kills and the next begin cannot claw back earned treasure');
    console.log('PASS S14 the same captured native old kill is rejected after reset and after next begin; a matching-generation producer credits normally');

    const unpaid = fixture();
    unpaid.setVar(vars.barrows_countdowns, (31 << 16) | 17);
    unpaid.setVar(vars.barrows_state, unpaid.getVar(vars.barrows_state) | (1 << 15));
    const unpaidActor = actor(unpaid, 'barrows_bloodworm', 0);
    const unpaidLifetime = unpaidActor.lifecycleTick;
    const beforeUnpaid = snapshot(unpaid), unpaidItems = contents(unpaid);
    random(() => { assert.fail('S14 pre-loot departure must never reset or redraw'); }, () => runner.procVoid(unpaid, 'barrows_stair_exit', [stairId]));
    assert.deepEqual(snapshot(unpaid), { ...beforeUnpaid, barrows_state: (beforeUnpaid.barrows_state & ~(1 << 15)) >>> 0 },
      'S14 pre-loot departure preserves every run field and saved countdown; only the ephemeral challenge closes');
    assert.deepEqual([unpaidActor.isActive, unpaidActor.isActive && unpaidActor.getVar(VarNpcType.getId('npc_barrows_released')), unpaidActor.lifecycleTick],
      [true, 1, unpaidLifetime], 'S14 pre-loot departure releases its ordinary door actor with its original lifetime');
    assert.deepEqual(contents(unpaid), unpaidItems);
    assert.equal(unpaid.timers.size, 0);
    assert.equal(unpaid.packets.filter(packet => packet.constructor.name === 'CamReset').length > 0, true);
    console.log('PASS S14 unpaid stair departure does not run the paid reset: same generation/layout/credit/countdowns, ordinary actor released and presentation closed');
  } finally {
    runner.removeFixtures();
    for (const p of players) {
      p.queue.clear(); p.weakQueue.clear(); p.engineQueue.clear(); p.timers.clear();
      if (World.players[p.slot] === p) delete World.players[p.slot];
      p.unlink(); p.isActive = false;
    }
  }
});
