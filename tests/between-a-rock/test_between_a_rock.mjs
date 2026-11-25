#!/usr/bin/env node
// Between a Rock...: packed quest progression, native handlers, and real NPC queues.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  World, PlayerStat, ScriptProvider, ScriptState, ServerTriggerType, contentRoot, count,
  button, dialoguePage, engineModule, held, id, inv, invCom, map, obj, player, remove,
  resumeDialogue, seed, slotOf, tile, types, worn
} from '../swamp-caves/runtime.mjs';

const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const NpcStat = (await engineModule('engine/entity/NpcStat.ts')).NpcStat;
const rsbuf = await engineModule('network/rsbuf/index.ts');
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const OpLocU = (await engineModule('network/game/client/model/OpLocU.ts')).default;
const OpNpc = (await engineModule('network/game/client/model/OpNpc.ts')).default;
const OpNpcU = (await engineModule('network/game/client/model/OpNpcU.ts')).default;
const locHandler = new (await engineModule('network/game/client/handler/OpLocHandler.ts')).default();
const locUseHandler = new (await engineModule('network/game/client/handler/OpLocUHandler.ts')).default();
const npcHandler = new (await engineModule('network/game/client/handler/OpNpcHandler.ts')).default();
const npcUseHandler = new (await engineModule('network/game/client/handler/OpNpcUHandler.ts')).default();
const { environmentTick, tick: playerTick, weakCount } = await import('../swamp-caves/runtime.mjs');

const questScriptRoot = path.join(contentRoot, 'scripts/quests/quest_dwarfrock/scripts');
const schematicPath = path.join(questScriptRoot, 'dwarfrock_schematic.rs2');
const schematicSource = fs.readFileSync(schematicPath, 'utf8');
const schematicLines = schematicSource.split(/\r?\n/);
const miningSource = fs.readFileSync(path.join(contentRoot, 'scripts/skill_mining/scripts/mining.rs2'), 'utf8');
const smithingSource = fs.readFileSync(path.join(contentRoot, 'scripts/skill_smithing/scripts/smelting/smelting.rs2'), 'utf8');
const sharedAnvilSource = fs.readFileSync(path.join(contentRoot, 'scripts/skill_smithing/scripts/smithing/smithing.rs2'), 'utf8');
const legendsConstantSource = fs.readFileSync(path.join(contentRoot, 'scripts/quests/quest_legends/configs/quest_legends.constant'), 'utf8');
const generalQuestSource = fs.readFileSync(path.join(contentRoot, 'scripts/general/scripts/quests.rs2'), 'utf8');
const questConstantSource = fs.readFileSync(path.join(contentRoot, 'scripts/general/configs/quest.constant'), 'utf8');

function rs2Files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? rs2Files(full) : entry.name.endsWith('.rs2') ? [full] : [];
  });
}
const questSources = rs2Files(questScriptRoot).map(file => fs.readFileSync(file, 'utf8'));
const sourceSymbols = new Set([...questSources, miningSource, smithingSource, sharedAnvilSource, generalQuestSource]
  .flatMap(source => [...source.matchAll(/^\s*(\[[^\]\r\n]+\])/gm)].map(match => match[1])));

function requiredConstant(name, source = questConstantSource) {
  const match = source.match(new RegExp(`^\\^${name}\\s*=\\s*(-?\\d+)\\s*$`, 'm'));
  assert(match, `checked-out constant source defines ${name}`);
  return Number(match[1]);
}
const completeStage = requiredConstant('dwarfrock_complete');
const expectedQuestPoints = requiredConstant('dwarfrock_questpoints');

function varId(name) {
  const bit = types.VarBitType.getId(name);
  if (bit >= 0) return { kind: 'bit', id: bit };
  const varp = types.VarPlayerType.getId(name);
  assert(varp >= 0, `packed varbit/varp ${name}`);
  return { kind: 'player', id: varp };
}
function readVar(p, name) {
  const variable = varId(name);
  return variable.kind === 'bit' ? p.getVarBit(variable.id) : p.getVar(variable.id);
}
function writeVar(p, name, value) {
  const variable = varId(name);
  if (variable.kind === 'bit') p.setVarBit(variable.id, value);
  else p.setVar(variable.id, value);
}
const stage = p => readVar(p, 'dwarfrock_quest');
const questPointsProc = (() => {
  const match = generalQuestSource.match(/^\[proc,(count_questpoints)\]/m);
  assert(match, 'general quest scripts provide the packed Quest Points counter');
  const name = `[proc,${match[1]}]`;
  assert(sourceSymbols.has(name), `${name} has source coverage`);
  const script = ScriptProvider.getByName(name);
  assert(script, `${name} is compiled into the sibling pack`);
  return script;
})();
function questPoints(p) {
  const state = ScriptRunner.init(questPointsProc, p);
  assert.equal(p.runScript(state, true, true), ScriptState.FINISHED, 'packed Quest Points counter finishes');
  assert.equal(state.isp, 1, 'Quest Points counter returns one integer');
  return state.popInt();
}

function assertPackedTrigger(trigger, label) {
  assert(trigger, `${label}: native dispatch resolves a compiled trigger`);
  assert(sourceSymbols.has(trigger.name), `${label}: ${trigger.name} is declared in checked-out RuneScript source`);
  assert(ScriptProvider.getByName(trigger.name), `${label}: ${trigger.name} is present in the compiled pack`);
  return trigger;
}
function constantNumberFromSource(name) {
  const match = questConstantSource.match(new RegExp(`^\\^${name}\\s*=\\s*(-?\\d+)\\s*$`, 'm'));
  assert(match, `quest.constant contains ${name}`);
  return Number(match[1]);
}

const mapPlacements = new Map();
for (const file of fs.readdirSync(path.join(contentRoot, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name)).sort()) {
  const [mapX, mapZ] = file.slice(1, -4).split('_').map(Number);
  let section = '';
  for (const line of fs.readFileSync(path.join(contentRoot, 'maps', file), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) section = line;
    if (!section.includes('LOC')) continue;
    const match = /^(\d+) (\d+) (\d+): (\d+) (\d+)(?: (\d+))?/.exec(line);
    if (!match) continue;
    const [, rawLevel, localX, localZ, rawType, rawShape, rawAngle = '0'] = match;
    const type = Number(rawType);
    const rows = mapPlacements.get(type) ?? [];
    rows.push({
      level: Number(rawLevel), x: mapX * 64 + Number(localX), z: mapZ * 64 + Number(localZ),
      type, shape: Number(rawShape), angle: Number(rawAngle), mapsquare: `${mapX}_${mapZ}`
    });
    mapPlacements.set(type, rows);
  }
}

