#!/usr/bin/env node
// Run after the complete pack. This drives packed VM handlers without starting a server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  content, World, Player, ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType,
  types, map, nativeLocRows, nativeNpcRows, nativeLocInventory, locFor,
  tileFromCoord, floorTiles
} from '../regicide-travel/runtime.mjs';
import { verifyIngredientSources } from './ingredient-sources.mjs';

const load = async relative => (await import(pathToFileURL(path.join(engine, 'src', relative)).href)).default;
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const Environment = await load('util/Environment.ts');
const JavaRandom = await load('util/JavaRandom.ts');
const ScriptPointer = await load('engine/script/ScriptPointer.ts');
const { PlayerStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const { NpcStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/NpcStat.ts')).href);
const OpNpc = await load('network/game/client/model/OpNpc.ts');
const OpNpcHandler = await load('network/game/client/handler/OpNpcHandler.ts');
const OpLoc = await load('network/game/client/model/OpLoc.ts');
const OpLocHandler = await load('network/game/client/handler/OpLocHandler.ts');
const OpHeld = await load('network/game/client/model/OpHeld.ts');
const OpHeldHandler = await load('network/game/client/handler/OpHeldHandler.ts');
const { PlayerLoading } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerLoading.ts')).href);
const Packet = await load('io/Packet.ts');
const rsbuf = await import(pathToFileURL(path.join(engine, 'src/network/rsbuf/index.ts')).href);

Environment.NODE_MEMBERS = true;
assert(World.gameMap.getTotalLocs() > 0, 'packed world map is loaded');

const id = (Type, name) => {
  const value = Type.getId(name);
  assert(Number.isInteger(value) && value >= 0, `missing packed ${Type.name} ${name}`);
  return value;
};
const obj = name => id(types.ObjType, name);
const varp = name => id(types.VarPlayerType, name);
const varbit = name => id(types.VarBitType, name);
const npcVar = name => id(types.VarNpcType, name);
const component = name => id(types.Component, name);
const invId = id(types.InvType, 'inv');
const wornId = id(types.InvType, 'worn');

// These additions are the old-code failure seam. Keep them before native map assertions.
const gardenerMaskVarp = varp('fairy_gardeners_visited');
const natureItems = types.EnumType.getByName('ft1_nature_items');
assert(natureItems, 'packed 31-entry Fairy Tale item table exists');
assert(ScriptProvider.getByName('[opnpc1,elstan]'), 'visible gardener talk trigger is packed');
assert(ScriptProvider.getByName('[opnpc1,fairy_godfather]'), 'visible Godfather talk trigger is packed');
assert(ScriptProvider.getByName('[ai_opplayer2,fairy_tanglefoot]'), 'visible Tanglefoot attack trigger is packed');

const questStageBit = varbit('fairy_farmers_quest');
const stage = p => p.getVarBit(questStageBit);
const count = (p, name, inventory = invId) => p.invTotal(inventory, obj(name));
const add = (p, name, amount = 1) => p.invAdd(invId, obj(name), amount);
const del = (p, name, amount = 1) => p.invDel(invId, obj(name), amount);
const packetText = p => p.packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => packet.text).join(' ');
const messageText = p => p.messages.join(' ');

function readConstant(relative, name) {
  const source = fs.readFileSync(path.join(content, relative), 'utf8');
  const match = new RegExp(`^\\s*\\^${name}\\s*=\\s*([^\\s]+)`, 'm').exec(source);
  assert(match, `checked-out constant ${name} in ${relative}`);
  return match[1];
}
function integerConstant(relative, name) {
  const value = Number(readConstant(relative, name));
  assert(Number.isInteger(value), `${name} is an integer source constant`);
  return value;
}
const ft1Constant = name => integerConstant('scripts/quests/quest_fairy_farmers/configs/quest_fairy_farmers.constant', name);
const druidComplete = integerConstant('scripts/general/configs/quest.constant', 'druidspirit_complete');
const completeStage = integerConstant('scripts/general/configs/quest.constant', 'fairy_farmers_complete');
const questPoints = varp('qp');
const queenCheck = varbit('fairy_queen_check');
const godfatherCheck = varbit('fairy_godfather_check');
const gardenersQuest = varbit('garden_quest');
const druidQuest = varp('druidspirit');
const damagesType = varp('damagetype');
const aggressiveNpc = varp('aggressive_npc');
const attackingUid = npcVar('npc_attacking_uid');
const npcAggressivePlayer = npcVar('npc_aggressive_player');
const npcPoison = npcVar('npc_poison');
const npcActionDelay = npcVar('npc_action_delay');
const slashStyle = integerConstant('scripts/skill_combat/configs/combat_damagetypes.constant', 'slash_style');
const rangedStyle = integerConstant('scripts/skill_combat/configs/combat_damagetypes.constant', 'ranged_style');
const magicStyle = integerConstant('scripts/skill_combat/configs/combat_damagetypes.constant', 'magic_style');
const locNorth = integerConstant('scripts/engine.constant', 'loc_north');
const locSouth = integerConstant('scripts/engine.constant', 'loc_south');
const locEast = integerConstant('scripts/engine.constant', 'loc_east');
const locWest = integerConstant('scripts/engine.constant', 'loc_west');
const splitX = ft1Constant('ft1_grove_split_x');
const completeText = 'You have completed A Fairy Tale Pt. 1!';

const itemNames = [
  'avantoe', 'babydragon_bones', 'blue_dragon_scale', 'bucket_supercompost', 'grapes',
  'raw_cave_eel', 'charcoal', 'crushed_gemstone', 'edible_seaweed', 'snail_corpse3', 'irit_leaf',
  'jangerberries', 'tbwt_jogre_bones', 'king_worm', 'lime', 'mortmyremushroom', 'mortmyrepear',
  'mortmyrebuddingstem', 'nature_talisman', 'cactus_potato', 'mosquito_proboscis', 'red_spiders_eggs',
  'red_vine_worm', 'mort_slimey_eel', 'snapdragon', 'snape_grass', 'uncut_diamond', 'uncut_ruby',
  'oystershell', 'volencia_moss', 'white_berries'
];
assert.equal(natureItems.values.size, itemNames.length, 'the compiled nature-item enum has exactly 31 rows');
for (const [index, name] of itemNames.entries()) {
  assert.equal(natureItems.values.get(index + 1), obj(name), `nature item ${index + 1} resolves to ${name}`);
}
const availableNatureIndices = itemNames.map((_, index) => index + 1);

let serial = 0;
function register(p) {
  const n = ++serial;
  p.pid = n;
  p.slot = n;
  p.uid = ((1000 + n) << 11) | n;
  p.isActive = true;
  p.level = 0;
  p.packets = [];
  p.messages = [];
  p.baseLevels.fill(99);
  p.levels.fill(99);
  p.stats.fill(130344310);
  p.write = packet => p.packets.push(packet);
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = p.messageGame;
  p.getInventory(invId);
  p.getInventory(wornId);
  World.players[p.slot] = p;
  World.playerLoop.add(p.hash64, p);
  rsbuf.addPlayer(p.slot);
  return p;
}
function player(initialStage = 0) {
  const n = serial + 1;
  const p = new Player(`ft1compiled${n}`, BigInt(1000 + n), BigInt(1000 + n));
  p.vars.fill(0);
  p.setVarBit(questStageBit, initialStage);
  return register(p);
}
function relog(p) {
  const saved = p.save();
  const username = p.username;
  p.unlink();
  World.players[p.slot] = null;
  const loaded = PlayerLoading.load(username, new Packet(saved), null);
  loaded.varsString ??= [];
  return register(loaded);
}
function fillInventory(p, filler = 'spade') {
  const inventory = p.getInventory(invId);
  for (let slot = 0; slot < 28; slot++) inventory.set(slot, { id: obj(filler), count: 1 });
  assert.equal(p.invFreeSpace(invId), 0, 'all 28 ordinary inventory slots are occupied');
}
function freeInventorySlot(p, slot = 27) {
  p.getInventory(invId).set(slot, null);
  assert(p.invFreeSpace(invId) > 0, 'one normal inventory space is free');
}
function wear(p, name) {
  const type = types.ObjType.get(obj(name));
  assert(Number.isInteger(type.wearpos) && type.wearpos >= 0, `${name} has a packed equipment slot`);
  p.getInventory(wornId).set(type.wearpos, { id: type.id, count: 1 });
}
function removeWorn(p, name) {
  const type = types.ObjType.get(obj(name));
  p.getInventory(wornId).set(type.wearpos, null);
}
function withRandom(values, action) {
  const original = JavaRandom.nextDouble;
  let draws = 0;
  JavaRandom.nextDouble = () => {
    assert(draws < values.length, `unexpected RNG draw ${draws + 1}`);
    return values[draws++];
  };
  try {
    const result = action();
    assert.equal(draws, values.length, 'consume the precise deterministic RNG stream');
    return result;
  } finally {
    JavaRandom.nextDouble = original;
  }
}
function withNoRandom(action) {
  const original = JavaRandom.nextDouble;
  JavaRandom.nextDouble = () => assert.fail('a saved Nature Spirit item set must not be rerolled');
  try { return action(); }
  finally { JavaRandom.nextDouble = original; }
}
function script(name) {
  let result;
  if (name === '[ai_opplayer2,fairy_tanglefoot]') {
    result = ScriptProvider.getByTriggerSpecific(ServerTriggerType.AI_OPPLAYER2, id(types.NpcType, 'fairy_tanglefoot'));
  } else if (name === '[ai_timer,fairy_tanglefoot]') {
    result = ScriptProvider.getByTriggerSpecific(ServerTriggerType.AI_TIMER, id(types.NpcType, 'fairy_tanglefoot'));
  } else {
    result = ScriptProvider.getByName(name);
  }
  assert(result, `missing packed script ${name}`);
  assert.equal(result.name, name, 'engine dispatch resolves the intended packed handler');
  return result;
}
function runScript(name, self, target = null, args = []) {
  const state = ScriptRunner.init(script(name), self, target, args);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  if (self instanceof Player) self.executeScript(state, true, true);
  else self.executeScript(state);
  assert.equal(state.execution, ScriptState.FINISHED, `${name} finishes`);
  return state.intStack.slice(0, state.isp);
}
function driveDialogue(p, state, choices = []) {
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 500; step++) {
    if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
    } else {
      assert.equal(state.execution, ScriptState.PAUSEBUTTON, `${state.script.name} does not abort`);
      const root = p.modalChat >= 0 ? types.Component.get(p.modalChat)?.comName ?? '' : '';
      if (/^multi[2-5]$/.test(root)) {
        assert(choices.length, `${state.script.name} has no unprovided ${root} choice`);
        p.lastCom = component(`${root}:com_${choices.shift()}`);
        assert(p.resumeButtons.includes(p.lastCom), `${root} visibly offers the selected option`);
      }
    }
    p.executeScript(state, true, true);
    assert.notEqual(state.execution, ScriptState.ABORTED, `${state.script.name} remains executable`);
  }
  assert.equal(state.execution, ScriptState.FINISHED, `${state.script.name} finishes within the dialogue bound`);
  assert.equal(choices.length, 0, `${state.script.name} consumes every expected choice`);
}
function executeSelected(p, expectedName, choices = [], clearInteraction = true) {
  const selected = p.getOpTrigger();
  assert.equal(selected?.name, expectedName, 'visible target dispatch selects the expected packed handler');
  const executions = [];
  const execute = p.executeScript;
  p.executeScript = function(state, ...args) {
    executions.push({ state, entryName: state.script.name });
    return execute.call(this, state, ...args);
  };
  try {
    assert(p.tryInteract(true), `${expectedName} is reached through the production interaction`);
  } finally {
    p.executeScript = execute;
  }
  assert.equal(executions.length, 1, 'one visible interaction starts one script');
  assert.equal(executions[0].entryName, expectedName);
  driveDialogue(p, executions[0].state, choices);
  if (clearInteraction) p.clearInteraction();
}
function npcConfig(name) {
  const type = types.NpcType.getByName(name);
  assert(type, `packed NPC type ${name}`);
  return type;
}
function placedNpc(name) {
  const child = npcConfig(name);
  const roots = types.NpcType.configs.filter(type => type && (type.id === child.id || type.multinpc?.includes(child.id)));
  for (const root of roots) {
    for (const row of nativeNpcRows(root.debugname)) {
      const actor = [...World.npcs].find(npc => npc.type === row.id && npc.level === row.level && npc.x === row.x && npc.z === row.z);
      if (actor) return actor;
    }
  }
  assert.fail(`original packed map has no placed NPC form for ${name}`);
}
function selectVisibleNpc(p, actor, visibleName, seedSelector = false) {
  const visible = npcConfig(visibleName);
  const base = types.NpcType.get(actor.type);
  if (base.id === visible.id) return;
  assert(base.multinpc?.includes(visible.id), `${base.debugname} has visible form ${visibleName}`);
  let selector = -1;
  if (base.multivarp !== -1) selector = p.getVar(base.multivarp);
  else if (base.multivarbit !== -1) selector = p.getVarBit(base.multivarbit);
  if (seedSelector) {
    const index = base.multinpc.indexOf(visible.id);
    assert(index >= 0);
    if (base.multivarp !== -1) p.setVar(base.multivarp, index);
    else if (base.multivarbit !== -1) p.setVarBit(base.multivarbit, index);
    selector = index;
  }
  assert(selector >= 0 && base.multinpc[selector] === visible.id,
    `${visibleName} is the player's actual visible NPC form at selector ${selector}`);
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
  assert(rsbuf.hasNpc(p.slot, actor.nid), 'the original NPC is client-visible');
}
function key(tile) { return `${tile[0]},${tile[1]},${tile[2]}`; }
function walk(p, destination, maxDistance = 256) {
  const start = [p.level, p.x, p.z];
  assert.equal(destination[0], start[0], 'packed collision route remains on one level');
  const startKey = `${start[1]},${start[2]}`;
  const destKey = `${destination[1]},${destination[2]}`;
  const queue = [[start[1], start[2]]];
  const previous = new Map([[startKey, null]]);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let next = 0; next < queue.length && !previous.has(destKey); next++) {
    const from = queue[next];
    for (const [dx, dz] of directions) {
      const to = [from[0] + dx, from[1] + dz];
      const toKey = `${to[0]},${to[1]}`;
      if (Math.max(Math.abs(to[0] - start[1]), Math.abs(to[1] - start[2])) > maxDistance || previous.has(toKey)) continue;
      if (!floorTiles.has(`${start[0]},${to[0]},${to[1]}`)) continue;
      if (!map.canTravel(start[0], from[0], from[1], dx, dz, 1, 0, map.CollisionType?.NORMAL ?? 0)) continue;
      previous.set(toKey, from);
      queue.push(to);
    }
  }
  assert(previous.has(destKey), `packed collision map has a route ${start.slice(1)} to ${destination.slice(1)}`);
  const route = [];
  for (let tile = [destination[1], destination[2]]; previous.get(`${tile[0]},${tile[1]}`); tile = previous.get(`${tile[0]},${tile[1]}`)) route.push(tile);
  for (const [x, z] of route.reverse()) {
    const dx = x - p.x, dz = z - p.z;
    assert(map.canTravel(p.level, p.x, p.z, dx, dz, 1, 0, map.CollisionType?.NORMAL ?? 0));
    p.x = x;
    p.z = z;
  }
  p.buildArea.rebuild();
}
function approachTiles(p, target) {
  const original = [p.level, p.x, p.z];
  const candidates = [];
  for (let x = target.x - 4; x <= target.x + 4; x++) for (let z = target.z - 4; z <= target.z + 4; z++) {
    if (!floorTiles.has(`${target.level},${x},${z}`) || map.isMapBlocked(x, z, target.level)) continue;
    p.level = target.level;
    p.x = x;
    p.z = z;
    if (p.inOperableDistance(target)) candidates.push([target.level, x, z]);
  }
  [p.level, p.x, p.z] = original;
  candidates.sort((a, b) => Math.abs(a[1] - target.x) + Math.abs(a[2] - target.z) - Math.abs(b[1] - target.x) - Math.abs(b[2] - target.z));
  return candidates;
}
function approachNpc(p, actor, fromCurrent = false) {
  const candidates = approachTiles(p, actor);
  assert(candidates.length, `packed map gives ${types.NpcType.get(actor.type).debugname} an operable floor approach`);
  if (fromCurrent) walk(p, candidates[0]);
  else {
    [p.level, p.x, p.z] = candidates[0];
    p.buildArea.rebuild();
  }
  assert(p.inOperableDistance(actor));
}
function talk(p, visibleName, choices = [], { actor = null, fromCurrent = false, seedSelector = false } = {}) {
  actor ??= placedNpc(visibleName);
  selectVisibleNpc(p, actor, visibleName, seedSelector);
  approachNpc(p, actor, fromCurrent);
  showNpc(p, actor);
  assert(new OpNpcHandler().handle(new OpNpc(1, actor.nid), p), `${visibleName} Talk-to click is accepted`);
  assert.equal(p.target, actor);
  assert(p.validateTarget(), `${visibleName} remains the real interaction target`);
  executeSelected(p, `[opnpc1,${visibleName}]`, choices);
  return actor;
}
function setNearLoc(p, loc, fromCurrent = false, filter = () => true) {
  const candidates = approachTiles(p, loc).filter(filter);
  assert(candidates.length, `packed map gives ${types.LocType.get(loc.type).debugname} an operable floor approach`);
  if (fromCurrent) walk(p, candidates[0]);
  else {
    [p.level, p.x, p.z] = candidates[0];
    p.buildArea.rebuild();
  }
  assert(p.inOperableDistance(loc));
}
function checkDoorAxis(tile, loc) {
  if (loc.angle === locNorth || loc.angle === locSouth) return tile[2] === loc.z;
  if (loc.angle === locWest || loc.angle === locEast) return tile[1] === loc.x;
  assert.fail(`door has a known packed orientation ${loc.angle}`);
}
function outsideDoorTile(p, loc) {
  const candidates = approachTiles(p, loc).filter(tile => !checkDoorAxis(tile, loc));
  assert(candidates.length, 'the original shed door has a reachable entering-side floor tile');
  return candidates[0];
}
function clickLoc(p, loc, expectedName) {
  if (!p.inOperableDistance(loc)) setNearLoc(p, loc);
  assert(new OpLocHandler().handle(new OpLoc(1, loc.x, loc.z, loc.type), p), 'production loc click is accepted');
  assert.equal(p.target, loc);
  assert(p.validateTarget(), 'original loc is a valid target');
  executeSelected(p, expectedName);
}
function digAtGrave(p, loc) {
  const usedId = obj('spade');
  const slot = 0;
  p.getInventory(invId).set(slot, { id: usedId, count: 1 });
  const inventoryInterface = types.Component.get(component('inventory:inv'));
  assert(inventoryInterface?.operable, 'the original inventory component accepts held actions');
  p.tabs[3] = inventoryInterface.rootLayer;
  p.invListenOnCom(invId, inventoryInterface.id, p.uid);
  setNearLoc(p, loc);
  const executions = [];
  const execute = p.executeScript;
  p.executeScript = function(state, ...args) {
    executions.push({ state, entryName: state.script.name });
    return execute.call(this, state, ...args);
  };
  try {
    assert(new OpHeldHandler().handle(new OpHeld(1, usedId, slot, inventoryInterface.id), p),
      'the production inventory Dig action is accepted beside the real grave');
  } finally {
    p.executeScript = execute;
  }
  assert.equal(executions.length, 1, 'one Dig action starts one real held-item handler');
  assert.equal(executions[0].entryName, '[opheld1,spade]');
  driveDialogue(p, executions[0].state);
}
function tickTemporaryLocations(ticks) {
  for (let tick = 0; tick < ticks; tick++) {
    World.currentTick++;
    for (const event of [...World.locObjTracker.all()]) if (event.check()) event.entity.turn();
  }
}
function activeLoc(name) {
  const rows = nativeLocRows(name);
  assert(rows.length, `original map has a ${name} placement`);
  return locFor(rows[0]);
}

