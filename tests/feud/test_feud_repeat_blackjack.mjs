import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  PlayerStat, ServerTriggerType, World, contentRoot, count, engineModule, id,
  inv, obj, seed, types
} from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';
import {
  actors, begin, bit, buyReceipts, deliver, drink, finish, hasWitness, isWitness,
  nativeNpcTriggerName, operate, operateHere, operationStand, read, stand, stage, talk, tickThrough, wield, worldTick
} from './fixture.mjs';
import { followToSeclusion } from './follow.mjs';

const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { NpcMode } = await engineModule('engine/entity/NpcMode.ts');
const stateVar = id('VarNpcType', 'feud_villager_state');
const ownerVar = id('VarNpcType', 'feud_villager_owner');
const deadlineVar = id('VarNpcType', 'feud_villager_deadline');
const attackVar = id('VarNpcType', 'npc_attacking_uid');
const aggressiveVar = id('VarNpcType', 'npc_aggressive_player');
const stunnedVar = id('VarPlayerType', 'stunned');
const feudConfigPath = path.join(contentRoot, 'scripts/quests/quest_feud/configs/feud.npc');

const xp = p => p.stats[PlayerStat.THIEVING];
function completePlayer(level = 1) {
  const p = player();
  p.setVarBit(bit('feud_var'), 28);
  // Stage 28 retains the earned third-villager morph for visible post-quest options.
  p.setVarBit(bit('feud_npc_multi'), 2);
  p.setLevel(PlayerStat.THIEVING, level);
  return p;
}

const nativeSetupWaitTicks = 512; // Same bounded native-geometry wait as follow.mjs, not a gameplay timeout.
function findTarget(p, name, predicate) {
  for (let ticks = 0; ticks <= nativeSetupWaitTicks; ticks++) {
    const target = actors(name).find(npc => npc.getVar(stateVar) === 0 &&
      predicate(npc) && operationStand(p, npc));
    if (target) return target;
    if (ticks < nativeSetupWaitTicks) worldTick();
  }
}
function isolatedTarget(p, name, excluded = new Set()) {
  return findTarget(p, name, npc => !excluded.has(npc) && !hasWitness(p, npc));
}

function withRandom(value, action) {
  const previous = JavaRandom.nextDouble;
  JavaRandom.nextDouble = () => value;
  try { return action(); } finally { JavaRandom.nextDouble = previous; }
}

function startOperation(p, npc, option, atCurrentPosition = false) {
  p.clearInteraction();
  if (!atCurrentPosition) stand(p, npc);
  assert(p.setInteraction(1, npc, ServerTriggerType.APNPC1 + option - 1),
    'ordinary engine interaction is accepted');
  assert(p.inOperableDistance(npc), 'the player can operate from the current native position');
  const trigger = p.getOpTrigger();
  assert(trigger, 'production visible-form dispatcher finds a compiled handler');
  p.dialogueMark = p.packets.length;
  p.processInteraction();
  return trigger.name;
}


function npcConfigBlock(text, name) {
  const marker = `[${name}]`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `Feud NPC config contains ${name}`);
  return text.slice(start + marker.length).split('\n[')[0];
}

