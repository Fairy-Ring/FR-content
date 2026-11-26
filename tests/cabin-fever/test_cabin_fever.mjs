#!/usr/bin/env node
// Compiled Cabin Fever proof. Reads only the checked-out content and built pack.
// Run from the engine with `node --import tsx ../content/tests/cabin-fever/test_cabin_fever.mjs`;
// HARNESS_ENGINE_DIR may select another compatible engine, or pass `--engine <dir>`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index];
  if (arg === '--engine') {
    assert(process.argv[index + 1], '--engine requires an engine directory');
    process.env.HARNESS_ENGINE_DIR = path.resolve(process.argv[++index]);
  } else if (arg.startsWith('--engine=')) {
    process.env.HARNESS_ENGINE_DIR = path.resolve(arg.slice('--engine='.length));
  } else {
    assert.fail(`unknown Cabin Fever test argument: ${arg}`);
  }
}

const runtime = await import('../swamp-caves/runtime.mjs');
const {
  World, PlayerStat, ScriptProvider, ScriptState, contentRoot: loadedContent,
  engineModule, id, obj, inv, invCom, player, seed, inventory, slotOf,
  resumeDialogue, interactionTick, weakCount, types
} = runtime;
assert.equal(loadedContent, contentRoot, 'the runtime loads this checked-out content tree');
const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const OpNpc = (await engineModule('network/game/client/model/OpNpc.ts')).default;
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const OpLocU = (await engineModule('network/game/client/model/OpLocU.ts')).default;
const npcHandler = new (await engineModule('network/game/client/handler/OpNpcHandler.ts')).default();
const locHandler = new (await engineModule('network/game/client/handler/OpLocHandler.ts')).default();
const locUseHandler = new (await engineModule('network/game/client/handler/OpLocUHandler.ts')).default();
const rsbuf = await engineModule('network/rsbuf/index.ts');
const { NpcStat } = await engineModule('engine/entity/NpcStat.ts');
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const resolveNpcType = (await engineModule('engine/entity/resolveNpcType.ts')).default;
const map = await engineModule('engine/GameMap.ts');
const IfSetText = (await engineModule('network/game/server/model/IfSetText.ts')).default;

const questScriptRoot = path.join(contentRoot, 'scripts/quests/quest_fever/scripts');
function rs2Files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? rs2Files(full) : entry.name.endsWith('.rs2') ? [full] : [];
  });
}
const sourceFiles = rs2Files(questScriptRoot);
const sourceText = sourceFiles.map(file => fs.readFileSync(file, 'utf8'));
const sourceSymbols = new Set(sourceText.flatMap(source =>
  [...source.matchAll(/^\s*(\[[^\]\r\n]+\])/gm)].map(match => match[1])));
