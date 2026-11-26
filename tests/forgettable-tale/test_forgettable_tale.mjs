#!/usr/bin/env node
// Checked-out maps, packed scripts, and production interaction dispatch only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  World, PlayerStat, Packet, PlayerLoading, ScriptProvider, ScriptState, button, contentRoot, count, dialoguePage,
  engineModule, execute, held, id, inv, invCom, map, obj, player, resumeDialogue, slotOf,
  tile, tick, types, useLoc, weakCount
} from '../swamp-caves/runtime.mjs';

const resolveNpcType = (await engineModule('engine/entity/resolveNpcType.ts')).default;
const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const rsbuf = await engineModule('network/rsbuf/index.ts');
const NpcStat = (await engineModule('engine/entity/NpcStat.ts')).NpcStat;
const OpNpc = (await engineModule('network/game/client/model/OpNpc.ts')).default;
const OpNpcHandler = (await engineModule('network/game/client/handler/OpNpcHandler.ts')).default;
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const OpLocHandler = (await engineModule('network/game/client/handler/OpLocHandler.ts')).default;
const npcHandler = new OpNpcHandler();
const approaches = [];
const locHandler = new OpLocHandler();
// Offline elapsed-time fixture: move the platform clock, never a quest timer.
const clockMinute = Math.floor((performance.timeOrigin + performance.now()) / 60000);
const originDescriptor = Object.getOwnPropertyDescriptor(performance, 'timeOrigin');
const nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
let elapsedMinutes = 0;
Object.defineProperty(performance, 'timeOrigin', {
  configurable: true, get: () => (clockMinute + elapsedMinutes) * 60000
});
Object.defineProperty(performance, 'now', { configurable: true, value: () => 0 });
const advanceMinutes = minutes => { elapsedMinutes += minutes; };
const questConstants = fs.readFileSync(path.join(contentRoot, 'scripts/general/configs/quest.constant'), 'utf8');
const gdConstants = fs.readFileSync(path.join(contentRoot, 'scripts/quests/quest_giantdwarf/configs/giantdwarf.constant'), 'utf8');
function constant(name, source = questConstants) {
  const match = source.match(new RegExp(`^\\^${name}\\s*=\\s*(-?\\d+)\\s*$`, 'm'));
  assert(match, `checked-out constant ${name}`);
  return Number(match[1]);
}
const complete = constant('forget_complete');
assert.equal(complete, 140);
assert.equal(constant('forget_questpoints'), 2);
function get(p, name) {
  const bit = types.VarBitType.getId(name);
  return bit >= 0 ? p.getVarBit(bit) : p.getVar(id('VarPlayerType', name));
}
function set(p, name, value) {
  const bit = types.VarBitType.getId(name);
  if (bit >= 0) p.setVarBit(bit, value); else p.setVar(id('VarPlayerType', name), value);
}
const stage = p => get(p, 'forget_quest');
const proc = (p, name, args = []) => execute(`[proc,${name}]`, p, args);
const points = p => proc(p, 'count_questpoints').popInt();
const give = (p, name, amount = 1) => p.invAdd(inv, obj(name), amount);
function assertSavedQuest(p, label) {
  const loaded = PlayerLoading.load('frgt_persistence', new Packet(p.save()), null);
  for (const name of ['forget_main_var', 'forget_clock', 'forget_puzzle_var', 'forget_puzzle_var2', 'farming_varp_9']) {
    assert.equal(get(loaded, name), get(p, name), `${label}: native save/load preserves ${name}`);
  }
  for (const name of ['kelda_hop_seed', 'kelda_hops', 'kelda_stout', 'forget_gardener_letter',
    'turnleft_trackjunction_control_card', 'turnright_trackjunction_control_card']) {
    assert.equal(count(loaded, name), count(p, name), `${label}: native save/load preserves carried ${name}`);
  }
}
function fixture() {
  const p = player();
  set(p, 'giantdwarf_quest', constant('giantdwarf_complete', gdConstants));
  set(p, 'giantdwarf_current_company', 1);
  set(p, 'fishingcompo', constant('fishingcompo_complete'));
  return p;
}
function at(p, { level, x, z }) {
  p.level = level; p.x = x; p.z = z;
  p.originX = x; p.originZ = z; p.clearInteraction();
}
function assertLanding(p, expected, exit, label) {
  assert.deepEqual(tile(p), expected, `${label}: independently specified area/counterpart`);
  assertWalkableLanding(expected, exit, label);
}
function assertWalkableLanding(expected, exit, label) {
  const [level, x, z] = expected;
  assert(!map.isMapBlocked(x, z, level), `${label}: packed landing is walkable`);
  assert(!map.isMapBlocked(exit.x, exit.z, level), `${label}: route-out target is walkable`);
  const route = map.findPath(level, x, z, exit.x, exit.z);
  assert(route.length > 0, `${label}: non-empty packed findPath route out`);
  const last = route[route.length - 1];
  assert.deepEqual([(last >>> 14) & 0x3fff, last & 0x3fff], [exit.x, exit.z],
    `${label}: route actually reaches its independently specified exit`);
}
function finish(p, choices = [], label = 'interaction', firstMessage = p.messages.length) {
  const pending = [...choices], pages = [];
  for (let step = 0; step < 1200; step++) {
    (p.visitedQuestTiles ??= new Set()).add(tile(p).join(','));
    const state = p.activeScript;
    if (!state) {
      if (!weakCount(p)) break;
      tick(p); continue;
    }
    assert.notEqual(state.execution, ScriptState.ABORTED, `${label} does not abort`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      pages.push(...dialoguePage(p));
      const choice = /^multi[2-5]$/.test(types.Component.get(p.modalChat).comName);
      assert(!choice || pending.length, `${label}: explicit choice required: ${pages.join(' ')}`);
      let selected = choice ? pending.shift() : null;
      if (typeof selected === 'string') {
        const packet = p.packets.slice(p.dialogueMark).find(row =>
          row.constructor.name === 'IfSetText' && row.text === selected && p.resumeButtons.includes(row.component));
        assert(packet, `${label}: offered choice ${selected}`);
        const root = types.Component.get(p.modalChat).comName;
        selected = Array.from({ length: Number(root.at(-1)) }, (_, index) => index + 1)
          .find(option => id('Component', `${root}:com_${option}`) === packet.component);
        assert(selected, `${label}: native component for offered choice`);
      }
      resumeDialogue(p, selected);
    } else if (state.execution === ScriptState.SUSPENDED) tick(p);
    else if (state.execution === ScriptState.FINISHED) break;
    else assert.fail(`${label}: unexpected execution ${state.execution}`);
  }
  assert.equal(pending.length, 0, `${label}: all choices consumed`);
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED, `${label}: settles`);
  return [...pages, ...p.messages.slice(firstMessage)].join(' ');
}
const puzzleInterfaces = [
  { root: 'inter_179', first: 35, cells: 8 },
  { root: 'inter_180', first: 51, cells: 12 },
  { root: 'inter_288', first: 79, cells: 19 }
];
function configureTrack(p, board, selections) {
  const { root, first, cells } = puzzleInterfaces[board - 1];
  const click = field => {
    const before = get(p, `forget_if${field}`);
    assert(button(p, `${root}:com_${first + field - 1}`), `${root}: visible native junction ${field}`);
    finish(p, [], `native junction ${field}`);
    assert.notEqual(get(p, `forget_if${field}`), before, `${root}: junction action changes its field`);
  };
  // Free yellow stones first so every green stone can cycle through yellow to removal.
  for (const colour of [2, 1]) {
    for (let field = 1; field <= cells; field++) {
      if (get(p, `forget_if${field}`) !== colour) continue;
      for (let clicks = 0; get(p, `forget_if${field}`) !== 0 && clicks < 3; clicks++) click(field);
      assert.equal(get(p, `forget_if${field}`), 0, `${root}: native removal restores the stone`);
    }
  }
  for (const colour of [2, 1]) {
    for (const [fieldText, selected] of Object.entries(selections)) {
      if (selected !== colour) continue;
      const field = Number(fieldText);
      assert(field >= 1 && field <= cells);
      for (let clicks = 0; clicks < colour; clicks++) click(field);
      assert.equal(get(p, `forget_if${field}`), colour, `${root}: configured junction ${field}`);
    }
  }
  assertSavedQuest(p, `${root}: inserted stones`);
  nativeClose(p, root);
}
// These original Close components send IF_BUTTON; CloseModal would bypass their content handlers.
function nativeClose(p, label) {
  const panel = puzzleInterfaces.find(({ root }) => root === label);
  assert(panel, `${label}: original control panel`);
  assert.equal(p.modalMain, id('Component', label), `${label}: control panel is open`);
  assert(button(p, `${label}:com_${panel.first - 1}`), `${label}: visible native Close button`);
  finish(p, [], `${label}: native Close`);
  tick(p);
  assert.equal(p.modalMain, -1, `${label}: the control panel closes before riding`);
}
function nativeResult(p, choices, label) {
  const script = p.getOpTrigger() ?? p.getApTrigger();
  assert(script && ScriptProvider.getByName(script.name), `${label}: packed native trigger`);
  p.dialogueMark = p.packets.length;
  const firstMessage = p.messages.length;
  p.processInteraction();
  return { script: script.name, text: finish(p, choices, label, firstMessage) };
}
function showNpc(p, target) {
  rsbuf.addPlayer(p.slot);
  rsbuf.addNpc(target.nid, target.type);
  const appearance = p.generateAppearance(), hp = PlayerStat.HITPOINTS;
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, appearance, p.lastAppearance,
    p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ,
    p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[hp], p.baseLevels[hp], p.animId, p.animDelay, p.sayMessage,
    p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0,
    p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(target.x, target.level, target.z, target.nid, target.type, target.tele, target.jump,
    target.runDir, target.walkDir, target.isActive, target.masks, target.faceEntity,
    target.faceSquareX, target.faceSquareZ, target.faceAngleX, target.faceAngleZ,
    target.hitmarkDamage, target.hitmarkType, target.hitmark2Damage, target.hitmark2Type,
    target.levels[NpcStat.HITPOINTS], target.baseLevels[NpcStat.HITPOINTS],
    target.animId, target.animDelay, target.sayMessage, target.spotanimId,
    target.spotanimHeight, target.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, target.nid), 'native visibility contains the selected NPC');
}
function npc(p, name) {
  const type = id('NpcType', name);
  const target = [...World.npcs].find(row => row.isActive && row.type === type);
  assert(target, `natural NPC ${name}`);
  for (let distance = 1; distance <= 8; distance++) {
    for (let dx = -distance; dx <= distance; dx++) {
      for (let dz = -distance; dz <= distance; dz++) {
        const position = { level: target.level, x: target.x + dx, z: target.z + dz };
        if (map.isMapBlocked(position.x, position.z, position.level)) continue;
        at(p, position);
        if (p.inOperableDistance(target)) {
          approaches.push({ kind: 'npc', name, target: { id: type, x: target.x, z: target.z, level: target.level },
            stand: position });
          return target;
        }
      }
    }
  }
  assert.fail(`walkable native interaction stand for ${name}`);
}
function talk(p, name, choices = []) {
  const target = npc(p, name);
  const visible = resolveNpcType(types.NpcType.get(target.type), p);
  assert(visible?.op?.[0] && visible.op[0] !== 'hidden', `${name}: visible Talk-to`);
  showNpc(p, target);
  assert(npcHandler.handle(new OpNpc(1, target.nid), p), `${name}: OpNpc accepted`);
  return nativeResult(p, choices, `Talk-to ${name}`);
}
const placements = [];
for (const file of fs.readdirSync(path.join(contentRoot, 'maps')).filter(file => /^m\d+_\d+\.jm2$/.test(file))) {
  const [mx, mz] = file.slice(1, -4).split('_').map(Number);
  let section = '';
  for (const line of fs.readFileSync(path.join(contentRoot, 'maps', file), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) section = line;
    if (!section.includes('LOC')) continue;
    const match = /^(\d+) (\d+) (\d+): (\d+) (\d+)(?: (\d+))?/.exec(line);
    if (match) placements.push({ level: +match[1], x: mx * 64 + +match[2],
      z: mz * 64 + +match[3], type: +match[4] });
  }
}
function loc(p, name, position = null) {
  const type = id('LocType', name), config = types.LocType.get(type);
  const candidates = position ? [{ ...position, type }] : placements.filter(row => row.type === type);
  for (const row of candidates) {
    const target = World.getLoc(row.x, row.z, row.level, type);
    if (!target) continue;
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        const x = target.x + dx, z = target.z + dz;
        if (map.isMapBlocked(x, z, target.level)) continue;
        if (!map.reachedLoc(target.level, x, z, target.x, target.z, config.width, config.length,
          1, target.angle, target.shape, config.forceapproach)) continue;
        at(p, { level: target.level, x, z });
        assert(p.inOperableDistance(target), `${name}: operable natural loc`);
        approaches.push({ kind: 'loc', name, target: { id: type, x: target.x, z: target.z, level: target.level },
          stand: { level: target.level, x, z } });
        return target;
      }
    }
  }
  assert.fail(`natural reachable loc ${name}`);
}
function visibleLoc(p, target) {
  const base = types.LocType.get(target.type);
  const state = base.multivarp >= 0 ? p.getVar(base.multivarp) :
    base.multivarbit >= 0 ? p.getVarBit(base.multivarbit) : -1;
  return state >= 0 && base.multiloc?.[state] >= 0 ? types.LocType.get(base.multiloc[state]) : base;
}
function operate(p, name, option = 1, choices = [], position = null) {
  const target = loc(p, name, position);
  const visible = visibleLoc(p, target);
  assert(visible.op?.[option - 1] && visible.op[option - 1] !== 'hidden',
    `${name}: option ${option} exists on the client-visible ${visible.debugname}`);
  assert(locHandler.handle(new OpLoc(option, target.x, target.z, target.type), p), `${name}: OpLoc accepted`);
  return { ...nativeResult(p, choices, `${name} option ${option}`), visible: visible.debugname };
}
function searchCards(p, board) {
  const box = placements.find(row => row.type === id('LocType', 'keldagrim_track_junction_card_box'));
  assert(box, 'original mapped card box');
  if (World.getLoc(box.x, box.z, box.level, id('LocType', 'keldagrim_track_junction_card_box_open'))) {
    // The original open-box form has no Search. Reclose it through the real
    // machinery rather than dispatching an operation the client cannot offer.
    operate(p, 'keldagrim_track_junction_control_box');
    nativeClose(p, puzzleInterfaces[board - 1].root);
  }
  return operate(p, 'keldagrim_track_junction_card_box');
}
function itemOnLoc(p, item, name, choices = [], position = null) {
  const target = loc(p, name, position);
  p.dialogueMark = p.packets.length;
  const firstMessage = p.messages.length;
  assert(useLoc(p, item, target), `${item} on ${name}: native OpLocU accepted`);
  return finish(p, choices, `${item} on ${name}`, firstMessage);
}
function itemOption(p, name, option = 1) {
  p.dialogueMark = p.packets.length;
  const firstMessage = p.messages.length;
  assert(held(p, name, option), `${name}: native held option accepted`);
  return finish(p, [], `${name} option ${option}`, firstMessage);
}

