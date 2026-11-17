#!/usr/bin/env node
/** SC-10: original map, native item/NPC and loc packets, runner and world phases. */
import assert from 'node:assert/strict';
import { World, PlayerLoading, Packet, ScriptProvider, ScriptState, ServerTriggerType,
  PlayerStat, PlayerTimerType, types, map, CollisionType, engineModule, id, obj, inv,
  invCom, worn, player, seed, inventory, slotOf, held, use, button, execute, tile,
  environmentTick, startDialogue, resumeDialogue, dialoguePage } from './runtime.mjs';
const Runner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const ScriptVarType = (await engineModule('cache/config/ScriptVarType.ts')).default;
const { CoordGrid } = await engineModule('engine/CoordGrid.ts');
const rsbuf = await engineModule('network/rsbuf/index.ts');
const OpNpcU = (await engineModule('network/game/client/model/OpNpcU.ts')).default;
const npcUseHandler = new ((await engineModule('network/game/client/handler/OpNpcUHandler.ts')).default)();
const OpNpc = (await engineModule('network/game/client/model/OpNpc.ts')).default;
const npcHandler = new ((await engineModule('network/game/client/handler/OpNpcHandler.ts')).default)();
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const locHandler = new ((await engineModule('network/game/client/handler/OpLocHandler.ts')).default)();
const MoveClick = (await engineModule('network/game/client/model/MoveClick.ts')).default;
const moveHandler = new ((await engineModule('network/game/client/handler/MoveClickHandler.ts')).default)();
const controller = ScriptProvider.getByName('[softtimer,swamp_cave_environment]');
const ferry = ScriptProvider.getByName('[apnpcu,tog_light_creature]');
assert(controller && ferry, 'build the SC-10 script pack first');
const flag = id('VarBitType', 'darkness_level'), gas = id('VarBitType', 'swamp_gas_turns');
const parent = id('VarPlayerType', 'goblin_caves'), transient = (3 << 1) | (7 << 6);
const darkRoot = id('Component', 'inter_387'), junaRoot = id('Component', 'water_collected');
const timer = p => p.timers.get(controller.id);
const hp = p => p.levels[PlayerStat.HITPOINTS];
const distance = (p, n) => p.level === n.level ? Math.max(Math.abs(p.x - n.x), Math.abs(p.z - n.z)) : Infinity;
const stand = [2, 3217, 9526], ledge = [2, 3238, 9498], juna = [2, 3240, 9498];
const slopes = [
  { name: 'tog_climbing_rocks_up', x: 3240, z: 9524, ends: [[2, 3239, 9524], [2, 3241, 9524]], both: true },
  { name: 'tog_climbing_rocks_down', x: 3239, z: 9498, ends: [ledge, juna], both: false }
];
const creatures = [...World.npcs].filter(n => n.baseType === id('NpcType', 'tog_light_creature'));
const creature = creatures.find(n => n.x === 3224 && n.z === 9518 && n.level === 2);
assert(creature, 'the measured ACTUAL natural creature exists');
let cases = 0, failures = 0;
const originalRandom = Math.random;
// The production NPC wander uses Math.random; feed it the same native generator.
Math.random = () => JavaRandom.nextDouble();
function test(name, run) {
  cases++;
  try { JavaRandom.setSeed(0); run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack ?? error}`); }
}
function ticks(p, count) { for (let i = 0; i < count; i++) environmentTick(p); }
function owner(p, expected) {
  assert.equal(p.getVarBit(flag), Number(expected));
  assert.equal(p.timers.has(controller.id), expected);
  if (expected) {
    assert.equal(timer(p).type, PlayerTimerType.SOFT);
    assert.equal([...p.timers.values()].filter(t => t.script.id === controller.id).length, 1);
  }
}
function fixture(position = stand, items = ['tog_sapphire_lantern_lit']) {
  const p = seed(player(), items); [p.level, p.x, p.z] = position;
  // runtime.player() zeroes variables; restore the native constructor's typed defaults.
  for (let index = 0; index < types.VarPlayerType.count; index++) {
    const type = types.VarPlayerType.get(index).type;
    if (type !== ScriptVarType.INT && type !== ScriptVarType.STRING) p.vars[index] = -1;
  }
  p.originX = p.x; p.originZ = p.z;
  // Begin from an ordinary login, including its existing region music unlock.
  execute('[login,_]', p);
  ticks(p, 2); // Process the real login's queued interface/music initialization.
  p.messages = []; p.packets = [];
  p.moves = [];
  const teleport = p.teleport;
  p.teleport = function (x, z, level) {
    p.moves.push({ tick: World.currentTick, tile: [level, x, z], owner: p.getVarBit(flag), overlay: p.overlay });
    return teleport.call(this, x, z, level);
  };
  return p;
}
function finish(p) {
  p.delayed = false; p.activeScript = null; p.clearInteraction(); p.weakQueue.clear();
  execute('[proc,swamp_cave_release]', p);
  rsbuf.removePlayer(p.slot); p.isActive = false; World.players[p.pid] = null; p.unlink();
}
function stable(p, { durableOnly = false } = {}) {
  return { inventory: inventory(p), worn: inventory(p, worn), stats: [...p.stats],
    // Existing zone callbacks own regional music, including its ordinary unlock.
    // Login also resets temporary variables to their declared type defaults.
    vars: Object.fromEntries(Array.from({ length: types.VarPlayerType.count }, (_, index) => index)
      .filter(index => {
        const type = types.VarPlayerType.get(index);
        return !/^(musicmulti_\d+|currentsong|musicstart|musiclength)$/.test(type.debugname)
          && (!durableOnly || type.scope === types.VarPlayerType.SCOPE_PERM);
      }).map(index => {
        const value = p.getVar(index);
        return [types.VarPlayerType.get(index).debugname, index === parent ? value & ~transient : value];
      })), strings: [...p.varsString] };
}
function unchanged(p, before, options) { assert.deepEqual(stable(p, options), before, 'items, XP and all non-music quest/QP/reward/weekly variables stay unchanged'); }
function silent(p, mark = 0) {
  assert.deepEqual(p.messages.slice(mark), []);
  assert(!p.packets.some(packet => /Synth|Spotanim/.test(packet.constructor.name)), 'UNKNOWN ferry audio/effects are not bound by name');
}
// Use the real visibility encoder. A JS-only World NPC is not sufficient for OPNPCU.
function visible(p, n = creature) {
  rsbuf.addPlayer(p.slot); rsbuf.addNpc(n.nid, n.type);
  const appearance = p.generateAppearance();
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, appearance, p.lastAppearance,
    p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ,
    p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    hp(p), p.baseLevels[PlayerStat.HITPOINTS], p.animId, p.animDelay, p.sayMessage,
    p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0,
    p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(n.x, n.level, n.z, n.nid, n.type, n.tele, n.jump, n.runDir,
    n.walkDir, n.isActive, n.masks, n.faceEntity, n.faceSquareX, n.faceSquareZ,
    n.faceAngleX, n.faceAngleZ, n.hitmarkDamage, n.hitmarkType, n.hitmark2Damage,
    n.hitmark2Type, n.levels[3], n.baseLevels[3], n.animId, n.animDelay,
    n.sayMessage, n.spotanimId, n.spotanimHeight, n.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  return rsbuf.hasNpc(p.slot, n.nid);
}
function useCreature(p, item = 'tog_sapphire_lantern_lit', n = creature, process = true) {
  visible(p, n); p.originX = p.x; p.originZ = p.z;
  const accepted = npcUseHandler.handle(new OpNpcU(n.nid, obj(item), slotOf(p, item), invCom), p);
  if (accepted && process) p.processInteraction();
  return accepted;
}
function click(p, slope, option = 1) {
  const loc = World.getLoc(slope.x, slope.z, 2, id('LocType', slope.name)); assert(loc);
  p.originX = p.x; p.originZ = p.z;
  const accepted = locHandler.handle(new OpLoc(option, loc.x, loc.z, loc.type), p);
  if (accepted) p.processInteraction(); return accepted;
}
function walk(p, destination, op = false) {
  const [level, x, z] = destination; assert.equal(p.level, level);
  const route = Array.from(map.findPath(level, p.x, p.z, x, z), value => {
    const coord = CoordGrid.unpackCoord(value); return { x: coord.x, z: coord.z };
  });
  assert(route.length, 'ordinary native walk has a route'); p.originX = p.x; p.originZ = p.z;
  return moveHandler.handle(new MoveClick(route, 0, op), p);
}
function completeFerry(p) {
  assert(useCreature(p)); assert(p.delayed); const start = World.currentTick;
  ticks(p, 2); assert.deepEqual(tile(p), stand); owner(p, true);
  ticks(p, 1); assert.deepEqual(tile(p), ledge); owner(p, false);
  assert.equal(p.moves.at(-1).tick, start + 3); assert.equal(p.moves.at(-1).owner, 0);
  assert.equal(p.moves.at(-1).overlay, -1, 'release happens BEFORE the landing teleport');
  ticks(p, 2); assert(p.delayed); ticks(p, 1); assert(!p.delayed); assert(!p.activeScript);
}
function load(p) {
  const bytes = p.save(); assert(PlayerLoading.verify(new Packet(bytes)));
  const q = PlayerLoading.load(p.username, new Packet(bytes), null);
  q.pid = p.pid; q.slot = p.slot; q.uid = p.uid; q.isActive = true; q.messages = []; q.packets = [];
  q.write = packet => q.packets.push(packet); q.messageGame = text => q.messages.push(String(text)); q.wrappedMessageGame = q.messageGame;
  World.players[q.pid] = q; World.playerLoop.add(q.hash64, q); return q;
}
function flood(start, allowed, canStep) {
  const seen = new Set([start.join(',')]), queue = [start];
  const directions = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  for (let index = 0; index < queue.length; index++) {
    const [x, z] = queue[index];
    for (const [dx, dz] of directions) {
      const next = [x + dx, z + dz], key = next.join(',');
      if (!seen.has(key) && allowed(...next) && canStep(x, z, dx, dz)) { seen.add(key); queue.push(next); }
    }
  }
  return queue;
}
try {
  test('original natural creature, model, placements, movement and non-attackable menu stay unchanged', () => {
    assert.equal(creatures.length, 9);
    const type = types.NpcType.get(creature.type);
    assert.deepEqual([...type.models], [6541]); assert.equal(type.op, null);
    assert.equal(type.readyanim, id('SeqType', 'light_creature_ready'));
    assert.equal(type.walkanim, type.readyanim); assert.equal(type.size, 1); assert.equal(type.wanderrange, 5);
    assert.deepEqual(creatures.map(n => [n.startLevel, n.startX, n.startZ]).sort(),
      [3224, 3225, 3226].flatMap(x => [9516, 9517, 9518].map(z => [2, x, z])).sort());
    assert.equal(ScriptProvider.getByTrigger(ServerTriggerType.APNPCU, type.id, type.category), ferry);
    assert.equal(ScriptProvider.getByTrigger(ServerTriggerType.OPNPCU, type.id, type.category), undefined);
    const p = fixture(); assert(visible(p));
    for (let option = 1; option <= 5; option++) assert.equal(npcHandler.handle(new OpNpc(option, creature.nid), p), false);
    assert.deepEqual(creatures.map(n => n.type), Array(9).fill(type.id)); finish(p);
  });
  test('full entry, ledge and Juna floods admit only 52 entry-pocket firing tiles; each creature is isolated', () => {
    const bounded = (x, z) => x > 3175 && x < 3285 && z > 9450 && z < 9560;
    const playerStep = (x, z, dx, dz) => map.canTravel(2, x, z, dx, dz, 1, 0, CollisionType.NORMAL);
    const entryTiles = flood([3217, 9526], bounded, playerStep);
    const ledgeTiles = flood([3238, 9498], bounded, playerStep);
    const junaTiles = flood([3241, 9524], bounded, playerStep);
    assert.equal(entryTiles.length, 125); assert.equal(ledgeTiles.length, 188);
    assert.equal(junaTiles.length, 129); assert(junaTiles.some(([x, z]) => x === 3244 && z === 9500));
    for (const tiles of [entryTiles, ledgeTiles, junaTiles]) {
      assert(!tiles.some(([x, z]) => x === 3176 || x === 3284 || z === 9451 || z === 9559), 'the full component is not clipped by audit bounds');
    }
    const entry = new Set(entryTiles.map(tile => tile.join(',')));
    let junaMinimum = Infinity, ledgeMinimum = Infinity, occurrences = 0;
    const firing = new Set();
    for (const n of creatures) {
      const range = types.NpcType.get(n.type).wanderrange;
      const tiles = flood([n.startX, n.startZ], (x, z) => Math.max(Math.abs(x - n.startX), Math.abs(z - n.startZ)) <= range,
        (x, z, dx, dz) => map.canTravel(n.level, x, z, dx, dz, n.width, n.blockWalkFlag(), n.getCollisionStrategy() ?? CollisionType.NORMAL));
      assert.deepEqual(tiles, [[n.startX, n.startZ]], 'native collision blocks every first wander step, despite configured range five');
      occurrences += tiles.length;
      for (const [x, z] of tiles) {
        for (const [px, pz] of junaTiles) junaMinimum = Math.min(junaMinimum, Math.max(Math.abs(x - px), Math.abs(z - pz)));
        for (const [px, pz] of ledgeTiles) ledgeMinimum = Math.min(ledgeMinimum, Math.max(Math.abs(x - px), Math.abs(z - pz)));
        // This covers every tile within the native range, not only the three floods.
        for (let px = x - 10; px <= x + 10; px++) for (let pz = z - 10; pz <= z + 10; pz++) {
          if (map.isMapBlocked(px, pz, 2) || !map.isApproached(2, px, pz, x, z, 1, 1, n.width, n.length)) continue;
          assert(entry.has(`${px},${pz}`), 'every possible native firing tile belongs to the entry component');
          assert(px >= 3212 && px <= 3239 && pz >= 9523 && pz <= 9532, 'every firing tile is inside the dark entry pocket');
          firing.add(`${px},${pz}`);
        }
      }
    }
    assert.equal(occurrences, 9); assert.equal(junaMinimum, 15); assert.equal(ledgeMinimum, 11);
    assert.equal(firing.size, 52);
  });
  test('four hundred real native seeded wander turns cannot leave any of the nine isolated natural tiles', () => {
    for (let turn = 0; turn < 400; turn++) {
      World.currentTick++;
      for (const n of creatures) { n.resetEntity(false); n.turn(); assert.deepEqual([n.level, n.x, n.z], [n.startLevel, n.startX, n.startZ]); }
    }
  });
  test('walkable measured stand at distance eight reaches the ACTUAL creature via native APNPCU, not adjacent OPNPCU', () => {
    const p = fixture(); assert(!map.isMapBlocked(p.x, p.z, p.level)); assert.equal(distance(p, creature), 8);
    const before = stable(p), npcBefore = creatures.map(n => [n.type, n.x, n.z, n.level]);
    completeFerry(p); unchanged(p, before); silent(p); assert(!map.isMapBlocked(p.x, p.z, p.level));
    assert.deepEqual(creatures.map(n => [n.type, n.x, n.z, n.level]), npcBefore, 'the product neither moves nor transforms any creature');
    ticks(p, 40); owner(p, false); assert.equal(p.overlay, -1); assert.equal(hp(p), 99); finish(p);
  });
  for (const item of ['tog_sapphire_lantern_empty', 'tog_sapphire_lantern_unlit', 'bullseye_lantern_nolens',
    'bullseye_lantern_empty', 'bullseye_lantern_unlit', 'bullseye_lantern_lit', 'hammer', 'tinderbox',
    'lit_candle', 'oil_lantern_lit', 'cave_goblin_mining_helmet_lit', 'slayer_buglan_on']) {
    test(`${item}: real use from measured stand is silent, inert and leaves every durable state alone`, () => {
      const p = fixture(stand, [item]); const before = stable(p); assert(useCreature(p, item));
      assert(!p.delayed); ticks(p, 8); assert.deepEqual(tile(p), stand); assert.deepEqual(p.moves, []);
      unchanged(p, before); silent(p); owner(p, true); finish(p);
    });
  }
  for (const item of ['bullseye_lantern_lit', 'hammer']) {
    test(`${item} used while carrying a lit sapphire: no ferry, movement, wording or durable change`, () => {
      const p = fixture(stand, ['tog_sapphire_lantern_lit', item]); const before = stable(p);
      assert.equal(p.invTotal(inv, obj('tog_sapphire_lantern_lit')), 1); assert(useCreature(p, item));
      assert(!p.delayed); ticks(p, 8); assert.deepEqual(tile(p), stand); assert.deepEqual(p.moves, []);
      unchanged(p, before); silent(p); owner(p, true); finish(p);
    });
  }
  for (const item of ['tog_sapphire_lantern_lit', 'tog_sapphire_lantern_unlit', 'bullseye_lantern_lit', 'hammer']) {
    test(`${item}: former Juna stand has no native target and never ferries (20 to selected, 18 to closest spawn)`, () => {
      const p = fixture([2, 3244, 9500], [item]); const before = stable(p); assert.equal(distance(p, creature), 20);
      assert.equal(Math.min(...creatures.map(n => distance(p, n))), 18);
      assert.equal(useCreature(p, item), false); ticks(p, 40); assert.deepEqual(tile(p), [2, 3244, 9500]);
      unchanged(p, before); silent(p); owner(p, false); assert.deepEqual(p.moves, []); finish(p);
    });
  }
  for (const position of [[2, 3212, 9532], [2, 3213, 9532]]) {
    test(`farther entry tile ${position}: no out-of-range ferry; ordinary approach walks within ten then fires`, () => {
      const p = fixture(position); assert(distance(p, creature) > 10); const before = stable(p);
      assert(walk(p, stand, true)); assert(useCreature(p)); assert(!p.delayed); assert.deepEqual(p.moves, []);
      let firedFrom;
      for (let tick = 0; tick < 25 && !p.delayed; tick++) { ticks(p, 1); if (p.delayed) firedFrom = tile(p); }
      assert(firedFrom, 'normal approach reaches a legal firing tile'); assert.notDeepEqual(firedFrom, position);
      assert(distance(p, creature) <= 10); ticks(p, 6); assert.deepEqual(tile(p), ledge); owner(p, false);
      unchanged(p, before); silent(p); finish(p);
    });
  }
  test('full backpack and unrelated carried/worn items survive the complete ferry unchanged', () => {
    const p = fixture(stand, ['tog_sapphire_lantern_lit', ...Array(26).fill('hammer'), 'wallbeast_spike_helmet']);
    assert(held(p, 'wallbeast_spike_helmet', 2)); p.invAdd(inv, obj('hammer'), 1);
    assert.equal(inventory(p).filter(Boolean).length, 28); const before = stable(p);
    completeFerry(p); unchanged(p, before); silent(p); finish(p);
  });
  for (const qp of [0, 42, 43, 100]) test(`QP ${qp}: traversal is physical, not a quest, bowl or reward gate`, () => {
    const p = fixture(); p.setVar(id('VarPlayerType', 'qp'), qp); const before = stable(p);
    completeFerry(p); unchanged(p, before); silent(p); finish(p);
  });
  test('unlit sapphire stays inert, then its native FM49 ignition permits the same target', () => {
    const p = fixture(stand, ['tog_sapphire_lantern_unlit', 'tinderbox']);
    p.baseLevels[PlayerStat.FIREMAKING] = 49; p.levels[PlayerStat.FIREMAKING] = 49;
    assert(useCreature(p, 'tog_sapphire_lantern_unlit')); ticks(p, 2); assert.deepEqual(tile(p), stand);
    assert(use(p, 'tinderbox', 'tog_sapphire_lantern_unlit')); assert.equal(p.invTotal(inv, obj('tog_sapphire_lantern_lit')), 1);
    const before = stable(p); p.messages = []; completeFerry(p); unchanged(p, before); silent(p); finish(p);
  });
  for (const slope of slopes) {
    test(`${slope.name}: every original placement has only Climb and real direct APLOC1 dispatch`, () => {
      const type = types.LocType.get(id('LocType', slope.name)); assert.deepEqual(type.op, ['Climb', null, null, null, null]);
      assert.equal(ScriptProvider.getByTrigger(ServerTriggerType.APLOC1, type.id, type.category)?.name, `[aploc1,${slope.name}]`);
      assert.equal(ScriptProvider.getByTrigger(ServerTriggerType.OPLOC1, type.id, type.category), undefined);
      for (const z of slope.both ? [9524, 9525] : [9497, 9498, 9499]) {
        const loc = World.getLoc(slope.x, z, 2, type.id); assert(loc); assert.equal(loc.shape, 10); assert.equal(loc.angle, 0);
      }
      for (const [level, x, z] of slope.ends) assert(!map.isMapBlocked(x, z, level));
      for (let option = 1; option < 5; option++) {
        assert.equal(ScriptProvider.getByTrigger(ServerTriggerType.APLOC1 + option, type.id, type.category), undefined);
        assert.equal(ScriptProvider.getByTrigger(ServerTriggerType.OPLOC1 + option, type.id, type.category), undefined);
      }
    });
    for (const side of [0, 1]) for (const lit of [false, true]) test(`${slope.name} side ${side} ${lit ? 'lit' : 'unlit'}: exact direction, four-tick hold and root/HUD handoff`, () => {
      const start = slope.ends[side], works = slope.both || side === 0;
      const destination = works ? slope.ends[1 - side] : start;
      const p = fixture(start, lit ? ['tog_sapphire_lantern_lit'] : []);
      if (slope.both && side === 0) { timer(p).args[0] = 29; timer(p).args[2] = 0; timer(p).args[3] = obj('lit_candle'); timer(p).args[4] = 6; p.setVarBit(gas, 6); }
      else execute('[proc,tog_hud_enter]', p);
      const before = stable(p), health = hp(p), started = World.currentTick; assert(click(p, slope));
      if (!works) {
        assert(!p.delayed); ticks(p, 35); assert.deepEqual(tile(p), start); assert.deepEqual(p.moves, []);
        owner(p, false); assert.equal(p.overlay, junaRoot); unchanged(p, before); silent(p); finish(p); return;
      }
      assert(p.delayed); ticks(p, 1); assert.deepEqual(tile(p), start); ticks(p, 1);
      assert.deepEqual(tile(p), destination); assert.equal(p.moves.at(-1).tick, started + 2); assert(p.delayed);
      if (slope.both && side === 0) { owner(p, false); assert.equal(p.overlay, -1); assert.equal(p.moves.at(-1).owner, 0); assert.equal(p.getVarBit(gas), 0); }
      else if (slope.both) { owner(p, true); assert.equal(timer(p).args[0], 0); assert.equal(p.overlay, lit ? id('Component', 'inter_250') : darkRoot); }
      else { owner(p, false); assert.equal(p.overlay, junaRoot); assert.equal(p.moves.at(-1).overlay, junaRoot); }
      ticks(p, 1); assert(p.delayed); ticks(p, 1); assert(!p.delayed); assert(!p.activeScript);
      assert.equal(hp(p), health); unchanged(p, before); silent(p);
      if (!(slope.both && side === 1)) { const root = p.overlay; ticks(p, 40); assert.equal(hp(p), health); assert.equal(p.overlay, root); owner(p, false); }
      finish(p);
    });
    for (const side of [0, 1]) test(`${slope.name} side ${side}: normal near-bank approach, not a long protected glide`, () => {
      const end = slope.ends[side]; const p = fixture([end[0], end[1], end[2] + 1]);
      assert(click(p, slope));
      if (!slope.both && side === 1) { ticks(p, 8); assert.deepEqual(p.moves, []); assert(!p.delayed); }
      else { assert(!p.delayed); for (let tick = 0; tick < 20 && p.moves.length === 0; tick++) ticks(p, 1); assert.deepEqual(tile(p), slope.ends[1 - side]); ticks(p, 4); }
      finish(p);
    });
  }
  test('a real move cancels the weak near-bank slope continuation before any crossing', () => {
    const p = fixture([2, 3239, 9525]); assert(click(p, slopes[0])); assert(!p.delayed);
    assert(walk(p, [2, 3237, 9526])); ticks(p, 12); assert.deepEqual(p.moves, []); owner(p, true); finish(p);
  });
  for (const action of ['walk', 'extinguish', 'drop']) test(`far ferry approach interrupted by real ${action}: no stale crossing`, () => {
    const p = fixture([2, 3212, 9532]); assert(walk(p, stand, true)); assert(useCreature(p, 'tog_sapphire_lantern_lit', creature, false));
    if (action === 'walk') assert(walk(p, [2, 3212, 9531]));
    else assert(held(p, 'tog_sapphire_lantern_lit', action === 'drop' ? 5 : 1));
    ticks(p, 12); assert.deepEqual(p.moves, []); assert(!p.delayed); assert(!p.activeScript); finish(p);
  });
  test('native repeated use, walking, extinguishing and logout cannot replace a running ferry', () => {
    const p = fixture(); p.tabs[10] = types.Component.get(id('Component', 'logout:try_logout')).rootLayer;
    assert(useCreature(p)); const state = p.activeScript; const before = stable(p);
    assert.equal(useCreature(p), false); assert.equal(held(p, 'tog_sapphire_lantern_lit', 1), false);
    assert.equal(walk(p, [2, 3212, 9532]), false); assert(button(p, 'logout:try_logout'));
    assert.equal(p.requestLogout, false); assert.equal(p.activeScript, state);
    ticks(p, 6); assert.deepEqual(tile(p), ledge); assert.equal(p.moves.length, 1); unchanged(p, before); finish(p);
  });
  test('after unlock a ledge-side repeat cannot ferry again or create cave ownership', () => {
    const p = fixture(); completeFerry(p); const before = stable(p), mark = p.moves.length;
    // That creature is outside the ledge client's visibility. Native input refuses it.
    assert.equal(useCreature(p), false); ticks(p, 12); assert.equal(p.moves.length, mark);
    assert.deepEqual(tile(p), ledge); unchanged(p, before); owner(p, false); silent(p); finish(p);
  });
  test('real repaired Tears tunnel pair round-trips without releasing, resetting or duplicating the one controller', () => {
    const p = fixture([0, 3225, 9542], []); ticks(p, 4); const rootPackets = p.packets.filter(packet => packet.constructor.name === 'IfOpenOverlay').length;
    for (const [name, x, z, destination] of [['tog_cave_down', 3225, 9539, [2, 3218, 9532]], ['tog_cave_up', 3218, 9533, [0, 3225, 9542]]]) {
      const loc = World.getLoc(x, z, p.level, id('LocType', name)); assert(loc);
      p.originX = p.x; p.originZ = p.z; assert(locHandler.handle(new OpLoc(1, x, z, loc.type), p)); p.processInteraction();
      for (let tick = 0; tick < 16 && tile(p).some((value, index) => value !== destination[index]); tick++) ticks(p, 1);
      assert.deepEqual(tile(p), destination); owner(p, true); ticks(p, 2);
    }
    assert(timer(p).args[0] >= 4); assert.equal(p.packets.filter(packet => packet.constructor.name === 'IfOpenOverlay').length, rootPackets); finish(p);
  });
  for (const position of [stand, ledge, juna, slopes[0].ends[1], [2, 3244, 9500]]) test(`real save/login and reconnect at ${position}: only the current dark pocket acquires one root`, () => {
    const p = fixture(position); const before = stable(p, { durableOnly: true }); const expected = position === stand;
    p.setVarBit(gas, 6); const q = load(p); execute('[login,_]', q); ticks(q, 2); owner(q, expected);
    assert.equal(q.getVarBit(gas), 0); assert.equal(q.overlay, expected ? id('Component', 'inter_250') : -1);
    unchanged(q, before, { durableOnly: true }); q.onReconnect(); owner(q, expected); finish(q);
  });
  test('real Juna dialogue HUD survives ledge handoff and outside cave helpers; login remains published partial behavior', () => {
    const p = fixture([2, 3244, 9500], []); p.setVar(id('VarPlayerType', 'qp'), 43);
    startDialogue('[oploc1,hidey_unbuilt_bush_easy]', p); assert(dialoguePage(p).join(' ').includes('Tell me... a story...'));
    resumeDialogue(p); resumeDialogue(p, 1); resumeDialogue(p); resumeDialogue(p); assert.equal(p.overlay, junaRoot);
    resumeDialogue(p); resumeDialogue(p); execute('[proc,swamp_cave_start]', p); execute('[proc,swamp_cave_release]', p);
    ticks(p, 35); owner(p, false); assert.equal(p.overlay, junaRoot);
    const q = load(p); execute('[login,_]', q); owner(q, false); assert.equal(q.overlay, -1, 'SC-10 ruling 2: no automatic HUD at login'); finish(q);
  });
  test('actual insect death in the entry pocket releases before respawn; no later cave damage follows', () => {
    const p = fixture(stand, []); p.levels[PlayerStat.HITPOINTS] = 2; ticks(p, 31); assert.equal(hp(p), 0);
    ticks(p, 1); owner(p, false); assert.equal(p.overlay, -1);
    for (let tick = 0; tick < 40 && hp(p) === 0; tick++) ticks(p, 1);
    assert(hp(p) > 0); assert.equal(p.level, 0); const health = hp(p); ticks(p, 40); assert.equal(hp(p), health); owner(p, false); finish(p);
  });
  test('real pending lethal firecracker waits for ferry unlock, then death clears its non-dark destination', () => {
    const p = fixture(stand, ['tog_sapphire_lantern_lit', 'tinderbox', 'viking_firecracker', 'viking_firecracker']);
    assert(use(p, 'tinderbox', 'viking_firecracker')); assert(use(p, 'tinderbox', 'viking_firecracker'));
    const fuses = [...p.queue.all()].filter(q => q.script.name === '[queue,firecracker_explode]'); assert.equal(fuses.length, 2);
    ticks(p, Math.min(...fuses.map(q => q.delay)) - 1); p.levels[PlayerStat.HITPOINTS] = 2;
    assert(useCreature(p)); ticks(p, 5); assert.equal(hp(p), 2); assert(p.delayed);
    ticks(p, 2); assert.deepEqual(tile(p), ledge); assert.equal(hp(p), 0); ticks(p, 20); assert(hp(p) > 0); owner(p, false); finish(p);
  });
} finally { Math.random = originalRandom; }
console.log(`${cases - failures}/${cases} SC-10 Tears traversal cases passed`);
process.exit(failures ? 1 : 0);
