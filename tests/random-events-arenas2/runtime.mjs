import assert from 'node:assert/strict';
export * from '../swamp-caves/runtime.mjs';
import { player as makePlayer, World, ScriptProvider, ScriptState, id, engineModule, resumeDialogue, types } from '../swamp-caves/runtime.mjs';
export const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
export const { ScriptOpcode: op } = await engineModule('engine/script/ScriptOpcode.ts');
export const Environment = (await engineModule('util/Environment.ts')).default;
export const v = name => id('VarPlayerType', name);
export const O = [0, 3222, 3218];
export const tile = p => [p.level, p.x, p.z];
export const coord = ([level, x, z]) => (level << 28) | (x << 14) | z;
export function player(at = O) {
  const p = makePlayer();
  [p.level, p.x, p.z] = at;
  p.buildArea.originX = Math.floor(p.x / 8) * 8;
  p.buildArea.originZ = Math.floor(p.z / 8) * 8;
  run(p, '[proc,initalltabs]');
  return p;
}
export function packed(name) { const script = ScriptProvider.getByName(name); assert(script, `packed ${name}`); return script; }
export function advance(p, state, inspect = null) {
  for (let n = 0; state.execution === ScriptState.SUSPENDED && n < 80; n++) {
    inspect?.();
    World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
    p.delayed = false;
    p.executeScript(state, true, true);
  }
  assert.notEqual(state.execution, ScriptState.ABORTED, `${state.script.name} aborts`);
  assert.notEqual(state.execution, ScriptState.SUSPENDED, `${state.script.name} exceeds delay bound`);
}
export function run(p, name, args = [], target = null, inspect = null) {
  const state = ScriptRunner.init(packed(name), p, target, args);
  p.executeScript(state, true, true);
  advance(p, state, inspect);
  return state;
}
export function finish(p, choices = []) {
  for (let n = 0; p.activeScript && n < 80; n++) {
    const state = p.activeScript;
    if (state.execution === ScriptState.PAUSEBUTTON) {
      const root = types.Component.get(p.modalChat).comName;
      resumeDialogue(p, /^multi[2-5]$/.test(root) ? choices.shift() ?? 1 : null);
    } else advance(p, state);
  }
  assert.equal(p.activeScript, null, 'bounded dialogue completes');
  assert.equal(choices.length, 0, 'all requested choices were offered');
}
export function draws(spec, fn) {
  const original = ScriptRunner.HANDLERS[op.RANDOM];
  const remaining = Object.fromEntries(Object.entries(spec).map(([name, values]) => [name, [...values]]));
  ScriptRunner.HANDLERS[op.RANDOM] = state => {
    const values = remaining[state.script.name];
    if (!values?.length) return original(state);
    const bound = state.popInt(), value = values.shift();
    assert(value >= 0 && value < bound, `${state.script.name} draw ${value}/${bound}`);
    state.pushInt(value);
  };
  try { return fn(); } finally { ScriptRunner.HANDLERS[op.RANDOM] = original; }
}
export function result(state) { assert.equal(state.execution, ScriptState.FINISHED); return state.intStack[state.isp - 1]; }
export function check(name, fn) { fn(); console.log(`PASS ${name}`); }
