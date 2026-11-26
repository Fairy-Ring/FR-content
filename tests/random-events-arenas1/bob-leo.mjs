import { pathToFileURL } from 'node:url';
import { assert, check, player, run, count, reconnect, v, id, types, World, inv, tile, origin, PlayerStat, nativeNpcRows, nativeLocRows, locFor, engine, ScriptState, ResumePauseButtonHandler, ResumePauseButton } from './runtime.mjs';

const load = async rel => (await import(pathToFileURL(`${engine}/src/${rel}`).href)).default;
const OpObjHandler = await load('network/game/client/handler/OpObjHandler.ts');
const OpObj = await load('network/game/client/model/OpObj.ts');
const groundAction = new OpObjHandler();
const bank = id(types.InvType, 'bank');
const netType = id(types.ObjType, 'evil_bob_net');
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
  p.lastUseItem = netType;
  run(p, '[oplocu,fishing_spot_8986]', [], { loc: locFor(row) });
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
const leoOutfit = ['macro_digger_shirt', 'macro_digger_legs', 'macro_digger_mask', 'macro_digger_gloves', 'macro_digger_boots'];
function field(word, start, width) { return (word >>> start) & ((1 << width) - 1); }
function leoKeys(p) {
  const word = p.getVar(v('macro_digger_var_3'));
  return Array.from({ length: 5 }, (_, index) => field(word, 1 + 3 * index, 3));
}
function leoInitialGraves(p) {
  const word = p.getVar(v('macro_digger_var'));
  return Array.from({ length: 5 }, (_, index) => field(word, 1 + 3 * index, 3));
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
    for (let index = 0; index < stones.length; index++) {
      run(p, `[oploc1,${leoStoneNames[index]}]`, [], { loc: stones[index].loc });
    }
    const mausoleum = locAt('mausoleum', 30, 78).loc;
    run(p, '[oploc1,mausoleum]', [], { loc: mausoleum });
    if (p.modalMain >= 0) p.closeModal();
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
      run(p, `[opobj1,macro_digger_coffin_object_${coffin}]`);
    }
  }

  if (verifyWrongLayout) {
    for (let index = 0; index < 5; index++) {
      p.lastUseItem = id(types.ObjType, `macro_digger_coffin_object_${initial[index]}`);
      run(p, `[oplocu,${leoGraveNames[index]}]`, [], { loc: graves[index].loc });
    }
    const outfitBefore = leoOutfit.map(name => count(p, name));
    const emotesBefore = p.getVar(v('emote_access'));
    run(p, '[opnpc1,macro_gravedigger]', [], { npc: gravedigger });
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
    const suspended = run(p, '[opnpc1,macro_gravedigger]', [], { npc: gravedigger, resume: false });
    assert.equal(suspended.execution, ScriptState.PAUSEBUTTON, 'successful completion opens a real pausebutton modal');
    assert(p.modalChat >= 0, 'success text modal remains open before relog');
    p = reconnect(p);
    assert.equal(p.getVar(v('macro_event')), 19, 'relog at the completion modal preserves the live event');
    run(p, '[opnpc1,macro_gravedigger]', [], { npc: gravedigger });
  } else {
    run(p, '[opnpc1,macro_gravedigger]', [], { npc: gravedigger });
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

  check('Bob classifies all four native cardinal groups and takes the net through the real ground Take action', () => {
    const p = player();
    startBob(p);
    assert.equal(count(p, 'evil_bob_net'), 0, 'Bob entry does not inventory-seed a net');
    takeNativeNet(p);
    const target = p.getVar(v('macro_transmit')) & 3;
    const clue = ['Use the west fishing spots.', 'Use the north fishing spots.', 'Use the south fishing spots.', 'Use the east fishing spots.'][target];
    const female = npcAt('macro_evil_bob_female_servant', 39, 74).npc;
    p.messages.length = 0;
    run(p, '[opnpc1,macro_evil_bob_female_servant]', [], { npc: female });
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
    run(p, '[opnpc1,macro_gravedigger]', [], { npc: npcAt('macro_gravedigger', 30, 78).npc });
    assert.equal(count(p, 'macro_digger_shirt'), 1, 'stale completion cannot repeat the outfit reward');
  });

  check('Leo rewards missing clothing before original emote bits, then uses the UNKNOWN 500-coin fallback', () => {
    const p = player();
    for (const name of leoOutfit) p.invAdd(bank, id(types.ObjType, name), 1);
    solveLeo(p);
    assert.equal(p.getVar(v('emote_access')) & (1 << 5), 1 << 5, 'first missing emote sets the original Zombie Dance bit');
    assert.equal(p.getVar(v('emote_access')) & (1 << 6), 0, 'one completion unlocks only one reward');
    assert.equal(count(p, 'coins'), 0);
    solveLeo(p);
    assert.equal(p.getVar(v('emote_access')) & (1 << 6), 1 << 6, 'next completion sets the original Zombie Walk bit');
    assert.equal(count(p, 'coins'), 0);
    solveLeo(p);
    assert.equal(count(p, 'coins'), 500, 'cash fallback occurs only when all five outfits and both emotes are owned/unlocked');
  });
}
