import assert from 'node:assert/strict';
import {
  World, PlayerStat, ScriptState, ServerTriggerType, types, nativeLocRows, nativeNpcRows,
  player, position, tile, id, obj, inv, worn, com, bit, setBit, setVar, skill, count, give,
  run, talk, operate, useLoc, useItems, capture, nativeLoc, nativeNpc, load, stand, text,
  remove, equip, walkable
} from '../rfd-s1/runtime.mjs';

const [OpHeld, OpHeldHandler, OpLocU, OpLocUHandler, OpObj, OpObjHandler, IfButton, IfButtonHandler] = await Promise.all([
  'network/game/client/model/OpHeld.ts',
  'network/game/client/handler/OpHeldHandler.ts',
  'network/game/client/model/OpLocU.ts',
  'network/game/client/handler/OpLocUHandler.ts',
  'network/game/client/model/OpObj.ts',
  'network/game/client/handler/OpObjHandler.ts',
  'network/game/client/model/IfButton.ts',
  'network/game/client/handler/IfButtonHandler.ts'
].map(load));

const heldHandler = new OpHeldHandler();
const locUseHandler = new OpLocUHandler();
const objectHandler = new OpObjHandler();
const buttonHandler = new IfButtonHandler();
const stage = p => bit(p, 'hundred_ilm_quest');
const region = p => [Math.floor(p.x / 64), Math.floor(p.z / 64)];
const inRegion = (p, x, z) => assert.deepEqual(region(p), [x, z], `player reaches native map region ${x}_${z}`);
const guestStageComplete = 10;
const apeAtollThrone = nativeLoc('mm_throne');
const frozenGuestBase = 'hundred_monkey_base';

function guestLoc(base) {
  const row = nativeLocRows(base).find(row => row.level === 0 && Math.floor(row.x / 64) === 29 && Math.floor(row.z / 64) === 83);
  assert(row, `${base} has its original banquet placement`);
  const multi = base.replace(/_base$/, '_multi');
  const target = World.getLoc(row.x, row.z, row.level, id('LocType', multi));
  assert(target, `${base} is installed under its original multi wrapper`);
  return target;
}

function prepareFrozen(p) {
  setBit(p, 'hundred_main_quest_var', 3);
  setBit(p, '100monkeyvisible', 1);
  for (const [name, complete] of [
    ['hundred_dwarf_quest', 10], ['100goblin', 10], ['100_pirate_quest_var', 10],
    ['100guide_prog', 10], ['hundred_dave_main', 7], ['100_ogre_prog', 10], ['chickenquest', 10]
  ]) setBit(p, name, complete);
  setBit(p, 'hundred_subquest_tally', 7);
  position(p, [0, 1861, 5317]);
  run(p, '[proc,rfd_prepare_banquet]');
}

function greegreeAction(p, name) {
  const item = obj(name);
  const slot = p.getInventory(inv).getItemIndex(item);
  assert.notEqual(slot, -1, `${name} is held for its native greegree action`);
  let accepted;
  capture(p, () => {
    accepted = heldHandler.handle(new OpHeld(2, item, slot, com('inventory:inv')), p);
    assert.equal(accepted, true, `${name} uses the native Hold packet`);
  });
  return count(p, name, worn);
}

function useGreegree(p, name) {
  assert.equal(greegreeAction(p, name), 1, `${name} is worn after its native action`);
}

function useLocDeferred(p, itemName, target) {
  stand(p, target);
  const item = obj(itemName);
  const slot = p.getInventory(inv).getItemIndex(item);
  assert.notEqual(slot, -1, `${itemName} is carried for native location use`);
  assert.equal(locUseHandler.handle(
    new OpLocU(target.x, target.z, target.type, item, slot, com('inventory:inv')),
    p
  ), true, `native Use ${itemName} on the location is accepted`);
  assert.equal(p.target, target);
  assert(p.validateTarget());
  assert.match(p.getOpTrigger()?.name ?? '', /^\[oplocu,/);
  const states = [];
  const original = p.executeScript;
  p.executeScript = function(state, ...args) {
    states.push(state);
    return original.call(this, state, ...args);
  };
  try {
    p.processInteraction();
  } finally {
    p.executeScript = original;
  }
  assert(states.length, 'native location use executes a compiled handler');
  return states.at(-1);
}

function resumeDelay(p, state) {
  assert.equal(state.execution, ScriptState.SUSPENDED);
  World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
  p.delayed = false;
  p.executeScript(state, true, true);
}

function settleNpc(npc) {
  for (let step = 0; step < 80; step++) {
    if (!npc.activeScript && npc.queue.head() === null) return;
    World.currentTick = Math.max(World.currentTick + 1, npc.delayedUntil);
    npc.delayed = false;
    npc.processQueue();
    if (npc.activeScript) npc.executeScript(npc.activeScript);
  }
  assert.fail('native Big Snake damage/death queue did not settle');
}

function killSnakeAndTake(p, actor) {
  stand(p, actor);
  const corpse = obj('hundred_ilm_snake_corpse');
  const drops = [];
  const originalAddObj = World.addObj;
  World.addObj = function(item, receiver, duration) {
    if (item.type === corpse) drops.push({ id: item.type, count: item.count });
    return originalAddObj.call(this, item, receiver, duration);
  };
  try {
    actor.heroPoints.clear();
    actor.heroPoints.addHero(p.hash64, actor.levels[3]);
    actor.setVar(id('VarNpcType', 'npc_aggressive_player'), p.uid);
    actor.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, actor.levels[3]);
    settleNpc(actor);
  } finally {
    World.addObj = originalAddObj;
  }
  assert.deepEqual(drops, [{ id: corpse, count: 1 }], 'the native Big Snake death queue drops one corpse');
  position(p, [actor.level, actor.x, actor.z]);
  assert.equal(objectHandler.handle(new OpObj(3, actor.x, actor.z, corpse), p), true, 'native ground Take accepts the corpse');
  p.processInteraction();
  assert(count(p, 'hundred_ilm_snake_corpse') > 0, 'native Take adds the snake corpse to inventory');
}

