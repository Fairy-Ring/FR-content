// Run from the sibling engine after a full content build. No server is started.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  content, engine, World, Player, Npc, ScriptProvider, ScriptRunner, ScriptState,
  ServerTriggerType, EntityLifeCycle, types, map, nativeLocRows, nativeNpcRows,
  floorTiles, locFor, requiredId
} from '../regicide-travel/runtime.mjs';

const load = async file => (await import(pathToFileURL(path.join(engine, 'src', file)).href)).default;
const Environment = await load('util/Environment.ts');
const JavaRandom = await load('util/JavaRandom.ts');
const { PlayerStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const { getExpByLevel } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/Player.ts')).href);
const { CollisionType } = await import(pathToFileURL(path.join(engine, 'src/engine/routefinder/index.ts')).href);
const rsbuf = await import(pathToFileURL(path.join(engine, 'src/network/rsbuf/index.ts')).href);
const OpNpc = await load('network/game/client/model/OpNpc.ts');
const OpNpcHandler = await load('network/game/client/handler/OpNpcHandler.ts');
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
const ResumePauseButton = await load('network/game/client/model/ResumePauseButton.ts');
const ResumePauseButtonHandler = await load('network/game/client/handler/ResumePauseButtonHandler.ts');

assert.equal(Environment.NODE_MEMBERS, true, 'Lost Tribe test requires the complete member config');
const varp = name => requiredId(types.VarPlayerType, name);
const bit = name => requiredId(types.VarBitType, name);
const obj = name => requiredId(types.ObjType, name);
const component = name => requiredId(types.Component, name);
const inv = requiredId(types.InvType, 'inv');
const bank = requiredId(types.InvType, 'bank');
const worn = requiredId(types.InvType, 'worn');
const invCom = component('inventory:inv');
const questRow = component('questlist:lost_tribe');
const qpVar = varp('qp');
const questBit = bit('lost_tribe_quest');
const contactBit = bit('lost_tribe_contact');
const hamBit = bit('lost_tribe_ham');
const accusedBit = bit('lost_tribe_sigmund_accused');
const returnedBroochBit = bit('lost_tribe_returned_brooch');
const holeDugBit = bit('lost_tribe_hole_2_dug');
for (const name of ['lost_tribe_brooch', 'lost_tribe_book', 'lost_tribe_chest_key', 'lost_tribe_silverware', 'lost_tribe_treaty']) {
  assert.equal(types.ObjType.get(obj(name)).tradeable, false, `${name} is untradeable in the built server config`);
}
const npcHandler = new OpNpcHandler();
const locHandler = new OpLocHandler();
const locUseHandler = new OpLocUHandler();
const objHandler = new OpObjHandler();
const itemHandler = new OpHeldHandler();
const buttonHandler = new IfButtonHandler();
const pauseHandler = new ResumePauseButtonHandler();

const constants = readFileSync(path.join(content, 'scripts/general/configs/quest.constant'), 'utf8');
function constant(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\^${escaped}\\s*=\\s*(\\d+)\\s*$`, 'm').exec(constants);
  assert(match, `quest constant ${name} is defined`);
  return Number(match[1]);
}
const priestConstants = readFileSync(path.join(content, 'scripts/quests/quest_priest/configs/quest_priest.constant'), 'utf8');
function priestConstant(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\^${escaped}\\s*=\\s*(\\d+)\\s*$`, 'm').exec(priestConstants);
  assert(match, `Priest in Peril constant ${name} is defined`);
  return Number(match[1]);
}
const completeStage = constant('lost_tribe_complete');
assert.equal(completeStage, 11, 'the original 377 quest-complete stage remains 11');
const tileKey = tile => `${tile[0]},${tile[1]},${tile[2]}`;
const coordKey = (level, x, z) => `${level},${x},${z}`;
const packedTile = value => [((value >>> 14) & 0x3fff), (value & 0x3fff)];

function mapSquareBounds(start, destination) {
  const minMapX = Math.floor(Math.min(start[0], destination[0]) / 64);
  const maxMapX = Math.floor(Math.max(start[0], destination[0]) / 64);
  const minMapZ = Math.floor(Math.min(start[1], destination[1]) / 64);
  const maxMapZ = Math.floor(Math.max(start[1], destination[1]) / 64);
  return {
    minX: minMapX * 64, maxX: (maxMapX + 1) * 64 - 1,
    minZ: minMapZ * 64, maxZ: (maxMapZ + 1) * 64 - 1
  };
}

function packedWalk(level, start, destination, blocked = new Set(), bounds = null) {
  const key = ([x, z]) => `${x},${z}`;
  const queue = [start];
  const previous = new Map([[key(start), null]]);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const { minX, maxX, minZ, maxZ } = bounds ?? {
    minX: Math.min(start[0], destination[0]) - 12,
    maxX: Math.max(start[0], destination[0]) + 12,
    minZ: Math.min(start[1], destination[1]) - 12,
    maxZ: Math.max(start[1], destination[1]) + 12
  };
  for (let next = 0; next < queue.length && !previous.has(key(destination)); next++) {
    const from = queue[next];
    for (const [dx, dz] of directions) {
      const to = [from[0] + dx, from[1] + dz];
      const toKey = key(to);
      if (to[0] < minX || to[0] > maxX || to[1] < minZ || to[1] > maxZ || previous.has(toKey)) continue;
      if (blocked.has(`${level},${to[0]},${to[1]}`)) continue;
      if (!map.canTravel(level, from[0], from[1], dx, dz, 1, 0, CollisionType.NORMAL)) continue;
      previous.set(toKey, from);
      queue.push(to);
    }
  }
  if (!previous.has(key(destination))) return null;
  const path = [];
  for (let tile = destination; previous.get(key(tile)); tile = previous.get(key(tile))) path.push(tile);
  return path.reverse();
}

