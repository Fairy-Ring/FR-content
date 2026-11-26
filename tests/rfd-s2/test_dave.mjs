import assert from 'node:assert/strict';
import {
  World, types, PlayerStat, nativeLocRows, nativeLoc, nativeNpc, player, position, tile,
  id, obj, inv, bank, com, bit, setBit, setVar, skill, count, give, run, talk, operate,
  useLoc, useItems, remove, text, load, stand, capture, showNpc, walkable
} from '../rfd-s1/runtime.mjs';
const OpNpcU = await load('network/game/client/model/OpNpcU.ts');
const OpNpcUHandler = await load('network/game/client/handler/OpNpcUHandler.ts');
const OpHeld = await load('network/game/client/model/OpHeld.ts');
const OpHeldHandler = await load('network/game/client/handler/OpHeldHandler.ts');
const OpNpc = await load('network/game/client/model/OpNpc.ts');
const OpNpcHandler = await load('network/game/client/handler/OpNpcHandler.ts');
const JavaRandom = await load('util/JavaRandom.ts');
const npcUse = new OpNpcUHandler();
const itemOp = new OpHeldHandler();
const dave = nativeNpc('hundred_evil_dave');
const doris = nativeNpc('hundred_dave_mum');
const colours = ['red', 'orange', 'brown', 'yellow'];
const stage = p => bit(p, 'hundred_dave_main');
const doses = p => colours.map(c => bit(p, `hundred_dave_${c}`));
const target = p => colours.map(c => bit(p, `hundred_dave_${c}_target`));
const state = p => ({ xp: [...p.stats], qp: p.getVar(id('VarPlayerType', 'qp')), tally: bit(p, 'hundred_subquest_tally') });
function frozen(p) {
  setBit(p, 'hundred_main_quest_var', 3);
  setBit(p, '100davevisible', 1);
  setVar(p, 'fluffs', 6);
  setBit(p, 'agrith_quest', 125);
  skill(p, 'cooking', 25);
  run(p, '[proc,rfd_prepare_banquet]');
  const row = nativeLocRows('hundred_dave_base')[0];
  return World.getLoc(row.x, row.z, row.level, id('LocType', 'hundred_dave_multi'));
}
function useNpc(p, item, actor) {
  stand(p, actor); showNpc(p, actor); p.clearPendingAction();
  const itemId = obj(item), slot = p.getInventory(inv).getItemIndex(itemId);
  assert(slot >= 0);
  assert(npcUse.handle(new OpNpcU(actor.nid, itemId, slot, com('inventory:inv')), p));
  return capture(p, () => p.processInteraction());
}
function eat(p) {
  const slot = p.getInventory(inv).getItemIndex(obj('hundred_dave_stew'));
  assert(slot >= 0);
  p.setVar(id('VarPlayerType', 'action_delay'), 0);
  return capture(p, () => assert(itemOp.handle(new OpHeld(1, obj('hundred_dave_stew'), slot, com('inventory:inv')), p)));
}
function roll(values, fn) {
  const old = JavaRandom.nextDouble; let i = 0;
  JavaRandom.nextDouble = () => values[i++ % values.length];
  try { return fn(); } finally { JavaRandom.nextDouble = old; }
}
function mix(p, recipe, reverse = false) {
  give(p, 'stew');
  for (const [index, colour] of colours.entries()) {
    for (let dose = 0; dose < recipe[index]; dose++) {
      const spice = `hundred_dave_spice_${colour}_1`;
      give(p, spice);
      const base = count(p, 'hundred_dave_stew') ? 'hundred_dave_stew' : 'stew';
      if (reverse) useItems(p, base, spice); else useItems(p, spice, base);
      assert.equal(count(p, 'hundred_dave_spice_empty'), 1);
      remove(p, 'hundred_dave_spice_empty');
    }
  }
  assert.deepEqual(doses(p), recipe);
}

