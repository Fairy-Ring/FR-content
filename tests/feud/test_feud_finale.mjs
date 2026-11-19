import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PlayerStat, ScriptState, ServerTriggerType, World, count, dialoguePage, engineModule, id,
  map, obj, resumeDialogue, seed
} from '../swamp-caves/runtime.mjs';
import { player } from './player.mjs';
import { actors, bit, finish, operate, read, relog, stage, stand, talk, wield } from './fixture.mjs';

const { default: Environment } = await engineModule('util/Environment.ts');
const points = p => p.getVar(id('VarPlayerType', 'qp'));
const xp = p => p.stats[PlayerStat.THIEVING];
const expectedXp = 150000 * Environment.NODE_XPRATE;
const { NpcStat } = await engineModule('engine/entity/NpcStat.ts');
const { default: JavaRandom } = await engineModule('util/JavaRandom.ts');
const rsbuf = await engineModule('network/rsbuf/index.ts');
const ownerVar = id('VarNpcType', 'npc_attacking_uid');
const ownedChampions = (p, name) => [...World.npcs].filter(n => n.isActive
  && n.baseType === id('NpcType', name) && (n.vars[ownerVar] >>> 0) === p.uid);

function worldTick() {
  for (const p of World.playerLoop.all()) {
    if (p?.isActive) p.lastResponse = p.lastConnected = World.currentTick;
  }
  for (const phase of [
    'processWorld', 'processNpcEventQueue', 'processNpcs', 'processPlayers',
    'processLogouts', 'processLogins', 'processZones', 'processInfo', 'processCleanup'
  ]) World[phase]();
  World.currentTick++;
}

function combatFixture() {
  const p = player();
  // Disclosed isolated starting state and ordinary combat gear; no boss is seeded.
  p.setVarBit(bit('feud_var'), 24);
  p.setVarBit(bit('feud_boss_vis'), 1);
  seed(p, ['rune_scimitar']);
  wield(p, 'rune_scimitar');
  rsbuf.addPlayer(p.slot);
  return p;
}

