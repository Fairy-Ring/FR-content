// Complete built-pack Swan Song progression, original-map routes and owner safety.
// Run in the sibling engine: node --import tsx ../content/tests/swan-song/test_swan_song.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  World, ScriptProvider as Scripts, ScriptState as State, PlayerStat, PlayerTimerType,
  types, id, inv, worn, invCom, player as makePlayer, count, slotOf, execute,
  held, use, useLoc, resumeDialogue, inputCount, invButton, button, engineModule as load, map, contentRoot
} from '../swamp-caves/runtime.mjs';
import { quests, value } from '../quest-points/registry.mjs';
const Runner = (await load('engine/script/ScriptRunner.ts')).default;
const Trigger = (await load('engine/script/ServerTriggerType.ts')).default;
const { NpcStat } = await load('engine/entity/NpcStat.ts');
const rsbuf = await load('network/rsbuf/index.ts');
const OpNpc = (await load('network/game/client/model/OpNpc.ts')).default;
const OpNpcHandler = new (await load('network/game/client/handler/OpNpcHandler.ts')).default();
const OpNpcU = (await load('network/game/client/model/OpNpcU.ts')).default;
const OpNpcUHandler = new (await load('network/game/client/handler/OpNpcUHandler.ts')).default();
const OpLoc = (await load('network/game/client/model/OpLoc.ts')).default;
const OpLocHandler = new (await load('network/game/client/handler/OpLocHandler.ts')).default();
const JavaRandom = (await load('util/JavaRandom.ts')).default;
const bit = (p, name) => p.getVarBit(id('VarBitType', name));
const stage = p => bit(p, 'swansong');
const variable = (p, name) => p.getVar(id('VarPlayerType', name));
const set = (p, name, value) => {
  const b = types.VarBitType.getId(name);
  if (b >= 0) p.setVarBit(b, value);
  else p.setVar(id('VarPlayerType', name), value);
};
const add = (p, name, n = 1) => p.invAdd(inv, id('ObjType', name), n);
const remove = (p, name, n = count(p, name)) => p.invDel(inv, id('ObjType', name), n);
const text = p => p.packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => packet.text).join(' ');
const point = p => [p.level, p.x, p.z];
function player() {
  const p = makePlayer();
  for (let stat = 0; stat < p.baseLevels.length; stat++) p.setLevel(stat, 99);
  p.hash64 = BigInt(p.slot);
  p.buildArea.rebuild();
  rsbuf.addPlayer(p.slot);
  p.getInventory(worn);
  return p;
}
function prerequisiteFixture(p, target = 100) {
  const required = quests.filter(q => ['onesmallfavour_questpoints', 'garden_questpoints'].includes(q.pointsConstant));
  assert.equal(required.length, 2);
  const remaining = target - required.reduce((n, q) => n + q.points, 0);
  const possibilities = new Map([[0, []]]);
  for (const quest of quests.filter(q => !required.includes(q) && q.component !== 'swansong')) {
    for (const [sum, chosen] of [...possibilities]) {
      if (sum + quest.points <= remaining && !possibilities.has(sum + quest.points)) possibilities.set(sum + quest.points, [...chosen, quest]);
    }
  }
  assert(possibilities.has(remaining), 'native quest fixtures can make the exact QP boundary');
  for (const quest of [...required, ...possibilities.get(remaining)]) {
    for (const [name, terminal] of quest.fixture) set(p, name, terminal);
  }
  execute('[proc,update_questpoints]', p);
  assert.equal(variable(p, 'qp'), target);
}

