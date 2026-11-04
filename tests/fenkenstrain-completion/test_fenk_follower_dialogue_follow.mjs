/**
 * Regression: owned gardener must resume PLAYERFOLLOW after completed dialogue.
 *
 * Live defect: ~chatnpc sets npc_setmode(playerfaceclose) before each Continue.
 * following_talk / shared name then returned without restoring playerfollow, so
 * Npc.processMovementInteraction/playerFaceCloseMode resetDefaults when the
 * player walked away. This file runs compiled production handlers through the
 * real interpreter (final Continue is not optional) and then real Npc movement.
 *
 * Prerequisites: server script.dat/npc.dat and client font packs under the
 * selected engine's data/pack; HARNESS_ENGINE_DIR overrides the default.
 *
 * Invoke from sibling engine/:
 *   node --import tsx ../content/tests/fenkenstrain-completion/test_fenk_follower_dialogue_follow.mjs
 *
 * Not a live client proof. Does not write shared packs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const ISO_ENGINE = process.env.HARNESS_ENGINE_DIR ?? path.resolve(WT, '../engine');
const PACK_DIR = path.join(ISO_ENGINE, 'data/pack');
const SCRIPT_DAT = path.join(PACK_DIR, 'server/script.dat');
const NPC_DAT = path.join(PACK_DIR, 'server/npc.dat');

function fail(msg) {
  console.error('FAIL', msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log('OK', msg);
}

function assert(cond, msg) {
  if (!cond) {
    fail(msg);
    throw new Error(msg);
  }
}

if (!fs.existsSync(SCRIPT_DAT)) {
  fail(`missing server script.dat at ${SCRIPT_DAT}`);
  process.exit(1);
}
if (!fs.existsSync(NPC_DAT)) {
  fail(`missing server npc.dat at ${NPC_DAT}`);
  process.exit(1);
}

const eng = (rel) => import(pathToFileURL(path.join(ISO_ENGINE, rel)).href);

const WorldMod = await eng('src/engine/World.ts');
const World = WorldMod.default;
const { allocateIfAbsent, canTravel, CollisionType } = await eng('src/engine/routefinder/index.ts');
const { default: VarPlayerType } = await eng('src/cache/config/VarPlayerType.ts');
const { default: VarNpcType } = await eng('src/cache/config/VarNpcType.ts');
const { default: VarBitType } = await eng('src/cache/config/VarBitType.ts');
const { default: InvType } = await eng('src/cache/config/InvType.ts');
const { default: ObjType } = await eng('src/cache/config/ObjType.ts');
const { default: FontType } = await eng('src/cache/config/FontType.ts');
const { default: Component } = await eng('src/cache/config/Component.ts');
const { default: NpcType } = await eng('src/cache/config/NpcType.ts');
const { default: ScriptProvider } = await eng('src/engine/script/ScriptProvider.ts');
const { default: ScriptRunner } = await eng('src/engine/script/ScriptRunner.ts');
const { default: ScriptState } = await eng('src/engine/script/ScriptState.ts');
const { default: Player } = await eng('src/engine/entity/Player.ts');
const { default: Npc } = await eng('src/engine/entity/Npc.ts');
const { NpcMode } = await eng('src/engine/entity/NpcMode.ts');
const { MoveRestrict } = await eng('src/engine/entity/MoveRestrict.js');
const { MoveSpeed } = await eng('src/engine/entity/MoveSpeed.js');
const { BlockWalk } = await eng('src/engine/entity/BlockWalk.js');
const { EntityLifeCycle } = await eng('src/engine/entity/EntityLifeCycle.js');
const { Interaction } = await eng('src/engine/entity/Interaction.ts');

VarPlayerType.load(PACK_DIR);
VarNpcType.load(PACK_DIR);
VarBitType.load(PACK_DIR);
InvType.load(PACK_DIR);
ObjType.load(PACK_DIR);
FontType.load(PACK_DIR);
assert(FontType.get(3), 'FontType q8_full (id 3) missing — need ISO data/pack/client/title');
Component.load(PACK_DIR);
NpcType.load(PACK_DIR);

const loaded = ScriptProvider.load(PACK_DIR);
assert(loaded > 0, `ScriptProvider.load returned ${loaded}`);
ok(`loaded ${loaded} compiled scripts`);

function packMap(rel, name) {
  const candidates = [path.join(WT, rel)];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(new RegExp(`^(\\d+)=${name}$`, 'm'));
    if (m) return Number(m[1]);
  }
  throw new Error(`${rel} missing ${name}`);
}

const ID = {
  inv: packMap('pack/inv.pack', 'inv'),
  worn: packMap('pack/inv.pack', 'worn'),
  ghostspeak: packMap('pack/obj.pack', 'amulet_of_ghostspeak'),
  fenkQuest: packMap('pack/varp.pack', 'fenk_quest'),
  fenkFollower: packMap('pack/varp.pack', 'fenk_follower_uid'),
  fenkFlags: packMap('pack/varp.pack', 'fenk_flags'),
  directionsBit: packMap('pack/varbit.pack', 'fenk_gardener_directions'),
  attackingUid: packMap('pack/varn.pack', 'npc_attacking_uid'),
  multi3Com1: packMap('pack/interface.pack', 'multi3:com_1'),
  multi3Com2: packMap('pack/interface.pack', 'multi3:com_2'),
  multi3Com3: packMap('pack/interface.pack', 'multi3:com_3'),
  multi4Com3: packMap('pack/interface.pack', 'multi4:com_3'),
  multi4Com4: packMap('pack/interface.pack', 'multi4:com_4')
};

const idFollower = packMap('pack/npc.pack', 'fenk_gardener');
const idMulti = packMap('pack/npc.pack', 'fenk_gardener_multi');
const idMulti2 = packMap('pack/npc.pack', 'fenk_gardener_multi_2');

const LEVEL = 0;
const BASE_X = 3200;
const BASE_Z = 3200;
const PLAYER_START_X = BASE_X + 1;
const PLAYER_WALK_X = BASE_X + 4;
const FOLLOW_TICKS = 1000;

for (let x = BASE_X - 2; x <= PLAYER_WALK_X + 2; x++) {
  for (let z = BASE_Z - 2; z <= BASE_Z + 2; z++) {
    allocateIfAbsent(x, z, LEVEL);
  }
}
for (let x = BASE_X; x < PLAYER_WALK_X; x++) {
  assert(
    canTravel(LEVEL, x, BASE_Z, 1, 0, 1, 0, CollisionType.NORMAL),
    `canTravel closed at ${x},${BASE_Z}`
  );
}
ok(`collision open ${BASE_X},${BASE_Z} → ${PLAYER_WALK_X},${BASE_Z}`);

const originalGameMap = World.gameMap;
const noopZone = { enter() {}, leave() {} };
Object.defineProperty(World, 'gameMap', {
  configurable: true,
  value: {
    getZone: () => noopZone,
    isMulti: () => false,
    isFreeToPlay: () => true
  }
});
World.currentTick = 1;

function makePlayer() {
  const p = new Player('fenk_follow_dlg', 0n, 0n);
  p.uid = 1;
  p.pid = 1;
  p.staffModLevel = 0;
  p.isActive = true;
  p.level = LEVEL;
  p.x = PLAYER_START_X;
  p.z = BASE_Z;
  p.write = () => {};
  p.messageGame = () => {};
  if (typeof p.wrappedMessageGame === 'function') {
    p.wrappedMessageGame = () => {};
  }
  return p;
}

function makeNpc(typeId, x, z, nid) {
  const t = NpcType.get(typeId);
  const size = t.size ?? 1;
  const block = t.blockwalk ?? BlockWalk.NPC;
  const npc = new Npc(LEVEL, x, z, size, size, EntityLifeCycle.DESPAWN, nid, typeId, block);
  npc.isActive = true;
  npc.lastTickX = x;
  npc.lastTickZ = z;
  npc.lastLevel = LEVEL;
  npc.moveSpeed = MoveSpeed.WALK;
  npc.walkDir = -1;
  npc.runDir = -1;
  npc.setLifeCycle(FOLLOW_TICKS);
  return npc;
}

function wearGhostspeak(player) {
  const worn = player.getInventory(ID.worn);
  assert(worn, 'worn inventory null');
  worn.add(ID.ghostspeak, 1);
}

function ownFollower(player, npc) {
  player.setVar(ID.fenkQuest, 1);
  player.setVar(ID.fenkFollower, npc.uid);
  player.setVarBit(ID.directionsBit, 1);
  npc.setVar(ID.attackingUid, player.uid);
  const linked = npc.setInteraction(Interaction.SCRIPT, player, NpcMode.PLAYERFOLLOW);
  assert(linked, 'setInteraction PLAYERFOLLOW failed — player/npc must be isActive');
  npc.targetOp = NpcMode.PLAYERFOLLOW;
}

function snapshot(npc) {
  return {
    uid: npc.uid,
    nid: npc.nid,
    type: npc.type,
    lifecycleTick: npc.lifecycleTick,
    lifecycle: npc.lifecycle,
    x: npc.x,
    z: npc.z
  };
}

function assertPreserved(npc, before, label) {
  assert(npc.uid === before.uid, `${label}: uid changed ${before.uid} → ${npc.uid}`);
  assert(npc.nid === before.nid, `${label}: nid changed ${before.nid} → ${npc.nid}`);
  assert(npc.type === before.type, `${label}: type changed ${before.type} → ${npc.type}`);
  assert(
    npc.lifecycleTick === before.lifecycleTick,
    `${label}: lifetime tick changed ${before.lifecycleTick} → ${npc.lifecycleTick}`
  );
  assert(npc.lifecycle === before.lifecycle, `${label}: lifecycle enum changed`);
}

function completeDialogue(player, scriptName, npc, firstChoiceCom = null) {
  const script = ScriptProvider.getByName(scriptName);
  assert(script, `compiled script missing ${scriptName}`);
  const state = ScriptRunner.init(script, player, npc);
  let exec = player.runScript(state, true, true);
  assert(exec !== -1, `${scriptName} did not obtain protected access`);
  let pauses = 0;
  const maxPauses = 40;
  while (exec === ScriptState.PAUSEBUTTON && pauses < maxPauses) {
    if (pauses === 0 && firstChoiceCom != null) {
      player.lastCom = firstChoiceCom;
    }
    pauses += 1;
    exec = player.runScript(state, true, true);
    assert(exec !== -1, `${scriptName} lost protected access on resume ${pauses}`);
  }
  assert(exec !== ScriptState.ABORTED, `${scriptName} ScriptRunner ABORTED after ${pauses} pauses`);
  assert(
    exec === ScriptState.FINISHED,
    `${scriptName} exec=${exec} expected FINISHED=${ScriptState.FINISHED} after ${pauses} pauses (modal pause is not completion)`
  );
  assert(pauses > 0, `${scriptName} finished without any p_pausebutton — dialogue did not run`);
  return { state, exec, pauses, script };
}

function tickModeMovement(npc) {
  npc.lastTickX = npc.x;
  npc.lastTickZ = npc.z;
  npc.moveSpeed = MoveSpeed.WALK;
  npc.walkDir = -1;
  npc.runDir = -1;
  if (typeof npc.processMovementInteraction !== 'function') {
    fail('Npc.processMovementInteraction missing — cannot prove mode-dispatch movement');
    throw new Error('missing processMovementInteraction');
  }
  npc.processMovementInteraction();
}

function walkPlayer(player, x, z) {
  player.x = x;
  player.z = z;
}

try {
  assert(
    NpcType.get(idFollower).moverestrict !== MoveRestrict.NOMOVE,
    'fenk_gardener packed NOMOVE — follower cannot walk'
  );
  assert(
    NpcType.get(idMulti).moverestrict === MoveRestrict.NOMOVE,
    'fenk_gardener_multi must stay NOMOVE'
  );
  assert(
    NpcType.get(idMulti2).moverestrict === MoveRestrict.NOMOVE,
    'fenk_gardener_multi_2 must stay NOMOVE'
  );
  ok('packed moverestrict: follower mobile, courtyard parents NOMOVE');

  // ---- Control: raw ~chatnpc leaves PLAYERFACECLOSE and no follow movement ----
  {
    const p = makePlayer();
    const npc = makeNpc(idFollower, BASE_X, BASE_Z, 11667);
    wearGhostspeak(p);
    ownFollower(p, npc);
    const before = snapshot(npc);
    assert(npc.targetOp === NpcMode.PLAYERFOLLOW, 'control setup expected PLAYERFOLLOW');
    const script = ScriptProvider.getByName('[proc,chatnpc]');
    assert(script, 'compiled [proc,chatnpc] missing');
    const state = ScriptRunner.init(script, p, npc, [
      "<p,neutral>Oi was diggin' a pit in the old 'aunted Forest to the south when they took me head. Keep with me, mate."
    ]);
    let exec = p.runScript(state, true, true);
    assert(exec !== -1, 'chatnpc(text) did not obtain protected access');
    let pauses = 0;
    while (exec === ScriptState.PAUSEBUTTON && pauses < 40) {
      pauses += 1;
      exec = p.runScript(state, true, true);
    }
    assert(exec !== ScriptState.ABORTED, `raw chatnpc ABORTED after ${pauses} pauses`);
    assert(
      exec === ScriptState.FINISHED,
      `raw chatnpc exec=${exec} expected FINISHED after ${pauses} pauses`
    );
    assert(pauses > 0, 'raw chatnpc produced no Continue pause');
    assert(
      npc.targetOp === NpcMode.PLAYERFACECLOSE,
      `old chatnpc left mode=${npc.targetOp}; expected PLAYERFACECLOSE=${NpcMode.PLAYERFACECLOSE}`
    );
    assertPreserved(npc, before, 'raw chatnpc');
    walkPlayer(p, PLAYER_WALK_X, BASE_Z);
    const x0 = npc.x;
    const z0 = npc.z;
    for (let i = 0; i < 4; i++) tickModeMovement(npc);
    assert(
      npc.x === x0 && npc.z === z0,
      `old chatnpc: NPC moved ${x0},${z0} → ${npc.x},${npc.z} under PLAYERFACECLOSE after player walk`
    );
    assert(
      npc.targetOp !== NpcMode.PLAYERFOLLOW,
      `old chatnpc: mode became PLAYERFOLLOW after walk (got ${npc.targetOp})`
    );
    ok(
      `old chatnpc pauses=${pauses} leaves mode=${npc.targetOp} (PLAYERFACECLOSE=${NpcMode.PLAYERFACECLOSE}) frozen ${npc.x},${npc.z}`
    );
  }

  function runOwnedOpnpcChoice(choiceCom, label) {
    const p = makePlayer();
    const npc = makeNpc(idFollower, BASE_X, BASE_Z, 2000 + choiceCom);
    wearGhostspeak(p);
    ownFollower(p, npc);
    const before = snapshot(npc);
    const questBefore = p.getVar(ID.fenkQuest);
    const dirBefore = p.getVarBit(ID.directionsBit);
    const uidVarBefore = p.getVar(ID.fenkFollower);
    const result = completeDialogue(p, '[opnpc1,fenk_gardener]', npc, choiceCom);
    ok(`${label}: handler finished pauses=${result.pauses} exec=${result.exec}`);
    assert(npc.uid === before.uid, `${label}: actor uid replaced`);
    assertPreserved(npc, before, label);
    assert(p.getVar(ID.fenkQuest) === questBefore, `${label}: quest stage rewritten`);
    assert(p.getVarBit(ID.directionsBit) === dirBefore, `${label}: directions bit rewritten`);
    assert(p.getVar(ID.fenkFollower) === uidVarBefore, `${label}: follower uid var rewritten`);
    assert(
      npc.targetOp === NpcMode.PLAYERFOLLOW,
      `${label}: mode=${npc.targetOp} after completed dialogue; expected PLAYERFOLLOW=${NpcMode.PLAYERFOLLOW}`
    );
    walkPlayer(p, PLAYER_WALK_X, BASE_Z);
    const startX = npc.x;
    const startZ = npc.z;
    let steps = 0;
    while (steps < 6 && npc.x < PLAYER_WALK_X - 1) {
      tickModeMovement(npc);
      steps += 1;
    }
    assert(
      npc.x !== startX || npc.z !== startZ,
      `${label}: same actor did not move after player walk (mode=${npc.targetOp} at ${npc.x},${npc.z}; steps=${steps})`
    );
    assert(npc.x > startX, `${label}: npc x ${npc.x} did not increase toward player ${p.x}`);
    assert(npc.z === startZ, `${label}: npc z drifted to ${npc.z}`);
    assert(npc.uid === before.uid, `${label}: uid changed during movement`);
    ok(
      `${label}: same uid ${npc.uid} resumed PLAYERFOLLOW and moved ${startX},${startZ} → ${npc.x},${npc.z} in ${steps} ticks`
    );
    return npc;
  }

  runOwnedOpnpcChoice(ID.multi3Com1, 'directions');
  runOwnedOpnpcChoice(ID.multi3Com2, 'name');
  runOwnedOpnpcChoice(ID.multi3Com3, 'leave');

  // ---- Courtyard multi must not become the caller's follower ----
  {
    const p = makePlayer();
    const follower = makeNpc(idFollower, BASE_X, BASE_Z, 3001);
    const courtyard = makeNpc(idMulti2, BASE_X, BASE_Z + 2, 3002);
    wearGhostspeak(p);
    ownFollower(p, follower);
    const followBefore = snapshot(follower);
    const courtBefore = snapshot(courtyard);
    courtyard.targetOp = NpcType.get(idMulti2).defaultmode;
    courtyard.target = null;
    const result = completeDialogue(p, '[opnpc1,fenk_gardener]', courtyard, ID.multi4Com3);
    ok(`courtyard name finished pauses=${result.pauses}`);
    assert(
      courtyard.targetOp !== NpcMode.PLAYERFOLLOW,
      `courtyard multi became PLAYERFOLLOW (mode=${courtyard.targetOp})`
    );
    assertPreserved(follower, followBefore, 'courtyard-control follower');
    walkPlayer(p, PLAYER_WALK_X, BASE_Z);
    tickModeMovement(courtyard);
    assert(
      courtyard.x === courtBefore.x && courtyard.z === courtBefore.z,
      `courtyard moved to ${courtyard.x},${courtyard.z}`
    );
    ok(`courtyard multi frozen at ${courtyard.x},${courtyard.z} mode=${courtyard.targetOp}`);
  }

  // ---- Unowned / other player's actor: stale uid must not steal follow ----
  {
    const p = makePlayer();
    const other = makeNpc(idFollower, BASE_X, BASE_Z, 4001);
    wearGhostspeak(p);
    p.setVar(ID.fenkQuest, 1);
    p.setVar(ID.fenkFollower, other.uid);
    p.setVarBit(ID.directionsBit, 1);
    other.setVar(ID.attackingUid, 99);
    other.setInteraction(Interaction.SCRIPT, p, NpcMode.PLAYERFOLLOW);
    other.targetOp = NpcMode.PLAYERFOLLOW;
    const before = snapshot(other);
    const result = completeDialogue(p, '[opnpc1,fenk_gardener]', other, ID.multi3Com1);
    ok(`unowned directions finished pauses=${result.pauses}`);
    assertPreserved(other, before, 'unowned');
    assert(
      other.targetOp !== NpcMode.PLAYERFOLLOW || other.getVar(ID.attackingUid) === 99,
      'unowned actor stolen'
    );
    assert(
      other.targetOp !== NpcMode.PLAYERFOLLOW,
      `unowned actor ended PLAYERFOLLOW targeting caller (mode=${other.targetOp})`
    );
    walkPlayer(p, PLAYER_WALK_X, BASE_Z);
    const x0 = other.x;
    const z0 = other.z;
    for (let i = 0; i < 4; i++) tickModeMovement(other);
    assert(other.x === x0 && other.z === z0, `unowned actor moved ${x0},${z0} → ${other.x},${other.z}`);
    ok(`unowned/stale actor not converted to caller follower (mode=${other.targetOp})`);
  }

  // ---- Missing ownership: courtyard talk via opnpc1 must not follow ----
  {
    const p = makePlayer();
    const courtyard = makeNpc(idFollower, BASE_X, BASE_Z, 5001);
    wearGhostspeak(p);
    p.setVar(ID.fenkQuest, 1);
    p.setVar(ID.fenkFollower, -1);
    p.setVarBit(ID.directionsBit, 0);
    courtyard.setVar(ID.attackingUid, -1);
    courtyard.targetOp = NpcType.get(idFollower).defaultmode;
    const result = completeDialogue(p, '[opnpc1,fenk_gardener]', courtyard, ID.multi4Com4);
    ok(`missing-owner opnpc1 finished pauses=${result.pauses} (courtyard menu, not following_talk)`);
    assert(
      courtyard.targetOp !== NpcMode.PLAYERFOLLOW,
      `missing ownership produced PLAYERFOLLOW (mode=${courtyard.targetOp})`
    );
    ok('missing ownership did not invent a follower');
  }
} finally {
  Object.defineProperty(World, 'gameMap', { configurable: true, value: originalGameMap });
}

if (process.exitCode) {
  console.log('RESULT FAIL');
  process.exit(1);
}
console.log('RESULT PASS (compiled dialogue + real Npc mode-dispatch movement)');
process.exit(0);
