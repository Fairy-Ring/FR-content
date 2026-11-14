// Production click handlers, native map locs and packed VM; no world server.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { engine, World, Player, ScriptState, ScriptProvider, types, floorTiles, map, locFor, nativeLocRows } from '../regicide-travel/runtime.mjs';
const load = async file => (await import(pathToFileURL(path.join(engine, 'src', file)).href)).default;
const OpLoc = await load('network/game/client/model/OpLoc.ts');
const OpLocHandler = await load('network/game/client/handler/OpLocHandler.ts');
const OpLocU = await load('network/game/client/model/OpLocU.ts');
const OpLocUHandler = await load('network/game/client/handler/OpLocUHandler.ts');
const MessageGame = await load('network/game/server/model/MessageGame.ts');
const IfOpenOverlay = await load('network/game/server/model/IfOpenOverlay.ts');
const rsbuf = await import(pathToFileURL(path.join(engine, 'src/network/rsbuf/index.ts')).href);
const selectedCase = process.argv[2];
let serial = 0;
let passed = 0;
const specs = [
  { name: 'rift-unroped', parent: 'soulbane_falloff2_rope_multi', child: 'soulbane_falloff2', state: 0, refused: true },
  { name: 'rift-roped', parent: 'soulbane_falloff2_rope_multi', child: 'soulbane_falloff2_rope', state: 1 },
  { name: 'plinth-placed', parent: 'elid_statuette_multiloc', child: 'elid_statuette_placed', state: 60, item: 'elid_statuette', refused: true },
  ...[0, 10, 20, 25, 27, 30, 35, 40, 50, 55].map(state => ({ name: `plinth-base-${state}`, parent: 'elid_statuette_multiloc', child: 'elid_statuette_base', state, item: 'elid_statuette', nextState: 60 })),
  { name: 'altar-pouch', parent: 'devious_altar', child: 'devious_altar_pouch', state: 1, item: 'devious_glowingpouch', refused: true },
  { name: 'altar-scorched', parent: 'devious_altar', child: 'devious_altar_scorched', state: 2, item: 'devious_glowingpouch', refused: true },
  { name: 'altar-empty', parent: 'devious_altar', child: 'altar', state: 0, item: 'devious_glowingpouch', nextState: 1 }
];
assert(!selectedCase || specs.some(s => s.name === selectedCase), 'unknown case');
for (const spec of specs.filter(s => !selectedCase || s.name === selectedCase)) {
  const p = new Player('guard_' + ++serial, BigInt(serial), BigInt(serial));
  Object.assign(p, { slot: serial, pid: serial, uid: (serial << 11) | serial, isActive: true });
  p.vars.fill(0); p.baseLevels.fill(99); p.levels.fill(99);
  World.players[serial] = p; rsbuf.addPlayer(serial);
  const packets = []; p.write = packet => packets.push(packet);
  const executions = [];
  const execute = p.executeScript;
  p.executeScript = function(state, ...args) {
    executions.push({ script: state.script.name, activeLoc: state._activeLoc?.type, state });
    return execute.call(this, state, ...args);
  };
  const root = types.LocType.getByName(spec.parent);
  assert(root && root.multivarbit >= 0);
  const native = nativeLocRows(spec.parent)[0];
  assert(native, 'native placement');
  const entity = locFor(native);
  assert(entity, 'native packed loc');
  const approaches = [];
  for (let x = entity.x - 4; x <= entity.x + 4; x++) for (let z = entity.z - 4; z <= entity.z + 4; z++) {
    if (!floorTiles.has([entity.level, x, z].join(',')) || map.isMapBlocked(x, z, entity.level)) continue;
    Object.assign(p, { level: entity.level, x, z });
    if (p.inOperableDistance(entity)) approaches.push([entity.level, x, z]);
  }
  approaches.sort((a, b) => Math.abs(a[1] - entity.x) + Math.abs(a[2] - entity.z) - Math.abs(b[1] - entity.x) - Math.abs(b[2] - entity.z));
  assert(approaches.length, 'genuine operable floor approach');
  [p.level, p.x, p.z] = approaches[0];
  p.buildArea.rebuild();
  p.setVarBit(root.multivarbit, spec.state);
  assert.equal(types.LocType.get(root.multiloc[spec.state]).debugname, spec.child, 'fixture shown form');
  const invId = types.InvType.getId('inv');
  const inv = p.getInventory(invId);
  const item = spec.item ? types.ObjType.getId(spec.item) : -1;
  if (spec.item) {
    assert(item >= 0);
    inv.add(item, 2);
    const com = types.Component.get(3214);
    assert(com.usable);
    p.tabs[3] = com.rootLayer;
    p.invListenOnCom(invId, com.id, p.uid);
  }
  const snapshot = () => ({ coordinates: [p.level, p.x, p.z], itemCount: spec.item ? inv.getItemCount(item) : null, state: p.getVarBit(root.multivarbit) });
  const before = snapshot();
  const beforeVars = Array.from(p.vars);
  const accepted = spec.item
    ? new OpLocUHandler().handle(new OpLocU(entity.x, entity.z, root.id, item, 0, 3214), p)
    : new OpLocHandler().handle(new OpLoc(1, entity.x, entity.z, root.id), p);
  assert.equal(accepted, true, 'production click accepted');
  assert.equal(p.target, entity);
  assert(p.validateTarget());
  const selected = p.getOpTrigger()?.name ?? null;
  // The published engine selects no handler for refused forms. The repaired
  // engine selects the guarded parent. Assert identical player outcomes below.
  if (!spec.refused) assert(selected, 'working child-bound handler');
  let reached = false;
  for (let i = 0; i < 3 && !reached; i++) reached = p.tryInteract(true);
  assert(reached, 'click processed');
  for (const { state } of executions) {
    for (let i = 0; state.execution === ScriptState.SUSPENDED && i < 15; i++) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    }
    assert.notEqual(state.execution, ScriptState.ABORTED, 'VM did not abort');
  }
  const after = snapshot();
  const messages = packets.filter(p => p instanceof MessageGame).map(p => p.msg);
  const overlays = packets.filter(p => p instanceof IfOpenOverlay).map(p => p.component);
  const changedVars = Array.from(p.vars).flatMap((value, id) => value !== beforeVars[id] ? [{ id, before: beforeVars[id], after: value }] : []);
  const observed = { case: spec.name, native, selected, before, after, messages, overlays, overlay: p.overlay, changedVars, executions: executions.map(({ state, ...e }) => ({ ...e, execution: state.execution })) };
  console.log('OBSERVED ' + JSON.stringify(observed));
  if (spec.refused) {
    assert.deepEqual(after, before, `${spec.name}: no movement, item loss or selector change`);
    assert.deepEqual(changedVars, [], `${spec.name}: no varp write`);
    assert.equal(p.overlay, -1, `${spec.name}: no deferred overlay`);
    assert.deepEqual(overlays, [], `${spec.name}: no overlay`);
    assert.equal(messages.filter(m => m === 'Nothing interesting happens.').length, 1, 'published default message');
    // Debug servers additionally diagnose a missing handler. It is not a
    // player-facing content message and is absent when a guard executes.
    assert(messages.every(m => m === 'Nothing interesting happens.' || m.startsWith('No trigger for ')), 'no new content wording');
  } else if (!spec.item) {
    assert.deepEqual(after.coordinates, [0, 3013, 5243]);
    assert.equal(after.state, 1);
    assert.equal(p.overlay, types.Component.getId('rage_level'));
    assert.deepEqual(changedVars, []);
  } else {
    assert.deepEqual(after.coordinates, before.coordinates);
    assert.equal(after.itemCount, before.itemCount - 1);
    assert.equal(after.state, spec.nextState);
    assert.deepEqual(messages, []);
    assert.deepEqual(overlays, []);
    assert.equal(changedVars.length, 1, 'placement writes only its selector base');
  }
  for (const execution of executions) assert.equal(execution.activeLoc, root.id, 'original parent context');
  passed++;
  console.log('PASS ' + spec.name);
}
assert(ScriptProvider.getByName('[oploc1,soulbane_falloff2_rope]'));
console.log(`MULTIFORM_GUARDS_PASS=${passed}`);
process.exit(0);