// Original jm2 placements identify real locs and floor tiles; the engine's packed
// map supplies all blocking, approach and path verdicts, not product constants.
const floors = new Set();
const locations = [];
for (const name of fs.readdirSync(path.join(contentRoot, 'maps')).filter(n => /^m\d+_\d+\.jm2$/.test(n))) {
  const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(name).map(Number);
  let section = '';
  const flags = new Map();
  for (const line of fs.readFileSync(path.join(contentRoot, 'maps', name), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) { section = line.split(/\s+/)[1]; continue; }
    const match = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
    if (!match) continue;
    const [, sl, sx, sz, rest] = match;
    const level = Number(sl), x = mx * 64 + Number(sx), z = mz * 64 + Number(sz);
    if (section === 'MAP') {
      flags.set(`${sx},${sz}`, Number(/(?:^| )f(\d+)(?: |$)/.exec(rest)?.[1] ?? 0));
      if (/(?:^| )(?:u\d+|o-?\d+)(?:[; ]|$)/.test(rest)) floors.add(`${level},${x},${z}`);
    } else if (section === 'LOC') {
      const [type] = rest.split(/\s+/).map(Number);
      const actual = ((flags.get(`${sx},${sz}`) ?? 0) & 2) && level > 0 ? level - 1 : level;
      const loc = World.getLoc(x, z, actual, type);
      if (loc) locations.push(loc);
    }
  }
}
function visible(p, type, kind) {
  const t = types[kind].get(type);
  const forms = kind === 'NpcType' ? t.multinpc : t.multiloc;
  if (!forms?.length) return type;
  const selector = t.multivarbit >= 0 ? p.getVarBit(t.multivarbit) : p.getVar(t.multivarp);
  return forms[Math.min(selector, forms.length - 1)];
}
function nativeNpc(p, name, predicate = () => true) {
  const wanted = id('NpcType', name);
  const actor = [...World.npcs].find(n => n.isActive && visible(p, n.type, 'NpcType') === wanted && predicate(n) &&
    (name !== 'swan_herman' || (stage(p) < 60 ? n.z < 3653 : n.z >= 3664)));
  assert(actor, `${name} has a real original-map or product-spawned visible actor at stage ${stage(p)}`);
  return actor;
}
function nativeLoc(p, name, predicate = () => true) {
  const wanted = id('LocType', name);
  const loc = locations.find(l => visible(p, l.type, 'LocType') === wanted && predicate(l));
  assert(loc, `${name} has a native visible packed placement`);
  return loc;
}
function place(p, level, x, z, label) {
  assert(floors.has(`${level},${x},${z}`), `${label}: packed floor exists`);
  assert.equal(map.isMapBlocked(x, z, level), false, `${label}: packed floor is walkable`);
  p.level = level; p.x = x; p.z = z; p.originX = x; p.originZ = z;
  p.buildArea.rebuild();
}
function approach(p, target, predicate = () => true, approachRange = 0) {
  const old = point(p);
  for (let pass = 0; pass < (approachRange ? 2 : 1); pass++) {
    for (let x = target.x - 5; x <= target.x + 5; x++) {
      for (let z = target.z - 5; z <= target.z + 5; z++) {
        if (!predicate(x, z) || !floors.has(`${target.level},${x},${z}`) || map.isMapBlocked(x, z, target.level)) continue;
        p.level = target.level; p.x = x; p.z = z;
        if (pass === 0 ? p.inOperableDistance(target) : p.inApproachDistance(approachRange, target)) {
          p.originX = x; p.originZ = z; p.buildArea.rebuild(); return;
        }
      }
    }
  }
  [p.level, p.x, p.z] = old;
  assert.fail(`native target ${target.type} at ${target.x},${target.z} has no collision-valid approach`);
}
function showNpc(p, n) {
  const appearance = p.generateAppearance();
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, appearance, p.lastAppearance,
    p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ,
    p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[PlayerStat.HITPOINTS], p.baseLevels[PlayerStat.HITPOINTS], p.animId, p.animDelay,
    p.sayMessage, p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0,
    p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(n.x, n.level, n.z, n.nid, n.type, n.tele, n.jump,
    n.runDir, n.walkDir, n.isActive, n.masks, n.faceEntity, n.faceSquareX, n.faceSquareZ,
    n.faceAngleX, n.faceAngleZ, n.hitmarkDamage, n.hitmarkType, n.hitmark2Damage, n.hitmark2Type,
    n.levels[NpcStat.HITPOINTS], n.baseLevels[NpcStat.HITPOINTS], n.animId, n.animDelay,
    n.sayMessage, n.spotanimId, n.spotanimHeight, n.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, n.nid), 'the native NPC packet exposes the real target');
}
function drive(p, choices = [], clear = true) {
  const options = [...choices];
  for (let steps = 0; p.activeScript && steps < 600; steps++) {
    const state = p.activeScript;
    assert.notEqual(state.execution, State.ABORTED, state.script.name);
    if (state.execution === State.PAUSEBUTTON) {
      const root = types.Component.get(p.modalChat)?.comName ?? '';
      if (/^multi[2-5]$/.test(root)) { assert(options.length, `${state.script.name}: missing declared choice`); resumeDialogue(p, options.shift()); }
      else resumeDialogue(p);
    } else if (state.execution === State.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else if (state.execution === State.COUNTDIALOG) {
      assert(options.length, 'quantity input is declared'); inputCount(p, options.shift());
    } else break;
  }
  assert(!p.activeScript || p.activeScript.execution === State.FINISHED, 'native dialogue or delay finishes');
  assert.equal(options.length, 0, 'all declared choices are consumed');
  if (clear) p.clearInteraction();
}
function selected(p, expected, choices = []) {
  const handler = p.inOperableDistance(p.target) ? p.getOpTrigger() : p.getApTrigger();
  assert.equal(handler?.name, expected, 'visible-form production dispatch selects the handler');
  assert(p.tryInteract(true), `${expected} starts from native interaction`);
  drive(p, choices);
}
function talk(p, name, choices = [], option = 1, predicate = () => true) {
  const n = nativeNpc(p, name, predicate);
  const hasAp = Scripts.getByTrigger(Trigger[`APNPC${option}`], n.type, types.NpcType.get(n.type).category);
  approach(p, n, () => true, hasAp ? 2 : 0); showNpc(p, n);
  assert(OpNpcHandler.handle(new OpNpc(option, n.nid), p));
  selected(p, `[${p.inOperableDistance(n) ? 'opnpc' : 'apnpc'}${option},${name}]`, choices);
  return n;
}
function click(p, name, choices = [], predicate = () => true, stand = () => true) {
  const loc = nativeLoc(p, name, predicate);
  approach(p, loc, stand);
  assert(OpLocHandler.handle(new OpLoc(1, loc.x, loc.z, loc.type), p));
  selected(p, `[oploc1,${name}]`, choices);
  return loc;
}
function itemOnLoc(p, item, name, expected = `[oplocu,${name}]`, predicate = () => true) {
  const loc = nativeLoc(p, name, predicate);
  approach(p, loc);
  assert(useLoc(p, item, loc));
  // useLoc already starts the real packet-selected script.
  if (p.activeScript) drive(p);
  p.clearInteraction();
  assert(Scripts.getByName(expected), 'the expected visible use-on handler is packed');
  return loc;
}
function itemOnNpc(p, item, name) {
  const n = nativeNpc(p, name);
  approach(p, n); showNpc(p, n);
  assert(OpNpcUHandler.handle(new OpNpcU(n.nid, id('ObjType', item), slotOf(p, item), invCom), p));
  selected(p, `[opnpcu,${name}]`);
}
function heldUse(p, used, target) { assert(use(p, used, target)); drive(p); }
function heldOption(p, name, caption) {
  const option = types.ObjType.get(id('ObjType', name)).iop.indexOf(caption) + 1;
  assert(option > 0, `${name} offers ${caption}`); assert(held(p, name, option)); drive(p);
}
function tick() {
  for (const p of World.playerLoop.all()) if (p?.isActive) { p.lastResponse = World.currentTick; p.lastConnected = World.currentTick; }
  for (const phase of ['processWorld', 'processNpcEventQueue', 'processNpcs', 'processPlayers', 'processLogouts', 'processLogins', 'processZones', 'processInfo', 'processCleanup']) World[phase]();
  World.currentTick++;
}
function runNpc(n, trigger, args = []) {
  const t = types.NpcType.get(n.type);
  const script = Scripts.getByTrigger(Trigger[trigger], n.type, t.category);
  assert(script, `${trigger} has production NPC dispatch`);
  const state = Runner.init(script, n, null, args);
  n.executeScript(state);
  return state;
}
function runTarget(p, n, name, args = []) { return execute(name, p, args, { target: n }); }
function routeOut(p, expectedArea, destination) {
  assert(expectedArea(p), `landing ${point(p)} is in the independently specified intended area`);
  assert(floors.has(`${p.level},${p.x},${p.z}`));
  assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, 'landing tile is walkable');
  assert(map.findPath(p.level, p.x, p.z, destination.x, destination.z).length > 0, 'a non-empty packed route leaves the landing');
}
function catchFish(p, ordinary = false) {
  const name = ordinary ? 'raw_monkfish' : 'swan_raw_monkfish';
  const target = ordinary ? nativeNpc(p, 'swan_fishingspot') : nativeLoc(p, 'fishing_spot_14938');
  const before = count(p, name);
  approach(p, target);
  if (ordinary) {
    showNpc(p, target);
    assert(OpNpcHandler.handle(new OpNpc(3, target.nid), p));
    assert.equal(p.getOpTrigger()?.name, '[opnpc3,swan_fishingspot]');
  } else {
    assert(OpLocHandler.handle(new OpLoc(1, target.x, target.z, target.type), p));
    assert.equal(p.getOpTrigger()?.name, '[oploc1,fishing_spot_14938]');
  }
  assert(p.tryInteract(true));
  drive(p, [], false);
  const oldRandom = Math.random, oldJava = JavaRandom.nextDouble;
  Math.random = () => 0; JavaRandom.nextDouble = () => 0;
  try {
    for (let i = 0; i < 160 && count(p, name) === before; i++) tick();
    assert.equal(count(p, name), before + 1, 'the native recurring fishing action actually produces a catch');
  } finally { Math.random = oldRandom; JavaRandom.nextDouble = oldJava; p.clearInteraction(); }
}

