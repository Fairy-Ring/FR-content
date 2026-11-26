#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  World, ScriptProvider, ServerTriggerType, types, PlayerStat, nativeLocRows, nativeLoc, nativeNpc, player, position, skill, floorTiles, map,
  stand, operate, talk, useItems, useLoc, run, give, count, bit, setBit, setVar,
  text, id, obj, inv, com, capture, showNpc, walkable, load, finish
} from '../rfd-s1/runtime.mjs';
import { EntityLifeCycle } from '../regicide-travel/runtime.mjs';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const config = path.join(content, 'scripts/quests/quest_100/configs');
const hubSource = fs.readFileSync(path.join(config, 'rfd_hub.constant'), 'utf8');
const skrachSource = fs.readFileSync(path.join(config, 'rfd_skrach.constant'), 'utf8');
const questSource = fs.readFileSync(path.join(content, 'scripts/general/configs/quest.constant'), 'utf8');
function constant(source, name) {
  const match = source.match(new RegExp(`^\\^${name}\\s*=\\s*(\\d+)\\s*$`, 'm'));
  assert(match, `checked-out ${name} constant exists`);
  return Number(match[1]);
}
function coordinate(name) {
  const match = new RegExp(`^\\^${name}\\s*=\\s*(\\d+)_(\\d+)_(\\d+)_(\\d+)_(\\d+)\\s*$`, 'm').exec(skrachSource);
  assert(match, `checked-out ${name} coordinate exists`);
  const [, level, regionX, regionZ, localX, localZ] = match.map(Number);
  return [level, regionX * 64 + localX, regionZ * 64 + localZ];
}
const hub = name => constant(hubSource, name);
const stage = name => constant(skrachSource, `rfd_skrach_${name}`);
const quest = name => constant(questSource, name);
const OpHeld = await load('network/game/client/model/OpHeld.ts');
const OpHeldHandler = await load('network/game/client/handler/OpHeldHandler.ts');
const OpNpc = await load('network/game/client/model/OpNpc.ts');
const OpNpcHandler = await load('network/game/client/handler/OpNpcHandler.ts');
const InvButton = await load('network/game/client/model/InvButton.ts');
const InvButtonHandler = await load('network/game/client/handler/InvButtonHandler.ts');
const JavaRandom = await load('util/JavaRandom.ts');
const Loc = await load('engine/entity/Loc.ts');
const heldHandler = new OpHeldHandler();
const npcHandler = new OpNpcHandler();
const invButtonHandler = new InvButtonHandler();
const actionDelay = id('VarPlayerType', 'action_delay');
const pickaxeRate = types.ObjType.get(obj('bronze_pickaxe')).params.get(id('ParamType', 'mining_rate'));
assert.equal(pickaxeRate > 0, true, 'packed bronze pickaxe has its native mining rate');