// The first five distinct gardeners produce the five retained theories. The GAG
// mask is per-player and survives the same native save/load path as quest stages.
let p = player();
const gardener = placedNpc('elstan');
talk(p, 'elstan', [1], { actor: gardener, seedSelector: true });
assert.equal(stage(p), 0, 'an unstarted account cannot use the GAG chase');
const martin = placedNpc('martin_the_master_farmer');
talk(p, 'martin_the_master_farmer', [3, 2], { actor: martin });
assert.equal(stage(p), 0, 'declining Martin does not start the quest');
talk(p, 'martin_the_master_farmer', [1, 1], { actor: martin });
assert.equal(stage(p), 1, 'Martin starts the quest after the player accepts');
p.setVarBit(gardenersQuest, 1); // Existing Garden of Tranquillity prerequisite branch only.
talk(p, 'elstan', [1, 2], { actor: gardener, seedSelector: true });
assert.equal(stage(p), 2, 'first distinct GAG gardener reports rain');
assert.equal(p.getVar(gardenerMaskVarp), 1, 'Elstan has its own permanent player bit');
talk(p, 'elstan', [1, 2], { actor: gardener, seedSelector: true });
assert.equal(stage(p), 2, 'revisiting the same gardener cannot count twice');
assert.equal(p.getVar(gardenerMaskVarp), 1, 'revisiting preserves the exact mask');
p.setVarBit(varbit('garden_lyra_varbit'), 1);
p.setVarBit(varbit('farming_allotment_varp_2_16_23'), 17);
wear(p, 'ring_of_charos_unlocked');
const lyra = placedNpc('lyra');
talk(p, 'lyra', [1, 1], { actor: lyra, seedSelector: true });
assert.equal(stage(p), 2, 'the separate Garden of Tranquillity branch does not advance FT1');
assert.equal(p.getVarBit(varbit('farming_allotment_varp_2_16_23')), 17, 'Lyra inspects the mature local onions without harvesting them');
assert.equal(count(p, 'garden_orchid_pink_seed'), 3, 'the Lyra Garden trade supplies three pink orchid seeds');
assert.equal(count(p, 'garden_orchid_yellow_seed'), 3, 'the Lyra Garden trade supplies three yellow orchid seeds');
talk(p, 'lyra', [1, 2], { actor: lyra, seedSelector: true });
assert.equal(stage(p), 3, 'second distinct GAG gardener reports insects');
const kragen = placedNpc('kragen');
talk(p, 'kragen', [1, 2], { actor: kragen, seedSelector: true });
assert.equal(stage(p), 4, 'third distinct gardener reports adventurers');
const dantaera = placedNpc('dantaera');
talk(p, 'dantaera', [1, 2], { actor: dantaera, seedSelector: true });
assert.equal(stage(p), 5, 'fourth distinct gardener reports seasons');
const francis = placedNpc('francis');
talk(p, 'francis', [1], { actor: francis, seedSelector: true });
assert.equal(stage(p), 6, 'fifth distinct gardener reports fairies');
assert.equal(p.getVar(gardenerMaskVarp), 31, 'five distinct gardener bits are retained');
const spareGardener = placedNpc('farming_gardener_fruit_3');
talk(p, 'farming_gardener_fruit_3', [1], { actor: spareGardener, seedSelector: true });
assert.equal(stage(p), 6, 'a sixth gardener does not advance beyond the five theories');
assert.equal(p.getVar(gardenerMaskVarp), 31, 'a sixth gardener does not corrupt the mask');
let secondPlayer = player(1);
const secondElstan = placedNpc('elstan');
talk(secondPlayer, 'elstan', [1], { actor: secondElstan, seedSelector: true });
assert.equal(stage(secondPlayer), 2, 'a second player independently earns the first theory');
assert.equal(secondPlayer.getVar(gardenerMaskVarp), 1);
assert.equal(p.getVar(gardenerMaskVarp), 31, 'one player cannot complete another player mask');
secondPlayer = relog(secondPlayer);
assert.equal(stage(secondPlayer), 2, 'quest stage survives Player.save/PlayerLoading.load');
assert.equal(secondPlayer.getVar(gardenerMaskVarp), 1, 'visited gardener mask survives Player.save/PlayerLoading.load');
talk(p, 'martin_the_master_farmer', [], { actor: martin });
assert.equal(stage(p), ft1Constant('ft1_martin_reported'), 'Martin receives the fifth report');
assert.equal(p.getVarBit(queenCheck), 1, 'Martin makes the Fairy Queen form visible');
assert.equal(p.getVarBit(godfatherCheck), 1, 'Martin makes the Fairy Godfather form visible');