function captureReward(p) {
  return {
    cooking: p.stats[PlayerStat.COOKING],
    agility: p.stats[PlayerStat.AGILITY],
    hitpoints: p.stats[PlayerStat.HITPOINTS],
    qp: p.getVar(id('VarPlayerType', 'qp')),
    tally: bit(p, 'hundred_subquest_tally')
  };
}

function assertRegionNot(p, x, z, label) {
  assert.notDeepEqual(region(p), [x, z], label);
}
function assertNear(p, [level, x, z], label) {
  assert.equal(p.level, level, `${label}: plane`);
  const distance = Math.max(Math.abs(p.x - x), Math.abs(p.z - z));
  assert(distance >= 1 && distance <= 2,
    `${label}: ${tile(p)} is ${distance} tiles from [${level},${x},${z}]`);
}

// PlayerTimerType.NORMAL is the first const-enum member in the engine.
const normalPlayerTimerType = 0;
function cycleGreegreeTimer(p) {
  capture(p, () => {
    World.currentTick++;
    p.processTimers(normalPlayerTimerType);
    p.processQueues();
  });
}
function assertGreegreeRetained(p, item, location) {
  for (let cycle = 1; cycle <= 3; cycle++) {
    cycleGreegreeTimer(p);
    assert.equal(count(p, item, worn), 1, `${location} retains ${item} through timer cycle ${cycle}`);
  }
}

const guestProbe = player();
prepareFrozen(guestProbe);
const guest = guestLoc(frozenGuestBase);

// Inspect is gated by Monkey Madness and the two period levels, not by carrying tools or greegrees.
setVar(guestProbe, 'mm_main', 0);
skill(guestProbe, 'cooking', 70);
skill(guestProbe, 'agility', 48);
operate(guestProbe, guest);
assert.equal(stage(guestProbe), 0, 'unfinished Monkey Madness blocks Inspect');
setVar(guestProbe, 'mm_main', 9);
skill(guestProbe, 'cooking', 69);
operate(guestProbe, guest);
assert.equal(stage(guestProbe), 0, '69 Cooking blocks Inspect');
skill(guestProbe, 'cooking', 70);
skill(guestProbe, 'agility', 47);
operate(guestProbe, guest);
assert.equal(stage(guestProbe), 0, '47 Agility blocks Inspect');
skill(guestProbe, 'agility', 48);
operate(guestProbe, guest);
assert.equal(stage(guestProbe), 1, 'Inspect starts Awowogei with only the documented prerequisites');
for (const item of ['knife', 'pestle_and_mortar', 'rope', 'mm_amulet_of_monkey_speak',
  'mm_monkey_greegree_for_normal_gorilla', 'mm_monkey_greegree_for_small_ninja_monkey',
  'mm_monkey_greegree_for_large_zombie_monkey']) {
  assert.equal(count(guestProbe, item), 0, `Inspect does not require ${item}`);
}

// Existing MM trapdoor actions remain ordinary open/Climb-down and are not redirected into the RFD cave.
const templeTrapdoorTile = [0, 43 * 64 + 55, 43 * 64 + 33];
const templeBasementTile = [0, 43 * 64 + 56, 143 * 64 + 49];
const templeCrackTile = [0, 43 * 64 + 53, 143 * 64 + 47];
const chamberEntryTile = [0, 47 * 64 + 53, 85 * 64 + 43];
const chamberReturnTile = [0, 47 * 64 + 54, 85 * 64 + 43];
const exit12617Id = id('LocType', 'exit_12617');
const templeBasementRope = nativeLoc('mm_climbing_rope_bottom_temple', rows =>
  rows.find(row => row.level === 0 && Math.floor(row.x / 64) === 43 && Math.floor(row.z / 64) === 143));
const templeCrack = nativeLoc('exit_12617', rows =>
  rows.find(row => row.level === templeCrackTile[0] && row.x === templeCrackTile[1] && row.z === templeCrackTile[2]));
const trapdoorRow = nativeLocRows('mm_temple_trapdoor').find(row =>
  row.level === templeTrapdoorTile[0] && row.x === templeTrapdoorTile[1] && row.z === templeTrapdoorTile[2]);
