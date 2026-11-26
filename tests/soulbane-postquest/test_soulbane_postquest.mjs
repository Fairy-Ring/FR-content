#!/usr/bin/env node
// Native compiled-pack coverage for shared postquest training.
// Focused mutation selectors: --case completed-entry | rope-exit | shared-training.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CASES = ['all', 'completed-entry', 'rope-exit', 'shared-training'];
const args = process.argv.slice(2);
let selectedCase = 'all';
if (args.length === 2 && args[0] === '--case') {
  selectedCase = args[1];
} else if (args.length !== 0) {
  assert.fail('usage: test_soulbane_postquest.mjs [--case all|completed-entry|rope-exit|shared-training]');
}
assert(CASES.includes(selectedCase), `unknown case ${selectedCase}`);

const {
  Packet, PlayerLoading, PlayerStat, ScriptState,
  World, contentRoot, count, dialoguePage, engineModule, execute, held, id, inv, inventory,
  map, player: makePlayer, resumeDialogue, seed, tile, types
} = await import('../swamp-caves/runtime.mjs');

const CoordGrid = (await engineModule('engine/CoordGrid.ts')).CoordGrid;
const EntityLifeCycle = (await engineModule('engine/entity/EntityLifeCycle.ts')).EntityLifeCycle;
const NpcStat = (await engineModule('engine/entity/NpcStat.ts')).NpcStat;
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const ColorConversion = (await engineModule('util/ColorConversion.ts')).default;
const resolveNpcType = (await engineModule('engine/entity/resolveNpcType.ts')).default;
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const OpLocHandler = new (await engineModule('network/game/client/handler/OpLocHandler.ts')).default();
const OpNpc = (await engineModule('network/game/client/model/OpNpc.ts')).default;
const OpNpcHandler = new (await engineModule('network/game/client/handler/OpNpcHandler.ts')).default();
const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const MoveClickHandler = new (await engineModule('network/game/client/handler/MoveClickHandler.ts')).default();
const rsbuf = await engineModule('network/rsbuf/index.ts');

const COMPLETE_STAGE = 13;
const POST_ENTRY = { level: 0, x: 3296, z: 9823 };
const POST_ROPE = { level: 0, x: 3297, z: 9823 };
const SURFACE_RIFT = { level: 0, x: 3310, z: 3452 };
const SURFACE_EXIT = { level: 0, x: 3310, z: 3455 };
const TOLNA = { level: 0, x: 3308, z: 3452 };
const TRAINING_TYPES = [
  'soulbane_unicorn', 'soulbane_rat', 'soulbane_goblin', 'soulbane_bear',
  'soulbane_fear_beast', 'soulbane_conf_beast', 'soulbane_less_beast3'
];
const POST_NPC_TYPES = [...TRAINING_TYPES, 'soulbane_less_beast2', 'soulbane_less_beast1'];
const COMPLETED_FORMS = new Set(['soulbane_less_beast2', 'soulbane_less_beast1']);
const QUEST_STAGE = id('VarBitType', 'soulbane_prog');
const QUEST_INSTANCE = id('VarPlayerType', 'soulbane_instance');
const NPC_XP_MULTIPLIER = id('VarNpcType', 'npc_combat_xp_multiplier');
const NPC_HITPOINTS = NpcStat.HITPOINTS;
const QUEST_NPC_CONFIG = path.join(contentRoot, 'scripts/quests/quest_soulbane/configs/soulbane_post.npc');
const TRAINING_MAP = path.join(contentRoot, 'maps/m51_153.jm2');
const MODEL_INDEX = path.join(contentRoot, 'pack/model.pack');

World.currentTick = Math.max(World.currentTick, 100);

function readVar(p, name) {
  const playerVar = types.VarPlayerType.getId(name);
  return playerVar >= 0 ? p.getVar(playerVar) : p.getVarBit(id('VarBitType', name));
}

function writeVar(p, name, value) {
  const playerVar = types.VarPlayerType.getId(name);
  if (playerVar >= 0) p.setVar(playerVar, value);
  else p.setVarBit(id('VarBitType', name), value);
}

function questSnapshot(p) {
  const rows = [];
  for (const [kind, read] of [
    ['VarBitType', index => p.getVarBit(index)],
    ['VarPlayerType', index => p.getVar(index)]
  ]) {
    const configType = types[kind];
    for (let index = 0; index < configType.count; index++) {
      const name = configType.get(index)?.debugname;
      if (name && /^(soulbane|soul_bane)_/.test(name)) rows.push([`${kind}:${name}`, read(index)]);
    }
  }
  return rows.sort(([a], [b]) => a.localeCompare(b));
}

