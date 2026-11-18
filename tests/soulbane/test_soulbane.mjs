#!/usr/bin/env node
// Native rift, Rage, and saved Fear boundary regression coverage.
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
const { CollisionType } = await engineModule('engine/routefinder/flags.ts');
const RebuildRegion = (await engineModule('network/game/server/model/RebuildRegion.ts')).default;
const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const MoveClickHandler = new (await engineModule('network/game/client/handler/MoveClickHandler.ts')).default();
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const OpLocHandler = new (await engineModule('network/game/client/handler/OpLocHandler.ts')).default();
const OpNpc = (await engineModule('network/game/client/model/OpNpc.ts')).default;
const OpNpcHandler = new (await engineModule('network/game/client/handler/OpNpcHandler.ts')).default();
const OpNpcU = (await engineModule('network/game/client/model/OpNpcU.ts')).default;
const OpNpcUHandler = new (await engineModule('network/game/client/handler/OpNpcUHandler.ts')).default();
const OpNpcT = (await engineModule('network/game/client/model/OpNpcT.ts')).default;
const OpNpcTHandler = new (await engineModule('network/game/client/handler/OpNpcTHandler.ts')).default();
const NpcStat = (await engineModule('engine/entity/NpcStat.ts')).NpcStat;
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const rsbuf = await engineModule('network/rsbuf/index.ts');
const { PlayerInfoProt } = await engineModule('network/rsbuf/prot.ts');
const OpPlayer = (await engineModule('network/game/client/model/OpPlayer.ts')).default;
const OpPlayerHandler = new (await engineModule('network/game/client/handler/OpPlayerHandler.ts')).default();
const MidiSong = (await engineModule('network/game/server/model/MidiSong.ts')).default;
const DbTableIndex = (await engineModule('cache/config/DbTableIndex.ts')).default;

const memoryCameraPackets = new WeakMap();



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
const WEAPON_IDS = new Set(WEAPONS.map(weapon => requiredId('ObjType', weapon.name)));
const NPC_INSTANCE = requiredId('VarNpcType', 'npc_int');
const NPC_OWNER = requiredId('VarNpcType', 'npc_attacking_uid');
const NPC_XP_MULTIPLIER = requiredId('VarNpcType', 'npc_combat_xp_multiplier');
const ATTACK_XP = PlayerStat.ATTACK;
const HP_STAT = NpcStat.HITPOINTS;
const LAUNA_SCENE = requiredId('NpcType', 'soulbane_launa_young');
const TOLNA_SCENE = requiredId('NpcType', 'soulbane_tolnaboy');
const QUEST_ROW = requiredId('Component', 'questlist:soulbane');
const STAGE_VARBIT = requiredId('VarBitType', 'soulbane_prog');
const STAGE_VARP = types.VarBitType.get(STAGE_VARBIT).basevar;
const INSTANCE_VARP = requiredId('VarPlayerType', 'soulbane_instance');
const METER_VARBIT = requiredId('VarBitType', 'soulbane_anger_damagedealt');
const WEAPON_VARBIT = requiredId('VarBitType', 'soulbane_anger_weaponmulti');

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
const MANUAL_PREVIOUS_SONG = musicSongByName('music_Book_Of_Spells');
assert.equal(RAGE_SONG.name, 'Wrath and Ruin', 'Rage music row names the source-backed track');
assert.equal(FEAR_SONG.name, 'Fear and Loathing', 'Fear music row names the source-backed track');

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
    assertMemorySceneVisibility(p, rageZones, 'Rage memory scene', true);
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
  const song = stage(p) >= FEAR_STAGE ? FEAR_SONG : RAGE_SONG;
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

