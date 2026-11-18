#!/usr/bin/env node
// First-unit Soul's Bane regression: native rift/Rage dispatch, owned region,
// combat meter, family scene and the permanent stage-3 boundary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  Packet, PlayerLoading, PlayerStat, ScriptProvider, ScriptState,
  World, button, contentRoot, count, dialoguePage, engineModule, execute, held, id,
  inv, invCom, inventory, map, obj, player as makePlayer, remove, resumeDialogue,
  seed, slotOf, tile, types, useLoc
} from '../swamp-caves/runtime.mjs';

const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
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
const RAGE_IDS = new Set(RAGE_TYPES.map(name => requiredId('NpcType', name)));
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
// Derive the expected two-page layout independently of the compiled helper's
// caller-owned region pointer; real entry/spawn/scene positions are checked below.
function templateCoord(p, packed) {
  const instance = World.instances.findInstanceByCoord(p);
  assert(instance && instance.uid + 1 === instanceUid(p), 'coordinate query uses the player-owned region');
  const template = unpackWorld(packed);
  const squareX = template.x >> 6;
  const squareZ = template.z >> 6;
  assert((squareX === 47 && squareZ === 81) || (squareX === 51 && squareZ === 53),
    'room template belongs to one of the two copied cache squares');
  return {
    level: instance.sw.level + template.level,
    x: instance.sw.x + (squareX === 51 ? 64 : 0) + (template.x & 63),
    z: instance.sw.z + (template.z & 63)
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
    npc.vars[NPC_INSTANCE] === uid && npc.vars[NPC_OWNER] === p.uid);
}
function rageNpcsWithInstance(uid) {
  return [...World.npcs].filter(npc => npc?.isActive && RAGE_IDS.has(npc.type) && npc.vars[NPC_INSTANCE] === uid);
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
function fearExitLoc(p) {
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
      assert.equal(actor.vars[NPC_OWNER], p.uid, `${name} belongs to the entering account`);
      assert.equal(actor.vars[NPC_XP_MULTIPLIER], 0, `${name} disables normal combat XP at spawn`);
    }
  }
  return entry;
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
  for (let tick = 0; tick < 1200; tick++) {
    if (stage(p) === 2 && readVar(p, 'soulbane_anger_donespecial') === 1 && observeRageScene(p)) {
      sawFamilyStaging = true;
    }
    const state = p.activeScript;
    if (state?.execution === ScriptState.PAUSEBUTTON) {
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      assert(!/^multi[2-5]$/.test(root), 'the compiled family scene has no unanswered choices');
      pages.push(...dialoguePage(p));
      resumeDialogue(p);
      if (stage(p) === 2 && readVar(p, 'soulbane_anger_donespecial') === 1 && observeRageScene(p)) {
        sawFamilyStaging = true;
      }
      continue;
    }
    worldTick();
    if (stage(p) === 2 && readVar(p, 'soulbane_anger_donespecial') === 1 && observeRageScene(p)) {
      sawFamilyStaging = true;
    }
    if (stage(p) === 3 && p.queue.head() === null &&
      (!p.activeScript || p.activeScript.execution === ScriptState.FINISHED)) break;
  }
  assert(sawFamilyStaging, 'Rage special runs the authored player/Launa/Tolna staging before returning');
  assert.equal(stage(p), 3, 'family scene commits the permanent stage-3 boundary');
  assert.deepEqual({ level: p.level, x: p.x, z: p.z }, roomCoord(p, 'soulbane_rage_entry'),
    'family scene returns the player to the Rage entry tile');
  assert(pages.some(text => text.includes('Arrrgghhh!')), 'family scene includes the authored anger outburst');
  assert(pages.some(text => text.includes("Where are you going?")), "family scene includes Launa's first authored line");
  assert(pages.some(text => text.includes('TOLNA !!!')), 'family scene includes Launa reunion line');
  return pages.join(' ');
}

