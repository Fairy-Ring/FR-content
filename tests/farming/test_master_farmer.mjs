/** Compiled Master Farmer and pickpocket-table checks.
 * Run from the sibling engine:
 *   node --import tsx ../content/tests/farming/test_master_farmer.mjs
 * Source oracle: OSRS Wiki Master Farmer, revision 3490983 (2017-02-28).
 * Category and inner weights come from its displayed GE-value formula; quantities
 * come from that revision's Seed drops rows. These are CANDIDATE later-revision data.
 * The formula's rounded weights sum to 1,000,241, so the picker uses that exact total.
 * Native JavaRandom is seeded for witnesses. No opcode or RNG method is replaced.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const loadEngine = relative => import(pathToFileURL(path.join(engine, 'src', relative)).href);
const Environment = (await loadEngine('util/Environment.ts')).default;
Environment.NODE_MEMBERS = true;
const runtime = await import('./runtime.mjs');
const { JavaRandom, PlayerStat, State, World, id, inv, player, types, load } = runtime;
const OpNpc = (await load('network/game/client/model/OpNpc.ts')).default;
const OpNpcHandler = new (await load('network/game/client/handler/OpNpcHandler.ts')).default();
const NpcStat = (await load('engine/entity/NpcStat.ts')).NpcStat;
const rsbuf = await load('network/rsbuf/index.ts');
const map = await load('engine/GameMap.ts');

const sourceGroups = [
  { name: 'allotment', categoryWeight: 485, rows: [
    ['potato_seed', 1, 4, 368], ['onion_seed', 1, 3, 276], ['cabbage_seed', 1, 3, 144],
    ['tomato_seed', 1, 2, 132], ['sweetcorn_seed', 1, 2, 46], ['strawberry_seed', 1, 1, 25],
    ['watermelon_seed', 1, 1, 11]
  ] },
  { name: 'hops', categoryWeight: 243, rows: [
    ['barley_seed', 1, 4, 229], ['hammerstone_hop_seed', 1, 3, 228], ['asgarnian_hop_seed', 1, 2, 172],
    ['jute_seed', 1, 3, 171], ['yanillian_hop_seed', 1, 2, 114], ['krandorian_hop_seed', 1, 1, 54],
    ['wildblood_hop_seed', 1, 1, 29]
  ] },
  { name: 'flower', categoryWeight: 122, rows: [
    ['marigold_seed', 1, 1, 376], ['nasturtium_seed', 1, 1, 249], ['rosemary_seed', 1, 1, 161],
    ['woad_seed', 1, 1, 119], ['limpwurt_seed', 1, 1, 95]
  ] },
  { name: 'bush', categoryWeight: 97, rows: [
    ['redberry_bush_seed', 1, 1, 400], ['cadavaberry_bush_seed', 1, 1, 280],
    ['dwellberry_bush_seed', 1, 1, 200], ['jangerberry_bush_seed', 1, 1, 80],
    ['whiteberry_bush_seed', 1, 1, 29], ['poisonivy_bush_seed', 1, 1, 11]
  ] },
  { name: 'herb', categoryWeight: 48, rows: [
    ['guam_seed', 1, 1, 320], ['marrentill_seed', 1, 1, 218], ['tarromin_seed', 1, 1, 149],
    ['harralander_seed', 1, 1, 101], ['ranarr_seed', 1, 1, 69], ['toadflax_seed', 1, 1, 47],
    ['irit_seed', 1, 1, 32], ['avantoe_seed', 1, 1, 22], ['kwuarm_seed', 1, 1, 15],
    ['snapdragon_seed', 1, 1, 10], ['cadantine_seed', 1, 1, 7], ['lantadyme_seed', 1, 1, 5],
    ['dwarf_weed_seed', 1, 1, 3], ['torstol_seed', 1, 1, 2]
  ] },
  { name: 'special', categoryWeight: 5, rows: [
    ['mushroom_seed', 1, 1, 500], ['belladonna_seed', 1, 1, 300], ['cactus_seed', 1, 1, 200]
  ] }
];
const sourceLoot = sourceGroups.flatMap(group => group.rows.map(([name, min, max, innerWeight]) => ({
  group: group.name,
  name,
  min,
  max,
  categoryWeight: group.categoryWeight,
  innerWeight,
  weight: group.categoryWeight * innerWeight
})));
const sourceByName = new Map(sourceLoot.map(row => [row.name, row]));
const sourceTotal = sourceLoot.reduce((total, row) => total + row.weight, 0);
assert.equal(sourceLoot.length, 42, 'the retained revision supplies exactly 42 source-table rows');
assert.equal(sourceByName.size, sourceLoot.length, 'source rows have unique cache identities');
assert.equal(sourceTotal, 1_000_241, 'rounded displayed formula weights sum to 1,000,241');

const farmerForms = ['master_farmer_1', 'master_farmer_2', 'martin_the_master_farmer'];
const farmerIds = new Map(farmerForms.map(name => [id('NpcType', name), name]));
const masterFarmerRow = types.DbRowType.getByName('pickpocket_master_farmer');
assert(masterFarmerRow, 'compiled pickpocket_master_farmer row is packed');
assert.deepEqual(masterFarmerRow.getValue(1, 0), [38], 'the period Master Farmer gate is Thieving 38');
assert.deepEqual(masterFarmerRow.getValue(2, 0), [430], 'the period 43 XP award is 430 tenths');
assert.deepEqual(masterFarmerRow.getValue(3, 0), [8], 'UNKNOWN: the existing eight-tick stun convention remains configured');
assert.deepEqual(masterFarmerRow.getValue(4, 0), [3], 'Master Farmer uses the sourced three damage');
assert.deepEqual(masterFarmerRow.getValue(5, 0), [90, 240], 'Master Farmer uses the shared success model');
assert.deepEqual(masterFarmerRow.getValue(8, 0), [sourceTotal], 'exclusive table uses its exact source-derived total');
const actualFormIds = Array.from({ length: masterFarmerRow.columnValues[0].length }, (_, index) => masterFarmerRow.getValue(0, index)[0]).sort((a, b) => a - b);
assert.deepEqual(actualFormIds, [...farmerIds.keys()].sort((a, b) => a - b), 'the row binds all three visible Master Farmer forms');
assert.equal(masterFarmerRow.columnValues[6].length, sourceLoot.length * 4, 'no source loot row is omitted or added');

const actualLoot = Array.from({ length: masterFarmerRow.columnValues[6].length / 4 }, (_, index) => {
  const [objectId, min, max, weight] = masterFarmerRow.getValue(6, index);
  const name = types.ObjType.get(objectId)?.debugname;
  const source = sourceByName.get(name);
  assert(source, `packed Master Farmer item ${name} is in the independent source oracle`);
  assert.deepEqual([min, max, weight], [source.min, source.max, source.weight], `${name} keeps source quantity and weight`);
  return source;
});
assert.deepEqual([...actualLoot].map(row => row.name).sort(), [...sourceByName.keys()].sort(),
  'the compiled row matches all 42 unique source identities');

const farmerRow = types.DbRowType.getByName('pickpocket_farmer');
assert(farmerRow, 'compiled ordinary farmer pickpocket row is packed');
assert.deepEqual(farmerRow.getValue(6, 0), [id('ObjType', 'coins'), 9, 9, 123], 'ordinary farmer keeps its nine-coin row');
assert.deepEqual(farmerRow.getValue(6, 1), [id('ObjType', 'potato_seed'), 1, 1, 5], 'ordinary farmer adds one potato seed at weight five');
assert.deepEqual(farmerRow.getValue(8, 0), [128], 'ordinary farmer coin and potato outcomes are exclusive over 128');
const watchmanRow = types.DbRowType.getByName('pickpocket_watchman');
assert(watchmanRow, 'legacy multi-reward watchman row is packed');
assert.deepEqual(watchmanRow.getValue(8, 0), [0], 'legacy multi-reward row disables exclusive mode with total zero');
assert.deepEqual(watchmanRow.getValue(6, 0), [id('ObjType', 'coins'), 60, 60, 128]);
assert.deepEqual(watchmanRow.getValue(6, 1), [id('ObjType', 'bread'), 1, 1, 128]);
const paladinRow = types.DbRowType.getByName('pickpocket_paladin');
assert(paladinRow, 'legacy multi-reward Paladin row is packed');
assert.deepEqual(paladinRow.getValue(8, 0), [0], 'Paladin legacy multi-reward row disables exclusive mode with total zero');
assert.deepEqual(paladinRow.getValue(6, 0), [id('ObjType', 'coins'), 80, 80, 128]);
assert.deepEqual(paladinRow.getValue(6, 1), [id('ObjType', 'chaosrune'), 2, 2, 128]);
const pickpocketTableId = types.DbTableType.getId('pickpocket');
assert(pickpocketTableId >= 0, 'packed pickpocket table exists');
const pickpocketRows = types.DbRowType.getInTable(pickpocketTableId);
assert(pickpocketRows.length > 0, 'packed pickpocket table contains rows');
for (const row of pickpocketRows) {
  assert.equal(row.columnValues[8]?.length, 1, `pickpocket row ${row.id} has exactly one loot_total`);
}

const levelChance = (level, low, high) => Math.floor((low * (99 - level)) / 98) + Math.floor((high * (level - 1)) / 98) + 1;
function sourceOutcome(seed, rows, total, level, low, high) {
  JavaRandom.setSeed(seed);
  const chance = levelChance(level, low, high);
  if (Math.floor(JavaRandom.nextDouble() * 256) >= chance) return null;
  let denominator = total;
  for (let index = rows.length - 1; index >= 0; index--) {
    const roll = Math.trunc(JavaRandom.nextDouble() * denominator);
    denominator -= rows[index].weight;
    if (roll >= denominator) return { name: rows[index].name, index };
  }
  assert.fail('the source-derived weighted table must select one row');
}
function sourceWitnesses(rows, total, level, low, high, limit = 2_000_000) {
  const found = new Map();
  for (let seed = 0; seed < limit && found.size < rows.length; seed++) {
    const result = sourceOutcome(seed, rows, total, level, low, high);
    if (result && !found.has(result.name)) found.set(result.name, seed);
  }
  assert.equal(found.size, rows.length, 'native JavaRandom witnesses cover every source outcome');
  return found;
}
const masterWitnesses = sourceWitnesses(actualLoot, sourceTotal, 38, 90, 240);

const mapOffsets = [[-8, 0], [8, 0], [0, -8], [0, 8], [-6, -6], [6, 6], [-6, 6], [6, -6]];
function approachFor(npc) {
  const fixture = player();
  try {
    const size = types.NpcType.get(npc.type).size || 1;
    for (let x = npc.x - 1; x <= npc.x + size; x++) {
      for (let z = npc.z - 1; z <= npc.z + size; z++) {
        if (map.isMapBlocked(x, z, npc.level)) continue;
        fixture.level = npc.level;
        fixture.x = x;
        fixture.z = z;
        if (!fixture.inOperableDistance(npc)) continue;
        for (const [dx, dz] of mapOffsets) {
          const start = { x: x + dx, z: z + dz, level: npc.level };
          if (map.isMapBlocked(start.x, start.z, start.level)) continue;
          const route = map.findPath(npc.level, start.x, start.z, x, z);
          if (!route.length) continue;
          const end = route.at(-1);
          if (((end >>> 14) & 0x3fff) !== x || (end & 0x3fff) !== z) continue;
          return { stand: { x, z, level: npc.level }, start, pathSteps: route.length };
        }
      }
    }
    return null;
  } finally {
    delete World.players[fixture.pid];
    fixture.unlink();
  }
}
const placedFarmers = [...World.npcs].filter(npc => npc.isActive && farmerIds.has(npc.type));
assert(placedFarmers.length > 0, 'original map placements contain Master Farmers');
const placed = placedFarmers.map(npc => ({ npc, form: farmerIds.get(npc.type), approach: approachFor(npc) }));
for (const form of farmerForms) {
  assert(placed.some(entry => entry.form === form), `an original map placement exists for ${form}`);
}
for (const entry of placed) {
  assert(entry.approach, `${entry.form} at ${entry.npc.x},${entry.npc.z},${entry.npc.level} has a packed-collision route to an operable tile`);
}
const firstByForm = new Map(farmerForms.map(form => [form, placed.find(entry => entry.form === form)]));

function snapshot(p) {
  return Array.from({ length: types.InvType.get(inv).size }, (_, slot) => {
    const item = p.invGetSlot(inv, slot);
    return item ? [item.id, item.count] : null;
  });
}
const registeredNpcNids = new Set();
function showNpc(p, npc) {
  if (!registeredNpcNids.has(npc.nid)) {
    rsbuf.addNpc(npc.nid, npc.type);
    registeredNpcNids.add(npc.nid);
  }
  const playerHitpoint = PlayerStat.HITPOINTS;
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, p.generateAppearance(), p.lastAppearance,
    p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ,
    p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[playerHitpoint], p.baseLevels[playerHitpoint], p.animId, p.animDelay, p.sayMessage,
    p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0,
    p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(npc.x, npc.level, npc.z, npc.nid, npc.type, npc.tele, npc.jump, npc.runDir,
    npc.walkDir, npc.isActive, npc.masks, npc.faceEntity, npc.faceSquareX, npc.faceSquareZ,
    npc.faceAngleX, npc.faceAngleZ, npc.hitmarkDamage, npc.hitmarkType, npc.hitmark2Damage,
    npc.hitmark2Type, npc.levels[NpcStat.HITPOINTS], npc.baseLevels[NpcStat.HITPOINTS],
    npc.animId, npc.animDelay, npc.sayMessage, npc.spotanimId, npc.spotanimHeight, npc.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, npc.nid), `real visibility encoder includes placed ${farmerIds.get(npc.type) ?? types.NpcType.get(npc.type).debugname}`);
}
function clickNpc(p, npc, expectedTrigger) {
  showNpc(p, npc);
  p.originX = p.x;
  p.originZ = p.z;
  assert(OpNpcHandler.handle(new OpNpc(3, npc.nid), p), 'production OPNPC3 packet accepts the visible NPC');
  assert.equal(p.getOpTrigger()?.name, expectedTrigger, 'native dispatch resolves the visible NPC form');
  p.processInteraction();
}
function settle(p, maxTicks = 24) {
  for (let tick = 0; p.activeScript?.execution === State.SUSPENDED && tick < maxTicks; tick++) {
    World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
    World.processPlayers();
  }
}
function prepared(entry, thievingLevel, hitpoints = 20) {
  const p = player();
  p.slot = p.pid;
  World.players[p.slot] = p;
  rsbuf.addPlayer(p.slot);
  p.x = entry.approach.stand.x;
  p.z = entry.approach.stand.z;
  p.level = entry.approach.stand.level;
  p.resetEntity(false);
  p.originX = p.x;
  p.originZ = p.z;
  p.setLevel(PlayerStat.THIEVING, thievingLevel);
  p.setLevel(PlayerStat.HITPOINTS, hitpoints);
  return p;
}
function dispose(p) {
  rsbuf.removePlayer(p.slot);
  p.unlink();
  delete World.players[p.slot];
}
function nativeAttempt(p, npc, formName, seed = null) {
  World.playerLoop.add(BigInt(p.pid), p);
  if (seed !== null) JavaRandom.setSeed(seed);
  clickNpc(p, npc, `[opnpc3,${formName}]`);
  settle(p);
}
function successSeed(rows, total, level, low, high, wantedName) {
  for (let seed = 0; seed < 100_000; seed++) {
    const result = sourceOutcome(seed, rows, total, level, low, high);
    if (result?.name === wantedName) return seed;
  }
  assert.fail(`native JavaRandom witness exists for ${wantedName}`);
}

let cases = 0;
function test(name, action) {
  action();
  cases++;
  console.log(`PASS ${name}`);
}

test('period gate, XP, shared stun fields, and complete independent source table match the compiled row', () => {
  assert.deepEqual(masterFarmerRow.getValue(1, 0), [38]);
  assert.deepEqual(masterFarmerRow.getValue(2, 0), [430]);
  assert.deepEqual(masterFarmerRow.getValue(3, 0), [8]);
  assert.deepEqual(masterFarmerRow.getValue(4, 0), [3]);
  assert.deepEqual(masterFarmerRow.getValue(5, 0), [90, 240]);
  assert.deepEqual(masterFarmerRow.getValue(8, 0), [1_000_241]);
  assert.equal(actualLoot.length, 42);
});

for (const entry of placed) test(`native level gate dispatches placed ${entry.form} at ${entry.npc.x},${entry.npc.z}`, () => {
  const p = prepared(entry, 37);
  const before = snapshot(p);
  const xp = p.stats[PlayerStat.THIEVING];
  const hp = p.levels[PlayerStat.HITPOINTS];
  try {
    nativeAttempt(p, entry.npc, entry.form);
    assert.deepEqual(snapshot(p), before, 'level 37 produces no item');
    assert.equal(p.stats[PlayerStat.THIEVING], xp, 'level 37 awards no Thieving XP');
    assert.equal(p.levels[PlayerStat.HITPOINTS], hp, 'level gate does not stun or damage');
  } finally { dispose(p); }
});

for (let index = 0; index < actualLoot.length; index++) {
  const expected = actualLoot[index];
  const form = farmerForms[index % farmerForms.length];
  const entry = firstByForm.get(form);
  const seed = masterWitnesses.get(expected.name);
  test(`native OPNPC3 JavaRandom reward selects source row ${expected.name}`, () => {
    const p = prepared(entry, 38);
    const beforeXp = p.stats[PlayerStat.THIEVING];
    try {
      nativeAttempt(p, entry.npc, form, seed);
      assert.equal(p.activeScript, null, 'successful native attempt finishes');
      assert.equal(p.stats[PlayerStat.THIEVING] - beforeXp, 430, 'success awards 43 Thieving XP');
      const produced = snapshot(p).filter(Boolean);
      assert.equal(produced.length, 1, 'exclusive table produces exactly one item');
      assert.equal(produced[0][0], id('ObjType', expected.name));
      assert(produced[0][1] >= expected.min && produced[0][1] <= expected.max,
        `${expected.name} quantity ${produced[0][1]} is in source range ${expected.min}-${expected.max}`);
    } finally { dispose(p); }
  });
}

const failSeed = (() => {
  const chance = levelChance(38, 90, 240);
  for (let seed = 0; seed < 100_000; seed++) {
    JavaRandom.setSeed(seed);
    if (Math.floor(JavaRandom.nextDouble() * 256) >= chance) return seed;
  }
  assert.fail('native JavaRandom failure witness exists at Thieving 38');
})();
test('native failure applies three damage and eight ticks, then blocks an immediate retry', () => {
  const entry = firstByForm.get('master_farmer_1');
  const p = prepared(entry, 38, 20);
  const before = snapshot(p);
  const xp = p.stats[PlayerStat.THIEVING];
  const hp = p.levels[PlayerStat.HITPOINTS];
  const stunned = id('VarPlayerType', 'stunned');
  try {
    nativeAttempt(p, entry.npc, entry.form, failSeed);
    assert.equal(p.activeScript, null, 'failed native attempt finishes');
    assert.deepEqual(snapshot(p), before, 'failure produces no loot');
    assert.equal(p.stats[PlayerStat.THIEVING], xp, 'failure awards no XP');
    assert.equal(p.levels[PlayerStat.HITPOINTS], hp - 3, 'failure applies configured three damage');
    assert.equal(p.getVar(stunned), World.currentTick + 8, 'failure sets the configured eight-tick stun');
    const afterFailureHp = p.levels[PlayerStat.HITPOINTS];
    const afterFailureXp = p.stats[PlayerStat.THIEVING];
    World.playerLoop.add(BigInt(p.pid), p);
    clickNpc(p, entry.npc, '[opnpc3,master_farmer_1]');
    settle(p);
    assert.deepEqual(snapshot(p), before, 'stun blocks immediate reward');
    assert.equal(p.stats[PlayerStat.THIEVING], afterFailureXp, 'stun blocks immediate XP');
    assert.equal(p.levels[PlayerStat.HITPOINTS], afterFailureHp, 'stun blocks repeated damage');
  } finally { dispose(p); }
});

const farmerPlacements = [...World.npcs].filter(npc => npc.isActive && [
  id('NpcType', 'farmer1'), id('NpcType', 'farmer2'), id('NpcType', 'farmer3')
].includes(npc.type));
assert(farmerPlacements.length, 'original map placements include an ordinary Farmer');
const farmerEntry = { npc: farmerPlacements[0], form: types.NpcType.get(farmerPlacements[0].type).debugname,
  approach: approachFor(farmerPlacements[0]) };
assert(farmerEntry.approach, 'ordinary Farmer has a packed-collision route to an operable tile');
for (const [wanted, seed] of [
  ['coins', successSeed([
    { name: 'coins', weight: 123, min: 9, max: 9 }, { name: 'potato_seed', weight: 5, min: 1, max: 1 }
  ], 128, 10, 150, 240, 'coins')],
  ['potato_seed', successSeed([
    { name: 'coins', weight: 123, min: 9, max: 9 }, { name: 'potato_seed', weight: 5, min: 1, max: 1 }
  ], 128, 10, 150, 240, 'potato_seed')]
]) test(`ordinary Farmer exclusive native reward is ${wanted}`, () => {
  const p = prepared(farmerEntry, 10);
  try {
    nativeAttempt(p, farmerEntry.npc, farmerEntry.form, seed);
    const produced = snapshot(p).filter(Boolean);
    assert.equal(produced.length, 1, 'exclusive Farmer row returns exactly one reward');
    assert.equal(produced[0][0], id('ObjType', wanted));
    assert.equal(produced[0][1], wanted === 'coins' ? 9 : 1);
  } finally { dispose(p); }
});

const paladins = [...World.npcs].filter(npc => npc.isActive && npc.type === id('NpcType', 'paladin'));
assert(paladins.length, 'original map placements include a Paladin for the legacy multi-reward control');
let paladinEntry = null;
for (const npc of paladins) {
  const approach = approachFor(npc);
  if (!approach) continue;
  paladinEntry = { npc, form: 'paladin', approach };
  break;
}
assert(paladinEntry, 'an original map Paladin has a packed-collision route to an operable tile');
const paladinSuccessSeed = (() => {
  const chance = levelChance(70, 50, 150);
  for (let seed = 0; seed < 100_000; seed++) {
    JavaRandom.setSeed(seed);
    if (Math.floor(JavaRandom.nextDouble() * 256) < chance) return seed;
  }
  assert.fail('native JavaRandom Paladin success witness exists');
})();
test('a zero-total Paladin row retains legacy multi-reward semantics through native OPNPC3', () => {
  const p = prepared(paladinEntry, 70);
  try {
    nativeAttempt(p, paladinEntry.npc, paladinEntry.form, paladinSuccessSeed);
    const produced = snapshot(p).filter(Boolean).sort((left, right) => left[0] - right[0]);
    assert.deepEqual(produced, [
      [id('ObjType', 'coins'), 80], [id('ObjType', 'chaosrune'), 2]
    ].sort((left, right) => left[0] - right[0]));
  } finally { dispose(p); }
});

for (const nid of registeredNpcNids) rsbuf.removeNpc(nid);
const audit = {
  source: {
    page: 'Master Farmer',
    revision: 3490983,
    parentRevision: 3475064,
    timestamp: '2017-02-28T02:18:11Z',
    evidencePath: 'seeds/sources/master-farmer-2017.json',
    authority: 'CANDIDATE: later OSRS revision, not period 377 loot data',
    weightMethod: 'categoryPermille × inner formula permille; exact denominator is the resulting sum',
    totalWeight: sourceTotal
  },
  trigger: 'production OPNPC3 OpNpcHandler on original map NPCs',
  packedPickpocketRows: {
    count: pickpocketRows.length,
    withOneLootTotal: pickpocketRows.filter(row => row.columnValues[8]?.length === 1).length,
    farmerExclusiveWitnesses: ['coins', 'potato_seed'],
    legacyZeroTotalNativeWitness: 'pickpocket_paladin: coins + chaosrune',
    watchmanZeroTotalDataWitness: 'pickpocket_watchman: coins + bread'
  },
  testedRows: sourceLoot.map(row => ({ ...row, test: 'native JavaRandom witness through the player trigger' }))
};
console.log(`MASTER_FARMER_SOURCE_AUDIT ${JSON.stringify(audit)}`);
console.log(`${cases} Master Farmer compiled checks passed`);
process.exit(0);
