import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.on('uncaughtException', error => { console.error(error); process.exit(1); });
process.on('unhandledRejection', error => { console.error(error); process.exit(1); });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = path.resolve(process.env.HARNESS_ENGINE_DIR ?? path.join(root, '../engine'));
const option = process.argv.indexOf('--pack');
assert(option < 0 || process.argv[option + 1], '--pack requires a path');
const requested = path.resolve(option < 0 ? process.env.HARNESS_PACK_DIR ?? path.join(engine, 'data/pack') : process.argv[option + 1]);
const pack = path.basename(requested) === 'server' ? path.dirname(requested) : requested;
assert(fs.existsSync(path.join(pack, 'server/script.dat')), 'build the selected content pack first');
const load = relative => import(pathToFileURL(path.join(engine, 'src', relative)).href);
const World = (await load('engine/World.ts')).default;
const map = await load('engine/GameMap.ts');
const Player = (await load('engine/entity/Player.ts')).default;
const Npc = (await load('engine/entity/Npc.ts')).default;
const resolveNpcType = (await load('engine/entity/resolveNpcType.ts')).default;
const { EntityLifeCycle } = await load('engine/entity/EntityLifeCycle.ts');
const { PlayerStat } = await load('engine/entity/PlayerStat.ts');
const { NpcStat } = await load('engine/entity/NpcStat.ts');
const { PlayerTimerType } = await load('engine/entity/EntityTimer.ts');
const ScriptProvider = (await load('engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('engine/script/ScriptState.ts')).default;
const { ScriptOpcode } = await load('engine/script/ScriptOpcode.ts');
const ServerTriggerType = (await load('engine/script/ServerTriggerType.ts')).default;
const JavaRandom = (await load('util/JavaRandom.ts')).default;
const Environment = (await load('util/Environment.ts')).default;
const Packet = (await load('io/Packet.ts')).default;
const { PlayerLoading } = await load('engine/entity/PlayerLoading.ts');
const rsbuf = await load('network/rsbuf/index.ts');
const configs = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType',
  'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType',
  'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType']) {
  configs[name] = (await load(`cache/config/${name}.ts`)).default;
  configs[name].load(pack);
}
(await load('cache/config/DbTableIndex.ts')).default.init();
assert(ScriptProvider.load(pack) > 0);
assert.equal(Environment.NODE_MEMBERS, true);
const messages = {};
const handlers = {};
for (const name of ['OpNpc', 'OpNpcU', 'OpLoc', 'OpLocU', 'OpHeld', 'OpHeldU', 'OpHeldT', 'IfButton', 'ResumePauseButton']) {
  messages[name] = (await load(`network/game/client/model/${name}.ts`)).default;
  const Handler = (await load(`network/game/client/handler/${name}Handler.ts`)).default;
  handlers[name] = new Handler();
}
const id = (kind, name) => {
  const value = configs[kind].getId(name);
  assert.notEqual(value, -1, `${kind} missing: ${name}`);
  return value;
};
const obj = name => id('ObjType', name);
const component = name => id('Component', name);
const inv = id('InvType', 'inv');
const worn = id('InvType', 'worn');
const bank = id('InvType', 'bank');
const invCom = component('inventory:inv');
const wornCom = component('wornitems:worn');
const quest = id('VarBitType', 'myreque_2_quest');
const stage = p => p.getVarBit(quest);
const setStage = (p, value) => p.setVarBit(quest, value);
const count = (p, name, inventory = inv) => p.invTotal(inventory, obj(name));
const give = (p, name, amount = 1, inventory = inv) => assert.equal(p.invAdd(inventory, obj(name), amount), amount, name);
let serial = 0;
let checks = 0;
World.currentTick = Math.max(World.currentTick, 100);
World.gameMap.init();

function place(p, x, z, level = 0) {
  p.teleport(x, z, level);
  Object.assign(p, { originX: x, originZ: z });
}
function leavePlayer(p) {
  // Native World.removePlayer's in-memory teardown, without its disk-save/worker phase.
  rsbuf.removePlayer(p.slot);
  World.gameMap.getZone(p.x, p.z, p.level).leave(p);
  delete World.players[p.slot];
  p.unlink();
  map.changeNpcCollision(p.width, p.x, p.z, p.level, false);
  map.changePlayerOccCollision(p.width, p.x, p.z, p.level, false);
  p.isActive = false;
}
function player(saved = null) {
  const n = ++serial;
  const username37 = BigInt(20000 + n);
  const p = saved ? PlayerLoading.load(saved.username, new Packet(saved.data), null)
    : new Player(`myrequetest${n}`, username37, BigInt(2000000 + n));
  assert(p, 'native player save must load');
  Object.assign(p, { slot: n, pid: n, uid: ((Number(username37 & 0x1fffffn) << 11) | n) >>> 0, isActive: true });
  if (!saved) {
    p.vars.fill(0);
    p.stats.fill(123456);
    p.baseLevels.fill(99);
    p.levels.fill(99);
    place(p, 3508, 3240);
  } else place(p, p.x, p.z, p.level);
  p.messages = [];
  p.packets = [];
  p.write = packet => p.packets.push(packet);
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = text => p.messages.push(String(text));
  p.tabs[2] = component('questlist');
  p.tabs[3] = configs.Component.get(invCom).rootLayer;
  p.tabs[4] = configs.Component.get(wornCom).rootLayer;
  p.tabs[6] = component('magic');
  p.getInventory(inv);
  p.getInventory(worn);
  p.invListenOnCom(inv, invCom, p.uid);
  p.invListenOnCom(worn, wornCom, p.uid);
  // Lost City is only an equipment fixture for the ordinary dragon-weapon compatibility checks.
  for (const [name, value] of saved ? [] : [['tutorial', 1000], ['routequest', 105], ['druidspirit', 110], ['priestperil', 60], ['zanaris', 6]]) {
    p.setVar(id('VarPlayerType', name), value);
  }
  World.players[p.slot] = p;
  World.playerLoop.add(p.hash64, p);
  rsbuf.addPlayer(p.slot);
  showPlayer(p);
  return p;
}
function showPlayer(p) {
  const appearance = p.generateAppearance();
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, appearance, p.lastAppearance,
    p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ,
    p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[PlayerStat.HITPOINTS], p.baseLevels[PlayerStat.HITPOINTS], p.animId, p.animDelay,
    p.sayMessage, p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0,
    p.spotanimId, p.spotanimHeight, p.spotanimTime);
}
const entryScripts = new WeakMap();
function capture(p, action) {
  const states = [];
  const execute = p.executeScript;
  p.executeScript = function (state, ...args) {
    // Tail calls replace state.script; retain the native entry before executing it.
    if (!entryScripts.has(state)) entryScripts.set(state, state.script.name);
    states.push(state);
    return execute.call(this, state, ...args);
  };
  try { return { result: action(), states }; } finally { p.executeScript = execute; }
}
function finish(p, state, choices = []) {
  assert(state, 'native packet must dispatch a compiled script');
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 300; step++) {
    if (state.execution === ScriptState.PAUSEBUTTON) {
      p.activeScript = state;
      const modal = configs.Component.get(p.modalChat)?.comName;
      assert(modal, 'paused dialogue must expose its chat interface');
      if (/^multi[2-5]$/.test(modal)) {
        assert(choices.length, `missing choice in ${state.script.name}`);
        const button = component(`${modal}:com_${choices.shift()}`);
        p.lastCom = button;
        assert(handlers.IfButton.handle(new messages.IfButton(button), p));
      } else assert(handlers.ResumePauseButton.handle(new messages.ResumePauseButton(0), p));
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else assert.fail(`unexpected state ${state.execution}: ${state.script.name}`);
  }
  assert.equal(state.execution, ScriptState.FINISHED, state.script.name);
  assert.equal(choices.length, 0, 'all supplied dialogue choices must be used');
  return state;
}
function run(p, name, args = [], target = null) {
  const script = ScriptProvider.getByName(name);
  assert(script, `compiled script missing: ${name}`);
  const state = ScriptRunner.init(script, p, target, args);
  p.runScript(state, true, true);
  return finish(p, state);
}
function result(p, name, args = [], target = null) {
  const state = run(p, name, args, target);
  return state.intStack[state.isp - 1];
}
function dispatch(p, kind, args, choices = [], interaction = false) {
  for (let step = 0; p.delayed && step < 100; step++) tick(p);
  assert(!p.delayed, 'the preceding native action must finish its player delay before another packet');
  const observed = capture(p, () => {
    assert(handlers[kind].handle(new messages[kind](...args), p),
      `${kind} packet rejected: ${JSON.stringify({ args, player: [p.x, p.z, p.level],
        delayed: p.delayed, delayedUntil: p.delayedUntil, tick: World.currentTick })}`);
    if (interaction) p.processInteraction();
  });
  if (!observed.states.length) {
    const target = p.target;
    const context = { player: [p.x, p.z, p.level], target: target && {
      x: target.x, z: target.z, level: target.level, type: target.type, shape: target.shape, angle: target.angle
    }, contact: target && p.canAccess(), entry: target && p.getOpTrigger()?.name };
    if (target) context.collision = Array.from({ length: 5 }, (_, dz) =>
      Array.from({ length: 5 }, (_, dx) => map.isMapBlocked(target.x + dx - 2, target.z + dz - 2, target.level) ? '#' : '.').join(''));
    assert.fail(`${kind} did not dispatch: ${JSON.stringify({ ...context, messages: p.messages.slice(-3) })}`);
  }
  return finish(p, observed.states.at(-1), choices);
}
function showNpc(p, npc) {
  showPlayer(p);
  rsbuf.computeNpc(npc.x, npc.level, npc.z, npc.nid, npc.type, npc.tele, npc.jump,
    npc.runDir, npc.walkDir, npc.isActive, npc.masks, npc.faceEntity, npc.faceSquareX,
    npc.faceSquareZ, npc.faceAngleX, npc.faceAngleZ, npc.hitmarkDamage, npc.hitmarkType,
    npc.hitmark2Damage, npc.hitmark2Type, npc.levels[NpcStat.HITPOINTS], npc.baseLevels[NpcStat.HITPOINTS],
    npc.animId, npc.animDelay, npc.sayMessage, npc.spotanimId, npc.spotanimHeight, npc.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, npc.nid), 'target must be in the packet recipient NPC list');
}
function spawn(p, name) {
  const type = configs.NpcType.get(id('NpcType', name));
  const npc = new Npc(p.level, p.x + 1, p.z, type.size, type.size, EntityLifeCycle.RESPAWN,
    World.npcs.next(), type.id, type.blockwalk);
  World.addNpc(npc, -1);
  showNpc(p, npc);
  return npc;
}
function talk(p, npc, choices = [], option = 1) {
  adjacent(p, npc);
  showNpc(p, npc);
  return dispatch(p, 'OpNpc', [option, npc.nid], choices, true);
}
function useItems(p, used, target) {
  const inventory = p.getInventory(inv);
  return dispatch(p, 'OpHeldU', [obj(target), inventory.getItemIndex(obj(target)), invCom,
    obj(used), inventory.getItemIndex(obj(used)), invCom]);
}
function itemOption(p, name, option = 1) {
  return dispatch(p, 'OpHeld', [option, obj(name), p.getInventory(inv).getItemIndex(obj(name)), invCom]);
}
function tick(p) {
  World.currentTick++;
  // Match World.processPlayers' delay expiry and suspended-script phase before queues.
  if (p.delayed && World.currentTick >= p.delayedUntil) p.delayed = false;
  if (!p.delayed && p.activeScript?.execution === ScriptState.SUSPENDED) p.executeScript(p.activeScript, true, true);
  p.processQueues();
  p.processTimers(PlayerTimerType.NORMAL);
  p.processTimers(PlayerTimerType.SOFT);
  p.processEngineQueue();
  p.processInteraction();
}
function turnNpcs(...actors) {
  for (const actor of actors) if (actor.isActive) actor.turn();
  // World.processCleanup resets spawn's INSTANT speed and each tick's movement.
  for (const actor of actors) actor.resetEntity(false);
}

