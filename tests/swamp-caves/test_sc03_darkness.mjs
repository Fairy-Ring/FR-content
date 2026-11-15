#!/usr/bin/env node
/** SC-03: the compiled area controller, production operations and world phases. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  World, PlayerLoading, Packet, ScriptProvider, ScriptState, ServerTriggerType,
  PlayerStat, PlayerTimerType, types, map, CollisionType, engineModule, contentRoot,
  id, obj, inv, worn, player, seed, inventory, count, slotOf, use, held, remove,
  execute, tile, environmentTick, button, invButton, startDialogue, resumeDialogue, dialoguePage
} from './runtime.mjs';

const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const { Interaction } = await engineModule('engine/entity/Interaction.ts');
const { NetworkPlayer } = await engineModule('engine/entity/NetworkPlayer.ts');
const ClientSocket = (await engineModule('server/ClientSocket.ts')).default;
const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const ScriptPointer = (await engineModule('engine/script/ScriptPointer.ts')).default;
const Npc = (await engineModule('engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await engineModule('engine/entity/EntityLifeCycle.ts');
const OpObj = (await engineModule('network/game/client/model/OpObj.ts')).default;
const pickupHandler = new (await engineModule('network/game/client/handler/OpObjHandler.ts')).default();
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const locHandler = new (await engineModule('network/game/client/handler/OpLocHandler.ts')).default();
const flag = id('VarBitType', 'darkness_level');
const gas = id('VarBitType', 'swamp_gas_turns');
const parent = id('VarPlayerType', 'goblin_caves');
const controller = ScriptProvider.getByName('[softtimer,swamp_cave_environment]');
assert(controller, 'build the SC-03 script pack first');
const roots = ['inter_387', 'inter_248', 'inter_250', 'inter_249'].map(name => id('Component', name));
const warning = ['You hear tiny insects skittering over the ground...', 'Tiny biting insects swarm all over you!'];
const transientMask = (3 << 1) | (7 << 6);
let cases = 0, failures = 0, wireSerial = 1999;
function test(name, action) {
  cases++;
  try { action(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack ?? error}`); }
}
const timer = p => p.timers.get(controller.id);
const light = p => execute('[proc,swamp_cave_light]', p).popInt();
const inside = (p, coord = CoordGrid.packCoord(p.level, p.x, p.z)) => execute('[proc,swamp_cave_inside]', p, [coord]).popInt() === 1;
const hp = p => p.levels[PlayerStat.HITPOINTS];
const rootPackets = p => p.packets.filter(packet => packet.constructor.name === 'IfOpenOverlay');
const parentPackets = p => p.packets.filter(packet => /^Varp(Small|Large)$/.test(packet.constructor.name) && packet.varp === parent);
function ownership(p, expected = true) {
  assert.equal(p.getVarBit(flag), Number(expected), 'original 278 is the ownership flag');
  assert.equal(p.timers.has(controller.id), expected, 'flag exactly matches the actual engine timer table');
  if (expected) assert.equal(timer(p).type, PlayerTimerType.SOFT);
}
function fixture(items = [], position = [0, 3168, 9572]) {
  const p = seed(player(), items);
  [p.level, p.x, p.z] = position;
  return p;
}
function start(p) { execute('[proc,swamp_cave_start]', p); ownership(p); return p; }
function release(p) { execute('[proc,swamp_cave_release]', p); ownership(p, false); }
function ticks(p, n, others = []) { for (let i = 0; i < n; i++) environmentTick(p, ...others); }
function elapsed(p, value) { ownership(p); assert.equal(timer(p).args[0], value, 'elapsed darkness is a timer argument'); }
function pending(p, darkTicks = 29) {
  const t = timer(p);
  t.args = [darkTicks, t.args[1], 0, obj('lit_candle'), 6];
  p.setVarBit(gas, 6);
}
function noNewPresentation(p) {
  assert.equal(p.animId, -1, 'no darkness animation');
  assert.equal(p.spotanimId, -1, 'no darkness spotanim');
  assert(!p.packets.some(packet => /Synth|Spotanim|IfSetText/.test(packet.constructor.name)), 'no invented sound, effect or text-clearing packet');
}
function reload(p) {
  const bytes = p.save();
  assert(PlayerLoading.verify(new Packet(bytes)), 'production save checksum');
  const q = PlayerLoading.load(p.username, new Packet(bytes), null);
  q.pid = p.pid; q.slot = p.slot; q.uid = p.uid; q.isActive = true;
  q.messages = []; q.packets = [];
  q.write = packet => q.packets.push(packet);
  q.messageGame = message => q.messages.push(String(message));
  q.wrappedMessageGame = q.messageGame;
  World.players[q.pid] = q;
  World.playerLoop.add(q.hash64, q);
  return q;
}
function npc(p, name = 'cow') {
  const type = types.NpcType.get(id('NpcType', name));
  const n = new Npc(p.level, p.x + 1, p.z, type.size, type.size, EntityLifeCycle.RESPAWN, World.npcs.next(), type.id, type.blockwalk);
  World.addNpc(n, -1);
  n.lastMovement = -100;
  return n;
}

const litForms = [
  ['lit_candle', 1], ['lit_black_candle', 1], ['torch_lit', 1],
  ['candle_lantern_lit', 1], ['candle_lantern_black_lit', 1],
  ['oil_lamp_lit', 2], ['oil_lantern_lit', 2], ['tog_sapphire_lantern_lit', 2],
  ['cave_goblin_mining_helmet_lit', 2], ['bullseye_lantern_lit', 3]
];
const zeroForms = [
  'unlit_candle', 'unlit_black_candle', 'torch_unlit', 'candle_lantern_empty',
  'candle_lantern_unlit', 'candle_lantern_black_unlit', 'oil_lamp_empty',
  'oil_lamp_unlit', 'oil_lantern_empty', 'oil_lantern_unlit',
  'bullseye_lantern_empty', 'bullseye_lantern_unlit', 'bullseye_lantern_nolens',
  'tog_sapphire_lantern_empty', 'tog_sapphire_lantern_unlit',
  'cave_goblin_mining_helmet_unlit', 'slayer_buglan_off', 'slayer_buglan_on', 'hammer'
];
for (const [name, value] of [...litForms, ...zeroForms.map(name => [name, 0])]) {
  test(`carried ${name}: explicit brightness ${value}, correct original root`, () => {
    const p = fixture([name]);
    assert.equal(light(p), value);
    start(p); assert.equal(p.overlay, roots[value]);
    ticks(p, 1); elapsed(p, value ? 0 : 1);
    assert.equal(p.overlay, roots[value]);
    noNewPresentation(p);
    release(p);
  });
}
for (const [names, value] of [
  [['lit_candle', 'lit_black_candle'], 2],
  [['lit_candle', 'torch_lit', 'candle_lantern_lit'], 3],
  [['oil_lamp_lit', 'lit_candle'], 3],
  [['oil_lamp_lit', 'oil_lantern_lit'], 3],
  [['bullseye_lantern_lit', 'oil_lamp_lit', 'lit_candle'], 3]
]) test(`additive brightness caps at three: ${names.join('+')}`, () => {
  const p = start(fixture(names)); assert.equal(light(p), value); assert.equal(p.overlay, roots[value]); release(p);
});

test('real helmet/bug equip and removal, carried+worn addition, next eligible pass', () => {
  const p = start(fixture(['cave_goblin_mining_helmet_lit', 'lit_candle', 'slayer_buglan_on']));
  assert.equal(p.overlay, roots[3]);
  assert(held(p, 'cave_goblin_mining_helmet_lit', 2));
  assert.equal(count(p, 'cave_goblin_mining_helmet_lit', worn), 1);
  assert.equal(light(p), 3); ticks(p, 1); assert.equal(p.overlay, roots[3]);
  assert(remove(p, 'cave_goblin_mining_helmet_lit'));
  assert.equal(light(p), 3);
  assert(held(p, 'slayer_buglan_on', 2));
  assert.equal(light(p), 3, 'bug contributes zero even when legally worn');
  assert(remove(p, 'slayer_buglan_on')); ownership(p); release(p);
});

test('real drop and pickup exclude floor light and recompute on the next pass', () => {
  const p = start(fixture(['bullseye_lantern_lit']));
  assert(held(p, 'bullseye_lantern_lit', 5));
  assert.equal(light(p), 0); assert.equal(p.overlay, roots[3], 'polling has not run yet');
  ticks(p, 1); assert.equal(p.overlay, roots[0]); elapsed(p, 1);
  const ground = World.getObj(p.x, p.z, p.level, obj('bullseye_lantern_lit'), p.hash64);
  assert(ground, 'drop creates a real ground object');
  p.buildArea.rebuild(true);
  assert(pickupHandler.handle(new OpObj(3, p.x, p.z, ground.type), p));
  p.resetEntity(false); p.processInteraction();
  assert.equal(count(p, 'bullseye_lantern_lit'), 1, 'production pickup settles the item');
  assert.equal(p.overlay, roots[0], 'pickup has no cave inventory hook');
  ticks(p, 1); assert.equal(p.overlay, roots[3]); elapsed(p, 0); release(p);
});

test('other player light never illuminates this player', () => {
  const p = start(fixture()), q = start(fixture(['bullseye_lantern_lit']));
  ticks(p, 15, [q]);
  assert.equal(p.overlay, roots[0]); assert.equal(q.overlay, roots[3]);
  assert.deepEqual(p.messages, [warning[0]]); assert.deepEqual(q.messages, []);
  elapsed(p, 15); elapsed(q, 0); release(p); release(q);
});

test('exact eligible ticks 14/15/29/30/31; two once-only warnings and one bite per tick', () => {
  const p = start(fixture());
  const before = hp(p);
  ticks(p, 14); elapsed(p, 14); assert.deepEqual(p.messages, []); assert.equal(hp(p), before);
  ticks(p, 1); elapsed(p, 15); assert.deepEqual(p.messages, [warning[0]]); assert.equal(hp(p), before);
  ticks(p, 14); elapsed(p, 29); assert.deepEqual(p.messages, [warning[0]]); assert.equal(hp(p), before);
  ticks(p, 1); elapsed(p, 30); assert.deepEqual(p.messages, warning); assert.equal(hp(p), before - 1);
  assert.equal(p.hitmarkDamage, 1); assert.equal(p.hitmarkType, 1);
  ticks(p, 1); elapsed(p, 30); assert.deepEqual(p.messages, warning); assert.equal(hp(p), before - 2);
  ticks(p, 3); assert.equal(hp(p), before - 5); assert.deepEqual(p.messages, warning);
  noNewPresentation(p); release(p);
});
for (const at of [14, 29, 31]) test(`real oil-lantern relight at ${at} resets elapsed and stops further bites`, () => {
  const p = start(fixture(['tinderbox', 'oil_lantern_unlit']));
  ticks(p, at); const before = hp(p);
  assert(use(p, 'tinderbox', 'oil_lantern_unlit'));
  assert.equal(p.overlay, roots[0], 'real ignition does not add a second controller');
  ticks(p, 1); elapsed(p, 0); assert.equal(p.overlay, roots[2]);
  ticks(p, 35); assert.equal(hp(p), before, 'no further bite after real relighting');
  assert(held(p, 'oil_lantern_lit', 2)); ticks(p, 14); elapsed(p, 14);
  assert.equal(hp(p), before, 'new unlit interval starts at zero');
  release(p);
});
for (const at of [14, 29]) test(`repeated map-square/start hints at elapsed ${at} preserve the actual timer and all state`, () => {
  const p = start(fixture()); ticks(p, at);
  const before = structuredClone(timer(p).args), clock = timer(p).clock;
  for (const root of ['[proc,swamp_cave_start]', '[mapzone,0_49_149]', '[proc,swamp_cave_start]']) execute(root, p);
  assert.deepEqual(timer(p).args, before); assert.equal(timer(p).clock, clock);
  assert.equal([...p.timers.values()].filter(t => t.script.id === controller.id).length, 1);
  ticks(p, 1); elapsed(p, at + 1);
  assert.deepEqual(p.messages, at === 14 ? [warning[0]] : warning);
  release(p);
});

test('modal pauses the eligible clock without catch-up and keeps one timer', () => {
  const p = start(fixture()); ticks(p, 14);
  p.openMainModal(id('Component', 'trademain'));
  ticks(p, 20); elapsed(p, 14); assert.deepEqual(p.messages, []);
  p.closeModal(); ticks(p, 1); elapsed(p, 15); assert.deepEqual(p.messages, [warning[0]]); release(p);
});
test('a real delay pauses the clock, then resumes exactly once at its deadline', () => {
  const p = start(fixture()); ticks(p, 29);
  p.delayed = true; p.delayedUntil = World.currentTick + 5;
  ticks(p, 4); elapsed(p, 29); assert.equal(hp(p), 99);
  ticks(p, 1); elapsed(p, 30); assert.equal(hp(p), 98); release(p);
});
test('failed protected-player acquisition pauses without changing clock or overlay', () => {
  const p = start(fixture()); ticks(p, 14);
  p.protect = true; World.currentTick++; p.processTimers(PlayerTimerType.SOFT);
  elapsed(p, 14); assert.deepEqual(p.messages, []);
  ticks(p, 1); elapsed(p, 15); release(p);
});
for (const mode of ['free', 'modal', 'delay', 'protected']) test(`missed-exit fallback ${mode}: no outside effect, fresh arguments, release on first free pass`, () => {
  const p = start(fixture()); pending(p); const before = hp(p);
  [p.level, p.x, p.z] = [0, 3220, 3220];
  if (mode === 'modal') p.openMainModal(id('Component', 'trademain'));
  if (mode === 'delay') { p.delayed = true; p.delayedUntil = World.currentTick + 5; }
  if (mode === 'protected') {
    p.protect = true; World.currentTick++; p.processTimers(PlayerTimerType.SOFT);
  } else ticks(p, mode === 'free' ? 1 : 4);
  assert.equal(hp(p), before); assert.deepEqual(p.messages, []);
  if (mode !== 'free') {
    ownership(p); assert.equal(p.overlay, roots[0]);
    assert.deepEqual(timer(p).args, [0, roots[0], -1, -1, 0], 'elapsed and pending effects discarded before acquisition');
    assert.equal(p.getVarBit(gas), 6, 'protected transmitted field waits for the release');
    if (mode === 'modal') { assert(p.busy()); p.closeModal(); }
    ticks(p, 1);
  }
  ownership(p, false); assert.equal(p.overlay, -1); assert.equal(p.getVarBit(gas), 0);
  ticks(p, 35); assert.equal(hp(p), before); ownership(p, false);
});
test('busy outside then inside before release: same ownership, fresh darkness/gas clocks', () => {
  const p = start(fixture()); pending(p); p.openMainModal(id('Component', 'trademain'));
  p.x = 3220; p.z = 3220; ticks(p, 2); elapsed(p, 0);
  p.x = 3168; p.z = 9572; p.closeModal(); ticks(p, 1);
  elapsed(p, 1); assert.deepEqual(timer(p).args.slice(2), [-1, -1, 0]); assert.equal(hp(p), 99); release(p);
});

const darkRects = [[0, 3145, 3258, 9540, 9600], [0, 3221, 3325, 9601, 9657], [2, 3212, 3239, 9523, 9532]];
for (const [level, minX, maxX, minZ, maxZ] of darkRects) test(`inclusive dark rectangle ${level}:${minX},${minZ}; all edges and planes`, () => {
  const p = player();
  for (const l of [0, 1, 2, 3]) for (const x of [minX - 1, minX, minX + 1, maxX - 1, maxX, maxX + 1]) for (const z of [minZ - 1, minZ, minZ + 1, maxZ - 1, maxZ, maxZ + 1]) {
    const expected = darkRects.some(([plane, a, b, c, d]) => plane === l && x >= a && x <= b && z >= c && z <= d);
    assert.equal(inside(p, CoordGrid.packCoord(l, x, z)), expected, `${l},${x},${z}`);
  }
});
for (const [name, position, expected] of [
  ['main', [0, 3168, 9572], true], ['frog pocket', [0, 3225, 9542], true],
  ['maze/mine', [0, 3318, 9615], true], ['Tears entry', [2, 3218, 9532], true],
  ['castle cellar', [0, 3209, 9616], false], ['random-event cellar', [0, 3206, 9615], false],
  ['wall airlock', [0, 3219, 9616], false], ['Juna side', [2, 3244, 9500], false],
  ['bowl room', [2, 3227, 9500], false], ['behind Juna', [2, 3252, 9517], false],
  ['rock ledge', [2, 3238, 9498], false], ['approach outside', [2, 3241, 9524], false]
]) test(`${name} is ${expected ? 'dark' : 'non-dark'} independently of map-square name`, () => {
  const p = fixture([], position); assert.equal(inside(p), expected);
  execute('[proc,swamp_cave_start]', p); ownership(p, expected);
  if (expected) release(p); else assert.equal(p.overlay, -1);
});

// Observe production dispatch without replacing a trigger, movement or queue.
function traceScripts(action) {
  const original = ScriptRunner.init, names = [];
  ScriptRunner.init = function(script, ...args) {
    names.push(script.name);
    return original.call(this, script, ...args);
  };
  try { action(names); } finally { ScriptRunner.init = original; }
  return names;
}
function engineEntry(position = [0, 3168, 9572]) {
  const p = wireFixture([], [0, 3220, 3220]);
  p.teleport(p.x, p.z, p.level); ticks(p, 1);
  p.packets.length = 0; p.messages.length = 0;
  p.teleport(position[1], position[2], position[0]);
  ticks(p, 1); ownership(p); elapsed(p, 0);
  p.encodeOut();
  assert.equal(rootPackets(p).length, 1);
  return p;
}
function caveRoute(p, reached) {
  const queue = [[p.x, p.z]], previous = new Map([[`${p.x},${p.z}`, null]]);
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i], key = `${x},${z}`;
    if (reached(x, z)) {
      const route = [];
      for (let at = key; previous.get(at) !== null; at = previous.get(at)) route.push(at.split(',').map(Number));
      return route.reverse();
    }
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const next = `${x + dx},${z + dz}`;
      if (previous.has(next) || !map.canTravel(p.level, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
      if (!inside(p, CoordGrid.packCoord(p.level, x + dx, z + dz))) continue;
      previous.set(next, key); queue.push([x + dx, z + dz]);
    }
  }
  assert.fail('a real cave walking route must reach the requested zone boundary');
}
for (const crossing of ['several zones', 'map square']) test(`engine entry and real walk across ${crossing} preserve clocks, pending identity and one root`, () => {
  traceScripts(names => {
    const p = engineEntry(), origin = [p.x >> 3, p.z >> 3], mapOrigin = [p.x >> 6, p.z >> 6];
    ticks(p, 14); pending(p, 14);
    const route = caveRoute(p, (x, z) => crossing === 'map square'
      ? (x >> 6) !== mapOrigin[0] || (z >> 6) !== mapOrigin[1]
      : Math.abs((x >> 3) - origin[0]) + Math.abs((z >> 3) - origin[1]) >= 3);
    const before = hp(p), pendingArgs = structuredClone(timer(p).args.slice(2));
    let crossings = 0;
    for (const [x, z] of route) {
      const oldZone = [p.x >> 3, p.z >> 3];
      p.queueWaypoint(x, z); ticks(p, 1);
      assert.deepEqual(tile(p), [0, x, z], 'engine collision-checked walking reaches each tile');
      if ((p.x >> 3) !== oldZone[0] || (p.z >> 3) !== oldZone[1]) crossings++;
    }
    ticks(p, 1); // The final step queues its zone callbacks for the next engine phase.
    p.encodeOut();
    elapsed(p, Math.min(30, 14 + route.length + 1));
    assert.equal(hp(p), before - Math.max(0, 14 + route.length + 1 - 29));
    assert.deepEqual(timer(p).args.slice(2), pendingArgs);
    assert.equal([...p.timers.values()].filter(t => t.script.id === controller.id).length, 1);
    assert.equal(rootPackets(p).length, 1, 'internal exits must not close and reopen the root');
    assert(names.some(name => name.startsWith('[zoneexit,')));
    assert(names.filter(name => name.startsWith('[zone,')).length > 1);
    if (crossing === 'several zones') assert(crossings >= 3);
    else {
      assert(names.includes('[mapzoneexit,0_49_149]'));
      assert(names.includes('[mapzone,0_50_149]'), 'real hinted map-square crossing');
    }
    release(p);
  });
});
for (const [kind, from, to, expected] of [
  ['same map square', [0, 3168, 9572], [0, 3168, 9538], '[zoneexit,0_49_149_32_32]'],
  ['plane change', [0, 3168, 9572], [1, 3168, 9572], '[zoneexit,0_49_149_32_32]'],
  ...[
    [[0, 3168, 9572], '0_49_149'], [[0, 3225, 9542], '0_50_149'],
    [[0, 3168, 9600], '0_49_150'], [[0, 3225, 9616], '0_50_150'],
    [[0, 3318, 9615], '0_51_150'], [[2, 3218, 9532], '0_50_148']
  ].map(([position, key]) => [`map-square ${key}`, position, [0, 3220, 3220], `[mapzoneexit,${key}]`])
]) test(`real engine exit ${kind} dispatches the published exit hook`, () => {
  const p = engineEntry(from); ticks(p, 14); pending(p, 14);
  const before = hp(p);
  p.teleport(to[1], to[2], to[0]);
  assert([...p.engineQueue.all()].some(request => request.script.name === expected));
  // Drain the actual engine queue independently of the soft-timer fallback,
  // which normally runs first. This proves that the queued hook itself releases.
  p.resetEntity(false);
  const names = traceScripts(() => p.processEngineQueue());
  assert(names.includes(expected)); ownership(p, false);
  p.encodeOut();
  assert.equal(p.overlay, -1); assert.equal(p.getVarBit(gas), 0);
  ticks(p, 35); assert.equal(hp(p), before); assert.deepEqual(p.messages, []);
});

test('each actual cave connected component has no ordinary walking edge outside the policy bounds', () => {
  for (const startTile of [[0, 3168, 9572], [0, 3225, 9542], [0, 3318, 9615], [2, 3218, 9532]]) {
    const [level] = startTile, queue = [startTile], seen = new Set([startTile.join(',')]);
    for (let i = 0; i < queue.length; i++) {
      const [, x, z] = queue[i];
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        if (!map.canTravel(level, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
        const next = [level, x + dx, z + dz], key = next.join(',');
        assert(darkRects.some(([l, a, b, c, d]) => l === level && next[1] >= a && next[1] <= b && next[2] >= c && next[2] <= d), `walk exits darkness: ${queue[i]} -> ${next}`);
        if (!seen.has(key)) { seen.add(key); queue.push(next); }
      }
    }
    assert(seen.size > 100, 'flood reaches the cave rather than just a blocked anchor');
  }
});

test('guarded logout releases before session end; full saved-state login restarts fresh and keeps durable bits', () => {
  const p = fixture(['oil_lantern_lit']);
  const durable = (1 << 0) | (1 << 3) | (1 << 5) | (1 << 9) | (1 << 20);
  p.setVar(parent, durable); start(p); pending(p);
  execute('[logout,_]', p); ownership(p, false); assert.equal(p.overlay, -1);
  assert.equal(p.getVar(parent), durable);
  const q = reload(p); assert.equal(q.timers.size, 0);
  execute('[login,_]', q); ownership(q); elapsed(q, 0); assert.equal(q.overlay, roots[2]);
  assert.equal(q.getVar(parent) & ~transientMask, durable);
  release(q);
});
for (const position of [[0, 3220, 3220], [2, 3244, 9500]]) test(`saved outside/Juna login ${position} never claims cave ownership`, () => {
  const p = fixture(['oil_lantern_lit'], position); p.setVar(parent, 0x10022a);
  const q = reload(p); execute('[login,_]', q);
  ownership(q, false); assert.equal(q.getVar(parent), 0x10022a & ~transientMask);
  assert.equal(q.overlay, -1, 'published Juna HUD is granted by dialogue, not login (ruling 9)');
});

test('true reconnect retains exactly one actual timer and elapsed darkness; no repeated root resend', () => {
  const p = start(fixture()); ticks(p, 29);
  const before = structuredClone(timer(p).args), clock = timer(p).clock;
  p.packets.length = 0; p.onReconnect();
  ownership(p); assert.deepEqual(timer(p).args, before); assert.equal(timer(p).clock, clock);
  assert.equal(rootPackets(p).length, 0, 'published reconnect does not resend overlays');
  ticks(p, 1); elapsed(p, 30); assert.equal(hp(p), 98); release(p);
});

test('real trade offer and completed exchange: only the recipient owns the light; polling waits for modals', () => {
  const p = start(fixture(['bullseye_lantern_lit'])), q = start(fixture());
  execute('[opplayer4,_]', p, [], { target: q });
  p.resetEntity(false); q.resetEntity(false);
  execute('[opplayer4,_]', q, [], { target: p });
  assert.equal(p.modalMain, id('Component', 'trademain'));
  assert.equal(q.modalMain, id('Component', 'trademain'));
  assert(invButton(p, 'tradeside:inv', 'bullseye_lantern_lit', 1, slotOf(p, 'bullseye_lantern_lit')));
  assert.equal(light(p), 0); assert.equal(light(q), 0, 'tradeoffer is not carried light');
  ticks(p, 2, [q]); assert.equal(p.overlay, roots[3]); assert.equal(q.overlay, roots[0]);
  for (const [who, component] of [[p, 'trademain:accept'], [q, 'trademain:accept'], [p, 'tradeconfirm:accept'], [q, 'tradeconfirm:accept']]) {
    p.resetEntity(false); q.resetEntity(false); assert(button(who, component));
  }
  assert.equal(count(p, 'bullseye_lantern_lit'), 0); assert.equal(count(q, 'bullseye_lantern_lit'), 1);
  ticks(p, 1, [q]); assert.equal(p.overlay, roots[0]); assert.equal(q.overlay, roots[3]);
  elapsed(p, 1); elapsed(q, 0); release(p); release(q);
});

test('worn eligibility rejects a light put into a slot it cannot occupy', () => {
  const p = fixture();
  p.invSet(worn, obj('bullseye_lantern_lit'), 1, 0);
  assert.equal(light(p), 0, 'a non-equippable bullseye is not a worn source');
  p.invSet(worn, obj('cave_goblin_mining_helmet_lit'), 1, 3);
  assert.equal(light(p), 0, 'helmet in a hand slot contributes nothing');
  p.invSet(worn, obj('cave_goblin_mining_helmet_lit'), 1, 0);
  assert.equal(light(p), 2, 'same helmet in its actual slot is the control');
});

function wireFixture(items = [], position = [0, 3168, 9572]) {
  const slot = ++wireSerial, hash = BigInt(slot);
  const p = new NetworkPlayer(`sc03wire${slot}`, hash, hash, new ClientSocket());
  p.pid = slot; p.slot = slot; p.uid = ((slot << 11) | slot) >>> 0;
  [p.level, p.x, p.z] = position; p.isActive = true;
  p.vars.fill(0); p.baseLevels.fill(99); p.levels.fill(99);
  p.messages = []; p.packets = [];
  p.write = packet => p.packets.push(packet);
  p.messageGame = text => p.messages.push(String(text)); p.wrappedMessageGame = p.messageGame;
  World.players[p.pid] = p; World.playerLoop.add(p.hash64, p);
  const invCom = id('Component', 'inventory:inv');
  p.tabs[3] = types.Component.get(invCom).rootLayer;
  p.invListenOnCom(inv, invCom, p.uid);
  return seed(p, items);
}

test('actual network overlay packets: opaque replacement, root changes only, one parent packet at entry/release', () => {
  // Capture the real NetworkPlayer encoder's messages at the transport boundary.
  const p = wireFixture(['tinderbox', 'unlit_candle', 'oil_lamp_unlit']);
  const durable = 0x400229 & ~transientMask;
  p.setVar(parent, durable); p.packets.length = 0;
  start(p); p.encodeOut();
  assert.deepEqual(parentPackets(p).map(packet => packet.value), [durable | 2]);
  assert.deepEqual(rootPackets(p).map(packet => packet.component), [roots[0]]);
  ticks(p, 3); p.encodeOut(); assert.equal(rootPackets(p).length, 1); assert.equal(parentPackets(p).length, 1);
  assert(use(p, 'tinderbox', 'unlit_candle')); ticks(p, 1); p.encodeOut();
  assert(held(p, 'lit_candle', 1)); assert(use(p, 'tinderbox', 'oil_lamp_unlit')); ticks(p, 1); p.encodeOut();
  assert(use(p, 'tinderbox', 'unlit_candle')); ticks(p, 1); p.encodeOut();
  assert(held(p, 'lit_candle', 1)); assert(held(p, 'oil_lamp_lit', 2)); ticks(p, 1); p.encodeOut();
  assert.deepEqual(rootPackets(p).map(packet => packet.component), [roots[0], roots[1], roots[2], roots[3], roots[0]]);
  assert.equal(parentPackets(p).length, 1, 'brightness changes do not store or transmit 278');
  assert(!p.packets.some(packet => packet.constructor.name === 'IfSetText'), 'opaque original rectangle needs no text clearing');
  release(p); p.encodeOut();
  assert.deepEqual(parentPackets(p).map(packet => packet.value), [durable | 2, durable]);
  assert.deepEqual(rootPackets(p).map(packet => packet.component).slice(-1), [-1]);
  ticks(p, 35); p.encodeOut(); assert.equal(rootPackets(p).length, 6); assert.equal(parentPackets(p).length, 2);
});

const constant = (file, name) => {
  const match = readFileSync(`${contentRoot}/${file}`, 'utf8').match(new RegExp(`^\\^${name}\\s*=\\s*(\\d+)\\s*$`, 'm'));
  assert(match, `missing constant ${name}`); return Number(match[1]);
};
const damageStyles = 'scripts/skill_combat/configs/combat_damagetypes.constant';
const windStrike = constant('scripts/skill_combat/configs/magic/spells.constant', 'wind_strike');
for (const mode of ['melee', 'ranged', 'autocast', 'manual']) for (const continuation of [false, true]) for (const lit of [false, true]) {
  test(`${mode} ${continuation ? 'continuation' : 'initiation'} ${lit ? 'with' : 'without'} current light: real attack and resource control`, () => {
    const gear = mode === 'ranged' ? ['shortbow', 'bronze_arrow'] : mode === 'melee' ? ['rune_scimitar'] : ['staff_of_air'];
    const p = fixture([...gear, 'airrune', 'mindrune', ...(lit || continuation ? ['lit_candle'] : [])]), n = npc(p);
    p.invAdd(inv, obj('bronze_arrow'), 8); p.invAdd(inv, obj('mindrune'), 8);
    for (const item of gear) assert(held(p, item, 2), `equip ${item}`);
    p.setVar(id('VarPlayerType', 'damagetype'), constant(damageStyles, mode === 'ranged' ? 'ranged_style' : mode === 'autocast' ? 'magic_style' : 'stab_style'));
    if (mode === 'autocast') {
      p.setVarBit(id('VarBitType', 'autocast_spell'), windStrike);
      p.setVarBit(id('VarBitType', 'autocast_set'), 1);
      assert.equal(execute('[proc,player_autocast_enabled]', p).popInt(), 1);
    }
    const actionDelay = id('VarPlayerType', 'action_delay');
    const arm = () => p.setInteraction(Interaction.ENGINE, n, mode === 'manual' ? ServerTriggerType.APNPCT : ServerTriggerType.APNPC2,
      mode === 'manual' ? id('Component', 'magic:wind_strike') : -1);
    if (continuation) {
      const ammo = count(p, 'bronze_arrow', worn), runes = count(p, 'mindrune');
      arm();
      for (let i = 0; i < 3 && p.getVar(actionDelay) <= World.currentTick; i++) ticks(p, 1);
      assert(p.getVar(actionDelay) > World.currentTick, 'first real lit attack establishes its own future action delay');
      if (mode === 'ranged') assert.equal(count(p, 'bronze_arrow', worn), ammo - 1);
      if (mode === 'autocast' || mode === 'manual') assert.equal(count(p, 'mindrune'), runes - 1);
      if (!lit) assert(held(p, 'lit_candle', 1), 'real extinguish between attacks');
      if (mode === 'manual') arm(); // A second manual click, while its actual first-cast delay still holds.
    } else arm();
    const before = {
      inv: inventory(p), worn: inventory(p, worn), xp: [...p.stats], npc: [...n.levels],
      delay: p.getVar(actionDelay), queued: [...n.queue.all()].length,
      ammo: count(p, 'bronze_arrow', worn), runes: count(p, 'mindrune')
    };
    p.animId = -1; p.packets.length = 0; p.messages.length = 0;
    const until = Math.max(World.currentTick + 3, before.delay + 2);
    const names = traceScripts(() => {
      while (World.currentTick < until) ticks(p, 1);
    });
    assert(World.currentTick > before.delay, 'observation passes the genuine action-delay deadline');
    if (lit) {
      assert(p.getVar(actionDelay) > before.delay, 'an actual outgoing attack sets a new action delay');
      assert(p.animId !== -1 || p.packets.some(packet => /Synth|Spotanim/.test(packet.constructor.name)), 'actual attack presentation');
      if (mode === 'ranged') assert.equal(count(p, 'bronze_arrow', worn), before.ammo - 1, 'one arrow spent');
      if (mode === 'autocast' || mode === 'manual') {
        assert(names.includes('[apnpct,magic:wind_strike]'), 'engine executes the real spell follow-up');
        assert.equal(count(p, 'mindrune'), before.runes - 1, 'one mind rune spent');
        assert(p.stats[PlayerStat.MAGIC] > before.xp[PlayerStat.MAGIC], 'real cast XP');
      }
    } else {
      assert.deepEqual(inventory(p), before.inv); assert.deepEqual(inventory(p, worn), before.worn);
      assert.deepEqual([...p.stats], before.xp); assert.deepEqual([...n.levels], before.npc);
      assert.equal(p.getVar(actionDelay), before.delay, 'no outgoing attack after the deadline');
      assert.equal(p.animId, -1); assert.deepEqual(p.messages, []);
      assert(!p.packets.some(packet => /Synth|Spotanim/.test(packet.constructor.name)));
      assert.equal([...n.queue.all()].length, before.queued, 'no new outgoing damage or retaliation');
    }
    p.clearInteraction(); World.removeNpc(n, -1);
  });
}

test('incoming NPC melee still queues and applies its real damage while the player is unlit', () => {
  const p = start(fixture()), n = npc(p), before = hp(p);
  // Execute the real attack and consume its real damage queue; no substituted
  // handler or player-damage implementation participates in this assertion.
  const state = ScriptRunner.init(ScriptProvider.getByName('[proc,npc_meleeattack]'), n, p);
  state.pointerAdd(ScriptPointer.ProtectedActivePlayer);
  n.executeScript(state);
  assert.equal(state.execution, ScriptState.FINISHED);
  assert([...p.queue.all()].some(request => request.script.name === '[queue,combat_damage_player]'), 'incoming NPC damage queue remains');
  ticks(p, 2); assert(hp(p) <= before, 'real incoming hit processed, independently of light');
  ownership(p); World.removeNpc(n, -1); release(p);
});

for (const position of [[0, 3168, 9572], [0, 3225, 9542], [0, 3318, 9615], [2, 3218, 9532]]) {
  for (const mode of ['free', 'modal', 'delayed']) test(`real normal teleport from ${position}, ${mode}: release inside the protected transition`, () => {
    const p = start(fixture([], position)); pending(p);
    if (mode === 'modal') p.openMainModal(id('Component', 'trademain'));
    if (mode === 'delayed') { p.delayed = true; p.delayedUntil = World.currentTick + 3; }
    execute('[proc,player_teleport_normal]', p, [CoordGrid.packCoord(0, 3220, 3220)]);
    assert.deepEqual(tile(p), [0, 3220, 3220]); ownership(p, false); assert.equal(p.overlay, -1); assert.equal(p.getVarBit(gas), 0);
    const after = hp(p); ticks(p, 35); assert.equal(hp(p), after); ownership(p, false);
  });
}
test('protected dark-to-dark teleport preserves the single controller and elapsed/pending state', () => {
  const p = start(fixture()); pending(p); const before = structuredClone(timer(p).args);
  execute('[proc,p_telejump_safe]', p, [CoordGrid.packCoord(2, 3218, 9532)]);
  assert.deepEqual(tile(p), [2, 3218, 9532]); ownership(p);
  assert.deepEqual(timer(p).args, before); assert.equal(p.overlay, roots[0]); release(p);
});

for (const at of [5, 20, 31]) for (const path of ['raw exit', 'safe teleport']) {
  test(`${path} after ${at} actual dark ticks cancels warnings/bites and reentry starts fresh`, () => {
    const p = engineEntry(); ticks(p, at);
    assert.equal(hp(p), 99 - Math.max(0, at - 29), 'post-threshold case already received real bites');
    const before = hp(p), messages = p.messages.filter(message => warning.includes(message));
    if (path === 'safe teleport') execute('[proc,p_telejump_safe]', p, [CoordGrid.packCoord(0, 3220, 3220)]);
    else p.teleport(3168, 9538, 0);
    ticks(p, 1); ownership(p, false); assert.equal(p.overlay, -1);
    ticks(p, 35); assert.equal(hp(p), before);
    assert.deepEqual(p.messages.filter(message => warning.includes(message)), messages, 'no warning or bite after the exit');
    p.teleport(3168, 9572, 0); ticks(p, 1); ownership(p); elapsed(p, 0);
    assert.deepEqual(timer(p).args.slice(2), [-1, -1, 0]);
    p.messages.length = 0;
    ticks(p, 14); elapsed(p, 14); assert.deepEqual(p.messages, []); assert.equal(hp(p), before);
    ticks(p, 1); elapsed(p, 15); assert.deepEqual(p.messages, [warning[0]]);
    ticks(p, 14); assert.equal(hp(p), before);
    ticks(p, 1); assert.equal(hp(p), before - 1); assert.deepEqual(p.messages, warning);
    release(p);
  });
}

test('a real insect bite invokes the ordinary ring-of-life rescue, destruction and message', () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const ordinary = fixture(['ring_of_life'], [0, 3220, 3220]);
    assert(held(ordinary, 'ring_of_life', 2)); ordinary.levels[PlayerStat.HITPOINTS] = 10;
    execute('[proc,damage_self]', ordinary, [1]);
    const expected = { destination: tile(ordinary), ring: inventory(ordinary, worn),
      message: ordinary.messages.filter(message => message.includes('Ring of Life')), hp: hp(ordinary) };
    assert.equal(count(ordinary, 'ring_of_life', worn), 0);
    assert.deepEqual(expected.message, ['Your Ring of Life saves you and is destroyed in the process.']);
    const p = start(fixture(['ring_of_life']));
    assert(held(p, 'ring_of_life', 2)); p.levels[PlayerStat.HITPOINTS] = 10;
    ticks(p, 29); assert.equal(hp(p), 10); assert.equal(count(p, 'ring_of_life', worn), 1);
    ticks(p, 1); assert.equal(hp(p), 9, 'one bite reaches the same ten-percent threshold');
    assert.equal(count(p, 'ring_of_life', worn), 0, 'published ring check consumes the worn ring');
    assert(p.delayed, 'the published rescue is a real delayed normal teleport');
    for (let i = 0; i < 12 && inside(p); i++) {
      ticks(p, 1); assert.equal(hp(p), 9, 'no second bite during the rescue delay');
    }
    assert.deepEqual({ destination: tile(p), ring: inventory(p, worn),
      message: p.messages.filter(message => message.includes('Ring of Life')), hp: hp(p) }, expected);
    ownership(p, false); assert.equal(p.overlay, -1);
    const messages = [...p.messages]; ticks(p, 40);
    ownership(p, false); assert.equal(hp(p), 9); assert.deepEqual(p.messages, messages);
  } finally { Math.random = originalRandom; }
});

test('real ectophial Empty after 31 dark ticks releases before arrival and never bites there', () => {
  const p = start(fixture(['ectophial'])); ticks(p, 31);
  assert.equal(hp(p), 97);
  assert(held(p, 'ectophial', 1));
  assert.deepEqual(tile(p), [0, 3658, 3517]); ownership(p, false);
  assert.equal(p.overlay, -1); assert.equal(count(p, 'ectophial'), 0); assert.equal(count(p, 'ectophial_empty'), 1);
  assert.equal(p.delayed, false, 'the published ectophial has no player delay');
  const before = hp(p), messages = [...p.messages];
  ticks(p, 40); ownership(p, false); assert.equal(hp(p), before); assert.deepEqual(p.messages, messages);
});
for (const record of [1, 2]) test(`real commorb Playback ${record} after 31 dark ticks releases throughout the scene and returns with fresh clocks`, () => {
  const p = engineEntry();
  p.invAdd(inv, obj('wanted_crystal_ball'), 1);
  p.setVarBit(id('VarBitType', 'wanted_main'), constant('scripts/quests/quest_wanted/configs/wanted.constant', 'wanted_intelligence_open'));
  p.setVarBit(id('VarBitType', 'wanted_commorb_intel'), 1);
  ticks(p, 31); assert.equal(hp(p), 97);
  assert(held(p, 'wanted_crystal_ball', 4)); assert.equal(p.activeScript?.execution, ScriptState.PAUSEBUTTON);
  resumeDialogue(p, record);
  assert.equal(inside(p), false); ownership(p, false); assert.equal(p.overlay, -1);
  assert.equal(p.getVar(id('VarPlayerType', 'wanted_record_active')), record);
  const before = hp(p), warningsBefore = p.messages.filter(message => warning.includes(message));
  ticks(p, 35); assert.equal(hp(p), before); ownership(p, false);
  assert.deepEqual(p.messages.filter(message => warning.includes(message)), warningsBefore);
  for (let i = 0; i < 100 && p.activeScript; i++) {
    if (p.activeScript.execution === ScriptState.PAUSEBUTTON) resumeDialogue(p);
    else {
      assert.equal(p.activeScript.execution, ScriptState.SUSPENDED);
      ticks(p, 1);
    }
    assert.equal(hp(p), before, 'no cave bite during any scene delay or page');
  }
  assert.equal(p.activeScript, null, 'the actual record finishes');
  assert.deepEqual(tile(p), [0, 3168, 9572]);
  const names = traceScripts(() => ticks(p, 1));
  assert(names.some(name => name.startsWith('[zone,')), 'ordinary return hint is actually dispatched');
  ownership(p); elapsed(p, 0); assert.equal(p.overlay, roots[0]);
  assert.deepEqual(timer(p).args.slice(2), [-1, -1, 0]);
  assert.equal([...p.timers.values()].filter(t => t.script.id === controller.id).length, 1);
  ticks(p, 14); elapsed(p, 14); assert.equal(hp(p), before);
  release(p);
});
test('real Tears up after 31 dark ticks releases synchronously, including its own arrival delay', () => {
  const p = start(fixture([], [2, 3218, 9532])); ticks(p, 31); assert.equal(hp(p), 97);
  const loc = World.getLoc(3218, 9533, 2, id('LocType', 'tog_cave_up'));
  assert(loc);
  const state = ScriptRunner.init(ScriptProvider.getByName('[oploc1,tog_cave_up]'), p, loc);
  p.executeScript(state, true, true);
  for (let i = 0; i < 10 && inside(p); i++) {
    assert(p.delayed, 'published p_arrivedelay holds the player before moving');
    ticks(p, 1); assert.equal(hp(p), 97);
  }
  assert.deepEqual(tile(p), [0, 3225, 9538], 'keep the published landing for SC-06');
  ownership(p, false); assert.equal(p.overlay, -1);
  const messages = [...p.messages]; ticks(p, 40);
  ownership(p, false); assert.equal(hp(p), 97); assert.deepEqual(p.messages, messages);
});

test('actual insect death releases before the first death delay and no later hazard reaches the respawn', () => {
  const p = start(fixture()); p.levels[PlayerStat.HITPOINTS] = 3;
  ticks(p, 31); assert.equal(hp(p), 1, 'repeated ordinary bites, no survival clamp');
  ticks(p, 1); assert.equal(hp(p), 0);
  ticks(p, 1); ownership(p, false); assert.equal(p.overlay, -1);
  for (let i = 0; i < 40 && hp(p) === 0; i++) ticks(p, 1);
  assert(hp(p) > 0, 'published death completes its real respawn');
  assert.equal(inside(p), false); const after = hp(p);
  ticks(p, 40); assert.equal(hp(p), after); ownership(p, false);
});

test('real Juna story grants the competing HUD; cave release/start/fallback never takes non-dark ownership', () => {
  const p = fixture([], [2, 3244, 9500]);
  p.setVar(id('VarPlayerType', 'qp'), 43);
  startDialogue('[oploc1,hidey_unbuilt_bush_easy]', p);
  assert(dialoguePage(p).join(' ').includes('Tell me... a story...'));
  resumeDialogue(p); assert(dialoguePage(p).includes('Okay.'));
  resumeDialogue(p, 1); assert(dialoguePage(p).join(' ').includes('You tell me a story.'));
  resumeDialogue(p); assert(dialoguePage(p).join(' ').includes('Your stories have entertained me.'));
  resumeDialogue(p);
  const junaRoot = id('Component', 'water_collected');
  assert.equal(p.overlay, junaRoot, 'the real story is the HUD grant');
  resumeDialogue(p); resumeDialogue(p);
  ownership(p, false);
  execute('[proc,swamp_cave_release]', p); execute('[proc,swamp_cave_start]', p);
  ticks(p, 35); ownership(p, false); assert.equal(p.overlay, junaRoot);
  p.onReconnect(); ownership(p, false); assert.equal(p.overlay, junaRoot, 'server state retained, not a cave overlay');
  const q = reload(p); execute('[login,_]', q); ownership(q, false);
  assert.equal(q.overlay, -1, 'ruling 9 preserves published lack of automatic HUD reconstruction');
});

// Ruling 12: exercise published travel, without repairing the routes that
// SC-06/07/10 own. The protected helpers below are their explicit handoff API.
function travel(p, name, x, z, destination) {
  const loc = World.getLoc(x, z, p.level, id('LocType', name));
  assert(loc, `natural ${name} at ${x},${z},${p.level}`);
  p.encodeOut();
  p.originX = p.x; p.originZ = p.z;
  assert(locHandler.handle(new OpLoc(1, x, z, loc.type), p), 'real OPLOC packet accepted');
  p.processInteraction();
  p.encodeOut();
  for (let i = 0; i < 20 && tile(p).some((value, index) => value !== destination[index]); i++) {
    ticks(p, 1); p.encodeOut();
  }
  assert.deepEqual(tile(p), destination, `published ${name} destination`);
}
test('real castle trapdoor/ladder round trip never claims or closes a cave root', () => {
  const p = wireFixture([], [0, 3209, 3216]); // Shape 22 operates from its own floor tile.
  travel(p, 'trapdoor_14879', 3209, 3216, [0, 3209, 9617]);
  ownership(p, false); assert.equal(p.overlay, -1); assert.equal(rootPackets(p).length, 0);
  travel(p, 'ladder_1755', 3209, 9616, [0, 3209, 3217]);
  ticks(p, 35); ownership(p, false); assert.equal(p.overlay, -1); assert.equal(rootPackets(p).length, 0);
});
test('retained generic ladders have no natural dispatch in any selected dark component', () => {
  const ladders = Array.from({ length: types.LocType.count }, (_, type) => types.LocType.get(type))
    .filter(type => /ladder/.test(type.debugname ?? ''));
  for (const [level, x1, x2, z1, z2] of [[0, 3145, 3258, 9540, 9600], [0, 3221, 3325, 9601, 9657], [2, 3212, 3239, 9523, 9532]]) {
    for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) for (const type of ladders) {
      assert.equal(World.getLoc(x, z, level, type.id), null, `no natural ${type.debugname} at ${x},${z},${level}`);
    }
  }
});
test('published Tears down retains one controller; up synchronously releases before its unchanged landing', () => {
  const p = start(wireFixture([], [0, 3225, 9542])); pending(p, 4);
  travel(p, 'tog_cave_down', 3225, 9539, [2, 3218, 9532]);
  ownership(p); assert(timer(p).args[0] >= 4); assert.equal(timer(p).args[4], 6);
  assert.equal(rootPackets(p).length, 1, 'down does not replace or duplicate its existing cave root');
  travel(p, 'tog_cave_up', 3218, 9533, [0, 3225, 9538]);
  assert.equal(inside(p), false, 'published blocked upper landing is not repaired by SC-03');
  ownership(p, false); assert.equal(p.overlay, -1, 'release happens inside the up transition, not the fallback');
  const before = hp(p);
  ticks(p, 1); ownership(p, false); assert.equal(p.getVarBit(gas), 0); assert.equal(p.overlay, -1);
  ticks(p, 35); assert.equal(hp(p), before, 'no outside bite from the published tunnel defect');
});
for (const name of ['goblin_cave_entrance', 'swamp_cave_climbing_rope', 'tog_climbing_rocks_up', 'tog_climbing_rocks_down']) {
  test(`future travel ${name} has no published approach or operation dispatch`, () => {
    const type = types.LocType.get(id('LocType', name));
    for (const trigger of [ServerTriggerType.APLOC1, ServerTriggerType.OPLOC1]) {
      assert.equal(ScriptProvider.getByTrigger(trigger, type.id, type.category), undefined);
    }
  });
}
for (const lit of [false, true]) test(`protected SC-07 rope contract ${lit ? 'lit' : 'unlit'}: release before exit, restart fresh on entry`, () => {
  const p = start(fixture(lit ? ['lit_candle'] : [])); pending(p);
  release(p);
  execute('[proc,p_telejump_safe]', p, [CoordGrid.packCoord(0, 3168, 3172)]);
  assert.equal(p.overlay, -1); assert.equal(p.getVarBit(gas), 0);
  const before = hp(p); ticks(p, 35); assert.equal(hp(p), before); ownership(p, false);
  execute('[proc,swamp_cave_start]', p); ownership(p, false);
  execute('[proc,p_telejump_safe]', p, [CoordGrid.packCoord(0, 3168, 9572)]);
  start(p); elapsed(p, 0); assert.equal(p.getVarBit(gas), 0);
  assert.equal(p.overlay, roots[Number(lit)]); release(p);
});
test('protected SC-10 approach contract releases before Juna HUD and restarts only on the dark return', () => {
  const p = start(fixture([], [2, 3239, 9524])); pending(p);
  release(p);
  execute('[proc,p_telejump_safe]', p, [CoordGrid.packCoord(2, 3241, 9524)]);
  execute('[proc,tog_hud_enter]', p);
  const junaRoot = id('Component', 'water_collected');
  assert.equal(p.overlay, junaRoot); ownership(p, false);
  execute('[proc,swamp_cave_release]', p); execute('[proc,swamp_cave_start]', p);
  const before = hp(p); ticks(p, 35);
  assert.equal(hp(p), before); assert.equal(p.overlay, junaRoot); ownership(p, false);
  execute('[proc,p_telejump_safe]', p, [CoordGrid.packCoord(2, 3239, 9524)]);
  start(p); elapsed(p, 0); assert.equal(p.getVarBit(gas), 0); assert.equal(p.overlay, roots[0]); release(p);
});
for (const position of [[2, 3238, 9498], [2, 3240, 9498]]) {
  test(`protected SC-10 ledge contract ${position}: both cave helpers preserve non-dark HUD ownership`, () => {
    const p = fixture([], position); execute('[proc,tog_hud_enter]', p);
    const before = rootPackets(p).length;
    execute('[proc,swamp_cave_release]', p); execute('[proc,swamp_cave_start]', p);
    ticks(p, 35); ownership(p, false);
    assert.equal(p.overlay, id('Component', 'water_collected')); assert.equal(rootPackets(p).length, before);
  });
}

console.log(`SC03 darkness: ${cases - failures}/${cases} passed`);
process.exit(failures ? 1 : 0);
