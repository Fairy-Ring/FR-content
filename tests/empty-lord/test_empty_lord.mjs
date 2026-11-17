#!/usr/bin/env node
/** Compiled Empty Lord dialogue, route, reward, gate and persistence coverage. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = relative => import(pathToFileURL(path.join(engine, 'src', relative)).href);
const World = (await load('engine/World.ts')).default;
const { NetworkPlayer } = await load('engine/entity/NetworkPlayer.ts');
const Npc = (await load('engine/entity/Npc.ts')).default;
const Obj = (await load('engine/entity/Obj.ts')).default;
const { EntityLifeCycle } = await load('engine/entity/EntityLifeCycle.ts');
const { PlayerLoading } = await load('engine/entity/PlayerLoading.ts');
const Packet = (await load('io/Packet.ts')).default;
const ScriptProvider = (await load('engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('engine/script/ScriptState.ts')).default;
const Trigger = (await load('engine/script/ServerTriggerType.ts')).default;
const JavaRandom = (await load('util/JavaRandom.ts')).default;
const ScriptVarType = (await load('cache/config/ScriptVarType.ts')).default;
const PauseHandler = (await load('network/game/client/handler/ResumePauseButtonHandler.ts')).default;
const ResumePauseButton = (await load('network/game/client/model/ResumePauseButton.ts')).default;
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'ParamType',
  'ObjType', 'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType',
  'SeqType', 'SpotanimType', 'MesanimType', 'DbTableType', 'DbRowType', 'Component', 'FontType']) {
  types[name] = (await load(`cache/config/${name}.ts`)).default;
  types[name].load(pack);
}
(await load('cache/config/DbTableIndex.ts')).default.init();
assert(ScriptProvider.load(pack) > 0, 'build the sibling engine first');
World.currentTick = 100;

const id = (kind, name) => {
  const value = types[kind].getId(name);
  assert(value >= 0, `missing packed ${kind}:${name}`);
  return value;
};
const inv = id('InvType', 'inv');
const worn = id('InvType', 'worn');
const bank = id('InvType', 'bank');
const multi2 = id('Component', 'multi2');
const varp = id('VarPlayerType', 'dagganoth_area_project');
const routeProc = '[proc,empty_lord_route]';
const progressProc = '[proc,empty_lord_progress]';
const expectedProc = '[proc,empty_lord_expected]';
const ghosts = Array.from({ length: 16 }, (_, index) => `secret_ghost${index + 1}`);
const pieces = [
  'secret_ghost_top', 'secret_ghost_gloves', 'secret_ghost_boots',
  'secret_ghost_bottom', 'secret_ghost_hat', 'secret_ghost_cloak'
];
const routes = [
  ['secret_ghost1', 'secret_ghost2', 'secret_ghost8', 'secret_ghost11', 'secret_ghost5', 'secret_ghost14'],
  ['secret_ghost1', 'secret_ghost3', 'secret_ghost9', 'secret_ghost12', 'secret_ghost6', 'secret_ghost15'],
  ['secret_ghost1', 'secret_ghost4', 'secret_ghost10', 'secret_ghost13', 'secret_ghost7', 'secret_ghost16']
];
const locations = [
  '0_39_53_59_52', '0_47_61_14_42', '0_47_57_26_53', '0_49_46_26_38',
  '0_48_49_40_22', '1_47_54_44_40', '1_42_54_49_8', '0_46_59_6_44',
  '0_50_57_17_29', '0_47_60_60_18', '0_44_52_34_20', '0_47_50_36_4',
  '0_37_54_28_25', '1_51_61_30_30', '1_53_55_56_30', '0_48_156_47_12'
].map(value => {
  const [level, regionX, regionZ, localX, localZ] = value.split('_').map(Number);
  return { level, regionX, regionZ, localX, localZ };
});
const locationOf = ghost => locations[ghosts.indexOf(ghost)];
const pieceId = name => id('ObjType', name);
const count = (p, name, container = inv) => p.invTotal(container, pieceId(name));
const totalOwned = (p, name) => count(p, name, inv) + count(p, name, worn) + count(p, name, bank);
const output = p => [...p.packets.map(packet => packet?.text ?? packet?.msg ?? ''), ...p.messages]
  .filter(Boolean).join(' ').replaceAll('|', ' ').replace(/\s+/g, ' ');
const pauseHandler = new PauseHandler();
const storyVarMask = (0x0f << 1) | (0x3f << 5);
const unrelatedBits = (1 << 18) | (1 << 11) | 1;
const unrelatedMask = (~storyVarMask) >>> 0;
let serial = 0;
let npcSerial = 0;

assert.equal(types.VarPlayerType.get(varp).scope, types.VarPlayerType.SCOPE_PERM,
  'route and story bits use the original permanent Dagannoth varp');

function player(saved = null) {
  const slot = ++serial;
  const p = saved
    ? PlayerLoading.load('empty_lord_test', new Packet(saved), null)
    : new NetworkPlayer('empty_lord_test', BigInt(slot), BigInt(10000 + slot), { uuid: `offline-empty-lord-${slot}` });
  p.pid = slot;
  p.slot = slot;
  p.uid = slot;
  p.level = 0;
  p.x = 3200;
  p.z = 3200;
  p.isActive = true;
  p.baseLevels.fill(99);
  p.levels.fill(99);
  p.packets = [];
  p.messages = [];
  p.write = packet => p.packets.push(packet);
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = text => p.messages.push(String(text));
  p.setVar(id('VarPlayerType', 'tutorial'), 1000);
  World.players[slot] = p;
  World.playerLoop.add(p.hash64, p);
  return p;
}

function equip(p, name) {
  const object = types.ObjType.get(pieceId(name));
  assert(object.wearpos >= 0, `${name} must have a wearable slot`);
  p.invSet(worn, object.id, 1, object.wearpos);
}

function enableGhosts(p) {
  equip(p, 'fd_ring_visibility');
  equip(p, 'amulet_of_ghostspeak');
  p.setVar(varp, unrelatedBits);
  assert.equal(readRoute(p), 0);
  assert.equal(readProgress(p), 0);
  assertUnrelatedBits(p);
  return p;
}

function npcAt(ghost) {
  const npcId = id('NpcType', ghost);
  const type = types.NpcType.get(npcId);
  const where = locationOf(ghost);
  const x = where.regionX * 64 + where.localX;
  const z = where.regionZ * 64 + where.localZ;
  const npc = new Npc(where.level, x, z, type.size, type.size, EntityLifeCycle.RESPAWN,
    ++npcSerial, npcId, type.blockwalk);
  npc.isActive = true;
  npc.lastMovement = -100;
  return npc;
}

function startTalk(p, ghost) {
  const npc = npcAt(ghost);
  p.level = npc.level;
  p.x = npc.x - 1;
  p.z = npc.z;
  p.target = npc;
  p.targetOp = Trigger.OPNPC1 - 7;
  const script = p.getOpTrigger();
  assert(script, `packed Talk-to dispatch for ${ghost}`);
  assert.match(script.name, /secret_ghost|empty_lord/, `${ghost} must dispatch to its production handler`);
  const state = ScriptRunner.init(script, p, npc);
  p.executeScript(state, true);
  assert.notEqual(state.execution, ScriptState.ABORTED, `${ghost} aborted on entry`);
  return state;
}

function resume(p, state, choice = null) {
  assert.equal(state.execution, ScriptState.PAUSEBUTTON, 'expected a production dialogue pause');
  if (p.modalChat === multi2) {
    assert.notEqual(choice, null, 'every story choice must be explicit');
    p.lastCom = id('Component', `multi2:com_${choice}`);
    assert(pauseHandler.handle(new ResumePauseButton(p.lastCom), p), 'production choice handler rejected the choice');
  } else {
    assert.equal(choice, null, 'a choice was supplied for a Continue pause');
    assert(pauseHandler.handle(new ResumePauseButton(0), p), 'production Continue handler rejected the pause');
  }
  assert.notEqual(state.execution, ScriptState.ABORTED, 'dialogue aborted after resume');
}

function finish(p, state, { choices = [], optionalChoice = null, afterChoice = null } = {}) {
  let choiceCount = 0;
  let afterChoiceDone = false;
  for (let steps = 0; state.execution !== ScriptState.FINISHED && steps < 200; steps++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, 'compiled dialogue aborted');
    if (state.execution === ScriptState.PAUSEBUTTON) {
      if (p.modalChat === multi2) {
        const choice = choices.length ? choices.shift() : optionalChoice;
        assert.notEqual(choice, null, 'test must specify every story choice');
        choiceCount++;
        resume(p, state, choice);
        if (afterChoice && !afterChoiceDone) {
          afterChoice(p, state);
          afterChoiceDone = true;
        }
      } else {
        resume(p, state);
      }
    } else if (state.execution === ScriptState.SUSPENDED || state.execution === ScriptState.NPC_SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else {
      assert.fail(`unexpected compiled dialogue state ${state.execution}`);
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'compiled dialogue did not finish');
  assert.equal(choices.length, 0, 'every specified choice was reached');
  return choiceCount;
}

function chooseFirstMenu(p, state, choice) {
  for (let steps = 0; steps < 100; steps++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, 'dialogue aborted before its story choice');
    if (state.execution === ScriptState.PAUSEBUTTON && p.modalChat === multi2) {
      assert(output(p).includes('Tell me your story'), 'story choice includes Tell me your story');
      assert(output(p).includes('Goodbye then'), 'story choice includes Goodbye then');
      resume(p, state, choice);
      return;
    }
    if (state.execution === ScriptState.PAUSEBUTTON) {
      resume(p, state);
    } else if (state.execution === ScriptState.SUSPENDED || state.execution === ScriptState.NPC_SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else {
      assert.fail(`unexpected state before story choice: ${state.execution}`);
    }
  }
  assert.fail('story choice was not reached');
}

function talkAndChoose(p, ghost, choice = 1, options = {}) {
  p.packets = [];
  p.messages = [];
  const state = startTalk(p, ghost);
  chooseFirstMenu(p, state, choice);
  const completedChoices = finish(p, state, options);
  return { state, choices: completedChoices + 1, text: output(p) };
}

function talkOptional(p, ghost, optionalChoice = 1) {
  p.packets = [];
  p.messages = [];
  const state = startTalk(p, ghost);
  const choices = finish(p, state, { optionalChoice });
  return { state, choices, text: output(p) };
}

function runProc(p, name, args = []) {
  const script = ScriptProvider.getByName(name);
  assert(script, `compiled procedure ${name}`);
  const state = ScriptRunner.init(script, p, null, args);
  // Read-only compiled accessors must not contend with an intentionally paused conversation.
  ScriptRunner.execute(state);
  assert.equal(state.execution, ScriptState.FINISHED, `${name} finishes`);
  assert(state.isp > 0, `${name} returns its declared value`);
  return state.intStack[state.isp - 1];
}

function readRoute(p) {
  return runProc(p, routeProc);
}

function readProgress(p) {
  return runProc(p, progressProc);
}

function readExpected(p, stage, route) {
  return runProc(p, expectedProc, [stage, route]);
}

function assertUnrelatedBits(p) {
  assert.equal((p.getVar(varp) >>> 0) & unrelatedMask, unrelatedBits,
    'route/story writes preserve bit 0 and Dagannoth bits 11+');
}

function assertStoryBits(p, completed) {
  const bits = (p.getVar(varp) >>> 0) & (0x3f << 5);
  assert.equal(bits, ((1 << completed) - 1) << 5, `only the first ${completed} story bits are set`);
  assertUnrelatedBits(p);
}

function withMathRandomBoundary(value, action) {
  const originalMathRandom = Math.random;
  const originalNextDouble = JavaRandom.nextDouble;
  let samples = 0;
  Math.random = () => {
    samples++;
    return value;
  };
  // The compiled RANDOM opcode delegates to JavaRandom.nextDouble(). Route that
  // opcode through the controlled Math.random boundary without replacing scripts.
  JavaRandom.nextDouble = () => Math.random();
  try {
    const result = action();
    return { result, samples };
  } finally {
    JavaRandom.nextDouble = originalNextDouble;
    Math.random = originalMathRandom;
  }
}

function routeBits(p, route) {
  assert.equal(readRoute(p), route, 'route accessor returns the saved route');
  assert.equal((p.getVar(varp) >>> 0) & (0x0f << 1), route << 1, 'route occupies bits 1..4');
}

function assertPieceDelta(p, before, grantedName = null) {
  for (const name of pieces) {
    assert.equal(totalOwned(p, name), before.get(name) + Number(name === grantedName),
      `${name}: only the expected story piece changes`);
  }
}

function ownedSnapshot(p) {
  return new Map(pieces.map(name => [name, totalOwned(p, name)]));
}

function assertOnlyPiece(p, name, amount = 1) {
  for (const piece of pieces) {
    assert.equal(totalOwned(p, piece), piece === name ? amount : 0, `${piece} ownership`);
  }
}

function fillInventory(p) {
  const filler = id('ObjType', 'bronze_dagger');
  assert.equal(types.ObjType.get(filler).stackable, false, 'inventory filler is non-stackable');
  const capacity = p.invSize(inv);
  for (let slot = 0; slot < capacity; slot++) {
    assert(p.invFreeSpace(inv) > 0, 'fill each real inventory slot');
    p.invAdd(inv, filler, 1);
  }
  assert.equal(p.invFreeSpace(inv), 0, 'inventory is full before story settlement');
  return filler;
}

function assertOriginalNpcLocations() {
  for (const ghost of ghosts) {
    const { level, regionX, regionZ, localX, localZ } = locationOf(ghost);
    const mapPath = path.join(content, 'maps', `m${regionX}_${regionZ}.jm2`);
    const mapText = fs.readFileSync(mapPath, 'utf8');
    const marker = '==== NPC ====';
    const npcSection = mapText.slice(mapText.indexOf(marker) + marker.length);
    const expectedId = id('NpcType', ghost);
    const rows = npcSection.split(/\r?\n/).flatMap(line => {
      const match = /^(\d+) (\d+) (\d+):\s+(\d+)(?:\s+\d+)?\s*$/.exec(line);
      return match ? [[Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])]] : [];
    });
    const matches = rows.filter(([plane, x, z, npcId]) =>
      plane === level && x === localX && z === localZ && npcId === expectedId);
    assert.equal(matches.length, 1,
      `${ghost} base spawn remains at ${level}_${regionX}_${regionZ}_${localX}_${localZ}`);
  }
}

function assertWearableGhostPieces() {
  const slots = [
    ['secret_ghost_top', 'torso', 'arms'],
    ['secret_ghost_gloves', 'hands', null],
    ['secret_ghost_boots', 'feet', null],
    ['secret_ghost_bottom', 'legs', null],
    ['secret_ghost_hat', 'hat', 'head'],
    ['secret_ghost_cloak', 'back', null]
  ];
  for (const [name, mainSlot, secondarySlot] of slots) {
    const type = types.ObjType.get(pieceId(name));
    assert.equal(type.iop[1], 'Wear', `${name} retains its wearable option`);
    assert.equal(type.wearpos, types.ObjType.getWearPosId(mainSlot), `${name} primary wear slot`);
    assert.equal(type.wearpos2, secondarySlot ? types.ObjType.getWearPosId(secondarySlot) : -1,
      `${name} secondary wearable slot`);
  }
  for (const [name, slot] of [['fd_ring_visibility', 'ring'], ['amulet_of_ghostspeak', 'front']]) {
    const type = types.ObjType.get(id('ObjType', name));
    assert.equal(type.iop[1], 'Wear', `${name} can be worn for the dialogue gate`);
    assert.equal(type.wearpos, types.ObjType.getWearPosId(slot), `${name} uses the original worn slot`);
  }
}

function runFullRoute(route) {
  const p = enableGhosts(player());
  const firstBoundary = [0, 1 / 3, 2 / 3][route - 1];
  const interrupted = withMathRandomBoundary(firstBoundary, () => {
    const state = startTalk(p, 'secret_ghost1');
    chooseFirstMenu(p, state, 1);
    return state;
  });
  assert.equal(interrupted.samples, 1, 'accepted Valdez story selects one route exactly once');
  const firstState = interrupted.result;
  routeBits(p, route);
  assert.equal(readProgress(p), 0, 'route is saved before the story is settled');
  assertStoryBits(p, 0);
  assertOnlyPiece(p, null, 0);
  assert.notEqual(firstState.execution, ScriptState.FINISHED, 'the first story page remains interruptible');

  // Save/load while the accepted story is still unfinished, then retry with a
  // different boundary. A saved route must not draw again or change branches.
  let recovered = player(p.save());
  routeBits(recovered, route);
  assert.equal(readProgress(recovered), 0, 'interrupted dialogue did not complete a story');
  assert.equal(count(recovered, pieces[0]), 0, 'interrupted dialogue did not grant a piece');
  assertUnrelatedBits(recovered);
  const retry = withMathRandomBoundary(route === 1 ? 2 / 3 : 0, () =>
    talkAndChoose(recovered, 'secret_ghost1', 1));
  assert.equal(retry.samples, 0, 'retry and relog reuse the selected route without another draw');
  assert(retry.result.text.includes('Tell me your story'));
  assert(retry.result.text.includes('Goodbye then'));
  assert.equal(readProgress(recovered), 1);
  routeBits(recovered, route);
  assertStoryBits(recovered, 1);
  assertPieceDelta(recovered, new Map(pieces.map((name, index) => [name, Number(index === 0)])), null);
  assert.equal(count(recovered, pieces[0]), 1, 'Valdez grants exactly the robe top');

  recovered = player(recovered.save());
  routeBits(recovered, route);
  assert.equal(readProgress(recovered), 1, 'real Player save/load preserves completed stage');
  assert.equal(count(recovered, pieces[0]), 1, 'real Player save/load preserves the first reward');
  assertUnrelatedBits(recovered);

  const wrongStageTwo = ['secret_ghost2', 'secret_ghost3', 'secret_ghost4']
    .find(name => name !== routes[route - 1][1]);
  const beforeWrong = ownedSnapshot(recovered);
  talkOptional(recovered, wrongStageTwo, 1);
  assert.equal(readProgress(recovered), 1, 'wrong route ghost cannot advance the prefix');
  routeBits(recovered, route);
  assertPieceDelta(recovered, beforeWrong);
  assertStoryBits(recovered, 1);

  const skippedStage = routes[route - 1][2];
  const beforeSkip = ownedSnapshot(recovered);
  talkOptional(recovered, skippedStage, 1);
  assert.equal(readProgress(recovered), 1, 'skipping the required second ghost cannot advance progress');
  assertPieceDelta(recovered, beforeSkip);
  assertStoryBits(recovered, 1);

  for (let stage = 2; stage <= 6; stage++) {
    const ghost = routes[route - 1][stage - 1];
    assert.equal(readExpected(recovered, stage, route), id('NpcType', ghost),
      `route ${route} stage ${stage} expects its original base NPC`);
    const before = ownedSnapshot(recovered);
    const conversation = talkAndChoose(recovered, ghost, 1);
    assert(conversation.text.includes('Tell me your story'), `${ghost} offers the story option`);
    assert(conversation.text.includes('Goodbye then'), `${ghost} offers the refusal option`);
    assert.equal(readProgress(recovered), stage, `${ghost} completes exactly story ${stage}`);
    routeBits(recovered, route);
    assertStoryBits(recovered, stage);
    assertPieceDelta(recovered, before, pieces[stage - 1]);
    assert.equal(count(recovered, pieces[stage - 1]), 1, `${ghost} grants its one assigned piece`);
  }
  assert.equal(readProgress(recovered), 6, 'the full route completes six stories');
  assert.equal(readExpected(recovered, 1, route), id('NpcType', 'secret_ghost1'));
  for (const piece of pieces) assert.equal(count(recovered, piece), 1, `one ${piece} after a full route`);
  return { player: recovered, route };
}

function removeEverywhere(p, name) {
  const objectId = pieceId(name);
  for (const container of [inv, worn, bank]) {
    const amount = p.invTotal(container, objectId);
    if (amount > 0) p.invDel(container, objectId, amount);
  }
}

function testCompletedGhostReclaims(p, route) {
  for (let stage = 1; stage <= 6; stage++) {
    const ghost = routes[route - 1][stage - 1];
    const ownPiece = pieces[stage - 1];
    const otherGhost = routes[route - 1][stage % 6];

    removeEverywhere(p, ownPiece);
    const beforeWrongGhost = ownedSnapshot(p);
    const wrongRepeat = talkOptional(p, otherGhost, 1);
    assert(wrongRepeat.text.length > 0, `${otherGhost} gives its completed-story hint`);
    assertPieceDelta(p, beforeWrongGhost, null);
    assert.equal(totalOwned(p, ownPiece), 0, 'another completed ghost does not reclaim this ghost\'s piece');

    const beforeReclaim = ownedSnapshot(p);
    const missing = talkOptional(p, ghost, 1);
    assert(missing.text.length > 0, `${ghost} repeats its completed-story hint`);
    assertPieceDelta(p, beforeReclaim, ownPiece);
    assert.equal(totalOwned(p, ownPiece), 1, `${ghost} reclaims only its missing piece`);

    for (const container of [inv, worn, bank]) {
      removeEverywhere(p, ownPiece);
      if (container === worn) {
        const type = types.ObjType.get(pieceId(ownPiece));
        p.invSet(worn, type.id, 1, type.wearpos);
      } else {
        p.invAdd(container, pieceId(ownPiece), 1);
      }
      const beforeOwned = ownedSnapshot(p);
      talkOptional(p, ghost, 1);
      assertPieceDelta(p, beforeOwned, null);
      assert.equal(totalOwned(p, ownPiece), 1,
        `${ghost} does not duplicate its piece already in ${container === inv ? 'inventory' : container === worn ? 'worn items' : 'bank'}`);
    }
  }

  const ghost = routes[route - 1][0];
  const ownPiece = pieces[0];
  removeEverywhere(p, ownPiece);
  const { unzipSync } = createRequire(path.join(engine, 'package.json'))('fflate');
  const mapName = 'm39_53';
  const landName = 'l39_53';
  const packedMaps = unzipSync(fs.readFileSync(path.join(pack, '.cache/maps-server.zip')),
    { filter: entry => entry.name === mapName || entry.name === landName });
  assert(packedMaps[mapName] && packedMaps[landName], 'native pack has the original Valdez mapsquare');
  World.vars = Int32Array.from({ length: types.VarSharedType.count }, (_, index) =>
    types.VarSharedType.get(index).type === ScriptVarType.INT ? 0 : -1);
  World.varsString = new Array(types.VarSharedType.count);
  World.gameMap.loadPackedMapsquare({
    m: packedMaps[mapName], l: packedMaps[landName], n: new Uint8Array(), o: new Uint8Array()
  }, 39 * 64, 53 * 64);
  const where = locationOf(ghost);
  const x = where.regionX * 64 + where.localX;
  const z = where.regionZ * 64 + where.localZ;
  const floor = new Obj(where.level, x, z, EntityLifeCycle.DESPAWN, pieceId(ownPiece), 1);
  World.addObj(floor, p.hash64, 300);
  try {
    const before = ownedSnapshot(p);
    talkOptional(p, ghost, 1);
    assertPieceDelta(p, before, ownPiece);
    assert.equal(totalOwned(p, ownPiece), 1, 'a floor item does not count as inventory, worn or bank ownership');
    assert([...World.gameMap.getZone(x, z, where.level).getAllObjsSafe()].includes(floor),
      'the original floor item remains while the ghost grants its own piece');
  } finally {
    World.removeObj(floor, 0);
  }
}

function testRefusalAndEquipmentGates() {
  const refused = enableGhosts(player());
  const refusal = withMathRandomBoundary(2 / 3, () => talkAndChoose(refused, 'secret_ghost1', 2));
  assert.equal(refusal.samples, 0, 'Goodbye then does not choose a route');
  assert.equal(readRoute(refused), 0, 'refusal leaves route unset');
  assert.equal(readProgress(refused), 0, 'refusal leaves story progress unset');
  assertOnlyPiece(refused, null, 0);
  assertUnrelatedBits(refused);

  const ring = pieceId('fd_ring_visibility');
  const ghostspeak = pieceId('amulet_of_ghostspeak');
  const gateCases = [
    { ring: 'carried', amulet: 'worn' },
    { ring: 'worn', amulet: 'carried' },
    { ring: 'carried', amulet: 'carried' }
  ];
  for (const fixture of gateCases) {
    const p = player();
    if (fixture.ring === 'worn') equip(p, 'fd_ring_visibility');
    else p.invAdd(inv, ring, 1);
    if (fixture.amulet === 'worn') equip(p, 'amulet_of_ghostspeak');
    else p.invAdd(inv, ghostspeak, 1);
    p.setVar(varp, unrelatedBits);
    const conversation = talkOptional(p, 'secret_ghost1', 1);
    assert.equal(readRoute(p), 0, `ring ${fixture.ring}, amulet ${fixture.amulet}: no route without both worn`);
    assert.equal(readProgress(p), 0, `ring ${fixture.ring}, amulet ${fixture.amulet}: no story progress`);
    assertOnlyPiece(p, null, 0);
    assertUnrelatedBits(p);
    if (fixture.ring === 'worn') {
      assert(conversation.text.length > 0, 'visible ghost gives its sourced no-amulet response');
    } else {
      assert.equal(conversation.text.length, 0, 'an invisible ghost cannot begin a conversation');
    }
  }
}

function testFullInventorySettlement() {
  const p = enableGhosts(player());
  const first = withMathRandomBoundary(0, () => {
    const state = startTalk(p, 'secret_ghost1');
    chooseFirstMenu(p, state, 1);
    assert.equal(readRoute(p), 1, 'the route is chosen before story pages');
    assert.equal(readProgress(p), 0, 'the stage is not committed before story settlement');
    assert.equal(count(p, pieces[0]), 0, 'the piece is not granted before story settlement');
    assert.notEqual(state.execution, ScriptState.FINISHED, 'the story is paused before settlement');
    fillInventory(p);
    return finish(p, state);
  });
  assert.equal(first.samples, 1, 'first accepted story chooses one route');
  assert.equal(readRoute(p), 1);
  assert.equal(readProgress(p), 0, 'full inventory leaves the story stage unchanged');
  assertStoryBits(p, 0);
  assert.equal(count(p, pieces[0]), 0, 'full inventory does not lose or write the reward');
  assertUnrelatedBits(p);

  const filler = id('ObjType', 'bronze_dagger');
  assert.equal(p.invDel(inv, filler, 1), 1, 'free one real inventory slot');
  assert.equal(p.invFreeSpace(inv), 1);
  const retry = withMathRandomBoundary(2 / 3, () => talkAndChoose(p, 'secret_ghost1', 1));
  assert.equal(retry.samples, 0, 'settlement retry preserves the previously saved route');
  assert.equal(readRoute(p), 1);
  assert.equal(readProgress(p), 1, 'available inventory allows the story to settle');
  assertStoryBits(p, 1);
  assert.equal(count(p, pieces[0]), 1, 'the retry receives the one unsatisfied reward');
  assert.equal(p.invFreeSpace(inv), 0, 'the reward occupies the freed slot exactly once');
}

function testRouteAndProgressProcedures() {
  const p = enableGhosts(player());
  assert.equal(readExpected(p, 1, 1), id('NpcType', 'secret_ghost1'));
  for (let route = 1; route <= 3; route++) {
    for (let stage = 2; stage <= 6; stage++) {
      assert.equal(readExpected(p, stage, route), id('NpcType', routes[route - 1][stage - 1]),
        `expected NPC route ${route}, stage ${stage}`);
    }
  }
}

assertOriginalNpcLocations();
assertWearableGhostPieces();
testRouteAndProgressProcedures();
testRefusalAndEquipmentGates();
testFullInventorySettlement();
for (let route = 1; route <= 3; route++) {
  const completed = runFullRoute(route);
  if (route === 1) testCompletedGhostReclaims(completed.player, completed.route);
}
console.log('PASS compiled Empty Lord routes, dialogue choices, equipment gates, ordered rewards, persistence, inventory settlement and reclaim');
// Engine imports retain background handles; all assertions above are synchronous.
process.exit(0);