const placements = [];
for (const file of fs.readdirSync(path.join(root, 'maps'))) {
  const square = /^m(\d+)_(\d+)\.jm2$/.exec(file);
  if (!square) continue;
  const locs = fs.readFileSync(path.join(root, 'maps', file), 'utf8').split('==== LOC ====')[1]?.split('====')[0] ?? '';
  for (const row of locs.matchAll(/^([0-3]) (\d+) (\d+): (\d+)(?: (\d+))?(?: (\d+))?$/gm)) {
    placements.push({ level: Number(row[1]), x: Number(square[1]) * 64 + Number(row[2]),
      z: Number(square[2]) * 64 + Number(row[3]), type: Number(row[4]), shape: Number(row[5] ?? 10), angle: Number(row[6] ?? 0) });
  }
}
function nativeLocs(name) {
  const type = id('LocType', name);
  const bases = configs.LocType.configs.filter(value => value && (value.id === type || value.multiloc.includes(type))).map(value => value.id);
  return placements.filter(value => bases.includes(value.type)).map(value => {
    const loc = World.getLoc(value.x, value.z, value.level, value.type);
    assert(loc, `packed map lacks ${name} at its source placement`);
    assert.equal(loc.shape, value.shape);
    assert.equal(loc.angle, value.angle);
    return loc;
  });
}
function nativeLoc(name) {
  const locations = nativeLocs(name);
  assert.equal(locations.length, 1, `${name}: expected one original map placement`);
  return locations[0];
}
function currentLoc(p, name) {
  const type = id('LocType', name);
  for (const dx of [-8, 0, 8]) for (const dz of [-8, 0, 8]) {
    for (const loc of World.gameMap.getZone(p.x + dx, p.z + dz, p.level).getAllLocsSafe()) {
      if (loc.type === type) return loc;
    }
  }
  assert.fail(`the product must expose an active nearby ${name}`);
}
function approach(p, loc) {
  const type = configs.LocType.get(loc.type);
  const width = (loc.angle & 1) ? type.length : type.width;
  const length = (loc.angle & 1) ? type.width : type.length;
  const candidates = [];
  for (let dx = -1; dx <= width; dx++) for (let dz = -1; dz <= length; dz++) {
    const x = loc.x + dx, z = loc.z + dz;
    if (!map.isMapBlocked(x, z, loc.level)
      && map.reachedLoc(loc.level, x, z, loc.x, loc.z, width, length, 1, loc.angle, loc.shape, type.forceapproach)) candidates.push([x, z]);
  }
  assert(candidates.length, `no packed-map approach to ${configs.LocType.get(loc.baseType).debugname}`);
  place(p, ...candidates[0], loc.level);
}
function clickLoc(p, loc, choices = [], option = 1) {
  approach(p, loc);
  return dispatch(p, 'OpLoc', [option, loc.x, loc.z, loc.type], choices, true);
}
function useLoc(p, loc, name) {
  approach(p, loc);
  return dispatch(p, 'OpLocU', [loc.x, loc.z, loc.type, obj(name), p.getInventory(inv).getItemIndex(obj(name)), invCom], [], true);
}
function useNpc(p, npc, name) {
  adjacent(p, npc);
  showNpc(p, npc);
  return dispatch(p, 'OpNpcU', [npc.nid, obj(name), p.getInventory(inv).getItemIndex(obj(name)), invCom], [], true);
}
function killNpc(p, npc) {
  npc.lastMovement = -100;
  npc.heroPoints.addHero(p.hash64, npc.levels[NpcStat.HITPOINTS]);
  npc.applyDamage(npc.levels[NpcStat.HITPOINTS], 1);
  const type = configs.NpcType.get(npc.type);
  const trigger = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, type.id, type.category);
  assert(trigger, `native death trigger missing: ${type.debugname}`);
  const state = ScriptRunner.init(trigger, npc);
  npc.executeScript(state);
  for (let step = 0; state.execution === ScriptState.NPC_SUSPENDED && step < 20; step++) {
    p.processQueues();
    World.currentTick = Math.max(World.currentTick + 1, npc.delayedUntil);
    npc.delayed = false;
    npc.executeScript(state);
  }
  p.processQueues();
  assert.equal(state.execution, ScriptState.FINISHED, state.script.name);
}
function adjacent(p, npc) {
  const stand = [[npc.x - 1, npc.z], [npc.x + npc.width, npc.z], [npc.x, npc.z - 1], [npc.x, npc.z + npc.length]]
    .find(([x, z]) => !map.isMapBlocked(x, z, npc.level)
      && map.reachedEntity(npc.level, x, z, npc.x, npc.z, npc.width, npc.length, 1));
  assert(stand, 'the real combat actor needs a walkable attack approach');
  place(p, ...stand, npc.level);
}
function ownedActor(p, name) {
  const owner = id('VarNpcType', 'npc_aggressive_player');
  const actor = [...World.npcs].find(npc => npc.type === id('NpcType', name) && npc.vars[owner] === p.uid && npc.isActive);
  assert(actor, `native interaction must create owned actor ${name}`);
  return actor;
}

function check(name, body) {
  const previousSerial = serial;
  const previousNpcs = new Set(World.npcs);
  try {
    body();
    checks++;
    console.log(`PASS Myreque 2: ${name}`);
  } finally {
    for (const npc of World.npcs) if (!previousNpcs.has(npc) && npc.isActive) World.removeNpc(npc, -1);
    for (const p of [...World.playerLoop.all()]) if (p.slot > previousSerial) leavePlayer(p);
  }
}
function landing(p, expected, name) {
  assert.deepEqual([p.x, p.z, p.level], expected, `${name}: independently expected original map area`);
  assert(!map.isMapBlocked(p.x, p.z, p.level), `${name}: landing is blocked`);
  const route = [[p.x + 2, p.z], [p.x - 2, p.z], [p.x, p.z + 2], [p.x, p.z - 2]]
    .filter(([x, z]) => !map.isMapBlocked(x, z, p.level))
    .some(([x, z]) => map.findPath(p.level, p.x, p.z, x, z).length > 0);
  assert(route, `${name}: landing has no non-empty packed-map route out`);
}

check('prerequisites reject an incomplete Nature Spirit and each missing skill without starting', () => {
  for (const [kind, value] of [['nature', 109], ['crafting', 24], ['mining', 14], ['magic', 6]]) {
    const p = player();
    if (kind === 'nature') p.setVar(id('VarPlayerType', 'druidspirit'), value);
    else p.setLevel(PlayerStat[kind.toUpperCase()], value);
    talk(p, spawn(p, 'route_veliaf_hurtz'));
    assert.equal(stage(p), 0, kind);
  }
});
check('native Veliaf acceptance starts the quest and refusal does not', () => {
  for (const choice of [2, 1]) {
    const p = player();
    const state = talk(p, spawn(p, 'route_veliaf_hurtz'), [choice]);
    assert.equal(entryScripts.get(state), '[opnpc1,route_veliaf_hurtz]');
    assert.equal(stage(p), choice === 1 ? 1 : 0);
  }
});
check('earned food admission, native inn clearing, every lost bucket form and surface recovery', () => {
  const p = player();
  talk(p, spawn(p, 'route_veliaf_hurtz'), [1]);
  const florin = spawn(p, 'burgh_vilager_8');
  talk(p, florin);
  clickLoc(p, nativeLoc('burgh_quest_food_table'));
  const chest = nativeLoc('burgh_quest_food_chest_open');
  if (chest.type === id('LocType', 'burgh_quest_food_chest_closed')) clickLoc(p, chest);
  assert.equal(chest.type, id('LocType', 'burgh_quest_food_chest_open'));
  give(p, 'shrimp');
  useLoc(p, chest, 'shrimp');
  assert.equal(count(p, 'shrimp'), 0, 'admission consumes real food through the original chest');
  adjacent(p, florin);
  talk(p, florin);
  assert.equal(stage(p), 10);
  for (const name of ['bronze_pickaxe', 'spade', 'pot_empty', 'bucket_empty']) give(p, name);
  const wall = nativeLoc('burgh_inn_climb_over');
  place(p, 3491, 3230);
  assert(!map.isMapBlocked(p.x, p.z, p.level), 'original inn south-edge contact');
  assert(p.inOperableDistance(wall), 'the original north-facing wall is operated from its own south-side tile');
  dispatch(p, 'OpLoc', [1, wall.x, wall.z, wall.type], [], true);
  landing(p, [3491, 3231, 0], 'inside the original collapsed inn wall');
  useLoc(p, nativeLoc('burgh_inn_rubble_blocked'), 'bronze_pickaxe');
  assert.equal(p.getVarBit(id('VarBitType', 'burgh_inn_colapsed_wall')), 1);
  const trapdoor = nativeLoc('burgh_inn_trapdoor_closed');
  clickLoc(p, trapdoor);
  assert.equal(p.getVarBit(id('VarBitType', 'burgh_inn_trapdoor')), 1);
  clickLoc(p, trapdoor);
  landing(p, [3490, 9631, 0], 'original inn basement beside the mapped ladder');
  for (let form = 1; form <= 3; form++) clickLoc(p, currentLoc(p, `burgh_rubble_a_${form}`));
  const rubbleUnits = () => p.getVarBit(id('VarBitType', 'burgh_inn_rubble_pile'));
  for (let lostUnits = 1; lostUnits <= 3; lostUnits++) {
    for (let scoop = 0; scoop < lostUnits; scoop++) {
      useLoc(p, currentLoc(p, 'burgh_rubble_a_4'), scoop === 0 ? 'pot_empty' : 'spade');
    }
    assert.equal(count(p, `burgh_rubble_bucket_${lostUnits}`), 1);
    p.invDel(inv, obj(`burgh_rubble_bucket_${lostUnits}`), 1);
    give(p, 'bucket_empty');
    assert.equal(rubbleUnits(), 0, 'lost undumped rubble grants no clearing credit');
    assert.equal(stage(p), 10);
  }
  const ladder = nativeLocs('burgh_inn_basement_ladderup').find(loc => loc.level === 0);
  assert(ladder, 'the original L0 basement ladder is the usable exit');
  let dumped = 0;
  for (const units of [1, 3, 3, 3, 3, 2]) {
    for (let scoop = 0; scoop < units; scoop++) useLoc(p, currentLoc(p, 'burgh_rubble_a_4'), 'spade');
    assert.equal(count(p, `burgh_rubble_bucket_${units}`), 1);
    clickLoc(p, ladder);
    landing(p, [3491, 3232, 0], 'inn basement return east of the original surface trapdoor and clipped rubble');
    place(p, 3491, 3231);
    dispatch(p, 'OpLoc', [1, wall.x, wall.z, wall.type], [], true);
    landing(p, [3491, 3229, 0], 'outside the original inn wall');
    useLoc(p, nativeLoc('burgh_outside_rubble_pile'), `burgh_rubble_bucket_${units}`);
    dumped += units;
    assert.equal(rubbleUnits(), dumped, 'partial buckets contribute their actual one, two or three units');
    assert.equal(count(p, 'bucket_empty'), 1, 'dumping returns the reusable ordinary bucket');
    assert.equal(stage(p), dumped === 15 ? 30 : 10);
    if (dumped < 15) {
      place(p, 3491, 3230);
      dispatch(p, 'OpLoc', [1, wall.x, wall.z, wall.type], [], true);
      landing(p, [3491, 3231, 0], 're-enter the original inn');
      clickLoc(p, trapdoor);
      landing(p, [3490, 9631, 0], 'return for the next bucket without re-mining');
      currentLoc(p, 'burgh_rubble_a_4');
    }
  }
});

