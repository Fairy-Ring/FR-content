import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const engineRoot = path.resolve(process.env.HARNESS_ENGINE_DIR ?? path.join(contentRoot, '../engine'));
export const packRoot = path.resolve(process.env.HARNESS_PACK_DIR ?? path.join(engineRoot, 'data/pack'));

assert(fs.existsSync(path.join(engineRoot, 'src/engine/World.ts')), `missing sibling engine source: ${engineRoot}`);
assert(fs.existsSync(packRoot), `missing built engine pack: ${packRoot}; build the content pack before running this test`);
assert(
  fs.existsSync(path.join(packRoot, 'server/script.dat')) && fs.existsSync(path.join(packRoot, 'server/script.idx')),
  `missing packed scripts in ${packRoot}/server; build the content pack before running this test`
);
assert(
  fs.existsSync(path.join(packRoot, '.cache/maps-server.zip')) || fs.existsSync(path.join(packRoot, 'server/maps')),
  `missing packed collision maps in ${packRoot}`
);
process.chdir(engineRoot);

const load = async relative => import(pathToFileURL(path.join(engineRoot, 'src', relative)).href);
export const engineModule = load;
const defaultExport = async relative => (await load(relative)).default;
export const World = await defaultExport('engine/World.ts');
export const Player = await defaultExport('engine/entity/Player.ts');
export const Npc = await defaultExport('engine/entity/Npc.ts');
export const Loc = await defaultExport('engine/entity/Loc.ts');
export const Obj = await defaultExport('engine/entity/Obj.ts');
export const ScriptProvider = await defaultExport('engine/script/ScriptProvider.ts');
export const ScriptRunner = await defaultExport('engine/script/ScriptRunner.ts');
export const ScriptState = await defaultExport('engine/script/ScriptState.ts');
export const ServerTriggerType = await defaultExport('engine/script/ServerTriggerType.ts');
export const { EntityLifeCycle } = await load('engine/entity/EntityLifeCycle.ts');
export const { PlayerTimerType } = await load('engine/entity/EntityTimer.ts');
export const { PlayerStat } = await load('engine/entity/PlayerStat.ts');
export const { BlockWalk } = await load('engine/entity/BlockWalk.ts');
export const { CoordGrid } = await load('engine/CoordGrid.ts');
export const map = await load('engine/GameMap.ts');
export const Environment = await defaultExport('util/Environment.ts');

export const types = {};
for (const name of [
  'VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType', 'NpcType',
  'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType',
  'DbRowType', 'Component', 'FontType', 'HuntType', 'IdkType'
]) {
  types[name] = await defaultExport(`cache/config/${name}.ts`);
  types[name].load(packRoot);
}
(await defaultExport('cache/config/DbTableIndex.ts')).init();
assert(ScriptProvider.load(packRoot) > 0, 'the real compiled script pack must load');
Environment.NODE_MEMBERS = true;
World.currentTick = 100;
World.gameMap.init();

export function id(kind, name) {
  const value = types[kind].getId(name);
  assert(value >= 0, `missing packed ${kind} ${name}`);
  return value;
}
export const objectId = name => id('ObjType', name);
export const inventoryId = id('InvType', 'inv');
export const wornId = id('InvType', 'worn');
export const inventoryComponent = id('Component', 'inventory:inv');
export const wornComponent = id('Component', 'wornitems:worn');

