#!/usr/bin/env node
// The Giant Dwarf: checked-out maps, compiled scripts and production interaction dispatch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  World, PlayerStat, ScriptProvider, ScriptState, contentRoot, count, dialoguePage, engineModule,
  execute, held, id, inv, invCom, map, obj, player, resumeDialogue, slotOf, tile, tick, types, use, weakCount
} from '../swamp-caves/runtime.mjs';

const resolveNpcType = (await engineModule('engine/entity/resolveNpcType.ts')).default;
const rsbuf = await engineModule('network/rsbuf/index.ts');
const NpcStat = (await engineModule('engine/entity/NpcStat.ts')).NpcStat;
const OpNpc = (await engineModule('network/game/client/model/OpNpc.ts')).default;
const OpNpcHandler = (await engineModule('network/game/client/handler/OpNpcHandler.ts')).default;
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const OpLocHandler = (await engineModule('network/game/client/handler/OpLocHandler.ts')).default;
const OpLocU = (await engineModule('network/game/client/model/OpLocU.ts')).default;
const OpLocUHandler = (await engineModule('network/game/client/handler/OpLocUHandler.ts')).default;
const OpObj = (await engineModule('network/game/client/model/OpObj.ts')).default;
const OpObjHandler = (await engineModule('network/game/client/handler/OpObjHandler.ts')).default;
const OpObjT = (await engineModule('network/game/client/model/OpObjT.ts')).default;
const OpObjTHandler = (await engineModule('network/game/client/handler/OpObjTHandler.ts')).default;
const groundSpellHandler = new OpObjTHandler();
const takeGroundHandler = new OpObjHandler();
const npcHandler = new OpNpcHandler();
const locHandler = new OpLocHandler();
const locUseHandler = new OpLocUHandler();
function nativeResult(p, choices, label) {
  const script = p.getOpTrigger() ?? p.getApTrigger();
  assert(script && ScriptProvider.getByName(script.name), `${label}: production dispatch resolves a packed trigger`);
  p.dialogueMark = p.packets.length;
  p.processInteraction();
  return { script: script.name, text: finish(p, choices, script.name) };
}
function showNpc(p, target) {
  rsbuf.addPlayer(p.slot);
  rsbuf.addNpc(target.nid, target.type);
  const appearance = p.generateAppearance();
  const hp = PlayerStat.HITPOINTS;
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
  assert(rsbuf.hasNpc(p.slot, target.nid), 'production visibility encoder includes the selected NPC');
}
function nativeNpc(p, target, option = 1, choices = [], label = `NPC option ${option}`) {
  const visible = resolveNpcType(types.NpcType.get(target.type), p);
  assert(visible?.op?.[option - 1] && visible.op[option - 1] !== 'hidden',
    `${label}: visible NPC morph exposes the packed option`);
  showNpc(p, target);
  assert(npcHandler.handle(new OpNpc(option, target.nid), p), `${label}: production OpNpc accepts the visible NPC`);
  return nativeResult(p, choices, label);
}
function nativeLoc(p, target, option = 1, choices = [], label = `loc option ${option}`) {
  assert(locHandler.handle(new OpLoc(option, target.x, target.z, target.type), p),
    `${label}: production OpLoc accepts the natural loc`);
  return nativeResult(p, choices, label);
}
function nativeLocItem(p, target, item, choices = [], label = `use ${item} on loc`) {
  assert(locUseHandler.handle(new OpLocU(target.x, target.z, target.type,
    obj(item), slotOf(p, item), invCom), p), `${label}: production OpLocU accepts the natural loc`);
  return nativeResult(p, choices, label);
}
function talk(p, name, choices = [], ...aliases) {
  const target = npc(p, name, ...aliases);
  return nativeNpc(p, target, 1, choices, `Talk-to ${name}`);
}
function operate(p, name, option = 1, choices = []) {
  const target = loc(p, name);
  return nativeLoc(p, target, option, choices, `${name} option ${option}`);
}
const root = path.join(contentRoot, 'scripts/quests/quest_giantdwarf');
const constants = fs.readFileSync(path.join(root, 'configs/giantdwarf.constant'), 'utf8');
const constant = name => {
  const match = constants.match(new RegExp(`^\\^${name}\\s*=\\s*(-?\\d+)\\s*$`, 'm'));
  assert(match, `checked-out ${name} exists`);
  return Number(match[1]);
};
const complete = constant('giantdwarf_complete');
assert.equal(constant('giantdwarf_questpoints'), 2, 'period reward is two Quest Points');
function variable(name) {
  const bit = types.VarBitType.getId(name);
  if (bit >= 0) return { bit: true, id: bit };
  return { bit: false, id: id('VarPlayerType', name) };
}
function get(p, name) {
  const row = variable(name);
  return row.bit ? p.getVarBit(row.id) : p.getVar(row.id);
}
function set(p, name, value) {
  const row = variable(name);
  if (row.bit) p.setVarBit(row.id, value); else p.setVar(row.id, value);
}
const stage = p => get(p, 'giantdwarf_quest');
function proc(p, name, args = []) {
  return execute(`[proc,${name}]`, p, args);
}
function points(p) { return proc(p, 'count_questpoints').popInt(); }
function give(p, name, amount = 1) { p.invAdd(inv, obj(name), amount); }
function wipe(p) { p.invClear(inv); }
function at(p, position) {
  p.level = position.level; p.x = position.x; p.z = position.z;
  p.originX = p.x; p.originZ = p.z; p.clearInteraction();
}
function standNpc(p, target) {
  const saved = tile(p);
  for (let distance = 1; distance <= 8; distance++) {
    for (let dx = -distance; dx <= distance; dx++) {
      for (let dz = -distance; dz <= distance; dz++) {
        const position = { level: target.level, x: target.x + dx, z: target.z + dz };
        if (map.isMapBlocked(position.x, position.z, position.level)) continue;
        at(p, position);
        if (p.inOperableDistance(target)) {
          at(p, { level: saved[0], x: saved[1], z: saved[2] });
          return position;
        }
      }
    }
  }
  at(p, { level: saved[0], x: saved[1], z: saved[2] });
  assert.fail(`${types.NpcType.get(target.type).debugname} has no safe operation stand`);
}
function npc(p, ...names) {
  const ids = names.map(name => id('NpcType', name));
  const target = [...World.npcs].find(row => row.isActive && ids.includes(row.type));
  assert(target, `natural NPC placement exists: ${names.join('/')}`);
  at(p, standNpc(p, target));
  return target;
}
const placements = [];
for (const file of fs.readdirSync(path.join(contentRoot, 'maps')).filter(file => /^m\d+_\d+\.jm2$/.test(file))) {
  const [mx, mz] = file.slice(1, -4).split('_').map(Number);
  let section = '';
  for (const line of fs.readFileSync(path.join(contentRoot, 'maps', file), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) section = line;
    if (!section.includes('LOC')) continue;
    const match = /^(\d+) (\d+) (\d+): (\d+) (\d+)(?: (\d+))?/.exec(line);
    if (!match) continue;
    placements.push({ level: Number(match[1]), x: mx * 64 + Number(match[2]),
      z: mz * 64 + Number(match[3]), type: Number(match[4]) });
  }
}
function loc(p, name) {
  const type = id('LocType', name), config = types.LocType.get(type);
  for (const row of placements.filter(row => row.type === type)) {
    const target = World.getLoc(row.x, row.z, row.level, type);
    if (!target) continue;
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        const x = target.x + dx, z = target.z + dz;
        if (map.isMapBlocked(x, z, target.level)) continue;
        if (!map.reachedLoc(target.level, x, z, target.x, target.z, config.width, config.length,
          1, target.angle, target.shape, config.forceapproach)) continue;
        at(p, { level: target.level, x, z });
        assert(p.inOperableDistance(target), `${name} stand reaches the natural loc`);
        return target;
      }
    }
  }
  assert.fail(`natural reachable loc ${name}`);
}
function finish(p, choices = [], label = 'interaction') {
  const pending = [...choices], pages = [], firstMessage = p.messages.length;
  for (let step = 0; step < 1200; step++) {
    const state = p.activeScript;
    if (!state) {
      if (!weakCount(p)) break;
      tick(p); continue;
    }
    assert.notEqual(state.execution, ScriptState.ABORTED, `${label} must not abort`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      pages.push(...dialoguePage(p));
      const choice = /^multi[2-5]$/.test(types.Component.get(p.modalChat).comName);
      assert(!choice || pending.length, `${label}: missing explicit dialogue choice; ${pages.join(' ')}`);
      resumeDialogue(p, choice ? pending.shift() : null);
    } else if (state.execution === ScriptState.SUSPENDED) tick(p);
    else if (state.execution === ScriptState.FINISHED) break;
    else assert.fail(`${label}: unexpected execution ${state.execution}`);
  }
  assert.equal(pending.length, 0, `${label} consumed every choice`);
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED, `${label} settles`);
  return [...pages, ...p.messages.slice(firstMessage)].join(' ');
}

