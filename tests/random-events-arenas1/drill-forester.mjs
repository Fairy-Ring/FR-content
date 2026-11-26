import { pathToFileURL } from 'node:url';
import {
  assert, check, player, run, give, count, reconnect, v, id, types, World,
  tile, origin, PlayerStat, nativeNpcRows, nativeLocRows, locFor, packed,
  engine, ScriptState, ResumePauseButtonHandler, ResumePauseButton
} from './runtime.mjs';

const load = async rel => (await import(pathToFileURL(`${engine}/src/${rel}`).href)).default;
const [OpNpcHandler, OpNpc] = await Promise.all([
  load('network/game/client/handler/OpNpcHandler.ts'),
  load('network/game/client/model/OpNpc.ts')
]);
const { NpcStat } = await import(pathToFileURL(`${engine}/src/engine/entity/NpcStat.ts`).href);
const rsbuf = await import(pathToFileURL(`${engine}/src/network/rsbuf/index.js`).href);
const { map } = await import('../regicide-travel/runtime.mjs');
const npcHandler = new OpNpcHandler();
const resumeHandler = new ResumePauseButtonHandler();

const DRILL_EVENT = 16;
const FORESTER_EVENT = 18;
const DRILL_MATS = ['exercise_mat', 'exercise_mat_10077', 'exercise_mat_10078', 'exercise_mat_10079'];
const EXERCISE_ANIMS = ['emote_run_on_spot', 'emote_situps_5', 'emote_pushups_5', 'emote_starjump_5'];
const EXERCISE_LABELS = ['jogging in place', 'sit-ups', 'push-ups', 'star jumps'];
const PHEASANTS = ['macro_pheasant_onetail', 'macro_pheasant_twotail', 'macro_pheasant_threetail', 'macro_pheasant_fourtail'];
const DRILL_OUTFIT = ['drill_top', 'drill_bottoms', 'drill_helm'];
const FORESTER_OUTFIT = ['laderhosen_top', 'laderhosen_legs', 'laderhosen_hat'];

