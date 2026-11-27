import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Player, ScriptRunner, ScriptState, ResumePauseButtonHandler, ResumePauseButton, World, packed, requiredId, types, engine, nativeNpcRows, nativeLocRows, locFor } from '../regicide-travel/runtime.mjs';
export { assert, types, World, nativeNpcRows, nativeLocRows, locFor, ScriptRunner, ScriptState, ResumePauseButtonHandler, ResumePauseButton, packed, engine };
export const inv = requiredId(types.InvType, 'inv');
export const id = requiredId;
export const v = name => id(types.VarPlayerType, name);
export const coord = (level, x, z) => (level << 28) | (x << 14) | z;
export const origin = [0, 3222, 3218];
export const tile = p => [p.level, p.x, p.z];
export const results = { passed: 0, failed: 0 };
export function check(name, fn) {
  try { fn(); results.passed++; console.log(`PASS ${name}`); }
  catch (error) { results.failed++; console.error(`FAIL ${name}\n${error.stack}`); }
}
let serial = 0;
export function player(position = origin) {
  const slot = ++serial;
  const username37 = toBase37(`arena1_${slot}`);
  const p = new Player(fromBase37(username37), username37, username37);
  p.slot = slot; p.pid = slot;
  p.uid = ((Number(p.username37 & 0x1fffffn) << 11) | slot) >>> 0;
  p.baseLevels.fill(99); p.levels.fill(99);
  [p.level, p.x, p.z] = position;
  p.buildArea.originX = Math.floor(p.x / 8) * 8;
  p.buildArea.originZ = Math.floor(p.z / 8) * 8;
  p.messages = []; p.write = packet => p.messages.push(packet);
  World.players[slot] = p;
  World.playerLoop.add(0n, p);
  return p;
}
export function run(p, root, args = [], { npc = null, loc = null, protect = true, choices = [], resume = true } = {}) {
  const state = ScriptRunner.init(packed(root), p, npc ?? loc, args);
  p.executeScript(state, protect);
  for (let step = 0; resume && step < 80; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, `${root} must not abort`);
    if (state.execution === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
      p.executeScript(state, true, true);
    } else if (state.execution === ScriptState.PAUSEBUTTON) {
      assert(new ResumePauseButtonHandler().handle(new ResumePauseButton(choices.shift() ?? 0), p), `${root} resumes its actual page`);
    } else break;
  }
  assert.notEqual(state.execution, ScriptState.ABORTED, `${root} must not abort`);
  if (resume) {
    assert.notEqual(state.execution, ScriptState.SUSPENDED, `${root} finishes bounded delays`);
    assert.notEqual(state.execution, ScriptState.PAUSEBUTTON, `${root} finishes bounded pages`);
  }
  return state;
}
export function give(p, name, quantity = 1) { p.invAdd(inv, id(types.ObjType, name), quantity); }
export function count(p, name, inventory = inv) { return p.invTotal(inventory, id(types.ObjType, name)); }
const { PlayerLoading } = await import(pathToFileURL(`${engine}/src/engine/entity/PlayerLoading.ts`).href);
const { default: Packet } = await import(pathToFileURL(`${engine}/src/io/Packet.ts`).href);
const { fromBase37, toBase37 } = await import(pathToFileURL(`${engine}/src/util/JString.ts`).href);
export const { PlayerStat } = await import(pathToFileURL(`${engine}/src/engine/entity/PlayerStat.ts`).href);
export function reconnect(p) {
  p.closeModal();
  run(p, '[proc,macro_event_logout]');
  const saved = new Packet(p.save());
  p.unlink();
  const restored = PlayerLoading.load(p.username, saved, null);
  restored.slot = p.slot; restored.pid = p.pid; restored.uid = p.uid;
  restored.messages = []; restored.write = packet => restored.messages.push(packet);
  World.players[p.slot] = restored;
  World.playerLoop.add(0n, restored);
  run(restored, '[queue,macro_event_login]');
  return restored;
}
