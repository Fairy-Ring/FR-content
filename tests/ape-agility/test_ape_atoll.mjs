/**
 * Deterministic compiled production-handler proof for the Ape Atoll course unit.
 * Run after the full content pack is built, from the sibling engine directory:
 *   node --import tsx ../content/tests/ape-agility/test_ape_atoll.mjs
 * It starts no server and writes its JSON receipt beneath RUNNER_TEMP (or the OS temp directory).
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
const { default: Loc } = await eng('src/engine/entity/Loc.ts');
const { EntityLifeCycle } = await eng('src/engine/entity/EntityLifeCycle.ts');
const { PlayerStatMap } = await eng('src/engine/entity/PlayerStat.ts');
const { default: CategoryType } = await eng('src/cache/config/CategoryType.ts');
const { default: Component } = await eng('src/cache/config/Component.ts');
const { default: DbTableType } = await eng('src/cache/config/DbTableType.ts');
const { default: DbRowType } = await eng('src/cache/config/DbRowType.ts');
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
const { default: ServerTriggerType } = await eng('src/engine/script/ServerTriggerType.ts');
const { ScriptOpcodeNameMap } = await eng('src/engine/script/ScriptOpcode.ts');
const { default: routefinder, CollisionFlag } = await eng('src/engine/routefinder/index.ts');
const { unzipSync } = createRequire(path.join(ENGINE_DIR, 'package.json'))('fflate');

for (const config of [
  VarPlayerType, VarBitType, VarNpcType, CategoryType, ParamType, NpcType,
  LocType, InvType, ObjType, SeqType, FontType, Component, DbTableType, DbRowType
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
const transformScript = ScriptProvider.getByName('[proc,mm_greegree_transmogrify]');
assert(transformScript, 'the packed normal greegree transform procedure is present');
function transform(player, form) {
  const objectId = packId('obj', form.object);
  player.invSet(WORN_INVENTORY, objectId, 1, RIGHT_HAND);
  const state = ScriptRunner.init(transformScript, player, null, [objectId]);
  assert.equal(player.runScript(state, true, true), ScriptState.FINISHED, `${form.label} uses the packed greegree transform`);
  assert.equal(player.npcId, packId('npc', form.npc), `${form.label} writes the real Player.npcId`);
}
let nextTestPlayerId = 1;

function makePlayer(level, form, tile) {
  const player = new Player('ape_atoll_packed_test', 0n, 0n);
  player.uid = nextTestPlayerId;
  player.pid = nextTestPlayerId++;
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
const courseProcedures = [
  'ape_atoll_ninja_form', 'ape_atoll_entry', 'ape_atoll_setup', 'ape_atoll_finish', 'ape_atoll_bars', 'ape_atoll_recover'
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

function finishDelayed(player) {
  let boundaries = 0;
  while (player.activeScript) {
    assert.ok(boundaries++ < 100, 'each compiled obstacle has a finite delay schedule');
    const state = player.activeScript;
    assert.equal(state.execution, ScriptState.SUSPENDED, 'obstacle delay suspends the active script');
    assert(player.delayed, 'suspended obstacle keeps the player protected');
    assert(player.delayedUntil > World.currentTick, 'obstacle resumes on a future server tick');
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

function runSuccessfulStage(player, stage) {
  const script = locTriggers.get(stage.name);
  const loc = stageLoc(stage);
  const beforeXp = player.stats[AGILITY];
  const statsBefore = Array.from(player.stats);
  const levelsBefore = Array.from(player.levels);
  const baseLevelsBefore = Array.from(player.baseLevels);
  const messagesBefore = [...player.messages];
  const varsBefore = Array.from(player.vars);
  const state = ScriptRunner.init(script, player, loc);
  player.executeScript(state, true, true);
  assert.equal(player.activeScript, state, `${stage.name} first suspends inside its protected setup`);
  assert.equal(state.execution, ScriptState.SUSPENDED, `${stage.name} starts through the packed delay`);
  const during = snapshot(player);
  const duplicate = ScriptRunner.init(script, player, loc);
  player.executeScript(duplicate, true);
  assert.deepEqual(snapshot(player), during, `${stage.name} duplicate click is refused while protected`);
  assert.equal(player.activeScript, state, `${stage.name} duplicate cannot replace the active attempt`);
  finishDelayed(player);
  assert.deepEqual(tileOf(player), stage.end, `${stage.name} settles at its exact endpoint`);
  assert.equal(player.stats[AGILITY] - beforeXp, stage.xp, `${stage.name} awards exactly ${stage.xp} internal tenths`);
  assert.deepEqual(Array.from(player.vars), varsBefore, `${stage.name} adds no player varp state`);
  const statsAfter = Array.from(player.stats);
  statsAfter[AGILITY] = statsBefore[AGILITY];
  assert.deepEqual(statsAfter, statsBefore, `${stage.name} awards no other skill XP`);
  assert.deepEqual(Array.from(player.levels), levelsBefore, `${stage.name} causes no damage or current-level change`);
  assert.deepEqual(Array.from(player.baseLevels), baseLevelsBefore, `${stage.name} causes no base-level change`);
  assert.deepEqual(player.messages, messagesBefore, `${stage.name} emits no course text`);
}

function assertRejected(player, stage, label) {
  const before = snapshot(player);
  const state = ScriptRunner.init(locTriggers.get(stage.name), player, stageLoc(stage));
  assert.equal(player.runScript(state, true, true), ScriptState.FINISHED, `${label} returns normally`);
  assert.deepEqual(snapshot(player), before, `${label} writes no movement, damage, XP, varp, appearance, animation, message or packet state`);
  assert.equal(player.activeScript, null, `${label} does not leave a suspended script`);
}

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
for (const player of concurrentPlayers) {
  const state = ScriptRunner.init(locTriggers.get(STAGES[0].name), player, stageLoc(STAGES[0]));
  player.executeScript(state, true, true);
  assert.equal(player.activeScript, state, 'each player owns an independent protected attempt');
}
finishConcurrent(concurrentPlayers);
for (const [index, player] of concurrentPlayers.entries()) {
  assert.equal(player.stats[AGILITY] - concurrentXpBefore[index], 400, 'both concurrent players settle their own stone award');
}

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
  recovery: { barsCheckpoints, vineCheckpoints, controls: 3 }
};
const outputRoot = process.env.RUNNER_TEMP || os.tmpdir();
fs.mkdirSync(outputRoot, { recursive: true });
const outputDirectory = fs.mkdtempSync(path.join(outputRoot, 'ape-atoll-packed-'));
fs.writeFileSync(path.join(outputDirectory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`RESULT PASS (packed Ape Atoll handlers, ${matrixCases} entry combinations, ${barsCheckpoints + vineCheckpoints} recovery tiles; receipt written under temporary storage)`);
process.exit(0);
