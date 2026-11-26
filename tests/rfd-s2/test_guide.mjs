#!/usr/bin/env node
// Built-pack RFD Guide route: native guest/NPC interactions, all three retained quizzes, cake and reward.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PlayerStat, nativeLoc, nativeNpc, operate, talk, useItems, useLoc,
  run, player, give, count, bit, setBit, setVar, id, bank, remove, skill, text, types
} from '../rfd-s1/runtime.mjs';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const config = path.join(content, 'scripts/quests/quest_100/configs');
const guideConstants = fs.readFileSync(path.join(config, 'rfd_guide.constant'), 'utf8');
const hubConstants = fs.readFileSync(path.join(config, 'rfd_hub.constant'), 'utf8');
const questConstants = fs.readFileSync(path.join(content, 'scripts/general/configs/quest.constant'), 'utf8');
function constant(source, name) {
  const match = source.match(new RegExp(`^\\^${name}\\s*=\\s*(\\d+)\\s*$`, 'm'));
  assert(match, `checked-out ${name} constant exists`);
  return Number(match[1]);
}
const guideStage = name => constant(guideConstants, name);
const hubStage = name => constant(hubConstants, name);
const questStage = name => constant(questConstants, name);
const guideLoc = nativeLoc('hundred_guide_base');
const traiborn = nativeNpc('traiborn', rows => rows.find(row => row.level === 1 && row.x === 3112 && row.z === 3162));
const range = nativeLoc('cooksquestrange');

function seedRequirements(p) {
  for (const [variable, constantName] of [
    ['chompybird', 'chompybird_complete'],
    ['biohazard', 'biohazard_complete'],
    ['demonstart', 'demon_complete'],
    ['murderquest', 'murder_complete'],
    ['druidspirit', 'druidspirit_complete'],
    ['priestperil', 'priestperil_complete'],
    ['prieststart', 'priest_complete'],
    ['ballquest', 'ball_complete']
  ]) {
    setVar(p, variable, questStage(constantName));
  }
}
function seedFeast(p) {
  setBit(p, 'hundred_main_quest_var', hubStage('rfd_frozen'));
  setBit(p, '100guidevisible', 1);
  setVar(p, 'cookquest', questStage('cook_complete'));
}
function startFixture() {
  const p = player();
  seedRequirements(p);
  seedFeast(p);
  skill(p, 'cooking', 40);
  give(p, 'egg');
  give(p, 'bucket_milk');
  give(p, 'pot_flour');
  give(p, 'cake_tin');
  operate(p, guideLoc, 1);
  assert.equal(bit(p, '100guide_prog'), guideStage('rfd_guide_started'));
  assert.match(text(p), /Traiborn the wizard/i);
  return p;
}

// The RFD hook must leave ordinary Wizards' Tower dialogue available outside its active route.
for (const phase of ['before-RFD', 'before-Inspect', 'after-rescue']) {
  const ordinary = player();
  if (phase !== 'before-RFD') {
    seedRequirements(ordinary);
    seedFeast(ordinary);
  }
  if (phase === 'after-rescue') {
    setBit(ordinary, '100guide_prog', hubStage('rfd_guest_complete'));
    setBit(ordinary, '100guidevisible', 0);
  }
  talk(ordinary, traiborn, [2, 2]);
  assert.match(text(ordinary), /Ello young thingummywut/i, phase);
  assert.match(text(ordinary), /Cheerio then/i, phase);
  assert.equal(count(ordinary, '100guide_egg'), 0, phase);
}

// The source gives eight quest gates and level 40 Cooking; neither a guest marker nor level alone skips them.
for (const [variable, complete] of [
  ['chompybird', 'chompybird_complete'], ['biohazard', 'biohazard_complete'],
  ['demonstart', 'demon_complete'], ['murderquest', 'murder_complete'],
  ['druidspirit', 'druidspirit_complete'], ['priestperil', 'priestperil_complete'],
  ['prieststart', 'priest_complete'], ['ballquest', 'ball_complete']
]) {
  const missingQuest = player();
  seedRequirements(missingQuest);
  seedFeast(missingQuest);
  skill(missingQuest, 'cooking', 40);
  setVar(missingQuest, variable, questStage(complete) - 1);
  operate(missingQuest, guideLoc, 1);
  assert.equal(bit(missingQuest, '100guide_prog'), 0, `${variable} must be complete before the Guide route`);
}
const lowCooking = player();
seedRequirements(lowCooking);
seedFeast(lowCooking);
skill(lowCooking, 'cooking', 39);
operate(lowCooking, guideLoc, 1);
assert.equal(bit(lowCooking, '100guide_prog'), 0, 'level 39 Cooking does not start the Guide route');

