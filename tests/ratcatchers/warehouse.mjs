// Production Rat Catchers warehouse actions, native map placements and packed item-heal data.
import assert from 'node:assert/strict';
import {
  World, ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType as T,
  id, b, player, target, interact, useItems, cat, stage, add, count, drop, tile, load, escape, map, types, withRandom
} from './runtime.mjs';

const { NpcStat } = await load('engine/entity/NpcStat.ts');
const atStage = (p, value) => p.setVarBit(b('ratcatch_var'), value);
const jack = target('npc', 'vc_hooknosed_jack', rows => rows.find(row => row.level === 0 && row.x === 3268 && row.z === 3400));
const apothecary = target('npc', 'apothecary');
const holeCoords = [[3264, 3378], [3273, 3377], [3274, 3381], [3271, 3384]];
const holes = holeCoords.map(([x, z], index) => target('loc', `ratcatchers_rathole${index + 1}`,
  rows => rows.find(row => row.level === 1 && row.x === x && row.z === z)));
const ladder = target('loc', 'vc_ladder', rows => rows.find(row => row.level === 0 && row.x === 3268 && row.z === 3379));
const ladderTop = target('loc', 'vc_laddertop', rows => rows.find(row => row.level === 1 && row.x === 3268 && row.z === 3379));
const vars = {
  hole1: b('ratcatch_rathole_1'), hole2: b('ratcatch_rathole_2'),
  hole3: b('ratcatch_rathole_3'), hole4: b('ratcatch_rathole_4'),
  withdrawal: b('ratcatch_withdrawfrom_kingrat'),
  ratOwner: id('VarNpcType', 'npc_attacking_uid')
};
const ownerRat = p => [...World.npcs].find(npc => npc.type === id('NpcType', 'vc_kingrat') && npc.getVar(vars.ratOwner) === p.uid);
function runNpc(name, npc) {
  const script = ScriptProvider.getByName(name);
  assert(script, `${name} is packed`);
  const state = ScriptRunner.init(script, npc);
  npc.executeScript(state);
  assert.equal(state.execution, ScriptState.FINISHED, `${name} finishes`);
}
function useCatAction(p, follower) {
  return interact(p, { entity: follower, stand: tile(p) }, T.OPNPC5);
}

const p = player({ cat: 'kittenpet1' });
const other = player();
atStage(p, 6);
assert.equal(interact(p, jack, T.OPNPC1), '[opnpc1,vc_hooknosed_jack]');
assert.equal(stage(p), 6, 'Jack does not take an incomplete ingredient set');
add(p, 'kwuarm'); add(p, 'red_spiders_eggs'); add(p, 'vial_empty'); add(p, 'cheese', 4);
interact(p, jack, T.OPNPC1);
assert.equal(stage(p), 7, 'Jack hand-in starts the poison task');
assert.equal(count(p, 'kwuarm') + count(p, 'red_spiders_eggs') + count(p, 'vial_empty'), 0);
assert.equal(count(p, 'rat_poison'), 1, 'one vial produces one reusable poison dose');
assert.equal(count(p, 'cheese'), 4, 'Jack leaves the four cheeses for the player to poison');
for (let portion = 1; portion <= 4; portion++) {
  useItems(p, 'rat_poison', 'cheese');
  assert.equal(count(p, 'cheese'), 4 - portion);
  assert.equal(count(p, 'ratcatchers_poisonedcheese'), portion);
  assert.equal(count(p, 'rat_poison'), portion === 4 ? 0 : 1, 'one poison dose covers all four cheeses');
}
assert.equal(interact(p, holes[0], T.OPLOCU, 'ratcatchers_poisonedcheese'), '[oplocu,ratcatchers_rathole1]');
assert.equal(p.getVarBit(vars.hole1), 1);
assert.equal(other.getVarBit(vars.hole1), 0, 'bait progress belongs to its player');
atStage(other, 7);
add(other, 'ratcatchers_poisonedcheese');
interact(other, holes[0], T.OPLOCU, 'ratcatchers_poisonedcheese');
assert.equal(other.getVarBit(vars.hole1), 1);
assert.equal(p.getVarBit(vars.hole1), 1, "another player cannot change this player's hole bit");
for (const hole of holes.slice(1)) interact(p, hole, T.OPLOCU, 'ratcatchers_poisonedcheese');
assert.deepEqual([vars.hole1, vars.hole2, vars.hole3, vars.hole4].map(bit => p.getVarBit(bit)), [1, 1, 1, 1]);
assert.equal(stage(p), 8, 'the fourth poisoned hole completes the warehouse baiting');
assert.equal(interact(p, jack, T.OPNPC1), '[opnpc1,vc_hooknosed_jack]');
assert.equal(stage(p), 9, 'Jack sends the player to the Apothecary');