const rewards = new Map([
  [PlayerStat.MINING, 25000], [PlayerStat.SMITHING, 25000], [PlayerStat.CRAFTING, 25000],
  [PlayerStat.MAGIC, 15000], [PlayerStat.THIEVING, 15000], [PlayerStat.FIREMAKING, 15000]
]);
function rewardSnapshot(subject) {
  return { stats: [...subject.stats], points: points(subject), notes: count(subject, 'dwarf_meeting_notes1') };
}
function assertCompleted(subject, before) {
  assert.equal(stage(subject), complete, 'meeting commits the terminal quest state');
  assert.equal(points(subject) - before.points, 2, 'exact period Quest Point reward');
  for (let stat = 0; stat < subject.stats.length; stat++) {
    assert.equal(subject.stats[stat] - before.stats[stat], rewards.get(stat) ?? 0,
      `period reward has exact tenths of XP for skill ${stat}`);
  }
  for (const name of ['giantdwarf_red_traders_gone', 'giantdwarf_red_axe_gone']) assert.equal(get(subject, name), 1);
  for (const name of ['giantdwarf_statue_invis', 'giantdwarf_cutscene_guard_visible']) assert.equal(get(subject, name), 0);
  assert.equal(count(subject, 'dwarf_meeting_notes1'), before.notes + 1, 'meeting minutes are provided once');
  assert.equal(subject.modalMain, id('Component', 'questscroll_death'), 'real generic completion scroll is open');
  assert(subject.packets.some(packet => packet.constructor.name === 'IfSetText' &&
    packet.text === 'You have completed The Giant Dwarf!'), 'completion scroll names the quest');
  const finished = rewardSnapshot(subject);
  proc(subject, 'giantdwarf_complete');
  assert.deepEqual(rewardSnapshot(subject), finished, 'completion cannot pay rewards or notes twice');
}
function meetingFixtures() {
  const minutes = player();
  set(minutes, 'giantdwarf_quest', 7); set(minutes, 'giantdwarf_current_company', 1);
  set(minutes, 'giantdwarf_original_company', 1); set(minutes, 'giantdwarf_statue_invis', 1);
  const before = rewardSnapshot(minutes);
  talk(minutes, 'dwarf_city_black_guard_leader', [1, 2, 2]);
  assertCompleted(minutes, before);
  minutes.closeModal();
  const beforeReading = rewardSnapshot(minutes);
  held(minutes, 'dwarf_meeting_notes1', 1);
  assert.match(finish(minutes), /human decide/);
  assert.deepEqual(rewardSnapshot(minutes), beforeReading, 'reading minutes is not another completion');
  console.log('PASS Giant Dwarf meeting-minutes choice and idempotent period rewards');
}

// The first voyage is not replaced by a quest-stage fixture.
const p = player();
assert.equal(stage(p), 0);
assert.match(talk(p, 'dwarf_city_shop_weapons', [2]).text, /Quality Weapons Shop/);
assert.equal(stage(p), 0, 'ordinary shop dialogue does not start the quest');
talk(p, 'dwarf_city_boatman_mines_prequest', [1, 1, 1]);
assert.equal(stage(p), 2, 'the actual accident and accepted Veldaban briefing reach stage two');
assert.equal(get(p, 'giantdwarf_statue_invis'), 1);
assert.equal(get(p, 'giantdwarf_veldaban_introduced'), 1);
assert.equal(get(p, 'giantdwarf_cutscene_guard_visible'), 0);
assert.equal(points(p), 0);
console.log('PASS Giant Dwarf natural boat/intro, stage 0 -> 2');
function nativeItemOnItem(p, used, target, label = `${used} on ${target}`) {
  p.dialogueMark = p.packets.length;
  assert(use(p, used, target), `${label}: production OpHeldU accepts the inventory packet`);
  return finish(p, [], label);
}