function locStand(p, loc, radius = 4) {
  const saved = tile(p);
  const type = types.LocType.get(loc.type);
  for (let distance = 1; distance <= radius; distance++) {
    for (let dx = -distance; dx <= distance; dx++) {
      for (let dz = -distance; dz <= distance; dz++) {
        const x = loc.x + dx, z = loc.z + dz;
        if (map.isMapBlocked(x, z, loc.level)) continue;
        if (!map.reachedLoc(loc.level, x, z, loc.x, loc.z, type.width, type.length, 1,
          loc.angle, loc.shape, type.forceapproach)) continue;
        return { level: loc.level, x, z };
      }
    }
  }
  p.level = saved[0]; p.x = saved[1]; p.z = saved[2];
  return null;
}
function placedLoc(p, name, predicate = () => true) {
  const type = id('LocType', name);
  for (const row of mapPlacements.get(type) ?? []) {
    const loc = World.getLoc(row.x, row.z, row.level, type);
    if (!loc || loc.type !== type || !predicate(loc, row)) continue;
    const stand = locStand(p, loc);
    if (stand) return { loc, stand, row };
  }
  assert.fail(`${name}: an original packed loc with a collision-safe operation stand exists`);
}
function npcStand(p, npc, radius = 8) {
  const saved = tile(p);
  for (let distance = 1; distance <= radius; distance++) {
    for (let x = npc.x - distance; x <= npc.x + (npc.width ?? 1) + distance - 1; x++) {
      for (let z = npc.z - distance; z <= npc.z + (npc.length ?? 1) + distance - 1; z++) {
        if (map.isMapBlocked(x, z, npc.level)) continue;
        p.level = npc.level; p.x = x; p.z = z;
        if (p.inOperableDistance(npc)) {
          p.level = saved[0]; p.x = saved[1]; p.z = saved[2];
          return { level: npc.level, x, z };
        }
      }
    }
  }
  p.level = saved[0]; p.x = saved[1]; p.z = saved[2];
  return null;
}
function findNpc(p, names, predicate = () => true) {
  const typeIds = names.map(name => id('NpcType', name));
  const npc = [...World.npcs].find(candidate => candidate.isActive && typeIds.includes(candidate.type)
    && predicate(candidate) && npcStand(p, candidate));
  assert(npc, `original visible NPC placement exists for ${names.join('/')}`);
  return npc;
}
function at(p, position) {
  p.level = position.level; p.x = position.x; p.z = position.z;
  p.originX = p.x; p.originZ = p.z;
  p.clearInteraction();
}
function atLoc(p, target) {
  at(p, target.stand);
  assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, 'loc stand is not collision-blocked');
  assert(p.inOperableDistance(target.loc), 'packed loc stand reaches the real target');
}
function atNpc(p, npc) {
  const stand = npcStand(p, npc);
  assert(stand, `${types.NpcType.get(npc.type).debugname} has a collision-safe reachable talk/attack stand`);
  at(p, stand);
  assert(p.inOperableDistance(npc), 'packed NPC stand reaches the real target');
}

function showNpc(p, npc) {
  rsbuf.addPlayer(p.slot);
  rsbuf.addNpc(npc.nid, npc.type);
  const appearance = p.generateAppearance();
  const hp = PlayerStat.HITPOINTS;
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, appearance, p.lastAppearance,
    p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ,
    p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[hp], p.baseLevels[hp], p.animId, p.animDelay, p.sayMessage,
    p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0,
    p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(npc.x, npc.level, npc.z, npc.nid, npc.type, npc.tele, npc.jump, npc.runDir,
    npc.walkDir, npc.isActive, npc.masks, npc.faceEntity, npc.faceSquareX, npc.faceSquareZ,
    npc.faceAngleX, npc.faceAngleZ, npc.hitmarkDamage, npc.hitmarkType, npc.hitmark2Damage,
    npc.hitmark2Type, npc.levels[NpcStat.HITPOINTS], npc.baseLevels[NpcStat.HITPOINTS],
    npc.animId, npc.animDelay, npc.sayMessage, npc.spotanimId, npc.spotanimHeight, npc.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, npc.nid), 'production visibility encoder includes the selected NPC');
}

function finishInteraction(p, choices = [], label = 'native interaction', messageStart = p.messages.length) {
  const remaining = [...choices];
  const pages = [];
  for (let step = 0; step < 240; step++) {
    const state = p.activeScript;
    if (!state) {
      if (weakCount(p) === 0) break;
      playerTick(p);
      continue;
    }
    assert.notEqual(state.execution, ScriptState.ABORTED, `${label} script did not abort`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      pages.push(...dialoguePage(p));
      const root = p.modalChat >= 0 ? types.Component.get(p.modalChat)?.comName ?? '' : '';
      if (/^multi[2-5]$/.test(root)) {
        assert(remaining.length > 0, `${label} supplies a choice for ${root}`);
        resumeDialogue(p, remaining.shift());
      } else {
        resumeDialogue(p);
      }
      continue;
    }
    if (state.execution === ScriptState.SUSPENDED) {
      playerTick(p);
      continue;
    }
    if (state.execution === ScriptState.COUNTDIALOG) {
      assert.fail(`${label} unexpectedly opened a count dialog`);
    }
    if (state.execution === ScriptState.FINISHED) break;
    assert.fail(`${label} stopped at execution state ${state.execution}`);
  }
  assert.equal(remaining.length, 0, `${label} used every declared dialogue choice`);
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED, `${label} settles without a pending script`);
  const messages = p.messages.slice(messageStart).map(String).join(' ');
  return [pages.join(' '), messages].filter(Boolean).join(' ');
}
function nativeLoc(p, target, option, choices = [], label = `loc option ${option}`) {
  atLoc(p, target);
  const messageStart = p.messages.length;
  const accepted = locHandler.handle(new OpLoc(option, target.loc.x, target.loc.z, target.loc.type), p);
  assert(accepted, `${label}: production OpLoc accepts the packed loc`);
  const trigger = assertPackedTrigger(p.getOpTrigger(), label);
  p.processInteraction();
  const text = finishInteraction(p, choices, label, messageStart);
  return { trigger, text };
}
function nativeNpc(p, npc, option = 1, choices = [], label = `NPC option ${option}`) {
  atNpc(p, npc);
  showNpc(p, npc);
  const messageStart = p.messages.length;
  const accepted = npcHandler.handle(new OpNpc(option, npc.nid), p);
  assert(accepted, `${label}: production OpNpc accepts the visible target`);
  const trigger = assertPackedTrigger(p.getOpTrigger(), label);
  p.processInteraction();
  const text = finishInteraction(p, choices, label, messageStart);
  return { trigger, text };
}
function nativeUseNpc(p, npc, item, choices = [], label = `use ${item} on NPC`) {
  atNpc(p, npc);
  showNpc(p, npc);
  const messageStart = p.messages.length;
  const accepted = npcUseHandler.handle(new OpNpcU(npc.nid, obj(item), slotOf(p, item), invCom), p);
  assert(accepted, `${label}: production OpNpcU accepts the visible target`);
  const trigger = assertPackedTrigger(p.getOpTrigger(), label);
  p.processInteraction();
  const text = finishInteraction(p, choices, label, messageStart);
  return { trigger, text };
}

function settleCombat(p) {
  for (let step = 0; step < 160; step++) {
    if (p.activeScript?.execution === ScriptState.PAUSEBUTTON) {
      finishInteraction(p, [], 'native queued-message acknowledgement');
    }
    const finished = !p.activeScript || p.activeScript.execution === ScriptState.FINISHED;
    if (finished && weakCount(p) === 0 && p.queue.head() === null) return;
    playerTick(p);
  }
  assert.fail(`combat reward queues did not settle: execution=${p.activeScript?.execution}, modal=${p.modalChat}`);
}
function nativeUseLoc(p, target, item, choices = [], label = `use ${item} on loc`) {
  atLoc(p, target);
  const messageStart = p.messages.length;
  const accepted = locUseHandler.handle(new OpLocU(target.loc.x, target.loc.z, target.loc.type,
    obj(item), slotOf(p, item), invCom), p);
  assert(accepted, `${label}: production OpLocU accepts the packed loc`);
  const trigger = assertPackedTrigger(p.getOpTrigger(), label);
  p.processInteraction();
  const text = finishInteraction(p, choices, label, messageStart);
  return { trigger, text };
}
function nativeMine(p, target, option, label) {
  atLoc(p, target);
  assert(locHandler.handle(new OpLoc(option, target.loc.x, target.loc.z, target.loc.type), p),
    `${label}: production OpLoc accepts the real mining target`);
  const trigger = assertPackedTrigger(p.getOpTrigger(), label);
  const state = ScriptRunner.init(trigger, p, target.loc);
  let execution = p.runScript(state, true, true);
  for (let boundary = 0; execution === ScriptState.SUSPENDED && boundary < 16; boundary++) {
    World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
    p.delayed = false;
    execution = p.runScript(state, true, true);
  }
  assert.equal(execution, ScriptState.FINISHED, `${label}: compiled mining interaction finishes`);
  return { trigger, state };
}