function approachFor(target, acceptStand = () => true) {
  const { row, type } = target;
  const candidates = [];
  for (let radius = 1; radius <= 12; radius++) {
    for (let x = row.x - radius; x <= row.x + radius; x++) {
      for (let z = row.z - radius; z <= row.z + radius; z++) {
        if (Math.max(Math.abs(x - row.x), Math.abs(z - row.z)) !== radius) continue;
        const start = [row.level, x, z];
        if (!floorTiles.has(tileKey(start)) || map.isMapBlocked(x, z, row.level)) continue;
        candidates.push(start);
      }
    }
  }
  candidates.sort((a, b) =>
    Math.max(Math.abs(b[1] - row.x), Math.abs(b[2] - row.z)) - Math.max(Math.abs(a[1] - row.x), Math.abs(a[2] - row.z)) ||
    Math.abs(b[1] - row.x) + Math.abs(b[2] - row.z) - Math.abs(a[1] - row.x) - Math.abs(a[2] - row.z)
  );
  for (const start of candidates) {
    let route;
    let reached;
    if (target.kind === 'loc') {
      route = map.findPathToLoc(row.level, start[1], start[2], row.x, row.z, 1, type.width, type.length, row.angle, row.shape, type.forceapproach);
      const last = route.at(-1);
      const stand = last === undefined ? start.slice(1) : packedTile(last);
      reached = map.reachedLoc(row.level, stand[0], stand[1], row.x, row.z, type.width, type.length, 1, row.angle, row.shape, type.forceapproach);
      const end = [row.level, ...stand];
      if (!reached || !acceptStand(end) || !floorTiles.has(tileKey(end)) || map.isMapBlocked(end[1], end[2], row.level)) continue;
      const walk = packedWalk(row.level, start.slice(1), stand);
      if (walk) return { start, stand: end, steps: walk.length };
    } else {
      route = map.findPathToEntity(row.level, start[1], start[2], row.x, row.z, 1, type.size, type.size);
      const last = route.at(-1);
      const stand = last === undefined ? start.slice(1) : packedTile(last);
      reached = map.reachedEntity(row.level, stand[0], stand[1], row.x, row.z, type.size, type.size, 1);
      const end = [row.level, ...stand];
      if (!reached || !acceptStand(end) || !floorTiles.has(tileKey(end)) || map.isMapBlocked(end[1], end[2], row.level)) continue;
      const walk = packedWalk(row.level, start.slice(1), stand);
      if (walk) return { start, stand: end, steps: walk.length };
    }
  }
  assert.fail(`no packed-map operable stand for ${target.name} at ${row.coord}`);
}

function nativeNpcTarget(name) {
  const row = nativeNpcRows(name)[0];
  assert(row, `native 377 NPC placement required for ${name}`);
  return { kind: 'npc', name, row, type: types.NpcType.get(row.id) };
}
function nativeLocTarget(name, choose = rows => rows[0]) {
  const row = choose(nativeLocRows(name));
  assert(row, `native packed location placement required for ${name}`);
  const loc = locFor(row);
  return { kind: 'loc', name, row, loc, type: types.LocType.get(row.id) };
}

const reldoTarget = nativeNpcTarget('reldo');
const targetSpecs = {
  cellarWall: nativeLocTarget('lost_tribe_cellar_wall', rows => rows.find(row => row.x < 3220)),
  bookcase: nativeLocTarget('lost_tribe_bookcase'),
  chest: nativeLocTarget('lost_tribe_chest'),
  crate: nativeLocTarget('lost_tribe_crate'),
  swampHole: nativeLocTarget('lost_tribe_hole_2'),
  sigmund: nativeNpcTarget('lost_tribe_sigmund'),
  duke: nativeNpcTarget('duke_of_lumbridge'),
  bob: nativeNpcTarget('bob'),
  hans: nativeNpcTarget('hans'),
  cook: nativeNpcTarget('cook'),
  father: nativeNpcTarget('father_aereck'),
  reldo: reldoTarget,
  bentnoze: nativeNpcTarget('general_bentnoze'),
  wartface: nativeNpcTarget('general_wartface'),
  mistag: nativeNpcTarget('lost_tribe_mistag'),
  kazgar: nativeNpcTarget('lost_tribe_guide')
};
const approaches = Object.fromEntries(Object.entries(targetSpecs).map(([key, target]) => [key, approachFor(
  target, key === 'cellarWall' ? stand => stand[1] < 3220 : () => true
)]));
const cellarEntryApproach = approachFor(targetSpecs.cellarWall, stand => stand[1] < 3220);

function nativeNpcActor(target) {
  const { row, type } = target;
  const existing = [...World.npcs].find(npc => npc.type === row.id && npc.level === row.level && npc.x === row.x && npc.z === row.z);
  if (existing) return existing;
  const actor = new Npc(row.level, row.x, row.z, type.size, type.size, EntityLifeCycle.RESPAWN, World.npcs.next(), type.id, type.blockwalk);
  actor.lastMovement = -100;
  World.addNpc(actor, -1);
  return actor;
}
const actors = Object.fromEntries(Object.entries(targetSpecs)
  .filter(([, target]) => target.kind === 'npc')
  .map(([key, target]) => [key, nativeNpcActor(target)]));

