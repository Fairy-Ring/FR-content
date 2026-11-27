import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  World, ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType, types,
  nativeLocRows, nativeLoc, nativeNpc, player, tile, PlayerStat, id, obj, inv, worn, com, bit,
  setBit, setVar, skill, count, give, run, talk, operate, useLoc, useItems, load, capture,
  stand, equip, showNpc
} from '../rfd-s1/runtime.mjs';
import { content, engine } from '../regicide-travel/runtime.mjs';

const Environment = await load('util/Environment.ts');
assert.equal(Environment.NODE_MEMBERS, true, 'RFD route runs with members configs enabled');
assert.equal(Environment.NODE_XPRATE, 1, 'reward oracle uses unmultiplied XP tenths');
const { NpcStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/NpcStat.ts')).href);
const OpHeld = await load('network/game/client/model/OpHeld.ts');
const OpHeldHandler = await load('network/game/client/handler/OpHeldHandler.ts');
const OpNpc = await load('network/game/client/model/OpNpc.ts');
const OpNpcHandler = await load('network/game/client/handler/OpNpcHandler.ts');
const OpNpcU = await load('network/game/client/model/OpNpcU.ts');
const OpNpcUHandler = await load('network/game/client/handler/OpNpcUHandler.ts');
const OpObj = await load('network/game/client/model/OpObj.ts');
const OpObjHandler = await load('network/game/client/handler/OpObjHandler.ts');
const heldHandler = new OpHeldHandler();
const npcHandler = new OpNpcHandler();
const npcUseHandler = new OpNpcUHandler();
const groundTakeHandler = new OpObjHandler();

const constantText = file => fs.readFileSync(path.join(content, file), 'utf8');
function numberConstant(source, name) {
  const match = source.match(new RegExp(`^\\^${name}\\s*=\\s*(-?\\d+)\\s*$`, 'm'));
  assert(match, `checked-out ${name} constant exists`);
  return Number(match[1]);
}
function coordinateConstant(source, name) {
  const match = source.match(new RegExp(`^\\^${name}\\s*=\\s*([0-3]_\\d+_\\d+_\\d+_\\d+)\\s*$`, 'm'));
  assert(match, `checked-out ${name} coordinate exists`);
  const [level, mapX, mapZ, localX, localZ] = match[1].split('_').map(Number);
  return [level, mapX * 64 + localX, mapZ * 64 + localZ];
}
const amikConstants = constantText('scripts/quests/quest_100/configs/rfd_amik.constant');
const hubConstants = constantText('scripts/quests/quest_100/configs/rfd_hub.constant');
const questConstants = constantText('scripts/general/configs/quest.constant');
const legendsConstants = constantText('scripts/quests/quest_legends/configs/quest_legends.constant');
const amik = name => numberConstant(amikConstants, name);
const frozenStage = numberConstant(hubConstants, 'rfd_frozen');
const zanarisComplete = numberConstant(questConstants, 'zanaris_complete');
const legendsStarted = numberConstant(legendsConstants, 'legends_started');
const guestComplete = numberConstant(hubConstants, 'rfd_guest_complete');
const chickenStage = p => bit(p, 'chickenquest');
const qp = p => p.getVar(id('VarPlayerType', 'qp'));
const guestTally = p => bit(p, 'hundred_subquest_tally');
const routeCoord = name => coordinateConstant(amikConstants, name);
const sameTile = (row, at) => row.level === at[0] && row.x === at[1] && row.z === at[2];

function gatePlayer(p) {
  setBit(p, 'hundred_main_quest_var', frozenStage);
  setBit(p, '100amikvisible', 1);
  for (const [name, complete] of [
    ['hundred_dwarf_quest', 10], ['100goblin', 10], ['100_pirate_quest_var', 10],
    ['100guide_prog', 10], ['hundred_dave_main', 7], ['100_ogre_prog', 10]
  ]) setBit(p, name, complete);
  setBit(p, 'hundred_subquest_tally', 6);
  setBit(p, '100monkeyvisible', 1);
  setVar(p, 'zanaris', zanarisComplete);
  setVar(p, 'legendsquest', legendsStarted);
  setVar(p, 'cookquest', 2);
  setVar(p, 'flour', 0);
  setVar(p, 'hopper_full', 0);
  setVar(p, 'millcheck_multi', 0);
  skill(p, 'cooking', 50);
  skill(p, 'woodcutting', 50);
}
function guestLoc() {
  const row = nativeLocRows('hundred_varze_base')[0];
  assert(row, 'original map provides the Amik guest base');
  const target = World.getLoc(row.x, row.z, row.level, id('LocType', 'hundred_varze_multi'));
  assert(target, 'RFD banquet wrapper is installed on the Amik base');
  return target;
}
function useNpc(p, item, actor) {
  stand(p, actor);
  showNpc(p, actor);
  p.clearPendingAction();
  const itemId = obj(item);
  const slot = p.getInventory(inv).getItemIndex(itemId);
  assert(slot >= 0, `${item} is carried for native NPC use`);
  assert.equal(npcUseHandler.handle(new OpNpcU(actor.nid, itemId, slot, com('inventory:inv')), p), true,
    `production OpNpcU accepts ${item} on the real NPC`);
  return capture(p, () => p.processInteraction());
}
function attackNpc(p, actor) {
  stand(p, actor);
  showNpc(p, actor);
  p.clearPendingAction();
  const type = types.NpcType.get(actor.type);
  const option = (type.op ?? []).findIndex(action => action === 'Attack') + 1;
  assert(option > 0, 'real NPC exposes its native Attack option');
  assert.equal(npcHandler.handle(new OpNpc(option, actor.nid), p), true,
    'production OpNpc accepts the visible combat target');
  assert.equal(p.target, actor, 'native Attack selects the real NPC');
  p.processInteraction();
}
function killByNativeDeath(p, actor, label) {
  const type = types.NpcType.get(actor.type);
  const death = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, type.id, type.category);
  assert(death, `${label} resolves its compiled native death trigger`);
  actor.heroPoints.clear();
  actor.heroPoints.addHero(p.hash64, actor.levels[NpcStat.HITPOINTS]);
  actor.setVar(id('VarNpcType', 'npc_aggressive_player'), p.uid);
  const state = ScriptRunner.init(death, actor);
  actor.applyDamage(actor.levels[NpcStat.HITPOINTS], 1);
  actor.executeScript(state);
  for (let tick = 0; state.execution === ScriptState.NPC_SUSPENDED && tick < 40; tick++) {
    p.processQueues();
    World.currentTick = Math.max(World.currentTick + 1, actor.delayedUntil);
    actor.delayed = false;
    actor.executeScript(state);
  }
  p.processQueues();
  assert.equal(state.execution, ScriptState.FINISHED, `${label} native death finishes`);
}
function takePrivateDrop(p, item, at, label) {
  const itemId = obj(item);
  const ground = World.getObj(at[1], at[2], at[0], itemId, p.hash64);
  assert(ground, `${label} produces a private ${item} ground object`);
  stand(p, ground);
  assert(p.inOperableDistance(ground), `${label} drop is in native Take range`);
  const type = types.ObjType.get(itemId);
  const option = type.op.findIndex(action => action === 'Take') + 1;
  assert(option > 0, `${item} exposes the packed Take option`);
  assert.equal(groundTakeHandler.handle(new OpObj(option, ground.x, ground.z, itemId), p), true,
    `${label} is taken through production OpObj`);
  capture(p, () => p.processInteraction());
  assert.equal(count(p, item), 1, `${label} Take places ${item} in inventory`);
  assert.equal(ground.isActive, false, `${label} Take removes the private ground object`);
}
function activeNpcs(name) {
  const type = id('NpcType', name);
  return [...World.npcs].filter(actor => actor.isActive && actor.type === type);
}
function rubDragonToken(p) {
  const token = obj('chickenquest_dragon_coin');
  const option = types.ObjType.get(token).iop.findIndex(action => action === 'Rub') + 1;
  assert(option > 0, 'Dragon token exposes the packed Rub option');
  const slot = p.getInventory(inv).getItemIndex(token);
  assert(slot >= 0, 'Dragon token remains available for Rub');
  p.clearPendingAction();
  capture(p, () => assert.equal(heldHandler.handle(new OpHeld(option, token, slot, com('inventory:inv')), p), true,
    'production OpHeld accepts native Rub'));
}

