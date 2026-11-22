#!/usr/bin/env node
// Full compiled pack, no server. Expected area outcomes come from oracle.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spells as singleTargetSpells, outcome as singleTargetOutcome } from '../ancients1/oracle.mjs';
import { areaSpells, rollArea, areaExperience, bloodHeal } from './oracle.mjs';

process.env.NODE_MEMBERS = 'true';
process.env.NODE_XPRATE = '1';
process.env.NODE_RANDOM_EVENTS = 'false';
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack');
const load = async file => (await import(pathToFileURL(path.join(engine, file)).href)).default;
const World = await load('src/engine/World.ts');
const Player = await load('src/engine/entity/Player.ts');
const Npc = await load('src/engine/entity/Npc.ts');
const Provider = await load('src/engine/script/ScriptProvider.ts');
const Runner = await load('src/engine/script/ScriptRunner.ts');
const State = await load('src/engine/script/ScriptState.ts');
const Trigger = await load('src/engine/script/ServerTriggerType.ts');
const JavaRandom = await load('src/util/JavaRandom.ts');
const Environment = await load('src/util/Environment.ts');
const mapApi = await import(pathToFileURL(path.join(engine, 'src/engine/GameMap.ts')).href);
const ZoneMap = await load('src/engine/zone/ZoneMap.ts');
const CoordGrid = (await import(pathToFileURL(path.join(engine, 'src/engine/CoordGrid.ts')).href)).CoordGrid;
const { NpcIterator, PlayerHuntAllCommandIterator } = await import(pathToFileURL(path.join(engine, 'src/engine/script/ScriptIterators.ts')).href);
const { EntityLifeCycle } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/EntityLifeCycle.ts')).href);
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'Component', 'FontType']) {
  types[name] = await load(`src/cache/config/${name}.ts`);
  types[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).init();
assert(Provider.load(pack) > 0, 'full compiled pack required');
Environment.NODE_MEMBERS = true;
const id = (kind, name) => {
  const value = types[kind].getId(name);
  assert(value >= 0, `${kind}:${name}`);
  return value;
};
const table = types.DbTableType.getByName('magic_spell_table');
const row = name => types.DbRowType.getByName(`magic_spell_${name}`);
const values = (r, key) => {
  const column = table.columnNames.indexOf(key);
  assert(column >= 0, `magic_spell_table:${key} column`);
  return r.getValue(column, 0);
};
const field = (r, key) => values(r, key)[0];
const variable = (p, key, value) => {
  const index = types.VarPlayerType.getId(key);
  if (index >= 0) return value === undefined ? p.getVar(index) : p.setVar(index, value);
  const bit = id('VarBitType', key);
  return value === undefined ? p.getVarBit(bit) : p.setVarBit(bit, value);
};
const nv = (n, key, value) => value === undefined ? n.getVar(id('VarNpcType', key)) : n.setVar(id('VarNpcType', key), value);
const invId = id('InvType', 'inv');
const wornId = id('InvType', 'worn');
const allRunes = ['airrune', 'waterrune', 'earthrune', 'firerune', 'mindrune', 'chaosrune', 'deathrune', 'bloodrune', 'soulrune', 'naturerune'];
const actorsBySlot = new Map();

function packedCollisionPreflight() {
  const { unzipSync } = createRequire(path.join(engine, 'package.json'))('fflate');
  const names = new Set(['m44_155', 'l44_155', 'm46_54', 'l46_54', 'm50_50', 'l50_50']);
  const maps = unzipSync(fs.readFileSync(path.join(pack, '.cache/maps-server.zip')), { filter: entry => names.has(entry.name) });
  const beforeNpcs = World.getTotalNpcs();
  for (const [mx, mz] of [[44, 155], [46, 54], [50, 50]]) {
    const m = maps[`m${mx}_${mz}`];
    const l = maps[`l${mx}_${mz}`];
    assert(m && l, `packed terrain/location archives m${mx}_${mz}/l${mx}_${mz}`);
    World.gameMap.loadPackedMapsquare({ m, l, n: new Uint8Array(), o: new Uint8Array() }, mx * 64, mz * 64);
  }
  assert.equal(World.getTotalNpcs(), beforeNpcs, 'packed collision preflight loads no NPC spawn archives');
  const multiway = fs.readFileSync(path.join(content, 'maps/multiway.csv'), 'ascii').split(/\r?\n/);
  World.gameMap.loadCsvMap(World.gameMap.multimap, multiway);
  const stands = [
    { name: 'Ice Queen own stand', x: 2866, z: 9950, multi: true },
    { name: 'goblin single-combat stand', x: 2953, z: 3482, multi: false }
  ];
  for (const stand of stands) {
    assert.equal(mapApi.isMapBlocked(stand.x, stand.z, 0), false, `${stand.name} packed tile is walkable`);
    const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    assert(neighbours.some(([dx, dz]) => mapApi.isLineOfWalk(0, stand.x, stand.z, stand.x + dx, stand.z + dz)), `${stand.name} has a packed walkable neighbour`);
    assert.equal(World.gameMap.isMulti(CoordGrid.packCoord(0, stand.x, stand.z)), stand.multi, `${stand.name} multiway state`);
  }
}
packedCollisionPreflight();

function player(f, slot, x, z, level = 0, label = `player-${slot}`) {
  assert(!actorsBySlot.has(slot), `slot ${slot} is free`);
  const p = new Player(`ancient_area_${slot}`, BigInt(slot), BigInt(slot));
  p.slot = p.pid = slot;
  p.uid = (slot << 11) | slot;
  p.isActive = true;
  p.x = x;
  p.z = z;
  p.level = level;
  p.levels.fill(99);
  p.baseLevels.fill(99);
  p.stats.fill(130344310);
  p.write = () => {};
  p.messages = [];
  p.messageGame = p.wrappedMessageGame = text => p.messages.push(String(text));
  p._ancientAreaLabel = label;
  p.getInventory(invId);
  p.getInventory(wornId);
  World.players[slot] = p;
  World.playerLoop.add(p.hash64, p);
  const zone = World.gameMap.getZone(p.x, p.z, p.level);
  zone.enter(p);
  p._ancientAreaZone = zone;
  variable(p, 'tutorial', 1000);
  variable(p, 'deserttreasure', 15);
  variable(p, 'alternate_spells', 1);
  variable(p, 'com_magicattack', 1000000000);
  variable(p, 'com_magicdef', 0);
  for (const rune of allRunes) p.invAdd(invId, id('ObjType', rune), 100);
  p.levels[3] = 50;
  actorsBySlot.set(slot, p);
  f.players.push(p);
  return p;
}

function npc(f, { typeName = 'Cow', x, z, level = 0, size, label = typeName, lifecycle = EntityLifeCycle.DESPAWN } = {}) {
  const named = types.NpcType.getByName(typeName);
  const config = named?.op?.[1] === 'Attack'
    ? named
    : Array.from({ length: types.NpcType.count }, (_, index) => types.NpcType.get(index)).find(type => type.name === typeName && type.op?.[1] === 'Attack') ?? named;
  assert(config?.op?.[1] === 'Attack', `attackable NPC type ${typeName}`);
  const footprint = size ?? config.size;
  const n = new Npc(level, x, z, footprint, footprint, lifecycle, World.getNextNid(), config.id, config.blockwalk);
  n._ancientAreaLabel = label;
  n._ancientAreaTypeName = typeName;
  World.addNpc(n, -1);
  n.levels[3] = n.baseLevels[3] = 200;
  n.levels[0] = n.baseLevels[0] = 83;
  n.levels[5] = n.baseLevels[5] = 0;
  nv(n, 'npc_combat_xp_multiplier', 1000);
  if (f.p) nv(n, 'npc_aggressive_player', f.p.uid);
  f.npcs.push(n);
  return n;
}

function fixture({ pvp = false, defensive = false, protectedMagic = false, casterAt = [3101, 3800, 0], primaryAt = [3102, 3800, 0], primaryNpcType = 'Cow', primaryNpcSize, label = 'fixture' } = {}) {
  World.currentTick = 1000;
  const f = { pvp, defensive, players: [], npcs: [], multiBefore: new Map(), label };
  f.p = player(f, 1, ...casterAt, `${label}-caster`);
  variable(f.p, 'damagestyle', defensive ? 2 : 0);
  if (pvp) {
    f.target = player(f, 2, ...primaryAt, `${label}-primary`);
    f.target.levels[3] = 99;
    f.target.levels[0] = f.target.baseLevels[0] = 83;
    variable(f.target, 'prayer12', Number(protectedMagic));
  } else {
    const [x, z, level] = primaryAt;
    f.target = npc(f, { typeName: primaryNpcType, x, z, level, size: primaryNpcSize, label: `${label}-primary` });
  }
  return f;
}

function addPlayer(f, { x, z, level = 0, label, prayer = false } = {}) {
  const slot = 3 + f.players.length;
  const p = player(f, slot, x, z, level, label ?? `secondary-${slot}`);
  p.levels[0] = p.baseLevels[0] = 83;
  p.levels[3] = p.baseLevels[3] = 99;
  variable(p, 'prayer12', Number(prayer));
  return p;
}

function addNpc(f, options) {
  const n = npc(f, options);
  if (f.p) nv(n, 'npc_aggressive_player', f.p.uid);
  return n;
}

function setMulti(f, entity, multi) {
  const key = ZoneMap.zoneIndex(entity.x, entity.z, entity.level);
  if (!f.multiBefore.has(key)) {
    f.multiBefore.set(key, World.gameMap.isMulti(CoordGrid.packCoord(entity.level, entity.x, entity.z)));
  }
  World.gameMap.setMultiZone(key, multi);
}

function setMultiFor(f, entities, multi = true) {
  for (const entity of entities) setMulti(f, entity, multi);
}

function dispose(f) {
  for (const n of f.npcs) if (n.isActive) World.removeNpc(n, 0);
  for (const p of f.players) {
    if (p._ancientAreaZone) p._ancientAreaZone.leave(p);
    World.players[p.slot] = null;
    p.unlink();
    actorsBySlot.delete(p.slot);
    p.cleanup();
  }
  for (const [key, multi] of f.multiBefore) World.gameMap.setMultiZone(key, multi);
}

const actorLabels = actors => actors.map(actor => actor._ancientAreaLabel);
const inventory = p => [...p.getInventory(invId).items].map(item => item && [item.id, item.count]);
const xp = p => [p.stats[6], p.stats[1], p.stats[3]];
function run(f, name, args = []) {
  const script = Provider.getByName(name);
  assert(script, `compiled ${name}`);
  const state = Runner.init(script, f.p, f.target, args);
  assert.equal(f.p.runScript(state, true, true), State.FINISHED, `${name}: ${f.p.messages.join(' | ')}`);
  return state;
}
function componentTrigger(f, spell) {
  const component = id('Component', `inter_267:com_${spell.widget}`);
  const triggerType = f.pvp ? Trigger.APPLAYERT : Trigger.APNPCT;
  const trigger = Provider.getByTrigger(triggerType, component, -1);
  assert(trigger, `${spell.name} real component dispatch`);
  const actorKind = f.pvp ? 'applayert' : 'apnpct';
  assert.equal(trigger.name, `[${actorKind},inter_267:com_${spell.widget}]`, `${spell.name} component binding`);
  return trigger.name;
}
function areaMember(centre, entity) {
  return entity.level === centre.level && Math.abs(entity.x - centre.x) <= 1 && Math.abs(entity.z - centre.z) <= 1;
}
function isMulti(entity) {
  return World.gameMap.isMulti(CoordGrid.packCoord(entity.level, entity.x, entity.z));
}
function npcVictims(f) {
  const primary = f.target;
  const centre = { x: primary.x, z: primary.z, level: primary.level };
  if (!isMulti(f.p) || !isMulti(primary)) return [primary];
  const native = [...new NpcIterator(World.currentTick, centre.level, centre.x, centre.z, 1, 0, 1)];
  return [primary, ...native.filter(n => n !== primary && areaMember(centre, n) && isMulti(n) && n._ancientAreaTypeName !== 'ikov_firewarrior')];
}
function playerVictims(f) {
  const primary = f.target;
  const centre = { x: primary.x, z: primary.z, level: primary.level };
  if (!isMulti(f.p) || !isMulti(primary)) return [primary];
  const native = [...new PlayerHuntAllCommandIterator(World.currentTick, centre.level, centre.x, centre.z, 1, 0)];
  return [primary, ...native.filter(p => p !== f.p && p !== primary && p.isActive && areaMember(centre, p) && isMulti(p))];
}
function npcParam(n, name) {
  const type = types.NpcType.get(n.type);
  const param = types.ParamType.getByName(name);
  return type?.params?.get(param.id) ?? param.defaultInt;
}
function victimModel(f, victim) {
  if (f.pvp) {
    return {
      pvp: true,
      attack: variable(f.p, 'com_magicattack'),
      defence: variable(victim, 'com_magicdef'),
      protectedMagic: variable(victim, 'prayer12') !== 0,
      hp: victim.levels[3]
    };
  }
  const zeroCap = victim._ancientAreaTypeName?.startsWith('slayer_kurask') || victim._ancientAreaTypeName?.startsWith('slayer_turoth');
  return {
    attack: variable(f.p, 'com_magicattack'),
    defence: (victim.levels[5] + 9) * (64 + npcParam(victim, 'magicdefence')),
    cap: zeroCap ? 0 : npcParam(victim, 'max_dealt'),
    hp: victim.levels[3]
  };
}
function attachQueueTrace(actors, events) {
  const restore = [];
  for (const actor of actors) {
    const native = actor.enqueueScript;
    actor.enqueueScript = function (...args) {
      const npcQueue = typeof args[0] === 'number';
      events.push({
        actor,
        scriptName: npcQueue ? null : args[0]?.name,
        queueId: npcQueue ? args[0] : null,
        delay: npcQueue ? args[1] : args[2]
      });
      return native.apply(this, args);
    };
    restore.push(() => { actor.enqueueScript = native; });
  }
  return () => { for (const unpatch of restore.reverse()) unpatch(); };
}
function assertPointers(f, state) {
  assert.equal(state.execution, State.FINISHED, 'area scan does not suspend');
  assert.equal(f.p.activeScript, null, 'caster has no suspended active script');
  assert.equal(state._activePlayer, f.p, 'caster player pointer is restored');
  assert.equal(state._activeNpc2, null, 'no secondary NPC pointer remains');
  if (f.pvp) {
    assert.equal(state._activePlayer2, f.target, 'primary player pointer is restored');
    assert.equal(state._activeNpc, null, 'player scan leaves no NPC pointer');
  } else {
    assert.equal(state._activeNpc, f.target, 'primary NPC pointer is restored');
    assert.equal(state._activePlayer2, null, 'NPC scan leaves no secondary player pointer');
  }
  assert.equal(f.p.protect, false, 'caster protected-access flag is cleared');
}
function queueNpcHits(victim) {
  return [...victim.queue.all()].filter(q => q.queueId === Trigger.AI_QUEUE2);
}
function queuePlayerHits(victim) {
  return [...victim.queue.all()].filter(q => q.script?.name === '[queue,pvp_damage]');
}
function queueHits(f, victim) {
  return f.pvp ? queuePlayerHits(victim) : queueNpcHits(victim);
}
function queueRetaliations(f, victim) {
  const queued = [...victim.queue.all()];
  return f.pvp
    ? queued.filter(q => q.script.name === '[queue,pvp_retaliate]')
    : queued.filter(q => q.queueId === Trigger.AI_QUEUE1);
}
function queueEffects(f, spell, victim) {
  const queued = [...victim.queue.all()];
  if (spell.family === 1) {
    return f.pvp
      ? queued.filter(q => q.script.name === '[queue,ancient_player_impact]')
      : queued.filter(q => q.queueId === Trigger.AI_QUEUE9);
  }
  if (spell.family === 2 || spell.family === 4) {
    return f.pvp
      ? queued.filter(q => q.script.name === '[queue,ancient_player_impact]')
      : queued.filter(q => q.queueId === Trigger.AI_QUEUE9);
  }
  return [];
}
function assertPaidOnce(f, spell, before) {
  for (const rune of allRunes) {
    assert.equal(f.p.invTotal(invId, id('ObjType', rune)), 100 - (spell.runes.find(([name]) => name === rune)?.[1] ?? 0), `${spell.name} exact one payment of ${rune}`);
  }
  assert.deepEqual(xp(f.p).map((value, index) => value - before.xp[index]), before.expectedXp, `${spell.name} base plus per-victim XP once`);
  assert.equal(variable(f.p, 'action_delay'), 1005, `${spell.name} one cast commitment`);
}
function castArea(f, spell, seed, victims, { requireAccurate = true } = {}) {
  assert(victims.length > 0, `${spell.name} has a primary victim`);
  const expected = rollArea(seed, spell, victims.map(victim => victimModel(f, victim)));
  const earnedXp = areaExperience(spell, expected, { defensive: f.defensive, multiplier: f.pvp ? 1125 : 1000 });
  const before = {
    xp: xp(f.p),
    casterHp: f.p.levels[3],
    hps: new Map(victims.map(victim => [victim, victim.levels[3]])),
    expectedXp: [earnedXp.magic, earnedXp.defence, earnedXp.hitpoints]
  };
  const events = [];
  const untrace = attachQueueTrace([...f.players, ...f.npcs], events);
  const triggerName = componentTrigger(f, spell);
  JavaRandom.setSeed(seed);
  const draws = [];
  const nativeNextDouble = JavaRandom.nextDouble;
  JavaRandom.nextDouble = function () {
    const result = nativeNextDouble.call(this);
    assert(draws.length < expected.draws.length, `${spell.name} draws more randomness than its admitted victims`);
    draws.push(result);
    return result;
  };
  let state;
  try {
    state = run(f, triggerName);
  } finally {
    JavaRandom.nextDouble = nativeNextDouble;
    untrace();
  }
  assert.deepEqual(draws, expected.draws, `${spell.name} independent per-victim RNG order`);
  assert.equal(JavaRandom.nextInt(1000000), expected.nextRandom, `${spell.name} no hidden random draws`);
  assertPaidOnce(f, spell, before);
  assertPointers(f, state);

  const hitDelays = [];
  for (let index = 0; index < victims.length; index++) {
    const victim = victims[index];
    const result = expected.results[index];
    const hits = queueHits(f, victim);
    assert.equal(hits.length, Number(result.accurate), `${spell.name} ${victim._ancientAreaLabel} accuracy queue`);
    const retaliations = queueRetaliations(f, victim);
    assert.equal(retaliations.length, 1, `${spell.name} ${victim._ancientAreaLabel} receives independent retaliation`);
    assert.equal(retaliations[0].delay, result.accurate ? (hits[0]?.delay ?? 0) : 0, `${spell.name} ${victim._ancientAreaLabel} retaliation timing follows its own accuracy`);
    if (hits.length) {
      const damage = f.pvp ? hits[0].args[0] : hits[0].lastInt;
      assert.equal(damage, result.damage, `${spell.name} ${victim._ancientAreaLabel} own cap/protection/HP damage`);
      hitDelays.push(hits[0].delay);
    }
    assert.equal(victim.levels[3], before.hps.get(victim), `${spell.name} damage waits for queued impact`);
    const effects = queueEffects(f, spell, victim);
    const expectedEffects = spell.family === 1 ? Number(result.poison) : spell.family === 2 || spell.family === 4 ? Number(result.accurate) : 0;
    assert.equal(effects.length, expectedEffects, `${spell.name} ${victim._ancientAreaLabel} family effect admission`);
    if (effects.length && hits.length) assert.equal(effects[0].delay, hits[0].delay, `${spell.name} effect shares its victim impact`);
  }
  if (requireAccurate) assert(hitDelays.length > 0, `${spell.name} fixed seed witnesses at least one accurate victim`);
  else assert.equal(hitDelays.length, 0, `${spell.name} fixed seed splashes every victim`);
  assert(hitDelays.every(delay => delay === hitDelays[0]), `${spell.name} area victims share cast impact delay`);

  const bloodQueues = [...f.p.queue.all()].filter(q => q.script.name === '[queue,ancient_blood_heal]');
  if (spell.family === 3) {
    const heal = bloodHeal(expected);
    assert.equal(bloodQueues.length, Number(heal.hasAccuracy), `${spell.name} one aggregate Blood queue only after an accurate victim`);
    if (bloodQueues.length) {
      const rolledTotal = expected.results.reduce((sum, result) => sum + (result.accurate ? result.rolled : 0), 0);
      assert.equal(bloodQueues[0].args[0], rolledTotal, `${spell.name} Blood queue receives the sum of accepted pre-clip rolls`);
      const firstHit = [...f.target.queue.all()].find(q => f.pvp ? q.script.name === '[queue,pvp_damage]' : q.queueId === Trigger.AI_QUEUE2);
      assert(firstHit, `${spell.name} primary damage queue exists`);
      assert.equal(bloodQueues[0].delay, f.pvp ? firstHit.delay : firstHit.delay - 1, `${spell.name} aggregate Blood queue uses the published actor countdown`);
      const bloodEvent = events.findIndex(event => event.actor === f.p && event.scriptName === '[queue,ancient_blood_heal]');
      assert(bloodEvent >= 0, `${spell.name} aggregate Blood queue admission was traced`);
      for (const victim of victims) {
        if (!queueHits(f, victim).length) continue;
        const hitEvent = events.findIndex(event => event.actor === victim && (f.pvp ? event.scriptName === '[queue,pvp_damage]' : event.queueId === Trigger.AI_QUEUE2));
        assert(hitEvent >= 0 && hitEvent < bloodEvent, `${spell.name} aggregate queue follows all victim damage admissions`);
      }
    }
  } else {
    assert.equal(bloodQueues.length, 0, `${spell.name} does not schedule Blood healing`);
  }
  return { expected, before, victims, state, events, impactDelay: hitDelays[0] };
}

function tickAll(f) {
  World.currentTick++;
  for (const n of f.npcs) if (n.isActive) n.processQueue();
  for (const p of f.players) p.processQueues();
}
function tickDeathFlight(f, dyingNpc = null) {
  World.currentTick++;
  for (const n of f.npcs) {
    if (n === dyingNpc) n.turn();
    else if (n.isActive) n.processQueue();
  }
  for (const p of f.players) {
    if (p.delayed && World.currentTick >= p.delayedUntil) p.delayed = false;
    if (!p.delayed && p.activeScript && p.activeScript.execution === State.SUSPENDED) {
      p.executeScript(p.activeScript, true, true);
    }
    p.processQueues();
  }
}
function settleArea(f, spell, result) {
  const impact = 1000 + result.impactDelay + Number(f.pvp);
  while (World.currentTick < impact + 2) tickAll(f);
  for (let index = 0; index < result.victims.length; index++) {
    const victim = result.victims[index];
    const expected = result.expected.results[index];
    const hp = result.before.hps.get(victim) - (expected.damage ?? 0);
    assert.equal(victim.levels[3], hp, `${spell.name} ${victim._ancientAreaLabel} queued damage settles once`);
    if (!expected.accurate) continue;
    if (spell.family === 1) {
      assert.equal(f.pvp ? variable(victim, 'poison') : nv(victim, 'npc_poison'), expected.poison ? spell.poison : 0, `${spell.name} Smoke applies only its independently rolled proc`);
    } else if (spell.family === 2) {
      assert.equal(victim.levels[0], 75, `${spell.name} Shadow drains each accurate victim`);
    } else if (spell.family === 4) {
      const duration = f.pvp && variable(victim, 'prayer12') !== 0 ? spell.freeze / 2 : spell.freeze;
      assert.equal(f.pvp ? variable(victim, 'frozen') : nv(victim, 'npc_stunned'), impact + duration + Number(!f.pvp), `${spell.name} Ice freezes each accurate victim at its queued impact`);
    }
  }
  if (spell.family === 3) {
    const heal = bloodHeal(result.expected);
    const expectedHp = Math.min(f.p.baseLevels[3], result.before.casterHp + heal.amount);
    assert.equal(f.p.levels[3], expectedHp, `${spell.name} rounds aggregate Blood once and respects the base HP cap`);
    assert.equal([...f.p.queue.all()].filter(q => q.script.name === '[queue,ancient_blood_heal]').length, 0, `${spell.name} aggregate heal is consumed once`);
  }
}

function assertSpellRow(spell) {
  const r = row(spell.name);
  assert(r, `${spell.name} compiled row`);
  assert.equal(field(r, 'levelrequired'), spell.level, `${spell.name} level`);
  assert.equal(field(r, 'experience'), spell.xp * 10, `${spell.name} base XP`);
  assert.equal(field(r, 'maxhit'), spell.maximum, `${spell.name} maximum`);
  assert.equal(field(r, 'ancient_effect'), spell.family, `${spell.name} effect family`);
  assert.equal(field(r, 'members'), 1, `${spell.name} is members-only`);
  assert.equal(field(r, 'continue_by_autocast'), 0, `${spell.name} does not add U3 autocast`);
  const areaValues = values(r, 'ancient_area');
  if (spell.area) assert.deepEqual(areaValues, [1], `${spell.name} has explicit area=true`);
  else assert(!areaValues || areaValues.length === 0 || areaValues[0] === null || areaValues[0] === undefined || areaValues[0] === 0 || areaValues[0] === false, `${spell.name} single-target row treats missing area as false`);
  if (spell.family === 1) assert.equal(field(r, 'poison_severity'), spell.poison, `${spell.name} existing Smoke severity`);
  if (spell.family === 4) assert.equal(field(r, 'freeze_time'), spell.freeze, `${spell.name} existing freeze duration`);
  const vector = values(r, 'runesrequired');
  assert.equal(vector.length, 8, `${spell.name} has four rune pairs`);
  assert.deepEqual(vector.flatMap((value, index) => index % 2 === 0 && value >= 0 ? [[types.ObjType.get(value).debugname, vector[index + 1]]] : []), spell.runes, `${spell.name} exact rune vector`);
  assert.equal(field(r, 'spellcom'), id('Component', `inter_267:com_${spell.widget}`), `${spell.name} cache component row binding`);
}

const allSpells = [...singleTargetSpells, ...areaSpells];
for (const spell of allSpells) assertSpellRow(spell);
for (const spell of areaSpells) {
  for (const pvp of [false, true]) {
    const f = fixture({ pvp, label: `${spell.name}-${pvp ? 'player' : 'npc'}` });
    try {
      const secondary = pvp
        ? addPlayer(f, { x: f.target.x + 1, z: f.target.z, label: `${spell.name}-secondary` })
        : addNpc(f, { x: f.target.x + 1, z: f.target.z, label: `${spell.name}-secondary` });
      const crossKind = pvp
        ? addNpc(f, { x: f.target.x, z: f.target.z + 1, label: `${spell.name}-cross-kind` })
        : addPlayer(f, { x: f.target.x, z: f.target.z + 1, label: `${spell.name}-cross-kind` });
      setMultiFor(f, [f.p, f.target, secondary, crossKind], true);
      const victims = pvp ? playerVictims(f) : npcVictims(f);
      assert.deepEqual(actorLabels(victims), actorLabels([f.target, secondary]), `${spell.name} primary-first same-kind area victims`);
      const result = castArea(f, spell, 0, victims);
      if (pvp) {
        assert.equal(queueHits(f, f.p).length, 0, `${spell.name} cannot hit its caster`);
        assert.equal(queueNpcHits(crossKind).length, 0, `${spell.name} player area does not cross into NPCs`);
      } else {
        assert.equal(queuePlayerHits(crossKind).length, 0, `${spell.name} NPC area does not cross into players`);
      }
      settleArea(f, spell, result);
    } finally {
      dispose(f);
    }
  }
}

// Every square on the closed 3x3 boundary is included. Plane and distance two are excluded.
{
  const f = fixture({ label: 'area-geometry' });
  try {
    const centre = CoordGrid.packCoord(0, 3102, 3800);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const victim = CoordGrid.packCoord(0, 3102 + dx, 3800 + dz);
      const inside = Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
      assert.equal(run(f, '[proc,ancient_area_contains]', [centre, victim]).popInt(), Number(inside), `3x3 tile offset ${dx},${dz}`);
    }
    assert.equal(run(f, '[proc,ancient_area_contains]', [centre, CoordGrid.packCoord(1, 3102, 3800)]).popInt(), 0, 'area excludes another plane');
  } finally { dispose(f); }
}