let playerSerial = 0;
function newPlayer(label = 'lost_tribe_test') {
  const serial = ++playerSerial;
  const username37 = BigInt(20000 + serial);
  const hash64 = BigInt(200000 + serial);
  const p = new Player(`${label}_${serial}`, username37, hash64);
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
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = text => p.messages.push(String(text));
  p.getInventory(inv);
  p.getInventory(worn);
  p.getInventory(bank);
  p.setVar(varp('tutorial'), 1000);
  World.players[p.slot] = p;
  World.playerLoop.add(p.hash64, p);
  rsbuf.addPlayer(p.slot);
  return p;
}
function positionAt(p, key, stand = approaches[key].stand) {
  const [level, x, z] = stand;
  p.level = level;
  p.x = x;
  p.z = z;
  p.originX = x;
  p.originZ = z;
  p.buildArea.rebuild();
}
function positionTile(p, [level, x, z]) {
  p.level = level;
  p.x = x;
  p.z = z;
  p.originX = x;
  p.originZ = z;
  p.buildArea.rebuild();
}
function setVar(p, name, value) { p.setVar(varp(name), value); }
function setBit(p, name, value) { p.setVarBit(bit(name), value); }
function setSkill(p, skill, level) {
  p.baseLevels[skill] = level;
  p.levels[skill] = level;
  p.stats[skill] = getExpByLevel(level);
}
const stage = p => p.getVarBit(questBit);
const contact = p => p.getVarBit(contactBit);
const count = (p, name, inventory = inv) => p.invTotal(inventory, obj(name));
function give(p, name, amount = 1, inventory = inv) { p.invAdd(inventory, obj(name), amount); }
function removeItem(p, name, inventory = inv) {
  const items = p.getInventory(inventory);
  const slot = items.getItemIndex(obj(name));
  assert.notEqual(slot, -1, `${name} must be present to remove it`);
  items.set(slot, null);
}
function fillAllInventorySlots(p, name = 'bronze_pickaxe') {
  const items = p.getInventory(inv);
  const slots = [];
  for (let slot = 0; slot < items.capacity; slot++) {
    if (items.items[slot] !== null) continue;
    items.set(slot, { id: obj(name), count: 1 });
    slots.push(slot);
  }
  assert.equal(items.freeSlotCount, 0, 'fixture fills every native inventory slot');
  return slots;
}
function clearInventorySlots(p, slots) {
  const items = p.getInventory(inv);
  for (const slot of slots) items.set(slot, null);
}
function packetText(p, packetStart = 0, messageStart = 0) {
  const packets = p.packets.slice(packetStart).map(packet => packet.text ?? packet.msg ?? '').filter(value => typeof value === 'string');
  return [...packets, ...p.messages.slice(messageStart)].join(' ');
}
function captureScripts(p, action) {
  const states = [];
  const execute = p.executeScript;
  p.executeScript = function(state, ...args) {
    states.push({ state, name: state.script.name });
    return execute.call(this, state, ...args);
  };
  try { action(); } finally { p.executeScript = execute; }
  return states;
}
function finish(p, state, choices = []) {
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 500; step++) {
    if (state.execution === ScriptState.PAUSEBUTTON) {
      p.activeScript = state;
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      if (/^multi[2-5]$/.test(root)) {
        assert(choices.length, `${state.script.name} opened unanswered ${root}`);
        const selected = component(`${root}:com_${choices.shift()}`);
        assert(p.resumeButtons.includes(selected), `${root} offers the selected option`);
        p.lastCom = selected;
        assert.equal(buttonHandler.handle(new IfButton(selected), p), true, `${root} accepts the selected option`);
      } else {
        assert.equal(pauseHandler.handle(new ResumePauseButton(0), p), true, `${state.script.name} continue accepted`);
      }
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else {
      assert.notEqual(state.execution, ScriptState.ABORTED, `${state.script.name} does not abort`);
      assert.fail(`${state.script.name} unexpected execution state ${state.execution}`);
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, `${state.script.name} finishes within the interpreter bound`);
  assert.equal(choices.length, 0, `${state.script.name} consumes every selected dialogue option`);
  return state;
}
function runDirect(p, name) {
  const script = ScriptProvider.getByName(name);
  assert(script, `compiled script missing: ${name}`);
  const state = ScriptRunner.init(script, p);
  p.executeScript(state, true, true);
  return finish(p, state);
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
  assert(rsbuf.hasNpc(p.slot, actor.nid), `${types.NpcType.get(actor.type).debugname} native map NPC is visible`);
}
function talkNpc(p, key, option = 1, choices = []) {
  positionAt(p, key);
  const actor = actors[key];
  showNpc(p, actor);
  const states = captureScripts(p, () => {
    assert.equal(npcHandler.handle(new OpNpc(option, actor.nid), p), true, `${key} option ${option} accepted by the native handler`);
    assert.equal(p.target, actor);
    assert(p.validateTarget(), `${key} target is valid`);
    assert(p.inOperableDistance(actor), `${key} emitted stand tile is operable`);
    const visibleTrigger = p.getOpTrigger();
    assert(visibleTrigger, `${key} operation resolves a visible-form script`);
    assert.match(visibleTrigger.name, new RegExp(`^\\[opnpc${option},`), `${key} operation uses the requested visible option`);
    assert.equal(p.tryInteract(true), true, `${key} visible-form handler executes`);
  });
  const dispatch = states.at(-1);
  assert(dispatch, `${key} uses the engine's selected visible-form handler`);
  finish(p, dispatch.state, choices);
  return dispatch.name;
}
function operateLoc(p, key, option = 1, choices = [], stand = approaches[key].stand) {
  positionAt(p, key, stand);
  const target = targetSpecs[key].loc;
  assert(p.inOperableDistance(target), `${key} emitted stand tile is operable`);
  const states = captureScripts(p, () => {
    assert.equal(locHandler.handle(new OpLoc(option, target.x, target.z, target.type), p), true, `${key} option ${option} accepted by the native handler`);
    assert.equal(p.target, target);
    assert(p.validateTarget(), `${key} target remains a valid native location`);
    const visibleTrigger = p.getOpTrigger();
    assert(visibleTrigger, `${key} operation resolves a visible-form script`);
    assert.match(visibleTrigger.name, new RegExp(`^\\[oploc${option},`), `${key} operation uses the requested visible option`);
    assert.equal(p.tryInteract(true), true, `${key} visible-form handler executes`);
  });
  const dispatch = states.at(-1);
  assert(dispatch, `${key} uses the engine's selected visible-form handler`);
  finish(p, dispatch.state, choices);
  return dispatch.name;
}
function useItemOnLoc(p, usedName, key, stand = approaches[key].stand) {
  positionAt(p, key, stand);
  const target = targetSpecs[key].loc;
  const itemId = obj(usedName);
  const slot = p.getInventory(inv).getItemIndex(itemId);
  assert.notEqual(slot, -1, `${usedName} is carried for Use on ${key}`);
  assert(p.inOperableDistance(target), `${key} emitted stand tile is operable`);
  const states = captureScripts(p, () => {
    assert.equal(locUseHandler.handle(new OpLocU(target.x, target.z, target.type, itemId, slot, invCom), p), true,
      `native Use ${usedName} on ${key} is accepted`);
    assert.equal(p.target, target);
    assert(p.validateTarget(), `${key} remains a valid native location`);
    p.processInteraction();
  });
  const dispatch = states.at(-1);
  assert(dispatch, `native Use ${usedName} on ${key} dispatches a compiled script`);
  assert.match(dispatch.name, /^\[oplocu,/, `${key} selects its visible location-form Use handler`);
  finish(p, dispatch.state);
  return dispatch.name;
}
function itemOption(p, name, action = 1) {
  const itemId = obj(name);
  const itemType = types.ObjType.get(itemId);
  const option = typeof action === 'number' ? action : itemType.iop.indexOf(action) + 1;
  assert(option > 0, `${name} exposes inventory action ${action}`);
  assert(itemType.iop[option - 1] && itemType.iop[option - 1] !== 'hidden', `${name} exposes inventory option ${option}`);
  const slot = p.getInventory(inv).getItemIndex(itemId);
  assert.notEqual(slot, -1, `${name} is carried for option ${option}`);
  const states = captureScripts(p, () => {
    assert.equal(itemHandler.handle(new OpHeld(option, itemId, slot, invCom), p), true, `${name} inventory option ${option} is accepted`);
  });
  const dispatch = states.at(-1);
  assert(dispatch, `${name} option ${option} dispatches a compiled script`);
  finish(p, dispatch.state);
  return dispatch.name;
}
function button(p, name) {
  const id = component(name);
  p.lastCom = id;
  const states = captureScripts(p, () => {
    assert.equal(buttonHandler.handle(new IfButton(id), p), true, `${name} is an accepted visible component`);
  });
  const dispatch = states.at(-1);
  assert(dispatch, `${name} dispatches its compiled button handler`);
  finish(p, dispatch.state);
  return dispatch.name;
}

function nativeGroundRows(name) {
  const itemId = obj(name);
  const out = [];
  for (const file of readdirSync(path.join(content, 'maps')).filter(file => /^m\d+_\d+\.jm2$/.test(file)).sort()) {
    const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(file).map(Number);
    let section = '';
    for (const line of readFileSync(path.join(content, 'maps', file), 'utf8').split(/\r?\n/)) {
      if (line.startsWith('====')) { section = line.split(/\s+/)[1]; continue; }
      if (section !== 'OBJ') continue;
      const match = /^([0-3]) (\d+) (\d+): (\d+) (\d+)/.exec(line);
      if (!match || Number(match[4]) !== itemId) continue;
      const [, level, localX, localZ, , count] = match.map(Number);
      out.push({ level, x: mx * 64 + localX, z: mz * 64 + localZ, count });
    }
  }
  return out;
}
function walkToGround(p, name, from) {
  const itemId = obj(name);
  const options = nativeGroundRows(name).map(row => {
    const item = World.getObj(row.x, row.z, row.level, itemId, p.hash64);
    return item ? { ...row, item, distance: Math.abs(row.x - from[0]) + Math.abs(row.z - from[1]) } : null;
  }).filter(Boolean).sort((a, b) => a.distance - b.distance);
  assert(options.length, `native packed-map ground placement exists for ${name}`);
  for (const row of options) {
    const nearby = [];
    for (let radius = 0; radius <= 3; radius++) {
      for (let x = row.x - radius; x <= row.x + radius; x++) {
        for (let z = row.z - radius; z <= row.z + radius; z++) {
          if (Math.max(Math.abs(x - row.x), Math.abs(z - row.z)) !== radius) continue;
          const tile = [row.level, x, z];
          if (!floorTiles.has(tileKey(tile)) || map.isMapBlocked(x, z, row.level)) continue;
          if (!map.reachedEntity(row.level, x, z, row.x, row.z, 1, 1, 1)) continue;
          const route = packedWalk(row.level, from, [x, z]);
          if (route) nearby.push({ tile, route });
        }
      }
      if (nearby.length) break;
    }
    if (!nearby.length) continue;
    nearby.sort((a, b) => a.route.length - b.route.length);
    const { tile, route } = nearby[0];
    for (const [x, z] of route) positionTile(p, [row.level, x, z]);
    if (route.length === 0) positionTile(p, [row.level, ...tile.slice(1)]);
    assert(p.inOperableDistance(row.item), `${name} native ground object is operable from the packed route`);
    return { row, route };
  }
  assert.fail(`no packed collision route to a native ${name} ground object`);
}
function takeOption(itemId, name) {
  const option = types.ObjType.get(itemId).op.indexOf('Take') + 1;
  assert(option > 0, `${name} has a configured native ground Take option`);
  return option;
}
function takeGround(p, name, from) {
  const { row } = walkToGround(p, name, from);
  const itemId = obj(name);
  const option = takeOption(itemId, name);
  const states = captureScripts(p, () => {
    assert.equal(objHandler.handle(new OpObj(option, row.x, row.z, itemId), p), true, `native Take ${name} is accepted`);
    assert(p.target, `${name} remains the real ground target`);
    p.processInteraction();
  });
  const dispatch = states.at(-1);
  assert(dispatch, `native Take ${name} dispatches the packed ground-item action`);
  finish(p, dispatch.state);
  return dispatch.name;
}

function mazeTrapTiles() {
  return new Set([
    ...nativeLocRows('lost_tribe_trap_floor'),
    ...nativeLocRows('lost_tribe_trap_ceiling'),
    ...nativeLocRows('lost_tribe_trap_pass')
  ].map(row => `${row.level},${row.x},${row.z}`));
}
function compressedWaypoints(pathTiles) {
  if (pathTiles.length < 3) return pathTiles.map(([x, z]) => ({ level: 0, x, z }));
  const points = [pathTiles[0]];
  let lastDirection = [pathTiles[1][0] - pathTiles[0][0], pathTiles[1][1] - pathTiles[0][1]];
  for (let index = 2; index < pathTiles.length; index++) {
    const previous = pathTiles[index - 1];
    const current = pathTiles[index];
    const direction = [current[0] - previous[0], current[1] - previous[1]];
    if (direction[0] !== lastDirection[0] || direction[1] !== lastDirection[1]) points.push(previous);
    lastDirection = direction;
  }
  points.push(pathTiles.at(-1));
  return points.map(([x, z]) => ({ level: 0, x, z }));
}
function assertWalkableAndRouted(tile, label, destination) {
  assert(floorTiles.has(tileKey(tile)), `${label} has packed 377 floor`);
  assert.equal(map.isMapBlocked(tile[1], tile[2], tile[0]), false, `${label} is not blocked by packed collision`);
  const route = packedWalk(tile[0], tile.slice(1), destination.slice(1), new Set(), mapSquareBounds(tile.slice(1), destination.slice(1)));
  assert(route?.length, `${label} has a non-empty packed findPath route to its intended counterpart`);
  return route;
}

function seedPrerequisites(p) {
  setVar(p, 'runemysteries', constant('runemysteries_complete'));
  setVar(p, 'goblinquest', constant('gobdip_complete'));
  setSkill(p, PlayerStat.MINING, 17);
  setSkill(p, PlayerStat.AGILITY, 13);
  setSkill(p, PlayerStat.THIEVING, 13);
  runDirect(p, '[proc,initalltabs]');
}
const contactSeeds = [20024588278460, 20015998343868, 20050358082236, 20041768147644];
function seedForContact(value) {
  assert(Number.isInteger(value) && value >= 0 && value < contactSeeds.length, `contact value ${value} is in 0–3`);
  const seed = contactSeeds[value];
  JavaRandom.setSeed(seed);
  assert.equal(Math.floor(JavaRandom.nextDouble() * 4), value, `dispersed JavaRandom seed selects contact ${value}`);
  return seed;
}
function startAtStage1(p, value) {
  seedPrerequisites(p);
  JavaRandom.setSeed(seedForContact(value));
  talkNpc(p, 'sigmund', 1, [1]);
  assert.equal(stage(p), 1, 'accepting Sigmund starts the quest at stage 1');
  assert.equal(contact(p), value, `Sigmund's production random draw assigns contact ${value}`);
}
function takeGroundAt(p, name) {
  const { x, z, level } = p;
  const itemId = obj(name);
  const option = takeOption(itemId, name);
  const item = World.getObj(x, z, level, itemId, p.hash64);
  assert(item, `${name} is the native ground object at the player's tile`);
  assert(p.inOperableDistance(item), `${name} ground object is operable from the player tile`);
  const states = captureScripts(p, () => {
    assert.equal(objHandler.handle(new OpObj(option, x, z, itemId), p), true, `native Take ${name} is accepted`);
    assert(p.target, `${name} remains the real ground target`);
    p.processInteraction();
  });
  const dispatch = states.at(-1);
  assert(dispatch, `native Take ${name} dispatches the packed ground-item action`);
  finish(p, dispatch.state);
  return dispatch.name;
}

// The audit is fixture-only: map rows and approach coordinates come from the built 377 map.
const mazeEntry = [0, 3222, 9618];
const mistagStand = approaches.mistag.stand;
const traps = mazeTrapTiles();
const mazeRoute = packedWalk(mazeEntry[0], mazeEntry.slice(1), mistagStand.slice(1), traps, mapSquareBounds(mazeEntry.slice(1), mistagStand.slice(1)));
assert(mazeRoute?.length, 'the real packed maze has a safe route from its Lumbridge entrance to Mistag');
for (const [x, z] of mazeRoute) assert(!traps.has(`0,${x},${z}`), 'the selected packed route avoids every placed Lost Tribe trap');
for (const [tile, label, destination] of [
  [[0, 3222, 9618], 'Lumbridge cellar tunnel entry', mistagStand],
  [[0, 3218, 9618], 'west cellar exit', [0, 3217, 9618]],
  [[0, 3224, 9604], 'swamp cave east-side entry', mazeEntry],
  [[0, 3224, 9599], 'swamp cave wrong-turn recovery', [0, 3223, 9598]],
  [[0, 3230, 9610], 'Mistag return landing', [0, 3230, 9611]],
  [[0, 3318, 9615], 'Kazgar Dorgeshuun landing', [0, 3318, 9613]],
  [[0, 3318, 9614], 'treaty-scene Duke stand', [0, 3318, 9613]],
  [[0, 3319, 9614], 'treaty-scene Ur-tag stand', [0, 3318, 9613]],
  [[0, 3320, 9617], 'treaty-scene Sigmund stand', [0, 3318, 9613]]
]) assertWalkableAndRouted(tile, label, destination);
if (process.env.HARNESS_TARGET_AUDIT) {
  const auditApproaches = Object.fromEntries(Object.entries(targetSpecs).map(([key, target]) => {
    const [level, x, z] = approaches[key].stand;
    return [key, {
      stand: { level, x, z },
      target: { id: target.row.id, x: target.row.x, z: target.row.z, level: target.row.level },
      name: target.type.debugname || target.name
    }];
  }));
  const audit = JSON.stringify({ mazeWaypoints: compressedWaypoints(mazeRoute), approaches: auditApproaches });
  if (process.env.HARNESS_TARGET_AUDIT === '1') console.log(audit);
  else writeFileSync(process.env.HARNESS_TARGET_AUDIT, `${audit}\n`);
}

const witnessKeys = ['bob', 'hans', 'cook', 'father'];
for (const [label, invalidate] of [
  ['Rune Mysteries', p => setVar(p, 'runemysteries', 0)],
  ['Goblin Diplomacy', p => setVar(p, 'goblinquest', 0)],
  ['Mining', p => setSkill(p, PlayerStat.MINING, 16)],
  ['Agility', p => setSkill(p, PlayerStat.AGILITY, 12)],
  ['Thieving', p => setSkill(p, PlayerStat.THIEVING, 12)]
]) {
  const gate = newPlayer(`lt_gate_${label.toLowerCase()}`);
  seedPrerequisites(gate);
  invalidate(gate);
  JavaRandom.setSeed(seedForContact(0));
  talkNpc(gate, 'sigmund', 1);
  assert.equal(stage(gate), 0, `Sigmund does not start Lost Tribe without ${label}`);
  assert.equal(contact(gate), 0, `${label} gate does not assign a Lost Tribe contact`);
}

for (let value = 1; value < witnessKeys.length; value++) {
  const candidate = newPlayer(`lt_contact_${value}`);
  startAtStage1(candidate, value);
  const wrongWitness = (value + 1) % witnessKeys.length;
  talkNpc(candidate, witnessKeys[wrongWitness], 1, [1]);
  assert.equal(stage(candidate), 1, `a non-assigned witness ${witnessKeys[wrongWitness]} does not advance contact ${value}`);
  talkNpc(candidate, witnessKeys[value], 1, [1]);
  assert.equal(stage(candidate), 2, `assigned witness ${witnessKeys[value]} advances contact ${value}`);
}

const fallback = name => {
  const player = newPlayer(name);
  seedPrerequisites(player);
  return player;
};
const bobFallback = fallback('lt_fallback_bob');
talkNpc(bobFallback, 'bob', 1, [1]);
assert(packetText(bobFallback).includes('Get yer own!'), 'Bob retains his original quest dialogue when Lost Tribe hook is inactive');
const hansFallback = fallback('lt_fallback_hans');
talkNpc(hansFallback, 'hans', 1, [3]);
assert(packetText(hansFallback).includes('You are in Lumbridge Castle.'), 'Hans retains his original location dialogue when Lost Tribe hook is inactive');
const cookFallback = fallback('lt_fallback_cook');
talkNpc(cookFallback, 'cook', 1, [1, 1]);
assert.equal(cookFallback.getVar(varp('cookquest')), 1, 'Cook retains the existing Cook’s Assistant start path');
const fatherFallback = fallback('lt_fallback_father');
setVar(fatherFallback, 'prieststart', priestConstant('priest_not_started'));
talkNpc(fatherFallback, 'father', 1, [3]);
assert.equal(fatherFallback.getVar(varp('prieststart')), priestConstant('priest_started'), 'Father Aereck retains the existing Restless Ghost start path');
const generalFallback = fallback('lt_fallback_general');
talkNpc(generalFallback, 'bentnoze', 1);
assert(packetText(generalFallback).includes('Yep, we bored now.'), 'Bentnoze retains the completed Goblin Diplomacy dialogue when Lost Tribe hook is inactive');
const fatherProgressStart = fatherFallback.packets.length;
talkNpc(fatherFallback, 'father', 1);
assert(packetText(fatherFallback, fatherProgressStart).includes("I can't find Father Urhney"), 'Father retains the Restless Ghost in-progress branch');
const dukeRunes = fallback('lt_fallback_rune_mysteries');
setVar(dukeRunes, 'runemysteries', 0);
talkNpc(dukeRunes, 'duke', 1, [1, 1]);
assert(dukeRunes.getVar(varp('runemysteries')) > 0, 'Duke retains the Rune Mysteries start write');
assert.equal(count(dukeRunes, 'air_talisman'), 1, 'Duke gives the Rune Mysteries talisman');
const dukeDragon = fallback('lt_fallback_dragon');
setVar(dukeDragon, 'dragonquest', constant('dragon_complete'));
talkNpc(dukeDragon, 'duke', 1, [1]);
assert.equal(count(dukeDragon, 'antidragonbreathshield'), 1, 'Duke retains the Dragon Slayer shield branch');
const bobShop = fallback('lt_fallback_bob_shop');
talkNpc(bobShop, 'bob', 1, [2]);
assert(bobShop.modalMain >= 0, 'Bob opens the existing shop interface');
const bobRepair = fallback('lt_fallback_bob_repair');
talkNpc(bobRepair, 'bob', 1, [3]);
assert(packetText(bobRepair).includes("Just hand me the item"), 'Bob retains the repair dialogue choice');
const arrav = fallback('lt_fallback_arrav');
talkNpc(arrav, 'reldo', 1, [1]);
assert(arrav.getVar(varp('phoenixgang')) > 0, 'Reldo retains the Shield of Arrav start write');
assert(packetText(arrav).includes("The Shield of Arrav"), 'Reldo directs the player to the original Arrav book');
const sword = fallback('lt_fallback_squire');
setVar(sword, 'squire', 1);
talkNpc(sword, 'reldo', 1, [4]);
assert.equal(sword.getVar(varp('squire')), 2, 'Reldo retains the Knight’s Sword Imcando stage write');
const wartfaceFallback = fallback('lt_fallback_wartface');
talkNpc(wartfaceFallback, 'wartface', 1);
assert(packetText(wartfaceFallback).includes('Yep, we bored now.'), 'Wartface retains the shared completed Goblin Diplomacy branch');
const rfd = fallback('lt_fallback_rfd');
setVar(rfd, 'cookquest', constant('cook_complete'));
talkNpc(rfd, 'cook', 1, [1, 2, 1, 1]);
assert.equal(rfd.getVarBit(bit('hundred_main_quest_var')), 1, 'Cook retains the Another Cook’s Quest start write');
assert.equal(count(rfd, 'coins'), 100, 'the existing RFD opener still pays its expenses');
const ordinaryEmote = fallback('lt_fallback_wave');
button(ordinaryEmote, 'controls:com_15');
assert(ordinaryEmote.animId >= 0, 'the ordinary Wave button still starts an animation');
assert.equal(stage(ordinaryEmote), 0, 'ordinary Wave does not start Lost Tribe');
assert.equal(contact(ordinaryEmote), 0, 'ordinary Wave does not greet Mistag');
button(ordinaryEmote, 'controls:com_76');
assert.equal(stage(ordinaryEmote), 0, 'locked Goblin Bow does not start Lost Tribe');
assert.equal(contact(ordinaryEmote), 0, 'locked Goblin Bow does not greet Mistag');

const phase = newPlayer('lt_phase_reldo');
seedPrerequisites(phase);
phase.setVarBit(questBit, 4);
phase.setVarBit(contactBit, 1);
give(phase, 'lost_tribe_brooch');
talkNpc(phase, 'duke', 1, [1]);
assert.equal(stage(phase), 5, 'the Duke advances a brooch-carrying stage-4 player to stage 5');
assert.equal(contact(phase), 0, 'the stage-4 witness assignment is cleared before Reldo owns the contact bit');
operateLoc(phase, 'bookcase', 1);
assert.equal(count(phase, 'lost_tribe_book'), 0, 'the west bookcase does not issue a book before Reldo identifies the brooch');
talkNpc(phase, 'reldo', 1, [1]);
assert.equal(contact(phase), 1, 'Reldo enables the bookcase in the new investigation phase');
operateLoc(phase, 'bookcase', 1);
assert.equal(count(phase, 'lost_tribe_book'), 1, 'Reldo-enabled bookcase issues the book');
itemOption(phase, 'lost_tribe_book', 'Read');
assert.equal(stage(phase), 6, 'the Reldo-authorized book advances stage 5 to stage 6');
talkNpc(phase, 'wartface', 1, [1]);
assert.equal(stage(phase), 7, 'Wartface also teaches the Lost Tribe emotes');
button(phase, 'controls:com_77');
assert(phase.animId >= 0, 'the learned Goblin Dance starts its native animation');
assert.equal(contact(phase), 0, 'Goblin Dance is not the Mistag greeting');
button(phase, 'controls:com_76');
assert.equal(contact(phase), 0, 'Goblin Bow far from Mistag does not record a greeting');
talkNpc(phase, 'mistag', 1);
assert.equal(stage(phase), 7, 'Mistag does not advance an ungreeted player');

const p = newPlayer();
seedPrerequisites(p);
const miningStart = p.stats[PlayerStat.MINING];
const qpStart = p.getVar(qpVar);

// Start with the real Sigmund menu and seeded, independently complete prerequisites.
JavaRandom.setSeed(seedForContact(0));
talkNpc(p, 'sigmund', 1, [1]);
assert.equal(stage(p), 1, 'accepting Sigmund starts the quest at stage 1');
assert.equal(contact(p), 0, 'the real random(4) assignment selects contact 0 for this deterministic fixture');

// The selected witness and Duke gates write the next stages through native NPC dispatch.
talkNpc(p, 'hans', 1, [1]);
assert.equal(stage(p), 1, 'a non-assigned witness does not advance contact 0');
talkNpc(p, 'bob', 1, [1]);
assert.equal(stage(p), 2, 'the assigned Lumbridge witness advances to stage 2');
talkNpc(p, 'duke', 1, [1]);
assert.equal(stage(p), 3, 'Duke Horacio sends the player to clear the cellar rubble');

// The player brings a pickaxe and the light/tinderbox required to enter; these are fixture supplies.
give(p, 'bronze_pickaxe');
give(p, 'torch_lit');
give(p, 'tinderbox');
const breachTrigger = useItemOnLoc(p, 'bronze_pickaxe', 'cellarWall');
assert.equal(breachTrigger, '[oplocu,lost_tribe_cellar_hole_blocking]', 'stage 3 resolves the visible blocked-hole form');
assert.equal(stage(p), 4, 'using the pickaxe on the native rubble advances the quest to stage 4');
const tunnelTrigger = operateLoc(p, 'cellarWall', 1);
assert.equal(tunnelTrigger, '[oploc1,lost_tribe_cavewall_hole_walldecor]', 'stage 4 resolves the visible squeeze-through form');
assert.deepEqual([p.level, p.x, p.z], mazeEntry, 'squeezing from the castle side lands at the packed maze entrance');
const swampMazeApproach = approachFor(targetSpecs.swampHole, stand => stand[2] >= 9602);
const swampCaveApproach = approachFor(targetSpecs.swampHole, stand => stand[2] < 9602);
assert(swampMazeApproach.stand[2] >= 9602, 'the native hole has a maze-side approach');
assert(swampCaveApproach.stand[2] < 9602, 'the native hole has a cave-side approach');
const mazeToSwampHole = packedWalk(0, mazeEntry.slice(1), swampMazeApproach.stand.slice(1), traps,
  mapSquareBounds(mazeEntry.slice(1), swampMazeApproach.stand.slice(1)));
assert(mazeToSwampHole?.length, 'the packed maze routes to the diggable swamp hole without crossing it');
for (const [x, z] of mazeToSwampHole) positionTile(p, [0, x, z]);
const swampDigTrigger = useItemOnLoc(p, 'bronze_pickaxe', 'swampHole', swampMazeApproach.stand);
assert.equal(swampDigTrigger, '[oplocu,lost_tribe_hole_2]', 'the original swamp hole dig action is selected');
assert.equal(p.getVarBit(holeDugBit), 1, 'using the pickaxe on the original swamp rubble writes its dug bit');
const swampExitTrigger = operateLoc(p, 'swampHole', 1, [], swampMazeApproach.stand);
assert.equal(swampExitTrigger, '[oploc1,lost_tribe_hole_2]', 'the dug native hole selects its squeeze action');
const swampLanding = [0, 3224, 9599];
assert.deepEqual([p.level, p.x, p.z], swampLanding, 'squeezing from the maze side reaches the packed swamp-cave landing');
const swampClear = [0, 3223, 9598];
const swampEgress = packedWalk(0, swampLanding.slice(1), swampClear.slice(1), new Set(),
  mapSquareBounds(swampLanding.slice(1), swampClear.slice(1)));
assert(swampEgress?.length, 'the swamp-cave landing has a local packed route to independently clear ground');
for (const [x, z] of swampEgress) positionTile(p, [0, x, z]);
assert.deepEqual([p.level, p.x, p.z], swampClear, 'the player follows the local swamp egress without walking through the closed hole');
const returnToHole = packedWalk(0, swampClear.slice(1), swampCaveApproach.stand.slice(1), new Set(),
  mapSquareBounds(swampClear.slice(1), swampCaveApproach.stand.slice(1)));
assert(returnToHole?.length, 'the clear swamp tile routes to the cave-side approach of the dug hole');
for (const [x, z] of returnToHole) positionTile(p, [0, x, z]);
const swampReturnTrigger = operateLoc(p, 'swampHole', 1, [], swampCaveApproach.stand);
assert.equal(swampReturnTrigger, '[oploc1,lost_tribe_hole_2]', 'the cave-side native squeeze action returns through the dug hole');
assert.deepEqual([p.level, p.x, p.z], [0, 3224, 9604], 'the cave-side squeeze returns to the packed tunnel tile');

// Take the real original-map brooch, then return it to Duke and carry it to Reldo.
takeGround(p, 'lost_tribe_brooch', mazeEntry.slice(1));
assert.equal(count(p, 'lost_tribe_brooch'), 1, 'the native tunnel brooch is in inventory');
itemOption(p, 'lost_tribe_brooch', 'Drop');
assert.equal(count(p, 'lost_tribe_brooch'), 0, 'dropping the brooch removes it from inventory');
takeGroundAt(p, 'lost_tribe_brooch');
assert.equal(count(p, 'lost_tribe_brooch'), 1, 'the dropped brooch can be recovered as a real ground item');
talkNpc(p, 'duke', 1, [1]);
assert.equal(stage(p), 5, 'showing the brooch to Duke advances to stage 5');
assert.equal(contact(p), 0, 'Duke clears the expired witness assignment when the investigation phase changes');
talkNpc(p, 'reldo', 1, [1]);
assert.equal(contact(p), 1, 'Reldo identifies the symbol and enables the west-wall bookcase');
const bookFillerSlots = fillAllInventorySlots(p);
operateLoc(p, 'bookcase', 1);
assert.equal(count(p, 'lost_tribe_book'), 0, 'a full inventory receives no book item');
assert(World.getObj(p.x, p.z, p.level, obj('lost_tribe_book'), p.hash64), 'the full-inventory book is placed on the native ground tile');
clearInventorySlots(p, [bookFillerSlots[0]]);
takeGroundAt(p, 'lost_tribe_book');
assert.equal(count(p, 'lost_tribe_book'), 1, 'the full-inventory book can be picked up after a slot opens');
clearInventorySlots(p, bookFillerSlots.slice(1));
itemOption(p, 'lost_tribe_book', 'Drop');
assert.equal(count(p, 'lost_tribe_book'), 0, 'dropping the unread book removes it from inventory');
operateLoc(p, 'bookcase', 1);
assert.equal(count(p, 'lost_tribe_book'), 1, 'the Reldo-enabled bookcase recovers the lost unread book');
itemOption(p, 'lost_tribe_book', 'Read');
assert.equal(stage(p), 6, 'reading the recovered book advances to stage 6');

// Either original General can teach the Dorgeshuun greeting; the real control button then greets Mistag.
talkNpc(p, 'bentnoze', 1, [1]);
assert.equal(stage(p), 7, 'the Goblin Village generals advance the quest to stage 7');
const routeFromEntry = packedWalk(0, mazeEntry.slice(1), mistagStand.slice(1), traps, mapSquareBounds(mazeEntry.slice(1), mistagStand.slice(1)));
assert(routeFromEntry?.length, 'a packed collision path runs from the tunnel entry to Mistag');
for (const [x, z] of routeFromEntry) positionTile(p, [0, x, z]);
assert.deepEqual([p.level, p.x, p.z], mistagStand, 'the fixture follows the actual packed safe route to Mistag');
const bowButton = button(p, 'controls:com_76');
assert.match(bowButton, /^\[if_button,controls:com_76\]$/, 'Goblin Bow is dispatched from its actual emote control');
assert.equal(contact(p), 1, 'the Bow performed within Mistag range writes the greeting contact');
talkNpc(p, 'mistag', 1);
assert.equal(stage(p), 8, 'Mistag advances the greeted player to stage 8');
talkNpc(p, 'duke', 1, [1]);
assert.equal(stage(p), 9, 'reporting the Dorgeshuun meeting moves the quest to stage 9');

// Sigmund's real pickpocket and chest actions record robe evidence before the H.A.M. crate is searched.
talkNpc(p, 'sigmund', 3);
assert.equal(count(p, 'lost_tribe_chest_key'), 1, 'pickpocketing Sigmund yields the chest key');
itemOption(p, 'lost_tribe_chest_key', 'Drop');
assert.equal(count(p, 'lost_tribe_chest_key'), 0, 'dropping the chest key removes it from inventory');
operateLoc(p, 'chest', 1);
assert.equal(p.getVarBit(hamBit), 0, 'the chest stays closed without its key');
talkNpc(p, 'sigmund', 3);
assert.equal(count(p, 'lost_tribe_chest_key'), 1, 'Sigmund can reissue the lost chest key');
useItemOnLoc(p, 'lost_tribe_chest_key', 'chest');
const hamSet = ['ham_hood', 'ham_shirt', 'ham_robe', 'ham_cloak', 'ham_badge', 'ham_gloves', 'ham_boots'];
for (const name of hamSet) assert.equal(count(p, name), 1, `the first chest search yields ${name}`);
assert.equal(p.getVarBit(hamBit), 1, 'the H.A.M. evidence flag is written when the robes are discovered');
operateLoc(p, 'chest', 1);
for (const name of hamSet) assert.equal(count(p, name), 1, `reopening the chest does not duplicate ${name}`);
itemOption(p, 'ham_robe', 'Drop');
assert.equal(count(p, 'ham_robe'), 0, 'the evidence robe can be lost after discovery');
assert.equal(p.getVarBit(hamBit), 1, 'losing the robe does not erase recorded H.A.M. evidence');
talkNpc(p, 'duke', 1, [1]);
assert.equal(p.getVarBit(accusedBit), 1, 'Duke accepts the discovered robe evidence');
operateLoc(p, 'crate', 1);
assert.equal(count(p, 'lost_tribe_silverware'), 1, 'the accused H.A.M. search yields the real silverware');
itemOption(p, 'lost_tribe_silverware', 'Drop');
assert.equal(count(p, 'lost_tribe_silverware'), 0, 'dropping the silverware removes it from inventory');
operateLoc(p, 'crate', 1);
assert.equal(count(p, 'lost_tribe_silverware'), 1, 'the accused crate recovers lost silverware');
talkNpc(p, 'duke', 1, [1]);
assert.equal(stage(p), 10, 'returning the silverware yields the peace treaty at stage 10');
assert.equal(count(p, 'lost_tribe_silverware'), 0, 'Duke takes the silverware');
assert.equal(count(p, 'lost_tribe_treaty'), 1, 'Duke gives the peace treaty');
itemOption(p, 'lost_tribe_treaty', 'Drop');
assert.equal(count(p, 'lost_tribe_treaty'), 0, 'dropping the treaty removes it from inventory');
talkNpc(p, 'duke', 1, [1]);
assert.equal(count(p, 'lost_tribe_treaty'), 1, 'Duke reissues the lost stage-10 treaty');

const treatyReadyVars = p.vars.slice();
// Mistag's treaty meeting commits stage 11 before the once-only rewards and completion scroll.
const completionPacketStart = p.packets.length;
talkNpc(p, 'mistag', 1);
assert.equal(stage(p), completeStage, 'the finished treaty scene writes the original completion stage');
assert.equal(count(p, 'lost_tribe_treaty'), 0, 'the signed treaty is consumed');
assert.equal(p.getVar(qpVar) - qpStart, 1, 'completion awards exactly one quest point');
assert.equal(p.stats[PlayerStat.MINING] - miningStart, 30000, 'completion awards exactly 3,000 Mining XP');
assert.equal(count(p, 'ring_of_life'), 1, 'completion grants one Ring of Life');
assert.equal(p.modalMain, component('questscroll_death'), 'completion opens the actual quest-completion modal');
assert.equal(p.refreshModal, true, 'the native scroll open is queued for NetworkPlayer.encodeOut');
assert(packetText(p, completionPacketStart).includes('You have completed The Lost Tribe!'), 'completion writes the quest-specific scroll title');
p.closeModal();
const journalPacketStart = p.packets.length;
const journalTrigger = button(p, 'questlist:lost_tribe');
assert.match(journalTrigger, /^\[if_button,questlist:lost_tribe\]$/, 'the completed quest journal is opened by its actual control');
assert(packetText(p, journalPacketStart).includes('QUEST COMPLETE!'), 'the native quest journal reports completion');
p.closeModal();
talkNpc(p, 'mistag', 1, [1]);
assert.deepEqual([p.level, p.x, p.z], [0, 3230, 9610], 'completed Mistag guides the player to the original return landing');
talkNpc(p, 'kazgar', 1, [1]);
assert.deepEqual([p.level, p.x, p.z], [0, 3318, 9615], 'completed Kazgar guides the player back to Dorgeshuun');
give(p, 'iron_ore', 2);
give(p, 'silver_ore');
const salePacketStart = p.packets.length;
const saleMessageStart = p.messages.length;
talkNpc(p, 'mistag', 1, [2, 1]);
assert(packetText(p, salePacketStart, saleMessageStart).includes('86 coins'), 'Mistag quotes 13 coins per iron and 60 per silver ore');
assert.equal(count(p, 'iron_ore'), 0, 'postquest ore sale consumes the carried iron ore');
assert.equal(count(p, 'silver_ore'), 0, 'postquest ore sale consumes the carried silver ore');
assert.equal(count(p, 'coins'), 86, 'postquest ore sale pays the exact candidate price');
talkNpc(p, 'mistag', 1, [3]);
assert.equal(count(p, 'lost_tribe_brooch'), 0, 'returning the brooch consumes it');
assert.equal(p.getVarBit(returnedBroochBit), 1, 'Mistag records the once-only brooch return');
assert.equal(count(p, 'cave_goblin_mining_helmet_unlit'), 1, 'Mistag gives the mining helmet');
talkNpc(p, 'mistag', 1, [3]);
assert.equal(count(p, 'cave_goblin_mining_helmet_unlit'), 1, 'repeating the brooch choice does not duplicate the helmet');
assert.equal(p.stats[PlayerStat.MINING] - miningStart, 30000, 'postquest interactions do not repeat Mining XP');
assert.equal(p.getVar(qpVar) - qpStart, 1, 'postquest interactions do not repeat the quest point');
assert.equal(count(p, 'ring_of_life'), 1, 'postquest interactions do not repeat the Ring of Life');

const fullReward = fallback('lt_full_reward');
fullReward.vars.set(treatyReadyVars);
give(fullReward, 'lost_tribe_treaty');
fillAllInventorySlots(fullReward);
const fullPickaxeCount = count(fullReward, 'bronze_pickaxe');
const fullMiningStart = fullReward.stats[PlayerStat.MINING];
const fullQpStart = fullReward.getVar(qpVar);
talkNpc(fullReward, 'mistag', 1);
assert.equal(stage(fullReward), completeStage, 'the treaty completes with every inventory slot occupied');
assert.equal(count(fullReward, 'lost_tribe_treaty'), 0, 'the full-inventory treaty is consumed');
assert.equal(count(fullReward, 'ring_of_life'), 1, 'the Ring of Life safely replaces the consumed treaty');
assert.equal(fullReward.getInventory(inv).freeSlotCount, 0, 'the full-inventory completion loses no carried item');
assert.equal(count(fullReward, 'bronze_pickaxe'), fullPickaxeCount, 'full-inventory completion preserves every filler item');
assert.equal(fullReward.stats[PlayerStat.MINING] - fullMiningStart, 30000, 'full-inventory completion gives exactly 3,000 Mining XP');
assert.equal(fullReward.getVar(qpVar) - fullQpStart, 1, 'full-inventory completion gives exactly one quest point');
talkNpc(fullReward, 'mistag', 1, [1]);
talkNpc(fullReward, 'kazgar', 1, [1]);
assert.equal(fullReward.stats[PlayerStat.MINING] - fullMiningStart, 30000, 'full-inventory guide re-interactions cannot repeat XP');
assert.equal(fullReward.getVar(qpVar) - fullQpStart, 1, 'full-inventory guide re-interactions cannot repeat QP');
assert.equal(count(fullReward, 'ring_of_life'), 1, 'full-inventory guide re-interactions cannot repeat the ring');

console.log('RESULT PASS Lost Tribe: owner regressions, prerequisite/contact gates, native 0→11 flow, packed swamp and maze travel, recovery, once-only/full-inventory rewards and postquest access');
process.exit(0);
