// Run from the sibling engine after a full content build. No server is started.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  content, engine, World, Player, Npc, ScriptProvider, ScriptRunner, ScriptState,
  ServerTriggerType, EntityLifeCycle, types, map, nativeLocRows, nativeNpcRows,
  floorTiles, locFor, requiredId
} from '../regicide-travel/runtime.mjs';

const load = async file => (await import(pathToFileURL(path.join(engine, 'src', file)).href)).default;
const Environment = await load('util/Environment.ts');
const { PlayerStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const { getExpByLevel } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/Player.ts')).href);
const { CollisionType } = await import(pathToFileURL(path.join(engine, 'src/engine/routefinder/index.ts')).href);
const rsbuf = await import(pathToFileURL(path.join(engine, 'src/network/rsbuf/index.ts')).href);
const OpNpc = await load('network/game/client/model/OpNpc.ts');
const OpNpcHandler = await load('network/game/client/handler/OpNpcHandler.ts');
const OpLocU = await load('network/game/client/model/OpLocU.ts');
const OpLocUHandler = await load('network/game/client/handler/OpLocUHandler.ts');
const OpHeldU = await load('network/game/client/model/OpHeldU.ts');
const OpHeldUHandler = await load('network/game/client/handler/OpHeldUHandler.ts');
const OpHeld = await load('network/game/client/model/OpHeld.ts');
const OpHeldHandler = await load('network/game/client/handler/OpHeldHandler.ts');
const IfButton = await load('network/game/client/model/IfButton.ts');
const IfButtonHandler = await load('network/game/client/handler/IfButtonHandler.ts');
const ResumePauseButton = await load('network/game/client/model/ResumePauseButton.ts');
const ResumePauseButtonHandler = await load('network/game/client/handler/ResumePauseButtonHandler.ts');

assert.equal(Environment.NODE_MEMBERS, true, 'quest items require the built members configuration');
const varp = name => requiredId(types.VarPlayerType, name);
const bit = name => requiredId(types.VarBitType, name);
const obj = name => requiredId(types.ObjType, name);
const npcType = name => requiredId(types.NpcType, name);
const component = name => requiredId(types.Component, name);
const inv = requiredId(types.InvType, 'inv');
const bank = requiredId(types.InvType, 'bank');
const worn = requiredId(types.InvType, 'worn');
const invCom = component('inventory:inv');
const wornCom = component('wornitems:worn');
const questRow = component('questlist:devious');
const questpoints = varp('qp');
const monkVar = bit('devious_monk');
const altarVar = bit('devious_altar');
const mainVar = bit('devious_main');
const invNpc = new OpNpcHandler();
const invLocUse = new OpLocUHandler();
const invItemUse = new OpHeldUHandler();
const invItemOption = new OpHeldHandler();
const buttonHandler = new IfButtonHandler();
const pauseHandler = new ResumePauseButtonHandler();

const tileKey = tile => `${tile[0]},${tile[1]},${tile[2]}`;
const packedTile = value => [((value >>> 14) & 0x3fff), (value & 0x3fff)];
function packedWalk(level, start, destination) {
  const key = ([x, z]) => `${x},${z}`;
  const queue = [start];
  const previous = new Map([[key(start), null]]);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let next = 0; next < queue.length && !previous.has(key(destination)); next++) {
    const from = queue[next];
    for (const [dx, dz] of directions) {
      const to = [from[0] + dx, from[1] + dz];
      if (Math.max(Math.abs(to[0] - start[0]), Math.abs(to[1] - start[1])) > 32 || previous.has(key(to))) continue;
      if (!map.canTravel(level, from[0], from[1], dx, dz, 1, 0, CollisionType.NORMAL)) continue;
      previous.set(key(to), from);
      queue.push(to);
    }
  }
  if (!previous.has(key(destination))) return null;
  const path = [];
  for (let tile = destination; previous.get(key(tile)); tile = previous.get(key(tile))) path.push(tile);
  return path.reverse();
}

function approachFor(target) {
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
      const width = type.width;
      const length = type.length;
      route = map.findPathToLoc(row.level, start[1], start[2], row.x, row.z, 1, width, length, row.angle, row.shape, type.forceapproach);
      const last = route.at(-1);
      const stand = last === undefined ? start.slice(1) : packedTile(last);
      reached = map.reachedLoc(row.level, stand[0], stand[1], row.x, row.z, width, length, 1, row.angle, row.shape, type.forceapproach);
      if (!reached) continue;
      const end = [row.level, ...stand];
      if (!floorTiles.has(tileKey(end)) || map.isMapBlocked(end[1], end[2], row.level)) continue;
      const walk = packedWalk(row.level, start.slice(1), stand);
      if (walk) return { start, stand: end, steps: walk.length };
    } else {
      const size = type.size;
      route = map.findPathToEntity(row.level, start[1], start[2], row.x, row.z, 1, size, size);
      const last = route.at(-1);
      const stand = last === undefined ? start.slice(1) : packedTile(last);
      reached = map.reachedEntity(row.level, stand[0], stand[1], row.x, row.z, size, size, 1);
      if (!reached) continue;
      const end = [row.level, ...stand];
      if (!floorTiles.has(tileKey(end)) || map.isMapBlocked(end[1], end[2], row.level)) continue;
      const walk = packedWalk(row.level, start.slice(1), stand);
      if (walk) return { start, stand: end, steps: walk.length };
    }
  }
  assert.fail(`no packed collision route to an operable stand for ${target.name} at ${row.coord}`);
}

