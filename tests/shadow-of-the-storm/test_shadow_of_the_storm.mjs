#!/usr/bin/env node
/** Packed Shadow of the Storm quest regression. Run after the sibling engine build. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EntityLifeCycle, InvButton, InvButtonHandler, Player, ResumePauseButton,
  ResumePauseButtonHandler, ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType,
  World, content, floorTiles, locFor, map, nativeLocRows, nativeNpcRows, requiredId, types, walkable
} from '../regicide-travel/runtime.mjs';

const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const engineModule = async relative => (await import(pathToFileURL(path.join(engine, 'src', relative)).href)).default;
const routefinder = await import(pathToFileURL(path.join(engine, 'src/engine/routefinder/index.ts')).href);
const { CollisionFlag } = await import(pathToFileURL(path.join(engine, 'src/engine/routefinder/flags.ts')).href);
const InstanceZone = await engineModule('engine/zone/InstanceZone.ts');
const rsbuf = await import(pathToFileURL(path.join(engine, 'src/network/rsbuf/index.ts')).href);
const { NpcStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/NpcStat.ts')).href);
const Npc = await engineModule('engine/entity/Npc.ts');
const OpHeld = await engineModule('network/game/client/model/OpHeld.ts');
const OpHeldU = await engineModule('network/game/client/model/OpHeldU.ts');
const IfButton = await engineModule('network/game/client/model/IfButton.ts');
const OpNpc = await engineModule('network/game/client/model/OpNpc.ts');
const OpNpcU = await engineModule('network/game/client/model/OpNpcU.ts');
const OpNpcHandler = await engineModule('network/game/client/handler/OpNpcHandler.ts');
const OpNpcUHandler = await engineModule('network/game/client/handler/OpNpcUHandler.ts');
const OpLoc = await engineModule('network/game/client/model/OpLoc.ts');
const OpLocU = await engineModule('network/game/client/model/OpLocU.ts');
const OpHeldHandler = await engineModule('network/game/client/handler/OpHeldHandler.ts');
const OpHeldUHandler = await engineModule('network/game/client/handler/OpHeldUHandler.ts');
const OpLocHandler = await engineModule('network/game/client/handler/OpLocHandler.ts');
const IfButtonHandler = await engineModule('network/game/client/handler/IfButtonHandler.ts');
const OpLocUHandler = await engineModule('network/game/client/handler/OpLocUHandler.ts');
const IfSetText = await engineModule('network/game/server/model/IfSetText.ts');
const IfSetNpcHead = await engineModule('network/game/server/model/IfSetNpcHead.ts');
const { PlayerStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const { ProtectedActivePlayer } = await import(pathToFileURL(path.join(engine, 'src/engine/script/ScriptPointer.ts')).href);
const { ParamHelper } = await import(pathToFileURL(path.join(engine, 'src/cache/config/ParamHelper.ts')).href);
const JavaRandom = await engineModule('util/JavaRandom.ts');

const invId = requiredId(types.InvType, 'inv');
const wornId = requiredId(types.InvType, 'worn');
const invCom = requiredId(types.Component, 'inventory:inv');
const wornCom = requiredId(types.Component, 'wornitems:worn');
const ownerVar = requiredId(types.VarNpcType, 'agrith_owner');
const delayVar = requiredId(types.VarNpcType, 'npc_action_delay');
const aggressiveVar = requiredId(types.VarNpcType, 'npc_aggressive_player');
const questBit = requiredId(types.VarBitType, 'agrith_quest');
const protectMelee = requiredId(types.VarPlayerType, 'prayer14');
const protectMagic = requiredId(types.VarPlayerType, 'prayer12');
const bossType = types.NpcType.getByName('agrith_naar');
const bankId = requiredId(types.InvType, 'bank');
assert(bossType, 'packed Agrith Naar type exists');
const bossRange = bossType.size;
const roomSourceLevel = 2;
const roomSourceMapsquareX = 42;
const roomSourceMapsquareZ = 76;
const roomSourceX = roomSourceMapsquareX << 6;
const roomSourceZ = roomSourceMapsquareZ << 6;
const roomExit = { level: 0, x: roomSourceX + 25, z: roomSourceZ + 49 };
const bossLocal = [31, 37];
const distantOwnerLocal = [37, 26];
const closeOwnerLocal = [34, 37];
const originalCultSpots = {
  agrith_denath: [32, 41],
  agrith_eric: [35, 34],
  agrith_matthew: [34, 34],
  agrith_jennifer: [28, 34],
  agrith_tanya: [30, 40],
  agrith_patrick: [35, 42]
};
const helperSpots = {
  agrith_badden_sigil: [35, 37],
  agrith_reen_sigil: [28, 37],
  agrith_golem_sigil: [32, 42],
  agrith_dave_sigil: [29, 40]
};
const originalCultNames = Object.keys(originalCultSpots);
const helperNames = Object.keys(helperSpots);
const roomActorTypes = new Set([...originalCultNames, ...helperNames].map(name => id('NpcType', name)));

const handSlot = types.ObjType.get(requiredId(types.ObjType, 'silverlight')).wearpos;
assert.equal(handSlot, 3, 'the original Silverlight config identifies the right-hand wear slot');
const questLocationRows = [
  'golem_insidestairs_top', 'golem_insidestairs_base', 'golem_portal', 'golem_demon_portal',
  'agrith_kiln_1', 'agrith_kiln_2', 'agrith_kiln_3', 'agrith_kiln_4'
].flatMap(name => nativeLocRows(name));
let playerSerial = 0;
let checks = 0;
let failures = 0;
function check(name, body) {
  try {
    body();
    checks++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function id(type, name) {
  return requiredId(types[type], name);
}
const heldHandler = new OpHeldHandler();
const heldUseHandler = new OpHeldUHandler();
const npcHandler = new OpNpcHandler();
const npcUseHandler = new OpNpcUHandler();
const locHandler = new OpLocHandler();
const locUseHandler = new OpLocUHandler();
const buttonHandler = new IfButtonHandler();
const continueHandler = new ResumePauseButtonHandler();
const invButtonHandler = new InvButtonHandler();
const questConstantSource = [
  'scripts/general/configs/quest.constant',
  'scripts/quests/quest_golem/configs/golem.constant'
].map(relative => readFileSync(path.join(content, relative), 'utf8')).join('\n');
function questConstant(name) {
  const match = questConstantSource.match(new RegExp(`^\\^${name}\\s*=\\s*(-?\\d+)\\s*$`, 'm'));
  assert(match, `period quest constant ${name} is present`);
  return Number(match[1]);
}
function playerVariable(player, name) {
  const bit = types.VarBitType.getId(name);
  if (bit >= 0) return player.getVarBit(bit);
  const varp = types.VarPlayerType.getId(name);
  assert(varp >= 0, `packed player variable ${name} exists`);
  return player.getVar(varp);
}
function setPlayerVariable(player, name, value) {
  const bit = types.VarBitType.getId(name);
  if (bit >= 0) {
    player.setVarBit(bit, value);
    return;
  }
  const varp = types.VarPlayerType.getId(name);
  assert(varp >= 0, `packed player variable ${name} exists`);
  player.setVar(varp, value);
}
function placePlayer(player, tile) {
  [player.level, player.x, player.z] = tile;
  const originX = Math.floor(tile[1] / 8) * 8;
  const originZ = Math.floor(tile[2] / 8) * 8;
  player.buildArea.originX = originX;
  player.buildArea.originZ = originZ;
  player.originX = originX;
  player.originZ = originZ;
  player.lastMovement = World.currentTick - 20;
}
function itemId(name) {
  return id('ObjType', name);
}
function itemCount(player, name, inventory = invId) {
  return player.invTotal(inventory, itemId(name));
}
function itemSlot(player, name, inventory = invId) {
  const slot = player.getInventory(inventory).items.findIndex(item => item?.id === itemId(name));
  assert(slot >= 0, `${name} is in inventory ${inventory}`);
  return slot;
}
function addItem(player, name, amount = 1, inventory = invId) {
  assert.equal(player.invAdd(inventory, itemId(name), amount), amount, `${name} fits in inventory ${inventory}`);
}
function removeItem(player, name, amount = 1, inventory = invId) {
  player.invDel(inventory, itemId(name), amount);
  assert.equal(itemCount(player, name, inventory), 0, `${name} was removed from inventory ${inventory}`);
}
function showNpc(player, npc) {
  player.buildArea.rebuild();
  if (!rsbuf.hasNpc(player.slot, npc.nid)) rsbuf.addNpc(npc.nid, npc.type);
  const appearance = player.generateAppearance();
  rsbuf.computePlayer(
    player.x, player.level, player.z, player.originX, player.originZ, player.slot, player.tele, player.jump,
    player.runDir, player.walkDir, player.visibility, player.isActive, player.masks, appearance, player.lastAppearance,
    player.faceEntity, player.faceSquareX, player.faceSquareZ, player.faceAngleX, player.faceAngleZ,
    player.hitmarkDamage, player.hitmarkType, player.hitmark2Damage, player.hitmark2Type,
    player.levels[PlayerStat.HITPOINTS], player.baseLevels[PlayerStat.HITPOINTS], player.animId, player.animDelay,
    player.sayMessage, player.chatMessage, player.chatColour ?? -1, player.chatEffect ?? -1, player.chatRights ?? 0,
    player.spotanimId, player.spotanimHeight, player.spotanimTime
  );
  rsbuf.computeNpc(
    npc.x, npc.level, npc.z, npc.nid, npc.type, npc.tele, npc.jump,
    npc.runDir, npc.walkDir, npc.isActive, npc.masks, npc.faceEntity,
    npc.faceSquareX, npc.faceSquareZ, npc.faceAngleX, npc.faceAngleZ,
    npc.hitmarkDamage, npc.hitmarkType, npc.hitmark2Damage, npc.hitmark2Type,
    npc.levels[NpcStat.HITPOINTS], npc.baseLevels[NpcStat.HITPOINTS], npc.animId,
    npc.animDelay, npc.sayMessage, npc.spotanimId, npc.spotanimHeight, npc.spotanimTime
  );
  rsbuf.npcInfo(0, player.slot, 0, 0, true);
  assert(rsbuf.hasNpc(player.slot, npc.nid), 'the client packet path sees the native NPC');
}
function finishInteraction(player, choices = [], label = 'packed interaction', observePause = null) {
  const remaining = [...choices];
  for (let step = 0; step < 160; step++) {
    const state = player.activeScript;
    if (!state) {
      assert.equal(remaining.length, 0, `${label} used all dialogue choices`);
      return;
    }
    assert.notEqual(state.execution, ScriptState.ABORTED, `${label} script did not abort`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      observePause?.(player, state);
      const root = player.modalChat >= 0 ? types.Component.get(player.modalChat)?.comName ?? '' : '';
      if (/^multi[2-5]$/.test(root)) {
        assert(remaining.length > 0, `${label} supplies a choice for ${root}`);
        const component = id('Component', `${root}:com_${remaining.shift()}`);
        assert(player.resumeButtons.includes(component), `${label} offered ${root} choice`);
        assert(buttonHandler.handle(new IfButton(component), player), `${label} choice accepted`);
      } else {
        assert(continueHandler.handle(new ResumePauseButton(0), player), `${label} Continue accepted`);
      }
      continue;
    }
    if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, player.delayedUntil);
      player.delayed = false;
      player.executeScript(state, true, true);
      continue;
    }
    if (state.execution === ScriptState.FINISHED) {
      assert.equal(remaining.length, 0, `${label} used all dialogue choices`);
      return;
    }
    assert.fail(`${label} stopped at execution state ${state.execution}`);
  }
  assert.fail(`${label} exceeded the compiled interaction bound`);
}
function runPlayerScript(player, name, choices = [], target = null, args = []) {
  const script = ScriptProvider.getByName(name);
  assert(script, `packed script ${name} exists`);
  const state = ScriptRunner.init(script, player, target, args);
  player.executeScript(state, true, true);
  finishInteraction(player, choices, name);
  return state;
}
function spawnActor(player, name, actors, tile = [player.level, player.x + 1, player.z]) {
  const type = types.NpcType.getByName(name);
  assert(type, `packed NPC ${name} exists`);
  const nid = World.npcs.next();
  const size = type.size || 1;
  const npc = new Npc(tile[0], tile[1], tile[2], size, size, EntityLifeCycle.RESPAWN, nid, type.id, type.blockwalk);
  npc.lastMovement = -100;
  World.addNpc(npc, -1);
  npc.setVar(ownerVar, player.uid);
  actors.push(npc);
  return npc;
}
function cleanupQuestRun(player, actors) {
  const owned = [...World.npcs].filter(npc => npc.getVar(ownerVar) === player.uid);
  for (const npc of new Set([...actors, ...owned])) {
    if (!npc.isActive) continue;
    World.removeNpc(npc, -1);
    rsbuf.removeNpc(npc.nid);
    World.npcs.remove(npc.nid);
    npc.cleanup();
  }
  cleanup(player);
}
function nativeNpc(player, npc, choices = [], label = 'NPC Talk-to', expectedName = null, observePause = null) {
  approachNpc(player, npc);
  showNpc(player, npc);
  assert(npcHandler.handle(new OpNpc(1, npc.nid), player), `${label} accepts the NPC interaction`);
  assert.equal(player.target, npc, `${label} selects the visible NPC`);
  assert(player.validateTarget(), `${label} keeps the native NPC target`);
  const trigger = player.getOpTrigger();
  assert(trigger, `${label} resolves its visible-form trigger`);
  if (expectedName) assert.equal(trigger.name, expectedName, `${label} resolves the expected visible script`);
  player.processInteraction();
  finishInteraction(player, choices, label, observePause);
  return trigger;
}
function nativeUseNpc(player, npc, item, label = `use ${item} on NPC`) {
  approachNpc(player, npc);
  showNpc(player, npc);
  assert(npcUseHandler.handle(new OpNpcU(npc.nid, itemId(item), itemSlot(player, item), invCom), player),
    `${label} accepts the selected item and visible NPC`);
  assert.equal(player.target, npc, `${label} selects the visible NPC`);
  assert(player.validateTarget(), `${label} keeps the native NPC target`);
  const trigger = player.getOpTrigger();
  assert(trigger, `${label} resolves its visible-form trigger`);
  player.processInteraction();
  finishInteraction(player, [], label);
  return trigger;
}
function nativeLoc(player, loc, choices = [], label = 'location option', option = 1) {
  assert(locHandler.handle(new OpLoc(option, loc.x, loc.z, loc.type), player), `${label} accepts the packed location`);
  const trigger = player.getOpTrigger();
  assert(trigger, `${label} resolves its visible-form trigger`);
  player.processInteraction();
  finishInteraction(player, choices, label);
  return trigger;
}
function nativeUseLoc(player, row, item, label = `use ${item} on ${row.name}`) {
  const loc = locFor(row);
  positionPlayer(player, standForLoc(row));
  const message = new OpLocU(loc.x, loc.z, loc.type, itemId(item), itemSlot(player, item), invCom);
  assert(locUseHandler.handle(message, player), `${label} accepts the native item-on-location operation`);
  assert.equal(player.target, loc, `${label} selects the packed location`);
  assert(player.validateTarget(), `${label} keeps the native location target`);
  const trigger = player.getOpTrigger();
  assert(trigger, `${label} resolves its category trigger`);
  player.processInteraction();
  finishInteraction(player, [], label);
  return trigger;
}
function useItem(player, targetName, usedName, label = `${usedName} on ${targetName}`) {
  const targetSlot = itemSlot(player, targetName);
  const usedSlot = itemSlot(player, usedName);
  assert(heldUseHandler.handle(new OpHeldU(itemId(targetName), targetSlot, invCom, itemId(usedName), usedSlot, invCom), player),
    `${label} accepts the native item-on-item operation`);
  const state = player.activeScript;
  if (state) finishInteraction(player, [], label);
  return state;
}
function wearItem(player, name) {
  const idValue = itemId(name);
  const slot = itemSlot(player, name);
  assert(heldHandler.handle(new OpHeld(2, idValue, slot, invCom), player), `${name} native Wear/Wield is accepted`);
  finishInteraction(player, [], `wear ${name}`);
  const wearpos = types.ObjType.get(idValue).wearpos;
  assert(wearpos >= 0, `${name} has an authored wear slot`);
  assert.equal(player.invGetSlot(wornId, wearpos)?.id, idValue, `${name} occupies its actual packed wear position`);
  return wearpos;
}
function removeWornItem(player, name) {
  const slot = itemSlot(player, name, wornId);
  assert(invButtonHandler.handle(new InvButton(1, itemId(name), slot, wornCom), player), `${name} native Remove is accepted`);
  finishInteraction(player, [], `remove ${name}`);
  assert.equal(itemCount(player, name, wornId), 0, `${name} left the worn inventory`);
  assert.equal(itemCount(player, name), 1, `${name} returned to the inventory`);
}
function holdItem(player, name, option, choices = [], label = `item option ${option} on ${name}`) {
  assert(heldHandler.handle(new OpHeld(option, itemId(name), itemSlot(player, name), invCom), player),
    `${label} accepts the native inventory option`);
  const state = player.activeScript;
  if (state) finishInteraction(player, choices, label);
  else assert.equal(choices.length, 0, `${label} has no unused dialogue choices`);
  return state;
}
function standForLoc(row) {
  const type = types.LocType.get(requiredId(types.LocType, row.name));
  assert(type, `packed location type ${row.name} exists`);
  for (let radius = 1; radius <= 8; radius++) {
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      const x = row.x + dx, z = row.z + dz;
      if (x >= row.x && x < row.x + type.width && z >= row.z && z < row.z + type.length) continue;
      const tile = [row.level, x, z];
      if (!packedFloorAt(tile) || map.isMapBlocked(x, z, row.level)) continue;
      if (map.reachedLoc(row.level, x, z, row.x, row.z, type.width, type.length, 1,
        row.angle, row.shape, type.forceapproach)) return tile;
    }
  }
  assert.fail(`no walkable packed stand reaches ${row.name} at ${row.coord ?? [row.level, row.x, row.z].join(',')}`);
}
function nativeLocRow(player, row, choices = [], label = `loc ${row.name}`, option = 1) {
  positionPlayer(player, standForLoc(row));
  return nativeLoc(player, locFor(row), choices, label, option);
}
function questPoints(player) {
  const script = ScriptProvider.getByName('[proc,count_questpoints]');
  assert(script, 'packed Quest Points counter exists');
  const state = ScriptRunner.init(script, player);
  player.executeScript(state, true, true);
  finishInteraction(player, [], 'count quest points');
  assert.equal(state.isp, 1, 'Quest Points counter returns one integer');
  return state.popInt();
}
function settlePlayerQueue(player, choices, label) {
  const remaining = [...choices];
  for (let step = 0; step < 100; step++) {
    if (player.queue.head() === null && !player.activeScript) {
      assert.equal(remaining.length, 0, `${label} consumes the selected reward`);
      return;
    }
    World.currentTick = Math.max(World.currentTick + 1, player.delayedUntil);
    player.delayed = false;
    player.processQueues();
    if (player.activeScript) finishInteraction(player, remaining.splice(0), label);
  }
  assert.fail(`${label} player queue did not settle`);
}
function footprintDistance(tile, npc) {
  const width = npc.width ?? npc.size;
  const length = npc.length ?? npc.size;
  const dx = tile[1] < npc.x ? npc.x - tile[1] : tile[1] > npc.x + width - 1 ? tile[1] - (npc.x + width - 1) : 0;
  const dz = tile[2] < npc.z ? npc.z - tile[2] : tile[2] > npc.z + length - 1 ? tile[2] - (npc.z + length - 1) : 0;
  return Math.max(dx, dz);
}
function playerAt(tile, stage = 110) {
  const slot = ++playerSerial;
  const username37 = BigInt(1000 + slot);
  const hash64 = BigInt(0x100000 + slot);
  const player = new Player(`shadowstorm_test_${slot}`, username37, hash64);
  player.slot = slot;
  player.pid = slot;
  player.uid = ((Number(username37 & 0x1fffffn) << 11) | slot) >>> 0;
  player.vars.fill(0);
  player.baseLevels.fill(99);
  player.levels.fill(99);
  player.stats.fill(0);
  player.messages = [];
  player.packets = [];
  [player.level, player.x, player.z] = tile;
  player.isActive = true;
  player.write = packet => player.packets.push(packet);
  player.messageGame = text => player.messages.push(String(text));
  player.wrappedMessageGame = player.messageGame;
  placePlayer(player, tile);
  player.getInventory(invId);
  player.getInventory(wornId);
  player.getInventory(bankId);
  player.tabs[3] = types.Component.get(invCom).rootLayer;
  player.tabs[4] = types.Component.get(wornCom).rootLayer;
  player.invListenOnCom(invId, invCom, player.uid);
  player.invListenOnCom(wornId, wornCom, player.uid);
  World.players[slot] = player;
  World.playerLoop.add(hash64, player);
  rsbuf.addPlayer(player.slot);
  player.setVarBit(questBit, stage);
  return player;
}
function cleanup(player, npc) {
  if (npc?.isActive) {
    World.removeNpc(npc, -1);
    rsbuf.removeNpc(npc.nid);
    World.npcs.remove(npc.nid);
    npc.cleanup();
  }
  if (player) {
    const instance = currentInstance(player);
    if (instance) {
      if (sameCoord(instance.exitCoord, roomExit)) exitPrivateRoom(player, 'native room cleanup exit');
      else positionPlayer(player, [0, 3270, 3158]);
    }
    player.unlink();
    rsbuf.removePlayer(player.slot);
    delete World.players[player.slot];
  }
}
function packedFloorAt(tile) {
  const zone = World.gameMap.getZoneIfExists(tile[1], tile[2], tile[0]);
  if (zone instanceof InstanceZone) {
    assert.equal(zone.rotation, 0, 'the throne-room copy preserves source orientation');
    const sourceX = (zone.source.x << 3) + (tile[1] & 7);
    const sourceZ = (zone.source.z << 3) + (tile[2] & 7);
    return floorTiles.has([zone.source.level, sourceX, sourceZ].join(','));
  }
  return floorTiles.has(tile.join(','));
}
function packedTileWalkable(tile, label) {
  assert(packedFloorAt(tile), `${label}: destination has the packed source floor`);
  assert.equal(map.isMapBlocked(tile[1], tile[2], tile[0]), false, `${label}: copied collision leaves the tile walkable`);
}
function pathOut(start, npc) {
  for (let radius = 2; radius <= 8; radius++) {
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      const dest = [start[0], start[1] + dx, start[2] + dz];
      if (footprintDistance(dest, npc) === 0) continue;
      if (!packedFloorAt(dest) || map.isMapBlocked(dest[1], dest[2], dest[0])) continue;
      const route = routefinder.findPath(
        start[0], start[1], start[2], dest[1], dest[2], 1, 1, 1,
        0, 0, false, 0, 32, routefinder.CollisionType.NORMAL
      );
      if (route.length > 0) return route;
    }
  }
  assert.fail(`no non-empty packed collision path out of ${start.join(',')}`);
}
function runNpcAi(npc, player, trigger, args = []) {
  const script = ScriptProvider.getByTrigger(trigger, bossType.id, bossType.category);
  assert(script, `packed Agrith Naar trigger ${trigger} exists`);
  const expected = trigger === ServerTriggerType.AI_APPLAYER2 ? '[ai_applayer2,agrith_naar]' : '[ai_queue2,agrith_naar]';
  assert.equal(script.name, expected, 'the engine trigger selects the real Agrith Naar script');
  const state = ScriptRunner.init(script, npc, player, args);
  state.pointerAdd(ProtectedActivePlayer[0]);
  npc.executeScript(state);
  assert.equal(state.execution, ScriptState.FINISHED, `${script.name} finishes in the production interpreter`);
  return state;
}
function runNpcQueue(npc, trigger, damage) {
  npc.enqueueScript(trigger, 0, damage);
  for (let step = 0; step < 80; step++) {
    if (!npc.activeScript && npc.queue.head() === null) return;
    World.currentTick = Math.max(World.currentTick + 1, npc.delayedUntil);
    npc.delayed = false;
    npc.processQueue();
    if (npc.activeScript) npc.executeScript(npc.activeScript);
  }
  assert.fail(`native ${trigger} queue did not finish`);
}
function combatFixture(localTile, meleePrayer = false, magicPrayer = false) {
  const { player } = questFixture(110);
  const npc = summonNativeBoss(player, 'native combat fixture');
  if (meleePrayer) player.setVar(protectMelee, 1);
  if (magicPrayer) player.setVar(protectMagic, 1);
  positionPlayer(player, roomCoord(player, localTile[0], localTile[1]));
  return { player, npc };
}
function param(type, name) {
  const definition = types.ParamType.getByName(name);
  assert(definition, `packed param ${name} exists`);
  return ParamHelper.getIntParam(definition.id, type, definition.defaultInt);
}

check('published client/config remains byte-identical and quest items are config-untradeable', () => {
  const expected = JSON.parse(readFileSync(path.join(content, 'tests/cfg-other/published.json'), 'utf8')).clientConfigSha256;
  const actual = createHash('sha256').update(readFileSync(path.join(pack, 'client/config'))).digest('hex');
  assert.equal(actual, expected, 'the 377 client config is unchanged');
  for (const name of [
    'agrith_sigil_mould', 'agrith_sigil', 'agrith_book', 'agrith_silverlight_dyed',
    'agrith_desert_shirt_dyed', 'agrith_desert_robe_dyed', 'darklight'
  ]) {
    assert.equal(types.ObjType.get(id('ObjType', name)).tradeable, false, `${name} is nontradeable in packed config`);
  }
});

check('native account copies preserve the original room and stage-specific actors without shared cultists', () => {
  assertNoSharedCultists();
  for (const stage of [30, 40, 50, 60, 70, 80, 90, 100, 110, 120]) {
    const { player, actors } = questFixture(stage);
    try {
      assertRoomActorCast(player, stage);
      if (stage === 120) {
        assert.equal(roomNpcOrNull(player, 'agrith_matthew'), null, 'stage 120 has no Matthew after initial entry');
        exitPrivateRoom(player, 'stage 120 first departure');
        enterQuestRoom(player, 'stage 120 native re-entry');
        assertRoomActorCast(player, 120);
        assert.equal(roomNpcOrNull(player, 'agrith_matthew'), null, 'stage 120 re-entry keeps Matthew absent');
      }
    } finally {
      cleanupQuestRun(player, actors);
    }
  }

  const first = questFixture(70);
  const second = questFixture(70);
  try {
    const firstActors = originalCultNames.map(name => roomNpc(first.player, name));
    const secondActors = originalCultNames.map(name => roomNpc(second.player, name));
    setWords(first.player);
    addItem(first.player, 'agrith_sigil');
    positionPlayer(first.player, roomCoord(first.player, 32, 31));
    holdItem(first.player, 'agrith_sigil', 1, roomWords(first.player), 'first account native first chant');
    assertFirstChantOutcome(first.player);
    assert.equal(questStage(second.player), 70, 'first account chant leaves second account stage unchanged');
    assert.deepEqual(roomActorCast(second.player),
      originalCultNames.map(name => [id('NpcType', name), ...originalCultSpots[name]]).sort((left, right) => left[0] - right[0]),
      'first account chant leaves the other account actor cast unchanged');
    assert(secondActors.every(npc => npc.isActive), 'the other account keeps all six native cultists');
    assert(firstActors.filter((_, index) => originalCultNames[index] !== 'agrith_matthew').every(npc => !npc.isActive),
      'first account loses only the five scripted cultists');
    assert.equal(roomNpc(first.player, 'agrith_matthew').isActive, true, 'first account keeps Matthew');
    assert.equal(roomObjects(second.player, 'agrith_sigil').length, 0, 'first account drops no sigil into the other copy');
    assertNoSharedSigils();
  } finally {
    cleanupQuestRun(first.player, first.actors);
    cleanupQuestRun(second.player, second.actors);
  }
});

check('the sigil ritual rejects another native copy without chanting, consuming, or summoning', () => {
  for (const stage of [70, 110]) {
    const { player, actors } = questFixture(stage);
    try {
      exitPrivateRoom(player, 'leave the quest-specific copy before foreign-instance check');
      assertUnrelatedRoomRejectsRitual(player, stage);
    } finally {
      cleanupQuestRun(player, actors);
    }
  }
});

check('Agrith Naar uses the source-local 3x3 footprint in each native room copy', () => {
  const { player, actors } = questFixture(110);
  let npc;
  try {
    npc = summonNativeBoss(player, 'native boss footprint fixture');
    assert.equal(bossRange, 3, 'the original Agrith Naar size is retained');
    const instance = currentInstance(player);
    assert.deepEqual([npc.level, npc.x - instance.sw.x, npc.z - instance.sw.z], [0, ...bossLocal],
      'the boss uses its source-local throne-room anchor');
    for (let dx = 0; dx < bossRange; dx++) for (let dz = 0; dz < bossRange; dz++) {
      assert(packedFloorAt([npc.level, npc.x + dx, npc.z + dz]), 'every tile of the copied boss footprint has original floor');
    }
    const owner = roomCoord(player, ...distantOwnerLocal);
    packedTileWalkable(owner, 'distant owner stand on copied source floor');
    assert(footprintDistance(owner, npc) > 1, 'owner starts outside melee reach of the native 3x3 footprint');
  } finally {
    cleanup(player, npc);
    for (const other of [...World.npcs].filter(candidate => candidate.getVar(ownerVar) === player.uid)) {
      if (!other.isActive) continue;
      World.removeNpc(other, -1);
      rsbuf.removeNpc(other.nid);
      World.npcs.remove(other.nid);
      other.cleanup();
    }
  }
});

check('compiled AI pulls a distant owner to a walkable tile adjacent to the copied footprint', () => {
  const { player, npc } = combatFixture(distantOwnerLocal);
  try {
    runNpcAi(npc, player, ServerTriggerType.AI_APPLAYER2);
    const landing = [player.level, player.x, player.z];
    packedTileWalkable(landing, 'native Agrith Naar pullback landing');
    assert.equal(footprintDistance(landing, npc), 1, 'player lands adjacent to the actual private 3x3 footprint');
    assert.notEqual(footprintDistance(landing, npc), 0, 'player does not land inside the boss footprint');
    assert(pathOut(landing, npc).length > 0, 'the pullback landing has a non-empty copied collision path out');
  } finally {
    cleanup(player, npc);
  }
});

check('compiled AI chooses melee close, magic at range, and avoids each protected style', () => {
  const meleeAnim = param(bossType, 'attack_anim');
  const magicAnim = param(bossType, 'magicattack_anim');
  assert.notEqual(meleeAnim, magicAnim, 'the packed boss has distinct melee and magic animations');
  const cases = [
    { label: 'close unprotected', tile: closeOwnerLocal, protectMelee: false, protectMagic: false, expected: meleeAnim, pull: false },
    { label: 'close Protect from Melee', tile: closeOwnerLocal, protectMelee: true, protectMagic: false, expected: magicAnim, pull: false },
    { label: 'distant unprotected', tile: distantOwnerLocal, protectMelee: false, protectMagic: false, expected: magicAnim, pull: true },
    { label: 'distant Protect from Magic', tile: distantOwnerLocal, protectMelee: false, protectMagic: true, expected: meleeAnim, pull: true }
  ];
  for (const test of cases) {
    const { player, npc } = combatFixture(test.tile, test.protectMelee, test.protectMagic);
    try {
      runNpcAi(npc, player, ServerTriggerType.AI_APPLAYER2);
      assert.equal(npc.animId, test.expected, `${test.label} selects the intended compiled attack style`);
      if (test.pull) {
        const landing = [player.level, player.x, player.z];
        packedTileWalkable(landing, `${test.label} pullback landing`);
        assert.equal(footprintDistance(landing, npc), 1, `${test.label} lands outside and adjacent to the boss`);
      }
    } finally {
      cleanup(player, npc);
    }
  }
});

check('lethal queue hit restores 12 HP without Silverlight and permits Silverlight or dyed-Silverlight finishers', () => {
  for (const [weapon, expectedHp] of [[null, 12], ['silverlight', 0], ['agrith_silverlight_dyed', 0]]) {
    const { player, npc } = combatFixture(closeOwnerLocal);
    try {
      npc.levels[3] = 12;
      if (weapon) player.invSet(wornId, id('ObjType', weapon), 1, handSlot);
      runNpcQueue(npc, ServerTriggerType.AI_QUEUE2, 12);
      assert.equal(npc.levels[3], expectedHp, `${weapon ?? 'an unqualified weapon'} lethal hit has the correct finisher outcome`);
    } finally {
      cleanup(player, npc);
    }
  }
});

function instanceAt(tile) {
  return World.instances.findInstanceByCoord({ level: tile[0], x: tile[1], z: tile[2] });
}
function currentInstance(player) {
  return instanceAt([player.level, player.x, player.z]);
}
function sameCoord(left, right) {
  return left !== null && right !== null &&
    left.level === right.level && left.x === right.x && left.z === right.z;
}
function coordLabel(coord) {
  return `${coord.level}_${coord.x >> 6}_${coord.z >> 6}_${coord.x & 63}_${coord.z & 63}`;
}
function positionPlayer(player, tile) {
  player.teleport(tile[1], tile[2], tile[0]);
  const originX = Math.floor(tile[1] / 8) * 8;
  const originZ = Math.floor(tile[2] / 8) * 8;
  player.buildArea.originX = originX;
  player.buildArea.originZ = originZ;
  player.originX = originX;
  player.originZ = originZ;
  player.lastMovement = World.currentTick - 20;
}
function approachNpc(player, npc) {
  player.closeModal();
  for (const [dx, dz] of [[-1, 0], [npc.width, 0], [0, -1], [0, npc.length], [-1, -1]]) {
    const tile = [npc.level, npc.x + dx, npc.z + dz];
    if (!packedFloorAt(tile) || map.isMapBlocked(tile[1], tile[2], tile[0])) continue;
    positionPlayer(player, tile);
    return;
  }
  assert.fail(`no open stand beside ${types.NpcType.get(npc.type).name}`);
}
function questFixture(stage = 0, tile = [0, 3270, 3158]) {
  const player = playerAt(tile, stage);
  setPlayerVariable(player, 'demonstart', questConstant('demon_complete'));
  setPlayerVariable(player, 'golem_a', questConstant('golem_complete'));
  setPlayerVariable(player, 'golem_clay', 4);
  if (stage > 0) setPlayerVariable(player, 'agrith_badden_uzer', 1);
  if (stage >= 90) setPlayerVariable(player, 'agrith_reen_uzer', 1);
  if (stage >= 100) {
    setPlayerVariable(player, 'agrith_badden_uzer', 2);
    setPlayerVariable(player, 'agrith_reen_uzer', 2);
    setPlayerVariable(player, 'agrith_convinced_dave', 2);
    setPlayerVariable(player, 'agrith_convinced_golem', 1);
  }
  player.baseLevels[PlayerStat.CRAFTING] = 30;
  player.levels[PlayerStat.CRAFTING] = 30;
  const actors = [];
  try {
    if (stage >= 30 && stage < 125) enterQuestRoom(player);
  } catch (error) {
    if (currentInstance(player)) positionPlayer(player, [0, 3270, 3158]);
    cleanupQuestRun(player, actors);
    throw error;
  }
  return { player, actors };
}
function questStage(player) {
  return playerVariable(player, 'agrith_quest');
}
function roomNpcOrNull(player, name) {
  const instance = currentInstance(player);
  if (!instance) return null;
  const type = id('NpcType', name);
  return [...World.npcs].find(candidate => candidate.isActive && candidate.type === type &&
    candidate.getVar(ownerVar) === player.uid &&
    World.instances.findInstanceByCoord({ level: candidate.level, x: candidate.x, z: candidate.z })?.uid === instance.uid) ?? null;
}
function roomNpc(player, name) {
  const npc = roomNpcOrNull(player, name);
  assert(npc, `the native copy contains this account's ${name}`);
  return npc;
}
function roomCoord(player, localX, localZ) {
  const instance = currentInstance(player);
  assert(instance, 'player occupies a native private-room copy');
  return [instance.sw.level, instance.sw.x + localX, instance.sw.z + localZ];
}
function roomLocRow(player, name, localX, localZ) {
  const source = questLocationRows.find(row => row.name === name && row.level === roomSourceLevel &&
    row.x === roomSourceX + localX && row.z === roomSourceZ + localZ);
  assert(source, `original map contains ${name} at source local ${localX},${localZ}`);
  const [level, x, z] = roomCoord(player, localX, localZ);
  return { ...source, level, x, z, coord: coordLabel({ level, x, z }) };
}
function nativeRoomLocRow(player, name, localX, localZ, choices = [], label = `private loc ${name}`, option = 1) {
  return nativeLocRow(player, roomLocRow(player, name, localX, localZ), choices, label, option);
}
function locSignature(zone, level) {
  return Array.from(zone?.getAllLocsSafe() ?? [], loc => {
    assert.equal(loc.level, level, 'native scenery stays on its source or destination plane');
    return [loc.baseType, loc.x & 7, loc.z & 7, loc.baseShape, loc.baseAngle];
  }).sort((left, right) => left.join(',').localeCompare(right.join(',')));
}
function assertRoomCopy(player) {
  const instance = currentInstance(player);
  assert(instance, 'the active quest route created a native region');
  assert.equal(instance.floors, 1);
  assert.equal(instance.zonesEast, 8);
  assert.equal(instance.zonesNorth, 8);
  assert.deepEqual(instance.exitCoord, roomExit, `native exit is ${coordLabel(roomExit)}`);
  assert.equal(coordLabel(instance.exitCoord), '0_42_76_25_49');
  const entityMask = CollisionFlag.NPC_OCC | CollisionFlag.PLAYER_OCC | CollisionFlag.BLOCK_NPC_AND_PLAYERS;
  for (let east = 0; east < 8; east++) for (let north = 0; north < 8; north++) {
    const sourceX = (roomSourceX >> 3) + east;
    const sourceZ = (roomSourceZ >> 3) + north;
    const targetX = instance.sw.x + (east << 3);
    const targetZ = instance.sw.z + (north << 3);
    const source = World.gameMap.getZoneIfExists(sourceX << 3, sourceZ << 3, roomSourceLevel);
    const target = World.gameMap.getZoneIfExists(targetX, targetZ, instance.sw.level);
    assert(target instanceof InstanceZone, `copied destination zone ${east},${north} is native`);
    assert(target.hasAssignedTemplate, `copied destination zone ${east},${north} has a source template`);
    assert.equal(target.rotation, 0, `source zone ${east},${north} is unrotated`);
    assert.deepEqual(target.source, { level: roomSourceLevel, x: sourceX, z: sourceZ },
      `destination zone ${east},${north} maps to the corresponding original source`);
    assert.deepEqual(locSignature(target, instance.sw.level), locSignature(source, roomSourceLevel),
      `destination zone ${east},${north} copies original scenery`);
    const sourceFlags = routefinder.default.collisionFlags.getZone(sourceX << 3, sourceZ << 3, roomSourceLevel);
    const targetFlags = routefinder.default.collisionFlags.getZone(targetX, targetZ, instance.sw.level);
    assert(targetFlags, `destination zone ${east},${north} has native collision storage`);
    for (let tile = 0; tile < 64; tile++) {
      const expected = ((sourceFlags?.[tile] ?? 0) & ~entityMask) >>> 0;
      const actual = (targetFlags[tile] & ~entityMask) >>> 0;
      assert.equal(actual, expected, `destination collision zone ${east},${north} tile ${tile} matches its source`);
    }
  }
  const portal = roomLocRow(player, 'golem_demon_portal', 31, 19);
  assert(World.getLoc(portal.x, portal.z, portal.level, id('LocType', 'golem_demon_portal')),
    'native copy contains the original exit scenery identity');
  return instance;
}
function enterQuestRoom(player, label = 'active quest native portal entry') {
  assert(questStage(player) >= 30 && questStage(player) < 125, 'quest stage is eligible for the private copy');
  assert.equal(currentInstance(player), null, 'native entry begins outside an existing copy');
  const portal = nativeLocRows('golem_portal').find(row => row.level === 0);
  assert(portal, 'the original surface Golem portal exists');
  nativeLocRow(player, portal, [], label);
  assert.deepEqual([player.level, player.x, player.z], roomCoord(player, 32, 20),
    'native portal enters source-local tile 32,20');
  assertRoomCopy(player);
  assertRoomActorCast(player, questStage(player));
  return currentInstance(player);
}
function exitPrivateRoom(player, label = 'native copied-scene exit') {
  const instance = currentInstance(player);
  if (!instance) return;
  const uid = instance.uid;
  const sw = { ...instance.sw };
  assert.deepEqual(instance.exitCoord, roomExit, `${label} retains the native exit coordinate`);
  const saveCoord = World.instances.getSaveCoord(
    { level: player.level, x: player.x, z: player.z },
    player.previousOverworldCoord
  );
  assert.deepEqual(saveCoord, roomExit, `${label} resolves the same persisted native exit`);
  nativeRoomLocRow(player, 'golem_demon_portal', 31, 19, [], label, 1);
  assert.deepEqual([player.level, player.x, player.z], [roomExit.level, roomExit.x, roomExit.z],
    `${label} lands at ${coordLabel(roomExit)}`);
  assert.equal(World.instances.findInstanceByUid(uid), null, `${label} deletes its empty native instance`);
  assert(!World.instances.instances.some(candidate => candidate.uid === uid), `${label} removes its instance record`);
  for (let east = 0; east < 8; east++) for (let north = 0; north < 8; north++) {
    const x = sw.x + (east << 3), z = sw.z + (north << 3);
    assert.equal(World.gameMap.getZoneIfExists(x, z, sw.level), null, `${label} removes copied zone ${east},${north}`);
    assert.equal(routefinder.isZoneAllocated(x, z, sw.level), false, `${label} releases collision zone ${east},${north}`);
  }
}
function roomActorCast(player) {
  const instance = currentInstance(player);
  assert(instance, 'room actor cast belongs to a current native instance');
  return [...World.npcs]
    .filter(npc => npc.isActive && roomActorTypes.has(npc.type) && npc.getVar(ownerVar) === player.uid &&
      World.instances.findInstanceByCoord({ level: npc.level, x: npc.x, z: npc.z })?.uid === instance.uid)
    .map(npc => [npc.type, npc.x - instance.sw.x, npc.z - instance.sw.z])
    .sort((left, right) => left[0] - right[0]);
}
function assertRoomActorCast(player, stage) {
  const names = stage < 80 ? originalCultNames :
    stage < 100 ? ['agrith_matthew'] :
      stage < 120 ? ['agrith_matthew', ...helperNames] : helperNames;
  const spots = { ...originalCultSpots, ...helperSpots };
  const expected = names.map(name => [id('NpcType', name), ...spots[name]]).sort((left, right) => left[0] - right[0]);
  assert.deepEqual(roomActorCast(player), expected, `native stage ${stage} actor cast is exact and account-owned`);
  assert.equal(roomNpcOrNull(player, 'agrith_matthew') !== null, stage < 120,
    `native stage ${stage} has Matthew only before stage 120`);
}
function roomObjects(player, name) {
  const instance = currentInstance(player);
  assert(instance, 'room objects belong to a current native instance');
  const type = itemId(name);
  const result = [];
  for (let east = 0; east < 8; east++) for (let north = 0; north < 8; north++) {
    const zone = World.gameMap.getZoneIfExists(instance.sw.x + (east << 3), instance.sw.z + (north << 3), instance.sw.level);
    for (const obj of zone?.getAllObjsUnsafe(true) ?? []) {
      if (obj.isActive && obj.type === type && obj.receiver64 === player.hash64) result.push(obj);
    }
  }
  return result;
}
function sharedSigils() {
  const type = itemId('agrith_sigil');
  const result = [];
  for (let east = 0; east < 8; east++) for (let north = 0; north < 8; north++) {
    const zone = World.gameMap.getZoneIfExists(roomSourceX + (east << 3), roomSourceZ + (north << 3), roomSourceLevel);
    for (const obj of zone?.getAllObjsUnsafe(true) ?? []) {
      if (obj.isActive && obj.type === type) result.push(obj);
    }
  }
  return result;
}
function assertNoSharedSigils() {
  assert.equal(sharedSigils().length, 0, 'shared source map contains no sigil ground objects');
}
function assertFirstChantOutcome(player) {
  assert.equal(questStage(player), 80, 'first correct chant advances to stage 80');
  for (const name of originalCultNames.filter(name => name !== 'agrith_matthew')) {
    assert.equal(roomNpcOrNull(player, name), null, `first chant removes private ${name}`);
  }
  assertRoomActorCast(player, 80);
  const instance = currentInstance(player);
  const sigils = roomObjects(player, 'agrith_sigil').map(obj => [
    obj.x - instance.sw.x, obj.z - instance.sw.z, obj.count, obj.receiver64
  ]).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  assert.deepEqual(sigils, [[32, 42, 1, player.hash64], [35, 37, 1, player.hash64]],
    'first chant drops two actual receiver-bound sigils at the authored private tiles');
  assertNoSharedSigils();
}
function assertNoSharedCultists() {
  for (const name of originalCultNames) {
    assert.equal(nativeNpcRows(name).length, 0, `original map has no shared ${name} row`);
  }
  const shared = [...World.npcs].filter(npc => npc.isActive && roomActorTypes.has(npc.type) &&
    npc.level === roomSourceLevel && npc.x >= roomSourceX && npc.x < roomSourceX + 64 &&
    npc.z >= roomSourceZ && npc.z < roomSourceZ + 64);
  assert.deepEqual(shared.map(npc => types.NpcType.get(npc.type).name), [],
    'loaded source plane has no unowned or shared cult actors');
}
function roomWords(player) {
  return Array.from({ length: 5 }, (_, i) => playerVariable(player, `agrith_incantation_${i + 1}`));
}
function setWords(player) {
  for (let i = 1; i <= 5; i++) setPlayerVariable(player, `agrith_incantation_${i}`, i);
}
function rowAt(tile) {
  const row = questLocationRows.find(candidate => candidate.level === tile[0] && candidate.x === tile[1] && candidate.z === tile[2]);
  assert(row, `the original pack contains the location at ${tile.join(',')}`);
  return row;
}
function openLanding(player, expected, label) {
  const tile = [player.level, player.x, player.z];
  assert.deepEqual(tile, expected, `${label} uses the original landing`);
  packedTileWalkable(tile, label);
  assert(pathOut(tile, { x: -100, z: -100, size: 1 }).length > 0, `${label} has a nonempty packed-map path out`);
}
function castSigil(player) {
  const furnace = nativeLocRows('furnace').find(row => row.level === 0);
  assert(furnace, 'an original ordinary furnace exists');
  nativeUseLoc(player, furnace, 'silver_bar', 'silver bar on an original furnace');
  assert.equal(types.Component.get(player.modalMain)?.comName, 'silver_casting', 'the real furnace opens silver casting');
  const button = id('Component', 'silver_casting:com_135');
  assert(buttonHandler.handle(new IfButton(button), player), 'the native demonic-sigil casting button is accepted');
  finishInteraction(player, [], 'native sigil casting');
}
function unrelatedNativeCopy(player) {
  positionPlayer(player, [0, 3270, 3158]);
  const sourceX = Math.floor(player.x / 64) * 64;
  const sourceZ = Math.floor(player.z / 64) * 64;
  const sw = World.instances.createInstance(1, 8, 8);
  const instance = World.instances.findInstanceByCoord(sw);
  assert(instance, 'the native engine allocates an unrelated test copy');
  for (let east = 0; east < 8; east++) for (let north = 0; north < 8; north++) {
    World.instances.copyZone(sw, { level: 0, x: east, z: north }, {
      level: 0, x: sourceX + (east << 3), z: sourceZ + (north << 3)
    }, 0);
  }
  positionPlayer(player, [sw.level, sw.x + 32, sw.z + 31]);
  assert.equal(World.getLoc(sw.x + 31, sw.z + 19, sw.level, id('LocType', 'golem_demon_portal')), null,
    'unrelated native copy does not contain the copied Uzer exit scenery');
  return instance;
}
function assertUnrelatedRoomRejectsRitual(player, stage = questStage(player)) {
  const instance = unrelatedNativeCopy(player);
  addItem(player, 'agrith_sigil');
  holdItem(player, 'agrith_sigil', 1, [], `sigil rejects unrelated native copy at stage ${stage}`);
  assert.equal(questStage(player), stage, `unrelated copy cannot advance stage ${stage}`);
  assert.equal(itemCount(player, 'agrith_sigil'), 1, 'unrelated copy does not consume the sigil');
  assert.equal(player.messages.at(-1), 'You must chant in the throne room.',
    'compiled ritual refuses the wrong native scenery identity');
  assert.equal(roomNpcOrNull(player, 'agrith_naar'), null, 'unrelated copy cannot activate Agrith-Naar');
  assert.equal(roomObjects(player, 'agrith_sigil').length, 0, 'unrelated copy creates no private ritual drop');
  positionPlayer(player, [0, 3270, 3158]);
  assert.equal(World.instances.findInstanceByUid(instance.uid), null, 'test leaves and reclaims the unrelated native copy');
}
function summonNativeBoss(player, label = 'native reverse chant') {
  assert.equal(questStage(player), 110, `${label} begins at the final ritual stage`);
  assertRoomActorCast(player, 110);
  if (roomWords(player).some(word => word < 1 || word > 5)) setWords(player);
  if (itemCount(player, 'agrith_sigil') === 0) addItem(player, 'agrith_sigil');
  positionPlayer(player, roomCoord(player, 32, 31));
  const matthew = roomNpc(player, 'agrith_matthew');
  const humanDeath = id('SeqType', 'human_death');
  const events = [];
  const originalPlayAnimation = matthew.playAnimation;
  const originalRemoveNpc = World.removeNpc;
  const originalAddNpc = World.addNpc;
  matthew.playAnimation = function(sequence, ...args) {
    if (sequence === humanDeath) events.push('human_death');
    return originalPlayAnimation.call(this, sequence, ...args);
  };
  World.removeNpc = function(npc, ...args) {
    if (npc === matthew) events.push('matthew-delete');
    return originalRemoveNpc.call(this, npc, ...args);
  };
  const instanceUid = currentInstance(player).uid;
  World.addNpc = function(npc, ...args) {
    if (npc.type === bossType.id && npc.level === 0 &&
        World.instances.findInstanceByCoord({ level: npc.level, x: npc.x, z: npc.z })?.uid === instanceUid) {
      events.push({ kind: 'boss-add', matthewActive: matthew.isActive, x: npc.x, z: npc.z });
    }
    return originalAddNpc.call(this, npc, ...args);
  };
  try {
    holdItem(player, 'agrith_sigil', 1, roomWords(player).reverse(), label);
  } finally {
    matthew.playAnimation = originalPlayAnimation;
    World.removeNpc = originalRemoveNpc;
    World.addNpc = originalAddNpc;
  }
  const boss = roomNpc(player, 'agrith_naar');
  const instance = currentInstance(player);
  assert.deepEqual(events, [
    'human_death',
    'matthew-delete',
    { kind: 'boss-add', matthewActive: false, x: instance.sw.x + bossLocal[0], z: instance.sw.z + bossLocal[1] }
  ], `${label} plays Matthew's native death animation, deletes him, then activates the boss`);
  assert.equal(matthew.isActive, false, `${label} leaves Matthew deleted`);
  assert.deepEqual([boss.x - instance.sw.x, boss.z - instance.sw.z], bossLocal,
    `${label} spawns the boss at its source-local tile`);
  return boss;
}
function npcDialogueCapture(player) {
  let cursor = player.packets.length;
  let latestRoot = null;
  let latestTitle = null;
  let latestPortrait = null;
  const frames = [];
  return {
    frames,
    observe(currentPlayer) {
      assert.equal(currentPlayer, player);
      const packets = player.packets.slice(cursor);
      cursor = player.packets.length;
      const root = player.modalChat >= 0 ? types.Component.get(player.modalChat)?.comName ?? '' : '';
      if (!root.startsWith('npcchat')) return;
      if (root !== latestRoot) {
        latestRoot = root;
        latestTitle = null;
        latestPortrait = null;
      }
      const titleComponent = id('Component', `${root}:com_1`);
      const portraitComponent = id('Component', `${root}:com_0`);
      const titlePacket = packets.filter(packet => packet instanceof IfSetText && packet.component === titleComponent).at(-1);
      const portraitPacket = packets.filter(packet => packet instanceof IfSetNpcHead && packet.component === portraitComponent).at(-1);
      if (titlePacket) latestTitle = titlePacket.text;
      if (portraitPacket) latestPortrait = portraitPacket.npc;
      const lines = packets.filter(packet => packet instanceof IfSetText && packet.component !== titleComponent)
        .map(packet => packet.text);
      frames.push({ root, title: latestTitle, portrait: latestPortrait, lines });
    }
  };
}
function assertRecruitmentLine(capture, line, title, portraitName) {
  const frame = capture.frames.find(candidate => candidate.lines.some(text => text.includes(line)));
  assert(frame, `captured final recruitment line ${line}`);
  assert.notEqual(frame.title, null, `final recruitment line ${line} has a speaker title`);
  assert.notEqual(frame.title, 'null', `final recruitment line ${line} does not render literal null`);
  assert.equal(frame.title, title, `final recruitment line ${line} uses the intended speaker name`);
  assert.equal(frame.portrait, id('NpcType', portraitName),
    `final recruitment line ${line} uses the intended native portrait`);
}

check('Reen requires both completed prerequisite quests and base level 30 Crafting', () => {
  assert(nativeNpcRows('agrith_reen_alkharid').length > 0, 'the original Al Kharid Reen placement exists');
  for (const missing of ['demonstart', 'golem_a', 'crafting']) {
    const { player, actors } = questFixture();
    try {
      if (missing === 'crafting') {
        player.baseLevels[PlayerStat.CRAFTING] = 29;
        player.levels[PlayerStat.CRAFTING] = 99;
      } else setPlayerVariable(player, missing, 0);
      nativeNpc(player, spawnActor(player, 'agrith_reen_alkharid', actors), [], `Reen rejects missing ${missing}`);
      assert.equal(questStage(player), 0);
      assert.equal(itemCount(player, 'silverlight'), 0);
    } finally { cleanupQuestRun(player, actors); }
  }
  const { player, actors } = questFixture();
  try {
    player.levels[PlayerStat.CRAFTING] = 29;
    const reen = spawnActor(player, 'agrith_reen_alkharid', actors);
    nativeNpc(player, reen, [2], 'decline Reen');
    assert.equal(questStage(player), 0);
    nativeNpc(player, reen, [1], 'accept Reen with base Crafting 30');
    assert.equal(questStage(player), 10);
    assert.equal(playerVariable(player, 'agrith_badden_uzer'), 1);
    assert.equal(itemCount(player, 'silverlight'), 1);
  } finally { cleanupQuestRun(player, actors); }
});

check('Badden starts the infiltration; actual dye and worn three-piece disguise gate Dave', () => {
  const { player, actors } = questFixture(10, [0, 3482, 3090]);
  try {
    const badden = spawnActor(player, 'agrith_badden_uzer', actors);
    nativeNpc(player, badden, [2], 'decline Badden');
    assert.equal(questStage(player), 10);
    nativeNpc(player, badden, [1], 'accept Badden');
    assert.equal(questStage(player), 20);
    assert.equal(itemCount(player, 'silverlight'), 1, 'the monk recovers the missing sword');
    removeItem(player, 'silverlight');
    nativeNpc(player, badden, [], 'recover a lost quest sword');
    assert.equal(itemCount(player, 'silverlight'), 1);
    addItem(player, 'golem_mushroom');
    useItem(player, 'silverlight', 'golem_mushroom');
    assert.equal(itemCount(player, 'silverlight'), 0);
    assert.equal(itemCount(player, 'golem_mushroom'), 0);
    assert.equal(itemCount(player, 'agrith_silverlight_dyed'), 1);
    const dave = spawnActor(player, 'agrith_dave_at_portal', actors);
    nativeNpc(player, dave, [1], 'Dave rejects carried, unwielded dyed Silverlight');
    assert.equal(questStage(player), 20);
    wearItem(player, 'agrith_silverlight_dyed');
    for (const clothing of ['black_cape', 'black_full_helm']) {
      nativeNpc(player, dave, [1], 'Dave rejects fewer than three worn black pieces');
      assert.equal(questStage(player), 20);
      addItem(player, clothing);
      wearItem(player, clothing);
    }
    nativeNpc(player, dave, [1], 'Dave accepts dyed sword plus two black clothes');
    assert.equal(questStage(player), 30);
    const before = itemCount(player, 'agrith_silverlight_dyed', wornId);
    nativeNpc(player, badden, [], 'a worn sword prevents a replacement duplicate');
    assert.equal(itemCount(player, 'silverlight'), 0);
    assert.equal(itemCount(player, 'agrith_silverlight_dyed', wornId), before);
  } finally { cleanupQuestRun(player, actors); }
});

check('mushroom ink and desert-clothing dye preserve the Golem ink and pen routes', () => {
  const { player, actors } = questFixture(20);
  try {
    for (const item of ['golem_mushroom', 'vial_empty', 'pestle_and_mortar']) addItem(player, item);
    useItem(player, 'golem_mushroom', 'pestle_and_mortar');
    assert.equal(itemCount(player, 'golem_ink'), 1);
    assert.equal(itemCount(player, 'vial_empty'), 0);
    addItem(player, 'desert_shirt');
    useItem(player, 'desert_shirt', 'golem_ink');
    assert.equal(itemCount(player, 'agrith_desert_shirt_dyed'), 1);
    assert.equal(itemCount(player, 'golem_ink'), 0);
    assert.equal(itemCount(player, 'vial_empty'), 1);
    addItem(player, 'golem_ink');
    addItem(player, 'desert_robe');
    useItem(player, 'desert_robe', 'golem_ink');
    assert.equal(itemCount(player, 'agrith_desert_robe_dyed'), 1);
    addItem(player, 'golem_ink');
    addItem(player, 'silverlight');
    useItem(player, 'silverlight', 'golem_ink');
    assert.equal(itemCount(player, 'agrith_silverlight_dyed'), 1);
    addItem(player, 'golem_ink');
    addItem(player, 'golem_phoenixfeather');
    useItem(player, 'golem_phoenixfeather', 'golem_ink');
    assert.equal(itemCount(player, 'golem_pen'), 1, 'the original Golem pen still works');
    assert.equal(questStage(player), 20);
  } finally { cleanupQuestRun(player, actors); }
});

check('original stairs and portals retain open landings while active quest players enter a native copy', () => {
  const { player, actors } = questFixture();
  try {
    nativeLocRow(player, rowAt([0, 3492, 3090]), [], 'original stairs down');
    openLanding(player, [0, 2721, 4886], 'stairs down');
    nativeLocRow(player, rowAt([0, 2721, 4884]), [], 'original stairs up');
    openLanding(player, [0, 3491, 3090], 'stairs up');
    setPlayerVariable(player, 'golem_a', questConstant('golem_doors_open'));
    const portal = rowAt([0, 2720, 4912]);
    nativeLocRow(player, portal, [], 'original Golem portal');
    openLanding(player, [2, 2720, 4884], 'Golem portal');
    assert.equal(playerVariable(player, 'golem_a'), questConstant('golem_entered_portal'));
    nativeLocRow(player, rowAt([2, 2719, 4883]), [], 'original return portal');
    openLanding(player, [0, 2713, 4913], 'return portal');

    setPlayerVariable(player, 'golem_a', questConstant('golem_complete'));
    setPlayerVariable(player, 'agrith_quest', 10);
    nativeLocRow(player, portal, [], 'Dave blocks premature entry');
    assert.equal(player.level, 0);
    assert.equal(currentInstance(player), null);

    setPlayerVariable(player, 'agrith_quest', 125);
    nativeLocRow(player, portal, [], 'completed Golem account keeps the shared landing');
    openLanding(player, [2, 2720, 4884], 'completed Golem portal');
    assert.equal(currentInstance(player), null, 'completed account does not create an Agrith copy');
    assertNoSharedCultists();
    nativeLocRow(player, rowAt([2, 2719, 4883]), [], 'leave the completed shared landing');
    setPlayerVariable(player, 'agrith_quest', 30);
    enterQuestRoom(player);
    assertRoomActorCast(player, 30);
    assertNoSharedCultists();
    exitPrivateRoom(player, 'active quest native exit');
    assert.equal(questStage(player), 30);
  } finally { cleanupQuestRun(player, actors); }
});

const kilnTiles = [[0, 3467, 3123], [0, 3478, 3082], [0, 3472, 3092], [0, 3500, 3084]];
check('all four original kilns bind the chosen ordinal, reject wrong kilns and recover a lost tome', () => {
  for (let ordinal = 0; ordinal < kilnTiles.length; ordinal++) {
    const { player, actors } = questFixture(60);
    try {
      setPlayerVariable(player, 'agrith_kiln', ordinal);
      exitPrivateRoom(player, 'leave private chamber for kiln recovery');
      nativeLocRow(player, rowAt(kilnTiles[(ordinal + 1) % 4]), [], 'wrong kiln');
      assert.equal(itemCount(player, 'agrith_book'), 0);
      nativeLocRow(player, rowAt(kilnTiles[ordinal]), [], 'correct kiln');
      assert.equal(itemCount(player, 'agrith_book'), 1);
      nativeLocRow(player, rowAt(kilnTiles[ordinal]), [], 'no duplicate tome');
      assert.equal(itemCount(player, 'agrith_book'), 1);
      removeItem(player, 'agrith_book');
      nativeLocRow(player, rowAt(kilnTiles[ordinal]), [], 'recover lost tome');
      assert.equal(itemCount(player, 'agrith_book'), 1);
      removeItem(player, 'agrith_book');
      addItem(player, 'agrith_book', 1, bankId);
      nativeLocRow(player, rowAt(kilnTiles[ordinal]), [], 'banked tome prevents duplicates');
      assert.equal(itemCount(player, 'agrith_book'), 0);
      assert.equal(questStage(player), 60);
    } finally { cleanupQuestRun(player, actors); }
  }
});


check('cult dialogue, native casting, both chants, recruitment and real death queue complete the quest', () => {
  const { player, actors } = questFixture(30);
  try {
    addItem(player, 'agrith_silverlight_dyed');
    wearItem(player, 'agrith_silverlight_dyed');
    nativeNpc(player, roomNpc(player, 'agrith_denath'), [], 'Denath teaches the incantation');
    assert.equal(questStage(player), 40);
    const words = roomWords(player);
    assert.deepEqual([...words].sort(), [1, 2, 3, 4, 5], 'Denath teaches a complete permutation');
    nativeNpc(player, roomNpc(player, 'agrith_denath'), [], 'Denath repeats the same incantation');
    assert.deepEqual(roomWords(player), words);
    nativeNpc(player, roomNpc(player, 'agrith_jennifer'), [], 'Jennifer supplies the mould');
    assert.equal(itemCount(player, 'agrith_sigil_mould'), 1);
    removeItem(player, 'agrith_sigil_mould');
    nativeNpc(player, roomNpc(player, 'agrith_jennifer'), [], 'Jennifer recovers a lost mould');
    assert.equal(itemCount(player, 'agrith_sigil_mould'), 1);
    nativeNpc(player, roomNpc(player, 'agrith_matthew'), [], 'Matthew sends the player to the golem');
    assert.equal(questStage(player), 50);

    exitPrivateRoom(player, 'leave for the original golem');
    const golem = spawnActor(player, 'golem_golem', actors, [0, 3481, 3097]);
    nativeNpc(player, golem, [], 'the original golem selects a kiln');
    assert.equal(questStage(player), 60);
    const chosen = playerVariable(player, 'agrith_kiln');
    assert(chosen >= 0 && chosen < 4);
    nativeLocRow(player, rowAt(kilnTiles[chosen]), [], 'retrieve the period kiln book');
    assert.equal(itemCount(player, 'agrith_book'), 1);

    enterQuestRoom(player);
    nativeNpc(player, roomNpc(player, 'agrith_matthew'), [], 'book without sigil is rejected');
    assert.equal(questStage(player), 60);
    exitPrivateRoom(player, 'leave to cast the sigil');
    addItem(player, 'silver_bar');
    const craftingBefore = player.stats[PlayerStat.CRAFTING];
    castSigil(player);
    assert.equal(itemCount(player, 'silver_bar'), 0);
    assert.equal(itemCount(player, 'agrith_sigil_mould'), 1);
    assert.equal(itemCount(player, 'agrith_sigil'), 1);
    assert.equal(player.stats[PlayerStat.CRAFTING] - craftingBefore, 500, 'casting uses native tenths of XP');

    enterQuestRoom(player);
    holdItem(player, 'agrith_book', 1, [], 'read the reversed tome');
    nativeNpc(player, roomNpc(player, 'agrith_matthew'), [], 'Matthew accepts book and sigil');
    assert.equal(questStage(player), 70);
    assertRoomActorCast(player, 70);
    const wrong = words.map(word => word % 5 + 1);
    positionPlayer(player, roomCoord(player, 32, 31));
    holdItem(player, 'agrith_sigil', 1, wrong, 'wrong first chant');
    assert.equal(questStage(player), 70);
    holdItem(player, 'agrith_sigil', 1, words, 'correct forward chant');
    assertFirstChantOutcome(player);
    assert.equal(playerVariable(player, 'agrith_convinced_dave'), 1);

    exitPrivateRoom(player, 'leave for Dave and the recruits');
    const dave = spawnActor(player, 'agrith_dave', actors, [0, 2721, 4910]);
    const daveDialogue = npcDialogueCapture(player);
    nativeNpc(player, dave, [1], 'real Tanya scene and Dave recruitment', null, daveDialogue.observe);
    assert.equal(questStage(player), 90);
    assert.equal(playerVariable(player, 'agrith_convinced_dave'), 2);
    assertRecruitmentLine(daveDialogue, "All right. I'll go back.", 'Evil Dave', 'agrith_dave');

    const reenDialogue = npcDialogueCapture(player);
    const reen = spawnActor(player, 'agrith_reen_uzer', actors, [0, 3483, 3090]);
    nativeNpc(player, reen, [1], 'recruit Reen', null, reenDialogue.observe);
    assertRecruitmentLine(reenDialogue, 'I will meet you in the throne room.', 'Father Reen', 'agrith_reen');
    const baddenDialogue = npcDialogueCapture(player);
    const badden = spawnActor(player, 'agrith_badden_uzer', actors, [0, 3484, 3090]);
    nativeNpc(player, badden, [1], 'recruit Badden', null, baddenDialogue.observe);
    assertRecruitmentLine(baddenDialogue, 'I will meet you in the throne room.', 'Father Badden', 'agrith_badden');
    assert.equal(playerVariable(player, 'agrith_reen_uzer'), 2);
    assert.equal(playerVariable(player, 'agrith_badden_uzer'), 2);
    addItem(player, 'golem_golemkey');
    nativeUseNpc(player, golem, 'golem_golemkey', 'recruit the golem with its original key');
    assert.equal(playerVariable(player, 'agrith_convinced_golem'), 1);
    removeItem(player, 'agrith_sigil');

    enterQuestRoom(player);
    nativeNpc(player, roomNpc(player, 'agrith_matthew'), [], 'recover lost sigils and distribute them to recruits');
    assert.equal(questStage(player), 100);
    assert.equal(itemCount(player, 'agrith_sigil'), 1, 'three recovered sigils are given to the recruits');
    assertRoomActorCast(player, 100);
    nativeNpc(player, roomNpc(player, 'agrith_matthew'), [2], 'not ready for the final ritual');
    assert.equal(questStage(player), 100);
    nativeNpc(player, roomNpc(player, 'agrith_matthew'), [1], 'ready for the final ritual');
    assert.equal(questStage(player), 110);
    assertRoomActorCast(player, 110);
    positionPlayer(player, roomCoord(player, 32, 31));
    holdItem(player, 'agrith_sigil', 1, wrong, 'wrong second chant');
    assert.equal(roomNpcOrNull(player, 'agrith_naar'), null, 'wrong second chant does not activate Agrith-Naar');
    const boss = summonNativeBoss(player, 'correct reverse chant');
    approachNpc(player, boss);
    boss.levels[NpcStat.HITPOINTS] = 12;
    const xpBefore = player.stats[PlayerStat.ATTACK];
    const qpBefore = questPoints(player);
    runNpcQueue(boss, ServerTriggerType.AI_QUEUE2, 12);
    assert.equal(boss.levels[NpcStat.HITPOINTS], 0);
    assert.equal(boss.isActive, false, 'the lethal hit automatically completes the native death queue');
    assert([...player.queue.all()].some(request => request.script?.name === '[queue,agrith_defeated]'), 'native death enqueues the owner reward');
    settlePlayerQueue(player, [1], 'native defeat and Attack reward');
    assert.equal(questStage(player), 125);
    assert.equal(player.stats[PlayerStat.ATTACK] - xpBefore, 100000);
    assert.equal(questPoints(player) - qpBefore, 1);
    assert.equal(itemCount(player, 'darklight', wornId), 1);
    assert.equal(types.Component.get(player.modalMain)?.comName, 'questscroll_death', 'the real completion scroll is open');
  } finally { cleanupQuestRun(player, actors); }
});

check('each missing recruit blocks Matthew even though lost sigils remain recoverable', () => {
  const flags = [['agrith_convinced_dave', 2], ['agrith_reen_uzer', 2], ['agrith_badden_uzer', 2], ['agrith_convinced_golem', 1]];
  for (const [missing] of flags) {
    const { player, actors } = questFixture(90);
    try {
      for (const [name, value] of flags) setPlayerVariable(player, name, name === missing ? 0 : value);
      nativeNpc(player, roomNpc(player, 'agrith_matthew'), [], `Matthew rejects missing ${missing}`);
      assert.equal(questStage(player), 90);
      assert.equal(itemCount(player, 'agrith_sigil'), 4, 'lost ritual sigils are recoverable without bypassing recruitment');
    } finally { cleanupQuestRun(player, actors); }
  }
});
check('lost mould and sigil remain craftable when the player is inside and outside the cult stages', () => {
  for (const stage of [40, 70, 100, 110]) {
    const { player, actors } = questFixture(stage);
    try {
      if (stage < 80) {
        const jennifer = roomNpc(player, 'agrith_jennifer');
        if (stage === 40) nativeNpc(player, jennifer, [], 'acquire Jennifer mould before losing it');
        else addItem(player, 'agrith_sigil_mould');
        removeItem(player, 'agrith_sigil_mould');
        nativeNpc(player, jennifer, [], `Jennifer recovers mould at ${stage}`);
      } else {
        assert.equal(roomNpcOrNull(player, 'agrith_jennifer'), null, `stage ${stage} leaves Jennifer absent`);
        addItem(player, 'agrith_sigil_mould');
      }
      exitPrivateRoom(player, `leave stage ${stage} copy for sigil casting`);
      addItem(player, 'silver_bar');
      castSigil(player);
      assert.equal(itemCount(player, 'agrith_sigil'), 1, `lost sigil can be remade at stage ${stage}`);
      assert.equal(questStage(player), stage);
    } finally { cleanupQuestRun(player, actors); }
  }
});
check('boss ownership, duplicate prevention, native departure and death leave a repeatable reverse ritual', () => {
  const first = questFixture(110);
  const outsider = questFixture(110);
  try {
    const player = first.player;
    let boss = summonNativeBoss(player, 'first owned reverse ritual');
    const instance = currentInstance(player);
    const outsiderInstance = currentInstance(outsider.player);
    assert.notEqual(instance.uid, outsiderInstance.uid, 'each account receives a distinct native copy');
    assert.equal(boss.getVar(ownerVar), player.uid, 'the compiled boss is owned by the summoning account');
    if (itemCount(player, 'agrith_sigil') === 0) addItem(player, 'agrith_sigil');
    holdItem(player, 'agrith_sigil', 1, [], 'a second sigil operation cannot duplicate the boss');
    assert.equal([...World.npcs].filter(npc => npc.isActive && npc.type === bossType.id &&
      npc.getVar(ownerVar) === player.uid &&
      World.instances.findInstanceByCoord({ level: npc.level, x: npc.x, z: npc.z })?.uid === instance.uid).length, 1);
    assert.equal(rsbuf.hasNpc(outsider.player.slot, boss.nid), false,
      'the other native copy does not expose the private boss in its client scene');

    exitPrivateRoom(player, 'owner leaves the boss instance through its native exit');
    assert.equal(boss.isActive, false, 'empty instance deletion removes its boss');
    assert.equal(questStage(player), 110, 'native departure preserves the final ritual stage');
    enterQuestRoom(player, 'owner re-enters for the retry proof');
    boss = summonNativeBoss(player, 'retry after native departure');
    const timer = ScriptProvider.getByTrigger(ServerTriggerType.AI_TIMER, boss.type, bossType.category);
    assert(timer, 'the packed boss timer exists');
    player.levels[PlayerStat.HITPOINTS] = 0;
    let state = ScriptRunner.init(timer, boss);
    boss.executeScript(state);
    assert.equal(state.execution, ScriptState.FINISHED);
    assert.equal(boss.isActive, false, 'owner death cleans the native encounter');
    player.levels[PlayerStat.HITPOINTS] = 99;
    exitPrivateRoom(player, 'owner leaves after death before the reverse-ritual retry');
    enterQuestRoom(player, 'owner re-enters after death');
    boss = summonNativeBoss(player, 'retry after owner death');
    assert.equal(roomNpc(player, 'agrith_naar'), boss);
    assert.equal(questStage(player), 110);
  } finally {
    cleanupQuestRun(outsider.player, outsider.actors);
    cleanupQuestRun(first.player, first.actors);
  }
});
check('all six combat rewards grant exactly 100000 tenths, one QP, Darklight and one completion scroll', () => {
  const rewards = [
    [PlayerStat.ATTACK, [1]], [PlayerStat.STRENGTH, [2]], [PlayerStat.DEFENCE, [3]],
    [PlayerStat.RANGED, [4]], [PlayerStat.MAGIC, [5, 1]], [PlayerStat.HITPOINTS, [5, 2]]
  ];
  for (const [skill, choices] of rewards) {
    const { player, actors } = questFixture(120);
    try {
      assertRoomActorCast(player, 120);
      addItem(player, 'silverlight');
      wearItem(player, 'silverlight');
      const xpBefore = [...player.stats];
      const qpBefore = questPoints(player);
      const replayMonkSlot = roomNpc(player, 'agrith_badden_sigil').nid;
      nativeNpc(player, roomNpc(player, 'agrith_reen_sigil'), choices, `completion skill ${skill}`);
      assert.equal(questStage(player), 125);
      for (let i = 0; i < xpBefore.length; i++) assert.equal(player.stats[i] - xpBefore[i], i === skill ? 100000 : 0);
      assert.equal(questPoints(player) - qpBefore, 1);
      assert.equal(itemCount(player, 'darklight', wornId), 1);
      assert.equal(itemCount(player, 'silverlight', wornId), 0);
      assert.equal(types.Component.get(player.modalMain)?.comName, 'questscroll_death');
      const xpAfter = [...player.stats];
      assert.deepEqual(roomActorCast(player), [], 'completion removes the actual private helper cast');
      assert.equal(World.getNpc(replayMonkSlot), undefined, 'completion removes the other monk from native NPC lookup');
      player.closeModal();
      assert.equal(npcHandler.handle(new OpNpc(1, replayMonkSlot), player), false,
        'a stale native Talk-to packet cannot replay completion through the removed monk');
      runPlayerScript(player, '[proc,agrith_reward]');
      assert.equal(questStage(player), 125, 're-entering the compiled reward procedure cannot recommit completion');
      assert.deepEqual([...player.stats], xpAfter);
      assert.equal(questPoints(player) - qpBefore, 1);
      assert.equal(itemCount(player, 'darklight', wornId), 1);
      assert.notEqual(types.Component.get(player.modalMain)?.comName, 'questscroll_death', 'the completion scroll is not replayed');
    } finally { cleanupQuestRun(player, actors); }
  }
});
check('a full inventory cannot lose the reward, and an equipped sword can transform without a free slot', () => {
  for (const worn of [false, true]) {
    const { player, actors } = questFixture(120);
    try {
      assertRoomActorCast(player, 120);
      if (worn) {
        addItem(player, 'agrith_silverlight_dyed');
        wearItem(player, 'agrith_silverlight_dyed');
      }
      addItem(player, 'bronze_dagger', 28);
      const monk = roomNpc(player, 'agrith_reen_sigil');
      nativeNpc(player, monk, worn ? [1] : [], 'full-inventory completion');
      if (!worn) {
        assert.equal(questStage(player), 120);
        assert.equal(itemCount(player, 'darklight'), 0);
        player.invDel(invId, itemId('bronze_dagger'), 1);
        nativeNpc(player, monk, [1], 'resume completion after making one space');
        assert.equal(itemCount(player, 'darklight'), 1);
      } else assert.equal(itemCount(player, 'darklight', wornId), 1);
      assert.equal(questStage(player), 125);
    } finally { cleanupQuestRun(player, actors); }
  }
});


check('Prysin keeps Demon Slayer recovery and hard-clue priority, then charges exactly 1000 for Darklight', () => {
  const { player, actors } = questFixture(110, [0, 3200, 3472]);
  try {
    exitPrivateRoom(player, 'leave the quest copy for outside-quest NPC checks');
    const original = nativeNpcRows('sir_prysin')[0];
    assert(original, 'the original Sir Prysin placement exists');
    const prysin = spawnActor(player, 'sir_prysin', actors, [original.level, original.x, original.z]);
    addItem(player, 'coins', 500);
    nativeNpc(player, prysin, [2, 2, 2], 'the original 500-coin Silverlight recovery');
    assert.equal(itemCount(player, 'silverlight'), 1);
    assert.equal(itemCount(player, 'coins'), 0, 'ordinary Silverlight recovery spends all 500 coins');
    assert.equal(itemCount(player, 'darklight'), 0, 'unfinished Agrith never supplies Darklight');
    removeItem(player, 'silverlight');
    setPlayerVariable(player, 'agrith_quest', 125);
    addItem(player, 'coins', 999);
    nativeNpc(player, prysin, [1], 'insufficient Darklight recovery coins');
    assert.equal(itemCount(player, 'darklight'), 0, '999 coins cannot buy Darklight');
    assert.equal(itemCount(player, 'coins'), 999);
    addItem(player, 'coins');
    nativeNpc(player, prysin, [1], 'pay exactly 1000 for Darklight');
    assert.equal(itemCount(player, 'darklight'), 1);
    assert.equal(itemCount(player, 'coins'), 0, 'Darklight recovery spends exactly 1000 coins');
    addItem(player, 'coins', 1000);
    nativeNpc(player, prysin, [], 'no duplicate Darklight purchase');
    assert.equal(itemCount(player, 'darklight'), 1);
    assert.equal(itemCount(player, 'coins'), 1000);
    removeItem(player, 'darklight');
    addItem(player, 'trail_clue_hard_riddle015');
    const clues = types.EnumType.getByName('trail_hard_enum');
    assert(clues, 'the real packed hard-clue enum exists');
    const alternative = [...clues.values].find(([key, value]) =>
      key >= 0 && key < clues.values.size && value !== itemId('trail_clue_hard_riddle015'));
    assert(alternative, 'the packed hard-clue enum contains a different next clue');
    const realRandom = JavaRandom.nextDouble;
    JavaRandom.nextDouble = () => (alternative[0] + 0.5) / clues.values.size;
    try {
      nativeNpc(player, prysin, [], 'hard clue takes precedence over Darklight purchase');
    } finally {
      JavaRandom.nextDouble = realRandom;
    }
    assert.equal(itemCount(player, 'trail_clue_hard_riddle015'), 0, 'the deterministic next clue differs from the supplied clue');
    assert.equal(itemCount(player, types.ObjType.get(alternative[1]).debugname), 1, 'the real clue route supplies its native next clue');
    assert.equal(itemCount(player, 'darklight'), 0, 'the hard-clue route never falls through to a Darklight sale');
    assert.equal(itemCount(player, 'coins'), 1000);
    setPlayerVariable(player, 'demonstart', 0);
    nativeNpc(player, prysin, [1], 'unfinished Demon Slayer is not pre-empted by Agrith completion');
    assert.equal(playerVariable(player, 'demonstart'), 0, 'Prysin preserves the unstarted Demon Slayer stage');
    assert.equal(itemCount(player, 'darklight'), 0, 'Agrith completion never pre-empts unfinished Demon Slayer');
  } finally { cleanupQuestRun(player, actors); }
});

check('an incomplete Golem keeps its own dialogue and four-clay repair despite an Agrith stage', () => {
  const { player, actors } = questFixture(50, [0, 3480, 3097]);
  try {
    exitPrivateRoom(player, 'leave the quest copy for the original Golem');
    setPlayerVariable(player, 'golem_a', questConstant('golem_not_started'));
    setPlayerVariable(player, 'golem_clay', 0);
    const golem = spawnActor(player, 'golem_golem', actors);
    nativeNpc(player, golem, [1], 'start the original Golem quest');
    assert.equal(playerVariable(player, 'golem_a'), questConstant('golem_started'));
    addItem(player, 'softclay', 4);
    for (let i = 1; i <= 4; i++) {
      nativeUseNpc(player, golem, 'softclay', `original Golem repair ${i}`);
      assert.equal(playerVariable(player, 'golem_clay'), i);
      assert.equal(questStage(player), 50);
    }
    assert.equal(playerVariable(player, 'golem_a'), questConstant('golem_repaired'));
  } finally { cleanupQuestRun(player, actors); }
});

check('both ritual monks replace a lost Silverlight before the final blow', () => {
  for (const name of ['agrith_reen_sigil', 'agrith_badden_sigil']) {
    const { player, actors } = questFixture(110, [2, 2720, 4895]);
    try {
      nativeNpc(player, roomNpc(player, name), [], `${name} recovers the lost finishing weapon`);
      assert.equal(itemCount(player, 'silverlight'), 1, 'the retained period guide permits monk recovery during the quest');
      assert.equal(questStage(player), 110);
    } finally { cleanupQuestRun(player, actors); }
  }
});

function prepareDarklight(player) {
  addItem(player, 'darklight');
  wearItem(player, 'darklight');
  runPlayerScript(player, '[proc,player_combat_stat]');
  for (const style of ['stab', 'slash', 'crush', 'range', 'magic']) setPlayerVariable(player, `com_${style}attack`, 1000000);
  setPlayerVariable(player, 'com_maxhit', 20);
  setPlayerVariable(player, 'sa_energy', 1000);
  setPlayerVariable(player, 'sa_attack', 1);
}
function darklightRoll(player, name, target, successful) {
  const realRandom = JavaRandom.nextDouble;
  const draws = successful ? [0.999999, 0.999999, 0] : [0, 0.999999];
  let draw = 0;
  JavaRandom.nextDouble = () => draws[draw++ % draws.length];
  try {
    runPlayerScript(player, name, [], target);
  } finally {
    JavaRandom.nextDouble = realRandom;
  }
  assert.equal(playerVariable(player, 'sa_energy'), 500, 'Weaken consumes exactly half of the native 1000 energy units');
  assert.equal(playerVariable(player, 'sa_attack'), 0, 'Weaken consumes the special toggle');
}
check('Darklight Weaken drains additive base percentages only on successful NPC and player hits', () => {
  assert.equal(param(types.ObjType.get(itemId('darklight')), 'sa_energy'), 500);
  const goblin = types.NpcType.configs.find(type => type?.name === 'Goblin' && type.size === 1 && type.op?.[1] === 'Attack');
  assert(goblin, 'an ordinary non-demonic NPC fixture exists');
  assert.equal(param(goblin, 'demonbane_vulnerable'), 0);
  const goblinName = [...types.NpcType.configNames].find(([, number]) => number === goblin.id)?.[0];
  assert(goblinName);
  for (const [name, drain] of [[goblinName, 6], ['agrith_naar', 11]]) {
    for (const successful of [false, true]) {
      const { player, actors } = questFixture(125, [2, 2720, 4895]);
      try {
        prepareDarklight(player);
        const target = spawnActor(player, name, actors);
        target.baseLevels.fill(100);
        target.levels.fill(100);
        darklightRoll(player, '[label,agrith_darklight_special]', target, successful);
        for (const stat of [NpcStat.ATTACK, NpcStat.STRENGTH, NpcStat.DEFENCE]) {
          assert.equal(target.levels[stat], 100 - (successful ? drain : 0), `${name} ${successful ? 'successful zero-damage hit' : 'miss'} drain`);
        }
        assert.equal(target.levels[NpcStat.HITPOINTS], 100, 'the zero-damage witness isolates the stat effect');
      } finally { cleanupQuestRun(player, actors); }
    }
  }
  for (const successful of [false, true]) {
    const { player, actors } = questFixture(125, [0, 3100, 3800]);
    const target = playerAt([0, 3101, 3800], 0);
    try {
      prepareDarklight(player);
      darklightRoll(player, '[label,agrith_darklight_pvp_special]', target, successful);
      for (const stat of [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE]) {
        assert.equal(target.levels[stat], successful ? 94 : 99, `player ${successful ? 'successful zero-damage hit' : 'miss'} drain`);
      }
      assert.equal(target.levels[PlayerStat.HITPOINTS], 99);
    } finally {
      cleanup(target);
      cleanupQuestRun(player, actors);
    }
  }
});

console.log(`RESULT ${failures ? 'FAIL' : 'PASS'} Shadow of the Storm compiled quest: ${checks} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
