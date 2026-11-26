/** Native packed stall checks. Run from the sibling engine with node --random-seed=377 --import tsx. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, Runner, Scripts, State, PlayerStat, JavaRandom, types, id, inv, player, proc, run, count, click, load } from '../farming/runtime.mjs';

const map = await load('engine/GameMap.ts');
const { NpcMode } = await load('engine/entity/NpcMode.ts');
const { PlayerQueueType } = await load('engine/entity/PlayerQueueRequest.ts');
const Trigger = (await load('engine/script/ServerTriggerType.ts')).default;
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Published native outcomes are the compatibility oracle, except the period gem-XP correction.
const published = [
  ['bakery', 'bakers_stall_stealing', 5, 160, 8, [['cake', 13], ['bread', 5], ['chocolate_slice', 2]], 1],
  ['tea', 'tea_stall', 5, 160, 16, [['cup_of_tea', 128]], 2],
  ['silk', 'silk_stall_stealing', 20, 240, 16, [['silk', 128]], 3],
  ['fur', 'fur_stall_stealing', 35, 360, 32, [['grey_wolf_fur', 128]], 4],
  ['silver', 'silver_stall_stealing', 50, 540, 100, [['silver_ore', 128]], 5],
  ['spice', 'spice_stall_stealing', 65, 810, 166, [['spicespot', 128]], 6],
  ['gem', 'gem_stall_stealing', 75, 160, 600, [['uncut_sapphire', 105], ['uncut_emerald', 17], ['uncut_ruby', 5], ['uncut_diamond', 1]], 7]
];
const regional = [
  ['viking_fur', 'viking_fur_market', 35, 360, 32, [['grey_wolf_fur', 128]], 8, 'viking_market'],
  ['dwarf_gem', 'dwarf_market_gems', 75, 160, 600, [['uncut_sapphire', 105], ['uncut_emerald', 17], ['uncut_ruby', 5], ['uncut_diamond', 1]], 0, 'dwarf_market_empty_stall'],
  ['dwarf_silver', 'dwarf_market_silver', 50, 540, 100, [['silver_ore', 128]], 0, 'dwarf_market_empty_stall'],
  ['viking_fish', 'viking_fish_market', 42, 420, 32, [['raw_salmon', 14], ['raw_tuna', 5], ['raw_lobster', 1]], 9, 'viking_market'],
  ['misc_fish', 'misc_fish_market', 42, 420, 32, [['raw_salmon', 14], ['raw_tuna', 5], ['raw_lobster', 1]], 0, 'market'],
  ['etc_fish', 'etc_fish_market', 42, 420, 32, [['raw_salmon', 14], ['raw_tuna', 5], ['raw_lobster', 1]], 0, 'market'],
  ['misc_veg', 'misc_veg_market', 1, 100, 4, [['potato', 3], ['cabbage', 2], ['onion', 2], ['tomato', 2], ['garlic', 1]], 0, 'market'],
  ['etc_veg', 'etc_veg_market', 1, 100, 4, [['potato', 3], ['cabbage', 2], ['onion', 2], ['tomato', 2], ['garlic', 1]], 0, 'market'],
  ['dwarf_bakery', 'dwarf_market_bakery', 5, 160, 32, [['cake', 13], ['bread', 5], ['chocolate_slice', 2]], 0, 'dwarf_market_empty_stall'],
  ['dwarf_crafting', 'dwarf_market_crafting', 5, 160, 34, [['chisel', 1], ['necklace_mould', 1], ['ring_mould', 1]], 0, 'dwarf_market_empty_stall'],
  ['monkey_crafting', 'mm_stall_crafting', 5, 160, 34, [['chisel', 1], ['necklace_mould', 1], ['ring_mould', 1]], 0, 'mm_desk'],
  ['monkey_food', 'mm_stall_food', 5, 160, 34, [['banana', 1]], 0, 'mm_desk'],
  ['monkey_general', 'mm_stall_general', 5, 160, 34, [['hammer', 1], ['pot_empty', 1], ['tinderbox', 1]], 0, 'mm_desk'],
  ['monkey_magic', 'mm_stall_magic', 65, 1000, 200, [['earthrune', 1], ['firerune', 1], ['waterrune', 1], ['lawrune', 1]], 0, 'mm_desk'],
  ['monkey_scimitar', 'mm_stall_scimitar', 65, 1600, 200, [['iron_scimitar', 1]], 0, 'mm_desk'],
  ['wine', 'rag_market_stall', 22, 270, 34, [['rag_bottle_wine', 11], ['grapes', 17], ['jug_empty', 39], ['jug_water', 20], ['jug_wine', 13]], 0, 'rag_market_stall_empty']
];
const profiles = [...published, ...regional];
const selectedIds = new Set([...profiles.map(([, key]) => key), 'dwarf_market_clothes', 'seed_stall'].map(key => id('LocType', key)));
const approvalBit = id('VarBitType', 'misc_approval');
const miscApprovalLossStalls = new Set(['misc_fish_market', 'misc_veg_market']);
const vegetableRewardMessages = {
  potato: 'You steal a potato.',
  cabbage: 'You steal a cabbage.',
  onion: 'You steal an onion.',
  tomato: 'You steal a tomato.',
  garlic: 'You steal some garlic.'
};
const placements = [];
for (const filename of fs.readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name))) {
  const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(filename).map(Number);
  let section;
  for (const line of fs.readFileSync(path.join(content, 'maps', filename), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    if (section !== 'LOC') continue;
    const match = /^([0-3]) (\d+) (\d+): (\d+)(?: (\d+))?(?: (\d+))?$/.exec(line);
    if (!match || !selectedIds.has(Number(match[4]))) continue;
    const [level, x, z, type] = match.slice(1, 5).map(Number);
    const loc = World.getLoc(mx * 64 + x, mz * 64 + z, level, type);
    assert(loc, `original ${filename}:${line} is packed`);
    placements.push(loc);
  }
}
const snapshot = p => Array.from({ length: types.InvType.get(inv).size }, (_, slot) => {
  const obj = p.invGetSlot(inv, slot);
  return obj ? [obj.id, obj.count] : null;
});
function approaches(loc) {
  const config = types.LocType.get(loc.type), points = [];
  for (let x = loc.x - 1; x <= loc.x + Math.max(config.width, config.length); x++) {
    for (let z = loc.z - 1; z <= loc.z + Math.max(config.width, config.length); z++) {
      if (!map.isMapBlocked(x, z, loc.level) && map.reachedLoc(loc.level, x, z,
        loc.x, loc.z, config.width, config.length, 1, loc.angle, loc.shape, config.forceapproach)) points.push({ x, z });
    }
  }
  return points;
}
function catchers(row, point, level) {
  const owner = row.columnValues[1]?.length ? row.getValue(1, 0)[0] : -1;
  const guards = new Set(Array.from({ length: row.columnValues[2]?.length ?? 0 }, (_, index) => row.getValue(2, index)[0]));
  return [...World.npcs].filter(npc => npc.isActive && npc.level === level &&
    (npc.type === owner || (guards.has(npc.type) && npc.targetOp !== NpcMode.OPPLAYER2)) &&
    Math.max(Math.abs(npc.x - point.x), Math.abs(npc.z - point.z)) <= 5 &&
    map.isLineOfSight(level, npc.x, npc.z, point.x, point.z));
}
function reachable(loc, point) {
  const config = types.LocType.get(loc.type);
  return [[-8, 0], [8, 0], [0, -8], [0, 8]].some(([dx, dz]) => {
    const start = { x: point.x + dx, z: point.z + dz };
    if (map.isMapBlocked(start.x, start.z, loc.level)) return false;
    const route = map.findPathToLoc(loc.level, start.x, start.z, loc.x, loc.z,
      1, config.width, config.length, loc.angle, loc.shape, config.forceapproach);
    if (!route.length) return false;
    const end = route[route.length - 1];
    return map.reachedLoc(loc.level, (end >>> 14) & 0x3fff, end & 0x3fff,
      loc.x, loc.z, config.width, config.length, 1, loc.angle, loc.shape, config.forceapproach) &&
      map.findPath(loc.level, start.x, start.z, point.x, point.z).length > 0;
  });
}
function fixture(row, locs, level, caught = false, observer = () => true) {
  if (!caught && ['stealing_monkey_general_stall', 'stealing_monkey_scimitar_stall'].includes(row.debugname)) {
    distractPostedArchers(row, locs);
  }
  // Guards genuinely wander. Advance native NPC turns rather than removing or moving a catcher.
  for (let turn = 0; turn <= 100; turn++) {
    for (const loc of locs) {
      const point = approaches(loc).find(point => {
        const watching = catchers(row, point, loc.level);
        return Boolean(watching.length) === caught && observer(watching) && reachable(loc, point);
      });
      if (!point) continue;
      const p = player();
      p.x = point.x; p.z = point.z; p.level = loc.level;
      p.setLevel(PlayerStat.THIEVING, level);
      p.setVar(id('VarPlayerType', 'viking'), 10); // Seed: prerequisite quest, not written by theft.
      p.setVar(id('VarPlayerType', 'mm_main'), 9); // Seed: the quest registry's completion stage.
      if (row.debugname === 'stealing_misc_fish_stall' || row.debugname === 'stealing_misc_veg_stall') {
        p.setVar(id('VarPlayerType', 'misc_quest'), 100); // Seed: the Miscellania stall prerequisite.
      }
      return { p, loc, xp: p.stats[PlayerStat.THIEVING] };
    }
    World.currentTick++;
    World.processNpcs();
    World.processZones();
    World.processCleanup();
  }
  assert.fail(`${row.debugname} has an original reachable ${caught ? 'observed' : 'unobserved'} interaction side`);
}
function execute(p, loc) {
  World.playerLoop.add(BigInt(p.pid), p);
  try {
    assert(click(p, loc, 2), 'native OpLoc2 accepts the original stall');
    for (let tick = 0; p.activeScript?.execution === State.SUSPENDED && tick < 4; tick++) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      World.processPlayers();
    }
    assert.notEqual(p.activeScript?.execution, State.SUSPENDED, 'bounded native scheduler finishes the attempt');
  } finally { p.unlink(); }
}
const baitPlayers = [];
function nativeNpcTurn() {
  World.currentTick++;
  World.processNpcs();
  World.processZones();
  World.processCleanup();
}
function distractPostedArchers(row, locs) {
  // These original fixed archers see every legal side. Other player accounts
  // distract them by real failed thefts; no NPC state or product var is seeded.
  assert(!row.columnValues[1]?.length);
  for (let attempt = 0; attempt < 5; attempt++) {
    const loc = locs[0];
    const point = approaches(loc).find(point => catchers(row, point, loc.level).length && reachable(loc, point));
    if (!point) return;
    const bait = player();
    bait.x = point.x; bait.z = point.z; bait.level = loc.level;
    bait.setLevel(PlayerStat.THIEVING, 99);
    bait.setLevel(PlayerStat.HITPOINTS, 99);
    bait.setVar(id('VarPlayerType', 'mm_main'), 9);
    baitPlayers.push(bait);
    const before = bait.stats[PlayerStat.THIEVING];
    const watching = catchers(row, bait, bait.level);
    execute(bait, loc);
    assert.equal(bait.stats[PlayerStat.THIEVING], before);
    assert.equal(snapshot(bait).filter(Boolean).length, 0);
    const guard = watching.find(npc => npc.getVar(id('VarNpcType', 'npc_aggressive_player')) === bait.uid);
    assert(guard, 'an original archer notices the bait account theft');
    for (let turn = 0; guard.targetOp !== NpcMode.OPPLAYER2 && turn < 4; turn++) nativeNpcTurn();
    assert.equal(guard.targetOp, NpcMode.OPPLAYER2, 'native retaliation occupies the archer');
  }
  assert.fail('bounded real theft distractions occupy the posted archers');
}
function restore(loc, empty, original) {
  assert.equal(loc.type, id('LocType', empty));
  const duration = loc.lifecycleTick;
  assert(duration > 0);
  for (let tick = 1; tick <= duration; tick++) {
    World.currentTick++;
    World.processZones();
    assert.equal(loc.type, tick < duration ? id('LocType', empty) : original, 'only the empty/original lifecycle is visible');
  }
  assert.equal(World.getLoc(loc.x, loc.z, loc.level, original), loc);
}
function expectedReward(seed, loot) {
  JavaRandom.setSeed(seed);
  let remaining = loot.reduce((sum, [, weight]) => sum + weight, 0);
  for (let index = loot.length - 1; index >= 0; index--) {
    JavaRandom.nextDouble(); // The published selector first draws the fixed quantity.
    const roll = Math.floor(JavaRandom.nextDouble() * remaining);
    remaining -= loot[index][1];
    if (roll >= remaining) return index;
  }
  assert.fail('complete loot table has no empty outcome');
}
let cases = 0;
function test(name, action) {
  try { action(); cases++; console.log(`PASS ${name}`); }
  finally {
    if (baitPlayers.length) {
      for (const bait of baitPlayers.splice(0)) {
        bait.isActive = false;
        bait.unlink();
        World.players[bait.pid] = null;
      }
      nativeNpcTurn();
    }
  }
}
function dispatchMarketOption(p, npc, slot) {
  p.target = npc; p.targetOp = Trigger[`OPNPC${slot}`] - 7;
  const script = p.getOpTrigger();
  assert(script, `native NPC dispatch resolves opnpc${slot}`);
  assert.equal(script.name, `[opnpc${slot},${types.NpcType.get(npc.type).debugname}]`);
  const state = Runner.init(script, p, npc);
  p.executeScript(state, true);
  return state;
}
function finishMarketOption(p, state) {
  for (let step = 0; state.execution === State.SUSPENDED && step < 4; step++) {
    World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
    p.delayed = false;
    p.executeScript(state, true, true);
  }
  assert.equal(state.execution, State.FINISHED, 'native NPC option completes through its bounded delay');
}
function marketApproach(p, owner, guards) {
  const size = Math.max(1, types.NpcType.get(owner.type).size ?? 1);
  for (let x = owner.x - 1; x <= owner.x + size; x++) {
    for (let z = owner.z - 1; z <= owner.z + size; z++) {
      if (x >= owner.x && x < owner.x + size && z >= owner.z && z < owner.z + size) continue;
      if (map.isMapBlocked(x, z, owner.level) || !map.findPath(owner.level, p.x, p.z, x, z).length) continue;
      const visible = guards.find(npc => map.isLineOfSight(owner.level, npc.x, npc.z, x, z));
      if (visible) return { x, z, guard: visible };
    }
  }
  assert.fail('an original reachable merchant approach is visible to a free local viking_guard');
}
for (const spec of [
  {
    key: 'viking_fish_market', owner: 'viking_fish_monger', queue: 'stolen_from_stall_vikingfish',
    first: [1, /^It is .+ the thief!$/, 'Guards! Guards!'],
    second: [3, "You're the one who stole something from me!", 'Guards guards!']
  },
  {
    key: 'viking_fur_market', owner: 'viking_fur_monger', queue: 'stolen_from_stall_vikingfur',
    first: [3, "You're the one who stole something from me!", 'Guards guards!'],
    second: [1, /^You think me stupid .+\?$/, 'Guards! Guards!']
  }
]) {
  test(`${spec.key}: actual theft locks both owner options to local guards until expiry`, () => {
    const profile = profiles.find(([, key]) => key === spec.key);
    assert(profile, `published native profile ${spec.key} exists`);
    const [kind, key, level, xp, , , , emptyName] = profile;
    const row = types.DbRowType.getByName(`stealing_${kind}_stall`);
    const original = id('LocType', key), empty = id('LocType', emptyName);
    const { p, loc, xp: before } = fixture(row, placements.filter(loc => loc.type === original), level);
    p.setLevel(PlayerStat.HITPOINTS, 99); // Seed: enough health to observe the local alert, not written by theft.
    const ownerType = id('NpcType', spec.owner);
    const owner = [...World.npcs].filter(npc => npc.isActive && npc.type === ownerType && npc.level === loc.level)
      .sort((a, b) => Math.max(Math.abs(a.x - loc.x), Math.abs(a.z - loc.z)) -
        Math.max(Math.abs(b.x - loc.x), Math.abs(b.z - loc.z)))[0];
    assert(owner, 'the original market owner is present');
    const guardType = id('NpcType', 'viking_guard');
    const alertVar = id('VarNpcType', 'npc_aggressive_player');
    const guards = [...World.npcs].filter(npc => npc.isActive && npc.type === guardType && npc.level === owner.level &&
      Math.max(Math.abs(npc.x - owner.x), Math.abs(npc.z - owner.z)) <= 5 &&
      npc.targetOp !== NpcMode.OPPLAYER2);
    const shopMain = id('Component', 'shop_template'), shopSide = id('Component', 'shop_template_side');
    const shopVar = id('VarPlayerType', 'shop'), shopBefore = p.getVar(shopVar);
    try {
      execute(p, loc);
      assert.equal(p.stats[PlayerStat.THIEVING] - before, xp, 'the real original stall click succeeds');
      assert.equal(loc.type, empty, 'the successful click empties the original stall');
      const queueName = `[queue,${spec.queue}]`;
      const queue = () => [...p.queue.all()].find(entry => entry.script.name === queueName);
      assert(queue()?.delay > 0, 'the theft writes its existing native owner lockout');
      restore(loc, emptyName, original);
      World.playerLoop.add(BigInt(p.pid), p);
      const point = marketApproach(p, owner, guards);
      p.x = point.x; p.z = point.z; p.level = owner.level;
      assert(guards.some(npc => map.isLineOfSight(owner.level, npc.x, npc.z, point.x, point.z)),
        'the walked-to merchant approach has local guard line of sight');
      const assertClosed = () => {
        assert.notEqual(p.modalMain, shopMain, 'an active lockout never opens the shop');
        assert.notEqual(p.modalSide, shopSide, 'an active lockout never opens the shop side panel');
        assert.equal(p.getVar(shopVar), shopBefore, 'an active lockout preserves the closed-shop state');
      };
      const runLockedOption = (slot, opening, response) => {
        const state = dispatchMarketOption(p, owner, slot);
        if (opening instanceof RegExp) assert.match(owner.sayMessage, opening);
        else assert.equal(owner.sayMessage, opening);
        assert.equal(state.execution, State.SUSPENDED, 'the refusal retains its existing one-tick pause');
        finishMarketOption(p, state);
        assert.equal(owner.sayMessage, response);
        assertClosed();
      };
      runLockedOption(...spec.first);
      const alerted = guards.filter(npc => npc.getVar(alertVar) === p.uid);
      assert(alerted.length, 'the locked native option alerts an original local viking_guard');
      for (let turn = 0; alerted.every(npc => npc.targetOp !== NpcMode.OPPLAYER2) && turn < 4; turn++) nativeNpcTurn();
      assert(alerted.some(npc => npc.targetOp === NpcMode.OPPLAYER2),
        'a local viking_guard takes the native retaliation path');
      runLockedOption(...spec.second);
      const alertedBeforeExpiry = guards.filter(npc => npc.getVar(alertVar) === p.uid);
      const ownerOverheadBeforeExpiry = owner.sayMessage;
      const remaining = queue()?.delay;
      assert(remaining > 0, 'both owner options leave the same theft lockout active');
      for (let turn = 0; turn <= remaining + 1 && queue(); turn++) {
        World.currentTick++;
        p.processQueues();
      }
      assert.equal(queue(), undefined, 'the existing queue expires through native player queue processing');
      const state = dispatchMarketOption(p, owner, 3);
      assert.equal(state.execution, State.FINISHED);
      assert.equal(p.modalMain, shopMain, 'the original shop opens when the lockout has expired');
      assert.equal(p.modalSide, shopSide);
      assert.equal(owner.sayMessage, ownerOverheadBeforeExpiry, 'expired Trade adds no refusal or guard-alert line');
      assert.deepEqual(guards.filter(npc => npc.getVar(alertVar) === p.uid), alertedBeforeExpiry,
        'expired Trade does not alert another local guard');
    } finally {
      if (loc.type === empty) restore(loc, emptyName, original);
      p.isActive = false;
      p.unlink();
      World.players[p.pid] = null;
    }
  });
}
for (const [kind, key, ownerName] of [
  ['viking_fur', 'viking_fur_market', 'viking_fur_monger'],
  ['viking_fish', 'viking_fish_market', 'viking_fish_monger'],
  ['dwarf_gem', 'dwarf_market_gems', 'dwarf_city_shop_gems'],
  ['dwarf_silver', 'dwarf_market_silver', 'dwarf_city_shop_silver'],
  ['dwarf_bakery', 'dwarf_market_bakery', 'dwarf_city_shop_bakery'],
  ['wine', 'rag_market_stall', 'rag_wine_merchant'],
  ['dwarf_crafting', 'dwarf_market_crafting', 'dwarf_city_shop_craft']
]) {
  test(`${key}: the original local owner remains a catcher outside Ape Atoll`, () => {
    const row = types.DbRowType.getByName(`stealing_${kind}_stall`);
    const owner = id('NpcType', ownerName), locs = placements.filter(loc => loc.type === id('LocType', key));
    assert.deepEqual(row.getValue(1, 0), [owner]);
    assert([...World.npcs].some(npc => npc.type === owner && locs.some(loc => npc.startLevel === loc.level &&
      approaches(loc).some(point => Math.max(Math.abs(npc.startX - point.x), Math.abs(npc.startZ - point.z)) <= 5 &&
        map.isLineOfSight(loc.level, npc.startX, npc.startZ, point.x, point.z)))),
    'the unchanged original owner placement can see an original legal interaction side');
  });
}
test('dwarf_market_crafting: Nolar alone notices theft without a guard attack', () => {
  const row = types.DbRowType.getByName('stealing_dwarf_crafting_stall');
  const original = id('LocType', 'dwarf_market_crafting'), owner = id('NpcType', 'dwarf_city_shop_craft');
  assert.deepEqual(Array.from({ length: row.columnValues[2].length }, (_, index) => row.getValue(2, index)[0]),
    [1, 2, 3, 4].map(index => id('NpcType', `dwarf_city_black_guard${index}`)));
  const { p, loc, xp: before } = fixture(row, placements.filter(loc => loc.type === original), 5, true,
    watching => watching.every(npc => npc.type === owner));
  const watching = catchers(row, p, p.level);
  assert(watching.length && watching.every(npc => npc.type === owner));
  execute(p, loc);
  assert.equal(p.stats[PlayerStat.THIEVING], before);
  assert.equal(snapshot(p).filter(Boolean).length, 0);
  assert.equal(loc.type, original);
  assert.equal(p.getVar(id('VarPlayerType', 'thieving_stall_timer')), 0);
  assert(watching.every(npc => npc.getVar(id('VarNpcType', 'npc_aggressive_player')) !== p.uid),
    'the non-combat owner path does not make Nolar retaliate');
});
for (const [kind, key, level, xp, ticks, loot, bit, empty = 'market'] of profiles) {
  const row = types.DbRowType.getByName(`stealing_${kind}_stall`);
  assert(row, `missing compiled ${kind} row`);
  const original = id('LocType', key), locs = placements.filter(loc => loc.type === original);
  assert(locs.length, `${key} has original packed map placements`);
  test(`${key}: source/published table, XP, timer and complete loot`, () => {
    assert.deepEqual(row.getValue(0, 0), [original]);
    assert.deepEqual(row.getValue(3, 0), [level]);
    assert.deepEqual(row.getValue(4, 0), [xp]);
    assert.deepEqual(row.getValue(5, 0), [ticks]);
    assert.deepEqual(row.getValue(7, 0), [loot.reduce((sum, [, weight]) => sum + weight, 0)]);
    assert.equal(row.columnValues[6].length, loot.length * 5);
    for (const [index, [name, weight]] of loot.entries()) {
      assert.deepEqual(row.getValue(6, index).slice(0, 4), [id('ObjType', name), 1, 1, weight]);
    }
  });
  const witnesses = new Map();
  for (let seed = 0; seed < 100000 && witnesses.size < loot.length; seed++) {
    const index = expectedReward(seed, loot);
    if (!witnesses.has(index)) witnesses.set(index, seed);
  }
  assert.equal(witnesses.size, loot.length);
  for (const [index, seed] of witnesses) test(`${key}: native reward ${loot[index][0]} only`, () => {
    const p = player();
    JavaRandom.setSeed(seed);
    proc(p, 'stealing_check_for_reward', row.id);
    assert.equal(count(p, loot[index][0]), 1);
    assert.equal(snapshot(p).filter(Boolean).length, 1);
    if (key === 'misc_veg_market' || key === 'etc_veg_market') {
      assert.deepEqual(p.messages, [vegetableRewardMessages[loot[index][0]]]);
    }
  });
  test(`${key}: native steal, lockout bit, empty form, timer and approval`, () => {
    const { p, loc, xp: before } = fixture(row, locs, level);
    p.setVarBit(approvalBit, 2); // Seed: raw kingdom approval before the successful theft.
    // player() already registers the fixture player in World.players.
    const duration = Math.trunc(ticks * (4000 - Math.min(World.getTotalPlayers(), 2000)) / 4000);
    execute(p, loc);
    assert.equal(p.stats[PlayerStat.THIEVING] - before, xp);
    const produced = snapshot(p).filter(Boolean);
    assert.equal(produced.length, 1);
    assert.equal(produced[0][1], 1);
    assert(loot.some(([name]) => id('ObjType', name) === produced[0][0]));
    assert.equal(p.getVar(id('VarPlayerType', 'thieving_stall_timer')), bit ? 1 << bit : 0);
    assert.equal(p.getVarBit(approvalBit), miscApprovalLossStalls.has(key) ? 1 : 2);
    assert.equal(loc.lifecycleTick, duration);
    restore(loc, empty, original);
  });
  if (miscApprovalLossStalls.has(key)) {
    test(`${key}: approval loss clamps at zero`, () => {
      const { p, loc } = fixture(row, locs, level);
      p.setVarBit(approvalBit, 0);
      execute(p, loc);
      assert.equal(p.getVarBit(approvalBit), 0);
      restore(loc, empty, original);
    });
  }
  // Native players cannot have a skill level below one; the level-one success case covers that minimum.
  if (level > 1) test(`${key}: below-level native attempt has no reward, XP or depletion`, () => {
    const { p, loc, xp: before } = fixture(row, locs, level - 1);
    p.setVarBit(approvalBit, 2);
    execute(p, loc);
    assert.equal(p.stats[PlayerStat.THIEVING], before);
    assert.equal(snapshot(p).filter(Boolean).length, 0);
    assert.equal(loc.type, original);
    assert.equal(p.getVarBit(approvalBit), 2);
  });
  test(`${key}: full inventory native attempt has no reward, XP or depletion`, () => {
    const { p, loc, xp: before } = fixture(row, locs, level);
    p.invAdd(inv, id('ObjType', 'logs'), 28);
    const beforeInv = snapshot(p);
    p.setVarBit(approvalBit, 2);
    execute(p, loc);
    assert.deepEqual(snapshot(p), beforeInv);
    assert.equal(p.stats[PlayerStat.THIEVING], before);
    assert.equal(p.getVarBit(approvalBit), 2);
    assert.equal(loc.type, original);
  });
  if (key === 'mm_stall_crafting' || key === 'mm_stall_magic') {
    test(`${key}: theft from every legal side is not observed by the original posted archer`, () => {
      assert(!row.columnValues[1]?.length, 'period table names only Monkey Archers for this Ape stall');
      const loc = locs[0], points = approaches(loc);
      assert.equal(points.length, key === 'mm_stall_crafting' ? 4 : 3);
      for (const point of points) {
        assert(reachable(loc, point));
        assert.equal(catchers(row, point, loc.level).length, 0);
        const p = player();
        p.x = point.x; p.z = point.z; p.level = loc.level;
        p.setLevel(PlayerStat.THIEVING, level);
        p.setVar(id('VarPlayerType', 'mm_main'), 9); // Seed: period quest prerequisite for Magic.
        const before = p.stats[PlayerStat.THIEVING];
        execute(p, loc);
        assert.equal(p.stats[PlayerStat.THIEVING] - before, xp);
        assert.equal(snapshot(p).filter(Boolean).length, 1);
        restore(loc, empty, original);
      }
    });
    test(`${key}: guard path with an ownerless row; position not a legal interaction side of this stall`, () => {
      const loc = locs[0];
      const guards = new Set(Array.from({ length: row.columnValues[2].length }, (_, index) => row.getValue(2, index)[0]));
      const guard = [...World.npcs].filter(npc => npc.isActive && npc.level === loc.level && guards.has(npc.type) &&
        npc.targetOp !== NpcMode.OPPLAYER2 && !map.isMapBlocked(npc.x, npc.z, npc.level))
        .sort((a, b) => Math.max(Math.abs(a.x - loc.x), Math.abs(a.z - loc.z)) - Math.max(Math.abs(b.x - loc.x), Math.abs(b.z - loc.z)))[0];
      assert(guard);
      assert(!approaches(loc).some(point => point.x === guard.x && point.z === guard.z));
      assert(map.isLineOfSight(loc.level, guard.x, guard.z, guard.x, guard.z));
      const p = player();
      p.x = guard.x; p.z = guard.z; p.level = guard.level;
      p.setLevel(PlayerStat.THIEVING, level);
      const visibleGuards = catchers(row, p, p.level);
      assert(visibleGuards.includes(guard));
      const before = p.stats[PlayerStat.THIEVING];
      const script = Scripts.getByName('[proc,steal_from_stall]');
      assert(script);
      const state = Runner.init(script, p, loc, [row.id, (loc.level << 28) | (loc.x << 14) | loc.z, loc.angle, loc.shape]);
      assert.equal(p.runScript(state, true, true), State.FINISHED);
      const retaliating = visibleGuards.filter(npc => npc.getVar(id('VarNpcType', 'npc_aggressive_player')) === p.uid);
      assert.equal(retaliating.length, 1, 'one original guard takes the published retaliation path');
      assert.equal(retaliating[0].getVar(id('VarNpcType', 'npc_lastcombat')), World.currentTick);
      assert.equal(p.stats[PlayerStat.THIEVING], before);
      assert.equal(snapshot(p).filter(Boolean).length, 0);
      assert.equal(loc.type, original);
    });
  } else if (row.columnValues[1]?.length || row.columnValues[2]?.length) {
    test(`${key}: original owner/guard seeing theft prevents reward and depletion`, () => {
      const { p, loc, xp: before } = fixture(row, locs, level, true);
      p.setVarBit(approvalBit, 2);
      execute(p, loc);
      assert.equal(p.stats[PlayerStat.THIEVING], before);
      assert.equal(snapshot(p).filter(Boolean).length, 0);
      assert.equal(loc.type, original);
      assert.equal(p.getVarBit(approvalBit), 2);
    });
  } else {
    test(`${key}: period None-to-elude row has no owner or guard`, () => {
      assert(!row.columnValues[1]?.length);
      assert(!row.columnValues[2]?.length);
    });
  }
}
for (const ownerOnly of [true, false]) {
  test(`seed_stall: ${ownerOnly ? 'Olivia alone notices' : 'the original market guard retaliates against'} the theft`, () => {
    const row = types.DbRowType.getByName('stealing_seed_stall');
    const original = id('LocType', 'seed_stall');
    const owner = id('NpcType', 'seed_merchant'), guard = id('NpcType', 'farming_market_guard');
    assert.deepEqual(row.getValue(1, 0), [owner]);
    assert.deepEqual(row.getValue(2, 0), [guard]);
    const { p, loc, xp: before } = fixture(row, placements.filter(loc => loc.type === original), 27, true,
      watching => ownerOnly ? watching.every(npc => npc.type === owner) : watching.some(npc => npc.type === guard));
    const watching = catchers(row, p, p.level);
    execute(p, loc);
    assert.equal(p.stats[PlayerStat.THIEVING], before);
    assert.equal(snapshot(p).filter(Boolean).length, 0);
    assert.equal(loc.type, original);
    assert.equal(p.getVar(id('VarPlayerType', 'thieving_stall_timer')), 0);
    if (!ownerOnly) {
      assert(watching.some(npc => npc.type === guard && npc.getVar(id('VarNpcType', 'npc_aggressive_player')) === p.uid));
    }
  });
}
for (const key of ['mm_stall_food', 'mm_stall_magic', 'mm_stall_scimitar', 'viking_fish_market', 'viking_fur_market']) {
  test(`${key}: uncompleted period quest blocks theft`, () => {
    const [kind, , level] = profiles.find(([, name]) => name === key);
    const row = types.DbRowType.getByName(`stealing_${kind}_stall`);
    const original = id('LocType', key);
    const { p, loc, xp: before } = fixture(row, placements.filter(loc => loc.type === original), level);
    const ape = key.startsWith('mm_');
    p.setVar(id('VarPlayerType', ape ? 'mm_main' : 'viking'), ape ? 8 : 9);
    execute(p, loc);
    assert.equal(p.stats[PlayerStat.THIEVING], before);
    assert.equal(snapshot(p).filter(Boolean).length, 0);
    assert.equal(p.getVar(id('VarPlayerType', 'thieving_stall_timer')), 0);
    assert.equal(loc.type, original);
  });
}
for (const [key, questVar, incomplete, complete, unrelatedQuest] of [
  ['misc_fish_market', 'misc_quest', 90, 100, 'viking'],
  ['misc_veg_market', 'misc_quest', 90, 100, 'viking'],
  ['etc_fish_market', 'viking', 9, 10, 'misc_quest'],
  ['etc_veg_market', 'viking', 9, 10, 'misc_quest']
]) {
  const [kind, , level, xp] = profiles.find(([, name]) => name === key);
  const row = types.DbRowType.getByName(`stealing_${kind}_stall`);
  const original = id('LocType', key), locs = placements.filter(loc => loc.type === original);
  test(`${key}: incomplete island quest blocks theft and approval loss`, () => {
    const { p, loc, xp: before } = fixture(row, locs, level);
    p.setVar(id('VarPlayerType', questVar), incomplete);
    p.setVar(id('VarPlayerType', unrelatedQuest), 0);
    p.setVarBit(approvalBit, 2);
    execute(p, loc);
    assert.equal(p.stats[PlayerStat.THIEVING], before);
    assert.equal(snapshot(p).filter(Boolean).length, 0);
    assert.equal(p.getVarBit(approvalBit), 2);
    assert.equal(loc.type, original);
  });
  test(`${key}: the completed island quest is sufficient`, () => {
    const { p, loc, xp: before } = fixture(row, locs, level);
    p.setVar(id('VarPlayerType', questVar), complete);
    p.setVar(id('VarPlayerType', unrelatedQuest), 0);
    p.setVarBit(approvalBit, 2);
    execute(p, loc);
    assert.equal(p.stats[PlayerStat.THIEVING] - before, xp);
    assert.equal(snapshot(p).filter(Boolean).length, 1);
    assert.equal(p.getVarBit(approvalBit), miscApprovalLossStalls.has(key) ? 1 : 2);
    restore(loc, 'market', original);
  });
}
for (const key of ['mm_stall_general', 'mm_stall_crafting']) {
  test(`${key}: no invented quest-completion gate`, () => {
    const [kind, , level, xp, , , , empty] = profiles.find(([, name]) => name === key);
    const row = types.DbRowType.getByName(`stealing_${kind}_stall`);
    const original = id('LocType', key);
    const { p, loc, xp: before } = fixture(row, placements.filter(loc => loc.type === original), level);
    p.setVar(id('VarPlayerType', 'mm_main'), 0);
    execute(p, loc);
    assert.equal(p.stats[PlayerStat.THIEVING] - before, xp);
    assert.equal(snapshot(p).filter(Boolean).length, 1);
    restore(loc, empty, original);
  });
}
for (const key of ['dwarf_market_clothes']) {
  test(`${key}: no theft, XP, depletion or kingdom-state invention`, () => {
    const original = id('LocType', key);
    const locs = placements.filter(loc => loc.type === original);
    assert(locs.length);
    assert(!types.DbRowType.getInTable(id('DbTableType', 'stealing')).some(row => row.getValue(0, 0)[0] === original));
    for (const loc of locs) {
      const point = approaches(loc).find(point => reachable(loc, point));
      assert(point, `${key} has an original reachable interaction side`);
      const p = player();
      p.x = point.x; p.z = point.z; p.level = loc.level;
      p.setLevel(PlayerStat.THIEVING, 99);
      const before = p.stats[PlayerStat.THIEVING];
      const beforeVars = Array.from(p.vars);
      execute(p, loc);
      assert.equal(p.stats[PlayerStat.THIEVING], before);
      assert.equal(snapshot(p).filter(Boolean).length, 0);
      assert.deepEqual(Array.from(p.vars), beforeVars);
      assert.equal(loc.type, original);
      assert(p.messages.includes("You don't really see anything you'd want to steal from this stall."));
    }
  });
}
const lockouts = [
  ['bakery', 'baker', 1, 1500], ['tea', 'tea', 2, 1000], ['silk', 'silk', 3, 1000],
  ['fur', 'fur', 4, 1000], ['silver', 'silver', 5, 1000], ['spice', 'spice', 6, 600],
  ['gem', 'gem', 7, 1000], ['viking_fur', 'vikingfur', 8, 1000], ['viking_fish', 'vikingfish', 9, 1500]
];
const stallQueues = p => [...p.queue.all()].filter(entry => entry.script.name.startsWith('[queue,stolen_from_stall_'));
for (const [kind, queueName, bit, timer] of lockouts) {
  test(`${kind}: an online autosave reloads through full login and native expiry clears the restored lockout`, () => {
    const [, key, level, , , , , empty = 'market'] = profiles.find(([name]) => name === kind);
    const row = types.DbRowType.getByName(`stealing_${kind}_stall`);
    const original = id('LocType', key);
    const { p, loc } = fixture(row, placements.filter(loc => loc.type === original), level);
    execute(p, loc);
    assert.equal(p.getVar(id('VarPlayerType', 'thieving_stall_timer')), 1 << bit);
    const initial = [...p.queue.all()];
    assert.equal(initial.length, 1);
    assert.equal(initial[0].script.name, `[queue,stolen_from_stall_${queueName}]`);
    assert.equal(initial[0].type, PlayerQueueType.LONG);
    assert.deepEqual(initial[0].args, [0, 1]); // Native argument order, shared by the published queues.
    assert.equal(initial[0].delay, timer - 1); // The click's native player turn already counts down once.
    restore(loc, empty, original);
    for (let turn = 0; turn < 23; turn++) {
      World.currentTick++;
      p.processQueues();
    }
    assert.equal(initial[0].delay, timer - 24);
    const saved = p.save();
    const joined = player(saved);
    assert.equal(joined.getVar(id('VarPlayerType', 'thieving_stall_timer')), 1 << bit);
    assert.deepEqual(snapshot(joined), snapshot(p));
    assert.equal([...joined.queue.all()].length, 0, 'the save contains permanent state, not an old live queue');
    run(joined, '[login,_]');
    const restored = stallQueues(joined);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].script.name, initial[0].script.name);
    assert.equal(restored[0].type, PlayerQueueType.LONG);
    assert.deepEqual(restored[0].args, initial[0].args);
    assert.equal(restored[0].delay, timer, 'login follows the published full-timer restart rule');
    for (let turn = 0; turn < timer; turn++) {
      World.currentTick++;
      joined.processQueues();
      assert.equal(joined.getVar(id('VarPlayerType', 'thieving_stall_timer')), 1 << bit);
    }
    World.currentTick++;
    joined.processQueues();
    assert.equal(joined.getVar(id('VarPlayerType', 'thieving_stall_timer')), 0);
    assert.equal(stallQueues(joined).length, 0);
  });
}
test('an online autosave with both regional bits restarts both timers through full login and expires them independently', () => {
  let p;
  for (const kind of ['viking_fur', 'viking_fish']) {
    const [, key, level, , , , , empty] = profiles.find(([name]) => name === kind);
    const row = types.DbRowType.getByName(`stealing_${kind}_stall`);
    const original = id('LocType', key);
    const next = fixture(row, placements.filter(loc => loc.type === original), level);
    if (!p) p = next.p;
    else { p.x = next.p.x; p.z = next.p.z; p.level = next.p.level; }
    p.setLevel(PlayerStat.THIEVING, 99);
    World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
    execute(p, next.loc);
    restore(next.loc, empty, original);
  }
  const mask = id('VarPlayerType', 'thieving_stall_timer');
  assert.equal(p.getVar(mask), (1 << 8) | (1 << 9), 'both bits come from actual native thefts, not a seed');
  const joined = player(p.save());
  assert.equal(joined.getVar(mask), (1 << 8) | (1 << 9));
  assert.equal([...joined.queue.all()].length, 0);
  run(joined, '[login,_]');
  assert.deepEqual(stallQueues(joined).map(entry => [entry.script.name, entry.delay]), [
    ['[queue,stolen_from_stall_vikingfur]', 1000],
    ['[queue,stolen_from_stall_vikingfish]', 1500]
  ]);
  for (let turn = 1; turn <= 1501; turn++) {
    World.currentTick++;
    joined.processQueues();
    const expected = turn <= 1000 ? (1 << 8) | (1 << 9) : turn <= 1500 ? 1 << 9 : 0;
    assert.equal(joined.getVar(mask), expected, `independent expiry after native queue turn ${turn}`);
  }
  assert.equal(stallQueues(joined).length, 0);
});
test('a save without a stall lockout gains no regional state or queue at login', () => {
  const original = player();
  const joined = player(original.save());
  const before = Array.from(joined.vars);
  proc(joined, 'thieving_stall_timers_login');
  assert.deepEqual(Array.from(joined.vars), before);
  assert.equal([...joined.queue.all()].length, 0);
});
console.log(`${cases} native stall checks passed`);
process.exit(0);
