import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PlayerStat, World, count, engineModule, id, inv, obj, remove, seed
} from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';
import {
  actors, begin, bit, buyReceipts, deliver, drink, hasWitness, nativeNpcTriggerName, operate,
  read, relog, stage, talk, wield
} from './fixture.mjs';

const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const stateVar = id('VarNpcType', 'feud_villager_state');
const ownerVar = id('VarNpcType', 'feud_villager_owner');
const attackVar = id('VarNpcType', 'npc_attacking_uid');
const villagerForms = new Set([
  'feud_villager_multi_1', 'feud_villager_multi_2', 'feud_villager_multi_3',
  'feud_villager_1_1', 'feud_villager_1_2', 'feud_villager_1_3',
  'feud_villager_2_1', 'feud_villager_2_2', 'feud_villager_2_3',
  'feud_villager_3_1', 'feud_villager_3_2', 'feud_villager_3_3'
].map(name => id('NpcType', name)));
const feudVillagers = () => [...World.npcs].filter(npc => npc.isActive &&
  (villagerForms.has(npc.baseType) || villagerForms.has(npc.type)));
function isolatedVillager(excluded) {
  return feudVillagers().find(npc => !excluded.has(npc) && npc.getVar(stateVar) === 0 && !hasWitness(npc));
}

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

  const secluded = isolatedVillager(new Set([distracted]));
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
  assert.equal(wrongOwnerResult.trigger, nativeNpcTriggerName(secluded, 5), 'the rejection is reached through the visible opnpc5 dispatcher');

  const koXp = p.stats[PlayerStat.THIEVING];
  remove(p, 'blackjack_oak');
  assert.equal(count(p, 'blackjack_oak'), 1, 'the native worn-item action returns the blackjack to inventory');
  const inventoryOnly = operate(p, secluded, 5);
  assert.equal(inventoryOnly.trigger, nativeNpcTriggerName(secluded, 5));
  assert.equal(stage(p), 10, 'an unwielded blackjack cannot knock out a villager');
  assert.equal(secluded.getVar(stateVar), 2);
  assert.equal(secluded.getVar(ownerVar), p.uid);
  assert.equal(secluded.getVar(attackVar), p.uid);
  assert.equal(p.stats[PlayerStat.THIEVING], koXp);
  wield(p, 'blackjack_oak');
  const originalDraw = JavaRandom.nextDouble;
  try {
    JavaRandom.nextDouble = () => 0.999;
    operate(p, secluded, 5);
  } finally {
    JavaRandom.nextDouble = originalDraw;
  }
  assert.equal(stage(p), 10, 'a failed blackjack roll does not advance the quest');
  assert.equal(secluded.getVar(stateVar), 2, 'a failed attempt leaves the lured target available');
  assert.equal(secluded.getVar(ownerVar), p.uid);
  assert.equal(secluded.getVar(attackVar), p.uid, 'a failed attempt retains the NPC attack consequence');
  assert.equal(p.stats[PlayerStat.THIEVING], koXp, 'a failed attempt awards no Thieving XP');

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
  const unarmedTarget = feudVillagers().find(npc => npc !== secluded && npc.getVar(stateVar) === 0);
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
