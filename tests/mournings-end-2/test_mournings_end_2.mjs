#!/usr/bin/env node
// Product operations use native packet dispatch. Map oracles use retained placements, not quest constants.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  World, PlayerStat, ScriptProvider, ScriptState, ServerTriggerType, contentRoot,
  engineModule, types, map, id, obj, inv, worn, invCom, player, count, slotOf,
  held, use, execute, resumeDialogue, dialoguePage, tick, environmentTick, weakCount, button
} from '../swamp-caves/runtime.mjs';

const load = async name => (await engineModule(name)).default;
const [Npc, ScriptRunner, ScriptPointer, JavaRandom, resolveNpcType,
  OpNpc, OpNpcU, OpLoc, OpLocU, OpNpcHandler, OpNpcUHandler, OpLocHandler, OpLocUHandler] = await Promise.all([
  'engine/entity/Npc.ts', 'engine/script/ScriptRunner.ts', 'engine/script/ScriptPointer.ts',
  'util/JavaRandom.ts', 'engine/entity/resolveNpcType.ts',
  'network/game/client/model/OpNpc.ts', 'network/game/client/model/OpNpcU.ts',
  'network/game/client/model/OpLoc.ts', 'network/game/client/model/OpLocU.ts',
  'network/game/client/handler/OpNpcHandler.ts', 'network/game/client/handler/OpNpcUHandler.ts',
  'network/game/client/handler/OpLocHandler.ts', 'network/game/client/handler/OpLocUHandler.ts'
].map(load));
const { EntityLifeCycle } = await engineModule('engine/entity/EntityLifeCycle.ts');
const { NpcStat } = await engineModule('engine/entity/NpcStat.ts');
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const { Interaction } = await engineModule('engine/entity/Interaction.ts');
const { NpcMode } = await engineModule('engine/entity/NpcMode.ts');
const { MoveSpeed } = await engineModule('engine/entity/MoveSpeed.ts');
const rsbuf = await engineModule('network/rsbuf/index.ts');
const npcHandler = new OpNpcHandler(), npcUseHandler = new OpNpcUHandler();
const locHandler = new OpLocHandler(), locUseHandler = new OpLocUHandler();
const IfSetHide = await load('network/game/server/model/IfSetHide.ts');
const bank = id('InvType', 'bank');
const varp = name => id('VarPlayerType', name);
const stage = p => p.getVarBit(id('VarBitType', 'mourning_quest_main'));
const add = (p, name, amount = 1) => p.invAdd(inv, obj(name), amount);
const del = (p, name, amount = count(p, name)) => p.invDel(inv, obj(name), amount);
const tile = p => [p.level, p.x, p.z];
const actors = new Set(), avatars = new Set();
const approaches = new Map();
let checks = 0;
let originalAlcoveEscapeProven = false;
let originalRedVestibuleEscapeProven = false;
let originalBlueDoorReturnProven = false;
function check(label, action) { action(); checks++; console.log(`PASS ${label}`); }
function fixture(initialStage = 0, items = [], partOne = 8) {
  const p = player(); actors.add(p); rsbuf.addPlayer(p.slot);
  p.setVar(varp('mourning_quest'), partOne);
  p.setVar(varp('mourning_quest_part2'), initialStage);
  // Isolated post-chamber branch fixtures include its original NPC-visibility flag.
  // The end-to-end solver must earn this flag through the real final door.
  if (initialStage >= 40) p.setVar(varp('mourning_part2_basevar2'), 1 << 25);
  for (const item of items) add(p, item);
  return p;
}
function fullInventory(p, name = 'spade') {
  while (p.invFreeSpace(inv) > 0) add(p, name);
  assert.equal(p.invFreeSpace(inv), 0);
}
function emptyInventory(p) {
  for (let slot = 0; slot < types.InvType.get(inv).size; slot++) p.getInventory(inv).set(slot, null);
}
function disguise(p) {
  for (const name of ['gasmask', 'mourning_mourner_top', 'mourning_mourner_legs',
    'mourning_mourner_gloves', 'mourning_mourner_boots', 'mourning_mourner_cloak']) {
    const type = types.ObjType.get(obj(name));
    assert(type.wearpos >= 0);
    p.getInventory(worn).set(type.wearpos, { id: type.id, count: 1 });
  }
}
function arm(p) {
  const weapon = types.ObjType.get(obj('rune_scimitar'));
  p.getInventory(worn).set(weapon.wearpos, { id: weapon.id, count: 1 });
  assert.equal(execute('[proc,player_combat_stat]', p).execution, ScriptState.FINISHED);
}
function place(p, position) {
  p.level = position.level; p.x = position.x; p.z = position.z;
  p.originX = p.x; p.originZ = p.z; p.clearInteraction();
}
function nativeStep(p, destination, running = false) {
  if (running) {
    assert.equal(execute('[proc,update_bas]', p).execution, ScriptState.FINISHED);
    assert.notEqual(p.runanim, -1, 'ordinary native appearance enables the two-step run');
  }
  p.resetEntity(false); p.run = running ? 1 : 0;
  p.queueWaypoint(destination.x, destination.z); p.updateMovement();
  assert.deepEqual(tile(p), [destination.level, destination.x, destination.z], 'native movement reaches the requested doorway tile');
  // The following World player cycle runs timers and the queued zone callback.
  environmentTick(p); finish(p); p.run = 0;
}
function finish(p, choices = []) {
  const pending = [...choices];
  for (let step = 0; step < 240; step++) {
    const state = p.activeScript;
    if (!state) {
      if (weakCount(p) === 0) break;
      tick(p); continue;
    }
    assert.notEqual(state.execution, ScriptState.ABORTED, 'native script does not abort');
    if (state.execution === ScriptState.PAUSEBUTTON) {
      if (p.modalMain === id('Component', 'rotate_mirror')) break;
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      if (/^multi[2-5]$/.test(root)) {
        assert(pending.length, `explicit choice for ${root}: ${dialoguePage(p).join(' ')}`);
        resumeDialogue(p, pending.shift());
      } else resumeDialogue(p);
    } else if (state.execution === ScriptState.SUSPENDED) tick(p);
    else if (state.execution === ScriptState.FINISHED) break;
    else assert.fail(`unexpected execution state ${state.execution}`);
  }
  assert.equal(pending.length, 0, 'every declared choice was offered');
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED
    || (p.activeScript.execution === ScriptState.PAUSEBUTTON && p.modalMain === id('Component', 'rotate_mirror')),
  'operation settles or awaits the real cached Rotate button');
}
function dispatch(p, kind, visible, option = 1) {
  const type = types[`${kind}Type`].get(visible);
  assert(type.op[option - 1], `${type.debugname}: the visible form exposes operation ${option}`);
  const trigger = p.getOpTrigger();
  const direct = ScriptProvider.getByTrigger(ServerTriggerType[`OP${kind.toUpperCase()}${option}`], visible, type.category);
  const base = types[`${kind}Type`].get(p.target.type);
  const native = direct ?? ScriptProvider.getByTrigger(ServerTriggerType[`OP${kind.toUpperCase()}${option}`], base.id, base.category);
  if (!direct) assert(!ScriptProvider.getByTrigger(ServerTriggerType[`AP${kind.toUpperCase()}${option}`], visible, type.category),
    `${type.debugname}: a visible approach handler cannot fall through to its parent`);
  assert(trigger && native, `${type.debugname}: visible form or its authored legacy parent has a native handler`);
  assert.equal(trigger.name, native.name, 'packet dispatch follows native visible-form and legacy-parent resolution');
  p.processInteraction();
}

const names = kind => new Map(fs.readFileSync(path.join(contentRoot, 'pack', `${kind}.pack`), 'utf8')
  .trim().split(/\r?\n/).map(line => { const at = line.indexOf('='); return [Number(line.slice(0, at)), line.slice(at + 1)]; }));
