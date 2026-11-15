#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createRunner, loadPackedRuntime, parseEnum, parseOptions, run } from './packed.mjs';

await run(async () => {
  const runtime = await loadPackedRuntime(parseOptions());
  const { World, Player, LocType, NpcType, VarPlayerType, VarBitType, VarNpcType, InvType, ObjType, ScriptProvider,
    ScriptRunner, ScriptState, CoordGrid } = runtime;
  const eng = relative => import(pathToFileURL(path.join(runtime.engineRoot, relative)).href);
  const [{ default: ServerTriggerType }, { default: Packet }, { PlayerLoading }, { ScriptOpcode },
    { default: VarSharedType }] = await Promise.all([
    eng('src/engine/script/ServerTriggerType.ts'), eng('src/io/Packet.ts'),
    eng('src/engine/entity/PlayerLoading.ts'), eng('src/engine/script/ScriptOpcode.ts'), eng('src/cache/config/VarSharedType.ts')
  ]);
  VarSharedType.load(runtime.packDir);
  World.vars = new Int32Array(VarSharedType.count);
  const { unzipSync } = createRequire(path.join(runtime.engineRoot, 'package.json'))('fflate');
  const maps = unzipSync(fs.readFileSync(path.join(runtime.packDir, '.cache/maps-server.zip')));
  World.gameMap.zonemap.beginInitialization();
  const square = Object.fromEntries(['m', 'l', 'n', 'o'].map(kind => [kind, maps[`${kind}55_151`] ?? new Uint8Array()]));
  World.gameMap.packed.set((55 << 8) | 151, square);
  World.gameMap.loadPackedMapsquare(square, 55 << 6, 151 << 6);
  World.gameMap.zonemap.endInitialization();

  const constants = new Map([...fs.readFileSync(path.join(runtime.contentRoot,
    'scripts/minigames/game_barrows/configs/barrows.constant'), 'utf8').matchAll(/^\^([a-z0-9_]+)\s*=\s*(-?\d+)\s*$/gm)]
    .map(([, name, value]) => [name, Number(value)]));
  const c = name => { assert(constants.has(name), `named Barrows constant ${name}`); return constants.get(name); };
  const vars = Object.fromEntries(['barrows', 'barrows_kills', 'barrows_state', 'barrows_generation', 'barrows_countdowns']
    .map(name => [name, VarPlayerType.getId(name)]));
  for (const [name, id] of Object.entries(vars)) assert.notEqual(id, -1, `packed lifecycle var ${name}`);
  const ownerVar = VarNpcType.getId('npc_barrows_owner');
  const generationVar = VarNpcType.getId('npc_barrows_generation');
  const timer = ScriptProvider.getByName('[timer,barrows_timer_tick]');
  assert(timer, 'compiled one-tick Barrows timer');
  const runner = createRunner(runtime, { prefix: 'barrows_lifecycle' });
  const players = [];
  const inv = InvType.getId('inv');
  const worn = InvType.getId('worn');
  const words = p => Object.fromEntries(Object.entries(vars).map(([name, id]) => [name, p.getVar(id) >>> 0]));
  const range = (word, name) => ((word >>> 0) >>> c(`barrows_${name}_start`))
    & (2 ** (c(`barrows_${name}_end`) - c(`barrows_${name}_start`) + 1) - 1);
  const brotherCount = p => {
    let mask = range(p.getVar(vars.barrows_kills), 'slain');
    let count = 0;
    while (mask) { mask &= mask - 1; count++; }
    return count;
  };
  const inventory = p => [...p.invs].map(([id, container]) => [id, Array.from({ length: container.capacity }, (_, slot) => {
    const item = container.get(slot);
    return item ? [item.id, item.count] : null;
  })]).sort(([a], [b]) => a - b);
  const loopKey = p => 0x7a000000n + BigInt(p.slot);
  function wire(p) {
    p.messages = []; p.packets = [];
    p.write = packet => p.packets.push(packet);
    p.messageGame = message => p.messages.push(message);
    p.wrappedMessageGame = message => p.messages.push(message);
    p.getInventory(worn);
    p.getInventory(inv);
  }
  function register(p) {
    p.isActive = true;
    World.players[p.slot] = p;
    World.playerLoop.add(loopKey(p), p);
    players.push(p);
    return p;
  }
  function makePlayer(label, level = 3, x = 3556, z = 9714) {
    const serial = players.length + 1;
    const p = new Player(`barrows_lifecycle_${label}`, BigInt(serial), 0x1b0000000000000n + BigInt(serial));
    p.slot = p.pid = serial;
    p.uid = (Number(p.username37 & 0x1fffffn) << 11) | serial;
    p.baseLevels.fill(99); p.levels.fill(99);
    p.lastMovement = 0;
    wire(p);
    register(p);
    p.teleport(x, z, level);
    return p;
  }
  function unregister(p) {
    if (World.players[p.slot] === p) delete World.players[p.slot];
    if (p.isActive) p.unlink();
    p.isActive = false;
  }
  function restore(source, saved) {
    const p = PlayerLoading.load(source.username, new Packet(saved), null);
    p.slot = source.slot; p.pid = source.pid; p.uid = source.uid;
    wire(p);
    return register(p);
  }
  function lifecycle(p, name) {
    const type = name === 'login' ? ServerTriggerType.LOGIN : ServerTriggerType.LOGOUT;
    const script = ScriptProvider.getByTriggerSpecific(type, -1, -1);
    assert.equal(script?.name, `[${name},_]`, `native shared ${name} trigger lookup`);
    const state = ScriptRunner.init(script, p);
    assert.equal(p.runScript(state, true), ScriptState.FINISHED, `native shared ${name} completes`);
    assert.equal(state.execution, ScriptState.FINISHED);
    assert.equal(p.activeScript, null);
    assert.equal(p.protect, false);
    assert.equal(p.delayed, false);
  }
  function noBarrowsRandom(label, action) {
    const original = ScriptRunner.HANDLERS[ScriptOpcode.RANDOM];
    const calls = [];
    ScriptRunner.HANDLERS[ScriptOpcode.RANDOM] = state => {
      if (/^\[[^,]+,barrows_/.test(state.script.name)) calls.push(state.script.name);
      original(state);
    };
    try {
      const result = action();
      assert.deepEqual(calls, [], `${label}: no Barrows identity, topology, encounter or reward draw`);
      return result;
    } finally { ScriptRunner.HANDLERS[ScriptOpcode.RANDOM] = original; }
  }
  function spawn(p, typeName, x, z) {
    const handle = runner.procInt(p, 'barrows_actor_spawn', [NpcType.getId(typeName),
      CoordGrid.packCoord(p.level, x, z), c('barrows_crypt_summon_lifetime')]);
    const actor = World.getNpcByUid(handle);
    assert(actor?.isActive, 'real constructor supplies a living crypt actor');
    assert.equal(actor.getVar(ownerVar), p.uid);
    assert.equal(actor.getVar(generationVar), p.getVar(vars.barrows_generation));
    return actor;
  }
  function begin(p) {
    assert.equal(runner.procInt(p, 'barrows_run_begin'), 1);
    runner.procVoid(p, 'barrows_prayer_set', [c('barrows_prayer_interval_ticks') - 2]);
    runner.procVoid(p, 'barrows_resume');
    assert.equal(p.timers.get(timer.id)?.interval, 1, 'native presentation starts one repeating tick');
  }

  const chest = World.getLoc(3551, 9695, 0, LocType.getId('barrows_stone_chest'));
  assert(chest, 'the actual original map chest is loaded for lifecycle dispatch');
  const chestParent = LocType.get(chest.baseType);
  const displayedChest = p => LocType.get(chestParent.multiloc[p.getVarBit(chestParent.multivarbit)]);
  function nativeChest(p, expected, label) {
    p.target = chest;
    p.targetOp = ServerTriggerType.OPLOC1 - 7;
    const script = p.getOpTrigger();
    assert.equal(script?.name, `[oploc1,barrows_stone_chest_${expected}]`, `${label}: native dispatch selects the real shown child`);
    const state = ScriptRunner.init(script, p, chest, []);
    p.executeScript(state, true);
    assert.equal(state.execution, ScriptState.FINISHED, `${label}: the real chest operation completes synchronously`);
    assert.equal(p.activeScript, null, `${label}: no queued continuation`);
    assert.equal(p.delayed, false, `${label}: no delay`);
    assert.equal(state.activeLoc, chest, `${label}: the original native map parent stays active`);
  }

  try {
    const a = makePlayer('crypt');
    const b = makePlayer('control');
    begin(a); begin(b);
    const earnedType = NpcType.getId('barrows_ahrim');
    const earnedLevel = runner.procInt(a, 'barrows_npc_level', [earnedType]);
    runner.procVoid(a, 'barrows_credit', [a.getVar(vars.barrows_generation), earnedType, earnedLevel]);
    assert.equal(brotherCount(a), 1, 'S15 positive control has one earned brother');
    assert.equal(range(a.getVar(vars.barrows_kills), 'count'), 1, 'S15 positive control has one displayed kill');
    a.invAdd(inv, ObjType.getId('spade'), 1);
    const actor = spawn(a, 'barrows_dharok', 3557, 9714);
    const control = spawn(b, 'barrows_dharok', 3555, 9714);
    const mapActor = runner.addNpc('barrows_rat', 3, null, 3556, 9716).npc;
    const savedWords = words(a);
    const savedInventory = inventory(a);
    const controlWords = words(b);
    const tile = [a.level, a.x, a.z];
    a.packets.length = b.packets.length = 0;
    noBarrowsRandom('S15 clean crypt logout', () => lifecycle(a, 'logout'));
    assert.equal(actor.isActive, false, 'S15 shared crypt logout removes the live owned brother');
    assert.equal(control.isActive, true, 'S15 shared crypt logout keeps the foreign-owner live brother');
    assert.equal(mapActor.isActive, true, 'S15 ordinary unowned map actor survives');
    assert.deepEqual(words(a), savedWords, 'S15 crypt logout preserves every durable word, including whole earned credit');
    assert.deepEqual(inventory(a), savedInventory, 'S15 crypt logout grants no item');
    assert.deepEqual(words(b), controlWords, 'S15 control owner has no durable mutation');
    assert.equal(a.timers.has(timer.id), false, 'S15 crypt logout stops the runtime timer');
    assert(a.packets.some(packet => packet.constructor.name === 'HintArrow' && packet.type === -1), 'S15 logout clears the owner hint');
    assert.equal(b.packets.length, 0, 'S15 foreign owner receives no cleanup packet');
    assert(![...a.queue.all()].some(request => request.script.name === '[queue,barrows_credit_kill]'), 'S15 actor removal queues no kill credit');
    const saved = a.save();
    unregister(a);
    World.currentTick += c('barrows_prayer_interval_ticks') * 4;
    const relog = restore(a, saved);
    assert.deepEqual(words(relog), savedWords, 'S15 native save/load retains every durable word offline');
    noBarrowsRandom('S15 shared crypt login', () => lifecycle(relog, 'login'));
    assert.deepEqual(words(relog), savedWords, 'S15 shared crypt login restores exact identity, phase, generation, layout, credit and remainder');
    assert.deepEqual([relog.level, relog.x, relog.z], tile, 'S15 clean relog retains the same crypt');
    assert.deepEqual(inventory(relog), savedInventory, 'S15 clean relog pays nothing');
    assert.equal(brotherCount(relog), 1, 'S15 B remains one, not the removed live brother');
    assert.equal(relog.timers.get(timer.id)?.interval, 1, 'S15 shared login rebuilds the one-tick presentation timer');
    assert.equal(actor.isActive, false, 'S15 login cannot resurrect a session-only actor');
    assert.equal(control.isActive, true, 'S15 foreign actor remains the positive survival control after login');
    const retry = spawn(relog, 'barrows_dharok', 3557, 9714);
    assert.notEqual(retry, actor, 'S15 uncredited actor can be recreated in the same preserved run');
    assert.deepEqual(words(relog), savedWords, 'S15 actor recreation cannot credit its own removal');
    console.log('PASS S15 native shared crypt logout/save/load/login: exact durable words and earned B=1, actor-only cleanup, foreign/map controls, no RNG or payment, exact saved remainder and retry');

    const tunnel = makePlayer('tunnel');
    begin(tunnel);
    for (const name of ['barrows_ahrim', 'barrows_dharok', 'barrows_rat']) {
      const type = NpcType.getId(name);
      runner.procVoid(tunnel, 'barrows_credit', [tunnel.getVar(vars.barrows_generation), type,
        runner.procInt(tunnel, 'barrows_npc_level', [type])]);
    }
    assert.equal(brotherCount(tunnel), 2, 'S16 tunnel fixture has genuine proc-earned partial B=2');
    assert.equal(range(tunnel.getVar(vars.barrows_kills), 'count'), 3, 'S16 count includes a credited ordinary monster');
    const corner = runner.procInt(tunnel, 'barrows_ladder_corner');
    const identity = runner.procInt(tunnel, 'barrows_tunnel_identity');
    const ladderVars = 'acgi'.split('').map(letter => VarBitType.getId(`barrows_chamber_${letter}`));
    assert(ladderVars.every(id => id >= 0), 'S16 all four original ladder varbits are packed');
    const expectedLadder = ladderVars.map((_, index) => Number(index === corner));
    assert.deepEqual(ladderVars.map(id => tunnel.getVarBit(id)), expectedLadder, 'S16 selected corner has exactly one original visible ladder');
    const doorVars = 'abcdefghijklmnop'.split('').map(letter => VarBitType.getId(`barrows_door_${letter}`));
    assert(doorVars.every(id => id >= 0), 'S16 all sixteen original lock varbits are packed');
    const lockBits = doorVars.map(id => tunnel.getVarBit(id));
    assert(lockBits.some(Boolean) && lockBits.some(bit => !bit), 'S16 positive layout control has both locked and open original doors');
    assert.equal(runner.procInt(tunnel, 'barrows_tunnel_enter', [tunnel.getVar(vars.barrows_generation), identity,
      CoordGrid.packCoord(tunnel.level, tunnel.x, tunnel.z)]), 1, 'S16 native selected-tunnel descent accepts its captured run');
    const landingText = parseEnum(runtime.contentRoot, 'barrows_ladder_landing').get(String(corner));
    assert(landingText, 'S16 original landing enum supplies the selected corner coordinate');
    const [landingLevel, landingMapX, landingMapZ, landingX, landingZ] = landingText.split('_').map(Number);
    const landing = [landingLevel, landingMapX * 64 + landingX, landingMapZ * 64 + landingZ];
    assert.deepEqual([tunnel.level, tunnel.x, tunnel.z], landing, 'S16 real descent reaches the original selected ladder landing');
    const ladderParent = LocType.get(LocType.getId(`barrows_ladder_${'acgi'[corner]}`));
    assert(ladderParent, 'S16 selected original ladder parent is packed');
    const visibleLadder = p => LocType.get(ladderParent.multiloc[p.getVarBit(ladderParent.multivarbit)]);
    assert(visibleLadder(tunnel).op.includes('Climb-up'), 'S16 native ladder selector exposes its Climb-up child');
    assert.equal(brotherCount(tunnel), 2, 'S16 descent preserves the independently earned B=2');
    assert.equal(range(tunnel.getVar(vars.barrows_kills), 'count'), 3, 'S16 descent preserves the independently earned count=3');
    const tunnelWords = words(tunnel), tunnelItems = inventory(tunnel), cryptControlWords = words(b);
    noBarrowsRandom('S16 clean pre-loot tunnel logout', () => lifecycle(tunnel, 'logout'));
    assert.deepEqual(words(tunnel), tunnelWords, 'S16 tunnel logout preserves exact topology, corner, count, identity, generation and remainder');
    assert.deepEqual(words(b), cryptControlWords, 'S16 other crypt owner is unchanged by tunnel logout');
    assert.equal(control.isActive, true, 'S16 tunnel logout cannot remove the crypt control owner actor');
    const tunnelSave = tunnel.save();
    unregister(tunnel);
    World.currentTick += c('barrows_prayer_interval_ticks') * 4;
    const tunnelRelog = restore(tunnel, tunnelSave);
    noBarrowsRandom('S16 shared pre-loot tunnel login', () => lifecycle(tunnelRelog, 'login'));
    assert.deepEqual(words(tunnelRelog), tunnelWords, 'S16 tunnel native save/load/login retains every durable word without offline consumption');
    assert.equal(brotherCount(tunnelRelog), 2, 'S16 relog preserves the independently earned B=2');
    assert.equal(range(tunnelRelog.getVar(vars.barrows_kills), 'count'), 3, 'S16 relog preserves the independently earned count=3');
    assert.deepEqual([tunnelRelog.level, tunnelRelog.x, tunnelRelog.z], landing, 'S16 tunnel relog restores the exact selected ladder landing');
    assert.deepEqual(ladderVars.map(id => tunnelRelog.getVarBit(id)), expectedLadder, 'S16 tunnel relog restores the exact original ladder selector');
    assert.deepEqual(doorVars.map(id => tunnelRelog.getVarBit(id)), lockBits, 'S16 tunnel relog restores all sixteen original locks');
    assert(visibleLadder(tunnelRelog).op.includes('Climb-up'), 'S16 relog still resolves the real visible Climb-up child');
    assert.deepEqual(inventory(tunnelRelog), tunnelItems, 'S16 pre-loot tunnel relog grants nothing');
    noBarrowsRandom('S16 no-reset ladder departure control', () => {
      assert.equal(runner.procInt(tunnelRelog, 'barrows_tunnel_exit'), 1);
      assert.equal(tunnelRelog.level, 3, 'S16 original ladder returns to a crypt');
      assert.deepEqual(words(tunnelRelog), tunnelWords, 'S16 pre-loot real ladder departure cannot reset the saved run');
      assert.equal(runner.procInt(tunnelRelog, 'barrows_tunnel_enter', [tunnelRelog.getVar(vars.barrows_generation), identity,
        CoordGrid.packCoord(tunnelRelog.level, tunnelRelog.x, tunnelRelog.z)]), 1);
    });
    assert.deepEqual(words(tunnelRelog), tunnelWords, 'S16 natural return preserves the exact unfinished topology/count/remainders');
    assert.deepEqual([tunnelRelog.level, tunnelRelog.x, tunnelRelog.z], landing, 'S16 natural return uses the same stored corner');
    console.log('PASS S16 native selected-tunnel descent/shared logout/save/load/login and ladder/return control: exact topology, original corner/locks, B=2/count=3, all durable words, remainder, no new RNG or payment');

    const identities = ['ahrim', 'dharok', 'guthan', 'karil', 'torag', 'verac'];
    for (let killed = 0; killed < c('barrows_identity_count'); killed++) {
      const label = `S17 partial B=${killed}`;
      const opened = makePlayer(`open_${killed}`);
      begin(opened);
      for (const name of identities.slice(0, killed)) {
        const type = NpcType.getId(`barrows_${name}`);
        runner.procVoid(opened, 'barrows_credit', [opened.getVar(vars.barrows_generation), type,
          runner.procInt(opened, 'barrows_npc_level', [type])]);
      }
      opened.teleport(3551, 9694, 0);
      opened.setVar(vars.barrows_state, opened.getVar(vars.barrows_state) | (1 << c('barrows_solved_bit')));
      assert.equal(brotherCount(opened), killed, `${label}: independently proc-earned brother count`);
      const closedWords = words(opened), closedItems = inventory(opened);
      assert.equal(displayedChest(opened).op[0], 'Open', `${label}: starts with the real closed child`);
      noBarrowsRandom(`${label} closed Search gate`, () => {
        assert.equal(runner.procInt(opened, 'barrows_chest_search_allowed', [opened.getVar(vars.barrows_generation)]), 0);
        runner.procVoid(opened, 'barrows_chest_search', [chest.baseType, CoordGrid.packCoord(chest.level, chest.x, chest.z)]);
      });
      assert.deepEqual(words(opened), closedWords, `${label}: Search before Open changes no durable word`);
      assert.deepEqual(inventory(opened), closedItems, `${label}: Search before Open pays nothing`);
      nativeChest(opened, 'closed', `${label} Open`);
      assert.equal(displayedChest(opened).op[0], 'Search', `${label}: Open selects the original Search child`);
      assert.equal(runner.procInt(opened, 'barrows_phase'), c('barrows_phase_unlooted'), `${label}: Open is not payment`);
      assert.equal(brotherCount(opened), killed, `${label}: Open does not credit its forced final`);
      assert.equal(range(opened.getVar(vars.barrows_kills), 'count'), killed, `${label}: Open changes no displayed kill count`);
      assert.equal(range(opened.getVar(vars.barrows_kills), 'potential'),
        range(closedWords.barrows_kills, 'potential'), `${label}: Open changes no potential`);
      assert.deepEqual(inventory(opened), closedItems, `${label}: Open grants no treasure`);
      const openWords = words(opened);
      noBarrowsRandom(`${label} open-unlooted shared logout`, () => lifecycle(opened, 'logout'));
      assert.deepEqual(words(opened), openWords, `${label}: logout retains open visual and whole earned run`);
      const openSave = opened.save();
      unregister(opened);
      World.currentTick += c('barrows_prayer_interval_ticks') * 4;
      const openRelog = restore(opened, openSave);
      noBarrowsRandom(`${label} open-unlooted shared login`, () => lifecycle(openRelog, 'login'));
      assert.deepEqual(words(openRelog), openWords, `${label}: native relog retains open visual, whole credit and exact remainder`);
      assert.equal(displayedChest(openRelog).op[0], 'Search', `${label}: relog resolves the actual open Search child`);
      assert.deepEqual(inventory(openRelog), closedItems, `${label}: open-unlooted relog pays nothing`);
      noBarrowsRandom(`${label} Search generation gate`, () => {
        assert.equal(runner.procInt(openRelog, 'barrows_chest_search_allowed', [openRelog.getVar(vars.barrows_generation) + 1]), 0);
      });
      openRelog.teleport(3553, 9694, 0);
      noBarrowsRandom(`${label} Search operating-square gate`, () => nativeChest(openRelog, 'open', `${label} wrong-square Search`));
      assert.deepEqual(words(openRelog), openWords, `${label}: wrong-square Search changes no durable word`);
      assert.deepEqual(inventory(openRelog), closedItems, `${label}: wrong-square Search pays nothing`);
      openRelog.teleport(3551, 9694, 0);
      openRelog.setVar(vars.barrows_state, openRelog.getVar(vars.barrows_state) & ~(1 << c('barrows_solved_bit')));
      noBarrowsRandom(`${label} Search solved gate`, () => nativeChest(openRelog, 'open', `${label} unsolved Search`));
      assert.deepEqual(inventory(openRelog), closedItems, `${label}: unsolved Search pays nothing`);
      openRelog.setVar(vars.barrows_state, openWords.barrows_state);
      assert.equal(runner.procInt(openRelog, 'barrows_chest_search_allowed', [openRelog.getVar(vars.barrows_generation)]), 1,
        `${label}: partial-B Search remains eligible after relog without a final-kill prerequisite`);
      nativeChest(openRelog, 'open', `${label} authorized Search`);
      assert.equal(runner.procInt(openRelog, 'barrows_phase'), c('barrows_phase_paid'), `${label}: explicit Search alone pays the run`);
      assert.equal(openRelog.getVar(vars.barrows_kills) >>> 0, openWords.barrows_kills, `${label}: payment preserves whole earned credit and open visual`);
      if (killed > 0) assert.notDeepEqual(inventory(openRelog), closedItems, `${label}: real nonzero-potential Search grants treasure`);
      const paidOpenWords = words(openRelog), paidOpenItems = inventory(openRelog);
      noBarrowsRandom(`${label} paid repeat gate`, () => nativeChest(openRelog, 'open', `${label} repeat Search`));
      assert.deepEqual(words(openRelog), paidOpenWords, `${label}: paid repeat Search changes no durable word`);
      assert.deepEqual(inventory(openRelog), paidOpenItems, `${label}: paid repeat Search pays nothing`);
    }
    console.log('PASS S17 all partial B=0..5: native Open distinct from payment, actual open visual/shared relog/exact credit and remainder, closed/generation/square/solved/paid Search gates, real one-time authorized Search without a final-kill prerequisite');
  } finally {
    for (const npc of [...World.npcs]) if (npc.isActive) World.removeNpc(npc, -1);
    for (const p of players) unregister(p);
  }
});