function nativeNpcTarget(label, name) {
  const row = nativeNpcRows(name)[0];
  assert(row, `native 377 map placement required for ${label} (${name})`);
  return { label, name, kind: 'npc', row, type: types.NpcType.get(requiredId(types.NpcType, name)) };
}
function nativeLocTarget(label, name, choose = rows => rows[0]) {
  const row = choose(nativeLocRows(name));
  assert(row, `native 377 map placement required for ${label} (${name})`);
  const loc = locFor(row);
  return { label, name, kind: 'loc', row, loc, type: types.LocType.get(loc.type) };
}

const targetSpecs = {
  monk: nativeNpcTarget('Monk', 'devious_monk_hooded'),
  whetstone: nativeLocTarget('whetstone', 'devious_whetstone'),
  altar: nativeLocTarget('Entrana altar', 'devious_altar'),
  ordinaryAltar: nativeLocTarget('ordinary altar (wrong-site control)', 'altar', rows => rows.find(row => row.x !== 2853 || row.z !== 3348)),
  highPriest: nativeNpcTarget('High Priest', 'high_priest_of_entrana'),
  deadMonk: nativeNpcTarget('Dead Monk', 'devious_monk_dead'),
  tiffy: nativeNpcTarget('Sir Tiffy', 'rd_teleporter_guy'),
  shipMonk: nativeNpcTarget('Ship Monk', 'shipmonk'),
  lawRift: nativeLocTarget('Abyss Law rift', 'abyss_exit_to_law'),
  lawExit: nativeLocTarget('Law altar exit', 'lawtemple_exit_portal')
};
const approaches = Object.fromEntries(Object.entries(targetSpecs).map(([key, target]) => [key, approachFor(target)]));
console.log('Devious Minds packed approach audit:', JSON.stringify(Object.fromEntries(
  Object.entries(targetSpecs).map(([key, target]) => [target.label, {
    target: `${target.row.level}_${target.row.x}_${target.row.z}`,
    from: `${approaches[key].start[0]}_${approaches[key].start[1]}_${approaches[key].start[2]}`,
    stand: `${approaches[key].stand[0]}_${approaches[key].stand[1]}_${approaches[key].stand[2]}`,
    collisionSteps: approaches[key].steps
  }])
)));

