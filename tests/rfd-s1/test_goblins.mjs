// Built-pack integration for Goblin Generals: native quest route, recipes, maps, recovery and rewards.
import assert from 'node:assert/strict';
import {
  World, PlayerStat, ScriptState, types, map, floorTiles, CollisionType, nativeLocRows, nativeLoc, nativeNpc,
  player, position, tile, id, obj, inv, com, bit, setBit, setVar, count, give, run, talk, operate,
  useLoc, useItems, remove, text, capture, load, walkable, stand
} from './runtime.mjs';

const OpNpcU = await load('network/game/client/model/OpNpcU.ts');
const OpNpcUHandler = await load('network/game/client/handler/OpNpcUHandler.ts');
const npcUseHandler = new OpNpcUHandler();
const wartface = nativeNpc('general_wartface');
const bentnoze = nativeNpc('general_bentnoze');
const cook = nativeNpc('goblin_cook');
const charredCook = nativeNpc('goblin_cook_charred');
const ladderDown = nativeLoc('100_goblin_ladder_down');
const ladderUp = nativeLoc('100_goblin_ladder_up');
const charredLadderUp = nativeLoc('100_goblin_ladder_up_charred');

assert.deepEqual(
  nativeLocRows('100_goblin_cauldren_still').map(({ level, x, z }) => [level, x, z]),
  [[0, 2980, 9910]],
  'the charcoal event uses the original cellar cauldron'
);
const qp = p => p.getVar(id('VarPlayerType', 'qp'));
const goblinStage = p => bit(p, '100goblin');
const tally = p => bit(p, 'hundred_subquest_tally');

function guestLoc(base) {
  const row = nativeLocRows(base)[0];
  assert(row, `${base} has its original placement`);
  const multi = base.replace(/_base$/, '_multi');
  const target = World.getLoc(row.x, row.z, row.level, id('LocType', multi));
  assert(target, `${base} is installed under its original multi wrapper`);
  return target;
}

function prepareFrozen(p, goblinDiplomacy = 6) {
  setBit(p, 'hundred_main_quest_var', 3);
  setBit(p, '100goblinsvisible', 1);
  setVar(p, 'goblinquest', goblinDiplomacy);
  position(p, [0, 1861, 5317]);
  run(p, '[proc,rfd_prepare_banquet]');
}

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

function assertNativeRoute(p, at, target, label) {
  walkable(at, `${label} landing`);
  const approach = stand(p, target, candidate => candidate[0] === at[0] && (candidate[1] !== at[1] || candidate[2] !== at[2]));
  const minX = Math.floor(at[1] / 64) * 64;
  const minZ = Math.floor(at[2] / 64) * 64;
  const bounds = [minX, minX + 63, minZ, minZ + 63];
  assert(route(at[0], at.slice(1), approach.slice(1), bounds), `${label} routes to native ${target.type} approach`);
  assert(map.findPath(at[0], at[1], at[2], approach[1], approach[2]).length > 0, `${label} has a nonempty engine findPath route out`);
}

function useOnNpc(p, item, actor, expected, { defer = false } = {}) {
  stand(p, actor);
  p.clearPendingAction();
  const itemId = obj(item);
  const slot = p.getInventory(inv).getItemIndex(itemId);
  assert.notEqual(slot, -1, `${item} is carried for NPC use`);
  assert(npcUseHandler.handle(new OpNpcU(actor.nid, itemId, slot, com('inventory:inv')), p), 'native OpNpcU accepts the Cook and item');
  assert.equal(p.lastUseItem, itemId);
  assert.equal(p.target, actor);
  assert(p.validateTarget(), 'native Cook remains a valid target');
  assert.equal(p.getOpTrigger()?.name, expected, 'native item-on-NPC resolves the Goblin handler');
  if (!defer) return capture(p, () => p.processInteraction());
  const states = [];
  const original = p.executeScript;
  p.executeScript = function(state, ...args) {
    states.push(state);
    return original.call(this, state, ...args);
  };
  try { p.processInteraction(); } finally { p.executeScript = original; }
  assert(states.length, 'native item-on-NPC executes a compiled script');
  return states.at(-1);
}

function resumeDelay(p, state) {
  assert.equal(state.execution, ScriptState.SUSPENDED);
  World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
  p.delayed = false;
  p.executeScript(state, true, true);
}

