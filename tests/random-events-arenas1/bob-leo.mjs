import { pathToFileURL } from 'node:url';
import { assert, check, player, run, count, reconnect, v, id, types, World, inv, tile, origin, PlayerStat, nativeNpcRows, nativeLocRows, locFor, engine, ScriptState, ResumePauseButtonHandler, ResumePauseButton } from './runtime.mjs';

const load = async rel => (await import(pathToFileURL(`${engine}/src/${rel}`).href)).default;
const OpObjHandler = await load('network/game/client/handler/OpObjHandler.ts');
const OpObj = await load('network/game/client/model/OpObj.ts');
const groundAction = new OpObjHandler();

const [OpHeld, OpHeldHandler, OpLoc, OpLocHandler, OpLocU, OpLocUHandler, OpNpc, OpNpcHandler] = await Promise.all([
  load('network/game/client/model/OpHeld.ts'),
  load('network/game/client/handler/OpHeldHandler.ts'),
  load('network/game/client/model/OpLoc.ts'),
  load('network/game/client/handler/OpLocHandler.ts'),
  load('network/game/client/model/OpLocU.ts'),
  load('network/game/client/handler/OpLocUHandler.ts'),
  load('network/game/client/model/OpNpc.ts'),
  load('network/game/client/handler/OpNpcHandler.ts')
]);
const heldHandler = new OpHeldHandler();
const locHandler = new OpLocHandler();
const locUseHandler = new OpLocUHandler();
const npcHandler = new OpNpcHandler();
const inventoryComponent = id(types.Component, 'inventory:inv');
const { NpcStat } = await import(pathToFileURL(`${engine}/src/engine/entity/NpcStat.ts`).href);
const rsbuf = await import(pathToFileURL(`${engine}/src/network/rsbuf/index.ts`).href);
const bank = id(types.InvType, 'bank'), worn = id(types.InvType, 'worn');
const netType = id(types.ObjType, 'evil_bob_net');

const standardNetType = id(types.ObjType, 'net');
const bobSpots = nativeLocRows('fishing_spot_8986').filter(row => row.mx === 39 && row.mz === 74);
const nativeNets = [[20, 48], [22, 32], [24, 50], [37, 33], [37, 48], [39, 36], [40, 47]];
let nextNet = 0;

function position(p, level, x, z) {
  p.level = level;
  p.x = p.originX = x;
  p.z = p.originZ = z;
  p.buildArea.originX = Math.floor(x / 8) * 8;
  p.buildArea.originZ = Math.floor(z / 8) * 8;
}

function finishInteraction(p, label) {
  for (let step = 0; step < 80; step++) {
    const state = p.activeScript;
    if (!state || state.execution === ScriptState.FINISHED) return;
    assert.notEqual(state.execution, ScriptState.ABORTED, `${label} does not abort`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      assert(new ResumePauseButtonHandler().handle(new ResumePauseButton(0), p), `${label} resumes its actual page`);
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.runScript(state, true, true);
    } else {
      assert.equal(state.execution, ScriptState.FINISHED, `${label} finishes synchronously`);
      return;
    }
  }
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED, `${label} finishes within the bound`);
}

function capturePacketExecution(p, expectedName, invoke) {
  const executions = [];
  const original = p.executeScript;
  p.executeScript = function(state, ...args) {
    executions.push({ state, name: state.script.name });
    return original.call(this, state, ...args);
  };
  try { invoke(); }
  finally { p.executeScript = original; }
  const execution = executions.find(candidate => candidate.name === expectedName);
  assert(execution, `native packet dispatch executes ${expectedName}`);
  return execution.state;
}

function standNear(p, target) {
  for (let distance = 0; distance <= 3; distance++) {
    for (let dx = -distance; dx <= distance; dx++) {
      for (let dz = -distance; dz <= distance; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== distance) continue;
        position(p, target.level, target.x + dx, target.z + dz);
        if (p.inOperableDistance(target)) return;
      }
    }
  }
  assert.fail(`player can stand within interaction distance of ${target.debugname ?? target.type}`);
}

function showNpc(p, npc) {
  rsbuf.addPlayer(p.slot);
  rsbuf.addNpc(npc.nid, npc.type);
  const appearance = p.generateAppearance();
  const hp = PlayerStat.HITPOINTS;
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, appearance, p.lastAppearance,
    p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ,
    p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[hp], p.baseLevels[hp], p.animId, p.animDelay, p.sayMessage,
    p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0,
    p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(npc.x, npc.level, npc.z, npc.nid, npc.type, npc.tele, npc.jump,
    npc.runDir, npc.walkDir, npc.isActive, npc.masks, npc.faceEntity,
    npc.faceSquareX, npc.faceSquareZ, npc.faceAngleX, npc.faceAngleZ,
    npc.hitmarkDamage, npc.hitmarkType, npc.hitmark2Damage, npc.hitmark2Type,
    npc.levels[NpcStat.HITPOINTS], npc.baseLevels[NpcStat.HITPOINTS],
    npc.animId, npc.animDelay, npc.sayMessage, npc.spotanimId, npc.spotanimHeight, npc.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, npc.nid), 'native visibility packet exposes Leo');
}

