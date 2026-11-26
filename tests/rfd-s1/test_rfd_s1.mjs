// Built-pack integration: native visible-form dispatch, map collision, settlement and shared owners.
import assert from 'node:assert/strict';
import {
  World, ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType, types, map,
  nativeLocRows, nativeLocInventory, floorTiles, nativeLoc, nativeNpc, player, position, tile,
  skill, PlayerStat, id, obj, inv, worn, bank, com, bit, setBit, setVar, count, give,
  run, talk, operate, useLoc, useItems, remove, clear, text, capture, load, walkable, CollisionType, stand, equip
} from './runtime.mjs';
const Environment = await load('util/Environment.ts');
assert.equal(Environment.NODE_XPRATE, 1, 'reward oracle uses unmultiplied XP tenths');
assert.equal(Environment.NODE_MEMBERS, true, 'members quest configs are available');
const IfButton = await load('network/game/client/model/IfButton.ts');
const IfButtonHandler = await load('network/game/client/handler/IfButtonHandler.ts');
const InvButton = await load('network/game/client/model/InvButton.ts');
const InvButtonHandler = await load('network/game/client/handler/InvButtonHandler.ts');
const OpObj = await load('network/game/client/model/OpObj.ts');
const OpObjHandler = await load('network/game/client/handler/OpObjHandler.ts');
const OpLoc = await load('network/game/client/model/OpLoc.ts');
const OpLocHandler = await load('network/game/client/handler/OpLocHandler.ts');
const MoveClick = await load('network/game/client/model/MoveClick.ts');
const MoveClickHandler = await load('network/game/client/handler/MoveClickHandler.ts');
const ResumePauseButton = await load('network/game/client/model/ResumePauseButton.ts');
const ResumePauseButtonHandler = await load('network/game/client/handler/ResumePauseButtonHandler.ts');
const cook = nativeNpc('cook');
const murphy = nativeNpc('murphy');
const kitchenDoor = nativeLoc('hundred_lumbridge_door', rows => rows.find(row => row.x > 3000));
const banquetDoor = nativeLoc('hundred_lumbridge_door', rows => rows.find(row => row.x < 2000));
const qp = p => p.getVar(id('VarPlayerType', 'qp'));
const stage = p => bit(p, 'hundred_main_quest_var');
const peteStage = p => bit(p, '100_pirate_quest_var');
const tally = p => bit(p, 'hundred_subquest_tally');
function route(level, start, destination, bounds) {
  const queue = [start];
  const seen = new Set([start.join(',')]);
  for (let index = 0; index < queue.length; index++) {
    const [x, z] = queue[index];
    if (x === destination[0] && z === destination[1]) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const to = [x + dx, z + dz];
      const key = to.join(',');
      if (seen.has(key) || to[0] < bounds[0] || to[0] > bounds[1] || to[1] < bounds[2] || to[1] > bounds[3]) continue;
      if (!floorTiles.has(`${level},${to[0]},${to[1]}`) || !map.canTravel(level, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
      seen.add(key);
      queue.push(to);
    }
  }
  return false;
}
function assertLanding(at, label, destination, bounds) {
  walkable(at, label);
  assert(route(at[0], at.slice(1), destination, bounds), `${label} routes to an independent original-map landmark`);
  assert(map.findPath(at[0], at[1], at[2], destination[0], destination[1]).length > 0, `${label} has a nonempty engine findPath route out`);
}
function guestLoc(base) {
  const row = nativeLocRows(base)[0];
  assert(row, `${base} has original placement`);
  const multi = base.replace(/_base$/, '_multi');
  const target = World.getLoc(row.x, row.z, row.level, id('LocType', multi));
  assert(target, `${base} is replaced with its original cache multi wrapper`);
  return target;
}
function visibleLoc(p, target) {
  const type = types.LocType.get(target.type);
  const selector = type.multivarbit !== -1 ? p.getVarBit(type.multivarbit) : p.getVar(type.multivarp);
  return type.multiloc[selector] ?? -1;
}
function snapshot(p) { return { xp: [...p.stats], tally: tally(p), qp: qp(p) }; }
function rewardDelta(p, before, names) {
  for (let index = 0; index < p.stats.length; index++) {
    const expected = names.some(name => PlayerStat[name] === index) ? 10000 : 0;
    assert.equal(p.stats[index] - before.xp[index], expected, `reward skill ${index} in tenths`);
  }
  assert.equal(tally(p), before.tally + 1, 'one guest increments tally once');
  assert.equal(qp(p), before.qp + 1, 'one guest adds exactly one QP');
}
const blocked = player();
const kitchenStart = stand(blocked, kitchenDoor);
operate(blocked, kitchenDoor);
assert.equal(stage(blocked), 0);
assert.deepEqual(tile(blocked), kitchenStart, 'uninvited account stays outside');

// Interrupt each real entry message with a ground click, not an auto-drained script.
const entryMessages = [
  "The guests gather for the cook's banquet.",
  'The Culinaromancer attacks. The gypsy stops time to protect the guests.'
];
const frozenSelectors = ['100dwarfvisible', '100goblinsvisible', '100piratevisible', '100guidevisible', '100davevisible', '100ogrevisible', '100amikvisible', '100monkeyvisible', '100culinaromancervisible'];
for (let message = 0; message < entryMessages.length; message++) {
  const interrupted = player();
  setVar(interrupted, 'cookquest', 2);
  setBit(interrupted, 'hundred_main_quest_var', 2);
  stand(interrupted, kitchenDoor);
  assert.equal(new OpLocHandler().handle(new OpLoc(1, kitchenDoor.x, kitchenDoor.z, kitchenDoor.type), interrupted), true);
  assert(interrupted.tryInteract(true), 'native door action starts the feast entry');
  assert.equal(interrupted.activeScript?.execution, ScriptState.PAUSEBUTTON);
  if (message === 1) {
    assert.equal(new ResumePauseButtonHandler().handle(new ResumePauseButton(0), interrupted), true);
    assert.equal(interrupted.activeScript?.execution, ScriptState.PAUSEBUTTON);
  }
  assert(text(interrupted).includes(entryMessages[message]), `entry message ${message + 1} is actually displayed`);
  const paused = interrupted.activeScript;
  assert.equal(new MoveClickHandler().handle(new MoveClick([{ x: interrupted.x, z: interrupted.z + 1 }], 0, false), interrupted), true);
  assert.equal(interrupted.activeScript, null, `ground click aborts entry message ${message + 1}`);
  assert.equal(paused.execution, ScriptState.PAUSEBUTTON, 'the cancelled script did not run its remaining instructions');
  assert.equal(stage(interrupted), 3, 'interruption preserves the committed frozen stage');
  for (const name of frozenSelectors) assert.equal(bit(interrupted, name), 1, `${name} survives interrupted entry`);
  assert.deepEqual(tile(interrupted), [0, 1861, 5317], 'interruption leaves the player in the banquet room, not the sealed feast room');
  assertLanding(tile(interrupted), 'interrupted banquet entry', [1861, 5318], [1856, 1871, 5312, 5331]);
  assert(interrupted.inOperableDistance(banquetDoor), 'the interrupted landing is beside the original exit');
  operate(interrupted, banquetDoor, 1, { from: tile(interrupted) });
  assert.deepEqual(tile(interrupted), [0, 3207, 3216], 'the native exit remains usable after interruption');
  assert.equal(stage(interrupted), 3, 'using the exit does not roll back the committed stage');
}

// Shared Cook priority: unfinished Cook\'s Assistant, clues and Lost Tribe keep ownership.
setVar(blocked, 'cookquest', 1);
setBit(blocked, 'hundred_main_quest_var', 3);
setBit(blocked, '100_pirate_quest_var', 1);
talk(blocked, cook);
assert.equal(peteStage(blocked), 1, 'Cook\'s Assistant branch does not teach Pete recipe');
assert.match(text(blocked), /milk|flour|egg/i);
const clue = player();
setVar(clue, 'cookquest', 2);
setBit(clue, 'hundred_main_quest_var', 3);
setBit(clue, '100_pirate_quest_var', 1);
give(clue, 'trail_clue_medium_anagram002');
talk(clue, cook);
assert.equal(count(clue, 'trail_clue_medium_anagram002_challenge'), 1, 'Cook clue still wins over RFD');
assert.equal(peteStage(clue), 1);
const witness = player();
setVar(witness, 'cookquest', 2);
setBit(witness, 'hundred_main_quest_var', 3);
setBit(witness, '100_pirate_quest_var', 1);
setBit(witness, 'lost_tribe_quest', 1);
setBit(witness, 'lost_tribe_contact', 2);
talk(witness, cook, [1]);
assert.equal(bit(witness, 'lost_tribe_quest'), 2, 'Cook Lost Tribe witness still progresses');
assert.equal(peteStage(witness), 1);

const p = player();
setVar(p, 'cookquest', 2);
run(p, '[proc,update_questpoints]');
skill(p, 'cooking', 9);
talk(p, cook, [1]);
assert.equal(stage(p), 0, '9 Cooking cannot start');
assert.equal(count(p, 'coins'), 0, 'refusal pays no expenses');
give(p, 'ashes');
give(p, 'fruit_blast');
useItems(p, 'ashes', 'fruit_blast');
assert.equal(count(p, 'fruit_blast'), 1, 'Dirty Blast cannot be made before start');
assert.equal(count(p, 'hundred_fruit_blast'), 0);
skill(p, 'cooking', 10);
talk(p, cook, [1, 2, 1, 1]);
assert.equal(stage(p), 1);
assert.equal(count(p, 'coins'), 100, 'start pays expenses exactly once');
give(p, 'premade_fruit_blast');
useItems(p, 'ashes', 'premade_fruit_blast');
assert.equal(count(p, 'premade_fruit_blast'), 1, 'premade blast is not accepted');
assert.equal(count(p, 'hundred_fruit_blast'), 0);
useItems(p, 'ashes', 'fruit_blast');
assert.equal(count(p, 'hundred_fruit_blast'), 1, 'fresh blast and ashes produce Dirty Blast');
assert.equal(count(p, 'ashes'), 0);
give(p, 'eye_of_newt');
give(p, 'greenmans_ale');
talk(p, cook, [1]);
assert.equal(stage(p), 1, 'partial hand-in leaves stage and every item intact');
assert.equal(count(p, 'hundred_fruit_blast'), 1);
give(p, 'rotten_tomato');
const introQp = qp(p);
talk(p, cook);
assert.equal(stage(p), 2);
assert.equal(qp(p), introQp + 1, 'Another Cook awards one QP');
for (const name of ['eye_of_newt', 'greenmans_ale', 'rotten_tomato', 'hundred_fruit_blast']) assert.equal(count(p, name), 0);
const handinQp = qp(p);
talk(p, cook);
assert.equal(qp(p), handinQp, 'repeat Cook talk does not award again');
operate(p, kitchenDoor);
assert.equal(stage(p), 3, 'first entry writes the frozen banquet stage');
assert.deepEqual(tile(p), [0, 1861, 5317]);
assertLanding(tile(p), 'banquet landing', [1861, 5318], [1856, 1871, 5312, 5331]);
for (const name of ['100dwarfvisible', '100goblinsvisible', '100piratevisible', '100guidevisible', '100davevisible', '100ogrevisible', '100amikvisible', '100monkeyvisible', '100culinaromancervisible']) assert.equal(bit(p, name), 1, `${name} frozen selector`);
for (const name of ['hundred_dwarf_ambassador_base', 'hundred_goblin1_base', 'hundred_goblin2_base', 'hundred_pirate_base', 'hundred_guide_base', 'hundred_dave_base', 'hundred_ogre_base', 'hundred_varze_base']) {
  assert.equal(visibleLoc(p, guestLoc(name)), id('LocType', name), `${name} visible frozen form`);
}
const pete = guestLoc('hundred_pirate_base');
operate(p, banquetDoor, 1, { from: [0, 1861, 5317] });
assert.deepEqual(tile(p), [0, 3207, 3216]);
assertLanding(tile(p), 'kitchen return', [3207, 3215], [3200, 3214, 3208, 3220]);
operate(p, kitchenDoor);
assert.equal(tally(p), 0, 're-entry does not produce any rescue');
const aris = nativeNpc('hundred_aris');
for (const [choice, flag] of [[1, 'hundred_timebubble_exposition'], [2, 'hundred_chest_exposition']]) {
  const state = talk(p, aris, [choice]);
  assert.equal(state.script.name, '[opnpc1,hundred_aris_base]', 'Aris resolves visible cache form');
  assert.equal(bit(p, flag), 1);
}
talk(p, aris, [3]);

const chest = nativeLoc('hundred_goodchest');
for (const total of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
  setBit(p, 'hundred_subquest_tally', total);
  for (const [option, prefix] of [[2, 'hundred_foodchest'], [3, 'hundred_rewardchest']]) {
    const state = operate(p, chest, option);
    assert.equal(state.script.name, `[oploc${option},hundred_goodchest_base]`, 'chest selects visible form');
    assert.equal(p.getVar(id('VarPlayerType', 'shop')), id('InvType', `${prefix}${total + 1}`), 'each rescue advances one stock tier');
  }
}
setBit(p, 'hundred_main_quest_var', 5);
for (const [option, prefix] of [[2, 'hundred_foodchest'], [3, 'hundred_rewardchest']]) {
  operate(p, chest, option);
  assert.equal(p.getVar(id('VarPlayerType', 'shop')), id('InvType', `${prefix}10`), 'finale unlocks final tier, not the eighth rescue alone');
}
setBit(p, 'hundred_main_quest_var', 3);
setBit(p, 'hundred_subquest_tally', 0);
operate(p, chest, 1);
assert.equal(p.modalMain, com('bank_main'), 'original Bank option opens real banking interface');
operate(p, chest, 3);
const shop = p.getVar(id('VarPlayerType', 'shop'));
const shopItems = p.getInventory(shop);
const spoonSlot = shopItems.getItemIndex(obj('hundred_spoon'));
assert.notEqual(spoonSlot, -1, 'first chest tier stocks original spoon');
give(p, 'coins', 1000);
const beforeBuy = count(p, 'coins');
capture(p, () => assert.equal(new InvButtonHandler().handle(new InvButton(2, obj('hundred_spoon'), spoonSlot, com('shop_template:inv')), p), true));
assert.equal(count(p, 'hundred_spoon'), 1, 'native shop Buy-1 delivers spoon');
assert(count(p, 'coins') < beforeBuy, 'native shop debits coins');

// Pete: native Inspect and all required product stages, with no writes to Pete after Inspect.
skill(p, 'cooking', 30);
operate(p, pete);
assert.equal(peteStage(p), 0, '30 Cooking cannot inspect Pete');
skill(p, 'cooking', 31);
operate(p, pete);
assert.equal(peteStage(p), 1);
give(p, 'hundred_pirate_fishcake');
useLoc(p, 'hundred_pirate_fishcake', pete);
assert.equal(peteStage(p), 1, 'early fishcake does not bypass underwater progression');
assert.equal(count(p, 'hundred_pirate_fishcake'), 1);
remove(p, 'hundred_pirate_fishcake');
talk(p, murphy, [1]);
assert.equal(peteStage(p), 1, 'Murphy needs recipe from Cook');
talk(p, cook, [1]);
assert.equal(peteStage(p), 2);
const fullGear = player();
setBit(fullGear, '100_pirate_quest_var', 2);
give(fullGear, 'fishbowl_empty');
for (let slot = 1; slot < 28; slot++) give(fullGear, 'bronze_dagger');
assert.equal(fullGear.getInventory(inv).freeSlotCount, 0);
talk(fullGear, murphy, [1]);
assert.equal(count(fullGear, 'fishbowl_empty'), 1, 'full inventory does not consume fishbowl');
assert.equal(count(fullGear, 'hundred_pirate_diving_helmet'), 0);
for (const flag of ['hundred_pirate_meat_intro', 'hundred_pirate_kelp_intro', 'hundred_pirate_crumb_intro', 'hundred_pirate_cod_intro']) assert.equal(bit(p, flag), 1);
talk(p, murphy, [1]);
assert.equal(count(p, 'hundred_pirate_diving_helmet'), 0, 'fishbowl required');
give(p, 'fishbowl_empty');
talk(p, murphy, [1]);
assert.equal(peteStage(p), 3);
for (const name of ['hundred_pirate_diving_helmet', 'hundred_pirate_diving_backpack']) assert.equal(count(p, name), 1);
assert.equal(count(p, 'fishbowl_empty'), 0);
// Equipment loss and banked equipment recovery use the real total-inventory helper.
remove(p, 'hundred_pirate_diving_backpack');
talk(p, murphy, [1]);
assert.equal(count(p, 'hundred_pirate_diving_backpack'), 1);
remove(p, 'hundred_pirate_diving_helmet');
give(p, 'hundred_pirate_diving_helmet', 1, bank);
talk(p, murphy, [1]);
assert.equal(count(p, 'hundred_pirate_diving_helmet'), 0, 'banked helmet is not duplicated');
assert.equal(count(p, 'hundred_pirate_diving_helmet', bank), 1);
remove(p, 'hundred_pirate_diving_helmet', bank);
give(p, 'hundred_pirate_diving_helmet');
for (const name of ['hundred_pirate_diving_helmet', 'hundred_pirate_diving_backpack']) equip(p, name);
p.calculateRunWeight();
const baseWeight = p.runweight;
assert(baseWeight <= 27000);
give(p, 'bronze_platebody', 4);
p.calculateRunWeight();
assert(p.runweight > 27000, 'ordinary equipment fixture is genuinely overweight');
talk(p, murphy, [1]);
assert.equal(p.level, 0, 'overweight player stays at surface');
clear(p);
give(p, 'kittenobject');
p.calculateRunWeight();
talk(p, murphy, [1]);
assert.equal(p.level, 0, 'carried cat stays at surface');
clear(p);
setVar(p, 'follower_obj', obj('kittenobject'));
talk(p, murphy, [1]);
assert.equal(p.level, 0, 'following cat stays at surface');
setVar(p, 'follower_obj', -1);
p.calculateRunWeight();
talk(p, murphy, [1]);
assert.deepEqual(tile(p), [1, 2963, 9479], 'native Murphy dialogue dives to mapped seabed');
assertLanding(tile(p), 'dive landing', [2963, 9480], [2944, 3007, 9472, 9535]);
assert.equal(bit(p, 'hundred_pirate_first_dive'), 1);
const anchor = nativeLoc('anchor_middle', rows => rows.find(row => row.level === 1));
const kelp = nativeLoc('kelp_pickingpoint', rows => rows.find(row => row.level === 1));
operate(p, kelp);
assert.equal(count(p, 'hundred_pirate_kelp'), 1, 'native Pick supplies kelp');
const entrance = nativeLoc('seabed2_cavewall_mudskipper_caveentrancel', rows => rows.find(row => row.level === 1));
operate(p, entrance);
assert.equal(bit(p, 'hundred_pirate_underwater_onfloor'), 0, 'cavern requires rocks');
const rockSpawns = [[2948, 9508], [2948, 9510], [2949, 9513], [2950, 9508], [2952, 9508]];
for (const [x, z] of rockSpawns) {
  const ground = World.getObj(x, z, 1, obj('hundred_pirate_rock'), p.hash64);
  assert(ground, 'original underwater map provides a rock ground object');
  position(p, [1, x, z]);
  assert.equal(new OpObjHandler().handle(new OpObj(3, x, z, ground.type), p), true);
  capture(p, () => p.processInteraction());
}
assert.equal(count(p, 'hundred_pirate_rock'), 5, 'native Take gathers five original-map rocks');
operate(p, entrance);
assert.deepEqual(tile(p), [1, 2949, 9520]);
assertLanding(tile(p), 'mudskipper cavern', [2948, 9522], [2944, 2960, 9518, 9535]);
const nung = nativeNpc('100_pirate_mogre_nung');
talk(p, nung);
assert.equal(peteStage(p), 4);
// Execute each genuine mapped creature\'s standard death trigger and Take its private loot.
const creatureCounts = new Map();
function killForItem(name, item) {
  const occurrence = creatureCounts.get(name) ?? 0;
  const actor = nativeNpc(name, rows => rows[occurrence]);
  creatureCounts.set(name, occurrence + 1);
  const type = types.NpcType.get(actor.type);
  const spawn = ScriptProvider.getByTrigger(ServerTriggerType.AI_SPAWN, type.id, type.category);
  assert(spawn);
  actor.executeScript(ScriptRunner.init(spawn, actor));
  actor.heroPoints.addHero(p.hash64, 100);
  actor.setVar(id('VarNpcType', 'npc_aggressive_player'), p.uid);
  const death = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, type.id, type.category);
  assert(death);
  const state = ScriptRunner.init(death, actor);
  actor.applyDamage(actor.levels[3], 1);
  actor.executeScript(state);
  for (let tick = 0; state.execution === ScriptState.NPC_SUSPENDED && tick < 20; tick++) {
    p.processQueues();
    World.currentTick = Math.max(World.currentTick + 1, actor.delayedUntil);
    actor.delayed = false;
    actor.executeScript(state);
  }
  p.processQueues();
  assert.equal(state.execution, ScriptState.FINISHED, `${name} standard death finishes`);
  const ground = World.getObj(actor.x, actor.z, actor.level, obj(item), p.hash64);
  assert(ground, `${name} standard death supplies ${item}`);
  position(p, [actor.level, actor.x, actor.z]);
  assert.equal(new OpObjHandler().handle(new OpObj(3, actor.x, actor.z, ground.type), p), true);
  capture(p, () => p.processInteraction());
  return actor;
}
for (let number = 0; number < 5; number++) killForItem('hundred_pirate_giant_mudskipper', 'hundred_pirate_mudskipper_hide');
assert.equal(count(p, 'hundred_pirate_mudskipper_hide'), 5);
talk(p, nung);
assert.equal(peteStage(p), 5);
assert.equal(count(p, 'hundred_pirate_mudskipper_hide'), 0);
talk(p, nung);
assert.equal(peteStage(p), 5, 'missing wire and needle cannot open pen');
const pen = nativeLoc('pen_wall_doorl', rows => rows.find(row => row.level === 1));
operate(p, pen, 1, { from: [1, 2974, 9513] });
assert.deepEqual(tile(p), [1, 2974, 9513], 'native pen approach refuses entry before Nung receives the wire and needle');
assert.equal(peteStage(p), 5);
give(p, 'bronzecraftwire', 3);
give(p, 'needle');
talk(p, nung);
assert.equal(peteStage(p), 6);
assert.equal(count(p, 'bronzecraftwire'), 0);
assert.equal(count(p, 'needle'), 0);
const cavernExit = nativeLoc('seabed2_cavewall_mudskipper_caveexitl', rows => rows.find(row => row.level === 1));
operate(p, cavernExit);
assert.deepEqual(tile(p), [1, 2949, 9514]);
assertLanding(tile(p), 'cavern return', [2949, 9513], [2944, 3007, 9472, 9535]);
operate(p, pen, 1, { accept: at => at[2] <= 9513, from: [1, 2974, 9513] });
assert.deepEqual(tile(p), [1, 2974, 9516]);
assertLanding(tile(p), 'crab pen', [2972, 9516], [2967, 2980, 9515, 9524]);
killForItem('hundred_pirate_giant_crab', 'hundred_pirate_giant_crab_meat');
operate(p, pen, 1, { accept: at => at[2] >= 9515 });
assert.deepEqual(tile(p), [1, 2974, 9512]);
assertLanding(tile(p), 'pen return', [2973, 9512], [2965, 2982, 9505, 9513]);
operate(p, anchor);
assert.deepEqual(tile(p), [0, 2667, 3161]);
assertLanding(tile(p), 'surface return', [2666, 3161], [2655, 2680, 3150, 3170]);