// The original shed and native loc dispatch enforce a worn Dramen staff.
const shed = activeLoc('zanarisdoor');
const shedTile = outsideDoorTile(p, shed);
const shedTeleport = /\[oploc1,zanarisdoor\][\s\S]*?player_teleport_normal\((0_\d+_\d+_\d+_\d+)\)/.exec(
  fs.readFileSync(path.join(content, 'scripts/quests/quest_zanaris/scripts/quest_zanaris.rs2'), 'utf8'));
assert(shedTeleport, 'checked-out Lost City handler has its original shed destination');
const zanarisArrival = tileFromCoord(shedTeleport[1]);
const noStaff = player();
add(noStaff, 'dramen_staff');
[noStaff.level, noStaff.x, noStaff.z] = shedTile;
noStaff.buildArea.rebuild();
clickLoc(noStaff, shed, '[oploc1,zanarisdoor]');
assert.notDeepEqual([noStaff.level, noStaff.x, noStaff.z], zanarisArrival, 'carried-only Dramen staff cannot enter');
assert.equal(count(noStaff, 'dramen_staff'), 1);
assert.equal(count(noStaff, 'dramen_staff', wornId), 0);
tickTemporaryLocations(5);
add(p, 'dramen_staff');
wear(p, 'dramen_staff');
walk(p, shedTile);
clickLoc(p, activeLoc('zanarisdoor'), '[oploc1,zanarisdoor]');
assert.deepEqual([p.level, p.x, p.z], zanarisArrival, 'worn Dramen staff enters through the real shed');

