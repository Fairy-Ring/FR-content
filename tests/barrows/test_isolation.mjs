#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createRunner, loadPackedRuntime, parseEnum, parseOptions, run } from './packed.mjs';

await run(async () => {
  const runtime = await loadPackedRuntime(parseOptions());
  const { World, Player, LocType, NpcType, VarPlayerType, VarNpcType, InvType, ObjType, CoordGrid,
    ScriptProvider, ScriptRunner, ScriptState, JavaRandom, allocateIfAbsent } = runtime;
  const eng = relative => import(pathToFileURL(path.join(runtime.engineRoot, relative)).href);
  const [{ default: ServerTriggerType }, { ScriptOpcode }, { PlayerTimerType }, { PlayerStat },
    { PlayerLoading }, { default: Packet }, { default: VarSharedType }, { default: Obj },
    { default: OpObjHandler }, { default: OpObj }] = await Promise.all([
    eng('src/engine/script/ServerTriggerType.ts'), eng('src/engine/script/ScriptOpcode.ts'),
    eng('src/engine/entity/EntityTimer.ts'), eng('src/engine/entity/PlayerStat.ts'),
    eng('src/engine/entity/PlayerLoading.ts'), eng('src/io/Packet.ts'), eng('src/cache/config/VarSharedType.ts'),
    eng('src/engine/entity/Obj.ts'), eng('src/network/game/client/handler/OpObjHandler.ts'),
    eng('src/network/game/client/model/OpObj.ts')
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
  const c = name => { assert(constants.has(`barrows_${name}`), `named Barrows constant ${name}`); return constants.get(`barrows_${name}`); };
  const vars = Object.fromEntries(['barrows', 'barrows_kills', 'barrows_state', 'barrows_generation', 'barrows_countdowns']
    .map(name => [name, VarPlayerType.getId(name)]));
  const ownerVar = VarNpcType.getId('npc_barrows_owner'), generationVar = VarNpcType.getId('npc_barrows_generation');
  const runner = createRunner(runtime, { prefix: 'barrows_isolation' });
  const players = [], floor = [], locMutations = [];
  const inv = InvType.getId('inv'), worn = InvType.getId('worn');
  const timer = ScriptProvider.getByName('[timer,barrows_timer_tick]');
  const creditQueue = ScriptProvider.getByName('[queue,barrows_credit_kill]');
  const hitQueue = ScriptProvider.getByName('[queue,barrows_collapse_hit]');
  assert(timer && creditQueue && hitQueue, 'S21 the actual compiled timer and both native queues exist');
  const chest = World.getLoc(3551, 9695, 0, LocType.getId('barrows_stone_chest'));
  assert(chest, 'S21 the original shared map chest is loaded');
  const originalChest = { type: chest.type, baseType: chest.baseType, shape: chest.shape, angle: chest.angle };
  const chestParent = LocType.get(chest.baseType);
  const words = p => Object.fromEntries(Object.entries(vars).map(([name, id]) => [name, p.getVar(id) >>> 0]));
  const inventory = p => p.getInventory(inv).items.map(item => item ? [item.id, item.count] : null);
  const phase = p => runner.procInt(p, 'barrows_phase');
  const range = (p, field) => (p.getVar(vars.barrows_kills) >>> c(`${field}_start`))
    & (2 ** (c(`${field}_end`) - c(`${field}_start`) + 1) - 1);
  const displayedChest = p => LocType.get(chestParent.multiloc[p.getVarBit(chestParent.multivarbit)]).debugname;
  const activeNpcs = () => [...World.npcs].filter(npc => npc.isActive);
  function random(value, action) {
    const java = JavaRandom.nextDouble, math = Math.random;
    JavaRandom.nextDouble = typeof value === 'function' ? value : () => value;
    Math.random = () => 0.5;
    try { return action(); } finally { JavaRandom.nextDouble = java; Math.random = math; }
  }
  function wire(p) {
    p.messages = []; p.packets = [];
    p.write = packet => p.packets.push(packet);
    p.messageGame = text => p.messages.push(text);
    p.wrappedMessageGame = text => p.messages.push(text);
    p.getInventory(inv); p.getInventory(worn);
  }
  function register(p) {
    p.isActive = true;
    World.players[p.slot] = p;
    World.playerLoop.add(0x7b000000n + BigInt(p.slot), p);
    players.push(p);
    return p;
  }
  function makePlayer(label) {
    const serial = players.length + 1;
    const p = new Player(`barrows_isolation_${label}`, BigInt(serial), 0x1c0000000000000n + BigInt(serial));
    p.slot = p.pid = serial;
    p.uid = (Number(p.username37 & 0x1fffffn) << 11) | serial;
    p.baseLevels.fill(99); p.levels.fill(99); p.lastMovement = 0;
    wire(p); register(p);
    p.teleport(3556, 9714, 3);
    random(0.5, () => assert.equal(runner.procInt(p, 'barrows_run_begin'), 1));
    runner.procVoid(p, 'barrows_prayer_set', [c('prayer_interval_ticks') - 2]);
    runner.procVoid(p, 'barrows_resume');
    return p;
  }
  function unregister(p) {
    if (World.players[p.slot] === p) delete World.players[p.slot];
    if (p.isActive) p.unlink();
    p.isActive = false;
  }
  function spawn(p, type, x, z) {
    const handle = runner.procInt(p, 'barrows_actor_spawn', [NpcType.getId(type),
      CoordGrid.packCoord(p.level, x, z), c(p.level === 0 ? 'door_summon_lifetime' : 'crypt_summon_lifetime')]);
    const npc = World.getNpcByUid(handle);
    assert(npc?.isActive, 'S21 the real constructor creates an owned actor');
    assert.equal(npc.getVar(ownerVar), p.uid);
    assert.equal(npc.getVar(generationVar), p.getVar(vars.barrows_generation));
    return npc;
  }
  function produceCredit(p, npc) {
    const before = new Set([...p.queue.all()]);
    npc.heroPoints.addHero(p.hash64, 10);
    const state = ScriptRunner.init(ScriptProvider.getByName('[proc,barrows_npc_credit]'), npc, null, []);
    npc.executeScript(state);
    assert.equal(state.execution, ScriptState.FINISHED, 'S21 the actual NPC death-credit producer finishes');
    return [...p.queue.all()].filter(request => request.script === creditQueue && !before.has(request));
  }
  function captureCredit(p, npc) {
    const requests = produceCredit(p, npc);
    assert.equal(requests.length, 1, 'S21 the real producer queues one request on its actual recipient');
    const request = requests[0]; request.unlink();
    return request;
  }
  function deliver(p, request) {
    const args = request.args.slice();
    p.queue.addTail(request);
    for (let tick = 0; tick < 3 && [...p.queue.all()].includes(request); tick++) {
      World.currentTick++; p.processQueues();
    }
    assert(![...p.queue.all()].includes(request), 'S21 the retained native request actually delivers');
    assert.deepEqual(request.args, args, 'S21 replay changes neither the captured payload nor its recipient');
    assert.equal(p.protect, false);
  }
  function captureHit(p) {
    assert.equal(phase(p), c('phase_paid'));
    runner.procVoid(p, 'barrows_prayer_set', [c('countdown_max')]);
    runner.procVoid(p, 'barrows_collapse_set', [1]);
    const draws = [0, 0];
    random(() => { assert(draws.length, 'S21 due collapse uses only chance and amount draws'); return draws.shift(); }, () => {
      World.currentTick++; p.processTimers(PlayerTimerType.NORMAL);
    });
    assert.equal(draws.length, 0);
    const requests = [...p.queue.all()].filter(request => request.script === hitQueue);
    assert.equal(requests.length, 1, 'S21 the real timer queues one captured collapse hit');
    const request = requests[0]; request.unlink();
    assert.deepEqual(request.args, [p.getVar(vars.barrows_generation), c('collapse_min_hit')]);
    return request;
  }
  function nativeChild(p, expected) {
    p.target = chest; p.targetOp = ServerTriggerType.OPLOC1 - 7;
    const script = p.getOpTrigger();
    assert.equal(script?.name, `[oploc1,barrows_stone_chest_${expected}]`, 'S21 native dispatch reads only this player\'s chest child');
    return script;
  }
  function nativeChest(p, expected) {
    const script = nativeChild(p, expected);
    const state = ScriptRunner.init(script, p, chest, []);
    p.executeScript(state, true);
    assert.equal(state.execution, ScriptState.FINISHED, 'S21 actual Open/Search completes without suspension');
    assert.equal(p.activeScript, null);
  }
  function openAndPay(p) {
    p.teleport(3551, 9694, 0);
    p.setVar(vars.barrows_state, p.getVar(vars.barrows_state) | (1 << c('solved_bit')));
    random(0.5, () => { nativeChest(p, 'closed'); nativeChest(p, 'open'); });
    assert.equal(phase(p), c('phase_paid'), 'S21 the real protected Search pays the run');
  }
  function lifecycle(p, name) {
    const trigger = name === 'login' ? ServerTriggerType.LOGIN : ServerTriggerType.LOGOUT;
    const script = ScriptProvider.getByTriggerSpecific(trigger, -1, -1);
    assert.equal(script?.name, `[${name},_]`);
    const state = ScriptRunner.init(script, p);
    const original = ScriptRunner.HANDLERS[ScriptOpcode.RANDOM], draws = [];
    ScriptRunner.HANDLERS[ScriptOpcode.RANDOM] = current => {
      if (/^\[[^,]+,barrows_/.test(current.script.name)) draws.push(current.script.name);
      original(current);
    };
    try {
      assert.equal(p.runScript(state, true), ScriptState.FINISHED, `S21 native shared ${name} finishes`);
      assert.equal(p.activeScript, null);
      assert.deepEqual(draws, [], `S21 shared ${name} draws no Barrows identity, topology or reward`);
    } finally { ScriptRunner.HANDLERS[ScriptOpcode.RANDOM] = original; }
  }
  const opcodeObservers = ['LOC_ADD', 'LOC_CHANGE', 'LOC_DEL'].map(name => {
    const opcode = ScriptOpcode[name], original = ScriptRunner.HANDLERS[opcode];
    assert.equal(typeof original, 'function', `native global mutation handler ${name}`);
    ScriptRunner.HANDLERS[opcode] = state => {
      if (/^\[[^,]+,barrows_/.test(state.script.name)) locMutations.push({ name, script: state.script.name });
      original(state);
    };
    return [opcode, original];
  });
  const addObj = World.addObj;
  World.addObj = function (obj, receiver, duration) {
    const result = addObj.call(this, obj, receiver, duration);
    floor.push({ obj, receiver, duration });
    return result;
  };
  try {
    const a = makePlayer('a');
    let b = makePlayer('b');
    assert.equal(a.getVar(vars.barrows_generation), b.getVar(vars.barrows_generation),
      'S21 both original owners start with matching generations, sharpening the stale-recipient control');
    const ahrim = NpcType.getId('barrows_ahrim');
    const residentA = spawn(a, 'barrows_ahrim', 3557, 9714);
    assert.equal(runner.procInt(b, 'barrows_brother_find', [ahrim]), 0,
      'S21 another owner\'s living resident cannot globally suppress B');
    const residentB = spawn(b, 'barrows_ahrim', 3555, 9714);
    assert.notEqual(residentA.nid, residentB.nid);
    assert.equal(runner.procInt(a, 'barrows_actor_attackable', [], residentB), 0, 'S21 A cannot attack B resident');
    assert.equal(runner.procInt(b, 'barrows_actor_attackable', [], residentA), 0, 'S21 B cannot attack A resident');
    assert.equal(runner.procInt(a, 'barrows_actor_attackable', [], residentA), 1, 'S21 same-owner attack is admitted');
    const foreignHero = spawn(a, 'barrows_dharok', 3557, 9716);
    const bBeforeForeign = words(b);
    assert.deepEqual(produceCredit(b, foreignHero), [], 'S21 a foreign combat hero cannot route A owned credit onto B');
    assert.deepEqual(words(b), bBeforeForeign);
    const bLiving = spawn(b, 'barrows_dharok', 3555, 9716);
    const beforeBEarn = words(b);
    deliver(a, captureCredit(a, residentA));
    assert.equal(range(a, 'slain'), 1, 'S21 actual owned producer credits A');
    assert.deepEqual(words(b), beforeBEarn, 'S21 A producer changes no B word');
    deliver(b, captureCredit(b, residentB));
    assert.equal(range(b, 'slain'), 1, 'S21 B same-owner producer is the positive control');
    console.log('PASS S21 same crypt: independent resident lookup, real owned construction, reciprocal attack refusal and actual owner-only credit producer; matching-generation peer is unchanged');

    a.teleport(3551, 9694, 0); b.teleport(3552, 9694, 0);
    const landing = CoordGrid.packCoord(0, 3554, 9691);
    const room = runner.procInt(a, 'barrows_door_room', [landing]);
    const roomActors = () => activeNpcs().filter(npc => npc.level === 0 && npc.levels[PlayerStat.HITPOINTS] > 0
      && runner.procInt(a, 'barrows_door_room', [CoordGrid.packCoord(npc.level, npc.x, npc.z)]) === room);
    const roomBefore = new Set(activeNpcs());
    while (roomActors().length < c('door_room_cap')) {
      const index = roomActors().length;
      const type = NpcType.getId('barrows_rat');
      const tile = random(0.5, () => runner.procInt(a, 'barrows_door_tile', [landing, type]));
      assert.notEqual(tile, -1, 'S21 the original room has space for the mixed-owner cap fixture');
      const point = CoordGrid.unpackCoord(tile);
      if (index % 3 === 2) runner.addNpc('barrows_rat', 0, null, point.x, point.z);
      else spawn(index % 3 === 0 ? a : b, 'barrows_rat', point.x, point.z);
    }
    const capWordsA = words(a), capWordsB = words(b);
    for (const p of [a, b]) {
      const attempt = runner.measureRandom(() => runner.procVoid(p, 'barrows_door_encounter', [landing]));
      assert.equal(attempt.calls, 0, 'S21 shared room cap includes both owners and ordinary map actors before any selection draw');
      assert.equal(roomActors().length, c('door_room_cap'));
    }
    assert.deepEqual(words(a), capWordsA); assert.deepEqual(words(b), capWordsB);
    World.removeNpc(roomActors().at(-1), -1);
    random(0.5, () => runner.procVoid(a, 'barrows_door_encounter', [landing]));
    assert.equal(roomActors().length, c('door_room_cap'), 'S21 one shared free place admits a real native encounter');
    for (const npc of activeNpcs()) if (!roomBefore.has(npc)) World.removeNpc(npc, -1);
    console.log('PASS S21 shared room count only: mixed-owner and ordinary occupants jointly cap both callers; one free place admits a native encounter without sharing run words');

    const oldKill = captureCredit(a, spawn(a, 'barrows_rat', 3554, 9691));
    assert.equal(oldKill.args[0], b.getVar(vars.barrows_generation), 'S21 B still matches the captured old A kill generation');
    const bTunnelActor = spawn(b, 'barrows_rat', 3556, 9691);
    const peerWords = words(b), peerItems = inventory(b), peerPackets = b.packets.length;
    assert.equal(displayedChest(a), 'barrows_stone_chest_closed');
    assert.equal(displayedChest(b), 'barrows_stone_chest_closed');
    a.setVar(vars.barrows_state, a.getVar(vars.barrows_state) | (1 << c('solved_bit')));
    random(0.5, () => nativeChest(a, 'closed'));
    assert.equal(displayedChest(a), 'barrows_stone_chest_open');
    assert.equal(displayedChest(b), 'barrows_stone_chest_closed', 'S21 A Open never changes B personal chest');
    nativeChild(b, 'closed');
    assert.equal(a.invAdd(inv, ObjType.getId('spade'), InvType.get(inv).size), InvType.get(inv).size,
      'S21 an own-only full bag forces the actual protected grant to overflow');
    random(0.5, () => nativeChest(a, 'open'));
    assert.equal(phase(a), c('phase_paid'));
    assert.equal(bLiving.isActive, true, 'S21 A payment preserves B crypt actor');
    assert.equal(bTunnelActor.isActive, true, 'S21 A payment preserves B tunnel actor');
    assert.equal(foreignHero.isActive, false, 'S21 A payment removes A own old-generation crypt actor');
    assert.deepEqual(words(b), peerWords, 'S21 A actual payment changes no B durable word');
    assert.deepEqual(inventory(b), peerItems, 'S21 A actual grant gives B no inventory item');
    assert.equal(b.packets.length, peerPackets, 'S21 A payment and cleanup send no foreign presentation packet');
    nativeChild(b, 'closed');
    const overflow = floor.filter(row => row.receiver === a.hash64);
    assert(overflow.length > 0 && overflow.every(row => row.obj.isActive && row.obj.count > 0),
      'S21 actual native Search grants nonzero earned floor treasure');
    for (const { obj, receiver, duration } of overflow) {
      assert.equal(receiver, a.hash64);
      assert.equal(obj.receiver64, a.hash64);
      assert.equal(obj.reveal, Obj.REVEAL, 'S21 grant uses the engine ordinary private countdown');
      assert(duration > Obj.REVEAL, 'S21 ordinary overflow survives its private interval');
      assert.equal(World.getObj(obj.x, obj.z, obj.level, obj.type, a.hash64), obj);
      assert.equal(World.getObj(obj.x, obj.z, obj.level, obj.type, b.hash64), null,
        'S21 B cannot resolve A private overflow through native pickup lookup');
    }
    const oldHit = captureHit(a), hpBefore = a.levels[PlayerStat.HITPOINTS];
    deliver(a, captureHit(a));
    assert.equal(a.levels[PlayerStat.HITPOINTS], hpBefore - c('collapse_min_hit'), 'S21 a current native timer hit damages only paid A');
    assert.equal(b.levels[PlayerStat.HITPOINTS], 99);
    assert.deepEqual(words(b), peerWords);
    const [stairName, destination] = [...parseEnum(runtime.contentRoot, 'barrows_stair_surface_exit')][0];
    const [level, mapX, mapZ, x, z] = destination.split('_').map(Number);
    allocateIfAbsent(mapX * 64 + x, mapZ * 64 + z, level);
    random(0.5, () => runner.procVoid(a, 'barrows_stair_exit', [LocType.getId(stairName)]));
    assert.equal(phase(a), c('phase_idle'));
    assert.equal(a.getVar(vars.barrows_kills), 0);
    assert(a.getVar(vars.barrows_generation) > oldHit.args[0]);
    assert.deepEqual(words(b), peerWords, 'S21 A paid exit preserves B whole unfinished run');
    assert.deepEqual(inventory(b), peerItems);
    assert.equal(bLiving.isActive && bTunnelActor.isActive, true, 'S21 A paid exit preserves both B actors');
    assert.equal(b.packets.length, peerPackets, 'S21 A paid exit sends B no stop, shake or hint packet');
    nativeChild(b, 'closed');
    console.log('PASS S21 same tunnel: native personal Open/Search, real full-bag reward, own paid reset and owned cleanup leave every B word, item, actor and presentation untouched');

    const preRelog = words(b);
    const tunnelLifetime = bTunnelActor.lifecycleTick;
    lifecycle(b, 'logout');
    assert.equal(bLiving.isActive, false, 'S21 B logout removes its transient brother actor');
    assert.deepEqual([bTunnelActor.isActive, bTunnelActor.isActive && bTunnelActor.getVar(runtime.VarNpcType.getId('npc_barrows_public')), bTunnelActor.lifecycleTick],
      [true, 1, tunnelLifetime], 'S21 B logout releases its ordinary door actor publicly for its original lifetime');
    const saved = b.save(), oldB = b;
    unregister(oldB);
    b = PlayerLoading.load(oldB.username, new Packet(saved), null);
    b.slot = oldB.slot; b.pid = oldB.pid; b.uid = oldB.uid;
    wire(b); register(b);
    lifecycle(b, 'login');
    assert.deepEqual(words(b), preRelog, 'S21 B actual shared logout/save/load/login retains its complete unfinished run');
    assert.deepEqual(inventory(b), peerItems);
    assert.equal(displayedChest(b), 'barrows_stone_chest_closed');

    const pickup = overflow[0].obj;
    b.teleport(pickup.x, pickup.z, pickup.level);
    b.buildArea.rebuild();
    const handler = new OpObjHandler();
    assert.equal(handler.handle(new OpObj(3, pickup.x, pickup.z, pickup.type), b), false,
      'S21 actual Take packet refuses the private item before ordinary reveal');
    const beforePublicItems = inventory(b), beforePublicWords = words(b);
    for (let elapsed = 1; elapsed < Obj.REVEAL; elapsed++) {
      World.currentTick++;
      for (const { obj } of overflow) obj.turn();
      assert.equal(pickup.isActive, true);
      assert.equal(World.getObj(pickup.x, pickup.z, pickup.level, pickup.type, b.hash64), null,
        `S21 B cannot Take private overflow at elapsed engine tick ${elapsed}`);
    }
    World.currentTick++;
    for (const { obj } of overflow) obj.turn();
    assert.equal(pickup.receiver64, Obj.NO_RECEIVER, 'S21 tick 100 uses the ordinary engine reveal, not a Barrows rule');
    assert.equal(World.getObj(pickup.x, pickup.z, pickup.level, pickup.type, b.hash64), pickup);
    assert.equal(handler.handle(new OpObj(3, pickup.x, pickup.z, pickup.type), b), true, 'S21 native Take admits the now-public overflow');
    const take = b.getOpTrigger();
    assert.equal(take?.name, '[opobj3,_]', 'S21 ordinary shared pickup supplies the actual Take operation');
    const pickupType = pickup.type, pickupCount = pickup.count;
    const state = ScriptRunner.init(take, b, pickup, []);
    b.executeScript(state, true);
    assert.equal(state.execution, ScriptState.FINISHED);
    assert.equal(pickup.isActive, false, 'S21 native ordinary pickup removes the public ground object');
    assert.equal(b.invTotal(inv, pickupType), pickupCount, 'S21 B receives exactly the ordinary public item, not a Barrows grant');
    assert.notDeepEqual(inventory(b), beforePublicItems);
    assert.deepEqual(words(b), beforePublicWords, 'S21 public pickup changes no Barrows state');
    console.log(`PASS S21 ordinary full-bag overflow: native Take refuses all ${Obj.REVEAL - 1} private ticks, engine tick ${Obj.REVEAL} reveals the item, and B ordinary Take receives exactly the public stack without Barrows credit`);

    a.teleport(3551, 9694, 0);
    random(0.5, () => assert.equal(runner.procInt(a, 'barrows_run_begin'), 1));
    const newRun = words(a), bBeforeStale = words(b), bHp = b.levels[PlayerStat.HITPOINTS];
    const bBeforeQueue = [...b.queue.all()], bPacketsBeforeStale = b.packets.length;
    deliver(a, oldKill);
    assert.deepEqual(words(a), newRun, 'S21 A captured old queued kill is rejected after reset and new begin');
    assert.deepEqual(words(b), bBeforeStale, 'S21 A stale kill cannot credit matching-generation B');
    assert.equal(range(b, 'slain'), 1);
    assert.deepEqual([...b.queue.all()], bBeforeQueue, 'S21 native routing never puts A old request on B queue');
    openAndPay(a);
    const newPaid = words(a), aHp = a.levels[PlayerStat.HITPOINTS];
    deliver(a, oldHit);
    assert.equal(a.levels[PlayerStat.HITPOINTS], aHp, 'S21 A captured old collapse hit is rejected even in a new paid run');
    assert.deepEqual(words(a), newPaid);
    assert.equal(b.levels[PlayerStat.HITPOINTS], bHp, 'S21 A stale collapse cannot damage unfinished B');
    assert.deepEqual(words(b), bBeforeStale);
    assert.equal(b.packets.length, bPacketsBeforeStale, 'S21 A stale callbacks send no foreign packet');
    assert.deepEqual([...b.queue.all()], bBeforeQueue);
    deliver(a, captureHit(a));
    assert.equal(a.levels[PlayerStat.HITPOINTS], aHp - c('collapse_min_hit'), 'S21 fresh new-run timer hit is the positive stale-hit control');
    assert.equal(b.levels[PlayerStat.HITPOINTS], bHp);
    console.log('PASS S21 actual retained old kill and timer-hit requests stay on A and reject after reset/new run, while same-generation B remains unchanged; current native timer hit still damages only paid A');
    assert.deepEqual(locMutations, [], 'S21 no Barrows transition mutates a global loc');
    assert.equal(World.getLoc(chest.x, chest.z, chest.level, chest.baseType), chest);
    assert.deepEqual({ type: chest.type, baseType: chest.baseType, shape: chest.shape, angle: chest.angle }, originalChest,
      'S21 the original shared chest parent never changes');
    console.log('PASS S21 all personal transitions, payment, departures, save/load and stale callbacks issue no global loc mutation and preserve the shared native chest parent');
  } finally {
    World.addObj = addObj;
    for (const [opcode, original] of opcodeObservers) ScriptRunner.HANDLERS[opcode] = original;
    for (const { obj } of floor) if (obj.isActive) World.removeObj(obj, 0);
    for (const npc of activeNpcs()) World.removeNpc(npc, -1);
    for (const p of players) unregister(p);
  }
});