// Ordinary use-item feedback survives the quest and Cooking gates and non-spice inputs.
const defaultUse = player();
run(defaultUse, '[proc,displaymessage]', { args: [0] }); // Confirmed dm_default constant.
const defaultMessages = [...defaultUse.messages];
assert(defaultMessages.length, 'ordinary default use-item message is nonempty');
for (const [progress, cooking, item] of [[0, 25, 'hundred_dave_spice_red_1'], [4, 24, 'hundred_dave_spice_red_1'], [4, 25, 'bucket_milk']]) {
  const q = player();
  setBit(q, 'hundred_dave_main', progress);
  skill(q, 'cooking', cooking);
  give(q, 'stew'); give(q, item);
  useItems(q, item, 'stew');
  assert.deepEqual(q.messages, defaultMessages, `ordinary stew fallback at Dave stage ${progress}, Cooking ${cooking}, item ${item}`);
  assert.equal(count(q, 'stew'), 1);
  assert.equal(count(q, item), 1);
  assert.equal(count(q, 'hundred_dave_stew'), 0);
  assert.deepEqual(doses(q), [0, 0, 0, 0]);
}

for (const missing of ['fluffs', 'agrith_quest', 'cooking']) {
  const p = player(), guest = frozen(p);
  if (missing === 'fluffs') setVar(p, 'fluffs', 5);
  if (missing === 'agrith_quest') setBit(p, 'agrith_quest', 124);
  if (missing === 'cooking') skill(p, 'cooking', 24);
  const before = state(p);
  operate(p, guest);
  assert.equal(stage(p), 0, `${missing} prerequisite refuses Inspect`);
  assert.deepEqual(state(p), before);
}
const p = player(), guest = frozen(p);
run(p, '[proc,update_questpoints]');
roll([0.33], () => operate(p, guest));
assert.equal(stage(p), 1);
const hidden = target(p);
assert(hidden.some(Boolean));
assert(hidden.every(n => n >= 0 && n <= 3));
operate(p, guest);
assert.deepEqual(target(p), hidden, 'reinspect never changes the persistent recipe');
talk(p, doris, [2]); assert.equal(stage(p), 1);
talk(p, doris, [1]); assert.equal(stage(p), 2);
const trapdoor = nativeLoc('100_dave_celler_trapdoor');
operate(p, trapdoor); assert.equal(bit(p, 'hundred_dave_trapdoor'), 1);
operate(p, trapdoor); assert.deepEqual(tile(p), [0, 3076, 9894]); walkable(tile(p));
const stairs = nativeLoc('100_dave_celler_stairs');
operate(p, stairs); assert.deepEqual(tile(p), [0, 3077, 3492]); walkable(tile(p));
operate(p, trapdoor, 2); assert.equal(bit(p, 'hundred_dave_trapdoor'), 0);
operate(p, trapdoor); operate(p, trapdoor);
talk(p, dave); assert.equal(stage(p), 3);
talk(p, doris); assert.equal(stage(p), 4);
assert.deepEqual(target(p), hidden);

// All sixteen named dose transitions, both native use directions, cap and banked singleton.
for (const colour of colours) for (let n = 1; n <= 4; n++) {
  const spice = `hundred_dave_spice_${colour}_${n}`;
  give(p, spice); give(p, 'stew');
  if (n % 2) useItems(p, spice, 'stew'); else useItems(p, 'stew', spice);
  assert.equal(bit(p, `hundred_dave_${colour}`), 1);
  const remainder = n === 1 ? 'hundred_dave_spice_empty' : `hundred_dave_spice_${colour}_${n - 1}`;
  assert.equal(count(p, remainder), 1);
  remove(p, remainder);
  assert.equal(count(p, 'hundred_dave_stew'), 1);
  remove(p, 'hundred_dave_stew');
}
mix(p, [3, 0, 0, 0]);
give(p, 'hundred_dave_spice_red_1'); const beforeCap = count(p, 'hundred_dave_spice_red_1');
useItems(p, 'hundred_dave_spice_red_1', 'hundred_dave_stew');
assert.equal(bit(p, 'hundred_dave_red'), 3);
assert.equal(count(p, 'hundred_dave_spice_red_1'), beforeCap);
remove(p, 'hundred_dave_stew'); give(p, 'hundred_dave_stew', 1, bank);
give(p, 'stew'); useItems(p, 'hundred_dave_spice_red_1', 'stew');
assert.equal(count(p, 'hundred_dave_stew'), 0, 'banked stew blocks a second mixed stew');
remove(p, 'hundred_dave_stew', bank);

