import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const loadEngine = relative => import(pathToFileURL(path.join(engine, 'src', relative)).href);
const Environment = (await loadEngine('util/Environment.ts')).default;
Environment.NODE_MEMBERS = true;

const runtime = await import('./runtime.mjs');
const { JavaRandom, Runner, Scripts, State, World, count, id, load, proc, slot, types } = runtime;
const OpObjHandler = new (await load('network/game/client/handler/OpObjHandler.ts')).default();
const OpHeld = (await load('network/game/client/model/OpHeld.ts')).default;
const OpHeldHandler = new (await load('network/game/client/handler/OpHeldHandler.ts')).default();
const MoveClick = (await load('network/game/client/model/MoveClick.ts')).default;
const MoveClickHandler = new (await load('network/game/client/handler/MoveClickHandler.ts')).default();
const { Interaction } = await load('engine/entity/Interaction.ts');
const ServerTriggerType = (await load('engine/script/ServerTriggerType.ts')).default;
const InvButton = (await load('network/game/client/model/InvButton.ts')).default;
const InvButtonHandler = new (await load('network/game/client/handler/InvButtonHandler.ts')).default();
const inventoryComponent = id('Component', 'inventory:inv');
const map = await load('engine/GameMap.ts');
const Npc = (await load('engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await load('engine/entity/EntityLifeCycle.ts');
const ScriptPointer = (await load('engine/script/ScriptPointer.ts')).default;

const BIRD_NEST_SEEDS = [
  ['magic_tree_seed', 0, 5], ['spirit_tree_seed', 5, 16], ['calquat_tree_seed', 16, 33],
  ['palm_tree_seed', 33, 55], ['yew_seed', 55, 82], ['papaya_tree_seed', 82, 116],
  ['pineapple_tree_seed', 116, 158], ['maple_seed', 158, 212], ['curry_tree_seed', 212, 280],
  ['orange_tree_seed', 280, 365], ['banana_tree_seed', 365, 473], ['willow_seed', 473, 608],
  ['apple_tree_seed', 608, 778], ['acorn', 778, 1000]
];

function scriptRoll(bound) {
  return Math.floor(JavaRandom.nextDouble() * bound);
}

function seedForRoll(bound, minimum, maximum) {
  for (let seed = 1; seed <= 100_000; seed++) {
    JavaRandom.setSeed(seed);
    const roll = scriptRoll(bound);
    if (roll >= minimum && roll < maximum) return seed;
  }
  assert.fail(`no native JavaRandom seed produced random(${bound}) in [${minimum}, ${maximum})`);
}

function captureGround(action) {
  const objects = [];
  const originalAddObj = World.addObj;
  World.addObj = function (object, receiver, duration) {
    objects.push(object);
    return originalAddObj.call(this, object, receiver, duration);
  };
  try {
    return { result: action(), objects };
  } finally {
    World.addObj = originalAddObj;
  }
}

function mapTreeRows(treeId) {
  const rows = [];
  const mapDirectory = path.join(content, 'maps');
  for (const filename of fs.readdirSync(mapDirectory).filter(file => /^m\d+_\d+\.jm2$/.test(file))) {
    if (filename !== 'm48_50.jm2') continue;
    const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(filename);
    let section = '';
    for (const line of fs.readFileSync(path.join(mapDirectory, filename), 'utf8').split(/\r?\n/)) {
      if (line.startsWith('====')) {
        section = line.split(' ')[1];
        continue;
      }
      if (section !== 'LOC') continue;
      const match = /^([0-3]) (\d+) (\d+): (\d+)(?: (\d+))?(?: (\d+))?$/.exec(line);
      if (!match || Number(match[4]) !== treeId) continue;
      const [level, x, z] = match.slice(1, 4).map(Number);
      const loc = World.getLoc(Number(mx) * 64 + x, Number(mz) * 64 + z, level, treeId);
      assert(loc, `packed tree LOC ${filename}:${line} is present in World`);
      rows.push(loc);
    }
  }
  return rows;
}

function playerApproachForLoc(loc) {
  const config = types.LocType.get(loc.type);
  for (let x = loc.x - 1; x <= loc.x + config.width; x++) {
    for (let z = loc.z - 1; z <= loc.z + config.length; z++) {
      if (map.isMapBlocked(x, z, loc.level) || !map.reachedLoc(loc.level, x, z,
        loc.x, loc.z, config.width, config.length, 1, loc.angle, loc.shape, config.forceapproach)) continue;
      for (const [dx, dz] of [[-8, 0], [8, 0], [0, -8], [0, 8]]) {
        const start = { x: x + dx, z: z + dz };
        if (map.isMapBlocked(start.x, start.z, loc.level)) continue;
        const route = map.findPathToLoc(loc.level, start.x, start.z, loc.x, loc.z,
          1, config.width, config.length, loc.angle, loc.shape, config.forceapproach);
        if (!route.length) continue;
        const end = route[route.length - 1];
        if (map.reachedLoc(loc.level, (end >>> 14) & 0x3fff, end & 0x3fff,
          loc.x, loc.z, config.width, config.length, 1, loc.angle, loc.shape, config.forceapproach) &&
          map.findPath(loc.level, start.x, start.z, x, z).length) return { x, z };
      }
    }
  }
  return null;
}

function advanceUntil(player, predicate, label) {
  for (let tick = 0; tick < 12; tick++) {
    if (predicate() && !player.delayed &&
      (!player.activeScript || player.activeScript.execution === State.FINISHED)) return;
    World.currentTick++;
    World.processPlayers();
    player.resetEntity(false);
  }
  assert(predicate(), `${label} completes through the production player loop: ${JSON.stringify({
    messages: player.messages, interaction: player.hasInteraction(), x: player.x, z: player.z, level: player.level
  })}`);
  assert(!player.delayed, `${label} leaves no native delay`);
}

const treeId = id('LocType', 'tree');
let tree;
let treePoint;
for (const candidate of mapTreeRows(treeId)) {
  const point = playerApproachForLoc(candidate);
  if (point) {
    tree = candidate;
    treePoint = point;
    break;
  }
}
assert(tree && treePoint, 'a packed tree LOC has a local map approach path; ordinary entry is not asserted');

const player = runtime.player();
player.x = treePoint.x;
player.z = treePoint.z;
player.level = tree.level;
player.resetEntity(false);

const birdNestId = id('ObjType', 'bird_nest_seeds');
World.playerLoop.add(BigInt(player.pid), player);
try {
for (const [name, lower, upper] of BIRD_NEST_SEEDS) {
  const dropSeed = seedForRoll(5, 3, 4);
  const openSeed = seedForRoll(1000, lower, upper);
  JavaRandom.setSeed(dropSeed);
  const nestDrop = captureGround(() => proc(player, 'drop_bird_nest'));
  assert.equal(nestDrop.objects.length, 1, 'native tree helper creates one ground nest');
  assert.equal(nestDrop.objects[0].type, birdNestId, 'native tree helper selects the seed-nest object');

  const nest = World.getObj(nestDrop.objects[0].x, nestDrop.objects[0].z, nestDrop.objects[0].level,
    birdNestId, player.hash64);
  assert(nest, 'produced seed nest is present in the packed World');
  const takeOp = types.ObjType.get(birdNestId).op.findIndex(option => option?.toLowerCase() === 'take') + 1;
  assert(takeOp > 0, 'packed seed nest exposes a native ground Take option');
  player.originX = player.x;
  player.originZ = player.z;
  assert.equal(map.isMapBlocked(nest.x, nest.z, nest.level), false, 'native nest drop tile is walkable');
  if (player.x !== nest.x || player.z !== nest.z) {
    const route = map.findPath(nest.level, player.x, player.z, nest.x, nest.z);
    assert(route.length, 'produced ground nest has a packed-collision footpath from the player');
    const path = Array.from(route, coord => ({ x: (coord >>> 14) & 0x3fff, z: coord & 0x3fff }));
    assert.deepEqual(path[path.length - 1], { x: nest.x, z: nest.z }, 'pickup route reaches the exact nest tile');
    assert(MoveClickHandler.handle(new MoveClick(path, 0, true), player),
      'native MOVE_OPCLICK supplies the walking route paired with AP_OBJ');
  }
  assert(OpObjHandler.handle({ x: nest.x, z: nest.z, obj: nest.type, op: takeOp }, player),
    'real AP_OBJ handler accepts the produced nest');
  advanceUntil(player, () => count(player, 'bird_nest_seeds') === 1, 'native ground pickup');
  assert.equal(count(player, 'bird_nest_seeds'), 1, 'AP_OBJ transfers the exact nest into inventory');
  assert.equal(World.getObj(nest.x, nest.z, nest.level, nest.type, player.hash64), null,
    'AP_OBJ removes the transferred ground nest');

  const heldMessage = new OpHeld(1, birdNestId, slot(player, 'bird_nest_seeds'), inventoryComponent);
  JavaRandom.setSeed(openSeed);
  assert(OpHeldHandler.handle(heldMessage, player), `real OP_HELD handler accepts the seed nest: ${JSON.stringify({
    delayed: player.delayed, operable: types.Component.get(inventoryComponent).operable,
    visible: player.isComponentVisible(types.Component.get(inventoryComponent)),
    listener: player.invListeners.some(listener => listener.com === inventoryComponent),
    option: types.ObjType.get(birdNestId).iop[0], root: types.Component.get(inventoryComponent).rootLayer,
    tabs: player.tabs
  })}`);
  advanceUntil(player, () => count(player, name) === 1 && count(player, 'bird_nest_seeds') === 0,
    `native ${name} opening`);
  assert.equal(count(player, name), 1, `native OP_HELD open transfers exact ${name} to inventory`);
  assert.equal(count(player, 'bird_nest_seeds'), 0, 'opening consumes the seed-nest container');
}
} finally {
  player.unlink();
}

const merchant = Array.from(World.npcs).find(npc => npc.type === id('NpcType', 'seed_merchant') &&
  npc.level === 0 && npc.x >= 3072 && npc.x < 3136 && npc.z >= 3200 && npc.z < 3264);
assert(merchant, 'original Draynor seed merchant is placed in the packed World');
const buyer = runtime.player();
buyer.level = merchant.level;
let buyerPoint;
for (const [dx, dz] of [[-8, 0], [8, 0], [0, -8], [0, 8]]) {
  const start = { x: merchant.x + dx, z: merchant.z + dz };
  if (map.isMapBlocked(start.x, start.z, merchant.level)) continue;
  const route = map.findPathToEntity(merchant.level, start.x, start.z,
    merchant.x, merchant.z, 1, merchant.width, merchant.length);
  if (!route.length) continue;
  const end = route[route.length - 1];
  const point = { x: (end >>> 14) & 0x3fff, z: end & 0x3fff };
  if (!map.isMapBlocked(point.x, point.z, merchant.level) &&
    map.findPath(merchant.level, start.x, start.z, point.x, point.z).length) {
    buyerPoint = point;
    break;
  }
}
assert(buyerPoint, 'original seed merchant has a packed-collision local footpath');
buyer.x = buyerPoint.x;
buyer.z = buyerPoint.z;
buyer.resetEntity(false);
assert(buyer.inOperableDistance(merchant), 'buyer stands at a native operable NPC approach');
runtime.add(buyer, 'coins', 100_000);
const shopId = id('InvType', 'seed_stall');
const shopComponent = id('Component', 'shop_template:inv');
const merchantType = types.NpcType.get(merchant.type);
const tradeOp = merchantType.op.findIndex(option => /^trade/i.test(option ?? '')) + 1;
assert(tradeOp > 0, 'original seed merchant exposes Trade');
assert.equal(merchantType.params.get(id('ParamType', 'owned_shop')), shopId, 'merchant owns seed_stall stock');
World.playerLoop.add(BigInt(buyer.pid), buyer);
const bought = [];
const zeroStock = [];
try {
  assert(buyer.setInteraction(Interaction.ENGINE, merchant, ServerTriggerType.APNPC1 + tradeOp - 1),
    'native trade interaction accepts the original NPC');
  advanceUntil(buyer, () => buyer.getVar(id('VarPlayerType', 'shop')) === shopId &&
    buyer.isComponentVisible(types.Component.get(shopComponent)), 'native seed-merchant trade');
  const listener = buyer.invListeners.find(entry => entry.type === shopId && entry.com === shopComponent);
  assert(listener, 'native trade transmits the actual seed shop inventory');
  const shop = buyer.getInventoryFromListener(listener);
  assert(shop, 'native shop listener resolves the packed stock inventory');
  const buyOne = types.Component.get(shopComponent).iop.findIndex(option => /buy[^\d]*1\b/i.test(option ?? '')) + 1;
  assert(buyOne > 0, 'native shop interface exposes Buy 1');
  const shopType = types.InvType.get(shopId);
  for (let index = 0; index < shopType.stockobj.length; index++) {
    const obj = shopType.stockobj[index];
    if (!types.ObjType.get(obj).debugname.includes('seed')) continue;
    const name = types.ObjType.get(obj).debugname;
    const beforeCoins = count(buyer, 'coins');
    const beforeStock = shop.getItemCount(obj);
    if (shopType.stockcount[index] === 0) {
      assert.equal(beforeStock, 0, `${name} has no native initial stock`);
      assert(InvButtonHandler.handle(new InvButton(buyOne, obj, shop.getItemIndex(obj), shopComponent), buyer),
        `native Buy 1 handles the zero-stock ${name} row`);
      assert.equal(count(buyer, name), 0, `zero stock does not produce ${name}`);
      assert.equal(count(buyer, 'coins'), beforeCoins, `zero-stock ${name} does not charge coins`);
      zeroStock.push(name);
      continue;
    }
    assert(InvButtonHandler.handle(new InvButton(buyOne, obj, shop.getItemIndex(obj), shopComponent), buyer),
      `native Buy 1 accepts ${name}`);
    assert.equal(count(buyer, name), 1, `native shop purchase transfers ${name}`);
    assert.equal(shop.getItemCount(obj), beforeStock - 1, `native purchase removes one ${name} from stock`);
    assert(count(buyer, 'coins') < beforeCoins, `native purchase charges coins for ${name}`);
    bought.push(name);
  }
  assert.deepEqual(bought.slice().sort(), [
    'asgarnian_hop_seed', 'barley_seed', 'cabbage_seed', 'hammerstone_hop_seed', 'jute_seed',
    'marigold_seed', 'onion_seed', 'potato_seed', 'rosemary_seed', 'yanillian_hop_seed'
  ].sort(), 'all ten positive-stock seed identities have native purchase witnesses');
  assert.deepEqual(zeroStock.slice().sort(), [
    'krandorian_hop_seed', 'strawberry_seed', 'sweetcorn_seed', 'tomato_seed', 'watermelon_seed', 'wildblood_hop_seed'
  ].sort(), 'all six zero-stock seed identities fail to produce an inventory item');
} finally {
  buyer.unlink();
}
console.log(`PASS: ${bought.length} original seed-merchant native trade and Buy 1 transfers`);

console.log(`PASS: ${BIRD_NEST_SEEDS.length} native bird-nest ground-drop, pickup, and open transfers; ordinary map entry was not asserted`);
const cropGroups = {
  allotment: ['potato_seed', 'onion_seed', 'cabbage_seed', 'tomato_seed', 'sweetcorn_seed', 'strawberry_seed', 'watermelon_seed'],
  hops: ['hammerstone_hop_seed', 'barley_seed', 'asgarnian_hop_seed', 'jute_seed', 'yanillian_hop_seed', 'krandorian_hop_seed', 'wildblood_hop_seed'],
  flower: ['marigold_seed', 'rosemary_seed', 'nasturtium_seed', 'limpwurt_seed', 'woad_seed'],
  herb: ['guam_seed', 'marrentill_seed', 'tarromin_seed', 'harralander_seed', 'ranarr_seed', 'toadflax_seed', 'irit_seed',
    'avantoe_seed', 'kwuarm_seed', 'snapdragon_seed', 'cadantine_seed', 'lantadyme_seed', 'dwarf_weed_seed', 'torstol_seed'],
  bush: ['redberry_bush_seed', 'cadavaberry_bush_seed', 'dwellberry_bush_seed', 'jangerberry_bush_seed', 'whiteberry_bush_seed', 'poisonivy_bush_seed'],
  tree: ['acorn', 'willow_seed', 'maple_seed', 'yew_seed', 'magic_tree_seed', 'spirit_tree_seed'],
  fruit_tree: ['apple_tree_seed', 'banana_tree_seed', 'orange_tree_seed', 'curry_tree_seed', 'pineapple_tree_seed', 'papaya_tree_seed', 'palm_tree_seed', 'calquat_tree_seed'],
  special: ['mushroom_seed', 'belladonna_seed', 'cactus_seed', 'deal_blindweed_seed', 'village_rare_tuber']
};
const questAndContainers = [
  'kelda_hop_seed', 'garden_rosebush_seed_white', 'garden_rosebush_seed_red', 'garden_rosebush_seed_pink', 'garden_vine_seed',
  'garden_delphinium_seed', 'garden_orchid_pink_seed', 'garden_orchid_yellow_seed', 'garden_snowdrop_seed', 'mithril_seed',
  'yommiseeds', 'yommiseeds_germ', 'mdaughter_white_pearl_seed', 'roving_old_consecration_seed', 'roving_new_consecration_seed',
  'crystal_seed_old', 'swan_army', '100guide_potato_seed_dum', '100guide_onion_seed_dum', '100guide_tomato_seed_dum',
  'bird_nest_seeds', 'bird_nest_cheapseeds'
];
const cacheObjects = new Map();
let currentObject;
for (const file of [
  'scripts/_unpack/377/all.obj',
  'scripts/quests/quest_deal/configs/quest_deal.obj',
  'scripts/quests/quest_garden/configs/garden.obj',
  'scripts/quests/quest_roving_elves/configs/roving_crystals.obj',
  'scripts/quests/quest_swansong/configs/swan.obj',
  'scripts/quests/quest_roving_elves/configs/roving_seeds.obj'
]) {
  currentObject = undefined;
  for (const line of fs.readFileSync(path.join(content, file), 'utf8').split(/\r?\n/)) {
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      currentObject = {};
      cacheObjects.set(header[1], currentObject);
    } else if (currentObject && !line.startsWith('//') && line.includes('=')) {
      const equals = line.indexOf('=');
      currentObject[line.slice(0, equals)] = line.slice(equals + 1);
    }
  }
}
const countAliases = new Set(Array.from(cacheObjects.values()).flatMap(config =>
  Object.entries(config).filter(([key]) => /^count\d+$/.test(key)).map(([, value]) => value.split(',')[0])));
const seedLike = Array.from(cacheObjects.entries()).filter(([name, config]) =>
  !config.certlink && !countAliases.has(name) &&
  (name.includes('seed') || config.name?.toLowerCase().includes('seed') || name === 'acorn' || name === 'village_rare_tuber'));
const potted = seedLike.filter(([name, config]) => name.startsWith('plantpot_') && config.name.endsWith(' seedling')).map(([name]) => name);
const cropNames = Object.values(cropGroups).flat();
assert.deepEqual(seedLike.map(([name]) => name).sort(),
  [...cropNames, ...questAndContainers, 'seeds_skillguide', 'dibber', ...potted].sort(),
  'every canonical seed-like cache identity is classified, including acorn, tuber, quest items and propagated forms');
for (const name of [...cropNames, ...questAndContainers]) {
  id('ObjType', name);
  for (const [key, value] of Object.entries(cacheObjects.get(name))) {
    if (/^count\d+$/.test(key)) id('ObjType', value.split(',')[0]);
  }
}
const uncommonSeeds = [
  ['limpwurt_seed', 134], ['strawberry_seed', 131], ['marrentill_seed', 123],
  ['jangerberry_bush_seed', 94], ['tarromin_seed', 84], ['wildblood_hop_seed', 83],
  ['watermelon_seed', 63], ['harralander_seed', 58], ['ranarr_seed', 40],
  ['whiteberry_bush_seed', 34], ['mushroom_seed', 29], ['toadflax_seed', 27],
  ['belladonna_seed', 18], ['irit_seed', 18], ['poisonivy_bush_seed', 13],
  ['avantoe_seed', 12], ['cactus_seed', 12], ['kwuarm_seed', 9], ['snapdragon_seed', 6],
  ['cadantine_seed', 4], ['lantadyme_seed', 3], ['dwarf_weed_seed', 2], ['torstol_seed', 1]
];
const mogreType = types.NpcType.get(id('NpcType', 'mudskipper_ogre'));
assert.equal(Scripts.getByTrigger(ServerTriggerType.AI_QUEUE3, mogreType.id, mogreType.category),
  Scripts.getByName('[ai_queue3,mudskipper_ogre]'), 'actual Mogre death dispatch reaches its seed-producing handler');
const mogreDrop = Scripts.getByName('[proc,mogre_drop]');
assert(mogreDrop, 'actual Mogre death helper is packed');
let dropPoint;
for (let x = treePoint.x - 8; x <= treePoint.x + 8 && !dropPoint; x++) {
  for (let z = treePoint.z - 8; z <= treePoint.z + 8 && !dropPoint; z++) {
    let clear = true;
    for (let dx = 0; dx < mogreType.size; dx++) {
      for (let dz = 0; dz < mogreType.size; dz++) {
        if (map.isMapBlocked(x + dx, z + dz, tree.level)) clear = false;
      }
    }
    if (clear && map.findPath(tree.level, treePoint.x, treePoint.z, x, z).length) dropPoint = { x, z };
  }
}
assert(dropPoint, 'Mogre helper fixture footprint is collision-clear with a registered local footpath');
const collector = runtime.player();
collector.x = dropPoint.x;
collector.z = dropPoint.z;
collector.level = tree.level;
collector.resetEntity(false);
const mogre = new Npc(tree.level, dropPoint.x, dropPoint.z, mogreType.size, mogreType.size,
  EntityLifeCycle.RESPAWN, World.getNextNid(), mogreType.id, mogreType.blockwalk);
World.addNpc(mogre, -1);
World.processNpcEventQueue();
World.playerLoop.add(BigInt(collector.pid), collector);
let uncommonStart = 0;
try {
  for (const [name, weight] of uncommonSeeds) {
    let witness;
    for (let seed = 1; seed <= 1_000_000; seed++) {
      JavaRandom.setSeed(seed);
      const outer = scriptRoll(128);
      const inner = scriptRoll(998);
      if (outer >= 12 && outer < 25 && inner >= uncommonStart && inner < uncommonStart + weight) {
        witness = seed;
        break;
      }
    }
    assert(witness, `native JavaRandom joint Mogre/uncommon witness exists for ${name}`);
    JavaRandom.setSeed(witness);
    const produced = captureGround(() => {
      const state = Runner.init(mogreDrop, mogre, collector);
      state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
      mogre.executeScript(state);
      assert.equal(state.execution, State.FINISHED, `native Mogre helper finishes for ${name}`);
    }).objects;
    assert.equal(produced.length, 1, `native Mogre helper produces one ${name} ground object`);
    const ground = produced[0];
    assert.equal(ground.type, id('ObjType', name), `joint native RNG selects exact ${name}`);
    assert.equal(ground.count, 1, `native Mogre helper produces one ${name}`);
    assert.equal(ground.x, collector.x);
    assert.equal(ground.z, collector.z);
    collector.originX = collector.x;
    collector.originZ = collector.z;
    const take = types.ObjType.get(ground.type).op.findIndex(option => option?.toLowerCase() === 'take') + 1;
    assert(take > 0, `${name} exposes Take`);
    assert(OpObjHandler.handle({ x: ground.x, z: ground.z, obj: ground.type, op: take }, collector),
      `native ground packet accepts produced ${name}`);
    advanceUntil(collector, () => count(collector, name) === 1, `native Mogre ${name} pickup`);
    assert.equal(World.getObj(ground.x, ground.z, ground.level, ground.type, collector.hash64), null,
      `native pickup removes ${name} from the ground`);
    uncommonStart += weight;
  }
} finally {
  collector.unlink();
  World.removeNpc(mogre, -1);
}
assert.equal(uncommonStart, 998, 'all existing uncommon table bands are covered');
console.log(`PASS: ${uncommonSeeds.length} actual Mogre-helper native RNG ground/pickup witnesses; AI_QUEUE3 binding checked, full death is covered by tests/mogre/test_mogre.mjs`);
const nativeInventory = new Set([...bought, ...BIRD_NEST_SEEDS.map(([name]) => name), ...uncommonSeeds.map(([name]) => name)]);
const seedStallTheft = new Set([...cropGroups.allotment, ...cropGroups.hops, 'marigold_seed', 'rosemary_seed', 'nasturtium_seed']);
const masterFarmerPickpocket = new Set([
  ...cropGroups.allotment, ...cropGroups.hops, ...cropGroups.flower, ...cropGroups.bush, ...cropGroups.herb,
  'mushroom_seed', 'belladonna_seed', 'cactus_seed'
]);
assert.equal(seedStallTheft.size, 17, 'native seed-stall tests cover the seventeen original primary outcomes');
assert.equal(masterFarmerPickpocket.size, 42, 'native Master Farmer tests cover the forty-two candidate source rows');
const noProducerFound = new Set(['deal_blindweed_seed', 'village_rare_tuber']);
assert.deepEqual(cropNames.filter(name => !nativeInventory.has(name) && !seedStallTheft.has(name) &&
  !masterFarmerPickpocket.has(name)).sort(), Array.from(noProducerFound).sort(),
  'every standard identity has a native fixture witness or an explicit no-producer result');
const merchantWitness = new Set(bought);
const birdNestWitness = new Set(BIRD_NEST_SEEDS.map(([name]) => name));
const mogreDropHelperWitness = new Set(uncommonSeeds.map(([name]) => name));
console.log('SEED_SOURCE_AUDIT', JSON.stringify(Object.entries(cropGroups).flatMap(([group, names]) => names.map(name => ({
  group, name, countAliases: Object.entries(cacheObjects.get(name)).filter(([key]) => /^count\d+$/.test(key)).map(([, value]) => value.split(',')[0]),
  nativeInventoryWitness: nativeInventory.has(name),
  merchantTradeWitness: merchantWitness.has(name) ? 'tests/farming/test_seed_sources.mjs' : null,
  birdNestTransferWitness: birdNestWitness.has(name) ? 'tests/farming/test_seed_sources.mjs' : null,
  mogreDropHelperWitness: mogreDropHelperWitness.has(name) ? 'tests/farming/test_seed_sources.mjs' : null,
  registeredTheftWitness: seedStallTheft.has(name) ? 'tests/farming/test_seed_stall.mjs' : null,
  masterFarmerPickpocketWitness: masterFarmerPickpocket.has(name) ? 'tests/farming/test_master_farmer.mjs' : null,
  otherProducer: noProducerFound.has(name) ? 'UNKNOWN: no producing path established' : null,
  normalEntry: 'UNKNOWN: local approaches only'
})))));
console.log(`PASS: ${cropNames.length} Farming/seed-equivalent and ${questAndContainers.length} scope-separated packed identities; all canonical seed-like cache objects accounted for`);
process.exit(0);
