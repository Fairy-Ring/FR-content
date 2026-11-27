import assert from 'node:assert/strict';
import { player, run, draws, check, tile, O, coord, v, result, World, Environment, inventory, inv, obj, id, map, types, ScriptRunner, op, environmentTick } from './runtime.mjs';
const memberPool = [1,2,3,4,5,6,8,9,10,11,12,13,14,20,21,23,24,15,16,17,18,19];
check('random-event tab policy retains Logout and Options while hiding gameplay tabs', () => {
  const p = player(), before = [...p.tabs];
  run(p, '[proc,macro_events_hide_tabs]');
  for (const tab of [0,1,2,3,4,5,6,12]) assert.equal(p.tabs[tab], -1, `gameplay tab ${tab} is hidden`);
  for (const tab of [8,9,10,11,13]) {
    assert.notEqual(before[tab], -1, `native utility tab ${tab} is initialized`);
    assert.equal(p.tabs[tab], before[tab], `utility tab ${tab} remains accessible`);
  }
});
const freePool = memberPool.filter(event => event < 15 && ![6,10].includes(event));
const memberCombatPool = memberPool.filter(event => event <= 15);
for (const members of [false, true]) check(`${members ? 'members' : 'free'} registry exact eligible event set and equal selector slots`, () => {
  const old = Environment.NODE_MEMBERS; Environment.NODE_MEMBERS = members;
  try {
    const p = player(), expected = members ? memberPool : freePool;
    assert.equal(result(run(p, '[proc,macro_event_general_count]')), expected.length);
    const actual = expected.map((_, index) => draws({ '[proc,macro_event_set_random]': [index] }, () => result(run(p, '[proc,macro_event_set_random]'))));
    assert.deepEqual(actual, expected);
    assert(!actual.includes(7) && !actual.includes(22), 'teleport-matrix and thieving-only tasks are not generic afk events');
    p.setVar(v('lastcombat'), World.currentTick);
    const combatPool = members ? memberCombatPool : freePool;
    assert.equal(result(run(p, '[proc,macro_event_general_count]')), combatPool.length);
    const combatActual = combatPool.map((_, index) => draws({ '[proc,macro_event_set_random]': [index] }, () => result(run(p, '[proc,macro_event_set_random]'))));
    assert.deepEqual(combatActual, combatPool, 'combat selector retains only registered non-teleport actors');
    if (members) assert(combatPool.includes(15), 'Arnav remains eligible during members combat');
  } finally { Environment.NODE_MEMBERS = old; }
});
const arena1Starts = [
  [15, O],
  [16, [0, 3163, 4817]],
  [17, [0, 2524, 4778]],
  [18, [0, 2600, 4774]],
  [19, [0, 1927, 5003]]
];
for (const [event, destination] of arena1Starts) check(`general scheduler dispatches arenas1 event ${event}`, () => {
  const old = Environment.NODE_MEMBERS; Environment.NODE_MEMBERS = true;
  try {
    const p = player();
    run(p, '[proc,macro_event_general_spawn]', [event]);
    assert.equal(p.getVar(v('macro_event')), event);
    assert.deepEqual(tile(p), destination);
    assert.equal(p.getVar(v('macro_event_target_coord')), coord(destination));
    run(p, '[proc,macro_event_cleanup]', [event, p.getVar(v('macro_event_uid'))]);
    assert.equal(p.getVar(v('macro_event')), 0);
  } finally { Environment.NODE_MEMBERS = old; }
});
for (const event of [16, 17, 18, 19]) for (const [label, members] of [['F2P', false], ['recent combat', true]]) {
  check(`${label} refuses arenas1 event ${event} from scheduler and direct entry`, () => {
    const old = Environment.NODE_MEMBERS; Environment.NODE_MEMBERS = members;
    try {
      const p = player();
      if (label === 'recent combat') p.setVar(v('lastcombat'), World.currentTick);
      const before = [...p.vars];
      run(p, '[proc,macro_event_general_spawn]', [event]);
      assert.deepEqual([...p.vars], before, 'scheduler guard rejects before admission writes state');
      const destination = arena1Starts.find(([candidate]) => candidate === event)[1];
      assert.equal(result(run(p, '[proc,macro_arena1_enter]', [event, coord(destination)])), 0);
      assert.deepEqual([...p.vars], before, 'direct entry guard rejects before admission writes state');
      assert.deepEqual(tile(p), O);
    } finally { Environment.NODE_MEMBERS = old; }
  });
}
check('members combat admits Arnav while excluding teleport arenas', () => {
  const old = Environment.NODE_MEMBERS; Environment.NODE_MEMBERS = true;
  try {
    const p = player(); p.setVar(v('lastcombat'), World.currentTick);
    const index = memberCombatPool.indexOf(15);
    assert.notEqual(index, -1);
    assert.equal(draws({ '[proc,macro_event_set_random]': [index] }, () => result(run(p, '[proc,macro_event_set_random]'))), 15);
    run(p, '[proc,macro_event_general_spawn]', [15]);
    assert.equal(p.getVar(v('macro_event')), 15);
    run(p, '[proc,macro_event_cleanup]', [15, p.getVar(v('macro_event_uid'))]);
  } finally { Environment.NODE_MEMBERS = old; }
});
for (const [label, mapX, mapZ] of [
  ['Drill', 49, 75], ['Bob', 39, 74], ['Forester', 40, 74], ['Leo', 30, 78]
]) for (let level = 0; level <= 3; level++) check(`${label} destination scene is protected on plane ${level}`, () => {
  const at = [level, mapX * 64 + 32, mapZ * 64 + 32];
  const p = player(at), before = [...p.vars];
  assert.equal(result(run(p, '[proc,macro_event_allowed]')), 0);
  run(p, '[proc,macro_event_general_spawn]', [2]);
  assert.deepEqual([...p.vars], before);
  assert.deepEqual(tile(p), at);
});
for (const enabled of [false, true]) check(`real AFK_EVENT opcode with scheduler flag ${enabled}`, () => {
  const old = Environment.NODE_RANDOM_EVENTS; Environment.NODE_RANDOM_EVENTS = enabled;
  try {
    const p = player(); p.afkEventReady = true;
    draws({ '[proc,macro_event_set_random]': [1] }, () => run(p, '[timer,general_macro_events]'));
    assert.equal(p.getVar(v('macro_event')), enabled ? 2 : 0);
    assert.equal(p.afkEventReady, false, 'the native engine consumes or clears readiness on either opcode result');
    if (enabled) run(p, '[proc,macro_event_cleanup]', [2, p.getVar(v('macro_event_uid'))]);
    assert.deepEqual(tile(p), O);
  } finally { Environment.NODE_RANDOM_EVENTS = old; }
});
for (const [label, at] of [
  ['tutorial', [0, 3095, 3107]], ['maze', [0, 2923, 4597]], ['mime', [0, 2010, 4765]],
  ['quiz', [0, 1952, 4768]], ['prison', [0, 2090, 4430]], ['recruitment trial', [0, 2440, 4960]],
  ['recipe final arena', [0, 1880, 5340]], ['fight pits waiting', [0, 2400, 5172]],
  ['fight pits arena', [0, 2400, 5140]], ['rogues den maze', [1, 3000, 5050]],
  ['mage training', [0, 3335, 9630]], ['castle wars', [0, 2400, 3100]], ['mage arena', [0, 3100, 3930]]
]) check(`targeting refuses ${label} before consuming a ready event`, () => {
  const p = player(at); p.afkEventReady = true;
  assert.equal(result(run(p, '[proc,macro_event_allowed]')), 0);
  const before = [...p.vars]; run(p, '[proc,macro_event_general_spawn]', [2]);
  assert.deepEqual([...p.vars], before); assert.equal(p.afkEventReady, true); assert.deepEqual(tile(p), at);
});
check('targeting refuses every dynamic instance, even outside known quest footprints', () => {
  const sw = World.instances.createInstance(1, 1, 1);
  try {
    const p = player([sw.level, sw.x, sw.z]);
    assert.equal(result(run(p, '[proc,macro_event_allowed]')), 0);
    run(p, '[proc,macro_event_general_spawn]', [2]); assert.equal(p.getVar(v('macro_event')), 0);
  } finally { World.instances.playerEntered(sw); World.instances.playerLeft(sw); }
});
for (const variable of ['cutscene_var', 'mm_cutscene_part']) check(`${variable} blocks random admission without changing the quest`, () => {
  const p = player(); p.setVar(v(variable), 1); const before = [...p.vars];
  run(p, '[proc,macro_event_general_spawn]', [2]); assert.deepEqual([...p.vars], before);
});
check('ordinary town and underground mining remain eligible; existing event blocks replacement', () => {
  for (const at of [O, [0, 3040, 9770], [0, 2950, 4507], [0, 2915, 4845]]) assert.equal(result(run(player(at), '[proc,macro_event_allowed]')), 1);
  const p = player(); run(p, '[proc,macro_event_general_spawn]', [2]);
  const before = [...p.vars]; run(p, '[proc,macro_event_general_spawn]', [20]); assert.deepEqual([...p.vars], before);
  run(p, '[proc,macro_event_cleanup]', [2, p.getVar(v('macro_event_uid'))]);
});
for (const variable of ['lastcombat', 'lastcombat_pvp']) check(`${variable} blocks teleport arenas but retains U01 follower combat admission`, () => {
  const p = player(); p.setVar(v(variable), World.currentTick);
  const before = [...p.vars]; run(p, '[proc,macro_event_general_spawn]', [20]);
  assert.deepEqual([...p.vars], before); assert.deepEqual(tile(p), O);
  run(p, '[proc,macro_event_general_spawn]', [2]); assert.equal(p.getVar(v('macro_event')), 2);
  run(p, '[proc,macro_event_cleanup]', [2, p.getVar(v('macro_event_uid'))]);
  World.currentTick += 16;
  assert.equal(result(run(p, '[proc,macro_arena_combat_allowed]')), 1);
});
for (const [label, root, draw] of [['pickpocket', '[label,macro_randomthieving]', 1], ['chest', '[label,macro_randomthievingchest]', 2]]) check(`ordinary ${label} scheduling can select thieving-only Pillory`, () => {
  const p = player();
  draws({ [root]: [draw], '[proc,macro_pillory_start]': [0] }, () => run(p, root));
  assert.equal(p.getVar(v('macro_event')), 22);
  run(p, '[proc,macro_arena_return]', [22]); assert.deepEqual(tile(p), O);
});
check('lossless rewards bank when inventory is full', () => {
  const p = player(); p.invAdd(inv, obj('logs'), 28);
  const before = inventory(p); run(p, '[proc,macro_arena_reward]', [obj('uncut_sapphire'), 1]);
  assert.deepEqual(inventory(p), before); assert.equal(p.invTotal(id('InvType', 'bank'), obj('uncut_sapphire')), 1);
});
check('released follower failure teleports once and stale queue cannot affect a new arena', () => {
  const p = player(); run(p, '[proc,macro_event_general_spawn]', [2]); const actor = p.getVar(v('macro_event_uid'));
  p.setVar(v('macro_event'), 0); // Existing actor's published failure boundary only.
  run(p, '[queue,macro_event_fail_teleport]', [0, actor]);
  assert.notDeepEqual(tile(p), O); assert.equal(p.getVar(v('macro_event_uid')), -1);
  const at = tile(p); run(p, '[queue,macro_event_fail_teleport]', [0, actor]); assert.deepEqual(tile(p), at, 'released token cannot be replayed');
  [p.level,p.x,p.z] = O;
  draws({ '[proc,macro_pillory_start]': [0] }, () => run(p, '[proc,macro_event_general_spawn]', [22]));
  const before = [...p.vars], cage = tile(p);
  run(p, '[queue,macro_event_fail_teleport]', [0, actor]); assert.deepEqual([...p.vars], before); assert.deepEqual(tile(p), cage);
  run(p, '[proc,macro_arena_return]', [22]);
});
check('failure delay rechecks the exact token before teleporting', () => {
  const p = player(); run(p, '[proc,macro_event_general_spawn]', [2]); const actor = p.getVar(v('macro_event_uid'));
  p.setVar(v('macro_event'), 0);
  run(p, '[queue,macro_event_fail_teleport]', [0, actor], null, () => { p.setVar(v('macro_event'), 24); });
  assert.deepEqual(tile(p), O); assert.equal(p.getVar(v('macro_event')), 24);
});
for (const event of [20,21,22,23,24]) check(`arena ${event} persistent-only reload retains its identity and exact departure`, () => {
  const p = player();
  run(p, '[proc,macro_event_general_spawn]', [event]);
  assert.equal(p.getVar(v('macro_event')), event);
  run(p, '[proc,macro_event_logout]');
  const q = player(tile(p));
  for (let index = 0; index < p.vars.length; index++) if (types.VarPlayerType.get(index).scope === types.VarPlayerType.SCOPE_PERM) q.vars[index] = p.vars[index];
  run(q, '[queue,macro_event_login]');
  assert.equal(q.getVar(v('macro_event')), event);
  assert.equal(q.getVar(v('macro_event_origin_coord')), coord(O));
  run(q, '[proc,macro_arena_return]', [event]);
  assert.deepEqual(tile(q), O);
  run(p, '[proc,macro_event_cleanup]', [event, p.getVar(v('macro_event_uid'))]);
});
check('reserved arena clock is original server-only temporary slot 432', () => {
  const clock = types.VarPlayerType.get(v('macro_arena_clock'));
  assert.equal(clock.id, 432); assert.equal(clock.scope, types.VarPlayerType.SCOPE_TEMP);
  assert.equal(clock.protect, false); assert.equal(clock.transmit, false);
});
check('ordinary death aborts Pillory without reward or a later return to its cage', () => {
  const p = player();
  draws({ '[proc,macro_pillory_start]': [0] }, () => run(p, '[proc,macro_event_general_spawn]', [22]));
  // Labelled compiled fixture: enter the genuine ordinary-death queue at its zero-HP boundary.
  p.levels[3] = 0; p.closeModal();
  run(p, '[queue,player_death_default]');
  const respawn = tile(p);
  run(p, '[softtimer,macro_arena_guard]'); environmentTick(p);
  assert.equal(p.getVar(v('macro_event')), 0); assert.equal(p.getVar(v('macro_event_origin_coord')), -1);
  assert.deepEqual(tile(p), respawn); assert.deepEqual(inventory(p).filter(Boolean), []);
  run(p, '[queue,macro_event_login]'); assert.deepEqual(tile(p), respawn);
});
console.log('N330 compiled scheduler and lifecycle checks passed');
// Native World imports own workers; every assertion above is synchronous and complete.
process.exit(0);