assert(trapdoorRow, 'original temple trapdoor is mapped');
const trapdoorClosedId = id('LocType', 'mm_temple_trapdoor');
const trapdoorOpenId = id('LocType', 'mm_temple_trapdoor_open');
const trapdoorProbe = player();
setVar(trapdoorProbe, 'mm_main', 9);
let trapdoor = World.getLoc(trapdoorRow.x, trapdoorRow.z, trapdoorRow.level, trapdoorClosedId);
if (!trapdoor) {
  const open = World.getLoc(trapdoorRow.x, trapdoorRow.z, trapdoorRow.level, trapdoorOpenId);
  assert(open, 'the native trapdoor is either open or closed');
  operate(trapdoorProbe, open, 2);
  trapdoor = World.getLoc(trapdoorRow.x, trapdoorRow.z, trapdoorRow.level, trapdoorClosedId);
}
assert(trapdoor, 'the native trapdoor can be closed before the regression check');
operate(trapdoorProbe, trapdoor, 1);
const openTrapdoor = World.getLoc(trapdoorRow.x, trapdoorRow.z, trapdoorRow.level, trapdoorOpenId);
assert(openTrapdoor, 'native Open changes the MM trapdoor to its original open variant');
operate(trapdoorProbe, openTrapdoor, 1);
assertNear(trapdoorProbe, templeBasementTile, 'ordinary MM Climb-down reaches the temple basement');
assert.doesNotMatch(text(trapdoorProbe), /The trapdoor leads to the snake cave/i,
  'the RFD overlay does not replace ordinary MM trapdoor behavior');
assert.equal(stage(trapdoorProbe), 0, 'ordinary MM trapdoor use does not change Awowogei progress');
stand(trapdoorProbe, templeCrack);
const beforeLockedCrack = tile(trapdoorProbe);
operate(trapdoorProbe, templeCrack);
assert.deepEqual(tile(trapdoorProbe), beforeLockedCrack, 'the basement crack does not enter before Awowogei starts');
operate(trapdoorProbe, templeBasementRope);
assertNear(trapdoorProbe, templeTrapdoorTile, 'the native basement rope returns to the surface');
const closeTrapdoor = World.getLoc(trapdoorRow.x, trapdoorRow.z, trapdoorRow.level, trapdoorOpenId);
assert(closeTrapdoor, 'the original trapdoor remains open until it is closed');
operate(trapdoorProbe, closeTrapdoor, 2);
assert(World.getLoc(trapdoorRow.x, trapdoorRow.z, trapdoorRow.level, trapdoorClosedId), 'native Close restores the original trapdoor');

const p = guestProbe;
const snakePitTile = [0, 45 * 64 + 41, 42 * 64 + 33];
const snakeEntryTile = [0, 47 * 64 + 15, 85 * 64 + 49];
const snakeRopeTile = [0, 47 * 64 + 15, 85 * 64 + 48];
const nutHoleTile = [0, 43 * 64 + 6, 42 * 64 + 41];
const nutCaveEntryTile = [0, 47 * 64 + 17, 85 * 64 + 17];
const nutBushTile = [0, 47 * 64 + 12, 85 * 64 + 17];
const tree = nativeLoc('scenery_12610', rows => rows.find(row => row.level === 0 && row.x === 42 * 64 + 8 && row.z === 43 * 64 + 33));
const hole = nativeLoc('hole_12581', rows => rows.find(row => row.level === nutHoleTile[0] && row.x === nutHoleTile[1] && row.z === nutHoleTile[2]));
const pit = nativeLoc('pit', rows => rows.find(row => row.level === snakePitTile[0] && row.x === snakePitTile[1] && row.z === snakePitTile[2]));
const snakeRope = nativeLoc('rope_12601', rows => rows.find(row => row.level === snakeRopeTile[0] && row.x === snakeRopeTile[1] && row.z === snakeRopeTile[2]));
const nutBush = nativeLoc('bush', rows => rows.find(row => row.level === nutBushTile[0] && row.x === nutBushTile[1] && row.z === nutBushTile[2]));
const holeExit = nativeLoc('exit_12616', rows => rows.find(row => row.level === nutCaveEntryTile[0] && row.x === nutCaveEntryTile[1] && row.z === nutCaveEntryTile[2]));
const hotRock = nativeLoc('scenery_12633', rows => rows.find(row => row.level === 0 && row.x === 47 * 64 + 48 && row.z === 85 * 64 + 44));

// The three native Ape Atoll monkeys share the dialogue route; Awowogei is approached through the MM throne.
give(p, 'knife');
give(p, 'pestle_and_mortar');
give(p, 'rope');
give(p, 'coins', 5);
give(p, 'mm_amulet_of_monkey_speak');
give(p, 'mm_monkey_greegree_for_normal_gorilla');
give(p, 'mm_monkey_greegree_for_small_ninja_monkey');
give(p, 'mm_monkey_greegree_for_large_zombie_monkey');
const monkeyAmulet = obj('mm_amulet_of_monkey_speak');
assert.equal(types.ObjType.get(monkeyAmulet).iop[1], 'Wear');
// The helper uses the real native Wear packet.
const amuletSlot = p.getInventory(inv).getItemIndex(monkeyAmulet);
assert.notEqual(amuletSlot, -1);
capture(p, () => assert.equal(heldHandler.handle(new OpHeld(2, monkeyAmulet, amuletSlot, com('inventory:inv')), p), true));
assert.equal(count(p, 'mm_amulet_of_monkey_speak', worn), 1);

