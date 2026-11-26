#!/usr/bin/env node
// Execute the packed quest, native interactions, death queue, and crystal hooks offline.
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  content, engine, World, Player, Npc, ScriptProvider, ScriptRunner, ScriptState,
  ServerTriggerType, EntityLifeCycle, types, map, nativeLocRows, nativeNpcRows,
  floorTiles, locFor, reachable, requiredId, tileFromCoord, walkable, IfSetText
} from '../regicide-travel/runtime.mjs';

const load = async relative => (await import(pathToFileURL(path.join(engine, 'src', relative)).href)).default;
const [Environment, { getExpByLevel }, { PlayerStat }, { NpcStat }] = await Promise.all([
  load('util/Environment.ts'),
  import(pathToFileURL(path.join(engine, 'src/engine/entity/Player.ts')).href),
  import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href),
  import(pathToFileURL(path.join(engine, 'src/engine/entity/NpcStat.ts')).href)
]);
const rsbuf = await import(pathToFileURL(path.join(engine, 'src/network/rsbuf/index.ts')).href);
const [OpNpc, OpNpcHandler, OpLocU, OpLocUHandler, OpHeld, OpHeldHandler,
  OpObj, OpObjHandler, IfButton, IfButtonHandler, ResumePauseButton,
  ResumePauseButtonHandler] = await Promise.all([
  'network/game/client/model/OpNpc.ts',
  'network/game/client/handler/OpNpcHandler.ts',
  'network/game/client/model/OpLocU.ts',
  'network/game/client/handler/OpLocUHandler.ts',
  'network/game/client/model/OpHeld.ts',
  'network/game/client/handler/OpHeldHandler.ts',
  'network/game/client/model/OpObj.ts',
  'network/game/client/handler/OpObjHandler.ts',
  'network/game/client/model/IfButton.ts',
  'network/game/client/handler/IfButtonHandler.ts',
  'network/game/client/model/ResumePauseButton.ts',
  'network/game/client/handler/ResumePauseButtonHandler.ts'
].map(load));

assert.equal(Environment.NODE_MEMBERS, true, 'quest items require the built members configuration');
assert.equal(Environment.NODE_XPRATE, 1, 'quest rewards use unmultiplied XP tenths');
World.currentTick = 100;

const varp = name => requiredId(types.VarPlayerType, name);
const varnpc = name => requiredId(types.VarNpcType, name);
const obj = name => requiredId(types.ObjType, name);
const component = name => requiredId(types.Component, name);
const inv = requiredId(types.InvType, 'inv');
const bank = requiredId(types.InvType, 'bank');
const worn = requiredId(types.InvType, 'worn');
const invCom = component('inventory:inv');
const wornCom = component('wornitems:worn');
const questRow = component('questlist:roving_elves');
const questPointsVarp = varp('qp');
const rovingStageVarp = varp('roving_elves_quest');
const rovingBitsVarp = varp('roving_elves_bits');
const ilfeenCountVarp = varp('roving_update_ilfeen_chant');
const regicideVarp = varp('regicide_quest');
const waterfallVarp = varp('waterfall_quest');
const npcAggressiveVarp = varnpc('npc_aggressive_player');
const invNpc = new OpNpcHandler();
const invLocUse = new OpLocUHandler();
const invItemOption = new OpHeldHandler();
const invObjectOption = new OpObjHandler();
const buttonHandler = new IfButtonHandler();
const pauseHandler = new ResumePauseButtonHandler();
const playerSerial = { value: 0 };
const players = [];
const createdNpcs = [];
const constantCache = new Map();

function constantRaw(file, name) {
  let source = constantCache.get(file);
  if (source === undefined) {
    source = readFileSync(path.join(content, 'scripts', file), 'utf8');
    constantCache.set(file, source);
  }
  const match = new RegExp(`^\\^${name}\\s*=\\s*([^\\s/]+)`, 'm').exec(source);
  assert(match, `missing source constant ${name} in ${file}`);
  return match[1];
}
const constant = (file, name) => Number(constantRaw(file, name));
const rovingConstant = name => constant(`quests/quest_roving_elves/configs/roving.constant`, name);
const ilfeenConstant = name => constant(`quests/quest_roving_elves/configs/roving_ilfeen.constant`, name);
const globalQuestConstant = name => constant('general/configs/quest.constant', name);
const waterfallConstant = name => constant('quests/quest_waterfall/configs/quest_waterfall.constant', name);
const regicideComplete = globalQuestConstant('regicide_complete');
const waterfallComplete = globalQuestConstant('waterfall_complete');
const rovingStarted = rovingConstant('roving_started');
const rovingGetSeed = rovingConstant('roving_get_seed');
const rovingSeedEnchanted = rovingConstant('roving_seed_enchanted');
const rovingPlanted = rovingConstant('roving_planted');
const rovingComplete = rovingConstant('roving_complete');
const rovingQuestPoints = rovingConstant('roving_questpoints');
const chargeUsesPerTier = ilfeenConstant('roving_charge_uses_per_tier');
const bowBitsMin = ilfeenConstant('roving_bow_use_bits_min');
const bowBitsMax = ilfeenConstant('roving_bow_use_bits_max');
const shieldBitsMin = ilfeenConstant('roving_shield_use_bits_min');
const shieldBitsMax = ilfeenConstant('roving_shield_use_bits_max');
const bowChoice = ilfeenConstant('roving_ilfeen_choice_bow');
const shieldChoice = ilfeenConstant('roving_ilfeen_choice_shield');
const declineChoice = ilfeenConstant('roving_ilfeen_choice_decline');

function newPlayer() {
  const serial = ++playerSerial.value;
  const username37 = BigInt(10000 + serial);
  const hash64 = BigInt(100000 + serial);
  const p = new Player(`roving_test_${serial}`, username37, hash64);
  p.pid = serial;
  p.slot = serial;
  p.uid = ((Number(username37 & 0x1fffffn) << 11) | p.slot) >>> 0;
  p.vars.fill(0);
  p.stats.fill(getExpByLevel(99));
  p.baseLevels.fill(99);
  p.levels.fill(99);
  p.level = 0;
  p.x = 0;
  p.z = 0;
  p.originX = 0;
  p.originZ = 0;
  p.lastMovement = 0;
  p.isActive = true;
  p.packets = [];
  p.messages = [];
  p.write = packet => p.packets.push(packet);
  p.messageGame = message => p.messages.push(String(message));
  p.wrappedMessageGame = message => p.messages.push(String(message));
  p.tabs[3] = types.Component.get(invCom).rootLayer;
  p.tabs[4] = types.Component.get(wornCom).rootLayer;
  p.getInventory(inv);
  p.getInventory(worn);
  p.getInventory(bank);
  p.invListenOnCom(inv, invCom, p.uid);
  p.invListenOnCom(worn, wornCom, p.uid);
  p.setVar(varp('tutorial'), 1000);
  World.players[p.slot] = p;
  World.playerLoop.add(p.hash64, p);
  rsbuf.addPlayer(p.slot);
  players.push(p);
  return p;
}

function cleanupPlayer(p) {
  if (World.players[p.slot] === p) {
    World.players[p.slot] = null;
    p.unlink();
  }
  rsbuf.removePlayer?.(p.slot);
}