function fixture(progress = 0, { cooking = 99, fm = 99, mining = 1 } = {}) {
  const p = player();
  const questComplete = progress >= hub('rfd_guest_complete');
  setBit(p, 'hundred_main_quest_var', questComplete ? hub('rfd_guest_complete') : hub('rfd_frozen'));
  setBit(p, '100ogrevisible', questComplete ? 0 : 1);
  setBit(p, '100_ogre_prog', progress);
  setBit(p, '100_ogre_rantz_visible', progress >= stage('rantz_spoken') ? 1 : 0);
  setBit(p, '100_ogre_jubbly_push_tree', stage('tree_done_selector'));
  setVar(p, 'chompybird', quest('chompybird_complete'));
  skill(p, 'cooking', cooking);
  skill(p, 'firemaking', fm);
  skill(p, 'mining', mining);
  give(p, 'ogre_bow'); // Ordinary completed-Chompy equipment avoids the unrelated lost-bow offer.
  run(p, '[proc,rfd_prepare_banquet]');
  run(p, '[proc,update_questpoints]');
  const row = nativeLocRows('hundred_ogre_base')[0];
  const guest = World.getLoc(row.x, row.z, row.level, id('LocType', 'hundred_ogre_multi'));
  if (!questComplete) assert(guest, 'Skrach is the original native frozen guest wrapper');
  return { p, guest };
}
function postQuestFixture() {
  const { p } = fixture(hub('rfd_guest_complete'));
  setBit(p, '100_ogre_jubbly_boat_visible', 1);
  return p;
}
function shoreApproach(p, actor) {
  for (let radius = 1; radius <= p.apRange; radius++) {
    for (let x = actor.x - radius; x <= actor.x + radius; x++) {
      for (let z = actor.z - radius; z <= actor.z + radius; z++) {
        const at = [actor.level, x, z];
        if (!floorTiles.has(at.join(',')) || map.isMapBlocked(x, z, actor.level)) continue;
        position(p, at);
        if (p.inApproachDistance(p.apRange, actor)) return at;
      }
    }
  }
  assert.fail('native boat has no walkable shore tile within its engine approach range');
}
function npcOption(p, actor, option, choices = [], approach = false) {
  const from = approach ? shoreApproach(p, actor) : stand(p, actor);
  showNpc(p, actor);
  p.clearPendingAction();
  assert(npcHandler.handle(new OpNpc(option, actor.nid), p), `native NPC option ${option} accepted`);
  capture(p, () => p.processInteraction(), choices);
  return from;
}
function held(p, name, option = 1) {
  const slot = p.getInventory(inv).getItemIndex(obj(name));
  assert(slot >= 0, `${name} is carried`);
  capture(p, () => assert(heldHandler.handle(
    new OpHeld(option, obj(name), slot, com('inventory:inv')), p), `native ${name} option ${option} accepted`));
}
function mineOne(p, rock) {
  setVar(p, 'action_delay', 0);
  const beforeTick = World.currentTick;
  const before = count(p, 'rock');
  operate(p, rock, 1);
  const due = p.getVar(actionDelay);
  assert.equal(due, beforeTick + pickaxeRate, 'native Mine arms the ordinary pickaxe swing interval');
  assert.equal(count(p, 'rock'), before, 'ballast is not awarded before its native due tick');
  World.currentTick = due;
  capture(p, () => assert(p.tryInteract(true), 'server-scheduled hidden Mine continuation runs'));
  assert.equal(count(p, 'rock'), before + 1, 'native continued Mine produces one real ballast rock');
}
function withRandom(value, action) {
  const oldMathRandom = Math.random;
  const oldJavaRandom = JavaRandom.nextDouble;
  Math.random = () => value;
  JavaRandom.nextDouble = () => value;
  try { return action(); }
  finally {
    Math.random = oldMathRandom;
    JavaRandom.nextDouble = oldJavaRandom;
  }
}
function npcActors(name) {
  const type = id('NpcType', name);
  return [...World.npcs].filter(actor => actor.isActive && actor.type === type);
}

// Inspect and Rantz's UNKNOWN navigation choice do not take over Big Chompy hats.
{
  const { p, guest } = fixture();
  operate(p, guest, 1);
  assert.equal(bit(p, '100_ogre_prog'), stage('inspected'));
  const rantz = nativeNpc('rantz', rows => rows.find(row => row.x === 2630 && row.z === 2981));
  talk(p, rantz, [2, 5]);
  assert.equal(bit(p, '100_ogre_prog'), stage('inspected'), 'Not now leaves the RFD stage unchanged');
  assert.match(text(p), /hats|chompy/i, 'ordinary Big Chompy and hat dialogue remains available');
  talk(p, rantz, [1]);
  assert.equal(bit(p, '100_ogre_prog'), stage('rantz_spoken'));
  assert.equal(bit(p, '100_ogre_rantz_visible'), 1);
}

// The real Rantz offer stays absent until both period skill requirements are met.
for (const requirements of [{ cooking: 40 }, { fm: 19 }]) {
  const { p } = fixture(stage('inspected'), requirements);
  const rantz = nativeNpc('rantz', rows => rows.find(row => row.x === 2630 && row.z === 2981));
  talk(p, rantz, [5]);
  assert.equal(bit(p, '100_ogre_prog'), stage('inspected'));
  assert.match(text(p), /hats|chompy/i, 'the ordinary Big Chompy options remain available below RFD requirements');
}