// Single-combat expansion requires both the caster and the primary target to be in multi.
for (const pvp of [false, true]) for (const missingMulti of ['caster', 'primary']) {
  const f = fixture({ pvp, casterAt: [3095, 3800, 0], primaryAt: [3096, 3800, 0], label: `single-${pvp ? 'player' : 'npc'}-${missingMulti}` });
  try {
    const secondary = pvp
      ? addPlayer(f, { x: f.target.x + 1, z: f.target.z, label: 'single-combat-secondary' })
      : addNpc(f, { x: f.target.x + 1, z: f.target.z, label: 'single-combat-secondary' });
    setMultiFor(f, [f.p, f.target, secondary], true);
    setMulti(f, missingMulti === 'caster' ? f.p : f.target, false);
    const victims = pvp ? playerVictims(f) : npcVictims(f);
    assert.deepEqual(actorLabels(victims), actorLabels([f.target]), `${missingMulti} single-combat gate keeps the primary only`);
    const result = castArea(f, areaSpells.find(spell => spell.name === 'shadow_burst'), 0, victims);
    assert.equal(queueHits(f, secondary).length, 0, 'single-combat secondary receives no damage queue');
    settleArea(f, areaSpells.find(spell => spell.name === 'shadow_burst'), result);
  } finally { dispose(f); }
}

