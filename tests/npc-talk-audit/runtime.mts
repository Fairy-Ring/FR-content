import assert from 'node:assert/strict';

import NpcType from '#/cache/config/NpcType.js';
import { BlockWalk } from '#/engine/entity/BlockWalk.js';
import { EntityLifeCycle } from '#/engine/entity/EntityLifeCycle.js';
import Npc from '#/engine/entity/Npc.js';
import Player from '#/engine/entity/Player.js';
import World from '#/engine/World.js';
import MessageGame from '#/network/game/server/model/MessageGame.js';
import OpNpcHandler from '#/network/game/client/handler/OpNpcHandler.js';
import OpNpc from '#/network/game/client/model/OpNpc.js';
import * as rsbuf from '#/network/rsbuf/index.js';
import { findNoRouteTalkWitnesses, loadPackedConfigs, type NoRouteTalkWitness } from './audit.mts';

function runWitness(witness: NoRouteTalkWitness, ordinal: number): void {
  const visibleTypeId = witness.visibleTypeId;
  const slot = witness.talkSlot;
  const type = NpcType.get(visibleTypeId);
  assert(type, `visible NPC config ${visibleTypeId} is not loaded`);
  assert.equal(type.op?.[slot - 1], 'Talk-to', `NPC ${visibleTypeId} no longer has Talk-to in slot ${slot}`);
  const player = new Player('talkaudit', 1n, 1n);
  player.pid = 1;
  player.uid = 1;
  player.slot = 1;
  player.x = 8;
  player.z = 8;
  player.level = 1;
  player.vars.fill(0);
  player.baseLevels.fill(99);
  player.levels.fill(99);

  const npc = new Npc(
    0,
    8,
    8,
    1,
    1,
    EntityLifeCycle.FOREVER,
    ordinal,
    visibleTypeId,
    BlockWalk.NONE,
  );
  npc.isActive = true;
  const packets: unknown[] = [];
  player.write = packet => {
    packets.push(packet);
  };

  const originalGetNpc = World.getNpc;
  let playerAdded = false;
  let npcAdded = false;
  try {
    World.getNpc = ((npcSlot: number) => npcSlot === npc.nid ? npc : null) as typeof World.getNpc;
    rsbuf.addPlayer(player.slot);
    playerAdded = true;
    rsbuf.addNpc(npc.nid, npc.type);
    npcAdded = true;
    rsbuf.computeNpc(
      npc.x, npc.z, npc.level, npc.nid, npc.type,
      false, false, -1, -1, true, 0, -1, -1, -1, -1, -1,
      0, 0, 0, 0, 1, 1, -1, 0, null, -1, 0, 0,
    );
    rsbuf.npcInfo(0, player.slot, 0, 0, false);
    assert.equal(rsbuf.hasNpc(player.slot, npc.nid), true, `NPC ${visibleTypeId} is not visible to the client`);

    const accepted = new OpNpcHandler().handle(new OpNpc(slot, npc.nid), player);
    assert.equal(accepted, true, `production OpNpcHandler rejected Talk-to slot ${slot} on NPC ${visibleTypeId}`);
    assert.equal(player.getApTrigger(), null, `census no-route NPC ${visibleTypeId} acquired an AP script`);
    assert.equal(player.getOpTrigger(), null, `census no-route NPC ${visibleTypeId} acquired an OP script`);

    player.defaultOp();
    const responses = packets.filter((packet): packet is MessageGame => packet instanceof MessageGame).map(packet => packet.msg);
    assert.deepEqual(responses, ['Nothing interesting happens.'], `unexpected default response for NPC ${visibleTypeId}`);
  } finally {
    World.getNpc = originalGetNpc;
    if (npcAdded) rsbuf.removeNpc(npc.nid);
    if (playerAdded) rsbuf.removePlayer(player.slot);
  }

  console.log(`WITNESS ${ordinal}: placed=${witness.placedTypeId} visible=${visibleTypeId} slot=${slot} response=Nothing interesting happens.`);
}

const [contentRootInput] = process.argv.slice(2);
assert(contentRootInput, 'Usage: runtime.mts <content-root>');
loadPackedConfigs('data/pack');

const witnesses = findNoRouteTalkWitnesses(contentRootInput, 10);
assert.equal(witnesses.length, 10, `expected ten distinct no-route Talk-to forms in the current maps and pack, found ${witnesses.length}`);
for (let index = 0; index < witnesses.length; index++) runWitness(witnesses[index], index + 1);
console.log('TALK_AUDIT_RUNTIME_WITNESSES=10 fallback=Nothing interesting happens.');