function nativeGroundTake(p, target, label = `Take ${types.ObjType.get(target.type).debugname}`, expectedTaken = true) {
  assert.equal(target.level, p.level, `${label}: ground target is on the player's level`);
  assert(p.inOperableDistance(target), `${label}: ground target is in native interaction range`);
  const type = types.ObjType.get(target.type);
  const before = count(p, type.debugname);
  const option = type.op.findIndex(row => row === 'Take') + 1;
  assert(option > 0, `${label}: packed ground-item type exposes Take`);
  assert(takeGroundHandler.handle(new OpObj(option, target.x, target.z, target.type), p),
    `${label}: production OpObj accepts the ground target`);
  const result = nativeResult(p, [], label);
  assert.equal(target.isActive, !expectedTaken, `${label}: native Take has the expected ground-entity result`);
  assert.equal(count(p, type.debugname), before + (expectedTaken ? 1 : 0),
    `${label}: native Take has the expected inventory result`);
  return result;
}

const companyRows = [
  { id: 1, name: 'Purple Pewter', secretary: 'dwarf_city_secretary_purple_pewter', director: 'dwarf_city_director_purple_pewter' },
  { id: 2, name: 'Yellow Fortune', secretary: 'dwarf_city_secretary_yellow_fortune', director: 'dwarf_city_director_yellow_fortune' },
  { id: 3, name: 'Blue Opal', secretary: 'dwarf_city_secretary_blue_opal', director: 'dwarf_city_director_blue_opal' },
  { id: 4, name: 'Green Gemstone', secretary: 'dwarf_city_secretary_green_gemstone', director: 'dwarf_city_director_green_gemstone' },
  { id: 5, name: 'White Chisel', secretary: 'dwarf_city_secretary_white_chisel', director: 'dwarf_city_director_white_chisel' },
  { id: 6, name: 'Silver Cog', secretary: 'dwarf_city_secretary_silver_cog', director: 'dwarf_city_director_silver_cog' },
  { id: 7, name: 'Brown Engine', secretary: 'dwarf_city_secretary_brown_engine', director: 'dwarf_city_director_brown_engine' }
];
const taskItemNames = [
  'copper_ore', 'tin_ore', 'clay', 'iron_ore', 'silver_ore', 'coal', 'gold_ore', 'mithril_ore',
  'bronze_bar', 'iron_bar', 'steel_bar', 'silver_bar', 'gold_bar', 'mithril_bar'
];
const genderSource = fs.readFileSync(path.join(contentRoot, 'scripts/player/configs/gender.constant'), 'utf8');
function namedConstant(source, name) {
  const match = source.match(new RegExp(`^\\^${name}\\s*=\\s*(-?\\d+)\\s*$`, 'm'));
  assert(match, `checked-out ${name} constant exists`);
  return Number(match[1]);
}
const male = namedConstant(genderSource, 'gender_male');
const female = namedConstant(genderSource, 'gender_female');

function field(value, lo, hi) {
  return Math.floor(value / (2 ** lo)) % (2 ** (hi - lo + 1));
}
function setWorkField(p, lo, hi, value) {
  const current = get(p, 'giantdwarf_company_work');
  const place = 2 ** lo, width = 2 ** (hi - lo + 1);
  set(p, 'giantdwarf_company_work',
    current + (value - Math.floor(current / place) % width) * place);
}
function workField(p, lo, hi) {
  return field(get(p, 'giantdwarf_company_work'), lo, hi);
}
function companyFixture(stageValue, {
  gender = male, current = 0, original = 0, secretaryProgress = 0, secretaryTarget = 0,
  directorProgress = 0, directorCompany = 0, kind = 0, quantity = 0, taskCompany = 0, refusals = 0
} = {}) {
  const p = player();
  p.gender = gender;
  set(p, 'giantdwarf_quest', stageValue);
  set(p, 'giantdwarf_current_company', current);
  set(p, 'giantdwarf_original_company', original);
  set(p, 'giantdwarf_company_work', 0);
  setWorkField(p, 0, 3, secretaryProgress);
  setWorkField(p, 4, 7, secretaryTarget);
  setWorkField(p, 8, 11, directorProgress);
  setWorkField(p, 12, 14, directorCompany);
  setWorkField(p, 15, 18, kind);
  setWorkField(p, 19, 24, quantity);
  setWorkField(p, 25, 27, taskCompany);
  setWorkField(p, 28, 29, refusals);
  return p;
}
function activeCompanyTask(p) {
  const kind = workField(p, 15, 18);
  assert(kind > 0 && kind <= taskItemNames.length, 'accepted company order records a packed ore or bar kind');
  const item = types.ObjType.get(proc(p, 'giantdwarf_company_task_obj', [kind]).popInt()).debugname;
  assert.equal(item, taskItemNames[kind - 1], 'compiled order maps to the checked-out ore or bar type');
  return { kind, item, quantity: workField(p, 19, 24), company: workField(p, 25, 27) };
}
function beginTalk(p, name) {
  const target = npc(p, name);
  const visible = resolveNpcType(types.NpcType.get(target.type), p);
  assert(visible?.op?.[0] && visible.op[0] !== 'hidden', `${name}: visible form exposes Talk-to`);
  showNpc(p, target);
  p.dialogueMark = p.packets.length;
  assert(npcHandler.handle(new OpNpc(1, target.nid), p), `${name}: real Talk-to packet is accepted`);
  const script = p.getOpTrigger() ?? p.getApTrigger();
  assert(script && ScriptProvider.getByName(script.name), `${name}: packed Talk-to trigger resolves`);
  p.processInteraction();
  return script;
}
function reachChoice(p, label) {
  for (let step = 0; step < 160; step++) {
    const state = p.activeScript;
    assert(state && state.execution !== ScriptState.ABORTED, `${label}: pending dialogue remains live`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      const rootName = types.Component.get(p.modalChat).comName;
      if (/^multi[2-5]$/.test(rootName)) return rootName;
      resumeDialogue(p);
    } else if (state.execution === ScriptState.SUSPENDED) {
      tick(p);
    } else {
      assert.fail(`${label}: expected dialogue or choice, got ${state.execution}`);
    }
  }
  assert.fail(`${label}: choice appears within the bounded dialogue`);
}