check('original store ladders, real repairs, lost crate, observable stocking, bank and furnace services', () => {
  const p = player();
  setStage(p, 30);
  for (const name of ['hammer', 'swamppaste']) give(p, name);
  give(p, 'woodplank', 11);
  give(p, 'nails', 100);
  const aurel = spawn(p, 'burgh_general_store_owner');
  talk(p, aurel);
  clickLoc(p, nativeLoc('burgh_ladder_generalstore_up'));
  landing(p, [3513, 3239, 2], 'original general-store roof ladder counterpart');
  useLoc(p, nativeLoc('burgh_store_roof_broken'), 'woodplank');
  assert.equal(count(p, 'woodplank'), 8);
  assert.equal(p.getVarBit(id('VarBitType', 'burgh_store_roof')), 1);
  clickLoc(p, nativeLoc('burgh_ladder_generalstore_down'));
  landing(p, [3513, 3239, 0], 'original general-store ground ladder counterpart');
  useLoc(p, nativeLoc('burgh_general_store_wall_multiloc'), 'woodplank');
  assert.equal(count(p, 'woodplank'), 5);
  assert.equal(p.getVarBit(id('VarBitType', 'burgh_store_wall')), 1);
  const beforeRequest = p.packets.length;
  talk(p, aurel, [1]);
  assert.equal(count(p, 'burgh_generalstore_crate'), 1);
  const request = p.packets.slice(beforeRequest).map(packet => packet.text ?? packet.msg ?? '').join(' ');
  const foodName = [...request.matchAll(/\b(raw mackerel|mackerel|snail)\b/gi)].at(-1)?.[1].toLowerCase();
  const food = foodName === 'raw mackerel' ? 'raw_mackerel' : foodName === 'mackerel' ? 'mackerel'
    : foodName === 'snail' ? 'snail_corpse_cooked1' : null;
  assert(food, `Aurel must state the selected food before the crate is packed: ${request}`);
  const wrongFood = ['mackerel', 'raw_mackerel', 'snail_corpse_cooked1'].find(name => name !== food);
  give(p, wrongFood);
  useItems(p, wrongFood, 'burgh_generalstore_crate');
  assert.equal(count(p, wrongFood), 1);
  assert.equal(p.getVarBit(id('VarBitType', 'burgh_food_crate')), 0);
  for (let axe = 0; axe < 3; axe++) {
    give(p, 'bronze_axe');
    useItems(p, 'bronze_axe', 'burgh_generalstore_crate');
  }
  assert.equal(p.getVarBit(id('VarBitType', 'burgh_axes_crate')), 3);
  p.invDel(inv, obj('burgh_generalstore_crate'), 1);
  talk(p, aurel);
  assert.equal(count(p, 'burgh_generalstore_crate'), 1, 'Aurel replaces a lost partly packed crate');
  assert.equal(p.getVarBit(id('VarBitType', 'burgh_axes_crate')), 3, 'replacement retains earned packing credit');
  for (const [name, amount, variable] of [['bronze_axe', 7, 'burgh_axes_crate'], [food, 10, 'burgh_food_crate'],
    ['tinderbox', 3, 'burgh_tinderbox_crate']]) {
    const before = p.getVarBit(id('VarBitType', variable));
    for (let item = 1; item <= amount; item++) {
      give(p, name);
      useItems(p, name, 'burgh_generalstore_crate');
      assert.equal(count(p, name), 0, 'each native item-on-crate action consumes exactly one supply');
      assert.equal(p.getVarBit(id('VarBitType', variable)), before + item);
    }
  }
  itemOption(p, 'burgh_generalstore_crate');
  talk(p, aurel);
  assert.equal(stage(p), 50);
  assert.equal(p.getVarBit(id('VarBitType', 'burgh_store_stocked')), 1);
  assert.equal(count(p, 'burgh_generalstore_crate'), 0);
  talk(p, aurel, [], 3);
  assert.equal(p.modalMain, component('shop_template'));
  assert.equal(p.modalSide, component('shop_template_side'));
  assert(p.invListeners.some(listener => listener.com === component('shop_template:inv')));
  const booth = nativeLoc('burgh_bank_booth_multiloc');
  useLoc(p, booth, 'woodplank');
  assert.equal(count(p, 'woodplank'), 3);
  assert.equal(count(p, 'swamppaste'), 0);
  assert.equal(p.getVarBit(id('VarBitType', 'burgh_bank_booth_open')), 1);
  useLoc(p, nativeLoc('burgh_bank_wall_multiloc'), 'woodplank');
  assert.equal(count(p, 'woodplank'), 0);
  assert.equal(p.getVarBit(id('VarBitType', 'burgh_bank_wall')), 1);
  const cornelius = spawn(p, 'burgh_potential_bank_teller');
  talk(p, cornelius, [2]);
  assert.equal(stage(p), 50, 'Cornelius refusal does not recruit the teller');
  talk(p, cornelius, [1]);
  assert.equal(stage(p), 70);
  for (const option of [1, 2]) {
    clickLoc(p, booth, [], option);
    assert.equal(p.modalMain, component('bank_main'));
    assert.equal(p.modalSide, component('bank_side'));
    for (const [inventory, target] of [[inv, 'bank_side:inv'], [bank, 'bank_main:bank']]) {
      assert(p.invListeners.some(listener => listener.type === inventory && listener.com === component(target)));
    }
  }
  const furnace = nativeLoc('burgh_furnace_multiloc');
  give(p, 'steel_bar', 2);
  useLoc(p, furnace, 'steel_bar');
  assert.equal(count(p, 'steel_bar'), 0);
  assert.equal(p.getVarBit(id('VarBitType', 'burgh_furnace_fix')), 1);
  give(p, 'coal');
  useLoc(p, furnace, 'coal');
  assert.equal(count(p, 'coal'), 0);
  assert.equal(p.getVarBit(id('VarBitType', 'burgh_furnace_fix')), 2);
  give(p, 'tinderbox');
  useLoc(p, furnace, 'tinderbox');
  assert.equal(count(p, 'tinderbox'), 1, 'lighting retains the ordinary tool');
  assert.equal(p.getVarBit(id('VarBitType', 'burgh_furnace_fix')), 3);
  assert.equal(stage(p), 90);
  assert.equal(p.getVarBit(id('VarBitType', 'blood_tithe_visible')), 1, 'lighting the furnace reveals the original tithe actors');
  place(p, 3513, 3241);
  for (const [base, visible] of [
    ['burgh_gadderanks_multinpc', 'burgh_gadderanks'],
    ['burgh_juve1_multinpc', 'burgh_vampire_juve1_blood_tithe'],
    ['burgh_juve2_multinpc', 'burgh_vampire_juve2_blood_tithe'],
    ['burgh_villager_tithe_multinpc', 'burgh_villager_blood_tithe']
  ]) {
    const npc = spawn(p, base);
    const resolved = resolveNpcType(configs.NpcType.get(npc.type), p);
    assert.equal(resolved.id, id('NpcType', visible), `${base}: earned visibility resolves the original map base`);
    assert.equal(resolved.op[0], 'Talk-to');
    assert.equal(entryScripts.get(talk(p, npc)), `[opnpc1,${visible}]`, 'native input dispatches the visible form');
  }
  assert.equal(stage(p), 110, 'the revealed original conversations start the tithe encounter');
  assert.equal(entryScripts.get(clickLoc(p, furnace, [], 2)), '[oploc2,_smithing_furnace]');
});

check('each observable stock-food choice loads only its selected food through native item-on-crate input', () => {
  for (const [choice, food] of [[1, 'mackerel'], [2, 'raw_mackerel'], [3, 'snail_corpse_cooked1']]) {
    const p = player();
    setStage(p, 30);
    for (const variable of ['burgh_store_roof', 'burgh_store_wall']) p.setVarBit(id('VarBitType', variable), 1);
    const aurel = spawn(p, 'burgh_general_store_owner');
    const before = p.packets.length;
    talk(p, aurel, [choice]);
    assert.equal(count(p, 'burgh_generalstore_crate'), 1);
    assert.equal(p.getVarBit(id('VarBitType', 'burgh_food_type')), choice);
    const request = p.packets.slice(before).map(packet => packet.text ?? packet.msg ?? '').join(' ');
    const foodName = [...request.matchAll(/\b(raw mackerel|mackerel|snail)\b/gi)].at(-1)?.[1].toLowerCase();
    assert.equal(foodName, choice === 1 ? 'mackerel' : choice === 2 ? 'raw mackerel' : 'snail');
    const wrong = ['mackerel', 'raw_mackerel', 'snail_corpse_cooked1'].find(name => name !== food);
    give(p, wrong);
    useItems(p, wrong, 'burgh_generalstore_crate');
    assert.equal(count(p, wrong), 1);
    assert.equal(p.getVarBit(id('VarBitType', 'burgh_food_crate')), 0);
    give(p, food);
    useItems(p, food, 'burgh_generalstore_crate');
    assert.equal(count(p, food), 0);
    assert.equal(p.getVarBit(id('VarBitType', 'burgh_food_crate')), 1);
  }
});