// The copied church must also support every ceremony actor's original-map route.
for (const [x, z, label] of [
  [2851, 3347, 'observer'], [2853, 3347, 'return'],
  [2852, 3346, 'first monk start'], [2853, 3346, 'relic bearer start'],
  [2854, 3346, 'second monk start'], [2855, 3347, 'assassin']
]) {
  assert(floorTiles.has(tileKey([0, x, z])) && !map.isMapBlocked(x, z, 0), `${label} has packed walkable floor`);
}
for (const x of [2852, 2853, 2854]) {
  assert(packedWalk(0, [x, 3346], [x, 3347]), `ceremony monk at ${x} can reach its altar stand`);
}

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
function newPlayer() {
  const serial = ++playerSerial;
  const username37 = BigInt(10000 + serial);
  const hash64 = BigInt(100000 + serial);
  const p = new Player(`devious_test_${serial}`, username37, hash64);
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
  return p;
}
function positionAt(p, key) {
  const [level, x, z] = approaches[key].stand;
  p.level = level;
  p.x = x;
  p.z = z;
  p.originX = x;
  p.originZ = z;
  p.buildArea.rebuild();
}
function setVar(p, name, value) { p.setVar(varp(name), value); }
function setBit(p, name, value) { p.setVarBit(bit(name), value); }
const stage = p => p.getVarBit(mainVar);
const count = (p, name, inventory = inv) => p.invTotal(inventory, obj(name));
function give(p, name, amount = 1, inventory = inv) { p.invAdd(inventory, obj(name), amount); }
function removeItem(p, name, inventory = inv) {
  const items = p.getInventory(inventory);
  const slot = items.getItemIndex(obj(name));
  assert.notEqual(slot, -1, `${name} must be present to remove it`);
  items.set(slot, null);
}
function removeSlot(p, slot) { p.getInventory(inv).set(slot, null); }
function fillInventory(p, name = 'coins') {
  const items = p.getInventory(inv);
  for (let slot = 0; slot < items.capacity; slot++) items.set(slot, { id: obj(name), count: 1 });
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
        assert(choices.length, `${state.script.name} opened unanswered ${root}`);
        const selected = component(`${root}:com_${choices.shift()}`);
        assert(p.resumeButtons.includes(selected), `${root} offers selected option`);
        p.lastCom = selected;
        assert.equal(buttonHandler.handle(new IfButton(selected), p), true, `${root} button accepted`);
      } else {
        assert.equal(pauseHandler.handle(new ResumePauseButton(0), p), true, `${state.script.name} continue accepted`);
      }
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else {
      assert.notEqual(state.execution, ScriptState.ABORTED, `${state.script.name} must not abort`);
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
  assert(rsbuf.hasNpc(p.slot, actor.nid), `original map NPC ${types.NpcType.get(actor.type).debugname} is client-visible`);
}
function startNpc(p, key, expected, option = 1) {
  positionAt(p, key);
  const actor = actors[key];
  showNpc(p, actor);
  const states = captureScripts(p, () => {
    assert.equal(invNpc.handle(new OpNpc(option, actor.nid), p), true, `${key} option ${option} accepted by the client handler`);
    assert.equal(p.target, actor);
    assert(p.validateTarget(), `${key} remains a valid native target`);
    assert(p.inOperableDistance(actor), `${key} emitted stand tile is operable`);
    assert.equal(p.getOpTrigger()?.name, expected, `${key} dispatches its visible form`);
    assert.equal(p.tryInteract(true), true, `${key} selected handler executes`);
  });
  const dispatched = states.at(-1), state = dispatched?.state;
  assert(state, `${expected} was dispatched by the native NPC interaction`);
  assert.equal(dispatched.name, expected, `${key} ran the engine-selected visible-form handler`);
  return state;
}
function startUseOnItem(p, usedName, targetName, expected) {
  const items = p.getInventory(inv);
  const usedId = obj(usedName);
  const targetId = obj(targetName);
  const usedSlot = items.getItemIndex(usedId);
  const targetSlot = items.getItemIndex(targetId);
  assert.notEqual(usedSlot, -1, `${usedName} is carried`);
  assert.notEqual(targetSlot, -1, `${targetName} is carried`);
  const states = captureScripts(p, () => {
    assert.equal(invItemUse.handle(new OpHeldU(targetId, targetSlot, invCom, usedId, usedSlot, invCom), p), true,
      `native Use ${usedName} on ${targetName} is accepted`);
  });
  const dispatched = states.at(-1), state = dispatched?.state;
  assert(state, `packed item-use dispatch exists for ${usedName} on ${targetName}`);
  assert.equal(dispatched.name, expected, `${usedName} on ${targetName} selects the packed handler`);
  finish(p, state);
  return state;
}
function startItemOption(p, name, option) {
  const items = p.getInventory(inv);
  const itemId = obj(name);
  const slot = items.getItemIndex(itemId);
  assert.notEqual(slot, -1, `${name} is carried for option ${option}`);
  const states = captureScripts(p, () => {
    assert.equal(invItemOption.handle(new OpHeld(option, itemId, slot, invCom), p), true, `${name} option ${option} is accepted`);
  });
  const state = states.at(-1)?.state;
  assert(state, `packed inventory option ${option} dispatch exists for ${name}`);
  finish(p, state);
  return state;
}
function startUseOnLoc(p, usedName, key, expected) {
  positionAt(p, key);
  const target = targetSpecs[key].loc;
  const usedId = obj(usedName);
  const slot = p.getInventory(inv).getItemIndex(usedId);
  assert.notEqual(slot, -1, `${usedName} is carried for use on ${key}`);
  assert(p.inOperableDistance(target), `${key} emitted stand tile is an operable approach`);
  const states = captureScripts(p, () => {
    assert.equal(invLocUse.handle(new OpLocU(target.x, target.z, target.type, usedId, slot, invCom), p), true,
      `native Use ${usedName} on ${key} is accepted`);
    assert.equal(p.target, target);
    assert(p.validateTarget(), `${key} remains a valid native location`);
    p.processInteraction();
  });
  const dispatched = states.at(-1), state = dispatched?.state;
  assert(state, `native Use ${usedName} on ${key} dispatches a compiled script`);
  assert.equal(dispatched.name, expected, `${key} resolves the visible location-form handler`);
  return state;
}
function assertQuestColour(p, value) {
  const mark = p.packets.length;
  runDirect(p, '[proc,update_questlist]');
  const packet = p.packets.slice(mark).filter(packet => packet.constructor.name === 'IfSetColour' && packet.component === questRow).at(-1);
  assert(packet, `quest-list refresh emits Devious Minds colour at stage ${value}`);
  const expected = value === 0 ? 31 << 10 : value >= 80 ? 31 << 5 : (31 << 10) | (31 << 5);
  assert.equal(packet.colour, expected, `stage ${value} has the expected red/yellow/green colour`);
}
function configurePrerequisites(p) {
  setBit(p, 'wanted_main', 11);
  setVar(p, 'troll_quest', 50);
  setVar(p, 'doricquest', 100);
  setVar(p, 'abyssal_miniquest', 4);
  setBit(p, 'rd_main', 2);
}

