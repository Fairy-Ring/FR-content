#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseOptions, resolveRoots, run } from './packed.mjs';
import { runtime } from '../npc-combat/outcome_runtime.mjs';

const BARROWS_HUNT_RADIUS = 4; // UNKNOWN historical distance; selected engineering value.
const TYPES = {
  barrows_bloodworm: { id: 2031, hp: 45, maximum: 3, style: 0, tiles: [[3548,9675],[3549,9679],[3551,9676],[3552,9679],[3552,9682],[3555,9675],[3555,9679]] },
  barrows_rat: { id: 2032, hp: 35, maximum: 3, style: 0, tiles: [[3531,9694],[3534,9690],[3534,9698],[3535,9695],[3537,9692],[3539,9695]] },
  barrows_giantrat: { id: 2033, hp: 70, maximum: 6, style: 0, tiles: [[3532,9696],[3533,9692],[3536,9697],[3537,9694]] },
  barrows_spider: { id: 2034, hp: 60, maximum: 6, style: 0, tiles: [[3566,9693],[3567,9698],[3569,9695],[3570,9691],[3572,9697]] },
  barrows_giantspider: { id: 2035, hp: 80, maximum: 8, style: 0, tiles: [[3566,9695],[3567,9691],[3567,9697],[3570,9697],[3571,9692],[3572,9694]] },
  barrows_skeleton_unarmed: { id: 2036, hp: 50, maximum: 10, style: 2, tiles: [[3548,9709],[3549,9713],[3553,9707]] },
  barrows_skeleton_armed: { id: 2037, hp: 50, maximum: 10, style: 1, tiles: [[3551,9714],[3554,9713],[3555,9709]] }
};

