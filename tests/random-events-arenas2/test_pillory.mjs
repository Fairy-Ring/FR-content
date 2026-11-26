import assert from 'node:assert/strict';
import { player, run, draws, check, tile, O, coord, v, id, button, World, map, inventory, ServerTriggerType, ScriptRunner, ScriptState, advance, result, types, op, packed, environmentTick } from './runtime.mjs';
const event = 22;
function start(cage = 0) {
  const p = player();
  draws({ '[proc,macro_pillory_start]': [cage, 0] }, () => run(p, '[proc,macro_event_general_spawn]', [event]));
  assert.equal(p.getVar(v('macro_event')), event);
  assert.equal(p.getVar(v('macro_event_origin_coord')), coord(O));
  assert.equal(p.modalMain, -1, 'entry confines the prisoner without fabricating a lock click');
  const door = World.getLoc(p.x, p.z + (cage === 0 ? 1 : -1), p.level, id('LocType', 'cage'));
  assert(door, 'real native cage door exists');
  p.target = door; p.targetOp = ServerTriggerType.APLOC1;
  const script = p.getOpTrigger(); assert(script, 'native Unlock has a production handler');
  const state = ScriptRunner.init(script, p, door); p.executeScript(state, true, true); advance(p, state);
  assert.equal(p.modalMain, id('Component', 'inter_134'));
  return p;
}
function answer(p, shape = p.getVar(v('xplamp')) % 10) { assert(button(p, `inter_134:com_${5 + shape}`)); }
function complete(p) {
  if (p.getVar(v('xplamp')) >= 100) World.currentTick = Math.max(World.currentTick, p.getVar(v('macro_arena_clock')));
  for (let n = 0; p.getVar(v('macro_event')) === event && n < 5; n++) answer(p);
  assert.equal(p.getVar(v('macro_event')), 0);
}
for (let cage = 0; cage < 3; cage++) check(`Pillory native cage ${cage} confinement, Unlock and successful origin return`, () => {
  const p = start(cage);
  assert(!map.isMapBlocked(p.x, p.z, p.level), 'native entry is walkable');
  const projectile = ScriptRunner.HANDLERS[op.PROJANIM_PL], hp = p.levels[3];
  let tomatoes = 0;
  ScriptRunner.HANDLERS[op.PROJANIM_PL] = state => { tomatoes++; projectile(state); };
  try {
    const timer = ScriptRunner.init(packed('[softtimer,macro_pillory_tomato]'), p);
    p.executeScript(timer, false, true);
    assert.equal(timer.execution, ScriptState.FINISHED, 'real unprotected softtimer requires no protected state writes');
    assert.equal(tomatoes, 1, 'the real nearby map tramp throws a tomato across zone boundaries');
    assert.equal(p.levels[3], hp, 'cosmetic punishment causes no invented damage');
  } finally { ScriptRunner.HANDLERS[op.PROJANIM_PL] = projectile; }
  for (const [dx, dz] of [[-1,0],[1,0],[0,-1],[0,1]]) assert(!map.isLineOfWalk(p.level, p.x, p.z, p.x + dx, p.z + dz), `native cage blocks ${dx},${dz}`);
  const doorZ = p.z + (cage === 0 ? 1 : -1);
  const loc = World.getLoc(p.x, doorZ, p.level, id('LocType', 'cage'));
  assert(loc, 'the real cage door is packed');
  p.closeModal(); p.target = loc; p.targetOp = ServerTriggerType.APLOC1;
  const script = p.getOpTrigger(); assert(script, 'native Unlock resolves');
  const state = ScriptRunner.init(script, p, loc); p.executeScript(state, true, true); advance(p, state);
  assert.equal(p.modalMain, id('Component', 'inter_134'));
  complete(p);
  assert.deepEqual(tile(p), O);
  assert.equal(p.getVar(v('macro_event_origin_coord')), -1);
  assert.equal(p.getVar(v('xplamp')), 0); assert.equal(p.getVar(v('macro_transmit')), 0);
  assert(inventory(p).some(Boolean), 'period small prize is granted');
  const after = inventory(p); run(p, '[proc,macro_pillory_answer]', [0]); assert.deepEqual(inventory(p), after, 'answer replay cannot mint rewards');
});
check('Pillory wrong answers reset progress, enforce 25 ticks, and add locks only up to five', () => {
  const p = start(); answer(p);
  assert.equal(p.getVar(v('macro_transmit')), 1);
  for (let n = 0; n < 5; n++) {
    answer(p, (p.getVar(v('xplamp')) % 10 + 1) % 3);
    assert.equal(p.getVar(v('macro_transmit')), 0);
    assert.equal(Math.floor((p.getVar(v('xplamp')) % 100) / 10), Math.min(5, 4 + n));
    const waiting = [...p.vars], deadline = p.getVar(v('macro_arena_clock'));
    assert.equal(deadline - World.currentTick, 25, 'period 15 seconds is 25 game ticks');
    answer(p); assert.deepEqual([...p.vars], waiting, 'immediate retry cannot advance a lock');
    World.currentTick = deadline - 1; answer(p); assert.deepEqual([...p.vars], waiting, 'one tick early remains refused');
    World.currentTick = deadline;
  }
  complete(p); assert.deepEqual(tile(p), O);
});
check('Pillory real logout/login preserves puzzle and exact departure', () => {
  const p = start(); answer(p);
  const state = [...p.vars], at = tile(p);
  run(p, '[proc,macro_event_logout]'); p.closeModal(); p.timers.clear();
  run(p, '[queue,macro_event_login]');
  assert.equal(p.getVar(v('macro_transmit')), state[v('macro_transmit')]);
  assert.equal(p.getVar(v('xplamp')), state[v('xplamp')]);
  assert.deepEqual(tile(p), at); assert.equal(p.modalMain, id('Component', 'inter_134'));
  complete(p); assert.deepEqual(tile(p), O);
});
check('Pillory valid escape cleans state and tabs without a reward', () => {
  const p = start(); const before = inventory(p);
  // Labelled ordinary caller boundary: close the puzzle before the valid teleport.
  p.closeModal();
  run(p, '[proc,p_telejump_safe]', [coord(O)]);
  run(p, '[softtimer,macro_arena_guard]'); environmentTick(p);
  assert.equal(p.getVar(v('macro_event')), 0); assert.deepEqual(inventory(p), before);
  assert.equal(p.tabs[3], id('Component', 'inventory'));
  assert.equal(result(run(p, '[proc,macro_arena_active]', [event])), 0);
});
check('Prison keys are private untradeable event items', () => assert.equal(types.ObjType.get(id('ObjType', 'prisonpete_key')).tradeable, false));
console.log('Pillory compiled checks passed');
// Native World imports own workers; every assertion above is synchronous and complete.
process.exit(0);