const p = newPlayer();
configurePrerequisites(p);
positionAt(p, 'monk');
setBit(p, 'devious_main', 0);
setBit(p, 'devious_altar', 0);
setBit(p, 'devious_monk', 0);
assertQuestColour(p, 0);

// Existing High Priest, Tiffy and ferry conversation routes remain reachable
// when Devious Minds has not started and carries none of its delivery items.
{
  const start = p.packets.length, messageStart = p.messages.length;
  finish(p, startNpc(p, 'highPriest', '[opnpc1,high_priest_of_entrana]'));
  const output = packetText(p, start, messageStart);
  assert(output.includes('Many greetings. Welcome to our fair island.'), 'pre-quest High Priest greeting remains in the shared handler');
  assert(!output.includes('Someone just stole our relic'), 'pre-quest High Priest does not enter Devious Minds dialogue');
  assert.equal(stage(p), 0);
  assert.equal(p.getVarBit(monkVar), 0);
}
{
  const start = p.packets.length, messageStart = p.messages.length;
  finish(p, startNpc(p, 'tiffy', '[opnpc1,rd_teleporter_guy]'), [5]);
  const output = packetText(p, start, messageStart);
  assert(output.includes('What ho,'), 'pre-quest Tiffy still offers the ordinary Wanted/Temple Knights route');
  assert.equal(stage(p), 0);
}
{
  positionAt(p, 'shipMonk');
  const before = [p.level, p.x, p.z];
  const start = p.packets.length, messageStart = p.messages.length;
  finish(p, startNpc(p, 'shipMonk', '[opnpc1,shipmonk]'), [1]);
  const output = packetText(p, start, messageStart);
  assert(output.includes('Do you seek passage to holy Entrana?'), 'Ship Monk normal passage offer remains available without Devious items');
  assert.deepEqual([p.level, p.x, p.z], before, 'declining ordinary passage is non-destructive');
  assert.equal(stage(p), 0);
}

for (const [label, mutate, restore] of [
  ['Wanted!', () => setBit(p, 'wanted_main', 10), () => setBit(p, 'wanted_main', 11)],
  ['Troll Stronghold', () => setVar(p, 'troll_quest', 49), () => setVar(p, 'troll_quest', 50)],
  ["Doric's Quest", () => setVar(p, 'doricquest', 99), () => setVar(p, 'doricquest', 100)],
  ['Enter the Abyss', () => setVar(p, 'abyssal_miniquest', 3), () => setVar(p, 'abyssal_miniquest', 4)],
  ['current Smithing', () => { p.levels[PlayerStat.SMITHING] = 64; }, () => { p.levels[PlayerStat.SMITHING] = 99; }],
  ['current Fletching', () => { p.levels[PlayerStat.FLETCHING] = 49; }, () => { p.levels[PlayerStat.FLETCHING] = 99; }],
  ['base Runecrafting', () => { p.baseLevels[PlayerStat.RUNECRAFT] = 49; }, () => { p.baseLevels[PlayerStat.RUNECRAFT] = 99; }]
]) {
  mutate();
  finish(p, startNpc(p, 'monk', '[opnpc1,devious_monk_hooded_visable]'));
  assert.equal(stage(p), 0, `${label} prerequisite refusal leaves Devious Minds unstarted`);
  restore();
}

// Wrong-stage item actions do not consume materials before the Monk starts the quest.
give(p, 'mithril_2h_sword');
finish(p, startUseOnLoc(p, 'mithril_2h_sword', 'whetstone', '[oplocu,devious_whetstone]'));
assert.equal(count(p, 'mithril_2h_sword'), 1, 'whetstone refuses before stage 1');
give(p, 'devious_glowingorb');
give(p, 'rcu_pouch_large');
startUseOnItem(p, 'devious_glowingorb', 'rcu_pouch_large', '[opheldu,rcu_pouch_large]');
assert.equal(count(p, 'devious_glowingorb'), 1, 'orb is retained before the delivery stage');
assert.equal(count(p, 'rcu_pouch_large'), 1, 'large pouch is retained before the delivery stage');
removeItem(p, 'mithril_2h_sword');
removeItem(p, 'devious_glowingorb');
removeItem(p, 'rcu_pouch_large');

// Declining does not start; accepting writes exactly the crafting stage.
finish(p, startNpc(p, 'monk', '[opnpc1,devious_monk_hooded_visable]'), [2]);
assert.equal(stage(p), 0, 'declining the Monk leaves the quest unstarted');
finish(p, startNpc(p, 'monk', '[opnpc1,devious_monk_hooded_visable]'), [1]);
assert.equal(stage(p), 1, 'accepting the Monk starts the crafting stage');
assertQuestColour(p, 1);

