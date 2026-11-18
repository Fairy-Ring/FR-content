#!/usr/bin/env node
/** Compiled Enchanted Key dispatch, state transitions, rewards, persistence and map reachability. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  World, PlayerLoading, Packet, ScriptState, ServerTriggerType, types, id, obj, inv, invCom, wornCom,
  inventory, count, seed, held, use, execute, resumeDialogue, player as makePlayer, map, engineModule,
  contentRoot
} from '../swamp-caves/runtime.mjs';

const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await engineModule('engine/entity/EntityLifeCycle.js');
const { BlockWalk } = await engineModule('engine/entity/BlockWalk.js');
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');

function integerConstant(name, source) {
  const match = source.match(new RegExp(`^\\^${name}\\s*=\\s*(-?\\d+)`, 'm'));
  assert(match, `missing source constant ^${name}`);
  return Number(match[1]);
}

function packedCoord(name, source) {
  const match = source.match(new RegExp(`^\\^${name}\\s*=\\s*(\\d+)_(\\d+)_(\\d+)_(\\d+)_(\\d+)`, 'm'));
  assert(match, `missing packed coordinate ^${name}`);
  const [, level, mapX, mapZ, localX, localZ] = match.map(Number);
  return { level, x: mapX * 64 + localX, z: mapZ * 64 + localZ };
}

const keyConfigPath = path.join(contentRoot, 'scripts/quests/miniquest_enchanted_key/configs/enchanted_key.constant');
const keyConfig = fs.readFileSync(keyConfigPath, 'utf8');
const siteCount = integerConstant('ek_site_count', keyConfig);
const foundAll = integerConstant('ek_found_all', keyConfig);
const replacementPrice = integerConstant('ek_replacement_price', keyConfig);
assert.equal(siteCount, 11, 'the period hunt has eleven sites');
assert.equal(foundAll, (1 << siteCount) - 1, 'found-all mask covers every site');

const sites = Array.from({ length: siteCount }, (_, index) => ({
  index,
  ...packedCoord(`ek_site_${index}`, keyConfig)
}));
assert.deepEqual(
  sites.map(({ level, x, z }) => [level, x, z]),
  [
    [0, 2716, 3606], [0, 3033, 3437], [0, 3299, 3349], [0, 2972, 3304],
    [0, 3161, 3176], [0, 3291, 3220], [0, 2621, 3239], [0, 3160, 3490],
    [0, 2417, 3382], [0, 3016, 3166], [0, 2448, 3443]
  ],
  'all eleven packed centers stay at the requested pre-Grand-Exchange locations'
);

const expectedRewards = [
  [['cert_mithril_ore', 10], ['steel_arrow', 20], ['lawrune', 15]],
  [['cert_mithril_ore', 10], ['cert_iron_ore', 15], ['airrune', 5]],
  [['cert_blankrune', 40], ['cert_iron_ore', 15], ['makinghistory_guthix_polestaff', 1]],
  [['earthrune', 5], ['iron_arrow', 20], ['makinghistory_saradomin_polestaff', 1]],
  [['cert_blankrune', 29], ['mindrune', 20], ['lawrune', 15]],
  [['cert_blankrune', 40], ['cert_mithril_ore', 10], ['makinghistory_zamorak_polestaff', 1]],
  [['cert_blankrune', 36], ['cert_iron_ore', 15], ['airrune', 5]],
  [['cert_blankrune', 36], ['mithril_arrow', 10], ['airrune', 5]],
  [['cert_blankrune', 40], ['iron_arrowheads', 20], ['firerune', 20]],
  [['cert_iron_ore', 15], ['mithril_arrow', 20], ['deathrune', 15]],
  [['cert_blankrune', 39], ['iron_arrowheads', 20], ['waterrune', 30]]
];
assert.equal(expectedRewards.length, siteCount);

const questConstants = fs.readFileSync(path.join(contentRoot, 'scripts/general/configs/quest.constant'), 'utf8');
const makingHistoryComplete = integerConstant('makinghistory_complete', questConstants);
const makingHistoryProgress = id('VarBitType', 'makinghistory_prog');
const makingHistoryTraderProgress = id('VarBitType', 'makinghistory_trader_prog');
const huntVar = id('VarPlayerType', 'enchanted_key_hunt');
const distanceVar = id('VarPlayerType', 'makinghistory_key_distance');
const bankInv = id('InvType', 'bank');
let nextNpcId = 1;
const allLootNames = [...new Set(expectedRewards.flatMap(reward => reward.map(([name]) => name)))];
const rewardTotals = Object.fromEntries(allLootNames.map(name => [name, 0]));
for (const reward of expectedRewards) {
  for (const [name, amount] of reward) rewardTotals[name] += amount;
}

function postQuestPlayer(items = ['makinghistory_key', 'spade']) {
  const p = seed(makePlayer(), items);
  p.setVarBit(makingHistoryProgress, makingHistoryComplete);
  return p;
}

function setPosition(p, site, dx = 0, dz = 0, level = site.level) {
  p.level = level;
  p.x = site.x + dx;
  p.z = site.z + dz;
}

function encodeHunt(foundMask, targetIndex = null) {
  return foundMask | (targetIndex === null ? 0 : (targetIndex + 1) << 11);
}

function setHunt(p, foundMask, targetIndex = null) {
  p.setVar(huntVar, encodeHunt(foundMask, targetIndex));
}

function foundMask(p) {
  return p.getVar(huntVar) & foundAll;
}

function storedTarget(p) {
  return (p.getVar(huntVar) >>> 11) & 0xf;
}

function target(p) {
  return execute('[proc,ek_target]', p).popInt();
}

function clearInventory(p) {
  const container = p.getInventory(inv);
  assert(container, 'player inventory exists');
  for (let slot = 0; slot < container.capacity; slot++) container.set(slot, null);
}

function arm(p, { key = true, spade = true } = {}) {
  clearInventory(p);
  if (key) p.invAdd(inv, obj('makinghistory_key'), 1);
  if (spade) p.invAdd(inv, obj('spade'), 1);
}

function inventoryTotals(p) {
  const totals = new Map();
  for (const item of inventory(p).filter(Boolean)) totals.set(item.name, (totals.get(item.name) ?? 0) + item.count);
  return Object.fromEntries([...totals].sort(([left], [right]) => left.localeCompare(right)));
}

function assertInventoryExactly(p, expected, message) {
  const normalized = Object.fromEntries(Object.entries(expected).filter(([, amount]) => amount !== 0).sort(([left], [right]) => left.localeCompare(right)));
  assert.deepEqual(inventoryTotals(p), normalized, message);
}

function exactSiteInventory(siteIndex, keyPresent = true) {
  const expected = new Map([['spade', 1]]);
  if (keyPresent) expected.set('makinghistory_key', 1);
  for (const [name, amount] of expectedRewards[siteIndex]) expected.set(name, (expected.get(name) ?? 0) + amount);
  return Object.fromEntries([...expected].sort(([left], [right]) => left.localeCompare(right)));
}

function lootSnapshot(p) {
  return new Map(allLootNames.map(name => [name, count(p, name)]));
}

function assertRewardDelta(p, siteIndex, before, message) {
  const reward = new Map(expectedRewards[siteIndex]);
  for (const name of allLootNames) {
    assert.equal(count(p, name) - before.get(name), reward.get(name) ?? 0, `${message}: ${name}`);
  }
}

function summedRewardInventory() {
  return Object.fromEntries([...Object.entries(rewardTotals), ['spade', 1]].sort(([left], [right]) => left.localeCompare(right)));
}

// Check that each packed center is walkable and the production pathfinder reaches it.
for (const site of sites) {
  assert.equal(map.isMapBlocked(site.x, site.z, site.level), false, `site ${site.index} exact dig center is not blocked`);
  let reachable = null;
  for (let radius = 1; radius <= 4 && !reachable; radius++) {
    for (let dx = -radius; dx <= radius && !reachable; dx++) {
      for (let dz = -radius; dz <= radius && !reachable; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = site.x + dx;
        const z = site.z + dz;
        if (map.isMapBlocked(x, z, site.level)) continue;
        const route = map.findPath(site.level, x, z, site.x, site.z);
        if (route.length === 0) continue;
        const end = CoordGrid.unpackCoord(route[route.length - 1]);
        if (end.level === site.level && end.x === site.x && end.z === site.z) reachable = { x, z, route };
      }
    }
  }
  assert(reachable, `site ${site.index} packed pathfinder reaches its exact center from a nearby walkable tile`);
  assert(reachable.route.length > 0);
}
const firstSiteStaging = { level: 0, x: 2708, z: 3606 };
assert.equal(map.isMapBlocked(firstSiteStaging.x, firstSiteStaging.z, firstSiteStaging.level), false, 'the headed first-site staging tile is walkable');
const firstSiteRoute = map.findPath(
  firstSiteStaging.level, firstSiteStaging.x, firstSiteStaging.z,
  sites[0].x, sites[0].z
);
assert(firstSiteRoute.length > 0, 'packed pathfinder connects the headed staging tile to site 0');
const firstSiteRouteEnd = CoordGrid.unpackCoord(firstSiteRoute[firstSiteRoute.length - 1]);
assert.deepEqual(
  [firstSiteRouteEnd.level, firstSiteRouteEnd.x, firstSiteRouteEnd.z],
  [sites[0].level, sites[0].x, sites[0].z],
  'headed staging route ends at the exact site-0 center'
);

// A pre-completion account retains Making History's own spade dispatch and starts no hunt.
{
  const p = seed(makePlayer(), ['makinghistory_key', 'spade']);
  const makingHistoryConfig = fs.readFileSync(path.join(contentRoot, 'scripts/quests/quest_makinghistory/configs/mh.constant'), 'utf8');
  const chest = packedCoord('mh_chest_coord', makingHistoryConfig);
  p.setVarBit(makingHistoryProgress, 1); // Existing gathering stage.
  p.setVarBit(makingHistoryTraderProgress, 1); // Erin lent the key.
  setPosition(p, chest);
  assert.equal(target(p), -1, 'pre-completion target lookup refuses the hunt');
  held(p, 'spade', 1);
  assert.equal(p.getVarBit(makingHistoryProgress), 1, 'the shared quest stays at its existing stage');
  assert.equal(p.getVarBit(makingHistoryTraderProgress), 2, 'the original Making History spade dig still wins dispatch');
  assert.equal(count(p, 'makinghistory_chest'), 1, 'the original quest chest still appears');
  assert.equal(p.getVar(huntVar), 0, 'pre-completion dig does not create hunt state');
}

// The normal pre-completion key reading remains Making History, not the post-quest hunt.
{
  const p = seed(makePlayer(), ['makinghistory_key', 'spade']);
  setPosition(p, sites[0]);
  assert.equal(target(p), -1);
  held(p, 'makinghistory_key', 1);
  held(p, 'spade', 1);
  assert.equal(p.getVar(huntVar), 0, 'no quest means no hunt target or found bit');
  assertInventoryExactly(p, { makinghistory_key: 1, spade: 1 }, 'pre-completion spade cannot award hunt loot');
}

// All eight hunt bands, including each side of every threshold, use held-key dispatch.
const bandCases = [
  [0, 'The key is steaming'], [4, 'The key is steaming'], [5, "Ouch! It's burning hot"],
  [30, "Ouch! It's burning hot"], [31, "It's very hot"], [60, "It's very hot"],
  [61, "It's hot"], [100, "It's hot"], [101, "It's warm"], [400, "It's warm"],
  [401, "It's cold"], [700, "It's cold"], [701, "It's very cold"], [1000, "It's very cold"],
  [1001, "It's freezing"]
];
for (const [distance, band] of bandCases) {
  const p = postQuestPlayer(['makinghistory_key']);
  assert.equal(target(p), 0, 'the first target is always the Fremennik site');
  setPosition(p, sites[0], distance, 0);
  held(p, 'makinghistory_key', 1);
  assert(p.messages.some(message => message.includes(band)), `distance ${distance} reports ${band}`);
  assert.equal(p.getVar(distanceVar), distance + 1, `distance ${distance} stores distance plus one`);
}

// The comparison uses the prior distance and handles warmer, colder and unchanged readings.
{
  const p = postQuestPlayer(['makinghistory_key']);
  assert.equal(target(p), 0);
  setPosition(p, sites[0], 100, 0);
  held(p, 'makinghistory_key', 1);
  assert.equal(p.getVar(distanceVar), 101);

  p.messages.length = 0;
  setPosition(p, sites[0], 99, 0);
  held(p, 'makinghistory_key', 1);
  assert(p.messages.some(message => message.includes('and warmer than last time')));

  p.messages.length = 0;
  setPosition(p, sites[0], 150, 0);
  held(p, 'makinghistory_key', 1);
  assert(p.messages.some(message => message.includes('but colder than last time')));

  p.messages.length = 0;
  held(p, 'makinghistory_key', 1);
  assert(p.messages.some(message => message.includes('and the same temperature as last time')));
}

function reload(p) {
  const bytes = p.save();
  assert(PlayerLoading.verify(new Packet(bytes)), 'production save CRC verifies');
  const q = PlayerLoading.load(p.username, new Packet(bytes), null);
  q.pid = p.pid;
  q.slot = p.slot;
  q.uid = ((Number(q.username37 & 0x1fffffn) << 11) | q.slot) >>> 0;
  q.isActive = true;
  q.messages = [];
  q.packets = [];
  q.write = packet => q.packets.push(packet);
  q.messageGame = text => q.messages.push(String(text));
  q.wrappedMessageGame = q.messageGame;
  q.tabs[3] = types.Component.get(invCom).rootLayer;
  q.tabs[4] = types.Component.get(wornCom).rootLayer;
  q.invListenOnCom(inv, invCom, q.uid);
  q.invListenOnCom(id('InvType', 'worn'), wornCom, q.uid);
  World.players[q.pid] = q;
  return q;
}

// Temporary distance state resets on logout, while target and found bits survive a real save/load.
{
  let p = postQuestPlayer(['makinghistory_key', 'spade']);
  assert.equal(target(p), 0);
  setPosition(p, sites[0], 100, 0);
  held(p, 'makinghistory_key', 1);
  assert.equal(p.getVar(distanceVar), 101);
  const savedHunt = p.getVar(huntVar);
  p = reload(p);
  assert.equal(p.getVar(huntVar), savedHunt, 'saved hunt target survives encoded player save/load');
  assert.equal(storedTarget(p), 1);
  assert.equal(p.getVar(distanceVar), 0, 'temporary previous reading resets on logout');
  p.messages.length = 0;
  setPosition(p, sites[0], 90, 0);
  held(p, 'makinghistory_key', 1);
  assert(!p.messages.some(message => /warmer than last time|colder than last time|same temperature as last time/.test(message)));
}

// Dig radius, plane, key and spade gates use the compiled dig procedure and held-spade dispatch.
{
  const p = postQuestPlayer();
  setHunt(p, 0, 0);
  setPosition(p, sites[0], 4, 0);
  held(p, 'spade', 1);
  assert.equal(foundMask(p), 1, 'distance four is inside the dig radius');
  assertInventoryExactly(p, exactSiteInventory(0), 'distance-four dig awards the exact first-site reward');

  arm(p);
  setHunt(p, 0, 0);
  setPosition(p, sites[0], 5, 0);
  const beforeFive = p.getVar(huntVar);
  held(p, 'spade', 1);
  assert.equal(p.getVar(huntVar), beforeFive, 'distance five is outside the dig radius');
  assertInventoryExactly(p, { makinghistory_key: 1, spade: 1 }, 'distance-five dig awards nothing');

  setHunt(p, 0, 0);
  setPosition(p, sites[0], 0, 0, 1);
  const beforeOtherPlane = p.getVar(huntVar);
  held(p, 'spade', 1);
  assert.equal(p.getVar(huntVar), beforeOtherPlane, 'a matching x/z on another plane cannot dig');
  assertInventoryExactly(p, { makinghistory_key: 1, spade: 1 }, 'other-plane dig awards nothing');

  arm(p, { key: false, spade: true });
  setHunt(p, 0, 0);
  setPosition(p, sites[0]);
  const beforeNoKey = p.getVar(huntVar);
  held(p, 'spade', 1);
  assert.equal(p.getVar(huntVar), beforeNoKey, 'spade without the key cannot dig');
  assertInventoryExactly(p, { spade: 1 }, 'keyless dig awards nothing');

  arm(p, { key: true, spade: false });
  setHunt(p, 0, 0);
  setPosition(p, sites[0]);
  const beforeNoSpade = p.getVar(huntVar);
  assert.equal(execute('[proc,ek_dig]', p).popInt(), 0, 'dig procedure refuses without a spade');
  assert.equal(p.getVar(huntVar), beforeNoSpade);
  assertInventoryExactly(p, { makinghistory_key: 1 }, 'spadeless dig procedure awards nothing');
}

// Every unselected site and every already-found site refuses the selected target.
const refusalPlayer = postQuestPlayer();
const noRewardItems = { makinghistory_key: 1, spade: 1 };
for (let selected = 0; selected < siteCount; selected++) {
  const found = selected === 0 ? 0 : 1;
  const unselected = sites.find(site => site.index !== selected && (found & (1 << site.index)) === 0);
  assert(unselected, `an unselected site exists for target ${selected}`);
  assert(Math.max(Math.abs(unselected.x - sites[selected].x), Math.abs(unselected.z - sites[selected].z)) > 4);
  arm(refusalPlayer);
  setHunt(refusalPlayer, found, selected);
  setPosition(refusalPlayer, unselected);
  const before = refusalPlayer.getVar(huntVar);
  held(refusalPlayer, 'spade', 1);
  assert.equal(refusalPlayer.getVar(huntVar), before, `unselected site ${unselected.index} cannot advance target ${selected}`);
  assertInventoryExactly(refusalPlayer, noRewardItems, `unselected site ${unselected.index} grants nothing`);
}
for (let finished = 0; finished < siteCount; finished++) {
  const found = 1 | (1 << finished);
  const next = sites.find(site => site.index > 0 && (found & (1 << site.index)) === 0);
  assert(next, `an unfound target remains after site ${finished}`);
  assert(Math.max(Math.abs(sites[finished].x - next.x), Math.abs(sites[finished].z - next.z)) > 4);
  arm(refusalPlayer);
  setHunt(refusalPlayer, found, next.index);
  setPosition(refusalPlayer, sites[finished]);
  const before = refusalPlayer.getVar(huntVar);
  held(refusalPlayer, 'spade', 1);
  assert.equal(refusalPlayer.getVar(huntVar), before, `finished site ${finished} cannot be dug again`);
  assertInventoryExactly(refusalPlayer, noRewardItems, `finished site ${finished} grants nothing again`);
}

// Exhaust all 1,024 subsets of the ten random sites and every eligible next-target transition.
{
  const p = postQuestPlayer();
  let transitions = 0;
  for (let subset = 0; subset < (1 << (siteCount - 1)); subset++) {
    const found = 1 | (subset << 1);
    for (let selected = 1; selected < siteCount; selected++) {
      if ((found & (1 << selected)) !== 0) continue;
      arm(p);
      setHunt(p, found, selected);
      p.setVar(distanceVar, 137);
      setPosition(p, sites[selected]);
      p.messages.length = 0;
      p.packets.length = 0;
      assert.equal(target(p), selected, `stored target ${selected} is used for mask ${found}`);
      const lootBefore = lootSnapshot(p);
      held(p, 'spade', 1);

      const after = found | (1 << selected);
      assert.equal(foundMask(p), after, `mask ${found} gains only selected site ${selected}`);
      assert.equal(storedTarget(p), 0, 'dig clears the old target for lazy reselection');
      assert.equal(p.getVar(distanceVar), 0, 'dig clears the previous key reading');
      assertRewardDelta(p, selected, lootBefore, `mask ${found}, target ${selected}`);
      const final = after === foundAll;
      assertInventoryExactly(p, exactSiteInventory(selected, !final), `mask ${found}, target ${selected} exact reward/key result`);

      if (final) {
        assert.equal(target(p), -1, 'all-found state has no next target');
        assert.equal(count(p, 'makinghistory_key'), 0, 'final transition consumes the key');
      } else {
        const next = target(p);
        assert(next > 0 && next < siteCount, `next target ${next} stays within the remaining random sites`);
        assert.equal(after & (1 << next), 0, `next target ${next} is not already found in mask ${after}`);
        assert.equal(storedTarget(p), next + 1, 'new target is stored as index plus one');
      }
      transitions++;
    }
  }
  assert.equal(transitions, (siteCount - 1) * (1 << (siteCount - 2)), 'all 5,120 eligible transitions execute');
}

// A naturally selected full run visits each site once and round-trips saved state between treasures.
let runner = postQuestPlayer();
const visits = [];
let naturalMask = 0;
for (let treasure = 0; treasure < siteCount; treasure++) {
  const selected = target(runner);
  assert(selected >= 0 && selected < siteCount, `full run target ${selected} is valid`);
  if (treasure === 0) assert.equal(selected, 0, 'the natural run begins at the first Fremennik site');
  else assert(selected > 0, 'later targets come from the remaining ten sites');
  assert.equal(naturalMask & (1 << selected), 0, `natural target ${selected} has not been found`);
  assert.equal(storedTarget(runner), selected + 1, 'selected natural target is persisted');
  visits.push(selected);

  setPosition(runner, sites[selected]);
  runner.messages.length = 0;
  const lootBefore = lootSnapshot(runner);
  held(runner, 'makinghistory_key', 1);
  assert(runner.messages.some(message => message.includes('The key is steaming')));
  held(runner, 'spade', 1);

  naturalMask |= 1 << selected;
  assert.equal(foundMask(runner), naturalMask, 'natural dig writes its found bit');
  assert.equal(storedTarget(runner), 0, 'natural dig clears the old target');
  assert.equal(runner.getVar(distanceVar), 0, 'natural dig resets the previous reading');
  assertRewardDelta(runner, selected, lootBefore, `natural site ${selected}`);

  const final = naturalMask === foundAll;
  assert.equal(count(runner, 'makinghistory_key'), final ? 0 : 1, final ? 'final treasure melts the key' : 'nonfinal treasure retains the key');
  if (final) {
    assert.equal(target(runner), -1, 'finished hunt refuses another target');
    runner = reload(runner);
    assert.equal(runner.getVar(huntVar), foundAll, 'final found mask survives production save/load');
    assert.equal(count(runner, 'makinghistory_key'), 0, 'consumed key stays absent after save/load');
  } else {
    const next = target(runner);
    assert(next > 0 && next < siteCount, `random next target ${next} is one of the remaining sites`);
    assert.equal(naturalMask & (1 << next), 0, `random next target ${next} is unfound`);
    const encodedState = runner.getVar(huntVar);
    runner = reload(runner);
    assert.equal(runner.getVar(huntVar), encodedState, 'found mask and selected target survive production save/load');
    assert.equal(runner.getVar(distanceVar), 0, 'temporary distance remains reset after save/load');
    assert.equal(target(runner), next, 'saved target remains unchanged after reload');
    assert.equal(count(runner, 'makinghistory_key'), 1, 'key survives nonfinal save/load');
  }
}
assert.deepEqual([...visits].sort((left, right) => left - right), Array.from({ length: siteCount }, (_, index) => index));
assertInventoryExactly(runner, summedRewardInventory(), 'full run receives every period reward exactly once');

// The post-quest Erin route keeps the normal shop and prevents duplicate or final key replacement.
const shopPlayer = postQuestPlayer([]);
const originalQuestStage = shopPlayer.getVarBit(makingHistoryProgress);
const originalTraderStage = shopPlayer.getVarBit(makingHistoryTraderProgress);
talkToSilverMerchant(shopPlayer, [1]);
assert.equal(types.Component.get(shopPlayer.modalMain)?.comName, 'shop_template', 'normal shop choice reaches the production shop interface');
assert.equal(shopPlayer.getVarBit(makingHistoryProgress), originalQuestStage, 'shop route leaves Making History progress unchanged');
assert.equal(shopPlayer.getVarBit(makingHistoryTraderProgress), originalTraderStage, 'shop route leaves trader progress unchanged');

const replacementPlayer = postQuestPlayer(['spade']);
replacementPlayer.invAdd(inv, obj('coins'), replacementPrice);
talkToSilverMerchant(replacementPlayer, [2, 1]);
assert.equal(count(replacementPlayer, 'makinghistory_key'), 1, 'lost key can be replaced before the final treasure');
assert.equal(count(replacementPlayer, 'coins'), 0, 'replacement spends the configured price');
assert.equal(replacementPlayer.getVarBit(makingHistoryProgress), makingHistoryComplete, 'replacement does not rewrite quest progress');

const bankedKeyPlayer = postQuestPlayer(['spade']);
bankedKeyPlayer.invAdd(bankInv, obj('makinghistory_key'), 1);
bankedKeyPlayer.invAdd(inv, obj('coins'), replacementPrice);
talkToSilverMerchant(bankedKeyPlayer, [2]);
assert.equal(count(bankedKeyPlayer, 'makinghistory_key'), 0, 'banked key is not duplicated');
assert.equal(count(bankedKeyPlayer, 'makinghistory_key', bankInv), 1, 'banked key stays in the bank');
assert.equal(count(bankedKeyPlayer, 'coins'), replacementPrice, 'banked-key refusal does not spend coins');

const ringKeyPlayer = postQuestPlayer(['makinghistory_key', 'favour_key_ring', 'spade']);
ringKeyPlayer.invAdd(inv, obj('coins'), replacementPrice);
assert(use(ringKeyPlayer, 'makinghistory_key', 'favour_key_ring'), 'real item-use stores the key on its ring');
assert.equal(count(ringKeyPlayer, 'makinghistory_key'), 0);
talkToSilverMerchant(ringKeyPlayer, [2]);
assert.equal(count(ringKeyPlayer, 'makinghistory_key'), 0, 'ring-stored key is not duplicated');
assert.equal(count(ringKeyPlayer, 'coins'), replacementPrice, 'ring-key refusal does not spend coins');

runner.messages.length = 0;
const finalQuestStage = runner.getVarBit(makingHistoryProgress);
const finalTraderStage = runner.getVarBit(makingHistoryTraderProgress);
talkToSilverMerchant(runner, [2]);
assert.equal(count(runner, 'makinghistory_key'), 0, 'Erin refuses replacement after all sites are found');
assert.equal(count(runner, 'coins'), 0, 'final replacement refusal cannot charge coins');
assert.equal(foundMask(runner), foundAll, 'final refusal preserves the completed hunt');
assert.equal(runner.getVarBit(makingHistoryProgress), finalQuestStage, 'final refusal leaves Making History progress unchanged');
assert.equal(runner.getVarBit(makingHistoryTraderProgress), finalTraderStage, 'final refusal leaves trader progress unchanged');

function talkToSilverMerchant(p, choices) {
  const type = types.NpcType.getByName('silver_merchant');
  assert(type, 'packed Silver merchant NPC exists');
  const actor = new Npc(0, p.x, p.z, 1, 1, EntityLifeCycle.RESPAWN, nextNpcId++, type.id, BlockWalk.NONE);
  actor.isActive = true;
  actor.lastMovement = -100;
  p.target = actor;
  p.targetOp = ServerTriggerType.OPNPC1 - 7;
  const script = p.getOpTrigger();
  assert(script, 'production Silver merchant dispatch exists');
  const state = ScriptRunner.init(script, p, actor);
  p.executeScript(state, true, true);
  assert.notEqual(state.execution, -1);
  assert.notEqual(state.execution, ScriptState.ABORTED);
  const remaining = [...choices];
  let steps = 0;
  while (state.execution !== ScriptState.FINISHED && steps++ < 160) {
    if (state.execution === ScriptState.PAUSEBUTTON) {
      const component = types.Component.get(p.modalChat);
      if (/^multi[2-5]$/.test(component?.comName ?? '')) {
        assert(remaining.length > 0, `an explicit Silver merchant choice is required for ${script.name}`);
        resumeDialogue(p, remaining.shift());
      } else {
        resumeDialogue(p);
      }
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
      assert.notEqual(state.execution, ScriptState.ABORTED);
    } else {
      assert.fail(`Silver merchant dispatch stopped in unexpected state ${state.execution}`);
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'Silver merchant dispatch finishes');
  assert.equal(remaining.length, 0, 'all supplied Silver merchant choices are consumed');
  return script.name;
}


console.log(`PASS Enchanted Key: packed centers and pathfinder, held-item dispatch, quest coexistence, bands, persistence, ${10 * (1 << 9)} complete state transitions, rewards, Erin and final melting`);
process.exit(0);