const locNames = names('loc'), npcNames = names('npc');
const locRows = [], npcRows = [], floors = new Set();
for (const file of fs.readdirSync(path.join(contentRoot, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name))) {
  const [mx, mz] = file.slice(1, -4).split('_').map(Number);
  const flags = new Map(); let section = '';
  for (const line of fs.readFileSync(path.join(contentRoot, 'maps', file), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(/\s+/)[1]; continue; }
    const match = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
    if (!match) continue;
    const [, levelText, xText, zText, value] = match;
    const sourceLevel = Number(levelText), lx = Number(xText), lz = Number(zText);
    const x = mx * 64 + lx, z = mz * 64 + lz;
    if (section === 'MAP') {
      flags.set(`${sourceLevel},${lx},${lz}`, Number(/(?:^| )f(\d+)(?: |$)/.exec(value)?.[1] ?? 0));
      if (/(?:^| )(?:u\d+|o-?\d+)(?:[; ]|$)/.test(value)) floors.add(`${sourceLevel},${x},${z}`);
      continue;
    }
    const [type, shape = 10, angle = 0] = value.trim().split(/\s+/).map(Number);
    if (section === 'LOC') {
      const level = sourceLevel - (((flags.get(`1,${lx},${lz}`) ?? 0) & 2) ? 1 : 0);
      if (level >= 0) locRows.push({ name: locNames.get(type), type, level, x, z, shape, angle });
    } else if (section === 'NPC') npcRows.push({ name: npcNames.get(type), type, level: sourceLevel, x, z });
  }
}
function visibleLoc(type, p) {
  const value = type.multivarp !== -1 ? p.getVar(type.multivarp)
    : type.multivarbit !== -1 ? p.getVarBit(type.multivarbit) : -1;
  return value >= 0 && value < type.multiloc.length && type.multiloc[value] !== -1
    ? types.LocType.get(type.multiloc[value]) : type;
}
function stand(p, target, accept = () => true) {
  for (let distance = typeof target.shape === 'number' ? 0 : 1; distance <= 8; distance++) {
    for (let dx = -distance; dx <= distance; dx++) for (let dz = -distance; dz <= distance; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== distance) continue;
      const position = { level: target.level, x: target.x + dx, z: target.z + dz };
      if (!accept(position) || !floors.has(`${position.level},${position.x},${position.z}`)
        || map.isMapBlocked(position.x, position.z, position.level)) continue;
      place(p, position);
      if (p.inOperableDistance(target)) {
        landing(p, target, `original-map operation stand ${target.level},${target.x},${target.z}`);
        const kind = target.nid === undefined ? 'loc' : 'npc';
        const type = types[kind === 'loc' ? 'LocType' : 'NpcType'].get(target.type);
        const visible = kind === 'loc' ? visibleLoc(type, p) : resolveNpcType(type, p);
        const entry = { kind, name: type.debugname, visibleName: visible.debugname, op1: visible.op?.[0] ?? null,
          target: { type: target.type, level: target.level, x: target.x, z: target.z }, stand: position };
        const key = `${kind}:${target.type}:${visible.id}:${target.level}:${target.x}:${target.z}:${Math.sign(dx)}:${Math.sign(dz)}`;
        if (!approaches.has(key)) approaches.set(key, entry);
        return;
      }
    }
  }
  assert.fail(`no original floor with collision-safe operation stand for ${target.type}`);
}
function loc(p, name, predicate = () => true) {
  // Base names select retained placements; the packet and dispatch still use the form the player sees.
  const rows = locRows.filter(row => predicate(row)
    && (row.name === name || visibleLoc(types.LocType.get(row.type), p).debugname === name));
  assert(rows.length, `${name}: visible form derives from an original map placement`);
  const opened = types.LocType.getId(name.replace(/_closed$/, '_open'));
  for (const row of rows) {
    const target = World.getLoc(row.x, row.z, row.level, row.type)
      ?? (opened >= 0 && opened !== row.type ? World.getLoc(row.x, row.z, row.level, opened) : null);
    if (target) return target;
  }
  assert.fail(`${name}: original placement exists in the packed world`);
}
function npc(p, name, fresh = false) {
  const wanted = id('NpcType', name);
  let actor = fresh ? null : [...World.npcs].find(n => n.isActive && resolveNpcType(types.NpcType.get(n.type), p).id === wanted);
  if (!actor) {
    const row = npcRows.find(row => resolveNpcType(types.NpcType.get(row.type), p).id === wanted);
    assert(row, `${name}: original NPC placement`);
    const type = types.NpcType.get(row.type);
    actor = new Npc(row.level, row.x, row.z, type.size, type.size, EntityLifeCycle.RESPAWN,
      World.npcs.next(), type.id, type.blockwalk);
    World.addNpc(actor, -1); avatars.add(actor); actor.lastMovement = -100;
    const spawn = ScriptProvider.getByTrigger(ServerTriggerType.AI_SPAWN, type.id, type.category);
    assert(spawn, `${name}: native spawn handler`);
    const state = ScriptRunner.init(spawn, actor); actor.executeScript(state);
    assert.equal(state.execution, ScriptState.FINISHED);
  }
  return actor;
}
function showNpc(p, n) {
  stand(p, n); rsbuf.addNpc(n.nid, n.type);
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, p.generateAppearance(), p.lastAppearance,
    p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ,
    p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[PlayerStat.HITPOINTS], p.baseLevels[PlayerStat.HITPOINTS], p.animId, p.animDelay,
    p.sayMessage, p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0,
    p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(n.x, n.level, n.z, n.nid, n.type, n.tele, n.jump, n.runDir, n.walkDir,
    n.isActive, n.masks, n.faceEntity, n.faceSquareX, n.faceSquareZ, n.faceAngleX, n.faceAngleZ,
    n.hitmarkDamage, n.hitmarkType, n.hitmark2Damage, n.hitmark2Type,
    n.levels[NpcStat.HITPOINTS], n.baseLevels[NpcStat.HITPOINTS], n.animId, n.animDelay,
    n.sayMessage, n.spotanimId, n.spotanimHeight, n.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, n.nid), 'native encoder exposes the real NPC');
}
function attackNpc(p, n) {
  showNpc(p, n);
  const type = resolveNpcType(types.NpcType.get(n.type), p);
  assert(npcHandler.handle(new OpNpc(2, n.nid), p));
  dispatch(p, 'Npc', type.id, 2); finish(p);
}
function npcAttack(p, n, trigger) {
  const type = types.NpcType.get(n.type);
  const mode = trigger === 'AI_OPPLAYER2' ? NpcMode.OPPLAYER2 : NpcMode.APPLAYER2;
  n.setInteraction(Interaction.SCRIPT, p, mode);
  const native = ScriptProvider.getByTrigger(ServerTriggerType[trigger], type.id, type.category);
  assert(native, `${type.debugname}: native ${trigger}`);
  const state = ScriptRunner.init(native, n, p);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  n.executeScript(state);
  assert.equal(state.execution, ScriptState.FINISHED);
}
function talk(p, name, choices = [], option = 1) {
  const n = npc(p, name); showNpc(p, n);
  const visible = resolveNpcType(types.NpcType.get(n.type), p).id;
  assert(npcHandler.handle(new OpNpc(option, n.nid), p));
  dispatch(p, 'Npc', visible, option); finish(p, choices); return n;
}
function operate(p, name, option = 1, choices = [], predicate, approach) {
  const target = loc(p, name, predicate); stand(p, target, approach);
  const visible = visibleLoc(types.LocType.get(target.type), p).id;
  assert(locHandler.handle(new OpLoc(option, target.x, target.z, target.type), p));
  dispatch(p, 'Loc', visible, option); finish(p, choices); return target;
}
function useLoc(p, name, item, predicate) {
  const target = loc(p, name, predicate); stand(p, target);
  const visible = visibleLoc(types.LocType.get(target.type), p);
  const accepted = locUseHandler.handle(new OpLocU(target.x, target.z, target.type, obj(item), slotOf(p, item), invCom), p);
  if (!accepted) assert.fail(`${name}: native item-use packet refused ${JSON.stringify({
    delayed: p.delayed, origin: [p.originX, p.originZ], target: [target.level, target.x, target.z, target.type, visible.id],
    exists: !!World.getLoc(target.x, target.z, p.level, target.type), usable: types.Component.get(invCom).usable,
    visible: p.isComponentVisible(types.Component.get(invCom)),
    listener: !!p.getInventoryFromListener(p.invListeners.find(row => row.com === invCom))
  })}`);
  const direct = ScriptProvider.getByTrigger(ServerTriggerType.OPLOCU, visible.id, visible.category);
  const base = types.LocType.get(target.type);
  const trigger = direct ?? ScriptProvider.getByTrigger(ServerTriggerType.OPLOCU, base.id, base.category);
  if (!direct) assert(!ScriptProvider.getByTrigger(ServerTriggerType.APLOCU, visible.id, visible.category),
    `${name}: a visible approach handler cannot fall through to its parent`);
  assert(trigger && p.getOpTrigger()?.name === trigger.name, `${name}: native visible-form or authored legacy-parent item-use dispatch`);
  p.processInteraction(); finish(p); return target;
}
function useNpc(p, name, item) {
  const n = npc(p, name); showNpc(p, n);
  const visible = resolveNpcType(types.NpcType.get(n.type), p);
  assert(npcUseHandler.handle(new OpNpcU(n.nid, obj(item), slotOf(p, item), invCom), p));
  const trigger = ScriptProvider.getByTrigger(ServerTriggerType.OPNPCU, visible.id, visible.category);
  assert(trigger && p.getOpTrigger()?.name === trigger.name, `${name}: native NPC item-use dispatch`);
  p.processInteraction(); finish(p); return n;
}
function pillarState(p) {
  return ['varp575_bits', 'varp576_bits', 'varp577_bits', 'varp578_bits', 'mourning_part2_basevar2']
    .map((name, index) => p.getVar(varp(name)) & (index === 4 ? 0x79000000 : -1));
}
function aimPiece(p, name, beams) {
  const aligned = () => Object.entries(beams).every(([suffix, colour]) =>
    p.getVarBit(id('VarBitType', `mourning_light_temple_${suffix}`)) === colour);
  if (aligned()) return;
  operate(p, name, 1, [1]);
  if (p.modalMain === id('Component', 'rotate_mirror')) {
    for (let index = 0; index < 5 && !aligned(); index++) {
      const before = pillarState(p);
      assert(button(p, 'rotate_mirror:com_16'), 'the cached Rotate component dispatches natively');
      finish(p);
      assert.notDeepEqual(pillarState(p), before, 'rotation changes the installed physical piece');
    }
    p.closeModal();
  }
  assert(aligned(), `${name}: native orientations must produce the independently specified cache beam colours`);
}
function takePiece(p, name, item, choice = 2, predicate) {
  const before = count(p, item);
  const target = operate(p, name, 1, [choice], predicate);
  assert.equal(count(p, item), before + 1, 'native Search removal returns the installed piece');
  return target;
}
function landing(p, counterpart, label) {
  assert.equal(p.level, counterpart.level, `${label}: counterpart level`);
  assert(Math.max(Math.abs(p.x - counterpart.x), Math.abs(p.z - counterpart.z)) <= 8,
    `${label}: actual landing is near the original counterpart`);
  assert(floors.has(tile(p).join(',')), `${label}: original floor exists`);
  assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, `${label}: actual landing ${tile(p)} is walkable`);
  if (p.level === 1 && p.x === 1896 && p.z === 4658) {
    const stairs = World.getLoc(1893, 4658, 1, id('LocType', 'mourning_temple_stairs_base'));
    assert(stairs && p.inOperableDistance(stairs), `${label}: the original one-tile alcove immediately reaches its staircase`);
    assert(originalAlcoveEscapeProven, `${label}: its native return climb and non-empty upstairs escape have already passed`);
    return;
  }
  if (p.level === 0 && p.x === 1886 && p.z === 4639) {
    const stairs = World.getLoc(1887, 4638, 0, id('LocType', 'mourning_temple_circle_stairs_base'));
    const route = [...map.findPath(0, p.x, p.z, 1886, 4638)];
    assert(route.length && route.at(-1) === CoordGrid.packCoord(0, 1886, 4638),
      `${label}: the original three-tile vestibule reaches its adjacent stair stand`);
    assert(stairs && p.inOperableDistance(stairs), `${label}: the original circular staircase is immediately operable`);
    assert(originalRedVestibuleEscapeProven, `${label}: the actual vestibule walk, native ascent and upstairs escape have passed`);
    return;
  }
  if (p.level === 1 && p.x === 1911 && p.z === 4613) {
    const door = World.getLoc(1912, 4613, 1, id('LocType', 'mourning_door_2_16_west'));
    assert(door && p.inOperableDistance(door), `${label}: the original west stand immediately reaches its return door`);
    assert.equal(p.getVarBit(id('VarBitType', 'mourning_door_2_16_west')), 1,
      `${label}: the original return door remains genuinely open`);
    assert.equal(visibleLoc(types.LocType.get(door.type), p).debugname, 'mourning_door_of_light_white');
    assert(originalBlueDoorReturnProven, `${label}: native east-west-east passage and the east-side walkable escape have passed`);
    return;
  }
  for (let radius = 2; radius <= 8; radius++) {
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      const x = p.x + dx, z = p.z + dz;
      if (!floors.has(`${p.level},${x},${z}`) || map.isMapBlocked(x, z, p.level)) continue;
      const route = [...map.findPath(p.level, p.x, p.z, x, z)];
      if (route.length && route.at(-1) === CoordGrid.packCoord(p.level, x, z)) {
        console.log(`MAP ${label}: ${tile(p)} -> ${p.level},${x},${z}; ${route.length} waypoints`);
        return;
      }
    }
  }
  assert.fail(`${label}: non-empty packed-map route out`);
}
function integer(name, p, args = []) {
  const state = execute(`[proc,${name}]`, p, args); assert.equal(state.isp, 1); return state.popInt();
}
function dwarfPaid(p, index) {
  // Original all.varbit:6281-6554: three choice pairs, 26 first-word flags, 21 second-word flags.
  const word = p.getVar(varp(index < 29 ? 'varp593_bits' : 'mourning_part2_basevar2'));
  const shift = index < 3 ? index * 2 : index < 29 ? index + 3 : index - 29;
  return index < 3 ? ((word >>> shift) & 3) === 3 : ((word >>> shift) & 1) === 1;
}
function random(values, action) {
  const original = JavaRandom.nextDouble; let cursor = 0;
  JavaRandom.nextDouble = () => { assert(cursor < values.length, 'bounded RNG input'); return values[cursor++]; };
  try { const value = action(); assert.equal(cursor, values.length); return value; }
  finally { JavaRandom.nextDouble = original; }
}

// Independent membership oracle: Tip.It q120, 2 May 2006, lines 357–427.
const fixedSupplies = [
  'rope', 'spade', 'iron_pickaxe', 'iron_axe', 'knife', 'woodplank', 'piedish',
  'sack_potato_10', 'pot_flour', 'bucket_milk', 'ball_of_wool', 'oak_logs', 'chisel',
  'shears', 'needle', 'thread', 'cooked_meat', 'nails_iron', 'unicorn_horn_dust',
  'bronze_bar', 'white_berries', 'hammer', 'cactus_potato', 'skull', 'babydragon_bones',
  'slayer_facemask', 'blankrune', 'lobster_pot', 'fishing_rod', 'tinderbox', 'lockpick',
  'bronze_med_helm', 'white_apron', 'jug_wine', 'kebab', 'leather_boots', 'swamppaste',
  'redberries', 'cheese', 'vial_water', 'flax', 'gold_ring', 'egg', 'leather_gloves',
  'cake_tin', 'necklace_mould', 'rotten_tomato'
];
const individualizedSupplies = [
  ['archery_ticket', 'agilityarena_ticket', 'castlewars_ticket'],
  ['barrows_book_history', 'mourning_book1', 'elemental_workshop_shield_book'],
  ['jail_key', 'dusty_key', 'witches_doorkey']
];