function stableHitRandom(run) {
  const previousMathRandom = Math.random;
  const previousJavaRandom = JavaRandom.nextDouble;
  Math.random = () => 0.999999999999;
  JavaRandom.nextDouble = () => 0.999999999999;
  try { return run(); }
  finally {
    Math.random = previousMathRandom;
    JavaRandom.nextDouble = previousJavaRandom;
  }
}
function runNativeAttack(p, npc, label, maxTicks = 80, stopOnHit = false) {
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
    worldTick();
    if (stopOnHit && npc.levels[HP_STAT] < beforeHp) {
      p.clearInteraction();
      break;
    }
    if (stage(p) === 3 || stage(p) === FEAR_COMPLETE_STAGE ||
      readVar(p, 'soulbane_anger_donespecial') === 1 || !npc.isActive) break;
  }
  assert(stopOnHit
    ? npc.levels[HP_STAT] < beforeHp || !npc.isActive
    : !npc.isActive || readVar(p, 'soulbane_anger_donespecial') === 1 ||
      stage(p) === 3 || stage(p) === FEAR_COMPLETE_STAGE,
  `${label}: real native attack/AI queue ${stopOnHit ? 'lands a hit' : 'settles'}; ${JSON.stringify({ player: { tile: tile(p), hp: p.levels[PlayerStat.HITPOINTS], stage: stage(p), uid: instanceUid(p), delayed: p.delayed, interaction: p.target?.nid, script: p.activeScript?.script?.name, execution: p.activeScript?.execution, messages: p.messages.slice(-8) }, npc: { tile: [npc.level, npc.x, npc.z], hp: npc.levels[HP_STAT], beforeHp, mode: npc.mode, owner: npc.vars[NPC_OWNER], instance: npc.vars[NPC_INSTANCE] }, meter: readVar(p, 'soulbane_anger_damagedealt'), beforeMeter })}`);
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
function roomSourceSquares() {
  const roomSource = sourceCoordForName('soulbane_rage_entry');
  const x = roomSource.x >> 6;
  const z = roomSource.z >> 6;
  return new Set([`${roomSource.level}_${x}_${z}`, `${roomSource.level}_${x + 1}_${z}`]);
}
function roomSourceZones(instance, label) {
  const roomSource = sourceCoordForName('soulbane_rage_entry');
  const roomSquares = roomSourceSquares();
  const zones = assignedInstanceZones(instance)
    .filter(zone => roomSquares.has(sourceSquareKeyForZone(zone)));
  const eastZones = zones.filter(zone => sourceSquareKeyForZone(zone) !== sourceSquareKey(roomSource));
  assert([0, 64].includes(eastZones.length),
    `${label}: the east reserve is unmapped or contains its complete source square`);
  assert.equal(zones.length, 64 + eastZones.length,
    `${label}: the original room square always maps all 64 zones`);
  for (const zone of zones) {
    const { east, north } = instanceDestinationOffset(instance, zone);
    assert(east >= 0 && east < 16 && north >= 0 && north < 8,
      `${label}: room source zone maps into the contiguous local 16×8 room rectangle`);
    assert.equal(zone.source.level, roomSource.level, `${label}: room source floor is unchanged`);
    assert.equal(zone.source.x, (roomSource.x >> 6) * 8 + east,
      `${label}: full room x-zones map east without rotation or translation`);
    assert.equal(zone.source.z, (roomSource.z >> 6) * 8 + north,
      `${label}: room source z-zone maps without rotation or translation`);
    assert.equal(zone.rotation, 0, `${label}: room source zone keeps its original orientation`);
  }
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
function memoryPatchComponents(instance, roomZones, label) {
  const rageSource = sourceCoordForName('soulbane_scene_player');
  const fearSource = sourceCoordForName('soulbane_fear_scene_player');
  const memorySquare = sourceSquareKey(rageSource);
  assert.equal(sourceSquareKey(fearSource), memorySquare, `${label}: both scene memories use their packed source square`);
  assert.notEqual(memorySquare, sourceSquareKey(sourceCoordForName('soulbane_rage_entry')),
    `${label}: scene memory source is distinct from the room source square`);
  const memoryZones = assignedInstanceZones(instance)
    .filter(zone => sourceSquareKeyForZone(zone) === memorySquare);
  assert(memoryZones.length > 0, `${label}: actual memory-source InstanceZones are present`);
  const components = connectedZoneComponents(memoryZones);
  assert.equal(components.length, 2, `${label}: Rage and Fear form separate copied memory patches`);
  const rageAnchor = instanceZoneForSource(instance, rageSource, `${label}: Rage scene anchor`);
  const fearAnchor = instanceZoneForSource(instance, fearSource, `${label}: Fear scene anchor`);
  const rageZones = components.find(component => component.includes(rageAnchor));
  const fearZones = components.find(component => component.includes(fearAnchor));
  assert(rageZones && fearZones && rageZones !== fearZones,
    `${label}: the two actual scene anchors identify distinct memory patches`);
  for (const [kind, component] of [['Rage', rageZones], ['Fear', fearZones]]) {
    for (const zone of component) {
      const { north } = instanceDestinationOffset(instance, zone);
      assert(north >= 14,
        `${label}: ${kind} memory remains at least seven zones north of both source squares`);
      for (const roomZone of roomZones) {
        assert(Math.max(Math.abs(zone.x - roomZone.x), Math.abs(zone.z - roomZone.z)) >= 7,
          `${label}: ${kind} memory stays at least seven zones from every room zone`);
      }
    }
  }
  assert(Math.abs(rageAnchor.x - fearAnchor.x) >= 13,
    `${label}: the scene-memory standing zones remain at least thirteen zones apart horizontally`);
  for (const rageZone of rageZones) {
    for (const fearZone of fearZones) {
      assert(Math.max(Math.abs(rageZone.x - fearZone.x), Math.abs(rageZone.z - fearZone.z)) >= 7,
        `${label}: Rage and Fear patches stay seven zones apart in both directions`);
    }
  }
  for (const name of ['soulbane_scene_launa', 'soulbane_scene_tolna']) {
    const zone = instanceZoneForSource(instance, sourceCoordForName(name), `${label}: ${name}`);
    assert(rageZones.includes(zone), `${label}: ${name} maps into the Rage memory patch`);
  }
  const fearTolna = instanceZoneForSource(
    instance, sourceCoordForName('soulbane_fear_scene_tolna'), `${label}: Fear scene Tolna`);
  assert(fearZones.includes(fearTolna), `${label}: Fear scene Tolna maps into the Fear memory patch`);
  return { rageZones, fearZones };
}
function assertInstanceTemplateInventory(instance, label) {
  const roomZones = roomSourceZones(instance, label);
  const { rageZones, fearZones } = memoryPatchComponents(instance, roomZones, label);
  const allowed = new Set([...roomZones, ...rageZones, ...fearZones].map(destinationZoneKey));
  const assigned = assignedInstanceZones(instance);
  assert.equal(assigned.length, allowed.size, `${label}: all assigned zones belong to the room or one memory patch`);
  for (const zone of assigned) {
    assert(allowed.has(destinationZoneKey(zone)),
      `${label}: no unassigned source template enters the owner's copy`);
  }
  return { roomZones, rageZones, fearZones };
}
function instanceNativeFloodfill(p, instance, label, seedTiles = null) {
  const minX = instance.sw.x;
  const maxX = minX + (instance.zonesEast << 3);
  const minZ = instance.sw.z;
  const maxZ = minZ + (instance.zonesNorth << 3);
  const start = { level: p.level, x: p.x, z: p.z };
  assert(start.level >= instance.sw.level && start.level < instance.sw.level + instance.floors,
    `${label}: floodfill starts on an owner instance floor`);
  assert(start.x >= minX && start.x < maxX && start.z >= minZ && start.z < maxZ,
    `${label}: floodfill starts inside the private instance bounds`);
  const key = (x, z) => `${start.level}:${x}:${z}`;
  const tiles = seedTiles ? [...seedTiles] : [start];
  const seen = new Set(tiles.map(tile => key(tile.x, tile.z)));
  const steps = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  // Follow native movement to exhaustion, including padding beyond the owner footprint.
  for (let index = 0; index < tiles.length; index++) {
    const current = tiles[index];
    for (const [dx, dz] of steps) {
      const x = current.x + dx;
      const z = current.z + dz;
      const nextKey = key(x, z);
      if (seen.has(nextKey)) continue;
      if (!map.canTravel(start.level, current.x, current.z, dx, dz, p.width, 0, CollisionType.NORMAL)) continue;
      seen.add(nextKey);
      tiles.push({ level: start.level, x, z });
    }
  }
  return { start, tiles };
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
  assert([2, 3, 4, 5].includes(stage(p)),
    `${label}: native isolation is measured in quest stages 2–5`);
  const instance = instanceForOwner(p, label);
  const roomScene = assertRoomSceneVisibility(p, label, requireRoomPacket);
  const { roomZones, rageZones, fearZones } = assertInstanceTemplateInventory(instance, label);
  assertMemorySceneVisibility(null, rageZones, `${label}: Rage scene`, false);
  assertMemorySceneVisibility(null, fearZones, `${label}: Fear scene`, false);
  assertNoBlankPaddingShortcut(p, instance, assignedInstanceZones(instance), label);

  const roomSource = sourceCoordForName('soulbane_rage_entry');
  const neighborSquare = `${roomSource.level}_${(roomSource.x >> 6) + 1}_${roomSource.z >> 6}`;
  const neighborZones = assignedInstanceZones(instance)
    .filter(zone => sourceSquareKeyForZone(zone) === neighborSquare);
  const flood = instanceNativeFloodfill(p, instance, label);
  const allowedRoomSources = roomSourceSquares();
  for (const tileAt of flood.tiles) {
    assertSceneMappingWindow(null, tileAt, allowedRoomSources, `${label}: every native-reachable room tile`);
  }
  if (neighborZones.length === 0) {
    console.log(`PASS private-instance scene isolation ${JSON.stringify({
      stage: stage(p), label, standableSceneTiles: roomScene.standableTiles,
      reachableTiles: flood.tiles.length, neighborCopied: false,
      limit: 'east-neighbor geometry is intentionally absent because the copied variant is reachable in Fear'
    })}`);
    return { instance, roomZones, rageZones, fearZones, flood, neighborTiles: [], neighborLocs: [] };
  }
  assert.equal(neighborZones.length, 64, `${label}: the full east neighbor source square is copied`);
  const neighborTiles = mappedWalkableTiles(neighborZones, `${label}: east neighbor collision`);
  const neighborZoneKeys = new Set(neighborZones.map(destinationZoneKey));
  const reachableNeighborTiles = flood.tiles.filter(tile =>
    neighborZoneKeys.has(`${tile.level}:${tile.x >> 3}:${tile.z >> 3}`)).length;

  const neighborLocs = mappedNeighborSourceLocs(neighborZones, label);
  assert.equal(neighborLocs.length, 719,
    `${label}: all 719 cached locs in the copied east neighbor are inspected`);
  const operableForms = new Set();
  let reachedLocForms = 0;
  let reachedOperationForms = 0;
  for (const loc of neighborLocs) {
    const form = effectiveLocType(p, loc);
    const operations = (form.op ?? []).filter(option => option !== null && option !== 'hidden');
    if (operations.length > 0) operableForms.add(form.id);
    assert.equal(loc.level, flood.start.level, `${label}: neighbor loc ${loc.baseType} shares the room plane`);
    const base = types.LocType.get(loc.type);
    const reached = flood.tiles.some(tile => map.reachedLoc(
      tile.level, tile.x, tile.z, loc.x, loc.z,
      loc.width, loc.length, p.width, loc.angle, loc.shape, base.forceapproach));
    if (reached) {
      reachedLocForms++;
      if (operations.length > 0) reachedOperationForms++;
    }
  }
  assert.equal(operableForms.size, 2,
    `${label}: both non-vacuous effective neighbor operation forms are inspected`);
  assert.equal(reachableNeighborTiles, 0,
    `${label}: native floodfill reaches no collision-open tile in the east neighbor (${neighborTiles.length} native tiles checked)`);
  assert.equal(reachedLocForms, 0, `${label}: no cached neighbor loc is in native operation reach`);
  assert.equal(reachedOperationForms, 0, `${label}: no effective neighbor operation is in native operation reach`);
  console.log(`PASS private-instance scene isolation ${JSON.stringify({
    stage: stage(p),
    label,
    standableSceneTiles: roomScene.standableTiles,
    reachableTiles: flood.tiles.length,
    neighborTiles: neighborTiles.length,
    neighborLocs: neighborLocs.length,
    operableForms: operableForms.size,
    reachableNeighborTiles,
    reachedLocForms,
    reachedOperationForms
  })}`);
  return { instance, roomZones, rageZones, fearZones, flood, neighborTiles, neighborLocs };
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
function assertSceneMappingWindow(p, tileAt, allowedSourceSquares, label, requirePacket = false, allowedZoneKeys = null) {
  const visible = mappedZonesInSceneWindow(tileAt);
  const center = World.gameMap.getZoneIfExists(tileAt.x, tileAt.z, tileAt.level);
  assert(center instanceof InstanceZone, `${label}: the stand tile remains in a native instance zone`);
  if (center.hasAssignedTemplate) {
    assert(visible.includes(center), `${label}: current mapped tile is present in its 13×13 scene window`);
  } else {
    assert(map.isZoneAllocated(tileAt.level, tileAt.x, tileAt.z)
      && !map.isMapBlocked(tileAt.x, tileAt.z, tileAt.level),
    `${label}: an unmapped stand tile is genuinely collision-open native padding`);
  }
  for (const zone of visible) {
    assert(allowedSourceSquares.has(sourceSquareKeyForZone(zone)),
      `${label}: scene from native tile ${tileAt.level}:${tileAt.x}:${tileAt.z} uses only its allowlisted source squares; found ${instanceTemplateTuple(zone)}`);
    if (allowedZoneKeys) {
      assert(allowedZoneKeys.has(destinationZoneKey(zone)),
        `${label}: memory scene uses only its own patch; found ${instanceTemplateTuple(zone)}`);
    }
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
      `${label}: emitted RebuildRegion templates match the actual native four-level scene mapping`);
  }
  return visible.length;
}
function assertRoomSceneVisibility(p, label, requirePacket = false) {
  const instance = instanceForOwner(p, label);
  const assigned = assignedInstanceZones(instance);
  const memorySquare = sourceSquareKey(sourceCoordForName('soulbane_scene_player'));
  const memoryZones = assigned.filter(zone => sourceSquareKeyForZone(zone) === memorySquare);
  const memoryComponents = connectedZoneComponents(memoryZones);
  const anchorZone = name => {
    const source = sourceCoordForName(name);
    const sourceKey = `${source.level}:${source.x >> 3}:${source.z >> 3}`;
    return memoryZones.find(zone =>
      `${zone.source.level}:${zone.source.x}:${zone.source.z}` === sourceKey);
  };
  const rageAnchor = anchorZone('soulbane_scene_player');
  const fearAnchor = anchorZone('soulbane_fear_scene_player');
  const knownMemoryZones = new Set([
    ...(memoryComponents.find(component => component.includes(rageAnchor)) ?? []),
    ...(memoryComponents.find(component => component.includes(fearAnchor)) ?? [])
  ].map(destinationZoneKey));
  const roomCandidateZones = assigned.filter(zone => !knownMemoryZones.has(destinationZoneKey(zone)));
  const roomTiles = collisionOpenTiles(roomCandidateZones);
  const allowedSourceSquares = roomSourceSquares();
  for (const tileAt of roomTiles) {
    assertSceneMappingWindow(null, tileAt, allowedSourceSquares, `${label}: all room standable tiles`);
  }
  assert(roomTiles.length > 0,
    `${label}: scene isolation checks all non-memory collision-open tiles, including blank tiles`);
  const currentTile = { level: p.level, x: p.x, z: p.z };
  assertSceneMappingWindow(p, currentTile, allowedSourceSquares, `${label}: real room scene`,
    requirePacket);
  return { standableTiles: roomTiles.length, memorySquare, memoryComponents };
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
function assertMemorySceneVisibility(p, zones, label, requirePacket = false) {
  const tiles = collisionOpenTiles(zones);
  assert(tiles.length > 0, `${label}: all-standable memory scene predicate is non-vacuous`);
  const instance = World.instances.findInstanceByCoord(tiles[0]);
  assert(instance, `${label}: native memory tiles belong to a live instance`);
  const flood = instanceNativeFloodfill({ ...tiles[0], width: p?.width ?? 1 }, instance, label, tiles);
  const allowedSourceSquares = new Set([sourceSquareKeyForZone(zones[0])]);
  const allowedZoneKeys = new Set(zones.map(destinationZoneKey));
  let minNorth = Infinity;
  let maxNorth = -Infinity;
  for (const tileAt of flood.tiles) {
    const north = (tileAt.z - instance.sw.z) >> 3;
    minNorth = Math.min(minNorth, north);
    maxNorth = Math.max(maxNorth, north);
    assertSceneMappingWindow(null, tileAt, allowedSourceSquares, `${label}: all native-walkable memory tiles`,
      false, allowedZoneKeys);
  }
  if (p) {
    assertSceneMappingWindow(p, { level: p.level, x: p.x, z: p.z }, allowedSourceSquares,
      `${label}: real memory scene`, requirePacket, allowedZoneKeys);
  }
  console.log(`PASS complete native memory floodfill ${JSON.stringify({
    label, seedTiles: tiles.length, reachableTiles: flood.tiles.length, minNorth, maxNorth
  })}`);
  return flood.tiles.length;
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
  for (const entryName of ['soulbane_rage_entry', 'soulbane_fear_entry']) {
    const start = roomCoord(p, entryName);
    for (const sceneName of ['soulbane_scene_player', 'soulbane_fear_scene_player']) {
      const destination = roomCoord(p, sceneName);
      assert(!hasExactNativeRoute(start, destination),
        `${label}: ${entryName} cannot walk through blank padding into ${sceneName}`);
    }
  }
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
    assertMemorySceneVisibility(p, fearZones, 'Fear memory scene', true);
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

  const westExit = fearWestExitLoc(p);
  goToStand(p, westExit, 'stage-5 open west exit: walk to the western black hole');
  const openMark = p.messages.length;
  const open = operateLoc(p, westExit, 1, [], 'stage-5 Confusion boundary refusal');
  assert.equal(open.trigger.name, '[oploc1,soul_bane_fwall_exit]',
    'lit west exit dispatches its original open visible form');
  assert(p.messages.slice(openMark).join(' ').includes('That way is not available yet.'),
    'the not-yet-implemented Confusion room remains a functional refusal');
  assert.equal(stage(p), FEAR_COMPLETE_STAGE, 'the Confusion boundary does not advance beyond Fear');
  assert.equal(readVar(p, 'soulbane_fear_killedtally'), 5, 'Confusion refusal preserves all five Fear kills');

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
  return { player: p, completed: p, stageThreeColor };
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
  const r1Cases = new Map([
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
    selected();
    console.log(`PASS Soulbane isolated R1 case: ${name}`);
    return;
  }

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
  console.log('PASS Soulbane compiled regression: Rage and Fear progression, native combat, ownership, saved boundaries, lifecycle and escape routes');
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
