#!/usr/bin/env node
// Full production pack, no server. Expected values come from oracle.mjs, not a replay.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spells, seeds, outcome } from './oracle.mjs';
process.env.NODE_MEMBERS = 'true'; process.env.NODE_XPRATE = '1'; process.env.NODE_RANDOM_EVENTS = 'false';
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = async file => (await import(pathToFileURL(path.join(engine, file)).href)).default;
const selectedCase = process.argv.includes('--case') ? process.argv[process.argv.indexOf('--case') + 1] : 'all';
assert(['all', 'smoke', 'shadow', 'blood', 'ice', 'cap'].includes(selectedCase), 'known named mutation case');
const selectedSpells = spells.filter(s => selectedCase === 'all' || selectedCase === 'cap' || s.family === ['smoke', 'shadow', 'blood', 'ice'].indexOf(selectedCase) + 1);
const World = await load('src/engine/World.ts');
const Player = await load('src/engine/entity/Player.ts'), Npc = await load('src/engine/entity/Npc.ts');
const Provider = await load('src/engine/script/ScriptProvider.ts'), Runner = await load('src/engine/script/ScriptRunner.ts');
const State = await load('src/engine/script/ScriptState.ts'), Trigger = await load('src/engine/script/ServerTriggerType.ts');
const JavaRandom = await load('src/util/JavaRandom.ts'), Environment = await load('src/util/Environment.ts');
const { EntityLifeCycle } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/EntityLifeCycle.ts')).href);
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'Component', 'FontType']) {
  types[name] = await load(`src/cache/config/${name}.ts`); types[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).init();
assert(Provider.load(pack) > 0, 'full pack required'); Environment.NODE_MEMBERS = true;
const id = (kind, name) => { const value = types[kind].getId(name); assert(value >= 0, `${kind}:${name}`); return value; };
const table = types.DbTableType.getByName('magic_spell_table');
const row = name => types.DbRowType.getByName(`magic_spell_${name}`);
const values = (r, key) => r.getValue(table.columnNames.indexOf(key), 0);
const field = (r, key) => values(r, key)[0];
const variable = (p, key, value) => value === undefined ? p.getVar(id('VarPlayerType', key)) : p.setVar(id('VarPlayerType', key), value);
const nv = (n, key, value) => value === undefined ? n.getVar(id('VarNpcType', key)) : n.setVar(id('VarNpcType', key), value);
const invId = id('InvType', 'inv'), wornId = id('InvType', 'worn');
const allRunes = ['airrune', 'waterrune', 'earthrune', 'firerune', 'mindrune', 'chaosrune', 'deathrune', 'bloodrune', 'soulrune', 'naturerune'];
function player(slot) {
  const p = new Player(`ancient_compiled_${slot}`, BigInt(slot), BigInt(slot));
  p.slot = p.pid = slot; p.uid = (slot << 11) | slot; p.isActive = true; p.x = 3100 + slot; p.z = 3800; p.level = 0;
  p.levels.fill(99); p.baseLevels.fill(99); p.stats.fill(130344310); p.write = () => {};
  p.messages = []; p.messageGame = p.wrappedMessageGame = text => p.messages.push(String(text));
  p.getInventory(invId); p.getInventory(wornId); World.players[slot] = p; World.playerLoop.add(p.hash64, p);
  variable(p, 'tutorial', 1000); variable(p, 'deserttreasure', 10); variable(p, 'alternate_spells', 1);
  variable(p, 'com_magicattack', 100000); variable(p, 'com_magicdef', 1000);
  for (const name of allRunes) p.invAdd(invId, id('ObjType', name), 100);
  p.levels[3] = 50;
  return p;
}
function fixture({ npcName = 'Cow', npcType, pvp = false, defensive = false, protectedMagic = false } = {}) {
  World.currentTick = 1000;
  const p = player(1); variable(p, 'damagestyle', defensive ? 2 : 0);
  let target;
  if (pvp) {
    target = player(2); target.levels[3] = 99; target.baseLevels[0] = target.levels[0] = 83;
    variable(target, 'prayer12', Number(protectedMagic));
  } else {
    const config = npcType ? types.NpcType.getByName(npcType) : Array.from({ length: types.NpcType.count }, (_, i) => types.NpcType.get(i)).find(t => t.name === npcName && t.op?.[1] === 'Attack');
    assert(config, `combat NPC ${npcName}`);
    target = new Npc(0, p.x + 1, p.z, config.size, config.size, EntityLifeCycle.RESPAWN, 1, config.id, config.blockwalk);
    World.addNpc(target, -1); target.levels[3] = target.baseLevels[3] = 200; target.levels[0] = target.baseLevels[0] = 83;
    nv(target, 'npc_combat_xp_multiplier', 1000); nv(target, 'npc_aggressive_player', p.uid);
  }
  return { p, target, pvp, defensive, protectedMagic };
}
function run(f, name, args = []) {
  const script = Provider.getByName(name); assert(script, `compiled ${name}`);
  const state = Runner.init(script, f.p, f.target, args);
  assert.equal(f.p.runScript(state, true, true), State.FINISHED, `${name}: ${f.p.messages.join(' | ')}`);
  return state;
}
function dispose(f) {
  if (!f.pvp) World.removeNpc(f.target, 0);
  for (const p of f.pvp ? [f.p, f.target] : [f.p]) { World.players[p.slot] = null; p.unlink(); }
}
const inventory = p => [...p.getInventory(invId).items].map(item => item && [item.id, item.count]);
const xp = p => [p.stats[6], p.stats[1], p.stats[3]];
function tick(f) {
  World.currentTick++;
  if (!f.pvp) f.target.processQueue();
  f.p.processQueues(); if (f.pvp) f.target.processQueues();
}
function cast(f, spell, seed) {
  const r = row(spell.name); assert(r, spell.name);
  const npcType = f.pvp ? null : types.NpcType.get(f.target.type);
  const param = name => { const t = types.ParamType.getByName(name); return npcType.params?.get(t.id) ?? t.defaultInt; };
  const expected = outcome({ seed, attack: variable(f.p, 'com_magicattack'),
    defence: f.pvp ? variable(f.target, 'com_magicdef') : (f.target.levels[4] + 9) * (64 + param('magicdefence')),
    spell, cap: f.pvp ? spell.maximum : param('max_dealt'), protectedMagic: f.protectedMagic,
    hp: f.target.levels[3], defensive: f.defensive, multiplier: f.pvp ? 1125 : 1000, pvp: f.pvp });
  const before = { xp: xp(f.p), inv: inventory(f.p), attack: f.target.levels[0], hp: f.p.levels[3] };
  const component = id('Component', `inter_267:com_${spell.widget}`);
  const trigger = Provider.getByTrigger(f.pvp ? Trigger.APPLAYERT : Trigger.APNPCT, component, -1);
  assert(trigger, `${spell.name} real component dispatch`);
  assert.equal(trigger.name, `[${f.pvp ? 'applayert' : 'apnpct'},inter_267:com_${spell.widget}]`);
  JavaRandom.setSeed(seed); const draws = [], native = JavaRandom.nextDouble;
  JavaRandom.nextDouble = function () { const result = native.call(this); draws.push(result); return result; };
  try { run(f, trigger.name); } finally { JavaRandom.nextDouble = native; }
  assert.deepEqual(draws, expected.draws, `${spell.name}: independent fixed-seed draw order`);
  assert.equal(JavaRandom.nextInt(1000000), expected.nextRandom, 'RNG suffix proves no hidden draw');
  assert.deepEqual(xp(f.p).map((n, i) => n - before.xp[i]), [expected.xp.magic, expected.xp.defence, expected.xp.hitpoints], `${spell.name} XP`);
  for (const name of allRunes) assert.equal(f.p.invTotal(invId, id('ObjType', name)), 100 - (spell.runes.find(([rune]) => rune === name)?.[1] ?? 0), `${spell.name} exact ${name} payment, including unspent runes`);
  assert.equal(variable(f.p, 'action_delay'), 1005, 'one five-tick cast commitment');
  const hits = f.pvp ? [...f.target.queue.all()].filter(q => q.script.name === '[queue,pvp_damage]') : [...f.target.queue.all()].filter(q => q.queueId === Trigger.AI_QUEUE2);
  assert.equal(hits.length, Number(expected.accurate), `${spell.name} hit queue admission`);
  if (hits.length) assert.equal(f.pvp ? hits[0].args[0] : hits[0].lastInt, expected.damage, `${spell.name} damage`);
  const hp = f.target.levels[3];
  const delay = hits[0]?.delay ?? 0, impact = 1000 + delay + Number(f.pvp);
  assert.equal(f.target.levels[0], before.attack, 'no premature Shadow effect');
  assert.equal(f.p.levels[3], before.hp, 'no premature Blood healing');
  if (!f.pvp) assert.equal(nv(f.target, 'npc_stunned'), 0, 'no premature Ice freeze');
  for (let t = 1000; t < impact - 1; t++) tick(f);
  if (expected.accurate) {
    assert.equal(f.target.levels[3], hp, 'damage waits for impact'); tick(f);
    assert.equal(f.target.levels[3], hp - expected.damage, 'native damage queue settles');
  }
  if (expected.accurate && spell.family === 2) assert.equal(f.target.levels[0], 75, 'Shadow truncates base 83*10%, non-stacking floor');
  if (expected.accurate && spell.family === 3) assert.equal(f.p.levels[3], Math.min(99, before.hp + Math.ceil(expected.rolled / 4)), 'Blood rolled-damage ceil and base cap');
  if (expected.accurate && spell.family === 4) {
    assert.equal(f.pvp ? variable(f.target, 'frozen') : nv(f.target, 'npc_stunned'), impact + (f.protectedMagic ? spell.freeze / 2 : spell.freeze) + Number(!f.pvp), 'Ice uses queued onset and Standard duration convention');
  }
  if (expected.accurate && spell.family === 1) assert.equal(f.pvp ? variable(f.target, 'poison') : nv(f.target, 'npc_poison'), expected.poison ? spell.poison : 0, 'Smoke chance/severity');
  return expected;
}
for (const spell of selectedSpells) {
  const r = row(spell.name); assert(r, spell.name);
  assert.equal(field(r, 'levelrequired'), spell.level); assert.equal(field(r, 'experience'), spell.xp * 10);
  assert.equal(field(r, 'maxhit'), spell.maximum); assert.equal(field(r, 'ancient_effect'), spell.family);
  assert.equal(field(r, 'continue_by_autocast'), 0, 'no Ancient autocast in U1');
  const vector = values(r, 'runesrequired');
  assert.equal(vector.length, 8, 'shared four-rune tuple');
  assert.deepEqual(vector.flatMap((n, i) => i % 2 === 0 && n >= 0 ? [[types.ObjType.get(n).debugname, vector[i + 1]]] : []), spell.runes);
  const witnesses = new Set();
  for (const pvp of [false, true]) for (const defensive of [false, true]) for (const seed of seeds) {
    const f = fixture({ pvp, defensive });
    try { const expected = cast(f, spell, seed); if (expected.damage > 0) witnesses.add(pvp); } finally { dispose(f); }
  }
  assert.equal(witnesses.size, 2, `${spell.name} positive NPC and PvP witnesses`);
  const protectedFixture = fixture({ pvp: true, protectedMagic: true });
  try { cast(protectedFixture, spell, 377); } finally { dispose(protectedFixture); }
}
// Every failed prerequisite is atomic, including the fourth rune and stale Standard book selections.
if (selectedCase === 'all') for (const spell of spells) for (const reason of ['quest', 'book', 'level', 'rune', 'members', 'busy-npc', 'illegal-pvp', 'busy-pvp']) {
  const pvp = reason.endsWith('pvp'), f = fixture({ pvp });
  try {
    if (reason === 'quest') variable(f.p, 'deserttreasure', 0);
    if (reason === 'book') variable(f.p, 'alternate_spells', 0);
    if (reason === 'level') f.p.levels[6] = spell.level - 1;
    if (reason === 'rune') f.p.invDel(invId, id('ObjType', spell.runes.at(-1)[0]), 100);
    if (reason === 'members') Environment.NODE_MEMBERS = false;
    if (reason === 'busy-npc') { nv(f.target, 'npc_lastcombat', 1000); nv(f.target, 'npc_aggressive_player', f.p.uid + 1); }
    if (reason === 'illegal-pvp') { f.p.z = f.target.z = 3200; }
    if (reason === 'busy-pvp') { variable(f.target, 'lastcombat', 1000); variable(f.target, 'pk_predator1', f.p.uid + 1); }
    const beforeInv = inventory(f.p), beforeXp = xp(f.p);
    run(f, `[${pvp ? 'applayert' : 'apnpct'},inter_267:com_${spell.widget}]`);
    assert.deepEqual(inventory(f.p), beforeInv, `${spell.name} ${reason} payment atomic`);
    assert.deepEqual(xp(f.p), beforeXp, `${spell.name} ${reason} no XP`);
    assert.equal(variable(f.p, 'action_delay'), 0, `${reason} no cooldown`);
  } finally { Environment.NODE_MEMBERS = true; dispose(f); }
}
// Effect-only eligibility does not reject a damaging recast or extend existing holds.
if (selectedCase === 'all') for (const pvp of [false, true]) for (const family of [2, 4]) {
  const spell = spells.find(s => s.family === family), f = fixture({ pvp });
  try {
    if (family === 2) f.target.levels[0] = 70;
    else if (pvp) variable(f.target, 'frozen', 1020); else nv(f.target, 'npc_stunned', 1020);
    const r = row(spell.name), sid = field(r, 'spell');
    run(f, pvp ? '[proc,pvp_default_spell]' : '[proc,pvm_default_spell]', [sid]);
    assert.equal(variable(f.p, 'action_delay'), 1005, 'repeat damaging cast commits');
    for (let i = 0; i < 6; i++) tick(f);
    if (family === 2) assert.equal(f.target.levels[0], 70, 'stronger Shadow drain preserved');
    else assert.equal(pvp ? variable(f.target, 'frozen') : nv(f.target, 'npc_stunned'), 1020, 'Ice never extends active freeze');
  } finally { dispose(f); }
}
// Additional fixed inputs cover exact edges without searching random live hits.
if (selectedCase === 'all') {
  const settle = (f, count = 6) => { for (let i = 0; i < count; i++) tick(f); };
  const enqueue = (f, spell, rolled = 0) => {
    JavaRandom.setSeed(65535);
    run(f, f.pvp ? '[proc,ancient_player_effect_queue]' : '[proc,ancient_npc_effect_queue]', [row(spell.name).id, rolled, 1]);
    settle(f, 2);
  };
  for (const pvp of [false, true]) {
    const smoke = spells.find(s => s.name === 'smoke_blitz');
    for (const starting of [0, 5, 30, ...(pvp ? [-5] : [])]) {
      const f = fixture({ pvp });
      try {
        if (pvp) variable(f.target, 'poison', starting); else nv(f.target, 'npc_poison', starting);
        enqueue(f, smoke);
        assert.equal(pvp ? variable(f.target, 'poison') : nv(f.target, 'npc_poison'), starting < 0 ? starting : Math.max(starting, 20), 'Smoke upgrades only weaker poison and respects antipoison');
      } finally { dispose(f); }
    }
    const shadow = spells.find(s => s.family === 2);
    for (const starting of [100, 83, 76, 75, 70]) {
      const f = fixture({ pvp });
      try {
        f.target.levels[0] = starting;
        enqueue(f, shadow);
        assert.equal(f.target.levels[0], Math.min(starting, 75), 'Shadow base floor on boosted, fresh and stronger-drained Attack');
        if (pvp && starting > 75) assert.notEqual(variable(f.target, 'com_stabattack'), 0, 'Shadow recomputes cached player attack rolls');
      } finally { dispose(f); }
    }
    const blood = spells.find(s => s.family === 3);
    for (const damage of [0, 1, 3, 4, 5, 17]) for (const hp of [50, 98, 99, 110]) {
      const f = fixture({ pvp });
      try {
        f.p.levels[3] = hp; enqueue(f, blood, damage);
        assert.equal(f.p.levels[3], hp >= 99 ? hp : Math.min(99, hp + Math.ceil(damage / 4)), 'Blood quarter-ceil, base cap and no overheal reduction');
      } finally { dispose(f); }
    }
    const ice = spells.find(s => s.family === 4);
    for (const until of [1000, 997, 996]) {
      const f = fixture({ pvp });
      try {
        if (pvp) variable(f.target, 'frozen', until); else nv(f.target, 'npc_stunned', until);
        enqueue(f, ice);
        const impact = pvp ? 1002 : 1001;
        assert.equal(pvp ? variable(f.target, 'frozen') : nv(f.target, 'npc_stunned'), until + 5 > impact ? until : impact + ice.freeze + Number(!pvp), 'Ice five-tick post-freeze boundary');
      } finally { dispose(f); }
    }
    // Misses still pay base XP but never queue a family effect.
    for (const spell of spells) {
      const f = fixture({ pvp });
      try {
        variable(f.p, 'com_magicattack', 0);
        const result = cast(f, spell, 1); assert.equal(result.accurate, false);
        settle(f);
        assert.equal(f.target.levels[0], 83); assert.equal(f.p.levels[3], 50);
        assert.equal(pvp ? variable(f.target, 'poison') : nv(f.target, 'npc_poison'), 0);
        assert.equal(pvp ? variable(f.target, 'frozen') : nv(f.target, 'npc_stunned'), 0);
      } finally { dispose(f); }
    }
    // A stale Standard selection cannot spend while the Ancient book is active.
    const f = fixture({ pvp });
    try {
      const beforeInv = inventory(f.p), beforeXp = xp(f.p);
      run(f, pvp ? '[proc,pvp_default_spell]' : '[proc,pvm_default_spell]', [field(row('wind_strike'), 'spell')]);
      assert.deepEqual(inventory(f.p), beforeInv); assert.deepEqual(xp(f.p), beforeXp);
    } finally { dispose(f); }
  }
  const blood = spells.find(s => s.name === 'blood_rush');
  for (const pvp of [false, true]) {
    const f = fixture({ pvp });
    try {
      f.target.levels[3] = 1;
      const before = xp(f.p);
      JavaRandom.setSeed(1); // The independent Java stream's first damage draw gives 13 of 0..17.
      run(f, pvp ? '[proc,pvp_spell_success]' : '[proc,pvm_spell_success]', [row(blood.name).id, 17, 0]);
      assert.deepEqual(xp(f.p).map((value, i) => value - before[i]), pvp ? [22, 0, 14] : [20, 0, 13], 'overkill damage XP credits only one remaining HP');
      settle(f, pvp ? 2 : 1);
      assert.equal(f.p.levels[3], 54, 'Blood heals ceil(13/4), not ceil(one remaining HP/4)');
    } finally { dispose(f); }
  }
  const capped = fixture({ npcType: 'macro_triffidseed_angry' });
  try {
    const before = xp(capped.p);
    JavaRandom.setSeed(1);
    run(capped, '[proc,pvm_spell_success]', [row(blood.name).id, 17, 0]);
    const hit = [...capped.target.queue.all()].find(q => q.queueId === Trigger.AI_QUEUE2);
    assert.equal(hit.lastInt, 2, 'existing max_dealt=3 cap is applied before the damage roll');
    assert.deepEqual(xp(capped.p).map((value, i) => value - before[i]), [40, 0, 26], 'existing NPC cap bounds damage XP');
    settle(capped, 1); assert.equal(capped.p.levels[3], 51, 'Blood shares the existing capped roll');
  } finally { dispose(capped); }
}
console.log('PASS Ancient U1: eight rows/widgets, fixed-seed NPC/PvP damage, draw order, XP, payments, protection, queued effects and atomic failures');
