#!/usr/bin/env node
/** Compiled Stranger encounter, real packed collision and native combat. Run from sibling engine. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = relative => import(pathToFileURL(path.join(engine, relative)).href);
const World = (await load('src/engine/World.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const Trigger = (await load('src/engine/script/ServerTriggerType.ts')).default;
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const Environment = (await load('src/util/Environment.ts')).default;
const { isMapBlocked, isLineOfWalk, isIndoors } = await load('src/engine/GameMap.ts');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType',
  'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType',
  'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'Component', 'FontType']) {
  types[name] = (await load(`src/cache/config/${name}.ts`)).default;
  types[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
const { changeFloor, findPath, CollisionType } = await load('src/engine/routefinder/index.ts');
assert(ScriptProvider.load(pack) > 0, 'build the sibling engine first');
Environment.NODE_MEMBERS = true;
const require = createRequire(path.join(engine, 'package.json'));
const { unzipSync } = require('fflate');
const squares = [[50, 50], [49, 53]];
const mapNames = new Set(squares.flatMap(([x, z]) => [`m${x}_${z}`, `l${x}_${z}`]));
const maps = unzipSync(fs.readFileSync(path.join(pack, '.cache/maps-server.zip')), { filter: e => mapNames.has(e.name) });
for (const [x, z] of squares) {
  assert(maps[`m${x}_${z}`]?.length && maps[`l${x}_${z}`]?.length, 'real packed map required');
  World.gameMap.loadPackedMapsquare({ m: maps[`m${x}_${z}`], l: maps[`l${x}_${z}`], n: new Uint8Array(), o: new Uint8Array() }, x * 64, z * 64);
}
const id = (kind, name) => { const value = types[kind].getId(name); assert(value >= 0, `${kind}:${name}`); return value; };
const inv = id('InvType', 'inv'), bank = id('InvType', 'bank');
const stranger = id('NpcType', 'fourdiamonds_assasin');
const diamonds = ['fd_blood_diamond', 'fd_dark_diamond', 'fd_diamond_fire', 'fd_icediamond'];
const uidVar = id('VarPlayerType', 'dt_stranger_uid');
const ownerVar = id('VarNpcType', 'npc_attacking_uid');
const script = name => { const value = ScriptProvider.getByName(name); assert(value, `compiled ${name}`); return value; };
const pvar = (p, name, value) => p.setVar(id('VarPlayerType', name), value);
const bit = (p, name, value) => p.setVarBit(id('VarBitType', name), value);
function run(p, name, target = null, args = []) {
  const state = ScriptRunner.init(script(name), p, target, args);
  assert.equal(p.runScript(state, true, true), ScriptState.FINISHED, `${name} finishes`);
  return state;
}
function ai(n, name, target = null, lastInt = 0) {
  const state = ScriptRunner.init(script(name), n, target); state.lastInt = lastInt;
  n.executeScript(state);
  return state;
}
function rng(values, fn, tileRoll = 0) {
  const previous = JavaRandom.nextDouble, oldMath = Math.random;
  let at = 0;
  JavaRandom.nextDouble = () => values[Math.min(at++, values.length - 1)];
  Math.random = () => tileRoll;
  try { return fn(); } finally { JavaRandom.nextDouble = previous; Math.random = oldMath; }
}
const actors = () => [...World.npcs].filter(n => n.isActive && n.type === stranger);
function clearActors() { for (const n of actors()) World.removeNpc(n, 0); }
let serial = 0;
function player(stage = 10, diamond = diamonds[0], x = 3230, z = 3230, level = 0) {
  const slot = ++serial;
  World.currentTick = 10000 + slot * 100;
  const p = new Player(`dtstr_fixture_${slot}`, BigInt(slot), BigInt(80000 + slot));
  p.slot = slot; p.pid = slot; p.uid = ((slot << 11) | slot) >>> 0;
  p.x = x; p.z = z; p.level = level; p.isActive = true;
  p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(130344310);
  p.write = () => {}; p.messages = [];
  p.messageGame = text => p.messages.push(text); p.wrappedMessageGame = p.messageGame;
  pvar(p, 'tutorial', 1000); bit(p, 'deserttreasure', stage);
  if (diamond) p.invAdd(inv, id('ObjType', diamond), 1);
  World.players[slot] = p; World.playerLoop.add(p.hash64, p);
  World.gameMap.getZone(x, z, level).enter(p);
  return p;
}
function ambush(p) {
  rng([0], () => run(p, '[timer,dt_stranger]'));
  const n = actors().find(n => n.getVar(ownerVar) === p.uid);
  assert(n, 'real compiled timer spawns an owned Stranger');
  return n;
}
const questWords = p => ['deserttreasuremain', 'deserttreasurevarbit', 'deserttreasurevarbit2', 'alternate_spells']
  .map(name => p.getVar(id('VarPlayerType', name)));
const cases = {
  trigger() {
    assert.equal(uidVar, 420, 'reuses assigned original slot, never appends a varp');
    assert.equal(types.VarPlayerType.get(uidVar).scope, types.VarPlayerType.SCOPE_TEMP);
    assert.equal(types.VarPlayerType.get(uidVar).transmit, false);
    assert.equal(stranger, 1919, 'original NPC identity');
    for (const stage of [0, 8, 9, 15, 16]) {
      clearActors(); const p = player(stage);
      run(p, '[proc,dt_stranger_login]');
      assert(!p.timers.has(script('[timer,dt_stranger]').id), 'ineligible stage has no encounter timer');
      rng([0], () => run(p, '[timer,dt_stranger]'));
      assert.equal(actors().length, 0, `stage ${stage} cannot spawn even on winning RNG`);
    }
    for (const diamond of diamonds) {
      clearActors(); const p = player(10, diamond), before = questWords(p);
      run(p, '[proc,dt_stranger_login]');
      rng([0.99], () => run(p, '[timer,dt_stranger]'));
      assert.equal(actors().length, 0, 'losing RNG does not spawn');
      const n = ambush(p);
      assert.equal(p.getVar(uidVar), n.uid);
      assert.equal(n.levels[3], 80, 'inherited HP unchanged');
      assert(n.sayMessage.includes('You are not worthy of holding that Diamond of '), 'candidate overhead is emitted');
      rng([0], () => run(p, '[timer,dt_stranger]'));
      assert.equal(actors().length, 1, 'active token prevents duplicate');
      p.x += 1000; // same player timer before old actor cleanup: still no duplicate
      rng([0], () => run(p, '[timer,dt_stranger]'));
      assert.equal(actors().length, 1, 'exact identity also survives a move outside local scans');
      assert.deepEqual(questWords(p), before);
      assert.equal(p.invTotal(inv, id('ObjType', diamond)), 1, 'ambush never takes the diamond');
    }
    clearActors(); const p = player(10, null);
    p.invAdd(bank, id('ObjType', diamonds[0]), 1);
    rng([0], () => run(p, '[timer,dt_stranger]'));
    assert.equal(actors().length, 0, 'bank-only diamonds do not trigger');
    for (const stage of [11, 12, 13, 14]) {
      clearActors(); ambush(player(stage));
    }
  },
  topology() {
    clearActors(); const p = player();
    assert.equal(isMapBlocked(p.x, p.z, 0), false, 'independent Lumbridge-road fixture is walkable');
    assert.equal(isIndoors(p.x, p.z, 0), false, 'fixture is outdoors');
    const seen = new Set();
    for (const tileRoll of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      rng([0], () => run(p, '[timer,dt_stranger]'), tileRoll);
      const n = actors()[0]; assert(n, 'adjacent surface candidate spawns');
      assert.equal(Math.max(Math.abs(n.x - p.x), Math.abs(n.z - p.z)), 1);
      assert.equal(isMapBlocked(n.x, n.z, n.level), false, 'actual packed floor/loc collision');
      assert.equal(isLineOfWalk(0, n.x, n.z, p.x, p.z), true, 'spawn can reach the player');
      assert.equal(isIndoors(n.x, n.z, 0), false);
      assert(findPath(0, n.x, n.z, 3232, 3230, 1, 1, 1, 0, -1, false, 0, 25, CollisionType.NORMAL).length > 0,
        'packed route leads out of the spawn tile to an independent road waypoint');
      seen.add(`${n.x},${n.z}`); run(p, '[proc,dt_stranger_logout]');
    }
    assert(seen.size > 1, 'different real adjacent candidates tested');
    for (const [x, z, level] of [[3184, 3436, 0], [3230, 3230, 1], [3230, 9630, 0], [2830, 3350, 0], [2390, 3090, 0], [3365, 3275, 0]]) {
      const excluded = player(10, diamonds[0], x, z, level);
      rng([0], () => run(excluded, '[timer,dt_stranger]'));
      assert.equal(actors().length, 0, `safe/non-overworld ${level}:${x},${z} excluded`);
    }
    let indoors, blocked;
    for (let x = 3200; x < 3264; x++) for (let z = 3200; z < 3264; z++) {
      if (!indoors && isIndoors(x, z, 0) && !isMapBlocked(x, z, 0)) indoors = [x, z];
      if (!blocked && isMapBlocked(x, z, 0)) blocked = [x, z];
    }
    assert(indoors && blocked, 'real packed roof and blocked witnesses exist');
    for (const [x, z] of [indoors, blocked]) {
      const excluded = player(10, diamonds[0], x, z);
      rng([0], () => run(excluded, '[timer,dt_stranger]'));
      assert.equal(actors().length, 0, 'real roof or blocked source tile cannot trigger');
    }
    // Engineering collision fixture for native MAP_FINDSQUARE's no-candidate origin fallback.
    const enclosed = player(), ring = [];
    for (let x = enclosed.x - 1; x <= enclosed.x + 1; x++) for (let z = enclosed.z - 1; z <= enclosed.z + 1; z++) {
      if ((x !== enclosed.x || z !== enclosed.z) && !isMapBlocked(x, z, 0)) ring.push([x, z]);
    }
    try {
      for (const [x, z] of ring) changeFloor(x, z, 0, true);
      rng([0], () => run(enclosed, '[timer,dt_stranger]'));
      assert.equal(actors().length, 0, 'no adjacent walkable tile never stacks an actor on the owner');
    } finally { for (const [x, z] of ring) changeFloor(x, z, 0, false); }
  },
  ownership() {
    clearActors(); const p = player(), other = player(), n = ambush(p);
    for (const guard of ['npc_is_attackable', 'npc_is_attackable_opt', 'npc_is_attackable_opt_quiet']) {
      assert.equal(run(p, `[proc,${guard}]`, n).popInt(), 1, `${guard}: owner admitted`);
      assert.equal(run(other, `[proc,${guard}]`, n).popInt(), 0, `${guard}: spectator refused`);
      assert.deepEqual(other.messages, [], 'quiet owner guard emits no invented refusal');
    }
    const t = types.NpcType.get(stranger);
    assert.equal(ScriptProvider.getByTrigger(Trigger.OPNPC2, stranger, t.category).name, '[opnpc2,fourdiamonds_assasin]');
    assert.equal(ScriptProvider.getByTrigger(Trigger.APNPC2, stranger, t.category).name, '[apnpc2,fourdiamonds_assasin]');
    ai(n, '[ai_opplayer2,fourdiamonds_assasin]', other);
    assert.equal([...other.queue.all()].length, 0, 'actor cannot attack a spectator');
    const goblinType = id('NpcType', 'goblin');
    const Npc = n.constructor;
    const goblin = new Npc(0, p.x + 1, p.z, 1, 1, n.lifecycle, World.getNextNid(), goblinType, 0);
    World.addNpc(goblin, 10);
    for (const guard of ['npc_is_attackable', 'npc_is_attackable_opt', 'npc_is_attackable_opt_quiet']) assert.equal(run(other, `[proc,${guard}]`, goblin).popInt(), 1, 'ordinary combat admission unchanged');
    World.removeNpc(goblin, 0);
  },
  combat() {
    clearActors(); const p = player(), n = ambush(p);
    World.currentTick += 2; p.levels[1] = 1;
    n.setVar(id('VarNpcType', 'npc_action_delay'), 0);
    rng([0.99, 0, 0.99, 0.99, 0], () => ai(n, '[ai_opplayer2,fourdiamonds_assasin]', p));
    const damage = [...p.queue.all()].filter(q => q.script.name === '[queue,combat_damage_player]');
    assert.equal(damage.length, 1, 'ordinary dagger attack uses the real melee queue');
    assert(damage[0].args[0] > 0, 'controlled accuracy lands positive native damage');
    p.processQueues();
    assert(p.levels[3] < 99, 'native combat queue actually reduces hitpoints');
    assert.equal(p.getVar(id('VarPlayerType', 'poison')), 20, 'native poison queue applies severity20');
    p.queue.clear(); World.currentTick += 10;
    n.setVar(id('VarNpcType', 'npc_action_delay'), 0);
    rng([0.99, 0, 0.99, 0, 0.99, 0, 0.99, 0.99], () => ai(n, '[ai_opplayer2,fourdiamonds_assasin]', p));
    assert.equal([...p.queue.all()].filter(q => q.script.name === '[queue,combat_damage_player]').length, 2, 'special performs two independent real melee attacks');
    n.setVar(id('VarNpcType', 'npc_poison'), 20);
    const hp = n.levels[3];
    for (let tick = 0; tick < 30; tick++) ai(n, '[ai_timer,fourdiamonds_assasin]');
    assert(n.levels[3] < hp, 'being poisoned cannot replace and disable the lifecycle timer');
  },
  cleanup() {
    for (const reason of ['banked', 'completed', 'dead', 'distance', 'offline', 'logout', 'safe']) {
      clearActors(); const p = player(), n = ambush(p), before = questWords(p);
      if (reason === 'banked') { p.invDel(inv, id('ObjType', diamonds[0]), 1); p.invAdd(bank, id('ObjType', diamonds[0]), 1); }
      if (reason === 'completed') bit(p, 'deserttreasure', 15);
      if (reason === 'dead') pvar(p, 'death', 1);
      if (reason === 'distance') p.x += 17;
      if (reason === 'offline') { World.players[p.slot] = null; p.unlink(); }
      if (reason === 'safe') { p.x = 3184; p.z = 3436; }
      if (reason === 'logout') run(p, '[logout,_]');
      else ai(n, '[ai_timer,fourdiamonds_assasin]');
      assert.equal(n.isActive, false, `${reason}: actor removed`);
      if (reason !== 'completed') assert.deepEqual(questWords(p), before, `${reason}: quest progress untouched`);
    }
    clearActors(); const p = player(), n = ambush(p), before = questWords(p);
    n.applyDamage(n.levels[3], 1);
    const death = ai(n, '[ai_queue3,fourdiamonds_assasin]');
    for (let tick = 0; death.execution === ScriptState.NPC_SUSPENDED && tick < 10; tick++) {
      World.currentTick = Math.max(World.currentTick + 1, n.delayedUntil); n.delayed = false; n.executeScript(death);
    }
    assert.equal(death.execution, ScriptState.FINISHED, 'native death completes');
    assert.equal(n.isActive, false, 'real kill removes the actor');
    assert.deepEqual(questWords(p), before, 'kill never changes quest stages or rewards');
    ambush(p); assert.equal(actors().length, 1, 'stale killed identity permits a later eligible encounter');
    run(p, '[proc,dt_stranger_logout]');
    assert.equal(p.getVar(uidVar), -1, 'logout releases the exact temporary token');
    const timed = ambush(p);
    assert.equal(timed.lifecycleTick, 300, 'compiled spawn schedules the bounded native actor lifetime');
    for (let tick = 1; tick <= 300; tick++) {
      World.currentTick++;
      timed.turn();
      assert.equal(timed.isActive, tick < 300, `native lifecycle boundary ${tick}`);
    }
    assert.deepEqual(questWords(p), before, 'timeout leaves quest and rewards untouched');
    // Native attacks update lastcombat. Re-arm only after the existing combat cooldown.
    World.currentTick += 9;
    ambush(p);
    run(p, '[proc,dt_stranger_logout]');
    const plain = player(0, null), words = questWords(plain);
    run(plain, '[proc,dt_stranger_login]'); run(plain, '[proc,dt_stranger_logout]');
    assert.deepEqual(questWords(plain), words, 'ordinary lifecycle stays unchanged');
  }
};
let failed = false;
for (const name of process.argv[2] ? [process.argv[2]] : Object.keys(cases)) {
  try { assert(cases[name], name); cases[name](); console.log(`PASS packed Stranger ${name}`); }
  catch (error) { failed = true; console.error(`FAIL packed Stranger ${name}`, error); }
  finally { clearActors(); }
}
process.exit(failed ? 1 : 0);