// The native Pile of Rock accepts Mining 1 and keeps the bronze pickaxe cadence.
{
  const { p } = fixture(stage('jubbly_ready'), { mining: 1 });
  give(p, 'bronze_pickaxe');
  const rock = nativeLoc('swamp_rock1', rows => rows.find(row => row.x === 2637 && row.z === 2996));
  const miningXp = p.stats[PlayerStat.MINING];
  mineOne(p, rock);
  assert.equal(p.stats[PlayerStat.MINING], miningXp, 'quest ballast gives no unsourced Mining XP');
  assert.equal(count(p, 'gold_ore'), 0, 'quest mining yields ballast rather than gold ore');
}
{
  const { p } = fixture(0, { mining: 39 });
  give(p, 'bronze_pickaxe');
  const rock = nativeLoc('goldrock1');
  const before = p.stats[PlayerStat.MINING];
  operate(p, rock, 1);
  assert.match(text(p), /mining level of 40/i, 'ordinary gold mining retains its original level gate');
  assert.equal(count(p, 'rock'), 0);
  assert.equal(p.stats[PlayerStat.MINING], before);
}

// A real rock, balloon toad, charged bellows and wool—not a hidden mined-count selector—make a balloon.
{
  const { p } = fixture(stage('jubbly_ready'));
  give(p, 'bronze_pickaxe');
  const rock = nativeLoc('swamp_rock1', rows => rows.find(row => row.x === 2637 && row.z === 2996));
  mineOne(p, rock);
  give(p, 'bloated_toad');
  give(p, 'filled_ogre_bellow3');
  const missingWool = ['rock', 'bloated_toad', 'filled_ogre_bellow3', 'filled_ogre_bellow2']
    .map(item => count(p, item));
  useItems(p, 'filled_ogre_bellow3', 'bloated_toad');
  assert.equal(count(p, '100_jubbly_balloon_toad_brown') + count(p, '100_jubbly_balloon_toad_white'), 0,
    'missing wool prevents balloon assembly');
  assert.deepEqual(['rock', 'bloated_toad', 'filled_ogre_bellow3', 'filled_ogre_bellow2'].map(item => count(p, item)), missingWool,
    'failed assembly consumes no real materials');
  give(p, 'ball_of_wool');
  useItems(p, 'filled_ogre_bellow3', 'bloated_toad');
  assert.equal(count(p, 'rock'), 0);
  assert.equal(count(p, 'bloated_toad'), 0);
  assert.equal(count(p, 'filled_ogre_bellow2'), 1, 'inflation consumes one real bellows charge');
  assert.equal(count(p, '100_jubbly_balloon_toad_brown') + count(p, '100_jubbly_balloon_toad_white'), 1);
}

// Release and Release-all release ordinary toads; unlike Drop, neither adds balloon bait progress.
for (const [balloonCount, option] of [[1, 5], [2, 4]]) {
  const { p } = fixture(stage('jubbly_ready'));
  setBit(p, '100_ogre_jubbly_push_tree', stage('bait_three_selector'));
  const item = '100_jubbly_balloon_toad_brown';
  give(p, item, balloonCount);
  const beforeToads = npcActors('toad').length;
  const beforeJubblies = npcActors('100_jubbly_bird').length;
  const beforeBalloons = new Set([
    ...npcActors('100_jubbly_balloon_toad_brown'),
    ...npcActors('100_jubbly_balloon_toad_white')
  ]);
  held(p, item, option);
  assert.equal(count(p, item), 0, option === 5 ? 'Release removes the held balloon' : 'Release-all removes every held balloon');
  assert.equal(bit(p, '100_ogre_jubbly_push_tree'), stage('bait_three_selector'),
    'releasing balloons leaves placed-bait progress unchanged');
  assert.equal(npcActors('toad').length, beforeToads + balloonCount,
    'release reuses the ordinary toad-release behavior');
  assert.equal(npcActors('100_jubbly_bird').length, beforeJubblies, 'releasing balloons does not create a Jubbly');
  assert.equal([
    ...npcActors('100_jubbly_balloon_toad_brown'),
    ...npcActors('100_jubbly_balloon_toad_white')
  ].filter(actor => !beforeBalloons.has(actor)).length, 0, 'releasing balloons does not create balloon bait');
}

