// Production cache, map, visibility encoder, packet handler and script runner.
import assert from 'node:assert/strict';
export * from '../farming/runtime.mjs';
import { World, State, JavaRandom, PlayerStat, id, inv, player, types, load } from '../farming/runtime.mjs';
const OpNpc = (await load('network/game/client/model/OpNpc.ts')).default;
const handler = new (await load('network/game/client/handler/OpNpcHandler.ts')).default();
const { NpcStat } = await load('engine/entity/NpcStat.ts');
const rsbuf = await load('network/rsbuf/index.ts');
const map = await load('engine/GameMap.ts');
const registered = new Set();

export function placed(form) {
  const type = id('NpcType', form);
  const candidates = [...World.npcs].filter(npc => npc.isActive && npc.type === type);
  assert(candidates.length, `original map placement exists for ${form}`);
  for (const npc of candidates) {
    const fixture = player();
    try {
      fixture.level = npc.level;
      for (let x = npc.x - 1; x <= npc.x + 1; x++) for (let z = npc.z - 1; z <= npc.z + 1; z++) {
        if (map.isMapBlocked(x, z, npc.level)) continue;
        fixture.x = x; fixture.z = z;
        if (fixture.inOperableDistance(npc)) return { npc, form, stand: { x, z, level: npc.level } };
      }
    } finally { fixture.unlink(); delete World.players[fixture.pid]; }
  }
  assert.fail(`placed ${form} has a collision-clear operable tile`);
}

export function prepared(entry, level) {
  const p = player();
  p.slot = p.pid;
  World.players[p.slot] = p;
  rsbuf.addPlayer(p.slot);
  Object.assign(p, entry.stand);
  p.resetEntity(false);
  p.originX = p.x; p.originZ = p.z;
  p.setLevel(PlayerStat.THIEVING, level);
  p.setLevel(PlayerStat.HITPOINTS, 99);
  return p;
}

export const snapshot = p => Array.from({ length: types.InvType.get(inv).size }, (_, slot) => {
  const obj = p.invGetSlot(inv, slot);
  return obj ? [obj.id, obj.count] : null;
}).filter(Boolean).sort((a, b) => a[0] - b[0]);

function show(p, npc) {
  if (!registered.has(npc.nid)) { rsbuf.addNpc(npc.nid, npc.type); registered.add(npc.nid); }
  const hp = PlayerStat.HITPOINTS;
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, p.generateAppearance(), p.lastAppearance,
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
  assert(rsbuf.hasNpc(p.slot, npc.nid), 'native visibility includes the placed NPC');
}

export function attempt(p, entry, seed) {
  World.playerLoop.add(BigInt(p.pid), p);
  if (seed !== undefined) JavaRandom.setSeed(seed);
  show(p, entry.npc);
  assert(handler.handle(new OpNpc(3, entry.npc.nid), p), 'native OPNPC3 packet is accepted');
  assert.equal(p.getOpTrigger()?.name, `[opnpc3,${entry.form}]`, 'dispatch resolves the visible form');
  p.processInteraction();
  for (let tick = 0; p.activeScript?.execution === State.SUSPENDED && tick < 24; tick++) {
    World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
    World.processPlayers();
  }
}

export function dispose(p) {
  rsbuf.removePlayer(p.slot);
  p.unlink();
  delete World.players[p.slot];
}
export function cleanup() { for (const nid of registered) rsbuf.removeNpc(nid); }