// The route from the shed arrival is checked tile-by-tile on the packed map.
const godfather = placedNpc('fairy_godfather');
talk(p, 'fairy_godfather', [2], { actor: godfather, fromCurrent: true });
assert.equal(stage(p), ft1Constant('ft1_godfather'), 'the visible Godfather directs the player to Nuff');
const nuff = placedNpc('fairy_nuff');
talk(p, 'fairy_nuff', [], { actor: nuff, fromCurrent: true });
assert.equal(stage(p), ft1Constant('ft1_symptoms'), 'Nuff gives the symptom list');
assert.equal(count(p, 'fairy_symptoms_list'), 1);
fillInventory(p);
talk(p, 'fairy_nuff', [], { actor: nuff });
assert.equal(stage(p), ft1Constant('ft1_symptoms'), 'a full inventory cannot advance or duplicate Nuff symptoms');
assert.equal(count(p, 'fairy_symptoms_list'), 0);
freeInventorySlot(p);
talk(p, 'fairy_nuff', [], { actor: nuff });
assert.equal(count(p, 'fairy_symptoms_list'), 1, 'Nuff replaces the lost list after space is freed');
assert.equal(del(p, 'fairy_symptoms_list'), 1);
fillInventory(p);
talk(p, 'fairy_nuff', [], { actor: nuff });
assert.equal(count(p, 'fairy_symptoms_list'), 0, 'a full inventory cannot recover the lost symptom list');
assert.equal(stage(p), ft1Constant('ft1_symptoms'));
freeInventorySlot(p);
talk(p, 'fairy_nuff', [], { actor: nuff });
assert.equal(count(p, 'fairy_symptoms_list'), 1);
assert.equal(del(p, 'fairy_symptoms_list'), 1);
const zandar = placedNpc('zandar_horfyre');
talk(p, 'zandar_horfyre', [], { actor: zandar });
assert.equal(stage(p), ft1Constant('ft1_symptoms'), 'Zandar cannot diagnose a missing symptom list');
assert.equal(count(p, 'fairy_symptoms_list'), 0);
talk(p, 'fairy_nuff', [], { actor: nuff });
assert.equal(count(p, 'fairy_symptoms_list'), 1);
talk(p, 'zandar_horfyre', [], { actor: zandar });
assert.equal(stage(p), ft1Constant('ft1_zandar'), 'Zandar reads the carried symptoms and directs the player to Mortifer');
assert.equal(count(p, 'fairy_symptoms_list'), 1, 'Zandar reads rather than consumes the list');