function seedCompleted(p) {
  // Fixture seed: a normally completed quest with Tolna and the rope present.
  p.setVarBit(QUEST_STAGE, COMPLETE_STAGE);
  p.setVar(QUEST_INSTANCE, 0);
  writeVar(p, 'soulbane_riftrope_pres', 1);
}

function playerAt(position) {
  const p = makePlayer();
  p.level = position.level;
  p.x = position.x;
  p.z = position.z;
  World.gameMap.getZone(p.x, p.z, p.level).enter(p);
  World.instances.playerEntered({ level: p.level, x: p.x, z: p.z });
  rsbuf.addPlayer(p.slot);
  p.lastResponse = World.currentTick;
  p.lastConnected = World.currentTick;
  return p;
}

function disposePlayer(p) {
  if (p?.isActive && p.slot >= 0) World.removePlayer(p);
  if (p?.username) World.logoutRequests.delete(p.username);
}

function worldTick() {
  for (const p of World.playerLoop.all()) {
    if (p?.isActive) {
      p.lastResponse = World.currentTick;
      p.lastConnected = World.currentTick;
    }
  }
  for (const phase of [
    'processWorld', 'processNpcEventQueue', 'processNpcs', 'processPlayers',
    'processLogouts', 'processLogins', 'processZones', 'processInfo', 'processCleanup'
  ]) {
    assert.equal(typeof World[phase], 'function', `production World.${phase} phase is available`);
    World[phase]();
  }
  World.currentTick++;
}

function finishInteraction(p, label) {
  const pages = [];
  for (let tick = 0; tick < 400; tick++) {
    const state = p.activeScript;
    if (!state || state.execution === ScriptState.FINISHED) break;
    assert.notEqual(state.execution, ScriptState.ABORTED, `${label}: native script does not abort`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      pages.push(...dialoguePage(p));
      resumeDialogue(p);
    } else if (state.execution === ScriptState.SUSPENDED || state.execution === ScriptState.COUNTDIALOG) {
      worldTick();
    } else {
      break;
    }
  }
  assert(!p.activeScript || [ScriptState.FINISHED, ScriptState.PAUSEBUTTON].includes(p.activeScript.execution),
    `${label}: native interaction reaches a known boundary`);
  return pages.join(' ');
}

function operateLoc(p, target, option, label) {
  p.clearInteraction();
  World.processInfo();
  assert(OpLocHandler.handle(new OpLoc(option, target.x, target.z, target.type), p),
    `${label}: native OpLoc packet is accepted`);
  assert(p.inOperableDistance(target), `${label}: player is at ordinary operation distance`);
  const trigger = p.getOpTrigger();
  assert(trigger, `${label}: production dispatch resolves the visible loc operation`);
  p.processInteraction();
  const text = finishInteraction(p, label);
  return { trigger, text };
}

function operateNpc(p, target, option, label) {
  p.clearInteraction();
  World.processInfo();
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(OpNpcHandler.handle(new OpNpc(option, target.nid), p),
    `${label}: native OpNpc packet is accepted`);
  assert(p.inOperableDistance(target), `${label}: player is at ordinary operation distance`);
  const trigger = p.getOpTrigger();
  assert(trigger, `${label}: production dispatch resolves the visible NPC form`);
  p.processInteraction();
  const text = finishInteraction(p, label);
  return { trigger, text };
}

function locAt(position, name) {
  const loc = World.getLoc(position.x, position.z, position.level, id('LocType', name));
  assert(loc, `original packed loc ${name} exists at ${position.level}_${position.x}_${position.z}`);
  return loc;
}

function activeNpcs(name, position = null) {
  const typeId = id('NpcType', name);
  return [...World.npcs].filter(npc => npc?.isActive &&
    (npc.baseType === typeId || npc.type === typeId) &&
    (!position || (npc.level === position.level && npc.x === position.x && npc.z === position.z)));
}

function activeNpc(name, position = null) {
  const matches = activeNpcs(name, position);
  assert(matches.length > 0, `active packed NPC ${name}${position ? ` at ${position.level}_${position.x}_${position.z}` : ''} exists`);
  return matches[0];
}