check('Drezel library, three recovered books, real tomb, rod recipe and blessing', () => {
  const p = player();
  setStage(p, 200);
  const drezel = spawn(p, 'priestperiltrappedmonk2');
  talk(p, drezel);
  assert.equal(stage(p), 210);
  assert.equal(count(p, 'burgh_key'), 1);
  p.invDel(inv, obj('burgh_key'), 1);
  talk(p, drezel);
  assert.equal(count(p, 'burgh_key'), 1, 'Drezel replaces a lost library key');
  useLoc(p, nativeLoc('burgh_library_keyhole'), 'burgh_key');
  assert.equal(p.getVarBit(id('VarBitType', 'burgh_temple_trapdoor')), 1);
  clickLoc(p, nativeLoc('burgh_temple_library_trapdoor_open'));
  landing(p, [3414, 9867, 2], 'Paterdomus library');
  const books = ['burgh_book_sevenwarriors', 'burgh_book_historiesofhallowland', 'burgh_book_moderndaymorytania'];
  clickLoc(p, nativeLoc('burgh_library_bookcase_ivandis'));
  clickLoc(p, nativeLoc('burgh_library_bookcase_history'), [1]);
  clickLoc(p, nativeLoc('burgh_library_bookcase_history'), [2]);
  for (const book of books) {
    assert.equal(count(p, book), 1);
    p.invDel(inv, obj(book), 1);
    if (book === books[0]) clickLoc(p, nativeLoc('burgh_library_bookcase_ivandis'));
    else clickLoc(p, nativeLoc('burgh_library_bookcase_history'), [book === books[1] ? 1 : 2]);
    assert.equal(count(p, book), 1, `recover ${book}`);
    itemOption(p, book);
  }
  assert.equal(stage(p), 240, 'all three actual Read options unlock the tomb');
  clickLoc(p, nativeLoc('burgh_temple_library_ladder_up'));
  landing(p, [3440, 9899, 0], 'Paterdomus library exit');
  give(p, 'hammer');
  useLoc(p, nativeLoc('burgh_ivandis_boardedupdoor'), 'hammer');
  clickLoc(p, nativeLoc('burgh_ivandis_tomb_entrance'));
  landing(p, [3461, 9821, 2], 'Ivandis tomb south of the original mapped exit');
  give(p, 'softclay');
  useLoc(p, nativeLoc('burgh_ancient_coffin'), 'softclay');
  assert.equal(stage(p), 300);
  assert.equal(count(p, 'burgh_rod_clay'), 1);
  p.invDel(inv, obj('burgh_rod_clay'), 1);
  give(p, 'softclay');
  useLoc(p, nativeLoc('burgh_ancient_coffin'), 'softclay');
  assert.equal(count(p, 'burgh_rod_clay'), 1, 'a lost mould can be remade');
  clickLoc(p, nativeLoc('burgh_ivandis_tomb_exit'));
  landing(p, [3483, 9832, 0], 'Ivandis tomb exit west of the original mapped entrance');
  give(p, 'mithril_bar');
  give(p, 'silver_bar');
  give(p, 'sapphire');
  const furnace = nativeLocs('furnace').find(loc => loc.level === 0 && loc.z < 9000);
  assert(furnace, 'an original usable furnace must exist');
  useLoc(p, furnace, 'mithril_bar');
  assert.equal(count(p, 'burgh_rod_command1'), 1);
  for (const material of ['mithril_bar', 'silver_bar', 'sapphire']) assert.equal(count(p, material), 0);
  assert.equal(count(p, 'burgh_rod_clay'), 1, 'casting retains the reusable mould');
  give(p, 'cosmicrune');
  give(p, 'waterrune');
  dispatch(p, 'OpHeldT', [obj('burgh_rod_command1'), p.getInventory(inv).getItemIndex(obj('burgh_rod_command1')), invCom, component('magic:enchant_lvl1')]);
  assert.equal(count(p, 'burgh_rod_command1'), 0);
  assert.equal(count(p, 'burgh_rod_command2'), 1);
  const well = nativeLoc('priestperil_well');
  useLoc(p, well, 'burgh_rod_command2');
  assert.equal(count(p, 'burgh_rod_command2'), 1, 'rope is required');
  give(p, 'rope');
  useLoc(p, well, 'burgh_rod_command2');
  assert.equal(stage(p), 400);
  assert.equal(count(p, 'burgh_rod_command_final_10'), 1);
  assert.equal(count(p, 'rope'), 1);
});

check('completion writes 421, grants exact tenths-XP and two QP once, and shows the scroll', () => {
  const p = player();
  setStage(p, 400);
  place(p, 3493, 9628); // Original rescue Veliaf stands at 3494,9628, not behind the north wall.
  const veliaf = spawn(p, 'burgh_rescue_veliaf_hurtz_talk');
  run(p, '[proc,update_questpoints]');
  const previousPoints = p.getVar(id('VarPlayerType', 'qp'));
  talk(p, veliaf);
  assert.equal(stage(p), 400, 'finished rod must be present');
  give(p, 'burgh_rod_command_final_10');
  const skills = [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.CRAFTING];
  const before = skills.map(skill => p.stats[skill]);
  const awards = [];
  const advance = ScriptRunner.HANDLERS[ScriptOpcode.STAT_ADVANCE];
  ScriptRunner.HANDLERS[ScriptOpcode.STAT_ADVANCE] = state => {
    awards.push(stage(p));
    advance(state);
  };
  try { talk(p, veliaf); } finally { ScriptRunner.HANDLERS[ScriptOpcode.STAT_ADVANCE] = advance; }
  assert.deepEqual(awards, [421, 421, 421, 421], 'terminal state must precede every XP award');
  assert.equal(stage(p), 421);
  assert.deepEqual(skills.map((skill, i) => p.stats[skill] - before[i]), Array(4).fill(20000 * Environment.NODE_XPRATE));
  assert.equal(p.getVar(id('VarPlayerType', 'qp')), previousPoints + 2);
  assert.equal(p.modalMain, component('questscroll_death'));
  const text = p.packets.map(packet => packet.text ?? '').join('\n');
  assert(text.includes('2,000 Attack') && text.includes('2,000 Defence'));
  p.closeModal();
  const rewarded = skills.map(skill => p.stats[skill]);
  talk(p, veliaf);
  assert.deepEqual(skills.map(skill => p.stats[skill]), rewarded);
  assert.equal(p.getVar(id('VarPlayerType', 'qp')), previousPoints + 2);
});

check('balance mixing preserves dose counts in both native item directions', () => {
  for (let doses = 1; doses <= 4; doses++) for (const reverse of [false, true]) {
    const p = player();
    setStage(p, 421);
    const restore = `${doses}dosestatrestore`;
    const unfinished = `burgh_unfinished_guthix_balance_${doses}`;
    const finished = `burgh_guthix_balance_${doses}`;
    give(p, restore);
    give(p, 'garlic');
    useItems(p, reverse ? restore : 'garlic', reverse ? 'garlic' : restore);
    assert.equal(count(p, restore), 0);
    assert.equal(count(p, unfinished), 1);
    give(p, 'silver_dust');
    useItems(p, reverse ? unfinished : 'silver_dust', reverse ? 'silver_dust' : unfinished);
    assert.equal(count(p, unfinished), 0);
    assert.equal(count(p, finished), 1);
  }
});

check('Priest/Wolfbane, ordinary well, silver casting and jewellery enchant remain independent', () => {
  for (const active of [0, 210, 421]) {
    const p = player();
    setStage(p, active);
    if (active === 210) p.setVar(id('VarPlayerType', 'priestperil'), 59);
    talk(p, spawn(p, 'priestperiltrappedmonk2'));
    assert.equal(count(p, 'burgh_key'), 0, 'incomplete Priest or inactive sequel must not issue a key');
    if (active !== 210) assert.equal(count(p, 'dagger_wolfbane'), 1, 'normal Wolfbane reclaim');
    give(p, 'bucket_empty');
    useLoc(p, nativeLoc('priestperil_well'), 'bucket_empty');
    assert.equal(count(p, 'bucket_murkywater'), 1);
  }
  const p = player();
  setStage(p, 421);
  give(p, 'silver_bar');
  give(p, 'holy_symbol_mould');
  const furnace = nativeLocs('furnace').find(loc => loc.level === 0 && loc.z < 9000);
  assert(furnace);
  useLoc(p, furnace, 'silver_bar');
  assert.equal(p.modalMain, component('silver_casting'));
  assert.equal(count(p, 'silver_bar'), 1, 'opening ordinary silver crafting consumes nothing');
  p.closeModal();
  give(p, 'burgh_rod_clay');
  useLoc(p, furnace, 'silver_bar');
  assert.equal(p.modalMain, component('silver_casting'), 'a mould without the full rod recipe must not pre-empt ordinary silver crafting');
  assert.equal(count(p, 'silver_bar'), 1);
  p.closeModal();
  give(p, 'sapphire_ring');
  give(p, 'cosmicrune');
  give(p, 'waterrune');
  dispatch(p, 'OpHeldT', [obj('sapphire_ring'), p.getInventory(inv).getItemIndex(obj('sapphire_ring')), invCom, component('magic:enchant_lvl1')]);
  assert.equal(count(p, 'ring_of_recoil'), 1, 'ordinary level-one jewellery conversion is retained');
});

check('Desert Treasure garlic grinding and ordinary restore decanting retain their results', () => {
  for (const active of [0, 421]) {
    const p = player();
    setStage(p, active);
    give(p, 'garlic');
    give(p, 'pestle_and_mortar');
    useItems(p, 'pestle_and_mortar', 'garlic');
    assert.equal(count(p, 'fd_crushed_garlic'), 1);
    assert.equal(count(p, 'pestle_and_mortar'), 1);
    give(p, '1dosestatrestore', 2);
    const inventory = p.getInventory(inv);
    const first = inventory.getItemIndex(obj('1dosestatrestore'));
    const second = inventory.items.findIndex((item, index) => index !== first && item?.id === obj('1dosestatrestore'));
    assert.notEqual(second, -1);
    dispatch(p, 'OpHeldU', [obj('1dosestatrestore'), second, invCom, obj('1dosestatrestore'), first, invCom]);
    assert.equal(count(p, '2dosestatrestore'), 1);
    assert.equal(count(p, 'vial_empty'), 1);
  }
});

check('all six Ghosts Ahoy bone products survive the gated silver-dust extension', () => {
  const bones = ['bones', 'bat_bones', 'bones_burnt', 'big_bones', 'babydragon_bones', 'dragon_bones'];
  const meals = ['pot_bonemeal', 'pot_bonemeal_bat', 'pot_bonemeal_burnt', 'pot_bonemeal_big', 'pot_bonemeal_babydragon', 'pot_bonemeal_dragon'];
  const loader = nativeLoc('ahoy_grinder_loader');
  const handle = nativeLoc('ahoy_grinder_handle');
  const chute = nativeLoc('ahoy_grinder_chute');
  for (let index = 0; index < bones.length; index++) {
    const p = player();
    setStage(p, 421);
    give(p, bones[index]);
    give(p, 'pot_empty');
    useLoc(p, loader, bones[index]);
    clickLoc(p, handle);
    clickLoc(p, chute);
    assert.equal(count(p, meals[index]), 1, bones[index]);
    assert.equal(p.getVarBit(id('VarBitType', 'ahoy_grinder_status')), 0);
  }
  for (const active of [400, 421]) {
    const p = player();
    setStage(p, active);
    give(p, 'silver_bar');
    give(p, 'pot_empty');
    useLoc(p, loader, 'silver_bar');
    assert.equal(count(p, 'silver_bar'), active === 421 ? 0 : 1);
    if (active === 421) {
      clickLoc(p, handle);
      clickLoc(p, chute);
      assert.equal(count(p, 'silver_dust'), 1);
    }
  }
});