// A large NPC is anchored at its southwest tile and appears once, even when footprints overlap.
{
  const f = fixture({ primaryNpcSize: 4, label: 'large-npc-anchor' });
  try {
    const inside = addNpc(f, { x: f.target.x + 1, z: f.target.z, size: 4, label: 'large-inside' });
    const outside = addNpc(f, { x: f.target.x + 2, z: f.target.z, size: 4, label: 'large-outside' });
    setMultiFor(f, [f.p, f.target, inside, outside], true);
    const victims = npcVictims(f);
    assert.deepEqual(actorLabels(victims), actorLabels([f.target, inside]), 'large NPC membership uses southwest anchors and one native iterator result');
    const spell = areaSpells.find(entry => entry.name === 'shadow_burst');
    const result = castArea(f, spell, 0, victims);
    assert.equal(queueHits(f, inside).length, 1, 'overlapping large footprint receives one hit');
    assert.equal(queueHits(f, outside).length, 0, 'outside southwest anchor remains outside');
    settleArea(f, spell, result);
  } finally { dispose(f); }
}

// Per-victim NPC caps and misses remain independent. Plane and outside candidates stay untouched.
{
  const f = fixture({ label: 'npc-independent-outcomes' });
  try {
    const capped = addNpc(f, { typeName: 'macro_triffidseed_angry', x: f.target.x + 1, z: f.target.z, label: 'capped-secondary' });
    const corner = addNpc(f, { x: f.target.x + 1, z: f.target.z + 1, label: '3x3-corner' });
    const highDef = addNpc(f, { x: f.target.x - 1, z: f.target.z + 1, label: 'high-defence-miss' });
    highDef.levels[5] = highDef.baseLevels[5] = 65535;
    const outside = addNpc(f, { x: f.target.x + 2, z: f.target.z, label: 'outside-3x3' });
    const otherPlane = addNpc(f, { x: f.target.x, z: f.target.z + 1, level: 1, label: 'other-plane' });
    const crossKind = addPlayer(f, { x: f.target.x, z: f.target.z - 1, label: 'cross-kind-player' });
    setMultiFor(f, [f.p, f.target, capped, corner, highDef, outside, otherPlane, crossKind], true);
    variable(f.p, 'com_magicattack', 100000);
    const victims = npcVictims(f);
    assert(victims.includes(corner), 'diagonal 3x3 edge is included');
    assert(!victims.includes(outside), 'distance-two NPC is excluded');
    assert(!victims.includes(otherPlane), 'other-plane NPC is excluded');
    const spell = areaSpells.find(entry => entry.name === 'shadow_burst');
    const result = castArea(f, spell, 0, victims);
    const capResult = result.expected.results[victims.indexOf(capped)];
    const missResult = result.expected.results[victims.indexOf(highDef)];
    assert(capResult.maximum <= 3, 'NPC max_dealt caps only the capped victim');
    assert.equal(missResult.accurate, false, 'high-defence secondary independently misses');
    assert(queueHits(f, outside).length === 0 && queueHits(f, otherPlane).length === 0, 'invalid geometry candidates receive no damage');
    assert.equal(queuePlayerHits(crossKind).length, 0, 'NPC scan never hits a nearby player');
    settleArea(f, spell, result);
  } finally { dispose(f); }
}