function unpackWorld(packed) {
  const { level, x, z } = CoordGrid.unpackCoord(packed);
  return { level, x, z };
}

function nativeRoute(start, destination, label) {
  assert.equal(start.level, destination.level, `${label}: route remains on the same plane`);
  assert.equal(map.isMapBlocked(start.x, start.z, start.level), false, `${label}: departure tile is walkable`);
  assert.equal(map.isMapBlocked(destination.x, destination.z, destination.level), false, `${label}: destination tile is walkable`);
  const route = [...map.findPath(start.level, start.x, start.z, destination.x, destination.z)];
  assert(route.length > 0, `${label}: original collision map has a route`);
  assert.deepEqual(unpackWorld(route.at(-1)), destination, `${label}: path reaches its exact original endpoint`);
  return route;
}

function nativeWalk(p, destination, label) {
  p.clearInteraction();
  const route = nativeRoute({ level: p.level, x: p.x, z: p.z }, destination, label);
  assert(MoveClickHandler.handle(new MoveClick(route.map(value => {
    const { x, z } = unpackWorld(value);
    return { x, z };
  }), 0, true), p), `${label}: native movement packet is accepted`);
  for (let tick = 0; tick < 512 && (p.level !== destination.level || p.x !== destination.x || p.z !== destination.z); tick++) worldTick();
  assert.deepEqual(tile(p), [destination.level, destination.x, destination.z], `${label}: player traverses the original passage`);
}

function nativeApproachNpc(p, npc, label) {
  if (p.inOperableDistance(npc)) return;
  const route = [...map.findPathToEntity(p.level, p.x, p.z, npc.x, npc.z, p.width, npc.width, npc.length)];
  assert(route.length > 0, `${label}: ordinary collision path reaches the NPC footprint`);
  const destination = unpackWorld(route.at(-1));
  assert(MoveClickHandler.handle(new MoveClick(route.map(value => {
    const { x, z } = unpackWorld(value);
    return { x, z };
  }), 0, true), p), `${label}: native MOVE_OPCLICK approach is accepted`);
  for (let tick = 0; tick < 512 && !p.inOperableDistance(npc); tick++) worldTick();
  assert(p.inOperableDistance(npc),
    `${label}: native movement reaches operation distance at ${destination.level}_${destination.x}_${destination.z}`);
}

function dialogueSurfaceTolna(p) {
  const multiId = id('NpcType', 'soulbane_tolna_multi');
  const topId = id('NpcType', 'soulbane_tolna_top');
  const multi = types.NpcType.get(multiId);
  assert.equal(multi.multivarbit, id('VarBitType', 'soulbane_tolna_pres'),
    'surface Tolna uses the original per-player presence selector');
  assert.deepEqual(Array.from(multi.multinpc), [-1, topId],
    'the original surface multi selects Tolna at the completed presence state');
  const tolna = activeNpc('soulbane_tolna_multi', TOLNA);
  assert.equal(resolveNpcType(types.NpcType.get(tolna.type), p).id, topId,
    'completed presence resolves the original surface NPC to Tolna');
  return tolna;
}

function nativeLogoutFromTraining(p, label, expectedTile = [SURFACE_EXIT.level, SURFACE_EXIT.x, SURFACE_EXIT.z]) {
  const questBefore = questSnapshot(p);
  assert(World.currentTick >= p.preventLogoutUntil, `${label}: ordinary logout cooldown is clear`);
  p.requestLogout = true;
  p.lastResponse = World.currentTick;
  p.lastConnected = World.currentTick;
  worldTick();
  assert(![...World.playerLoop.all()].includes(p), `${label}: production logout removes the live session`);
  const request = World.logoutRequests.get(p.username);
  assert(request?.save, `${label}: production logout produces a normal save`);
  const loaded = PlayerLoading.load(p.username, new Packet(request.save), null);
  assert.deepEqual(tile(loaded), expectedTile, `${label}: logout saves the expected safe location`);
  assert.deepEqual(questSnapshot(loaded), questBefore, `${label}: logout preserves Soulbane state`);
  assert.equal(readVar(loaded, 'soulbane_instance'), 0, `${label}: no private-region handle is written`);
  World.logoutRequests.delete(p.username);
  return loaded;
}