function companySwitchFixtures() {
  const names = companyFixture(6);
  for (const row of companyRows) {
    assert.equal(proc(names, 'giantdwarf_company_name', [row.id]).popString(), row.name,
      `company id ${row.id} resolves from the packed company name procedure`);
  }

  const maleSwitch = companyFixture(6, { gender: male, current: 1 });
  for (const row of companyRows.filter(row => row.id !== 1 && row.id !== 2)) {
    set(maleSwitch, 'giantdwarf_current_company', 1);
    set(maleSwitch, 'giantdwarf_original_company', 0);
    talk(maleSwitch, row.director, [1]);
    assert.equal(get(maleSwitch, 'giantdwarf_current_company'), row.id,
      `${row.name}: accepted native switch selects the director's company`);
    assert.equal(get(maleSwitch, 'giantdwarf_original_company'), 0,
      `${row.name}: switching before support does not choose the statue head`);
    assert.equal(stage(maleSwitch), 6, `${row.name}: switching preserves joined stage`);
  }
  const femaleSwitch = companyFixture(6, { gender: female, current: 1 });
  talk(femaleSwitch, companyRows[1].director, [1]);
  assert.equal(get(femaleSwitch, 'giantdwarf_current_company'), 2,
    'female account can switch to Yellow Fortune');
  assert.equal(stage(femaleSwitch), 6);

  for (const [gender, row] of [[male, companyRows[1]], [female, companyRows[6]]]) {
    const secretary = companyFixture(5, { gender });
    const secretaryBefore = get(secretary, 'giantdwarf_company_work');
    talk(secretary, row.secretary);
    assert.equal(get(secretary, 'giantdwarf_company_work'), secretaryBefore,
      `${row.name}: the gender gate refuses secretary work without changing standing`);
    assert.equal(stage(secretary), 5);

    const director = companyFixture(5, {
      gender, secretaryProgress: 5, secretaryTarget: 5, directorProgress: 3, directorCompany: row.id
    });
    talk(director, row.director);
    assert.equal(stage(director), 5, `${row.name}: gender gate refuses membership`);
    assert.equal(get(director, 'giantdwarf_current_company'), 0);
    assert.equal(get(director, 'giantdwarf_original_company'), 0);
  }

  const approval = companyFixture(6, { current: 3 });
  talk(approval, companyRows[2].director, [1]);
  assert.equal(stage(approval), 7, 'first native head approval advances the stage');
  assert.equal(get(approval, 'giantdwarf_original_company'), 3,
    'first support fixes the original statue company');
  talk(approval, companyRows[0].director);
  assert.equal(get(approval, 'giantdwarf_current_company'), 3, 'stage seven locks the selected company');
  assert.equal(get(approval, 'giantdwarf_original_company'), 3, 'stage seven keeps the statue choice');

  const completed = companyFixture(complete, { current: 3, original: 3 });
  talk(completed, companyRows[0].director, [1]);
  assert.equal(stage(completed), complete, 'post-quest company change preserves completion');
  assert.equal(get(completed, 'giantdwarf_current_company'), 1, 'post-quest switch changes current company');
  assert.equal(get(completed, 'giantdwarf_original_company'), 3, 'post-quest switch preserves statue company');
  console.log('PASS Giant Dwarf company IDs, gender gates, switching and original-head lock');
}

function companyErrandFixtures() {
  const secretary = companyFixture(5);
  const secret = companyRows[0].secretary;
  talk(secretary, secret, [1]);
  const task = activeCompanyTask(secretary);
  assert(task.kind <= 8, 'secretary offers an ore or clay order');
  assert.equal(task.quantity, constant('giantdwarf_company_ore_quantity'));
  assert.equal(task.company, companyRows[0].id);
  give(secretary, task.item, task.quantity - 1);
  talk(secretary, secret);
  assert.equal(workField(secretary, 15, 18), task.kind, 'insufficient delivery keeps the assigned order');
  assert.equal(count(secretary, task.item), task.quantity - 1, 'insufficient delivery takes no partial items');
  assert.equal(workField(secretary, 0, 3), 0, 'insufficient delivery earns no secretary progress');
  talk(secretary, companyRows[2].secretary);
  assert.equal(workField(secretary, 15, 18), task.kind, 'another secretary cannot take an active order');
  assert.equal(workField(secretary, 25, 27), task.company);

  const deadline = companyFixture(5);
  talk(deadline, secret, [1]);
  const expiring = activeCompanyTask(deadline);
  assert(expiring.kind <= 8);
  const deadlineTicks = constant('giantdwarf_company_deadline_ticks');
  for (let elapsed = 0; elapsed <= deadlineTicks; elapsed++) {
    tick(deadline);
  }
  assert.equal(workField(deadline, 15, 18), 0, 'deadline clears the active order');
  assert.equal(workField(deadline, 19, 24), 0, 'deadline clears the required quantity');
  assert.equal(workField(deadline, 25, 27), 0, 'deadline clears the assigned company');
  assert.equal(workField(deadline, 0, 3), 0, 'deadline does not award work progress');

  const refusals = companyFixture(5, { secretaryProgress: 1, secretaryTarget: 6 });
  for (let refusal = 1; refusal <= constant('giantdwarf_company_refusal_limit'); refusal++) {
    talk(refusals, secret, [2]);
  }
  assert.equal(workField(refusals, 28, 29), 0, 'refusal count resets after the stated penalty threshold');
  assert.equal(workField(refusals, 0, 3),
    1 - constant('giantdwarf_company_refusal_cost'), 'repeated explicit refusal loses the configured standing');
  assert.equal(stage(refusals), 5);

  const walkingAway = companyFixture(5, { secretaryProgress: 1, secretaryTarget: 6 });
  beginTalk(walkingAway, secret);
  assert.match(reachChoice(walkingAway, 'secretary offer'), /^multi[2-5]$/);
  const beforeWork = get(walkingAway, 'giantdwarf_company_work');
  walkingAway.closeModal();
  assert.equal(get(walkingAway, 'giantdwarf_company_work'), beforeWork,
    'closing the offer without choosing does not record a refusal or change progress');
  assert.equal(stage(walkingAway), 5);
  console.log('PASS Giant Dwarf company ore orders, no partial delivery, deadline, refusal and walk-away');
}