assert.equal(value('swansong_complete'), 200);
assert.equal(value('swansong_questpoints'), 2);
assert.equal(id('VarPlayerType', 'swansong_quest'), 723);
assert.equal(id('VarPlayerType', 'swansong_temp'), 638);
assert.equal(id('VarPlayerType', 'swansong_combat_uid'), 310);
const uidType = types.VarPlayerType.get(id('VarPlayerType', 'swansong_combat_uid'));
assert.equal(uidType.transmit, false); assert.equal(uidType.scope, types.VarPlayerType.SCOPE_TEMP);
const clientConfig = fs.readFileSync(path.join(process.env.HARNESS_ENGINE_DIR ?? path.resolve(contentRoot, '../engine'), 'data/pack/client/config'));
assert.equal(crypto.createHash('sha256').update(clientConfig).digest('hex'), 'b6ec704421650ee5527e77c635b8b3a8036f6eb042c572516ac0696cfbce19a8');

// Fail closed at QP and both quest prerequisites, including the exact 100-QP pass.
for (const missing of ['qp', 'onesmallfavour', 'garden_quest']) {
  const p = player(); prerequisiteFixture(p, missing === 'qp' ? 99 : 102);
  if (missing !== 'qp') {
    set(p, missing, 0);
    execute('[proc,update_questpoints]', p);
    assert(variable(p, 'qp') >= 100, 'missing prerequisite is isolated from the QP gate');
  }
  talk(p, 'swan_herman', [1, 1, 2]);
  assert.equal(stage(p), 0, `${missing} prevents acceptance`);
}
const p = player(); prerequisiteFixture(p);
talk(p, 'swan_herman', [1, 1, 2]); assert.equal(stage(p), 5);
talk(p, 'wise_old_man'); assert.equal(stage(p), 5); // Asking without runes consumes none.
for (const [name, n] of [['bloodrune', 5], ['lavarune', 10], ['mistrune', 10]]) add(p, name, n);
talk(p, 'wise_old_man'); assert.equal(stage(p), 30);
for (const name of ['bloodrune', 'lavarune', 'mistrune']) assert.equal(count(p, name), 0);
talk(p, 'wom_cutscene_2', [1]); assert.equal(stage(p), 30);