check('tithe dialogue creates real owned actors; both native deaths and Gadderanks surrender earn progress', () => {
  const p = player();
  setStage(p, 90);
  talk(p, spawn(p, 'burgh_gadderanks'));
  talk(p, spawn(p, 'burgh_vampire_juve1_blood_tithe'));
  assert.equal(stage(p), 90, 'all three conversation subjects are required');
  const villager = spawn(p, 'burgh_villager_blood_tithe');
  Object.assign(villager, { x: 3515, z: 3242, startX: 3515, startZ: 3242 });
  adjacent(p, villager);
  talk(p, villager);
  const fightApproach = { x: p.x, z: p.z, level: p.level };
  assert.equal(stage(p), 110);
  const first = ownedActor(p, 'burgh_vampire_juve_1_attackable');
  const second = ownedActor(p, 'burgh_vampire_juve_2_attackable');
  const gadderanks = ownedActor(p, 'burgh_gadderanks_attackable');
  for (const npc of [first, second, gadderanks]) {
    assert(!map.isMapBlocked(npc.x, npc.z, npc.level), 'native actor must not spawn in packed wall collision');
    adjacent(p, npc);
    assert((p.x === fightApproach.x && p.z === fightApproach.z)
      || map.findPath(p.level, fightApproach.x, fightApproach.z, p.x, p.z).length > 0,
    'each actor must be reachable from the original Wiskit interaction approach');
  }
  assert.equal(result(p, '[proc,npc_max_dealt]', [20, 0], first), 0, 'ordinary weapons cannot damage the tithe vampyres');
  give(p, 'silver_sickle_blessed');
  itemOption(p, 'silver_sickle_blessed', 2);
  assert(result(p, '[proc,npc_max_dealt]', [20, 0], first) > 0);
  assert.equal(result(p, '[proc,npc_max_dealt]', [20, 1], first), 0, 'a spell is not the blessed sickle');
  assert.equal(result(p, '[proc,npc_max_dealt]', [20, 0], gadderanks), 0, 'Gadderanks is protected until both vampyres die');
  const stranger = player();
  setStage(stranger, 110);
  const messagesBefore = stranger.messages.length;
  assert.equal(result(stranger, '[proc,npc_is_attackable_opt_quiet]', [], first), 0);
  assert.equal(stranger.messages.length, messagesBefore, 'quiet owner rejection must be silent');
  // Native melee uses a naive approach: enter the shop rather than attack through its south wall.
  place(p, 3512, 3241);
  const attack = npc => {
    const originalType = npc.type;
    const hp = npc.levels[NpcStat.HITPOINTS];
    showNpc(p, npc);
    assert(handlers.OpNpc.handle(new messages.OpNpc(2, npc.nid), p));
    for (let cycle = 0; cycle < 200 && npc.isActive && npc.type === originalType; cycle++) {
      tick(p);
      turnNpcs(first, second, gadderanks);
      p.resetEntity(false);
    }
    assert(npc.levels[NpcStat.HITPOINTS] < hp,
      `the native shop encounter must damage ${originalType}: ${JSON.stringify({
        player: [p.x, p.z], target: p.target?.nid,
        actors: [first, second, gadderanks].map(actor => ({ type: actor.type, x: actor.x, z: actor.z })),
        messages: p.messages.slice(-5)
      })}`);
    assert(!npc.isActive || npc.type !== originalType, 'native combat must defeat the selected tithe actor');
  };
  JavaRandom.setSeed(0);
  attack(first);
  assert.equal(p.getVarBit(id('VarBitType', 'juvinate_deaths')), 1);
  // Let the previous combat expire before a late-arriving boss's native attack phase.
  adjacent(p, gadderanks);
  for (let cycle = 0; cycle < 12; cycle++) {
    tick(p);
    p.resetEntity(false);
  }
  run(p, '[ai_opplayer2,burgh_gadderanks_attackable]', [], gadderanks);
  assert.notEqual(p.getVar(id('VarPlayerType', 'aggressive_npc')), gadderanks.uid,
    'Gadderanks must not claim single combat before both Juvinates are defeated');
  for (let cycle = 0; cycle < 12; cycle++) {
    tick(p);
    turnNpcs(first, second, gadderanks);
    p.resetEntity(false);
  }
  attack(second);
  assert.equal(p.getVarBit(id('VarBitType', 'juvinate_deaths')), 3);
  assert(result(p, '[proc,npc_max_dealt]', [20, 0], gadderanks) > 0);
  attack(gadderanks);
  assert.equal(gadderanks.type, id('NpcType', 'burgh_gadderanks_wounded'));
  adjacent(p, gadderanks);
  talk(p, gadderanks);
  assert.equal(stage(p), 120);
  assert.equal(count(p, 'gadderanks_warhammer'), 1);
  p.invDel(inv, obj('gadderanks_warhammer'), 1);
  const veliaf = spawn(p, 'route_veliaf_hurtz');
  talk(p, veliaf);
  assert.equal(count(p, 'gadderanks_warhammer'), 1, 'earned hammer has a genuine recovery interaction');
  assert.equal(stage(p), 130);
});

check('every quest-owned item is untradeable in the selected pack', () => {
  const file = fs.readFileSync(path.join(root, 'scripts/quests/quest_myreque_2/configs/myreque2_entities.obj'), 'utf8');
  const names = [...file.matchAll(/^\[([^\]]+)\]$/gm)].map(match => match[1]);
  assert(names.length > 0, 'quest objects are configured in their own file');
  for (const name of names) assert.equal(configs.ObjType.get(obj(name)).tradeable, false, name);
});

check('Rod capture uses the native attack dispatch, quarter-health gate, expiry and all ten charges', () => {
  const p = player();
  setStage(p, 421);
  give(p, 'burgh_rod_command_final_10');
  itemOption(p, 'burgh_rod_command_final_10', 2);
  const npc = spawn(p, 'burgh_vampire_juve_1');
  const hp = npc.baseLevels[NpcStat.HITPOINTS];
  assert(hp >= 4, 'capture target needs a real nontrivial hitpoint pool');
  p.setVar(id('VarPlayerType', 'sa_energy'), 1000);
  p.setVar(id('VarPlayerType', 'sa_attack'), 1);
  talk(p, npc, [], 2);
  assert.equal(npc.type, id('NpcType', 'burgh_vampire_juve_1'), 'full-health target is not captured');
  assert.equal(count(p, 'burgh_rod_command_final_10', worn), 1, 'failed capture does not spend a charge');
  npc.levels[NpcStat.HITPOINTS] = Math.floor(hp / 4);
  p.setVar(id('VarPlayerType', 'sa_energy'), 99);
  p.setVar(id('VarPlayerType', 'sa_attack'), 1);
  talk(p, npc, [], 2);
  assert.equal(npc.type, id('NpcType', 'burgh_vampire_juve_1'), 'less than ten percent cannot capture');
  assert.equal(count(p, 'burgh_rod_command_final_10', worn), 1);
  assert.equal(p.getVar(id('VarPlayerType', 'sa_energy')), 99);
  for (let charges = 10; charges > 0; charges--) {
    npc.levels[NpcStat.HITPOINTS] = Math.floor(hp / 4);
    p.setVar(id('VarPlayerType', 'sa_energy'), 1000);
    p.setVar(id('VarPlayerType', 'sa_attack'), 1);
    p.setVar(id('VarPlayerType', 'action_delay'), 0);
    talk(p, npc, [], 2);
    assert.equal(npc.type, id('NpcType', 'burgh_vampire_juve_held'));
    assert.equal(p.getVar(id('VarPlayerType', 'sa_energy')), 900, '10% uses 100 of the 1000 energy units');
    if (charges === 1) {
      assert.equal(count(p, 'burgh_rod_command_dust'), 1);
      assert.equal(p.getInventory(worn).get(3), null, 'the depleted weapon leaves the right hand');
    } else assert.equal(count(p, `burgh_rod_command_final_${charges - 1}`, worn), 1);
    World.currentTick += 50;
    npc.turn();
    assert.equal(npc.type, id('NpcType', 'burgh_vampire_juve_1'), 'expired capture restores the original form');
  }
});

check('a real sixty-HP juvenile is capturable at exactly one quarter, but not one HP above it', () => {
  const p = player();
  setStage(p, 421);
  give(p, 'burgh_rod_command_final_10');
  itemOption(p, 'burgh_rod_command_final_10', 2);
  const npc = spawn(p, 'burgh_vampire_juvenile_1');
  const hp = npc.baseLevels[NpcStat.HITPOINTS];
  assert.equal(hp % 4, 0, 'the real configured target must expose an exact integral quarter-health boundary');
  npc.levels[NpcStat.HITPOINTS] = hp / 4 + 1;
  p.setVar(id('VarPlayerType', 'sa_energy'), 1000);
  p.setVar(id('VarPlayerType', 'sa_attack'), 1);
  talk(p, npc, [], 2);
  assert.equal(npc.type, id('NpcType', 'burgh_vampire_juvenile_1'));
  assert.equal(count(p, 'burgh_rod_command_final_10', worn), 1);
  assert.equal(p.getVar(id('VarPlayerType', 'sa_energy')), 1000);
  npc.levels[NpcStat.HITPOINTS] = hp / 4;
  p.setVar(id('VarPlayerType', 'sa_attack'), 1);
  p.setVar(id('VarPlayerType', 'action_delay'), 0);
  talk(p, npc, [], 2);
  assert.equal(npc.type, id('NpcType', 'burgh_vampire_juvenile_held'));
  assert.equal(count(p, 'burgh_rod_command_final_9', worn), 1);
  assert.equal(p.getVar(id('VarPlayerType', 'sa_energy')), 900);
});