const constantsText = [
  fs.readFileSync(path.join(contentRoot, 'scripts/quests/quest_fever/configs/fever.constant'), 'utf8'),
  fs.readFileSync(path.join(contentRoot, 'scripts/general/configs/quest.constant'), 'utf8')
].join('\n');
function constant(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\^${escaped}\\s*=\\s*(-?\\d+)\\s*$`, 'm').exec(constantsText);
  assert(match, `checked-out constants define ${name}`);
  return Number(match[1]);
}
function requiredId(kind, name) {
  const value = types[kind].getId(name);
  assert(value >= 0, `packed ${kind} defines ${name}`);
  return value;
}
function readVar(p, name) {
  const bit = types.VarBitType.getId(name);
  if (bit >= 0) return p.getVarBit(bit);
  return p.getVar(requiredId('VarPlayerType', name));
}
function writeVar(p, name, value) {
  const bit = types.VarBitType.getId(name);
  if (bit >= 0) p.setVarBit(bit, value);
  else p.setVar(requiredId('VarPlayerType', name), value);
}
function setSkill(p, stat, level) {
  p.baseLevels[stat] = level;
  p.levels[stat] = level;
}
const stage = p => readVar(p, 'fever_quest');
const itemCount = (p, name, inventory = inv) => p.invTotal(inventory, obj(name));
const tile = p => ({ level: p.level, x: p.x, z: p.z });
const tileTuple = p => [p.level, p.x, p.z];
const currentSkillXp = (p, stat) => p.stats[stat];
const completeStage = constant('fever_complete');
const questPointsReward = constant('fever_questpoints');
const invSize = types.InvType.get(inv).size;
const bank = requiredId('InvType', 'bank');

function packedTrigger(trigger, label) {
  assert(trigger, `${label}: production dispatch resolves a trigger`);
  assert(sourceSymbols.has(trigger.name), `${label}: ${trigger.name} is declared in Cabin Fever RuneScript`);
  assert(ScriptProvider.getByName(trigger.name), `${label}: ${trigger.name} is present in the built pack`);
  return trigger;
}
function locTypeForPlayer(p, loc) {
  let type = types.LocType.get(loc.type);
  if (type.multivarp !== -1 || type.multivarbit !== -1) {
    const state = type.multivarp !== -1 ? p.getVar(type.multivarp) : p.getVarBit(type.multivarbit);
    const child = type.multiloc[state];
    if (child !== undefined && child >= 0) type = types.LocType.get(child);
  }
  return type;
}
function displayedLocName(p, loc) {
  const type = locTypeForPlayer(p, loc);
  assert(type?.debugname, `packed visible loc type exists for ${loc.type}`);
  return type.debugname;
}
function displayedNpcName(p, npc) {
  const type = resolveNpcType(types.NpcType.get(npc.type), p);
  assert(type?.debugname, `packed visible NPC type exists for ${npc.type}`);
  return type.debugname;
}

// Decode MAP flags before LOC rows so World.getLoc uses GameMap's server plane.
// Keep mapLevel as the source plane while level is the effective server plane:
// a level-one cell with f2 (LINK_BELOW) moves its LOC one level down.
const mapRows = [];
for (const file of fs.readdirSync(path.join(contentRoot, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name)).sort()) {
  const [, squareX, squareZ] = /^m(\d+)_(\d+)\.jm2$/.exec(file);
  const mapFlags = new Map();
  let mapSection = false;
  let locSection = false;
  for (const line of fs.readFileSync(path.join(contentRoot, 'maps', file), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) {
      mapSection = line === '==== MAP ====';
      locSection = line === '==== LOC ====';
      continue;
    }
    if (mapSection) {
      const match = /^(\d+) (\d+) (\d+):(?: (.*))?$/.exec(line);
      if (match) {
        const [, level, localX, localZ, flags = ''] = match;
        mapFlags.set(`${level}:${localX}:${localZ}`, flags.split(/\s+/).filter(Boolean));
      }
      continue;
    }
    if (!locSection) continue;
    const match = /^(\d+) (\d+) (\d+): (\d+) (\d+)(?: (\d+))?/.exec(line);
    if (!match) continue;
    const [, rawLevelText, localX, localZ, type, shape, angle = '0'] = match;
    const mapLevel = Number(rawLevelText);
    const linkBelow = mapFlags.get(`1:${localX}:${localZ}`)?.includes('f2') ?? false;
    const level = linkBelow ? mapLevel - 1 : mapLevel;
    if (level < 0) continue;
    mapRows.push({
      level, mapLevel, x: Number(squareX) * 64 + Number(localX),
      z: Number(squareZ) * 64 + Number(localZ), type: Number(type),
      shape: Number(shape), angle: Number(angle), square: `${squareX}_${squareZ}`
    });
  }
}
const locParentsByChild = new Map();
for (let typeId = 0; typeId < types.LocType.count; typeId++) {
  const type = types.LocType.get(typeId);
  for (const child of type.multiloc) {
    if (child < 0) continue;
    const parents = locParentsByChild.get(child) ?? [];
    parents.push(typeId);
    locParentsByChild.set(child, parents);
  }
}
function placementTypeIds(name) {
  const typeId = requiredId('LocType', name);
  return new Set([typeId, ...(locParentsByChild.get(typeId) ?? [])]);
}
function mappedLocRows(name) {
  const acceptedTypes = placementTypeIds(name);
  return mapRows.filter(row => acceptedTypes.has(row.type));
}
function locPlacements(name, predicate = () => true) {
  return mappedLocRows(name).flatMap(row => {
    const loc = World.getLoc(row.x, row.z, row.level, row.type);
    return loc && predicate(loc, row) ? [{ row, loc }] : [];
  });
}
function assertMappedForm(name, p, expected, label) {
  const rows = mappedLocRows(name);
  assert(rows.length > 0, `${name} has an original packed map placement`);
  for (const row of rows) assert.equal(displayedLocName(p, row), expected, `${label}: packed client visual`);
}
function assertEnemyHull(p, hits) {
  for (let hole = 1; hole <= 3; hole++) {
    assertMappedForm(`fever_multi_hole_enemy_${hole}`, p,
      hole <= hits ? 'toms_fever_shiphull_leak' : 'fever_cutscene_shiphull',
      `enemy hull visual ${hole} follows the product-written hit count ${hits}`);
  }
}
function checkedTraversalPlacements(name) {
  // Original harbour mast returns have no reachable climb-up entry. The unit's
  // mast traversal is the battle ships; harbour deck/hold ladders stay covered.
  const mast = name === 'fever_climb_down_location' || name.startsWith('fever_sail1_hoistedl_climb');
  return locPlacements(name, (loc, row) => !mast || row.square === '28_75');
}
function oneLoc(name, predicate = () => true) {
  const found = locPlacements(name, predicate);
  assert(found.length > 0, `original packed placement exists for ${name}`);
  return found[0];
}
function locAt(record, names = []) {
  const candidates = [...new Set([record.row.type, ...names.map(name => requiredId('LocType', name))])];
  for (const typeId of candidates) {
    const loc = World.getLoc(record.row.x, record.row.z, record.row.level, typeId);
    if (loc) return { ...record, loc };
  }
  assert.fail(`packed loc at ${record.row.level}_${record.row.x}_${record.row.z} still exists in one of ${names.join(', ') || 'its map form'}`);
}
function locStand(loc) {
  const type = types.LocType.get(loc.type);
  for (let distance = 1; distance <= 10; distance++) {
    for (let dx = -distance; dx <= distance; dx++) {
      for (let dz = -distance; dz <= distance; dz++) {
        const x = loc.x + dx, z = loc.z + dz;
        if (map.isMapBlocked(x, z, loc.level)) continue;
        if (!map.reachedLoc(loc.level, x, z, loc.x, loc.z, type.width, type.length,
          1, loc.angle, loc.shape, type.forceapproach)) continue;
        const stand = { level: loc.level, x, z };
        if (!landingAnchors(stand).some(anchor => hasPackedPath(anchor, stand))) continue;
        return stand;
      }
    }
  }
  return null;
}
function npcByName(name) {
  const typeId = requiredId('NpcType', name);
  const npc = World.npcs.find(candidate => candidate?.isActive
    && (candidate.type === typeId || candidate.baseType === typeId));
  assert(npc, `original packed NPC placement exists for ${name}`);
  return npc;
}
function npcStand(p, npc) {
  const saved = tile(p);
  for (let distance = 1; distance <= 10; distance++) {
    for (let x = npc.x - distance; x <= npc.x + (npc.width ?? 1) + distance - 1; x++) {
      for (let z = npc.z - distance; z <= npc.z + (npc.length ?? 1) + distance - 1; z++) {
        if (map.isMapBlocked(x, z, npc.level)) continue;
        p.level = npc.level; p.x = x; p.z = z;
        const stand = { level: npc.level, x, z };
        if (p.inOperableDistance(npc) && landingAnchors(stand).some(anchor => hasPackedPath(anchor, stand))) {
          p.level = saved.level; p.x = saved.x; p.z = saved.z;
          return stand;
        }
      }
    }
  }
  p.level = saved.level; p.x = saved.x; p.z = saved.z;
  return null;
}
function setAt(p, destination) {
  p.level = destination.level; p.x = destination.x; p.z = destination.z;
  p.originX = p.x; p.originZ = p.z;
  p.clearInteraction();
}
function showNpc(p, npc) {
  rsbuf.addPlayer(p.slot);
  rsbuf.addNpc(npc.nid, npc.type);
  const appearance = p.generateAppearance();
  const hp = PlayerStat.HITPOINTS;
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, appearance, p.lastAppearance,
    p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ,
    p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[hp], p.baseLevels[hp], p.animId, p.animDelay, p.sayMessage,
    p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0,
    p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(npc.x, npc.level, npc.z, npc.nid, npc.type, npc.tele, npc.jump, npc.runDir,
    npc.walkDir, npc.isActive, npc.masks, npc.faceEntity, npc.faceSquareX, npc.faceSquareZ,
    npc.faceAngleX, npc.faceAngleZ, npc.hitmarkDamage, npc.hitmarkType, npc.hitmark2Damage,
    npc.hitmark2Type, npc.levels[NpcStat.HITPOINTS], npc.baseLevels[NpcStat.HITPOINTS],
    npc.animId, npc.animDelay, npc.sayMessage, npc.spotanimId, npc.spotanimHeight, npc.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, npc.nid), 'the production visibility encoder includes the selected NPC');
}
function advanceInteraction(p) {
  interactionTick(p);
  World.processZones();
}
function finishInteraction(p, choices = [], label = 'compiled interaction') {
  const remaining = [...choices];
  for (let tick = 0; tick < 600; tick++) {
    const state = p.activeScript;
    if (state?.execution === ScriptState.PAUSEBUTTON) {
      const root = p.modalChat >= 0 ? types.Component.get(p.modalChat)?.comName ?? '' : '';
      if (/^multi[2-5]$/.test(root)) {
        assert(remaining.length > 0, `${label}: explicit choice supplied for ${root}`);
        resumeDialogue(p, remaining.shift());
      } else {
        resumeDialogue(p);
      }
      continue;
    }
    if (state?.execution === ScriptState.SUSPENDED || weakCount(p) > 0) {
      advanceInteraction(p);
      continue;
    }
    if (state && state.execution !== ScriptState.FINISHED) {
      advanceInteraction(p);
      continue;
    }
    break;
  }
  assert.equal(remaining.length, 0, `${label}: every selected dialogue choice was consumed`);
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED,
    `${label}: compiled script finished without an outstanding dialog`);
}
function nativeNpc(p, npc, option = 1, choices = [], label = `NPC option ${option}`) {
  const stand = npcStand(p, npc);
  assert(stand, `${label}: real NPC placement has a collision-safe operable stand`);
  setAt(p, stand);
  showNpc(p, npc);
  assert(p.inOperableDistance(npc), `${label}: fixture stands within normal NPC operation distance`);
  assert(npcHandler.handle(new OpNpc(option, npc.nid), p), `${label}: production OpNpc accepts the visible NPC`);
  const visible = displayedNpcName(p, npc);
  const trigger = packedTrigger(p.getOpTrigger(), label);
  assert.equal(trigger.name, `[opnpc${option},${visible}]`, `${label}: native dispatch selects the shown NPC form`);
  p.processInteraction();
  finishInteraction(p, choices, label);
  return trigger;
}
function nativeLoc(p, record, option = 1, choices = [], label = `loc option ${option}`) {
  const loc = record.loc;
  const stand = locStand(loc);
  assert(stand, `${label}: packed loc has a collision-safe operation stand`);
  setAt(p, stand);
  assert(p.inOperableDistance(loc), `${label}: fixture stands within normal loc operation distance`);
  const visible = displayedLocName(p, loc);
  assert(locHandler.handle(new OpLoc(option, loc.x, loc.z, loc.type), p), `${label}: production OpLoc accepts the real loc`);
  const trigger = packedTrigger(p.getOpTrigger(), label);
  assert.equal(trigger.name, `[oploc${option},${visible}]`, `${label}: native dispatch selects the client-visible loc form`);
  p.processInteraction();
  finishInteraction(p, choices, label);
  return trigger;
}
function nativeUseLoc(p, record, item, label = `use ${item} on loc`) {
  const loc = record.loc;
  const stand = locStand(loc);
  assert(stand, `${label}: packed loc has a collision-safe item-use stand`);
  setAt(p, stand);
  assert(p.inOperableDistance(loc), `${label}: fixture stands within normal loc operation distance`);
  const visible = displayedLocName(p, loc);
  assert(locUseHandler.handle(new OpLocU(loc.x, loc.z, loc.type, obj(item), slotOf(p, item), invCom), p),
    `${label}: production OpLocU accepts the real loc and inventory item`);
  const trigger = packedTrigger(p.getOpTrigger(), label);
  assert.equal(trigger.name, `[oplocu,${visible}]`, `${label}: native dispatch selects the client-visible loc form`);
  p.processInteraction();
  finishInteraction(p, [], label);
  return trigger;
}
function coordConstant(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\^${escaped}\\s*=\\s*(\\d+)_(\\d+)_(\\d+)_(\\d+)_(\\d+)\\s*$`, 'm').exec(constantsText);
  assert(match, `fever.constant defines the landing ${name}`);
  const [, level, squareX, squareZ, localX, localZ] = match.map(Number);
  return { level, x: squareX * 64 + localX, z: squareZ * 64 + localZ };
}
const landingPoints = new Map([...constantsText.matchAll(/^\^(fever_[a-z0-9_]+)\s*=\s*(\d+)_(\d+)_(\d+)_(\d+)_(\d+)\s*$/gm)]
  .map(([, name]) => [name, coordConstant(name)]));