// Each prerequisite is independently denied; boostable skill checks use current levels.
for (const [name, value] of [['giantdwarf_quest', 0], ['fishingcompo', 0]]) {
  const subject = fixture(); set(subject, name, value);
  talk(subject, 'dwarf_city_black_guard_leader');
  assert.equal(stage(subject), 0, `${name} blocks start`);
}
for (const [stat, value] of [[PlayerStat.FARMING, 16], [PlayerStat.COOKING, 21]]) {
  const subject = fixture(); subject.levels[stat] = value;
  talk(subject, 'dwarf_city_black_guard_leader');
  assert.equal(stage(subject), 0, 'current skill prerequisite blocks start');
}
const declined = fixture();
talk(declined, 'dwarf_city_black_guard_leader', [2]);
assert.equal(stage(declined), 0, 'declining does not start the quest');
const p = fixture();
p.baseLevels[PlayerStat.FARMING] = 16; p.levels[PlayerStat.FARMING] = 17;
p.baseLevels[PlayerStat.COOKING] = 21; p.levels[PlayerStat.COOKING] = 22;
const pointsBefore = points(p);
talk(p, 'dwarf_city_black_guard_leader', [1]);
assert.equal(stage(p), 1);
assertLanding(p, [0, 2911, 10222], { x: 2911, z: 10221 }, 'original drunken dwarf house');
assert.equal(points(p), pointsBefore, 'no quest points before completion');
talk(p, 'dwarf_city_drunken_dwarf_multi', [1]);
assert.equal(stage(p), 1, 'no beer gives no seed or progress');
give(p, 'beer');
talk(p, 'dwarf_city_drunken_dwarf_multi', [1]);
assert.equal(stage(p), 10);
assert.equal(count(p, 'kelda_hop_seed'), 1);
assert.equal(count(p, 'beer'), 0);
assert.equal(count(p, 'beer_glass'), 1);
p.invClear(inv);
talk(p, 'dwarf_city_drunken_dwarf_multi', [1]);
assert.equal(count(p, 'kelda_hop_seed'), 1, 'lost earned seed is recoverable');
talk(p, 'dwarf_city_rowdy_dwarf');
const assignment = (get(p, 'forget_clock') >>> 27) & 31;
assert(assignment >= 1 && assignment <= 24, 'Rowdy chooses one retained request');
const requested = types.ObjType.get(proc(p, 'forget_rowdy_item', [assignment]).popInt()).debugname;
give(p, requested);
talk(p, 'dwarf_city_rowdy_dwarf');
assert.equal(get(p, 'forget_seed2_given'), 1);
assert.equal(count(p, 'kelda_hop_seed'), 2);
talk(p, 'dwarfrock_engineer2', [1]);
assert.equal(get(p, 'forget_seed3_given'), 1);
assert.equal(count(p, 'kelda_hop_seed'), 3);
give(p, 'beer');
talk(p, 'dwarf_city_dwarf_man6');
assert.equal(get(p, 'forget_seed4_given'), 1);
assert.equal(count(p, 'kelda_hop_seed'), 4);
assert.equal(count(p, 'beer'), 1, "toast does not consume the player's beer");
const bank = id('InvType', 'bank');
p.invDel(inv, obj('kelda_hop_seed'), 2); p.invAdd(bank, obj('kelda_hop_seed'), 2);
talk(p, 'dwarf_city_drunken_dwarf_multi', [1]);
assert.equal(count(p, 'kelda_hop_seed'), 2, 'banked seeds are not duplicated');
p.invClear(bank); p.invDel(inv, obj('kelda_hop_seed'), 2);
talk(p, 'dwarf_city_drunken_dwarf_multi', [1]);
assert.equal(count(p, 'kelda_hop_seed'), 4, 'all four earned seeds recover after loss');
const clock = fixture();
set(clock, 'forget_clock', (17 << 27) | 123456);
proc(clock, 'forget_login');
assert.equal(get(clock, 'forget_clock'), 123456, 'login clears only Rowdy assignment, not Kelda time');
console.log('PASS Forgettable prerequisites, native start, four seed providers and recovery');