const players = new Set();
const avatars = new Set();
function makePlayer(items = []) {
  const p = seed(player(), items);
  for (let stat = 0; stat < p.baseLevels.length; stat++) p.setLevel(stat, p.baseLevels[stat]);
  players.add(p);
  return p;
}
function closePlayer(p) {
  if (!p.isActive) return;
  p.clearInteraction();
  p.activeScript = null;
  p.weakQueue.clear();
  p.queue.clear();
  p.timers.clear();
  rsbuf.removePlayer(p.slot);
  p.isActive = false;
  World.players[p.pid] = null;
  p.unlink();
}
function closeNpc(npc) {
  if (npc.isActive) World.removeNpc(npc, -1);
  avatars.delete(npc);
}
function addItem(p, name, amount = 1) {
  p.invAdd(inv, obj(name), amount);
}
function setLevel(p, stat, value) {
  p.setLevel(stat, value);
}
function wearHelmet(p) {
  assert(held(p, 'dwarf_goldrock_helmet', 2), 'native Wear accepts the crafted helmet');
  finishInteraction(p, [], 'wear gold helmet');
  assert.equal(count(p, 'dwarf_goldrock_helmet'), 0, 'worn helmet leaves the inventory');
  assert.equal(count(p, 'dwarf_goldrock_helmet', worn), 1, 'worn helmet occupies the head slot');
}
function removeHelmet(p) {
  assert(remove(p, 'dwarf_goldrock_helmet'), 'native Remove accepts the worn helmet');
  finishInteraction(p, [], 'remove gold helmet');
  assert.equal(count(p, 'dwarf_goldrock_helmet', worn), 0);
  assert.equal(count(p, 'dwarf_goldrock_helmet'), 1);
}
function damageNpc(npc, amount) {
  npc.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, amount);
  for (let step = 0; step < 80; step++) {
    npc.processQueue();
    if (!npc.activeScript && npc.queue.head() === null) return;
    World.currentTick = Math.max(World.currentTick + 1, npc.delayedUntil);
    npc.delayed = false;
    if (npc.activeScript) npc.executeScript(npc.activeScript);
  }
  assert.fail('real AI_QUEUE2/AI_QUEUE3 combat queues did not finish');
}
function advanceNpc(npc, turns = 3) {
  for (let turn = 0; turn < turns && npc.isActive; turn++) {
    World.currentTick = Math.max(World.currentTick + 1, npc.delayedUntil);
    npc.delayed = false;
    npc.turn();
  }
}
function avatarFor(p) {
  const category = id('CategoryType', 'dwarfrock_avatar');
  const owner = id('VarNpcType', 'npc_attacking_uid');
  const matches = [...World.npcs].filter(npc => npc.isActive
    && types.NpcType.get(npc.type).category === category
    && (npc.getVar(owner) >>> 0) === p.uid);
  assert.equal(matches.length, 1, 'native firewall dialogue summons exactly one owner-bound Avatar');
  const [npc] = matches;
  avatars.add(npc);
  return npc;
}
function assertAvatarType(npc, name, label) {
  assert.equal(npc.type, id('NpcType', name), label);
}
function assertAvatarStats(npc, hpDamage, defenceDrain, label) {
  const stats = [NpcStat.HITPOINTS, NpcStat.DEFENCE];
  const expected = stats.map(stat => types.NpcType.get(npc.type).stats[stat]);
  assert.deepEqual(stats.map(stat => npc.baseLevels[stat]), expected, `${label}: new form supplies HP and Defence maxima`);
  assert.deepEqual(stats.map(stat => npc.levels[stat]),
    [Math.max(expected[0] - hpDamage, 0), Math.max(expected[1] - defenceDrain, 0)],
    `${label}: new form preserves damage and Defence drain without exceeding its maxima`);
}
function spawnAvatar(p, center, label) {
  const { trigger } = nativeLoc(p, center, 2, [], label);
  assert.match(trigger.name, /^\[oploc2,dwarf_firewall_centre_/,
    `${label}: native Talk-to center-firewall option selects its production handler`);
  const start = ScriptProvider.getByTrigger(ServerTriggerType.AI_SPAWN,
    id('NpcType', 'dwarf_rock_avatar_mage'), id('CategoryType', 'dwarfrock_avatar'));
  assertPackedTrigger(start, 'Avatar AI_SPAWN');
  const npc = avatarFor(p);
  return npc;
}
function assertOwnedDeathDispatch(npc) {
  const type = types.NpcType.get(npc.type);
  const trigger = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, npc.type, type.category);
  assert.equal(assertPackedTrigger(trigger, 'Avatar death queue').name, '[ai_queue3,_dwarfrock_avatar]');
}
function activeStyle(style) {
  const p = makePlayer(['dwarf_goldrock_helmet']);
  writeVar(p, 'dwarfrock_quest', 60); // Isolated style fixture; main quest state is earned end to end.
  at(p, style.center.stand);
  setLevel(p, PlayerStat.ATTACK, style.attack);
  setLevel(p, PlayerStat.STRENGTH, style.strength);
  setLevel(p, PlayerStat.RANGED, style.ranged);
  setLevel(p, PlayerStat.MAGIC, style.magic);
  wearHelmet(p);
  const npc = spawnAvatar(p, style.center, `${style.name} Avatar spawn`);
  assertAvatarType(npc, style.base, `${style.name} highest combat skill selects the matching Avatar style`);
  assert.equal(npc.getVar(id('VarNpcType', 'npc_attacking_uid')) >>> 0, p.uid,
    `${style.name} Avatar records its native summon owner`);
  addItem(p, 'gold_ore', 6);
  advanceNpc(npc);
  assertAvatarType(npc, `${style.base}_green`, `${style.name} Avatar changes to green at six carried gold ore`);
  assertAvatarStats(npc, 0, 0, `${style.name} base to green`);
  addItem(p, 'gold_ore', 9);
  advanceNpc(npc);
  assertAvatarType(npc, `${style.base}_yellow`, `${style.name} Avatar changes to yellow at fifteen carried gold ore`);
  assertAvatarStats(npc, 0, 0, `${style.name} green to yellow`);
  assert.equal(count(p, 'gold_ore'), 15, `${style.name} Avatar tiers do not consume gold ore`);
  closePlayer(p);
  advanceNpc(npc, 4);
  assert(!npc.isActive || ![...World.npcs].includes(npc), `${style.name} Avatar is removed when its owner logs out`);
  closeNpc(npc);
}
function findMineRock(p) {
  const tableId = id('DbTableType', 'mining_table');
  const table = types.DbTableType.get(tableId);
  const rows = types.DbRowType.getInTable(tableId);
  const rockColumn = table.columnNames.indexOf('rock');
  const outputColumn = table.columnNames.indexOf('rock_output');
  const allowed = new Set(['clay', 'copper_ore', 'tin_ore', 'iron_ore']);
  const category = id('CategoryType', 'mining_rock_normal');
  for (const [typeId, placements] of mapPlacements) {
    const locType = types.LocType.get(typeId);
    if (locType.category !== category) continue;
    const row = rows.find(candidate => candidate.columnValues[rockColumn].includes(typeId));
    if (!row) continue;
    const output = types.ObjType.get(row.getValue(outputColumn, 0)[0]).debugname;
    if (!allowed.has(output)) continue;
    for (const placement of placements) {
      if (placement.mapsquare !== '47_152' && placement.mapsquare !== '47_153') continue;
      const loc = World.getLoc(placement.x, placement.z, placement.level, typeId);
      if (!loc || loc.type !== typeId) continue;
      const stand = locStand(p, loc);
      if (stand) return { loc, stand, output, row };
    }
  }
  assert.fail('Dwarven Mine has a native normal clay/copper/tin/iron rock and collision-safe stand');
}
function puzzleButton(call) {
  const line = schematicLines.find(candidate => candidate.trim().startsWith('[if_button,') && candidate.includes(call));
  assert(line, `original schematic RuneScript binds ${call}`);
  const match = /^\s*\[if_button,([^\]]+)\]/.exec(line);
  assert(match, `${call} has a packed IF_BUTTON component`);
  const name = match[1];
  assert(sourceSymbols.has(`[if_button,${name}]`), `packed button source exists for ${name}`);
  return name;
}
const puzzleInterface = (() => {
  const match = schematicSource.match(/if_openmain_side\(([^,]+),\s*([^)]+)\)/);
  assert(match, 'original schematic uses the packed main+sidebar interface');
  return { main: match[1].trim(), side: match[2].trim() };
})();
const puzzleClose = puzzleButton('if_close;');
function assertPuzzleOpen(p) {
  assert.equal(p.modalMain, id('Component', puzzleInterface.main), 'the original 377 schematic canvas is open');
  assert.equal(p.modalSide, id('Component', puzzleInterface.side), 'the original schematic sidebar is open');
}
function pressPuzzle(p, name) {
  assert(button(p, name), `native IF_BUTTON accepts ${name}`);
  finishInteraction(p, [], `IF_BUTTON ${name}`);
}
function openPuzzle(p, item) {
  assert(held(p, item, 1), `native inventory Assemble opens the puzzle from ${item}`);
  finishInteraction(p, [], `open schematic from ${item}`);
  assertPuzzleOpen(p);
}
function decodePuzzle(value, index) {
  const byte = ((value >>> (index * 8)) & 0xff);
  return { x: byte & 7, y: (byte >>> 3) & 7, rotation: (byte >>> 6) & 3 };
}
function testPuzzle(p) {
  const items = ['dwarf_rock_base_schematic', 'dwarf_rock_schematic1', 'dwarf_rock_schematic2', 'dwarf_rock_schematic3'];
  const before = items.map(item => count(p, item));
  for (const item of items) {
    openPuzzle(p, item);
    pressPuzzle(p, puzzleClose);
    assert.notEqual(p.modalMain, id('Component', puzzleInterface.main), 'native close cancels the canvas');
  }
  const puzzleVar = varId('dwarfrock_puzzle');
  assert.equal(puzzleVar.kind, 'player', 'the schematic drawing state is its packed temporary varp');
  const mainItem = items[0];
  openPuzzle(p, mainItem);
  const initial = readVar(p, 'dwarfrock_puzzle') >>> 0;
  const bytes = [0, 1, 2].map(index => decodePuzzle(initial, index));
  for (const byte of bytes) assert(byte.x < 7 && byte.y < 7 && byte.rotation < 4);
  pressPuzzle(p, puzzleButton('~dwarfrock_select_schematic(0)'));
  pressPuzzle(p, puzzleButton('~dwarfrock_show_schematic(0)'));
  pressPuzzle(p, puzzleButton('~dwarfrock_move_schematic(0, 0, 1)'));
  pressPuzzle(p, puzzleClose);
  assert.equal(readVar(p, 'dwarfrock_schematics_solved'), 0, 'closing an incomplete original canvas does not assemble it');
  assert.deepEqual(items.map(item => count(p, item)), before, 'cancellation preserves all four physical schematics');
  openPuzzle(p, mainItem);
  assert.equal(readVar(p, 'dwarfrock_puzzle') >>> 0, initial, 'reopening resets the temporary canvas to the original initial drawing');

  const selectButtons = [0, 1, 2].map(index => puzzleButton(`~dwarfrock_select_schematic(${index})`));
  const showButtons = [0, 1, 2].map(index => puzzleButton(`~dwarfrock_show_schematic(${index})`));
  const rotate = puzzleButton('~dwarfrock_move_schematic(0, 0, 1)');
  const move = new Map([
    ['right', puzzleButton('~dwarfrock_move_schematic(1, 0, 0)')],
    ['left', puzzleButton('~dwarfrock_move_schematic(-1, 0, 0)')],
    ['down', puzzleButton('~dwarfrock_move_schematic(0, 1, 0)')],
    ['up', puzzleButton('~dwarfrock_move_schematic(0, -1, 0)')]
  ]);
  for (let index = 0; index < 3; index++) {
    pressPuzzle(p, selectButtons[index]);
    pressPuzzle(p, showButtons[index]);
    pressPuzzle(p, showButtons[index]);
    const { x, y, rotation } = bytes[index];
    if (x < 6) {
      pressPuzzle(p, move.get('right')); pressPuzzle(p, move.get('left'));
    } else {
      pressPuzzle(p, move.get('left')); pressPuzzle(p, move.get('right'));
    }
    if (y < 6) {
      pressPuzzle(p, move.get('down')); pressPuzzle(p, move.get('up'));
    } else {
      pressPuzzle(p, move.get('up')); pressPuzzle(p, move.get('down'));
    }
    const rotations = rotation === 0 ? 4 : 4 - rotation;
    for (let step = 0; step < rotations; step++) pressPuzzle(p, rotate);
    for (let step = 0; step < x; step++) pressPuzzle(p, move.get('left'));
    for (let step = 0; step < y; step++) pressPuzzle(p, move.get('up'));
  }
  assert.equal(readVar(p, 'dwarfrock_schematics_solved'), 1, 'all three originals align through the native controls');
  assert.equal(count(p, 'dwarf_rock_schematic_assembled'), 1, 'solving the original canvas grants one assembled schematic');
  assert(items.every(item => count(p, item) === 0), 'assembly consumes exactly the four individual pieces');
  assert.equal(stage(p), 40, 'puzzle completion does not skip Dondakan handover');
  pressPuzzle(p, puzzleClose);
}