// Period XP is represented in tenths. Later Thieving_training rev15400774 is
// CANDIDATE only for an unwitnessed Bandit/Thug KO failure; see the source manifest's history limits.
test('pre-Feud gates preserve the native first trial and its one-time rewards', () => {
  const blocked = player();
  blocked.setVarBit(bit('feud_var'), 27);
  blocked.setVarBit(bit('feud_npc_multi'), 2);
  blocked.setLevel(PlayerStat.THIEVING, 65);
  const bandit = actors('feud_arabian_guard2_multi').find(npc => npc.getVar(stateVar) === 0);
  assert(bandit, 'the original placed Bandit41 is available');
  const before = { coins: count(blocked, 'coins'), xp: xp(blocked), hp: blocked.levels[PlayerStat.HITPOINTS] };
  const blockedPick = operate(blocked, bandit, 3);
  assert.equal(blockedPick.trigger, nativeNpcTriggerName(blocked, bandit, 3));
  assert.equal(stage(blocked), 27, 'Bandit theft remains locked until the complete checkpoint');
  assert.equal(count(blocked, 'coins'), before.coins);
  assert.equal(xp(blocked), before.xp);
  assert.equal(blocked.levels[PlayerStat.HITPOINTS], before.hp);
  assert.equal(bandit.getVar(stateVar), 0);

  const p = player();
  p.setLevel(PlayerStat.THIEVING, 29);
  p.invAdd(inv, obj('coins'), 100);
  begin(p);
  drink(p);
  talk(p, 'feud_egyptian_doorman_multi');
  talk(p, 'feud_arabian_guard_multi');
  buyReceipts(p);
  deliver(p);
  talk(p, 'feud_egyptian_minder', [1, 2]);
  assert.equal(stage(p), 6);

  const villager = actors('feud_villager_multi_1')[0];
  const refused = { coins: count(p, 'coins'), xp: xp(p), hp: p.levels[PlayerStat.HITPOINTS] };
  const refusal = operate(p, villager, 3);
  assert.equal(refusal.trigger, nativeNpcTriggerName(p, villager, 3));
  assert.match(refusal.text, /level 30 thieving/i);
  assert.equal(stage(p), 6);
  assert.equal(read(p, 'feud_npc_multi'), 0);
  assert.equal(count(p, 'coins'), refused.coins);
  assert.equal(xp(p), refused.xp);
  assert.equal(p.levels[PlayerStat.HITPOINTS], refused.hp);

  p.setLevel(PlayerStat.THIEVING, 30);
  const first = { coins: count(p, 'coins'), xp: xp(p) };
  operate(p, villager, 3);
  assert.equal(stage(p), 7, 'the original first theft still grants its trial checkpoint once');
  assert.equal(count(p, 'coins') - first.coins, 3);
  assert.equal(xp(p) - first.xp, 80);
  const repeated = { coins: count(p, 'coins'), xp: xp(p), hp: p.levels[PlayerStat.HITPOINTS] };
  operate(p, villager, 3);
  assert.equal(stage(p), 7, 'the trial checkpoint does not advance twice');
  assert.equal(count(p, 'coins'), repeated.coins, 'the trial reward is not duplicated');
  assert.equal(xp(p), repeated.xp, 'the trial XP is not duplicated');
  assert.equal(repeated.hp - p.levels[PlayerStat.HITPOINTS], 2);
});

test('post-Feud normal pickpocket uses the period Bandit and Thug rows', () => {
  const p = completePlayer(44);
  const bandit41 = actors('feud_arabian_guard2_multi')[0];
  const refused41 = { coins: count(p, 'coins'), xp: xp(p), hp: p.levels[PlayerStat.HITPOINTS] };
  const low41 = operate(p, bandit41, 3);
  assert.equal(low41.trigger, nativeNpcTriggerName(p, bandit41, 3));
  assert.match(low41.text, /level 45 thieving/i);
  assert.equal(count(p, 'coins'), refused41.coins);
  assert.equal(xp(p), refused41.xp);
  assert.equal(p.levels[PlayerStat.HITPOINTS], refused41.hp);
  p.setLevel(PlayerStat.THIEVING, 45);
  const before41 = { coins: count(p, 'coins'), xp: xp(p) };
  withRandom(0, () => operate(p, bandit41, 3));
  assert.equal(count(p, 'coins') - before41.coins, 40);
  assert.equal(xp(p) - before41.xp, 650, 'Bandit41 receives period 65 XP');

  const bandit56 = actors('feud_arabian_guard_multi')[0];
  p.setLevel(PlayerStat.THIEVING, 51);
  const refused56 = { coins: count(p, 'coins'), xp: xp(p) };
  const low56 = operate(p, bandit56, 3);
  assert.match(low56.text, /level 52 thieving/i);
  assert.equal(count(p, 'coins'), refused56.coins);
  assert.equal(xp(p), refused56.xp);
  p.setLevel(PlayerStat.THIEVING, 52);
  const before56 = { coins: count(p, 'coins'), xp: xp(p) };
  withRandom(0, () => operate(p, bandit56, 3));
  assert.equal(count(p, 'coins') - before56.coins, 50);
  assert.equal(xp(p) - before56.xp, 840, 'Bandit56 receives period 84 XP');

  const thug = actors('feud_egyptian_doorman_multi')[0];
  p.setLevel(PlayerStat.THIEVING, 64);
  const refusedThug = { coins: count(p, 'coins'), xp: xp(p) };
  const lowThug = operate(p, thug, 3);
  assert.match(lowThug.text, /level 65 thieving/i);
  assert.equal(count(p, 'coins'), refusedThug.coins);
  assert.equal(xp(p), refusedThug.xp);
  p.setLevel(PlayerStat.THIEVING, 65);
  const beforeThug = { coins: count(p, 'coins'), xp: xp(p) };
  withRandom(0, () => operate(p, thug, 3));
  assert.equal(count(p, 'coins') - beforeThug.coins, 50);
  assert.equal(xp(p) - beforeThug.xp, 1375, 'Thug receives period 137.5 XP');
  const failedPick = completePlayer(65);
  const caught = { coins: count(failedPick, 'coins'), xp: xp(failedPick), hp: failedPick.levels[PlayerStat.HITPOINTS] };
  withRandom(0.999, () => operate(failedPick, bandit41, 3));
  assert.equal(count(failedPick, 'coins'), caught.coins);
  assert.equal(xp(failedPick), caught.xp);
  assert.equal(caught.hp - failedPick.levels[PlayerStat.HITPOINTS], 5, 'ordinary Bandit pick failure uses the period 5 HP');
  assert.equal(stage(p), 28, 'repeat thefts do not write quest progress');
});