// Original client colour indices: red1, yellow2, green3, cyan4, blue5, magenta6, white7.
// Geometry and sequence are from the retained period walkthrough and original map, not product constants.
const put = (pillar, item = 'mourning_mirror') => ({ kind: 'insert', pillar, item });
const aim = (pillar, beams) => ({ kind: 'aim', pillar, beams });
const take = (pillar, item = 'mourning_mirror') => ({ kind: 'take', pillar, item });
const door = (name, from) => ({ kind: 'door', name: `mourning_door_${name}`, from });
const chest = (part, items) => ({ kind: 'chest', name: `mourning_temple_light_parts_${part}_closed`, items });
const puzzleRecipe = [
  { kind: 'collect' },
  put('2_9'), aim('2_9', { '2_7_9': 7 }),
  put('2_7'), aim('2_7', { '2_6_7': 7 }),
  put('2_6'), aim('2_6', { '2_6_11': 7 }),
  put('2_11', 'mourning_crystal_yellow'),
  put('2_15'), aim('2_15', { '2_15_east': 2 }),
  { kind: 'handholds', from: 'west' }, door('2_16_west', 'west'),
  chest(2, { mourning_mirror: 2, mourning_crystal_cyan: 1 }),
  door('2_16_west', 'east'), { kind: 'handholds', from: 'east' },
  take('2_6'), take('2_11', 'mourning_crystal_yellow'), take('2_15'),
  put('2_6', 'mourning_crystal_cyan'),
  put('2_5'), aim('2_5', { '2_2_5': 4 }),
  put('2_2'), aim('2_2', { '2_2_3': 4 }),
  put('2_3', 'mourning_crystal_yellow'),
  { kind: 'expect', beams: { '2_3_east': 3, '2_15_east': 0 } },
  door('2_4_west', 'west'), chest(3, { mourning_mirror: 2 }), door('2_4_west', 'east'),
  { kind: 'reset' },
  put('2_9'), aim('2_9', { '2_7_9': 7 }),
  put('2_7'), aim('2_7', { '2_6_7': 7 }),
  put('2_6', 'mourning_crystal_cyan'),
  put('2_5'), aim('2_5', { '2_2_5': 4 }),
  put('2_2'), aim('2_2', { '2_2_3': 4 }),
  put('2_3'), aim('2_3', { '2_3_up': 4 }),
  put('3_3'), aim('3_3', { '3_2_3': 4, '3_1_2': 5 }),
  put('3_1'), aim('3_1', { '1_1_up': 5 }),
  aim('1_1', { '1_1_south': 5 }), door('1_1_south', 'south'),
  aim('1_1', { '1_1_east': 5 }), door('1_1_east', 'west'),
  chest(5, { mourning_mirror: 2, mourning_fractured_crystal_1: 1 }),
  door('1_1_east', 'east'), aim('1_1', { '1_1_south': 5 }), door('1_1_south', 'north'),
  take('2_6', 'mourning_crystal_cyan'), put('2_6', 'mourning_crystal_yellow'),
  aim('3_1', { '3_1_8': 1 }),
  put('3_13'), aim('3_13', { '1_13_up': 1 }),
  { kind: 'lowwall', from: 'east' }, { kind: 'rope' },
  aim('1_13', { '1_13_north': 1 }), door('1_13_north', 'north'),
  chest(4, { mourning_crystal_blue: 1 }), door('1_13_north', 'south'),
  { kind: 'ropeUp' }, { kind: 'lowwall', from: 'west' },
  { kind: 'reset' },
  put('2_9'), aim('2_9', { '2_7_9': 7 }),
  put('2_7'), aim('2_7', { '2_6_7': 7 }),
  put('2_6'), aim('2_6', { '2_6_11': 7 }),
  put('2_11', 'mourning_crystal_yellow'),
  put('2_15'), aim('2_15', { '2_15_east': 2 }),
  { kind: 'handholds', from: 'west' }, door('2_16_west', 'west'),
  put('2_16', 'mourning_crystal_blue'), door('2_16_west', 'east'),
  { kind: 'handholds', from: 'east' },
  take('2_11', 'mourning_crystal_yellow'), take('2_15'),
  aim('2_6', { '2_6_up': 7 }),
  put('3_6'), aim('3_6', { '3_6_11': 7 }),
  put('3_11', 'mourning_fractured_crystal_1'),
  aim('3_11', { '3_10_11': 7, '3_11_12': 7, '3_11_15': 7 }),
  put('3_10'), aim('3_10', { '1_10_up': 3 }),
  put('1_10'), aim('1_10', { '1_10_14': 3 }),
  put('1_14'), aim('1_14', { '1_14_east': 3 }),
  put('3_15'), aim('3_15', { '3_15_16': 7 }),
  put('3_16'), aim('3_16', { '1_16_up': 5 }),
  door('1_16_west', 'west'), aim('1_16', { '1_16_north': 5 }),
  door('1_16_north', 'south'),
  chest(6, { mourning_mirror: 3, mourning_fractured_crystal_2: 1 }),
  door('1_16_north', 'north'), door('1_16_west', 'east'),
  { kind: 'reset' },
  put('2_9'), aim('2_9', { '2_7_9': 7 }),
  put('2_7'), aim('2_7', { '1_7_up': 7 }),
  put('1_7'), aim('1_7', { '1_6_7': 7 }),
  put('1_6', 'mourning_fractured_crystal_2'),
  aim('1_6', { '1_3_6': 7, '1_6_11': 7, '1_6_west': 7 }),
  put('1_3'), aim('1_3', { '1_3_up': 7 }),
  put('2_3', 'mourning_crystal_yellow'),
  put('3_3'), aim('3_3', { '3_2_3': 2, '3_1_2': 1 }),
  put('3_1'), aim('3_1', { '3_1_8': 1 }),
  put('3_8'), aim('3_8', { '3_8_east': 1, '1_b_east': 1 }),
  put('1_11', 'mourning_fractured_crystal_1'),
  aim('1_11', { '1_10_11': 7, '1_11_12': 7, '1_11_south': 7 }),
  put('1_10'), aim('1_10', { '2_10_up': 3 }),
  put('3_10'), aim('3_10', { '3_10_west': 3 }),
  put('1_12'), aim('1_12', { '2_12_up': 7 }),
  put('3_12'), aim('3_12', { '3_11_12': 7 }),
  put('3_11'), aim('3_11', { '3_6_11': 7 }),
  put('3_6'), aim('3_6', { '3_5_6': 7 }),
  put('3_5', 'mourning_crystal_blue'),
  { kind: 'expect', beams: { '3_5_west': 5, '3_10_west': 3, '1_b_east': 1, '1_d_west': 0 } },
  door('1_b', 'east'), aim('1_b', { '1_b_west': 1, '1_d_west': 7 }),
  door('1_c', 'east')
];

const puzzleReturnRecipe = [
  { kind: 'door', name: 'mourning_door_1_c', from: 'west' },
  { kind: 'aim', pillar: '1_b', beams: { '1_b_east': 1, '1_b_west': 0 } },
  { kind: 'door', name: 'mourning_door_1_b', from: 'west' }
];

function recipeStep(p, step) {
  const pillar = `mourning_temple_pillar_${step.pillar}`;
  const from = (position, target) => step.from === 'west' ? position.x < target.x
    : step.from === 'east' ? position.x > target.x : step.from === 'south' ? position.z < target.z : position.z > target.z;
  if (step.kind === 'collect' || step.kind === 'reset') {
    if (step.kind === 'reset') operate(p, 'mourning_temple_light_wall_lever');
    operate(p, 'mourning_temple_light_wall_collector');
  } else if (step.kind === 'insert') {
    const before = count(p, step.item); assert(before > 0, `${pillar}: piece was acquired`);
    useLoc(p, pillar, step.item); assert.equal(count(p, step.item), before - 1);
  } else if (step.kind === 'aim') aimPiece(p, pillar, step.beams);
  else if (step.kind === 'take') takePiece(p, pillar, step.item, /crystal_(?:yellow|cyan|blue)$/.test(step.item) ? 1 : 2);
  else if (step.kind === 'expect') {
    for (const [suffix, colour] of Object.entries(step.beams)) assert.equal(
      p.getVarBit(id('VarBitType', `mourning_light_temple_${suffix}`)), colour, `original beam ${suffix}`);
  } else if (step.kind === 'door') {
    const row = locRows.find(row => row.name === step.name && (step.name !== 'mourning_door_1_c' || row.z === 4639));
    assert(row, step.name);
    const before = stage(p);
    operate(p, step.name, 1, [], candidate => candidate.x === row.x && candidate.z === row.z,
      position => from(position, row));
    assert(!from(p, row), `${step.name}: real native passage crosses the barrier`);
    landing(p, row, `native light door ${step.name}`);
    const entersChamber = step.name === 'mourning_door_1_c' && step.from === 'east' && before < 40;
    assert.equal(stage(p), entersChamber ? 40 : before, 'only the first inward final crossing earns chamber access');
  } else if (step.kind === 'chest') {
    const before = Object.fromEntries(Object.keys(step.items).map(name => [name, count(p, name)]));
    operate(p, step.name);
    for (const [name, quantity] of Object.entries(step.items)) assert.equal(count(p, name), before[name] + quantity, step.name);
    const received = Object.fromEntries(Object.keys(step.items).map(name => [name, count(p, name)]));
    operate(p, step.name);
    for (const [name, quantity] of Object.entries(received)) assert.equal(count(p, name), quantity, 'repeat Search never duplicates chest stock');
  } else if (step.kind === 'handholds') {
    const rows = locRows.filter(row => row.name === 'mourning_temple_agility_hanging');
    const edge = step.from === 'west' ? Math.min(...rows.map(row => row.x)) : Math.max(...rows.map(row => row.x));
    const row = rows.find(row => row.x === edge);
    random([0], () => operate(p, row.name, 1, [], candidate => candidate.x === row.x, position => from(position, row)));
    assert.equal(p.level, row.level, 'successful native handholds stay on the second floor');
    const opposite = rows.find(other => other.x === (step.from === 'west'
      ? Math.max(...rows.map(row => row.x)) : Math.min(...rows.map(row => row.x))));
    assert(step.from === 'west' ? p.x > opposite.x : p.x < opposite.x, 'native handholds cross the entire gap');
    landing(p, opposite, 'native successful handholds');
  } else if (step.kind === 'lowwall') {
    const row = locRows.find(row => row.name === 'mourning_temple_wall_jump' && row.z < 4640);
    operate(p, row.name, 1, [], candidate => candidate.z === row.z, position => from(position, row));
    assert(!from(p, row), 'native low-wall crossing reaches the other side');
    landing(p, row, 'native low wall');
  } else if (step.kind === 'rope') {
    useLoc(p, 'mourning_temple_way_down', 'rope');
    assert.equal(count(p, 'rope'), 0, 'attaching the ordinary rope consumes it once');
    assert.equal(p.getVarBit(id('VarBitType', 'mourning_temple_rope')), 1);
    operate(p, 'mourning_temple_way_down');
    landing(p, locRows.find(row => row.name === 'mourning_temple_way_ropemulti'), 'native attached-rope descent');
  } else if (step.kind === 'ropeUp') {
    operate(p, 'mourning_temple_way_ropemulti');
    landing(p, locRows.find(row => row.name === 'mourning_temple_way_down'), 'native attached-rope return');
  } else assert.fail(`unsupported solver step ${step.kind}`);
}

