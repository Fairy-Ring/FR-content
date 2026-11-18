#!/usr/bin/env node
/** Exercise the packed Waterbirth egg hunt, staged hatch, ordinary Spawn combat and native expiry. */
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
      if (strict) assert(!blocks.has(header[1]), `duplicate NPC block ${header[1]} in ${file}`);
      current = { fields: new Map(), params: [] };
      blocks.set(header[1], current);
      continue;
    }
    if (!current || !line.includes('=') || line.trimStart().startsWith('//')) continue;
    const equals = line.indexOf('=');
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    if (key === 'param') current.params.push(value);
    else {
      if (strict) assert(!current.fields.has(key), `duplicate ${key} field in ${file}`);
      current.fields.set(key, value);
    }
  }
  return blocks;
}

const originalNpcFields = {
  dungeon_dagganoth_egg1: {
    fields: {
      name: 'Egg', desc: "I bet it's not made of chocolate...", model1: 'npc_2449',
      resizeh: '100', resizev: '100', turnspeed: '0', vislevel: 'hide', minimap: 'no',
      wanderrange: '0', moverestrict: 'nomove', defaultmode: 'none'
    }
  },
  dungeon_dagganoth_egg2: {
    fields: {
      name: 'Egg', desc: 'Moving eggs are worrying...', model1: 'npc_2450',
      walkanim: 'dagganoth_egg_open', readyanim: 'dagganoth_egg_open', resizeh: '100',
      resizev: '100', turnspeed: '0', vislevel: 'hide', minimap: 'no', wanderrange: '0',
      moverestrict: 'nomove', defaultmode: 'none'
    }
  },
  dungeon_dagganoth_egg3: {
    fields: {
      name: 'Egg', desc: 'I wonder what was inside it?', model1: 'npc_2451',
      resizeh: '100', resizev: '100', turnspeed: '0', vislevel: 'hide', minimap: 'no',
      wanderrange: '0', moverestrict: 'nomove', defaultmode: 'none'
    }
  },
  dagganoth_critter: {
    fields: {
      name: 'Dagannoth spawn', desc: 'A teeny-tiny horror from the ocean depths...',
      model1: 'npc_2454', walkanim: 'dagganoth_walk_quickly', readyanim: 'horror_dagannoth_ready',
      resizeh: '60', resizev: '60', op2: 'Attack', vislevel: '42', hitpoints: '35',
      attack: '50', strength: '35', defence: '25'
    },
    params: ['slayer_category,^slayer_dagannoth']
  }
};

