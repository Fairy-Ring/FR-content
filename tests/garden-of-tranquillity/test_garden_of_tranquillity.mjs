/** Built-pack Garden of Tranquillity progression and native-dispatch checks.
 * Run from the sibling engine: node --import tsx ../content/tests/garden-of-tranquillity/test_garden_of_tranquillity.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  World, Runner, Scripts, State, ScriptOpcode, PlayerStat, PlayerTimerType, JavaRandom,
  types, id, inv, player, proc, add, count, slot, load
} from '../farming/runtime.mjs';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const map = await load('engine/GameMap.ts');
const ServerTriggerType = (await load('engine/script/ServerTriggerType.ts')).default;
const rsbuf = await import(pathToFileURL(path.join(
  process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine'),
  'src/network/rsbuf/index.ts'
)).href);
const OpNpc = (await load('network/game/client/model/OpNpc.ts')).default;
const OpNpcHandler = (await load('network/game/client/handler/OpNpcHandler.ts')).default;
const OpLoc = (await load('network/game/client/model/OpLoc.ts')).default;
const OpLocHandler = (await load('network/game/client/handler/OpLocHandler.ts')).default;
const OpLocU = (await load('network/game/client/model/OpLocU.ts')).default;
const OpLocUHandler = (await load('network/game/client/handler/OpLocUHandler.ts')).default;
const OpHeld = (await load('network/game/client/model/OpHeld.ts')).default;
const OpHeldHandler = (await load('network/game/client/handler/OpHeldHandler.ts')).default;
const OpHeldU = (await load('network/game/client/model/OpHeldU.ts')).default;
const OpHeldUHandler = (await load('network/game/client/handler/OpHeldUHandler.ts')).default;
const { NpcStat } = await load('engine/entity/NpcStat.ts');
const component = name => id('Component', name);
const worn = id('InvType', 'worn');
const inventoryComponent = id('Component', 'inventory:inv');
const stageVarbit = id('VarBitType', 'garden_quest');
const stage = p => p.getVarBit(stageVarbit);

function integerConstant(name, relative = 'scripts/general/configs/quest.constant') {
  const source = fs.readFileSync(path.join(content, relative), 'utf8');
  const match = new RegExp(`^\\^${name}\\s*=\\s*(-?\\d+)\\s*$`, 'm').exec(source);
  assert(match, `existing quest constant ${name} is defined`);
  return Number(match[1]);
}

const completeStage = integerConstant('garden_complete');
const fenkComplete = integerConstant('fenk_complete',
  'scripts/quests/quest_creatureoffenkenstrain/configs/fenk_quest.constant');
const fenkQuestVarp = id('VarPlayerType', 'fenk_quest');
const questPointsReward = integerConstant('garden_questpoints');
assert.equal(completeStage, 60, 'the existing Garden completion constant is stage 60');
assert.equal(questPointsReward, 2, 'the existing Garden quest-point reward is two');
assert.equal(types.VarBitType.get(stageVarbit).basevar, id('VarPlayerType', 'garden_varp_1'),
  'Garden quest progress stays in its original 377 varp');
assert.equal(id('VarPlayerType', 'garden_varp_1'), 553, 'Garden word one keeps original 377 slot 553');
assert.equal(id('VarPlayerType', 'garden_varp_2'), 554, 'Garden word two keeps original 377 slot 554');

for (const [name, expectedId] of [['garden_trolley_uid', 251], ['garden_trolley_deadline', 252]]) {
  const varpId = id('VarPlayerType', name);
  const type = types.VarPlayerType.get(varpId);
  assert.equal(varpId, expectedId, `${name} uses its reserved original 377 slot`);
  assert.equal(type.scope, types.VarPlayerType.SCOPE_TEMP, `${name} resets on save/load`);
  assert.equal(type.transmit, false, `${name} stays server-only`);
}

const patchSpecs = [
  ['garden_delphinium_patch', 'garden_delphiniums_varbit'],
  ['garden_orchid_pink_patch', 'garden_orchids_pink_varbit'],
  ['garden_orchid_yellow_patch', 'garden_orchids_yellow_varbit'],
  ['garden_snowdrop_patch', 'garden_snowdrops_varbit'],
  ['garden_white_tree_patch', 'garden_white_tree_varbit'],
  ['garden_vine_patch', 'garden_vines_varbit'],
  ['garden_rosebush_patch_white', 'garden_rosebush_white_varbit'],
  ['garden_rosebush_patch_red', 'garden_rosebush_red_varbit'],
  ['garden_rosebush_patch_pink', 'garden_rosebush_pink_varbit']
];

const patchRowCounts = new Map([
  ['garden_delphinium_patch', 12],
  ['garden_orchid_pink_patch', 1],
  ['garden_orchid_yellow_patch', 1],
  ['garden_snowdrop_patch', 12],
  ['garden_white_tree_patch', 1],
  ['garden_vine_patch', 9],
  ['garden_rosebush_patch_white', 4],
  ['garden_rosebush_patch_red', 4],
  ['garden_rosebush_patch_pink', 4]
]);
const gardenLocNames = new Set([
  ...patchSpecs.map(([name]) => name),
  ...Array.from({ length: 8 }, (_, index) => `farming_veg_patch_${index + 1}`),
  'farming_flower_patch_1', 'garden_white_tree_dead', 'garden_burthorpe_vines_diseased',
  'garden_roses_red', 'garden_roses_pink', 'garden_roses_white', 'well',
  'garden_saradomin_statue', 'statue_lumbridge', 'garden_queen_statue',
  'garden_saradomin_statue_plinth', 'garden_king_statue_plinth'
]);
const mapLocRows = new Map([...gardenLocNames].map(name => [name, []]));
const floorTiles = new Set();
const mapNpcRows = new Map();
const nativeNpcRows = name => mapNpcRows.get(name) ?? [];
const locMapNames = new Map();
const mapFiles = fs.readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name)).sort();
for (const filename of mapFiles) {
  const [, mapX, mapZ] = /^m(\d+)_(\d+)\.jm2$/.exec(filename).map(Number);
  const groundFlags = new Map();
  let section = '';
  for (const line of fs.readFileSync(path.join(content, 'maps', filename), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) {
      section = line.split(/\s+/)[1];
      continue;
    }
    const match = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
    if (!match) continue;
    const level = Number(match[1]);
    const localX = Number(match[2]);
    const localZ = Number(match[3]);
    if (section === 'MAP') {
      const flags = /(?:^| )f(\d+)(?: |$)/.exec(match[4]);
      groundFlags.set(`${level},${localX},${localZ}`, flags ? Number(flags[1]) : 0);
      if (/(?:^| )(?:u\d+|o-?\d+)(?:[; ]|$)/.test(match[4])) {
        floorTiles.add(`${level},${mapX * 64 + localX},${mapZ * 64 + localZ}`);
      }
      continue;
    }
    if (section === 'NPC') {
      const typeId = Number(match[4].trim().split(/\s+/)[0]);
      const type = types.NpcType.get(typeId);
      if (!type) continue;
      const row = {
        name: type.debugname, id: typeId, level,
        x: mapX * 64 + localX, z: mapZ * 64 + localZ
      };
      if (!mapNpcRows.has(type.debugname)) mapNpcRows.set(type.debugname, []);
      mapNpcRows.get(type.debugname).push(row);
      continue;
    }
    if (section !== 'LOC') continue;
    const fields = match[4].trim().split(/\s+/);
    const typeId = Number(fields[0]);
    const type = types.LocType.get(typeId);
    if (!type) continue;
    let names = locMapNames.get(typeId);
    if (!names) {
      names = mapLocRows.has(type.debugname) ? [type.debugname] : [];
      for (const childId of type.multiloc ?? []) {
        if (childId < 0) continue;
        const childName = types.LocType.get(childId)?.debugname;
        if (mapLocRows.has(childName) && !names.includes(childName)) names.push(childName);
      }
      locMapNames.set(typeId, names);
    }
    if (names.length === 0) continue;
    const linkedBelow = ((groundFlags.get(`1,${localX},${localZ}`) ?? 0) & 2) !== 0;
    const actualLevel = linkedBelow ? level - 1 : level;
    if (actualLevel < 0) continue;
    const row = {
      name: type.debugname,
      id: typeId,
      level: actualLevel,
      x: mapX * 64 + localX,
      z: mapZ * 64 + localZ,
      shape: Number(fields[1] ?? 10),
      angle: Number(fields[2] ?? 0),
      coord: `${actualLevel}_${mapX}_${mapZ}_${localX}_${localZ}`
    };
    const loc = World.getLoc(row.x, row.z, row.level, row.id);
    assert(loc, `native packed placement exists for ${row.name} at ${row.coord}`);
    assert.equal(loc.shape, row.shape, `${row.name} retains its packed map shape`);
    assert.equal(loc.angle, row.angle, `${row.name} retains its packed map angle`);
    for (const name of names) mapLocRows.get(name).push({ row, loc });
  }
}

function findApproachTile(loc) {
  const type = types.LocType.get(loc.type);
  for (let x = loc.x - 4; x <= loc.x + 4; x++) {
    for (let z = loc.z - 4; z <= loc.z + 4; z++) {
      if (!floorTiles.has(`${loc.level},${x},${z}`) || map.isMapBlocked(x, z, loc.level)) continue;
      if (map.reachedLoc(loc.level, x, z, loc.x, loc.z, type.width, type.length,
        1, loc.angle, loc.shape, type.forceapproach)) return [loc.level, x, z];
    }
  }
  return null;
}

function approachTile(loc) {
  const tile = findApproachTile(loc);
  assert(tile, `${types.LocType.get(loc.type).debugname} has a collision-valid packed-floor approach`);
  return tile;
}

const gardenLocs = new Map();
for (const [name, varbitName] of patchSpecs) {
  const rows = mapLocRows.get(name);
  assert.equal(rows.length, patchRowCounts.get(name), `${name} retains every original bed tile`);
  assert.equal(new Set(rows.map(({ row }) => row.coord)).size, rows.length,
    `${name} placements are distinct native map coordinates`);
  const type = types.LocType.get(id('LocType', name));
  assert.equal(type.multivarbit, id('VarBitType', varbitName), `${name} morphs from its original Garden selector`);
  const visibleForms = [...type.multiloc].filter(child => child >= 0);
  assert(visibleForms.length > 1 && visibleForms.every(child => types.LocType.get(child)),
    `${name} has valid visible growth forms`);
  let selected = null;
  for (const { loc } of rows) {
    assert.equal(loc.type, type.id, `${name} placements share their original parent type`);
    assert.equal(type.multivarbit, id('VarBitType', varbitName), `${name} placements share the Garden selector`);
    const approach = findApproachTile(loc);
    if (!selected && approach) selected = { loc, approach };
  }
  assert(selected, `${name} has at least one collision-valid native approach`);
  gardenLocs.set(name, { ...selected, varbit: id('VarBitType', varbitName) });
}

for (const [patchName, formNames] of [
  ['garden_orchid_pink_patch', ['garden_orchids_seed', 'garden_orchids_1', 'garden_orchids_2', 'garden_orchids_fullygrown']],
  ['garden_orchid_yellow_patch', ['garden_orchids_seed_yellow', 'garden_orchids_1_yellow', 'garden_orchids_2_yellow', 'garden_orchids_fullygrown_yellow']]
]) {
  const forms = types.LocType.get(id('LocType', patchName)).multiloc;
  assert(types.LocType.get(forms[0]) && types.LocType.get(forms[1]), `${patchName} retains empty and compost forms`);
  assert.equal(forms[2], -1, `${patchName} retains the original unlisted state 2`);
  assert.equal(forms[3], -1, `${patchName} retains the original unlisted state 3`);
  for (let offset = 0; offset < formNames.length; offset++) {
    assert.equal(forms[offset + 4], id('LocType', formNames[offset]),
      `${patchName} retains its original seed/growth form ${offset + 4}`);
  }
}
for (const [name, minX, maxX] of [
  ['garden_rosebush_patch_pink', 3226, 3227],
  ['garden_rosebush_patch_red', 3229, 3230],
  ['garden_rosebush_patch_white', 3232, 3233]
]) {
  for (const { row } of mapLocRows.get(name)) {
    assert(row.x >= minX && row.x <= maxX && row.z >= 3471 && row.z <= 3472,
      `${name} stays inside its original rose-color coordinates`);
  }
}
for (const [name, x] of [['garden_orchid_pink_patch', 3229], ['garden_orchid_yellow_patch', 3231]]) {
  const [{ row }] = mapLocRows.get(name);
  assert.equal(row.x, x, `${name} stays on its original orchid coordinate`);
  assert.equal(row.z, 3486, `${name} stays on the original orchid row`);
}
for (const name of ['garden_saradomin_statue', 'statue_lumbridge', 'garden_saradomin_statue_plinth', 'garden_king_statue_plinth']) {
  const rows = mapLocRows.get(name);
  assert(rows.length > 0, `the original map places ${name}`);
  for (const { loc } of rows) approachTile(loc);
}

function packedLoc(name, predicate = () => true) {
  for (const { loc } of mapLocRows.get(name) ?? []) {
    if (predicate(loc) && findApproachTile(loc)) return loc;
  }
  assert.fail(`${name} has an original collision-valid packed placement`);
}

const flowerPatch = packedLoc('farming_flower_patch_1');
const allotmentSelectorNames = [
  'farming_allotment_varp_2_16_23', 'farming_allotment_varp_2_24_31',
  'farming_allotment_varp_2_8_15', 'farming_allotment_varp_2_0_7'
];
const allotmentPatches = new Map(allotmentSelectorNames.map(name => {
  const selector = id('VarBitType', name);
  const loc = Array.from({ length: 8 }, (_, index) => `farming_veg_patch_${index + 1}`)
    .flatMap(patch => mapLocRows.get(patch) ?? [])
    .map(({ loc }) => loc)
    .find(loc => types.LocType.get(loc.type).multivarbit === selector && findApproachTile(loc));
  assert(loc, `${name} resolves to an original accessible allotment patch`);
  return [name, loc];
}));
// Independent fixture landings beside the original palace garden, not values
// read back from the product's route constants.
const saraDropoff = { level: 0, x: 3228, z: 3489 };
const kingDropoff = { level: 0, x: 3232, z: 3489 };
const saraPlinth = packedLoc('garden_saradomin_statue_plinth');
const kingPlinth = packedLoc('garden_king_statue_plinth');
for (const [name, landing, plinth] of [
  ['Saradomin', saraDropoff, saraPlinth], ['king', kingDropoff, kingPlinth]
]) {
  const [, exitX, exitZ] = findApproachTile(plinth);
  assert(Math.max(Math.abs(landing.x - plinth.x), Math.abs(landing.z - plinth.z)) <= 12,
    `${name} arrival is beside its original palace garden plinth`);
  for (const tile of [landing, { ...landing, z: landing.z + 1 }]) {
    assert(floorTiles.has(`${tile.level},${tile.x},${tile.z}`), `${name} landing has packed floor`);
    assert.equal(map.isMapBlocked(tile.x, tile.z, tile.level), false, `${name} landing is walkable`);
    assert(map.findPath(tile.level, tile.x, tile.z, exitX, exitZ).length > 0,
      `${name} player and trolley landings have a native path out to the garden`);
  }
}
const trolleyRoot = types.NpcType.get(id('NpcType', 'garden_trolley'));
assert.equal(trolleyRoot.multivarbit, id('VarBitType', 'garden_trolley_varbit'),
  'the original Garden trolley selector exposes its visible NPC forms');
assert.deepEqual(trolleyRoot.multinpc.map(typeId => types.NpcType.get(typeId).debugname), [
  'garden_trolley_empty', 'garden_trolley_saradomin', 'garden_trolley_king'
], 'the visible trolley form follows empty, Saradomin, and king selector states');
for (const name of ['garden_trolley_saradomin', 'garden_trolley_king']) {
  const options = types.NpcType.get(id('NpcType', name)).op;
  assert.equal(options[0], 'Push', `${name} exposes Push`);
  assert.equal(options[2], 'Pull', `${name} exposes Pull`);
  assert.equal(options[3], 'Big-push', `${name} exposes Big-push`);
  assert.equal(options[4], 'Place', `${name} exposes Place`);
}

const questItems = [
  'garden_rosebush_seed_white', 'garden_rosebush_seed_red', 'garden_rosebush_seed_pink',
  'garden_vine_seed', 'garden_delphinium_seed', 'garden_orchid_pink_seed',
  'garden_orchid_yellow_seed', 'garden_snowdrop_seed', 'garden_white_tree_shoot',
  'garden_white_tree_plantpot_shoot', 'garden_white_tree_plantpot_shoot_watered',
  'garden_white_tree_plantpot_sapling', 'ring_of_charos_unlocked', 'rune_shards',
  'rune_dust', 'plant_cure_strong', 'garden_white_tree_fruit', 'garden_trolley_obj', 'garden_list'
];
for (const name of questItems) {
  assert.equal(types.ObjType.get(id('ObjType', name)).tradeable, false, `${name} is not tradeable`);
}

// Remaining end-to-end scenarios use these helpers to send real client options.
let serial = 0;
function nativePlayer(saved = null) {
  const p = player(saved);
  const n = ++serial;
  p.slot = p.pid;
  // PlayerLoading restores the real username hash; native inventory packets
  // resolve listeners by that hash plus the current world slot.
  p.uid = (Number(p.username37 & 0x1fffffn) << 11) | p.pid;
  p.invStopListenOnCom(inventoryComponent);
  p.invListenOnCom(inv, inventoryComponent, p.uid);
  p.hash64 = BigInt(1000 + n);
  p.isActive = true;
  if (!saved) p.vars.fill(0);
  p.setVar(id('VarPlayerType', 'tutorial'), 1000);
  p.write = packet => { (p.packets ??= []).push(packet); };
  p.packets = [];
  World.players[p.slot] = p;
  World.playerLoop.add(p.hash64, p);
  rsbuf.addPlayer(p.slot);
  p.getInventory(worn);
  p.buildArea.rebuild();
  return p;
}

function nativeNpc(p, name) {
  const wanted = id('NpcType', name);
  const roots = types.NpcType.configs.filter(type => type &&
    (type.id === wanted || type.multinpc?.includes(wanted)));
  const visible = type => type.id === wanted || type.multinpc[
    type.multivarbit >= 0 ? p.getVarBit(type.multivarbit) : p.getVar(type.multivarp)
  ] === wanted;
  roots.sort((a, b) => Number(visible(b)) - Number(visible(a)));
  for (const root of roots) {
    for (const row of nativeNpcRows(root.debugname)) {
      const actor = [...World.npcs].find(npc => npc.type === row.id && npc.level === row.level &&
        npc.x === row.x && npc.z === row.z);
      if (actor) return actor;
    }
  }
  assert.fail(`the original map contains a native actor for ${name}`);
}

function selectVisibleNpc(p, actor, visibleName) {
  const visibleId = id('NpcType', visibleName);
  const base = types.NpcType.get(actor.type);
  if (base.id === visibleId) return;
  assert(base.multinpc?.includes(visibleId), `${base.debugname} can show ${visibleName}`);
  const hasVarbit = Number.isInteger(base.multivarbit) && base.multivarbit >= 0;
  const hasVarp = Number.isInteger(base.multivarp) && base.multivarp >= 0;
  assert(hasVarbit || hasVarp, `${base.debugname} has a native form selector`);
  const current = hasVarbit ? p.getVarBit(base.multivarbit) : p.getVar(base.multivarp);
  if (base.multinpc[current] === visibleId) return;
  const index = base.multinpc.indexOf(visibleId);
  if (hasVarbit) p.setVarBit(base.multivarbit, index);
  else p.setVar(base.multivarp, index);
  const selected = hasVarbit ? p.getVarBit(base.multivarbit) : p.getVar(base.multivarp);
  assert.equal(base.multinpc[selected], visibleId, `${visibleName} is the player's visible form`);
}

function showNpc(p, actor) {
  p.buildArea.rebuild();
  const appearance = p.generateAppearance();
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, appearance, p.lastAppearance,
    p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ,
    p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[PlayerStat.HITPOINTS], p.baseLevels[PlayerStat.HITPOINTS], p.animId, p.animDelay,
    p.sayMessage, p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0,
    p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(actor.x, actor.level, actor.z, actor.nid, actor.type, actor.tele, actor.jump,
    actor.runDir, actor.walkDir, actor.isActive, actor.masks, actor.faceEntity,
    actor.faceSquareX, actor.faceSquareZ, actor.faceAngleX, actor.faceAngleZ,
    actor.hitmarkDamage, actor.hitmarkType, actor.hitmark2Damage, actor.hitmark2Type,
    actor.levels[NpcStat.HITPOINTS], actor.baseLevels[NpcStat.HITPOINTS], actor.animId,
    actor.animDelay, actor.sayMessage, actor.spotanimId, actor.spotanimHeight, actor.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, actor.nid), 'the target NPC is client-visible');
}

function placePlayerAt(p, level, x, z, label) {
  assert(floorTiles.has(`${level},${x},${z}`), `${label} uses a packed floor tile`);
  assert(!map.isMapBlocked(x, z, level), `${label} is not blocked by packed map collision`);
  p.level = level; p.x = x; p.z = z; p.originX = x; p.originZ = z;
  p.buildArea.rebuild();
}

function placeNearNpc(p, actor) {
  const original = [p.level, p.x, p.z, p.originX, p.originZ];
  for (let x = actor.x - 4; x <= actor.x + 4; x++) {
    for (let z = actor.z - 4; z <= actor.z + 4; z++) {
      if (!floorTiles.has(`${actor.level},${x},${z}`) || map.isMapBlocked(x, z, actor.level)) continue;
      p.level = actor.level; p.x = x; p.z = z;
      if (p.inOperableDistance(actor)) {
        p.originX = x; p.originZ = z;
        p.buildArea.rebuild();
        assert(p.inOperableDistance(actor), `${types.NpcType.get(actor.type).debugname} stays in native reach`);
        return;
      }
    }
  }
  [p.level, p.x, p.z, p.originX, p.originZ] = original;
  p.buildArea.rebuild();
  assert.fail(`${types.NpcType.get(actor.type).debugname} has a collision-valid native approach`);
}

function drive(p, state, choices = []) {
  for (let step = 0; state.execution !== State.FINISHED && step < 500; step++) {
    if (state.execution === State.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
    } else {
      assert.equal(state.execution, State.PAUSEBUTTON, `${state.script.name} remains executable`);
      const root = p.modalChat >= 0 ? types.Component.get(p.modalChat)?.comName ?? '' : '';
      if (/^multi[2-5]$/.test(root)) {
        assert(choices.length, `${state.script.name} needs a declared ${root} choice`);
        const selected = component(`${root}:com_${choices.shift()}`);
        assert(p.resumeButtons.includes(selected), `${root} visibly offers the selected choice`);
        p.lastCom = selected;
      }
    }
    p.executeScript(state, true, true);
    assert.notEqual(state.execution, State.ABORTED, `${state.script.name} does not abort`);
  }
  assert.equal(state.execution, State.FINISHED, `${state.script.name} finishes within the dialogue bound`);
  assert.equal(choices.length, 0, `${state.script.name} consumes every expected choice`);
}

function runSelected(p, expectedName, choices = [], clearInteraction = true) {
  const selected = p.getOpTrigger();
  assert.equal(selected?.name, expectedName, 'the visible target selects the expected packed handler');
  assert(Scripts.getByName(expectedName), `the packed handler ${expectedName} exists`);
  const executions = [];
  const execute = p.executeScript;
  p.executeScript = function(state, ...args) {
    executions.push({ state, entryName: state.script.name });
    return execute.call(this, state, ...args);
  };
  try {
    assert(p.tryInteract(true), `${expectedName} starts through the production interaction`);
  } finally {
    p.executeScript = execute;
  }
  assert.equal(executions.length, 1, 'one visible interaction starts one script');
  assert.equal(executions[0].entryName, expectedName);
  drive(p, executions[0].state, choices);
  if (clearInteraction) p.clearInteraction();
}

function nativeNpcOption(p, actor, visibleName, option, choices = [], position = null) {
  selectVisibleNpc(p, actor, visibleName);
  if (position) placePlayerAt(p, actor.level, position.x, position.z, `${visibleName} option ${option}`);
  else placeNearNpc(p, actor);
  showNpc(p, actor);
  assert(new OpNpcHandler().handle(new OpNpc(option, actor.nid), p),
    `${visibleName} native option ${option} is accepted`);
  assert.equal(p.target, actor, `${visibleName} remains the real target`);
  assert(p.validateTarget(), `${visibleName} remains a valid interaction target`);
  runSelected(p, `[opnpc${option},${visibleName}]`, choices);
}

function talk(p, name, choices = [], option = 1) {
  const actor = nativeNpc(p, name);
  nativeNpcOption(p, actor, name, option, choices);
  return actor;
}

function clickLocNative(p, loc, option, expectedName, choices = []) {
  const [level, x, z] = approachTile(loc);
  placePlayerAt(p, level, x, z, `${types.LocType.get(loc.type).debugname} option ${option}`);
  assert(new OpLocHandler().handle(new OpLoc(option, loc.x, loc.z, loc.type), p),
    `${types.LocType.get(loc.type).debugname} native option ${option} is accepted`);
  assert.equal(p.target, loc, 'native location option keeps the original map target');
  assert(p.validateTarget(), 'native location option target remains valid');
  runSelected(p, expectedName, choices);
}

function useItemOnLocNative(p, itemName, loc, expectedName) {
  const [level, x, z] = approachTile(loc);
  placePlayerAt(p, level, x, z, `${itemName} on ${types.LocType.get(loc.type).debugname}`);
  const itemId = id('ObjType', itemName);
  const itemSlot = Array.from({ length: types.InvType.get(inv).size }, (_, slot) => slot)
    .find(slot => p.invGetSlot(inv, slot)?.id === itemId);
  assert(Number.isInteger(itemSlot), `${itemName} is carried for the native use-on action`);
  assert(!p.delayed, `${itemName} use-on waits for native player delays`);
  assert(p.isComponentVisible(types.Component.get(inventoryComponent)), 'the native inventory component is visible');
  assert.equal(p.getInventoryFromListener(p.invListeners.find(listener => listener.com === inventoryComponent)),
    p.getInventory(inv), 'the native inventory listener belongs to the acting player');
  assert(new OpLocUHandler().handle(new OpLocU(loc.x, loc.z, loc.type, itemId, itemSlot, inventoryComponent), p),
    `${itemName} native use-on ${types.LocType.get(loc.type).debugname} is accepted`);
  assert.equal(p.target, loc, 'native use-on keeps the original map target');
  assert(p.validateTarget(), 'the original location remains a valid interaction target');
  const parent = types.LocType.get(loc.type);
  const visible = parent.multiloc && parent.multivarbit >= 0
    ? types.LocType.get(parent.multiloc[p.getVarBit(parent.multivarbit)]) : parent;
  const visibleHandler = visible && Scripts.getByName(`[oplocu,${visible.debugname}]`);
  runSelected(p, visibleHandler?.name ?? expectedName);
}

function captureNative(p, action, expectedName) {
  const executions = [];
  const execute = p.executeScript;
  p.executeScript = function(state, ...args) {
    executions.push({ state, entryName: state.script.name });
    return execute.call(this, state, ...args);
  };
  let accepted;
  try { accepted = action(); } finally { p.executeScript = execute; }
  assert(accepted, `${expectedName ?? 'inventory option'} is accepted by its native packet handler`);
  assert.equal(executions.length, 1, 'one native inventory action starts one compiled handler');
  if (expectedName) assert.equal(executions[0].entryName, expectedName);
  drive(p, executions[0].state);
}

function heldUse(p, target, used) {
  captureNative(p, () => new OpHeldUHandler().handle(new OpHeldU(
    id('ObjType', target), slot(p, target), inventoryComponent,
    id('ObjType', used), slot(p, used), inventoryComponent
  ), p), `[opheldu,${target}]`);
}

function heldOption(p, item, caption) {
  const type = types.ObjType.get(id('ObjType', item));
  const option = type.iop.indexOf(caption) + 1;
  assert(option > 0, `${item} exposes ${caption}`);
  captureNative(p, () => new OpHeldHandler().handle(
    new OpHeld(option, type.id, slot(p, item), inventoryComponent), p));
}

const bit = (p, name) => p.getVarBit(id('VarBitType', name));
const remove = (p, name, amount = count(p, name)) => p.invDel(inv, id('ObjType', name), amount);
const packetText = p => p.packets.filter(packet => packet.constructor.name === 'IfSetText')
  .map(packet => packet.text).join(' ');
const growthTimer = Scripts.getByName('[softtimer,farming_growth]');
assert(growthTimer, 'the shared production Farming timer is packed');
const healthySeed = (() => {
  for (let seed = 0; seed < 200000; seed++) {
    JavaRandom.setSeed(seed);
    if (Array.from({ length: 16 }, () => Math.floor(JavaRandom.nextDouble() * 128))
      .every(draw => draw >= 20)) return seed;
  }
  assert.fail('a bounded native healthy Farming random witness exists');
})();
let minute = 605;
function growthWindow(p) {
  minute += 5;
  JavaRandom.setSeed(healthySeed);
  World.currentTick += 500;
  p.processTimers(PlayerTimerType.SOFT);
}

function donor(p, name, choices = []) { return talk(p, name, [1, ...choices]); }
function ringToInventory(p) {
  const ring = id('ObjType', 'ring_of_charos_unlocked');
  if (p.invTotal(worn, ring)) {
    // Equipment setup only; well state is always produced by the real use-on.
    p.invDel(worn, ring, 1);
    add(p, 'ring_of_charos_unlocked');
  }
}
function ownedTrolley(p) {
  const actor = World.getNpcByUid(p.getVar(id('VarPlayerType', 'garden_trolley_uid')));
  assert(actor, 'loading the original statue creates the owned trolley NPC');
  return actor;
}

function trolleyApproach(p, actor, dx, dz, pull = false) {
  for (let x = actor.x - 1; x <= actor.x + 1; x++) {
    for (let z = actor.z - 1; z <= actor.z + 1; z++) {
      if (!floorTiles.has(`${actor.level},${x},${z}`) || map.isMapBlocked(x, z, actor.level)) continue;
      let vx = actor.x - x, vz = actor.z - z;
      if (!vx && !vz) continue;
      if (Math.abs(vx) > Math.abs(vz)) { vx = Math.sign(vx); vz = 0; }
      else { vx = 0; vz = Math.sign(vz); }
      if (pull) { vx = -vx; vz = -vz; }
      if (vx !== dx || vz !== dz) continue;
      p.level = actor.level; p.x = x; p.z = z;
      if (p.inOperableDistance(actor)) return { x, z };
    }
  }
  return null;
}

function trolleyStep(p, actor, dx, dz, option = 1) {
  const name = types.NpcType.get(actor.type).debugname;
  let position = trolleyApproach(p, actor, dx, dz, option === 3);
  if (!position && option !== 3) {
    option = 3;
    position = trolleyApproach(p, actor, dx, dz, true);
  }
  assert(position, `the original map permits a native trolley approach for ${dx},${dz}`);
  nativeNpcOption(p, actor, name, option, [], position);
  return option === 4 ? 4 : 1;
}

function trolleyPath(actor, goal) {
  const start = { x: actor.x, z: actor.z };
  const nodes = [{ ...start, previous: -1 }];
  const seen = new Set([`${start.x},${start.z}`]);
  for (let i = 0; i < nodes.length; i++) {
    const here = nodes[i];
    if (goal(here)) {
      const result = [];
      for (let n = i; nodes[n].previous >= 0; n = nodes[n].previous) result.push(nodes[n]);
      return result.reverse();
    }
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const x = here.x + dx, z = here.z + dz;
      if (Math.abs(x - start.x) > 48 || Math.abs(z - start.z) > 48 ||
        seen.has(`${x},${z}`) || !floorTiles.has(`${actor.level},${x},${z}`) ||
        map.isMapBlocked(x, z, actor.level) ||
        !map.isLineOfWalk(actor.level, here.x, here.z, x, z)) continue;
      seen.add(`${x},${z}`);
      nodes.push({ x, z, previous: i });
    }
  }
  assert.fail('the original packed collision has a bounded trolley route to the next product boundary');
}

function haulTo(p, actor, goal, destination = null) {
  const route = trolleyPath(actor, goal);
  let bigPush = false;
  for (let i = 0; i < route.length;) {
    const dx = route[i].x - actor.x, dz = route[i].z - actor.z;
    const four = i + 3 < route.length && route.slice(i, i + 4)
      .every((tile, n) => tile.x === actor.x + dx * (n + 1) && tile.z === actor.z + dz * (n + 1));
    const steps = trolleyStep(p, actor, dx, dz, four ? 4 : 1);
    bigPush ||= steps === 4;
    i += steps;
    if (destination && actor.x === destination.x && actor.z === destination.z) return bigPush;
    assert.equal(actor.x, route[i - 1].x, 'native trolley movement follows the collision-valid route');
    assert.equal(actor.z, route[i - 1].z, 'native trolley movement follows the collision-valid route');
  }
  assert(goal(actor), 'the native trolley action reaches its target boundary');
  return bigPush;
}

let cases = 0, failures = 0;
function test(name, action) {
  cases++;
  try { action(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}`); console.error(error); }
}
function prerequisites(p) {
  p.setVar(fenkQuestVarp, fenkComplete);
  p.setLevel(PlayerStat.FARMING, 25);
}

const dateHandler = Runner.HANDLERS[ScriptOpcode.DATE_MINUTES];
Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(minute);
try {
  test('Queen prerequisites, decline and full-inventory acceptance are atomic', () => {
    const p = nativePlayer();
    talk(p, 'queen_ellamaria');
    assert.equal(stage(p), 0);
    p.setLevel(PlayerStat.FARMING, 25);
    talk(p, 'queen_ellamaria');
    assert.equal(stage(p), 0, 'Farming alone does not bypass Fenkenstrain');
    prerequisites(p);
    p.setLevel(PlayerStat.FARMING, 24);
    talk(p, 'queen_ellamaria');
    assert.equal(stage(p), 0, 'completed Fenkenstrain does not bypass Farming 25');
    p.setLevel(PlayerStat.FARMING, 25);
    talk(p, 'queen_ellamaria', [2]);
    assert.equal(stage(p), 0, 'declining does not start the quest');
    add(p, 'spade', 28);
    talk(p, 'queen_ellamaria', [1]);
    assert.equal(stage(p), 0, 'a full inventory does not commit acceptance without the list');
    assert.equal(count(p, 'garden_list'), 0);
  });

  test('Garden and Swan Song keep both Wise Old Man topics reachable', () => {
    const p = nativePlayer();
    prerequisites(p);
    talk(p, 'queen_ellamaria', [1]);
    p.setVarBit(id('VarBitType', 'swansong'), 5);
    talk(p, 'wise_old_man', [2]);
    assert.equal(p.getVarBit(id('VarBitType', 'swansong')), 5, 'Swan Song still requests its runes');
    assert.equal(stage(p), 1, 'Swan Song does not advance Garden');
    add(p, 'ring_of_charos');
    talk(p, 'wise_old_man', [1, 3, 1, 3, 2, 2, 2, 2, 1]);
    assert.equal(count(p, 'ring_of_charos_unlocked'), 1);
    assert.equal(p.getVarBit(id('VarBitType', 'swansong')), 5, 'Garden does not consume Swan Song progress');
  });

  test('shared GAG Talk-to preserves Fairytale I and the Garden topic', () => {
    const p = nativePlayer();
    prerequisites(p);
    talk(p, 'queen_ellamaria', [1]);
    const fairyStage = id('VarBitType', 'fairy_farmers_quest');
    const fairyVisited = id('VarPlayerType', 'fairy_gardeners_visited');
    p.setVarBit(fairyStage, 1);
    donor(p, 'lyra', [2]);
    assert.equal(p.getVarBit(fairyStage), 2, 'the original GAG investigation still advances');
    const visited = p.getVar(fairyVisited);
    assert.notEqual(visited, 0);
    assert.equal(stage(p), 1);
    assert.equal(bit(p, 'garden_lyra_varbit'), 0, 'the GAG topic does not run a Garden trade');
    add(p, 'ring_of_charos_unlocked');
    heldOption(p, 'ring_of_charos_unlocked', 'Wear');
    donor(p, 'lyra', [1, 2, 2, 3, 2, 2, 1]);
    assert.equal(bit(p, 'garden_lyra_varbit'), 1);
    assert.equal(p.getVarBit(fairyStage), 2, 'the Garden topic preserves the GAG investigation stage');
    assert.equal(p.getVar(fairyVisited), visited, 'the Garden topic preserves the visited-gardener mask');
  });

  test('native end-to-end trades, nine patches, both statues, reveal and once-only rewards', () => {
    let p = nativePlayer();
    prerequisites(p);
    minute = 605;
    talk(p, 'queen_ellamaria', [1]);
    assert.equal(stage(p), 1);
    assert.equal(count(p, 'garden_list'), 1);
    remove(p, 'garden_list');
    talk(p, 'queen_ellamaria', [1]);
    assert.equal(count(p, 'garden_list'), 1, 'the Queen replaces a lost list during the active quest');
    talk(p, 'queen_ellamaria', [5]);
    assert.equal(stage(p), 1, 'an unfinished garden cannot enter the reveal');
    add(p, 'ring_of_charos');
    talk(p, 'wise_old_man', [1, 1, 1, 1, 1, 1, 1, 2]);
    assert.equal(count(p, 'ring_of_charos_unlocked'), 0, 'a failed quiz leaves the ring unchanged');
    talk(p, 'wise_old_man', [3, 1, 3, 2, 2, 2, 2, 1]);
    assert.equal(count(p, 'ring_of_charos'), 0);
    assert.equal(count(p, 'ring_of_charos_unlocked'), 1);
    assert.equal(p.getVar(id('VarPlayerType', 'fenk_charos_unlocked')), 1, 'unlock is recorded for later lost-ring recovery');
    remove(p, 'ring_of_charos_unlocked');
    p.setLevel(PlayerStat.THIEVING, 25);
    talk(p, 'fenk_fenkenstrain_model', [], 3);
    assert.equal(p.getVar(fenkQuestVarp), fenkComplete, 'recovery uses the post-quest tower actor');
    assert.equal(count(p, 'ring_of_charos_unlocked'), 1, 'a lost activated ring is recovered activated');
    heldOption(p, 'ring_of_charos_unlocked', 'Wear');
    assert.equal(p.invTotal(worn, id('ObjType', 'ring_of_charos_unlocked')), 1);

    // Soil is external fixture setup. Garden provenance is written only by
    // actual local flower planting, shared-timer growth and native harvesting.
    add(p, 'rake'); add(p, 'dibber'); add(p, 'spade');
    donor(p, 'elstan', [2, 3, 2, 2, 1]);
    assert.equal(bit(p, 'garden_elstan_varbit'), 1);
    add(p, 'marigold');
    donor(p, 'elstan');
    assert.equal(bit(p, 'garden_elstan_varbit'), 1, 'a carried foreign marigold is rejected');
    remove(p, 'marigold');
    const flowerSelector = types.LocType.get(flowerPatch.type).multivarbit;
    p.setVarBit(flowerSelector, 3);
    add(p, 'marigold_seed');
    proc(p, 'farming_login');
    useItemOnLocNative(p, 'marigold_seed', flowerPatch, '[oplocu,farming_flower_patch_1]');
    assert.equal(bit(p, 'garden_elstan_varbit'), 2, 'local planting records provenance');
    for (let i = 0; i < 4; i++) growthWindow(p);
    assert.equal(p.getVarBit(flowerSelector), 12, 'the real timer matures the local marigolds');
    clickLocNative(p, flowerPatch, 1, '[oploc1,marigold_fullygrown]');
    assert.equal(bit(p, 'garden_elstan_varbit'), 3, 'local picking records delivery provenance');
    const occupied = Array.from({ length: types.InvType.get(inv).size }, (_, index) => p.invGetSlot(inv, index))
      .filter(Boolean).length;
    const filler = types.InvType.get(inv).size - occupied;
    add(p, 'spade', filler);
    donor(p, 'elstan');
    assert.equal(bit(p, 'garden_elstan_varbit'), 3, 'a full bag preserves the ready trade');
    assert.equal(count(p, 'marigold'), 1, 'a full bag does not consume the local marigold');
    assert.equal(count(p, 'garden_delphinium_seed'), 0);
    remove(p, 'spade', filler);
    donor(p, 'elstan');
    assert.equal(bit(p, 'garden_elstan_varbit'), 4);
    assert.equal(count(p, 'garden_delphinium_seed'), 4);
    assert.equal(count(p, 'marigold'), 0, 'the local marigold is consumed exactly once');
    for (const lost of [1, 4]) {
      remove(p, 'garden_delphinium_seed', lost);
      donor(p, 'elstan');
      assert.equal(count(p, 'garden_delphinium_seed'), 4, 'partial and complete delphinium losses recover');
    }

    donor(p, 'lyra', [2, 2, 3, 2, 2, 1]);
    donor(p, 'kragen', [2, 2, 2, 2, 2, 1]);
    assert.equal(bit(p, 'garden_lyra_varbit'), 1);
    assert.equal(bit(p, 'garden_kragen_varbit'), 1);
    const onionLoc = allotmentPatches.get('farming_allotment_varp_2_16_23');
    const cabbageLoc = allotmentPatches.get('farming_allotment_varp_2_8_15');
    for (const [loc, seed] of [[onionLoc, 'onion_seed'], [cabbageLoc, 'cabbage_seed']]) {
      p.setVarBit(types.LocType.get(loc.type).multivarbit, 3);
      add(p, seed, 3);
      useItemOnLocNative(p, seed, loc, `[oplocu,${types.LocType.get(loc.type).debugname}]`);
    }
    donor(p, 'lyra'); donor(p, 'kragen');
    assert.equal(count(p, 'garden_orchid_pink_seed'), 0, 'immature onions do not pay the trade');
    assert.equal(count(p, 'garden_snowdrop_seed'), 0, 'immature cabbages do not pay the trade');
    // Ordinary allotments use four ten-minute cycles, unlike Garden's five-minute row.
    for (let i = 0; i < 8; i++) growthWindow(p);
    const onionsBefore = p.getVarBit(types.LocType.get(onionLoc.type).multivarbit);
    const cabbagesBefore = p.getVarBit(types.LocType.get(cabbageLoc.type).multivarbit);
    assert.equal(onionsBefore, 17, 'native onion growth reaches its mature row');
    assert.equal(cabbagesBefore, 24, 'native cabbage growth reaches its mature row');
    donor(p, 'lyra'); donor(p, 'kragen');
    assert.equal(count(p, 'garden_orchid_pink_seed'), 3);
    assert.equal(count(p, 'garden_orchid_yellow_seed'), 3);
    assert.equal(count(p, 'garden_snowdrop_seed'), 4);
    assert.equal(p.getVarBit(types.LocType.get(onionLoc.type).multivarbit), onionsBefore, 'Lyra inspects without harvesting');
    assert.equal(p.getVarBit(types.LocType.get(cabbageLoc.type).multivarbit), cabbagesBefore, 'Kragen inspects without harvesting');
    for (const lost of [1, 3]) {
      for (const seed of ['garden_orchid_pink_seed', 'garden_orchid_yellow_seed']) remove(p, seed, lost);
      donor(p, 'lyra');
      assert.equal(count(p, 'garden_orchid_pink_seed'), 3, 'pink orchids recover partial and complete loss');
      assert.equal(count(p, 'garden_orchid_yellow_seed'), 3, 'yellow orchids recover partial and complete loss');
    }
    for (const lost of [1, 4]) {
      remove(p, 'garden_snowdrop_seed', lost);
      donor(p, 'kragen');
      assert.equal(count(p, 'garden_snowdrop_seed'), 4, 'snowdrops recover partial and complete loss');
    }

    talk(p, 'bernald', [2]);
    const vines = packedLoc('garden_burthorpe_vines_diseased');
    add(p, 'plant_cure', 2);
    useItemOnLocNative(p, 'plant_cure', vines, '[oplocu,garden_burthorpe_vines_diseased]');
    assert.equal(bit(p, 'garden_bernald_varbit'), 2);
    assert.equal(count(p, 'plant_cure'), 1, 'the failed normal cure is consumed');
    talk(p, 'bernald');
    assert.equal(bit(p, 'garden_bernald_varbit'), 3);
    donor(p, 'farming_gardener_tree_1', [2]);
    assert.equal(count(p, 'plant_cure_strong'), 0, 'attempting to charm Alain grants no cure');
    donor(p, 'farming_gardener_tree_1', [1]);
    add(p, 'blankrune'); add(p, 'hammer'); add(p, 'pestle_and_mortar');
    for (const lostForm of ['rune_shards', 'rune_dust', 'plant_cure_strong']) {
      const q = nativePlayer(p.save());
      heldUse(q, 'blankrune', 'hammer');
      if (lostForm !== 'rune_shards') heldUse(q, 'rune_shards', 'pestle_and_mortar');
      if (lostForm === 'plant_cure_strong') heldUse(q, 'plant_cure', 'rune_dust');
      remove(q, lostForm);
      add(q, 'blankrune'); add(q, 'plant_cure');
      heldUse(q, 'blankrune', 'hammer');
      heldUse(q, 'rune_shards', 'pestle_and_mortar');
      heldUse(q, 'plant_cure', 'rune_dust');
      assert.equal(count(q, 'plant_cure_strong'), 1, `${lostForm} loss permits recrafting from ordinary materials`);
      useItemOnLocNative(q, 'plant_cure_strong', vines, '[oplocu,garden_burthorpe_vines_diseased]');
      talk(q, 'bernald');
      assert.equal(count(q, 'garden_vine_seed'), 4, `${lostForm} loss does not strand Bernald's trade`);
    }
    heldUse(p, 'blankrune', 'hammer');
    heldUse(p, 'rune_shards', 'pestle_and_mortar');
    heldUse(p, 'plant_cure', 'rune_dust');
    assert.equal(count(p, 'plant_cure_strong'), 1);
    useItemOnLocNative(p, 'plant_cure_strong', vines, '[oplocu,garden_burthorpe_vines_diseased]');
    assert.equal(bit(p, 'garden_bernald_varbit'), 4);
    talk(p, 'bernald');
    assert.equal(count(p, 'garden_vine_seed'), 4);
    for (const lost of [1, 4]) {
      remove(p, 'garden_vine_seed', lost);
      talk(p, 'bernald');
      assert.equal(count(p, 'garden_vine_seed'), 4, 'vine seeds recover partial and complete loss');
    }
    remove(p, 'hammer'); remove(p, 'pestle_and_mortar');

    donor(p, 'dantaera', [2, 2, 2]);
    add(p, 'secateurs');
    const deadTree = packedLoc('garden_white_tree_dead');
    useItemOnLocNative(p, 'secateurs', deadTree, '[oplocu,garden_white_tree_dead]');
    assert.equal(count(p, 'garden_white_tree_shoot'), 1);
    remove(p, 'garden_white_tree_shoot');
    donor(p, 'dantaera');
    useItemOnLocNative(p, 'secateurs', deadTree, '[oplocu,garden_white_tree_dead]');
    assert.equal(count(p, 'garden_white_tree_shoot'), 1, 'a lost White Tree shoot is recoverable');
    const cuttingRecovers = form => {
      const q = nativePlayer(p.save());
      remove(q, form);
      donor(q, 'dantaera');
      useItemOnLocNative(q, 'secateurs', deadTree, '[oplocu,garden_white_tree_dead]');
      assert.equal(count(q, 'garden_white_tree_shoot'), 1, `${form} loss permits a new White Tree cutting`);
    };
    add(p, 'plantpot_empty');
    heldUse(p, 'plantpot_empty', 'garden_white_tree_shoot');
    cuttingRecovers('garden_white_tree_plantpot_shoot');
    add(p, 'watering_can_8');
    heldUse(p, 'garden_white_tree_plantpot_shoot', 'watering_can_8');
    assert.equal(count(p, 'garden_white_tree_plantpot_shoot_watered'), 1);
    cuttingRecovers('garden_white_tree_plantpot_shoot_watered');
    growthWindow(p);
    assert.equal(count(p, 'garden_white_tree_plantpot_sapling'), 1, 'the shared timer grows the watered shoot');
    cuttingRecovers('garden_white_tree_plantpot_sapling');
    remove(p, 'watering_can_7');
    remove(p, 'secateurs');

    talk(p, 'brother_althric', [2]);
    ringToInventory(p);
    const well = packedLoc('well', loc => loc.x === 3084 && loc.z === 3502);
    useItemOnLocNative(p, 'ring_of_charos_unlocked', well, '[oplocu,well]');
    assert.equal(bit(p, 'garden_ring_in_well_varbit'), 1);
    assert.equal(count(p, 'ring_of_charos_unlocked'), 0);
    for (const [rose, seed] of [
      ['garden_roses_white', 'garden_rosebush_seed_white'],
      ['garden_roses_red', 'garden_rosebush_seed_red'],
      ['garden_roses_pink', 'garden_rosebush_seed_pink']
    ]) {
      clickLocNative(p, packedLoc(rose), 1, `[oploc1,${rose}]`);
      assert.equal(count(p, seed), 3);
      for (const lost of [1, 3]) {
        remove(p, seed, lost);
        clickLocNative(p, packedLoc(rose), 1, `[oploc1,${rose}]`);
        assert.equal(count(p, seed), 3, 'rose seeds recover partial and complete loss');
      }
    }
    add(p, 'fishing_rod');
    useItemOnLocNative(p, 'fishing_rod', well, '[oplocu,well]');
    assert.equal(bit(p, 'garden_ring_in_well_varbit'), 0);
    assert.equal(count(p, 'ring_of_charos_unlocked'), 1);
    heldOption(p, 'ring_of_charos_unlocked', 'Wear');
    remove(p, 'fishing_rod');

    const planting = [
      ['garden_delphinium_patch', 'garden_delphinium_seed', 4],
      ['garden_orchid_pink_patch', 'garden_orchid_pink_seed', 3],
      ['garden_orchid_yellow_patch', 'garden_orchid_yellow_seed', 3],
      ['garden_snowdrop_patch', 'garden_snowdrop_seed', 4],
      ['garden_white_tree_patch', 'garden_white_tree_plantpot_sapling', 1],
      ['garden_vine_patch', 'garden_vine_seed', 4],
      ['garden_rosebush_patch_white', 'garden_rosebush_seed_white', 3],
      ['garden_rosebush_patch_red', 'garden_rosebush_seed_red', 3],
      ['garden_rosebush_patch_pink', 'garden_rosebush_seed_pink', 3]
    ];
    for (const [name, seed, amount] of planting) {
      const { loc, varbit } = gardenLocs.get(name);
      if (name.includes('orchid')) {
        useItemOnLocNative(p, seed, loc, `[oplocu,${name}]`);
        assert.equal(p.getVarBit(varbit), 0, 'an orchid requires compost before planting');
        add(p, 'bucket_compost');
        useItemOnLocNative(p, 'bucket_compost', loc, `[oplocu,${name}]`);
        remove(p, 'bucket_empty');
        assert.equal(p.getVarBit(varbit), 1);
      } else {
        for (let step = 0; step < 3; step++) {
          World.currentTick += 3;
          useItemOnLocNative(p, 'rake', loc, `[oplocu,${step ? types.LocType.get(
            types.LocType.get(loc.type).multiloc[step]).debugname : name}]`);
          assert.equal(p.getVarBit(varbit), step + 1, `${name} loses one weed layer`);
        }
      }
      const before = count(p, seed);
      useItemOnLocNative(p, seed, loc, `[oplocu,${types.LocType.get(
        types.LocType.get(loc.type).multiloc[p.getVarBit(varbit)]).debugname}]`);
      assert.equal(p.getVarBit(varbit), 4, `${name} is planted through the visible native target`);
      assert.equal(count(p, seed), before - amount, `${name} consumes its whole approved planting bundle`);
    }
    talk(p, 'queen_ellamaria', [5]);
    assert.equal(stage(p), 1, 'planted but immature patches cannot complete');
    for (let step = 1; step <= 4; step++) {
      growthWindow(p);
      for (const [name] of planting) {
        const { varbit } = gardenLocs.get(name);
        assert.equal(p.getVarBit(varbit), Math.min(name === 'garden_white_tree_patch' ? 8 : 7, 4 + step),
          `${name} grows through the actual unprotected shared soft timer`);
      }
    }
    assert.equal(proc(p, 'garden_all_grown').popInt(), 1);
    talk(p, 'queen_ellamaria', [5]);
    assert.equal(stage(p), 1, 'grown plants do not replace the two statue requirements');

    talk(p, 'queen_ellamaria', [4]);
    remove(p, 'garden_trolley_obj');
    talk(p, 'queen_ellamaria', [4]);
    assert.equal(count(p, 'garden_trolley_obj'), 1, 'the Queen replaces a lost empty trolley');
    const saraSource = packedLoc('garden_saradomin_statue');
    useItemOnLocNative(p, 'garden_trolley_obj', saraSource, '[oplocu,garden_saradomin_statue]');
    let actor = ownedTrolley(p);
    assert.equal(bit(p, 'garden_saradomin_statue_varbit'), 1);
    const stranger = nativePlayer();
    const before = [actor.x, actor.z];
    nativeNpcOption(stranger, actor, 'garden_trolley_saradomin', 1);
    assert.deepEqual([actor.x, actor.z], before, 'another player cannot move the owned trolley');
    nativeNpcOption(p, actor, 'garden_trolley_saradomin', 5);
    assert.equal(bit(p, 'garden_saradomin_statue_varbit'), 1, 'a statue cannot be placed far from its plinth');

    // Save/load keeps progress but never the ephemeral actor UID. The Queen's
    // normal recovery branch resets only the abandoned in-transit statue.
    p = nativePlayer(p.save());
    proc(p, 'farming_login');
    assert.equal(bit(p, 'garden_saradomin_statue_varbit'), 1);
    talk(p, 'queen_ellamaria', [4]);
    assert.equal(bit(p, 'garden_saradomin_statue_varbit'), 0);
    assert.equal(count(p, 'garden_trolley_obj'), 1);
    useItemOnLocNative(p, 'garden_trolley_obj', saraSource, '[oplocu,garden_saradomin_statue]');
    actor = ownedTrolley(p);
    assert(haulTo(p, actor, tile => tile.x >= 2961 && tile.x <= 2969 && tile.z >= 3399,
      saraDropoff), 'a real four-tile Big-push is exercised before leaving Falador');
    assert.deepEqual([actor.x, actor.z], [saraDropoff.x, saraDropoff.z]);
    haulTo(p, actor, tile => Math.max(Math.abs(tile.x - saraPlinth.x), Math.abs(tile.z - saraPlinth.z)) <= 1);
    p.invClear(inv);
    add(p, 'spade', 28);
    nativeNpcOption(p, actor, 'garden_trolley_saradomin', 5);
    assert.equal(bit(p, 'garden_saradomin_statue_varbit'), 1, 'a full bag cannot lose the returned trolley');
    remove(p, 'spade', 1);
    nativeNpcOption(p, actor, 'garden_trolley_saradomin', 5);
    assert.equal(bit(p, 'garden_saradomin_statue_varbit'), 2);
    assert.equal(count(p, 'garden_trolley_obj'), 1);

    useItemOnLocNative(p, 'garden_trolley_obj', packedLoc('statue_lumbridge'), '[oplocu,statue_lumbridge]');
    actor = ownedTrolley(p);
    haulTo(p, actor, tile => tile.x >= 3241 && tile.z >= 3216 && tile.z <= 3225, kingDropoff);
    assert.deepEqual([actor.x, actor.z], [kingDropoff.x, kingDropoff.z]);
    const pullStart = [actor.x, actor.z];
    trolleyStep(p, actor, 0, -1, 3);
    assert.deepEqual([actor.x, actor.z], [pullStart[0], pullStart[1] - 1], 'Pull moves the loaded trolley one tile');
    haulTo(p, actor, tile => Math.max(Math.abs(tile.x - kingPlinth.x), Math.abs(tile.z - kingPlinth.z)) <= 1);
    nativeNpcOption(p, actor, 'garden_trolley_king', 5);
    assert.equal(bit(p, 'garden_king_statue_varbit'), 2);
    talk(p, 'queen_ellamaria', [5]);
    assert.equal(stage(p), 50);
    // Priest in Peril's existing topic stays selectable; choose Garden here.
    talk(p, 'king_roald', [1, 1, 2, 2]);
    assert.equal(stage(p), 55);
    const farmingBefore = p.stats[PlayerStat.FARMING];
    const qpBefore = proc(p, 'count_questpoints').popInt();
    p.invClear(inv);
    add(p, 'spade', 28);
    talk(p, 'queen_ellamaria');
    assert.equal(stage(p), 55, 'a full inventory postpones the reveal reward transaction');
    assert.equal(p.stats[PlayerStat.FARMING], farmingBefore);
    for (const name of ['apple_tree_seed', 'acorn', 'guam_seed', 'supercompost_potion_4']) assert.equal(count(p, name), 0);
    remove(p, 'spade', 4);
    const rewardStages = [];
    const actualAdd = p.invAdd;
    p.invAdd = function(...args) {
      if (args[0] === inv && ['apple_tree_seed', 'acorn', 'guam_seed', 'supercompost_potion_4']
        .some(name => args[1] === id('ObjType', name))) rewardStages.push(stage(this));
      return actualAdd.apply(this, args);
    };
    try { talk(p, 'queen_ellamaria'); } finally { p.invAdd = actualAdd; }
    assert.equal(stage(p), completeStage);
    assert.deepEqual(rewardStages, [60, 60, 60, 60], 'completion is committed before every item reward');
    assert.equal(p.stats[PlayerStat.FARMING] - farmingBefore, 50000);
    assert.equal(proc(p, 'count_questpoints').popInt() - qpBefore, 2);
    assert.equal(count(p, 'apple_tree_seed'), 1);
    assert.equal(count(p, 'acorn'), 1);
    assert.equal(count(p, 'guam_seed'), 5);
    assert.equal(count(p, 'supercompost_potion_4'), 1);
    assert.equal(p.invTotal(worn, id('ObjType', 'ring_of_charos_unlocked')), 1, 'the activated ring is retained, not duplicated');
    assert.equal(p.modalMain, component('questscroll_death'));
    assert.match(packetText(p), /Garden of Tranquillity/);
    assert.match(packetText(p), /5,000 Farming XP/);
    proc(p, 'garden_complete');
    assert.equal(p.stats[PlayerStat.FARMING] - farmingBefore, 50000, 'completion cannot grant XP twice');
    assert.equal(count(p, 'supercompost_potion_4'), 1, 'completion cannot grant items twice');
    p.invClear(inv);
    for (let i = 0; i < 4; i++) growthWindow(p);
    const tree = gardenLocs.get('garden_white_tree_patch');
    assert.equal(p.getVarBit(tree.varbit), 12, 'the post-quest tree caps at four fruit');
    const fruitXp = p.stats[PlayerStat.FARMING];
    clickLocNative(p, tree.loc, 1, '[oploc1,garden_white_tree_fruit_4]');
    assert.equal(count(p, 'garden_white_tree_fruit'), 1);
    assert.equal(p.stats[PlayerStat.FARMING] - fruitXp, 120);
    p.setLevel(PlayerStat.HITPOINTS, 10);
    p.levels[PlayerStat.HITPOINTS] = p.baseLevels[PlayerStat.HITPOINTS] - 4;
    p.runenergy = 5000;
    const hpBefore = p.levels[PlayerStat.HITPOINTS];
    heldOption(p, 'garden_white_tree_fruit', 'Eat');
    assert.equal(p.levels[PlayerStat.HITPOINTS], hpBefore + 3);
    assert.equal(p.runenergy, 6000);
    assert.equal(count(p, 'garden_white_tree_fruit'), 0);
  });
} finally {
  Runner.HANDLERS[ScriptOpcode.DATE_MINUTES] = dateHandler;
}
console.log(`Garden compiled checks: ${cases - failures}/${cases} passed`);
process.exit(failures ? 1 : 0);
