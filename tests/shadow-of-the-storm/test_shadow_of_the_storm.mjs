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
const fixedRetreat = [2, 2720, 4900]; // The original hard-coded destination, retained only as a regression control.
const movedBoss = [2, 2718, 4902]; // Parent-probed open 3x3 footprint on the original m42_76 floor.
const distantOwner = [2, 2725, 4890];
const closeOwner = [2, 2721, 4903];

const handSlot = types.ObjType.get(requiredId(types.ObjType, 'silverlight')).wearpos;
assert.equal(handSlot, 3, 'the original Silverlight config identifies the right-hand wear slot');
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
function finishInteraction(player, choices = [], label = 'packed interaction') {
  const remaining = [...choices];
  for (let step = 0; step < 160; step++) {
    const state = player.activeScript;
    if (!state) {
      assert.equal(remaining.length, 0, `${label} used all dialogue choices`);
      return;
    }
    assert.notEqual(state.execution, ScriptState.ABORTED, `${label} script did not abort`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
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
function nativeNpc(player, npc, choices = [], label = 'NPC Talk-to', expectedName = null) {
  approachNpc(player, npc);
  showNpc(player, npc);
  assert(npcHandler.handle(new OpNpc(1, npc.nid), player), `${label} accepts the NPC interaction`);
  assert.equal(player.target, npc, `${label} selects the visible NPC`);
  assert(player.validateTarget(), `${label} keeps the native NPC target`);
  const trigger = player.getOpTrigger();
  assert(trigger, `${label} resolves its visible-form trigger`);
  if (expectedName) assert.equal(trigger.name, expectedName, `${label} resolves the expected visible script`);
  player.processInteraction();
  finishInteraction(player, choices, label);
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
  placePlayer(player, standForLoc(row));
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
      if (!floorTiles.has(tile.join(',')) || map.isMapBlocked(x, z, row.level)) continue;
      if (map.reachedLoc(row.level, x, z, row.x, row.z, type.width, type.length, 1,
        row.angle, row.shape, type.forceapproach)) return tile;
    }
  }
  assert.fail(`no walkable packed stand reaches ${row.name} at ${row.coord}`);
}
function nativeLocRow(player, row, choices = [], label = `loc ${row.name}`, option = 1) {
  placePlayer(player, standForLoc(row));
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
function bossAt(tile, owner) {
  const nid = World.npcs.next();
  const npc = new Npc(tile[0], tile[1], tile[2], bossRange, bossRange, EntityLifeCycle.RESPAWN, nid, bossType.id, bossType.blockwalk);
  npc.lastMovement = -100;
  World.addNpc(npc, -1);
  npc.setVar(ownerVar, owner.uid);
  npc.setVar(aggressiveVar, owner.uid);
  npc.setVar(delayVar, World.currentTick - 1);
  return npc;
}
function cleanup(player, npc) {
  if (npc) {
    World.removeNpc(npc, -1);
    rsbuf.removeNpc(npc.nid);
    World.npcs.remove(npc.nid);
    npc.cleanup();
  }
  if (player) {
    player.unlink();
    rsbuf.removePlayer(player.slot);
    delete World.players[player.slot];
  }
}
function packedTileWalkable(tile, label) {
  walkable(tile, label);
}
function pathOut(start, npc) {
  for (let radius = 2; radius <= 8; radius++) {
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      const dest = [start[0], start[1] + dx, start[2] + dz];
      if (footprintDistance(dest, npc) === 0) continue;
      if (!floorTiles.has(dest.join(',')) || map.isMapBlocked(dest[1], dest[2], dest[0])) continue;
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
function combatFixture(playerTile, meleePrayer = false, magicPrayer = false) {
  const player = playerAt(playerTile);
  if (meleePrayer) player.setVar(protectMelee, 1);
  if (magicPrayer) player.setVar(protectMagic, 1);
  const npc = bossAt(movedBoss, player);
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

check('Agrith Naar uses its original 3x3 map footprint and current room tiles are walkable', () => {
  assert.equal(bossRange, 3, 'the original Agrith Naar size is retained');
  packedTileWalkable(movedBoss, 'relocated boss anchor on the original throne-room floor');
  for (let dx = 0; dx < bossRange; dx++) for (let dz = 0; dz < bossRange; dz++) {
    packedTileWalkable([movedBoss[0], movedBoss[1] + dx, movedBoss[2] + dz], 'relocated boss footprint');
  }
  packedTileWalkable(distantOwner, 'owner start tile on the original throne-room floor');
  assert(footprintDistance(distantOwner, { level: movedBoss[0], x: movedBoss[1], z: movedBoss[2], size: bossRange }) > 1,
    'owner starts outside melee reach');
  assert.notEqual(footprintDistance(fixedRetreat, { level: movedBoss[0], x: movedBoss[1], z: movedBoss[2], size: bossRange }), 1,
    'the former fixed 2_42_76_32_36 destination is not adjacent to this relocated boss');
});

check('compiled AI pulls a distant owner to a walkable tile adjacent to the relocated footprint', () => {
  const { player, npc } = combatFixture(distantOwner);
  try {
    runNpcAi(npc, player, ServerTriggerType.AI_APPLAYER2);
    const landing = [player.level, player.x, player.z];
    packedTileWalkable(landing, 'native Agrith Naar pullback landing');
    assert.equal(footprintDistance(landing, npc), 1, 'player lands adjacent to the actual relocated 3x3 footprint');
    assert.notEqual(footprintDistance(landing, npc), 0, 'player does not land inside the boss footprint');
    assert(pathOut(landing, npc).length > 0, 'the pullback landing has a non-empty packed collision path out');
    assert.equal(footprintDistance(fixedRetreat, npc), 2, 'the old fixed destination is nonadjacent to the relocated boss');
  } finally {
    cleanup(player, npc);
  }
});

check('compiled AI chooses melee close, magic at range, and avoids each protected style', () => {
  const type = bossType;
  const meleeAnim = param(type, 'attack_anim');
  const magicAnim = param(type, 'magicattack_anim');
  assert.notEqual(meleeAnim, magicAnim, 'the packed boss has distinct melee and magic animations');
  const cases = [
    { label: 'close unprotected', tile: closeOwner, protectMelee: false, protectMagic: false, expected: meleeAnim, pull: false },
    { label: 'close Protect from Melee', tile: closeOwner, protectMelee: true, protectMagic: false, expected: magicAnim, pull: false },
    { label: 'distant unprotected', tile: distantOwner, protectMelee: false, protectMagic: false, expected: magicAnim, pull: true },
    { label: 'distant Protect from Magic', tile: distantOwner, protectMelee: false, protectMagic: true, expected: meleeAnim, pull: true }
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
    const { player, npc } = combatFixture(closeOwner);
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

function approachNpc(player, npc) {
  player.closeModal();
  for (const [dx, dz] of [[-1, 0], [npc.width, 0], [0, -1], [0, npc.length], [-1, -1]]) {
    const tile = [npc.level, npc.x + dx, npc.z + dz];
    if (!floorTiles.has(tile.join(',')) || map.isMapBlocked(tile[1], tile[2], tile[0])) continue;
    placePlayer(player, tile);
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
  player.baseLevels[PlayerStat.CRAFTING] = 30;
  player.levels[PlayerStat.CRAFTING] = 30;
  return { player, actors: [] };
}
function questStage(player) {
  return playerVariable(player, 'agrith_quest');
}
function ownedNpc(player, name) {
  const npc = [...World.npcs].find(candidate => candidate.isActive && candidate.type === id('NpcType', name) &&
    candidate.getVar(ownerVar) === player.uid);
  assert(npc, `the product spawned owned ${name}`);
  return npc;
}
function mappedNpc(player, name, actors) {
  const existing = actors.find(npc => npc.isActive && npc.type === id('NpcType', name));
  if (existing) return existing;
  const row = nativeNpcRows(name).find(candidate => candidate.level === 2);
  assert(row, `the original throne-room map contains ${name}`);
  const npc = spawnActor(player, name, actors, [row.level, row.x, row.z]);
  npc.setVar(ownerVar, 0);
  return npc;
}
function roomWords(player) {
  return Array.from({ length: 5 }, (_, i) => playerVariable(player, `agrith_incantation_${i + 1}`));
}
function setWords(player) {
  for (let i = 1; i <= 5; i++) setPlayerVariable(player, `agrith_incantation_${i}`, i);
}
const questLocationRows = [
  'golem_insidestairs_top', 'golem_insidestairs_base', 'golem_portal', 'golem_demon_portal',
  'agrith_kiln_1', 'agrith_kiln_2', 'agrith_kiln_3', 'agrith_kiln_4'
].flatMap(name => nativeLocRows(name));
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

check('original stairs and portals retain open landings and do not pre-empt The Golem', () => {
  const { player, actors } = questFixture();
  try {
    nativeLocRow(player, rowAt([0, 3492, 3090]), [], 'original stairs down');
    openLanding(player, [0, 2721, 4886], 'stairs down');
    nativeLocRow(player, rowAt([0, 2721, 4884]), [], 'original stairs up');
    openLanding(player, [0, 3491, 3090], 'stairs up');
    setPlayerVariable(player, 'golem_a', questConstant('golem_doors_open'));
    nativeLocRow(player, rowAt([0, 2720, 4912]), [], 'original Golem portal');
    openLanding(player, [2, 2720, 4884], 'Golem portal');
    assert.equal(playerVariable(player, 'golem_a'), questConstant('golem_entered_portal'));
    nativeLocRow(player, rowAt([2, 2719, 4883]), [], 'original return portal');
    openLanding(player, [0, 2713, 4913], 'return portal');
    setPlayerVariable(player, 'golem_a', questConstant('golem_complete'));
    setPlayerVariable(player, 'agrith_quest', 10);
    const portal = rowAt([0, 2720, 4912]);
    nativeLocRow(player, portal, [], 'Dave blocks premature entry');
    assert.equal(player.level, 0);
    setPlayerVariable(player, 'agrith_quest', 30);
    const denath = mappedNpc(player, 'agrith_denath', actors);
    nativeLocRow(player, portal, [], 'accepted cult entry with lost quest items');
    openLanding(player, [2, 2720, 4884], 'cult portal');
    assert(denath.isActive, 'portal entry preserves the original mapped Denath');
    assert.equal(denath.getVar(ownerVar), 0, 'mapped cult actors do not acquire a player owner');
    assert.equal(playerVariable(player, 'golem_a'), questConstant('golem_complete'));
  } finally { cleanupQuestRun(player, actors); }
});

const kilnTiles = [[0, 3467, 3123], [0, 3478, 3082], [0, 3472, 3092], [0, 3500, 3084]];
check('all four original kilns bind the chosen ordinal, reject wrong kilns and recover a lost tome', () => {
  for (let ordinal = 0; ordinal < kilnTiles.length; ordinal++) {
    const { player, actors } = questFixture(60);
    try {
      setPlayerVariable(player, 'agrith_kiln', ordinal);
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

check('original unowned cult actors serve each account without duplicate pre-ritual copies', () => {
  const { player, actors } = questFixture(60, [2, 2720, 4895]);
  const other = playerAt([2, 2720, 4895], 60);
  try {
    const names = ['agrith_denath', 'agrith_matthew', 'agrith_jennifer', 'agrith_eric', 'agrith_tanya', 'agrith_patrick'];
    const originals = names.map(name => mappedNpc(player, name, actors));
    const cultTypes = new Set(originals.map(npc => npc.type));
    const before = [...World.npcs].filter(npc => npc.isActive && cultTypes.has(npc.type)).map(npc => npc.nid);
    runPlayerScript(player, '[proc,agrith_room_enter]');
    runPlayerScript(other, '[proc,agrith_room_enter]');
    assert.deepEqual([...World.npcs].filter(npc => npc.isActive && cultTypes.has(npc.type)).map(npc => npc.nid), before,
      'entering with either account adds no duplicate pre-ritual cult actors');
    for (const npc of originals) assert.equal(npc.getVar(ownerVar), 0, 'mapped actors stay unowned');
    for (const account of [player, other]) {
      addItem(account, 'agrith_book');
      addItem(account, 'agrith_sigil');
      nativeNpc(account, mappedNpc(player, 'agrith_matthew', actors), [], 'the original unowned Matthew prepares this account');
      assert.equal(questStage(account), 70);
      if (account === player) assert.equal(questStage(other), 60, 'one account cannot advance the other');
    }
    setPlayerVariable(player, 'agrith_quest', 100);
    runPlayerScript(player, '[proc,agrith_room_enter]');
    for (const name of ['agrith_badden_sigil', 'agrith_reen_sigil', 'agrith_golem_sigil', 'agrith_dave_sigil']) {
      assert(ownedNpc(player, name), 'genuinely temporary recruits retain their owner');
    }
    runPlayerScript(player, '[proc,agrith_clear_cult]');
    assert(originals.every(npc => npc.isActive), 'temporary-actor cleanup never deletes original mapped cult actors');
  } finally {
    cleanup(other);
    cleanupQuestRun(player, actors);
  }
});

check('cult dialogue, native casting, both chants, recruitment and real death queue complete the quest', () => {
  const { player, actors } = questFixture(30, [2, 2720, 4895]);
  try {
    addItem(player, 'agrith_silverlight_dyed');
    wearItem(player, 'agrith_silverlight_dyed');
    runPlayerScript(player, '[proc,agrith_room_enter]');
    nativeNpc(player, mappedNpc(player, 'agrith_denath', actors), [], 'Denath teaches the incantation');
    assert.equal(questStage(player), 40);
    const words = roomWords(player);
    assert.deepEqual([...words].sort(), [1, 2, 3, 4, 5], 'Denath teaches a complete permutation');
    nativeNpc(player, mappedNpc(player, 'agrith_denath', actors), [], 'Denath repeats the same incantation');
    assert.deepEqual(roomWords(player), words);
    nativeNpc(player, mappedNpc(player, 'agrith_jennifer', actors), [], 'Jennifer supplies the mould');
    assert.equal(itemCount(player, 'agrith_sigil_mould'), 1);
    removeItem(player, 'agrith_sigil_mould');
    nativeNpc(player, mappedNpc(player, 'agrith_jennifer', actors), [], 'Jennifer recovers a lost mould');
    assert.equal(itemCount(player, 'agrith_sigil_mould'), 1);
    nativeNpc(player, mappedNpc(player, 'agrith_matthew', actors), [], 'Matthew sends the player to the golem');
    assert.equal(questStage(player), 50);
    const golem = spawnActor(player, 'golem_golem', actors, [0, 3481, 3097]);
    nativeNpc(player, golem, [], 'the original golem selects a kiln');
    assert.equal(questStage(player), 60);
    const chosen = playerVariable(player, 'agrith_kiln');
    assert(chosen >= 0 && chosen < 4);
    nativeLocRow(player, rowAt(kilnTiles[chosen]), [], 'retrieve the period kiln book');
    assert.equal(itemCount(player, 'agrith_book'), 1);
    placePlayer(player, [2, 2720, 4895]);
    nativeNpc(player, mappedNpc(player, 'agrith_matthew', actors), [], 'book without sigil is rejected');
    assert.equal(questStage(player), 60);
    addItem(player, 'silver_bar');
    const craftingBefore = player.stats[PlayerStat.CRAFTING];
    castSigil(player);
    assert.equal(itemCount(player, 'silver_bar'), 0);
    assert.equal(itemCount(player, 'agrith_sigil_mould'), 1);
    assert.equal(itemCount(player, 'agrith_sigil'), 1);
    assert.equal(player.stats[PlayerStat.CRAFTING] - craftingBefore, 500, 'casting uses native tenths of XP');
    placePlayer(player, [2, 2720, 4895]);
    holdItem(player, 'agrith_book', 1, [], 'read the reversed tome');
    nativeNpc(player, mappedNpc(player, 'agrith_matthew', actors), [], 'Matthew accepts book and sigil');
    assert.equal(questStage(player), 70);
    const wrong = words.map(word => word % 5 + 1);
    placePlayer(player, [2, 2720, 4895]);
    holdItem(player, 'agrith_sigil', 1, wrong, 'wrong first chant');
    assert.equal(questStage(player), 70);
    holdItem(player, 'agrith_sigil', 1, words, 'correct forward chant');
    assert.equal(questStage(player), 80);
    assert.equal(playerVariable(player, 'agrith_convinced_dave'), 1);
    const dave = spawnActor(player, 'agrith_dave', actors, [0, 2721, 4910]);
    nativeNpc(player, dave, [1], 'real Tanya scene and Dave recruitment');
    assert.equal(questStage(player), 90);
    assert.equal(playerVariable(player, 'agrith_convinced_dave'), 2);
    nativeNpc(player, spawnActor(player, 'agrith_reen_uzer', actors, [0, 3483, 3090]), [1], 'recruit Reen');
    nativeNpc(player, spawnActor(player, 'agrith_badden_uzer', actors, [0, 3484, 3090]), [1], 'recruit Badden');
    assert.equal(playerVariable(player, 'agrith_reen_uzer'), 2);
    assert.equal(playerVariable(player, 'agrith_badden_uzer'), 2);
    addItem(player, 'golem_golemkey');
    nativeUseNpc(player, golem, 'golem_golemkey', 'recruit the golem with its original key');
    assert.equal(playerVariable(player, 'agrith_convinced_golem'), 1);
    removeItem(player, 'agrith_sigil');
    placePlayer(player, [2, 2720, 4895]);
    nativeNpc(player, mappedNpc(player, 'agrith_matthew', actors), [], 'recover lost sigils and distribute them to recruits');
    assert.equal(questStage(player), 100);
    assert.equal(itemCount(player, 'agrith_sigil'), 1, 'three recovered sigils are given to the recruits');
    nativeNpc(player, mappedNpc(player, 'agrith_matthew', actors), [2], 'not ready for the final ritual');
    assert.equal(questStage(player), 100);
    nativeNpc(player, mappedNpc(player, 'agrith_matthew', actors), [1], 'ready for the final ritual');
    assert.equal(questStage(player), 110);
    placePlayer(player, [2, 2720, 4895]);
    holdItem(player, 'agrith_sigil', 1, wrong, 'wrong second chant');
    assert.equal([...World.npcs].filter(npc => npc.isActive && npc.type === bossType.id && npc.getVar(ownerVar) === player.uid).length, 0);
    holdItem(player, 'agrith_sigil', 1, [...words].reverse(), 'correct reverse chant');
    const boss = ownedNpc(player, 'agrith_naar');
    placePlayer(player, [boss.level, boss.x + boss.width, boss.z]);
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
    const { player, actors } = questFixture(90, [2, 2720, 4895]);
    try {
      for (const [name, value] of flags) setPlayerVariable(player, name, name === missing ? 0 : value);
      nativeNpc(player, mappedNpc(player, 'agrith_matthew', actors), [], `Matthew rejects missing ${missing}`);
      assert.equal(questStage(player), 90);
      assert.equal(itemCount(player, 'agrith_sigil'), 4, 'lost ritual sigils are recoverable without bypassing recruitment');
    } finally { cleanupQuestRun(player, actors); }
  }
});

check('lost mould and sigil remain craftable through the second-ritual phase', () => {
  for (const stage of [40, 70, 100, 110]) {
    const { player, actors } = questFixture(stage, [2, 2720, 4895]);
    try {
      nativeNpc(player, mappedNpc(player, 'agrith_jennifer', actors), [], `recover mould at ${stage}`);
      addItem(player, 'silver_bar');
      castSigil(player);
      assert.equal(itemCount(player, 'agrith_sigil'), 1, `lost sigil can be remade at stage ${stage}`);
      assert.equal(questStage(player), stage);
    } finally { cleanupQuestRun(player, actors); }
  }
});

check('boss owner guard, duplicate prevention, departure and death leave a repeatable reverse ritual', () => {
  const { player, actors } = questFixture(110, [2, 2720, 4895]);
  const outsider = playerAt([2, 2720, 4895], 110);
  try {
    setWords(player);
    addItem(player, 'agrith_sigil');
    holdItem(player, 'agrith_sigil', 1, [5, 4, 3, 2, 1], 'summon for retry checks');
    let boss = ownedNpc(player, 'agrith_naar');
    holdItem(player, 'agrith_sigil', 1, [], 'a second sigil operation cannot duplicate the boss');
    assert.equal([...World.npcs].filter(npc => npc.isActive && npc.type === bossType.id && npc.getVar(ownerVar) === player.uid).length, 1);
    approachNpc(outsider, boss);
    showNpc(outsider, boss);
    assert(npcHandler.handle(new OpNpc(2, boss.nid), outsider));
    outsider.processInteraction();
    finishInteraction(outsider, [], 'non-owner attack');
    assert(outsider.messages.some(message => message.includes('not your enemy')));
    assert.equal(boss.getVar(ownerVar), player.uid);
    placePlayer(player, [0, 3482, 3090]);
    const timer = ScriptProvider.getByTrigger(ServerTriggerType.AI_TIMER, boss.type, bossType.category);
    let state = ScriptRunner.init(timer, boss);
    boss.executeScript(state);
    assert.equal(state.execution, ScriptState.FINISHED);
    assert.equal(boss.isActive, false, 'departure cleans up the owned encounter');
    assert.equal(questStage(player), 110);
    placePlayer(player, [2, 2720, 4895]);
    holdItem(player, 'agrith_sigil', 1, [5, 4, 3, 2, 1], 'retry after leaving');
    boss = ownedNpc(player, 'agrith_naar');
    player.levels[PlayerStat.HITPOINTS] = 0;
    state = ScriptRunner.init(timer, boss);
    boss.executeScript(state);
    assert.equal(boss.isActive, false, 'death cleans up the owned encounter');
    player.levels[PlayerStat.HITPOINTS] = 99;
    holdItem(player, 'agrith_sigil', 1, [5, 4, 3, 2, 1], 'retry after death');
    assert(ownedNpc(player, 'agrith_naar'));
    assert.equal(questStage(player), 110);
  } finally {
    cleanup(outsider);
    cleanupQuestRun(player, actors);
  }
});

check('all six combat rewards grant exactly 100000 tenths, one QP, Darklight and one completion scroll', () => {
  const rewards = [
    [PlayerStat.ATTACK, [1]], [PlayerStat.STRENGTH, [2]], [PlayerStat.DEFENCE, [3]],
    [PlayerStat.RANGED, [4]], [PlayerStat.MAGIC, [5, 1]], [PlayerStat.HITPOINTS, [5, 2]]
  ];
  for (const [skill, choices] of rewards) {
    const { player, actors } = questFixture(120, [2, 2720, 4895]);
    try {
      addItem(player, 'silverlight');
      wearItem(player, 'silverlight');
      const xpBefore = [...player.stats];
      const qpBefore = questPoints(player);
      const monk = spawnActor(player, 'agrith_reen_sigil', actors);
      nativeNpc(player, monk, choices, `completion skill ${skill}`);
      assert.equal(questStage(player), 125);
      for (let i = 0; i < xpBefore.length; i++) assert.equal(player.stats[i] - xpBefore[i], i === skill ? 100000 : 0);
      assert.equal(questPoints(player) - qpBefore, 1);
      assert.equal(itemCount(player, 'darklight', wornId), 1);
      assert.equal(itemCount(player, 'silverlight', wornId), 0);
      assert.equal(types.Component.get(player.modalMain)?.comName, 'questscroll_death');
      const xpAfter = [...player.stats];
      nativeNpc(player, spawnActor(player, 'agrith_badden_sigil', actors), [], 'completion cannot be replayed');
      assert.deepEqual([...player.stats], xpAfter);
      assert.equal(questPoints(player) - qpBefore, 1);
      assert.equal(itemCount(player, 'darklight', wornId), 1);
      assert.notEqual(types.Component.get(player.modalMain)?.comName, 'questscroll_death', 'the completion scroll is not replayed');
    } finally { cleanupQuestRun(player, actors); }
  }
});

check('a full inventory cannot lose the reward, and an equipped sword can transform without a free slot', () => {
  for (const worn of [false, true]) {
    const { player, actors } = questFixture(120, [2, 2720, 4895]);
    try {
      if (worn) {
        addItem(player, 'agrith_silverlight_dyed');
        wearItem(player, 'agrith_silverlight_dyed');
      }
      addItem(player, 'bronze_dagger', 28);
      const monk = spawnActor(player, 'agrith_reen_sigil', actors);
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
    const original = nativeNpcRows('sir_prysin')[0];
    assert(original, 'the original Sir Prysin placement exists');
    const prysin = spawnActor(player, 'sir_prysin', actors, [original.level, original.x, original.z]);
    addItem(player, 'coins', 500);
    nativeNpc(player, prysin, [2, 2, 2], 'the original 500-coin Silverlight recovery');
    assert.equal(itemCount(player, 'silverlight'), 1);
    assert.equal(itemCount(player, 'coins'), 0);
    assert.equal(itemCount(player, 'darklight'), 0);
    removeItem(player, 'silverlight');
    setPlayerVariable(player, 'agrith_quest', 125);
    addItem(player, 'coins', 999);
    nativeNpc(player, prysin, [1], 'insufficient Darklight recovery coins');
    assert.equal(itemCount(player, 'darklight'), 0);
    assert.equal(itemCount(player, 'coins'), 999);
    addItem(player, 'coins');
    nativeNpc(player, prysin, [1], 'pay exactly 1000 for Darklight');
    assert.equal(itemCount(player, 'darklight'), 1);
    assert.equal(itemCount(player, 'coins'), 0);
    addItem(player, 'coins', 1000);
    nativeNpc(player, prysin, [], 'no duplicate Darklight purchase');
    assert.equal(itemCount(player, 'darklight'), 1);
    assert.equal(itemCount(player, 'coins'), 1000);
    removeItem(player, 'darklight');
    addItem(player, 'trail_clue_hard_riddle015');
    nativeNpc(player, prysin, [], 'hard clue takes precedence over Darklight purchase');
    assert.equal(itemCount(player, 'trail_clue_hard_riddle015'), 0);
    assert.equal(itemCount(player, 'darklight'), 0);
    assert.equal(itemCount(player, 'coins'), 1000);
    setPlayerVariable(player, 'demonstart', 0);
    nativeNpc(player, prysin, [1], 'unfinished Demon Slayer is not pre-empted by Agrith completion');
    assert.equal(playerVariable(player, 'demonstart'), 0);
    assert.equal(itemCount(player, 'darklight'), 0);
  } finally { cleanupQuestRun(player, actors); }
});

check('an incomplete Golem keeps its own dialogue and four-clay repair despite an Agrith stage', () => {
  const { player, actors } = questFixture(50, [0, 3480, 3097]);
  try {
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
      nativeNpc(player, spawnActor(player, name, actors), [], `${name} recovers the lost finishing weapon`);
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
