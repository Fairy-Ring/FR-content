import assert from 'node:assert/strict';

import {
  World, types, player as basePlayer, id, inv, worn, count, engineModule, execute,
  beginLocUse, held, button, resumeDialogue, ScriptState,
  PlayerLoading, Packet, map
} from '../swamp-caves/runtime.mjs';
const { placements } = (await import('../loc-option-audit/audit.mts')).readPlacements();
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const OpLocHandler = (await engineModule('network/game/client/handler/OpLocHandler.ts')).default;
const OpNpc = (await engineModule('network/game/client/model/OpNpc.ts')).default;
const OpNpcHandler = (await engineModule('network/game/client/handler/OpNpcHandler.ts')).default;
const PlayerStat = (await engineModule('engine/entity/PlayerStat.ts')).PlayerStat;
const { getExpByLevel } = await engineModule('engine/entity/Player.ts');
const OpObj = (await engineModule('network/game/client/model/OpObj.ts')).default;
const OpObjHandler = (await engineModule('network/game/client/handler/OpObjHandler.ts')).default;
const Environment = (await engineModule('util/Environment.ts')).default;
const rsbuf = await engineModule('network/rsbuf/index.ts');
const NpcStat = (await engineModule('engine/entity/NpcStat.ts')).NpcStat;
assert.equal(Environment.NODE_XPRATE, 1, 'period XP rewards use the normal rate');

World.vars = new Int32Array(types.VarSharedType.count);
World.varsString = new Array(types.VarSharedType.count);
const locHandler = new OpLocHandler();
const npcHandler = new OpNpcHandler();
const objHandler = new OpObjHandler();
const obj = name => id('ObjType', name);
const varp = name => id('VarPlayerType', name);
const varbit = name => id('VarBitType', name);
const shared = name => World.vars[id('VarSharedType', name)];
const setShared = (name, value) => { World.vars[id('VarSharedType', name)] = value; };
const stat = name => PlayerStat[name.toUpperCase()];
const setSkill = (p, name, level) => {
  const index = stat(name);
  p.baseLevels[index] = level;
  p.levels[index] = level;
  p.stats[index] = level > 1 ? getExpByLevel(level) : 0;
};
function player() {
  const p = basePlayer();
  rsbuf.addPlayer(p.slot);
  for (let index = 0; index < p.stats.length; index++) p.stats[index] = getExpByLevel(p.baseLevels[index]);
  return p;
}
function barXp(name) {
  const recipe = types.ObjType.get(obj(name)).params.get(id('ParamType', 'smelting_struct'));
  return types.StructType.get(recipe).params.get(id('ParamType', 'productexp'));
}
const itemCount = (p, name, container = inv) => p.invTotal(container, obj(name));
const stored = (p, name) => execute('[proc,bf_count]', p, [obj(name)]).popInt();
const access = p => execute('[proc,bf_access]', p).popInt() === 1;
const pay = p => execute('[proc,bf_pay]', p).popInt() === 1;
const inside = p => execute('[proc,bf_inside]', p).popInt() === 1;