function killOwnedChampion(p, npc, expectedStage) {
  stand(p, npc);
  assert(!map.isMapBlocked(p.x, p.z, p.level));
  p.clearInteraction();
  assert(p.setInteraction(1, npc, ServerTriggerType.APNPC2));
  assert.match(p.getOpTrigger()?.name ?? '', /^\[opnpc2,feud_/);
  const beforeHp = npc.levels[NpcStat.HITPOINTS];
  const beforeXp = p.stats[PlayerStat.ATTACK];
  const oldMath = Math.random, oldJava = JavaRandom.nextDouble;
  // Deterministic ordinary combat rolls, not injected hits or death dispatches.
  Math.random = JavaRandom.nextDouble = () => 0.999999999999;
  try {
    for (let step = 0; step < 160 && stage(p) !== expectedStage; step++) worldTick();
  } finally {
    Math.random = oldMath;
    JavaRandom.nextDouble = oldJava;
  }
  assert.equal(npc.levels[NpcStat.HITPOINTS], 0, 'real native attacks consume the full original HP');
  assert(beforeHp > 0);
  assert(p.stats[PlayerStat.ATTACK] > beforeXp, 'real player damage awards ordinary combat XP');
  assert.equal(stage(p), expectedStage, 'the owned real death queue advances exactly once');
  finish(p);
  for (let step = 0; step < 8; step++) worldTick();
  assert.equal(stage(p), expectedStage);
  assert(!npc.isActive);
}
const completionFixture = () => {
  const p = player();
  // Isolated final-conversation fixture, not a substitute for the linked whole-quest walk.
  p.setVarBit(bit('feud_var'), 27);
  return p;
};

test('defeating the champion alone cannot skip the mayor or claim Morrisane rewards', () => {
  const p = player();
  p.setVarBit(bit('feud_var'), 26);
  p.setVarBit(bit('feud_var_banditboss'), 1);
  const before = xp(p);
  const result = talk(p, 'feud_ali_m', [1]);
  assert.match(result.text, /Not yet, I'm afraid\./);
  assert.doesNotMatch(result.text, /take the reward anyway/);
  assert.equal(stage(p), 26);
  assert.equal(read(p, 'feud_ali_money'), 0);
  assert.equal(count(p, 'coins'), 0);
  assert.equal(xp(p), before);
  assert.equal(points(p), 0);
});

test('the final report completes stage 28 with one payment, one quest point and 15,000 Thieving XP', () => {
  let p = completionFixture();
  const before = xp(p);
  talk(p, 'feud_ali_m', [1]);
  assert.equal(stage(p), 28);
  assert.equal(read(p, 'feud_ali_money'), 1);
  assert.equal(count(p, 'coins'), 500);
  assert.equal(points(p), 1);
  assert.equal(xp(p), before + expectedXp);
  assert.equal(p.modalMain, id('Component', 'questscroll_death'));
  const text = new Map(p.packets.filter(packet => packet.constructor.name === 'IfSetText')
    .map(packet => [packet.component, packet.text]));
  for (const [component, expected] of [
    ['com_3', "You have completed 'The Feud'"], ['com_9', '1 Quest Point'],
    ['com_10', '15,000 Thieving XP'], ['com_11', 'Blackjack'], ['com_12', 'Desert disguise.']
  ]) assert.equal(text.get(id('Component', `questscroll_death:${component}`)), expected);
  p.closeModal();
  p = relog(p);
  talk(p, 'feud_ali_m');
  assert.equal(stage(p), 28);
  assert.equal(count(p, 'coins'), 500, 'saved completion never pays a second reward');
  assert.equal(points(p), 1);
  assert.equal(xp(p), before + expectedXp);
  assert.equal(p.modalMain, id('Component', 'shop_template'), 'the existing basic stock remains available');
  p.closeModal();
});

test('interrupting after the coin box preserves its payment flag without losing the later completion', () => {
  let p = completionFixture();
  const before = xp(p), n = actors('feud_ali_m')[0];
  p.clearInteraction();
  stand(p, n);
  p.dialogueMark = p.packets.length;
  assert(p.setInteraction(1, n, ServerTriggerType.APNPC1));
  p.processInteraction();
  for (let step = 0; step < 60 && read(p, 'feud_ali_money') === 0; step++) {
    assert.equal(p.activeScript?.execution, ScriptState.PAUSEBUTTON);
    resumeDialogue(p);
  }
  assert.equal(read(p, 'feud_ali_money'), 1);
  assert.match(dialoguePage(p).join(' '), /Ali Morrisane gives you 500 coins\./);
  assert.equal(count(p, 'coins'), 500);
  assert.equal(stage(p), 27);
  assert.equal(xp(p), before);
  assert.equal(points(p), 0);
  p.closeModal();
  p = relog(p);
  assert.equal(read(p, 'feud_ali_money'), 1);
  talk(p, 'feud_ali_m', [1]);
  assert.equal(stage(p), 28);
  assert.equal(count(p, 'coins'), 500, 'resuming the report does not duplicate the pre-interruption payment');
  assert.equal(points(p), 1);
  assert.equal(xp(p), before + expectedXp);
  p.closeModal();
});

test('accepting the final wares offer opens the real shop and still commits all completion rewards once', () => {
  const p = completionFixture(), before = xp(p);
  talk(p, 'feud_ali_m', [2]);
  assert.equal(stage(p), 28);
  assert.equal(read(p, 'feud_ali_money'), 1);
  assert.equal(count(p, 'coins'), 500);
  assert.equal(points(p), 1);
  assert.equal(xp(p), before + expectedXp);
  assert.equal(p.modalMain, id('Component', 'shop_template'));
  assert.equal(p.getVar(id('VarPlayerType', 'shop')), id('InvType', 'feud_morrisanes'));
  p.closeModal();
  talk(p, 'feud_ali_m');
  assert.equal(count(p, 'coins'), 500);
  assert.equal(points(p), 1);
  assert.equal(xp(p), before + expectedXp);
  p.closeModal();
});

test('native owned champion fights, villager forms and the mayor carry the final chain without kill-bit shortcuts', () => {
  const p = combatFixture();
  talk(p, 'feud_menap_boss');
  assert.equal(stage(p), 24, 'summoning is not a kill');
  assert.equal(read(p, 'feud_var_menaboss'), 1, '322 records the summon');
  assert.equal(ownedChampions(p, 'feud_menap_toughguy').length, 1);
  talk(p, 'feud_menap_boss');
  assert.equal(ownedChampions(p, 'feud_menap_toughguy').length, 1, 'repeat Guards does not duplicate an owned fight');
  const tough = ownedChampions(p, 'feud_menap_toughguy')[0];
  const stranger = combatFixture();
  const beforeHp = tough.levels[NpcStat.HITPOINTS];
  operate(stranger, tough, 2);
  assert.equal(tough.levels[NpcStat.HITPOINTS], beforeHp, 'another player cannot start combat with the owned champion');
  assert.equal(stage(stranger), 24);
  stranger.isActive = false;
  World.players[stranger.slot] = null;
  stranger.unlink();
  killOwnedChampion(p, tough, 25);
  assert.equal(read(p, 'feud_boss_vis'), 0);
  assert.equal(read(p, 'feud_boss_vis2'), 0);
  assert.equal(read(p, 'feud_var_menaboss'), 1, 'the summon flag is not repurposed as a death flag');
  assert.equal(read(p, 'feud_bandit_boss_vis'), 0, 'the villager, not the first death, reveals the next leader');
  assert(World.getObj(tough.x, tough.z, tough.level, obj('bones'), p.hash64));
  assert(World.getObj(tough.x, tough.z, tough.level, obj('blackjack_willow'), p.hash64));
  talk(p, 'feud_villager_multi_1', [1]);
  assert.equal(read(p, 'feud_talk_villager'), 1);
  assert.equal(read(p, 'feud_bandit_boss_vis'), 1);
  assert.equal(stage(p), 25);
  talk(p, 'feud_bandit_boss');
  assert.equal(read(p, 'feud_var_banditboss'), 1);
  assert.equal(stage(p), 25, 'the second summon is not a kill either');
  talk(p, 'feud_bandit_boss');
  assert.equal(ownedChampions(p, 'feud_bandit_toughguy').length, 1);
  const champion = ownedChampions(p, 'feud_bandit_toughguy')[0];
  killOwnedChampion(p, champion, 26);
  assert.equal(read(p, 'feud_mayor_invis'), 1, 'the mayor becomes visible only after the villager report');
  assert(World.getObj(champion.x, champion.z, champion.level, obj('bones'), p.hash64));
  assert(World.getObj(champion.x, champion.z, champion.level, obj('adamant_scimitar'), p.hash64));
  talk(p, 'feud_villager_multi_1');
  assert.equal(read(p, 'feud_talk_villager'), 2);
  assert.equal(read(p, 'feud_mayor_invis'), 0);
  talk(p, 'feud_mayor');
  assert.equal(stage(p), 27);
  assert.equal(read(p, 'feud_bandit_boss_vis'), 0);
  const beforeRewardXp = xp(p);
  talk(p, 'feud_ali_m', [1]);
  assert.equal(stage(p), 28);
  assert.equal(count(p, 'coins'), 500);
  assert.equal(points(p), 1);
  assert.equal(xp(p), beforeRewardXp + expectedXp);
  p.closeModal();
});

test('leaving and rejoining preserves summon progress but a stale owned opponent cannot award a kill', () => {
  let p = combatFixture();
  talk(p, 'feud_menap_boss');
  const old = ownedChampions(p, 'feud_menap_toughguy')[0];
  const oldUid = p.uid;
  p.isActive = false;
  World.players[p.slot] = null;
  for (let step = 0; step < 4; step++) worldTick();
  assert(!old.isActive, 'the real NPC timer removes an opponent while its owner is logged out');
  p = relog(p);
  rsbuf.addPlayer(p.slot);
  assert.equal(p.uid, oldUid, 'the isolated save/load fixture deliberately retains its original UID');
  assert.equal(stage(p), 24);
  assert.equal(read(p, 'feud_var_menaboss'), 1);
  talk(p, 'feud_menap_boss');
  assert.equal(ownedChampions(p, 'feud_menap_toughguy').length, 1, 'the sourced repeat summon restores the fight');
  assert.equal(stage(p), 24);
  p.isActive = false;
  World.players[p.slot] = null;
  p.unlink();
  for (let step = 0; step < 4; step++) worldTick();
});

test('the original Mayor keeps the pre-rewrite standard and state-specific conversations', () => {
  const p = player();
  for (const [checkpoint, expected] of [
    [0, /gateway to Menaphos and Al-Kharid/],
    [5, /muggings and burglaries happening in broad daylight/],
    [15, /even my own house was robbed/],
    [25, /Do you understand the concept of consequences/],
    [27, /Have you spoken to Ali Morrisane yet/]
  ]) {
    p.setVarBit(bit('feud_var'), checkpoint);
    const result = talk(p, 'feud_mayor');
    assert.match(result.text, expected);
    assert.doesNotMatch(result.text, /Hakeem|new citizen/);
    assert.equal(stage(p), checkpoint, 'ordinary and repeat talk does not advance the quest');
    if (checkpoint === 0) assert.match(result.text, /I'm looking for someone called Ali/);
  }
});

test('all original villager families expose the fourteen complete ordinary exchanges and topic choices', () => {
  const expected = [
    /Nice weather we've been having/, /I don't want to help with your scheme/,
    /Very well, thank you/, /there are plenty of shops and market stalls/,
    /There are a lot of them around here/, /None of your business/,
    /Get out of my way/, /Not too bad, thanks/,
    /wolves, snakes, and even wild Ugthanki/, /I'm sorry, I can't help you there/,
    /there are plenty of shops and market stalls/, /Do I know you/,
    /I'm very well thank you/, /Ah, a most noble profession/
  ];
  const oldRandom = JavaRandom.nextDouble;
  try {
    for (const family of ['feud_villager_multi_1', 'feud_villager_multi_2', 'feud_villager_multi_3']) {
      const p = player();
      for (let exchange = 0; exchange < expected.length; exchange++) {
        JavaRandom.nextDouble = () => (exchange + 0.25) / expected.length;
        const result = talk(p, family, exchange === 10 ? [1] : []);
        assert.match(result.text, /Hello, how's it going/);
        assert.match(result.text, expected[exchange]);
        assert.equal(stage(p), 0);
        assert.equal(read(p, 'feud_talk_villager'), 0, 'ordinary exchanges cannot reveal a quest leader');
        assert.equal(p.modalMain, -1, 'the villager offers information, not an unsupported shop');
      }
      JavaRandom.nextDouble = () => 10.25 / expected.length;
      assert.match(talk(p, family, [2]).text, /I'm sorry, I can't help you there/);
      assert.match(talk(p, family, [3]).text, /wolves, snakes, and even wild Ugthanki/);
    }
  } finally {
    JavaRandom.nextDouble = oldRandom;
  }
});