test('post-Feud villagers use a wielded blackjack, award no repeat-pick XP, and wake on their NPC timer', () => {
  const p = seed(completePlayer(30), ['blackjack_oak']);
  const awake = findTarget(p, 'feud_villager_multi_1', () => true);
  assert(awake, 'an original placed villager is idle');
  const caught = { coins: count(p, 'coins'), xp: xp(p), hp: p.levels[PlayerStat.HITPOINTS] };
  const awakePick = operate(p, awake, 3);
  assert.equal(awakePick.trigger, nativeNpcTriggerName(p, awake, 3));
  assert.equal(count(p, 'coins'), caught.coins);
  assert.equal(xp(p), caught.xp);
  assert.equal(caught.hp - p.levels[PlayerStat.HITPOINTS], 2, 'awake villagers use the period caught damage');

  const target = isolatedTarget(p, 'feud_villager_multi_2', new Set([awake]));
  assert(target, 'a real placed villager has no candidate under the native witness predicate');
  const lure = operate(p, target, 4);
  assert.equal(lure.trigger, nativeNpcTriggerName(p, target, 4));
  assert.equal(target.getVar(stateVar), 2);
  assert.equal(target.getVar(ownerVar), p.uid);
  assert.equal(target.getVar(attackVar), p.uid);
  assert.equal(target.targetOp, NpcMode.PLAYERFOLLOW, 'the real NPC enters PLAYERFOLLOW');
  assert.equal(target.target, p, 'the real NPC follows the owning player');

  const noWeaponXp = xp(p);
  const inventoryOnly = operate(p, target, 5);
  assert.equal(inventoryOnly.trigger, nativeNpcTriggerName(p, target, 5));
  assert.equal(target.getVar(stateVar), 2, 'an inventory-only blackjack cannot knock out a villager');
  assert.equal(xp(p), noWeaponXp);
  wield(p, 'blackjack_oak');
  const koXp = xp(p), coins = count(p, 'coins');
  withRandom(0, () => operate(p, target, 5));
  assert.equal(target.getVar(stateVar), 3);
  assert.equal(target.getVar(ownerVar), p.uid);
  assert.equal(xp(p) - koXp, 80, 'the successful villager KO awards period 8 XP');
  assert.equal(stage(p), 28, 'the repeat KO does not write a trial checkpoint');

  const unconsciousXp = xp(p);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = operate(p, target, 3);
    assert.equal(result.trigger, nativeNpcTriggerName(p, target, 3));
    assert.equal(count(p, 'coins') - coins, 3 * attempt, 'unconscious villagers give a few coins');
    assert.equal(xp(p), unconsciousXp, 'an unconscious villager pick grants no XP');
    assert.equal(stage(p), 28);
  }
  const deadline = target.getVar(deadlineVar);
  assert(deadline > World.currentTick);
  tickThrough(deadline);
  assert.equal(target.getVar(stateVar), 0, 'the shared NPC queue wakes the unconscious target');
  assert.equal(target.getVar(ownerVar), -1);
  assert.equal(target.getVar(deadlineVar), 0);

  const relured = operate(p, target, 4);
  assert.equal(relured.trigger, nativeNpcTriggerName(p, target, 4));
  withRandom(0, () => operate(p, target, 5));
  const wakeDeadline = target.getVar(deadlineVar);
  const beforeWakePick = { coins: count(p, 'coins'), xp: xp(p) };
  assert(wakeDeadline > World.currentTick);
  tickThrough(wakeDeadline - 1);
  const woke = { trigger: worldTick(() => startOperation(p, target, 3, true)) };
  finish(p);
  assert.equal(woke.trigger, nativeNpcTriggerName(p, target, 3));
  assert.equal(target.getVar(stateVar), 0);
  assert.equal(target.getVar(aggressiveVar), p.uid, 'picking as the villager wakes schedules its attack');
  assert.equal(count(p, 'coins'), beforeWakePick.coins, 'a waking interruption grants no coins');
  assert.equal(xp(p), beforeWakePick.xp, 'a waking interruption grants no XP');
});