// Stage 8 and 9 offer the approved start/recovery choice; it resets placement only and keeps materials.
{
  const waterRantz = nativeNpc('100_rantz_multi_npc', rows => rows.find(row => row.x === 2651 && row.z === 2962));
  for (const [current, expected] of [[stage('returned'), stage('jubbly_ready')], [stage('jubbly_ready'), stage('jubbly_ready')]]) {
    const { p } = fixture(current);
    setBit(p, '100_ogre_jubbly_push_tree', stage('bait_three_selector'));
    for (const item of ['rock', 'bloated_toad', 'ball_of_wool', 'filled_ogre_bellow2']) give(p, item);
    const before = ['rock', 'bloated_toad', 'ball_of_wool', 'filled_ogre_bellow2'].map(item => count(p, item));
    npcOption(p, waterRantz, 1, [1]);
    assert.equal(bit(p, '100_ogre_prog'), expected);
    assert.equal(bit(p, '100_ogre_jubbly_push_tree'), stage('tree_done_selector'));
    assert.deepEqual(['rock', 'bloated_toad', 'ball_of_wool', 'filled_ogre_bellow2'].map(item => count(p, item)), before,
      'starting or restarting bait does not consume materials');
  }
}

// Three real balloon drops spawn a Jubbly; a spawned/missed bird resets only the selector for recovery.
{
  const { p } = fixture(stage('jubbly_ready'));
  give(p, 'bronze_pickaxe');
  const rocks = [
    nativeLoc('swamp_rock1', rows => rows.find(row => row.x === 2637 && row.z === 2996)),
    nativeLoc('swamp_rock1', rows => rows.find(row => row.x === 2639 && row.z === 2995)),
    nativeLoc('swamp_rock1', rows => rows.find(row => row.x === 2639 && row.z === 2998))
  ];
  for (let index = 0; index < 3; index++) {
    mineOne(p, rocks[index]);
    give(p, 'bloated_toad');
    give(p, 'ball_of_wool');
    if (index === 0) give(p, 'filled_ogre_bellow3');
    useItems(p, index === 0 ? 'filled_ogre_bellow3' : index === 1 ? 'filled_ogre_bellow2' : 'filled_ogre_bellow1', 'bloated_toad');
  }
  const balloonItems = [
    ...Array.from({ length: count(p, '100_jubbly_balloon_toad_brown') }, () => '100_jubbly_balloon_toad_brown'),
    ...Array.from({ length: count(p, '100_jubbly_balloon_toad_white') }, () => '100_jubbly_balloon_toad_white')
  ];
  assert.equal(balloonItems.length, 3);
  const balloonTypes = ['100_jubbly_balloon_toad_brown', '100_jubbly_balloon_toad_white'];
  const spawnedBefore = new Set(balloonTypes.flatMap(npcActors));
  const toadsBefore = npcActors('toad').length;
  const selectorProgress = ['bait_one_selector', 'bait_two_selector', 'bait_three_selector'].map(stage);
  let triggerBalloon;
  for (let index = 0; index < balloonItems.length; index++) {
    const presentBeforeDrop = new Set(balloonTypes.flatMap(npcActors));
    held(p, balloonItems[index], 1);
    const dropped = balloonTypes.flatMap(npcActors).filter(actor => !presentBeforeDrop.has(actor));
    assert.equal(dropped.length, 1, 'each native Drop creates exactly one balloon NPC');
    if (index === 2) triggerBalloon = dropped[0];
    assert.equal(bit(p, '100_ogre_jubbly_push_tree'), selectorProgress[index],
      'only a Drop advances the actual balloon-bait count');
  }
  assert.equal(count(p, '100_jubbly_balloon_toad_brown') + count(p, '100_jubbly_balloon_toad_white'), 0,
    'all three actual balloons are released by Drop');
  assert.equal(npcActors('toad').length, toadsBefore, 'Drop does not release ordinary toads');
  const balloons = balloonTypes.flatMap(npcActors).filter(actor => !spawnedBefore.has(actor));
  assert.equal(balloons.length, 3, 'each real drop creates an actual balloon NPC');
  const far = [triggerBalloon.level, triggerBalloon.x + stage('bait_spawn_radius') + 1, triggerBalloon.z];
  const baiterTile = [p.level, p.x, p.z];
  const other = player();
  position(other, far);
  walkable(far, 'walk away from the balloon bait');
  const jubblyBefore = npcActors('100_jubbly_bird').length;
  World.currentTick++;
  triggerBalloon.processQueue();
  assert.equal(npcActors('100_jubbly_bird').length, jubblyBefore,
    'a different player leaving does not satisfy the balloon owner distance check');
  position(other, baiterTile);
  position(p, far);
  World.currentTick++;
  triggerBalloon.processQueue();
  assert.equal(npcActors('100_jubbly_bird').length, jubblyBefore + 1,
    'the balloon owner leaving creates a Jubbly even when another player is nearby');
  assert.equal(bit(p, '100_ogre_jubbly_push_tree'), stage('tree_done_selector'),
    'Jubbly spawn resets the bait selector for a missed-bird retry');
  assert.equal(bit(p, '100_ogre_prog'), stage('jubbly_ready'));
}