check('all balance outcomes consume one dose, preserve ownership and resolve through real NPC lifecycle', () => {
  const outcomes = new Set();
  for (const seed of [0, 4096, 24576]) {
    const p = player();
    setStage(p, 421);
    give(p, 'burgh_rod_command_final_10');
    itemOption(p, 'burgh_rod_command_final_10', 2);
    const npc = spawn(p, 'burgh_vampire_juvenile_1');
    npc.levels[NpcStat.HITPOINTS] = Math.floor(npc.baseLevels[NpcStat.HITPOINTS] / 4);
    p.setVar(id('VarPlayerType', 'sa_energy'), 1000);
    p.setVar(id('VarPlayerType', 'sa_attack'), 1);
    talk(p, npc, [], 2);
    assert.equal(npc.type, id('NpcType', 'burgh_vampire_juvenile_held'));
    const stranger = player();
    setStage(stranger, 421);
    place(stranger, p.x, p.z, p.level);
    give(stranger, 'burgh_guthix_balance_1');
    useNpc(stranger, npc, 'burgh_guthix_balance_1');
    assert.equal(count(stranger, 'burgh_guthix_balance_1'), 1, 'another player cannot pour on the owned captive');
    give(p, 'burgh_guthix_balance_1');
    npc.heroPoints.addHero(p.hash64, 1);
    JavaRandom.setSeed(seed);
    useNpc(p, npc, 'burgh_guthix_balance_1');
    assert.equal(count(p, 'burgh_guthix_balance_1'), 0);
    assert.equal(count(p, 'vial_empty'), 1);
    if (npc.type === id('NpcType', 'burgh_turned_vampyre_male_ben')) {
      outcomes.add('human');
      talk(p, npc);
      assert.equal(count(p, 'cert_silver_bar'), 1);
      assert.equal(npc.isActive, false, 'rescued human gift is once-only');
    } else if (npc.type === id('NpcType', 'burgh_vampire_juve_angry')) {
      outcomes.add('angry');
      assert(result(p, '[proc,npc_max_dealt]', [10, 0], npc) > 0, 'the angry form accepts ordinary weapon damage');
    } else {
      outcomes.add('death');
      for (let ticks = 0; npc.isActive && ticks < 20; ticks++) {
        World.currentTick++;
        npc.turn();
        p.processQueues();
      }
      assert.equal(npc.isActive, false, 'potion kill must run the native death queue and remove the NPC');
    }
  }
  assert.deepEqual([...outcomes].sort(), ['angry', 'death', 'human']);
});

check('ordinary NPC damage and dragon-dagger special dispatch do not enter the quest capture path', () => {
  const p = player();
  const npc = spawn(p, 'goblin');
  assert(result(p, '[proc,npc_max_dealt]', [10, 0], npc) > 0);
  give(p, 'dragon_dagger');
  itemOption(p, 'dragon_dagger', 2);
  assert.equal(count(p, 'dragon_dagger', worn), 1, p.messages.slice(-3).join(' '));
  p.setVar(id('VarPlayerType', 'sa_energy'), 1000);
  p.setVar(id('VarPlayerType', 'sa_attack'), 1);
  talk(p, npc, [], 2);
  assert.equal(p.getVar(id('VarPlayerType', 'sa_attack')), 0);
  assert(p.getVar(id('VarPlayerType', 'sa_energy')) < 1000, 'ordinary special still spends its native cost');
  assert.equal(npc.type, id('NpcType', 'goblin'));
  assert(!p.messages.some(text => /rod (?:cannot|holds)/i.test(text)));
});

check('old Myreque member introductions remain active before their prerequisite is complete', () => {
  for (const active of [0, 130]) for (const name of ['route_radigad_ponfit', 'route_polmafi_ferdygris', 'route_ivan_strom']) {
    const p = player();
    p.setVar(id('VarPlayerType', 'routequest'), 0);
    setStage(p, active);
    const before = p.getVar(id('VarPlayerType', 'myreque2_extravar'));
    const state = talk(p, spawn(p, name));
    assert.equal(entryScripts.get(state), `[opnpc1,${name}]`);
    assert.equal(stage(p), active);
    assert.equal(p.getVar(id('VarPlayerType', 'myreque2_extravar')), before);
    assert.equal(p.getVar(id('VarPlayerType', 'routequest')), 0);
  }
});

check('tithe logout removes abandoned actors and native dialogue resumes only the unfinished kills', () => {
  const original = player();
  setStage(original, 90);
  for (const name of ['burgh_gadderanks', 'burgh_vampire_juve1_blood_tithe', 'burgh_villager_blood_tithe']) talk(original, spawn(original, name));
  const first = ownedActor(original, 'burgh_vampire_juve_1_attackable');
  const second = ownedActor(original, 'burgh_vampire_juve_2_attackable');
  const gadderanks = ownedActor(original, 'burgh_gadderanks_attackable');
  killNpc(original, first);
  const saved = { username: original.username, data: original.save() };
  leavePlayer(original);
  World.currentTick++;
  second.turn();
  gadderanks.turn();
  assert.equal(second.isActive, false);
  assert.equal(gadderanks.isActive, false);
  const p = player(saved);
  assert.equal(stage(p), 110);
  assert.equal(p.getVarBit(id('VarBitType', 'juvinate_deaths')), 1, 'earned kill credit survives a real save/reload');
  talk(p, spawn(p, 'burgh_villager_blood_tithe'));
  assert(![...World.npcs].some(npc => npc.isActive && npc.type === id('NpcType', 'burgh_vampire_juve_1_attackable')
    && npc.vars[id('VarNpcType', 'npc_aggressive_player')] === p.uid), 'the completed kill is not recreated');
  const remaining = ownedActor(p, 'burgh_vampire_juve_2_attackable');
  const resumedGadderanks = ownedActor(p, 'burgh_gadderanks_attackable');
  killNpc(p, remaining);
  killNpc(p, resumedGadderanks);
  adjacent(p, resumedGadderanks);
  talk(p, resumedGadderanks);
  assert.equal(stage(p), 120);
  assert.equal(count(p, 'gadderanks_warhammer'), 1);
});

check('last rod charge with a full inventory leaves private, recoverable dust instead of a worn non-weapon', () => {
  const p = player();
  setStage(p, 421);
  give(p, 'burgh_rod_command_final_1');
  itemOption(p, 'burgh_rod_command_final_1', 2);
  give(p, 'bronze_dagger', 28);
  const npc = spawn(p, 'burgh_vampire_juve_1');
  npc.levels[NpcStat.HITPOINTS] = Math.floor(npc.baseLevels[NpcStat.HITPOINTS] / 4);
  p.setVar(id('VarPlayerType', 'sa_energy'), 1000);
  p.setVar(id('VarPlayerType', 'sa_attack'), 1);
  talk(p, npc, [], 2);
  assert.equal(p.getInventory(worn).get(3), null);
  const dust = World.getObj(p.x, p.z, p.level, obj('burgh_rod_command_dust'), p.hash64);
  assert(dust, 'full inventory creates real dust on the owner tile');
  const stranger = player();
  assert.equal(World.getObj(p.x, p.z, p.level, obj('burgh_rod_command_dust'), stranger.hash64), null);
  for (let ticks = 0; ticks < 101; ticks++) { World.currentTick++; dust.turn(); }
  assert.equal(World.getObj(p.x, p.z, p.level, obj('burgh_rod_command_dust'), stranger.hash64), null,
    'untradeable dust cannot become public at the normal reveal deadline');
  assert(World.getObj(p.x, p.z, p.level, obj('burgh_rod_command_dust'), p.hash64),
    'the private dust remains recoverable by its owner after the public reveal deadline');
});

check('lost moulds and each rod form can be remade during construction and after completion', () => {
  const furnace = nativeLocs('furnace').find(loc => loc.level === 0 && loc.z < 9000);
  assert(furnace);
  for (const active of [300, 400, 421]) for (const lost of [0, 1, 2]) {
    const p = player();
    setStage(p, active);
    const cast = () => {
      for (const material of ['mithril_bar', 'silver_bar', 'sapphire']) give(p, material);
      useLoc(p, furnace, active === 300 ? 'mithril_bar' : active === 400 ? 'silver_bar' : 'burgh_rod_clay');
      assert.equal(count(p, 'burgh_rod_command1'), 1);
    };
    const enchant = () => {
      give(p, 'cosmicrune');
      give(p, 'waterrune');
      dispatch(p, 'OpHeldT', [obj('burgh_rod_command1'),
        p.getInventory(inv).getItemIndex(obj('burgh_rod_command1')), invCom, component('magic:enchant_lvl1')]);
      assert.equal(count(p, 'burgh_rod_command2'), 1);
    };
    give(p, 'softclay');
    useLoc(p, nativeLoc('burgh_ancient_coffin'), 'softclay');
    p.invDel(inv, obj('burgh_rod_clay'), 1);
    give(p, 'softclay');
    useLoc(p, nativeLoc('burgh_ancient_coffin'), 'softclay');
    assert.equal(count(p, 'burgh_rod_clay'), 1, `mould recovery at ${active}`);
    cast();
    if (lost === 0) {
      p.invDel(inv, obj('burgh_rod_command1'), 1);
      cast();
    }
    enchant();
    if (lost === 1) {
      p.invDel(inv, obj('burgh_rod_command2'), 1);
      cast();
      enchant();
    }
    give(p, 'rope');
    useLoc(p, nativeLoc('priestperil_well'), 'burgh_rod_command2');
    if (lost === 2) {
      p.invDel(inv, obj('burgh_rod_command_final_10'), 1);
      cast();
      enchant();
      useLoc(p, nativeLoc('priestperil_well'), 'burgh_rod_command2');
    }
    assert.equal(count(p, 'burgh_rod_command_final_10'), 1, `rod recovery ${active}/${lost}`);
    assert.equal(stage(p), Math.max(active, 400), 'recrafting never rewinds quest progress');
  }
});

check('native login restores journal colours and the real quest-row button opens the journal', () => {
  for (const [active, rgb] of [[0, 0xff0000], [1, 0xffff00], [421, 0x00ff00]]) {
    const original = player();
    setStage(original, active);
    const saved = { username: original.username, data: original.save() };
    leavePlayer(original);
    const p = player(saved);
    run(p, '[login,_]');
    assert.equal(stage(p), active, 'native save and login retain the earned quest state');
    const colour = p.packets.findLast(packet => packet.component === component('questlist:myreque_2')
      && Number.isInteger(packet.colour));
    assert(colour, 'login must update the Myreque 2 row');
    assert.equal(colour.colour, ((rgb >>> 19) << 10) | (((rgb >>> 11) & 31) << 5) | ((rgb >>> 3) & 31));
    const state = dispatch(p, 'IfButton', [component('questlist:myreque_2')]);
    assert.equal(entryScripts.get(state), '[if_button,questlist:myreque_2]');
    assert(p.packets.some(packet => /In Aid of the Myreque/.test(packet.text ?? '')));
    if (active === 421) assert(p.packets.some(packet => /QUEST COMPLETE/.test(packet.text ?? '')));
  }
});

check('CANDIDATE Gadderhammer bonus covers the original combat shades and neither zero nor non-shades draw RNG', () => {
  const p = player();
  const shades = ['shade_level1', 'shade_level2', 'shade_level3', 'shade_level4', 'shade_level5',
    'macro_shade1', 'macro_shade2', 'macro_shade3', 'macro_shade4', 'macro_shade5', 'macro_shade6',
    'templetrek_shade_1', 'templetrek_shade_2', 'templetrek_shade_3'];
  for (const name of shades) {
    const npc = spawn(p, name);
    for (const [seed, expected] of [[0, 25], [4640, 40]]) {
      JavaRandom.setSeed(seed);
      assert.equal(result(p, '[proc,myreque2_gadderhammer_hit]', [20], npc), expected, name);
    }
  }
  for (const [name, damage] of [['shade_level1', 0], ['goblin', 20]]) {
    const npc = spawn(p, name);
    JavaRandom.setSeed(4640);
    const next = JavaRandom.nextDouble();
    JavaRandom.setSeed(4640);
    assert.equal(result(p, '[proc,myreque2_gadderhammer_hit]', [damage], npc), damage);
    assert.equal(JavaRandom.nextDouble(), next, `${name}: unchanged damage must not consume a bonus roll`);
  }
});