function sharedQuestRegressionFixtures() {
  const shop = player();
  talk(shop, 'dwarf_city_shop_weapons', [2]);
  assert.equal(stage(shop), 0, 'ordinary weapons-shop Talk-to does not start Giant Dwarf');
  const shopNpc = npc(shop, 'dwarf_city_shop_weapons');
  nativeNpc(shop, shopNpc, 3, [], 'ordinary weapons-shop Trade');
  assert.equal(shop.modalMain, id('Component', 'shop_template'), 'ordinary Trade opens the native shop');
  assert.equal(shop.modalSide, id('Component', 'shop_template_side'), 'ordinary Trade opens the player inventory side');
  shop.closeModal();

  const thurgo = player();
  const squireSource = fs.readFileSync(path.join(contentRoot, 'scripts/quests/quest_squire/configs/quest_squire.constant'), 'utf8');
  const squireSpokenThurgo = namedConstant(squireSource, 'squire_spoken_thurgo');
  set(thurgo, 'giantdwarf_quest', 3);
  set(thurgo, 'squire', squireSpokenThurgo);
  const beforeSwordStage = get(thurgo, 'squire');
  const swordBranch = talk(thurgo, 'thurgo', [2]);
  assert.match(swordBranch.text, /picture of the sword/, 'numeric second choice retains Knight\'s Sword dialogue');
  assert.equal(get(thurgo, 'squire'), beforeSwordStage, 'Knight\'s Sword state remains intact beside Giant Dwarf');

  const reldo = player();
  set(reldo, 'giantdwarf_quest', 3);
  give(reldo, 'dwarf_battleaxe_old', 1);
  const imcando = talk(reldo, 'reldo', [4]);
  assert.match(imcando.text, /redberry pie/i, 'Giant Dwarf exposes the in-game Imcando lead');
  assert.equal(get(reldo, 'squire'), 0, 'the Giant Dwarf lead does not start Knight\'s Sword');
  assert.equal(stage(reldo), 3);
  set(reldo, 'squire', namedConstant(squireSource, 'squire_started'));
  talk(reldo, 'reldo', [4]);
  assert.equal(get(reldo, 'squire'), namedConstant(squireSource, 'squire_spoken_reldo'),
    'the same Imcando choice retains Knight\'s Sword progression when both quests are active');
  assert.equal(stage(reldo), 3);
  const originalReldo = player();
  set(originalReldo, 'squire', namedConstant(squireSource, 'squire_started'));
  talk(originalReldo, 'reldo', [4]);
  assert.equal(get(originalReldo, 'squire'), namedConstant(squireSource, 'squire_spoken_reldo'));
  assert.equal(stage(originalReldo), 0, 'ordinary Knight\'s Sword dialogue does not start Giant Dwarf');
  assert.equal(stage(thurgo), 3, 'Knight\'s Sword branch does not advance Giant Dwarf');

  const librarian = player();
  set(librarian, 'giantdwarf_quest', 3);
  set(librarian, 'dwarfrock_quest', 10);
  const rockBranch = talk(librarian, 'dwarf_city_librarian', [2]);
  assert.match(rockBranch.text, /impenetrable rocks/, 'numeric second choice keeps Between a Rock\'s librarian branch');
  assert.equal(get(librarian, 'dwarfrock_quest'), 10, 'Between a Rock stage remains unchanged');
  assert.equal(stage(librarian), 3, 'Between a Rock branch does not advance Giant Dwarf');

  const clothesBranch = player();
  set(clothesBranch, 'giantdwarf_quest', 3);
  set(clothesBranch, 'dwarfrock_quest', 10);
  const giantDwarfBranch = talk(clothesBranch, 'dwarf_city_librarian', [1, 2]);
  assert.match(giantDwarfBranch.text, /King Alvis.*clothes/i,
    'dual-active Hugi option one reaches the Giant Dwarf clothes dialogue');
  assert.equal(stage(clothesBranch), 3);
  assert.equal(get(clothesBranch, 'dwarfrock_quest'), 10,
    'selecting Giant Dwarf at Hugi leaves Between a Rock unchanged');
  const forgetting = player();
  set(forgetting, 'forget_quest', 1);
  const normal = talk(forgetting, 'dwarf_city_black_guard_leader', [2]);
  assert.match(normal.text, /Red Axe/, 'normal Veldaban conversation still starts Forgettable Tale');
  assert.equal(get(forgetting, 'forget_quest'), 1);
  assert.equal(stage(forgetting), 0);
  const progress = companyFixture(2);
  set(progress, 'forget_quest', 1);
  const gdBranch = talk(progress, 'dwarf_city_black_guard_leader');
  assert.match(gdBranch.text, /getting on with rebuilding/, 'active Giant Dwarf keeps its Veldaban progress branch');
  assert.equal(get(progress, 'forget_quest'), 1, 'active Giant Dwarf does not alter Forgettable Tale');
  assert.equal(stage(progress), 2);
  console.log('PASS Giant Dwarf Thurgo, librarian, Keldagrim shop and Veldaban regressions');
}