// The native Rantz spit cooks a plucked Jubbly; the real cooked item frees Skrach and awards the shared reward once.
{
  const { p, guest } = fixture(stage('jubbly_ready'));
  skill(p, 'cooking', 99);
  const spit = nativeLoc('multi_chompybird_spitroast_entity', rows => rows.find(row => row.x === 2630 && row.z === 2990));
  give(p, '100_jubbly_meat_raw');
  withRandom(0, () => useLoc(p, '100_jubbly_meat_raw', spit));
  assert.equal(count(p, '100_jubbly_meat_raw'), 0);
  assert.equal(count(p, '100_jubbly_meat_cooked'), 1);
  const questPoints = p.getVar(id('VarPlayerType', 'qp'));
  const tally = bit(p, 'hundred_subquest_tally');
  const before = [...p.stats];
  useLoc(p, '100_jubbly_meat_cooked', guest);
  assert.equal(bit(p, '100_ogre_prog'), hub('rfd_guest_complete'));
  assert.equal(bit(p, '100ogrevisible'), 0);
  assert.equal(bit(p, 'hundred_subquest_tally'), tally + 1);
  assert.equal(p.getVar(id('VarPlayerType', 'qp')), questPoints + 1);
  for (let index = 0; index < p.stats.length; index++) {
    const expected = [PlayerStat.COOKING, PlayerStat.CRAFTING, PlayerStat.RANGED, PlayerStat.WOODCUTTING].includes(index) ? 15000 : 0;
    assert.equal(p.stats[index] - before[index], expected, `Skrach reward stat ${index}`);
  }
  const once = { stats: [...p.stats], qp: p.getVar(id('VarPlayerType', 'qp')), tally: bit(p, 'hundred_subquest_tally') };
  run(p, '[proc,rfd_guest_reward]', { args: [6] });
  assert.deepEqual({ stats: [...p.stats], qp: p.getVar(id('VarPlayerType', 'qp')), tally: bit(p, 'hundred_subquest_tally') }, once,
    'the shared reward latch prevents a duplicate Skrach reward');
}

// Named fire handlers must reach the shared cooking dispatch; ovens must not roast the quest skewer.
{
  const [level, x, z] = coordinate('rfd_skrach_karamja_arrow_tree');
  const sources = ['fire', 'range'].map((name, offset) => {
    const type = types.LocType.get(id('LocType', name));
    const target = new Loc(level, x + offset * 2, z - 1, type.width, type.length, EntityLifeCycle.DESPAWN, type.id, 10, 0);
    World.addLoc(target, -1);
    return target;
  });
  const [fire, oven] = sources;
  assert.equal(ScriptProvider.getByTrigger(ServerTriggerType.OPLOCU, fire.type, types.LocType.get(fire.type).category).name,
    '[oplocu,fire]', 'the original named OSF fire trigger overrides the cooking category');
  try {
    for (const [source, progress, cooking, roasts] of [
      [fire, stage('chompy_skewered'), 99, true],
      [fire, stage('tree_cut_twice'), 99, false],
      [fire, stage('chompy_skewered'), 40, false],
      [oven, stage('chompy_skewered'), 99, false]
    ]) {
      const { p } = fixture(progress, { cooking });
      give(p, 'spit_skewered_chompy');
      const xp = p.stats[PlayerStat.COOKING];
      withRandom(0, () => useLoc(p, 'spit_skewered_chompy', source));
      assert.equal(count(p, 'spit_skewered_chompy'), roasts ? 0 : 1, 'only an eligible fire roast consumes the skewer');
      assert.equal(count(p, 'spit_iron'), roasts ? 1 : 0);
      assert.equal(count(p, 'cooked_chompy'), roasts ? 1 : 0);
      assert.equal(bit(p, '100_ogre_prog'), roasts ? stage('chompy_roasted') : progress);
      assert.equal(bit(p, '100_ogre_jubbly_boat_visible'), roasts ? 1 : 0);
      assert.equal(bit(p, '100_ogre_boat_free_ride'), roasts ? 1 : 0);
      assert.equal(p.stats[PlayerStat.COOKING] - xp, roasts ? stage('chompy_cook_xp') : 0);
    }
    const { p: brewer } = fixture(stage('tree_cut_twice'));
    give(brewer, 'bowl_water');
    useLoc(brewer, 'bowl_water', fire);
    assert.equal(count(brewer, 'bowl_water'), 0);
    assert.equal(count(brewer, 'bowl_hot_water'), 1, 'the named OSF heating branch remains intact');
    const { p: cook } = fixture(stage('tree_cut_twice'));
    give(cook, 'raw_beef');
    withRandom(0, () => useLoc(cook, 'raw_beef', fire));
    assert.equal(count(cook, 'raw_beef'), 0);
    assert.equal(count(cook, 'cooked_meat'), 1, 'ordinary fire cooking still uses the generic recipe');
    assert.equal(bit(cook, '100_ogre_prog'), stage('tree_cut_twice'), 'ordinary cooking does not advance Skrach');
  } finally {
    for (const source of sources) World.removeLoc(source, 0);
  }
}

