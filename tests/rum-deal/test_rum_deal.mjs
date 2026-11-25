#!/usr/bin/env node
// Packed-runtime Rum Deal regression: real client handlers, visible forms and map collision.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BlockWalk, EntityLifeCycle, IfSetText, MessageGame, Npc, Player, PlayerStatMap,
  ResumePauseButton, ResumePauseButtonHandler, ScriptProvider, ScriptRunner, ScriptState,
  ServerTriggerType, World, content, engine, floorTiles, locFor, map, nativeLocRows,
  nativeNpcRows, tileFromCoord, tileOf, types, walkable
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
const IfButton = await load('network/game/client/model/IfButton.ts');
const IfButtonHandler = await load('network/game/client/handler/IfButtonHandler.ts');

Environment.NODE_MEMBERS = true;
Environment.NODE_XPRATE = 1;
assert(World.gameMap.getTotalLocs() > 0, 'complete packed world is loaded');

const invId = id(types.InvType, 'inv');
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
const questStages = { accepted: 1, blindweed: 2, blindweedPlaced: 3, water: 4, waterPlaced: 5,
  fish: 6, pressurised: 7, wrench: 8, blessed: 9, spirit: 10, spider: 11,
  spiderPlaced: 12, rumReady: 13, swill: 14, donnie: 15 };
const questComplete = integerConstant('scripts/general/configs/quest.constant', 'deal_complete');
const questPointAward = integerConstant('scripts/general/configs/quest.constant', 'deal_questpoints');
const zogreComplete = integerConstant('scripts/general/configs/quest.constant', 'zogre_complete');
const growthMinutes = integerConstant('scripts/quests/quest_deal/configs/quest_deal.constant', 'deal_growth_minutes');
const growthTicks = integerConstant('scripts/quests/quest_deal/configs/quest_deal.constant', 'deal_growth_check_ticks');
const diseaseTicks = integerConstant('scripts/quests/quest_deal/configs/quest_deal.constant', 'deal_disease_pulse_ticks');
const diseaseSeverity = integerConstant('scripts/quests/quest_deal/configs/quest_deal.constant', 'deal_disease_severity');
const npcAttackingUid = id(types.VarNpcType, 'npc_attacking_uid');
const npcMacroEventTarget = id(types.VarNpcType, 'npc_macro_event_target');
const aggressiveNpc = id(types.VarPlayerType, 'aggressive_npc');
const actionDelay = id(types.VarPlayerType, 'action_delay');
const questScroll = id(types.Component, 'questscroll_death');
const inventorySize = types.InvType.get(invId).size;
assert.equal(inventorySize, 28, 'the ordinary inventory has the packed 28 slots');

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
function readConstantFile(relative) {
  return fs.readFileSync(path.join(content, relative), 'utf8');
}
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
function count(player, name, inventory = invId) {
  return player.invTotal(inventory, obj(name));
}
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
  const player = new Player(`rumdeal_test_${serial}`, BigInt(5000 + serial), BigInt(7000 + serial));
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
    if (state >= 0 && state < type.multiloc.length && type.multiloc[state] !== -1) {
      type = types.LocType.get(type.multiloc[state]);
    }
  } else if (type.multivarbit !== -1) {
    const state = player.getVarBit(type.multivarbit);
    if (state >= 0 && state < type.multiloc.length && type.multiloc[state] !== -1) {
      type = types.LocType.get(type.multiloc[state]);
    }
  }
  return type.debugname;
}
function npcFootprint(actor, label) {
  const tile = tileOf(actor);
  for (let x = actor.x; x < actor.x + actor.width; x++) {
    for (let z = actor.z; z < actor.z + actor.length; z++) {
      walkable([actor.level, x, z], `${label} footprint ${x},${z}`);
    }
  }
  return tile;
}

function approachTiles(player, target, radius = 10) {
  const original = [player.level, player.x, player.z];
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
      const nx = x + dx, nz = z + dz;
      const key = `${nx},${nz}`;
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
function walkTo(player, target, filter = () => true) {
  travelFloors(player, target, filter);
  assert.equal(player.level, target.level, 'packed walk remains on one level');
  const approaches = approachTiles(player, target).filter(filter);
  assert(approaches.length, `packed collision map gives an operable approach to ${target.debugname ?? target.name ?? target.type}`);
  const route = findPathToAny([player.level, player.x, player.z], approaches);
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
    if (current.tile[0] === target.level && findPathToAny(current.tile, targets)) {
      route = current.links;
      break;
    }
    for (const [index, link] of floorLinks.entries()) {
      if (link.loc.level !== current.tile[0] || visited.has(link.to.join(','))) continue;
      if (!findPathToAny(current.tile, approaches[index])) continue;
      visited.add(link.to.join(','));
      queue.push({ tile: link.to, links: [...current.links, link] });
    }
  }
  assert(route, `native stairs and ladders connect the player to ${target.type} at ${target.level},${target.x},${target.z}`);
  for (const link of route) {
    interactLoc(player, link.loc, 1, link.trigger);
    assert.deepEqual(tileOf(player), link.to, `${link.trigger} uses its checked-out production landing`);
    walkable(link.to, `${link.trigger} landing`);
  }
}