// Prior guests and prerequisites are fixtures; native Inspect starts this guest route.
const p = player();
run(p, '[proc,rfd_prepare_banquet]');
const amikBase = guestLoc();
const blocked = player();
setBit(blocked, 'hundred_main_quest_var', frozenStage);
setBit(blocked, '100amikvisible', 1);
setVar(blocked, 'cookquest', 2);
operate(blocked, amikBase);
assert.equal(chickenStage(blocked), 0, 'missing Zanaris and Legends prerequisites block native Inspect');

gatePlayer(p);
operate(p, amikBase);
assert.equal(chickenStage(p), amik('rfd_amik_inspected'), 'native Inspect starts the Amik guest route');
talk(p, nativeNpc('hundred_aris'), [1]);
assert.equal(chickenStage(p), amik('rfd_amik_aris_spoken'), 'Aris Talk advances the inspected route');
talk(p, nativeNpc('cook'), [1]);
assert.equal(chickenStage(p), amik('rfd_amik_cook_spoken'), 'Cook Talk advances the recipe route');

// Gnome and cake dispatch still reach their ordinary recipes when the route pair does not match.
give(p, 'pot_of_cream');
give(p, 'unfinished_chocolate_saturday3');
useItems(p, 'unfinished_chocolate_saturday3', 'pot_of_cream');
assert.equal(count(p, 'unfinished_chocolate_saturday4'), 1, 'Gnome chocolate cocktail keeps its native cream case');
give(p, 'bucket_milk');
give(p, 'cake_tin');
give(p, 'egg');
give(p, 'pot_flour');
useItems(p, 'cake_tin', 'bucket_milk');
assert.equal(count(p, 'uncooked_cake'), 1, 'ordinary cake recipe still runs through the changed milk handler');
assert.equal(count(p, 'pot_empty'), 1);
assert.equal(count(p, 'bucket_empty'), 1);
assert.equal(chickenStage(p), amik('rfd_amik_cook_spoken'), 'ordinary cake does not advance Amik');

