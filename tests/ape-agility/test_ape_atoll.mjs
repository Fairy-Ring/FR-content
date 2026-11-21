/**
 * Deterministic compiled production-handler proof for the Ape Atoll course unit.
 * Run after the full content pack is built, from the sibling engine directory:
 *   node --import tsx ../content/tests/ape-agility/test_ape_atoll.mjs
 * Ordinary death uses independent keep/drop, stat-reset, respawn, tab, form,
 * modal, jingle, prayer-icon and worn-appearance contracts, not recordings.
 * It starts no server and writes its JSON receipt beneath RUNNER_TEMP.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_DIR = process.env.HARNESS_ENGINE_DIR ?? path.resolve(CONTENT_DIR, '../engine');
const PACK_DIR = path.join(ENGINE_DIR, 'data/pack');
process.chdir(ENGINE_DIR);
const eng = rel => import(pathToFileURL(path.join(ENGINE_DIR, rel)).href);

const { default: World } = await eng('src/engine/World.ts');
const { default: Player } = await eng('src/engine/entity/Player.ts');
const { Inventory } = await eng('src/engine/Inventory.ts');
const { default: Loc } = await eng('src/engine/entity/Loc.ts');
const { EntityLifeCycle } = await eng('src/engine/entity/EntityLifeCycle.ts');
const { PlayerStatMap } = await eng('src/engine/entity/PlayerStat.ts');
const { PlayerInfoProt } = await eng('src/network/rsbuf/prot.ts');
const { default: CategoryType } = await eng('src/cache/config/CategoryType.ts');
const { default: Component } = await eng('src/cache/config/Component.ts');
const { default: DbTableType } = await eng('src/cache/config/DbTableType.ts');
const { default: DbRowType } = await eng('src/cache/config/DbRowType.ts');
const { default: EnumType } = await eng('src/cache/config/EnumType.ts');
const { default: FontType } = await eng('src/cache/config/FontType.ts');
const { default: InvType } = await eng('src/cache/config/InvType.ts');
const { default: LocType } = await eng('src/cache/config/LocType.ts');
const { default: NpcType } = await eng('src/cache/config/NpcType.ts');
const { default: ObjType } = await eng('src/cache/config/ObjType.ts');
const { default: ParamType } = await eng('src/cache/config/ParamType.ts');
const { default: SeqType } = await eng('src/cache/config/SeqType.ts');
const { default: VarBitType } = await eng('src/cache/config/VarBitType.ts');
const { default: VarNpcType } = await eng('src/cache/config/VarNpcType.ts');
const { default: VarPlayerType } = await eng('src/cache/config/VarPlayerType.ts');
const { default: Environment } = await eng('src/util/Environment.ts');
const { default: Packet } = await eng('src/io/Packet.ts');
const { default: ScriptProvider } = await eng('src/engine/script/ScriptProvider.ts');
const { default: ScriptRunner } = await eng('src/engine/script/ScriptRunner.ts');
const { default: ScriptState } = await eng('src/engine/script/ScriptState.ts');
const { default: JavaRandom } = await eng('src/util/JavaRandom.ts');
const { default: ServerTriggerType } = await eng('src/engine/script/ServerTriggerType.ts');
const { ScriptOpcode, ScriptOpcodeNameMap } = await eng('src/engine/script/ScriptOpcode.ts');
const { default: routefinder, CollisionFlag } = await eng('src/engine/routefinder/index.ts');
const { isMapBlocked, isLineOfWalk } = await eng('src/engine/GameMap.ts');
const { unzipSync } = createRequire(path.join(ENGINE_DIR, 'package.json'))('fflate');

for (const config of [
  VarPlayerType, VarBitType, VarNpcType, CategoryType, ParamType, NpcType,
  LocType, InvType, ObjType, SeqType, FontType, Component, DbTableType, DbRowType, EnumType
]) config.load(PACK_DIR);
Environment.NODE_XPRATE = 1;
Environment.NODE_DEBUG = false;
World.currentTick = 1;
assert(ScriptProvider.load(PACK_DIR) > 0, 'a complete packed server script cache is required');

function packId(kind, name) {
  const file = path.join(CONTENT_DIR, `pack/${kind}.pack`);
  const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find(row => row.slice(row.indexOf('=') + 1) === name);
  assert(line, `${kind}.pack is missing ${name}`);
  const id = Number(line.slice(0, line.indexOf('=')));
  assert(Number.isInteger(id), `${kind}.pack has a nonnumeric id for ${name}`);
  return id;
}

function configFiles(root, extension) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...configFiles(file, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(file);
  }
  return files;
}

function configSections(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const sections = [];
  for (let index = 0; index < lines.length; index++) {
    const heading = lines[index].match(/^\[([^\]]+)\]$/);
    if (!heading) continue;
    const fields = [];
    for (let cursor = index + 1; cursor < lines.length && !/^\[[^\]]+\]$/.test(lines[cursor]); cursor++) {
      if (lines[cursor].trim() && !/^\s*(?:\/\/|#)/.test(lines[cursor])) fields.push(lines[cursor]);
    }
    sections.push({ name: heading[1], fields });
  }
  return sections;
}

function sectionDigest(section) {
  return crypto.createHash('sha256').update([`[${section.name}]`, ...section.fields].join('\n')).digest('hex');
}

// Original authored record bytes were retained in the source commit below. Hashes cover
// each heading plus all non-comment, nonblank fields; CI needs no evidence-disk files.
const ORIGINAL_RECORD_COMMIT = 'd7266bfd1d5a7504ac16db956e25c0c2acc9be41';
const ORIGINAL_LOC_DIGESTS = {
  stepping_stone_12568: '9f367603aa4c9f608eb3601dba4e692b50d4591182b09250a162683c50c13dd5',
  tropical_tree: '1ee5017dca300a7e6db86a8ef9491c5b0291c1d240dc04228a05215f716e199a',
  monkeybars_12573: '645028f5e638c9c24ea94efa4e8077070b0f92c1fb11cf1721f9d10cdc677b7f',
  monkeybars_12575: 'c1d81fe41c3c1068b4e6c97fb4004866891063775c1789b71cd20d278be19add',
  skull_slope_12576: 'b80b61357f7f9412d92299681bda673b60f5084c7110773b4c9305b7367cf062',
  rope_12578: 'edfd7a014c655ecd9352d2a8115c734057fa0fe8b8654ee5c8ef371f14b6ff25',
  tropical_tree_12618: 'cd95813d5f13887f21f9e82c93ddad451fd28763272aae59c13905a7a01ab6ca'
};
const ORIGINAL_SEQ_DIGESTS = {
  '100_ilm_stepping_stone_jump': 'd625db47007c61ac7c0524e4e74faea995310853e393dea27098a3d94197aa9c',
  '100_ilm_monkeybar_jump_up': '77a096b657e6c0df39db3a4e9128a35342b285db79f7b80ec1969ccbd65d544a',
  '100_ilm_monkeybar_move': '28558da6c7c3c79d8aed4ed3c1f1e899ef2801d8129769eb6380bab8fa4f67cb',
  '100_ilm_monkeybar_jump_down': '79fabed429df3ef52fab9bbe89f81b21a836d5e9cb098b6674fb0ab2561b3c4a',
  '100_ilm_climb_slope': '8c3d6c5f6a41860eec2d92896622a7ef298f145031dfc082c3c8cbf9ca6fcc87',
  '100_ilm_climb_tree': '1f6280d15714304e1c409e49b68f1b02a1f46d05f7cf9d9413a605a452290266',
  '100_ilm_vine_swing': '21e1becfbabdcdc0bb5c3d7732fae3e127b0dd1405b1b0bb843e059380d9bab0',
  '100_ilm_monkey_down_vine': 'e0812dbe5c9a8d9750e92b1781cbf44c077426d11632d35250f1e03279c7134a'
};
const LOC_IDS = {
  stepping_stone_12568: 12568,
  tropical_tree: 12570,
  monkeybars_12573: 12573,
  monkeybars_12575: 12575,
  skull_slope_12576: 12576,
  rope_12578: 12578,
  tropical_tree_12618: 12618
};
const SEQ_IDS = {
  '100_ilm_stepping_stone_jump': 3480,
  '100_ilm_monkeybar_jump_up': 3482,
  '100_ilm_monkeybar_move': 3483,
  '100_ilm_monkeybar_jump_down': 3484,
  '100_ilm_climb_slope': 3485,
  '100_ilm_climb_tree': 3487,
  '100_ilm_vine_swing': 3488,
  '100_ilm_monkey_down_vine': 3494
};

function assertUniqueAuthoredRecords(extension, expectedDigests, expectedOwner) {
  const names = new Set(Object.keys(expectedDigests));
  const found = new Map([...names].map(name => [name, []]));
  for (const file of configFiles(path.join(CONTENT_DIR, 'scripts'), extension)) {
    for (const section of configSections(file)) {
      if (found.has(section.name)) found.get(section.name).push({ file, section });
    }
  }
  for (const [name, expectedDigest] of Object.entries(expectedDigests)) {
    const matches = found.get(name);
    assert.equal(matches.length, 1, `${name} must have exactly one current ${extension} owner`);
    const [match] = matches;
    const owner = path.relative(CONTENT_DIR, match.file).split(path.sep).join('/');
    assert.equal(owner, expectedOwner, `${name} owner moved from the retained source unit`);
    assert.equal(sectionDigest(match.section), expectedDigest, `${name} differs from original record ${ORIGINAL_RECORD_COMMIT}`);
  }
}

assertUniqueAuthoredRecords('.loc', ORIGINAL_LOC_DIGESTS, 'scripts/skill_agility/configs/ape_atoll_course.loc');
assertUniqueAuthoredRecords('.seq', ORIGINAL_SEQ_DIGESTS, 'scripts/skill_agility/configs/ape_atoll_course.seq');
for (const [name, expected] of Object.entries(LOC_IDS)) assert.equal(packId('loc', name), expected, `${name} retains its packed loc id`);
for (const [name, expected] of Object.entries(SEQ_IDS)) {
  const id = packId('seq', name);
  assert.equal(id, expected, `${name} retains its packed sequence id`);
  assert(SeqType.get(id), `${name} sequence is present in the packed cache`);
}
assert(!fs.readFileSync(path.join(CONTENT_DIR, 'pack/varp.pack'), 'utf8').includes('ape_atoll'), 'the course adds no varp');

const MAP_LOCS = [
  { name: 'stepping_stone_12568', level: 0, x: 2754, z: 2742, shape: 22, angle: 3 },
  { name: 'tropical_tree', level: 0, x: 2753, z: 2741, shape: 10, angle: 3 },
  { name: 'monkeybars_12573', level: 2, x: 2752, z: 2741, shape: 10, angle: 3 },
  { name: 'monkeybars_12575', level: 2, x: 2747, z: 2741, shape: 10, angle: 1 },
  { name: 'skull_slope_12576', level: 0, x: 2746, z: 2741, shape: 22, angle: 2 },
  { name: 'rope_12578', level: 0, x: 2752, z: 2731, shape: 10, angle: 0 },
  { name: 'tropical_tree_12618', level: 0, x: 2757, z: 2734, shape: 10, angle: 0 }
];
function packedMapLocs() {
  const archive = path.join(PACK_DIR, '.cache/maps-server.zip');
  assert(fs.existsSync(archive), 'the full compiled maps-server.zip is required');
  const entries = unzipSync(fs.readFileSync(archive));
  const expectedById = new Map(MAP_LOCS.map(row => [LOC_IDS[row.name], row]));
  const found = new Map(MAP_LOCS.map(row => [row.name, []]));
  const mapFiles = Object.entries(entries).filter(([name]) => /^l\d+_\d+$/.test(name));
  assert(mapFiles.length > 0, 'the packed map archive has no loc maps');
  for (const [name, bytes] of mapFiles) {
    const [, mapX, mapZ] = name.match(/^l(\d+)_(\d+)$/);
    const packet = new Packet(bytes);
    let locId = -1;
    while (packet.available > 0) {
      const locOffset = packet.gsmarts();
      if (locOffset === 0) break;
      locId += locOffset;
      let coord = 0;
      let coordOffset = packet.gsmarts();
      while (coordOffset !== 0) {
        coord += coordOffset - 1;
        const info = packet.g1();
        const expected = expectedById.get(locId);
        if (expected) {
          const localZ = coord & 63;
          const localX = (coord >> 6) & 63;
          const level = (coord >> 12) & 3;
          found.get(expected.name).push({
            name: expected.name,
            level,
            x: (Number(mapX) << 6) + localX,
            z: (Number(mapZ) << 6) + localZ,
            shape: info >> 2,
            angle: info & 3
          });
        }
        coordOffset = packet.gsmarts();
      }
    }
    assert.equal(packet.available, 0, `${name} loc stream is fully consumed`);
  }
  for (const placement of MAP_LOCS) assert.deepEqual(found.get(placement.name), [placement], `${placement.name} has one original map occurrence`);
  return mapFiles.length;
}
const mapFileCount = packedMapLocs();

// Full packed map initialization supplies the authoritative static collision grid.
World.gameMap.init();
assert(World.gameMap.getTotalLocs() > 0, 'the packed world map loaded static locations');
const collisionWitnesses = [
  { level: 0, x: 2755, z: 2742, label: 'entrance stand' },
  { level: 0, x: 2753, z: 2742, label: 'stone/tree transition' },
  { level: 2, x: 2752, z: 2742, label: 'tree/bars transition' },
  { level: 0, x: 2747, z: 2741, label: 'stable bars/slope transition' },
  { level: 0, x: 2743, z: 2741, label: 'slope landing' },
  { level: 0, x: 2751, z: 2731, label: 'rope setup stand' },
  { level: 0, x: 2756, z: 2731, label: 'rope landing' },
  { level: 0, x: 2757, z: 2733, label: 'descent setup stand' },
  { level: 0, x: 2759, z: 2737, label: 'candidate descent failure ground' },
  { level: 1, x: 2758, z: 2734, label: 'upper vine start' },
  { level: 1, x: 2770, z: 2747, label: 'upper vine exit' },
  { level: 0, x: 2770, z: 2747, label: 'ground below vine exit' }
];
for (const tile of collisionWitnesses) {
  assert.equal(routefinder.isFlagged(tile.x, tile.z, tile.level, CollisionFlag.WALK_BLOCKED), false, `${tile.label} remains statically walkable`);
}
assert.equal(routefinder.isFlagged(2747, 2741, 2, CollisionFlag.WALK_BLOCKED), true, 'the L2 west bar checkpoint is a transient floor-blocked tile');

const AGILITY = PlayerStatMap.get('AGILITY');
const HITPOINTS = PlayerStatMap.get('HITPOINTS');
assert(Number.isInteger(AGILITY) && Number.isInteger(HITPOINTS), 'Agility and Hitpoints stat indices are loaded');
const ninjaForms = [
  { label: 'small ninja', object: 'mm_monkey_greegree_for_small_ninja_monkey', npc: 'mm_transmogrification_small_ninja_monkey', accepted: true },
  { label: 'medium ninja', object: 'mm_monkey_greegree_for_medium_ninja_monkey', npc: 'mm_transmogrification_medium_ninja_monkey', accepted: true },
  { label: 'normal monkey', object: 'mm_monkey_greegree_for_normal_monkey', npc: 'mm_transmogrification_normal_monkey', accepted: false }
];
assert.equal(packId('npc', ninjaForms[0].npc), 1480, 'the small ninja form retains npc ID 1480');
assert.equal(packId('npc', ninjaForms[1].npc), 1481, 'the medium ninja form retains npc ID 1481');
const WORN_INVENTORY = packId('inv', 'worn');
const RIGHT_HAND = 3;
const BAS_FIELDS = ['readyanim', 'turnanim', 'walkanim', 'walkanim_b', 'walkanim_l', 'walkanim_r', 'runanim'];
const transformScript = ScriptProvider.getByName('[proc,mm_greegree_transmogrify]');
assert(transformScript, 'the packed normal greegree transform procedure is present');
const updateBasScript = ScriptProvider.getByName('[proc,update_bas]');
assert(updateBasScript, 'the ordinary transformed-player BAS procedure is packed');
const deathQueue = ScriptProvider.getByName('[queue,player_death_default]');
assert(deathQueue, 'the real player death queue is packed');
const greegreeTimerScript = ScriptProvider.getByName('[timer,mm_greegree_timer]');
const greegreeWieldScript = ScriptProvider.getByName('[opheld2,_mm_greegree]');
const MAIN_INVENTORY = packId('inv', 'inv');
const greegreeObjectIds = new Set(ninjaForms.map(form => packId('obj', form.object)));
const DEATH_TEST_START_TICK = 100;
// The real MAP_FINDSQUARE opcode samples Math.random, not JavaRandom.
const DEATH_RESPAWN_RANDOM = 0;
let nextDeathTestTick = DEATH_TEST_START_TICK;
function transform(player, form) {
  const objectId = packId('obj', form.object);
  player.invSet(WORN_INVENTORY, objectId, 1, RIGHT_HAND);
  const state = ScriptRunner.init(transformScript, player, null, [objectId]);
  assert.equal(player.runScript(state, true, true), ScriptState.FINISHED, `${form.label} uses the packed greegree transform`);
  assert.equal(player.npcId, packId('npc', form.npc), `${form.label} writes the real Player.npcId`);
  assert.equal(
    player.runScript(ScriptRunner.init(updateBasScript, player, null), true, true),
    ScriptState.FINISHED,
    `${form.label} derives its real BAS as ordinary equipment handling does`
  );
}
let nextTestPlayerId = 1;

function makePlayer(level, form, tile) {
  const id = nextTestPlayerId++;
  const player = new Player('ape_atoll_packed_test', BigInt(id), BigInt(id));
  player.slot = id;
  player.pid = id;
  player.uid = (id << 11) | id;
  // Real DAMAGE and ring-of-life opcodes resolve the UID through the world, not the active pointer.
  World.players[id] = player;
  World.playerLoop.add(player.hash64, player);
  assert.equal(World.getPlayerByUid(player.uid), player, 'the real damage path can resolve its fixture player');
  player.packets = [];
  player.messages = [];
  player.write = message => player.packets.push(message);
  player.messageGame = message => player.messages.push(message);
  player.wrappedMessageGame = message => player.messages.push(message);
  player.setLevel(AGILITY, level);
  if (form) transform(player, form);
  player.level = tile.level;
  player.x = tile.x;
  player.z = tile.z;
  return player;
}

function tileOf(player) {
  return { level: player.level, x: player.x, z: player.z };
}

function snapshot(player) {
  return {
    tile: tileOf(player),
    npcId: player.npcId,
    protect: player.protect,
    delayed: player.delayed,
    delayedUntil: player.delayedUntil,
    activeScript: player.activeScript?.script.name ?? null,
    animProtect: player.animProtect,
    animId: player.animId,
    animDelay: player.animDelay,
    spotanimId: player.spotanimId,
    spotanimTime: player.spotanimTime,
    readyanim: player.readyanim,
    lastAppearance: player.lastAppearance,
    appearanceBuf: player.appearanceBuf ? Array.from(player.appearanceBuf) : null,
    hitpoints: player.levels[HITPOINTS],
    hitmarkDamage: player.hitmarkDamage,
    hitmarkType: player.hitmarkType,
    hitmark2Damage: player.hitmark2Damage,
    hitmark2Type: player.hitmark2Type,
    hitmarkSlot: player.hitmarkSlot,
    runenergy: player.runenergy,
    stepsTaken: player.stepsTaken,
    moveSpeed: player.moveSpeed,
    tele: player.tele,
    jump: player.jump,
    stats: Array.from(player.stats),
    levels: Array.from(player.levels),
    baseLevels: Array.from(player.baseLevels),
    vars: Array.from(player.vars),
    varsString: [...player.varsString],
    body: [...player.body],
    colors: [...player.colors],
    appearanceInv: player.appearanceInv,
    masks: player.masks,
    exactMove: [player.exactStartX, player.exactStartZ, player.exactEndX, player.exactEndZ],
    messages: [...player.messages],
    packetCount: player.packets.length
  };
}
function canonicalJsonValue(value) {
  if (value === undefined) return { $undefined: true };
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) {
    return value instanceof DataView
      ? Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      : Array.from(value);
  }
  if (Array.isArray(value)) return Array.from(value, canonicalJsonValue);
  if (value instanceof Map) {
    return [...value.entries()].map(([key, entry]) => [canonicalJsonValue(key), canonicalJsonValue(entry)]);
  }
  if (value instanceof Set) return [...value.values()].map(canonicalJsonValue);
  const fields = Object.fromEntries(
    Object.getOwnPropertyNames(value)
      .sort()
      .map(key => [key, canonicalJsonValue(value[key])])
  );
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null
    ? fields
    : { $type: value.constructor?.name ?? 'Object', fields };
}

function inventorySnapshot(player) {
  return [...player.invs.entries()]
    .sort(([left], [right]) => left - right)
    .map(([id, inventory]) => ({
      id,
      capacity: inventory.capacity,
      stackType: inventory.stackType,
      items: inventory.items.map(item => item ? { id: item.id, count: item.count } : null)
    }));
}


function persistentEffects(player) {
  const state = snapshot(player);
  for (const key of ['tile', 'masks', 'exactMove', 'packetCount', 'delayedUntil', 'stepsTaken', 'moveSpeed', 'tele', 'jump']) {
    delete state[key];
  }
  return state;
}

function stageLoc(stage) {
  const type = LocType.get(stage.id);
  assert(type, `${stage.name} LocType is loaded`);
  return new Loc(
    stage.placement.level,
    stage.placement.x,
    stage.placement.z,
    type.width,
    type.length,
    EntityLifeCycle.RESPAWN,
    stage.id,
    stage.placement.shape,
    stage.placement.angle
  );
}

const STAGES = [
  {
    name: 'stepping_stone_12568', trigger: '[oploc1,stepping_stone_12568]', id: LOC_IDS.stepping_stone_12568,
    placement: MAP_LOCS[0], start: { level: 0, x: 2755, z: 2742 }, end: { level: 0, x: 2753, z: 2742 }, xp: 400
  },
  {
    name: 'tropical_tree', trigger: '[oploc1,tropical_tree]', id: LOC_IDS.tropical_tree,
    placement: MAP_LOCS[1], start: { level: 0, x: 2753, z: 2742 }, end: { level: 2, x: 2752, z: 2742 }, xp: 400
  },
  {
    name: 'monkeybars_12573', trigger: '[oploc1,monkeybars_12573]', id: LOC_IDS.monkeybars_12573,
    placement: MAP_LOCS[2], start: { level: 2, x: 2752, z: 2742 }, end: { level: 0, x: 2747, z: 2741 }, xp: 400
  },
  {
    name: 'monkeybars_12575', trigger: '[oploc1,monkeybars_12575]', id: LOC_IDS.monkeybars_12575,
    placement: MAP_LOCS[3], start: { level: 2, x: 2747, z: 2741 }, end: { level: 2, x: 2752, z: 2742 }, xp: 400
  },
  {
    name: 'skull_slope_12576', trigger: '[oploc1,skull_slope_12576]', id: LOC_IDS.skull_slope_12576,
    placement: MAP_LOCS[4], start: { level: 0, x: 2747, z: 2741 }, end: { level: 0, x: 2743, z: 2741 }, xp: 600
  },
  {
    name: 'rope_12578', trigger: '[oploc1,rope_12578]', id: LOC_IDS.rope_12578,
    placement: MAP_LOCS[5], start: { level: 0, x: 2751, z: 2731 }, end: { level: 0, x: 2756, z: 2731 }, xp: 1000
  },
  {
    name: 'tropical_tree_12618', trigger: '[oploc1,tropical_tree_12618]', id: LOC_IDS.tropical_tree_12618,
    placement: MAP_LOCS[6], start: { level: 0, x: 2757, z: 2733 }, end: { level: 0, x: 2770, z: 2747 }, xp: 3000
  }
];
const EXACT_DIRECTION = { north: 0, east: 1, south: 2, west: 3 };
const SUCCESS_PATHS = new Map([
  ['stepping_stone_12568', {
    exactMoves: [{ level: 0, startX: 2755, startZ: 2742, endX: 2753, endZ: 2742, startCycle: 0, endCycle: 36, direction: EXACT_DIRECTION.west }],
    teleJumps: [],
    delayTicks: [1, 2],
    animations: [[3480, 0], [-1, 0]]
  }],
  ['tropical_tree', {
    exactMoves: [{ level: 0, startX: 2753, startZ: 2742, endX: 2753, endZ: 2742, startCycle: 0, endCycle: 94, direction: EXACT_DIRECTION.south }],
    teleJumps: [{ from: { level: 0, x: 2753, z: 2742 }, to: { level: 2, x: 2752, z: 2742 } }],
    delayTicks: [1, 4],
    animations: [[3487, 0], [-1, 0]]
  }],
  ['monkeybars_12573', {
    exactMoves: [
      { level: 2, startX: 2752, startZ: 2742, endX: 2752, endZ: 2742, startCycle: 0, endCycle: 49, direction: EXACT_DIRECTION.west },
      { level: 2, startX: 2752, startZ: 2742, endX: 2747, endZ: 2741, startCycle: 0, endCycle: 44, direction: EXACT_DIRECTION.west },
      { level: 0, startX: 2747, startZ: 2741, endX: 2747, endZ: 2741, startCycle: 0, endCycle: 45, direction: EXACT_DIRECTION.west }
    ],
    teleJumps: [{ from: { level: 2, x: 2747, z: 2741 }, to: { level: 0, x: 2747, z: 2741 } }],
    delayTicks: [1, 2, 2, 2],
    animations: [[3482, 0], [3483, 0], [3484, 0], [-1, 0]]
  }],
  ['monkeybars_12575', {
    exactMoves: [
      { level: 2, startX: 2747, startZ: 2741, endX: 2747, endZ: 2741, startCycle: 0, endCycle: 49, direction: EXACT_DIRECTION.east },
      { level: 2, startX: 2747, startZ: 2741, endX: 2752, endZ: 2742, startCycle: 0, endCycle: 44, direction: EXACT_DIRECTION.east },
      { level: 2, startX: 2752, startZ: 2742, endX: 2752, endZ: 2742, startCycle: 0, endCycle: 45, direction: EXACT_DIRECTION.east }
    ],
    teleJumps: [{ from: { level: 2, x: 2752, z: 2742 }, to: { level: 2, x: 2752, z: 2742 } }],
    delayTicks: [1, 2, 2, 2],
    animations: [[3482, 0], [3483, 0], [3484, 0], [-1, 0]]
  }],
  ['skull_slope_12576', {
    exactMoves: [{ level: 0, startX: 2747, startZ: 2741, endX: 2743, endZ: 2741, startCycle: 0, endCycle: 120, direction: EXACT_DIRECTION.west }],
    teleJumps: [],
    delayTicks: [1, 5],
    animations: [[3485, 0], [-1, 0]]
  }],
  ['rope_12578', {
    exactMoves: [{ level: 0, startX: 2751, startZ: 2731, endX: 2756, endZ: 2731, startCycle: 0, endCycle: 67, direction: EXACT_DIRECTION.east }],
    teleJumps: [],
    delayTicks: [1, 3],
    animations: [[3488, 0], [-1, 0]]
  }],
  ['tropical_tree_12618', {
    exactMoves: [{ level: 1, startX: 2758, startZ: 2734, endX: 2770, endZ: 2747, startCycle: 0, endCycle: 54, direction: EXACT_DIRECTION.north }],
    teleJumps: [
      { from: { level: 0, x: 2757, z: 2733 }, to: { level: 1, x: 2758, z: 2734 } },
      { from: { level: 1, x: 2770, z: 2747 }, to: { level: 0, x: 2770, z: 2747 } }
    ],
    delayTicks: [1, 2],
    animations: [[3494, 0], [-1, 0]]
  }]
]);
const FAILURE_PATHS = new Map([
  ['stepping_stone_12568', { landing: { level: 0, x: 2755, z: 2742 }, animation: 3489 }],
  ['tropical_tree', { landing: { level: 0, x: 2755, z: 2742 }, animation: 3492 }],
  ['monkeybars_12573', { landing: { level: 0, x: 2755, z: 2742 }, animation: 3493 }],
  ['monkeybars_12575', { landing: { level: 0, x: 2755, z: 2742 }, animation: 3493 }],
  ['skull_slope_12576', { landing: { level: 0, x: 2755, z: 2742 }, animation: 3486 }],
  ['rope_12578', { landing: { level: 0, x: 2751, z: 2731 }, animation: 3493 }],
  ['tropical_tree_12618', { landing: { level: 0, x: 2759, z: 2737 }, animation: 3493 }]
]);
const SUCCESS_RANDOM = 0;
const FAILURE_RANDOM = 1 - Number.EPSILON;
const HIT_SOUND_RANDOM = 0;
const locTriggers = new Map();
for (const stage of STAGES) {
  const script = ScriptProvider.getByTriggerSpecific(ServerTriggerType.OPLOC1, stage.id);
  assert(script, `${stage.trigger} is a directly compiled loc-type trigger`);
  assert.equal(script.name, stage.trigger);
  assert.equal(script.fileName, 'ape_atoll_course.rs2');
  locTriggers.set(stage.name, script);
}
const barsProcedure = ScriptProvider.getByName('[proc,ape_atoll_bars]');
assert(barsProcedure, 'the two bar directions share one packed procedure');
for (const name of ['monkeybars_12573', 'monkeybars_12575']) {
  const script = locTriggers.get(name);
  const calls = script.opcodes.flatMap((opcode, pc) => ScriptOpcodeNameMap.get(opcode) === 'GOSUB_WITH_PARAMS' ? [ScriptProvider.get(script.intOperands[pc])] : []);
  assert.equal(calls.filter(callee => callee?.id === barsProcedure.id).length, 1, `${name} calls the one shared bars procedure once`);
}
assert(greegreeTimerScript, 'the real greegree timer is packed');
assert(greegreeWieldScript, 'the real greegree Wield/Hold action is packed');

const courseProcedures = [
  'ape_atoll_ninja_form', 'ape_atoll_entry', 'ape_atoll_setup', 'ape_atoll_finish', 'ape_atoll_bars', 'ape_atoll_recover',
  'ape_atoll_success', 'ape_atoll_fail'
].map(name => {
  const script = ScriptProvider.getByName(`[proc,${name}]`);
  assert(script, `[proc,${name}] is packed`);
  assert.equal(script.fileName, 'ape_atoll_course.rs2');
  return script;
});
for (const script of [...locTriggers.values(), ...courseProcedures]) {
  for (const opcode of script.opcodes) {
    const name = ScriptOpcodeNameMap.get(opcode) ?? '';
    assert(!/(?:VARP|VARBIT)/.test(name), `${script.name} has no course varp/varbit state`);
  }
}
function withRandomStream(values, callback, allowUnused = false) {
  const original = JavaRandom.nextDouble;
  const observed = [];
  let index = 0;
  JavaRandom.nextDouble = function () {
    assert(index < values.length, `unexpected random opcode call ${index + 1}; stream has ${values.length} values`);
    const value = values[index++];
    assert(value >= 0 && value < 1, `test seam supplied invalid nextDouble value ${value}`);
    observed.push(value);
    return value;
  };
  try {
    const result = callback();
    if (!allowUnused) assert.equal(index, values.length, `random opcode consumed ${index}/${values.length} forced values`);
    return { result, observed };
  } finally {
    JavaRandom.nextDouble = original;
  }
}

function withPlayerTrace(player, callback) {
  const events = [];
  const methodNames = [
    'exactMove', 'teleport', 'teleJump', 'applyDamage', 'addXp', 'playAnimation', 'invDel', 'invAdd'
  ];
  const originalMethods = new Map(methodNames.map(name => [name, {
    descriptor: Object.getOwnPropertyDescriptor(Player.prototype, name),
    method: Player.prototype[name]
  }]));
  const originalInventoryDelete = Object.getOwnPropertyDescriptor(Inventory.prototype, 'delete');
  const originalWrite = player.write;
  const originalHandlers = new Map();
  const isPlayerState = state => state.self === player || state._activePlayer === player;
  const traceGosub = opcode => {
    const original = ScriptRunner.HANDLERS[opcode];
    assert.equal(typeof original, 'function', `opcode ${opcode} has a real ScriptRunner handler`);
    originalHandlers.set(opcode, original);
    ScriptRunner.HANDLERS[opcode] = state => {
      if (isPlayerState(state)) {
        const procedureId = opcode === ScriptOpcode.GOSUB_WITH_PARAMS
          ? state.intOperand
          : state.isp > 0 ? state.intStack[state.isp - 1] : undefined;
        const procedure = Number.isInteger(procedureId) ? ScriptProvider.get(procedureId) : null;
        if (procedure) events.push({ kind: 'call', name: procedure.name, tick: World.currentTick });
      }
      return original(state);
    };
  };
  traceGosub(ScriptOpcode.GOSUB);
  traceGosub(ScriptOpcode.GOSUB_WITH_PARAMS);
  const originalDelay = ScriptRunner.HANDLERS[ScriptOpcode.P_DELAY];
  assert.equal(typeof originalDelay, 'function', 'the real player delay opcode is installed');
  originalHandlers.set(ScriptOpcode.P_DELAY, originalDelay);
  ScriptRunner.HANDLERS[ScriptOpcode.P_DELAY] = state => {
    const trace = isPlayerState(state);
    const result = originalDelay(state);
    if (trace) events.push({ kind: 'delay', tick: World.currentTick, delayedUntil: player.delayedUntil });
    return result;
  };
  const originalReturn = ScriptRunner.HANDLERS[ScriptOpcode.RETURN];
  assert.equal(typeof originalReturn, 'function', 'the real procedure return opcode is installed');
  originalHandlers.set(ScriptOpcode.RETURN, originalReturn);
  ScriptRunner.HANDLERS[ScriptOpcode.RETURN] = state => {
    const name = isPlayerState(state) ? state.script.name : null;
    const result = originalReturn(state);
    if (['[proc,on_unequip]', '[proc,greegree_clearform_silent]', '[proc,update_bas]'].includes(name)) {
      events.push({
        kind: 'stateAfterProcedure',
        name,
        tick: World.currentTick,
        npcId: player.npcId,
        bas: BAS_FIELDS.map(field => player[field]),
        animProtect: player.animProtect,
        timers: [...player.timers.values()].map(timer => timer.script.name)
      });
    }
    return result;
  };
  const originalExactMove = Player.prototype.exactMove;
  const originalTeleport = Player.prototype.teleport;
  const originalTeleJump = Player.prototype.teleJump;
  const originalApplyDamage = Player.prototype.applyDamage;
  const originalAddXp = Player.prototype.addXp;
  const originalPlayAnimation = Player.prototype.playAnimation;
  const originalInvDel = Player.prototype.invDel;
  const originalInvAdd = Player.prototype.invAdd;
  const originalInventoryDeleteMethod = Inventory.prototype.delete;
  assert.equal(typeof originalExactMove, 'function', 'the real Player exactMove method exists');
  assert.equal(typeof originalTeleJump, 'function', 'the real PathingEntity teleJump method exists');
  assert.equal(typeof originalApplyDamage, 'function', 'the real Player applyDamage method exists');
  assert.equal(typeof originalAddXp, 'function', 'the real Player addXp method exists');
  assert.equal(typeof originalPlayAnimation, 'function', 'the real Player playAnimation method exists');
  assert.equal(typeof originalInvDel, 'function', 'the real Player inventory removal method exists');
  assert.equal(typeof originalInvAdd, 'function', 'the real Player inventory addition method exists');
  assert.equal(typeof originalInventoryDeleteMethod, 'function', 'the real Inventory delete method exists');
  Player.prototype.exactMove = function (...args) {
    if (this === player) {
      const [startX, startZ, endX, endZ, startCycle, endCycle, direction] = args;
      events.push({ kind: 'exactMove', level: this.level, startX, startZ, endX, endZ, startCycle, endCycle, direction });
    }
    return originalExactMove.apply(this, args);
  };
  Player.prototype.teleport = function (...args) {
    const event = this === player ? { kind: 'teleport', from: tileOf(this), to: null } : null;
    if (event) events.push(event);
    const result = originalTeleport.apply(this, args);
    if (event) event.to = tileOf(this);
    return result;
  };
  Player.prototype.teleJump = function (...args) {
    const event = this === player ? { kind: 'teleJump', from: tileOf(this), to: null } : null;
    if (event) events.push(event);
    const result = originalTeleJump.apply(this, args);
    if (event) event.to = tileOf(this);
    return result;
  };
  Player.prototype.applyDamage = function (...args) {
    const event = this === player
      ? { kind: 'applyDamage', amount: args[0], type: args[1], tile: tileOf(this), hitpointsBefore: this.levels[HITPOINTS], hitpointsAfter: null }
      : null;
    if (event) events.push(event);
    const result = originalApplyDamage.apply(this, args);
    if (event) event.hitpointsAfter = this.levels[HITPOINTS];
    return result;
  };
  Player.prototype.addXp = function (...args) {
    if (this === player) events.push({ kind: 'addXp', stat: args[0], xp: args[1] });
    return originalAddXp.apply(this, args);
  };
  Player.prototype.playAnimation = function (...args) {
    if (this === player) events.push({ kind: 'playAnimation', animation: args[0], delay: args[1] });
    return originalPlayAnimation.apply(this, args);
  };
  Player.prototype.invDel = function (...args) {
    const result = originalInvDel.apply(this, args);
    if (this === player && args[0] === WORN_INVENTORY && greegreeObjectIds.has(args[1]) && result > 0) {
      events.push({
        kind: 'wornItemRemoved',
        inventoryId: args[0],
        objectId: args[1],
        count: result,
        tick: World.currentTick,
        via: 'invDel'
      });
    }
    return result;
  };
  Player.prototype.invAdd = function (...args) {
    const result = originalInvAdd.apply(this, args);
    if (this === player && greegreeObjectIds.has(args[1]) && result > 0) {
      events.push({
        kind: 'inventoryItemAdded',
        inventoryId: args[0],
        objectId: args[1],
        count: result,
        tick: World.currentTick
      });
    }
    return result;
  };
  Inventory.prototype.delete = function (slot) {
    const item = this.get(slot);
    const result = originalInventoryDeleteMethod.call(this, slot);
    if (player.invs.get(WORN_INVENTORY) === this && item && greegreeObjectIds.has(item.id)) {
      events.push({
        kind: 'wornItemRemoved',
        inventoryId: this.type,
        objectId: item.id,
        count: item.count,
        tick: World.currentTick,
        via: 'delete'
      });
    }
    return result;
  };
  player.write = function (packet) {
    events.push({
      kind: 'packet',
      tick: World.currentTick,
      packet: canonicalJsonValue(packet)
    });
    return originalWrite.call(this, packet);
  };
  try {
    return { result: callback(events), events };
  } finally {
    for (const [name, { descriptor }] of originalMethods) {
      if (descriptor) Object.defineProperty(Player.prototype, name, descriptor);
      else delete Player.prototype[name];
    }
    if (originalInventoryDelete) Object.defineProperty(Inventory.prototype, 'delete', originalInventoryDelete);
    for (const [opcode, handler] of originalHandlers) ScriptRunner.HANDLERS[opcode] = handler;
    player.write = originalWrite;
  }
}

function assertSuccessfulPath(stage, events, delayTicks) {
  const expected = SUCCESS_PATHS.get(stage.name);
  assert(expected, `${stage.name} has a pinned published success path`);
  const setupIndex = events.findIndex(event => event.kind === 'call' && event.name === '[proc,ape_atoll_setup]');
  const rollIndex = events.findIndex(event => event.kind === 'call' && event.name === '[proc,ape_atoll_success]');
  const firstSuccessMovementIndex = events.findIndex(event => ['exactMove', 'teleJump'].includes(event.kind));
  assert(setupIndex >= 0 && setupIndex < rollIndex, `${stage.name} rolls only after valid setup`);
  assert(rollIndex >= 0 && rollIndex < firstSuccessMovementIndex, `${stage.name} rolls before its first success movement leg`);
  assert.equal(events.filter(event => event.kind === 'call' && event.name === '[proc,ape_atoll_success]').length, 1, `${stage.name} invokes the shared roll once`);
  assert.deepEqual(events.filter(event => event.kind === 'exactMove').map(({ kind, ...event }) => event), expected.exactMoves, `${stage.name} preserves its published exact-move legs, cycles and directions`);
  assert.deepEqual(events.filter(event => event.kind === 'teleJump').map(({ kind, ...event }) => event), expected.teleJumps, `${stage.name} preserves its published level-aware telejumps`);
  assert.deepEqual(events.filter(event => event.kind === 'playAnimation').map(event => [event.animation, event.delay]), expected.animations, `${stage.name} preserves its published animations and animation delays`);
  assert.deepEqual(delayTicks, expected.delayTicks, `${stage.name} preserves its published success delay schedule`);
  const awards = events.map((event, index) => ({ event, index })).filter(({ event }) => event.kind === 'addXp');
  assert.deepEqual(awards.map(({ event }) => [event.stat, event.xp]), [[AGILITY, stage.xp]], `${stage.name} preserves its one Agility award`);
  const finalMovementIndex = Math.max(...events.map((event, index) => ['exactMove', 'teleport', 'teleJump'].includes(event.kind) ? index : -1));
  assert(awards[0].index > finalMovementIndex, `${stage.name} awards XP only after all published movement legs`);
  assert.equal(events.filter(event => event.kind === 'applyDamage').length, 0, `${stage.name} success applies no damage`);
}

function finishDelayed(player, observedDelayTicks = null) {
  let boundaries = 0;
  while (player.activeScript) {
    assert.ok(boundaries++ < 100, 'each compiled obstacle has a finite delay schedule');
    const state = player.activeScript;
    assert.equal(state.execution, ScriptState.SUSPENDED, 'obstacle delay suspends the active script');
    assert(player.delayed, 'suspended obstacle keeps the player protected');
    assert(player.delayedUntil > World.currentTick, 'obstacle resumes on a future server tick');
    if (observedDelayTicks) observedDelayTicks.push(player.delayedUntil - World.currentTick);
    World.currentTick = player.delayedUntil;
    player.delayed = false;
    player.executeScript(state, true, true);
  }
  assert.equal(player.delayed, false, 'all scheduled obstacle delays are drained');
}
function finishConcurrent(players) {
  let boundaries = 0;
  while (players.some(player => player.activeScript)) {
    assert.ok(boundaries++ < 100, 'concurrent obstacle scripts have finite delay schedules');
    const active = players.filter(player => player.activeScript);
    World.currentTick = Math.max(World.currentTick, Math.min(...active.map(player => player.delayedUntil)));
    for (const player of active) {
      if (!player.activeScript || player.delayedUntil > World.currentTick) continue;
      const state = player.activeScript;
      assert.equal(state.execution, ScriptState.SUSPENDED, 'each concurrent player resumes a suspended script');
      player.delayed = false;
      player.executeScript(state, true, true);
    }
  }
}

function runSuccessfulStage(player, stage, { randomValues = [SUCCESS_RANDOM], allowUnusedRandom = false } = {}) {
  const script = locTriggers.get(stage.name);
  const loc = stageLoc(stage);
  const beforeXp = player.stats[AGILITY];
  const statsBefore = Array.from(player.stats);
  const levelsBefore = Array.from(player.levels);
  const baseLevelsBefore = Array.from(player.baseLevels);
  const messagesBefore = [...player.messages];
  const varsBefore = Array.from(player.vars);
  const delayTicks = [];
  const trace = withPlayerTrace(player, () => withRandomStream(randomValues, () => {
    const state = ScriptRunner.init(script, player, loc);
    player.executeScript(state, true, true);
    assert.equal(player.activeScript, state, `${stage.name} first suspends inside its protected setup`);
    assert.equal(state.execution, ScriptState.SUSPENDED, `${stage.name} starts through the packed delay`);
    const during = snapshot(player);
    const duplicate = ScriptRunner.init(script, player, loc);
    player.executeScript(duplicate, true);
    assert.deepEqual(snapshot(player), during, `${stage.name} duplicate click is refused while protected`);
    assert.equal(player.activeScript, state, `${stage.name} duplicate cannot replace the active attempt`);
    finishDelayed(player, delayTicks);
    assert.deepEqual(tileOf(player), stage.end, `${stage.name} settles at its exact endpoint`);
    assert.equal(player.stats[AGILITY] - beforeXp, stage.xp, `${stage.name} awards exactly ${stage.xp} internal tenths`);
    assert.deepEqual(Array.from(player.vars), varsBefore, `${stage.name} adds no player varp state`);
    const statsAfter = Array.from(player.stats);
    statsAfter[AGILITY] = statsBefore[AGILITY];
    assert.deepEqual(statsAfter, statsBefore, `${stage.name} awards no other skill XP`);
    assert.deepEqual(Array.from(player.levels), levelsBefore, `${stage.name} causes no damage or current-level change`);
    assert.deepEqual(Array.from(player.baseLevels), baseLevelsBefore, `${stage.name} causes no base-level change`);
    assert.deepEqual(player.messages, messagesBefore, `${stage.name} emits no course text`);
  }, allowUnusedRandom));
  assert.deepEqual(trace.result.observed, allowUnusedRandom ? [] : randomValues, `${stage.name} uses only the forced engine random values`);
  assertSuccessfulPath(stage, trace.events, delayTicks);
}

function assertRejected(player, stage, label) {
  const before = snapshot(player);
  const state = ScriptRunner.init(locTriggers.get(stage.name), player, stageLoc(stage));
  assert.equal(player.runScript(state, true, true), ScriptState.FINISHED, `${label} returns normally`);
  assert.deepEqual(snapshot(player), before, `${label} writes no movement, damage, XP, varp, appearance, animation, message or packet state`);
  assert.equal(player.activeScript, null, `${label} does not leave a suspended script`);
}

function startDeathTestTick() {
  World.currentTick = nextDeathTestTick;
  nextDeathTestTick = World.currentTick + 100;
}

// Contract values are names and equations, not observations of a death run.
const HUMAN_BAS = [
  'human_ready', 'human_turnonspot', 'human_walk_f', 'human_walk_b',
  'human_walk_l', 'human_walk_r', 'human_running'
].map(name => packId('seq', name));
const HUMAN_TABS = new Map([
  [0, 'combat_unarmed'], [1, 'stats'], [2, 'questlist'], [3, 'inventory'],
  [4, 'wornitems'], [5, 'prayer'], [6, 'magic'], [8, 'friends'],
  [9, 'ignore'], [10, 'logout'], [11, 'options'], [12, 'controls'], [13, 'music']
].map(([tab, name]) => [tab, packId('interface', name)]));
const varId = name => packId('varp', name);
const getVar = (player, name) => player.getVar(varId(name));
const setVar = (player, name, value) => player.setVar(varId(name), value);
const inventoryItems = (player, inventory) => (player.invs.get(inventory)?.items ?? [])
  .filter(Boolean).map(({ id, count }) => ({ id, count }));
const byObjectId = (left, right) => left.id - right.id;

function appearanceRightHand(appearance) {
  // 377 appearance starts with gender and the two head-icon bytes.
  let offset = 3;
  for (let slot = 0; slot <= RIGHT_HAND; slot++) {
    const high = appearance[offset++];
    const value = high === 0 ? 0 : (high << 8) | appearance[offset++];
    if (slot === RIGHT_HAND) return value;
  }
}

function respawnSquare() {
  // Default Lumbridge anchor 0_50_50_21_18, radius 2. Sample zero selects
  // the first reachable tile in coordinate order, using the current collision map.
  const anchor = { level: 0, x: 50 * 64 + 21, z: 50 * 64 + 18 };
  const candidates = [];
  for (let x = anchor.x - 2; x <= anchor.x + 2; x++) {
    for (let z = anchor.z - 2; z <= anchor.z + 2; z++) {
      if (!Environment.NODE_MEMBERS && !World.gameMap.isFreeToPlay(x, z)) continue;
      if (!isMapBlocked(x, z, 0) && isLineOfWalk(0, x, z, anchor.x, anchor.z)) {
        candidates.push({ level: 0, x, z });
      }
    }
  }
  assert(candidates.length > 0, 'the independent respawn oracle has a reachable square');
  return candidates[Math.floor(DEATH_RESPAWN_RANDOM * candidates.length)];
}

function deathExpectation(player) {
  const carried = [
    ...inventoryItems(player, MAIN_INVENTORY),
    ...inventoryItems(player, WORN_INVENTORY)
  ];
  const destroyOnDeath = ParamType.getId('destroy_death');
  const eligible = carried.filter(item =>
    ObjType.get(item.id).cost > 0 && ObjType.get(item.id).params.get(destroyOnDeath) !== 1
  ).sort((left, right) => ObjType.get(right.id).cost - ObjType.get(left.id).cost);
  // All death fixtures use distinct, nonstackable, single-count objects.
  assert(carried.every(item => item.count === 1 && !ObjType.get(item.id).stackable));
  assert.equal(new Set(carried.map(item => item.id)).size, carried.length);
  const keepCount = (getVar(player, 'pk_skull') > 0 ? 0 : 3) + (getVar(player, 'prayer8') === 1 ? 1 : 0);
  const kept = eligible.slice(0, keepCount);
  const keptIds = new Set(kept.map(item => item.id));
  return {
    kept: kept.sort(byObjectId),
    drops: [...carried.filter(item => !keptIds.has(item.id)), { id: packId('obj', 'bones'), count: 1 }]
      .map(item => ({ ...item, tile: tileOf(player), owner: '-1', duration: 200 }))
      .sort(byObjectId),
    tile: respawnSquare(),
    stats: Array.from(player.stats),
    levels: Array.from(player.baseLevels),
    body: [...player.body],
    colors: [...player.colors],
    endTick: World.currentTick + (1 + 1) + (3 + 1)
  };
}

function assertOrdinaryDeath(player, death, expected) {
  assert.deepEqual(tileOf(player), expected.tile, 'ordinary death uses the independent Lumbridge respawn square');
  assert.deepEqual(inventoryItems(player, MAIN_INVENTORY).sort(byObjectId), expected.kept,
    'ordinary death independently keeps the priciest eligible items');
  assert.deepEqual(inventoryItems(player, WORN_INVENTORY), [], 'ordinary death empties worn equipment');
  assert.deepEqual(inventoryItems(player, packId('inv', 'deathkeep')), [], 'ordinary death empties its temporary kept-item inventory');
  assert.deepEqual(death.drops.sort(byObjectId), expected.drops, 'ordinary death drops the remaining items and bones at the death tile');
  assert.deepEqual(Array.from(player.levels), expected.levels, 'ordinary death resets every current stat to its base');
  assert.deepEqual(Array.from(player.baseLevels), expected.levels, 'ordinary death preserves every base level');
  assert.deepEqual(Array.from(player.stats), expected.stats, 'ordinary death preserves every skill XP value');
  assert.deepEqual(player.body, expected.body, 'ordinary death preserves body choices');
  assert.deepEqual(player.colors, expected.colors, 'ordinary death preserves appearance colours');
  assert.equal(player.modalMain, -1, 'ordinary death closes the open main interface');
  assert.equal(player.headicons, 0, 'ordinary death clears the active prayer head icon');
  assert.equal(player.appearanceInv, WORN_INVENTORY, 'ordinary death uses worn equipment for its appearance');
  assert(player.masks & PlayerInfoProt.APPEARANCE, 'ordinary death marks its post-drop appearance for transmission');
  const appearance = player.generateAppearance();
  assert.equal(appearanceRightHand(appearance), 0, 'ordinary death transmits no dropped right-hand object');
  assert.equal(appearance[2], 0xff, 'ordinary death transmits no prayer head icon');
  assert.equal(player.runenergy, 10000, 'ordinary death fully restores run energy');
  for (const name of ['death', 'pk_skull', 'poison', 'prayer_drain_effect', 'prayer_drain_counter',
    ...Array.from({ length: 15 }, (_, index) => `prayer${index}`)]) {
    assert.equal(getVar(player, name), 0, `ordinary death clears ${name}`);
  }
  assert.equal(player.npcId, -1, 'ordinary death clears the getter form');
  assert.equal(player.animProtect, 0, 'ordinary death clears form animation protection');
  assert.deepEqual(BAS_FIELDS.map(field => player[field]), HUMAN_BAS, 'ordinary death derives all seven human BAS values by name');
  for (const [tab, component] of HUMAN_TABS) {
    assert.equal(player.tabs[tab], component, `ordinary death restores tab ${tab}`);
    const packet = player.packets.filter(packet => packet.constructor.name === 'IfSetTab' && packet.tab === tab).at(-1);
    assert(packet, `ordinary death transmits restored tab ${tab}`);
    assert.equal(packet.component, component, `ordinary death transmits the expected component for tab ${tab}`);
  }
  assert.deepEqual(player.messages, ['Oh dear you are dead!'], 'ordinary death emits its death message without extra form text');
  assert.equal(player.animId, -1, 'ordinary death clears its death animation');
  assert.equal(player.spotanimId, -1, 'ordinary death has no revert spot animation');
  assert.equal(player.activeScript, null, 'ordinary death leaves no suspended script');
  assert.equal(player.protect, false, 'ordinary death releases player protection');
  assert.equal(player.delayed, false, 'ordinary death releases the delay');
  assert.equal(World.currentTick, expected.endTick, 'ordinary death settles both native delays');
  assert(death.events.some(event => event.kind === 'playAnimation' && event.animation === packId('seq', 'human_death')),
    'ordinary death actually plays the human death animation');
  const jingle = player.packets.filter(packet => packet.constructor.name === 'MidiJingle').at(-1);
  assert(jingle, 'ordinary death actually transmits its death jingle');
  assert.equal(jingle.id, packId('midi', 'death2'), 'ordinary death transmits the named death2 jingle');
  assert(![...player.timers.values()].some(timer =>
    [greegreeTimerScript.name, '[timer,prayer_drain]', '[softtimer,pk_skull_timer]'].includes(timer.script.name)),
  'ordinary death clears form, prayer and skull timers');
  assert(![...player.queue.all()].some(request => request.script.id === deathQueue.id),
    'ordinary death clears its pending death queue');
}
let ordinaryDeathCases = 0;
function runDeathQueue(player) {
  const expected = deathExpectation(player);
  const originalRandom = Math.random;
  const originalAddObj = World.addObj;
  const drops = [];
  let randomCalls = 0;
  let trace;
  Math.random = () => {
    assert.equal(++randomCalls, 1, 'ordinary death consumes only its one real respawn-square random sample');
    return DEATH_RESPAWN_RANDOM;
  };
  World.addObj = function (object, owner, duration) {
    drops.push({ tile: tileOf(object), id: object.type, count: object.count, owner: String(owner), duration });
    return originalAddObj.apply(this, arguments);
  };
  try {
    trace = withPlayerTrace(player, () => {
      const state = ScriptRunner.init(deathQueue, player, null, []);
      player.executeScript(state, true, true);
      assert.equal(state.execution, ScriptState.SUSPENDED, 'real death queue reaches its first production delay');
      assert.equal(player.activeScript, state, 'real death queue owns the active player script');
      finishDelayed(player);
      assert.equal(state.execution, ScriptState.FINISHED, 'real death queue drains every production delay');
      assert.equal(player.activeScript, null, 'real death queue leaves no active script');
    });
  } finally {
    Math.random = originalRandom;
    World.addObj = originalAddObj;
  }
  assert.equal(randomCalls, 1, 'ordinary death executes the production respawn-square sampler');
  const death = { events: trace.events, drops, inventories: inventorySnapshot(player) };
  assertOrdinaryDeath(player, death, expected);
  ordinaryDeathCases++;
  return death;
}

let humanDeathCases = 0;
let monkeyDeathRepairCases = 0;
let greegreeReequipCases = 0;
let unmatchedGreegreeDeathControlCases = 0;
const keepWitnesses = new Set();
for (const skulled of [false, true]) for (const protectItem of [false, true]) {
  startDeathTestTick();
  const player = makePlayer(48, null, STAGES[0].start);
  for (let stat = 0; stat < player.levels.length; stat++) {
    player.setLevel(stat, 30 + stat);
    player.levels[stat] = stat % 2 ? 1 : player.baseLevels[stat] + 5;
  }
  player.levels[HITPOINTS] = 0;
  player.runenergy = 1234;
  setVar(player, 'poison', 6);
  setVar(player, 'pk_skull', skulled ? World.currentTick + 100 : 0);
  setVar(player, 'prayer8', protectItem ? 1 : 0);
  setVar(player, 'prayer0', 1);
  setVar(player, 'prayer12', 1);
  setVar(player, 'prayer_drain_effect', 50);
  setVar(player, 'prayer_drain_counter', 20);
  const objects = ['bronze_sword', 'iron_sword', 'steel_sword', 'mithril_sword', 'adamant_sword']
    .map(name => packId('obj', name));
  player.invSet(WORN_INVENTORY, objects[0], 1, RIGHT_HAND);
  objects.slice(1).forEach((id, slot) => player.invSet(MAIN_INVENTORY, id, 1, slot));
  player.openMainModal(packId('interface', 'welcome_screen'));
  assert.notEqual(player.modalMain, -1, 'interface closure starts with an open main interface');
  player.headicons = 1 << 5; // 377 protection-from-magic appearance bit, matching prayer12.
  player.buildAppearance(WORN_INVENTORY);
  const appearanceBefore = player.generateAppearance();
  assert.equal(appearanceRightHand(appearanceBefore), 0x200 + objects[0],
    'the pre-death appearance actually displays the worn sword');
  assert.notEqual(appearanceBefore[2], 0xff, 'prayer-icon clearing starts with a visible protection icon');
  player.masks &= ~PlayerInfoProt.APPEARANCE;
  assert.equal(player.masks & PlayerInfoProt.APPEARANCE, 0,
    'the pre-death appearance has no pending appearance update');
  const expectedKeepCount = (skulled ? 0 : 3) + (protectItem ? 1 : 0);
  assert(player.levels.every((level, stat) => level !== player.baseLevels[stat]),
    'every stat reset has a non-base witness before death');
  assert(new Set(objects.map(id => ObjType.get(id).cost)).size === objects.length,
    'item selection has distinct-price witnesses');
  const death = runDeathQueue(player);
  assert.equal(inventoryItems(player, MAIN_INVENTORY).length, expectedKeepCount, 'the keep-policy fixture exercises its required retained count');
  assert.equal(death.drops.length, objects.length - expectedKeepCount + 1, 'the keep-policy fixture exercises actual losses plus bones');
  keepWitnesses.add(expectedKeepCount);
  assert.equal(death.events.filter(event => event.kind === 'call' && event.name === '[proc,on_unequip]').length, 0,
    'ordinary human death does not invoke the greegree Remove reset');
  humanDeathCases++;
}
assert.deepEqual([...keepWitnesses].sort((a, b) => a - b), [0, 1, 3, 4],
  'ordinary human death actually exercises every skull/protect-item keep policy');

for (const form of ninjaForms) {
  const objectId = packId('obj', form.object);
  startDeathTestTick();
  const unmatched = makePlayer(48, null, STAGES[0].start);
  unmatched.invSet(WORN_INVENTORY, objectId, 1, RIGHT_HAND);
  const unmatchedDeath = runDeathQueue(unmatched);
  assert.equal(
    unmatchedDeath.events.filter(event => event.kind === 'call' && event.name === '[proc,on_unequip]').length,
    0,
    `${form.label} item without its matching getter form does not trigger the death reset`
  );
  unmatchedGreegreeDeathControlCases++;

  startDeathTestTick();
  const player = makePlayer(48, null, STAGES[0].start);
  const transformPacketStart = player.packets.length;
  transform(player, form);
  const transformedBas = BAS_FIELDS.map(field => player[field]);
  assert.equal(player.npcId, packId('npc', form.npc), `${form.label} starts from its real packed getter form`);
  assert(
    [...player.timers.values()].some(timer => timer.script.name === greegreeTimerScript.name),
    `${form.label} starts with the real Remove-owned greegree timer`
  );
  const transformedTabPacket = player.packets
    .slice(transformPacketStart)
    .filter(packet => packet.constructor.name === 'IfSetTab')
    .at(-1);
  assert(transformedTabPacket, `${form.label} transform writes the real magic-tab removal packet`);
  assert.equal(player.tabs[transformedTabPacket.tab], transformedTabPacket.component, `${form.label} fixture records its transformed tab state`);

  const death = runDeathQueue(player);
  const removalIndex = death.events.findIndex(event =>
    event.kind === 'wornItemRemoved' && event.inventoryId === WORN_INVENTORY && event.objectId === objectId
  );
  assert(removalIndex >= 0, `${form.label} death executes the real worn-item removal`);
  const resetIndex = death.events.findIndex((event, index) =>
    index > removalIndex && event.kind === 'call' && event.name === '[proc,greegree_clearform_silent]'
  );
  assert(resetIndex > removalIndex, `${form.label} death calls the silent reset after the item leaves worn`);
  assert.equal(
    death.events.filter(event => event.kind === 'call' && event.name === '[proc,greegree_clearform_silent]').length,
    1,
    `${form.label} death invokes the shared silent reset exactly once`
  );
  const inventoryAddIndex = death.events.findIndex(event =>
    event.kind === 'inventoryItemAdded' && event.inventoryId === MAIN_INVENTORY && event.objectId === objectId
  );
  assert(inventoryAddIndex > removalIndex && inventoryAddIndex < resetIndex, `${form.label} death records the real kept-item move into inventory before reset`);
  assert.equal(death.events[inventoryAddIndex].tick, death.events[removalIndex].tick, `${form.label} kept-item inventory move shares the removal tick`);
  assert.equal(death.events[resetIndex].tick, death.events[removalIndex].tick, `${form.label} reset shares the worn-item move's World tick`);
  assert.deepEqual(
    death.events.slice(removalIndex + 1, resetIndex).filter(event => event.kind === 'delay'),
    [],
    `${form.label} death inserts no delay between worn-item removal and reset`
  );
  assert.equal(
    death.events.filter(event => event.kind === 'wornItemRemoved' && event.objectId === objectId).length,
    1,
    `${form.label} death removes its worn greegree exactly once`
  );
  const resetState = death.events.find(event =>
    event.kind === 'stateAfterProcedure' && event.name === '[proc,greegree_clearform_silent]'
  );
  assert(resetState, `${form.label} records the actual completed silent reset`);
  assert.equal(resetState.tick, death.events[removalIndex].tick, `${form.label} actual form reset shares the item-move tick`);
  assert.equal(resetState.npcId, -1, `${form.label} getter form is clear when silent reset returns`);
  assert.equal(resetState.animProtect, 0, `${form.label} silent reset clears protection in the item-move tick`);
  assert(!resetState.timers.includes(greegreeTimerScript.name), `${form.label} Remove clears its timer in the item-move tick`);
  const basState = death.events.find(event =>
    event.kind === 'stateAfterProcedure' && event.name === '[proc,update_bas]'
  );
  assert(basState, `${form.label} records the actual completed BAS derivation`);
  assert.equal(basState.tick, death.events[removalIndex].tick, `${form.label} all BAS fields restore in the item-move tick`);
  assert.deepEqual(
    basState.bas,
    HUMAN_BAS,
    `${form.label} item-move tick derives all seven human BAS values`
  );

  assert.equal(player.npcId, -1, `${form.label} death clears the actual getter form`);
  assert.deepEqual(
    BAS_FIELDS.map(field => player[field]),
    HUMAN_BAS,
    `${form.label} death restores all seven human BAS values`
  );
  assert.equal(player.animProtect, 0, `${form.label} death clears Remove-owned animation protection`);
  assert(
    ![...player.timers.values()].some(timer => timer.script.name === greegreeTimerScript.name),
    `${form.label} death clears the real Remove-owned greegree timer`
  );
  const restoredTabPacket = player.packets
    .slice(transformPacketStart)
    .filter(packet => packet.constructor.name === 'IfSetTab' && packet.tab === transformedTabPacket.tab)
    .at(-1);
  assert(restoredTabPacket, `${form.label} death sends the real tab restoration packet`);
  assert.notEqual(restoredTabPacket.component, transformedTabPacket.component, `${form.label} death reverses the transform's tab change`);
  assert.equal(
    restoredTabPacket.component,
    player.tabs[restoredTabPacket.tab],
    `${form.label} tab restoration packet matches the final player tab state`
  );
  assert.deepEqual(
    death.inventories,
    unmatchedDeath.inventories,
    `${form.label} death preserves the ordinary kept-item allocation`
  );
  assert.deepEqual(
    player.messages,
    ['Oh dear you are dead!'],
    `${form.label} death adds no player-visible text`
  );
  assert.equal(death.events.filter(event => event.kind === 'call' && event.name === '[proc,on_unequip]').length, 0,
    `${form.label} death never invokes Remove's visible/sound effects`);
  assert.equal(player.spotanimId, -1, `${form.label} respawn has no revert spot animation`);
  assert.equal(death.events.filter(event => event.kind === 'packet' && event.packet.$type === 'SynthSound').length, 0,
    `${form.label} death emits no greegree revert sound`);
  monkeyDeathRepairCases++;

  // A disclosed position fixture returns to the valid Ape region, not a form seed.
  player.level = STAGES[0].start.level;
  player.x = STAGES[0].start.x;
  player.z = STAGES[0].start.z;
  const inventory = player.getInventory(MAIN_INVENTORY);
  const greegreeSlot = inventory.getItemIndex(objectId);
  assert(greegreeSlot >= 0, `${form.label} ordinary death keeps its greegree available for a real re-wield`);
  player.lastSlot = greegreeSlot;
  const wieldState = ScriptRunner.init(greegreeWieldScript, player, null, []);
  assert.equal(player.runScript(wieldState, true, true), ScriptState.FINISHED, `${form.label} real Wield/Hold action finishes at an Ape tile`);
  assert.equal(
    player.getInventory(WORN_INVENTORY)?.get(RIGHT_HAND)?.id,
    objectId,
    `${form.label} real Wield/Hold moves the greegree back to worn`
  );
  assert.equal(player.npcId, packId('npc', form.npc), `${form.label} real Wield/Hold restores the actual getter form`);
  assert.deepEqual(BAS_FIELDS.map(field => player[field]), transformedBas, `${form.label} real Wield/Hold restores all seven transformed BAS values`);
  assert.equal(player.animProtect, 1, `${form.label} real Wield/Hold restores animation protection`);
  assert(
    [...player.timers.values()].some(timer => timer.script.name === greegreeTimerScript.name),
    `${form.label} real Wield/Hold rearms the real greegree timer`
  );
  greegreeReequipCases++;
  const unequip = ScriptProvider.getByName('[proc,unequip]');
  assert(unequip, 'ordinary Remove is packed');
  const removePacketStart = player.packets.length;
  const remove = withPlayerTrace(player, () => {
    assert.equal(player.runScript(ScriptRunner.init(unequip, player, null, [RIGHT_HAND]), true, true),
      ScriptState.FINISHED, `${form.label} real Remove finishes`);
  });
  const cleared = remove.events.find(event =>
    event.kind === 'stateAfterProcedure' && event.name === '[proc,greegree_clearform_silent]');
  assert(cleared, `${form.label} Remove actually executes the shared reset`);
  assert.equal(cleared.npcId, -1, `${form.label} Remove clears form before its visible effects`);
  assert.equal(cleared.animProtect, 0, `${form.label} Remove clears animation protection`);
  assert(!cleared.timers.includes(greegreeTimerScript.name), `${form.label} Remove clears its timer`);
  assert.deepEqual(BAS_FIELDS.map(field => player[field]), HUMAN_BAS, `${form.label} Remove restores human BAS`);
  assert.equal(player.tabs[6], HUMAN_TABS.get(6), `${form.label} Remove restores the magic tab`);
  const tabPacket = player.packets.slice(removePacketStart).find(packet =>
    packet.constructor.name === 'IfSetTab' && packet.tab === 6);
  assert.equal(tabPacket?.component, HUMAN_TABS.get(6), `${form.label} Remove transmits the restored magic tab`);
  assert.equal(player.npcId, -1, `${form.label} Remove still clears form`);
  assert.equal(player.spotanimId, packId('spotanim', 'windwave_impact'), `${form.label} Remove retains its published spot animation`);
  assert.equal(player.spotanimHeight, 124, `${form.label} Remove retains its spot-animation height`);
  assert.equal(player.spotanimTime, 0, `${form.label} Remove starts its spot animation without delay`);
  const sounds = remove.events.filter(event => event.kind === 'packet' && event.packet.$type === 'SynthSound');
  assert.equal(sounds.length, 1, `${form.label} Remove retains its one published revert sound`);
  assert.deepEqual(sounds[0].packet.fields, {
    synth: packId('synth', form.accepted ? 'smallmonkey_into_human' : 'monkey_into_human'),
    loops: 0, delay: 0
  }, `${form.label} Remove emits the expected native revert sound`);
}

// The donor policy covers any NPC form, not only a matching worn greegree.
const otherForm = makePlayer(48, null, STAGES[0].start);
otherForm.npcId = packId('npc', 'imp');
runDeathQueue(otherForm);
assert.equal(otherForm.npcId, -1, 'ordinary death clears a non-greegree NPC form too');

assert.equal(humanDeathCases, 4, 'every skull/protect-item human death case is exercised');
assert.equal(ordinaryDeathCases, humanDeathCases + 2 * ninjaForms.length + 1,
  'all human, transformed, unmatched-greegree and unrelated-form deaths satisfy the independent contract');
assert.equal(monkeyDeathRepairCases, ninjaForms.length, 'all three configured greegree forms clear on ordinary death');
assert.equal(greegreeReequipCases, ninjaForms.length, 'all three configured greegree forms restore through real Wield/Hold');
assert.equal(unmatchedGreegreeDeathControlCases, ninjaForms.length, 'all three untransformed greegree controls avoid the death reset');

let matrixCases = 0;
let rejectedCases = 0;
let successfulCases = 0;
const forms = [
  { label: 'human', form: null, accepted: false },
  ...ninjaForms.map(form => ({ label: form.label, form, accepted: form.accepted }))
];
for (const stage of STAGES) {
  for (const level of [47, 48]) {
    for (const form of forms) {
      const player = makePlayer(level, form.form, stage.start);
      if (form.form) assert.equal(player.npcId, packId('npc', form.form.npc), `${form.label} fixture uses Player.npcId`);
      else assert.equal(player.npcId, -1, 'human fixture is the normal Player form');
      const allowed = level >= 48 && form.accepted;
      if (allowed) {
        runSuccessfulStage(player, stage);
        successfulCases++;
      } else {
        assertRejected(player, stage, `${stage.name}, base Agility ${level}, ${form.label}`);
        rejectedCases++;
      }
      matrixCases++;
    }
  }
}
assert.equal(matrixCases, 56, 'all seven loc handlers cover the complete 2-level by 4-form entry matrix');
assert.equal(rejectedCases, 42, 'all low-level, human and unsupported-monkey entries refuse');
assert.equal(successfulCases, 14, 'both supported ninja forms pass every handler at level 48');

// The entry opcode reads base Agility, not a temporarily boosted/debuffed current level.
const boostedLowBase = makePlayer(47, ninjaForms[0], STAGES[0].start);
boostedLowBase.levels[AGILITY] = 99;
assertRejected(boostedLowBase, STAGES[0], 'base Agility 47 with current Agility boosted to 99');
const debuffedQualifiedBase = makePlayer(48, ninjaForms[0], STAGES[0].start);
debuffedQualifiedBase.levels[AGILITY] = 1;
runSuccessfulStage(debuffedQualifiedBase, STAGES[0]);

// A mid-course form change is observed again by the next independently protected entry.
const changedFormPlayer = makePlayer(48, ninjaForms[0], STAGES[0].start);
runSuccessfulStage(changedFormPlayer, STAGES[0]);
changedFormPlayer.level = STAGES[1].start.level;
changedFormPlayer.x = STAGES[1].start.x;
changedFormPlayer.z = STAGES[1].start.z;
transform(changedFormPlayer, ninjaForms[2]);
assertRejected(changedFormPlayer, STAGES[1], 'mid-course normal-monkey form');
transform(changedFormPlayer, ninjaForms[1]);
runSuccessfulStage(changedFormPlayer, STAGES[1]);

// Full course order checks each settled award, no lap bonus, current form and repeatability.
const lapPlayer = makePlayer(48, ninjaForms[0], STAGES[0].start);
const lapVars = Array.from(lapPlayer.vars);
const lapOrder = [STAGES[0], STAGES[1], STAGES[2], STAGES[4], STAGES[5], STAGES[6]];
const lapAwards = [];
const lapStartXp = lapPlayer.stats[AGILITY];
// Direct OPLOC1 dispatch bypasses the engine's ordinary approach walking. Seed each
// handler's valid stand, not an out-of-range click; the live cell proves the walks.
for (const stage of lapOrder) {
  lapPlayer.level = stage.start.level;
  lapPlayer.x = stage.start.x;
  lapPlayer.z = stage.start.z;
  const before = lapPlayer.stats[AGILITY];
  runSuccessfulStage(lapPlayer, stage);
  lapAwards.push(lapPlayer.stats[AGILITY] - before);
  assert.equal(lapPlayer.npcId, packId('npc', ninjaForms[0].npc), `${stage.name} preserves the current form`);
}
assert.deepEqual(lapAwards, [400, 400, 400, 600, 1000, 3000]);
assert.equal(lapPlayer.stats[AGILITY] - lapStartXp, 5800, 'the ordered six-step rewards total 580 displayed XP in tenths');
assert.deepEqual(Array.from(lapPlayer.vars), lapVars, 'a full lap stores no course state');
const firstLapEndXp = lapPlayer.stats[AGILITY];
for (const stage of lapOrder) {
  lapPlayer.level = stage.start.level;
  lapPlayer.x = stage.start.x;
  lapPlayer.z = stage.start.z;
  runSuccessfulStage(lapPlayer, stage);
}
assert.equal(lapPlayer.stats[AGILITY] - firstLapEndXp, 5800, 'a second lap awards the same six steps with no replay lock or bonus');
assert.deepEqual(Array.from(lapPlayer.vars), lapVars, 'repeat use still stores no course state');

// Separate players can hold the same protected obstacle concurrently; there is no world-wide lock.
const concurrentPlayers = [makePlayer(48, ninjaForms[0], STAGES[0].start), makePlayer(48, ninjaForms[1], STAGES[0].start)];
const concurrentXpBefore = concurrentPlayers.map(player => player.stats[AGILITY]);
const concurrentRolls = withRandomStream([SUCCESS_RANDOM, SUCCESS_RANDOM], () => {
  for (const player of concurrentPlayers) {
    const state = ScriptRunner.init(locTriggers.get(STAGES[0].name), player, stageLoc(STAGES[0]));
    player.executeScript(state, true, true);
    assert.equal(player.activeScript, state, 'each player owns an independent protected attempt');
  }
  finishConcurrent(concurrentPlayers);
});
assert.deepEqual(concurrentRolls.observed, [SUCCESS_RANDOM, SUCCESS_RANDOM], 'concurrent successes use the shared engine random seam deterministically');
for (const [index, player] of concurrentPlayers.entries()) {
  assert.equal(player.stats[AGILITY] - concurrentXpBefore[index], 400, 'both concurrent players settle their own stone award');
}

const FAILURE_HP_CASES = [
  { label: '3-damage lower clamp', hitpoints: 20, damage: 3 },
  { label: 'interior damage', hitpoints: 50, damage: 5 },
  { label: '7-damage upper clamp', hitpoints: 90, damage: 7 },
  { label: 'lethal low HP', hitpoints: 2, damage: 3 }
];
let failureCases = 0;
for (const stage of STAGES) {
  for (const hpCase of FAILURE_HP_CASES) {
    const failure = FAILURE_PATHS.get(stage.name);
    assert(failure, `${stage.name} has a pinned candidate failure landing and animation`);
    const player = makePlayer(48, ninjaForms[0], stage.start);
    player.levels[AGILITY] = 74;
    player.setLevel(HITPOINTS, 99);
    player.levels[HITPOINTS] = hpCase.hitpoints;
    const beforeXp = player.stats[AGILITY];
    const beforeStats = Array.from(player.stats);
    const beforeBas = BAS_FIELDS.map(field => player[field]);
    const priorDeathQueues = [...player.queue.all()].filter(request => request.script.id === deathQueue.id).length;
    const trace = withPlayerTrace(player, () => withRandomStream([FAILURE_RANDOM, HIT_SOUND_RANDOM], () => {
      const state = ScriptRunner.init(locTriggers.get(stage.name), player, stageLoc(stage));
      player.executeScript(state, true, true);
      assert.equal(player.activeScript, state, `${stage.name} failure first suspends inside valid setup`);
      assert.equal(state.execution, ScriptState.SUSPENDED);
      finishDelayed(player);
      assert.equal(player.activeScript, null, `${stage.name} failure returns without leaving a suspended script`);
    }));
    const events = trace.events;
    assert.deepEqual(trace.result.observed, [FAILURE_RANDOM, HIT_SOUND_RANDOM], `${stage.name} consumes its forced failure roll and real damage sound roll`);
    const callNames = events.filter(event => event.kind === 'call').map(event => event.name);
    const setupIndex = events.findIndex(event => event.kind === 'call' && event.name === '[proc,ape_atoll_setup]');
    const rollIndex = events.findIndex(event => event.kind === 'call' && event.name === '[proc,ape_atoll_success]');
    const failIndex = events.findIndex(event => event.kind === 'call' && event.name === '[proc,ape_atoll_fail]');
    const damageSelfIndex = events.findIndex(event => event.kind === 'call' && event.name === '[proc,damage_self]');
    const damageIndex = events.findIndex(event => event.kind === 'applyDamage');
    const updateBasIndex = events.findIndex(event => event.kind === 'call' && event.name === '[proc,update_bas]');
    assert(setupIndex >= 0 && setupIndex < rollIndex, `${stage.name} checks failure only after valid setup`);
    assert(rollIndex >= 0 && rollIndex < failIndex, `${stage.name} failure follows its shared roll`);
    assert.equal(events.filter(event => event.kind === 'call' && event.name === '[proc,ape_atoll_success]').length, 1, `${stage.name} calls the shared roll once`);
    assert.equal(events.filter(event => event.kind === 'call' && event.name === '[proc,ape_atoll_fail]').length, 1, `${stage.name} calls the real failure procedure once`);
    assert(failIndex < damageSelfIndex && damageSelfIndex < damageIndex, `${stage.name} lands and restores before invoking real damage_self`);
    assert(updateBasIndex > failIndex && updateBasIndex < damageSelfIndex, `${stage.name} restores the current form BAS before damage`);
    assert.equal(callNames.filter(name => name === '[proc,damage_self]').length, 1, `${stage.name} invokes real damage_self exactly once`);
    assert.equal(callNames.includes('[proc,ape_atoll_finish]'), false, `${stage.name} failure never reaches the success award procedure`);
    const failureAnimations = events.filter(event => event.kind === 'playAnimation' && event.animation === failure.animation);
    assert.equal(failureAnimations.length, 1, `${stage.name} plays its candidate failure animation`);
    const damageResetIndex = events.findIndex((event, index) => index < damageIndex && event.kind === 'playAnimation' && event.animation === -1);
    assert(damageResetIndex > failIndex, `${stage.name} restores the animation before damage`);
    const damageEvents = events.filter(event => event.kind === 'applyDamage');
    assert.equal(damageEvents.length, 1, `${stage.name} applies exactly one real hit`);
    const damage = damageEvents[0];
    assert.deepEqual(damage.tile, failure.landing, `${stage.name} is already on its landing tile at the real damage call`);
    assert.equal(damage.hitpointsBefore, hpCase.hitpoints, `${stage.name} damages the current Hitpoints fixture`);
    assert.equal(damage.amount, hpCase.damage, `${stage.name} uses the expected ${hpCase.damage}-damage envelope`);
    assert.equal(damage.hitpointsAfter, Math.max(0, hpCase.hitpoints - hpCase.damage), `${stage.name} mutates HP through the engine damage method`);
    const movementBeforeDamage = events.slice(0, damageIndex).filter(event => ['exactMove', 'teleJump'].includes(event.kind));
    assert.equal(movementBeforeDamage.length > 0, true, `${stage.name} performs its real landing movement before damage`);
    const failureExactMoves = movementBeforeDamage.filter(event => event.kind === 'exactMove');
    assert.equal(failureExactMoves.length, 1, `${stage.name} uses one exact-move landing leg`);
    const exactMove = failureExactMoves[0];
    assert.equal(exactMove.level, stage.start.level, `${stage.name} exact-move remains on the current plane`);
    if (stage.start.level === failure.landing.level) {
      assert.deepEqual(
        { x: exactMove.startX, z: exactMove.startZ, endX: exactMove.endX, endZ: exactMove.endZ },
        { x: stage.start.x, z: stage.start.z, endX: failure.landing.x, endZ: failure.landing.z },
        `${stage.name} exact-moves from its setup stand to the same-plane landing`
      );
      assert.deepEqual(
        movementBeforeDamage.filter(event => event.kind === 'teleJump').map(event => ({ from: event.from, to: event.to })),
        [{ from: failure.landing, to: failure.landing }],
        `${stage.name} explicitly settles on its same-plane failure landing before damage`
      );
    } else {
      assert.deepEqual(
        { startX: exactMove.startX, startZ: exactMove.startZ, endX: exactMove.endX, endZ: exactMove.endZ },
        { startX: stage.start.x, startZ: stage.start.z, endX: stage.start.x, endZ: stage.start.z },
        `${stage.name} cross-level failure uses a stationary exact-move on the current plane`
      );
      assert.deepEqual(
        movementBeforeDamage.filter(event => event.kind === 'teleJump').map(event => event.to),
        [failure.landing],
        `${stage.name} reaches its level-aware failure landing before damage`
      );
    }
    const postDamageEffects = events.slice(damageIndex + 1).filter(event => ['exactMove', 'teleport', 'teleJump', 'addXp'].includes(event.kind));
    assert.deepEqual(postDamageEffects, [], `${stage.name} performs no success movement or award after damage`);
    assert.equal(player.stats[AGILITY], beforeXp, `${stage.name} failure awards no Agility XP`);
    assert.deepEqual(Array.from(player.stats), beforeStats, `${stage.name} failure awards no skill XP`);
    assert.equal(player.animProtect, 1, `${stage.name} restores the engine's integer animation-protection flag`);
    assert.deepEqual(BAS_FIELDS.map(field => player[field]), beforeBas, `${stage.name} restores all seven transformed BAS fields`);
    assert.equal(player.animId, -1, `${stage.name} clears the failure animation`);
    const deathQueueCount = [...player.queue.all()].filter(request => request.script.id === deathQueue.id).length;
    assert.equal(deathQueueCount - priorDeathQueues, hpCase.hitpoints <= hpCase.damage ? 1 : 0, `${stage.name} lethal damage schedules the real death queue exactly once`);
    assert.equal(callNames.filter(name => name === '[proc,player_die]').length, hpCase.hitpoints <= hpCase.damage ? 1 : 0, `${stage.name} lethal damage reaches player_die`);
    assert.equal(callNames.filter(name => name === '[proc,ring_of_life_check]').length, hpCase.hitpoints > hpCase.damage ? 1 : 0, `${stage.name} surviving damage reaches the real ring-of-life check`);
    failureCases++;
  }
}
assert.equal(failureCases, STAGES.length * FAILURE_HP_CASES.length, 'all seven failable handler paths cover four damage edges');

let bypassCases = 0;
for (const stage of STAGES) {
  for (const currentLevel of [75, 76, 99]) {
    const player = makePlayer(48, ninjaForms[0], stage.start);
    player.levels[AGILITY] = currentLevel;
    runSuccessfulStage(player, stage, { randomValues: [FAILURE_RANDOM], allowUnusedRandom: true });
    bypassCases++;
  }
}
assert.equal(bypassCases, STAGES.length * 3, 'all seven handler paths bypass failure at current Agility 75, 76 and 99 without consuming the failure seam');

// One-tile collision fixture proves a clipped approach stops before animation, travel and reward.
const ropeStage = STAGES[5];
const clippedStart = { level: 0, x: 2750, z: 2731 };
const clippedPlayer = makePlayer(48, ninjaForms[0], clippedStart);
const clippedBefore = persistentEffects(clippedPlayer);
const clippedMotion = snapshot(clippedPlayer);
const clippedXp = clippedPlayer.stats[AGILITY];
assert.equal(routefinder.isFlagged(ropeStage.start.x, ropeStage.start.z, ropeStage.start.level, CollisionFlag.WALK_BLOCKED), false, 'rope setup stand is initially open');
routefinder.changeLoc(ropeStage.start.x, ropeStage.start.z, ropeStage.start.level, 1, 1, false, true);
try {
  assert.equal(routefinder.isFlagged(ropeStage.start.x, ropeStage.start.z, ropeStage.start.level, CollisionFlag.WALK_BLOCKED), true, 'the temporary loc collision clips the approach');
  const state = ScriptRunner.init(locTriggers.get(ropeStage.name), clippedPlayer, stageLoc(ropeStage));
  clippedPlayer.executeScript(state, true, true);
  finishDelayed(clippedPlayer);
} finally {
  routefinder.changeLoc(ropeStage.start.x, ropeStage.start.z, ropeStage.start.level, 1, 1, false, false);
}
assert.deepEqual(tileOf(clippedPlayer), clippedStart, 'the blocked one-tile approach does not move the player');
assert.equal(clippedPlayer.stats[AGILITY], clippedXp, 'a clipped approach awards no XP');
const clippedAfterMotion = snapshot(clippedPlayer);
assert.equal(clippedAfterMotion.packetCount, clippedMotion.packetCount, 'a clipped approach sends no movement or animation packet');
assert.deepEqual(clippedAfterMotion.exactMove, clippedMotion.exactMove, 'a clipped approach creates no exact-move path');
assert.equal(clippedAfterMotion.masks, clippedMotion.masks, 'a clipped approach writes no transient appearance or movement mask');
assert.deepEqual(persistentEffects(clippedPlayer), clippedBefore, 'a clipped approach changes no persistent player effects');

const recovery = ScriptProvider.getByName('[proc,ape_atoll_recover]');
assert(recovery, 'compiled checkpoint recovery procedure is present');
function recoveryEffects(player) {
  return persistentEffects(player);
}
function recoverAt(tile, expectedTile, label) {
  const player = makePlayer(48, ninjaForms[0], tile);
  const effects = recoveryEffects(player);
  const xp = player.stats[AGILITY];
  const state = ScriptRunner.init(recovery, player);
  assert.equal(player.runScript(state, true, true), ScriptState.FINISHED, `${label} recovery returns normally`);
  assert.deepEqual(tileOf(player), expectedTile, `${label} restores the intended stable checkpoint`);
  assert.equal(player.stats[AGILITY], xp, `${label} recovery does not award XP`);
  assert.deepEqual(recoveryEffects(player), effects, `${label} recovery changes no form, damage, XP, vars, animation or appearance`);
  assert.equal(player.messages.length, 0, `${label} recovery emits no text`);
}
let barsCheckpoints = 0;
for (let z = 2741; z <= 2742; z++) {
  for (let x = 2747; x <= 2753; x++) {
    const stableEast = z === 2742 && (x === 2752 || x === 2753);
    const tile = { level: 2, x, z };
    recoverAt(tile, stableEast ? tile : { level: 2, x: 2752, z: 2742 }, `bars checkpoint ${x},${z}`);
    barsCheckpoints++;
  }
}
assert.equal(barsCheckpoints, 14, 'every tile in the transient bar recovery box is covered');
let vineCheckpoints = 0;
for (let x = 2758; x <= 2770; x++) {
  for (let z = 2734; z <= 2747; z++) {
    recoverAt({ level: 1, x, z }, { level: 0, x: 2757, z: 2733 }, `vine checkpoint ${x},${z}`);
    vineCheckpoints++;
  }
}
assert.equal(vineCheckpoints, 182, 'every tile in the upper-vine recovery strip is covered');
recoverAt({ level: 0, x: 2747, z: 2741 }, { level: 0, x: 2747, z: 2741 }, 'stable L0 west platform control');
recoverAt({ level: 2, x: 2754, z: 2742 }, { level: 2, x: 2754, z: 2742 }, 'outside bars box control');
recoverAt({ level: 1, x: 2757, z: 2734 }, { level: 1, x: 2757, z: 2734 }, 'outside vine strip control');

const result = {
  originalRecordCommit: ORIGINAL_RECORD_COMMIT,
  locRecords: Object.keys(ORIGINAL_LOC_DIGESTS).length,
  sequenceRecords: Object.keys(ORIGINAL_SEQ_DIGESTS).length,
  mapFiles: mapFileCount,
  collisionWitnesses: collisionWitnesses.length,
  entryMatrix: { total: matrixCases, rejected: rejectedCases, successful: successfulCases },
  fullLapXpTenths: 5800,
  repeatedLapXpTenths: 5800,
  failureCases,
  bypassCases,
  humanDeathCases,
  ordinaryDeathCases,
  monkeyDeathRepairCases,
  greegreeReequipCases,
  unmatchedGreegreeDeathControlCases,
  recovery: { barsCheckpoints, vineCheckpoints, controls: 3 }
};
const outputRoot = process.env.RUNNER_TEMP || os.tmpdir();
fs.mkdirSync(outputRoot, { recursive: true });
const outputDirectory = fs.mkdtempSync(path.join(outputRoot, 'ape-atoll-packed-'));
fs.writeFileSync(path.join(outputDirectory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`RESULT PASS (packed Ape Atoll handlers, ${matrixCases} entry combinations, ${failureCases} failure cases, ${monkeyDeathRepairCases} death repairs, ${greegreeReequipCases} real re-equips, ${barsCheckpoints + vineCheckpoints} recovery tiles; receipt written under temporary storage)`);
process.exit(0);