const p = startFixture();
assert.equal(guideStage('rfd_guide_flour_correct'), 3, 'the source requires three correct flour answers');

// Egg identities: one correct answer completes the egg quiz; wrong answers rotate through the retained identities.
talk(p, traiborn, [2]);
assert.equal(bit(p, '100guide_eggdone'), 0);
assert.equal(count(p, 'egg'), 1, 'a wrong egg answer consumes nothing');
assert.equal(bit(p, '100guide_q1'), 1);
talk(p, traiborn, [2]);
assert.equal(bit(p, '100guide_eggdone'), 1);
assert.equal(count(p, 'egg'), 0);
assert.equal(count(p, '100guide_egg'), 1);
assert.match(text(p), /Green ghostly person/i);
assert.match(text(p), /Lady in purple/i);

// Flour panels follow the five retained examples in listed order; only three correct answers enchant the flour.
talk(p, traiborn, [2]);
assert.equal(bit(p, '100guide_q2'), 1);
assert.equal(bit(p, '100guide_tot'), 0);
assert.equal(count(p, 'pot_flour'), 1);
talk(p, traiborn, [2]);
assert.equal(bit(p, '100guide_tot'), 1);
assert.equal(bit(p, '100guide_flourdone'), 0);
talk(p, traiborn, [3]);
assert.equal(bit(p, '100guide_tot'), 2);
talk(p, traiborn, [1]);
assert.equal(bit(p, '100guide_tot'), 2, 'a wrong panel answer does not increase the score');
talk(p, traiborn, [1]);
assert.equal(bit(p, '100guide_flourdone'), 1);
assert.equal(count(p, 'pot_flour'), 0);
assert.equal(count(p, '100guide_pot_flour'), 1);
assert.equal(bit(p, '100guide_q2'), 0);
assert.equal(bit(p, '100guide_tot'), 0);
assert.match(text(p), /Which of the following items were NOT shown to you/i);
assert.match(text(p), /Guthix prayer book, Magic logs, Pike/i);