// Each period-pool entry occupies each pick position once through native Mortifer
// dispatch. Three bounded RNG draws select distinct ranks without reroll bias.
const mortifer = placedNpc('elemental_wizard_boss');
const pickCoverage = [new Set(), new Set(), new Set()];
for (let choice = 0; choice < availableNatureIndices.length; choice++) {
  const candidate = player(ft1Constant('ft1_skull'));
  add(candidate, 'fairy_skull');
  const poolSize = availableNatureIndices.length;
  const firstRank = choice + 1;
  const secondRank = (choice + 1) % poolSize + 1;
  const thirdRank = (choice + 2) % poolSize + 1;
  const secondRaw = secondRank > firstRank ? secondRank - 1 : secondRank;
  const minRank = Math.min(firstRank, secondRank);
  const maxRank = Math.max(firstRank, secondRank);
  const thirdRaw = thirdRank > maxRank ? thirdRank - 2 : thirdRank > minRank ? thirdRank - 1 : thirdRank;
  withRandom([(choice + 0.25) / poolSize, (secondRaw - 0.25) / (poolSize - 1),
    (thirdRaw - 0.25) / (poolSize - 2)],
  () => talk(candidate, 'elemental_wizard_boss', [], { actor: mortifer }));
  assert.equal(stage(candidate), ft1Constant('ft1_components'), `Mortifer stores pick set ${choice + 1}`);
  assert.equal(count(candidate, 'fairy_skull'), 0, 'Mortifer consumes the Draynor skull once');
  const picks = [1, 2, 3].map(index => candidate.getVarBit(varbit(`fairy_nature_item${index}`)));
  assert.deepEqual(picks, [firstRank, secondRank, thirdRank],
    'bounded ranks map bijectively to all 31 original table indices');
  assert.equal(new Set(picks).size, 3, 'all three persisted picks are distinct');
  picks.forEach((value, index) => pickCoverage[index].add(value));
}
for (const coverage of pickCoverage) {
  assert.deepEqual([...coverage].sort((a, b) => a - b), availableNatureIndices,
    'every period-pool item occurs in each of the three persisted pick positions');
}

// Main path: the grave is selected from its named source coordinate, and the
// spade Dig uses its production held-item packet beside the real map grave.
talk(p, 'elemental_wizard_boss', [], { actor: mortifer });
assert.equal(stage(p), ft1Constant('ft1_skull'), 'Mortifer asks for the original Draynor grave skull');
talk(p, 'elemental_wizard_boss', [], { actor: mortifer });
assert.equal(stage(p), ft1Constant('ft1_skull'), 'a missing skull cannot advance Mortifer');
const graveCoord = tileFromCoord(readConstant('scripts/quests/quest_fairy_farmers/configs/quest_fairy_farmers.constant', 'ft1_skull_grave'));
const graveRow = nativeLocInventory().find(row => row.level === graveCoord[0] && row.x === graveCoord[1] && row.z === graveCoord[2]);
assert(graveRow, 'the original Draynor gravestone is present at the source coordinate');
const grave = locFor(graveRow);
fillInventory(p);
// Keep the earlier enchanted-key hook eligible while digging at the FT1 grave.
p.setVarBit(varbit('makinghistory_prog'), integerConstant('scripts/general/configs/quest.constant', 'makinghistory_complete'));
p.getInventory(invId).set(26, { id: obj('makinghistory_key'), count: 1 });
digAtGrave(p, grave);
assert.equal(stage(p), ft1Constant('ft1_skull'));
assert.equal(count(p, 'fairy_skull'), 0, 'a full inventory cannot take the skull');
freeInventorySlot(p);
digAtGrave(p, grave);
assert.equal(count(p, 'fairy_skull'), 1, 'the reachable grave approach yields one skull');
assert.equal(count(p, 'makinghistory_key'), 1, 'the earlier key hook leaves the held key intact at the skull grave');
assert.equal(p.getVar(varp('enchanted_key_hunt')), 1 << 11,
  'the key hook selects its first target but awards no off-site treasure or completion bit');
// Conversely, an active FT1 skull request cannot pre-empt a real key treasure.
const keyDigger = player(ft1Constant('ft1_skull'));
keyDigger.setVarBit(varbit('makinghistory_prog'), integerConstant('scripts/general/configs/quest.constant', 'makinghistory_complete'));
add(keyDigger, 'makinghistory_key');
add(keyDigger, 'spade');
[keyDigger.level, keyDigger.x, keyDigger.z] = tileFromCoord(readConstant(
  'scripts/quests/miniquest_enchanted_key/configs/enchanted_key.constant', 'ek_site_0'));
