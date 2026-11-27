import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { quests, value } from '../quest-points/registry.mjs';
import { engine } from '../regicide-travel/runtime.mjs';
import { World, types, player, id, obj, inv, worn, bank, com, bit, setBit, setVar, run, capture, nativeLoc, operate, position, tile, skill, give, count, clear, equip, text, load, ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType } from '../rfd-s1/runtime.mjs';
const { ProtectedActivePlayer } = await import(pathToFileURL(path.join(engine, 'src/engine/script/ScriptPointer.ts')).href);
const { PlayerLoading } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerLoading.ts')).href);
const { NpcStat } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/NpcStat.ts')).href);
const Packet = await load('io/Packet.ts');
const JavaRandom = await load('util/JavaRandom.ts');
const IfButton = await load('network/game/client/model/IfButton.ts');
const IfButtonHandler = await load('network/game/client/handler/IfButtonHandler.ts');
const OpHeld = await load('network/game/client/model/OpHeld.ts');
const OpHeldHandler = await load('network/game/client/handler/OpHeldHandler.ts');
const OpLoc = await load('network/game/client/model/OpLoc.ts');
const OpLocHandler = await load('network/game/client/handler/OpLocHandler.ts');
const InvButton = await load('network/game/client/model/InvButton.ts');
const InvButtonHandler = await load('network/game/client/handler/InvButtonHandler.ts');
const pv = name => id('VarPlayerType', name);
const nv = name => id('VarNpcType', name);
const variable = (p, name) => p.getVar(pv(name));
const result = (p, name, args = [], target = null) => run(p, name, { args, target }).popInt();
const points = p => result(p, '[proc,count_questpoints]');
function fixture(p, rows) {
  for (const [name, amount] of rows) {
    if (types.VarBitType.getByName(name)) setBit(p, name, amount);
    else setVar(p, name, amount);
  }
}
const guestRows = [
  ['hundred_dwarf_quest', '100dwarfvisible', 10], ['100goblin', '100goblinsvisible', 10],
  ['100_pirate_quest_var', '100piratevisible', 10], ['100guide_prog', '100guidevisible', 10],
  ['hundred_dave_main', '100davevisible', 7], ['100_ogre_prog', '100ogrevisible', 10],
  ['chickenquest', '100amikvisible', 10], ['hundred_ilm_quest', '100monkeyvisible', 10]
];
function allGuests(p) {
  setBit(p, 'hundred_main_quest_var', 4);
  setBit(p, 'hundred_subquest_tally', 8);
  for (const [stage, visible, complete] of guestRows) { setBit(p, stage, complete); setBit(p, visible, 0); }
}
// Build the requested QP fixture from current registry rows and the compiled
// counter. No unrelated publish's maximum QP total is stored in this suite.
const counterProbe = player();
const contributions = [];
for (const quest of quests) {
  if (quest.fixture.some(([name]) => name === 'deserttreasure' || name === 'horrorquest')) continue;
  counterProbe.vars.fill(0);
  fixture(counterProbe, quest.fixture);
  const amount = points(counterProbe);
  if (amount > 0) contributions.push({ rows: quest.fixture, amount });
}
function seedPoints(p, wanted) {
  fixture(p, [['deserttreasure', value('dt_stage_complete')], ['horrorquest', value('horror_complete')]]);
  const needed = wanted - points(p);
  const sums = new Map([[0, []]]);
  for (const row of contributions) {
    for (const [sum, used] of [...sums]) {
      if (sum + row.amount <= needed && !sums.has(sum + row.amount)) sums.set(sum + row.amount, [...used, row]);
    }
  }
  assert(sums.has(needed), `current quest registry supplies a ${wanted}-QP fixture`);
  for (const row of sums.get(needed)) fixture(p, row.rows);
  assert.equal(points(p), wanted, 'the compiled counter confirms the fixture');
}
const p = player();
allGuests(p);
assert.equal(points(p), 9, 'intro plus eight guests, before the finale');
seedPoints(p, 174);
assert.equal(result(p, '[proc,rfd_finale_gate]'), 0, '174 QP blocks the finale');
const addOne = contributions.find(row => row.amount === 1 && row.rows.every(([name]) => {
  const type = types.VarBitType.getByName(name); return type ? p.getVarBit(type.id) === 0 : variable(p, name) === 0;
}));
assert(addOne, 'one currently incomplete one-QP quest supplies the boundary fixture');
fixture(p, addOne.rows);
assert.equal(points(p), 175);
assert.equal(result(p, '[proc,rfd_finale_gate]'), 1, 'exactly 175 QP admits the finale');
const entryVars = p.vars.slice();
for (const row of contributions) fixture(p, row.rows);
for (const [name, restore] of [['deserttreasure', value('dt_stage_complete')], ['horrorquest', value('horror_complete')]]) {
  fixture(p, [[name, 0]]);
  assert(points(p) >= 175, 'the missing-prerequisite case independently satisfies the QP gate');
  assert.equal(result(p, '[proc,rfd_finale_gate]'), 0, `missing ${name} blocks entry`);
  fixture(p, [[name, restore]]);
}
for (let index = 0; index < entryVars.length; index++) p.vars[index] = entryVars[index];
assert.equal(points(p), 175, 'restore the exact entry fixture after independent prerequisite checks');
setBit(p, 'hundred_subquest_tally', 7);
assert.equal(result(p, '[proc,rfd_finale_gate]'), 0, 'seven guests cannot enter');
setBit(p, 'hundred_subquest_tally', 8);
setBit(p, 'hundred_main_quest_var', 3);
run(p, '[proc,rfd_finale_unlock]');
assert.equal(bit(p, 'hundred_main_quest_var'), 4, 'eighth rescue opens the original stage-four portal');
const portal = nativeLoc('hundred_portal_multi');
const portalType = types.LocType.get(portal.type);
assert.equal(portalType.multiloc[4], id('LocType', 'hundred_portal_active'));
const kitchenApproach = [portal.level, portal.x, portal.z - 1];
position(p, kitchenApproach);
assert.equal(p.inOperableDistance(portal), false, 'the original kitchen wall blocks rectangular operation from the native client endpoint');
const banquetApproach = [portal.level, portal.x - 1, portal.z];
const feastDoor = nativeLoc('hundred_lumbridge_door', rows => rows.find(row => row.x > 3000));
for (const stage of [4, 5]) {
  const visitor = player();
  setBit(visitor, 'hundred_main_quest_var', stage);
  operate(visitor, feastDoor, 1, { from: [0, 3207, 3216] });
  assert.deepEqual(tile(visitor), banquetApproach, `stage${stage} native Open enters the original banquet room beside its portal`);
  assert(visitor.inOperableDistance(portal), 'the banquet landing permits native portal operation');
  operate(visitor, feastDoor, 1, { from: [feastDoor.level, feastDoor.x, feastDoor.z + 1] });
  assert.deepEqual(tile(visitor), [0, 3207, 3216], `stage${stage} native Open also exits the original banquet room`);
}
const category = types.NpcType.getByName('hundred_minion1').category;
function enemies(p) { return [...World.npcs].filter(n => n.isActive && types.NpcType.get(n.type).category === category && n.getVar(nv('npc_attacking_uid')) === p.uid); }
function enter(p) {
  operate(p, portal, 1, { from: banquetApproach });
  World.processNpcEventQueue();
  assert(variable(p, 'rfd_finale_uid') > 0);
  assert.equal(result(p, '[proc,rfd_finale_inside]'), 1);
  assert.equal(enemies(p).length, 1, 'native portal summons exactly the next opponent');
}
function npcRun(p, actor, trigger, args = []) {
  const type = types.NpcType.get(actor.type);
  const script = ScriptProvider.getByTrigger(ServerTriggerType[trigger], actor.type, type.category);
  assert(script, `compiled ${trigger} for ${type.debugname}`);
  const state = ScriptRunner.init(script, actor, p, args);
  state.pointerAdd(ProtectedActivePlayer[0]);
  actor.executeScript(state);
  assert.equal(state.execution, ScriptState.FINISHED, `${script.name} completes`);
  return state;
}
function settleNpc(actor) {
  for (let i = 0; i < 80; i++) {
    if (!actor.activeScript && actor.queue.head() === null) return;
    World.currentTick = Math.max(World.currentTick + 1, actor.delayedUntil);
    actor.delayed = false;
    actor.processQueue();
    if (actor.activeScript) actor.executeScript(actor.activeScript);
  }
  assert.fail('native NPC death queue did not settle');
}
function settlePlayer(p) {
  for (let i = 0; i < 20; i++) { World.currentTick++; p.delayed = false; p.processQueues(); }
  World.processNpcEventQueue();
}
function exit(p) {
  const baseX = p.x - 12, baseZ = p.z - 6;
  const door = World.getLoc(baseX + 1, baseZ + 11, 2, id('LocType', 'hundred_exit_portal'));
  assert(door, 'the copied original portal exists');
  position(p, [2, baseX + 2, baseZ + 11]);
  capture(p, () => { assert(new OpLocHandler().handle(new OpLoc(1, door.x, door.z, door.type), p)); p.processInteraction(); });
  assert.equal(variable(p, 'rfd_finale_uid'), 0);
  assert.deepEqual(tile(p), [0, 3207, 3216]);
}
setVar(p, 'prayer14', 1);
enter(p);
assert.equal(variable(p, 'prayer14'), 0, 'entry deactivates pre-existing protection');
capture(p, () => assert(new IfButtonHandler().handle(new IfButton(com('prayer:prayer_protectfrommelee')), p)));
assert.equal(variable(p, 'prayer14'), 0, 'a real prayer button cannot reactivate prayers inside');
const foreign = player();
position(foreign, tile(p));
assert.equal(result(foreign, '[proc,npc_is_attackable]', [], enemies(p)[0]), 0, 'a foreign account cannot attack the owned boss');
exit(p);
assert.equal(bit(p, 'hundred_minionskilled_tally'), 0, 'retreat without a kill cannot advance a wave');
enter(p);
const uidBefore = variable(p, 'rfd_finale_uid');
const saved = p.save();
const loaded = PlayerLoading.load(p.username, new Packet(saved), null);
assert.deepEqual(tile(loaded), [0, 3207, 3216], 'real save/load uses the private region exit');
assert.equal(variable(loaded, 'rfd_finale_uid'), 0, 'the runtime UID is not saved');
assert.equal(bit(loaded, 'hundred_minionskilled_tally'), 0);
run(p, '[proc,player_teleport_normal]', { args: [(0 << 28) | (3207 << 14) | 3216] });
assert.deepEqual(tile(p), [0, 3207, 3216], 'the real ordinary teleport leaves the private region');
assert.equal(variable(p, 'rfd_finale_uid'), 0, 'ordinary teleport cleanup releases the instance');
assert(uidBefore > 0);
enter(p);
p.levels[3] = 0;
run(p, '[queue,player_death_default]');
assert.equal(variable(p, 'rfd_finale_uid'), 0, 'ordinary player death releases the encounter');
assert.equal(bit(p, 'hundred_minionskilled_tally'), 0);
skill(p, 'hitpoints', 99);
assert.equal(p.level, 0);
enter(p);
const expected = ['hundred_minion1', 'hundred_minion2', 'hundred_minion3', 'hundred_minion4', 'hundred_minion5_air', 'hundred_culinaromancer_final'];
const name = n => types.NpcType.get(n.type).debugname;
for (let wave = 0; wave < expected.length; wave++) {
  const actor = enemies(p)[0];
  assert.equal(name(actor), expected[wave]);
  const type = types.NpcType.get(actor.type);
  assert.equal(actor.levels[NpcStat.HITPOINTS], type.stats[NpcStat.HITPOINTS], 'boss spawns at its unchanged original HP');
  if (wave === 2 || wave === 3) {
    const beforeHp = p.levels[3], beforeAttack = p.levels[0];
    setVar(p, 'sa_energy', 1000);
    actor.setVar(nv('npc_action_delay'), World.currentTick);
    const original = JavaRandom.nextDouble;
    let draw = 0;
    JavaRandom.nextDouble = () => [0.999999, 0, 0.999999][draw++ % 3];
    try { npcRun(p, actor, 'AI_APPLAYER2'); } finally { JavaRandom.nextDouble = original; }
    settlePlayer(p);
    assert.equal(beforeHp - p.levels[3], 5, 'the native magic impact deals its configured five damage');
    if (wave === 2) {
      assert.equal(p.levels[0], beforeAttack - 1, 'Karamel drains the real Attack level');
      assert.equal(variable(p, 'sa_energy'), 900, 'Karamel drains real special-attack energy');
      assert(variable(p, 'frozen') > 0, 'Karamel applies the shared native walking freeze');
      position(p, [actor.level, actor.x - 1, actor.z]);
      actor.setVar(nv('npc_action_delay'), World.currentTick);
      const hp = p.levels[3];
      npcRun(p, actor, 'AI_APPLAYER2');
      settlePlayer(p);
      assert.equal(p.levels[3], hp, 'adjacent Karamel cannot damage the player');
      setVar(p, 'frozen', 0);
      position(p, [actor.level, actor.x, actor.z - 8]);
    } else assert.equal(p.levels[0], beforeAttack, 'Dessourt magic does not invent a stat drain');
  }
  if (wave === 1) {
    give(p, 'bronze_sword'); equip(p, 'bronze_sword');
    assert.equal(World.getObj(p.x, p.z, p.level, obj('bronze_sword'), p.hash64), null);
    run(p, '[proc,rfd_finale_disarm]', { target: actor });
    assert.equal(count(p, 'bronze_sword', worn), 0, 'Flambeed removes the actual equipped weapon');
    assert.equal(count(p, 'bronze_sword'), 1, 'a free inventory slot receives the disarmed weapon');
    assert.equal(World.getObj(p.x, p.z, p.level, obj('bronze_sword'), p.hash64), null, 'free-space disarm creates no ground drop');
    equip(p, 'bronze_sword');
    clear(p); give(p, 'shrimp', p.getInventory(inv).capacity);
    assert.equal(count(p, 'shrimp'), p.getInventory(inv).capacity, 'the drop fallback starts with a completely full inventory');
    run(p, '[proc,rfd_finale_disarm]', { target: actor });
    assert.equal(count(p, 'bronze_sword', worn), 0, 'full-inventory disarm also removes the weapon');
    assert.equal(count(p, 'bronze_sword'), 0, 'full inventory cannot receive the weapon');
    const droppedWeapon = World.getObj(p.x, p.z, p.level, obj('bronze_sword'), p.hash64);
    assert(droppedWeapon, 'full-inventory disarm preserves the weapon as the player-owned native ground drop');
    assert.equal(droppedWeapon.count, 1);
    clear(p); give(p, 'ice_gloves'); equip(p, 'ice_gloves'); give(p, 'bronze_sword'); equip(p, 'bronze_sword');
    run(p, '[proc,rfd_finale_disarm]', { target: actor });
    assert.equal(count(p, 'bronze_sword', worn), 1, 'ice gloves preserve the weapon');
    give(p, 'shrimp', p.getInventory(inv).capacity);
    run(p, '[proc,rfd_finale_disarm]', { target: actor });
    assert.equal(count(p, 'bronze_sword', worn), 1, 'ice gloves also prevent full-inventory disarm');
    assert.equal(World.getObj(p.x, p.z, p.level, obj('bronze_sword'), p.hash64), droppedWeapon, 'ice-glove immunity adds no further ground weapon');
    clear(p);
  }
  if (wave === 4) {
    const phases = [
      ['hundred_minion5_air', value('wind_blast')], ['hundred_minion5_water', value('water_blast')], ['hundred_minion5_melee', 0],
      ['hundred_minion5_earth', value('earth_blast')], ['hundred_minion5_fire', value('fire_blast')], ['hundred_minion5_ranged', 0]
    ];
    const maximum = 20;
    actor.levels[NpcStat.HITPOINTS] -= 5;
    for (const [phase, spell] of phases) {
      assert.equal(name(actor), phase, 'native phase timer follows the period order');
      setVar(p, 'damagetype', value(phase.endsWith('ranged') ? 'ranged_style' : 'crush_style'));
      assert.equal(result(p, '[proc,npc_max_dealt]', [maximum, spell], actor), maximum, `${phase} accepts the period weakness`);
      assert.equal(result(p, '[proc,npc_max_dealt]', [maximum, 41], actor), 0, `${phase} rejects an unrelated spell before XP`);
      const tracked = phase !== 'hundred_minion5_water';
      setVar(p, 'aggressive_npc', tracked ? actor.uid : -1);
      setVar(p, 'lastcombat', World.currentTick);
      assert.equal(result(p, '[proc,player_in_combat_check]', [], actor), 1, 'the owned opponent is admitted before its colour changes');
      const previousUid = actor.uid;
      npcRun(p, actor, 'AI_TIMER');
      assert.equal(actor.levels[NpcStat.HITPOINTS], type.stats[NpcStat.HITPOINTS] - 5, 'native colour changes preserve damage');
      assert.notEqual(actor.uid, previousUid, 'native type changes also change the encoded NPC UID');
      assert.equal(variable(p, 'aggressive_npc'), tracked ? actor.uid : -1, 'colour change preserves this opponent only, not a cleared combat target');
      assert.equal(result(p, '[proc,player_in_combat_check]', [], actor), 1, 'the real single-combat guard does not mistake the next colour for another opponent');
    }
  }
  // Authored death-queue vector: real portal spawn, native lethal damage queue,
  // actual hero resolution and native owner credit. The headed case supplies
  // the complementary full-health player-combat proof without damage seeding.
  actor.heroPoints.addHero(p.hash64, actor.levels[NpcStat.HITPOINTS]);
  actor.enqueueScript(ServerTriggerType.AI_QUEUE2, 0, actor.levels[NpcStat.HITPOINTS]);
  settleNpc(actor);
  settlePlayer(p);
  assert.equal(bit(p, 'hundred_minionskilled_tally'), wave + 1, 'only the killed native wave advances the persistent tally');
  if (wave === 0) {
    // The new wave's spawn and the owner's current entry tile are unchanged.
    exit(p);
    assert.equal(bit(p, 'hundred_minionskilled_tally'), 1);
    const retrySave = PlayerLoading.load(p.username, new Packet(p.save()), null);
    assert.equal(bit(retrySave, 'hundred_minionskilled_tally'), 1, 'earned wave credit survives real save/load');
    enter(p);
  }
}
assert.equal(bit(p, 'hundred_main_quest_var'), 5);
assert.equal(variable(p, 'rfd_finale_uid'), 0);
assert.equal(points(p), 176, 'the finale adds the tenth RFD point to the 175-QP entry account');
const onlyRfd = player(); allGuests(onlyRfd); setBit(onlyRfd, 'hundred_main_quest_var', 5);
assert.equal(points(onlyRfd), 10, 'complete RFD contributes exactly ten QP');
assert.equal(count(p, 'hundred_rewardlamp'), 1, 'victory delivers one original antique lamp');
run(p, '[proc,rfd_lamp_give]');
assert.equal(count(p, 'hundred_rewardlamp'), 1, 'claimed lamp cannot be duplicated');
assert.equal(types.ObjType.get(obj('hundred_rewardlamp')).tradeable, false);
assert.equal(result(p, '[proc,bank_find_obj_unbankable]', [obj('hundred_rewardlamp')]), 0, 'later-source bankability is preserved');
function button(p, name) { capture(p, () => assert(new IfButtonHandler().handle(new IfButton(com(name)), p))); }
function rub(p, name) {
  const slot = p.getInventory(inv).getItemIndex(obj(name)); assert(slot >= 0);
  capture(p, () => assert(new OpHeldHandler().handle(new OpHeld(1, obj(name), slot, com('inventory:inv')), p)));
}
skill(p, 'cooking', 50);
rub(p, 'hundred_rewardlamp'); button(p, 'xplamp:cooking');
const before = p.stats[7];
button(p, 'xplamp:confirm');
assert.equal(p.stats[7], before, 'base level 50 does not satisfy above level 50');
assert.equal(count(p, 'hundred_rewardlamp'), 1);
skill(p, 'cooking', 51);
const xp = p.stats[7];
button(p, 'xplamp:confirm');
assert.equal(p.stats[7] - xp, 200000, 'base level 51 receives exactly 20,000 XP in tenths');
assert.equal(count(p, 'hundred_rewardlamp'), 0);
run(p, '[proc,rfd_lamp_give]'); assert.equal(count(p, 'hundred_rewardlamp'), 0);
const full = player(); allGuests(full); setBit(full, 'hundred_main_quest_var', 5);
for (let i = 0; i < 28; i++) full.getInventory(inv).set(i, { id: obj('shark'), count: 1 });
run(full, '[proc,rfd_lamp_give]');
assert.equal(bit(full, 'hundred_finale_warning_spam'), 0, 'full inventory preserves the unclaimed entitlement');
clear(full); run(full, '[label,rfd_lamp_claim]');
assert.equal(count(full, 'hundred_rewardlamp'), 1); run(full, '[label,rfd_lamp_claim]'); assert.equal(count(full, 'hundred_rewardlamp'), 1);
const chest = nativeLoc('hundred_goodchest');
for (const [operation, prefix] of [[2, 'hundred_foodchest'], [3, 'hundred_rewardchest']]) {
  operate(p, chest, operation);
  assert.equal(variable(p, 'shop'), id('InvType', `${prefix}10`));
}
const shopItems = p.getInventory(variable(p, 'shop'));
const gloves = obj('hundred_gauntlets_level_10'), slot = shopItems.getItemIndex(gloves);
assert(slot >= 0, 'tier ten stocks the original Barrows gloves');
for (const tier of [8, 9, 10]) assert.equal(types.ObjType.get(obj(`hundred_gauntlets_level_${tier}`)).tradeable, false, 'S3 reward gloves are explicitly untradeable');
give(p, 'coins', 1000000);
const coins = count(p, 'coins');
capture(p, () => assert(new InvButtonHandler().handle(new InvButton(2, gloves, slot, com('shop_template:inv')), p)));
assert.equal(count(p, 'hundred_gauntlets_level_10'), 1, 'native Buy 1 delivers Barrows gloves');
assert(count(p, 'coins') < coins);
for (const [component, title] of [[8, 'Sir Amik Varze'], [9, 'King Awowogei']]) {
  assert.equal(types.Component.get(com(`recipe_for_disaster:com_${component}`)).buttonType, types.Component.BUTTON);
  button(p, 'questlist:hundred_main'); assert.match(text(p), /Quest complete/);
  button(p, `recipe_for_disaster:com_${component}`); assert.match(text(p), new RegExp(title)); assert.match(text(p), /GUEST RESCUED/);
}
assert.equal(types.Component.get(com('recipe_for_disaster:com_10')).buttonType, types.Component.CLOSE_BUTTON);
console.log('PASS RFD S3 finale gates, original arena, six death-credit waves, isolation, retreat/death/save recovery, 10 QP, lamp, tier-ten native purchase and journals');
process.exit(0);
