#!/usr/bin/env node
/** Real packed S2 recovery, login, heat, spell, credit and expiry dispatch. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.on('uncaughtException', error => { console.error(error); process.exit(1); });
process.on('unhandledRejection', error => { console.error(error); process.exit(1); });
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = relative => import(pathToFileURL(path.join(engine, relative)).href);
const World = (await load('src/engine/World.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const Npc = (await load('src/engine/entity/Npc.ts')).default;
const Obj = (await load('src/engine/entity/Obj.ts')).default;
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const { NpcStat } = await load('src/engine/entity/NpcStat.ts');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType',
  'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType',
  'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'Component', 'FontType']) {
  types[name] = (await load(`src/cache/config/${name}.ts`)).default;
  types[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
assert(ScriptProvider.load(pack) > 0, 'pack the sibling engine first');
const ScriptVarType = (await load('src/cache/config/ScriptVarType.ts')).default;
World.vars = Int32Array.from({ length: types.VarSharedType.count }, (_, i) =>
  types.VarSharedType.get(i).type === ScriptVarType.INT ? 0 : -1);
World.varsString = new Array(types.VarSharedType.count);
const require = createRequire(path.join(engine, 'package.json'));
const { unzipSync } = require('fflate');
const names = new Set(['m51_146', 'l51_146']);
const maps = unzipSync(fs.readFileSync(path.join(pack, '.cache/maps-server.zip')), { filter: e => names.has(e.name) });
World.gameMap.loadPackedMapsquare({ m: maps.m51_146, l: maps.l51_146, n: new Uint8Array(), o: new Uint8Array() }, 51 * 64, 146 * 64);
const id = (kind, name) => {
  const result = types[kind].getId(name);
  assert(result >= 0, `packed ${kind}:${name}`);
  return result;
};
const inv = id('InvType', 'inv');
const worn = id('InvType', 'worn');
const bank = id('InvType', 'bank');
const diamond = id('ObjType', 'fd_diamond_fire');
const torchBits = [1, 2, 3, 4].map(n => `fd_torch_count${n}`);
const get = (p, name) => p.getVarBit(id('VarBitType', name));
const set = (p, name, value) => p.setVarBit(id('VarBitType', name), value);
const script = name => {
  const result = ScriptProvider.getByName(name);
  assert(result, `compiled ${name}`);
  return result;
};
function run(p, name, target = null, args = []) {
  const state = ScriptRunner.init(script(name), p, target, args);
  assert.equal(p.runScript(state, true, true), ScriptState.FINISHED, `${name} finishes`);
  return state;
}
let serial = 0;
function player() {
  const slot = ++serial;
  World.currentTick = 1000 * slot;
  const p = new Player(`s2_effect_${slot}`, BigInt(slot), BigInt(10000 + slot));
  p.slot = slot; p.pid = slot; p.uid = (slot << 11) | slot;
  p.x = 3306; p.z = 9375; p.level = 0; p.isActive = true;
  p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(130344310);
  p.packets = [];
  p.write = packet => p.packets.push(packet); // Observe transport only.
  p.setVar(id('VarPlayerType', 'tutorial'), 1000);
  set(p, 'deserttreasure', 10);
  World.players[slot] = p; World.playerLoop.add(p.hash64, p);
  return p;
}
function actor(p) {
  const t = types.NpcType.get(1977);
  const n = new Npc(0, 3309, 9376, t.size, t.size, EntityLifeCycle.DESPAWN, World.getNextNid(), t.id, t.blockwalk);
  World.addNpc(n, 1000);
  n.setVar(id('VarNpcType', 'npc_attacking_uid'), p.uid);
  n.setVar(id('VarNpcType', 'npc_aggressive_player'), p.uid);
  return n;
}
function grounds() {
  const found = [];
  for (let x = 3304; x <= 3328; x += 8) for (let z = 9360; z <= 9400; z += 8) {
    for (const o of World.gameMap.getZone(x, z, 0).getAllObjsSafe()) if (o.type === diamond) found.push(o);
  }
  return found;
}
function ownGround(p) {
  return grounds().filter(o => o.isValid(p.hash64) && (o.receiver64 === p.hash64 || o.receiver64 === Obj.NO_RECEIVER));
}
function gate(p) {
  p.x = 3304; p.z = 9375;
  run(p, '[oploc1,fd_fw_metalgateclosed_l]');
  assert.deepEqual([p.x, p.z], [3306, 9375]);
}
const cases = {
  recovery() {
    const p = player();
    set(p, 'fd_firewargate', 1); set(p, 'fd_killed_firewarrior', 1);
    gate(p);
    assert.equal(p.invTotal(inv, diamond), 0, 're-entry must not award an inventory diamond');
    assert.equal(ownGround(p).length, 1, 're-entry creates one owner-visible ground diamond');
    assert.deepEqual([ownGround(p)[0].x, ownGround(p)[0].z], [3316, 9377], 'candidate recovery tile');
    const original = ownGround(p)[0];
    gate(p);
    assert.deepEqual(ownGround(p), [original], 're-entry while ground reward remains cannot duplicate it');
    assert.equal(get(p, 'fd_killed_firewarrior'), 1);
    World.removeObj(original, 0);
    for (const [x, z] of [[3305, 9373], [3318, 9393]]) {
      const dropped = new Obj(0, x, z, EntityLifeCycle.DESPAWN, diamond, 1);
      World.addObj(dropped, p.hash64, 300);
      gate(p);
      assert.deepEqual(ownGround(p), [dropped], 'ground visibility covers the west strip and far chamber edge');
      World.removeObj(dropped, 0);
    }
    for (const location of [inv, bank, worn]) {
      p.invAdd(location, diamond, 1);
      gate(p);
      assert.equal(ownGround(p).length, 0, 'held, banked or worn ownership prevents recovery');
      p.invDel(location, diamond, 1);
    }
    set(p, 'fd_column_fire', 1);
    gate(p);
    assert.equal(ownGround(p).length, 0, 'placed diamond prevents recovery');
    set(p, 'fd_column_fire', 0);
    const stranger = player();
    const foreign = new Obj(0, 3316, 9377, EntityLifeCycle.DESPAWN, diamond, 1);
    World.addObj(foreign, stranger.hash64, 300);
    gate(p);
    assert.equal(ownGround(p).length, 1, 'another player private ground cannot suppress owner recovery');
    assert.notStrictEqual(ownGround(p)[0], foreign);
  },
  login() {
    const p = player();
    for (const bit of [...torchBits, 'fd_firechest', 'fd_firewargate', 'fd_killed_firewarrior']) set(p, bit, 1);
    const before = ['deserttreasuremain', 'deserttreasurevarbit', 'deserttreasurevarbit2'].map(n => p.getVar(id('VarPlayerType', n)));
    assert.equal(p.timers.size, 0, 'fresh session has saved bits but no timers');
    run(p, '[login,_]');
    assert.deepEqual(torchBits.map(n => get(p, n)), [0, 0, 0, 0], 'packed login clears saved torch bits');
    assert.deepEqual(['fd_firechest', 'fd_firewargate', 'fd_killed_firewarrior'].map(n => get(p, n)), [1, 1, 1]);
    const after = ['deserttreasuremain', 'deserttreasurevarbit', 'deserttreasurevarbit2'].map(n => p.getVar(id('VarPlayerType', n)));
    assert.deepEqual(after.map((n, i) => (n ^ before[i]) >>> 0), [0, 30, 0], 'login masks only the four original torch bits');
  },
  disarm() {
    const p = player(); const n = actor(p);
    p.x = 3310; p.z = 9378; // Admitted even on merge head, but farther than one tile.
    const weapon = id('ObjType', 'rune_scimitar');
    p.invSet(worn, weapon, 1, 3);
    let groundBefore = World.gameMap.getZone(p.x, p.z, 0).totalObjs;
    for (let repeat = 0; repeat < 2; repeat++) {
      const state = ScriptRunner.init(script('[ai_timer,firediamond_firewarrior]'), n);
      n.executeScript(state);
      assert.equal(state.execution, ScriptState.FINISHED);
      assert.equal(p.invGetSlot(worn, 3), null, 'owned room heat disarms beyond melee distance');
      assert.equal(World.gameMap.getZone(p.x, p.z, 0).totalObjs, ++groundBefore, 'weapon moves to real ground exactly once');
      if (repeat === 0) p.invSet(worn, weapon, 1, 3);
    }
    p.invSet(worn, weapon, 1, 3);
    p.invSet(worn, id('ObjType', 'ice_gloves'), 1, 9);
    const state = ScriptRunner.init(script('[ai_timer,firediamond_firewarrior]'), n);
    n.executeScript(state);
    assert.equal(p.invGetSlot(worn, 3)?.id, weapon, 'ice gloves protect at a distance');
    World.removeNpc(n, 0);
  },
  magic() {
    // Seed the real engine PRNG, do not replace any RNG or script handler.
    const seeds = new Map();
    for (let seed = 0; seeds.size < 4 && seed < 100000; seed++) {
      JavaRandom.setSeed(seed);
      const bucket = Math.floor(JavaRandom.nextDouble() * 4);
      if (!seeds.has(bucket)) seeds.set(bucket, seed);
    }
    assert.equal(seeds.size, 4);
    for (const [bucket, seed] of seeds) {
      const p = player(); const n = actor(p);
      p.x = 3308; p.z = 9376;
      n.setVar(id('VarNpcType', 'npc_action_delay'), 0);
      JavaRandom.setSeed(seed);
      const state = ScriptRunner.init(script('[ai_opplayer2,firediamond_firewarrior]'), n, p);
      n.executeScript(state);
      assert.equal(state.execution, ScriptState.FINISHED);
      const casting = [id('SeqType', 'human_casting'), id('SeqType', 'human_caststrike')].includes(n.animId);
      assert.equal(casting, bucket === 0, `magic only for one of four real random buckets (bucket ${bucket}, animation ${n.animId})`);
      World.removeNpc(n, 0);
    }
    let success = false;
    for (let seed = seeds.get(0); seed < seeds.get(0) + 100 && !success; seed++) {
      const p = player(); const n = actor(p);
      p.x = 3308; p.z = 9376;
      p.baseLevels[PlayerStat.MAGIC] = 50; p.levels[PlayerStat.MAGIC] = 50;
      const before = Array.from(p.levels);
      JavaRandom.setSeed(seed);
      const state = ScriptRunner.init(script('[ai_opplayer2,firediamond_firewarrior]'), n, p);
      n.executeScript(state);
      assert.equal(state.execution, ScriptState.FINISHED);
      if (n.animId === id('SeqType', 'human_casting') && p.spotanimId === id('SpotanimType', 'zamorak_flame')) {
        const damage = [...p.queue.all()].find(q => q.script.name === '[queue,combat_damage_player]');
        assert(damage, 'successful Flames schedules real combat damage');
        assert(damage.args[0] >= 0 && damage.args[0] <= 20, 'period magic cap remains 20');
        assert.deepEqual(Array.from(p.levels), before, 'Flames graphics do not drain Magic or any other stat');
        success = true;
      }
      World.removeNpc(n, 0);
    }
    assert(success, 'bounded seeded casts include successful Flames of Zamorak impact');
  },
  masks() {
    for (const base of [9, 10]) {
      const p = player();
      p.baseLevels[PlayerStat.SLAYER] = base; p.levels[PlayerStat.SLAYER] = 99;
      const type = types.ObjType.get(id('ObjType', 'slayer_facemask'));
      p.invSet(inv, type.id, 1, 0); p.lastItem = type.id; p.lastSlot = 0;
      const handler = ScriptProvider.getByTrigger(ServerTriggerType.OPHELD2, type.id, type.category);
      assert.equal(handler.name, '[opheld2,slayer_facemask]', 'item dispatch covers the generic equip path');
      const state = ScriptRunner.init(handler, p);
      assert.equal(p.runScript(state, true, true), ScriptState.FINISHED);
      assert.equal(p.invTotal(worn, type.id), Number(base >= 10), 'base Slayer, not the boosted level, gates wearing');
    }
    // Control: without a mask the same timer run hurts, so the two "prevents" assertions below can fail.
    const unmasked = player(); unmasked.x = 3206; unmasked.z = 9379;
    const unmaskedHp = unmasked.levels[PlayerStat.HITPOINTS];
    run(unmasked, '[timer,dt_smoke_damage]');
    assert.equal(unmasked.levels[PlayerStat.HITPOINTS], unmaskedHp - 20, 'unmasked Smoke damage is 20 hitpoints');
    const p = player(); p.x = 3206; p.z = 9379;
    for (const name of ['slayer_facemask', 'gasmask']) {
      const type = types.ObjType.get(id('ObjType', name));
      assert.equal(type.wearpos, 0, 'original protection uses the head slot');
      if (name === 'gasmask') {
        assert.equal(type.id, 1506);
        assert.equal(type.name, 'Gas mask');
      }
      p.invSet(worn, type.id, 1, 0);
      const hp = p.levels[PlayerStat.HITPOINTS];
      run(p, '[timer,dt_smoke_damage]');
      assert.equal(p.levels[PlayerStat.HITPOINTS], hp, `${name} prevents Smoke damage`);
    }
  },
  death() {
    for (const heroIsOwner of [true, false]) for (const full of [false, true]) {
      const p = player(); const spectator = player(); const n = actor(p);
      set(p, 'fd_firewargate', 1); set(spectator, 'fd_firewargate', 1);
      if (full) p.invAdd(inv, id('ObjType', 'bronze_dagger'), 28);
      n.heroPoints.addHero((heroIsOwner ? p : spectator).hash64, 130);
      n.applyDamage(n.levels[NpcStat.HITPOINTS], 1);
      const state = ScriptRunner.init(script('[ai_queue3,firediamond_firewarrior]'), n);
      n.executeScript(state);
      for (let tick = 0; state.execution === ScriptState.NPC_SUSPENDED && tick < 20; tick++) {
        for (const a of [p, spectator]) a.processQueues();
        World.currentTick = Math.max(World.currentTick + 1, n.delayedUntil);
        n.delayed = false; n.executeScript(state);
      }
      for (const a of [p, spectator]) a.processQueues();
      assert.equal(state.execution, ScriptState.FINISHED, 'packed Fareed and shared death finish');
      assert.equal(n.isActive, false, 'real shared death removes Fareed');
      assert.equal(get(p, 'fd_killed_firewarrior'), Number(heroIsOwner), 'only owning hero gets kill credit');
      assert.equal(get(spectator, 'fd_killed_firewarrior'), 0, 'nonowner hero never gets hunt credit');
      assert.equal(spectator.invTotal(inv, diamond), 0, 'nonowner never gets diamond');
      assert.equal(p.invTotal(inv, diamond), heroIsOwner && !full ? 1 : 0);
      if (heroIsOwner && full) {
        const original = ownGround(p);
        assert.equal(original.length, 1, 'full inventory kill awards one real ground diamond');
        gate(p);
        assert.deepEqual(ownGround(p), original, 'full-inventory death drop guards re-entry recovery');
      }
      for (const a of [p, spectator]) assert.equal(get(a, 'deserttreasure'), 10, 'death never advances quest stage');
    }
  }
};
const chosen = process.argv[2] ? [process.argv[2]] : Object.keys(cases);
let failed = false;
for (const name of chosen) {
  assert(cases[name], `unknown case ${name}`);
  try { cases[name](); console.log(`PASS packed S2 ${name}`); }
  catch (error) { failed = true; console.error(`FAIL packed S2 ${name}`, error); }
}
process.exit(failed ? 1 : 0);