function resetMachine() {
  for (const name of ['bf_temperature', 'bf_fuel', 'bf_conveyor_until', 'bf_faults', 'bf_wear', 'bf_next_fault']) setShared(name, 0);
}
function roomTick(foreman) {
  World.currentTick++;
  foreman.turn();
}
function typeId(kind, name) {
  const value = id(kind, name);
  assert.notEqual(value, -1, `packed ${kind} ${name} exists`);
  return value;
}
function locRow(name) {
  const type = typeId('LocType', name);
  const row = placements.find(candidate => candidate.type === type && (name !== 'dwarf_keldagrim_factory_stairs' || candidate.x === 2930 && candidate.z === 10196 && candidate.level === 0));
  assert(row, `packed map places ${name}`);
  return row;
}
function locAt(name) {
  const row = locRow(name);
  const loc = World.getLoc(row.x, row.z, row.level, row.type);
  assert(loc, `loaded packed location ${name}`);
  return loc;
}
function npcOf(name) {
  const type = typeId('NpcType', name);
  const npc = [...World.npcs].find(candidate => candidate.type === type);
  assert(npc, `loaded packed NPC ${name}`);
  return npc;
}
function position(p, tile) {
  p.level = tile.level;
  p.x = p.originX = tile.x;
  p.z = p.originZ = tile.z;
}
function standCandidates(target) {
  const type = types.LocType.get(target.type);
  let width = Math.max(1, type.width);
  let length = Math.max(1, type.length);
  if (target.angle & 1) [width, length] = [length, width];
  const result = [];
  for (let x = target.x - 1; x <= target.x + width; x++) {
    for (let z = target.z - 1; z <= target.z + length; z++) {
      if (x >= target.x && x < target.x + width && z >= target.z && z < target.z + length) continue;
      if (!map.isMapBlocked(x, z, target.level) && map.reachedLoc(target.level, x, z, target.x, target.z, target.width, target.length, 1, target.angle, target.shape, type.forceapproach)) result.push({ x, z, level: target.level });
    }
  }
  return result;
}
function npcStandCandidates(target) {
  const type = types.NpcType.get(target.type);
  const size = Math.max(1, type.size);
  const result = [];
  for (let x = target.x - 1; x <= target.x + size; x++) {
    for (let z = target.z - 1; z <= target.z + size; z++) {
      if (x >= target.x && x < target.x + size && z >= target.z && z < target.z + size) continue;
      if (!map.isMapBlocked(x, z, target.level) && map.reachedEntity(target.level, x, z, target.x, target.z, size, size, 1)) result.push({ x, z, level: target.level });
    }
  }
  return result;
}
function chooseStand(p, target, isNpc = false) {
  const candidates = isNpc ? npcStandCandidates(target) : standCandidates(target);
  const reachable = candidates
    .map(tile => ({ tile, route: map.findPath(p.level, p.x, p.z, tile.x, tile.z) }))
    .filter(({ tile, route }) => p.level === tile.level && (p.x === tile.x && p.z === tile.z || route.length > 0));
  if (reachable.length) return reachable.sort((a, b) => a.route.length - b.route.length)[0].tile;
  assert(candidates.length, 'target has a walkable adjacent tile on the packed map');
  return candidates[0];
}
function setNear(p, target, isNpc = false) {
  position(p, chooseStand(p, target, isNpc));
}
function assertPathTo(p, target, label, isNpc = false) {
  const candidate = chooseStand(p, target, isNpc);
  assert(!map.isMapBlocked(candidate.x, candidate.z, candidate.level), `${label} stand is walkable`);
  const path = map.findPath(p.level, p.x, p.z, candidate.x, candidate.z);
  assert(p.x === candidate.x && p.z === candidate.z || path.length > 0, `${label} has a packed-map route from the landing`);
  return candidate;
}
const packedApproaches = [];
function recordLocApproach(p, name, loc) {
  const stand = assertPathTo(p, loc, name);
  packedApproaches.push({
    kind: 'loc',
    name,
    stand: { x: stand.x, z: stand.z, level: stand.level },
    target: { id: loc.baseType, x: loc.x, z: loc.z, level: loc.level, shape: loc.shape, angle: loc.angle }
  });
}
function recordNpcApproach(p, name, npc) {
  const stand = assertPathTo(p, npc, name, true);
  packedApproaches.push({
    kind: 'npc',
    name,
    stand: { x: stand.x, z: stand.z, level: stand.level },
    target: { id: npc.type, x: npc.x, z: npc.z, level: npc.level, shape: null, angle: null }
  });
}
function emitPackedApproaches() {
  console.log(`PACKED_APPROACHES ${JSON.stringify(packedApproaches)}`);
}
function finishInteraction(p, choices = [], label = 'native interaction') {
  const pending = [...choices];
  for (let step = 0; step < 80; step++) {
    const state = p.activeScript;
    if (!state) break;
    assert.notEqual(state.execution, ScriptState.ABORTED, `${label} does not abort`);
    if (state.execution === ScriptState.FINISHED) break;
    if (state.execution === ScriptState.PAUSEBUTTON) {
      const root = p.modalChat >= 0 ? types.Component.get(p.modalChat)?.comName ?? '' : '';
      if (/^multi[2-5]$/.test(root)) {
        assert(pending.length, `${label} provides its dialogue choice`);
        resumeDialogue(p, pending.shift());
      } else {
        resumeDialogue(p);
      }
      continue;
    }
    if (state.execution === ScriptState.COUNTDIALOG) assert.fail(`${label} unexpectedly opens a count dialog`);
    if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
      continue;
    }
    assert.fail(`${label} stops at script state ${state.execution}`);
  }
  assert.equal(pending.length, 0, `${label} consumes every supplied dialogue choice`);
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED, `${label} finishes`);
}
function nativeLoc(p, loc, option = 1, choices = []) {
  setNear(p, loc);
  assert(locHandler.handle(new OpLoc(option, loc.x, loc.z, loc.type), p), `OpLoc${option} accepts ${types.LocType.get(loc.type).debugname}`);
  const script = p.getOpTrigger();
  assert(script, 'production location dispatch selects a packed script');
  p.processInteraction();
  finishInteraction(p, choices, script.name);
  return script;
}
function nativeNpc(p, npc, choices = []) {
  setNear(p, npc, true);
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, p.generateAppearance(), p.lastAppearance,
    p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ,
    p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[PlayerStat.HITPOINTS], p.baseLevels[PlayerStat.HITPOINTS],
    p.animId, p.animDelay, p.sayMessage, p.chatMessage, p.chatColour ?? -1,
    p.chatEffect ?? -1, p.chatRights ?? 0, p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(npc.x, npc.level, npc.z, npc.nid, npc.type, npc.tele, npc.jump,
    npc.runDir, npc.walkDir, npc.isActive, npc.masks, npc.faceEntity, npc.faceSquareX,
    npc.faceSquareZ, npc.faceAngleX, npc.faceAngleZ, npc.hitmarkDamage, npc.hitmarkType,
    npc.hitmark2Damage, npc.hitmark2Type, npc.levels[NpcStat.HITPOINTS],
    npc.baseLevels[NpcStat.HITPOINTS], npc.animId, npc.animDelay, npc.sayMessage,
    npc.spotanimId, npc.spotanimHeight, npc.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, npc.nid), 'the natural packed Foreman is in the real client NPC list');
  assert(npcHandler.handle(new OpNpc(1, npc.nid), p), 'production Talk-to packet accepts the packed Foreman');
  const script = p.getOpTrigger();
  assert(script, 'production NPC dispatch selects a packed script');
  p.processInteraction();
  finishInteraction(p, choices, script.name);
  assert.equal(npc.timerInterval, 1, 'Talk-to preserves the Foreman room timer through the real NPC default reset');
  return script;
}
function nativeItemOnLoc(p, item, loc) {
  setNear(p, loc);
  assert(beginLocUse(p, item, loc, { x: p.x, z: p.z }), `production item-on-location handler accepts ${item}`);
  const script = p.getOpTrigger();
  assert(script, `item-on-location selects a packed script for ${item}`);
  p.processInteraction();
  finishInteraction(p, [], script.name);
  return script;
}
function nativeHeld(p, item, option = 1) {
  assert(held(p, item, option), `production item option accepts ${item}`);
  finishInteraction(p, [], `item option ${option}: ${item}`);
}
function nativeButton(p, component) {
  assert(button(p, `blast_furnace_bar_stock:${component}`), `production IF_BUTTON accepts ${component}`);
  finishInteraction(p, [], `blast_furnace_bar_stock:${component}`);
}
function recoverGroundTool(p, name) {
  let ground = null;
  for (let x = 1930; x <= 1958 && !ground; x++) {
    for (let z = 4948; z <= 4982 && !ground; z++) ground = World.getObj(x, z, 0, obj(name), p.hash64);
  }
  assert(ground, `${name} has a real recovery spawn in the original room`);
  const stands = [];
  for (let x = ground.x - 1; x <= ground.x + 1; x++) {
    for (let z = ground.z - 1; z <= ground.z + 1; z++) {
      if (map.isMapBlocked(x, z, 0)) continue;
      if (!map.reachedEntity(0, x, z, ground.x, ground.z, 1, 1, 1) && !map.reachedObj(0, x, z, ground.x, ground.z, 1, 1, 1)) continue;
      const route = map.findPath(p.level, p.x, p.z, x, z);
      if (route.length > 0 || p.x === x && p.z === z) stands.push({ x, z, level: 0, distance: route.length });
    }
  }
  assert(stands.length > 0, `${name} recovery pickup has a walkable, reachable stand on the packed map`);
  position(p, stands.sort((a, b) => a.distance - b.distance)[0]);
  assert(objHandler.handle(new OpObj(3, ground.x, ground.z, ground.type), p), `${name} Take packet is accepted`);
  p.processInteraction();
  finishInteraction(p, [], `${name} recovery pickup`);
  assert.equal(itemCount(p, name), 1, `${name} is recovered through the real ground option`);
}
function enter(p, entrance) {
  nativeLoc(p, entrance, 1);
  assert(inside(p), 'the packed Keldagrim stair enters the furnace room without a fee gate');
  assert.deepEqual({ x: p.x, z: p.z, level: p.level }, { x: 1939, z: 4958, level: 0 }, 'entry lands in the original furnace cellar');
  assert(!map.isMapBlocked(p.x, p.z, p.level), 'cellar landing is walkable');
  assert(map.findPath(0, p.x, p.z, 1940, 4959).length > 0, 'cellar landing has a non-empty route into the room');
}
function exit(p, stairs) {
  nativeLoc(p, stairs, 1);
  assert(!inside(p), 'the packed furnace stair returns to Keldagrim');
  assert.deepEqual({ x: p.x, z: p.z, level: p.level }, { x: 2931, z: 10195, level: 0 }, 'exit lands beside the Keldagrim counterpart');
  assert(!map.isMapBlocked(p.x, p.z, p.level), 'Keldagrim landing is walkable');
  assert(map.findPath(0, p.x, p.z, 2931, 10196).length > 0, 'Keldagrim landing has a non-empty egress route');
}
function loadFromInventory(p, item, belt) {
  nativeItemOnLoc(p, item, belt);
}
function openStock(p, dispenser) {
  nativeLoc(p, dispenser, 1);
  assert.equal(p.modalMain, id('Component', 'blast_furnace_bar_stock'), 'cooled dispenser opens the packed bar-stock interface');
}
function storeUntil(p, name) {
  return p.getVar(varp(name));
}

