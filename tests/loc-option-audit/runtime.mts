import assert from 'node:assert/strict';

import LocType from '#/cache/config/LocType.js';
import { EntityLifeCycle } from '#/engine/entity/EntityLifeCycle.js';
import Loc from '#/engine/entity/Loc.js';
import Player from '#/engine/entity/Player.js';
import World from '#/engine/World.js';
import OpLocHandler from '#/network/game/client/handler/OpLocHandler.js';
import OpLoc from '#/network/game/client/model/OpLoc.js';
import MessageGame from '#/network/game/server/model/MessageGame.js';
import { loadPack, readPlacements, scan, selfChecks, setState, type Option } from './audit.mts';

function runWitnesses(witnesses: Option[]): number {
  for (const witness of witnesses) {
    const root = LocType.get(witness.root);
    const player = new Player('locaudit', 1n, 1n);
    player.x = player.z = player.originX = player.originZ = 8;
    player.level = 1;
    setState(player, root, witness.form.states[0]);
    const loc = new Loc(1, 8, 8, root.width, root.length, EntityLifeCycle.FOREVER, root.id, 10, 0);
    const packets: unknown[] = [];
    player.write = packet => { packets.push(packet); };
    const original = World.getLoc;
    try {
      World.getLoc = (() => loc) as typeof World.getLoc;
      assert.equal(new OpLocHandler().handle(new OpLoc(witness.slot, 8, 8, root.id), player), true);
      assert.equal(player.target, loc);
      assert.equal(player.getApTrigger(), null, 'runtime-selected gap must have no approach trigger');
      assert.equal(player.getOpTrigger(), null, 'runtime-selected gap must have no operate trigger');
      player.defaultOp();
      assert.deepEqual(packets.filter((p): p is MessageGame => p instanceof MessageGame).map(p => p.msg), ['Nothing interesting happens.']);
    } finally {
      World.getLoc = original;
    }
    console.log(`PASS runtime default: ${root.debugname} -> ${LocType.get(witness.form.type).debugname}, slot ${witness.slot}, ${witness.text}`);
  }
  return witnesses.length;
}

const client = loadPack();
const { placements } = readPlacements();
for (const result of selfChecks(client, placements)) console.log(result);
const candidates = scan(placements, client).options.filter(o => o.kind === 'no handler');
// UNKNOWN engineering sample bound. Prefer a multiloc witness, then distinct visible forms and slots.
const WITNESS_LIMIT = 5;
candidates.sort((a, b) => Number(a.root === a.form.type) - Number(b.root === b.form.type) || a.form.type - b.form.type || a.slot - b.slot || a.root - b.root);
const seen = new Set<number>();
const witnesses = candidates.filter(o => {
  if (seen.has(o.form.type)) return false;
  seen.add(o.form.type);
  return true;
}).slice(0, WITNESS_LIMIT);
assert.equal(runWitnesses([]), 0, 'zero remaining gaps is a valid current pack');
const count = runWitnesses(witnesses);
if (!count) console.log('PASS no unanswered mapped loc options remain');
console.log(`LOC_AUDIT_RUNTIME_WITNESSES=${count} fallback=Nothing interesting happens.`);