function snapshot(p) { return { xp: [...p.stats], tally: tally(p), qp: qp(p) }; }
function assertGoblinReward(p, before) {
  for (let index = 0; index < p.stats.length; index++) {
    const expected = [PlayerStat.COOKING, PlayerStat.FARMING, PlayerStat.CRAFTING].includes(index) ? 10000 : 0;
    assert.equal(p.stats[index] - before.xp[index], expected, `Goblin reward XP for stat ${index} in tenths`);
  }
  assert.equal(tally(p), before.tally + 1, 'one Goblin guest increments the tally once');
  assert.equal(qp(p), before.qp + 1, 'one Goblin guest adds one QP');
}

function assertNoGoblinReward(p, before) {
  assert.deepEqual(snapshot(p), before, 'refusal leaves XP, tally and QP unchanged');
}


// Goblin Diplomacy is a verified prerequisite and the old Lost Tribe hook stays first.
const blocked = player();
prepareFrozen(blocked, 5);
const wartfaceBase = guestLoc('hundred_goblin1_base');
const bentnozeBase = guestLoc('hundred_goblin2_base');
operate(blocked, wartfaceBase);
assert.equal(goblinStage(blocked), 0, 'Inspect cannot start before Goblin Diplomacy is complete');
assert.match(text(blocked), /Goblin Diplomacy/);

for (const general of [wartface, bentnoze]) {
  const ordinary = player();
  setVar(ordinary, 'goblinquest', 1);
  talk(ordinary, general, [3]);
  assert.equal(ordinary.getVar(id('VarPlayerType', 'goblinquest')), 2, 'ordinary Goblin Diplomacy still accepts the orange-armour task');
  assert.equal(goblinStage(ordinary), 0, 'ordinary Goblin Diplomacy does not start RFD');
}

const p = player();
prepareFrozen(p);
run(p, '[proc,update_questpoints]');
operate(p, wartfaceBase);
assert.equal(goblinStage(p), 1, 'Inspect Wartface starts the guest');
operate(p, bentnozeBase);
assert.equal(goblinStage(p), 1, 'Inspect Bentnoze uses the same first stage');
setBit(p, 'lost_tribe_quest', 6);
talk(p, wartface, [1]);
assert.equal(bit(p, 'lost_tribe_quest'), 7, 'Lost Tribe general dialogue keeps priority');
assert.equal(goblinStage(p), 1, 'Lost Tribe interaction does not advance the RFD stage');
talk(p, wartface);
assert.equal(goblinStage(p), 2, 'Wartface dialogue advances the RFD stage after Lost Tribe');
assert.match(text(p), /refuses to discuss their food/);
talk(p, bentnoze);
assert.equal(goblinStage(p), 2, 'Bentnoze keeps the same RFD general hook');

// Both native ladder directions are walkable and route to independent original landmarks.
operate(p, ladderDown);
const preBlast = tile(p);
assertNativeRoute(p, preBlast, cook, 'pre-blast kitchen');
assertNativeRoute(p, preBlast, ladderUp, 'pre-blast kitchen');
operate(p, ladderUp);
const surface = tile(p);
assertNativeRoute(p, surface, ladderDown, 'surface return');
assertNativeRoute(p, surface, wartface, 'surface return');
operate(p, ladderDown);
assert.deepEqual(tile(p), preBlast, 'pre-blast ladder re-entry returns to the kitchen');