function assertLanding(p, destination, label) {
  assert.deepEqual(tileTuple(p), [destination.level, destination.x, destination.z], `${label}: exact checked-out landing`);
  assert.equal(map.isMapBlocked(destination.x, destination.z, destination.level), false,
    `${label}: actual landing is clear in the packed collision map`);
}
function hasPackedPath(start, destination) {
  if (start.level !== destination.level) return false;
  if (start.x === destination.x && start.z === destination.z) return true;
  const route = [...map.findPath(start.level, start.x, start.z, destination.x, destination.z)];
  if (!route.length) return false;
  const last = CoordGrid.unpackCoord(route.at(-1));
  return last.x === destination.x && last.z === destination.z;
}
function landingAnchors(stand) {
  return [openerFixtureStart, ...landingPoints.values(), ...relativeLandingPoints.map(({ point }) => point)]
    .filter(point => point.level === stand.level
      && Math.abs(point.x - stand.x) <= 64 && Math.abs(point.z - stand.z) <= 64);
}
function assertReachableFromLanding(stand, label) {
  const anchors = landingAnchors(stand);
  assert(anchors.length > 0, `${label}: a nearby quest or actual ladder landing shares this plane`);
  assert(anchors.some(anchor => hasPackedPath(anchor, stand)),
    `${label}: an actual checked-out landing has a packed collision route to the placement`);
}
function assertMapIntegration() {
  assert(landingPoints.size > 0, 'fever.constant provides the real landing geometry');
  for (const [name, point] of landingPoints) {
    assert.equal(map.isMapBlocked(point.x, point.z, point.level), false,
      `${name} landing ${point.level}_${point.x}_${point.z} is clear in packed collision`);
  }
  for (const [, name] of sourceText.join('\n').matchAll(/p_telejump\s*\(\s*\^(fever_[a-z0-9_]+)/g)) {
    assert(landingPoints.has(name), `every named p_telejump target ${name} is checked against collision`);
  }
  for (const { name, point } of relativeLandingPoints) {
    assert.equal(map.isMapBlocked(point.x, point.z, point.level), false,
      `${name} relative landing ${point.level}_${point.x}_${point.z} is clear in packed collision`);
  }

  const requiredLocs = [
    'fever_gangplank', 'fever_gangplank_exit', 'fever_gangplank_harmless', 'fever_gangplank_exit_harmless',
    'fever_repair_locker', 'fever_weapons_locker', 'fever_your_gunpowder_barrel',
    'fever_multi_gunpowder_barrel', 'fever_multi_fuse_1', 'fever_multi_fuse_2',
    'fever_multi_hole_1', 'fever_multi_hole_2', 'fever_multi_hole_3',
    'fever_multi_cannon', 'fever_plunder_deposit',
    'fever_multi_crate', 'fever_multi_chest', 'fever_multi_barrel',
    'fever_ship_ladder', 'fever_ship_laddertop', 'fever_climbing_net', 'fever_climb_down_location',
    'fever_sail1_hoistedl_climb'
  ];
  const probe = player();
  for (const name of requiredLocs) {
    const placements = checkedTraversalPlacements(name);
    assert(placements.length > 0, `real packed map placement exists for ${name}`);
    for (const record of placements) {
      const stand = locStand(record.loc);
      assert(stand, `${name} at ${record.loc.level}_${record.loc.x}_${record.loc.z} has a walkable operation stand`);
      assert.equal(map.isMapBlocked(stand.x, stand.z, stand.level), false, `${name} stand is not collision blocked`);
      assertReachableFromLanding(stand, `${name} at ${stand.level}_${stand.x}_${stand.z}`);
    }
  }
  // These original visual-only roots have no operations, so GameMap does not
  // store them as server Loc entities. Their client map and packed morphs remain.
  const visualLocs = ['fever_multi_enemy_cannon', 'fever_multi_hole_enemy_1', 'fever_multi_hole_enemy_2', 'fever_multi_hole_enemy_3'];
  for (const name of visualLocs) {
    assert(mappedLocRows(name).length > 0, `real packed map placement exists for visual-only ${name}`);
  }
  for (const name of [
    'fever_teach', 'fever_port_ship_teach', 'fever_quest_ship_teach',
    'fever_harmless_teach', 'fever_harmless_port_ship_teach'
  ]) {
    const npc = npcByName(name);
    const stand = npcStand(probe, npc);
    assert(stand, `real packed NPC ${name} has a collision-safe operable stand`);
    assert.equal(map.isMapBlocked(stand.x, stand.z, stand.level), false, `${name} stand is not collision blocked`);
    assertReachableFromLanding(stand, `${name} at ${stand.level}_${stand.x}_${stand.z}`);
  }
  console.log(`PASS packed geometry and placements (${landingPoints.size} named landings, ${requiredLocs.length} actionable loc types, ${visualLocs.length} visual loc types, five NPC forms)`);
}

function requirements(p, overrides = {}) {
  setSkill(p, PlayerStat.AGILITY, overrides.agility ?? 42);
  setSkill(p, PlayerStat.CRAFTING, overrides.crafting ?? 45);
  setSkill(p, PlayerStat.SMITHING, overrides.smithing ?? 50);
  setSkill(p, PlayerStat.RANGED, overrides.ranged ?? 40);
  writeVar(p, 'hunt', overrides.hunt ?? constant('hunt_complete'));
  writeVar(p, 'deal_quest', overrides.deal ?? constant('deal_complete'));
}
function assertNoShipSupplies(p, label) {
  for (const item of [
    'fever_rope', 'fever_tinderbox', 'fever_gunpowder', 'fever_fuse', 'fever_cannister_load',
    'fever_cannon_ball', 'fever_cannon_prod', 'fever_cannon', 'fever_repair_plank', 'fever_tack', 'fever_plunder'
  ]) assert.equal(itemCount(p, item), 0, `${label}: ${item} is stripped from the ship`);
}
function currentLocFor(record, ...names) {
  return locAt(record, names);
}
function assertVar(p, name, expected, label) {
  assert.equal(readVar(p, name), expected, `${label}: ${name}`);
}
function currentForm(record, p, expected, label) {
  assert.equal(displayedLocName(p, record.loc), expected, `${label}: visible packed form`);
}
function collectLocker(p, closedName, openName, option, item, amount = 1, subchoice = null) {
  const record = oneLoc(closedName);
  let current = currentLocFor(record, closedName, openName);
  if (current.loc.type !== requiredId('LocType', openName)) {
    nativeLoc(p, current, 1, [], `${closedName} Open`);
    current = currentLocFor(record, openName, closedName);
  }
  assert.equal(current.loc.type, requiredId('LocType', openName), `${openName} is the current server-visible locker form`);
  currentForm(current, p, openName, `${openName} Search`);
  const before = itemCount(p, item);
  nativeLoc(p, current, 1, subchoice === null ? [option] : [option, subchoice], `${openName} Search option ${option}`);
  assert.equal(itemCount(p, item), before + amount, `${openName} supplies ${amount} ${item}`);
  current = currentLocFor(record, openName, closedName);
  if (current.loc.type === requiredId('LocType', openName)) {
    nativeLoc(p, current, 2, [], `${openName} Close`);
    current = currentLocFor(record, closedName, openName);
  }
  assert.equal(current.loc.type, requiredId('LocType', closedName), `${closedName} is restored after the search`);
}
function movementExpected(name, loc) {
  if (loc.x > 3000) {
    if (name === 'fever_ship_ladder') {
      return loc.angle === 3
        ? { level: loc.level + 1, x: loc.x - 1, z: loc.z }
        : { level: loc.level + 1, x: loc.x, z: loc.z + 1 };
    }
    if (name === 'fever_ship_laddertop') {
      return loc.angle === 3
        ? { level: loc.level - 1, x: loc.x - 1, z: loc.z }
        : { level: loc.level - 1, x: loc.x, z: loc.z + 1 };
    }
    if (name === 'fever_climb_down_location') {
      return { level: loc.level - 1, x: loc.x - 1, z: loc.z };
    }
  }
  const own = loc.x < 1820;
  const suffix = own ? 'own' : 'enemy';
  if (name === 'fever_ship_ladder') return coordConstant(`fever_${suffix}_deck`);
  if (name === 'fever_ship_laddertop') return coordConstant(`fever_${suffix}_hold`);
  if (name === 'fever_climbing_net') return coordConstant(`fever_${suffix}_mast`);
  if (name === 'fever_climb_down_location') return coordConstant(`fever_${suffix}_deck`);
  return null;
}
const relativeLandingPoints = ['fever_ship_ladder', 'fever_ship_laddertop']
  .flatMap(name => locPlacements(name)
    .filter(({ loc }) => loc.x > 3000)
    .map(({ loc }) => ({ name, point: movementExpected(name, loc) })));
// The normal-world opener starts inside the inn; opening its exterior door is
// travel/setup, not a Cabin Fever teleport or the mechanic under test.
const openerNpc = npcByName('fever_teach');
const openerFixtureStart = { level: openerNpc.level, x: openerNpc.x - 1, z: openerNpc.z };
assert.equal(map.isMapBlocked(openerFixtureStart.x, openerFixtureStart.z, openerFixtureStart.level), false,
  'the normal-world inn fixture starts on a clear packed tile');
function exerciseMovementForms(p) {
  for (const name of ['fever_ship_ladder', 'fever_ship_laddertop', 'fever_climbing_net', 'fever_climb_down_location']) {
    const placements = checkedTraversalPlacements(name);
    assert(placements.length > 0, `${name} has a real packed placement`);
    for (const record of placements) {
      const destination = movementExpected(name, record.loc);
      nativeLoc(p, record, 1, [], name);
      assert.equal(map.isMapBlocked(p.x, p.z, p.level), false,
        `${name} actual movement landing ${p.level}_${p.x}_${p.z} is clear in packed collision`);
      if (destination) assertLanding(p, destination, name);
    }
  }
}
function questPoints(p) {
  const script = ScriptProvider.getByName('[proc,count_questpoints]');
  assert(script, 'the built general quest-point counter is present');
  const state = ScriptRunner.init(script, p, null, []);
  assert.equal(p.runScript(state, true, true), ScriptState.FINISHED, 'packed quest-point counter finishes');
  assert.equal(state.isp, 1, 'packed quest-point counter returns one integer');
  return state.popInt();
}
function fillInventory(p) {
  const fillers = [];
  for (let itemId = 0; itemId < types.ObjType.count && p.invFreeSpace(inv) > 0; itemId++) {
    const type = types.ObjType.get(itemId);
    if (!type || type.stackable || type.certtemplate !== -1) continue;
    const before = p.invFreeSpace(inv);
    p.invAdd(inv, itemId, 1);
    if (p.invFreeSpace(inv) < before) fillers.push(itemId);
  }
  assert.equal(p.invFreeSpace(inv), 0, 'fixture fills every inventory slot with real non-stackable packed items');
  assert.equal(inventory(p).filter(Boolean).length, invSize, 'inventory reader confirms all packed slots are occupied');
  return fillers;
}
function removeOneFiller(p, fillers, forbidden = new Set()) {
  const itemId = fillers.find(candidate => !forbidden.has(candidate) && p.invTotal(inv, candidate) > 0);
  assert.notEqual(itemId, undefined, 'one fixture filler remains available to free an inventory slot');
  assert.equal(p.invDel(inv, itemId, 1), 1, 'one filler item is removed');
  return itemId;
}
function textPackets(p) {
  return p.packets.filter(packet => packet instanceof IfSetText);
}

function testPrerequisites() {
  const inn = npcByName('fever_teach');
  const cases = [
    ['Agility 41 refuses', { agility: 41 }],
    ['Crafting 44 refuses', { crafting: 44 }],
    ['Smithing 49 refuses', { smithing: 49 }],
    ['Ranged 39 refuses', { ranged: 39 }],
    ['Pirate\'s Treasure incomplete refuses', { hunt: constant('hunt_complete') - 1 }],
    ['Rum Deal incomplete refuses', { deal: constant('deal_complete') - 1 }]
  ];
  for (const [label, override] of cases) {
    const p = player();
    requirements(p, override);
    nativeNpc(p, inn, 1, [1], label);
    assert.equal(stage(p), 0, `${label}: Cabin Fever remains unstarted`);
  }
  const earlyRefusal = player();
  requirements(earlyRefusal);
  nativeNpc(earlyRefusal, inn, 1, [2], 'early pirate refusal');
  assert.equal(stage(earlyRefusal), 0, 'early refusal does not accept the quest');
  const finalRefusal = player();
  requirements(finalRefusal);
  nativeNpc(finalRefusal, inn, 1, [1, 2], 'final commitment refusal');
  assert.equal(stage(finalRefusal), 0, 'declining the final commitment does not accept the quest');
  const exact = player();
  requirements(exact);
  nativeNpc(exact, inn, 1, [1, 1], 'exact prerequisite boundary acceptance');
  assert.equal(stage(exact), constant('fever_accepted'), 'all four exact skill levels and both completed quests permit acceptance');
  console.log(`PASS prerequisite matrix (${cases.length} independent refusals, both dialogue refusals, exact boundary acceptance)`);
}

function fullQuest() {
  const p = player();
  requirements(p);
  const inn = npcByName('fever_teach');
  const portTeach = npcByName('fever_port_ship_teach');
  const battleTeach = npcByName('fever_quest_ship_teach');
  const mosTeach = npcByName('fever_harmless_teach');
  const mosShipTeach = npcByName('fever_harmless_port_ship_teach');

  nativeNpc(p, inn, 1, [1, 1], 'Bill accepts the fully qualified pirate');
  assert.equal(stage(p), constant('fever_accepted'), 'acceptance writes the contract stage');

  const gangplank = oneLoc('fever_gangplank');
  const gangplankExit = oneLoc('fever_gangplank_exit');
  const locked = player();
  const lockedTile = locStand(gangplank.loc);
  nativeLoc(locked, gangplank, 1, [], 'unaccepted gangplank gate');
  assert.equal(stage(locked), 0, 'unaccepted player stays outside the ship');
  assert.notDeepEqual(tile(locked), coordConstant('fever_port_deck'), 'unaccepted player is not teleported onto the ship');
  assert.deepEqual(lockedTile, tile(locked), 'unaccepted gangplank leaves the player on the approach tile');

  nativeLoc(p, gangplank, 1, [], 'Port Phasmatys gangplank boarding');
  assertLanding(p, coordConstant('fever_port_deck'), 'Port Phasmatys gangplank');
  nativeLoc(p, gangplankExit, 1, [], 'Port Phasmatys gangplank exit');
  assertLanding(p, coordConstant('fever_port_pier'), 'Port Phasmatys gangplank exit');

  nativeNpc(p, portTeach, 1, [2], 'port ship delay departure');
  assert.equal(stage(p), constant('fever_accepted'), 'delaying departure does not advance or reset quest state');
  nativeNpc(p, portTeach, 1, [1], 'board the Adventurous');
  assert.equal(stage(p), constant('fever_sabotage'), 'boarding initializes battle state once');
  assertLanding(p, coordConstant('fever_battle_deck'), 'battle entry');

  // Exercise every placed ladder/net/hatch through its visible OPLOC handler.
  exerciseMovementForms(p);

  // Both lockers open, expose their Search options, supply exact items, and close.
  collectLocker(p, 'fever_repair_locker', 'fever_repair_locker_open', 1, 'fever_rope');
  collectLocker(p, 'fever_repair_locker', 'fever_repair_locker_open', 2, 'fever_repair_plank');
  collectLocker(p, 'fever_repair_locker', 'fever_repair_locker_open', 3, 'fever_tack', 10);
  collectLocker(p, 'fever_repair_locker', 'fever_repair_locker_open', 4, 'swamppaste');
  collectLocker(p, 'fever_repair_locker', 'fever_repair_locker_open', 5, 'hammer');
  collectLocker(p, 'fever_repair_locker', 'fever_repair_locker_open', 1, 'fever_rope');
  collectLocker(p, 'fever_weapons_locker', 'fever_weapons_locker_open', 1, 'fever_fuse');
  collectLocker(p, 'fever_weapons_locker', 'fever_weapons_locker_open', 2, 'fever_cannon_prod');
  collectLocker(p, 'fever_weapons_locker', 'fever_weapons_locker_open', 3, 'fever_cannon');
  collectLocker(p, 'fever_weapons_locker', 'fever_weapons_locker_open', 4, 'fever_cannister_load', 1, 1);
  collectLocker(p, 'fever_weapons_locker', 'fever_weapons_locker_open', 4, 'fever_cannon_ball', 1, 2);
  collectLocker(p, 'fever_weapons_locker', 'fever_weapons_locker_open', 5, 'fever_tinderbox');

  const sailNames = [
    'fever_sail1_hoistedl_climb', 'fever_sail1_hoistedl_climb_nomirror',
    'fever_sail1_hoistedl_climb_withrope_', 'fever_sail1_hoistedl_climb_nomirror_withrope_'
  ];
  const sails = sailNames.flatMap(name => checkedTraversalPlacements(name));
  const ownSail = sails.find(record => record.loc.x < 1820);
  const enemySail = sails.find(record => record.loc.x >= 1820);
  assert(ownSail && enemySail, 'real hoisted-sail forms are placed on both ships');
  nativeUseLoc(p, ownSail, 'fever_rope', 'use rope on own hoisted sail');
  assertLanding(p, coordConstant('fever_enemy_deck'), 'rope swing to enemy deck');
  assertVar(p, 'fever_swing', 1, 'first rope crossing records its product-written state');
  nativeUseLoc(p, enemySail, 'fever_rope', 'use rope on enemy hoisted sail');
  assertLanding(p, coordConstant('fever_own_deck'), 'rope swing back to own deck');
  assertVar(p, 'fever_swing_2', 1, 'return rope crossing records its product-written state');

  // Return-Home and gangplank exit strip ship supplies, but preserve progress.
  nativeNpc(p, battleTeach, 3, [1], 'battle Return-Home');
  assertLanding(p, coordConstant('fever_port_pier'), 'battle Return-Home landing');
  assert.equal(stage(p), constant('fever_sabotage'), 'Return-Home preserves the battle stage');
  assertNoShipSupplies(p, 'Return-Home');
  nativeNpc(p, portTeach, 1, [1], 'resume the battle after Return-Home');
  assert.equal(stage(p), constant('fever_sabotage'), 're-entry resumes instead of resetting the battle');
  assertVar(p, 'fever_swing', 1, 're-entry preserves the outbound swing flag');
  assertVar(p, 'fever_swing_2', 1, 're-entry preserves the return swing flag');
  assertLanding(p, coordConstant('fever_battle_deck'), 'battle re-entry landing');

  collectLocker(p, 'fever_repair_locker', 'fever_repair_locker_open', 1, 'fever_rope');
  assert(itemCount(p, 'fever_rope') > 0, 'ship locker supplies rope before gangplank exit');
  nativeLoc(p, gangplankExit, 1, [], 'leave battle through the gangplank');
  assertLanding(p, coordConstant('fever_port_pier'), 'battle gangplank exit');
  assert.equal(stage(p), constant('fever_sabotage'), 'gangplank exit preserves battle progress');
  assertNoShipSupplies(p, 'gangplank exit');
  assert.equal(itemCount(p, 'hammer'), 1, 'ordinary hammer is not stripped from the player');
  nativeNpc(p, portTeach, 1, [1], 're-enter at the current battle phase');
  assert.equal(stage(p), constant('fever_sabotage'), 'gangplank re-entry resumes the same phase');
  assertNoShipSupplies(p, 're-entry before collecting new supplies');

  // Re-supply for the powder-barrel sabotage.
  collectLocker(p, 'fever_repair_locker', 'fever_repair_locker_open', 1, 'fever_rope');
  collectLocker(p, 'fever_repair_locker', 'fever_repair_locker_open', 1, 'fever_rope');
  collectLocker(p, 'fever_weapons_locker', 'fever_weapons_locker_open', 1, 'fever_fuse');
  collectLocker(p, 'fever_weapons_locker', 'fever_weapons_locker_open', 5, 'fever_tinderbox');
  const powderBarrel = oneLoc('fever_multi_gunpowder_barrel', loc => loc.x >= 1820);
  const barrelBefore = readVar(p, 'fever_gunpowder_barrel');
  nativeUseLoc(p, powderBarrel, 'fever_tinderbox', 'unfused enemy barrel refuses lighting');
  assert.equal(readVar(p, 'fever_gunpowder_barrel'), barrelBefore, 'lighting before fuse does not alter the enemy barrel');
  assert.equal(stage(p), constant('fever_sabotage'), 'lighting before fuse does not advance the quest');
  nativeUseLoc(p, powderBarrel, 'fever_fuse', 'attach fuse to enemy powder barrel');
  assert.equal(itemCount(p, 'fever_fuse'), 0, 'enemy sabotage consumes one fuse');
  assert.equal(readVar(p, 'fever_gunpowder_barrel'), 2, 'enemy powder barrel enters fused state');
  currentForm(powderBarrel, p, 'toms_fever_cannon_fused', 'enemy powder barrel after fuse attachment');
  const enemyFuse = oneLoc('fever_multi_fuse_1');
  currentForm(enemyFuse, p, 'toms_fever_fuse', 'lit fuse visible form');
  nativeUseLoc(p, enemyFuse, 'fever_tinderbox', 'light the attached enemy fuse');
  assert.equal(stage(p), constant('fever_repairs'), 'lighting the powder barrel writes repair stage 20');
  assert.equal(readVar(p, 'fever_gunpowder_barrel'), 1, 'enemy powder barrel is visibly exploded');
  currentForm(powderBarrel, p, 'fever_gunpowder_barrel_exploded', 'enemy barrel after sabotage');
  assert.equal(readVar(p, 'fever_enemy_cannon'), 1, 'powder sabotage destroys the enemy cannon');
  assert.equal(readVar(p, 'fever_cannon'), 2, 'powder sabotage leaves our cannon without its barrel');
  assertMappedForm('fever_multi_enemy_cannon', p, 'fever_enemy_cannon_destroyed', 'enemy cannon after sabotage');

  // Leaving at stage 20 strips only ship supplies; the next boarding resumes.
  nativeLoc(p, gangplankExit, 1, [], 'leave after powder sabotage');
  assertLanding(p, coordConstant('fever_port_pier'), 'stage-20 gangplank exit');
  assert.equal(stage(p), constant('fever_repairs'), 'stage-20 exit does not strand or reset the quest');
  assertNoShipSupplies(p, 'stage-20 exit');
  assert.equal(itemCount(p, 'hammer'), 1, 'hammer remains player-owned during a stage-20 exit');
  nativeNpc(p, portTeach, 1, [1], 'resume hull repairs after return');
  assert.equal(stage(p), constant('fever_repairs'), 'stage-20 re-entry resumes hull repairs');

  const holes = [oneLoc('fever_multi_hole_1'), oneLoc('fever_multi_hole_2'), oneLoc('fever_multi_hole_3')];
  const holeNames = ['fever_hole_1', 'fever_hole_2', 'fever_hole_3'];
  const holeZNames = ['toms_fever_shiphull_leak', 'toms_fever_shiphull_twickle', 'toms_fever_shiphull_swamp_paste'];
  for (let index = 0; index < holes.length; index++) {
    assertVar(p, holeNames[index], 0, `hole ${index + 1} begins as a leak`);
    currentForm(holes[index], p, holeZNames[0], `hole ${index + 1} initial leak`);
  }
  const firstHole = holes[0];
  seed(p, ['fever_tack']);
  const invalidTackCount = itemCount(p, 'fever_tack');
  nativeUseLoc(p, firstHole, 'fever_tack', 'invalid item-on-leak repair attempt');
  assert.equal(itemCount(p, 'fever_tack'), invalidTackCount, 'invalid item-on-leak attempt does not consume tacks');
  assertVar(p, 'fever_hole_1', 0, 'invalid item-on-leak attempt does not patch the hole');
  p.invDel(inv, obj('fever_tack'), 1);
  nativeLoc(p, firstHole, 1, [], 'hole repair refuses without supplies');
  assertVar(p, 'fever_hole_1', 0, 'repair option does not progress without planks, tacks and hammer');

  // Retained from the locker as the player's own normal item, then deliberately
  // removed so the missing-paste branch is tested before a fresh supply.
  if (itemCount(p, 'swamppaste') > 0) p.invDel(inv, obj('swamppaste'), itemCount(p, 'swamppaste'));
  for (let n = 0; n < 6; n++) collectLocker(p, 'fever_repair_locker', 'fever_repair_locker_open', 2, 'fever_repair_plank');
  for (let n = 0; n < 3; n++) collectLocker(p, 'fever_repair_locker', 'fever_repair_locker_open', 3, 'fever_tack', 10);
  assert.equal(itemCount(p, 'fever_repair_plank'), 6, 'six planks cover three hull holes');
  assert.equal(itemCount(p, 'fever_tack'), 30, 'three locker searches supply the thirty required tacks');
  assert.equal(itemCount(p, 'hammer'), 1, 'hammer is required but not consumed');

  const beforeFirstPatch = { planks: itemCount(p, 'fever_repair_plank'), tacks: itemCount(p, 'fever_tack') };
  nativeUseLoc(p, firstHole, 'fever_repair_plank', 'patch first visible leak');
  assert.equal(itemCount(p, 'fever_repair_plank'), beforeFirstPatch.planks - 2, 'each patched hole consumes two planks');
  assert.equal(itemCount(p, 'fever_tack'), beforeFirstPatch.tacks - 10, 'each patched hole consumes ten tacks');
  assertVar(p, 'fever_hole_1', 1, 'first hole becomes patched');
  currentForm(firstHole, p, holeZNames[1], 'first hole visible patched form');
  nativeLoc(p, firstHole, 1, [], 'patched hole refuses to proof without swamp paste');
  assertVar(p, 'fever_hole_1', 1, 'proofing without paste does not advance the visible hole');
  collectLocker(p, 'fever_repair_locker', 'fever_repair_locker_open', 4, 'swamppaste');
  nativeUseLoc(p, firstHole, 'swamppaste', 'proof first visible repair');
  assertVar(p, 'fever_hole_1', 2, 'first hole becomes proofed');
  currentForm(firstHole, p, holeZNames[2], 'first hole visible waterproofed form');

  for (let n = 0; n < 2; n++) collectLocker(p, 'fever_repair_locker', 'fever_repair_locker_open', 4, 'swamppaste');
  for (let index = 1; index < holes.length; index++) {
    const beforePlanks = itemCount(p, 'fever_repair_plank');
    const beforeTacks = itemCount(p, 'fever_tack');
    nativeLoc(p, holes[index], 1, [], `patch visible hole ${index + 1}`);
    assert.equal(itemCount(p, 'fever_repair_plank'), beforePlanks - 2, `hole ${index + 1} consumes two planks`);
    assert.equal(itemCount(p, 'fever_tack'), beforeTacks - 10, `hole ${index + 1} consumes ten tacks`);
    assertVar(p, holeNames[index], 1, `hole ${index + 1} becomes patched`);
    currentForm(holes[index], p, holeZNames[1], `hole ${index + 1} visible patched form`);
    nativeUseLoc(p, holes[index], 'swamppaste', `proof visible hole ${index + 1}`);
    assertVar(p, holeNames[index], 2, `hole ${index + 1} becomes proofed`);
    currentForm(holes[index], p, holeZNames[2], `hole ${index + 1} visible waterproofed form`);
  }
  assert.equal(itemCount(p, 'swamppaste'), 0, 'exactly three paste units waterproof the three holes');
  assertVar(p, 'fever_holes_patched', 3, 'all three hull holes have received planks');
  assertVar(p, 'fever_holes_proofed', 3, 'all three hull holes are waterproofed');
  nativeNpc(p, battleTeach, 1, [], 'advance after all three repairs');
  assert.equal(stage(p), constant('fever_plunder_stage'), 'Bill advances repaired hull to plunder stage 30');

  const lootSources = [oneLoc('fever_multi_crate'), oneLoc('fever_multi_chest'), oneLoc('fever_multi_barrel')];
  const deposit = oneLoc('fever_plunder_deposit');
  function loot(amount) {
    for (let n = 0; n < amount; n++) {
      const before = itemCount(p, 'fever_plunder');
      nativeLoc(p, lootSources[n % lootSources.length], 1, [], `plunder stack ${n + 1}`);
      assert.equal(itemCount(p, 'fever_plunder'), before + 1, `each plunder operation grants one stack (${n + 1})`);
    }
  }
  loot(5);
  nativeLoc(p, deposit, 2, [], 'deposit first five plunder stacks');
  assert.equal(itemCount(p, 'fever_plunder'), 0, 'deposit removes carried plunder');
  assertVar(p, 'fever_plunder_points', 5, 'first deposit stores five stacks');
  loot(4);
  nativeLoc(p, deposit, 2, [], 'deposit next four plunder stacks');
  assertVar(p, 'fever_plunder_points', 9, 'second deposit stores four more stacks');
  nativeNpc(p, battleTeach, 1, [], 'Bill refuses fewer than ten deposited stacks');
  assert.equal(stage(p), constant('fever_plunder_stage'), 'nine deposited stacks cannot advance the quest');
  loot(1);
  nativeLoc(p, deposit, 2, [], 'deposit final required plunder stack');
  assertVar(p, 'fever_plunder_points', 10, 'ten total plunder stacks are deposited');
  const beforeEleventh = itemCount(p, 'fever_plunder');
  nativeLoc(p, lootSources[0], 1, [], 'plunder is capped at ten total stacks');
  assert.equal(itemCount(p, 'fever_plunder'), beforeEleventh, 'an eleventh stack is refused');
  nativeNpc(p, battleTeach, 1, [], 'advance after ten plunder stacks');
  assert.equal(stage(p), constant('fever_fix_cannon'), 'Bill advances after ten stored stacks');

  const ownCannon = oneLoc('fever_multi_cannon', loc => loc.x < 1820);
  currentForm(ownCannon, p, 'fever_cannon_no_barrel', 'our cannon is visibly missing its barrel');
  nativeLoc(p, ownCannon, 1, [], 'repair cannon refuses without a replacement barrel');
  assertVar(p, 'fever_cannon', 2, 'missing barrel remains until an item is supplied');
  collectLocker(p, 'fever_weapons_locker', 'fever_weapons_locker_open', 3, 'fever_cannon');
  nativeUseLoc(p, ownCannon, 'fever_cannon', 'fit the replacement cannon barrel');
  assert.equal(itemCount(p, 'fever_cannon'), 0, 'cannon barrel is consumed by repair');
  assertVar(p, 'fever_cannon', 0, 'our cannon becomes intact after barrel repair');
  currentForm(ownCannon, p, 'fever_cannon', 'our cannon after repair');
  nativeNpc(p, battleTeach, 1, [], 'advance after cannon repair');
  assert.equal(stage(p), constant('fever_canister'), 'Bill advances repaired cannon to canister stage 50');
  assertMappedForm('fever_multi_enemy_cannon', p, 'fever_enemy_cannon', 'enemy cannon is visibly repaired for the canister phase');

  const gunLocker = ['fever_weapons_locker', 'fever_weapons_locker_open'];
  const obtainWeaponSupply = (option, item, amount = 1, subchoice = null) =>
    collectLocker(p, gunLocker[0], gunLocker[1], option, item, amount, subchoice);
  obtainWeaponSupply(2, 'fever_cannon_prod');
  obtainWeaponSupply(4, 'fever_cannister_load', 1, 1);
  obtainWeaponSupply(4, 'fever_cannon_ball', 1, 2);
  obtainWeaponSupply(1, 'fever_fuse');
  obtainWeaponSupply(5, 'fever_tinderbox');
  const ownPowder = oneLoc('fever_your_gunpowder_barrel');
  const cannonState = name => readVar(p, name);
  const loadedState = ['fever_cannon_powder', 'fever_cannon_tamp', 'fever_cannon_ammo', 'fever_cannon_fuse'];
  const countsBeforeBadOrder = {
    ramrod: itemCount(p, 'fever_cannon_prod'), canister: itemCount(p, 'fever_cannister_load'),
    ball: itemCount(p, 'fever_cannon_ball'), fuse: itemCount(p, 'fever_fuse')
  };
  nativeUseLoc(p, ownCannon, 'fever_cannon_prod', 'ramrod before powder is rejected');
  assert.equal(cannonState('fever_cannon_tamp'), 0, 'ramrod before powder does not tamp');
  assert.equal(itemCount(p, 'fever_cannon_prod'), countsBeforeBadOrder.ramrod, 'early ramrod use is not consumed');
  nativeUseLoc(p, ownCannon, 'fever_cannister_load', 'canister before powder is rejected');
  assert.equal(itemCount(p, 'fever_cannister_load'), countsBeforeBadOrder.canister, 'early canister is not consumed');
  nativeUseLoc(p, ownCannon, 'fever_fuse', 'fuse before powder is rejected');
  assert.equal(itemCount(p, 'fever_fuse'), countsBeforeBadOrder.fuse, 'early fuse is not consumed');
  nativeLoc(p, ownPowder, 1, [], 'take own-ship gunpowder');
  assert.equal(itemCount(p, 'fever_gunpowder'), 1, 'own powder barrel supplies gunpowder');
  nativeUseLoc(p, ownCannon, 'fever_gunpowder', 'load powder first');
  assert.equal(cannonState('fever_cannon_powder'), 1, 'powder is loaded');
  assert.equal(itemCount(p, 'fever_gunpowder'), 0, 'loading consumes powder');
  nativeUseLoc(p, ownCannon, 'fever_cannister_load', 'ammunition before tamp is rejected');
  assert.equal(cannonState('fever_cannon_ammo'), 0, 'ammunition before tamp does not load');
  assert.equal(itemCount(p, 'fever_cannister_load'), countsBeforeBadOrder.canister, 'ammunition before tamp is not consumed');
  nativeUseLoc(p, ownCannon, 'fever_cannon_prod', 'tamp powder with ramrod');
  assert.equal(cannonState('fever_cannon_tamp'), 1, 'ramrod tamps the loaded powder');
  nativeUseLoc(p, ownCannon, 'fever_cannon_ball', 'cannonball before the canister stage is rejected');
  assert.equal(itemCount(p, 'fever_cannon_ball'), countsBeforeBadOrder.ball, 'early cannonball is retained');
  assert.equal(cannonState('fever_cannon_ammo'), 0, 'wrong-stage cannonball does not load');
  nativeUseLoc(p, ownCannon, 'fever_cannister_load', 'load canister after tamping');
  assert.equal(cannonState('fever_cannon_ammo'), 1, 'canister is loaded');
  assert.equal(itemCount(p, 'fever_cannister_load'), 0, 'canister is consumed');
  nativeUseLoc(p, ownCannon, 'fever_fuse', 'attach fuse after ammunition');
  assert.equal(cannonState('fever_cannon_fuse'), 1, 'fuse is attached last');
  assert.equal(cannonState('fever_cannon'), 3, 'loaded cannon displays the fire-ready form');
  currentForm(ownCannon, p, 'fever_cannon_loaded', 'ready cannon visible form');
  const hitsBeforeCanister = cannonState('fever_holes_in_the_hull');
  nativeLoc(p, ownCannon, 1, [], 'fire the correctly loaded canister');
  assert.equal(stage(p), constant('fever_canister_fired'), 'canister shot silences the enemy cannon and writes stage 55');
  assert.equal(cannonState('fever_enemy_cannon'), 1, 'canister shot destroys the enemy cannon');
  assert.equal(cannonState('fever_holes_in_the_hull'), hitsBeforeCanister, 'canister does not count as a hull hit');
  assert.equal(cannonState('fever_cannon_clean'), 1, 'a fired cannon becomes dirty');
  assert(loadedState.every(name => cannonState(name) === 0), 'a fired cannon clears its powder/tamp/ammo/fuse load');
  nativeNpc(p, battleTeach, 1, [], 'Bill requires a clean cannon after canister');
  assert.equal(stage(p), constant('fever_canister_fired'), 'dirty cannon blocks stage 60');
  nativeUseLoc(p, ownCannon, 'fever_cannon_prod', 'clean cannon with ramrod after canister');
  assert.equal(cannonState('fever_cannon_clean'), 0, 'ramrod cleans the cannon');
  nativeNpc(p, battleTeach, 1, [], 'advance after cleaning the canister shot');
  assert.equal(stage(p), constant('fever_sink_ship'), 'Bill advances a clean canister phase to stage 60');

  // Load/fire helper uses only packed locker, barrel, client OpLocU and OpLoc.
  const loadAndFireBall = (label, expectedHit) => {
    nativeLoc(p, ownPowder, 1, [], `${label}: take own-ship powder`);
    nativeUseLoc(p, ownCannon, 'fever_gunpowder', `${label}: load powder`);
    nativeUseLoc(p, ownCannon, 'fever_cannon_prod', `${label}: tamp powder`);
    nativeUseLoc(p, ownCannon, 'fever_cannon_ball', `${label}: load cannonball`);
    nativeUseLoc(p, ownCannon, 'fever_fuse', `${label}: attach fuse`);
    currentForm(ownCannon, p, 'fever_cannon_loaded', `${label}: loaded visible form`);
    nativeLoc(p, ownCannon, 1, [], `${label}: fire cannonball`);
    assert.equal(cannonState('fever_holes_in_the_hull'), expectedHit, `${label}: hit count`);
    assertEnemyHull(p, expectedHit);
  };
  for (let n = 0; n < 3; n++) obtainWeaponSupply(4, 'fever_cannon_ball', 1, 2);
  for (let n = 0; n < 4; n++) obtainWeaponSupply(1, 'fever_fuse');
  loadAndFireBall('first clean cannonball', 1);
  assert.equal(stage(p), constant('fever_sink_ship'), 'first cannonball leaves the battle in progress');
  assert.equal(cannonState('fever_cannon_clean'), 1, 'first cannonball dirties the cannon');

  const hpBeforeDirtyShot = p.levels[PlayerStat.HITPOINTS];
  nativeLoc(p, ownPowder, 1, [], 'dirty-failure shot: take powder');
  nativeUseLoc(p, ownCannon, 'fever_gunpowder', 'dirty-failure shot: load powder');
  nativeUseLoc(p, ownCannon, 'fever_cannon_prod', 'dirty-failure shot: ramrod tamps instead of cleaning');
  nativeUseLoc(p, ownCannon, 'fever_cannon_ball', 'dirty-failure shot: load next ball without cleaning');
  nativeUseLoc(p, ownCannon, 'fever_fuse', 'dirty-failure shot: attach fuse');
  nativeLoc(p, ownCannon, 1, [], 'fire dirty cannon');
  assert.equal(p.levels[PlayerStat.HITPOINTS], hpBeforeDirtyShot - 5, 'dirty cannon misfire deals exactly five hitpoints');
  assert.equal(cannonState('fever_holes_in_the_hull'), 1, 'dirty misfire does not add an enemy hull hit');
  assertEnemyHull(p, 1);
  assert.equal(stage(p), constant('fever_sink_ship'), 'dirty misfire does not advance the quest');
  assert.equal(cannonState('fever_cannon_clean'), 1, 'misfire leaves the cannon dirty');
  assert(loadedState.every(name => cannonState(name) === 0), 'dirty misfire clears its load');
  nativeUseLoc(p, ownCannon, 'fever_cannon_prod', 'clean cannon after dirty misfire');
  assert.equal(cannonState('fever_cannon_clean'), 0, 'ramrod cleans the dirty cannon after failure');

  loadAndFireBall('second clean cannonball', 2);
  assert.equal(stage(p), constant('fever_sink_ship'), 'second cannonball leaves one hull hole remaining');
  nativeUseLoc(p, ownCannon, 'fever_cannon_prod', 'clean after second successful cannonball');
  loadAndFireBall('third clean cannonball', 3);
  assert.equal(stage(p), constant('fever_arrived'), 'third successful cannonball writes arrival stage 100');
  assertLanding(p, coordConstant('fever_mos_deck'), 'enemy ship sinking arrival');
  assertNoShipSupplies(p, 'Mos Le\'Harmless arrival');
  assert.equal(itemCount(p, 'hammer'), 1, 'arrival preserves ordinary player tools');

  // Inventory-full completion refuses before stage, QP, XP, book, or scroll writes.
  const xpBeforeFullAttempt = [PlayerStat.SMITHING, PlayerStat.CRAFTING, PlayerStat.AGILITY].map(stat => currentSkillXp(p, stat));
  const qpBeforeFullAttempt = questPoints(p);
  const fillers = fillInventory(p);
  assert.equal(itemCount(p, 'fever_piracy_book'), 0, 'no completion book exists before the reward talk');
  nativeNpc(p, mosShipTeach, 1, [], 'completion with no inventory space');
  assert.equal(stage(p), constant('fever_arrived'), 'full inventory refuses completion before writing terminal stage');
  assert.deepEqual([PlayerStat.SMITHING, PlayerStat.CRAFTING, PlayerStat.AGILITY].map(stat => currentSkillXp(p, stat)),
    xpBeforeFullAttempt, 'full inventory refusal grants no skill XP');
  assert.equal(questPoints(p), qpBeforeFullAttempt, 'full inventory refusal grants no quest points');
  assert.equal(itemCount(p, 'fever_piracy_book'), 0, 'full inventory refusal loses no book');
  assert.equal(p.modalMain, -1, 'full inventory refusal opens no completion scroll');

  removeOneFiller(p, fillers, new Set([obj('fever_piracy_book'), obj('coins')]));
  const xpBeforeReward = [PlayerStat.SMITHING, PlayerStat.CRAFTING, PlayerStat.AGILITY].map(stat => currentSkillXp(p, stat));
  const qpBeforeReward = questPoints(p);
  nativeNpc(p, mosShipTeach, 1, [], 'complete Cabin Fever with one free slot');
  assert.equal(stage(p), completeStage, 'completion stage is written');
  assert.equal(readVar(p, 'fever_given_book'), 1, 'book reward is recorded once');
  assert.equal(itemCount(p, 'fever_piracy_book'), 1, 'completion grants one Book o\' Piracy');
  assert.deepEqual([PlayerStat.SMITHING, PlayerStat.CRAFTING, PlayerStat.AGILITY].map(stat => currentSkillXp(p, stat)),
    xpBeforeReward.map(value => value + 70000), 'completion grants exactly 7,000 XP to each skill in engine tenths');
  assert.equal(questPoints(p), qpBeforeReward + questPointsReward, 'completion grants exactly the registered Cabin Fever quest points');
  const completionTexts = textPackets(p);
  for (const [componentName, expectedText] of [
    ['questscroll_death:com_3', 'You have completed Cabin Fever!'],
    ['questscroll_death:com_10', '7,000 Smithing XP'],
    ['questscroll_death:com_11', '7,000 Crafting XP'],
    ['questscroll_death:com_12', '7,000 Agility XP'],
    ['questscroll_death:com_13', 'The Little Book o\' Piracy'],
    ['questscroll_death:com_14', "Access to Mos Le'Harmless"]
  ]) {
    const component = requiredId('Component', componentName);
    assert(completionTexts.some(packet => packet.component === component && packet.text === expectedText),
      `completion scroll shows ${expectedText}`);
  }
  assert.equal(p.modalMain, requiredId('Component', 'questscroll_death'), 'completion opens the compiled quest reward scroll');
  assert.equal(p.refreshModal, true, 'completion queues the main modal for the real network output tick');
  assert.equal(itemCount(p, 'coins'), 0, 'the 10,000-coin claim is not folded into completion rewards');

  // The separate 10,000-coin claim also fails closed when no slot is free.
  const xpAfterReward = [PlayerStat.SMITHING, PlayerStat.CRAFTING, PlayerStat.AGILITY].map(stat => currentSkillXp(p, stat));
  const qpAfterReward = questPoints(p);
  const postFillers = fillers;
  assert.equal(p.invFreeSpace(inv), 0, 'the completion book fills the space freed above');
  nativeNpc(p, mosShipTeach, 1, [], 'postquest coins with a full inventory');
  assert.equal(readVar(p, 'fever_gold'), 0, 'full inventory does not mark the separate coin claim paid');
  assert.equal(itemCount(p, 'coins'), 0, 'full inventory loses no coins');
  removeOneFiller(p, postFillers, new Set([obj('fever_piracy_book'), obj('coins')]));
  nativeNpc(p, mosShipTeach, 1, [], 'claim postquest coins with one free slot');
  assert.equal(readVar(p, 'fever_gold'), 1, 'separate postquest coin claim is recorded');
  assert.equal(itemCount(p, 'coins'), 10000, 'the separate claim grants 10,000 coins exactly once');
  nativeNpc(p, mosShipTeach, 1, [3], 'repeat postquest talk without another coin claim');
  assert.equal(itemCount(p, 'coins'), 10000, 'repeat talk does not duplicate the coin reward');
  assert.deepEqual([PlayerStat.SMITHING, PlayerStat.CRAFTING, PlayerStat.AGILITY].map(stat => currentSkillXp(p, stat)),
    xpAfterReward, 'postquest talks do not duplicate skill XP');
  assert.equal(questPoints(p), qpAfterReward, 'postquest talks do not duplicate quest points');
  assert.equal(itemCount(p, 'fever_piracy_book'), 1, 'postquest talks do not duplicate the completion book');

  // Recovery does not duplicate a book already in inventory or bank, and can
  // replace it after it is absent from both places.
  const bookId = obj('fever_piracy_book');
  assert.equal(p.invDel(inv, bookId, 1), 1, 'fixture places the original book in the bank');
  p.invAdd(bank, bookId, 1);
  assert.equal(itemCount(p, 'fever_piracy_book', bank), 1, 'bank accepts the owned book');
  nativeNpc(p, mosShipTeach, 1, [2], 'book recovery while the bank still has the book');
  assert.equal(itemCount(p, 'fever_piracy_book'), 0, 'bank-held book is not duplicated into inventory');
  assert.equal(itemCount(p, 'fever_piracy_book', bank), 1, 'bank-held book remains safely stored');
  assert.equal(p.invDel(bank, bookId, 1), 1, 'fixture removes the bank-held book');
  nativeNpc(p, mosShipTeach, 1, [2], 'recover a genuinely lost Book o\' Piracy');
  assert.equal(itemCount(p, 'fever_piracy_book'), 1, 'Bill replaces the book when inventory and bank both lack it');
  nativeNpc(p, mosTeach, 1, [2], 'alternate Mos NPC refuses a duplicate book');
  assert.equal(itemCount(p, 'fever_piracy_book'), 1, 'the second visible Bill form does not duplicate the book');

  const mosGangplank = oneLoc('fever_gangplank_harmless');
  const mosGangplankExit = oneLoc('fever_gangplank_exit_harmless');
  nativeLoc(p, mosGangplankExit, 1, [], 'Mos Le\'Harmless ship gangplank exit');
  assertLanding(p, coordConstant('fever_mos_pier'), 'Mos gangplank exit');
  nativeLoc(p, mosGangplank, 1, [], 'Mos Le\'Harmless ship gangplank boarding');
  assertLanding(p, coordConstant('fever_mos_deck'), 'Mos gangplank boarding');

  // Repeatable post-quest Port <-> Mos travel uses actual NPC Talk dispatch.
  nativeNpc(p, mosShipTeach, 1, [1], 'sail Mos to Port Phasmatys');
  assertLanding(p, coordConstant('fever_port_deck'), 'Mos-to-Port postquest travel');
  nativeNpc(p, portTeach, 1, [1], 'sail Port Phasmatys to Mos Le\'Harmless');
  assertLanding(p, coordConstant('fever_mos_deck'), 'Port-to-Mos postquest travel');
  nativeNpc(p, mosTeach, 1, [1], 'shore Bill sails Mos to Port');
  assertLanding(p, coordConstant('fever_port_deck'), 'shore Bill Mos-to-Port travel');
  nativeNpc(p, portTeach, 1, [1], 'repeat Port-to-Mos travel');
  assertLanding(p, coordConstant('fever_mos_deck'), 'repeat Port-to-Mos travel landing');
  assert.equal(stage(p), completeStage, 'repeatable travel never changes the completed quest stage');
  assert.equal(readVar(p, 'fever_gold'), 1, 'repeatable travel does not reset the once-only coin flag');
  assert.equal(itemCount(p, 'fever_piracy_book'), 1, 'travel preserves the recovered book');
  console.log('PASS complete Cabin Fever sequence, item/action gates, dirty-cannon failure, reward safety, recovery and repeat travel');
}

function testQuestTab() {
  const p = player();
  const component = requiredId('Component', 'questlist:fever');
  const run = (name, args = []) => {
    const script = ScriptProvider.getByName(name);
    assert(script, `${name} is compiled`);
    const state = ScriptRunner.init(script, p, null, args);
    assert.equal(p.runScript(state, true, true), ScriptState.FINISHED, `${name} finishes`);
    return state;
  };
  const before = questPoints(p);
  for (const progress of [0, 1, completeStage - 1, completeStage, completeStage + 1]) {
    writeVar(p, 'fever_quest', progress);
    let mark = p.packets.length;
    run('[proc,send_quest_progress_colour]', [component, progress, completeStage]);
    const expected = p.packets.slice(mark).find(packet => packet.constructor.name === 'IfSetColour');
    assert(expected, 'compiled colour helper emits its expected packet');
    mark = p.packets.length;
    run('[proc,update_questlist]');
    const actual = p.packets.slice(mark).find(packet =>
      packet.constructor.name === 'IfSetColour' && packet.component === component);
    assert.deepEqual(actual, expected, 'quest-list refresh includes the Cabin Fever colour row');
    assert.equal(questPoints(p), before + (progress >= completeStage ? questPointsReward : 0),
      'Cabin Fever quest points use the registered >= completion predicate');
  }
  console.log('PASS compiled quest-list colour and completion counter predicates');
}

assertMapIntegration();
testQuestTab();
testPrerequisites();
fullQuest();
console.log('PASS Cabin Fever compiled ScriptRunner proof');
process.exit(0);
