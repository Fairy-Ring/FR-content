#!/usr/bin/env node
// Run in the sibling engine after npm run build:
// node --import tsx ../content/tests/quest-points/test_quest_points.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { contentRoot, quests, blocks, orphanPoints, registrySum, value } from './registry.mjs';

// These are discrepancies, not a replacement quest registry. Each entry must
// remain a discrepancy until its owning quest unit removes this expectation.
const equalityDifferences = new Set([
  'fortress', 'cook', 'demon', 'runemysteries', 'doric', 'priest', 'gobdip',
  'haunted', 'imp', 'hunt', 'prince', 'romeojuliet', 'sheep', 'blackarmgang',
  'squire', 'vampire', 'hetty', 'waterfall', 'ball', 'cog', 'itexam', 'chompybird',
  'mcannon', 'crest', 'fishingcompo', 'fluffs', 'grandtree', 'hazeelcult', 'hero',
  'routequest', 'legends', 'zanaris', 'arthur', 'drunkmonk', 'murder',
  'scorpcatcher', 'seaslug', 'desertrescue', 'tree', 'totem', 'upass', 'druid',
  'druidspirit', 'death', 'troll', 'eadgar', 'tbwt', 'regicide', 'mortton', 'misc',
  'viking', 'grail', 'horror', 'troll_love', 'golem', 'deserttreasure', 'rd', 'wanted'
]);
const failures = [];
function check(condition, message) {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${message}`);
  if (!condition) failures.push(message);
}
function expectedFailure(stillFails, name, reason) {
  check(stillFails, `XFAIL ${name}: ${reason}${stillFails ? '' : ' (unexpected pass; update the exception list)'}`);
}

process.on('uncaughtException', error => { console.error(error); process.exit(1); });
process.on('unhandledRejection', error => { console.error(error); process.exit(1); });
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(contentRoot, '../engine');
const pack = path.join(engine, 'data/pack');
assert(fs.existsSync(path.join(pack, 'server/script.dat')), 'build the sibling engine first');
const load = async file => (await import(pathToFileURL(path.join(engine, file)).href)).default;
const World = await load('src/engine/World.ts');
const Player = await load('src/engine/entity/Player.ts');
const ScriptProvider = await load('src/engine/script/ScriptProvider.ts');
const ScriptRunner = await load('src/engine/script/ScriptRunner.ts');
const ScriptState = await load('src/engine/script/ScriptState.ts');
for (const type of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'InvType', 'ObjType']) {
  (await load(`src/cache/config/${type}.ts`)).load(pack);
}
World.currentTick = 1;
assert(ScriptProvider.load(pack) > 0, 'no packed scripts');
const ids = {};
for (const kind of ['varp', 'varbit']) {
  ids[kind] = new Map([...fs.readFileSync(path.join(contentRoot, `pack/${kind}.pack`), 'utf8').matchAll(/^(\d+)=(.+)$/gm)].map(match => [match[2].trim(), Number(match[1])]));
}
function player() {
  const p = new Player('qp_count_test', 0n, 0n);
  p.uid = 1;
  p.pid = 1;
  p.write = () => {};
  p.messageGame = () => {};
  p.wrappedMessageGame = () => {};
  return p;
}
function seed(p, fixture) {
  for (const [name, terminal] of fixture) {
    if (ids.varbit.has(name)) {
      const id = ids.varbit.get(name);
      p.setVarBit(id, terminal);
      assert.equal(p.getVarBit(id), terminal, `fixture overflow for %${name}`);
    } else {
      assert(ids.varp.has(name), `fixture has no packed variable %${name}`);
      p.setVar(ids.varp.get(name), terminal);
      assert.equal(p.getVar(ids.varp.get(name)), terminal, `fixture readback for %${name}`);
    }
  }
}
function count(p) {
  const script = ScriptProvider.getByName('[proc,count_questpoints]');
  assert(script, 'missing packed count_questpoints');
  const state = ScriptRunner.init(script, p);
  assert.equal(p.runScript(state, true, true), ScriptState.FINISHED, 'counter did not finish');
  assert.equal(state.isp, 1, 'counter must return exactly one int');
  return state.popInt();
}
check(quests.length > 0, 'config-derived quest registry is nonempty');
check(orphanPoints.length === 0, `every reward constant maps to a quest-list component (${orphanPoints.join(', ') || 'no orphans'})`);
check(blocks.every(block => quests.some(quest => quest.pointsConstant === block.pointsConstant)), 'every count block belongs to a registry quest');
check(count(player()) === 0, 'fresh account with no completed quests has zero points');
const seenEqualityDifferences = new Set();
for (const quest of quests) {
  check(quest.blocks.length === 1, `${quest.name}: exactly one count block (got ${quest.blocks.length})`);
  if (quest.colours.length) {
    const samePredicate = quest.colours.every(colour => quest.blocks.some(block => block.condition === `${colour.progress} >= ${colour.complete}`));
    if (equalityDifferences.has(quest.component)) {
      seenEqualityDifferences.add(quest.component);
      expectedFailure(!samePredicate, quest.name, 'counter uses equality; login colour accepts >= (Digsite also masks progress)');
    } else if (quest.component === 'elemental_workshop') {
      expectedFailure(!samePredicate, quest.name, 'counter tests completion bit; login colour compares the entire bitfield');
    } else check(samePredicate, `${quest.name}: count predicate agrees with login colour`);
  }
  // No QP seed: the packed proc must calculate the result from this quest alone.
  const p = player();
  seed(p, quest.fixture);
  const actual = count(p);
  if (quest.component === 'elemental_workshop') {
    expectedFailure(actual === 0, quest.name, `login-green threshold has no completion bit (${actual} instead of ${quest.points} QP)`);
    seed(p, [[quest.fixture[0][0], 2 ** value('elemental_workshop_complete')]]);
    check(count(p) === quest.points, `${quest.name}: completion bit alone counts its own ${quest.points} QP`);
  } else check(actual === quest.points, `${quest.name}: only this quest complete returns ${actual}, registry ${quest.points}`);
  // Shield of Arrav is one quest with two independent completion routes.
  if (quest.component === 'blackarmgang') {
    const alternate = quest.colours[1];
    const other = player();
    seed(other, [[alternate.progress.slice(1), value(alternate.complete.slice(1))]]);
    check(count(other) === quest.points, 'Shield of Arrav: alternate gang counts once');
    seed(other, quest.fixture);
    check(count(other) === quest.points, 'Shield of Arrav: both gangs still count once');
  }
}
check(seenEqualityDifferences.size === equalityDifferences.size, 'every named equality exception still has an oracle row');
// One runtime representative, not an invented above-terminal fixture per quest.
{
  const quest = quests.find(row => row.component === 'runemysteries');
  const p = player();
  seed(p, [[quest.fixture[0][0], quest.fixture[0][1] + 1]]);
  expectedFailure(count(p) === 0, quest.name, 'above-terminal progress is green but loses its quest point');
}
{
  const quest = quests.find(row => row.component === 'itexam');
  const p = player();
  seed(p, [[quest.fixture[0][0], quest.fixture[0][1] + 16]]);
  expectedFailure(count(p) === 0, quest.name, 'high bit leaves computed colour complete but raw-varp equality loses two points');
}
// Rag's post-quest wish-list adds a separate point without changing Part1.
{
  const p = player();
  seed(p, [['rag_quest', 2]]);
  check(count(p) === 1, 'Rag Part1 alone retains its original one quest point');
  seed(p, [['rag_wishlist', 1 << 27]]);
  check(count(p) === 1, 'active wish-list awards no additional quest point');
  seed(p, [['rag_wishlist', 2 << 27]]);
  check(count(p) === 2, 'rewarded wish-list adds exactly one quest point');
}
{
  const p = player();
  for (const quest of quests) {
    seed(p, quest.component === 'elemental_workshop'
      ? [[quest.fixture[0][0], 2 ** value('elemental_workshop_complete')]]
      : quest.fixture);
  }
  const actual = count(p);
  check(actual === registrySum, `all registry quests complete returns ${actual}, registry sum ${registrySum}`);
}
console.log(`RESULT ${failures.length ? 'FAIL' : 'PASS'} (${quests.length} registry quests, ${registrySum} QP, ${failures.length} failures)`);
// Importing World starts workers. No server is started, and no worker survives this test.
process.exit(failures.length ? 1 : 0);