// The Cook requires charcoal only after the general has sent the player to him.
give(p, 'charcoal');
useOnNpc(p, 'charcoal', cook, '[opnpcu,goblin_cook]');
assert.equal(count(p, 'charcoal'), 1, 'early charcoal use is not consumed');
assert.equal(goblinStage(p), 2, 'early charcoal use does not advance the route');
talk(p, cook);
assert.equal(goblinStage(p), 3, 'the village Cook gives the charcoal step');
assert.equal(bit(p, '100goblin_explosion'), 0, 'the original explosion starts in its intact state');
const kitchenBeforeBlast = tile(p);
const blast = useOnNpc(p, 'charcoal', cook, '[opnpcu,goblin_cook]', { defer: true });
assert.equal(blast.execution, ScriptState.SUSPENDED, 'the cauldron shake waits for its cached sequence length');
assert(p.delayedUntil > World.currentTick, 'the shake schedules a finite animation wait');
assert.equal(count(p, 'charcoal'), 0, 'one charcoal is consumed before the staged animation');
assert.equal(bit(p, '100goblin_explosion'), 0, 'the explosion stays intact during the cauldron shake');
resumeDelay(p, blast);
assert.equal(blast.execution, ScriptState.SUSPENDED, 'the cauldron blast waits for its cached sequence length');
assert(p.delayedUntil > World.currentTick, 'the blast schedules a finite animation wait');
assert.equal(bit(p, '100goblin_explosion'), 1, 'the original explosion enters its intermediate state after the shake');
assert.deepEqual(tile(p), kitchenBeforeBlast, 'the player remains in the cellar while the blast sequence plays');
resumeDelay(p, blast);
assert.equal(blast.execution, ScriptState.FINISHED, 'the charcoal sequence completes');
assert.equal(count(p, 'charcoal'), 0, 'the staged event consumes only one charcoal');
assert.equal(goblinStage(p), 4, 'the Cook completes the charred-kitchen stage after the blast');
assert.equal(bit(p, '100goblin_explosion'), 2, 'original 377 multi selector changes to the charred state');
const postBlast = tile(p);
assertNativeRoute(p, postBlast, charredCook, 'charred kitchen');
assertNativeRoute(p, postBlast, charredLadderUp, 'charred kitchen');
talk(p, charredCook);
assert.equal(goblinStage(p), 5, 'asking the charred Cook unlocks the recipe');
assert.equal(count(p, '100goblin_compromise_mush'), 0);

// Rejected recipe use outside RFD preserves both ordinary inputs.
const idle = player();
give(idle, 'spicespot');
give(idle, 'fishing_bait');
useItems(idle, 'spicespot', 'fishing_bait');
assert.equal(count(idle, 'spicespot'), 1);
assert.equal(count(idle, 'fishing_bait'), 1);
assert.equal(count(idle, '100goblin_spicey_maggots'), 0);

// The recipe branch accepts each listed dye, both spice sources, and all three water containers.
for (const [water, empty] of [['bucket_water', 'bucket_empty'], ['jug_water', 'jug_empty'], ['bowl_water', 'bowl_empty']]) {
  give(p, 'bread');
  give(p, water);
  useItems(p, water, 'bread');
  assert.equal(count(p, '100goblin_soggy_bread'), 1 + (water === 'bucket_water' ? 0 : water === 'jug_water' ? 1 : 2));
  assert.equal(count(p, 'bread'), 0);
  assert.equal(count(p, water), 0);
  assert.equal(count(p, empty), 1);
}

give(p, 'spicespot');
give(p, 'fishing_bait');
useItems(p, 'spicespot', 'fishing_bait');
assert.equal(count(p, 'spicespot'), 0);
assert.equal(count(p, 'fishing_bait'), 0);
assert.equal(count(p, '100goblin_spicey_maggots'), 1);
give(p, 'gnome_spice');
give(p, 'fishing_bait');
useItems(p, 'gnome_spice', 'fishing_bait');
assert.equal(count(p, 'gnome_spice'), 1, 'Gnome spice remains reusable');
assert.equal(count(p, '100goblin_spicey_maggots'), 2);

const acceptableDyes = ['bluedye', 'greendye', 'purpledye', 'handsand_pink_dye'];
for (const [index, dye] of acceptableDyes.entries()) {
  give(p, dye);
  give(p, 'orange_slices');
  useItems(p, dye, 'orange_slices');
  assert.equal(count(p, dye), 0, `${dye} is consumed`);
  assert.equal(count(p, 'orange_slices'), 0);
  assert.equal(count(p, '100goblin_dyed_oranges'), index + 1);
}
for (const dye of ['orangedye', 'reddye', 'yellowdye']) {
  give(p, dye);
  give(p, 'orange_slices');
  const before = count(p, '100goblin_dyed_oranges');
  useItems(p, dye, 'orange_slices');
  assert.equal(count(p, dye), 1, `${dye} is not accepted`);
  assert.equal(count(p, 'orange_slices'), 1, `${dye} refusal preserves orange slices`);
  assert.equal(count(p, '100goblin_dyed_oranges'), before);
  remove(p, dye);
  remove(p, 'orange_slices');
}

// A valid item is not consumed before all ingredients have been cooked into Slop.
give(p, '100goblin_compromise_mush');
const earlyReward = snapshot(p);
useLoc(p, '100goblin_compromise_mush', wartfaceBase);
assert.equal(count(p, '100goblin_compromise_mush'), 1, 'early hand-in preserves the food');
assert.equal(goblinStage(p), 5, 'early hand-in cannot complete the guest');
assertNoGoblinReward(p, earlyReward);
remove(p, '100goblin_compromise_mush');

