#!/usr/bin/env node
/** Exercise the Waterbirth NPC configs and real packed attack/death paths. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertLootTables } from './loot-oracle.mjs';

const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engineRoot = process.env.HARNESS_ENGINE_DIR ?? path.resolve(contentRoot, '../engine');
const packDir = process.env.HARNESS_PACK_DIR ?? path.join(engineRoot, 'data/pack');
const load = async relative => import(pathToFileURL(path.join(engineRoot, relative)).href);

function readConstant(relative, name) {
  const expression = new RegExp(`^\\s*\\^${name}\\s*=\\s*(-?\\d+)\\s*(?:\\/\\/.*)?$`, 'gm');
  const matches = [...readFileSync(path.join(contentRoot, relative), 'utf8').matchAll(expression)];
  assert.equal(matches.length, 1, `expected one ${name} constant in ${relative}`);
  return Number(matches[0][1]);
}
function readNameMap(kind) {
  const entries = new Map();
  for (const line of readFileSync(path.join(contentRoot, 'pack', `${kind}.pack`), 'utf8').split(/\r?\n/)) {
    const match = /^(\d+)=(.+)$/.exec(line);
    if (match) entries.set(match[2], Number(match[1]));
  }
  assert(entries.size > 0, `empty checked-out ${kind} name map`);
  return entries;
}

function readNpcBlocks(file) {
  const blocks = new Map();
  let current = null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const header = /^\[([A-Za-z0-9_]+)\]$/.exec(line);
    if (header) {
      assert(!blocks.has(header[1]), `duplicate NPC block ${header[1]} in ${file}`);
      current = new Map();
      blocks.set(header[1], current);
      continue;
    }
    if (!current || /^\s*(?:\/\/|$)/.test(line)) continue;
    const entry = /^([^=]+)=(.*)$/.exec(line);
    if (!entry) continue;
    const values = current.get(entry[1]) ?? [];
    values.push(entry[2]);
    current.set(entry[1], values);
  }
  return blocks;
}


const definitions = [
  { name: 'dungeon_dagganoth_mainroom', family: 'melee', hitpoints: 97, rangeDefence: 50 },
  { name: 'dungeon_dagganoth_mainroom_deeper', family: 'melee', hitpoints: 97, rangeDefence: 50 },
  { name: 'dungeon_dagganoth_lighter', family: 'ranged', hitpoints: 85, rangeDefence: 150 },
  { name: 'dungeon_dagganoth_lighter_deeper', family: 'ranged', hitpoints: 85, rangeDefence: 150 },
  { name: 'dungeon_dagganoth_magic_monster', family: 'magic', hitpoints: 130, rangeDefence: -10 },
  { name: 'dungeon_dagganoth_magic_monster_deeper', family: 'magic', hitpoints: 130, rangeDefence: 10, stats: { ATTACK: 10, STRENGTH: 10 } }
];

const families = {
  melee: {
    name: 'Dagannoth', hunt: 'aggressive_melee', mode: 'OPPLAYER2', maxHit: 15, attackrate: 4,
    attackAnimation: 'horror_dagannoth_attack', damageStyle: 'stab_style',
    stats: { ATTACK: 76, STRENGTH: 78, DEFENCE: 65, RANGED: 1, MAGIC: 1 },
    params: {
      attackbonus: 50, strengthbonus: 50, stabdefence: 50, slashdefence: 50, crushdefence: 50,
      magicdefence: 50, damagetype: 'stab_style', attackrate: 4,
      attack_anim: 'horror_dagannoth_attack', defend_anim: 'horror_dagannoth_defend',
      death_anim: 'horror_dagannoth_death'
    }
  },
  ranged: {
    name: 'Dagannoth', hunt: 'aggressive_ranged', mode: 'APPLAYER2', maxHit: 20, attackrate: 3,
    attackAnimation: 'horror_dagannoth_rangeattack', damageStyle: 'ranged_style',
    stats: { ATTACK: 10, STRENGTH: 10, DEFENCE: 75, RANGED: 100, MAGIC: 1 },
    params: {
      stabdefence: 10, slashdefence: 10, crushdefence: 90, magicdefence: 200,
      damagetype: 'ranged_style', attackrate: 3, attack_anim: 'horror_dagannoth_rangeattack',
      defend_anim: 'horror_dagannoth_defend', death_anim: 'horror_dagannoth_death',
      rangeattack_sound: 'dagganoth_spines', proj_travel: 'horror_spines_travel'
    }
  },
  magic: {
    name: 'Wallasalki', hunt: 'aggressive_ranged', mode: 'APPLAYER2', maxHit: 30, attackrate: 6,
    attackAnimation: 'wallasalki_attack', damageStyle: 'magic_style',
    stats: { ATTACK: 1, STRENGTH: 1, DEFENCE: 80, RANGED: 1, MAGIC: 100 },
    params: {
      stabdefence: 100, slashdefence: 150, crushdefence: 175, magicdefence: 250,
      damagetype: 'magic_style', attackrate: 6, magicattack_anim: 'wallasalki_attack',
      defend_anim: 'wallasalki_defend', death_anim: 'wallasalki_death'
    }
  }
};

async function run() {
  process.env.NODE_MEMBERS = 'true';
  const World = (await load('src/engine/World.ts')).default;
  const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
  const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
  const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
  const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
  const Player = (await load('src/engine/entity/Player.ts')).default;
  const Npc = (await load('src/engine/entity/Npc.ts')).default;
  const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
  const { NpcStat } = await load('src/engine/entity/NpcStat.ts');
  const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
  const { NpcModeMap } = await load('src/engine/entity/NpcMode.ts');
  const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
  const Environment = (await load('src/util/Environment.ts')).default;

  const configs = {};
  for (const name of [
    'VarPlayerType', 'VarBitType', 'VarNpcType', 'ParamType', 'ObjType', 'NpcType', 'InvType',
    'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType',
    'DbTableType', 'DbRowType', 'Component', 'FontType', 'HuntType'
  ]) {
    configs[name] = (await load(`src/cache/config/${name}.ts`)).default;
    configs[name].load(packDir);
  }
  (await load('src/cache/config/DbTableIndex.ts')).default.init();
  assert(ScriptProvider.load(packDir) > 0, 'build the sibling engine pack first');
  assert.equal(Environment.NODE_PRODUCTION, false, 'use the non-production slot error policy');
  assert.equal(Environment.NODE_XPRATE, 1, 'the oracle uses unmultiplied XP in tenths');
  const synthIds = readNameMap('synth');

  const id = (type, name) => {
    const value = type.getId(name);
    assert(value >= 0, `missing packed ${name}`);
    return value;
  };
  const modeId = name => {
    const value = NpcModeMap.get(name);
    assert.notEqual(value, undefined, `missing NPC mode ${name}`);
    return value;
  };
  const paramId = name => id(configs.ParamType, name);
  const param = (type, name) => type.params.get(paramId(name));
  const enumId = (type, name) => id(type, name);
  const checks = { definitions: 0, huntCases: 0, attacks: 0, drops: 0 };
  const same = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    checks.definitions++;
  };

  const unpack = readNpcBlocks(path.join(contentRoot, 'scripts/_unpack/377/all.npc'));
  const local = readNpcBlocks(path.join(contentRoot, 'scripts/areas/area_waterbirth/configs/waterbirth_monsters.npc'));
  for (const spec of definitions) {
    const moved = local.get(spec.name);
    assert(!unpack.has(spec.name), `${spec.name}: duplicate definition remains in unpack`);
    assert(moved, `missing local NPC block ${spec.name}`);

    const type = configs.NpcType.getByName(spec.name);
    assert(type, `missing packed NPC ${spec.name}`);
    const family = families[spec.family];
    same(type.name, family.name, `${spec.name}: display name`);
    same(type.stats[NpcStat.HITPOINTS], spec.hitpoints, `${spec.name}: HP`);
    for (const [stat, value] of Object.entries({ ...family.stats, ...spec.stats })) {
      same(type.stats[NpcStat[stat]], value, `${spec.name}: ${stat.toLowerCase()} level`);
    }
    const expectedParams = { ...family.params, rangedefence: spec.rangeDefence };
    for (const [name, value] of Object.entries(expectedParams)) {
      const expected = name === 'damagetype'
        ? readConstant('scripts/skill_combat/configs/combat_damagetypes.constant', value)
        : name.endsWith('_anim') || name === 'proj_travel'
          ? enumId(name === 'proj_travel' ? configs.SpotanimType : configs.SeqType, value)
          : name === 'rangeattack_sound'
            ? synthIds.get(value)
            : value;
      same(param(type, name), expected, `${spec.name}: param ${name}`);
    }
    const huntId = id(configs.HuntType, family.hunt);
    same(type.huntmode, huntId, `${spec.name}: hunt mode`);
    const hunt = configs.HuntType.get(huntId);
    same(hunt.checkNotTooStrong, 0, `${spec.name}: not-too-strong guard is off`);
    same(hunt.findNewMode, modeId(family.mode), `${spec.name}: hunt interaction mode`);
    same(type.vislevel, Number(spec.family === 'melee' ? 90 : spec.family === 'ranged' ? 88 : 98),
      `${spec.name}: visual level`);
  }

  // Every literal drop-table item must resolve in the checked-out 377 object names.
  const dropSource = readFileSync(path.join(contentRoot, 'scripts/areas/area_waterbirth/scripts/waterbirth_drops.rs2'), 'utf8');
  for (const line of dropSource.split(/\r?\n/)) {
    const direct = /^\s*return\(\s*([A-Za-z0-9_]+)\s*,/.exec(line);
    if (direct && direct[1] !== 'null') {
      assert(configs.ObjType.getId(direct[1]) >= 0, `unresolved 377 Waterbirth drop item ${direct[1]}`);
    }
    const add = /^\s*obj_add\(npc_coord,\s*([A-Za-z0-9_]+)\s*,/.exec(line);
    if (add) assert(configs.ObjType.getId(add[1]) >= 0, `unresolved 377 Waterbirth death object ${add[1]}`);
  }

  const exact = (trigger, name) => {
    const type = configs.NpcType.getByName(name);
    assert(type, `missing packed NPC ${name}`);
    return ScriptProvider.getByTriggerSpecific(trigger, type.id);
  };
  const generic = (trigger, type) => ScriptProvider.getByTriggerSpecific(trigger, -1, type.category);
  for (const spec of definitions) {
    const type = configs.NpcType.getByName(spec.name);
    const family = families[spec.family];
    const queue3 = exact(ServerTriggerType.AI_QUEUE3, spec.name);
    assert(queue3, `${spec.name}: exact death/drop trigger missing`);
    assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, type.id, type.category), queue3,
      `${spec.name}: exact death/drop trigger not selected`);
    if (spec.family === 'melee') {
      assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE1, type.id, type.category),
        generic(ServerTriggerType.AI_QUEUE1, type), `${spec.name}: melee retaliation must stay native`);
    } else {
      for (const trigger of [ServerTriggerType.AI_QUEUE1, ServerTriggerType.AI_OPPLAYER2, ServerTriggerType.AI_APPLAYER2]) {
        const script = exact(trigger, spec.name);
        assert(script, `${spec.name}: exact combat trigger missing`);
        assert.strictEqual(ScriptProvider.getByTrigger(trigger, type.id, type.category), script,
          `${spec.name}: exact combat trigger not selected`);
      }
    }
    assert.equal(family.maxHit, spec.family === 'melee' ? 15 : spec.family === 'ranged' ? 20 : 30);
  }

  let serial = 0;
  let objectCapture = null;
  const originalAddObj = World.addObj;
  const originalNextDouble = JavaRandom.nextDouble;
  World.currentTick = 1000;
  World.addObj = function (obj, receiver, duration) {
    if (objectCapture) objectCapture.push({ id: obj.type, count: obj.count, object: obj });
    return originalAddObj.call(this, obj, receiver, duration);
  };

  function addPlayer(x, z) {
    const slot = 1;
    const hash = BigInt(1000 + ++serial);
    const actor = new Player(`waterbirth${serial}`, hash, hash);
    actor.slot = slot;
    actor.pid = slot;
    actor.uid = ((Number(hash & 0x1fffffn) << 11) | slot) >>> 0;
    actor.isActive = true;
    actor.level = 0;
    actor.x = x;
    actor.z = z;
    actor.vars.fill(0);
    actor.baseLevels.fill(1);
    actor.levels.fill(1);
    actor.baseLevels[PlayerStat.HITPOINTS] = 100;
    actor.levels[PlayerStat.HITPOINTS] = 100;
    actor.getInventory(configs.InvType.getId('worn'));
    actor.getInventory(configs.InvType.getId('inventory'));
    actor.write = () => {};
    actor.messageGame = () => {};
    World.players[slot] = actor;
    World.playerLoop.add(hash, actor);
    World.gameMap.getZone(x, z, actor.level).enter(actor);
    assert.strictEqual(World.getPlayerByHash64(hash), actor, 'player not registered in the live player loop');
    return actor;
  }

  function addNpc(name, x, z, lifecycle = EntityLifeCycle.RESPAWN) {
    const type = configs.NpcType.getByName(name);
    const npc = new Npc(0, x, z, type.size, type.size, lifecycle, ++serial, type.id, type.blockwalk);
    World.addNpc(npc, -1);
    World.processNpcEventQueue();
    assert.strictEqual(World.npcs.get(npc.nid), npc, `${name} not registered by World.addNpc`);
    npc.lastMovement = -100;
    return npc;
  }

  function cleanupNpc(npc) {
    if (!npc) return;
    if (npc.isActive) World.removeNpc(npc, -1);
    if (World.npcs.get(npc.nid) === npc) {
      World.npcs.remove(npc.nid);
      npc.cleanup();
    }
  }

  function cleanupPlayer(actor) {
    if (!actor) return;
    World.gameMap.getZone(actor.x, actor.z, actor.level).leave(actor);
    if (World.players[actor.slot] === actor) World.players[actor.slot] = null;
    actor.unlink();
  }

  function withRandomValues(values, callback) {
    let index = 0;
    JavaRandom.nextDouble = function () {
      const value = values[index] ?? 127;
      index++;
      return value / 128;
    };
    try {
      return callback();
    } finally {
      JavaRandom.nextDouble = originalNextDouble;
    }
  }

  function testHunt(spec) {
    const family = families[spec.family];
    const x = 3200 + serial * 2;
    const actor = addPlayer(x + 1, 3200);
    const npc = addNpc(spec.name, x, 3200);
    try {
      const hunt = configs.HuntType.get(npc.huntMode);
      assert(hunt, `${spec.name}: native hunt config missing`);
      for (const [label, skill] of [['minimum', 1], ['maximum', 99]]) {
        actor.baseLevels.fill(skill);
        actor.levels.fill(skill);
        actor.baseLevels[PlayerStat.HITPOINTS] = skill;
        actor.levels[PlayerStat.HITPOINTS] = skill;
        actor.combatLevel = actor.getCombatLevel();
        assert.equal(actor.combatLevel, label === 'minimum' ? 1 : 126, `${spec.name}: ${label} account level`);
        npc.huntTarget = null;
        npc.huntClock = hunt.rate;
        npc.huntAll(hunt);
        assert.strictEqual(npc.huntTarget, actor, `${spec.name}: failed to hunt ${label} combat level`);
        checks.huntCases++;
      }
      assert.equal(hunt.checkNotTooStrong, 0, `${spec.name}: hunt excludes no combat levels`);
      assert.equal(hunt.findNewMode, modeId(family.mode), `${spec.name}: hunt mode target action`);
    } finally {
      cleanupNpc(npc);
      cleanupPlayer(actor);
    }
  }

  function observeMethod(target, name, capture) {
    const hadOwn = Object.prototype.hasOwnProperty.call(target, name);
    const original = target[name];
    target[name] = function (...args) {
      capture.push({ args, tick: World.currentTick });
      return original.apply(this, args);
    };
    return () => {
      if (hadOwn) target[name] = original;
      else delete target[name];
    };
  }

  function testAttack(spec, protectedStyle, armouredRanged = false) {
    const family = families[spec.family];
    const style = spec.family === 'melee' ? 'melee' : spec.family === 'ranged' ? 'ranged' : 'magic';
    const prayerName = style === 'melee' ? 'prayer14' : style === 'ranged' ? 'prayer13' : 'prayer12';
    const x = 3200 + serial * 2;
    let actor = null;
    let npc = null;
    const animations = [];
    const projectiles = [];
    let restoreAnimation = () => {};
    const originalMapProjAnim = World.mapProjAnim;
    try {
      actor = addPlayer(x + 1, 3200);
      actor.setVar(id(configs.VarPlayerType, 'com_defendanim'), id(configs.SeqType, 'human_unarmedblock'));
      if (spec.family === 'ranged') {
        // Fixture computed defence roll, not a selected period stat or bonus.
        actor.setVar(id(configs.VarPlayerType, 'com_rangedef'), armouredRanged ? 10_000 : 0);
      }
      if (protectedStyle) actor.setVar(id(configs.VarPlayerType, prayerName), 1);
      npc = addNpc(spec.name, x, 3200);
      restoreAnimation = observeMethod(npc, 'playAnimation', animations);
      npc.setVar(id(configs.VarNpcType, 'npc_aggressive_player'), actor.uid);
      npc.enqueueScript(ServerTriggerType.AI_QUEUE1);
      World.mapProjAnim = function (...args) {
        projectiles.push(args);
        return originalMapProjAnim.apply(this, args);
      };
      const expectedAnim = id(configs.SeqType, family.attackAnimation);
      const tape = Array.from({ length: 256 }, (_, index) =>
        spec.family === 'ranged' || index % 3 !== 1 ? 127 : 0);
      withRandomValues(tape, () => {
        npc.turn();
        assert.strictEqual(npc.target, actor, `${spec.name}: retaliation did not retain player`);
        assert.equal(npc.targetOp, modeId(family.mode), `${spec.name}: retaliation selected wrong interaction`);
        for (let tick = 0; !animations.some(entry => entry.args[0] === expectedAnim) && tick < 20; tick++) {
          World.currentTick++;
          npc.turn();
        }
      });
      const attack = animations.find(entry => entry.args[0] === expectedAnim);
      assert(attack, `${spec.name}: expected native attack animation`);
      assert.equal(npc.getVar(id(configs.VarNpcType, 'npc_action_delay')),
        attack.tick + family.attackrate, `${spec.name}: attack period`);
      if (style === 'melee') {
        assert.deepEqual(projectiles, [], `${spec.name}: melee attack created a projectile`);
      } else {
        assert.equal(projectiles.length, 1, `${spec.name}: projectile count`);
        const expectedSpotanim = style === 'ranged' ? 'horror_spines_travel' : 'waterwave_travel';
        assert.equal(projectiles[0][6], id(configs.SpotanimType, expectedSpotanim), `${spec.name}: projectile spotanim`);
      }
      const before = actor.levels[PlayerStat.HITPOINTS];
      let pendingDamage = actor.queue.all().some(request => request.script?.name === '[queue,combat_damage_player]');
      if (style !== 'magic' || !protectedStyle) {
        assert(pendingDamage, `${spec.name}: attack did not queue player damage`);
      }
      for (let tick = 0; pendingDamage && tick < 20; tick++) {
        actor.processQueues();
        pendingDamage = actor.queue.all().some(request => request.script?.name === '[queue,combat_damage_player]');
        if (pendingDamage) World.currentTick++;
      }
      actor.processQueues();
      assert(!actor.queue.all().some(request => request.script?.name === '[queue,combat_damage_player]'),
        `${spec.name}: damage queue did not finish`);
      assert.equal(before - actor.levels[PlayerStat.HITPOINTS], protectedStyle || armouredRanged ? 0 : family.maxHit,
        `${spec.name}: damage/protection/ranged-defence maximum`);
      checks.attacks++;
    } finally {
      World.mapProjAnim = originalMapProjAnim;
      restoreAnimation();
      cleanupNpc(npc);
      cleanupPlayer(actor);
    }
  }

  function testLootTables() {
    const actor = addPlayer(3200, 10140);
    const runLoot = (name, fractions, args = []) => {
      const script = ScriptProvider.getByName(`[proc,${name}]`);
      assert(script, `missing packed ${name}`);
      let draw = 0;
      JavaRandom.nextDouble = () => {
        assert(draw < fractions.length, `${name}: unexpected RNG draw`);
        return fractions[draw++];
      };
      try {
        const state = ScriptRunner.init(script, actor, null, args);
        actor.executeScript(state, true, true);
        assert.equal(state.execution, ScriptState.FINISHED, `${name}: loot procedure finishes`);
        return state.intStack.slice(0, state.isp);
      } finally { JavaRandom.nextDouble = originalNextDouble; }
    };
    try { checks.drops += assertLootTables(runLoot, name => id(configs.ObjType, name)); }
    finally { cleanupPlayer(actor); }
  }

  function testDrop(spec, roll, hero = true) {
    const x = 3200 + serial * 2;
    let actor = null;
    let npc = null;
    const records = [];
    try {
      actor = addPlayer(x + 1, 3200);
      npc = addNpc(spec.name, x, 3200);
      const type = configs.NpcType.getByName(spec.name);
      const heroVar = id(configs.VarNpcType, 'npc_aggressive_player');
      npc.setVar(heroVar, actor.uid);
      if (hero) npc.heroPoints.addHero(actor.hash64, npc.levels[NpcStat.HITPOINTS]);
      const task = readConstant('scripts/skill_slayer/configs/slayer.constant', 'slayer_dagannoth');
      actor.setVar(id(configs.VarPlayerType, 'slayer_target'), task);
      actor.setVar(id(configs.VarPlayerType, 'slayer_count'), 2);
      const slayerBefore = actor.stats[PlayerStat.SLAYER];
      const trigger = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, type.id, type.category);
      assert(trigger, `${spec.name}: death/drop trigger missing`);
      const state = ScriptRunner.init(trigger, npc);
      npc.applyDamage(npc.levels[NpcStat.HITPOINTS], 1);
      objectCapture = records;
      withRandomValues([127, roll, ...Array(64).fill(127)], () => {
        npc.executeScript(state);
        for (let tick = 0; state.execution === ScriptState.NPC_SUSPENDED && tick < 20; tick++) {
          actor.processQueues();
          World.currentTick = Math.max(World.currentTick + 1, npc.delayedUntil);
          npc.delayed = false;
          npc.executeScript(state);
        }
        actor.processQueues();
      });
      assert.equal(state.execution, ScriptState.FINISHED, `${spec.name}: death/drop trigger did not finish`);
      assert(!npc.isActive && npc.lifecycleTick > 0, `${spec.name}: death did not enter respawn state`);
      if (hero) {
        assert.equal(records.filter(record => record.id === configs.ObjType.getId('bones')).length, 1,
          `${spec.name}: bones drop count`);
      } else assert.deepEqual(records, [], `${spec.name}: no loot without a hero`);
      const eligible = spec.family !== 'magic';
      assert.equal(actor.getVar(id(configs.VarPlayerType, 'slayer_count')), eligible ? 1 : 2,
        `${spec.name}: native Slayer task credit`);
      assert.equal(actor.stats[PlayerStat.SLAYER] - slayerBefore, eligible ? spec.hitpoints * 10 : 0,
        `${spec.name}: native Slayer XP uses selected HP`);
      for (const record of records) {
        assert(record.id >= 0, `${spec.name}: invalid drop id`);
        assert(configs.ObjType.get(record.id), `${spec.name}: unresolved drop object ${record.id}`);
      }
      checks.drops++;
      const respawnTicks = npc.lifecycleTick;
      const expectedRespawn = spec.family === 'magic' ? 25 : 30;
      assert.equal(type.respawnrate, expectedRespawn, `${spec.name}: candidate Old School respawn config`);
      assert.equal(respawnTicks, World.scaleByPlayerCount(type.respawnrate),
        `${spec.name}: native population-scaled respawn schedule`);
      for (let tick = 1; tick < respawnTicks; tick++) {
        World.currentTick++;
        npc.turn();
        assert.equal(npc.isActive, false, `${spec.name}: no early respawn at tick ${tick}`);
      }
      World.currentTick++;
      npc.turn();
      World.processNpcEventQueue();
      assert.equal(npc.isActive, true, `${spec.name}: native respawn`);
      assert.equal(npc.levels[NpcStat.HITPOINTS], spec.hitpoints, `${spec.name}: respawn restores selected HP`);
      assert.deepEqual([...npc.queue.all()], [], `${spec.name}: no old queued attacks after respawn`);
      assert.equal(npc.getVar(heroVar), -1, `${spec.name}: respawn clears last attacker`);
    } finally {
      objectCapture = null;
      for (const record of records) if (record.object.isActive) World.removeObj(record.object, -1);
      cleanupNpc(npc);
      cleanupPlayer(actor);
    }
  }

  try {
    testLootTables();
    for (const spec of definitions) testHunt(spec);
    for (const spec of definitions) {
      testAttack(spec, false);
      testAttack(spec, true);
      if (spec.family === 'ranged') testAttack(spec, false, true);
    }
    for (const spec of definitions) {
      testDrop(spec, 0);
      testDrop(spec, 127);
      testDrop(spec, 0, false);
    }
    console.log(`RESULT PASS waterbirth-monsters ${JSON.stringify(checks)}`);
  } finally {
    World.addObj = originalAddObj;
    JavaRandom.nextDouble = originalNextDouble;
  }
}

run().then(() => process.exit(0)).catch(error => {
  console.error(error);
  process.exit(1);
});