function interactLoc1(p, loc, expectedName, label) {
  standNear(p, loc);
  assert(locHandler.handle(new OpLoc(1, loc.x, loc.z, loc.type), p), `${label} packet is accepted`);
  assert.equal(p.target, loc);
  assert(p.validateTarget(), `${label} target is valid`);
  assert.equal(p.getOpTrigger()?.name, expectedName, `${label} resolves the packed option`);
  const state = capturePacketExecution(p, expectedName, () => p.processInteraction());
  finishInteraction(p, label);
  return state;
}

function exposeInventory(p) {
  p.setTab(types.Component.get(inventoryComponent).rootLayer, 3);
  p.invListenOnCom(inv, inventoryComponent, p.uid);
}

function interactLocU(p, loc, itemName, expectedName, label) {
  exposeInventory(p);
  const itemId = id(types.ObjType, itemName);
  const slot = p.getInventory(inv).getItemIndex(itemId);
  assert.notEqual(slot, -1, `${itemName} is carried for item-on-location use`);
  standNear(p, loc);
  assert(locUseHandler.handle(new OpLocU(loc.x, loc.z, loc.type, itemId, slot, inventoryComponent), p),
    `${label} packet is accepted`);
  assert.equal(p.lastUseItem, itemId);
  assert.equal(p.target, loc);
  assert(p.validateTarget(), `${label} target is valid`);
  assert.equal(p.getOpTrigger()?.name, expectedName, `${label} resolves the packed item-on-location option`);
  const state = capturePacketExecution(p, expectedName, () => p.processInteraction());
  finishInteraction(p, label);
  return state;
}

function startNpc1(p, npc, expectedName) {
  standNear(p, npc);
  showNpc(p, npc);
  assert(npcHandler.handle(new OpNpc(1, npc.nid), p), 'native Talk packet is accepted');
  assert.equal(p.target, npc);
  assert(p.validateTarget(), 'native Talk target is valid');
  assert.equal(p.getOpTrigger()?.name, expectedName, 'native Talk packet selects the packed handler');
  return capturePacketExecution(p, expectedName, () => p.processInteraction());
}

function talkNpc1(p, npc, label) {
  const state = startNpc1(p, npc, '[opnpc1,macro_gravedigger]');
  finishInteraction(p, label);
  return state;
}

function checkCoffin(p, coffin) {
  exposeInventory(p);
  const name = `macro_digger_coffin_object_${coffin}`;
  const itemId = id(types.ObjType, name);
  const slot = p.getInventory(inv).getItemIndex(itemId);
  assert.notEqual(slot, -1, `${name} is carried for Check`);
  const state = capturePacketExecution(p, `[opheld1,${name}]`, () => {
    assert(heldHandler.handle(new OpHeld(1, itemId, slot, inventoryComponent), p), `${name} OpHeld1 packet is accepted`);
  });
  finishInteraction(p, `${name} Check`);
  return state;
}

function takeNativeNet(p) {
  const [localX, localZ] = nativeNets[nextNet++];
  const x = 39 * 64 + localX;
  const z = 74 * 64 + localZ;
  const ground = World.getObj(x, z, 0, netType, p.hash64);
  assert(ground, `native m39_74 OBJ net exists at ${localX},${localZ}`);
  assert.equal(ground.type, netType, 'native ground source is the packed Evil Bob net');
  position(p, 0, x, z);
  assert(groundAction.handle(new OpObj(3, x, z, netType), p), 'the real ground Take action is accepted');
  p.processInteraction();
  finishInteraction(p, 'native net pickup');
  assert.equal(count(p, 'evil_bob_net'), 1, 'the native ground net enters inventory');
}

function npcAt(name, mx, mz) {
  const row = nativeNpcRows(name).find(candidate => candidate.mx === mx && candidate.mz === mz);
  assert(row, `native NPC row exists: ${name} m${mx}_${mz}`);
  const npc = World.npcs.find(candidate => candidate && candidate.type === row.id && candidate.level === row.level && candidate.x === row.x && candidate.z === row.z);
  assert(npc, `native packed NPC is loaded: ${name} ${row.coord}`);
  return { row, npc };
}

function locAt(name, mx, mz) {
  const row = nativeLocRows(name).find(candidate => candidate.mx === mx && candidate.mz === mz);
  assert(row, `native LOC row exists: ${name} m${mx}_${mz}`);
  return { row, loc: locFor(row) };
}

function bobDirection(row) {
  const dx = Math.abs(row.localX - 28);
  const dz = Math.abs(row.localZ - 42);
  if (dx > dz) return row.localX < 28 ? 0 : 3;
  return row.localZ < 42 ? 2 : 1;
}

function startBob(p, skill = PlayerStat.FISHING) {
  run(p, '[proc,macro_bob_start]', [skill]);
  assert.equal(p.getVar(v('macro_event')), 17);
}

function catchFish(p, row) {
  return interactLoc1(p, locFor(row), '[oploc1,fishing_spot_8986]', 'Bob fishing spot Net');
}