try {
  check('the original one-tile southern stair alcove has an immediate native return and a walkable upstairs escape', () => {
    const original = locRows.find(row => row.name === 'mourning_temple_stairs_base'
      && row.level === 1 && row.x === 1893 && row.z === 4658);
    assert(original, 'the independently retained map contains the original southern base');
    const p = fixture(20);
    place(p, { level: 1, x: 1896, z: 4658 });
    assert(floors.has(tile(p).join(',')));
    assert.equal(map.isMapBlocked(p.x, p.z, p.level), false);
    const base = loc(p, original.name, row => row.level === original.level && row.x === original.x && row.z === original.z);
    assert(p.inOperableDistance(base), 'no walking or position intervention is needed to escape the original alcove');
    assert(locHandler.handle(new OpLoc(1, base.x, base.z, base.type), p));
    dispatch(p, 'Loc', visibleLoc(types.LocType.get(base.type), p).id); finish(p);
    const top = loc(p, 'mourning_temple_stairs_top', row => row.level === 2 && row.x === original.x && row.z === original.z);
    assert(p.inOperableDistance(top), 'the native return reaches its original upper staircase immediately');
    landing(p, top, 'original return-only stair alcove escape');
    assert.equal(stage(p), 20);
    originalAlcoveEscapeProven = true;
  });
  check('the original red-door vestibule has a real walk to its circular stair and a non-empty upstairs escape', () => {
    const p = fixture(20);
    place(p, { level: 0, x: 1886, z: 4639 });
    nativeStep(p, { level: 0, x: 1886, z: 4638 });
    const stairs = loc(p, 'mourning_temple_circle_stairs_base',
      row => row.level === 0 && row.x === 1887 && row.z === 4638);
    assert(p.inOperableDistance(stairs), 'the actual vestibule walk reaches its original circle-stair operation stand');
    assert(locHandler.handle(new OpLoc(1, stairs.x, stairs.z, stairs.type), p));
    dispatch(p, 'Loc', visibleLoc(types.LocType.get(stairs.type), p).id); finish(p);
    const top = loc(p, 'mourning_temple_circle_stairs_top',
      row => row.level === 1 && row.x === stairs.x && row.z === stairs.z);
    assert(p.inOperableDistance(top), 'native ascent reaches its original upper counterpart immediately');
    landing(p, top, 'original red-door vestibule stair escape');
    assert.equal(stage(p), 20);
    originalRedVestibuleEscapeProven = true;
  });
  check('the original upper blue-door west stand has a native open-door return and an east-side escape', () => {
    const p = fixture(20);
    // Isolated crossing geometry; the full solver must earn its own door flags.
    p.setVar(varp('mourning_quest_light_doors'), -1);
    const door = loc(p, 'mourning_door_2_16_west', row => row.level === 1 && row.x === 1912 && row.z === 4613);
    place(p, { level: 1, x: 1913, z: 4613 });
    for (const expected of [[1, 1911, 4613], [1, 1913, 4613]]) {
      assert(p.inOperableDistance(door), 'both sides immediately operate the original return door');
      assert.equal(p.getVarBit(id('VarBitType', 'mourning_door_2_16_west')), 1);
      const visible = visibleLoc(types.LocType.get(door.type), p);
      assert.equal(visible.debugname, 'mourning_door_of_light_white');
      assert(visible.op.some(Boolean), 'the genuinely open cached form exposes its native operation');
      assert(locHandler.handle(new OpLoc(1, door.x, door.z, door.type), p));
      dispatch(p, 'Loc', visible.id); finish(p);
      assert.deepEqual(tile(p), expected, 'actual native passage crosses and immediately returns without reseeding position');
      assert(floors.has(tile(p).join(',')));
      assert.equal(map.isMapBlocked(p.x, p.z, p.level), false);
      assert.equal(p.getVarBit(id('VarBitType', 'mourning_door_2_16_west')), 1, 'passage preserves the open return');
    }
    const escape = [...map.findPath(1, p.x, p.z, 1914, 4615)];
    assert(escape.length && escape.at(-1) === CoordGrid.packCoord(1, 1914, 4615),
      'the original east side has its independently measured non-empty two-tile escape');
    landing(p, door, 'original upper blue-door return escape');
    assert.equal(stage(p), 20);
    originalBlueDoorReturnProven = true;
  });
  check('quest items are untradeable and all twenty-one original state slots preserve their transmission policy and numbering', () => {
    const directory = path.join(contentRoot, 'scripts/quests/quest_mourning2/configs');
    const objects = fs.readFileSync(path.join(directory, 'mep2_items.obj'), 'utf8');
    const itemNames = [...objects.matchAll(/^\[([^\]]+)\]/gm)].map(match => match[1]);
    assert(itemNames.length > 0);
    for (const name of itemNames) assert.equal(types.ObjType.get(obj(name)).tradeable, false, name);
    const stateNames = [
      'mourning_quest_part2', 'varp575_bits', 'varp576_bits', 'varp577_bits', 'varp578_bits',
      'mourning_quest_light_doors',
      ...Array.from({ length: 6 }, (_, index) => `mourning_quest_beams${index + 1}`),
      ...Array.from({ length: 5 }, (_, index) => `mourning_quest_vert_beams${index + 1}`),
      'mourning_quest_beam_cross1', 'mourning_quest_beam_cross2', 'varp593_bits', 'mourning_part2_basevar2'
    ];
    const serverOnly = new Set(['mourning_quest_part2', 'varp575_bits', 'varp576_bits',
      'varp577_bits', 'varp578_bits', 'varp593_bits']);
    const source = fs.readdirSync(directory).filter(name => name.endsWith('.varp'))
      .map(name => fs.readFileSync(path.join(directory, name), 'utf8')).join('\n');
    for (const [index, name] of stateNames.entries()) {
      assert.equal(varp(name), 574 + index, `${name}: original cache slot`);
      assert.equal(types.VarPlayerType.get(varp(name)).transmit, !serverOnly.has(name),
        `${name}: original server transmission policy`);
      const block = source.match(new RegExp(`^\\[${name}\\]\\n([^\\[]*)`, 'm'));
      assert(block && /^scope=perm$/m.test(block[1]), `${name}: durable puzzle/checklist state`);
    }
  });

  check('Dark Beast assignment owner reads the original stage bits at cavern access', () => {
    for (const value of [0, 1, 4, 5, 10, 40, 60]) {
      const p = fixture(value);
      assert.equal(integer('slayer_mourning2_unlocked', p), Number(value >= 5));
    }
    const p = fixture(1 << 8);
    assert.equal(stage(p), 0);
    assert.equal(integer('slayer_mourning2_unlocked', p), 0, 'unrelated journal bits do not grant cavern access');
  });

  check('Arianwyn offers a reversible start only after Part I, without rewriting Part I', () => {
    const unfinished = fixture(0, [], 6);
    talk(unfinished, 'mourning_arianwyn');
    assert.equal(stage(unfinished), 0, 'Part I reminder does not start Part II');
    assert.equal(unfinished.getVar(varp('mourning_quest')), 6);
    const declined = fixture();
    talk(declined, 'mourning_arianwyn', [2]);
    assert.equal(stage(declined), 0);
    assert.equal(declined.getVar(varp('mourning_quest')), 8);
    const accepted = fixture();
    talk(accepted, 'mourning_arianwyn', [1]);
    assert.equal(stage(accepted), 1);
    assert.equal(accepted.getVar(varp('mourning_quest')), 8);
    talk(accepted, 'mourning_arianwyn');
    assert.equal(stage(accepted), 1, 'a reminder cannot skip the mine investigation');
    assert.equal(accepted.getVar(varp('mourning_quest')), 8);
  });

  check('the Head mourner grants cavern access only with disguise and key space, and recovers a lost key', () => {
    const bare = fixture(1);
    talk(bare, 'mourner_hideout_head_mourner');
    assert.equal(stage(bare), 1);
    assert.equal(count(bare, 'mourning_excavation_key'), 0);
    const p = fixture(1); disguise(p); fullInventory(p);
    talk(p, 'mourner_hideout_head_mourner');
    assert.equal(stage(p), 1, 'full inventory does not advance before the key is delivered');
    assert.equal(count(p, 'mourning_excavation_key'), 0);
    del(p, 'spade', 1);
    talk(p, 'mourner_hideout_head_mourner');
    assert.equal(stage(p), 5);
    assert.equal(count(p, 'mourning_excavation_key'), 1);
    talk(p, 'mourner_hideout_head_mourner');
    assert.equal(count(p, 'mourning_excavation_key'), 1, 'repeat dialogue cannot duplicate the new key');
    del(p, 'mourning_excavation_key');
    talk(p, 'mourner_hideout_head_mourner');
    assert.equal(stage(p), 5);
    assert.equal(count(p, 'mourning_excavation_key'), 1, 'lost-key recovery does not restart the quest');
    assert.equal(p.getVar(varp('mourning_quest')), 8, 'the shared Head mourner hook preserves Part I');
  });

  check('every original dead guard safely grants and recovers the journal and colour wheel, with Read advancing investigation', () => {
    for (const name of ['mourning_dead_guard1', 'mourning_dead_guard2', 'mourning_dead_guard3']) {
      const p = fixture(5); fullInventory(p);
      operate(p, name);
      assert.equal(stage(p), 5, `${name}: no investigation before a journal can be delivered`);
      assert.equal(count(p, 'mourning_ederns_journal'), 0);
      assert.equal(count(p, 'mourning_colour_wheel'), 0);
      del(p, 'spade', 2);
      operate(p, name);
      assert.equal(stage(p), 10);
      assert.equal(count(p, 'mourning_ederns_journal'), 1);
      assert.equal(count(p, 'mourning_colour_wheel'), 1);
      operate(p, name);
      assert.equal(count(p, 'mourning_ederns_journal'), 1, 'search cannot duplicate the held journal');
      assert.equal(count(p, 'mourning_colour_wheel'), 1, 'search cannot duplicate the held wheel');
      assert(held(p, 'mourning_ederns_journal', 1)); finish(p);
      assert.equal(stage(p), 15, 'native Read, not the fixture, advances the journal investigation');
      p.closeModal();
      del(p, 'mourning_ederns_journal'); del(p, 'mourning_colour_wheel');
      operate(p, name);
      assert.equal(stage(p), 15, 'loss recovery preserves the read-journal stage');
      assert.equal(count(p, 'mourning_ederns_journal'), 1);
      assert.equal(count(p, 'mourning_colour_wheel'), 1);
      assert(held(p, 'mourning_ederns_journal', 1)); finish(p);
      assert.equal(stage(p), 15, 're-reading cannot skip the chisel sample');
    }
  });

  check('later quest stages retain native key, journal and colour-wheel recovery without regression or duplication', () => {
    for (const value of [10, 15, 20, 40, 45, 50, 60]) {
      const p = fixture(value); disguise(p);
      talk(p, 'mourner_hideout_head_mourner');
      assert.equal(stage(p), value);
      assert.equal(count(p, 'mourning_excavation_key'), 1, `stage ${value}: lost new key is recoverable`);
      talk(p, 'mourner_hideout_head_mourner');
      assert.equal(count(p, 'mourning_excavation_key'), 1, `stage ${value}: no duplicate held key`);
      operate(p, 'mourning_dead_guard1');
      assert.equal(stage(p), value, `stage ${value}: recovering papers does not rewind progress`);
      assert.equal(count(p, 'mourning_ederns_journal'), 1);
      assert.equal(count(p, 'mourning_colour_wheel'), 1);
      operate(p, 'mourning_dead_guard1');
      assert.equal(count(p, 'mourning_ederns_journal'), 1);
      assert.equal(count(p, 'mourning_colour_wheel'), 1);
    }
  });

  check('Thorgel recognizes a banked Death talisman without paper, consumption or a duplicate', () => {
    const p = fixture(40);
    p.invAdd(bank, obj('death_talisman'), 1); fullInventory(p, 'rune_scimitar');
    talk(p, 'mourning_deathalter_dwarf_vis');
    assert.equal(count(p, 'mourning_deathalter_list'), 0);
    assert.equal(count(p, 'death_talisman'), 0);
    assert.equal(p.invTotal(bank, obj('death_talisman')), 1);
    assert.equal(stage(p), 40);
  });

  check('native Death-ruins entry reaches the retained altar and charges or recharges the real replacement crystal', () => {
    const altar = locRows.find(row => row.name === 'death_altar' && row.z > 4800);
    assert(altar, 'the actual Runecrafting Death altar has a retained placement');
    const portal = locRows.filter(row => row.name === 'deathtemple_exit_portal' && row.level === altar.level)
      .sort((a, b) => Math.hypot(a.x - altar.x, a.z - altar.z) - Math.hypot(b.x - altar.x, b.z - altar.z))[0];
    assert(portal, 'the Death temple has its original exit portal');
    for (const value of [40, 45]) {
      const p = fixture(value, ['death_talisman']);
      talk(p, 'mourning_arianwyn');
      assert.equal(count(p, 'mourning_crystal_new_sample'), 1, 'replacement is earned through native recovery dialogue');
      const ruins = useLoc(p, 'deathtemple_ruined', 'death_talisman', row => row.x < 2000);
      landing(p, portal, `native Death temple entry at stage ${value}`);
      assert.equal(count(p, 'death_talisman'), 1, 'entering does not consume the talisman');
      assert.equal(stage(p), value, 'entry itself does not charge the crystal');
      const entry = tile(p);
      useLoc(p, 'death_altar', 'mourning_crystal_new_sample', row => row.x === altar.x && row.z === altar.z);
      const route = [...map.findPath(entry[0], entry[1], entry[2], p.x, p.z)];
      assert(route.length && route.at(-1) === CoordGrid.packCoord(p.level, p.x, p.z),
        'the native talisman landing has a real packed-map route to the original altar operation stand');
      console.log(`MAP native Death talisman altar route: ${entry} -> ${tile(p)}; ${route.length} waypoints`);
      assert.equal(stage(p), 45);
      assert.equal(count(p, 'mourning_crystal_new_sample'), 0);
      assert.equal(count(p, 'mourning_crystal_new_powered'), 1, 'only native use at the real altar produces the powered crystal');
      operate(p, 'deathtemple_exit_portal', 1, [], row => row.x === portal.x && row.z === portal.z);
      landing(p, ruins, 'native Death-altar exit returns to the original ruins');
      useLoc(p, 'mourning_temple_obsidian_crystal_dead', 'mourning_crystal_new_powered');
      assert.equal(stage(p), 50, 'native use on the black crystal restores the temple before the reward');
      assert.equal(count(p, 'mourning_crystal_new_powered'), 0);
      assert.equal(count(p, 'mourning_crystal_trinket'), 0, 'restoring is not the Arianwyn reward');
    }
    const tiara = fixture(40, ['tiara_death']);
    assert(held(tiara, 'tiara_death', 2)); finish(tiara);
    assert.equal(tiara.invTotal(worn, obj('tiara_death')), 1, 'native Wear equips the original Death tiara');
    operate(tiara, 'deathtemple_ruined', 1, [], row => row.x < 2000);
    landing(tiara, portal, 'native Death tiara entry');
    const altarApproach = [...approaches.values()].find(row => row.kind === 'loc'
      && row.name === 'death_altar' && row.target.x === altar.x && row.target.z === altar.z)?.stand;
    assert(altarApproach, 'prior native charging independently found an original-map altar operation stand');
    const route = [...map.findPath(tiara.level, tiara.x, tiara.z, altarApproach.x, altarApproach.z)];
    assert(route.length && route.at(-1) === CoordGrid.packCoord(altarApproach.level, altarApproach.x, altarApproach.z),
      'the native tiara landing has a real packed-map route to the original altar operation stand');
    console.log(`MAP native Death tiara altar route: ${tile(tiara)} -> ${altarApproach.level},${altarApproach.x},${altarApproach.z}; ${route.length} waypoints`);
    const premature = fixture(20, ['mourning_crystal_new_sample']);
    useLoc(premature, 'death_altar', 'mourning_crystal_new_sample', row => row.x === altar.x && row.z === altar.z);
    assert.equal(stage(premature), 20);
    assert.equal(count(premature, 'mourning_crystal_new_sample'), 1);
    assert.equal(count(premature, 'mourning_crystal_new_powered'), 0);
    const wrong = fixture(40, ['mourning_crystal_new_sample']);
    useLoc(wrong, 'air_altar', 'mourning_crystal_new_sample');
    assert.equal(stage(wrong), 40);
    assert.equal(count(wrong, 'mourning_crystal_new_sample'), 1);
    assert.equal(count(wrong, 'mourning_crystal_new_powered'), 0);
  });

  check('the isolated Death-altar hook preserves native essence and talisman/tiara use and ignores other altars', () => {
    const actual = row => row.name === 'death_altar' && row.z > 4800;
    const rune = fixture(40, ['blankrune_high', 'mourning_crystal_new_sample']);
    rune.baseLevels.fill(99); rune.levels.fill(99);
    useLoc(rune, 'death_altar', 'blankrune_high', actual);
    assert.equal(count(rune, 'blankrune_high'), 0);
    assert.equal(count(rune, 'deathrune'), 1);
    assert.equal(count(rune, 'mourning_crystal_new_sample'), 1);
    assert.equal(stage(rune), 40);
    for (const item of ['tiara', 'death_talisman']) {
      const p = fixture(40, ['tiara', 'death_talisman', 'mourning_crystal_new_sample']);
      useLoc(p, 'death_altar', item, actual);
      assert.equal(count(p, 'tiara'), 0);
      assert.equal(count(p, 'death_talisman'), 0);
      assert.equal(count(p, 'tiara_death'), 1, `native ${item} use still crafts the Death tiara`);
      assert.equal(count(p, 'mourning_crystal_new_sample'), 1);
      assert.equal(stage(p), 40);
    }
    const other = fixture(40, ['mourning_crystal_new_sample']);
    useLoc(other, 'mind_altar', 'mourning_crystal_new_sample');
    assert.equal(count(other, 'mourning_crystal_new_sample'), 1);
    assert.equal(count(other, 'mourning_crystal_new_powered'), 0);
    assert.equal(stage(other), 40);
  });

  check('the real black crystal requires sample space and Arianwyn recovers only unpowered replacements at every intermediate stage', () => {
    const p = fixture(15, ['chisel']); fullInventory(p);
    useLoc(p, 'mourning_temple_obsidian_crystal_dead', 'chisel');
    assert.equal(count(p, 'mourning_crystal_sample'), 0);
    assert.equal(stage(p), 15);
    del(p, 'spade', 1);
    useLoc(p, 'mourning_temple_obsidian_crystal_dead', 'chisel');
    assert.equal(count(p, 'mourning_crystal_sample'), 1);
    useLoc(p, 'mourning_temple_obsidian_crystal_dead', 'chisel');
    assert.equal(count(p, 'mourning_crystal_sample'), 1, 'repeated chiselling does not duplicate the held sample');
    del(p, 'mourning_crystal_sample');
    useLoc(p, 'mourning_temple_obsidian_crystal_dead', 'chisel');
    assert.equal(count(p, 'mourning_crystal_sample'), 1, 'a lost sample can be chipped again');
    useNpc(p, 'mourning_arianwyn', 'mourning_crystal_sample');
    assert.equal(stage(p), 20);
    assert.equal(count(p, 'mourning_crystal_new_sample'), 1);
    del(p, 'mourning_crystal_new_sample'); fullInventory(p);
    talk(p, 'mourning_arianwyn');
    assert.equal(stage(p), 20);
    assert.equal(count(p, 'mourning_crystal_new_sample'), 0, 'a full inventory does not destroy replacement entitlement');
    del(p, 'spade', 1);
    talk(p, 'mourning_arianwyn');
    assert.equal(count(p, 'mourning_crystal_new_sample'), 1);
    for (const value of [20, 40, 45]) {
      const recovery = fixture(value);
      talk(recovery, 'mourning_arianwyn');
      assert.equal(stage(recovery), value);
      assert.equal(count(recovery, 'mourning_crystal_new_sample'), 1, `stage ${value}: unpowered loss recovery`);
      assert.equal(count(recovery, 'mourning_crystal_new_powered'), 0, 'only the actual Death altar may charge a replacement');
      talk(recovery, 'mourning_arianwyn');
      assert.equal(count(recovery, 'mourning_crystal_new_sample'), 1, 'repeated reminder cannot duplicate a held replacement');
    }
  });

  check('the original western HQ door enforces inward access but never traps an undressed player inside', () => {
    const row = locRows.find(row => row.name === 'mourner_hideout_door4');
    assert(row, 'western excavation gate comes from the original HQ map');
    for (const [value, dressed, key, allowed] of [
      [0, true, false, false], [1, true, false, false], [4, true, false, false],
      [5, false, true, false], [5, true, false, false], [5, true, true, true]
    ]) {
      const p = fixture(value, key ? ['mourning_excavation_key'] : []);
      if (dressed) disguise(p);
      for (let index = 0; index < 4; index++) { tick(p); World.processZones(); }
      operate(p, row.name, 1, [], candidate => candidate.x === row.x && candidate.z === row.z,
        position => position.x >= row.x);
      assert.equal(p.x < row.x, allowed, `inward stage=${value}, disguise=${dressed}, key=${key}`);
      assert.equal(stage(p), value, 'travel cannot manufacture a quest stage');
      if (allowed) landing(p, row, 'western cavern entry');
    }
    const p = fixture();
    for (let index = 0; index < 4; index++) { tick(p); World.processZones(); }
    operate(p, row.name, 1, [], candidate => candidate.x === row.x && candidate.z === row.z,
      position => position.x < row.x);
    assert(p.x >= row.x, 'outward travel works without a quest, key or disguise');
    landing(p, row, 'unconditional cavern exit');
  });

  check('Arianwyn waits for reward space, grants the exact period reward once, and recovers the trinket safely', () => {
    const p = fixture(50); fullInventory(p);
    const before = { xp: p.stats[PlayerStat.AGILITY], qp: integer('count_questpoints', p) };
    talk(p, 'mourning_arianwyn');
    assert.equal(stage(p), 50, 'no completed stage before reward delivery is possible');
    assert.equal(p.stats[PlayerStat.AGILITY], before.xp);
    assert.equal(integer('count_questpoints', p), before.qp);
    del(p, 'spade', 1);
    const mark = p.packets.length;
    talk(p, 'mourning_arianwyn');
    assert.equal(stage(p), 60);
    assert.equal(p.stats[PlayerStat.AGILITY] - before.xp, 200_000, '20,000 Agility XP in native tenths');
    assert.equal(integer('count_questpoints', p) - before.qp, 2);
    assert.equal(count(p, 'mourning_crystal_trinket'), 1);
    assert(p.packets.slice(mark).some(packet => packet.constructor.name === 'IfSetText'
      && /Mourning.*End.*(?:II|2)/i.test(packet.text)), 'native completion scroll names Part II');
    talk(p, 'mourning_arianwyn');
    assert.equal(p.stats[PlayerStat.AGILITY] - before.xp, 200_000);
    assert.equal(integer('count_questpoints', p) - before.qp, 2);
    assert.equal(count(p, 'mourning_crystal_trinket'), 1);
    del(p, 'mourning_crystal_trinket'); add(p, 'spade');
    talk(p, 'mourning_arianwyn');
    assert.equal(count(p, 'mourning_crystal_trinket'), 0, 'full-inventory recovery does not lose the entitlement');
    del(p, 'spade', 1);
    talk(p, 'mourning_arianwyn');
    assert.equal(count(p, 'mourning_crystal_trinket'), 1);
    assert.equal(stage(p), 60);
    assert.equal(p.stats[PlayerStat.AGILITY] - before.xp, 200_000, 'recovery never repeats XP');
    assert.equal(integer('count_questpoints', p) - before.qp, 2, 'recovery never repeats quest points');
    assert.equal(p.getVar(varp('mourning_quest')), 8);
  });

  check('all twenty-seven individualized lists contain the period fifty supplies, not later substitutes', () => {
    assert.equal(fixedSupplies.length, 47);
    for (let ticket = 0; ticket < 3; ticket++) for (let book = 0; book < 3; book++) for (let key = 0; key < 3; key++) {
      const p = fixture(40);
      p.setVar(varp('varp593_bits'), ticket | (book << 2) | (key << 4));
      const choices = [ticket, book, key].map((value, index) => individualizedSupplies[index][value]);
      const actual = Array.from({ length: 50 }, (_, index) => integer('mep2_dwarf_item', p, [index]));
      assert.equal(new Set(actual).size, 50, 'each requested item occupies one checklist entry');
      assert.deepEqual(actual.slice(0, 3), choices.map(obj), 'individual choices use their stored two-bit fields');
      assert.deepEqual(new Set(actual.slice(3)), new Set(fixedSupplies.map(obj)), 'fixed membership matches the period guide');
      assert(!actual.includes(obj('rottenapples')), 'rotten tomato is not the unrelated Rotten apple object');
    }
    const p = fixture(40);
    for (const index of [-1, 50]) assert.equal(integer('mep2_dwarf_item', p, [index]), -1);
  });

  check('all three Lletya bookcases supply the unseeded history needed to complete book-choice-one lists', () => {
    for (const bookcase of ['elf_village_bookcase_1', 'elf_village_bookcase_2', 'elf_village_bookcase_3']) {
      const p = fixture(40);
      p.setVar(varp('varp593_bits'), 1 << 2);
      assert.equal(integer('mep2_dwarf_item', p, [1]), obj('mourning_book1'));
      fullInventory(p);
      operate(p, bookcase);
      assert.equal(count(p, 'mourning_book1'), 0, 'a full bag cannot lose or replace an item');
      assert.equal(p.invFreeSpace(inv), 0);
      del(p, 'spade', 1);
      operate(p, bookcase);
      assert.equal(count(p, 'mourning_book1'), 1, `${bookcase}: native Search supplies the requested history`);
      operate(p, bookcase);
      assert.equal(count(p, 'mourning_book1'), 1, 'repeated Search cannot duplicate a carried book');
      // Transfer the natively earned book into bank storage, rather than seeding a source substitute.
      const earned = count(p, 'mourning_book1');
      del(p, 'mourning_book1');
      p.invAdd(bank, obj('mourning_book1'), earned);
      operate(p, bookcase);
      assert.equal(count(p, 'mourning_book1'), 0, 'a banked book also prevents duplication');
      assert.equal(p.invTotal(bank, obj('mourning_book1')), earned);
      p.invDel(bank, obj('mourning_book1'), earned);
      operate(p, bookcase);
      assert.equal(count(p, 'mourning_book1'), 1, 'a lost book is recovered through the same native source');
      del(p, 'spade');
      talk(p, 'mourning_deathalter_dwarf_vis');
      assert(dwarfPaid(p, 1), 'Thorgel accepts the book actually obtained from the bookcase');
      assert.equal(count(p, 'mourning_book1'), 0);
      const supplies = [individualizedSupplies[0][0], 'mourning_book1', individualizedSupplies[2][0], ...fixedSupplies];
      for (const [index, item] of supplies.entries()) {
        if (index === 1) continue; // This row was earned and handed in above, never seeded.
        add(p, item);
        useNpc(p, 'mourning_deathalter_dwarf_vis', item);
        assert(dwarfPaid(p, index), `${bookcase}: native hand-in accepts ${item}`);
        assert.equal(count(p, item), 0);
      }
      assert(Array.from({ length: 50 }, (_, index) => dwarfPaid(p, index)).every(Boolean));
      assert.equal(count(p, 'death_talisman'), 1, `${bookcase}: all fifty hand-ins earn the talisman`);
      assert.equal(stage(p), 40);
    }
  });

  check('Thorgel records all fifty native partial hand-ins once, preserves puzzle flags, and defers a full-inventory talisman safely', () => {
    const p = fixture(40);
    // A normal final-chamber state: rope/fixed-mirror/first-entry plus two fractured orientations.
    const puzzleBits = 0x4b800000, puzzleMask = 0x7f800000;
    p.setVar(varp('mourning_part2_basevar2'), puzzleBits);
    const preserved = () => assert.equal(p.getVar(varp('mourning_part2_basevar2')) & puzzleMask,
      puzzleBits, 'checklist operations preserve all unrelated temple state');
    fullInventory(p, 'rune_scimitar');
    talk(p, 'mourning_deathalter_dwarf_vis');
    assert.equal(count(p, 'mourning_deathalter_list'), 0, 'no paper is lost to a full inventory');
    assert.equal(stage(p), 40); preserved();
    del(p, 'rune_scimitar', 1);
    talk(p, 'mourning_deathalter_dwarf_vis');
    assert.equal(count(p, 'mourning_deathalter_list'), 1);
    const requested = Array.from({ length: 50 }, (_, index) => integer('mep2_dwarf_item', p, [index]));
    const names = requested.map(value => types.ObjType.get(value).debugname);
    assert.equal(new Set(requested).size, 50);
    talk(p, 'mourning_deathalter_dwarf_vis');
    assert.equal(count(p, 'mourning_deathalter_list'), 1, 'repeat requests do not duplicate the paper');
    const mark = p.packets.length;
    assert(held(p, 'mourning_deathalter_list', 1)); finish(p);
    assert.equal(p.modalMain, id('Component', 'mourning_deathalter'));
    const text = p.packets.slice(mark).filter(packet => packet.constructor.name === 'IfSetText').map(packet => packet.text);
    for (const value of requested) {
      const name = types.ObjType.get(value).name;
      assert(text.some(line => line.includes(name)), `the native checklist names ${name}`);
    }
    p.closeModal();
    emptyInventory(p);
    talk(p, 'mourning_deathalter_dwarf_vis');
    assert.equal(count(p, 'mourning_deathalter_list'), 1, 'a lost list is recoverable without rerolling its choices');
    assert.deepEqual(Array.from({ length: 50 }, (_, index) => integer('mep2_dwarf_item', p, [index])), requested);
    const rope = names.indexOf('rope'); assert(rope >= 3);
    for (const index of [rope, 1]) {
      add(p, names[index], 2);
      useNpc(p, 'mourning_deathalter_dwarf_vis', names[index]);
      assert(dwarfPaid(p, index), `${names[index]}: native selected hand-in writes its own paid flag`);
      assert.equal(count(p, names[index]), 1);
      useNpc(p, 'mourning_deathalter_dwarf_vis', names[index]);
      assert.equal(count(p, names[index]), 1, 'an already paid entry cannot consume a duplicate');
      preserved();
    }
    const remaining = Array.from({ length: 50 }, (_, index) => index).filter(index => index !== 0 && !dwarfPaid(p, index));
    for (let start = 0; start < remaining.length; start += 20) {
      const batch = remaining.slice(start, start + 20);
      for (const index of batch) add(p, names[index]);
      talk(p, 'mourning_deathalter_dwarf_vis');
      for (const index of batch) {
        assert(dwarfPaid(p, index), `${names[index]}: Talk records the actual partial hand-in`);
        assert.equal(count(p, names[index]), 0);
      }
      assert.equal(count(p, 'death_talisman'), 0, 'all fifty entries are required');
      assert.equal(stage(p), 40); preserved();
    }
    assert.equal(count(p, names[rope]), 1);
    assert.equal(count(p, names[1]), 1);
    emptyInventory(p);
    assert.equal(types.ObjType.get(requested[0]).stackable, true, 'all three original ticket alternatives stack');
    add(p, names[0], 2); fullInventory(p, 'rune_scimitar');
    useNpc(p, 'mourning_deathalter_dwarf_vis', names[0]);
    assert(Array.from({ length: 50 }, (_, index) => dwarfPaid(p, index)).every(Boolean));
    assert.equal(count(p, names[0]), 1, 'only one last ticket is consumed');
    assert.equal(count(p, 'death_talisman'), 0, 'completed hand-ins survive a full inventory without a lost reward');
    assert.equal(p.invFreeSpace(inv), 0); preserved();
    del(p, 'rune_scimitar', 1);
    talk(p, 'mourning_deathalter_dwarf_vis');
    assert.equal(count(p, 'death_talisman'), 1, 'one free slot delivers the earned talisman without another supply');
    talk(p, 'mourning_deathalter_dwarf_vis');
    assert.equal(count(p, 'death_talisman'), 1);
    assert.equal(count(p, names[0]), 1);
    del(p, 'death_talisman'); fullInventory(p, 'rune_scimitar');
    talk(p, 'mourning_deathalter_dwarf_vis');
    assert.equal(count(p, 'death_talisman'), 0);
    del(p, 'rune_scimitar', 1);
    talk(p, 'mourning_deathalter_dwarf_vis');
    assert.equal(count(p, 'death_talisman'), 1, 'a lost talisman does not require the fifty supplies again');
    assert.equal(stage(p), 40); preserved();
    p.setVar(varp('mourning_quest_part2'), 60);
    del(p, 'death_talisman');
    for (let repeat = 0; repeat < 2; repeat++) talk(p, 'mourning_deathalter_dwarf_vis');
    assert.equal(count(p, 'death_talisman'), 0, 'completion ends free tradeable talisman replacement');
    assert.equal(p.getVarBit(id('VarBitType', 'mourning_dwarf_startedtask')), 3);
  });

  check('an already owned Death talisman bypasses the dwarf list without being consumed', () => {
    const p = fixture(40, ['death_talisman']); fullInventory(p, 'rune_scimitar');
    talk(p, 'mourning_deathalter_dwarf_vis');
    assert.equal(count(p, 'mourning_deathalter_list'), 0);
    assert.equal(count(p, 'death_talisman'), 1);
    useNpc(p, 'mourning_deathalter_dwarf_vis', 'death_talisman');
    assert.equal(count(p, 'death_talisman'), 1);
    assert.equal(count(p, 'mourning_deathalter_list'), 0);
    assert.equal(stage(p), 40);
  });

  check('a closed final light door cannot strand a completed Death-altar visitor behind the native shortcut', () => {
    const hole = locRows.find(row => row.name === 'mourning_temple_light_wall_with_hole');
    const tunnel = locRows.find(row => row.name === 'cavewalltunnel_to_temple');
    assert.deepEqual([hole.level, hole.x, hole.z], [0, 1856, 4638]);
    assert.deepEqual([tunnel.level, tunnel.x, tunnel.z], [0, 2311, 9792]);
    const walk = (p, destination) => {
      const route = [...map.findPath(p.level, p.x, p.z, destination.x, destination.z)];
      assert(route.length && route.at(-1) === CoordGrid.packCoord(p.level, destination.x, destination.z),
        'the independent packed-map route reaches the requested operation stand');
      p.clearInteraction(); p.run = 0; p.queueWaypoints(route);
      for (let step = 0; step < 64 && (p.x !== destination.x || p.z !== destination.z); step++) {
        const before = tile(p);
        p.resetEntity(false); p.updateMovement();
        assert.notDeepEqual(tile(p), before, 'each native movement cycle advances along clear floor');
      }
      assert.deepEqual(tile(p), [destination.level, destination.x, destination.z]);
    };
    const enter = (p, target) => {
      p.resetEntity(false);
      assert(p.inOperableDistance(target), 'the real tunnel is operable from the reached stand');
      const visible = visibleLoc(types.LocType.get(target.type), p);
      // Native teleports rebuild the client's map origin before its next location packet.
      p.originX = p.x; p.originZ = p.z;
      assert(locHandler.handle(new OpLoc(1, target.x, target.z, target.type), p));
      dispatch(p, 'Loc', visible.id); finish(p);
    };
    const locked = fixture(20);
    operate(locked, hole.name);
    assert.equal(locked.z, 4638, 'a player without chamber access stays beside the closed shortcut');
    assert.equal(locked.getVarBit(id('VarBitType', 'mourning_light_door_1_c_first_time')), 0);
    const p = fixture(60, ['death_talisman']);
    p.setVar(varp('mourning_part2_basevar2'), 0);
    operate(p, 'mourning_temple_light_wall_lever');
    assert.equal(p.getVarBit(id('VarBitType', 'mourning_door_1_c')), 0, 'native reset leaves the final barrier closed');
    useLoc(p, 'deathtemple_ruined', 'death_talisman', row => row.x < 2000);
    operate(p, 'deathtemple_exit_portal', 1, [], row => row.z > 4800);
    assert.deepEqual(tile(p), [0, 1862, 4639], 'the actual Death-altar exit starts inside the closed chamber');
    assert.equal(p.getVarBit(id('VarBitType', 'mourning_door_1_c')), 0);
    walk(p, { level: hole.level, x: hole.x + 1, z: hole.z });
    enter(p, loc(p, hole.name));
    assert.equal(p.getVarBit(id('VarBitType', 'mourning_light_door_1_c_first_time')), 1,
      'completion opens the reciprocal Underground Pass morph');
    landing(p, tunnel, 'native Death chamber to Underground Pass shortcut');
    const returnTunnel = loc(p, tunnel.name);
    assert.equal(visibleLoc(types.LocType.get(returnTunnel.type), p).debugname, 'cavewalltunnel_to_temple_open');
    enter(p, returnTunnel);
    landing(p, hole, 'native Underground Pass return into the Death chamber');
    for (const target of [loc(p, 'deathtemple_ruined', row => row.x < 2000), npc(p, 'mourning_deathalter_dwarf_vis')]) {
      const scout = fixture(40); stand(scout, target);
      walk(p, { level: scout.level, x: scout.x, z: scout.z });
      assert(p.inOperableDistance(target), 'the native return reaches the altar entrance and Thorgel');
    }
    assert.equal(stage(p), 60);
    assert.equal(p.getVarBit(id('VarBitType', 'mourning_door_1_c')), 0, 'the shortcut does not manufacture an open light door');
  });

  check('every original light-door row crosses onto its independently mapped clear side in both directions', () => {
    const rows = locRows.filter(row => /^mourning_door_(?:1_(?:1_south|1_east|13_north|13_east|16_north|16_west|b|c)|2_(?:4_west|4_south|16_north|16_west))$/.test(row.name));
    assert.equal(rows.length, 14, 'all twelve barriers include each of the three final-door rows');
    for (const row of rows) for (const side of [-1, 1]) {
      const p = fixture(20);
      // Isolated crossing geometry: open flags are fixture state, not a substitute for the full beam solver below.
      p.setVar(varp('mourning_quest_light_doors'), -1);
      const axis = row.angle % 2 === 0 ? 'z' : 'x';
      operate(p, row.name, 1, [], candidate => candidate.level === row.level && candidate.x === row.x && candidate.z === row.z,
        position => Math.sign(position[axis] - row[axis]) === side);
      assert.equal(Math.sign(p[axis] - row[axis]), -side, 'the original door orientation determines the opposite side');
      landing(p, row, `native two-way light barrier ${row.name} ${row.x},${row.z}`);
      assert.equal(stage(p), row.name === 'mourning_door_1_c' && side === 1 ? 40 : 20,
        'only an actual inward final crossing earns the chamber stage');
    }
  });

  check('both original low walls cross between their real east and west operation stands', () => {
    const rows = locRows.filter(row => row.name === 'mourning_temple_wall_jump');
    assert.equal(rows.length, 2);
    for (const row of rows) for (const side of [-1, 1]) {
      const p = fixture(20);
      operate(p, row.name, 1, [], candidate => candidate.x === row.x && candidate.z === row.z,
        position => Math.sign(position.x - row.x) === side);
      assert.equal(Math.sign(p.x - row.x), -side, 'the original wall has west/east approaches, not north/south');
      landing(p, row, `native two-way low wall ${row.x},${row.z}`);
      assert.equal(stage(p), 20);
    }
  });

  check('every temple stair uses the native visible handler and lands beside its independent map counterpart', () => {
    const counterparts = new Map([
      ['mourning_temple_circle_stairs_base', 'mourning_temple_circle_stairs_top'],
      ['mourning_temple_circle_stairs_top', 'mourning_temple_circle_stairs_base'],
      ['mourning_temple_stairs_base', 'mourning_temple_stairs_top'],
      ['mourning_temple_stairs_top', 'mourning_temple_stairs_base']
    ]);
    const rows = locRows.filter(row => counterparts.has(row.name));
    assert(rows.length > 0, 'original map contains the temple stairs');
    for (const row of rows) {
      const up = row.name.endsWith('_base'), level = row.level + (up ? 1 : -1);
      const counterpart = locRows.find(other => other.name === counterparts.get(row.name)
        && other.level === level && other.x === row.x && other.z === row.z);
      assert(counterpart, `${row.name} at ${row.level},${row.x},${row.z}: original matching stair`);
      const p = fixture(20);
      operate(p, row.name, 1, [], candidate => candidate.level === row.level && candidate.x === row.x && candidate.z === row.z);
      landing(p, counterpart, `${row.name} ${row.level},${row.x},${row.z}`);
    }
  });

  check('all four original wall ladders land beside their independently mapped opposing ladder', () => {
    const counterparts = new Map([
      ['mourning_temple_ladder_wall', 'mourning_temple_ladder_wall_top'],
      ['mourning_temple_ladder_wall_top', 'mourning_temple_ladder_wall']
    ]);
    const rows = locRows.filter(row => counterparts.has(row.name));
    assert.equal(rows.length, 4, 'the original map supplies both ends of two wall ladders');
    for (const row of rows) {
      const level = row.level + (row.name.endsWith('_top') ? -1 : 1);
      const candidates = rows.filter(other => other.name === counterparts.get(row.name) && other.level === level)
        .sort((a, b) => Math.abs(a.x - row.x) + Math.abs(a.z - row.z)
          - Math.abs(b.x - row.x) - Math.abs(b.z - row.z));
      const counterpart = candidates[0];
      assert(counterpart && Math.max(Math.abs(counterpart.x - row.x), Math.abs(counterpart.z - row.z)) <= 1,
        `${row.name}: original map retains the adjacent opposing ladder`);
      const p = fixture(20);
      operate(p, row.name, 1, [], candidate => candidate.level === row.level && candidate.x === row.x && candidate.z === row.z);
      landing(p, counterpart, `native wall ladder ${row.level},${row.x},${row.z}`);
    }
  });

  check('both native handhold approaches have the period five-damage fall and a real ground-stair recovery', () => {
    const rows = locRows.filter(row => row.name === 'mourning_temple_agility_hanging');
    assert.equal(rows.length, 9, 'all original hanging segments remain present');
    for (const row of rows) assert(ScriptProvider.getByTrigger(ServerTriggerType.OPLOC1,
      row.type, types.LocType.get(row.type).category), 'each retained segment resolves its native handler');
    const left = Math.min(...rows.map(row => row.x)), right = Math.max(...rows.map(row => row.x));
    for (const side of ['west', 'east']) {
      const row = rows.find(row => row.x === (side === 'west' ? left : right));
      const p = fixture(20), hp = p.levels[PlayerStat.HITPOINTS];
      random([0.999999, 0], () => operate(p, row.name, 1, [], candidate => candidate.x === row.x,
        position => side === 'west' ? position.x < row.x : position.x > row.x));
      assert.equal(p.levels[PlayerStat.HITPOINTS], hp - 5, 'the native fall deals exactly five hitpoints');
      assert.equal(p.level, row.level - 1, 'the native fall reaches the first floor');
      const stair = locRows.find(candidate => candidate.name === 'mourning_temple_circle_stairs_base'
        && candidate.level === p.level && Math.max(Math.abs(candidate.x - p.x), Math.abs(candidate.z - p.z)) <= 8);
      assert(stair, 'the fall reaches the original ground-floor stair area, not an unrelated open tile');
      landing(p, stair, `native ${side} handhold fall`);
      operate(p, stair.name, 1, [], candidate => candidate.level === stair.level
        && candidate.x === stair.x && candidate.z === stair.z);
      const top = locRows.find(candidate => candidate.name === 'mourning_temple_circle_stairs_top'
        && candidate.level === row.level && candidate.x === stair.x && candidate.z === stair.z);
      assert(top, 'the original stair has a second-floor counterpart');
      landing(p, top, `native ${side} handhold recovery`);
      assert.equal(stage(p), 20, 'a fall and recovery do not rewrite quest progress');
    }
  });

  check('native east-entrance zones require the earned trinket only after completion and never block west-side escape', () => {
    const thresholds = locRows.filter(row => row.name === 'mourning_floor_for_temple_door'
      && row.level === 0 && row.x === 1917 && row.z >= 4638 && row.z <= 4640);
    assert.equal(thresholds.length, 3, 'the original archway has three floor tiles between its retained frames');
    const enter = (p, start, destination) => {
      place(p, start);
      p.lastZone = CoordGrid.packCoord(p.level, (p.x >> 3) << 3, (p.z >> 3) << 3);
      p.lastMapZone = CoordGrid.packCoord(0, (p.x >> 6) << 6, (p.z >> 6) << 6);
      landing(p, start, 'original entrance approach');
      nativeStep(p, destination);
    };
    for (const row of thresholds) {
      const outside = { level: row.level, x: row.x + 3, z: row.z === 4638 ? 4637 : row.z };
      const entry = { level: row.level, x: row.x + 2, z: row.z };
      const arrive = p => {
        enter(p, outside, { ...entry, z: outside.z });
        if (outside.z !== entry.z) {
          nativeStep(p, entry);
          nativeStep(p, { ...entry, x: entry.x - 1 });
        }
      };
      for (const value of [20, 45, 50, 60]) {
        const p = fixture(value);
        arrive(p);
        if (value < 60) assert.deepEqual(tile(p),
          [entry.level, entry.x - (outside.z === entry.z ? 0 : 1), entry.z], 'normal quest entry remains available');
        else {
          assert(p.x >= outside.x, 'a missing-trinket east entrant is repelled to the tunnel side');
          landing(p, outside, 'native missing-trinket entrance repulsion');
        }
        assert.equal(stage(p), value, 'front-door enforcement does not alter quest progress');
      }
      const carried = fixture(60, ['mourning_crystal_trinket']);
      arrive(carried);
      for (let x = carried.x - 1; x >= row.x - 1; x--) nativeStep(carried, { ...entry, x });
      assert.equal(count(carried, 'mourning_crystal_trinket'), 1, 'access does not consume the earned trinket');
      landing(carried, row, 'native trinket entry through the original archway');
      const banked = fixture(60);
      banked.invAdd(bank, obj('mourning_crystal_trinket'), 1);
      arrive(banked);
      assert(banked.x >= outside.x, 'a banked trinket is not a carried access item');
      landing(banked, outside, 'native banked-trinket entrance repulsion');
      const escaping = fixture(60);
      const west = { ...entry, x: row.x - 6 };
      enter(escaping, west, { ...west, x: west.x + 1 });
      nativeStep(escaping, { ...west, x: 1913 });
      if (row.z !== 4639) nativeStep(escaping, { level: row.level, x: 1913, z: 4639 });
      for (let x = 1914; x <= row.x - 1; x++) nativeStep(escaping, { level: row.level, x, z: 4639 });
      if (row.z !== 4639) nativeStep(escaping, { ...west, x: row.x - 1 });
      for (let x = row.x; x <= row.x + 2; x++) nativeStep(escaping, { ...west, x });
      if (row.z === 4638) nativeStep(escaping, { ...west, x: row.x + 2, z: 4639 });
      nativeStep(escaping, { level: row.level, x: outside.x, z: escaping.z });
      landing(escaping, outside, 'native west-side escape without a trinket');
    }
  });
  check('turning inside an entrance zone, running, and losing the trinket on the east apron cannot bypass its gate', () => {
    for (const [approachZ, doorZ] of [[4637, 4638], [4641, 4640]]) {
      for (const running of [false, true]) for (const access of ['quest', 'carried', 'missing', 'banked', 'lost']) {
        const value = access === 'quest' ? 50 : 60;
        const p = fixture(value, ['carried', 'lost'].includes(access) ? ['mourning_crystal_trinket'] : []);
        if (access === 'banked') p.invAdd(bank, obj('mourning_crystal_trinket'), 1);
        place(p, { level: 0, x: 1920, z: approachZ });
        p.lastZone = CoordGrid.packCoord(0, 1920, (approachZ >> 3) << 3);
        p.lastMapZone = CoordGrid.packCoord(0, 1920, 4608);
        nativeStep(p, { level: 0, x: 1919, z: approachZ });
        assert.deepEqual(tile(p), [0, 1919, approachZ], 'the normal north/south approach is not itself a doorway crossing');
        nativeStep(p, { level: 0, x: 1919, z: doorZ });
        assert.deepEqual(tile(p), [0, 1919, doorZ], 'turning inside the same zone reaches its east apron');
        if (access === 'lost') del(p, 'mourning_crystal_trinket');
        nativeStep(p, { level: 0, x: running ? 1917 : 1918, z: doorZ }, running);
        if (access === 'quest' || access === 'carried') {
          for (let x = p.x - 1; x >= 1916; x--) nativeStep(p, { level: 0, x, z: doorZ });
          assert.deepEqual(tile(p), [0, 1916, doorZ], 'ordinary quest entry and carrying the trinket still permit passage');
        } else {
          assert(p.x >= 1920, `${access}: a turn or two-step run is repelled to the east tunnel`);
          assert(!p.timers.has(ScriptProvider.getByName('[softtimer,mep2_front_door_watch]').id),
            'repulsion releases the doorway watcher outside its two zones');
          landing(p, { level: 0, x: 1920, z: doorZ < 4640 ? 4632 : 4640 }, 'native side-approach repulsion');
        }
        assert.equal(stage(p), value, 'continuous doorway enforcement never changes quest progress');
      }
    }
  });


  check('native collection reconciles lost and banked pieces and a full-inventory reset without extra saved state', () => {
    const p = fixture(20);
    // Isolated preservation marker in the original one-bit field, not a pillar-state or stage seed.
    const reserved = 1 << 24;
    p.setVar(varp('varp578_bits'), reserved);
    operate(p, 'mourning_temple_light_wall_collector');
    assert.equal(count(p, 'mourning_mirror'), 4);
    assert.equal(count(p, 'mourning_crystal_yellow'), 1);
    useLoc(p, 'mourning_temple_pillar_2_9', 'mourning_mirror');
    const installed = pillarState(p);
    fullInventory(p, 'rune_scimitar');
    operate(p, 'mourning_temple_pillar_2_9', 1, [2]);
    assert.equal(count(p, 'mourning_mirror'), 3);
    assert.deepEqual(pillarState(p), installed, 'a full inventory cannot destroy an installed piece');
    del(p, 'rune_scimitar', 1);
    takePiece(p, 'mourning_temple_pillar_2_9', 'mourning_mirror');
    p.invDel(inv, obj('mourning_mirror'), 2);
    p.invAdd(bank, obj('mourning_mirror'), 2);
    useLoc(p, 'mourning_temple_pillar_2_9', 'mourning_mirror');
    operate(p, 'mourning_temple_light_wall_collector');
    assert.equal(count(p, 'mourning_mirror'), 1, 'held, installed and banked pieces count toward the same entitlement');
    del(p, 'mourning_mirror', 1);
    operate(p, 'mourning_temple_light_wall_collector');
    assert.equal(count(p, 'mourning_mirror'), 1, 'a missing held piece is recoverable');
    assert.equal(p.invTotal(bank, obj('mourning_mirror')), 2);
    useLoc(p, 'mourning_temple_pillar_3_16', 'mourning_mirror');
    fullInventory(p, 'rune_scimitar');
    operate(p, 'mourning_temple_light_wall_lever');
    assert.deepEqual(pillarState(p), [0, 0, 0, reserved, 0],
      'reset clears all installed states, including slot31, and preserves the original unrelated bit');
    assert.equal(count(p, 'mourning_mirror'), 0, 'reset does not force pieces into a full inventory');
    operate(p, 'mourning_temple_light_wall_collector');
    assert.equal(count(p, 'mourning_mirror'), 0, 'full collection leaves the deficit recoverable');
    for (const expected of [1, 2]) {
      del(p, 'rune_scimitar', 1);
      operate(p, 'mourning_temple_light_wall_collector');
      assert.equal(count(p, 'mourning_mirror'), expected, 'each newly available slot recovers one deferred piece');
    }
    operate(p, 'mourning_temple_light_wall_collector');
    assert.equal(count(p, 'mourning_mirror'), 2, 'repeat collection cannot duplicate owned stock');
    assert.equal(p.invTotal(bank, obj('mourning_mirror')), 2, 'banked stock is neither lost nor duplicated');
    del(p, 'mourning_crystal_yellow', 1);
    operate(p, 'mourning_temple_light_wall_collector');
    assert.equal(count(p, 'mourning_crystal_yellow'), 1, 'the initial colour crystal has the same loss recovery');
    assert.equal(p.getVar(varp('varp578_bits')) & reserved, reserved);
    assert.equal(stage(p), 20);
  });

  check('the black-crystal sample must be handed over before the Temple puzzle can advance', () => {
    const p = fixture(15, ['mourning_mirror']);
    operate(p, 'mourning_temple_light_wall_collector');
    assert.equal(count(p, 'mourning_mirror'), 1);
    assert.equal(count(p, 'mourning_crystal_yellow'), 0);
    useLoc(p, 'mourning_temple_pillar_2_9', 'mourning_mirror');
    assert.equal(count(p, 'mourning_mirror'), 1, 'premature use does not consume the supplied mirror');
    assert.deepEqual(pillarState(p), [0, 0, 0, 0, 0]);
    assert.equal(stage(p), 15, 'the player remains able to hand the sample to Arianwyn');
  });

  check('six original crystal items filter white light and removal restores genuine unfiltered white', () => {
    const colours = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'];
    // White is original beam colour7, not an invented seventh inventory item.
    const p = fixture(20, colours.filter(name => name !== 'yellow').map(name => `mourning_crystal_${name}`));
    for (const step of puzzleRecipe.slice(0, 7)) recipeStep(p, step);
    const installed = pillarState(p), previews = new Set();
    const previewIds = new Set(Array.from({ length: 6 }, (_, index) => id('Component', `rotate_mirror:com_${index + 8}`)));
    operate(p, 'mourning_temple_pillar_2_9', 1, [1]);
    assert.equal(p.modalMain, id('Component', 'rotate_mirror'), 'Search opens the original cached mirror interface');
    for (let turn = 0; turn < 6; turn++) {
      const latest = new Map();
      for (let index = p.packets.length - 1; index >= 0 && latest.size < 6; index--) {
        const packet = p.packets[index];
        if (packet instanceof IfSetHide && previewIds.has(packet.component) && !latest.has(packet.component)) {
          latest.set(packet.component, packet.hidden);
        }
      }
      assert.equal(latest.size, 6, 'the native UI supplies every cached orientation layer');
      const shown = [...latest].filter(([, hidden]) => !hidden);
      assert.equal(shown.length, 1, 'exactly one original orientation preview is visible');
      previews.add(shown[0][0]);
      assert(button(p, 'rotate_mirror:com_16')); finish(p);
    }
    assert.equal(previews.size, 6, 'six native rotations show all six different cached previews');
    assert.deepEqual(pillarState(p), installed, 'the sixth rotation wraps to the original physical mirror pose');
    p.closeModal();
    const beam = id('VarBitType', 'mourning_light_temple_2_11_15');
    assert.equal(p.getVarBit(beam), 7, 'an empty pillar transmits the actual white source');
    for (const [index, colour] of colours.entries()) {
      const item = `mourning_crystal_${colour}`;
      useLoc(p, 'mourning_temple_pillar_2_11', item);
      assert.equal(p.getVarBit(beam), index + 1, `the native ${colour} filter transmits its original client colour`);
      takePiece(p, 'mourning_temple_pillar_2_11', item, 1);
      assert.equal(p.getVarBit(beam), 7, 'removing the actual filter restores unfiltered white light');
    }
  });

  check('the native menu and collision reject a genuine non-complementary blue beam', () => {
    const p = fixture(20, ['mourning_crystal_blue']);
    for (const step of puzzleRecipe.slice(0, 7)) recipeStep(p, step);
    useLoc(p, 'mourning_temple_pillar_2_11', 'mourning_crystal_blue');
    useLoc(p, 'mourning_temple_pillar_2_15', 'mourning_mirror');
    aimPiece(p, 'mourning_temple_pillar_2_15', { '2_15_east': 5 });
    const target = loc(p, 'mourning_door_2_16_west');
    stand(p, target, position => position.x > target.x);
    const before = tile(p), visible = visibleLoc(types.LocType.get(target.type), p);
    assert.equal(visible.debugname, 'mourning_door_of_light_blue', 'a non-complementary beam leaves the original blue barrier');
    assert(visible.op === null || !visible.op.some(Boolean), 'the original closed form has no native Pass option');
    p.resetEntity(false); p.moveSpeed = MoveSpeed.WALK;
    p.queueWaypoint(target.x, target.z); p.updateMovement(); p.processEngineQueue();
    assert.deepEqual(tile(p), before, 'native movement cannot cross the closed light barrier');
    assert.equal(stage(p), 20);
  });

  check('native Shadow and Dark Beast aggression remains enabled after target loss', () => {
    for (const name of ['mourning_shadow_beast', 'mourning_dark_beast']) {
      const p = fixture(20), n = npc(p, name, true);
      assert.equal(types.HuntType.get(n.huntMode).debugname, 'aggressive_melee');
      assert(n.getVar(id('VarNpcType', 'npc_combat_xp_multiplier')) > 0,
        'the native default spawn initializes combat XP');
      n.resetDefaults();
      assert.equal(types.HuntType.get(n.huntMode).debugname, 'aggressive_melee',
        'a cleared target does not permanently disable aggression');
      showNpc(p, n);
      random([0.999999, 0, 0.999999], () => npcAttack(p, n, 'AI_OPPLAYER2'));
      const hit = [...p.queue.all()].find(request => request.script.name === '[queue,combat_damage_player]');
      assert(hit && hit.args[0] > 0 && hit.delay === 0, 'natural contact aggression uses native melee damage');
    }
  });

  check('native Dark Beast retaliation opens with magic, then uses melee and an out-of-reach spell', () => {
    const p = fixture(5), n = npc(p, 'mourning_dark_beast', true); arm(p);
    random([0.999999, 0, 0.999999], () => attackNpc(p, n));
    assert([...n.queue.all()].some(request => request.queueId === ServerTriggerType.AI_QUEUE1),
      'the real player attack schedules native retaliation');
    n.processQueue();
    assert.equal(n.targetOp, NpcMode.APPLAYER2);
    const delay = id('VarNpcType', 'npc_action_delay');
    const attacks = () => [...p.queue.all()].filter(request => request.script.name === '[queue,combat_damage_player]');
    World.currentTick = n.getVar(delay);
    random([0.999999, 0, 0.999999], () => npcAttack(p, n, 'AI_APPLAYER2'));
    assert.equal(attacks().at(-1).args[0], 8, 'the sourced opening spell maximum uses the native damage queue');
    assert(attacks().at(-1).delay > 0, 'the spell retains native projectile delivery');
    assert.equal(n.getVar(id('VarNpcType', 'npc_attacking_uid')), p.uid);
    World.currentTick = n.getVar(delay);
    random([0.999999, 0, 0.999999], () => npcAttack(p, n, 'AI_APPLAYER2'));
    assert.equal(attacks().at(-1).delay, 0, 'the following adjacent attack is melee');
    assert(attacks().at(-1).args[0] > 8, 'the melee hit uses native Strength rather than the spell cap');
    let ranged = false;
    for (let dx = -7; dx <= 7 && !ranged; dx++) for (let dz = -7; dz <= 7 && !ranged; dz++) {
      const position = { level: n.level, x: n.x + dx, z: n.z + dz };
      if (!floors.has(`${position.level},${position.x},${position.z}`)
        || map.isMapBlocked(position.x, position.z, position.level)) continue;
      place(p, position);
      if (n.inOperableDistance(p) || !n.inApproachDistance(types.NpcType.get(n.type).attackrange, p)) continue;
      landing(p, n, 'native Dark Beast ranged fighting floor');
      ranged = true;
    }
    assert(ranged, 'the original cavern contains a collision-safe ranged attack position');
    World.currentTick = n.getVar(delay);
    random([0.999999, 0, 0.999999], () => npcAttack(p, n, 'AI_APPLAYER2'));
    assert.equal(attacks().at(-1).args[0], 8);
    assert(attacks().at(-1).delay > 0, 'an out-of-reach target receives the native spell, not a melee hit');
  });

  check('a native Dark Beast kill credits the real attacker and creates its labelled ordinary coin drop', () => {
    const p = fixture(5), n = npc(p, 'mourning_dark_beast', true); arm(p);
    // Scaled unit fixture: one remaining NPC hitpoint; damage, hero credit and death are all native.
    n.levels[NpcStat.HITPOINTS] = 1;
    const before = p.stats.reduce((sum, value) => sum + value, 0);
    random([0.999999, 0, 0.999999], () => attackNpc(p, n));
    assert.equal(n.heroPoints.findHero(), p.hash64, 'native damage, not a seeded hero entry, earns kill credit');
    assert(p.stats.reduce((sum, value) => sum + value, 0) > before, 'ordinary combat grants native XP');
    for (let step = 0; step < 8 && n.isActive; step++) {
      World.currentTick++;
      n.turn();
    }
    assert.equal(n.isActive, false, 'native damage and death queues remove the beast');
    const loot = World.getObj(n.x, n.z, n.level, obj('coins'), p.hash64);
    assert(loot, 'the ordinary native death_drop reaches the credited attacker');
    assert.equal(loot.count, 100, 'UNKNOWN documented fallback, not a claimed historical loot table');
    assert.equal(stage(p), 5, 'an ordinary kill does not forge quest progress');
  });

  check('native Dark Beast Attack requires Slayer 90 on the original cavern floor', () => {
    for (const slayer of [89, 90]) {
      const p = fixture(5);
      p.baseLevels.fill(99); p.levels.fill(99);
      p.baseLevels[PlayerStat.SLAYER] = slayer; p.levels[PlayerStat.SLAYER] = slayer;
      arm(p);
      const n = npc(p, 'mourning_dark_beast', true);
      const hp = n.levels[NpcStat.HITPOINTS];
      attackNpc(p, n);
      const damage = [...n.queue.all()].filter(request => request.queueId === ServerTriggerType.AI_QUEUE2);
      assert.equal(damage.length > 0, slayer === 90, `Slayer ${slayer}: actual native NPC damage scheduling`);
      assert.equal(n.levels[NpcStat.HITPOINTS], hp, 'damage is queued, not manufactured by the test');
      assert.equal(stage(p), 5);
      landing(p, n, `Dark Beast Slayer ${slayer} fighting floor`);
    }
  });
  check('one native start-to-reward path solves all six doors and earns the Death chamber without any quest-state seed', () => {
    const p = fixture(0, ['chisel', 'rope', 'death_talisman']); disguise(p);
    p.baseLevels.fill(99); p.levels.fill(99);
    const before = { xp: p.stats[PlayerStat.AGILITY], qp: integer('count_questpoints', p) };
    talk(p, 'mourning_arianwyn', [1]); assert.equal(stage(p), 1);
    talk(p, 'mourner_hideout_head_mourner'); assert.equal(stage(p), 5);
    const gate = locRows.find(row => row.name === 'mourner_hideout_door4');
    for (let index = 0; index < 4; index++) { tick(p); World.processZones(); }
    operate(p, gate.name, 1, [], undefined, position => position.x >= gate.x);
    assert(p.x < gate.x, 'native key and disguise open the cavern entrance');
    operate(p, 'mourning_dead_guard1'); assert.equal(stage(p), 10);
    assert(held(p, 'mourning_ederns_journal', 1)); finish(p); p.closeModal(); assert.equal(stage(p), 15);
    talk(p, 'mourning_arianwyn');
    useLoc(p, 'mourning_temple_obsidian_crystal_dead', 'chisel');
    useNpc(p, 'mourning_arianwyn', 'mourning_crystal_sample'); assert.equal(stage(p), 20);
    assert.equal(count(p, 'mourning_crystal_new_sample'), 1);
    for (const step of puzzleRecipe) recipeStep(p, step);
    assert.equal(stage(p), 40);
    assert.equal(p.getVarBit(id('VarBitType', 'mourning_light_door_1_c_first_time')), 1, 'real final crossing reveals Thorgel');
    talk(p, 'mourning_deathalter_dwarf_vis');
    assert.equal(count(p, 'death_talisman'), 1);
    assert.equal(count(p, 'mourning_deathalter_list'), 0, 'pre-existing talisman takes the period alternative');
    const ruins = useLoc(p, 'deathtemple_ruined', 'death_talisman', row => row.x < 2000);
    const altar = locRows.find(row => row.name === 'death_altar' && row.z > 4800);
    useLoc(p, 'death_altar', 'mourning_crystal_new_sample', row => row.x === altar.x && row.z === altar.z);
    assert.equal(stage(p), 45);
    operate(p, 'deathtemple_exit_portal', 1, [], row => row.z > 4800);
    landing(p, ruins, 'full-route native Death-temple exit');
    for (const step of puzzleReturnRecipe) recipeStep(p, step);
    assert.equal(stage(p), 45, 'the necessary return rotation preserves the charged-crystal stage');
    useLoc(p, 'mourning_temple_obsidian_crystal_dead', 'mourning_crystal_new_powered');
    assert.equal(stage(p), 50);
    talk(p, 'mourning_arianwyn');
    assert.equal(stage(p), 60);
    assert.equal(p.stats[PlayerStat.AGILITY] - before.xp, 200_000);
    assert.equal(integer('count_questpoints', p) - before.qp, 2);
    assert.equal(count(p, 'mourning_crystal_trinket'), 1);
    assert.equal(p.getVar(varp('mourning_quest')), 8);
    p.closeModal();
  });
  if (process.env.MEP2_MAP_GUIDE) fs.writeFileSync(process.env.MEP2_MAP_GUIDE,
    `${JSON.stringify({ protocol: 'mep2-native-map-approaches/v1', approaches: [...approaches.values()],
      puzzleRecipe, puzzleReturnRecipe }, null, 2)}\n`);
  console.log(`PASS Mourning's Ends Part II: ${checks} packed-VM checks`);
} finally {
  for (const p of actors) {
    World.players[p.pid] = undefined; p.unlink(); rsbuf.removePlayer(p.slot);
  }
  for (const n of avatars) World.removeNpc(n, -1);
}
process.exit(0); // The shared VM runtime owns background workers, as in the Part I and swamp-cave tests.