companySwitchFixtures();
companyErrandFixtures();
sharedQuestRegressionFixtures();
function groundItem(p, item, x, z) {
  const target = World.getObj(x, z, p.level, obj(item), p.hash64);
  assert(target, `natural ground item ${item} exists at ${x},${z}`);
  return target;
}
function nativeTelegrab(p, target, label = `Telekinetic Grab ${types.ObjType.get(target.type).debugname}`, expectedTaken = true) {
  assert.equal(target.level, p.level, `${label}: target is on the player's level`);
  const name = types.ObjType.get(target.type).debugname;
  const before = count(p, name);
  const spell = id('Component', 'magic:telekinetic_grab');
  p.tabs[6] = types.Component.get(spell).rootLayer;
  assert(groundSpellHandler.handle(new OpObjT(target.x, target.z, target.type, spell), p),
    `${label}: production OpObjT accepts the visible ground target`);
  const result = nativeResult(p, [], label);
  assert.equal(target.isActive, !expectedTaken, `${label}: spell has the expected ground-entity result`);
  assert.equal(count(p, name), before + (expectedTaken ? 1 : 0), `${label}: spell has the expected inventory result`);
  return result;
}
function completeCompanyPath(p) {
  const first = companyRows[0];
  talk(p, first.secretary, [1]);
  const target = workField(p, 4, 7);
  assert(target >= 5 && target <= 10, 'period company route assigns five to ten secretary tasks');
  for (let progress = 0; progress < target; progress++) {
    if (progress > 0) talk(p, first.secretary, [1]);
    const task = activeCompanyTask(p);
    assert(task.kind <= 8, 'secretary task is an ore or clay delivery');
    assert.equal(task.quantity, constant('giantdwarf_company_ore_quantity'));
    assert.equal(task.company, first.id);
    give(p, task.item, task.quantity);
    talk(p, first.secretary);
    assert.equal(workField(p, 0, 3), progress + 1, 'accepted secretary delivery advances exactly one task');
    assert.equal(workField(p, 15, 18), 0, 'secretary delivery clears its active order');
  }
  for (let progress = 0; progress < constant('giantdwarf_company_director_tasks'); progress++) {
    talk(p, first.director, [1]);
    const task = activeCompanyTask(p);
    assert(task.kind >= 9, 'director task is a bar delivery');
    assert.equal(task.quantity, constant('giantdwarf_company_bar_quantity'));
    assert.equal(task.company, first.id);
    give(p, task.item, task.quantity);
    talk(p, first.director);
    assert.equal(workField(p, 8, 11), progress + 1, 'accepted director delivery advances exactly one task');
    assert.equal(workField(p, 15, 18), 0, 'director delivery clears its active order');
  }
  talk(p, first.director, [1]);
  assert.equal(stage(p), 6, 'completed tasks allow joining the chosen company');
  assert.equal(get(p, 'giantdwarf_current_company'), first.id);
  const chosen = companyRows[3];
  talk(p, chosen.director, [1]);
  assert.equal(stage(p), 6, 'switching companies before support remains available');
  assert.equal(get(p, 'giantdwarf_current_company'), chosen.id);
  talk(p, chosen.director, [1]);
  assert.equal(stage(p), 7, 'the chosen director receives the support pledge');
  assert.equal(get(p, 'giantdwarf_original_company'), chosen.id);
  console.log('PASS Giant Dwarf secretary/bar errands, company joining and support');
}
function nativeHeld(p, item, option = 1, label = `${item} option ${option}`) {
  p.dialogueMark = p.packets.length;
  assert(held(p, item, option), `${label}: production OpHeld accepts the inventory option`);
  return finish(p, [], label);
}
meetingFixtures();
function handModelPiece(p, item, expectedState) {
  assert.equal(count(p, item), 1, `only the unhanded ${item} remains in inventory`);
  const before = get(p, 'giantdwarf_model_state');
  const result = talk(p, 'dwarf_city_shop_sculpture_model_multi');
  assert.equal(count(p, item), 0, `native Talk-to hands ${item} to Riki`);
  assert.equal(get(p, 'giantdwarf_model_state'), expectedState,
    `Riki's placed multi morph advances from state ${before} to ${expectedState}`);
  assert.equal(stage(p), expectedState === 7 ? 4 : 3,
    'the model is completed before Blasidar advances the quest');
  return result;
}
function gdTile(localX, localZ) {
  return { level: 0, x: 44 * 64 + localX, z: 159 * 64 + localZ };
}
function itemOnLoc(p, item, name) {
  return nativeLocItem(p, loc(p, name), item, [], `use ${item} on ${name}`);
}
function bookWeightFixture() {
  const loaded = player();
  set(loaded, 'giantdwarf_quest', 3);
  set(loaded, 'giantdwarf_sculptor_introduced', 1);
  give(loaded, 'iron_bar', 3); // Original bars are 4 lb each, above the sourced 5 kg limit.
  loaded.calculateRunWeight();
  assert(loaded.runweight >= 5000, 'the real inventory-weight phase puts the carried bars above five kilograms');
  talk(loaded, 'dwarf_city_librarian', [2]);
  operate(loaded, 'dwarf_keldagrim_bookcase_ladder');
  operate(loaded, 'dwarf_keldagrim_bookcase');
  assert.equal(count(loaded, 'dwarf_library_book'), 0, 'a player at or above five kilograms cannot take the costume book');
  assert.equal(stage(loaded), 3, 'book weight does not advance the quest');
}

function bootMethodFixtures() {
  // Negative fixtures may seed quest state/items; the main route below never does.
  const subject = player();
  set(subject, 'giantdwarf_quest', 3);
  talk(subject, 'dwarf_city_excentric_dwarf');
  const dromund = npc(subject, 'dwarf_city_excentric_dwarf');
  const rightTile = gdTile(20, 50);
  const right = groundItem(subject, 'dwarf_perfect_right_boot', rightTile.x, rightTile.z);
  const close = gdTile(20, 49);
  assert.equal(map.isMapBlocked(close.x, close.z, close.level), false);
  at(subject, close);
  const cat = nativeGroundTake(subject, right, 'Take right boot inside the house', false);
  assert.match(cat.text, /Get your hands off that, you dirty human/i);
  assert.equal(count(subject, 'dwarf_perfect_right_boot'), 0);

  let inside;
  for (let x = 18; x <= 25 && !inside; x++) {
    for (let z = 44; z <= 50; z++) {
      const candidate = gdTile(x, z);
      if (map.isMapBlocked(candidate.x, candidate.z, candidate.level)) continue;
      if (!map.isLineOfSight(candidate.level, candidate.x, candidate.z, right.x, right.z)) continue;
      if (map.isLineOfSight(candidate.level, candidate.x, candidate.z, dromund.x, dromund.z)) continue;
      inside = candidate; break;
    }
  }
  assert(inside, 'the original interior has a reachable casting tile outside Dromund line of sight');
  at(subject, inside);
  give(subject, 'lawrune', 1); give(subject, 'airrune', 1);
  const indoorSpell = nativeTelegrab(subject, right, 'Telegrab right boot inside the house', false);
  assert.match(indoorSpell.text, /casting spells in my house/i);
  assert.equal(stage(subject), 3);

  give(subject, 'dwarf_perfect_pair_of_boots', 1);
  const leftTile = gdTile(22, 44), left = groundItem(subject, 'dwarf_perfect_left_boot', leftTile.x, leftTile.z);
  at(subject, gdTile(23, 44));
  const duplicate = nativeGroundTake(subject, left, 'Take another boot while holding the exquisite pair', false);
  assert.match(duplicate.text, /already have the perfect pair of boots/i);
  assert.equal(count(subject, 'dwarf_perfect_left_boot'), 0);
  assert.equal(count(subject, 'dwarf_perfect_pair_of_boots'), 1);
  console.log('PASS Giant Dwarf cat, indoor spell and existing-pair theft gates');
}

