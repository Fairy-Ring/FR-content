#!/usr/bin/env node
/** Native packed attacks, published-bytecode differential controls and isolated rule mutants. */
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
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
const { ScriptOpcodeNameMap } = await load('src/engine/script/ScriptOpcode.ts');
const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType',
  'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType',
  'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'Component', 'FontType']) {
  types[name] = (await load(`src/cache/config/${name}.ts`)).default;
  types[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
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
const published = JSON.parse(fs.readFileSync(new URL('./elemental-published.json', import.meta.url)));
const publishedSpecials = JSON.parse(fs.readFileSync(new URL('./elemental-specials-published.json', import.meta.url)));
const publishedCannon = JSON.parse(fs.readFileSync(new URL('./elemental-cannon-published.json', import.meta.url)));
const paramIdentities = JSON.parse(fs.readFileSync(new URL('./elemental-published-params.json', import.meta.url)));
const originalScripts = [
  ...published.scripts.map(record => [record, paramIdentities.published]),
  ...publishedSpecials.scripts.map(record => [record, paramIdentities.specials]),
  ...publishedCannon.scripts.map(record => [record, paramIdentities.specials])
];
assert.equal(published.publishedContent, 'ccdca1101a225a38d2583e56ce1023ab028c8b75');
assert.equal(published.publishedEngine, 'ef96f86623697dc0d5367cc0a889c4c56eb091d3');
const bytecodeFields = ['intLocalCount', 'stringLocalCount', 'intArgCount', 'stringArgCount', 'switchTables', 'opcodes', 'intOperands', 'stringOperands'];
function withPublished(fn) {
  const saved = [];
  for (const [original, paramNames] of originalScripts) {
    const current = script(original.info.scriptName);
    saved.push([current, Object.fromEntries(bytecodeFields.map(k => [k, current[k]]))]);
    for (const field of bytecodeFields) current[field] = structuredClone(original[field]);
    // Procedure ids can move when the production compiler adds scripts. Resolve recorded callees by identity.
    for (const [pc, name] of Object.entries(original.callees)) current.intOperands[pc] = script(name).id;
    // A clean pack regenerates server-only param ids. Restore each literal by its recorded name.
    for (let pc = 1; pc < original.opcodes.length; pc++) {
      if (!['NPC_PARAM', 'OC_PARAM'].includes(ScriptOpcodeNameMap.get(original.opcodes[pc]))) continue;
      assert.equal(ScriptOpcodeNameMap.get(original.opcodes[pc - 1]), 'PUSH_CONSTANT_INT');
      const name = paramNames[original.intOperands[pc - 1]];
      assert(name, `${original.info.scriptName}:${pc} has a recorded parameter identity`);
      current.intOperands[pc - 1] = id('ParamType', name);
    }
    // These recorded DB reads all belong to magic_spell_table. Resolve its
    // identity, not the old generated table id; rows are supplied by the live
    // get_spell_data lookup and therefore already have current identities.
    for (let pc = 0; pc < original.opcodes.length; pc++) {
      const opcode = ScriptOpcodeNameMap.get(original.opcodes[pc]);
      if (!['DB_GETFIELD', 'DB_GETFIELDCOUNT'].includes(opcode)) continue;
      assert.equal(original.info.scriptName, '[proc,pvm_spell_success]', 'record the table name for any additional published DB user');
      const operand = pc - (opcode === 'DB_GETFIELD' ? 2 : 1);
      assert.equal(ScriptOpcodeNameMap.get(original.opcodes[operand]), 'PUSH_CONSTANT_INT');
      current.intOperands[operand] = (id('DbTableType', 'magic_spell_table') << 12) | (original.intOperands[operand] & 0xfff);
    }
  }
  try { return fn(); } finally { for (const [current, fields] of saved) Object.assign(current, fields); }
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
  run(p, null, '[proc,player_combat_stat]');
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
function outcome(type, attack, seed, { original = false, successOnly = false, miss = false } = {}) {
  const action = () => {
    const equipment = attack.kind === 'magic' ? attack.row[3] ?? [] : ['melee', 'cannon'].includes(attack.kind) ? ['Rune scimitar'] : attack.row.slice(1);
    const { p, n } = fixture(type, equipment);
    if (attack.kind === 'cannon') {
      set(p, 'rockthrower', 30);
      set(p, 'ownedmcannon', (p.level << 28) | (p.x << 14) | p.z);
    }
    if (miss) set(p, 'com_magicattack', 0);
    JavaRandom.setSeed(seed);
    const beforeXp = Array.from(p.stats);
    const beforeInv = p.invs.get(inv).items.map(item => item && { id: item.id, count: item.count });
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
        hero: canonical(n.heroPoints), packets: p.packets, commands,
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
      return result;
    } finally {
      trace = null;
      World.removeNpc(n, 0); World.players[1] = null; p.unlink();
    }
  };
  return original ? withPublished(action) : action();
}
function withoutGuard(commands) {
  // Only the Champions guard's leading empty-stack type lookup is new.
  // Preserve every later NPC_TYPE, including native attackability checks.
  return commands.filter((c, i) =>
    !(i === 0 && c.command === 'NPC_TYPE' && c.ints.length === 0 && c.strings.length === 0) &&
    !(c.command === 'NPC_PARAM' && [magicParam, ammoParam].includes(c.ints.at(-1))));
}
function assertIdentical(current, original, label) {
  const normalized = { ...current, commands: withoutGuard(current.commands) };
  assert.deepEqual(normalized, original, `${label}: all original engine commands/arguments, RNG continuation, queues, XP, hero, inventories, poison vars, packets/messages, stats and visuals identical`);
}
function positiveSeed(type, attack, options = {}) {
  for (let seed = 1; seed <= 128; seed++) {
    if (outcome(type, attack, seed, { ...options, original: true }).damage > 0) return seed;
  }
  return null;
}
function allowed(type, row) { return (type === 1977 ? [1, 5, 9, 13] : [3, 7, 11, 15]).includes(row[1]); }
function checkMagic(type, row) {
  const attack = { kind: 'magic', row };
  const successOnly = row[0] === 'crumble_undead';
  if (successOnly) assertIdentical(outcome(type, attack, 1), outcome(type, attack, 1, { original: true }), `${type} native undead refusal`);
  const seed = positiveSeed(type, attack, { successOnly });
  assert(seed !== null, `${type} ${row[0]} has a positive published damage witness`);
  const before = outcome(type, attack, seed, { original: true, successOnly });
  const after = outcome(type, attack, seed, { successOnly });
  assert.equal(after.damage, allowed(type, row) ? before.damage : 0, `${type} ${row[0]} elemental damage`);
  assert.deepEqual(after.inventory, before.inventory, `${row[0]} rune and staff-charge inventory payment unchanged`);
  assert.equal(after.playerVars[id('VarPlayerType', 'iban_staff_charges')], before.playerVars[id('VarPlayerType', 'iban_staff_charges')]);
  assert.deepEqual(after.npcLevels, before.npcLevels, `${row[0]} secondary stat effects unchanged`);
  assert.deepEqual(after.npcVars, before.npcVars, `${row[0]} freeze/poison/retaliation vars unchanged`);
  assert.deepEqual(after.npcVisual, before.npcVisual, `${row[0]} normal impact unchanged`);
  if (allowed(type, row)) {
    const a = { ...after, commands: withoutGuard(after.commands) };
    // The quest-local resolver reads no engine state; only the single param command differs.
    assert.deepEqual(a, before, `${row[0]} has no elemental bonus or other changed result`);
  } else {
    assert.equal(after.xp[PlayerStat.HITPOINTS], 0, `${row[0]} no damage HP XP`);
    assert(after.xp[PlayerStat.MAGIC] > 0, `${row[0]} keeps base spell XP`);
    assert.deepEqual(after.hitmark, { damage: 0, type: 0 }, `${row[0]} blue-zero native damage handler`);
    assert(after.hero.every(h => h.points === 0), `${row[0]} no zero-damage hero credit`);
  }
}
const bosses = Array.from({ length: types.NpcType.count }, (_, i) => types.NpcType.get(i)).filter(t => ['Fareed', 'Kamil'].includes(t.name));
assert.deepEqual(bosses.map(t => [t.id, t.debugname]), [[1913, 'icediamond_icewarrior'], [1977, 'firediamond_firewarrior']]);
for (const type of bosses) {
  assert.equal(type.params.get(magicParam), type.id === 1977 ? 1 : 3);
  assert.equal(type.params.get(ammoParam) ?? -1, type.id === 1977 ? 78 : -1);
  for (const row of magic) checkMagic(type.id, row);
  const miss = { kind: 'magic', row: magic[7] };
  assertIdentical(outcome(type.id, miss, 1, { miss: true }), outcome(type.id, miss, 1, { original: true, miss: true }), `${type.name} native splash`);
  for (const row of ranged) {
    const attack = { kind: 'ranged', row };
    const seed = positiveSeed(type.id, attack);
    if (seed === null) {
      assert(['poison javelins', 'holy water'].includes(row[0]), `${type.name} ${row[0]} must have a positive published witness`);
      const a = outcome(type.id, attack, 1), b = outcome(type.id, attack, 1, { original: true });
      assertIdentical(a, b, `${type.name} ${row[0]} existing refusal/zero`);
      console.log(`PASS existing Ranged admission/zero ${type.name} ${row[0]}`);
      continue;
    }
    const before = outcome(type.id, attack, seed, { original: true }), after = outcome(type.id, attack, seed);
    const permit = type.id === 1913 || row[0] === 'ice arrows';
    assert.equal(after.damage, permit ? before.damage : 0, `${type.name} ${row[0]} damage`);
    assert.deepEqual(after.inventory, before.inventory, `${row[0]} ordinary ammunition spent identically`);
    const ammoCommands = r => r.commands.filter(c => /INV_(DEL|DROPITEM_DELAYED)|MAP_BLOCKED/.test(c.command));
    assert.deepEqual(ammoCommands(after), ammoCommands(before), `${row[0]} exact ordinary drop/loss commands`);
    if (permit) assertIdentical(after, before, `${type.name} ${row[0]} unchanged`);
    else {
      assert(after.xp.every(v => v === 0), `${row[0]} zero damage gives zero XP`);
      assert.equal(after.npcVars[id('VarNpcType', 'npc_poison')], 0, 'zero projectile cannot poison');
      assert(after.hero.every(h => h.points === 0), `${row[0]} no zero-damage hero credit`);
    }
  }
  const melee = { kind: 'melee', row: [] }, seed = positiveSeed(type.id, melee);
  for (const row of rangedSpecials) {
    const attack = { kind: 'special', row }, seed = positiveSeed(type.id, attack);
    assert(seed !== null, `${type.name} ${row[0]} positive published special witness`);
    const before = outcome(type.id, attack, seed, { original: true }), after = outcome(type.id, attack, seed);
    const permit = type.id === 1913 || row[2] === 'Ice arrows';
    if (permit) assertIdentical(after, before, `${type.name} ${row.join(' ')} special unchanged`);
    else {
      assert(after.queue.filter(q => q.id === 2).every(q => q.damage === 0), `${row[0]} every special hit is zero`);
      assert(after.xp.every(v => v === 0), `${row[0]} no special damage XP`);
      assert.equal(after.npcVars[id('VarNpcType', 'npc_poison')], 0, `${row[0]} zero special cannot poison`);
      assert.deepEqual(after.inventory, before.inventory, `${row[0]} special ammunition spent identically`);
      assert(after.hero.every(h => h.points === 0), `${row[0]} no zero-damage hero credit`);
    }
  }
  assert(seed !== null, `${type.name} native melee positive control`);
  assertIdentical(outcome(type.id, melee, seed), outcome(type.id, melee, seed, { original: true }), `${type.name} melee`);
  // Isolated data mutant: no source/pack edit, restored even when the assertion catches it.
  const expected = type.params.get(magicParam);
  type.params.set(magicParam, type.id === 1977 ? 3 : 1);
  let caught = false;
  try { checkMagic(type.id, type.id === 1977 ? magic[7] : magic[5]); }
  catch (error) { if (!(error instanceof assert.AssertionError)) throw error; caught = /elemental damage/.test(error.message); }
  finally { type.params.set(magicParam, expected); }
  assert(caught, `${type.name} isolated wrong-element mutant caught by the same assertion`);
  console.log(`PASS ${type.name}: ${magic.length} spells, ${ranged.length} ammunition classes, ${rangedSpecials.length} Ranged-special cases, native splash, melee, payment and isolated mutant`);
  checkCannon(type.id);
}
const unrelated = ['Rat', 'Cow', 'Goblin', 'Zombie', 'Skeleton', 'Ghost'].map(name => {
  const type = Array.from({ length: types.NpcType.count }, (_, i) => types.NpcType.get(i)).find(t => t.name === name && t.op?.[1] === 'Attack');
  assert(type, name); assert(!type.params.has(magicParam) && !type.params.has(ammoParam)); return type;
});
for (const type of unrelated) {
  for (const row of magic) {
    const attack = { kind: 'magic', row };
    for (const seed of [1, 2, 3]) assertIdentical(outcome(type.id, attack, seed), outcome(type.id, attack, seed, { original: true }), `${type.debugname} ${row[0]}`);
  }
  for (const row of ranged) {
    const attack = { kind: 'ranged', row };
    for (const seed of [1, 2, 3]) assertIdentical(outcome(type.id, attack, seed), outcome(type.id, attack, seed, { original: true }), `${type.debugname} ${row[0]}`);
  }
  const melee = { kind: 'melee', row: [] };
  assertIdentical(outcome(type.id, melee, 1), outcome(type.id, melee, 1, { original: true }), `${type.debugname} melee`);
  for (const row of rangedSpecials) {
    const attack = { kind: 'special', row };
    for (const seed of [1, 2, 3]) assertIdentical(outcome(type.id, attack, seed), outcome(type.id, attack, seed, { original: true }), `${type.debugname} ${row.join(' ')} special`);
  }
  console.log(`PASS unrelated ${type.id} ${type.debugname}: every spell and ammunition class at three real RNG seeds; melee`);
  checkCannon(type.id);
}
function checkCannon(type) {
  const attack = { kind: 'cannon', row: [] }, seed = positiveSeed(type, attack);
  assert(seed !== null, `${type} cannon positive published witness`);
  const before = outcome(type, attack, seed, { original: true }), after = outcome(type, attack, seed);
  assert.equal(before.playerVars[id('VarPlayerType', 'rockthrower')], 29, 'native cannon spends one loaded ball');
  assert.deepEqual(after.playerVars, before.playerVars, 'native cannon ammo counter and all player vars unchanged');
  assert.deepEqual(after.inventory, before.inventory, 'no substitute cannonball/ashes inventory path');
  assertIdentical(after, before, `${type} cannon unchanged from the published pack`);
  console.log(`PASS ${type} packed cannon: published result, commands, credit and consumption`);
}
const ice = object('Ice arrows');
assert.equal(ice.id, 78); assert.equal(ice.debugname, 'ice_arrow');
const bows = objects.filter(t => t.category === id('CategoryType', 'weapon_bow') && t.params.get(id('ParamType', 'levelrequire')) >= ice.params.get(id('ParamType', 'levelrequire')) && !t.dummyitem);
assert.deepEqual(bows.map(t => t.debugname), ['yew_longbow', 'yew_shortbow', 'magic_longbow', 'magic_shortbow']);
console.log('PASS original ice-arrow compatible bows', bows.map(t => `${t.id}:${t.debugname}`).join(','));
const probe = outcome(1977, { kind: 'ranged', row: ranged[0] }, 1, { original: true });
const defence = (135 + 9) * 64;
const accuracy = 1 - (defence + 2) / (2 * (probe.combat.attack + 1));
const positive = accuracy * probe.combat.max / (probe.combat.max + 1);
assert(positive >= 0.6, 'live sixteen-shot conservative probability bound');
console.log('PASS live bronze-arrow probability witness', { ...probe.combat, defence, accuracy, positive, sixteenZeros: (1 - positive) ** 16 });
const ancientTriggers = Array.from({ length: scriptCount }, (_, i) => ScriptProvider.get(i)?.name).filter(name => name && /^\[(apnpct|opnpct),magic:(smoke|shadow|blood|ice)_(rush|burst|blitz|barrage)\]$/.test(name));
assert.deepEqual(ancientTriggers, [], 'published Ancient combat is absent; this unit adds no spell implementation');
console.log('PASS compiled elemental differential suite');
process.exit(0);