// A fixed 13-NPC area proves no nine-target cap and preserves one seeded miss.
{
  const f = fixture({ label: 'unlimited-npc-area' });
  try {
    const offsets = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1], [0, 0], [-1, 0], [0, 1], [1, -1]];
    for (let index = 0; index < offsets.length; index++) {
      const [dx, dz] = offsets[index];
      addNpc(f, { x: f.target.x + dx, z: f.target.z + dz, label: `unlimited-${index}` });
    }
    setMultiFor(f, [f.p, ...f.npcs], true);
    const victims = npcVictims(f);
    assert.equal(victims.length, 13, 'primary plus twelve same-area NPCs');
    variable(f.p, 'com_magicattack', 100000);
    const miss = victims[2];
    miss.levels[5] = miss.baseLevels[5] = 65535;
    const spell = areaSpells.find(entry => entry.name === 'smoke_burst');
    const result = castArea(f, spell, 8, victims);
    assert.equal(result.expected.results.filter(entry => entry.accurate).length, 12, 'fixed-seed oracle has twelve hits and one miss');
    assert.equal(result.expected.results[2].accurate, false, 'the high-defence second iterator outcome misses');
    assert.equal(victims.filter(victim => queueHits(f, victim).length === 1).length, 12, 'all twelve accurate NPCs receive damage');
    assert.equal(victims.filter(victim => queueHits(f, victim).length === 0).length, 1, 'one NPC miss does not stop later victims');
    assert(victims.filter(victim => queueHits(f, victim).length === 1).length > 9, 'area has no fixed nine-victim limit');
    settleArea(f, spell, result);
  } finally { dispose(f); }
}