function testCompletedEntry() {
  const p = playerAt({ level: 0, x: 3307, z: 3452 });
  try {
    seedCompleted(p);
    writeVar(p, 'soulbane_tolna_pres', 1);
    writeVar(p, 'soulbane_launa_pres', 1);
    const questBeforeTalk = questSnapshot(p);
    const xpBeforeTalk = Array.from(p.stats);
    const invBeforeTalk = inventory(p, inv);
    const tolna = dialogueSurfaceTolna(p);
    const talk = operateNpc(p, tolna, 1, 'completed Tolna repeat talk');
    assert.equal(talk.trigger.name, '[opnpc1,soulbane_tolna_top]',
      'completed referral is reached through native Talk-to on original Tolna');
    assert.match(talk.text, /There is a part of it that is perfectly laid out for combat training/i,
      'retained Tolna wording explains the combat-training area');
    assert.match(talk.text, /You.re welcome to go down there and practice fighting any time/i,
      'retained Tolna wording invites repeat access to the area');
    assert.deepEqual(questSnapshot(p), questBeforeTalk, 'repeat talk writes no Soulbane quest variable');
    assert.deepEqual(Array.from(p.stats), xpBeforeTalk, 'repeat talk grants no reward XP');
    assert.deepEqual(inventory(p, inv), invBeforeTalk, 'repeat talk grants no inventory reward');

    const rift = locAt(SURFACE_RIFT, 'soulbane_falloff2_rope_multi');
    nativeWalk(p, SURFACE_RIFT, 'walk from Tolna to the original rift operation tile');
    assert(p.inOperableDistance(rift), 'surface fixture is at the original rift rope');
    const stateBeforeEntry = questSnapshot(p);
    const enter = operateLoc(p, rift, 1, 'completed rift entry');
    assert.match(enter.trigger.name, /^\[oploc1,soulbane_falloff2_rope(?:_multi)?\]$/,
      'completed entry uses the original native rift-rope dispatch');
    assert.deepEqual(tile(p), [POST_ENTRY.level, POST_ENTRY.x, POST_ENTRY.z],
      'completed entry reaches the original shared postquest lobby');
    assert.deepEqual(questSnapshot(p), stateBeforeEntry, 'completed entry does not write quest progress or a stage');
    assert.equal(p.getVar(QUEST_INSTANCE), 0, 'completed entry does not allocate an instance handle');
    assert.equal(World.instances.findInstanceByCoord(p), null, 'completed entry uses the shared map, not a region copy');

    const saved = nativeLogoutFromTraining(p, 'completed training-map logout');
    assert.deepEqual(questSnapshot(saved), stateBeforeEntry, 'logout preserves completed quest variables');
    for (const completed of [false, true]) {
      const ordinary = playerAt({ level: 0, x: 3222, z: 3218 });
      try {
        if (completed) seedCompleted(ordinary);
        nativeLogoutFromTraining(ordinary, `ordinary mainland logout (completed=${completed})`, [0, 3222, 3218]);
      } finally {
        disposePlayer(ordinary);
      }
    }
  } finally {
    disposePlayer(p);
  }
}

function testRopeExit() {
  const p = playerAt(POST_ENTRY);
  const other = playerAt({ level: POST_ENTRY.level, x: POST_ENTRY.x - 1, z: POST_ENTRY.z });
  try {
    seedCompleted(p);
    seedCompleted(other);
    const otherTile = tile(other);
    const rope = locAt(POST_ROPE, 'soulbane_rope_up');
    assert(p.inOperableDistance(rope), 'completed player starts within ordinary distance of the original rope');
    const questBefore = questSnapshot(p);
    const result = operateLoc(p, rope, 1, 'completed rope-up exit');
    assert.equal(result.trigger.name, '[oploc1,soulbane_rope_up]',
      'rope-up uses the packed original location and native OpLoc dispatch');
    assert.deepEqual(tile(p), [SURFACE_EXIT.level, SURFACE_EXIT.x, SURFACE_EXIT.z],
      'completed rope-up returns to the authentic surface exit');
    nativeWalk(p, { level: 0, x: 3310, z: 3454 }, 'walk away from the original surface exit');
    assert.deepEqual(tile(other), otherTile, 'one player leaving does not move another player in shared training');
    assert.deepEqual(questSnapshot(p), questBefore, 'rope-up leaves completed quest variables unchanged');
    assert.equal(p.getVar(QUEST_INSTANCE), 0, 'rope-up does not create or release a private instance');
    assert.equal(other.getVar(QUEST_INSTANCE), 0, 'the remaining player stays outside any private instance');
    assert.equal(World.instances.findInstanceByCoord(p), null, 'surface exit is not in a private region');
    assert.equal(World.instances.findInstanceByCoord(other), null, 'remaining training player is still on the original map');
    assert(activeNpcs('soulbane_unicorn').length > 0, 'the shared original NPC population remains for the other player');
  } finally {
    disposePlayer(p);
    disposePlayer(other);
  }
}