// The same account earns its crop, brew and tunnel permission without stage seeds.
talk(p, 'dwarf_city_gardener_dwarf', [2]);
assert.equal(get(p, 'forget_seed3_told'), 1, 'Rind grants use of his original patch');
give(p, 'rake');
for (let cleared = 1; cleared <= 3; cleared++) {
  itemOnLoc(p, 'rake', 'farming_hops_patch_keldagrim');
  assert.equal(get(p, 'forget_farming'), cleared, 'each native rake use clears one weed stage');
}
itemOnLoc(p, 'kelda_hop_seed', 'farming_hops_patch_keldagrim');
assert.equal(get(p, 'forget_farming'), 3, 'planting needs a dibber');
assert.equal(count(p, 'kelda_hop_seed'), 4);
give(p, 'dibber');
p.levels[PlayerStat.FARMING] = 16;
itemOnLoc(p, 'kelda_hop_seed', 'farming_hops_patch_keldagrim');
assert.equal(get(p, 'forget_farming'), 3, 'planting enforces current Farming17');
p.levels[PlayerStat.FARMING] = 17;
itemOnLoc(p, 'kelda_hop_seed', 'farming_hops_patch_keldagrim');
assert.equal(get(p, 'forget_farming'), 4, 'four earned seeds are planted');
assert.equal(count(p, 'kelda_hop_seed'), 0);
assert((get(p, 'forget_clock') & 0x7ffffff) > 0, 'product records its own real-minute plant time');
assertSavedQuest(p, 'planted hops');
talk(p, 'dwarf_city_gardener_dwarf', [2]);
assert.equal(count(p, 'forget_gardener_letter'), 1, 'optional letter is accepted, not seeded');
for (let loss = 0; loss < 2; loss++) {
  p.invDel(inv, obj('forget_gardener_letter'), 1);
  talk(p, 'dwarf_city_gardener_dwarf');
  assert.equal(count(p, 'forget_gardener_letter'), 1, 'an accepted letter recovers after repeated losses');
}
p.invDel(inv, obj('forget_gardener_letter'), 1); p.invAdd(bank, obj('forget_gardener_letter'), 1);
assert.match(talk(p, 'dwarf_city_gardener_dwarf', [2]).text, /Oh, alright then\./);
assert.equal(count(p, 'forget_gardener_letter'), 0, 'a banked letter is not duplicated');
p.invDel(bank, obj('forget_gardener_letter'), 1); give(p, 'forget_gardener_letter');
talk(p, 'elstan', [1]);
assert.equal(count(p, 'forget_gardener_letter'), 0, 'native Elstan takes the accepted letter');
talk(p, 'dwarf_city_gardener_dwarf');
assert.equal(count(p, 'marrentill_seed'), 2, 'exact period optional letter reward');
assert.match(talk(p, 'dwarf_city_gardener_dwarf', [2]).text, /Oh, alright then\./);
assert.equal(count(p, 'marrentill_seed'), 2, 'the letter reward is once-only');
for (const existingSeeds of [0, 1]) {
  const letterRoom = fixture();
  set(letterRoom, 'forget_quest', 10);
  set(letterRoom, 'forget_seed3_told', 1);
  set(letterRoom, 'forget_gardener_task', 2);
  give(letterRoom, 'cabbage', 27);
  if (existingSeeds) give(letterRoom, 'marrentill_seed', existingSeeds);
  talk(letterRoom, 'dwarf_city_gardener_dwarf');
  assert.equal(count(letterRoom, 'marrentill_seed'), existingSeeds + 2,
    existingSeeds ? 'stackable letter reward fits an existing stack in a full inventory' :
      'two stackable reward seeds need only one free slot');
  assert.equal(count(letterRoom, 'cabbage'), 27, 'letter reward does not replace another item');
}
advanceMinutes(19);
operate(p, 'farming_hops_patch_keldagrim', 2);
assert.equal(get(p, 'forget_farming'), 7, 'nineteen elapsed minutes are not a harvest');
assert.equal(count(p, 'kelda_hops'), 0);
advanceMinutes(1);
operate(p, 'farming_hops_patch_keldagrim', 2);
assert.equal(get(p, 'forget_farming'), 8, 'twenty elapsed minutes produce the original grown morph');
assert.equal(operate(p, 'farming_hops_patch_keldagrim').visible, 'kelda_hops_fullygrown');
assert.equal(count(p, 'kelda_hops'), 1, 'the period harvest is exactly one hops item');
assert.equal(get(p, 'forget_farming'), 0);
assert.equal(get(p, 'forget_seed2_told'), 1, 'harvest has a durable recovery receipt');
talk(p, 'dwarf_city_drunken_dwarf_multi', [1]);
assert.equal(count(p, 'kelda_hop_seed'), 0, 'harvest cannot be turned into another four-seed issue');
for (let loss = 0; loss < 2; loss++) {
  p.invDel(inv, obj('kelda_hops'), 1);
  talk(p, 'dwarf_city_gardener_dwarf', ['I lost my Kelda hops.']);
  assert.equal(count(p, 'kelda_hops'), 1, 'repeated lost-hop recovery never strands a player');
}
give(p, 'coins', 25); give(p, 'pot_empty');
talk(p, 'blandebir', [1, 1]);
assert.equal(count(p, 'coins'), 0);
assert.equal(count(p, 'pot_empty'), 0);
assert.equal(count(p, 'ale_yeast'), 1, 'Blandebir sells the sourced yeast for25 in an empty pot');
give(p, 'bucket_water', 2); give(p, 'barley_malt', 2);
for (const [ingredient, vatState] of [['bucket_water', 1], ['barley_malt', 2], ['kelda_hops', 68], ['ale_yeast', 69]]) {
  itemOnLoc(p, ingredient, 'brewing_vat_1');
  assert.equal(get(p, 'brewing_vat_varbit_1'), vatState, `${ingredient}: native visible-morph ingredient dispatch`);
  assert.equal(count(p, ingredient), 0, `${ingredient}: exact inputs consumed`);
  assertSavedQuest(p, `${ingredient}: consumed brewing ingredient`);
}
assert.equal(count(p, 'bucket_empty'), 2);
assert.equal(count(p, 'pot_empty'), 1, 'the yeast container is returned');
assert.equal(get(p, 'forget_seed2_told'), 1, 'using hops never erases the earned-harvest receipt');
operate(p, 'vat_valve_1');
assert.equal(get(p, 'brewing_vat_varbit_1'), 69, 'valve cannot skip fermentation');
assert.equal(get(p, 'brewing_barrel_varbit_1'), 0);
advanceMinutes(6);
operate(p, 'vat_valve_1');
assert.equal(get(p, 'brewing_vat_varbit_1'), 70, 'the second original fermenting morph appears after6m');
assertSavedQuest(p, 'half-fermented stout');
advanceMinutes(5);
operate(p, 'vat_valve_1');
assert.equal(get(p, 'brewing_barrel_varbit_1'), 0, 'eleven minutes are too early');
advanceMinutes(1);
operate(p, 'vat_valve_1');
assert.equal(get(p, 'brewing_vat_varbit_1'), 0, 'native valve drains a finished vat');
assert.equal(get(p, 'brewing_barrel_varbit_1'), 3, 'finished stout fills the original Kelda barrel morph');
assertSavedQuest(p, 'finished stout in the barrel');
assert.equal(operate(p, 'brewing_barrel_1').visible, 'barrel_kelda_stout');
give(p, 'beer_glass');
itemOnLoc(p, 'beer_glass', 'brewing_barrel_1');
assert.equal(get(p, 'brewing_barrel_varbit_1'), 0);
assert.equal(count(p, 'kelda_stout'), 1, 'an actual glass pours the single quest stout');
assert.equal(count(p, 'beer_glass'), 0);
assert((get(p, 'forget_gardener_task') & 4) !== 0, 'pouring writes the saved recovery receipt');
assertSavedQuest(p, 'poured stout');
itemOption(p, 'kelda_stout');
assert.equal(count(p, 'kelda_stout'), 1, 'the player cannot accidentally drink the quest stout');
for (let loss = 0; loss < 2; loss++) {
  p.invDel(inv, obj('kelda_stout'), 1); give(p, 'beer_glass');
  talk(p, 'dwarf_city_barmaid_poor', [4]);
  assert.equal(count(p, 'kelda_stout'), 1, 'earned stout can be recovered after repeated losses');
}
p.invDel(inv, obj('kelda_stout'), 1); p.invAdd(bank, obj('kelda_stout'), 1);
assert.equal(proc(p, 'forget_kelda_barmaid').popInt(), 0, 'banked stout is never duplicated');
p.invDel(bank, obj('kelda_stout'), 1); give(p, 'kelda_stout');
talk(p, 'dwarf_city_drunken_dwarf_multi', [1]);
assert.equal(stage(p), 20, 'earned stout unlocks the abandoned-mine clue');
assert.equal(count(p, 'kelda_stout'), 0);
talk(p, 'dwarf_city_train_conductor3', [1]);
assert.equal(stage(p), 30, 'native conductor points to an influential friend');
talk(p, 'dwarf_city_director_purple_pewter', [1]);
assert.equal(stage(p), 40, 'the joined company director authorizes the tunnel');
assert.equal(get(p, 'forget_boarding_removed'), 1);
assert.equal(points(p), pointsBefore, 'no rewards are granted by growing, brewing or opening the tunnel');
console.log('PASS native Kelda growing, optional letter, timed brewing, repeated recovery and Consortium gate');