// Busy secondaries are hit like primaries; combat protection still reduces only its own victim.
{
  const f = fixture({ pvp: true, label: 'player-secondary-admission' });
  try {
    const valid = addPlayer(f, { x: f.target.x + 1, z: f.target.z, label: 'valid-secondary' });
    const protectedMagic = addPlayer(f, { x: f.target.x + 1, z: f.target.z + 1, label: 'protect-magic-secondary', prayer: true });
    const busy = addPlayer(f, { x: f.target.x - 1, z: f.target.z, label: 'busy-secondary' });
    const modal = addPlayer(f, { x: f.target.x - 1, z: f.target.z + 1, label: 'modal-secondary' });
    const protectedAccess = addPlayer(f, { x: f.target.x, z: f.target.z + 1, label: 'protected-access-secondary' });
    const crossKind = addNpc(f, { x: f.target.x, z: f.target.z - 1, label: 'cross-kind-npc' });
    busy.delayed = true;
    modal.modalState = 1;
    protectedAccess.protect = true;
    f.target.protect = true;
    f.target.delayed = true;
    setMultiFor(f, [f.p, f.target, valid, protectedMagic, busy, modal, protectedAccess, crossKind], true);
    const nativePlayers = [...new PlayerHuntAllCommandIterator(World.currentTick, f.target.level, f.target.x, f.target.z, 1, 0)];
    const secondaries = [valid, protectedMagic, busy, modal, protectedAccess];
    for (const secondary of secondaries) assert(nativePlayers.includes(secondary), `${secondary._ancientAreaLabel} is present in the native iterator`);
    const victims = [f.target, ...nativePlayers.filter(player => secondaries.includes(player))];
    assert.deepEqual(actorLabels(playerVictims(f)), actorLabels(victims), 'all same-kind in-area players are expected independently of access state');
    const spell = areaSpells.find(entry => entry.name === 'shadow_burst');
    const result = castArea(f, spell, 0, victims);
    const protectedResult = result.expected.results[victims.indexOf(protectedMagic)];
    assert.equal(protectedResult.maximum, Math.trunc(spell.maximum * 6 / 10), 'Protect from Magic reduces only that secondary maximum');
    for (const secondary of [busy, modal, protectedAccess]) {
      const expected = result.expected.results[victims.indexOf(secondary)];
      assert.equal(expected.accurate, true, `${secondary._ancientAreaLabel} oracle roll hits`);
      assert.equal(queueHits(f, secondary).length, 1, `${secondary._ancientAreaLabel} receives damage despite being busy`);
      assert.equal(queueRetaliations(f, secondary).length, 1, `${secondary._ancientAreaLabel} receives normal retaliation`);
      assert.deepEqual(secondary.messages, [], `${secondary._ancientAreaLabel} gets no invented access refusal`);
    }
    assert.equal(queueNpcHits(crossKind).length, 0, 'player scan does not hit NPCs');
    assert.equal(queueHits(f, f.p).length, 0, 'player scan excludes its caster');
    busy.delayed = false;
    modal.modalState = 0;
    protectedAccess.protect = false;
    f.target.delayed = false;
    f.target.protect = false;
    settleArea(f, spell, result);
  } finally { dispose(f); }
}

// A real count-dialog secondary matches the published single-target primary path.
{
  const beginCountDialog = victim => {
    const script = Provider.getByName('[label,bank_withdraw]');
    assert(script, 'published bank count-dialog label');
    const state = Runner.init(script, victim, null, [0, 0]);
    victim.executeScript(state, true, true);
    assert.equal(state.execution, State.COUNTDIALOG, 'real numeric input suspends the victim');
    assert.equal(victim.activeScript, state, 'the actual suspended script is retained');
    assert.equal(victim.protect, true, 'numeric input begins with protected access');
    assert.equal(victim.delayed, false, 'numeric input adds no delay');
    assert.equal(victim.modalState, 0, 'numeric input adds no server modal');
  };
  const snapshot = victim => ({
    interface: { state: victim.modalState, main: victim.modalMain, chat: victim.modalChat },
    protect: victim.protect,
    activeScript: victim.activeScript && { name: victim.activeScript.script.name, execution: victim.activeScript.execution },
    preventLogoutMessage: victim.preventLogoutMessage,
    preventLogoutUntil: victim.preventLogoutUntil
  });
  const primary = fixture({ pvp: true, label: 'published-count-dialog-primary' });
  let publishedState;
  try {
    beginCountDialog(primary.target);
    const spell = singleTargetSpells.find(entry => entry.name === 'shadow_blitz');
    JavaRandom.setSeed(0);
    run(primary, componentTrigger(primary, spell));
    assert.equal(queuePlayerHits(primary.target).length, 1, 'published single-target primary is hit');
    publishedState = snapshot(primary.target);
    const hp = primary.target.levels[3];
    for (let ticks = 0; queuePlayerHits(primary.target).length && ticks < 10; ticks++) tickAll(primary);
    assert(primary.target.levels[3] < hp, 'published primary damage really lands');
  } finally { dispose(primary); }
  const area = fixture({ pvp: true, label: 'area-count-dialog-secondary' });
  try {
    const secondary = addPlayer(area, { x: area.target.x + 1, z: area.target.z, label: 'count-dialog-secondary' });
    setMultiFor(area, [area.p, area.target, secondary], true);
    beginCountDialog(secondary);
    const spell = areaSpells.find(entry => entry.name === 'shadow_burst');
    const result = castArea(area, spell, 0, playerVictims(area));
    assert.equal(queuePlayerHits(secondary).length, 1, 'count-dialog secondary is hit');
    assert.deepEqual(snapshot(secondary), publishedState, 'secondary interface, protection, active script and logout prevention match the published primary');
    settleArea(area, spell, result);
  } finally { dispose(area); }
}

