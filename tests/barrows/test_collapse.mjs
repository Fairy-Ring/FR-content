import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createRunner, loadPackedRuntime, parseOptions, run } from './packed.mjs';

await run(async () => {
  const runtime = await loadPackedRuntime(parseOptions());
  const { World, Player, LocType, VarPlayerType, VarNpcType, InvType, ObjType,
    ScriptProvider, ScriptRunner, ScriptState, JavaRandom } = runtime;
  const eng = relative => import(pathToFileURL(path.join(runtime.engineRoot, relative)).href);
  const { PlayerTimerType } = await eng('src/engine/entity/EntityTimer.ts');
  const { PlayerStat } = await eng('src/engine/entity/PlayerStat.ts');
  const { default: ServerTriggerType } = await eng('src/engine/script/ServerTriggerType.ts');
  const { unzipSync } = createRequire(path.join(runtime.engineRoot, 'package.json'))('fflate');
  const maps = unzipSync(fs.readFileSync(path.join(runtime.packDir, '.cache/maps-server.zip')));
  World.gameMap.zonemap.beginInitialization();
  for (const [x, z] of [[55, 151], [50, 50]]) {
    const square = Object.fromEntries(['m', 'l', 'n', 'o'].map(kind => [kind, maps[`${kind}${x}_${z}`] ?? new Uint8Array()]));
    World.gameMap.packed.set((x << 8) | z, square);
    World.gameMap.loadPackedMapsquare(square, x << 6, z << 6);
  }
  World.gameMap.zonemap.endInitialization();
  const chest = World.getLoc(3551, 9695, 0, LocType.getId('barrows_stone_chest'));
  assert(chest, 'the original chest supplies native Open and Search dispatch');
  const runner = createRunner(runtime, { prefix: 'barrows_collapse' });
  const vars = Object.fromEntries(['barrows', 'barrows_kills', 'barrows_state', 'barrows_generation', 'barrows_countdowns'].map(name => [name, VarPlayerType.getId(name)]));
  const inv = InvType.getId('inv');
  const worn = InvType.getId('worn');
  const players = [];
  function fixture(phase = 1) {
    const serial = players.length + 1;
    const p = new Player(`barrows_collapse_${serial}`, BigInt(serial), 0x1a0000000000000n + BigInt(serial));
    p.slot = p.pid = serial;
    p.uid = (Number(p.username37 & 0x1fffffn) << 11) | serial;
    p.isActive = true;
    p.lastMovement = 0;
    p.baseLevels.fill(99); p.levels.fill(99);
    [p.level, p.x, p.z] = [0, 3551, 9694];
    p.buildArea.originX = Math.floor(p.x / 8) * 8;
    p.buildArea.originZ = Math.floor(p.z / 8) * 8;
    p.messages = []; p.packets = [];
    p.write = packet => p.packets.push(packet);
    p.messageGame = text => p.messages.push(text);
    p.wrappedMessageGame = text => p.messages.push(text);
    p.getInventory(worn);
    p.setVar(vars.barrows, 0xd2345678);
    p.setVar(vars.barrows_state, 1 | (phase << 3) | (1 << 5) | (2 << 7) | (1 << 9));
    p.setVar(vars.barrows_kills, (11 << 17) | (1 << 16) | (1000 << 6) | 1);
    p.setVar(vars.barrows_generation, 71);
    p.setVar(vars.barrows_countdowns, 37);
    World.players[serial] = p;
    World.playerLoop.add(0x77000000n + BigInt(serial), p);
    players.push(p);
    return p;
  }
  const words = p => Object.fromEntries(Object.entries(vars).map(([name, key]) => [name, p.getVar(key) >>> 0]));
  const low = p => p.getVar(vars.barrows_countdowns) & 65535;
  const high = p => p.getVar(vars.barrows_countdowns) >>> 16;
  const camera = p => p.packets.filter(packet => ['CamShake', 'CamReset'].includes(packet.constructor.name));
  function withRandom(value, action) {
    const java = JavaRandom.nextDouble;
    const random = Math.random;
    JavaRandom.nextDouble = typeof value === 'function' ? value : () => value;
    Math.random = () => 0.5;
    try { return action(); } finally { JavaRandom.nextDouble = java; Math.random = random; }
  }
  function useChest(p) {
    p.target = chest; p.targetOp = ServerTriggerType.OPLOC1 - 7;
    const trigger = p.getOpTrigger();
    assert(trigger, 'the original shown chest has its native first option');
    const state = ScriptRunner.init(trigger, p, chest, []);
    p.executeScript(state, true);
    assert.equal(state.execution, ScriptState.FINISHED, 'native chest operation must not suspend');
    return trigger.name;
  }
  function finish(p, state) {
    for (let i = 0; state.execution === ScriptState.SUSPENDED && i < 20; i++) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false; state.execution = ScriptState.RUNNING;
      p.executeScript(state, true, true);
    }
    assert.equal(state.execution, ScriptState.FINISHED, 'native login/death completes its ordinary delays');
    assert.equal(p.activeScript, null);
  }
  function login(p) {
    const state = ScriptRunner.init(ScriptProvider.getByName('[login,_]'), p, null, []);
    withRandom(0.5, () => { p.executeScript(state, true); finish(p, state); });
  }
  function flush(p) {
    for (let i = 0; i < 3; i++) { World.currentTick++; p.processQueues(); }
  }
  const first = fixture();
  withRandom(0.5, () => assert.equal(useChest(first), '[oploc1,barrows_stone_chest_open]'));
  assert(high(first) > 0, 'S13 valid native Search must arm the saved collapse countdown');

  const config = fs.readFileSync(path.join(runtime.contentRoot, 'scripts/minigames/game_barrows/configs/barrows.constant'), 'utf8');
  const constant = name => {
    const match = config.match(new RegExp(`^\\^barrows_${name}\\s*=\\s*(\\d+)\\s*$`, 'm'));
    assert(match, `S13 named config constant barrows_${name}`);
    return Number(match[1]);
  };
  const interval = constant('collapse_interval_ticks');
  const chance = constant('collapse_chance_denominator');
  const minHit = constant('collapse_min_hit');
  const maxHit = constant('collapse_max_hit');
  assert.match(config, /^\^barrows_collapse_hit_distribution\s*=\s*"uniform_inclusive"\s*$/m);
  assert(interval > 0 && interval <= constant('countdown_max'));
  const expectedShake = { axis: constant('collapse_shake_axis'), random: constant('collapse_shake_random'), amplitude: constant('collapse_shake_amplitude'), rate: constant('collapse_shake_rate') };
  const timer = ScriptProvider.getByName('[timer,barrows_timer_tick]');
  const queuedHits = p => [...p.queue.all()].filter(request => request.script.name === '[queue,barrows_collapse_hit]');
  const tick = p => { World.currentTick++; p.processTimers(PlayerTimerType.NORMAL); };
  const pay = p => withRandom(0.5, () => runner.procInt(p, 'barrows_search_latch', [p.getVar(vars.barrows_generation)]));
  function assertShake(p, label) {
    const last = camera(p).at(-1);
    assert.equal(last?.constructor.name, 'CamShake', `${label}: shake survives the last shared camera reset`);
    assert.deepEqual(Object.fromEntries(Object.keys(expectedShake).map(key => [key, last[key]])), expectedShake);
  }
  try {
    assert.equal(high(first), interval, 'S13 Search initializes the configured full interval');
    assert.equal(low(first), 37, 'S13 arming preserves the independent Prayer half');
    assert.equal(first.timers.get(timer.id)?.type, PlayerTimerType.NORMAL);
    assert.equal(first.timers.get(timer.id)?.interval, 1, 'S13 one repeating tick, never the remainder');
    assertShake(first, 'S13 successful Search');
    tick(first);
    const repeat = words(first);
    withRandom(() => { assert.fail('S13 repeat Search draws no random value'); }, () => useChest(first));
    assert.deepEqual(words(first), repeat, 'S13 repeat Search neither rearms nor restarts either counter');
    assert.equal(high(first), interval - 1);

    const unopened = fixture();
    unopened.setVar(vars.barrows_kills, unopened.getVar(vars.barrows_kills) & ~(1 << 16));
    withRandom(0.5, () => assert.equal(useChest(unopened), '[oploc1,barrows_stone_chest_closed]'));
    assert.equal(high(unopened), 0, 'S13 native Open does not arm collapse');
    unopened.setVar(vars.barrows_state, unopened.getVar(vars.barrows_state) & ~(1 << 9));
    const refused = words(unopened);
    withRandom(() => { assert.fail('S13 failed Search draws no reward'); }, () => useChest(unopened));
    assert.deepEqual(words(unopened), refused, 'S13 failed Search does not arm or restart collapse');
    console.log('PASS S13 native Open/refusal/repeat do not arm or restart; successful protected Search arms one saved NORMAL timer and shake');

    const countdown = fixture(); pay(countdown);
    runner.procVoid(countdown, 'barrows_prayer_set', [constant('countdown_max')]);
    const prayerBefore = low(countdown);
    countdown.protect = true;
    World.currentTick += interval;
    countdown.processTimers(PlayerTimerType.NORMAL);
    assert.equal(high(countdown), interval, 'S13 ordinary busy-player gating consumes no saved collapse tick');
    countdown.protect = false;
    for (let elapsed = 1; elapsed < interval; elapsed++) {
      tick(countdown);
      assert.equal(high(countdown), interval - elapsed, `S13 saved high-half callback ${elapsed}`);
      assert.equal(low(countdown), prayerBefore - elapsed, 'S13 high-half writes preserve Prayer decrements');
      assert.equal(queuedHits(countdown).length, 0, 'S13 no early hit');
    }
    const draws = [0, 0.999999];
    withRandom(() => { assert(draws.length, 'S13 only chance and uniform amount draws occur at due time'); return draws.shift(); }, () => tick(countdown));
    assert.equal(draws.length, 0);
    assert.equal(high(countdown), interval, 'S13 due event reloads its named interval in that callback');
    assert.equal(low(countdown), prayerBefore - interval);
    assert.deepEqual(queuedHits(countdown).map(request => request.args), [[countdown.getVar(vars.barrows_generation), maxHit]]);
    withRandom(0.5, () => flush(countdown));
    assert.equal(countdown.levels[PlayerStat.HITPOINTS], 99 - maxHit, 'S13 native guarded queue delivers the upper inclusive amount');
    runner.procVoid(countdown, 'barrows_collapse_set', [1]);
    withRandom(1 / chance, () => tick(countdown));
    assert.equal(queuedHits(countdown).length, 0, 'S13 the complement of the named chance delivers no hit');
    assert.equal(high(countdown), interval);
    for (let bucket = 0; bucket < maxHit - minHit + 1; bucket++) {
      runner.procVoid(countdown, 'barrows_collapse_set', [1]);
      const random = [0, (bucket + 0.5) / (maxHit - minHit + 1)];
      withRandom(() => random.shift(), () => tick(countdown));
      assert.deepEqual(queuedHits(countdown).map(request => request.args), [[countdown.getVar(vars.barrows_generation), minHit + bucket]], 'S13 every uniform inclusive amount rank maps independently');
      countdown.queue.clear();
    }
    const wrongPhase = fixture();
    runner.procVoid(wrongPhase, 'barrows_collapse_set', [1]);
    runner.procVoid(wrongPhase, 'barrows_timer_resume');
    tick(wrongPhase);
    assert.equal(high(wrongPhase), 1, 'S13 unpaid callbacks never consume the collapse half');
    assert.equal(queuedHits(wrongPhase).length, 0);
    const crypt = fixture(); pay(crypt); crypt.level = 3;
    const cryptBefore = high(crypt); tick(crypt);
    assert.equal(high(crypt), cryptBefore, 'S13 paid crypt callbacks do not consume tunnel-collapse ticks');
    assert.equal(queuedHits(crypt).length, 0);
    console.log('PASS S13 exact saved countdown, independent halves, native busy NORMAL access, named chance and every uniform inclusive hit rank, paid/tunnel gates');

    const effect = p => ({ levels: [...p.levels], energy: p.runenergy, special: p.getVar(VarPlayerType.getId('sa_energy')), hit: [p.hitmarkSlot, p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type, p.masks], packets: [...p.packets], death: [...p.queue.all()].filter(request => request.script.name === '[queue,player_death_default]').map(request => request.args) });
    for (let amount = minHit; amount <= maxHit; amount++) {
      for (const hp of [99, amount]) {
        const ordinary = fixture(2), collapse = fixture(2);
        for (const p of [ordinary, collapse]) {
          p.levels[PlayerStat.HITPOINTS] = hp; p.runenergy = 6000;
          p.setVar(VarPlayerType.getId('sa_energy'), 700);
          p.packets.length = 0;
        }
        withRandom(0.5, () => runner.call(ordinary, '[queue,damage_player]', [amount]));
        withRandom(0.5, () => runner.call(collapse, '[queue,barrows_collapse_hit]', [collapse.getVar(vars.barrows_generation), amount]));
        assert.deepEqual(effect(collapse), effect(ordinary), `S13 ordinary damage_player body equality: amount ${amount}, HP ${hp}`);
        assert.equal(collapse.hitmarkDamage, amount, 'S13 the ordinary hitsplat is retained');
        assert.equal(collapse.levels[PlayerStat.HITPOINTS], hp - amount);
        assert.equal(effect(collapse).death.length, hp === amount ? 1 : 0, 'S13 zero hitpoints queues the ordinary lethal path without a floor');
      }
    }
    for (const scenario of ['old-generation', 'unpaid', 'idle', 'outside', 'crypt']) {
      const p = fixture(2);
      const generation = p.getVar(vars.barrows_generation);
      if (scenario === 'old-generation') p.setVar(vars.barrows_generation, generation + 1);
      if (scenario === 'unpaid' || scenario === 'idle') p.setVar(vars.barrows_state, (p.getVar(vars.barrows_state) & ~24) | (scenario === 'unpaid' ? 8 : 0));
      if (scenario === 'outside') [p.x, p.z] = [3565, 3289];
      if (scenario === 'crypt') p.level = 3;
      const before = effect(p);
      runner.call(p, '[queue,barrows_collapse_hit]', [generation, minHit]);
      assert.deepEqual(effect(p), before, `S13 stale ${scenario} delivery has no hitsplat, HP, stat, energy, sound or death effect`);
    }
    const departed = fixture(); pay(departed);
    runner.procVoid(departed, 'barrows_collapse_set', [1]);
    withRandom(0, () => tick(departed));
    assert.equal(queuedHits(departed).length, 1);
    withRandom(0.5, () => runner.procVoid(departed, 'barrows_leave'));
    [departed.x, departed.z] = [3565, 3289];
    const afterDeparture = effect(departed);
    withRandom(() => { assert.fail('S13 stale queued hit may not draw even a hit sound'); }, () => flush(departed));
    assert.deepEqual(effect(departed), afterDeparture, 'S13 a genuinely queued hit delivers nothing after paid departure');
    assert.equal(departed.timers.has(timer.id), false);
    assert.equal(camera(departed).at(-1)?.constructor.name, 'CamReset');
    console.log('PASS S13 exact ordinary damage_player equivalence including hitsplats and death at zero; every delivery guard and native queued-after-departure cancellation');

    const savedPlayer = fixture(); pay(savedPlayer);
    runner.procVoid(savedPlayer, 'barrows_collapse_set', [interval - 2]);
    runner.procVoid(savedPlayer, 'barrows_prayer_set', [constant('prayer_interval_ticks') - 1]);
    const saved = words(savedPlayer);
    runner.procVoid(savedPlayer, 'barrows_logout');
    assert.deepEqual(words(savedPlayer), saved, 'S13 clean logout preserves both saved counters and the paid escape run');
    assert.equal(savedPlayer.timers.has(timer.id), false);
    assert.equal(camera(savedPlayer).at(-1)?.constructor.name, 'CamReset');
    const relog = fixture();
    for (const [name, value] of Object.entries(saved)) relog.setVar(vars[name], value);
    World.currentTick += interval * 3;
    login(relog);
    assert.deepEqual(words(relog), saved, 'S13 real shared login consumes no offline tick and restores exact paid state');
    assertShake(relog, 'S13 paid-inside login');
    assert.equal(relog.timers.get(timer.id)?.interval, 1);
    tick(relog);
    assert.equal(high(relog), (saved.barrows_countdowns >>> 16) - 1, 'S13 relog resumes the stored remainder, not a fresh full interval');
    const outside = fixture();
    for (const [name, value] of Object.entries(saved)) outside.setVar(vars[name], value);
    [outside.x, outside.z] = [3565, 3289];
    login(outside);
    assert.equal((outside.getVar(vars.barrows_state) >>> 3) & 3, 0);
    assert.equal(outside.getVar(vars.barrows_countdowns), 0);
    assert.equal(outside.timers.has(timer.id), false);
    assert.equal(camera(outside).some(packet => packet.constructor.name === 'CamShake'), false, 'S13 paid outside login cannot shake or arm');
    console.log('PASS S13 actual shared login/clean logout: no offline consumption, exact paid-inside remainder/shake after the final reset, paid-outside reset without shake');

    const originalAddObj = World.addObj;
    let floor = [];
    World.addObj = function (obj, owner, duration) {
      floor.push([obj.type, obj.count, String(owner), duration, obj.level, obj.x, obj.z]);
      return originalAddObj.call(this, obj, owner, duration);
    };
    try {
      function death(phase) {
        const p = fixture(phase);
        if (phase === 0) for (const key of Object.values(vars)) p.setVar(key, 0);
        p.levels[PlayerStat.HITPOINTS] = minHit;
        p.runenergy = 6000;
        for (const name of ['abyssal_whip', 'dragon_scimitar', 'rune_platebody', 'spade', 'bronze_dagger']) p.invAdd(inv, ObjType.getId(name), 1);
        p.invAdd(worn, ObjType.getId('bronze_med_helm'), 1);
        const before = words(p);
        const owned = runner.addNpc('barrows_guthan', 0, p.uid, 3554, 9694).npc;
        owned.setVar(VarNpcType.getId('npc_barrows_generation'), p.getVar(vars.barrows_generation) || 1);
        const foreign = runner.addNpc('barrows_guthan', 0, p.uid + 10000, 3554, 9693).npc;
        foreign.setVar(VarNpcType.getId('npc_barrows_generation'), 1);
        floor = [];
        withRandom(0.5, () => phase === 2
          ? runner.call(p, '[queue,barrows_collapse_hit]', [p.getVar(vars.barrows_generation), minHit])
          : runner.call(p, '[queue,damage_player]', [minHit]));
        assert.equal(p.levels[PlayerStat.HITPOINTS], 0);
        assert([...p.queue.all()].some(request => request.script.name === '[queue,player_death_default]'));
        withRandom(0.5, () => {
          for (let ticks = 0; !p.activeScript && ticks < 3; ticks++) { World.currentTick++; p.processQueues(); }
        });
        const state = p.activeScript;
        assert(state && state.execution === ScriptState.SUSPENDED, 'S13 native ordinary death reaches its first ordinary delay');
        assert.equal(floor.length, 0, 'S13 cleanup occurs before ordinary delayed keep/drop allocation');
        if (phase === 0) {
          assert.deepEqual(words(p), before, 'S13 no-Barrows death leaves every run field inert');
          assert.equal(owned.isActive, true, 'S13 the death hook is inert without an eligible Barrows run');
        }
        if (phase !== 0) {
          assert.equal(owned.isActive, false, 'S13 D9 owned actor removal precedes the first death delay');
          assert.equal(p.timers.has(timer.id), false);
          assert.equal(camera(p).at(-1)?.constructor.name, 'CamReset', 'S13 D9 presentation stops before the first death delay');
        }
        assert.equal(foreign.isActive, true, 'S13 D9 preserves every foreign actor');
        if (phase === 1) assert.deepEqual(words(p), before, 'S13 D9 pre-loot ordinary death preserves every run field and both counters');
        if (phase === 2) {
          assert.equal((p.getVar(vars.barrows_state) >>> 3) & 3, 0, 'S13 D9 paid ordinary death uses the protected idle reset before delay');
          assert.equal(p.getVar(vars.barrows_generation), before.barrows_generation + 1);
          assert.equal(p.getVar(vars.barrows_kills), 0);
          assert.equal(p.getVar(vars.barrows_countdowns), 0);
          assert.equal((p.getVar(vars.barrows_state) >>> 5) & 15, (before.barrows_state >>> 5) & 15, 'S13 D9 paid reset retains the old escape selectors until the next Dig');
        }
        withRandom(0.5, () => finish(p, state));
        const result = { tile: [p.level, p.x, p.z], levels: [...p.levels], energy: p.runenergy,
          kept: p.getInventory(inv).items.filter(Boolean).map(item => [item.id, item.count]).sort((a, b) => a[0] - b[0]),
          worn: p.getInventory(worn).items.filter(Boolean), floor: [...floor].sort((a, b) => a[0] - b[0]) };
        assert.equal(result.kept.length, 3, 'S13 ordinary unskulled keep-three allocation, not special Barrows protection');
        assert(result.floor.some(row => row[0] === ObjType.getId('bones')));
        assert(result.floor.every(row => row[4] === 0 && row[5] === 3551 && row[6] === 9694), 'S13 ordinary shared death-tile drops, never a recovery destination');
        assert.equal(p.level, 0); assert(p.x >= 3219 && p.x <= 3223 && p.z >= 3216 && p.z <= 3220, 'S13 normal Lumbridge map_findsquare respawn');
        for (const npc of [owned, foreign]) if (npc.isActive) World.removeNpc(npc, -1);
        return result;
      }
      const ordinary = death(0);
      assert.deepEqual(death(1), ordinary, 'S13 pre-loot death has exactly ordinary drops, lifetimes, kept items, restored stats/energy and respawn');
      assert.deepEqual(death(2), ordinary, 'S13 paid death has exactly ordinary drops, lifetimes, kept items, restored stats/energy and respawn');
      console.log('PASS S13 native lethal ordinary death: D9 cleanup before first delay, pre-loot whole-run preservation, paid reset, unchanged ordinary keep/drop/lifetime/respawn');
    } finally { World.addObj = originalAddObj; }
  } finally {
    runner.removeFixtures();
    for (const p of players) {
      p.queue.clear(); p.weakQueue.clear(); p.engineQueue.clear(); p.timers.clear();
      if (World.players[p.slot] === p) delete World.players[p.slot];
      p.unlink(); p.isActive = false;
    }
  }
});
