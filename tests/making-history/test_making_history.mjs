#!/usr/bin/env node
/** Compiled Making History dispatch, progression, recovery, rewards and map collision. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  World, ScriptProvider, ScriptState, ServerTriggerType, PlayerStat, map,
  contentRoot, engineModule, execute, id, obj, inv, worn, count, seed,
  held, use, resumeDialogue, types, player as makePlayer
} from '../swamp-caves/runtime.mjs';

const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const Loc = (await engineModule('engine/entity/Loc.ts')).default;
const { EntityLifeCycle } = await engineModule('engine/entity/EntityLifeCycle.js');
const { BlockWalk } = await engineModule('engine/entity/BlockWalk.js');
const Environment = (await engineModule('util/Environment.ts')).default;
assert.equal(Environment.NODE_XPRATE, 1, 'set NODE_XPRATE=1 to measure exact script XP');

const questConstants = fs.readFileSync(path.join(contentRoot, 'scripts/general/configs/quest.constant'), 'utf8');
function questConstant(name, source = questConstants) {
  const match = source.match(new RegExp(`^\\^${name}\\s*=\\s*(\\d+)`, 'm'));
  assert(match, `missing source quest constant ^${name}`);
  return Number(match[1]);
}
const STAGE = {
  untouched: 0,
  gathering: 1,
  letter: 2,
  reply: 3,
  complete: questConstant('makinghistory_complete')
};
const PRIEST_COMPLETE = questConstant('priest_complete');
const PRIESTPERIL_COMPLETE = questConstant('priestperil_complete');
const QUEST_POINTS = questConstant('makinghistory_questpoints');
assert.equal(STAGE.complete, 4);
assert.equal(PRIEST_COMPLETE, 5, 'Restless Ghost is prieststart/priest_complete, not Ernest’s haunted varp');
assert.equal(PRIESTPERIL_COMPLETE, 60);
assert.equal(QUEST_POINTS, 3);

const digText = fs.readFileSync(path.join(contentRoot, 'scripts/quests/quest_makinghistory/configs/mh.constant'), 'utf8');
const digMatch = digText.match(/^\^mh_chest_coord\s*=\s*(\d+)_(\d+)_(\d+)_(\d+)_(\d+)$/m);
assert(digMatch, 'quest dig location must be a packed coordinate');
const [, digLevel, digMapX, digMapZ, digLocalX, digLocalZ] = digMatch.map(Number);
const digTile = {
  level: digLevel,
  x: digMapX * 64 + digLocalX,
  z: digMapZ * 64 + digLocalZ
};
assert.deepEqual([digTile.level, digTile.x, digTile.z], [0, 2442, 3139], 'period-compatible east-bank dig tile');
assert.equal(map.isMapBlocked(digTile.x, digTile.z, digTile.level), false, 'packed map leaves the quest dig tile walkable');
const digApproaches = [
  { name: 'north', x: digTile.x, z: digTile.z + 1 },
  { name: 'east', x: digTile.x + 1, z: digTile.z },
  { name: 'north-east', x: digTile.x + 1, z: digTile.z + 1 }
].filter(tile =>
  !map.isMapBlocked(tile.x, tile.z, digTile.level) &&
  map.isLineOfWalk(digTile.level, tile.x, tile.z, digTile.x, digTile.z)
);
assert(digApproaches.length > 0, 'packed collision gives a walkable north/east approach to the dig tile');

const doorSpecs = [
  ['makinghistory_door', 'makinghistory_door_open', 'door_closed', 'door_opened'],
  ['makinghistory_doubledoorl', 'makinghistory_doubledoorl_open', 'door_left_closed', 'door_left_opened'],
  ['makinghistory_doubledoorr', 'makinghistory_doubledoorr_open', 'door_right_closed', 'door_right_opened']
];
const nextLocParam = id('ParamType', 'next_loc_stage');
function dispatchLoc(player, loc) {
  player.target = loc;
  player.targetOp = ServerTriggerType.OPLOC1 - 7;
  return player.getOpTrigger();
}
for (let index = 0; index < doorSpecs.length; index++) {
  const [closedName, openName, closedCategory, openCategory] = doorSpecs[index];
  const closedId = id('LocType', closedName);
  const openId = id('LocType', openName);
  const closed = types.LocType.get(closedId);
  const open = types.LocType.get(openId);
  assert.equal(closed.op?.[0], 'Open', `${closedName} keeps its original Open operation`);
  assert.equal(open.op?.[0], 'Close', `${openName} keeps its original Close operation`);
  assert.equal(closed.category, id('CategoryType', closedCategory));
  assert.equal(open.category, id('CategoryType', openCategory));
  assert.equal(closed.params.get(nextLocParam), openId, `${closedName} opens to its packed stage`);
  assert.equal(open.params.get(nextLocParam), closedId, `${openName} closes to its packed stage`);
  for (const [type, category] of [[closed, closedCategory], [open, openCategory]]) {
    const generic = ScriptProvider.getByTriggerSpecific(ServerTriggerType.OPLOC1, -1, type.category);
    assert(generic, `packed ${category} generic door trigger`);
    const player = makePlayer();
    const loc = new Loc(0, 2430 + index, 3340, type.width, type.length, EntityLifeCycle.DESPAWN, type.id, 0, 0);
    assert.strictEqual(dispatchLoc(player, loc), generic, `${category} resolves through production loc dispatch`);
  }
}

// Confirm the moved closed-door types are present in the packed outpost map and
// that their actual collision blocks at least one adjacent crossing.
const placedDoors = [];
for (const [closedName] of doorSpecs) {
  const closedId = id('LocType', closedName);
  let found = false;
  for (let x = 2368; x < 2496 && !found; x++) {
    for (let z = 3328; z < 3392; z++) {
      const loc = World.getLoc(x, z, 0, closedId);
      if (loc) {
        placedDoors.push(loc);
        found = true;
        break;
      }
    }
  }
}
assert(placedDoors.length > 0, 'packed Ardougne outpost contains a moved Making History closed door');
function blocksDoorCrossing(loc) {
  const edges = [
    [loc.x - 1, loc.z, loc.x, loc.z],
    [loc.x, loc.z, loc.x + 1, loc.z],
    [loc.x, loc.z - 1, loc.x, loc.z],
    [loc.x, loc.z, loc.x, loc.z + 1]
  ];
  return edges.some(([x1, z1, x2, z2]) => !map.isLineOfWalk(loc.level, x1, z1, x2, z2));
}
assert(placedDoors.some(blocksDoorCrossing), 'packed collision blocks crossing a real closed outpost door');
for (const loc of placedDoors) {
  const player = makePlayer();
  const type = types.LocType.get(loc.type);
  const generic = ScriptProvider.getByTriggerSpecific(ServerTriggerType.OPLOC1, -1, type.category);
  assert.strictEqual(dispatchLoc(player, loc), generic, 'real packed outpost door dispatches its generic category handler');
}

const VarBit = name => id('VarBitType', name);
const VarPlayer = name => id('VarPlayerType', name);
function stage(player, name, value) {
  const variable = VarBit(name);
  if (value !== undefined) player.setVarBit(variable, value);
  return player.getVarBit(variable);
}
function varp(player, name, value) {
  const variable = VarPlayer(name);
  if (value !== undefined) player.setVar(variable, value);
  return player.getVar(variable);
}
function removeOne(player, name, inventoryId = inv) {
  const container = player.getInventory(inventoryId);
  assert(container, `inventory ${inventoryId} exists`);
  for (let slot = 0; slot < container.capacity; slot++) {
    const item = player.invGetSlot(inventoryId, slot);
    if (item?.id !== obj(name)) continue;
    if (item.count > 1) container.set(slot, { id: item.id, count: item.count - 1 });
    else container.set(slot, null);
    return;
  }
  assert.fail(`${name} is present for removal`);
}
let nextNid = 1;
function npc(name, x = 2437, z = 3347) {
  const type = types.NpcType.getByName(name);
  assert(type, `packed NPC ${name}`);
  const actor = new Npc(0, x, z, 1, 1, EntityLifeCycle.RESPAWN, nextNid++, type.id, BlockWalk.NONE);
  actor.isActive = true;
  actor.lastMovement = -100;
  return actor;
}
function useVisibleForm(player, rootName, childName) {
  const root = types.NpcType.getByName(rootName);
  assert(root, `packed multi-NPC root ${rootName}`);
  const childId = id('NpcType', childName);
  const slot = root.multinpc.indexOf(childId);
  assert(slot >= 0, `${rootName} contains visible child ${childName}`);
  if (root.multivar !== -1) player.setVar(root.multivar, slot);
  else {
    assert.notEqual(root.multivarbit, -1, `${rootName} has its packed multi selector`);
    player.setVarBit(root.multivarbit, slot);
  }
}
function startNpc(player, name, visibleChild = null) {
  if (visibleChild) useVisibleForm(player, name, visibleChild);
  const actor = npc(name);
  player.target = actor;
  player.targetOp = ServerTriggerType.OPNPC1 - 7;
  const script = player.getOpTrigger();
  assert(script, `production NPC dispatch for ${name}`);
  if (visibleChild) {
    assert.equal(script.name, `[opnpc1,${visibleChild}]`, `${name} dispatches its visible ${visibleChild} child`);
  }
  const state = ScriptRunner.init(script, player, actor);
  player.executeScript(state, true, true);
  assert.notEqual(state.execution, -1, `${script.name} obtains protected access`);
  assert.notEqual(state.execution, ScriptState.ABORTED, `${script.name} does not abort`);
  return { state, script };
}
function finishDialogue(player, interaction, choices = []) {
  const remaining = [...choices];
  let steps = 0;
  while (interaction.state.execution !== ScriptState.FINISHED && steps++ < 160) {
    const execution = interaction.state.execution;
    if (execution === ScriptState.PAUSEBUTTON) {
      const component = types.Component.get(player.modalChat);
      if (/^multi[2-5]$/.test(component?.comName ?? '')) {
        assert(remaining.length > 0, `an explicit choice is required for ${interaction.script.name}`);
        resumeDialogue(player, remaining.shift());
      } else {
        resumeDialogue(player);
      }
    } else if (execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, player.delayedUntil);
      player.delayed = false;
      player.executeScript(interaction.state, true, true);
      assert.notEqual(interaction.state.execution, ScriptState.ABORTED, `${interaction.script.name} resumes without abort`);
    } else {
      assert.fail(`${interaction.script.name} stopped in unexpected state ${execution}`);
    }
  }
  assert.equal(interaction.state.execution, ScriptState.FINISHED, `${interaction.script.name} finishes`);
  assert.equal(remaining.length, 0, `${interaction.script.name} consumed every supplied choice`);
}
function talk(player, name, choices = [], visibleChild = null) {
  const interaction = startNpc(player, name, visibleChild);
  finishDialogue(player, interaction, choices);
  return interaction.script.name;
}
function questPoints(player) {
  return execute('[proc,count_questpoints]', player).popInt();
}
function qualifiedPlayer() {
  const player = makePlayer();
  player.setVar(VarPlayer('prieststart'), PRIEST_COMPLETE);
  player.setVar(VarPlayer('priestperil'), PRIESTPERIL_COMPLETE);
  const points = questPoints(player);
  player.setVar(VarPlayer('qp'), points);
  player.makingHistoryBaseline = {
    points,
    prayer: player.stats[PlayerStat.PRAYER],
    crafting: player.stats[PlayerStat.CRAFTING]
  };
  return player;
}
function startQuest(player) {
  talk(player, 'makinghistory_jorral', [1, 1, 4]);
  assert.equal(stage(player, 'makinghistory_prog'), STAGE.gathering, 'Jorral starts the quest only after both prerequisites');
}

// The packed Jorral start is gated by the actual Restless Ghost and Priest in Peril
// source varps/constants; Ernest's unrelated haunted varp cannot satisfy it.
for (const [restlessGhost, priestperil] of [[0, PRIESTPERIL_COMPLETE], [PRIEST_COMPLETE, 0]]) {
  const player = makePlayer();
  player.setVar(VarPlayer('prieststart'), restlessGhost);
  player.setVar(VarPlayer('priestperil'), priestperil);
  talk(player, 'makinghistory_jorral');
  assert.equal(stage(player, 'makinghistory_prog'), STAGE.untouched, 'missing either prerequisite leaves Making History unstarted');
}
{
  const player = makePlayer();
  talk(player, 'silver_merchant', [2]);
  assert.equal(stage(player, 'makinghistory_trader_prog'), 0, 'trader does not start the quest');
  assert.equal(count(player, 'makinghistory_key'), 0);
}

// Shared actors retain their original services while Making History is active.
{
  const player = qualifiedPlayer();
  startQuest(player);
  talk(player, 'silver_merchant', [1]);
  const merchant = types.NpcType.getByName('silver_merchant');
  assert.equal(varp(player, 'shop'), merchant.params.get(id('ParamType', 'owned_shop')), 'the original silver shop still opens');
  assert.equal(stage(player, 'makinghistory_prog'), STAGE.gathering);
  assert.equal(stage(player, 'makinghistory_trader_prog'), 0, 'shopping does not take the outpost branch');
  assert.equal(count(player, 'makinghistory_key'), 0);
}
{
  const player = qualifiedPlayer();
  stage(player, 'makinghistory_prog', STAGE.letter);
  seed(player, ['makinghistory_letter1']);
  const regicideConstants = fs.readFileSync(path.join(contentRoot, 'scripts/quests/quest_regicide/configs/quest_regicide.constant'), 'utf8');
  const received = questConstant('regicide_received_message', regicideConstants);
  const spoken = questConstant('regicide_spoken_lathas', regicideConstants);
  varp(player, 'regicide_quest', received);
  talk(player, 'kinglathas', [2]);
  assert.equal(varp(player, 'regicide_quest'), spoken, 'the original royal Regicide stage still advances');
  assert.equal(stage(player, 'makinghistory_prog'), STAGE.letter, 'the other conversation does not consume Jorral’s letter');
  assert.equal(count(player, 'makinghistory_letter1'), 1);
  talk(player, 'kinglathas', [1]);
  assert.equal(stage(player, 'makinghistory_prog'), STAGE.reply, 'the outpost branch remains available alongside Regicide');
  assert.equal(varp(player, 'regicide_quest'), spoken, 'the outpost conversation does not change Regicide');
}

// Spade/key gates, the key recovery route, distance tool, chest combination and key retention.
{
  const player = qualifiedPlayer();
  startQuest(player);
  player.level = digTile.level; player.x = digTile.x; player.z = digTile.z;
  seed(player, ['spade']);
  held(player, 'spade', 1);
  assert.equal(stage(player, 'makinghistory_trader_prog'), 0, 'digging before Erin lends the key earns no trader credit');
  assert.equal(count(player, 'makinghistory_chest'), 0);

  talk(player, 'silver_merchant', [2]);
  assert.equal(stage(player, 'makinghistory_trader_prog'), 1);
  assert.equal(count(player, 'makinghistory_key'), 1);
  removeOne(player, 'makinghistory_key');
  held(player, 'spade', 1);
  assert.equal(stage(player, 'makinghistory_trader_prog'), 1, 'spade without the key cannot dig');
  assert.equal(count(player, 'makinghistory_chest'), 0);

  talk(player, 'silver_merchant', [2]);
  assert.equal(count(player, 'makinghistory_key'), 1, 'Erin recovers a lost key');
  player.x = digTile.x + 1;
  held(player, 'spade', 1);
  assert.equal(stage(player, 'makinghistory_trader_prog'), 1, 'a nearby but incorrect tile does not dig');
  assert.equal(count(player, 'makinghistory_chest'), 0);

  player.x = digTile.x; player.z = digTile.z;
  held(player, 'makinghistory_key', 1);
  assert.equal(varp(player, 'makinghistory_key_distance'), 1, 'Feel stores the exact-tile distance observation');
  held(player, 'spade', 1);
  assert.equal(stage(player, 'makinghistory_trader_prog'), 2);
  assert.equal(count(player, 'makinghistory_chest'), 1);
  use(player, 'spade', 'makinghistory_chest');
  assert.equal(stage(player, 'makinghistory_trader_prog'), 2, 'a non-key item cannot open the chest');
  assert.equal(count(player, 'makinghistory_chest'), 1);
  use(player, 'makinghistory_key', 'makinghistory_chest');
  assert.equal(stage(player, 'makinghistory_trader_prog'), 3);
  assert.equal(count(player, 'makinghistory_chest'), 0);
  assert.equal(count(player, 'makinghistory_journal'), 1);
  assert.equal(count(player, 'makinghistory_key'), 1, 'the enchanted key is retained after opening the chest');
}

// Ghost-speak must be worn, and Melina rejects gifts until Droalak asks and rejects an unstrung amulet.
{
  const player = qualifiedPlayer();
  startQuest(player);
  seed(player, ['strung_sapphire_amulet']);
  talk(player, 'makinghistory_droalak_multi', [], 'makinghistory_droalak');
  assert.equal(stage(player, 'makinghistory_ghost_prog'), 0, 'Droalak requires the worn ghostspeak amulet');
  talk(player, 'makinghistory_melina_multi', [], 'makinghistory_melina');
  assert.equal(stage(player, 'makinghistory_ghost_prog'), 0);
  assert.equal(count(player, 'strung_sapphire_amulet'), 1, 'Melina cannot take the gift without ghostspeak');

  player.invAdd(worn, obj('amulet_of_ghostspeak'), 1);
  talk(player, 'makinghistory_melina_multi', [], 'makinghistory_melina');
  assert.equal(stage(player, 'makinghistory_ghost_prog'), 0, 'a strung gift is rejected before Droalak asks');
  assert.equal(count(player, 'strung_sapphire_amulet'), 1);
  talk(player, 'makinghistory_droalak_multi', [], 'makinghistory_droalak');
  assert.equal(stage(player, 'makinghistory_ghost_prog'), 1, 'Droalak asks for the strung sapphire amulet');
  removeOne(player, 'amulet_of_ghostspeak', worn);
  talk(player, 'makinghistory_melina_multi', [], 'makinghistory_melina');
  assert.equal(stage(player, 'makinghistory_ghost_prog'), 1, 'Melina requires worn ghostspeak even after Droalak asks');
  assert.equal(count(player, 'strung_sapphire_amulet'), 1, 'Melina keeps the gift when ghostspeak is not worn');
  player.invAdd(worn, obj('amulet_of_ghostspeak'), 1);

  removeOne(player, 'strung_sapphire_amulet');
  seed(player, ['unstrung_sapphire_amulet']);
  talk(player, 'makinghistory_melina_multi', [], 'makinghistory_melina');
  assert.equal(stage(player, 'makinghistory_ghost_prog'), 1, 'unstrung sapphire does not satisfy Droalak’s request');
  assert.equal(count(player, 'unstrung_sapphire_amulet'), 1);
  removeOne(player, 'unstrung_sapphire_amulet');
  seed(player, ['strung_sapphire_amulet']);
  talk(player, 'makinghistory_melina_multi', [], 'makinghistory_melina');
  assert.equal(stage(player, 'makinghistory_ghost_prog'), 2);
  assert.equal(count(player, 'strung_sapphire_amulet'), 0, 'Melina consumes exactly the accepted strung gift');
  talk(player, 'makinghistory_droalak_multi', [], 'makinghistory_droalak');
  assert.equal(stage(player, 'makinghistory_ghost_prog'), 3);
  assert.equal(count(player, 'makinghistory_scroll1'), 1);
  removeOne(player, 'makinghistory_scroll1');
  talk(player, 'makinghistory_droalak_multi', [], 'makinghistory_droalak');
  assert.equal(stage(player, 'makinghistory_ghost_prog'), 3);
  assert.equal(count(player, 'makinghistory_scroll1'), 1, 'Droalak recovers a lost scroll');
}

const dronAnswers = [3, 2, 2, 1, 2, 1, 2, 2, 1, 3, 3, 1, 1, 1];
{
  const player = qualifiedPlayer();
  startQuest(player);
  talk(player, 'makinghistory_dron');
  assert.equal(stage(player, 'makinghistory_warr_prog'), 1, 'the original first-Dron bounce still grants ready-to-quiz');
}
const wrongDronChoices = [
  [0, 1], [0, 2], [1, 1], [2, 1], [3, 2], [4, 1],
  [5, 2], [5, 3], [6, 1], [7, 1], [8, 2], [9, 1],
  [10, 1], [11, 3], [12, 2], [13, 2]
];
for (const [answerIndex, wrongChoice] of wrongDronChoices) {
  const player = qualifiedPlayer();
  startQuest(player);
  talk(player, 'makinghistory_blanin');
  assert.equal(stage(player, 'makinghistory_warr_prog'), 1, 'Blanin sets the quiz-ready stage');
  const answers = dronAnswers.slice(0, answerIndex + 1);
  answers[answerIndex] = wrongChoice;
  talk(player, 'makinghistory_dron', answers);
  assert.equal(stage(player, 'makinghistory_warr_prog'), 1, `wrong Dron response at question ${answerIndex + 1} gives no credit`);
}

function doTraderTrack(player) {
  talk(player, 'silver_merchant', [2]);
  assert.equal(stage(player, 'makinghistory_trader_prog'), 1);
  player.level = digTile.level; player.x = digTile.x; player.z = digTile.z;
  seed(player, ['spade']);
  held(player, 'spade', 1);
  assert.equal(stage(player, 'makinghistory_trader_prog'), 2);
  use(player, 'makinghistory_key', 'makinghistory_chest');
  assert.equal(stage(player, 'makinghistory_trader_prog'), 3);
  assert.equal(count(player, 'makinghistory_journal'), 1);
}
function doGhostTrack(player) {
  player.invAdd(worn, obj('amulet_of_ghostspeak'), 1);
  talk(player, 'makinghistory_droalak_multi', [], 'makinghistory_droalak');
  assert.equal(stage(player, 'makinghistory_ghost_prog'), 1);
  seed(player, ['strung_sapphire_amulet']);
  talk(player, 'makinghistory_melina_multi', [], 'makinghistory_melina');
  assert.equal(stage(player, 'makinghistory_ghost_prog'), 2);
  talk(player, 'makinghistory_droalak_multi', [], 'makinghistory_droalak');
  assert.equal(stage(player, 'makinghistory_ghost_prog'), 3);
  assert.equal(count(player, 'makinghistory_scroll1'), 1);
}
function doWarriorTrack(player) {
  talk(player, 'makinghistory_blanin');
  assert.equal(stage(player, 'makinghistory_warr_prog'), 1);
  talk(player, 'makinghistory_dron', dronAnswers);
  assert.equal(stage(player, 'makinghistory_warr_prog'), 2, 'all original quiz answers earn history credit');
}
function reportTrack(player, track, finalReport) {
  talk(player, 'makinghistory_jorral', finalReport ? [] : [4]);
  if (track === 'trader') {
    assert.equal(stage(player, 'makinghistory_trader_prog'), 4, 'Jorral reports and consumes the journal');
    assert.equal(count(player, 'makinghistory_journal'), 0);
  } else if (track === 'ghost') {
    assert.equal(stage(player, 'makinghistory_ghost_prog'), 4, 'Jorral reports and consumes the scroll');
    assert.equal(count(player, 'makinghistory_scroll1'), 0);
  } else {
    assert.equal(stage(player, 'makinghistory_warr_prog'), 3, 'Jorral reports the learned warrior history');
  }
  assert.equal(stage(player, 'makinghistory_prog'), finalReport ? STAGE.letter : STAGE.gathering);
}

const orders = [
  ['trader', 'ghost', 'warrior'], ['trader', 'warrior', 'ghost'],
  ['ghost', 'trader', 'warrior'], ['ghost', 'warrior', 'trader'],
  ['warrior', 'trader', 'ghost'], ['warrior', 'ghost', 'trader']
];
for (let orderIndex = 0; orderIndex < orders.length; orderIndex++) {
  const order = orders[orderIndex];
  const player = qualifiedPlayer();
  startQuest(player);
  for (let index = 0; index < order.length; index++) {
    const track = order[index];
    if (track === 'trader') doTraderTrack(player);
    else if (track === 'ghost') doGhostTrack(player);
    else doWarriorTrack(player);
    reportTrack(player, track, index === order.length - 1);
  }
  assert.deepEqual(order.map(track => stage(player, `makinghistory_${track === 'warrior' ? 'warr' : track}_prog`)),
    order.map(track => track === 'warrior' ? 3 : 4), 'all six report orders retain each reported substage');
  assert.equal(count(player, 'makinghistory_letter1'), 1, 'the third report grants Jorral’s letter');

  const exerciseRecovery = orderIndex === 0;
  const overflowReward = orderIndex === orders.length - 1;
  if (exerciseRecovery) {
    removeOne(player, 'makinghistory_letter1');
    talk(player, 'makinghistory_jorral');
    assert.equal(stage(player, 'makinghistory_prog'), STAGE.letter);
    assert.equal(count(player, 'makinghistory_letter1'), 1, 'Jorral recovers the lost outgoing letter');
  }
  talk(player, 'kinglathas', [1]);
  assert.equal(stage(player, 'makinghistory_prog'), STAGE.reply, 'King accepts Jorral’s letter');
  assert.equal(count(player, 'makinghistory_letter1'), 0);
  assert.equal(count(player, 'makinghistory_letter2'), 1, 'King grants the reply');

  if (exerciseRecovery) {
    removeOne(player, 'makinghistory_letter2');
    talk(player, 'makinghistory_jorral');
    assert.equal(stage(player, 'makinghistory_prog'), STAGE.reply, 'Jorral cannot complete without the King’s reply');
    assert.equal(count(player, 'coins'), 0);
    talk(player, 'kinglathas', [1]);
    assert.equal(stage(player, 'makinghistory_prog'), STAGE.reply);
    assert.equal(count(player, 'makinghistory_letter2'), 1, 'King recovers the lost reply');
  }

  if (overflowReward) {
    removeOne(player, 'makinghistory_key');
    player.level = digTile.level; player.x = digTile.x; player.z = digTile.z;
    const bag = player.getInventory(inv);
    const replySlot = Array.from({ length: bag.capacity }, (_, slot) => slot)
      .find(slot => player.invGetSlot(inv, slot)?.id === obj('makinghistory_letter2'));
    assert.notEqual(replySlot, undefined, 'the reply remains in inventory before Jorral hand-in');
    for (let slot = 0; slot < bag.capacity; slot++) {
      if (slot !== replySlot) bag.set(slot, { id: obj('makinghistory_scroll1'), count: 1 });
    }
    assert.equal(bag.freeSlotCount, 0, 'reward case enters with a full inventory');
    assert.equal(count(player, 'makinghistory_key'), 0);
    assert.equal(count(player, 'makinghistory_key', id('InvType', 'bank')), 0);
  }

  const baseline = player.makingHistoryBaseline;
  talk(player, 'makinghistory_jorral');
  assert.equal(stage(player, 'makinghistory_prog'), STAGE.complete, 'Jorral completes only after the King’s reply');
  assert.equal(count(player, 'makinghistory_letter2'), 0, 'Jorral consumes the reply');
  assert.equal(player.stats[PlayerStat.PRAYER] - baseline.prayer, 10000, 'awards exactly 1,000 Prayer XP');
  assert.equal(player.stats[PlayerStat.CRAFTING] - baseline.crafting, 10000, 'awards exactly 1,000 Crafting XP');
  assert.equal(varp(player, 'qp'), baseline.points + QUEST_POINTS, 'awards exactly three quest points');
  assert.equal(questPoints(player), baseline.points + QUEST_POINTS, 'quest-point recount agrees');
  assert.equal(count(player, 'coins'), 750, 'awards 750 coins exactly once');
  if (overflowReward) {
    assert.equal(count(player, 'makinghistory_key'), 0, 'overflow key is not lost in a full inventory');
    const droppedKey = World.getObj(digTile.x, digTile.z, digTile.level, obj('makinghistory_key'), player.hash64);
    assert(droppedKey, 'full-inventory key reward is dropped at the player’s tile');
    assert.equal(droppedKey.count, 1);
  } else {
    assert.equal(count(player, 'makinghistory_key'), 1, 'the trader key remains available after completion');
  }

  player.packets.length = 0;
  execute('[proc,update_questlist]', player);
  assert(player.packets.some(packet =>
    packet.constructor.name === 'IfSetColour' &&
    packet.component === id('Component', 'questlist:makinghistory') &&
    packet.colour === 0x3e0
  ), 'login quest-list refresh colours completed Making History green');

  talk(player, 'makinghistory_jorral');
  assert.equal(stage(player, 'makinghistory_prog'), STAGE.complete);
  assert.equal(player.stats[PlayerStat.PRAYER] - baseline.prayer, 10000, 'repeat Jorral talk gives no Prayer XP');
  assert.equal(player.stats[PlayerStat.CRAFTING] - baseline.crafting, 10000, 'repeat Jorral talk gives no Crafting XP');
  assert.equal(varp(player, 'qp'), baseline.points + QUEST_POINTS, 'repeat Jorral talk gives no quest points');
  assert.equal(count(player, 'coins'), 750, 'repeat Jorral talk gives no coins');
  assert.equal(count(player, 'makinghistory_letter2'), 0);
  if (overflowReward) {
    const droppedKey = World.getObj(digTile.x, digTile.z, digTile.level, obj('makinghistory_key'), player.hash64);
    assert(droppedKey, 'repeat talk leaves the one overflow key intact');
    assert.equal(droppedKey.count, 1);
  } else {
    assert.equal(count(player, 'makinghistory_key'), 1);
  }
}

console.log('PASS Making History: six report orders, real NPC/visible-form dispatch, gates, all Dron wrong answers, letter/item recovery, packed doors/dig collision, completion rewards and login colour');
process.exit(0);