function parseConfigSections(text) {
  const sections = new Map();
  let current = null;
  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('//')) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      current = {};
      sections.set(section[1], current);
      continue;
    }
    const equals = line.indexOf('=');
    if (current && equals > 0) current[line.slice(0, equals).trim()] = line.slice(equals + 1).trim();
  }
  return sections;
}

function parseModelIndex() {
  const models = new Map();
  for (const line of fs.readFileSync(MODEL_INDEX, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)=([^\s]+)$/);
    if (match) models.set(match[2], Number(match[1]));
  }
  return models;
}

function numberedFields(fields, pattern) {
  return Object.entries(fields)
    .map(([key, value]) => {
      const match = key.match(pattern);
      return match ? { index: Number(match[1]), value } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)
    .map(entry => entry.value);
}


function assertPreservedClientFields() {
  const sections = parseConfigSections(fs.readFileSync(QUEST_NPC_CONFIG, 'utf8'));
  const modelIds = parseModelIndex();
  for (const name of POST_NPC_TYPES) {
    const fields = sections.get(name);
    assert(fields, `postquest NPC config retains the original ${name} record`);
    const type = types.NpcType.get(id('NpcType', name));
    assert.equal(type.debugname, name, `${name}: original type identity remains name-addressed`);
    assert.equal(type.name, fields.name, `${name}: 377 client display name is preserved`);
    assert.equal(type.desc, fields.desc, `${name}: 377 client description is preserved`);

    const expectedModels = numberedFields(fields, /^model(\d+)$/).map(model => {
      assert(modelIds.has(model), `${name}: source model ${model} has a symbolic model-pack entry`);
      return modelIds.get(model);
    });
    assert.deepEqual(Array.from(type.models ?? []), expectedModels, `${name}: original client model list is preserved`);
    const expectedHeads = numberedFields(fields, /^head(\d+)$/).map(model => {
      assert(modelIds.has(model), `${name}: source head model ${model} has a symbolic model-pack entry`);
      return modelIds.get(model);
    });
    assert.deepEqual(Array.from(type.heads ?? []), expectedHeads, `${name}: original client head list is preserved`);
    const recolSources = numberedFields(fields, /^recol(\d+)s$/).map(Number);
    const recolDestinations = numberedFields(fields, /^recol(\d+)d$/).map(Number);
    const packedColor = (color, index) => recolSources[index] >= 100 || recolDestinations[index] >= 100
      ? ColorConversion.rgb15toHsl16(color) : color;
    assert.deepEqual(Array.from(type.recol_s ?? []), recolSources.map(packedColor),
      `${name}: original recolor sources survive the packer's RGB15-to-HSL16 conversion`);
    assert.deepEqual(Array.from(type.recol_d ?? []), recolDestinations.map(packedColor),
      `${name}: original recolor destinations survive the packer's RGB15-to-HSL16 conversion`);

    const expectedOps = Array(5).fill(null);
    for (const [key, value] of Object.entries(fields)) {
      const option = key.match(/^op(\d+)$/);
      if (option) expectedOps[Number(option[1]) - 1] = value;
    }
    assert.deepEqual(Array.from(type.op ?? Array(5).fill(null)), expectedOps,
      `${name}: original client options are preserved`);
    for (const [field, fallback] of [
      ['size', 1], ['readyanim', -1], ['walkanim', -1], ['walkanim_b', -1], ['walkanim_r', -1],
      ['walkanim_l', -1], ['resizex', -1], ['resizey', -1], ['resizez', -1], ['vislevel', -1],
      ['resizeh', 128], ['resizev', 128], ['ambient', 0], ['contrast', 0], ['headicon', -1], ['turnspeed', 32]
    ]) {
      const expected = fields[field] === undefined ? fallback :
        (field === 'readyanim' || field.startsWith('walkanim') ? id('SeqType', fields[field]) : Number(fields[field]));
      assert.equal(type[field], expected, `${name}: original client field ${field} is preserved`);
    }
  }
}

function sourceTrainingSpawns() {
  const source = fs.readFileSync(TRAINING_MAP, 'utf8');
  const marker = '==== NPC ====';
  const start = source.indexOf(marker);
  assert(start >= 0, 'original m51_153 map has an NPC section');
  const end = source.indexOf('==== ', start + marker.length);
  const section = source.slice(start + marker.length, end < 0 ? undefined : end);
  const base = path.basename(TRAINING_MAP).match(/^m(\d+)_(\d+)\.jm2$/);
  assert(base, 'original training map has a region-coordinate filename');
  const baseX = Number(base[1]) * 64;
  const baseZ = Number(base[2]) * 64;
  const names = new Set([...POST_NPC_TYPES]);
  const rows = [];
  for (const line of section.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+):\s*(\d+)(?:\s+.*)?$/);
    if (!match) continue;
    const [, level, localX, localZ, typeText] = match;
    const typeId = Number(typeText);
    const name = types.NpcType.get(typeId)?.debugname;
    if (names.has(name)) rows.push({ name, level: Number(level), x: baseX + Number(localX), z: baseZ + Number(localZ) });
  }
  return rows;
}