give(p, 'pestle_and_mortar');
give(p, 'raw_cod');
give(p, 'bread');
give(p, 'knife');
for (const [raw, ground] of [['raw_cod', 'hundred_pirate_ground_cod'], ['hundred_pirate_kelp', 'hundred_pirate_ground_kelp'], ['hundred_pirate_giant_crab_meat', 'hundred_pirate_ground_giant_crab_meat']]) {
  useItems(p, 'pestle_and_mortar', raw);
  assert.equal(count(p, ground), 1);
}
useItems(p, 'hundred_pirate_ground_cod', 'hundred_pirate_ground_kelp');
assert.equal(count(p, 'hundred_pirate_raw_fishcake'), 0, 'incomplete four-part mix produces nothing');
assert.equal(count(p, 'hundred_pirate_ground_cod'), 1, 'incomplete mix consumes nothing');
useItems(p, 'knife', 'bread');
assert.equal(count(p, 'hundred_pirate_breadcrumbs'), 1);
skill(p, 'cooking', 30);
useItems(p, 'hundred_pirate_ground_cod', 'hundred_pirate_breadcrumbs');
assert.equal(count(p, 'hundred_pirate_raw_fishcake'), 0, 'assembly enforces 31 Cooking');
skill(p, 'cooking', 31);
useItems(p, 'hundred_pirate_ground_cod', 'hundred_pirate_breadcrumbs');
assert.equal(count(p, 'hundred_pirate_raw_fishcake'), 1);
for (const name of ['hundred_pirate_ground_cod', 'hundred_pirate_ground_kelp', 'hundred_pirate_ground_giant_crab_meat', 'hundred_pirate_breadcrumbs']) assert.equal(count(p, name), 0, 'mix consumes each of four inputs');
const cookRange = nativeLoc('cooksquestrange');
useLoc(p, 'hundred_pirate_raw_fishcake', cookRange);
assert.equal(count(p, 'hundred_pirate_fishcake'), 1, 'shared Cook range cooks quest fishcake');
const beforeReward = snapshot(p);
useLoc(p, 'hundred_pirate_fishcake', pete);
assert.equal(peteStage(p), 10);
assert.equal(bit(p, '100piratevisible'), 0);
assert.equal(count(p, 'hundred_pirate_fishcake'), 0);
rewardDelta(p, beforeReward, ['COOKING', 'CRAFTING', 'FISHING', 'SMITHING']);
assert.equal(visibleLoc(p, pete), id('LocType', 'empty_chair'), 'rescued Pete leaves the original empty chair for this player');
const other = player();
setBit(other, 'hundred_main_quest_var', 3);
setBit(other, '100piratevisible', 1);
assert.equal(visibleLoc(other, pete), id('LocType', 'hundred_pirate_base'), 'other player retains frozen Pete');
const settled = snapshot(p);
run(p, '[proc,rfd_guest_reward]', { args: [3] });
assert.deepEqual(snapshot(p), settled, 'repeated reward proc is inert');
run(p, '[proc,update_questpoints]');
assert.equal(qp(p), settled.qp, 'recomputation preserves additive RFD QP');
p.calculateRunWeight();
talk(p, murphy, [1]);
assert.equal(p.level, 1, 'underwater access remains after rescue');
operate(p, anchor);

