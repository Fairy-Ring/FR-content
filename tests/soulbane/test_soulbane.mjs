#!/usr/bin/env node
// Native rift, four rooms, bridge, Tolna and completion regression coverage.
// Every progression step uses the registered engine dispatch and cleanup paths.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  Packet, PlayerLoading, PlayerStat, ScriptProvider, ScriptState,
  World, button, contentRoot, count, dialoguePage, engineModule, execute, held, id,
  inv, invButton, invCom, inventory, map, obj, player as makePlayer, remove, resumeDialogue,
  seed, slotOf, tile, types, useLoc
} from '../swamp-caves/runtime.mjs';

const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const InstanceZone = (await engineModule('engine/zone/InstanceZone.ts')).default;
const { CollisionType, CollisionFlag } = await engineModule('engine/routefinder/flags.ts');
const routeFinder = (await engineModule('engine/routefinder/index.ts')).default;
const RebuildRegion = (await engineModule('network/game/server/model/RebuildRegion.ts')).default;
const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const MoveClickHandler = new (await engineModule('network/game/client/handler/MoveClickHandler.ts')).default();
const MoveClickDecoder = (await engineModule('network/game/client/codec/MoveClickDecoder.ts')).default;
const ClientGameProt = (await engineModule('network/game/client/ClientGameProt.ts')).default;
const CloseModal = (await engineModule('network/game/client/model/CloseModal.ts')).default;
const CloseModalHandler = new (await engineModule('network/game/client/handler/CloseModalHandler.ts')).default();
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const OpLocHandler = new (await engineModule('network/game/client/handler/OpLocHandler.ts')).default();
const OpNpc = (await engineModule('network/game/client/model/OpNpc.ts')).default;
const OpNpcHandler = new (await engineModule('network/game/client/handler/OpNpcHandler.ts')).default();
const OpNpcU = (await engineModule('network/game/client/model/OpNpcU.ts')).default;
const OpNpcUHandler = new (await engineModule('network/game/client/handler/OpNpcUHandler.ts')).default();
const OpNpcT = (await engineModule('network/game/client/model/OpNpcT.ts')).default;
const OpNpcTHandler = new (await engineModule('network/game/client/handler/OpNpcTHandler.ts')).default();
const NpcStat = (await engineModule('engine/entity/NpcStat.ts')).NpcStat;
const resolveNpcType = (await engineModule('engine/entity/resolveNpcType.ts')).default;
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { getExpByLevel } = await engineModule('engine/entity/Player.ts');
const rsbuf = await engineModule('network/rsbuf/index.ts');
const { PlayerInfoProt } = await engineModule('network/rsbuf/prot.ts');
const OpPlayer = (await engineModule('network/game/client/model/OpPlayer.ts')).default;
const OpPlayerHandler = new (await engineModule('network/game/client/handler/OpPlayerHandler.ts')).default();
const MidiSong = (await engineModule('network/game/server/model/MidiSong.ts')).default;
const DbTableIndex = (await engineModule('cache/config/DbTableIndex.ts')).default;
const CamReset = (await engineModule('network/game/server/model/CamReset.ts')).default;
const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const { ActiveRegion } = await engineModule('engine/script/ScriptPointer.ts');
const ServerTriggerType = (await engineModule('engine/script/ServerTriggerType.ts')).default;
const roomCameraPackets = new WeakMap();
const sceneRebuildPackets = new WeakMap();

const memoryCameraPackets = new WeakMap();
const heldMemoryStandingTiles = new Map();



const QUEST_CONFIG = path.join(contentRoot, 'scripts/quests/quest_soulbane/configs/soulbane.constant');
const WEAPONS = [
  { name: 'soulbane_anger_swordq', choice: 1, rackBit: 1, target: 'soulbane_anger_unicorn' },
  { name: 'soulbane_anger_spearq', choice: 2, rackBit: 2, target: 'soulbane_anger_bear' },
  { name: 'soulbane_anger_maceq', choice: 3, rackBit: 3, target: 'soulbane_anger_rat' },
  { name: 'soulbane_anger_axeq', choice: 4, rackBit: 4, target: 'soulbane_anger_goblin' }
];
const RAGE_TYPES = [
  'soulbane_anger_bear', 'soulbane_anger_unicorn',
  'soulbane_anger_rat', 'soulbane_anger_goblin'
];
const RAGE_IDS = new Set(RAGE_TYPES.map(type => requiredId('NpcType', type)));
const FEAR_NPC = requiredId('NpcType', 'soulbane_fear_reaper');
const FEAR_HOLES = [
  'soul_bane_fwall_void',
  'soul_bane_fwall_void2',
  'soul_bane_fwall_void3',
  'soul_bane_fwall_void4',
  'soul_bane_fwall_void5',
  'soul_bane_fwall_void6'
];
const FEAR_REAPER_SPAWNS = [
  'soulbane_fear_reaper1',
  'soulbane_fear_reaper2',
  'soulbane_fear_reaper3',
  'soulbane_fear_reaper4',
  'soulbane_fear_reaper5',
  'soulbane_fear_reaper6'
];
// UNKNOWN engineering values; the original cache does not encode quest stages.
const FEAR_STAGE = 4;
const FEAR_COMPLETE_STAGE = 5;
const CONFUSION_STAGE = questConstant('soulbane_confusion_active');
const CONFUSION_CLEAR_STAGE = questConstant('soulbane_confusion_clear');
const HOPE_STAGE = questConstant('soulbane_hope_active');
const HOPE_CLEAR_STAGE = questConstant('soulbane_hope_clear');
const CONFUSION_TYPES = [
  'soulbane_confu_creeper', 'soulbane_confu_creeper_fake1', 'soulbane_confu_creeper_fake2',
  'soulbane_confu_creeper_fake3', 'soulbane_confu_creeper_fake4'
];
const CONFUSION_IDS = new Set(CONFUSION_TYPES.map(name => requiredId('NpcType', name)));
const HOPE_TYPES = ['soulbane_hope_monst3', 'soulbane_hope_monst2', 'soulbane_hope_monst1'];
const HOPE_IDS = new Set(HOPE_TYPES.map(name => requiredId('NpcType', name)));
const CONFUSION_HITS = requiredId('VarNpcType', 'soulbane_confusion_hits');
const NPC_POISON = requiredId('VarNpcType', 'npc_poison');
const HOPE_MELEE_UNTIL = requiredId('VarNpcType', 'soulbane_hope_melee_until');
const PLAYER_POISON = requiredId('VarPlayerType', 'poison');
const PLAYER_AGGRESSIVE_NPC = requiredId('VarPlayerType', 'aggressive_npc');
const PLAYER_LAST_COMBAT = requiredId('VarPlayerType', 'lastcombat');
const POISON_TIMER = ScriptProvider.getByName('[timer,poison]');
assert(POISON_TIMER, 'built pack contains the native player-poison timer');
const WEAPON_IDS = new Set(WEAPONS.map(weapon => requiredId('ObjType', weapon.name)));
const NPC_INSTANCE = requiredId('VarNpcType', 'npc_int');
const NPC_OWNER = requiredId('VarNpcType', 'npc_attacking_uid');
const NPC_XP_MULTIPLIER = requiredId('VarNpcType', 'npc_combat_xp_multiplier');
const ATTACK_XP = PlayerStat.ATTACK;
const HP_STAT = NpcStat.HITPOINTS;
const LAUNA_SCENE = requiredId('NpcType', 'soulbane_launa_young');
const TOLNA_SCENE = requiredId('NpcType', 'soulbane_tolnaboy');
const QUEST_ROW = requiredId('Component', 'questlist:soulbane');
const FADE_TO_WHITE = requiredId('Component', 'fade_to_white');
const LOGOUT_TAB = Number(/^\^tab_logout\s*=\s*(\d+)\s*$/m.exec(fs.readFileSync(
  path.join(contentRoot, 'scripts/general/configs/tabs.constant'), 'utf8'))?.[1]);
assert(Number.isInteger(LOGOUT_TAB), 'the checked-out login tab constant defines the logout tab');
const STAGE_VARBIT = requiredId('VarBitType', 'soulbane_prog');
const STAGE_VARP = types.VarBitType.get(STAGE_VARBIT).basevar;
const INSTANCE_VARP = requiredId('VarPlayerType', 'soulbane_instance');
const METER_VARBIT = requiredId('VarBitType', 'soulbane_anger_damagedealt');
const WEAPON_VARBIT = requiredId('VarBitType', 'soulbane_anger_weaponmulti');
const NPC_ACTION_DELAY = requiredId('VarNpcType', 'npc_action_delay');
const ATTACK_RATE_PARAM = requiredId('ParamType', 'attackrate');
const DAMAGE_TYPE_PARAM = requiredId('ParamType', 'damagetype');
const POISON_SEVERITY_PARAM = requiredId('ParamType', 'poison_severity');
const TOLNA_INTRO_STAGE = questConstant('soulbane_tolna_intro');
const TOLNA_ACTIVE_STAGE = questConstant('soulbane_tolna_active');
const TOLNA_CLEAR_STAGE = questConstant('soulbane_tolna_clear');
const TOLNA_COMPLETE_STAGE = configConstant('scripts/general/configs/quest.constant', 'soulbane_complete');
const TOLNA_PROFILE_TABLE = types.DbTableType.get(requiredId('DbTableType', 'soulbane_tolna_heads'));
const TOLNA_HEADS = [
  {
    type: 'soulbane_final_tolna1', row: 'soulbane_tolna_south', stand: 'soulbane_tolna_south',
    melee: 'soulbane_tolna_south_melee_ticks', ranged: 'soulbane_tolna_south_ranged_ticks',
    meleeCount: 8, damageType: 'slash_style'
  },
  {
    type: 'soulbane_final_tolna2', row: 'soulbane_tolna_east', stand: 'soulbane_tolna_east',
    melee: 'soulbane_tolna_no_melee', ranged: 'soulbane_tolna_east_ranged_ticks',
    meleeCount: 6, damageType: null
  },
  {
    type: 'soulbane_final_tolna3', row: 'soulbane_tolna_north', stand: 'soulbane_tolna_north',
    melee: 'soulbane_tolna_north_melee_ticks', ranged: 'soulbane_tolna_north_ranged_ticks',
    meleeCount: 9, damageType: 'stab_style'
  }
].map(head => ({
  ...head,
  id: requiredId('NpcType', head.type),
  rowId: requiredId('DbRowType', head.row),
  meleeTicks: questConstant(head.melee),
  rangedTicks: questConstant(head.ranged),
  standCoord: sourceCoordForName(head.stand)
}));
assert.deepEqual(TOLNA_HEADS.map(head => [head.meleeTicks, head.rangedTicks]), [[8, 7], [0, 5], [3, 20]],
  'retained South, ranged-only East, and North source profiles keep their exact attack intervals');
const TOLNA_HEAD_IDS = new Set(TOLNA_HEADS.map(head => head.id));
const TOLNA_BRANA = requiredId('NpcType', 'soulbane_brana');
const TOLNA_HUMAN = requiredId('NpcType', 'soulbane_tolna_top');
const TOLNA_ACTOR_IDS = new Set([...TOLNA_HEAD_IDS, TOLNA_BRANA, TOLNA_HUMAN]);
const TOLNA_DEATH_BITS = [
  'soulbane_final_tol1dead', 'soulbane_final_tol2dead', 'soulbane_final_tol3dead'
];
const TOLNA_WINDOW = { minX: 19, maxX: 51, minZ: 14, maxZ: 44 };
assert.deepEqual(TOLNA_HEADS.map(head => head.meleeCount), [8, 6, 9],
  'candidate geometry records the selected south/east/north native melee counts');

function requiredId(kind, name) {
  const value = id(kind, name);
  assert(value >= 0, `packed ${kind} contains ${name}`);
  return value;
}

const MUSIC_TABLE = types.DbTableType.get(requiredId('DbTableType', 'music'));
const MUSIC_REGION_TABLE = types.DbTableType.get(requiredId('DbTableType', 'musicregion'));
const MUSIC_UNLOCK_VARS = Array.from({ length: types.VarPlayerType.count }, (_, id) =>
  types.VarPlayerType.get(id)?.debugname ?? '')
  .map(name => ({ name, match: name.match(/^musicmulti_(\d+)$/) }))
  .filter(({ match }) => match)
  .map(({ name, match }) => ({ name, slot: Number(match[1]) }))
  .sort((a, b) => a.slot - b.slot);
assert(MUSIC_UNLOCK_VARS.length > 0, 'built cache exposes original music unlock varps');

function dbField(row, table, name) {
  const index = table.columnNames.indexOf(name);
  assert(index >= 0, `built ${table.debugname ?? 'database'} table declares ${name}`);
  return row.columnValues[index];
}
function musicSongFromRow(row, label) {
  assert(row, `${label}: built music dbrow exists`);
  const name = dbField(row, MUSIC_TABLE, 'name')?.[0];
  const track = dbField(row, MUSIC_TABLE, 'track')?.[0];
  assert.equal(typeof name, 'string', `${label}: music dbrow has its authored name`);
  assert(Number.isInteger(track), `${label}: music dbrow supplies a compiled MIDI track`);
  const unlock = dbField(row, MUSIC_TABLE, 'unlock');
  const [slot, bit] = Array.isArray(unlock) ? unlock : [];
  let unlockVar = null;
  if (slot != null || bit != null) {
    assert(Number.isInteger(slot) && Number.isInteger(bit) && bit >= 0 && bit < 32,
      `${label}: music dbrow unlock is a valid original music slot/bit`);
    unlockVar = `musicmulti_${slot}`;
    assert(MUSIC_UNLOCK_VARS.some(variable => variable.name === unlockVar),
      `${label}: built cache exposes ${unlockVar}`);
  }
  return { name, track, unlockVar, unlockBit: bit ?? null };
}
function musicSongByName(name) {
  return musicSongFromRow(types.DbRowType.get(requiredId('DbRowType', name)), name);
}
function musicSongForRowId(rowId, label) {
  assert(Number.isInteger(rowId) && rowId >= 0, `${label}: music row reference exists`);
  return musicSongFromRow(types.DbRowType.get(rowId), label);
}
const RAGE_SONG = musicSongByName('music_Wrath_and_Ruin');
const FEAR_SONG = musicSongByName('music_Fear_and_Loathing');
const CONFUSION_SONG = musicSongByName('music_Method_of_Madness');
const HOPE_SONG = musicSongByName('music_No_Way_Out');
const MANUAL_PREVIOUS_SONG = musicSongByName('music_Book_Of_Spells');
assert.equal(RAGE_SONG.name, 'Wrath and Ruin', 'Rage music row names the source-backed track');
assert.equal(FEAR_SONG.name, 'Fear and Loathing', 'Fear music row names the source-backed track');
assert.equal(CONFUSION_SONG.name, 'Method of Madness', 'Confusion music row names the source-backed track');
assert.equal(HOPE_SONG.name, 'No Way Out', 'Hope music row names the source-backed track');

function musicUnlockSnapshot(p) {
  return MUSIC_UNLOCK_VARS.map(({ name }) => readVar(p, name) >>> 0);
}
function musicUnlockBit(snapshot, song) {
  assert(song.unlockVar, `${song.name}: built music row defines an original unlock bit`);
  const index = MUSIC_UNLOCK_VARS.findIndex(variable => variable.name === song.unlockVar);
  assert(index >= 0, `${song.name}: original unlock varp is inventoried`);
  return (snapshot[index] >>> song.unlockBit) & 1;
}
function assertMusicUnlockTransition(p, before, song, label) {
  const expected = before.slice();
  if (song.unlockVar) {
    const index = MUSIC_UNLOCK_VARS.findIndex(variable => variable.name === song.unlockVar);
    assert(index >= 0, `${label}: ${song.name} unlock varp is inventoried`);
    expected[index] = (expected[index] | (1 << song.unlockBit)) >>> 0;
  }
  assert.deepEqual(musicUnlockSnapshot(p), expected,
    `${label}: only the music dbrow's original cache bit is unlocked`);
  if (song.unlockVar) assert.equal(musicUnlockBit(expected, song), 1, `${label}: ${song.name} is unlocked`);
}
function musicTracksSince(p, mark) {
  return p.packets.slice(mark).filter(packet => packet instanceof MidiSong).map(packet => packet.id);
}
function beginRoomMusicObservation(p, song, mode, label, {
  requireLocked = false, requireUnlocked = false, previousTrack = null
} = {}) {
  assert(mode === 0 || mode === 1, `${label}: native music mode is Auto or Manual`);
  writeVar(p, 'musicplay', mode);
  if (previousTrack != null) {
    assert.notEqual(previousTrack, song.track, `${label}: manual prior playback differs from the room song`);
    runProc('music_play', p, [previousTrack]);
  }
  const before = musicUnlockSnapshot(p);
  if (requireLocked) assert.equal(musicUnlockBit(before, song), 0, `${label}: target cache bit begins locked`);
  if (requireUnlocked) assert.equal(musicUnlockBit(before, song), 1, `${label}: target cache bit was already unlocked`);
  return {
    song,
    mode,
    before,
    mark: p.packets.length,
    previousTrack: readVar(p, 'currentsong')
  };
}
function assertRoomMusicObservation(p, observed, label) {
  const expectedTracks = observed.mode === 1 ? [observed.song.track] : [];
  assert.deepEqual(musicTracksSince(p, observed.mark), expectedTracks,
    `${label}: compiled entry obeys ${observed.mode === 1 ? 'Auto' : 'Manual'} music mode`);
  assertRoomMusicState(p, observed, label);
}
function assertRoomMusicState(p, observed, label) {
  assert.equal(readVar(p, 'currentsong'),
    observed.mode === 1 ? observed.song.track : observed.previousTrack,
  `${label}: current song follows the mode without changing Manual playback`);
  assert.equal(readVar(p, 'musicplay'), observed.mode, `${label}: entry preserves Auto/Manual mode`);
  assertMusicUnlockTransition(p, observed.before, observed.song, label);
}
function musicRegionSongAt(level, x, z) {
  const mapX = (x >> 6) << 6;
  const mapZ = (z >> 6) << 6;
  const key = CoordGrid.packCoord(0, mapX, mapZ);
  const mapsquare = MUSIC_REGION_TABLE.columnNames.indexOf('mapsquare');
  assert(mapsquare >= 0, 'built musicregion table indexes mapsquare');
  const rowIds = DbTableIndex.find(key, (MUSIC_REGION_TABLE.id << 12) | (mapsquare << 4));
  assert.equal(rowIds.length, 1, `surface map square ${mapX >> 6}_${mapZ >> 6} has one compiled musicregion row`);
  const region = types.DbRowType.get(rowIds[0]);
  const songRowId = dbField(region, MUSIC_REGION_TABLE, 'musicdata')?.[0];
  return musicSongForRowId(songRowId, `surface musicregion ${mapX >> 6}_${mapZ >> 6}`);
}
function assertSurfaceMapzoneMusic(p, mark, before, label) {
  const song = musicRegionSongAt(p.level, p.x, p.z);
  assert.deepEqual(musicTracksSince(p, mark), [song.track],
    `${label}: ordinary surface mapzone sends the region dbrow's MIDI command`);
  assert.equal(readVar(p, 'currentsong'), song.track,
    `${label}: ordinary surface mapzone sets the region dbrow's song`);
  assertMusicUnlockTransition(p, before, song, `${label}: ordinary surface mapzone`);
  return song;
}
function operateSurfaceExit(p, exit, choices, label) {
  goToStand(p, exit, `${label}: walk to the original surface Exit`);
  writeVar(p, 'musicplay', 1);
  const exitMark = p.packets.length;
  const result = operateLoc(p, exit, 1, choices, label);
  assert.deepEqual(musicTracksSince(p, exitMark), [],
    `${label}: quest exit leaves song selection to the ordinary mapzone phase`);
  const mapzoneMark = p.packets.length;
  const unlocksBeforeMapzone = musicUnlockSnapshot(p);
  worldTick();
  assertSurfaceMapzoneMusic(p, mapzoneMark, unlocksBeforeMapzone, label);
  return result;
}
function variable(name) {
  const bit = types.VarBitType.getId(name);
  if (bit >= 0) return { kind: 'bit', id: bit };
  const player = types.VarPlayerType.getId(name);
  assert(player >= 0, `packed varbit/varp ${name} exists`);
  return { kind: 'player', id: player };
}
function readVar(p, name) {
  const value = variable(name);
  return value.kind === 'bit' ? p.getVarBit(value.id) : p.getVar(value.id);
}
function writeVar(p, name, value) {
  const variableId = variable(name);
  if (variableId.kind === 'bit') p.setVarBit(variableId.id, value);
  else p.setVar(variableId.id, value);
}
function consumeNativeOp1(p, name, label) {
  for (let tick = 0; tick < 16 && readVar(p, 'eat_delay') >= World.currentTick; tick++) worldTick();
  assert(readVar(p, 'eat_delay') < World.currentTick,
    `${label}: the ordinary native eating cooldown expires before the packet`);
  const objectId = requiredId('ObjType', name);
  const object = types.ObjType.get(objectId);
  assert(['eat', 'drink'].includes(String(object.iop[0]).toLowerCase()),
    `${label}: ${name} has its authored Eat/Drink option`);
  const trigger = ScriptProvider.getByTrigger(ServerTriggerType.OPHELD1, objectId, object.category);
  assert(trigger, `${label}: ${name} resolves a compiled opheld1 trigger`);
  const before = count(p, name);
  assert(held(p, name, 1), `${label}: native OpHeldHandler accepts the actual inventory packet`);
  assert.equal(count(p, name), before - 1, `${label}: native opheld1 consumes exactly one ${name}`);
  return trigger;
}
function runProc(name, p, args = [], target = null) {
  return execute(`[proc,${name}]`, p, args, { target });
}
function runProcInt(name, p, args = [], target = null) {
  return runProc(name, p, args, target).popInt();
}
function questConstant(name) {
  const row = fs.readFileSync(QUEST_CONFIG, 'utf8').split(/\r?\n/)
    .find(line => line.startsWith(`^${name} = `));
  assert(row, `source declares ^${name}`);
  return Number(row.slice(row.indexOf('=') + 1).trim());
}
function configConstant(relativePath, name) {
  const text = fs.readFileSync(path.join(contentRoot, relativePath), 'utf8');
  const match = new RegExp(`^\\^${name}\\s*=\\s*(-?\\d+)\\s*$`, 'm').exec(text);
  assert(match, `${relativePath} declares ^${name}`);
  return Number(match[1]);
}
function questCoordinateDeclarations() {
  const found = new Map();
  for (const row of fs.readFileSync(QUEST_CONFIG, 'utf8').split(/\r?\n/)) {
    const match = row.match(/^\^([A-Za-z0-9_]+)\s*=\s*(\d+_\d+_\d+_\d+_\d+)\s*$/);
    if (match) found.set(match[1], match[2]);
  }
  return found;
}
function packedTemplate(value) {
  const [level, mapX, mapZ, localX, localZ] = value.split('_').map(Number);
  return CoordGrid.packCoord(level, mapX * 64 + localX, mapZ * 64 + localZ);
}
function unpackWorld(packed) {
  const { level, x, z } = CoordGrid.unpackCoord(packed);
  return { level, x, z };
}
function sourceCoordForName(name) {
  const declaration = questCoordinateDeclarations().get(name);
  assert(declaration, `source declares ^${name}`);
  return unpackWorld(packedTemplate(declaration));
}
function sourceSquareKey(coord) {
  return `${coord.level}_${coord.x >> 6}_${coord.z >> 6}`;
}
function sourceSquareKeyForZone(zone) {
  return `${zone.source.level}_${zone.source.x >> 3}_${zone.source.z >> 3}`;
}
function sourceZoneKey(coord) {
  return `${coord.level}:${coord.x >> 3}:${coord.z >> 3}`;
}
function destinationZoneKey(zone) {
  return `${zone.level}:${zone.x}:${zone.z}`;
}
function instanceForOwner(p, label) {
  const uid = instanceUid(p);
  assert(uid > 0, `${label}: owner has a live instance handle`);
  const instance = World.instances.findInstanceByUid(uid - 1);
  assert(instance, `${label}: owner handle resolves to a live instance`);
  assert.equal(World.instances.findInstanceByCoord(p)?.uid, instance.uid,
    `${label}: player stands in the resolved owner instance`);
  return instance;
}
function assignedInstanceZones(instance) {
  const zones = [];
  for (let floor = 0; floor < instance.floors; floor++) {
    for (let east = 0; east < instance.zonesEast; east++) {
      for (let north = 0; north < instance.zonesNorth; north++) {
        const zone = World.gameMap.getZoneIfExists(
          instance.sw.x + (east << 3), instance.sw.z + (north << 3), instance.sw.level + floor);
        if (zone instanceof InstanceZone && zone.hasAssignedTemplate) zones.push(zone);
      }
    }
  }
  return zones;
}
function instanceZoneForSource(instance, source, label) {
  const key = sourceZoneKey(source);
  const matches = assignedInstanceZones(instance).filter(zone =>
    `${zone.source.level}:${zone.source.x}:${zone.source.z}` === key);
  assert.equal(matches.length, 1, `${label}: source zone ${key} has one actual owner mapping`);
  return matches[0];
}
// Resolve packed source coordinates through this owner's actual native
// InstanceZone metadata. The allocation slot and destination offset are never
// inferred from a generated handle or assumed source-square adjacency.
function templateCoord(p, packed) {
  const instance = instanceForOwner(p, 'template coordinate');
  const source = unpackWorld(packed);
  const zone = instanceZoneForSource(instance, source, 'template coordinate');
  return {
    level: zone.level,
    x: (zone.x << 3) + (source.x & 7),
    z: (zone.z << 3) + (source.z & 7)
  };
}
function roomCoord(p, name) {
  return templateCoord(p, packedTemplate(questCoordinateDeclarations().get(name)));
}
function instanceUid(p) {
  return readVar(p, 'soulbane_instance');
}
function stage(p) {
  return readVar(p, 'soulbane_prog');
}
function xpSnapshot(p) {
  return Array.from(p.stats);
}
function normalInventory(p, which = inv) {
  return inventory(p, which).filter(item => item && !WEAPON_IDS.has(obj(item.name)))
    .map(item => [item.name, item.count]).sort((a, b) => a[0].localeCompare(b[0]));
}
function angerWeaponTotal(p) {
  return WEAPONS.reduce((total, weapon) => total + count(p, weapon.name) + count(p, weapon.name, types.InvType.getId('worn')), 0);
}
function angerWorn(p) {
  return WEAPONS.reduce((total, weapon) => total + count(p, weapon.name, types.InvType.getId('worn')), 0);
}
function playerFixture(position = { level: 0, x: 3310, z: 3455 }) {
  const p = makePlayer();
  p.level = position.level; p.x = position.x; p.z = position.z;
  rsbuf.addPlayer(p.slot);
  World.gameMap.getZone(p.x, p.z, p.level).enter(p);
  World.instances.playerEntered({ level: p.level, x: p.x, z: p.z });
  p.lastResponse = World.currentTick;
  p.lastConnected = World.currentTick;
  runProc('dt_restore_spellbook', p);
  return p;
}

// Use the production server phases (including NPC queues, player queues,
// movement, logouts, zones, and cleanup), but omit sockets and packet output.
function worldTick(beforeNpcInfo = null, afterNpcInfo = null) {
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
    if (phase === 'processInfo' && beforeNpcInfo) beforeNpcInfo();
    World[phase]();
    if (phase === 'processInfo' && afterNpcInfo) afterNpcInfo();
  }
  World.currentTick++;
}

function finishInteraction(p, choices = [], label = 'native interaction') {
  const options = [...choices];
  const pages = [];
  for (let tick = 0; tick < 400; tick++) {
    const state = p.activeScript;
    if (!state || state.execution === ScriptState.FINISHED) break;
    assert.notEqual(state.execution, ScriptState.ABORTED, `${label} script does not abort`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      pages.push(...dialoguePage(p));
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      if (/^multi[2-5]$/.test(root)) {
        assert(options.length > 0, `${label} does not leave an unanswered choice (${root})`);
        resumeDialogue(p, options.shift());
      } else {
        resumeDialogue(p);
      }
      continue;
    }
    if (state.execution === ScriptState.SUSPENDED || state.execution === ScriptState.COUNTDIALOG) {
      worldTick();
      continue;
    }
    break;
  }
  assert.equal(options.length, 0, `${label} uses all supplied dialogue choices`);
  assert(!p.activeScript || [ScriptState.FINISHED, ScriptState.PAUSEBUTTON].includes(p.activeScript.execution),
    `${label} settles or pauses at a known dialogue boundary`);
  return pages.join(' ');
}

function operateNpc(p, target, option, choices = [], label = `NPC option ${option}`) {
  p.clearInteraction();
  World.processInfo();
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  p.dialogueMark = p.packets.length;
  assert(OpNpcHandler.handle(new OpNpc(option, target.nid), p), `${label} native OpNpc packet accepted`);
  assert(p.inOperableDistance(target), `${label} is at ordinary operation distance`);
  const trigger = p.getOpTrigger();
  assert(trigger, `${label} resolves the currently visible NPC form through production dispatch`);
  p.processInteraction();
  return { trigger, text: finishInteraction(p, choices, label) };
}
function operateLoc(p, target, option, choices = [], label = `loc option ${option}`) {
  p.clearInteraction();
  World.processInfo();
  assert(OpLocHandler.handle(new OpLoc(option, target.x, target.z, target.type), p), `${label} native OpLoc packet accepted`);
  assert(p.inOperableDistance(target), `${label} is at ordinary operation distance`);
  const trigger = p.getOpTrigger();
  assert(trigger, `${label} resolves the visible loc form through production trigger dispatch`);
  p.dialogueMark = p.packets.length;
  p.processInteraction();
  return { trigger, text: finishInteraction(p, choices, label) };
}

function nativeRouteFrom(start, destination, label) {
  assert.equal(start.level, destination.level, `${label} stays on the same collision plane`);
  if (start.x === destination.x && start.z === destination.z) return [destination];
  const packed = [...map.findPath(start.level, start.x, start.z, destination.x, destination.z)];
  assert(packed.length > 0, `${label} has a registered collision path`);
  const route = packed.map(value => unpackWorld(value));
  assert.deepEqual(route.at(-1), { level: destination.level, x: destination.x, z: destination.z }, `${label} reaches its exact endpoint, not a nearest fallback`);
  return route;
}
function nativeRoute(p, destination, label) {
  return nativeRouteFrom({ level: p.level, x: p.x, z: p.z }, destination, label);
}
function moveAlongPath(p, route, label) {
  if (route.length <= 1 && p.level === route[0]?.level && p.x === route[0]?.x && p.z === route[0]?.z) return;
  const clickPath = route.map(({ x, z }) => ({ x, z }));
  assert(MoveClickHandler.handle(new MoveClick(clickPath, 0, false), p), `${label} accepted by native MoveClick handler`);
  const destination = route.at(-1);
  for (let tick = 0; tick < 512; tick++) {
    worldTick();
    if (p.level === destination.level && p.x === destination.x && p.z === destination.z) return;
  }
  assert.fail(`${label} did not reach exact tile ${destination.level}_${destination.x}_${destination.z}; stopped at ${p.level}_${p.x}_${p.z}`);
}
function moveToTile(p, destination, label) {
  if (p.level === destination.level && p.x === destination.x && p.z === destination.z) return;
  moveAlongPath(p, nativeRoute(p, destination, label), label);
  assert.deepEqual(tile(p), [destination.level, destination.x, destination.z], `${label} reaches exact endpoint`);
}
function findStand(p, target, radius = 12) {
  const origin = { level: p.level, x: p.x, z: p.z };
  if (p.inOperableDistance(target)) return origin;
  const width = target.width ?? 1;
  const length = target.length ?? 1;
  const centerX = target.x + Math.floor(width / 2);
  const centerZ = target.z + Math.floor(length / 2);
  const candidates = [];
  for (let x = centerX - radius; x <= centerX + radius; x++) {
    for (let z = centerZ - radius; z <= centerZ + radius; z++) {
      if (!map.isMapBlocked(x, z, target.level) &&
        !(x >= target.x && x < target.x + width && z >= target.z && z < target.z + length)) {
        candidates.push({
          level: target.level, x, z, distance: (x - centerX) ** 2 + (z - centerZ) ** 2
        });
      }
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.x - b.x || a.z - b.z);
  for (const candidate of candidates) {
    p.level = candidate.level; p.x = candidate.x; p.z = candidate.z;
    const inRange = p.inOperableDistance(target);
    let reachable = false;
    if (inRange) {
      const route = map.findPath(origin.level, origin.x, origin.z, candidate.x, candidate.z);
      if (route.length > 0) {
        const end = unpackWorld(route.at(-1));
        reachable = end.level === candidate.level && end.x === candidate.x && end.z === candidate.z;
      }
    }
    if (reachable) {
      p.level = origin.level; p.x = origin.x; p.z = origin.z;
      return candidate;
    }
  }
  p.level = origin.level; p.x = origin.x; p.z = origin.z;
  assert.fail(`no exact reachable ordinary-operation stand for ${target.type} at ${target.level}_${target.x}_${target.z}`);
}
function goToStand(p, target, label) {
  const stand = findStand(p, target);
  moveToTile(p, stand, label);
  assert(p.inOperableDistance(target), `${label} ends within native operation distance`);
  return stand;
}
function findStandFrom(p, origin, target, label) {
  const previous = { level: p.level, x: p.x, z: p.z };
  p.level = origin.level; p.x = origin.x; p.z = origin.z;
  let stand;
  try {
    stand = findStand(p, target);
  } finally {
    p.level = previous.level; p.x = previous.x; p.z = previous.z;
  }
  nativeRouteFrom(origin, stand, `${label}: exact ordinary path from room origin`);
  return stand;
}
function assertFootprintOpen(level, x, z, width, length, label) {
  assert(Number.isInteger(width) && width > 0 && Number.isInteger(length) && length > 0,
    `${label} has a defined actor footprint`);
  for (let dx = 0; dx < width; dx++) {
    for (let dz = 0; dz < length; dz++) {
      assert.equal(map.isMapBlocked(x + dx, z + dz, level), false,
        `${label} footprint tile ${level}_${x + dx}_${z + dz} is collision-open`);
    }
  }
}
function activeNpc(name, position = null) {
  const type = requiredId('NpcType', name);
  const matches = [...World.npcs].filter(npc => npc?.isActive && (npc.baseType === type || npc.type === type) &&
    (!position || (npc.level === position.level && npc.x === position.x && npc.z === position.z)));
  assert(matches.length > 0, `active packed NPC ${name}${position ? ` at ${position.level}_${position.x}_${position.z}` : ''} exists`);
  return matches[0];
}
function rageNpcsFor(p) {
  const uid = instanceUid(p);
  return [...World.npcs].filter(npc => npc?.isActive && RAGE_IDS.has(npc.type) &&
    npc.vars[NPC_INSTANCE] === uid && (npc.vars[NPC_OWNER] >>> 0) === p.uid);
}
function rageNpcsWithInstance(uid) {
  return [...World.npcs].filter(npc => npc?.isActive && RAGE_IDS.has(npc.type) && npc.vars[NPC_INSTANCE] === uid);
}
function fearNpcsFor(p) {
  const uid = instanceUid(p);
  return [...World.npcs].filter(npc => npc?.isActive &&
    (npc.baseType === FEAR_NPC || npc.type === FEAR_NPC) &&
    npc.vars[NPC_INSTANCE] === uid && (npc.vars[NPC_OWNER] >>> 0) === p.uid);
}
function fearNpcsWithInstance(uid) {
  return [...World.npcs].filter(npc => npc?.isActive &&
    (npc.baseType === FEAR_NPC || npc.type === FEAR_NPC) && npc.vars[NPC_INSTANCE] === uid);
}
function confusionNpcsFor(p) {
  const uid = instanceUid(p);
  return [...World.npcs].filter(npc => npc?.isActive && CONFUSION_IDS.has(npc.type)
    && npc.vars[NPC_INSTANCE] === uid && (npc.vars[NPC_OWNER] >>> 0) === p.uid);
}
function hopeNpcsFor(p) {
  const uid = instanceUid(p);
  return [...World.npcs].filter(npc => npc?.isActive && HOPE_IDS.has(npc.type)
    && npc.vars[NPC_INSTANCE] === uid && (npc.vars[NPC_OWNER] >>> 0) === p.uid);
}
function remainingNpcsWithInstance(uid) {
  return [...World.npcs].filter(npc => npc?.isActive && npc.vars[NPC_INSTANCE] === uid
    && (CONFUSION_IDS.has(npc.type) || HOPE_IDS.has(npc.type)));
}
function heroPointSnapshot(npc) {
  return npc.heroPoints.map(hero => [hero.hash64.toString(), hero.points]);
}
function fearHoleLocs(p) {
  const matches = nearbyLocs(p, /^soul_bane_fwall_void(?:[2-6])?$/);
  assert.equal(matches.length, FEAR_HOLES.length, 'the copied Fear room has exactly six packed dark holes');
  const byName = new Map(matches.map(loc => [types.LocType.get(loc.type)?.debugname, loc]));
  return FEAR_HOLES.map(name => {
    const loc = byName.get(name);
    assert(loc, `packed Fear hole ${name} is present in the copied room`);
    return loc;
  });
}
function fearWestExitLoc(p) {
  const matches = nearbyLocs(p, /^soulbane_fwall_exit_multi$/);
  assert.equal(matches.length, 1, 'the copied Fear room has exactly one western exit multiloc');
  return matches[0];
}
function fearSurfaceExitLoc(p) {
  const matches = nearbyLocs(p, /^soul_bane_fwall_void_small$/);
  assert.equal(matches.length, 1, 'the copied Fear room has exactly one packed surface Exit');
  return matches[0];
}
function fearReaperSpawn(p, door) {
  assert(Number.isInteger(door) && door >= 1 && door <= FEAR_REAPER_SPAWNS.length,
    `Fear door ${door} names one of six packed reaper points`);
  return roomCoord(p, FEAR_REAPER_SPAWNS[door - 1]);
}
function assertFearReset(p, label) {
  for (const name of ['soulbane_fear_enemydoor', 'soulbane_fear_enemydoor_old', 'soulbane_fear_monspres',
    'soulbane_fear_killedtally', 'soulbane_fear_exitlit']) {
    assert.equal(readVar(p, name), 0, `${label}: ${name} resets to zero`);
  }
}
function locAt(level, x, z, name) {
  const type = requiredId('LocType', name);
  const loc = World.getLoc(x, z, level, type);
  assert(loc, `packed loc ${name} exists at ${level}_${x}_${z}`);
  return loc;
}
function riftLoc() {
  return locAt(0, 3310, 3452, 'soulbane_falloff2_rope_multi');
}
function roomLoc(p, template, name) {
  const coord = roomCoord(p, template);
  return locAt(coord.level, coord.x, coord.z, name);
}
function outerLauna() {
  return activeNpc('soulbane_launa_multi', { level: 0, x: 3309, z: 3453 });
}
function questRoomExitLoc(p) {
  const name = stage(p) >= HOPE_STAGE ? 'soul_bane_hwall_void_small' : 'soul_bane_cwall_void_small';
  const matches = nearbyLocs(p, new RegExp(`^${name}$`), 52);
  assert.equal(matches.length, 1, `stage ${stage(p)} room copy has one packed ${name} surface exit`);
  return matches[0];
}
function leaveQuestRoom(p, label) {
  const previousUid = instanceUid(p);
  const choices = stage(p) === CONFUSION_STAGE || stage(p) === HOPE_STAGE ? [1] : [];
  const exit = questRoomExitLoc(p);
  const result = operateSurfaceExit(p, exit, choices, label);
  assert.match(result.trigger.name, /^\[oploc1,soul_bane_[ch]wall_void_small\]$/,
    `${label}: native room Exit uses the original visible loc operation`);
  assert.equal(instanceUid(p), 0, `${label}: ordinary exit releases the private-copy handle`);
  assert.equal(World.instances.findInstanceByUid(previousUid - 1), null,
    `${label}: ordinary exit removes the now-empty private copy`);
  assert.deepEqual(tile(p), surfaceTile(), `${label}: ordinary exit returns to the saved overworld surface`);
  return result;
}
function assertLaunaReport(p, expected, excluded, label) {
  const launa = outerLauna();
  goToStand(p, launa, `${label}: walk to Launa at the surface`);
  const result = operateNpc(p, launa, 1, [], label);
  assert.match(result.trigger.name, /^\[opnpc1,soulbane_launa(?:_multi)?\]$/i,
    `${label}: native Talk-to dispatches the compiled Launa report`);
  for (const phrase of expected) {
    assert(result.text.includes(phrase), `${label}: Launa report includes ${JSON.stringify(phrase)}`);
  }
  for (const phrase of excluded) {
    assert(!result.text.includes(phrase), `${label}: Launa does not claim ${JSON.stringify(phrase)}`);
  }
  return result.text;
}
function nedNpc() {
  return activeNpc('ned', { level: 0, x: 3100, z: 3258 });
}
function rackLoc(p) {
  const { level, x, z } = templateCoord(p, CoordGrid.packCoord(0, 3012, 5243));
  return locAt(level, x, z, 'soulbane_rack_multi');
}
function quitLoc(p) {
  // Parent cache/map receipt: loc 13878, m47_81 local (7,61) => 3015,5245.
  const { level, x, z } = templateCoord(p, CoordGrid.packCoord(0, 3015, 5245));
  return locAt(level, x, z, 'soul_bane_awall_void_small');
}
function rageFearBoundaryLoc(p) {
  // Cache map receipt: loc 13882 at m47_81 local (30,44) => 3038,5228.
  const { level, x, z } = templateCoord(p, CoordGrid.packCoord(0, 3038, 5228));
  return locAt(level, x, z, 'soul_bane_awall_void_exit');
}

function checkVarpMetadata() {
  assert.equal(STAGE_VARP, 709, 'soulbane_prog still uses original varp slot 709');
  assert.equal(types.VarPlayerType.get(STAGE_VARP).scope, types.VarPlayerType.SCOPE_PERM,
    'soulbane_prog base varp is permanent');
  assert.equal(INSTANCE_VARP, 190, 'soulbane_instance uses original varp slot 190');
  const instance = types.VarPlayerType.get(INSTANCE_VARP);
  assert.equal(instance.scope, types.VarPlayerType.SCOPE_TEMP, 'instance varp remains temporary');
  assert.equal(instance.transmit, false, 'instance varp remains no-transmit');
  assert.equal(instance.clientcode, 0, 'instance varp has no client code');
  assert.equal(types.VarBitType.get(METER_VARBIT).basevar, 711, 'anger meter remains in original varp slot 711');
  assert.equal(types.VarPlayerType.get(711).scope, types.VarPlayerType.SCOPE_TEMP, 'anger meter varp remains temporary');
  assert.equal(types.VarBitType.get(WEAPON_VARBIT).basevar, 710, 'rack multi remains in original varp slot 710');
  assert.equal(types.VarPlayerType.get(710).scope, types.VarPlayerType.SCOPE_PERM, 'rack and permanent rope bits retain the original shared permanent varp');
}
function checkOutsideFixedRoutes(p) {
  const nedStart = { level: p.level, x: p.x, z: p.z };
  const surface = { level: 0, x: 3310, z: 3455 };
  const ned = nedNpc();
  const launa = outerLauna();
  const rift = riftLoc();
  for (const [label, actor, start] of [['Ned', ned, nedStart], ['Launa', launa, surface]]) {
    assertFootprintOpen(actor.level, actor.x, actor.z, actor.width, actor.length, `${label} packed tile`);
    nativeRouteFrom(start, { level: actor.level, x: actor.x, z: actor.z }, `outer route to ${label}'s exact tile`);
  }
  assertFootprintOpen(rift.level, rift.x, rift.z, 1, 1, 'packed rift operation tile');
  assertFootprintOpen(surface.level, surface.x, surface.z, 1, 1, 'surface travel fixture and exit tile');
  nativeRouteFrom(surface, { level: rift.level, x: rift.x, z: rift.z }, 'surface route to the packed rift');
  return { ned, launa, rift };
}
function checkRoomRoutes(p) {
  const entry = roomCoord(p, 'soulbane_rage_entry');
  assertFootprintOpen(entry.level, entry.x, entry.z, 1, 1, 'Rage player entry');
  const declarations = questCoordinateDeclarations();
  for (const [name] of declarations) {
    if (!name.startsWith('soulbane_rage_')) continue;
    const destination = roomCoord(p, name);
    nativeRouteFrom(entry, destination, `instance route to fixed ${name}`);
    if (name.startsWith('soulbane_rage_') && /\d$/.test(name)) {
      const family = name.match(/soulbane_rage_(bear|unicorn|rat|goblin)\d$/)?.[1];
      const actorType = `soulbane_anger_${family}`;
      const actor = activeNpc(actorType, destination);
      assertFootprintOpen(destination.level, destination.x, destination.z, actor.width, actor.length, `${name} NPC`);
      assert.equal(actor.vars[NPC_INSTANCE], instanceUid(p), `${name} is assigned to this private copy`);
      assert.equal(actor.vars[NPC_OWNER] >>> 0, p.uid, `${name} belongs to the entering account`);
      assert.equal(actor.vars[NPC_XP_MULTIPLIER], 0, `${name} disables normal combat XP at spawn`);
    }
  }
  return entry;
}
function checkFearRoomRoutes(p) {
  const entry = roomCoord(p, 'soulbane_fear_entry');
  assertFootprintOpen(entry.level, entry.x, entry.z, 1, 1, 'Fear player entry');
  for (const name of FEAR_REAPER_SPAWNS) {
    const spawn = roomCoord(p, name);
    assertFootprintOpen(spawn.level, spawn.x, spawn.z, 2, 2, `${name} size-2 reaper spawn`);
    nativeRouteFrom(entry, spawn, `Fear entry reaches exact ${name} spawn on foot`);
  }

  const holes = fearHoleLocs(p);
  for (const hole of holes) {
    const name = types.LocType.get(hole.type)?.debugname;
    const stand = findStandFrom(p, entry, hole, `Fear Look-inside ${name}`);
    assertFootprintOpen(stand.level, stand.x, stand.z, 1, 1, `Fear ${name} interaction stand`);
  }
  const westExit = fearWestExitLoc(p);
  const westStand = findStandFrom(p, entry, westExit, 'Fear western black-hole entry');
  assertFootprintOpen(westStand.level, westStand.x, westStand.z, 1, 1, 'Fear western black-hole stand');
  const surfaceExit = fearSurfaceExitLoc(p);
  const surfaceStand = findStandFrom(p, entry, surfaceExit, 'Fear surface Exit');
  assertFootprintOpen(surfaceStand.level, surfaceStand.x, surfaceStand.z, 1, 1, 'Fear surface Exit stand');

  const scenePlayer = roomCoord(p, 'soulbane_fear_scene_player');
  const sceneTolna = roomCoord(p, 'soulbane_fear_scene_tolna');
  assertFootprintOpen(scenePlayer.level, scenePlayer.x, scenePlayer.z, 1, 1, 'Fear cutscene player stand');
  assertFootprintOpen(sceneTolna.level, sceneTolna.x, sceneTolna.z, 1, 1, 'Fear cutscene Tolna footprint');
  // Teleport into the copied memory strip; it is not walked to from the dungeon.
  // Prove both stands from the copied original surface coordinate.
  const sceneEntry = roomCoord(p, 'soulbane_surface');
  nativeRouteFrom(sceneEntry, scenePlayer, 'copied surface entry reaches the Fear cutscene player tile on foot');
  nativeRouteFrom(sceneEntry, sceneTolna, 'copied surface entry reaches the Fear cutscene Tolna tile on foot');
  return { entry, holes, westExit, surfaceExit, scenePlayer, sceneTolna };
}
function checkConfusionRoomRoutes(p) {
  const entry = roomCoord(p, 'soulbane_confusion_entry');
  assertFootprintOpen(entry.level, entry.x, entry.z, 1, 1, 'Confusion exact player entry');
  for (const name of Array.from({ length: 5 }, (_, index) => `soulbane_confusion_spawn${index + 1}`)) {
    const spawn = roomCoord(p, name);
    const actors = [...World.npcs].filter(npc => npc?.isActive && CONFUSION_IDS.has(npc.type)
      && npc.level === spawn.level && npc.x === spawn.x && npc.z === spawn.z);
    assert.equal(actors.length, 1, `${name} has one actual native Confusion NPC at its fixed source point`);
    const actor = actors[0];
    const size = types.NpcType.get(actor.type).size;
    assertFootprintOpen(spawn.level, spawn.x, spawn.z, size, size, `${name} full ${size}×${size} actor footprint`);
    nativeRouteFrom(entry, spawn, `Confusion entry reaches exact ${name} actor tile on foot`);
  }
  const scene = {
    player: roomCoord(p, 'soulbane_confusion_scene_player'),
    tolna: roomCoord(p, 'soulbane_confusion_scene_tolna'),
    camera: roomCoord(p, 'soulbane_confusion_scene_camera')
  };
  for (const [role, stand] of Object.entries(scene)) {
    assertFootprintOpen(stand.level, stand.x, stand.z, 1, 1, `Confusion scene ${role} exact stand`);
    nativeRouteFrom(entry, stand, `Confusion entry reaches its exact ${role} stand on foot`);
  }
  const instance = instanceForOwner(p, 'Confusion four-floor scene');
  const roomZones = roomSourceZones(instance, 'Confusion four-floor scene');
  const allowed = new Set(roomZones.map(destinationZoneKey));
  for (const [role, stand] of Object.entries(scene)) {
    assertSceneMappingWindow(null, stand, allowed, `Confusion actual ${role} four-floor 13×13 window`);
  }
  return { entry, scene };
}
function checkHopeRoomRoutes(p) {
  const entry = roomCoord(p, 'soulbane_hope_entry');
  assertFootprintOpen(entry.level, entry.x, entry.z, 1, 1, 'unbridged Hope exact player entry');
  for (let index = 1; index <= 5; index++) {
    const spawn = roomCoord(p, `soulbane_hope_spawn${index}`);
    const actors = [...World.npcs].filter(npc => npc?.isActive && HOPE_IDS.has(npc.type)
      && npc.level === spawn.level && npc.x === spawn.x && npc.z === spawn.z);
    assert.equal(actors.length, 1, `Hope spawn ${index} has one actual native creature at its fixed source point`);
    const size = types.NpcType.get(actors[0].type).size;
    assertFootprintOpen(spawn.level, spawn.x, spawn.z, size, size, `Hope spawn ${index} full ${size}×${size} actor footprint`);
    nativeRouteFrom(entry, spawn, `unbridged Hope entry reaches exact spawn ${index} on foot`);
  }
  const before = roomCoord(p, 'soulbane_hope_scene_before');
  const bridgedEntry = roomCoord(p, 'soulbane_hope_bridged_entry');
  const after = roomCoord(p, 'soulbane_hope_scene_after');
  for (const [label, stand] of [['unbridged before-flash', before], ['bridged after-flash', after]]) {
    assertFootprintOpen(stand.level, stand.x, stand.z, 1, 1, `${label} exact player stand`);
  }
  assert.equal(after.level, before.level, 'Hope bridge transfer preserves the original collision plane');
  assert.equal(after.z, before.z, 'Hope bridge transfer preserves the exact north coordinate');
  assert.equal(after.x, before.x - questConstant('soulbane_hope_copy_offset'),
    'Hope bridge transfer is exactly 64 tiles west, not a replacement or nearest landing');
  const beforeInstance = World.instances.findInstanceByCoord(before);
  const afterInstance = World.instances.findInstanceByCoord(after);
  assert(beforeInstance && afterInstance, 'both Hope bridge quarters resolve to actual owner-instance zones');
  assert.equal(beforeInstance.uid, afterInstance.uid,
    'both Hope quarters resolve to the same owner instance');
  nativeRouteFrom(entry, before, 'unbridged Hope entry reaches the exact pre-flash stand on foot');
  nativeRouteFrom(bridgedEntry, after, 'bridged Hope entry reaches the exact post-flash stand on foot');
  assert(!hasExactNativeRoute(before, after),
    'the 64-tile Hope transfer cannot be reproduced by walking between copied quarters');
  const instance = instanceForOwner(p, 'Hope bridge four-floor scene');
  const roomZones = roomSourceZones(instance, 'Hope bridge four-floor scene');
  const allowed = new Set(roomZones.map(destinationZoneKey));
  assertSceneMappingWindow(null, before, allowed, 'Hope unbridged pre-flash four-floor 13×13 window');
  assertSceneMappingWindow(null, after, allowed, 'Hope bridged post-flash four-floor 13×13 window');
  return { entry, bridgedEntry, before, after };
}
function observeRageScene(p) {
  const playerStand = roomCoord(p, 'soulbane_scene_player');
  const launaStand = roomCoord(p, 'soulbane_scene_launa');
  const tolnaStand = roomCoord(p, 'soulbane_scene_tolna');
  const launa = [...World.npcs].find(npc => npc?.isActive && (npc.type === LAUNA_SCENE || npc.baseType === LAUNA_SCENE) &&
    npc.level === launaStand.level && npc.x === launaStand.x && npc.z === launaStand.z);
  const tolna = [...World.npcs].find(npc => npc?.isActive && (npc.type === TOLNA_SCENE || npc.baseType === TOLNA_SCENE) &&
    npc.level === tolnaStand.level && npc.x === tolnaStand.x && npc.z === tolnaStand.z);
  if (!launa || !tolna || p.level !== playerStand.level || p.x !== playerStand.x || p.z !== playerStand.z) return false;
  assertFootprintOpen(playerStand.level, playerStand.x, playerStand.z, 1, 1, 'family scene player stand');
  assertFootprintOpen(launa.level, launa.x, launa.z, launa.width, launa.length, 'Launa family-scene footprint');
  assertFootprintOpen(tolna.level, tolna.x, tolna.z, tolna.width, tolna.length, 'Tolna family-scene footprint');
  nativeRouteFrom(playerStand, { level: launa.level, x: launa.x, z: launa.z }, 'family scene landing reaches Launa exact tile');
  nativeRouteFrom(playerStand, { level: tolna.level, x: tolna.x, z: tolna.z }, 'family scene landing reaches Tolna exact tile');
  nativeRouteFrom(launaStand, playerStand, 'family scene landing is reachable on foot from the staged actors');
  return true;
}
function finishRageScene(p) {
  let sawFamilyStaging = false;
  const pages = [];
  const recordFamilyStaging = () => {
    assertMemoryCameraGround(p, 'Rage');
    if (sawFamilyStaging || stage(p) !== 2 || readVar(p, 'soulbane_anger_donespecial') !== 1 ||
      !observeRageScene(p)) return;
    const instance = instanceForOwner(p, 'Rage memory scene');
    const { rageZones } = assertInstanceTemplateInventory(instance, 'Rage memory scene');
    assertMemorySceneVisibility(p, rageZones, 'Rage', 'Rage memory scene', true);
    sawFamilyStaging = true;
  };
  for (let tick = 0; tick < 1200; tick++) {
    recordFamilyStaging();
    const state = p.activeScript;
    if (state?.execution === ScriptState.PAUSEBUTTON) {
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      assert(!/^multi[2-5]$/.test(root), 'the compiled family scene has no unanswered choices');
      const page = dialoguePage(p);
      pages.push(...page);
      const outburst = page.some(text => text.includes('Arrrgghhh!'));
      resumeDialogue(p);
      if (outburst) {
        const cycleCount = types.SeqType.get(requiredId('SeqType', 'anger_special_play')).duration;
        const expectedDelay = Math.ceil(cycleCount / 30);
        assert(cycleCount > 0 && expectedDelay > 0, 'the packed Rage sequence defines a positive duration');
        assert.equal(p.delayedUntil - World.currentTick - 1, expectedDelay,
          'Rage burst delay converts packed client cycles to server ticks, rounded up');
        for (let elapsed = 0; elapsed <= expectedDelay + 1; elapsed++) worldTick();
        assert.equal(p.activeScript?.execution, ScriptState.PAUSEBUTTON,
          'Rage reaches the first Continue after its animation delay');
        assert(dialoguePage(p).some(text => text.includes('Wow! How did I do that?')),
          'the first post-animation Continue shows the authored reaction');
        console.log(`PASS Rage burst timing: ${cycleCount} client cycles -> ${expectedDelay} server ticks; first Continue ready`);
      }
      recordFamilyStaging();
      continue;
    }
    worldTick();
    recordFamilyStaging();
    if (stage(p) === 3 && p.queue.head() === null &&
      (!p.activeScript || p.activeScript.execution === ScriptState.FINISHED)) break;
  }
  assert(sawFamilyStaging, 'Rage special runs the authored player/Launa/Tolna staging before returning');
  assertMemoryCameraCoverage(p, 'Rage');
  assert.equal(stage(p), 3, 'family scene commits the permanent stage-3 boundary');
  assert.deepEqual({ level: p.level, x: p.x, z: p.z }, roomCoord(p, 'soulbane_rage_entry'),
    'family scene returns the player to the Rage entry tile');
  assert(pages.some(text => text.includes('Arrrgghhh!')), 'family scene includes the authored anger outburst');
  assert(pages.some(text => text.includes("Where are you going?")), "family scene includes Launa's first authored line");
  assert(pages.some(text => text.includes('TOLNA !!!')), 'family scene includes Launa reunion line');
  return pages.join(' ');
}

function chooseRiftWithRope(p, label, {
  musicMode = 1, requireLocked = false, requireUnlocked = false, previousTrack = null
} = {}) {
  const currentStage = stage(p);
  const song = currentStage >= HOPE_STAGE ? HOPE_SONG
    : currentStage >= CONFUSION_STAGE ? CONFUSION_SONG
      : currentStage >= FEAR_STAGE ? FEAR_SONG : RAGE_SONG;
  const rift = riftLoc();
  goToStand(p, rift, `${label}: walk to actual rift floor`);
  const observation = beginRoomMusicObservation(p, song, musicMode, label,
    { requireLocked, requireUnlocked, previousTrack });
  const result = operateLoc(p, rift, 1, [], `${label}: use Climb-down on rift`);
  assert.match(result.trigger.name, /^\[oploc1,soulbane_falloff2_rope(?:_multi)?\]$/,
    `${label}: descent dispatch uses the rope-visible floor form`);
  assert(stage(p) >= 2, `${label}: descent runs the compiled Rage admission`);
  assert.notEqual(instanceUid(p), 0, `${label}: descent creates a private region`);
  assertRoomMusicObservation(p, observation, label);
  return result;
}
function seedStageOneOwner(p, label) {
  // Isolated second-account/death fixtures only. These are not the main quest path.
  writeVar(p, 'soulbane_prog', 1);
  writeVar(p, 'soulbane_riftrope_pres', 1);
  assert.equal(stage(p), 1, `${label}: disclosed quest-stage seed is stage 1`);
  assert.equal(readVar(p, 'soulbane_riftrope_pres'), 1, `${label}: disclosed attached-rope seed is present`);
  chooseRiftWithRope(p, label);
  assert.equal(stage(p), 2, `${label}: native descent creates Rage stage 2`);
}

// Disclosed pre-memory fixtures test input admission, not quest progression.
// Every checkpoint is a real scheduling boundary of the compiled scene.
const MEMORY_PROBES = [
  { name: 'Rage', stage: 2, complete: 3, player: 'soulbane_scene_player',
    entry: 'soulbane_rage_entry', ready: 'soulbane_anger_donespecial', value: 1,
    queue: 'soulbane_rage_complete' },
  { name: 'Fear', stage: FEAR_STAGE, complete: FEAR_COMPLETE_STAGE,
    player: 'soulbane_fear_scene_player', entry: 'soulbane_fear_entry',
    ready: 'soulbane_fear_killedtally', value: 5, queue: 'soulbane_fear_complete' }
];
function beginMemoryProbe(memory) {
  const p = playerFixture();
  writeVar(p, 'soulbane_prog', memory.name === 'Rage' ? 1 : memory.stage);
  writeVar(p, 'soulbane_riftrope_pres', 1);
  chooseRiftWithRope(p, `disclosed ${memory.name} input-admission fixture`);
  p.tabs[LOGOUT_TAB] = types.Component.get(requiredId('Component', 'logout:try_logout')).rootLayer;
  writeVar(p, memory.ready, memory.value);
  const instance = instanceForOwner(p, `${memory.name} input fixture`);
  const { rageZones, fearZones } = assertInstanceTemplateInventory(instance, `${memory.name} input fixture`);
  const anchor = instanceZoneForSource(instance, sourceCoordForName(memory.player), memory.name);
  const component = memory.name === 'Rage' ? rageZones : fearZones;
  assert(component.includes(anchor), `${memory.name}: actual memory anchor belongs to its exact original-source patch`);
  const script = ScriptProvider.getByName(`[queue,${memory.queue}]`);
  assert(script, `${memory.name}: compiled completion queue exists`);
  p.enqueueScript(script);
  return {
    p, memory, instance, standing: roomCoord(p, memory.player),
    zoneKeys: new Set(component.map(destinationZoneKey))
  };
}
function inProbeMemory(probe) {
  const { p } = probe;
  return probe.zoneKeys.has(`${p.level}:${p.x >> 3}:${p.z >> 3}`);
}
function advanceMemoryProbe(p) {
  assert.notEqual(p.activeScript?.execution, ScriptState.ABORTED, 'memory probe script never aborts');
  if (p.activeScript?.execution === ScriptState.PAUSEBUTTON) resumeDialogue(p);
  else worldTick();
}
function observeHeldMemoryTile(probe) {
  const { p, memory } = probe;
  const zone = World.gameMap.getZoneIfExists(p.x, p.z, p.level);
  assert(zone instanceof InstanceZone && zone.hasAssignedTemplate,
    `${memory.name}: observed script placement has a real source mapping`);
  const source = {
    level: zone.source.level,
    x: (zone.source.x << 3) + (p.x & 7),
    z: (zone.source.z << 3) + (p.z & 7)
  };
  let positions = heldMemoryStandingTiles.get(memory.name);
  if (!positions) {
    positions = new Map();
    heldMemoryStandingTiles.set(memory.name, positions);
  }
  positions.set(`${source.level}:${source.x}:${source.z}`, source);
}
function memoryCheckpoints(memory) {
  const probe = beginMemoryProbe(memory);
  const checkpoints = [];
  let finished = false;
  for (let boundary = 0; boundary < 256; boundary++) {
    if (inProbeMemory(probe)) {
      observeHeldMemoryTile(probe);
      checkpoints.push({
        boundary, execution: probe.p.activeScript?.execution,
        delayed: probe.p.delayed, remainingDelay: probe.p.delayedUntil - World.currentTick
      });
    }
    if (stage(probe.p) === memory.complete) {
      finished = true;
      break;
    }
    advanceMemoryProbe(probe.p);
  }
  assert(finished, `${memory.name}: baseline visits the entire memory and its real return`);
  assert(checkpoints.some(point => point.delayed), `${memory.name}: delay boundaries are exercised`);
  if (memory.name === 'Rage') {
    assert(checkpoints.filter(point => point.execution === ScriptState.PAUSEBUTTON).length >= 7,
      'Rage: all seven family dialogue pages are scheduling checkpoints');
  }
  runProc('soulbane_leave', probe.p);
  return checkpoints;
}
function sendProbeWalk(p, minimap, label) {
  const start = { level: p.level, x: p.x, z: p.z };
  const destination = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]
    .map(([dx, dz]) => ({ level: p.level, x: p.x + dx, z: p.z + dz }))
    .find(candidate => hasExactNativeRoute(start, candidate));
  assert(destination, `${label}: the walk request has a genuinely reachable different endpoint`);
  nativeRouteFrom(start, destination, `${label}: exact collision route`);
  const length = 5 + (minimap ? 14 : 0);
  const packet = new Packet(new Uint8Array(length));
  packet.p2_alt3(destination.x);
  packet.p1(0);
  packet.p2_alt3(destination.z);
  packet.pos = 0;
  const protocol = minimap ? ClientGameProt.MOVE_MINIMAPCLICK : ClientGameProt.MOVE_GAMECLICK;
  const message = new MoveClickDecoder(protocol).decode(packet, length);
  assert.deepEqual(message.path, [{ x: destination.x, z: destination.z }],
    `${label}: the actual ground/minimap decoder retains the requested destination`);
  MoveClickHandler.handle(message, p);
  return destination;
}
function assertProbeHeldOrReturned(probe, label) {
  const { p, memory, standing } = probe;
  if (![...World.playerLoop.all()].includes(p)) return false;
  const expected = stage(p) === memory.complete ? roomCoord(p, memory.entry) : standing;
  assert.deepEqual(tile(p), [expected.level, expected.x, expected.z],
    `${label}: input never moves the player off the script's placement tile`);
  if (inProbeMemory(probe)) observeHeldMemoryTile(probe);
  return true;
}
function testMemoryInputHold() {
  for (const memory of MEMORY_PROBES) {
    const checkpoints = memoryCheckpoints(memory);
    const logoutSaves = [];
    for (const point of checkpoints) {
      for (const channel of ['ground', 'minimap', 'close-ground', 'close-minimap', 'logout', 'logout-button']) {
        const probe = beginMemoryProbe(memory);
        const { p } = probe;
        const label = `${memory.name} boundary ${point.boundary} ${channel}`;
        for (let boundary = 0; boundary < point.boundary; boundary++) advanceMemoryProbe(p);
        assert(inProbeMemory(probe), `${label}: replay reaches the actual memory`);
        assert.equal(p.activeScript?.execution, point.execution, `${label}: replay reaches the same script boundary`);
        assert.equal(p.delayed, point.delayed, `${label}: replay reaches the same delay state`);
        observeHeldMemoryTile(probe);
        if (channel.startsWith('close-')) {
          assert(CloseModalHandler.handle(new CloseModal(), p), `${label}: native close request is admitted`);
          worldTick();
          assertProbeHeldOrReturned(probe, label);
        }
        if (channel === 'logout') p.requestLogout = true;
        else if (channel === 'logout-button') {
          assert(button(p, 'logout:try_logout'), `${label}: the real visible logout button is admitted`);
        } else if (stage(p) !== memory.complete) sendProbeWalk(p, channel.endsWith('minimap'), label);
        const expectsLogout = channel === 'logout' || p.requestLogout || p.loggingOut;
        if (channel === 'logout-button' && !expectsLogout && stage(p) !== memory.complete) {
          sendProbeWalk(p, false, `${label}: ground request after rejected logout`);
        }
        assertProbeHeldOrReturned(probe, label);
        let settled = false;
        for (let boundary = 0; boundary < 256; boundary++) {
          if (!assertProbeHeldOrReturned(probe, label)) {
            assert(expectsLogout, `${label}: only an admitted logout removes the session`);
            const request = World.logoutRequests.get(p.username);
            assert(request?.save, `${label}: ordinary logout writes a genuine save`);
            const loaded = PlayerLoading.load(p.username, new Packet(request.save), null);
            World.logoutRequests.delete(p.username);
            logoutSaves.push(p.username);
            const surface = sourceCoordForName('soulbane_surface');
            assert.deepEqual(tile(loaded), [surface.level, surface.x, surface.z],
              `${label}: logout saves only the configured surface exit`);
            assert.equal(instanceUid(loaded), 0, `${label}: saved state contains no runtime instance`);
            settled = true;
            break;
          }
          if (!expectsLogout && stage(p) === memory.complete) {
            settled = true;
            runProc('soulbane_leave', p);
            break;
          }
          if (expectsLogout) worldTick();
          else advanceMemoryProbe(p);
        }
        assert(settled, `${label}: actual scene return or logout settles without a forced runtime restoration`);
      }
    }
    assert(heldMemoryStandingTiles.get(memory.name)?.size > 0,
      `${memory.name}: input proof supplies a nonempty observed standing set`);
    console.log(`PASS entire native memory input hold ${JSON.stringify({
      memory: memory.name, checkpoints, channels: 6, logoutSaves,
      standingTiles: [...heldMemoryStandingTiles.get(memory.name).values()]
    })}`);
  }
  // The same decoded packets must move a free player: rejected or inert packet
  // construction cannot accidentally make the memory admission proof pass.
  for (const minimap of [false, true]) {
    const p = playerFixture();
    const destination = sendProbeWalk(p, minimap, 'free-player packet control');
    for (let tick = 0; tick < 16 && (p.x !== destination.x || p.z !== destination.z); tick++) worldTick();
    assert.deepEqual(tile(p), [destination.level, destination.x, destination.z],
      `the decoded ${minimap ? 'minimap' : 'ground'} control really moves a free player`);
    console.log(`PASS decoded ${minimap ? 'minimap' : 'ground'} free-player movement control`);
  }
}
function testMemoryTeleportAdmission() {
  const observations = [];
  for (const memory of MEMORY_PROBES) {
    const checkpoints = memoryCheckpoints(memory);
    for (const point of checkpoints) {
      for (const channel of ['lumbridge-spell', 'glory-rub']) {
        const probe = beginMemoryProbe(memory);
        const { p, instance } = probe;
        const label = `${memory.name} boundary ${point.boundary} ${channel}`;
        // Disclosed owned-item fixtures only; the native handler must consume them.
        seed(p, ['lawrune', 'earthrune', 'amulet_of_glory_4']);
        p.invAdd(inv, obj('airrune'), 10);
        for (let boundary = 0; boundary < point.boundary; boundary++) advanceMemoryProbe(p);
        assert(inProbeMemory(probe), `${label}: reaches the real memory before the request`);
        assert.equal(p.activeScript?.execution, point.execution, `${label}: same scheduling boundary`);
        assert.equal(p.delayed, point.delayed, `${label}: same native delay state`);
        const packetsBefore = p.packets.length;
        const mayDepart = point.execution === ScriptState.PAUSEBUTTON && !point.delayed;
        const admitted = channel === 'lumbridge-spell'
          ? button(p, 'magic:lumbridge_teleport')
          : held(p, 'amulet_of_glory_4', 4);
        // Process the request before advancing an old dialogue page ourselves.
        worldTick();
        let outcome = null;
        for (let boundary = 0; boundary < 256; boundary++) {
          if (instanceUid(p) === 0) {
            outcome = 'departed';
            break;
          }
          assertProbeHeldOrReturned(probe, label);
          if (stage(p) === memory.complete) {
            outcome = 'returned';
            break;
          }
          if (p.activeScript?.execution === ScriptState.PAUSEBUTTON) {
            const root = types.Component.get(p.modalChat)?.comName ?? '';
            if (/^multi[2-5]$/.test(root)) resumeDialogue(p, 1);
            else resumeDialogue(p);
          } else worldTick();
        }
        assert(outcome, `${label}: native departure or actual scene completion settles`);
        assert.equal(outcome, mayDepart ? 'departed' : 'returned',
          `${label}: paused dialogue admits ordinary travel; delayed memory rejects it`);
        const observedTile = tile(p);
        if (outcome === 'departed') {
          assert.equal(admitted, true, `${label}: the native input handler admitted the departure`);
          assert.equal(stage(p), memory.stage, `${label}: travel cannot complete the unfinished room`);
          assert.equal(World.instances.findInstanceByUid(instance.uid), null,
            `${label}: ordinary travel deletes the now-empty owned region`);
          assertNoAngerItems(p, label);
          assert.equal(readVar(p, 'soulbane_anger_damagedealt'), 0, `${label}: anger meter is reset`);
          assert.equal(readVar(p, 'soulbane_anger_donespecial'), 0, `${label}: no stale completion marker`);
          assert.equal(readVar(p, 'soulbane_anger_weaponmulti'), 0, `${label}: no temporary weapon selection`);
          assert(p.packets.slice(packetsBefore).some(packet => packet instanceof CamReset),
            `${label}: actual native departure emits a camera reset`);
          if (channel === 'glory-rub') {
            // Existing amulet_of_glory.rs2 option one, not a new quest destination.
            assert.deepEqual(observedTile, [0, 48 * 64 + 15, 54 * 64 + 40],
              `${label}: the real Edgeville choice is reached`);
            assert.equal(count(p, 'amulet_of_glory_4'), 0, `${label}: charged item was consumed`);
            assert.equal(count(p, 'amulet_of_glory_3'), 1, `${label}: one native charge was spent`);
          } else {
            // Existing magic_spell_teleport_lumbridge row, with its native radius two.
            assert.equal(p.level, 0, `${label}: native spell reaches the surface plane`);
            assert(Math.max(Math.abs(p.x - (50 * 64 + 21)), Math.abs(p.z - (50 * 64 + 18))) <= 2,
              `${label}: the real spell lands within its defined Lumbridge radius`);
            assert.equal(count(p, 'lawrune'), 0, `${label}: native spell spends its law rune`);
            assert.equal(count(p, 'earthrune'), 0, `${label}: native spell spends its earth rune`);
            assert.equal(count(p, 'airrune'), 7, `${label}: native spell spends three air runes`);
          }
          for (let tick = 0; tick < 16; tick++) worldTick();
          assert.equal(stage(p), memory.stage, `${label}: stale scene queues cannot grant completion`);
          assert.equal(readVar(p, 'soulbane_anger_damagedealt'), 0, `${label}: stale credit cannot restore anger`);
          const destination = sendProbeWalk(p, false, `${label}: released-hold positive control`);
          for (let tick = 0; tick < 16 && (p.x !== destination.x || p.z !== destination.z); tick++) worldTick();
          assert.deepEqual(tile(p), [destination.level, destination.x, destination.z],
            `${label}: ordinary movement works after scene cleanup`);
        } else {
          assert.equal(stage(p), memory.complete, `${label}: rejected travel allows the real memory to finish`);
          runProc('soulbane_leave', p);
        }
        observations.push({ memory: memory.name, boundary: point.boundary, execution: point.execution,
          delayed: point.delayed, channel, admitted, outcome, tile: observedTile });
      }
    }
  }
  for (const channel of ['lumbridge-spell', 'glory-rub']) {
    assert(observations.some(observation => observation.memory === 'Rage'
      && observation.channel === channel && observation.outcome === 'departed'),
    `${channel}: at least one genuine Rage dialogue departure is a positive control`);
  }
  console.log(`PASS entire native memory teleport admission ${JSON.stringify(observations)}`);
}
function testManualRoomMusicEntries() {
  for (const fixture of [
    { stage: 1, song: RAGE_SONG, label: 'manual first Rage entry' },
    { stage: FEAR_STAGE, song: FEAR_SONG, label: 'manual first Fear entry' }
  ]) {
    const p = playerFixture();
    writeVar(p, 'soulbane_prog', fixture.stage);
    writeVar(p, 'soulbane_riftrope_pres', 1);
    assert.equal(stage(p), fixture.stage, `${fixture.label}: disclosed entry-boundary seed`);
    assert.equal(readVar(p, 'soulbane_riftrope_pres'), 1, `${fixture.label}: attached-rope seed`);
    assert.notEqual(fixture.song.track, MANUAL_PREVIOUS_SONG.track,
      `${fixture.label}: the prior real track differs from the room song`);
    chooseRiftWithRope(p, fixture.label, {
      musicMode: 0,
      requireLocked: true,
      previousTrack: MANUAL_PREVIOUS_SONG.track
    });
    if (fixture.stage === 1) {
      assert.equal(stage(p), 2, `${fixture.label}: native Rage admission advances stage 1`);
    } else {
      assertFearFreshEntry(p, fixture.label);
    }
  }
}

function latestQuestColor(p) {
  execute('[proc,update_questlist]', p);
  const packet = p.packets.filter(value => value.constructor.name === 'IfSetColour' && value.component === QUEST_ROW).at(-1);
  assert(packet, 'compiled quest-list update emits Soulbane row color');
  return packet.colour;
}
function assertJournal(p, expected, excluded, label) {
  const mark = p.packets.length;
  assert(button(p, 'questlist:soulbane'), `${label}: native quest-list button accepted`);
  for (let tick = 0; tick < 120; tick++) {
    if (p.activeScript?.execution === ScriptState.PAUSEBUTTON || !p.activeScript) break;
    worldTick();
  }
  const text = p.packets.slice(mark).filter(packet => packet.constructor.name === 'IfSetText')
    .map(packet => packet.text ?? '').join(' ').replace(/@[a-z]{3}@/g, '').replace(/\s+/g, ' ');
  for (const phrase of expected) assert(text.includes(phrase), `${label}: journal includes truthful text ${JSON.stringify(phrase)}; rendered ${JSON.stringify(text)}`);
  for (const phrase of excluded) assert(!text.includes(phrase), `${label}: journal does not claim ${JSON.stringify(phrase)}`);
  p.closeModal();
  return text;
}
function assertNoAngerItems(p, label) {
  assert.equal(angerWeaponTotal(p), 0, `${label}: no anger weapon remains in inventory or worn slots`);
}
function takeRackWeapon(p, weaponName, label = `rack Take-from ${weaponName}`) {
  const selected = WEAPONS.find(weapon => weapon.name === weaponName);
  assert(selected, `known anger weapon ${weaponName}`);
  const rack = rackLoc(p);
  goToStand(p, rack, `${label}: walk to packed rack`);
  const result = operateLoc(p, rack, 1, [selected.choice], label);
  assert.match(result.trigger.name, /^\[oploc1,soulbane_rack_(?:all|multi|no_sword|no_spear|no_mace|no_axe)\]$/,
    `${label}: uses a visible rack variant`);
  assert.equal(count(p, weaponName), 1, `${label}: selected weapon enters inventory once`);
  assert.equal(angerWeaponTotal(p), 1, `${label}: exactly one anger weapon across inventory and worn slots`);
  assert.equal(readVar(p, 'soulbane_anger_weaponmulti'), selected.rackBit, `${label}: rack varbit reflects the selected weapon`);
  return result;
}
function equipAngerWeapon(p, weaponName, label) {
  if (angerWeaponTotal(p) === 0 || count(p, weaponName) + count(p, weaponName, types.InvType.getId('worn')) !== 1) {
    takeRackWeapon(p, weaponName, `${label}: Take-from`);
  }
  if (count(p, weaponName) > 0) {
    assert(held(p, weaponName, 2), `${label}: native Wield inventory action accepted`);
  }
  assert.equal(count(p, weaponName, types.InvType.getId('worn')), 1, `${label}: anger weapon is equipped`);
  assert.equal(angerWeaponTotal(p), 1, `${label}: exactly one anger weapon remains across inv/worn`);
}
function allRageNpcs(p) {
  const actors = rageNpcsFor(p);
  assert.equal(actors.length, 8, 'the room owns both of each of the four Rage NPC types');
  for (const type of RAGE_TYPES) assert.equal(actors.filter(npc => npc.type === id('NpcType', type)).length, 2, `${type}: two private actors`);
  return actors;
}
function testWeaponMatrix(p) {
  const worn = types.InvType.getId('worn');
  const actors = allRageNpcs(p);
  for (const weapon of WEAPONS) {
    equipAngerWeapon(p, weapon.name, `weapon matrix ${weapon.name}`);
    for (const npcType of RAGE_TYPES) {
      const target = actors.find(npc => npc.type === id('NpcType', npcType));
      assert(target, `${npcType} target exists for damage gate`);
      const matching = weapon.target === npcType;
      assert.equal(runProcInt('npc_max_dealt', p, [37, 0], target), matching ? 37 : 0,
        `${weapon.name}/${npcType}: native max-hit gate ${matching ? 'accepts' : 'rejects'} this mapping`);
      assert.equal(runProcInt('soulbane_rage_hit', p, [7, 0], target), matching ? 70 : 0,
        `${weapon.name}/${npcType}: rolled hit is multiplied only for the exact match`);
      assert.equal(runProcInt('npc_max_dealt', p, [37, 1], target), 0,
        `${weapon.name}/${npcType}: magic max-hit cannot bypass Rage gate`);
      assert.equal(runProcInt('soulbane_rage_hit', p, [7, 1], target), 0,
        `${weapon.name}/${npcType}: spell hit cannot bypass Rage gate`);
    }
  }

  const active = WEAPONS.find(weapon => count(p, weapon.name, worn) === 1);
  assert(active, 'weapon matrix leaves an anger weapon equipped');
  assert(remove(p, active.name), 'remove the anger weapon through the native worn-item action');
  const filler = normalInventory(p)[0]?.[0];
  assert(filler, 'one ordinary bag item can make room for the ranged-style fixture');
  assert(p.invDel(inv, obj(filler), 1), 'remove one disclosed ordinary item for the ranged-style fixture');
  seed(p, ['shortbow']);
  assert.equal(count(p, 'shortbow'), 1, 'ordinary shortbow enters the fixture inventory');
  assert(held(p, 'shortbow', 2), 'equip ordinary shortbow through its native inventory action');
  const target = actors.find(npc => npc.type === id('NpcType', 'soulbane_anger_bear'));
  assert.equal(runProcInt('npc_max_dealt', p, [37, 0], target), 0, 'ordinary ranged weapon has no Rage max-hit bypass');
  assert.equal(runProcInt('soulbane_rage_hit', p, [7, 0], target), 0, 'ordinary ranged rolled hit is rejected by the Rage gate');
  assert(held(p, active.name, 2), 'restore one anger weapon through the native wield action');
  assert.equal(count(p, 'shortbow'), 1, 'native wield swaps the temporary shortbow back into inventory');
  assert(p.invDel(inv, obj('shortbow'), 1), 'remove only the disclosed ordinary shortbow fixture');
  assert.equal(p.invAdd(inv, obj(filler), 1), 1, 'restore the exact ordinary item removed for the fixture');
}
function fillOrdinaryBag(p, amount) {
  const used = new Set(WEAPONS.map(weapon => weapon.name));
  const names = [];
  for (let typeId = 0; typeId < types.ObjType.count && names.length < amount; typeId++) {
    const type = types.ObjType.get(typeId);
    if (!type?.debugname || type.stackable !== false || type.certtemplate !== -1 || type.wearpos >= 0 || used.has(type.debugname)) continue;
    if (p.invAdd(inv, typeId, 1) !== 1) continue;
    used.add(type.debugname);
    names.push(type.debugname);
  }
  assert.equal(names.length, amount, `packed object types provide ${amount} distinct ordinary non-stackable items`);
  return names;
}
function testRackCapacityAndDrop(p) {
  const worn = types.InvType.getId('worn');
  const capacity = types.InvType.get(inv).size;
  assert(capacity > 1, 'packed inventory has ordinary capacity');
  seed(p, ['bronze_platebody']);
  assert(held(p, 'bronze_platebody', 2), 'ordinary body gear is equipped through the native handler');
  assert.equal(count(p, 'bronze_platebody', worn), 1, 'ordinary worn gear is present during rack swaps');

  takeRackWeapon(p, 'soulbane_anger_spearq', 'full-bag swap setup');
  const firstFill = fillOrdinaryBag(p, capacity - 1);
  assert.equal(inventory(p).filter(Boolean).length, capacity, 'old inventory weapon plus ordinary gear fills every bag slot');
  const normalBeforeSwap = normalInventory(p);
  takeRackWeapon(p, 'soulbane_anger_swordq', 'Take-from with a full bag and old weapon in inventory');
  assert.deepEqual(normalInventory(p), normalBeforeSwap, 'full-bag swap preserves every ordinary inventory item');
  assert.equal(count(p, 'soulbane_anger_spearq') + count(p, 'soulbane_anger_spearq', worn), 0,
    'rack swap removes the old anger weapon from inventory');
  assert.equal(inventory(p).filter(Boolean).length, capacity, 'successful full-bag swap leaves no lost or extra slot');

  assert(held(p, 'soulbane_anger_swordq', 2), 'wield selected anger sword before equipped/full refusal');
  const finalFill = fillOrdinaryBag(p, 1);
  assert.equal(inventory(p).filter(Boolean).length, capacity, 'equipped old weapon plus ordinary items leaves a full inventory');
  const beforeRefusal = normalInventory(p);
  const rack = rackLoc(p);
  goToStand(p, rack, 'full-bag equipped refusal: walk to rack');
  operateLoc(p, rack, 1, [4], 'Take-from with a full bag and old weapon equipped');
  assert.equal(count(p, 'soulbane_anger_swordq', worn), 1, 'full-bag refusal preserves the equipped anger weapon');
  assert.equal(count(p, 'soulbane_anger_axeq') + count(p, 'soulbane_anger_axeq', worn), 0,
    'full-bag refusal does not add the new weapon');
  assert.equal(readVar(p, 'soulbane_anger_weaponmulti'), 1, 'full-bag refusal preserves rack state');
  assert.deepEqual(normalInventory(p), beforeRefusal, 'full-bag refusal preserves ordinary inventory');
  assert.equal(count(p, 'bronze_platebody', worn), 1, 'ordinary worn gear survives all rack choices');

  const beforeNothing = normalInventory(p);
  operateLoc(p, rack, 1, [5], 'Nothing with full inventory and an anger weapon equipped');
  assertNoAngerItems(p, 'Nothing from a full bag');
  assert.deepEqual(normalInventory(p), beforeNothing, 'Nothing removes the worn weapon without changing a full ordinary bag');
  assert.equal(readVar(p, 'soulbane_anger_weaponmulti'), 0, 'Nothing restores the full rack form');

  const ordinaryToRemove = firstFill[0];
  assert(p.invDel(inv, obj(ordinaryToRemove), 1), 'make one disclosed test-only ordinary inventory slot for the drop case');
  takeRackWeapon(p, 'soulbane_anger_spearq', 'drop restriction setup');
  const stand = tile(p);
  assert(held(p, 'soulbane_anger_spearq', 5), 'Drop on anger weapon dispatches through the native inventory handler');
  assertNoAngerItems(p, 'anger weapon Drop action');
  assert.equal(readVar(p, 'soulbane_anger_weaponmulti'), 0, 'Drop returns the rack varbit to full');
  assert.equal(World.getObj(stand[1], stand[2], stand[0], obj('soulbane_anger_spearq'), p.hash64), null,
    'Drop does not create a ground anger weapon');
  assert.equal(count(p, 'bronze_platebody', worn), 1, 'Drop restriction preserves ordinary worn gear');
  assert(finalFill.length === 1, 'a full-bag refusal used one additional ordinary item');
}

function withCombatRandom(value, run) {
  const previousMathRandom = Math.random;
  const previousJavaRandom = JavaRandom.nextDouble;
  Math.random = () => value;
  JavaRandom.nextDouble = () => value;
  try { return run(); }
  finally {
    Math.random = previousMathRandom;
    JavaRandom.nextDouble = previousJavaRandom;
  }
}
function stableHitRandom(run) {
  return withCombatRandom(0.999999999999, run);
}
function runNativeAttack(p, npc, label, maxTicks = 80, stopOnHit = false, stopWhen = null, afterNpcInfo = null) {
  const beforeHp = npc.levels[HP_STAT];
  const beforeMeter = readVar(p, 'soulbane_anger_damagedealt');
  World.processInfo();
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  if (!rsbuf.hasNpc(p.slot, npc.nid)) {
    const route = nativeRoute(p, findStand(p, npc), `${label}: visible-approach route`);
    assert(MoveClickHandler.handle(new MoveClick(route.map(({ x, z }) => ({ x, z })), 0, false), p),
      `${label}: ordinary walk toward the unrendered target is accepted`);
    for (let tick = 0; tick < 512 && !rsbuf.hasNpc(p.slot, npc.nid); tick++) {
      worldTick();
      rsbuf.npcInfo(0, p.slot, 0, 0, true);
    }
    assert(rsbuf.hasNpc(p.slot, npc.nid), `${label}: actual NPC update renders the target before Attack`);
  }
  p.clearInteraction();
  World.processInfo();
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  if (!p.inOperableDistance(npc)) {
    const route = [...map.findPathToEntity(p.level, p.x, p.z, npc.x, npc.z, p.width, npc.width, npc.length)]
      .map(value => unpackWorld(value));
    assert(route.length > 0, `${label}: client operation click has a packed entity route`);
    assert(MoveClickHandler.handle(new MoveClick(route.map(({ x, z }) => ({ x, z })), 0, true), p),
      `${label}: paired native MOVE_OPCLICK is accepted`);
  }
  assert(OpNpcHandler.handle(new OpNpc(2, npc.nid), p), `${label}: native Attack packet accepts the visible NPC`);
  const trigger = p.getOpTrigger();
  assert.match(trigger?.name ?? '', /^\[opnpc2,/i, `${label}: native attack dispatch resolves opnpc2`);
  for (let tick = 0; tick < maxTicks; tick++) {
    worldTick(null, afterNpcInfo);
    if ((stopWhen && stopWhen()) || (stopOnHit && npc.levels[HP_STAT] < beforeHp)) {
      p.clearInteraction();
      break;
    }
    if (stage(p) === 3 || stage(p) === FEAR_COMPLETE_STAGE ||
      readVar(p, 'soulbane_anger_donespecial') === 1 || !npc.isActive) break;
  }
  const settled = !npc.isActive || readVar(p, 'soulbane_anger_donespecial') === 1 ||
    stage(p) === 3 || stage(p) === FEAR_COMPLETE_STAGE;
  const reached = stopOnHit ? npc.levels[HP_STAT] < beforeHp || !npc.isActive
    : stopWhen ? stopWhen() || settled : settled;
  assert(reached,
    `${label}: real native attack/AI queue ${stopOnHit ? 'lands a hit' : stopWhen ? 'reaches its native state boundary' : 'settles'}; ${JSON.stringify({ player: { tile: tile(p), hp: p.levels[PlayerStat.HITPOINTS], stage: stage(p), uid: instanceUid(p), delayed: p.delayed, interaction: p.target?.nid, script: p.activeScript?.script?.name, execution: p.activeScript?.execution, messages: p.messages.slice(-8) }, npc: { tile: [npc.level, npc.x, npc.z], hp: npc.levels[HP_STAT], beforeHp, mode: npc.mode, owner: npc.vars[NPC_OWNER], instance: npc.vars[NPC_INSTANCE] }, meter: readVar(p, 'soulbane_anger_damagedealt'), beforeMeter })}`);
}
function assertOrdinaryMeleeXp(p, before, damage, multiplier, label) {
  assert.equal(multiplier, 1000, `${label}: the packed Fear Reaper keeps the ordinary 1000 combat-XP multiplier`);
  const after = xpSnapshot(p);
  const delta = after.map((value, skill) => value - before[skill]);
  const base = damage * 10;
  const scaled = value => Math.floor(value * multiplier / 1000);
  const shared = scaled(Math.floor(base * 133 / 100));
  const singleStyle = scaled(Math.floor(base * 400 / 100));
  const combat = [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE].map(skill => delta[skill]);
  const oneStyle = combat.filter(value => value !== 0).length === 1 && combat.includes(singleStyle);
  const controlledStyle = combat.every(value => value === shared);
  assert(oneStyle || controlledStyle,
    `${label}: real damage ${damage} follows the ordinary melee style XP split; got ${JSON.stringify(combat)}`);
  assert.equal(delta[PlayerStat.HITPOINTS], shared, `${label}: real damage ${damage} awards ordinary 133% Hitpoints XP`);
  const combatSkills = new Set([PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.HITPOINTS]);
  for (let skill = 0; skill < delta.length; skill++) {
    if (!combatSkills.has(skill)) assert.equal(delta[skill], 0, `${label}: ordinary Fear damage awards no XP to stat ${skill}`);
  }
}
function attackFearOnce(p, npc, label) {
  const beforeHp = npc.levels[HP_STAT];
  const beforeXp = xpSnapshot(p);
  const multiplier = npc.vars[NPC_XP_MULTIPLIER];
  stableHitRandom(() => runNativeAttack(p, npc, label, 120, true));
  const damage = beforeHp - npc.levels[HP_STAT];
  assert(damage > 0, `${label}: native Attack delivers positive ordinary damage`);
  assertOrdinaryMeleeXp(p, beforeXp, damage, multiplier, label);
  return damage;
}
function searchFearHole(p, hole, label) {
  const name = types.LocType.get(hole.type)?.debugname;
  assert(FEAR_HOLES.includes(name), `${label}: target is one of the six original Fear holes`);
  goToStand(p, hole, `${label}: walk to packed ${name}`);
  const result = operateLoc(p, hole, 1, [], label);
  assert.equal(result.trigger.name, `[oploc1,${name}]`, `${label}: OpLoc resolves the actual visible hole form`);
  return result;
}
function fearDoor(p) {
  const door = readVar(p, 'soulbane_fear_enemydoor');
  assert(Number.isInteger(door) && door >= 1 && door <= FEAR_HOLES.length,
    `Fear active door ${door} is one of the six holes`);
  return door;
}
function ensureFearReaper(p, label) {
  let actors = fearNpcsFor(p);
  assert(actors.length <= 1, `${label}: the owner has at most one live Fear Reaper`);
  if (actors.length === 0) {
    assert.equal(readVar(p, 'soulbane_fear_monspres'), 0, `${label}: no encounter marker is left without its actor`);
    const door = fearDoor(p);
    const hole = fearHoleLocs(p)[door - 1];
    searchFearHole(p, hole, `${label}: search the active hole ${door}`);
    for (let tick = 0; tick < 32 && fearNpcsFor(p).length === 0; tick++) worldTick();
    actors = fearNpcsFor(p);
  }
  assert.equal(actors.length, 1, `${label}: a real owned Fear Reaper is present after searching its active hole`);
  const npc = actors[0];
  const door = fearDoor(p);
  const spawn = fearReaperSpawn(p, door);
  assert.deepEqual({ level: npc.level, x: npc.x, z: npc.z }, spawn,
    `${label}: the active door selects its exact packed size-2 reaper point`);
  assertFootprintOpen(npc.level, npc.x, npc.z, npc.width, npc.length, `${label}: active Fear Reaper footprint`);
  assert.equal(npc.vars[NPC_INSTANCE], instanceUid(p), `${label}: Fear Reaper carries the current instance marker`);
  assert.equal(npc.vars[NPC_OWNER] >>> 0, p.uid, `${label}: Fear Reaper carries the current player owner`);
  assert.equal(readVar(p, 'soulbane_fear_monspres'), 1, `${label}: the live/pending encounter marker is set`);
  for (let tick = 0; tick < 32 && npc.vars[NPC_XP_MULTIPLIER] !== 1000; tick++) worldTick();
  assert.equal(npc.vars[NPC_XP_MULTIPLIER], 1000, `${label}: Fear Reaper uses the normal combat-XP multiplier`);
  return npc;
}
function killFearReaper(p, npc, expectedTally, label) {
  const previousDoor = fearDoor(p);
  let hits = 0;
  while (npc.isActive && npc.levels[HP_STAT] > 0) {
    assert(hits < 32, `${label}: ordinary native combat can finish this 25-HP reaper`);
    attackFearOnce(p, npc, `${label}: native melee hit ${hits + 1}`);
    hits++;
  }
  assert(hits > 0, `${label}: the reaper dies only after real player attacks`);
  for (let tick = 0; tick < 256 && readVar(p, 'soulbane_fear_killedtally') !== expectedTally + 1; tick++) worldTick();
  assert.equal(readVar(p, 'soulbane_fear_killedtally'), expectedTally + 1,
    `${label}: the production NPC death/credit queues add exactly one kill`);
  for (let tick = 0; tick < 16; tick++) worldTick();
  assert.equal(readVar(p, 'soulbane_fear_killedtally'), expectedTally + 1,
    `${label}: settled and later death queues cannot duplicate credit`);
  assert.equal(npc.vars[NPC_INSTANCE], 0, `${label}: real death consumes the reaper owner marker before credit`);
  assert.equal(stage(p), FEAR_STAGE, `${label}: the fifth reaper's cutscene, not the death queue, commits boundary 5`);
  const actors = fearNpcsFor(p);
  assert(actors.length <= 1, `${label}: death and relocation never leave duplicate owned reapers`);
  if (expectedTally < 4) {
    const nextDoor = fearDoor(p);
    assert.notEqual(nextDoor, previousDoor, `${label}: next active hole relocates away from the just-cleared one`);
    assert.equal(readVar(p, 'soulbane_fear_enemydoor_old'), previousDoor,
      `${label}: the previous active hole is retained as the no-repeat exclusion`);
    assert.equal(readVar(p, 'soulbane_fear_exitlit'), 0, `${label}: Fear exit remains closed before the fifth-death scene`);
  } else {
    assert.equal(readVar(p, 'soulbane_fear_enemydoor'), 0, `${label}: no hole remains active after the fifth death`);
    assert.equal(readVar(p, 'soulbane_fear_exitlit'), 0, `${label}: the fifth death has not lit the exit before its scene`);
  }
  return { hits, previousDoor };
}
function testForeignInteractions(owner, intruder) {
  const ownerUid = instanceUid(owner);
  const ownerNpc = rageNpcsFor(owner)[0];
  const ownNpc = rageNpcsFor(intruder)[0];
  const ownerRack = rackLoc(owner);
  const beforeIntruder = {
    tile: tile(intruder), inventory: inventory(intruder), meter: readVar(intruder, 'soulbane_anger_damagedealt'),
    weapon: readVar(intruder, 'soulbane_anger_weaponmulti'), hp: ownerNpc.levels[HP_STAT]
  };
  World.processInfo();
  rsbuf.npcInfo(0, intruder.slot, 0, 0, true);
  assert.equal(rsbuf.hasNpc(intruder.slot, ownerNpc.nid), false, 'ordinary NPC update excludes another owner\'s private monster');
  assert.equal(rsbuf.hasNpc(intruder.slot, ownNpc.nid), true, 'ordinary NPC update includes the intruder\'s own monster');
  assert.equal(intruder.inOperableDistance(ownerNpc), false, 'another instance\'s Rage NPC is not in operation distance');
  assert.equal(intruder.inOperableDistance(ownerRack), false, 'another instance\'s rack is not in operation distance');

  // This is a native client packet with the other copy's loc coordinates/type,
  // not a direct script dispatch. The visible rack trigger is observed, then
  // production pathing decides whether it can execute.
  intruder.clearInteraction();
  intruder.originX = intruder.x; intruder.originZ = intruder.z;
  const packetAccepted = OpLocHandler.handle(new OpLoc(1, ownerRack.x, ownerRack.z, ownerRack.type), intruder);
  let selected = null;
  let rackLabelPaused = false;
  if (packetAccepted) {
    selected = intruder.getOpTrigger()?.name ?? null;
    intruder.processInteraction();
    for (let tick = 0; tick < 12; tick++) worldTick();
    rackLabelPaused = intruder.resumeButtons.length > 0 || intruder.activeScript?.execution === ScriptState.PAUSEBUTTON;
  }
  assert(!rackLabelPaused, `native foreign-rack packet never opens the rack label (trigger observed: ${selected})`);
  assert(/I can't reach that!/.test(intruder.messages.join(' ')) || !packetAccepted,
    'foreign-rack client request is rejected by normal path/range handling before its label');
  assert.deepEqual(tile(intruder), beforeIntruder.tile, 'foreign-rack attempt does not move the player into another copy');
  assert.deepEqual(inventory(intruder), beforeIntruder.inventory, 'foreign-rack attempt cannot transfer another owner\'s weapon');
  assert.equal(readVar(intruder, 'soulbane_anger_weaponmulti'), beforeIntruder.weapon, 'foreign-rack attempt cannot change the owner copy');

  const nBefore = ownerNpc.levels[HP_STAT];
  const meterBefore = readVar(intruder, 'soulbane_anger_damagedealt');
  const gate = runProcInt('npc_max_dealt', intruder, [100, 0], ownerNpc);
  assert.equal(gate, 0, 'foreign Rage target fails the shared player-to-NPC damage gate');

  // Native APNPC2 spoofed-target attack. The current NPC update omits the
  // other owner's copy, so the production packet handler must reject its nid.
  intruder.clearInteraction();
  rsbuf.npcInfo(0, intruder.slot, 0, 0, true);
  const attackAccepted = OpNpcHandler.handle(new OpNpc(2, ownerNpc.nid), intruder);
  assert.equal(attackAccepted, false, 'native APNPC2 rejects an invisible foreign NPC');
  assert.equal(ownerNpc.levels[HP_STAT], nBefore, 'foreign APNPC2 target cannot damage another owner\'s monster');
  assert.equal(readVar(intruder, 'soulbane_anger_damagedealt'), meterBefore, 'foreign attack cannot earn anger credit');

  // Native APNPCU item-on-NPC packet with the intruder's own weapon.
  let useWeapon = WEAPONS.find(value => count(intruder, value.name) > 0)?.name;
  if (!useWeapon) {
    const wornWeapon = WEAPONS.find(value => count(intruder, value.name, types.InvType.getId('worn')) > 0);
    assert(wornWeapon, 'intruder has its own anger weapon available');
    assert(remove(intruder, wornWeapon.name), 'foreign-use fixture removes its weapon through native worn action');
    useWeapon = wornWeapon.name;
  }
  rsbuf.npcInfo(0, intruder.slot, 0, 0, true);
  const useAccepted = OpNpcUHandler.handle(
    new OpNpcU(ownerNpc.nid, obj(useWeapon), slotOf(intruder, useWeapon), invCom), intruder);
  assert.equal(useAccepted, false, 'native APNPCU rejects an invisible foreign NPC');
  assert.equal(ownerNpc.levels[HP_STAT], nBefore, 'foreign APNPCU item use cannot damage another owner\'s monster');
  assert.equal(readVar(intruder, 'soulbane_anger_damagedealt'), meterBefore, 'foreign item use cannot earn anger credit');

  // Native APNPCT spell target.
  seed(intruder, ['airrune', 'mindrune']);
  const windStrike = requiredId('Component', 'magic:wind_strike');
  assert(intruder.isComponentVisible(types.Component.get(windStrike)), 'Wind Strike is visible to the native spell-target handler');
  rsbuf.npcInfo(0, intruder.slot, 0, 0, true);
  const spellAccepted = OpNpcTHandler.handle(new OpNpcT(ownerNpc.nid, windStrike), intruder);
  assert.equal(spellAccepted, false, 'native APNPCT rejects an invisible foreign NPC');
  assert.equal(ownerNpc.levels[HP_STAT], nBefore, 'foreign APNPCT spell cannot damage another owner\'s monster');
  assert.equal(readVar(intruder, 'soulbane_anger_damagedealt'), meterBefore, 'foreign use/cast attempts cannot earn anger credit');
  assert.equal(instanceUid(owner), ownerUid, 'foreign target attempts leave the real owner\'s UID unchanged');
}
function testForeignFearInteractions(owner, intruder, ownerNpc) {
  const ownerUid = instanceUid(owner);
  const hpBefore = ownerNpc.levels[HP_STAT];
  const tallyBefore = readVar(owner, 'soulbane_fear_killedtally');
  const xpBefore = xpSnapshot(intruder);
  assert(runProcInt('npc_max_dealt', owner, [100, 0], ownerNpc) > 0,
    'eligible owner Fear target keeps a positive ordinary melee/ranged max hit');
  assert.equal(runProcInt('npc_max_dealt', intruder, [100, 0], ownerNpc), 0,
    'foreign Fear target is capped at zero before melee/ranged damage XP');
  assert(runProcInt('npc_max_dealt', owner, [100, 1], ownerNpc) > 0,
    'eligible owner Fear target keeps a positive spell max hit');
  assert.equal(runProcInt('npc_max_dealt', intruder, [100, 1], ownerNpc), 0,
    'foreign Fear spell target is capped at zero before damage XP');
  assert.equal(ownerNpc.vars[NPC_INSTANCE], ownerUid, 'foreign Fear target belongs to the other private copy');
  assert.equal(ownerNpc.vars[NPC_OWNER] >>> 0, owner.uid, 'foreign Fear target belongs to the other player');
  World.processInfo();
  rsbuf.npcInfo(0, intruder.slot, 0, 0, true);
  assert.equal(rsbuf.hasNpc(intruder.slot, ownerNpc.nid), false,
    'native NPC updates never render another owner\'s Fear Reaper');
  assert.equal(intruder.inOperableDistance(ownerNpc), false,
    'a different-stage outside player is not in operation distance to the Fear Reaper');

  intruder.clearInteraction();
  assert.equal(OpNpcHandler.handle(new OpNpc(2, ownerNpc.nid), intruder), false,
    'native APNPC2 refuses a foreign Fear Reaper');
  seed(intruder, ['airrune', 'mindrune']);
  const inventoryBefore = inventory(intruder);
  assert.equal(OpNpcUHandler.handle(
    new OpNpcU(ownerNpc.nid, obj('airrune'), slotOf(intruder, 'airrune'), invCom), intruder), false,
  'native APNPCU refuses item use on a foreign Fear Reaper');
  const windStrike = requiredId('Component', 'magic:wind_strike');
  assert(intruder.isComponentVisible(types.Component.get(windStrike)),
    'Wind Strike is visible to the native spell-target handler');
  assert.equal(OpNpcTHandler.handle(new OpNpcT(ownerNpc.nid, windStrike), intruder), false,
    'native APNPCT refuses a spell on a foreign Fear Reaper');

  assert.equal(ownerNpc.levels[HP_STAT], hpBefore, 'foreign Attack/Use/Spell packets cannot damage the owner\'s Fear Reaper');
  assert.equal(readVar(owner, 'soulbane_fear_killedtally'), tallyBefore, 'foreign Attack/Use/Spell packets cannot earn Fear credit');
  assert.deepEqual(inventory(intruder), inventoryBefore, 'foreign item/spell target packets cannot consume the intruder\'s ordinary runes');
  assert.deepEqual(xpSnapshot(intruder), xpBefore, 'rejected foreign combat packets award no ordinary XP');
  assert.equal(instanceUid(owner), ownerUid, 'foreign Fear packets preserve the real owner\'s instance');
}
function castFearSpellOnce(p, npc, label) {
  const windStrike = requiredId('Component', 'magic:wind_strike');
  assert(button(p, 'controls:com_3'), `${label}: native combat controls turn off automatic melee retaliation`);
  assert.equal(readVar(p, 'option_nodef'), 1, `${label}: a one-spell fixture has auto-retaliate off`);
  const displaced = [];
  for (const rune of ['airrune', 'mindrune']) {
    if (count(p, rune) !== 0) continue;
    if (inventory(p).every(Boolean)) {
      const item = inventory(p).find(item => item && !WEAPON_IDS.has(obj(item.name)) &&
        !types.ObjType.get(obj(item.name)).stackable);
      assert(item, `${label}: a disclosed ordinary full-bag fixture can make room for the rune`);
      assert(p.invDel(inv, obj(item.name), item.count), `${label}: temporarily remove only ordinary fixture gear`);
      displaced.push(item);
    }
    assert.equal(p.invAdd(inv, obj(rune), 1), 1, `${label}: seed one standard ${rune}`);
  }
  World.processInfo();
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, npc.nid), `${label}: native NPC update renders the owned Fear Reaper`);
  assert(p.isComponentVisible(types.Component.get(windStrike)), `${label}: Wind Strike is visible to the owner`);
  const hpBefore = npc.levels[HP_STAT];
  const tallyBefore = readVar(p, 'soulbane_fear_killedtally');
  const xpBefore = xpSnapshot(p);
  const airBefore = count(p, 'airrune');
  const mindBefore = count(p, 'mindrune');
  p.clearInteraction();
  if (!p.inOperableDistance(npc)) {
    const route = [...map.findPathToEntity(p.level, p.x, p.z, npc.x, npc.z, p.width, npc.width, npc.length)]
      .map(value => unpackWorld(value));
    assert(route.length > 0, `${label}: moving spell target has a packed entity approach route`);
    assert(MoveClickHandler.handle(new MoveClick(route.map(({ x, z }) => ({ x, z })), 0, true), p),
      `${label}: paired native MOVE_OPCLICK approaches the live spell target`);
  }
  assert(OpNpcTHandler.handle(new OpNpcT(npc.nid, windStrike), p),
    `${label}: native APNPCT accepts the eligible owner's spell target`);
  assert.match(p.getApTrigger()?.name ?? '', /^\[apnpct,/i,
    `${label}: owner spell dispatch reaches the common APNPCT combat path`);
  p.processInteraction();
  for (let tick = 0; tick < 64; tick++) worldTick();
  assert(xpSnapshot(p)[PlayerStat.MAGIC] > xpBefore[PlayerStat.MAGIC],
    `${label}: eligible owner receives ordinary spell XP`);
  assert.equal(count(p, 'airrune'), airBefore - 1, `${label}: real Wind Strike consumes one air rune`);
  assert.equal(count(p, 'mindrune'), mindBefore - 1, `${label}: real Wind Strike consumes one mind rune`);
  for (const item of displaced) {
    assert.equal(p.invAdd(inv, obj(item.name), item.count), item.count,
      `${label}: restore the exact ordinary fixture item after the rune is consumed`);
  }
  assert(npc.levels[HP_STAT] <= hpBefore, `${label}: ordinary spell resolution never heals the Fear Reaper`);
  assert.equal(readVar(p, 'soulbane_fear_killedtally'), tallyBefore,
    `${label}: a spell cast without death cannot award Fear credit`);
}

function nativeLogoutAndReload(p, label) {
  const oldPid = p.pid;
  const oldSlot = p.slot;
  const username = p.username;
  p.clearInteraction();
  for (let tick = 0; tick < 128 && World.currentTick < p.preventLogoutUntil; tick++) worldTick();
  assert(World.currentTick >= p.preventLogoutUntil, `${label}: ordinary combat logout cooldown expires without bypass`);
  p.requestLogout = true;
  p.lastResponse = World.currentTick;
  worldTick();
  assert(![...World.playerLoop.all()].includes(p), `${label}: production logout removes the old session`);
  const request = World.logoutRequests.get(username);
  assert(request?.save, `${label}: production logout writes a genuine player save`);
  // Stand in for the successful login-server save acknowledgement before relog.
  World.logoutRequests.delete(username);
  const loaded = PlayerLoading.load(username, new Packet(request.save), null);
  loaded.pid = oldPid; loaded.slot = oldSlot;
  // Loading reconstructs username37 from the saved username. Use its real
  // identity, not makePlayer's synthetic pre-save hash, for native UID lookups.
  loaded.uid = ((Number(loaded.username37 & 0x1fffffn) << 11) | oldSlot) >>> 0;
  loaded.isActive = true;
  loaded.packets = []; loaded.messages = [];
  loaded.write = packet => loaded.packets.push(packet);
  loaded.messageGame = text => loaded.messages.push(String(text));
  loaded.wrappedMessageGame = loaded.messageGame;
  loaded.lastResponse = World.currentTick; loaded.lastConnected = World.currentTick;
  World.players[oldPid] = loaded;
  World.playerLoop.add(loaded.hash64, loaded);
  rsbuf.addPlayer(oldSlot);
  World.gameMap.getZone(loaded.x, loaded.z, loaded.level).enter(loaded);
  World.instances.playerEntered({ level: loaded.level, x: loaded.x, z: loaded.z });
  loaded.onLogin();
  loaded.processEngineQueue();
  return loaded;
}
function testStageTwoLeaveAndLogout(mainOwner) {
  const p = playerFixture();
  seedStageOneOwner(p, 'disclosed isolated stage-1/rope fixture');
  const originalUid = instanceUid(p);
  const firstRoomActors = rageNpcsFor(p);
  assert.equal(firstRoomActors.length, 8, 'isolated owner receives its own Rage actors');
  const quit = quitLoc(p);
  goToStand(p, quit, 'stage-2 quit: walk to actual loc 13878');
  const no = operateLoc(p, quit, 1, [2], 'stage-2 quit No choice');
  assert.match(no.trigger.name, /^\[oploc1,soul_bane_awall_void_small\]$/);
  assert.equal(stage(p), 2, 'No keeps the unfinished Rage stage');
  assert.equal(instanceUid(p), originalUid, 'No leaves the current owned copy active');
  assert.equal(rageNpcsFor(p).length, 8, 'No does not remove the current owner\'s NPCs');

  const yes = operateSurfaceExit(p, quit, [1], 'stage-2 quit Yes choice');
  assert.match(yes.trigger.name, /^\[oploc1,soul_bane_awall_void_small\]$/);
  assert.equal(stage(p), 2, 'leaving Rage does not fabricate completion');
  assert.equal(instanceUid(p), 0, 'Yes closes the unfinished private region');
  assertNoAngerItems(p, 'stage-2 leave cleanup');
  assert.equal(readVar(p, 'soulbane_anger_damagedealt'), 0, 'stage-2 leave resets unfinished anger meter');
  assert.equal(rageNpcsWithInstance(originalUid).length, 0, 'stage-2 leave removes every owned Rage actor');
  assert(!CoordGrid.isInstanceX(p.x), 'stage-2 leave returns to an overworld coordinate');

  chooseRiftWithRope(p, 'stage-2 re-entry after confirmed leave', { requireUnlocked: true });
  assert.equal(stage(p), 2, 'stage-2 re-entry preserves unfinished progress');
  assert.equal(readVar(p, 'soulbane_anger_damagedealt'), 0, 'stage-2 re-entry starts a fresh temporary meter');
  assert.equal(rageNpcsFor(p).length, 8, 'stage-2 re-entry owns a fresh set of Rage actors');
  equipAngerWeapon(p, 'soulbane_anger_spearq', 'stage-2 logout setup');
  const bear = rageNpcsFor(p).find(npc => npc.type === id('NpcType', 'soulbane_anger_bear'));
  goToStand(p, bear, 'stage-2 logout setup: walk to bear');
  stableHitRandom(() => runNativeAttack(p, bear, 'stage-2 logout anger hit'));
  const meterBeforeLogout = readVar(p, 'soulbane_anger_damagedealt');
  assert(meterBeforeLogout > 0, 'real native combat has built unfinished Rage meter before logout');
  moveToTile(p, roomCoord(p, 'soulbane_rage_entry'), 'unfinished logout: walk back out of the remaining monsters\' hunt radius');
  const oldUid = instanceUid(p);
  const reloaded = nativeLogoutAndReload(p, 'mid-Rage logout');
  assert.equal(stage(reloaded), 2, 'mid-Rage logout preserves permanent stage 2');
  assert.equal(readVar(reloaded, 'soulbane_instance'), 0, 'temporary instance UID is absent after relog');
  assert.equal(readVar(reloaded, 'soulbane_anger_damagedealt'), 0, 'unfinished anger meter resets on relog');
  assertNoAngerItems(reloaded, 'mid-Rage logout/relogin');
  assert(!CoordGrid.isInstanceX(reloaded.x), 'mid-Rage relog lands outside the disposable instance');
  assert.equal(rageNpcsWithInstance(oldUid).length, 0, 'mid-Rage logout removes every old-copy NPC');
  return { p, reloaded };
}
function testDeath(mainOwner) {
  const p = playerFixture();
  seed(p, ['rune_chainbody', 'rune_platelegs', 'bronze_platebody', 'shortbow']);
  assert.equal(p.invAdd(inv, obj('coins'), 5000), 5000, 'disclosed ordinary death fixture carries 5000 coins');
  seedStageOneOwner(p, 'disclosed isolated death fixture');
  equipAngerWeapon(p, 'soulbane_anger_spearq', 'death fixture weapon');
  const xpBefore = xpSnapshot(p);
  const qpBefore = readVar(p, 'qp');
  const oldUid = instanceUid(p);
  const deathTile = tile(p);
  // Disclosed test-only lethal HP seed; player_die enqueues the ordinary death queue.
  p.levels[PlayerStat.HITPOINTS] = 0;
  assert(ScriptProvider.getByName('[proc,player_die]'), 'packed ordinary player_die procedure exists');
  runProc('player_die', p);
  for (let tick = 0; tick < 80 && (p.activeScript || p.queue.head() !== null); tick++) worldTick();
  for (let tick = 0; tick < 3; tick++) worldTick();
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED, 'ordinary death animation/queue settles');
  assert.equal(stage(p), 2, 'death during Rage cannot complete the quest');
  assert.equal(instanceUid(p), 0, 'ordinary post-respawn Soulbane cleanup releases the instance UID');
  assert(!CoordGrid.isInstanceX(p.x), 'ordinary death respawns the player outside the instance');
  assert.equal(World.instances.findInstanceByUid(oldUid - 1), null, 'ordinary death deletes the copy that held lost items');
  assert.equal(rageNpcsWithInstance(oldUid).length, 0, 'ordinary death and cleanup remove every old Rage actor');
  for (const name of ['rune_chainbody', 'rune_platelegs', 'bronze_platebody']) {
    assert.equal(count(p, name), 1, `ordinary death keeps ${name} in inventory`);
  }
  for (const name of ['coins', 'shortbow']) {
    assert.equal(count(p, name), 0, `ordinary death permanently loses ${name}`);
    assert.equal(World.getObj(p.x, p.z, p.level, obj(name), p.hash64), null,
      `lost ${name} is not recoverable at the respawn tile`);
  }
  assertNoAngerItems(p, 'ordinary death and deleted-copy cleanup');
  assert.deepEqual(xpSnapshot(p), xpBefore, 'death grants neither the Rage reward nor normal combat XP');
  assert.equal(readVar(p, 'qp'), qpBefore, 'death grants no quest points');
  console.log(`R1 death-copy outcome ${JSON.stringify({ deathTile, kept: ['rune_chainbody', 'rune_platelegs', 'bronze_platebody'], lost: ['coins', 'shortbow'], angerWeaponsAfterDeath: angerWeaponTotal(p), deleted: true })}`);
}


function privateInstanceZones(p, label) {
  const instance = instanceForOwner(p, label);
  const zones = [];
  for (let floor = 0; floor < instance.floors; floor++) {
    for (let east = 0; east < instance.zonesEast; east++) {
      for (let north = 0; north < instance.zonesNorth; north++) {
        const zone = World.gameMap.getZoneIfExists(
          instance.sw.x + (east << 3), instance.sw.z + (north << 3), instance.sw.level + floor);
        if (zone) zones.push(zone);
      }
    }
  }
  return { instance, zones };
}
function instanceDestinationOffset(instance, zone) {
  return { east: zone.x - (instance.sw.x >> 3), north: zone.z - (instance.sw.z >> 3) };
}
function expectedInstanceMappings(instance) {
  const mappings = [];
  const add = (kind, floor, east, north, sourceLevel, sourceEast, sourceNorth) => {
    mappings.push({
      kind,
      destination: {
        level: instance.sw.level + floor,
        x: (instance.sw.x >> 3) + east,
        z: (instance.sw.z >> 3) + north
      },
      source: { level: sourceLevel, x: sourceEast, z: sourceNorth },
      rotation: 0
    });
  };

  const rage = sourceCoordForName('soulbane_rage_entry');
  const rageZoneX = (rage.x >> 6) << 3;
  const rageZoneZ = (rage.z >> 6) << 3;
  for (let east = 0; east < 8; east++) {
    for (let north = 0; north < 8; north++) {
      add('room', 0, east, north, 0, rageZoneX + east, rageZoneZ + north);
    }
  }

  const hope = sourceCoordForName('soulbane_hope_source');
  for (let east = 0; east < 4; east++) {
    for (let north = 0; north < 4; north++) {
      add('room', 0, 8 + east, north, hope.level, (hope.x >> 3) + east, (hope.z >> 3) + north);
    }
  }

  for (let floor = 1; floor < 4; floor++) {
    for (let east = 0; east < 4; east++) {
      for (let north = 0; north < 4; north++) {
        add('room', floor, east, north, floor, rageZoneX + east, rageZoneZ + north);
      }
    }
  }

  const memoryNorth = questConstant('soulbane_memory_zone_north');
  const memoryEast = questConstant('soulbane_memory_zone_east');
  const rageMemory = sourceCoordForName('soulbane_scene_source');
  const fearMemory = sourceCoordForName('soulbane_fear_scene_source');
  for (let east = 0; east < 4; east++) {
    for (let north = 0; north < 2; north++) {
      add('Rage', 0, east, memoryNorth + north, rageMemory.level,
        (rageMemory.x >> 3) + east, (rageMemory.z >> 3) + north);
      add('Fear', 0, memoryEast + east, memoryNorth + north, fearMemory.level,
        (fearMemory.x >> 3) + east, (fearMemory.z >> 3) + north);
    }
  }
  assert.equal(mappings.filter(mapping => mapping.kind === 'room').length, 128,
    'the exact four-floor source map contains 128 room zones');
  assert.equal(mappings.filter(mapping => mapping.kind === 'Rage' || mapping.kind === 'Fear').length, 16,
    'the original Rage and Fear far-memory strips contain sixteen zones total');
  return mappings;
}
function instanceMappingTuple(mapping) {
  return [
    mapping.destination.level, mapping.destination.x, mapping.destination.z,
    mapping.source.level, mapping.source.x, mapping.source.z, mapping.rotation
  ].join(':');
}
function actualInstanceMappingTuple(zone) {
  return [
    zone.level, zone.x, zone.z,
    zone.source.level, zone.source.x, zone.source.z, zone.rotation
  ].join(':');
}
function roomSourceZones(instance, label) {
  const expected = expectedInstanceMappings(instance).filter(mapping => mapping.kind === 'room');
  const byDestination = new Map(expected.map(mapping => [
    `${mapping.destination.level}:${mapping.destination.x}:${mapping.destination.z}`, mapping
  ]));
  const zones = assignedInstanceZones(instance).filter(zone => byDestination.has(destinationZoneKey(zone)));
  assert.equal(zones.length, 128, `${label}: Rage, Fear, Confusion and both Hope quarters map exactly 128 room zones`);
  assert.deepEqual(zones.map(actualInstanceMappingTuple).sort(),
    expected.map(instanceMappingTuple).sort(),
    `${label}: all four floors and both Hope variants use their exact original source/destination zone mapping`);
  return zones;
}
function connectedZoneComponents(zones) {
  const remaining = new Map(zones.map(zone => [destinationZoneKey(zone), zone]));
  const components = [];
  while (remaining.size > 0) {
    const first = remaining.values().next().value;
    const pending = [first];
    const component = [];
    remaining.delete(destinationZoneKey(first));
    while (pending.length > 0) {
      const zone = pending.pop();
      component.push(zone);
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const key = `${zone.level}:${zone.x + dx}:${zone.z + dz}`;
        const adjacent = remaining.get(key);
        if (!adjacent) continue;
        remaining.delete(key);
        pending.push(adjacent);
      }
    }
    components.push(component);
  }
  return components;
}
const collisionAuditedInstances = new Set();
function assertCopiedStaticCollision(instance, mappings, label) {
  if (collisionAuditedInstances.has(instance.uid)) return;
  let checkedTiles = 0;
  let unmaterializedSourceZones = 0;
  let unmaterializedBlockedTiles = 0;
  for (const mapping of mappings) {
    const sourceZone = World.gameMap.getZoneIfExists(
      mapping.source.x << 3, mapping.source.z << 3, mapping.source.level);
    if (!sourceZone) unmaterializedSourceZones++;
    for (let dx = 0; dx < 8; dx++) {
      for (let dz = 0; dz < 8; dz++) {
        const sourceBlocked = map.isMapBlocked(
          (mapping.source.x << 3) + dx, (mapping.source.z << 3) + dz, mapping.source.level);
        const copiedBlocked = map.isMapBlocked(
          (mapping.destination.x << 3) + dx, (mapping.destination.z << 3) + dz, mapping.destination.level);
        assert.equal(copiedBlocked, sourceBlocked,
          `${label}: copied collision equals original packed source at ${instanceMappingTuple(mapping)} + ${dx},${dz}`);
        if (!sourceZone && sourceBlocked) unmaterializedBlockedTiles++;
        checkedTiles++;
      }
    }
  }
  assert(unmaterializedSourceZones > 0, `${label}: the mapping includes originally unmaterialized source zones`);
  assert(unmaterializedBlockedTiles > 0,
    `${label}: original packed blocked-floor collision survives for an unmaterialized source zone`);
  collisionAuditedInstances.add(instance.uid);
  console.log(`PASS exact copied source collision ${JSON.stringify({
    label, zones: mappings.length, checkedTiles, unmaterializedSourceZones, unmaterializedBlockedTiles
  })}`);
}
function memoryPatchComponents(instance, roomZones, label) {
  const mappings = expectedInstanceMappings(instance);
  const memoryZones = assignedInstanceZones(instance).filter(zone =>
    mappings.some(mapping => mapping.kind !== 'room' &&
      `${mapping.destination.level}:${mapping.destination.x}:${mapping.destination.z}` === destinationZoneKey(zone)));
  assert.equal(memoryZones.length, 16, `${label}: the Rage and Fear far-memory strips map exactly sixteen zones`);
  const components = connectedZoneComponents(memoryZones);
  assert.equal(components.length, 2, `${label}: Rage and Fear form separate copied memory patches`);
  const rageZones = components.find(component => component.some(zone =>
    mappings.some(mapping => mapping.kind === 'Rage' && instanceMappingTuple(mapping) === actualInstanceMappingTuple(zone))));
  const fearZones = components.find(component => component.some(zone =>
    mappings.some(mapping => mapping.kind === 'Fear' && instanceMappingTuple(mapping) === actualInstanceMappingTuple(zone))));
  assert(rageZones && fearZones && rageZones !== fearZones,
    `${label}: original memory source declarations identify their exact separate strips`);
  assert.equal(rageZones.length, 8, `${label}: Rage memory maps its complete four-by-two zone strip`);
  assert.equal(fearZones.length, 8, `${label}: Fear memory maps its complete four-by-two zone strip`);
  assert.deepEqual(rageZones.map(actualInstanceMappingTuple).sort(),
    mappings.filter(mapping => mapping.kind === 'Rage').map(instanceMappingTuple).sort(),
    `${label}: every Rage source zone maps to the fixed northern destination strip`);
  assert.deepEqual(fearZones.map(actualInstanceMappingTuple).sort(),
    mappings.filter(mapping => mapping.kind === 'Fear').map(instanceMappingTuple).sort(),
    `${label}: every Fear source zone maps to the fixed distant northern destination strip`);
  for (const zone of [...rageZones, ...fearZones]) {
    const { north } = instanceDestinationOffset(instance, zone);
    assert(north >= 14, `${label}: each original memory patch stays at its configured far-north offset`);
    for (const roomZone of roomZones) {
      assert(Math.max(Math.abs(zone.x - roomZone.x), Math.abs(zone.z - roomZone.z)) >= 7,
        `${label}: each memory zone is isolated from every room zone`);
    }
  }
  return { rageZones, fearZones };
}
function assertInstanceTemplateInventory(instance, label) {
  assert.equal(instance.floors, 4, `${label}: private instance has all four source levels`);
  assert.equal(instance.zonesEast, 16, `${label}: private instance retains the authored sixteen-zone east extent`);
  assert.equal(instance.zonesNorth, 16, `${label}: private instance retains the authored sixteen-zone north extent`);
  const mappings = expectedInstanceMappings(instance);
  const roomZones = roomSourceZones(instance, label);
  const { rageZones, fearZones } = memoryPatchComponents(instance, roomZones, label);
  const assigned = assignedInstanceZones(instance);
  assert.equal(assigned.length, 144, `${label}: all 128 room zones and sixteen memory zones are assigned`);
  assert.deepEqual(assigned.map(actualInstanceMappingTuple).sort(),
    mappings.map(instanceMappingTuple).sort(),
    `${label}: no extra, missing, rotated, or substituted source template enters the private copy`);
  assertCopiedStaticCollision(instance, mappings, label);
  return { roomZones, rageZones, fearZones };
}
function instanceNativeFloodfill(p, instance, label, seedTiles = null, startTile = null) {
  const minX = instance.sw.x;
  const maxX = minX + (instance.zonesEast << 3);
  const minZ = instance.sw.z;
  const maxZ = minZ + (instance.zonesNorth << 3);
  const start = startTile ?? { level: p.level, x: p.x, z: p.z };
  assert(start.level >= instance.sw.level && start.level < instance.sw.level + instance.floors,
    `${label}: floodfill starts on an owner instance floor`);
  assert(start.x >= minX && start.x < maxX && start.z >= minZ && start.z < maxZ,
    `${label}: floodfill starts inside the private instance bounds`);
  const key = (level, x, z) => `${level}:${x}:${z}`;
  const tiles = seedTiles ? [...seedTiles] : [start];
  const seen = new Set(tiles.map(tileAt => key(tileAt.level, tileAt.x, tileAt.z)));
  const steps = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  // Follow native movement to exhaustion, without clipping at the instance
  // edge or assigned zones. Blank allocated padding is part of the proof.
  for (let index = 0; index < tiles.length; index++) {
    const current = tiles[index];
    for (const [dx, dz] of steps) {
      const x = current.x + dx;
      const z = current.z + dz;
      const nextKey = key(current.level, x, z);
      if (seen.has(nextKey)) continue;
      if (!map.canTravel(current.level, current.x, current.z, dx, dz, p.width, 0, CollisionType.NORMAL)) continue;
      seen.add(nextKey);
      tiles.push({ level: current.level, x, z });
    }
  }
  return { start, tiles, keys: seen };
}
function effectiveLocType(p, loc) {
  const base = types.LocType.get(loc.type);
  if (!base.multiloc || base.multiloc.length === 0) return base;
  let state = -1;
  if (base.multivarp !== -1) state = p.getVar(base.multivarp);
  else if (base.multivarbit !== -1) state = p.getVarBit(base.multivarbit);
  if (state >= 0 && state < base.multiloc.length && base.multiloc[state] !== -1) {
    return types.LocType.get(base.multiloc[state]);
  }
  return base;
}
function mappedNeighborSourceLocs(zones, label) {
  const sourceZones = new Map(zones.map(zone =>
    [`${zone.source.level}:${zone.source.x}:${zone.source.z}`, zone]));
  const squares = new Set(zones.map(zone => `${zone.source.x >> 3}_${zone.source.z >> 3}`));
  const locs = [];
  for (const square of squares) {
    const [mapX, mapZ] = square.split('_').map(Number);
    const groundFlags = new Map();
    let section = '';
    for (const line of fs.readFileSync(path.join(contentRoot, 'maps', `m${square}.jm2`), 'utf8').split(/\r?\n/)) {
      if (line.startsWith('====')) {
        section = line.split(/\s+/)[1];
        continue;
      }
      const row = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
      if (!row) continue;
      const [level, localX, localZ] = row.slice(1, 4).map(Number);
      if (section === 'MAP') {
        const flags = /(?:^| )f(\d+)(?: |$)/.exec(row[4]);
        groundFlags.set(`${level}:${localX}:${localZ}`, flags ? Number(flags[1]) : 0);
        continue;
      }
      if (section !== 'LOC') continue;
      const [typeId, shape = 10, angle = 0] = row[4].trim().split(/\s+/).map(Number);
      const bridged = ((groundFlags.get(`1:${localX}:${localZ}`) ?? 0) & 2) !== 0;
      const source = { level: bridged ? level - 1 : level, x: mapX * 64 + localX, z: mapZ * 64 + localZ };
      const zone = sourceZones.get(sourceZoneKey(source));
      if (!zone) continue;
      assert.equal(zone.rotation, 0, `${label}: source loc mapping preserves the neighbor's rotation`);
      const type = types.LocType.get(typeId);
      locs.push({
        level: zone.level, x: (zone.x << 3) + (source.x & 7), z: (zone.z << 3) + (source.z & 7),
        type: typeId, baseType: typeId, shape, angle, width: type.width, length: type.length
      });
    }
  }
  // Native zones retain only active loc entities; inactive scenery is still
  // rendered by the source template and contributes copied collision.
  const key = loc => [loc.level, loc.x, loc.z, loc.baseType, loc.shape, loc.angle].join(':');
  assert.deepEqual(zones.flatMap(zone => [...zone.getAllLocsSafe()]).map(key).sort(),
    locs.filter(loc => types.LocType.get(loc.baseType).active).map(key).sort(),
    `${label}: every active native neighbor loc matches its actual source mapping`);
  return locs;
}
function assertPrivateInstanceIsolation(p, label, requireRoomPacket = false) {
  assert([2, 3, 4, 5, 6, 7, 8, 9].includes(stage(p)),
    `${label}: native isolation covers every stage in the first publication`);
  const instance = instanceForOwner(p, label);
  const roomScene = assertRoomSceneVisibility(p, label, requireRoomPacket);
  const { roomZones, rageZones, fearZones } = assertInstanceTemplateInventory(instance, label);
  assertMemorySceneVisibility(null, rageZones, 'Rage', `${label}: Rage scene`, false);
  assertMemorySceneVisibility(null, fearZones, 'Fear', `${label}: Fear scene`, false);
  const assigned = assignedInstanceZones(instance);
  assertNoBlankPaddingShortcut(p, instance, assigned, label);

  const entries = [
    ['Rage', 'soulbane_rage_entry'],
    ['Fear', 'soulbane_fear_entry'],
    ['Confusion', 'soulbane_confusion_entry'],
    ['Hope-unbridged', 'soulbane_hope_entry'],
    ['Hope-bridged', 'soulbane_hope_bridged_entry']
  ].map(([name, template]) => ({ name, tile: roomCoord(p, template) }));
  const roomZoneKeys = new Set(roomZones.map(destinationZoneKey));
  const floods = entries.map(({ name, tile: start }) => {
    assertFootprintOpen(start.level, start.x, start.z, 1, 1, `${label}: ${name} exact entry`);
    const flood = instanceNativeFloodfill(p, instance, `${label}: ${name} room flood`, null, start);
    assert(flood.keys.has(`${start.level}:${start.x}:${start.z}`), `${label}: ${name} native flood includes its exact start`);
    const seenWindows = new Set();
    for (const tileAt of flood.tiles) {
      const windowKey = `${tileAt.level}:${tileAt.x >> 3}:${tileAt.z >> 3}`;
      if (seenWindows.has(windowKey)) continue;
      seenWindows.add(windowKey);
      assertSceneMappingWindow(null, tileAt, roomZoneKeys,
        `${label}: ${name} unbounded native-reachable scene tile`);
    }
    return { name, tile: start, flood };
  });
  for (const from of floods) {
    for (const to of floods) {
      if (from === to || from.tile.level !== to.tile.level) continue;
      assert(!from.flood.keys.has(`${to.tile.level}:${to.tile.x}:${to.tile.z}`),
        `${label}: unbounded ${from.name} walk cannot reach the exact ${to.name} entry through mapped rooms or padding`);
    }
  }

  const hopeZones = roomZones.filter(zone => zone.source.level === 0
    && zone.source.x >= (48 << 3) && zone.source.x < ((48 << 3) + 4)
    && zone.source.z >= (81 << 3) && zone.source.z < ((81 << 3) + 4));
  assert.equal(hopeZones.length, 16, `${label}: the unbridged Hope quarter owns exactly its original southwest 4×4 zone set`);
  const hopeZoneKeys = new Set(hopeZones.map(destinationZoneKey));
  const hopeTiles = mappedWalkableTiles(hopeZones, `${label}: original unbridged Hope quarter`);
  const inaccessibleHopeTiles = floods.filter(flood => flood.name !== 'Hope-unbridged')
    .flatMap(flood => flood.flood.tiles)
    .filter(tileAt => hopeZoneKeys.has(`${tileAt.level}:${tileAt.x >> 3}:${tileAt.z >> 3}`));
  assert.equal(inaccessibleHopeTiles.length, 0,
    `${label}: Rage, Fear, Confusion and the bridged Hope quarter cannot walk into the east Hope copy`);

  const hopeLocs = mappedNeighborSourceLocs(hopeZones, `${label}: original Hope quarter locs`);
  assert(hopeLocs.length > 0, `${label}: the actual Hope quarter has non-vacuous copied native locs`);
  const operationForms = new Set();
  for (const loc of hopeLocs) {
    const form = effectiveLocType(p, loc);
    if ((form.op ?? []).some(option => option !== null && option !== 'hidden')) operationForms.add(form.id);
  }
  assert(operationForms.size > 0, `${label}: the copied Hope quarter contains native operable source loc forms`);
  let reachedHopeLocs = 0;
  let reachedHopeOperations = 0;
  for (const flood of floods.filter(candidate => candidate.name !== 'Hope-unbridged')) {
    for (const loc of hopeLocs) {
      if (loc.level !== flood.tile.level) continue;
      const form = effectiveLocType(p, loc);
      const operable = (form.op ?? []).some(option => option !== null && option !== 'hidden');
      const base = types.LocType.get(loc.type);
      const reached = flood.flood.tiles.some(tileAt => map.reachedLoc(
        tileAt.level, tileAt.x, tileAt.z, loc.x, loc.z,
        loc.width, loc.length, p.width, loc.angle, loc.shape, base.forceapproach));
      if (reached) {
        reachedHopeLocs++;
        if (operable) reachedHopeOperations++;
      }
    }
  }
  assert.equal(reachedHopeLocs, 0, `${label}: no earlier or bridged room can natively operate any old-quarter Hope loc`);
  assert.equal(reachedHopeOperations, 0,
    `${label}: no native interaction from an earlier room reaches an operable Hope-quarter loc`);
  const flood = instanceNativeFloodfill(p, instance, label);
  console.log(`PASS private-instance stage and scene isolation ${JSON.stringify({
    stage: stage(p), label, standableSceneTiles: roomScene.standableTiles,
    stageFills: floods.map(value => ({ name: value.name, tiles: value.flood.tiles.length })),
    reachableTiles: flood.tiles.length, hopeQuarterZones: hopeZones.length,
    hopeQuarterTiles: hopeTiles.length, hopeQuarterLocs: hopeLocs.length, operationForms: operationForms.size
  })}`);
  return { instance, roomZones, rageZones, fearZones, flood, stageFloods: floods, neighborTiles: hopeTiles, neighborLocs: hopeLocs };
}
function collisionOpenTiles(zones) {
  const tiles = [];
  for (const zone of zones) {
    const baseX = zone.x << 3;
    const baseZ = zone.z << 3;
    for (let dx = 0; dx < 8; dx++) {
      for (let dz = 0; dz < 8; dz++) {
        const x = baseX + dx;
        const z = baseZ + dz;
        if (map.isZoneAllocated(zone.level, x, z) && !map.isMapBlocked(x, z, zone.level)) {
          tiles.push({ level: zone.level, x, z });
        }
      }
    }
  }
  return tiles;
}
function mappedWalkableTiles(zones, label) {
  const tiles = collisionOpenTiles(zones);
  assert(tiles.length > 0,
    `${label}: packed collision contains non-vacuous collision-open tiles, including blank tiles`);
  return tiles;
}
function mappedZonesInSceneWindow(tile) {
  const centerX = tile.x >> 3;
  const centerZ = tile.z >> 3;
  const zones = [];
  for (let level = 0; level < 4; level++) {
    for (let zoneX = centerX - 6; zoneX <= centerX + 6; zoneX++) {
      for (let zoneZ = centerZ - 6; zoneZ <= centerZ + 6; zoneZ++) {
        const zone = World.gameMap.getZoneIfExists(zoneX << 3, zoneZ << 3, level);
        if (zone instanceof InstanceZone && zone.hasAssignedTemplate) zones.push(zone);
      }
    }
  }
  return zones;
}
function instanceTemplateTuple(zone) {
  return [zone.level, zone.x, zone.z, zone.source.level, zone.source.x, zone.source.z, zone.rotation].join(':');
}
function packetTemplateTuple(template) {
  return [template.level, template.zoneX, template.zoneZ,
    template.sourceLevel, template.sourceZoneX, template.sourceZoneZ, template.rotation].join(':');
}
function assertSceneMappingWindow(p, tileAt, allowedZoneKeys, label, requirePacket = false) {
  const visible = mappedZonesInSceneWindow(tileAt);
  const center = World.gameMap.getZoneIfExists(tileAt.x, tileAt.z, tileAt.level);
  assert(center instanceof InstanceZone, `${label}: the stand tile remains in a native instance zone`);
  if (center.hasAssignedTemplate) {
    assert(allowedZoneKeys.has(destinationZoneKey(center)),
      `${label}: the center tile uses an allowed exact source mapping`);
    assert(visible.includes(center), `${label}: current mapped tile is present in its 13×13 scene window`);
  } else {
    assert(map.isZoneAllocated(tileAt.level, tileAt.x, tileAt.z)
      && !map.isMapBlocked(tileAt.x, tileAt.z, tileAt.level),
    `${label}: an unmapped stand tile is genuinely collision-open native padding`);
  }
  for (const zone of visible) {
    assert(allowedZoneKeys.has(destinationZoneKey(zone)),
      `${label}: the four-floor 13×13 scene window uses only exact allowed mappings; found ${instanceTemplateTuple(zone)}`);
  }
  if (requirePacket) {
    // A dialogue resume can teleport before the next processInfo phase.
    // Run that phase's unforced native rebuild before observing its packet.
    p.buildArea.rebuild();
    const centerX = tileAt.x >> 3;
    const centerZ = tileAt.z >> 3;
    const packet = [...p.packets].reverse().find(value => value instanceof RebuildRegion
      && value.zoneX === centerX && value.zoneZ === centerZ);
    assert(packet, `${label}: the real scene emitted a centered RebuildRegion packet`);
    const actual = packet.templates.map(packetTemplateTuple).sort();
    const expected = visible.map(instanceTemplateTuple).sort();
    assert.deepEqual(actual, expected,
      `${label}: emitted RebuildRegion templates match the exact native four-level scene window`);
  }
  return visible.length;
}
function assertRoomSceneVisibility(p, label, requirePacket = false) {
  const instance = instanceForOwner(p, label);
  const roomZones = roomSourceZones(instance, label);
  const allowedZoneKeys = new Set(roomZones.map(destinationZoneKey));
  const roomTiles = collisionOpenTiles(roomZones);
  assert(roomTiles.length > 0,
    `${label}: scene isolation checks collision-open tiles across all four room floors`);
  const checkedWindows = new Set();
  for (const tileAt of roomTiles) {
    const windowKey = `${tileAt.level}:${tileAt.x >> 3}:${tileAt.z >> 3}`;
    if (checkedWindows.has(windowKey)) continue;
    checkedWindows.add(windowKey);
    assertSceneMappingWindow(null, tileAt, allowedZoneKeys, `${label}: every room-zone 13×13 client window`);
  }
  const currentTile = { level: p.level, x: p.x, z: p.z };
  assertSceneMappingWindow(p, currentTile, allowedZoneKeys, `${label}: real room scene`, requirePacket);
  return { standableTiles: roomTiles.length, checkedWindows: checkedWindows.size };
}
function assertMemoryCameraGround(p, memory) {
  let checked = memoryCameraPackets.get(p);
  if (!checked) {
    checked = new Map();
    memoryCameraPackets.set(p, checked);
  }
  const pending = [...p.cameraPackets.all()].filter(info =>
    (info.type === 0 || info.type === 1) && !checked.has(info));
  if (pending.length === 0) return;
  const label = `${memory} memory camera`;
  const instance = instanceForOwner(p, label);
  const { rageZones, fearZones } = assertInstanceTemplateInventory(instance, label);
  const ground = new Set((memory === 'Rage' ? rageZones : fearZones).map(destinationZoneKey));
  const visible = new Set(mappedZonesInSceneWindow(p).map(destinationZoneKey));
  for (const info of pending) {
    const role = info.type === 0 ? 'eye' : 'look-at';
    const key = `${p.level}:${info.camX >> 3}:${info.camZ >> 3}`;
    assert(ground.has(key),
      `${label}: every issued ${role} tile ${p.level}:${info.camX}:${info.camZ} has copied ground in its own memory patch`);
    assert(visible.has(key), `${label}: every issued ${role} tile is in the player's memory scene window`);
    checked.set(info, { memory, role, level: p.level, x: info.camX, z: info.camZ });
  }
}
function assertMemoryCameraCoverage(p, memory) {
  const commands = [...(memoryCameraPackets.get(p)?.values() ?? [])].filter(info => info.memory === memory);
  assert(commands.some(info => info.role === 'eye'), `${memory} memory issues an actual camera eye command`);
  assert(commands.some(info => info.role === 'look-at'), `${memory} memory issues an actual camera look-at command`);
  console.log(`PASS every issued native memory camera has its own copied ground ${JSON.stringify({ memory, commands })}`);
}
function beginRoomSceneCameraObservation(p) {
  roomCameraPackets.set(p, new Map([...p.cameraPackets.all()].map(info => [info, { label: null }])));
}
function assertRoomSceneCameraGround(p, zones, label) {
  let checked = roomCameraPackets.get(p);
  if (!checked) {
    checked = new Map();
    roomCameraPackets.set(p, checked);
  }
  const allowed = new Set(zones.map(destinationZoneKey));
  const pending = [...p.cameraPackets.all()].filter(info =>
    (info.type === 0 || info.type === 1) && !checked.has(info));
  for (const info of pending) {
    const role = info.type === 0 ? 'eye' : 'look-at';
    const tileAt = { level: p.level, x: info.camX, z: info.camZ };
    assertSceneMappingWindow(null, tileAt, allowed, `${label}: issued ${role} tile has only original room ground`);
    checked.set(info, { label, role, level: p.level, x: info.camX, z: info.camZ });
  }
}
function assertRoomSceneCameraCoverage(p, camera, focus, label) {
  const commands = [...(roomCameraPackets.get(p)?.values() ?? [])].filter(info => info.label === label);
  assert(commands.some(info => info.role === 'eye' && info.level === camera.level
    && info.x === camera.x && info.z === camera.z),
  `${label}: actual cam_moveto targets the exact reconstructed camera stand`);
  assert(commands.some(info => info.role === 'look-at' && info.level === focus.level
    && info.x === focus.x && info.z === focus.z),
  `${label}: actual cam_lookat targets the exact staged Tolna stand`);
}
// The native input proof supplies the actual reachable standing set: collision-
// open padding is not reachable while the compiled memory holds every input.
function assertMemorySceneVisibility(p, zones, memory, label, requirePacket = false) {
  const sources = [...(heldMemoryStandingTiles.get(memory)?.values() ?? [])];
  assert(sources.length > 0, `${label}: the completed native input proof supplies standing tiles`);
  const instance = World.instances.findInstanceByCoord({
    level: zones[0].level, x: zones[0].x << 3, z: zones[0].z << 3
  });
  assert(instance, `${label}: native memory tiles belong to a live instance`);
  const tiles = sources.map(source => {
    const zone = instanceZoneForSource(instance, source, label);
    assert(zones.includes(zone), `${label}: the proved script placement maps into this memory`);
    return {
      level: zone.level, x: (zone.x << 3) + (source.x & 7), z: (zone.z << 3) + (source.z & 7)
    };
  });
  const allowedZoneKeys = new Set(zones.map(destinationZoneKey));
  const checkedWindows = new Set();
  for (const tileAt of tiles) {
    const windowKey = `${tileAt.level}:${tileAt.x >> 3}:${tileAt.z >> 3}`;
    if (checkedWindows.has(windowKey)) continue;
    checkedWindows.add(windowKey);
    assertSceneMappingWindow(null, tileAt, allowedZoneKeys, `${label}: every proved standing-set 13×13 window`);
  }
  if (p) {
    assert(tiles.some(tileAt => tileAt.level === p.level && tileAt.x === p.x && tileAt.z === p.z),
      `${label}: the real player is at a standing tile established by the native input proof`);
    assertSceneMappingWindow(p, { level: p.level, x: p.x, z: p.z }, allowedZoneKeys,
      `${label}: real memory scene`, requirePacket);
  }
  console.log(`PASS proved held-memory standing-set isolation ${JSON.stringify({
    memory, label, sourceStandingTiles: sources, nativeStandingTiles: tiles, checkedWindows: checkedWindows.size
  })}`);
  return tiles.length;
}
function hasExactNativeRoute(start, destination) {
  if (start.level !== destination.level) return false;
  const route = [...map.findPath(start.level, start.x, start.z, destination.x, destination.z)];
  if (route.length === 0) return false;
  const end = unpackWorld(route.at(-1));
  return end.level === destination.level && end.x === destination.x && end.z === destination.z;
}
function assertNoBlankPaddingShortcut(p, instance, assignedZones, label) {
  const assigned = new Set(assignedZones.map(destinationZoneKey));
  const baseZoneX = instance.sw.x >> 3;
  const baseZoneZ = instance.sw.z >> 3;
  let interiorBlankZones = 0;
  for (let floor = 0; floor < instance.floors; floor++) {
    const level = instance.sw.level + floor;
    for (let east = 0; east < instance.zonesEast; east++) {
      for (let north = 0; north < instance.zonesNorth; north++) {
        const zoneX = baseZoneX + east;
        const zoneZ = baseZoneZ + north;
        if (assigned.has(`${level}:${zoneX}:${zoneZ}`)) continue;
        const distance = Math.min(...assignedZones.map(zone =>
          Math.max(Math.abs(zone.x - zoneX), Math.abs(zone.z - zoneZ))));
        if (distance <= 1) continue;
        interiorBlankZones++;
        assert.equal(map.isZoneAllocated(level, zoneX << 3, zoneZ << 3), false,
          `${label}: unassigned blank padding has no native collision allocation`);
      }
    }
  }
  assert(interiorBlankZones > 0, `${label}: mapped islands leave non-vacuous blank padding`);
}

function assertPrivateCopyHasNoEscapeAccess(p, label) {
  const { zones } = privateInstanceZones(p, label);
  const locs = zones.flatMap(zone => [...zone.getAllLocsSafe()]);
  const bankLocs = locs.filter(loc => /bank|deposit/i.test(types.LocType.get(loc.type)?.debugname ?? ''));
  assert.equal(bankLocs.length, 0, `${label}: copied room has no bank booth or deposit box loc`);

  const players = [...new Set(zones.flatMap(zone => [...zone.getAllPlayersUnsafe()]).filter(other => other?.isActive))];
  assert.deepEqual(players, [p], `${label}: only the owner can occupy this private copy`);

  const npcs = zones.flatMap(zone => [...zone.getAllNpcsUnsafe()]).filter(npc => npc?.isActive);
  assert.equal(npcs.length, 8, `${label}: the copy contains only its eight Rage actors`);
  assert(npcs.every(npc => RAGE_IDS.has(npc.type)
    && npc.vars[NPC_INSTANCE] === instanceUid(p)
    && (npc.vars[NPC_OWNER] >>> 0) === p.uid), `${label}: no familiar or foreign NPC occupies the copy`);

  const objects = zones.flatMap(zone => [...zone.getAllObjsUnsafe()]);
  assert.equal(objects.length, 0, `${label}: no other player's ground item is present in the copy`);
}

function nearbyLocs(p, pattern, radius = 52) {
  const found = new Map();
  const minZoneX = Math.floor((p.x - radius) / 8);
  const maxZoneX = Math.floor((p.x + radius) / 8);
  const minZoneZ = Math.floor((p.z - radius) / 8);
  const maxZoneZ = Math.floor((p.z + radius) / 8);
  for (let zoneX = minZoneX; zoneX <= maxZoneX; zoneX++) {
    for (let zoneZ = minZoneZ; zoneZ <= maxZoneZ; zoneZ++) {
      const zone = World.gameMap.getZoneIfExists(zoneX << 3, zoneZ << 3, p.level);
      if (!zone) continue;
      for (const loc of zone.getAllLocsSafe()) {
        const name = types.LocType.get(loc.type)?.debugname ?? '';
        if (pattern.test(name) && Math.abs(loc.x - p.x) <= radius && Math.abs(loc.z - p.z) <= radius) {
          found.set(`${loc.type}:${loc.x}:${loc.z}:${loc.level}`, loc);
        }
      }
    }
  }
  return [...found.values()].sort((a, b) =>
    Math.abs(a.x - p.x) + Math.abs(a.z - p.z) - Math.abs(b.x - p.x) - Math.abs(b.z - p.z));
}

function componentOption(componentName, pattern) {
  const component = types.Component.get(id('Component', componentName));
  const index = (component?.iop ?? []).findIndex(option => typeof option === 'string' && pattern.test(option));
  assert(index >= 0, `${componentName} exposes option ${pattern}`);
  return index + 1;
}

function safeTeleport(p, destination, label) {
  assertFootprintOpen(destination.level, destination.x, destination.z, 1, 1, `${label}: landing collision`);
  runProc('p_telejump_safe', p, [CoordGrid.packCoord(destination.level, destination.x, destination.z)]);
  for (let tick = 0; tick < 3; tick++) worldTick();
  assert.deepEqual(tile(p), [destination.level, destination.x, destination.z], `${label}: production safe teleport reaches its exact destination`);
}


function surfaceTile() {
  const declaration = questCoordinateDeclarations().get('soulbane_surface');
  assert(declaration, 'Soulbane declares the surface exit coordinate');
  const { level, x, z } = unpackWorld(packedTemplate(declaration));
  return [level, x, z];
}
function ensureFearCombatWeapon(p, label) {
  const worn = types.InvType.getId('worn');
  const hasScimitar = count(p, 'rune_scimitar') + count(p, 'rune_scimitar', worn) > 0;
  if (!hasScimitar) {
    let added = p.invAdd(inv, obj('rune_scimitar'), 1);
    if (added !== 1) {
      const filler = inventory(p).find(item => item && !WEAPON_IDS.has(obj(item.name)) &&
        types.ObjType.get(obj(item.name))?.stackable === false);
      assert(filler, `${label}: one ordinary non-stackable item can make room for test combat gear`);
      assert(p.invDel(inv, obj(filler.name), filler.count), `${label}: remove only disclosed fixture gear`);
      added = p.invAdd(inv, obj('rune_scimitar'), 1);
    }
    assert.equal(added, 1, `${label}: one ordinary rune scimitar is seeded for authentic Fear combat`);
  }
  if (count(p, 'rune_scimitar', worn) === 0) {
    assert(held(p, 'rune_scimitar', 2), `${label}: native Wield inventory action accepted`);
  }
  assert.equal(count(p, 'rune_scimitar', worn), 1, `${label}: ordinary rune scimitar is equipped`);
}
function seedFearCombatFixture(p, label) {
  for (const stat of [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE,
    PlayerStat.HITPOINTS, PlayerStat.MAGIC]) p.setLevel(stat, 99);
  ensureFearCombatWeapon(p, label);
  assert.equal(angerWeaponTotal(p), 0, `${label}: Fear combat does not use a Rage weapon`);
}
function assertFearFreshEntry(p, label) {
  assert.equal(stage(p), FEAR_STAGE, `${label}: permanent progress remains in active Fear`);
  assert(instanceUid(p) > 0, `${label}: a fresh private region owns Fear`);
  assert.deepEqual({ level: p.level, x: p.x, z: p.z }, roomCoord(p, 'soulbane_fear_entry'), `${label}: re-entry lands at the packed Fear entry`);
  assert.equal(fearNpcsFor(p).length, 0, `${label}: an incomplete Fear room does not resume a stale reaper`);
  fearDoor(p);
  for (const [name, value] of [
    ['soulbane_fear_enemydoor_old', 0], ['soulbane_fear_monspres', 0],
    ['soulbane_fear_killedtally', 0], ['soulbane_fear_exitlit', 0]
  ]) assert.equal(readVar(p, name), value, `${label}: ${name} resets for incomplete Fear`);
  assertNoAngerItems(p, label);
}
function enterFearAfterRift(p, label) {
  chooseRiftWithRope(p, label, { requireUnlocked: true });
  assertFearFreshEntry(p, label);
  assert.equal(rageNpcsFor(p).length, 0, `${label}: Fear re-entry never respawns Rage actors`);
}
function searchEveryFearHole(p, label) {
  const activeDoor = fearDoor(p);
  const holes = fearHoleLocs(p);
  const tallyBefore = readVar(p, 'soulbane_fear_killedtally');
  for (const [index, hole] of holes.entries()) {
    const ordinal = index + 1;
    if (ordinal === activeDoor) continue;
    searchFearHole(p, hole, `${label}: wrong hole ${ordinal}`);
    assert.equal(fearNpcsFor(p).length, 0, `${label}: wrong hole ${ordinal} cannot spawn a reaper`);
    assert.equal(readVar(p, 'soulbane_fear_monspres'), 0, `${label}: wrong hole ${ordinal} leaves no encounter marker`);
    assert.equal(readVar(p, 'soulbane_fear_killedtally'), tallyBefore, `${label}: wrong hole ${ordinal} earns no kill`);
  }
  searchFearHole(p, holes[activeDoor - 1], `${label}: active hole ${activeDoor}`);
  for (let tick = 0; tick < 32 && fearNpcsFor(p).length === 0; tick++) worldTick();
  return ensureFearReaper(p, `${label}: sole active hole ${activeDoor}`);
}
function fearSceneTolnas() {
  return [...World.npcs].filter(npc => npc?.isActive &&
    (npc.baseType === TOLNA_SCENE || npc.type === TOLNA_SCENE));
}
function observeFearScene(p) {
  const playerStand = roomCoord(p, 'soulbane_fear_scene_player');
  const tolnaStand = roomCoord(p, 'soulbane_fear_scene_tolna');
  const tolna = fearSceneTolnas().filter(npc =>
    npc.level === tolnaStand.level && npc.x === tolnaStand.x && npc.z === tolnaStand.z);
  if (tolna.length === 0 || p.level !== playerStand.level ||
    p.x !== playerStand.x || p.z !== playerStand.z) return false;
  assert.equal(tolna.length, 1, 'Fear scene stages exactly one Tolna at the packed memory tile');
  assertFootprintOpen(playerStand.level, playerStand.x, playerStand.z, 1, 1, 'Fear scene player footprint');
  assertFootprintOpen(tolna[0].level, tolna[0].x, tolna[0].z, tolna[0].width, tolna[0].length,
    'Fear scene Tolna footprint');
  nativeRouteFrom(playerStand, { level: tolna[0].level, x: tolna[0].x, z: tolna[0].z },
    'Fear scene player can reach staged Tolna on foot');
  return true;
}
function finishFearScene(p) {
  let sawFearStaging = false;
  const pages = [];
  const messageStart = p.messages.length;
  const recordFearStaging = () => {
    assertMemoryCameraGround(p, 'Fear');
    if (sawFearStaging || !observeFearScene(p)) return;
    const instance = instanceForOwner(p, 'Fear memory scene');
    const { fearZones } = assertInstanceTemplateInventory(instance, 'Fear memory scene');
    assertMemorySceneVisibility(p, fearZones, 'Fear', 'Fear memory scene', true);
    sawFearStaging = true;
  };
  for (let tick = 0; tick < 1200; tick++) {
    recordFearStaging();
    const state = p.activeScript;
    if (state?.execution === ScriptState.PAUSEBUTTON) {
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      assert(!/^multi[2-5]$/.test(root), 'the compiled Fear scene has no unanswered choices');
      pages.push(...dialoguePage(p));
      resumeDialogue(p);
      continue;
    }
    worldTick();
    recordFearStaging();
    if (stage(p) === FEAR_COMPLETE_STAGE && p.queue.head() === null &&
      (!p.activeScript || p.activeScript.execution === ScriptState.FINISHED)) break;
  }
  assert(sawFearStaging, 'the fifth-death scene stages the player and Tolna before returning');
  assertMemoryCameraCoverage(p, 'Fear');
  assert.equal(stage(p), FEAR_COMPLETE_STAGE, 'the Fear scene, not the fifth death queue, commits stage 5');
  assert.deepEqual({ level: p.level, x: p.x, z: p.z }, roomCoord(p, 'soulbane_fear_entry'), 'the Fear scene returns to its room entry');
  assert.equal(readVar(p, 'soulbane_fear_killedtally'), 5, 'the completed five-kill tally is preserved');
  assert.equal(readVar(p, 'soulbane_fear_exitlit'), 1, 'the western exit lights only when the scene commits');
  assert.equal(fearNpcsFor(p).length, 0, 'the completed Fear scene leaves no reaper');
  assert.equal(fearSceneTolnas().length, 0, 'the completed Fear scene removes staged Tolna');
  return { pages: pages.join(' '), messages: p.messages.slice(messageStart).join(' ') };
}
function leaveFearToSurface(p, label, choices = [1]) {
  const exit = fearSurfaceExitLoc(p);
  const result = operateSurfaceExit(p, exit, choices, label);
  assert.match(result.trigger.name, /^\[oploc1,soul_bane_fwall_void_small\]$/,
    `${label}: uses the original Fear surface Exit loc`);
  return result;
}
function assertFearExitCleanup(p, oldUid, expectedTile, ordinaryBefore, label) {
  assert.equal(stage(p), FEAR_STAGE, `${label}: cleanup preserves unfinished Fear`);
  assert.equal(instanceUid(p), 0, `${label}: cleanup releases the private copy`);
  assert.deepEqual(tile(p), expectedTile, `${label}: cleanup reaches the observed outside tile`);
  assertFearReset(p, label);
  assertNoAngerItems(p, label);
  assert.equal(fearNpcsWithInstance(oldUid).length, 0, `${label}: no reaper survives in the old copy`);
  assert.deepEqual(normalInventory(p), ordinaryBefore, `${label}: cleanup preserves ordinary bag inventory`);
  assert.equal(count(p, 'rune_scimitar', types.InvType.getId('worn')), 1,
    `${label}: cleanup preserves the ordinary equipped weapon`);
  for (let tick = 0; tick < 16; tick++) worldTick();
  assertFearReset(p, label);
  assert.equal(stage(p), FEAR_STAGE, `${label}: settled stale queues cannot complete Fear`);
  assert.equal(readVar(p, 'soulbane_fear_killedtally'), 0, `${label}: settled stale queues cannot restore partial kills`);
}
function assertFearCompleteEntry(p, label) {
  assert.equal(stage(p), FEAR_COMPLETE_STAGE, `${label}: completed Fear progress persists`);
  assert(instanceUid(p) > 0, `${label}: completed progress owns a fresh private region`);
  assertPrivateInstanceIsolation(p, label);
  assert.deepEqual({ level: p.level, x: p.x, z: p.z }, roomCoord(p, 'soulbane_fear_entry'), `${label}: completed re-entry lands in Fear`);
  assert.equal(readVar(p, 'soulbane_fear_killedtally'), 5, `${label}: all five kills survive re-entry`);
  assert.equal(readVar(p, 'soulbane_fear_exitlit'), 1, `${label}: the illuminated exit survives re-entry`);
  assert.equal(readVar(p, 'soulbane_fear_enemydoor'), 0, `${label}: completed Fear has no active hole`);
  assert.equal(readVar(p, 'soulbane_fear_enemydoor_old'), 0, `${label}: completed Fear has no stale exclusion`);
  assert.equal(readVar(p, 'soulbane_fear_monspres'), 0, `${label}: completed Fear has no encounter marker`);
  assert.equal(fearNpcsFor(p).length, 0, `${label}: completed re-entry cannot respawn a Reaper`);
  assert.equal(fearSceneTolnas().length, 0, `${label}: completed re-entry cannot respawn scene Tolna`);
  assertNoAngerItems(p, label);
}
function assertFearCompleteExit(p, oldUid, expectedTile, ordinaryBefore, label) {
  assert.equal(stage(p), FEAR_COMPLETE_STAGE, `${label}: cleanup preserves completed Fear`);
  assert.equal(instanceUid(p), 0, `${label}: cleanup releases the completed private copy`);
  assert.deepEqual(tile(p), expectedTile, `${label}: cleanup reaches the outside tile`);
  assert.equal(readVar(p, 'soulbane_fear_killedtally'), 5, `${label}: completed kill count is permanent`);
  assert.equal(readVar(p, 'soulbane_fear_exitlit'), 1, `${label}: completed exit remains lit`);
  assert.equal(readVar(p, 'soulbane_fear_enemydoor'), 0, `${label}: cleanup clears completed active-hole state`);
  assert.equal(readVar(p, 'soulbane_fear_enemydoor_old'), 0, `${label}: cleanup clears completed previous-hole state`);
  assert.equal(readVar(p, 'soulbane_fear_monspres'), 0, `${label}: cleanup clears completed encounter state`);
  assertNoAngerItems(p, label);
  assert.equal(fearNpcsWithInstance(oldUid).length, 0, `${label}: no Reaper survives in the old completed copy`);
  assert.deepEqual(normalInventory(p), ordinaryBefore, `${label}: cleanup preserves ordinary bag inventory`);
  assert.equal(count(p, 'rune_scimitar', types.InvType.getId('worn')), 1,
    `${label}: cleanup preserves the ordinary equipped weapon`);
  for (let tick = 0; tick < 16; tick++) worldTick();
  assert.equal(readVar(p, 'soulbane_fear_killedtally'), 5, `${label}: stale queues cannot erase completed Fear`);
  assert.equal(readVar(p, 'soulbane_fear_exitlit'), 1, `${label}: stale queues cannot close the completed exit`);
}
function testFearProgression(p, stageThreeColor) {
  const qpBeforeFear = readVar(p, 'qp');
  const coinsBeforeFear = count(p, 'coins');
  const xpBeforeFear = xpSnapshot(p);
  chooseRiftWithRope(p, 'completed Rage re-entry before Fear', { requireUnlocked: true });
  assert.equal(stage(p), 3, 'Rage completion survives the real rift re-entry before the next room');
  assertPrivateInstanceIsolation(p, 'stage-3 completed Rage re-entry');
  assert.equal(rageNpcsFor(p).length, 0, 'completed Rage re-entry does not respawn its monsters');
  assert.equal(latestQuestColor(p), stageThreeColor, 'completed Rage remains the active quest before Fear');

  const rageUid = instanceUid(p);
  const boundary = rageFearBoundaryLoc(p);
  goToStand(p, boundary, 'stage-3 transition: walk to the original eastern Fear exit');
  const fearMusicObservation = beginRoomMusicObservation(p, FEAR_SONG, 1,
    'first Fear room entry', { requireLocked: true });
  const transition = operateLoc(p, boundary, 1, [], 'stage-3 transition into Fear');
  assert.equal(transition.trigger.name, '[oploc1,soul_bane_awall_void_exit]',
    'Rage-to-Fear transition uses the original eastern boundary loc');
  assertRoomMusicObservation(p, fearMusicObservation, 'first Fear room entry');
  assert.equal(stage(p), FEAR_STAGE, 'the real next-room exit enters active Fear stage 4');
  assert.equal(instanceUid(p), rageUid, 'Rage-to-Fear transition stays inside the owner\'s private copy');
  assertPrivateInstanceIsolation(p, 'stage-4 Fear entry');
  assert.deepEqual({ level: p.level, x: p.x, z: p.z }, roomCoord(p, 'soulbane_fear_entry'), 'the eastern boundary lands at the packed Fear entry');
  assertNoAngerItems(p, 'stage-3 Fear transition strips the Rage weapon');
  assert.equal(rageNpcsFor(p).length, 0, 'Fear entry removes every Rage actor');
  assert.equal(readVar(p, 'soulbane_anger_damagedealt'), 0, 'Fear entry clears the completed Rage meter');
  assert.equal(readVar(p, 'soulbane_anger_donespecial'), 0, 'Fear entry clears the completed Rage scene flag');
  fearDoor(p);
  for (const [name, value] of [
    ['soulbane_fear_enemydoor_old', 0], ['soulbane_fear_monspres', 0],
    ['soulbane_fear_killedtally', 0], ['soulbane_fear_exitlit', 0]
  ]) assert.equal(readVar(p, name), value, `first Fear entry initializes ${name}`);
  assert.deepEqual(xpSnapshot(p), xpBeforeFear, 'entering Fear awards no quest or combat XP');
  assert.equal(readVar(p, 'qp'), qpBeforeFear, 'entering Fear awards no quest points');
  assert.equal(count(p, 'coins'), coinsBeforeFear, 'entering Fear awards no coins');
  assert.equal(latestQuestColor(p), stageThreeColor, 'active Fear remains an incomplete quest row');
  assertJournal(p, ['second room', 'your son\'s voice again', 'Help him get over his fear!'],
    ['exit has been illuminated', 'Soulbane is complete'], 'stage-4 Fear journal');

  const routes = checkFearRoomRoutes(p);
  assert.deepEqual({ level: p.level, x: p.x, z: p.z }, routes.entry, 'route auditing leaves the owner at the real Fear entry');
  seedFearCombatFixture(p, 'Fear ordinary-combat fixture');

  goToStand(p, routes.westExit, 'stage-4 closed west exit: walk to the western black hole');
  const closedMark = p.messages.length;
  const closed = operateLoc(p, routes.westExit, 1, [], 'stage-4 closed western black-hole refusal');
  assert.equal(closed.trigger.name, '[oploc1,soul_bane_fwall_exit_closed]',
    'unlit west exit dispatches its original closed visible form');
  assert(p.messages.slice(closedMark).join(' ').includes("There's no way I'm going in there!"),
    'stage-4 closed west exit refuses entry without changing progress');
  assert.equal(stage(p), FEAR_STAGE, 'closed exit does not fabricate Fear completion');
  assert.equal(readVar(p, 'soulbane_fear_killedtally'), 0, 'closed exit earns no Fear kills');
  assert.equal(readVar(p, 'soulbane_fear_exitlit'), 0, 'closed exit remains unlit before the fifth-death scene');

  const firstReaper = searchEveryFearHole(p, 'Fear six-hole dispatch');
  const intruder = playerFixture();
  testForeignFearInteractions(p, intruder, firstReaper);
  castFearSpellOnce(p, firstReaper, 'eligible-owner Wind Strike against Fear');
  killFearReaper(p, firstReaper, 0, 'Fear partial kill before surface exit');
  const firstPartialXp = xpSnapshot(p);
  const firstOldUid = instanceUid(p);
  const firstOrdinaryInventory = normalInventory(p);
  leaveFearToSurface(p, 'Fear incomplete surface exit');
  assertFearExitCleanup(p, firstOldUid, surfaceTile(), firstOrdinaryInventory,
    'Fear incomplete surface exit');
  assert.deepEqual(xpSnapshot(p), firstPartialXp, 'surface cleanup does not award extra XP');
  assert.equal(readVar(p, 'qp'), qpBeforeFear, 'unfinished Fear exit grants no quest points');
  assert.equal(count(p, 'coins'), coinsBeforeFear, 'unfinished Fear exit grants no coins');

  enterFearAfterRift(p, 'Fear re-entry after confirmed surface exit');
  let liveReaper = ensureFearReaper(p, 'Fear safe-teleport cleanup setup');
  const teleportUid = instanceUid(p);
  const teleportInventory = normalInventory(p);
  const teleportXp = xpSnapshot(p);
  const teleportTile = { level: 0, x: 3213, z: 3424 };
  safeTeleport(p, teleportTile, 'Fear owner safe-teleports out with a live Reaper');
  assertFearExitCleanup(p, teleportUid, [teleportTile.level, teleportTile.x, teleportTile.z],
    teleportInventory, 'Fear outside-teleport cleanup');
  assert.deepEqual(xpSnapshot(p), teleportXp, 'outside-teleport cleanup awards no XP');
  safeTeleport(p, { level: surfaceTile()[0], x: surfaceTile()[1], z: surfaceTile()[2] },
    'Fear lifecycle returns to the disclosed surface travel fixture');
  enterFearAfterRift(p, 'Fear re-entry after outside teleport');

  liveReaper = ensureFearReaper(p, 'Fear logout cleanup partial-kill setup');
  killFearReaper(p, liveReaper, 0, 'Fear partial kill before logout');
  liveReaper = ensureFearReaper(p, 'Fear logout cleanup live-actor setup');
  const logoutUid = instanceUid(p);
  const logoutInventory = normalInventory(p);
  const logoutXp = xpSnapshot(p);
  p = nativeLogoutAndReload(p, 'unfinished Fear logout with a live Reaper');
  assertFearExitCleanup(p, logoutUid, surfaceTile(), logoutInventory,
    'unfinished Fear logout cleanup');
  assert.deepEqual(xpSnapshot(p), logoutXp, 'unfinished Fear logout/relogin preserves earned ordinary XP only');
  assert.equal(latestQuestColor(p), stageThreeColor, 'unfinished Fear login keeps the active quest-row color');
  assertJournal(p, ['second room', 'your son\'s voice again', 'Help him get over his fear!'],
    ['exit has been illuminated', 'Soulbane is complete'], 'post-login stage-4 Fear journal');
  enterFearAfterRift(p, 'Fear re-entry after incomplete logout');

  liveReaper = ensureFearReaper(p, 'Fear death cleanup partial-kill setup');
  killFearReaper(p, liveReaper, 0, 'Fear partial kill before death');
  liveReaper = ensureFearReaper(p, 'Fear death cleanup live-actor setup');
  const deathUid = instanceUid(p);
  const deathXp = xpSnapshot(p);
  const deathQp = readVar(p, 'qp');
  const deathTile = tile(p);
  p.levels[PlayerStat.HITPOINTS] = 0;
  assert(ScriptProvider.getByName('[proc,player_die]'), 'ordinary player_die procedure is packed for Fear cleanup');
  runProc('player_die', p);
  for (let tick = 0; tick < 80 && (p.activeScript || p.queue.head() !== null); tick++) worldTick();
  for (let tick = 0; tick < 3; tick++) worldTick();
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED,
    'ordinary Fear death/respawn animation and cleanup settle');
  assert.equal(stage(p), FEAR_STAGE, 'death preserves the unfinished Fear stage');
  assert.equal(instanceUid(p), 0, 'death cleanup releases the Fear instance');
  assert(!CoordGrid.isInstanceX(p.x), 'death respawns outside the Fear copy');
  assert.equal(World.instances.findInstanceByUid(deathUid - 1), null, 'death deletes the old Fear copy');
  assert.equal(fearNpcsWithInstance(deathUid).length, 0, 'death removes every old Fear Reaper');
  assertFearReset(p, 'Fear death cleanup');
  assertNoAngerItems(p, 'Fear death cleanup');
  assert.deepEqual(xpSnapshot(p), deathXp, 'ordinary death grants neither Fear nor quest XP');
  assert.equal(readVar(p, 'qp'), deathQp, 'death grants no Fear quest points');
  assert.notDeepEqual(tile(p), deathTile, 'ordinary death moves the player out of the Fear death tile');

  const surface = surfaceTile();
  safeTeleport(p, { level: surface[0], x: surface[1], z: surface[2] },
    'Fear death lifecycle returns to the disclosed surface travel fixture');
  enterFearAfterRift(p, 'Fear re-entry after ordinary death');
  ensureFearCombatWeapon(p, 'Fear post-death combat fixture');

  for (let ordinal = 0; ordinal < 5; ordinal++) {
    const reaper = ensureFearReaper(p, `Fear five-kill run reaper ${ordinal + 1}`);
    killFearReaper(p, reaper, ordinal, `Fear five-kill run death ${ordinal + 1}`);
  }
  const xpBeforeScene = xpSnapshot(p);
  const qpBeforeScene = readVar(p, 'qp');
  const coinsBeforeScene = count(p, 'coins');
  const scene = finishFearScene(p);
  assert(scene.pages.includes('Phew, I don\'t feel so scared now.'),
    'the fifth real death reaches the Fear scene before its completion boundary');
  assert(scene.messages.includes("What's that?"), 'the Fear scene returns through its authored final game message');
  assert.deepEqual(xpSnapshot(p), xpBeforeScene, 'the Fear scene awards no terminal quest XP');
  assert.equal(readVar(p, 'qp'), qpBeforeScene, 'the Fear scene grants no quest points');
  assert.equal(count(p, 'coins'), coinsBeforeScene, 'the Fear scene grants no coins');
  assert.equal(qpBeforeScene, qpBeforeFear, 'all of Fear grants no quest points');
  assert.equal(coinsBeforeScene, coinsBeforeFear, 'all of Fear grants no coins');
  assert.equal(latestQuestColor(p), stageThreeColor, 'stage 5 remains an active quest, not full completion');
  assertJournal(p, ['overcome fear in the second room', 'exit has been illuminated',
    'haven\'t actually ventured through yet.'], ['Tolna has been rescued', 'Soulbane is complete'],
  'stage-5 Fear journal');


  const completeUid = instanceUid(p);
  const completeInventory = normalInventory(p);
  const completeXp = xpSnapshot(p);
  const completedSurface = fearSurfaceExitLoc(p);
  const leave = operateSurfaceExit(p, completedSurface, [], 'stage-5 completed surface exit');
  assert.equal(leave.trigger.name, '[oploc1,soul_bane_fwall_void_small]',
    'completed Fear leaves through the original surface Exit loc');
  assertFearCompleteExit(p, completeUid, surfaceTile(), completeInventory, 'completed Fear surface exit');
  assert.deepEqual(xpSnapshot(p), completeXp, 'completed surface exit awards no terminal XP');
  assert.equal(readVar(p, 'qp'), qpBeforeFear, 'completed Fear still grants no quest points');
  assert.equal(count(p, 'coins'), coinsBeforeFear, 'completed Fear still grants no coins');

  const completeXpBeforeReentry = xpSnapshot(p);
  chooseRiftWithRope(p, 'completed Fear surface-descent re-entry', { requireUnlocked: true });
  assertFearCompleteEntry(p, 'completed Fear surface-descent re-entry');
  for (let tick = 0; tick < 32; tick++) worldTick();
  assert.equal(p.queue.head(), null, 'completed Fear re-entry queues no duplicate scene');
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED,
    'completed Fear re-entry starts no duplicate scene script');
  assert.deepEqual(xpSnapshot(p), completeXpBeforeReentry, 'completed Fear re-entry awards no duplicate XP');
  assert.equal(readVar(p, 'qp'), qpBeforeFear, 'completed Fear re-entry grants no quest points');
  assert.equal(count(p, 'coins'), coinsBeforeFear, 'completed Fear re-entry grants no coins');
  assert.equal(latestQuestColor(p), stageThreeColor, 'completed Fear re-entry keeps the active quest-row color');

  const completeLogoutUid = instanceUid(p);
  const completeLogoutInventory = normalInventory(p);
  const completeLogoutXp = xpSnapshot(p);
  p = nativeLogoutAndReload(p, 'completed Fear logout inside its copy');
  assert.equal(stage(p), FEAR_COMPLETE_STAGE, 'completed Fear logout preserves stage 5');
  assert.equal(instanceUid(p), 0, 'completed Fear login clears its temporary instance UID');
  assert.deepEqual(tile(p), surfaceTile(), 'completed Fear logout lands at the saved surface exit');
  assert.equal(readVar(p, 'soulbane_fear_killedtally'), 5, 'completed Fear logout preserves its five kills');
  assert.equal(readVar(p, 'soulbane_fear_exitlit'), 1, 'completed Fear logout preserves the illuminated exit');
  assert.equal(readVar(p, 'soulbane_fear_enemydoor'), 0, 'completed Fear login clears the active-hole state');
  assert.equal(readVar(p, 'soulbane_fear_enemydoor_old'), 0, 'completed Fear login clears the old-hole state');
  assert.equal(readVar(p, 'soulbane_fear_monspres'), 0, 'completed Fear login clears the encounter marker');
  assertNoAngerItems(p, 'completed Fear logout/relogin');
  assert.equal(fearNpcsWithInstance(completeLogoutUid).length, 0, 'completed logout removes all old Reapers');
  assert.deepEqual(normalInventory(p), completeLogoutInventory, 'completed logout preserves ordinary bag inventory');
  assert.deepEqual(xpSnapshot(p), completeLogoutXp, 'completed logout preserves exactly the earned ordinary XP');
  assert.equal(latestQuestColor(p), stageThreeColor, 'completed Fear login keeps the active quest-row color');
  assertJournal(p, ['overcome fear in the second room', 'exit has been illuminated',
    'haven\'t actually ventured through yet.'], ['Tolna has been rescued', 'Soulbane is complete'],
  'post-login stage-5 Fear journal');
  chooseRiftWithRope(p, 'completed Fear re-entry after logout', { requireUnlocked: true });
  assertFearCompleteEntry(p, 'completed Fear re-entry after logout');
  for (let tick = 0; tick < 32; tick++) worldTick();
  assert.equal(p.queue.head(), null, 'completed post-logout re-entry does not replay the Fear scene');
  assert.deepEqual(xpSnapshot(p), completeLogoutXp, 'completed post-logout re-entry does not award repeat XP');
  console.log(`Fear saved boundary ${JSON.stringify({
    stage: stage(p), kills: readVar(p, 'soulbane_fear_killedtally'),
    exitLit: readVar(p, 'soulbane_fear_exitlit'), liveReapers: fearNpcsFor(p).length,
    sceneActors: fearSceneTolnas().length, questColor: latestQuestColor(p)
  })}`);
  const progressed = testConfusionHopeProgression(p);
  return { player: progressed, completed: p, stageThreeColor };
}
const CONFUSION_DOOR_FLAGS = Array.from({ length: 5 }, (_, index) => `soulbane_confu_door${index + 1}pres`);
function confusionKillFlags(p) {
  return CONFUSION_DOOR_FLAGS.map(name => readVar(p, name));
}
function confusionKillCount(p) {
  return confusionKillFlags(p).reduce((total, value) => total + value, 0);
}
function assertConfusionKillFlags(p, expected, label) {
  assert.deepEqual(confusionKillFlags(p), Array.from({ length: 5 }, (_, index) => Number(index < expected)),
    `${label}: only the ${expected} sequential real-kill door credits are open`);
}
function assertOwnedQuestActors(p, actors, expectedCount, label) {
  assert.equal(actors.length, expectedCount, `${label}: exact number of live owner-copy NPCs`);
  for (const npc of actors) {
    assert.equal(npc.vars[NPC_INSTANCE], instanceUid(p), `${label}: NPC carries this instance marker`);
    assert.equal(npc.vars[NPC_OWNER] >>> 0, p.uid, `${label}: NPC carries this player owner`);
  }
}
function confusionHopeDoorLoc(p) {
  const matches = nearbyLocs(p, /^soulbane_door_multi6$/);
  assert.equal(matches.length, 1, 'cleared Confusion retains one compiled sixth-door multiloc');
  assert.equal(effectiveLocType(p, matches[0]).id, requiredId('LocType', 'soul_bane_con_door6_open1'),
    'cleared Confusion exposes the compiled open sixth-door form');
  return matches[0];
}
function confusionSceneActor(p) {
  const stand = roomCoord(p, 'soulbane_confusion_scene_tolna');
  return [...World.npcs].filter(npc => npc?.isActive
    && (npc.type === TOLNA_SCENE || npc.baseType === TOLNA_SCENE)
    && npc.level === stand.level && npc.x === stand.x && npc.z === stand.z);
}
function observeConfusionScene(p) {
  const playerStand = roomCoord(p, 'soulbane_confusion_scene_player');
  const tolnaStand = roomCoord(p, 'soulbane_confusion_scene_tolna');
  const actors = confusionSceneActor(p);
  if (actors.length === 0 || p.level !== playerStand.level || p.x !== playerStand.x || p.z !== playerStand.z) {
    return false;
  }
  assert.equal(actors.length, 1, 'Confusion cutscene stages exactly one Tolna at the authored stand');
  const tolna = actors[0];
  assertFootprintOpen(playerStand.level, playerStand.x, playerStand.z, 1, 1, 'Confusion scene player footprint');
  assertFootprintOpen(tolna.level, tolna.x, tolna.z, tolna.width, tolna.length, 'Confusion scene Tolna footprint');
  nativeRouteFrom(playerStand, { level: tolna.level, x: tolna.x, z: tolna.z },
    'Confusion scene player can reach the staged Tolna on foot');
  return true;
}
function finishConfusionScene(p) {
  const label = 'Confusion memory scene';
  const instance = instanceForOwner(p, label);
  const { roomZones } = assertInstanceTemplateInventory(instance, label);
  const allowed = new Set(roomZones.map(destinationZoneKey));
  const playerStand = roomCoord(p, 'soulbane_confusion_scene_player');
  const tolnaStand = roomCoord(p, 'soulbane_confusion_scene_tolna');
  const camera = roomCoord(p, 'soulbane_confusion_scene_camera');
  const packetMark = p.packets.length;
  const xpBefore = xpSnapshot(p);
  const qpBefore = readVar(p, 'qp');
  const coinsBefore = count(p, 'coins');
  const pages = [];
  const overheads = new Set();
  let sawStaging = false;
  const record = () => {
    for (const npc of confusionSceneActor(p)) {
      if (typeof npc.sayMessage === 'string' && npc.sayMessage) overheads.add(npc.sayMessage);
    }
    assertRoomSceneCameraGround(p, roomZones, label);
    if (sawStaging || !observeConfusionScene(p)) return;
    assertSceneMappingWindow(p, playerStand, allowed, `${label}: real staged 13×13 four-floor scene`, true);
    assertSceneMappingWindow(null, camera, allowed, `${label}: exact camera 13×13 four-floor scene`);
    sawStaging = true;
  };
  for (let tick = 0; tick < 1200; tick++) {
    record();
    const state = p.activeScript;
    if (state?.execution === ScriptState.PAUSEBUTTON) {
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      assert(!/^multi[2-5]$/.test(root), `${label}: no unanswered dialogue choice`);
      pages.push(...dialoguePage(p));
      resumeDialogue(p);
      continue;
    }
    worldTick(record);
    record();
    if (stage(p) === CONFUSION_CLEAR_STAGE && p.queue.head() === null &&
      (!p.activeScript || p.activeScript.execution === ScriptState.FINISHED)) break;
  }
  assert(sawStaging, 'the fifth real Confusion death stages the exact room scene');
  assertRoomSceneCameraCoverage(p, camera, tolnaStand, label);
  assert(p.packets.slice(packetMark).some(packet => packet instanceof CamReset),
    'Confusion cutscene resets its actual native camera before returning');
  const text = [...pages, ...overheads].join(' ');
  assert(text.includes("Aha! The exit is now clear! This Tolna's mind really is a mess."),
    'Confusion cutscene includes its compiled player line');
  assert(text.includes("Leave me... But I don't want to... How can you say that..."),
    'Confusion cutscene includes Tolna first authored overhead');
  assert(text.includes("I've done nothing wrong... Arrrghhh..."),
    'Confusion cutscene includes Tolna second authored overhead');
  assert.equal(stage(p), CONFUSION_CLEAR_STAGE, 'Confusion scene commits the permanent clear boundary 7');
  assert.equal(readVar(p, 'soulbane_confu_door6open'), 1, 'Confusion scene opens the sixth door after returning');
  assert.deepEqual({ level: p.level, x: p.x, z: p.z }, roomCoord(p, 'soulbane_confusion_entry'),
    'Confusion scene returns to its exact room entry tile');
  assert.equal(confusionKillCount(p), 5, 'Confusion scene preserves exactly five real kills');
  assert.equal(confusionNpcsFor(p).length, 0, 'Confusion scene leaves no attacker behind');
  assert.equal(confusionSceneActor(p).length, 0, 'Confusion scene removes staged Tolna on completion');
  assert.deepEqual(xpSnapshot(p), xpBefore, 'Confusion scene adds no quest-scene XP');
  assert.equal(readVar(p, 'qp'), qpBefore, 'Confusion scene grants no quest points');
  assert.equal(count(p, 'coins'), coinsBefore, 'Confusion scene grants no coins');
  return { text, packetMark };
}
function finishHopeScene(p, packetMark) {
  const label = 'Hope bridge scene';
  assert(Number.isInteger(packetMark), `${label}: caller captured packets before the fifth real creature died`);
  // Offline ticks omit socket output: assert the native overlay state instead.
  // Overlay packet/paint proof is reserved for remaining-headed-bridge-01/receipt.json.
  const instance = instanceForOwner(p, label);
  const { roomZones } = assertInstanceTemplateInventory(instance, label);
  const allowed = new Set(roomZones.map(destinationZoneKey));
  const before = roomCoord(p, 'soulbane_hope_scene_before');
  const after = roomCoord(p, 'soulbane_hope_scene_after');
  const xpBefore = xpSnapshot(p);
  const qpBefore = readVar(p, 'qp');
  const coinsBefore = count(p, 'coins');
  let overlayOpen = false;
  let sawOverlayOpen = false;
  let sawOverlayClose = false;
  let sawBefore = false;
  let sawAfter = false;
  const observeOverlay = () => {
    assert(p.overlay === -1 || p.overlay === FADE_TO_WHITE,
      `${label}: the native overlay is exactly closed or fade_to_white`);
    if (p.overlay === FADE_TO_WHITE && !overlayOpen) {
      assert(!sawOverlayOpen, `${label}: the native white overlay opens only once`);
      assert.deepEqual(tile(p), [before.level, before.x, before.z],
        `${label}: the white overlay opens at the exact pre-transfer stand`);
      overlayOpen = true;
      sawOverlayOpen = true;
    } else if (p.overlay === -1 && overlayOpen) {
      assert(sawBefore && sawAfter, `${label}: the white overlay closes only after the covered transfer`);
      assert.deepEqual(tile(p), [after.level, after.x, after.z],
        `${label}: the white overlay closes at the exact transferred stand`);
      overlayOpen = false;
      sawOverlayClose = true;
    }
  };
  const record = () => {
    observeOverlay();
    if (overlayOpen && !sawBefore && p.level === before.level && p.x === before.x && p.z === before.z) {
      assertSceneMappingWindow(p, before, allowed, `${label}: exact unbridged stand during the white overlay`);
      // This short staging move need not cross the native rebuild threshold.
      // Check the actual unforced build origin, not an invented centered packet.
      p.buildArea.rebuild();
      const buildOrigin = { level: p.level, x: p.originX, z: p.originZ };
      assertSceneMappingWindow(p, buildOrigin, allowed, `${label}: actual pre-transfer build area`, true);
      sawBefore = true;
    }
    if (overlayOpen && !sawAfter && p.level === after.level && p.x === after.x && p.z === after.z) {
      assertSceneMappingWindow(p, after, allowed, `${label}: exact bridged stand before overlay removal`, true);
      sawAfter = true;
    }
  };
  for (let tick = 0; tick < 1200; tick++) {
    record();
    const state = p.activeScript;
    if (state?.execution === ScriptState.PAUSEBUTTON) {
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      assert(!/^multi[2-5]$/.test(root), `${label}: no unanswered dialogue choice`);
      dialoguePage(p);
      resumeDialogue(p);
      continue;
    }
    worldTick();
    record();
    if (stage(p) === HOPE_CLEAR_STAGE && p.queue.head() === null
      && (!p.activeScript || p.activeScript.execution === ScriptState.FINISHED)) break;
  }
  assert(sawOverlayOpen, `${label}: the compiled fade_to_white overlay opens`);
  assert(sawOverlayClose, `${label}: the compiled scene closes the white overlay after transfer`);
  assert(sawBefore, `${label}: actual player occupies the source stand under the white overlay`);
  assert(sawAfter, `${label}: actual player occupies the copied stand under the white overlay`);
  assert.equal(p.overlay, -1, `${label}: the native overlay is closed when the bridge scene finishes`);
  assert.equal(after.level, before.level, `${label}: transfer preserves the original collision plane`);
  assert.equal(after.z, before.z, `${label}: transfer preserves the exact north coordinate`);
  assert.equal(after.x, before.x - questConstant('soulbane_hope_copy_offset'),
    `${label}: native transfer moves exactly 64 tiles west`);
  const afterZoneX = after.x >> 3;
  const afterZoneZ = after.z >> 3;
  assert(p.packets.slice(packetMark).some(packet => packet instanceof RebuildRegion
    && packet.zoneX === afterZoneX && packet.zoneZ === afterZoneZ),
  `${label}: the real 64-west move emits a centered native RebuildRegion`);
  assert.equal(stage(p), HOPE_CLEAR_STAGE, `${label}: only bridge presentation commits boundary 9`);
  assert.equal(readVar(p, 'soulbane_hope_bridgepres'), 1, `${label}: bridge-presence is recorded after presentation`);
  assert.deepEqual({ level: p.level, x: p.x, z: p.z }, after, `${label}: the player remains at the exact bridged landing`);
  assert.equal(readVar(p, 'soulbane_hope_killedtally'), questConstant('soulbane_hope_creatures'),
    `${label}: exactly five unique final-life deaths are preserved`);
  assert.equal(hopeNpcsFor(p).length, 0, `${label}: no Hope attacker remains`);
  assert.deepEqual(xpSnapshot(p), xpBefore, `${label}: bridge presentation adds no quest-scene XP`);
  assert.equal(readVar(p, 'qp'), qpBefore, `${label}: stage 9 grants no quest points`);
  assert.equal(count(p, 'coins'), coinsBefore, `${label}: stage 9 grants no completion coins`);
}
function testForeignLaterRoomPackets(owner, actors, label) {
  const intruder = playerFixture();
  seed(intruder, ['airrune', 'mindrune']);
  const beforeInventory = inventory(intruder);
  const beforeXp = xpSnapshot(intruder);
  const ownerStage = stage(owner);
  const ownerInstance = instanceUid(owner);
  const windStrike = requiredId('Component', 'magic:wind_strike');
  assert(intruder.isComponentVisible(types.Component.get(windStrike)), `${label}: foreign spell control is visible`);
  for (const actor of actors) {
    const hp = actor.levels[HP_STAT];
    const actorOwner = actor.vars[NPC_OWNER];
    const actorInstance = actor.vars[NPC_INSTANCE];
    assert.equal(runProcInt('npc_is_attackable', intruder, [], actor), 0,
      `${label}: foreign melee admission rejects ${types.NpcType.get(actor.type).debugname}`);
    assert.equal(runProcInt('npc_is_attackable_opt', intruder, [], actor), 0,
      `${label}: foreign optional/spell admission rejects the same actor`);
    for (const spell of [0, 1]) {
      assert.equal(runProcInt('npc_max_dealt', intruder, [100, spell], actor), 0,
        `${label}: foreign melee/ranged/spell damage is zero before XP`);
    }
    World.processInfo();
    rsbuf.npcInfo(0, intruder.slot, 0, 0, true);
    assert.equal(rsbuf.hasNpc(intruder.slot, actor.nid), false, `${label}: foreign actor is never rendered`);
    intruder.clearInteraction();
    assert.equal(OpNpcHandler.handle(new OpNpc(2, actor.nid), intruder), false, `${label}: foreign Attack packet is rejected`);
    assert.equal(OpNpcUHandler.handle(
      new OpNpcU(actor.nid, obj('airrune'), slotOf(intruder, 'airrune'), invCom), intruder), false,
    `${label}: foreign Use packet is rejected`);
    assert.equal(OpNpcTHandler.handle(new OpNpcT(actor.nid, windStrike), intruder), false,
      `${label}: foreign Cast packet is rejected`);
    assert.equal(actor.levels[HP_STAT], hp, `${label}: rejected packets preserve actor HP`);
    assert.equal(actor.vars[NPC_OWNER], actorOwner, `${label}: rejected packets preserve actor owner`);
    assert.equal(actor.vars[NPC_INSTANCE], actorInstance, `${label}: rejected packets preserve actor instance`);
  }
  assert.deepEqual(inventory(intruder), beforeInventory, `${label}: rejected packets consume no ordinary runes`);
  assert.deepEqual(xpSnapshot(intruder), beforeXp, `${label}: rejected packets award no XP`);
  assert.equal(stage(owner), ownerStage, `${label}: rejected packets preserve owner stage`);
  assert.equal(instanceUid(owner), ownerInstance, `${label}: rejected packets preserve owner copy`);
  intruder.requestLogout = true;
  worldTick();
  assert(![...World.playerLoop.all()].includes(intruder), `${label}: the foreign negative-control account logs out normally`);
}

function assertConfusionNativeGates(p, actor, label, isIllusion = false) {
  assert.equal(runProcInt('soulbane_confusion_attackable', p, [], actor), 1,
    `${label}: owner Confusion actor admits this stage-six account`);
  assert.equal(runProcInt('npc_is_attackable', p, [], actor), 1,
    `${label}: native melee attackability includes the owner-bound Confusion gate`);
  assert.equal(runProcInt('npc_is_attackable_opt', p, [], actor), 1,
    `${label}: native optional/magic attackability includes the owner-bound Confusion gate`);
  if (isIllusion) {
    for (const spell of [0, 1]) {
      assert.equal(runProcInt('npc_max_dealt', p, [37, spell], actor), 37,
        `${label}: admitted melee/ranged/spell hits retain the ordinary pre-XP maximum`);
    }
  }
}
function testConfusionIllusionXp() {
  // Disclosed isolated numeric fixture: stage/rope and combat inputs only.
  // Entry creates the actors; both XP awards use the same compiled melee label.
  const p = playerFixture();
  writeVar(p, 'soulbane_prog', CONFUSION_STAGE);
  writeVar(p, 'soulbane_riftrope_pres', 1);
  chooseRiftWithRope(p, 'disclosed Confusion XP comparison fixture');
  try {
    const actors = confusionNpcsFor(p);
    const real = actors.find(npc => npc.type === requiredId('NpcType', 'soulbane_confu_creeper'));
    const fake = actors.find(npc => npc.type !== real?.type);
    assert(real && fake, 'numeric comparison uses product-spawned ordinary and illusion beasts');
    for (let tick = 0; tick < 32 && [real, fake].some(npc => npc.vars[NPC_XP_MULTIPLIER] !== 1000); tick++) worldTick();
    for (const target of [real, fake]) {
      assert.equal(target.vars[NPC_XP_MULTIPLIER], 1000, 'native spawn hook initializes the ordinary combat-XP multiplier');
      assert.equal(runProcInt('npc_is_attackable', p, [], target), 1, 'numeric reference target passes the real owner/stage gate');
    }
    assert.equal(real.levels[NpcStat.DEFENCE], fake.levels[NpcStat.DEFENCE],
      'ordinary and illusion reference targets have identical defence');
    assert.equal(real.levels[HP_STAT], fake.levels[HP_STAT],
      'ordinary and illusion reference targets have the same remaining hitpoint cap');
    const fixtureMaxHit = 7;
    const deltas = [];
    for (const target of [real, fake]) {
      for (const [name, value] of Object.entries({
        action_delay: 0, damagestyle: 0, damagetype: 0,
        com_stabattack: 1000000, com_maxhit: fixtureMaxHit
      })) writeVar(p, name, value);
      const before = xpSnapshot(p);
      stableHitRandom(() => execute('[label,player_melee_attack]', p, [], { target }));
      deltas.push(xpSnapshot(p).map((value, skill) => value - before[skill]));
      p.clearInteraction();
    }
    assert(deltas[0].some(value => value > 0), 'ordinary reference hit awards nonzero combat experience');
    assert.deepEqual(deltas[1], deltas[0],
      'the same native roll against the same defence awards exactly ordinary combat and Hitpoints XP');
    for (let tick = 0; tick < 3; tick++) worldTick();
    assert.equal(real.levels[HP_STAT], 28 - fixtureMaxHit, 'ordinary reference hit applies its rolled damage');
    assert.equal(fake.levels[HP_STAT], 28, 'illusion applies no damage despite its ordinary rolled-hit XP');
    assert.equal(fake.vars[CONFUSION_HITS], 1, 'the XP-bearing illusion hit counts once, not as a real kill');
    runProc('npc_poison_start', p, [7], fake);
    assert.equal(fake.vars[NPC_POISON], 7, 'native poisoned-weapon input reaches the quest NPC timer');
    const name = types.NpcType.get(fake.type).debugname;
    execute(`[ai_timer,${name}]`, p, [], { target: fake });
    assert.equal(fake.vars[NPC_POISON], 0, 'compiled quest poison timer clears poison without a damage tick');
    assert.equal(fake.levels[HP_STAT], 28, 'poison cannot bypass the illusion zero-damage rule');
  } finally {
    p.requestLogout = true;
    for (let tick = 0; tick < 4 && [...World.playerLoop.all()].includes(p); tick++) worldTick();
    assert(![...World.playerLoop.all()].includes(p), 'numeric fixture leaves through ordinary logout cleanup');
  }
}
function prepareConfusionTarget(p, label) {
  const realType = requiredId('NpcType', 'soulbane_confu_creeper');
  let target = null;
  for (let approach = 0; approach < 16; approach++) {
    const actors = confusionNpcsFor(p);
    assert(actors.length > 0, `${label}: an owner-bound creature remains`);
    const aggressor = actors.find(npc => (npc.uid >>> 0) === (p.getVar(PLAYER_AGGRESSIVE_NPC) >>> 0));
    target = aggressor ?? (target?.isActive ? target : actors.find(npc => npc.type !== realType) ?? actors[0]);
    // The creature can move during this walk; re-check its current position below.
    moveToTile(p, findStand(p, target), `${label}: ordinary approach ${approach + 1}`);
    const current = confusionNpcsFor(p)
      .find(npc => (npc.uid >>> 0) === (p.getVar(PLAYER_AGGRESSIVE_NPC) >>> 0));
    // Respect the combat opponent that actually reached us during walking.
    if (current && current !== target) { target = current; continue; }
    if (p.inOperableDistance(target)) return target;
  }
  assert.fail(`${label}: ordinary walking never settles beside the current single-combat opponent`);
}
function testConfusionIllusion(p, fake) {
  const actors = confusionNpcsFor(p);
  assertOwnedQuestActors(p, actors, actors.length, 'remaining stage-six Confusion group');
  const realType = requiredId('NpcType', 'soulbane_confu_creeper');
  const real = actors.find(npc => npc.type === realType);
  assert(real && actors.includes(fake) && fake.type !== realType,
    'the current single-combat opponent is one of the remaining illusions');
  assert.equal(actors.filter(npc => npc.type === realType).length, 1, 'the group retains exactly one real beast');
  assert.equal(fake.vars[CONFUSION_HITS], 0, 'an untested illusion begins with no produced hit count');
  assertConfusionNativeGates(p, real, 'real Confusion beast');
  assertConfusionNativeGates(p, fake, 'Confusion illusion', true);
  const creditsBefore = confusionKillCount(p), messageMark = p.messages.length;
  const hallucinationMessages = () => p.messages.slice(messageMark)
    .filter(text => text === 'Those other monsters were just hallucinations!');
  const visibleHits = [];
  const disappearanceMessages = () => p.messages.slice(messageMark)
    .filter(text => text === 'Does this creature really exist?' || text === "That monster wasn't even real!");
  const observeNpcInfo = () => {
    if (!fake.isActive) return;
    const damages = [];
    if (fake.masks & rsbuf.NpcInfoProt.DAMAGE) damages.push(fake.hitmarkDamage);
    if (fake.masks & rsbuf.NpcInfoProt.DAMAGE2) damages.push(fake.hitmark2Damage);
    if (!damages.length) return;
    const packet = rsbuf.npcInfo(0, p.slot, 0, 0, true);
    assert(packet.length > 0 && rsbuf.hasNpc(p.slot, fake.nid),
      'native NPC info retains the illusion while serializing each zero hit');
    assert.deepEqual(damages, [0], 'each native illusion update contains exactly one zero-damage hit');
    visibleHits.push({ tick: World.currentTick, hits: fake.vars[CONFUSION_HITS] });
  };
  const removeNpc = World.removeNpc;
  let removals = 0;
  World.removeNpc = function (npc, ...args) {
    if (npc === fake) {
      assert.equal(disappearanceMessages().length, 0, 'the disappearance message follows native removal');
      removals++;
    }
    return removeNpc.call(this, npc, ...args);
  };
  try {
    for (let hit = 0; hit < questConstant('soulbane_confusion_zero_hits'); hit++) {
      const previous = fake.vars[CONFUSION_HITS];
      const xpBefore = xpSnapshot(p);
      stableHitRandom(() => runNativeAttack(p, fake, `Confusion illusion zero hit ${hit + 1}`, 120, false,
        () => !fake.isActive || fake.vars[CONFUSION_HITS] > previous, observeNpcInfo));
      assert.equal(fake.vars[CONFUSION_HITS], previous + 1,
        `illusion hit ${hit + 1} reaches the native per-NPC zero-damage counter`);
      assert.equal(fake.levels[HP_STAT], 28, `illusion hit ${hit + 1} leaves its 28 HP untouched`);
      assert(xpSnapshot(p).some((value, skill) => value > xpBefore[skill]),
        `illusion hit ${hit + 1} grants ordinary rolled-hit experience while applying zero damage`);
      assert.equal(stage(p), CONFUSION_STAGE, `illusion hit ${hit + 1} cannot advance stage 6`);
      assert.equal(confusionKillCount(p), creditsBefore, `illusion hit ${hit + 1} earns no real-kill credit`);
      assert(fake.isActive, `illusion remains in native NPC info through zero-damage hit ${hit + 1}`);
    }
    assert.deepEqual(visibleHits.map(hit => hit.hits), [1, 2, 3, 4, 5, 6, 7, 8],
      'all eight native zero hits reach NPC info before the illusion is removed');
    const deathSource = fs.readFileSync(path.join(contentRoot, 'scripts/skill_combat/scripts/npc/npc_death.rs2'), 'utf8');
    const deathDelay = /npc_delay\((\d+)\)/.exec(deathSource);
    assert(deathDelay, 'the published NPC death path supplies its final-hit removal delay');
    const removalTicks = questConstant('soulbane_confusion_removal_ticks');
    assert.equal(removalTicks, Number(deathDelay[1]), 'illusion removal uses the published NPC death delay');
    assert.equal(fake.delayed, true, 'the eighth-hit illusion is suspended until its final update is delivered');
    // Native NPC_DELAY resumes at currentTick + 1 + its script operand.
    assert.equal(fake.delayedUntil - visibleHits.at(-1).tick, removalTicks + 1,
      'removal follows the published delay through the native NPC clock conversion');
    assert.equal(fake.vars[NPC_INSTANCE], 0, 'the eighth hit consumes admission before the delivery delay');
    assert.equal(removals, 0, 'the eighth-hit update precedes the one native removal');
    assert.equal(disappearanceMessages().length, 0, 'the message still follows removal rather than the eighth hit');
    for (const gate of ['soulbane_confusion_attackable', 'npc_is_attackable', 'npc_is_attackable_opt']) {
      assert.equal(runProcInt(gate, p, [], fake), 0, `${gate} rejects the suspended eighth-hit illusion`);
    }
    const xpAfterEight = xpSnapshot(p), hpAfterEight = p.levels[PlayerStat.HITPOINTS];
    p.clearInteraction();
    assert.equal(OpNpcHandler.handle(new OpNpc(2, fake.nid), p), false,
      'the ninth Attack packet is rejected by native suspended-NPC admission before combat dispatch');
    p.processInteraction();
    assert.deepEqual(xpSnapshot(p), xpAfterEight, 'the rejected ninth attack grants no XP');
    assert.equal(fake.vars[CONFUSION_HITS], 8, 'the rejected ninth attack produces no extra hit');
    for (let tick = 0; tick < removalTicks; tick++) {
      worldTick(null, observeNpcInfo);
      assert(fake.isActive && fake.delayed, 'the native delay retains a suspended, visible illusion');
      assert.equal(fake.vars[CONFUSION_HITS], 8, 'the delayed illusion cannot count another hit');
      assert.equal(p.levels[PlayerStat.HITPOINTS], hpAfterEight, 'the illusion does not attack during the held tick');
      assert.deepEqual(xpSnapshot(p), xpAfterEight, 'the held tick awards no additional combat XP');
      assert.equal(removals, 0, 'native removal does not precede the full published delay');
      assert.equal(disappearanceMessages().length, 0, 'the message does not precede native removal');
    }
    worldTick(null, observeNpcInfo);
    assert.equal(fake.isActive, false, 'native resume removes the illusion after the final-hit delivery interval');
    assert.equal(p.levels[PlayerStat.HITPOINTS], hpAfterEight, 'the suspended illusion never attacks during its delay');
    assert.equal(removals, 1, 'the illusion is removed exactly once');
    assert.equal(disappearanceMessages().length, 1, 'the illusion emits exactly one sourced disappearance message');
    assert.equal(confusionNpcsFor(p).length, actors.length - 1,
      'illusion removal removes only that actor without a group respawn');
    p.clearInteraction();
    worldTick(null, observeNpcInfo);
    assert.equal(fake.vars[CONFUSION_HITS], 8, 'native resume cannot count a ninth hit');
    assert.equal(visibleHits.length, 8, 'no extra hit update is emitted during or after the removal delay');
    assert.equal(removals, 1, 'later native processing cannot remove the illusion twice');
    assert.equal(disappearanceMessages().length, 1, 'later native processing cannot repeat its message');
    assert.deepEqual(xpSnapshot(p), xpAfterEight, 'the removal interval awards no further combat XP');
    assert.equal(confusionKillCount(p), creditsBefore, 'delayed removal still earns no real-kill credit');
    assert.equal(hallucinationMessages().length, 0,
      'an illusion vanishing never emits the real-kill hallucination message');
  } finally {
    World.removeNpc = removeNpc;
  }
}
function killConfusionReal(p, npc, ordinal) {
  assert.equal(npc.type, requiredId('NpcType', 'soulbane_confu_creeper'),
    `real Confusion kill ${ordinal} targets the only genuine creature`);
  assert.equal(npc.vars[NPC_OWNER] >>> 0, p.uid, `real Confusion kill ${ordinal} remains owner-bound`);
  assert.equal(npc.vars[NPC_INSTANCE], instanceUid(p), `real Confusion kill ${ordinal} remains copy-bound`);
  const messageMark = p.messages.length;
  let hits = 0;
  while (npc.isActive && npc.levels[HP_STAT] > 0) {
    assert(hits < 48, `real Confusion kill ${ordinal} can finish the 28-HP beast`);
    stableHitRandom(() => runNativeAttack(p, npc, `real Confusion kill ${ordinal} native hit ${hits + 1}`, 120, true));
    hits++;
  }
  assert(hits > 0, `real Confusion kill ${ordinal} requires ordinary native player combat`);
  for (let tick = 0; tick < 256 && confusionKillCount(p) !== ordinal; tick++) worldTick();
  assert.equal(confusionKillCount(p), ordinal, `real Confusion kill ${ordinal} queues exactly one sequential credit`);
  assert.equal(npc.vars[NPC_INSTANCE], 0,
    `real Confusion kill ${ordinal} consumes the NPC instance marker before its queued credit`);
  assert.equal(stage(p), CONFUSION_STAGE, `real Confusion kill ${ordinal} leaves scene completion for the fifth credit`);
  assertConfusionKillFlags(p, ordinal, `real Confusion kill ${ordinal}`);
  for (let tick = 0; tick < 16; tick++) worldTick();
  assert.equal(confusionKillCount(p), ordinal, `real Confusion kill ${ordinal} cannot duplicate after queues settle`);
  assert.equal(p.messages.slice(messageMark).filter(text => text === 'Those other monsters were just hallucinations!').length, 1,
    `real Confusion kill ${ordinal} emits the sourced game message exactly once`);
  if (ordinal < questConstant('soulbane_confusion_real_kills')) {
    let actors = confusionNpcsFor(p);
    for (let tick = 0; tick < 32 && actors.length !== 5; tick++) {
      worldTick();
      actors = confusionNpcsFor(p);
    }
    assertOwnedQuestActors(p, actors, 5, `real Confusion kill ${ordinal} respawned group`);
    assert.equal(actors.filter(actor => actor.type === requiredId('NpcType', 'soulbane_confu_creeper')).length, 1,
      `real Confusion kill ${ordinal} respawns one new genuine beast`);
  } else {
    assert.equal(confusionNpcsFor(p).length, 0, 'fifth real Confusion kill starts the cutscene without a respawn');
  }
}
function assertHopeNativeGates(p, npc, label) {
  assert.equal(runProcInt('soulbane_hope_attackable', p, [], npc), 1,
    `${label}: the actual owner-copy Hope NPC admits stage-eight combat`);
  assert.equal(runProcInt('npc_is_attackable', p, [], npc), 1,
    `${label}: native melee attackability includes the Hope gate`);
  assert.equal(runProcInt('npc_is_attackable_opt', p, [], npc), 1,
    `${label}: native optional/magic attackability includes the Hope gate`);
}
function waitForHopeAggressor(p, label) {
  let target = null;
  for (let tick = 0; tick < 256 && !target; tick++) {
    const uid = p.getVar(PLAYER_AGGRESSIVE_NPC);
    target = hopeNpcsFor(p).find(npc => npc.uid === uid) ?? null;
    if (!target) worldTick();
  }
  assert(target, `${label}: an actual owner-bound Hope NPC becomes the player's current combat opponent; ${JSON.stringify({
    player: { uid: p.uid, tile: tile(p), opponent: p.getVar(PLAYER_AGGRESSIVE_NPC), lastCombat: p.getVar(PLAYER_LAST_COMBAT), tick: World.currentTick },
    npcs: hopeNpcsFor(p).map(npc => ({ uid: npc.uid, nid: npc.nid, type: npc.type, tile: [npc.level, npc.x, npc.z],
      mode: npc.mode, target: npc.target?.uid, delayed: npc.delayed,
      attacker: npc.vars[requiredId('VarNpcType', 'npc_attacking_uid')], owner: npc.vars[NPC_OWNER] }))
  })}`);
  const elapsed = World.currentTick - p.getVar(PLAYER_LAST_COMBAT);
  assert(elapsed >= 0 && elapsed < questConstant('soulbane_hope_combat_ticks'),
    `${label}: the native last-combat timestamp is inside the eight-tick window`);
  assert.equal(target.vars[NPC_INSTANCE], instanceUid(p), `${label}: selected opponent belongs to this instance`);
  assert.equal(target.vars[NPC_OWNER] >>> 0, p.uid, `${label}: selected opponent belongs to this account`);
  return target;
}
function awaitPlayerActionReady(p, label) {
  for (let tick = 0; tick < 16 && p.delayed; tick++) worldTick();
  assert.equal(p.delayed, false, `${label}: ordinary action delay has settled`);
}
function testHopeNativeRangedDelay() {
  const label = 'Hope native ranged action delay';
  const p = laterRoomFixture(HOPE_STAGE, `${label}: disclosed active-stage fixture`);
  writeVar(p, 'option_nodef', 1);
  const target = [...hopeNpcsFor(p)].sort((a, b) =>
    Math.abs(a.x - p.x) + Math.abs(a.z - p.z) - Math.abs(b.x - p.x) - Math.abs(b.z - p.z))[0];
  assert(target, `${label}: one product-spawned Hope creature is present`);
  assert.equal(target.type, requiredId('NpcType', HOPE_TYPES[0]),
    `${label}: the observed first life is the authored ranged attacker`);
  const attackRate = types.NpcType.get(target.type).params.get(ATTACK_RATE_PARAM);
  assert(Number.isInteger(attackRate) && attackRate > 0,
    `${label}: packed native attackrate is a positive integer`);
  const previousDelay = target.vars[NPC_ACTION_DELAY];
  const startTick = World.currentTick;
  withCombatRandom(0.5, () => runNativeAttack(p, target, `${label}: real player starts native combat`, 120, true));
  assert.equal(waitForHopeAggressor(p, label), target,
    `${label}: the actual Hope aggressor remains the ranged-delay subject`);
  for (let tick = 0; tick < 64
    && !(Number.isInteger(target.vars[NPC_ACTION_DELAY])
      && target.vars[NPC_ACTION_DELAY] > startTick
      && target.vars[NPC_ACTION_DELAY] !== previousDelay); tick++) worldTick();
  const scheduled = target.vars[NPC_ACTION_DELAY];
  assert(Number.isInteger(scheduled) && scheduled > startTick,
    `${label}: native ranged action writes a future npc_action_delay`);
  assert.notEqual(scheduled, previousDelay,
    `${label}: real combat schedules a new ranged action rather than reusing spawn delay`);
  const rangedAt = scheduled - attackRate;
  assert(rangedAt >= startTick && rangedAt <= World.currentTick,
    `${label}: stored delay decodes to an observed ranged-action tick`);
  assert.equal(scheduled, rangedAt + attackRate,
    `${label}: cooldown is exactly the source NPC's packed attackrate`);
  assert.equal(target.type, requiredId('NpcType', HOPE_TYPES[0]),
    `${label}: action remains the ranged first life rather than a later melee-wait form`);
  console.log(`Hope ranged delay ${JSON.stringify({ attackRate, rangedAt, scheduled })}`);
  leaveQuestRoom(p, `${label} native cleanup`);
  p.requestLogout = true;
  worldTick();
}

function testHopeFoodDispatch(p) {
  const label = 'Hope native food dispatch';
  const spawned = hopeNpcsFor(p);
  assertOwnedQuestActors(p, spawned, 5, `${label} initial group`);
  for (const npc of spawned) {
    assert.equal(npc.type, requiredId('NpcType', HOPE_TYPES[0]), `${label}: every fresh creature begins on life three`);
    assert.equal(npc.levels[HP_STAT], 21, `${label}: each fresh Hope creature starts at its authored 21 HP`);
  }
  // The level-126 combat fixture is above the native ranged hunt's
  // not-too-strong threshold. Start combat by an ordinary player Attack.
  const nearest = [...spawned].sort((a, b) =>
    Math.abs(a.x - p.x) + Math.abs(a.z - p.z) - Math.abs(b.x - p.x) - Math.abs(b.z - p.z))[0];
  moveToTile(p, findStand(p, nearest), `${label}: ordinary approach to the first opponent`);
  withCombatRandom(0.5, () => runNativeAttack(p, nearest,
    `${label}: player initiates ordinary combat`, 120, true));
  const target = waitForHopeAggressor(p, label);
  assertHopeNativeGates(p, target, label);

  const teaBefore = target.levels[HP_STAT];
  assert.equal(p.invAdd(inv, obj('cup_of_tea'), 1), 1, `${label}: seed only one ordinary tea for the negative control`);
  awaitPlayerActionReady(p, `${label} tea negative control`);
  consumeNativeOp1(p, 'cup_of_tea', `${label} excluded tea`);
  assert.equal(target.levels[HP_STAT], teaBefore, `${label}: drinking tea never heals the Hope opponent`);

  let attacks = 0;
  while (target.isActive && target.levels[HP_STAT] > 12) {
    assert(attacks < 48, `${label}: native combat can lower one life without killing it`);
    awaitPlayerActionReady(p, `${label} native Attack ${attacks + 1}`);
    const beforeType = target.type;
    withCombatRandom(0.5, () => runNativeAttack(p, target, `${label} native Attack ${attacks + 1}`, 120, true,
      () => target.type !== beforeType || !target.isActive));
    attacks++;
  }
  assert(target.isActive && target.levels[HP_STAT] > 0 && target.levels[HP_STAT] <= 12,
    `${label}: a real native hit leaves a nonlethal partially depleted opponent`);
  assert.equal(p.getVar(PLAYER_AGGRESSIVE_NPC), target.uid,
    `${label}: food opponent is the player's current native aggressive_npc`);
  assert(World.currentTick - p.getVar(PLAYER_LAST_COMBAT) < questConstant('soulbane_hope_combat_ticks'),
    `${label}: food use follows an actual opponent hit inside the authored combat window`);

  const beforeHp = target.levels[HP_STAT];
  const maximumHp = target.baseLevels[HP_STAT];
  const expectedHp = Math.min(maximumHp, beforeHp + Math.floor(beforeHp * questConstant('soulbane_hope_food_percent') / 100));
  assert.equal(p.invAdd(inv, obj('bread'), 1), 1, `${label}: seed one ordinary food item`);
  awaitPlayerActionReady(p, `${label} bread dispatch`);
  const trigger = consumeNativeOp1(p, 'bread', `${label} actual food`);
  assert.match(trigger.name, /^\[opheld1,/i, `${label}: bread is dispatched through the native opheld1 trigger`);
  assert.equal(target.levels[HP_STAT], expectedHp,
    `${label}: actual food heals only current combat opponent by 75% of its current HP, capped at base`);
  assert.equal(target.levels[HP_STAT], Math.min(maximumHp, beforeHp + Math.floor(beforeHp * 75 / 100)),
    `${label}: compiled food helper uses the specified current-HP integer restoration`);
  return target;
}
function awaitHopeAttackReady(p, npc, label) {
  const blocked = () => p.delayed || npc.delayed
    || (p.getVar(PLAYER_AGGRESSIVE_NPC) !== npc.uid
      && World.currentTick - p.getVar(PLAYER_LAST_COMBAT) < questConstant('soulbane_hope_combat_ticks'));
  for (let tick = 0; tick < 16 && blocked(); tick++) worldTick();
  assert(!blocked(), `${label}: native delay and old-form single-combat cooldown expire before Attack`);
}

function killHopeCreature(p, npc, ordinal) {
  assert(hopeNpcsFor(p).includes(npc), `Hope kill ${ordinal} targets one of five distinct owned creatures`);
  const originalNid = npc.nid;
  const tallyBefore = readVar(p, 'soulbane_hope_killedtally');
  assert.equal(tallyBefore, ordinal - 1, `Hope kill ${ordinal} begins after the previous unique death credit`);
  const startingLife = HOPE_TYPES.findIndex(name => requiredId('NpcType', name) === npc.type);
  assert(startingLife >= 0, `Hope kill ${ordinal} starts on an authentic native life`);
  assert(npc.levels[HP_STAT] > 0 && npc.levels[HP_STAT] <= 21,
    `Hope kill ${ordinal} starts with positive HP on its current life`);
  assert.equal(npc.vars[NPC_INSTANCE], instanceUid(p), `Hope kill ${ordinal} retains its private-copy marker`);
  assert.equal(npc.vars[NPC_OWNER] >>> 0, p.uid, `Hope kill ${ordinal} retains its owner marker`);

  let bridgePacketMark = null;
  for (let life = startingLife; life < HOPE_TYPES.length; life++) {
    if (ordinal === questConstant('soulbane_hope_creatures') && life === HOPE_TYPES.length - 1) {
      bridgePacketMark = p.packets.length;
    }
    const type = requiredId('NpcType', HOPE_TYPES[life]);
    assert.equal(npc.type, type, `Hope creature ${ordinal} life ${life + 1} uses its native morph`);
    if (life === startingLife) assert(npc.levels[HP_STAT] > 0 && npc.levels[HP_STAT] <= 21,
      `Hope creature ${ordinal} initial life has only its observed remaining HP`);
    else assert.equal(npc.levels[HP_STAT], 21, `Hope creature ${ordinal} life ${life + 1} has 21 HP`);
    assert.equal(readVar(p, 'soulbane_hope_killedtally'), tallyBefore,
      `Hope creature ${ordinal} does not earn death credit before its final life`);
    let hits = 0;
    while (npc.isActive && npc.levels[HP_STAT] > 0) {
      assert(hits < 48, `Hope creature ${ordinal} life ${life + 1} can be defeated by native attacks`);
      awaitHopeAttackReady(p, npc, `Hope creature ${ordinal} life ${life + 1}`);
      stableHitRandom(() => runNativeAttack(p, npc,
        `Hope creature ${ordinal} life ${life + 1} native hit ${hits + 1}`, 120, true));
      hits++;
    }
    assert(hits > 0, `Hope creature ${ordinal} life ${life + 1} requires an actual native hit`);
    if (life === HOPE_TYPES.length - 1) assert.equal(p.overlay, -1,
      `Hope final death ${ordinal}: no flash precedes its native death credit`);
    if (life < HOPE_TYPES.length - 1) {
      for (let tick = 0; tick < 256 && npc.isActive && npc.type === type; tick++) worldTick();
      assert(npc.isActive, `Hope creature ${ordinal} remains after a nonfinal life`);
      assert.equal(npc.type, requiredId('NpcType', HOPE_TYPES[life + 1]),
        `Hope creature ${ordinal} morphs to life ${life + 2} instead of earning a kill`);
      assert.equal(npc.levels[HP_STAT], 21, `Hope creature ${ordinal} restores 21 HP on morph`);
      assert.equal(npc.vars[NPC_POISON], 0, `Hope creature ${ordinal} clears poison on morph`);
      assert(npc.vars[HOPE_MELEE_UNTIL] >= World.currentTick + questConstant('soulbane_hope_melee_wait_ticks') - 1,
        `Hope creature ${ordinal} starts the later-life melee wait after retreat`);
      if (ordinal === 1) testForeignLaterRoomPackets(p, [npc], `Hope life ${life + 2}`);
      assert.equal(readVar(p, 'soulbane_hope_killedtally'), tallyBefore,
        `Hope creature ${ordinal} receives no credit for a life morph`);
    } else {
      for (let tick = 0; tick < 256 && readVar(p, 'soulbane_hope_killedtally') !== ordinal; tick++) worldTick();
      assert.equal(readVar(p, 'soulbane_hope_killedtally'), ordinal,
        `Hope creature ${ordinal} final death queues one credit for the current instance`);
      assert.equal(npc.vars[NPC_INSTANCE], 0,
        `Hope creature ${ordinal} credited final death has consumed its instance marker`);
    }
  }
  assert.equal(npc.nid, originalNid, `Hope kill ${ordinal} credits the same NPC slot through its native UID-changing morphs`);
  if (ordinal < questConstant('soulbane_hope_creatures')) {
    for (let tick = 0; tick < 16; tick++) worldTick();
    assert.equal(readVar(p, 'soulbane_hope_killedtally'), ordinal,
      `Hope kill ${ordinal} cannot duplicate its final-life credit`);
  }
  assert.equal(stage(p), HOPE_STAGE, `Hope kill ${ordinal} leaves boundary 9 for the bridge scene`);
  if (ordinal < questConstant('soulbane_hope_creatures')) {
    assert.equal(hopeNpcsFor(p).length, 5 - ordinal,
      `Hope kill ${ordinal} removes one distinct creature without respawn`);
  }
  return bridgePacketMark;
}

function laterLifecycle(p, expectedStage, label, death = false) {
  const uid = instanceUid(p);
  assert(uid > 0, `${label}: lifecycle begins inside its owned copy`);
  const beforeXp = xpSnapshot(p);
  const beforeQp = readVar(p, 'qp');
  if (death) {
    // Disclosed lethal player input; the product's own death queue does cleanup.
    p.levels[PlayerStat.HITPOINTS] = 0;
    runProc('player_die', p);
    for (let tick = 0; tick < 80 && (p.activeScript || p.queue.head() !== null); tick++) worldTick();
    for (let tick = 0; tick < 3; tick++) worldTick();
    assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED,
      `${label}: ordinary death and respawn settle`);
  } else {
    p = nativeLogoutAndReload(p, label);
    assert.deepEqual(tile(p), surfaceTile(), `${label}: real save/reload uses the copy's surface exit`);
  }
  assert.equal(stage(p), expectedStage, `${label}: permanent progress survives`);
  assert.equal(instanceUid(p), 0, `${label}: disposable instance handle is cleared`);
  assert.equal(World.instances.findInstanceByUid(uid - 1), null, `${label}: old private region is deleted`);
  assert.equal(remainingNpcsWithInstance(uid).length, 0, `${label}: old encounter actors are removed`);
  assert.deepEqual(xpSnapshot(p), beforeXp, `${label}: cleanup grants no extra XP`);
  assert.equal(readVar(p, 'qp'), beforeQp, `${label}: cleanup grants no quest points`);
  if (expectedStage === CONFUSION_STAGE || expectedStage === CONFUSION_CLEAR_STAGE) {
    const kills = expectedStage === CONFUSION_CLEAR_STAGE ? 5 : 0;
    assertConfusionKillFlags(p, kills, label);
    assert.equal(readVar(p, 'soulbane_confu_door6open'), Number(kills === 5),
      `${label}: incomplete doors reset and the cleared sixth door survives`);
  } else {
    const cleared = expectedStage === HOPE_CLEAR_STAGE;
    assert.equal(readVar(p, 'soulbane_hope_killedtally'), cleared ? 5 : 0,
      `${label}: partial Hope kills reset but five completed kills survive`);
    assert.equal(readVar(p, 'soulbane_hope_bridgepres'), Number(cleared),
      `${label}: only the completed bridge survives`);
  }
  if (death) {
    const surface = surfaceTile();
    safeTeleport(p, { level: surface[0], x: surface[1], z: surface[2] },
      `${label}: disclosed post-death travel back to the rift`);
  }
  chooseRiftWithRope(p, `${label}: native rift re-entry`);
  assert.equal(stage(p), expectedStage, `${label}: re-entry does not advance progress`);
  if (expectedStage === CONFUSION_STAGE) {
    assertOwnedQuestActors(p, confusionNpcsFor(p), 5, `${label}: fresh Confusion group`);
    assert(confusionNpcsFor(p).every(npc => npc.vars[CONFUSION_HITS] === 0),
      `${label}: every new illusion has a fresh hit counter`);
  } else if (expectedStage === CONFUSION_CLEAR_STAGE) {
    assert.equal(confusionNpcsFor(p).length, 0, `${label}: no completed Confusion encounter respawns`);
    confusionHopeDoorLoc(p);
  } else if (expectedStage === HOPE_STAGE) {
    assertOwnedQuestActors(p, hopeNpcsFor(p), 5, `${label}: fresh Hope group`);
    assert(hopeNpcsFor(p).every(npc => npc.type === requiredId('NpcType', HOPE_TYPES[0])
      && npc.levels[HP_STAT] === 21), `${label}: each restarted creature has all three lives`);
  } else {
    assert.equal(hopeNpcsFor(p).length, 0, `${label}: no completed Hope encounter respawns`);
    assert.deepEqual({ level: p.level, x: p.x, z: p.z }, roomCoord(p, 'soulbane_hope_bridged_entry'),
      `${label}: cleared Hope re-enters the bridged source quarter`);
  }
  return p;
}
function laterRoomFixture(initialStage, label) {
  // Initial-state fixture only: all partial kills, morphs and clears are produced.
  const p = playerFixture();
  writeVar(p, 'soulbane_prog', initialStage);
  writeVar(p, 'soulbane_riftrope_pres', 1);
  seedFearCombatFixture(p, label);
  // makePlayer seeds all base stats at 99 but leaves the constructor's level 3.
  // Reconstruct the ordinary visible combat level from those disclosed stats.
  p.combatLevel = p.getCombatLevel();
  chooseRiftWithRope(p, label);
  return p;
}
function testLaterPartialLifecycle() {
  for (const roomStage of [CONFUSION_STAGE, HOPE_STAGE]) {
    let p = laterRoomFixture(roomStage, `disclosed stage-${roomStage} partial-lifecycle fixture`);
    for (const death of [false, true]) {
      const label = `stage-${roomStage} partial ${death ? 'death' : 'logout'}`;
      if (roomStage === CONFUSION_STAGE) {
        for (let encounter = 0; encounter < 5 && confusionKillCount(p) === 0; encounter++) {
          const target = prepareConfusionTarget(p, label);
          if (target.type === requiredId('NpcType', 'soulbane_confu_creeper')) killConfusionReal(p, target, 1);
          else testConfusionIllusion(p, target);
        }
        assert.equal(confusionKillCount(p), 1, `${label}: one real kill precedes cleanup`);
      } else {
        killHopeCreature(p, hopeNpcsFor(p)[0], 1);
        assert.equal(readVar(p, 'soulbane_hope_killedtally'), 1, `${label}: one three-life death precedes cleanup`);
      }
      p = laterLifecycle(p, roomStage, label, death);
      ensureFearCombatWeapon(p, `${label}: ordinary surviving combat gear`);
    }
    leaveQuestRoom(p, `stage-${roomStage} partial fixture cleanup`);
    p.requestLogout = true;
    worldTick();
  }
}
function testHopeConcurrentCreditsAndFood() {
  const p = laterRoomFixture(HOPE_STAGE, 'disclosed Hope concurrent queued-hit fixture');
  // Disclosed ordinary combat setting: prevent automatic player attacks from
  // consuming a final life while this case exercises queued-hit recipients.
  writeVar(p, 'option_nodef', 1); // native player_auto_retaliate_off
  const targets = hopeNpcsFor(p).slice(0, 3);
  for (const npc of targets) {
    for (let life = 0; life < 2; life++) {
      const type = requiredId('NpcType', HOPE_TYPES[life]);
      assert.equal(npc.type, type, 'concurrent fixture reaches each life through native combat');
      for (let hits = 0; npc.isActive && npc.type === type && npc.levels[HP_STAT] > 0; hits++) {
        assert(hits < 48, 'concurrent fixture defeats each nonfinal life within the normal hit bound');
        awaitHopeAttackReady(p, npc, 'concurrent fixture');
        stableHitRandom(() => runNativeAttack(p, npc, `concurrent fixture life ${life + 1}`, 120, true));
      }
      for (let tick = 0; tick < 256 && npc.isActive && (npc.type === type || npc.delayed); tick++) worldTick();
      assert.equal(npc.type, requiredId('NpcType', HOPE_TYPES[life + 1]), 'native death restores the next life');
    }
    if (npc !== targets.at(-1)) {
      // Disclosed own-position fixture travel, within this same private copy.
      // Native max-range disengagement ends combat without deleting the life.
      p.clearInteraction();
      p.clearWaypoints();
      safeTeleport(p, roomCoord(p, 'soulbane_rage_entry'), "concurrent fixture: leave the prior opponent's native chase range");
      for (let tick = 0; tick < 16
        && World.currentTick - p.getVar(PLAYER_LAST_COMBAT) < questConstant('soulbane_hope_combat_ticks'); tick++) worldTick();
      assert(World.currentTick - p.getVar(PLAYER_LAST_COMBAT) >= questConstant('soulbane_hope_combat_ticks'),
        'native disengagement expires the prior single-combat window');
      safeTeleport(p, roomCoord(p, 'soulbane_hope_entry'), 'concurrent fixture: return to the unchanged Hope encounter');
      assert.equal(npc.type, requiredId('NpcType', HOPE_TYPES[2]), 'fixture travel preserves the product-produced final life');
    }
  }
  p.clearInteraction();
  assert.equal(readVar(p, 'soulbane_hope_killedtally'), 0, 'three naturally reached final lives have no death credit');
  const opponent = waitForHopeAggressor(p, 'concurrent fixture current opponent');
  assert(targets.includes(opponent), 'current opponent is one of the three naturally advanced creatures');
  // Disclosed damage inputs, not seeded outcomes: production queue2 applies each
  // hit, and production queue3 must later credit distinct deaths in one tick.
  for (const npc of targets) npc.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, 7);
  for (let tick = 0; tick < 8 && targets.some(npc => npc.levels[HP_STAT] !== 14); tick++) worldTick();
  assert(targets.every(npc => npc.levels[HP_STAT] === 14), 'native queued inputs partially deplete all three final lives');
  assert.equal(p.invAdd(inv, obj('bread'), 1), 1, 'seed only ordinary food for recipient isolation');
  awaitPlayerActionReady(p, 'recipient-isolation food');
  consumeNativeOp1(p, 'bread', 'recipient-isolation actual food');
  for (const npc of targets) assert.equal(npc.levels[HP_STAT], npc === opponent ? 21 : 14,
    'native food restores the current opponent, never a depleted nonrecipient');
  const outside = playerFixture();
  assert.equal(outside.invAdd(inv, obj('bread'), 1), 1, 'seed ordinary food on the outside-quest negative account');
  const beforeOutsideFood = targets.map(npc => npc.levels[HP_STAT]);
  consumeNativeOp1(outside, 'bread', 'outside-quest actual food');
  assert.deepEqual(targets.map(npc => npc.levels[HP_STAT]), beforeOutsideFood,
    "outside-quest eating cannot heal another account's Hope creatures");
  outside.requestLogout = true;
  worldTick();
  const inputTick = World.currentTick;
  for (const npc of targets) npc.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, npc.levels[HP_STAT]);
  for (let tick = 0; tick < 16 && readVar(p, 'soulbane_hope_killedtally') !== targets.length; tick++) worldTick();
  assert.equal(readVar(p, 'soulbane_hope_killedtally'), 3, 'three same-tick final deaths each earn one credit');
  assert(targets.every(npc => npc.vars[NPC_INSTANCE] === 0), 'every credited NPC consumes its own instance marker');
  for (const npc of targets) if (npc.isActive) {
    npc.enqueueScript(ServerTriggerType.AI_QUEUE3, 0);
    npc.enqueueScript(ServerTriggerType.AI_QUEUE3, 0);
  }
  for (let tick = 0; tick < 16; tick++) worldTick();
  assert.equal(readVar(p, 'soulbane_hope_killedtally'), 3, 'duplicate death notifications cannot duplicate any credit');
  assert.equal(stage(p), HOPE_STAGE, 'three concurrent kills cannot complete the five-creature room');
  assertOwnedQuestActors(p, hopeNpcsFor(p), 2, 'concurrent fixture leaves precisely two uncredited creatures');
  console.log(`PASS Hope concurrent native credits and food isolation ${JSON.stringify({ inputTick, deaths: targets.length })}`);
  leaveQuestRoom(p, 'concurrent fixture cleanup');
  p.requestLogout = true;
  worldTick();
}

function testConfusionHopeProgression(p) {
  assert.equal(stage(p), FEAR_COMPLETE_STAGE, 'later-room progression starts at completed Fear stage 5');
  const oldUid = instanceUid(p);
  const exit = fearWestExitLoc(p);
  goToStand(p, exit, 'stage-5 Fear exit to the Confusion room');
  const mode = readVar(p, 'musicplay');
  const confusionMusic = beginRoomMusicObservation(p, CONFUSION_SONG, mode, 'first Confusion room entry');
  const enteredConfusion = operateLoc(p, exit, 1, [], 'stage-5 western exit into Confusion');
  assert.equal(enteredConfusion.trigger.name, '[oploc1,soul_bane_fwall_exit]',
    'completed Fear crosses the original open western exit loc');
  assertRoomMusicObservation(p, confusionMusic, 'first Confusion room entry');
  assert.equal(stage(p), CONFUSION_STAGE, 'the original western exit advances to active Confusion stage 6');
  assert.equal(instanceUid(p), oldUid, 'Fear-to-Confusion transition keeps the owner private copy');
  assert.deepEqual({ level: p.level, x: p.x, z: p.z }, roomCoord(p, 'soulbane_confusion_entry'),
    'the Fear exit lands at the exact Confusion room entry');
  assertJournal(p, ['journeyed through to a third room', 'Your son\'s voice spoke as I entered',
    'overcome his confusion'], ['prevailed over a third room', 'fourth room', 'Tolna has been rescued',
    'Soulbane is complete'], 'active stage-6 Confusion journal');

  leaveQuestRoom(p, 'stage-6 active Confusion exit for Launa report');
  assert.equal(stage(p), CONFUSION_STAGE, 'leaving active Confusion preserves stage 6');
  assertLaunaReport(p, ['journeyed through to a third room', 'Your son\'s voice spoke as I entered',
    'overcome his confusion'], ['prevailed over a third room', 'fourth room', 'Tolna has been rescued',
    'Soulbane is complete'], 'stage-6 active Confusion report');
  chooseRiftWithRope(p, 'active Confusion re-entry after Launa report');
  assert.equal(stage(p), CONFUSION_STAGE, 'rift re-entry preserves active Confusion stage 6');
  assertPrivateInstanceIsolation(p, 'stage-6 Confusion re-entry');
  checkConfusionRoomRoutes(p);
  testForeignLaterRoomPackets(p, confusionNpcsFor(p), 'all five Confusion forms');

  assertOwnedQuestActors(p, confusionNpcsFor(p), 5, 'fresh Confusion group');
  assert.equal(confusionNpcsFor(p).filter(npc => npc.type !== requiredId('NpcType', 'soulbane_confu_creeper')).length, 4,
    'the fresh group contains exactly four distinct illusions');
  const realUids = new Set();
  let testedIllusions = 0;
  for (let ordinal = 1; ordinal <= questConstant('soulbane_confusion_real_kills'); ordinal++) {
    for (let encounter = 0; encounter < 5 && confusionKillCount(p) < ordinal; encounter++) {
      const current = prepareConfusionTarget(p, `Confusion group ${ordinal} encounter ${encounter + 1}`);
      if (current.type !== requiredId('NpcType', 'soulbane_confu_creeper')) {
        testConfusionIllusion(p, current);
        testedIllusions++;
        continue;
      }
      assertConfusionNativeGates(p, current, `stage-6 real Confusion creature ${ordinal}`);
      assert(!realUids.has(current.uid), `stage-6 Confusion real kill ${ordinal} is a distinct NPC death`);
      realUids.add(current.uid);
      killConfusionReal(p, current, ordinal);
    }
    assert.equal(confusionKillCount(p), ordinal, `five-actor group ${ordinal} completes through its actual combat opponents`);
  }
  assert(testedIllusions > 0, 'the natural packet-driven path verifies at least one full eight-hit illusion');
  assert.equal(realUids.size, questConstant('soulbane_confusion_real_kills'),
    'five distinct native real-creature deaths complete Confusion');
  const confusionScene = finishConfusionScene(p);
  p = laterLifecycle(p, CONFUSION_CLEAR_STAGE, 'cleared Confusion native logout');
  p = laterLifecycle(p, CONFUSION_CLEAR_STAGE, 'cleared Confusion native death', true);
  assertJournal(p, ['prevailed over a third room', 'I think I may be getting closer'],
    ['journeyed through to a third room', 'fourth room', 'Tolna has been rescued', 'Soulbane is complete'],
    'cleared stage-7 Confusion journal');
  leaveQuestRoom(p, 'stage-7 cleared Confusion exit for Launa report');
  assert.equal(stage(p), CONFUSION_CLEAR_STAGE, 'leaving cleared Confusion preserves stage 7');
  assertLaunaReport(p, ['prevailed over a third room', 'I think I may be getting closer'],
    ['journeyed through to a third room', 'fourth room', 'Tolna has been rescued', 'Soulbane is complete'],
    'stage-7 cleared Confusion report');
  chooseRiftWithRope(p, 'cleared Confusion re-entry after Launa report');
  assert.equal(stage(p), CONFUSION_CLEAR_STAGE, 'rift re-entry preserves cleared Confusion stage 7');
  assert.equal(readVar(p, 'soulbane_confu_door6open'), 1, 'cleared Confusion re-entry preserves its open next-room door');

  const door = confusionHopeDoorLoc(p);
  goToStand(p, door, 'stage-7 open door into the Hope room');
  const hopeMusic = beginRoomMusicObservation(p, HOPE_SONG, readVar(p, 'musicplay'),
    'first Hope room entry');
  const clearedConfusionUid = instanceUid(p);
  const enteredHope = operateLoc(p, door, 1, [], 'stage-7 open door into active Hope');
  assert.equal(enteredHope.trigger.name, '[oploc1,soul_bane_con_door6_open1]',
    'the compiled sixth open door dispatches Hope entry');
  assertRoomMusicObservation(p, hopeMusic, 'first Hope room entry');
  assert.equal(stage(p), HOPE_STAGE, 'the open Confusion door advances to active Hope stage 8');
  assert.equal(instanceUid(p), clearedConfusionUid, 'Hope entry retains its existing owner private copy');
  assert.deepEqual({ level: p.level, x: p.x, z: p.z }, roomCoord(p, 'soulbane_hope_entry'), 'the open door lands at the exact Hope entry');
  assertJournal(p, ['prevailed over a third room', 'fourth room', 'your son\'s voice spoke to me',
    'fight to give him back his hope'], ['endured against hopelessness', 'Tolna has been rescued',
    'Soulbane is complete'], 'active stage-8 Hope journal');

  leaveQuestRoom(p, 'stage-8 active Hope exit for Launa report');
  assert.equal(stage(p), HOPE_STAGE, 'leaving active Hope preserves stage 8');
  assertLaunaReport(p, ['fourth room', 'As I entered your son\'s voice spoke to me',
    'fight to give him back his hope', 'Can I succeed'], ['endured against hopelessness',
    'Tolna has been rescued', 'Soulbane is complete'], 'stage-8 active Hope report');
  chooseRiftWithRope(p, 'active Hope re-entry after Launa report');
  assert.equal(stage(p), HOPE_STAGE, 'rift re-entry preserves active Hope stage 8');
  assertPrivateInstanceIsolation(p, 'stage-8 Hope re-entry');
  const hopeGroup = checkHopeRoomRoutes(p);
  assert.deepEqual({ level: p.level, x: p.x, z: p.z }, hopeGroup.entry, 'Hope route audit leaves the player on its authored entry tile');
  testForeignLaterRoomPackets(p, hopeNpcsFor(p), 'fresh Hope form');
  const foodTarget = testHopeFoodDispatch(p);
  assert.equal(readVar(p, 'soulbane_hope_killedtally'), 0,
    'nonlethal food and pre-final morphs earn no Hope kill credit');
  const hopeUids = new Set();
  const killOrder = [foodTarget, ...hopeNpcsFor(p).filter(npc => npc !== foodTarget)];
  assert.equal(killOrder.length, questConstant('soulbane_hope_creatures'),
    'Hope progression retains all five distinct owner-bound creatures');
  let bridgePacketMark = null;
  for (let ordinal = 1; ordinal <= killOrder.length; ordinal++) {
    const npc = killOrder[ordinal - 1];
    assert(!hopeUids.has(npc.uid), `stage-8 Hope kill ${ordinal} is a distinct NPC`);
    hopeUids.add(npc.uid);
    const packetMark = killHopeCreature(p, npc, ordinal);
    if (ordinal === questConstant('soulbane_hope_creatures')) bridgePacketMark = packetMark;
  }
  assert.equal(hopeUids.size, questConstant('soulbane_hope_creatures'),
    'five distinct final-life deaths complete Hope');
  finishHopeScene(p, bridgePacketMark);
  p = laterLifecycle(p, HOPE_CLEAR_STAGE, 'cleared Hope native logout');
  p = laterLifecycle(p, HOPE_CLEAR_STAGE, 'cleared Hope native death', true);
  assertJournal(p, ['endured against hopelessness to finish the fourth room',
    'find him and bring him back to me', 'Don\'t worry, I will find him'],
  ['Tolna has been rescued', 'Soulbane is complete'], 'cleared stage-9 Hope journal');

  leaveQuestRoom(p, 'stage-9 cleared Hope exit for Launa report');
  assert.equal(stage(p), HOPE_CLEAR_STAGE, 'leaving cleared Hope preserves stage 9');
  assertLaunaReport(p, ['endured against hopelessness to finish the fourth room',
    'You must find him and bring him back to me', 'Don\'t worry, I will find him'],
  ['Tolna has been found', 'found Tolna', 'Tolna has been rescued', 'Soulbane is complete', 'quest is complete'],
  'stage-9 cleared Hope report');
  assert.equal(stage(p), HOPE_CLEAR_STAGE, 'Launa report does not claim or write quest completion');
  console.log(`Confusion/Hope saved boundaries ${JSON.stringify({
    confusion: confusionScene.text, confusionRealDeaths: realUids.size,
    hopeFinalDeaths: hopeUids.size, stage: stage(p)
  })}`);
  return p;
}

function tolnaActorsFor(p) {
  const uid = instanceUid(p);
  return [...World.npcs].filter(npc => npc?.isActive
    && (TOLNA_ACTOR_IDS.has(npc.type) || TOLNA_ACTOR_IDS.has(npc.baseType))
    && npc.vars[NPC_INSTANCE] === uid && (npc.vars[NPC_OWNER] >>> 0) === p.uid);
}
function tolnaActorsWithOwner(owner) {
  return [...World.npcs].filter(npc => npc?.isActive
    && (TOLNA_ACTOR_IDS.has(npc.type) || TOLNA_ACTOR_IDS.has(npc.baseType))
    && (npc.vars[NPC_OWNER] >>> 0) === (owner >>> 0));
}
function tolnaHeadsFor(p) {
  const actors = tolnaActorsFor(p);
  const heads = TOLNA_HEADS.map(spec => {
    const matches = actors.filter(npc => npc.type === spec.id || npc.baseType === spec.id);
    assert.equal(matches.length, 1, `${spec.type}: exactly one product-spawned owner-copy head exists`);
    return { spec, npc: matches[0] };
  });
  return heads;
}
function assertOwnedTolnaActors(p, expectedHeads, expectHuman, label) {
  const actors = tolnaActorsFor(p);
  const heads = actors.filter(npc => TOLNA_HEAD_IDS.has(npc.type) || TOLNA_HEAD_IDS.has(npc.baseType));
  assert.equal(heads.length, expectedHeads, `${label}: exact product-spawned head count`);
  assert.equal(actors.filter(npc => npc.type === TOLNA_BRANA || npc.baseType === TOLNA_BRANA).length, 1,
    `${label}: one owned Brana occupies the private arena`);
  assert.equal(actors.filter(npc => npc.type === TOLNA_HUMAN || npc.baseType === TOLNA_HUMAN).length,
    Number(expectHuman), `${label}: human Tolna appears only after the three-head clear`);
  for (const npc of actors) {
    assert.equal(npc.vars[NPC_INSTANCE], instanceUid(p), `${label}: every Tolna actor belongs to the current copy`);
    assert.equal(npc.vars[NPC_OWNER] >>> 0, p.uid, `${label}: every Tolna actor belongs to the current player`);
  }
  return actors;
}
function tolnaHeadRow(p, npc, spec, label) {
  const rowId = runProcInt('soulbane_tolna_headrow', p, [], npc);
  assert.equal(rowId, spec.rowId, `${label}: stateless native NPC switch selects ${spec.row}`);
  const row = types.DbRowType.get(rowId);
  assert(row, `${label}: selected profile resolves to a packed dbrow`);
  assert.equal(dbField(row, TOLNA_PROFILE_TABLE, 'head')?.[0], spec.id,
    `${label}: selected dbrow names the actual head type`);
  const rowStand = dbField(row, TOLNA_PROFILE_TABLE, 'stand')?.[0];
  assert.deepEqual(unpackWorld(rowStand), spec.standCoord, `${label}: selected dbrow uses its declared stand`);
  assert.equal(dbField(row, TOLNA_PROFILE_TABLE, 'melee_ticks')?.[0], spec.meleeTicks,
    `${label}: profile uses its authored melee interval`);
  assert.equal(dbField(row, TOLNA_PROFILE_TABLE, 'ranged_ticks')?.[0], spec.rangedTicks,
    `${label}: profile uses its authored ranged interval`);
  const type = types.NpcType.get(npc.type);
  assert.equal(type.size, 3, `${label}: original head occupies its full 3x3 footprint`);
  assert.deepEqual([
    npc.baseLevels[NpcStat.HITPOINTS], npc.baseLevels[NpcStat.ATTACK],
    npc.baseLevels[NpcStat.STRENGTH], npc.baseLevels[NpcStat.DEFENCE],
    npc.baseLevels[NpcStat.MAGIC], npc.baseLevels[NpcStat.RANGED]
  ], [37, 42, 41, 40, 1, 1], `${label}: original head combat levels are preserved`);
  assert.equal(type.params.get(ATTACK_RATE_PARAM), spec.damageType ? spec.meleeTicks : spec.rangedTicks,
    `${label}: packed attackrate uses the same available source-profile interval`);
  assert.equal(type.params.get(POISON_SEVERITY_PARAM), questConstant('soulbane_tolna_poison_severity'),
    `${label}: head uses the declared native poison severity`);
  if (spec.damageType) {
    assert.equal(type.params.get(DAMAGE_TYPE_PARAM),
      configConstant('scripts/skill_combat/configs/combat_damagetypes.constant', spec.damageType),
      `${label}: original melee damage style is ${spec.damageType}`);
  } else {
    assert.equal(type.params.get(DAMAGE_TYPE_PARAM), undefined,
      `${label}: ranged-only East has no melee damage type`);
  }
  return rowId;
}
function tolnaCoordInCopy(p, source, label) {
  const template = CoordGrid.packCoord(source.level, source.x, source.z);
  const expected = templateCoord(p, template);
  // This internal proc inherits its caller's region; reproduce native ownership admission.
  const owned = runProc('soulbane_owned', p);
  assert.equal(owned.popInt(), 1, `${label}: native ownership admission selects the active copy`);
  const script = ScriptProvider.getByName('[proc,soulbane_tolna_coord]');
  assert(script, `${label}: compiled coordinate proc exists`);
  const state = ScriptRunner.init(script, p, null, [template]);
  // Before execution there is no current opcode operand to select primary/secondary accessors.
  state._activeRegion = owned._activeRegion;
  state._activeRegionUid = owned._activeRegionUid;
  state.pointerAdd(ActiveRegion[0]);
  assert.equal(p.runScript(state, true, true), ScriptState.FINISHED,
    `${label}: compiled coordinate proc finishes with its required native region pointer`);
  const actual = unpackWorld(state.popInt());
  assert.deepEqual(actual, expected, `${label}: compiled arena coordinate agrees with assigned InstanceZone metadata`);
  return actual;
}
function tolnaSourceMapper(p) {
  const instance = instanceForOwner(p, 'Tolna source-to-copy geometry');
  const zones = new Map(assignedInstanceZones(instance).map(zone => [
    `${zone.source.level}:${zone.source.x}:${zone.source.z}`, zone
  ]));
  return source => {
    const key = sourceZoneKey(source);
    const zone = zones.get(key);
    assert(zone, `private arena maps source zone ${key}`);
    return {
      level: zone.level,
      x: (zone.x << 3) + (source.x & 7),
      z: (zone.z << 3) + (source.z & 7)
    };
  };
}
function tolnaFootprintOpen(point, size, label) {
  for (let dx = 0; dx < size; dx++) {
    for (let dz = 0; dz < size; dz++) {
      const x = point.x + dx;
      const z = point.z + dz;
      const flags = routeFinder.collisionFlags.get(x, z, point.level) >>> 0;
      assert.equal(map.isMapBlocked(x, z, point.level), (flags & CollisionFlag.WALK_BLOCKED) !== 0,
        `${label}: native routefinder and GameMap agree on collision at ${point.level}_${x}_${z}`);
      assert(map.isZoneAllocated(point.level, x, z),
        `${label}: original/private geometry has an allocated zone at ${point.level}_${x}_${z}`);
      assert.equal((flags & CollisionFlag.WALK_BLOCKED) !== 0, false,
        `${label}: complete actor footprint is collision-open at ${point.level}_${x}_${z}`);
    }
  }
}
function tolnaExactPath(from, to) {
  if (from.level === to.level && from.x === to.x && from.z === to.z) return [];
  const route = [...map.findPath(from.level, from.x, from.z, to.x, to.z)];
  if (route.length === 0) return null;
  const end = unpackWorld(route.at(-1));
  return end.level === to.level && end.x === to.x && end.z === to.z ? route : null;
}
function tolnaNativeMeleeReference(point, head, size) {
  const reached = map.reachedEntity(head.level, head.x, head.z, point.x, point.z, 1, 1, size);
  let edge = null;
  if (point.z >= head.z && point.z < head.z + size) {
    if (point.x === head.x - 1) edge = { x: head.x, z: point.z };
    else if (point.x === head.x + size) edge = { x: head.x + size - 1, z: point.z };
  }
  if (point.x >= head.x && point.x < head.x + size) {
    if (point.z === head.z - 1) edge = { x: point.x, z: head.z };
    else if (point.z === head.z + size) edge = { x: point.x, z: head.z + size - 1 };
  }
  const edgeLine = edge !== null
    && map.isLineOfWalk(point.level, point.x, point.z, edge.x, edge.z);
  return { reached, edgeLine, result: reached && edgeLine };
}
function testTolnaArenaGeometry(p, label) {
  const sourceBase = sourceCoordForName('soulbane_tolna_source');
  const sourceEntry = sourceCoordForName('soulbane_tolna_entry');
  const copyOf = tolnaSourceMapper(p);
  const copyEntry = tolnaCoordInCopy(p, sourceEntry, `${label} entry`);
  const headPairs = tolnaHeadsFor(p);
  assertOwnedTolnaActors(p, 3, false, `${label} fixed geometry`);
  assert.equal(types.ParamType.getId('soulbane_tolna_profile'), -1,
    'head profiles use supported stateless native row lookup, not an NPC dbrow parameter');

  const fixedStands = [
    ['soulbane_tolna_entry', 1],
    ['soulbane_tolna_player', 1],
    ['soulbane_tolna_camera', 1],
    ['soulbane_tolna_brana', types.NpcType.get(TOLNA_BRANA).size],
    ['soulbane_tolna_human', types.NpcType.get(TOLNA_HUMAN).size],
    ...TOLNA_HEADS.map(head => [head.stand, types.NpcType.get(head.id).size])
  ];
  for (const [name, size] of fixedStands) {
    const source = sourceCoordForName(name);
    const copy = tolnaCoordInCopy(p, source, `${label} ${name}`);
    tolnaFootprintOpen(source, size, `${label} source ${name}`);
    tolnaFootprintOpen(copy, size, `${label} private ${name}`);
    const sourcePath = tolnaExactPath(sourceEntry, source);
    const copyPath = tolnaExactPath(copyEntry, copy);
    assert(sourcePath, `${label} source stand ${name} is reachable by the original pathfinder`);
    assert(copyPath, `${label} private stand ${name} is reachable by the actual copied pathfinder`);
  }
  for (let first = 0; first < TOLNA_HEADS.length; first++) {
    const a = TOLNA_HEADS[first].standCoord;
    for (let second = first + 1; second < TOLNA_HEADS.length; second++) {
      const b = TOLNA_HEADS[second].standCoord;
      assert(a.x >= b.x + 3 || b.x >= a.x + 3 || a.z >= b.z + 3 || b.z >= a.z + 3,
        `${label}: fixed 3x3 head footprints remain disjoint`);
    }
  }

  // The private copy has live actors; occupancy is not part of the packed terrain.
  const occupancyFlags = CollisionFlag.NPC_OCC | CollisionFlag.PLAYER_OCC;
  let copiedCollisionTiles = 0;
  const reachable = [];
  for (let localX = TOLNA_WINDOW.minX; localX <= TOLNA_WINDOW.maxX; localX++) {
    for (let localZ = TOLNA_WINDOW.minZ; localZ <= TOLNA_WINDOW.maxZ; localZ++) {
      const source = { level: sourceBase.level, x: sourceBase.x + localX, z: sourceBase.z + localZ };
      const copy = copyOf(source);
      const sourceFlags = routeFinder.collisionFlags.get(source.x, source.z, source.level) >>> 0;
      const copyFlags = routeFinder.collisionFlags.get(copy.x, copy.z, copy.level) >>> 0;
      assert.equal(map.isMapBlocked(source.x, source.z, source.level),
        (sourceFlags & CollisionFlag.WALK_BLOCKED) !== 0,
        `${label}: original flags agree at ${source.level}_${source.x}_${source.z}`);
      assert.equal(map.isMapBlocked(copy.x, copy.z, copy.level),
        (copyFlags & CollisionFlag.WALK_BLOCKED) !== 0,
        `${label}: private flags agree at ${copy.level}_${copy.x}_${copy.z}`);
      assert.equal(copyFlags & ~occupancyFlags, sourceFlags & ~occupancyFlags,
        `${label}: all packed source/private terrain flags match at local ${localX}_${localZ}`);
      copiedCollisionTiles++;
      if (!map.isZoneAllocated(source.level, source.x, source.z)
        || (sourceFlags & CollisionFlag.WALK_BLOCKED) !== 0) continue;
      const route = tolnaExactPath(sourceEntry, source);
      if (!route) continue;
      const privateRoute = tolnaExactPath(copyEntry, copy);
      assert(privateRoute, `${label}: corresponding private floor point remains exactly reachable`);
      reachable.push({ source, copy, route, privateRoute });
    }
  }
  assert.equal(copiedCollisionTiles, 33 * 31,
    `${label}: source/private collision equality covers the complete authored probe window`);
  assert.equal(reachable.length, 186,
    `${label}: the original entry has exactly 186 reachable floor points in the source window`);
  const underHead = point => TOLNA_HEADS.some(head => {
    const stand = head.standCoord;
    return point.x >= stand.x && point.x < stand.x + 3 && point.z >= stand.z && point.z < stand.z + 3;
  });
  assert.equal(reachable.filter(point => underHead(point.source)).length, 27,
    `${label}: the 186-point comparison retains all 27 tiles beneath the three heads`);

  const sourceCounts = Array(TOLNA_HEADS.length).fill(0);
  const copyCounts = Array(TOLNA_HEADS.length).fill(0);
  const sourceTripleMelee = [];
  const copyTripleMelee = [];
  let sourceComparisons = 0;
  let copyComparisons = 0;
  const sourceHeadCoords = TOLNA_HEADS.map(head => head.standCoord);
  const copyHeadCoords = TOLNA_HEADS.map(head =>
    tolnaCoordInCopy(p, head.standCoord, `${label} private ${head.type}`));
  const oldPlayer = { level: p.level, x: p.x, z: p.z };
  const oldHeads = headPairs.map(({ npc }) => ({ npc, level: npc.level, x: npc.x, z: npc.z }));
  const compareGeometry = (point, geometry, coords, counts, triples) => {
    p.level = point.level; p.x = point.x; p.z = point.z;
    const results = headPairs.map(({ npc }, index) => {
      const target = coords[index];
      npc.level = target.level; npc.x = target.x; npc.z = target.z;
      const expected = tolnaNativeMeleeReference(point, target, 3);
      const actual = runProcInt('soulbane_tolna_melee_range', p, [], npc) !== 0;
      assert.equal(actual, expected.result,
        `${label}: compiled melee predicate matches native reachedEntity plus edge line-of-walk (${geometry}, head ${index + 1}, ${point.level}_${point.x}_${point.z})`);
      if (actual) counts[index]++;
      return actual;
    });
    if (results.every(Boolean)) triples.push(`${point.level}_${point.x}_${point.z}`);
  };
  try {
    for (const point of reachable) {
      compareGeometry(point.source, 'source', sourceHeadCoords, sourceCounts, sourceTripleMelee);
      sourceComparisons += TOLNA_HEADS.length;
      compareGeometry(point.copy, 'private', copyHeadCoords, copyCounts, copyTripleMelee);
      copyComparisons += TOLNA_HEADS.length;
    }
  } finally {
    p.level = oldPlayer.level; p.x = oldPlayer.x; p.z = oldPlayer.z;
    for (const saved of oldHeads) {
      saved.npc.level = saved.level; saved.npc.x = saved.x; saved.npc.z = saved.z;
    }
  }
  assert.equal(sourceComparisons, 558, `${label}: original compiled predicate covers all 558 head/tile pairs`);
  assert.equal(copyComparisons, 558, `${label}: private compiled predicate covers all 558 head/tile pairs`);
  assert.deepEqual(sourceCounts, [8, 6, 9], `${label}: actual original compiled melee counts are South 8/East 6/North 9`);
  assert.deepEqual(copyCounts, sourceCounts, `${label}: actual private compiled melee counts equal original counts`);
  assert.equal(sourceTripleMelee.length, 0, `${label}: no original floor point melees all three heads`);
  assert.equal(copyTripleMelee.length, 0, `${label}: no private floor point melees all three heads`);
  for (const { spec, npc } of headPairs) tolnaHeadRow(p, npc, spec, `${label} ${spec.row} profile binding`);
  return {
    reachableTiles: reachable.length, underHeadTiles: 27, sourceComparisons, copyComparisons,
    sourceMeleeCounts: sourceCounts, privateMeleeCounts: copyCounts,
    sourceTripleMelee: sourceTripleMelee.length, privateTripleMelee: copyTripleMelee.length
  };
}

function tolnaPassageLoc(p) {
  const matches = nearbyLocs(p, /^soul_bane_hwall_void_exit$/);
  assert.equal(matches.length, 1, 'stage 9 has exactly one packed forward hole into Tolna');
  return matches[0];
}
function tolnaFinalExitLoc(p) {
  const matches = nearbyLocs(p, /^soul_bane_tolna_void_small$/);
  assert.equal(matches.length, 1, 'the final chamber has exactly one packed surface Exit');
  return matches[0];
}
function assertTolnaNativeGates(p, npc, admitted, label) {
  const expected = Number(admitted);
  assert.equal(runProcInt('soulbane_tolna_attackable', p, [], npc), expected,
    `${label}: compiled finale owner/stage gate`);
  assert.equal(runProcInt('npc_is_attackable', p, [], npc), expected,
    `${label}: native melee gate reaches the finale owner/stage policy`);
  assert.equal(runProcInt('npc_is_attackable_opt', p, [], npc), expected,
    `${label}: native ranged/cast gate reaches the finale owner/stage policy`);
  for (const spell of [0, 1]) {
    assert.equal(runProcInt('npc_max_dealt', p, [100, spell], npc), admitted ? 100 : 0,
      `${label}: ${spell ? 'spell' : 'melee/ranged'} damage policy runs before XP`);
  }
}
function tolnaIntroPages(p, label) {
  const pages = [];
  const overheads = new Set();
  const cameraMark = p.packets.length;
  const observeOverheads = () => {
    const brana = tolnaActorsFor(p).find(npc => npc.type === TOLNA_BRANA || npc.baseType === TOLNA_BRANA);
    if (typeof brana?.sayMessage === 'string' && brana.sayMessage) overheads.add(brana.sayMessage);
  };
  for (let tick = 0; tick < 1200; tick++) {
    observeOverheads();
    if (p.activeScript?.execution === ScriptState.PAUSEBUTTON) {
      pages.push(...dialoguePage(p));
      resumeDialogue(p);
      continue;
    }
    worldTick(observeOverheads);
    if (stage(p) === TOLNA_ACTIVE_STAGE && p.queue.head() === null
      && (!p.activeScript || p.activeScript.execution === ScriptState.FINISHED)) break;
  }
  assert.equal(stage(p), TOLNA_ACTIVE_STAGE, `${label}: the native intro continuation alone writes stage 11`);
  assert.equal(readVar(p, 'soulbane_final_seencut'), 1, `${label}: completed intro records its real cutscene boundary`);
  assert.equal(p.queue.head(), null, `${label}: native intro queue drains`);
  assert(p.packets.slice(cameraMark).some(packet => packet instanceof CamReset),
    `${label}: native intro resets its camera before starting the fight`);
  assert(pages.join(' ').includes('Why should I speak to you?'),
    `${label}: the actual Tolna intro displays its compiled response`);
  assert.deepEqual([...overheads], [
    'Son! Is that you?', 'Please speak to me! Tolna?', 'What do you mean?',
    "You'll always be my son!", 'There must be a way.', "Don't give up so easily!",
    'Sorry, but your mother and I...', 'tried so hard to find you!'
  ], `${label}: all eight authored Brana overheads are observed before native tick cleanup`);
  return { pages, overheads: [...overheads] };
}
function enterTolnaFinalRoom(p, label, checkGeometry = true) {
  assert.equal(stage(p), HOPE_CLEAR_STAGE, `${label}: stage 9 is the completed-Hope prerequisite`);
  assert.notEqual(instanceUid(p), 0, `${label}: the native stage-9 copy is live before the forward hole`);
  const oldUid = instanceUid(p);
  const passage = tolnaPassageLoc(p);
  goToStand(p, passage, `${label}: walk to the original forward hole`);
  const music = beginRoomMusicObservation(p, RAGE_SONG, readVar(p, 'musicplay'), label);
  const entered = operateLoc(p, passage, 1, [], `${label}: native forward-hole passage`);
  assert.equal(entered.trigger.name, '[oploc1,soul_bane_hwall_void_exit]',
    `${label}: the compiled original forward-hole handler starts Tolna`);
  assertRoomMusicState(p, music, `${label}: first Tolna arena entry`);
  assert.equal(stage(p), TOLNA_INTRO_STAGE, `${label}: passage begins the stage-10 intro boundary`);
  assert.notEqual(instanceUid(p), oldUid, `${label}: final room owns a new private instance`);
  assert.equal(World.instances.findInstanceByUid(oldUid - 1), null,
    `${label}: forward passage releases the old completed-Hope instance`);
  assert.deepEqual({ level: p.level, x: p.x, z: p.z },
    tolnaCoordInCopy(p, sourceCoordForName('soulbane_tolna_player'), `${label} intro stand`),
    `${label}: native entry places the player at the authored intro stand`);
  const heads = tolnaHeadsFor(p);
  assertOwnedTolnaActors(p, 3, false, `${label} stage-10 actors`);
  assert.deepEqual(heads.map(({ npc }) => npc.levels[HP_STAT]), [37, 37, 37],
    `${label}: all three product-spawned heads retain their authored fresh HP`);
  assert.deepEqual(TOLNA_DEATH_BITS.map(name => readVar(p, name)), [0, 0, 0],
    `${label}: no finale credit is seeded at entry`);
  assert.equal(readVar(p, 'soulbane_tolna_pres'), 0, `${label}: human-presence is not set by combat entry`);
  assert.equal(readVar(p, 'soulbane_launa_pres'), 0, `${label}: parent-presence is not set by combat entry`);
  for (const { npc } of heads) assertTolnaNativeGates(p, npc, false, `${label} intro gate`);
  const geometry = checkGeometry ? testTolnaArenaGeometry(p, `${label} stage-10 geometry`) : null;
  return { heads, oldUid, geometry };
}
function withTolnaCombatRandom(values, run) {
  let index = 0;
  const next = () => values[index++ % values.length];
  const previousMathRandom = Math.random;
  const previousJavaRandom = JavaRandom.nextDouble;
  Math.random = next;
  JavaRandom.nextDouble = next;
  try { return run(); }
  finally {
    Math.random = previousMathRandom;
    JavaRandom.nextDouble = previousJavaRandom;
  }
}
function castTolnaWindStrike(p, npc, label) {
  const windStrike = requiredId('Component', 'magic:wind_strike');
  for (const rune of ['airrune', 'mindrune']) {
    const need = 1 - count(p, rune);
    if (need > 0) assert.equal(p.invAdd(inv, obj(rune), need), need, `${label}: seed only the real spell's ordinary ${rune}`);
  }
  assert(p.isComponentVisible(types.Component.get(windStrike)), `${label}: native Wind Strike control is visible`);
  const hpBefore = npc.levels[HP_STAT];
  const xpBefore = xpSnapshot(p);
  const mark = p.packets.length;
  p.clearInteraction();
  World.processInfo();
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, npc.nid), `${label}: the owner sees the actual finale target`);
  if (!p.inOperableDistance(npc)) {
    const route = [...map.findPathToEntity(p.level, p.x, p.z, npc.x, npc.z, p.width, npc.width, npc.length)]
      .map(value => unpackWorld(value));
    assert(route.length > 0, `${label}: native pathfinder finds a cast approach`);
    assert(MoveClickHandler.handle(new MoveClick(route.map(({ x, z }) => ({ x, z })), 0, true), p),
      `${label}: native paired spell-click movement is accepted`);
  }
  assert(OpNpcTHandler.handle(new OpNpcT(npc.nid, windStrike), p),
    `${label}: native APNPCT accepts the eligible owner's finale cast`);
  assert.match(p.getApTrigger()?.name ?? '', /^\[apnpct,/i,
    `${label}: owner cast reaches the native APNPCT route`);
  p.processInteraction();
  for (let tick = 0; tick < 64; tick++) worldTick();
  assert(npc.levels[HP_STAT] < hpBefore, `${label}: real native spell queue damages the head`);
  assert(xpSnapshot(p).some((value, skill) => value > xpBefore[skill]),
    `${label}: the native spell awards its ordinary XP`);
  assert.equal(count(p, 'airrune'), 0, `${label}: actual Wind Strike consumes one air rune`);
  assert.equal(count(p, 'mindrune'), 0, `${label}: actual Wind Strike consumes one mind rune`);
  assert(p.packets.slice(mark).length > 0, `${label}: native cast emits ordinary player packets`);
}

function tolnaPointDistance(point, npc, size) {
  const dx = Math.max(0, npc.x - (point.x + 1), point.x - (npc.x + size - 1));
  const dz = Math.max(0, npc.z - (point.z + 1), point.z - (npc.z + size - 1));
  return Math.max(dx, dz);
}
function tolnaPlayerStand(p, npc, mode, label) {
  const size = types.NpcType.get(npc.type).size;
  const range = questConstant('soulbane_tolna_attackrange');
  const from = { level: p.level, x: p.x, z: p.z };
  const candidates = [];
  for (let x = npc.x - range; x <= npc.x + size + range; x++) {
    for (let z = npc.z - range; z <= npc.z + size + range; z++) {
      const point = { level: npc.level, x, z };
      if (point.level !== from.level || map.isMapBlocked(x, z, point.level)) continue;
      const melee = tolnaNativeMeleeReference(point, npc, size).result;
      const distance = tolnaPointDistance(point, npc, size);
      if (mode === 'adjacent' && !melee) continue;
      if (mode === 'ranged' && (melee || distance === 0 || distance > range)) continue;
      const route = tolnaExactPath(from, point);
      if (!route) continue;
      candidates.push({ point, distance, routeLength: route.length });
    }
  }
  candidates.sort((a, b) => a.routeLength - b.routeLength || a.distance - b.distance
    || a.point.x - b.point.x || a.point.z - b.point.z);
  assert(candidates.length > 0, `${label}: native map pathfinder finds the requested ${mode} stand`);
  return candidates[0].point;
}
function tolnaActorPositions(heads) {
  return heads.map(({ npc }) => [npc.level, npc.x, npc.z]);
}
function setTolnaHeadsReady(heads, delay) {
  for (const { npc } of heads) {
    npc.vars[NPC_ACTION_DELAY] = delay;
  }
}
function testTolnaNativeAttackIntervals(p, heads, label) {
  const east = heads.find(({ spec }) => spec.row === 'soulbane_tolna_east');
  assert(east, `${label}: the ranged-only East head is present`);
  const eastStand = tolnaPlayerStand(p, east.npc, 'adjacent', `${label} East Attack target`);
  moveToTile(p, eastStand, `${label}: approach East without moving a head`);
  assert(p.inOperableDistance(east.npc), `${label}: ordinary APNPC2 can target East at the adjacent stand`);
  const playerStand = tile(p);
  const initialPositions = tolnaActorPositions(heads);
  withCombatRandom(0.999999999999, () =>
    runNativeAttack(p, east.npc, `${label}: ordinary native APNPC2 starts combat`, 120, true));
  assert.deepEqual(tile(p), playerStand, `${label}: APNPC2 starts East combat without moving the player`);
  assert.deepEqual(tolnaActorPositions(heads), initialPositions,
    `${label}: native APNPC2 and its queue do not move any head`);

  const aggressivePlayer = requiredId('VarNpcType', 'npc_aggressive_player');
  for (const { spec, npc } of heads) {
    assert.equal(npc.vars[aggressivePlayer] >>> 0, p.uid,
      `${label}: ${spec.type} has the owner as its native AP target`);
  }
  const simultaneousStart = World.currentTick;
  setTolnaHeadsReady(heads, simultaneousStart);
  withCombatRandom(0.999999999999, () => worldTick());
  for (const { spec, npc } of heads) {
    assert.equal(npc.vars[NPC_ACTION_DELAY], simultaneousStart + spec.rangedTicks,
      `${label}: simultaneous native AP target ${spec.type} uses its Ranged interval ${spec.rangedTicks}`);
  }
  assert.deepEqual(tolnaActorPositions(heads), initialPositions,
    `${label}: all three simultaneous native AP targets remain on their exact product stands`);

  for (const { spec, npc } of heads) npc.vars[NPC_ACTION_DELAY] = World.currentTick + 2048;
  const intervalCases = [];
  for (const { spec, npc } of heads) {
    const stand = tolnaPlayerStand(p, npc, 'adjacent', `${label} ${spec.type} interval`);
    moveToTile(p, stand, `${label}: reach ${spec.type}'s compiled edge boundary`);
    assert(p.inOperableDistance(npc), `${label}: native AP target is within one-tile operation range`);
    const before = tolnaActorPositions(heads);
    const start = World.currentTick;
    npc.vars[NPC_ACTION_DELAY] = start;
    withCombatRandom(0.999999999999, () =>
      runProc('soulbane_tolna_npc_attack', p, [], npc));
    const expected = spec.meleeTicks > 0 ? spec.meleeTicks : spec.rangedTicks;
    assert.equal(npc.vars[NPC_ACTION_DELAY], start + expected,
      `${label}: ${spec.type} dispatches its native ${spec.meleeTicks > 0 ? 'melee' : 'Ranged'} interval ${expected}`);
    assert.deepEqual(tolnaActorPositions(heads), before,
      `${label}: ${spec.type} attack leaves all three 3x3 heads on their fixed stands`);
    intervalCases.push({ type: spec.type, delay: expected });
    for (const { npc: actor } of heads) actor.vars[NPC_ACTION_DELAY] = World.currentTick + 2048;
  }
  return intervalCases;
}
function testTolnaRangedDefence(p, heads, label) {
  const east = heads.find(({ spec }) => spec.row === 'soulbane_tolna_east').npc;
  const rangedStyle = configConstant('scripts/skill_combat/configs/combat_damagetypes.constant', 'ranged_style');
  const magicStyle = configConstant('scripts/skill_combat/configs/combat_damagetypes.constant', 'magic_style');
  const poisonHitmark = configConstant('scripts/skill_combat/configs/hitmark.constant', 'hitmark_poison');
  const beforePositions = tolnaActorPositions(heads);
  const previousRetaliate = readVar(p, 'option_nodef');
  writeVar(p, 'option_nodef', configConstant('scripts/interface_controls/configs/player_controls.constant',
    'player_auto_retaliate_off'));
  p.clearInteraction();
  const launch = (rangedDef, magicDef, magicPrayer, rangedPrayer, expectDamage, caseLabel) => {
    assert(east.isActive && east.levels[HP_STAT] > 0,
      `${caseLabel}: the actual East head is alive before this independent defence case`);
    writeVar(p, 'com_rangedef', rangedDef);
    writeVar(p, 'com_magicdef', magicDef);
    writeVar(p, 'prayer12', magicPrayer);
    writeVar(p, 'prayer13', rangedPrayer);
    writeVar(p, 'poison', 0);
    const hits = [];
    const observeHits = () => {
      if (p.masks & PlayerInfoProt.DAMAGE) {
        hits.push({ tick: World.currentTick, damage: p.hitmarkDamage, type: p.hitmarkType });
      }
      if (p.masks & PlayerInfoProt.DAMAGE2) {
        hits.push({ tick: World.currentTick, damage: p.hitmark2Damage, type: p.hitmark2Type });
      }
    };
    const start = World.currentTick;
    east.vars[NPC_ACTION_DELAY] = start;
    withCombatRandom(0.999999999999, () =>
      runProc('soulbane_tolna_npc_attack', p, [], east));
    assert.equal(east.vars[NPC_ACTION_DELAY], start + TOLNA_HEADS.find(head => head.id === east.type).rangedTicks,
      `${caseLabel}: East reached its native Ranged attack branch`);
    east.vars[NPC_ACTION_DELAY] = World.currentTick + 2048;
    for (let tick = 0; tick < 128; tick++) worldTick(observeHits);
    const rangedHits = hits.filter(hit => hit.type !== poisonHitmark);
    assert(rangedHits.length > 0, `${caseLabel}: the real incoming projectile emits its native hitmark`);
    const rangedDamage = rangedHits.reduce((total, hit) => total + hit.damage, 0);
    const poisonDamage = hits.filter(hit => hit.type === poisonHitmark)
      .reduce((total, hit) => total + hit.damage, 0);
    assert.equal(rangedDamage > 0, expectDamage,
      `${caseLabel}: actual ranged hitmarks follow Ranged defence/protection independently of later poison`);
    console.log('Tolna Ranged defence', JSON.stringify({ caseLabel, rangedDamage, poisonDamage, hits }));
    assert.deepEqual(tolnaActorPositions(heads), beforePositions,
      `${caseLabel}: ranged resolution does not move the product-spawned heads`);
    assert(east.isActive && east.levels[HP_STAT] > 0,
      `${caseLabel}: observing incoming damage does not retaliate against and kill the fixture target`);
    return rangedDamage;
  };
  writeVar(p, 'prayer12', 0);
  writeVar(p, 'prayer13', 0);
  writeVar(p, 'com_rangedef', 1000000);
  writeVar(p, 'com_magicdef', 0);
  assert(runProcInt('player_defence_roll_specific', p, [rangedStyle], east) >
    runProcInt('player_defence_roll_specific', p, [magicStyle], east),
  `${label}: native Ranged defence is independently distinct from Magic defence`);
  const rangedMiss = launch(1000000, 0, 0, 0, false, `${label} high Ranged defence`);
  const magicPrayerHit = launch(0, 1000000, 1, 0, true, `${label} Protect from Magic only`);
  const missilePrayerBlock = launch(0, 1000000, 0, 1, false, `${label} Protect from Missiles`);
  assert.equal(rangedMiss, 0, `${label}: high Ranged defence rejects the shot`);
  assert(magicPrayerHit > 0, `${label}: Protect from Magic does not block the Ranged attack`);
  assert.equal(missilePrayerBlock, 0, `${label}: Protect from Missiles prevents ranged damage`);
  writeVar(p, 'prayer12', 0);
  writeVar(p, 'prayer13', 1);
  writeVar(p, 'option_nodef', previousRetaliate);
}

function tolnaSurfaceSpeaker(p, label) {
  const multiId = requiredId('NpcType', 'soulbane_tolna_multi');
  const topId = requiredId('NpcType', 'soulbane_tolna_top');
  const multi = types.NpcType.get(multiId);
  assert.equal(multi.multivarbit, requiredId('VarBitType', 'soulbane_tolna_pres'),
    `${label}: original surface multi selects on Tolna's presence bit`);
  assert.deepEqual(Array.from(multi.multinpc), [-1, topId],
    `${label}: original cache hides Tolna at presence zero and selects the top form at presence one`);
  for (const typeId of [multiId, topId]) {
    const type = types.NpcType.get(typeId);
    const trigger = ScriptProvider.getByTrigger(ServerTriggerType.OPNPC1, typeId, type.category);
    assert(trigger, `${label}: packed ${type.debugname} has a native Talk-to selector`);
  }
  const npc = activeNpc('soulbane_tolna_multi');
  assert.equal(npc.level, 0, `${label}: selected Talk-to target is the original surface NPC`);
  assert.equal(resolveNpcType(types.NpcType.get(npc.type), p).id, topId,
    `${label}: the native per-player cache selector displays Tolna after reunion`);
  return npc;
}
function assertTolnaCompletionScroll(p, label) {
  // The offline Player omits NetworkPlayer.encodeOut; inspect the actual queued modal,
  // not an IfOpenMain packet that only a connected NetworkPlayer emits.
  assert.equal(p.modalMain, requiredId('Component', 'questscroll_death'),
    `${label}: native completion selects the actual reward-scroll main modal`);
  assert.equal(p.refreshModal, true, `${label}: native completion queues that modal for network output`);
  const textPackets = p.packets.filter(packet => packet.constructor.name === 'IfSetText');
  const questPointLine = textPackets.find(packet =>
    packet.component === requiredId('Component', 'questscroll_death:com_9'));
  assert(questPointLine, `${label}: native reward scroll writes its quest-point line`);
  assert.match(questPointLine.text, /\b1\b/, `${label}: completion scroll states the single quest point`);
  assert.match(questPointLine.text, /Quest Point/i, `${label}: completion scroll labels its quest-point amount`);
  const rewards = textPackets.filter(packet => [10, 11, 12, 13, 14].some(index =>
    packet.component === requiredId('Component', `questscroll_death:com_${index}`)))
    .map(packet => packet.text).join(' ');
  assert.match(rewards, /\b500\b.*Defence XP/i, `${label}: completion UI reports 500 Defence XP`);
  assert.match(rewards, /\b500\b.*Hitpoints XP/i, `${label}: completion UI reports 500 Hitpoints XP`);
  assert.match(rewards, /\b500\b.*Coins/i, `${label}: completion UI reports 500 Coins`);
}
function leaveTolnaCopy(p, label, choices = []) {
  const oldUid = instanceUid(p);
  const exit = tolnaFinalExitLoc(p);
  goToStand(p, exit, `${label}: walk to the original final-room Exit`);
  writeVar(p, 'musicplay', 1);
  const previousSong = readVar(p, 'currentsong');
  const result = operateLoc(p, exit, 1, choices, `${label}: native final-room exit`);
  assert.equal(result.trigger.name, '[oploc1,soul_bane_tolna_void_small]',
    `${label}: final-room departure uses the original packed Exit`);
  assert.equal(instanceUid(p), 0, `${label}: native departure releases the temporary instance`);
  assert.equal(World.instances.findInstanceByUid(oldUid - 1), null,
    `${label}: native departure deletes the entire private copy`);
  assert.equal(remainingNpcsWithInstance(oldUid).length, 0,
    `${label}: native departure removes live, queued and inert instance actors`);
  assert.equal(readVar(p, 'currentsong'), previousSong,
    `${label}: arena exit leaves music selection to the ordinary mapzone phase`);
  const unlocks = musicUnlockSnapshot(p);
  worldTick();
  const song = musicRegionSongAt(p.level, p.x, p.z);
  assert.equal(readVar(p, 'currentsong'), song.track,
    `${label}: ordinary surface mapzone restores its published region song`);
  assertMusicUnlockTransition(p, unlocks, song, `${label}: ordinary surface music`);
  return oldUid;
}
function testTolnaCompletionProgression(p, label = 'native Tolna completion progression') {
  const { heads, geometry } = enterTolnaFinalRoom(p, label);
  const intro = tolnaIntroPages(p, label);
  assert.deepEqual(TOLNA_DEATH_BITS.map(name => readVar(p, name)), [0, 0, 0],
    `${label}: the intro continuation does not fabricate head deaths`);
  assertOwnedTolnaActors(p, 3, false, `${label} stage-11 combat group`);
  for (const { spec, npc } of heads) {
    assertTolnaNativeGates(p, npc, true, `${label} owner ${spec.type} combat gate`);
  }
  testForeignLaterRoomPackets(p, heads.map(({ npc }) => npc), `${label} foreign owner gates`);
  assert.equal(stage(p), TOLNA_ACTIVE_STAGE, `${label}: foreign packets cannot advance the owner's stage`);
  writeVar(p, 'prayer13', 1);
  writeVar(p, 'prayer14', 1);
  const intervals = testTolnaNativeAttackIntervals(p, heads, label);
  testTolnaRangedDefence(p, heads, label);
  const south = heads.find(({ spec }) => spec.row === 'soulbane_tolna_south');
  stableHitRandom(() => castTolnaWindStrike(p, south.npc, `${label} owner APNPCT cast`));
  assert.equal(stage(p), TOLNA_ACTIVE_STAGE, `${label}: a real cast cannot substitute for the three deaths`);
  assert.deepEqual(TOLNA_DEATH_BITS.map(name => readVar(p, name)), [0, 0, 0],
    `${label}: cast damage alone earns no head-death credit`);
  const meleeKills = [
    killTolnaHeadByMelee(p, heads, south, `${label} ordinary South death`),
    killTolnaHeadByMelee(p, heads, heads.find(({ spec }) => spec.row === 'soulbane_tolna_north'),
      `${label} ordinary North death`)
  ];
  assert.deepEqual(TOLNA_DEATH_BITS.map(name => readVar(p, name)), [1, 0, 1],
    `${label}: two ordinary native deaths set only their own unique credit bits`);
  assert.equal(stage(p), TOLNA_ACTIVE_STAGE, `${label}: two deaths cannot advance to stage 12`);
  assertOwnedTolnaActors(p, 1, false, `${label} before final poison death`);
  const east = heads.find(({ spec }) => spec.row === 'soulbane_tolna_east');
  poisonKillTolnaEast(p, heads, east, `${label} final East poison death`);
  for (const { spec, npc } of heads) {
    assertTolnaNativeGates(p, npc, false, `${label} completed stage-12 gate ${spec.type}`);
  }
  assert.equal(readVar(p, 'soulbane_tolna_pres'), 0,
    `${label}: stage 12 alone does not set human-presence`);
  assert.equal(readVar(p, 'soulbane_launa_pres'), 0,
    `${label}: stage 12 alone does not set parent-presence`);

  const stage12Uid = leaveTolnaCopy(p, `${label} stage-12 incomplete reunion leave`);
  assert.equal(stage(p), TOLNA_CLEAR_STAGE, `${label}: leaving after combat preserves stage 12`);
  assert.deepEqual(TOLNA_DEATH_BITS.map(name => readVar(p, name)), [1, 1, 1],
    `${label}: complete head credit persists through ordinary exit`);
  enterTolnaByRift(p, `${label} stage-12 rift re-entry`);
  assert.equal(stage(p), TOLNA_CLEAR_STAGE, `${label}: rift re-entry preserves the genuine stage-12 clear`);
  const reentryUid = instanceUid(p);
  const reentryActors = assertOwnedTolnaActors(p, 0, true, `${label} stage-12 re-entry actors`);
  assert.deepEqual(TOLNA_DEATH_BITS.map(name => readVar(p, name)), [1, 1, 1],
    `${label}: re-entry does not reset complete head credit`);
  assert.equal(readVar(p, 'soulbane_tolna_pres'), 0,
    `${label}: stage-12 re-entry still precedes human return`);
  assert.equal(readVar(p, 'soulbane_launa_pres'), 0,
    `${label}: stage-12 re-entry still precedes parent return`);
  const human = reentryActors.find(npc => npc.type === TOLNA_HUMAN || npc.baseType === TOLNA_HUMAN);
  assert(human, `${label}: actual product-spawned Tolna is available for the reunion`);
  goToStand(p, human, `${label}: walk to the actual private Tolna reunion target`);
  const reunion = operateNpc(p, human, 1, [], `${label} actual private Tolna reunion`);
  assert.match(reunion.trigger.name, /^\[opnpc1,soulbane_tolna_(?:top|multi)\]$/,
    `${label}: owner conversation dispatches through the native Tolna selector`);
  assert(reunion.text.includes('Tolna?') && reunion.text.includes("I'm just glad I could help."),
    `${label}: the complete compiled human reunion runs through its real dialogue pages`);
  assert.equal(stage(p), TOLNA_CLEAR_STAGE, `${label}: human reunion sets presence without claiming the quest`);
  assert.equal(readVar(p, 'soulbane_tolna_pres'), 1, `${label}: human-presence is written only by the reunion`);
  assert.equal(readVar(p, 'soulbane_launa_pres'), 1, `${label}: parent-presence follows the completed reunion`);
  assert.equal(instanceUid(p), 0, `${label}: reunion uses the native leave and cleanup path`);
  assert.equal(World.instances.findInstanceByUid(reentryUid - 1), null,
    `${label}: reunion deletes the re-entered private region`);
  assert.equal(remainingNpcsWithInstance(reentryUid).length, 0,
    `${label}: reunion cleanup removes every re-entered actor and inert corpse`);
  assert.equal(remainingNpcsWithInstance(stage12Uid).length, 0,
    `${label}: reunion cleanup removes every old head, Brana and inert corpse`);

  const surfaceTolna = tolnaSurfaceSpeaker(p, label);
  goToStand(p, surfaceTolna, `${label}: walk to the actual surface Tolna reward target`);
  fillTolnaInventory(p, `${label} reward overflow`);
  const xpBeforeReward = xpSnapshot(p);
  const qpBeforeReward = readVar(p, 'qp');
  const coinsBeforeReward = count(p, 'coins');
  const rewardMark = p.packets.length;
  const reward = operateNpc(p, surfaceTolna, 1, [], `${label} actual surface Tolna reward`);
  assert.match(reward.trigger.name, /^\[opnpc1,soulbane_tolna_(?:top|multi)\]$/,
    `${label}: surface reward dispatches from Tolna, never Launa`);
  assert.equal(stage(p), TOLNA_COMPLETE_STAGE, `${label}: actual surface conversation alone writes stage 13`);
  assert.equal(TOLNA_COMPLETE_STAGE, 13, `${label}: global Soulbane completion stage is 13`);
  assert.equal(readVar(p, 'soulbane_tolna_pres'), 1, `${label}: completed surface reward preserves human-presence`);
  assert.equal(readVar(p, 'soulbane_launa_pres'), 1, `${label}: completed surface reward preserves parent-presence`);
  const xpAfterReward = xpSnapshot(p);
  for (let skill = 0; skill < xpAfterReward.length; skill++) {
    const expected = skill === PlayerStat.DEFENCE || skill === PlayerStat.HITPOINTS ? 5000 : 0;
    assert.equal(xpAfterReward[skill] - xpBeforeReward[skill], expected,
      `${label}: surface reward grants exactly ${expected} native tenths to stat ${skill}`);
  }
  assert.equal(readVar(p, 'qp'), qpBeforeReward + 1,
    `${label}: surface reward awards exactly one quest point`);
  assert.equal(configConstant('scripts/general/configs/quest.constant', 'soulbane_questpoints'), 1,
    `${label}: the source quest-point constant is one`);
  assert.equal(count(p, 'coins'), coinsBeforeReward,
    `${label}: the full inventory leaves the native coin award on the ground`);
  const groundCoins = World.getObj(p.x, p.z, p.level, obj('coins'), p.hash64);
  assert(groundCoins, `${label}: full-bag inv_add creates the ordinary owner-bound ground overflow`);
  assert.equal(groundCoins.count, questConstant('soulbane_reward_coins'),
    `${label}: the owned ground stack contains all 500 native reward coins`);
  assert.equal(groundCoins.receiver64, p.hash64,
    `${label}: only the quest owner receives the overflow ground stack`);
  assertTolnaCompletionScroll(p, `${label} native completion UI`);
  assert(CloseModalHandler.handle(new CloseModal(), p), `${label}: native completion-scroll Close is admitted`);
  worldTick();
  assert.equal(p.modalMain, -1, `${label}: native Close clears the completed reward scroll`);
  const rewardPackets = p.packets.slice(rewardMark);
  assert(rewardPackets.some(packet => packet.constructor.name === 'IfSetColour'
    && packet.component === QUEST_ROW), `${label}: native quest progress updates the actual Soulbane row`);
  const inventoryAfterReward = normalInventory(p);
  const qpAfterReward = readVar(p, 'qp');
  const coinsAfterReward = count(p, 'coins');
  p.packets.length = 0;
  const repeatNpc = tolnaSurfaceSpeaker(p, `${label} repeat selector`);
  const repeat = operateNpc(p, repeatNpc, 1, [], `${label} surface repeat conversation`);
  assert.match(repeat.trigger.name, /^\[opnpc1,soulbane_tolna_(?:top|multi)\]$/,
    `${label}: repeat remains on the actual surface Tolna dispatch`);
  assert.equal(stage(p), TOLNA_COMPLETE_STAGE, `${label}: repeat conversation cannot change completion`);
  assert.deepEqual(xpSnapshot(p), xpAfterReward, `${label}: repeat awards no duplicate Defence or Hitpoints XP`);
  assert.equal(readVar(p, 'qp'), qpAfterReward, `${label}: repeat awards no duplicate quest point`);
  assert.equal(count(p, 'coins'), coinsAfterReward, `${label}: repeat awards no duplicate inventory coins`);
  assert.deepEqual(normalInventory(p), inventoryAfterReward, `${label}: repeat leaves the full ordinary bag intact`);
  assert.equal(p.modalMain, -1, `${label}: repeat opens no second reward scroll`);
  const repeatGroundCoins = World.getObj(p.x, p.z, p.level, obj('coins'), p.hash64);
  assert.equal(repeatGroundCoins?.count ?? 0, groundCoins.count,
    `${label}: repeat creates no duplicate owner-bound ground reward`);
  assert.equal(inventory(p).filter(Boolean).length, types.InvType.get(inv).size,
    `${label}: all ordinary inventory slots remain occupied through the repeat`);

  assert.equal(World.instances.findInstanceByUid(reentryUid - 1), null,
    `${label}: completed relog keeps no Tolna copy from the stage-12 reunion`);
  assert.equal(remainingNpcsWithInstance(reentryUid).length, 0,
    `${label}: completed relog keeps no former head, Brana, human or corpse`);
  const reloaded = nativeLogoutAndReload(p, `${label} completed stage-13 relog`);
  assert.equal(stage(reloaded), TOLNA_COMPLETE_STAGE, `${label}: completed stage 13 persists through native relog`);
  assert.equal(instanceUid(reloaded), 0, `${label}: completed relog has no temporary instance`);
  assert.deepEqual(xpSnapshot(reloaded), xpAfterReward, `${label}: relog preserves exactly one completion XP award`);
  assert.equal(readVar(reloaded, 'qp'), qpAfterReward, `${label}: relog preserves exactly one quest point`);
  assert.deepEqual(normalInventory(reloaded), inventoryAfterReward,
    `${label}: relog preserves all ordinary bag contents`);
  assert.equal(World.instances.findInstanceByUid(reentryUid - 1), null,
    `${label}: completed relog retains no old private copy`);
  assert.equal(remainingNpcsWithInstance(reentryUid).length, 0,
    `${label}: completed relog retains no old-room NPC or inert corpse`);
  reloaded.packets.length = 0;
  const reloadedTolna = tolnaSurfaceSpeaker(reloaded, `${label} relog selector`);
  operateNpc(reloaded, reloadedTolna, 1, [], `${label} post-relog repeat`);
  assert.equal(stage(reloaded), TOLNA_COMPLETE_STAGE, `${label}: relog repeat cannot open postquest progression`);
  assert.deepEqual(xpSnapshot(reloaded), xpAfterReward, `${label}: relog repeat grants no second XP award`);
  assert.equal(readVar(reloaded, 'qp'), qpAfterReward, `${label}: relog repeat grants no second quest point`);
  assert.equal(reloaded.modalMain, -1, `${label}: relog repeat opens no completion scroll`);
  const relogGround = World.getObj(reloaded.x, reloaded.z, reloaded.level, obj('coins'), reloaded.hash64);
  assert((relogGround?.count ?? 0) <= groundCoins.count,
    `${label}: completed relog cannot create another ground coin award`);
  const rift = riftLoc();
  goToStand(reloaded, rift, `${label}: attempt postquest rift access`);
  const oldSurface = tile(reloaded);
  const denied = operateLoc(reloaded, rift, 1, [], `${label}: completed-state rift admission`);
  assert.match(denied.trigger.name, /^\[oploc1,soulbane_falloff2_rope(?:_multi)?\]$/,
    `${label}: rift still uses its original native handler after completion`);
  assert.equal(stage(reloaded), TOLNA_COMPLETE_STAGE, `${label}: stage-13 rift use does not reopen the quest`);
  assert.equal(instanceUid(reloaded), 0, `${label}: completed account cannot create a postquest instance`);
  assert.equal(tolnaActorsFor(reloaded).length, 0, `${label}: no postquest final actors are accessible`);
  assert.deepEqual(tile(reloaded), oldSurface,
    `${label}: refused postquest access leaves the account at its surface tile`);
  console.log(`Tolna native finale ${JSON.stringify({ geometry, introOverheads: intro.overheads.length, intervals, ordinaryMeleeKills: meleeKills, stage: stage(reloaded), rewardXp: 5000, coins: groundCoins.count })}`);
  return reloaded;
}

function testTolnaCompletionCase() {
  const label = 'native Tolna completion progression';
  const p = tolnaPrerequisiteFixture(`${label}: stage-9 prerequisite`);
  const completed = testTolnaCompletionProgression(p, label);
  cleanupTolnaFixturePlayer(completed, label);
}

function enterTolnaByRift(p, label, musicMode = 1) {
  assert.equal(instanceUid(p), 0, `${label}: an ordinary surface account has no active copy`);
  const rift = riftLoc();
  goToStand(p, rift, `${label}: walk to the original rift`);
  const music = beginRoomMusicObservation(p, RAGE_SONG, musicMode, label,
    { previousTrack: MANUAL_PREVIOUS_SONG.track });
  const entered = operateLoc(p, rift, 1, [], `${label}: native rift re-entry`);
  assert.match(entered.trigger.name, /^\[oploc1,soulbane_falloff2_rope(?:_multi)?\]$/,
    `${label}: rift admission uses the original Climb-down loc`);
  assert.notEqual(instanceUid(p), 0, `${label}: native rift admission creates the private copy`);
  assertRoomMusicState(p, music, `${label}: stage-${stage(p)} Tolna arena re-entry`);
  return entered;
}
function killTolnaHeadByMelee(p, heads, head, label) {
  const { spec, npc } = head;
  const stand = tolnaPlayerStand(p, npc, 'adjacent', `${label} melee stand`);
  moveToTile(p, stand, `${label}: native walk to ${spec.type}`);
  assert(p.inOperableDistance(npc), `${label}: ordinary player melee can reach the 3x3 head`);
  setTolnaHeadsReady(heads, World.currentTick + 2048);
  const creditsBefore = TOLNA_DEATH_BITS.reduce((sum, name) => sum + readVar(p, name), 0);
  let attempts = 0;
  while (npc.levels[HP_STAT] > 0 && attempts < 16) {
    awaitPlayerActionReady(p, `${label} native player cooldown`);
    const hpBefore = npc.levels[HP_STAT];
    withCombatRandom(0.999999999999, () =>
      runNativeAttack(p, npc, `${label}: actual player melee`, 120, true));
    assert(npc.levels[HP_STAT] < hpBefore, `${label}: ordinary queued melee damage lands`);
    attempts++;
  }
  assert.equal(npc.levels[HP_STAT], 0, `${label}: ordinary native damage kills ${spec.type}`);
  const bit = TOLNA_DEATH_BITS[TOLNA_HEADS.indexOf(spec)];
  for (let tick = 0; tick < 32 && readVar(p, bit) === 0; tick++) worldTick();
  assert.equal(readVar(p, bit), 1, `${label}: native AI_QUEUE3 and owner credit set exactly one head bit`);
  assert.equal(stage(p), TOLNA_ACTIVE_STAGE, `${label}: fewer than three head deaths cannot clear the room`);
  assert.equal(readVar(p, 'soulbane_final_tol1dead') + readVar(p, 'soulbane_final_tol2dead')
    + readVar(p, 'soulbane_final_tol3dead'), creditsBefore + 1,
  `${label}: a native death earns one boolean credit without duplicates`);
  return attempts;
}
function equipTolnaPoisonWeapon(p, label) {
  if (count(p, 'rune_scimitar', types.InvType.getId('worn')) > 0) {
    assert(remove(p, 'rune_scimitar'), `${label}: native Wield removal unequips the ordinary scimitar`);
  }
  if (count(p, 'iron_dagger_p') === 0) {
    assert.equal(p.invAdd(inv, obj('iron_dagger_p'), 1), 1,
      `${label}: seed one actual packed poison weapon`);
  }
  assert(held(p, 'iron_dagger_p', 2), `${label}: native Wield equips the actual poisoned dagger`);
  p.setLevel(PlayerStat.STRENGTH, 1);
  p.combatLevel = p.getCombatLevel();
  const severity = types.ObjType.get(obj('iron_dagger_p')).params.get(POISON_SEVERITY_PARAM);
  assert(severity > 0, `${label}: the selected packed dagger declares native poison severity`);
  return severity;
}
function poisonKillTolnaEast(p, heads, east, label) {
  const severity = equipTolnaPoisonWeapon(p, label);
  const living = heads.filter(({ npc }) => npc.levels[HP_STAT] > 0);
  assert.deepEqual(living.map(({ spec }) => spec.row), ['soulbane_tolna_east'],
    `${label}: only East remains eligible for shared actual player poison`);
  const stand = tolnaPlayerStand(p, east.npc, 'adjacent', `${label} poisoned melee stand`);
  moveToTile(p, stand, `${label}: reach the surviving East head on foot`);
  setTolnaHeadsReady(heads, World.currentTick + 2048);
  const sequences = [
    [0.999999999999, 0, 0.999999999999, 0],
    [0, 0.999999999999, 0, 0.999999999999],
    [0.999999999999, 0.999999999999, 0, 0],
    [0, 0, 0.999999999999, 0.999999999999]
  ];
  for (let attempt = 0; attempt < 8 && east.npc.vars[NPC_POISON] === 0; attempt++) {
    awaitPlayerActionReady(p, `${label} poison weapon cooldown`);
    const hpBefore = east.npc.levels[HP_STAT];
    withTolnaCombatRandom(sequences[attempt % sequences.length], () =>
      runNativeAttack(p, east.npc, `${label}: native poisoned melee hit ${attempt + 1}`, 120, true));
    assert(east.npc.levels[HP_STAT] < hpBefore,
      `${label}: actual player melee damage reaches East through the native queue`);
  }
  assert.equal(east.npc.vars[NPC_POISON], severity,
    `${label}: an actual weapon proc applies its cache-declared poison severity to East`);
  const hitHp = east.npc.levels[HP_STAT];
  const eastBit = TOLNA_DEATH_BITS[TOLNA_HEADS.indexOf(east.spec)];
  assert.equal(readVar(p, eastBit), 0, `${label}: poison application is not head-death credit`);
  assert.equal(stage(p), TOLNA_ACTIVE_STAGE, `${label}: poison application alone cannot clear stage 11`);
  let sawNativePoisonDamage = false;
  for (let tick = 0; tick < 2048 && stage(p) !== TOLNA_CLEAR_STAGE; tick++) {
    const hpBefore = east.npc.levels[HP_STAT];
    worldTick();
    if (east.npc.levels[HP_STAT] < hpBefore) sawNativePoisonDamage = true;
    if (stage(p) === TOLNA_CLEAR_STAGE) {
      assert.deepEqual(TOLNA_DEATH_BITS.map(name => readVar(p, name)), [1, 1, 1],
        `${label}: the final credit is admitted only after all three real head deaths`);
    } else {
      assert.equal(stage(p), TOLNA_ACTIVE_STAGE, `${label}: no early stage-12 transition occurs`);
    }
  }
  assert(sawNativePoisonDamage, `${label}: the native NPC poison timer, not another player hit, damages East`);
  assert.equal(hitHp > 0, true, `${label}: the real weapon hit does not fake a poisoned death`);
  assert.equal(east.npc.levels[HP_STAT], 0, `${label}: native poison eventually kills the final head`);
  assert.equal(readVar(p, eastBit), 1, `${label}: native poison death reaches ordinary AI_QUEUE3 credit`);
  assert.equal(stage(p), TOLNA_CLEAR_STAGE, `${label}: three distinct native deaths produce stage 12`);
  for (let tick = 0; tick < 8; tick++) worldTick();
  assert.deepEqual(TOLNA_DEATH_BITS.map(name => readVar(p, name)), [1, 1, 1],
    `${label}: later corpse ticks cannot duplicate any death credit`);
  const actors = tolnaActorsFor(p);
  assert.equal(actors.filter(npc => TOLNA_HEAD_IDS.has(npc.type) || TOLNA_HEAD_IDS.has(npc.baseType)).length, 0,
    `${label}: native death cleanup removes all three head actors before reunion`);
  assert.equal(actors.filter(npc => npc.type === TOLNA_HUMAN || npc.baseType === TOLNA_HUMAN).length, 1,
    `${label}: the human appears only after all three credits`);
}
function fillTolnaInventory(p, label) {
  assert.equal(count(p, 'coins'), 0, `${label}: the full-bag fixture begins without a stackable coin slot`);
  const inventorySize = types.InvType.get(inv).size;
  let occupied = inventory(p).filter(Boolean).length;
  const fillerNames = [];
  for (let itemId = 0; itemId < types.ObjType.count && occupied < inventorySize; itemId++) {
    const item = types.ObjType.get(itemId);
    if (!item?.debugname || item.debugname === 'null' || item.stackable || item.dummyitem !== 0
      || WEAPON_IDS.has(itemId) || count(p, item.debugname) > 0) continue;
    if (p.invAdd(inv, itemId, 1) === 1) {
      fillerNames.push(item.debugname);
      occupied++;
    }
  }
  assert.equal(occupied, inventorySize, `${label}: ordinary cache items fill every inventory slot`);
  assert.equal(inventory(p).filter(Boolean).length, inventorySize,
    `${label}: the native inventory reports a genuinely full bag`);
  return fillerNames;
}

function tolnaPrerequisiteFixture(label) {
  // stage 9 seeded as a prerequisite; not a progression proof.
  return laterRoomFixture(HOPE_CLEAR_STAGE, label);
}
function tolnaLiveHeadSet(p, label) {
  const heads = tolnaHeadsFor(p);
  assertOwnedTolnaActors(p, 3, false, `${label} live stage-11 actors`);
  assert.deepEqual(heads.map(({ npc }) => npc.levels[HP_STAT]), [37, 37, 37],
    `${label}: fresh product heads keep their authored HP`);
  return heads;
}
function cleanupTolnaFixturePlayer(p, label) {
  p.clearInteraction();
  for (let tick = 0; tick < 128 && World.currentTick < p.preventLogoutUntil; tick++) worldTick();
  assert(World.currentTick >= p.preventLogoutUntil,
    `${label}: actual logout cooldown expires without bypass`);
  p.requestLogout = true;
  p.lastResponse = World.currentTick;
  worldTick();
  assert(![...World.playerLoop.all()].includes(p), `${label}: isolated account leaves through native logout`);
}
function testTolnaSharedPoison() {
  const label = 'Tolna shared native poison';
  const p = tolnaPrerequisiteFixture(`${label}: stage-9 prerequisite`);
  const { heads } = enterTolnaFinalRoom(p, label, false);
  tolnaIntroPages(p, label);
  assertOwnedTolnaActors(p, 3, false, `${label} before poison`);
  const severity = equipTolnaPoisonWeapon(p, label);
  const south = heads.find(({ spec }) => spec.row === 'soulbane_tolna_south');
  const stand = tolnaPlayerStand(p, south.npc, 'adjacent', `${label} player poison attack`);
  moveToTile(p, stand, `${label}: native path to the South head`);
  setTolnaHeadsReady(heads, World.currentTick + 2048);
  const sequences = [
    [0.999999999999, 0, 0.999999999999, 0],
    [0, 0.999999999999, 0, 0.999999999999],
    [0.999999999999, 0.999999999999, 0, 0],
    [0, 0, 0.999999999999, 0.999999999999]
  ];
  for (let attempt = 0; attempt < 8 && south.npc.vars[NPC_POISON] === 0; attempt++) {
    awaitPlayerActionReady(p, `${label} poison weapon cooldown`);
    const hpBefore = south.npc.levels[HP_STAT];
    withTolnaCombatRandom(sequences[attempt % sequences.length], () =>
      runNativeAttack(p, south.npc, `${label}: real poisoned weapon hit ${attempt + 1}`, 120, true));
    assert(south.npc.levels[HP_STAT] < hpBefore,
      `${label}: native player melee queue lands on the South head`);
  }
  assert.deepEqual(heads.map(({ npc }) => npc.vars[NPC_POISON]), [severity, severity, severity],
    `${label}: native owner context shares actual player weapon poison to all three live UIDs`);
  assert.deepEqual(TOLNA_DEATH_BITS.map(name => readVar(p, name)), [0, 0, 0],
    `${label}: shared poison is not a seeded corpse or death credit`);
  assert.equal(stage(p), TOLNA_ACTIVE_STAGE,
    `${label}: sharing real player poison does not skip the three death queues`);
  const poisonDamage = new Set();
  const deathActors = new Set();
  for (let tick = 0; tick < 2048 && stage(p) !== TOLNA_CLEAR_STAGE; tick++) {
    const hpBefore = heads.map(({ npc }) => npc.levels[HP_STAT]);
    worldTick();
    heads.forEach(({ spec, npc }, index) => {
      if (npc.levels[HP_STAT] < hpBefore[index]) poisonDamage.add(spec.row);
      if (npc.levels[HP_STAT] === 0) deathActors.add(spec.row);
    });
    if (stage(p) === TOLNA_CLEAR_STAGE) {
      assert.deepEqual(TOLNA_DEATH_BITS.map(name => readVar(p, name)), [1, 1, 1],
        `${label}: shared native poison can clear only after all native death credits`);
    } else {
      assert.equal(stage(p), TOLNA_ACTIVE_STAGE, `${label}: no early stage-12 transition occurs`);
    }
  }
  assert.equal(stage(p), TOLNA_CLEAR_STAGE, `${label}: native poison deaths complete the real three-head queue`);
  assert.deepEqual([...poisonDamage].sort(), TOLNA_HEADS.map(head => head.row).sort(),
    `${label}: the native poison timer damages every shared head`);
  assert.deepEqual([...deathActors].sort(), TOLNA_HEADS.map(head => head.row).sort(),
    `${label}: each real poisoned head reaches zero HP`);
  assert.deepEqual(TOLNA_DEATH_BITS.map(name => readVar(p, name)), [1, 1, 1],
    `${label}: three actual poisoned deaths earn three distinct credit bits`);
  assertOwnedTolnaActors(p, 0, true, `${label} post-poison completion`);
  assert.equal(readVar(p, 'soulbane_tolna_pres'), 0,
    `${label}: native poison completion does not set reunion presence`);
  const uid = leaveTolnaCopy(p, `${label} stage-12 cleanup`);
  assert.equal(remainingNpcsWithInstance(uid).length, 0,
    `${label}: native cleanup removes all three corpses, Brana and human`);
  cleanupTolnaFixturePlayer(p, label);
  console.log(`Tolna shared poison ${JSON.stringify({ severity, sharedHeads: heads.length, poisonDeaths: deathActors.size })}`);
}
function testTolnaIncompleteLifecycle() {
  for (const mode of ['leave', 'logout', 'death']) {
    const label = `Tolna incomplete ${mode}`;
    const p = tolnaPrerequisiteFixture(`${label}: stage-9 prerequisite`);
    const { heads } = enterTolnaFinalRoom(p, label, false);
    tolnaIntroPages(p, label);
    const south = heads.find(({ spec }) => spec.row === 'soulbane_tolna_south');
    killTolnaHeadByMelee(p, heads, south, `${label} one produced native death`);
    assert.deepEqual(TOLNA_DEATH_BITS.map(name => readVar(p, name)), [1, 0, 0],
      `${label}: one real death precedes the selected cleanup path`);
    assert.equal(stage(p), TOLNA_ACTIVE_STAGE, `${label}: one death remains an incomplete stage-11 fight`);
    const earnedXp = xpSnapshot(p);
    const earnedQuestPoints = readVar(p, 'qp');
    const oldUid = instanceUid(p);
    if (mode === 'leave') {
      leaveTolnaCopy(p, `${label} ordinary Exit`, [1]);
    } else if (mode === 'logout') {
      setTolnaHeadsReady(heads, World.currentTick + 2048);
      const reloaded = nativeLogoutAndReload(p, `${label} actual logout/relogin`);
      assert.equal(stage(reloaded), TOLNA_ACTIVE_STAGE, `${label}: relog preserves incomplete stage 11`);
      assert.equal(instanceUid(reloaded), 0, `${label}: relog clears the temporary instance handle`);
      assert.deepEqual(TOLNA_DEATH_BITS.map(name => readVar(reloaded, name)), [0, 0, 0],
        `${label}: login reset clears every unfinished head credit`);
      assert.deepEqual(xpSnapshot(reloaded), earnedXp,
        `${label}: relog preserves only native combat XP from the one produced death`);
      assert.equal(readVar(reloaded, 'qp'), earnedQuestPoints,
        `${label}: incomplete relog awards no quest point`);
      assert.equal(World.instances.findInstanceByUid(oldUid - 1), null,
        `${label}: logout deletes the old private region`);
      assert.equal(remainingNpcsWithInstance(oldUid).length, 0,
        `${label}: logout removes live and inert old-room actors`);
      enterTolnaByRift(reloaded, `${label} fresh rift re-entry`);
      assert.deepEqual(TOLNA_DEATH_BITS.map(name => readVar(reloaded, name)), [0, 0, 0],
        `${label}: fresh re-entry preserves only the reset incomplete boundary`);
      assert.equal(tolnaLiveHeadSet(reloaded, `${label} fresh re-entry`).length, 3,
        `${label}: incomplete logout restarts all three product heads`);
      assert.deepEqual(xpSnapshot(reloaded), earnedXp,
        `${label}: fresh re-entry awards no XP beyond the native kill`);
      assert.equal(readVar(reloaded, 'qp'), earnedQuestPoints,
        `${label}: fresh re-entry awards no quest point`);
      leaveTolnaCopy(reloaded, `${label} re-entry cleanup`, [1]);
      cleanupTolnaFixturePlayer(reloaded, label);
      continue;
    } else {
      p.levels[PlayerStat.HITPOINTS] = 0;
      runProc('player_die', p);
      for (let tick = 0; tick < 80 && (p.activeScript || p.queue.head() !== null); tick++) worldTick();
      assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED,
        `${label}: ordinary death queue and animation settle natively`);
      for (let tick = 0; tick < 3; tick++) worldTick();
      const surface = surfaceTile();
      safeTeleport(p, { level: surface[0], x: surface[1], z: surface[2] },
        `${label}: return to the actual rift after ordinary death`);
    }
    assert.equal(stage(p), TOLNA_ACTIVE_STAGE, `${label}: cleanup preserves incomplete stage 11`);
    assert.equal(instanceUid(p), 0, `${label}: cleanup releases the old temporary UID`);
    assert.deepEqual(TOLNA_DEATH_BITS.map(name => readVar(p, name)), [0, 0, 0],
      `${label}: cleanup resets all partial head credits`);
    assert.deepEqual(xpSnapshot(p), earnedXp,
      `${label}: cleanup awards no quest-completion XP beyond the real kill`);
    assert.equal(readVar(p, 'qp'), earnedQuestPoints,
      `${label}: cleanup cannot award a quest point`);
    assert.equal(World.instances.findInstanceByUid(oldUid - 1), null,
      `${label}: cleanup deletes the former region`);
    assert.equal(remainingNpcsWithInstance(oldUid).length, 0,
      `${label}: cleanup removes former heads and inert corpses`);
    enterTolnaByRift(p, `${label} fresh rift re-entry`);
    assert.deepEqual(TOLNA_DEATH_BITS.map(name => readVar(p, name)), [0, 0, 0],
      `${label}: fresh re-entry cannot restore partial kill credit`);
    assert.equal(tolnaLiveHeadSet(p, `${label} fresh re-entry`).length, 3,
      `${label}: fresh re-entry creates exactly three full-HP product heads`);
    assert.deepEqual(xpSnapshot(p), earnedXp, `${label}: re-entry awards no duplicate quest XP`);
    assert.equal(readVar(p, 'qp'), earnedQuestPoints, `${label}: re-entry awards no quest point`);
    leaveTolnaCopy(p, `${label} fresh instance cleanup`, [1]);
    cleanupTolnaFixturePlayer(p, label);
  }
}

function testTolnaArenaMusic() {
  assert.equal(musicRegionSongAt(1, 46 << 6, 81 << 6).track, RAGE_SONG.track,
    'Tolna music matches the published source-square musicregion row');
  for (const initialStage of [TOLNA_INTRO_STAGE, TOLNA_ACTIVE_STAGE, TOLNA_CLEAR_STAGE]) {
    for (const mode of [1, 0]) {
      const label = `Tolna stage-${initialStage} ${mode === 1 ? 'Auto' : 'Manual'} music`;
      // Disclosed saved-entry boundary only; this is not a progression proof.
      const p = playerFixture();
      writeVar(p, 'soulbane_prog', initialStage);
      writeVar(p, 'soulbane_riftrope_pres', 1);
      seedFearCombatFixture(p, label);
      enterTolnaByRift(p, label, mode);
      if (initialStage === TOLNA_INTRO_STAGE) tolnaIntroPages(p, label);
      leaveTolnaCopy(p, `${label} surface restoration`, initialStage === TOLNA_CLEAR_STAGE ? [] : [1]);
      cleanupTolnaFixturePlayer(p, label);
    }
  }
  console.log('PASS Tolna arena native music state: source-square track, stages 10/11/12, Auto/Manual, surface restoration');
}

function testPrivateCopyAccess() {
  const p = playerFixture();
  seedStageOneOwner(p, 'R1 private-copy access boundary');
  assertPrivateCopyHasNoEscapeAccess(p, 'R1 private-copy access boundary');
  console.log('R1 private-copy access is unreachable: no bank/deposit loc, familiar, other player, or foreign ground object');
}

function testSafeTeleportInsideCopy() {
  const p = playerFixture();
  seedStageOneOwner(p, 'R1 safe teleport within owner copy');
  equipAngerWeapon(p, 'soulbane_anger_spearq', 'R1 in-copy safe teleport');
  const uid = instanceUid(p);
  const destination = roomCoord(p, 'soulbane_scene_player');
  assert.equal(World.instances.findInstanceByCoord(destination)?.uid, uid - 1,
    'R1 in-copy destination resolves to the same private instance');
  safeTeleport(p, destination, 'R1 p_telejump_safe inside the owned copy');
  assert.equal(instanceUid(p), uid, 'R1 in-copy teleport preserves the owner instance handle');
  assert.equal(World.instances.findInstanceByUid(uid - 1) !== null, true,
    'R1 in-copy teleport does not delete the active private copy');
  assert.equal(count(p, 'soulbane_anger_spearq', types.InvType.getId('worn')), 1,
    'R1 in-copy teleport preserves the wielded anger weapon');
  assert.equal(angerWeaponTotal(p), 1, 'R1 in-copy teleport preserves exactly one anger weapon');
  assert.equal(rageNpcsFor(p).length, 8, 'R1 in-copy teleport leaves the owned NPC outcome fixture intact');
  console.log('R1 in-copy p_telejump_safe preserves owner, weapon, and Rage NPC fixture (expected old-head pass)');
}

function testSafeTeleportOutAndDestinationLogout() {
  const p = playerFixture();
  seedStageOneOwner(p, 'R1 safe teleport out');
  equipAngerWeapon(p, 'soulbane_anger_spearq', 'R1 safe teleport out');
  const oldUid = instanceUid(p);
  const destination = { level: 0, x: 3213, z: 3424 };
  safeTeleport(p, destination, 'R1 p_telejump_safe out of the owned copy');
  const afterTeleport = {
    tile: tile(p),
    instanceUid: instanceUid(p),
    angerWeapons: angerWeaponTotal(p),
    regionStillExists: World.instances.findInstanceByUid(oldUid - 1) !== null
  };
  const reloaded = nativeLogoutAndReload(p, 'R1 logout after safe teleport out');
  const observed = { afterTeleport, savedTile: tile(reloaded), instanceUidAfterLogin: instanceUid(reloaded), angerWeaponsAfterLogin: angerWeaponTotal(reloaded) };
  console.log(`R1 teleport-out/logout observation ${JSON.stringify(observed)}`);
  assert.equal(afterTeleport.instanceUid, 0, 'R1 teleport out clears the Soulbane instance handle immediately');
  assert.equal(afterTeleport.angerWeapons, 0, 'R1 teleport out removes the worn anger weapon immediately');
  assert.equal(afterTeleport.regionStillExists, false, 'R1 teleport out deletes the now-empty private copy');
  assert.deepEqual(tile(reloaded), [destination.level, destination.x, destination.z],
    'R1 destination logout saves the actual teleport destination, not the rift surface');
  assert.equal(instanceUid(reloaded), 0, 'R1 destination login has no stale Soulbane instance handle');
  assertNoAngerItems(reloaded, 'R1 destination logout/relogin');
  assert.equal(stage(reloaded), 2, 'R1 external travel and logout preserve unfinished permanent progress');
}

function testLogoutInsideSavesRegionExit() {
  const p = playerFixture();
  seedStageOneOwner(p, 'R1 logout inside owner copy');
  equipAngerWeapon(p, 'soulbane_anger_spearq', 'R1 logout inside owner copy');
  const oldUid = instanceUid(p);
  const expectedExit = surfaceTile();
  const reloaded = nativeLogoutAndReload(p, 'R1 logout inside the owned copy');
  const observed = { savedTile: tile(reloaded), expectedExit, stage: stage(reloaded), angerWeapons: angerWeaponTotal(reloaded) };
  console.log(`R1 in-copy logout observation ${JSON.stringify(observed)}`);
  assert.deepEqual(tile(reloaded), expectedExit, 'R1 in-copy logout saves the instance exit coordinate');
  assert.equal(stage(reloaded), 2, 'R1 in-copy logout keeps unfinished permanent progress');
  assert.equal(instanceUid(reloaded), 0, 'R1 in-copy login does not retain a temporary instance handle');
  assertNoAngerItems(reloaded, 'R1 in-copy logout/relogin');
  assert.equal(rageNpcsWithInstance(oldUid).length, 0, 'R1 in-copy logout deletes all old Rage actors');
}

function testBankEscapeRoute() {
  const p = playerFixture();
  seedStageOneOwner(p, 'R1 bank escape route');
  equipAngerWeapon(p, 'soulbane_anger_spearq', 'R1 bank escape route');
  const anger = 'soulbane_anger_spearq';
  const worn = types.InvType.getId('worn');
  safeTeleport(p, { level: 0, x: 3213, z: 3424 }, 'R1 teleport to reachable Varrock bank');
  if (count(p, anger, worn) > 0) assert(remove(p, anger), 'R1 bank route removes the worn anger spear through the native handler');
  const [booth] = nearbyLocs(p, /bank.*booth|booth.*bank/i);
  assert(booth, 'R1 outside route finds a packed bank booth near the Varrock teleport destination');
  goToStand(p, booth, 'R1 outside route walks to the actual packed bank booth');
  const opened = operateLoc(p, booth, 2, [], 'R1 bank booth Use-quickly');
  assert.match(opened.trigger.name, /^\[oploc2,bank_?booth\]$/i, 'R1 bank opens through the packed bank loc operation');
  assert.equal(p.modalMain, id('Component', 'bank_main'), 'R1 bank booth opens the native bank interface');
  assert.equal(p.modalSide, id('Component', 'bank_side'), 'R1 bank booth opens the native player inventory side');
  const bankType = id('InvType', 'bank');
  const depositOp = componentOption('bank_side:inv', /deposit[^\d]*1\b/i);
  seed(p, ['shortbow']);
  assert(invButton(p, 'bank_side:inv', 'shortbow', depositOp, slotOf(p, 'shortbow')),
    'R1 outside bank uses the native inventory-button deposit handler');
  assert.equal(count(p, 'shortbow'), 0, 'R1 ordinary positive-control item leaves inventory');
  assert.equal(count(p, 'shortbow', bankType), 1, 'R1 ordinary positive-control item reaches the bank');

  if (count(p, anger) > 0) {
    assert(invButton(p, 'bank_side:inv', anger, depositOp, slotOf(p, anger)),
      'R1 old-head teleport-then-bank route uses the native deposit handler');
  }
  const routeBanked = count(p, anger, bankType);

  // This models a previously escaped, saved bank item from the old route. It is
  // seeded only after the player has reached a real external bank, never inside
  // the private copy; the live route above remains the primary regression.
  for (const weapon of WEAPONS) {
    assert.equal(p.invAdd(bankType, obj(weapon.name), 1), 1,
      `R1 valid legacy bank-save fixture contains ${weapon.name}`);
  }
  p.closeModal();
  const reloaded = nativeLogoutAndReload(p, 'R1 legacy banked anger cleanup');
  const bankAfterLogin = WEAPONS.map(weapon => [weapon.name, count(reloaded, weapon.name, bankType)]);
  console.log(`R1 bank route observation ${JSON.stringify({ angerInBankAfterNativeRoute: routeBanked, bankAfterLogin })}`);
  assert.equal(routeBanked, 0, 'R1 teleport-then-bank route cannot bank an anger weapon');
  assert.deepEqual(bankAfterLogin, WEAPONS.map(weapon => [weapon.name, 0]),
    'R1 login cleanup permanently removes all previously escaped anger weapons from the bank');
  assert.equal(count(reloaded, 'shortbow', bankType), 1, 'R1 login cleanup preserves an ordinary banked item');
  assertNoAngerItems(reloaded, 'R1 bank route and login cleanup');
}

function testTradeEscapeRoute() {
  const destination = { level: 0, x: 3213, z: 3424 };
  const p = playerFixture();
  const otherTile = { ...destination, x: destination.x + 1 };
  assertFootprintOpen(otherTile.level, otherTile.x, otherTile.z, 1, 1, 'R1 trade recipient collision');
  nativeRouteFrom(destination, otherTile, 'R1 trade recipient is reachable on foot from the teleport landing');
  const q = playerFixture(otherTile);
  seedStageOneOwner(p, 'R1 trade escape route');
  equipAngerWeapon(p, 'soulbane_anger_spearq', 'R1 trade escape route');
  safeTeleport(p, destination, 'R1 teleport to reachable player trade');
  const anger = 'soulbane_anger_spearq';
  const worn = types.InvType.getId('worn');
  if (count(p, anger, worn) > 0) assert(remove(p, anger), 'R1 trade route removes the worn anger spear through the native handler');

  // Offline sessions need the ordinary login appearance bit before visibility encoding.
  p.masks |= PlayerInfoProt.APPEARANCE;
  q.masks |= PlayerInfoProt.APPEARANCE;
  World.processInfo();
  rsbuf.playerInfo(0, p.slot, 0, 0, true);
  rsbuf.playerInfo(0, q.slot, 0, 0, true);
  assert(rsbuf.hasPlayer(p.slot, q.slot) && rsbuf.hasPlayer(q.slot, p.slot),
    'R1 trade participants are actually visible to each other outside the private copy');
  p.resetEntity(false);
  q.resetEntity(false);
  assert(OpPlayerHandler.handle(new OpPlayer(4, q.slot), p), 'R1 native Trade-with packet is accepted by the production handler');
  p.processInteraction();
  p.resetEntity(false);
  q.resetEntity(false);
  assert(OpPlayerHandler.handle(new OpPlayer(4, p.slot), q), 'R1 reciprocal native Trade-with packet is accepted');
  q.processInteraction();
  assert.equal(p.modalMain, id('Component', 'trademain'), 'R1 trade route opens the real trade interface for the owner');
  assert.equal(q.modalMain, id('Component', 'trademain'), 'R1 trade route opens the real trade interface for the recipient');

  const tradeOffer = id('InvType', 'tradeoffer');
  for (const weapon of WEAPONS) {
    assert.equal(types.ObjType.get(obj(weapon.name)).tradeable, false, `${weapon.name} is untradeable in the built pack`);
  }
  if (count(p, anger) > 0) {
    assert(invButton(p, 'tradeside:inv', anger, 1, slotOf(p, anger)),
      'R1 anger-weapon offer reaches the native trade inventory-button handler');
    assert.equal(count(p, anger, tradeOffer), 0, 'native trade refuses the untradeable anger weapon');
    assert.equal(count(p, anger), 1, 'refused anger trade leaves the item with its owner');
  }
  seed(p, ['shortbow']);
  assert(invButton(p, 'tradeside:inv', 'shortbow', 1, slotOf(p, 'shortbow')),
    'R1 trade positive control offers an ordinary item through the native handler');
  assert.equal(count(p, 'shortbow', tradeOffer), 1, 'R1 ordinary item enters the actual trade offer');
  for (const [who, component] of [
    [p, 'trademain:accept'], [q, 'trademain:accept'],
    [p, 'tradeconfirm:accept'], [q, 'tradeconfirm:accept']
  ]) {
    p.resetEntity(false);
    q.resetEntity(false);
    assert(button(who, component), `R1 native trade accepts ${component}`);
  }
  assert.equal(count(q, 'shortbow'), 1, 'R1 real trade transfers the ordinary positive-control item');
  assert.equal(count(q, anger), 0, 'R1 real trade never transfers an anger weapon');
  assert.equal(instanceUid(p), 0, 'R1 teleport-then-trade releases the departed copy handle');
  assertNoAngerItems(p, 'R1 teleport-then-trade owner cleanup');
  console.log('R1 trade refuses anger weapons; teleport cleanup also removes them and releases ownership');
}

function testDropEscapeRoute() {
  const p = playerFixture();
  seedStageOneOwner(p, 'R1 Drop escape route');
  const anger = 'soulbane_anger_spearq';
  takeRackWeapon(p, anger, 'R1 in-copy Drop route');
  const roomTile = tile(p);
  assert(held(p, anger, 5), 'R1 in-copy Drop reaches the native held-item handler');
  assertNoAngerItems(p, 'R1 in-copy Drop');
  assert.equal(World.getObj(roomTile[1], roomTile[2], roomTile[0], obj(anger), p.hash64), null,
    'R1 in-copy Drop does not create a ground anger weapon');

  takeRackWeapon(p, anger, 'R1 teleport-then-Drop route');
  safeTeleport(p, { level: 0, x: 3213, z: 3424 }, 'R1 teleport before native Drop');
  if (count(p, anger, types.InvType.getId('worn')) > 0) assert(remove(p, anger), 'R1 outside Drop removes a worn anger weapon natively');
  if (count(p, anger) > 0) assert(held(p, anger, 5), 'R1 outside Drop reaches the native held-item handler');
  assertNoAngerItems(p, 'R1 teleport-then-Drop');
  assert.equal(World.getObj(p.x, p.z, p.level, obj(anger), p.hash64), null,
    'R1 native Drop never creates an anger weapon on the outside ground');
  assert.equal(instanceUid(p), 0, 'R1 teleport-then-Drop releases the departed copy handle');
  console.log('R1 Drop returns weapons without a ground object; teleport cleanup also releases ownership');
}

function testRoomExitRemovesAngerWeapon() {
  const p = playerFixture();
  seedStageOneOwner(p, 'R1 ordinary room exit');
  equipAngerWeapon(p, 'soulbane_anger_spearq', 'R1 ordinary room exit');
  const oldUid = instanceUid(p);
  const quit = quitLoc(p);
  goToStand(p, quit, 'R1 ordinary room exit walks to the packed quit loc');
  const result = operateLoc(p, quit, 1, [1], 'R1 ordinary room exit confirms Yes');
  assert.match(result.trigger.name, /^\[oploc1,soul_bane_awall_void_small\]$/);
  worldTick();
  assert.equal(stage(p), 2, 'R1 ordinary room exit does not complete unfinished Rage');
  assert.equal(instanceUid(p), 0, 'R1 ordinary room exit releases the instance handle');
  assert.deepEqual(tile(p), surfaceTile(), 'R1 ordinary room exit returns to the declared surface');
  assert.equal(World.instances.findInstanceByUid(oldUid - 1), null, 'R1 ordinary room exit deletes the empty copy');
  assertNoAngerItems(p, 'R1 ordinary room exit cleanup');
  console.log('R1 ordinary room exit removes the weapon and private copy (expected old-head pass)');
}

function testFreshRelogLaunaStart() {
  const label = 'fresh empty-save/relogin Launa start';
  // Reserve only a unique offline slot; none of makePlayer's seeded vars or
  // level-99 defaults enter the actual empty-save player.
  const reservation = makePlayer();
  reservation.unlink();
  let p = PlayerLoading.load(reservation.username, new Packet(new Uint8Array(0)), null);
  p.pid = reservation.pid;
  p.slot = reservation.slot;
  p.uid = ((Number(p.username37 & 0x1fffffn) << 11) | p.slot) >>> 0;
  p.isActive = true;
  p.packets = [];
  p.messages = [];
  p.write = packet => p.packets.push(packet);
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = p.messageGame;
  World.players[p.pid] = p;
  World.playerLoop.add(p.hash64, p);
  rsbuf.addPlayer(p.slot);
  World.gameMap.getZone(p.x, p.z, p.level).enter(p);
  World.instances.playerEntered({ level: p.level, x: p.x, z: p.z });
  const handleId = id('VarPlayerType', 'soulbane_instance');
  const handleAtConstruction = p.vars[handleId];
  assert.equal(stage(p), 0, `${label}: native empty-save quest stage is zero`);
  assert.equal(runProcInt('soulbane_owned', p), 0,
    `${label}: native constructor defaults do not own a private region`);
  p.onLogin();
  p.processEngineQueue();

  // The live mainland fixture seeds only tutorial completion and its own
  // mainland position before the first genuine logout/save/relogin.
  writeVar(p, 'tutorial', 1000);
  runProc('p_telejump_safe', p, [CoordGrid.packCoord(0, 3220, 3220)]);
  finishInteraction(p, [], `${label}: first login dialogue`);
  assert(CloseModalHandler.handle(new CloseModal(), p), `${label}: native Close dismisses first-login onboarding`);
  worldTick();
  for (let tick = 0; tick < 128 && (!p.canAccess() || p.engineQueue.head() !== null || p.queue.head() !== null); tick++) {
    worldTick();
  }
  assert(p.canAccess() && p.engineQueue.head() === null && p.queue.head() === null,
    `${label}: native first-login work settles before the real logout request`);
  p = nativeLogoutAndReload(p, `${label}: ordinary mainland relog`);
  assert.equal(stage(p), 0, `${label}: real save/relogin keeps stage zero`);
  assert.equal(instanceUid(p), 0, `${label}: relog has no region handle`);
  assert.equal(runProcInt('soulbane_owned', p), 0,
    `${label}: ownership lookup finishes false after the real login hook`);
  const handleAfterRelog = p.vars[handleId];

  // Disclosed ordinary kit/stat seeds match the live account after relog.
  for (const stat of [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.HITPOINTS]) {
    p.baseLevels[stat] = 99;
    p.levels[stat] = 99;
    p.stats[stat] = getExpByLevel(99);
  }
  seed(p, ['rune_chainbody', 'rune_platelegs']);
  for (const armor of ['rune_chainbody', 'rune_platelegs']) {
    assert(held(p, armor, 2), `${label}: native Wear accepts the ordinary ${armor}`);
  }
  assert.equal(p.invAdd(inv, obj('coins'), 15), 15, `${label}: seed only the rope purchase cost`);
  runProc('p_telejump_safe', p, [CoordGrid.packCoord(0, 3100, 3258)]);
  const ned = nedNpc();
  goToStand(p, ned, `${label}: native walk to Ned`);
  operateNpc(p, ned, 1, [1, 1], `${label}: actual rope purchase`);
  assert.equal(count(p, 'rope'), 1, `${label}: Ned, not a seed, produces the rope`);
  assert.equal(stage(p), 0, `${label}: ordinary preparation never seeds a quest stage`);

  runProc('p_telejump_safe', p, [CoordGrid.packCoord(0, 3310, 3455)]);
  const launa = outerLauna();
  goToStand(p, launa, `${label}: native walk into Launa operation distance`);
  const accepted = operateNpc(p, launa, 1, [1], `${label}: stage-zero native Talk-to`);
  assert.match(accepted.trigger.name, /^\[opnpc1,soulbane_launa(?:_multi)?\]$/);
  assert.match(accepted.text, /Hi there\./, `${label}: the native opening player page is emitted`);
  assert.match(accepted.text, /Hello\./, `${label}: the native opening Launa page is emitted`);
  assert.match(accepted.text, /Would you like me to go down to look for your husband and son\?/,
    `${label}: the sourced quest-start choice is reached and answered`);
  assert.equal(stage(p), 1, `${label}: only the real conversation writes stage one`);
  assert.equal(instanceUid(p), 0, `${label}: the opening never creates a private region`);
  console.log(`Launa fresh relog ${JSON.stringify({ handleId, handleAtConstruction, handleAfterRelog, trigger: accepted.trigger.name, stage: stage(p), opening: accepted.text })}`);
  p.requestLogout = true;
  worldTick();
  assert(![...World.playerLoop.all()].includes(p), `${label}: native logout removes the fixture`);
}

function testMainPath() {
  const p = playerFixture({ level: 0, x: 3100, z: 3257 });
  const start = { level: p.level, x: p.x, z: p.z };
  const { ned, launa, rift } = checkOutsideFixedRoutes(p);
  assert.deepEqual(tile(p), [start.level, start.x, start.z], 'pathfinder audit does not teleport or move the main player');

  // The actual checked-out Ned operation sells the rope; only 15 coins are seeded.
  seed(p, ['coins']);
  assert.equal(count(p, 'coins'), 1, 'Ned test starts with exactly one stack of seeded coins');
  p.invDel(inv, obj('coins'), 1);
  assert(p.invAdd(inv, obj('coins'), 15) === 15, 'seed only the exact 15-coin ordinary purchase cost');
  goToStand(p, ned, 'walk from the disclosed Draynor travel fixture to Ned');
  const rope = operateNpc(p, ned, 1, [1, 1], 'Ned\'s real rope purchase');
  assert.match(rope.trigger.name, /^\[opnpc1,ned\]$/i, 'rope acquisition uses Ned\'s ordinary visible Talk-to trigger');
  assert.equal(count(p, 'rope'), 1, 'compiled Ned conversation produces one rope');
  assert.equal(count(p, 'coins'), 0, 'compiled Ned conversation charges 15 coins');
  assert.equal(stage(p), 0, 'rope purchase does not start Soulbane');

  const decline = playerFixture();
  goToStand(decline, launa, 'walk to Launa for the decline case');
  const declined = operateNpc(decline, launa, 1, [2], 'Launa decline offer');
  assert.match(declined.trigger.name, /^\[opnpc1,soulbane_launa\]$/i, 'decline uses the visible Launa form');
  assert.equal(stage(decline), 0, 'declining leaves the permanent stage at zero');

  // Ordinary inter-town travel is a disclosed fixture, not a quest-stage seed.
  runProc('p_telejump_safe', p, [CoordGrid.packCoord(0, 3310, 3455)]);
  goToStand(p, launa, 'walk from the surface travel fixture to Launa');
  const accepted = operateNpc(p, launa, 1, [1], 'Launa quest acceptance');
  assert.match(accepted.trigger.name, /^\[opnpc1,soulbane_launa\]$/i, 'acceptance uses the visible Launa form');
  assert.equal(stage(p), 1, 'acceptance writes permanent stage 1');
  assert.equal(types.VarPlayerType.get(STAGE_VARP).scope, types.VarPlayerType.SCOPE_PERM, 'stage write is backed by permanent varp');
  const repeat = operateNpc(p, launa, 1, [], 'Launa repeated stage-1 Talk-to');
  assert.match(repeat.trigger.name, /^\[opnpc1,soulbane_launa\]$/i);
  assert.equal(stage(p), 1, 'repeated Launa conversation does not rewind or advance progress');

  // Stage-0 item-on-rift is a disclosed negative fixture: the actual compiled
  // use handler must refuse attachment and preserve the rope.
  const prestart = playerFixture();
  seed(prestart, ['rope']);
  goToStand(prestart, rift, 'stage-0 no-start: walk to actual rift');
  assert(useLoc(prestart, 'rope', rift), 'stage-0 rope-on-rift packet accepted for compiled prerequisite check');
  prestart.processInteraction();
  finishInteraction(prestart, [], 'stage-0 rope-on-rift refusal');
  assert.equal(stage(prestart), 0, 'a rope cannot start descent before accepting Launa\'s offer');
  assert.equal(count(prestart, 'rope'), 1, 'stage-0 refusal preserves the rope');
  assert.equal(readVar(prestart, 'soulbane_riftrope_pres'), 0, 'stage-0 refusal does not attach the rope');
  assert.equal(instanceUid(prestart), 0, 'stage-0 refusal cannot create an instance');

  // The main player's accepted quest still has no rope attached: the actual
  // unroped multi-loc must not admit descent.
  const unroped = riftLoc();
  goToStand(p, unroped, 'stage-1 no-rope admission: walk to packed floor');
  p.clearInteraction();
  assert(OpLocHandler.handle(new OpLoc(1, unroped.x, unroped.z, unroped.type), p), 'unroped Enter packet reaches native loc handler');
  p.processInteraction();
  for (let tick = 0; tick < 4; tick++) worldTick();
  assert.equal(stage(p), 1, 'unroped Enter does not advance the accepted quest');
  assert.equal(instanceUid(p), 0, 'unroped Enter cannot create a private room');
  assert.equal(readVar(p, 'soulbane_riftrope_pres'), 0, 'unroped Enter does not set rope-presence state');

  assert(useLoc(p, 'rope', unroped), 'stage-1 rope-on-rift packet accepted');
  p.processInteraction();
  finishInteraction(p, [], 'attach the purchased rope at the real rift');
  assert.equal(count(p, 'rope'), 0, 'compiled rope attachment consumes the purchased rope');
  assert.equal(readVar(p, 'soulbane_riftrope_pres'), 1, 'compiled rope attachment writes the permanent rift state');
  chooseRiftWithRope(p, 'main compiled descent', { requireLocked: true });
  assert.equal(stage(p), 2, 'native descent advances accepted quest to Rage stage 2');
  assert.notEqual(instanceUid(p), 0, 'native descent stores a temporary region UID');
  assertPrivateInstanceIsolation(p, 'stage-2 Rage entry', true);
  const entry = roomCoord(p, 'soulbane_rage_entry');
  assert.deepEqual({ level: p.level, x: p.x, z: p.z }, entry, 'descent lands on the exact packed Rage entry tile');
  assert.equal(readVar(p, 'soulbane_anger_damagedealt'), 0, 'new Rage room starts with zero temporary meter');
  assert.equal(rageNpcsFor(p).length, 8, 'entry creates eight owner-tagged Rage NPCs');
  worldTick(); // First ordinary post-entry tick runs the queued NPC spawn hooks.
  checkRoomRoutes(p);
  assertJournal(p, ['very aggressive room', 'defeat the monsters'], ['Tolna has been rescued', 'Soulbane is complete'],
    'stage-2 journal');
  const stageTwoColor = latestQuestColor(p);

  testRackCapacityAndDrop(p);
  testWeaponMatrix(p);
  assert.equal(angerWeaponTotal(p), 1, 'weapon matrix ends with one anger weapon');
  assert.equal(angerWorn(p), 1, 'weapon matrix leaves the selected anger weapon equipped');
  const unrelatedXpBefore = xpSnapshot(p);
  const qpBefore = readVar(p, 'qp');
  const coinsBefore = count(p, 'coins');
  const rageTarget = questConstant('soulbane_rage_target');
  assert(rageTarget > 0, 'UNKNOWN engineering meter target is a positive configured constant');
  const reward = questConstant('soulbane_rage_attack_xp');
  assert.equal(reward, 40, 'the explicit first-unit Attack-XP constant is exactly 40');

  // Cross-owner copy. The only seeded quest state in this fixture is explicitly
  // disclosed in seedStageOneOwner; each descent itself is the real loc action.
  const other = playerFixture();
  seedStageOneOwner(other, 'disclosed private-copy fixture');
  const ownerActors = allRageNpcs(p);
  const otherActors = allRageNpcs(other);
  assert.notEqual(instanceUid(p), instanceUid(other), 'two normal descents allocate different private region UIDs');
  assert.notEqual(ownerActors[0].nid, otherActors[0].nid, 'the two private copies own distinct NPC entities');
  equipAngerWeapon(other, 'soulbane_anger_swordq', 'foreign target fixture');
  assert(angerWeaponTotal(other) === 1, 'intruder has only its own anger weapon');
  testForeignInteractions(p, other);

  // No correct native hit has yet changed the meter; exercise all four real
  // matching weapons against their own NPCs to fill anger through combat queues.
  const originalRandom = Math.random;
  const originalJavaRandom = JavaRandom.nextDouble;
  Math.random = () => 0.999999999999;
  JavaRandom.nextDouble = () => 0.999999999999;
  try {
    let attempts = 0;
    while (stage(p) === 2 && readVar(p, 'soulbane_anger_damagedealt') < rageTarget && attempts < 48) {
      const candidates = rageNpcsFor(p).filter(npc => npc.levels[HP_STAT] > 0);
      assert(candidates.length > 0, 'remaining Rage actors are available until the configured meter completes');
      candidates.sort((a, b) => CoordGrid.distanceToSW(p, a) - CoordGrid.distanceToSW(p, b));
      const next = candidates.find(npc => npc.uid === readVar(p, 'aggressive_npc')) ?? candidates[0];
      const mappedWeapon = WEAPONS.find(value => value.target === types.NpcType.get(next.type).debugname);
      assert(mappedWeapon, `every Rage NPC type ${types.NpcType.get(next.type).debugname} has an explicit matching weapon`);
      equipAngerWeapon(p, mappedWeapon.name, `main combat ${types.NpcType.get(next.type).debugname}`);
      // Respect ordinary single-combat ownership if an aggressor reached us
      // while we walked to the rack. Choose its matching weapon next, rather
      // than repeatedly issuing an attack that the combat rules must refuse.
      const aggressor = rageNpcsFor(p).find(npc => npc.levels[HP_STAT] > 0 && npc.uid === readVar(p, 'aggressive_npc'));
      if (aggressor && aggressor !== next) {
        attempts++;
        continue;
      }
      runNativeAttack(p, next, `native ${mappedWeapon.name} vs ${types.NpcType.get(next.type).debugname}`, 120);
      attempts++;
    }
    assert.equal(stage(p), 2, 'reaching the anger target starts the family scene before permanent completion');
    assert(readVar(p, 'soulbane_anger_damagedealt') >= rageTarget, 'real native combat reaches the configured anger target');
  } finally {
    Math.random = originalRandom;
    JavaRandom.nextDouble = originalJavaRandom;
  }

  finishRageScene(p);
  assert.equal(stage(p), 3, 'Rage completion writes permanent stage 3');
  assert.equal(readVar(p, 'soulbane_anger_donespecial'), 0, 'the completed Rage scene clears its temporary special flag');
  assert(readVar(p, 'soulbane_anger_damagedealt') >= rageTarget, 'meter completion follows real landed combat credit');
  const afterStats = xpSnapshot(p);
  for (let skill = 0; skill < afterStats.length; skill++) {
    const expected = skill === ATTACK_XP ? reward * 10 : 0;
    assert.equal(afterStats[skill] - unrelatedXpBefore[skill], expected,
      `Rage awards only ${expected} XP to ${skill === ATTACK_XP ? 'Attack' : `stat ${skill}`}`);
  }
  assert.equal(readVar(p, 'qp'), qpBefore, 'first-room Rage completion awards no quest points');
  assert.equal(count(p, 'coins'), coinsBefore, 'Rage completion awards no coins');
  assert.equal(latestQuestColor(p), stageTwoColor, 'completed Rage remains an active quest, not whole-quest completion');
  const stageThreeColor = latestQuestColor(p);
  assertJournal(p, ['managed to defeat the monsters in the room', "Sorry, I've yet to enter the next room"],
    ['Tolna has been rescued', 'Soulbane is complete'], 'stage-3 journal');


  const completedActorsBeforeLeave = rageNpcsFor(p).length;
  assert(completedActorsBeforeLeave === 0, 'completed room removes its Rage attackers');
  const quit = quitLoc(p);
  const leave = operateSurfaceExit(p, quit, [], 'stage-3 direct exit without a restart prompt');
  assert.match(leave.trigger.name, /^\[oploc1,soul_bane_awall_void_small\]$/);
  assert.equal(stage(p), 3, 'stage-3 leave preserves completed progress');
  assert.equal(instanceUid(p), 0, 'stage-3 leave closes the private region');
  assert(!CoordGrid.isInstanceX(p.x), 'stage-3 leave returns to the overworld');

  chooseRiftWithRope(p, 'stage-3 completed-room re-entry', { requireUnlocked: true });
  assert.equal(stage(p), 3, 'completed stage remains complete after re-entry');
  assert.equal(rageNpcsFor(p).length, 0, 'stage-3 re-entry does not respawn empty Rage attackers');
  assert.equal(readVar(p, 'soulbane_anger_damagedealt'), 0, 'stage-3 re-entry does not restore an unfinished Rage meter');
  assert.deepEqual(xpSnapshot(p), afterStats, 'stage-3 re-entry does not award a second Attack-XP grant');
  assert.equal(latestQuestColor(p), stageThreeColor, 'stage-3 re-entry keeps the completed journal color');

  const completedUid = instanceUid(p);
  const completed = nativeLogoutAndReload(p, 'completed-stage logout');
  assert.equal(stage(completed), 3, 'completed-stage logout preserves permanent stage 3');
  assert.equal(instanceUid(completed), 0, 'completed-stage relog clears temporary instance UID');
  assert(!CoordGrid.isInstanceX(completed.x), 'completed-stage relog lands outside the instance');
  assert.deepEqual(xpSnapshot(completed), afterStats, 'completed-stage logout/relogin preserves exactly one 40-XP award');
  assert.equal(latestQuestColor(completed), stageThreeColor, 'login reconstruction preserves the completed quest-row color');
  assertJournal(completed, ['managed to defeat the monsters in the room', "Sorry, I've yet to enter the next room"],
    ['Tolna has been rescued', 'Soulbane is complete'], 'post-login stage-3 journal');
  assert.equal(rageNpcsWithInstance(completedUid).length, 0, 'completed logout removes all actors from its old copy');
  const fearRun = testFearProgression(completed, stageThreeColor);
  return { player: fearRun.player, completed: fearRun.completed, stageTwoColor, stageThreeColor, reward };
}

function run() {
  checkVarpMetadata();
  if (process.argv.includes('--memory-hold-only')) {
    testMemoryInputHold();
    testMemoryTeleportAdmission();
    return;
  }
  const r1Cases = new Map([
    ['launa-fresh-relog', testFreshRelogLaunaStart],
    ['later-partial', testLaterPartialLifecycle],
    ['hope-concurrent', testHopeConcurrentCreditsAndFood],
    ['hope-ranged-delay', testHopeNativeRangedDelay],
    ['tolna-progression', testTolnaCompletionCase],
    ['tolna-shared-poison', testTolnaSharedPoison],
    ['tolna-lifecycle', testTolnaIncompleteLifecycle],
    ['tolna-music', testTolnaArenaMusic],
    ['hope-bridge', () => {
      const p = laterRoomFixture(HOPE_STAGE, 'disclosed Hope bridge native-combat fixture');
      let mark = null;
      for (let ordinal = 1; ordinal <= questConstant('soulbane_hope_creatures'); ordinal++) {
        mark = killHopeCreature(p, hopeNpcsFor(p)[0], ordinal);
      }
      finishHopeScene(p, mark);
      leaveQuestRoom(p, 'isolated Hope bridge cleanup');
      p.requestLogout = true;
      worldTick();
    }],
    ['progression', () => { testMemoryInputHold(); testMainPath(); }],
    ['teleport-out', testSafeTeleportOutAndDestinationLogout],
    ['teleport-in', testSafeTeleportInsideCopy],
    ['logout-inside', testLogoutInsideSavesRegionExit],
    ['death-items', () => testDeath(null)],
    ['bank', testBankEscapeRoute],
    ['trade', testTradeEscapeRoute],
    ['drop', testDropEscapeRoute],
    ['room-exit', testRoomExitRemovesAngerWeapon],
    ['copy-access', testPrivateCopyAccess]
  ]);
  const selector = process.argv.find(argument => argument.startsWith('--r1-case='));
  if (selector) {
    const name = selector.slice('--r1-case='.length);
    const selected = r1Cases.get(name);
    assert(selected, `unknown --r1-case=${name}; choose ${[...r1Cases.keys()].join(', ')}`);
    if (name === 'copy-access') {
      testMemoryInputHold();
      testMemoryTeleportAdmission();
    }
    selected();
    console.log(`PASS Soulbane isolated R1 case: ${name}`);
    return;
  }

  testMemoryInputHold();
  testMemoryTeleportAdmission();
  testFreshRelogLaunaStart();
  testConfusionIllusionXp();
  testLaterPartialLifecycle();
  testHopeConcurrentCreditsAndFood();
  const main = testMainPath();
  const stageTwo = testStageTwoLeaveAndLogout(main.player);
  assert.equal(latestQuestColor(stageTwo.reloaded), main.stageTwoColor, 'mid-Rage login reconstruction preserves the active-stage quest color');
  assertJournal(stageTwo.reloaded, ['very aggressive room', 'defeat the monsters'], ['Soulbane is complete'],
    'post-login stage-2 journal');
  testDeath(main.player);
  testPrivateCopyAccess();
  testSafeTeleportInsideCopy();
  testSafeTeleportOutAndDestinationLogout();
  testLogoutInsideSavesRegionExit();
  testBankEscapeRoute();
  testTradeEscapeRoute();
  testDropEscapeRoute();
  testRoomExitRemovesAngerWeapon();
  testManualRoomMusicEntries();
  testHopeNativeRangedDelay();
  testTolnaCompletionCase();
  testTolnaSharedPoison();
  testTolnaIncompleteLifecycle();
  testTolnaArenaMusic();
  console.log('PASS Soulbane compiled regression: Rage, Fear, Confusion, Hope and Tolna progression; native combat, food and poison; Launa/journal boundary reports; 64-west bridge; saved boundaries, lifecycle and escape routes');
  console.log(JSON.stringify({ stageTwoColor: main.stageTwoColor, stageThreeColor: main.stageThreeColor, attackXp: main.reward }));
}

// Keep ordinary idle NPC wandering reproducible; combat cases scope their
// explicitly deterministic hit rolls separately.
const originalRandom = Math.random;
const originalJavaRandom = JavaRandom.nextDouble;
Math.random = () => 0.5;
JavaRandom.nextDouble = () => 0.5;
try {
  run();
} finally {
  Math.random = originalRandom;
  JavaRandom.nextDouble = originalJavaRandom;
}
process.exit(0);