// The same unseeded account now solves the original client interfaces and earns
// every investigation flag. Routes come from the guide plus the original meshes,
// not the implementation's route predicates or destination constants.
const questCart = { level: 0, x: 2917, z: 10164 };
const tunnelConductor = [...World.npcs].find(row => row.isActive &&
  row.type === id('NpcType', 'dwarf_city_train_conductor3'));
assert(tunnelConductor, 'the original tunnel conductor initializes the quest cart');
const questSpawn = ScriptRunner.init(
  ScriptProvider.getByName('[ai_spawn,dwarf_city_train_conductor3]'), tunnelConductor);
tunnelConductor.executeScript(questSpawn);
assert.equal(questSpawn.execution, ScriptState.FINISHED);
for (const progress of [0, 30, 70, complete]) {
  const refused = fixture(); set(refused, 'forget_quest', progress);
  give(refused, 'dwarf_minecart_ticket_kelda_ice');
  give(refused, 'dwarf_minecart_ticket_kelda_whitewolf');
  loc(refused, 'keldagrim_train_cart', questCart);
  const before = tile(refused);
  operate(refused, 'keldagrim_train_cart', 1, [], questCart);
  assert.deepEqual(tile(refused), before, `stage${progress}: quest rail is closed, without normal-ride fallthrough`);
  assert.equal(stage(refused), progress);
  assert.equal(count(refused, 'dwarf_minecart_ticket_kelda_ice'), 1);
  assert.equal(count(refused, 'dwarf_minecart_ticket_kelda_whitewolf'), 1);
}
operate(p, 'keldagrim_train_cart', 1, [], questCart);
// Actor footprints are independent of the implementation's coordinate constants.
for (const [label, x, z, size] of [
  ['witness director', 1870, 4983, 1], ['witness henchman', 1871, 4982, 1],
  ['witness ogre', 1870, 4979, 2], ['final director', 1865, 4936, 1],
  ['final Colonel', 1866, 4936, 1], ['final emissary', 1866, 4935, 1],
  ['final chaos dwarf', 1864, 4935, 1], ['final ogre', 1862, 4937, 2]
]) {
  for (let dx = 0; dx < size; dx++) for (let dz = 0; dz < size; dz++) {
    assert(!map.isMapBlocked(x + dx, z + dz, 2), `${label}: whole original-model footprint is walkable`);
  }
}
const assertPuzzleLanding = label => {
  assertLanding(p, [1, 1864, 4956], { x: 1863, z: 4956 }, label);
  const [level, x, z] = tile(p);
  for (const [name, targetX, targetZ] of [
    ['keldagrim_track_junction_control_box', 1860, 4955],
    ['keldagrim_track_junction_card_box', 1862, 4954],
    ['forget_train_cart', 1864, 4957]
  ]) {
    const type = id('LocType', name), config = types.LocType.get(type);
    const target = World.getLoc(targetX, targetZ, level, type);
    assert(target, `${label}: original mapped ${name}`);
    const route = map.findPathToLoc(level, x, z, targetX, targetZ, 1,
      target.width, target.length, target.angle, target.shape, config.forceapproach);
    const last = route.at(-1);
    const endX = last === undefined ? x : (last >>> 14) & 0x3fff;
    const endZ = last === undefined ? z : last & 0x3fff;
    assert(map.reachedLoc(level, endX, endZ, targetX, targetZ, target.width, target.length,
      1, target.angle, target.shape, config.forceapproach),
    `${label}: packed route from the actual landing reaches ${name} without repositioning`);
  }
  assert.deepEqual(tile(p), [level, x, z], `${label}: route checks never move the player`);
};
assertPuzzleLanding('original control-room cart entrance');
const greenCard = 'turnleft_trackjunction_control_card';
const yellowCard = 'turnright_trackjunction_control_card';
const boards = [
  {
    stage: 40,
    routes: [{ 1: 2, 3: 1 }, { 1: 1, 2: 2, 5: 1 }, { 1: 2, 3: 2, 6: 1, 7: 1 }],
    stock: [[1, 1], [2, 1], [2, 2]]
  },
  {
    stage: 50,
    routes: [{ 1: 1, 2: 2, 5: 2 }, { 1: 2, 3: 2, 6: 1, 11: 1 },
      { 1: 1, 2: 1, 4: 2, 10: 1, 12: 2 }],
    stock: [[1, 2], [2, 2], [3, 2]]
  },
  {
    stage: 60,
    routes: [{ 1: 1, 2: 1, 4: 2, 6: 2 }, { 1: 2, 3: 2, 5: 2, 7: 1, 9: 1, 12: 1 },
      { 1: 1, 2: 1, 4: 2, 6: 1, 8: 2, 11: 1, 14: 2, 17: 2 }],
    stock: [[2, 2], [3, 3], [4, 4]]
  }
];
for (const [index, board] of boards.entries()) {
  const number = index + 1;
  assert.equal(stage(p), board.stage);
  for (const [trip, selections] of board.routes.entries()) {
    const label = `board${number} trip${trip + 1}`;
    const stockBefore = [greenCard, yellowCard].map(name => count(p, name));
    const stock = () => [greenCard, yellowCard].map((name, colour) =>
      count(p, name) + p.invTotal(bank, obj(name)) +
      Array.from({ length: 19 }, (_, field) => get(p, `forget_if${field + 1}`))
        .filter(selected => selected === colour + 1).length);
    const expected = board.stock[trip].map((minimum, colour) => Math.max(minimum, stockBefore[colour]));
    searchCards(p, number);
    assert.deepEqual(stock(), expected, `${label}: grant only missing earned stones, preserving earlier stones`);
    searchCards(p, number);
    assert.deepEqual(stock(), expected, `${label}: repeated searching cannot duplicate stones`);
    // Banked stones count against earned supply, but genuine loss is recoverable
    // repeatedly at every intermediate board and earned chest trip.
    assert(count(p, greenCard) > 0, `${label}: an actually carried stone is banked`);
    p.invDel(inv, obj(greenCard), 1); p.invAdd(bank, obj(greenCard), 1);
    const carried = count(p, greenCard);
    searchCards(p, number);
    assert.equal(count(p, greenCard), carried, `${label}: a banked stone is not duplicated`);
    p.invDel(bank, obj(greenCard), 1); give(p, greenCard);
    for (let loss = 0; loss < (number === 2 && trip === 0 ? 0 : 2); loss++) {
      for (const name of [greenCard, yellowCard]) p.invDel(inv, obj(name), count(p, name));
      searchCards(p, number);
      assert.deepEqual(stock(), board.stock[trip], `${label}: genuine stone loss ${loss + 1} recovers`);
    }
    operate(p, 'keldagrim_track_junction_control_box');
    assert.equal(p.modalMain, id('Component', puzzleInterfaces[index].root), `${label}: original visible interface`);
    const route = number === 2 && trip === 0 ? { ...selections, 4: 1 } : selections;
    configureTrack(p, number, route);
    if (number === 1 && trip === 0) {
      const before = Array.from({ length: 19 }, (_, field) => get(p, `forget_if${field + 1}`));
      give(p, 'knife', p.invFreeSpace(inv));
      assert.match(operate(p, 'forget_train_cart').text, /inventory space/);
      assert.equal(get(p, 'forget_tunnel_cutscene1'), 0, 'full inventory cannot consume an earned trip');
      assert.deepEqual(Array.from({ length: 19 }, (_, field) => get(p, `forget_if${field + 1}`)), before,
        'full-inventory refusal preserves all inserted stones');
      p.invDel(inv, obj('knife'), count(p, 'knife'));
    }
    const ride = operate(p, 'forget_train_cart');
    if (trip === 2 && number === 1) assert.match(ride.text, /Sabotaging the base of the statue/);
    if (trip === 2 && number === 3) assert.match(ride.text, /Return to Arposandra/);
    if (trip < 2) {
      assert.equal(stage(p), board.stage, `${label}: a stone chest is not story progress`);
      assertPuzzleLanding(`${label}: safe return from stone chest`);
      for (let field = 1; field <= 19; field++) {
        assert.equal(get(p, `forget_if${field}`), 0, `${label}: inserted stones are refunded and reset`);
      }
      if (number === 1 && trip === 0) {
        operate(p, 'forget_train_cart', 2);
        assertLanding(p, [0, 2917, 10163], { x: 2917, z: 10162 }, 'native Return cart reaches the separate rail');
        assert.equal(stage(p), 40, 'leaving the puzzle preserves earned trip progress');
        operate(p, 'keldagrim_train_cart', 1, [], questCart);
        assertPuzzleLanding('re-entry after voluntarily leaving the first board');
      }
    }
  }
  if (number === 1) {
    assert.equal(stage(p), 50, 'the first complete track route earns the witness scene');
    assertLanding(p, [2, 1868, 4983], { x: 1869, z: 4983 }, 'original first witness room');
    operate(p, 'forget_story_exit_next', 1, [], { level: 2, x: 1889, z: 4982 });
    assertPuzzleLanding('witness-room continuation');
  } else if (number === 2) {
    assert.equal(stage(p), 50, 'reaching the archive alone does not complete its investigation');
    assertLanding(p, [2, 1903, 4964], { x: 1903, z: 4963 }, 'original records room');
    const archiveExit = { level: 2, x: 1914, z: 4965 };
    const returnToArchive = () => {
      assertPuzzleLanding('leaving an incompletely read archive is recoverable');
      operate(p, 'keldagrim_track_junction_control_box');
      configureTrack(p, 2, board.routes[2]);
      operate(p, 'forget_train_cart');
      assertLanding(p, [2, 1903, 4964], { x: 1903, z: 4963 }, 'native final route can revisit the archive');
      assert.equal(stage(p), 50);
    };
    operate(p, 'forget_story_exit_next', 1, [], archiveExit);
    assert.equal(stage(p), 50, 'all three records are required before the final board');
    returnToArchive();
    operate(p, 'forget_metal_crate_withpapers3');
    assert.equal(stage(p), 50, 'the decoy crate cannot replace a required record');
    assert.match(operate(p, 'dwarf_keldagrim_metal_bookcase').text, /steadfastly loyal to his rescuers/);
    assert.equal(get(p, 'forget_room2_bookcase'), 1);
    operate(p, 'forget_story_exit_next', 1, [], archiveExit);
    assert.equal(stage(p), 50, 'bookcase alone is insufficient');
    returnToArchive();
    assert.match(operate(p, 'forget_metal_crate_withpapers1').text, /secret preparations to the statue/);
    assert.equal(get(p, 'forget_room2_paper1'), 1);
    operate(p, 'forget_story_exit_next', 1, [], archiveExit);
    assert.equal(stage(p), 50, 'both paper records are required');
    returnToArchive();
    assert.match(operate(p, 'forget_metal_crate_withpapers2').text, /Will tell Grunsh to adjust his spell next time/);
    assert.equal(get(p, 'forget_room2_paper2'), 1);
    assert.equal(stage(p), 60, 'the native third record earns the final board');
    operate(p, 'forget_story_exit_next', 1, [], archiveExit);
    assertPuzzleLanding('completed records-room continuation');
  } else {
    assert.equal(stage(p), 70, 'the final route and memory-wipe scene are earned');
    assert(p.visitedQuestTiles.has('2,1862,4939'), 'final scene visits the original Room 6, not the archive');
    assertWalkableLanding([2, 1862, 4939], { x: 1863, z: 4939 }, 'original Room 6 entrance');
    assertLanding(p, [0, 2917, 10163], { x: 2917, z: 10162 }, 'safe separate-rail station return after memory wipe');
  }
}
talk(p, 'dwarf_city_black_guard_leader');
assert.equal(stage(p), 80, 'Veldaban leads the confused player to the pub');
at(p, { level: 0, x: 2914, z: 10194 });
give(p, 'beer'); give(p, 'kebab');
const earnedReward = rewardSnapshot(p);
assert.match(itemOption(p, 'beer'), /spell has worked its magic again/);
assertCompleted(p, earnedReward);
assert.equal(points(p) - pointsBefore, 2, 'one account earns the entire quest and exactly two points');
console.log('PASS unseeded native 0->140, all three original track interfaces, records, recovery and earned finale');

