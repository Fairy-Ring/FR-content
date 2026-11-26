#!/usr/bin/env node
// Packed-runtime Zogre Flesh Eaters regression: production handlers, maps, collision and ScriptRunner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BlockWalk, EntityLifeCycle, IfSetText, MessageGame, Npc, Player, PlayerStatMap,
  ResumePauseButton, ResumePauseButtonHandler, ScriptProvider, ScriptRunner, ScriptState,
  ServerTriggerType, World, content, engine, floorTiles, locFor, map, nativeLocRows,
  nativeNpcRows, tileOf, types, walkable
} from '../regicide-travel/runtime.mjs';

const load = async relative => (await import(pathToFileURL(path.join(engine, 'src', relative)).href)).default;
const Environment = await load('util/Environment.ts');
const JavaRandom = await load('util/JavaRandom.ts');
const ScriptPointer = await load('engine/script/ScriptPointer.ts');
const { PlayerStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const { NpcStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/NpcStat.ts')).href);
const rsbuf = await import(pathToFileURL(path.join(engine, 'src/network/rsbuf/index.ts')).href);
const OpNpc = await load('network/game/client/model/OpNpc.ts');
const OpNpcHandler = await load('network/game/client/handler/OpNpcHandler.ts');
const OpNpcU = await load('network/game/client/model/OpNpcU.ts');
const OpNpcUHandler = await load('network/game/client/handler/OpNpcUHandler.ts');
const OpLoc = await load('network/game/client/model/OpLoc.ts');
const OpLocHandler = await load('network/game/client/handler/OpLocHandler.ts');
const OpLocU = await load('network/game/client/model/OpLocU.ts');
const OpLocUHandler = await load('network/game/client/handler/OpLocUHandler.ts');
const OpObj = await load('network/game/client/model/OpObj.ts');
const OpObjHandler = await load('network/game/client/handler/OpObjHandler.ts');
const OpHeld = await load('network/game/client/model/OpHeld.ts');
const OpHeldHandler = await load('network/game/client/handler/OpHeldHandler.ts');
const OpHeldU = await load('network/game/client/model/OpHeldU.ts');
const OpHeldUHandler = await load('network/game/client/handler/OpHeldUHandler.ts');
const IfButton = await load('network/game/client/model/IfButton.ts');
const IfButtonHandler = await load('network/game/client/handler/IfButtonHandler.ts');

Environment.NODE_MEMBERS = true;
Environment.NODE_XPRATE = 1;
assert(World.gameMap.getTotalLocs() > 0, 'complete packed world is loaded');

const invId = id(types.InvType, 'inv');
const bankId = id(types.InvType, 'bank');
const wornId = id(types.InvType, 'worn');
const inventoryCom = types.Component.get(id(types.Component, 'inventory:inv'));
assert(inventoryCom?.usable && inventoryCom.operable, 'inventory is the packed usable/operable component');
const pauseHandler = new ResumePauseButtonHandler();
const choiceHandler = new IfButtonHandler();
const npcHandler = new OpNpcHandler();
const npcUseHandler = new OpNpcUHandler();
const locHandler = new OpLocHandler();
const locUseHandler = new OpLocUHandler();
const objHandler = new OpObjHandler();
const heldHandler = new OpHeldHandler();
const heldUseHandler = new OpHeldUHandler();
const stage = { accepted: 1, wizardEvidence: 2, searchPermission: 3, signedPortrait: 4,
  potionEvidence: 5, teaDosed: 6, confession: 7, badNews: 10, bossActive: 11,
  bossDefeated: 12, complete: 13 };
const questComplete = integerConstant('scripts/general/configs/quest.constant', 'zogre_complete');
const questPointsAward = 1;
const rewardXp = 20000;
const balmXp = integerConstant('scripts/quests/quest_zogre/configs/quest_zogre.constant', 'zogre_balm_xp');
const attackDelay = id(types.VarPlayerType, 'action_delay');
const npcAttackingUid = id(types.VarNpcType, 'npc_attacking_uid');
const npcMacroEventTarget = id(types.VarNpcType, 'npc_macro_event_target');
const questScroll = id(types.Component, 'questscroll_death');
const inventorySize = types.InvType.get(invId).size;
assert.equal(inventorySize, 28, 'the ordinary inventory has the packed 28 slots');
assert.equal(questComplete, stage.complete, 'the quest-list completion value agrees with the assigned Zogre stage contract');
assert.equal(integerConstant('scripts/general/configs/quest.constant', 'zogre_questpoints'), questPointsAward,
  'the registered period Zogre quest-point constant is one');
assert.equal(integerConstant('scripts/quests/quest_zogre/configs/quest_zogre.constant', 'zogre_reward_xp'), rewardXp,
  'the registered period XP constant represents 2,000 XP in tenths');
for (const name of [
  'zogre_necromantic_page', 'zogre_black_prism', 'zogre_dragon_tankard',
  'zogre_brentle_vahn_backpack', 'zogre_sithik_portrait_bad', 'zogre_sithik_portrait_good',
  'zogre_sithik_portrait_signed', 'zogre_portrait_book', 'zogre_artifacts', 'zogre_hambook',
  'zogre_ogre_trans_potion', 'zogre_necrobook', 'zogre_cup_of_tea_sithix', 'zogre_tomb_artefact_key'
]) {
  assert.equal(types.ObjType.get(obj(name)).tradeable, false, `${name} remains an untradeable quest item`);
}
function id(Type, name) {
  const value = Type.getId(name);
  assert(Number.isInteger(value) && value >= 0, `missing packed ${Type.name ?? 'config'} ${name}`);
  return value;
}
function obj(name) { return id(types.ObjType, name); }
function varp(name) { return id(types.VarPlayerType, name); }
function varbit(name) { return id(types.VarBitType, name); }
function integerConstant(relative, name) {
  const source = fs.readFileSync(path.join(content, relative), 'utf8');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\s*\\^${escaped}\\s*=\\s*(-?\\d+)`, 'm').exec(source);
  assert(match, `checked-out constant ${name} exists in ${relative}`);
  const value = Number(match[1]);
  assert(Number.isInteger(value), `${name} is an integer constant`);
  return value;
}
function script(name) {
  const result = ScriptProvider.getByName(name);
  assert(result, `missing packed script ${name}`);
  return result;
}
function source(relative) { return fs.readFileSync(path.join(content, relative), 'utf8'); }
function varpValue(player, name, value) {
  const index = varp(name);
  if (value !== undefined) player.setVar(index, value);
  return player.getVar(index);
}
function bit(player, name, value) {
  const index = varbit(name);
  if (value !== undefined) player.setVarBit(index, value);
  return player.getVarBit(index);
}
function count(player, name, inventory = invId) { return player.invTotal(inventory, obj(name)); }
function add(player, name, amount = 1) { player.invAdd(invId, obj(name), amount); }
function del(player, name, amount = 1) { player.invDel(invId, obj(name), amount); }
function itemSlot(player, name) {
  const slot = player.getInventory(invId).getItemIndex(obj(name));
  assert.notEqual(slot, -1, `${name} is in the player's inventory`);
  return slot;
}
function clearOutput(player) {
  player.packets.length = 0;
  player.messages.length = 0;
}
function text(player) {
  const packetText = player.packets.filter(packet => packet instanceof IfSetText || packet instanceof MessageGame)
    .map(packet => packet instanceof MessageGame ? packet.msg : packet.text);
  return [...player.messages, ...packetText].join('\n').replace(/\s+/g, ' ').trim();
}

let playerSerial = 0;
function playerAt(tile) {
  const serial = ++playerSerial;
  const player = new Player(`zogre_test_${serial}`, BigInt(5000 + serial), BigInt(7000 + serial));
  player.pid = serial;
  player.slot = serial;
  player.uid = ((5000 + serial) << 11) | serial;
  player.vars.fill(0);
  player.isActive = true;
  [player.level, player.x, player.z] = tile;
  player.baseLevels.fill(99);
  player.levels.fill(99);
  player.stats.fill(130344310);
  player.packets = [];
  player.messages = [];
  player.write = packet => player.packets.push(packet);
  player.messageGame = message => player.messages.push(String(message));
  player.wrappedMessageGame = player.messageGame;
  player.getInventory(invId);
  player.getInventory(wornId);
  player.tabs[3] = inventoryCom.rootLayer;
  player.invListenOnCom(invId, inventoryCom.id, player.uid);
  World.players[player.slot] = player;
  World.playerLoop.add(player.hash64, player);
  rsbuf.addPlayer(player.slot);
  player.buildArea.rebuild();
  return player;
}
function nativeNpc(name, index = 0) {
  const rows = nativeNpcRows(name);
  assert(rows.length > index, `native packed NPC placement exists: ${name}`);
  return rows[index];
}
function spawnNpc(row) {
  const existing = [...World.npcs].find(actor => actor.type === row.id && actor.level === row.level && actor.x === row.x && actor.z === row.z);
  if (existing) return existing;
  const type = types.NpcType.get(row.id);
  const nid = World.npcs.next();
  const actor = new Npc(row.level, row.x, row.z, type.size, type.size, EntityLifeCycle.RESPAWN, nid, type.id, BlockWalk.NONE);
  actor.lastMovement = -100;
  World.addNpc(actor, -1);
  return actor;
}
function npcAt(name, index = 0) { return spawnNpc(nativeNpc(name, index)); }
function activeNpcNear(name, tile, radius = 16) {
  const type = id(types.NpcType, name);
  const candidates = [...World.npcs].filter(actor =>
    actor.isActive && actor.type === type && actor.level === tile[0] &&
    Math.max(Math.abs(actor.x - tile[1]), Math.abs(actor.z - tile[2])) <= radius);
  candidates.sort((a, b) =>
    Math.max(Math.abs(a.x - tile[1]), Math.abs(a.z - tile[2])) -
    Math.max(Math.abs(b.x - tile[1]), Math.abs(b.z - tile[2])));
  assert(candidates.length, `an active ${name} is present near ${tile.join(',')}`);
  return candidates[0];
}
function locRow(name, index = 0) {
  const rows = nativeLocRows(name);
  assert(rows.length > index, `native packed loc placement exists: ${name}`);
  return rows[index];
}
function asLoc(value) { return 'type' in value ? value : locFor(value); }
function visibleLocName(player, locOrRow) {
  const loc = asLoc(locOrRow);
  let type = types.LocType.get(loc.type);
  if (type.multivarp !== -1) {
    const state = player.getVar(type.multivarp);
    if (state >= 0 && state < type.multiloc.length && type.multiloc[state] !== -1) type = types.LocType.get(type.multiloc[state]);
  } else if (type.multivarbit !== -1) {
    const state = player.getVarBit(type.multivarbit);
    if (state >= 0 && state < type.multiloc.length && type.multiloc[state] !== -1) type = types.LocType.get(type.multiloc[state]);
  }
  return type.debugname;
}
function npcFootprint(actor, label) {
  for (let x = actor.x; x < actor.x + actor.width; x++) {
    for (let z = actor.z; z < actor.z + actor.length; z++) walkable([actor.level, x, z], `${label} footprint ${x},${z}`);
  }
  return tileOf(actor);
}

function approachTiles(player, target, radius = 10) {
  const original = tileOf(player);
  const result = [];
  for (let x = target.x - radius; x <= target.x + target.width + radius; x++) {
    for (let z = target.z - radius; z <= target.z + target.length + radius; z++) {
      const tile = [target.level, x, z];
      if (!floorTiles.has(tile.join(',')) || map.isMapBlocked(x, z, target.level)) continue;
      [player.level, player.x, player.z] = tile;
      if (player.inOperableDistance(target)) result.push(tile);
    }
  }
  [player.level, player.x, player.z] = original;
  result.sort((a, b) => Math.abs(a[1] - target.x) + Math.abs(a[2] - target.z) - Math.abs(b[1] - target.x) - Math.abs(b[2] - target.z) || a[1] - b[1] || a[2] - b[2]);
  return result;
}
function placeAtApproach(player, target, label) {
  const actual = asLoc(target);
  const approaches = approachTiles(player, actual);
  assert(approaches.length, `${label} has a real packed-map approach`);
  [player.level, player.x, player.z] = approaches[0];
  player.buildArea.rebuild();
  walkable(tileOf(player), `${label} fixture approach`);
  return tileOf(player);
}
const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function findPathToAny(start, destinations, maxDistance = 256) {
  const wanted = new Set(destinations.map(tile => `${tile[1]},${tile[2]}`));
  const startKey = `${start[1]},${start[2]}`;
  const queue = [[start[1], start[2]]];
  const previous = new Map([[startKey, null]]);
  let found = wanted.has(startKey) ? startKey : null;
  for (let next = 0; next < queue.length && !found; next++) {
    const [x, z] = queue[next];
    for (const [dx, dz] of directions) {
      const nx = x + dx, nz = z + dz, key = `${nx},${nz}`;
      if (previous.has(key) || Math.max(Math.abs(nx - start[1]), Math.abs(nz - start[2])) > maxDistance) continue;
      if (!floorTiles.has(`${start[0]},${nx},${nz}`)) continue;
      if (!map.canTravel(start[0], x, z, dx, dz, 1, 0, map.CollisionType?.NORMAL ?? 0)) continue;
      previous.set(key, `${x},${z}`);
      queue.push([nx, nz]);
      if (wanted.has(key)) { found = key; break; }
    }
  }
  if (!found) return null;
  const reverse = [];
  for (let key = found; key !== null; key = previous.get(key)) {
    const [x, z] = key.split(',').map(Number);
    reverse.push([start[0], x, z]);
  }
  return reverse.reverse();
}
let floorLinks = [];
function walkTo(player, target, filter = () => true) {
  travelFloors(player, target, filter);
  assert.equal(player.level, target.level, 'packed walk remains on one level');
  const approaches = approachTiles(player, target).filter(filter);
  assert(approaches.length, `packed collision map gives an operable approach to ${target.debugname ?? target.name ?? target.type}`);
  const route = findPathToAny(tileOf(player), approaches);
  assert(route, `packed collision map has a walk route to ${target.debugname ?? target.name ?? target.type}`);
  for (const tile of route.slice(1)) {
    const dx = tile[1] - player.x, dz = tile[2] - player.z;
    assert(map.canTravel(player.level, player.x, player.z, dx, dz, 1, 0, map.CollisionType?.NORMAL ?? 0), 'each route step passes packed collision');
    player.x = tile[1];
    player.z = tile[2];
  }
  player.buildArea.rebuild();
  assert(player.inOperableDistance(target), 'the destination is a genuine client interaction tile');
  return route.length - 1;
}
function travelFloors(player, target, filter) {
  const targets = approachTiles(player, target).filter(filter);
  assert(targets.length, 'the target has a genuine packed-map interaction approach');
  const start = tileOf(player);
  if (start[0] === target.level && findPathToAny(start, targets)) return;
  const queue = [{ tile: start, links: [] }];
  const visited = new Set([start.join(',')]);
  const approaches = floorLinks.map(link => approachTiles(player, link.loc));
  let route = null;
  for (let next = 0; next < queue.length && !route; next++) {
    const current = queue[next];
    if (current.tile[0] === target.level && findPathToAny(current.tile, targets)) { route = current.links; break; }
    for (const [index, link] of floorLinks.entries()) {
      if (link.loc.level !== current.tile[0] || visited.has(link.to.join(','))) continue;
      if (!findPathToAny(current.tile, approaches[index])) continue;
      visited.add(link.to.join(','));
      queue.push({ tile: link.to, links: [...current.links, link] });
    }
  }
  assert(route, `native stairs connect the player to ${target.debugname ?? target.type} at ${target.level},${target.x},${target.z}`);
  for (const link of route) {
    interactLoc(player, link.loc, 1, link.trigger);
    assert.deepEqual(tileOf(player), link.to, `${link.trigger} uses its checked-out production landing`);
    walkable(link.to, `${link.trigger} landing`);
  }
}

function advanceTo(tick = World.currentTick + 1) {
  while (World.currentTick < tick) {
    World.currentTick++;
    // Native loc/obj turns restore timed gates and process ground-object lifecycles.
    World.processZones();
  }
}

function driveState(player, state, choices = []) {
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 500; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, `${state.script?.name ?? 'packed script'} does not abort`);
    if (state.execution === ScriptState.SUSPENDED) {
      advanceTo(Math.max(World.currentTick + 1, player.delayedUntil ?? 0));
      player.delayed = false;
      player.executeScript(state, true, true);
    } else if (state.execution === ScriptState.PAUSEBUTTON) {
      const root = player.modalChat >= 0 ? types.Component.get(player.modalChat)?.comName ?? '' : '';
      if (/^multi[2-5]$/.test(root)) {
        const choice = choices.shift();
        assert(Number.isInteger(choice), `${state.script?.name ?? 'dialogue'} has an explicitly supplied ${root} choice`);
        const component = id(types.Component, `${root}:com_${choice + 1}`);
        assert(player.resumeButtons.includes(component), `${root} visibly offers the selected option`);
        assert(choiceHandler.handle(new IfButton(component), player), 'production visible-button handler accepts the option');
      } else {
        assert(pauseHandler.handle(new ResumePauseButton(0), player), 'production Continue handler accepts the dialogue');
      }
    } else {
      assert.fail(`unexpected packed script suspension ${state.execution}`);
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, `${state.script?.name ?? 'packed script'} finishes within the offline dialogue bound`);
  assert.equal(choices.length, 0, 'all expected player choices were consumed');
  player.delayed = false;
  return state;
}
function runInteraction(player, expectedName, choices, invoke) {
  const executions = [];
  const original = player.executeScript;
  player.executeScript = function(state, ...args) {
    executions.push({ name: state.script?.name, state });
    return original.call(this, state, ...args);
  };
  try { invoke(); }
  finally { player.executeScript = original; }
  const state = executions.find(value => value.name === expectedName)?.state;
  assert(state, `production interaction executes the packed handler ${expectedName}`);
  return driveState(player, state, choices);
}
function showNpc(player, actor) {
  player.buildArea.rebuild();
  const appearance = player.generateAppearance();
  rsbuf.computePlayer(player.x, player.level, player.z, player.originX, player.originZ, player.slot, player.tele, player.jump,
    player.runDir, player.walkDir, player.visibility, player.isActive, player.masks, appearance, player.lastAppearance,
    player.faceEntity, player.faceSquareX, player.faceSquareZ, player.faceAngleX, player.faceAngleZ,
    player.hitmarkDamage, player.hitmarkType, player.hitmark2Damage, player.hitmark2Type,
    player.levels[PlayerStat.HITPOINTS], player.baseLevels[PlayerStat.HITPOINTS], player.animId, player.animDelay,
    player.sayMessage, player.chatMessage, player.chatColour ?? -1, player.chatEffect ?? -1, player.chatRights ?? 0,
    player.spotanimId, player.spotanimHeight, player.spotanimTime);
  rsbuf.computeNpc(actor.x, actor.level, actor.z, actor.nid, actor.type, actor.tele, actor.jump,
    actor.runDir, actor.walkDir, actor.isActive, actor.masks, actor.faceEntity,
    actor.faceSquareX, actor.faceSquareZ, actor.faceAngleX, actor.faceAngleZ,
    actor.hitmarkDamage, actor.hitmarkType, actor.hitmark2Damage, actor.hitmark2Type,
    actor.levels[NpcStat.HITPOINTS], actor.baseLevels[NpcStat.HITPOINTS], actor.animId,
    actor.animDelay, actor.sayMessage, actor.spotanimId, actor.spotanimHeight, actor.spotanimTime);
  rsbuf.npcInfo(0, player.slot, 0, 0, true);
  assert(rsbuf.hasNpc(player.slot, actor.nid), 'real map NPC is visible to the client packet path');
}
function interactNpc(player, actor, option, expectedName, choices = []) {
  walkTo(player, actor);
  showNpc(player, actor);
  assert(npcHandler.handle(new OpNpc(option, actor.nid), player), 'production NPC packet accepts the visible NPC');
  assert.equal(player.target, actor);
  assert(player.validateTarget(), 'native NPC remains the interaction target');
  assert.equal(player.getOpTrigger()?.name, expectedName, 'visible NPC dispatch selects its packed handler');
  return runInteraction(player, expectedName, choices, () => player.processInteraction());
}
function talkNpc(player, actor, expectedName, choices = []) { return interactNpc(player, actor, 1, expectedName, choices); }
function useItemOnNpc(player, itemName, actor, expectedName) {
  walkTo(player, actor);
  showNpc(player, actor);
  const itemId = obj(itemName), slot = itemSlot(player, itemName);
  assert(npcUseHandler.handle(new OpNpcU(actor.nid, itemId, slot, inventoryCom.id), player), 'production item-on-NPC packet accepts the visible target and held item');
  assert.equal(player.lastUseItem, itemId);
  assert.equal(player.target, actor);
  assert(player.validateTarget(), 'native item-on-NPC target remains valid');
  assert.equal(player.getOpTrigger()?.name, expectedName, 'item-on-NPC dispatch resolves the packed trigger');
  return runInteraction(player, expectedName, [], () => player.processInteraction());
}
function interactLoc(player, locOrRow, option, expectedName, choices = [], filter = () => true) {
  const loc = asLoc(locOrRow);
  walkTo(player, loc, filter);
  assert(locHandler.handle(new OpLoc(option, loc.x, loc.z, loc.type), player), 'production loc packet accepts the visible map location');
  assert.equal(player.target, loc);
  assert(player.validateTarget(), 'native location remains the interaction target');
  assert.equal(player.getOpTrigger()?.name, expectedName, 'loc dispatch resolves its current visible form');
  return runInteraction(player, expectedName, choices, () => player.processInteraction());
}
function useItemOnLoc(player, itemName, locOrRow, expectedName) {
  const loc = asLoc(locOrRow);
  walkTo(player, loc);
  const itemId = obj(itemName), slot = itemSlot(player, itemName);
  assert(locUseHandler.handle(new OpLocU(loc.x, loc.z, loc.type, itemId, slot, inventoryCom.id), player), 'production item-on-loc packet accepts the target and held item');
  assert.equal(player.lastUseItem, itemId, 'the engine records the selected held item');
  assert.equal(player.target, loc);
  assert(player.validateTarget(), 'native item-on-loc target remains valid');
  assert.equal(player.getOpTrigger()?.name, expectedName, 'item-on-loc dispatch resolves the visible packed form');
  return runInteraction(player, expectedName, [], () => player.processInteraction());
}
function useItemOnItem(player, usedName, targetName, expectedName, choices = []) {
  const usedId = obj(usedName), targetId = obj(targetName);
  const usedSlot = itemSlot(player, usedName), targetSlot = itemSlot(player, targetName);
  return runInteraction(player, expectedName, choices, () => {
    assert(heldUseHandler.handle(new OpHeldU(targetId, targetSlot, inventoryCom.id, usedId, usedSlot, inventoryCom.id), player),
      `production Use ${usedName} on ${targetName} packet is accepted`);
    assert.deepEqual(
      [[player.lastItem, player.lastSlot], [player.lastUseItem, player.lastUseSlot]].sort((a, b) => a[0] - b[0]),
      [[targetId, targetSlot], [usedId, usedSlot]].sort((a, b) => a[0] - b[0]),
      'native immediate dispatch preserves both held item/slot pairs when normalizing their order');
  });
}
function heldOption(player, itemName, option, expectedName) {
  const itemId = obj(itemName), slot = itemSlot(player, itemName);
  const executions = [];
  const original = player.executeScript;
  player.executeScript = function(state, ...args) {
    executions.push({ name: state.script?.name, state });
    return original.call(this, state, ...args);
  };
  let accepted;
  try { accepted = heldHandler.handle(new OpHeld(option, itemId, slot, inventoryCom.id), player); }
  finally { player.executeScript = original; }
  assert(accepted, `${itemName} option ${option} packet is accepted by the production held-item handler`);
  const state = executions.find(value => value.name === expectedName)?.state;
  assert(state, `production held-item dispatch executes ${expectedName}`);
  return driveState(player, state, []);
}
function pickGround(player, ground, itemName) {
  walkTo(player, ground);
  const option = types.ObjType.get(ground.type).op.findIndex(value => value === 'Take') + 1;
  assert(option > 0, `${itemName} has a packed ground Take option`);
  assert(objHandler.handle(new OpObj(option, ground.x, ground.z, ground.type), player), 'production Take packet accepts the real ground item');
  assert.equal(player.target, ground);
  const trigger = player.getOpTrigger();
  assert.equal(trigger?.name, '[opobj3,_]', 'the visible Take option selects the shared packed pickup handler');
  runInteraction(player, trigger.name, [], () => player.processInteraction());
  assert(count(player, itemName) > 0, 'production ground-item interaction places the dropped item in inventory');
}
function runPacked(name, self, target = null, args = []) {
  const state = ScriptRunner.init(script(name), self, target, args);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  if (self instanceof Player) self.executeScript(state, true, true);
  else self.executeScript(state);
  assert.equal(state.execution, ScriptState.FINISHED, `${name} finishes through the packed script runner`);
  return state;
}
function countQuestPoints(player) { return runPacked('[proc,count_questpoints]', player).popInt(); }
function withRandom(valueOrValues, action) {
  const original = JavaRandom.nextDouble;
  let index = 0;
  const values = Array.isArray(valueOrValues) ? valueOrValues : [valueOrValues];
  JavaRandom.nextDouble = () => values[index++ % values.length];
  try { return action(); }
  finally { JavaRandom.nextDouble = original; }
}
function setCombat(player) {
  player.setVar(varp('com_mode'), 0);
  const state = ScriptRunner.init(script('[proc,player_combat_stat]'), player);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  player.executeScript(state, true, true);
  assert.equal(state.execution, ScriptState.FINISHED, 'packed player combat stat setup finishes');
}
function attackNpc(player, actor) {
  walkTo(player, actor);
  showNpc(player, actor);
  assert(npcHandler.handle(new OpNpc(2, actor.nid), player), 'production Attack packet accepts the visible NPC');
  assert.equal(player.target, actor);
  assert(player.validateTarget(), 'attacked NPC remains the interaction target');
  const trigger = player.getOpTrigger();
  assert(trigger && trigger.name.startsWith('[opnpc2,'), 'visible Attack option resolves a packed engine trigger');
  runInteraction(player, trigger.name, [], () => player.processInteraction());
}
function killWithMelee(player, actor, label) {
  player.setVar(npcAttackingUid, actor.uid);
  for (let swing = 0; swing < 40 && actor.isActive && actor.levels[NpcStat.HITPOINTS] > 0; swing++) {
    advanceTo(Math.max(World.currentTick + 1, player.getVar(attackDelay)));
    withRandom([0.999999, 0, 0.999999], () => runPacked('[label,player_melee_attack]', player, actor));
    advanceTo();
    actor.turn();
    player.processQueues();
    if (actor.isActive && actor.levels[NpcStat.HITPOINTS] > 0) actor.turn();
    player.processQueues();
  }
  assert(!actor.isActive || actor.levels[NpcStat.HITPOINTS] === 0, `${label} falls to ordinary player melee damage`);
  for (let tick = 0; actor.isActive && tick < 128; tick++) {
    advanceTo();
    withRandom([0.999999, 0, 0.999999], () => actor.turn());
    player.processQueues();
  }
  assert(!actor.isActive, `${label} completes its real death-queue lifecycle`);
  player.processQueues();
}

function readOgreFloorLinks() {
  const manifest = JSON.parse(source('tests/stair-links/placements.json'));
  const entries = manifest.filter(entry => entry.family === 'Jiggig tomb stairs');
  assert.equal(entries.length, 4, 'the shared stair manifest enumerates all four native Jiggig links');
  return entries.map(entry => {
    const row = nativeLocRows(entry.name).find(value =>
      value.coord === entry.coord && value.angle === entry.angle && value.shape === entry.shape);
    assert(row, `${entry.name} has its exact native packed-map placement ${entry.coord}`);
    return {
      entry,
      loc: locFor(row),
      trigger: `[${entry.trigger},${entry.name}]`,
      to: entry.destination
    };
  });
}
function assertOgreStairs(player) {
  const jiggigLinks = readOgreFloorLinks();
  floorLinks = jiggigLinks;
  for (const link of jiggigLinks) {
    [player.level, player.x, player.z] = link.entry.start;
    player.buildArea.rebuild();
    walkable(tileOf(player), `${link.trigger} native approach`);
    const origin = tileOf(player);
    interactLoc(player, link.loc, 1, link.trigger);
    assert.notDeepEqual(tileOf(player), origin, `${link.trigger} changes floor through its actual visible-form handler`);
    assert.deepEqual(tileOf(player), link.to, `${link.trigger} uses the shared native landing expectation`);
    walkable(tileOf(player), `${link.trigger} destination`);

    const counterpartEntry = link.entry.counterpart;
    const counterpart = jiggigLinks.find(candidate =>
      candidate.entry.name === counterpartEntry.name &&
      candidate.entry.coord === counterpartEntry.coord &&
      candidate.entry.angle === counterpartEntry.angle);
    assert(counterpart, `${link.trigger} landing names its actual native counterpart`);
    assert.equal(counterpart.loc.level, link.to[0], `${link.trigger} counterpart exists on the arrival floor`);
    walkTo(player, counterpart.loc);
    assert.equal(player.level, link.to[0], `${link.trigger} counterpart approach remains on the arrival floor`);
    interactLoc(player, counterpart.loc, 1, counterpart.trigger);
    assert.equal(player.level, link.loc.level, `${counterpart.trigger} returns to the source floor`);
    walkable(tileOf(player), `${counterpart.trigger} return landing`);
    walkTo(player, link.loc);
  }
}
function assertBarricadeClimb(player, row, form, stairs) {
  const loc = locFor(row);
  assert(loc, `${form} retains its native multiloc placement`);
  assert.equal(visibleLocName(player, loc), form, `${form} is the player's visible barricade form`);
  assert.equal(loc.shape, 10, `${form} uses its native scenery shape, not a wall-door shape`);
  assert.equal(loc.angle, 3, `${form} retains the native north-south barricade orientation`);
  const side = tile => tile[1] - loc.x;
  const exits = stairs.filter(link => link.loc.level === loc.level && link.to[0] === 2)
    .flatMap(link => approachTiles(player, link.loc));
  assert(exits.length, 'the surface has a native route to the tomb stairs');
  const outsideSide = Math.sign(grish.x - loc.x);
  assert.notEqual(outsideSide, 0, 'the native Grish placement identifies the outside of the barricade');
  const outsideExits = approachTiles(player, grish);
  const approaches = approachTiles(player, loc);
  const firstSign = [-1, 1].find(sign => findPathToAny(tileOf(player), approaches.filter(tile => side(tile) === sign)));
  assert.notEqual(firstSign, undefined, `${form} is reachable from the current side`);
  for (const sign of [firstSign, -firstSign]) {
    assert(approachTiles(player, loc).some(tile => side(tile) === sign),
      `${form} has a real packed-map approach on signed side ${sign}`);
    const sideFilter = tile => side(tile) === sign;
    walkTo(player, loc, sideFilter);
    const before = tileOf(player);
    assert.equal(side(before), sign, `${form} climb starts on the chosen side`);
    interactLoc(player, loc, 1, `[oploc1,${form}]`, [], sideFilter);
    const after = tileOf(player);
    assert.equal(side(after), -sign, `${form} climb lands on the opposite wall-normal side`);
    assert.equal(Math.abs(after[1] - before[1]) + Math.abs(after[2] - before[2]), 2,
      `${form} climb crosses one tile on either side of the wall without pinning a landing coordinate`);
    walkable(after, `${form} climb landing`);
    const expectedExits = -sign === outsideSide ? outsideExits : exits;
    assert(findPathToAny(after, expectedExits), `${form} climb leaves a packed route to ${-sign === outsideSide ? 'Grish' : 'the tomb stairs'}`);
  }
}

function nativeTombGate(localX, localZ) {
  const row = ['ogre_cavedoorr', 'ogre_cavedoorl'].flatMap(nativeLocRows).find(value =>
    value.level === 2 && value.mx === 38 && value.mz === 147 && value.localX === localX && value.localZ === localZ);
  assert(row, `the native double-gate placement exists at local ${localX},${localZ}`);
  return row;
}

function equipCombatWeapon(player) {
  add(player, 'bronze_scimitar');
  const weapon = types.ObjType.get(obj('bronze_scimitar'));
  player.getInventory(wornId).set(weapon.wearpos, { id: weapon.id, count: 1 });
  setCombat(player);
  if (varpValue(player, 'prayer14') === 0) {
    const protectMelee = id(types.Component, 'prayer:prayer_protectfrommelee');
    player.tabs[5] = types.Component.get(protectMelee).rootLayer;
    assert(choiceHandler.handle(new IfButton(protectMelee), player), 'the native prayer button protects the combat fixture');
    assert.equal(varpValue(player, 'prayer14'), 1, 'Protect from Melee is active through its normal player action');
  }
}

const grish = npcAt('zogre_ogre_shaman');
const chompyComplete = integerConstant('scripts/general/configs/quest.constant', 'chompybird_complete');
const jungleComplete = integerConstant('scripts/general/configs/quest.constant', 'junglepotion_complete');
function eligibleStartPlayer() {
  const player = playerAt(tileOf(grish));
  varpValue(player, 'chompybird', chompyComplete);
  varpValue(player, 'junglepotion', jungleComplete);
  return player;
}
function setLevel(player, stat, base, current = base) {
  const index = PlayerStat[stat];
  assert(Number.isInteger(index), `${stat} is a packed player skill`);
  player.baseLevels[index] = base;
  player.levels[index] = current;
}
function assertNoStart(player, label) {
  talkNpc(player, grish, '[opnpc1,zogre_ogre_shaman]');
  assert.equal(bit(player, 'zogre'), 0, `${label} does not start the quest`);
  assert.equal(count(player, '4dose2restore'), 0, `${label} cannot receive start supplies`);
  assert.equal(count(player, 'cooked_chompy'), 0, `${label} cannot receive start food`);
}

// Every separate quest/skill prerequisite refuses through Grish's packed Talk-to handler.
for (const missing of ['chompybird', 'junglepotion']) {
  const player = eligibleStartPlayer();
  varpValue(player, missing, 0);
  assertNoStart(player, `${missing} prerequisite`);
}
for (const [skill, required] of [['SMITHING', 4], ['HERBLORE', 8], ['RANGED', 30]]) {
  const player = eligibleStartPlayer();
  setLevel(player, skill, required - 1);
  assertNoStart(player, `${skill} level ${required - 1}`);
}

// Source-selected boost rule: the checked-out start gate reads current stat(), so a current boost qualifies.
const boostedStart = eligibleStartPlayer();
for (const [skill, required] of [['SMITHING', 4], ['HERBLORE', 8], ['RANGED', 30]]) setLevel(boostedStart, skill, required - 1, required);
talkNpc(boostedStart, grish, '[opnpc1,zogre_ogre_shaman]', [0, 0]);
assert.equal(bit(boostedStart, 'zogre'), stage.accepted, 'boosted current levels satisfy the actual start gate');
assert.equal(count(boostedStart, '4dose2restore'), 2, 'Grish supplies both restored potions once');
assert.equal(count(boostedStart, 'cooked_chompy'), 3, 'Grish supplies three cooked chompies once');
const startItems = ['4dose2restore', 'cooked_chompy'].map(name => count(boostedStart, name));
talkNpc(boostedStart, grish, '[opnpc1,zogre_ogre_shaman]');
assert.equal(bit(boostedStart, 'zogre'), stage.accepted, 'repeat Talk-to does not reset the accepted stage');
assert.deepEqual(['4dose2restore', 'cooked_chompy'].map(name => count(boostedStart, name)), startItems,
  'repeat Talk-to does not duplicate the start supplies');

// Both independent decline points leave stage and inventory untouched.
for (const choices of [[1], [0, 1]]) {
  const player = eligibleStartPlayer();
  talkNpc(player, grish, '[opnpc1,zogre_ogre_shaman]', choices);
  assert.equal(bit(player, 'zogre'), 0, 'declining either confirmation leaves the quest unstarted');
  assert.equal(count(player, '4dose2restore'), 0);
  assert.equal(count(player, 'cooked_chompy'), 0);
}

// A packed full inventory cannot silently accept the quest or discard its five start supplies.
const fullStart = eligibleStartPlayer();
for (let slot = 0; slot < inventorySize; slot++) fullStart.getInventory(invId).set(slot, { id: obj('spade'), count: 1 });
assert.equal(fullStart.invFreeSpace(invId), 0);
assertNoStart(fullStart, 'full inventory');
assert.equal(fullStart.invFreeSpace(invId), 0, 'refusal preserves all occupied slots');

// The native Jiggig floor links are tested through their visible loc packets and the packed collision map.
const stairPlayer = eligibleStartPlayer();
talkNpc(stairPlayer, grish, '[opnpc1,zogre_ogre_shaman]', [0, 0]);
assert.equal(bit(stairPlayer, 'zogre'), stage.accepted, 'the staircase fixture reaches Jiggig through the real start handler');
assertOgreStairs(stairPlayer);

console.log('PASS Zogre Flesh Eaters start prerequisites, current-level boosts, declines, inventory guard and Jiggig stair collision');

// The guarded achey entry preserves ordinary shafts and the independent tinderbox branch.
const ordinaryShafts = eligibleStartPlayer();
add(ordinaryShafts, 'knife');
add(ordinaryShafts, 'achey_tree_logs');
useItemOnItem(ordinaryShafts, 'knife', 'achey_tree_logs', '[opheldu,achey_tree_logs]');
assert(count(ordinaryShafts, 'ogre_arrow_shaft') > 0, 'pre-Zogre knife use still makes ordinary ogre shafts without a choice');
assert.equal(count(ordinaryShafts, 'unstrung_zogre_bow'), 0, 'the pre-Zogre fallback cannot make an unlearned composite bow');
assert.equal(bit(ordinaryShafts, 'zogre'), 0, 'ordinary shafts do not start Zogre');
assert.equal(bit(ordinaryShafts, 'thzfe_makecompozogrebow'), 0, 'ordinary shafts do not grant the bow lesson');

const ordinaryFire = eligibleStartPlayer();
placeAtApproach(ordinaryFire, grish, 'ordinary achey-firemaking fixture');
const fireOrigin = tileOf(ordinaryFire);
const fireType = id(types.LocType, 'fire');
const firemakingXpBefore = ordinaryFire.stats[PlayerStat.FIREMAKING];
add(ordinaryFire, 'tinderbox');
add(ordinaryFire, 'achey_tree_logs');
useItemOnItem(ordinaryFire, 'tinderbox', 'achey_tree_logs', '[opheldu,achey_tree_logs]');
assert.equal(count(ordinaryFire, 'achey_tree_logs'), 0, 'the unchanged tinderbox case drops its log for ordinary lighting');
assert.equal(count(ordinaryFire, 'tinderbox'), 1, 'ordinary achey firemaking preserves the tinderbox');
const groundLog = World.getObj(fireOrigin[1], fireOrigin[2], fireOrigin[0], obj('achey_tree_logs'), ordinaryFire.hash64);
assert(groundLog, 'the ordinary achey handler creates its real ground log');
assert.equal(ordinaryFire.target, groundLog, 'ordinary firemaking continues against the actual dropped log');
assert.equal(ordinaryFire.getOpTrigger()?.name, '[opobj4,_category_22]', 'the unchanged tinderbox case selects native ground lighting');
advanceTo(Math.max(World.currentTick + 1, ordinaryFire.getVar(attackDelay)));
let fireState;
const executeFireScript = ordinaryFire.executeScript;
ordinaryFire.executeScript = function(state, ...args) {
  fireState = state;
  return executeFireScript.call(this, state, ...args);
};
try { withRandom(0, () => ordinaryFire.processInteraction()); }
finally { ordinaryFire.executeScript = executeFireScript; }
assert(fireState, 'the native ground-lighting interaction executes');
for (let step = 0; !World.getLoc(fireOrigin[1], fireOrigin[2], fireOrigin[0], fireType) && step < 8; step++) {
  assert.equal(fireState.execution, ScriptState.SUSPENDED, 'native lighting only pauses for the ordinary player push');
  advanceTo(Math.max(World.currentTick + 1, ordinaryFire.delayedUntil ?? 0));
  ordinaryFire.delayed = false;
  withRandom(0, () => ordinaryFire.executeScript(fireState, true, true));
}
assert(World.getLoc(fireOrigin[1], fireOrigin[2], fireOrigin[0], fireType), 'ordinary achey firemaking produces its real native fire');
assert.equal(World.getObj(fireOrigin[1], fireOrigin[2], fireOrigin[0], obj('achey_tree_logs'), ordinaryFire.hash64), null,
  'the native firemaking success consumes the ground log');
// Baseline only: the untouched achey definition has no productexp; zero XP is not claimed as authentic.
assert.equal(ordinaryFire.stats[PlayerStat.FIREMAKING], firemakingXpBefore, 'the unchanged achey definition preserves its pre-existing Firemaking XP behavior');
assert.equal(bit(ordinaryFire, 'zogre'), 0, 'ordinary achey firemaking does not start Zogre');
console.log('PASS pre-Zogre ordinary ogre shafts and unchanged native achey firemaking');
// The visible blocking forms refuse the climb until the accepted quest lets the guard collapse them.
const guard = npcAt('zogre_ogre_guard');
const barricadeRows = [
  locRow('zogre_multi_blocking_barricade_l'),
  locRow('zogre_multi_blocking_barricade_r')
];
const preQuestGuard = eligibleStartPlayer();
for (const row of barricadeRows) assert.equal(visibleLocName(preQuestGuard, locFor(row)), 'ogre_barricade_blocking');
talkNpc(preQuestGuard, guard, '[opnpc1,zogre_ogre_guard]');
assert.equal(bit(preQuestGuard, 'thzfe_blocking_barricade'), 0, 'the guard leaves the native barricades blocking before the quest');

// The main player never seeds Zogre progress; remote overworld travel is labelled fixture setup.
const player = eligibleStartPlayer();
runPacked('[proc,update_questpoints]', player);
const questPointsBefore = countQuestPoints(player);
talkNpc(player, grish, '[opnpc1,zogre_ogre_shaman]', [0, 0]);
assert.equal(bit(player, 'zogre'), stage.accepted, 'the Grish Talk-to action starts the full-progression player');
talkNpc(player, guard, '[opnpc1,zogre_ogre_guard]');
assert.equal(bit(player, 'thzfe_blocking_barricade'), 1, 'the active quest lets the guard collapse the barricade');
for (const [row, form] of barricadeRows.map((row, index) =>
  [row, index === 0 ? 'ogre_barricade_collapsedl' : 'ogre_barricade_collapsedr'])) {
  assert.equal(visibleLocName(player, locFor(row)), form, `${row.name} changes into its native climbable form`);
  assertBarricadeClimb(player, row, form, floorLinks);
}
// The two-direction checks return outside; enter once more for the investigation.
interactLoc(player, locFor(barricadeRows[0]), 1, '[oploc1,ogre_barricade_collapsedl]');

// The Brentle fight is owner-bound; a foreign defeat cannot finish the skeleton encounter.
const skeletonRow = locRow('zogre_brentle_skeleton');
const skeleton = locFor(skeletonRow);
interactLoc(player, skeleton, 1, '[oploc1,zogre_brentle_skeleton]');
let brentle = activeNpcNear('zogre_human_brentle_vahn', tileOf(skeleton));
assert.equal(brentle.getVar(npcAttackingUid), player.uid, 'the real skeleton action binds Brentle to this player');
assert.equal(brentle.getVar(npcMacroEventTarget), player.uid, "the encounter has the summoning player's macro-event target");
const foreign = playerAt(tileOf(player));
equipCombatWeapon(foreign);
attackNpc(foreign, brentle);
killWithMelee(foreign, brentle, 'foreign-killed Brentle');
assert.equal(bit(player, 'thzfe_brentle_skele'), 1, "another player's kill cannot credit the skeleton owner");
assert.equal(bit(foreign, 'thzfe_brentle_skele'), 0, "another player's kill cannot award itself the skeleton encounter");
interactLoc(player, skeleton, 1, '[oploc1,zogre_brentle_skeleton]');
brentle = activeNpcNear('zogre_human_brentle_vahn', tileOf(skeleton));
equipCombatWeapon(player);
attackNpc(player, brentle);
killWithMelee(player, brentle, 'owner-killed Brentle');
assert.equal(bit(player, 'thzfe_brentle_skele'), 2, 'the owner receives defeat credit through the packed death queue');
interactLoc(player, skeleton, 1, '[oploc1,zogre_brentle_skeleton]');
assert.equal(count(player, 'zogre_brentle_vahn_backpack'), 1, 'the owner recovers Brentle’s backpack after the real kill');
del(player, 'zogre_brentle_vahn_backpack');
interactLoc(player, skeleton, 1, '[oploc1,zogre_brentle_skeleton]');
assert.equal(count(player, 'zogre_brentle_vahn_backpack'), 1, 'the defeated skeleton replaces a backpack lost before opening');
interactLoc(player, skeleton, 1, '[oploc1,zogre_brentle_skeleton]');
assert.equal(count(player, 'zogre_brentle_vahn_backpack'), 1, 'repeat recovery does not duplicate the held backpack');
heldOption(player, 'zogre_brentle_vahn_backpack', 1, '[opheld1,zogre_brentle_vahn_backpack]');
for (const item of ['knife', 'rotten_food', 'zogre_dragon_tankard']) {
  assert.equal(count(player, item), 1, `the packed backpack yields ${item}`);
}
del(player, 'zogre_dragon_tankard');
interactLoc(player, skeleton, 1, '[oploc1,zogre_brentle_skeleton]');
heldOption(player, 'zogre_brentle_vahn_backpack', 1, '[opheld1,zogre_brentle_vahn_backpack]');
assert.equal(count(player, 'zogre_dragon_tankard'), 1, 'another native backpack replaces the tankard lost before identification');
assert.equal(bit(player, 'thzfe_brentle_skele'), 2, 'lost-item recovery preserves the earned Brentle defeat');
del(player, 'knife'); // Fixture discards the second backpack’s spare ordinary supplies.
del(player, 'rotten_food');

// Gather and recover the tomb evidence through the original loc and inventory handlers.
const lecturn = locFor(locRow('zogre_lecturn'));
interactLoc(player, lecturn, 1, '[oploc1,zogre_lecturn]');
assert.equal(count(player, 'zogre_necromantic_page'), 1, 'the broken lecturn yields the torn page');
del(player, 'zogre_necromantic_page');
interactLoc(player, lecturn, 1, '[oploc1,zogre_lecturn]');
assert.equal(count(player, 'zogre_necromantic_page'), 1, 'the lecturn replaces a lost page without changing stage');
const coffin = locFor(locRow('zogre_coffin_special_entity'));
assert.equal(visibleLocName(player, coffin), 'zogre_coffin_special', 'the native coffin begins closed');
useItemOnLoc(player, 'knife', coffin, '[oplocu,zogre_coffin_special]');
assert.equal(bit(player, 'thzfe_prismsearch'), 3, 'using the backpack knife opens the coffin');
assert.equal(visibleLocName(player, coffin), 'zogre_coffin_special_searched', 'the coffin shows its searched native form');
interactLoc(player, coffin, 1, '[oploc1,zogre_coffin_special_searched]');
assert.equal(count(player, 'zogre_black_prism'), 1, 'searching the opened coffin yields the prism');
player.getInventory(bankId);
player.invAdd(bankId, obj('zogre_black_prism'), 1);
del(player, 'zogre_black_prism');
interactLoc(player, coffin, 1, '[oploc1,zogre_coffin_special_searched]');
assert.equal(count(player, 'zogre_black_prism'), 0, 'coffin recovery does not duplicate a banked prism');
assert.equal(count(player, 'zogre_black_prism', bankId), 1);
player.invDel(bankId, obj('zogre_black_prism'), 1);
interactLoc(player, coffin, 1, '[oploc1,zogre_coffin_special_searched]');
assert.equal(count(player, 'zogre_black_prism'), 1, 'the coffin replaces a lost, unbanked prism');

const bartender = npcAt('dragon_bartender');
placeAtApproach(player, bartender, 'fixture travel to the Dragon Inn');
useItemOnNpc(player, 'zogre_dragon_tankard', bartender, '[opnpcu,dragon_bartender]');
assert.equal(bit(player, 'thzfe_innkeepermugshown'), 1, 'the actual Dragon Inn bartender identifies the tankard');
const bell = locFor(locRow('zogre_outdoor_bell'));
placeAtApproach(player, bell, 'fixture travel to the Wizards Guild bell');
interactLoc(player, bell, 1, '[oploc1,zogre_outdoor_bell]');
let wizard = activeNpcNear('zogre_human_zavistic_rarve', tileOf(bell), 3);
talkNpc(player, wizard, '[opnpc1,zogre_human_zavistic_rarve]');
assert.equal(bit(player, 'zogre'), stage.wizardEvidence, 'Zavistic accepts the tankard, page and prism');

const bed = locFor(locRow('zogre_sithik_bed_entity'));
placeAtApproach(player, bed, 'fixture travel to Sithik’s upstairs room');
assert.equal(visibleLocName(player, bed), 'ogre_bedman_loc', 'Sithik is the visible native bed form before investigation');
interactLoc(player, bed, 1, '[oploc1,ogre_bedman_loc]');
assert.equal(bit(player, 'zogre'), stage.searchPermission, 'speaking to Sithik grants room-search permission');
assert.equal(player.level, 1, 'Sithik’s investigation uses his native first-floor room');
for (const [name, itemNames] of [
  ['sithiks_drawers', ['zogre_portrait_book', 'papyrus', 'charcoal']],
  ['sithiks_cupboard', ['zogre_necrobook']],
  ['sithiks_wardrobe', ['zogre_hambook']]
]) {
  const furniture = locFor(locRow(name));
  interactLoc(player, furniture, 1, `[oploc1,${name}]`);
  for (const item of itemNames) assert.equal(count(player, item), 1, `${name} supplies ${item}`);
  for (const item of itemNames) {
    del(player, item);
    assert.equal(count(player, item), 0, `the recovery fixture loses ${item} during investigation`);
    interactLoc(player, furniture, 1, `[oploc1,${name}]`);
    assert.equal(count(player, item), 1, `${name} replaces the lost ${item} before evidence is complete`);
  }
}
useItemOnLoc(player, 'papyrus', bed, '[oplocu,ogre_bedman_loc]');
assert.equal(count(player, 'zogre_sithik_portrait_bad'), 1, 'drawing before reading the book produces the native poor portrait');
del(player, 'zogre_sithik_portrait_bad');
interactLoc(player, locFor(locRow('sithiks_drawers')), 1, '[oploc1,sithiks_drawers]');
assert.equal(count(player, 'papyrus'), 1, 'losing a failed portrait leaves another drawing attempt available');
heldOption(player, 'zogre_portrait_book', 1, '[opheld1,zogre_portrait_book]');
heldOption(player, 'zogre_necrobook', 1, '[opheld1,zogre_necrobook]');
heldOption(player, 'zogre_hambook', 1, '[opheld1,zogre_hambook]');
assert.equal(bit(player, 'thzfe_shownhambook'), 1, 'reading the H.A.M. book records the required evidence');
useItemOnItem(player, 'zogre_necromantic_page', 'zogre_necrobook', '[opheldu,zogre_necrobook]');
assert.equal(bit(player, 'thzfe_shownnecrobook'), 1, 'the real page-on-book action matches the torn page');
useItemOnLoc(player, 'papyrus', bed, '[oplocu,ogre_bedman_loc]');
assert.equal(count(player, 'zogre_sithik_portrait_good'), 1, 'the portrait book produces a realistic Sithik portrait');
del(player, 'zogre_sithik_portrait_good');
interactLoc(player, locFor(locRow('sithiks_drawers')), 1, '[oploc1,sithiks_drawers]');
useItemOnLoc(player, 'papyrus', bed, '[oplocu,ogre_bedman_loc]');
assert.equal(count(player, 'zogre_sithik_portrait_good'), 1, 'replacement paper and the remembered book replace a lost good portrait');
placeAtApproach(player, bartender, 'fixture travel to identify Sithik’s portrait');
useItemOnNpc(player, 'zogre_sithik_portrait_good', bartender, '[opnpcu,dragon_bartender]');
assert.equal(count(player, 'zogre_sithik_portrait_good'), 0);
assert.equal(count(player, 'zogre_sithik_portrait_signed'), 1, 'the bartender signs the correct portrait after seeing the tankard');
assert.equal(bit(player, 'zogre'), stage.signedPortrait, 'the signed portrait advances the investigation stage');
del(player, 'zogre_sithik_portrait_signed');
placeAtApproach(player, bed, 'fixture travel to replace the lost signed portrait');
interactLoc(player, locFor(locRow('sithiks_drawers')), 1, '[oploc1,sithiks_drawers]');
useItemOnLoc(player, 'papyrus', bed, '[oplocu,ogre_bedman_loc]');
placeAtApproach(player, bartender, 'fixture travel to identify the replacement portrait');
useItemOnNpc(player, 'zogre_sithik_portrait_good', bartender, '[opnpcu,dragon_bartender]');
assert.equal(count(player, 'zogre_sithik_portrait_signed'), 1, 'the bartender replaces a signed portrait lost before Zavistic sees it');
assert.equal(bit(player, 'zogre'), stage.signedPortrait, 'signing replacement evidence preserves the investigation stage');
placeAtApproach(player, bell, 'fixture travel to present the signed evidence');
interactLoc(player, bell, 1, '[oploc1,zogre_outdoor_bell]');
wizard = activeNpcNear('zogre_human_zavistic_rarve', tileOf(bell), 3);
talkNpc(player, wizard, '[opnpc1,zogre_human_zavistic_rarve]');
assert.equal(bit(player, 'zogre'), stage.potionEvidence, 'Zavistic accepts all evidence and provides his potion');
assert.equal(count(player, 'zogre_ogre_trans_potion'), 1);
del(player, 'zogre_ogre_trans_potion');
talkNpc(player, wizard, '[opnpc1,zogre_human_zavistic_rarve]');
assert.equal(count(player, 'zogre_ogre_trans_potion'), 1, 'Zavistic replaces a potion lost before dosing the tea');
player.invAdd(bankId, obj('zogre_ogre_trans_potion'), 1);
del(player, 'zogre_ogre_trans_potion');
talkNpc(player, wizard, '[opnpc1,zogre_human_zavistic_rarve]');
assert.equal(count(player, 'zogre_ogre_trans_potion'), 0, 'Zavistic does not duplicate a banked transformation potion');
player.invDel(bankId, obj('zogre_ogre_trans_potion'), 1);
talkNpc(player, wizard, '[opnpc1,zogre_human_zavistic_rarve]');
assert.equal(count(player, 'zogre_ogre_trans_potion'), 1, 'Zavistic restores the potion after its banked copy is lost');
talkNpc(player, wizard, '[opnpc1,zogre_human_zavistic_rarve]');
assert.equal(count(player, 'zogre_ogre_trans_potion'), 1, 'repeat potion recovery does not duplicate the held evidence');
add(player, 'zogre_cup_of_tea_sithix'); // Independent fixture input; dosing the tea is the product action.
useItemOnItem(player, 'zogre_ogre_trans_potion', 'zogre_cup_of_tea_sithix', '[opheldu,zogre_cup_of_tea_sithix]');
assert.equal(bit(player, 'zogre'), stage.potionEvidence, 'a carried cup outside Sithik’s room cannot transform him');
assert.equal(count(player, 'zogre_ogre_trans_potion'), 1, 'the rejected outside-room action preserves the potion');
placeAtApproach(player, bed, 'fixture travel back to Sithik’s upstairs room');
assert.equal(player.level, 1, 'the real dosing action occurs in Sithik’s native room');
useItemOnItem(player, 'zogre_ogre_trans_potion', 'zogre_cup_of_tea_sithix', '[opheldu,zogre_cup_of_tea_sithix]');
assert.equal(bit(player, 'zogre'), stage.teaDosed, 'the potion on Sithik’s tea writes the transformation stage');
assert.equal(bit(player, 'thzfe_sithik_transformed'), 1);
assert.equal(visibleLocName(player, bed), 'ogre_bedogre_loc', 'the bed morph shows Sithik’s ogre form');
add(player, 'vial_water');
add(player, 'rogues_purse');
useItemOnItem(player, 'vial_water', 'rogues_purse', '[opheldu,rogues_purse]');
assert.equal(count(player, 'vial_water'), 1, 'the balm recipe remains locked before Sithik confesses');
assert.equal(count(player, 'rogues_purse'), 1);
assert.equal(count(player, 'rogues_purse_sol'), 0);
interactLoc(player, bed, 1, '[oploc1,ogre_bedogre_loc]');
assert.equal(bit(player, 'zogre'), stage.confession, 'the actual transformed-bed conversation records Sithik’s confession');
assert.equal(bit(player, 'thzfe_makecuredisease'), 1);
assert.equal(bit(player, 'thzfe_makebrutalarrow'), 1);
useItemOnItem(player, 'vial_water', 'rogues_purse', '[opheldu,rogues_purse]');
assert.equal(count(player, 'rogues_purse_sol'), 1, 'water on rogue’s purse makes the first balm intermediate');
add(player, 'snake_weed');
useItemOnItem(player, 'snake_weed', 'rogues_purse_sol', '[opheldu,rogues_purse_sol]');
assert.equal(count(player, 'relicyms_balm3'), 1, 'snake weed on the intermediate makes Relicym’s balm');
add(player, 'vial_water');
add(player, 'rogues_purse');
useItemOnItem(player, 'rogues_purse', 'vial_water', '[opheldu,vial_water]');
assert.equal(count(player, 'rogues_purse_sol'), 1, 'the reverse water-and-herb use order is supported');
add(player, 'snake_weed');
useItemOnItem(player, 'rogues_purse_sol', 'snake_weed', '[opheldu,snake_weed]');
assert.equal(count(player, 'relicyms_balm3'), 2, 'the reverse intermediate-and-herb use order is supported');

// The unkeyed gate refuses from its actual north approach before stage 10 grants the key.
const gateInnerRow = nativeTombGate(8, 18);
const gateOuterRow = nativeTombGate(9, 25);
const gateInner = locFor(gateInnerRow);
const gateOuter = locFor(gateOuterRow);
const tombEntrance = floorLinks.find(link => link.entry.coord === '0_38_47_53_34');
assert(tombEntrance, 'the fixture returns through the native surface tomb stair');
placeAtApproach(player, tombEntrance.loc, 'fixture travel back to Jiggig');
interactLoc(player, tombEntrance.loc, 1, tombEntrance.trigger);
// Native shape-0, angle-3 walls lie on the south edge of their anchor tile.
walkTo(player, gateOuter, tile => tile[2] >= gateOuter.z);
assert.equal(player.level, 2, 'the no-key gate attempt reaches the tomb through its native outer stairs');
const noKeyGateSide = tileOf(player);
assert(noKeyGateSide[2] >= gateOuter.z, 'the player approaches the locked outer gate from its north side');
interactLoc(player, gateOuter, 1, `[oploc1,${gateOuterRow.name}]`, [], tile => tile[2] >= gateOuter.z);
assert.deepEqual(tileOf(player), noKeyGateSide, 'the actual double-gate entry refuses without the key');
assert.equal(count(player, 'zogre_tomb_artefact_key'), 0);
assert.equal(bit(player, 'zogre'), stage.confession, 'a locked gate leaves the accepted quest stage unchanged');
placeAtApproach(player, grish, 'fixture travel to report Sithik’s confession');
// Grish does not skip stage 7 when a full inventory prevents key delivery.
while (player.invFreeSpace(invId) > 0) add(player, 'spade');
talkNpc(player, grish, '[opnpc1,zogre_ogre_shaman]');
assert.equal(bit(player, 'zogre'), stage.confession, 'a full inventory cannot advance past undelivered key');
assert.equal(bit(player, 'thzfe_makecompozogrebow'), 0);
assert.equal(count(player, 'zogre_tomb_artefact_key'), 0);
del(player, 'spade');
talkNpc(player, grish, '[opnpc1,zogre_ogre_shaman]');
assert.equal(bit(player, 'zogre'), stage.badNews, 'Grish advances only after the real key delivery succeeds');
assert.equal(bit(player, 'thzfe_makecompozogrebow'), 1);
assert.equal(count(player, 'zogre_tomb_artefact_key'), 1);
player.getInventory(bankId);
player.invAdd(bankId, obj('zogre_tomb_artefact_key'), 1);
del(player, 'zogre_tomb_artefact_key');
talkNpc(player, grish, '[opnpc1,zogre_ogre_shaman]');
assert.equal(count(player, 'zogre_tomb_artefact_key'), 0, 'stage-10 key recovery does not duplicate a banked key');
assert.equal(count(player, 'zogre_tomb_artefact_key', bankId), 1);
player.invDel(bankId, obj('zogre_tomb_artefact_key'), 1);
talkNpc(player, grish, '[opnpc1,zogre_ogre_shaman]');
assert.equal(count(player, 'zogre_tomb_artefact_key'), 1, 'Grish replaces a lost, unbanked key before the tomb run');
if (count(player, 'spade')) del(player, 'spade', count(player, 'spade'));

// The period bow and brutal-arrow recipes are exercised with actual packed item handlers.
add(player, 'achey_tree_logs');
add(player, 'wolf_bones');
useItemOnItem(player, 'knife', 'achey_tree_logs', '[opheldu,achey_tree_logs]', [1]);
assert.equal(count(player, 'unstrung_zogre_bow'), 1, 'Grish’s lesson enables the composite ogre bow recipe');
add(player, 'bow_string');
useItemOnItem(player, 'bow_string', 'unstrung_zogre_bow', '[opheldu,bow_string]');
assert.equal(count(player, 'zogre_bow'), 1, 'stringing the composite bow produces its native wieldable form');
add(player, 'achey_tree_logs');
withRandom(0.999999, () => useItemOnItem(player, 'knife', 'achey_tree_logs', '[opheldu,achey_tree_logs]', [0]));
assert(count(player, 'ogre_arrow_shaft') > 0, 'the real achey-log handler cuts ogre arrow shafts');
add(player, 'feather', 4);
useItemOnItem(player, 'feather', 'ogre_arrow_shaft', '[opheldu,ogre_arrow_shaft]');
assert.equal(count(player, 'ogre_headless_arrow'), 1, 'four feathers flight one shaft into a headless ogre arrow');
add(player, 'nails_iron');
add(player, 'hammer');
useItemOnItem(player, 'ogre_headless_arrow', 'nails_iron', '[opheldu,nails_iron]');
assert.equal(count(player, 'zogre_brutal_iron'), 1, 'the learned hammer-and-nails action makes a brutal arrow');
assert.equal(count(player, 'ogre_headless_arrow'), 0);
placeAtApproach(player, tombEntrance.loc, 'fixture travel to begin the keyed tomb entry');
interactLoc(player, tombEntrance.loc, 1, tombEntrance.trigger);
// Hold the key for the native double gate; reaching the stand cannot use a fixture relocation.
const gateOuterBefore = tileOf(player);
interactLoc(player, gateOuter, 1, `[oploc1,${gateOuterRow.name}]`, [], tile => tile[2] >= gateOuter.z);
assert.equal(player.z, gateOuter.z - 1, 'the key opens the outer gate north-to-south');
interactLoc(player, gateInner, 1, `[oploc1,${gateInnerRow.name}]`, [], tile => tile[2] >= gateInner.z);
assert.equal(player.z, gateInner.z - 1, 'the key opens the inner gate north-to-south');
assert.notDeepEqual(tileOf(player), gateOuterBefore, 'the two real gate actions carry the player into the burial chamber');
del(player, 'zogre_tomb_artefact_key');
const standRow = locRow('zogre_stand');
assert.deepEqual([standRow.level, standRow.mx, standRow.mz, standRow.localX, standRow.localZ], [0, 38, 147, 51, 37],
  'the native stand remains at the checked-out lower-floor placement');
const stand = locFor(standRow);
assert.deepEqual(tileOf(stand), [0, 2483, 9445], 'the packed stand is the lower-floor native loc, not a relocated fixture');
interactLoc(player, stand, 1, '[oploc1,zogre_stand]');
assert.equal(bit(player, 'zogre'), stage.bossActive, 'searching the stand beyond both gates summons Slash Bash');
const slashBashId = id(types.NpcType, 'zogre_slash_bash');
const activeBossCount = () => [...World.npcs].filter(actor =>
  actor.isActive && actor.type === slashBashId && actor.getVar(npcAttackingUid) === player.uid).length;
assert.equal(activeBossCount(), 1, 'one live Slash Bash belongs to the searching player');
interactLoc(player, stand, 1, '[oploc1,zogre_stand]');
assert.equal(activeBossCount(), 1, 're-searching the stand does not duplicate the owner-bound boss');
let slashBash = activeNpcNear('zogre_slash_bash', tileOf(stand));
assert.equal(slashBash.getVar(npcAttackingUid), player.uid, 'the stand binds Slash Bash to its searching player');
assert.equal(slashBash.getVar(npcMacroEventTarget), player.uid);

// A foreign defeat yields no credit or loot; the owner retries and receives the exact 2006 drops.
const bossDrops = [];
const artifactId = obj('zogre_artifacts');
const zogreBonesId = obj('zogre_bones');
const ancestralBonesId = obj('zogre_ancestral_bones_ourg');
const rewardXpBefore = [PlayerStat.FLETCHING, PlayerStat.RANGED, PlayerStat.HERBLORE].map(stat => player.stats[stat]);
const originalAddObj = World.addObj;
World.addObj = function(ground, receiver, duration) {
  const result = originalAddObj.call(this, ground, receiver, duration);
  bossDrops.push({ x: ground.x, z: ground.z, level: ground.level, type: ground.type, count: ground.count, receiver });
  return result;
};
try {
  const foreignBoss = playerAt(tileOf(player));
  equipCombatWeapon(foreignBoss);
  attackNpc(foreignBoss, slashBash);
  killWithMelee(foreignBoss, slashBash, 'foreign-killed Slash Bash');
  assert.equal(bit(player, 'zogre'), stage.bossActive, 'another player cannot receive or trigger Slash Bash completion');
  assert.equal(bossDrops.length, 0, 'a foreign defeat cannot claim the owner’s quest loot');
  interactLoc(player, stand, 1, '[oploc1,zogre_stand]');
  slashBash = activeNpcNear('zogre_slash_bash', tileOf(stand));
  assert.equal(activeBossCount(), 1, 'the owner can retry the stand after another player defeats the first encounter');
  equipCombatWeapon(player);
  attackNpc(player, slashBash);
  killWithMelee(player, slashBash, 'owner-killed Slash Bash');
} finally {
  World.addObj = originalAddObj;
}
assert.equal(bit(player, 'zogre'), stage.bossDefeated, 'the owner receives stage 12 through the real death queue');
assert.deepEqual([...new Set(bossDrops.map(drop => drop.type))].sort((a, b) => a - b),
  [artifactId, zogreBonesId, ancestralBonesId].sort((a, b) => a - b), 'Slash Bash drops only the three sourced item types');
for (const [name, amount] of [['zogre_artifacts', 1], ['zogre_bones', 1], ['zogre_ancestral_bones_ourg', 3]]) {
  const drops = bossDrops.filter(value => value.type === obj(name));
  assert.equal(drops.reduce((total, drop) => total + drop.count, 0), amount,
    `Slash Bash drops exactly ${amount} ${name}, including separate nonstackable ground objects`);
  for (const drop of drops) {
    assert.equal(drop.receiver, player.hash64, `${name} is attributed to the actual encounter owner`);
    assert(World.getObj(drop.x, drop.z, drop.level, obj(name), player.hash64),
      `${name} remains on the native owner-attributed ground pile`);
  }
}
const artifactDrop = bossDrops.find(value => value.type === artifactId);
pickGround(player, World.getObj(artifactDrop.x, artifactDrop.z, artifactDrop.level, artifactId, player.hash64), 'zogre_artifacts');
assert.equal(count(player, 'zogre_artifacts'), 1, 'the owner picks up the actual artifact drop');
interactLoc(player, stand, 1, '[oploc1,zogre_stand]');
assert.equal(count(player, 'zogre_artifacts'), 1, 'the stand does not duplicate an artifact already held');
del(player, 'zogre_artifacts');
player.invAdd(bankId, artifactId, 1);
interactLoc(player, stand, 1, '[oploc1,zogre_stand]');
assert.equal(count(player, 'zogre_artifacts'), 0, 'the stand does not duplicate a banked artifact');
assert.equal(count(player, 'zogre_artifacts', bankId), 1);
player.invDel(bankId, artifactId, 1);
interactLoc(player, stand, 1, '[oploc1,zogre_stand]');
assert.equal(count(player, 'zogre_artifacts'), 1, 'the stand replaces a lost artifact that is not in the bank');

// A player without a key can leave the burial chamber south-to-north through both doors.
assert.equal(count(player, 'zogre_tomb_artefact_key'), 0);
interactLoc(player, gateInner, 1, `[oploc1,${gateInnerRow.name}]`, [], tile => tile[2] < gateInner.z);
assert.equal(player.z, gateInner.z + 1, 'the south-side exit through the inner gate needs no key');
interactLoc(player, gateOuter, 1, `[oploc1,${gateOuterRow.name}]`, [], tile => tile[2] < gateOuter.z);
assert.equal(player.z, gateOuter.z + 1, 'the south-side exit through the outer gate needs no key');
const tombExit = floorLinks.find(link => link.entry.coord === tombEntrance.entry.counterpart.coord);
assert(tombExit, 'the outer stair names its native surface return');
interactLoc(player, tombExit.loc, 1, tombExit.trigger);
interactLoc(player, locFor(barricadeRows[0]), 1, '[oploc1,ogre_barricade_collapsedl]');


talkNpc(player, grish, '[opnpc1,zogre_ogre_shaman]');
assert.equal(player.level, 0, 'the full quest player returns from the tomb through its real stairs');
assert.equal(bit(player, 'zogre'), stage.complete, 'Grish completes the quest when handed the recovered artifact');
assert.equal(count(player, 'zogre_artifacts'), 0, 'completion consumes the returned artifact');
assert.equal(countQuestPoints(player) - questPointsBefore, questPointsAward, 'completion awards the period one quest point');
for (const [index, stat] of [PlayerStat.FLETCHING, PlayerStat.RANGED, PlayerStat.HERBLORE].entries()) {
  assert.equal(player.stats[stat] - rewardXpBefore[index], rewardXp,
    'completion awards exactly 2,000 XP in each sourced skill');
}
assert.equal(player.modalMain, questScroll, 'completion opens the packed quest scroll');
assert(text(player).includes('You have completed Zogre Flesh Eaters!'));
const completedStats = player.stats.slice();
talkNpc(player, grish, '[opnpc1,zogre_ogre_shaman]');
assert.equal(bit(player, 'zogre'), stage.complete, 'repeat Talk-to preserves quest completion');
assert.equal(countQuestPoints(player) - questPointsBefore, questPointsAward, 'repeat Talk-to awards no duplicate quest points');
assert.deepEqual(player.stats, completedStats, 'repeat Talk-to awards no duplicate XP');
assert.equal(count(player, 'zogre_tomb_artefact_key'), 1, 'completed Grish replaces the lost tomb key once');
talkNpc(player, grish, '[opnpc1,zogre_ogre_shaman]');
assert.equal(count(player, 'zogre_tomb_artefact_key'), 1, 'repeat completed recovery does not duplicate the tomb key');
del(player, 'zogre_tomb_artefact_key');
player.invAdd(bankId, obj('zogre_tomb_artefact_key'), 1);
talkNpc(player, grish, '[opnpc1,zogre_ogre_shaman]');
assert.equal(count(player, 'zogre_tomb_artefact_key'), 0, 'completed Grish does not duplicate a banked key');
player.invDel(bankId, obj('zogre_tomb_artefact_key'), 1);
talkNpc(player, grish, '[opnpc1,zogre_ogre_shaman]');
assert.equal(count(player, 'zogre_tomb_artefact_key'), 1, 'completed Grish replaces the unbanked lost key');

// Completion does not revoke the learned recipe; its real producer still serves Rum Deal.
const postQuestBalm = count(player, 'relicyms_balm3');
const postQuestHerblore = player.stats[PlayerStat.HERBLORE];
add(player, 'vial_water');
add(player, 'rogues_purse');
add(player, 'snake_weed');
useItemOnItem(player, 'rogues_purse', 'vial_water', '[opheldu,vial_water]');
assert.equal(count(player, 'rogues_purse_sol'), 1, 'the completed quest still permits the first balm recipe step');
useItemOnItem(player, 'rogues_purse_sol', 'snake_weed', '[opheldu,snake_weed]');
assert.equal(count(player, 'relicyms_balm3'), postQuestBalm + 1, 'the completed quest produces another three-dose balm');
assert.equal(player.stats[PlayerStat.HERBLORE] - postQuestHerblore, balmXp, 'post-quest brewing grants its configured recipe XP');
assert.equal(bit(player, 'zogre'), stage.complete, 'post-quest brewing preserves completion');

// A four-dose cure made from the post-quest recipe unlocks Uglug's sale and packed shop.
add(player, 'relicyms_balm1');
useItemOnItem(player, 'relicyms_balm3', 'relicyms_balm1', '[opheldu,_potion]');
assert.equal(count(player, 'relicyms_balm4'), 1, 'the packed decant handler combines the recipe balm into four doses');
const uglug = npcAt('zogre_uglug_nar');
const coinsBeforeUglug = count(player, 'coins');
useItemOnNpc(player, 'relicyms_balm4', uglug, '[opnpcu,zogre_uglug_nar]');
assert.equal(count(player, 'relicyms_balm4'), 0);
assert.equal(count(player, 'coins') - coinsBeforeUglug, 1000, 'Uglug pays the sourced 1,000 coins for a four-dose balm');
assert.equal(bit(player, 'thzfe_sold_balm'), 1, 'the balm sale unlocks Uglug’s shop');
talkNpc(player, uglug, '[opnpc1,zogre_uglug_nar]');
assert.equal(player.modalMain, id(types.Component, 'shop_template'), 'Uglug opens the packed shop after the balm sale');
assert.equal(player.modalSide, id(types.Component, 'shop_template_side'), 'the compiled shop opens its stock and player inventories');
const shopInventoryId = id(types.InvType, 'uglug_nar_shop');
assert.equal(varpValue(player, 'shop'), shopInventoryId, 'the compiled NPC-owned shop selects Uglug’s native inventory');
const shopComponentId = id(types.Component, 'shop_template:inv');
const stockListener = player.invListeners.find(entry => entry.type === shopInventoryId && entry.com === shopComponentId);
assert(stockListener, 'the shop transmits its actual native inventory to the stock component');
const shopStock = player.getInventoryFromListener(stockListener);
for (const name of ['achey_tree_logs', 'bow_string', 'relicyms_balm3']) {
  assert(shopStock.getItemCount(obj(name)) > 0, `Uglug’s compiled shop stocks the period ${name}`);
}
runPacked('[if_close,shop_template]', player);

// Isolated lifecycle fixtures seed an already-earned quest stage, never the death flag.
// The separate main player above reaches completion without any Zogre stage seed.
for (const encounter of [
  { name: 'Brentle', npc: 'zogre_human_brentle_vahn', loc: skeleton,
    trigger: '[oploc1,zogre_brentle_skeleton]', initial: stage.accepted,
    progress: 'thzfe_brentle_skele', expected: 1, leash: 'zogre_brentle_leash' },
  { name: 'Slash Bash', npc: 'zogre_slash_bash', loc: stand,
    trigger: '[oploc1,zogre_stand]', initial: stage.badNews,
    progress: 'zogre', expected: stage.bossActive, leash: 'zogre_slash_leash' }
]) {
  const owner = playerAt(tileOf(encounter.loc));
  bit(owner, 'zogre', encounter.initial);
  placeAtApproach(owner, encounter.loc, `${encounter.name} lifecycle setup`);
  interactLoc(owner, encounter.loc, 1, encounter.trigger);
  let actor = activeNpcNear(encounter.npc, tileOf(encounter.loc));
  assert.equal(actor.getVar(npcAttackingUid), owner.uid, `${encounter.name} lifecycle fixture is owner-bound`);
  assert.equal(bit(owner, encounter.progress), encounter.expected);
  const leash = integerConstant('scripts/quests/quest_zogre/configs/quest_zogre.constant', encounter.leash);
  const exit = floorLinks.find(link => {
    if (link.loc.level !== owner.level) return false;
    const distance = Math.max(Math.abs(link.loc.x - encounter.loc.x), Math.abs(link.loc.z - encounter.loc.z));
    return distance > leash && distance < 128 &&
      findPathToAny(tileOf(owner), approachTiles(owner, link.loc));
  });
  assert(exit, `${encounter.name} has a real packed-map departure route beyond its owner leash`);
  walkTo(owner, exit.loc);
  assert(Math.max(Math.abs(owner.x - encounter.loc.x), Math.abs(owner.z - encounter.loc.z)) > leash);
  advanceTo();
  actor.turn();
  assert(!actor.isActive, `${encounter.name} native timer removes the encounter when its owner leaves`);
  assert.equal(bit(owner, encounter.progress), encounter.expected, 'leaving grants no defeat credit');
  interactLoc(owner, encounter.loc, 1, encounter.trigger);
  actor = activeNpcNear(encounter.npc, tileOf(encounter.loc));
  assert.equal(actor.getVar(npcAttackingUid), owner.uid, `${encounter.name} can be summoned again after leaving`);

  // Seed only this fixture's health; the ordinary packed death queue writes %death.
  owner.levels[PlayerStat.HITPOINTS] = 0;
  const deathState = ScriptRunner.init(script('[queue,player_death_default]'), owner);
  deathState.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  owner.executeScript(deathState, true, true);
  assert.equal(deathState.execution, ScriptState.SUSPENDED, 'ordinary death pauses during its native animation');
  assert.equal(varpValue(owner, 'death'), 1, 'the native death queue opens the death window');
  advanceTo();
  actor.turn();
  assert(!actor.isActive, `${encounter.name} native timer removes the encounter during owner death`);
  assert.equal(bit(owner, encounter.progress), encounter.expected, 'owner death grants no defeat credit');
  driveState(owner, deathState);
  assert.equal(varpValue(owner, 'death'), 0, 'the ordinary death queue completes its native respawn');
  assert(owner.levels[PlayerStat.HITPOINTS] > 0, 'native respawn restores the fixture player’s hitpoints');
  assert.equal(bit(owner, encounter.progress), encounter.expected, 'ordinary respawn preserves encounter recovery');

  // Fixture travel returns the respawned owner; no encounter progress or NPC is seeded.
  placeAtApproach(owner, encounter.loc, `${encounter.name} post-death return`);
  interactLoc(owner, encounter.loc, 1, encounter.trigger);
  actor = activeNpcNear(encounter.npc, tileOf(encounter.loc));
  assert.equal(actor.getVar(npcAttackingUid), owner.uid, `${encounter.name} can be summoned again after owner death`);
  assert.equal(bit(owner, encounter.progress), encounter.expected);
  assert.equal(count(owner, 'zogre_artifacts'), 0, 'recovery cannot grant the unearned artefact');
  assert.equal(count(owner, 'zogre_brentle_vahn_backpack'), 0, 'recovery cannot grant an unearned backpack');
  walkTo(owner, exit.loc);
  advanceTo();
  actor.turn();
  assert(!actor.isActive, `${encounter.name} lifecycle fixture leaves no active encounter behind`);
}
const pete = npcAt('deal_pete');
placeAtApproach(player, pete, 'fixture travel to the Rum Deal start gate');
talkNpc(player, pete, '[opnpc1,deal_pete]', [0, 0, 0]);
assert.equal(varpValue(player, 'deal_quest'), 1, 'Pirate Pete accepts Rum Deal after the real Zogre completion');

console.log('PASS Zogre Flesh Eaters full progression, owner-bound encounters, native stairs/gates, recipes, rewards, recovery, Uglug and Rum Deal gate');

process.exit(0);
