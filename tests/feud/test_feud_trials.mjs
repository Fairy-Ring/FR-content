import './deterministic-wander.mjs';
import { urchinSelectionTests } from './urchin-selection.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PlayerStat, World, count, engineModule, execute, id, inv, map, obj, remove, seed, tile, types
} from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';
import {
  activeLoc, actors, assertKnockoutCycle, begin, bit, buyReceipts, deliver, displayNpcType, drink, hasWitness, isWitness, locs,
  nativeNpcTriggerName, openOriginalVillagerCurtain, operate, operateHere, operateLoc, operationStand, read, relog, stage, talk, tickThrough, wield, worldTick
} from './fixture.mjs';

const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const { NpcMode } = await engineModule('engine/entity/NpcMode.ts');
const stateVar = id('VarNpcType', 'feud_villager_state');
const ownerVar = id('VarNpcType', 'feud_villager_owner');
const attackVar = id('VarNpcType', 'npc_attacking_uid');
const aggressiveVar = id('VarNpcType', 'npc_aggressive_player');
const deadlineVar = id('VarNpcType', 'feud_villager_deadline');
const slotVar = id('VarPlayerType', 'feud_trial_villager');
const villagerForms = new Set([
  'feud_villager_multi_1', 'feud_villager_multi_2', 'feud_villager_multi_3',
  'feud_villager_1_1', 'feud_villager_1_2', 'feud_villager_1_3',
  'feud_villager_2_1', 'feud_villager_2_2', 'feud_villager_2_3',
  'feud_villager_3_1', 'feud_villager_3_2', 'feud_villager_3_3'
].map(name => id('NpcType', name)));
const feudVillagers = () => [...World.npcs].filter(npc => npc.isActive &&
  (villagerForms.has(npc.baseType) || villagerForms.has(npc.type)));
function isolatedVillager(p, excluded) {
  return feudVillagers().find(npc => !excluded.has(npc) && npc.getVar(stateVar) === 0 &&
    !hasWitness(p, npc) && operationStand(p, npc));
}

test('failed trial KO releases its follow and trial UID in the same tick without losing the earned checkpoint', () => {
  const p = seed(player(), ['blackjack_oak']);
  // Disclosed pre-third-trial player fixture; Lure creates every NPC condition and the real trial UID.
  p.setVarBit(bit('feud_var'), 9);
  p.setVarBit(bit('feud_npc_multi'), 2);
  p.setVar(slotVar, -1);
  wield(p, 'blackjack_oak');
  const target = isolatedVillager(p, new Set());
  assert(target, 'an original unwitnessed villager is available without NPC setup');
  operate(p, target, 4);
  assert.equal(stage(p), 10);
  assert.equal(p.getVar(slotVar), target.uid);
  const failureTick = World.currentTick, beforeXp = p.stats[PlayerStat.THIEVING];
  const beforeHp = p.levels[PlayerStat.HITPOINTS], originalDraw = JavaRandom.nextDouble;
  try {
    JavaRandom.nextDouble = () => 0.999;
    operate(p, target, 5);
  } finally {
    JavaRandom.nextDouble = originalDraw;
  }
  assert.equal(World.currentTick, failureTick);
  assert.equal(stage(p), 10, 'failure preserves the earned waiting checkpoint');
  assert.equal(target.getVar(stateVar), 0, 'failure ends the trial follow before another turn');
  assert.equal(target.getVar(ownerVar), -1);
  assert.equal(target.getVar(deadlineVar), 0);
  assert.equal(p.getVar(slotVar), -1, 'the same release clears the acting player reservation');
  assert.equal(target.getVar(aggressiveVar), p.uid, 'the failure still queues ordinary retaliation');
  assert.equal(p.stats[PlayerStat.THIEVING], beforeXp);
  assert.equal(p.levels[PlayerStat.HITPOINTS], beforeHp, 'the roll failure adds no separate damage');
  worldTick();
  assert.equal(target.targetOp, NpcMode.OPPLAYER2);
  const mark = p.messages.length;
  operate(p, target, 4);
  assert.deepEqual(p.messages.slice(mark), ['Nothing interesting happens.']);
  assert.equal(target.getVar(stateVar), 0, 'a fighting villager cannot be reclaimed by Lure');
  assert.equal(p.getVar(slotVar), -1);
  assert.equal(stage(p), 10);
});