// Incorrect taste feedback counts equal colours, including zero-dose colours.
const wrong = [...hidden]; wrong[0] = (wrong[0] + 1) % 4;
if (!wrong.some(Boolean)) wrong[1] = 1;
mix(p, wrong);
const matches = wrong.filter((n, i) => n === hidden[i]).length;
useNpc(p, 'hundred_dave_stew', dave);
assert.match(text(p), new RegExp(`${matches} of the four spice amounts are correct`));
assert.equal(count(p, 'hundred_dave_stew'), 0);
assert.deepEqual(doses(p), [0, 0, 0, 0]);
mix(p, hidden, true); useNpc(p, 'hundred_dave_stew', dave);
assert.equal(stage(p), 5); assert.equal(count(p, 'hundred_dave_stew'), 1);
// Lost approved stew is recoverable with normal ingredients and the same hidden recipe.
remove(p, 'hundred_dave_stew'); mix(p, hidden); useNpc(p, 'hundred_dave_stew', dave);
const before = state(p); useLoc(p, 'hundred_dave_stew', guest);
assert.equal(stage(p), 7); assert.equal(bit(p, '100davevisible'), 0);
assert.equal(bit(p, 'hundred_subquest_tally'), before.tally + 1);
assert.equal(p.getVar(id('VarPlayerType', 'qp')), before.qp + 1);
for (let i = 0; i < p.stats.length; i++) assert.equal(p.stats[i] - before.xp[i], i === PlayerStat.COOKING ? 70000 : 0);
const once = state(p); run(p, '[proc,rfd_guest_reward]', { args: [5] }); assert.deepEqual(state(p), once);