function sapphiresBeforeRepairFixture() {
  const subject = player();
  set(subject, 'giantdwarf_quest', 2); // Alternate-order fixture begins at the accepted intro boundary.
  talk(subject, 'dwarf_city_shop_sculpture', [2]);
  talk(subject, 'dwarf_city_shop_weapons', [2, 2, 2]);
  give(subject, 'sapphire', 3);
  nativeItemOnItem(subject, 'sapphire', 'dwarf_battleaxe_old');
  assert.equal(count(subject, 'sapphire'), 0);
  assert.equal(count(subject, 'dwarf_battleaxe_old'), 0);
  assert.equal(count(subject, 'dwarf_battleaxe_sapphires'), 1,
    'three sapphires can be fitted before Thurgo sharpens the axe');
  give(subject, 'redberry_pie', 1); give(subject, 'iron_bar', 1);
  talk(subject, 'thurgo', [1, 1, 1, 1]);
  assert.equal(count(subject, 'redberry_pie'), 0);
  assert.equal(count(subject, 'iron_bar'), 0);
  assert.equal(count(subject, 'dwarf_battleaxe_sapphires'), 0);
  assert.equal(count(subject, 'dwarf_battleaxe_new'), 1);
  assert.equal(stage(subject), 3, 'repair does not bypass Riki or Consortium work');
  console.log('PASS Giant Dwarf sapphires before and after the native axe repair');
}

function townsfolkFixtures() {
  const ordinary = player();
  const fishing = talk(ordinary, 'dwarfrock_boatman_bruv1', [2, 4]);
  assert.match(fishing.text, /No fish around here/);
  assert.equal(stage(ordinary), 0, 'ordinary brothers dialogue does not start the quest');

  const gathering = companyFixture(3);
  set(gathering, 'forget_quest', 1);
  const shared = talk(gathering, 'dwarfrock_boatman_bruv2', [1, 4, 5]);
  assert.match(shared.text, /No fish around here/);
  assert.match(shared.text, /relative of that dwarf/i);
  assert.equal(get(gathering, 'forget_quest'), 1, 'the shared drunk-dwarf branch keeps Forgettable Tale state');
  const collection = talk(gathering, 'dwarfrock_boatman_bruv3', [3, 5]);
  assert.match(collection.text, /looking for a lot of items/);
  assert.equal(stage(gathering), 3);
  const seekingHead = companyFixture(5);
  const head = talk(seekingHead, 'dwarfrock_boatman_bruv1', [3, 4]);
  assert.match(head.text, /only needs to build the head/);

  const completed = companyFixture(complete, { current: 1, original: 1 });
  set(completed, 'forget_quest', 1);
  const before = rewardSnapshot(completed);
  const success = talk(completed, 'dwarfrock_boatman_bruv2', [3, 4]);
  assert.match(success.text, /Purple Pewter/);
  assert.match(success.text, /master builder/);
  assert.equal(get(completed, 'giantdwarf_brothers_toldsuccess'), 1);
  const mines = talk(completed, 'dwarfrock_boatman_bruv3', [2, 4]);
  assert.match(mines.text, /territory of one of the eight major companies/);
  assert.deepEqual(rewardSnapshot(completed), before, 'reporting the statue and ordinary mine chatter pay no rewards');
  console.log('PASS Giant Dwarf brothers progress, first-success bit and ordinary/Forget dialogue');
}