test('compiled witness data and original-map probes distinguish visible people, animals and hidden forms', t => {
  const p = player();
  // Reachable post-quest display state; this is a predicate/data fixture, not earned quest progress.
  p.setVarBit(bit('feud_var'), 28);
  p.setVarBit(bit('feud_npc_multi'), 2);
  const animals = new Set(['feud_camel', 'feud_charmers_snake', 'feud_desert_snake', 'magic_carpet_monkey']
    .map(name => id('NpcType', name)));
  const local = [...World.npcs].filter(npc => npc.isActive && npc.level === 0 &&
    npc.x >= 52 * 64 && npc.x < 53 * 64 && npc.z >= 46 * 64 && npc.z < 47 * 64);
  const people = types.EnumType.get(id('EnumType', 'feud_witness_people'));
  const target = actors('feud_villager_multi_2').find(npc => !hasWitness(p, npc));
  assert(target, 'an original villager supplies the real self-exclusion UID');
  for (const npc of local) {
    const visible = displayNpcType(p, npc);
    const expected = Number(!animals.has(npc.baseType) && Boolean(visible.models?.length));
    assert.equal(people.values.get(visible.id) ?? people.defaultInt, expected,
      `compiled eligibility agrees with the independent original-cache classification: ${visible.debugname}`);
  }
  const near = (point, npc) => npc !== target && npc.isActive && npc.level === point.level &&
    CoordGrid.distanceToSW(point, npc) <= 5 &&
    map.isLineOfSight(point.level, npc.x, npc.z, point.x, point.z);
  const points = [];
  const seen = new Set();
  for (const npc of local) for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) {
    const point = { level: npc.level, x: npc.x + dx, z: npc.z + dz, uid: target.uid };
    const key = `${point.level}:${point.x}:${point.z}`;
    if (seen.has(key) || map.isMapBlocked(point.x, point.z, point.level)) continue;
    seen.add(key); points.push(point);
  }
  const choose = (description, predicate) => {
    const point = points.find(predicate);
    assert(point, `the unchanged original map supplies ${description}`);
    return point;
  };
  const empty = choose('a probe tile with no other nearby NPC in sight',
    point => !local.some(npc => near(point, npc)));
  const person = choose('a visible-person probe',
    point => hasWitness(p, point));
  const animal = choose('a visible-animal-only probe',
    point => !hasWitness(p, point) &&
      local.some(npc => animals.has(npc.baseType) && near(point, npc) &&
        Boolean(displayNpcType(p, npc).models?.length)));
  const hidden = choose('a hidden-form-only probe',
    point => !hasWitness(p, point) &&
      local.some(npc => near(point, npc) && types.NpcType.get(npc.type).multinpc.length > 0 &&
        !displayNpcType(p, npc).models?.length));
  for (const [kind, present, expected] of [
    ['visible person', person, 1], ['visible animal', animal, 0], ['hidden form', hidden, 0]
  ]) {
    for (const [presence, point, result] of [['present', present, expected], ['absent', empty, 0]]) {
      const before = World.currentTick;
      const state = execute('[proc,feud_villager_has_witness]', p,
        [CoordGrid.packCoord(point.level, point.x, point.z), target.uid], { target });
      assert.equal(state.popInt(), result, `${kind} ${presence}: compiled original-map witness result`);
      assert.equal(World.currentTick, before, 'the witness scan completes without a delayed fixture clock jump');
      if (result) assert.equal(state.activeNpc, target, 'a positive scan restores the victim, not the witness');
      t.diagnostic(JSON.stringify({ kind, presence, at: [point.level, point.x, point.z], result }));
    }
  }
});

