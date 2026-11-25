import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { engine, Player, ScriptRunner, ScriptState, World, packed, requiredId, types } from '../regicide-travel/runtime.mjs';

export { ScriptRunner, World, types };
export const load = relative => import(pathToFileURL(`${engine}/src/${relative}`).href);
export const { PlayerLoading } = await load('engine/entity/PlayerLoading.ts');
const { default: Packet } = await load('io/Packet.ts');
const { default: Environment } = await load('util/Environment.ts');
const { ScriptOpcode } = await load('engine/script/ScriptOpcode.ts');
// Ordinary members-world fixture. This suite does not test the optional transmit-all mode.
Environment.NODE_MEMBERS = true;
Environment.NODE_PRODUCTION = false;
Environment.NODE_RANDOM_EVENTS = false;
Environment.NODE_TRANSMIT_ALL_VARPS = false;
export const loginMinute = 30000000; // Deterministic fixture clock, not a historical value.
ScriptRunner.HANDLERS[ScriptOpcode.DATE_MINUTES] = state => state.pushInt(loginMinute);
export const id = (kind, name) => requiredId(types[kind], name);
export const v = name => id('VarPlayerType', name);
let serial = 0;

function attach(p, slot) {
  p.slot = slot; p.pid = slot;
  p.uid = ((Number(p.username37 & 0x1fffffn) << 11) | slot) >>> 0;
  p.packets = [];
  p.write = packet => p.packets.push(packet); // Capture transport, not gameplay.
  World.players[slot] = p;
  return p;
}
export function player() {
  const slot = ++serial;
  const p = attach(PlayerLoading.load(`login_${slot}`, new Packet(new Uint8Array()), null), slot);
  [p.level, p.x, p.z] = [0, 3222, 3218];
  p.setVar(v('tutorial'), 1000); // Mainland prerequisite, not a login effect under test.
  return p;
}
export function run(p, name, args = []) {
  const state = ScriptRunner.init(packed(name), p, null, args);
  p.executeScript(state, true);
  assert.equal(state.execution, ScriptState.FINISHED, `${name} finishes in the real VM`);
  return state;
}
export function logoutAndLoad(p) {
  run(p, '[logout,_]');
  const saved = p.save();
  const loaded = PlayerLoading.load(p.username, new Packet(saved), null);
  assert(loaded instanceof Player);
  return attach(loaded, p.slot);
}
