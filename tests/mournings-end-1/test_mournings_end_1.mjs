#!/usr/bin/env node
// Packed VM proof. Fixtures seed personal state; every product operation uses native dispatch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  World, PlayerStat, ScriptProvider, ScriptState, ServerTriggerType, contentRoot,
  engineModule, types, map, id, obj, inv, worn, invCom, player, count, slotOf,
  held, remove, use, execute, resumeDialogue, dialoguePage, tick, weakCount,
  button, Packet, PlayerLoading
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
const rsbuf = await engineModule('network/rsbuf/index.ts');
const npcHandler = new OpNpcHandler(), npcUseHandler = new OpNpcUHandler();
const locHandler = new OpLocHandler(), locUseHandler = new OpLocUHandler();
const bank = id('InvType', 'bank');
const varp = name => id('VarPlayerType', name);
const varnpc = name => id('VarNpcType', name);
const bit = name => id('VarBitType', name);
const stage = p => p.getVar(varp('mourning_quest'));
const setStage = (p, value) => p.setVar(varp('mourning_quest'), value);
const bits = p => p.getVar(varp('mourning_quest_bits'));
const hasBit = (p, index) => (bits(p) >>> index) & 1;
const add = (p, name, amount = 1) => p.invAdd(inv, obj(name), amount);
const del = (p, name, amount = count(p, name)) => p.invDel(inv, obj(name), amount);
const tile = p => [p.level, p.x, p.z];
const questConstants = fs.readFileSync(path.join(contentRoot, 'scripts/general/configs/quest.constant'), 'utf8');
const rovingConstants = fs.readFileSync(path.join(contentRoot, 'scripts/quests/quest_roving_elves/configs/roving.constant'), 'utf8');
function constant(name, source = questConstants) {
  const match = source.match(new RegExp(`^\\^${name}\\s*=\\s*(-?\\d+)\\s*$`, 'm'));
  assert(match, `checked-out prerequisite constant ${name}`);
  return Number(match[1]);
}
const outfit = ['gasmask', 'mourning_mourner_top', 'mourning_mourner_legs',
  'mourning_mourner_gloves', 'mourning_mourner_boots', 'mourning_mourner_cloak'];
const loot = ['gasmask', 'mourning_bloody_mourner_top', 'mourning_ripped_mourner_legs',
  'mourning_mourner_gloves', 'mourning_mourner_boots', 'mourning_mourner_cloak', 'mourning_mourner_message'];
const actors = new Set(), avatars = new Set();
let checks = 0;
function check(label, action) { action(); checks++; console.log(`PASS ${label}`); }
function fixture(initialStage = 0, items = []) {
  const p = player(); actors.add(p); rsbuf.addPlayer(p.slot);
  setStage(p, initialStage);
  p.setVar(varp('chompybird'), constant('chompybird_complete'));
  p.setVar(varp('sheepherderquest'), constant('sheepherder_complete'));
  p.setVar(varp('roving_elves_quest'), constant('roving_complete', rovingConstants));
  p.setVar(varp('biohazard'), constant('biohazard_complete'));
  p.setVarBit(bit('plaguecity_elena_at_home'), 1);
  p.setVar(varp('regicide_quest'), constant('regicide_complete'));
  p.setVar(varp('waterfall_quest'), constant('waterfall_complete'));
  for (const item of items) add(p, item);
  return p;
}
function wear(p, name) {
  const type = types.ObjType.get(obj(name));
  assert(type.wearpos >= 0, `${name} has a packed wear slot`);
  p.getInventory(worn).set(type.wearpos, { id: type.id, count: 1 });
}
function disguise(p) { for (const name of outfit) wear(p, name); }
function emptyInventory(p) {
  for (let slot = 0; slot < types.InvType.get(inv).size; slot++) p.getInventory(inv).set(slot, null);
}
function fullInventory(p) {
  while (p.invFreeSpace(inv) > 0) add(p, 'spade');
  assert.equal(p.invFreeSpace(inv), 0);
}
function place(p, position) {
  p.level = position.level; p.x = position.x; p.z = position.z;
  p.originX = p.x; p.originZ = p.z; p.clearInteraction();
}
function finish(p, choices = []) {
  const pending = [...choices];
  for (let step = 0; step < 240; step++) {
    const state = p.activeScript;
    if (!state) {
      if (weakCount(p) === 0) break;
      tick(p); continue;
    }
    assert.notEqual(state.execution, ScriptState.ABORTED, 'native product script does not abort');
    if (state.execution === ScriptState.PAUSEBUTTON) {
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      if (/^multi[2-5]$/.test(root)) {
        assert(pending.length, `explicit choice for ${root}: ${dialoguePage(p).join(' ')}`);
        resumeDialogue(p, pending.shift());
      } else resumeDialogue(p);
    } else if (state.execution === ScriptState.SUSPENDED) tick(p);
    else if (state.execution === ScriptState.FINISHED) break;
    else assert.fail(`unexpected native execution state ${state.execution}`);
  }
  assert.equal(pending.length, 0, 'every declared choice was offered');
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED, 'native operation settles');
}
function packedTrigger(p, expected) {
  const trigger = p.getOpTrigger();
  assert(trigger, `${expected}: native dispatch finds an operation`);
  assert.equal(trigger.name, expected, 'dispatch selects the player-visible form, not a direct handler call');
  assert(ScriptProvider.getByName(trigger.name), `${expected} is packed`);
  return trigger;
}