// The 13 RuneHQ milk examples cycle until one answer is correct; wrong answers leave the ordinary bucket intact.
talk(p, traiborn, [2]);
assert.equal(bit(p, '100guide_q1'), 1);
assert.equal(bit(p, '100guide_milkdone'), 0);
assert.equal(count(p, 'bucket_milk'), 1);
talk(p, traiborn, [2]);
assert.equal(bit(p, '100guide_milkdone'), 1);
assert.equal(count(p, 'bucket_milk'), 0);
assert.equal(count(p, '100guide_bucket_milk'), 1);
assert.match(text(p), /A gold ring is to 5, as a holy symbol is to/i);
assert.match(text(p), /If I'm going to need glass, first I will need/i);

// Every retained egg and milk example accepts its sourced answer, after earlier wrong answers.
const eggAnswers = [1, 2, 3, 1, 2, 3];
for (let stop = 0; stop < eggAnswers.length; stop++) {
  const q = startFixture();
  for (let at = 0; at < stop; at++) talk(q, traiborn, [eggAnswers[at] === 1 ? 2 : 1]);
  talk(q, traiborn, [eggAnswers[stop]]);
  assert.equal(bit(q, '100guide_eggdone'), 1, `egg example ${stop + 1} accepts the period answer`);
  assert.equal(count(q, '100guide_egg'), 1);
  assert.equal(count(q, 'egg'), 0);
}
const milkAnswers = [1, 2, 3, 2, 2, 2, 1, 3, 1, 2, 2, 2, 2];
for (let stop = 0; stop < milkAnswers.length; stop++) {
  const q = startFixture();
  talk(q, traiborn, [1]);
  for (const answer of [1, 2, 3]) talk(q, traiborn, [answer]);
  for (let at = 0; at < stop; at++) talk(q, traiborn, [milkAnswers[at] === 1 ? 2 : 1]);
  talk(q, traiborn, [milkAnswers[stop]]);
  assert.equal(bit(q, '100guide_milkdone'), 1, `milk example ${stop + 1} accepts the period answer`);
  assert.equal(count(q, '100guide_bucket_milk'), 1);
  assert.equal(count(q, 'bucket_milk'), 0);
}
const flourRetry = startFixture();
talk(flourRetry, traiborn, [1]);
for (const answer of [2, 1, 1, 1, 2]) talk(flourRetry, traiborn, [answer]);
assert.equal(bit(flourRetry, '100guide_flourdone'), 0);
assert.equal(bit(flourRetry, '100guide_q2'), 0, 'a failed five-example flour cycle restarts');
assert.equal(bit(flourRetry, '100guide_tot'), 0);
assert.equal(count(flourRetry, 'pot_flour'), 1, 'a failed flour cycle consumes no ingredient');
for (const answer of [1, 2, 3]) talk(flourRetry, traiborn, [answer]);
assert.equal(bit(flourRetry, '100guide_flourdone'), 1, 'three correct answers succeed after a failed cycle');

// A missing enchanted ingredient can be recovered; a banked one is not duplicated.
remove(p, '100guide_egg');
talk(p, traiborn);
assert.equal(count(p, '100guide_egg'), 1, 'a lost enchanted egg is recoverable from Traiborn');
remove(p, '100guide_bucket_milk');
give(p, '100guide_bucket_milk', 1, bank);
talk(p, traiborn);
assert.equal(count(p, '100guide_bucket_milk'), 0);
assert.equal(count(p, '100guide_bucket_milk', bank), 1, 'a banked enchanted ingredient is not duplicated');
useItems(p, '100guide_egg', 'cake_tin');
assert.equal(count(p, '100guide_guidecake_uncooked'), 0, 'banked milk cannot be silently substituted');
remove(p, '100guide_bucket_milk', bank);
give(p, '100guide_bucket_milk');

// Combining requires every enchanted ingredient and the cake tin, then baking happens on the real cooking range.
remove(p, '100guide_pot_flour');
useItems(p, '100guide_egg', 'cake_tin');
assert.equal(count(p, '100guide_egg'), 1, 'a rejected cake combination consumes nothing');
assert.equal(count(p, 'cake_tin'), 1);
give(p, '100guide_pot_flour');
talk(p, traiborn);
assert.match(text(p), /Once they are all enchanted, use them on a cake tin and bake the cake on a range/i);
useItems(p, '100guide_egg', 'cake_tin');
assert.equal(count(p, '100guide_egg'), 0);
assert.equal(count(p, '100guide_pot_flour'), 0);
assert.equal(count(p, '100guide_bucket_milk'), 0);
assert.equal(count(p, 'cake_tin'), 0);
assert.equal(count(p, '100guide_guidecake_uncooked'), 1);
talk(p, traiborn);
assert.equal(count(p, '100guide_egg'), 0, 'holding the raw cake prevents ingredient recovery');
assert.equal(count(p, '100guide_pot_flour'), 0);
assert.equal(count(p, '100guide_bucket_milk'), 0);
assert.equal(count(p, '100guide_guidecake_uncooked'), 1);
useLoc(p, '100guide_guidecake_uncooked', guideLoc);
assert.equal(bit(p, '100guide_prog'), guideStage('rfd_guide_started'), 'the raw cake cannot free the guest');
assert.equal(count(p, '100guide_guidecake_uncooked'), 1);
useLoc(p, '100guide_guidecake_uncooked', range);
assert.equal(count(p, '100guide_guidecake_uncooked'), 0);
assert.equal(count(p, '100guide_guidecake'), 1);

// The baked cake writes the native terminal stage before the shared once-only reward clears visibility.
run(p, '[proc,update_questpoints]');
const questPointsBefore = p.getVar(id('VarPlayerType', 'qp'));
const tallyBefore = bit(p, 'hundred_subquest_tally');
const magicBefore = p.stats[PlayerStat.MAGIC];
const cookingBefore = p.stats[PlayerStat.COOKING];
useLoc(p, '100guide_guidecake', guideLoc);
assert.equal(bit(p, '100guide_prog'), hubStage('rfd_guest_complete'));
assert.equal(bit(p, '100guidevisible'), 0);
assert.equal(bit(p, 'hundred_subquest_tally'), tallyBefore + 1);
assert.equal(p.stats[PlayerStat.MAGIC] - magicBefore, 25000);
assert.equal(p.stats[PlayerStat.COOKING] - cookingBefore, 25000);
assert.equal(p.getVar(id('VarPlayerType', 'qp')), questPointsBefore + 1);
run(p, '[proc,rfd_guest_reward]', { args: [4] });
assert.equal(bit(p, 'hundred_subquest_tally'), tallyBefore + 1, 'the shared Guide reward is once-only');
assert.equal(p.stats[PlayerStat.MAGIC] - magicBefore, 25000);
assert.equal(p.stats[PlayerStat.COOKING] - cookingBefore, 25000);
assert.equal(p.getVar(id('VarPlayerType', 'qp')), questPointsBefore + 1);
for (const name of [
  '100guide_guidecake', '100guide_guidecake_uncooked', '100guide_egg',
  '100guide_bucket_milk', '100guide_pot_flour'
]) {
  assert.equal(types.ObjType.get(id('ObjType', name)).tradeable, false, `${name} is not tradeable`);
}

console.log('PASS RFD Guide gates, native Traiborn quizzes, enchanted ingredients, cake, and once-only reward');
process.exit(0);