// The first return is free only after a successful Karamja roast; later rides use aggregate fares.
{
  const boat = nativeNpc('100_jubbly_multi_boat_karamja', rows => rows.find(row => row.x === 2753 && row.z === 3081));
  const { p } = fixture(stage('chompy_skewered'));
  setBit(p, '100_ogre_jubbly_boat_visible', 1);
  const before = npcOption(p, boat, 1, [], true);
  assert.deepEqual([p.level, p.x, p.z], before, 'the first return is unavailable before roasting');
  setBit(p, '100_ogre_prog', stage('chompy_roasted'));
  setBit(p, '100_ogre_boat_free_ride', 1);
  const shore = [0, 2759, 3081];
  walkable(shore, 'observed Karamja boat shoreline');
  position(p, shore);
  showNpc(p, boat);
  p.clearPendingAction();
  assert.equal(p.inOperableDistance(boat), false, 'the real shore does not require walking into the boat water');
  assert(p.inApproachDistance(p.apRange, boat), 'the real shore lies inside the unchanged engine approach range');
  assert(npcHandler.handle(new OpNpc(1, boat.nid), p), 'native Board packet accepted from shore');
  assert.equal(p.getApTrigger().name, '[apnpc1,100_jubbly_ogre_boat_full]', 'the visible Karamja boat selects its real approach trigger');
  capture(p, () => p.processInteraction());
  assert.deepEqual([p.level, p.x, p.z], coordinate('rfd_skrach_feldip_landing'));
  assert.equal(bit(p, '100_ogre_boat_free_ride'), 0);
  assert.equal(bit(p, '100_ogre_prog'), stage('returned'));
}
{
  const feldipBoat = nativeNpc('100_jubbly_multi_boat_feldip', rows => rows.find(row => row.x === 2655 && row.z === 2964));
  const karanjaBoat = nativeNpc('100_jubbly_multi_boat_karamja', rows => rows.find(row => row.x === 2753 && row.z === 3081));
  const noFare = postQuestFixture();
  give(noFare, 'raw_chompy'); give(noFare, 'karamja_rum', 2);
  const origin = npcOption(noFare, feldipBoat, 1, [], true);
  assert.deepEqual([noFare.level, noFare.x, noFare.z], origin, 'rum and one Chompy cannot partially pay a two-item fare');
  assert.equal(count(noFare, 'raw_chompy'), 1); assert.equal(count(noFare, 'karamja_rum'), 2);

  const forward = postQuestFixture();
  give(forward, 'raw_chompy'); give(forward, 'cooked_chompy'); give(forward, 'karamja_rum');
  const forwardOrigin = npcOption(forward, feldipBoat, 1, [], true);
  assert.deepEqual([forward.level, forward.x, forward.z], forwardOrigin, 'carrying rum prevents the eastward ride');
  assert.equal(count(forward, 'raw_chompy') + count(forward, 'cooked_chompy'), 2, 'rum refusal consumes no Chompy fare');
  assert.equal(count(forward, 'karamja_rum'), 1);
  forward.invDel(inv, obj('karamja_rum'), 1);
  assert.equal(count(forward, 'karamja_rum'), 0, 'fixture removes the refused rum before a valid ride');
  npcOption(forward, feldipBoat, 1, [], true);
  assert.deepEqual([forward.level, forward.x, forward.z], coordinate('rfd_skrach_karamja_landing'));
  assert.equal(count(forward, 'raw_chompy') + count(forward, 'cooked_chompy'), 0);

  const reverse = postQuestFixture();
  give(reverse, 'snake_weed'); give(reverse, 'rogues_purse'); give(reverse, 'karamja_rum');
  const reverseOrigin = npcOption(reverse, karanjaBoat, 1, [], true);
  assert.deepEqual([reverse.level, reverse.x, reverse.z], reverseOrigin, 'carrying rum prevents the westward ride');
  assert.equal(count(reverse, 'snake_weed') + count(reverse, 'rogues_purse'), 2, 'rum refusal consumes no herb fare');
  assert.equal(count(reverse, 'karamja_rum'), 1);
  reverse.invDel(inv, obj('karamja_rum'), 1);
  assert.equal(count(reverse, 'karamja_rum'), 0, 'fixture removes the refused rum before a valid ride');
  npcOption(reverse, karanjaBoat, 1, [], true);
  assert.deepEqual([reverse.level, reverse.x, reverse.z], coordinate('rfd_skrach_feldip_landing'));
  assert.equal(count(reverse, 'snake_weed') + count(reverse, 'rogues_purse'), 0, 'mixed herb species pay the aggregate fare');
}