stand(p, apeAtollThrone);
useGreegree(p, 'mm_monkey_greegree_for_normal_gorilla');
operate(p, apeAtollThrone);
assert.equal(stage(p), 2, 'native throne conversation advances after Awowogei is approached in monkey form');

const mizaru = nativeNpc('hundred_ilm_mizaru');
const kikazaru = nativeNpc('hundred_ilm_kikazaru');
const iwazaru = nativeNpc('hundred_ilm_iwazaru');
talk(p, mizaru);
assert.equal(stage(p), 3, 'the first Three Monkey teaches the recipe');
talk(p, kikazaru);
assert.equal(stage(p), 3, 'the other monkeys share the same recipe gate');
give(p, 'banana');
give(p, 'mm_monkey_nuts');
talk(p, iwazaru);
assert.equal(stage(p), 4, 'the regular banana and monkey nuts are rejected by the Three Monkeys');
assert.equal(count(p, 'banana'), 1, 'regular banana is not consumed by recipe rejection');
assert.equal(count(p, 'mm_monkey_nuts'), 1, 'regular monkey nuts are not consumed by recipe rejection');

// Lumdo's native travel reaches Crash Island; the pit and original rope form a round trip to the Big Snakes.
const lumdoAtoll = nativeNpc('mm_lumdo', rows => rows.find(row => Math.floor(row.x / 64) === 43 && Math.floor(row.z / 64) === 42));
talk(p, lumdoAtoll);
inRegion(p, 45, 42);
operate(p, pit);
assert.deepEqual(tile(p), snakeEntryTile, 'the Crash Island pit enters the native snake chamber tile');
assert.equal(count(p, 'mm_monkey_greegree_for_normal_gorilla', worn), 1, 'the gorilla form remains worn on entry to the snake pit');
for (let cycle = 0; cycle < 3 && count(p, 'mm_monkey_greegree_for_normal_gorilla', worn) > 0; cycle++) {
  cycleGreegreeTimer(p);
}
assert.equal(count(p, 'mm_monkey_greegree_for_normal_gorilla', worn), 0, 'the snake-pit timer reverts the unsupported gorilla form');
assert.equal(count(p, 'mm_monkey_greegree_for_normal_gorilla'), 1, 'the reverted greegree returns to inventory');
assert.equal(greegreeAction(p, 'mm_monkey_greegree_for_normal_gorilla'), 0, 'a native Hold packet cannot equip a greegree in the snake pit');
assert.equal(count(p, 'mm_monkey_greegree_for_normal_gorilla'), 1, 'the refused snake-pit equip preserves the greegree');
const snakeRows = nativeNpcRows('hundred_ilm_snake');
assert(snakeRows.length >= 3, 'the native cave map contains three Big Snakes');
const snakeActors = snakeRows.slice(0, 3).map(row => nativeNpc('hundred_ilm_snake', rows => rows.find(candidate =>
  candidate.level === row.level && candidate.x === row.x && candidate.z === row.z
)));
for (const [index, snake] of snakeActors.entries()) {
  assert.equal(types.NpcType.get(snake.type).name, 'Big Snake');
  killSnakeAndTake(p, snake);
  assert.equal(count(p, 'hundred_ilm_snake_corpse'), index + 1, 'each native death drop is taken through the ground-item packet');
}
operate(p, snakeRope);
assertNear(p, snakePitTile, 'the cave rope returns to the Crash Island pit');
// The corpse is available before the first pair, but an early ingredient attempt preserves it.
const beforeEarlyUse = { corpse: count(p, 'hundred_ilm_snake_corpse'), banana: count(p, 'banana'), stage: stage(p) };
useItems(p, 'banana', 'hundred_ilm_snake_corpse');
assert.equal(count(p, 'hundred_ilm_snake_corpse'), beforeEarlyUse.corpse, 'early recipe use does not consume the corpse');
assert.equal(count(p, 'banana'), beforeEarlyUse.banana, 'early recipe use does not consume the ordinary banana');
assert.equal(stage(p), beforeEarlyUse.stage, 'early recipe use does not advance the quest');

