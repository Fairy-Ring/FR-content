#!/usr/bin/env node
/** Exercise the original placed Fledgeling, Rock lobster and Spinolyp types through native combat and lifecycle paths. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engineRoot = path.resolve(contentRoot, process.env.HARNESS_ENGINE_DIR ?? '../engine');
const packDir = path.resolve(engineRoot, process.env.HARNESS_PACK_DIR ?? 'data/pack');
const load = relative => import(pathToFileURL(path.join(engineRoot, relative)).href);

function readNpcBlocks(file, strict = false) {
  const blocks = new Map();
  let current = null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const header = /^\[([A-Za-z0-9_]+)\]$/.exec(line.trim());
    if (header) {
      if (strict) assert(!blocks.has(header[1]), `duplicate NPC block ${header[1]} in ${file}`);
      current = { fields: new Map(), params: [], clientLines: [] };
      blocks.set(header[1], current);
      continue;
    }
    if (!current || !line.includes('=') || line.trimStart().startsWith('//')) continue;
    const equals = line.indexOf('=');
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    current.clientLines.push(line);
    if (key === 'param') current.params.push(value);
    else {
      current.fields.set(key, value);
    }
  }
  return blocks;
}

const originalClientLines = {
  jb_baby_dagganoth: [
    'name=Dagannoth fledgeling', 'desc=A knee-high horror from the ocean depths...', 'model1=npc_2880', 'model2=npc_2880i2',
    'size=2', 'resizeh=69', 'resizev=69', 'contrast=30', 'ambient=30', 'walkanim=slayer_lizard_walk',
    'readyanim=slayer_lizard_ready', 'resizeh=60', 'resizev=60', 'op2=Attack', 'vislevel=70', 'hitpoints=100',
    'attack=50', 'strength=50', 'defence=50'
  ],
  dagannoth_rock_lobster_2x2: [
    'name=Rock lobster', "desc=It wasn't a rock... it was a rock lobster!", 'model1=npc_2889', 'model2=npc_2889i2',
    'size=2', 'resizeh=85', 'resizev=85', 'contrast=15', 'ambient=15', 'walkanim=dagannoth_rock_lobster_walk',
    'readyanim=dagannoth_rock_lobster_ready', 'op2=Attack', 'vislevel=127', 'hitpoints=150', 'attack=100',
    'strength=100', 'defence=100'
  ],
  dagannoth_rock_lobster_2x2_loc: [
    'name=Rock', 'desc=A Rock.', 'model1=npc_2890', 'vislevel=hide', 'size=2', 'resizeh=85', 'resizev=85',
    'contrast=15', 'ambient=15', 'turnspeed=0', 'minimap=no', 'wanderrange=0', 'moverestrict=nomove', 'defaultmode=none'
  ],
  dagannoth_water_creature_1x1_invisible: [
    'name=Suspicious water', "desc=If I didn't know better, I'd swear there's something in there...",
    'model1=trollrescue_blankmodel_8', 'minimap=no', 'vislevel=34'
  ],
  dagannoth_water_creature_1x1: [
    'name=Spinolyp', 'desc=A sneaky, spiny, subterranean sea-dwelling scamp.', 'model1=npc_2892', 'resizeh=40',
    'resizev=40', 'contrast=50', 'ambient=50', 'walkanim=dagannoth_water_creature_walk',
    'readyanim=dagannoth_water_creature_ready', 'op2=Attack', 'vislevel=76', 'hitpoints=100', 'attack=10',
    'strength=10', 'defence=10'
  ],
  dagannoth_water_creature_1x1_invisible2: [
    'name=Suspicious water', "desc=If I didn't know better, I'd swear there's something in there...",
    'model1=trollrescue_blankmodel_8', 'minimap=no', 'vislevel=34'
  ],
  dagannoth_water_creature_1x12: [
    'name=Spinolyp', 'desc=A sneaky, spiny, subterranean sea-dwelling scamp.', 'model1=npc_2892', 'resizeh=40',
    'resizev=40', 'contrast=50', 'ambient=50', 'walkanim=dagannoth_water_creature_walk',
    'readyanim=dagannoth_water_creature_ready', 'op2=Attack', 'vislevel=76', 'hitpoints=100', 'attack=10',
    'strength=10', 'defence=10'
  ],
  dagannoth_water_creature_1x1_invisible3: [
    'name=Suspicious water', "desc=If I didn't know better, I'd swear there's something in there...",
    'model1=trollrescue_blankmodel_8', 'minimap=no', 'vislevel=34'
  ],
  dagannoth_water_creature_1x13: [
    'name=Spinolyp', 'desc=A sneaky, spiny, subterranean sea-dwelling scamp.', 'model1=npc_2892', 'resizeh=40',
    'resizev=40', 'contrast=50', 'ambient=50', 'walkanim=dagannoth_water_creature_walk',
    'readyanim=dagannoth_water_creature_ready', 'op2=Attack', 'vislevel=76', 'hitpoints=100', 'attack=10',
    'strength=10', 'defence=10'
  ]
};

const placedCounts = {
  jb_baby_dagganoth: 5,
  dagannoth_rock_lobster_2x2: 0,
  dagannoth_rock_lobster_2x2_loc: 24,
  dagannoth_water_creature_1x1_invisible: 3,
  dagannoth_water_creature_1x1: 4,
  dagannoth_water_creature_1x1_invisible2: 4,
  dagannoth_water_creature_1x12: 5,
  dagannoth_water_creature_1x1_invisible3: 7,
  dagannoth_water_creature_1x13: 2
};

async function run() {
  process.env.NODE_MEMBERS = 'true';
  process.chdir(engineRoot);

  const World = (await load('src/engine/World.ts')).default;
  const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
  const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
  const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
  const ScriptPointer = (await load('src/engine/script/ScriptPointer.ts')).default;
  const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
  const Npc = (await load('src/engine/entity/Npc.ts')).default;
  const Player = (await load('src/engine/entity/Player.ts')).default;
  const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
  const { NpcStat } = await load('src/engine/entity/NpcStat.ts');
  const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
  const { NpcMode } = await load('src/engine/entity/NpcMode.ts');
  const { Interaction } = await load('src/engine/entity/Interaction.ts');
  const { isLineOfSight, isLineOfWalk } = await load('src/engine/GameMap.ts');
  const JavaRandom = (await load('src/util/JavaRandom.ts')).default;
  const Environment = (await load('src/util/Environment.ts')).default;
  const { ParamHelper } = await load('src/cache/config/ParamHelper.ts');

  const configs = {};
  for (const name of [
    'VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType',
    'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType',
    'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType'
  ]) {
    configs[name] = (await load(`src/cache/config/${name}.ts`)).default;
    configs[name].load(packDir);
  }
  (await load('src/cache/config/DbTableIndex.ts')).default.init();
  assert(ScriptProvider.load(packDir) > 0, 'build the sibling engine pack first');
  assert.equal(Environment.NODE_MEMBERS, true, 'Waterbirth map NPCs require the members world');

  const npcConfig = path.join(contentRoot, 'scripts/areas/area_waterbirth/configs/waterbirth_other_monsters.npc');
  const local = readNpcBlocks(npcConfig, true);
  const unpack = readNpcBlocks(path.join(contentRoot, 'scripts/_unpack/377/all.npc'));
  for (const [name, lines] of Object.entries(originalClientLines)) {
    assert(!unpack.has(name), `${name}: parent must remove the duplicate unpack block after the moved config is integrated`);
    const moved = local.get(name);
    assert(moved, `missing moved NPC block ${name}`);
    assert.deepEqual(moved.clientLines.slice(0, lines.length), lines, `${name}: original 377 client lines, including order and duplicate fields`);
  }
  assert.equal(local.size, 9, 'this slice contains exactly the nine original placed types and their active form');

  const id = (type, name) => {
    const value = type.getId(name);
    assert(value >= 0, `missing packed ${name}`);
    return value;
  };
  const param = (type, name) => {
    const paramType = configs.ParamType.getByName(name);
    assert(paramType, `missing param ${name}`);
    return ParamHelper.getIntParam(paramType.id, type, paramType.defaultInt);
  };
  const readConstant = (relative, name) => {
    const expression = new RegExp(`^\\s*\\^${name}\\s*=\\s*(-?\\d+)\\s*(?:\\/\\/.*)?$`, 'gm');
    const matches = [...readFileSync(path.join(contentRoot, relative), 'utf8').matchAll(expression)];
    assert.equal(matches.length, 1, `expected one ${name} constant in ${relative}`);
    return Number(matches[0][1]);
  };
  const types = new Map(Object.keys(placedCounts).map(name => {
    const type = configs.NpcType.getByName(name);
    assert(type, `packed NPC type ${name}`);
    return [name, type];
  }));
  const exact = (trigger, type) => ScriptProvider.getByTriggerSpecific(trigger, type.id);
  const native = name => {
    const proc = ScriptProvider.getByName(`[proc,${name}]`);
    assert(proc, `native procedure ${name} must be packed`);
    return proc;
  };
  const generic = (trigger, type) => ScriptProvider.getByTriggerSpecific(trigger, -1, type.category);

  for (const [name, count] of Object.entries(placedCounts)) {
    const type = types.get(name);
    assert.equal(type.id >= 0, true, `${name} has a cache ID without pinning generated IDs`);
    assert.equal(type.name, name.includes('invisible') ? 'Suspicious water' : name === 'dagannoth_rock_lobster_2x2_loc' ? 'Rock' : name === 'jb_baby_dagganoth' ? 'Dagannoth fledgeling' : name.startsWith('dagannoth_water_creature') ? 'Spinolyp' : 'Rock lobster');
    const queue3 = generic(ServerTriggerType.AI_QUEUE3, type);
    if (name !== 'dagannoth_rock_lobster_2x2_loc') {
      assert(queue3, `${name}: guaranteed-drop type uses its native death trigger`);
      assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, type.id, type.category), queue3);
    }
    if (count > 0) assert(type, `${name}: originally placed cache form`);
  }

  const fledge = types.get('jb_baby_dagganoth');
  assert.equal(fledge.size, 2);
  assert.equal(fledge.stats[NpcStat.HITPOINTS], 100);
  assert.equal(fledge.stats[NpcStat.ATTACK], 50);
  assert.equal(fledge.stats[NpcStat.STRENGTH], 50);
  assert.equal(fledge.stats[NpcStat.DEFENCE], 50);
  assert.equal(param(fledge, 'damagetype'), readConstant('scripts/skill_combat/configs/combat_damagetypes.constant', 'stab_style'));
  assert.equal(param(fledge, 'attackrate'), 4);
  assert.equal(param(fledge, 'death_drop'), id(configs.ObjType, 'bones'));
  assert.equal(param(fledge, 'combat_xp_multiplier'), 0, 'CANDIDATE current exact-variant article says the Fledgeling gives no combat XP');
  assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_OPPLAYER2, fledge.id, fledge.category), generic(ServerTriggerType.AI_OPPLAYER2, fledge), 'Fledgeling retains native non-aggressive melee dispatch');

  const lobster = types.get('dagannoth_rock_lobster_2x2');
  const hiddenRock = types.get('dagannoth_rock_lobster_2x2_loc');
  assert.equal(lobster.size, 2);
  assert.equal(lobster.stats[NpcStat.HITPOINTS], 150);
  assert.equal(lobster.stats[NpcStat.ATTACK], 100);
  assert.equal(lobster.stats[NpcStat.STRENGTH], 100);
  assert.equal(lobster.stats[NpcStat.DEFENCE], 100);
  assert.equal(param(lobster, 'damagetype'), readConstant('scripts/skill_combat/configs/combat_damagetypes.constant', 'crush_style'));
  assert.equal(param(lobster, 'attackrate'), 2);
  assert.equal(param(lobster, 'death_drop'), id(configs.ObjType, 'raw_lobster'));
  assert(hiddenRock.vislevel < 0, 'hidden Rock remains non-visible until its native approach trigger');
  const approach = configs.HuntType.get(hiddenRock.huntmode);
  assert(approach, 'hidden-form approach hunt compiles');
  assert.equal(approach.findNewMode, NpcMode.OPPLAYER2, 'native hunt selects the approaching player as the operation target');
  assert(exact(ServerTriggerType.AI_OPPLAYER2, hiddenRock), 'hidden Rock has a native type-change operation trigger');
  assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_OPPLAYER2, lobster.id, lobster.category), generic(ServerTriggerType.AI_OPPLAYER2, lobster), 'active Rock lobster retains native melee attack dispatch');
  assert.equal(param(lobster, 'death_anim'), id(configs.SeqType, 'dagannoth_rock_lobster_death'));

  const hiddenNames = [
    'dagannoth_water_creature_1x1_invisible',
    'dagannoth_water_creature_1x1_invisible2',
    'dagannoth_water_creature_1x1_invisible3'
  ];
  const visibleNames = [
    'dagannoth_water_creature_1x1',
    'dagannoth_water_creature_1x12',
    'dagannoth_water_creature_1x13'
  ];
  const visibleForHidden = new Map([
    [hiddenNames[0], visibleNames[0]], [hiddenNames[1], visibleNames[1]], [hiddenNames[2], visibleNames[2]]
  ]);
  for (const hiddenName of hiddenNames) {
    const type = types.get(hiddenName);
    assert.equal(type.vislevel, 34);
    assert.equal(type.stats[NpcStat.HITPOINTS], 100);
    assert.equal(type.stats[NpcStat.RANGED], 1, `${hiddenName}: hidden source ranged stat remains exact`);
    assert.equal(type.huntrange, readConstant('scripts/areas/area_waterbirth/configs/waterbirth_other_monsters.constant', 'waterbirth_other_spinolyp_approach_radius'));
    assert.equal(type.attackrange, 1, `${hiddenName}: only adjacent players can be hit while submerged`);
    assert.equal(param(type, 'death_drop'), id(configs.ObjType, 'bones'));
    assert(exact(ServerTriggerType.AI_OPPLAYER2, type), `${hiddenName}: hidden water has an adjacent melee/reveal route`);
    assert(exact(ServerTriggerType.AI_QUEUE4, type), `${hiddenName}: hidden form handles the native re-emergence queue`);
    const reveal = types.get(visibleForHidden.get(hiddenName));
    assert.equal(param(reveal, 'death_anim'), id(configs.SeqType, 'dagannoth_water_creature_death'));
    assert.equal(param(reveal, 'proj_travel'), id(configs.SpotanimType, 'dagannoth_spine_spotanim_travel2'), '377 spotanim maps the native Water Creature spine travel sequence');
    assert.equal(param(reveal, 'poison_severity'), 6, 'CANDIDATE exact-variant ranged poison severity');
    assert.equal(reveal.stats[NpcStat.RANGED], 100, `${reveal.name}: visible source ranged stat remains exact`);
    assert.equal(param(reveal, 'rangeattack'), 0, `${reveal.name}: source ranged attack bonus remains zero`);
    assert.equal(param(reveal, 'rangebonus'), 0, `${reveal.name}: source ranged strength bonus remains zero`);
    assert.equal(param(reveal, 'attackrate'), 4, 'CANDIDATE exact-variant attack interval');
    assert.equal(param(reveal, 'death_drop'), id(configs.ObjType, 'bones'));
    assert(exact(ServerTriggerType.AI_APPLAYER2, reveal), `${reveal.name}: visible form uses its native local attack dispatcher`);
  }
  assert.equal(readConstant('scripts/areas/area_waterbirth/configs/waterbirth_other_monsters.constant', 'waterbirth_other_spinolyp_maxhit'), 10);
  assert.equal(readConstant('scripts/areas/area_waterbirth/configs/waterbirth_other_monsters.constant', 'waterbirth_other_spinolyp_form_ticks'), 500);
  assert.equal(readConstant('scripts/areas/area_waterbirth/configs/waterbirth_other_monsters.constant', 'waterbirth_other_spinolyp_submerge_denominator'), 8);
  native('npc_ranged_attack_roll');
  native('npc_ranged_maxhit');
  native('npc_rangeattack_resolve');
  native('npc_check_notcombat');
  native('npc_check_notcombat_self');
  native('npc_ranged_attack_roll_no_prot');
  native('npc_attack_accuracy');
  native('player_defence_roll_specific');
  native('npc_spell_cast');
  native('npc_spell_success_head');
  native('npc_spell_success_tail');
  native('npc_spell_fail');
  native('npc_spell_magnitude');
  native('player_projectile');
  native('npc_default_attack');
  native('npc_default_death');
  assert(ScriptProvider.getByName('[proc,waterbirth_other_spinolyp_attack]'));
  assert(ScriptProvider.getByName('[proc,waterbirth_other_spinolyp_range_attack]'));
  assert(ScriptProvider.getByName('[proc,waterbirth_other_spinolyp_magic_attack]'));
  assert(ScriptProvider.getByName('[proc,waterbirth_other_spinolyp_submerge]'));
  assert(ScriptProvider.getByName('[proc,waterbirth_other_spinolyp_reemerge]'));

  World.currentTick = 1000;
  World.gameMap.init();
  World.processNpcEventQueue();
  const placed = Object.fromEntries(Object.entries(placedCounts).map(([name]) => [name, 0]));
  const nameForId = new Map([...types].map(([name, type]) => [type.id, name]));
  for (const npc of [...World.npcs]) {
    if (!npc.isActive) continue;
    const name = nameForId.get(npc.type);
    if (name) placed[name]++;
  }
  assert.deepEqual(placed, placedCounts, 'm45_69 Spinolyp forms, m29/m30_68 hidden Rocks and m28_68 Fledgelings match the full original 377 map inventory');
  assert.equal(Object.values(placed).reduce((sum, count) => sum + count, 0), 54, 'the slice owns exactly 54 originally placed NPCs, including only the hidden Rock form');

  const directions = [
    { dx: -1, dz: 0, side: 'west' }, { dx: 1, dz: 0, side: 'east' },
    { dx: 0, dz: -1, side: 'south' }, { dx: 0, dz: 1, side: 'north' }
  ];
  function playerSite(npc, distance = 1) {
    for (const { dx, dz, side } of directions) {
      const x = side === 'west' ? npc.x - distance : side === 'east' ? npc.x + npc.width - 1 + distance : npc.x;
      const z = side === 'south' ? npc.z - distance : side === 'north' ? npc.z + npc.length - 1 + distance : npc.z;
      if (isLineOfWalk(npc.level, npc.x, npc.z, x, z) && isLineOfSight(npc.level, npc.x, npc.z, x, z)) {
        return { level: npc.level, x, z };
      }
    }
    return null;
  }
  let serial = 0;
  const slot = 1;
  const hash = BigInt(7000 + ++serial);
  const actor = new Player(`waterbirthOther${serial}`, hash, hash);
  actor.slot = slot;
  actor.pid = slot;
  actor.uid = ((Number(hash & 0x1fffffn) << 11) | slot) >>> 0;
  actor.isActive = true;
  actor.vars.fill(0);
  actor.stats.fill(0);
  actor.baseLevels.fill(1);
  actor.levels.fill(1);
  actor.baseLevels[PlayerStat.HITPOINTS] = 99;
  actor.levels[PlayerStat.HITPOINTS] = 99;
  actor.baseLevels[PlayerStat.PRAYER] = 10;
  actor.levels[PlayerStat.PRAYER] = 10;
  actor.getInventory(configs.InvType.getId('worn'));
  actor.getInventory(configs.InvType.getId('inventory'));
  actor.write = () => {};
  actor.messageGame = () => {};
  const attachPlayer = coord => {
    if (World.players[slot] === actor) World.gameMap.getZone(actor.x, actor.z, actor.level).leave(actor);
    actor.level = coord.level;
    actor.x = coord.x;
    actor.z = coord.z;
    World.players[slot] = actor;
    World.playerLoop.add(hash, actor);
    World.gameMap.getZone(actor.x, actor.z, actor.level).enter(actor);
  };
  const movePlayer = coord => {
    World.gameMap.getZone(actor.x, actor.z, actor.level).leave(actor);
    actor.level = coord.level;
    actor.x = coord.x;
    actor.z = coord.z;
    World.gameMap.getZone(actor.x, actor.z, actor.level).enter(actor);
  };
  const connect = (npc, mode) => {
    npc.setInteraction(Interaction.SCRIPT, actor, mode);
    assert.strictEqual(npc.target, actor, `NPC ${npc.type} targets the fixture player`);
    assert.equal(npc.targetOp, mode, `NPC ${npc.type} uses the requested native interaction mode`);
  };
  const withRandomTape = (values, callback) => {
    const original = JavaRandom.nextDouble;
    let index = 0;
    JavaRandom.nextDouble = () => values[Math.min(index++, values.length - 1)];
    try { return callback(); }
    finally { JavaRandom.nextDouble = original; }
  };
  const runNativePlayerMelee = npc => {
    const script = ScriptProvider.getByName('[label,player_melee_attack]');
    assert(script, 'packed native player_melee_attack label is available');
    const state = ScriptRunner.init(script, npc, actor, []);
    state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
    actor.executeScript(state, true, true);
    assert.equal(state.execution, ScriptState.FINISHED, 'native player_melee_attack finishes');
  };
  const stepNpc = (npc, hunt = true) => {
    World.currentTick++;
    if (hunt && npc.isActive && npc.huntMode !== -1) npc.huntAll(configs.HuntType.get(npc.huntMode));
    npc.turn();
    World.processNpcEventQueue();
    actor.processQueues();
  };
  const formTicks = readConstant('scripts/areas/area_waterbirth/configs/waterbirth_other_monsters.constant', 'waterbirth_other_spinolyp_form_ticks');
  const submergeAndReemerge = (npc, visibleName, hiddenName) => {
    const originalBase = npc.baseType;
    const hidden = types.get(hiddenName);
    const attackSite = playerSite(npc, 1);
    assert(attackSite, `${hiddenName}: native collision map provides the attack tile`);
    movePlayer(attackSite);
    actor.levels[PlayerStat.HITPOINTS] = 99;
    actor.levels[PlayerStat.PRAYER] = 10;
    actor.setVar(protectMagic, 0);
    actor.setVar(protectMissiles, 0);
    actor.setVar(poisonVar, 0);
    connect(npc, NpcMode.APPLAYER2);
    withRandomTape([0.999999, 0.999999, 0, 0.999999, 0], () => stepNpc(npc, false));
    assert.equal(npc.type, hidden.id, `${visibleName}: native attack transition submerges into its paired form`);
    const request = [...npc.queue.all()].find(candidate => candidate.queueId === ServerTriggerType.AI_QUEUE4);
    assert(request, `${hiddenName}: native queue schedules a real re-emergence event`);
    assert.equal(request.delay, formTicks, `${hiddenName}: re-emergence uses the named UNKNOWN interval`);
    movePlayer({ level: npc.level, x: npc.x + 32, z: npc.z + 32 });
    for (let tick = 0; tick < formTicks; tick++) stepNpc(npc, false);
    assert.equal(npc.type, types.get(visibleName).id, `${hiddenName}: native queue re-emerges as its visible pair`);
    assert.equal(npc.baseType, originalBase, `${hiddenName}: form changes retain the original cache base`);
  };
  const actorHp = () => actor.levels[PlayerStat.HITPOINTS];
  const originalAddObj = World.addObj;
  const drops = [];
  World.addObj = function (object, receiver, duration) {
    drops.push({ object, receiver, duration, tick: World.currentTick });
    return originalAddObj.call(this, object, receiver, duration);
  };
  const protectMagic = id(configs.VarPlayerType, 'prayer12');
  const protectMissiles = id(configs.VarPlayerType, 'prayer13');
  const poisonVar = id(configs.VarPlayerType, 'poison');
  const JavaRandomOriginal = JavaRandom.nextDouble;

  try {
    const firstFledge = [...World.npcs].find(npc => npc.isActive && npc.type === fledge.id);
    assert(firstFledge, 'map provides a placed non-aggressive Fledgeling');
    const fledgeSite = playerSite(firstFledge, 1);
    assert(fledgeSite, 'native collision map provides a reachable Fledgeling adjacency');
    attachPlayer(fledgeSite);
    assert.equal(firstFledge.huntMode, -1, 'Fledgeling does not aggress');
    connect(firstFledge, NpcMode.OPPLAYER2);
    const fledgeHp = actorHp();
    withRandomTape([0.999999, 0, 0.999999], () => stepNpc(firstFledge, false));
    for (let tick = 0; tick < 4 && actorHp() === fledgeHp; tick++) stepNpc(firstFledge, false);
    assert.equal(fledgeHp - actorHp(), 6, 'native Stab melee resolves the current exact-variant max hit');
    actor.setVar(id(configs.VarPlayerType, 'tutorial'), 1000);
    actor.setVar(id(configs.VarPlayerType, 'damagestyle'), 0);
    actor.setVar(id(configs.VarPlayerType, 'damagetype'), 0);
    actor.setVar(id(configs.VarPlayerType, 'com_stabattack'), 1_000_000);
    actor.setVar(id(configs.VarPlayerType, 'com_maxhit'), 6);
    firstFledge.setVar(id(configs.VarNpcType, 'npc_combat_xp_multiplier'), param(fledge, 'combat_xp_multiplier'));
    const fledgeXpBefore = Array.from(actor.stats);
    withRandomTape([0.999999, 0, 0.999999], () => runNativePlayerMelee(firstFledge));
    const fledgeHit = [...firstFledge.queue.all()].findLast(request => request.queueId === ServerTriggerType.AI_QUEUE2);
    assert.equal(fledgeHit?.lastInt, 6, 'native player_melee_attack lands its maximum Stab hit');
    assert.deepEqual(Array.from(actor.stats), fledgeXpBefore, 'native player_melee_attack gives no combat or Slayer XP');
    firstFledge.queue.clear();

    const rock = [...World.npcs].find(npc => npc.isActive && npc.type === hiddenRock.id);
    assert(rock, 'map provides a placed hidden Rock lobster');
    const rockSite = playerSite(rock, 1);
    assert(rockSite, 'native collision map provides a reachable hidden-Rock approach');
    movePlayer(rockSite);
    stepNpc(rock);
    assert.equal(rock.type, lobster.id, 'native hidden-Rock OPPLAYER2 proximity changes to its active form');
    assert.equal(rock.baseType, hiddenRock.id, 'Rock lobster form keeps the original hidden cache type as its base for native reset');
    assert.equal(rock.lifecycle, EntityLifeCycle.RESPAWN);
    const rockHp = actorHp();
    connect(rock, NpcMode.OPPLAYER2);
    withRandomTape([0.999999, 0, 0.999999], () => stepNpc(rock));
    for (let tick = 0; tick < 4 && actorHp() === rockHp; tick++) stepNpc(rock);
    assert(rockHp - actorHp() > 0 && rockHp - actorHp() <= 11, 'active Rock lobster uses its native Crush attack, capped at the selected maximum');

    const visible1 = types.get(visibleNames[0]);
    const visible2 = types.get(visibleNames[1]);
    const visible3 = types.get(visibleNames[2]);
    const magicSpinolyp = [...World.npcs].find(npc => npc.isActive && npc.type === visible1.id);
    const rangedSpinolyp = [...World.npcs].find(npc => npc.isActive && npc.type === visible2.id);
    const submergedControl = [...World.npcs].find(npc => npc.isActive && npc.type === visible3.id);
    assert(magicSpinolyp && rangedSpinolyp && submergedControl, 'each original visible Spinolyp cache form is placed');

    const magicSite = playerSite(magicSpinolyp, 1);
    assert(magicSite, 'native collision map provides a reachable Spinolyp attack tile');
    movePlayer(magicSite);
    actor.setVar(protectMagic, 1);
    actor.setVar(protectMissiles, 0);
    actor.setVar(poisonVar, 0);
    actor.levels[PlayerStat.HITPOINTS] = 99;
    actor.levels[PlayerStat.PRAYER] = 10;
    const magicProtectedHp = actorHp();
    const magicProtectedPrayer = actor.levels[PlayerStat.PRAYER];
    connect(magicSpinolyp, NpcMode.APPLAYER2);
    withRandomTape([0.999999, 0.999999, 0, 0.999999, 0.999999], () => stepNpc(magicSpinolyp, false));
    for (let tick = 0; tick < 5; tick++) {
      World.currentTick++;
      World.processNpcEventQueue();
      actor.processQueues();
    }
    assert.equal(magicProtectedHp - actorHp(), 0, 'Protect from Magic blocks the Spinolyp Magic-style attack');
    assert.equal(actor.levels[PlayerStat.PRAYER], magicProtectedPrayer, 'a blocked Magic-style hit does not drain Prayer');
    assert.equal(actor.getVar(poisonVar), 0, 'CANDIDATE source attribution: the Magic-style attack does not inherit Ranged poison');

    actor.setVar(protectMagic, 0);
    actor.setVar(protectMissiles, 1);
    actor.levels[PlayerStat.HITPOINTS] = 99;
    actor.levels[PlayerStat.PRAYER] = 10;
    const magicMissilesHp = actorHp();
    const magicMissilesPrayer = actor.levels[PlayerStat.PRAYER];
    connect(magicSpinolyp, NpcMode.APPLAYER2);
    withRandomTape([0.999999, 0.999999, 0, 0.999999, 0.999999], () => stepNpc(magicSpinolyp, false));
    for (let tick = 0; tick < 5; tick++) {
      World.currentTick++;
      World.processNpcEventQueue();
      actor.processQueues();
    }
    assert.equal(magicMissilesHp - actorHp(), 10, 'Protect from Missiles does not block the Ranged-accuracy Magic-style attack');
    assert.equal(actor.levels[PlayerStat.PRAYER], magicMissilesPrayer - 1, 'successful Magic-style attack drains one Prayer point');
    assert.equal(actor.getVar(poisonVar), 0, 'CANDIDATE source attribution: Protect from Missiles does not alter Magic-style poison');

    const rangeSite = playerSite(rangedSpinolyp, 1);
    assert(rangeSite, 'native collision map provides a reachable second Spinolyp attack tile');
    movePlayer(rangeSite);
    actor.setVar(protectMagic, 1);
    actor.setVar(protectMissiles, 0);
    actor.setVar(poisonVar, 0);
    actor.levels[PlayerStat.HITPOINTS] = 99;
    const rangeMagicHp = actorHp();
    connect(rangedSpinolyp, NpcMode.APPLAYER2);
    withRandomTape([0, 0.999999, 0, 0.999999, 0.999999], () => stepNpc(rangedSpinolyp, false));
    for (let tick = 0; tick < 5; tick++) {
      World.currentTick++;
      World.processNpcEventQueue();
      actor.processQueues();
    }
    assert.equal(rangeMagicHp - actorHp(), 10, 'Protect from Magic does not block the native Ranged-style attack');
    assert.equal(actor.getVar(poisonVar), 6, 'Ranged-style attack retains native severity-6 poison under Protect from Magic');

    actor.setVar(protectMagic, 0);
    actor.setVar(protectMissiles, 1);
    actor.setVar(poisonVar, 0);
    actor.levels[PlayerStat.HITPOINTS] = 99;
    const rangeMissilesHp = actorHp();
    connect(rangedSpinolyp, NpcMode.APPLAYER2);
    withRandomTape([0, 0.999999, 0, 0.999999, 0.999999], () => stepNpc(rangedSpinolyp, false));
    for (let tick = 0; tick < 5; tick++) {
      World.currentTick++;
      World.processNpcEventQueue();
      actor.processQueues();
    }
    assert.equal(rangeMissilesHp - actorHp(), 0, 'Protect from Missiles blocks the native Ranged-style attack');
    assert.equal(actor.getVar(poisonVar), 0, 'Protect from Missiles also blocks poison from the protected Ranged-style attack');

    const visibleCycles = [
      [visibleNames[0], hiddenNames[0], magicSpinolyp],
      [visibleNames[1], hiddenNames[1], rangedSpinolyp],
      [visibleNames[2], hiddenNames[2], submergedControl]
    ];
    for (const [visibleName, hiddenName, npc] of visibleCycles) {
      submergeAndReemerge(npc, visibleName, hiddenName);
    }

    const hidden1 = [...World.npcs].find(npc => npc.isActive && npc.type === types.get(hiddenNames[0]).id);
    const hidden2 = [...World.npcs].find(npc => npc.isActive && npc.type === types.get(hiddenNames[1]).id);
    const hidden3 = [...World.npcs].find(npc => npc.isActive && npc.type === types.get(hiddenNames[2]).id);
    assert(hidden1 && hidden2 && hidden3, 'each original hidden Spinolyp form is placed');
    for (const [hiddenName, npc] of [[hiddenNames[0], hidden1], [hiddenNames[1], hidden2], [hiddenNames[2], hidden3]]) {
      const surfaceSite = playerSite(npc, 2);
      assert(surfaceSite, `${hiddenName}: native collision map provides the edge-of-approach tile`);
      movePlayer(surfaceSite);
      stepNpc(npc);
      const visibleName = visibleForHidden.get(hiddenName);
      assert.equal(npc.type, types.get(visibleName).id, `${hiddenName}: native player approach surfaces its exact visible pair`);
      assert.equal(npc.baseType, types.get(hiddenName).id, `${hiddenName}: native form retains its original cache base`);
      movePlayer({ level: npc.level, x: npc.x + 32, z: npc.z + 32 });
      for (let tick = 0; tick < formTicks; tick++) stepNpc(npc, false);
      assert.equal(npc.type, types.get(hiddenName).id, `${hiddenName}: native type timer returns to its original base water form`);
      movePlayer(surfaceSite);
      stepNpc(npc);
      assert.equal(npc.type, types.get(visibleName).id, `${hiddenName}: native approach surfaces the family before its attack cycle`);
      submergeAndReemerge(npc, visibleName, hiddenName);
    }

    const expectedDrops = new Map([
      [fledge.id, id(configs.ObjType, 'bones')],
      [lobster.id, id(configs.ObjType, 'raw_lobster')],
      ...hiddenNames.map(name => [types.get(name).id, id(configs.ObjType, 'bones')]),
      ...visibleNames.map(name => [types.get(name).id, id(configs.ObjType, 'bones')])
    ]);
    for (const [npcId, expectedObj] of expectedDrops) {
      const type = configs.NpcType.get(npcId);
      const npc = [...World.npcs].find(candidate => candidate.isActive && candidate.type === npcId);
      assert(npc, `${type.name} cache form remains available for native death test`);
      const tile = playerSite(npc, 1);
      assert(tile, `${type.name} has a collision-grounded hero tile`);
      movePlayer(tile);
      const before = drops.length;
      const originalType = npc.type;
      npc.heroPoints.addHero(actor.hash64, npc.levels[NpcStat.HITPOINTS]);
      npc.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, npc.levels[NpcStat.HITPOINTS]);
      for (let tick = 0; tick < 10 && npc.isActive; tick++) stepNpc(npc, false);
      assert.equal(npc.isActive, false, `${type.name} enters native death removal`);
      assert.equal(drops.length, before + 1, `${type.name} produces exactly one native hero-attributed guaranteed drop`);
      assert.equal(drops.at(-1).object.type, expectedObj, `${type.name} selects only its dated guaranteed drop`);
      assert.equal(drops.at(-1).object.count, 1);
      assert.strictEqual(drops.at(-1).receiver, actor);
      assert.equal(npc.lifecycle, EntityLifeCycle.RESPAWN, `${type.name} uses native respawn lifecycle`);
      const respawnTicks = type.respawnrate;
      assert(respawnTicks > 0, `${type.name} has an explicit selected respawn interval`);
      for (let tick = 0; tick < respawnTicks; tick++) stepNpc(npc, false);
      assert.equal(npc.isActive, true, `${type.name} returns through native respawn`);
      assert.equal(npc.type, npc.baseType, `${type.name} respawns in its original cache form`);
      assert.equal(npc.baseType, originalType === lobster.id ? hiddenRock.id : originalType, `${type.name} reset preserves its original placed form`);
    }

    assert.equal(drops.length, expectedDrops.size, 'no hidden Rock or later unfiltered item loot is introduced');
    console.log('RESULT PASS waterbirth-other-monsters native placement, transitions, styles, poison, Prayer, death, drops and respawn');
  } finally {
    JavaRandom.nextDouble = JavaRandomOriginal;
    World.addObj = originalAddObj;
    for (const drop of drops) if (drop.object.isActive) World.removeObj(drop.object, -1);
    if (World.players[slot] === actor) {
      World.gameMap.getZone(actor.x, actor.z, actor.level).leave(actor);
      World.players[slot] = null;
      actor.unlink();
    }
  }
}

run().then(() => process.exit(0)).catch(error => {
  console.error(error);
  process.exit(1);
});
