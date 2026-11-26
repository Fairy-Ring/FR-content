#!/usr/bin/env node
// Native packed-map interactions and a controlled platform clock, no server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  World, PlayerStat, Packet, PlayerLoading, ScriptProvider, ScriptState, ServerTriggerType,
  contentRoot, count, engineModule, execute, held, id, inv, map, obj, player,
  resumeDialogue, startDialogue, tick, types, use, useLoc, weakCount, worn
} from '../swamp-caves/runtime.mjs';
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const OpLocHandler = (await engineModule('network/game/client/handler/OpLocHandler.ts')).default;
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const locHandler = new OpLocHandler();
const originDescriptor = Object.getOwnPropertyDescriptor(performance, 'timeOrigin');
const nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
let minute = 640 * 50000 + 1;
Object.defineProperty(performance, 'timeOrigin', { configurable: true, get: () => minute * 60000 });
Object.defineProperty(performance, 'now', { configurable: true, value: () => 0 });
const randomDouble = JavaRandom.nextDouble;
let roll = 64;
JavaRandom.nextDouble = () => (roll + 0.5) / 128;
const recipes = [
  ['dwarven_stout', 'hammerstone_hops', 4, 19, 215, 215],
  ['asgarnian_ale', 'asgarnian_hops', 4, 24, 248, 248],
  ['greenmans_ale', 'harralander', 4, 29, 281, 281],
  ['wizards_mind_bomb', 'yanillian_hops', 4, 34, 314, 314],
  ['dragon_bitter', 'krandorian_hops', 4, 39, 347, 347],
  ['moonlight_mead', 'bittercap_mushroom', 4, 44, 400, 400],
  ['axemans_folly', 'oak_roots', 1, 49, 413, 413],
  ['chefs_delight', 'chocolate_dust', 4, 54, 446, 446],
  ['slayers_respite', 'wildblood_hops', 4, 59, 479, 479],
  ['cider', 'apple_mush', 4, 14, 182, 182]
];
const get = (p, name) => p.getVarBit(id('VarBitType', name));
const vat = (p, site) => get(p, `brewing_vat_varbit_${site}`);
const barrel = (p, site) => get(p, `brewing_barrel_varbit_${site}`);
const give = (p, name, amount = 1) => p.invAdd(inv, obj(name), amount);
const proc = (p, name, args = []) => {
  const state = execute(`[proc,${name}]`, p, args);
  if (name === 'brewing_update_all' || name === 'farming_reconcile') tick(p);
  return state;
};
const placements = [];
for (const file of fs.readdirSync(path.join(contentRoot, 'maps')).filter(file => /^m\d+_\d+\.jm2$/.test(file))) {
  const [mx, mz] = file.slice(1, -4).split('_').map(Number);
  let section = '';
  for (const line of fs.readFileSync(path.join(contentRoot, 'maps', file), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) section = line;
    if (!section.includes('LOC')) continue;
    const match = /^(\d+) (\d+) (\d+): (\d+) (\d+)(?: (\d+))?/.exec(line);
    if (match) placements.push({ level: +match[1], x: mx * 64 + +match[2], z: mz * 64 + +match[3], type: +match[4] });
  }
}
function at(p, level, x, z) {
  p.level = level; p.x = x; p.z = z; p.originX = x; p.originZ = z; p.clearInteraction();
}
const naturalTargets = new Map();
function naturalLoc(p, name) {
  const type = id('LocType', name), config = types.LocType.get(type);
  const cached = naturalTargets.get(type);
  if (cached) {
    at(p, cached.loc.level, cached.x, cached.z);
    assert(p.inOperableDistance(cached.loc), `${name}: cached natural interaction stand`);
    return cached.loc;
  }
  for (const row of placements.filter(row => row.type === type)) {
    const loc = World.getLoc(row.x, row.z, row.level, type);
    if (!loc) continue;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      const x = row.x + dx, z = row.z + dz;
      if (map.isMapBlocked(x, z, row.level)) continue;
      if (!map.reachedLoc(row.level, x, z, loc.x, loc.z, config.width, config.length, 1, loc.angle, loc.shape, config.forceapproach)) continue;
      at(p, row.level, x, z);
      assert(p.inOperableDistance(loc), `${name}: natural reachable stand`);
      const exit = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([a, b]) =>
        !map.isMapBlocked(x + a, z + b, row.level) && map.findPath(row.level, x, z, x + a, z + b).length > 0);
      assert(exit, `${name}: walkable packed-map route out`);
      naturalTargets.set(type, { loc, x, z });
      return loc;
    }
  }
  assert.fail(`natural reachable ${name}`);
}
function brewer(p, name) {
  const target = [...World.npcs].find(n => n.type === id('NpcType', name) && n.isActive);
  assert(target, `natural brewer ${name}`);
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
    const x = target.x + dx, z = target.z + dz;
    if (map.isMapBlocked(x, z, target.level)) continue;
    at(p, target.level, x, z);
    if (!p.inOperableDistance(target)) continue;
    assert([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) =>
      !map.isMapBlocked(x + a, z + b, target.level) && map.findPath(target.level, x, z, x + a, z + b).length > 0),
    `${name}: natural packed-map route out`);
    return target;
  }
  assert.fail(`${name}: natural reachable interaction stand`);
}
function visible(p, loc) {
  const base = types.LocType.get(loc.type);
  return base.multivarbit < 0 ? base : types.LocType.get(base.multiloc[p.getVarBit(base.multivarbit)]);
}
function finish(p, choices = []) {
  const pending = [...choices];
  for (let n = 0; n < 300; n++) {
    const state = p.activeScript;
    if (!state) { if (!weakCount(p)) break; tick(p); continue; }
    assert.notEqual(state.execution, ScriptState.ABORTED, 'interaction does not abort');
    if (state.execution === ScriptState.PAUSEBUTTON) {
      const choice = /^multi[2-5]$/.test(types.Component.get(p.modalChat).comName);
      assert(!choice || pending.length, 'explicit choice required');
      resumeDialogue(p, choice ? pending.shift() : null);
    } else if (state.execution === ScriptState.SUSPENDED) tick(p);
    else if (state.execution === ScriptState.FINISHED) break;
    else assert.fail(`unexpected execution ${state.execution}`);
  }
  assert.equal(pending.length, 0, 'all choices consumed');
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED, 'interaction settles');
}
function itemLoc(p, item, name) {
  const loc = naturalLoc(p, name), form = visible(p, loc);
  const trigger = ScriptProvider.getByTrigger(ServerTriggerType.OPLOCU, form.id, form.category);
  assert(trigger, `${item}: visible ${form.debugname} has packed item-use dispatch`);
  assert(useLoc(p, item, loc), `${item} native OpLocU accepted`);
  finish(p);
}
function operate(p, name, choices = []) {
  const loc = naturalLoc(p, name), form = visible(p, loc);
  assert(form.op?.[0] && form.op[0] !== 'hidden', `${form.debugname}: original operation`);
  assert(locHandler.handle(new OpLoc(1, loc.x, loc.z, loc.type), p), 'native OpLoc accepted');
  p.processInteraction(); finish(p, choices);
}
function saved(p) {
  const q = PlayerLoading.load('brew_save', new Packet(p.save()), null);
  for (const name of ['farming_varp_9', 'brewing_clock', 'forget_clock'])
    assert.equal(q.getVar(id('VarPlayerType', name)), p.getVar(id('VarPlayerType', name)), `native persistence ${name}`);
  return q;
}
function loadBatch(p, site, index, { gate = false } = {}) {
  const [name, ingredient, amount, level] = recipes[index];
  const target = `brewing_vat_${site}`;
  give(p, ingredient, amount); give(p, 'ale_yeast');
  if (name !== 'cider') {
    give(p, 'bucket_water', 2); give(p, 'barley_malt', 2);
    itemLoc(p, ingredient, target);
    assert.equal(vat(p, site), 0, 'recipe cannot skip water/malt');
    itemLoc(p, 'bucket_water', target); assert.equal(vat(p, site), 1);
    assert.equal(count(p, 'bucket_empty'), 2);
    itemLoc(p, 'ale_yeast', target); assert.equal(vat(p, site), 1, 'yeast cannot skip malt/recipe');
    itemLoc(p, 'barley_malt', target); assert.equal(vat(p, site), 2);
  }
  if (gate) {
    p.levels[PlayerStat.COOKING] = level - 1;
    itemLoc(p, ingredient, target);
    assert.equal(vat(p, site), name === 'cider' ? 0 : 2, `${name}: Cooking gate`);
    assert.equal(count(p, ingredient), amount, 'refused ingredient is retained');
    p.levels[PlayerStat.COOKING] = level;
  }
  itemLoc(p, ingredient, target);
  assert.equal(vat(p, site), 4 + index * 6);
  assert.equal(count(p, ingredient), 0, 'recipe amount consumed');
  itemLoc(p, 'ale_yeast', target);
  assert.equal(vat(p, site), 5 + index * 6);
  assert.equal(count(p, 'pot_empty'), 1);
  const clock = p.getVar(id('VarPlayerType', 'brewing_clock'));
  assert.equal((clock >>> ((site - 1) * 16)) & 65535, Math.floor(minute / 640) & 65535, 'product writes real global window origin');
  saved(p);
}
try {
  assert.equal(id('VarPlayerType', 'brewing_clock'), 419);
  assert.equal(types.VarPlayerType.get(419).scope, 1, 'fermentation metadata is permanent');
  assert.equal(types.ObjType.getId('the_stuff'), -1, 'post-target The stuff absent');
  for (const name of ['blandebir', 'metarialus']) brewer(player(), name);
  for (const [amulet, pot, tokens, yeast] of [[false, true, 5, 0], [true, false, 5, 0], [true, true, 4, 0], [true, true, 5, 1]]) {
    const p = player();
    give(p, 'coins', 100); give(p, 'ectotoken', tokens);
    if (pot) give(p, 'pot_empty');
    if (amulet) p.invAdd(worn, obj('amulet_of_ghostspeak'), 1);
    const target = brewer(p, 'metarialus');
    if (amulet) startDialogue('[opnpc1,metarialus]', p, target);
    else execute('[opnpc1,metarialus]', p, [], { target });
    finish(p, amulet ? [1] : []);
    assert.equal(count(p, 'ale_yeast'), yeast, 'ghostspeak, pot and five-token gates');
    assert.equal(count(p, 'ectotoken'), tokens - 5 * yeast, 'period price is ecto-tokens');
    assert.equal(count(p, 'coins'), 100, 'Metarialus never charges coins');
  }
  const ghostFriend = player();
  ghostFriend.setVarBit(id('VarBitType', 'ahoy_questvar'), 8);
  give(ghostFriend, 'pot_empty'); give(ghostFriend, 'ectotoken', 5);
  startDialogue('[opnpc1,metarialus]', ghostFriend, brewer(ghostFriend, 'metarialus'));
  finish(ghostFriend, [1]);
  assert.equal(count(ghostFriend, 'ale_yeast'), 1, 'completed Ghosts Ahoy permits speech without an amulet');
  assert.equal(count(ghostFriend, 'ectotoken'), 0);
  const apples = player(); give(apples, 'cooking_apple', 3); give(apples, 'bucket_empty');
  itemLoc(apples, 'cooking_apple', 'farming_applebarrel_empty');
  assert.equal(count(apples, 'cooking_apple'), 3, 'incomplete apple batch retained');
  give(apples, 'cooking_apple');
  itemLoc(apples, 'bucket_empty', 'farming_applebarrel_empty');
  assert.equal(count(apples, 'apple_mush'), 1); assert.equal(count(apples, 'cooking_apple'), 0);
  const discard = player(); give(discard, 'bucket_water', 2);
  itemLoc(discard, 'bucket_water', 'brewing_vat_2');
  operate(discard, 'vat_valve_2', [2]); assert.equal(vat(discard, 2), 1, 'cancel retains unfinished batch');
  operate(discard, 'vat_valve_2', [1]); assert.equal(vat(discard, 2), 0, 'confirmed discard clears unfinished batch');
  for (const site of [1, 2]) for (let index = 0; index < recipes.length; index++) {
    minute = 640 * 50000 + 1; roll = 64;
    const p = player();
    loadBatch(p, site, index, { gate: true });
    const other = site === 1 ? 2 : 1;
    assert.equal(vat(p, other), 0, 'other brewery stays independent');
    minute = 640 * 50001;
    proc(p, 'farming_reconcile', [0]);
    assert.equal(vat(p, site), 6 + index * 6, 'first growth boundary changes visible phase');
    minute = 640 * 50003 - 1;
    proc(p, 'brewing_update_all');
    assert.equal(vat(p, site), 6 + index * 6, 'not ready before third boundary');
    saved(p);
    minute++;
    const q = saved(p);
    proc(q, 'farming_reconcile', [1]);
    assert.equal(vat(q, site), 7 + index * 6, 'offline controlled clock finishes third boundary');
    // Continue native input on the original fixture, now at the same real clock.
    proc(p, 'brewing_update_all');
    const xp = p.stats[PlayerStat.COOKING];
    operate(p, `vat_valve_${site}`);
    assert.equal(vat(p, site), 0); assert.equal(barrel(p, site), (index + 1) * 8);
    assert.equal(p.stats[PlayerStat.COOKING] - xp, recipes[index][4] * 10, 'normal XP in tenths, once per batch');
    operate(p, `brewing_barrel_${site}`);
    give(p, 'beer_glass', 8);
    for (let pint = 0; pint < 8; pint++) itemLoc(p, 'beer_glass', `brewing_barrel_${site}`);
    assert.equal(count(p, recipes[index][0]), 8, 'exactly eight pints');
    assert.equal(barrel(p, site), 0);
    operate(p, `vat_valve_${site}`);
    assert.equal(p.stats[PlayerStat.COOKING] - xp, recipes[index][4] * 10, 'empty valve cannot duplicate XP');
    saved(p);
  }
  // A normally filled barrel must survive switching the vat to Kelda stout.
  minute = 640 * 50000 + 1; roll = 64;
  const mixed = player();
  loadBatch(mixed, 1, 1);
  minute = 640 * 50003; proc(mixed, 'brewing_update_all');
  operate(mixed, 'vat_valve_1');
  assert.equal(barrel(mixed, 1), 16, 'eight ordinary Asgarnian ale pints in barrel 1');
  give(mixed, 'bucket_water', 2); give(mixed, 'barley_malt', 2);
  itemLoc(mixed, 'bucket_water', 'brewing_vat_1'); assert.equal(vat(mixed, 1), 1);
  itemLoc(mixed, 'barley_malt', 'brewing_vat_1'); assert.equal(vat(mixed, 1), 2);
  // Only the prerequisite quest stage/items are seeded; brewing state is earned.
  mixed.setVarBit(id('VarBitType', 'forget_quest'), 10);
  give(mixed, 'kelda_hops'); give(mixed, 'ale_yeast');
  itemLoc(mixed, 'kelda_hops', 'brewing_vat_1'); assert.equal(vat(mixed, 1), 68);
  itemLoc(mixed, 'ale_yeast', 'brewing_vat_1'); assert.equal(vat(mixed, 1), 69);
  const keldaClock = mixed.getVar(id('VarPlayerType', 'forget_clock'));
  minute += 12;
  let firstMessage = mixed.messages.length;
  operate(mixed, 'vat_valve_1');
  assert.deepEqual(mixed.messages.slice(firstMessage), ['Empty the barrel before turning the valve.']);
  assert.equal(vat(mixed, 1), 71, 'refused Kelda transfer preserves the finished stout');
  assert.equal(barrel(mixed, 1), 16, 'refused Kelda transfer preserves all eight ordinary pints');
  assert.equal(mixed.getVar(id('VarPlayerType', 'forget_clock')), keldaClock, 'refusal preserves the Kelda clock');
  give(mixed, 'beer_glass', 8);
  for (let pint = 0; pint < 8; pint++) itemLoc(mixed, 'beer_glass', 'brewing_barrel_1');
  assert.equal(count(mixed, 'asgarnian_ale'), 8, 'all eight preserved ordinary pints remain collectible');
  assert.equal(barrel(mixed, 1), 0);
  operate(mixed, 'vat_valve_1');
  assert.equal(vat(mixed, 1), 0, 'Kelda stout transfers after the ordinary barrel is emptied');
  assert.equal(barrel(mixed, 1), 3);
  assert.equal(mixed.getVar(id('VarPlayerType', 'forget_clock')) & 0x7ffffff, 0);
  // The opposite ownership order must use the ordinary valve's refusal message.
  mixed.setVarBit(id('VarBitType', 'forget_quest'), 11);
  give(mixed, 'bucket_water', 2); give(mixed, 'barley_malt', 2);
  give(mixed, 'hammerstone_hops', 4); give(mixed, 'ale_yeast');
  for (const ingredient of ['bucket_water', 'barley_malt', 'hammerstone_hops', 'ale_yeast'])
    itemLoc(mixed, ingredient, 'brewing_vat_1');
  assert.equal(vat(mixed, 1), 5);
  minute += 640 * 3; proc(mixed, 'brewing_update_all');
  assert.equal(vat(mixed, 1), 7, 'ordinary stout is ready while the Kelda barrel is occupied');
  const blockedXp = mixed.stats[PlayerStat.COOKING];
  firstMessage = mixed.messages.length;
  operate(mixed, 'vat_valve_1');
  assert.deepEqual(mixed.messages.slice(firstMessage), ['Empty the barrel before turning the valve.'],
    'ordinary vat never reports that Kelda stout is still fermenting');
  assert.equal(vat(mixed, 1), 7); assert.equal(barrel(mixed, 1), 3);
  assert.equal(mixed.stats[PlayerStat.COOKING], blockedXp, 'refused ordinary transfer awards no XP');
  give(mixed, 'beer_glass');
  itemLoc(mixed, 'beer_glass', 'brewing_barrel_1');
  assert.equal(count(mixed, 'kelda_stout'), 1); assert.equal(barrel(mixed, 1), 0);
  operate(mixed, 'vat_valve_1');
  assert.equal(vat(mixed, 1), 0); assert.equal(barrel(mixed, 1), 8, 'ordinary batch transfers after collecting Kelda stout');
  // Exact complete outcome weights, including both inclusive boundary edges.
  const outcomes = { bad: 0, mature: 0, normal: 0 };
  for (let r = 0; r < 128; r++) {
    minute = 640 * 50000 + 1;
    const p = player(); loadBatch(p, 2, 0);
    minute = 640 * 50003; roll = r;
    proc(p, 'brewing_update_all');
    const state = vat(p, 2);
    if (state === 64) outcomes.bad++;
    else if (state === 8) outcomes.mature++;
    else { assert.equal(state, 7); outcomes.normal++; }
    proc(p, 'brewing_update_all'); assert.equal(vat(p, 2), state, 'finished quality never rerolls');
  }
  assert.deepEqual(outcomes, { bad: 16, mature: 6, normal: 106 });
  for (const index of [0, 9]) {
    minute = 640 * 50000 + 1; const p = player(); loadBatch(p, 2, index);
    minute = 640 * 50003; roll = 0; proc(p, 'brewing_update_all');
    assert.equal(vat(p, 2), index === 9 ? 65 : 64);
    operate(p, 'vat_valve_2');
    assert.equal(vat(p, 2), 0, 'bad drink leaves vat');
    assert.equal(barrel(p, 2), index === 9 ? 2 : 1, 'original bad barrel morph');
    operate(p, 'brewing_barrel_2');
    assert.equal(barrel(p, 2), 0, 'bad barrel drains cleanly');
  }
  // Ordinary range cooking and knife dispatch remain functional alongside malt/kegs.
  JavaRandom.nextDouble = randomDouble; // Do not constrain unrelated Cooking RNG.
  const p = player(); give(p, 'barley', 2);
  itemLoc(p, 'barley', 'rimmington_poor_range'); itemLoc(p, 'barley', 'rimmington_poor_range');
  assert.equal(count(p, 'barley_malt'), 2);
  for (const reverse of [false, true]) {
    give(p, 'calquat_fruit'); if (!count(p, 'knife')) give(p, 'knife');
    assert(use(p, reverse ? 'calquat_fruit' : 'knife', reverse ? 'knife' : 'calquat_fruit')); finish(p);
  }
  assert.equal(count(p, 'calquat_fruit_keg_empty'), 2, 'knife orientations both hollow calquat');
  give(p, 'raw_beef'); itemLoc(p, 'raw_beef', 'rimmington_poor_range');
  assert.equal(count(p, 'cooked_meat'), 1, 'ordinary Cooking is unchanged');
  give(p, 'dramen_branch');
  assert(use(p, 'dramen_branch', 'knife')); finish(p);
  assert.equal(count(p, 'dramen_staff'), 1, 'ordinary knife case still works');
  // Mature production, two four-pint kegs, and native one-pint drinking stages.
  JavaRandom.nextDouble = () => (roll + 0.5) / 128;
  minute = 640 * 50000 + 1; roll = 16; loadBatch(p, 2, 0);
  minute = 640 * 50003; proc(p, 'brewing_update_all');
  JavaRandom.nextDouble = randomDouble;
  const xp = p.stats[PlayerStat.COOKING]; operate(p, 'vat_valve_2');
  assert.equal(p.stats[PlayerStat.COOKING] - xp, recipes[0][5] * 10, 'mature XP');
  itemLoc(p, 'calquat_fruit_keg_empty', 'brewing_barrel_2');
  itemLoc(p, 'calquat_fruit_keg_empty', 'brewing_barrel_2');
  assert.equal(barrel(p, 2), 0); assert.equal(count(p, 'keg_mature_dwarven_stout_4'), 2);
  for (let dose = 4; dose > 0; dose--) {
    p.setVar(id('VarPlayerType', 'eat_delay'), 0);
    assert(held(p, `keg_mature_dwarven_stout_${dose}`, 1)); finish(p);
    if (dose > 1) assert.equal(count(p, `keg_mature_dwarven_stout_${dose - 1}`), 1);
  }
  assert.equal(count(p, 'calquat_fruit_keg_empty'), 1);
  assert.equal(p.levels[PlayerStat.MINING], 101, 'mature stout boosts Mining by two');
  // Every mature recipe at both breweries also supports mixed vessels and
  // refuses a four-pint keg when only three pints remain, without losing it.
  JavaRandom.nextDouble = () => (roll + 0.5) / 128;
  for (const site of [1, 2]) for (let index = 0; index < recipes.length; index++) {
    const q = player(), target = `brewing_barrel_${site}`;
    minute = 640 * 50000 + 1; roll = 21; loadBatch(q, site, index);
    minute = 640 * 50003; proc(q, 'brewing_update_all');
    assert.equal(vat(q, site), 8 + index * 6);
    const xp = q.stats[PlayerStat.COOKING];
    operate(q, `vat_valve_${site}`);
    assert.equal(q.stats[PlayerStat.COOKING] - xp, recipes[index][5] * 10);
    give(q, 'beer_glass', 4); give(q, 'calquat_fruit_keg_empty', 2);
    itemLoc(q, 'beer_glass', target); itemLoc(q, 'calquat_fruit_keg_empty', target);
    const remaining = barrel(q, site);
    itemLoc(q, 'calquat_fruit_keg_empty', target);
    assert.equal(barrel(q, site), remaining, 'three pints cannot fill a keg');
    assert.equal(count(q, 'calquat_fruit_keg_empty'), 1, 'refused keg retained');
    for (let pint = 0; pint < 3; pint++) itemLoc(q, 'beer_glass', target);
    assert.equal(barrel(q, site), 0);
    assert.equal(count(q, `mature_${recipes[index][0]}`), 4);
    assert.equal(count(q, `keg_mature_${recipes[index][0]}_4`), 1);
  }
  JavaRandom.nextDouble = randomDouble;
  const boosts = [
    [PlayerStat.MINING, 1, 2], [PlayerStat.STRENGTH, 2, 3],
    [PlayerStat.HERBLORE, 1, 2], [PlayerStat.MAGIC, 3, 4],
    [PlayerStat.STRENGTH, 2, 3], [PlayerStat.HITPOINTS, 4, 6],
    [PlayerStat.WOODCUTTING, 1, 2], [PlayerStat.COOKING, 5, 6],
    [PlayerStat.SLAYER, 1, 4], [PlayerStat.FARMING, 2, 3]
  ];
  for (let index = 0; index < recipes.length; index++) for (const mature of [false, true]) {
    const name = `${mature ? 'mature_' : ''}${recipes[index][0]}`;
    const q = player(); give(q, name); q.levels[PlayerStat.HITPOINTS] = 50;
    assert(held(q, name, 1)); finish(q);
    assert.equal(count(q, name), 0, `${name}: actual Drink works`);
    assert.equal(count(q, 'beer_glass'), 1, `${name}: returns glass`);
    const [stat, normal, strong] = boosts[index];
    assert.equal(q.levels[stat], (stat === PlayerStat.HITPOINTS ? 50 : 99) + (mature ? strong : normal), `${name}: drink effect`);
    const keg = player(); give(keg, `keg_${name}_4`);
    for (let dose = 4; dose > 0; dose--) {
      keg.setVar(id('VarPlayerType', 'eat_delay'), 0);
      assert(held(keg, `keg_${name}_${dose}`, 1)); finish(keg);
      assert.equal(count(keg, dose > 1 ? `keg_${name}_${dose - 1}` : 'calquat_fruit_keg_empty'), 1, `${name}: keg dose ${dose}`);
    }
  }
  console.log('PASS brewing: both breweries, ten recipes, exact 128 quality rolls, native clock/save/load, valve, glasses/kegs, drinking, cooking and knife controls');
} finally {
  JavaRandom.nextDouble = randomDouble;
  if (originDescriptor) Object.defineProperty(performance, 'timeOrigin', originDescriptor); else delete performance.timeOrigin;
  if (nowDescriptor) Object.defineProperty(performance, 'now', nowDescriptor); else delete performance.now;
}
// World owns maintenance timers; this offline test does not run a live server.
process.exit(0);