// Post-quest stew rolls reach both signed extrema per affected skill and never stack past base+5.
for (const sign of [0.01, 0.99]) {
  skill(p, 'cooking', 50);
  mix(p, [3, 3, 3, 3]);
  for (let i = 0; i < p.levels.length; i++) p.levels[i] = p.baseLevels[i];
  roll([0.99, sign], () => eat(p));
  const delta = sign < 0.5 ? -5 : 5;
  for (const name of ['ATTACK', 'STRENGTH', 'DEFENCE', 'RANGED', 'MAGIC', 'SMITHING', 'CRAFTING', 'FLETCHING', 'RUNECRAFT', 'COOKING', 'FIREMAKING', 'AGILITY', 'SLAYER', 'THIEVING', 'PRAYER', 'WOODCUTTING', 'FARMING', 'FISHING', 'MINING', 'HERBLORE']) {
    assert.equal(p.levels[PlayerStat[name]], p.baseLevels[PlayerStat[name]] + delta, `${name} signed dose extremum`);
  }
  assert.equal(count(p, 'hundred_dave_stew'), 0);
  assert.deepEqual(doses(p), [0, 0, 0, 0]);
}
for (const d of [1, 2, 3]) {
  skill(p, 'attack', 50);
  roll([0.99, 0.99], () => run(p, '[proc,rfd_dave_boost]', { args: [PlayerStat.ATTACK, d] }));
  assert.equal(p.levels[PlayerStat.ATTACK], 50 + d * 2 - 1);
}
// Real cat ownership and native Chase-vermin dispatch; deterministic unit rolls, not live seeding.
const hunter = player(), rat = nativeNpc('hundred_dave_hellrat');
setBit(hunter, 'hundred_dave_main', 4);
stand(hunter, rat);
run(hunter, '[proc,cat_spawn]', { args: [id('NpcType', 'growncat_brown')] });
function follower(p) {
  const actor = World.getNpcByUid(p.getVar(id('VarPlayerType', 'follower_uid')));
  assert(actor, 'follower UID names its real active NPC');
  return actor;
}
function chase(p, choices = []) {
  const actor = follower(p);
  stand(p, actor); showNpc(p, actor); p.clearPendingAction();
  const op = actor.type === id('NpcType', 'growncat_hell') ? 4 : 5;
  assert(new OpNpcHandler().handle(new OpNpc(op, actor.nid), p));
  return capture(p, () => p.processInteraction(), choices);
}
roll([0.99], () => chase(hunter));
assert(rat.isActive, 'failed catch leaves the real Hell-Rat alive');
assert.equal(bit(hunter, 'hundred_dave_hellrats_caught'), 0);
for (let catches = 1; catches <= 16; catches++) {
  if (!rat.isActive) World.addNpc(rat, -1, false); // Unit fixture respawn preserves the reserved NPC ID.
  const colour = (catches - 1) % 4, dose = Math.floor((catches - 1) / 4) + 1;
  roll([0, (colour + 0.1) / 4, (dose - 0.9) / 4], () => chase(hunter, catches > 15 ? [1] : []));
  assert.equal(rat.isActive, false, 'successful native action removes the prey');
  assert.equal(bit(hunter, 'hundred_dave_hellrats_caught'), Math.min(7, catches));
  assert.equal((hunter.getVar(id('VarPlayerType', 'cat_growth')) >>> 27) & 15, Math.min(15, catches));
  assert(World.getObj(rat.x, rat.z, rat.level, obj(`hundred_dave_spice_${colours[colour]}_${dose}`), hunter.hash64), 'catch creates the selected private named spice/dose drop');
}
assert.equal(follower(hunter).type, id('NpcType', 'growncat_hell'));
assert.equal(hunter.getVar(id('VarPlayerType', 'follower_obj')), obj('growncatobject_hell'));
assert.equal(bit(hunter, 'hundred_dave_original_cat_colour'), 8, 'brown grown-cat coat survives transformation');
give(hunter, 'bucket_milk');
useNpc(hunter, 'bucket_milk', follower(hunter));
assert.equal(follower(hunter).type, id('NpcType', 'growncat_brown'));
assert.equal(hunter.getVar(id('VarPlayerType', 'follower_obj')), obj('growncatobject_brown'));
assert.equal(bit(hunter, 'hundred_dave_hellrats_caught'), 0);
assert.equal((hunter.getVar(id('VarPlayerType', 'cat_growth')) >>> 27) & 15, 0);
assert.equal(count(hunter, 'bucket_empty'), 1, 'ordinary feeding still consumes milk and gives bucket');
assert.equal(bit(p, 'agrith_quest'), 125, 'Dave never writes Shadow of the Storm state');
run(hunter, '[proc,follower_death]');
const ordinary = player(), ordinaryRat = nativeNpc('rat');
stand(ordinary, ordinaryRat);
run(ordinary, '[proc,cat_spawn]', { args: [id('NpcType', 'growncat')] });
roll([0], () => chase(ordinary));
assert.equal(ordinaryRat.isActive, false, 'ordinary rat hunting remains available without RFD');
assert.equal((ordinary.getVar(id('VarPlayerType', 'cat_growth')) >>> 20) & 127, 1);
assert.equal(bit(ordinary, 'hundred_dave_hellrats_caught'), 0);
run(ordinary, '[proc,follower_death]');
console.log('PASS RFD S2 native Hell-Rat catch/failure, private drop, hellcat and coat-preserving milk reversion');
console.log('PASS RFD S2 Dave native prerequisites, cellar links, 16 dose transitions, persistent matching, recovery, once-only rewards and stew ranges');
process.exit(0);
