import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  engine, World, Player, Npc, ScriptProvider, ScriptRunner, ScriptState,
  ServerTriggerType, EntityLifeCycle, types, map, nativeLocRows, nativeNpcRows,
  floorTiles, locFor, requiredId, walkable
} from '../regicide-travel/runtime.mjs';
export { World, ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType, types, map,
  nativeLocRows, nativeNpcRows, floorTiles, locFor, walkable };
export { nativeLocInventory } from '../regicide-travel/runtime.mjs';
export const load = async file => (await import(pathToFileURL(path.join(engine, 'src', file)).href)).default;
export const { getExpByLevel } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/Player.ts')).href);
export const { PlayerStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const { NpcStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/NpcStat.ts')).href);
const rsbuf = await import(pathToFileURL(path.join(engine, 'src/network/rsbuf/index.ts')).href);
const { Interaction } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/Interaction.ts')).href);
export const { CollisionType } = await import(pathToFileURL(path.join(engine, 'src/engine/routefinder/index.ts')).href);
const OpHeld = await load('network/game/client/model/OpHeld.ts');
const OpHeldHandler = await load('network/game/client/handler/OpHeldHandler.ts');
const IfButton = await load('network/game/client/model/IfButton.ts');
const IfButtonHandler = await load('network/game/client/handler/IfButtonHandler.ts');
const ResumePauseButton = await load('network/game/client/model/ResumePauseButton.ts');
const ResumePauseButtonHandler = await load('network/game/client/handler/ResumePauseButtonHandler.ts');
const OpLoc = await load('network/game/client/model/OpLoc.ts');
const OpLocHandler = await load('network/game/client/handler/OpLocHandler.ts');
const OpLocU = await load('network/game/client/model/OpLocU.ts');
const OpLocUHandler = await load('network/game/client/handler/OpLocUHandler.ts');
const OpHeldU = await load('network/game/client/model/OpHeldU.ts');
const OpHeldUHandler = await load('network/game/client/handler/OpHeldUHandler.ts');
const buttonHandler = new IfButtonHandler();
const pauseHandler = new ResumePauseButtonHandler();
const locHandler = new OpLocHandler();
const locUseHandler = new OpLocUHandler();
const itemUseHandler = new OpHeldUHandler();
export const id = (kind, name) => requiredId(types[kind], name);
export const obj = name => id('ObjType', name);
export const inv = id('InvType', 'inv');
export const worn = id('InvType', 'worn');
export const bank = id('InvType', 'bank');
export const com = name => id('Component', name);
export const bit = (p, name) => p.getVarBit(id('VarBitType', name));
export const setBit = (p, name, value) => p.setVarBit(id('VarBitType', name), value);
export const setVar = (p, name, value) => p.setVar(id('VarPlayerType', name), value);
export const count = (p, name, inventory = inv) => p.invTotal(inventory, obj(name));
export const give = (p, name, amount = 1, inventory = inv) => p.invAdd(inventory, obj(name), amount);
export const tile = p => [p.level, p.x, p.z];
export function position(p, [level, x, z]) {
  Object.assign(p, { level, x, z, originX: x, originZ: z, delayed: false });
  p.buildArea.rebuild();
}
export function skill(p, name, level) {
  const index = PlayerStat[name.toUpperCase()];
  p.levels[index] = level;
  p.baseLevels[index] = level;
  p.stats[index] = getExpByLevel(level);
}
export function finish(p, state, choices = []) {
  choices = [...choices];
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 600; step++) {
    if (state.execution === ScriptState.PAUSEBUTTON) {
      p.activeScript = state;
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      if (/^multi[2-5]$/.test(root) || root === 'multiobj2') {
        assert(choices.length, `${state.script.name}: unanswered ${root}`);
        const selected = root === 'multiobj2' ? com(`${root}:objtext${choices.shift()}`) : com(`${root}:com_${choices.shift()}`);
        assert(p.resumeButtons.includes(selected), `${root} offers selected choice`);
        assert.equal(buttonHandler.handle(new IfButton(selected), p), true);
      } else {
        assert.equal(pauseHandler.handle(new ResumePauseButton(0), p), true);
      }
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else {
      assert.fail(`${state.script.name}: unexpected execution state ${state.execution}`);
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, `${state.script.name} finishes`);
  assert.equal(choices.length, 0, 'every supplied dialogue choice is consumed');
  return state;
}
export function run(p, name, { args = [], target = null, choices = [] } = {}) {
  const script = ScriptProvider.getByName(name);
  assert(script, `compiled script ${name}`);
  const state = ScriptRunner.init(script, p, target, args);
  p.executeScript(state, true, true);
  return finish(p, state, choices);
}
let serial = 0;
export function player() {
  const n = ++serial;
  const p = new Player(`rfd_fixture_${n}`, BigInt(80000 + n), BigInt(800000 + n));
  const uid = ((Number(p.username37 & 0x1fffffn) << 11) | n) >>> 0;
  Object.assign(p, { pid: n, slot: n, uid, isActive: true, lastMovement: 0 });
  p.vars.fill(0);
  p.stats.fill(getExpByLevel(50));
  p.baseLevels.fill(50);
  p.levels.fill(50);
  p.packets = [];
  p.messages = [];
  p.write = packet => p.packets.push(packet);
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = p.messageGame;
  for (const inventory of [inv, worn, bank]) p.getInventory(inventory);
  setVar(p, 'tutorial', 1000);
  setVar(p, 'follower_obj', -1);
  World.players[p.slot] = p;
  World.playerLoop.add(p.hash64, p);
  rsbuf.addPlayer(p.slot);
  position(p, [0, 3207, 3216]);
  run(p, '[proc,initalltabs]');
  return p;
}
export function text(p) {
  return [...p.messages, ...p.packets.map(packet => packet.text ?? packet.msg ?? '')].join(' ');
}
export function nativeLoc(name, choose = rows => rows[0]) {
  const row = choose(nativeLocRows(name));
  assert(row, `original map contains ${name}`);
  return locFor(row);
}
export function nativeNpc(name, choose = rows => rows[0]) {
  const row = choose(nativeNpcRows(name));
  assert(row, `original map contains ${name}`);
  const type = types.NpcType.get(row.id);
  const existing = [...World.npcs].find(npc => npc.type === row.id && npc.level === row.level && npc.x === row.x && npc.z === row.z);
  if (existing) return existing;
  const actor = new Npc(row.level, row.x, row.z, type.size, type.size, EntityLifeCycle.RESPAWN, World.npcs.next(), type.id, type.blockwalk);
  actor.lastMovement = -100;
  World.addNpc(actor, -1);
  return actor;
}
export function stand(p, target, accept = () => true) {
  for (let radius = 1; radius <= 6; radius++) {
    for (let x = target.x - radius; x <= target.x + radius; x++) {
      for (let z = target.z - radius; z <= target.z + radius; z++) {
        const at = [target.level, x, z];
        if (!accept(at) || !floorTiles.has(at.join(',')) || map.isMapBlocked(x, z, target.level)) continue;
        position(p, at);
        if (p.inOperableDistance(target)) return at;
      }
    }
  }
  assert.fail(`no packed-map operable tile for target ${target.type} at ${target.x},${target.z}`);
}
export function capture(p, action, choices = []) {
  const states = [];
  const original = p.executeScript;
  p.executeScript = function(state, ...args) {
    states.push(state);
    return original.call(this, state, ...args);
  };
  try { action(); } finally { p.executeScript = original; }
  assert(states.length, 'native dispatch executes a compiled script');
  finish(p, states.at(-1), choices);
  return states.at(-1);
}
export function talk(p, actor, choices = []) {
  stand(p, actor);
  p.clearPendingAction();
  assert(p.setInteraction(Interaction.ENGINE, actor, ServerTriggerType.APNPC1));
  const script = p.getOpTrigger();
  assert(script, 'engine resolves visible NPC Talk-to');
  assert.match(script.name, /^\[opnpc1,/);
  return capture(p, () => assert(p.tryInteract(true)), choices);
}
export function operate(p, target, option = 1, { choices = [], accept = () => true, from = null } = {}) {
  if (from === null) stand(p, target, accept);
  else {
    walkable(from, 'native location action source');
    assert(accept(from));
    position(p, from);
  }
  assert.equal(locHandler.handle(new OpLoc(option, target.x, target.z, target.type), p), true);
  assert.equal(p.target, target);
  assert(p.validateTarget(), 'native loc remains valid');
  const script = p.inOperableDistance(target) ? p.getOpTrigger() : p.getApTrigger();
  assert(script, 'engine resolves visible location operation or approach');
  assert.match(script.name, new RegExp(`^\\[(?:op|ap)loc${option},`));
  return capture(p, () => assert(p.tryInteract(true)), choices);
}
export function useLoc(p, item, target, { accept = () => true } = {}) {
  stand(p, target, accept);
  const itemId = obj(item);
  const slot = p.getInventory(inv).getItemIndex(itemId);
  assert.notEqual(slot, -1, `${item} carried for location use`);
  assert.equal(locUseHandler.handle(new OpLocU(target.x, target.z, target.type, itemId, slot, com('inventory:inv')), p), true);
  assert.equal(p.target, target);
  assert(p.validateTarget());
  return capture(p, () => p.processInteraction());
}
export function useItems(p, used, target, choices = []) {
  const items = p.getInventory(inv);
  const targetId = obj(target);
  const usedId = obj(used);
  const targetSlot = items.getItemIndex(targetId);
  const useSlot = items.getItemIndex(usedId);
  assert.notEqual(targetSlot, -1, `${target} carried`);
  assert.notEqual(useSlot, -1, `${used} carried`);
  return capture(p, () => assert.equal(itemUseHandler.handle(
    new OpHeldU(targetId, targetSlot, com('inventory:inv'), usedId, useSlot, com('inventory:inv')), p), true), choices);
}
export function remove(p, name, inventory = inv) {
  const items = p.getInventory(inventory);
  const slot = items.getItemIndex(obj(name));
  assert.notEqual(slot, -1, `${name} present for fixture removal`);
  items.set(slot, null);
}
export function clear(p, inventory = inv) {
  const items = p.getInventory(inventory);
  for (let slot = 0; slot < items.capacity; slot++) items.set(slot, null);
}

export function equip(p, name) {
  const item = obj(name);
  const type = types.ObjType.get(item);
  assert(type.iop[1] === 'Wear' || type.iop[1] === 'Wield', `${name} exposes native equipment action`);
  const slot = p.getInventory(inv).getItemIndex(item);
  assert.notEqual(slot, -1, `${name} held for equipment action`);
  capture(p, () => assert.equal(new OpHeldHandler().handle(new OpHeld(2, item, slot, com('inventory:inv')), p), true));
  assert.equal(count(p, name, worn), 1, `${name} is really equipped`);
}

export function showNpc(p, actor) {
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
  assert(rsbuf.hasNpc(p.slot, actor.nid), 'real mapped NPC is visible to the native packet path');
}