// Both native standard-cooking packets reach the shared milk/cream route helper.
give(p, 'bucket_milk');
give(p, 'pot_of_cream');
useItems(p, 'pot_of_cream', 'bucket_milk');
assert.equal(count(p, 'chickenquest_milky_mixture'), 1, 'Cake milk handler makes the Amik mixture');
assert.equal(chickenStage(p), amik('rfd_amik_milky_mixture'));
const gnomeRoute = player();
gatePlayer(gnomeRoute);
setBit(gnomeRoute, 'chickenquest', amik('rfd_amik_cook_spoken'));
give(gnomeRoute, 'bucket_milk');
give(gnomeRoute, 'pot_of_cream');
useItems(gnomeRoute, 'bucket_milk', 'pot_of_cream');
assert.equal(count(gnomeRoute, 'chickenquest_milky_mixture'), 1, 'Gnome milk handler makes the Amik mixture');
assert.equal(chickenStage(gnomeRoute), amik('rfd_amik_milky_mixture'));

// Generic grain still follows the windmill fallback; route sweetcorn uses the real hopper and lever.
const hopperAt = routeCoord('rfd_amik_hopper_coord');
const hopper = nativeLoc('hopper_lumbridge', rows => rows.find(row => sameTile(row, hopperAt)));
const ordinaryMill = player();
give(ordinaryMill, 'grain');
useLoc(ordinaryMill, 'grain', hopper);
assert.equal(count(ordinaryMill, 'grain'), 0, 'ordinary grain still fills the original hopper');
assert.equal(ordinaryMill.getVar(id('VarPlayerType', 'hopper_full')), 1);
give(p, 'sweetcorn');
useLoc(p, 'sweetcorn', hopper);
assert.equal(count(p, 'sweetcorn'), 0, 'native hopper use consumes sweetcorn');
assert.equal(bit(p, 'chickenquest_things_done'), 1);
const lever = nativeLoc('hopperlevers1', rows => rows.find(row => row.level === hopperAt[0]
  && Math.abs(row.x - hopperAt[1]) <= 5 && Math.abs(row.z - hopperAt[2]) <= 5));