// Shared dispatches keep their existing quests and inactive states.
const ordinary = player();
assert.match(talk(ordinary, 'dwarf_city_rowdy_dwarf').text, /Get OUT of my WAY/);
for (const name of ['forget_drunken_talk', 'forget_rowdy_talk', 'forget_khorvak_talk',
  'forget_gauss_talk', 'forget_rind_talk', 'forget_conductor_talk', 'forget_elstan_letter']) {
  assert.equal(proc(ordinary, name).popInt(), 0, `${name}: inactive quest never intercepts the owner`);
}
assert.equal(proc(ordinary, 'forget_director_talk', [1]).popInt(), 0);
assert.equal(proc(ordinary, 'forget_kelda_barmaid').popInt(), 0, 'ordinary barmaid service is not intercepted');
give(ordinary, 'coins', 5);
assert.match(talk(ordinary, 'dwarf_city_barmaid_poor', [2, 1]).text, /Thanks for your custom/);
assert.equal(count(ordinary, 'coins'), 3);
assert.equal(count(ordinary, 'beer'), 1, 'ordinary pub beer remains available');
const prePour = fixture(); set(prePour, 'forget_quest', 1);
assert.match(talk(prePour, 'dwarf_city_barmaid_poor', [4]).text, /stopped serving those/);
assert.equal(count(prePour, 'kelda_stout'), 0, 'the retained pre-pour Kelda refusal grants no stout');
const beforePour = fixture(); set(beforePour, 'forget_quest', 10);
assert.equal(proc(beforePour, 'forget_kelda_barmaid').popInt(), 0, 'stage10 alone cannot conjure unbrewed stout');
assert.match(talk(ordinary, 'dwarf_city_train_conductor3').text, /important traffic/);
const overlap = fixture();
set(overlap, 'forget_quest', 10); set(overlap, 'dwarfrock_quest', 40);
const schematic = talk(overlap, 'dwarfrock_engineer2', [2, 1]);
assert.match(schematic.text, /schematic|multicannon/i, 'Between a Rock remains available during the Kelda task');
assert.equal(get(overlap, 'forget_seed3_given'), 0, 'choosing schematics does not consume the Kelda dialogue');
const unfinishedCompany = fixture();
set(unfinishedCompany, 'giantdwarf_quest', 5); set(unfinishedCompany, 'forget_quest', 30);
assert.equal(proc(unfinishedCompany, 'forget_director_talk', [1]).popInt(), 0,
  'Giant Dwarf company tasks take priority until Giant Dwarf is complete');