let nextPlayerSlot = 1;
let nextNpcId = 1;
export function makePlayer(position = { level: 0, x: 3168, z: 9758 }) {
  const slot = nextPlayerSlot++;
  const player = new Player(`championvm${slot}`, BigInt(slot), BigInt(slot));
  player.slot = slot;
  player.pid = slot;
  player.uid = ((slot << 11) | slot) >>> 0;
  player.level = position.level;
  player.x = position.x;
  player.z = position.z;
  player.isActive = true;
  player.vars.fill(0);
  player.baseLevels.fill(99);
  player.levels.fill(99);
  player.stats.fill(0);
  player.levels[PlayerStat.HITPOINTS] = 100;
  player.baseLevels[PlayerStat.HITPOINTS] = 100;
  player.getInventory(inventoryId);
  player.getInventory(wornId);
  player.messages = [];
  player.packets = [];
  player.write = packet => player.packets.push(packet);
  player.messageGame = text => player.messages.push(String(text));
  player.wrappedMessageGame = player.messageGame;
  player.originX = position.x;
  player.originZ = position.z;
  player.tabs[3] = types.Component.get(inventoryComponent).rootLayer;
  player.tabs[4] = types.Component.get(wornComponent).rootLayer;
  player.invListenOnCom(inventoryId, inventoryComponent, player.uid);
  player.invListenOnCom(wornId, wornComponent, player.uid);
  World.players[slot] = player;
  World.playerLoop.add(player.hash64, player);
  return player;
}

export function resetPlayer(player, position = { level: 0, x: 3168, z: 9758 }) {
  player.vars.fill(0);
  player.varsString.fill('');
  player.baseLevels.fill(99);
  player.levels.fill(99);
  player.stats.fill(0);
  player.levels[PlayerStat.HITPOINTS] = 100;
  player.baseLevels[PlayerStat.HITPOINTS] = 100;
  player.getInventory(inventoryId).removeAll();
  player.getInventory(wornId).removeAll();
  player.queue.clear();
  player.weakQueue.clear();
  player.engineQueue.clear();
  player.timers.clear();
  player.activeScript = null;
  player.protect = false;
  player.delayed = false;
  player.clearPendingAction();
  player.clearInteraction();
  player.target = null;
  player.nextTarget = null;
  player.clearWaypoints();
  player.lastUseItem = -1;
  player.lastUseSlot = -1;
  player.lastItem = -1;
  player.lastSlot = -1;
  player.lastCom = -1;
  player.resumeButtons = [];
  player.modalMain = -1;
  player.modalChat = -1;
  player.modalSide = -1;
  player.modalTutorial = -1;
  player.overlay = -1;
  player.modalState = 0;
  player.level = position.level;
  player.x = position.x;
  player.z = position.z;
  player.originX = position.x;
  player.originZ = position.z;
  player.messages.length = 0;
  player.packets.length = 0;
}

export function makeNpc(name, position = { level: 0, x: 3168, z: 9758 }) {
  const type = types.NpcType.getByName(name);
  assert(type, `missing packed npc ${name}`);
  const npc = new Npc(
    position.level, position.x, position.z, type.size, type.size,
    EntityLifeCycle.RESPAWN, nextNpcId++, type.id, type.blockwalk
  );
  npc.isActive = true;
  npc.lastMovement = -100;
  World.addNpc(npc, -1);
  return npc;
}

export function removeNpc(npc) {
  if (npc.nid < 0) return;
  const nid = npc.nid;
  World.removeNpc(npc, -1);
  World.npcs.remove(nid);
  npc.cleanup();
}


export function finishNpc(npc, state, label) {
  for (let tick = 0; state.execution !== ScriptState.FINISHED && tick < 80; tick++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, `${label} aborted`);
    assert(
      state.execution === ScriptState.NPC_SUSPENDED || state.execution === ScriptState.SUSPENDED || state.execution === ScriptState.RUNNING,
      `${label} unexpected execution state ${state.execution}`
    );
    World.currentTick++;
    npc.delayed = false;
    npc.executeScript(state);
  }
  assert.equal(state.execution, ScriptState.FINISHED, `${label} completed`);
  return state;
}

