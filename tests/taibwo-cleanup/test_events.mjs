import assert from 'node:assert/strict';
import { World, types, fixture, get, set, id, obj, inv, count, PlayerStat, ScriptProvider,
  ServerTriggerType, engineModule, standAt, hack, useLoc, held, invButton, dispatchNpc, slotOf, environmentTick } from '../tai-bwo-cleanup/runtime.mjs';
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const map = await engineModule('engine/GameMap.ts');
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const OpLocHandler = (await engineModule('network/game/client/handler/OpLocHandler.ts')).default;
const opLoc = new OpLocHandler();
const expected = [
  ['tbwcu_jungle_spider', 22], ['tbwcu_tribesman', 21], ['tbwcu_village_snake', 21],
  ['tbwcu_mosquito_single', 8], ['tbwcu_mosquito_swarm3', 7], ['tbwcu_mosquito_swarm5', 6],
  ['village_gem_rock1', 5], ['tbwcu_broodoo_combat', 4], ['tbwcu_broodoo_poison', 3],
  ['tbwcu_broodoo_disease', 2], ['village_gout_tuber', 1]
];
const enemyIds = new Set(expected.filter(([name]) => name.startsWith('tbwcu')).map(([name]) => id('NpcType', name)));
const activeEnemies = () => [...World.npcs].filter(n => n.isActive && enemyIds.has(n.type));
function cleanEnemies() { for (const n of activeEnemies()) World.removeNpc(n, -1); World.processNpcEventQueue(); }
const bushes = [];
for (let x = 43 * 64; x < 45 * 64; x += 8) for (let z = 47 * 64; z < 49 * 64; z += 8)
  for (const loc of World.gameMap.getZone(x, z, 0).getAllLocsUnsafe())
    if (types.LocType.get(loc.baseType).debugname === 'tai_bwo_jungle_vegetation_easy_1') bushes.push(loc);