async function run() {
  process.env.NODE_MEMBERS = 'true';
  process.chdir(engineRoot);

  const World = (await load('src/engine/World.ts')).default;
  const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
  const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
  const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
  const ServerTriggerType = (await load('src/engine/script/ServerTriggerType.ts')).default;
  const Npc = (await load('src/engine/entity/Npc.ts')).default;
  const Player = (await load('src/engine/entity/Player.ts')).default;
  const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
  const { NpcStat } = await load('src/engine/entity/NpcStat.ts');
  const { PlayerStat } = await load('src/engine/entity/PlayerStat.ts');
  const { NpcMode } = await load('src/engine/entity/NpcMode.ts');
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

  const npcConfig = path.join(contentRoot, 'scripts/areas/area_waterbirth/configs/waterbirth_eggs.npc');
  const local = readNpcBlocks(npcConfig, true);
  const unpack = readNpcBlocks(path.join(contentRoot, 'scripts/_unpack/377/all.npc'));
  for (const [name, expected] of Object.entries(originalNpcFields)) {
    assert(!unpack.has(name), `${name}: duplicate definition remains in unpack`);
    const moved = local.get(name);
    assert(moved, `missing moved NPC block ${name}`);
    for (const [field, value] of Object.entries(expected.fields)) {
      assert.equal(moved.fields.get(field), value, `${name}: original client/server field ${field}`);
    }
    for (const param of expected.params ?? []) {
      assert(moved.params.includes(param), `${name}: original param ${param}`);
    }
  }
  assert(!local.has('jb_baby_dagganoth'), 'the distinct fledgeling must not be added to this slice');

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

  const egg1Type = configs.NpcType.getByName('dungeon_dagganoth_egg1');
  const egg2Type = configs.NpcType.getByName('dungeon_dagganoth_egg2');
  const egg3Type = configs.NpcType.getByName('dungeon_dagganoth_egg3');
  const spawnType = configs.NpcType.getByName('dagganoth_critter');
  assert(egg1Type && egg2Type && egg3Type && spawnType, 'moved NPC types must compile');
  for (const [name, type] of Object.entries({
    dungeon_dagganoth_egg1: egg1Type,
    dungeon_dagganoth_egg2: egg2Type,
    dungeon_dagganoth_egg3: egg3Type,
    dagganoth_critter: spawnType
  })) {
    assert.equal(type.name, originalNpcFields[name].fields.name, `${name}: compiled display name`);
    assert.equal(type.models?.length, 1, `${name}: original single-model identity is compiled`);
  }
  assert.equal(egg1Type.resizeh, 100);
  assert.equal(egg1Type.resizev, 100);
  assert.equal(egg1Type.turnspeed, 0);
  assert.equal(egg1Type.minimap, false);
  assert.equal(egg1Type.huntrange, readConstant('scripts/areas/area_waterbirth/configs/waterbirth_eggs.constant', 'waterbirth_egg_hunt_radius'));
  assert.equal(egg1Type.huntrange, 1, 'egg hunt radius is the accepted UNKNOWN one-tile engineering value');

  const openingSeq = configs.SeqType.getByName('dagganoth_egg_open');
  assert(openingSeq, 'original opening sequence must compile');
  assert.equal(openingSeq.frameCount, 16, 'original opening sequence frame count');
  assert.equal(openingSeq.duration, 96, 'sum of original delay1..delay16 values');
  assert.equal(egg2Type.walkanim, openingSeq.id);
  assert.equal(egg2Type.readyanim, openingSeq.id);
  const worldTickMs = 600;
  const clientFrameMs = 20;
  const displayTicks = Math.ceil(openingSeq.duration * clientFrameMs / worldTickMs);
  assert.equal(displayTicks, 4, 'original 96 delay units occupy four 600ms native ticks');
  assert.equal(readConstant('scripts/areas/area_waterbirth/configs/waterbirth_eggs.constant', 'waterbirth_egg_hatch_display_ticks'), displayTicks);

  const eggHunt = configs.HuntType.get(egg1Type.huntmode);
  assert(eggHunt, 'native egg hunt config must compile');
  assert.equal(eggHunt.type, 1, 'egg proximity uses the native player hunt type');
  assert.equal(eggHunt.checkVis, 1, 'egg proximity retains native line-of-sight visibility');
  assert.equal(eggHunt.findKeepHunting, false, 'one native hunt dispatch per closed-egg state');
  assert.equal(eggHunt.findNewMode, NpcMode.QUEUE4, 'egg proximity dispatches native queue4');

  const resetTicks = readConstant('scripts/areas/area_waterbirth/configs/waterbirth_eggs.constant', 'waterbirth_egg_reset_ticks');
  assert.equal(resetTicks, 500, 'later five-minute candidate is 500 native ticks');
  assert.equal(spawnType.huntrange, readConstant('scripts/areas/area_waterbirth/configs/waterbirth_eggs.constant', 'waterbirth_spawn_hunt_radius'),
    'Spawn aggression uses its own named UNKNOWN engineering radius');
  assert.equal(spawnType.stats[NpcStat.HITPOINTS], 35, 'CANDIDATE current exact-variant HP');
  assert.equal(spawnType.stats[NpcStat.ATTACK], 50, 'CANDIDATE current exact-variant attack');
  assert.equal(spawnType.stats[NpcStat.STRENGTH], 35, 'CANDIDATE current exact-variant strength');
  assert.equal(spawnType.stats[NpcStat.DEFENCE], 25, 'CANDIDATE current exact-variant defence');
  assert.equal(param(spawnType, 'damagetype'), readConstant('scripts/skill_combat/configs/combat_damagetypes.constant', 'stab_style'));
  assert.equal(param(spawnType, 'attackrate'), 4, 'CANDIDATE current exact-variant attack speed');
  const attackAnimParam = configs.ParamType.getByName('attack_anim');
  assert(attackAnimParam, 'native attack animation parameter must exist');
  assert.equal(spawnType.params.has(attackAnimParam.id), false, 'no unsupported Spawn attack animation is selected');
  assert(!local.get('dagganoth_critter').params.some(value => value.startsWith('attack_anim,')),
    'no candidate attack animation is invented in content');
  const spawnHunt = configs.HuntType.get(spawnType.huntmode);
  assert(spawnHunt, 'candidate aggressive Spawn hunt must compile');
  assert.equal(spawnHunt.findNewMode, NpcMode.OPPLAYER2, 'Spawn uses ordinary melee attack dispatch');
  const maxHitProc = ScriptProvider.getByName('[proc,npc_melee_maxhit]');
  assert(maxHitProc, 'native melee max-hit procedure must be packed');

  const exact = (trigger, type) => ScriptProvider.getByTriggerSpecific(trigger, type.id);
  const egg1Queue4 = exact(ServerTriggerType.AI_QUEUE4, egg1Type);
  const egg2Queue1 = exact(ServerTriggerType.AI_QUEUE1, egg2Type);
  assert(egg1Queue4, 'compiled exact egg1 queue4 hatch trigger');
  assert(egg2Queue1, 'compiled exact egg2 queue1 hatch-complete trigger');
  assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE4, egg1Type.id, egg1Type.category), egg1Queue4);
  assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE1, egg2Type.id, egg2Type.category), egg2Queue1);
  const generic = (trigger, type) => ScriptProvider.getByTriggerSpecific(trigger, -1, type.category);
  assert.equal(ScriptProvider.getByTrigger(ServerTriggerType.AI_OPPLAYER2, spawnType.id, spawnType.category), generic(ServerTriggerType.AI_OPPLAYER2, spawnType), 'Spawn keeps generic native melee attacks');
  const spawnDeath = ScriptProvider.getByTriggerSpecific(ServerTriggerType.AI_QUEUE3, spawnType.id);
  assert(spawnDeath, 'Spawn has a packed native death-and-Bones trigger');
  assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, spawnType.id, spawnType.category), spawnDeath,
    'native death dispatch selects the Spawn Bones trigger');

  World.currentTick = 1000;
  World.gameMap.init();
  World.processNpcEventQueue();
  const initialEggs = [...World.npcs].filter(npc => npc.isActive && npc.type === egg1Type.id);
  assert(initialEggs.length > 0, 'built Waterbirth maps must contain the original closed eggs');

  const directions = [
    { dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 }
  ];
  let site = null;
  for (const egg of initialEggs) {
    for (const { dx, dz } of directions) {
      const inside = { level: egg.level, x: egg.x + dx, z: egg.z + dz };
      const outside = { level: egg.level, x: egg.x + dx * 2, z: egg.z + dz * 2 };
      if (
        isLineOfWalk(egg.level, egg.x, egg.z, inside.x, inside.z) &&
        isLineOfSight(egg.level, egg.x, egg.z, inside.x, inside.z) &&
        isLineOfWalk(egg.level, egg.x, egg.z, outside.x, outside.z) &&
        isLineOfSight(egg.level, egg.x, egg.z, outside.x, outside.z)
      ) {
        site = { egg, inside, outside };
        break;
      }
    }
    if (site) break;
  }
  assert(site, 'built Waterbirth maps must provide a visible walkable outside/adjacent test site');

  let serial = 0;
  const slot = 1;
  const hash = BigInt(1000 + ++serial);
  const actor = new Player(`waterbirthEgg${serial}`, hash, hash);
  actor.slot = slot;
  actor.pid = slot;
  actor.uid = ((Number(hash & 0x1fffffn) << 11) | slot) >>> 0;
  actor.isActive = true;
  actor.level = site.outside.level;
  actor.x = site.outside.x;
  actor.z = site.outside.z;
  actor.vars.fill(0);
  actor.baseLevels.fill(1);
  actor.levels.fill(1);
  const fixtureHitpoints = 99;
  actor.baseLevels[PlayerStat.HITPOINTS] = fixtureHitpoints;
  actor.levels[PlayerStat.HITPOINTS] = fixtureHitpoints;
  actor.getInventory(configs.InvType.getId('worn'));
  actor.getInventory(configs.InvType.getId('inventory'));
  actor.write = () => {};
  actor.messageGame = () => {};
  World.players[slot] = actor;
  World.playerLoop.add(hash, actor);
  World.gameMap.getZone(actor.x, actor.z, actor.level).enter(actor);
  assert.strictEqual(World.getPlayerByHash64(hash), actor, 'player is registered in native hunt iteration');

  const egg = site.egg;
  const activeSpawnAtEgg = () => [...World.npcs].filter(npc =>
    npc.isActive && npc.type === spawnType.id && npc.level === egg.level &&
    Math.max(Math.abs(npc.x - egg.x), Math.abs(npc.z - egg.z)) <= 4
  );
  const step = () => {
    World.currentTick++;
    // World.processWorld hunts players before processNpcs turns. Exercise that
    // native phase explicitly: this fixture has no client observer bookkeeping.
    for (const npc of [egg, ...activeSpawnAtEgg()]) {
      if (npc.isActive && npc.huntMode !== -1) npc.huntAll(configs.HuntType.get(npc.huntMode));
    }
    if (egg.isActive) egg.turn();
    for (const spawn of activeSpawnAtEgg()) spawn.turn();
    World.processNpcEventQueue();
    actor.processQueues();
    const active = activeSpawnAtEgg();
    assert(active.length <= 1, 'one egg must never accumulate concurrent Spawns');
    return active;
  };
  const originalRemoveNpc = World.removeNpc;
  const removals = [];
  World.removeNpc = function (npc, duration) {
    removals.push({ id: npc.nid, duration, lifecycle: npc.lifecycle, tick: World.currentTick });
    return originalRemoveNpc.call(this, npc, duration);
  };
  const originalAddObj = World.addObj;
  const drops = [];
  World.addObj = function (object, receiver, duration) {
    drops.push({ object, receiver, duration, tick: World.currentTick });
    return originalAddObj.call(this, object, receiver, duration);
  };
  const movePlayer = coord => {
    World.gameMap.getZone(actor.x, actor.z, actor.level).leave(actor);
    actor.level = coord.level;
    actor.x = coord.x;
    actor.z = coord.z;
    World.gameMap.getZone(actor.x, actor.z, actor.level).enter(actor);
  };
  const withMaxRandom = callback => {
    const original = JavaRandom.nextDouble;
    JavaRandom.nextDouble = () => 0.999999;
    try { return callback(); }
    finally { JavaRandom.nextDouble = original; }
  };
  const beginHatch = () => {
    movePlayer(site.inside);
    withMaxRandom(() => step());
    assert.equal(egg.type, egg2Type.id, 'native proximity hunt changes closed egg to hatching form');
    assert.equal(egg.animId, openingSeq.id, 'hatching uses the original opening sequence');
    assert.equal(egg.huntMode, -1, 'queue4 consumes the hunt so hatching cannot repeat');
    assert.equal(activeSpawnAtEgg().length, 0, 'Spawn is not created before the opening display ends');
    const queued = [...egg.queue.all()];
    assert.equal(queued.length, 1, 'exactly one native hatch-complete event is queued');
    assert.equal(queued[0].delay, displayTicks, 'same-turn queue decrement is included in display timing');
    for (let elapsed = 1; elapsed <= displayTicks; elapsed++) {
      const active = withMaxRandom(() => step());
      if (elapsed < displayTicks) {
        assert.equal(egg.type, egg2Type.id, `hatching form remains through display tick ${elapsed}`);
        assert.equal(active.length, 0, `no early Spawn on display tick ${elapsed}`);
      } else {
        assert.equal(egg.type, egg3Type.id, 'hatch-complete event changes to opened shell');
        assert.equal(active.length, 1, 'hatch-complete event creates one native Spawn');
      }
    }
    assert.equal(egg.lifecycleTick, resetTicks, 'shell reset timer starts at the hatch-complete event');
    return { spawn: activeSpawnAtEgg()[0], hatchCompleteTick: World.currentTick };
  };

  const originalRandom = JavaRandom.nextDouble;
  try {
    assert.equal(egg.type, egg1Type.id, 'selected map NPC begins as original closed egg');
    assert.equal(Math.max(Math.abs(actor.x - egg.x), Math.abs(actor.z - egg.z)), 2);
    step();
    assert.equal(egg.type, egg1Type.id, 'no hatch occurs outside the one-tile hunt radius');
    assert.equal(activeSpawnAtEgg().length, 0, 'no outside-radius Spawn');

    const prayer = id(configs.VarPlayerType, 'prayer14');
    actor.setVar(prayer, 1);
    const firstHatch = beginHatch();
    const child = firstHatch.spawn;
    assert.equal(child.lifecycle, EntityLifeCycle.DESPAWN, 'npc_add gives the child native bounded despawn lifecycle');
    assert.equal(child.lifecycleTick, resetTicks, 'same-tick first child turn is offset to the shell reset boundary');
    withMaxRandom(() => step()); // A newborn first participates in the next world hunt phase.
    assert.strictEqual(child.target, actor, 'candidate aggressive Spawn selects the nearby player natively');
    assert.equal(child.targetOp, NpcMode.OPPLAYER2, 'candidate Spawn selects ordinary melee mode');
    const maxHitState = ScriptRunner.init(maxHitProc, child);
    child.executeScript(maxHitState);
    assert.equal(maxHitState.execution, ScriptState.FINISHED, 'native melee max-hit procedure completes');
    assert.deepEqual(maxHitState.intStack.slice(0, maxHitState.isp), [4], 'candidate stats yield native max hit 4');
    assert.equal(actor.levels[PlayerStat.HITPOINTS], fixtureHitpoints, 'ordinary native protection prevents the first melee hit');

    actor.setVar(prayer, 0);
    const hpBeforeHit = actor.levels[PlayerStat.HITPOINTS];
    for (let attempt = 0; attempt < 6 && actor.levels[PlayerStat.HITPOINTS] === hpBeforeHit; attempt++) {
      withMaxRandom(() => step());
    }
    assert.equal(hpBeforeHit - actor.levels[PlayerStat.HITPOINTS], 4, 'ordinary native Spawn attack deals its candidate max hit');
    const actionDelay = id(configs.VarNpcType, 'npc_action_delay');
    assert.equal(child.getVar(actionDelay), World.currentTick + 4, 'ordinary NPC action delay uses candidate four-tick attack rate');

    // Exercise the ordinary packed damage and death queues; the egg hatch itself is never called manually.
    const childId = child.nid;
    child.heroPoints.addHero(actor.hash64, child.levels[NpcStat.HITPOINTS]);
    child.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, child.levels[NpcStat.HITPOINTS]);
    for (let tick = 0; tick < 8 && child.isActive; tick++) step();
    assert.equal(child.isActive, false, 'ordinary NPC damage/death queue removes a killed temporary Spawn');
    assert.equal(World.npcs.get(childId), undefined, 'native death cleanup releases the Spawn list entry');
    assert.equal(activeSpawnAtEgg().length, 0, 'a killed Spawn does not leave a duplicate child');
    assert.equal(drops.length, 1, 'a credited Spawn kill creates exactly one selected reward');
    assert.equal(drops[0].object.type, id(configs.ObjType, 'bones'), 'candidate guaranteed Spawn reward is Bones');
    assert.equal(drops[0].object.count, 1, 'Spawn kill drops one Bones');
    assert.strictEqual(drops[0].receiver, actor, 'native hero owns the Bones drop');

    movePlayer(site.outside);
    const elapsedBeforeLeaving = World.currentTick - firstHatch.hatchCompleteTick;
    assert(elapsedBeforeLeaving < resetTicks, 'death path completes before the egg reset');
    assert.equal(egg.lifecycleTick, resetTicks - elapsedBeforeLeaving, 'shell timer advances from hatch-complete');
    for (let elapsed = elapsedBeforeLeaving + 1; elapsed < resetTicks; elapsed++) {
      step();
      assert.equal(egg.type, egg3Type.id, `opened shell remains before reset boundary ${elapsed}`);
      assert.equal(egg.lifecycleTick, resetTicks - elapsed, `native shell timer at tick ${elapsed}`);
    }
    assert.equal(egg.lifecycleTick, 1, 'shell has one native tick left before reset');
    assert.equal(World.currentTick, firstHatch.hatchCompleteTick + resetTicks - 1,
      'elapsed ticks are measured from the hatch-complete event');
    step();
    assert.equal(World.currentTick, firstHatch.hatchCompleteTick + resetTicks,
      'the boundary is exactly 500 future native ticks');
    assert.equal(egg.type, egg1Type.id, 'closed egg returns on the exact reset boundary when player is outside');
    assert.equal(activeSpawnAtEgg().length, 0, 'no child remains after the first reset');

    // Leave the player adjacent over successive boundaries: one child per hatch, and expiry is immediate mid-fight.
    actor.setVar(prayer, 0);
    const secondHatch = beginHatch();
    const secondChild = secondHatch.spawn;
    const secondChildId = secondChild.nid;
    const deathQueues = [];
    const enqueueScript = secondChild.enqueueScript;
    secondChild.enqueueScript = function (queueId, ...args) {
      deathQueues.push(queueId);
      return enqueueScript.call(this, queueId, ...args);
    };
    assert.equal(secondChild.target, null, 'newborn waits for the next native world hunt phase');
    assert.equal(secondChild.lifecycleTick, resetTicks, 'second child lifetime shares the egg reset boundary');
    const secondHatchTick = secondHatch.hatchCompleteTick;
    let secondDamage = 0;
    for (let elapsed = 1; elapsed < resetTicks; elapsed++) {
      const hpBefore = actor.levels[PlayerStat.HITPOINTS];
      step();
      secondDamage += hpBefore - actor.levels[PlayerStat.HITPOINTS];
      // Longevity-only fixture refill, after recording the ordinary unprotected damage.
      actor.levels[PlayerStat.HITPOINTS] = fixtureHitpoints;
      assert.equal(egg.type, egg3Type.id, `second shell remains before reset boundary ${elapsed}`);
      if (elapsed === 1) assert.strictEqual(secondChild.target, actor, 'next world hunt starts ordinary combat');
      assert.equal(secondChild.isActive, true, `Spawn remains present while its native lifetime is ${resetTicks - elapsed}`);
      assert.equal(activeSpawnAtEgg().length, 1, 'continuous proximity never accumulates multiple Spawns');
    }
    assert.equal(secondChild.lifecycleTick, 1, 'fighting Spawn has one native lifetime tick left');
    assert.strictEqual(secondChild.target, actor, 'Spawn remains engaged immediately before native expiry');
    assert(secondDamage > 0, 'candidate Spawn has exercised native attacks before expiry');
    step();
    assert.equal(World.currentTick, secondHatchTick + resetTicks, 'Spawn expires on the same 500-tick boundary as the egg');
    assert.equal(secondChild.isActive, false, 'native DESPAWN removes a Spawn even during combat');
    const expiry = removals.find(removal => removal.id === secondChildId);
    assert(expiry, 'native lifecycle must remove the fighting Spawn');
    assert.equal(expiry.duration, -1, 'native DESPAWN expiry is not the NPC death/respawn path');
    assert.equal(expiry.lifecycle, EntityLifeCycle.DESPAWN);
    assert.equal(expiry.tick, secondHatchTick + resetTicks, 'removal is on the exact egg reset boundary');
    assert(!deathQueues.includes(ServerTriggerType.AI_QUEUE3), 'native expiry does not invoke the NPC death trigger');
    assert.equal(drops.length, 1, 'native lifetime expiry creates no death loot');
    assert.equal(egg.type, egg1Type.id, 'closed Egg returns at 500 ticks before the next world hunt phase');
    assert.equal(activeSpawnAtEgg().length, 0, 'expiry is removal, not a death-trigger duplicate');
    step();
    assert.equal(egg.type, egg2Type.id, 'next native world hunt begins one new hatch while the player stays adjacent');
    for (let elapsed = 1; elapsed <= displayTicks; elapsed++) {
      const active = step();
      if (elapsed < displayTicks) assert.equal(active.length, 0, 'next hatch has no early child');
      else {
        assert.equal(egg.type, egg3Type.id, 'next hatch completes through the native queued event');
        assert.equal(active.length, 1, 'a new reset cycle creates one fresh child, not an accumulation');
      }
    }

    // Protect only the fixture after the unprotected combat/expiry control above.
    // Keep the player adjacent for three more complete live-child reset boundaries.
    actor.setVar(prayer, 1);
    for (let cycle = 3; cycle <= 5; cycle++) {
      const current = activeSpawnAtEgg()[0];
      assert(current, `cycle ${cycle} begins with its naturally hatched child`);
      const born = World.currentTick;
      assert.equal(current.lifecycleTick, resetTicks, `cycle ${cycle} starts with the full native lifetime`);
      for (let elapsed = 1; elapsed < resetTicks; elapsed++) {
        step();
        assert.equal(current.isActive, true, `cycle ${cycle} child remains before expiry ${elapsed}`);
        assert.equal(activeSpawnAtEgg().length, 1, `cycle ${cycle} has one child through tick ${elapsed}`);
      }
      assert.strictEqual(current.target, actor, `cycle ${cycle} remains in native protected combat before expiry`);
      step();
      assert.equal(World.currentTick, born + resetTicks, `cycle ${cycle} resets at exactly 500 ticks`);
      assert.equal(current.isActive, false, `cycle ${cycle} expires its old child`);
      assert.equal(egg.type, egg1Type.id, `cycle ${cycle} restores the closed Egg at the boundary`);
      assert.equal(activeSpawnAtEgg().length, 0, `cycle ${cycle} never overlaps old and new children`);
      step();
      assert.equal(egg.type, egg2Type.id, `cycle ${cycle} starts one hatch in the next native hunt phase`);
      for (let elapsed = 1; elapsed <= displayTicks; elapsed++) {
        const active = step();
        assert.equal(active.length, Number(elapsed === displayTicks), `cycle ${cycle} next-child display tick ${elapsed}`);
      }
    }

    const uncredited = activeSpawnAtEgg()[0];
    assert(uncredited, 'final reset provides a naturally hatched no-hero death control');
    uncredited.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, uncredited.levels[NpcStat.HITPOINTS]);
    for (let tick = 0; tick < 8 && uncredited.isActive; tick++) step();
    assert.equal(uncredited.isActive, false, 'uncredited Spawn still follows native death');
    assert.equal(drops.length, 1, 'no Bones reward is created without a native hero');
    console.log('RESULT PASS waterbirth-eggs native proximity, staged hatch, combat and lifecycle');
  } finally {
    JavaRandom.nextDouble = originalRandom;
    World.addObj = originalAddObj;
    for (const drop of drops) if (drop.object.isActive) World.removeObj(drop.object, -1);
    for (const spawn of activeSpawnAtEgg()) World.removeNpc(spawn, -1);
    if (egg.isActive) World.removeNpc(egg, -1);
    World.gameMap.getZone(actor.x, actor.z, actor.level).leave(actor);
    World.removeNpc = originalRemoveNpc;
    if (World.players[slot] === actor) World.players[slot] = null;
    actor.unlink();
  }
}

run().then(() => process.exit(0)).catch(error => {
  console.error(error);
  process.exit(1);
});
