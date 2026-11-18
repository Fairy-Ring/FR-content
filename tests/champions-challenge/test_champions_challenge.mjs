#!/usr/bin/env node
// Packed VM regression: native challenge deaths, shared combat hooks, and map routes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  World, types, ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType, PlayerStat,
  Environment, CoordGrid, map, id, objectId, inventoryId, wornId, Obj, EntityLifeCycle,
  makePlayer, makeNpc, removeNpc, resetPlayer, finishPlayer, runProc,
  dispatchNpcTrigger, dispatchPlayerNpc, stack, count, findWorldLoc, runLocOption,
  tickPlayer, engineModule, contentRoot
} from './runtime.mjs';
const { Interaction } = await engineModule('engine/entity/Interaction.ts');
const { default: IfButton } = await engineModule('network/game/client/model/IfButton.ts');
const { default: IfButtonHandler } = await engineModule('network/game/client/handler/IfButtonHandler.ts');
const { default: OpObj } = await engineModule('network/game/client/model/OpObj.ts');
const { default: OpObjHandler } = await engineModule('network/game/client/handler/OpObjHandler.ts');
const { default: OpLoc } = await engineModule('network/game/client/model/OpLoc.ts');
const { default: OpLocHandler } = await engineModule('network/game/client/handler/OpLocHandler.ts');
const { PlayerLoading } = await engineModule('engine/entity/PlayerLoading.ts');
const { default: Packet } = await engineModule('io/Packet.ts');

const raceNames = [
  'earthwarrior', 'ghoul', 'giant', 'goblin', 'hobgoblin', 'imp',
  'jogre', 'lesserdemon', 'skeleton', 'zombie', 'human'
];
const championNpcNames = raceNames.map(name => `champions_${name}`);
const scrollNames = raceNames.slice(0, 10).map(name => `champions_challenge_${name}`);
const championNpcIds = new Set(championNpcNames.map(name => id('NpcType', name)));
const trackedNpcIds = new Set([...championNpcIds, id('NpcType', 'champions_doorman'), id('NpcType', 'cow')]);
const scrollIds = scrollNames.map(objectId);
const defeatedVarp = id('VarPlayerType', 'champions_defeated');
const ownerVarn = id('VarNpcType', 'npc_macro_event_target');
const prayerVarp = id('VarPlayerType', 'prayer14');
const specialVarp = id('VarPlayerType', 'sa_attack');
const damageTypeVarp = id('VarPlayerType', 'damagetype');
const cannonballsVarp = id('VarPlayerType', 'rockthrower');
const actionDelayVarp = id('VarPlayerType', 'action_delay');
const autocastSpellBit = id('VarBitType', 'autocast_spell');
const autocastSetBit = id('VarBitType', 'autocast_set');
const inventory = inventoryId;
const worn = wornId;
const arenaOriginX = 49 * 64;
const arenaOriginZ = 152 * 64;
const arenaArea = [{ level: 0, minX: arenaOriginX, maxX: arenaOriginX + 63, minZ: arenaOriginZ, maxZ: arenaOriginZ + 63 }];
const arenaSpawn = { level: 0, x: arenaOriginX + 32, z: arenaOriginZ + 30 };
const arenaEntry = { level: 0, x: arenaOriginX + 47, z: arenaOriginZ + 29 };
const gallery = { level: 0, x: arenaOriginX + 49, z: arenaOriginZ + 30 };
const statue = { level: 0, x: arenaOriginX + 48, z: arenaOriginZ + 30 };
const basementLadder = { level: 0, x: arenaOriginX + 54, z: arenaOriginZ + 29 };
const larxus = { level: 0, x: 49 * 64 + 51, z: 52 * 64 + 30 };
const surfaceApproach = { level: 0, x: 49 * 64 + 50, z: 52 * 64 + 30 };
const dialogue = new IfButtonHandler();
const locHandler = new OpLocHandler();
const styleFile = path.join(contentRoot, 'scripts/skill_combat/configs/combat_damagetypes.constant');
const spellFile = path.join(contentRoot, 'scripts/skill_combat/configs/magic/spells.constant');

function readConstant(file, name) {
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(new RegExp(`^\\^${name}\\s*=\\s*(-?\\d+)\\s*$`, 'm'));
  assert(match, `missing authored constant ${name} in ${path.relative(contentRoot, file)}`);
  return Number(match[1]);
}
const style = Object.fromEntries(['stab_style', 'slash_style', 'crush_style', 'ranged_style', 'magic_style'].map(name => [name, readConstant(styleFile, name)]));
const windStrike = readConstant(spellFile, 'wind_strike');
const windStrikeComponent = id('Component', 'magic:wind_strike');
const hp = PlayerStat.HITPOINTS;
const player = makePlayer(surfaceApproach);