check('native melee applies the hammer bonus before actual NPC damage, XP and hero credit; other hits are unchanged', () => {
  for (const [weapon, target, seed, bonus] of [
    ['gadderanks_warhammer', 'shade_level5', 0, 'quarter'],
    ['gadderanks_warhammer', 'shade_level5', 76, 'double'],
    ['dragon_dagger', 'shade_level5', 0, 'none'],
    ['gadderanks_warhammer', 'goblin', 0, 'none']
  ]) {
    const p = player();
    setStage(p, 421);
    give(p, weapon);
    itemOption(p, weapon, 2);
    assert.equal(count(p, weapon, worn), 1, p.messages.slice(-3).join(' '));
    const npc = spawn(p, target);
    const hp = npc.levels[NpcStat.HITPOINTS];
    const xp = p.stats[PlayerStat.ATTACK];
    const draws = [];
    const originals = new Map([ScriptOpcode.RANDOM, ScriptOpcode.RANDOMINC].map(op => [op, ScriptRunner.HANDLERS[op]]));
    for (const [op, original] of originals) ScriptRunner.HANDLERS[op] = state => {
      const script = state.script.name;
      original(state);
      if (script === '[label,player_melee_attack]' || script === '[proc,myreque2_gadderhammer_hit]') {
        draws.push({ script, op, value: state.intStack[state.isp - 1] });
      }
    };
    try {
      JavaRandom.setSeed(seed);
      talk(p, npc, [], 2);
    } finally {
      for (const [op, original] of originals) ScriptRunner.HANDLERS[op] = original;
    }
    const base = draws.find(draw => draw.script === '[label,player_melee_attack]' && draw.op === ScriptOpcode.RANDOMINC)?.value;
    assert(base > 0, `${weapon}/${target}: fixture must land a positive real damage roll`);
    const bonusDraws = draws.filter(draw => draw.script === '[proc,myreque2_gadderhammer_hit]');
    assert.equal(bonusDraws.length, bonus === 'none' ? 0 : 1);
    if (bonus !== 'none') assert.equal(bonusDraws[0].value === 0, bonus === 'double');
    const expected = Math.min(hp, bonus === 'double' ? base * 2 : bonus === 'quarter' ? Math.floor(base * 5 / 4) : base);
    assert.equal(npc.heroPoints.find(hero => hero.hash64 === p.hash64)?.points, expected);
    const multiplier = npc.vars[id('VarNpcType', 'npc_combat_xp_multiplier')];
    assert.equal(p.stats[PlayerStat.ATTACK] - xp, Math.floor(expected * 40 * multiplier / 1000) * Environment.NODE_XPRATE);
    for (let ticks = 0; npc.levels[NpcStat.HITPOINTS] === hp && ticks < 4; ticks++) {
      World.currentTick++;
      npc.turn();
    }
    assert.equal(hp - npc.levels[NpcStat.HITPOINTS], expected, 'the real queued NPC damage must match XP and hero credit');
  }
});

check('all four native balance doses consume exactly one dose on the owned captive', () => {
  for (let doses = 1; doses <= 4; doses++) {
    const p = player();
    setStage(p, 421);
    give(p, 'burgh_rod_command_final_10');
    itemOption(p, 'burgh_rod_command_final_10', 2);
    const npc = spawn(p, 'burgh_vampire_juve_1');
    npc.levels[NpcStat.HITPOINTS] = Math.floor(npc.baseLevels[NpcStat.HITPOINTS] / 4);
    p.setVar(id('VarPlayerType', 'sa_energy'), 1000);
    p.setVar(id('VarPlayerType', 'sa_attack'), 1);
    talk(p, npc, [], 2);
    const potion = `burgh_guthix_balance_${doses}`;
    give(p, potion);
    JavaRandom.setSeed(4096);
    useNpc(p, npc, potion);
    assert.equal(count(p, potion), 0);
    assert.equal(count(p, doses === 1 ? 'vial_empty' : `burgh_guthix_balance_${doses - 1}`), 1);
    assert.equal(npc.type, id('NpcType', 'burgh_turned_vampyre_male_ben'));
  }
});

check('capture cannot precede completion or spend a charge on an unsupported creature', () => {
  for (const [active, target] of [[400, 'burgh_vampire_juve_1'], [421, 'goblin']]) {
    const p = player();
    setStage(p, active);
    give(p, 'burgh_rod_command_final_10');
    itemOption(p, 'burgh_rod_command_final_10', 2);
    const npc = spawn(p, target);
    npc.levels[NpcStat.HITPOINTS] = Math.max(1, Math.floor(npc.baseLevels[NpcStat.HITPOINTS] / 4));
    p.setVar(id('VarPlayerType', 'sa_energy'), 1000);
    p.setVar(id('VarPlayerType', 'sa_attack'), 1);
    talk(p, npc, [], 2);
    assert.equal(npc.type, id('NpcType', target));
    assert.equal(count(p, 'burgh_rod_command_final_10', worn), 1);
    assert.equal(count(p, 'burgh_rod_command_final_9', worn), 0);
  }
});

check('Veliaf can replace the lost earned Gadderhammer throughout every remaining stage', () => {
  for (const active of [120, 130, 150, 200, 210, 240, 300, 400, 421]) {
    const p = player();
    setStage(p, active);
    const veliaf = spawn(p, 'route_veliaf_hurtz');
    talk(p, veliaf);
    assert.equal(count(p, 'gadderanks_warhammer'), 1, `hammer recovery at ${active}`);
    const after = stage(p);
    talk(p, veliaf);
    assert.equal(count(p, 'gadderanks_warhammer'), 1, 'replacement cannot duplicate a held hammer');
    assert.equal(stage(p), after);
  }
});

function escortExit() {
  const loc = nativeLocs('burgh_swamp_exit_path').find(value => value.level === 0
    && value.x >= 2835 && value.x <= 2836 && value.z >= 4576 && value.z <= 4577);
  assert(loc, 'the escape target must be one of the original four swamp-path map tiles');
  return loc;
}

function startEscort(p, { equipment = false, food = 0 } = {}) {
  const ivan = spawn(p, 'route_ivan_strom');
  if (equipment) give(p, 'silver_sickle_blessed');
  talk(p, ivan);
  assert.equal(stage(p), 130, 'Ivan cannot leave before the two members are ready');
  talk(p, spawn(p, 'route_radigad_ponfit'));
  talk(p, spawn(p, 'route_polmafi_ferdygris'));
  if (equipment) {
    for (const name of ['silver_sickle_blessed', 'steel_med_helm', 'steel_chainbody', 'steel_platelegs']) {
      give(p, name);
      useNpc(p, ivan, name);
      assert.equal(count(p, name), name === 'silver_sickle_blessed' ? 1 : 0, `Ivan accepts the real provision ${name} without taking the last combat sickle`);
    }
  }
  for (let meal = 0; meal < food; meal++) {
    give(p, 'stew');
    useNpc(p, ivan, 'stew');
    assert.equal(count(p, 'stew'), 0);
  }
  talk(p, ivan, [1]);
  assert.equal(stage(p), 150);
  landing(p, [2838, 4579, 0], 'original cached swamp escort area');
  const follower = ownedActor(p, equipment ? 'burgh_ivan_strom_temple_ambush_sickle' : 'burgh_ivan_strom_temple_ambush');
  const first = ownedActor(p, 'burgh_ivan_temple_vampire_juve_1');
  const second = ownedActor(p, 'burgh_ivan_temple_vampire_juve_2');
  for (const npc of [follower, first, second]) {
    assert(!map.isMapBlocked(npc.x, npc.z, npc.level), 'escort actors must spawn on packed walkable tiles');
    adjacent(p, npc);
    assert(map.findPath(p.level, 2838, 4579, p.x, p.z).length > 0
      || (p.x === 2838 && p.z === 4579), 'every escort actor has an approach from the actual arrival tile');
  }
  assert.equal(follower.target, p, 'the owned Ivan must really follow the player, not just show a follow animation');
  return { ivan, follower, first, second };
}

check('unprotected Ivan takes real native NPC damage, fails safely and can be escorted again', () => {
  const p = player();
  setStage(p, 130);
  const actors = startEscort(p);
  assert.equal(actors.first.target, actors.follower, 'the first hostile initially targets the real Ivan NPC');
  assert.equal(actors.second.target, actors.follower, 'the second hostile initially targets the real Ivan NPC');
  place(p, 2838, 4582);
  const hits = [];
  const damage = ScriptRunner.HANDLERS[ScriptOpcode.NPC_DAMAGE];
  ScriptRunner.HANDLERS[ScriptOpcode.NPC_DAMAGE] = state => {
    const victim = state.activeNpc, before = victim.levels[NpcStat.HITPOINTS];
    damage(state);
    if (victim === actors.follower) hits.push({ before, after: victim.levels[NpcStat.HITPOINTS], script: state.script.name });
  };
  JavaRandom.setSeed(0);
  try {
    for (let cycle = 0; cycle < 200 && actors.follower.isActive; cycle++) {
      tick(p);
      turnNpcs(actors.follower, actors.first, actors.second);
      p.processQueues();
    }
  } finally { ScriptRunner.HANDLERS[ScriptOpcode.NPC_DAMAGE] = damage; }
  assert(hits.some(hit => hit.before > hit.after), 'real hostile NPC attacks must reduce Ivan HP');
  assert.equal(actors.follower.isActive, false, 'unprotected Ivan can actually be lost');
  assert.equal(stage(p), 150, 'failure cannot award safety or rewind the quest');
  assert.equal(p.getVar(id('VarPlayerType', 'myreque2_extravar')) & (1 << 15), 0);
  if (p.z >= 4570 && p.z <= 4590) clickLoc(p, escortExit(), [], 2);
  landing(p, [3491, 9824, 0], 'safe original-hideout recovery after losing Ivan');
  talk(p, spawn(p, 'route_ivan_strom'), [1]);
  landing(p, [2838, 4579, 0], 'native restart after a real Ivan combat failure');
  assert(ownedActor(p, 'burgh_ivan_strom_temple_ambush'));
  assert(ownedActor(p, 'burgh_ivan_temple_vampire_juve_1'));
  assert(ownedActor(p, 'burgh_ivan_temple_vampire_juve_2'));
});

