#!/usr/bin/env node
import assert from 'node:assert/strict';
import { World, ScriptProvider, ServerTriggerType, PlayerStat, types, map, CollisionType, id, obj, inv, worn, player, seed, inventory, count, slotOf, use, held, remove, execute, tile } from './runtime.mjs';

// Original item pairs and operations, not ids from generated server packs.
const pairs = [
  ['unlit_candle', 'lit_candle', 1, 1, null],
  ['unlit_black_candle', 'lit_black_candle', 1, 1, null],
  ['torch_unlit', 'torch_lit', 1, 1, 'You light the torch.'],
  ['candle_lantern_unlit', 'candle_lantern_lit', 4, 2, 'You light the candle lantern.'],
  ['candle_lantern_black_unlit', 'candle_lantern_black_lit', 4, 2, 'You light the candle lantern.'],
  ['oil_lamp_unlit', 'oil_lamp_lit', 12, 2, 'You light the oil lamp.'],
  ['oil_lantern_unlit', 'oil_lantern_lit', 26, 2, 'You light the oil lantern.'],
  ['bullseye_lantern_unlit', 'bullseye_lantern_lit', 49, 2, 'You light the bullseye lantern.'],
  ['tog_sapphire_lantern_unlit', 'tog_sapphire_lantern_lit', 49, 1, 'You light the sapphire lantern.'],
  ['cave_goblin_mining_helmet_unlit', 'cave_goblin_mining_helmet_lit', 65, 3, 'You light the mining helmet.'],
  ['slayer_buglan_off', 'slayer_buglan_on', 33, 3, 'You light the lit bug lantern.']
];
let cases = 0;
let failures = 0;
function test(name, action) {
  cases++;
  try { action(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack ?? error}`); }
}
function unchanged(p, before, xp) {
  assert.deepEqual(inventory(p), before, 'all carried items conserved on refusal');
  assert.equal(p.stats[PlayerStat.FIREMAKING], xp, 'no Firemaking XP');
}
for (const [unlit, lit, level, option, message] of pairs) {
  test(`${unlit}: level ${level - 1} refuses silently, level ${level} lights, both item-use directions, no XP`, () => {
    for (const reverse of [false, true]) {
      const p = seed(player(level - 1), ['tinderbox', unlit]);
      const before = inventory(p); const xp = p.stats[PlayerStat.FIREMAKING];
      assert(use(p, ...(reverse ? [unlit, 'tinderbox'] : ['tinderbox', unlit])));
      unchanged(p, before, xp);
      assert.deepEqual(p.messages, [], 'no invented under-level sentence');
      p.baseLevels[PlayerStat.FIREMAKING] = level; p.levels[PlayerStat.FIREMAKING] = level;
      assert(use(p, ...(reverse ? [unlit, 'tinderbox'] : ['tinderbox', unlit])));
      assert.equal(count(p, unlit), 0); assert.equal(count(p, lit), 1);
      assert.equal(count(p, 'tinderbox'), 1);
      assert.equal(p.stats[PlayerStat.FIREMAKING], xp);
      assert.deepEqual(p.messages, message ? [message] : []);
      assert.equal(p.animId, -1, 'no added ignition animation');
      assert(!p.packets.some(packet => /Synth|Spotanim/.test(packet.constructor.name)), 'no added sound or spotanim');
    }
  });
  test(`${unlit}: missing tinderbox packet rejected without loss or XP`, () => {
    const p = seed(player(level), [unlit, 'hammer']);
    const before = inventory(p); const xp = p.stats[PlayerStat.FIREMAKING];
    assert.equal(use(p, 'tinderbox', unlit, { useSlot: 1 }), false);
    unchanged(p, before, xp);
    assert.deepEqual(p.messages, []);
  });
  test(`${unlit}: full bag ignition, original Extinguish ${option}, silence, exact slot and persistent relighting`, () => {
    const p = seed(player(level), ['tinderbox', unlit]);
    while (p.invFreeSpace(inv) > 0) p.invAdd(inv, obj('hammer'), 1);
    const xp = p.stats[PlayerStat.FIREMAKING];
    assert(use(p, 'tinderbox', unlit));
    assert.equal(count(p, lit), 1); assert.equal(p.invFreeSpace(inv), 0);
    const slot = slotOf(p, lit);
    assert.equal(types.ObjType.get(obj(lit)).iop[option - 1], 'Extinguish');
    p.messages.length = 0;
    assert(held(p, lit, option));
    assert.equal(count(p, lit), 0); assert.equal(count(p, unlit), 1);
    assert.equal(inventory(p)[slot].name, unlit, 'manual operation replaces its exact slot');
    assert.equal(p.invFreeSpace(inv), 0); assert.deepEqual(p.messages, []);
    assert(use(p, 'tinderbox', unlit), 'normal extinction retains filled state');
    assert.equal(count(p, lit), 1); assert.equal(p.stats[PlayerStat.FIREMAKING], xp);
    assert.equal(count(p, 'hammer'), 26);
  });
}
for (const name of ['oil_lamp_empty', 'candle_lantern_empty', 'oil_lantern_empty', 'bullseye_lantern_empty', 'bullseye_lantern_nolens', 'tog_sapphire_lantern_empty', 'hammer']) {
  test(`${name}: tinderbox does not light an empty or wrong item`, () => {
    const p = seed(player(), ['tinderbox', name]);
    const before = inventory(p); const xp = p.stats[PlayerStat.FIREMAKING];
    assert(use(p, 'tinderbox', name));
    unchanged(p, before, xp);
    assert.deepEqual(p.messages, ['Nothing interesting happens.']);
  });
}
for (const [unlit, lit, , , message] of pairs.filter(pair => pair[0].includes('helmet') || pair[0] === 'slayer_buglan_off')) {
  test(`${lit}: option 2 equips either form, worn removal, full-bag removal refusal, and carried extinction 3`, () => {
    const p = seed(player(), ['tinderbox', unlit]);
    const wearpos = types.ObjType.get(obj(lit)).wearpos;
    assert(held(p, unlit, 2));
    assert.equal(p.invGetSlot(worn, wearpos)?.id, obj(unlit));
    assert.equal(count(p, unlit), 0);
    const xp = p.stats[PlayerStat.FIREMAKING];
    assert.equal(use(p, 'tinderbox', unlit, { targetSlot: 1 }), false, 'worn source is not a carried target');
    assert(remove(p, unlit));
    assert.equal(count(p, unlit), 1); assert.equal(count(p, unlit, worn), 0);
    p.messages.length = 0;
    assert(use(p, 'tinderbox', unlit)); assert.deepEqual(p.messages, [message]);
    assert(held(p, lit, 2)); assert.equal(p.invGetSlot(worn, wearpos)?.id, obj(lit));
    while (p.invFreeSpace(inv) > 0) p.invAdd(inv, obj('hammer'), 1);
    assert(remove(p, lit)); assert.equal(count(p, lit, worn), 1);
    assert(p.messages.includes("You don't have enough free space to do that."));
    p.invDel(inv, obj('hammer'), 1);
    assert(remove(p, lit)); assert.equal(count(p, lit, worn), 0); assert.equal(count(p, lit), 1);
    p.messages.length = 0;
    assert(held(p, lit, 3)); assert.equal(count(p, unlit), 1); assert.equal(count(p, lit), 0);
    assert.deepEqual(p.messages, []); assert.equal(p.stats[PlayerStat.FIREMAKING], xp);
  });
}
test('duplicate lit sources: Extinguish only transforms the selected copy', () => {
  const p = seed(player(), ['oil_lantern_lit', 'hammer', 'oil_lantern_lit']);
  assert(held(p, 'oil_lantern_lit', 2, 2));
  assert.deepEqual(inventory(p).slice(0, 3), [{ name: 'oil_lantern_lit', count: 1 }, { name: 'hammer', count: 1 }, { name: 'oil_lantern_unlit', count: 1 }]);
});
test('Fishing Platform sea-crossing damp-tinderbox exception stays torch-only, on both packed rectangle planes', () => {
  for (const plane of [0, 1]) {
    const p = seed(player(), ['tinderbox', 'torch_unlit', 'unlit_candle']);
    p.x = 43 * 64 + 8; p.z = 51 * 64 + 7; p.level = plane;
    const before = inventory(p); const xp = p.stats[PlayerStat.FIREMAKING];
    assert(use(p, 'tinderbox', 'torch_unlit')); unchanged(p, before, xp);
    assert.deepEqual(p.messages, ["Your tinderbox is damp from the sea crossing. It won't light here."]);
    assert(use(p, 'tinderbox', 'unlit_candle')); assert.equal(count(p, 'lit_candle'), 1);
  }
});
test('Haunted Mine real lift: helmet is excluded, ordinary candle extinguishes and tinderbox becomes damp', () => {
  for (const light of ['cave_goblin_mining_helmet_lit', 'lit_candle']) {
    const p = seed(player(), [light, 'tinderbox']);
    p.x = 43 * 64 + 55; p.z = 70 * 64 + 13;
    execute('[oploc1,lift_side_l]', p);
    assert.deepEqual(tile(p), [0, 42 * 64 + 37, 69 * 64 + 36]);
    assert.equal(count(p, light), light === 'lit_candle' ? 0 : 1);
    assert.equal(count(p, 'unlit_candle'), light === 'lit_candle' ? 1 : 0);
    assert.equal(count(p, 'tinderbox'), 0); assert.equal(count(p, 'damp_tinderbox'), 1);
    assert(p.messages.includes('The water soaks your tinderbox!'));
  }
});
test('damp tinderbox cannot ignite a filled light; actual ordinary tinderbox is its positive control', () => {
  const p = seed(player(), ['damp_tinderbox', 'oil_lantern_unlit']);
  const before = inventory(p); const xp = p.stats[PlayerStat.FIREMAKING];
  assert(use(p, 'damp_tinderbox', 'oil_lantern_unlit')); unchanged(p, before, xp);
  p.invAdd(inv, obj('tinderbox'), 1);
  assert(use(p, 'tinderbox', 'oil_lantern_unlit')); assert.equal(count(p, 'oil_lantern_lit'), 1);
});
test('Ikov real dark-stair reader rejects lone helmet and accepts carried candle unchanged', () => {
  for (const light of ['cave_goblin_mining_helmet_lit', 'lit_candle']) {
    const p = seed(player(), [light]);
    execute('[oploc1,ikov_darkstairsdown]', p, [], { allowPause: true });
    assert.deepEqual(tile(p), [0, 41 * 64 + 17, 152 * 64 + (light === 'lit_candle' ? 36 : 13)]);
    assert.equal(count(p, light), 1);
    if (light !== 'lit_candle') assert(p.packets.some(packet => String(packet.text).includes("It's a bit dark down here!")));
  }
});
test('Watchtower real cave reader: helmet-plus-map fails, candle-plus-map passes, missing map stays independent', () => {
  for (const light of ['cave_goblin_mining_helmet_lit', 'lit_candle']) {
    for (const hasMap of [false, true]) {
      const p = seed(player(), hasMap ? [light, 'skavidmap'] : [light]);
      const state = execute('[proc,check_map_lightsource_tinderbox]', p);
      assert.equal(state.intStack[state.isp - 1], hasMap ? (light === 'lit_candle' ? 1 : 2) : 0);
      assert.equal(count(p, light), 1);
    }
  }
});
test('lit mining helmet stays outside the global carried-light category', () => {
  assert.notEqual(types.ObjType.get(obj('cave_goblin_mining_helmet_lit')).category, id('CategoryType', 'light_source_lit'));
});
test('public natural Dark hole retains packed walkable approaches and real SC-07 dispatch', () => {
  const type = types.LocType.get(id('LocType', 'goblin_cave_entrance'));
  const loc = World.getLoc(3169, 3172, 0, type.id);
  assert(loc, 'original natural exterior Dark hole');
  assert.equal(type.name, 'Dark hole');
  const approaches = [];
  for (let x = loc.x - 3; x <= loc.x + type.width + 3; x++) {
    for (let z = loc.z - 3; z <= loc.z + type.length + 3; z++) {
      if (!map.isMapBlocked(x, z, 0) && map.reachedLoc(0, x, z, loc.x, loc.z, type.width, type.length, 1, loc.angle, loc.shape, type.forceapproach)) approaches.push([x, z]);
    }
  }
  assert(approaches.length > 0, 'real packed shape/rotation has an ordinary walkable approach');
  assert(approaches.some(([x, z]) => [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dz]) => map.canTravel(0, x, z, dx, dz, 1, 0, CollisionType.NORMAL))), 'real exterior approach supports ordinary travel');
  console.log(`DARK_HOLE_APPROACHES ${JSON.stringify(approaches)}`);
  assert.equal(ScriptProvider.getByTrigger(ServerTriggerType.OPLOC1, type.id, type.category)?.name, '[oploc1,goblin_cave_entrance]');
  assert.equal(ScriptProvider.getByTrigger(ServerTriggerType.OPLOCU, type.id, type.category)?.name, '[oplocu,goblin_cave_entrance]');
});
console.log(`SC01 cases=${cases} pass=${cases - failures} fail=${failures}`);
console.log(failures ? 'RESULT FAIL' : 'RESULT PASS');
// World creates workers but this suite starts no server.
process.exit(failures ? 1 : 0);