function nativeBattle(p, n) {
  approach(p, n); showNpc(p, n);
  const oldRandom = Math.random, oldJava = JavaRandom.nextDouble;
  Math.random = () => 0.999999999999; JavaRandom.nextDouble = () => 0.999999999999;
  try {
    assert(OpNpcHandler.handle(new OpNpc(2, n.nid), p), 'real Attack packet accepts the owned opponent');
    assert.match(p.getOpTrigger()?.name ?? '', /^\[opnpc2,swan_/);
    assert(p.canAccess(), 'native dialogue handling releases input before battle');
    const initial = n.levels[NpcStat.HITPOINTS];
    const meleeXp = () => p.stats[PlayerStat.ATTACK] + p.stats[PlayerStat.STRENGTH] + p.stats[PlayerStat.DEFENCE];
    const beforeXp = meleeXp();
    assert(initial > 0, 'the next product-spawned opponent is alive');
    for (let i = 0; i < 320 && n.levels[NpcStat.HITPOINTS] > 0 && n.isActive; i++) tick();
    assert(n.levels[NpcStat.HITPOINTS] < initial, 'ordinary player combat actually damages the quest opponent');
    assert(meleeXp() > beforeXp, 'the player earns real combat XP rather than relying only on Wise Old Man support');
    assert.equal(n.levels[NpcStat.HITPOINTS], 0, 'ordinary player combat defeats the quest opponent');
    // Stop at the credited kill, not eight extra ticks in which the Wise Old
    // Man can already kill another troll before its next native Attack input.
    for (let i = 0; i < 8 && variable(p, 'swansong_combat_uid') === n.uid; i++) tick();
    assert.notEqual(variable(p, 'swansong_combat_uid'), n.uid, 'real NPC death reaches the protected owner credit queue');
    assert.equal(variable(p, 'death'), 0, 'a prepared normal account survives native combat');
  } finally { Math.random = oldRandom; JavaRandom.nextDouble = oldJava; p.clearInteraction(); }
}
add(p, 'rune_scimitar'); heldOption(p, 'rune_scimitar', 'Wield');
assert(variable(p, 'com_maxhit') > 0, 'the real weapon equip action initializes normal player combat stats');
execute('[if_button,prayer:prayer_protectfrommagic]', p);
assert.equal(variable(p, 'prayer12'), 1);
click(p, 'hole_14922', [], loc => loc.z < 3653, (_x, z) => z < 3653);
routeOut(p, p => p.z > 3653 && p.z < 3663, { x: 2345, z: 3658 });
for (let i = 0; i < 8; i++) {
  const n = World.getNpcByUid(variable(p, 'swansong_combat_uid'));
  assert(n && types.NpcType.get(n.type).debugname === 'swan_troll_ambush', `ambush ${i + 1} is a product-spawned original troll`);
  nativeBattle(p, n);
}
assert.equal(stage(p), 60);
click(p, 'colony_gate', [], () => true, (_x, z) => z < 3663);
routeOut(p, p => p.z >= 3664 && p.x >= 2304 && p.x < 2368, { x: 2346, z: 3665 });
talk(p, 'swan_herman'); assert.equal(stage(p), 65);

// Restore the actual five mapped walls with produced sheets, then catch,
// fight for, cook and hand over the five fresh monkfish.
talk(p, 'swan_franklin');
for (const [name, flag, tool] of [['bronze_pickaxe_14910', 'swansong_pickaxe', 'bronze_pickaxe'], ['bronze_axe_14912', 'swansong_hatchet', 'bronze_axe']]) {
  click(p, name); assert.equal(bit(p, flag), 1); assert.equal(count(p, tool), 1);
  assert(map.findPath(p.level, p.x, p.z, 2344, 3670).length > 0, 'the utility-heap approach connects to the colony');
  remove(p, tool); talk(p, 'swan_franklin');
  assert.equal(count(p, tool), 1, 'Franklin replaces a lost task tool after its heap disappears');
}
for (const [name, n] of [['logs', 1], ['iron_bar', 5], ['net', 1]]) add(p, name, n);
itemOnLoc(p, 'logs', 'firebox');
assert.equal(count(p, 'logs'), 0);
itemOnLoc(p, 'tinderbox', 'firebox_14959');
for (let i = 0; i < 5; i++) itemOnLoc(p, 'iron_bar', 'metal_press');
assert.equal(count(p, 'iron_bar'), 0); assert.equal(count(p, 'iron_sheet'), 5);
remove(p, 'iron_sheet', 1); add(p, 'iron_bar'); itemOnLoc(p, 'iron_bar', 'metal_press');
assert.equal(count(p, 'iron_sheet'), 5, 'lost sheets can be pressed again without resetting completed repairs');
talk(p, 'swan_franklin'); assert.equal(count(p, 'hammer'), 1, 'Franklin supplies a hammer after five sheets');
remove(p, 'hammer'); talk(p, 'swan_franklin');
assert.equal(count(p, 'hammer'), 1, 'a lost hammer is replaceable while the wall repairs remain');
for (let z = 3684; z <= 3688; z++) {
  const wall = locations.find(l => l.x === 2311 && l.z === z && l.level === 0 &&
    ['broken_wall', 'broken_wall_14946', 'broken_wall_14947'].includes(types.LocType.get(visible(p, l.type, 'LocType')).debugname));
  assert(wall, `original broken wall at colony west boundary ${z}`);
  const name = types.LocType.get(visible(p, wall.type, 'LocType')).debugname;
  itemOnLoc(p, 'iron_sheet', name, `[oplocu,${name}]`, l => l.x === wall.x && l.z === wall.z);
  assert.equal(bit(p, `swansong_wall_${3689 - z}`), 1, 'each real wall writes its own original bit');
  assert.match(types.LocType.get(visible(p, wall.type, 'LocType')).debugname, /^patched_wall/);
  assert(map.findPath(p.level, p.x, p.z, 2344, 3670).length > 0, 'the real wall approach connects to the colony interior');
}
assert.equal(count(p, 'iron_sheet'), 0); assert.equal(bit(p, 'swansong_franklin'), 4);
talk(p, 'swan_arnold');
for (let i = 0; i < 5; i++) {
  catchFish(p);
  assert.equal(count(p, 'swan_raw_monkfish'), i + 1, 'a real Net action catches exactly one fresh fish');
  if (i < 3) {
    const troll = World.getNpcByUid(variable(p, 'swansong_combat_uid'));
    assert(troll && types.NpcType.get(troll.type).debugname === `swan_troll_fishing_${i + 1}`);
    nativeBattle(p, troll);
    assert.equal(bit(p, 'swansong_trolls'), i + 1, 'only the owned native defeat advances the fishing interruptions');
  }
}
assert.equal(bit(p, 'swansong_fish'), 0, 'Arnold tracks the cooked fish, not raw catches');
remove(p, 'swan_raw_monkfish', 1); catchFish(p);
assert.equal(count(p, 'swan_raw_monkfish'), 5, 'a lost raw quest fish is replaceable after the first five catches');
for (let i = 0; i < 5; i++) itemOnLoc(p, 'swan_raw_monkfish', 'loc_14919');
assert.equal(count(p, 'swan_raw_monkfish'), 0); assert.equal(count(p, 'swan_monkfish'), 5);
remove(p, 'swan_monkfish', 1); catchFish(p);
assert.equal(count(p, 'swan_raw_monkfish'), 1, 'a lost cooked quest fish has a new raw catch');
itemOnLoc(p, 'swan_raw_monkfish', 'loc_14919');
assert.equal(count(p, 'swan_monkfish'), 5, 'the replacement cooked quest fish remains hand-in eligible');
talk(p, 'swan_arnold', [1]); assert.equal(bit(p, 'swansong_arnold'), 6);
assert.equal(bit(p, 'swansong_fish'), 5);
assert.equal(count(p, 'swan_monkfish'), 0);
p.setLevel(PlayerStat.MAGIC, 65); talk(p, 'swan_herman'); assert.equal(stage(p), 65, 'Magic 66 is required before seeking the army');
p.setLevel(PlayerStat.MAGIC, 66); talk(p, 'swan_herman'); assert.equal(stage(p), 100);

// Bone seeds are made from ordinary supplies, and a lost pot is recoverable.
talk(p, 'wizard_frumscone'); assert.equal(stage(p), 110);
const mortiferChoices = q => bit(q, 'fairy_farmers_quest') >= value('ft1_zandar') ? [1] : [];
talk(p, 'elemental_wizard_boss', mortiferChoices(p)); assert.equal(stage(p), 110);
add(p, 'bones', 6); talk(p, 'elemental_wizard_boss', mortiferChoices(p));
assert.equal(stage(p), 110); assert.equal(count(p, 'bones'), 6, 'six bones are not partially consumed');
add(p, 'bones'); talk(p, 'elemental_wizard_boss', mortiferChoices(p));
assert.equal(stage(p), 120); assert.equal(count(p, 'bones'), 0); assert.equal(bit(p, 'swansong_bones'), 7);
assert.equal(count(p, 'brown_apron'), 1);
remove(p, 'brown_apron'); talk(p, 'elemental_wizard_boss', mortiferChoices(p));
assert.equal(count(p, 'brown_apron'), 1, 'Mortifer replaces a dropped task apron');
heldOption(p, 'brown_apron', 'Wear');
talk(p, 'master_crafter'); assert.equal(stage(p), 130);
talk(p, 'elemental_wizard_boss', mortiferChoices(p)); assert.equal(stage(p), 130);
add(p, 'pot_empty'); add(p, 'potlid'); talk(p, 'elemental_wizard_boss', mortiferChoices(p));
assert.equal(stage(p), 140); assert.equal(count(p, 'swan_army'), 1);
routeOut(p, p => p.x >= 2304 && p.x < 2368 && p.z >= 3664 && p.z < 3712, { x: 2344, z: 3670 });
remove(p, 'swan_army'); add(p, 'pot_empty'); add(p, 'potlid');
talk(p, 'elemental_wizard_boss', mortiferChoices(p));
assert.equal(stage(p), 140); assert.equal(count(p, 'swan_army'), 1, 'a dropped seed-pot has a native replacement path');
routeOut(p, p => p.x >= 2304 && p.x < 2368 && p.z >= 3664 && p.z < 3712, { x: 2344, z: 3670 });
heldOption(p, 'swan_army', 'Open'); assert.equal(count(p, 'swan_army'), 1, 'quest seeds cannot be wasted before the army handoff');
talk(p, 'swan_herman'); assert.equal(stage(p), 150); assert.equal(count(p, 'swan_army'), 0);
const finalQueen = World.getNpcByUid(variable(p, 'swansong_combat_uid'));
assert(finalQueen && types.NpcType.get(finalQueen.type).debugname === 'swan_seatroll_queen');
routeOut(p, p => p.x < 2343 && p.z >= 3694 && p.z <= 3702, { x: 2340, z: 3698 });
nativeBattle(p, finalQueen); assert.equal(stage(p), 180);
const rewardBefore = { coins: count(p, 'coins'), xp: [...p.stats], qp: variable(p, 'qp') };
talk(p, 'swan_herman'); assert.equal(stage(p), 200);
assert.equal(count(p, 'coins') - rewardBefore.coins, 25000);
for (const [skill, amount] of [[PlayerStat.MAGIC, 150000], [PlayerStat.PRAYER, 100000], [PlayerStat.FISHING, 100000]]) {
  assert.equal(p.stats[skill] - rewardBefore.xp[skill], amount, 'period reward XP is stored in tenths');
}
assert.equal(variable(p, 'qp') - rewardBefore.qp, 2);
assert.equal(p.modalMain, id('Component', 'questscroll_death'), 'the real completion scroll opens');
assert(text(p).includes('You have completed Swan Song!'));
const rewardAfter = { coins: count(p, 'coins'), xp: [...p.stats], qp: variable(p, 'qp') };
talk(p, 'swan_herman');
assert.deepEqual({ coins: count(p, 'coins'), xp: [...p.stats], qp: variable(p, 'qp') }, rewardAfter, 'repeated completion cannot duplicate coins, XP or quest points');
{
  const full = player(); set(full, 'swansong', 180); add(full, 'spade', 28);
  talk(full, 'swan_herman'); assert.equal(stage(full), 180); assert.equal(count(full, 'coins'), 0);
  remove(full, 'spade', 1); talk(full, 'swan_herman');
  assert.equal(stage(full), 200); assert.equal(count(full, 'coins'), 25000, 'freeing reward space permits a clean retry');
}
for (const checkpoint of [60, 65, 100, 110, 120, 130, 140, 150, 180]) {
  const lost = player(); set(lost, 'swansong', checkpoint);
  click(lost, 'hermans_desk'); assert.equal(count(lost, 'swan_book'), 1);
  heldOption(lost, 'swan_book', 'Read'); assert.equal(count(lost, 'swan_book'), 1);
  remove(lost, 'swan_book'); click(lost, 'hermans_desk');
  assert.equal(count(lost, 'swan_book'), 1, 'the optional quest book is recoverable at every intermediate checkpoint');
  click(lost, 'hermans_desk'); assert.equal(count(lost, 'swan_book'), 1, 'book recovery never duplicates an owned copy');
}

// Both gate leaves and both tunnel directions lead to an intended area and a
// non-empty native path, independently of the implementation's landing constants.
click(p, 'colony_gate', [], () => true, (_x, z) => z >= 3663);
routeOut(p, p => p.z > 3653 && p.z < 3663, { x: 2344, z: 3657 });
click(p, 'hole_14922', [], loc => loc.z > 3653, (_x, z) => z > 3653);
routeOut(p, p => p.z < 3653 && p.z > 3630, { x: 2344, z: 3647 });
click(p, 'hole_14922', [], loc => loc.z < 3653, (_x, z) => z < 3653);
routeOut(p, p => p.z > 3653 && p.z < 3663, { x: 2344, z: 3657 });
click(p, 'colony_gate_14931', [], () => true, (_x, z) => z < 3663);
routeOut(p, p => p.z >= 3664 && p.z < 3712, { x: 2344, z: 3670 });

// Post-quest banking uses native OP dispatch and actual interface packets.
talk(p, 'swan_arnold', [], 4);
assert(map.findPath(p.level, p.x, p.z, 2344, 3670).length > 0, 'the native bank approach connects to the colony interior');
assert.equal(p.modalMain, id('Component', 'bank_main'));
add(p, 'bronze_dagger'); const daggerSlot = slotOf(p, 'bronze_dagger');
assert(invButton(p, 'bank_side:inv', 'bronze_dagger', 1, daggerSlot));
assert.equal(count(p, 'bronze_dagger'), 0); assert.equal(count(p, 'bronze_dagger', id('InvType', 'bank')), 1);
assert(invButton(p, 'bank_main:bank', 'bronze_dagger', 1, 0));
assert.equal(count(p, 'bronze_dagger'), 1); assert.equal(count(p, 'bronze_dagger', id('InvType', 'bank')), 0);
assert(button(p, 'bank_main:com_91'));

// The verified post-quest apron and single-pot service includes copies held in
// the bank, and Open returns the ordinary pot and lid through its native option.
{
  const a = player(); set(a, 'swansong', 200);
  talk(a, 'elemental_wizard_boss'); assert.equal(count(a, 'brown_apron'), 1);
  remove(a, 'brown_apron'); talk(a, 'elemental_wizard_boss');
  assert.equal(count(a, 'brown_apron'), 1, 'the post-quest brown apron is replaceable');
  add(a, 'pot_empty'); add(a, 'potlid'); talk(a, 'elemental_wizard_boss');
  assert.equal(count(a, 'swan_army'), 1);
  talk(a, 'swan_arnold', [], 4);
  assert(invButton(a, 'bank_side:inv', 'swan_army', 1, slotOf(a, 'swan_army')));
  assert.equal(count(a, 'swan_army', id('InvType', 'bank')), 1);
  assert(button(a, 'bank_main:com_91'));
  add(a, 'pot_empty'); add(a, 'potlid'); talk(a, 'elemental_wizard_boss');
  assert.equal(count(a, 'swan_army'), 0, 'a banked pot prevents a second seed pot');
  assert.equal(count(a, 'pot_empty'), 1); assert.equal(count(a, 'potlid'), 1);
  talk(a, 'swan_arnold', [], 4);
  assert(invButton(a, 'bank_main:bank', 'swan_army', 1, slotOf(a, 'swan_army', id('InvType', 'bank'))));
  assert(button(a, 'bank_main:com_91'));
  remove(a, 'pot_empty'); remove(a, 'potlid');
  const mages = [...World.npcs].filter(n => n.isActive && n.type === id('NpcType', 'swan_skeleton_battle')).length;
  heldOption(a, 'swan_army', 'Open');
  assert.equal(count(a, 'swan_army'), 0);
  assert.equal(count(a, 'pot_empty'), 1); assert.equal(count(a, 'potlid'), 1);
  assert.equal([...World.npcs].filter(n => n.isActive && n.type === id('NpcType', 'swan_skeleton_battle')).length, mages + 1);
}

// Fare payment, refusal, Charos exemption and both ferry landings use the
// player's actual visible Kathy form, not a direct call to the travel label.
{
  const f = player();
  const mainland = n => n.z < 3600, coast = n => n.z > 3600;
  talk(f, 'swan_boatwoman_1', [2], 1, mainland);
  assert(f.z < 3600); assert.equal(variable(f, 'swansong_quest') >>> 30, 0);
  talk(f, 'swan_boatwoman_1', [1], 1, mainland);
  assert(f.z < 3600, 'an unpaid player cannot board');
  add(f, 'coins', 51); talk(f, 'swan_boatwoman_1', [1], 1, mainland);
  assert.equal(count(f, 'coins'), 1); assert.equal(variable(f, 'swansong_quest') >>> 30, 1);
  routeOut(f, f => f.x >= 2304 && f.x < 2368 && f.z > 3630 && f.z < 3653, { x: 2344, z: 3647 });
  talk(f, 'swan_boatwoman_2', [], 1, coast);
  routeOut(f, f => f.x >= 2368 && f.x < 2432 && f.z > 3456 && f.z < 3520, { x: 2370, z: 3485 });
  talk(f, 'swan_boatwoman_1', [], 1, mainland);
  assert.equal(count(f, 'coins'), 1, 'the previously paid pre-quest fare is not charged again');
  const c = player(); add(c, 'ring_of_charos_unlocked'); heldOption(c, 'ring_of_charos_unlocked', 'Wear');
  talk(c, 'swan_boatwoman_1', [], 1, mainland);
  assert(c.z > 3600); assert.equal(count(c, 'coins'), 0, 'the worn activated ring exempts the fare');
  const started = player(); set(started, 'swansong', 5);
  talk(started, 'swan_boatwoman_2', [], 3, mainland);
  routeOut(started, q => q.z > 3630 && q.z < 3653, { x: 2344, z: 3647 });
  talk(started, 'swan_boatwoman_2', [], 3, coast);
  routeOut(started, q => q.z > 3456 && q.z < 3520, { x: 2370, z: 3485 });
}

for (const name of ['iron_sheet', 'swan_raw_monkfish', 'swan_monkfish', 'swan_army', 'swan_book']) {
  assert.equal(types.ObjType.get(id('ObjType', name)).tradeable, false, `${name} is private in the packed object configuration`);
}
for (const name of ['raw_monkfish', 'monkfish', 'cert_raw_monkfish', 'cert_monkfish']) {
  assert.equal(types.ObjType.get(id('ObjType', name)).tradeable, true, `${name} remains a tradeable post-quest item`);
}

// The fare uses spare bits only after proving no original raw client reader.
const word = id('VarPlayerType', 'swansong_quest');
assert.equal(types.VarPlayerType.get(word).clientcode, 0);
for (let i = 0; i < types.NpcType.count; i++) assert.notEqual(types.NpcType.get(i)?.multivarp, word);
for (let i = 0; i < types.LocType.count; i++) assert.notEqual(types.LocType.get(i)?.multivarp, word);
for (let i = 0; i < types.VarBitType.count; i++) {
  const vb = types.VarBitType.get(i);
  if (vb?.basevar === word) assert(vb.endbit < 30, 'no original quest varbit occupies the retained fare bit');
}

// Owner refusal reaches the shared hit cap and a real manual-spell packet,
// rather than relying only on the quest's ordinary Attack operation.
{
  const q = player(); set(q, 'swansong', 150);
  execute('[proc,swan_final_enter]', q);
  let queen = World.getNpcByUid(variable(q, 'swansong_combat_uid'));
  assert(queen, 'the retry entry creates its own Queen');
  routeOut(q, q => q.x < 2343 && q.z >= 3694 && q.z <= 3702, { x: 2340, z: 3698 });
  assert.equal(queen.width, 5); assert.equal(queen.length, 5);
  for (let x = queen.x; x < queen.x + 5; x++) for (let z = queen.z; z < queen.z + 5; z++) {
    assert(floors.has(`${queen.level},${x},${z}`), 'the complete boss footprint has original packed floor');
    assert.equal(map.isMapBlocked(x, z, queen.level), false, 'the complete boss footprint is collision clear');
  }
  const foreign = player(); set(foreign, 'swansong', 150);
  for (const name of ['npc_is_attackable', 'npc_is_attackable_opt', 'npc_is_attackable_opt_quiet']) {
    const result = runTarget(foreign, queen, `[proc,${name}]`);
    assert.deepEqual(result.intStack.slice(0, result.isp), [0], `${name} refuses the wrong owner`);
  }
  const cap = runTarget(foreign, queen, '[proc,npc_max_dealt]', [37, value('water_wave')]);
  assert.deepEqual(cap.intStack.slice(0, cap.isp), [0], 'foreign manual magic has zero damage before XP');
  const ownerCap = runTarget(q, queen, '[proc,npc_max_dealt]', [37, value('water_wave')]);
  assert.deepEqual(ownerCap.intStack.slice(0, ownerCap.isp), [37], 'ordinary owner spell damage is not weakened');
  const OpNpcT = (await load('network/game/client/model/OpNpcT.ts')).default;
  const spellHandler = new (await load('network/game/client/handler/OpNpcTHandler.ts')).default();
  const spell = id('Component', 'magic:wind_strike');
  foreign.tabs[6] = types.Component.get(spell).rootLayer;
  add(foreign, 'airrune', 10); add(foreign, 'mindrune', 10);
  const xp = [...foreign.stats], hp = queen.levels[NpcStat.HITPOINTS];
  approach(foreign, queen); showNpc(foreign, queen);
  assert(spellHandler.handle(new OpNpcT(queen.nid, spell), foreign), 'the actual visible manual-spell packet is accepted');
  foreign.processInteraction(); drive(foreign);
  assert.equal(queen.levels[NpcStat.HITPOINTS], hp);
  assert.deepEqual([...foreign.stats], xp, 'foreign manual magic grants no combat XP');
  assert.equal(count(foreign, 'airrune'), 10); assert.equal(count(foreign, 'mindrune'), 10);
  execute('[queue,swan_credit]', q, [queen.type, queen.uid]);
  assert.equal(stage(q), 150, 'a live actor cannot be credited as a stale death');
  const originalUid = queen.uid;
  set(q, 'death', 1); runNpc(queen, 'AI_TIMER');
  assert.equal(queen.isActive, false, 'owner death removes the live encounter');
  assert.equal(variable(q, 'swansong_combat_uid'), -1); assert.equal(stage(q), 150);
  set(q, 'death', 0); talk(q, 'swan_herman');
  queen = World.getNpcByUid(variable(q, 'swansong_combat_uid'));
  assert(queen && queen.isActive, 'Herman restarts a lost fight without another army or consumed supplies');
  const replacementUid = queen.uid;
  execute('[queue,swan_credit]', q, [queen.type, originalUid]);
  assert.equal(stage(q), 150, 'a superseded death callback cannot finish the replacement encounter');
  assert.equal(variable(q, 'swansong_combat_uid'), replacementUid);
  place(q, 0, 2344, 3650, 'ordinary exit to the outside tunnel');
  runNpc(queen, 'AI_TIMER');
  assert.equal(queen.isActive, false, 'leaving the encounter cleans up the Queen');
  assert.equal(stage(q), 150, 'exit loses no completed supply-task progress');
  talk(q, 'swan_herman');
  queen = World.getNpcByUid(variable(q, 'swansong_combat_uid'));
  q.isActive = false; World.players[q.slot] = null; q.unlink();
  runNpc(queen, 'AI_TIMER');
  assert.equal(queen.isActive, false, 'an absent owner cannot leave an attacking NPC behind');
  assert.equal(types.VarPlayerType.get(word).scope, types.VarPlayerType.SCOPE_PERM, 'earned quest checkpoints survive logout');
  const ordinary = [...World.npcs].find(n => n.isActive && types.NpcType.get(n.type).debugname === 'chicken');
  assert(ordinary, 'the original maps provide an unrelated ordinary NPC');
  const normal = runTarget(foreign, ordinary, '[proc,npc_max_dealt]', [37, 0]);
  assert.deepEqual(normal.intStack.slice(0, normal.isp), [37], 'the shared hit-cap hook leaves ordinary NPCs unchanged');
}

// The shared topic hooks leave each existing product reachable.
{
  const g = player(); set(g, 'garden_quest', 1); set(g, 'swansong', 5);
  set(g, 'fenk_charos_unlocked', 0);
  talk(g, 'wise_old_man', [2]);
  assert.equal(stage(g), 5); assert.equal(bit(g, 'garden_quest'), 1);
  add(g, 'ring_of_charos');
  talk(g, 'wise_old_man', [1, 3, 1, 3, 2, 2, 2, 2, 1]);
  assert.equal(count(g, 'ring_of_charos_unlocked'), 1, 'the existing Garden quiz still activates the ring');
  assert.equal(stage(g), 5, 'Garden does not consume the Swan Song rune task');
}
{
  const f = player(); set(f, 'swansong', 110); set(f, 'fairy_farmers_quest', value('ft1_zandar'));
  talk(f, 'elemental_wizard_boss', [2]);
  assert.equal(bit(f, 'fairy_farmers_quest'), value('ft1_skull'), 'the Fairytale topic still asks for its skull');
  assert.equal(stage(f), 110); assert.equal(bit(f, 'swansong_bones'), 0);
  const ordinary = player();
  talk(ordinary, 'wizard_frumscone');
  assert.equal(stage(ordinary), 0); assert(text(ordinary).length > 0, 'ordinary Frumscone dialogue is retained');
}
{
  const g = player();
  talk(g, 'master_crafter');
  assert(text(g).includes('Right on!'), 'the generic Master Crafter greeting remains intact');
  assert.equal(stage(g), 0);
  const door = nativeLoc(g, 'crafting_guild_door');
  const coord = (level, x, z) => (level << 28) | (x << 14) | z;
  const outside = (x, z) => {
    const result = execute('[proc,check_axis]', g, [coord(door.level, x, z), coord(door.level, door.x, door.z), door.angle]);
    return result.intStack[0] === 1;
  };
  g.setLevel(PlayerStat.CRAFTING, 39); g.packets.length = 0;
  click(g, 'crafting_guild_door', [], () => true, outside);
  assert(text(g).includes('You must be level 40 or above to enter.'), 'the Guild still refuses low Crafting');
  g.setLevel(PlayerStat.CRAFTING, 40); g.packets.length = 0;
  click(g, 'crafting_guild_door', [], () => true, outside);
  assert(text(g).includes("Where's your brown apron?"), 'the Guild still requires a worn apron');
  add(g, 'brown_apron'); heldOption(g, 'brown_apron', 'Wear'); g.packets.length = 0;
  click(g, 'crafting_guild_door', [], () => true, outside);
  assert(text(g).includes('Welcome to the Guild of Master Craftsmen.'), '40 Crafting and the worn apron admit a normal player');
}

// Isolate the remaining skill boundaries at the real task operations.
{
  const s = player(); set(s, 'swansong', 65); talk(s, 'swan_franklin');
  add(s, 'logs'); itemOnLoc(s, 'logs', 'firebox');
  s.setLevel(PlayerStat.FIREMAKING, 41); itemOnLoc(s, 'tinderbox', 'firebox_14959');
  assert.equal(bit(s, 'swansong_franklin'), 2, 'Firemaking 41 cannot light the quest press');
  s.setLevel(PlayerStat.FIREMAKING, 42); itemOnLoc(s, 'tinderbox', 'firebox_14959');
  assert.equal(bit(s, 'swansong_franklin'), 3);
  add(s, 'iron_bar');
  s.setLevel(PlayerStat.SMITHING, 44); itemOnLoc(s, 'iron_bar', 'metal_press');
  assert.equal(count(s, 'iron_bar'), 1); assert.equal(count(s, 'iron_sheet'), 0);
  s.setLevel(PlayerStat.SMITHING, 45); const readyXp = s.stats[PlayerStat.SMITHING];
  itemOnLoc(s, 'iron_bar', 'metal_press');
  assert.equal(count(s, 'iron_bar'), 0); assert.equal(count(s, 'iron_sheet'), 1);
  assert.equal(s.stats[PlayerStat.SMITHING] - readyXp, 200, 'sheet XP uses tenths');
}
{
  const f = player(); set(f, 'swansong', 65); talk(f, 'swan_arnold');
  assert.equal(count(f, 'net'), 1); remove(f, 'net'); talk(f, 'swan_arnold');
  assert.equal(count(f, 'net'), 1, 'Arnold replaces a lost task net');
  f.setLevel(PlayerStat.FISHING, 61); click(f, 'fishing_spot_14938');
  assert.equal(count(f, 'swan_raw_monkfish'), 0, 'Fishing 61 cannot catch the quest fish');
  f.setLevel(PlayerStat.FISHING, 62); catchFish(f);
  f.setLevel(PlayerStat.COOKING, 61); itemOnLoc(f, 'swan_raw_monkfish', 'loc_14919');
  assert.equal(count(f, 'swan_raw_monkfish'), 1); assert.equal(count(f, 'swan_monkfish'), 0);
  f.setLevel(PlayerStat.COOKING, 62);
  const oldRandom = Math.random, oldJava = JavaRandom.nextDouble;
  Math.random = () => 0; JavaRandom.nextDouble = () => 0;
  try { itemOnLoc(f, 'swan_raw_monkfish', 'loc_14919'); }
  finally { Math.random = oldRandom; JavaRandom.nextDouble = oldJava; }
  assert.equal(count(f, 'swan_monkfish'), 1);
  f.levels[PlayerStat.HITPOINTS] = 50; heldOption(f, 'swan_monkfish', 'Eat');
  assert.equal(f.levels[PlayerStat.HITPOINTS], 51); assert.equal(count(f, 'swan_monkfish'), 0);
  const troll = World.getNpcByUid(variable(f, 'swansong_combat_uid'));
  assert(troll); set(f, 'death', 1); runNpc(troll, 'AI_TIMER');
}

// Post-quest Net, the same colony range and Eat use ordinary tradeable fish.
{
  const locked = player(); set(locked, 'swansong', 199); add(locked, 'net');
  talk(locked, 'swan_fishingspot', [], 3);
  assert.equal(count(locked, 'raw_monkfish'), 0, 'ordinary colony monkfish require completion');
  const fishXp = p.stats[PlayerStat.FISHING], cookXp = p.stats[PlayerStat.COOKING];
  catchFish(p, true);
  assert.equal(p.stats[PlayerStat.FISHING] - fishXp, 1200);
  assert(map.findPath(p.level, p.x, p.z, 2344, 3670).length > 0, 'the ordinary fishing spot connects to the colony');
  itemOnLoc(p, 'raw_monkfish', 'loc_14919');
  assert.equal(count(p, 'raw_monkfish'), 0); assert.equal(count(p, 'monkfish'), 1);
  assert.equal(p.stats[PlayerStat.COOKING] - cookXp, 1500);
  const rangeDoor = nativeLoc(p, 'door_14923', loc => loc.x === 2322 && loc.z === 3667);
  approach(p, rangeDoor);
  assert(OpLocHandler.handle(new OpLoc(1, rangeDoor.x, rangeDoor.z, rangeDoor.type), p));
  selected(p, '[oploc1,_door_closed]');
  approach(p, nativeLoc(p, 'loc_14919'));
  assert(map.findPath(p.level, p.x, p.z, 2344, 3670).length > 0, 'the real range approach connects to the bank and colony');
  p.levels[PlayerStat.HITPOINTS] = 50; heldOption(p, 'monkfish', 'Eat');
  assert.equal(p.levels[PlayerStat.HITPOINTS], 66); assert.equal(count(p, 'monkfish'), 0);
  add(p, 'iron_bar'); const smithXp = p.stats[PlayerStat.SMITHING], beforeCoins = count(p, 'coins');
  itemOnLoc(p, 'iron_bar', 'metal_press');
  assert.equal(count(p, 'iron_sheet'), 1); assert.equal(p.stats[PlayerStat.SMITHING] - smithXp, 200);
  itemOnNpc(p, 'iron_sheet', 'swan_franklin');
  assert.equal(count(p, 'iron_sheet'), 0); assert.equal(count(p, 'coins') - beforeCoins, 20);
}

// Exiting the tunnel removes this owner's short-range ambush and support actor.
{
  const a = player(); set(a, 'swansong', 30);
  click(a, 'hole_14922', [], loc => loc.z < 3653, (_x, z) => z < 3653);
  const troll = World.getNpcByUid(variable(a, 'swansong_combat_uid'));
  assert(troll);
  const support = [...World.npcs].find(n => n.isActive && n.type === id('NpcType', 'swan_wom_ambush') && n.getVar(id('VarNpcType', 'npc_attacking_uid')) === a.uid);
  assert(support);
  click(a, 'hole_14922', [], loc => loc.z > 3653, (_x, z) => z > 3653);
  runNpc(troll, 'AI_TIMER'); runNpc(support, 'AI_TIMER');
  assert.equal(troll.isActive, false); assert.equal(support.isActive, false);
  assert.equal(variable(a, 'swansong_combat_uid'), -1);
  click(a, 'hole_14922', [], loc => loc.z < 3653, (_x, z) => z < 3653);
  assert(World.getNpcByUid(variable(a, 'swansong_combat_uid')), 'ordinary re-entry restarts an interrupted ambush');
}

{
  const q = player(); add(q, 'raw_monkfish');
  const otherRange = locations.find(l => {
    const type = visible(q, l.type, 'LocType'), config = types.LocType.get(type);
    return l.level === 0 && l.x > 3000 && l.x < 3300 && l.z > 3000 && l.z < 3500 &&
      config?.category === id('CategoryType', 'cooking_oven') &&
      Scripts.getByTrigger(Trigger.OPLOCU, type, config.category)?.name === '[oplocu,range]';
  });
  assert(otherRange, 'the original map has an ordinary external range using shared cooking dispatch');
  const name = types.LocType.get(visible(q, otherRange.type, 'LocType')).debugname;
  itemOnLoc(q, 'raw_monkfish', name, '[oplocu,range]', loc => loc === otherRange);
  assert.equal(count(q, 'raw_monkfish'), 0); assert.equal(count(q, 'monkfish'), 1, 'tradeable monkfish cook through the ordinary skill outside Piscatoris');
}

console.log('PASS Swan Song: native end-to-end progression, original-map routes, rewards, ownership, recovery, skills and post-quest services');
process.exit(0);