await run(async () => {
  // Acceptance only: --base-pack DIR also runs the owned door-actor lifetime on the
  // pre-BC-02 pack in this process and compares it with the current pack.
  const args = [...process.argv];
  const baseIndex = args.indexOf('--base-pack');
  const basePack = baseIndex === -1 ? null : args.splice(baseIndex, 2)[1];
  assert(baseIndex === -1 || (basePack && !basePack.startsWith('--')), '--base-pack requires a pack directory');
  const { contentRoot, engineRoot, packDir } = resolveRoots(parseOptions(args));
  const rt = await runtime(engineRoot, packDir);
  const load = file => import(pathToFileURL(path.join(engineRoot, file)).href);
  const [{ default: Trigger }, { NpcMode }, { Interaction }, { CoordGrid }, routefinder] = await Promise.all([
    load('src/engine/script/ServerTriggerType.ts'), load('src/engine/entity/NpcMode.ts'),
    load('src/engine/entity/Interaction.ts'), load('src/engine/CoordGrid.ts'), load('src/engine/routefinder/index.ts')
  ]);
  const { World, Provider, State, Pointer, configs: { NpcType, VarNpcType, VarPlayerType, HuntType } } = rt;
  const nv = name => rt.id(VarNpcType, name);
  const pv = name => rt.id(VarPlayerType, name);
  const delay = nv('npc_action_delay');
  const defences = ['com_stabdef', 'com_slashdef', 'com_crushdef'];
  const queueDamage = result => result.snapshot.queued.filter(q => q.script === '[queue,combat_damage_player]');
  const dispatch = npc => {
    const type = NpcType.get(npc.type);
    const script = Provider.getByTrigger(Trigger.AI_OPPLAYER2, type.id, type.category);
    assert(script, `${type.debugname} native contact dispatch`);
    return script.name;
  };
  let count = 0;
  const check = (name, body) => { body(); count++; console.log(`PASS BC-02 ${name}`); };
  let zone = null;
  const fixture = (name, variant = 'hit', distance = 1) => {
    if (zone) { zone.leave(World.players[1]); zone = null; }
    rt.dispose();
    const f = rt.fixture(name, variant, 'melee', distance);
    for (let x = 3480; x <= 3520; x++) for (let z = 3480; z <= 3520; z++) routefinder.__set(x, z, 0, 0);
    return f;
  };
  const observed = (f, variant = 'hit', rng = null) => {
    const result = rt.observe(dispatch(f.npc), f, [], variant, rng);
    assert.equal(result.snapshot.execution, State.FINISHED, `${dispatch(f.npc)} completes`);
    assert.deepEqual(result.errors, []);
    assert.equal(result.snapshot.error, null);
    assert(result.snapshot.pointers & (1 << Pointer.ActivePlayer), 'correct player pointer retained');
    assert.equal(result.snapshot.pointers & (1 << Pointer.ProtectedActivePlayer), 0, 'native execution releases protection');
    assert.equal(result.snapshot.playerProtected, false);
    return result;
  };
  try {
    World.gameMap.init();
    check('all 34 original native static placements and non-owned actor bindings', () => {
      for (const [name, spec] of Object.entries(TYPES)) {
        const npcs = [...World.npcs].filter(npc => npc.type === spec.id);
        assert.equal(NpcType.getId(name), spec.id, `${name} original type`);
        assert.deepEqual(npcs.map(npc => [npc.startX, npc.startZ]).sort(), [...spec.tiles].sort(), `${name} original placements`);
        for (const npc of npcs) {
          assert.equal(npc.level, 0);
          assert.equal(npc.getVar(nv('npc_barrows_owner')), -1);
          assert.equal(npc.huntrange, BARROWS_HUNT_RADIUS);
          assert.equal(npc.huntMode, HuntType.getId('aggressive_melee'));
          assert.equal(npc.baseLevels[3], spec.hp);
        }
      }
    });
    for (const [name, spec] of Object.entries(TYPES)) {
      check(`${name} real dispatch, subtype, maximum, one hit and four-tick delay`, () => {
        const f = fixture(name);
        assert.equal(dispatch(f.npc), name.includes('skeleton') ? `[ai_opplayer2,${name}]` : '[ai_opplayer2,_]');
        for (const [index, field] of defences.entries()) f.player.setVar(pv(field), 113 + index * 101);
        const result = observed(f);
        assert.deepEqual(result.draws, [0.999999, 0, 0.999999]);
        const rolls = result.events.filter(event => event.op === 'RANDOMINC');
        assert.deepEqual(rolls[1].in, [113 + spec.style * 101], `${name} selected native defence cache`);
        assert.deepEqual(rolls[2].in, [spec.maximum], `${name} native maximum, not a JS formula`);
        assert.equal(rt.param(NpcType.get(spec.id), 'damagetype'), spec.style);
        assert.deepEqual(queueDamage(result).map(q => q.args), [[spec.maximum]]);
        assert.equal(result.snapshot.npcVars[delay], 104);
        assert.equal(result.snapshot.playerVars[pv('aggressive_npc')], f.npc.uid);
        assert.equal(result.snapshot.npcVars[nv('npc_attacking_uid')], f.player.uid);
        assert.equal(result.snapshot.queued.filter(q => q.script === '[queue,playerhit_n_retaliate]').length, 1);
        const delivered = rt.settle(f);
        assert.equal(delivered.levels[3], 255 - spec.maximum, 'actual native damage queue reaches the selected player');
        assert.equal(delivered.energy, 10000);
        assert.deepEqual(delivered.levels.filter((_, index) => index !== 3), Array(20).fill(80), 'no invented stat effect');
        assert.deepEqual([...f.npc.levels], [...f.npc.baseLevels], 'attack neither heals nor drains its actor');
      });
      for (const variant of ['zero', 'miss', 'protected', 'pending', 'target-loss', 'npc-busy', 'dead-player', 'dead-npc']) {
        check(`${name} ${variant} keeps native draws and delivery`, () => {
          const f = fixture(name, variant);
          const result = observed(f, variant);
          const noAttempt = ['pending', 'target-loss', 'npc-busy', 'dead-player'].includes(variant);
          const expectedDraws = noAttempt ? 0 : ['miss', 'protected'].includes(variant) ? 2 : 3;
          assert.equal(result.draws.length, expectedDraws);
          assert.equal(queueDamage(result).length, noAttempt || variant === 'dead-npc' ? 0 : 1);
          if (queueDamage(result).length) assert.deepEqual(queueDamage(result)[0].args, [0]);
          if (!noAttempt) assert.equal(result.snapshot.npcVars[delay], 104);
          assert.equal(rt.settle(f).levels[3], variant === 'dead-player' ? 0 : 255);
          if (variant === 'zero') assert(result.visited.includes('[proc,npc_meleeattack_hit]'), 'accurate rolled zero reaches the native hit branch');
          if (variant === 'miss' || variant === 'protected') assert(!result.visited.includes('[proc,npc_meleeattack_hit]'), 'native miss/protected branch rolls no magnitude');
        });
      }
      check(`${name} wounded actor keeps its cap; one living HP does not retreat`, () => {
        const f = fixture(name);
        f.npc.levels[3] = 1;
        f.player.lastAfkZone = 1000;
        const retaliation = rt.observe('[ai_queue1,_]', f);
        assert.equal(retaliation.snapshot.execution, State.FINISHED);
        assert.equal(f.npc.targetOp, NpcMode.OPPLAYER2);
        assert.equal(f.npc.getVar(delay), 102);
        World.currentTick = 102;
        const result = observed(f);
        assert.deepEqual(queueDamage(result).map(q => q.args), [[spec.maximum]]);
        assert.equal(f.npc.levels[3], 1);
      });
      check(`${name} native contact clipping blocks a wall and distance, then attacks adjacent`, () => {
        const f = fixture(name);
        f.npc.setInteraction(Interaction.SCRIPT, f.player, NpcMode.OPPLAYER2);
        routefinder.changeWall(f.npc.x, f.npc.z, 0, routefinder.LocAngle.WEST, routefinder.LocShape.WALL_STRAIGHT, true, true);
        assert.equal(f.npc.tryInteract(true), false);
        assert.equal([...f.player.queue.all()].length, 0);
        assert.equal(f.npc.getVar(delay), 0);
        routefinder.changeWall(f.npc.x, f.npc.z, 0, routefinder.LocAngle.WEST, routefinder.LocShape.WALL_STRAIGHT, true, false);
        f.npc.x += 2;
        assert.equal(f.npc.tryInteract(true), false);
        assert.equal([...f.player.queue.all()].length, 0);
        f.npc.x -= 2;
        assert.equal(f.npc.tryInteract(true), true);
        assert.equal(f.npc.getVar(delay), 104);
        assert.equal([...f.player.queue.all()].filter(q => q.script.name === '[queue,combat_damage_player]').length, 1);
      });
      check(`${name} maximum-level acquisition, radius, sight, tolerance and re-acquisition`, () => {
        const f = fixture(name, 'hit', BARROWS_HUNT_RADIUS);
        for (let stat = 0; stat < f.player.baseLevels.length; stat++) f.player.setLevel(stat, 99);
        assert.equal(f.player.combatLevel, 126);
        f.npc.setVar(nv('npc_aggressive_player'), 0); // No attack or retaliation seeds acquisition.
        zone = World.gameMap.getZone(f.player.x, f.player.z, 0); zone.enter(f.player);
        const hunt = HuntType.get(f.npc.huntMode);
        assert.equal(hunt.checkNotTooStrong, 0);
        const acquire = () => { f.npc.huntClock = hunt.rate; f.npc.huntAll(hunt); return f.npc.huntTarget; };
        assert.equal(acquire(), f.player, 'native hunt acquires a maximum-level idle player at distance four');
        f.npc.x++;
        assert.equal(acquire(), null, 'outside radius');
        f.npc.x--;
        routefinder.changeLoc(f.player.x + 1, f.player.z, 0, 1, 1, true, true);
        assert.equal(acquire(), null, 'line-of-sight obstruction');
        routefinder.changeLoc(f.player.x + 1, f.player.z, 0, 1, 1, true, false);
        f.player.updateAfkZones();
        assert.equal(f.player.lastAfkZone, 0);
        for (let tick = 0; tick < 999; tick++) f.player.updateAfkZones();
        assert.equal(f.player.zonesAfk(), false);
        assert.equal(acquire(), f.player, 'still acquired at 999 ticks');
        f.player.x++;
        f.player.updateAfkZones();
        assert.equal(f.player.lastAfkZone, 1000, 'movement within tolerance squares does not reset the clock');
        assert.equal(f.player.zonesAfk(), true);
        assert.equal(acquire(), null, '1000 ticks / 600 seconds ends new acquisition');
        f.player.x += 40;
        f.player.updateAfkZones();
        assert.equal(f.player.zonesAfk(), false, 'leaving both tolerance squares resets expiry');
        f.player.x -= 41;
        f.player.updateAfkZones();
        assert.equal(acquire(), f.player, 'native acquisition resumes without changing NPC policy');
        f.npc.consumeHuntTarget();
        assert.equal(f.npc.target, f.player);
        assert.equal(f.npc.targetOp, NpcMode.OPPLAYER2);
        assert.equal(f.npc.huntMode, -1, 'native policy stops seeking a different target during this interaction');
        f.npc.resetDefaults();
        assert.equal(f.npc.huntMode, HuntType.getId('aggressive_melee'), 'native reset restores configured acquisition');
      });
      check(`${name} native regeneration remains exactly 100 ticks for all six skills`, () => {
        const { npc } = fixture(name);
        npc.processRegen(); // Native spawn phase chooses its configured interval.
        assert.equal(npc.regenInterval, 100);
        for (let index = 0; index < 6; index++) npc.levels[index] = npc.baseLevels[index] - 1;
        const drained = [...npc.levels];
        for (let tick = 0; tick < 99; tick++) npc.processRegen();
        assert.deepEqual([...npc.levels], drained);
        npc.processRegen();
        assert.deepEqual([...npc.levels], [...npc.baseLevels]);
        for (let tick = 0; tick < 100; tick++) npc.processRegen();
        assert.deepEqual([...npc.levels], [...npc.baseLevels], 'full actor never over-heals');
      });
    }
    // Ruling 2026-11-16T10:16Z/10:25Z: an owned door actor of the seven types never
    // targets a player who is not its owner. Without its owner it stays passive, as
    // before BC-02, and the owner re-engages it by attacking. Real door-spawn and
    // owned-timer scripts in the native World order: player hunt, then NPC turn.
    const [{ default: Player }, { default: Npc }, { EntityLifeCycle }, { default: Runner }, { default: JavaRandom }, { HuntModeType }, { default: DbTableIndex }] = await Promise.all([
      load('src/engine/entity/Player.ts'), load('src/engine/entity/Npc.ts'), load('src/engine/entity/EntityLifeCycle.ts'),
      load('src/engine/script/ScriptRunner.ts'), load('src/util/JavaRandom.ts'), load('src/engine/entity/hunt/HuntModeType.ts'),
      load('src/cache/config/DbTableIndex.ts')
    ]);
    const LANDING = { x: 3534, z: 9706 }; // native W-to-NW door destination; the NW corner has no static placement
    const AWAY = { x: 3539, z: 9717 }; // the far NW corner, beyond the actor's maxrange
    const ACROSS = { x: 3546, z: 9711 }; // native NW-to-N door destination
    const LEAVES = ['walks away', 'crosses a door', 'logs out', 'dies', 'is engaged by another NPC'];
    const mathRandom = Math.random;
    function tunnelPlayer(slot, label, at) {
      const p = new Player(`bc02_${label}`, BigInt(0x4000 + slot), 0x4b00000000n + BigInt(slot));
      p.slot = slot; p.pid = slot; p.uid = (Number(p.username37 & 0x1fffffn) << 11) | slot;
      p.level = 0; p.x = at.x; p.z = at.z; p.isActive = true; p.staffModLevel = 0;
      p.vars.fill(0); p.baseLevels.fill(99); p.levels.fill(99);
      p.getInventory(rt.id(rt.configs.InvType, 'worn')); p.getInventory(rt.id(rt.configs.InvType, 'inv'));
      p.testMessages = []; p.write = () => {};
      p.messageGame = text => p.testMessages.push(String(text)); p.wrappedMessageGame = p.messageGame;
      World.players[slot] = p; World.playerLoop.add(p.hash64, p);
      World.gameMap.getZone(p.x, p.z, 0).enter(p);
      return p;
    }
    function place(p, at) {
      World.gameMap.getZone(p.x, p.z, p.level).leave(p);
      p.x = at.x; p.z = at.z;
      World.gameMap.getZone(p.x, p.z, p.level).enter(p);
    }
    function removePlayer(p) {
      if (!p.isActive) return;
      World.gameMap.getZone(p.x, p.z, p.level).leave(p);
      p.isActive = false; p.unlink();
      if (World.players[p.slot] === p) World.players[p.slot] = null;
    }
    function playerProc(p, name, args = []) {
      const script = Provider.getByName(`[proc,${name}]`);
      assert(script, `packed [proc,${name}]`);
      const state = Runner.init(script, p, null, args);
      assert.equal(p.runScript(state, true), State.FINISHED, `${name} finishes`);
      return state;
    }
    function scripted(draws, action) {
      const java = JavaRandom.nextDouble;
      let index = 0;
      JavaRandom.nextDouble = () => (index < draws.length ? draws[index++] : 0);
      try { return action(); } finally { JavaRandom.nextDouble = java; }
    }
    function beginRun(p, generation) {
      p.setVar(pv('barrows_state'), 1 | (1 << 3)); // tunnel identity 1, unlooted phase
      p.setVar(pv('barrows_generation'), generation);
    }
    function doorDraws() {
      const selector = tunnelPlayer(4, 'selector', LANDING);
      beginRun(selector, 40);
      const draws = new Map();
      for (const [name, spec] of Object.entries(TYPES)) {
        for (let draw = 0; draw < 128 && !draws.has(name); draw++) {
          if (scripted([(draw + 0.25) / 128], () => playerProc(selector, 'barrows_door_select')).popInt() === spec.id) draws.set(name, draw);
        }
      }
      // barrows.enum barrows_door_class_npc: no other tunnel type is ever an owned actor.
      assert.deepEqual([...draws.keys()].sort(), ['barrows_bloodworm', 'barrows_rat', 'barrows_skeleton_unarmed'], 'the native D4 door monsters');
      removePlayer(selector);
      return draws;
    }
    function doorActor(owner, name, draws) {
      const before = new Set([...World.npcs].map(npc => npc.nid));
      scripted([(draws.get(name) + 0.25) / 128, 0], () => playerProc(owner, 'barrows_door_encounter', [CoordGrid.packCoord(0, owner.x, owner.z)]));
      const spawned = [...World.npcs].filter(npc => npc.isActive && !before.has(npc.nid));
      assert.equal(spawned.length, 1, `${name} real door encounter spawns one actor`);
      assert.equal(spawned[0].type, TYPES[name].id);
      assert.equal(spawned[0].getVar(nv('npc_barrows_owner')), owner.uid, `${name} door actor is owned`);
      assert.equal(spawned[0].target, owner, `${name} door actor starts on its owner`);
      assert.equal(spawned[0].huntMode, -1, `${name} door spawn clears the actor's instance hunt`);
      return spawned[0];
    }
    function worldTick(npc, people) {
      World.currentTick++;
      // World.processWorld: the native player hunt runs before every NPC turn.
      if (npc.isActive && npc.huntMode !== -1) {
        const hunt = HuntType.get(npc.huntMode);
        if (hunt && hunt.type === HuntModeType.PLAYER) npc.huntAll(hunt);
      }
      // World.processNpcEventQueue: spawn and despawn triggers run before the NPC turns.
      for (const request of World.npcEventQueue.all()) {
        if (request.npc.delayed) continue;
        request.unlink();
        request.npc.executeScript(Runner.init(request.script, request.npc));
      }
      if (npc.isActive) {
        npc.lastTickX = npc.x; npc.lastTickZ = npc.z; npc.moveSpeed = npc.defaultMoveSpeed(); npc.walkDir = -1; npc.runDir = -1;
        npc.turn();
      }
      const hits = people.map(p => [...p.queue.all()].filter(q => q.script.name === '[queue,combat_damage_player]').length);
      for (const p of people) if (p.isActive) p.processQueues();
      return hits;
    }
    function ownerAttacks(npc, owner) {
      // A landed player hit names the attacker and starts the native retaliation queue.
      npc.setVar(nv('npc_aggressive_player'), owner.uid);
      const script = Provider.getByTrigger(Trigger.AI_QUEUE1, npc.type, NpcType.get(npc.type).category);
      assert(script, 'native retaliation entry');
      const state = Runner.init(script, npc, owner, []);
      state.pointerAdd(Pointer.ProtectedActivePlayer);
      npc.executeScript(state);
    }
    function lifetime(name, draws, leave) {
      const owner = tunnelPlayer(2, 'owner', LANDING), other = tunnelPlayer(3, 'other', LANDING);
      beginRun(owner, 41); beginRun(other, 42);
      // A native hunt picks Math.random() among candidates: 0.999 takes the last and never wanders;
      // the door crossing uses 0, the first candidate, so both candidate orders are exercised.
      Math.random = leave === 'crosses a door' ? () => 0 : () => 0.999;
      const trace = [];
      try {
        const npc = doorActor(owner, name, draws);
        const who = target => target === owner ? 'owner' : target === other ? 'other' : target ? 'unexpected' : null;
        const step = (ticks, phase) => {
          for (let i = 0; i < ticks && (npc.isActive || i === 0); i++) {
            if (phase === 'engaged') { owner.setVar(pv('lastcombat'), World.currentTick + 1); owner.setVar(pv('aggressive_npc'), npc.uid + 1); }
            const [ownerHits, otherHits] = worldTick(npc, [owner, other]);
            trace.push({ phase, mode: npc.targetOp, target: who(npc.target), active: npc.isActive, hunt: npc.huntMode, ownerHits, otherHits, x: npc.x, z: npc.z });
          }
        };
        step(8, 'owner present');
        if (leave === 'walks away' || leave === 'crosses a door') {
          const away = leave === 'walks away' ? AWAY : ACROSS;
          place(owner, away); step(40, 'owner gone');
          place(owner, LANDING); step(20, 'owner returns');
          ownerAttacks(npc, owner); step(16, 'owner attacks');
          place(owner, away); step(1100, 'owner gone again');
        } else if (leave === 'logs out') {
          playerProc(owner, 'barrows_logout'); removePlayer(owner); step(20, 'owner logged out');
        } else if (leave === 'dies') {
          owner.levels[3] = 0; owner.setVar(pv('death'), 1);
          playerProc(owner, 'barrows_player_death'); step(20, 'owner died');
        } else {
          step(30, 'engaged');
          step(20, 'owner returns');
          ownerAttacks(npc, owner); step(16, 'owner attacks');
          place(owner, AWAY); step(1100, 'owner gone again');
        }
        return { npc, trace, otherAggressor: other.getVar(pv('aggressive_npc')), otherHp: other.levels[3] };
      } finally {
        Math.random = mathRandom;
        removePlayer(owner); removePlayer(other);
        for (const npc of [...World.npcs]) if (npc.isActive && npc.getVar(nv('npc_barrows_owner')) !== -1) World.removeNpc(npc, -1);
      }
    }
    function staticAcquisition(name, hunted) {
      const [x, z] = TYPES[name].tiles[0];
      const config = NpcType.get(TYPES[name].id);
      const npc = new Npc(0, x, z, config.size, config.size, EntityLifeCycle.RESPAWN, World.getNextNid(), config.id, config.blockwalk);
      World.addNpc(npc, -1);
      const a = tunnelPlayer(2, 'static_a', hunted === 'owner' ? { x, z } : { x: x + 20, z });
      const b = tunnelPlayer(3, 'static_b', hunted === 'other' ? { x, z } : { x: x + 20, z });
      Math.random = () => 0.999;
      try {
        let target = null;
        for (let tick = 0; tick < 4 && !target; tick++) { worldTick(npc, [a, b]); target = npc.target; }
        return { owned: npc.getVar(nv('npc_barrows_owner')), timer: npc.timerInterval, hunt: npc.huntMode, target: target === a ? 'owner' : target === b ? 'other' : target ? 'unexpected' : null };
      } finally {
        Math.random = mathRandom;
        removePlayer(a); removePlayer(b);
        World.removeNpc(npc, -1); World.npcs.remove(npc.nid); npc.cleanup();
      }
    }
    function ownedTimerCommands(name, draws) {
      const owner = tunnelPlayer(2, 'cost', LANDING);
      beginRun(owner, 43);
      try {
        const npc = doorActor(owner, name, draws);
        const timer = Provider.getByTrigger(Trigger.AI_TIMER, npc.type, NpcType.get(npc.type).category);
        const run = () => { const state = Runner.init(timer, npc); npc.executeScript(state); assert.equal(state.execution, State.FINISHED); return state.opcount; };
        const targeting = run();
        npc.clearInteraction(); npc.targetOp = NpcMode.WANDER;
        return { targeting, passive: run() };
      } finally {
        removePlayer(owner);
        for (const npc of [...World.npcs]) if (npc.isActive && npc.getVar(nv('npc_barrows_owner')) !== -1) World.removeNpc(npc, -1);
      }
    }
    rt.dispose();
    const draws = doorDraws();
    for (const name of Object.keys(TYPES)) {
      for (const leave of draws.has(name) ? LEAVES : []) {
        check(`${name} owned door actor: the owner ${leave}; the second player is never targeted until removal`, () => {
          const { npc, trace, otherAggressor, otherHp } = lifetime(name, draws, leave);
          assert(trace.every(entry => entry.target !== 'other' && entry.target !== 'unexpected' && entry.otherHits === 0), JSON.stringify(trace.find(entry => entry.target === 'other' || entry.otherHits)));
          assert.notEqual(otherAggressor, npc.uid, 'the second player is never the actor’s single-way combat');
          assert.equal(otherHp, 99, 'the second player loses no Hitpoints');
          assert(trace.filter(entry => entry.phase === 'owner present').every(entry => entry.target === 'owner'), 'the owner keeps its door actor');
          assert(trace.every(entry => entry.hunt === -1), 'an owned actor never runs the native hunt');
          for (const phase of ['owner gone', 'owner returns', 'owner gone again', 'engaged']) {
            assert(trace.filter(entry => entry.phase === phase && entry.active).every(entry => entry.target === null && entry.mode === NpcMode.WANDER && entry.ownerHits === 0), `${phase}: passive, as before BC-02`);
          }
          const attacks = trace.filter(entry => entry.phase === 'owner attacks');
          if (attacks.length) assert(attacks.every(entry => entry.target === 'owner') && attacks.some(entry => entry.ownerHits > 0), 'the owner re-engages it by attacking: native retaliation');
          assert.equal(trace.at(-1).active, false, 'the actor is removed by its owned lifetime or the owner hooks');
        });
      }
      check(`${name} static placement acquires either player, without the owned timer`, () => {
        for (const hunted of ['owner', 'other']) {
          const result = staticAcquisition(name, hunted);
          assert.deepEqual(result, { owned: -1, timer: -1, hunt: -1, target: hunted }, JSON.stringify(result));
        }
      });
    }
    const cost = ownedTimerCommands('barrows_bloodworm', draws);
    console.log(`PASS BC-02 owned-timer commands per tick per owned tunnel actor: ${JSON.stringify(cost)}`);
    if (basePack) {
      // Acceptance comparison in this process: the same inputs on the pre-BC-02 pack.
      const usePack = dir => { for (const config of Object.values(rt.configs)) config.load(dir); DbTableIndex.init(); rt.select(dir); };
      const behaviour = trace => trace.map(({ phase, mode, target, active, hunt, ownerHits, otherHits }) => ({ phase, mode, target, active, hunt, ownerHits, otherHits }));
      const report = {};
      try {
        for (const [label, dir] of [['base', basePack], ['head', packDir]]) {
          usePack(dir);
          const packDraws = doorDraws();
          report[label] = { cost: ownedTimerCommands('barrows_bloodworm', packDraws), types: {} };
          for (const name of Object.keys(TYPES)) {
            const row = report[label].types[name] = { statics: ['owner', 'other'].map(hunted => staticAcquisition(name, hunted).target), runs: {} };
            // The engaged case is not compared: the guard goes passive at its first owned-timer
            // turn; before BC-02 the shared attack reset waited for the next attack turn.
            for (const leave of packDraws.has(name) ? ['walks away', 'crosses a door'] : []) {
              const { trace } = lifetime(name, packDraws, leave);
              row.runs[leave] = { behaviour: behaviour(trace), positions: trace.map(entry => [entry.x, entry.z]) };
            }
          }
        }
      } finally { usePack(packDir); }
      let moved = 0;
      for (const name of Object.keys(TYPES)) {
        for (const [leave, run] of Object.entries(report.head.types[name].runs)) {
          assert.deepEqual(run.behaviour, report.base.types[name].runs[leave].behaviour, `${name}, the owner ${leave}: same owned lifetime behaviour as before BC-02`);
          moved += run.positions.filter((position, index) => position.join() !== report.base.types[name].runs[leave].positions[index].join()).length;
        }
        assert.deepEqual(report.base.types[name].statics, [null, null], `${name} static placement was passive before BC-02`);
        assert.deepEqual(report.head.types[name].statics, ['owner', 'other'], `${name} static placement now acquires either player`);
      }
      console.log(`PASS BC-02 base comparison: owned door actors behave as before BC-02 for the same inputs; only static placements gained aggression ${JSON.stringify({ base: report.base.cost, head: report.head.cost, ticksWithDifferentPosition: moved })}`);
    }
    const poison = fs.readFileSync(path.join(contentRoot, 'tests/barrows/test_poison.mjs'), 'utf8');
    assert(poison.includes('[35, 31]'), 'S04 crypt-rat fixture remains exactly [35,31]');
    console.log(`PASS BC-02 ${count} native tunnel cases; unchanged static/removal/credit/D4/poison suites remain registered`);
  } finally {
    if (zone) zone.leave(World.players[1]);
    rt.dispose();
    if (World.players[1]) { World.players[1].unlink(); World.players[1] = null; }
  }
});