add(p, 'marentill'); add(p, 'unicorn_horn_dust'); add(p, 'bucket_milk');
interact(p, apothecary, T.OPNPC1);
assert.equal(stage(p), 9, 'the Apothecary makes the requested cure without changing the route');
assert.equal(count(p, 'marentill') + count(p, 'unicorn_horn_dust') + count(p, 'bucket_milk'), 0);
assert.equal(count(p, 'bucket_empty'), 1);
assert.equal(count(p, 'ratcatchers_cat_antipoison'), 1);
interact(p, jack, T.OPNPC1);
assert.equal(stage(p), 10, 'Jack takes the antipoison and Pox recovers');
assert.equal(count(p, 'ratcatchers_cat_antipoison'), 0);

// Jack can replace lost poison while the four-hole task remains incomplete.
const recovery = player({ cat: null });
atStage(recovery, 7);
interact(recovery, jack, T.OPNPC1);
assert.equal(count(recovery, 'rat_poison'), 1);
add(recovery, 'cheese');
useItems(recovery, 'rat_poison', 'cheese');
assert.equal(count(recovery, 'rat_poison'), 1, 'poison remains until the four portions exist');
drop(recovery, 'rat_poison');
interact(recovery, jack, T.OPNPC1);
assert.equal(count(recovery, 'rat_poison'), 1, 'lost poison can be recovered before four portions exist');

interact(p, ladder, T.OPLOC1);
assert.deepEqual(tile(p), [1, ladderTop.row.x + 1, ladderTop.row.z], 'the native ladder arrives beside its warehouse counterpart');
escape(tile(p), 'native warehouse upper landing');
for (const { row } of holes) {
  const type = types.LocType.get(row.id);
  const route = map.findPathToLoc(1, ladderTop.row.x + 1, ladderTop.row.z, row.x, row.z, 1, type.width, type.length, row.angle, row.shape, type.forceapproach);
  assert(route.length, 'a native warehouse hole has a path from the ladder landing');
  const last = route.at(-1), x = (last >>> 14) & 0x3fff, z = last & 0x3fff;
  assert(map.reachedLoc(1, x, z, row.x, row.z, type.width, type.length, 1, row.angle, row.shape, type.forceapproach), 'the path reaches the real hole');
}
interact(p, ladderTop, T.OPLOC1);
assert.deepEqual(tile(p), [0, ladder.row.x + 1, ladder.row.z], 'the warehouse ladder returns beside the original ground endpoint');
escape(tile(p), 'native warehouse lower landing');
interact(p, ladder, T.OPLOC1);
assert.deepEqual(tile(p), [1, ladderTop.row.x + 1, ladderTop.row.z]);
const petTimer = '[ai_timer,_petcat]';
let owned = cat(p);
runNpc(petTimer, owned);
owned.levels[NpcStat.HITPOINTS] = 1;
useCatAction(p, owned);
assert.equal(stage(p), 10, 'a cat at one hitpoint starts the fight instead of fleeing');
assert.equal(cat(p).levels[NpcStat.HITPOINTS], 1);
const firstRat = ownerRat(p);
assert(firstRat, 'the cat action creates an owner-private King Rat');
assert.deepEqual(tile(cat(p)), [1, 3270, 3381], 'the cat stands in the real warehouse room');
assert.deepEqual(tile(firstRat), [1, 3270, 3382], 'the King Rat stands beside its opponent');
escape(tile(cat(p)), 'warehouse cat fight tile');
escape(tile(firstRat), 'warehouse King Rat fight tile');

const cookedFish = ['shrimp', 'anchovies', 'sardine', 'salmon', 'trout', 'giant_carp', 'cod', 'herring', 'pike',
  'mackerel', 'tuna', 'bass', 'swordfish', 'lobster', 'shark', 'mantaray', 'seaturtle'];