runScript('[opheld1,spade]', keyDigger);
assert.equal(keyDigger.getVar(varp('enchanted_key_hunt')), 1, 'the shared Dig awards the first key treasure');
assert.equal(count(keyDigger, 'cert_mithril_ore'), 10);
assert.equal(count(keyDigger, 'steel_arrow'), 20);
assert.equal(count(keyDigger, 'lawrune'), 15);
assert.equal(count(keyDigger, 'fairy_skull'), 0, 'the FT1 skull hook does not award a skull at a key treasure');
assert.equal(stage(keyDigger), ft1Constant('ft1_skull'), 'the key treasure does not change the FT1 request');
withRandom([0.25 / availableNatureIndices.length, 0.75 / (availableNatureIndices.length - 1),
  0.75 / (availableNatureIndices.length - 2)],
() => talk(p, 'elemental_wizard_boss', [], { actor: mortifer }));
assert.equal(stage(p), ft1Constant('ft1_components'), 'Mortifer consumes the skull and saves the component indices');
assert.equal(count(p, 'fairy_skull'), 0);
let picks = [1, 2, 3].map(index => p.getVarBit(varbit(`fairy_nature_item${index}`)));
assert(picks.every(value => value >= 1 && value <= itemNames.length));
assert.equal(new Set(picks).size, 3);
withNoRandom(() => talk(p, 'elemental_wizard_boss', [2], { actor: mortifer }));
assert.deepEqual([1, 2, 3].map(index => p.getVarBit(varbit(`fairy_nature_item${index}`))), picks,
  'Mortifer reminder does not reroll stored items');
p = relog(p);
assert.equal(stage(p), ft1Constant('ft1_components'), 'components stage survives logout/login');
assert.deepEqual([1, 2, 3].map(index => p.getVarBit(varbit(`fairy_nature_item${index}`))), picks,
  'all three component indices survive logout/login');
withNoRandom(() => talk(p, 'elemental_wizard_boss', [2], { actor: mortifer }));
assert.deepEqual([1, 2, 3].map(index => p.getVarBit(varbit(`fairy_nature_item${index}`))), picks,
  'repeated post-login reminders preserve the same component set');

// Nature Spirit blessing is the actual visible Filliman talk handler. Completion
// of Nature Spirit is a prerequisite seed, while the FT1 stage is earned above.
p.setVar(druidQuest, druidComplete);
const grottoEntrance = activeLoc('grotto_door_druidicspirit');
setNearLoc(p, grottoEntrance);
clickLoc(p, grottoEntrance, '[oploc1,grotto_door_druidicspirit]');
assert([...p.queue.all()].some(request => request.script.name === '[queue,ft1_nature_arrive]'),
  'the completed Nature Spirit grotto queues this quest arrival through its real entry handler');
World.currentTick++;
p.processQueues();
const spirit = [...World.npcs].find(actor => actor.type === npcConfig('filliman_tarlock_ns').id && actor.level === p.level);
assert(spirit, 'the real completed-grotto arrival spawns the visible Nature Spirit');
for (let slot = 0; slot < 28; slot++) p.getInventory(invId).set(slot, null);
const requiredItems = [
  'secateurs',
  ...picks.map(value => {
    const valueId = natureItems.values.get(value);
    assert(Number.isInteger(valueId));
    return types.ObjType.get(valueId).debugname;
  })
];
for (const name of requiredItems) assert.equal(add(p, name), 1, `${name} is carried for the blessing test`);
const beforeNoAmulet = requiredItems.map(name => count(p, name));
assert.equal(count(p, 'amulet_of_ghostspeak', wornId), 0, 'Filliman is approached without a worn ghostspeak amulet');
talk(p, 'filliman_tarlock_ns', [], { actor: spirit });
assert.equal(stage(p), ft1Constant('ft1_components'), 'worn ghostspeak is required before the blessing');
assert.deepEqual(requiredItems.map(name => count(p, name)), beforeNoAmulet, 'the no-amulet refusal consumes nothing');
assert.equal(count(p, 'fairy_enchanted_secateurs'), 0);
add(p, 'amulet_of_ghostspeak');
wear(p, 'amulet_of_ghostspeak');
for (const missing of requiredItems) {
  assert.equal(del(p, missing), 1);
  const before = requiredItems.map(name => count(p, name));
  talk(p, 'filliman_tarlock_ns', [], { actor: spirit });
  assert.equal(stage(p), ft1Constant('ft1_components'), `missing ${missing} blocks the ceremony`);
  assert.deepEqual(requiredItems.map(name => count(p, name)), before, `missing ${missing} leaves all remaining inputs untouched`);
  assert.equal(add(p, missing), 1);
}
const beforeBless = requiredItems.map(name => count(p, name));
talk(p, 'filliman_tarlock_ns', [], { actor: spirit });
assert.equal(stage(p), ft1Constant('ft1_enchanted'), 'Nature Spirit blesses the complete item set');
assert.deepEqual(requiredItems.map(name => count(p, name)), beforeBless.map(() => 0), 'the ceremony consumes each required input once');
assert.equal(count(p, 'fairy_enchanted_secateurs'), 1, 'the output is the original magic secateurs object');

// Enter Zanaris again through the real shed and walk from its arrival to the
// visible cosmic-temple gap and spawned owner-specific Tanglefoot.
const grottoExitRow = nativeLocRows('underground_rootwall_door_green').find(row => row.level === p.level);
assert(grottoExitRow, 'the completed grotto has its original visible green exit');
const grottoExit = locFor(grottoExitRow);
setNearLoc(p, grottoExit, true);
clickLoc(p, grottoExit, '[oploc1,underground_rootwall_door_green]');
assert.equal(p.level, shedTile[0], 'the real grotto exit returns to the mainland level');
// Overworld travel setup, as at other distant NPCs; the next local transition
// and the complete Zanaris-to-boss route use their actual packed map and dispatch.
[p.level, p.x, p.z] = shedTile;
p.buildArea.rebuild();
tickTemporaryLocations(5);
clickLoc(p, activeLoc('zanarisdoor'), '[oploc1,zanarisdoor]');
assert.deepEqual([p.level, p.x, p.z], zanarisArrival, 'worn Dramen staff still reaches Zanaris after enchanting');
const gateRows = nativeLocRows('fairy_walls_multi');
assert(gateRows.length, 'the original outer-gap multi root is on the packed map');
const gateRow = gateRows.find(row => approachTiles(p, locFor(row)).some(tile => tile[1] >= splitX));
assert(gateRow, 'the packed outer gap has an operable Zanaris-side approach');
const gate = locFor(gateRow);
const gateType = types.LocType.get(gate.type);
assert.equal(gateType.multivarbit, questStageBit, 'the outer gap follows this quest stage');
assert.equal(gateType.multiloc[stage(p)], id(types.LocType, 'fairy_wall_tangle_door_open'),
  'the player sees the open outer-gap form');
setNearLoc(p, gate, true, tile => tile[1] >= splitX);
const gateTrigger = '[oploc1,fairy_wall_tangle_door_open]';
const innerGateRow = nativeLocRows('fairy_wall_tangle_door_open1')
  .find(row => approachTiles(p, locFor(row)).some(tile => tile[1] < splitX));
