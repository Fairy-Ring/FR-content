#!/usr/bin/env node
/** Ghosts Ahoy: packed dispatch, quest progression, legacy UIs and rewards. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  World, ScriptProvider, ScriptState, ServerTriggerType, PlayerStat, map,
  contentRoot, engineModule, execute, id, obj, inv, worn, count, seed,
  held, use, resumeDialogue, types, button, useLoc, settle, slotOf, environmentTick, player as makePlayer
} from '../swamp-caves/runtime.mjs';

const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await engineModule('engine/entity/EntityLifeCycle.js');
const { BlockWalk } = await engineModule('engine/entity/BlockWalk.js');
const { NpcStat } = await engineModule('engine/entity/NpcStat.ts');
const Environment = (await engineModule('util/Environment.ts')).default;
assert.equal(Environment.NODE_XPRATE, 1, 'exact reward XP requires NODE_XPRATE=1');
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const IfSetText = (await engineModule('network/game/server/model/IfSetText.ts')).default;
const CloseModal = (await engineModule('network/game/client/model/CloseModal.ts')).default;
const closeHandler = new (await engineModule('network/game/client/handler/CloseModalHandler.ts')).default();
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const locHandler = new (await engineModule('network/game/client/handler/OpLocHandler.ts')).default();
function close(p) {
  assert(closeHandler.handle(new CloseModal(), p), 'native modal-close packet is accepted');
  p.processQueues();
  assert.equal(p.modalMain, -1, 'queued native modal close removes the main interface');
}
const constantSource = fs.readFileSync(path.join(contentRoot, 'scripts/general/configs/quest.constant'), 'utf8');
const constant = name => {
  const match = constantSource.match(new RegExp(`^\\^${name}\\s*=\\s*(\\d+)`, 'm'));
  assert(match, `quest constant ${name}`);
  return Number(match[1]);
};
const COMPLETE = constant('ahoy_complete');
const POINTS = constant('ahoy_questpoints');
const variable = name => id('VarBitType', name);
const stage = (p, name = 'ahoy_questvar') => p.getVarBit(variable(name));
const varp = (p, name) => p.getVar(id('VarPlayerType', name));
const setStage = (p, value, name = 'ahoy_questvar') => p.setVarBit(variable(name), value);
const neck = 2;
const points = p => execute('[proc,count_questpoints]', p).popInt();
const tile = p => [p.level, p.x, p.z];
const move = (p, level, x, z) => { p.level = level; p.x = x; p.z = z; p.originX = x; p.originZ = z; };
function clear(p) {
  const inventory = p.getInventory(inv);
  for (let slot = 0; slot < inventory.capacity; slot++) inventory.set(slot, null);
}
function remove(p, name, container = inv) {
  const inventory = p.getInventory(container);
  for (let slot = 0; slot < inventory.capacity; slot++) {
    const item = p.invGetSlot(container, slot);
    if (item?.id === obj(name)) { inventory.set(slot, item.count > 1 ? { ...item, count: item.count - 1 } : null); return; }
  }
  assert.fail(`missing ${name}`);
}
function finish(p, state = p.activeScript, choices = []) {
  const remaining = typeof choices === 'function' ? null : [...choices];
  for (let step = 0; state && state.execution !== ScriptState.FINISHED && step < 160; step++) {
    if (state.execution === ScriptState.PAUSEBUTTON) {
      if (/^multi[2-5]$/.test(types.Component.get(p.modalChat)?.comName ?? '')) {
        if (remaining) assert(remaining.length, `${state.script?.name}: explicit dialogue choice`);
        resumeDialogue(p, remaining ? remaining.shift() : choices(types.Component.get(p.modalChat)));
      } else resumeDialogue(p);
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else assert.fail(`unexpected script execution ${state.execution}`);
  }
  if (state) assert.equal(state.execution, ScriptState.FINISHED, 'interaction finishes without abort');
  if (remaining) assert.equal(remaining.length, 0, 'all supplied dialogue choices consumed');
  return state;
}
let serial = 1;
function actor(p, rootName, x = p.x + 1, z = p.z) {
  const root = types.NpcType.getByName(rootName);
  assert(root, `packed NPC ${rootName}`);
  const npc = new Npc(p.level, x, z, 1, 1, EntityLifeCycle.RESPAWN, serial++, root.id, BlockWalk.NONE);
  npc.isActive = true; npc.lastMovement = -100;
  return npc;
}
function talk(p, name, choices = [], target = actor(p, name)) {
  p.target = target; p.targetOp = ServerTriggerType.OPNPC1 - 7;
  const script = p.getOpTrigger();
  assert(script, `production visible NPC dispatch ${name}`);
  const state = ScriptRunner.init(script, p, target);
  p.executeScript(state, true, true);
  finish(p, state, choices);
  return { state, script, target };
}
function locAt(name, level, x, z) {
  const loc = World.getLoc(x, z, level, id('LocType', name));
  assert(loc, `packed placement ${name} at ${level}:${x},${z}`);
  return loc;
}
function operate(p, loc, option = 1, choices = [], approach = false) {
  p.target = loc; p.targetOp = ServerTriggerType.OPLOC1 + option - 1 - 7;
  const script = approach ? p.getApTrigger() : p.getOpTrigger();
  assert(script, `production visible loc dispatch ${types.LocType.get(loc.type).debugname} option ${option}`);
  if (approach) assert.equal(script.name, '[aploc1,ahoy_rock_invisible]', 'distant rock uses the production approach operation');
  const state = ScriptRunner.init(script, p, loc);
  p.executeScript(state, true, true);
  finish(p, state, choices);
  return state;
}
function jumpRock(p, loc) {
  const type = types.LocType.get(loc.type);
  p.originX = p.x; p.originZ = p.z;
  p.queueWaypoints(map.findPathToLoc(p.level, p.x, p.z, loc.x, loc.z, 1,
    type.width, type.length, loc.angle, loc.shape, type.forceapproach));
  assert(locHandler.handle(new OpLoc(1, loc.x, loc.z, loc.type), p), 'native rock click is accepted');
  for (let tick = 0; (p.target || p.activeScript || p.hasWaypoints()) && tick < 24; tick++) environmentTick(p);
}
function checkLanding(p, label) {
  assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, `${label}: packed landing is walkable`);
}
function arrive(p, x, z, label) {
  const level = p.level;
  for (let tick = 0; (p.x !== x || p.z !== z) && tick < 24; tick++) {
    p.resetEntity(false); World.currentTick++; p.updateMovement();
  }
  assert.deepEqual(tile(p), [level, x, z], label);
  checkLanding(p, label);
}
function qualified() {
  const p = makePlayer();
  p.setVar(id('VarPlayerType', 'prieststart'), constant('priest_complete'));
  p.setVar(id('VarPlayerType', 'priestperil'), constant('priestperil_complete'));
  p.getInventory(worn).set(neck, { id: obj('amulet_of_ghostspeak'), count: 1 });
  p.baseline = { xp: p.stats[PlayerStat.PRAYER], points: points(p) };
  return p;
}

assert.equal(COMPLETE, 8);
assert.equal(POINTS, 2);
assert.equal(id('VarPlayerType', 'ahoy_puzzle_state'), 235);
assert.equal(id('VarPlayerType', 'ahoy_last_signer'), 236);
for (const name of ['ahoy_puzzle_state', 'ahoy_last_signer']) {
  assert.equal(types.VarPlayerType.get(id('VarPlayerType', name)).transmit, false, 'reserved server-only state has no client reader');
}
const ownedQuestItems = ['oak_longbow_signed', 'chinacup_empty', 'chinacup_of_nettletea', 'chinacup_of_nettletea_milky', 'ahoy_robes_of_necrovarus', 'ahoy_book_of_haricanto', 'ahoy_translation_manual', 'amulet_of_ghostspeak_enchanted', 'ectophial', 'ectophial_empty', 'ahoy_toy_boat', 'ahoy_toy_boat_repaired', 'ahoy_bone_key', 'ahoy_chest_key', 'ahoy_map_scrap_1', 'ahoy_map_scrap_2', 'ahoy_map_scrap_3', 'ahoy_map_complete', 'ahoy_petition', 'ahoy_bedsheet', 'ahoy_bedsheetgreen'];
for (const name of ownedQuestItems) assert.equal(types.ObjType.get(obj(name)).tradeable, false, `${name} is untradeable in config`);

// The main player never receives a seeded Ghosts Ahoy stage or quest output.
const p = qualified();
talk(p, 'ahoy_velorina', [1, 1, 1]);
assert.equal(stage(p), 1, 'Velorina starts the quest');
talk(p, 'ahoy_necrovarus');
assert.equal(stage(p), 2, 'Necrovarus refuses the first plea');
talk(p, 'ahoy_velorina', [1]);
assert.equal(stage(p), 3, 'Velorina points to the old disciple');
talk(p, 'ahoy_crone');
assert.equal(stage(p), 3, 'asking for tea does not advance the quest');
seed(p, ['bowl_nettletea', 'bucket_milk']);
talk(p, 'ahoy_crone');
assert.equal(count(p, 'chinacup_empty'), 1, 'crone grants her special cup');
use(p, 'bowl_nettletea', 'chinacup_empty'); finish(p);
assert.equal(count(p, 'chinacup_of_nettletea'), 1, 'porcelain cup filled through item-use dispatch');
talk(p, 'ahoy_crone');
assert.equal(stage(p), 3, 'unmilked tea is refused');
use(p, 'bucket_milk', 'chinacup_of_nettletea'); finish(p);
assert.equal(count(p, 'chinacup_of_nettletea_milky'), 1);
talk(p, 'ahoy_crone');
assert.equal(stage(p), 4, 'milky tea enlightens the crone');
assert.equal(count(p, 'ahoy_toy_boat'), 1, 'the model ship is a product output');
assert.equal(count(p, 'chinacup_of_nettletea_milky'), 0);

// The ordinary token loop works without quest-state seeding.
const ritual = qualified();
seed(ritual, ['bones', 'pot_empty', 'bucket_empty']);
move(ritual, 1, 3660, 3524);
assert(useLoc(ritual, 'bones', locAt('ahoy_grinder_loader', 1, 3660, 3525)));
finish(ritual);
assert.equal(stage(ritual, 'ahoy_grinder_status'), 1);
operate(ritual, locAt('ahoy_grinder_handle', 1, 3659, 3525));
assert.equal(stage(ritual, 'ahoy_grinder_status'), 2);
operate(ritual, locAt('ahoy_grinder_chute', 1, 3658, 3525));
assert.equal(count(ritual, 'pot_bonemeal'), 1);
assert.equal(stage(ritual, 'ahoy_grinder_status'), 0);
const slime = locAt('green_gloop_e', 0, 3680, 9881);
move(ritual, 0, 3680, 9880);
checkLanding(ritual, 'original southern slime-pool approach');
const slimeType = types.LocType.get(slime.type);
assert(map.reachedLoc(ritual.level, ritual.x, ritual.z, slime.x, slime.z,
  slimeType.width, slimeType.length, 1, slime.angle, slime.shape, slimeType.forceapproach),
  'original southern slime-pool edge is reachable from its clear bank');
assert(useLoc(ritual, 'bucket_empty', slime)); finish(ritual);
assert.equal(count(ritual, 'bucket_ectoplasm'), 1);
move(ritual, 0, 3659, 3522);
operate(ritual, locAt('ahoy_ectofunctus', 0, 3658, 3518));
assert.equal(count(ritual, 'pot_empty'), 1);
assert.equal(count(ritual, 'bucket_empty'), 1);
talk(ritual, 'ahoy_disciple');
assert.equal(count(ritual, 'ectotoken'), 5, 'one worship produces five collectible tokens');
talk(ritual, 'ahoy_disciple');
assert.equal(count(ritual, 'ectotoken'), 5, 'collecting twice cannot duplicate tokens');

// Real temple stairs and cellar routes must land on traversable packed tiles.
const travel = qualified();
operate(travel, locAt('ahoy_tower_stairs_lv1', 0, 3666, 3518));
checkLanding(travel, 'tower ascent');
operate(travel, locAt('ahoy_tower_stairs_lv1_top', 1, 3666, 3520));
checkLanding(travel, 'tower descent');
operate(travel, locAt('ahoy_trapdoor', 0, 3653, 3519));
operate(travel, locAt('ahoy_trapdoor_open', 0, 3653, 3519));
checkLanding(travel, 'cellar entrance');
operate(travel, locAt('ahoy_ladder_from_cellar', 3, 3668, 9888));
checkLanding(travel, 'cellar exit');
assert.deepEqual(tile(travel), [0, 3653, 3518]);
for (const [level, x] of [[0, 3684], [1, 3672], [2, 3689]]) {
  operate(travel, locAt('ahoy_cavern_stairs', level, x, 9887));
  checkLanding(travel, 'slime cavern ascent');
  operate(travel, locAt('ahoy_cavern_stairs_top', level + 1, x, 9887));
  checkLanding(travel, 'slime cavern descent');
}


// Independent material hand-ins persist, preserve the necklace slot, and recharge.
{
  const q = qualified();
  setStage(q, 5);
  seed(q, ['ahoy_book_of_haricanto']);
  talk(q, 'ahoy_crone');
  assert.equal(stage(q, 'ahoy_given_book'), 1);
  assert.equal(count(q, 'ahoy_book_of_haricanto'), 0);
  assert.equal(stage(q), 5, 'one material cannot enchant the amulet');
  seed(q, ['ahoy_translation_manual', 'ahoy_robes_of_necrovarus']);
  talk(q, 'ahoy_crone');
  assert.equal(stage(q), 6);
  assert.equal(q.invGetSlot(worn, neck)?.id, obj('amulet_of_ghostspeak_enchanted'));
  assert.equal(count(q, 'amulet_of_ghostspeak', worn), 0);
  talk(q, 'ahoy_necrovarus', [2]);
  assert.equal(stage(q), 6, 'joke does not free the ghosts');
  assert.equal(count(q, 'amulet_of_ghostspeak_enchanted', worn), 1, 'joke preserves charge');
  talk(q, 'ahoy_necrovarus', [3]);
  assert.equal(stage(q), 6, 'chicken command does not complete the quest');
  assert.equal(q.invGetSlot(worn, neck)?.id, obj('amulet_of_ghostspeak'), 'period chicken branch spends the charge');
  talk(q, 'ahoy_crone');
  assert.equal(q.invGetSlot(worn, neck)?.id, obj('amulet_of_ghostspeak_enchanted'), 'crone recharges without demanding the materials again');
  talk(q, 'ahoy_necrovarus', [1]);
  assert.equal(stage(q), 7);
  assert.equal(count(q, 'ectophial'), 0, 'Necrovarus does not award Velorina’s reward');
  seed(q, Array(28).fill('bronze_dagger'));
  talk(q, 'ahoy_velorina');
  assert.equal(stage(q), 7, 'full inventory preserves the unclaimed reward');
  assert.equal(q.stats[PlayerStat.PRAYER], q.baseline.xp);
  clear(q);
  talk(q, 'ahoy_velorina');
  assert.equal(stage(q), COMPLETE);
  assert.equal(count(q, 'ectophial'), 1);
  assert.equal(points(q), q.baseline.points + POINTS);
  assert.equal(q.stats[PlayerStat.PRAYER], q.baseline.xp + 24000, '2,400 Prayer XP in native tenths');
  assert.equal(q.modalMain, id('Component', 'questscroll_death'), 'partial-hand-in fixture receives the real reward scroll');
  close(q);
  const completedXp = q.stats[PlayerStat.PRAYER];
  talk(q, 'ahoy_velorina');
  assert.equal(q.stats[PlayerStat.PRAYER], completedXp, 'reward cannot be claimed twice');
  assert.equal(count(q, 'ectophial'), 1);
  held(q, 'ectophial', 1); finish(q); settle(q);
  assert.deepEqual(tile(q), [0, 3658, 3517], 'manual Ectophial empty reaches the temple');
  checkLanding(q, 'Ectophial teleport');
  assert.equal(count(q, 'ectophial_empty'), 1);
  assert.equal(count(q, 'ectophial'), 0);
  move(q, 0, 3658, 3517);
  assert(useLoc(q, 'ectophial_empty', locAt('ahoy_ectofunctus', 0, 3658, 3518)));
  finish(q);
  assert.equal(count(q, 'ectophial'), 1, 'using the empty vial manually refills it');
  remove(q, 'ectophial');
  talk(q, 'ahoy_velorina');
  assert.equal(count(q, 'ectophial'), 1, 'a lost reward is recoverable without duplicate XP');
  assert.equal(q.stats[PlayerStat.PRAYER], completedXp);
  button(q, 'questlist:ahoy'); finish(q);
  assert.notEqual(q.modalMain, -1, 'completed quest journal opens through the real button');
  const journalText = q.packets.filter(packet => packet instanceof IfSetText && types.Component.get(packet.component).rootLayer === id('Component', 'questjournal')).map(packet => packet.text).join(' ');
  assert.match(journalText, /QUEST COMPLETE!/, 'completed journal retains its completion heading');
  assert.doesNotMatch(journalText, /<br>/, 'legacy journal text contains no literal HTML line-break marker');
}
// Four naturally played wins produce the signed bow, rather than a seeded debt.
JavaRandom.setSeed(1);
talk(p, 'ahoy_akharanu_multi', [1]);
seed(p, Array(25).fill('coins'));
seed(p, ['oak_longbow']);
for (let game = 0; stage(p, 'ahoy_subquest_bow') < 4 && game < 64; game++) {
  talk(p, 'ahoy_robin', [1]);
  assert.equal(p.modalMain, id('Component', 'ahoy_runedraw'), 'N378 opens the original Rune-Draw interface');
  let previousMask = (varp(p, 'varp413_bits') >>> 12) & 1023;
  assert.equal(previousMask, 1023, 'each game starts with ten different runes');
  for (let turn = 0; ((varp(p, 'varp413_bits') >>> 12) & 1023) !== 0 && turn < 12; turn++) {
    const state = varp(p, 'varp413_bits');
    const score = state & 63;
    button(p, `ahoy_runedraw:com_${score >= 15 ? 7 : 6}`); finish(p);
    const nextState = varp(p, 'varp413_bits');
    const mask = (nextState >>> 12) & 1023;
    if (mask !== 0) {
      assert.equal(mask & ~previousMask, 0, 'a drawn rune never returns to the bag');
      previousMask = mask;
    }
  }
  assert.equal((varp(p, 'varp413_bits') >>> 12) & 1023, 0, 'draw/hold always terminates the finite game');
  close(p);
  assert.equal(varp(p, 'varp413_bits'), 0, 'closing N378 clears the unpaid round and its score display');
}
assert.equal(stage(p, 'ahoy_subquest_bow'), 5, 'four wins sign the carried oak longbow');
assert.equal(count(p, 'oak_longbow_signed'), 1);
assert.equal(count(p, 'oak_longbow'), 0);
assert(held(p, 'oak_longbow_signed', 5), 'the native Drop action accepts the earned signed bow');
finish(p);
assert.equal(count(p, 'oak_longbow_signed'), 0, 'the signed bow is no longer carried after dropping it');
talk(p, 'ahoy_robin');
assert.equal(count(p, 'oak_longbow_signed'), 0, 'lost-bow recovery requires another carried oak longbow');
seed(p, ['oak_longbow']);
talk(p, 'ahoy_robin');
assert.equal(count(p, 'oak_longbow_signed'), 1, 'Robin replaces a dropped signed bow after the four-win exchange');
assert.equal(count(p, 'oak_longbow'), 0, 'replacement signing consumes the ordinary oak longbow');
assert.equal(stage(p, 'ahoy_subquest_bow'), 5, 'replacement signing preserves the completed bow subquest');

function useNpc(p, itemName, target, choices = []) {
  p.lastUseItem = obj(itemName);
  p.lastUseSlot = slotOf(p, itemName);
  assert(p.lastUseSlot >= 0, 'real carried item is selected');
  p.target = target; p.targetOp = ServerTriggerType.OPNPCU - 7;
  const script = p.getOpTrigger();
  assert(script, 'native visible-form item-on-NPC dispatch');
  const state = ScriptRunner.init(script, p, target);
  p.executeScript(state, true, true); finish(p, state, choices);
  return script;
}
const ak = actor(p, 'ahoy_akharanu_multi');
const manualScript = useNpc(p, 'oak_longbow_signed', ak);
assert.equal(manualScript.name, '[opnpcu,ahoy_akharanu]', 'Ak-Haranu root dispatches the visible stage-4 form');
assert.equal(count(p, 'ahoy_translation_manual'), 1, 'Ak-Haranu accepts the replacement signed bow for the manual');
assert.equal(count(p, 'oak_longbow_signed'), 0);
remove(p, 'ahoy_translation_manual');
talk(p, 'ahoy_akharanu_multi');
assert.equal(count(p, 'ahoy_translation_manual'), 1, 'lost manual can be replaced');

move(p, 0, 3675, 3488);
talk(p, 'ahoy_ghost_innkeeper', [1, 1]);
assert.equal(count(p, 'ahoy_bedsheet'), 1);
seed(p, ['bucket_ectoplasm']);
use(p, 'ahoy_bedsheet', 'bucket_ectoplasm'); finish(p);
assert.equal(count(p, 'ahoy_bedsheetgreen'), 1);
held(p, 'ahoy_bedsheetgreen', 2); finish(p);
assert.equal(count(p, 'ahoy_bedsheetgreen', worn), 1, 'slimy sheet can be worn inside the town');
talk(p, 'ahoy_ghost_protestor', [1]);
assert.equal(count(p, 'ahoy_petition'), 1);
seed(p, Array(30).fill('ectotoken'));
JavaRandom.setSeed(3);
const villagers = [actor(p, 'ahoy_ghost_villager', 3673, 3488), actor(p, 'ahoy_ghost_villager', 3674, 3488)];
for (let attempt = 0; stage(p, 'ahoy_signaturecounter') < 10 && attempt < 100; attempt++) {
  const target = villagers[attempt % villagers.length];
  talk(p, 'ahoy_ghost_villager', () => 1, target);
  const signed = stage(p, 'ahoy_signaturecounter');
  if (signed) {
    const position = [target.x, target.z];
    target.x++; target.z++;
    talk(p, 'ahoy_ghost_villager', () => 1, target);
    [target.x, target.z] = position;
    assert.equal(stage(p, 'ahoy_signaturecounter'), signed, 'same villager cannot sign twice consecutively');
  }
}
assert.equal(stage(p, 'ahoy_signaturecounter'), 10, 'distinct villagers on the same Z can both sign');
held(p, 'ahoy_petition', 1); finish(p);
assert(p.messages.some(message => /10/.test(message)), 'Count reports the full petition');
talk(p, 'ahoy_ghost_protestor');
const necro = actor(p, 'ahoy_necrovarus', 3658, 3519);
talk(p, 'ahoy_necrovarus', [], necro);
assert.equal(stage(p), 5, 'full petition is burned by Necrovarus');
assert.equal(count(p, 'ahoy_petition'), 0);
assert(World.getObj(necro.x, necro.z, necro.level, obj('ahoy_bone_key'), p.hash64), 'Necrovarus drops the bone key, not an inventory seed');

function take(p, ground) {
  p.target = ground; p.targetOp = ServerTriggerType.OPOBJ3 - 7;
  const script = p.getOpTrigger();
  assert(script, 'native ground Take dispatch');
  const state = ScriptRunner.init(script, p, ground);
  p.executeScript(state, true, true); finish(p, state);
}
take(p, World.getObj(necro.x, necro.z, necro.level, obj('ahoy_bone_key'), p.hash64));
assert.equal(count(p, 'ahoy_bone_key'), 1);
move(p, 1, 3656, 3515);
const tombDoor = locAt('ahoy_harbour_door', 1, 3656, 3514);
operate(p, tombDoor);
assert.equal(stage(p, 'ahoy_templedoor_unlocked'), 1, 'real tomb door uses the bone key');
const coffin = locAt('ahoy_coffin', 1, 3659, 3513);
operate(p, coffin);
operate(p, locAt('ahoy_coffin_open', 1, 3659, 3513));
assert.equal(count(p, 'ahoy_robes_of_necrovarus'), 1, 'opening and searching the real coffin yields robes');

for (const [level, x, z] of [[0, 3609, 3543], [0, 3613, 3543], [1, 3615, 3541], [1, 3615, 3545]]) {
  operate(travel, locAt('ahoy_ghostship_ladder', level, x, z));
  assert.equal(travel.level, level + 1, 'wreck ladder reaches its paired deck');
  checkLanding(travel, 'wreck ladder ascent');
  operate(travel, locAt('ahoy_ghostship_laddertop', level + 1, x, z));
  assert.equal(travel.level, level, 'wreck ladder returns to its paired deck');
  checkLanding(travel, 'wreck ladder descent');
}
move(travel, 1, 3605, 3545);
operate(travel, locAt('ahoy_gangplank_shipwreck_on', 1, 3605, 3546));
assert.equal(travel.level, 0, 'gangplank reaches the packed ground-level rock route');
arrive(travel, 3605, 3548, 'gangplank reaches the clear ground approach');
travel.baseLevels[PlayerStat.AGILITY] = travel.levels[PlayerStat.AGILITY] = 24;
const firstRock = locAt('ahoy_rock_invisible', 0, 3604, 3550);
operate(travel, firstRock, 1, [], true);
assert.deepEqual(tile(travel), [0, 3605, 3548], 'rock approach enforces 25 Agility');
travel.baseLevels[PlayerStat.AGILITY] = travel.levels[PlayerStat.AGILITY] = 50;
const energyBeforeJump = travel.runenergy;
operate(travel, firstRock, 1, [], true);
assert.equal(travel.runenergy, energyBeforeJump - 500, 'one rock jump consumes five percent in native energy units');
move(travel, 0, 3605, 3548);
const rocks = [[3604, 3550], [3602, 3550], [3599, 3552], [3597, 3552], [3595, 3554],
  [3595, 3556], [3597, 3559], [3597, 3561], [3599, 3564], [3601, 3564]];
for (const [x, z] of rocks) {
  jumpRock(travel, locAt('ahoy_rock_invisible', 0, x, z));
  assert.deepEqual(tile(travel), [0, x, z], 'clicked rock is the jump destination');
  checkLanding(travel, 'outward rock jump');
}
jumpRock(travel, locAt('ahoy_rock_invisible', 0, 3601, 3564));
arrive(travel, 3606, 3565, 'last rock connects to the island chest approach');
assert.deepEqual(tile(travel), [0, 3606, 3565], 'endpoint rock reaches the island bank without a fixture teleport');
for (const [x, z] of [...rocks].reverse()) {
  jumpRock(travel, locAt('ahoy_rock_invisible', 0, x, z));
  assert.deepEqual(tile(travel), [0, x, z], 'the island route permits the real reverse jump');
  checkLanding(travel, 'return rock jump');
}
jumpRock(travel, locAt('ahoy_rock_invisible', 0, 3604, 3550));
assert.deepEqual(tile(travel), [0, 3605, 3550], 'endpoint rock returns to the ship bank without a fixture teleport');
travel.queueWaypoints(map.findPath(0, travel.x, travel.z, 3605, 3548));
arrive(travel, 3605, 3548, 'first rock connects back to the gangplank');
operate(travel, locAt('ahoy_gangplank_shipwreck_off', 0, 3605, 3547));
assert.equal(travel.level, 1, 'return gangplank reaches the real wreck deck');
arrive(travel, 3605, 3545, 'gangplank returns to the wreck');
assert.equal(map.isMapBlocked(3791, 3556, 0), false, 'statue west-adjacent map start is walkable');
assert.equal(map.isMapBlocked(3803, 3530, 0), false, 'period direction sequence ends on a walkable dig tile');

// N379 and the model-ship chain use the packed mast and real item dispatch.
seed(p, ['silk', 'needle', 'thread', 'knife', 'reddye', 'bluedye', 'yellowdye', 'spade']);
use(p, 'silk', 'ahoy_toy_boat'); finish(p);
assert.equal(count(p, 'ahoy_toy_boat'), 0);
assert.equal(count(p, 'ahoy_toy_boat_repaired'), 1, 'repair consumes the original model ship');
assert.equal(count(p, 'silk'), 0);
assert.equal(count(p, 'needle'), 1);
assert.equal(count(p, 'knife'), 1);
move(p, 2, 3618, 3543);
const mast = locAt('ahoy_mast', 2, 3619, 3543);
execute('[proc,ahoy_wind_start]', p);
operate(p, mast);
assert.equal(p.overlay, id('Component', 'ahoy_windspeed'), 'N379 uses the original wind-speed overlay');
assert.equal(stage(p, 'ahoy_windspeed'), 0);
assert.equal((varp(p, 'ahoy_puzzle_state') >>> 9) & 1, 1, 'low wind inspection records the visible flag clue');
const wind = qualified();
move(wind, 2, 3618, 3543);
execute('[proc,ahoy_wind_start]', wind);
for (let tick = 0; tick < 100; tick++) environmentTick(wind);
assert.equal(stage(wind, 'ahoy_windspeed'), 1, 'the native soft timer advances to high wind');
operate(wind, mast);
assert.equal((varp(wind, 'ahoy_puzzle_state') >>> 9) & 1, 0, 'high wind cannot reveal the colours');
for (let tick = 0; tick < 100; tick++) environmentTick(wind);
assert.equal(stage(wind, 'ahoy_windspeed'), 0, 'the native soft timer cycles back to low wind');
operate(wind, mast);
assert.equal((varp(wind, 'ahoy_puzzle_state') >>> 9) & 1, 1);
execute('[proc,ahoy_wind_stop]', wind);
assert.equal(wind.overlay, -1, 'leaving the wreck removes its overlay');
for (const [dye, section] of [['reddye', 1], ['bluedye', 2], ['yellowdye', 3]]) {
  if (section === 2) use(p, 'ahoy_toy_boat_repaired', dye);
  else use(p, dye, 'ahoy_toy_boat_repaired');
  finish(p, p.activeScript, [section]);
}
const dyer = qualified();
seed(dyer, ['red_cape', 'bluedye', 'reddye', 'bluedye']);
use(dyer, 'red_cape', 'bluedye'); finish(dyer);
assert.equal(count(dyer, 'blue_cape'), 1, 'the additive boat branch does not pre-empt cape dyeing');
use(dyer, 'reddye', 'bluedye'); finish(dyer);
assert.equal(count(dyer, 'purpledye'), 1, 'the additive boat branch does not pre-empt dye mixing');
move(p, 1, 3617, 3543);
talk(p, 'ahoy_oldman', [3], actor(p, 'ahoy_oldman', 3617, 3544));
assert.equal(count(p, 'ahoy_chest_key'), 1, 'matching repaired ship earns the old man’s key');
assert.equal(count(p, 'ahoy_toy_boat_repaired'), 0);
assert.equal(stage(p, 'ahoy_subquest_toyboat'), 2);

function completeMainQuest() {
  for (const name of ['ahoy_book_of_haricanto', 'ahoy_robes_of_necrovarus', 'ahoy_translation_manual']) {
    assert.equal(count(p, name), 1, `${name} was earned by the main player`);
  }
  talk(p, 'ahoy_crone');
  assert.equal(stage(p), 6, 'all three earned materials enchant the amulet');
  assert.equal(p.invGetSlot(worn, neck)?.id, obj('amulet_of_ghostspeak_enchanted'));
  talk(p, 'ahoy_necrovarus', [1]);
  assert.equal(stage(p), 7);
  talk(p, 'ahoy_velorina');
  assert.equal(stage(p), COMPLETE, 'one unseeded quest walk reaches completion');
  assert.equal(count(p, 'ectophial'), 1);
  assert.equal(points(p), p.baseline.points + POINTS);
  assert.equal(p.stats[PlayerStat.PRAYER], p.baseline.xp + 24000, '2,400 Prayer XP in native tenths');
  assert.equal(p.modalMain, id('Component', 'questscroll_death'), 'reward opens the production completion scroll');
  close(p);
  button(p, 'questlist:ahoy'); finish(p);
  assert.notEqual(p.modalMain, -1, 'the completed main-player journal opens');
}

// Both original barriers charge entry only, retain currency on refusal, and
// prohibit carrying a worn disguise across either direction.
for (const [x, z, outside, inside] of [
  [3652, 3485, [0, 3651, 3485], [0, 3653, 3485]],
  [3659, 3508, [0, 3659, 3509], [0, 3659, 3507]]
]) {
  const gate = qualified(), barrier = locAt('ahoy_town_barrier', 0, x, z);
  move(gate, ...outside);
  operate(gate, barrier);
  assert.deepEqual(tile(gate), outside, 'unpaid entry does not cross');
  seed(gate, ['ectotoken', 'ectotoken']);
  operate(gate, barrier);
  assert.deepEqual(tile(gate), inside, 'two tokens buy entry');
  checkLanding(gate, 'paid barrier entry');
  assert.equal(count(gate, 'ectotoken'), 0);
  seed(gate, ['ahoy_bedsheetgreen']);
  held(gate, 'ahoy_bedsheetgreen', 2); finish(gate);
  assert.equal(count(gate, 'ahoy_bedsheetgreen', worn), 1);
  operate(gate, barrier);
  assert.deepEqual(tile(gate), inside, 'a worn disguise cannot leave the town');
  remove(gate, 'ahoy_bedsheetgreen', worn);
  operate(gate, barrier);
  assert.deepEqual(tile(gate), outside, 'leaving never requires tokens');
  checkLanding(gate, 'free barrier exit');
  setStage(gate, COMPLETE);
  operate(gate, barrier);
  assert.deepEqual(tile(gate), inside, 'completed entry is free without tokens');
  checkLanding(gate, 'completed barrier entry');
  move(gate, ...outside);
  seed(gate, ['ahoy_bedsheet']);
  held(gate, 'ahoy_bedsheet', 2); finish(gate);
  assert.equal(count(gate, 'ahoy_bedsheet', worn), 0, 'the disguise cannot be worn outside town');
}

// Search real packed chests, including the fight that produces the third scrap.
move(p, 1, 3618, 3545);
operate(p, locAt('ahoy_chest_locked', 1, 3619, 3545));
operate(p, locAt('ahoy_chest_open', 1, 3619, 3545));
assert.equal(count(p, 'ahoy_map_scrap_1'), 1);
assert.equal(count(p, 'ahoy_chest_key'), 0);
move(p, 0, 3606, 3565);
operate(p, locAt('ahoy_chest_closed', 0, 3606, 3564));
operate(p, locAt('ahoy_chest_open', 0, 3606, 3564));
assert.equal(count(p, 'ahoy_map_scrap_2'), 1);
move(p, 2, 3620, 3542);
checkLanding(p, 'lobster chest approach');
operate(p, locAt('ahoy_chest_closed', 2, 3620, 3541));
const lobsterChest = locAt('ahoy_chest_open', 2, 3620, 3541);
operate(p, lobsterChest);
assert.equal(count(p, 'ahoy_map_scrap_3'), 0, 'the third scrap is withheld before the lobster kill');
const ownedLobsters = () => [...World.npcs].filter(npc => npc?.isActive && npc.type === id('NpcType', 'giant_lobster')
  && npc.vars[id('VarNpcType', 'npc_aggressive_player')] === p.uid);
assert.equal(ownedLobsters().length, 1, 'search spawns one owned real combat NPC');
const lobster = ownedLobsters()[0];
operate(p, lobsterChest);
assert.equal(ownedLobsters().length, 1, 'repeated search cannot duplicate the owned encounter');
assert.equal(lobster.level, p.level);
p.queueWaypoints(map.findPathToEntity(p.level, p.x, p.z, lobster.x, lobster.z, 1, 2, 2));
arrive(p, 3619, 3542, 'native collision route from the actual chest approach reaches melee contact');
assert(map.reachedEntity(p.level, p.x, p.z, lobster.x, lobster.z, 2, 2, 1), 'real two-by-two encounter is melee-reachable');
for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) {
  assert.equal(map.isMapBlocked(lobster.x + dx, lobster.z + dz, lobster.level), false, 'all four monster footprint tiles are walkable');
}
const outsider = qualified();
outsider.level = p.level;
outsider.target = lobster; outsider.targetOp = ServerTriggerType.OPNPC2 - 7;
let combat = outsider.getOpTrigger();
assert.equal(combat.name, '[opnpc2,giant_lobster]', 'the outsider also reaches the real owner guard');
let state = ScriptRunner.init(combat, outsider, lobster);
outsider.executeScript(state, true, true); finish(outsider, state);
assert.equal(stage(outsider, 'ahoy_killed_lobster'), 0);
p.target = lobster; p.targetOp = ServerTriggerType.OPNPC2 - 7;
combat = p.getOpTrigger();
assert.equal(combat.name, '[opnpc2,giant_lobster]', 'native Attack dispatch reaches the owned combat binding');
state = ScriptRunner.init(combat, p, lobster); p.executeScript(state, true, true); finish(p, state);
const lobsterType = types.NpcType.get(lobster.type);
assert(ScriptProvider.getByTrigger(ServerTriggerType.AI_OPPLAYER2, lobster.type, lobsterType.category), 'real NPC attack AI is bound');
assert.equal(lobsterType.vislevel, 32);
// Deterministic lethal damage exercises the production hero/death machinery;
// the headed walk covers the ordinary combat rolls without a seeded victim.
const hp = lobster.levels[NpcStat.HITPOINTS];
lobster.heroPoints.addHero(p.hash64, hp);
lobster.applyDamage(hp, 1);
const death = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, lobster.type, lobsterType.category);
assert(death, 'production NPC death queue is bound');
const deathState = ScriptRunner.init(death, lobster);
lobster.executeScript(deathState);
for (let tick = 0; deathState.execution !== ScriptState.FINISHED && tick < 32; tick++) {
  assert.equal(deathState.execution, ScriptState.NPC_SUSPENDED);
  World.currentTick = Math.max(World.currentTick + 1, lobster.delayedUntil);
  lobster.delayed = false; lobster.executeScript(deathState); p.processQueues();
}
assert.equal(deathState.execution, ScriptState.FINISHED);
assert.equal(stage(p, 'ahoy_killed_lobster'), 1, 'death credits the encounter owner');
assert.equal(stage(outsider, 'ahoy_killed_lobster'), 0, 'death cannot credit a different player');
assert.equal(lobster.isActive, false);
p.clearInteraction();
operate(p, lobsterChest);
assert.equal(count(p, 'ahoy_map_scrap_3'), 1, 'post-kill search yields the third scrap');
use(p, 'ahoy_map_scrap_1', 'ahoy_map_scrap_2'); finish(p);
assert.equal(count(p, 'ahoy_map_complete'), 1, 'three earned scraps assemble through real item use');
for (const name of ['ahoy_map_scrap_1', 'ahoy_map_scrap_2', 'ahoy_map_scrap_3']) assert.equal(count(p, name), 0);
held(p, 'ahoy_map_complete', 1); finish(p);
assert.equal(p.modalMain, id('Component', 'ahoy_islandmap'), 'N377 reads the original map interface');
close(p);

seed(p, Array(25).fill('ectotoken'));
move(p, 0, 3702, 3487);
const fareBefore = count(p, 'ectotoken');
talk(p, 'ahoy_ghost_captain_1', [1], actor(p, 'ahoy_ghost_captain_1', 3703, 3487));
assert.equal(count(p, 'ectotoken'), fareBefore - 25);
assert.deepEqual(tile(p), [0, 3793, 3560]);
checkLanding(p, 'paid Dragontooth landing');
move(p, 0, 3791, 3556);
for (const [direction, distance, x, z] of [
  [3, 3, 3791, 3552], [3, 2, 3791, 3550],
  [2, 3, 3795, 3550], [2, 3, 3799, 3550],
  [1, 2, 3799, 3552], [2, 3, 3803, 3552],
  [3, 4, 3803, 3542], [3, 4, 3803, 3532], [3, 2, 3803, 3530]
]) {
  held(p, 'ahoy_map_complete', 2); finish(p, p.activeScript, [direction, distance]);
  arrive(p, x, z, 'Follow walks the chosen period direction and distance');
}
held(p, 'spade', 1); finish(p);
assert.equal(count(p, 'ahoy_book_of_haricanto'), 1, 'the shared spade dispatch digs up the book at the period route endpoint');
assert.equal(count(p, 'ahoy_map_complete'), 0);
const returnTokens = count(p, 'ectotoken');
talk(p, 'ahoy_ghost_captain_1', [], actor(p, 'ahoy_ghost_captain_1', 3792, 3560));
assert.equal(count(p, 'ectotoken'), returnTokens, 'the already-paid return costs no tokens');
assert.deepEqual(tile(p), [0, 3702, 3487]);
checkLanding(p, 'return ferry landing');
completeMainQuest();
console.log('PASS Ghosts Ahoy: unseeded full quest, N377/N378/N379, owned combat/death, ritual, travel, rewards and recovery');
process.exit(0);