// Rope use is a native item-on-tree action and only the gorilla guard form can pull down the red-banana tree.
stand(p, tree);
useGreegree(p, 'mm_monkey_greegree_for_small_ninja_monkey');
assert.equal(bit(p, 'hundred_ilm_red_banana_tree'), 1, 'the original red banana tree begins in its raised state');
useLoc(p, 'rope', tree);
assert.equal(bit(p, 'hundred_ilm_red_banana_tree'), 1, 'a non-gorilla form cannot pull down the red banana tree');
assert.equal(count(p, 'rope'), 1, 'failed rope use preserves the reusable rope');
function pickRedBanana() {
  stand(p, tree);
  useGreegree(p, 'mm_monkey_greegree_for_normal_gorilla');
  const pulling = useLocDeferred(p, 'rope', tree);
  assert.equal(pulling.execution, ScriptState.SUSPENDED, 'the gorilla pull waits for its animation');
  assert.equal(bit(p, 'hundred_ilm_red_banana_tree'), 2, 'the tree enters its pulled-down animation state');
  assert.equal(count(p, 'rope'), 1, 'the successful pull preserves the reusable rope');
  resumeDelay(p, pulling);
  assert.equal(pulling.execution, ScriptState.FINISHED);
  assert.equal(bit(p, 'hundred_ilm_red_banana_tree'), 3, 'the animation exposes the Pick state');
  operate(p, tree);
  assert.equal(count(p, 'hundred_ilm_red_banana'), 1, 'native Pick produces one red banana');
  assert.equal(bit(p, 'hundred_ilm_red_banana_tree'), 1, 'picking resets the original tree multi');
}
function pickTchikiNuts() {
  stand(p, hole);
  const before = tile(p);
  operate(p, hole);
  assertRegionNot(p, 47, 85, 'the agility hole rejects a non-ninja form');
  assert.deepEqual(tile(p), before, 'blocked hole action leaves the player at the entrance');
  useGreegree(p, 'mm_monkey_greegree_for_small_ninja_monkey');
  operate(p, hole);
  assertNear(p, nutCaveEntryTile, 'the ninja agility hole enters its native course landing');
  useGreegree(p, 'mm_monkey_greegree_for_normal_gorilla');
  useGreegree(p, 'mm_monkey_greegree_for_small_ninja_monkey');
  assertGreegreeRetained(p, 'mm_monkey_greegree_for_small_ninja_monkey', 'the Ape nut cave');
  operate(p, nutBush);
  assert.equal(count(p, 'hundred_ilm_tchiki_monkey_nuts'), 1, 'native Pick produces Tchiki monkey nuts');
  operate(p, holeExit);
  assertNear(p, nutHoleTile, 'the native course exit returns beside the original hole');
}

pickRedBanana();
pickTchikiNuts();
talk(p, mizaru);
assert.equal(stage(p), 5, 'the Three Monkeys eat exactly one correct first pair');
assert.equal(count(p, 'hundred_ilm_red_banana'), 0);
assert.equal(count(p, 'hundred_ilm_tchiki_monkey_nuts'), 0);
assert.equal(count(p, 'banana'), 1, 'the rejected ordinary banana remains separate');
assert.equal(count(p, 'mm_monkey_nuts'), 1, 'the rejected ordinary nuts remain separate');

// A wrong ingredient now produces the distinct incorrect item; the other two snake drops remain usable.
useItems(p, 'banana', 'hundred_ilm_snake_corpse');
assert.equal(count(p, 'banana'), 0);
assert.equal(count(p, 'hundred_ilm_snake_corpse'), 2);
assert.equal(count(p, 'hundred_ilm_incorrectly_stuffed_snake'), 1);
assert.equal(stage(p), 5, 'incorrect stuffing cannot advance the quest');

// Prepare one pair through the original tree, hole, knife and pestle actions; test banana-first and paste-first use.
pickRedBanana();
pickTchikiNuts();
useItems(p, 'knife', 'hundred_ilm_red_banana');
assert.equal(count(p, 'hundred_ilm_sliced_red_banana'), 1, 'native knife use slices the red banana');
useItems(p, 'hundred_ilm_sliced_red_banana', 'hundred_ilm_snake_corpse');
assert.equal(count(p, 'hundred_ilm_sliced_red_banana'), 1, 'one ingredient alone is preserved');
assert.equal(count(p, 'hundred_ilm_snake_corpse'), 2, 'one ingredient alone does not consume the corpse');
useItems(p, 'pestle_and_mortar', 'hundred_ilm_tchiki_monkey_nuts');
assert.equal(count(p, 'hundred_ilm_tchiki_monkey_nut_paste'), 1, 'native pestle use grinds the Tchiki nuts');
useItems(p, 'hundred_ilm_tchiki_monkey_nut_paste', 'hundred_ilm_snake_corpse');
assert.equal(count(p, 'hundred_ilm_correctly_stuffed_snake'), 1, 'banana-first ingredients correctly stuff one snake');
assert.equal(count(p, 'hundred_ilm_sliced_red_banana'), 0);
assert.equal(count(p, 'hundred_ilm_tchiki_monkey_nut_paste'), 0);
assert.equal(count(p, 'hundred_ilm_snake_corpse'), 1);
assert.equal(stage(p), 8, 'correct stuffing advances to the stuffed-snake stage');

