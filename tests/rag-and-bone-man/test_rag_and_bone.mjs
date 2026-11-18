import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.on('uncaughtException', error => { console.error(error); process.exit(1); });
process.on('unhandledRejection', error => { console.error(error); process.exit(1); });

const contentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engineRoot = path.resolve(process.env.HARNESS_ENGINE_DIR ?? path.join(contentRoot, '../engine'));
const packOption = process.argv.indexOf('--pack');
assert(packOption < 0 || process.argv[packOption + 1], '--pack requires a path');
const requestedPack = path.resolve(packOption >= 0
  ? process.argv[packOption + 1]
  : process.env.HARNESS_PACK_DIR ?? path.join(engineRoot, 'data/pack'));
const packDir = path.basename(requestedPack) === 'server' ? path.dirname(requestedPack) : requestedPack;
assert(fs.existsSync(path.join(packDir, 'server/script.dat')), `compiled scripts missing from selected pack: ${packDir}`);
const load = relative => import(pathToFileURL(path.join(engineRoot, 'src', relative)).href);

const Environment = (await load('util/Environment.ts')).default;
const World = (await load('engine/World.ts')).default;
const gameMap = await load('engine/GameMap.ts');
const Player = (await load('engine/entity/Player.ts')).default;
const Npc = (await load('engine/entity/Npc.ts')).default;
const EntityLifeCycle = (await load('engine/entity/EntityLifeCycle.ts')).EntityLifeCycle;
const { PlayerStat } = await load('engine/entity/PlayerStat.ts');
const { NpcStat } = await load('engine/entity/NpcStat.ts');
const { PlayerTimerType } = await load('engine/entity/EntityTimer.ts');
const ScriptProvider = (await load('engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('engine/script/ScriptState.ts')).default;
const { ScriptOpcode } = await load('engine/script/ScriptOpcode.ts');
const ServerTriggerType = (await load('engine/script/ServerTriggerType.ts')).default;
const JavaRandom = (await load('util/JavaRandom.ts')).default;
const Packet = (await load('io/Packet.ts')).default;
const { PlayerLoading } = await load('engine/entity/PlayerLoading.ts');
const rsbuf = await load('network/rsbuf/index.ts');
const OpNpc = (await load('network/game/client/model/OpNpc.ts')).default;
const OpLoc = (await load('network/game/client/model/OpLoc.ts')).default;
const OpLocU = (await load('network/game/client/model/OpLocU.ts')).default;
const OpHeld = (await load('network/game/client/model/OpHeld.ts')).default;
const OpHeldU = (await load('network/game/client/model/OpHeldU.ts')).default;
const InvButton = (await load('network/game/client/model/InvButton.ts')).default;
const IfButton = (await load('network/game/client/model/IfButton.ts')).default;
const ResumePauseButton = (await load('network/game/client/model/ResumePauseButton.ts')).default;
const OpNpcHandler = (await load('network/game/client/handler/OpNpcHandler.ts')).default;
const OpLocHandler = (await load('network/game/client/handler/OpLocHandler.ts')).default;
const OpLocUHandler = (await load('network/game/client/handler/OpLocUHandler.ts')).default;
const OpHeldHandler = (await load('network/game/client/handler/OpHeldHandler.ts')).default;
const OpHeldUHandler = (await load('network/game/client/handler/OpHeldUHandler.ts')).default;
const InvButtonHandler = (await load('network/game/client/handler/InvButtonHandler.ts')).default;
const IfButtonHandler = (await load('network/game/client/handler/IfButtonHandler.ts')).default;
const ResumePauseButtonHandler = (await load('network/game/client/handler/ResumePauseButtonHandler.ts')).default;

const configNames = [
  'VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType', 'ObjType', 'LocType',
  'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType', 'SpotanimType',
  'MesanimType', 'DbTableType', 'DbRowType', 'HuntType', 'IdkType', 'Component', 'FontType'
];
const configs = {};
for (const name of configNames) {
  configs[name] = (await load(`cache/config/${name}.ts`)).default;
  configs[name].load(packDir);
}
const DbTableIndex = (await load('cache/config/DbTableIndex.ts')).default;
DbTableIndex.init();
assert.equal(ScriptProvider.load(packDir) > 0, true, 'selected pack must load compiled scripts');
assert.equal(Environment.NODE_MEMBERS, true, 'Rag and Bone Man is a members quest');

const id = (type, name) => {
  const result = configs[type].getId(name);
  assert.notEqual(result, -1, `${type} config missing: ${name}`);
  return result;
};
const component = name => id('Component', name);
const obj = name => id('ObjType', name);
const inv = id('InvType', 'inv');
const bank = id('InvType', 'bank');
const worn = id('InvType', 'worn');
const invCom = component('inventory:inv');
const wornCom = component('wornitems:worn');
const ragQuest = id('VarPlayerType', 'rag_quest');
const ragBoiler = id('VarBitType', 'rag_boiler');
const ragInvCheck = id('VarBitType', 'rag_inv_check');
const shopVarp = id('VarPlayerType', 'shop');
const ragWine = id('VarBitType', 'rag_wine');
const tutorial = id('VarPlayerType', 'tutorial');
const firemaking = PlayerStat.FIREMAKING;
const cooking = PlayerStat.COOKING;
const prayer = PlayerStat.PRAYER;
const bones = [
  { index: 1, suffix: 'goblin', npc: 'goblin' },
  { index: 2, suffix: 'bear', npc: 'brownbear' },
  { index: 3, suffix: 'medium_frog', npc: 'medium_frog' },
  { index: 4, suffix: 'ram', npc: 'ramsheered' },
  { index: 5, suffix: 'unicorn', npc: 'unicorn' },
  { index: 6, suffix: 'monkey', npc: 'monkey' },
  { index: 7, suffix: 'giant_rat', npc: 'giantrat' },
  { index: 8, suffix: 'giant_bat', npc: 'bat' }
].map(bone => ({
  ...bone,
  raw: `rag_${bone.suffix}_bone`,
  potted: `rag_pot_${bone.suffix}_bone`,
  polished: `rag_polished_${bone.suffix}_bone`
}));
for (const bone of bones) {
  for (const item of [bone.raw, bone.potted, bone.polished]) obj(item);
}

World.currentTick = Math.max(World.currentTick, 100);
World.gameMap.init();
let nextPlayer = 0;
let sharedBoiler;
let boilerApproach;
const npcHandler = new OpNpcHandler();
const locHandler = new OpLocHandler();
const locUseHandler = new OpLocUHandler();
const heldHandler = new OpHeldHandler();
const heldUseHandler = new OpHeldUHandler();
const invButtonHandler = new InvButtonHandler();
const ifButtonHandler = new IfButtonHandler();
const resumeHandler = new ResumePauseButtonHandler();

function newPlayer() {
  const serial = ++nextPlayer;
  const username37 = BigInt(10000 + serial);
  const hash64 = BigInt(1000000 + serial);
  const p = new Player(`ragtest${serial}`, username37, hash64);
  p.slot = serial;
  p.pid = serial;
  p.uid = ((Number(username37 & 0x1fffffn) << 11) | serial) >>> 0;
  p.vars.fill(0);
  p.stats.fill(123456);
  p.baseLevels.fill(99);
  p.levels.fill(99);
  p.x = 3200;
  p.z = 3200;
  p.level = 0;
  p.originX = p.x;
  p.originZ = p.z;
  p.isActive = true;
  p.messages = [];
  p.packets = [];
  p.write = packet => p.packets.push(packet);
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = text => p.messages.push(String(text));
  p.tabs[3] = configs.Component.get(invCom).rootLayer;
  p.tabs[4] = configs.Component.get(wornCom).rootLayer;
  p.getInventory(inv);
  p.getInventory(worn);
  p.invListenOnCom(inv, invCom, p.uid);
  p.invListenOnCom(worn, wornCom, p.uid);
  p.setVar(tutorial, 1000);
  World.players[p.slot] = p;
  World.playerLoop.add(p.hash64, p);
  rsbuf.addPlayer(p.slot);
  const appearance = p.generateAppearance();
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, appearance, p.lastAppearance,
    p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ,
    p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[PlayerStat.HITPOINTS], p.baseLevels[PlayerStat.HITPOINTS],
    p.animId, p.animDelay, p.sayMessage, p.chatMessage, p.chatColour ?? -1,
    p.chatEffect ?? -1, p.chatRights ?? 0, p.spotanimId, p.spotanimHeight, p.spotanimTime);
  return p;
}

function removePlayer(p) {
  if (World.players[p.slot] === p) World.players[p.slot] = null;
  p.unlink();
}

function give(p, name, count = 1, inventory = inv) {
  assert.equal(p.invAdd(inventory, obj(name), count), count, `could not add ${count} ${name}`);
}

function count(p, name, inventory = inv) {
  return p.invTotal(inventory, obj(name));
}

function setQuest(p, stage, mask = 0, high = 0x5a5a0000) {
  p.setVar(ragQuest, (high & 0xfffffc00) | ((mask & 0xff) << 2) | stage);
}

function questStage(p) {
  return p.getVar(ragQuest) & 3;
}

function handedMask(p) {
  return (p.getVar(ragQuest) >>> 2) & 0xff;
}

const dispatchedNames = new WeakMap();
function captureScripts(p, action) {
  const observed = [];
  const execute = p.executeScript;
  p.executeScript = function (state, ...args) {
    dispatchedNames.set(state, state.script.name);
    observed.push(state);
    return execute.call(this, state, ...args);
  };
  try {
    return { result: action(), states: observed };
  } finally {
    p.executeScript = execute;
  }
}

function resumeDialogue(p, choices) {
  assert.equal(p.activeScript?.execution, ScriptState.PAUSEBUTTON, 'dialogue must be waiting for a button');
  const root = configs.Component.get(p.modalChat)?.comName;
  assert(root, 'dialogue pause has no active chat component');
  if (/^multi[2-5]$/.test(root)) {
    assert(choices.length > 0, `missing choice for ${root}`);
    const selected = choices.shift();
    const button = component(`${root}:com_${selected}`);
    p.lastCom = button;
    assert.equal(ifButtonHandler.handle(new IfButton(button), p), true, `choice ${selected} rejected by ${root}`);
  } else {
    assert.equal(resumeHandler.handle(new ResumePauseButton(0), p), true, `could not resume ${root}`);
  }
}

function finishDialogue(p, state, choices = []) {
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 300; step++) {
    if (state.execution === ScriptState.PAUSEBUTTON) {
      p.activeScript = state;
      resumeDialogue(p, choices);
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else {
      assert.fail(`unexpected dialogue execution state ${state.execution} in ${state.script.name}`);
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, `dialogue did not finish: ${state.script.name}`);
  assert.equal(choices.length, 0, 'unused dialogue choices');
  return state;
}

function runDirect(p, name) {
  const script = ScriptProvider.getByName(name);
  assert(script, `compiled script missing: ${name}`);
  const state = ScriptRunner.init(script, p);
  p.runScript(state, true, true);
  return finishDialogue(p, state);
}

function spawnNpc(p, name) {
  const type = configs.NpcType.getByName(name);
  assert(type, `NPC type missing: ${name}`);
  const npc = new Npc(0, p.x + 1, p.z, type.size, type.size,
    EntityLifeCycle.RESPAWN, World.npcs.next(), type.id, type.blockwalk);
  World.addNpc(npc, -1);
  rsbuf.computeNpc(npc.x, npc.level, npc.z, npc.nid, npc.type, npc.tele, npc.jump,
    npc.runDir, npc.walkDir, npc.isActive, npc.masks, npc.faceEntity, npc.faceSquareX,
    npc.faceSquareZ, npc.faceAngleX, npc.faceAngleZ, npc.hitmarkDamage, npc.hitmarkType,
    npc.hitmark2Damage, npc.hitmark2Type, npc.levels[NpcStat.HITPOINTS],
    npc.baseLevels[NpcStat.HITPOINTS], npc.animId, npc.animDelay, npc.sayMessage,
    npc.spotanimId, npc.spotanimHeight, npc.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert.equal(rsbuf.hasNpc(p.slot, npc.nid), true, `${name} must be visible to the interaction packet`);
  return npc;
}

function clickNpc(p, npc, option, choices = []) {
  const observed = captureScripts(p, () => {
    assert.equal(npcHandler.handle(new OpNpc(option, npc.nid), p), true, `NPC option ${option} rejected`);
    p.processInteraction();
  });
  const state = observed.states.at(-1);
  assert(state, `NPC option ${option} did not dispatch a compiled script`);
  return finishDialogue(p, state, choices);
}

function useItems(p, usedName, targetName) {
  const usedId = obj(usedName);
  const targetId = obj(targetName);
  const usedSlot = p.getInventory(inv).getItemIndex(usedId);
  const targetSlot = p.getInventory(inv).getItemIndex(targetId);
  assert.notEqual(usedSlot, -1, `missing used item ${usedName}`);
  assert.notEqual(targetSlot, -1, `missing target item ${targetName}`);
  const observed = captureScripts(p, () => {
    assert.equal(heldUseHandler.handle(new OpHeldU(targetId, targetSlot, invCom, usedId, usedSlot, invCom), p), true,
      `item-on-item rejected: ${usedName} -> ${targetName}`);
  });
  const state = observed.states.at(-1);
  assert(state, `item-on-item did not dispatch: ${usedName} -> ${targetName}`);
  assert.equal(state.execution, ScriptState.FINISHED, `item-on-item script failed: ${state.script.name}`);
  return state;
}

function useItemOption(p, name, option) {
  const itemId = obj(name);
  const slot = p.getInventory(inv).getItemIndex(itemId);
  assert.notEqual(slot, -1, `missing item ${name}`);
  const observed = captureScripts(p, () => {
    assert.equal(heldHandler.handle(new OpHeld(option, itemId, slot, invCom), p), true,
      `inventory option ${option} rejected for ${name}`);
  });
  const state = observed.states.at(-1);
  assert(state, `inventory option ${option} did not dispatch for ${name}`);
  assert.equal(state.execution, ScriptState.FINISHED, `inventory option script failed: ${state.script.name}`);
  return state;
}

function initializeTabs(p) {
  runDirect(p, '[proc,initalltabs]');
}

function shopInventory(p, name) {
  const inventory = id('InvType', name);
  const listener = p.invListeners.find(listener => listener.type === inventory);
  assert(listener, `shop inventory ${name} did not open`);
  return p.getInventoryFromListener(listener);
}

function visibleButton(componentName, pattern) {
  const type = configs.Component.get(component(componentName));
  const option = type.iop.findIndex(label => typeof label === 'string' && pattern.test(label));
  assert.notEqual(option, -1, `button ${pattern} not found in ${componentName}`);
  return option + 1;
}

function buyFromShop(p, inventory, itemName) {
  const stock = shopInventory(p, inventory);
  const itemId = obj(itemName);
  const slot = stock.getItemIndex(itemId);
  assert.notEqual(slot, -1, `${itemName} is not in ${inventory}`);
  const option = visibleButton('shop_template:inv', /^buy\s*1\b/i);
  const observed = captureScripts(p, () => {
    assert.equal(invButtonHandler.handle(new InvButton(option, itemId, slot, component('shop_template:inv')), p), true,
      `buy-one button rejected for ${itemName}`);
  });
  const state = observed.states.at(-1);
  assert(state, `buying ${itemName} did not dispatch a compiled shop script`);
  assert.equal(state.execution, ScriptState.FINISHED, `shop script failed: ${state.script.name}`);
  return state;
}

function createBoiler() {
  const typeId = id('LocType', 'rag_multi_potboiler');
  const type = configs.LocType.get(typeId);
  const source = fs.readFileSync(path.join(contentRoot, 'maps/m52_54.jm2'), 'utf8');
  const locations = source.split('==== LOC ====')[1].split('====')[0];
  const rows = [...locations.matchAll(/^([0-3]) (\d+) (\d+): (\d+)(?: (\d+))?(?: (\d+))?$/gm)]
    .filter(row => Number(row[4]) === typeId);
  assert.equal(rows.length, 1, 'source map must contain the native boiler once');
  const row = rows[0];
  const level = Number(row[1]);
  const x = 52 * 64 + Number(row[2]);
  const z = 54 * 64 + Number(row[3]);
  const shape = Number(row[5] ?? 10);
  const angle = Number(row[6] ?? 0);
  const loc = World.getLoc(x, z, level, typeId);
  assert(loc, 'native boiler must exist in the built packed map');
  assert.equal(loc.shape, shape, 'packed boiler must retain the source shape');
  assert.equal(loc.angle, angle, 'packed boiler must retain the source rotation');
  boilerApproach = [[x - 1, z], [x + type.width, z], [x, z - 1], [x, z + type.length]]
    .find(([px, pz]) => !gameMap.isMapBlocked(px, pz, level)
      && gameMap.reachedLoc(level, px, pz, x, z, type.width, type.length, 1, angle, shape, type.forceapproach));
  assert(boilerApproach, 'native packed collision must provide a reachable boiler approach');
  return loc;
}

function boilerPlayer(firemakingLevel = 99) {
  const p = newPlayer();
  setQuest(p, 1);
  p.setLevel(firemaking, firemakingLevel);
  [p.x, p.z] = boilerApproach;
  p.level = sharedBoiler.level;
  p.originX = p.x;
  p.originZ = p.z;
  return p;
}

function useOnBoiler(p, loc, itemName) {
  const itemId = obj(itemName);
  const slot = p.getInventory(inv).getItemIndex(itemId);
  assert.notEqual(slot, -1, `missing boiler item ${itemName}`);
  p.originX = p.x;
  p.originZ = p.z;
  const observed = captureScripts(p, () => {
    assert.equal(locUseHandler.handle(new OpLocU(loc.x, loc.z, loc.baseType, itemId, slot, invCom), p), true,
      `item-on-boiler rejected: ${itemName}`);
    p.processInteraction();
  });
  const state = observed.states.at(-1);
  assert(state, `item-on-boiler did not dispatch: ${itemName}`);
  assert.equal(state.execution, ScriptState.FINISHED, `boiler script failed: ${state.script.name}`);
  return state;
}

function clickBoiler(p, loc) {
  p.originX = p.x;
  p.originZ = p.z;
  const observed = captureScripts(p, () => {
    const accepted = locHandler.handle(new OpLoc(1, loc.x, loc.z, loc.baseType), p);
    if (accepted) p.processInteraction();
    return accepted;
  });
  const state = observed.states.at(-1);
  if (observed.result) {
    assert(state, 'visible boiler option did not dispatch a compiled script');
    assert.equal(state.execution, ScriptState.FINISHED, `boiler option script failed: ${state.script.name}`);
  } else {
    assert.equal(state, undefined, 'hidden boiler option must not dispatch a script');
  }
  return { accepted: observed.result, state };
}

function tickPlayer(p) {
  World.currentTick++;
  p.processQueues();
  p.processTimers(PlayerTimerType.NORMAL);
  p.processTimers(PlayerTimerType.SOFT);
  p.processEngineQueue();
  p.processInteraction();
}

function rowColour(p) {
  const target = component('questlist:rag');
  const packet = p.packets.findLast(value => value.component === target && Number.isInteger(value.colour));
  assert(packet, 'login did not set the Rag and Bone Man quest-row colour');
  return packet.colour;
}

function readConstant(file, name) {
  const source = fs.readFileSync(path.join(contentRoot, file), 'utf8');
  const match = source.match(new RegExp(`^\\^${name}\\s*=\\s*(0x[0-9a-f]+|\\d+)`, 'im'));
  assert(match, `missing constant ${name} in ${file}`);
  return Number(match[1]);
}

function executeDeath(bone, stage, options = {}) {
  const p = newPlayer();
  setQuest(p, stage, options.mask ?? 0);
  for (const [item, inventory] of options.carried ?? []) give(p, item, 1, inventory);
  if (options.boiler) {
    p.setVarBit(ragBoiler, options.boiler.state);
    p.setVarBit(ragInvCheck, options.boiler.index);
  }
  if (options.tbwtStarted) p.setVar(id('VarPlayerType', 'tbwt_main'), options.tbwtStarted);
  const type = configs.NpcType.getByName(bone.npc);
  assert(type, `death NPC type missing: ${bone.npc}`);
  const npc = new Npc(0, p.x + 1, p.z, type.size, type.size,
    EntityLifeCycle.RESPAWN, World.npcs.next(), type.id, type.blockwalk);
  World.addNpc(npc, -1);
  JavaRandom.setSeed(0x52414700 + bone.index);
  const spawn = ScriptProvider.getByTrigger(ServerTriggerType.AI_SPAWN, type.id, type.category);
  assert(spawn, `spawn trigger missing for ${bone.npc}`);
  const spawnState = ScriptRunner.init(spawn, npc);
  npc.executeScript(spawnState);
  assert.equal(spawnState.execution, ScriptState.FINISHED, `spawn script failed for ${bone.npc}`);
  npc.lastMovement = -100;
  npc.setVar(id('VarNpcType', 'npc_aggressive_player'), p.uid);
  npc.heroPoints.addHero(p.hash64, 8);
  const trigger = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, type.id, type.category);
  assert(trigger, `death trigger missing for ${bone.npc}`);
  const state = ScriptRunner.init(trigger, npc);
  const drops = [];
  const originalAddObj = World.addObj;
  const originalDelete = ScriptRunner.HANDLERS[ScriptOpcode.NPC_DEL];
  let deleteCalls = 0;
  World.addObj = function (item, receiver, duration) {
    drops.push({ id: item.type, count: item.count, receiver: String(receiver) });
    return originalAddObj.call(this, item, receiver, duration);
  };
  ScriptRunner.HANDLERS[ScriptOpcode.NPC_DEL] = current => {
    deleteCalls++;
    return originalDelete(current);
  };
  try {
    npc.applyDamage(npc.levels[NpcStat.HITPOINTS], 1);
    npc.executeScript(state);
    for (let tick = 0; state.execution === ScriptState.NPC_SUSPENDED && tick < 20; tick++) {
      if (World.players[p.slot] === p) p.processQueues();
      World.currentTick = Math.max(World.currentTick + 1, npc.delayedUntil);
      npc.delayed = false;
      npc.executeScript(state);
    }
    if (World.players[p.slot] === p) p.processQueues();
    assert.equal(state.execution, ScriptState.FINISHED, `death script failed for ${bone.npc}`);
    assert.equal(deleteCalls, 1, `death script must delete ${bone.npc} once`);
    assert.equal(npc.isActive, false, `dead NPC ${bone.npc} remains active`);
    World.currentTick++;
    npc.turn();
    assert.equal(deleteCalls, 1, `NPC ${bone.npc} deleted more than once`);
    const sorted = drops.sort((a, b) => a.id - b.id);
    const rawDrop = sorted.find(drop => drop.id === obj(bone.raw));
    if (rawDrop) assert.equal(rawDrop.receiver, p.hash64.toString(), `${bone.suffix} drop must go to its killer`);
    return sorted.map(({ id, count }) => ({ id, count }));
  } finally {
    World.addObj = originalAddObj;
    ScriptRunner.HANDLERS[ScriptOpcode.NPC_DEL] = originalDelete;
    removePlayer(p);
  }
}

async function main() {
  console.log(`RAG_PACK ${requestedPack === path.join(engineRoot, 'data/pack') ? 'default' : 'alternate'}`);

  // Start, both explicit refusals, and a repeated start all travel through NPC option packets.
  {
    const p = newPlayer();
    const oldMan = spawnNpc(p, 'rag_odd_old_man');
    setQuest(p, 0);
    const declineHelp = clickNpc(p, oldMan, 1, [2]);
    assert.equal(dispatchedNames.get(declineHelp), '[opnpc1,rag_odd_old_man]');
    assert.equal(questStage(p), 0, 'declining the first offer must not start the quest');
    const declineQuest = clickNpc(p, oldMan, 1, [1, 2]);
    assert.equal(dispatchedNames.get(declineQuest), '[opnpc1,rag_odd_old_man]');
    assert.equal(questStage(p), 0, 'declining the second offer must not start the quest');
    const accept = clickNpc(p, oldMan, 1, [1, 1]);
    assert.equal(dispatchedNames.get(accept), '[opnpc1,rag_odd_old_man]');
    assert.equal(questStage(p), 1, 'accepting the offer starts the quest');
    assert.equal(handedMask(p), 0, 'starting the quest must preserve an empty hand-in mask');
    const repeat = clickNpc(p, oldMan, 1);
    assert.equal(dispatchedNames.get(repeat), '[opnpc1,rag_odd_old_man]');
    assert.equal(questStage(p), 1, 'repeating the active quest conversation must preserve its stage');
    removePlayer(p);
  }

  // Chemistry uses the live OpHeldU packet handler in both input orders for every bone.
  {
    for (const bone of bones) {
      for (const reverse of [false, true]) {
        const p = newPlayer();
        give(p, 'rag_pot_vinegar');
        give(p, bone.raw);
        const beforeQuest = p.getVar(ragQuest);
        const beforeStats = [...p.stats];
        const state = reverse
          ? useItems(p, bone.raw, 'rag_pot_vinegar')
          : useItems(p, 'rag_pot_vinegar', bone.raw);
        assert.equal(dispatchedNames.get(state), '[opheldu,rag_pot_vinegar]');
        assert.equal(count(p, 'rag_pot_vinegar'), 0);
        assert.equal(count(p, bone.raw), 0);
        assert.equal(count(p, bone.potted), 1, `${bone.suffix} identity lost during potting`);
        assert.equal(count(p, 'pot_empty'), 0, 'the bone-in-pot item retains the pot');
        assert.equal(p.getVar(ragQuest), beforeQuest, 'chemistry must not write quest state');
        assert.deepEqual(Array.from(p.stats), beforeStats, 'chemistry must not award skill XP');
        removePlayer(p);
      }
    }

    for (const reverse of [false, true]) {
      const p = newPlayer();
      give(p, 'rag_vinegar');
      give(p, 'pot_empty');
      const state = reverse
        ? useItems(p, 'pot_empty', 'rag_vinegar')
        : useItems(p, 'rag_vinegar', 'pot_empty');
      assert.equal(dispatchedNames.get(state), reverse ? '[opheldu,rag_vinegar]' : '[opheldu,pot_empty]');
      assert.equal(count(p, 'rag_vinegar'), 0);
      assert.equal(count(p, 'pot_empty'), 0);
      assert.equal(count(p, 'rag_pot_vinegar'), 1, 'vinegar preparation must fill the pot');
      assert.equal(count(p, 'jug_empty'), 1, 'vinegar preparation must return the empty jug');
      removePlayer(p);
    }

    // The shared empty-pot hook must preserve One Small Favour in both item orders.
    const favour = id('VarPlayerType', 'onesmallfavour');
    const favourComplete = readConstant('scripts/general/configs/quest.constant', 'onesmallfavour_complete');
    for (const stage of [0, favourComplete]) {
      for (const reverse of [false, true]) {
        const p = newPlayer();
        setQuest(p, 1);
        p.setVar(favour, stage);
        give(p, 'potlid');
        give(p, 'pot_empty');
        if (reverse) useItems(p, 'pot_empty', 'potlid');
        else useItems(p, 'potlid', 'pot_empty');
        assert.equal(count(p, 'favour_airtight_pot'), stage === 0 ? 0 : 1,
          'Rag must not change One Small Favour pot-lid eligibility');
        assert.equal(count(p, 'potlid'), stage === 0 ? 1 : 0);
        assert.equal(count(p, 'pot_empty'), stage === 0 ? 1 : 0);
        assert.equal(count(p, 'rag_pot_vinegar'), 0, 'the vinegar hook must not pre-empt pot lids');
        removePlayer(p);
      }
    }

    const empties = ['rag_vinegar', 'rag_pot_vinegar', ...bones.map(bone => bone.potted)];
    for (const item of empties) {
      const p = newPlayer();
      give(p, item);
      const expected = item === 'rag_vinegar' ? 'jug_empty' : 'pot_empty';
      const state = useItemOption(p, item, 4);
      assert.equal(dispatchedNames.get(state), `[opheld4,${item}]`);
      assert.equal(count(p, item), 0, `${item} must be consumed by its empty option`);
      assert.equal(count(p, expected), 1, `${item} must return ${expected}`);
      removePlayer(p);
    }
  }

  // Fortunato starts with the regular shop; talking unlocks the vinegar stock and a real purchase.
  {
    const wineMerchant = id('InvType', 'wine_merchant');
    const vinegarMerchant = id('InvType', 'wine_vinegar_merchant');
    const p = newPlayer();
    setQuest(p, 1);
    initializeTabs(p);
    const fortunato = spawnNpc(p, 'rag_wine_merchant');
    const trade = clickNpc(p, fortunato, 3);
    assert.equal(dispatchedNames.get(trade), '[opnpc3,rag_wine_merchant]');
    assert.equal(p.getVar(shopVarp), wineMerchant, 'untalked Fortunato must use the regular shop');
    assert.equal(shopInventory(p, 'wine_merchant').getItemCount(obj('rag_vinegar')), 0,
      'the regular shop must not expose quest vinegar');
    removePlayer(p);

    const q = newPlayer();
    setQuest(q, 1);
    initializeTabs(q);
    const merchant = spawnNpc(q, 'rag_wine_merchant');
    const conversation = clickNpc(q, merchant, 1);
    assert.equal(dispatchedNames.get(conversation), '[opnpc1,rag_wine_merchant]');
    assert.equal(q.getVarBit(ragWine), 1, 'talking to Fortunato must unlock the vinegar shop');
    assert.equal(q.getVar(shopVarp), vinegarMerchant, 'the unlock conversation must open the special shop');
    const stock = shopInventory(q, 'wine_vinegar_merchant');
    assert(stock.getItemCount(obj('rag_vinegar')) > 0, 'unlocked shop must stock vinegar');
    give(q, 'coins');
    const coinsBefore = count(q, 'coins');
    const purchase = buyFromShop(q, 'wine_vinegar_merchant', 'rag_vinegar');
    assert.equal(purchase.execution, ScriptState.FINISHED);
    assert.equal(count(q, 'rag_vinegar'), 1, 'shop purchase must add one jug of vinegar');
    q.closeModal();
    give(q, 'pot_empty');
    useItems(q, 'rag_vinegar', 'pot_empty');
    assert.equal(count(q, 'rag_pot_vinegar'), 1, 'purchased vinegar must enter the bone-preparation recipe');
    assert.equal(coinsBefore - count(q, 'coins'), 1, 'one jug of vinegar must cost one gp');
    removePlayer(q);
  }

  // One real boiler instance exercises forms 0-4, item placement, lighting, exact timer, and removal.
  {
    const loc = sharedBoiler ??= createBoiler();
    const p = boilerPlayer(1);
    assert.equal(clickBoiler(p, loc).accepted, false, 'form 0 has no visible option');
    give(p, 'logs');
    const fireXp = p.stats[firemaking];
    let state = useOnBoiler(p, loc, 'logs');
    assert.equal(dispatchedNames.get(state), '[oplocu,rag_potboiler_nologs]');
    assert.equal(p.getVarBit(ragBoiler), 1, 'logs must change the boiler from form 0 to form 1');
    assert.equal(count(p, 'logs'), 0);
    assert.equal(p.stats[firemaking], fireXp, 'adding logs must not award Firemaking XP');
    assert.equal(clickBoiler(p, loc).accepted, false, 'form 1 has no visible option');

    give(p, 'rag_pot_vinegar');
    give(p, bones[0].raw);
    useItems(p, 'rag_pot_vinegar', bones[0].raw);
    state = useOnBoiler(p, loc, bones[0].potted);
    assert.equal(dispatchedNames.get(state), '[oplocu,rag_potboiler_nopot]');
    assert.equal(p.getVarBit(ragBoiler), 2, 'placing the potted bone must change form 1 to form 2');
    assert.equal(p.getVarBit(ragInvCheck), 1, 'the boiler must remember bone index 1');

    give(p, 'tinderbox');
    state = useOnBoiler(p, loc, 'tinderbox');
    assert.equal(dispatchedNames.get(state), '[oplocu,rag_potboiler_with_pot]');
    assert.equal(p.getVarBit(ragBoiler), 3, 'lighting must change form 2 to form 3');
    assert.equal(p.getVarBit(ragInvCheck), 1);
    give(p, 'pot_empty');
    state = useOnBoiler(p, loc, 'pot_empty');
    assert.equal(dispatchedNames.get(state), '[oplocu,rag_potboiler_onfire]');
    assert.equal(p.getVarBit(ragBoiler), 3, 'invalid form-3 item use must not change state');
    assert.equal(clickBoiler(p, loc).accepted, false, 'form 3 has no visible option');

    const timerScript = ScriptProvider.getByName('[timer,rag_boil]');
    assert(timerScript, 'boil timer script must be loaded');
    assert(p.timers.get(timerScript.id), 'lighting must arm the boil timer');
    for (let tick = 0; tick < 19; tick++) tickPlayer(p);
    assert.equal(p.getVarBit(ragBoiler), 3, 'bone must not boil before 20 ticks');
    tickPlayer(p);
    assert.equal(p.getVarBit(ragBoiler), 4, 'bone must boil on the 20th tick');
    assert.equal(p.getVarBit(ragInvCheck), 1, 'boiling must preserve the bone identity');
    assert.equal(p.timers.get(timerScript.id), undefined, 'completed boil timer must clear');
    state = useOnBoiler(p, loc, 'pot_empty');
    assert.equal(dispatchedNames.get(state), '[oplocu,rag_potboiler_with_pot_boiled]');
    assert.equal(p.getVarBit(ragBoiler), 4, 'invalid form-4 item use must not change state');
    const potsBeforeRemoval = count(p, 'pot_empty');
    assert.equal(clickBoiler(p, loc).accepted, true, 'form 4 must expose Remove-Bone');
    assert.equal(count(p, bones[0].polished), 1);
    assert.equal(count(p, 'pot_empty'), potsBeforeRemoval + 1, 'boiling must return exactly one pot');
    assert.equal(p.getVarBit(ragBoiler), 0, 'removing the boiled bone must reset the boiler');
    assert.equal(p.getVarBit(ragInvCheck), 0, 'removing the boiled bone must clear its index');
    removePlayer(p);

    const low = boilerPlayer(14);
    give(low, 'oak_logs');
    state = useOnBoiler(low, loc, 'oak_logs');
    assert.equal(dispatchedNames.get(state), '[oplocu,rag_potboiler_nologs]');
    assert.equal(low.getVarBit(ragBoiler), 0);
    assert.equal(count(low, 'oak_logs'), 1, 'insufficient Firemaking level must preserve logs');
    low.setLevel(firemaking, 15);
    state = useOnBoiler(low, loc, 'oak_logs');
    assert.equal(dispatchedNames.get(state), '[oplocu,rag_potboiler_nologs]');
    assert.equal(low.getVarBit(ragBoiler), 1, 'required Firemaking level must permit ordinary logs');
    assert.equal(count(low, 'oak_logs'), 0);
    removePlayer(low);

    const noQuest = boilerPlayer(99);
    setQuest(noQuest, 0);
    give(noQuest, 'logs');
    useOnBoiler(noQuest, loc, 'logs');
    assert.equal(noQuest.getVarBit(ragBoiler), 0, 'the boiler must require the active quest');
    assert.equal(count(noQuest, 'logs'), 1, 'quest gating must preserve logs');
    removePlayer(noQuest);
  }

  // Every bone index survives the actual chemistry and boiler route; two players keep separate contents.
  {
    const loc = sharedBoiler ??= createBoiler();
    for (const bone of bones) {
      const p = boilerPlayer(99);
      give(p, 'rag_pot_vinegar');
      give(p, bone.raw);
      useItems(p, 'rag_pot_vinegar', bone.raw);
      give(p, 'logs');
      useOnBoiler(p, loc, 'logs');
      useOnBoiler(p, loc, bone.potted);
      give(p, 'tinderbox');
      useOnBoiler(p, loc, 'tinderbox');
      for (let tick = 0; tick < 20; tick++) tickPlayer(p);
      assert.equal(p.getVarBit(ragInvCheck), bone.index, `${bone.suffix} index changed in boiler`);
      assert.equal(clickBoiler(p, loc).accepted, true);
      assert.equal(count(p, bone.polished), 1, `${bone.suffix} polished identity changed`);
      assert.equal(count(p, 'pot_empty'), 1, `${bone.suffix} must return its pot`);
      removePlayer(p);
    }

    const first = boilerPlayer(99);
    const last = boilerPlayer(99);
    give(first, 'logs');
    give(last, 'logs');
    useOnBoiler(first, loc, 'logs');
    useOnBoiler(last, loc, 'logs');
    give(first, bones[0].potted);
    give(last, bones[7].potted);
    useOnBoiler(first, loc, bones[0].potted);
    useOnBoiler(last, loc, bones[7].potted);
    assert.equal(first.getVarBit(ragInvCheck), 1);
    assert.equal(last.getVarBit(ragInvCheck), 8);
    give(first, 'tinderbox');
    give(last, 'tinderbox');
    useOnBoiler(first, loc, 'tinderbox');
    useOnBoiler(last, loc, 'tinderbox');
    for (let tick = 0; tick < 20; tick++) {
      tickPlayer(first);
      tickPlayer(last);
    }
    assert.equal(first.getVarBit(ragBoiler), 4);
    assert.equal(last.getVarBit(ragBoiler), 4);
    clickBoiler(first, loc);
    assert.equal(count(first, bones[0].polished), 1);
    assert.equal(last.getVarBit(ragInvCheck), 8, 'one player removal must not alter the other player boiler');
    clickBoiler(last, loc);
    assert.equal(count(last, bones[7].polished), 1);
    removePlayer(first);
    removePlayer(last);
  }

  // Removal is blocked until all output slots exist; login finishes a logout-interrupted boil.
  {
    const loc = sharedBoiler ??= createBoiler();
    const p = boilerPlayer(99);
    p.setVarBit(ragBoiler, 2);
    p.setVarBit(ragInvCheck, 1);
    give(p, 'knife', configs.InvType.get(inv).size);
    const blockedPot = clickBoiler(p, loc);
    assert.equal(blockedPot.accepted, true);
    assert.equal(p.getVarBit(ragBoiler), 2, 'pot removal with no inventory slot must fail closed');
    p.invDel(inv, obj('knife'), 1);
    clickBoiler(p, loc);
    assert.equal(p.getVarBit(ragBoiler), 1, 'pot removal must succeed with one free slot');
    assert.equal(count(p, bones[0].potted), 1);
    removePlayer(p);

    const q = boilerPlayer(99);
    q.setVarBit(ragBoiler, 4);
    q.setVarBit(ragInvCheck, 1);
    give(q, 'knife', configs.InvType.get(inv).size - 1);
    const blockedBone = clickBoiler(q, loc);
    assert.equal(blockedBone.accepted, true);
    assert.equal(q.getVarBit(ragBoiler), 4, 'bone removal with only one free slot must fail closed');
    q.invDel(inv, obj('knife'), 1);
    clickBoiler(q, loc);
    assert.equal(q.getVarBit(ragBoiler), 0, 'bone removal must succeed with two free slots');
    assert.equal(count(q, bones[0].polished), 1);
    assert.equal(count(q, 'pot_empty'), 1);
    removePlayer(q);

    const interrupted = boilerPlayer(99);
    give(interrupted, 'logs');
    useOnBoiler(interrupted, loc, 'logs');
    give(interrupted, bones[3].potted);
    useOnBoiler(interrupted, loc, bones[3].potted);
    give(interrupted, 'tinderbox');
    useOnBoiler(interrupted, loc, 'tinderbox');
    assert.equal(interrupted.getVarBit(ragBoiler), 3);
    const saved = interrupted.save();
    assert.equal(PlayerLoading.verify(new Packet(saved)), true, 'interrupted boiler save must be valid');
    const restored = PlayerLoading.load(interrupted.username, new Packet(saved), null);
    assert(restored, 'interrupted boiler save must load');
    restored.slot = interrupted.slot;
    restored.pid = interrupted.pid;
    restored.uid = interrupted.uid;
    restored.isActive = true;
    restored.messages = [];
    restored.packets = [];
    restored.write = packet => restored.packets.push(packet);
    restored.messageGame = text => restored.messages.push(String(text));
    restored.wrappedMessageGame = text => restored.messages.push(String(text));
    World.players[restored.slot] = restored;
    assert.equal(restored.getVarBit(ragBoiler), 3, 'boiler state must persist through logout');
    assert.equal(restored.getVarBit(ragInvCheck), 4, 'boiling bone identity must persist through logout');
    runDirect(restored, '[login,_]');
    assert.equal(restored.getVarBit(ragBoiler), 4, 'login must complete a boil interrupted by logout');
    assert.equal(restored.getVarBit(ragInvCheck), 4);
    clickBoiler(restored, loc);
    assert.equal(count(restored, bones[3].polished), 1);
    assert.equal(count(restored, 'pot_empty'), 1);
    removePlayer(restored);
    if (World.players[interrupted.slot] === interrupted) World.players[interrupted.slot] = null;
    interrupted.unlink();
  }

  // Login refresh must color not-started, active, and complete quest rows using the shared contract.
  {
    const p = newPlayer();
    const red = readConstant('scripts/general/configs/colour.constant', 'red_rgb');
    const yellow = readConstant('scripts/general/configs/colour.constant', 'yellow_rgb');
    const green = readConstant('scripts/general/configs/colour.constant', 'green_rgb');
    for (const [stage, expected] of [[0, red], [1, yellow], [2, green]]) {
      setQuest(p, stage, stage === 2 ? 0xff : 0);
      p.packets.length = 0;
      runDirect(p, '[login,_]');
      const wireColour = ((expected >>> 19) << 10) | (((expected >>> 11) & 31) << 5) | ((expected >>> 3) & 31);
      assert.equal(rowColour(p), wireColour, `stage ${stage} quest row 15-bit wire colour`);
    }
    removePlayer(p);
  }


  // Real NPC death queue dispatch grants exactly the matching raw bone only while active and eligible.
  {
    for (const bone of bones) {
      const before = executeDeath(bone, 0);
      const active = executeDeath(bone, 1);
      const after = executeDeath(bone, 2);
      const rawId = obj(bone.raw);
      assert.equal(before.filter(drop => drop.id === rawId).length, 0, `${bone.suffix} must not drop before start`);
      assert.equal(active.filter(drop => drop.id === rawId).length, 1, `${bone.suffix} must drop once while active`);
      assert.equal(after.filter(drop => drop.id === rawId).length, 0, `${bone.suffix} must not drop after completion`);
      const ordinary = drops => drops.filter(drop => drop.id !== rawId);
      assert.deepEqual(ordinary(active), ordinary(before), `${bone.suffix} must preserve ordinary drops`);
      assert.deepEqual(ordinary(after), ordinary(before), `${bone.suffix} post-completion drops must remain ordinary`);

      for (const form of [bone.raw, bone.potted, bone.polished]) {
        for (const inventory of [inv, bank]) {
          const suppressed = executeDeath(bone, 1, { carried: [[form, inventory]] });
          assert.equal(suppressed.filter(drop => drop.id === rawId).length, 0,
            `${bone.suffix} drop must be suppressed by ${form} in ${inventory === inv ? 'inventory' : 'bank'}`);
        }
      }
      const wrongBone = bones[bone.index % bones.length];
      const unrelated = executeDeath(bone, 1, { carried: [[wrongBone.raw, inv]] });
      assert.equal(unrelated.filter(drop => drop.id === rawId).length, 1,
        `${bone.suffix} drop must not be suppressed by another bone`);
      const handed = executeDeath(bone, 1, { mask: 1 << (bone.index - 1) });
      assert.equal(handed.filter(drop => drop.id === rawId).length, 0, `${bone.suffix} hand-in bit must suppress its drop`);
      for (const state of [2, 3, 4]) {
        const boiling = executeDeath(bone, 1, { boiler: { state, index: bone.index } });
        assert.equal(boiling.filter(drop => drop.id === rawId).length, 0,
          `${bone.suffix} drop must be suppressed while its matching bone is in boiler state ${state}`);
      }
    }

    const monkey = bones.find(bone => bone.suffix === 'monkey');
    const started = readConstant('scripts/quests/quest_tbwt/configs/quest_tbwt.constant', 'tbwt_started');
    const monkeyWithOnlyTrio = executeDeath(monkey, 0, { tbwtStarted: started });
    const monkeyWithBothQuests = executeDeath(monkey, 1, { tbwtStarted: started });
    const monkeyRawId = obj(monkey.raw);
    assert.equal(monkeyWithBothQuests.filter(drop => drop.id === monkeyRawId).length, 1,
      'active Tai Bwo Wannai Trio must co-occur with the Rag and Bone Man monkey drop');
    assert.equal(monkeyWithBothQuests.filter(drop => drop.id === obj('tbwt_monkey_corpse')).length, 1,
      'active Tai Bwo Wannai Trio must still drop its monkey corpse');
    assert.deepEqual(monkeyWithBothQuests.filter(drop => drop.id !== monkeyRawId), monkeyWithOnlyTrio,
      'Rag and Bone Man must preserve the same active Tai Bwo Wannai Trio death branch');
  }

  // Execute every complete eight-bone hand-in order, without resetting progress between its steps.
  {
    function* permutations(order = [], mask = 0) {
      if (mask === 0xff) {
        yield order;
        return;
      }
      for (const bone of bones) {
        const bit = 1 << (bone.index - 1);
        if (mask & bit) continue;
        order.push(bone);
        yield* permutations(order, mask | bit);
        order.pop();
      }
    }
    const p = newPlayer();
    const oldMan = spawnNpc(p, 'rag_odd_old_man');
    const high = 0x5a5a0000;
    const qp = id('VarPlayerType', 'qp');
    const edges = new Set();
    let orders = 0;
    let handIns = 0;
    for (const order of permutations()) {
      setQuest(p, 1, 0, high);
      p.setVar(qp, 0);
      p.stats[cooking] = 123456;
      p.stats[prayer] = 123456;
      let mask = 0;
      for (const bone of order) {
        edges.add(`${mask}:${bone.index}`);
        p.packets.length = 0;
        p.messages.length = 0;
        give(p, bone.polished);
        const cookingBefore = p.stats[cooking];
        const prayerBefore = p.stats[prayer];
        const state = clickNpc(p, oldMan, 1);
        assert.equal(dispatchedNames.get(state), '[opnpc1,rag_odd_old_man]');
        mask |= 1 << (bone.index - 1);
        handIns++;
        assert.equal(count(p, bone.polished), 0, 'hand-in must consume its polished bone');
        assert.equal(handedMask(p), mask, 'hand-in must preserve previous bits and set only its own');
        assert.equal(p.getVar(ragQuest) & 0xfffffc00, high, 'hand-in must preserve unrelated high bits');
        if (mask === 0xff) {
          assert.equal(questStage(p), 2, 'last hand-in must complete the quest');
          assert.equal(p.stats[cooking] - cookingBefore, 5000 * Environment.NODE_XPRATE, 'completion must award 500 Cooking XP');
          assert.equal(p.stats[prayer] - prayerBefore, 5000 * Environment.NODE_XPRATE, 'completion must award 500 Prayer XP');
          assert.equal(p.getVar(qp), 1, 'completion must award one quest point exactly once');
          assert.equal(p.modalMain, component('questscroll_death'), 'completion must show the generic reward scroll');
          const rewardText = p.packets.map(packet => packet.text ?? '').join('\n');
          assert(rewardText.includes('500 Cooking XP') && rewardText.includes('500 Prayer XP'),
            'reward scroll must list the two skill rewards');
          p.closeModal();
          const xpAfter = [p.stats[cooking], p.stats[prayer], p.getVar(qp)];
          const repeat = clickNpc(p, oldMan, 1);
          assert.equal(dispatchedNames.get(repeat), '[opnpc1,rag_odd_old_man]');
          assert.deepEqual([p.stats[cooking], p.stats[prayer], p.getVar(qp)], xpAfter,
            'repeating completed dialogue must not award rewards again');
        } else {
          assert.equal(questStage(p), 1, 'partial hand-in must keep the quest active');
          assert.equal(p.stats[cooking], cookingBefore, 'partial hand-in must not award Cooking XP');
          assert.equal(p.stats[prayer], prayerBefore, 'partial hand-in must not award Prayer XP');
          assert.equal(p.getVar(qp), 0, 'partial hand-in must not award quest points');
        }
      }
      orders++;
    }
    assert.equal(orders, 40320, 'the test must execute every eight-bone hand-in order');
    assert.equal(handIns, 322560, 'every order must execute all eight hand-ins');
    assert.equal(edges.size, 1024, 'every prefix/action state edge must be executed');
    removePlayer(p);
    console.log(`RAG_HAND_INS orders=${orders} actions=${handIns} uniqueEdges=${edges.size}`);
  }

  console.log('PASS Rag and Bone Man compiled proof: packet dispatch, every hand-in order, boiler and death cases');
  process.exit(0);
}

await main();