test('a witnessed native trial Knock-Out costs five HP without releasing the lured villager', () => {
  const p = seed(player(), ['blackjack_oak']);
  p.setVarBit(bit('feud_var'), 9);
  p.setVarBit(bit('feud_npc_multi'), 2);
  p.setVar(slotVar, -1);
  wield(p, 'blackjack_oak');

  const target = actors('feud_villager_multi_3').find(npc =>
    npc.getVar(stateVar) === 0 && hasWitness(p, npc) && operationStand(p, npc));
  assert(target, 'an original trial villager has a visible person in range and a reachable native operation stand');
  const lure = operate(p, target, 4);
  assert.equal(lure.trigger, nativeNpcTriggerName(p, target, 4));
  assert.equal(stage(p), 10);
  assert.equal(target.getVar(stateVar), 2);
  assert.equal(target.getVar(ownerVar), p.uid);
  assert.equal(p.getVar(slotVar), target.uid);
  assert.equal(target.targetOp, NpcMode.PLAYERFOLLOW);
  assert.equal(target.target, p);

  const witness = [...World.npcs].find(npc => isWitness(p, target, npc));
  assert(witness, 'the original map still supplies a visible person in range for the native Knock-Out');
  const before = {
    hp: p.levels[PlayerStat.HITPOINTS],
    xp: p.stats[PlayerStat.THIEVING],
    stage: stage(p),
    deadline: target.getVar(deadlineVar)
  };
  const knockout = operate(p, target, 5);
  assert.equal(knockout.trigger, nativeNpcTriggerName(p, target, 5));
  assert(isWitness(p, target, witness), 'the same visible person remains in range through the operation');
  assert.equal(before.hp - p.levels[PlayerStat.HITPOINTS], 5, 'the witnessed trial attempt costs exactly five HP');
  assert.equal(p.stats[PlayerStat.THIEVING], before.xp, 'a witnessed attempt grants no Knock-Out XP');
  assert.equal(stage(p), before.stage, 'a witnessed attempt leaves the trial checkpoint unchanged');
  assert.equal(target.getVar(stateVar), 2, 'the witnessed attempt retains the follow');
  assert.equal(target.getVar(ownerVar), p.uid);
  assert.equal(target.getVar(deadlineVar), before.deadline, 'the witness does not restart or release the follow');
  assert.equal(p.getVar(slotVar), target.uid);
  assert.equal(target.targetOp, NpcMode.PLAYERFOLLOW);
  assert.equal(target.target, p);
});

test('a real lured villager can be knocked out inside its original house with both curtains closed', () => {
  const p = seed(player(), ['blackjack_oak']);
  // Isolated reachable pre-lure state; the full headed quest earns this checkpoint.
  p.setVarBit(bit('feud_var'), 9);
  p.setVarBit(bit('feud_npc_multi'), 2);
  p.setVar(id('VarPlayerType', 'feud_trial_villager'), -1);
  wield(p, 'blackjack_oak');
  const target = actors('feud_villager_multi_3').find(npc => npc.startX === 3349 && npc.startZ === 2954);
  assert(target, 'the original map places this villager inside the house');
  assert.equal(target.getVar(stateVar), 0, 'the fixture does not create the tested lure state');
  const inside = operationStand(p, target);
  assert(inside, 'the original open entrance makes the interior operation stand reachable');
  const route = [...map.findPath(0, 3350, 2951, inside[1], inside[2])];
  assert(route.length, 'the player can enter from outside through the original open curtain');
  const end = CoordGrid.unpackCoord(route.at(-1));
  assert.deepEqual([end.level, end.x, end.z], inside, 'the entrance route reaches the interior stand exactly');
  const south = locs('curtain_1529').find(loc => loc.level === 0 && loc.x === 3350 && loc.z === 2952);
  const north = locs('curtain_1528').find(loc => loc.level === 0 && loc.x === 3350 && loc.z === 2957);
  assert(south && north, 'both original house curtains are identified from the map');
  assert.equal(types.LocType.get(activeLoc(south).type).op[0], 'Close');
  operateLoc(p, south, { position: [0, 3350, 2953] });
  assert.equal(activeLoc(south).type, id('LocType', 'curtain_1528'), 'the real Close action shuts the southern entrance');
  assert.equal(activeLoc(north).type, id('LocType', 'curtain_1528'), 'the northern entrance remains closed');
  // Own-position fixture input before Lure, on the exact proven interior route.
  [p.level, p.x, p.z] = inside;
  p.originX = p.x; p.originZ = p.z;
  const beforeLurePosition = tile(p);
  operateHere(p, target, 4);
  assert.equal(stage(p), 10, 'native Lure earns the tested checkpoint');
  assert.equal(target.getVar(stateVar), 2);
  assert.equal(target.getVar(ownerVar), p.uid);
  assert.deepEqual(tile(p), beforeLurePosition, 'no player relocation occurs after Lure');
  assert(!hasWitness(p, target), 'the closed house screens every visible person');
  const outside = actors('feud_egyptian_doorman_multi').find(npc =>
    CoordGrid.distanceToSW(target, npc) <= 5 &&
    Boolean(displayNpcType(p, npc).models?.length) &&
    !map.isLineOfSight(target.level, npc.x, npc.z, target.x, target.z));
  assert(outside, 'an original nearby person is actually occluded by the house');
  const beforeXp = p.stats[PlayerStat.THIEVING];
  const originalDraw = JavaRandom.nextDouble;
  try {
    JavaRandom.nextDouble = () => 0;
    operateHere(p, target, 5);
  } finally {
    JavaRandom.nextDouble = originalDraw;
  }
  assert.equal(stage(p), 11, 'closed-house KO advances through the native operation');
  assert.equal(target.getVar(stateVar), 3);
  assert.equal(target.getVar(ownerVar), p.uid);
  assert.equal(p.stats[PlayerStat.THIEVING] - beforeXp, 80, 'the real success awards the one-time eight XP');
  assert.deepEqual(tile(p), beforeLurePosition, 'the KO also uses the actual unchanged interior position');
  assertKnockoutCycle(target);
  assert.equal(target.getVar(stateVar), 0, 'native wake cleanup releases the original villager for later cases');
});