// A secondary's own single-combat cell is excluded even when the cast origin is multi.
for (const pvp of [false, true]) {
  const f = fixture({ pvp, casterAt: [3094, 3800, 0], primaryAt: [3095, 3800, 0], label: 'secondary-single-cell' });
  try {
    const secondary = pvp
      ? addPlayer(f, { x: 3096, z: 3800, label: 'single-cell-secondary' })
      : addNpc(f, { x: 3096, z: 3800, label: 'single-cell-secondary' });
    setMultiFor(f, [f.p, f.target], true);
    setMulti(f, secondary, false);
    assert(isMulti(f.p) && isMulti(f.target) && !isMulti(secondary), 'fixture crosses an eight-tile multiway boundary');
    const spell = areaSpells.find(entry => entry.name === 'shadow_burst');
    const result = castArea(f, spell, 0, [f.target]);
    assert.equal(queueHits(f, secondary).length, 0, 'single-cell secondary has no damage admission');
    assert.equal(queueRetaliations(f, secondary).length, 0, 'single-cell secondary has no retaliation admission');
    settleArea(f, spell, result);
  } finally { dispose(f); }
}

// Native iteration skips an unavailable NPC; quiet admission skips an unmet Slayer requirement.
{
  const f = fixture({ label: 'quiet-npc-secondary-admission' });
  try {
    f.p.levels[18] = f.p.baseLevels[18] = 1;
    const valid = addNpc(f, { x: f.target.x + 1, z: f.target.z, label: 'valid-secondary' });
    const delayed = addNpc(f, { x: f.target.x, z: f.target.z + 1, label: 'delayed-secondary' });
    const slayer = addNpc(f, { typeName: 'slayer_turoth', x: f.target.x + 1, z: f.target.z + 1, label: 'unmet-slayer-secondary' });
    delayed.delayed = true;
    setMultiFor(f, [f.p, f.target, valid, delayed, slayer], true);
    const native = [...new NpcIterator(World.currentTick, f.target.level, f.target.x, f.target.z, 1, 0, 1)];
    assert(!native.includes(delayed) && native.includes(slayer), 'availability and product admission are distinct filters');
    const spell = areaSpells.find(entry => entry.name === 'shadow_burst');
    const result = castArea(f, spell, 0, [f.target, valid]);
    for (const skipped of [delayed, slayer]) {
      assert.equal(queueHits(f, skipped).length, 0, 'unavailable or Slayer-locked NPC receives no damage');
      assert.equal(queueRetaliations(f, skipped).length, 0, 'unavailable or Slayer-locked NPC receives no retaliation');
    }
    assert.deepEqual(f.p.messages, [], 'secondary Slayer refusal is silent');
    settleArea(f, spell, result);
  } finally { dispose(f); }
}

// A dead player and a level-ineligible wilderness player are not legal secondaries.
{
  const f = fixture({ pvp: true, label: 'quiet-player-legal-admission' });
  try {
    const valid = addPlayer(f, { x: f.target.x + 1, z: f.target.z, label: 'legal-secondary' });
    const low = addPlayer(f, { x: f.target.x + 1, z: f.target.z + 1, label: 'level-three-secondary' });
    low.levels.fill(1); low.baseLevels.fill(1);
    low.levels[3] = low.baseLevels[3] = 10;
    const dead = addPlayer(f, { x: f.target.x, z: f.target.z + 1, label: 'dead-secondary' });
    variable(dead, 'death', 1);
    const outside = addPlayer(f, { x: f.target.x + 2, z: f.target.z, label: 'distance-two-secondary' });
    const otherPlane = addPlayer(f, { x: f.target.x, z: f.target.z + 1, level: 1, label: 'other-plane-secondary' });
    setMultiFor(f, [f.p, f.target, valid, low, dead, outside, otherPlane], true);
    const spell = areaSpells.find(entry => entry.name === 'shadow_burst');
    const result = castArea(f, spell, 0, [f.target, valid]);
    for (const skipped of [low, dead, outside, otherPlane]) {
      assert.equal(queueHits(f, skipped).length, 0, 'illegal or out-of-area player receives no damage admission');
      assert.equal(queueRetaliations(f, skipped).length, 0, 'illegal or out-of-area player receives no retaliation admission');
      assert.deepEqual(skipped.messages, [], 'illegal or out-of-area player secondary refusal is silent');
    }
    assert.deepEqual(f.p.messages, [], 'secondary legality adds no caster dialogue');
    settleArea(f, spell, result);
  } finally { dispose(f); }
}

// Fire Warrior refusal is quiet for a multi-combat secondary and does not suspend the cast.
{
  const f = fixture({ label: 'quiet-ikov-secondary' });
  try {
    const valid = addNpc(f, { x: f.target.x + 1, z: f.target.z, label: 'valid-before-fire-warrior' });
    const fireWarrior = addNpc(f, { typeName: 'ikov_firewarrior', x: f.target.x + 1, z: f.target.z + 1, label: 'Fire Warrior of Lesarkus' });
    setMultiFor(f, [f.p, f.target, valid, fireWarrior], true);
    const nativeNpcs = [...new NpcIterator(World.currentTick, f.target.level, f.target.x, f.target.z, 1, 0, 1)];
    assert(nativeNpcs.includes(fireWarrior), 'Fire Warrior is reached by the native NPC iterator');
    const spell = areaSpells.find(entry => entry.name === 'shadow_burst');
    const victims = npcVictims(f);
    assert.deepEqual(actorLabels(victims), actorLabels([f.target, valid]), 'Fire Warrior is rejected before per-victim combat');
    const beforeMessages = [...f.p.messages];
    const result = castArea(f, spell, 0, victims);
    assert.deepEqual(f.p.messages, beforeMessages, 'Fire Warrior secondary refusal adds no dialogue');
    assert.equal(queueHits(f, fireWarrior).length, 0, 'Fire Warrior receives no damage');
    assert.equal(queueRetaliations(f, fireWarrior).length, 0, 'Fire Warrior receives no retaliation');
    assert.equal(result.state.execution, State.FINISHED, 'Fire Warrior refusal does not suspend the area scan');
    settleArea(f, spell, result);
  } finally { dispose(f); }
}

// Smoke uses an independent 1/8 effect roll for each accurate victim.
{
  const f = fixture({ label: 'smoke-three-victims' });
  try {
    const second = addNpc(f, { x: f.target.x + 1, z: f.target.z, label: 'smoke-second' });
    const third = addNpc(f, { x: f.target.x + 1, z: f.target.z + 1, label: 'smoke-third' });
    setMultiFor(f, [f.p, f.target, second, third], true);
    const spell = areaSpells.find(entry => entry.name === 'smoke_burst');
    const victims = npcVictims(f);
    assert.equal(victims.length, 3);
    const result = castArea(f, spell, 2, victims);
    assert(result.expected.results.every(entry => entry.accurate), 'seed 2 hits all three low-defence victims');
    assert.equal(result.expected.results.filter(entry => entry.poison).length, 1, 'seed 2 produces exactly one independent Smoke proc');
    settleArea(f, spell, result);
  } finally { dispose(f); }
}

{
  const f = fixture({ pvp: true, label: 'pvp-smoke-three-victims' });
  try {
    const second = addPlayer(f, { x: f.target.x + 1, z: f.target.z, label: 'pvp-smoke-second' });
    const third = addPlayer(f, { x: f.target.x + 1, z: f.target.z + 1, label: 'pvp-smoke-third' });
    setMultiFor(f, [f.p, f.target, second, third], true);
    const spell = areaSpells.find(entry => entry.name === 'smoke_burst');
    const victims = playerVictims(f);
    assert.deepEqual(actorLabels(victims).sort(), actorLabels([f.target, second, third]).sort(), 'PvP Smoke includes all three eligible players');
    const result = castArea(f, spell, 2, victims);
    assert(result.expected.results.every(entry => entry.accurate), 'seed 2 hits all three low-defence players');
    assert.equal(result.expected.results.filter(entry => entry.poison).length, 1, 'seed 2 produces one per-victim PvP Smoke proc');
    settleArea(f, spell, result);
  } finally { dispose(f); }
}