function testSharedAnvil() {
  const legendsGate = requiredConstant('legends_asked_gujuo_holy_water', legendsConstantSource);
  for (const recipe of [
    { label: 'BAR only', bar: 40, legends: 0, choices: [], helmet: true },
    { label: 'Legends only', bar: 0, legends: legendsGate, choices: [1], helmet: false },
    { label: 'both quests choose helmet', bar: 40, legends: legendsGate, choices: [1], helmet: true },
    { label: 'both quests choose bowl', bar: 40, legends: legendsGate, choices: [2, 1], helmet: false }
  ]) {
    const p = makePlayer(['gold_bar', 'gold_bar', 'gold_bar', 'hammer']);
    setLevel(p, PlayerStat.SMITHING, 99);
    // Isolated dispatcher fixtures; the main quest below earns its own state.
    writeVar(p, 'dwarfrock_quest', recipe.bar);
    writeVar(p, 'legendsquest', recipe.legends);
    const beforeXp = p.stats[PlayerStat.SMITHING];
    JavaRandom.setSeed(0);
    const action = nativeUseLoc(p, placedLoc(p, 'anvil'), 'gold_bar', recipe.choices, recipe.label);
    assert.equal(action.trigger.name, '[oplocu,anvil]', `${recipe.label} uses the shared native anvil`);
    assert.equal(count(p, 'dwarf_goldrock_helmet'), recipe.helmet ? 1 : 0, `${recipe.label} helmet result`);
    assert.equal(count(p, 'goldbowl_empty'), recipe.helmet ? 0 : 1, `${recipe.label} bowl result`);
    assert.equal(count(p, 'gold_bar'), recipe.helmet ? 0 : 1, `${recipe.label} consumes only its recipe's bars`);
    assert.equal(p.stats[PlayerStat.SMITHING] - beforeXp, 300, `${recipe.label} grants 30 Smithing XP`);
    assert.equal(stage(p), recipe.bar, `${recipe.label} does not alter BAR progression`);
    assert.equal(readVar(p, 'legendsquest'), recipe.legends, `${recipe.label} preserves Legends progression`);
    closePlayer(p);
  }
}