operate(p, lever);
assert.equal(bit(p, 'chickenquest_things_done'), 2, 'lever action advances the cornflour stage');
const millAt = routeCoord('rfd_amik_millbase_coord');
const millbase = nativeLoc('millbase', rows => rows.find(row => sameTile(row, millAt)));
useLoc(p, 'pot_empty', millbase);
assert.equal(count(p, 'chickenquest_pot_cornflour'), 1, 'mill bin yields route cornflour');
assert.equal(count(p, 'pot_empty'), 0);
useItems(p, 'chickenquest_milky_mixture', 'chickenquest_pot_cornflour');
assert.equal(count(p, 'chickenquest_cornflour_milky_mixture'), 1, 'native item use combines cornflour and cream');
assert.equal(count(p, 'chickenquest_milky_mixture'), 0);
assert.equal(count(p, 'chickenquest_pot_cornflour'), 0);
assert.equal(chickenStage(p), amik('rfd_amik_cornflour_mixture'));

operate(p, nativeLoc('chickenquest_vanilla_plant'));
assert.equal(count(p, 'chickenquest_vanilla_pod'), 1, 'original vanilla plant yields its pod');
assert.equal(chickenStage(p), amik('rfd_amik_cornflour_mixture'), 'picking a pod does not claim it has already been mixed');
useItems(p, 'chickenquest_vanilla_pod', 'chickenquest_cornflour_milky_mixture');
assert.equal(count(p, 'chickenquest_brulee_mixture'), 1, 'native item use makes the vanilla brulee mixture');
assert.equal(count(p, 'chickenquest_cornflour_milky_mixture'), 0);
assert.equal(count(p, 'chickenquest_vanilla_pod'), 0);
assert.equal(chickenStage(p), amik('rfd_amik_vanilla_added'));

// Branch grinding is an actual item-use action and succeeds before ice gloves are equipped.
give(p, 'dramen_branch');
give(p, 'pestle_and_mortar');
useItems(p, 'pestle_and_mortar', 'dramen_branch');
assert.equal(count(p, 'dramen_branch'), 0);
assert.equal(count(p, 'chickenquest_cinamon'), 1, 'native pestle use produces route cinnamon');
assert.equal(count(p, 'ice_gloves', worn), 0, 'cinnamon production does not require gloves');

// Swan Song remains the ordinary fallback while the stage-six Amik topic reaches its warning.
const wom = nativeNpc('wom_multi', rows => rows.find(row => row.level === 0
  && row.x > 3000 && row.x < 3200 && row.z > 3000 && row.z < 3400));
const swanFallback = player();
gatePlayer(swanFallback);
setBit(swanFallback, 'chickenquest', amik('rfd_amik_vanilla_added'));
talk(swanFallback, wom, [2]);
assert.equal(chickenStage(swanFallback), amik('rfd_amik_vanilla_added'), 'Swan Song option leaves Amik unchanged');
assert.equal(bit(swanFallback, 'chickenquest_wom_warning'), 0);
talk(p, wom, [1, 1]);
assert.equal(chickenStage(p), amik('rfd_amik_wom_warned'), 'WOM warning advances the route');
assert.equal(bit(p, 'chickenquest_wom_warning'), 1);

// Raw chicken on the original shrine is the only entry action; the route has no shield gate.
give(p, 'raw_chicken');
assert.equal(count(p, 'antidragonbreathshield', worn), 0, 'lair entry fixture has no equipped shield');
const shrineAt = routeCoord('rfd_amik_shrine_coord');
const shrine = nativeLoc('fairy_chicken_shrine', rows => rows.find(row => sameTile(row, shrineAt)));
useLoc(p, 'raw_chicken', shrine);
assert.equal(count(p, 'raw_chicken'), 0);
assert.deepEqual(tile(p), routeCoord('rfd_amik_lair_entry'), 'native shrine use enters the lair');