// All-splash Blood pays once but does not admit a caster heal queue.
for (const pvp of [false, true]) {
  const f = fixture({ pvp, label: `blood-all-splash-${pvp ? 'player' : 'npc'}` });
  try {
    f.p.levels[3] = 120;
    const secondary = pvp
      ? addPlayer(f, { x: f.target.x + 1, z: f.target.z, label: 'splash-secondary' })
      : addNpc(f, { x: f.target.x + 1, z: f.target.z, label: 'splash-secondary' });
    setMultiFor(f, [f.p, f.target, secondary], true);
    variable(f.p, 'com_magicattack', 0);
    const spell = areaSpells.find(entry => entry.name === 'blood_burst');
    const victims = pvp ? playerVictims(f) : npcVictims(f);
    const result = castArea(f, spell, 0, victims, { requireAccurate: false });
    assert(result.expected.results.every(entry => !entry.accurate), 'zero attack roll splashes on every victim');
    assert.equal([...f.p.queue.all()].filter(q => q.script.name === '[queue,ancient_blood_heal]').length, 0, 'all-splash Blood has no heal queue');
    for (let tick = 0; tick < 6; tick++) tickAll(f);
    assert.equal(f.p.levels[3], 120, 'all-splash Blood preserves boosted HP instead of processing a zero heal');
  } finally { dispose(f); }
}

// A real accurate zero roll on a Turoth still admits exactly one zero-basis Blood heal.
{
  const f = fixture({ primaryNpcType: 'slayer_turoth', label: 'blood-accurate-zero' });
  try {
    setMultiFor(f, [f.p, f.target], false);
    const spell = areaSpells.find(entry => entry.name === 'blood_burst');
    const result = castArea(f, spell, 0, [f.target]);
    assert.equal(result.expected.results[0].accurate, true, 'Turoth accuracy succeeds');
    assert.equal(result.expected.results[0].rolled, 0, 'Turoth existing max-dealt rule yields an accurate zero roll');
    const heals = [...f.p.queue.all()].filter(q => q.script.name === '[queue,ancient_blood_heal]');
    assert.equal(heals.length, 1, 'accurate zero roll admits one Blood queue');
    assert.equal(heals[0].args[0], 0, 'zero roll is retained as the aggregate basis');
    settleArea(f, spell, result);
  } finally { dispose(f); }
}

// The fixed rolls 10 and 21 distinguish rounding the sum from healing each victim.
for (const pvp of [false, true]) {
  const f = fixture({ pvp, defensive: true, label: `blood-rounding-cap-${pvp ? 'player' : 'npc'}` });
  try {
    const secondary = pvp
      ? addPlayer(f, { x: f.target.x + 1, z: f.target.z, label: 'rounding-secondary' })
      : addNpc(f, { x: f.target.x + 1, z: f.target.z, label: 'rounding-secondary' });
    setMultiFor(f, [f.p, f.target, secondary], true);
    f.p.levels[3] = 98;
    const spell = areaSpells.find(entry => entry.name === 'blood_burst');
    const victims = pvp ? playerVictims(f) : npcVictims(f);
    const result = castArea(f, spell, 2, victims);
    assert.deepEqual(result.expected.results.map(entry => entry.rolled), [10, 21], 'fixed Blood rounding witness');
    assert.equal(bloodHeal(result.expected).amount, 8, 'ceil((10 + 21) / 4), not ceil(10 / 4) + ceil(21 / 4)');
    settleArea(f, spell, result);
    assert.equal(f.p.levels[3], 99, 'aggregate heal caps at the caster base HP');
  } finally { dispose(f); }
}

// A caster-owned heal survives a damaged victim disappearing before impact.
{
  const f = fixture({ label: 'blood-victim-despawns-before-impact' });
  try {
    const survivor = addNpc(f, { x: f.target.x + 1, z: f.target.z, label: 'blood-surviving-secondary' });
    setMultiFor(f, [f.p, f.target, survivor], true);
    const spell = areaSpells.find(entry => entry.name === 'blood_burst');
    const result = castArea(f, spell, 2, npcVictims(f));
    assert(result.expected.results.every(entry => entry.accurate), 'both victims contribute accepted rolls');
    World.removeNpc(f.target, 0);
    assert.equal(f.target.isActive, false, 'primary despawns before either damage or heal countdown expires');
    const survivorIndex = result.victims.indexOf(survivor);
    while (World.currentTick < 1000 + result.impactDelay + 2) tickAll(f);
    assert.equal(survivor.levels[3], result.before.hps.get(survivor) - result.expected.results[survivorIndex].damage, 'remaining victim impact still settles');
    assert.equal(f.p.levels[3], 50 + bloodHeal(result.expected).amount, 'caster heal does not dereference the departed victim');
    assert.equal([...f.p.queue.all()].filter(q => q.script.name === '[queue,ancient_blood_heal]').length, 0, 'caster heal settles once after victim removal');
  } finally { dispose(f); }
}

// A secondary killed by an independent source is clean after real death/respawn.
// Main's UNKNOWN default keeps the one caster-owned Blood heal from both rolls.
for (const pvp of [false, true]) for (const name of ['smoke_burst', 'shadow_burst', 'blood_burst', 'ice_burst']) {
  const f = fixture({ pvp, label: `secondary-death-${name}-${pvp ? 'player' : 'npc'}` });
  try {
    const secondary = pvp
      ? addPlayer(f, { x: f.target.x + 1, z: f.target.z, label: 'dying-secondary' })
      : addNpc(f, { x: f.target.x + 1, z: f.target.z, label: 'dying-secondary', lifecycle: EntityLifeCycle.RESPAWN });
    if (pvp) secondary.levels[3] = 1;
    if (pvp) {
      secondary.getInventory(invId).removeAll();
      secondary.getInventory(wornId).removeAll();
    }
    const source = pvp
      ? addPlayer(f, { x: f.target.x + 4, z: f.target.z + 4, label: 'independent-damage-source' })
      : null;
    setMultiFor(f, [f.p, f.target, secondary, ...(source ? [source] : [])], true);
    const spell = areaSpells.find(entry => entry.name === name);
    const victims = pvp ? playerVictims(f) : npcVictims(f);
    assert.deepEqual(actorLabels(victims), actorLabels([f.target, secondary]), 'the dying actor is a secondary, not the primary');
    const models = victims.map(victim => victimModel(f, victim));
    const seed = Array.from({ length: 128 }, (_, value) => value).find(value => {
      const rolled = rollArea(value, spell, models);
      return rolled.results.every(entry => entry.accurate && entry.rolled > 0)
        && (spell.family !== 1 || rolled.results[1].poison)
        && (spell.family !== 3 || bloodHeal(rolled).amount > Math.ceil(rolled.results[0].rolled / 4));
    });
    assert.notEqual(seed, undefined, `${name} independent oracle supplies the death-flight witness`);
    const result = castArea(f, spell, seed, victims);
    const impactTick = World.currentTick + result.impactDelay + Number(pvp);
    const start = [secondary.x, secondary.z];
    assert.equal(queueHits(f, secondary).length, 1, `${name} secondary damage is pending`);
    if (spell.family !== 3) assert.equal(queueEffects(f, spell, secondary).length, 1, `${name} secondary effect is pending`);
    if (pvp) run({ p: source, target: secondary }, '[proc,.pvp_damage]', [0, 1]);
    else run({ p: f.p, target: secondary }, '[proc,npc_default_damage]', [secondary.baseLevels[3]]);
    let ticks = 0;
    while (secondary.levels[3] > 0 && ticks++ < 20) tickDeathFlight(f, pvp ? null : secondary);
    assert.equal(secondary.levels[3], 0, `${name} independent damage kills the secondary`);
    assert(World.currentTick < impactTick, `${name} secondary dies before Ancient impact`);
    if (pvp) {
      for (ticks = 0; (secondary.levels[3] === 0 || secondary.delayed || secondary.activeScript) && ticks < 20; ticks++) tickDeathFlight(f);
      assert.equal(secondary.levels[3], secondary.baseLevels[3], `${name} real player death restores Hitpoints`);
      assert.equal(secondary.delayed, false, `${name} real player death delay finishes`);
      assert.equal(secondary.activeScript, null, `${name} compiled player death finishes`);
      assert.notDeepEqual([secondary.x, secondary.z], start, `${name} real player death teleports to respawn`);
    } else {
      for (ticks = 0; secondary.isActive && ticks < 40; ticks++) tickDeathFlight(f, secondary);
      assert.equal(secondary.isActive, false, `${name} real NPC death removes the secondary`);
      for (ticks = 0; !secondary.isActive && ticks < 2000; ticks++) tickDeathFlight(f, secondary);
      assert.equal(secondary.isActive, true, `${name} native NPC lifecycle respawns the secondary`);
      assert.equal(secondary.levels[3], types.NpcType.get(secondary.type).stats[3], `${name} NPC respawn restores configured Hitpoints`);
    }
    while (World.currentTick < impactTick + 4) tickDeathFlight(f, pvp ? null : secondary);
    assert.equal(pvp ? variable(secondary, 'poison') : nv(secondary, 'npc_poison'), 0, `${name} no poison survives respawn`);
    assert.equal(secondary.levels[0], pvp ? secondary.baseLevels[0] : types.NpcType.get(secondary.type).stats[0], `${name} no Attack drain survives respawn`);
    assert.equal(pvp ? variable(secondary, 'frozen') : nv(secondary, 'npc_stunned'), 0, `${name} no freeze survives respawn`);
    assert.equal(queueHits(f, secondary).length, 0, `${name} no Ancient damage survives respawn`);
    assert.equal(queueEffects(f, spell, secondary).length, 0, `${name} no Ancient effect survives respawn`);
    if (spell.family === 3) {
      assert.equal(f.p.levels[3], result.before.casterHp + bloodHeal(result.expected).amount, 'the single aggregate Blood heal includes the dead secondary roll');
      assert.equal([...f.p.queue.all()].filter(q => q.script.name === '[queue,ancient_blood_heal]').length, 0, 'the aggregate Blood heal is consumed once');
    }
  } finally { dispose(f); }
}