// Shared Murphy still offers Fishing Trawler and sextant priority during Pete.
const trawler = player();
setBit(trawler, '100_pirate_quest_var', 1);
setVar(trawler, 'trawler', 1);
talk(trawler, murphy, [2, 1]);
assert.match(text(trawler), /land lover|ill from last time/i);
assert.equal(peteStage(trawler), 1);
give(trawler, 'trail_clue_hard_sextant001');
setVar(trawler, 'trail_status', 1 << 5);
talk(trawler, murphy);
assert.equal(count(trawler, 'trail_sextant'), 1, 'sextant clue still wins over dive menu');

// Shared knife and cooking hooks preserve ordinary recipes and Cook range refusal.
const ordinary = player();
give(ordinary, 'knife');
give(ordinary, 'lemon');
useItems(ordinary, 'knife', 'lemon', [1]);
assert.equal(count(ordinary, 'lemon_slices'), 1, 'ordinary knife recipe unchanged');
give(ordinary, 'hundred_pirate_raw_fishcake');
setBit(ordinary, '100_pirate_quest_var', 6);
useLoc(ordinary, 'hundred_pirate_raw_fishcake', cookRange);
assert.equal(count(ordinary, 'hundred_pirate_raw_fishcake'), 1, 'Cook\'s Assistant still protects special range');
assert.equal(count(ordinary, 'hundred_pirate_fishcake'), 0);
const ovenRow = nativeLocInventory().find(row => row.name !== 'cooksquestrange' && types.LocType.get(row.id).category === id('CategoryType', 'cooking_oven'));
assert(ovenRow, 'an original generic cooking oven is mapped');
const oven = nativeLoc(ovenRow.name, rows => rows.find(row => row.level === ovenRow.level && row.x === ovenRow.x && row.z === ovenRow.z));
skill(ordinary, 'cooking', 99);
give(ordinary, 'raw_shrimp');
const ordinaryXp = ordinary.stats[PlayerStat.COOKING];
useLoc(ordinary, 'raw_shrimp', oven);
assert.equal(count(ordinary, 'raw_shrimp'), 0);
assert.equal(count(ordinary, 'shrimp'), 1, 'generic oven still cooks an ordinary recipe');
assert.equal(ordinary.stats[PlayerStat.COOKING] - ordinaryXp, 300, 'ordinary cooking XP is unchanged');

// Original journal buttons use their real compiled IF_BUTTON triggers and close listeners.
run(p, '[if_button,questlist:hundred_main]');
assert.equal(p.modalMain, com('recipe_for_disaster'));
for (const [button, heading] of [[2, 'Mountain Dwarf'], [3, 'Goblin Generals'], [4, 'Pirate Pete']]) {
  run(p, '[if_button,questlist:hundred_main]');
  capture(p, () => assert.equal(new IfButtonHandler().handle(new IfButton(com(`recipe_for_disaster:com_${button}`)), p), true));
  assert.match(text(p), new RegExp(heading));
}
console.log('PASS RFD Slice 1 hub, Another Cook, Pirate Pete, maps, chest, journals and shared-owner regressions');
process.exit(0);