// Smithing is current-level gated before the menu and rechecked after its yield.
give(p, 'mithril_2h_sword');
p.levels[PlayerStat.SMITHING] = 64;
finish(p, startUseOnLoc(p, 'mithril_2h_sword', 'whetstone', '[oplocu,devious_whetstone]'));
assert.equal(count(p, 'mithril_2h_sword'), 1, 'Smithing 64 refuses the whetstone action');
assert.equal(count(p, 'devious_slenderblade'), 0);
p.levels[PlayerStat.SMITHING] = 65;
finish(p, startUseOnLoc(p, 'mithril_2h_sword', 'whetstone', '[oplocu,devious_whetstone]'), [2]);
assert.equal(count(p, 'mithril_2h_sword'), 1, 'declining the grind preserves the sword');
const recheckSmithing = startUseOnLoc(p, 'mithril_2h_sword', 'whetstone', '[oplocu,devious_whetstone]');
assert.equal(recheckSmithing.execution, ScriptState.PAUSEBUTTON, 'whetstone confirmation yields to the player');
p.levels[PlayerStat.SMITHING] = 64;
finish(p, recheckSmithing, [1]);
assert.equal(count(p, 'mithril_2h_sword'), 1, 'Smithing is rechecked after confirmation');
assert.equal(count(p, 'devious_slenderblade'), 0, 'a late level drop creates no blade');
p.levels[PlayerStat.SMITHING] = 65;
finish(p, startUseOnLoc(p, 'mithril_2h_sword', 'whetstone', '[oplocu,devious_whetstone]'), [1]);
assert.equal(count(p, 'mithril_2h_sword'), 0, 'successful grind consumes the mithril two-hander');
assert.equal(count(p, 'devious_slenderblade'), 1, 'successful grind creates the slender blade');

// Both bow-string directions dispatch through their real packed item handlers.
give(p, 'bow_string');
p.levels[PlayerStat.FLETCHING] = 49;
startUseOnItem(p, 'bow_string', 'devious_slenderblade', '[opheldu,devious_slenderblade]');
assert.equal(count(p, 'devious_slenderblade'), 1, 'Fletching 49 does not consume the blade');
assert.equal(count(p, 'bow_string'), 1, 'Fletching 49 does not consume the string');
p.levels[PlayerStat.FLETCHING] = 50;
startUseOnItem(p, 'bow_string', 'devious_slenderblade', '[opheldu,devious_slenderblade]');
assert.equal(count(p, 'devious_slenderblade'), 0);
assert.equal(count(p, 'bow_string'), 0);
assert.equal(count(p, 'devious_bowsword'), 1);
give(p, 'devious_slenderblade');
give(p, 'bow_string');
startUseOnItem(p, 'devious_slenderblade', 'bow_string', '[opheldu,bow_string]');
assert.equal(count(p, 'devious_slenderblade'), 0, 'reverse bow-string use consumes the slender blade');
assert.equal(count(p, 'bow_string'), 0, 'reverse bow-string use consumes one string');
assert.equal(count(p, 'devious_bowsword'), 2, 'both directions create the bow-sword');

// Returning the bow-sword through the visible Monk dispatch advances to delivery.
finish(p, startNpc(p, 'monk', '[opnpc1,devious_monk_hooded_visable]'), [2, 2, 1]);
assert.equal(stage(p), 10, 'bow-sword handover advances to orb delivery');
assert.equal(count(p, 'devious_bowsword'), 1, 'one bow-sword is handed over');
assert.equal(count(p, 'devious_glowingorb'), 1, 'the Monk gives one orb');
assertQuestColour(p, 10);

// The delivery Monk respects carried/banked copies and refuses recovery at full capacity.
finish(p, startNpc(p, 'monk', '[opnpc1,devious_monk_hooded_visable]'));
assert.equal(count(p, 'devious_glowingorb'), 1, 'a carried orb is not duplicated');
removeItem(p, 'devious_glowingorb');
give(p, 'devious_glowingorb', 1, bank);
finish(p, startNpc(p, 'monk', '[opnpc1,devious_monk_hooded_visable]'));
assert.equal(count(p, 'devious_glowingorb'), 0, 'a banked orb is not replaced');
removeItem(p, 'devious_glowingorb', bank);
give(p, 'devious_glowingpouch', 1, bank);
finish(p, startNpc(p, 'monk', '[opnpc1,devious_monk_hooded_visable]'));
assert.equal(count(p, 'devious_glowingorb'), 0, 'a banked glowing pouch is not replaced');
removeItem(p, 'devious_glowingpouch', bank);
fillInventory(p);
assert.equal(p.getInventory(inv).freeSlotCount, 0, 'delivery recovery fixture is exactly full');
finish(p, startNpc(p, 'monk', '[opnpc1,devious_monk_hooded_visable]'));
assert.equal(count(p, 'devious_glowingorb'), 0, 'full inventory never loses an orb replacement');
assert.equal(stage(p), 10, 'full inventory leaves delivery retryable');
removeSlot(p, p.getInventory(inv).capacity - 1);
finish(p, startNpc(p, 'monk', '[opnpc1,devious_monk_hooded_visable]'));
assert.equal(count(p, 'devious_glowingorb'), 1, 'freeing one slot permits orb recovery');