function bits(word, start, width = 1) {
  return ((word >>> start) & ((1 << width) - 1)) >>> 0;
}
function total(p, names) { return names.reduce((sum, name) => sum + count(p, name), 0); }
function nativeNpc(name, mx, mz) {
  const row = nativeNpcRows(name).find(candidate => candidate.mx === mx && candidate.mz === mz);
  assert(row, `native NPC row exists: ${name} m${mx}_${mz}`);
  const npc = [...World.npcs].find(candidate => candidate && candidate.type === row.id && candidate.level === row.level
    && Math.floor(candidate.x / 64) === mx && Math.floor(candidate.z / 64) === mz);
  assert(npc, `packed NPC is loaded: ${name} ${row.coord}`);
  return { row, npc };
}
function nativeLoc(name, mx, mz) {
  const row = nativeLocRows(name).find(candidate => candidate.mx === mx && candidate.mz === mz);
  assert(row, `native LOC row exists: ${name} m${mx}_${mz}`);
  return { row, loc: locFor(row) };
}
function startDrill(p) {
  run(p, '[proc,macro_drill_start]');
  assert.equal(p.getVar(v('macro_event')), DRILL_EVENT);
}
function startForester(p) {
  run(p, '[proc,macro_forester_start]');
  assert.equal(p.getVar(v('macro_event')), FORESTER_EVENT);
}
function drillState(p) {
  const word = p.getVar(v('macro_transmit')) >>> 0;
  return {
    word,
    target: bits(word, 8, 2),
    signs: [0, 1, 2, 3].map(index => bits(word, index * 2, 2)),
    remaining: bits(word, 10, 20),
    wrong: bits(word, 30)
  };
}
function useDrillMat(p, index) {
  const name = DRILL_MATS[index];
  const { loc } = nativeLoc(name, 49, 75);
  run(p, `[oploc1,${name}]`, [], { loc });
}
function solveDrill(p, limit = 8) {
  let actions = 0;
  while (p.getVar(v('macro_event')) === DRILL_EVENT && actions < limit) {
    const state = drillState(p);
    const index = state.signs.findIndex(sign => sign === state.target);
    assert.notEqual(index, -1, `requested exercise ${state.target} is shown on one native mat`);
    useDrillMat(p, index);
    actions++;
  }
  assert.equal(p.getVar(v('macro_event')), 0, 'completed Drill task returns through the saved-origin lifecycle');
  assert.deepEqual(tile(p), origin, 'Drill completion restores the saved origin');
  return actions;
}
function startForesterAtNpc(p) {
  startForester(p);
  return nativeNpc('macro_forester_m', 40, 74).npc;
}
function submitForesterItem(p, forester, name) {
  p.lastUseItem = id(types.ObjType, name);
  run(p, '[opnpcu,macro_forester_m]', [], { npc: forester });
}
function finishForesterAtPortal(p) {
  const { loc } = nativeLoc('portal_8972', 40, 74);
  run(p, '[oploc1,portal_8972]', [], { loc });
  assert.equal(p.getVar(v('macro_event')), 0, 'Forester portal returns through the shared lifecycle');
  assert.deepEqual(tile(p), origin, 'Forester portal restores the saved origin');
}
function npcStand(p, npc, radius = 8) {
  const saved = [p.level, p.x, p.z];
  for (let distance = 1; distance <= radius; distance++) {
    for (let x = npc.x - distance; x <= npc.x + (npc.width ?? 1) + distance - 1; x++) {
      for (let z = npc.z - distance; z <= npc.z + (npc.length ?? 1) + distance - 1; z++) {
        if (map.isMapBlocked(x, z, npc.level)) continue;
        p.level = npc.level; p.x = x; p.z = z;
        if (p.inOperableDistance(npc)) {
          p.level = saved[0]; p.x = saved[1]; p.z = saved[2];
          return { level: npc.level, x, z };
        }
      }
    }
  }
  p.level = saved[0]; p.x = saved[1]; p.z = saved[2];
  return null;
}
function position(p, level, x, z) {
  p.level = level; p.x = x; p.z = z;
  p.originX = x; p.originZ = z;
  p.buildArea.originX = Math.floor(x / 8) * 8;
  p.buildArea.originZ = Math.floor(z / 8) * 8;
  p.clearInteraction();
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
  rsbuf.computeNpc(npc.x, npc.level, npc.z, npc.nid, npc.type, npc.tele, npc.jump, npc.runDir,
    npc.walkDir, npc.isActive, npc.masks, npc.faceEntity, npc.faceSquareX, npc.faceSquareZ,
    npc.faceAngleX, npc.faceAngleZ, npc.hitmarkDamage, npc.hitmarkType, npc.hitmark2Damage,
    npc.hitmark2Type, npc.levels[NpcStat.HITPOINTS], npc.baseLevels[NpcStat.HITPOINTS],
    npc.animId, npc.animDelay, npc.sayMessage, npc.spotanimId, npc.spotanimHeight, npc.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, npc.nid), 'production NPC visibility encoder exposes the packed pheasant');
}
function finishInteraction(p, label) {
  for (let step = 0; step < 80; step++) {
    const state = p.activeScript;
    if (!state || state.execution === ScriptState.FINISHED) return;
    assert.notEqual(state.execution, ScriptState.ABORTED, `${label} does not abort`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      assert(resumeHandler.handle(new ResumePauseButton(0), p), `${label} resumes its page`);
    } else if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else {
      assert.fail(`${label} stopped at execution state ${state.execution}`);
    }
  }
  assert(!p.activeScript || p.activeScript.execution === ScriptState.FINISHED, `${label} finishes within the bound`);
}

