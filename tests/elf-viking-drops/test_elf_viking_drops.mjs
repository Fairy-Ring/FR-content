#!/usr/bin/env node
/** Run the packed elf and Viking NPC paths through the real script engine. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engineRoot = path.resolve(process.env.HARNESS_ENGINE_DIR ?? path.resolve(contentRoot, '../engine'));
const packDir = path.resolve(process.env.HARNESS_PACK_DIR ?? path.join(engineRoot, 'data/pack'));
const importEngine = relative => import(pathToFileURL(path.join(engineRoot, relative)).href);
const load = async relative => (await importEngine(relative)).default;

function readNameMap(kind) {
  const entries = new Map();
  for (const line of readFileSync(path.join(contentRoot, 'pack', `${kind}.pack`), 'utf8').split(/\r?\n/)) {
    const match = /^(\d+)=(.+)$/.exec(line);
    if (match) {
      const id = Number(match[1]);
      assert(!entries.has(match[2]), `duplicate ${kind} name ${match[2]}`);
      entries.set(match[2], id);
    }
  }
  assert(entries.size > 0, `empty checked-out ${kind} name map`);
  return entries;
}

function readConstant(relative, name) {
  const expression = new RegExp(`^\\s*\\^${name}\\s*=\\s*(-?\\d+)\\s*(?:\/\/.*)?$`, 'gm');
  const matches = [...readFileSync(path.join(contentRoot, relative), 'utf8').matchAll(expression)];
  assert.equal(matches.length, 1, `expected one ${name} constant in ${relative}`);
  return Number(matches[0][1]);
}

async function run() {
  const maps = Object.fromEntries(['npc', 'obj', 'category', 'varp', 'varn', 'seq', 'spotanim', 'synth']
    .map(kind => [kind, readNameMap(kind)]));
  const byId = Object.fromEntries(Object.entries(maps).map(([kind, entries]) => [kind,
    new Map([...entries].map(([name, id]) => [id, name]))]));
  const id = (kind, name) => {
    const value = maps[kind].get(name);
    assert.notEqual(value, undefined, `missing packed ${kind} name ${name}`);
    return value;
  };

  const configs = {};
  for (const name of [
    'VarPlayerType', 'VarBitType', 'VarNpcType', 'ParamType', 'ObjType', 'LocType', 'NpcType', 'InvType',
    'CategoryType', 'EnumType', 'StructType', 'SeqType', 'MesanimType', 'DbTableType', 'DbRowType',
    'Component', 'FontType', 'SpotanimType'
  ]) {
    configs[name] = await load(`src/cache/config/${name}.ts`);
    configs[name].load(packDir);
  }
  const DbTableIndex = await load('src/cache/config/DbTableIndex.ts');
  DbTableIndex.init();

  const World = await load('src/engine/World.ts');
  const ScriptProvider = await load('src/engine/script/ScriptProvider.ts');
  const ScriptRunner = await load('src/engine/script/ScriptRunner.ts');
  const ScriptState = await load('src/engine/script/ScriptState.ts');
  const ServerTriggerType = await load('src/engine/script/ServerTriggerType.ts');
  const Player = await load('src/engine/entity/Player.ts');
  const Npc = await load('src/engine/entity/Npc.ts');
  const NpcMode = (await importEngine('src/engine/entity/NpcMode.ts')).NpcMode;
  const Interaction = (await importEngine('src/engine/entity/Interaction.ts')).Interaction;
  const EntityLifeCycle = (await importEngine('src/engine/entity/EntityLifeCycle.ts')).EntityLifeCycle;
  const NpcStat = (await importEngine('src/engine/entity/NpcStat.ts')).NpcStat;
  const JavaRandom = (await importEngine('src/util/JavaRandom.ts')).default;

  const loadedScripts = ScriptProvider.load(packDir);
  assert(loadedScripts > 0, 'no packed scripts loaded');

  for (const [kind, names] of Object.entries({
    npc: ['regicide_darkelf', 'regicide_darkelf2', 'viking_guard', 'viking_guard2',
      'farming_market_guard', 'mourning_guard_range'],
    obj: ['bones', 'coins', 'dragonhide_body', 'dragonhide_chaps', 'mithril_spear',
      'mithril_kiteshield', 'adamant_full_helm', 'rune_dagger', 'waterrune', 'naturerune',
      'lawrune', 'firerune', 'unidentified_guam', 'bass', 'shark', 'adamantite_ore',
      'uncut_sapphire', 'trail_clue_hard_map001', 'trail_clue_medium_map001',
      'elf_crystal_tiny', 'mourning_teleport_crystal_1', 'lobster',
      'iron_warhammer', 'bronze_warhammer', 'steel_warhammer', 'black_warhammer',
      'viking_sword', 'viking_shield', 'viking_helmet', 'keg_of_beer', 'cake', 'iron_ore',
      'copper_ore', 'bucket_water', 'fur', 'tin_ore', 'raw_sardine', 'beer', 'ring_mould'],
    category: ['elf_warrior'],
    varp: ['viking'],
    varn: ['npc_aggressive_player'],
    seq: ['human_bow', 'human_spear_spike'],
    spotanim: ['sp_attack_glow_arrow_launch', 'sp_attack_glow_arrow_travel'],
    synth: ['crystal_bow2', 'crystal_polearm']
  })) {
    for (const name of names) id(kind, name);
  }

  const paramId = name => {
    const value = configs.ParamType.getId(name);
    assert(value >= 0, `missing packed param ${name}`);
    return value;
  };
  const invId = configs.InvType.getId('inv');
  const vikingVarp = id('varp', 'viking');
  const aggressiveVar = id('varn', 'npc_aggressive_player');
  const elfCategory = id('category', 'elf_warrior');
  const vikingComplete = readConstant('scripts/general/configs/quest.constant', 'viking_complete');
  const vikingNotStarted = readConstant('scripts/quests/quest_viking/configs/quest_viking.constant', 'viking_not_started');
  const vikingStarted = readConstant('scripts/quests/quest_viking/configs/quest_viking.constant', 'viking_started');
  assert(configs.VarPlayerType.getId('viking') === vikingVarp, 'viking varp name map mismatch');
  assert(configs.VarNpcType.getId('npc_aggressive_player') === aggressiveVar, 'aggressive-player varn name map mismatch');
  assert(configs.CategoryType.getId('elf_warrior') === elfCategory, 'elf_warrior category name map mismatch');
  assert(invId >= 0, 'missing player inventory config');

  const triggerNames = [
    ServerTriggerType.AI_QUEUE1,
    ServerTriggerType.AI_OPPLAYER2,
    ServerTriggerType.AI_APPLAYER2,
    ServerTriggerType.AI_QUEUE3
  ];
  const triggerName = new Map([
    [ServerTriggerType.AI_QUEUE1, 'ai_queue1'],
    [ServerTriggerType.AI_OPPLAYER2, 'ai_opplayer2'],
    [ServerTriggerType.AI_APPLAYER2, 'ai_applayer2'],
    [ServerTriggerType.AI_QUEUE3, 'ai_queue3']
  ]);
  const elfNpcNames = ['regicide_darkelf', 'regicide_darkelf2'];
  const guardNpcNames = ['viking_guard', 'viking_guard2'];

  const categoryMembers = configs.NpcType.configs
    .filter(type => type.category === elfCategory)
    .map(type => byId.npc.get(type.id))
    .sort();
  assert.deepEqual(categoryMembers, [...elfNpcNames].sort(), 'elf_warrior category membership changed');
  const elfDeath = ScriptProvider.getByTriggerSpecific(ServerTriggerType.AI_QUEUE3, -1, elfCategory);
  assert(elfDeath, 'missing _elf_warrior ai_queue3 script');

  const checkedTriggerKeys = new Set([`${ServerTriggerType.AI_QUEUE3}:category:${elfCategory}`]);
  for (const npcName of elfNpcNames) {
    const npcId = id('npc', npcName);
    const type = configs.NpcType.getByName(npcName);
    assert(type && type.id === npcId, `packed NPC lookup mismatch for ${npcName}`);
    assert.equal(type.category, elfCategory, `${npcName} category`);
    for (const trigger of triggerNames.slice(0, 3)) {
      const exact = ScriptProvider.getByTriggerSpecific(trigger, npcId);
      assert(exact, `missing exact ${triggerName.get(trigger)} trigger for ${npcName}`);
      assert.strictEqual(ScriptProvider.getByTrigger(trigger, npcId, type.category), exact,
        `${triggerName.get(trigger)} selection for ${npcName}`);

      checkedTriggerKeys.add(`${trigger}:${npcId}`);
    }
    assert.equal(ScriptProvider.getByTriggerSpecific(ServerTriggerType.AI_QUEUE3, npcId), undefined,
      `${npcName} unexpectedly has an exact death trigger`);
    assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, npcId, type.category), elfDeath,
      `${npcName} did not select the _elf_warrior death trigger`);
  }

  for (const npcName of guardNpcNames) {
    const npcId = id('npc', npcName);
    const type = configs.NpcType.getByName(npcName);
    assert(type && type.id === npcId, `packed NPC lookup mismatch for ${npcName}`);
    const exact = ScriptProvider.getByTriggerSpecific(ServerTriggerType.AI_QUEUE3, npcId);
    assert(exact, `missing exact ai_queue3 trigger for ${npcName}`);
    assert.strictEqual(ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, npcId, type.category), exact,
      `ai_queue3 selection for ${npcName}`);

    checkedTriggerKeys.add(`${ServerTriggerType.AI_QUEUE3}:${npcId}`);
  }

  for (const npcName of ['farming_market_guard', 'mourning_guard_range']) {
    const npcId = id('npc', npcName);
    const type = configs.NpcType.getByName(npcName);
    assert(type && type.id === npcId, `packed NPC lookup mismatch for ${npcName}`);
    assert.equal(type.category, -1, `${npcName} must retain its non-category default`);
    for (const trigger of triggerNames) {
      assert.equal(ScriptProvider.getByTriggerSpecific(trigger, npcId), undefined,
        `${npcName} unexpectedly has a dedicated ${triggerName.get(trigger)} trigger`);
      assert.strictEqual(ScriptProvider.getByTrigger(trigger, npcId, type.category),
        ScriptProvider.getByTriggerSpecific(trigger), `${npcName} ${triggerName.get(trigger)} fallback changed`);
    }
  }
  assert.equal(checkedTriggerKeys.size, 9, 'expected nine exact and category trigger selections');

  function npcParam(type, name) {
    return type.params.get(paramId(name));
  }
  const archerType = configs.NpcType.getByName('regicide_darkelf');
  const pikemanType = configs.NpcType.getByName('regicide_darkelf2');
  assert.equal(archerType.attackrange, 8, 'dark elf archer range');
  assert.equal(npcParam(archerType, 'attack_anim'), id('seq', 'human_bow'));
  assert.equal(npcParam(archerType, 'rangeattack_sound'), id('synth', 'crystal_bow2'));
  assert.equal(npcParam(archerType, 'proj_launch'), id('spotanim', 'sp_attack_glow_arrow_launch'));
  assert.equal(npcParam(archerType, 'proj_travel'), id('spotanim', 'sp_attack_glow_arrow_travel'));
  assert.equal(pikemanType.attackrange, 2, 'dark elf pikeman range');
  assert.equal(npcParam(pikemanType, 'attack_anim'), id('seq', 'human_spear_spike'));
  assert.equal(npcParam(pikemanType, 'attack_sound'), id('synth', 'crystal_polearm'));
  assert.equal(npcParam(pikemanType, 'proj_launch'), undefined, 'pikeman must not launch a projectile');
  assert.equal(npcParam(pikemanType, 'proj_travel'), undefined, 'pikeman must not travel a projectile');

  const tables = [
    {
      key: 'elf', names: elfNpcNames, clueEnum: 'trail_hard_enum',
      clueItem: 'trail_clue_hard_map001', clueMainRoll: 46, emptyFrom: 102, emptyTail: 26,
      rows: [
        [0, 4, 'dragonhide_body', 1], [4, 7, 'dragonhide_chaps', 1], [7, 9, 'mithril_spear', 1],
        [9, 10, 'mithril_kiteshield', 1], [10, 11, 'adamant_full_helm', 1], [11, 12, 'rune_dagger', 1],
        [12, 20, 'waterrune', 70], [20, 25, 'naturerune', 12], [25, 28, 'lawrune', 2],
        [28, 31, 'firerune', 37], [31, 46, 'herb', 1], [46, 75, 'coins', 44],
        [75, 85, 'coins', 180], [85, 90, 'coins', 20], [90, 93, 'bass', 1], [93, 96, 'shark', 1],
        [96, 97, 'adamantite_ore', 1], [97, 102, 'jewel', 1]
      ]
    },
    {
      key: 'viking', names: guardNpcNames, clueEnum: 'trail_medium_enum',
      clueItem: 'trail_clue_medium_map001', clueMainRoll: 16, emptyFrom: 95, emptyTail: 33,
      rows: [
        [0, 6, 'iron_warhammer', 1], [6, 9, 'bronze_warhammer', 1], [9, 10, 'steel_warhammer', 1],
        [10, 11, 'black_warhammer', 1], [11, 12, 'viking_sword', 1, true], [12, 13, 'viking_shield', 1, true],
        [13, 14, 'viking_helmet', 1, true], [14, 16, 'herb', 1], [16, 58, 'coins', 15],
        [58, 67, 'coins', 22], [67, 72, 'coins', 17], [72, 75, 'coins', 27], [75, 79, 'keg_of_beer', 1],
        [79, 83, 'cake', 1], [83, 86, 'iron_ore', 2], [86, 88, 'copper_ore', 5],
        [88, 89, 'bucket_water', 1], [89, 90, 'fur', 1], [90, 91, 'tin_ore', 1],
        [91, 92, 'raw_sardine', 1], [92, 93, 'beer', 1], [93, 94, 'ring_mould', 1], [94, 95, 'jewel', 1]
      ]
    }
  ];
  // Published bands remain the oracle except the selected pikeman coin amount.
  const publishedTables = tables.map(table => ({ ...table, rows: [...table.rows] }));
  const additions = [
    { key: 'archer', names: ['regicide_darkelf'], emptyFrom: 110, emptyTail: 18, highCoinAward: 180,
      rows: [
        [102, 103, 'dragon_vambraces', 1], [103, 105, 'airrune', 10],
        [105, 106, 'poisonivy_bush_seed', 1], [106, 107, 'cactus_seed', 1], [107, 108, 'belladonna_seed', 1],
        [108, 109, 'elf_crystal_tiny', 1], [109, 110, 'lobster', 1]
      ] },
    { key: 'pikeman', names: ['regicide_darkelf2'], emptyFrom: 109, emptyTail: 19, highCoinAward: 220,
      rows: [
        [102, 103, 'rune_med_helm', 1], [103, 104, 'poisonivy_bush_seed', 1],
        [104, 105, 'cactus_seed', 1], [105, 106, 'belladonna_seed', 1],
        [106, 107, 'elf_crystal_tiny', 1], [107, 108, 'mourning_teleport_crystal_1', 1],
        [108, 109, 'lobster', 1]
      ] }
  ];
  const elfTable = tables.shift();
  tables.unshift(...additions.map(({ highCoinAward, ...addition }) => {
    const inheritedRows = elfTable.rows.map(row => row[2] === 'coins' && row[3] === 180
      ? [row[0], row[1], row[2], highCoinAward]
      : row);
    return { ...elfTable, ...addition, rows: [...inheritedRows, ...addition.rows] };
  }));
  tables[2] = { ...tables[2], emptyFrom: 96, emptyTail: 32,
    rows: [...tables[2].rows, [95, 96, 'steel_bar', 1]] };
  for (const table of tables) {
    const enumType = configs.EnumType.getByName(table.clueEnum);
    assert(enumType, `missing ${table.clueEnum}`);
    assert.equal(enumType.values.get(0), id('obj', table.clueItem), `${table.clueEnum} first map clue`);
    const covered = table.rows.flatMap(([start, end]) => Array.from({ length: end - start }, (_, i) => start + i));
    assert.deepEqual(covered, Array.from({ length: table.emptyFrom }, (_, i) => i), `${table.key} roll coverage`);
    assert.equal(128 - table.emptyFrom, table.emptyTail, `${table.key} empty-tail count`);
    for (const row of table.rows) {
      if (row[2] === 'herb') id('obj', 'unidentified_guam');
      else if (row[2] === 'jewel') id('obj', 'uncut_sapphire');
      else id('obj', row[2]);
    }
  }

  const originalTick = World.currentTick;
  const originalAddObj = World.addObj;
  const originalMapProjAnim = World.mapProjAnim;
  const originalNextDouble = JavaRandom.nextDouble;
  let objectCapture = null;
  let projectileCapture = null;
  let activeRandomDraws = null;
  let serial = 0;
  World.currentTick = 10;
  World.addObj = function (obj, receiver, duration) {
    if (objectCapture) {
      objectCapture.push({ id: obj.type, count: obj.count, receiver: receiver?.toString() ?? null, object: obj });
    }
    return originalAddObj.call(this, obj, receiver, duration);
  };
  World.mapProjAnim = function (...args) {
    if (projectileCapture) projectileCapture.push(args);
    return originalMapProjAnim.apply(this, args);
  };
  JavaRandom.nextDouble = function () {
    if (!activeRandomDraws) return originalNextDouble.call(this);
    const index = activeRandomDraws.index++;
    assert(index < activeRandomDraws.values.length,
      `${activeRandomDraws.label}: unexpected random draw ${index + 1}`);
    return activeRandomDraws.values[index] / 128;
  };

  function withRandomDraws(tracker, callback) {
    const previous = activeRandomDraws;
    activeRandomDraws = tracker;
    try {
      return callback();
    } finally {
      activeRandomDraws = previous;
    }
  }

  function addNpc(name, x, z, lifecycle = EntityLifeCycle.RESPAWN) {
    const type = configs.NpcType.getByName(name);
    const npc = new Npc(0, x, z, type.size, type.size, lifecycle, ++serial, type.id, type.blockwalk);
    World.addNpc(npc, -1);
    World.processNpcEventQueue();
    assert.strictEqual(World.npcs.get(npc.nid), npc, `${name} was not registered by World.addNpc`);
    npc.lastMovement = -100;
    return npc;
  }

  function addPlayer(x, z, vikingState = vikingNotStarted) {
    // Cases are sequential. Keep the player slot within the engine's 11-bit uid.
    const slot = 1;
    const hash = BigInt(1000 + ++serial);
    const actor = new Player(`elfviking${slot}`, hash, hash);
    actor.slot = slot;
    actor.pid = slot;
    actor.uid = ((Number(hash & 0x1fffffn) << 11) | slot) >>> 0;
    actor.isActive = true;
    actor.level = 0;
    actor.x = x;
    actor.z = z;
    actor.vars.fill(0);
    actor.setVar(vikingVarp, vikingState);
    actor.baseLevels.fill(99);
    actor.levels.fill(99);
    const packets = [];
    actor.write = packet => packets.push(packet);
    World.players[slot] = actor;
    World.playerLoop.add(hash, actor);
    assert.strictEqual(World.getPlayerByHash64(hash), actor, 'player not registered in the live player loop');
    return actor;
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
    if (World.players[actor.slot] === actor) World.players[actor.slot] = null;
    actor.unlink();
  }

  function rowAt(table, roll) {
    return table.rows.find(([start, end]) => roll >= start && roll < end) ?? null;
  }

  function deathDrawValues(table, roll, { clue = 'miss', helper = 0, heldClue = false } = {}) {
    const values = [];
    if (!heldClue) {
      if (clue === 'hit') values.push(0, 0);
      else if (clue === 'hit-upper-edge') values.push(1 - Number.EPSILON, 0);
      else if (clue === 'miss') values.push(1);
      else assert.fail(`unknown clue mode ${clue}`);
    }
    values.push(roll);
    if (rowAt(table, roll)?.[2] === 'herb' || rowAt(table, roll)?.[2] === 'jewel') values.push(helper);
    return values;
  }

  function expectedRegular(table, roll, vikingState, helper) {
    const row = rowAt(table, roll);
    if (!row || (row[4] && vikingState !== vikingComplete)) return [];
    if (row[2] === 'herb') return [{ name: 'unidentified_guam', count: 1 }];
    if (row[2] === 'jewel') return helper === 127 ? [] : [{ name: 'uncut_sapphire', count: 1 }];
    return [{ name: row[2], count: row[3] }];
  }

  function assertDrops(label, records, actor, regular, clueName = null, noHero = false) {
    if (noHero) {
      assert.deepEqual(records, [], `${label}: no-hero drops`);
      return;
    }
    assert(actor, `${label}: missing registered hero`);
    assert(records.every(record => record.receiver === actor.hash64.toString()), `${label}: receiver hash`);
    const totals = new Map();
    for (const record of records) totals.set(record.id, (totals.get(record.id) ?? 0) + record.count);
    assert.equal(totals.get(id('obj', 'bones')), 1, `${label}: exactly one configured bones drop`);
    const clueRows = records.filter(record => /^trail_(?:clue|casket)_/.test(byId.obj.get(record.id) ?? ''));
    const expectedClueRows = clueName ? [{ name: clueName, count: 1 }] : [];
    assert.deepEqual(clueRows.map(record => ({ name: byId.obj.get(record.id), count: record.count })),
      expectedClueRows, `${label}: clue drop`);
    const regularTotals = new Map();
    for (const record of records) {
      const name = byId.obj.get(record.id);
      if (name === 'bones' || /^trail_(?:clue|casket)_/.test(name ?? '')) continue;
      regularTotals.set(name, (regularTotals.get(name) ?? 0) + record.count);
    }
    assert(regularTotals.size <= 1, `${label}: more than one regular-table result`);
    const actualRegular = [...regularTotals].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(actualRegular, regular.map(item => ({ ...item })).sort((a, b) => a.name.localeCompare(b.name)),
      `${label}: regular table result`);
  }

  function runDeathCase(table, npcName, roll, {
    vikingState = vikingNotStarted, clue = 'miss', helper = 0, heldClue = false,
    noHero = false, expectedClue = null, suffix = ''
  } = {}) {
    const label = `${table.key}:${npcName}:roll${roll}${suffix}`;
    const x = 3200;
    const z = 3200;
    let actor = null;
    let npc = null;
    const records = [];
    try {
      if (!noHero) actor = addPlayer(x + 1, z, vikingState);
      npc = addNpc(npcName, x, z);
      if (actor) {
        npc.setVar(aggressiveVar, actor.uid);
        npc.heroPoints.addHero(actor.hash64, npc.levels[NpcStat.HITPOINTS]);
        if (heldClue) actor.getInventory(invId).set(0, { id: id('obj', table.clueItem), count: 1 });
      }
      const type = configs.NpcType.getByName(npcName);
      const trigger = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, type.id, type.category);
      assert(trigger, `${label}: selected death trigger missing`);
      const state = ScriptRunner.init(trigger, npc);
      assert.equal(state._activeNpc2, null, `${label}: unexpected secondary NPC`);
      const draws = noHero ? [] : deathDrawValues(table, roll, { clue, helper, heldClue });
      const tracker = { label, values: draws, index: 0 };
      npc.applyDamage(npc.levels[NpcStat.HITPOINTS], 1);
      objectCapture = records;
      withRandomDraws(tracker, () => npc.executeScript(state));
      for (let tick = 0; state.execution === ScriptState.NPC_SUSPENDED && tick < 20; tick++) {
        if (actor && World.players[actor.slot] === actor) actor.processQueues();
        World.currentTick = Math.max(World.currentTick + 1, npc.delayedUntil);
        npc.delayed = false;
        withRandomDraws(tracker, () => npc.executeScript(state));
      }
      if (actor && World.players[actor.slot] === actor) actor.processQueues();
      assert.equal(state.execution, ScriptState.FINISHED, `${label}: death script did not finish`);
      assert(!npc.isActive && npc.lifecycleTick > 0, `${label}: NPC did not enter respawn state`);
      assert.equal(tracker.index, draws.length, `${label}: exact scheduled random draw count`);
      const expected = noHero ? [] : expectedRegular(table, roll, vikingState, helper);
      assertDrops(label, records, actor, expected, expectedClue, noHero);
      return records.map(record => ({ name: byId.obj.get(record.id), count: record.count }));
    } finally {
      objectCapture = null;
      for (const record of records) if (record.object.isActive) World.removeObj(record.object, -1);
      cleanupNpc(npc);
      cleanupPlayer(actor);
    }
  }

  function observeNpcMethod(npc, name, capture) {
    const hadOwn = Object.prototype.hasOwnProperty.call(npc, name);
    const original = npc[name];
    npc[name] = function (...args) {
      capture.push(args);
      return original.apply(this, args);
    };
    return () => {
      if (hadOwn) npc[name] = original;
      else delete npc[name];
    };
  }

  function runCombatRoute(npcName, route, distance) {
    const label = `${npcName}:${route}`;
    const x = 3200;
    const z = 3200;
    let actor = null;
    let npc = null;
    const animations = [];
    const spotanims = [];
    const projectiles = [];
    let restoreAnimation = () => {};
    let restoreSpotanim = () => {};
    try {
      actor = addPlayer(x + distance, z);
      npc = addNpc(npcName, x, z, EntityLifeCycle.DESPAWN);
      restoreAnimation = observeNpcMethod(npc, 'playAnimation', animations);
      restoreSpotanim = observeNpcMethod(npc, 'spotanim', spotanims);
      if (route === 'queue1') {
        npc.setVar(aggressiveVar, actor.uid);
        npc.enqueueScript(ServerTriggerType.AI_QUEUE1);
      } else {
        assert.equal(npc.setInteraction(Interaction.SCRIPT, actor, NpcMode.OPPLAYER2), true,
          `${label}: player interaction setup`);
        npc.targetOp = NpcMode.OPPLAYER2;
      }
      projectileCapture = projectiles;
      npc.turn();
      assert.equal(npc.targetOp, NpcMode.APPLAYER2, `${label}: did not select APPLAYER2`);
      assert.strictEqual(npc.target, actor, `${label}: did not retain the real player target`);
      const expectedAttack = npcName === 'regicide_darkelf' ? id('seq', 'human_bow') : id('seq', 'human_spear_spike');
      // Retaliation sets an action delay; advance real NPC turns until the first attack.
      for (let tick = 0; !animations.some(args => args[0] === expectedAttack) && tick < 20; tick++) {
        World.currentTick++;
        npc.turn();
      }
      assert(animations.some(args => args[0] === expectedAttack), `${label}: expected NPC attack animation`);
      const isArcher = npcName === 'regicide_darkelf';
      if (isArcher) {
        assert(spotanims.some(args => args[0] === id('spotanim', 'sp_attack_glow_arrow_launch')), `${label}: missing launch spotanim`);
        assert.equal(projectiles.length, 1, `${label}: ranged projectile count`);
        assert.equal(projectiles[0][6], id('spotanim', 'sp_attack_glow_arrow_travel'), `${label}: ranged travel spotanim`);
        assert(actor.queue.all().some(request => request.script?.name === '[queue,combat_damage_player]'),
          `${label}: real ranged hit did not enqueue combat_damage_player`);
      } else {
        assert.deepEqual(spotanims, [], `${label}: melee pikeman spotanims`);
        assert.deepEqual(projectiles, [], `${label}: melee pikeman projectiles`);
      }
    } finally {
      projectileCapture = null;
      restoreSpotanim();
      restoreAnimation();
      cleanupNpc(npc);
      cleanupPlayer(actor);
    }
  }

  try {
    // Optional differential run uses the retained, unmodified published binary pack.
    // Normal CI still pins those same original bands with the literal rows above.
    const published = new Map();
    if (process.env.ELFDROPS2_PUBLISHED_PACK) {
      ScriptProvider.load(path.resolve(process.env.ELFDROPS2_PUBLISHED_PACK));
      for (const table of publishedTables) {
        for (const npcName of table.names) {
          for (let roll = 0; roll < 128; roll++) {
            published.set(`${npcName}:${roll}`, runDeathCase(table, npcName, roll));
          }
        }
      }
      ScriptProvider.load(packDir);
      console.log(`PASS published-pack capture: ${published.size} real packed roll results`);
    }
    runCombatRoute('regicide_darkelf', 'queue1', 4);
    runCombatRoute('regicide_darkelf', 'opplayer2', 1);
    runCombatRoute('regicide_darkelf2', 'queue1', 1);
    runCombatRoute('regicide_darkelf2', 'opplayer2', 1);

    let emptyTailHits = 0;
    let rollChecks = 0;
    for (const table of tables) {
      for (const npcName of table.names) {
        const totals = new Map();
        for (let roll = 0; roll < 128; roll++) {
          if (roll >= table.emptyFrom) emptyTailHits++;
          const actual = runDeathCase(table, npcName, roll);
          const oldTable = publishedTables.find(row => row.names.includes(npcName));
          if (published.size) {
            const old = published.get(`${npcName}:${roll}`);
            if (npcName === 'regicide_darkelf2' && roll >= 75 && roll < 85) {
              assert.deepEqual(old.filter(item => item.name !== 'bones'), [{ name: 'coins', count: 180 }],
                `${npcName}:${roll}: published high-coin award`);
              assert.deepEqual(actual.filter(item => item.name !== 'bones'), [{ name: 'coins', count: 220 }],
                `${npcName}:${roll}: selected high-coin award`);
            } else if (roll < oldTable.emptyFrom || roll >= table.emptyFrom) {
              assert.deepEqual(actual, old, `${npcName}:${roll}: differs from published pack`);
            } else {
              assert.deepEqual(old, [{ name: 'bones', count: 1 }],
                `${npcName}:${roll}: new row did not consume an empty published slot`);
            }
          }
          if (roll >= oldTable.emptyFrom && roll < table.emptyFrom) {
            const regular = actual.filter(item => item.name !== 'bones');
            assert.equal(regular.length, 1, `${npcName}:${roll}: new row cardinality`);
            const item = regular[0];
            totals.set(item.name, (totals.get(item.name) ?? 0) + item.count);
          }
          rollChecks++;
        }
        const expectedTotals = table.key === 'archer'
          ? { dragon_vambraces: 1, airrune: 20, poisonivy_bush_seed: 1, cactus_seed: 1, belladonna_seed: 1,
            elf_crystal_tiny: 1, lobster: 1 }
          : table.key === 'pikeman'
            ? { rune_med_helm: 1, poisonivy_bush_seed: 1, cactus_seed: 1, belladonna_seed: 1,
              elf_crystal_tiny: 1, mourning_teleport_crystal_1: 1, lobster: 1 }
            : { steel_bar: 1 };
        assert.deepEqual(Object.fromEntries(totals), expectedTotals, `${npcName}: added item totals`);
        console.log(`PASS ${npcName}: ${table.emptyFrom} allocated/${table.emptyTail} empty; additions ${JSON.stringify(expectedTotals)}`);
      }
      for (const npcName of table.names) {
        runDeathCase(table, npcName, table.clueMainRoll, { clue: 'hit', expectedClue: table.clueItem, suffix: ':clue-hit' });
        runDeathCase(table, npcName, table.clueMainRoll, { clue: 'hit-upper-edge', expectedClue: table.clueItem, suffix: ':clue-1-in-128-upper-edge' });
        runDeathCase(table, npcName, table.clueMainRoll, { clue: 'miss', suffix: ':clue-miss' });
        runDeathCase(table, npcName, table.clueMainRoll, { heldClue: true, suffix: ':held-clue' });
        runDeathCase(table, npcName, table.clueMainRoll, { noHero: true, suffix: ':no-hero' });
      }
    }
    assert.equal(rollChecks, 4 * 128, 'every roll for both target types in both tables');
    assert.equal(emptyTailHits, 18 + 19 + 2 * 32, 'exact remaining empty allocations');

    for (const npcName of guardNpcNames) {
      for (const state of [vikingNotStarted, vikingStarted]) {
        for (const roll of [11, 12, 13]) {
          runDeathCase(tables[2], npcName, roll, { vikingState: state, suffix: `:viking-${state}-suppressed` });
        }
      }
      for (const [roll, item] of [[11, 'viking_sword'], [12, 'viking_shield'], [13, 'viking_helmet']]) {
        runDeathCase(tables[2], npcName, roll, { vikingState: vikingComplete, suffix: `:viking-complete-${item}` });
      }
      runDeathCase(tables[2], npcName, 94, { helper: 127, suffix: ':null-jewel' });
    }

    console.log(`PASS elf-viking-drops: ${rollChecks} exhaustive roll cases; 9 trigger selections; two real combat types`);
  } finally {
    objectCapture = null;
    projectileCapture = null;
    activeRandomDraws = null;
    World.addObj = originalAddObj;
    World.mapProjAnim = originalMapProjAnim;
    JavaRandom.nextDouble = originalNextDouble;
    World.currentTick = originalTick;
  }
}

const priorMembers = process.env.NODE_MEMBERS;
process.env.NODE_MEMBERS = 'true';
try {
  await run();
} finally {
  if (priorMembers === undefined) delete process.env.NODE_MEMBERS;
  else process.env.NODE_MEMBERS = priorMembers;
}

process.exit(0);