for (const fish of cookedFish) {
  owned = cat(p);
  owned.levels[NpcStat.HITPOINTS] = 1;
  add(p, fish);
  interact(p, holes[3], T.OPLOCU, fish);
  assert.equal(count(p, fish), 0, `${fish} is consumed through the active rathole`);
  assert(owned.levels[NpcStat.HITPOINTS] > 1, `${fish} restores its normal health amount through the wall`);
  assert(ownerRat(p), 'feeding does not end the King Rat fight');
}
const rawFish = [['raw_shrimp', 'shrimp'], ['raw_anchovies', 'anchovies'], ['raw_sardine', 'sardine'],
  ['raw_trout', 'trout'], ['raw_salmon', 'salmon'], ['raw_tuna', 'tuna']];
for (const [fish, healSource] of rawFish) {
  owned = cat(p);
  owned.levels[NpcStat.HITPOINTS] = 1;
  add(p, fish);
  interact(p, holes[3], T.OPLOCU, fish);
  assert.equal(count(p, fish), 0, `${fish} remains accepted by the cat-feeding path`);
  assert(owned.levels[NpcStat.HITPOINTS] > 1, `${fish} uses the ${healSource} consume-table healing`);
  assert(ownerRat(p), 'raw fish feeding does not end the King Rat fight');
}

// A second account gets a separate fight actor; withdrawing one cat leaves the other fight intact.
atStage(other, 10);
[other.level, other.x, other.z] = tile(p); other.originX = other.x; other.originZ = other.z;
let otherCat = cat(other);
runNpc(petTimer, otherCat);
useCatAction(other, otherCat);
const otherRat = ownerRat(other);
assert(otherRat && otherRat.uid !== firstRat.uid, 'two owners receive separate King Rats');
owned = cat(p);
useCatAction(p, owned);
assert.equal(ownerRat(p), undefined, 'the owner can withdraw their own fight');
assert.equal(ownerRat(other)?.uid, otherRat.uid, 'withdrawing does not delete another owner’s King Rat');
assert.equal(p.getVarBit(vars.withdrawal), 1);
escape(tile(cat(p)), 'warehouse cat withdrawal return');
assert.equal(stage(p), 10, 'withdrawing does not complete the quest');

// A defeated cat does not advance the quest; a new kitten can retry and only a rat death advances it.
owned = cat(p);
useCatAction(p, owned);
let rat = ownerRat(p);
assert(rat);
owned.levels[NpcStat.HITPOINTS] = 1;
owned.levels[NpcStat.ATTACK] = 0;
owned.levels[NpcStat.STRENGTH] = 0;
owned.levels[NpcStat.DEFENCE] = 0;
rat.levels[NpcStat.HITPOINTS] = rat.baseLevels[NpcStat.HITPOINTS];
rat.levels[NpcStat.ATTACK] = 100;
rat.levels[NpcStat.STRENGTH] = 100;
rat.levels[NpcStat.DEFENCE] = 1;
withRandom(0.999999, () => runNpc('[ai_timer,vc_kingrat]', rat));
assert.equal(stage(p), 10, 'a King Rat win is required to advance after the cat dies');
assert.equal(p.getVar(id('VarPlayerType', 'follower_uid')), -1, 'the failed cat is removed');
assert.equal(ownerRat(p), undefined, 'the private Rat is removed after the cat dies');
assert.equal(ownerRat(other)?.uid, otherRat.uid, 'a cat loss leaves another owner’s encounter intact');

add(p, 'kittenobject');
interact(p, holes[3], T.OPLOCU, 'kittenobject');
assert.equal(count(p, 'kittenobject'), 0);
assert(ownerRat(p), 'using a replacement kitten on the active hole retries the fight');
owned = cat(p);
rat = ownerRat(p);
owned.levels[NpcStat.ATTACK] = 100;
owned.levels[NpcStat.STRENGTH] = 100;
rat.levels[NpcStat.HITPOINTS] = 1;
rat.levels[NpcStat.DEFENCE] = 0;
withRandom(0.999999, () => runNpc('[ai_timer,vc_kingrat]', rat));
assert.equal(stage(p), 11, 'only the King Rat death advances the warehouse task');
assert.equal(ownerRat(p), undefined);
assert.equal(ownerRat(other)?.uid, otherRat.uid);
interact(p, jack, T.OPNPC1);
assert.equal(stage(p), 12, 'Jack sends the player to Smokin’ Joe after the King Rat dies');
console.log('Rat Catchers warehouse: Jack poison hand-in, reusable poison, four holes, Apothecary, fish healing, owner isolation, cat-loss retry and Rat death gate passed');
process.exit(0);