const p = fixture(undefined, ['machette', 'spade', 'rune_pickaxe']);
// Keep level 99 coherent when the native XP award recalculates Mining.
p.stats[PlayerStat.MINING] = 130_344_310;
set(p, 'cleanup_progress', 1);
const bush = bushes.find(loc => { try { standAt(p, loc); return true; } catch { return false; } });
assert(bush, 'reachable original jungle bush');
const reset = () => { if (bush.isChanged()) World.revertLoc(bush); standAt(p, bush); p.clearInteraction(); p.delayed = false; };
const seeds = new Map();
for (let seed = 0; seed < 1000000 && seeds.size < 100; seed++) {
  JavaRandom.setSeed(seed);
  if (Math.floor(JavaRandom.nextDouble() * 101) !== 0) continue;
  const roll = Math.floor(JavaRandom.nextDouble() * 100);
  if (!seeds.has(roll)) seeds.set(roll, seed);
}
assert.equal(seeds.size, 100);
function reveal(roll) {
  reset(); set(p, 'eventchance', 7); JavaRandom.setSeed(seeds.get(roll));
  const spars = count(p, 'thatching_spar_light');
  hack(p, bush); World.processNpcEventQueue();
  assert.equal(get(p, 'eventchance'), 0, 'real Hack resets event counter');
  assert.equal(count(p, 'thatching_spar_light'), spars, 'an event interrupts the cut before its spar award');
}
let cases = 0;
function test(name, run) { run(); cases++; console.log(`PASS ${name}`); }
test('all 100 common event slots run through the visible Hack dispatch with correct weights and walkable reachable enemies', () => {
  const seen = new Map(expected.map(([name]) => [name, 0]));
  let cutoff = expected[0][1], entry = 0;
  for (let roll = 0; roll < 100; roll++) {
    while (roll >= cutoff) cutoff += expected[++entry][1];
    const name = expected[entry][0]; reveal(roll);
    const enemies = activeEnemies();
    if (name.startsWith('village')) {
      assert.equal(enemies.length, 0); assert.equal(bush.type, id('LocType', name));
    } else {
      assert.equal(enemies.length, 1); const n = enemies[0];
      assert.equal(n.type, id('NpcType', name));
      assert(!map.isMapBlocked(n.x, n.z, n.level));
      const route = Array.from(map.findPath(n.level, p.x, p.z, n.x, n.z));
      assert(route.length || (p.x === n.x && p.z === n.z));
      if (route.length) { const end = CoordGrid.unpackCoord(route.at(-1)); assert.equal(end.x, n.x); assert.equal(end.z, n.z); }
    }
    seen.set(name, seen.get(name) + 1); cleanEnemies();
  }
  assert.deepEqual([...seen], expected);
});
test('gout comes from the 1% real Hack outcome and spade-on-visible-loc gives one tuber without consuming the spade', () => {
  reveal(99); const xp = p.stats[PlayerStat.FARMING];
  const type = types.LocType.get(bush.type);
  assert(ScriptProvider.getByTrigger(ServerTriggerType.OPLOCU, type.id, type.category));
  assert(useLoc(p, 'spade', bush));
  assert.equal(count(p, 'village_rare_tuber'), 1);
  assert.equal(p.stats[PlayerStat.FARMING] - xp, 0, 'no source awards dig XP; cultivation is separate');
  assert.equal(count(p, 'spade'), 1); assert.notEqual(bush.type, id('LocType', 'village_gout_tuber'));
  assert(useLoc(p, 'spade', bush, id('LocType', 'village_gout_tuber')) === false, 'stale native tuber identity cannot give a second item');
});
test('two arriving players cannot dig the same temporary plant twice', () => {
  reveal(99);
  const q = fixture([p.level, p.x, p.z], ['spade']);
  const before = count(p, 'village_rare_tuber') + count(q, 'village_rare_tuber');
  p.lastMovement = World.currentTick; q.lastMovement = World.currentTick;
  assert(useLoc(p, 'spade', bush)); assert(useLoc(q, 'spade', bush));
  assert.equal(count(p, 'village_rare_tuber') + count(q, 'village_rare_tuber'), before);
  environmentTick(p, q);
  assert.equal(count(p, 'village_rare_tuber') + count(q, 'village_rare_tuber'), before + 1);
  p.lastMovement = -1; q.lastMovement = -1;
});
test('inventory Dig finds only an adjacent Tai Bwo plant; full inventory and wrong item preserve it and give no reward', () => {
  reveal(99); const before = count(p, 'village_rare_tuber');
  assert(useLoc(p, 'rune_pickaxe', bush)); assert.equal(bush.type, id('LocType', 'village_gout_tuber'));
  while (p.invFreeSpace(inv)) p.invAdd(inv, obj('bucket_empty'), 1);
  assert(held(p, 'spade', 1));
  assert.equal(count(p, 'village_rare_tuber'), before); assert.equal(bush.type, id('LocType', 'village_gout_tuber'));
  p.invDel(inv, obj('bucket_empty'), 1);
  assert(held(p, 'spade', 1)); assert.equal(count(p, 'village_rare_tuber'), before + 1);
  p.getInventory(inv).removeAll(); for (const name of ['spade', 'rune_pickaxe']) p.invAdd(inv, obj(name), 1);
  const q = fixture([0, 3222, 3218], ['spade']); const xp = q.stats[PlayerStat.FARMING];
  assert(held(q, 'spade', 1)); assert.equal(count(q, 'village_rare_tuber'), 0); assert.equal(q.stats[PlayerStat.FARMING], xp);
});
test('unclaimed gout and gem finds time out into the original bush without a tuber reward', () => {
  for (const roll of [85, 99]) {
    reveal(roll); const before = count(p, 'village_rare_tuber');
    const duration = bush.lifecycleTick; assert(duration > 0 && duration <= 1000);
    for (let tick = 0; tick < duration; tick++) bush.turn();
    assert.equal(bush.type, bush.baseType); assert.equal(count(p, 'village_rare_tuber'), before);
  }
});
const gems = ['uncut_opal', 'uncut_jade', 'uncut_red_topaz', 'uncut_sapphire', 'uncut_emerald', 'uncut_ruby', 'uncut_diamond'];
const gemCount = () => gems.reduce((sum, name) => sum + count(p, name), 0);
function mineOnce() {
  const before = gemCount();
  for (let attempt = 0; attempt < 100 && gemCount() === before; attempt++) {
    p.setVar(id('VarPlayerType', 'action_delay'), World.currentTick);
    p.clearInteraction(); p.delayed = false;
    assert(opLoc.handle(new OpLoc(1, bush.x, bush.z, bush.type), p)); p.processInteraction();
    World.currentTick++; p.delayed = false;
  }
  assert.equal(gemCount(), before + 1, `one successful native Mine gives exactly one gem: ${JSON.stringify({ form: types.LocType.get(bush.type).debugname, active: p.activeScript?.script?.name, execution: p.activeScript?.execution, protect: p.protect, modalMain: p.modalMain, modalChat: p.modalChat, actionDelay: get(p, 'action_delay') })}`);
}
test('all three visible gem-rock stages mine exactly three gems with ordinary level, tool and space gates', () => {
  reveal(85); const xp = p.stats[PlayerStat.MINING], before = gemCount();
  for (let stage = 1; stage <= 3; stage++) {
    assert.equal(bush.type, id('LocType', `village_gem_rock${stage}`));
    const type = types.LocType.get(bush.type);
    for (const trigger of [ServerTriggerType.OPLOC1, ServerTriggerType.OPLOC2, ServerTriggerType.OPLOC3])
      assert(ScriptProvider.getByTrigger(trigger, type.id, type.category));
    mineOnce();
  }
  assert.equal(gemCount(), before + 3); assert.equal(p.stats[PlayerStat.MINING] - xp, 1950);
  assert.equal(bush.type, id('LocType', 'tai_bwo_jungle_vegetation_easy_5'));
  reveal(85);
  while (p.invFreeSpace(inv)) p.invAdd(inv, obj('bucket_empty'), 1);
  assert(opLoc.handle(new OpLoc(1, bush.x, bush.z, bush.type), p)); p.processInteraction();
  assert.equal(bush.type, id('LocType', 'village_gem_rock1')); p.closeModal(); p.activeScript = null;
  p.invDel(inv, obj('bucket_empty'), p.invTotal(inv, obj('bucket_empty')));
  reveal(85); p.levels[PlayerStat.MINING] = 39;
  assert(opLoc.handle(new OpLoc(1, bush.x, bush.z, bush.type), p)); p.processInteraction();
  assert.equal(bush.type, id('LocType', 'village_gem_rock1')); p.closeModal(); p.activeScript = null;
  p.levels[PlayerStat.MINING] = 99; p.invDel(inv, obj('rune_pickaxe'), 1);
  assert(opLoc.handle(new OpLoc(1, bush.x, bush.z, bush.type), p)); p.processInteraction();
  assert.equal(bush.type, id('LocType', 'village_gem_rock1')); p.closeModal(); p.activeScript = null;
});
test('the existing Gabooty cooperative buys gout and both cut and uncut jungle gems for sticks, not coins', () => {
  const gabooty = [...World.npcs].find(n => n.baseType === id('NpcType', 'tbwcu_gabooty_multinpc'));
  assert(gabooty);
  for (const name of ['village_rare_tuber', 'uncut_opal', 'uncut_jade', 'uncut_red_topaz', 'opal', 'jade', 'red_topaz']) {
    const q = fixture(undefined, [name]); dispatchNpc(q, gabooty, 3);
    const sticks = count(q, 'village_trade_sticks'), coins = count(q, 'coins');
    assert(invButton(q, 'shop_template_side:inv', name, 2, slotOf(q, name)));
    assert.equal(count(q, name), 0); assert(count(q, 'village_trade_sticks') > sticks); assert.equal(count(q, 'coins'), coins);
  }
});
reset(); cleanEnemies();
console.log(`Tai Bwo remaining jungle events: ${cases} compiled cases passed`);
process.exit(0);