// The route summons the real Evil Chicken; Attack and its compiled death event produce the egg.
const chickenAt = routeCoord('rfd_amik_chicken_spawn');
const evilId = id('NpcType', 'chickenquest_evil_chicken');
const evil = [...World.npcs].find(actor => actor.isActive && actor.type === evilId && actor.level === chickenAt[0]
  && actor.x === chickenAt[1] && actor.z === chickenAt[2]);
assert(evil, 'shrine action summons the Evil Chicken at the checked-out route coordinate');
assert.equal(types.NpcType.get(evilId).stats[NpcStat.MAGIC], 200, 'Evil Chicken keeps approved native Magic 200');
attackNpc(p, evil);
killByNativeDeath(p, evil, 'Evil Chicken');
takePrivateDrop(p, 'chickenquest_evil_chicken_egg', [evil.level, evil.x, evil.z], 'Evil Chicken death');
useItems(p, 'chickenquest_evil_chicken_egg', 'chickenquest_brulee_mixture');
assert.equal(count(p, 'chickenquest_brulee_mixture_egg'), 1, 'native egg use adds the route egg');
assert.equal(count(p, 'chickenquest_evil_chicken_egg'), 0);
assert.equal(count(p, 'chickenquest_brulee_mixture'), 0);
assert.equal(chickenStage(p), amik('rfd_amik_egg_added'));
useItems(p, 'chickenquest_cinamon', 'chickenquest_brulee_mixture_egg');
assert.equal(count(p, 'chickenquest_brulee_mixture_cinamon'), 1, 'native cinnamon use finishes the brulee without gloves');
assert.equal(count(p, 'chickenquest_brulee_mixture_egg'), 0);
assert.equal(count(p, 'chickenquest_cinamon'), 0);
assert.equal(chickenStage(p), amik('rfd_amik_cinnamon_added'));

// A mapped lair Black Dragon's compiled death hook produces a private token before npc_death.
const lairMin = routeCoord('rfd_amik_lair_min');
const lairMax = routeCoord('rfd_amik_lair_max');
const dragon = nativeNpc('black_dragon', rows => rows.find(row => row.level === lairMin[0]
  && row.x >= lairMin[1] && row.x <= lairMax[1] && row.z >= lairMin[2] && row.z <= lairMax[2]));
attackNpc(p, dragon);
killByNativeDeath(p, dragon, 'Black Dragon');
takePrivateDrop(p, 'chickenquest_dragon_coin', [dragon.level, dragon.x, dragon.z], 'Black Dragon death');

// Rub retains the token, summons one nearby K'klik, and reuses that shared NPC.
rubDragonToken(p);
assert.equal(count(p, 'chickenquest_dragon_coin'), 1, 'Rub retains the token for flambe');
const kklikType = id('NpcType', 'chickenquest_fairy_dragon');
const kkliks = activeNpcs('chickenquest_fairy_dragon');
assert.equal(kkliks.length, 1, 'Rub summons one shared K\'klik');
const kklik = kkliks[0];
const spawnBound = amik('rfd_amik_fairy_spawn_max');
assert.equal(kklik.level, p.level);
assert(Math.max(Math.abs(kklik.x - p.x), Math.abs(kklik.z - p.z)) <= spawnBound,
  'K\'klik is placed within the configured bounded search square');
rubDragonToken(p);
assert.equal(count(p, 'chickenquest_dragon_coin'), 1, 'repeated Rub retains the token');
assert.deepEqual(activeNpcs('chickenquest_fairy_dragon'), [kklik], 'repeated Rub reuses rather than duplicates K\'klik');
assert.equal(kklik.type, kklikType);