assert(innerGateRow, 'the original separate inner gap has an operable cave-side approach');
const innerGate = locFor(innerGateRow);
const innerGateTrigger = '[oploc1,fairy_wall_tangle_door_open1]';
clickLoc(p, gate, gateTrigger);
assert.notDeepEqual([p.level, p.x, p.z], zanarisArrival, 'the actual gap handler moves the player through the entrance');
assert(floorTiles.has(`${p.level},${p.x},${p.z}`), 'gap landing is a real packed-map floor tile');
assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, 'gap landing is not collision-blocked');
const bossType = id(types.NpcType, 'fairy_tanglefoot');
let boss = [...World.npcs].find(actor => actor.type === bossType && actor.getVar(npcAggressivePlayer) === p.uid);
assert(boss, "the gate spawns this player's Tanglefoot through the production encounter proc");
assert(floorTiles.has(`${boss.level},${boss.x},${boss.z}`), 'Tanglefoot spawn lies on original packed floor');
assert.deepEqual([boss.level, boss.x, boss.z],
  tileFromCoord(readConstant('scripts/quests/quest_fairy_farmers/configs/quest_fairy_farmers.constant', 'ft1_boss_spawn')),
  'the encounter is spawned at the current source constant, not a pinned provisional tile');
const bossApproaches = approachTiles(p, boss);
assert(bossApproaches.length, 'packed collision gives the spawned Tanglefoot a reachable approach');
walk(p, bossApproaches[0]);
wear(p, 'bronze_scimitar');
runScript('[proc,player_combat_stat]', p);
showNpc(p, boss);
assert(new OpNpcHandler().handle(new OpNpc(2, boss.nid), p), 'production Attack click accepts the visible Tanglefoot');
assert.equal(p.target, boss);
assert(p.validateTarget());
assert.equal(p.getOpTrigger()?.name, '[opnpc2,fairy_tanglefoot]', 'the visible boss dispatch selects its real Attack handler');
executeSelected(p, '[opnpc2,fairy_tanglefoot]', [], false);

// Only the wielded enchanted secateurs can damage the owner-bound encounter;
// ranged, magic, unarmed, carried-only and wrong-owner inputs all return zero.
const spellId = id(types.DbRowType, 'magic_spell_wind_strike');
const cap = (style, spell = 0, maxhit = 99) => {
  p.setVar(damagesType, style);
  return runScript('[proc,npc_max_dealt]', p, boss, [maxhit, spell])[0];
};
wear(p, 'fairy_enchanted_secateurs');
const wornSecateurs = p.getInventory(wornId).items.find(item => item?.id === obj('fairy_enchanted_secateurs'));
assert(wornSecateurs, 'the combat control wears the actual packed magic secateurs');
const wornSecateursType = types.ObjType.get(wornSecateurs.id);
// CANDIDATE equipment table, retained Magic secateurs revision 14965052.
// These remain in place for every weapon gate, recoil and final fight below.
for (const [name, expected] of Object.entries({
  stabattack: 7, slashattack: 9, crushattack: -5, magicattack: 1, rangeattack: 0,
  stabdefence: 0, slashdefence: 1, crushdefence: 0, magicdefence: 1, rangedefence: 0,
  strengthbonus: 1, rangebonus: 0, prayerbonus: 0
})) {
  assert.equal(wornSecateursType.params?.get(id(types.ParamType, name)), expected,
    `worn magic secateurs carry the candidate ${name} bonus`);
}
p.setVarBit(questStageBit, ft1Constant('ft1_enchanted'));
boss.setVar(npcAggressivePlayer, p.uid);
assert(cap(slashStyle) > 0, 'wielded magic secateurs permit melee damage');
assert.equal(cap(rangedStyle), 0, 'ranged damage is refused');
assert.equal(cap(magicStyle, spellId), 0, 'magic damage is refused');
assert.equal(cap(slashStyle, spellId), 0, 'a spell-tagged hit is refused');
removeWorn(p, 'fairy_enchanted_secateurs');
add(p, 'fairy_enchanted_secateurs');
assert.equal(cap(slashStyle), 0, 'carried magic secateurs do not permit damage');
del(p, 'fairy_enchanted_secateurs');
wear(p, 'secateurs');
assert.equal(cap(slashStyle), 0, 'plain secateurs do not permit damage');
removeWorn(p, 'secateurs');
wear(p, 'bronze_scimitar');
assert.equal(cap(slashStyle), 0, 'another ordinary melee weapon cannot damage the Tanglefoot');
removeWorn(p, 'bronze_scimitar');
assert.equal(cap(slashStyle), 0, 'unarmed melee damage is refused');
wear(p, 'fairy_enchanted_secateurs');
p.setVarBit(questStageBit, ft1Constant('ft1_components'));
assert.equal(cap(slashStyle), 0, 'pre-enchantment stage cannot damage the boss');
p.setVarBit(questStageBit, ft1Constant('ft1_enchanted'));
boss.setVar(npcAggressivePlayer, p.uid + 1);
assert.equal(cap(slashStyle), 0, 'another player cannot damage this owned encounter');
boss.setVar(npcAggressivePlayer, p.uid);

// The Tanglefoot's actual AI attack is capped at the packed quest max hit.
assert.equal(runScript('[proc,npc_melee_maxhit]', boss, p)[0], ft1Constant('ft1_tanglefoot_maxhit'),
  'the normal melee formula reaches the sourced maximum without an outcome opt-in');
p.setVar(aggressiveNpc, boss.uid);
boss.setVar(attackingUid, p.uid);
boss.setVar(npcActionDelay, 0);
const hpQueueStart = [...p.queue.all()].filter(request => request.script.name === '[queue,combat_damage_player]').length;
withRandom([0.999999, 0, 0.999999], () => runScript('[ai_opplayer2,fairy_tanglefoot]', boss, p));
const attackQueue = [...p.queue.all()].filter(request => request.script.name === '[queue,combat_damage_player]').slice(hpQueueStart);
assert.equal(attackQueue.length, 1, 'the visible Tanglefoot AI produces one real player-damage queue');
assert.equal(attackQueue[0].args[0], ft1Constant('ft1_tanglefoot_maxhit'), 'the maximum RNG draw delivers the sourced Tanglefoot maximum');
attackQueue[0].unlink();

// The poison timer clears poison rather than damaging the boss.
runScript('[proc,npc_poison_start]', p, boss, [20]);
assert.equal(boss.getVar(npcPoison), 20, 'production poison-start proc reaches the NPC');
const hpBeforePoisonTimer = boss.levels[NpcStat.HITPOINTS];
runScript('[ai_timer,fairy_tanglefoot]', boss, p);
assert.notEqual(boss.getVar(npcPoison), 20, 'Tanglefoot timer clears active poison');
assert.equal(boss.levels[NpcStat.HITPOINTS], hpBeforePoisonTimer, 'Tanglefoot poison timer deals no poison damage');