function catchFishWithItem(p, row, netName = 'evil_bob_net') {
  return interactLocU(p, locFor(row), netName, '[oplocu,fishing_spot_8986]', 'Bob item-use fishing');
}

function uncookFish(p, pot, cookedName) {
  p.lastUseItem = id(types.ObjType, cookedName);
  run(p, '[oplocu,uncooking_pot]', [], { loc: pot });
}

function feedBob(p, bob, rawName) {
  p.lastUseItem = id(types.ObjType, rawName);
  run(p, '[opnpcu,macro_evil_bob_island]', [], { npc: bob });
}

const leoGraveNames = ['grave_12721', 'grave_12722', 'grave_12723', 'grave_12724', 'grave_12725'];
const leoStoneNames = ['gravestone', 'gravestone_12717', 'gravestone_12718', 'gravestone_12719', 'gravestone_12720'];
const leoOutfit = ['macro_digger_shirt', 'macro_digger_boots', 'macro_digger_legs', 'macro_digger_gloves', 'macro_digger_mask'];
function field(word, start, width) { return (word >>> start) & ((1 << width) - 1); }
function leoKeys(p) {
  const word = p.getVar(v('macro_digger_var_3'));
  return Array.from({ length: 5 }, (_, index) => field(word, 1 + 3 * index, 3));
}
function leoInitialGraves(p) {
  const word = p.getVar(v('macro_digger_var'));
  return Array.from({ length: 5 }, (_, index) => field(word, 1 + 3 * index, 3));
}
function leoCoffinGroups(p) {
  const word = p.getVar(v('macro_digger_var'));
  return Array.from({ length: 5 }, (_, index) => field(word, 16 + 3 * index, 3));
}
function leoCarried(p) {
  const word = p.getVar(v('macro_digger_var_2'));
  return Array.from({ length: 5 }, (_, index) => field(word, 1 + 2 * index, 2));
}
function leoCounters(p) {
  const word = p.getVar(v('macro_digger_var_3'));
  return [field(word, 16, 3), field(word, 19, 3)];
}
function leoCoffinTotals(p) {
  const graves = leoInitialGraves(p);
  return Array.from({ length: 5 }, (_, index) =>
    graves.filter(coffin => coffin === index + 1).length + count(p, `macro_digger_coffin_object_${index + 1}`));
}
function leoOwns(p, name) { return count(p, name) + count(p, name, bank) + count(p, name, worn); }
function takeLeoGrave(p, graves, index) {
  return interactLoc1(p, graves[index].loc, `[oploc1,${leoGraveNames[index]}]`, `Leo grave ${index + 1} Take`);
}