// Single-target Blood keeps each published impact wrapper's queue admission order.
for (const spellName of ['blood_rush', 'blood_blitz']) for (const pvp of [false, true]) {
  const spell = singleTargetSpells.find(entry => entry.name === spellName);
  const f = fixture({ pvp, label: `single-${spellName}-${pvp ? 'player' : 'npc'}` });
  try {
    const expectedModel = victimModel(f, f.target);
    const expected = singleTargetOutcome({
      seed: 0,
      attack: expectedModel.attack,
      defence: expectedModel.defence,
      spell,
      cap: expectedModel.cap ?? spell.maximum,
      protectedMagic: expectedModel.protectedMagic ?? false,
      hp: expectedModel.hp,
      pvp
    });
    assert.equal(expected.accurate, true, `${spellName} fixed seed is accurate`);
    const events = [];
    const untrace = attachQueueTrace([...f.players, ...f.npcs], events);
    JavaRandom.setSeed(0);
    let state;
    try { state = run(f, componentTrigger(f, spell)); } finally { untrace(); }
    assertPointers(f, state);
    const hits = queueHits(f, f.target);
    const heals = [...f.p.queue.all()].filter(q => q.script.name === '[queue,ancient_blood_heal]');
    assert.equal(hits.length, 1, `${spellName} native damage queue`);
    assert.equal(heals.length, 1, `${spellName} one caster-owned Blood heal queue`);
    assert.equal(heals[0].args[0], expected.rolled, `${spellName} heal retains the published rolled-damage basis`);
    assert.equal(heals[0].delay, pvp ? hits[0].delay : hits[0].delay - 1, `${spellName} published NPC/PvP queue delay`);
    const damageEvent = events.findIndex(event => event.actor === f.target && (pvp ? event.scriptName === '[queue,pvp_damage]' : event.queueId === Trigger.AI_QUEUE2));
    const healEvent = events.findIndex(event => event.actor === f.p && event.scriptName === '[queue,ancient_blood_heal]');
    assert(damageEvent >= 0 && healEvent >= 0, `${spellName} damage and heal queue admissions are observed`);
    assert(pvp ? healEvent < damageEvent : damageEvent < healEvent,
      `${spellName} Blood admission remains inside ${pvp ? 'pvp' : 'pvm'}_spell_impact at its published place`);
    assert.equal(heals[0].delay, pvp ? hits[0].delay : hits[0].delay - 1);
    const impact = 1000 + hits[0].delay + Number(pvp);
    while (World.currentTick < impact + 2) tickAll(f);
    assert.equal(f.p.levels[3], Math.min(f.p.baseLevels[3], 50 + Math.ceil(expected.rolled / 4)), `${spellName} existing single-target Blood heal settles once`);
  } finally { dispose(f); }
}

function setDuel(f, noMagic = false) {
  variable(f.p, 'duel2accept', f.target.uid);
  variable(f.target, 'duel2accept', f.p.uid);
  variable(f.p, 'duelstatus', 6);
  variable(f.target, 'duelstatus', 6);
  variable(f.p, 'dueloptions', noMagic ? 1 << 6 : 0);
  variable(f.target, 'dueloptions', noMagic ? 1 << 6 : 0);
}

// Duel Arena is single-combat: an area Blood spell hits its lawful opponent, not a nearby third player.
{
  const f = fixture({ pvp: true, casterAt: [3338, 3250, 0], primaryAt: [3339, 3250, 0], label: 'duel-blood-allowed' });
  try {
    const third = addPlayer(f, { x: 3339, z: 3251, label: 'nearby-duel-third' });
    setDuel(f, false);
    const coord = CoordGrid.packCoord(0, f.p.x, f.p.z);
    assert.equal(run(f, '[proc,in_duel_arena]', [coord]).popInt(), 1, 'coordinate lies inside the compiled Duel Arena fight zone');
    assert.equal(isMulti(f.p), false, 'Duel Arena combat fixture is single-combat');
    const spell = areaSpells.find(entry => entry.name === 'blood_burst');
    const victims = playerVictims(f);
    assert.deepEqual(actorLabels(victims), actorLabels([f.target]), 'nearby third player is not an area victim in the duel zone');
    const result = castArea(f, spell, 0, victims);
    assert.equal(queueHits(f, f.target).length, Number(result.expected.results[0].accurate), 'lawful opponent receives the area spell hit');
    assert.equal(queueHits(f, third).length, 0, 'nearby third player receives no duel hit');
    settleArea(f, spell, result);
  } finally { dispose(f); }
}

// The published no-magic duel guard refuses before payment, XP, hit queue, or action delay.
{
  const f = fixture({ pvp: true, casterAt: [3338, 3250, 0], primaryAt: [3339, 3250, 0], label: 'duel-blood-no-magic' });
  try {
    setDuel(f, true);
    const spell = areaSpells.find(entry => entry.name === 'blood_burst');
    const before = { inventory: inventory(f.p), xp: xp(f.p), delay: variable(f.p, 'action_delay'), targetQueue: [...f.target.queue.all()] };
    run(f, componentTrigger(f, spell));
    assert.deepEqual(f.p.messages, ['Magic has been turned off for this duel.'], 'published exact no-magic duel refusal');
    assert.deepEqual(inventory(f.p), before.inventory, 'no-magic refusal spends no runes');
    assert.deepEqual(xp(f.p), before.xp, 'no-magic refusal awards no base XP');
    assert.equal(variable(f.p, 'action_delay'), before.delay, 'no-magic refusal sets no spell delay');
    assert.deepEqual([...f.target.queue.all()], before.targetQueue, 'no-magic refusal admits no damage or effect event');
    assert.equal(queueHits(f, f.target).length, 0, 'no-magic refusal admits no hit');
  } finally { dispose(f); }
}

console.log('PASS Ancient U2: eight Burst/Barrage rows and real NPC/PvP dispatches, area geometry/count, per-victim combat/effects, queue ordering, and duel guards');
process.exit(0); // World imports own maintenance timers; this offline process owns no live server.