// Placement and floor oracles come from the original map/name tables, never MEP1 constants.
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
function locVisible(type, p) {
  const value = type.multivarp !== -1 ? p.getVar(type.multivarp)
    : type.multivarbit !== -1 ? p.getVarBit(type.multivarbit) : -1;
  return value >= 0 && value < type.multiloc.length && type.multiloc[value] !== -1
    ? types.LocType.get(type.multiloc[value]) : type;
}
function tryStand(p, target, accept = () => true) {
  for (let distance = typeof target.shape === 'number' ? 0 : 1; distance <= 8; distance++) {
    for (let dx = -distance; dx <= distance; dx++) for (let dz = -distance; dz <= distance; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== distance) continue;
      const position = { level: target.level, x: target.x + dx, z: target.z + dz };
      if (!accept(position) || !floors.has(`${position.level},${position.x},${position.z}`) || map.isMapBlocked(position.x, position.z, position.level)) continue;
      place(p, position);
      if (p.inOperableDistance(target)) return true;
    }
  }
  return false;
}
function stand(p, target, accept) {
  assert(tryStand(p, target, accept), `collision-safe operation stand for ${target.type}`);
}
function npc(p, name) {
  const wanted = id('NpcType', name);
  let actor = [...World.npcs].find(n => n.isActive && resolveNpcType(types.NpcType.get(n.type), p).id === wanted);
  if (!actor) {
    const row = npcRows.find(row => resolveNpcType(types.NpcType.get(row.type), p).id === wanted);
    assert(row, `${name} resolves from an original NPC map placement`);
    const type = types.NpcType.get(row.type);
    actor = new Npc(row.level, row.x, row.z, type.size, type.size, EntityLifeCycle.RESPAWN,
      World.npcs.next(), type.id, type.blockwalk);
    World.addNpc(actor, -1); avatars.add(actor); actor.lastMovement = -100;
    const spawn = ScriptProvider.getByTrigger(ServerTriggerType.AI_SPAWN, type.id, type.category);
    assert(spawn, `${name} has a native spawn handler`);
    const state = ScriptRunner.init(spawn, actor); actor.executeScript(state);
    assert.equal(state.execution, ScriptState.FINISHED, 'native spawn finishes');
  }
  return actor;
}
function loc(p, name, predicate = () => true) {
  const category = name.startsWith('_') ? id('CategoryType', name.slice(1)) : -1;
  for (const row of locRows) {
    const type = locVisible(types.LocType.get(row.type), p);
    if (!predicate(row) || (category === -1 ? type.debugname !== name : type.category !== category)) continue;
    if (category !== -1 && ScriptProvider.getByTrigger(ServerTriggerType.OPLOCU, type.id, type.category)?.name !== `[oplocu,${name}]`) continue;
    const target = World.getLoc(row.x, row.z, row.level, row.type);
    if (target && tryStand(p, target)) return target;
  }
  assert.fail(`${name} resolves from an operable original packed loc placement`);
}
function showNpc(p, n) {
  stand(p, n); rsbuf.addNpc(n.nid, n.type);
  const appearance = p.generateAppearance();
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, appearance, p.lastAppearance,
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
  assert(rsbuf.hasNpc(p.slot, n.nid), 'real visibility encoder exposes the NPC to this player');
}
function talk(p, name, choices = [], option = 1) {
  const n = npc(p, name); showNpc(p, n);
  assert(npcHandler.handle(new OpNpc(option, n.nid), p), `${name}: native NPC option accepted`);
  packedTrigger(p, `[opnpc${option},${name}]`); p.processInteraction(); finish(p, choices);
  return n;
}
function useNpc(p, name, item) {
  const n = npc(p, name); showNpc(p, n);
  assert(npcUseHandler.handle(new OpNpcU(n.nid, obj(item), slotOf(p, item), invCom), p));
  packedTrigger(p, `[opnpcu,${name}]`); p.processInteraction(); finish(p);
  return n;
}
function operateLoc(p, name, option = 1, choices = [], predicate = () => true, approach) {
  const target = loc(p, name, predicate); stand(p, target, approach);
  assert(locHandler.handle(new OpLoc(option, target.x, target.z, target.type), p));
  packedTrigger(p, `[oploc${option},${name}]`); p.processInteraction(); finish(p, choices);
  return target;
}
function useLoc(p, name, item, expected = `[oplocu,${name}]`, predicate = () => true) {
  const target = loc(p, name, predicate); stand(p, target);
  assert(locUseHandler.handle(new OpLocU(target.x, target.z, target.type, obj(item), slotOf(p, item), invCom), p));
  packedTrigger(p, expected); p.processInteraction(); finish(p); return target;
}
function useItems(p, item, target) { assert(use(p, item, target)); finish(p); }
function landing(p, counterpart, label) {
  assert.equal(p.level, counterpart.level, `${label}: correct counterpart level`);
  assert(Math.max(Math.abs(p.x - counterpart.x), Math.abs(p.z - counterpart.z)) <= 8,
    `${label}: landing is beside the original counterpart, not merely a copied constant`);
  assert(floors.has(tile(p).join(',')), `${label}: retained map floor exists`);
  assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, `${label}: actual landing is walkable`);
  for (let radius = 2; radius <= 8; radius++) {
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      const x = p.x + dx, z = p.z + dz;
      if (!floors.has(`${p.level},${x},${z}`) || map.isMapBlocked(x, z, p.level)) continue;
      const route = [...map.findPath(p.level, p.x, p.z, x, z)];
      if (route.length && route.at(-1) === CoordGrid.packCoord(p.level, x, z)) {
        console.log(`MAP ${label}: ${tile(p).join(',')} -> ${p.level},${x},${z}; ${route.length} waypoint(s)`);
        return;
      }
    }
  }
  assert.fail(`${label}: no non-empty packed-map route out of the actual landing`);
}
function random(values, action) {
  const original = JavaRandom.nextDouble; let cursor = 0;
  JavaRandom.nextDouble = () => { assert(cursor < values.length, 'bounded native RNG input'); return values[cursor++]; };
  try { const result = action(); assert.equal(cursor, values.length, 'native accuracy consumes its inputs'); return result; }
  finally { JavaRandom.nextDouble = original; }
}
function ai(p, n) {
  const type = types.NpcType.get(n.type);
  const script = ScriptProvider.getByTrigger(ServerTriggerType.AI_OPPLAYER2, type.id, type.category);
  assert.equal(script?.name, `[ai_opplayer2,${type.debugname}]`);
  const state = ScriptRunner.init(script, n, p); state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  n.executeScript(state); assert.equal(state.execution, ScriptState.FINISHED); return state;
}
function death(p, n, hero = true) {
  n.heroPoints.clear();
  if (hero) n.heroPoints.addHero(p.hash64, n.levels[NpcStat.HITPOINTS]);
  const type = types.NpcType.get(n.type);
  const script = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, type.id, type.category);
  assert.equal(script?.name, `[ai_queue3,${type.debugname}]`);
  const state = ScriptRunner.init(script, n);
  const additions = [], original = World.addObj;
  World.addObj = function(item, receiver, duration) {
    additions.push({ name: types.ObjType.get(item.type).debugname, amount: item.count, receiver, duration });
    return original.call(this, item, receiver, duration);
  };
  try {
    n.applyDamage(n.levels[NpcStat.HITPOINTS], 1); n.executeScript(state);
    for (let step = 0; state.execution === ScriptState.NPC_SUSPENDED && step < 40; step++) {
      for (const actor of actors) actor.processQueues();
      World.currentTick = Math.max(World.currentTick + 1, n.delayedUntil);
      n.delayed = false; n.executeScript(state);
    }
  } finally { World.addObj = original; }
  assert.equal(state.execution, ScriptState.FINISHED, 'native death completes');
  return additions;
}
function takeOffGun(p) {
  if (count(p, 'mourning_paint_gun', worn)) { assert(remove(p, 'mourning_paint_gun')); finish(p); }
}
function loadGun(p, toad) {
  takeOffGun(p); useItems(p, toad, 'mourning_paint_gun');
  assert(held(p, 'mourning_paint_gun', 2)); finish(p);
  assert.equal(count(p, 'mourning_paint_gun', worn), 1, 'native Wield equips the fixed device');
  assert(p.getVar(varp('com_rangeattack')) > 0, 'native ranged hit roll is available without a ranged weapon category');
}
function questPoints(p) {
  const state = execute('[proc,count_questpoints]', p);
  assert.equal(state.isp, 1); return state.popInt();
}

