#!/usr/bin/env node
/** Native packed attacks, independent fixed-seed outcome contracts and rule mutants. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { elementalSeeds, elementalOracle, assertElementalOutcome } from './elemental-oracle.mjs';

process.on('uncaughtException', error => { console.error(error); process.exit(1); });
process.on('unhandledRejection', error => { console.error(error); process.exit(1); });
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = relative => import(pathToFileURL(path.join(engine, relative)).href);
const World = (await load('src/engine/World.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const Npc = (await load('src/engine/entity/Npc.ts')).default;
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
const { ScriptOpcodeNameMap } = await load('src/engine/script/ScriptOpcode.ts');
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
const synthNames = new Map(fs.readFileSync(path.join(content, 'pack/synth.pack'), 'utf8').trim().split('\n').map(line => {
  const [number, name] = line.split('='); return [name, Number(number)];
}));
types.SynthType = { getId: name => synthNames.get(name) ?? -1 };
const { isMapBlocked } = await load('src/engine/GameMap.ts');
const scriptCount = ScriptProvider.load(pack);
assert(scriptCount > 0, 'build the sibling production pack first');
const ScriptVarType = (await load('src/cache/config/ScriptVarType.ts')).default;
World.vars = Int32Array.from({ length: types.VarSharedType.count }, (_, i) =>
  types.VarSharedType.get(i).type === ScriptVarType.INT ? 0 : -1);
World.varsString = new Array(types.VarSharedType.count);
const require = createRequire(path.join(engine, 'package.json'));
const { unzipSync } = require('fflate');
const mapNames = new Set(['m51_146', 'l51_146', 'm44_59', 'l44_59']);
const maps = unzipSync(fs.readFileSync(path.join(pack, '.cache/maps-server.zip')), { filter: e => mapNames.has(e.name) });
for (const [x, z] of [[51, 146], [44, 59]]) {
  World.gameMap.loadPackedMapsquare({ m: maps[`m${x}_${z}`], l: maps[`l${x}_${z}`], n: new Uint8Array(), o: new Uint8Array() }, x * 64, z * 64);
}
const id = (kind, name) => {
  const value = types[kind].getId(name);
  assert(value >= 0, `packed ${kind}:${name}`);
  return value;
};
const inv = id('InvType', 'inv'), worn = id('InvType', 'worn');
const magicParam = id('ParamType', 'dt_elemental_magic');
const ammoParam = id('ParamType', 'dt_elemental_ammo');
const script = name => { const result = ScriptProvider.getByName(name); assert(result, name); return result; };
const set = (p, name, value) => p.setVar(id('VarPlayerType', name), value);
const bit = (p, name, value) => p.setVarBit(id('VarBitType', name), value);
const npcVar = (n, name, value) => n.setVar(id('VarNpcType', name), value);
const objects = Array.from({ length: types.ObjType.count }, (_, i) => types.ObjType.get(i));
const object = name => {
  const result = objects.find(t => (t.name === name || t.debugname === name) && t.certtemplate === -1 && t.wearpos >= 0);
  assert(result, `original object ${name}`);
  return result;
};
const canonical = value => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v));
function run(p, n, name, args = []) {
  const state = ScriptRunner.init(script(name), p, n, args);
  assert.equal(p.runScript(state, true, true), ScriptState.FINISHED, `${name} finishes`);
  return state;
}
let trace = null;
for (const [opcode, original] of Object.entries(ScriptRunner.HANDLERS)) {
  if (Number(opcode) <= 100) continue;
  ScriptRunner.HANDLERS[opcode] = state => {
    if (trace) trace.push({ command: ScriptOpcodeNameMap.get(Number(opcode)),
      ints: state.intStack.slice(0, state.isp), strings: state.stringStack.slice(0, state.ssp) });
    original(state); // Observer only: never replace a command, RNG draw or result.
  };
}
function fixture(type, equipment = []) {
  World.currentTick = 1000;
  const p = new Player('elemental_test', 1n, 10001n);
  p.slot = 1; p.pid = 1; p.uid = 2049; p.isActive = true;
  p.x = type === 1913 ? 2843 : 3308; p.z = type === 1913 ? 3779 : 9377; p.level = 0;
  p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(130344310);
  p.packets = []; p.write = packet => p.packets.push(canonical(packet)); // Transport observation only.
  set(p, 'tutorial', 1000); bit(p, 'deserttreasure', 10);
  bit(p, 'fd_firewargate', 1); bit(p, 'fd_icewarrior_subquest', 1); bit(p, 'fd_icewarrior_trollskilled', 5);
  set(p, 'iban_staff_charges', 100); set(p, 'guthmage', 100); set(p, 'zamomage', 100); set(p, 'saramage', 100);
  set(p, 'sa_energy', 1000);
  World.players[1] = p; World.playerLoop.add(p.hash64, p);
  for (const name of ['airrune', 'waterrune', 'earthrune', 'firerune', 'mindrune', 'chaosrune', 'deathrune', 'bloodrune', 'soulrune', 'naturerune']) {
    p.invAdd(inv, id('ObjType', name), 1000);
  }
  for (const name of ['Ice gloves', 'Facemask', ...equipment]) {
    const item = object(name);
    p.invSet(worn, item.id, item.stackable ? 100 : 1, item.wearpos);
  }
  run(p, null, '[proc,update_all]', [p.invs.get(worn)?.items[3]?.id ?? -1]);
  const t = types.NpcType.get(type);
  const n = new Npc(0, p.x + 1, p.z, t.size, t.size, EntityLifeCycle.DESPAWN, 1, type, t.blockwalk);
  World.addNpc(n, 1000);
  const spawn = ScriptRunner.init(script('[ai_spawn,_]'), n);
  n.executeScript(spawn); assert.equal(spawn.execution, ScriptState.FINISHED);
  npcVar(n, 'npc_attacking_uid', p.uid); npcVar(n, 'npc_aggressive_player', p.uid); npcVar(n, 'npc_macro_event_target', p.uid);
  return { p, n };
}
const magic = [
  ['wind_strike', 51, 2], ['water_strike', 1, 4], ['earth_strike', 2, 6], ['fire_strike', 3, 8],
  ['wind_bolt', 4, 9], ['water_bolt', 5, 10], ['earth_bolt', 6, 11], ['fire_bolt', 7, 12],
  ['wind_blast', 8, 13], ['water_blast', 9, 14], ['earth_blast', 10, 15], ['fire_blast', 11, 16],
  ['wind_wave', 12, 17], ['water_wave', 13, 18], ['earth_wave', 14, 19], ['fire_wave', 15, 20],
  ['iban_blast', 41, 25, ["Iban's staff"]],
  ['flames_of_zamorak', 42, 20, ['Zamorak staff', 'Zamorak cape']],
  ['claws_of_guthix', 43, 20, ['Guthix staff', 'Guthix cape']],
  ['saradomin_strike', 44, 20, ['Saradomin staff', 'Saradomin cape']],
  ['magic_dart', 60, 19, ["Slayer's staff"]], ['crumble_undead', 45, 15], ['snare', 47, 2], ['entangle', 48, 5]
];
const ranged = [
  ['arrows', 'Magic shortbow', 'Bronze arrow'], ['ice arrows', 'Magic shortbow', 'Ice arrows'],
  ['poison arrows', 'Magic shortbow', 'Rune arrow(p)'], ['broad arrows', 'Magic shortbow', 'Broad arrows'],
  ['ogre arrows', 'Ogre bow', 'Ogre arrow'], ['bolts', 'Crossbow', 'Bolts'],
  ['opal bolts', 'Crossbow', 'Opal bolts'], ['pearl bolts', 'Crossbow', 'Pearl bolts'],
  ['barbed bolts', 'Crossbow', 'Barbed bolts'], ['poison bolts', 'Crossbow', 'Bolts(p)'],
  ['darts', 'Bronze dart'], ['poison darts', 'Bronze dart(p)'], ['knives', 'Bronze knife'],
  ['poison knives', 'Bronze knife(p)'], ['thrown axes', 'Rune thrownaxe'], ['javelins', 'Bronze javelin'],
  // Published poisoned javelins occupy the quiver, not the weapon slot; a bow rejects their category.
  ['poison javelins', 'Magic shortbow', 'Bronze javelin(p)'], ['holy water', 'Holy water'],
  ['unlit fire arrows', 'Magic shortbow', 'unlitarrow'], ['lit fire arrows', 'Magic shortbow', 'litarrow']
];
const rangedSpecials = [
  ['magic_shortbow', 'Magic shortbow', 'Bronze arrow'], ['magic_shortbow', 'Magic shortbow', 'Ice arrows'],
  ['magic_shortbow', 'Magic shortbow', 'Rune arrow(p)'],
  ['magic_longbow', 'Magic longbow', 'Bronze arrow'], ['magic_longbow', 'Magic longbow', 'Ice arrows'],
  ['magic_longbow', 'Magic longbow', 'Rune arrow(p)'], ['rune_thrownaxe', 'Rune thrownaxe']
];
const poisonWitnesses = new Set();
const damageWitnesses = new Map();
const attackCase = (type, attack) => JSON.stringify([type, attack.kind, attack.row]);
function outcome(type, attack, seed, { successOnly = false, miss = false } = {}) {
  const equipment = attack.kind === 'magic' ? attack.row[3] ?? [] : ['melee', 'cannon'].includes(attack.kind) ? ['Rune scimitar'] : attack.row.slice(1);
  const { p, n } = fixture(type, equipment);
  if (attack.kind === 'cannon') {
    set(p, 'rockthrower', 30);
    set(p, 'ownedmcannon', (p.level << 28) | (p.x << 14) | p.z);
  }
  if (attack.kind === 'cannon' && attack.style !== undefined) cannonStyle(p, attack.style);
  const expected = attack.kind === 'cannon' ? null : elementalOracle({ p, n, attack, seed, successOnly, miss, types, id, PlayerStat, NpcStat, canonical });
  if (miss) set(p, attack.kind === 'magic' ? 'com_magicattack' : ['com_stabattack', 'com_slashattack', 'com_crushattack', 'com_rangeattack', 'com_magicattack'][p.getVar(id('VarPlayerType', 'damagetype'))], 0);
  JavaRandom.setSeed(seed);
  const beforeXp = Array.from(p.stats);
  const beforeInv = p.invs.get(inv).items.map(item => item && { id: item.id, count: item.count });
  const draws = [], nativeDouble = JavaRandom.nextDouble;
  JavaRandom.nextDouble = function () { const value = nativeDouble.call(this); draws.push(value); return value; };
  trace = [];
  try {
    if (attack.kind === 'magic') {
      const [name, spellId, maxHit] = attack.row;
      if (successOnly) {
        const row = run(p, n, '[proc,get_spell_data]', [spellId]).intStack[0];
        run(p, n, '[proc,pvm_spell_cast]', [row]);
        run(p, n, '[proc,pvm_spell_success]', [row, maxHit, 64]);
      } else run(p, n, `[apnpct,magic:${name}]`);
    } else if (attack.kind === 'special') run(p, n, `[label,pvm_${attack.row[0]}_sa]`);
    else if (attack.kind === 'cannon') run(p, n, '[proc,cannon_fire]');
    else run(p, n, attack.kind === 'ranged' ? '[label,player_ranged_attack]' : '[label,player_melee_attack]');
    const commands = trace;
    trace = null;
    const queue = [...n.queue.all()].map(q => ({ id: q.queueId - ServerTriggerType.AI_QUEUE1 + 1, damage: q.lastInt, delay: q.delay }));
    const hit = queue.find(q => q.id === 2);
    const result = {
      damage: hit?.damage ?? null, queue, xp: Array.from(p.stats, (v, i) => v - beforeXp[i]),
      beforeInv, inventory: canonical([...p.invs.entries()].map(([id, value]) => [id, value.items])),
      playerVars: Array.from(p.vars), npcVars: Array.from(n.vars), npcLevels: Array.from(n.levels),
      hero: canonical(n.heroPoints), packets: p.packets, commands, draws, worn, blocked: isMapBlocked(n.level, n.x, n.z),
      playerVisual: [p.animId, p.animDelay, p.spotanimId, p.spotanimHeight, p.spotanimTime],
      npcVisual: [n.animId, n.animDelay, n.spotanimId, n.spotanimHeight, n.spotanimTime],
      nextRandom: JavaRandom.nextInt(1000000),
      combat: { attack: p.getVar(id('VarPlayerType', 'com_rangeattack')), max: p.getVar(id('VarPlayerType', 'com_maxhit')) }
    };
    // Execute the actual generic queue2 damage handler, not applyDamage directly.
    if (hit) {
      const damageScript = ScriptProvider.getByName('[ai_queue2,_]');
      const state = ScriptRunner.init(damageScript, n); state.lastInt = hit.damage;
      n.executeScript(state); assert.equal(state.execution, ScriptState.FINISHED);
      result.hitmark = { damage: n.hitmarkDamage, type: n.hitmarkType };
    }
    if (expected) {
      assertElementalOutcome(result, expected, `${type} ${attack.kind}/${attack.row[0] ?? 'melee'} seed ${seed}${successOnly ? ' direct-success' : ''}${miss ? ' forced-miss' : ''}`);
      if (expected.poisoned) poisonWitnesses.add(attack.kind);
      if (expected.unfilteredDamage > 0) damageWitnesses.set(attackCase(type, attack), seed);
    }
    return result;
  } finally {
    trace = null;
    JavaRandom.nextDouble = nativeDouble;
    World.removeNpc(n, 0); World.players[1] = null; p.unlink();
  }
}
const bosses = Array.from({ length: types.NpcType.count }, (_, i) => types.NpcType.get(i)).filter(t => ['Fareed', 'Kamil'].includes(t.name));
assert.deepEqual(bosses.map(t => [t.id, t.debugname]), [[1913, 'icediamond_icewarrior'], [1977, 'firediamond_firewarrior']]);
const unrelated = ['Rat', 'Cow', 'Goblin', 'Zombie', 'Skeleton', 'Ghost'].map(name => {
  const type = Array.from({ length: types.NpcType.count }, (_, i) => types.NpcType.get(i)).find(t => t.name === name && t.op?.[1] === 'Attack');
  assert(type, name); assert(!type.params.has(magicParam) && !type.params.has(ammoParam)); return type;
});
function checkAttacks(type) {
  for (const row of magic) {
    const attack = { kind: 'magic', row };
    for (const seed of elementalSeeds) outcome(type.id, attack, seed);
    outcome(type.id, attack, 1, { miss: true });
    // Non-undead admission remains tested above. Direct success also covers
    // Crumble Undead's guarded resolver on both elemental bosses.
    if (row[0] === 'crumble_undead') for (const seed of elementalSeeds) outcome(type.id, attack, seed, { successOnly: true });
  }
  for (const kind of ['ranged', 'special']) for (const row of kind === 'ranged' ? ranged : rangedSpecials) {
    const attack = { kind, row };
    for (const seed of elementalSeeds) outcome(type.id, attack, seed);
    outcome(type.id, attack, 1, { miss: true });
  }
  for (const seed of elementalSeeds) outcome(type.id, { kind: 'melee', row: [] }, seed);
  outcome(type.id, { kind: 'melee', row: [] }, 1, { miss: true });
  console.log(`PASS ${type.debugname}: independent fixed-seed damage, draws, XP, credit, payments, effects and admission`);
  if (bosses.includes(type)) {
    const cases = [
      ...magic.map(row => ({ kind: 'magic', row })),
      ...ranged.filter(row => !['poison javelins', 'holy water'].includes(row[0])).map(row => ({ kind: 'ranged', row })),
      ...rangedSpecials.map(row => ({ kind: 'special', row })),
      { kind: 'melee', row: [] }
    ];
    for (const attack of cases) {
      assert(damageWitnesses.has(attackCase(type.id, attack)), `${type.debugname} ${attack.kind}/${attack.row.join(' ')} has a positive pre-immunity damage witness`);
    }
    console.log(`PASS ${type.debugname}: every required boss attack case has a positive pre-immunity damage witness`);
  }
}
for (const type of [...bosses, ...unrelated]) {
  if (bosses.includes(type)) {
    assert.equal(type.params.get(magicParam), type.id === 1977 ? 1 : 3);
    assert.equal(type.params.get(ammoParam) ?? -1, type.id === 1977 ? 78 : -1);
  }
  checkAttacks(type);
  if (bosses.includes(type)) {
    const attack = { kind: 'magic', row: type.id === 1977 ? magic[5] : magic[7] };
    const seed = damageWitnesses.get(attackCase(type.id, attack));
    const permitted = type.params.get(magicParam);
    try {
      type.params.set(magicParam, type.id === 1977 ? 3 : 1);
      assert.throws(() => outcome(type.id, attack, seed), {
        name: 'AssertionError', message: /independent damage/
      }, `${type.debugname} wrong-element-param mutant must fail on damage`);
    } finally {
      type.params.set(magicParam, permitted);
    }
    console.log(`PASS wrong-element-param mutant ${type.debugname}: rejected by independent damage`);
  }
  checkCannon(type.id);
}
assert.deepEqual([...poisonWitnesses].sort(), ['ranged', 'special'], 'fixed seeds exercise successful poison in both ordinary and special attacks');
function cannonStyle(p, style) {
  set(p, 'damagetype', style);
  // Disclosed style-sensitive fixture: only the selected style can hit.
  for (const [index, name] of ['com_stabattack', 'com_slashattack', 'com_crushattack', 'com_rangeattack', 'com_magicattack'].entries()) {
    set(p, name, index === style ? 20000 : 0);
  }
}

function checkCannon(type) {
  const seeds = [1, 2, 3, 7, 99, 6543];
  const cannon = script('[proc,cannon_fire]'), cap = script('[proc,npc_max_dealt]');
  const maxDealt = id('ParamType', 'max_dealt');
  // Derive the former direct-cap control from this pack, not stored bytecode.
  // The shared procedure's terminal expression is min(maxhit, NPC_PARAM).
  const expression = ['PUSH_INT_LOCAL', 'PUSH_CONSTANT_INT', 'NPC_PARAM', 'MIN', 'RETURN'];
  const starts = cap.opcodes.flatMap((_, pc) => expression.every((name, offset) =>
    ScriptOpcodeNameMap.get(cap.opcodes[pc + offset]) === name) &&
    cap.intOperands[pc] === 0 && cap.intOperands[pc + 1] === maxDealt ? [pc] : []);
  assert(starts.length > 0, 'native default-cap expression exists in the built shared procedure');
  const start = starts.at(-1);
  const fields = ['opcodes', 'intOperands', 'stringOperands'];
  const saved = Object.fromEntries(fields.map(name => [name, cap[name]]));
  const callOpcode = [...ScriptOpcodeNameMap].find(([, name]) => name === 'GOSUB_WITH_PARAMS')[0];
  const nativeCall = ScriptRunner.HANDLERS[callOpcode];
  function expected(seed) {
    const { p, n } = fixture(type, ['Rune scimitar']);
    cannonStyle(p, seed % 5);
    const draws = [], nativeDouble = JavaRandom.nextDouble;
    JavaRandom.setSeed(seed);
    JavaRandom.nextDouble = function () { const value = nativeDouble.call(this); draws.push(value); return value; };
    try {
      // Independent of cannon_fire: native current-style accuracy, followed
      // only on success by the inclusive ordinary cap's one damage draw.
      const hit = run(p, n, '[proc,player_npc_hit_roll]', [seed % 5]).intStack[0];
      const maximum = Math.min(30, types.NpcType.get(type).params.get(maxDealt) ?? types.ParamType.get(maxDealt).defaultInt);
      const damage = hit ? Math.floor(JavaRandom.nextDouble() * (maximum + 1)) : 0;
      const capped = Math.min(damage, n.levels[NpcStat.HITPOINTS]);
      const multiplier = n.getVar(id('VarNpcType', 'npc_combat_xp_multiplier'));
      const xp = Math.trunc(multiplier * (2 * capped) / 1000) * 10;
      return { damage, xp, draws, nextRandom: JavaRandom.nextInt(1000000),
        hero: capped > 0 ? [{ hash64: String(p.hash64), points: capped }] : [] };
    } finally {
      JavaRandom.nextDouble = nativeDouble;
      World.removeNpc(n, 0); World.players[1] = null; p.unlink();
    }
  }
  function execute(seed, direct = false, target = type) {
    const draws = [], calls = [];
    const nativeSeed = JavaRandom.setSeed, nativeDouble = JavaRandom.nextDouble;
    let recording = false;
    if (direct) for (const field of fields) cap[field] = saved[field].slice(start, start + expression.length);
    JavaRandom.setSeed = function (value) { nativeSeed.call(this, value); recording = true; };
    JavaRandom.nextDouble = function () {
      const value = nativeDouble.call(this);
      if (recording) draws.push(value);
      return value;
    };
    ScriptRunner.HANDLERS[callOpcode] = state => {
      if (state.script === cannon && state.intOperand === cap.id) calls.push(state.intStack.slice(state.isp - 2, state.isp));
      nativeCall(state);
    };
    try {
      // Cannon keeps its separate independent oracle and current-pack cap control.
      const { commands: _commands, ...result } = outcome(target, { kind: 'cannon', row: [], style: seed % 5 }, seed);
      return { result, draws, calls };
    } finally {
      Object.assign(cap, saved);
      ScriptRunner.HANDLERS[callOpcode] = nativeCall;
      JavaRandom.setSeed = nativeSeed; JavaRandom.nextDouble = nativeDouble;
    }
  }
  let positives = 0;
  for (const seed of seeds) {
    const independent = expected(seed), before = execute(seed, true), after = execute(seed);
    assert.equal(after.result.damage, independent.damage, `${type} seed ${seed}: independent native damage`);
    assert.deepEqual(after.draws, independent.draws, `${type} seed ${seed}: independent native draw values and order`);
    assert.equal(after.result.nextRandom, independent.nextRandom, `${type} seed ${seed}: independent RNG continuation`);
    assert.deepEqual(after.result.xp, Array.from({ length: after.result.xp.length }, (_, skill) =>
      skill === PlayerStat.RANGED ? independent.xp : 0), `${type} seed ${seed}: independent damage-derived XP`);
    assert.deepEqual(after.result.hero.filter(hero => hero.points > 0), independent.hero,
      `${type} seed ${seed}: independent owner hero credit`);
    // All former observable comparisons remain, including admission, queued
    // and applied damage, XP, hero credit, variables, packets and next RNG.
    assert.deepEqual(after.result, before.result, `${type} cannon outcomes unchanged at seed ${seed}`);
    assert.deepEqual(after.draws, before.draws, `${type} cannon native draw count and order unchanged at seed ${seed}`);
    assert(after.draws.length === 2 || after.draws.length === 3, 'two accuracy draws and a damage draw only on success');
    assert.deepEqual(after.calls, after.draws.length === 3 ? [[30, 0]] : [], `${type} successful cannon obtains its cap through the shared procedure`);
    assert.equal(after.result.playerVars[id('VarPlayerType', 'rockthrower')], 29, 'native cannon spends one loaded ball');
    assert(after.result.queue.some(q => q.id === 2), 'ordinary and DT cannon hits remain admitted, including misses');
    assert(after.result.damage >= 0 && after.result.damage <= 30, 'cannon maximum remains 30 independently of the control');
    positives += Number(after.result.damage > 0);
  }
  assert(positives > 0, `${type} fixed seeds contain a positive native cannon witness`);
  if (type === bosses[0].id) {
    const harpie = id('NpcType', 'slayer_harpiebugswarm');
    let gatedWitness = false;
    for (const seed of seeds) {
      const direct = execute(seed, true, harpie);
      if (direct.result.damage === 0) continue;
      const product = execute(seed, false, harpie);
      assert.equal(product.result.damage, 0, 'bare harpie is gated in the product');
      assert(product.result.xp.every(xp => xp === 0), 'bare harpie product awards no damage XP');
      assert.deepEqual(product.draws, direct.draws, 'harpie control changes the cap, not the RNG stream');
      assert.deepEqual(product.calls, [[30, 0]], 'harpie product reaches the shared cap');
      gatedWitness = true;
      console.log(`PASS bare harpie seed ${seed}: direct control damage ${direct.result.damage}, gated product damage 0`);
      break;
    }
    assert(gatedWitness, 'in-memory direct control differs from the product on a gated harpie');
  }
  // A disclosed fixture cap proves the outcome comparison cannot hide both
  // paths ignoring the same boss cap. This changes no product configuration.
  const target = types.NpcType.get(type), hadCap = target.params.has(maxDealt), previousCap = target.params.get(maxDealt);
  target.params.set(maxDealt, 3);
  try {
    for (const seed of seeds) {
      const bounded = execute(seed);
      assert(bounded.result.damage >= 0 && bounded.result.damage <= 3, `${type} cannon respects fixture NPC cap 3`);
    }
  } finally {
    if (hadCap) target.params.set(maxDealt, previousCap); else target.params.delete(maxDealt);
  }
  console.log(`PASS ${type} packed cannon: current-pack direct-cap control, fixed-seed outcomes/draw order, shared call and bounded damage`);
}
const ice = object('Ice arrows');
assert.equal(ice.id, 78); assert.equal(ice.debugname, 'ice_arrow');
const crystalBowPlayer = new Player('elemental_crystal_bow', 2n, 10002n);
const bows = objects.filter(t => t.category === id('CategoryType', 'weapon_bow') && t.params.get(id('ParamType', 'levelrequire')) >= ice.params.get(id('ParamType', 'levelrequire')) && !t.dummyitem
  && run(crystalBowPlayer, null, '[proc,roving_crystal_bow_is]', [t.id]).popInt() === 0);
assert.deepEqual(bows.map(t => t.debugname), ['yew_longbow', 'yew_shortbow', 'magic_longbow', 'magic_shortbow', 'daganoth_cave_magic_shortbow']);
console.log('PASS original ice-arrow compatible bows', bows.map(t => `${t.id}:${t.debugname}`).join(','));
const probe = outcome(1977, { kind: 'ranged', row: ranged[0] }, 1);
const defence = (135 + 9) * 64;
const accuracy = 1 - (defence + 2) / (2 * (probe.combat.attack + 1));
const positive = accuracy * probe.combat.max / (probe.combat.max + 1);
assert(positive >= 0.6, 'live sixteen-shot conservative probability bound');
console.log('PASS live bronze-arrow probability witness', { ...probe.combat, defence, accuracy, positive, sixteenZeros: (1 - positive) ** 16 });
const ancientTriggers = Array.from({ length: scriptCount }, (_, i) => ScriptProvider.get(i)?.name).filter(name => name && /^\[(apnpct|opnpct),magic:(smoke|shadow|blood|ice)_(rush|burst|blitz|barrage)\]$/.test(name));
assert.deepEqual(ancientTriggers, [], 'published Ancient combat is absent; this unit adds no spell implementation');
console.log('PASS compiled elemental independent-outcome suite');
process.exit(0);