// The shared ferry refusal runs before the old equipment gate and keeps the orb.
{
  positionAt(p, 'shipMonk');
  const before = [p.level, p.x, p.z];
  const start = p.packets.length, messageStart = p.messages.length;
  finish(p, startNpc(p, 'shipMonk', '[opnpc1,shipmonk]'), [2]);
  const output = packetText(p, start, messageStart);
  assert(output.includes("What's this pouch?"), 'Ship Monk recognizes the Devious delivery item');
  assert.deepEqual([p.level, p.x, p.z], before, 'caught carrier is not transported to Entrana');
  assert.equal(count(p, 'devious_glowingorb'), 1, 'the ferry refusal keeps the orb');
  assert.equal(stage(p), 10);
}

// A degraded pouch, a low base RC level or stored essence cannot consume either item.
removeSlot(p, 0);
give(p, 'rcu_pouch_large_degrade');
startUseOnItem(p, 'devious_glowingorb', 'rcu_pouch_large_degrade', '[opheldu,devious_glowingorb]');
assert.equal(count(p, 'devious_glowingorb'), 1, 'degraded pouch is refused in orb-first direction');
assert.equal(count(p, 'rcu_pouch_large_degrade'), 1);
startUseOnItem(p, 'rcu_pouch_large_degrade', 'devious_glowingorb', '[opheldu,devious_glowingorb]');
assert.equal(count(p, 'devious_glowingorb'), 1, 'degraded pouch is refused in pouch-first direction');
assert.equal(count(p, 'rcu_pouch_large_degrade'), 1);
removeItem(p, 'rcu_pouch_large_degrade');
give(p, 'rcu_pouch_large');
p.baseLevels[PlayerStat.RUNECRAFT] = 49;
startUseOnItem(p, 'devious_glowingorb', 'rcu_pouch_large', '[opheldu,rcu_pouch_large]');
assert.equal(count(p, 'devious_glowingorb'), 1, 'base Runecrafting 49 preserves the orb');
assert.equal(count(p, 'rcu_pouch_large'), 1, 'base Runecrafting 49 preserves the healthy pouch');
p.baseLevels[PlayerStat.RUNECRAFT] = 50;
setBit(p, 'large_essence_pouch', 1);
startUseOnItem(p, 'devious_glowingorb', 'rcu_pouch_large', '[opheldu,rcu_pouch_large]');
assert.equal(count(p, 'devious_glowingorb'), 1, 'stored essence is not destroyed by pouch conversion');
assert.equal(count(p, 'rcu_pouch_large'), 1);
setBit(p, 'large_essence_pouch', 0);

// Healthy pouch conversion works both ways; Fill and Check are non-destructive and Empty reverses it.
startUseOnItem(p, 'devious_glowingorb', 'rcu_pouch_large', '[opheldu,rcu_pouch_large]');
assert.equal(count(p, 'devious_glowingorb'), 0);
assert.equal(count(p, 'rcu_pouch_large'), 0);
assert.equal(count(p, 'devious_glowingpouch'), 1);
{
  positionAt(p, 'shipMonk');
  const before = [p.level, p.x, p.z], start = p.packets.length, messageStart = p.messages.length;
  finish(p, startNpc(p, 'shipMonk', '[opnpc1,shipmonk]'), [2]);
  assert(packetText(p, start, messageStart).includes("What's this pouch?"), 'Ship Monk also refuses the glowing pouch');
  assert.deepEqual([p.level, p.x, p.z], before, 'the glowing-pouch carrier is not transported');
  assert.equal(count(p, 'devious_glowingpouch'), 1, 'the ferry refusal keeps the glowing pouch');
  assert.equal(stage(p), 10);
}
const pouchState = [count(p, 'devious_glowingpouch'), count(p, 'devious_glowingorb'), count(p, 'rcu_pouch_large')];
startItemOption(p, 'devious_glowingpouch', 1);
assert.deepEqual([count(p, 'devious_glowingpouch'), count(p, 'devious_glowingorb'), count(p, 'rcu_pouch_large')], pouchState,
  'Fill does not change the quest pouch or create essence');
startItemOption(p, 'devious_glowingpouch', 3);
assert.deepEqual([count(p, 'devious_glowingpouch'), count(p, 'devious_glowingorb'), count(p, 'rcu_pouch_large')], pouchState,
  'Check does not change the quest pouch or create essence');