const originalMathRandom = Math.random;
Math.random = () => 0.5; // Keep unrelated world wander RNG out of the scripted test stream.
try {
  testSharedAnvil();
  const p = makePlayer([
    'gold_bar', 'gold_bar', 'gold_bar', 'gold_bar', 'ammo_mould', 'hammer',
    'dwarven_stout', 'bronze_pickaxe'
  ]);
  const initialSmithingXp = p.stats[PlayerStat.SMITHING];
  const dondakan = findNpc(p, ['dwarfrock_multi_dondakan', 'dwarfrock_dondakan']);
  const rolad = findNpc(p, ['dwarfrock_rolad']);
  const engineer = findNpc(p, ['dwarfrock_engineer1']);
  const khorvak = findNpc(p, ['dwarfrock_engineer2']);
  const dondakanCannon = placedLoc(p, 'dwarf_rock_multicannon1');
  const cart = placedLoc(p, 'dwarfrock_book_cart');
  const anvil = placedLoc(p, 'dwarf_keldagrim_anvil');
  const furnaceTrigger = smithingSource.match(/^\[(oplocu,[^\]]+)]/m)?.[1];
  assert(furnaceTrigger, 'smithing source declares its native furnace item-use trigger');
  const furnace = (() => {
    for (const [typeId, placements] of mapPlacements) {
      const locType = types.LocType.get(typeId);
      const trigger = ScriptProvider.getByTrigger(ServerTriggerType.OPLOCU, typeId, locType.category);
      if (trigger?.name !== `[${furnaceTrigger}]`) continue;
      for (const row of placements) {
        const loc = World.getLoc(row.x, row.z, row.level, typeId);
        if (!loc || loc.type !== typeId) continue;
        const stand = locStand(p, loc);
        if (stand) return { loc, stand, row };
      }
    }
    assert.fail('packed world has a native furnace that resolves through the production gold-bar handler');
  })();
  const centerStraight = placedLoc(p, 'dwarf_firewall_centre_straight');
  const centerDiagonal = placedLoc(p, 'dwarf_firewall_centre_diagonal');
  const outerStraight = placedLoc(p, 'dwarf_firewall_straight');
  const outerDiagonal = placedLoc(p, 'dwarf_firewall_diagonal');
  const goldVeins = ['dwarf_gold_mine', 'dwarf_gold_mine_r', 'dwarf_gold_mine_l']
    .map(name => placedLoc(p, name));

  // Seed only independent prerequisite quests. The Between a Rock... stage and all rewards are earned below.
  writeVar(p, 'fishingcompo', constantNumberFromSource('fishingcompo_complete'));
  writeVar(p, 'mcannon', constantNumberFromSource('mcannon_complete'));
  const questpointBaseline = questPoints(p);
  assert.equal(stage(p), 0, 'fresh Between a Rock... fixture begins unstarted');
  const start = nativeNpc(p, dondakan, 1, [2, 1], 'start Between a Rock... through Dondakan');
  assert.equal(start.trigger.name, '[opnpc1,dwarfrock_dondakan]');
  assert.equal(stage(p), 10, 'native Dondakan dialogue starts the page hunt');

  nativeNpc(p, rolad, 1, [], 'ask Rolad about the rock and missing pages');
  assert.equal(readVar(p, 'dwarfrock_rolad_schematics_heardof'), 1, 'Rolad establishes the missing-page hunt');
  const pageScorpion = [...World.npcs].find(npc => npc.isActive && npc.type === id('NpcType', 'scorpion')
    && Math.floor(npc.x / 64) === 47 && [152, 153].includes(Math.floor(npc.z / 64)));
  assert(pageScorpion, 'an original placed Dwarven Mine scorpion is loaded in the page-hunt zone');
  atNpc(p, pageScorpion);
  const scorpionDeath = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3,
    pageScorpion.type, types.NpcType.get(pageScorpion.type).category);
  assert.equal(assertPackedTrigger(scorpionDeath, 'scorpion death-page queue').name, '[ai_queue3,scorpion]');
  pageScorpion.setVar(id('VarNpcType', 'npc_aggressive_player'), p.uid);
  const scorpionHp = pageScorpion.levels[NpcStat.HITPOINTS];
  pageScorpion.heroPoints.addHero(p.hash64, scorpionHp);
  damageNpc(pageScorpion, scorpionHp);
  settleCombat(p);
  assert.equal(count(p, 'dwarf_rock_page1'), 1, 'a real Scorpion AI death queue grants the first page');

  nativeLoc(p, cart, 1, [], 'search Rolad\'s original book cart');
  assert.equal(count(p, 'dwarf_rock_page2'), 1, 'native cart search grants page two');
  const cartInventory = [count(p, 'dwarf_rock_page1'), count(p, 'dwarf_rock_page2'), count(p, 'dwarf_rock_page3')];
  nativeLoc(p, cart, 1, [], 'repeat search of Rolad\'s cart');
  assert.deepEqual([count(p, 'dwarf_rock_page1'), count(p, 'dwarf_rock_page2'), count(p, 'dwarf_rock_page3')], cartInventory,
    'cart search never duplicates a page');

  const mineRock = findMineRock(p);
  assert(mineRock, 'a packed normal ore rock exists in the exact page-hunt zone');
  const actionDelay = id('VarPlayerType', 'action_delay');
  p.setVar(actionDelay, World.currentTick);
  const miningTrigger = miningSource.match(/^\[(oploc1,[^\]]+)]/m)?.[1];
  assert(miningTrigger, 'production mining source declares its normal-rock native action');
  JavaRandom.setSeed(3);
  const minedPage = nativeMine(p, { ...mineRock, loc: mineRock.loc }, 1, 'mine a Dwarven Mine rock for the last page');
  assert.equal(minedPage.trigger.name, `[${miningTrigger}]`, 'actual OpLoc uses the packed ordinary-mining trigger');
  assert.equal(count(p, mineRock.output), 1, 'the ordinary mining ScriptRunner grants its real ore output');
  assert.equal(count(p, 'dwarf_rock_page3'), 1, 'the production successful-mining hook grants page three');
  assert.equal(stage(p), 10, 'page collection remains inside the page-hunt stage');
  const returnedPages = nativeNpc(p, rolad, 1, [1], 'return all three pages to Rolad');
  assert(returnedPages.text.includes('I found all of your missing pages!'), 'Rolad receives the real page-return dialogue');
  assert.deepEqual(['dwarf_rock_page1', 'dwarf_rock_page2', 'dwarf_rock_page3'].map(name => count(p, name)), [0, 0, 0],
    'Rolad consumes all three individual pages');
  assert.equal(count(p, 'dwarf_rock_book'), 1, 'Rolad returns the assembled book');
  assert(held(p, 'dwarf_rock_book', 1), 'native inventory Read accepts Rolad\'s book');
  finishInteraction(p, [], 'read Rolad\'s book the first time');
  assert.equal(stage(p), 20, 'book Read advances the quest to the gold investigation');
  assert.equal(count(p, 'dwarf_rock_book'), 1, 'first Read preserves the book');

  nativeUseNpc(p, dondakan, 'gold_bar', [], 'show gold to Dondakan');
  assert.equal(readVar(p, 'dwarfrock_gold_cannonball'), 1, 'Dondakan records the gold-cannonball idea');
  assert.equal(count(p, 'gold_bar'), 4, 'showing gold does not consume it');
  const offer = nativeUseLoc(p, furnace, 'gold_bar', [1], 'use a gold bar on the native furnace');
  assert.equal(offer.trigger.name, `[${furnaceTrigger}]`, 'gold bar uses the packed generic furnace handler');
  assert.equal(count(p, 'gold_bar'), 3, 'cannonball casting consumes one gold bar');
  assert.equal(count(p, 'dwarf_rock_cannonball_gold'), 1, 'furnace choice creates one golden cannonball');
  assert(p.stats[PlayerStat.SMITHING] > initialSmithingXp, 'cannonball casting advances Smithing XP');
  atNpc(p, dondakan);
  const surfaceBeforeShot = tile(p);
  const shot = nativeUseNpc(p, dondakan, 'dwarf_rock_cannonball_gold', [1, 2], 'fire the gold cannonball but defer the schematic proposal');
  assert(shot.text.includes('The cannon fires the golden cannonball through the passage.'),
    'golden cannonball shot is reported through the native item-on-NPC action');
  assert.equal(stage(p), 30, 'the shot records stage 30 before the schematic proposal');
  assert.equal(readVar(p, 'dwarfrock_fired_gold_cannonball'), 1, 'the fired-shot bit is set');
  assert.deepEqual(tile(p), surfaceBeforeShot, 'the gold shot never teleports the player');
  assert.equal(count(p, 'dwarf_rock_cannonball_gold'), 0, 'the fired golden cannonball is consumed once');
  nativeNpc(p, dondakan, 1, [1], 'accept Dondakan\'s first schematic proposal');
  assert.equal(stage(p), 40, 'accepting the proposal starts the four-schematic search');
  assert.equal(count(p, 'dwarf_rock_schematic1'), 1, 'Dondakan supplies schematic one');

  nativeNpc(p, engineer, 1, [], 'ask the Keldagrim engineer for the second schematic');
  assert.equal(count(p, 'dwarf_rock_schematic2'), 1, 'the engineer supplies schematic two');
  nativeNpc(p, khorvak, 1, [2], 'ask Khorvak for the last overlay');
  assert.equal(count(p, 'dwarf_rock_schematic3'), 0, 'Khorvak does not grant the part before the requested drink');
  nativeUseNpc(p, khorvak, 'dwarven_stout', [], 'give Khorvak the requested Dwarven stout');
  assert.equal(count(p, 'dwarven_stout'), 0, 'Khorvak consumes the stout');
  assert.equal(count(p, 'beer_glass'), 1, 'Khorvak returns an empty beer glass');
  assert.equal(count(p, 'dwarf_rock_schematic3'), 1, 'Khorvak supplies schematic three after the item use');
  nativeNpc(p, rolad, 1, [], 'ask Rolad for the base schematic');
  assert.equal(readVar(p, 'dwarfrock_rolad_schematics_lookingfor'), 1, 'Rolad records the schematic search');
  assert.equal(count(p, 'dwarf_rock_book'), 1, 'Rolad leaves the original book available to reread');
  assert(held(p, 'dwarf_rock_book', 1), 'native inventory Read accepts the book during the schematic stage');
  finishInteraction(p, [1], 'read and tear out Rolad\'s base drawing');
  assert.equal(count(p, 'dwarf_rock_book'), 0, 'tearing out the base drawing consumes the book');
  assert.equal(count(p, 'dwarf_rock_base_schematic'), 1, 'Rolad\'s reread gives the base schematic');
  assert.deepEqual([
    count(p, 'dwarf_rock_schematic1'), count(p, 'dwarf_rock_schematic2'),
    count(p, 'dwarf_rock_schematic3'), count(p, 'dwarf_rock_base_schematic')
  ], [1, 1, 1, 1], 'all four schematics come from their intended native sources');
  testPuzzle(p);

  nativeUseLoc(p, anvil, 'gold_bar', [], 'craft the required golden helmet at the Keldagrim anvil');
  assert.equal(count(p, 'gold_bar'), 0, 'three remaining bars are consumed by the helmet recipe');
  assert.equal(count(p, 'dwarf_goldrock_helmet'), 1, 'the native anvil creates the gold helmet');
  const helmetSmithXp = p.stats[PlayerStat.SMITHING];
  assert(helmetSmithXp > 123456, 'helmet crafting advances Smithing XP');
  nativeNpc(p, dondakan, 1, [], 'attempt Dondakan handover while the helmet is carried');
  assert.equal(stage(p), 40, 'an inventory-only helmet cannot hand the assembled schematic over');
  assert.equal(count(p, 'dwarf_rock_schematic_assembled'), 1, 'failed worn-helmet gate preserves the assembled part');
  wearHelmet(p);
  nativeNpc(p, dondakan, 1, [3], 'hand over assembled schematics and defer the cannon launch');
  assert.equal(stage(p), 50, 'Dondakan accepts the worn-helmet handover');
  assert.equal(count(p, 'dwarf_rock_schematic_assembled'), 0, 'Dondakan consumes the assembled schematic');
  assert.equal(count(p, 'dwarf_goldrock_helmet', worn), 1, 'Dondakan requires the real worn gold helmet');

  removeHelmet(p);
  const fireRefusal = nativeLoc(p, dondakanCannon, 1, [], 'refuse Fire without a worn golden helmet');
  assert(fireRefusal.text.includes('Not without wearing your golden helmet'), 'Fire gives the worn-helmet refusal');
  assert.equal(stage(p), 50, 'helmet refusal does not advance the quest');
  wearHelmet(p);
  nativeLoc(p, dondakanCannon, 1, [], 'Fire Dondakan\'s cannon while wearing the gold helmet');
  assert.equal(stage(p), 60, 'the native cannon Fire enters the gold mine');
  assert.equal(readVar(p, 'dwarfrock_inside_visited'), 1, 'the first mine landing records access');
  assert.equal(readVar(p, 'dwarfrock_inside_timeleft'), 800, 'the mine timer starts at its packed duration');

  assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, 'cannon entry lands on a walkable packed tile');
  setLevel(p, PlayerStat.MINING, 39);
  for (const vein of goldVeins) {
    const beforeOre = count(p, 'gold_ore');
    const refusal = nativeLoc(p, vein, 1, [], 'mine a gold vein below level 40');
    assert(refusal.text.includes('Mining level of 40'), 'each gold vein preserves the native Mining-level gate');
    assert.equal(count(p, 'gold_ore'), beforeOre, 'low Mining grants no gold ore');
    nativeLoc(p, vein, 2, [], 'prospect one of the three packed gold veins');
    assert(p.messages.includes('This rock contains gold.'), 'each gold vein uses the native prospect text');
    p.messages.length = 0;
  }
  setLevel(p, PlayerStat.MINING, 40);
  assert(held(p, 'bronze_pickaxe', 5), 'native Drop removes the page-hunt pickaxe for the refusal fixture');
  finishInteraction(p, [], 'drop the page-hunt pickaxe');
  assert.equal(count(p, 'bronze_pickaxe'), 0, 'pickaxe refusal fixture actually holds no pickaxe');
  for (const vein of goldVeins) {
    const noPickaxe = nativeLoc(p, vein, 1, [], 'mine a gold vein without a pickaxe');
    assert(noPickaxe.text.includes('You need a pickaxe'), 'each gold vein preserves the pickaxe gate');
    assert.equal(count(p, 'gold_ore'), 0, 'no-pickaxe refusal grants no gold ore');
  }
  addItem(p, 'bronze_pickaxe');
  const mineXpBefore = p.stats[PlayerStat.MINING];
  for (const [index, vein] of goldVeins.entries()) {
    const beforeOre = count(p, 'gold_ore');
    nativeLoc(p, vein, 1, [], `mine original gold vein ${index + 1}`);
    assert.equal(count(p, 'gold_ore'), beforeOre + 1, `gold vein ${index + 1} grants one ore`);
    assert.equal(p.stats[PlayerStat.MINING] - mineXpBefore, 650 * (index + 1),
      `gold vein ${index + 1} awards 65 Mining XP`);
  }
  assert.equal(count(p, 'gold_ore'), 3, 'native Mine succeeds on dwarf_gold_mine, _r and _l');

  const allFirewallLocs = [outerStraight, outerDiagonal];
  for (const firewall of allFirewallLocs) {
    const before = tile(p);
    nativeLoc(p, firewall, 1, [], 'jump through an outer firewall');
    assert.notDeepEqual(tile(p), before, 'outer Jump moves the player through the packed firewall');
    assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, 'outer Jump lands on a walkable packed tile');
  }
  const avatarStyles = [
    { name: 'ranged-counter', attack: 98, strength: 97, ranged: 99, magic: 96, base: 'dwarf_rock_avatar_warrior', center: centerDiagonal },
    { name: 'magic-counter', attack: 98, strength: 97, ranged: 96, magic: 99, base: 'dwarf_rock_avatar_archer', center: centerStraight }
  ];
  for (const style of avatarStyles) activeStyle(style);

  // The main Avatar starts from the three real gold ores, changes form at six and fifteen,
  // blocks damage below six, and its real death queue returns the player at stage 100.
  setLevel(p, PlayerStat.ATTACK, 99);
  setLevel(p, PlayerStat.STRENGTH, 98);
  setLevel(p, PlayerStat.RANGED, 97);
  setLevel(p, PlayerStat.MAGIC, 96);
  const mainAvatar = spawnAvatar(p, centerStraight, 'main native center-firewall Talk-to');
  assertAvatarType(mainAvatar, 'dwarf_rock_avatar_mage', 'melee-stat lead selects the Mage counter-style');
  assertOwnedDeathDispatch(mainAvatar);
  const ownerVar = id('VarNpcType', 'npc_attacking_uid');
  assert.equal(mainAvatar.getVar(ownerVar) >>> 0, p.uid, 'Avatar is owned by the summoning player');
  const baseHp = mainAvatar.levels[NpcStat.HITPOINTS];
  mainAvatar.setVar(id('VarNpcType', 'npc_aggressive_player'), p.uid);
  damageNpc(mainAvatar, 7);
  assert.equal(mainAvatar.levels[NpcStat.HITPOINTS], baseHp, 'an Avatar cannot be damaged below six carried gold ore');
  assert.equal(count(p, 'gold_ore'), 3, 'blocked combat does not consume the carried gold');
  for (let ore = 3; ore < 5; ore++) nativeLoc(p, goldVeins[0], 1, [], 'mine towards the six-ore combat boundary');
  assert.equal(count(p, 'gold_ore'), 5, 'exact five-ore boundary fixture');
  damageNpc(mainAvatar, 7);
  assert.equal(mainAvatar.levels[NpcStat.HITPOINTS], baseHp, 'five ore still blocks damage');
  nativeLoc(p, goldVeins[0], 1, [], 'mine the exact sixth gold ore');
  assert.equal(count(p, 'gold_ore'), 6, 'exact six-ore boundary fixture');
  mainAvatar.regenClock = 0; // Isolate morph preservation from the independent native regeneration clock.
  advanceNpc(mainAvatar);
  assertAvatarType(mainAvatar, 'dwarf_rock_avatar_mage_green', 'Mage counter form changes at six gold ore');
  assertAvatarStats(mainAvatar, 0, 0, 'three to six earned ore');
  const greenHp = mainAvatar.levels[NpcStat.HITPOINTS];
  damageNpc(mainAvatar, 7);
  assert.equal(mainAvatar.levels[NpcStat.HITPOINTS], greenHp - 7, 'exactly six ore permits damage');
  mainAvatar.levels[NpcStat.DEFENCE] -= 9; // Isolated prior stat-drain fixture, not quest progression.
  for (let ore = 6; ore < 15; ore++) nativeLoc(p, goldVeins[0], 1, [], 'mine towards the weaker Avatar form');
  mainAvatar.regenClock = 0;
  advanceNpc(mainAvatar);
  assertAvatarType(mainAvatar, 'dwarf_rock_avatar_mage_yellow', 'Mage counter form changes at fifteen gold ore');
  assertAvatarStats(mainAvatar, 7, 9, 'six to fifteen earned ore');
  assert.equal(count(p, 'gold_ore'), 15, 'Avatar form changes preserve all carried ore');

  // A normal damaged green form can have less HP than the yellow form's reduction.
  const depleted = makePlayer(['dwarf_goldrock_helmet']);
  writeVar(depleted, 'dwarfrock_quest', 60); // Independent reachable morph-death fixture.
  wearHelmet(depleted);
  addItem(depleted, 'gold_ore', 6);
  const depletedAvatar = spawnAvatar(depleted, centerDiagonal, 'damaged green Avatar morph fixture');
  depletedAvatar.setVar(id('VarNpcType', 'npc_aggressive_player'), depleted.uid);
  const depletedHp = depletedAvatar.levels[NpcStat.HITPOINTS];
  depletedAvatar.heroPoints.addHero(depleted.hash64, depletedHp - 1);
  damageNpc(depletedAvatar, depletedHp - 1);
  assert.equal(depletedAvatar.levels[NpcStat.HITPOINTS], 1, 'green form survives the prior native hit');
  addItem(depleted, 'gold_ore', 9);
  depletedAvatar.regenClock = 0;
  advanceNpc(depletedAvatar, 20);
  settleCombat(depleted);
  assert.equal(stage(depleted), 100, 'zero-HP form change takes the native owned death path instead of stranding the fight');
  closeNpc(depletedAvatar);
  closePlayer(depleted);
  const stranger = makePlayer(['dwarf_goldrock_helmet']);
  writeVar(stranger, 'dwarfrock_quest', 60); // Isolated hostile-damage fixture; not quest progression.
  at(stranger, centerStraight.stand);
  wearHelmet(stranger);
  const aggressiveVar = id('VarNpcType', 'npc_aggressive_player');
  mainAvatar.setVar(aggressiveVar, stranger.uid);
  const foreignHp = mainAvatar.levels[NpcStat.HITPOINTS];
  damageNpc(mainAvatar, 7);
  assert.equal(mainAvatar.levels[NpcStat.HITPOINTS], foreignHp, 'foreign damage is rejected by the real AI_QUEUE2 path');
  mainAvatar.setVar(aggressiveVar, p.uid);
  mainAvatar.heroPoints.addHero(stranger.hash64, foreignHp);
  damageNpc(mainAvatar, foreignHp);
  settleCombat(p);
  settleCombat(stranger);
  assert.equal(stage(p), 60, 'a non-owner combat hero cannot earn stage 100');
  assert.equal(stage(stranger), 60, 'foreign Avatar death grants no quest credit to the attacker');
  assert.equal(count(stranger, 'dwarf_goldrock_helmet', worn), 1, 'foreign death cannot transfer the owner helmet');
  closeNpc(mainAvatar);

  // Use a fresh owner-bound Avatar for the successful native kill-credit path.
  const finalAvatar = spawnAvatar(p, centerDiagonal, 'owner Avatar native center-firewall Talk-to');
  assertAvatarType(finalAvatar, 'dwarf_rock_avatar_mage_yellow', 'the 15-ore owner fight selects its yellow Mage form');
  assertOwnedDeathDispatch(finalAvatar);
  finalAvatar.setVar(aggressiveVar, p.uid);
  const xpBeforeAvatarDeath = [p.stats[PlayerStat.DEFENCE], p.stats[PlayerStat.MINING], p.stats[PlayerStat.SMITHING]];
  const finalHp = finalAvatar.levels[NpcStat.HITPOINTS];
  finalAvatar.heroPoints.addHero(p.hash64, finalHp);
  damageNpc(finalAvatar, finalHp);
  settleCombat(p);
  assert.equal(stage(p), 100, 'the owner-only Avatar AI_QUEUE3 queue advances to stage 100');
  assert.equal(count(p, 'rune_pickaxe'), 0, 'Avatar death alone does not award the completion reward');
  assert.deepEqual([p.stats[PlayerStat.DEFENCE], p.stats[PlayerStat.MINING], p.stats[PlayerStat.SMITHING]],
    xpBeforeAvatarDeath, 'Avatar death alone does not award skill XP');

  const qpBeforeReward = questPoints(p);
  const rewardXp = [...xpBeforeAvatarDeath];
  nativeNpc(p, dondakan, 1, [], 'return to Dondakan after the Avatar dies');
  assert.equal(stage(p), completeStage, 'Dondakan completion advances to the packed terminal stage');
  assert.deepEqual([
    p.stats[PlayerStat.DEFENCE] - rewardXp[0],
    p.stats[PlayerStat.MINING] - rewardXp[1],
    p.stats[PlayerStat.SMITHING] - rewardXp[2]
  ], [50000, 50000, 50000], 'completion grants the verified 5,000 XP in each named skill');
  assert.equal(count(p, 'rune_pickaxe'), 1, 'completion grants one period rune pickaxe once');
  assert(p.packets.some(packet => packet.constructor.name === 'IfSetText' && packet.text === 'Rune pickaxe'),
    'completion scroll names the period rune pickaxe reward');
  assert.equal(questPoints(p) - qpBeforeReward, expectedQuestPoints, 'completion grants exactly the packed Quest Points constant');
  const completed = {
    xp: [p.stats[PlayerStat.DEFENCE], p.stats[PlayerStat.MINING], p.stats[PlayerStat.SMITHING]],
    pickaxe: count(p, 'rune_pickaxe'), points: questPoints(p)
  };
  nativeNpc(p, dondakan, 1, [2], 'repeat completed Dondakan dialogue without re-claiming rewards');
  assert.equal(stage(p), completeStage, 'repeat postquest dialogue preserves the terminal stage');
  assert.deepEqual([p.stats[PlayerStat.DEFENCE], p.stats[PlayerStat.MINING], p.stats[PlayerStat.SMITHING]], completed.xp,
    'repeat dialogue grants no duplicate experience');
  assert.equal(count(p, 'rune_pickaxe'), completed.pickaxe, 'repeat dialogue grants no duplicate rune pickaxe');
  assert.equal(questPoints(p), completed.points, 'repeat dialogue grants no duplicate Quest Points');
  assert.equal(completed.points - questpointBaseline, expectedQuestPoints, 'net account Quest Points equal the Between a Rock... reward');

  const fullReward = makePlayer();
  writeVar(fullReward, 'dwarfrock_quest', 100); // Independent full-inventory completion fixture.
  while (fullReward.invFreeSpace(inv)) addItem(fullReward, 'knife');
  nativeNpc(fullReward, dondakan, 1, [], 'claim period reward with a full inventory');
  assert.equal(stage(fullReward), completeStage, 'a full inventory does not prevent completion');
  assert.equal(count(fullReward, 'rune_pickaxe'), 0, 'the rune pickaxe cannot enter a full inventory');
  const groundPickaxe = World.getObj(fullReward.x, fullReward.z, fullReward.level, obj('rune_pickaxe'), fullReward.hash64);
  assert(groundPickaxe, 'a full inventory places the rune pickaxe at the player');
  assert.equal(groundPickaxe.count, 1, 'full-inventory completion drops exactly one rune pickaxe');
  nativeNpc(fullReward, dondakan, 1, [2], 'repeat full-inventory completed dialogue');
  assert.equal(World.getObj(fullReward.x, fullReward.z, fullReward.level, obj('rune_pickaxe'), fullReward.hash64)?.count, 1,
    'repeat full-inventory dialogue grants no duplicate ground reward');
  closePlayer(fullReward);

  // Stage 110 re-entry is Talk-to only; Fire remains excluded, and helmet loss expires a live mine session.
  const fireAfterQuest = nativeLoc(p, dondakanCannon, 1, [], 'postquest cannon Fire is not a re-entry shortcut');
  assert(fireAfterQuest.text.includes('speak to Dondakan'), 'postquest Fire uses the ordinary stage refusal');
  assert.equal(stage(p), completeStage, 'postquest Fire cannot rewrite the completed stage');
  nativeNpc(p, dondakan, 1, [1], 'postquest Talk-to re-enters the gold mine');
  assert.equal(stage(p), completeStage, 'postquest Talk-to re-entry preserves the completed stage');
  assert.equal(readVar(p, 'dwarfrock_inside_timeleft'), 800, 'postquest Talk-to starts a new mine timer');
  removeHelmet(p);
  environmentTick(p);
  settleCombat(p);
  assert.equal(readVar(p, 'dwarfrock_inside_timeleft'), 0, 'helmet removal cancels the live mine timer');
  assert.equal(stage(p), completeStage, 'helmet-loss exit preserves the completed stage');
  wearHelmet(p);
  nativeNpc(p, dondakan, 1, [1], 'repeat postquest Talk-to re-entry');
  assert.equal(stage(p), completeStage, 'repeated postquest entry remains complete');
  removeHelmet(p);
  environmentTick(p);
  settleCombat(p);
  assert.equal(stage(p), completeStage, 'repeated timer exit preserves the terminal quest state');

  console.log('PASS between-a-rock: stages, three pages, original four-part schematic canvas, gold shot/mine, all Avatar styles and thresholds, owned death credit, exact once-only rewards, cancellation and postquest re-entry');
} finally {
  Math.random = originalMathRandom;
  for (const npc of [...avatars]) closeNpc(npc);
  for (const p of [...players]) closePlayer(p);
}

process.exit(0);