// The route still accepts the alternate ingredient order without consuming a partial pair.
pickRedBanana();
pickTchikiNuts();
useItems(p, 'pestle_and_mortar', 'hundred_ilm_tchiki_monkey_nuts');
useItems(p, 'hundred_ilm_tchiki_monkey_nut_paste', 'hundred_ilm_snake_corpse');
assert.equal(count(p, 'hundred_ilm_tchiki_monkey_nut_paste'), 1, 'paste-first partial use is preserved');
assert.equal(count(p, 'hundred_ilm_snake_corpse'), 1, 'paste-first partial use preserves the corpse');
useItems(p, 'knife', 'hundred_ilm_red_banana');
useItems(p, 'hundred_ilm_sliced_red_banana', 'hundred_ilm_snake_corpse');
assert.equal(count(p, 'hundred_ilm_correctly_stuffed_snake'), 2, 'paste-first ingredients correctly stuff another snake');
assert.equal(count(p, 'hundred_ilm_tchiki_monkey_nut_paste'), 0);
assert.equal(count(p, 'hundred_ilm_sliced_red_banana'), 0);
// Shared chamber returns outlast both a long visit and a later visitor's arrival.
assert.equal(count(p, 'mm_monkey_greegree_for_small_ninja_monkey', worn), 1, 'the chamber entry is tested without zombie form');
const mainTrapdoor = World.getLoc(trapdoorRow.x, trapdoorRow.z, trapdoorRow.level, trapdoorClosedId);
assert(mainTrapdoor, 'the native temple trapdoor is closed for the route');
operate(p, mainTrapdoor, 1);
const mainOpenTrapdoor = World.getLoc(trapdoorRow.x, trapdoorRow.z, trapdoorRow.level, trapdoorOpenId);
assert(mainOpenTrapdoor, 'native Open exposes the temple basement route');
operate(p, mainOpenTrapdoor, 1);
assertNear(p, templeBasementTile, 'native Climb-down reaches the basement crack');
operate(p, templeCrack);
assert.deepEqual(tile(p), chamberEntryTile, 'the started route enters the chamber through the native basement crack');
const firstReturnCrack = World.getLoc(chamberReturnTile[1], chamberReturnTile[2], chamberReturnTile[0], exit12617Id);
assert(firstReturnCrack, 'entering the chamber installs its native return crack');
const enteredAt = World.currentTick;
assert(firstReturnCrack.lifecycleTick > 1005, 'the shared return is not a short-lived wrapper');
for (let tick = 0; tick < 995; tick++) {
  World.currentTick++;
  World.processZones();
}
assert.equal(World.currentTick - enteredAt, 995, 'Player A remains inside for 995 ticks before Player B enters');
const chamberVisitor = player();
setBit(chamberVisitor, 'hundred_ilm_quest', 1);
operate(chamberVisitor, templeCrack);
assert.deepEqual(tile(chamberVisitor), chamberEntryTile, 'Player B enters through the same native crack');
for (let tick = 0; tick < 11; tick++) {
  World.currentTick++;
  World.processZones();
}
assert(World.currentTick - enteredAt > 1000, 'both visitors remain inside beyond the old expiry');
const sharedReturnCrack = World.getLoc(chamberReturnTile[1], chamberReturnTile[2], chamberReturnTile[0], exit12617Id);
assert.equal(sharedReturnCrack, firstReturnCrack, 'the original shared return survives the late visitor and more than 1000 ticks');
operate(chamberVisitor, sharedReturnCrack);
assertNear(chamberVisitor, templeCrackTile, 'Player B exits cleanly after the old expiry');
operate(p, sharedReturnCrack);
assertNear(p, templeCrackTile, 'Player A also exits cleanly after the long visit');
World.removeLoc(sharedReturnCrack, 0);
assert.equal(World.getLoc(chamberReturnTile[1], chamberReturnTile[2], chamberReturnTile[0], exit12617Id), null);
operate(p, templeCrack);
assert.deepEqual(tile(p), chamberEntryTile, 'native entry recreates a missing shared return');
const entryRestoredCrack = World.getLoc(chamberReturnTile[1], chamberReturnTile[2], chamberReturnTile[0], exit12617Id);
assert(entryRestoredCrack, 'native entry restores the absent return before teleporting');
assertGreegreeRetained(p, 'mm_monkey_greegree_for_small_ninja_monkey', 'the Ape cooking chamber');
World.removeLoc(entryRestoredCrack, 0);
run(p, '[proc,rfd_awowogei_login]');
const restoredReturnCrack = World.getLoc(chamberReturnTile[1], chamberReturnTile[2], chamberReturnTile[0], exit12617Id);
assert(restoredReturnCrack, 'the login hook also reinstalls a missing chamber return');
operate(p, restoredReturnCrack);
assertNear(p, templeCrackTile, 'the chamber return crack sends the player back beside its basement entry');
operate(p, templeCrack);
assert.deepEqual(tile(p), chamberEntryTile, 'the native basement crack remains a usable route after relog repair');
stand(p, hotRock);
assert.equal(count(p, 'mm_monkey_greegree_for_large_zombie_monkey', worn), 0, 'entering the chamber does not equip or require zombie form');
useLoc(p, 'hundred_ilm_correctly_stuffed_snake', hotRock);
assert.equal(bit(p, '100_ilm_cooking_snake_state'), 0, 'non-zombie cooking is refused after chamber entry');
assert.equal(count(p, 'hundred_ilm_correctly_stuffed_snake'), 2, 'wrong-form cooking preserves the stuffed snake');
const secondReturnCrack = World.getLoc(chamberReturnTile[1], chamberReturnTile[2], chamberReturnTile[0], exit12617Id);
assert(secondReturnCrack, 'the chamber return crack remains available for form setup');
operate(p, secondReturnCrack);
assertNear(p, templeCrackTile, 'the return crack supports the second temple round trip');
useGreegree(p, 'mm_monkey_greegree_for_large_zombie_monkey');
operate(p, templeCrack);
assert.deepEqual(tile(p), chamberEntryTile, 'the player can re-enter after wearing a zombie greegree in the basement');
useGreegree(p, 'mm_monkey_greegree_for_normal_gorilla');
useGreegree(p, 'mm_monkey_greegree_for_large_zombie_monkey');
assertGreegreeRetained(p, 'mm_monkey_greegree_for_large_zombie_monkey', 'the Ape cooking chamber');
assert.equal(count(p, 'mm_monkey_greegree_for_large_zombie_monkey', worn), 1, 'the cook enters the chamber in zombie form');