test('the original Trade option sells the period willow through the retained conversation', () => {
  const source = readFileSync(feudConfigPath, 'utf8');
  const sellerMulti = npcConfigBlock(source, 'feud_black_jack_seller_multi');
  assert.match(sellerMulti, /^multivar=feud_var$/m);
  assert.match(sellerMulti, /^multinpc=28,feud_bjseller$/m, 'the placed seller appears at the completion morph');
  const sellerForm = npcConfigBlock(source, 'feud_bjseller');
  assert.match(sellerForm, /^name=Blackjack seller$/m);
  assert.match(sellerForm, /^op1=Talk-to$/m);
  assert.match(sellerForm, /^op3=Trade$/m);
  const seller = actors('feud_black_jack_seller_multi').find(npc => npc.startX === 3351 && npc.startZ === 2971);
  const kebab = actors('feud_kebabman').find(npc => npc.startX === 3352 && npc.startZ === 2974);
  assert(seller, 'the named blackjack seller is at the original map placement');
  assert(kebab, 'the kebab seller is the adjacent mapped reference point');
  const purchase = (p, choice = "I'll take it.") => {
    const result = operate(p, seller, 3, [choice]);
    assert.equal(result.trigger, nativeNpcTriggerName(p, seller, 3));
    assert.notEqual(p.modalMain, id('Component', 'shop_template'), 'Trade opens a conversation, not a shop');
    assert.match(result.text, /I've only got one model in stock at the moment\./);
    assert.match(result.text, /willow black jack which I'd be willing to let go for 600 coins\./);
    assert.doesNotMatch(result.text, /A willow blackjack costs|Buy one\.|Maybe later\./,
      'the removed invented seller lines do not survive');
    return result;
  };
  const short = completePlayer(64);
  short.invAdd(inv, obj('coins'), 599);
  const refused = purchase(short);
  assert.equal(count(short, 'coins'), 599);
  assert.equal(count(short, 'blackjack_willow'), 0);
  assert(short.messages.includes('You can not afford that.'));
  assert.match(refused.text, /Can I get that on credit\?/);
  assert.match(refused.text, /Get out of here!/);

  const decline = completePlayer(64);
  decline.invAdd(inv, obj('coins'), 600);
  assert.match(purchase(decline, 'No thanks.').text, /No thanks\./);
  assert.equal(count(decline, 'coins'), 600);
  assert.equal(count(decline, 'blackjack_willow'), 0);

  const full = completePlayer(64);
  full.invAdd(inv, obj('blackjack_oak'), 27);
  full.invAdd(inv, obj('coins'), 601);
  assert.equal(full.getInventory(inv).items.filter(Boolean).length, 28);
  purchase(full);
  assert.equal(count(full, 'coins'), 601);
  assert.equal(count(full, 'blackjack_willow'), 0);
  assert.equal(full.messages.length, 0, 'no unsourced full-inventory message is printed');

  const exact = completePlayer(64);
  exact.invAdd(inv, obj('blackjack_oak'), 27);
  exact.invAdd(inv, obj('coins'), 600);
  purchase(exact);
  assert.equal(count(exact, 'coins'), 0);
  assert.equal(count(exact, 'blackjack_willow'), 1, 'the final coin stack frees the purchase slot');
  assert.equal(exact.getInventory(inv).items.filter(Boolean).length, 28);

  const repeat = completePlayer(64);
  repeat.invAdd(inv, obj('coins'), 1200);
  for (let bought = 1; bought <= 2; bought++) {
    purchase(repeat);
    assert.equal(count(repeat, 'coins'), 1200 - 600 * bought);
    assert.equal(count(repeat, 'blackjack_willow'), bought, 'each complete exchange sells one sourced willow');
  }
  assert.equal(stage(repeat), 28);
});

test('the purchased willow is usable and the Thug applies its period level and KO gates', () => {
  const p = completePlayer(64);
  p.invAdd(inv, obj('coins'), 600);
  operate(p, actors('feud_black_jack_seller_multi')[0], 3, ["I'll take it."]);
  wield(p, 'blackjack_willow');

  const thug = findTarget(p, 'feud_egyptian_doorman_multi', npc => hasWitness(p, npc));
  assert(thug, 'an original Menaphite Thug has a path-checked native operation stand');
  assert(hasWitness(p, thug), 'the original Thug begins visible to a nearby person');
  const lure = operate(p, thug, 4);
  assert.equal(lure.trigger, nativeNpcTriggerName(p, thug, 4));
  assert.equal(thug.getVar(stateVar), 2);
  followToSeclusion(p, thug);
  const beforeGate = xp(p);
  operateHere(p, thug, 5);
  assert.equal(thug.getVar(stateVar), 2, 'level 64 cannot knock out the level-65 Thug');
  assert.equal(xp(p), beforeGate);
  p.setLevel(PlayerStat.THIEVING, 65);
  const beforeKo = xp(p);
  withRandom(0, () => operateHere(p, thug, 5));
  assert.equal(thug.getVar(stateVar), 3);
  assert.equal(xp(p) - beforeKo, 200, 'the successful Thug KO awards period 20 XP');

  const beforePick = { coins: count(p, 'coins'), xp: xp(p) };
  for (let attempt = 1; attempt <= 2; attempt++) {
    withRandom(0, () => operateHere(p, thug, 3));
    assert.equal(count(p, 'coins') - beforePick.coins, 50 * attempt);
    assert.equal(xp(p) - beforePick.xp, 1375 * attempt, 'Thug normal-pick XP is retained while unconscious');
  }
  const deadline = thug.getVar(deadlineVar);
  assert(deadline > World.currentTick);
  tickThrough(deadline);
  assert.equal(thug.getVar(stateVar), 0, 'the real Thug also wakes through the shared bounded queue');
  assert.equal(stage(p), 28);
});

test('Bandit41 repeat KO accepts wielded oak, applies only sourced failure outcomes, and awards 10 XP', () => {
  const p = seed(completePlayer(45), ['blackjack_oak']);
  const target = isolatedTarget(p, 'feud_arabian_guard2_multi');
  assert(target, 'an original Bandit41 placement has no candidate under the native witness predicate');
  const lure = operate(p, target, 4);
  assert.equal(lure.trigger, nativeNpcTriggerName(p, target, 4));
  assert.equal(target.getVar(stateVar), 2);
  assert.equal(target.targetOp, NpcMode.PLAYERFOLLOW);
  assert.equal(target.target, p);

  const inventoryOnlyXp = xp(p);
  operate(p, target, 5);
  assert.equal(target.getVar(stateVar), 2, 'an inventory-only blackjack is refused');
  assert.equal(xp(p), inventoryOnlyXp);
  wield(p, 'blackjack_oak');

  const beforeKo = xp(p);
  withRandom(0, () => operate(p, target, 5));
  assert.equal(target.getVar(stateVar), 3);
  assert.equal(xp(p) - beforeKo, 100, 'Bandit KO adds period 10 XP');
  const beforePicks = { coins: count(p, 'coins'), xp: xp(p) };
  for (let attempt = 1; attempt <= 2; attempt++) {
    withRandom(0, () => operate(p, target, 3));
    assert.equal(count(p, 'coins') - beforePicks.coins, 40 * attempt);
    assert.equal(xp(p) - beforePicks.xp, 650 * attempt, 'each normal Bandit41 pick retains its period XP');
  }
  const deadline = target.getVar(deadlineVar);
  assert(deadline > World.currentTick);
  tickThrough(deadline);
  assert.equal(target.getVar(stateVar), 0, 'the Bandit wakes through the bounded NPC queue');

  const relure = operate(p, target, 4);
  assert.equal(relure.trigger, nativeNpcTriggerName(p, target, 4));
  const beforeFailure = {
    hp: p.levels[PlayerStat.HITPOINTS], xp: xp(p), coins: count(p, 'coins'),
    stunned: p.getVar(stunnedVar)
  };
  withRandom(0.999, () => operate(p, target, 5));
  assert.equal(target.getVar(stateVar), 2, 'a failed KO keeps the lured target available');
  assert.equal(target.getVar(aggressiveVar), p.uid, 'CANDIDATE failed-KO consequence queues ordinary retaliation');
  assert.equal(p.levels[PlayerStat.HITPOINTS], beforeFailure.hp, 'the unwitnessed failure adds no unsourced HP damage');
  assert.equal(p.getVar(stunnedVar), beforeFailure.stunned, 'the unwitnessed failure adds no unsourced stun');
  assert.equal(xp(p), beforeFailure.xp);
  assert.equal(count(p, 'coins'), beforeFailure.coins);
  assert.equal(stage(p), 28, 'repeat KO cannot duplicate trial progress or rewards');
});

test('witnessed Bandit KO applies the period 4 HP, stun and attack outcome', () => {
  const nearbyBanditTypes = new Set([
    id('NpcType', 'feud_arabian_guard_multi'), id('NpcType', 'feud_arabian_guard2_multi')
  ]);
  const p = seed(completePlayer(56), ['blackjack_oak']);
  const target = actors('feud_arabian_guard_multi').find(npc => npc.getVar(stateVar) === 0 &&
    [...World.npcs].some(other => nearbyBanditTypes.has(other.baseType) && isWitness(p, npc, other)));
  assert(target, 'an original Bandit placement has a nearby Bandit satisfying the native witness predicate');
  wield(p, 'blackjack_oak');
  const beforeXp = xp(p), beforeCoins = count(p, 'coins');
  const lure = operate(p, target, 4);
  assert.equal(lure.trigger, nativeNpcTriggerName(p, target, 4));
  assert.equal(target.getVar(stateVar), 2);
  const hp = p.levels[PlayerStat.HITPOINTS], startTick = World.currentTick;
  const trigger = withRandom(0, () => startOperation(p, target, 5));
  assert.equal(trigger, nativeNpcTriggerName(p, target, 5));
  assert.equal(target.getVar(stateVar), 0, 'a witnessed attempt releases the lure before retaliation');
  assert.equal(hp - p.levels[PlayerStat.HITPOINTS], 4, 'witnessed Bandit KO costs the period 4 HP');
  assert(p.getVar(stunnedVar) > startTick, 'the player receives a bounded stun before the queued attack');
  assert(p.getVar(stunnedVar) > World.currentTick, 'the player remains stunned until the delayed retaliation');
  finish(p);
  assert.equal(target.getVar(aggressiveVar), p.uid, 'the witnessed Bandit retaliates after the stun');
  assert.equal(xp(p), beforeXp, 'witnessed KO grants no success XP');
  assert.equal(count(p, 'coins'), beforeCoins);
  assert.equal(stage(p), 28);
});