function setVar(p, id, value) { p.setVar(id, value); }
const stage = p => p.getVar(rovingStageVarp);
const count = (p, name, inventory = inv) => p.invTotal(inventory, obj(name));
function give(p, name, amount = 1, inventory = inv) {
  assert.equal(p.invAdd(inventory, obj(name), amount), amount, `${name} is added to ${inventory}`);
}
function removeItem(p, name, inventory = inv) {
  const items = p.getInventory(inventory);
  const slot = items.getItemIndex(obj(name));
  assert.notEqual(slot, -1, `${name} is present in inventory ${inventory}`);
  items.set(slot, null);
  return slot;
}
function removeSlot(p, inventory, slot) {
  assert(p.invGetSlot(inventory, slot), `inventory ${inventory} slot ${slot} is occupied`);
  p.getInventory(inventory).set(slot, null);
}
function removeOneByName(p, name) {
  const slot = p.getInventory(inv).getItemIndex(obj(name));
  assert.notEqual(slot, -1, `${name} has a slot to free`);
  p.getInventory(inv).set(slot, null);
  return slot;
}
function fillInventory(p, name = 'pot_empty') {
  const items = p.getInventory(inv);
  for (let slot = 0; slot < items.capacity; slot++) {
    if (!p.invGetSlot(inv, slot)) items.set(slot, { id: obj(name), count: 1 });
  }
  assert.equal(items.freeSlotCount, 0, 'fixture inventory is full');
}
function inventorySnapshot(p, inventory = inv) {
  const items = p.getInventory(inventory);
  return Array.from({ length: items.capacity }, (_, slot) => {
    const item = p.invGetSlot(inventory, slot);
    return item ? [item.id, item.count] : null;
  });
}
function packetText(p, packetStart = 0, messageStart = 0) {
  const packets = p.packets.slice(packetStart)
    .map(packet => packet.text ?? packet.msg ?? '')
    .filter(value => typeof value === 'string');
  return [...packets, ...p.messages.slice(messageStart)].join(' ');
}
function captureScripts(p, action) {
  const states = [];
  const execute = p.executeScript;
  p.executeScript = function(state, ...args) {
    states.push({ state, name: state.script?.name });
    return execute.call(this, state, ...args);
  };
  try {
    action();
  } finally {
    p.executeScript = execute;
  }
  return states;
}
function finish(p, state, choices = []) {
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 400; step++) {
    if (state.execution === ScriptState.PAUSEBUTTON) {
      p.activeScript = state;
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      if (/^multi[2-5]$/.test(root)) {
        assert(choices.length, `${state.script.name} opened an unanswered ${root} dialogue`);
        const selected = component(`${root}:com_${choices.shift()}`);
        assert(p.resumeButtons.includes(selected), `${root} offers the selected dialogue option`);
        p.lastCom = selected;
        assert.equal(buttonHandler.handle(new IfButton(selected), p), true, `${root} option is accepted`);
      } else {
        assert.equal(pauseHandler.handle(new ResumePauseButton(0), p), true, `${state.script.name} continuation is accepted`);
      }
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else {
      assert.notEqual(state.execution, ScriptState.ABORTED, `${state.script.name} does not abort`);
      assert.fail(`${state.script.name} has unexpected execution state ${state.execution}`);
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, `${state.script.name} finishes within the interpreter bound`);
  assert.equal(choices.length, 0, `${state.script.name} consumes each selected dialogue option`);
  return state;
}
function runDirect(p, name, args = [], target = null) {
  const script = ScriptProvider.getByName(name);
  assert(script, `compiled script missing: ${name}`);
  const state = ScriptRunner.init(script, p, target, args);
  p.executeScript(state, true, true);
  return finish(p, state);
}
function startNpc(p, target, expected, choices = [], option = 1) {
  positionAt(p, target.stand);
  showNpc(p, target.actor);
  const states = captureScripts(p, () => {
    assert.equal(invNpc.handle(new OpNpc(option, target.actor.nid), p), true,
      `${target.name} option ${option} is accepted by the native client handler`);
    assert.equal(p.target, target.actor, `${target.name} is the selected target`);
    assert(p.validateTarget(), `${target.name} remains a valid map NPC`);
    assert(p.inOperableDistance(target.actor), `${target.name} emitted stand tile is operable`);
    assert.equal(p.getOpTrigger()?.name, expected, `${target.name} selects its compiled native handler`);
    assert.equal(p.tryInteract(true), true, `${target.name} handler starts`);
  });
  const dispatched = states[0];
  assert(dispatched?.state, `${expected} is dispatched by the native NPC handler`);
  assert.equal(dispatched.name, expected, `${target.name} runs the engine-selected NPC option`);
  return finish(p, dispatched.state, choices);
}
function startItemOption(p, name, option, choices = []) {
  const itemId = obj(name);
  const slot = p.getInventory(inv).getItemIndex(itemId);
  assert.notEqual(slot, -1, `${name} is carried for inventory option ${option}`);
  const states = captureScripts(p, () => {
    assert.equal(invItemOption.handle(new OpHeld(option, itemId, slot, invCom), p), true,
      `${name} option ${option} is accepted by the native item handler`);
  });
  const dispatched = states[0];
  assert(dispatched?.state, `${name} option ${option} dispatches a compiled script`);
  assert.equal(dispatched.name, `[opheld${option},${name}]`, `${name} option ${option} resolves natively`);
  return finish(p, dispatched.state, choices);
}
function startUseOnLoc(p, usedName, target, expected) {
  positionAt(p, target.stand);
  const usedId = obj(usedName);
  const slot = p.getInventory(inv).getItemIndex(usedId);
  assert.notEqual(slot, -1, `${usedName} is carried for use on ${target.name}`);
  assert(p.inOperableDistance(target.loc), `${target.name} emitted stand tile is operable`);
  const states = captureScripts(p, () => {
    assert.equal(invLocUse.handle(new OpLocU(target.loc.x, target.loc.z, target.loc.type, usedId, slot, invCom), p), true,
      `native Use ${usedName} on ${target.name} is accepted`);
    assert.equal(p.target, target.loc, `${target.name} is the selected native location`);
    assert(p.validateTarget(), `${target.name} remains a valid map location`);
    p.processInteraction();
  });
  const dispatched = states[0];
  assert(dispatched?.state, `native use dispatches a compiled handler for ${target.name}`);
  assert.equal(dispatched.name, expected, `${usedName} on ${target.name} resolves the expected compiled handler`);
  return finish(p, dispatched.state);
}
function startGroundPickup(p, x, z, level, itemId) {
  positionAt(p, [level, x, z]);
  assert.equal(invObjectOption.handle(new OpObj(3, x, z, itemId), p), true, 'native ground-item Take packet is accepted');
  p.processInteraction();
}
function positionAt(p, tile) {
  p.level = tile[0];
  p.x = tile[1];
  p.z = tile[2];
  p.originX = tile[1];
  p.originZ = tile[2];
  p.buildArea.rebuild();
}
function showNpc(p, actor) {
  const appearance = p.generateAppearance();
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump, p.runDir, p.walkDir,
    p.visibility, p.isActive, p.masks, appearance, p.lastAppearance, p.faceEntity, p.faceSquareX, p.faceSquareZ,
    p.faceAngleX, p.faceAngleZ, p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[PlayerStat.HITPOINTS], p.baseLevels[PlayerStat.HITPOINTS], p.animId, p.animDelay, p.sayMessage,
    p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0, p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(actor.x, actor.level, actor.z, actor.nid, actor.type, actor.tele, actor.jump, actor.runDir, actor.walkDir,
    actor.isActive, actor.masks, actor.faceEntity, actor.faceSquareX, actor.faceSquareZ, actor.faceAngleX, actor.faceAngleZ,
    actor.hitmarkDamage, actor.hitmarkType, actor.hitmark2Damage, actor.hitmark2Type, actor.levels[3], actor.baseLevels[3],
    actor.animId, actor.animDelay, actor.sayMessage, actor.spotanimId, actor.spotanimHeight, actor.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, actor.nid), `${types.NpcType.get(actor.type).debugname} is client-visible`);
}
function findNpcStand(row, type) {
  const size = Math.max(type.size, 1);
  const candidates = [];
  for (let dx = -1; dx <= size; dx++) {
    for (let dz = -1; dz <= size; dz++) {
      if (dx !== -1 && dx !== size && dz !== -1 && dz !== size) continue;
      candidates.push([row.level, row.x + dx, row.z + dz]);
    }
  }
  for (const tile of candidates) {
    if (!floorTiles.has(tile.join(',')) || map.isMapBlocked(tile[1], tile[2], tile[0])) continue;
    if (map.reachedEntity(tile[0], tile[1], tile[2], row.x, row.z, size, size, 1)) return tile;
  }
  assert.fail(`no packed-map operable stand tile for ${row.name} at ${row.coord}`);
}
function findLocStand(row, type) {
  for (let dx = -1; dx <= type.width; dx++) {
    for (let dz = -1; dz <= type.length; dz++) {
      if (dx !== -1 && dx !== type.width && dz !== -1 && dz !== type.length) continue;
      const tile = [row.level, row.x + dx, row.z + dz];
      if (!floorTiles.has(tile.join(',')) || map.isMapBlocked(tile[1], tile[2], tile[0])) continue;
      if (reachable(tile, row)) return tile;
    }
  }
  assert.fail(`no packed-map operable stand tile for ${row.name} at ${row.coord}`);
}
function assertPathNear(destination, label) {
  for (let radius = 2; radius <= 10; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const start = [destination[0], destination[1] + dx, destination[2] + dz];
        if (!floorTiles.has(start.join(',')) || map.isMapBlocked(start[1], start[2], start[0])) continue;
        const route = Array.from(map.findPath(start[0], start[1], start[2], destination[1], destination[2]) ?? []);
        if (route.length > 0) return route;
      }
    }
  }
  assert.fail(`${label}: no packed-map path reaches ${destination.join('_')}`);
}
function nativeNpc(name) {
  const [row] = nativeNpcRows(name);
  assert(row, `native map has no placement for ${name}`);
  const type = types.NpcType.get(row.id);
  assert(type, `packed NPC type missing for native ${name}`);
  let actor = [...World.npcs].find(npc => npc.isActive && npc.type === row.id
    && npc.level === row.level && npc.x === row.x && npc.z === row.z);
  if (!actor) actor = spawnNpcAt(row, type);
  return { name, row, type, actor, stand: findNpcStand(row, type) };
}
function spawnNpcAt(row, type) {
  const actor = new Npc(row.level, row.x, row.z, type.size, type.size,
    EntityLifeCycle.RESPAWN, World.npcs.next(), type.id, type.blockwalk);
  actor.lastMovement = -100;
  World.addNpc(actor, -1);
  createdNpcs.push(actor);
  const spawn = ScriptProvider.getByTrigger(ServerTriggerType.AI_SPAWN, type.id, type.category);
  assert(spawn, `${type.debugname} has its native AI_SPAWN handler`);
  const state = ScriptRunner.init(spawn, actor);
  actor.executeScript(state);
  assert.equal(state.execution, ScriptState.FINISHED, `${type.debugname} spawn finishes`);
  return actor;
}
function nativeLoc(name, coord = null) {
  const row = nativeLocRows(name).find(row => coord === null || row.coord === coord);
  assert(row, `native map has no placement for ${name}`);
  const loc = locFor(row);
  const type = types.LocType.get(row.id);
  return { name, row, loc, type, stand: findLocStand(row, type) };
}
function assertQuestColour(p, expectedStage) {
  const start = p.packets.length;
  runDirect(p, '[proc,update_questlist]');
  const packet = p.packets.slice(start).filter(value => value.constructor.name === 'IfSetColour'
    && value.component === questRow).at(-1);
  assert(packet, `questlist row is coloured at Roving stage ${expectedStage}`);
  const red = 31 << 10;
  const green = 31 << 5;
  const expected = expectedStage === 0 ? red : expectedStage >= rovingComplete ? green : red | green;
  assert.equal(packet.colour, expected, `Roving questlist colour matches stage ${expectedStage}`);
}
function countQuestPoints(p) {
  const state = runDirect(p, '[proc,count_questpoints]');
  assert.equal(state.isp, 1, 'count_questpoints returns one integer');
  return state.popInt();
}
function chargeUses(p, first, last) {
  const width = last - first + 1;
  return Math.floor(p.getVar(rovingBitsVarp) / (2 ** first)) % (2 ** width);
}
function setChargeUses(p, first, last, value) {
  const width = last - first + 1;
  const mask = ((2 ** width) - 1) * (2 ** first);
  const raw = p.getVar(rovingBitsVarp);
  p.setVar(rovingBitsVarp, (raw & ~mask) | (value << first));
}
function captureObjAdds(name, action) {
  const id = obj(name);
  const calls = [];
  const original = World.addObj;
  World.addObj = function(item, receiver, duration) {
    if (item.type === id) calls.push({ id: item.type, count: item.count, receiver: receiver?.toString() ?? null });
    return original.call(this, item, receiver, duration);
  };
  try {
    action();
  } finally {
    World.addObj = original;
  }
  return calls;
}
function runGuardianDeath(p, actor, target) {
  const trigger = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, target.type.id, target.type.category);
  assert(trigger, 'native roving guardian AI_QUEUE3 trigger exists');
  assert.equal(trigger.name, '[ai_queue3,roving_mossgiant]', 'native Moss Giant dispatches Roving death handler');
  const state = ScriptRunner.init(trigger, actor);
  assert.equal(state._activeNpc2, null, 'guardian death queue has no second NPC operand');
  const hp = actor.levels[NpcStat.HITPOINTS];
  assert(hp > 0, 'native guardian has live hitpoints');
  actor.setVar(npcAggressiveVarp, p.uid);
  actor.heroPoints.addHero(p.hash64, hp);
  const adds = captureObjAdds('roving_old_consecration_seed', () => {
    actor.applyDamage(hp, 1);
    actor.executeScript(state);
    for (let tick = 0; state.execution === ScriptState.NPC_SUSPENDED && tick < 40; tick++) {
      for (const player of players) if (World.players[player.slot] === player) player.processQueues();
      World.currentTick = Math.max(World.currentTick + 1, actor.delayedUntil);
      actor.delayed = false;
      actor.executeScript(state);
    }
    for (const player of players) if (World.players[player.slot] === player) player.processQueues();
  });
  assert.equal(state.execution, ScriptState.FINISHED, 'guardian death queue settles through npc_death');
  return adds;
}
function probeGuardian(target, label, questStage, inventorySeed = null, bankSeed = null, expectedDrops = 0, loseBeforeDeath = false) {
  const p = newPlayer();
  setVar(p, rovingStageVarp, questStage);
  if (inventorySeed) give(p, inventorySeed);
  if (bankSeed) give(p, bankSeed, 1, bank);
  if (loseBeforeDeath) removeItem(p, inventorySeed);
  positionAt(p, target.stand);
  const actor = spawnNpcAt(target.row, target.type);
  const beforeStage = stage(p);
  const adds = runGuardianDeath(p, actor, target);
  assert.equal(adds.length, expectedDrops, `${label}: guardian old-seed drops match the live item gates`);
  assert.equal(stage(p), beforeStage, `${label}: death never advances the quest stage`);
  if (expectedDrops) assert.equal(adds[0].receiver, p.hash64.toString(), `${label}: seed drop belongs to the top-damage player`);
}
function testGuardianGates(target) {
  probeGuardian(target, 'before stage 2', rovingStarted);
  probeGuardian(target, 'old seed carried', rovingGetSeed, 'roving_old_consecration_seed');
  probeGuardian(target, 'old seed banked', rovingGetSeed, null, 'roving_old_consecration_seed');
  probeGuardian(target, 'lost old seed is recoverable', rovingGetSeed, 'roving_old_consecration_seed', null, 1, true);
  probeGuardian(target, 'after seed exchange', rovingSeedEnchanted);
}
function testOwnedGroundItem(p, label, itemName, x, z, level) {
  const itemId = obj(itemName);
  const owned = World.getObj(x, z, level, itemId, p.hash64);
  assert(owned, `${label}: owner can resolve the ground seed`);
  const stranger = newPlayer();
  positionAt(stranger, [level, x + 1, z]);
  assert.equal(World.getObj(x, z, level, itemId, stranger.hash64), null, `${label}: another account cannot resolve the owned seed`);
  assert.equal(invObjectOption.handle(new OpObj(3, x, z, itemId), stranger), false,
    `${label}: native Take cannot claim another account's seed`);
  removeOneByName(p, 'pot_empty');
  positionAt(p, [level, x + 1, z]);
  startGroundPickup(p, x, z, level, itemId);
  assert.equal(count(p, itemName), 1, `${label}: owner picks up the seed through the native ground handler`);
  assert.equal(World.getObj(x, z, level, itemId, p.hash64), null, `${label}: successful pickup removes the ground seed`);
  cleanupPlayer(stranger);
}
function testQuestFlow(targets) {
  const p = newPlayer();
  setVar(p, regicideVarp, regicideComplete - 1);
  setVar(p, waterfallVarp, waterfallComplete);
  assertQuestColour(p, 0);
  const refusedStart = p.packets.length, refusedMessages = p.messages.length;
  startNpc(p, targets.islwyn, '[opnpc1,roving_islwyn]');
  assert.equal(stage(p), 0, 'Regicide prerequisite refusal leaves stage 0');
  assert(packetText(p, refusedStart, refusedMessages).includes('complete Regicide and the Waterfall Quest'),
    'Regicide prerequisite refusal is visible');
  setVar(p, regicideVarp, regicideComplete);
  setVar(p, waterfallVarp, waterfallComplete - 1);
  const waterfallRefusalStart = p.packets.length, waterfallRefusalMessages = p.messages.length;
  startNpc(p, targets.islwyn, '[opnpc1,roving_islwyn]');
  assert.equal(stage(p), 0, 'Waterfall prerequisite refusal leaves stage 0');
  assert(packetText(p, waterfallRefusalStart, waterfallRefusalMessages).includes('complete Regicide and the Waterfall Quest'),
    'Waterfall prerequisite refusal is visible');
  setVar(p, waterfallVarp, waterfallComplete);
  assertQuestColour(p, 0);
  const baselineQuestPoints = countQuestPoints(p);
  assert.equal(p.getVar(questPointsVarp), baselineQuestPoints, 'questlist recount stores the prerequisite total');

  startNpc(p, targets.eluned, '[opnpc1,roving_female_woodelf]');
  assert.equal(stage(p), 0, 'Eluned at stage 0 does not start Roving Elves');
  const decline = startNpc(p, targets.islwyn, '[opnpc1,roving_islwyn]', [2]);
  assert.equal(decline.execution, ScriptState.FINISHED);
  assert.equal(stage(p), 0, 'declining Islwyn leaves stage 0');
  startNpc(p, targets.islwyn, '[opnpc1,roving_islwyn]', [1]);
  assert.equal(stage(p), rovingStarted, 'Islwyn starts at stage 1 after both prerequisites');
  assertQuestColour(p, rovingStarted);
  assert.equal(countQuestPoints(p), baselineQuestPoints, 'starting Roving Elves does not award a quest point');

  startNpc(p, targets.eluned, '[opnpc1,roving_female_woodelf]');
  assert.equal(stage(p), rovingGetSeed, 'Eluned briefs the player at stage 1');
  assertQuestColour(p, rovingGetSeed);
  startNpc(p, targets.eluned, '[opnpc1,roving_female_woodelf]');
  assert.equal(stage(p), rovingGetSeed, 'stage 2 without the old seed remains recoverable from the guardian');

  positionAt(p, targets.guardian.stand);
  const guardianStage = stage(p);
  const guardianAdds = runGuardianDeath(p, targets.guardian.actor, targets.guardian);
  assert.equal(stage(p), guardianStage, 'native AI_QUEUE3 guardian death does not advance the quest');
  assert.equal(guardianAdds.length, 1, 'stage-2 native guardian death drops exactly one old consecration seed');
  assert.equal(guardianAdds[0].receiver, p.hash64.toString(), 'old consecration seed is owned by the credited player');
  const oldSeedId = obj('roving_old_consecration_seed');
  const ground = World.getObj(targets.guardian.row.x, targets.guardian.row.z, targets.guardian.row.level, oldSeedId, p.hash64);
  assert(ground, 'the old seed is present at the guardian native map tile');
  const stranger = newPlayer();
  positionAt(stranger, targets.guardian.stand);
  assert.equal(invObjectOption.handle(new OpObj(3, targets.guardian.row.x, targets.guardian.row.z, oldSeedId), stranger), false,
    'another account cannot take the guardian-owned seed');
  positionAt(p, [targets.guardian.row.level, targets.guardian.row.x, targets.guardian.row.z]);
  assert.equal(invObjectOption.handle(new OpObj(3, targets.guardian.row.x, targets.guardian.row.z, oldSeedId), p), true,
    'the owner can use the native Take option on the guardian seed');
  p.processInteraction();
  assert.equal(count(p, 'roving_old_consecration_seed'), 1, 'native ground pickup gives the old seed to its owner');
  assert.equal(World.getObj(targets.guardian.row.x, targets.guardian.row.z, targets.guardian.row.level, oldSeedId, p.hash64), null,
    'the guardian seed disappears after pickup');
  cleanupPlayer(stranger);

  const oldSlot = p.getInventory(inv).getItemIndex(oldSeedId);
  assert.notEqual(oldSlot, -1);
  startNpc(p, targets.eluned, '[opnpc1,roving_female_woodelf]');
  assert.equal(stage(p), rovingSeedEnchanted, 'Eluned enchants the recovered seed at stage 2');
  assert.equal(p.invGetSlot(inv, oldSlot)?.id, obj('roving_new_consecration_seed'), 'Eluned replaces the old seed in its existing slot');
  assert.equal(count(p, 'roving_old_consecration_seed'), 0);
  assertQuestColour(p, rovingSeedEnchanted);

  const recovery = newPlayer();
  setVar(recovery, rovingStageVarp, rovingSeedEnchanted);
  give(recovery, 'roving_new_consecration_seed', 1, bank);
  startNpc(recovery, targets.eluned, '[opnpc1,roving_female_woodelf]');
  assert.equal(stage(recovery), rovingSeedEnchanted, 'a banked enchanted seed does not advance the quest');
  assert.equal(count(recovery, 'roving_new_consecration_seed'), 0, 'a banked seed is not duplicated into inventory');
  assert.equal(count(recovery, 'roving_new_consecration_seed', bank), 1, 'the banked enchanted seed is retained');
  removeItem(recovery, 'roving_new_consecration_seed', bank);
  startNpc(recovery, targets.eluned, '[opnpc1,roving_female_woodelf]');
  assert.equal(stage(recovery), rovingSeedEnchanted, 'Eluned replaces a lost enchanted seed without advancing');
  assert.equal(count(recovery, 'roving_new_consecration_seed'), 1, 'the missing enchanted seed is recoverable');
  assertQuestColour(p, rovingSeedEnchanted);
  cleanupPlayer(recovery);

  const plantBounds = [
    tileFromCoord(constantRaw('quests/quest_roving_elves/configs/roving.constant', 'roving_plant_southwest')),
    tileFromCoord(constantRaw('quests/quest_roving_elves/configs/roving.constant', 'roving_plant_northeast'))
  ];
  const chalice = nativeLoc('baxtorian_chalice_waterfall_quest', constantRaw('quests/quest_roving_elves/configs/roving.constant', 'roving_chalice'));
  assert.equal(chalice.row.coord, constantRaw('quests/quest_roving_elves/configs/roving.constant', 'roving_chalice'),
    'the chalice coordinate agrees with its native map placement');
  const chaliceTile = tileFromCoord(chalice.row.coord);
  assertPathNear(chaliceTile, 'raised Waterfall room chalice');
  const plantSite = [plantBounds[0][0], plantBounds[0][1], chaliceTile[2]];
  assert(plantSite[1] >= plantBounds[0][1] && plantSite[1] <= plantBounds[1][1]
    && plantSite[2] >= plantBounds[0][2] && plantSite[2] <= plantBounds[1][2], 'plant site lies in the configured raised-room bounds');
  walkable(plantSite, 'raised-room plant site');
  assertPathNear(plantSite, 'raised-room plant site');
  const outsideSite = findOutsidePlantTile(plantBounds, plantSite);
  walkable(outsideSite, 'outside plant site');
  assertPathNear(outsideSite, 'outside plant site');

  const outsideSeed = newPlayer();
  setVar(outsideSeed, rovingStageVarp, rovingSeedEnchanted);
  give(outsideSeed, 'roving_new_consecration_seed');
  give(outsideSeed, 'spade');
  positionAt(outsideSeed, outsideSite);
  startItemOption(outsideSeed, 'roving_new_consecration_seed', 1);
  assert.equal(stage(outsideSeed), rovingSeedEnchanted, 'planting outside the raised-room bounds does not advance');
  assert.equal(count(outsideSeed, 'roving_new_consecration_seed'), 1, 'out-of-bounds planting keeps the seed');
  cleanupPlayer(outsideSeed);

  assert.equal(count(p, 'spade'), 0, 'missing-spade fixture holds no spade');
  positionAt(p, plantSite);
  startItemOption(p, 'roving_new_consecration_seed', 1);
  assert.equal(stage(p), rovingSeedEnchanted, 'planting without a spade does not advance');
  assert.equal(count(p, 'roving_new_consecration_seed'), 1, 'planting without a spade keeps the seed');
  give(p, 'spade');
  positionAt(p, plantSite);
  startItemOption(p, 'roving_new_consecration_seed', 1);
  assert.equal(stage(p), rovingPlanted, 'a spade plants the seed in the raised Waterfall room');
  assert.equal(count(p, 'roving_new_consecration_seed'), 0, 'planting consumes the enchanted seed');
  assert.equal(count(p, 'spade'), 1, 'planting does not consume the spade');
  assertQuestColour(p, rovingPlanted);
  assert.equal(countQuestPoints(p), baselineQuestPoints, 'stage 4 is not counted as a completed quest');

  startNpc(p, targets.islwyn, '[opnpc1,roving_islwyn]', [3]);
  assert.equal(stage(p), rovingPlanted, 'choosing later keeps the planted stage');
  assert.equal(count(p, 'roving_crystal_bow_200'), 0);
  assert.equal(count(p, 'roving_crystal_shield_200'), 0);
  assert.equal(countQuestPoints(p), baselineQuestPoints);

  setChargeUses(p, bowBitsMin, bowBitsMax, 77);
  setChargeUses(p, shieldBitsMin, shieldBitsMax, 88);
  fillInventory(p);
  const fullInventory = inventorySnapshot(p);
  const xpBefore = p.stats[PlayerStat.STRENGTH];
  const pointsBefore = p.getVar(questPointsVarp);
  const scrollsBefore = completedScrolls(p);
  startNpc(p, targets.islwyn, '[opnpc1,roving_islwyn]', [1]);
  assert.equal(stage(p), rovingPlanted, 'full inventory refuses the reward without completing');
  assert.deepEqual(inventorySnapshot(p), fullInventory, 'full-inventory refusal has no item loss');
  assert.equal(p.stats[PlayerStat.STRENGTH], xpBefore, 'full-inventory refusal awards no Strength XP');
  assert.equal(p.getVar(questPointsVarp), pointsBefore, 'full-inventory refusal awards no quest point');
  assert.equal(completedScrolls(p), scrollsBefore, 'full-inventory refusal does not open the completion scroll');

  removeOneByName(p, 'pot_empty');
  const rewardStart = p.packets.length;
  startNpc(p, targets.islwyn, '[opnpc1,roving_islwyn]', [1]);
  assert.equal(stage(p), rovingComplete, 'successful reward commits stage 6');
  assert.equal(count(p, 'roving_crystal_bow_200'), 1, 'bow choice grants the partly-used crystal bow');
  assert.equal(count(p, 'roving_crystal_shield_200'), 0, 'bow choice does not also grant a shield');
  assert.equal(p.stats[PlayerStat.STRENGTH] - xpBefore, 100000, 'Roving Elves grants 10,000 Strength XP in tenths');
  assert.equal(p.getVar(questPointsVarp) - pointsBefore, rovingQuestPoints, 'Roving Elves grants exactly one quest point');
  assert.equal(countQuestPoints(p), baselineQuestPoints + rovingQuestPoints, 'count_questpoints includes stage 6 exactly once');
  assert.equal(chargeUses(p, bowBitsMin, bowBitsMax), 0, 'bow reward resets its saved use counter');
  assert.equal(chargeUses(p, shieldBitsMin, shieldBitsMax), 88, 'bow reward leaves the shield counter untouched');
  assertQuestColour(p, rovingComplete);
  assert.equal(completedScrolls(p), scrollsBefore + 1, 'successful completion opens exactly one Roving Elves scroll');
  assert(packetText(p, rewardStart).includes('You have completed Roving Elves!'), 'completion scroll carries the Roving Elves title');
  const xpAfterReward = p.stats[PlayerStat.STRENGTH];
  const pointsAfterReward = p.getVar(questPointsVarp);
  startNpc(p, targets.islwyn, '[opnpc1,roving_islwyn]');
  assert.equal(stage(p), rovingComplete, 'repeat Islwyn talk leaves completion unchanged');
  assert.equal(count(p, 'roving_crystal_bow_200'), 1, 'repeat Islwyn talk gives no second bow');
  assert.equal(p.stats[PlayerStat.STRENGTH], xpAfterReward, 'repeat Islwyn talk gives no duplicate XP');
  assert.equal(p.getVar(questPointsVarp), pointsAfterReward, 'repeat Islwyn talk gives no duplicate quest point');
  assert.equal(completedScrolls(p), scrollsBefore + 1, 'repeat Islwyn talk does not reopen the completion scroll');
  assertQuestColour(p, rovingComplete);

  startNpc(p, targets.eluned, '[opnpc1,roving_female_woodelf]', [2]);
  assert.equal(stage(p), rovingComplete, 'completed Eluned interaction falls through to the original MEP dialogue');
  assert.equal(count(p, 'roving_crystal_bow_200'), 1, 'completed Eluned fallback does not grant another reward');
  assert.equal(completedScrolls(p), scrollsBefore + 1, 'completed Eluned fallback does not replay the scroll');
  return p;
}
function completedScrolls(p) {
  return p.packets.filter(packet => packet instanceof IfSetText && packet.text === 'You have completed Roving Elves!').length;
}
function findOutsidePlantTile(bounds, site) {
  const [minimum, maximum] = bounds;
  for (let radius = 1; radius <= 12; radius++) {
    for (let x = minimum[1] - radius; x <= maximum[1] + radius; x++) {
      for (let z = minimum[2] - radius; z <= maximum[2] + radius; z++) {
        if (x >= minimum[1] && x <= maximum[1] && z >= minimum[2] && z <= maximum[2]) continue;
        const tile = [minimum[0], x, z];
        if (!floorTiles.has(tile.join(',')) || map.isMapBlocked(x, z, tile[0])) continue;
        const route = Array.from(map.findPath(site[0], site[1], site[2], x, z) ?? []);
        if (route.length) return tile;
      }
    }
  }
  assert.fail('raised room has no walkable, reachable tile outside the configured planting bounds');
}
function testIlfeen(target) {
  const source = readFileSync(path.join(content, 'scripts/quests/quest_roving_elves/configs/roving_ilfeen.varp'), 'utf8');
  assert.match(source, /^\[roving_update_ilfeen_chant\]\s*\n\s*scope=perm\s*$/m,
    'Ilfeen fee count is declared permanent');
  const notComplete = newPlayer();
  setVar(notComplete, rovingStageVarp, rovingPlanted);
  give(notComplete, 'crystal_seed_old');
  give(notComplete, 'coins', 900000);
  const coinsBefore = count(notComplete, 'coins');
  startNpc(notComplete, target, '[opnpc1,roving_update_female_woodelf]');
  assert.equal(count(notComplete, 'crystal_seed_old'), 1, 'Ilfeen does not take a seed before quest completion');
  assert.equal(count(notComplete, 'coins'), coinsBefore, 'Ilfeen does not take coins before quest completion');
  assert.equal(notComplete.getVar(ilfeenCountVarp), 0, 'ineligible dialogue does not increment the fee counter');
  cleanupPlayer(notComplete);

  const missingSeed = newPlayer();
  setVar(missingSeed, rovingStageVarp, rovingComplete);
  give(missingSeed, 'coins', 900000);
  startNpc(missingSeed, target, '[opnpc1,roving_update_female_woodelf]');
  assert.equal(count(missingSeed, 'coins'), 900000, 'missing seed does not consume coins');
  assert.equal(missingSeed.getVar(ilfeenCountVarp), 0, 'missing seed does not increment the fee counter');
  cleanupPlayer(missingSeed);

  const insufficient = newPlayer();
  setVar(insufficient, rovingStageVarp, rovingComplete);
  give(insufficient, 'crystal_seed_old');
  give(insufficient, 'coins', ilfeenConstant('roving_ilfeen_bow_fee_first') - 1);
  startNpc(insufficient, target, '[opnpc1,roving_update_female_woodelf]', [bowChoice]);
  assert.equal(count(insufficient, 'crystal_seed_old'), 1, 'insufficient funds preserve the seed');
  assert.equal(count(insufficient, 'coins'), ilfeenConstant('roving_ilfeen_bow_fee_first') - 1, 'insufficient funds preserve coins');
  assert.equal(count(insufficient, 'roving_crystal_bow_1000'), 0, 'insufficient funds grant no bow');
  assert.equal(insufficient.getVar(ilfeenCountVarp), 0, 'insufficient funds do not increment the fee counter');
  cleanupPlayer(insufficient);

  const declined = newPlayer();
  setVar(declined, rovingStageVarp, rovingComplete);
  give(declined, 'crystal_seed_old');
  give(declined, 'coins', ilfeenConstant('roving_ilfeen_bow_fee_first'));
  startNpc(declined, target, '[opnpc1,roving_update_female_woodelf]', [declineChoice]);
  assert.equal(count(declined, 'crystal_seed_old'), 1, 'declining preserves the seed');
  assert.equal(count(declined, 'coins'), ilfeenConstant('roving_ilfeen_bow_fee_first'), 'declining preserves coins');
  assert.equal(declined.getVar(ilfeenCountVarp), 0, 'declining does not increment the fee counter');
  cleanupPlayer(declined);

  const full = newPlayer();
  setVar(full, rovingStageVarp, rovingComplete);
  give(full, 'crystal_seed_old');
  give(full, 'coins', ilfeenConstant('roving_ilfeen_bow_fee_first'));
  setChargeUses(full, bowBitsMin, bowBitsMax, 73);
  fillInventory(full);
  startNpc(full, target, '[opnpc1,roving_update_female_woodelf]', [bowChoice]);
  assert.equal(count(full, 'crystal_seed_old'), 0, 'full-inventory exchange replaces the seed in place');
  assert.equal(count(full, 'roving_crystal_bow_1000'), 1, 'full-inventory exchange still grants the full bow');
  assert.equal(count(full, 'coins'), 0, 'full-inventory exchange charges exactly the first bow fee');
  assert.equal(full.getVar(ilfeenCountVarp), 1, 'successful full-inventory exchange increments the permanent fee count');
  assert.equal(chargeUses(full, bowBitsMin, bowBitsMax), 0, 're-enchantment resets the bow use counter');
  cleanupPlayer(full);

  const bowFees = [
    ilfeenConstant('roving_ilfeen_bow_fee_first'),
    ilfeenConstant('roving_ilfeen_bow_fee_second'),
    ilfeenConstant('roving_ilfeen_bow_fee_third'),
    ilfeenConstant('roving_ilfeen_bow_fee_fourth'),
    ilfeenConstant('roving_ilfeen_bow_fee_floor'),
    ilfeenConstant('roving_ilfeen_bow_fee_floor')
  ];
  const shieldFees = [
    ilfeenConstant('roving_ilfeen_shield_fee_first'),
    ilfeenConstant('roving_ilfeen_shield_fee_second'),
    ilfeenConstant('roving_ilfeen_shield_fee_third'),
    ilfeenConstant('roving_ilfeen_shield_fee_fourth'),
    ilfeenConstant('roving_ilfeen_shield_fee_floor'),
    ilfeenConstant('roving_ilfeen_shield_fee_floor')
  ];
  for (const [choice, reward, fees, range] of [
    [bowChoice, 'roving_crystal_bow_1000', bowFees, [bowBitsMin, bowBitsMax]],
    [shieldChoice, 'roving_crystal_shield_1000', shieldFees, [shieldBitsMin, shieldBitsMax]]
  ]) {
    const p = newPlayer();
    setVar(p, rovingStageVarp, rovingComplete);
    setChargeUses(p, range[0], range[1], 91);
    for (let index = 0; index < fees.length; index++) {
      give(p, 'crystal_seed_old');
      give(p, 'coins', fees[index]);
      startNpc(p, target, '[opnpc1,roving_update_female_woodelf]', [choice]);
      assert.equal(count(p, 'crystal_seed_old'), 0, `${reward} exchange ${index + 1} consumes one seed`);
      assert.equal(count(p, reward), 1, `${reward} exchange ${index + 1} grants one full item`);
      assert.equal(count(p, 'coins'), 0, `${reward} exchange ${index + 1} charges its exact fee`);
      assert.equal(p.getVar(ilfeenCountVarp), Math.min(index + 1, ilfeenConstant('roving_ilfeen_fee_count_max')),
        `${reward} exchange ${index + 1} keeps the fee count capped`);
      assert.equal(chargeUses(p, range[0], range[1]), 0, `${reward} exchange ${index + 1} resets its usage counter`);
      removeItem(p, reward);
    }
    cleanupPlayer(p);
  }
}
function testTombstone(target) {
  const opened = waterfallConstant('waterfall_opened_book_on_baxtorian');
  const stages = [0, rovingStarted, rovingGetSeed, rovingSeedEnchanted, rovingPlanted, rovingComplete];
  for (const waterStage of [opened, waterfallComplete]) {
    for (const rovingStage of stages) {
      const p = newPlayer();
      setVar(p, waterfallVarp, waterStage);
      setVar(p, rovingStageVarp, rovingStage);
      give(p, 'glarials_pebble_waterfall_quest');
      const start = [...target.stand];
      startUseOnLoc(p, 'glarials_pebble_waterfall_quest', target, '[oplocu,glarials_tombstone_waterfall_quest]');
      assert.notDeepEqual([p.level, p.x, p.z], start, `Waterfall stage ${waterStage}, Roving stage ${rovingStage} still enters the tomb`);
      assert.equal(p.getVar(waterfallVarp), waterStage === opened
        ? waterfallConstant('waterfall_entered_glarial_tomb') : waterfallComplete,
      'tomb entry preserves the original Waterfall state transition');
      assert.equal(stage(p), rovingStage, 'Glarial tomb entry never changes Roving Elves state');
      assert.equal(count(p, 'glarials_pebble_waterfall_quest'), 1, 'tomb entry retains the pebble');
      cleanupPlayer(p);
    }
  }
  for (const rovingStage of stages) {
    const p = newPlayer();
    setVar(p, waterfallVarp, opened);
    setVar(p, rovingStageVarp, rovingStage);
    give(p, 'coins');
    const before = [...target.stand];
    startUseOnLoc(p, 'coins', target, '[oplocu,glarials_tombstone_waterfall_quest]');
    assert.deepEqual([p.level, p.x, p.z], before, 'using an item other than Glarial pebble does not enter');
    assert.equal(p.getVar(waterfallVarp), opened, 'wrong item preserves the Waterfall stage');
    assert.equal(stage(p), rovingStage, 'wrong item preserves the Roving stage');
    assert.equal(count(p, 'coins'), 1, 'wrong item is not consumed');
    cleanupPlayer(p);
  }

  const weapon = newPlayer();
  setVar(weapon, waterfallVarp, opened);
  setVar(weapon, rovingStageVarp, rovingComplete);
  give(weapon, 'glarials_pebble_waterfall_quest');
  give(weapon, 'mithril_2h_sword');
  const weaponStart = [...target.stand];
  startUseOnLoc(weapon, 'glarials_pebble_waterfall_quest', target, '[oplocu,glarials_tombstone_waterfall_quest]');
  assert.deepEqual([weapon.level, weapon.x, weapon.z], weaponStart, 'Waterfall tomb still refuses a carried weapon');
  assert.equal(weapon.getVar(waterfallVarp), opened);
  assert.equal(stage(weapon), rovingComplete);
  cleanupPlayer(weapon);

  const armour = newPlayer();
  setVar(armour, waterfallVarp, opened);
  setVar(armour, rovingStageVarp, rovingComplete);
  give(armour, 'glarials_pebble_waterfall_quest');
  const helmet = types.ObjType.get(obj('iron_full_helm'));
  assert(helmet.wearpos >= 0, 'iron full helm has a native worn slot');
  armour.getInventory(worn).set(helmet.wearpos, { id: helmet.id, count: 1 });
  const armourStart = [...target.stand];
  startUseOnLoc(armour, 'glarials_pebble_waterfall_quest', target, '[oplocu,glarials_tombstone_waterfall_quest]');
  assert.deepEqual([armour.level, armour.x, armour.z], armourStart, 'Waterfall tomb still refuses worn armour');
  assert.equal(armour.getVar(waterfallVarp), opened);
  assert.equal(stage(armour), rovingComplete);
  cleanupPlayer(armour);
}
function testEquipment() {
  const bowNames = [
    'roving_crystal_bow_new', 'roving_crystal_bow_1000', 'roving_crystal_bow_900',
    'roving_crystal_bow_800', 'roving_crystal_bow_700', 'roving_crystal_bow_600',
    'roving_crystal_bow_500', 'roving_crystal_bow_400', 'roving_crystal_bow_300',
    'roving_crystal_bow_200', 'roving_crystal_bow_100'
  ];
  const shieldNames = [
    'roving_crystal_shield_new', 'roving_crystal_shield_1000', 'roving_crystal_shield_900',
    'roving_crystal_shield_800', 'roving_crystal_shield_700', 'roving_crystal_shield_600',
    'roving_crystal_shield_500', 'roving_crystal_shield_400', 'roving_crystal_shield_300',
    'roving_crystal_shield_200', 'roving_crystal_shield_100'
  ];
  const generic = 'You are not a high enough level to use this item.';
  for (const name of bowNames) {
    for (const level of [69, 70]) {
      const p = newPlayer();
      p.baseLevels[PlayerStat.RANGED] = level;
      p.levels[PlayerStat.RANGED] = level;
      give(p, name);
      startItemOption(p, name, 2);
      const type = types.ObjType.get(obj(name));
      if (level === 69) {
        assert.equal(count(p, name), 1, `${name} stays carried at Ranged 69`);
        assert.equal(p.invTotal(worn, obj(name)), 0, `${name} does not equip at Ranged 69`);
        assert(p.messages.includes(generic), `${name} refusal uses the native level gate`);
        assert(p.messages.includes('You need to have a Ranged level of 70.'), `${name} refusal names Ranged 70`);
      } else {
        assert.equal(count(p, name), 0, `${name} leaves inventory at Ranged 70`);
        assert.equal(p.invGetSlot(worn, type.wearpos)?.id, type.id, `${name} equips at Ranged 70`);
      }
      assert.equal(stage(p), 0, `${name} has no invented quest-completion equip gate`);
      cleanupPlayer(p);
    }
  }
  for (const name of shieldNames) {
    const type = types.ObjType.get(obj(name));
    for (const [agility, defence, expected] of [
      [49, 70, 'You need to have an agility level of 50.'],
      [50, 69, 'You need to have a defence level of 70.'],
      [50, 70, null]
    ]) {
      const p = newPlayer();
      p.baseLevels[PlayerStat.AGILITY] = agility;
      p.levels[PlayerStat.AGILITY] = agility;
      p.baseLevels[PlayerStat.DEFENCE] = defence;
      p.levels[PlayerStat.DEFENCE] = defence;
      give(p, name);
      startItemOption(p, name, 2);
      if (expected) {
        assert.equal(count(p, name), 1, `${name} remains in inventory at Agility ${agility}/Defence ${defence}`);
        assert.equal(p.invTotal(worn, obj(name)), 0, `${name} does not equip below its native requirements`);
        assert(p.messages.includes(generic), `${name} refusal uses the native level gate`);
        assert(p.messages.includes(expected), `${name} refusal names the unmet stat`);
      } else {
        assert.equal(count(p, name), 0, `${name} leaves inventory at its required levels`);
        assert.equal(p.invGetSlot(worn, type.wearpos)?.id, type.id, `${name} equips at Agility 50/Defence 70`);
      }
      assert.equal(stage(p), 0, `${name} has no invented quest-completion equip gate`);
      cleanupPlayer(p);
    }
  }
  const ordinary = newPlayer();
  ordinary.baseLevels[PlayerStat.RANGED] = 50;
  ordinary.levels[PlayerStat.RANGED] = 50;
  give(ordinary, 'magic_shortbow');
  startItemOption(ordinary, 'magic_shortbow', 2);
  assert.equal(count(ordinary, 'magic_shortbow'), 0, 'ordinary magic shortbow still equips at its native level');
  assert.equal(ordinary.invTotal(worn, obj('magic_shortbow')), 1, 'ordinary bow is not caught by Roving-specific gates');
  assert.equal(stage(ordinary), 0, 'ordinary bow requires no Roving Elves completion');
  cleanupPlayer(ordinary);
}
function testRangedAmmo() {
  const p = newPlayer();
  const rightHand = types.ObjType.getWearPosId('righthand');
  const quiver = types.ObjType.getWearPosId('quiver');
  const ordinaryBow = obj('shortbow');
  const arrow = obj('bronze_arrow');
  p.getInventory(worn).set(rightHand, { id: ordinaryBow, count: 1 });
  p.getInventory(worn).set(quiver, null);
  const noAmmo = runDirect(p, '[proc,player_ranged_check_ammo]', [ordinaryBow]);
  assert.equal(noAmmo.popInt(), -1, 'ordinary bow without arrows still has no ammunition');
  p.getInventory(worn).set(quiver, { id: arrow, count: 1 });
  const withAmmo = runDirect(p, '[proc,player_ranged_check_ammo]', [ordinaryBow]);
  assert.equal(withAmmo.popInt(), arrow, 'ordinary bow still selects its carried arrow');
  assert.equal(p.invGetSlot(worn, rightHand)?.id, ordinaryBow, 'ordinary bow remains equipped during ammo checking');
  assert.equal(p.invGetSlot(worn, quiver)?.id, arrow, 'ammo checking does not consume ordinary arrows');

  const bowNames = [
    'roving_crystal_bow_new', 'roving_crystal_bow_1000', 'roving_crystal_bow_900',
    'roving_crystal_bow_800', 'roving_crystal_bow_700', 'roving_crystal_bow_600',
    'roving_crystal_bow_500', 'roving_crystal_bow_400', 'roving_crystal_bow_300',
    'roving_crystal_bow_200', 'roving_crystal_bow_100'
  ];
  for (const name of bowNames) {
    const bow = obj(name);
    p.getInventory(worn).set(rightHand, { id: bow, count: 1 });
    p.getInventory(worn).set(quiver, null);
    const noArrows = runDirect(p, '[proc,player_ranged_check_ammo]', [bow]);
    assert.equal(noArrows.popInt(), bow, `${name} fires without arrows through the native ranged-ammo proc`);
    assert.equal(p.invGetSlot(worn, rightHand)?.id, bow, `${name} stays equipped during ammo checking`);
    assert.equal(chargeUses(p, bowBitsMin, bowBitsMax), 0, 'ammo checks do not consume a crystal charge');
  }

  const observer = newPlayer();
  const runeArrow = obj('rune_arrow');
  for (const name of [...bowNames, 'yew_shortbow', 'magic_shortbow']) {
    p.getInventory(worn).set(rightHand, { id: obj(name), count: 1 });
    const expectedQuiverBonus = bowNames.includes(name) ? 0 : 49;
    for (const [script, source, target] of [
      ['[proc,equip_get_bonuses]', p, null],
      ['[proc,.equip_get_bonuses]', observer, p]
    ]) {
      p.getInventory(worn).set(quiver, null);
      const withoutArrows = runDirect(source, script, [], target).popInt();
      p.getInventory(worn).set(quiver, { id: runeArrow, count: 1 });
      const withArrows = runDirect(source, script, [], target).popInt();
      assert.equal(withArrows - withoutArrows, expectedQuiverBonus,
        `${script}: rune arrows add ${expectedQuiverBonus} ranged strength with ${name}`);
    }
  }
  cleanupPlayer(observer);
  cleanupPlayer(p);
}
function runRangedUse(p, mode, target) {
  const rightHand = types.ObjType.getWearPosId('righthand');
  const bow = p.invGetSlot(worn, rightHand)?.id;
  assert(bow !== undefined && bow !== null, 'ranged-use fixture has an equipped weapon');
  const script = mode === 'npc' ? '[proc,player_ranged_use_weapon]' : '[proc,pvp_ranged_use_weapon]';
  const ammo = runDirect(p, '[proc,player_ranged_check_ammo]', [bow]).popInt();
  assert.notEqual(ammo, -1, `${script} has native selected ammunition`);
  const state = runDirect(p, script, [bow, ammo], target);
  assert.equal(state.isp, 1, `${script} returns a projectile delay`);
  const delay = state.popInt();
  p.packets.length = 0;
  p.messages.length = 0;
  if (target instanceof Player) {
    target.packets.length = 0;
    target.messages.length = 0;
  }
  return delay;
}
function runDamageQueue(p, script) {
  p.levels[PlayerStat.HITPOINTS] = p.baseLevels[PlayerStat.HITPOINTS];
  runDirect(p, script, [1]);
  p.packets.length = 0;
  p.messages.length = 0;
}
function getGroundSeed(p, x, z, level) {
  return World.getObj(x, z, level, obj('crystal_seed_old'), p.hash64);
}
function assertGroundOverflow(p, label, x, z, level, addCalls) {
  assert.equal(count(p, 'crystal_seed_old'), 0, `${label}: full inventory does not receive the seed`);
  assert.equal(addCalls.length, 1, `${label}: final depletion performs exactly one ground obj_add`);
  assert.deepEqual(addCalls[0], { id: obj('crystal_seed_old'), count: 1, receiver: p.hash64.toString() },
    `${label}: raw seed drop is owned by the wearer`);
  assert(getGroundSeed(p, x, z, level), `${label}: seed appears on the wearer's ground tile`);
}
function testCrystalCombat(bowQuest, shieldQuest, guardianTarget) {
  const targetNpc = spawnNpcAt(guardianTarget.row, guardianTarget.type);
  const pvpOpponent = newPlayer();
  const targetTile = guardianTarget.stand;
  const opponentTile = findNearbyWalkable(targetTile, new Set([targetTile.join(',')]));
  positionAt(pvpOpponent, opponentTile);

  assert.equal(count(bowQuest, 'roving_crystal_bow_200'), 1, 'the completed quest supplied its 2/10 bow');
  bowQuest.baseLevels[PlayerStat.RANGED] = 70;
  bowQuest.levels[PlayerStat.RANGED] = 70;
  startItemOption(bowQuest, 'roving_crystal_bow_200', 2);
  positionAt(bowQuest, targetTile);
  for (let hit = 0; hit < chargeUsesPerTier - 1; hit++) runRangedUse(bowQuest, 'npc', targetNpc);
  assert.equal(bowQuest.invGetSlot(worn, types.ObjType.getWearPosId('righthand'))?.id, obj('roving_crystal_bow_200'),
    '249 native NPC ranged uses retain the 2/10 bow');
  assert.equal(chargeUses(bowQuest, bowBitsMin, bowBitsMax), chargeUsesPerTier - 1, 'NPC ranged uses persist within the current tier');
  runRangedUse(bowQuest, 'npc', targetNpc);
  assert.equal(bowQuest.invGetSlot(worn, types.ObjType.getWearPosId('righthand'))?.id, obj('roving_crystal_bow_100'),
    'the 250th native NPC ranged use moves the 2/10 bow to 1/10');
  assert.equal(chargeUses(bowQuest, bowBitsMin, bowBitsMax), 0, 'NPC tier transition resets the bow counter');
  for (let hit = 0; hit < chargeUsesPerTier - 1; hit++) runRangedUse(bowQuest, 'pvp', pvpOpponent);
  assert.equal(bowQuest.invGetSlot(worn, types.ObjType.getWearPosId('righthand'))?.id, obj('roving_crystal_bow_100'),
    '249 native PvP ranged uses retain the 1/10 bow');
  assert.equal(chargeUses(bowQuest, bowBitsMin, bowBitsMax), chargeUsesPerTier - 1, 'PvP ranged uses share the bow tier counter');
  runRangedUse(bowQuest, 'pvp', pvpOpponent);
  assert.equal(bowQuest.invGetSlot(worn, types.ObjType.getWearPosId('righthand')), null,
    'final PvP ranged use removes the worn 1/10 bow when inventory has space');
  assert.equal(count(bowQuest, 'crystal_seed_old'), 1, 'final PvP ranged use returns a raw seed to inventory');
  assert.equal(chargeUses(bowQuest, bowBitsMin, bowBitsMax), 0, 'final bow depletion resets the use counter');

  removeOneByName(bowQuest, 'pot_empty');
  give(bowQuest, 'coins', ilfeenConstant('roving_ilfeen_bow_fee_first'));
  startNpc(bowQuest, ilfeenTarget, '[opnpc1,roving_update_female_woodelf]', [bowChoice]);
  assert.equal(count(bowQuest, 'crystal_seed_old'), 0, 'Ilfeen re-enchants the depleted quest bow seed');
  assert.equal(count(bowQuest, 'roving_crystal_bow_1000'), 1, 'Ilfeen returns a full bow after seed depletion');
  assert.equal(bowQuest.getVar(ilfeenCountVarp), 1, 'successful Ilfeen call advances the shared fee schedule');
  assert.equal(chargeUses(bowQuest, bowBitsMin, bowBitsMax), 0, 'Ilfeen resets bow charge bits');
  startItemOption(bowQuest, 'roving_crystal_bow_1000', 2);
  positionAt(bowQuest, targetTile);
  for (let hit = 0; hit < chargeUsesPerTier; hit++) runRangedUse(bowQuest, 'npc', targetNpc);
  assert.equal(bowQuest.invGetSlot(worn, types.ObjType.getWearPosId('righthand'))?.id, obj('roving_crystal_bow_900'),
    'Ilfeen full bow follows the native NPC use step to 90 percent');
  assert.equal(chargeUses(bowQuest, bowBitsMin, bowBitsMax), 0, 'full-bow tier transition resets the counter');

  const overflowBow = newPlayer();
  setVar(overflowBow, rovingStageVarp, rovingComplete);
  overflowBow.baseLevels[PlayerStat.RANGED] = 70;
  overflowBow.levels[PlayerStat.RANGED] = 70;
  setChargeUses(overflowBow, bowBitsMin, bowBitsMax, chargeUsesPerTier - 1);
  give(overflowBow, 'roving_crystal_bow_100');
  startItemOption(overflowBow, 'roving_crystal_bow_100', 2);
  fillInventory(overflowBow);
  positionAt(overflowBow, targetTile);
  const bowDropTile = [overflowBow.level, overflowBow.x, overflowBow.z];
  const bowAdds = captureObjAdds('crystal_seed_old', () => runRangedUse(overflowBow, 'pvp', pvpOpponent));
  assert.equal(overflowBow.invGetSlot(worn, types.ObjType.getWearPosId('righthand')), null,
    'full-inventory final PvP depletion removes the worn 1/10 bow');
  assert.equal(chargeUses(overflowBow, bowBitsMin, bowBitsMax), 0, 'full-inventory final bow depletion resets its counter');
  assertGroundOverflow(overflowBow, 'crystal bow', bowDropTile[1], bowDropTile[2], bowDropTile[0], bowAdds);
  testOwnedGroundItem(overflowBow, 'crystal bow overflow', 'crystal_seed_old', bowDropTile[1], bowDropTile[2], bowDropTile[0]);

  assert.equal(count(shieldQuest, 'roving_crystal_shield_200'), 1, 'the shield reward branch supplied its 2/10 shield');
  shieldQuest.baseLevels[PlayerStat.AGILITY] = 50;
  shieldQuest.levels[PlayerStat.AGILITY] = 50;
  shieldQuest.baseLevels[PlayerStat.DEFENCE] = 70;
  shieldQuest.levels[PlayerStat.DEFENCE] = 70;
  startItemOption(shieldQuest, 'roving_crystal_shield_200', 2);
  assert.equal(chargeUses(shieldQuest, shieldBitsMin, shieldBitsMax), 0, 'shield reward starts with reset charge bits');
  for (let hit = 0; hit < chargeUsesPerTier - 1; hit++) runDamageQueue(shieldQuest, '[queue,combat_damage_player]');
  const shieldSlot = types.ObjType.get(obj('roving_crystal_shield_200')).wearpos;
  assert.equal(shieldQuest.invGetSlot(worn, shieldSlot)?.id, obj('roving_crystal_shield_200'),
    '249 NPC damage queue hits retain the 2/10 shield');
  assert.equal(chargeUses(shieldQuest, shieldBitsMin, shieldBitsMax), chargeUsesPerTier - 1, 'NPC damage queue increments the shield counter');
  runDamageQueue(shieldQuest, '[queue,pvp_damage]');
  assert.equal(shieldQuest.invGetSlot(worn, shieldSlot)?.id, obj('roving_crystal_shield_100'),
    'the 250th PvP damage queue hit moves the 2/10 shield to 1/10');
  assert.equal(chargeUses(shieldQuest, shieldBitsMin, shieldBitsMax), 0, 'shield tier transition resets the counter');
  for (let hit = 0; hit < chargeUsesPerTier - 1; hit++) runDamageQueue(shieldQuest, '[queue,pvp_damage]');
  assert.equal(chargeUses(shieldQuest, shieldBitsMin, shieldBitsMax), chargeUsesPerTier - 1, 'PvP damage queue increments the same shield counter');
  fillInventory(shieldQuest);
  const shieldDropTile = [shieldQuest.level, shieldQuest.x, shieldQuest.z];
  const shieldAdds = captureObjAdds('crystal_seed_old', () => runDamageQueue(shieldQuest, '[queue,combat_damage_player]'));
  assert.equal(shieldQuest.invGetSlot(worn, shieldSlot), null, 'full-inventory final NPC damage removes the worn 1/10 shield');
  assert.equal(chargeUses(shieldQuest, shieldBitsMin, shieldBitsMax), 0, 'full-inventory final shield depletion resets its counter');
  assertGroundOverflow(shieldQuest, 'crystal shield', shieldDropTile[1], shieldDropTile[2], shieldDropTile[0], shieldAdds);
  testOwnedGroundItem(shieldQuest, 'crystal shield overflow', 'crystal_seed_old', shieldDropTile[1], shieldDropTile[2], shieldDropTile[0]);
  const shieldXp = shieldQuest.stats[PlayerStat.STRENGTH];
  const shieldPoints = shieldQuest.getVar(questPointsVarp);
  const shieldScrolls = completedScrolls(shieldQuest);
  startNpc(shieldQuest, islwynTarget, '[opnpc1,roving_islwyn]');
  assert.equal(count(shieldQuest, 'roving_crystal_shield_200'), 0, 'repeat completed talk does not recreate the depleted shield');
  assert.equal(shieldQuest.stats[PlayerStat.STRENGTH], shieldXp, 'repeat completed talk does not award Strength XP');
  assert.equal(shieldQuest.getVar(questPointsVarp), shieldPoints, 'repeat completed talk does not award quest points');
  assert.equal(completedScrolls(shieldQuest), shieldScrolls, 'repeat completed talk does not replay the scroll');

  const ordinary = newPlayer();
  const ordinaryShield = types.ObjType.get(obj('bronze_kiteshield'));
  assert(ordinaryShield.wearpos >= 0, 'ordinary shield has a native worn slot');
  ordinary.getInventory(worn).set(ordinaryShield.wearpos, { id: ordinaryShield.id, count: 1 });
  setChargeUses(ordinary, shieldBitsMin, shieldBitsMax, 37);
  runDamageQueue(ordinary, '[queue,combat_damage_player]');
  runDamageQueue(ordinary, '[queue,pvp_damage]');
  assert.equal(ordinary.invGetSlot(worn, ordinaryShield.wearpos)?.id, ordinaryShield.id, 'ordinary shield remains unchanged through both damage queues');
  assert.equal(chargeUses(ordinary, shieldBitsMin, shieldBitsMax), 37, 'ordinary shield never consumes crystal charge');
  cleanupPlayer(ordinary);

  const ordinaryBow = newPlayer();
  const rightHand = types.ObjType.getWearPosId('righthand');
  const ordinaryBowId = obj('magic_shortbow');
  ordinaryBow.getInventory(worn).set(rightHand, { id: ordinaryBowId, count: 1 });
  const ordinaryArrow = obj('bronze_arrow');
  const quiver = types.ObjType.getWearPosId('quiver');
  ordinaryBow.getInventory(worn).set(quiver, { id: ordinaryArrow, count: 2 });
  setChargeUses(ordinaryBow, bowBitsMin, bowBitsMax, 29);
  positionAt(ordinaryBow, targetTile);
  runRangedUse(ordinaryBow, 'npc', targetNpc);
  assert.equal(ordinaryBow.invGetSlot(worn, rightHand)?.id, ordinaryBowId, 'ordinary bow retains its normal weapon form');
  assert.equal(ordinaryBow.invGetSlot(worn, quiver)?.count, 1, 'ordinary ranged use consumes one ordinary arrow');
  assert.equal(chargeUses(ordinaryBow, bowBitsMin, bowBitsMax), 29, 'ordinary bow does not consume crystal charge');

  cleanupPlayer(overflowBow);
  cleanupPlayer(pvpOpponent);
  cleanupPlayer(ordinaryBow);
}
function findNearbyWalkable(tile, excluded) {
  for (let radius = 1; radius <= 8; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const candidate = [tile[0], tile[1] + dx, tile[2] + dz];
        if (excluded.has(candidate.join(',')) || !floorTiles.has(candidate.join(','))
          || map.isMapBlocked(candidate[1], candidate[2], candidate[0])) continue;
        if (Array.from(map.findPath(tile[0], tile[1], tile[2], candidate[1], candidate[2]) ?? []).length) return candidate;
      }
    }
  }
  assert.fail(`no nearby walkable PvP tile from ${tile.join('_')}`);
}