function driveState(player, state, choices = []) {
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 500; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, `${state.script?.name ?? 'packed script'} does not abort`);
    if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, player.delayedUntil ?? 0);
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
function talkNpc(player, actor, expectedName, choices = []) {
  walkTo(player, actor);
  showNpc(player, actor);
  assert(npcHandler.handle(new OpNpc(1, actor.nid), player), 'production Talk-to packet accepts the visible NPC');
  assert.equal(player.target, actor);
  assert(player.validateTarget(), 'native NPC remains the interaction target');
  assert.equal(player.getOpTrigger()?.name, expectedName, 'visible NPC dispatch selects its packed Talk-to handler');
  return runInteraction(player, expectedName, choices, () => player.processInteraction());
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
function drink(player, itemName) {
  const itemId = obj(itemName), slot = itemSlot(player, itemName);
  const expectedName = `[opheld1,${itemName}]`;
  const executions = [];
  const original = player.executeScript;
  player.executeScript = function(state, ...args) {
    executions.push({ name: state.script?.name, state });
    return original.call(this, state, ...args);
  };
  let accepted;
  try { accepted = heldHandler.handle(new OpHeld(1, itemId, slot, inventoryCom.id), player); }
  finally { player.executeScript = original; }
  assert(accepted, `${itemName} Drink packet is accepted by the production held-item handler`);
  const state = executions.find(value => value.name === expectedName)?.state;
  assert(state, `production held-item dispatch executes ${expectedName}`);
  driveState(player, state, []);
  return state;
}
function pickGround(player, ground, itemName) {
  walkTo(player, ground);
  const option = types.ObjType.get(ground.type).op.findIndex(value => value === 'Take') + 1;
  assert(option > 0, `${itemName} has a packed ground Take option`);
  assert(objHandler.handle(new OpObj(option, ground.x, ground.z, ground.type), player), 'production Take packet accepts the real ground item');
  assert.equal(player.target, ground);
  player.processInteraction();
  assert.equal(count(player, itemName), 1, 'production ground-item interaction places the dropped item in inventory');
}
function runPacked(name, self, target = null, args = []) {
  const state = ScriptRunner.init(script(name), self, target, args);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  if (self instanceof Player) self.executeScript(state, true, true);
  else self.executeScript(state);
  assert.equal(state.execution, ScriptState.FINISHED, `${name} finishes through the packed script runner`);
  return state;
}
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
  const proc = script('[proc,player_combat_stat]');
  const state = ScriptRunner.init(proc, player);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  player.executeScript(state, true, true);
  assert.equal(state.execution, ScriptState.FINISHED, 'packed player combat stat setup finishes');
}
function killWithMelee(player, actor, label) {
  player.setVar(aggressiveNpc, actor.uid);
  for (let swing = 0; swing < 20 && actor.isActive && actor.levels[NpcStat.HITPOINTS] > 0; swing++) {
    World.currentTick = Math.max(World.currentTick + 1, player.getVar(actionDelay));
    withRandom([0.999999, 0, 0.999999], () => runPacked('[label,player_melee_attack]', player, actor));
    World.currentTick++;
    actor.turn();
    player.processQueues();
    if (actor.isActive && actor.levels[NpcStat.HITPOINTS] > 0) actor.turn();
    player.processQueues();
  }
  assert(!actor.isActive || actor.levels[NpcStat.HITPOINTS] === 0, `${label} falls to ordinary player melee damage`);
  for (let tick = 0; actor.isActive && tick < 128; tick++) {
    World.currentTick++;
    withRandom([0.999999, 0, 0.999999], () => actor.turn());
    player.processQueues();
  }
  assert(!actor.isActive, `${label} completes its real AI_QUEUE3 and npc_death lifecycle`);
  player.processQueues();
}
function readStairs() {
  const source = readConstantFile('scripts/quests/quest_deal/scripts/deal_travel.rs2');
  const proc = /\[proc,deal_stairs\][\s\S]*?(?=\n\[)/.exec(source)?.[0];
  assert(proc, 'checked-out travel script contains the production stair dispatcher');
  const blocks = /if \(\$up = true\) \{([\s\S]*?)\} else \{([\s\S]*?)\}/.exec(proc);
  assert(blocks, 'production stair dispatcher contains both directions');
  const parse = block => [...block.matchAll(/case\s+([0-3]_\d+_\d+_\d+_\d+)\s*:\s*p_telejump\(([0-3]_\d+_\d+_\d+_\d+)\)/g)]
    .map(match => ({ from: match[1], to: match[2] }));
  const up = parse(blocks[1]), down = parse(blocks[2]);
  assert(up.length > 0 && down.length > 0, 'production up/down stair links are present');
  return { up, down };
}
function readFloorLinks(stairLinks) {
  const links = [];
  for (const [name, rows] of [['deal_stairs_bottom', stairLinks.up], ['deal_stairs_top', stairLinks.down]]) {
    for (const link of rows) {
      const row = nativeLocRows(name).find(value => value.coord === link.from);
      assert(row, `${name} has its native production placement`);
      links.push({ loc: locFor(row), trigger: `[oploc1,${name}]`, to: tileFromCoord(link.to) });
    }
  }
  const source = readConstantFile('scripts/quests/quest_deal/scripts/deal_travel.rs2');
  for (const name of ['deal_ladder_up', 'deal_laddertop']) {
    const block = new RegExp(`\\[oploc1,${name}\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(source)?.[1];
    assert(block, `${name} has a checked-out production handler`);
    const relative = /climb_ladder\(movecoord\(loc_coord,\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\)/.exec(block);
    const absolute = /climb_ladder\(([0-3]_\d+_\d+_\d+_\d+)/.exec(block);
    assert(relative || absolute, `${name} declares its production ladder destination`);
    for (const row of nativeLocRows(name)) {
      const to = relative
        ? [row.level + Number(relative[2]), row.x + Number(relative[1]), row.z + Number(relative[3])]
        : tileFromCoord(absolute[1]);
      walkable(to, `${name} production landing`);
      links.push({ loc: locFor(row), trigger: `[oploc1,${name}]`, to });
    }
  }
  return links;
}
function telejumpDestination(triggerName) {
  const source = readConstantFile('scripts/quests/quest_deal/scripts/deal_travel.rs2');
  const escaped = triggerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(`\\[${escaped}\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(source)?.[1];
  const match = block && /p_telejump\((0_\d+_\d+_\d+_\d+|1_\d+_\d+_\d+_\d+)\)/.exec(block);
  assert(match, `${triggerName} has a checked-out production telejump destination`);
  return match[1];
}
function assertStairLink(rowName, from, to, reverseTo) {
  const row = nativeLocRows(rowName).find(value => value.coord === from);
  assert(row, `native map contains the real ${rowName} placement at ${from}`);
  const loc = locFor(row);
  const sourcePlayer = playerAt(tileOf(loc));
  const approach = approachTiles(sourcePlayer, loc)[0];
  assert(approach, `${rowName} has a genuine map interaction tile`);
  [sourcePlayer.level, sourcePlayer.x, sourcePlayer.z] = approach;
  walkable(tileOf(sourcePlayer), `${rowName} approach`);
  interactLoc(sourcePlayer, loc, 1, `[oploc1,${rowName}]`);
  const landing = tileFromCoord(to);
  assert.deepEqual(tileOf(sourcePlayer), landing, `${rowName} uses its current production landing`);
  walkable(landing, `${rowName} destination`);
  const otherName = rowName === 'deal_stairs_bottom' ? 'deal_stairs_top' : 'deal_stairs_bottom';
  const reverseRow = nativeLocRows(otherName)
    .filter(value => value.level === landing[0])
    .map(value => ({ row: value, distance: Math.abs(value.x - landing[1]) + Math.abs(value.z - landing[2]) }))
    .sort((a, b) => a.distance - b.distance)[0]?.row;
  assert(reverseRow, `${otherName} has a paired landing on the destination floor`);
  walkTo(sourcePlayer, locFor(reverseRow));
  interactLoc(sourcePlayer, locFor(reverseRow), 1, `[oploc1,${otherName}]`);
  const reverseLanding = tileFromCoord(reverseTo);
  assert.deepEqual(tileOf(sourcePlayer), reverseLanding, `${otherName} completes the paired stair return`);
  walkable(reverseLanding, `${otherName} return destination`);
}

// Every quest item is nontradeable in its packed config, not a script-only trade guard.
for (const item of ['fishbowl_net', 'deal_blindweed_seed', 'deal_blindweed', 'deal_stagnant_bucket', 'deal_wrench',
  'deal_wrench_blessed', 'deal_slugling', 'deal_karamthulhu', 'deal_spider_body', 'deal_bucket_swill',
  'deal_slayer_gloves', 'deal_rusty_scimitar']) {
  assert.equal(types.ObjType.get(obj(item)).tradeable, false, `${item} is config-nontradeable`);
}
assert(script('[opnpc1,deal_pete]') && script('[opnpc1,deal_island_pete]'), 'both real Pirate Pete forms dispatch');
assert(script('[opnpc1,deal_captian_braindeath]') && script('[opnpc1,deal_davey]'), 'Captain and Davey Talk-to handlers are packed');
assert(script('[opnpc1,deal_captian_donnie]'), 'Donnie Talk-to handler is packed');
assert(script('[oplocu,deal_hopper]') && script('[oplocu,deal_pressure]') && script('[oploc1,deal_lever_up]'), 'brewery ingredient, pressure and lever handlers are packed');
assert(script('[ai_opplayer2,deal_fever_spiders1]') && script('[ai_queue3,deal_fever_spiders1]'), 'Fever Spider attack and death triggers are packed');

// The staged stair data is read from the product dispatcher, never copied into the test.
const stairs = readStairs();
const upRows = nativeLocRows('deal_stairs_bottom');
const downRows = nativeLocRows('deal_stairs_top');
const floorLinks = readFloorLinks(stairs);
for (const link of stairs.up) {
  const row = upRows.find(value => value.coord === link.from);
  assert(row, `native bottom stair placement ${link.from} exists`);
  const landing = tileFromCoord(link.to);
  walkable(landing, `bottom stair destination ${link.to}`);
  const nearbyTop = downRows.filter(value => value.level === landing[0])
    .map(value => ({ row: value, distance: Math.abs(value.x - landing[1]) + Math.abs(value.z - landing[2]) }))
    .sort((a, b) => a.distance - b.distance)[0];
  assert(nearbyTop && nearbyTop.distance <= 8, `top stair has a reachable approach near ${link.to}`);
  const topFrom = nearbyTop.row.coord;
  const reverse = stairs.down.find(value => value.from === topFrom);
  assert(reverse, `paired top stair ${topFrom} has a production return link`);
  assertStairLink('deal_stairs_bottom', link.from, link.to, reverse.to);
}
for (const link of stairs.down) {
  const row = downRows.find(value => value.coord === link.from);
  assert(row, `native top stair placement ${link.from} exists`);
  walkable(tileFromCoord(link.to), `top stair destination ${link.to}`);
  const nearbyBottom = upRows.filter(value => value.level === tileFromCoord(link.to)[0])
    .map(value => ({ row: value, distance: Math.abs(value.x - tileFromCoord(link.to)[1]) + Math.abs(value.z - tileFromCoord(link.to)[2]) }))
    .sort((a, b) => a.distance - b.distance)[0];
  assert(nearbyBottom && nearbyBottom.distance <= 8, `bottom stair has a reachable approach near ${link.to}`);
}
const supportDecoration = locRow('deal_support_ladder');
assert.equal(types.LocType.get(supportDecoration.id).active, 0, 'the original support ladder remains inactive decoration');
assert.equal(World.getLoc(supportDecoration.x, supportDecoration.z, supportDecoration.level, supportDecoration.id), null,
  'inactive decoration does not supply a native interaction target');
assert(!ScriptProvider.getByName('[oploc1,deal_support_ladder]'), 'no unreachable operation is built for the inactive decoration');
const ladderLinks = floorLinks.filter(link => link.trigger.includes('ladder'));
for (const link of ladderLinks) {
  const climber = playerAt(tileOf(link.loc));
  const approach = approachTiles(climber, link.loc)[0];
  assert(approach, `${link.trigger} has a native interaction approach`);
  [climber.level, climber.x, climber.z] = approach;
  varpValue(climber, 'deal_quest', questStages.accepted);
  interactLoc(climber, link.loc, 1, link.trigger);
  assert.deepEqual(tileOf(climber), link.to, 'the native ladder action reaches its checked-out landing');
  walkable(tileOf(climber), 'native ladder landing');
  talkNpc(climber, npcAt('deal_island_pete'), '[opnpc1,deal_island_pete]');
  assert.deepEqual(tileOf(climber), tileFromCoord(telejumpDestination('opnpc1,deal_island_pete')),
    'every ladder landing retains a native route to the return boat');
}
console.log(`PASS Rum Deal floor links: ${stairs.up.length} up stairs, ${stairs.down.length} down stairs, ${ladderLinks.length} ladders, clear landings and native ladder egress`);

// Zogre and each current skill gate refuse through the real Pirate Pete Talk-to option.
const pete = npcAt('deal_pete');
const gateCases = [
  { label: 'Zogre Flesh Eaters', stat: null },
  { label: 'Farming 40', stat: 'FARMING', level: 39 },
  { label: 'Fishing 50', stat: 'FISHING', level: 49 },
  { label: 'Prayer 47', stat: 'PRAYER', level: 46 },
  { label: 'Crafting 42', stat: 'CRAFTING', level: 41 },
  { label: 'Slayer 42', stat: 'SLAYER', level: 41 }
];
for (const gate of gateCases) {
  const p = playerAt(tileOf(pete));
  bit(p, 'zogre', gate.stat === null ? 0 : zogreComplete);
  if (gate.stat) {
    const stat = PlayerStatMap.get(gate.stat);
    assert(Number.isInteger(stat), `${gate.stat} stat is loaded`);
    p.baseLevels[stat] = gate.level;
    p.levels[stat] = gate.level;
  }
  talkNpc(p, pete, '[opnpc1,deal_pete]');
  assert.equal(varpValue(p, 'deal_quest'), 0, `${gate.label} refusal leaves Rum Deal unstarted`);
  assert.match(text(p), /don't look like you'd be able to handle/i, `${gate.label} uses the actual prereq refusal`);
}

// A genuinely eligible player accepts all three authentic choice branches and is carried to the island.
const startPlayer = playerAt(tileOf(pete));
bit(startPlayer, 'zogre', zogreComplete);
runPacked('[proc,update_questpoints]', startPlayer);
const qpBefore = varpValue(startPlayer, 'qp');
const arrivalCoord = telejumpDestination('proc,deal_arrive');
const arrival = tileFromCoord(arrivalCoord);
talkNpc(startPlayer, pete, '[opnpc1,deal_pete]', [0, 0, 0]);
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.accepted, 'Pete accepts the quest and writes stage 1');
assert.deepEqual(tileOf(startPlayer), arrival, 'the accepted player reaches the production island landing');
walkable(arrival, 'Pirate Pete island arrival');
const islandPete = npcAt('deal_island_pete');
const returnCoord = telejumpDestination('opnpc1,deal_island_pete');
talkNpc(startPlayer, islandPete, '[opnpc1,deal_island_pete]');
assert.deepEqual(tileOf(startPlayer), tileFromCoord(returnCoord), 'the island Pirate Pete returns the player to Port Phasmatys');
walkable(tileOf(startPlayer), 'Pirate Pete port return');
talkNpc(startPlayer, pete, '[opnpc1,deal_pete]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.accepted, 'repeat travel does not reaccept or reset the quest');
assert.deepEqual(tileOf(startPlayer), arrival, 'the port Pirate Pete returns the player to the island');
walkable(arrival, 'repeat island arrival');

const captain = npcAt('deal_captian_braindeath');
talkNpc(startPlayer, captain, '[opnpc1,deal_captian_braindeath]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.blindweed, 'Captain asks for Blindweed and supplies its seed');
assert.equal(count(startPlayer, 'deal_blindweed_seed'), 1);

// Collect the real basement farming kit through Open -> Search, then use the visible patch forms.
let cupboard = locFor(locRow('deal_broomcupboard'));
interactLoc(startPlayer, cupboard, 1, '[oploc1,deal_broomcupboard]');
assert.equal(types.LocType.get(cupboard.type).debugname, 'deal_broomcupboard_open', 'Open changes the native cupboard to its visible open form');
const openCupboard = World.getLoc(cupboard.x, cupboard.z, cupboard.level, id(types.LocType, 'deal_broomcupboard_open'));
assert(openCupboard, 'the production cupboard open form exists in the world map');
interactLoc(startPlayer, openCupboard, 2, '[oploc2,deal_broomcupboard_open]', [3]);
for (const tool of ['rake', 'dibber', 'watering_can_8']) assert.equal(count(startPlayer, tool), 1, `Search supplies one ${tool}`);
const patch = locFor(locRow('deal_blindweed'));
walkTo(startPlayer, patch);
assert.equal(bit(startPlayer, 'deal_farming'), 0, 'the original patch begins at its weediest form');
for (const [state, face] of [[0, 'deal_blindweed_weeds3'], [1, 'deal_blindweed_weeds2'], [2, 'deal_blindweed_weeds1']]) {
  assert.equal(bit(startPlayer, 'deal_farming'), state);
  const trigger = `[oplocu,${face}]`;
  assert.equal(visibleLocName(startPlayer, patch), face, `patch morph ${state} is the visible ${face} form`);
  useItemOnLoc(startPlayer, 'rake', patch, trigger);
  assert.equal(bit(startPlayer, 'deal_farming'), state + 1, `${face} is cleared by the actual held-item interaction`);
}
assert.equal(visibleLocName(startPlayer, patch), 'deal_blindweed_empty', 'three rake actions expose the original empty form');
useItemOnLoc(startPlayer, 'deal_blindweed_seed', patch, '[oplocu,deal_blindweed_empty]');
assert.equal(bit(startPlayer, 'deal_farming'), 4, 'planting writes the planted patch state');
assert.equal(count(startPlayer, 'deal_blindweed_seed'), 0, 'planting consumes the seed');
assert.equal(count(startPlayer, 'dibber'), 1, 'the seed dibber is retained');
const growthTimer = script('[timer,deal_growth]');
const plantedTimer = startPlayer.timers.get(growthTimer.id);
assert(plantedTimer, 'planting arms the real packed crop-growth timer');
assert.equal(plantedTimer.interval, growthTicks, 'growth uses the checked-in timer interval');
const originalNowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
const originalNow = performance.now.bind(performance);
try {
  Object.defineProperty(performance, 'now', { configurable: true, value: () => originalNow() + growthMinutes * 60000 });
  World.currentTick = plantedTimer.clock + plantedTimer.interval;
  startPlayer.processTimers(plantedTimer.type);
} finally {
  if (originalNowDescriptor) Object.defineProperty(performance, 'now', originalNowDescriptor);
  else delete performance.now;
}
assert.equal(bit(startPlayer, 'deal_farming'), 5, 'the production timer matures the crop at its configured deadline');
assert.equal(visibleLocName(startPlayer, patch), 'deal_blindweed_fullygrown', "the grown plant is the client's visible patch form");
interactLoc(startPlayer, patch, 1, '[oploc1,deal_blindweed_fullygrown]');
assert.equal(bit(startPlayer, 'deal_farming'), 3, 'harvest returns the plot to empty');
assert.equal(count(startPlayer, 'deal_blindweed'), 1, 'harvest produces Blindweed');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.blindweed, 'harvesting itself does not skip the hopper stage');
del(startPlayer, 'deal_blindweed');
talkNpc(startPlayer, captain, '[opnpc1,deal_captian_braindeath]');
assert.equal(count(startPlayer, 'deal_blindweed'), 1, 'Captain replaces a lost harvested herb through the researched recovery branch');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.blindweed, 'recovery does not bypass the ingredient hopper');

// Blindweed, water, five mixed catches and the pressure gate are all real client interactions.
const hopper = locFor(locRow('deal_hopper'));
useItemOnLoc(startPlayer, 'deal_blindweed', hopper, '[oplocu,deal_hopper]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.blindweedPlaced, 'the Intake Hopper accepts the harvested Blindweed');
talkNpc(startPlayer, captain, '[opnpc1,deal_captian_braindeath]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.water, 'Captain asks for stagnant water and supplies an empty bucket');
assert.equal(count(startPlayer, 'bucket_empty'), 1);
const gate = locFor(locRow('deal_gate_closed'));
const lukeRows = nativeNpcRows('deal_50luke');
if (lukeRows.length) spawnNpc(lukeRows[0]);
const gateStart = tileOf(startPlayer);
const gateTrigger = '[oploc1,deal_gate_closed]';
interactLoc(startPlayer, gate, 1, gateTrigger, [], tile => tile[2] <= gate.z);
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.water, 'the stage-four gate leaves the quest stage intact');
assert.equal(bit(startPlayer, 'deal_diversion'), 1, 'the eligible player uses the actual diversion through the gate');
assert.equal(startPlayer.z, gate.z + 1, 'the gate crosses only from its southern interaction side');
assert.notDeepEqual(tileOf(startPlayer), gateStart, 'the diversion moves the player through the gate');
const stagnant = locFor(locRow('deal_stagnant'));
walkTo(startPlayer, stagnant);
useItemOnLoc(startPlayer, 'bucket_empty', stagnant, '[oplocu,deal_stagnant]');
assert.equal(count(startPlayer, 'deal_stagnant_bucket'), 1, 'the lake fills the empty bucket with the packed stagnant-water item');
assert.equal(count(startPlayer, 'bucket_empty'), 0);
const lakeExitStart = tileOf(startPlayer);
interactLoc(startPlayer, gate, 1, gateTrigger, [], tile => tile[2] > gate.z);
assert.equal(startPlayer.z, gate.z - 1, 'the north-side gate action returns the player south');
assert.notDeepEqual(tileOf(startPlayer), lakeExitStart, 'the actual north-to-south gate return changes position');
useItemOnLoc(startPlayer, 'deal_stagnant_bucket', hopper, '[oplocu,deal_hopper]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.waterPlaced, 'the Hopper accepts the stagnant-water bucket');
talkNpc(startPlayer, captain, '[opnpc1,deal_captian_braindeath]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.fish, 'Captain supplies the fishbowl net and requests five creatures');
assert.equal(count(startPlayer, 'fishbowl_net'), 1);
const squid = npcAt('deal_squid');
const fishValues = [0.1, 0.9, 0.1, 0.9, 0.1, 0.9];
for (let i = 0; i < fishValues.length; i++) {
  if (i === 0) {
    withRandom(fishValues[i], () => talkNpc(startPlayer, squid, '[opnpc1,deal_squid]'));
  } else if (i === 1) {
    withRandom(fishValues[i], () => useItemOnNpc(startPlayer, 'fishbowl_net', squid, '[opnpcu,deal_squid]'));
  } else {
    withRandom(fishValues[i], () => talkNpc(startPlayer, squid, '[opnpc1,deal_squid]'));
  }
}
assert.equal(bit(startPlayer, 'deal_squidfish'), 6, 'six real fishing actions increment the capped catch counter');
assert.equal(count(startPlayer, 'deal_slugling'), 3, 'the five required catches include three Sluglings');
assert.equal(count(startPlayer, 'deal_karamthulhu'), 3, 'the five required catches include Karamthulhu');
const pressure = locFor(locRow('deal_pressure'));
const lever = locFor(locRow('deal_multi_lever'));
const insertionOrder = ['deal_slugling', 'deal_karamthulhu', 'deal_slugling', 'deal_karamthulhu'];
for (const ingredient of insertionOrder) useItemOnLoc(startPlayer, ingredient, pressure, '[oplocu,deal_pressure]');
assert.equal(bit(startPlayer, 'deal_barrel'), 4, 'four inserted creatures leave the pressure gate closed');
assert.equal(visibleLocName(startPlayer, lever), 'deal_lever_down', 'the lever remains in its down form below five');
interactLoc(startPlayer, lever, 1, '[oploc1,deal_lever_down]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.fish, 'the lever refuses pressure before five creatures');
useItemOnLoc(startPlayer, 'deal_slugling', pressure, '[oplocu,deal_pressure]');
assert.equal(bit(startPlayer, 'deal_barrel'), 5);
assert.equal(count(startPlayer, 'deal_karamthulhu'), 1, 'one surplus catch remains after the five-creature limit');
clearOutput(startPlayer);
interactLoc(startPlayer, pressure, 2, '[oploc2,deal_pressure]');
assert.equal(text(startPlayer), '5', 'Pressure Count prints only the count whose prose is unknown');
useItemOnLoc(startPlayer, 'deal_karamthulhu', pressure, '[oplocu,deal_pressure]');
assert.equal(bit(startPlayer, 'deal_barrel'), 5, 'a sixth creature cannot overfill the barrel');
assert.equal(count(startPlayer, 'deal_karamthulhu'), 1, 'the refused sixth catch is not consumed');
assert.equal(visibleLocName(startPlayer, lever), 'deal_lever_up', 'five ingredients reveal the pullable lever form');
interactLoc(startPlayer, lever, 1, '[oploc1,deal_lever_up]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.pressurised, 'the actual five-item lever action advances the chain');
talkNpc(startPlayer, captain, '[opnpc1,deal_captian_braindeath]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.wrench, 'Captain supplies the ordinary wrench');
assert.equal(bit(startPlayer, 'deal_multi_hopper'), 1, 'the brewery control is in its possessed visible form');
assert.equal(count(startPlayer, 'deal_wrench'), 1);

// Davey's current Prayer gate is tested before the main player's real blessing.
const davey = npcAt('deal_davey');
const lowPrayer = playerAt(tileOf(davey));
varpValue(lowPrayer, 'deal_quest', questStages.wrench);
lowPrayer.baseLevels[PlayerStat.PRAYER] = 46;
lowPrayer.levels[PlayerStat.PRAYER] = 46;
add(lowPrayer, 'deal_wrench');
talkNpc(lowPrayer, davey, '[opnpc1,deal_davey]');
assert.equal(varpValue(lowPrayer, 'deal_quest'), questStages.wrench, 'Prayer 46 cannot bless the wrench');
assert.equal(count(lowPrayer, 'deal_wrench'), 1, 'Davey keeps the ordinary wrench on refusal');
assert.equal(count(lowPrayer, 'deal_wrench_blessed'), 0);
talkNpc(startPlayer, davey, '[opnpc1,deal_davey]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.blessed, "Prayer 47 blesses the player's actual wrench");
assert.equal(count(startPlayer, 'deal_wrench'), 0);
assert.equal(count(startPlayer, 'deal_wrench_blessed'), 1);

// Summoning, owner identity, duplicate refusal and player-driven combat credit.
const control = locFor(locRow('deal_multicontrol'));
const evilId = id(types.NpcType, 'deal_evil_spirit');
const spiritsFor = player => [...World.npcs].filter(actor => actor.type === evilId && actor.isActive && actor.getVar(npcAttackingUid) === player.uid);
const existingSpirits = new Set([...World.npcs].filter(actor => actor.type === evilId).map(actor => actor.nid));
useItemOnLoc(startPlayer, 'deal_wrench_blessed', control, '[oplocu,deal_brew_control_spin]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.blessed, 'summoning does not award defeat credit');
let ownedSpirit = spiritsFor(startPlayer).find(actor => !existingSpirits.has(actor.nid));
assert(ownedSpirit, 'the real control input summons an Evil Spirit');
assert.equal(ownedSpirit.getVar(npcMacroEventTarget), startPlayer.uid, 'the engine macro-event target is the summoning player');
npcFootprint(ownedSpirit, 'Evil Spirit');
walkTo(startPlayer, ownedSpirit);
const afterFirstSummon = new Set([...World.npcs].filter(actor => actor.type === evilId && actor.isActive).map(actor => actor.nid));
useItemOnLoc(startPlayer, 'deal_wrench_blessed', control, '[oplocu,deal_brew_control_spin]');
assert.deepEqual(new Set([...World.npcs].filter(actor => actor.type === evilId && actor.isActive).map(actor => actor.nid)), afterFirstSummon,
  'retrying the control while the owner encounter exists does not duplicate it');
const secondOwner = playerAt(tileOf(control));
varpValue(secondOwner, 'deal_quest', questStages.blessed);
bit(secondOwner, 'deal_multi_hopper', 1);
add(secondOwner, 'deal_wrench_blessed');
useItemOnLoc(secondOwner, 'deal_wrench_blessed', control, '[oplocu,deal_brew_control_spin]');
const secondSpirit = spiritsFor(secondOwner)[0];
assert(secondSpirit, 'a second player can own an independent encounter');
assert.notEqual(secondSpirit.uid, ownedSpirit.uid);
npcFootprint(secondSpirit, 'second-owner Evil Spirit');
add(startPlayer, 'bronze_scimitar');
const bronze = types.ObjType.get(obj('bronze_scimitar'));
startPlayer.getInventory(wornId).set(bronze.wearpos, { id: bronze.id, count: 1 });
setCombat(startPlayer);
attackNpc(startPlayer, ownedSpirit);
killWithMelee(startPlayer, ownedSpirit, 'summoner-owned Evil Spirit');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.spirit, 'the summoning player receives defeat credit through the real death queue');
assert.equal(varpValue(secondOwner, 'deal_quest'), questStages.blessed, 'another owner receives no credit for the first spirit');
add(secondOwner, 'bronze_scimitar');
secondOwner.getInventory(wornId).set(bronze.wearpos, { id: bronze.id, count: 1 });
setCombat(secondOwner);
attackNpc(secondOwner, secondSpirit);
killWithMelee(secondOwner, secondSpirit, 'second-owner Evil Spirit');
assert.equal(varpValue(secondOwner, 'deal_quest'), questStages.spirit, 'each owner gets only the defeat of their own encounter');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.spirit, 'a second defeat cannot advance the first owner twice');

// Fever Spider disease, Slayer Gloves immunity, Relicym's Balm cure, death drop and Hopper use.
talkNpc(startPlayer, captain, '[opnpc1,deal_captian_braindeath]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.spider, 'Captain requests a Fever Spider body');
const spider = npcAt('deal_fever_spiders1');
npcFootprint(spider, 'native Fever Spider');
walkTo(startPlayer, spider);
const diseaseVarp = varp('disease');
assert.equal(varpValue(startPlayer, 'disease'), 0, 'the test player starts disease-free');
startPlayer.baseLevels[PlayerStat.ATTACK] = startPlayer.levels[PlayerStat.ATTACK] = 1;
startPlayer.baseLevels[PlayerStat.STRENGTH] = startPlayer.levels[PlayerStat.STRENGTH] = 1;
startPlayer.baseLevels[PlayerStat.DEFENCE] = startPlayer.levels[PlayerStat.DEFENCE] = 1;
setCombat(startPlayer);
const diseaseQueueBefore = [...startPlayer.queue.all()].filter(request => request.script?.name === '[queue,deal_disease_apply]').length;
const spiderAttackScripts = [];
const originalSpiderExecute = spider.executeScript;
spider.executeScript = function(state, ...args) {
  if (state.script?.name === '[ai_opplayer2,deal_fever_spiders1]') {
    spiderAttackScripts.push(state.script.name);
  }
  return originalSpiderExecute.call(this, state, ...args);
};
// Fixture travel does not run world ticks: let the prior Spirit combat lock expire.
World.currentTick = Math.max(World.currentTick + 1, startPlayer.getVar(actionDelay),
  startPlayer.getVar(varp('lastcombat')) + 8, startPlayer.getVar(varp('lastcombat_pvp')) + 8);
try {
  withRandom([0.999999, 0, 0.999999], () => attackNpc(startPlayer, spider));
  assert.equal(spider.getVar(id(types.VarNpcType, 'npc_aggressive_player')), startPlayer.uid,
    'the real Attack operation establishes the Spider retaliation target');
  for (let tick = 0; tick < 64; tick++) {
    const queued = [...startPlayer.queue.all()].filter(request => request.script?.name === '[queue,deal_disease_apply]');
    if (queued.length > diseaseQueueBefore) break;
    World.currentTick++;
    withRandom([0.999999, 0, 0.999999], () => spider.turn());
    if ([...startPlayer.queue.all()].some(request => request.script?.name === '[queue,deal_disease_apply]')) break;
    startPlayer.processQueues();
  }
  assert(spiderAttackScripts.length > 0, 'the native attack interaction produces a real Fever Spider AI attack');
  const diseaseQueue = [...startPlayer.queue.all()].filter(request => request.script?.name === '[queue,deal_disease_apply]');
  assert.equal(diseaseQueue.length, diseaseQueueBefore + 1, 'an actual successful unprotected Fever Spider attack queues disease');
  World.currentTick++;
  startPlayer.processQueues();
  assert.equal(startPlayer.getVar(diseaseVarp), diseaseSeverity, 'the actual disease queue writes its configured non-HP severity');
  const diseaseTimer = script('[timer,deal_disease]');
  const armedDiseaseTimer = startPlayer.timers.get(diseaseTimer.id);
  assert(armedDiseaseTimer, 'disease arms its production pulse timer');
  assert.equal(armedDiseaseTimer.interval, diseaseTicks);
  const attackStat = PlayerStat.ATTACK;
  const attackBeforeDisease = startPlayer.levels[attackStat];
  World.currentTick = armedDiseaseTimer.clock + armedDiseaseTimer.interval;
  startPlayer.processTimers(armedDiseaseTimer.type);
  withRandom(0.01, () => startPlayer.processQueues());
  assert.equal(startPlayer.getVar(diseaseVarp), diseaseSeverity - 1, 'the real disease timer applies one pulse');
  assert.equal(startPlayer.levels[attackStat], attackBeforeDisease - 1, 'the pulse drains a non-HP skill instead of HP');
  add(startPlayer, 'relicyms_balm4');
  drink(startPlayer, 'relicyms_balm4');
  assert.equal(startPlayer.getVar(diseaseVarp), 0, 'the real Relicym held-item handler cures disease');
  assert.equal(count(startPlayer, 'relicyms_balm3'), 1, 'the consumed balm dose advances to its next packed form');
  for (const [dose, next] of [['relicyms_balm3', 'relicyms_balm2'], ['relicyms_balm2', 'relicyms_balm1'], ['relicyms_balm1', 'vial_empty']]) {
    const nextBefore = count(startPlayer, next);
    drink(startPlayer, dose);
    assert.equal(count(startPlayer, dose), 0, `${dose} is consumed by its real Drink operation`);
    assert.equal(count(startPlayer, next), nextBefore + 1, `${dose} advances to the packed ${next}`);
    assert.equal(startPlayer.getVar(diseaseVarp), 0, 'all four Balm doses finish without adding disease');
  }
  const gloves = types.ObjType.get(obj('deal_slayer_gloves'));
  startPlayer.getInventory(wornId).set(gloves.wearpos, { id: gloves.id, count: 1 });
  const protectedQueueBefore = [...startPlayer.queue.all()].filter(request => request.script?.name === '[queue,deal_disease_apply]').length;
  const protectedAttackBefore = spiderAttackScripts.length;
  const hitpointsBeforeProtected = startPlayer.levels[PlayerStat.HITPOINTS];
  for (let tick = 0; tick < 64 && startPlayer.levels[PlayerStat.HITPOINTS] === hitpointsBeforeProtected; tick++) {
    World.currentTick++;
    withRandom([0.999999, 0, 0.999999], () => spider.turn());
    startPlayer.processQueues();
  }
  assert(spiderAttackScripts.length > protectedAttackBefore, 'a second native Fever Spider attack is processed with the gloves worn');
  assert(startPlayer.levels[PlayerStat.HITPOINTS] < hitpointsBeforeProtected, 'the protected fixture observes a real successful Spider attack');
  assert.equal([...startPlayer.queue.all()].filter(request => request.script?.name === '[queue,deal_disease_apply]').length, protectedQueueBefore,
    'worn Slayer Gloves prevent the actual attack from queuing disease');
  assert.equal(startPlayer.getVar(diseaseVarp), 0);
} finally {
  spider.executeScript = originalSpiderExecute;
}

for (const stat of [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE]) {
  startPlayer.baseLevels[stat] = 99;
  startPlayer.levels[stat] = 99;
}
setCombat(startPlayer);

const bodyId = obj('deal_spider_body');
const bodyDrops = [];
// Observe the production drop call without preserving or reinserting the dying NPC.
const addObj = World.addObj;
World.addObj = function(ground, receiver, duration) {
  const result = addObj.call(this, ground, receiver, duration);
  if (ground.type === bodyId) bodyDrops.push({ x: ground.x, z: ground.z, level: ground.level, type: ground.type });
  return result;
};
try {
  attackNpc(startPlayer, spider);
  killWithMelee(startPlayer, spider, 'native Fever Spider');
} finally {
  World.addObj = addObj;
}
const bodyDrop = bodyDrops.find(drop => drop.type === bodyId);
assert(bodyDrop, 'the real Fever Spider death trigger drops its body through the native death queue');
const body = World.getObj(bodyDrop.x, bodyDrop.z, bodyDrop.level, bodyId, startPlayer.hash64);
assert(body, 'the body is an actual ground object on the NPC death trigger tile');
pickGround(startPlayer, body, 'deal_spider_body');
useItemOnLoc(startPlayer, 'deal_spider_body', hopper, '[oplocu,deal_hopper]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.spiderPlaced, 'the Hopper accepts the recovered Fever Spider body');
assert.equal(count(startPlayer, 'deal_spider_body'), 0);

// The tap yields swill, Donnie receives it, and the Captain completion is one-shot.
talkNpc(startPlayer, captain, '[opnpc1,deal_captian_braindeath]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.rumReady, 'Captain starts the final brew and gives a bucket');
assert.equal(count(startPlayer, 'bucket_empty'), 1);
const tap = locFor(locRow('deal_brewvat_tap'));
useItemOnLoc(startPlayer, 'bucket_empty', tap, '[oplocu,deal_brewvat_tap]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.swill, 'the output tap fills the bucket with quest swill');
assert.equal(count(startPlayer, 'deal_bucket_swill'), 1);
assert.equal(count(startPlayer, 'bucket_empty'), 0);
const donnie = npcAt('deal_captian_donnie');
talkNpc(startPlayer, donnie, '[opnpc1,deal_captian_donnie]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questStages.donnie, 'Donnie accepts the rum and returns an empty bucket');
assert.equal(count(startPlayer, 'deal_bucket_swill'), 0);
assert.equal(count(startPlayer, 'bucket_empty'), 1);
const xpBefore = [PlayerStat.PRAYER, PlayerStat.FISHING, PlayerStat.FARMING].map(stat => startPlayer.stats[stat]);
const mainQpBefore = varpValue(startPlayer, 'qp');
talkNpc(startPlayer, captain, '[opnpc1,deal_captian_braindeath]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questComplete, 'the final Captain conversation completes Rum Deal');
assert.equal(varpValue(startPlayer, 'qp') - mainQpBefore, questPointAward, 'completion grants exactly the period two quest points');
for (const [index, stat] of [PlayerStat.PRAYER, PlayerStat.FISHING, PlayerStat.FARMING].entries()) {
  assert.equal(startPlayer.stats[stat] - xpBefore[index], 70000, 'completion grants exactly 7000 XP in tenths');
}
assert.equal(count(startPlayer, 'deal_wrench_blessed'), 1, 'completion does not duplicate Davey’s retained Holy Wrench');
assert.equal(startPlayer.modalMain, questScroll, 'completion opens the packed quest completion scroll');
assert(text(startPlayer).includes('You have completed Rum Deal!'), 'the completion scroll names Rum Deal');
const completedStats = startPlayer.stats.slice();
talkNpc(startPlayer, captain, '[opnpc1,deal_captian_braindeath]');
assert.equal(varpValue(startPlayer, 'deal_quest'), questComplete, 'replaying the final talk preserves completion');
assert.deepEqual(startPlayer.stats, completedStats, 'replaying grants no duplicate XP');
assert.equal(varpValue(startPlayer, 'qp') - mainQpBefore, questPointAward, 'replaying grants no duplicate quest points');
assert.equal(count(startPlayer, 'deal_wrench_blessed'), 1, 'replaying grants no duplicate Holy Wrench');
console.log('PASS Rum Deal start gates, island return, patch/growth, water, fishing, pressure, owner-bound combat, disease, brew, completion and rewards');

// Full inventory uses a real ground fallback, and post-quest Davey replaces a lost wrench only.
const fullInventoryPlayer = playerAt(tileOf(captain));
varpValue(fullInventoryPlayer, 'deal_quest', questStages.donnie);
fullInventoryPlayer.getInventory(invId);
for (let slot = 0; slot < inventorySize; slot++) fullInventoryPlayer.getInventory(invId).set(slot, { id: obj('spade'), count: 1 });
assert.equal(fullInventoryPlayer.invFreeSpace(invId), 0);
const fullXpBefore = [PlayerStat.PRAYER, PlayerStat.FISHING, PlayerStat.FARMING].map(stat => fullInventoryPlayer.stats[stat]);
const fullQpBefore = varpValue(fullInventoryPlayer, 'qp');
talkNpc(fullInventoryPlayer, captain, '[opnpc1,deal_captian_braindeath]');
assert.equal(varpValue(fullInventoryPlayer, 'deal_quest'), questComplete);
assert.equal(count(fullInventoryPlayer, 'deal_wrench_blessed'), 0, 'full inventory cannot silently lose or duplicate the reward');
assert.equal(fullInventoryPlayer.invFreeSpace(invId), 0);
const wrenchGround = World.getObj(fullInventoryPlayer.x, fullInventoryPlayer.z, fullInventoryPlayer.level, obj('deal_wrench_blessed'), fullInventoryPlayer.hash64);
assert(wrenchGround, 'full inventory places the Holy Wrench on the actual ground');
for (const [index, stat] of [PlayerStat.PRAYER, PlayerStat.FISHING, PlayerStat.FARMING].entries()) {
  assert.equal(fullInventoryPlayer.stats[stat] - fullXpBefore[index], 70000);
}
assert.equal(varpValue(fullInventoryPlayer, 'qp') - fullQpBefore, questPointAward);
fullInventoryPlayer.getInventory(invId).set(inventorySize - 1, null);
pickGround(fullInventoryPlayer, wrenchGround, 'deal_wrench_blessed');
assert.equal(count(fullInventoryPlayer, 'deal_wrench_blessed'), 1);

const daveyReturn = npcAt('deal_davey');
del(startPlayer, 'deal_wrench_blessed');
talkNpc(startPlayer, daveyReturn, '[opnpc1,deal_davey]');
assert.equal(count(startPlayer, 'deal_wrench_blessed'), 1, 'completed Davey replaces a lost Holy Wrench once');
talkNpc(startPlayer, daveyReturn, '[opnpc1,deal_davey]');
assert.equal(count(startPlayer, 'deal_wrench_blessed'), 1, 'repeat recovery does not duplicate the wrench');
const islandReturn = npcAt('deal_island_pete');
const portCoord = telejumpDestination('opnpc1,deal_island_pete');
talkNpc(startPlayer, islandReturn, '[opnpc1,deal_island_pete]');
assert.deepEqual(tileOf(startPlayer), tileFromCoord(portCoord), 'post-quest island Pete still returns to Port Phasmatys');
talkNpc(startPlayer, pete, '[opnpc1,deal_pete]');
assert.deepEqual(tileOf(startPlayer), arrival, 'post-quest Port Pete still returns to Braindeath Island');
assert.equal(varpValue(startPlayer, 'deal_quest'), questComplete, 'post-quest travel preserves completion');

// Prayer and Super Restore baselines use real Drink dispatch; the Holy Wrench bonus remains capped.
function potionFixture(name, hasWrench, currentPrayer, basePrayer) {
  const p = playerAt(tileOf(pete));
  p.baseLevels[PlayerStat.PRAYER] = basePrayer;
  p.levels[PlayerStat.PRAYER] = currentPrayer;
  add(p, name);
  if (hasWrench) add(p, 'deal_wrench_blessed');
  return p;
}
for (const potion of ['4doseprayerrestore', '4dose2restore']) {
  const baseline = potionFixture(potion, false, 1, 50);
  const blessed = potionFixture(potion, true, 1, 50);
  const before = [baseline.levels[PlayerStat.PRAYER], blessed.levels[PlayerStat.PRAYER]];
  drink(baseline, potion);
  drink(blessed, potion);
  assert.equal(blessed.levels[PlayerStat.PRAYER] - before[1], baseline.levels[PlayerStat.PRAYER] - before[0] + 1,
    `${potion} receives the packed 27%-versus-25% Holy Wrench increment`);
  const capped = potionFixture(potion, true, 98, 99);
  drink(capped, potion);
  assert.equal(capped.levels[PlayerStat.PRAYER], 99, `${potion} cannot restore Prayer above its base-level cap`);
}
console.log('PASS full-inventory reward recovery, post-quest boat/Davey recovery, and capped Prayer/Super Restore wrench bonuses');

// The natural Spirit timer removes a departed or dying owner without defeat credit.
const recoveryOwner = playerAt(arrival);
varpValue(recoveryOwner, 'deal_quest', questStages.blessed);
bit(recoveryOwner, 'deal_multi_hopper', 1);
add(recoveryOwner, 'deal_wrench_blessed');
useItemOnLoc(recoveryOwner, 'deal_wrench_blessed', control, '[oplocu,deal_brew_control_spin]');
let recoverySpirit = spiritsFor(recoveryOwner)[0];
assert(recoverySpirit, 'the recovery fixture summons through the real control action');
assert.equal(recoverySpirit.timerInterval, 1, 'summoning arms the native one-tick owner timer');
[recoveryOwner.level, recoveryOwner.x, recoveryOwner.z] = tileFromCoord(returnCoord);
recoveryOwner.buildArea.rebuild();
World.currentTick++;
recoverySpirit.turn();
assert.equal(recoverySpirit.isActive, false, 'leaving the island removes the owned Spirit through its natural timer');
assert.equal(varpValue(recoveryOwner, 'deal_quest'), questStages.blessed, 'leaving grants no defeat credit');
[recoveryOwner.level, recoveryOwner.x, recoveryOwner.z] = arrival;
recoveryOwner.buildArea.rebuild();
useItemOnLoc(recoveryOwner, 'deal_wrench_blessed', control, '[oplocu,deal_brew_control_spin]');
recoverySpirit = spiritsFor(recoveryOwner)[0];
assert(recoverySpirit, 'returning permits a new owner-bound encounter');
assert.equal(spiritsFor(recoveryOwner).length, 1, 'recovery still permits only one active owned Spirit');

// A fresh session has persisted severity but no session timers; the shared login restores it.
runPacked('[queue,deal_disease_apply]', recoveryOwner);
assert.equal(varpValue(recoveryOwner, 'disease'), diseaseSeverity);
recoveryOwner.timers.clear();
runPacked('[login,_]', recoveryOwner);
const resumedDisease = recoveryOwner.timers.get(script('[timer,deal_disease]').id);
assert(resumedDisease, 'the actual shared login restores the saved disease timer');
assert.equal(resumedDisease.interval, diseaseTicks);
assert.equal(varpValue(recoveryOwner, 'disease'), diseaseSeverity, 'login does not cure saved disease');

// Start the real strong death queue, observe its death flag during the first delay, then resume it.
runPacked('[proc,player_die]', recoveryOwner);
runInteraction(recoveryOwner, '[queue,player_death_default]', [], () => {
  World.currentTick++;
  recoveryOwner.processQueues();
  assert.equal(varpValue(recoveryOwner, 'death'), 1, 'the actual death queue marks the owner dead before its delay');
  World.currentTick++;
  recoverySpirit.turn();
  assert.equal(recoverySpirit.isActive, false, 'the Spirit timer removes its dying owner encounter');
});
assert.equal(varpValue(recoveryOwner, 'disease'), 0, 'the shared player death queue clears disease severity');
assert.equal(recoveryOwner.timers.has(script('[timer,deal_disease]').id), false, 'death clears the disease timer');
assert.equal(varpValue(recoveryOwner, 'deal_quest'), questStages.blessed, 'death does not falsely complete the encounter');
[recoveryOwner.level, recoveryOwner.x, recoveryOwner.z] = arrival;
recoveryOwner.buildArea.rebuild();
talkNpc(recoveryOwner, captain, '[opnpc1,deal_captian_braindeath]');
assert.equal(count(recoveryOwner, 'deal_wrench_blessed'), 1, 'the surviving or replaced wrench permits recovery after death');
useItemOnLoc(recoveryOwner, 'deal_wrench_blessed', control, '[oplocu,deal_brew_control_spin]');
const afterDeathSpirit = spiritsFor(recoveryOwner)[0];
assert(afterDeathSpirit, 'the player can summon again after real player death');
[recoveryOwner.level, recoveryOwner.x, recoveryOwner.z] = tileFromCoord(returnCoord);
World.currentTick++;
afterDeathSpirit.turn();
assert.equal(afterDeathSpirit.isActive, false, 'the recovered encounter also cleans up when its owner leaves');
console.log('PASS native Spirit leave/death cleanup and resummon, saved disease login restart and shared death cleanup');

// Lost seeds remain recoverable; a full inventory cannot advance past an undelivered initial seed.
const lostSeedPlayer = playerAt(tileOf(captain));
varpValue(lostSeedPlayer, 'deal_quest', questStages.blindweed);
talkNpc(lostSeedPlayer, captain, '[opnpc1,deal_captian_braindeath]');
assert.equal(count(lostSeedPlayer, 'deal_blindweed_seed'), 1, 'Captain replaces a lost unplanted seed');
talkNpc(lostSeedPlayer, captain, '[opnpc1,deal_captian_braindeath]');
assert.equal(count(lostSeedPlayer, 'deal_blindweed_seed'), 1, 'seed recovery does not duplicate a held seed');
const blockedSeedPlayer = playerAt(tileOf(captain));
varpValue(blockedSeedPlayer, 'deal_quest', questStages.accepted);
for (let slot = 0; slot < inventorySize; slot++) blockedSeedPlayer.getInventory(invId).set(slot, { id: obj('spade'), count: 1 });
talkNpc(blockedSeedPlayer, captain, '[opnpc1,deal_captian_braindeath]');
assert.equal(varpValue(blockedSeedPlayer, 'deal_quest'), questStages.accepted, 'a full inventory cannot skip initial seed delivery');
assert.equal(count(blockedSeedPlayer, 'deal_blindweed_seed'), 0);
blockedSeedPlayer.getInventory(invId).set(inventorySize - 1, null);
talkNpc(blockedSeedPlayer, captain, '[opnpc1,deal_captian_braindeath]');
assert.equal(varpValue(blockedSeedPlayer, 'deal_quest'), questStages.blindweed, 'freeing a slot recovers the initial seed step');
assert.equal(count(blockedSeedPlayer, 'deal_blindweed_seed'), 1);

// Davey does not duplicate a banked wrench, and full-inventory replacement is safely retryable.
const bankId = id(types.InvType, 'bank');
const bankedWrenchPlayer = playerAt(tileOf(daveyReturn));
varpValue(bankedWrenchPlayer, 'deal_quest', questComplete);
bankedWrenchPlayer.getInventory(bankId);
bankedWrenchPlayer.invAdd(bankId, obj('deal_wrench_blessed'), 1);
talkNpc(bankedWrenchPlayer, daveyReturn, '[opnpc1,deal_davey]');
assert.equal(count(bankedWrenchPlayer, 'deal_wrench_blessed'), 0, 'Davey refuses a duplicate of the banked wrench');
assert.equal(count(bankedWrenchPlayer, 'deal_wrench_blessed', bankId), 1);
const blockedWrenchPlayer = playerAt(tileOf(daveyReturn));
varpValue(blockedWrenchPlayer, 'deal_quest', questComplete);
for (let slot = 0; slot < inventorySize; slot++) blockedWrenchPlayer.getInventory(invId).set(slot, { id: obj('spade'), count: 1 });
talkNpc(blockedWrenchPlayer, daveyReturn, '[opnpc1,deal_davey]');
assert.equal(count(blockedWrenchPlayer, 'deal_wrench_blessed'), 0, 'a full inventory receives no unusable replacement');
assert.equal(blockedWrenchPlayer.invFreeSpace(invId), 0);
blockedWrenchPlayer.getInventory(invId).set(inventorySize - 1, null);
talkNpc(blockedWrenchPlayer, daveyReturn, '[opnpc1,deal_davey]');
assert.equal(count(blockedWrenchPlayer, 'deal_wrench_blessed'), 1, 'freeing a slot permits the lost-wrench replacement');
assert.equal(varpValue(blockedWrenchPlayer, 'deal_quest'), questComplete);

// An unrelated Attack potion follows its ordinary effect and dose transition with or without a wrench.
const ordinaryBaseline = potionFixture('4dose1attack', false, 1, 50);
const ordinaryWrench = potionFixture('4dose1attack', true, 1, 50);
const ordinaryAttack = ordinaryBaseline.levels[PlayerStat.ATTACK];
drink(ordinaryBaseline, '4dose1attack');
drink(ordinaryWrench, '4dose1attack');
assert(ordinaryBaseline.levels[PlayerStat.ATTACK] > ordinaryAttack, 'the ordinary Attack potion still boosts Attack');
assert.deepEqual(ordinaryWrench.levels, ordinaryBaseline.levels, 'the wrench cannot change an unrelated potion effect');
assert.equal(ordinaryBaseline.levels[PlayerStat.PRAYER], 1, 'the ordinary potion does not restore Prayer');
for (const player of [ordinaryBaseline, ordinaryWrench]) {
  assert.equal(count(player, '4dose1attack'), 0);
  assert.equal(count(player, '3dose1attack'), 1, 'the ordinary potion retains its normal dose transition');
}
console.log('PASS seed/full-inventory recovery, bank-aware wrench guards and ordinary Attack potion non-regression');

process.exit(0);