// Ring recoil remains an ordinary combat route and still damages this boss.
const recoilType = types.ObjType.get(obj('ring_of_recoil'));
p.getInventory(wornId).set(recoilType.wearpos, { id: recoilType.id, count: 1 });
p.setVar(aggressiveNpc, boss.uid);
boss.setVar(attackingUid, p.uid);
boss.setVar(npcActionDelay, 0);
const bossHpBeforeRecoil = boss.levels[NpcStat.HITPOINTS];
withRandom([0.999999, 0, 0.999999], () => runScript('[ai_opplayer2,fairy_tanglefoot]', boss, p));
World.currentTick++;
p.processQueues();
assert([...boss.queue.all()].some(request => request.queueId === ServerTriggerType.AI_QUEUE2 && request.lastInt > 0),
  'normal ring-of-recoil player damage queues positive damage back to the attacking boss');
World.currentTick++;
boss.turn();
assert(boss.levels[NpcStat.HITPOINTS] < bossHpBeforeRecoil, 'recoil damage is not blocked by the Tanglefoot secateurs rule');

// Exercise the real player melee label for the final hit and the real NPC death
// trigger for the queen-secateurs ground drop and once-only quest hand-off.
p.getInventory(wornId).set(recoilType.wearpos, null);
wear(p, 'fairy_enchanted_secateurs');
for (const mode of [0, 1, 2, 3]) {
  p.setVar(varp('com_mode'), mode);
  runScript('[proc,player_combat_stat]', p);
  assert(p.getVar(varp('com_attackanim')) >= 0, `secateurs style ${mode} selects a real swing animation`);
  assert(p.getVar(varp('com_attacksound')) >= 0, `secateurs style ${mode} selects a real attack sound`);
  assert(cap(p.getVar(damagesType)) > 0, `secateurs style ${mode} permits melee damage`);
}
p.setVar(varp('com_mode'), 0);
runScript('[proc,player_combat_stat]', p);
boss.levels[NpcStat.HITPOINTS] = 1;
boss.setVar(npcAggressivePlayer, p.uid);
World.currentTick = Math.max(World.currentTick + 1, p.getVar(varp('action_delay')));
const dropped = [];
const addObj = World.addObj;
World.addObj = function(object, receiver, duration) {
  dropped.push({ id: object.type, count: object.count, x: object.x, z: object.z, level: object.level });
  return addObj.call(this, object, receiver, duration);
};
try {
  withRandom([0.999999, 0, 0.999999], () => runScript('[label,player_melee_attack]', boss, p));
  for (let turn = 0; turn < 8 && boss.isActive; turn++) {
    World.currentTick++;
    boss.turn();
  }
} finally {
  World.addObj = addObj;
}
assert(dropped.some(drop => drop.id === obj('fairy_queen_secateurs')), 'boss death drops the Queen secateurs at its real encounter tile');
const completionRequest = [...p.queue.all()].find(request => request.script.name === '[queue,ft1_tanglefoot_defeated]');
assert(completionRequest, 'boss death queues the player-specific defeated stage');
World.currentTick++;
p.processQueues();
assert(![...p.queue.all()].includes(completionRequest), 'the real player queue processes the defeated-stage handoff');
assert.equal(stage(p), ft1Constant('ft1_defeated'), 'boss death writes the defeated stage once');
assert.equal(count(p, 'fairy_queen_secateurs'), 0, 'the Queen secateurs remain a ground drop until recovered');

// Walk out, re-enter from the Zanaris side and recover the ground reward at the
// gap; then the visible Nuff/Godfather handlers complete the quest exactly once.
const westApproach = approachTiles(p, innerGate).find(tile => tile[1] < splitX);
assert(westApproach, 'packed inner gap has an operable inside approach');
walk(p, westApproach);
clickLoc(p, innerGate, innerGateTrigger);
const eastApproach = approachTiles(p, gate).find(tile => tile[1] >= splitX);
assert(eastApproach, 'packed gap has an operable Zanaris-side approach');
walk(p, eastApproach);
clickLoc(p, gate, gateTrigger);
assert.equal(stage(p), ft1Constant('ft1_defeated'));
assert.equal(count(p, 'fairy_queen_secateurs'), 1, 'the actual gap recovery returns the Queen secateurs');
const westAgain = approachTiles(p, innerGate).find(tile => tile[1] < splitX);
walk(p, westAgain);
clickLoc(p, innerGate, innerGateTrigger);
talk(p, 'fairy_nuff', [], { actor: nuff, fromCurrent: true });
assert.equal(stage(p), ft1Constant('ft1_defeated'), 'Nuff sends the recovered secateurs to the Godfather');
assert.equal(count(p, 'fairy_queen_secateurs'), 1);
runScript('[proc,update_questpoints]', p); // Include the seeded prerequisite quests in the baseline.
const xpBefore = [PlayerStat.FARMING, PlayerStat.ATTACK, PlayerStat.MAGIC].map(stat => p.stats[stat]);
const qpBefore = p.getVar(questPoints);
talk(p, 'fairy_godfather', [], { actor: godfather, fromCurrent: true });
assert.equal(stage(p), completeStage, 'the Godfather accepts the recovered Queen secateurs and completes FT1');
assert.equal(count(p, 'fairy_queen_secateurs'), 0, 'the Godfather consumes the Queen secateurs');
assert.equal(count(p, 'fairy_enchanted_secateurs', wornId), 1, 'the player keeps the magic secateurs');
for (const [index, stat] of [PlayerStat.FARMING, PlayerStat.ATTACK, PlayerStat.MAGIC].entries()) {
  assert.equal(p.stats[stat] - xpBefore[index], [35000, 20000, 10000][index] * Environment.NODE_XPRATE,
    'period reward XP is delivered in tenths');
}
assert.equal(p.getVar(questPoints) - qpBefore, 2, 'exactly two quest points are awarded');
assert.equal(p.modalMain, component('questscroll_death'), 'completion opens the original quest scroll');
assert(packetText(p).includes(completeText), 'quest scroll announces completion');
p.closeModal();
const completedStats = p.stats.slice();
talk(p, 'fairy_godfather', [], { actor: godfather });
assert.equal(stage(p), completeStage, 'completed quest cannot re-enter an earlier stage');
assert.deepEqual(p.stats, completedStats, 'replay grants no duplicate XP');
assert.equal(p.getVar(questPoints) - qpBefore, 2, 'replay grants no duplicate quest points');
assert.equal(count(p, 'fairy_enchanted_secateurs', wornId), 1, 'replay leaves the magic secateurs equipped');
await verifyIngredientSources({
  content, engine, World, types, ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType,
  nativeNpcRows, nativeLocRows, player, withRandom, add, count, obj, driveDialogue, JavaRandom, druidComplete, integerConstant, setNearLoc
});
console.log('PASS Fairytale I packed quest stages, real visible-form/map dispatch, all 31 item choices and producers, combat and completion');
process.exit(0);