const targets = {
  islwyn: nativeNpc('roving_islwyn'),
  eluned: nativeNpc('roving_female_woodelf'),
  ilfeen: nativeNpc('roving_update_female_woodelf'),
  guardian: nativeNpc('roving_mossgiant'),
  tombstone: nativeLoc('glarials_tombstone_waterfall_quest')
};
const ilfeenTarget = targets.ilfeen;
const islwynTarget = targets.islwyn;

try {
  assertPathNear(targets.guardian.stand, 'native Roving guardian');
  testGuardianGates(targets.guardian);
  const bowQuest = testQuestFlow(targets);

  const shieldQuest = newPlayer();
  setVar(shieldQuest, regicideVarp, regicideComplete);
  setVar(shieldQuest, waterfallVarp, waterfallComplete);
  setVar(shieldQuest, rovingStageVarp, rovingPlanted);
  setChargeUses(shieldQuest, bowBitsMin, bowBitsMax, 66);
  setChargeUses(shieldQuest, shieldBitsMin, shieldBitsMax, 77);
  const shieldBaselinePoints = countQuestPoints(shieldQuest);
  const shieldXpBefore = shieldQuest.stats[PlayerStat.STRENGTH];
  startNpc(shieldQuest, targets.islwyn, '[opnpc1,roving_islwyn]', [2]);
  assert.equal(stage(shieldQuest), rovingComplete, 'shield reward choice commits stage 6');
  assert.equal(count(shieldQuest, 'roving_crystal_shield_200'), 1, 'shield choice grants the partly-used crystal shield');
  assert.equal(count(shieldQuest, 'roving_crystal_bow_200'), 0, 'shield choice does not also grant a bow');
  assert.equal(shieldQuest.stats[PlayerStat.STRENGTH] - shieldXpBefore, 100000, 'shield choice grants the same 10,000 Strength XP');
  assert.equal(countQuestPoints(shieldQuest), shieldBaselinePoints + rovingQuestPoints, 'shield choice grants one quest point');
  assert.equal(chargeUses(shieldQuest, shieldBitsMin, shieldBitsMax), 0, 'shield reward resets its charge bits');
  assert.equal(chargeUses(shieldQuest, bowBitsMin, bowBitsMax), 66, 'shield reward leaves the bow counter untouched');
  assertQuestColour(shieldQuest, rovingComplete);
  assert.equal(completedScrolls(shieldQuest), 1, 'shield choice opens one completion scroll');

  testTombstone(targets.tombstone);
  testIlfeen(targets.ilfeen);
  testRangedAmmo();
  testEquipment();
  testCrystalCombat(bowQuest, shieldQuest, targets.guardian);
  console.log('PASS roving-elves: prerequisites, native quest path, guardian recovery, planting, rewards, tomb compatibility, Ilfeen, equipment and crystal combat');
} catch (error) {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  for (const p of players) cleanupPlayer(p);
  for (const npc of createdNpcs) {
    if (npc.isActive) World.removeNpc(npc, -1);
  }
}
process.exit(process.exitCode ?? 0);