let passed = 0;
const failures = [];
function test(name, action) {
  try {
    action();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error.stack ?? error}`);
  }
}
function cleanNpcs() {
  for (const npc of [...World.npcs]) {
    if (trackedNpcIds.has(npc.type)) removeNpc(npc);
  }
}
function fresh(position = surfaceApproach, raw = 0) {
  cleanNpcs();
  resetPlayer(player, position);
  player.setVar(defeatedVarp, raw);
  return player;
}
function setCurrent(challenge) {
  runProc('champions_set_current', player, [challenge]);
}
function setEscrow(held) {
  runProc('champions_set_scroll_escrow', player, [held]);
}
function current() {
  return stack(runProc('champions_current', player)).at(-1);
}
function escrow() {
  return stack(runProc('champions_scroll_escrow', player)).at(-1);
}
function booleanProc(name, args = [], target = null) {
  const result = stack(runProc(name, player, args, target));
  assert(result.length > 0, `${name} returned a boolean`);
  return result.at(-1) !== 0;
}
function setChallenge(challenge, position = arenaSpawn, raw = 0) {
  fresh(position, raw);
  setCurrent(challenge);
}
function addItem(itemId, amount = 1, inv = inventory) {
  assert.equal(player.invAdd(inv, itemId, amount), amount, `add ${types.ObjType.get(itemId).debugname}`);
}
function standNear(entity) {
  const candidates = [
    [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]
  ];
  for (const [dx, dz] of candidates) {
    player.level = entity.level;
    player.x = entity.x + dx;
    player.z = entity.z + dz;
    player.originX = player.x;
    player.originZ = player.z;
    if (player.inOperableDistance(entity)) return;
  }
  assert.fail(`no adjacent player tile can operate ${types.NpcType.get(entity.type)?.debugname ?? entity.type}`);
}
function standNearLoc(loc) {
  for (let radius = 0; radius <= 3; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        player.level = loc.level;
        player.x = loc.x + dx;
        player.z = loc.z + dz;
        player.originX = player.x;
        player.originZ = player.z;
        if (!mapBlocked(player.x, player.z, player.level) && player.inOperableDistance(loc)) return;
      }
    }
  }
  assert.fail(`packed collision map has no operable floor around ${types.LocType.get(loc.type).debugname}`);
}
function mapBlocked(x, z, level) {
  return map.isMapBlocked(x, z, level);
}
function chooseDialogue(option) {
  const state = player.activeScript;
  assert.equal(state?.execution, ScriptState.PAUSEBUTTON, 'production dialogue is awaiting a choice');
  const root = types.Component.get(player.modalChat).comName;
  assert.match(root, /^multi[2-5]$/, `choice component ${root}`);
  const buttonId = id('Component', `${root}:com_${option}`);
  assert(player.resumeButtons.includes(buttonId), `${root} offered option ${option}`);
  assert(dialogue.handle(new IfButton(buttonId), player), 'choice is accepted by the real component handler');
  assert.notEqual(state.execution, ScriptState.ABORTED, 'dialogue choice did not abort');
  if (state.execution !== ScriptState.FINISHED && state.execution !== ScriptState.PAUSEBUTTON) {
    finishPlayer(player, state, `choice ${option}`);
  }
  assert.equal(state.execution, ScriptState.FINISHED, `choice ${option} completes the production trigger`);
}
function locByBase(name, position) {
  const typeId = id('LocType', name);
  return findWorldLoc(name, arenaArea).find(loc =>
    loc.level === position.level && loc.x === position.x && loc.z === position.z && loc.baseType === typeId
  );
}
function clickLoc(loc) {
  standNearLoc(loc);
  runLocOption(player, loc, locHandler, OpLoc);
}
function challengeNpc(challenge, position = arenaSpawn) {
  const npc = makeNpc(championNpcNames[challenge - 1], position);
  npc.setVar(ownerVarn, player.uid);
  // Offline death fixtures set HP to zero; provide the hero credit a real hit writes.
  npc.heroPoints.addHero(player.hash64, 1);
  return npc;
}
function dispatchSpellInteraction(npc, trigger, component = -1) {
  player.clearInteraction();
  assert(player.setInteraction(Interaction.ENGINE, npc, trigger, component), `${ServerTriggerType[trigger]} interaction accepted`);
  for (let tick = 0; tick < 12; tick++) {
    tickPlayer(player);
    if (!player.activeScript && !player.hasInteraction()) break;
    assert.notEqual(player.activeScript?.execution, ScriptState.PAUSEBUTTON, 'combat cast does not open dialogue');
  }
  assert(!player.activeScript || player.activeScript.execution === ScriptState.FINISHED || player.activeScript.execution === ScriptState.SUSPENDED,
    'interaction remains in a normal engine state');
}

// The new transient state is deliberately packed into the original permanent varp.
test('current and escrow occupy bits 11-15 without adding varbits or varps', () => {
  fresh(surfaceApproach, 0b10101);
  setCurrent(11);
  setEscrow(1);
  assert.equal(current(), 11);
  assert.equal(escrow(), 1);
  assert.equal(player.getVar(defeatedVarp), 0b10101 | (11 << 11) | (1 << 15));
  setCurrent(0);
  setEscrow(0);
  assert.equal(player.getVar(defeatedVarp), 0b10101, 'clearing transient state preserves permanent bits');
  assert.equal(types.VarBitType.getId('champions_current'), -1, 'no client-visible current varbit was added');
  assert.equal(types.VarBitType.getId('champions_scroll_escrow'), -1, 'no client-visible escrow varbit was added');
  assert.equal(types.VarPlayerType.getId('champions_current'), -1, 'no second varp was added');
});

test('permanent winner bits and the ten-scroll Leon gate use their distinct ranges', () => {
  assert.equal(types.VarPlayerType.get(defeatedVarp).scope, types.VarPlayerType.SCOPE_PERM, 'original winner varp is saved');
  for (let challenge = 1; challenge <= 11; challenge++) {
    fresh(surfaceApproach, 1 << (challenge - 1));
    assert.equal(booleanProc('champions_won', [challenge]), true, `winner ${challenge} reads bit ${challenge - 1}`);
  }
  fresh(surfaceApproach, (1 << 10) | ((1 << 9) - 1));
  assert.equal(booleanProc('champions_ready_for_leon'), false, 'a human win plus only nine scroll champions is not the gate');
  for (let missing = 0; missing < 10; missing++) {
    fresh(surfaceApproach, ((1 << 10) - 1) & ~(1 << missing));
    assert.equal(booleanProc('champions_ready_for_leon'), false, `missing permanent bit ${missing} blocks Leon`);
  }
  fresh(surfaceApproach, (1 << 10) - 1);
  assert.equal(booleanProc('champions_ready_for_leon'), true, 'the ten scroll victories unlock Leon');
});

test('challenge definitions have no direct defeated-varp readers in loc or interface code', () => {
  const root = path.join(contentRoot, 'scripts/minigames/game_champion_challenge');
  const candidates = [path.join(root, 'scripts/champion_locs.rs2')];
  const interfaceRoot = path.join(root, 'interfaces');
  if (fs.existsSync(interfaceRoot)) {
    const visit = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (/\.(?:if|rs2)$/.test(entry.name)) candidates.push(full);
      }
    };
    visit(interfaceRoot);
  }
  for (const file of candidates) {
    const source = fs.readFileSync(file, 'utf8');
    assert(!/%champions_defeated\b/.test(source), `${path.relative(contentRoot, file)} reads the raw state varp`);
  }
});

test('entry restrictions cover prayers, Ghoul escrow items, lesser-demon gear and Leon inventory', () => {
  fresh(arenaSpawn);
  assert.equal(booleanProc('champions_entry_check', [1]), true, 'Earth Warrior is enterable with prayers off');
  player.setVar(prayerVarp, 1);
  assert.equal(booleanProc('champions_entry_check', [1]), false, 'Earth Warrior refuses an active prayer');

  fresh(arenaSpawn);
  addItem(scrollIds[1]);
  assert.equal(booleanProc('champions_entry_check', [2]), true, 'Ghoul accepts its single held scroll');
  addItem(scrollIds[1]);
  assert.equal(booleanProc('champions_entry_check', [2]), false, 'Ghoul refuses a second scroll');
  fresh(arenaSpawn);
  addItem(objectId('airrune'));
  assert.equal(booleanProc('champions_entry_check', [2]), false, 'Ghoul refuses any non-scroll inventory item');
  fresh(arenaSpawn);
  addItem(scrollIds[1]);
  addItem(objectId('bronze_sword'), 1, worn);
  assert.equal(booleanProc('champions_entry_check', [2]), true, 'Ghoul allows its scroll and right-hand weapon');

  fresh(arenaSpawn);
  addItem(objectId('bronze_sword'), 1, worn);
  assert.equal(booleanProc('champions_entry_check', [8]), false, 'Lesser Demon requires no worn equipment');
  fresh(arenaSpawn);
  assert.equal(booleanProc('champions_entry_check', [8]), true, 'Lesser Demon accepts empty worn equipment');
  addItem(objectId('airrune'));
  assert.equal(booleanProc('champions_entry_check', [11]), false, 'Leon refuses inventory items');
  fresh(arenaSpawn);
  assert.equal(booleanProc('champions_entry_check', [11]), true, 'Leon accepts an empty inventory');
});

test('combat-style table blocks only the published race-specific styles', () => {
  const melee = [style.stab_style, style.slash_style, style.crush_style];
  const allStyles = [...melee, style.ranged_style, style.magic_style];
  const allowed = new Map([
    [1, allStyles], [2, allStyles], [3, melee], [4, [style.magic_style]],
    [5, [style.ranged_style, style.magic_style]], [6, allStyles], [7, [...melee, style.magic_style]],
    [8, allStyles], [9, [style.ranged_style]], [10, [...melee, style.ranged_style]], [11, allStyles]
  ]);
  for (let challenge = 1; challenge <= 11; challenge++) {
    for (const attackStyle of allStyles) {
      setChallenge(challenge);
      const npc = challengeNpc(challenge);
      const expected = allowed.get(challenge).includes(attackStyle);
      assert.equal(booleanProc('champions_combat_check', [attackStyle], npc), expected,
        `${raceNames[challenge - 1]} ${attackStyle} restriction`);
      removeNpc(npc);
    }
  }
});

test('combat ownership and arena guards reject wrong and outside attackers but ignore unrelated NPCs', () => {
  setChallenge(1, surfaceApproach);
  const earthwarrior = challengeNpc(1);
  assert.equal(booleanProc('champions_combat_check', [style.stab_style], earthwarrior), false, 'challenge target outside the arena is rejected');
  earthwarrior.setVar(ownerVarn, player.uid + 1);
  assert.equal(booleanProc('champions_combat_check', [style.stab_style], earthwarrior), false, 'wrong owner cannot attack outside the arena');
  removeNpc(earthwarrior);

  setChallenge(1);
  const wrongTarget = challengeNpc(1);
  wrongTarget.setVar(ownerVarn, player.uid + 1);
  assert.equal(booleanProc('champions_combat_check', [style.stab_style], wrongTarget), false, 'the arena does not waive ownership');
  removeNpc(wrongTarget);
  const unrelated = makeNpc('cow', arenaSpawn);
  player.messages.length = 0;
  assert.equal(booleanProc('champions_combat_check', [style.magic_style], unrelated), true, 'unrelated NPC combat is unchanged');
  assert.deepEqual(player.messages, [], 'unrelated NPC receives no challenge rule message');
  removeNpc(unrelated);
});

test('real Larxus dialogue refuses the incomplete gate and accepts Leon after ten wins', () => {
  const nineWinsAndHuman = (1 << 9) - 1 | (1 << 10);
  fresh(surfaceApproach, nineWinsAndHuman);
  const doorman = makeNpc('champions_doorman', larxus);
  standNear(doorman);
  dispatchPlayerNpc(ServerTriggerType.OPNPC1, player, doorman);
  chooseDialogue(2);
  assert.equal(current(), 0, 'incomplete account cannot accept Leon');
  removeNpc(doorman);

  fresh(surfaceApproach, (1 << 10) - 1);
  const larxusNpc = makeNpc('champions_doorman', larxus);
  standNear(larxusNpc);
  dispatchPlayerNpc(ServerTriggerType.OPNPC1, player, larxusNpc);
  chooseDialogue(1);
  assert.equal(current(), 11, 'real Larxus choice accepts Leon after the ten scroll wins');
  assert.equal(booleanProc('champions_ready_for_leon'), true);
  removeNpc(larxusNpc);
});

test('real item-on-Larxus, packed trapdoor and ladder preserve the Ghoul scroll in escrow', () => {
  fresh(surfaceApproach);
  addItem(scrollIds[1]);
  const doorman = makeNpc('champions_doorman', larxus);
  standNear(doorman);
  player.lastUseItem = scrollIds[1];
  player.lastUseSlot = player.getInventory(inventory).getItemIndex(scrollIds[1]);
  dispatchPlayerNpc(ServerTriggerType.OPNPCU, player, doorman);
  chooseDialogue(1);
  assert.equal(current(), 2, 'real use-on-NPC dialogue accepted the Ghoul scroll');
  assert.equal(count(player, scrollNames[1]), 1, 'acceptance does not consume the scroll');

  const trap = locByBase('champions_statue_trap', statue);
  assert(trap, 'native statue trap is present at the mapped logical level-0 tile');
  assert.equal(trap.level, 0, 'LINK_BELOW map topology exposes the statue at effective level 0');
  const openTrapId = id('LocType', 'champions_statue_trap_open');
  assert.equal(trap.type, openTrapId, 'acceptance opens the packed statue trap');
  removeNpc(doorman);

  // One permitted scroll, but no extra item, is the complete Ghoul entry loadout.
  addItem(scrollIds[1]);
  clickLoc(trap);
  assert.equal(current(), 2, 'an overfull Ghoul scroll loadout remains queued');
  assert.equal(escrow(), 0, 'a refused entry does not escrow the scroll');
  assert.equal(count(player, scrollNames[1]), 2, 'the refused entry preserves both scrolls');

  player.getInventory(inventory).removeAll();
  addItem(scrollIds[1]);
  // The published approach is the gallery side of the logical floor, not raw JM2 layer 1.
  player.level = gallery.level;
  player.x = gallery.x;
  player.z = gallery.z;
  clickLoc(trap);
  assert.deepEqual([player.level, player.x, player.z], [arenaEntry.level, arenaEntry.x, arenaEntry.z], 'trapdoor reaches the packed arena landing tile');
  assert.equal(current(), 2);
  assert.equal(escrow(), 1, 'entry moves the held scroll into the shared-varp escrow bit');
  assert.equal(count(player, scrollNames[1]), 0, 'the escrowed Ghoul scroll is absent from inventory');
  assert.equal(booleanProc('champions_entry_check', [2]), true, 'the escrowed challenger may enter with empty inventory');
  const spawned = [...World.npcs].filter(npc => npc.type === id('NpcType', championNpcNames[1]) && npc.level === arenaSpawn.level && npc.x === arenaSpawn.x && npc.z === arenaSpawn.z);
  assert.equal(spawned.length, 1, 'the packed entry trigger creates the Ghoul at the configured spawn');

  const ladder = findWorldLoc('champions_arenaladder', arenaArea).find(loc =>
    loc.level === basementLadder.level && loc.x === basementLadder.x && loc.z === basementLadder.z
  );
  assert(ladder, 'native basement ladder is present at the effective level-0 tile');
  clickLoc(ladder);
  assert.deepEqual([player.level, player.x, player.z], [gallery.level, gallery.x, gallery.z], 'real ladder action returns to the gallery');
  assert.equal(current(), 0, 'leaving clears the active challenger');
  assert.equal(escrow(), 0, 'leaving clears escrow');
  assert.equal(count(player, scrollNames[1]), 1, 'leaving returns the unconsumed Ghoul scroll');
  assert.equal([...World.npcs].filter(npc => npc.type === id('NpcType', championNpcNames[1])).length, 0, 'leaving removes the owned challenger');
});

test('equipment, pickup, food, prayer and teleport shared hooks refuse only their guarded actions', () => {
  const bronzeSword = objectId('bronze_sword');
  const bronzePlatebody = objectId('bronze_platebody');
  setChallenge(2);
  addItem(bronzeSword);
  let slot = player.getInventory(inventory).getItemIndex(bronzeSword);
  runProc('equip', player, [slot]);
  assert.equal(count(player, 'bronze_sword', worn), 1, 'Ghoul fight permits equipping a right-hand weapon');
  addItem(bronzePlatebody);
  slot = player.getInventory(inventory).getItemIndex(bronzePlatebody);
  const inventoryBefore = player.getInventory(inventory).itemsFiltered.map(item => [item.id, item.count]);
  runProc('equip', player, [slot]);
  assert.equal(count(player, 'bronze_platebody'), 1, 'Ghoul fight refuses armour equip');
  assert.equal(count(player, 'bronze_platebody', worn), 0);
  assert.deepEqual(player.getInventory(inventory).itemsFiltered.map(item => [item.id, item.count]), inventoryBefore);

  player.getInventory(worn).removeAll();
  setCurrent(8);
  addItem(bronzeSword);
  slot = player.getInventory(inventory).getItemIndex(bronzeSword);
  runProc('equip', player, [slot]);
  assert.equal(count(player, 'bronze_sword'), 1, 'Lesser Demon fight refuses all equipment');
  assert.equal(count(player, 'bronze_sword', worn), 0);

  player.getInventory(inventory).removeAll();
  setCurrent(2);
  const airRune = objectId('airrune');
  assert.equal(booleanProc('pickup_obj_check_for_space', [airRune, 1]), false, 'Ghoul inventory hook refuses pickup');
  assert.equal(count(player, 'airrune'), 0, 'refused pickup does not add the item');
  player.messages.length = 0;
  const airRuneType = types.ObjType.get(airRune);
  const takeOption = airRuneType.op.findIndex(option => option === 'Take') + 1;
  assert.equal(takeOption, 3, 'Air Rune exposes the packed third-option Take action');
  const groundAirRune = new Obj(player.level, player.x, player.z, EntityLifeCycle.DESPAWN, airRune, 1);
  World.addObj(groundAirRune, Obj.NO_RECEIVER, 1000);
  try {
    const objectHandler = new OpObjHandler();
    assert(objectHandler.handle(new OpObj(takeOption, player.x, player.z, airRune), player), 'real ground-item Take packet is accepted');
    player.processInteraction();
    if (player.activeScript && player.activeScript.execution !== ScriptState.FINISHED) {
      finishPlayer(player, player.activeScript, 'Ghoul prohibited ground pickup');
    }
    assert(player.messages.length > 0, 'real pickup trigger runs and reports the Ghoul inventory restriction');
    assert.equal(count(player, 'airrune'), 0, 'real pickup hook does not add a forbidden item');
    assert.equal(World.getObj(player.x, player.z, player.level, airRune, player.hash64), groundAirRune, 'real pickup hook leaves the forbidden ground item');
  } finally {
    World.removeObj(groundAirRune, -1);
  }
  const food = objectId('lobster');
  addItem(food);
  player.lastItem = food;
  player.lastSlot = player.getInventory(inventory).getItemIndex(food);
  const foodScript = ScriptProvider.getByTrigger(ServerTriggerType.OPHELD1, food, types.ObjType.get(food).category);
  assert(foodScript, 'packed food use trigger exists');
  const hpBeforeFood = player.levels[hp];
  const foodBefore = count(player, 'lobster');
  const foodState = ScriptRunner.init(foodScript, player);
  player.executeScript(foodState, true, true);
  finishPlayer(player, foodState, 'Ghoul prohibited food use');
  assert.equal(count(player, 'lobster'), foodBefore, 'consumption hook preserves the food item');
  assert.equal(player.levels[hp], hpBeforeFood, 'consumption hook applies no healing');

  fresh(arenaSpawn);
  setCurrent(1);
  player.setVar(prayerVarp, 0);
  const prayerButton = id('Component', 'prayer:prayer_protectfrommelee');
  player.tabs[5] = types.Component.get(prayerButton).rootLayer;
  assert(dialogue.handle(new IfButton(prayerButton), player), 'real prayer button is accepted');
  assert.equal(player.getVar(prayerVarp), 0, 'Earth Warrior prayer attempt does not activate');
  player.setVar(prayerVarp, 1);
  assert.equal(booleanProc('champions_entry_check', [1]), false, 'active prayer blocks Earth Warrior entry');

  const arenaCoord = CoordGrid.packCoord(arenaSpawn.level, arenaSpawn.x, arenaSpawn.z);
  assert.equal(booleanProc('pre_tele_checks_no_ana', [arenaCoord]), false, 'real shared teleport precheck refuses arena departure');
  fresh(surfaceApproach);
  const outsideCoord = CoordGrid.packCoord(surfaceApproach.level, surfaceApproach.x, surfaceApproach.z);
  assert.equal(booleanProc('pre_tele_checks_no_ana', [outsideCoord]), true, 'the same teleport guard is inert outside the arena');
});

test('direct magic and autocast both stop at the compiled challenge combat hook', () => {
  const air = objectId('airrune');
  const mind = objectId('mindrune');
  const staff = objectId('staff_of_air');
  for (const mode of ['direct', 'autocast']) {
    setChallenge(3, { level: 0, x: arenaSpawn.x - 1, z: arenaSpawn.z });
    const npc = challengeNpc(3, arenaSpawn);
    addItem(air, 20);
    addItem(mind, 20);
    addItem(staff, 1, worn);
    player.setVar(actionDelayVarp, 0);
    player.setVar(damageTypeVarp, style.magic_style);
    player.messages.length = 0;
    player.packets.length = 0;
    if (mode === 'autocast') {
      player.setVarBit(autocastSpellBit, windStrike);
      player.setVarBit(autocastSetBit, 1);
      assert.equal(booleanProc('player_autocast_enabled'), true, 'the compiled autocast state is active');
    }
    const runesBefore = [count(player, 'airrune'), count(player, 'mindrune')];
    const magicXpBefore = player.stats[PlayerStat.MAGIC];
    if (mode === 'direct') {
      dispatchSpellInteraction(npc, ServerTriggerType.APNPCT, windStrikeComponent);
    } else {
      dispatchSpellInteraction(npc, ServerTriggerType.APNPC2);
    }
    assert.deepEqual([count(player, 'airrune'), count(player, 'mindrune')], runesBefore, `${mode} magic consumes no runes when forbidden`);
    assert.equal(player.stats[PlayerStat.MAGIC], magicXpBefore, `${mode} magic grants no cast XP when forbidden`);
    assert(player.messages.some(text => text.includes('For this fight')), `${mode} reaches the race restriction message`);
    removeNpc(npc);
  }
});

test('special toggle and cannon ranged entrypoint obey the same fight restrictions', () => {
  setChallenge(6);
  const specButton = id('Component', 'combat_crossbow:specbar');
  player.tabs[5] = types.Component.get(specButton).rootLayer;
  player.setVar(specialVarp, 0);
  assert(dialogue.handle(new IfButton(specButton), player), 'real special-bar button is accepted');
  assert.equal(player.getVar(specialVarp), 0, 'Imp challenge blocks enabling special attack');
  const imp = challengeNpc(6);
  player.setVar(specialVarp, 1);
  assert.equal(booleanProc('champions_combat_check', [style.stab_style], imp), false, 'active special use is refused too');
  removeNpc(imp);

  for (const challenge of [3, 4, 7]) {
    setChallenge(challenge);
    const npc = challengeNpc(challenge);
    player.setVar(cannonballsVarp, 1);
    player.messages.length = 0;
    runProc('cannon_fire', player, [], npc);
    assert.equal(player.getVar(cannonballsVarp), 1, `${raceNames[challenge - 1]} cannon refusal spends no cannonball`);
    assert(player.messages.some(text => text.includes('For this fight')), `${raceNames[challenge - 1]} cannon path hits ranged restriction first`);
    removeNpc(npc);
  }
  setChallenge(9);
  const skeleton = challengeNpc(9);
  player.setVar(cannonballsVarp, 0);
  player.messages.length = 0;
  runProc('cannon_fire', player, [], skeleton);
  assert.deepEqual(player.messages, [], 'Skeleton ranged cannon path passes the challenge guard');
  removeNpc(skeleton);
});

test('all champion death triggers award exact tenths, set permanent bits and consume their scroll once', () => {
  let wins = 0;
  const xp = [4320, 4000, 2800, 1280, 2320, 1600, 4800, 5920, 2320, 2400, 4420];
  for (let challenge = 1; challenge <= 11; challenge++) {
    setChallenge(challenge, arenaSpawn, wins);
    if (challenge === 2) setEscrow(1);
    else if (challenge < 11) addItem(scrollIds[challenge - 1]);
    const npc = challengeNpc(challenge);
    npc.levels[hp] = 0;
    const slayerBefore = player.stats[PlayerStat.SLAYER];
    const hpXpBefore = player.stats[PlayerStat.HITPOINTS];
    dispatchNpcTrigger(ServerTriggerType.AI_QUEUE3, npc, player);
    wins |= 1 << (challenge - 1);
    assert.equal(player.getVar(defeatedVarp), wins, `${raceNames[challenge - 1]} sets only its permanent winner bit`);
    assert.equal(current(), 0, 'victory clears current challenger');
    assert.equal(escrow(), 0, 'victory clears Ghoul escrow');
    assert.equal(booleanProc('champions_won', [challenge]), true, 'winner bit is permanent');
    assert.equal(player.stats[PlayerStat.SLAYER] - slayerBefore, xp[challenge - 1] * Environment.NODE_XPRATE, 'exact Slayer XP tenths');
    assert.equal(player.stats[PlayerStat.HITPOINTS] - hpXpBefore, xp[challenge - 1] * Environment.NODE_XPRATE, 'exact Hitpoints XP tenths');
    if (challenge < 11) assert.equal(count(player, scrollNames[challenge - 1]), 0, 'scroll is consumed only on victory');
    const statsAfter = [...player.stats];
    const varpAfter = player.getVar(defeatedVarp);
    runProc('champions_victory', player, [challenge], npc);
    assert.deepEqual([...player.stats], statsAfter, 'replayed victory grants no XP');
    assert.equal(player.getVar(defeatedVarp), varpAfter, 'replayed victory changes no permanent state');
    const reloaded = PlayerLoading.load(player.username, new Packet(player.save()), null);
    assert.equal(reloaded.getVar(defeatedVarp), wins, 'earned banner bits survive the engine save/load boundary');
    removeNpc(npc);
  }
  assert.equal(wins, (1 << 11) - 1, 'ten scroll races and Leon occupy their original low-bit positions');
});

test('death rewards reject mismatched challenge, wrong owner, outside player and dead player', () => {
  for (const refusal of ['wrong-challenge', 'wrong-owner', 'outside-arena', 'dead-player']) {
    const position = refusal === 'outside-arena' ? surfaceApproach : arenaSpawn;
    setChallenge(refusal === 'wrong-challenge' ? 2 : 1, position);
    addItem(scrollIds[0]);
    if (refusal === 'dead-player') player.levels[hp] = 0;
    const npc = challengeNpc(1);
    if (refusal === 'wrong-owner') npc.setVar(ownerVarn, player.uid + 1);
    npc.levels[hp] = 0;
    const slayerBefore = player.stats[PlayerStat.SLAYER];
    dispatchNpcTrigger(ServerTriggerType.AI_QUEUE3, npc, player);
    assert.equal(player.stats[PlayerStat.SLAYER], slayerBefore, `${refusal} gives no Slayer XP`);
    assert.equal(player.getVar(defeatedVarp) & 1, 0, `${refusal} sets no winner bit`);
    assert.equal(count(player, scrollNames[0]), 1, `${refusal} does not consume the scroll`);
    removeNpc(npc);
  }
});

test('real Larxus gate leads to the Leon death trigger after all ten scroll champions', () => {
  const tenWins = (1 << 10) - 1;
  fresh(surfaceApproach, tenWins);
  const doorman = makeNpc('champions_doorman', larxus);
  standNear(doorman);
  dispatchPlayerNpc(ServerTriggerType.OPNPC1, player, doorman);
  chooseDialogue(1);
  assert.equal(current(), 11, 'the offered final-fight choice sets current challenger to Leon');
  removeNpc(doorman);

  const trap = locByBase('champions_statue_trap', statue);
  assert(trap && trap.type === id('LocType', 'champions_statue_trap_open'), 'Leon acceptance leaves the native trap open');
  player.level = gallery.level;
  player.x = gallery.x;
  player.z = gallery.z;
  clickLoc(trap);
  assert.deepEqual([player.level, player.x, player.z], [arenaEntry.level, arenaEntry.x, arenaEntry.z], 'real trap entry reaches the arena');
  assert.equal(current(), 11);
  assert.equal(player.getInventory(inventory).itemsFiltered.length, 0, 'Leon enters with an empty inventory');
  const spawned = [...World.npcs].filter(npc =>
    npc.type === id('NpcType', championNpcNames[10]) &&
    npc.level === arenaSpawn.level && npc.x === arenaSpawn.x && npc.z === arenaSpawn.z
  );
  assert.equal(spawned.length, 1, 'real entry creates Leon at the packed champion spawn');
  const leon = spawned[0];
  leon.levels[hp] = 0;
  leon.heroPoints.addHero(player.hash64, 1);
  const before = player.stats[PlayerStat.SLAYER];
  dispatchNpcTrigger(ServerTriggerType.AI_QUEUE3, leon, player);
  assert.equal(player.stats[PlayerStat.SLAYER] - before, 4420 * Environment.NODE_XPRATE, 'Leon awards the archived 442 XP in tenths');
  assert.equal(player.getVar(defeatedVarp) & (1 << 10), 1 << 10, 'Leon writes bit 10, not one of the scroll bits');
  assert.equal(current(), 0);
  removeNpc(leon);
});

test('ordinary skulled death allocates an escrowed scroll normally and preserves earned banners', () => {
  const earnedWins = 1;
  setChallenge(2, arenaSpawn, earnedWins);
  setEscrow(1);
  const opponent = challengeNpc(2);
  addItem(objectId('bronze_sword'), 1, worn);
  player.setVar(id('VarPlayerType', 'pk_skull'), 1);
  player.levels[hp] = 0;
  try {
    runProc('player_die', player);
    for (let tick = 0; tick < 80 && (player.levels[hp] === 0 || player.activeScript || (player.getVar(defeatedVarp) >>> 11 & 15) !== 0); tick++) {
      tickPlayer(player);
    }
    assert(player.levels[hp] > 0, 'the ordinary death queue respawns the player');
    assert.equal(player.getVar(defeatedVarp), earnedWins, 'death clears selection and escrow but retains earned victory bits');
    assert.equal(count(player, scrollNames[1]), 0, 'a skulled death does not protect the escrowed scroll');
    assert.equal(count(player, 'bronze_sword', worn), 0, 'the same ordinary allocation drops the worn weapon');
    const drop = World.getObj(arenaSpawn.x, arenaSpawn.z, arenaSpawn.level, scrollIds[1], player.hash64);
    assert.equal(drop?.count, 1, 'escrow returns before normal death allocation and drops at the death square');
  } finally {
    removeNpc(opponent);
    for (const name of [scrollNames[1], 'bronze_sword', 'bones']) {
      const drop = World.getObj(arenaSpawn.x, arenaSpawn.z, arenaSpawn.level, objectId(name), player.hash64);
      if (drop) World.removeObj(drop, -1);
    }
  }
});

cleanNpcs();
player.clearInteraction();
console.log(`CHAMPIONS_CHALLENGE_PASS=${passed}`);
if (failures.length > 0) {
  console.error(`CHAMPIONS_CHALLENGE_FAIL=${failures.length}`);
  process.exitCode = 1;
}