// The long rock exposes raw/cooked/reset states through the delayed native action.
stand(p, hotRock);
const cooking = useLocDeferred(p, 'hundred_ilm_correctly_stuffed_snake', hotRock);
assert.equal(cooking.execution, ScriptState.SUSPENDED, 'native cooking waits for the configured animation cycle');
assert.equal(bit(p, '100_ilm_cooking_snake_state'), 1, 'the rock enters its raw cooking state');
assert.equal(count(p, 'hundred_ilm_correctly_stuffed_snake'), 2, 'the snake is not consumed before the first delay');
resumeDelay(p, cooking);
assert.equal(cooking.execution, ScriptState.SUSPENDED);
assert.equal(bit(p, '100_ilm_cooking_snake_state'), 3, 'the rock shows the cooked intermediate state');
assert.equal(count(p, 'hundred_ilm_correctly_stuffed_snake'), 1);
assert.equal(count(p, 'hundred_ilm_cooked_stuffed_snake'), 1);
assert.equal(stage(p), 9, 'cooking advances to the ready-to-hand-in stage');
resumeDelay(p, cooking);
assert.equal(cooking.execution, ScriptState.FINISHED);
assert.equal(bit(p, '100_ilm_cooking_snake_state'), 0, 'the original rock returns to its idle state');
assert.equal(count(p, 'hundred_ilm_cooked_stuffed_snake'), 1);

// The spell is locked before hand-in and consumes its original runes only after the frozen guest is rescued.
position(p, [0, 1861, 5317]);
cycleGreegreeTimer(p);
assert.equal(count(p, 'mm_monkey_greegree_for_large_zombie_monkey', worn), 0,
  'leaving Ape Atoll natively restores human form and the magic tab before spell checks');
setVar(p, 'alternate_spells', 0);
skill(p, 'magic', 64);
give(p, 'banana');
give(p, 'firerune', 2);
give(p, 'waterrune', 2);
give(p, 'lawrune', 2);
const beforeLockedTeleport = tile(p);
const beforeLockedMagicXp = p.stats[PlayerStat.MAGIC];
capture(p, () => assert.equal(buttonHandler.handle(new IfButton(com('magic:com_569')), p), true));
assert.deepEqual(tile(p), beforeLockedTeleport, 'Ape Atoll teleport is blocked before the rescue');
assert.equal(count(p, 'banana'), 1, 'the refused pre-rescue teleport preserves its banana');
assert.equal(count(p, 'firerune'), 2);
assert.equal(count(p, 'waterrune'), 2);
assert.equal(count(p, 'lawrune'), 2);
assert.equal(p.stats[PlayerStat.MAGIC], beforeLockedMagicXp, 'the refused pre-rescue spell awards no Magic XP');

const handInTarget = guestLoc(frozenGuestBase);
run(p, '[proc,update_questpoints]');
const beforeReward = captureReward(p);
useLoc(p, 'hundred_ilm_cooked_stuffed_snake', handInTarget);
assert.equal(stage(p), guestStageComplete, 'native frozen-guest hand-in writes the terminal guest stage');
assert.equal(bit(p, '100monkeyvisible'), 0, 'once-only reward clears the frozen guest visibility latch');
assert.equal(count(p, 'hundred_ilm_cooked_stuffed_snake'), 0, 'native hand-in consumes one cooked stuffed snake');
assert.equal(p.stats[PlayerStat.COOKING] - beforeReward.cooking, 100000, 'guest 8 awards 10,000 Cooking XP');
assert.equal(p.stats[PlayerStat.AGILITY] - beforeReward.agility, 100000, 'guest 8 awards 10,000 Agility XP');
assert.equal(p.stats[PlayerStat.HITPOINTS], beforeReward.hitpoints, 'guest 8 does not add Hitpoints XP');
assert.equal(p.getVar(id('VarPlayerType', 'qp')), beforeReward.qp + 1, 'the completed guest adds one quest point');
assert.equal(bit(p, 'hundred_subquest_tally'), beforeReward.tally + 1, 'the completed guest increments the original tally once');
const settledReward = captureReward(p);
run(p, '[proc,rfd_guest_reward]', { args: [8] });
assert.deepEqual(captureReward(p), settledReward, 'repeated shared reward call cannot duplicate XP, tally or QP');
assert.equal(run(p, '[proc,rfd_food_shop]').popInt(), id('InvType', 'hundred_foodchest9'), 'the eighth rescue unlocks food tier nine before the finale');
assert.equal(run(p, '[proc,rfd_item_shop]').popInt(), id('InvType', 'hundred_rewardchest9'), 'the eighth rescue unlocks equipment tier nine before the finale');