function solveLeo(p, { inspect = false, reconnectAfterTwo = false, verifyWrongLayout = false, relogAtCompletionModal = false } = {}) {
  const gravedigger = npcAt('macro_gravedigger', 30, 78).npc;
  const graves = leoGraveNames.map(name => locAt(name, 30, 78));
  const stones = leoStoneNames.map(name => locAt(name, 30, 78));
  assert.deepEqual(stones.map(({ row }) => row.localX), graves.map(({ row }) => row.localX), 'native headstones align with their corresponding graves');

  run(p, '[proc,macro_leo_start]');
  assert.equal(p.getVar(v('macro_event')), 19);
  const keys = leoKeys(p);
  const initial = leoInitialGraves(p);
  assert.deepEqual([...keys].sort((a, b) => a - b), [1, 2, 3, 4, 5], 'native clue keys form a five-group permutation');
  assert.deepEqual([...initial].sort((a, b) => a - b), [1, 2, 3, 4, 5], 'native graves start with all five coffin groups');
  for (let index = 0; index < 5; index++) {
    assert.equal(initial[index], keys[index] === 5 ? 1 : keys[index] + 1, 'each grave starts with the next cyclic coffin, so all five are wrong');
  }

  if (inspect) {
    const stoneModels = [0, 13401, 13400, 13398, 13402, 13403];
    for (let index = 0; index < stones.length; index++) {
      run(p, `[oploc1,${leoStoneNames[index]}]`, [], { loc: stones[index].loc });
      assert.equal(p.modalMain, id(types.Component, 'inter_384'), 'headstone opens native 377 gravestone interface inter_384');
      const latestModel = p.messages.filter(pkt => pkt.constructor.name === 'IfSetModel' && pkt.component === id(types.Component, 'inter_384:com_2')).at(-1);
      assert.equal(latestModel?.model, stoneModels[keys[index]], `headstone ${index + 1} renders native carving model for group ${keys[index]}`);
      const latestAngle = p.messages.filter(pkt => pkt.constructor.name === 'IfSetAngle' && pkt.component === id(types.Component, 'inter_384:com_2')).at(-1);
      assert.deepEqual([latestAngle?.xan, latestAngle?.yan, latestAngle?.zoom], [531, 0, 210], 'headstone carving faces the camera at inter_384 angle');
      p.closeModal();
    }
    const mausoleum = locAt('mausoleum', 30, 78).loc;
    run(p, '[oploc1,mausoleum]', [], { loc: mausoleum });
    assert.equal(p.modalMain, id(types.Component, 'bank_deposit_box'), 'mausoleum opens the published deposit-only interface');
    assert(p.invListeners.some(listener => listener.type === inv
      && listener.com === id(types.Component, 'bank_deposit_box:com_62')), 'mausoleum uses its native inventory deposit listener');
    p.closeModal();
  }

  for (let index = 0; index < (reconnectAfterTwo ? 2 : 5); index++) {
    run(p, `[oploc1,${leoGraveNames[index]}]`, [], { loc: graves[index].loc });
  }
  if (reconnectAfterTwo) {
    const vars = ['macro_digger_var', 'macro_digger_var_2', 'macro_digger_var_3', 'macro_digger_var_4'];
    const before = vars.map(name => p.getVar(v(name)));
    p = reconnect(p);
    assert.deepEqual(vars.map(name => p.getVar(v(name))), before, 'native save/load retains Leo puzzle state');
    assert.equal(count(p, 'macro_digger_coffin_object_1') + count(p, 'macro_digger_coffin_object_2') + count(p, 'macro_digger_coffin_object_3') + count(p, 'macro_digger_coffin_object_4') + count(p, 'macro_digger_coffin_object_5'), 2, 'native save/load retains carried coffins');
  }
  for (let index = reconnectAfterTwo ? 2 : 5; index < 5; index++) {
    run(p, `[oploc1,${leoGraveNames[index]}]`, [], { loc: graves[index].loc });
  }

  if (inspect) {
    for (let coffin = 1; coffin <= 5; coffin++) {
      id(types.ObjType, `macro_digger_coffin_object_${coffin}`);
      checkCoffin(p, coffin);
      assert.equal(p.modalMain, id(types.Component, 'inter_383'), 'coffin Check opens native 377 coffin interface inter_383');
      p.closeModal();
    }
  }

  if (verifyWrongLayout) {
    for (let index = 0; index < 5; index++) {
      p.lastUseItem = id(types.ObjType, `macro_digger_coffin_object_${initial[index]}`);
      run(p, `[oplocu,${leoGraveNames[index]}]`, [], { loc: graves[index].loc });
    }
    const outfitBefore = leoOutfit.map(name => count(p, name));
    const emotesBefore = p.getVar(v('emote_access'));
    talkNpc1(p, gravedigger, 'Leo wrong-layout Talk');
    assert.equal(p.getVar(v('macro_event')), 19, 'a complete but incorrect arrangement keeps the event active');
    assert.deepEqual(leoOutfit.map(name => count(p, name)), outfitBefore, 'an incorrect arrangement awards no outfit');
    assert.equal(p.getVar(v('emote_access')), emotesBefore, 'an incorrect arrangement awards no emote');
    for (let index = 0; index < 5; index++) run(p, `[oploc1,${leoGraveNames[index]}]`, [], { loc: graves[index].loc });
  }

  for (let index = 0; index < 5; index++) {
    p.lastUseItem = id(types.ObjType, `macro_digger_coffin_object_${keys[index]}`);
    run(p, `[oplocu,${leoGraveNames[index]}]`, [], { loc: graves[index].loc });
  }
  if (relogAtCompletionModal) {
    const suspended = startNpc1(p, gravedigger, '[opnpc1,macro_gravedigger]');
    assert.equal(suspended.execution, ScriptState.PAUSEBUTTON, 'successful completion opens a real pausebutton modal');
    assert(p.modalChat >= 0, 'success text modal remains open before relog');
    p = reconnect(p);
    assert.equal(p.getVar(v('macro_event')), 19, 'relog at the completion modal preserves the live event');
    talkNpc1(p, gravedigger, 'Leo successful completion Talk after relog');
  } else {
    talkNpc1(p, gravedigger, 'Leo successful completion Talk');
  }
  return p;
}