export default function register() {
  check('Drill and Forester roots bind to native map rows', () => {
    const p = player();
    startDrill(p);
    assert(nativeNpcRows('macro_drilldemon').some(row => row.mx === 49 && row.mz === 75), 'Drill Demon is a native arena NPC');
    for (const name of DRILL_MATS) {
      assert(nativeLocRows(name).some(row => row.mx === 49 && row.mz === 75), `${name} is a native exercise mat`);
      assert(packed(`[oploc1,${name}]`), `${name} has its packed gameplay root`);
    }
    assert(packed('[opnpc1,macro_drilldemon]'), 'Drill Demon status root is packed');
    run(p, '[proc,macro_arena1_return]', [DRILL_EVENT]);

    const q = player();
    startForester(q);
    assert(nativeNpcRows('macro_forester_m').some(row => row.mx === 40 && row.mz === 74), 'Forester is a native arena NPC');
    assert(nativeLocRows('portal_8972').some(row => row.mx === 40 && row.mz === 74), 'Forester return portal is native');
    for (const name of PHEASANTS) {
      assert(nativeNpcRows(name).some(row => row.mx === 40 && row.mz === 74), `${name} has a native arena spawn`);
      assert(packed(`[opnpc2,${name}]`), `${name} has a packed OPNPC2 root`);
      assert(packed(`[apnpc2,${name}]`), `${name} has a packed APNPC2 root`);
    }
    assert(packed('[opnpcu,macro_forester_m]'), 'Forester item hand-in root is packed');
    assert(packed('[oploc1,portal_8972]'), 'Forester portal root is packed');
    run(q, '[oploc1,portal_8972]', [], { loc: nativeLoc('portal_8972', 40, 74).loc });
  });

  check('Drill native sign codes bind all four poses and client-cycle delays', () => {
    const p = player();
    startDrill(p);
    for (const [code, animation] of EXERCISE_ANIMS.entries()) {
      const state = drillState(p);
      const messagesBefore = p.messages.length;
      run(p, '[proc,macro_drill_status]');
      assert(p.messages.some((packet, index) => index >= messagesBefore && typeof packet.text === 'string'
        && packet.text.includes(EXERCISE_LABELS[state.target])), 'order text names the original native sign');
      const name = DRILL_MATS[state.signs.indexOf(code)];
      const { loc } = nativeLoc(name, 49, 75);
      const seq = types.SeqType.get(id(types.SeqType, animation));
      assert.equal(seq.loops, -1, 'original exercise sequence has no repeat loop');
      const started = World.currentTick;
      const exercise = run(p, `[oploc1,${name}]`, [], { loc, resume: false });
      assert.equal(exercise.execution, ScriptState.SUSPENDED);
      assert.equal(p.animId, seq.id, `native sign ${code} selects its matching exercise pose`);
      assert.equal(p.delayedUntil - started, Math.ceil(seq.duration / 30) + 1,
        'player delay converts client cycles and preserves the native extra scheduling tick');
      finishInteraction(p, `native sign ${code}`);
    }
    if (p.getVar(v('macro_event')) === DRILL_EVENT) run(p, '[proc,macro_arena1_return]', [DRILL_EVENT]);
  });

  check('Drill wrong mat penalizes progress and animation follows its shuffled sign', () => {
    const p = player();
    give(p, 'drill_top');
    give(p, 'drill_bottoms');
    startDrill(p);
    const before = drillState(p);
    const wrongMat = before.signs.findIndex(sign => sign !== before.target);
    assert.notEqual(wrongMat, -1, 'a shuffled mat differs from the requested exercise');
    const shown = before.signs[wrongMat];
    useDrillMat(p, wrongMat);
    assert.equal(p.animId, id(types.SeqType, EXERCISE_ANIMS[shown]), 'exercise pose matches the displayed sign, not the mat slot');
    const after = drillState(p);
    assert.equal(after.remaining, 5, 'wrong mat adds one correct exercise to the task');
    assert.equal(after.wrong, 1, 'wrong mat disables the timely bonus');
    solveDrill(p);
    assert.deepEqual(DRILL_OUTFIT.map(name => count(p, name)), [1, 1, 1], 'owned pieces are preserved and exactly the missing piece is granted');
    assert.equal(count(p, 'coins'), 0, 'wrong mat grants no bonus or fallback coins');
    assert.equal(p.getVar(v('macro_digger_var_4')), 0, 'shared lifecycle cleanup clears the borrowed PERM clock word');
  });

  check('Drill clean completion grants distinct pieces and the full-set coin fallback', () => {
    const p = player();
    startDrill(p);
    solveDrill(p);
    assert(total(p, DRILL_OUTFIT) >= 1 && total(p, DRILL_OUTFIT) <= 3, 'clean completion grants one to three distinct missing pieces');
    assert(DRILL_OUTFIT.every(name => count(p, name) <= 1), 'clean completion never duplicates a camouflage piece');
    assert.equal(count(p, 'coins'), 0, 'an incomplete set receives clothes, not fallback coins');

    const full = player();
    for (const name of DRILL_OUTFIT) give(full, name);
    startDrill(full);
    solveDrill(full);
    assert.deepEqual(DRILL_OUTFIT.map(name => count(full, name)), [1, 1, 1], 'the existing full set remains unique');
    assert.equal(count(full, 'coins'), 500, 'complete set uses the CANDIDATE 500-coin fallback exactly once');
  });

  check('Drill admission clock survives relog and expires the bonus without forcing exit', () => {
    let p = player();
    startDrill(p);
    const admittedAt = p.getVar(v('macro_digger_var_4'));
    p = reconnect(p);
    assert.equal(p.getVar(v('macro_event')), DRILL_EVENT, 'native relog retains the active Drill encounter');
    assert.equal(p.getVar(v('macro_digger_var_4')), admittedAt, 'PERM admission clock survives save/load');
    World.currentTick += 101;
    assert.equal(p.getVar(v('macro_event')), DRILL_EVENT, 'expired bonus does not force an arena exit');
    assert.equal(total(p, DRILL_OUTFIT), 0, 'expiry itself grants no reward');
    solveDrill(p);
    assert.equal(total(p, DRILL_OUTFIT), 1, 'late completion grants only one missing piece');
    assert.equal(count(p, 'coins'), 0, 'late incomplete set does not receive fallback coins');
    assert.equal(p.getVar(v('macro_digger_var_4')), 0, 'successful cleanup clears the borrowed timestamp');
  });

  check('Forester correct hand-in returns one missing outfit piece; full set falls back once', () => {
    const p = player();
    const forester = startForesterAtNpc(p);
    give(p, 'raw_macro_pheasant_good');
    submitForesterItem(p, forester, 'raw_macro_pheasant_good');
    assert.equal(count(p, 'raw_macro_pheasant_good'), 0, 'correct carcass is consumed');
    assert.equal(bits(p.getVar(v('macro_transmit')) >>> 0, 2), 1, 'correct carcass marks the requested task complete');
    finishForesterAtPortal(p);
    assert.equal(total(p, FORESTER_OUTFIT), 1, 'Forester grants one unique missing piece');
    assert.equal(count(p, 'coins'), 0);

    const full = player();
    const fullForester = startForesterAtNpc(full);
    for (const name of FORESTER_OUTFIT) give(full, name);
    give(full, 'raw_macro_pheasant_good');
    submitForesterItem(full, fullForester, 'raw_macro_pheasant_good');
    finishForesterAtPortal(full);
    assert.deepEqual(FORESTER_OUTFIT.map(name => count(full, name)), [1, 1, 1], 'existing lederhosen pieces remain unique');
    assert.equal(count(full, 'coins'), 500, 'complete outfit uses the UNKNOWN 500-coin fallback once');
  });

  check('Forester wrong carcass fails and cleans the encounter without reward', () => {
    const p = player();
    const forester = startForesterAtNpc(p);
    give(p, 'raw_macro_pheasant_bad');
    submitForesterItem(p, forester, 'raw_macro_pheasant_bad');
    assert.equal(p.getVar(v('macro_event')), 0, 'wrong carcass exits through the failure lifecycle');
    assert.equal(count(p, 'raw_macro_pheasant_bad'), 0, 'failure cleanup removes the event carcass');
    assert.equal(total(p, FORESTER_OUTFIT), 0);
    assert.equal(count(p, 'coins'), 0);
  });

  check('Forester low-Strength Attack menu kills the native requested pheasant and drops owned carcass', () => {
    const p = player();
    startForester(p);
    const targetTail = bits(p.getVar(v('macro_transmit')) >>> 0, 0, 2);
    const targetName = PHEASANTS[targetTail];
    const { npc } = nativeNpc(targetName, 40, 74);
    assert.equal(npc.levels[NpcStat.HITPOINTS], 5, 'native pheasant has five hitpoints');
    p.baseLevels[PlayerStat.STRENGTH] = 1;
    p.levels[PlayerStat.STRENGTH] = 1;
    const combatSkills = [PlayerStat.ATTACK, PlayerStat.STRENGTH, PlayerStat.DEFENCE, PlayerStat.HITPOINTS, PlayerStat.RANGED, PlayerStat.MAGIC];
    const xpBefore = combatSkills.map(skill => p.stats[skill]);
    const drop = { level: npc.level, x: npc.x, z: npc.z };
    const stand = npcStand(p, npc);
    assert(stand, 'a collision-safe adjacent tile exists for the real menu attack');
    position(p, stand.level, stand.x, stand.z);
    showNpc(p, npc);
    assert.equal(World.getPlayerByHash64(p.hash64), p, 'native hero lookup resolves the registered fixture player');
    assert(npcHandler.handle(new OpNpc(2, npc.nid), p), 'production OpNpcHandler accepts the real Attack option');
    assert.equal(p.getApTrigger(), packed(`[apnpc2,${targetName}]`), 'Attack selects the actual APNPC2 root');
    p.processInteraction();
    finishInteraction(p, 'native pheasant Attack');
    assert.equal(npc.levels[NpcStat.HITPOINTS], 0, 'one fixed five-damage Attack kills the bird');
    assert.equal(npc.heroPoints.findHero(), p.hash64, 'the real Attack credits its player as the pheasant hero');

    const carcass = id(types.ObjType, 'raw_macro_pheasant_good');
    let ownedDrop = null;
    for (let tick = 0; tick < 160 && !ownedDrop; tick++) {
      ownedDrop = World.getObj(drop.x, drop.z, drop.level, carcass, p.hash64);
      if (ownedDrop) break;
      World.currentTick++;
      if (npc.isActive) npc.turn();
      p.processQueues();
    }
    assert(ownedDrop, 'death queue drops the requested good carcass privately to its player');
    assert.deepEqual(combatSkills.map(skill => p.stats[skill]), xpBefore, 'pheasant Attack grants no combat experience');
  });
}