function castApeTeleport() {
  capture(p, () => assert.equal(buttonHandler.handle(new IfButton(com('magic:com_569')), p), true));
}
function teleportSnapshot() {
  return {
    tile: tile(p), xp: p.stats[PlayerStat.MAGIC],
    supplies: ['banana', 'firerune', 'waterrune', 'lawrune'].map(item => count(p, item))
  };
}
function assertTeleportRefused(label) {
  const before = teleportSnapshot();
  castApeTeleport();
  assert.deepEqual(teleportSnapshot(), before, `${label} preserves position, Magic XP and supplies`);
}
skill(p, 'magic', 63);
assertTeleportRefused('63 Magic');
skill(p, 'magic', 64);
remove(p, 'banana');
assertTeleportRefused('missing banana');
give(p, 'banana');
for (const rune of ['firerune', 'waterrune', 'lawrune']) {
  remove(p, rune);
  assertTeleportRefused(`missing ${rune}`);
  give(p, rune, 2);
}
setVar(p, 'alternate_spells', 1);
assertTeleportRefused('the ancient spellbook');
setVar(p, 'alternate_spells', 0);
setVar(p, 'teleblock_until', World.currentTick + 100);
assertTeleportRefused('active Tele Block');
setVar(p, 'teleblock_until', 0);
position(p, [0, 3200, 3800]);
assertTeleportRefused('Wilderness above level 20');
position(p, [0, 1861, 5317]);
const beforeTeleport = teleportSnapshot();
castApeTeleport();
assert.notDeepEqual(tile(p), beforeTeleport.tile, 'the unlocked Ape Atoll spell teleports through the native spell button');
inRegion(p, 43, 43);
assert.equal(p.level, 1, 'the native spell arrives upstairs beside Hafuba');
assert(Math.max(Math.abs(p.x - (43 * 64 + 44)), Math.abs(p.z - (43 * 64 + 46))) <= 2,
  'the spell arrives within its configured safe upstairs landing area');
walkable(tile(p), 'Ape Atoll spell landing');
assert.equal(p.stats[PlayerStat.MAGIC] - beforeTeleport.xp, 740, 'the native spell awards 74 Magic XP');
for (const rune of ['firerune', 'waterrune', 'lawrune']) assert.equal(count(p, rune), 0, `${rune} is consumed by the native teleport`);
assert.equal(count(p, 'banana'), 0, 'the successful Ape Atoll spell consumes its banana');
give(p, 'staff_of_fire');
equip(p, 'staff_of_fire');
give(p, 'banana');
give(p, 'waterrune', 2);
give(p, 'lawrune', 2);
position(p, [0, 1861, 5317]);
const beforeStaffTeleport = p.stats[PlayerStat.MAGIC];
castApeTeleport();
inRegion(p, 43, 43);
assert.equal(p.level, 1, 'a fire staff also reaches the upstairs destination');
walkable(tile(p), 'staff-assisted Ape Atoll spell landing');
assert.equal(p.stats[PlayerStat.MAGIC] - beforeStaffTeleport, 740, 'a staff-assisted cast awards the same 74 Magic XP');
assert.equal(count(p, 'firerune'), 0, 'the worn fire staff supplies the missing fire runes');
assert.equal(count(p, 'staff_of_fire', worn), 1, 'the native spell preserves its elemental staff');
for (const supply of ['banana', 'waterrune', 'lawrune']) {
  assert.equal(count(p, supply), 0, `${supply} is consumed by the staff-assisted cast`);
}

for (const item of [
  'hundred_ilm_red_banana', 'hundred_ilm_tchiki_monkey_nuts', 'hundred_ilm_sliced_red_banana',
  'hundred_ilm_tchiki_monkey_nut_paste', 'hundred_ilm_snake_corpse',
  'hundred_ilm_correctly_stuffed_snake', 'hundred_ilm_incorrectly_stuffed_snake',
  'hundred_ilm_cooked_stuffed_snake', '100_ilm_snake_burnt'
]) {
  assert.equal(types.ObjType.get(obj(item)).tradeable, false, `${item} is server-untradeable`);
}
console.log('PASS RFD Awowogei: inspect gates, MM route, original pit/hole and tree actions, snake drops, prepared recipe, hot-rock cycle, frozen rescue, reward and Ape Atoll teleport');
process.exit(0);