check('native Ivan provisioning caps food at fifteen and consumes each armour piece only once', () => {
  const p = player();
  setStage(p, 130);
  const ivan = spawn(p, 'route_ivan_strom');
  for (const raw of ['stew1', 'stew2']) {
    give(p, raw);
    useNpc(p, ivan, raw);
    assert.equal(count(p, raw), 1, 'incomplete uncooked stew is not an Ivan provision');
    assert.equal(p.getVarBit(id('VarBitType', 'burgh_ivan_food_give')), 0);
  }
  give(p, 'stew', 16);
  for (let food = 1; food <= 15; food++) {
    useNpc(p, ivan, 'stew');
    assert.equal(p.getVarBit(id('VarBitType', 'burgh_ivan_food_give')), food);
    assert.equal(count(p, 'stew'), 16 - food);
  }
  useNpc(p, ivan, 'stew');
  assert.equal(p.getVarBit(id('VarBitType', 'burgh_ivan_food_give')), 15);
  assert.equal(count(p, 'stew'), 1, 'a sixteenth food is refused without consuming it');
  for (const [name, variable] of [['steel_med_helm', 'burgh_ivan_armour_give_helm'],
    ['steel_chainbody', 'burgh_ivan_armour_give_body'], ['steel_platelegs', 'burgh_ivan_armour_give_legs']]) {
    give(p, name, 2);
    useNpc(p, ivan, name);
    assert.equal(p.getVarBit(id('VarBitType', variable)), 1);
    assert.equal(count(p, name), 1);
    useNpc(p, ivan, name);
    assert.equal(count(p, name), 1, 'a duplicate armour piece is not consumed');
  }
  give(p, 'silver_sickle');
  useNpc(p, ivan, 'silver_sickle');
  assert.equal(count(p, 'silver_sickle'), 0, 'the period guide plain silver sickle is accepted');
  assert.equal(p.getVarBit(id('VarBitType', 'ivan_sickle_give')), 1);
  give(p, 'silver_sickle');
  useNpc(p, ivan, 'silver_sickle');
  assert.equal(count(p, 'silver_sickle'), 1, 'a second sickle is not consumed');
});

check('gifted steel armour increases the actual native defence roll against Ivan', () => {
  const rolls = [];
  for (const equipment of [false, true]) {
    const p = player();
    setStage(p, 130);
    const { first } = startEscort(p, { equipment });
    place(p, 2838, 4582);
    const draws = [];
    const random = ScriptRunner.HANDLERS[ScriptOpcode.RANDOMINC];
    ScriptRunner.HANDLERS[ScriptOpcode.RANDOMINC] = state => {
      const attack = state.script.name === '[proc,myreque2_escort_vampire_attack]';
      const bound = state.intStack[state.isp - 1];
      random(state);
      if (attack) draws.push(bound);
    };
    try {
      JavaRandom.setSeed(0);
      for (let cycle = 0; cycle < 20 && draws.length < 2; cycle++) {
        tick(p);
        turnNpcs(first);
      }
    } finally { ScriptRunner.HANDLERS[ScriptOpcode.RANDOMINC] = random; }
    assert(draws.length >= 2, 'the real hostile AI must roll attack and defence');
    rolls.push(draws[1]);
  }
  assert(rolls[1] > rolls[0], 'received armour must affect combat, not just provisioning flags');
});

check('Ivan consumes a real gifted stew to heal after an actual native hostile attack', () => {
  const p = player();
  setStage(p, 130);
  const { follower, first } = startEscort(p, { food: 1 });
  place(p, 2838, 4582);
  // Reachable injury fixture; the real hostile AI must choose and consume the food.
  follower.applyDamage(follower.levels[NpcStat.HITPOINTS] - 15, 1);
  const heals = [];
  const heal = ScriptRunner.HANDLERS[ScriptOpcode.NPC_STATHEAL];
  ScriptRunner.HANDLERS[ScriptOpcode.NPC_STATHEAL] = state => {
    const victim = state.activeNpc, before = victim.levels[NpcStat.HITPOINTS];
    const script = state.script.name;
    heal(state);
    if (victim === follower) heals.push({ before, after: victim.levels[NpcStat.HITPOINTS], script });
  };
  try {
    JavaRandom.setSeed(0);
    for (let cycle = 0; cycle < 20 && p.getVarBit(id('VarBitType', 'burgh_ivan_food_give')) > 0; cycle++) {
      tick(p);
      turnNpcs(first);
    }
  } finally { ScriptRunner.HANDLERS[ScriptOpcode.NPC_STATHEAL] = heal; }
  assert(heals.some(hit => hit.after > hit.before && hit.script === '[proc,myreque2_escort_ivan_eat]'),
    'the actual NPC healing opcode must increase Ivan HP');
  assert.equal(p.getVarBit(id('VarBitType', 'burgh_ivan_food_give')), 0, 'the used provision is spent');
  assert.equal((p.getVar(id('VarPlayerType', 'myreque2_extravar')) >>> 18) & 255, 0, 'the spent food heal is removed from its saved pool');
});

check('a real owner hit distracts the hostile and lets gifted-sickle Ivan deal native NPC damage', () => {
  const p = player();
  setStage(p, 130);
  const { follower, first } = startEscort(p, { equipment: true });
  itemOption(p, 'silver_sickle_blessed', 2);
  adjacent(p, first);
  JavaRandom.setSeed(0);
  talk(p, first, [], 2);
  assert(first.heroPoints.some(hero => hero.hash64 === p.hash64 && hero.points > 0),
    'a real native owner hit, not fixture hero credit, must enable Ivan assistance');
  // The player stops attacking after one hit so Ivan's contribution is observable.
  p.clearInteraction();
  // Step aside after the hit: the owner must not occupy Ivan's attack approach.
  place(p, first.x, first.z - 1, first.level);
  assert(!map.isMapBlocked(p.x, p.z, p.level));
  const hits = [];
  const damage = ScriptRunner.HANDLERS[ScriptOpcode.NPC_DAMAGE];
  ScriptRunner.HANDLERS[ScriptOpcode.NPC_DAMAGE] = state => {
    const victim = state.activeNpc, before = victim.levels[NpcStat.HITPOINTS];
    const script = state.script.name;
    damage(state);
    if (victim === first && script === '[proc,myreque2_escort_apply_secondary_hit]') {
      hits.push(before - victim.levels[NpcStat.HITPOINTS]);
    }
  };
  try {
    for (let cycle = 0; cycle < 100 && !hits.some(hit => hit > 0); cycle++) {
      World.currentTick++;
      turnNpcs(first, follower);
      p.processQueues();
    }
  } finally { ScriptRunner.HANDLERS[ScriptOpcode.NPC_DAMAGE] = damage; }
  assert.equal(first.target, p, 'native retaliation diverts the vampire from Ivan to its owner');
  assert.equal(follower.target, first, 'the gifted sickle enables real NPC-to-NPC assistance');
  assert(hits.some(hit => hit > 0), 'Ivan must land actual native damage, not just play a combat animation');
});

check('native member order, optional provisions, actual escort kills, following and Drezel arrival', () => {
  const p = player();
  setStage(p, 130);
  const { follower, first, second } = startEscort(p, { equipment: true, food: 1 });
  const stranger = player();
  setStage(stranger, 150);
  const beforeMessages = stranger.messages.length;
  assert.equal(result(stranger, '[proc,npc_is_attackable_opt_quiet]', [], first), 0);
  assert.equal(stranger.messages.length, beforeMessages);
  place(p, 3439, 9895);
  talk(p, spawn(p, 'priestperiltrappedmonk2'));
  assert.equal(stage(p), 150, 'Paterdomus alone cannot bypass the two real kills');
  place(p, 2838, 4579);
  killNpc(p, first);
  killNpc(p, second);
  const exit = escortExit();
  const oldFollower = [follower.x, follower.z];
  approach(p, exit);
  assert(map.findPath(0, 2838, 4579, p.x, p.z).length > 0, 'the original exit is reachable from the escort start');
  for (let ticks = 0; ticks < 20 && Math.max(Math.abs(follower.x - p.x), Math.abs(follower.z - p.z)) > 1; ticks++) {
    World.currentTick++;
    turnNpcs(follower);
  }
  assert.notDeepEqual([follower.x, follower.z], oldFollower, 'native playerfollow must move Ivan along the packed route');
  assert(Math.max(Math.abs(follower.x - p.x), Math.abs(follower.z - p.z)) <= 1, 'Ivan actually reaches the exit approach');
  clickLoc(p, exit, [], 2);
  landing(p, [3440, 9899, 0], 'original Paterdomus lower floor beside Drezel');
  landing(follower, [3439, 9899, 0], 'owned Ivan beside the original Paterdomus arrival');
  place(p, 3439, 9895);
  const drezel = spawn(p, 'priestperiltrappedmonk2');
  talk(p, drezel);
  assert.equal(stage(p), 200, 'owned Ivan plus both native kill credits earns the arrival');
  assert.equal(follower.isActive, false, 'the completed private escort is removed');
  assert.equal(count(p, 'burgh_key'), 0, 'the arrival dialogue must not also run the library branch');
  talk(p, drezel);
  assert.equal(stage(p), 210);
  assert.equal(count(p, 'burgh_key'), 1);
});

check('premature escape and a foreign kill cannot earn the escort and leave a native restart', () => {
  const p = player();
  setStage(p, 130);
  const { first } = startEscort(p);
  const stranger = player();
  killNpc(stranger, first);
  assert.equal(p.getVar(id('VarPlayerType', 'myreque2_extravar')) & (1 << 16), 0, 'a foreign hero cannot write the owner kill bit');
  clickLoc(p, escortExit(), [], 2);
  landing(p, [3491, 9824, 0], 'original Myreque hideout return');
  assert.equal(stage(p), 150, 'failure never rewinds the quest or awards arrival');
  talk(p, spawn(p, 'route_ivan_strom'), [1]);
  landing(p, [2838, 4579, 0], 'restart after premature escape');
  assert(ownedActor(p, 'burgh_ivan_temple_vampire_juve_1'));
  assert(ownedActor(p, 'burgh_ivan_temple_vampire_juve_2'));
});

check('native save/reload retains member readiness and replaces the abandoned escort ownership', () => {
  const original = player();
  setStage(original, 130);
  const actors = startEscort(original);
  killNpc(original, actors.first);
  const saved = { username: original.username, data: original.save() };
  leavePlayer(original);
  for (let ticks = 0; ticks < 12; ticks++) {
    World.currentTick++;
    turnNpcs(actors.follower, actors.second);
  }
  assert.equal(actors.follower.isActive, false);
  assert.equal(actors.second.isActive, false);
  const p = player(saved);
  assert.equal(stage(p), 150);
  assert.equal((p.getVar(id('VarPlayerType', 'myreque2_extravar')) >>> 13) & 3, 3);
  place(p, 3491, 9824);
  talk(p, spawn(p, 'route_ivan_strom'), [1]);
  landing(p, [2838, 4579, 0], 'restart after actual player reload');
  for (const name of ['burgh_ivan_strom_temple_ambush', 'burgh_ivan_temple_vampire_juve_1', 'burgh_ivan_temple_vampire_juve_2']) {
    const actor = ownedActor(p, name);
    assert.notEqual(actor.vars[id('VarNpcType', 'npc_aggressive_player')], original.uid);
  }
  assert.equal((p.getVar(id('VarPlayerType', 'myreque2_extravar')) >>> 16) & 3, 0,
    'a restarted attempt requires both actual kills again');
});

console.log(`PASS In Aid of the Myreque: ${checks} compiled native-dispatch checks`);
process.exit(0);
