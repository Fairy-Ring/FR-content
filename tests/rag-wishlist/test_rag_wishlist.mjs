#!/usr/bin/env node
/** Compiled Rag and Bone Man wish-list proof. Uses packed dispatch, maps and configs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const OpNpcU = (await load('network/game/client/model/OpNpcU.ts')).default;
const OpLoc = (await load('network/game/client/model/OpLoc.ts')).default;
const OpLocU = (await load('network/game/client/model/OpLocU.ts')).default;
const OpHeld = (await load('network/game/client/model/OpHeld.ts')).default;
const OpHeldU = (await load('network/game/client/model/OpHeldU.ts')).default;
const InvButton = (await load('network/game/client/model/InvButton.ts')).default;
const IfButton = (await load('network/game/client/model/IfButton.ts')).default;
const ResumePauseButton = (await load('network/game/client/model/ResumePauseButton.ts')).default;
const OpNpcHandler = (await load('network/game/client/handler/OpNpcHandler.ts')).default;
const OpNpcUHandler = (await load('network/game/client/handler/OpNpcUHandler.ts')).default;
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
console.log(`RAG_WISHLIST_PACK ${requestedPack === path.join(engineRoot, 'data/pack') ? 'default' : 'alternate'}`);

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
const ragWishlist = id('VarPlayerType', 'rag_wishlist');
const ragBoiler = id('VarBitType', 'rag_boiler');
const ragInvCheck = id('VarBitType', 'rag_inv_check');
const tutorial = id('VarPlayerType', 'tutorial');
const qp = id('VarPlayerType', 'qp');
const firemaking = PlayerStat.FIREMAKING;
const cooking = PlayerStat.COOKING;
const prayer = PlayerStat.PRAYER;
const WISHLIST_MASK = (1 << 27) - 1;
const FULL_WISHLIST_MASK = WISHLIST_MASK;
const WISHLIST_TAG = 1 << 29;

// The added saved state must reuse the original server-only slot, not grow client config.
assert.equal(ragWishlist, 421, 'wish-list progress must use original varp slot 421');
assert.equal(configs.VarPlayerType.get(ragWishlist).transmit, false, 'wish-list varp must remain server-only');
const clientConfigHash = createHash('sha256')
  .update(fs.readFileSync(path.join(packDir, 'client/config')))
  .digest('hex');
assert.equal(clientConfigHash, 'b6ec704421650ee5527e77c635b8b3a8036f6eb042c572516ac0696cfbce19a8',
  'adding the wish-list must leave published client/config bytes unchanged');

const wishBones = [
  { index: 1, suffix: 'wolf', npc: 'wolf' },
  { index: 2, suffix: 'bat', npc: 'small_bat' },
  { index: 3, suffix: 'rat', npc: 'rat' },
  { index: 4, suffix: 'baby_blue_dragon', npc: 'babybluedragon' },
  { index: 5, suffix: 'ogre', npc: 'ogre' },
  { index: 6, suffix: 'jogre', npc: 'jogre' },
  { index: 7, suffix: 'zogre', npc: 'zogre_1' },
  { index: 8, suffix: 'mogre', npc: 'mudskipper_ogre' },
  { index: 9, suffix: 'dagganoth', category: 'dagganoth' },
  { index: 10, suffix: 'snake', npc: 'snake' },
  { index: 11, suffix: 'zombie', npc: 'zombie_unarmed' },
  { index: 12, suffix: 'werewolf', category: 'werewolf' },
  { index: 13, suffix: 'moss_giant', npc: 'mossgiant' },
  { index: 14, suffix: 'fire_giant', npc: 'firegiant' },
  { index: 15, suffix: 'ice_giant', npc: 'icegiant' },
  { index: 16, suffix: 'terrorbird', npc: 'terrorbird' },
  { index: 17, suffix: 'ghoul', npc: 'ghoul' },
  { index: 18, suffix: 'troll', category: 'mountain_troll' },
  { index: 19, suffix: 'seagull', npc: 'sarim_seagull_pier' },
  { index: 20, suffix: 'undead_cow', npc: 'ahoy_undead_cow' },
  { index: 21, suffix: 'experiment', npc: 'fenk_experiment_1' },
  { index: 22, suffix: 'rabbit', category: 'rabbit' },
  { index: 23, suffix: 'baby_basilisk', category: 'slayer_basilisk' },
  { index: 24, suffix: 'desert_lizard', npc: 'slayer_lizard_massive' },
  { index: 25, suffix: 'cave_goblin', npc: 'cave_goblin' },
  { index: 26, suffix: 'vulture', npc: 'rag_vulture' },
  { index: 27, suffix: 'jackal', npc: 'ics_little_jackal' }
].map(bone => ({
  ...bone,
  genericIndex: bone.index + 8,
  raw: `rag_${bone.suffix}_bone`,
  potted: `rag_pot_${bone.suffix}_bone`,
  polished: `rag_polished_${bone.suffix}_bone`
}));
assert.equal(wishBones.length, 27, 'the compiled wish-list must contain exactly 27 entries');
for (const bone of wishBones) {
  for (const item of [bone.raw, bone.potted, bone.polished]) {
    const type = configs.ObjType.get(obj(item));
    assert.equal(type.tradeable, false, `${item} must be untradeable`);
  }
  if (bone.category) id('CategoryType', bone.category);
}
for (const reward of ['rag_bonesack', 'rag_ram_helm']) {
  assert.equal(configs.ObjType.get(obj(reward)).tradeable, false, `${reward} must be untradeable`);
}

World.currentTick = Math.max(World.currentTick, 100);
World.gameMap.init();
let nextPlayer = 0;
let sharedBoiler;
let boilerApproach;
const npcHandler = new OpNpcHandler();
const npcUseHandler = new OpNpcUHandler();
const locHandler = new OpLocHandler();
const locUseHandler = new OpLocUHandler();
const heldHandler = new OpHeldHandler();
const heldUseHandler = new OpHeldUHandler();
const ifButtonHandler = new IfButtonHandler();
const resumeHandler = new ResumePauseButtonHandler();
const invButtonHandler = new InvButtonHandler();

function newPlayer() {
  const serial = ++nextPlayer;
  const username37 = BigInt(10000 + serial);
  const hash64 = BigInt(1000000 + serial);
  const p = new Player(`ragwish${serial}`, username37, hash64);
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
  for (const inventory of [inv, bank, worn]) p.getInventory(inventory);
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

function restorePlayer(p) {
  const saved = p.save();
  assert.equal(PlayerLoading.verify(new Packet(saved)), true, 'saved player state must be valid');
  const restored = PlayerLoading.load(p.username, new Packet(saved), null);
  assert(restored, 'saved player state must load');
  restored.slot = p.slot;
  restored.pid = p.pid;
  restored.uid = ((Number(restored.username37 & 0x1fffffn) << 11) | restored.slot) >>> 0;
  restored.isActive = true;
  restored.messages = [];
  restored.packets = [];
  restored.write = packet => restored.packets.push(packet);
  restored.messageGame = text => restored.messages.push(String(text));
  restored.wrappedMessageGame = text => restored.messages.push(String(text));
  World.players[restored.slot] = restored;
  p.unlink();
  World.playerLoop.add(restored.hash64, restored);
  return restored;
}

function give(p, name, amount = 1, inventory = inv) {
  assert.equal(p.invAdd(inventory, obj(name), amount), amount, `could not add ${amount} ${name}`);
}

function count(p, name, inventory = inv) {
  return p.invTotal(inventory, obj(name));
}

function ownedCount(p, name) {
  return [inv, bank, worn].reduce((total, inventory) => total + count(p, name, inventory), 0);
}

function setPart1(p, stage, mask = stage === 2 ? 0xff : 0, high = 0x5a5a0000) {
  p.setVar(ragQuest, (high & 0xfffffc00) | ((mask & 0xff) << 2) | stage);
}

function part1Stage(p) {
  return p.getVar(ragQuest) & 3;
}

function part1Mask(p) {
  return (p.getVar(ragQuest) >>> 2) & 0xff;
}

function setWish(p, state, mask = 0, tagged = false) {
  p.setVar(ragWishlist, (mask & FULL_WISHLIST_MASK) | ((state & 3) << 27) | (tagged ? WISHLIST_TAG : 0));
}

function wishState(p) {
  return (p.getVar(ragWishlist) >>> 27) & 3;
}

function wishMask(p) {
  return p.getVar(ragWishlist) & FULL_WISHLIST_MASK;
}

function wishTagged(p) {
  return (p.getVar(ragWishlist) & WISHLIST_TAG) !== 0;
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

function modalRoot(p) {
  return p.modalChat >= 0 ? configs.Component.get(p.modalChat)?.comName : undefined;
}

function resumeDialogue(p, choices) {
  assert.equal(p.activeScript?.execution, ScriptState.PAUSEBUTTON, 'dialogue must be waiting for a button');
  const root = modalRoot(p);
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
  for (let step = 0; state.execution !== ScriptState.FINISHED && step < 500; step++) {
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

function beginNpc(p, npc, option = 1) {
  const observed = captureScripts(p, () => {
    assert.equal(npcHandler.handle(new OpNpc(option, npc.nid), p), true, `NPC option ${option} rejected`);
    p.processInteraction();
  });
  const state = observed.states.at(-1);
  assert(state, `NPC option ${option} did not dispatch a compiled script`);
  return state;
}

function clickNpc(p, npc, option = 1, choices = []) {
  return finishDialogue(p, beginNpc(p, npc, option), choices);
}

function advanceToChoice(p, state) {
  for (let step = 0; step < 500; step++) {
    if (state.execution === ScriptState.PAUSEBUTTON) {
      if (/^multi[2-5]$/.test(modalRoot(p) ?? '')) return state;
      p.activeScript = state;
      resumeDialogue(p, []);
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else {
      assert.fail(`final choice was not reached in ${state.script.name}`);
    }
  }
  assert.fail(`dialogue did not reach a choice: ${state.script.name}`);
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

function boilerPlayer() {
  const p = newPlayer();
  setPart1(p, 2);
  setWish(p, 1);
  p.setLevel(firemaking, 99);
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

function npcFor(bone) {
  if (bone.npc) {
    const type = configs.NpcType.getByName(bone.npc);
    assert(type, `${bone.suffix} mapped NPC type must be packed: ${bone.npc}`);
    return type;
  }
  const category = id('CategoryType', bone.category);
  const type = configs.NpcType.configs.find(candidate => candidate?.category === category && candidate.name);
  assert(type, `${bone.suffix} mapped category must contain a packed NPC: ${bone.category}`);
  return type;
}

function executeDeath(bone, options = {}) {
  const p = newPlayer();
  setPart1(p, options.part1Stage ?? 2, options.part1Mask ?? 0xff);
  setWish(p, options.wishlistState ?? 1, options.mask ?? 0, options.tagged ?? false);
  for (const [item, inventory] of options.carried ?? []) give(p, item, 1, inventory);
  if (options.lose) {
    const [item, inventory] = options.lose;
    assert.equal(p.invDel(inventory, obj(item), 1), 1, `could not remove lost ${item}`);
  }
  if (options.boiler) {
    p.setVarBit(ragBoiler, options.boiler.state);
    p.setVarBit(ragInvCheck, options.boiler.index);
  }

  const type = npcFor(bone);
  const npc = new Npc(0, p.x + 1, p.z, type.size, type.size,
    EntityLifeCycle.RESPAWN, World.npcs.next(), type.id, type.blockwalk);
  World.addNpc(npc, -1);
  const spawn = ScriptProvider.getByTrigger(ServerTriggerType.AI_SPAWN, type.id, type.category);
  if (spawn) {
    const spawnState = ScriptRunner.init(spawn, npc);
    npc.executeScript(spawnState);
    assert.equal(spawnState.execution, ScriptState.FINISHED, `spawn script failed for ${type.name}`);
  }
  npc.lastMovement = -100;
  if (options.hero !== false) {
    npc.setVar(id('VarNpcType', 'npc_aggressive_player'), p.uid);
    npc.heroPoints.addHero(p.hash64, 8);
  }
  const trigger = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, type.id, type.category);
  assert(trigger, `death trigger missing for ${type.name}`);
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
    JavaRandom.setSeed(options.seed ?? 0x52414700 + bone.index);
    npc.applyDamage(npc.levels[NpcStat.HITPOINTS], 1);
    npc.executeScript(state);
    if (bone.suffix === 'desert_lizard') {
      // Zero HP only revives this species; the real icy-water packet queues its final death.
      assert.equal(deleteCalls, 0, 'a lizard must survive ordinary lethal damage until finished');
      assert.equal(npc.levels[NpcStat.HITPOINTS], 1, 'the zero-HP route must revive the lizard');
      rsbuf.computeNpc(npc.x, npc.level, npc.z, npc.nid, npc.type, npc.tele, npc.jump,
        npc.runDir, npc.walkDir, npc.isActive, npc.masks, npc.faceEntity, npc.faceSquareX,
        npc.faceSquareZ, npc.faceAngleX, npc.faceAngleZ, npc.hitmarkDamage, npc.hitmarkType,
        npc.hitmark2Damage, npc.hitmark2Type, npc.levels[NpcStat.HITPOINTS],
        npc.baseLevels[NpcStat.HITPOINTS], npc.animId, npc.animDelay, npc.sayMessage,
        npc.spotanimId, npc.spotanimHeight, npc.spotanimTime);
      rsbuf.npcInfo(0, p.slot, 0, 0, true);
      give(p, 'slayer_icy_water');
      const slot = p.getInventory(inv).getItemIndex(obj('slayer_icy_water'));
      const finish = captureScripts(p, () => {
        assert.equal(npcUseHandler.handle(new OpNpcU(npc.nid, obj('slayer_icy_water'), slot, invCom), p), true,
          'the visible weak lizard must accept its icy-water finisher');
        p.processInteraction();
      });
      assert.equal(dispatchedNames.get(finish.states.at(-1)), '[opnpcu,_slayer_lizard]');
      assert.equal(count(p, 'slayer_icy_water'), 0, 'the finisher must consume one icy-water item');
      for (let tick = 0; npc.isActive && tick < 20; tick++) {
        World.currentTick++;
        npc.turn();
        if (World.players[p.slot] === p) p.processQueues();
      }
    }
    for (let tick = 0; state.execution === ScriptState.NPC_SUSPENDED && tick < 20; tick++) {
      if (World.players[p.slot] === p) p.processQueues();
      World.currentTick = Math.max(World.currentTick + 1, npc.delayedUntil);
      npc.delayed = false;
      npc.executeScript(state);
    }
    if (World.players[p.slot] === p) p.processQueues();
    assert.equal(state.execution, ScriptState.FINISHED, `death script failed for ${type.name}`);
    assert.equal(deleteCalls, 1, `death script must delete ${type.name} once`);
    assert.equal(npc.isActive, false, `dead NPC ${type.name} remains active`);
    World.currentTick++;
    npc.turn();
    assert.equal(deleteCalls, 1, `NPC ${type.name} deleted more than once`);
    const rawId = obj(bone.raw);
    const rawDrops = drops.filter(drop => drop.id === rawId);
    assert(rawDrops.length <= 1, `${bone.suffix} death must not duplicate its wish-list bone`);
    for (const rawDrop of rawDrops) {
      assert.equal(rawDrop.receiver, p.hash64.toString(), `${bone.suffix} bone must be private to its hero`);
    }
    return { drops, rawDrops: rawDrops.length, npc: type.name };
  } finally {
    World.addObj = originalAddObj;
    ScriptRunner.HANDLERS[ScriptOpcode.NPC_DEL] = originalDelete;
    removePlayer(p);
  }
}

function expectedMask(items) {
  return items.reduce((mask, bone) => mask | (1 << (bone.index - 1)), 0);
}

function beginWishlist(p, oldMan) {
  const before = p.getVar(ragQuest);
  const state = clickNpc(p, oldMan, 1);
  assert.equal(dispatchedNames.get(state), '[opnpc1,rag_odd_old_man]');
  assert.equal(wishState(p), 1, 'first post-Part-1 talk must start the wish-list');
  assert.equal(wishMask(p), 0, 'starting the wish-list must not mark a bone handed in');
  assert.equal(p.getVar(ragQuest), before, 'starting N622 must leave Part 1 state unchanged');
}

function rewardSnapshot(p) {
  return { prayer: p.stats[prayer], cooking: p.stats[cooking], qp: p.getVar(qp) };
}

function assertNoReward(p, before, label) {
  assert.equal(p.stats[prayer], before.prayer, `${label} must not award Prayer XP`);
  assert.equal(p.stats[cooking], before.cooking, `${label} must not award Cooking XP`);
  assert.equal(p.getVar(qp), before.qp, `${label} must not award a quest point`);
}

function assertReward(p, reward, before, part1Value) {
  assert.equal(wishState(p), 2, 'claiming the choice must atomically mark N622 rewarded');
  assert.equal(wishMask(p), FULL_WISHLIST_MASK, 'rewarded state must retain all 27 handed-in flags');
  assert.equal(part1Stage(p), 2, 'wish-list completion must preserve Part 1 completion');
  assert.equal(part1Mask(p), 0xff, 'wish-list completion must preserve all eight Part 1 flags');
  assert.equal(p.getVar(ragQuest), part1Value, 'wish-list reward must not rewrite the Part 1 varp');
  assert.equal(p.stats[prayer] - before.prayer, 50000 * Environment.NODE_XPRATE,
    'N622 must award 5,000 Prayer XP (50,000 tenths at xprate 1)');
  assert.equal(p.stats[cooking], before.cooking, 'N622 must not award Cooking XP');
  assert.equal(p.getVar(qp), before.qp + 1, 'N622 must award exactly one quest point');
  assert.equal(count(p, reward), 1, `chosen ${reward} must be awarded once`);
  const other = reward === 'rag_bonesack' ? 'rag_ram_helm' : 'rag_bonesack';
  assert.equal(ownedCount(p, other), 0, `unchosen ${other} must not be awarded`);
  assert.equal(p.modalMain, component('questscroll_death'), 'N622 must show its completion reward scroll');
  const scrollText = p.packets.map(packet => packet.text ?? '').join('\n');
  assert(scrollText.includes('5,000 Prayer XP'), 'completion scroll must list the Prayer reward');
}

function handInBatches(p, npc, order) {
  const part1Value = p.getVar(ragQuest);
  const before = rewardSnapshot(p);
  let mask = 0;
  const batchEnds = [9, 18, 26];
  let start = 0;
  for (const end of batchEnds) {
    const batch = order.slice(start, end);
    for (const bone of batch) give(p, bone.polished);
    const state = clickNpc(p, npc, 1);
    assert.equal(dispatchedNames.get(state), '[opnpc1,rag_odd_old_man]');
    mask |= expectedMask(batch);
    assert.equal(wishMask(p), mask, `batch ending at ${end} must hand in only its supplied bones`);
    assert.equal(wishState(p), 1, 'partial batches must leave the wish-list active');
    assert.equal(part1Stage(p), 2, 'partial wish-list hand-in must not change Part 1');
    assert.equal(p.getVar(ragQuest), part1Value, 'wish-list hand-in must not write the Part 1 varp');
    for (const bone of batch) assert.equal(count(p, bone.polished), 0, `${bone.suffix} must be consumed`);
    assertNoReward(p, before, `partial batch ${end}`);
    start = end;
  }
  return { mask, part1Value, before, next: start };
}

function completeWishlist(choice, interruptFinalChoice) {
  const p0 = newPlayer();
  setPart1(p0, 2);
  p0.setVar(qp, 1);
  const oldMan0 = spawnNpc(p0, 'rag_odd_old_man');
  beginWishlist(p0, oldMan0);
  const order = Array.from({ length: 27 }, (_, index) => wishBones[(index * 11) % 27]);
  const progress = handInBatches(p0, oldMan0, order);
  assert.equal(progress.next, 26);
  assert.equal(progress.mask, FULL_WISHLIST_MASK ^ (1 << (order[26].index - 1)),
    'the first three batches must leave only the final arbitrary bone outstanding');
  const finalBone = order[26];
  give(p0, finalBone.polished);

  let p = p0;
  let oldMan = oldMan0;
  if (interruptFinalChoice) {
    const state = beginNpc(p, oldMan, 1);
    advanceToChoice(p, state);
    assert.equal(wishMask(p), FULL_WISHLIST_MASK, 'the final flag must be saved before the choice dialogue');
    assert.equal(wishState(p), 1, 'the final unchosen selection must remain recoverable');
    assert.equal(count(p, finalBone.polished), 0, 'the final polished bone must be consumed before the reward choice');
    assertNoReward(p, progress.before, 'interrupted reward choice');
    const interrupted = p;
    p = restorePlayer(interrupted);
    assert.equal(wishMask(p), FULL_WISHLIST_MASK, 'all 27 flags must survive save/load before reward choice');
    assert.equal(wishState(p), 1, 'an unchosen reward must survive save/load as claimable');
    assert.equal(p.getVar(ragQuest), progress.part1Value, 'save/load must preserve Part 1 unchanged');
    // Quest points are derived temporary state, recomputed by the real login script.
    runDirect(p, '[login,_]');
    assertNoReward(p, progress.before, 'saved interrupted choice');
    oldMan = spawnNpc(p, 'rag_odd_old_man');
  }

  const finalState = clickNpc(p, oldMan, 1, [choice]);
  assert.equal(dispatchedNames.get(finalState), '[opnpc1,rag_odd_old_man]');
  assert.equal(wishMask(p), FULL_WISHLIST_MASK, 'final reward must retain every hand-in flag');
  assertReward(p, choice === 1 ? 'rag_bonesack' : 'rag_ram_helm', progress.before, progress.part1Value);
  return { p, oldMan, part1Value: progress.part1Value, before: progress.before };
}

async function main() {
  // Part 1 remains the gate; the old Rag test stays registered separately and unchanged.
  {
    const p = newPlayer();
    const oldMan = spawnNpc(p, 'rag_odd_old_man');
    setPart1(p, 0, 0);
    clickNpc(p, oldMan, 1, [2]);
    assert.equal(wishState(p), 0, 'declining Part 1 must not start N622');
    setPart1(p, 1, 0);
    const questValue = p.getVar(ragQuest);
    clickNpc(p, oldMan, 1);
    assert.equal(part1Stage(p), 1, 'Odd Old Man must retain the active Part 1 hand-in route');
    assert.equal(wishState(p), 0, 'N622 must remain unavailable before Part 1 completion');
    assert.equal(p.getVar(ragQuest), questValue, 'a progress check must not change Part 1');
    setPart1(p, 2);
    const completeValue = p.getVar(ragQuest);
    beginWishlist(p, oldMan);
    assert.equal(p.getVar(ragQuest), completeValue, 'starting N622 must leave completed Part 1 untouched');
    removePlayer(p);
  }

  // Every cached mapping is exercised through its real packed AI_QUEUE3 death route.
  // Fixed-seed sampling proves the CANDIDATE one-in-four drop is neither guaranteed nor absent.
  {
    let totalHits = 0;
    const hitSeeds = new Map();
    const trialsPerBone = 32;
    for (const bone of wishBones) {
      const mappedNpc = npcFor(bone);
      const trigger = ScriptProvider.getByTrigger(ServerTriggerType.AI_QUEUE3, mappedNpc.id, mappedNpc.category);
      assert(trigger, `${bone.suffix} must have a packed death-dispatch route`);
      let hits = 0;
      let firstHitSeed;
      for (let trial = 1; trial <= trialsPerBone; trial++) {
        const seed = Math.imul(trial, 0x9e3779b9) >>> 0;
        const death = executeDeath(bone, { seed });
        hits += death.rawDrops;
        if (death.rawDrops && firstHitSeed === undefined) firstHitSeed = seed;
      }
      assert(hits > 0 && hits < trialsPerBone, `${bone.suffix} must use its random drop chance, not guarantee/omit the bone`);
      hitSeeds.set(bone.index, firstHitSeed);
      totalHits += hits;
      console.log(`RAG_WISHLIST_DROP ${bone.index} ${bone.suffix} npc=${mappedNpc.name} hits=${hits}/${trialsPerBone}`);
    }
    assert(totalHits >= 150 && totalHits <= 280,
      `fixed-seed combined drops must remain consistent with the CANDIDATE 1/4 rate, got ${totalHits}/${wishBones.length * trialsPerBone}`);

    for (const bone of wishBones) {
      const seed = hitSeeds.get(bone.index);
      const rawId = obj(bone.raw);
      const noDrop = (options, label) => {
        const result = executeDeath(bone, { ...options, seed });
        assert.equal(result.rawDrops, 0, `${bone.suffix} must not drop when ${label}`);
      };
      noDrop({ wishlistState: 0 }, 'the wish-list is not started');
      noDrop({ part1Stage: 1, wishlistState: 1 }, 'Part 1 is still active');
      noDrop({ wishlistState: 2 }, 'the wish-list is already rewarded');
      noDrop({ mask: 1 << (bone.index - 1) }, 'its own hand-in flag is set');
      noDrop({ hero: false }, 'there is no credited hero');

      for (const form of [bone.raw, bone.potted, bone.polished]) {
        for (const inventory of [inv, bank, worn]) {
          noDrop({ carried: [[form, inventory]] }, `${form} is owned in ${inventory === inv ? 'inventory' : inventory === bank ? 'bank' : 'worn'}`);
        }
      }

      for (const state of [2, 3, 4]) {
        noDrop({ tagged: true, boiler: { state, index: bone.index } }, `its tagged wish-list bone is in boiler state ${state}`);
      }
      const other = wishBones[bone.index % wishBones.length];
      const unrelated = executeDeath(bone, { carried: [[other.raw, inv]], seed });
      assert.equal(unrelated.rawDrops, 1, `${bone.suffix} must not be suppressed by ${other.suffix}`);

      const lostAndRecovered = executeDeath(bone, {
        carried: [[bone.raw, inv]], lose: [bone.raw, inv], seed
      });
      assert.equal(lostAndRecovered.rawDrops, 1, `${bone.suffix} must be reacquirable after its copy is lost`);
    }

    // A legacy Part-1 boiler index with the same low value is not a tagged N622 bone.
    const untagged = executeDeath(wishBones[0], { boiler: { state: 4, index: 1 }, seed: hitSeeds.get(1) });
    assert.equal(untagged.rawDrops, 1, 'Part-1 boiler identity must not suppress a wish-list bone with the same low index');
  }

  // All 27 identity maps survive vinegar preparation, emptying, boiler states and output.
  {
    const loc = sharedBoiler ??= createBoiler();
    for (const bone of wishBones) {
      let p = boilerPlayer();
      const originalPart1 = p.getVar(ragQuest);
      const originalWish = p.getVar(ragWishlist);
      give(p, 'rag_pot_vinegar');
      give(p, bone.raw);
      let state = useItems(p, 'rag_pot_vinegar', bone.raw);
      assert.equal(dispatchedNames.get(state), '[opheldu,rag_pot_vinegar]');
      assert.equal(count(p, bone.raw), 0, `${bone.suffix} raw bone must be consumed by vinegar`);
      assert.equal(count(p, bone.potted), 1, `${bone.suffix} must retain its identity in vinegar`);
      assert.equal(count(p, 'rag_pot_vinegar'), 0);
      assert.equal(p.getVar(ragQuest), originalPart1, 'potting must not change Part 1 state');
      assert.equal(p.getVar(ragWishlist), originalWish, 'potting must not mark N622 progress');

      state = useItemOption(p, bone.potted, 4);
      assert.equal(dispatchedNames.get(state), `[opheld4,${bone.potted}]`);
      assert.equal(count(p, bone.potted), 0, 'emptying destroys the bone-in-pot item');
      assert.equal(count(p, 'pot_empty'), 1, 'emptying returns one pot');

      // The test fixture reacquires the deliberately emptied bone before the boiler route.
      give(p, 'rag_pot_vinegar');
      give(p, bone.raw);
      useItems(p, 'rag_pot_vinegar', bone.raw);
      give(p, 'logs');
      state = useOnBoiler(p, loc, 'logs');
      assert.equal(dispatchedNames.get(state), '[oplocu,rag_potboiler_nologs]');
      assert.equal(p.getVarBit(ragBoiler), 1, 'logs must enter boiler state 1');
      state = useOnBoiler(p, loc, bone.potted);
      assert.equal(dispatchedNames.get(state), '[oplocu,rag_potboiler_nopot]');
      assert.equal(p.getVarBit(ragBoiler), 2, 'potted bone must enter boiler state 2');
      assert.equal(p.getVarBit(ragInvCheck), bone.index, `${bone.suffix} wish identity must use its 1..27 tagged index`);
      assert.equal(wishTagged(p), true, `${bone.suffix} identity must be tagged separately from Part 1`);
      assert.equal(count(p, bone.potted), 0, 'placing the bone must consume the potted bone');
      give(p, 'tinderbox');
      state = useOnBoiler(p, loc, 'tinderbox');
      assert.equal(dispatchedNames.get(state), '[oplocu,rag_potboiler_with_pot]');
      assert.equal(p.getVarBit(ragBoiler), 3, 'lighting must enter boiler state 3');
      assert.equal(p.getVarBit(ragInvCheck), bone.index, 'the tagged identity must survive lighting');

      const beforeRelog = p;
      if (bone.index === 27) {
        const saved = p.save();
        assert.equal(PlayerLoading.verify(new Packet(saved)), true, 'generic index 35 boiler save must be valid');
        p = restorePlayer(p);
        assert.equal(p.getVarBit(ragBoiler), 3, 'generic index 35 boiler state must persist through logout');
        assert.equal(p.getVarBit(ragInvCheck), 27, 'tagged generic index 35 must retain wishlist index 27');
        assert.equal(wishTagged(p), true, 'wishlist identity tag must persist across save/load');
        assert.equal(p.getVar(ragWishlist), originalWish | WISHLIST_TAG,
          'save/load must preserve the tagged index-35 identity without changing wish-list progress');
        runDirect(p, '[login,_]');
        assert.equal(p.getVarBit(ragBoiler), 4, 'login must complete the interrupted generic index 35 boil');
      } else {
        for (let tick = 0; tick < 19; tick++) tickPlayer(p);
        assert.equal(p.getVarBit(ragBoiler), 3, 'the bone must not boil before 20 ticks');
        tickPlayer(p);
        assert.equal(p.getVarBit(ragBoiler), 4, 'the bone must boil on the 20th tick');
      }
      assert.equal(p.getVarBit(ragInvCheck), bone.index, 'boiling must retain the wish-list identity');
      assert.equal(wishTagged(p), true, 'boiling must retain the identity tag until removal');
      assert.equal(clickBoiler(p, loc).accepted, true, 'boiled pot must expose Remove-Bone');
      assert.equal(count(p, bone.polished), 1, `${bone.suffix} must emerge as its matching polished bone`);
      assert.equal(count(p, 'pot_empty'), 2, 'boiling must return a pot in addition to the earlier emptying pot');
      assert.equal(p.getVarBit(ragBoiler), 0, 'removing the bone must reset the boiler');
      assert.equal(p.getVarBit(ragInvCheck), 0, 'removing the bone must clear its saved index');
      assert.equal(wishTagged(p), false, 'removing the bone must clear the wish-list identity tag');
      assert.equal(p.getVar(ragQuest), originalPart1, 'boiler operations must not alter Part 1 state');
      removePlayer(p);
      if (p !== beforeRelog && World.players[beforeRelog.slot] === beforeRelog) {
        World.players[beforeRelog.slot] = null;
        beforeRelog.unlink();
      }
    }
  }

  // Hand-in accepts arbitrary order and batches; reward choice is once-only and resumable.
  {
    const interrupted = completeWishlist(1, true);
    const p = interrupted.p;
    let noRewardBefore = rewardSnapshot(p);
    p.closeModal();
    const repeated = clickNpc(p, interrupted.oldMan, 1, [3]);
    assert.equal(dispatchedNames.get(repeated), '[opnpc1,rag_odd_old_man]');
    assertNoReward(p, noRewardBefore, 'repeated rewarded dialogue');
    assert.equal(wishState(p), 2, 'repeated talk must keep the reward-claimed state');
    assert.equal(ownedCount(p, 'rag_bonesack'), 1, 'repeated talk must not award a second Bonesack');

    p.closeModal();
    useItemOption(p, 'rag_bonesack', 2);
    assert.equal(count(p, 'rag_bonesack'), 0, 'wearing the Bonesack must remove it from inventory');
    assert.equal(count(p, 'rag_bonesack', worn), 1, 'Bonesack must equip in the worn inventory');
    clickNpc(p, interrupted.oldMan, 1, [2]);
    assert.equal(count(p, 'rag_bonesack', worn), 1, 'a worn old reward must not be silently duplicated or exchanged');
    assert.equal(ownedCount(p, 'rag_ram_helm'), 0, 'switching must refuse while the old item is worn');

    // A banked old reward also blocks switching until the player brings it to inventory.
    assert.equal(p.invDel(worn, obj('rag_bonesack'), 1), 1);
    give(p, 'rag_bonesack', 1, bank);
    clickNpc(p, interrupted.oldMan, 1, [2]);
    assert.equal(count(p, 'rag_bonesack', bank), 1, 'a banked old reward must remain owned');
    assert.equal(ownedCount(p, 'rag_ram_helm'), 0, 'switching must refuse while the old item is banked');
    assert.equal(p.invDel(bank, obj('rag_bonesack'), 1), 1);
    give(p, 'rag_bonesack');
    const coinsBefore = count(p, 'coins');
    clickNpc(p, interrupted.oldMan, 1, [2]);
    assert.equal(count(p, 'rag_bonesack'), 0, 'a successful switch consumes the old inventory reward');
    assert.equal(count(p, 'rag_ram_helm'), 1, 'a successful switch grants the selected replacement');
    assert.equal(count(p, 'coins'), coinsBefore, 'replacement and switching service must be free');
    assert.equal(wishState(p), 2, 'switching must not reopen or re-award the quest');
    assertNoReward(p, noRewardBefore, 'reward switch');

    // Loss recovery is available after completion, but a second owned copy is not.
    assert.equal(p.invDel(inv, obj('rag_ram_helm'), 1), 1);
    clickNpc(p, interrupted.oldMan, 1, [2]);
    assert.equal(ownedCount(p, 'rag_ram_helm'), 1, 'a lost helmet must be recoverable once');
    assertNoReward(p, noRewardBefore, 'lost reward recovery');
    p.closeModal();
    useItemOption(p, 'rag_ram_helm', 2);
    assert.equal(count(p, 'rag_ram_helm', worn), 1, 'Ram skull helmet must use its packed Wear option');
    assert.equal(ownedCount(p, 'rag_bonesack'), 0, 'switching must not leave a second reward behind');
    removePlayer(p);
    if (World.players[p.slot] === p) World.players[p.slot] = null;
  }

  {
    const chosenHelm = completeWishlist(2, false);
    const p = chosenHelm.p;
    const before = rewardSnapshot(p);
    p.closeModal();
    useItemOption(p, 'rag_ram_helm', 2);
    assert.equal(count(p, 'rag_ram_helm', worn), 1, 'Ram skull helmet must equip in the worn inventory');
    clickNpc(p, chosenHelm.oldMan, 1, [2]);
    assert.equal(ownedCount(p, 'rag_ram_helm'), 1, 'the same owned helmet must not be replaced by a duplicate');
    clickNpc(p, chosenHelm.oldMan, 1, [1]);
    assert.equal(count(p, 'rag_ram_helm', worn), 1, 'a worn helmet must remain owned when switching is refused');
    assert.equal(ownedCount(p, 'rag_bonesack'), 0, 'switching from worn gear requires it in inventory');
    assertNoReward(p, before, 'worn-helmet replacement gate');
    assert.equal(p.invDel(worn, obj('rag_ram_helm'), 1), 1);
    give(p, 'rag_ram_helm');
    clickNpc(p, chosenHelm.oldMan, 1, [1]);
    assert.equal(count(p, 'rag_ram_helm'), 0, 'switching back must consume the inventory helmet');
    assert.equal(count(p, 'rag_bonesack'), 1, 'switching back must grant one Bonesack');
    assert.equal(wishState(p), 2, 'the second reward option must not reset completion state');
    assertNoReward(p, before, 'switching from Ram skull helmet');
    removePlayer(p);
    if (World.players[p.slot] === p) World.players[p.slot] = null;
  }

  console.log('PASS Rag and Bone Man wish list: packed 27-bone mapping, drops, boiler persistence, batched hand-in, rewards and replacement');
  process.exit(0);
}

await main();