startItemOption(p, 'devious_glowingpouch', 2);
assert.equal(count(p, 'devious_glowingpouch'), 0, 'Empty removes the glowing pouch');
assert.equal(count(p, 'devious_glowingorb'), 1, 'Empty returns the orb');
assert.equal(count(p, 'rcu_pouch_large'), 1, 'Empty returns the healthy large pouch');
startUseOnItem(p, 'rcu_pouch_large', 'devious_glowingorb', '[opheldu,devious_glowingorb]');
assert.equal(count(p, 'devious_glowingpouch'), 1, 'reverse healthy-pouch use creates the glowing pouch');
assert.equal(count(p, 'devious_glowingorb'), 0);
assert.equal(count(p, 'rcu_pouch_large'), 0);

// Altar item, site, quest stage and location-form guards all preserve delivery state.
startUseOnLoc(p, 'devious_glowingpouch', 'ordinaryAltar', '[oplocu,altar]');
assert.equal(stage(p), 10, 'ordinary altar is not the Entrana target');
assert.equal(count(p, 'devious_glowingpouch'), 1, 'wrong-site use retains the glowing pouch');
give(p, 'rcu_pouch_large');
startUseOnLoc(p, 'rcu_pouch_large', 'altar', '[oplocu,altar]');
assert.equal(count(p, 'rcu_pouch_large'), 1, 'wrong item is retained at the Entrana altar');
assert.equal(count(p, 'devious_glowingpouch'), 1);
setBit(p, 'devious_main', 1);
startUseOnLoc(p, 'devious_glowingpouch', 'altar', '[oplocu,altar]');
assert.equal(stage(p), 1, 'wrong quest stage cannot start the altar scene');
assert.equal(count(p, 'devious_glowingpouch'), 1);
setBit(p, 'devious_main', 10);
const interrupted = newPlayer();
setBit(interrupted, 'devious_main', 10);
setBit(interrupted, 'devious_altar', 1);
give(interrupted, 'devious_glowingpouch');
const recoveredScene = startUseOnLoc(interrupted, 'devious_glowingpouch', 'altar', '[oplocu,devious_altar_pouch]');
assert.equal(count(interrupted, 'devious_glowingpouch'), 1, 'an interrupted scene retains the delivery until its retry finishes');
finish(interrupted, recoveredScene);
assert.equal(stage(interrupted), 20, 'the pouch-bearing altar form permits recovery after logout interruption');
assert.equal(count(interrupted, 'devious_glowingpouch'), 0, 'the recovered scene consumes the delivery exactly once');

// The real visible altar handler enters its private scene with the pouch intact,
// then consumes it only after the scene returns to the original church exit.
const scene = startUseOnLoc(p, 'devious_glowingpouch', 'altar', '[oplocu,altar]');
assert.notEqual(scene.execution, ScriptState.ABORTED);
assert.equal(stage(p), 10, 'delivery stage is held until the scene completes');
assert.equal(p.getVarBit(altarVar), 1, 'altar morph records the active scene');
assert.equal(count(p, 'devious_glowingpouch'), 1, 'scene interruption can still recover the delivery item');
finish(p, scene);
assert.equal(stage(p), 20, 'completed altar scene advances to High Priest');
assert.equal(p.getVarBit(altarVar), 2, 'completed altar uses its post-scene morph');
assert.equal(count(p, 'devious_glowingpouch'), 0, 'successful altar scene consumes exactly one pouch');
assert.deepEqual([p.level, p.x, p.z], [0, 2853, 3347], 'scene exits at the original Entrana church approach');
assertQuestColour(p, 20);
give(p, 'devious_glowingpouch');
startUseOnLoc(p, 'devious_glowingpouch', 'altar', '[oplocu,devious_altar_scorched]');
assert.equal(stage(p), 20, 'post-scene altar form cannot replay completion');
assert.equal(count(p, 'devious_glowingpouch'), 1, 'post-scene wrong-state use retains the pouch');
removeItem(p, 'devious_glowingpouch');

// Shared High Priest dispatch writes the investigate stage and the dead-Monk morph.
finish(p, startNpc(p, 'highPriest', '[opnpc1,high_priest_of_entrana]'));
assert.equal(stage(p), 30, 'High Priest sends the player to investigate');
assert.equal(p.getVarBit(monkVar), 1, 'High Priest switches the Monk to the dead-monk form');
assertQuestColour(p, 30);
finish(p, startNpc(p, 'deadMonk', '[opnpc1,devious_monk_dead_visable]'));
assert.equal(stage(p), 40, 'Search on the visible Dead Monk records the body');
assert.equal(p.getVarBit(monkVar), 1, 'search preserves the dead-monk morph');
assertQuestColour(p, 40);
finish(p, startNpc(p, 'highPriest', '[opnpc1,high_priest_of_entrana]'));
assert.equal(stage(p), 50, 'returning to the High Priest sends the player to Sir Tiffy');
assertQuestColour(p, 50);