// Losing a prepared component is recoverable: the charred Cook can retry once it is remade.
remove(p, '100goblin_spicey_maggots');
remove(p, '100goblin_spicey_maggots');
talk(p, charredCook);
assert.equal(goblinStage(p), 5, 'missing ingredient does not advance the stage');
assert.equal(count(p, '100goblin_soggy_bread'), 3, 'partial recipe preserves soggy bread');
assert.equal(count(p, '100goblin_dyed_oranges'), 4, 'partial recipe preserves dyed oranges');
give(p, 'fishing_bait');
useItems(p, 'gnome_spice', 'fishing_bait');
assert.equal(count(p, '100goblin_spicey_maggots'), 1, 'lost spicy maggots can be prepared again');
talk(p, charredCook);
assert.equal(goblinStage(p), 6, 'the Cook combines the three components');
assert.equal(count(p, '100goblin_compromise_mush'), 1);
for (const [item, remaining] of [['100goblin_soggy_bread', 2], ['100goblin_spicey_maggots', 0], ['100goblin_dyed_oranges', 3]]) {
  assert.equal(count(p, item), remaining, `${item}: one component is consumed and extras are preserved`);
}

// Lost Slop is recoverable without resetting quest progress.
remove(p, '100goblin_compromise_mush');
give(p, 'gnome_spice');
give(p, 'fishing_bait');
useItems(p, 'gnome_spice', 'fishing_bait');
give(p, 'bluedye');
give(p, 'orange_slices');
useItems(p, 'bluedye', 'orange_slices');
talk(p, charredCook);
assert.equal(goblinStage(p), 6, 'recovered Slop keeps the terminal recipe-ready stage');
assert.equal(count(p, '100goblin_compromise_mush'), 1, 'Slop can be recovered after loss');

operate(p, charredLadderUp);
const returned = tile(p);
assertNativeRoute(p, returned, ladderDown, 'charred surface return');
assertNativeRoute(p, returned, wartface, 'charred surface return');
operate(p, ladderDown);
assert.deepEqual(tile(p), postBlast, 're-entry after the blast returns to the charred kitchen');

const beforeReward = snapshot(p);
useLoc(p, '100goblin_compromise_mush', wartfaceBase);
assert.equal(goblinStage(p), 10, 'native Slop hand-in writes terminal guest stage');
assert.equal(bit(p, '100goblinsvisible'), 0, 'once-only reward clears the frozen visibility latch');
assert.equal(count(p, '100goblin_compromise_mush'), 0, 'native hand-in consumes one Slop');
assertGoblinReward(p, beforeReward);
const settled = snapshot(p);
run(p, '[proc,rfd_guest_reward]', { args: [2] });
assert.deepEqual(snapshot(p), settled, 'repeated guest reward call is inert');

// The in-place dye hook leaves ordinary Gnome cocktail completion unchanged.
const cocktail = player();
give(cocktail, 'unfinished_pineapple_punch3');
give(cocktail, 'orange_slices');
useItems(cocktail, 'unfinished_pineapple_punch3', 'orange_slices');
assert.equal(count(cocktail, 'unfinished_pineapple_punch3'), 0);
assert.equal(count(cocktail, 'orange_slices'), 0);
assert.equal(count(cocktail, 'pineapple_punch'), 1, 'ordinary cocktail still completes through finish_cocktail');

// Every moved quest item remains server-untradeable; original client fields stay in the copied configs.
for (const item of ['100goblin_compromise_mush', '100goblin_soggy_bread', '100goblin_spicey_maggots', '100goblin_dyed_oranges']) {
  assert.equal(types.ObjType.get(obj(item)).tradeable, false, `${item} is server-untradeable`);
}
assert.equal(types.NpcType.get(id('NpcType', 'goblin_cook')).name, 'Goblin Cook');
assert.equal(types.NpcType.get(id('NpcType', 'goblin_cook_charred')).name, 'Goblin Cook');
assert.equal(types.NpcType.get(id('NpcType', 'goblin_cook_on_wall')).name, 'Goblin Cook');
console.log('PASS RFD Goblin Generals: staged blast, native route, recipes, recovery, cocktail regression and once-only rescue');