try {
  check('all quest objects are untradeable, original ids resolve, and repair state is saved/server-only', () => {
    const source = fs.readFileSync(path.join(contentRoot, 'scripts/quests/quest_mourning/configs/mep1_items.obj'), 'utf8');
    const names = [...source.matchAll(/^\[([^\]]+)\]/gm)].map(match => match[1]);
    assert(names.length > 0);
    for (const name of [...names, 'gasmask']) assert.equal(types.ObjType.get(obj(name)).tradeable, false, name);
    assert.equal(types.ObjType.get(obj('mourning_paint_gun')).category, -1, 'fixed device is not generic disposable ranged ammunition');
    const state = types.VarPlayerType.get(varp('mep1_oronwen_ready_at'));
    assert.equal(state.transmit, false);
    assert.match(fs.readFileSync(path.join(contentRoot, 'scripts/quests/quest_mourning/configs/quest_mourning.varp'), 'utf8'), /\[mep1_oronwen_ready_at\][\s\S]*?scope=perm/);
  });

  check('reverse bellows hooks preserve native cape recolouring and dye mixing in both quest states', () => {
    for (const value of [0, 4]) {
      for (const [dye, product] of [['reddye', 'red_cape'], ['bluedye', 'blue_cape'], ['yellowdye', 'yellow_cape'], ['greendye', 'green_cape']]) {
        for (const reverse of [false, true]) {
          const p = fixture(value, [dye, 'black_cape']); const xp = p.stats[PlayerStat.CRAFTING];
          useItems(p, ...(reverse ? ['black_cape', dye] : [dye, 'black_cape']));
          assert.equal(count(p, dye), 0); assert.equal(count(p, 'black_cape'), 0);
          assert.equal(count(p, product), 1); assert.equal(p.stats[PlayerStat.CRAFTING] - xp, 25);
          assert.equal(stage(p), value);
        }
      }
      for (const [first, second, product] of [['reddye', 'bluedye', 'purpledye'], ['reddye', 'yellowdye', 'orangedye'], ['bluedye', 'yellowdye', 'greendye']]) {
        for (const reverse of [false, true]) {
          const p = fixture(value, [first, second]);
          useItems(p, ...(reverse ? [second, first] : [first, second]));
          assert.equal(count(p, first), 0); assert.equal(count(p, second), 0);
          assert.equal(count(p, product), 1); assert.equal(stage(p), value);
        }
      }
    }
  });

  check('start rejects each missing prerequisite and preserves the Roving Elves seam', () => {
    for (const [name, value] of [['chompybird', constant('chompybird_complete') - 1], ['sheepherderquest', constant('sheepherder_complete') - 1]]) {
      const p = fixture(); p.setVar(varp(name), value);
      talk(p, 'roving_female_woodelf'); assert.equal(stage(p), 0); assert.equal(count(p, 'mourning_teleport_crystal_4'), 0);
    }
    for (const [stat, value] of [[PlayerStat.RANGED, 59], [PlayerStat.THIEVING, 49]]) {
      const p = fixture(); p.baseLevels[stat] = value; p.levels[stat] = value;
      talk(p, 'roving_female_woodelf'); assert.equal(stage(p), 0);
    }
    const p = fixture(); p.setVar(varp('roving_elves_quest'), 0);
    talk(p, 'roving_female_woodelf'); assert.equal(stage(p), 0);
    assert(p.packets.some(packet => packet.constructor.name === 'IfSetText' && packet.text.includes('Please speak to Islwyn first.')));
    assert.equal(count(p, 'mourning_teleport_crystal_4'), 0, 'incomplete Roving Elves cannot be skipped by MEP1');
  });

  const walk = fixture();
  check('exact skill boundaries start, escort lands beside native Arianwyn, first crystal has four charges', () => {
    walk.baseLevels[PlayerStat.RANGED] = 60; walk.levels[PlayerStat.RANGED] = 60;
    walk.baseLevels[PlayerStat.THIEVING] = 50; walk.levels[PlayerStat.THIEVING] = 50;
    talk(walk, 'roving_female_woodelf', [1]);
    assert.equal(stage(walk), 1); assert.equal(count(walk, 'mourning_teleport_crystal_4'), 1);
    const counterpart = npcRows.find(row => row.name === 'mourning_arianwyn'); assert(counterpart);
    landing(walk, counterpart, 'Eluned escort');
    talk(walk, 'mourning_arianwyn'); assert.equal(stage(walk), 2);
    talk(walk, 'mourning_arianwyn'); assert.equal(stage(walk), 2);
  });

  check('full inventory and refusal do not consume the first escort; banked crystals prevent duplicates', () => {
    const p = fixture(); fullInventory(p); talk(p, 'roving_female_woodelf', [1]); assert.equal(stage(p), 0);
    const q = fixture(); talk(q, 'roving_female_woodelf', [2]); assert.equal(stage(q), 0);
    const r = fixture(1); r.invAdd(bank, obj('mourning_teleport_crystal_2'), 1);
    talk(r, 'roving_female_woodelf', [1]); assert.equal(count(r, 'elf_crystal_tiny'), 0);
  });

  check('Activate consumes exactly one charge, refuses deep wilderness, and 750 coins recharge only three', () => {
    const p = fixture(1, ['mourning_teleport_crystal_4']);
    const counterpart = npcRows.find(row => row.name === 'mourning_arianwyn');
    const charges = ['mourning_teleport_crystal_4', 'mourning_teleport_crystal_3', 'mourning_teleport_crystal_2', 'mourning_teleport_crystal_1', 'elf_crystal_tiny'];
    for (let index = 0; index < charges.length - 1; index++) {
      place(p, { level: 0, x: 3200, z: 3200 });
      assert(held(p, charges[index], 1)); finish(p);
      assert.equal(count(p, charges[index]), 0); assert.equal(count(p, charges[index + 1]), 1);
      landing(p, counterpart, `crystal charge ${4 - index}`);
    }
    add(p, 'coins', 749); talk(p, 'roving_female_woodelf', [1]);
    assert.equal(count(p, 'elf_crystal_tiny'), 1); assert.equal(count(p, 'coins'), 749);
    add(p, 'coins'); talk(p, 'roving_female_woodelf', [1]);
    assert.equal(count(p, 'elf_crystal_tiny'), 0); assert.equal(count(p, 'coins'), 0);
    assert.equal(count(p, 'mourning_teleport_crystal_3'), 1);
    place(p, { level: 0, x: 3200, z: 3900 }); const before = tile(p);
    assert(held(p, 'mourning_teleport_crystal_3', 1)); finish(p);
    assert.deepEqual(tile(p), before); assert.equal(count(p, 'mourning_teleport_crystal_3'), 1);
  });

  check('lost crystals recover at every intermediate stage without granting repeated free charges', () => {
    for (let value = 1; value <= 8; value++) {
      const p = fixture(value); talk(p, 'roving_female_woodelf', [1]);
      assert.equal(stage(p), value); assert.equal(count(p, 'elf_crystal_tiny'), 1);
      assert.equal(count(p, 'mourning_teleport_crystal_4'), 0);
    }
  });

  check('all three original Arandar Mourners recover private outfit/letter drops at every intermediate stage, only for the hero', () => {
    for (const name of ['mourning_overpass_mourner1', 'mourning_overpass_mourner2', 'mourning_overpass_mourner3']) for (let value = 1; value <= 7; value++) {
      const p = fixture(value); const n = npc(p, name);
      const drops = death(p, n);
      for (const item of loot) {
        const matches = drops.filter(drop => drop.name === item);
        assert.equal(matches.length, 1, `${name}: ${item}`); assert.equal(matches[0].amount, 1);
        assert.equal(matches[0].receiver, p.hash64, 'quest loot remains private to the real hero');
        assert(matches[0].duration > 0);
      }
      assert.equal(n.getVar(varnpc('mep1_mourner_vial_used')), 0, 'death resets per-life vial state');
      const unclaimed = npc(p, name); assert.equal(death(p, unclaimed, false).filter(drop => loot.includes(drop.name)).length, 0);
    }
  });

  check('vial waits for combat readiness, caps only high stats once per life, and never raises low stats', () => {
    const stats = [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.RANGED, PlayerStat.MAGIC, PlayerStat.HITPOINTS];
    for (const low of [false, true]) {
      const p = fixture(2), n = npc(p, low ? 'mourning_overpass_mourner2' : 'mourning_overpass_mourner1');
      showNpc(p, n); n.setVar(varnpc('npc_aggressive_player'), p.uid);
      n.setVar(varnpc('mep1_mourner_vial_used'), 0); n.setVar(varnpc('npc_action_delay'), World.currentTick + 10);
      for (const stat of stats) p.levels[stat] = low ? 10 : 99;
      ai(p, n); assert.equal(n.getVar(varnpc('mep1_mourner_vial_used')), 0);
      assert.equal(p.levels[PlayerStat.RANGED], low ? 10 : 99);
      n.setVar(varnpc('npc_action_delay'), 0); ai(p, n);
      assert.equal(n.getVar(varnpc('mep1_mourner_vial_used')), 1);
      for (const stat of stats) assert.equal(p.levels[stat], low ? 10 : 20, `vial cap ${stat}`);
      for (const stat of stats) p.levels[stat] = 99;
      n.setVar(varnpc('npc_action_delay'), 0); ai(p, n);
      assert.equal(p.levels[PlayerStat.RANGED], 99, 'same NPC life does not throw a second vial');
    }
  });

  check('Tegid soap is replaceable, requires water, and washes either item-use direction', () => {
    for (const reverse of [false, true]) {
      const p = fixture(2, ['mourning_bloody_mourner_top']);
      operateLoc(p, 'eadgar_laundry_basket'); assert.equal(count(p, 'mourning_soap'), 1);
      useItems(p, 'mourning_soap', 'mourning_bloody_mourner_top'); assert.equal(count(p, 'mourning_bloody_mourner_top'), 1);
      del(p, 'mourning_soap'); operateLoc(p, 'eadgar_laundry_basket');
      add(p, 'bucket_water');
      useItems(p, ...(reverse ? ['mourning_bloody_mourner_top', 'mourning_soap'] : ['mourning_soap', 'mourning_bloody_mourner_top']));
      assert.equal(count(p, 'mourning_bloody_mourner_top'), 0); assert.equal(count(p, 'mourning_soap'), 0);
      assert.equal(count(p, 'mourning_mourner_top'), 1); assert.equal(count(p, 'bucket_water'), 1);
    }
  });

  check('Oronwen consumes materials once, saves the deadline, waits through the boundary and preserves full-bag collection', () => {
    const descriptor = Object.getOwnPropertyDescriptor(performance, 'now'); let minute = 30000000;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => minute * 60000 - performance.timeOrigin });
    try {
      const p = fixture(2, ['mourning_ripped_mourner_legs']); add(p, 'silk', 2);
      useNpc(p, 'mourning_seamstress', 'mourning_ripped_mourner_legs'); assert.equal(count(p, 'mourning_ripped_mourner_legs'), 1);
      add(p, 'fur'); useNpc(p, 'mourning_seamstress', 'mourning_ripped_mourner_legs');
      const ready = p.getVar(varp('mep1_oronwen_ready_at')); assert.equal(ready, minute + 2);
      assert.equal(count(p, 'silk'), 0); assert.equal(count(p, 'fur'), 0); assert.equal(count(p, 'mourning_ripped_mourner_legs'), 0);
      const restored = PlayerLoading.load(p.username, new Packet(p.save()), null);
      assert.equal(restored.getVar(varp('mep1_oronwen_ready_at')), ready, 'real save/load retains pending repair');
      minute++; talk(p, 'mourning_seamstress'); assert.equal(count(p, 'mourning_mourner_legs'), 0);
      fullInventory(p); minute++; talk(p, 'mourning_seamstress');
      assert.equal(p.getVar(varp('mep1_oronwen_ready_at')), ready);
      p.getInventory(inv).set(27, null); talk(p, 'mourning_seamstress');
      assert.equal(count(p, 'mourning_mourner_legs'), 1); assert.equal(p.getVar(varp('mep1_oronwen_ready_at')), 0);
      talk(p, 'mourning_seamstress'); assert.equal(count(p, 'mourning_mourner_legs'), 1);
      talk(p, 'mourning_seamstress', [], 3); assert.equal(p.modalMain >= 0, true, 'native Trade opens the dye shop');
    } finally { if (descriptor) Object.defineProperty(performance, 'now', descriptor); else delete performance.now; }
  });

  check('headquarters requires exactly six outfit pieces; trapdoor and ungated exit land beside original counterparts', () => {
    const p = fixture(2); const before = loc(p, 'mourning_hideout_trap_door');
    operateLoc(p, 'mourning_hideout_trap_door'); assert(Math.abs(p.z - before.z) <= 8);
    disguise(p); wear(p, 'bronze_sword'); operateLoc(p, 'mourning_hideout_trap_door'); assert(Math.abs(p.z - before.z) <= 8);
    p.getInventory(worn).set(types.ObjType.get(obj('bronze_sword')).wearpos, null);
    operateLoc(p, 'mourning_hideout_trap_door');
    const ladder = locRows.find(row => row.name === 'mourner_hideout_ladder1'); assert(ladder);
    landing(p, ladder, 'HQ trapdoor');
    for (const item of outfit) p.getInventory(worn).set(types.ObjType.get(obj(item)).wearpos, null);
    operateLoc(p, 'mourner_hideout_ladder1');
    landing(p, locRows.find(row => row.name === 'mourning_hideout_trap_door'), 'HQ ladder exit without outfit');
  });

  check('HQ hook leaves original Biohazard gates untouched before eligibility', () => {
    for (const mepStage of [0, 2]) {
      const p = fixture(mepStage); p.setVar(varp('biohazard'), constant('biohazard_complete') - 1);
      const state = execute('[proc,mep1_hq_entry]', p); assert.equal(state.popInt(), 0);
    }
    const p = fixture(0); const state = execute('[proc,mep1_hq_entry]', p); assert.equal(state.popInt(), 0);
  });

  check('the keyed gnome gate admits a key holder and always lets a player who lost the key leave', () => {
    const row = locRows.find(row => row.name === 'mourner_hideout_door3'); assert(row);
    const p = fixture(3); disguise(p);
    const north = position => position.z > row.z, south = position => position.z <= row.z;
    operateLoc(p, row.name, 1, [], () => true, north);
    assert(p.z > row.z, 'the native north approach stays outside without a key');
    add(p, 'mourning_gnome_key');
    operateLoc(p, row.name, 1, [], () => true, north);
    assert(p.z <= row.z, 'the native key operation crosses into the original gnome room');
    landing(p, row, 'keyed gnome-room entry');
    for (let step = 0; step < 4; step++) { World.currentTick++; World.processZones(); }
    del(p, 'mourning_gnome_key');
    operateLoc(p, row.name, 1, [], () => true, south);
    assert(p.z > row.z, 'dropping the key inside cannot trap a normal player');
    landing(p, row, 'gnome-room escape without key');
    for (let step = 0; step < 4; step++) { World.currentTick++; World.processZones(); }
  });

  check('every other new basement door and the shared HQ entry crosses to a walkable packed-map landing', () => {
    for (const name of ['mourner_hideout_door1', 'mourner_hideout_door2', 'mourner_hideout_door4', 'mournerstewdoor']) {
      const p = fixture(3); disguise(p);
      const target = loc(p, name), before = tile(p);
      const counterpart = locRows.find(row => row.type === target.type && row.x === target.x && row.z === target.z); assert(counterpart);
      operateLoc(p, name); assert.notDeepEqual(tile(p), before, `${name}: actual crossing`);
      landing(p, counterpart, name);
      for (let step = 0; step < 4; step++) { World.currentTick++; World.processZones(); }
    }
  });

  check('Head mourner checks letter/space, recruits once, and replaces lost keys and broken devices', () => {
    const p = fixture(2); disguise(p); talk(p, 'mourner_hideout_head_mourner'); assert.equal(stage(p), 2);
    add(p, 'mourning_mourner_message'); fullInventory(p); talk(p, 'mourner_hideout_head_mourner'); assert.equal(stage(p), 2);
    emptyInventory(p); add(p, 'mourning_mourner_message'); talk(p, 'mourner_hideout_head_mourner', [2, 2, 2]);
    assert.equal(stage(p), 3); assert.equal(count(p, 'mourning_mourner_message'), 0);
    assert.equal(count(p, 'mourning_gnome_key'), 1); assert.equal(count(p, 'mourning_paint_gun_broken'), 1);
    del(p, 'mourning_gnome_key'); del(p, 'mourning_paint_gun_broken'); talk(p, 'mourner_hideout_head_mourner');
    assert.equal(count(p, 'mourning_gnome_key'), 1); assert.equal(count(p, 'mourning_paint_gun_broken'), 1);
    for (const value of [4, 5, 6]) { setStage(p, value); del(p, 'mourning_gnome_key'); talk(p, 'mourner_hideout_head_mourner'); assert.equal(count(p, 'mourning_gnome_key'), 1); }
  });

  check('gnome consumes early crunchies, requires both tickles/materials, dispatches occupied rack and released visible NPC', () => {
    for (const crunchies of ['toad_crunchies', 'premade_toad_crunchies']) {
      const p = fixture(3, ['feather', crunchies, 'mourning_paint_gun_broken', 'magic_logs', 'leather']);
      useLoc(p, 'mourning_gnome_rack_occupied', crunchies); assert.equal(count(p, crunchies), 0); assert(p.getVarBit(bit('mourning_gnome')) < 3);
      useLoc(p, 'mourning_gnome_rack_occupied', 'feather'); assert.equal(p.getVarBit(bit('mourning_gnome')), 2);
      useLoc(p, 'mourning_gnome_rack_occupied', 'feather'); assert.equal(p.getVarBit(bit('mourning_gnome')), 3);
      operateLoc(p, 'mourning_gnome_rack_occupied', 2); assert.equal(p.getVarBit(bit('mourning_gnome')), 3);
      add(p, crunchies); operateLoc(p, 'mourning_gnome_rack_occupied', 2); assert.equal(p.getVarBit(bit('mourning_gnome')), 7);
      assert.equal(count(p, 'mourning_paint_gun_broken'), 0); assert.equal(count(p, 'magic_logs'), 0); assert.equal(count(p, 'leather'), 0);
      fullInventory(p); talk(p, 'mourner_hideout_gnome_head'); assert.equal(stage(p), 3);
      p.getInventory(inv).set(27, null); talk(p, 'mourner_hideout_gnome_head');
      assert.equal(stage(p), 4); assert.equal(count(p, 'mourning_paint_gun'), 1);
      for (const value of [4, 5, 6, 7]) { setStage(p, value); del(p, 'mourning_paint_gun'); talk(p, 'mourner_hideout_gnome_head'); assert.equal(count(p, 'mourning_paint_gun'), 1); }
    }
  });

  const paint = fixture(4, ['mourning_paint_gun']); disguise(paint);
  const colours = [
    { colour: 'red', dye: 'reddye', group: 1, flag: 13 },
    { colour: 'green', dye: 'greendye', group: 2, flag: 15 },
    { colour: 'blue', dye: 'bluedye', group: 3, flag: 12 },
    { colour: 'yellow', dye: 'yellowdye', group: 4, flag: 14 }
  ];
  check('every dyed bellows/toad is reproducible; loading, Empty, misses and wrong colours preserve correct flags', () => {
    for (const row of colours) {
      const bellows = `mourning_ogre_bellows_${row.colour}`, toad = `mourning_bloated_toad_${row.colour}`;
      add(paint, 'empty_ogre_bellows'); add(paint, row.dye); useItems(paint, row.dye, 'empty_ogre_bellows');
      assert.equal(count(paint, bellows), 1);
      del(paint, bellows); add(paint, 'empty_ogre_bellows'); add(paint, row.dye); useItems(paint, 'empty_ogre_bellows', row.dye);
      useNpc(paint, 'toad', bellows); assert.equal(count(paint, toad), 1); assert(count(paint, 'empty_ogre_bellows') > 0);
      del(paint, toad); add(paint, row.dye); useItems(paint, row.dye, 'empty_ogre_bellows'); useNpc(paint, 'toad', bellows);
      useItems(paint, toad, 'mourning_paint_gun'); assert.equal(paint.getVarBit(bit('mourning_gun_ammo')), row.group);
      assert(held(paint, 'mourning_paint_gun', 1)); finish(paint); assert.equal(count(paint, toad), 1);
      assert.equal(paint.getVarBit(bit('mourning_gun_ammo')), 0);
    }
    loadGun(paint, 'mourning_bloated_toad_blue');
    random([0.999999, 0], () => talk(paint, 'herder_plaguesheep_1'));
    assert.equal(hasBit(paint, 13), 0); assert.equal(paint.getVarBit(bit('mourning_gun_ammo')), 0);
    add(paint, 'mourning_bloated_toad_red'); loadGun(paint, 'mourning_bloated_toad_red');
    random([0, 0.999999], () => talk(paint, 'herder_plaguesheep_1'));
    assert.equal(hasBit(paint, 13), 0); assert.equal(paint.getVarBit(bit('mourning_gun_ammo')), 0);
    for (const row of colours) {
      const toad = `mourning_bloated_toad_${row.colour}`;
      if (!count(paint, toad)) add(paint, toad);
      loadGun(paint, toad); random([0.999999, 0], () => talk(paint, `herder_plaguesheep_${row.group}`));
      assert.equal(hasBit(paint, row.flag), 1, `${row.colour}: real visible Prod writes its own original bit`);
    }
    takeOffGun(paint); talk(paint, 'mourner_hideout_head_mourner'); assert.equal(stage(paint), 5);
  });

  check('ordinary Chompy inflation and Sheep Herder refusals are not captured by the new hooks', () => {
    const p = fixture(0, ['filled_ogre_bellow3']); useNpc(p, 'toad', 'filled_ogre_bellow3');
    assert.equal(count(p, 'bloated_toad'), 1); assert.equal(count(p, 'filled_ogre_bellow2'), 1); assert.equal(bits(p), 0);
    const q = fixture(0); q.setVar(varp('sheepherderquest'), 0); talk(q, 'herder_plaguesheep_1');
    assert.match(q.messages.join(' '), /haven't any reason/); assert.equal(bits(q), 0);
  });

  check('Elena preserves Biohazard dialogue and requires the rotten-apple sample before advancing', () => {
    const q = fixture(0); talk(q, 'elena2_vis'); assert.equal(stage(q), 0); assert.equal(count(q, 'mourning_sieve'), 0);
    talk(paint, 'elena2_vis'); assert.equal(stage(paint), 5);
    operateLoc(paint, 'mourning_orchard_applepile'); talk(paint, 'elena2_vis');
    assert.equal(stage(paint), 6); assert.equal(count(paint, 'mourning_sieve'), 1);
    del(paint, 'mourning_sieve'); talk(paint, 'elena2_vis'); assert.equal(count(paint, 'mourning_sieve'), 1);
  });

  check('native still controls produce naphtha without seeding its progress or output', () => {
    const p = fixture(6, ['regicide_barrel_tar']); add(p, 'coal', 25);
    useLoc(p, 'regicide_fractionalizing_still', 'regicide_barrel_tar');
    assert.equal(p.modalMain, id('Component', 'regicide_still'));
    assert(button(p, 'regicide_still:com_130')); assert(button(p, 'regicide_still:com_132')); assert(button(p, 'regicide_still:com_132'));
    for (let step = 0; p.getVar(varp('regicide_still_total')) < 26 && step < 80; step++) {
      const heat = Math.log2((p.getVar(varp('regicide_still_settings')) >>> 13) & 8191);
      if (heat <= 6 && p.getVar(varp('temp')) <= 50) assert(button(p, 'regicide_still:com_120'));
      execute('[softtimer,still_progress]', p);
    }
    assert.equal(p.getVar(varp('regicide_still_total')), 26); assert(button(p, 'regicide_still:com_89'));
    assert.equal(count(p, 'regicide_barrel_naphtha'), 1); assert.equal(stage(p), 6);
  });

  check('Regicide naphtha ingredient paths remain unchanged both before and during MEP1', () => {
    for (const value of [0, 6]) for (const [ingredient, product] of [
      ['regicide_quicklime_dust', 'regicide_barrel_naphtha_quicklime_mix'],
      ['regicide_sulphar_dust', 'regicide_barrel_naphtha_sulphar_mix']
    ]) {
      const p = fixture(value, ['regicide_barrel_naphtha', ingredient]); useItems(p, ingredient, 'regicide_barrel_naphtha');
      assert.equal(count(p, product), 1); assert.equal(stage(p), value); assert.equal(count(p, 'mourning_applebarrel_naphtha_mush'), 0);
    }
  });

  check('all toxin intermediates can be reproduced after loss, both use orders work, oven dries and fire explodes', () => {
    for (const reverse of [false, true]) {
      const p = fixture(6, ['mourning_sieve', 'regicide_barrel_naphtha']);
      for (const lose of ['applebarrel_full', 'mourning_applebarrel_mush', 'mourning_applebarrel_naphtha_mush', 'mourning_toxic_naphtha', 'mourning_apple_toxin', null]) {
        operateLoc(p, 'mourning_orchard_applepile');
        if (lose === 'applebarrel_full') { del(p, lose); continue; }
        useLoc(p, 'mourning_orchard_applebarrel_empty', 'applebarrel_full');
        if (lose === 'mourning_applebarrel_mush') { del(p, lose); continue; }
        if (!count(p, 'regicide_barrel_naphtha')) add(p, 'regicide_barrel_naphtha');
        useItems(p, ...(reverse ? ['mourning_applebarrel_mush', 'regicide_barrel_naphtha'] : ['regicide_barrel_naphtha', 'mourning_applebarrel_mush']));
        assert.equal(count(p, 'mourning_applebarrel_naphtha_mush'), 1);
        if (lose === 'mourning_applebarrel_naphtha_mush') { del(p, lose); continue; }
        useItems(p, ...(reverse ? ['mourning_applebarrel_naphtha_mush', 'mourning_sieve'] : ['mourning_sieve', 'mourning_applebarrel_naphtha_mush']));
        assert.equal(count(p, 'mourning_toxic_naphtha'), 1);
        if (lose === 'mourning_toxic_naphtha') { del(p, lose); continue; }
        useLoc(p, '_cooking_oven', 'mourning_toxic_naphtha');
        assert.equal(count(p, 'mourning_apple_toxin'), 1);
        if (lose === 'mourning_apple_toxin') del(p, lose);
      }
      assert.equal(count(p, 'mourning_apple_toxin'), 1); assert.equal(stage(p), 6);
      add(p, 'mourning_toxic_naphtha'); const hp = p.levels[PlayerStat.HITPOINTS];
      useLoc(p, '_cooking_fire', 'mourning_toxic_naphtha');
      assert.equal(count(p, 'mourning_toxic_naphtha'), 0); assert.equal(p.levels[PlayerStat.HITPOINTS], hp - 51);
    }
  });

  check('all six visible grain-sack types dispatch; two real regions, not repeated sacks, complete the poison task', () => {
    const sacks = ['grain_sacks', 'grain_sacks_8802', 'grain_sacks_8803', 'grain_sacks_8804', 'grain_sacks_8805', 'grain_sacks_8806'];
    for (const name of sacks) {
      const p = fixture(6, ['mourning_apple_toxin']); useLoc(p, name, 'mourning_apple_toxin');
      assert.equal(stage(p), 6); assert.equal(count(p, 'mourning_apple_toxin'), 0);
      const first39 = ['grain_sacks', 'grain_sacks_8802', 'grain_sacks_8804', 'grain_sacks_8805'].includes(name);
      assert.equal(hasBit(p, first39 ? 22 : 23), 1); assert.equal(hasBit(p, 24), 0);
      add(p, 'mourning_apple_toxin'); useLoc(p, name, 'mourning_apple_toxin'); assert.equal(count(p, 'mourning_apple_toxin'), 1);
      useLoc(p, first39 ? 'grain_sacks_8803' : 'grain_sacks', 'mourning_apple_toxin');
      assert.equal(stage(p), 7); for (const flag of [22, 23, 24]) assert.equal(hasBit(p, flag), 1);
      del(p, 'mourning_sieve'); talk(p, 'elena2_vis'); assert.equal(count(p, 'mourning_sieve'), 1, 'last-stage sieve recovery remains available');
    }
  });

  check('completion commits stage eight, awards exact period XP and two QP once, colours the row, and hands off MEP2', () => {
    const p = fixture(7); disguise(p);
    const hp = p.stats[PlayerStat.HITPOINTS], thieving = p.stats[PlayerStat.THIEVING], qp = questPoints(p);
    talk(p, 'mourner_hideout_head_mourner'); assert.equal(stage(p), 8);
    assert.equal(p.stats[PlayerStat.HITPOINTS] - hp, 250000, '25000 Hitpoints XP in tenths');
    assert.equal(p.stats[PlayerStat.THIEVING] - thieving, 250000, '25000 Thieving XP in tenths');
    assert.equal(questPoints(p) - qp, 2);
    const text = p.packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => packet.text).join(' ');
    assert.match(text, /You have completed Mourning's Ends Part 1!/); assert.match(text, /25,000 Hitpoints XP/); assert.match(text, /25,000 Thieving XP/);
    talk(p, 'mourner_hideout_head_mourner'); assert.equal(p.stats[PlayerStat.HITPOINTS] - hp, 250000); assert.equal(p.stats[PlayerStat.THIEVING] - thieving, 250000);
    assert.equal(questPoints(p) - qp, 2);
    execute('[proc,update_questlist]', p);
    const colour = p.packets.filter(packet => packet.constructor.name === 'IfSetColour' && packet.component === id('Component', 'questlist:mourning')).at(-1);
    assert(colour); assert.equal(colour.colour, 31 << 5);
    const mep2 = types.VarBitType.getId('mourning_quest_main'); assert(mep2 >= 0);
    talk(p, 'mourning_arianwyn', [1]); assert.equal(p.getVarBit(mep2), 1); assert.equal(stage(p), 8);
    operateLoc(p, 'mourning_hideout_trap_door');
    landing(p, locRows.find(row => row.name === 'mourner_hideout_ladder1'), 'post-quest HQ access');
  });

  console.log(`MEP1 compiled native proof: ${checks} checks passed`);
} finally {
  for (const p of actors) {
    p.clearInteraction(); p.activeScript = null; p.weakQueue.clear(); p.queue.clear(); p.timers.clear();
    rsbuf.removePlayer(p.slot); World.players[p.slot] = null; p.unlink(); p.isActive = false;
  }
  for (const n of avatars) if (n.isActive) World.removeNpc(n, -1);
}
process.exit(0); // The shared VM runtime owns background handles, as in the existing swamp-cave tests.