// Isolate each flambe guard against the already shared NPC.
assert.equal(count(p, 'ice_gloves', worn), 0);
useNpc(p, 'chickenquest_brulee_mixture_cinamon', kklik);
assert.equal(count(p, 'chickenquest_dragon_coin'), 1, 'missing gloves preserve the token');
assert.equal(count(p, 'chickenquest_brulee_mixture_cinamon'), 1, 'missing gloves preserve the mixture');
assert.equal(kklik.isActive, true, 'missing gloves preserve K\'klik');
const bypass = player();
gatePlayer(bypass);
setBit(bypass, 'chickenquest', amik('rfd_amik_cinnamon_added'));
give(bypass, 'chickenquest_brulee_mixture_cinamon');
give(bypass, 'ice_gloves');
equip(bypass, 'ice_gloves');
useNpc(bypass, 'chickenquest_brulee_mixture_cinamon', kklik);
assert.equal(count(bypass, 'chickenquest_dragon_coin'), 0);
assert.equal(count(bypass, 'chickenquest_brulee_mixture_cinamon'), 1, 'no-token shared-NPC attempt preserves the mixture');
assert.equal(chickenStage(bypass), amik('rfd_amik_cinnamon_added'));
assert.equal(kklik.isActive, true, 'no-token attempt does not remove the shared NPC');

// With token and gloves, one native NPC-use consumes both inputs and removes K'klik atomically.
give(p, 'ice_gloves');
equip(p, 'ice_gloves');
useNpc(p, 'chickenquest_brulee_mixture_cinamon', kklik);
assert.equal(count(p, 'chickenquest_dragon_coin'), 0, 'successful flambe consumes the retained token');
assert.equal(count(p, 'chickenquest_brulee_mixture_cinamon'), 0, 'successful flambe consumes the cinnamon mixture');
assert.equal(count(p, 'chickenquest_brulee_mixture_supreme'), 1, 'successful flambe produces the supreme brulee');
assert.equal(kklik.isActive, false, 'successful flambe removes K\'klik in the same action');

// Exit through the original portal, then hand the finished food to Amik through native item-on-loc.
const portalAt = routeCoord('rfd_amik_lair_portal');
const portal = nativeLoc('100_portal_chicken', rows => rows.find(row => sameTile(row, portalAt)));
operate(p, portal);
assert.deepEqual(tile(p), routeCoord('rfd_amik_shrine_return'), 'original chicken portal returns beside the solid shrine');
run(p, '[proc,update_questpoints]');
const beforeXp = [...p.stats];
const beforeTally = guestTally(p);
const beforeQp = qp(p);
useLoc(p, 'chickenquest_brulee_mixture_supreme', amikBase);
assert.equal(chickenStage(p), guestComplete, 'item hand-in completes the Amik guest');
assert.equal(bit(p, '100amikvisible'), 0, 'shared reward latch hides the freed guest');
assert.equal(guestTally(p), beforeTally + 1, 'Amik completion increments the shared tally once');
assert.equal(qp(p), beforeQp + 1, 'Amik completion awards one quest point');
for (let stat = 0; stat < p.stats.length; stat++) {
  const expected = stat === PlayerStat.COOKING || stat === PlayerStat.HITPOINTS ? 40000 : 0;
  assert.equal(p.stats[stat] - beforeXp[stat], expected, `Amik reward skill ${stat} delta`);
}
assert.equal(count(p, 'chickenquest_brulee_mixture_supreme'), 0, 'Amik hand-in consumes the finished brulee');
assert.equal(run(p, '[proc,rfd_food_shop]').popInt(), id('InvType', 'hundred_foodchest8'), 'the seventh rescue unlocks food tier eight');
assert.equal(run(p, '[proc,rfd_item_shop]').popInt(), id('InvType', 'hundred_rewardchest8'), 'the seventh rescue unlocks equipment tier eight');
for (const name of [
  'chickenquest_vanilla_pod', 'chickenquest_cornflour', 'cert_chickenquest_cornflour',
  'chickenquest_pot_cornflour', 'cert_chickenquest_pot_cornflour', 'chickenquest_milky_mixture',
  'chickenquest_cornflour_milky_mixture', 'chickenquest_cinamon', 'chickenquest_brulee_mixture',
  'chickenquest_brulee_mixture_egg', 'chickenquest_brulee_mixture_cinamon',
  'chickenquest_brulee_mixture_supreme', 'chickenquest_evil_chicken_egg', 'chickenquest_dragon_coin'
]) assert.equal(types.ObjType.get(obj(name)).tradeable, false, `${name} is server-untradeable`);
console.log('PASS RFD S3 Amik native Inspect/Aris/Cook, mill/cooking, WOM/Swan, lair combat/rescue, K\'klik flambe and reward');
process.exit(0);