try {
  resetMachine();
  const entrance = locAt('dwarf_keldagrim_factory_stairs');
  const exitStairs = locAt('blast_furnace_stairs_up');
  const foreman = npcOf('blast_furnace_instructor');
  assert.equal(foreman.timerInterval, 1, 'the natural Foreman config starts the recurring room timer');
  setShared('bf_fuel', 2);
  roomTick(foreman);
  assert.equal(shared('bf_fuel'), 1, 'the autonomous NPC turn advances the room without a player script context');
  resetMachine();
  const belt = locAt('blast_furnace_conveyer_belt_clickable');
  const coke = locAt('blast_furnace_coke');
  const stove = locAt('blast_furnace_stove_low');
  const pump = locAt('blast_furnace_pump');
  const pedals = locAt('blast_furnace_pedals');
  const pipes = ['blast_furnace_pipes2', 'blast_furnace_pipes6', 'blast_furnace_conveyer_cogs', 'blast_furnace_conveyer_cogs2'].map(locAt);
  const gauge = locAt('blast_furnace_gauge');
  const sink = locAt('blast_furnace_sink');
  const dispenser = locAt('blast_furnace_dispenser');
 

  for (const name of ['blast_furnace_1', 'blast_furnace_2', 'blast_furnace_3', 'blast_furnace_4', 'blast_furnace_5']) {
    assert.equal(types.VarPlayerType.get(varp(name)).scope, types.VarPlayerType.SCOPE_PERM, `${name} stores ore/bar state across logout`);
  }
  assert.equal(types.VarPlayerType.get(varp('blast_furnace_readings')).scope, types.VarPlayerType.SCOPE_TEMP, 'derived readings remain temporary');
  assert.equal(types.VarPlayerType.get(varp('blast_furnace_access_until')).scope, types.VarPlayerType.SCOPE_PERM, 'paid access deadline survives logout');

  // The entrance is free: an under-60 worker must be able to reach the Foreman inside.
  const paid = player();
  setSkill(paid, 'smithing', 59);
  position(paid, { x: 2931, z: 10195, level: 0 });
  recordLocApproach(paid, 'dwarf_keldagrim_factory_stairs', entrance);
  enter(paid, entrance);
  recordNpcApproach(paid, 'blast_furnace_instructor', foreman);
  recordLocApproach(paid, 'blast_furnace_conveyer_belt_clickable', belt);
  recordLocApproach(paid, 'blast_furnace_coke', coke);
  recordLocApproach(paid, 'blast_furnace_stove_low', stove);
  recordLocApproach(paid, 'blast_furnace_pump', pump);
  recordLocApproach(paid, 'blast_furnace_pedals', pedals);
  recordLocApproach(paid, 'blast_furnace_pipes2', pipes[0]);
  recordLocApproach(paid, 'blast_furnace_pipes6', pipes[1]);
  recordLocApproach(paid, 'blast_furnace_conveyer_cogs', pipes[2]);
  recordLocApproach(paid, 'blast_furnace_conveyer_cogs2', pipes[3]);
  recordLocApproach(paid, 'blast_furnace_gauge', gauge);
  recordLocApproach(paid, 'blast_furnace_sink', sink);
  recordLocApproach(paid, 'blast_furnace_dispenser', dispenser);
  recordLocApproach(paid, 'blast_furnace_stairs_up', exitStairs);
  emitPackedApproaches();

  assert.equal(access(paid), false, 'an unpaid sub-60 worker has no machine access');
  assert.equal(pay(paid), false, 'the Foreman payment refuses when the player lacks coins');
  assert.equal(storeUntil(paid, 'blast_furnace_access_until'), 0, 'a refused fee does not create access');
  paid.invAdd(inv, obj('coins'), 2500);
  nativeNpc(paid, foreman, [1]);
  assert.equal(itemCount(paid, 'coins'), 0, 'the paid Foreman route consumes exactly 2,500 coins');
  assert(access(paid), 'paid access is accepted');
  const nowMinutes = Math.floor(Date.now() / 60000);
  const deadline = storeUntil(paid, 'blast_furnace_access_until');
  assert(deadline - nowMinutes >= 9 && deadline - nowMinutes <= 10, 'paid access lasts ten date-minutes');
  const savedAccess = PlayerLoading.load(paid.username, new Packet(paid.save()), null);
  assert.equal(savedAccess.getVar(varp('blast_furnace_access_until')), deadline, 'paid access is saved across logout');

  const runiteRecipe = types.ObjType.get(obj('runite_bar')).params.get(id('ParamType', 'smelting_struct'));
  const runiteLevel = types.StructType.get(runiteRecipe).params.get(id('ParamType', 'levelrequired'));
  assert(runiteLevel > 0, 'packed runite recipe has a Smithing level gate');
  setSkill(paid, 'smithing', runiteLevel - 1);
  paid.invAdd(inv, obj('runite_ore'), 1);
  loadFromInventory(paid, 'runite_ore', belt);
  assert.equal(itemCount(paid, 'runite_ore'), 1, 'below-recipe-level loading does not consume runite ore');
  assert.equal(stored(paid, 'runite_ore'), 0, 'below-recipe-level loading stores no runite ore');
  setSkill(paid, 'smithing', 99);
  const acceptedInputs = ['coal', 'copper_ore', 'tin_ore', 'iron_ore', 'silver_ore', 'gold_ore', 'mithril_ore', 'adamantite_ore', 'runite_ore'];
  for (const item of acceptedInputs) {
    if (item !== 'runite_ore') paid.invAdd(inv, obj(item), 1);
    loadFromInventory(paid, item, belt);
    assert.equal(itemCount(paid, item), 0, `${item} is consumed by the conveyor`);
    assert.equal(stored(paid, item), 1, `${item} is stored in this account's furnace varps`);
  }
  paid.invAdd(inv, obj('perfect_gold_ore'), 1);
  loadFromInventory(paid, 'perfect_gold_ore', belt);
  assert.equal(itemCount(paid, 'perfect_gold_ore'), 1, 'unsupported perfect gold ore is not consumed');
  assert.equal(stored(paid, 'perfect_gold_ore'), 0, 'unsupported perfect gold ore is not stored');
  const savedOres = PlayerLoading.load(paid.username, new Packet(paid.save()), null);
  for (const item of acceptedInputs) assert.equal(stored(savedOres, item), 1, `${item} storage survives logout`);
  assert.equal(stored(player(), 'iron_ore'), 0, 'another account cannot see the worker’s deposited ores');

  // Exiting clears the paid deadline; re-entry remains free but loading again requires payment.
  setSkill(paid, 'smithing', 59);
  exit(paid, exitStairs);
  assert.equal(storeUntil(paid, 'blast_furnace_access_until'), 0, 'leaving clears the ten-minute deadline');
  assertPathTo(paid, entrance, 'Keldagrim entrance after exit');
  enter(paid, entrance);
  assert.equal(access(paid), false, 'a sub-60 worker must pay again after leaving');
  paid.invAdd(inv, obj('coal'), 1);
  loadFromInventory(paid, 'coal', belt);
  assert.equal(itemCount(paid, 'coal'), 1, 'unpaid re-entry cannot load fuel');
  paid.invDel(inv, obj('coal'), 1);
  exit(paid, exitStairs);

  const free = player();
  setSkill(free, 'smithing', 60);
  enter(free, entrance);
  assert(access(free), '60 Smithing grants free furnace access');
  assert(pay(free), 'free access does not require a payment');
  assert.equal(itemCount(free, 'coins'), 0, 'free access takes no coins');
  exit(free, exitStairs);

  // Per-account primary and coal capacities are independent and never overflow.
  const capped = player();
  enter(capped, entrance);
  capped.invAdd(inv, obj('iron_ore'), 28);
  loadFromInventory(capped, 'iron_ore', belt);
  assert.equal(stored(capped, 'iron_ore'), 28, 'primary ore capacity is 28');
  assert.equal(itemCount(capped, 'iron_ore'), 0, 'all 28 available primary ores fit');
  capped.invAdd(inv, obj('iron_ore'), 1);
  loadFromInventory(capped, 'iron_ore', belt);
  assert.equal(itemCount(capped, 'iron_ore'), 1, 'a full primary store preserves the extra ore');
  assert.equal(stored(capped, 'iron_ore'), 28, 'primary storage never exceeds 28');
  exit(capped, exitStairs);

  const coalWorker = player();
  enter(coalWorker, entrance);
  for (let batch = 0; batch < 10; batch++) {
    coalWorker.invAdd(inv, obj('coal'), 28);
    loadFromInventory(coalWorker, 'coal', belt);
  }
  assert.equal(stored(coalWorker, 'coal'), 254, 'coal capacity is 254');
  assert.equal(itemCount(coalWorker, 'coal'), 26, 'coal above capacity remains with its owner');
  exit(coalWorker, exitStairs);

  // Shared stove, pump, pedal, cooling and per-account stocks are exercised through native packets.
  resetMachine();
  const worker = player();
  enter(worker, entrance);
  setSkill(worker, 'firemaking', 29);
  worker.invAdd(inv, obj('spade'), 1);
  nativeLoc(worker, coke, 1);
  assert.equal(itemCount(worker, 'blast_furnace_coke_spade'), 1, 'coke is collected with the real spade option');
  assert.equal(types.ObjType.get(obj('blast_furnace_coke_spade')).tradeable, false, 'the private coke tool cannot be traded or revealed to other accounts');
  nativeHeld(worker, 'blast_furnace_coke_spade', 5);
  assert.equal(itemCount(worker, 'blast_furnace_coke_spade'), 0, 'dropping the intermediate coke tool removes it');
  recoverGroundTool(worker, 'spade');
  nativeLoc(worker, coke, 1);
  assert.equal(itemCount(worker, 'blast_furnace_coke_spade'), 1, 'losing the coke tool is recoverable from the original spade spawn');
  nativeHeld(worker, 'blast_furnace_coke_spade', 1);
  assert.equal(itemCount(worker, 'spade'), 1, 'Empty recovers the ordinary spade');
  nativeLoc(worker, coke, 1);
  nativeItemOnLoc(worker, 'blast_furnace_coke_spade', stove);
  assert.equal(shared('bf_fuel'), 0, 'Firemaking 29 cannot refuel');
  assert.equal(itemCount(worker, 'blast_furnace_coke_spade'), 1, 'the Firemaking refusal preserves coke');
  setSkill(worker, 'firemaking', 30);
  const firemakingBefore = worker.stats[stat('firemaking')];
  nativeItemOnLoc(worker, 'blast_furnace_coke_spade', stove);
  assert.equal(shared('bf_fuel'), 100, 'one coke spade fuels the shared stove');
  assert.equal(types.LocType.get(stove.type).debugname, 'blast_furnace_stove_low', '100 fuel retains the low stove form');
  for (const [expectedFuel, expectedForm] of [[200, 'blast_furnace_stove_medium'], [300, 'blast_furnace_stove_full']]) {
    nativeLoc(worker, coke, 1);
    nativeItemOnLoc(worker, 'blast_furnace_coke_spade', stove);
    assert.equal(shared('bf_fuel'), expectedFuel, `${expectedForm} fuel is shared`);
    assert.equal(types.LocType.get(stove.type).debugname, expectedForm, `${expectedForm} is the visible stove form`);
  }
  assert.equal(worker.stats[stat('firemaking')] - firemakingBefore, 150, 'three shovel-fulls award exactly 15 Firemaking XP');

  setSkill(worker, 'strength', 29);
  nativeLoc(worker, pump, 1);
  assert.equal(shared('bf_temperature'), 0, 'Strength 29 cannot operate the pump');
  setSkill(worker, 'strength', 30);
  const strengthBefore = worker.stats[stat('strength')];
  for (let pulse = 0; pulse < 4; pulse++) nativeLoc(worker, pump, 1);
  assert.equal(shared('bf_temperature'), 100, 'four native pump actions raise heat into the green band');
  assert.equal(worker.stats[stat('strength')] - strengthBefore, 40, 'four pump actions award exactly 4 Strength XP');

  nativeLoc(worker, gauge, 1);
  assert.equal(worker.modalMain, id('Component', 'blast_furnace_temp_gauge'), 'the gauge opens through its real location action');
  assert.equal(worker.getVarBit(varbit('blast_furnace_temperature_reading')), shared('bf_temperature'), 'gauge reading reflects shared heat');
  assert.equal(worker.getVarBit(varbit('blast_furnace_fuel_low_reading')), 0, 'fuel reading reports a fueled stove');
  assert(worker.packets.some(packet => packet.constructor.name === 'IfSetText' && packet.text.includes('Heat:') && packet.text.includes('Green')), 'gauge sends its live green heat label');
  // The original dial has 101 one-frame poses; their sequence names are not in frame order.
  const gaugeComponents = [2, 3, 4].map(index => id('Component', `blast_furnace_temp_gauge:com_${index}`));
  const firstNeedleFrame = types.SeqType.get(id('SeqType', 'blast_furnace_temp_gauge1')).frames[0];
  const gaugeMachineBefore = ['bf_temperature', 'bf_fuel', 'bf_faults'].map(shared);
  for (let reading = 0; reading <= 255; reading++) {
    const fuelLow = (reading & 1) !== 0, broken = (reading & 2) !== 0;
    setShared('bf_temperature', reading);
    setShared('bf_fuel', fuelLow ? 99 : 100);
    setShared('bf_faults', broken ? 1 : 0);
    execute('[proc,bf_update_readings]', worker);
    const packetStart = worker.packets.length;
    execute('[proc,bf_gauge_refresh]', worker);
    const packets = worker.packets.slice(packetStart);
    const animations = gaugeComponents.map(component => packets.find(packet => packet.constructor.name === 'IfSetAnim' && packet.component === component));
    assert(animations.every(Boolean), 'fuel, broken-part and needle models each receive a real IfSetAnim');
    assert.equal(animations[0].seq, id('SeqType', `temp_gauge_flag_fuel_low_${fuelLow ? 'out' : 'in'}`), 'right-hand component 2 animates only the Fuel Low flag');
    assert.equal(animations[1].seq, id('SeqType', `temp_gauge_flag_pipe_broken_${broken ? 'out' : 'in'}`), 'left-hand component 3 animates only the Broken Parts flag');
    const needle = types.SeqType.get(animations[2].seq);
    assert.equal(needle.frameCount, 1, 'the needle uses an original single-frame pose');
    assert.equal(needle.frames[0], firstNeedleFrame + Math.floor(reading * 100 / 255), 'all byte readings select the original needle poses in frame order');
    assert.equal(packets.some(packet => packet.constructor.name === 'IfSetAngle' && packet.component === gaugeComponents[2]), false, 'the whole dial case is never rotated');
  }
  ['bf_temperature', 'bf_fuel', 'bf_faults'].forEach((name, index) => setShared(name, gaugeMachineBefore[index]));
  execute('[proc,bf_update_readings]', worker);
  execute('[proc,bf_gauge_refresh]', worker);
  const pumper = player();
  enter(pumper, entrance);
  nativeLoc(pumper, pump, 1);
  const gaugePacketStart = worker.packets.length;
  roomTick(foreman);
  assert.equal(worker.modalMain, id('Component', 'blast_furnace_temp_gauge'), 'another player can pump while the reader keeps the gauge open');
  assert.equal(worker.getVarBit(varbit('blast_furnace_temperature_reading')), shared('bf_temperature'), 'the room timer refreshes the open gauge');
  assert(worker.packets.slice(gaugePacketStart).some(packet => packet.constructor.name === 'IfSetText' && packet.text.includes(`Heat: ${shared('bf_temperature')}`)), 'the open gauge receives a refreshed heat packet');

  const secondary = player();
  enter(secondary, entrance);
  secondary.invAdd(inv, obj('iron_ore'), 1);
  loadFromInventory(secondary, 'iron_ore', belt);
  assert.equal(stored(secondary, 'iron_ore'), 1, 'second account stores its own ore');
  assert.equal(stored(worker, 'iron_ore'), 0, 'first account cannot see the second account’s ore');

  worker.invAdd(inv, obj('iron_ore'), 2);
  loadFromInventory(worker, 'iron_ore', belt);
  setSkill(worker, 'agility', 29);
  nativeLoc(worker, pedals, 1);
  assert.equal(shared('bf_conveyor_until'), 0, 'Agility 29 cannot drive the belt');
  setSkill(worker, 'agility', 30);
  const agilityBefore = worker.stats[stat('agility')];
  const energyBefore = worker.runenergy;
  nativeLoc(worker, pedals, 1);
  assert(shared('bf_conveyor_until') > 0, 'pedalling starts the shared conveyor');
  assert.equal(worker.stats[stat('agility')] - agilityBefore, 10, 'one pedal pulse awards exactly 1 Agility XP');
  assert.equal(energyBefore - worker.runenergy, 100, 'one pedal pulse consumes exactly 1% run energy');
  roomTick(foreman);
  assert.equal(stored(worker, 'iron_bar'), 2, 'iron smelts with no coal and succeeds for every deposited ore');
  assert.equal(stored(secondary, 'iron_bar'), 1, 'the shared conveyor processes another worker’s ore');
  assert.equal(stored(worker, 'iron_ore'), 0, 'smelting removes the worker’s deposited ore');
  assert.equal(stored(secondary, 'iron_ore'), 0, 'smelting removes the second worker’s deposited ore');
  assert.equal(worker.getVarBit(varbit('blast_furnace_bars_hot')), 2, 'new bars are hot');
  assert.equal(worker.getVarBit(varbit('blast_furnace_broken_pipe_reading')), 0, 'working machinery has no broken-pipe reading');

  const hotSave = PlayerLoading.load(worker.username, new Packet(worker.save()), null);
  assert.equal(stored(hotSave, 'iron_bar'), 2, 'unclaimed bars persist across logout');
  assert.equal(hotSave.getVar(varp('blast_furnace_5')), worker.getVar(varp('blast_furnace_5')), 'saved cooling remainder persists');
  execute('[proc,bf_update_readings]', hotSave);
  assert.equal(hotSave.getVarBit(varbit('blast_furnace_bars_hot')), 2, 'hot state reconstructs from saved cooling after logout');

  // The hot form offers no retrieval; a water bucket cools it, and the nearby sink refills it.
  const hotFormAccepted = locHandler.handle(new OpLoc(1, dispenser.x, dispenser.z, dispenser.type), worker);
  assert.equal(hotFormAccepted, false, 'hot dispenser has no retrieve option');
  worker.invAdd(inv, obj('bucket_water'), 1);
  nativeItemOnLoc(worker, 'bucket_water', dispenser);
  assert.equal(worker.getVarBit(varbit('blast_furnace_bars_hot')), 3, 'water cools the worker’s bars');
  assert.equal(itemCount(worker, 'bucket_water'), 0, 'cooling consumes the water bucket');
  assert.equal(itemCount(worker, 'bucket_empty'), 1, 'cooling returns an empty bucket');
  nativeLoc(worker, sink, 1);
  assert.equal(itemCount(worker, 'bucket_water'), 1, 'the furnace sink refills an empty bucket');

  openStock(worker, dispenser);
  worker.invClear(inv);
  worker.invAdd(inv, obj('spade'), 28);
  assert.equal(worker.invFreeSpace(inv), 0, 'the inventory is full for the claim safety check');
  nativeButton(worker, 'com_75');
  assert.equal(stored(worker, 'iron_bar'), 2, 'a full inventory does not consume stored bars');
  worker.invClear(inv);
  const smithingBeforeClaim = worker.stats[stat('smithing')];
  nativeButton(worker, 'com_75');
  assert.equal(itemCount(worker, 'iron_bar'), 1, 'a single-bar button claims one iron bar');
  assert.equal(stored(worker, 'iron_bar'), 1, 'claiming removes only the delivered bar from stock');
  assert.equal(worker.stats[stat('smithing')] - smithingBeforeClaim, barXp('iron_bar'), 'claiming iron grants exactly the ordinary recipe XP');
  for (let tick = 0; tick < 50; tick++) {
    roomTick(foreman);
  }
  assert.equal(secondary.getVarBit(varbit('blast_furnace_bars_hot')), 3, 'waiting cools the second account’s bars without water');
  assert.equal(stored(secondary, 'iron_bar'), 1, 'passive cooling preserves the second account’s stock');

  // All supported recipes exercise their 1/2/3/4 coal ratios and every stock button.
  worker.invAdd(inv, obj('copper_ore'), 2);
  worker.invAdd(inv, obj('tin_ore'), 2);
  worker.invAdd(inv, obj('iron_ore'), 1);
  worker.invAdd(inv, obj('silver_ore'), 1);
  worker.invAdd(inv, obj('gold_ore'), 2);
  worker.invAdd(inv, obj('mithril_ore'), 1);
  worker.invAdd(inv, obj('adamantite_ore'), 1);
  worker.invAdd(inv, obj('runite_ore'), 1);
  worker.invAdd(inv, obj('coal'), 10);
  for (const item of ['copper_ore', 'tin_ore', 'iron_ore', 'silver_ore', 'gold_ore', 'mithril_ore', 'adamantite_ore', 'runite_ore', 'coal']) {
    loadFromInventory(worker, item, belt);
  }
  const coalBeforeSmelt = stored(worker, 'coal');
  assert.equal(coalBeforeSmelt, 10, 'one steel, two mithril, three adamantite and four rune ores need ten coal');
  nativeLoc(worker, pedals, 1);
  roomTick(foreman);
  for (const [bar, amount] of [
    ['bronze_bar', 2], ['steel_bar', 1], ['silver_bar', 1], ['gold_bar', 2],
    ['mithril_bar', 1], ['adamantite_bar', 1], ['runite_bar', 1]
  ]) assert.equal(stored(worker, bar), amount, `${bar} output matches its ore recipe`);
  assert.equal(stored(worker, 'coal'), 0, 'half-coal recipes consume exactly the deposited ten coal');
  worker.invAdd(inv, obj('bucket_water'), 1);
  nativeItemOnLoc(worker, 'bucket_water', dispenser);
  openStock(worker, dispenser);

  const buttons = [
    ['com_78', 'bronze_bar'], ['com_75', 'iron_bar'], ['com_92', 'steel_bar'], ['com_93', 'mithril_bar'],
    ['com_94', 'adamantite_bar'], ['com_95', 'runite_bar'], ['com_96', 'silver_bar'], ['com_97', 'gold_bar']
  ];
  for (const [component, bar] of buttons) {
    if (bar === 'gold_bar') {
      const before = worker.stats[stat('smithing')];
      nativeButton(worker, component);
      assert.equal(worker.stats[stat('smithing')] - before, barXp('gold_bar'), 'ordinary gold grants exactly the packed recipe XP');
      worker.invAdd(worn, obj('gauntlets_of_goldsmithing'), 1);
      const withGauntletsBefore = worker.stats[stat('smithing')];
      nativeButton(worker, 'com_107');
      assert.equal(worker.stats[stat('smithing')] - withGauntletsBefore, Math.floor(barXp('gold_bar') * 5 / 2), 'Goldsmith gauntlets grant exactly the existing 2.5x gold XP');
      assert.equal(stored(worker, bar), 0, 'both gold bars are claimed');
      continue;
    }
    if (bar === 'iron_bar') {
      nativeButton(worker, 'com_101');
      assert.equal(stored(worker, bar), 0, 'the bulk iron button claims the remaining iron bar');
      continue;
    }
    if (bar === 'bronze_bar') {
      nativeButton(worker, component);
      nativeButton(worker, 'com_100');
      assert.equal(stored(worker, bar), 0, 'single and bulk bronze buttons claim both bars');
      continue;
    }
    nativeButton(worker, component);
    assert.equal(stored(worker, bar), 0, `${component} claims its mapped product`);
  }
  for (const component of ['com_100', 'com_101', 'com_102', 'com_103', 'com_104', 'com_105', 'com_106', 'com_107',
    'com_109', 'com_110', 'com_111', 'com_112', 'com_113', 'com_114', 'com_115', 'com_116']) {
    if (component === 'com_107') continue;
    nativeButton(worker, component);
  }

  // A deterministic work pulse breaks each original pipe/cog form; hammer + Crafting 30 repairs it.
  setSkill(worker, 'crafting', 29);
  const brokenNames = [
    'blast_furnace_pipes2_broken', 'blast_furnace_pipes6_broken',
    'blast_furnace_conveyer_cogs_broken', 'blast_furnace_conveyer_cogs2_broken'
  ];
  for (let index = 0; index < pipes.length; index++) {
    for (let pulse = 0; pulse < 40; pulse++) execute('[proc,bf_wear_step]', worker);
    assert.equal(types.LocType.get(pipes[index].type).debugname, brokenNames[index], `${brokenNames[index]} appears after the UNKNOWN engineering work threshold`);
    execute('[proc,bf_update_readings]', worker);
    assert.equal(worker.getVarBit(varbit('blast_furnace_broken_pipe_reading')), 1, 'gauge reports a broken machine');
    nativeLoc(worker, pipes[index], 1);
    assert.equal(types.LocType.get(pipes[index].type).debugname, brokenNames[index], 'repair option without a hammer does not change the fault');
    worker.invAdd(inv, obj('hammer'), 1);
    nativeItemOnLoc(worker, 'hammer', pipes[index]);
    assert.equal(types.LocType.get(pipes[index].type).debugname, brokenNames[index], 'Crafting 29 cannot repair the machinery');
    setSkill(worker, 'crafting', 30);
    const craftingBefore = worker.stats[stat('crafting')];
    nativeItemOnLoc(worker, 'hammer', pipes[index]);
    assert.equal(types.LocType.get(pipes[index].type).debugname, ['blast_furnace_pipes2', 'blast_furnace_pipes6', 'blast_furnace_conveyer_cogs', 'blast_furnace_conveyer_cogs2'][index], 'hammer repairs the visible broken form');
    assert.equal(worker.stats[stat('crafting')] - craftingBefore, 500, 'repair awards exactly the period 50 Crafting XP');
    execute('[proc,bf_update_readings]', worker);
    assert.equal(worker.getVarBit(varbit('blast_furnace_broken_pipe_reading')), 0, 'repair clears the broken-pipe reading');
    worker.invDel(inv, obj('hammer'), itemCount(worker, 'hammer'));
    setSkill(worker, 'crafting', 29);
  }
  recoverGroundTool(worker, 'hammer');
  worker.invDel(inv, obj('bucket_empty'), itemCount(worker, 'bucket_empty'));
  recoverGroundTool(worker, 'bucket_empty');
  nativeLoc(worker, sink, 1);
  assert.equal(itemCount(worker, 'bucket_water'), 1, 'a lost bucket is recoverable from the original spawn and sink');

  console.log('PASS blast-furnace: access, packed routes, shared machinery, recipes, stock, cooling, persistence and repairs');
} catch (error) {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  // World owns worker threads; this is a standalone compiled-test process.
  process.exit(process.exitCode ?? 0);
}