function npcName(npc) {
  return types.NpcType.get(npc.baseType)?.debugname ?? types.NpcType.get(npc.type)?.debugname ?? null;
}

function assertSharedOriginalMap() {
  const source = sourceTrainingSpawns();
  assert.equal(source.length, 39, 'original m51_153 retains its 39 shared training-NPC placements');
  for (const name of TRAINING_TYPES) {
    assert(source.some(row => row.name === name), `original map retains a ${name} spawn`);
  }
  for (const name of COMPLETED_FORMS) {
    assert(!source.some(row => row.name === name), `${name} remains a non-spawned form, not a training actor`);
  }
  const actual = [...World.npcs]
    .filter(npc => npc?.isActive && TRAINING_TYPES.includes(npcName(npc)))
    .map(npc => ({ name: npcName(npc), level: npc.level, x: npc.x, z: npc.z }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.level - b.level || a.x - b.x || a.z - b.z);
  const expected = source
    .filter(row => TRAINING_TYPES.includes(row.name))
    .sort((a, b) => a.name.localeCompare(b.name) || a.level - b.level || a.x - b.x || a.z - b.z);
  assert.deepEqual(actual, expected, 'compiled world loads one shared NPC at each original source coordinate');
  for (const name of COMPLETED_FORMS) {
    assert.equal(activeNpcs(name).length, 0, `${name} is not spawned into postquest training`);
  }
  for (const row of expected) {
    const npc = activeNpc(row.name, row);
    assert.equal(npc.lifecycle, EntityLifeCycle.RESPAWN, `${row.name} keeps the original static respawn lifecycle`);
  }
  return expected;
}

function assertOpenRoomPassages(p) {
  const start = POST_ENTRY;
  const stands = [
    ['anger', { level: 0, x: 3276, z: 9835 }],
    ['fear', { level: 0, x: 3304, z: 9832 }],
    ['confusion', { level: 0, x: 3301, z: 9806 }],
    ['hopelessness', { level: 0, x: 3276, z: 9809 }]
  ];
  for (const [room, destination] of stands) {
    nativeWalk(p, destination, `original open ${room} passage`);
    nativeWalk(p, start, `return from original ${room} passage`);
  }
}

function groundObjectsNear(level, x, z) {
  const objects = new Map();
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const zone = World.gameMap.getZoneIfExists(x + dx, z + dz, level);
      if (!zone) continue;
      for (const obj of zone.getAllObjsSafe()) {
        if (obj.level === level && Math.abs(obj.x - x) <= 2 && Math.abs(obj.z - z) <= 2) {
          objects.set(obj, `${obj.type}:${obj.count}:${obj.level}:${obj.x}:${obj.z}:${obj.receiver64}`);
        }
      }
    }
  }
  return [...objects.values()].sort();
}

function withStableCombatRoll(run) {
  const oldMathRandom = Math.random;
  const oldJavaRandom = JavaRandom.nextDouble;
  Math.random = () => 0.999999999999;
  JavaRandom.nextDouble = () => 0.999999999999;
  try {
    return run();
  } finally {
    Math.random = oldMathRandom;
    JavaRandom.nextDouble = oldJavaRandom;
  }
}