const wrongCompany = fixture(); set(wrongCompany, 'forget_quest', 30);
assert.equal(proc(wrongCompany, 'forget_director_talk', [2]).popInt(), 0,
  'a different company director cannot remove the boards');
assert.equal(stage(wrongCompany), 30);
const noLetter = fixture();
set(noLetter, 'forget_quest', 10); set(noLetter, 'fairy_farmers_quest', 1);
assert.equal(proc(noLetter, 'forget_elstan_letter').popInt(), 0,
  'Elstan retains FT1 and Garden dialogue when no accepted letter is held');
assert.match(talk(noLetter, 'elstan', [2]).text, /come back another time/,
  'native Elstan still dispatches the pre-existing GAG menu without a letter');
const conductor = [...World.npcs].find(row => row.isActive &&
  row.type === id('NpcType', 'dwarf_city_train_conductor1'));
assert(conductor, 'natural conductor initializes the existing shared carts');
const spawn = ScriptProvider.getByName('[ai_spawn,dwarf_city_train_conductor1]');
const spawnState = ScriptRunner.init(spawn, conductor);
conductor.executeScript(spawnState);
assert.equal(spawnState.execution, ScriptState.FINISHED);
for (const progress of [40, complete]) {
  for (const [z, ticket, destination] of [
    [10175, 'dwarf_minecart_ticket_kelda_ice', [0, 2994, 9845]],
    [10169, 'dwarf_minecart_ticket_kelda_whitewolf', [0, 2874, 9873]]
  ]) {
    const traveller = fixture(); set(traveller, 'forget_quest', progress); give(traveller, ticket, 2);
    operate(traveller, 'keldagrim_train_cart', 1, [], { level: 0, x: 2911, z });
    assert.deepEqual(tile(traveller), destination, `Forgettable stage${progress} leaves normal train routes untouched`);
    assert.equal(count(traveller, ticket), 1);
    assert.equal(stage(traveller), progress);
  }
}
for (const name of ['beer', 'kebab']) {
  const normalFood = fixture(); give(normalFood, name);
  itemOption(normalFood, name);
  assert.equal(count(normalFood, name), 0, 'ordinary consumption still consumes the item');
  assert.equal(stage(normalFood), 0);
}
for (const [position, supplies] of [
  [{ level: 0, x: 3170, z: 3173 }, ['beer', 'kebab']],
  [{ level: 1, x: 2914, z: 10194 }, ['beer', 'kebab']],
  [{ level: 0, x: 2914, z: 10194 }, ['beer']]
]) {
  const refused = fixture(); set(refused, 'forget_quest', 80); at(refused, position);
  for (const name of supplies) give(refused, name);
  itemOption(refused, 'beer');
  assert.equal(stage(refused), 80, 'pub level/location and both foods are required');
}
function rewardSnapshot(subject) {
  return { stats: [...subject.stats], points: points(subject), stout: count(subject, 'mature_dwarven_stout') };
}
function assertCompleted(subject, before) {
  assert.equal(stage(subject), complete);
  assert.equal(points(subject) - before.points, 2, 'exact period Quest Point reward');
  for (let stat = 0; stat < subject.stats.length; stat++) {
    assert.equal(subject.stats[stat] - before.stats[stat],
      stat === PlayerStat.FARMING || stat === PlayerStat.COOKING ? 50000 : 0,
      `exact period reward in tenths for skill ${stat}`);
  }
  assert.equal(count(subject, 'mature_dwarven_stout') - before.stout, 2);
  assert.equal(subject.modalMain, id('Component', 'questscroll_death'), 'real completion scroll');
  assert(subject.packets.some(packet => packet.constructor.name === 'IfSetText' &&
    packet.text === 'You have completed Forgettable Tale...!'));
  const finished = rewardSnapshot(subject);
  proc(subject, 'forget_complete');
  assert.deepEqual(rewardSnapshot(subject), finished, 'completion never grants twice');
}
for (const food of ['beer', 'kebab']) {
  const finale = fixture(); set(finale, 'forget_quest', 80);
  at(finale, { level: 0, x: 2914, z: 10194 });
  assert(!map.isMapBlocked(finale.x, finale.z, finale.level), 'real pub consumption tile is walkable');
  give(finale, 'beer'); give(finale, 'kebab');
  const before = rewardSnapshot(finale);
  const text = itemOption(finale, food);
  assert.match(text, /spell has worked its magic again/);
  assertCompleted(finale, before);
}
for (const name of ['kelda_hop_seed', 'kelda_hops', 'kelda_stout', 'turnright_trackjunction_control_card',
  'turnleft_trackjunction_control_card', 'forget_gardener_letter']) {
  assert.equal(types.ObjType.get(obj(name)).tradeable, false, `${name}: quest item is untradeable`);
}
// Branch fixtures retain a genuinely accepted errand after every later quest beat.
for (const progress of [20, 30, 40, 50, 60, 70, 80, complete]) {
  const lateLetter = fixture();
  set(lateLetter, 'forget_quest', progress);
  set(lateLetter, 'forget_seed3_told', 1);
  set(lateLetter, 'forget_gardener_task', 1);
  for (let loss = 0; loss < 2; loss++) {
    talk(lateLetter, 'dwarf_city_gardener_dwarf');
    assert.equal(count(lateLetter, 'forget_gardener_letter'), 1, `stage${progress}: lost accepted letter recovers`);
    lateLetter.invDel(inv, obj('forget_gardener_letter'), 1);
  }
  lateLetter.invAdd(bank, obj('forget_gardener_letter'), 1);
  talk(lateLetter, 'dwarf_city_gardener_dwarf', [2]);
  assert.equal(count(lateLetter, 'forget_gardener_letter'), 0, `stage${progress}: banked letter is not duplicated`);
  lateLetter.invDel(bank, obj('forget_gardener_letter'), 1);
  give(lateLetter, 'forget_gardener_letter');
  talk(lateLetter, 'elstan', [1]);
  talk(lateLetter, 'dwarf_city_gardener_dwarf');
  assert.equal(count(lateLetter, 'marrentill_seed'), 2, `stage${progress}: late delivery earns the exact optional reward`);
  talk(lateLetter, 'dwarf_city_gardener_dwarf', [2]);
  assert.equal(count(lateLetter, 'marrentill_seed'), 2, `stage${progress}: late delivery rewards once`);
  assert.equal(stage(lateLetter), progress, 'the optional errand never changes the main quest stage');
}
console.log('PASS Forgettable shared non-regression, strict finale, exact rewards, once-only scroll');
loc(fixture(), 'dwarf_keldagrim_bankbooth');
console.log(`PACKED_APPROACHES ${JSON.stringify(approaches)}`);
if (originDescriptor) Object.defineProperty(performance, 'timeOrigin', originDescriptor);
else delete performance.timeOrigin;
if (nowDescriptor) Object.defineProperty(performance, 'now', nowDescriptor);
else delete performance.now;
// World owns maintenance timers; this offline test does not run a live server.
process.exit(0);
