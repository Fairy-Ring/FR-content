import assert from 'node:assert/strict';
import {
  Player, PlayerStat, World, engineModule, id, inv, invCom, types, worn, wornCom
} from '../swamp-caves/runtime.mjs';

const { toBase37 } = await engineModule('util/JString.ts');
let serial = 0;

export function player(firemaking = 99) {
  const slot = ++serial;
  const username = `feud${slot}`;
  const hash = toBase37(username);
  const p = new Player(username, hash, hash);
  p.pid = slot; p.slot = slot;
  // Match the published world's username-hash and slot UID construction.
  p.uid = ((Number(hash & 0x1fffffn) << 11) | slot) >>> 0;
  p.level = 0; p.x = 3170; p.z = 3173;
  p.isActive = true;
  p.vars.fill(0); p.baseLevels.fill(99); p.levels.fill(99); p.stats.fill(123456);
  p.baseLevels[PlayerStat.FIREMAKING] = firemaking;
  p.levels[PlayerStat.FIREMAKING] = firemaking;
  p.setVar(id('VarPlayerType', 'tutorial'), 1000);
  p.messages = []; p.packets = [];
  p.write = packet => p.packets.push(packet);
  p.messageGame = text => p.messages.push(String(text));
  p.wrappedMessageGame = text => p.messages.push(String(text));
  World.players[slot] = p;
  World.playerLoop.add(hash, p);
  p.tabs[3] = types.Component.get(invCom).rootLayer;
  p.tabs[4] = types.Component.get(wornCom).rootLayer;
  p.invListenOnCom(inv, invCom, p.uid);
  p.invListenOnCom(worn, wornCom, p.uid);
  assert.equal(toBase37(p.username), p.username37, 'the Feud fixture name and hash are canonical');
  assert.equal(World.getPlayerByUid(p.uid), p, 'native UID lookup resolves the same Feud player');
  return p;
}