test('native Feud trials allow the opening at level 29, gate the first theft at 30, and preserve trial consequences', () => {
  let p = player();
  p.setLevel(PlayerStat.THIEVING, 29);
  p.invAdd(inv, obj('coins'), 100);

  const information = talk(p, 'feud_street_urchin', [1, 1, 2]);
  assert.match(information.text, /They're a bad bunch/);
  assert.equal(stage(p), 0, 'town information alone cannot advance the quest');

  begin(p);
  assert.equal(stage(p), 1, 'the sourced opening remains available below the required theft level');
  drink(p);
  talk(p, 'feud_egyptian_doorman_multi');
  talk(p, 'feud_arabian_guard_multi');
  buyReceipts(p);
  deliver(p);
  talk(p, 'feud_egyptian_minder', [1, 2]);
  assert.equal(stage(p), 6);

  const firstTarget = actors('feud_villager_multi_1')[0];
  const refusedCoins = count(p, 'coins'), refusedXp = p.stats[PlayerStat.THIEVING];
  operate(p, firstTarget, 3);
  assert.equal(stage(p), 6, 'the first trial theft enforces the period level requirement');
  assert.equal(read(p, 'feud_npc_multi'), 0, 'a refused theft exposes no later villager form');
  assert.equal(count(p, 'coins'), refusedCoins);
  assert.equal(p.stats[PlayerStat.THIEVING], refusedXp);
  p.setLevel(PlayerStat.THIEVING, 30);
  const firstCoins = count(p, 'coins'), firstXp = p.stats[PlayerStat.THIEVING];
  operate(p, firstTarget, 3);
  assert.equal(stage(p), 7, 'one real pickpocket reaches the first trial checkpoint');
  assert.equal(count(p, 'coins') - firstCoins, 3);
  assert.equal(p.stats[PlayerStat.THIEVING] - firstXp, 80);
  assert.equal(read(p, 'feud_npc_multi'), 1, 'the first theft exposes the original second villager form');

  const repeatCoins = count(p, 'coins'), repeatXp = p.stats[PlayerStat.THIEVING];
  const repeatHp = p.levels[PlayerStat.HITPOINTS];
  operate(p, firstTarget, 3);
  assert.equal(stage(p), 7, 'a repeated ordinary pickpocket cannot earn another trial credit');
  assert.equal(count(p, 'coins'), repeatCoins);
  assert.equal(p.stats[PlayerStat.THIEVING], repeatXp);
  assert.equal(repeatHp - p.levels[PlayerStat.HITPOINTS], 2, 'being caught preserves the sourced attack consequence');

  const beforeDistraction = count(p, 'coins');
  openOriginalVillagerCurtain(p); // Ordinary Open makes the enclosed original target reachable before reservation.
  talk(p, 'feud_street_urchin');
  assert.equal(count(p, 'coins'), beforeDistraction, 'the player pays only after accepting the later distraction fee');
  assert.equal(stage(p), 8);
  assert.equal(read(p, 'feud_distracted'), 1);
  assert.equal(read(p, 'feud_urchin_again'), 1);
  assert.equal(read(p, 'feud_var_urchin'), 0, 'distraction is not payment');
  assert.equal(read(p, 'feud_ali_money'), 0, 'the final reward flag belongs only to Morrisane');
  const distracted = feudVillagers().find(npc => npc.getVar(stateVar) === 1 && npc.getVar(ownerVar) === p.uid);
  assert(distracted, 'the real urchin route reserves its target for this player');

  const other = seed(player(), ['blackjack_oak']);
  other.setVarBit(bit('feud_var'), 8);
  other.setVarBit(bit('feud_var_drink'), 3);
  other.setVarBit(bit('feud_var_comp_gangs'), 3);
  const otherCoins = count(other, 'coins'), otherXp = other.stats[PlayerStat.THIEVING];
  const otherHp = other.levels[PlayerStat.HITPOINTS];
  operate(other, distracted, 3);
  assert.equal(stage(other), 8, 'another player cannot spend the distraction checkpoint');
  assert.equal(count(other, 'coins'), otherCoins);
  assert.equal(other.stats[PlayerStat.THIEVING], otherXp);
  assert.equal(otherHp - other.levels[PlayerStat.HITPOINTS], 2, 'the wrong owner is caught rather than rewarded');
  assert.equal(distracted.getVar(ownerVar), p.uid, 'the failed attempt does not steal target ownership');

  p = relog(p);
  assert.equal(stage(p), 8, 'the distraction checkpoint survives save and reload');
  const distractedCoins = count(p, 'coins'), distractedXp = p.stats[PlayerStat.THIEVING];
  operate(p, distracted, 3);
  assert.equal(stage(p), 9);
  assert.equal(count(p, 'coins') - distractedCoins, 3);
  assert.equal(p.stats[PlayerStat.THIEVING] - distractedXp, 80);
  assert.equal(distracted.getVar(stateVar), 0, 'the completed distraction releases its NPC state');
  assert.equal(read(p, 'feud_npc_multi'), 2, 'the second theft exposes the original third villager form');

  const payment = count(p, 'coins');
  talk(p, 'feud_street_urchin', [2, 2]);
  assert.equal(count(p, 'coins'), payment - 10, 'the player pays the stated distraction fee');
  assert.equal(read(p, 'feud_var_urchin'), 1);
  assert.equal(read(p, 'feud_ali_money'), 0, 'paying the urchin cannot consume the final reward');
  const blackjack = talk(p, 'feud_egyptian_minder', [1]);
  assert.match(blackjack.text, /cunning and a bit of brute force/);
  assert.equal(count(p, 'blackjack_oak'), 1);
  wield(p, 'blackjack_oak');
  assert.equal(count(p, 'blackjack_oak'), 0);
  assert.equal(stage(p), 9);

  const secluded = isolatedVillager(p, new Set([distracted]));
  assert(secluded, 'an original packed villager has no candidate under the native witness predicate');
  operate(p, secluded, 4);
  assert.equal(stage(p), 10);
  assert.equal(read(p, 'feud_npc_multi'), 2, 'the second theft exposes the original blackjack interaction form');
  assert.equal(secluded.getVar(stateVar), 2);
  assert.equal(secluded.getVar(ownerVar), p.uid);

  other.setVarBit(bit('feud_var'), 10);
  other.setVarBit(bit('feud_npc_multi'), 2);
  const ownerState = secluded.getVar(stateVar), owner = secluded.getVar(ownerVar);
  wield(other, 'blackjack_oak');
  const wrongOwnerResult = operate(other, secluded, 5);
  assert.equal(stage(other), 10);
  assert.equal(secluded.getVar(stateVar), ownerState);
  assert.equal(secluded.getVar(ownerVar), owner);
  assert.equal(owner, p.uid, 'knock-out remains scoped to the player who lured the target');
  assert.equal(other.stats[PlayerStat.THIEVING], otherXp, 'a wrong-owner knock-out awards no XP');
  assert.equal(wrongOwnerResult.trigger, nativeNpcTriggerName(other, secluded, 5), 'the rejection is reached through the visible opnpc5 dispatcher');

  const koXp = p.stats[PlayerStat.THIEVING];
  remove(p, 'blackjack_oak');
  assert.equal(count(p, 'blackjack_oak'), 1, 'the native worn-item action returns the blackjack to inventory');
  const inventoryOnly = operate(p, secluded, 5);
  assert.equal(inventoryOnly.trigger, nativeNpcTriggerName(p, secluded, 5));
  assert.equal(stage(p), 10, 'an unwielded blackjack cannot knock out a villager');
  assert.equal(secluded.getVar(stateVar), 2);
  assert.equal(secluded.getVar(ownerVar), p.uid);
  assert.equal(secluded.getVar(attackVar), p.uid);
  assert.equal(p.stats[PlayerStat.THIEVING], koXp);
  wield(p, 'blackjack_oak');

  JavaRandom.setSeed(1234);
  operate(p, secluded, 5);
  assert.equal(stage(p), 11, 'a successful roll advances to the unconscious checkpoint');
  assert.equal(secluded.getVar(stateVar), 3);
  assert.equal(secluded.getVar(ownerVar), p.uid);
  assert.notEqual(secluded.getVar(attackVar), p.uid, 'success clears the attack and leaves the villager unconscious');
  assert.equal(p.stats[PlayerStat.THIEVING] - koXp, 80);

  const postKoCoins = count(p, 'coins'), postKoXp = p.stats[PlayerStat.THIEVING];
  operate(p, secluded, 3);
  assert.equal(stage(p), 12);
  assert.equal(count(p, 'coins') - postKoCoins, 3);
  assert.equal(p.stats[PlayerStat.THIEVING], postKoXp, 'the third theft does not repeat the knock-out XP');
  assert.equal(count(p, 'feud_mayors_house_keys'), 0, 'the report is required before keys are granted');
  p = relog(p);
  assert.equal(stage(p), 12, 'the completed third trial survives save and reload');
  talk(p, 'feud_egyptian_minder');
  assert.equal(stage(p), 13);
  assert.equal(count(p, 'feud_mayors_house_keys'), 1);

  p = relog(p);
  assert.equal(stage(p), 13);
  assert.equal(count(p, 'feud_mayors_house_keys'), 1, 'the burglary key survives save and reload');
  p.invDel(inv, obj('feud_mayors_house_keys'), 1);
  talk(p, 'feud_egyptian_minder');
  assert.equal(count(p, 'feud_mayors_house_keys'), 1, 'the operator replaces a lost key without advancing the burglary stage');
  assert.equal(stage(p), 13);
  const stakeout = talk(p, 'feud_egyptian_minder', [1, 2]);
  assert.match(stakeout.text, /stake the place out/);

  p.setVarBit(bit('feud_var'), 14);
  p.setVarBit(bit('feud_var_mayorsdoor'), 0);
  const locked = talk(p, 'feud_egyptian_minder', [2]);
  assert.match(locked.text, /using those keys I gave you to open the door/);
  p.setVarBit(bit('feud_var_mayorsdoor'), 1);
  const inside = talk(p, 'feud_egyptian_minder', [2]);
  assert.match(inside.text, /search the house more thoroughly/);

  p.setVarBit(bit('feud_var'), 15);
  const missingJewels = talk(p, 'feud_egyptian_minder');
  assert.match(missingJewels.text, /misplaced them/);
  assert.equal(stage(p), 15, 'the report cannot advance without the jewels');
  seed(p, ['feud_mayors_jewels']);
  talk(p, 'feud_egyptian_minder');
  assert.equal(count(p, 'feud_mayors_jewels'), 0);
  assert.equal(stage(p), 16);

  p = relog(p);
  assert.equal(stage(p), 16);
  talk(p, 'feud_egyptian_minder', [2]);
  assert.equal(stage(p), 16, 'the operator does not report the traitor before the interview flag exists');
  p.setVarBit(bit('feud_found_trait'), 1);
  talk(p, 'feud_egyptian_minder', [2]);
  assert.equal(stage(p), 17);
  p.setVarBit(bit('feud_var_drink_found'), 1);
  p.setVarBit(bit('feud_var'), 22);
  const poisonNotApplied = talk(p, 'feud_egyptian_minder');
  assert.doesNotMatch(poisonNotApplied.text, /Excellent work/);
  assert.equal(stage(p), 22, 'the Barman drink-identification flag does not prove the drink was poisoned');

  p.setVarBit(bit('feud_var'), 23);
  const deed = talk(p, 'feud_egyptian_minder');
  assert.match(deed.text, /proven yourself to be worthy of the bosses presence/);
  assert.equal(stage(p), 24, 'reporting the poisoned drink advances to the leader-summons checkpoint');
  p.setVarBit(bit('feud_var_menaboss'), 1);
  const atMeeting = talk(p, 'feud_egyptian_minder');
  assert.equal(atMeeting.text, '', 'this slice adds no unsourced Operator wording at the leader-summons checkpoint');
  const preDefeatUrchin = talk(p, 'feud_street_urchin');
  assert.doesNotMatch(preDefeatUrchin.text, /go rob some more people/);
  assert.equal(stage(p), 24, 'a boss summon flag is not a completed fight checkpoint');

  p.setVarBit(bit('feud_var'), 25);
  const defeatReport = talk(p, 'feud_egyptian_minder', [1]);
  assert.match(defeatReport.text, /Why did you have to go and ruin everything/);
  assert.match(talk(p, 'feud_street_urchin').text, /go rob some more people/);
  assert.equal(stage(p), 25);
  const unarmed = player();
  unarmed.setVarBit(bit('feud_var'), 9);
  unarmed.setVarBit(bit('feud_npc_multi'), 2);
  const unarmedTarget = feudVillagers().find(npc => npc !== secluded && npc.getVar(stateVar) === 0 &&
    operationStand(unarmed, npc));
  assert(unarmedTarget, 'an original idle villager placement remains available for a real lure');
  operate(unarmed, unarmedTarget, 4);
  assert.equal(stage(unarmed), 10, 'the sourced Lure action does not require an unsourced weapon gate');
  assert.equal(count(unarmed, 'blackjack_oak'), 0);
  assert.equal(unarmedTarget.getVar(stateVar), 2);
  assert.equal(unarmedTarget.getVar(ownerVar), unarmed.uid);
});

test('urchin refusal and double payment persist without consuming Morrisane final rewards', () => {
  let p = player();
  // Isolated reachable post-distraction state; the linked headed walk earns it normally.
  p.setVarBit(bit('feud_var'), 9);
  p.setVarBit(bit('feud_distracted'), 1);
  p.invAdd(inv, obj('coins'), 100);
  talk(p, 'feud_street_urchin', [1]);
  assert.equal(read(p, 'feud_var_urchin'), 2);
  assert.equal(read(p, 'feud_ali_money'), 0);
  assert.equal(count(p, 'coins'), 100);
  p = relog(p);
  assert.equal(read(p, 'feud_var_urchin'), 2, 'the two-bit payment field retains refusal');
  assert.equal(read(p, 'feud_ali_money'), 0);
  talk(p, 'feud_street_urchin');
  assert.equal(count(p, 'coins'), 80);
  assert.equal(read(p, 'feud_var_urchin'), 1);
  assert.equal(stage(p), 9);
  p = relog(p);
  assert.equal(read(p, 'feud_var_urchin'), 1);
  assert.equal(read(p, 'feud_ali_money'), 0);
  p.setVarBit(bit('feud_var'), 27);
  talk(p, 'feud_ali_m', [1]);
  assert.equal(stage(p), 28);
  assert.equal(read(p, 'feud_ali_money'), 1);
  assert.equal(count(p, 'coins'), 580, 'the final reward still pays its separate 500 coins');
  p.closeModal();
});

urchinSelectionTests();