function assertOrdinaryMeleeXp(p, before, damage, multiplier, label) {
  assert.equal(multiplier, 1000, `${label}: ordinary combat XP multiplier remains 1000`);
  const delta = Array.from(p.stats, (value, index) => value - before[index]);
  const base = damage * 10;
  const shared = Math.floor(base * 133 / 100);
  const singleStyle = Math.floor(base * 400 / 100);
  const combat = [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE].map(skill => delta[skill]);
  const oneStyle = combat.filter(value => value !== 0).length === 1 && combat.includes(singleStyle);
  const controlledStyle = combat.every(value => value === shared);
  assert(oneStyle || controlledStyle, `${label}: damage uses the ordinary melee XP split (${JSON.stringify(combat)})`);
  assert.equal(delta[PlayerStat.HITPOINTS], shared, `${label}: ordinary melee awards 133% Hitpoints XP`);
  const combatSkills = new Set([PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.HITPOINTS]);
  for (let skill = 0; skill < delta.length; skill++) {
    if (!combatSkills.has(skill)) assert.equal(delta[skill], 0, `${label}: no noncombat XP is granted`);
  }
}

function attackStaticNpc(p, npc, label) {
  nativeApproachNpc(p, npc, label);
  World.processInfo();
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, npc.nid), `${label}: native NPC update makes the target visible`);
  const beforeHp = npc.levels[NPC_HITPOINTS];
  const multiplier = npc.vars[NPC_XP_MULTIPLIER];
  assert.equal(beforeHp, 50, `${label}: period training target starts at 50 HP`);
  const beforeGround = groundObjectsNear(npc.level, npc.x, npc.z);
  const inventoryBefore = inventory(p, inv);
  withStableCombatRoll(() => {
    p.clearInteraction();
    World.processInfo();
    rsbuf.npcInfo(0, p.slot, 0, 0, true);
    assert(OpNpcHandler.handle(new OpNpc(2, npc.nid), p), `${label}: native Attack packet accepts the static NPC`);
    assert.match(p.getOpTrigger()?.name ?? '', /^\[opnpc2,/, `${label}: real Attack operation selects ordinary opnpc2 dispatch`);
    // Player XP is awarded when a hit is queued; NPC HP changes in the next NPC phase.
    let previousXp = Array.from(p.stats);
    for (let tick = 0; tick < 120 && npc.levels[NPC_HITPOINTS] > 0; tick++) {
      const previousHp = npc.levels[NPC_HITPOINTS];
      worldTick();
      const damage = previousHp - npc.levels[NPC_HITPOINTS];
      if (damage > 0) {
        assertOrdinaryMeleeXp(p, previousXp, damage, multiplier, label);
        previousXp = Array.from(p.stats);
      }
    }
    p.clearInteraction();
  });
  const damage = beforeHp - npc.levels[NPC_HITPOINTS];
  assert.equal(damage, 50, `${label}: native ordinary combat kills the full 50-HP target`);
  for (let tick = 0; tick < 32 && npc.isActive; tick++) worldTick();
  assert.equal(npc.isActive, false, `${label}: the native death lifecycle removes the killed NPC before respawn`);
  assert.deepEqual(groundObjectsNear(npc.level, npc.x, npc.z), beforeGround,
    `${label}: NPC death adds no ground drops`);
  assert.deepEqual(inventory(p, inv), inventoryBefore, `${label}: training combat has no inventory reward`);
  return damage;
}

function waitForStaticRespawn(name, position, label) {
  for (let tick = 0; tick < 160; tick++) {
    const living = activeNpcs(name, position).filter(npc => npc.levels[NPC_HITPOINTS] > 0);
    if (living.length === 1) {
      assert.equal(living[0].levels[NPC_HITPOINTS], 50, `${label}: original NPC returns at full HP`);
      assert.equal(living[0].lifecycle, EntityLifeCycle.RESPAWN, `${label}: respawn remains the static lifecycle`);
      return living[0];
    }
    worldTick();
  }
  assert.fail(`${label}: original shared NPC respawns at its source coordinate`);
}

function assertVisibleTo(p, npc, label) {
  World.processInfo();
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, npc.nid), `${label}: same world NPC is visible to this player`);
}