// Native Iron Spit smithing uses the cache's existing iron_5 stock slot 3.
{
  const Environment = await load('util/Environment.ts');
  assert.equal(Environment.NODE_XPRATE, 1, 'recipe XP is checked in original tenths');
  assert.equal(Environment.NODE_MEMBERS, true, 'members recipe data is available');
  const p = player();
  skill(p, 'smithing', 17);
  give(p, 'hammer'); give(p, 'iron_bar');
  const anvil = nativeLoc('anvil', rows => rows.find(row => row.x === 3188 && row.z === 3421));
  useLoc(p, 'iron_bar', anvil);
  assert.equal(p.modalMain, com('smithing'));
  const label = p.packets.find(packet => packet.constructor.name === 'IfSetText' && packet.component === com('smithing:com_101'));
  assert.equal(label?.text, 'Iron spit');
  assert(p.invListeners.some(listener => listener.com === com('smithing:column5') && listener.type === id('InvType', 'smithing_iron5')));
  const beforeXp = p.stats[PlayerStat.SMITHING];
  capture(p, () => assert(invButtonHandler.handle(
    new InvButton(1, obj('spit_iron'), 3, com('smithing:column5')), p), 'native smithing slot 3 click accepted'));
  assert.equal(count(p, 'spit_iron'), 0, 'smithing does not award the spit before its production tick');
  assert.equal(count(p, 'iron_bar'), 1);
  assert(p.activeScript, 'native smithing awaits its normal production delay after closing the interface');
  finish(p, p.activeScript);
  assert.equal(count(p, 'spit_iron'), 1, `native Iron spit output: ${text(p)}`);
  assert.equal(count(p, 'iron_bar'), 0);
  assert.equal(count(p, 'hammer'), 1);
  assert.equal(p.stats[PlayerStat.SMITHING] - beforeXp, 250, 'candidate recipe awards the standard iron-bar XP');
  assert.equal(types.ObjType.get(obj('spit_iron')).tradeable, true, 'original cache spit remains tradeable');
  for (const name of ['spit_skewered_chompy', '100_jubbly_balloon_toad_brown', '100_jubbly_balloon_toad_white', '100_jubbly_meat_raw', '100_jubbly_meat_cooked', '100_jubbly_meat_burned']) {
    assert.equal(types.ObjType.get(obj(name)).tradeable, false, `${name} remains an untradeable quest item`);
  }
}

console.log('PASS Skrach native inspect/Rantz choices, scoped Mine timing, balloon inputs/recovery, Jubbly cook/reward, boats and Iron Spit smithing');
process.exit(0);
