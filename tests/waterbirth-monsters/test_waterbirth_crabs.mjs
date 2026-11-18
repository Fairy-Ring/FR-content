#!/usr/bin/env node
/** Exercise natural Waterbirth crab forms through packed hunt, combat, drops and respawn paths. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engineRoot = path.resolve(contentRoot, process.env.HARNESS_ENGINE_DIR ?? '../engine');
const packDir = path.resolve(engineRoot, process.env.HARNESS_PACK_DIR ?? 'data/pack');
const load = relative => import(pathToFileURL(path.join(engineRoot, relative)).href);

function readConstant(relative, name) {
  const expression = new RegExp(`^\\s*\\^${name}\\s*=\\s*(-?\\d+)\\s*(?:\\/\\/.*)?$`, 'gm');
  const matches = [...readFileSync(path.join(contentRoot, relative), 'utf8').matchAll(expression)];
  assert.equal(matches.length, 1, `expected one ${name} constant in ${relative}`);
  return Number(matches[0][1]);
}

function readNpcBlocks(file, strict = false) {
  const blocks = new Map();
  let current = null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const header = /^\[([A-Za-z0-9_]+)\]$/.exec(line.trim());
    if (header) {
      assert(!blocks.has(header[1]), `duplicate NPC block ${header[1]} in ${file}`);
      current = { fields: new Map(), params: [] };
      blocks.set(header[1], current);
      continue;
    }
    if (!current || /^\s*(?:\/\/|$)/.test(line)) continue;
    const equals = line.indexOf('=');
    if (equals < 0) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    if (key === 'param') current.params.push(value);
    else {
      assert(!strict || !current.fields.has(key), `${file}: duplicate field ${key}`);
      current.fields.set(key, value);
    }
  }
  return blocks;
}

const originalNpcFields = {
  horror_rockcrab: {
    fields: {
      name: 'Rock Crab', desc: 'No one likes crabs...', model1: 'npc_1265', model2: 'npc_1265i2',
      walkanim: 'horror_crab_walk', readyanim: 'horror_crab_ready', minimap: 'no', op2: 'Attack',
      vislevel: '13', wanderrange: '7', hitpoints: '50', respawnrate: '100', maxrange: '9'
    },
    params: [
      'death_drop,null', 'damagetype,^crush_style', 'attack_anim,horror_crab_attack',
      'defend_anim,horror_crab_defend', 'death_anim,horror_crab_hide', 'attack_sound,insect_attack',
      'defend_sound,insect_hit', 'death_sound,insect_death'
    ]
  },
  horror_rockcrab_inactive: {
    fields: {
      name: 'Rocks', desc: 'A rocky outcrop.', model1: 'npc_1265', model2: 'npc_1265i2',
      vislevel: 'hide', walkanim: 'horror_crab_walk', readyanim: 'horror_crab_hide_ready', minimap: 'no',
      wanderrange: '0', hitpoints: '50', huntrange: '1', respawnrate: '100', huntmode: 'aggressive_ranged',
      maxrange: '9', attackrange: '1', moverestrict: 'nomove', defaultmode: 'none'
    },
    params: [
      'death_drop,null', 'attack_anim,horror_crab_attack', 'defend_anim,horror_crab_defend',
      'death_anim,horror_crab_hide', 'attack_sound,insect_attack', 'defend_sound,insect_hit',
      'death_sound,insect_death'
    ]
  },
  horror_rockcrab_small: {
    fields: {
      name: 'Rock Crab', desc: 'No one likes crabs...', model1: 'npc_1265', model2: 'npc_1265i2',
      walkanim: 'horror_crab_walk', readyanim: 'horror_crab_ready', resizeh: '84', resizev: '84',
      minimap: 'no', op2: 'Attack', vislevel: '13', wanderrange: '7', hitpoints: '50', respawnrate: '100',
      maxrange: '9'
    },
    params: [
      'death_drop,null', 'damagetype,^crush_style', 'attack_anim,horror_crab_attack',
      'defend_anim,horror_crab_defend', 'death_anim,horror_crab_hide', 'attack_sound,insect_attack',
      'defend_sound,insect_hit', 'death_sound,insect_death'
    ]
  },
  horror_rockcrab_small_inactive: {
    fields: {
      name: 'Rocks', desc: 'A rocky outcrop.', model1: 'npc_1265', model2: 'npc_1265i2',
      vislevel: 'hide', walkanim: 'horror_crab_walk', readyanim: 'horror_crab_hide_ready', resizeh: '84',
      resizev: '84', minimap: 'no', wanderrange: '0', hitpoints: '50', huntrange: '1', respawnrate: '100',
      huntmode: 'aggressive_ranged', maxrange: '9', attackrange: '1', moverestrict: 'nomove', defaultmode: 'none'
    },
    params: [
      'death_drop,null', 'attack_anim,horror_crab_attack', 'defend_anim,horror_crab_defend',
      'death_anim,horror_crab_hide', 'attack_sound,insect_attack', 'defend_sound,insect_hit',
      'death_sound,insect_death'
    ]
  },
  giant_rockcrab: {
    fields: {
      name: 'Giant Rock Crab', desc: 'No one likes crabs... especially really big ones!',
      model1: 'npc_2452', model2: 'npc_2452i2', size: '2', resizeh: '250', resizev: '250',
      walkanim: 'horror_crab_walk', readyanim: 'horror_crab_ready', op2: 'Attack', vislevel: '137',
      hitpoints: '180', attack: '50', strength: '80', defence: '200'
    }
  },
  giant_rockcrab_hidden: {
    fields: {
      name: 'Boulder', desc: 'Heavy rock!', model1: 'npc_2453', vislevel: 'hide', size: '2',
      resizeh: '250', resizev: '250', turnspeed: '0', wanderrange: '0', moverestrict: 'nomove', defaultmode: 'none'
    }
  },
  giant_rockcrab_deeper: {
    fields: {
      name: 'Giant Rock Crab', desc: 'No one likes crabs... especially really big ones!',
      model1: 'npc_2452', model2: 'npc_2452i2', size: '2', resizeh: '250', resizev: '250',
      walkanim: 'horror_crab_walk', readyanim: 'horror_crab_ready', op2: 'Attack', vislevel: '137',
      hitpoints: '180', attack: '50', strength: '80', defence: '200'
    }
  },
  giant_rockcrab_hidden_deeper: {
    fields: {
      name: 'Boulder', desc: 'Heavy rock!', model1: 'npc_2453', vislevel: 'hide', size: '2',
      resizeh: '250', resizev: '250', turnspeed: '0', wanderrange: '0', moverestrict: 'nomove', defaultmode: 'none'
    }
  }
};

const primaryTable = [
  [5, 'steel_platebody', 1], [5, 'black_claws', 1], [5, 'black_platebody', 1], [10, 'mithril_axe', 1],
  [2, 'dagganoth_melee_gloves', 1], [2, 'dagganoth_melee_feet', 1], [5, 'black_warhammer', 1],
  [5, 'adamant_longsword', 1], [10, 'waterrune', 1, 40], [10, 'earthrune', 1, 40], [8, 'herb'],
  [1, 'seed'], [10, 'talisman'], [10, 'coins', 1, 140], [10, 'raw_lobster', 1], [10, 'raw_bass', 1],
  [10, 'tinderbox', 1], [2, 'casket', 1], [2, 'dagganoth_melee_leg_part', 1],
  [2, 'dagganoth_melee_head_part', 1], [2, 'dagganoth_melee_body_part', 1], [1, 'gem'], [1, 'empty']
];

async function run() {
  process.env.NODE_MEMBERS = 'true';
  process.chdir(engineRoot);

  const World = (await load('src/engine/World.ts')).default;
  const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
  const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
  const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
  const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
  const Player = (await load('src/engine/entity/Player.ts')).default;
  const { NpcStat } = await load('src/engine/entity/NpcStat.ts');
  const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
  const { NpcModeMap } = await load('src/engine/entity/NpcMode.ts');
  const { isLineOfSight, isLineOfWalk } = await load('src/engine/GameMap.ts');
  const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
  const Environment = (await load('src/util/Environment.ts')).default;
  const { ParamHelper } = await load('src/cache/config/ParamHelper.ts');

  const configs = {};
  for (const name of [
    'VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType',
    'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType',
    'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType'
  ]) {
    configs[name] = (await load(`src/cache/config/${name}.ts`)).default;
    configs[name].load(packDir);
  }
  (await load('src/cache/config/DbTableIndex.ts')).default.init();
  assert(ScriptProvider.load(packDir) > 0, 'build the sibling engine pack first');
  assert.equal(Environment.NODE_MEMBERS, true, 'Waterbirth map NPCs require the members world');

  const id = (type, name) => {
    const value = type.getId(name);
    assert(value >= 0, `missing packed ${name}`);
    return value;
  };
  const param = (type, name) => {
    const paramType = configs.ParamType.getByName(name);
    assert(paramType, `missing parameter ${name}`);
    assert(type.params.has(paramType.id), `${type.name}: missing parameter ${name}`);
    return ParamHelper.getIntParam(paramType.id, type, paramType.defaultInt);
  };
  const mode = name => {
    const value = NpcModeMap.get(name);
    assert.notEqual(value, undefined, `missing NPC mode ${name}`);
    return value;
  };
  const checks = { definitions: 0, naturalWakes: 0, lootOutcomes: 0, attacks: 0, retreatCases: 0, deaths: 0 };

  const configPath = path.join(contentRoot, 'scripts/areas/area_waterbirth/configs/waterbirth_crabs.npc');
  const unpackPath = path.join(contentRoot, 'scripts/_unpack/377/all.npc');
  const local = readNpcBlocks(configPath, true);
  const unpack = readNpcBlocks(unpackPath);
  assert.equal(local.size, 8, 'the crab config owns exactly eight cache forms');
  for (const [name, expected] of Object.entries(originalNpcFields)) {
    assert(!unpack.has(name), `${name}: duplicate definition remains in unpack`);
    const moved = local.get(name);
    assert(moved, `missing moved NPC block ${name}`);
    for (const [field, value] of Object.entries(expected.fields)) {
      assert.equal(moved.fields.get(field), value, `${name}: original 377 field ${field}`);
    }
    if (expected.params) assert.deepEqual(moved.params, expected.params, `${name}: original 377 params`);
    checks.definitions++;
  }

  const regular = configs.NpcType.getByName('horror_rockcrab');
  const regularHidden = configs.NpcType.getByName('horror_rockcrab_inactive');
  const small = configs.NpcType.getByName('horror_rockcrab_small');
  const smallHidden = configs.NpcType.getByName('horror_rockcrab_small_inactive');
  const giant = configs.NpcType.getByName('giant_rockcrab');
  const giantHidden = configs.NpcType.getByName('giant_rockcrab_hidden');
  const giantDeeper = configs.NpcType.getByName('giant_rockcrab_deeper');
  const giantHiddenDeeper = configs.NpcType.getByName('giant_rockcrab_hidden_deeper');
  assert(regular && regularHidden && small && smallHidden && giant && giantHidden && giantDeeper && giantHiddenDeeper,
    'all eight crab cache forms must compile');

  for (const [type, models, size] of [
    [regular, 2, 1], [regularHidden, 2, 1], [small, 2, 1], [smallHidden, 2, 1],
    [giant, 2, 2], [giantHidden, 1, 2], [giantDeeper, 2, 2], [giantHiddenDeeper, 1, 2]
  ]) {
    assert.equal(type.models?.length, models, `${type.name}: cache model count`);
    assert.equal(type.size, size, `${type.name}: collision footprint`);
  }
  assert.equal(small.resizeh, 84);
  assert.equal(small.resizev, 84);
  assert.equal(smallHidden.resizeh, 84);
  assert.equal(smallHidden.resizev, 84);
  for (const type of [regular, regularHidden, small, smallHidden]) {
    assert.equal(type.stats[NpcStat.HITPOINTS], 50, `${type.name}: CANDIDATE inherited server HP`);
  }

  const crabConstants = 'scripts/areas/area_waterbirth/configs/waterbirth_crabs.constant';
  const huntRange = readConstant(crabConstants, 'wbcrab_giant_hunt_radius');
  const attackRange = readConstant(crabConstants, 'wbcrab_giant_attack_range');
  const awakeTicks = readConstant(crabConstants, 'wbcrab_giant_awake_ticks');
  const retreatHP = readConstant(crabConstants, 'wbmon_giant_retreat_hp');
  const respawnTicks = readConstant(crabConstants, 'wbcrab_giant_respawn_ticks');
  const attackTicks = readConstant(crabConstants, 'wbcrab_giant_attack_ticks');
  const maxHit = readConstant(crabConstants, 'wbcrab_giant_max_hit');
  const primaryRolls = readConstant(crabConstants, 'wbcrab_giant_primary_rolls');
  const clueRarity = readConstant(crabConstants, 'wbcrab_giant_clue_rarity');
  assert.equal(huntRange, 2, 'UNKNOWN 2x2 southwest-origin hunt radius');
  assert.equal(attackRange, 1, 'CANDIDATE adjacent melee range');
  assert.equal(awakeTicks, 1000, 'UNKNOWN giant hidden-state duration');
  assert.equal(retreatHP, 36, 'UNKNOWN one-fifth-HP Lost City Ghoul precedent, not crab-authentic');
  assert.equal(respawnTicks, 50, 'CANDIDATE exact-variant respawn');
  assert.equal(attackTicks, 4, 'CANDIDATE exact-variant attack cycle');
  assert.equal(maxHit, 9, 'CANDIDATE exact-variant max hit');
  assert.equal(primaryRolls, 128, 'CANDIDATE exact-variant main table');
  assert.equal(clueRarity, 128, 'CANDIDATE exact-variant medium clue chance');

  const crushStyle = readConstant('scripts/skill_combat/configs/combat_damagetypes.constant', 'crush_style');
  const attackAnimation = id(configs.SeqType, 'horror_crab_attack');
  for (const [type, magicDefence] of [[giant, -10], [giantDeeper, 10]]) {
    assert.equal(type.stats[NpcStat.HITPOINTS], 180, `${type.name}: CANDIDATE server HP`);
    assert.equal(type.stats[NpcStat.ATTACK], 50, `${type.name}: CANDIDATE server attack`);
    assert.equal(type.stats[NpcStat.STRENGTH], 80, `${type.name}: CANDIDATE server strength`);
    assert.equal(type.stats[NpcStat.DEFENCE], 200, `${type.name}: CANDIDATE server defence`);
    assert.equal(type.stats[NpcStat.MAGIC], 1, `${type.name}: CANDIDATE magic level`);
    assert.equal(type.stats[NpcStat.RANGED], 1, `${type.name}: CANDIDATE ranged level`);
    assert.equal(type.vislevel, 137);
    assert.equal(type.respawnrate, respawnTicks);
    assert.equal(type.huntrange, huntRange);
    assert.equal(type.attackrange, attackRange);
    for (const [name, value] of Object.entries({
      attackbonus: 0, strengthbonus: 0, stabdefence: 225, slashdefence: 200, crushdefence: 175,
      magicdefence: magicDefence, rangedefence: 250, damagetype: crushStyle,
      attackrate: attackTicks, attack_anim: attackAnimation,
      retreat: retreatHP,
    })) {
      assert.equal(param(type, name), value, `${type.name}: candidate ${name}`);
    }
  }
  for (const [hidden, active, modeName] of [
    [regularHidden, regular, 'APPLAYER2'], [smallHidden, small, 'APPLAYER2'],
    [giantHidden, giant, 'APPLAYER2'], [giantHiddenDeeper, giantDeeper, 'APPLAYER2']
  ]) {
    const hunt = configs.HuntType.get(hidden.huntmode);
    assert(hunt, `${hidden.name}: cache hunt profile must compile`);
    assert.equal(hidden.huntrange, hidden === giantHidden || hidden === giantHiddenDeeper ? huntRange : 1);
    assert.equal(hunt.type, 1, `${hidden.name}: hunts players`);
    assert.equal(hunt.checkVis, 1, `${hidden.name}: keeps native line of sight`);
    assert.equal(hunt.checkNotTooStrong, 0, `${hidden.name}: excludes no combat levels`);
    assert.equal(hunt.findKeepHunting, false, `${hidden.name}: dispatches once per hidden state`);
    assert.equal(hunt.findNewMode, mode(modeName), `${hidden.name}: hidden approach action`);
    assert.equal(active.size, hidden.size, `${hidden.name}: morph preserves collision size`);
  }
  for (const [active, huntName] of [[giant, 'aggressive_melee'], [giantDeeper, 'aggressive_melee']]) {
    const hunt = configs.HuntType.getByName(huntName);
    assert(hunt, `${huntName}: native active hunt profile must compile`);
    assert.equal(active.huntmode, hunt.id);
    assert.equal(hunt.findNewMode, mode('OPPLAYER2'));
  }

  const crabScriptPath = path.join(contentRoot, 'scripts/areas/area_waterbirth/scripts/waterbirth_crabs.rs2');
  const crabScript = readFileSync(crabScriptPath, 'utf8');
  assert(!/\[(?:ai_applayer2|ai_queue1),horror_rockcrab(?:_small)?_inactive\]/.test(crabScript),
    'ordinary hidden APPLAYER2/QUEUE1 remain owned by the existing quest_viking script');
  assert(crabScript.includes('trail_mediumcluedrop(^wbcrab_giant_clue_rarity, npc_coord)'),
    'giant death preserves the medium clue reward');
  assert(!/potato_cactus_seed|snape_grass_seed|tonali/i.test(crabScript), 'exclude post-377 seeds and Tonali content');

  const exact = (trigger, type) => ScriptProvider.getByTriggerSpecific(trigger, type.id);
  const generic = (trigger, type) => ScriptProvider.getByTriggerSpecific(trigger, -1, type.category);
  for (const [hidden, active] of [[regularHidden, regular], [smallHidden, small]]) {
    const wake = exact(ServerTriggerType.AI_APPLAYER2, hidden);
    const retaliation = exact(ServerTriggerType.AI_QUEUE1, hidden);
    const death = exact(ServerTriggerType.AI_QUEUE3, active);
    assert(wake, `${hidden.name}: existing quest_viking wake handler`);
    assert(retaliation, `${hidden.name}: existing quest_viking retaliation handler`);
    assert(death, `${active.name}: existing quest_viking drop handler`);
    assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_APPLAYER2, hidden.id, hidden.category), wake);
    assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE1, hidden.id, hidden.category), retaliation);
    assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, active.id, active.category), death);
  }
  for (const [hidden, active] of [[giantHidden, giant], [giantHiddenDeeper, giantDeeper]]) {
    const wake = exact(ServerTriggerType.AI_APPLAYER2, hidden);
    const death = exact(ServerTriggerType.AI_QUEUE3, active);
    assert(wake, `${hidden.name}: compiled exact giant wake handler`);
    assert(death, `${active.name}: compiled exact giant death handler`);
    assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_APPLAYER2, hidden.id, hidden.category), wake);
    assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, active.id, active.category), death);
    assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_OPPLAYER2, active.id, active.category),
      generic(ServerTriggerType.AI_OPPLAYER2, active), `${active.name}: visible melee dispatch remains generic`);
    assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE1, active.id, active.category),
      generic(ServerTriggerType.AI_QUEUE1, active), `${active.name}: native retaliation remains generic`);
  }

  const itemNames = new Set();
  for (const row of primaryTable) {
    if (!['herb', 'seed', 'talisman', 'gem', 'empty'].includes(row[1])) itemNames.add(row[1]);
  }
  for (const name of [
    'bones', 'unidentified_guam', 'unidentified_dwarf_weed', 'toadflax_seed', 'torstol_seed',
    'air_talisman', 'nature_talisman', 'trail_clue_medium_map001'
  ]) itemNames.add(name);
  for (const name of itemNames) id(configs.ObjType, name);
  const dropSource = crabScript;
  for (const line of dropSource.split(/\r?\n/)) {
    const direct = /^\s*(?:else\s+)?if\s*\([^)]*\)\s*return\(\s*([A-Za-z0-9_]+)\s*,/.exec(line)
      ?? /^\s*return\(\s*([A-Za-z0-9_]+)\s*,/.exec(line);
    if (direct && direct[1] !== 'null') id(configs.ObjType, direct[1]);
    const add = /^\s*obj_add\(npc_coord,\s*([A-Za-z0-9_]+)\s*,/.exec(line);
    if (add) id(configs.ObjType, add[1]);
  }

  const originalNextDouble = JavaRandom.nextDouble;
  const originalAddObj = World.addObj;
  let serial = 0;
  let objectCapture = null;
  World.currentTick = 1000;
  World.addObj = function (obj, receiver, duration) {
    if (objectCapture) objectCapture.push({ id: obj.type, count: obj.count, object: obj, receiver, duration });
    return originalAddObj.call(this, obj, receiver, duration);
  };

  function addPlayer(coord) {
    const slot = 1;
    const hash = BigInt(1000 + ++serial);
    const actor = new Player(`waterbirthCrab${serial}`, hash, hash);
    actor.slot = slot;
    actor.pid = slot;
    actor.uid = ((Number(hash & 0x1fffffn) << 11) | slot) >>> 0;
    actor.isActive = true;
    actor.level = coord.level;
    actor.x = coord.x;
    actor.z = coord.z;
    actor.vars.fill(0);
    actor.baseLevels.fill(1);
    actor.levels.fill(1);
    actor.baseLevels[PlayerStat.HITPOINTS] = 100;
    actor.levels[PlayerStat.HITPOINTS] = 100;
    actor.getInventory(id(configs.InvType, 'worn'));
    actor.getInventory(id(configs.InvType, 'inv'));
    actor.write = () => {};
    actor.messageGame = () => {};
    World.players[slot] = actor;
    World.playerLoop.add(hash, actor);
    World.gameMap.getZone(actor.x, actor.z, actor.level).enter(actor);
    assert.strictEqual(World.getPlayerByHash64(hash), actor, 'player must be visible to native hunt iteration');
    return actor;
  }

  function movePlayer(actor, coord) {
    World.gameMap.getZone(actor.x, actor.z, actor.level).leave(actor);
    actor.level = coord.level;
    actor.x = coord.x;
    actor.z = coord.z;
    World.gameMap.getZone(actor.x, actor.z, actor.level).enter(actor);
  }

  function cleanupPlayer(actor) {
    if (!actor) return;
    World.gameMap.getZone(actor.x, actor.z, actor.level).leave(actor);
    if (World.players[actor.slot] === actor) World.players[actor.slot] = null;
    actor.unlink();
  }

  function cleanupNpc(npc) {
    if (!npc) return;
    if (npc.isActive) World.removeNpc(npc, -1);
    if (World.npcs.get(npc.nid) === npc) {
      World.npcs.remove(npc.nid);
      npc.cleanup();
    }
  }

  function cleanupDrops(records) {
    for (const record of records) if (record.object.isActive) World.removeObj(record.object, -1);
  }

  function findContactSite(npc, radius) {
    const width = Math.max(npc.width ?? npc.size ?? 1, 1);
    const length = Math.max(npc.length ?? npc.size ?? 1, 1);
    const directions = [
      { inside: { x: npc.x + width, z: npc.z }, outside: { x: npc.x + radius + 1, z: npc.z } },
      { inside: { x: npc.x - 1, z: npc.z }, outside: { x: npc.x - radius - 1, z: npc.z } },
      { inside: { x: npc.x, z: npc.z + length }, outside: { x: npc.x, z: npc.z + radius + 1 } },
      { inside: { x: npc.x, z: npc.z - 1 }, outside: { x: npc.x, z: npc.z - radius - 1 } }
    ];
    for (const direction of directions) {
      const inside = { level: npc.level, ...direction.inside };
      const outside = { level: npc.level, ...direction.outside };
      if (
        isLineOfWalk(npc.level, npc.x, npc.z, inside.x, inside.z) &&
        isLineOfSight(npc.level, npc.x, npc.z, inside.x, inside.z) &&
        isLineOfWalk(npc.level, npc.x, npc.z, outside.x, outside.z) &&
        isLineOfSight(npc.level, npc.x, npc.z, outside.x, outside.z)
      ) return { inside, outside };
    }
    return null;
  }

  function findNatural(hiddenName, predicate, radius) {
    const type = configs.NpcType.getByName(hiddenName);
    assert(type, `missing hidden type ${hiddenName}`);
    const candidates = [...World.npcs].filter(npc => npc.isActive && npc.type === type.id && predicate(npc));
    for (const npc of candidates) {
      const site = findContactSite(npc, radius);
      if (site) return { npc, site };
    }
    assert.fail(`${hiddenName}: packed Waterbirth map needs a natural hidden NPC with clear adjacent/outside walk and sight tiles`);
  }

  function advanceNpc(npc, actor, processActor = true) {
    World.currentTick++;
    if (npc.isActive && npc.huntMode !== -1) {
      const hunt = configs.HuntType.get(npc.huntMode);
      assert(hunt, `${npc.name}: missing live hunt profile ${npc.huntMode}`);
      npc.huntAll(hunt);
    }
    npc.turn();
    World.processNpcEventQueue();
    if (processActor) actor.processQueues();
  }

  function withRandomValues(values, callback) {
    const original = JavaRandom.nextDouble;
    let index = 0;
    JavaRandom.nextDouble = () => (values[index++] ?? 127) / 128;
    try {
      return callback();
    } finally {
      JavaRandom.nextDouble = original;
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

  function runLoot(name, fractions, actor) {
    const script = ScriptProvider.getByName(`[proc,${name}]`);
    assert(script, `missing packed [proc,${name}]`);
    let draw = 0;
    JavaRandom.nextDouble = () => {
      assert(draw < fractions.length, `${name}: unexpected RNG draw ${draw + 1}`);
      return fractions[draw++];
    };
    try {
      const state = ScriptRunner.init(script, actor);
      actor.executeScript(state, true, true);
      assert.equal(state.execution, ScriptState.FINISHED, `${name}: procedure finishes`);
      return { pair: state.intStack.slice(0, state.isp), draws: draw };
    } finally {
      JavaRandom.nextDouble = originalNextDouble;
    }
  }

  function testLootTable(actor) {
    const slots = primaryTable.flatMap(([weight, ...outcome]) => Array.from({ length: weight }, () => outcome));
    assert.equal(slots.length, primaryRolls, 'Giant Rock Crab main table has 128 outcomes');
    const objectId = name => id(configs.ObjType, name);
    const expected = (outcome, upper) => {
      const [kind, low, high] = outcome;
      if (kind === 'herb') return [objectId(upper ? 'unidentified_dwarf_weed' : 'unidentified_guam'), 1];
      if (kind === 'seed') return [objectId(upper ? 'torstol_seed' : 'toadflax_seed'), 1];
      if (kind === 'talisman') return [objectId(upper ? 'nature_talisman' : 'air_talisman'), 1];
      if (kind === 'gem') return [objectId('nature_talisman'), 1];
      if (kind === 'empty') return [-1, 0];
      return [objectId(kind), upper ? high ?? low : low];
    };
    const nested = outcome => ['herb', 'seed', 'talisman', 'gem'].includes(outcome[0]) || outcome[2] !== undefined;
    for (let roll = 0; roll < slots.length; roll++) {
      for (const upper of [false, true]) {
        const outcome = slots[roll];
        const fractions = [(roll + 0.5) / primaryRolls];
        if (nested(outcome)) {
          fractions.push(outcome[0] === 'gem' ? 62.5 / 128 : upper ? 0.999999 : 0);
        }
        const result = runLoot('wbcrab_giant_loot', fractions, actor);
        assert.deepEqual(result.pair, expected(outcome, upper), `primary roll ${roll}, upper=${upper}`);
        assert.equal(result.draws, fractions.length, `primary roll ${roll}: exact RNG consumption`);
        checks.lootOutcomes++;
      }
    }
    for (const [name, lower, upper] of [
      ['wbmon_rare_seed', 'toadflax_seed', 'torstol_seed'],
      ['wbmon_talisman', 'air_talisman', 'nature_talisman']
    ]) {
      assert.deepEqual(runLoot(name, [0], actor).pair, [objectId(lower), 1], `${name}: first nested outcome`);
      assert.deepEqual(runLoot(name, [0.999999], actor).pair, [objectId(upper), 1], `${name}: last nested outcome`);
    }
  }

  function testWake(hiddenName, activeName, predicate, radius, giantCombat = false) {
    const hidden = configs.NpcType.getByName(hiddenName);
    const active = configs.NpcType.getByName(activeName);
    const { npc, site } = findNatural(hiddenName, predicate, radius);
    let actor = null;
    const animations = [];
    let restoreAnimation = () => {};
    let originalEnqueue = null;
    let hadOwnEnqueue = false;
    let records = [];
    try {
      assert.equal(npc.type, hidden.id, `${hiddenName}: starts as natural hidden map form`);
      assert.equal(npc.width, hidden.size, `${hiddenName}: original cache collision width`);
      actor = addPlayer(site.outside);
      actor.setVar(id(configs.VarPlayerType, 'com_defendanim'), id(configs.SeqType, 'human_unarmedblock'));
      const hunt = configs.HuntType.get(hidden.huntmode);
      assert(hunt, `${hiddenName}: hidden hunt profile must be live`);
      for (let tick = 0; tick < Math.max(2, hunt.rate + 1); tick++) advanceNpc(npc, actor);
      assert.equal(npc.type, hidden.id, `${hiddenName}: remains hidden outside radius ${radius}`);
      assert.equal(npc.target, null, `${hiddenName}: outside target remains clear`);

      movePlayer(actor, site.inside);
      let elapsed = 0;
      for (; elapsed < 12 && npc.type === hidden.id; elapsed++) advanceNpc(npc, actor);
      assert.equal(npc.type, active.id, `${hiddenName}: natural proximity changes to visible active form`);
      assert.strictEqual(npc.target, actor, `${activeName}: visible attack retains approaching player`);
      assert.equal(npc.targetOp, mode('OPPLAYER2'), `${activeName}: visible form uses native melee operation`);
      assert.equal(npc.width, active.size, `${activeName}: active collision size`);
      checks.naturalWakes++;

      if (!giantCombat) return;

      assert.equal(active.respawnrate, respawnTicks, `${activeName}: selected native respawn config`);
      assert.equal(param(active, 'attackrate'), attackTicks, `${activeName}: selected native attack interval`);
      const maxHitProc = ScriptProvider.getByName('[proc,npc_melee_maxhit]');
      assert(maxHitProc, 'native melee max-hit procedure must be packed');
      const maxHitState = ScriptRunner.init(maxHitProc, npc);
      npc.executeScript(maxHitState);
      assert.equal(maxHitState.execution, ScriptState.FINISHED, `${activeName}: native max-hit procedure finishes`);
      assert.deepEqual(maxHitState.intStack.slice(0, maxHitState.isp), [maxHit], `${activeName}: native max hit`);

      restoreAnimation = observeMethod(npc, 'playAnimation', animations);
      const attackAnim = id(configs.SeqType, 'horror_crab_attack');
      const prayer = id(configs.VarPlayerType, 'prayer14');
      const actionDelay = id(configs.VarNpcType, 'npc_action_delay');
      const runAttack = protectedStyle => {
        actor.setVar(prayer, protectedStyle ? 1 : 0);
        const before = actor.levels[PlayerStat.HITPOINTS];
        const firstAnimation = animations.length;
        const tape = Array.from({ length: 256 }, (_, index) => index % 3 === 1 ? 0 : 127);
        withRandomValues(tape, () => {
          for (let tick = 0; tick < 20 && !animations.slice(firstAnimation).some(entry => entry.args[0] === attackAnim); tick++) {
            World.currentTick++;
            if (npc.isActive && npc.huntMode !== -1) npc.huntAll(configs.HuntType.get(npc.huntMode));
            npc.turn();
            World.processNpcEventQueue();
          }
        });
        const attack = animations.slice(firstAnimation).find(entry => entry.args[0] === attackAnim);
        assert(attack, `${activeName}: native melee attack animation`);
        assert.equal(npc.getVar(actionDelay), attack.tick + attackTicks, `${activeName}: native attack cycle`);
        const pending = () => actor.queue.all().some(request => request.script?.name === '[queue,combat_damage_player]');
        assert(pending(), `${activeName}: native attack queues player damage`);
        for (let tick = 0; pending() && tick < 20; tick++) {
          actor.processQueues();
          if (pending()) World.currentTick++;
        }
        actor.processQueues();
        assert(!pending(), `${activeName}: player damage queue completes`);
        assert.equal(before - actor.levels[PlayerStat.HITPOINTS], protectedStyle ? 0 : maxHit,
          `${activeName}: native protection or maximum damage`);
        checks.attacks++;
      };
      runAttack(true);
      runAttack(false);
      // Exercise native queue2 damage and queue1 retaliation at both sides of the UNKNOWN HP boundary.
      const aggressivePlayer = id(configs.VarNpcType, 'npc_aggressive_player');
      const attackCount = () => animations.filter(entry => entry.args[0] === attackAnim).length;
      const damageAndRetaliate = (damage, expectedHp, expectedMode) => {
        const beforeAttacks = attackCount();
        npc.setVar(aggressivePlayer, actor.uid);
        npc.setVar(actionDelay, 0);
        npc.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, damage);
        npc.enqueueScript(ServerTriggerType.AI_QUEUE1);
        World.currentTick++;
        npc.turn();
        World.processNpcEventQueue();
        assert.equal(npc.levels[NpcStat.HITPOINTS], expectedHp, `${activeName}: native damage sets boundary HP`);
        assert.equal(npc.targetOp, mode(expectedMode), `${activeName}: native retaliation selects ${expectedMode}`);
        assert.strictEqual(npc.target, actor, `${activeName}: native retaliation retains aggressor`);
        assert.equal(attackCount(), beforeAttacks, `${activeName}: retaliation does not attack during mode transition`);
        checks.retreatCases++;
      };
      damageAndRetaliate(active.stats[NpcStat.HITPOINTS] - retreatHP - 1, retreatHP + 1, 'OPPLAYER2');
      damageAndRetaliate(1, retreatHP, 'PLAYERESCAPE');
      assert.equal(local.get(activeName).fields.get('op2'), 'Attack',
        `${activeName}: retreat leaves the original player Attack option intact`);
      assert.equal(npc.type, active.id, `${activeName}: retreat preserves the active visible form`);

      movePlayer(actor, site.outside);
      npc.target = null;
      npc.targetOp = mode('NONE');
      npc.huntMode = -1;
      npc.setVar(aggressivePlayer, actor.uid);
      npc.heroPoints.addHero(actor.hash64, npc.levels[NpcStat.HITPOINTS]);
      const queueHistory = [];
      hadOwnEnqueue = Object.prototype.hasOwnProperty.call(npc, 'enqueueScript');
      originalEnqueue = npc.enqueueScript;
      npc.enqueueScript = function (queueId, ...args) {
        queueHistory.push(queueId);
        return originalEnqueue.call(this, queueId, ...args);
      };
      const damage = npc.levels[NpcStat.HITPOINTS];
      objectCapture = records;
      withRandomValues(Array(256).fill(0), () => {
        npc.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, damage);
        for (let tick = 0; tick < 12 && npc.isActive; tick++) {
          World.currentTick++;
          npc.turn();
          World.processNpcEventQueue();
          actor.processQueues();
        }
      });
      objectCapture = null;
      assert(queueHistory.includes(ServerTriggerType.AI_QUEUE2), `${activeName}: native hit enters queue2`);
      assert(queueHistory.includes(ServerTriggerType.AI_QUEUE3), `${activeName}: native death dispatches queue3`);
      assert.equal(npc.isActive, false, `${activeName}: native death enters inactive lifecycle`);
      assert(npc.lifecycleTick > 0, `${activeName}: death starts respawn lifecycle`);
      const bones = id(configs.ObjType, 'bones');
      const steel = id(configs.ObjType, 'steel_platebody');
      assert.equal(records.filter(record => record.id === bones).length, 1, `${activeName}: guaranteed Bones`);
      assert.equal(records.filter(record => record.id === steel).length, 1, `${activeName}: deterministic primary loot`);
      assert(records.some(record => /clue scroll/i.test(configs.ObjType.get(record.id)?.name ?? '')),
        `${activeName}: 1/128 medium clue reward remains on native death path`);
      for (const record of records) {
        assert(record.id >= 0, `${activeName}: valid object ID`);
        assert(configs.ObjType.get(record.id), `${activeName}: valid cached drop ${record.id}`);
      }
      checks.deaths++;

      const actualRespawn = npc.lifecycleTick;
      // npc.turn resumes native death, then decrements its newly installed lifecycle timer in that same turn.
      assert.equal(actualRespawn, World.scaleByPlayerCount(active.respawnrate) - 1,
        `${activeName}: native population-scaled respawn after the removal-turn decrement`);
      for (let tick = 1; tick < actualRespawn; tick++) {
        World.currentTick++;
        npc.turn();
        assert.equal(npc.isActive, false, `${activeName}: no early respawn at tick ${tick}`);
      }
      World.currentTick++;
      npc.turn();
      World.processNpcEventQueue();
      assert.equal(npc.isActive, true, `${activeName}: native respawn`);
      assert.equal(npc.type, hidden.id, `${activeName}: respawn returns to original hidden cache form`);
      assert.equal(npc.huntMode, hidden.huntmode, `${activeName}: hidden hunt resets on respawn`);
      assert.deepEqual([...npc.queue.all()], [], `${activeName}: no stale queued combat after respawn`);
    } finally {
      objectCapture = null;
      restoreAnimation();
      if (npc && originalEnqueue) {
        if (hadOwnEnqueue) npc.enqueueScript = originalEnqueue;
        else delete npc.enqueueScript;
      }
      cleanupDrops(records);
      cleanupNpc(npc);
      cleanupPlayer(actor);
    }
  }

  const surface = npc => npc.level === 0 && npc.x >= 2496 && npc.x < 2560 && npc.z >= 3712 && npc.z < 3776;
  const firstFloor = npc => npc.level === 0 && npc.x >= 2496 && npc.x < 2560 && npc.z >= 10112 && npc.z < 10176;
  const deeperFloor = npc => npc.level === 2 || npc.level === 3;

  try {
    World.gameMap.init();
    World.processNpcEventQueue();
    const natural = [...World.npcs].filter(npc => npc.isActive);
    assert(natural.some(npc => npc.type === regularHidden.id && surface(npc)), 'surface map has natural ordinary hidden Rock Crabs');
    assert(natural.some(npc => npc.type === smallHidden.id && surface(npc)), 'surface map has natural small hidden Rock Crabs');
    assert(natural.some(npc => npc.type === giantHidden.id && firstFloor(npc)), 'first-floor map has natural hidden giant Rock Crabs');
    assert(natural.some(npc => npc.type === giantHiddenDeeper.id && deeperFloor(npc)), 'deeper maps have natural hidden giant Rock Crabs');

    const lootActor = addPlayer({ level: 0, x: 2514, z: 10140 });
    try {
      testLootTable(lootActor);
    } finally {
      cleanupPlayer(lootActor);
    }

    testWake('horror_rockcrab_inactive', 'horror_rockcrab', surface, 1);
    testWake('horror_rockcrab_small_inactive', 'horror_rockcrab_small', surface, 1);
    testWake('giant_rockcrab_hidden', 'giant_rockcrab', firstFloor, huntRange, true);
    testWake('giant_rockcrab_hidden_deeper', 'giant_rockcrab_deeper', deeperFloor, huntRange, true);
    console.log(`RESULT PASS waterbirth-crabs ${JSON.stringify(checks)}`);
  } finally {
    objectCapture = null;
    World.addObj = originalAddObj;
    JavaRandom.nextDouble = originalNextDouble;
  }
}

run().then(() => process.exit(0)).catch(error => {
  console.error(error);
  process.exit(1);
});