function testOrdinaryTrainingDeath() {
  const p = playerAt(POST_ENTRY);
  try {
    seedCompleted(p);
    seed(p, ['rune_chainbody', 'rune_platelegs', 'bronze_platebody', 'shortbow']);
    const questBefore = questSnapshot(p);
    const xpBefore = Array.from(p.stats);
    const sourceNpc = activeNpc('soulbane_unicorn');
    // Disclosed lethal-HP seed; the existing player_die proc enqueues native ordinary death.
    p.levels[PlayerStat.HITPOINTS] = 0;
    execute('[proc,player_die]', p);
    for (let tick = 0; tick < 80 && (p.activeScript || p.queue.head() !== null); tick++) worldTick();
    assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED, 'shared training death settles natively');
    assert.equal(p.level, 0, 'ordinary training death respawns on the mainland plane');
    assert(Math.abs(p.x - 3221) <= 2 && Math.abs(p.z - 3218) <= 2,
      'ordinary training death reaches the existing Lumbridge respawn area');
    nativeRoute({ level: p.level, x: p.x, z: p.z }, { level: 0, x: 3225, z: 3219 }, 'walk away after ordinary training death');
    assert.deepEqual(questSnapshot(p), questBefore, 'ordinary death preserves completed quest state');
    assert.deepEqual(Array.from(p.stats), xpBefore, 'ordinary death grants no training or quest XP');
    assert.equal(count(p, 'shortbow'), 0, 'ordinary death applies normal item loss');
    assert(World.getObj(POST_ENTRY.x, POST_ENTRY.z, POST_ENTRY.level, id('ObjType', 'shortbow'), p.hash64),
      'normal death drops remain recoverable on the shared training map');
    assert(sourceNpc.isActive, 'ordinary player death does not delete shared training NPCs');
    assert.equal(World.instances.findInstanceByCoord(p), null, 'ordinary death creates no private instance');
  } finally {
    disposePlayer(p);
  }
}

function testSharedTraining() {
  assertPreservedClientFields();
  const spawns = assertSharedOriginalMap();

  const p = playerAt(POST_ENTRY);
  const other = playerAt({ level: POST_ENTRY.level, x: POST_ENTRY.x - 1, z: POST_ENTRY.z });
  try {
    seedCompleted(p);
    seedCompleted(other);
    assertOpenRoomPassages(p);
    seed(p, ['rune_scimitar']);
    assert(held(p, 'rune_scimitar', 2), 'fixture equips one ordinary rune scimitar through native inventory handling');
    const pQuestBefore = questSnapshot(p);
    const otherQuestBefore = questSnapshot(other);

    for (const name of TRAINING_TYPES) {
      const spawn = spawns.find(row => row.name === name);
      assert(spawn, `${name}: original map supplies a static spawn`);
      let npc = activeNpc(name, spawn);
      assert.equal(types.NpcType.get(id('NpcType', name)).stats[NPC_HITPOINTS], 50,
        `${name}: packed period training health remains 50`);
      if (name === 'soulbane_unicorn') {
        nativeApproachNpc(other, npc, 'second player approaches shared unicorn');
        assertVisibleTo(other, npc, 'second player before first shared kill');
      }
      attackStaticNpc(p, npc, `${name} ordinary postquest combat`);
      assert.deepEqual(questSnapshot(p), pQuestBefore, `${name}: ordinary combat writes no quest puzzle state`);
      assert.deepEqual(questSnapshot(other), otherQuestBefore, `${name}: shared combat does not mutate another player`);
      const respawned = waitForStaticRespawn(name, spawn, `${name} static respawn`);
      assert.equal(activeNpcs(name, spawn).filter(candidate => candidate.levels[NPC_HITPOINTS] > 0).length, 1,
        `${name}: shared map has one living copy at the original spawn`);
      if (name === 'soulbane_unicorn') assertVisibleTo(other, respawned, 'second player after shared respawn');
      npc = respawned;
    }
    testOrdinaryTrainingDeath();
  } finally {
    disposePlayer(p);
    disposePlayer(other);
  }
}

const RUNS = new Map([
  ['completed-entry', testCompletedEntry],
  ['rope-exit', testRopeExit],
  ['shared-training', testSharedTraining]
]);
for (const [name, run] of RUNS) {
  if (selectedCase === 'all' || selectedCase === name) {
    run();
    console.log(`PASS soulbane-postquest ${name}`);
  }
}
process.exit(0);