export default function register() {
  check('Bob native NPC, OBJ net, fish clusters, pots and portal are bound to the packed island', () => {
    const p = player();
    startBob(p);
    const bob = npcAt('macro_evil_bob_island', 39, 74);
    npcAt('macro_evil_bob_male_servant', 39, 74);
    npcAt('macro_evil_bob_female_servant', 39, 74);
    const pots = nativeLocRows('uncooking_pot').filter(row => row.mx === 39 && row.mz === 74);
    assert.equal(pots.length, 2, 'both native uncooking pots are present');
    for (const row of pots) locFor(row);
    const portal = locAt('portal_8987', 39, 74);
    assert.equal(bobSpots.length, 16, 'the native island has sixteen fishing spots');
    for (const row of bobSpots) locFor(row);
    for (const [localX, localZ] of nativeNets) {
      const ground = World.getObj(39 * 64 + localX, 74 * 64 + localZ, 0, netType, p.hash64);
      assert(ground, `native OBJ section exposes the net at ${localX},${localZ}`);
      assert.equal(ground.type, netType);
    }
    assert.equal(count(p, 'evil_bob_net'), 0, 'the test does not seed the net into inventory');
    run(p, '[oploc1,portal_8987]', [], { loc: portal.loc });
    assert.equal(p.getVar(v('macro_event')), 0);
    assert.deepEqual(tile(p), origin);
    assert(bob.npc, 'the native Bob NPC is available to later gameplay roots');
  });

  check('Bob native Net option refuses no net and fishes with both packed small nets', () => {
    const p = player();
    startBob(p);
    const spotType = types.LocType.get(bobSpots[0].id);
    assert.equal(spotType.op[0], 'Net', 'the native fishing spot exposes its Net option');
    assert.equal(types.ObjType.get(standardNetType).name, 'Small fishing net',
      'the standard packed net display name is Small fishing net');
    assert.equal(types.ObjType.get(netType).name, 'Small fishing net',
      'the native island net display name is also Small fishing net');
    assert.notEqual(standardNetType, netType, 'the standard and island nets are distinct packed objects');

    const target = p.getVar(v('macro_transmit')) & 3;
    const correctSpot = bobSpots.find(row => bobDirection(row) === target);
    const wrongSpot = bobSpots.find(row => bobDirection(row) !== target);
    p.messages.length = 0;
    catchFish(p, correctSpot);
    assert.equal(count(p, 'evil_bob_cooked_fish_correct') + count(p, 'evil_bob_cooked_fish_incorrect'), 0,
      'OPLOC1 without a carried net catches no fish');
    assert(p.messages.some(packet => (packet.text ?? packet.msg ?? '').includes('You need a small fishing net.')),
      'OPLOC1 without a net gives the refusal');

    p.invAdd(inv, standardNetType, 1);
    catchFish(p, correctSpot);
    assert.equal(count(p, 'evil_bob_cooked_fish_correct'), 1, 'the standard packed small net catches at the required target');
    p.invDel(inv, id(types.ObjType, 'evil_bob_cooked_fish_correct'), 1);
    p.invDel(inv, standardNetType, 1);

    takeNativeNet(p);
    catchFish(p, wrongSpot);
    assert.equal(count(p, 'evil_bob_cooked_fish_incorrect'), 1, 'the native island net catches the wrong cluster');
    p.invDel(inv, id(types.ObjType, 'evil_bob_cooked_fish_incorrect'), 1);
    catchFishWithItem(p, correctSpot);
    assert.equal(count(p, 'evil_bob_cooked_fish_correct'), 1, 'OPLOCU shares the fishing routine with native OPLOC1');
  });

  check('Bob classifies all four native cardinal groups and takes the net through the real ground Take action', () => {
    const p = player();
    startBob(p);
    assert.equal(count(p, 'evil_bob_net'), 0, 'Bob entry does not inventory-seed a net');
    takeNativeNet(p);
    const target = p.getVar(v('macro_transmit')) & 3;
    const clue = ['Use the west fishing spots.', 'Use the north fishing spots.', 'Use the south fishing spots.', 'Use the east fishing spots.'][target];
    const female = npcAt('macro_evil_bob_female_servant', 39, 74).npc;
    p.messages.length = 0;
    startNpc1(p, female, '[opnpc1,macro_evil_bob_female_servant]');
    finishInteraction(p, 'Bob female servant Talk');
    assert(p.messages.some(packet => packet.constructor.name === 'IfSetText' && packet.text.includes(clue)), `female servant clue matches native cardinal direction ${target}`);
    p.messages.length = 0;
    const groups = [
      bobSpots.filter(row => row.localX === 14),
      bobSpots.filter(row => row.localZ === 55),
      bobSpots.filter(row => row.localZ === 28),
      bobSpots.filter(row => row.localX === 47)
    ];
    for (let direction = 0; direction < 4; direction++) assert.equal(groups[direction].length, 4, `native direction ${direction} has four spots`);
    for (let direction = 0; direction < 4; direction++) {
      for (const row of groups[direction]) {
        assert.equal(bobDirection(row), direction, `native spot ${row.localX},${row.localZ} maps to direction ${direction}`);
        catchFish(p, row);
        const correct = direction === target;
        assert.equal(count(p, correct ? 'evil_bob_cooked_fish_correct' : 'evil_bob_cooked_fish_incorrect'), 1);
        p.invDel(inv, id(types.ObjType, correct ? 'evil_bob_cooked_fish_correct' : 'evil_bob_cooked_fish_incorrect'), 1);
      }
    }
    const portal = locAt('portal_8987', 39, 74);
    run(p, '[oploc1,portal_8987]', [], { loc: portal.loc });
    assert.equal(count(p, 'evil_bob_net'), 0, 'portal cleanup removes the event net');
    assert.deepEqual(tile(p), origin);
  });

  check('Bob rejects cooked and wrong fish, retains progress on relog, then rewards Fishing once', () => {
    let p = player();
    startBob(p, PlayerStat.FISHING);
    takeNativeNet(p);
    const target = p.getVar(v('macro_transmit')) & 3;
    const correctSpot = bobSpots.find(row => bobDirection(row) === target);
    const wrongSpot = bobSpots.find(row => bobDirection(row) !== target);
    const pot = locAt('uncooking_pot', 39, 74).loc;
    const bob = npcAt('macro_evil_bob_island', 39, 74).npc;

    catchFish(p, wrongSpot);
    assert.equal(count(p, 'evil_bob_cooked_fish_incorrect'), 1);
    feedBob(p, bob, 'evil_bob_cooked_fish_incorrect');
    assert.equal(count(p, 'evil_bob_cooked_fish_incorrect'), 1, 'cooked fish remains after refusal');
    uncookFish(p, pot, 'evil_bob_cooked_fish_incorrect');
    assert.equal(count(p, 'evil_bob_uncooked_fish_incorrect'), 1);
    feedBob(p, bob, 'evil_bob_uncooked_fish_incorrect');
    assert.equal(count(p, 'evil_bob_uncooked_fish_incorrect'), 0);
    assert.equal((p.getVar(v('macro_transmit')) >>> 16) & 0x1fff, 3, 'wrong fish increases the required-feed count');
    const progress = p.getVar(v('macro_transmit'));
    p = reconnect(p);
    assert.equal(p.getVar(v('macro_transmit')), progress, 'native relog retains Bob progress');
    assert.equal(count(p, 'evil_bob_net'), 1, 'native relog retains the picked-up net');

    for (let feed = 0; feed < 3; feed++) {
      catchFish(p, correctSpot);
      uncookFish(p, pot, 'evil_bob_cooked_fish_correct');
      feedBob(p, bob, 'evil_bob_uncooked_fish_correct');
      if (feed < 2) assert.equal(p.getVar(v('macro_event')), 17);
    }
    assert.equal(p.getVar(v('macro_event')), 17, 'sleeping Bob leaves the earned portal exit available');
    run(p, '[opnpc1,macro_evil_bob_island]', [], { npc: bob });
    assert(p.messages.some(packet => packet.constructor.name === 'IfSetText' && packet.text.includes('Evil Bob is asleep.')), 'Bob confirms the completed sleep state');
    run(p, '[oploc1,portal_8987]', [], { loc: locAt('portal_8987', 39, 74).loc });
    assert.equal(p.getVar(v('macro_event')), 0);
    assert.deepEqual(tile(p), origin);
    assert.equal(p.stats[PlayerStat.FISHING], 6500);
    assert.equal(p.stats[PlayerStat.MAGIC], 0);
    assert.equal(count(p, 'evil_bob_net'), 0, 'successful return cleans up the event net');
    const fishingXp = p.stats[PlayerStat.FISHING];
    feedBob(p, bob, 'evil_bob_uncooked_fish_correct');
    assert.equal(p.stats[PlayerStat.FISHING], fishingXp, 'stale Bob interaction cannot repeat XP');
  });

  check('Bob Magic mode awards only the selected skill and portal return is repeat-safe', () => {
    const p = player();
    startBob(p, PlayerStat.MAGIC);
    takeNativeNet(p);
    const target = p.getVar(v('macro_transmit')) & 3;
    const correctSpot = bobSpots.find(row => bobDirection(row) === target);
    const pot = locAt('uncooking_pot', 39, 74).loc;
    const bob = npcAt('macro_evil_bob_island', 39, 74).npc;
    for (let feed = 0; feed < 2; feed++) {
      catchFish(p, correctSpot);
      uncookFish(p, pot, 'evil_bob_cooked_fish_correct');
      feedBob(p, bob, 'evil_bob_uncooked_fish_correct');
    }
    assert.equal(p.stats[PlayerStat.MAGIC], 6500);
    assert.equal(p.stats[PlayerStat.FISHING], 0);
    assert.equal(p.getVar(v('macro_event')), 17, 'Magic completion also waits for the portal');
    run(p, '[oploc1,portal_8987]', [], { loc: locAt('portal_8987', 39, 74).loc });
    assert.equal(p.getVar(v('macro_event')), 0);
    assert.deepEqual(tile(p), origin);
    assert.equal(count(p, 'evil_bob_net'), 0, 'the portal removes the Magic fixture net');
    feedBob(p, bob, 'evil_bob_uncooked_fish_correct');
    assert.equal(p.stats[PlayerStat.MAGIC], 6500);
  });


  check('Bob map-square exit releases progress and removes event-owned items without reward', () => {
    const p = player();
    startBob(p);
    const eventItems = [
      'evil_bob_net',
      'evil_bob_cooked_fish_correct',
      'evil_bob_cooked_fish_incorrect',
      'evil_bob_uncooked_fish_correct',
      'evil_bob_uncooked_fish_incorrect'
    ];
    for (const name of eventItems) p.invAdd(inv, id(types.ObjType, name), 1);
    position(p, ...origin);
    run(p, '[mapzoneexit,0_39_74]');
    assert.equal(p.getVar(v('macro_event')), 0);
    assert.equal(p.getVar(v('macro_event_uid')), -1);
    assert.equal(p.getVar(v('macro_event_origin_coord')), -1);
    assert.equal(p.getVar(v('macro_event_target_coord')), -1);
    assert.equal(p.getVar(v('macro_transmit')), 0);
    for (const name of eventItems) assert.equal(count(p, name), 0, `${name} is removed on escape`);
    assert.equal(p.stats[PlayerStat.FISHING], 0);
    assert.equal(p.stats[PlayerStat.MAGIC], 0);
    assert.equal(p.tabs[3], id(types.Component, 'inventory'));
  });
  check('Leo native graves/headstones, item-model inspection, wrong-layout failure, relog at completion modal and successful return', () => {
    let p = player();
    const result = solveLeo(p, { inspect: true, reconnectAfterTwo: true, verifyWrongLayout: true, relogAtCompletionModal: true });
    p = result;
    assert.equal(p.getVar(v('macro_event')), 0);
    assert.deepEqual(tile(p), origin);
    assert.equal(count(p, 'macro_digger_shirt'), 1, 'the first missing outfit reward is unique');
    assert.equal(p.getVar(v('emote_access')), 0, 'the first outfit reward does not skip ahead to emotes');
    assert.equal(count(p, 'macro_digger_coffin_object_1') + count(p, 'macro_digger_coffin_object_2') + count(p, 'macro_digger_coffin_object_3') + count(p, 'macro_digger_coffin_object_4') + count(p, 'macro_digger_coffin_object_5'), 0, 'Leo cleanup removes all event coffins');
    for (const name of leoGraveNames) locFor(locAt(name, 30, 78).row);
    for (const name of leoStoneNames) locFor(locAt(name, 30, 78).row);
    locFor(locAt('mausoleum', 30, 78).row);
    talkNpc1(p, npcAt('macro_gravedigger', 30, 78).npc, 'Leo stale completion Talk');
    assert.equal(count(p, 'macro_digger_shirt'), 1, 'stale completion cannot repeat the outfit reward');
  });

  check('Leo restores several deleted carried coffins on Talk without resetting progress or duplicating items', () => {
    let p = player();
    run(p, '[proc,macro_leo_start]');
    const npc = npcAt('macro_gravedigger', 30, 78).npc;
    const graves = leoGraveNames.map(name => ({ loc: locAt(name, 30, 78).loc }));
    const initial = leoInitialGraves(p);
    const clues = leoKeys(p);
    const groups = leoCoffinGroups(p);
    const nameBits = p.getVar(v('macro_digger_var_2')) >>> 11;
    const taken = [initial[0], initial[1]];

    takeLeoGrave(p, graves, 0);
    takeLeoGrave(p, graves, 1);
    assert.deepEqual(leoCounters(p), [2, 2], 'native Take packets mark two carried coffins');
    talkNpc1(p, npc, 'Leo Talk with carried coffins');
    assert.deepEqual(leoCoffinTotals(p), [1, 1, 1, 1, 1], 'Talk does not duplicate an inventory or grave coffin');
    assert.deepEqual(leoCounters(p), [2, 2], 'Talk preserves valid carried-coffin counters');
    for (const coffin of taken) {
      assert.equal(count(p, `macro_digger_coffin_object_${coffin}`), 1, 'carried coffins remain in inventory');
      p.invDel(inv, id(types.ObjType, `macro_digger_coffin_object_${coffin}`), 1);
    }
    assert.deepEqual(leoCoffinTotals(p).sort((a, b) => a - b), [0, 0, 1, 1, 1],
      'the fixture deletes two carried coffins without changing the grave records');
    const beforeRecoveryGraves = leoInitialGraves(p);

    talkNpc1(p, npc, 'Leo Talk after coffin loss');
    assert.deepEqual(leoCoffinTotals(p), [1, 1, 1, 1, 1], 'Talk restores both missing coffins to empty graves');
    assert.deepEqual(leoCarried(p), [0, 0, 0, 0, 0], 'restored coffins are no longer marked carried');
    assert.deepEqual(leoCounters(p), [0, 0], 'recovery repairs both carried-coffin counters');
    assert.deepEqual(leoKeys(p), clues, 'recovery preserves the headstone clue mapping');
    assert.deepEqual(leoCoffinGroups(p), groups, 'recovery preserves the coffin group mapping');
    assert.equal(p.getVar(v('macro_digger_var_2')) >>> 11, nameBits, 'recovery preserves other Leo progress bits');
    for (let index = 0; index < 5; index++) {
      if (beforeRecoveryGraves[index] !== 0) {
        assert.equal(leoInitialGraves(p)[index], beforeRecoveryGraves[index], 'recovery leaves every existing grave coffin in place');
      }
    }
    assert.equal(leoOutfit.reduce((total, name) => total + count(p, name), 0), 0, 'recovery Talk gives no clothing reward');
    assert.equal(p.getVar(v('emote_access')), 0, 'recovery Talk gives no emote reward');

    const recoveredState = ['macro_digger_var', 'macro_digger_var_2', 'macro_digger_var_3', 'macro_digger_var_4']
      .map(name => p.getVar(v(name)));
    talkNpc1(p, npc, 'Leo repeated Talk after recovery');
    assert.deepEqual(['macro_digger_var', 'macro_digger_var_2', 'macro_digger_var_3', 'macro_digger_var_4']
      .map(name => p.getVar(v(name))), recoveredState, 'repeated Talk is idempotent');
    assert.deepEqual(leoCoffinTotals(p), [1, 1, 1, 1, 1], 'repeated Talk does not duplicate recovered coffins');

    const keys = leoKeys(p);
    for (let index = 0; index < 5; index++) takeLeoGrave(p, graves, index);
    for (let index = 0; index < 5; index++) {
      p.lastUseItem = id(types.ObjType, `macro_digger_coffin_object_${keys[index]}`);
      run(p, `[oplocu,${leoGraveNames[index]}]`, [], { loc: graves[index].loc });
    }
    talkNpc1(p, npc, 'Leo Talk after recovered puzzle completion');
    assert.equal(p.getVar(v('macro_event')), 0, 'the recovered puzzle completes through Leo Talk');
    assert.deepEqual(tile(p), origin, 'Leo returns the recovered player to the saved origin');
    assert.equal(count(p, 'macro_digger_shirt'), 1, 'successful recovery preserves the normal first clothing reward');
    assert.equal(count(p, 'macro_digger_boots'), 1, 'successful recovery awards the paired boots');
    assert.equal(count(p, 'coins'), 0, 'recovery does not skip to the fallback reward');
  });

  check('Leo reward progression awards clothing pairs, then both emotes, then the UNKNOWN fallback', () => {
    const p = player();
    const reward = () => run(p, '[proc,macro_leo_reward]');
    reward();
    assert.deepEqual(leoOutfit.map(name => leoOwns(p, name)), [1, 1, 0, 0, 0], 'first completion awards Shirt and Boots');
    assert.equal(p.getVar(v('emote_access')), 0);
    assert.equal(count(p, 'coins'), 0);
    reward();
    assert.deepEqual(leoOutfit.map(name => leoOwns(p, name)), [1, 1, 1, 1, 0], 'second completion awards Pants and Gloves');
    assert.equal(p.getVar(v('emote_access')), 0);
    assert.equal(count(p, 'coins'), 0);
    reward();
    assert.deepEqual(leoOutfit.map(name => leoOwns(p, name)), [1, 1, 1, 1, 1], 'third completion awards the Mask');
    assert.equal(p.getVar(v('emote_access')), 0);
    assert.equal(count(p, 'coins'), 0);
    reward();
    assert.equal(p.getVar(v('emote_access')) & (1 << 5), 1 << 5, 'fourth completion unlocks Zombie Dance');
    assert.equal(p.getVar(v('emote_access')) & (1 << 6), 0, 'Zombie Walk remains locked until the next completion');
    assert.equal(count(p, 'coins'), 0);
    reward();
    assert.equal(p.getVar(v('emote_access')) & (1 << 5), 1 << 5);
    assert.equal(p.getVar(v('emote_access')) & (1 << 6), 1 << 6, 'fifth completion unlocks Zombie Walk');
    assert.equal(count(p, 'coins'), 0, 'fallback coins wait for all five clothes and both emotes');
    reward();
    assert.equal(count(p, 'coins'), 500, 'sixth completion uses the existing UNKNOWN 500-coin fallback');
    reward();
    assert.equal(count(p, 'coins'), 1000, 'later completions retain the same fallback after all seven rewards');
  });

  check('Leo skips owned clothing in inventory, worn and bank without duplicates', () => {
    const p = player();
    p.invAdd(bank, id(types.ObjType, 'macro_digger_shirt'), 1);
    p.invAdd(worn, id(types.ObjType, 'macro_digger_legs'), 1);
    const reward = () => run(p, '[proc,macro_leo_reward]');
    reward();
    assert.deepEqual(leoOutfit.map(name => leoOwns(p, name)), [1, 1, 1, 0, 0],
      'partial first and second pairs award only their missing pieces');
    assert.equal(count(p, 'macro_digger_shirt'), 0, 'banked Shirt is not duplicated into inventory');
    assert.equal(count(p, 'macro_digger_boots'), 1, 'missing Boots are awarded');
    assert.equal(count(p, 'macro_digger_legs', worn), 1, 'worn Pants remain owned');
    assert.equal(count(p, 'macro_digger_gloves'), 0, 'the second pair advances on its next completion');
    reward();
    assert.equal(leoOwns(p, 'macro_digger_gloves'), 1, 'missing Gloves are awarded after the partial first reward');
    assert.equal(leoOwns(p, 'macro_digger_legs'), 1, 'worn Pants are not duplicated');
    assert.equal(leoOwns(p, 'macro_digger_shirt'), 1, 'banked Shirt is not duplicated');
    assert.equal(count(p, 'coins'), 0, 'owned-piece skipping does not advance past missing clothes');
    reward();
    assert.equal(leoOwns(p, 'macro_digger_mask'), 1, 'Mask remains the final clothing piece');
    reward();
    reward();
    assert.equal(count(p, 'coins'), 0, 'emotes precede fallback coins when clothing was partly owned');
    reward();
    assert.equal(count(p, 'coins'), 500, 'fallback starts only after the full outfit and both emotes');
  });
}