// The unrelated Tiffy choice still reaches Wanted; only the Devious option completes.
runDirect(p, '[proc,update_questpoints]');
const qpBefore = p.getVar(questpoints);
const xpBefore = [PlayerStat.SMITHING, PlayerStat.FLETCHING, PlayerStat.RUNECRAFT].map(stat => p.stats[stat]);
const wantedStart = p.packets.length, wantedMessageStart = p.messages.length;
finish(p, startNpc(p, 'tiffy', '[opnpc1,rd_teleporter_guy]'), [2, 5]);
assert.equal(stage(p), 50, 'choosing Something else does not complete Devious Minds');
assert.equal(p.getVar(questpoints), qpBefore, 'unrelated Tiffy option awards no quest point');
assert.deepEqual([PlayerStat.SMITHING, PlayerStat.FLETCHING, PlayerStat.RUNECRAFT].map(stat => p.stats[stat]), xpBefore,
  'unrelated Tiffy option awards no Devious Minds experience');
assert(packetText(p, wantedStart, wantedMessageStart).includes('What ho,'), 'Something else returns to the ordinary Wanted Tiffy menu');

const completionStart = p.packets.length;
finish(p, startNpc(p, 'tiffy', '[opnpc1,rd_teleporter_guy]'), [1]);
assert.equal(stage(p), 80, 'Sir Tiffy completes Devious Minds at terminal stage 80');
assert.deepEqual([PlayerStat.SMITHING, PlayerStat.FLETCHING, PlayerStat.RUNECRAFT].map(stat => p.stats[stat] - xpBefore[[PlayerStat.SMITHING, PlayerStat.FLETCHING, PlayerStat.RUNECRAFT].indexOf(stat)]),
  [65000, 50000, 50000].map(value => value * Environment.NODE_XPRATE), 'Smithing, Fletching and Runecrafting XP are granted once');
assert.equal(p.getVar(questpoints), qpBefore + 1, 'completion adds exactly one quest point to the existing total');
assert.equal(p.modalMain, component('questscroll_death'), 'completion opens the packed quest scroll');
const completionText = packetText(p, completionStart);
assert(completionText.includes('You have completed Devious Minds.'), 'quest scroll confirms Devious Minds completion');
assert(completionText.includes('6,500 Smithing XP'), 'quest scroll lists the Smithing reward');
assert(completionText.includes('5,000 Fletching XP'), 'quest scroll lists the Fletching reward');
assert(completionText.includes('5,000 Runecrafting XP'), 'quest scroll lists the Runecrafting reward');
assert(completionText.includes('1 Quest Point'), 'quest scroll lists one Quest Point');
assertQuestColour(p, 80);

// Post-completion Tiffy dispatch is back on the shared Wanted route, without replaying rewards.
const completedXp = [PlayerStat.SMITHING, PlayerStat.FLETCHING, PlayerStat.RUNECRAFT].map(stat => p.stats[stat]);
const completedQp = p.getVar(questpoints);
const postTiffyStart = p.packets.length, postTiffyMessageStart = p.messages.length;
finish(p, startNpc(p, 'tiffy', '[opnpc1,rd_teleporter_guy]'), [5]);
assert.equal(stage(p), 80);
assert.deepEqual([PlayerStat.SMITHING, PlayerStat.FLETCHING, PlayerStat.RUNECRAFT].map(stat => p.stats[stat]), completedXp,
  'post-completion Tiffy route cannot duplicate experience');
assert.equal(p.getVar(questpoints), completedQp, 'post-completion Tiffy route cannot duplicate the quest point');
assert(packetText(p, postTiffyStart, postTiffyMessageStart).includes('What ho,'), 'post-completion Tiffy uses the existing Wanted menu');

const postPriestStart = p.packets.length, postPriestMessageStart = p.messages.length;
finish(p, startNpc(p, 'highPriest', '[opnpc1,high_priest_of_entrana]'));
const postPriestText = packetText(p, postPriestStart, postPriestMessageStart);
assert(postPriestText.includes('Many greetings. Welcome to our fair island.'), 'post-completion High Priest resumes his original greeting');
assert(!postPriestText.includes('Someone just stole our relic'), 'post-completion High Priest does not replay the theft');
assert.equal(stage(p), 80, 'post-completion High Priest cannot rewind the quest');

// Once no orb/glowing pouch remains, the original Entrana travel route still works.
const shipStart = p.packets.length, shipMessageStart = p.messages.length;
finish(p, startNpc(p, 'shipMonk', '[opnpc1,shipmonk]'), [2]);
assert(packetText(p, shipStart, shipMessageStart).includes('All is satisfactory.'), 'post-completion Ship Monk permits the normal passage search');
assert.equal(stage(p), 80, 'ordinary Entrana travel does not alter completed Devious Minds');

console.log('RESULT PASS Devious Minds: stage 0→80; prerequisite/level gates; both crafting directions; pouch recovery and state guards; visible altar, High Priest, Dead Monk and Tiffy dispatch; once-only rewards, colours, shared routes, and packed collision approaches.');
process.exit(0);