function chooseRiftWithRope(p, label) {
  const rift = riftLoc();
  goToStand(p, rift, `${label}: walk to actual rift floor`);
  const result = operateLoc(p, rift, 1, [], `${label}: use Climb-down on rift`);
  assert.match(result.trigger.name, /^\[oploc1,soulbane_falloff2_rope(?:_multi)?\]$/,
    `${label}: descent dispatch uses the rope-visible floor form`);
  assert(stage(p) >= 2, `${label}: descent runs the compiled Rage admission`);
  assert.notEqual(instanceUid(p), 0, `${label}: descent creates a private region`);
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
function runNativeAttack(p, npc, label, maxTicks = 80) {
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
    if (stage(p) === 3 || readVar(p, 'soulbane_anger_donespecial') === 1 || !npc.isActive) break;
  }
  assert(!npc.isActive || readVar(p, 'soulbane_anger_donespecial') === 1 || stage(p) === 3,
    `${label}: real native attack/AI queue lands a hit; ${JSON.stringify({ player: { tile: tile(p), hp: p.levels[PlayerStat.HITPOINTS], stage: stage(p), uid: instanceUid(p), delayed: p.delayed, interaction: p.target?.nid, script: p.activeScript?.script?.name, execution: p.activeScript?.execution, messages: p.messages.slice(-8) }, npc: { tile: [npc.level, npc.x, npc.z], hp: npc.levels[HP_STAT], beforeHp, mode: npc.mode, owner: npc.vars[NPC_OWNER], instance: npc.vars[NPC_INSTANCE] }, meter: readVar(p, 'soulbane_anger_damagedealt'), beforeMeter })}`);
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

function nativeLogoutAndReload(p, label) {
  const oldPid = p.pid;
  const oldSlot = p.slot;
  const oldUid = p.uid;
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
  loaded.pid = oldPid; loaded.slot = oldSlot; loaded.uid = oldUid; loaded.isActive = true;
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

  goToStand(p, quit, 'stage-2 quit Yes: return to actual exit loc');
  operateLoc(p, quit, 1, [1], 'stage-2 quit Yes choice');
  worldTick();
  assert.equal(stage(p), 2, 'leaving Rage does not fabricate completion');
  assert.equal(instanceUid(p), 0, 'Yes closes the unfinished private region');
  assertNoAngerItems(p, 'stage-2 leave cleanup');
  assert.equal(readVar(p, 'soulbane_anger_damagedealt'), 0, 'stage-2 leave resets unfinished anger meter');
  assert.equal(rageNpcsWithInstance(originalUid).length, 0, 'stage-2 leave removes every owned Rage actor');
  assert(!CoordGrid.isInstanceX(p.x), 'stage-2 leave returns to an overworld coordinate');

  chooseRiftWithRope(p, 'stage-2 re-entry after confirmed leave');
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
  seedStageOneOwner(p, 'disclosed isolated death fixture');
  equipAngerWeapon(p, 'soulbane_anger_spearq', 'death fixture weapon');
  const xpBefore = xpSnapshot(p);
  const qpBefore = readVar(p, 'qp');
  const oldUid = instanceUid(p);
  // Disclosed test-only lethal HP seed; player_die enqueues the ordinary death queue.
  p.levels[PlayerStat.HITPOINTS] = 0;
  assert(ScriptProvider.getByName('[proc,player_die]'), 'packed ordinary player_die procedure exists');
  runProc('player_die', p);
  for (let tick = 0; tick < 80 && (p.activeScript || p.queue.head() !== null); tick++) worldTick();
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED, 'ordinary death animation/queue settles');
  assert.equal(stage(p), 2, 'death during Rage cannot complete the quest');
  assert.equal(instanceUid(p), 0, 'ordinary post-respawn Soulbane cleanup releases the instance UID');
  assert(!CoordGrid.isInstanceX(p.x), 'ordinary death respawns the player outside the instance');
  assert.equal(rageNpcsWithInstance(oldUid).length, 0, 'ordinary death and cleanup remove every old Rage actor');
  assert.deepEqual(xpSnapshot(p), xpBefore, 'death grants neither the Rage reward nor normal combat XP');
  assert.equal(readVar(p, 'qp'), qpBefore, 'death grants no quest points');
}

function countGroundWeapons(p) {
  return WEAPONS.reduce((sum, weapon) => sum + (World.getObj(p.x, p.z, p.level, obj(weapon.name), p.hash64) ? 1 : 0), 0);
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
  chooseRiftWithRope(p, 'main compiled descent');
  assert.equal(stage(p), 2, 'native descent advances accepted quest to Rage stage 2');
  assert.notEqual(instanceUid(p), 0, 'native descent stores a temporary region UID');
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

  const fear = fearExitLoc(p);
  goToStand(p, fear, 'stage-3 closed boundary: walk to packed Fear exit');
  const fearMessageMark = p.messages.length;
  const fearResult = operateLoc(p, fear, 1, [], 'stage-3 next-room boundary Use');
  assert.match(fearResult.trigger.name, /^\[oploc1,soul_bane_awall_void_exit\]$/);
  assert(p.messages.slice(fearMessageMark).join(' ').includes('not available yet'),
    'next-room way truthfully refuses to open the unimplemented Fear room');
  assert.equal(stage(p), 3, 'next-room refusal preserves the permanent stage-3 boundary');
  assert.equal(instanceUid(p) !== 0, true, 'refusing the next room does not strand or evict the completed player');

  const completedActorsBeforeLeave = rageNpcsFor(p).length;
  assert(completedActorsBeforeLeave === 0, 'completed room removes its Rage attackers');
  const quit = quitLoc(p);
  goToStand(p, quit, 'stage-3 leave: walk to the actual room-exit loc');
  const leave = operateLoc(p, quit, 1, [], 'stage-3 direct exit without a restart prompt');
  assert.match(leave.trigger.name, /^\[oploc1,soul_bane_awall_void_small\]$/);
  assert.equal(stage(p), 3, 'stage-3 leave preserves completed progress');
  assert.equal(instanceUid(p), 0, 'stage-3 leave closes the private region');
  assert(!CoordGrid.isInstanceX(p.x), 'stage-3 leave returns to the overworld');

  chooseRiftWithRope(p, 'stage-3 completed-room re-entry');
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
  return { player: p, completed, stageTwoColor, stageThreeColor, reward };
}

function run() {
  checkVarpMetadata();
  const main = testMainPath();
  const stageTwo = testStageTwoLeaveAndLogout(main.player);
  assert.equal(latestQuestColor(stageTwo.reloaded), main.stageTwoColor, 'mid-Rage login reconstruction preserves the active-stage quest color');
  assertJournal(stageTwo.reloaded, ['very aggressive room', 'defeat the monsters'], ['Soulbane is complete'],
    'post-login stage-2 journal');
  testDeath(main.player);
  console.log('PASS Soulbane compiled first-unit regression: entry, Rage combat, ownership, lifecycle, stage-3 boundary');
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