function fullQuestPath(subject) {
  assert.equal(stage(subject), 2, 'the main player reached stage two through the actual intro');

  talk(subject, 'dwarf_city_shop_sculpture', [2]);
  assert.equal(stage(subject), 3, 'Blasidar accepts the statue repair task');
  assert.equal(get(subject, 'giantdwarf_sculptor_introduced'), 1);
  talk(subject, 'dwarf_city_shop_sculpture_model_multi');
  assert.equal(get(subject, 'giantdwarf_cousin_introduced'), 1, 'Riki records his own introduction');

  talk(subject, 'dwarf_city_shop_armour', [2]);
  talk(subject, 'dwarf_city_excentric_dwarf');
  assert.equal(get(subject, 'giantdwarf_statue_work') & 8, 8, 'first Dromund visit records the separate boots clue');
  assert.equal(count(subject, 'dwarf_perfect_left_boot'), 0, 'Talk-to does not directly award either boot');
  const secondDromund = talk(subject, 'dwarf_city_excentric_dwarf');
  assert.match(secondDromund.text, /Are you sure you don't want to give me those boots/i);
  assert.equal(count(subject, 'dwarf_perfect_right_boot'), 0, 'repeat Talk-to also gives no boot');

  const left = groundItem(subject, 'dwarf_perfect_left_boot', gdTile(22, 44).x, gdTile(22, 44).z);
  const leftStance = gdTile(23, 44);
  assert.equal(map.isMapBlocked(leftStance.x, leftStance.z, leftStance.level), false,
    'the natural east-adjacent tile is walkable');
  at(subject, leftStance);
  nativeGroundTake(subject, left, 'Take Dromund’s left boot from its natural ground placement');
  const loneBoot = nativeHeld(subject, 'dwarf_perfect_left_boot', 1);
  assert.match(loneBoot, /wear just one boot/i, 'one boot alone cannot make the exquisite pair');
  assert.equal(count(subject, 'dwarf_perfect_left_boot'), 1);
  assert.equal(count(subject, 'dwarf_perfect_pair_of_boots'), 0);

  const windowTile = gdTile(20, 51), outside = gdTile(20, 52), rightTile = gdTile(20, 50);
  const openWindow = placements.find(row => row.type === id('LocType', 'dwarf_keldagrim_house_window_open')
    && row.level === windowTile.level && row.x === windowTile.x && row.z === windowTile.z);
  assert(openWindow, 'the natural inactive open window exists in the source map');
  assert.equal(types.LocType.get(openWindow.type).blockrange, false, 'the packed open window permits ranged line of sight');
  assert.deepEqual([openWindow.level, openWindow.x, openWindow.z],
    [windowTile.level, windowTile.x, windowTile.z], 'the natural open window is at the retained map tile');
  const right = groundItem(subject, 'dwarf_perfect_right_boot', rightTile.x, rightTile.z);
  at(subject, outside);
  assert.equal(subject.inOperableDistance(right), false, 'the right boot cannot be taken through the window');
  give(subject, 'lawrune', 1);
  give(subject, 'airrune', 1);
  nativeTelegrab(subject, right, 'Telekinetic Grab Dromund’s right boot from outside the open window');
  nativeHeld(subject, 'dwarf_perfect_right_boot', 1);
  assert.equal(count(subject, 'dwarf_perfect_left_boot'), 0);
  assert.equal(count(subject, 'dwarf_perfect_right_boot'), 0);
  assert.equal(count(subject, 'dwarf_perfect_pair_of_boots'), 1,
    'wearing either boot while both are held makes the exquisite pair');
  talk(subject, 'dwarf_city_shop_armour', [2]);
  assert.equal(count(subject, 'dwarf_perfect_pair_of_boots'), 1, 'Saro repeat dialogue does not duplicate boots');
  handModelPiece(subject, 'dwarf_perfect_pair_of_boots', 1);

  talk(subject, 'dwarf_city_shop_cloth_poor', [2]);
  talk(subject, 'dwarf_city_librarian', [2]);
  operate(subject, 'dwarf_keldagrim_bookcase_ladder');
  operate(subject, 'dwarf_keldagrim_bookcase');
  assert.equal(count(subject, 'dwarf_library_book'), 1, 'the real bookcase supplies the costume book below five kilograms');
  talk(subject, 'dwarf_city_shop_cloth_poor', [2]);
  assert.equal(get(subject, 'giantdwarf_vermundi_givenbook'), 1, 'Vermundi receives the book through her Talk-to branch');
  assert.equal(count(subject, 'dwarf_library_book'), 0);

  give(subject, 'tinderbox', 1);
  itemOnLoc(subject, 'tinderbox', 'dwarf_keldagrim_spinning_machine');
  assert.equal(count(subject, 'tinderbox'), 1, 'attempting to light the empty machine consumes no tinderbox');
  assert.equal(count(subject, 'dwarf_clothes'), 0, 'the empty machine cannot make clothes');
  give(subject, 'coal', 1);
  give(subject, 'logs', 1);
  itemOnLoc(subject, 'coal', 'dwarf_keldagrim_spinning_machine');
  assert.equal(count(subject, 'coal'), 0);
  assert.equal(count(subject, 'logs'), 0);
  itemOnLoc(subject, 'tinderbox', 'dwarf_keldagrim_spinning_machine');
  assert.equal(get(subject, 'giantdwarf_statue_work') & 4, 4, 'native Tinderbox use lights the loaded machine');
  assert.equal(count(subject, 'dwarf_clothes'), 0, 'fuel alone does not waive Vermundi’s payment');
  talk(subject, 'dwarf_city_shop_cloth_poor', [2, 1]);
  assert.equal(count(subject, 'dwarf_clothes'), 0, 'Vermundi refuses the sale without 200 coins');
  assert.equal(count(subject, 'coins'), 0, 'an unaffordable purchase does not take coins');
  give(subject, 'coins', 200);
  const paidClothes = talk(subject, 'dwarf_city_shop_cloth_poor', [2, 1]);
  assert.equal(count(subject, 'coins'), 0, `the sourced clothes price is exactly 200 coins: ${paidClothes.text}`);
  assert.equal(count(subject, 'dwarf_clothes'), 1);
  handModelPiece(subject, 'dwarf_clothes', 3);

  talk(subject, 'dwarf_city_shop_weapons', [2, 2, 2]);
  assert.equal(count(subject, 'dwarf_battleaxe_old'), 1, 'Santiri returns the natural old battleaxe');
  const swordBeforeLead = get(subject, 'squire');
  const imcandoLead = talk(subject, 'dwarf_city_librarian', [1]);
  assert.match(imcandoLead.text, /Reldo/, 'Hugi identifies the next in-game axe contact');
  const reldoLead = talk(subject, 'reldo', [4]);
  assert.match(reldoLead.text, /Asgarnian southern peninsula/, 'Reldo identifies the Imcando home and pie');
  assert.equal(get(subject, 'squire'), swordBeforeLead, 'following the axe lead leaves Knight\'s Sword untouched');
  talk(subject, 'thurgo', [1]);
  assert.equal(count(subject, 'dwarf_battleaxe_old'), 1, 'Thurgo cannot repair the axe without the required pie');
  give(subject, 'redberry_pie', 1);
  give(subject, 'iron_bar', 1);
  talk(subject, 'thurgo', [1, 1, 1, 1]);
  assert.equal(get(subject, 'giantdwarf_pie_given'), 1);
  assert.equal(count(subject, 'redberry_pie'), 0);
  assert.equal(count(subject, 'iron_bar'), 0, 'Thurgo takes the carried iron bar in the real dialogue');
  assert.equal(count(subject, 'dwarf_battleaxe_sharpened'), 1, 'Thurgo repairs the axe before the Keldagrim return');
  give(subject, 'sapphire', 3);
  nativeItemOnItem(subject, 'sapphire', 'dwarf_battleaxe_sharpened');
  assert.equal(count(subject, 'sapphire'), 0);
  assert.equal(count(subject, 'dwarf_battleaxe_new'), 1, 'three sapphires fit the repaired axe');
  talk(subject, 'dwarf_city_shop_weapons', [2]);

  handModelPiece(subject, 'dwarf_battleaxe_new', 7);
  assert.equal(get(subject, 'giantdwarf_model_state'), 7);
  talk(subject, 'dwarf_city_shop_sculpture');
  assert.equal(stage(subject), 5, 'Blasidar advances to Consortium access after the full natural model is built');
  completeCompanyPath(subject);

  const beforeMeeting = rewardSnapshot(subject);
  talk(subject, 'dwarf_city_black_guard_leader', [1, 1]);
  assertCompleted(subject, beforeMeeting);
  subject.closeModal();
  const mineDock = tile(subject);
  talk(subject, 'dwarf_city_boatman_mines_prequest', [1]);
  assert.equal(stage(subject), complete, 'the return boat keeps the terminal quest state');
  assert.notDeepEqual(tile(subject), mineDock, 'the post-quest boat reaches Keldagrim');
  const cityDock = tile(subject);
  talk(subject, 'dwarf_city_boatman_city', [1]);
  assert.equal(stage(subject), complete, 'the outbound boat keeps the terminal quest state');
  assert.notDeepEqual(tile(subject), cityDock, 'the post-quest boat returns to the mines');
  for (const item of [
    'dwarf_perfect_left_boot', 'dwarf_perfect_right_boot', 'dwarf_perfect_pair_of_boots',
    'dwarf_library_book', 'dwarf_clothes', 'dwarf_battleaxe_old', 'dwarf_battleaxe_sapphires',
    'dwarf_battleaxe_sharpened', 'dwarf_battleaxe_new', 'dwarf_meeting_notes1',
    'dwarf_battleaxe_anim_blunt', 'dwarf_battleaxe_anim_sharp',
    'dwarf_quest_complete_icon', 'cert_dwarf_quest_complete_icon'
  ]) {
    assert.equal(types.ObjType.get(obj(item)).tradeable, false, `${item} is configured untradeable`);
  }
  console.log('PASS Giant Dwarf complete');
}

townsfolkFixtures();
sapphiresBeforeRepairFixture();
bootMethodFixtures();
bookWeightFixture();
fullQuestPath(p);
process.exit(0); // World imports own maintenance timers; this offline process owns no live server.