export function finishPlayer(player, state, label) {
  for (let tick = 0; state.execution !== ScriptState.FINISHED && tick < 80; tick++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, `${label} aborted`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      assert.fail(`${label} unexpectedly opened dialogue`);
    }
    assert(
      state.execution === ScriptState.SUSPENDED || state.execution === ScriptState.RUNNING,
      `${label} unexpected execution state ${state.execution}`
    );
    World.currentTick = Math.max(World.currentTick + 1, player.delayedUntil);
    player.delayed = false;
    player.executeScript(state, true, true);
  }
  assert.equal(state.execution, ScriptState.FINISHED, `${label} completed`);
  return state;
}

export function runPlayer(name, player, target = null, args = []) {
  const script = ScriptProvider.getByName(name);
  assert(script, `missing packed script ${name}`);
  const state = ScriptRunner.init(script, player, target, args);
  player.executeScript(state, true, true);
  return finishPlayer(player, state, name);
}

export function runProc(name, player, args = [], target = null) {
  return runPlayer(`[proc,${name}]`, player, target, args);
}

export function stack(state) {
  return state.intStack.slice(0, state.isp);
}

export function runNpcScript(name, npc, player = null, args = []) {
  const script = ScriptProvider.getByName(name);
  assert(script, `missing packed script ${name}`);
  const state = ScriptRunner.init(script, npc, player, args);
  npc.executeScript(state);
  return finishNpc(npc, state, name);
}

export function dispatchNpcTrigger(trigger, npc, player = null) {
  const type = types.NpcType.get(npc.type);
  const script = ScriptProvider.getByTrigger(trigger, type.id, type.category);
  assert(script, `missing packed ${ServerTriggerType[trigger]} trigger for ${type.debugname}`);
  const state = ScriptRunner.init(script, npc, player);
  npc.executeScript(state);
  return finishNpc(npc, state, `${ServerTriggerType[trigger]} ${type.debugname}`);
}

export function dispatchPlayerNpc(trigger, player, npc) {
  player.target = npc;
  player.targetOp = trigger - 7;
  assert(player.tryInteract(false), `Player dispatch reaches ${ServerTriggerType[trigger]}`);
  return player.activeScript;
}

export function tickPlayer(...players) {
  for (const player of players) player.resetEntity(false);
  World.currentTick++;
  for (const player of players) {
    if (player.delayed && World.currentTick >= player.delayedUntil) player.delayed = false;
    if (!player.delayed && player.activeScript?.execution === ScriptState.SUSPENDED) {
      player.executeScript(player.activeScript, true, true);
    }
    player.processQueues();
    if (!player.loggingOut) {
      player.processTimers(PlayerTimerType.NORMAL);
      player.processTimers(PlayerTimerType.SOFT);
    }
    player.processEngineQueue();
    player.processInteraction();
  }
}

export function count(player, name, inventory = inventoryId) {
  return player.invTotal(inventory, objectId(name));
}

export function findWorldLoc(name, areas = [
  { level: 0, minX: 3136, maxX: 3199, minZ: 3328, maxZ: 3391 },
  { level: 0, minX: 3136, maxX: 3199, minZ: 9728, maxZ: 9791 },
  { level: 1, minX: 3136, maxX: 3199, minZ: 9728, maxZ: 9791 }
]) {
  const typeId = id('LocType', name);
  const found = [];
  for (const area of areas) {
    for (let x = area.minX; x <= area.maxX; x += 8) {
      for (let z = area.minZ; z <= area.maxZ; z += 8) {
        const zone = World.gameMap.getZone(x, z, area.level);
        for (const loc of zone.getAllLocsUnsafe()) {
          if (loc.baseType === typeId) found.push(loc);
        }
      }
    }
  }
  return found;
}

export function runLocOption(player, loc, handler, OpLoc, option = 1) {
  player.originX = player.x;
  player.originZ = player.z;
  assert(handler.handle(new OpLoc(option, loc.x, loc.z, loc.type), player), `real loc option ${option} accepted`);
  player.processInteraction();
  if (player.activeScript && player.activeScript.execution !== ScriptState.FINISHED) {
    finishPlayer(player, player.activeScript, `loc ${types.LocType.get(loc.type).debugname}`);
  }
}
