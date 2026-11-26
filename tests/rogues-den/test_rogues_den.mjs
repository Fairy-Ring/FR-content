// Run from the built sibling engine with NODE_MEMBERS=true NODE_XPRATE=1.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  World, types, id, obj, inv, worn, player, execute, count, seed, inventory,
  ScriptProvider, ServerTriggerType, ScriptState, PlayerStat, engineModule,
  map, CollisionType, tile, resumeDialogue, environmentTick, held, useLoc, contentRoot, slotOf, invCom
} from '../swamp-caves/runtime.mjs';
const ScriptRunner = (await engineModule('engine/script/ScriptRunner.ts')).default;
const JavaRandom = (await engineModule('util/JavaRandom.ts')).default;
const OpNpcU = (await engineModule('network/game/client/model/OpNpcU.ts')).default;
const npcUseHandler = new (await engineModule('network/game/client/handler/OpNpcUHandler.ts')).default();
const OpLoc = (await engineModule('network/game/client/model/OpLoc.ts')).default;
const locOpHandler = new (await engineModule('network/game/client/handler/OpLocHandler.ts')).default();
const rsbuf = await engineModule('network/rsbuf/index.ts');
const { NpcStat } = await engineModule('engine/entity/NpcStat.ts');
const mapsquares = [[46, 78], [46, 79], [47, 78], [47, 79], [47, 77], [45, 55]];
const equipment = ['roguesden_helm', 'roguesden_body', 'roguesden_legs', 'roguesden_gloves', 'roguesden_boots'];
const mazeItems = ['roguesden_flash_powder', 'roguesden_gem', ...Array.from({ length: 6 }, (_, i) => `roguesden_gear${i + 1}`), ...Array.from({ length: 4 }, (_, i) => `roguesden_puzzle_mosaic_tile${i + 1}`), 'roguesden_puzzle_rotation'];
const npcs = name => [...World.npcs].filter(n => n.baseType === id('NpcType', name));
const active = p => execute('[proc,roguesden_active]', p).popInt() === 1;
const text = p => [...p.messages, ...p.packets.filter(packet => packet.constructor.name === 'IfSetText').map(packet => packet.text)].join(' ').replaceAll('|', ' ').replace(/\s+/g, ' ');
const placements = [];
for (const [mx, mz] of mapsquares) {
  const raw = readFileSync(path.join(contentRoot, 'maps', `m${mx}_${mz}.jm2`), 'utf8');
  const source = raw.split('==== LOC ====')[1];
  const bridgeTiles = new Set([...raw.split('==== LOC ====')[0].matchAll(/^1 (\d+) (\d+): .*?\bf(\d+)\b/gm)]
    .filter(match => Number(match[3]) & 2).map(match => `${match[1]},${match[2]}`));
  assert(source, `original m${mx}_${mz} loc section exists`);
  for (const match of source.matchAll(/^(\d+) (\d+) (\d+): (\d+) (\d+)(?: (\d+))?$/gm)) {
    const [, originalLevel, lx, lz, type, shape] = match.map(Number);
    const angle = Number(match[6] ?? 0);
    const level = originalLevel - Number(bridgeTiles.has(`${lx},${lz}`));
    if (level < 0) continue;
    const config = types.LocType.get(type);
    if (!config.debugname?.startsWith('roguesden_')) continue;
    placements.push({ name: config.debugname, type, level, x: mx * 64 + lx, z: mz * 64 + lz, shape, angle });
  }
}
function location(name, x, z) {
  const rows = placements.filter(row => row.name === name && (x === undefined || row.x === x) && (z === undefined || row.z === z));
  assert.equal(rows.length, 1, `one original placement of ${name}@${x},${z}`);
  const row = rows[0], target = World.getLoc(row.x, row.z, row.level, row.type);
  assert(target, `${name} exists in the real packed world`);
  assert.equal(target.angle, row.angle, `${name} retains its original map orientation`);
  return target;
}
function finish(p, state, choices = []) {
  const pending = [...choices];
  for (let step = 0; step < 200 && state.execution !== ScriptState.FINISHED; step++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, `${state.script.name} must not abort`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
      const menu = /^multi[2-5]$/.test(types.Component.get(p.modalChat).comName);
      if (menu) assert(pending.length, `undeclared dialogue choice: ${text(p)}`);
      resumeDialogue(p, menu ? pending.shift() : null);
    } else {
      assert.equal(state.execution, ScriptState.SUSPENDED, `${state.script.name} has a supported delay`);
      environmentTick(p);
    }
  }
  assert.equal(state.execution, ScriptState.FINISHED, 'bounded product action finishes');
  assert.equal(pending.length, 0, 'every declared dialogue selection was offered');
  p.clearInteraction();
  return state;
}
function requireBoundHandler(p, script, label) {
  assert(script, `${label} resolves a packed script`);
  assert.notEqual(script, ScriptProvider.getByTriggerSpecific(p.targetOp), `${label} cannot use a global approach fallback`);
  assert.notEqual(script, ScriptProvider.getByTriggerSpecific(p.targetOp + 7), `${label} cannot use a global operation fallback`);
  return script;
}
let mazeTrace = null;
function traceWalk(point) {
  if (!mazeTrace) return;
  const last = mazeTrace.at(-1);
  if (last?.kind === 'walk') last.points.push([point.x, point.z, point.level]);
  else mazeTrace.push({ kind: 'walk', points: [[point.x, point.z, point.level]] });
}
function operation(p, target, option, kind = 'loc', choices = []) {
  const config = types[kind === 'loc' ? 'LocType' : 'NpcType'].get(target.type);
  const index = typeof option === 'number' ? option - 1 : config.op.findIndex(value => value?.toLowerCase() === option.toLowerCase());
  assert(index >= 0, `${config.debugname} exposes ${option}`);
  if (kind === 'loc') {
    p.originX = p.x; p.originZ = p.z;
    assert(locOpHandler.handle(new OpLoc(index + 1, target.x, target.z, target.type), p), `${config.debugname} native packet accepted`);
  } else {
    p.target = target; p.targetOp = ServerTriggerType[`AP${kind.toUpperCase()}${index + 1}`];
  }
  const script = requireBoundHandler(p,
    p.inOperableDistance(target) ? (p.getOpTrigger() ?? p.getApTrigger()) : p.getApTrigger(),
    `${config.debugname} native ${option}`);
  const action = mazeTrace && { kind, name: config.debugname, x: target.x, z: target.z, level: target.level, option: config.op[index], choices };
  if (action) mazeTrace.push(action);
  let state;
  if (kind === 'loc') {
    assert((p.inOperableDistance(target) && p.getOpTrigger() === script) ||
      (p.inApproachDistance(p.apRange, target) && p.getApTrigger() === script),
      `${config.debugname} native reach admits its bound handler`);
    p.processInteraction();
    state = p.activeScript;
    if (state) finish(p, state, choices);
    else assert.equal(choices.length, 0, 'instant native operation has no pending dialogue choices');
  } else {
    state = ScriptRunner.init(script, p, target);
    p.executeScript(state, true, true);
    finish(p, state, choices);
  }
  if (action) action.landing = tile(p);
  return state;
}
function recordPlayerAnimations(p, action) {
  const phases = [], original = p.playAnimation;
  p.playAnimation = function(seq, delay) {
    original.call(this, seq, delay);
    if (seq >= 0) phases.push({ seq, tick: World.currentTick, tile: tile(this), applied: this.animId === seq });
  };
  try { action(); } finally { p.playAnimation = original; }
  return phases;
}
function withRolls(values, callback) {
  const original = JavaRandom.nextDouble;
  let index = 0;
  JavaRandom.nextDouble = () => values[Math.min(index++, values.length - 1)];
  try { return callback(); } finally { JavaRandom.nextDouble = original; }
}
function fixture(agility = 50, thieving = 50) {
  const p = player();
  for (const [skill, level] of [[PlayerStat.AGILITY, agility], [PlayerStat.THIEVING, thieving]]) {
    p.setLevel(skill, level);
  }
  return p;
}
const sameTile = (p, point) => assert.deepEqual(tile(p), [point.level, point.x, point.z]);
function safeLanding(point, label) {
  assert(map.isZoneAllocated(point.level, point.x, point.z), `${label} uses an allocated map tile`);
  assert.equal(map.isMapBlocked(point.x, point.z, point.level), false, `${label} is walkable`);
  const exits = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => map.canTravel(point.level, point.x, point.z, dx, dz, 1, 0, CollisionType.NORMAL));
  assert(exits.length, `${label} has a connected route out`);
  const [dx, dz] = exits[0];
  assert(map.findPath(point.level, point.x, point.z, point.x + dx, point.z + dz).length, `${label} has a native nonempty route out`);
}
// Positioning must not silently activate a different obstacle. Derive those
// footprints and directed centre approaches from the original map/config.
// Walking parallel past an obstacle is not an attempt to cross it.
const routeHazards = new Set();
const routeApproaches = new Map();
const routeTile = (x, z, level) => (level << 28) | (x << 14) | z;
const addApproach = (x, z, level, direction) => {
  const key = routeTile(x, z, level);
  routeApproaches.set(key, (routeApproaches.get(key) ?? 0) | direction);
};
for (const row of placements.filter(row => /^roguesden_trap_(?:floor_scytheblade|wall_scytheblade|floor_pendulum|floor_timedblade|wall_saw|floor_pitfall)$/.test(row.name))) {
  const type = types.LocType.get(row.type);
  const width = row.angle % 2 ? type.length : type.width, length = row.angle % 2 ? type.width : type.length;
  for (let x = row.x; x < row.x + width; x++) for (let z = row.z; z < row.z + length; z++) routeHazards.add(routeTile(x, z, row.level));
  if (['roguesden_trap_floor_pitfall', 'roguesden_trap_floor_scytheblade'].includes(row.name)) continue;
  if (width > length || (width === length && row.angle % 2)) {
    addApproach(row.x - 1, row.z + Math.floor(length / 2), row.level, 1);
    addApproach(row.x + width, row.z + Math.floor(length / 2), row.level, 2);
  } else {
    addApproach(row.x + Math.floor(width / 2), row.z - 1, row.level, 4);
    addApproach(row.x + Math.floor(width / 2), row.z + length, row.level, 8);
  }
}
function unintendedObstacle(x, z, level, destination, fromX, fromZ) {
  if (!mazeTrace || (x === destination.x && z === destination.z)) return false;
  const key = routeTile(x, z, level);
  if (routeHazards.has(key)) return true;
  const directions = routeApproaches.get(key) ?? 0;
  return (x > fromX && (directions & 1)) || (x < fromX && (directions & 2)) ||
    (z > fromZ && (directions & 4)) || (z < fromZ && (directions & 8));
}

function nativePath(from, to) {
  if (from.level !== to.level) return null;
  if (from.x === to.x && from.z === to.z) return [];
  const route = map.findPath(from.level, from.x, from.z, to.x, to.z);
  const last = route.at(-1);
  if (last === undefined || ((last >>> 14) & 0x3fff) !== to.x || (last & 0x3fff) !== to.z) return null;
  let x = from.x, z = from.z;
  const steps = [];
  for (const packed of route) {
    const tx = (packed >>> 14) & 0x3fff, tz = packed & 0x3fff;
    while (x !== tx || z !== tz) {
      const dx = Math.sign(tx - x), dz = Math.sign(tz - z);
      if (!map.canTravel(from.level, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) return null;
      x += dx; z += dz;
      if (unintendedObstacle(x, z, from.level, to, x - dx, z - dz)) return null;
      steps.push({ x, z, level: from.level });
    }
  }
  return steps;
}
function pathBetween(from, to) {
  const direct = nativePath(from, to);
  if (direct || from.level !== to.level) return direct;
  const regions = new Set(mapsquares.map(([x, z]) => `${x},${z}`));
  const key = (x, z) => (x << 14) | z, first = key(from.x, from.z), last = key(to.x, to.z);
  const queue = [first], parents = new Map([[first, null]]);
  for (let index = 0; index < queue.length && !parents.has(last); index++) {
    const point = queue[index], x = (point >>> 14) & 0x3fff, z = point & 0x3fff;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const nx = x + dx, nz = z + dz, next = key(nx, nz);
      if (parents.has(next) || !regions.has(`${nx >> 6},${nz >> 6}`) ||
        !map.isZoneAllocated(from.level, nx, nz) || map.isMapBlocked(nx, nz, from.level) ||
        unintendedObstacle(nx, nz, from.level, to, x, z) ||
        !map.canTravel(from.level, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
      parents.set(next, point); queue.push(next);
    }
  }
  if (!parents.has(last)) return null;
  const points = [];
  for (let point = last; point !== null; point = parents.get(point)) points.push(point);
  points.reverse();
  const steps = [];
  let origin = from;
  // The fallback is collision-aware BFS, but every chosen adjacent step must
  // independently resolve through the real native pathfinder as well.
  for (let index = 1; index < points.length; index++) {
    const point = points[index], destination = { x: (point >>> 14) & 0x3fff, z: point & 0x3fff, level: from.level };
    const leg = nativePath(origin, destination);
    if (!leg || leg.length !== 1) return null;
    steps.push(leg[0]);
    origin = destination;
  }
  return steps;
}
let beforeMazeStep = null;
function walk(p, destination, monitor = true) {
  const from = { x: p.x, z: p.z, level: p.level };
  const route = pathBetween(from, destination);
  if (!route) {
    const raw = [...map.findPath(from.level, from.x, from.z, destination.x, destination.z)].map(value => [value >>> 14 & 0x3fff, value & 0x3fff]);
    assert.fail(`packed native path reaches ${destination.x},${destination.z},${destination.level} from ${from.x},${from.z},${from.level}; blocked=${map.isMapBlocked(destination.x, destination.z, destination.level)}; raw=${JSON.stringify(raw)}`);
  }
  for (const point of route) {
    if (monitor && beforeMazeStep) beforeMazeStep(p, point);
    assert.equal(point.level, p.level, 'a walking step stays on its current floor');
    assert(Math.max(Math.abs(point.x - p.x), Math.abs(point.z - p.z)) === 1 &&
      map.canTravel(p.level, p.x, p.z, point.x - p.x, point.z - p.z, 1, 0, CollisionType.NORMAL), 'every fixture walking step is currently adjacent and native-walkable');
    // Fixture advances only after proving this exact step with packed collision.
    p.teleport(point.x, point.z, point.level);
    if (monitor) environmentTick(p);
    sameTile(p, point);
    traceWalk(point);
  }
  return route.length;
}
function standBy(p, target) {
  const type = types.LocType.get(target.type), candidates = [];
  const width = target.angle % 2 ? type.length : type.width;
  const length = target.angle % 2 ? type.width : type.length;
  for (let x = target.x - 1; x <= target.x + width; x++) for (let z = target.z - 1; z <= target.z + length; z++) {
    if (map.isMapBlocked(x, z, target.level) || !map.reachedLoc(target.level, x, z, target.x, target.z, type.width, type.length, 1, target.angle, target.shape, type.forceapproach)) continue;
    const point = { x, z, level: target.level }, route = pathBetween({ x: p.x, z: p.z, level: p.level }, point);
    if (route) candidates.push({ point, distance: route.length });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  assert(candidates.length, `${type.debugname} has a reachable exact operation tile`);
  return walk(p, candidates[0].point);
}
function atNpc(p, name) {
  const n = npcs(name)[0];
  assert(n, `${name} is an original packed NPC spawn`);
  const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const offset = offsets.find(([dx, dz]) => !map.isMapBlocked(n.x + dx, n.z + dz, n.level));
  assert(offset, `${name} has a walkable stand`);
  p.teleport(n.x + offset[0], n.z + offset[1], n.level);
  safeLanding({ x: p.x, z: p.z, level: p.level }, `${name} public stand`);
  return n;
}
function pickup(p, name, point) {
  const target = World.getObj(point.x, point.z, point.level, obj(name), p.username37);
  assert(target, `${name} exists as a real ground object for this player`);
  assert(p.inOperableDistance(target), `${name} pickup starts at a genuine operation tile`);
  p.target = target; p.targetOp = ServerTriggerType.APOBJ3;
  const script = p.getOpTrigger();
  assert(script, `${name} resolves production ground pickup`);
  const before = count(p, name), quantity = target.count;
  if (mazeTrace) mazeTrace.push({ kind: 'ground', name, x: point.x, z: point.z, level: point.level, option: 'Take', quantity });
  const state = ScriptRunner.init(script, p, target);
  p.executeScript(state, true, true); finish(p, state);
  assert.equal(count(p, name), before + quantity, `${name} was earned through the real ground stack pickup`);
}
function automaticCrossing(p, approach, landing, label) {
  const dx = Math.sign(landing.x - approach.x), dz = Math.sign(landing.z - approach.z);
  walk(p, { x: approach.x - dx, z: approach.z - dz, level: approach.level });
  const trigger = approach;
  if (beforeMazeStep) beforeMazeStep(p, trigger);
  assert(Math.max(Math.abs(trigger.x - p.x), Math.abs(trigger.z - p.z)) === 1 &&
    map.canTravel(p.level, p.x, p.z, trigger.x - p.x, trigger.z - p.z, 1, 0, CollisionType.NORMAL),
  `${label} has a genuine native trigger step onto its walkable approach`);
  const action = mazeTrace && { kind: 'automatic', label, from: tile(p), trigger: [trigger.x, trigger.z, trigger.level], landing: [landing.level, landing.x, landing.z] };
  if (action) mazeTrace.push(action);
  p.teleport(trigger.x, trigger.z, trigger.level);
  for (let tick = 0; tick < 20 && (p.x !== landing.x || p.z !== landing.z); tick++) {
    environmentTick(p);
    if (p.activeScript) finish(p, p.activeScript);
  }
  sameTile(p, landing);
  safeLanding(landing, label);
  assert(active(p), `${label} preserves the earned maze session`);
}
const shownPlayers = new WeakSet();
function useOnNpc(p, name, n) {
  p.originX = p.x; p.originZ = p.z;
  if (!shownPlayers.has(p)) { rsbuf.addPlayer(p.slot); shownPlayers.add(p); }
  p.buildArea.rebuild();
  const appearance = p.generateAppearance();
  rsbuf.computePlayer(p.x, p.level, p.z, p.originX, p.originZ, p.slot, p.tele, p.jump,
    p.runDir, p.walkDir, p.visibility, p.isActive, p.masks, appearance, p.lastAppearance,
    p.faceEntity, p.faceSquareX, p.faceSquareZ, p.faceAngleX, p.faceAngleZ,
    p.hitmarkDamage, p.hitmarkType, p.hitmark2Damage, p.hitmark2Type,
    p.levels[PlayerStat.HITPOINTS], p.baseLevels[PlayerStat.HITPOINTS], p.animId, p.animDelay,
    p.sayMessage, p.chatMessage, p.chatColour ?? -1, p.chatEffect ?? -1, p.chatRights ?? 0,
    p.spotanimId, p.spotanimHeight, p.spotanimTime);
  rsbuf.computeNpc(n.x, n.level, n.z, n.nid, n.type, n.tele, n.jump,
    n.runDir, n.walkDir, n.isActive, n.masks, n.faceEntity, n.faceSquareX, n.faceSquareZ, n.faceAngleX, n.faceAngleZ,
    n.hitmarkDamage, n.hitmarkType, n.hitmark2Damage, n.hitmark2Type,
    n.levels[NpcStat.HITPOINTS], n.baseLevels[NpcStat.HITPOINTS], n.animId, n.animDelay, n.sayMessage, n.spotanimId, n.spotanimHeight, n.spotanimTime);
  rsbuf.npcInfo(0, p.slot, 0, 0, true);
  assert(rsbuf.hasNpc(p.slot, n.nid), 'actual guard is in the native received NPC view');
  const action = mazeTrace && { kind: 'itemOnNpc', name, npc: types.NpcType.get(n.type).debugname, x: n.x, z: n.z, level: n.level };
  if (action) mazeTrace.push(action);
  const before = count(p, name);
  assert(npcUseHandler.handle(new OpNpcU(n.nid, obj(name), slotOf(p, name), invCom), p), 'production item-on-NPC input accepts the guard and powder');
  requireBoundHandler(p,
    p.inOperableDistance(n) ? (p.getOpTrigger() ?? p.getApTrigger()) : p.getApTrigger(),
    'powder on the actual visible guard');
  for (let tick = 0; tick < 20 && active(p) && count(p, name) === before; tick++) environmentTick(p);
  assert(active(p), 'native powder approach stuns without catching the player');
  assert.equal(count(p, name), before - 1, 'native powder use consumes exactly one');
  p.clearInteraction();
  if (action) action.landing = tile(p);
}

for (const name of [...equipment, 'roguesden_kit', ...mazeItems]) {
  assert.equal(types.ObjType.get(obj(name)).tradeable, false, `${name} is untradeable in config`);
}
const audit = fixture();
const interactive = new Set();
for (const row of placements) {
  const type = types.LocType.get(row.type);
  if (!type.op?.some(option => option && option.toLowerCase() !== 'hidden')) continue;
  const target = World.getLoc(row.x, row.z, row.level, row.type);
  assert(target, `${row.name} is loaded at its original map anchor`);
  for (let index = 0; index < type.op.length; index++) {
    if (!type.op[index] || type.op[index].toLowerCase() === 'hidden') continue;
    audit.target = target; audit.targetOp = ServerTriggerType[`APLOC${index + 1}`];
    requireBoundHandler(audit, audit.getOpTrigger() ?? audit.getApTrigger(), `${row.name} ${type.op[index]} visible-form binding`);
  }
  interactive.add(row.name);
}
audit.clearInteraction();
assert(interactive.size > 15, 'the map audit covers the real obstacle network, not one sample');
console.log(`PASS real packed map dispatch: ${interactive.size} interactive loc forms, ${placements.length} Rogues' Den placements`);

for (const [agility, thieving, allowed] of [[49, 50, false], [50, 49, false], [50, 50, true]]) {
  const p = fixture(agility, thieving), trader = atNpc(p, 'roguesden_trader');
  operation(p, trader, 'Trade', 'npc');
  assert.equal(p.modalMain === id('Component', 'shop_template'), allowed, `${agility}/${thieving} Lost and Found gate`);
  if (allowed) assert.equal(p.getVar(id('VarPlayerType', 'shop')), id('InvType', 'roguesden_shop'));
}
const bankerPlayer = fixture(), banker = atNpc(bankerPlayer, 'roguesden_banker');
operation(bankerPlayer, banker, 'Bank', 'npc');
assert.equal(bankerPlayer.modalMain, id('Component', 'bank_main'));
assert.equal(bankerPlayer.modalSide, id('Component', 'bank_side'));
assert(bankerPlayer.invListeners.some(listener => listener.type === id('InvType', 'bank') && listener.com === id('Component', 'bank_main:bank')));
console.log('PASS existing shared bank and gated Lost and Found shop');
const shopConfig = types.InvType.get(id('InvType', 'roguesden_shop'));
assert.deepEqual(Array.from(shopConfig.stockobj), ['rope', 'lockpick', 'chisel', 'knife', 'roguesden_stethoscope', 'bronze_knife', 'iron_knife', 'steel_knife', 'bronze_claws', 'iron_claws', 'steel_claws'].map(obj), 'the period eleven-item Lost and Found stock is retained');
assert.equal(types.ObjType.get(obj('roguesden_stethoscope')).cost, 10, 'period stethoscope base price');
assert.deepEqual(['bronze_knife', 'iron_knife', 'steel_knife'].map(name => types.ObjType.get(obj(name)).cost), [1, 3, 11], 'original cache knife values are retained despite the conflicting guide price table');
{
  const p = fixture(), door = location('roguesden_trapdoor_entrance');
  p.teleport(2906, 3537, 0);
  standBy(p, door); operation(p, door, 1);
  sameTile(p, { x: 3061, z: 4984, level: 1 });
  safeLanding({ x: p.x, z: p.z, level: p.level }, 'original pub trapdoor');
  const alcoveDoor = location('roguesden_door_to_pub');
  standBy(p, alcoveDoor); operation(p, alcoveDoor, 'Open');
  const publicSafe = location('roguesden_walldecor_safe', 3055, 4970);
  standBy(p, publicSafe);
  const before = p.stats[PlayerStat.THIEVING];
  withRolls([0, 0], () => operation(p, publicSafe, 'Crack'));
  assert.equal(p.stats[PlayerStat.THIEVING] - before, 700, 'real pub entry and ordinary alcove-door opening lead on foot to an operable original lobby safe');
  assert(count(p, 'coins') > 0, 'the public on-foot safe approach produces real safe loot');
  const passage = location('roguesden_passage_to_pub');
  standBy(p, passage); operation(p, passage, 1);
  sameTile(p, { x: 2906, z: 3537, level: 0 });
  safeLanding({ x: p.x, z: p.z, level: p.level }, 'original pub passage');
}
for (const trigger of ['[login,_]', '[logout,_]']) {
  const p = fixture(), before = { tile: tile(p), inventory: inventory(p) };
  execute(trigger, p);
  assert.deepEqual({ tile: tile(p), inventory: inventory(p) }, before, `${trigger} keeps an ordinary account's position and possessions`);
  assert.equal(active(p), false, `${trigger} does not start a maze run`);
}

function jewel(p) {
  const brian = atNpc(p, 'roguesden_mazemaster');
  operation(p, brian, 'Talk-to', 'npc');
  return count(p, 'roguesden_gem');
}
const entrance = location('roguesden_mazeentrance');
function enter(p) {
  assert.equal(jewel(p), 1, 'Brian supplies one original Mystic jewel before entry');
  standBy(p, entrance);
  operation(p, entrance, 1);
  assert(active(p), 'the real entrance starts the maze session');
  assert.equal(count(p, 'roguesden_gem'), 1, 'entry retains the escape jewel');
  return p;
}
function clean(p) {
  assert.equal(active(p), false, 'run state is cleared');
  for (const name of mazeItems) assert.equal(count(p, name) + count(p, name, worn), 0, `${name} is stripped`);
  assert.equal(p.level, 1, 'return is on the original lobby floor');
  assert(p.x >= 3046 && p.x <= 3068 && p.z >= 4966 && p.z <= 4988, 'return is in the lobby, not merely the maze mapsquare');
  safeLanding({ x: p.x, z: p.z, level: p.level }, 'lobby recovery');
  for (let skill = 0; skill < p.levels.length; skill++) assert.equal(p.levels[skill], p.baseLevels[skill], `recovery restores skill ${skill}`);
  assert.equal(p.tabs[3], types.Component.get(id('Component', 'inventory:inv')).rootLayer, 'inventory tab restored');
  assert.equal(p.tabs[4], types.Component.get(id('Component', 'wornitems:worn')).rootLayer, 'equipment tab restored');
}
function heldAction(p, name, option, choices = []) {
  assert(held(p, name, option), `${name} option ${option} is accepted by production item input`);
  environmentTick(p);
  if (p.activeScript) finish(p, p.activeScript, choices);
}
for (const [agility, thieving] of [[49, 50], [50, 49]]) {
  const p = fixture(agility, thieving);
  assert.equal(jewel(p), 0, `${agility}/${thieving} Brian admission is refused`);
  seed(p, ['roguesden_gem']);
  standBy(p, entrance); operation(p, entrance, 1);
  assert.equal(active(p), false, 'the doorway independently enforces both requirements');
}
for (const which of [inv, worn]) {
  const p = fixture();
  p.invAdd(which, obj('bronze_dagger'), 1);
  assert.equal(jewel(p), 0, 'Brian refuses carried or worn possessions');
  seed(p, ['roguesden_gem']);
  standBy(p, entrance); operation(p, entrance, 1);
  assert.equal(active(p), false, 'doorway does not bypass the deposit check');
}
{
  const p = fixture();
  assert.equal(jewel(p), 1);
  assert.equal(jewel(p), 1, 'repeated Brian conversation cannot duplicate the jewel');
  p.invDel(inv, obj('roguesden_gem'), 1);
  assert.equal(jewel(p), 1, 'a lost pre-entry jewel is recoverable from Brian');
}
{
  const p = enter(fixture());
  heldAction(p, 'roguesden_gem', 1);
  clean(p);
}
for (const hook of ['roguesden_login', 'roguesden_logout', 'roguesden_death']) {
  const ordinary = fixture();
  seed(ordinary, ['coins', 'bronze_dagger']);
  ordinary.levels[PlayerStat.AGILITY] = 37;
  const before = { tile: tile(ordinary), inventory: inventory(ordinary), levels: [...ordinary.levels], tabs: [...ordinary.tabs] };
  execute(`[proc,${hook}]`, ordinary);
  assert.deepEqual({ tile: tile(ordinary), inventory: inventory(ordinary), levels: [...ordinary.levels], tabs: [...ordinary.tabs] }, before, `${hook} never changes an ordinary account`);

  const p = enter(fixture());
  seed(p, mazeItems.filter(name => name !== 'roguesden_gem'));
  p.levels.fill(1);
  p.setVar(id('VarPlayerType', 'poison'), 10);
  execute(`[proc,${hook}]`, p);
  clean(p);
  assert.equal(p.getVar(id('VarPlayerType', 'poison')), 0, `${hook} clears poison`);
}
{
  const p = enter(fixture());
  p.invDel(inv, obj('roguesden_gem'), 1);
  for (let tick = 0; tick < 4 && active(p); tick++) environmentTick(p);
  clean(p);
}
{
  const p = enter(fixture());
  const ticks = p.getVar(id('VarPlayerType', 'varp319_unused')) & 1023;
  assert(ticks > 0, 'entry starts a finite original-slot clock');
  for (let tick = 0; tick <= ticks + 1 && active(p); tick++) environmentTick(p);
  clean(p);
}
{
  const p = enter(fixture());
  seed(p, ['roguesden_flash_powder', 'roguesden_puzzle_mosaic_tile4']);
  p.levels.fill(0);
  execute('[proc,player_die]', p);
  execute('[proc,player_die]', p);
  environmentTick(p);
  if (p.activeScript) finish(p, p.activeScript);
  clean(p);
  assert(!text(p).includes('Oh dear you are dead'), 'maze death returns before ordinary keep/drop handling');
  assert(![...p.queue.all()].some(request => request.script.name === '[queue,player_death_default]'), 'maze death clears its death queue');
}
{
  const ordinary = fixture();
  ordinary.levels[PlayerStat.HITPOINTS] = 0;
  execute('[queue,player_death_default]', ordinary);
  assert.equal(ordinary.level, 0);
  assert(Math.abs(ordinary.x - 3221) <= 2 && Math.abs(ordinary.z - 3218) <= 2, 'ordinary death still uses mainland Lumbridge respawn');
  assert(text(ordinary).includes('Oh dear you are dead'), 'ordinary death still follows the ordinary death branch');
}
console.log('PASS admission, prior jewel handover, item-loss recovery, finite clock and ordinary/maze lifecycle separation');

const lobbySafe = placements.find(row => row.name === 'roguesden_walldecor_safe');
assert(lobbySafe, 'original lobby wall safe placement exists');
function safeFixture(thieving = 50, stethoscope = false) {
  const p = fixture(50, thieving);
  p.teleport(lobbySafe.x - 1, lobbySafe.z, lobbySafe.level);
  if (stethoscope) seed(p, ['roguesden_stethoscope']);
  const target = location(lobbySafe.name, lobbySafe.x, lobbySafe.z);
  standBy(p, target);
  return { p, target };
}
for (const stethoscope of [false, true]) {
  const { p, target } = safeFixture(50, stethoscope), before = p.stats[PlayerStat.THIEVING];
  withRolls([0, 0], () => operation(p, target, 'Crack'));
  assert.equal(p.stats[PlayerStat.THIEVING] - before, 700, 'lobby success awards 70 XP in tenths');
  assert(count(p, 'coins') > 0, 'lobby success awards coins from its independent loot table');
}
{
  const { p, target } = safeFixture(49), before = p.stats[PlayerStat.THIEVING];
  withRolls([0], () => operation(p, target, 'Crack'));
  assert.equal(p.stats[PlayerStat.THIEVING], before);
  assert.equal(count(p, 'coins'), 0, 'safe independently refuses below level 50');
}
for (const stethoscope of [false, true]) {
  const { p, target } = safeFixture(50, stethoscope), before = p.stats[PlayerStat.THIEVING];
  const hp = p.levels[PlayerStat.HITPOINTS];
  withRolls([0.36, 0, 0], () => operation(p, target, 'Crack'));
  assert.equal(p.stats[PlayerStat.THIEVING] - before, stethoscope ? 700 : 0, 'carried stethoscope changes the actual threshold without item-on-safe use');
  if (!stethoscope) assert(p.levels[PlayerStat.HITPOINTS] <= hp - 2 && p.levels[PlayerStat.HITPOINTS] >= hp - 6, 'failed lobby safe deals candidate 2–6 damage');
}
console.log('PASS lobby safe level, XP, loot, failure damage and passive stethoscope bonus');

for (const [roll, name, quantity] of [[0, 'coins', 10], [25, 'coins', 20], [81, 'coins', 40], [102, 'uncut_sapphire', 1], [114, 'uncut_emerald', 1], [123, 'uncut_ruby', 1], [127, 'uncut_diamond', 1]]) {
  const { p, target } = safeFixture();
  withRolls([0, (roll + 0.5) / 128], () => operation(p, target, 'Crack'));
  assert.equal(count(p, name), quantity, `lobby loot bucket ${roll}`);
}
const vaultSafeRow = placements.find(row => row.name === 'roguesden_walldecor_mazesafe');
assert(vaultSafeRow, 'original central vault safe is mapped');
function vaultFixture() {
  const p = enter(fixture());
  // Independent reward fixture only. Full-route proof below walks to this room.
  const target = location(vaultSafeRow.name, vaultSafeRow.x, vaultSafeRow.z);
  const type = types.LocType.get(target.type);
  const candidates = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
  const offset = candidates.find(([dx, dz]) => !map.isMapBlocked(target.x + dx, target.z + dz, target.level) &&
    map.reachedLoc(target.level, target.x + dx, target.z + dz, target.x, target.z, type.width, type.length, 1, target.angle, target.shape, type.forceapproach));
  assert(offset, 'central safe has a real walkable operation tile');
  p.teleport(target.x + offset[0], target.z + offset[1], target.level);
  assert(p.inOperableDistance(target), 'vault fixture uses native operable reach, including same-tile wall decoration');
  safeLanding({ x: p.x, z: p.z, level: p.level }, 'central safe operation tile');
  return { p, target };
}
for (const maze of [false, true]) {
  const { p, target } = maze ? vaultFixture() : safeFixture();
  const start = tile(p);
  const expected = ['rogue_player_crack_safe_start', 'rogue_player_crack_safe_mid', 'rogue_player_crack_safe_end'].map(name => id('SeqType', name));
  const phases = recordPlayerAnimations(p, () => withRolls([0, 0], () => operation(p, target, 'Crack')));
  assert.deepEqual(phases.map(phase => phase.seq), expected, `${maze ? 'vault' : 'lobby'} safe plays every original cracking phase`);
  for (let index = 0; index < phases.length; index++) {
    const phase = phases[index], end = phases[index + 1]?.tick ?? World.currentTick;
    assert(phase.applied, 'each safe phase reaches the native player animation field, including the lower-priority end');
    assert.deepEqual(phase.tile, start, 'safe animation plays beside the safe, before the lobby return');
    assert.equal(end - phase.tick, Math.max(1, Math.ceil(types.SeqType.get(phase.seq).duration / 30)), 'each original safe phase has its full rounded duration');
  }
  assert.equal(p.animId, -1, 'safe presentation clears its animation afterward');
  if (maze) clean(p);
}
console.log('PASS native lobby/vault safe start, middle and end animation phases before return');
const pieces = new Set();
for (let index = 0; index < 6; index++) {
  const { p, target } = vaultFixture();
  // Independent reward fixture supplies current skill losses, then calls the
  // same record-only bookkeeping that real obstacle handlers call below.
  p.levels[PlayerStat.AGILITY] -= 5;
  p.levels[PlayerStat.THIEVING] -= 6;
  assert.equal(execute('[proc,roguesden_maze_drain_agility]', p, [5]).popInt(), 5);
  assert.equal(execute('[proc,roguesden_maze_drain_thieving]', p, [6]).popInt(), 6);
  const before = [p.stats[PlayerStat.AGILITY], p.stats[PlayerStat.THIEVING]];
  const rolls = index === 5 ? [0, 0] : [0, 0.99, (index + 0.5) / 5];
  withRolls(rolls, () => operation(p, target, 'Crack'));
  clean(p);
  assert.equal(p.stats[PlayerStat.AGILITY] - before[0], 600, 'completion pays 12 XP per actual Agility level drained');
  assert.equal(p.stats[PlayerStat.THIEVING] - before[1], 720, 'completion pays 12 XP per actual Thieving level drained');
  const won = [...equipment, 'roguesden_kit'].filter(name => count(p, name));
  assert.equal(won.length, 1, 'one original reward, not a crate or choice claim');
  if (index === 5) assert.equal(won[0], 'roguesden_kit');
  else pieces.add(won[0]);
}
assert.deepEqual([...pieces].sort(), [...equipment].sort(), 'all five original random Rogue pieces can be won');
{
  const p = enter(fixture());
  p.levels[PlayerStat.AGILITY] -= 5; p.levels[PlayerStat.THIEVING] -= 6;
  execute('[proc,roguesden_maze_drain_agility]', p, [5]);
  execute('[proc,roguesden_maze_drain_thieving]', p, [6]);
  const before = [p.stats[PlayerStat.AGILITY], p.stats[PlayerStat.THIEVING]];
  heldAction(p, 'roguesden_gem', 1); clean(p);
  assert.equal(p.stats[PlayerStat.AGILITY] - before[0], 300, 'UNKNOWN half-rate partial-run default retains earned Agility progress');
  assert.equal(p.stats[PlayerStat.THIEVING] - before[1], 360, 'UNKNOWN half-rate partial-run default retains earned Thieving progress');
  const awarded = [p.stats[PlayerStat.AGILITY], p.stats[PlayerStat.THIEVING]];
  execute('[proc,roguesden_login]', p); execute('[proc,roguesden_logout]', p);
  assert.deepEqual([p.stats[PlayerStat.AGILITY], p.stats[PlayerStat.THIEVING]], awarded, 'cleared recovery hooks cannot pay partial-run XP again');
}
const rewards = p => [...equipment, 'roguesden_kit'].reduce((total, name) => total + count(p, name), 0);
for (const level of [6, 50]) for (const roll of [level, level + 1]) {
  const { p, target } = vaultFixture();
  p.levels[PlayerStat.THIEVING] = level; // Isolated current-visible-skill boundary.
  withRolls([(roll + 0.5) / 200, 0], () => operation(p, target, 'Crack'));
  clean(p);
  assert.equal(rewards(p), Number(roll === level), `vault roll ${roll}: T passes, T+1 ejects at visible Thieving ${level}`);
}
{
  const { p, target } = vaultFixture(), before = p.stats[PlayerStat.THIEVING];
  withRolls([0.999, 0.75, 0.99, 0], () => operation(p, target, 'Crack'));
  clean(p);
  assert.equal(count(p, 'roguesden_body'), 1, 'non-ejected failed check still takes the equipment reward roll');
  assert.equal(p.stats[PlayerStat.THIEVING] - before, 120, 'failed check records its one-level drain before completion XP');
}
{
  const { p, target } = vaultFixture();
  p.levels[PlayerStat.THIEVING] -= 6;
  execute('[proc,roguesden_maze_drain_thieving]', p, [6]);
  const before = p.stats[PlayerStat.THIEVING];
  withRolls([0.999, 0], () => operation(p, target, 'Crack'));
  clean(p);
  assert.equal(rewards(p), 0, 'ejected failed check takes no reward roll');
  assert.equal(p.stats[PlayerStat.THIEVING] - before, 360, 'ejection pays only the existing half-rate progress');
}
let equipmentBuckets = 0;
for (let bucket = 0; bucket < 8; bucket++) {
  const { p, target } = vaultFixture();
  withRolls([0, (bucket + 0.5) / 8, 0], () => operation(p, target, 'Crack'));
  clean(p);
  assert.equal(count(p, 'roguesden_kit'), Number(bucket < 3), 'exactly the first three reward buckets award a kit');
  equipmentBuckets += equipment.reduce((total, name) => total + count(p, name), 0);
}
assert.equal(equipmentBuckets, 5, 'exactly five of eight reward buckets award equipment');
for (const [level, expectedRewards] of [[50, 251], [6, 207]]) {
  let awarded = 0;
  // Exhaust the compiled check's 200 rolls and both equally likely ejection
  // outcomes. Duplicate successful checks preserve that common denominator.
  for (let roll = 0; roll < 200; roll++) for (const eject of [0, 1]) {
    const { p, target } = vaultFixture();
    p.levels[PlayerStat.THIEVING] = level; // Independent odds fixture, not a traversed run.
    const first = (roll + 0.5) / 200;
    withRolls(roll <= level ? [first, 0] : [first, (eject + 0.5) / 2, 0], () => operation(p, target, 'Crack'));
    clean(p);
    awarded += rewards(p);
  }
  assert.equal(awarded, expectedRewards, `compiled vault reward outcomes at visible Thieving ${level}`);
  if (level === 50) assert.equal((100 * awarded / 400 * equipmentBuckets / 8).toFixed(2), '39.22', 'source equipment chance at Thieving 50');
  else assert.equal((100 * awarded / 400).toFixed(2), '51.75', 'source any-reward chance at route-drained Thieving 6');
}
{
  const { p, target } = vaultFixture();
  p.levels[PlayerStat.THIEVING] -= 44; // Independent fixture for the actual route's visible level.
  execute('[proc,roguesden_maze_drain_thieving]', p, [44]);
  const before = p.stats[PlayerStat.THIEVING];
  operation(p, target, 'Crack'); // Natural RNG: assert either legal outcome, never retry.
  clean(p);
  const won = rewards(p), xp = p.stats[PlayerStat.THIEVING] - before;
  assert(won === 0 || won === 1, 'one natural-RNG crack at visible Thieving 6 has a legal reward count');
  assert(won ? xp === 44 * 120 || xp === 45 * 120 : xp === 44 * 60, 'natural outcome pays its exact completion or ejection progress');
}
console.log('PASS inclusive vault boundaries, drain-then-reward/ejection, 3/8 kit, exact 39.22%/51.75% rates and one natural-RNG crack');
const kitTools = new Set();
for (let choice = 1; choice <= 4; choice++) {
  const p = fixture();
  p.invAdd(inv, obj('roguesden_kit'), 2);
  heldAction(p, 'roguesden_kit', 1, [choice]);
  assert.equal(count(p, 'roguesden_kit'), 1, 'Build consumes exactly one kit');
  const built = ['tinderbox', 'chisel', 'rope', 'spade'].filter(name => count(p, name));
  assert.equal(built.length, 1, 'each original kit option builds one tool');
  kitTools.add(built[0]);
}
assert.deepEqual([...kitTools].sort(), ['chisel', 'rope', 'spade', 'tinderbox']);
console.log('PASS all lobby loot buckets, original maze rewards, completion XP, safe failure branches and four kit conversions');

{
  const p = enter(fixture());
  p.teleport(2957, 5068, 1); // Independent first across-passage admission fixture.
  const passage = location('roguesden_passage_across', 2957, 5069);
  assert(p.inOperableDistance(passage), 'the original wall passage is operable from its real approach');
  assert.equal(p.inApproachDistance(10, passage), false, 'the same original wall blocks APLOC sight');
  operation(p, passage, 'Enter');
  sameTile(p, { x: 2957, z: 5072, level: 1 });
  heldAction(p, 'roguesden_gem', 1); clean(p);
}
console.log('PASS native loc packet and blocked-sight wall-passage operable reach');

for (const row of placements.filter(row => row.name === 'roguesden_gallery_door' && row.level === 1)) {
  const p = enter(fixture()), [dx, dz] = [[-1, 0], [0, 1], [1, 0], [0, -1]][row.angle];
  p.teleport(row.x, row.z, row.level); // Independent original passage/ladders branch.
  operation(p, location('roguesden_passage_up', row.x - dx, row.z - dz), 'Enter');
  sameTile(p, { x: row.x - dx * 3, z: row.z - dz * 3, level: row.level });
  operation(p, location('roguesden_passage_down', row.x - dx * 2, row.z - dz * 2), 'Climb-Down');
  clean(p);
}
console.log('PASS native operative gallery passages and approach-reachable ladder returns');

// Each gallery entry is exercised from its maze-facing side. The raw map's
// plane-two viewing floor and ladders are bridge-adjusted to effective plane one.
for (const row of placements.filter(row => row.name === 'roguesden_gallery_door' && row.level === 1)) {
  const p = enter(fixture()), [dx, dz] = [[-1, 0], [0, 1], [1, 0], [0, -1]][row.angle];
  p.teleport(row.x + dx, row.z + dz, row.level); // Isolated exit branch fixture.
  operation(p, location(row.name, row.x, row.z), 'Open');
  sameTile(p, { x: row.x - dx * 3, z: row.z - dz * 3, level: 1 });
  safeLanding({ x: p.x, z: p.z, level: p.level }, `original raised gallery ${row.x},${row.z}`);
  assert(active(p), 'a gallery visitor retains the escape session');
  heldAction(p, 'roguesden_gem', 1);
  clean(p);
}
{
  const p = enter(fixture());
  p.teleport(2994, 5005, 1); // Independent optional-ledge branch, not route travel.
  const before = p.levels[PlayerStat.AGILITY];
  const phases = recordPlayerAnimations(p, () => operation(p, location('roguesden_obstacle_wall_hanging_ledge', 2993, 5005), 'Climb'));
  assert.deepEqual(phases.map(phase => [phase.seq, phase.applied]), [[id('SeqType', 'human_ledge_walk_left'), true]], 'reverse hanging-ledge crossing plays the original leftward sequence');
  sameTile(p, { x: 2988, z: 5005, level: 1 });
  safeLanding({ x: p.x, z: p.z, level: p.level }, 'optional southern hanging ledge');
  assert(p.levels[PlayerStat.AGILITY] < before, 'the optional ledge consumes real Agility');
  heldAction(p, 'roguesden_gem', 1); clean(p);
}
// The original passage ends in a one-tile airlock, not beyond its grille.
// Prove all three genuine exits rather than inventing a walkable landing.
for (const exit of ['grille', 'jewel', 'back-passage']) {
  const p = enter(fixture());
  p.teleport(3043, 5037, 1); // Isolated original passage branch.
  operation(p, location('roguesden_passage_across', 3044, 5037), 1);
  sameTile(p, { x: 3047, z: 5037, level: 1 });
  assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, 'the original one-tile airlock is walkable');
  if (exit === 'grille') {
    operation(p, location('roguesden_obstacle_blocking_door_enter', 3048, 5037), 'Open');
    sameTile(p, { x: 3048, z: 5037, level: 1 });
    safeLanding({ x: p.x, z: p.z, level: p.level }, 'original airlock grille exit');
  } else if (exit === 'back-passage') {
    operation(p, location('roguesden_passage_across', 3046, 5037), 1);
    sameTile(p, { x: 3043, z: 5037, level: 1 });
    safeLanding({ x: p.x, z: p.z, level: p.level }, 'original airlock back-passage return');
  }
  heldAction(p, 'roguesden_gem', 1); clean(p);
}
console.log('PASS every original raised-gallery exit, jewel escape and optional hanging ledge');

function stepOnto(p, destination) {
  assert(Math.max(Math.abs(destination.x - p.x), Math.abs(destination.z - p.z)) === 1);
  assert(map.canTravel(p.level, p.x, p.z, destination.x - p.x, destination.z - p.z, 1, 0, CollisionType.NORMAL));
  p.teleport(destination.x, destination.z, p.level);
  environmentTick(p);
}
for (const occupiedTicks of [0, 4]) for (const expireNext of [false, true]) {
  const p = enter(fixture());
  p.teleport(3037, 4998, 1); // Isolated original adjacent-spike regression.
  operation(p, location('roguesden_trap_floor_spikes', 3036, 4998), 'Search');
  stepOnto(p, { x: 3036, z: 4998 });
  for (let tick = 0; tick < occupiedTicks; tick++) environmentTick(p);
  assert(active(p), 'the first genuinely searched footprint is safe');
  operation(p, location('roguesden_trap_floor_spikes', 3035, 4998), 'Search');
  for (let tick = 0; tick < (expireNext ? 21 : 4); tick++) environmentTick(p);
  sameTile(p, { x: 3036, z: 4998, level: 1 });
  assert(active(p), 'searching the next spike never rearms the occupied footprint');
  assert.equal(p.levels[PlayerStat.THIEVING], 48, 'the two real Search actions still cost two levels');
  stepOnto(p, { x: 3035, z: 4998 });
  for (let tick = 0; tick < 4 && active(p); tick++) environmentTick(p);
  if (!expireNext) {
    assert(active(p), 'the independently armed next footprint remains usable');
    sameTile(p, { x: 3035, z: 4998, level: 1 });
    stepOnto(p, { x: 3036, z: 4998 });
    for (let tick = 0; tick < 4 && active(p); tick++) environmentTick(p);
  }
  clean(p); // Expired-next entry and unsearched previous-footprint reentry fail.
}
for (const expired of [false, true]) {
  const p = enter(fixture());
  p.teleport(3056, 4993, 1); // Independent reachable trap-failure branch.
  if (expired) {
    operation(p, location('roguesden_trap_floor_spikes', 3056, 4994), 'Search');
    for (let tick = 0; tick < 21; tick++) environmentTick(p);
  }
  stepOnto(p, { x: 3056, z: 4994 });
  for (let tick = 0; tick < 4 && active(p); tick++) environmentTick(p);
  clean(p);
}
for (const name of ['roguesden_trap_floor_pitfall', 'roguesden_trap_floor_scytheblade']) {
  let entry = null;
  for (const row of placements.filter(row => row.level === 1 && row.name === name)) {
    const type = types.LocType.get(row.type), width = row.angle % 2 ? type.length : type.width, length = row.angle % 2 ? type.width : type.length;
    const minX = row.x, maxX = row.x + width, minZ = row.z, maxZ = row.z + length;
    for (let x = minX; x < maxX && !entry; x++) for (let z = minZ; z < maxZ && !entry; z++) {
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const fromX = x + dx, fromZ = z + dz;
        if ((fromX >= minX && fromX < maxX && fromZ >= minZ && fromZ < maxZ) ||
          map.isMapBlocked(x, z, 1) || map.isMapBlocked(fromX, fromZ, 1) ||
          !map.canTravel(1, fromX, fromZ, -dx, -dz, 1, 0, CollisionType.NORMAL)) continue;
        entry = { fromX, fromZ, x, z }; break;
      }
    }
    if (entry) break;
  }
  assert(entry, `${name} has a genuine native contact boundary`);
  const p = enter(fixture());
  p.teleport(entry.fromX, entry.fromZ, 1); // Independent original-trap contact fixture.
  stepOnto(p, { x: entry.x, z: entry.z });
  for (let tick = 0; tick < 4 && active(p); tick++) environmentTick(p);
  clean(p);
}
for (const name of ['roguesden_trap_floor_spinningblades_0', 'roguesden_trap_floor_spinningblades_1']) {
  const n = npcs(name)[0];
  assert(n, `${name} is the original packed moving actor`);
  const visited = new Set([`${n.x},${n.z}`]);
  for (let tick = 0; tick < 12; tick++) {
    const from = { x: n.x, z: n.z, level: n.level };
    World.currentTick++;
    n.resetEntity(); n.turn();
    const dx = n.x - from.x, dz = n.z - from.z;
    assert(Math.max(Math.abs(dx), Math.abs(dz)) <= 1, `${name} patrol never teleports`);
    if (dx || dz) assert(map.canTravel(from.level, from.x, from.z, dx, dz, 1, 0, CollisionType.NORMAL), `${name} uses a real native-walkable patrol step`);
    visited.add(`${n.x},${n.z}`);
  }
  assert(visited.size >= 4, `${name} genuinely patrols its original corridor: ${JSON.stringify([...visited])}; active=${n.isActive}; mode=${n.targetOp}`);
  const direction = [[-1, 0], [1, 0], [0, -1], [0, 1]].find(([dx, dz]) =>
    !map.isMapBlocked(n.x + dx * 2, n.z + dz * 2, n.level) &&
    map.canTravel(n.level, n.x + dx * 2, n.z + dz * 2, -dx, -dz, 1, 0, CollisionType.NORMAL) &&
    map.canTravel(n.level, n.x + dx, n.z + dz, -dx, -dz, 1, 0, CollisionType.NORMAL));
  assert(direction, `${name} has a genuine contact approach`);
  const [dx, dz] = direction, p = enter(fixture());
  p.teleport(n.x + dx * 2, n.z + dz * 2, n.level); // Independent blade-contact fixture.
  stepOnto(p, { x: n.x + dx, z: n.z + dz });
  for (let tick = 0; tick < 4 && active(p); tick++) environmentTick(p);
  clean(p);
}
{
  const p = enter(fixture());
  p.teleport(3016, 5072, 1); // Independent catch branch beside the original NPC.
  stepOnto(p, { x: 3017, z: 5072 });
  for (let tick = 0; tick < 4 && active(p); tick++) environmentTick(p);
  clean(p);
}
{
  const p = enter(fixture());
  seed(p, ['roguesden_flash_powder']); // Isolated stun branch, not route reward.
  p.teleport(3015, 5072, 1);
  const guard = [...World.npcs].find(n => n.x === 3018 && n.z === 5072);
  assert(guard);
  const originalType = guard.type;
  useOnNpc(p, 'roguesden_flash_powder', guard);
  assert.equal(guard.type, originalType, 'stun retains the original client NPC identity');
  sameTile(p, { x: 3015, z: 5072, level: 1 });
  walk(p, { x: 3019, z: 5072, level: 1 });
  safeLanding({ x: p.x, z: p.z, level: p.level }, 'powder guard crossing');
  assert.equal(count(p, 'roguesden_flash_powder'), 0);
  assert(active(p), 'the ranged powder throw protects its genuine crossing');
  for (let tick = 0; tick < 12 && active(p); tick++) environmentTick(p);
  clean(p);
}
{
  const guard = [...World.npcs].find(n => n.x === 3018 && n.z === 5072);
  assert(guard, 'running regression uses the original northern guard');
  const starts = [[4, 3014, 5072], [5, 3013, 5071], [6, 3012, 5069], [7, 3011, 5069], [8, 3010, 5069], [9, 3009, 5069]];
  let runningOvershot = false;
  for (const running of [false, true]) for (const [range, x, z] of starts) {
    World.currentTick += 20; // Isolate each fixture beyond the previous ten-tick stun.
    const p = enter(fixture());
    seed(p, ['roguesden_flash_powder']); // Independent approach fixture, not route-earned powder.
    p.teleport(x, z, 1);
    p.runanim = id('SeqType', 'human_running'); p.run = Number(running); p.runenergy = 10000;
    assert.equal(Math.max(Math.abs(p.x - guard.x), Math.abs(p.z - guard.z)), range);
    const start = tile(p);
    useOnNpc(p, 'roguesden_flash_powder', guard);
    assert.notDeepEqual(tile(p), start, 'native approach, not fixture teleportation, moves toward the guard');
    const throwRange = Math.max(Math.abs(p.x - guard.x), Math.abs(p.z - guard.z));
    assert(throwRange <= 3, `${running ? 'running' : 'walking'} from range ${range} reaches the throw window`);
    runningOvershot ||= running && throwRange < 3;
    walk(p, { x: 3017, z: 5072, level: 1 });
    assert(active(p), `${running ? 'running' : 'walking'} throw from range ${range} protects real close contact`);
    heldAction(p, 'roguesden_gem', 1); clean(p);
  }
  assert(runningOvershot, 'regression exercises a real running step past range three');
  console.log('PASS native walking and running powder approaches from every range 4-9, including running overshoot and protected contact');
}
for (const name of mazeItems.filter(name => name !== 'roguesden_gem')) {
  const p = enter(fixture());
  seed(p, [name]); // Independent loss fixture; full traversal earns its items.
  heldAction(p, name, 5);
  assert.equal(count(p, name), 0, `${name} can leave the inventory through real Drop input`);
  assert(active(p), `dropping ${name} does not strand or corrupt the session`);
  pickup(p, name, { x: p.x, z: p.z, level: p.level });
  heldAction(p, 'roguesden_gem', 1); clean(p);
}
{
  const p = enter(fixture());
  heldAction(p, 'roguesden_gem', 5);
  for (let tick = 0; tick < 4 && active(p); tick++) environmentTick(p);
  clean(p);
  assert.equal(jewel(p), 1, 'Brian recovers a genuinely dropped escape jewel after cleanup');
}
console.log('PASS adjacent occupied-trap lifetime, unarmed and expired traps, visible guard catch, ranged timed stun and every maze-item drop recovery');

function fullMazeRoute() {
  const p = enter(fixture()), point = (x, z) => ({ x, z, level: 1 });
  const before = [p.stats[PlayerStat.AGILITY], p.stats[PlayerStat.THIEVING]];
  mazeTrace = [];
  const traps = placements.filter(row => /^roguesden_trap_(?:floor_spikes|wall_spikes|wall_poison_gas|floor_explosion|floor_springtile|wall_crusher)$/.test(row.name));
  const inside = (row, here) => {
    const type = types.LocType.get(row.type), width = row.angle % 2 ? type.length : type.width, length = row.angle % 2 ? type.width : type.length;
    return here.level === row.level && here.x >= row.x && here.x < row.x + width && here.z >= row.z && here.z < row.z + length;
  };
  beforeMazeStep = (subject, next) => {
    for (const trap of traps) {
      if (!inside(trap, next) || inside(trap, subject)) continue;
      const before = subject.levels[PlayerStat.THIEVING];
      const phases = recordPlayerAnimations(subject, () => operation(subject, location(trap.name, trap.x, trap.z), 'Search'));
      const animation = trap.name.startsWith('roguesden_trap_wall_') ? 'roguesden_player_disarm_wall_infront' : 'roguesden_player_disarm_floor';
      assert.deepEqual(phases.map(phase => [phase.seq, phase.applied]), [[id('SeqType', animation), true]], 'native route Search plays its original floor or wall disarm sequence');
      for (let tick = 0; tick < 2; tick++) environmentTick(subject);
      assert.equal(subject.levels[PlayerStat.THIEVING], before - 1, 'a genuinely searched route trap consumes one current Thieving level');
      assert(active(subject), 'the disarmed trap leaves the original run active');
    }
  };
  const cross = (name, x, z, from, to, choices = []) => {
    walk(p, point(...from));
    const phases = recordPlayerAnimations(p, () => operation(p, location(name, x, z), 1, 'loc', choices));
    const animation = {
      roguesden_obstacle_contortion_bars: 'roguesden_contortion',
      roguesden_obstacle_floor_balancing_ledge: 'human_walk_logbalance',
      roguesden_obstacle_wall_hanging_ledge: 'human_ledge_walk_right',
      roguesden_passage_across: 'human_crawling',
      roguesden_obstacle_blocking_door_enter: 'human_pipesqueeze'
    }[name];
    if (animation) assert.deepEqual(phases.map(phase => [phase.seq, phase.applied]), [[id('SeqType', animation), true]], `${name} plays its real 377 crossing sequence`);
    sameTile(p, point(...to));
    if (name === 'roguesden_passage_across' && x === 3044 && z === 5037 && to[0] === 3047 && to[1] === 5037) {
      assert.equal(map.isMapBlocked(p.x, p.z, p.level), false, 'the original airlock remains walkable; all three exits are proven separately');
    } else safeLanding(point(...to), `${name}@${x},${z}`);
    assert(active(p), `${name} preserves the genuine maze session`);
  };
  const auto = (from, to, label) => automaticCrossing(p, point(...from), point(...to), label);
  const grille = (x, z, from, to) => cross('roguesden_obstacle_blocking_door_enter', x, z, from, to);
  const passage = (x, z, from, to) => cross('roguesden_passage_across', x, z, from, to);
  walk(p, point(3056, 4993));
  walk(p, point(3056, 4995));
  cross('roguesden_obstacle_contortion_bars', 3049, 4997, [3050, 4997], [3048, 4997]);
  auto([3043, 4998], [3039, 4998], 'entry-pendulum');
  grille(3024, 5001, [3024, 5001], [3023, 5001]);
  // The optional southern hanging ledge is covered separately; the normal
  // fifty-Agility route saves its drain by using the original walkable path.
  auto([2970, 5016], [2967, 5016], 'western-spinning-saw');
  auto([2954, 5024], [2954, 5028], 'western-pendulum');
  cross('roguesden_obstacle_floor_balancing_ledge', 2958, 5031, [2958, 5030], [2958, 5035]);
  passage(2957, 5069, [2957, 5068], [2957, 5072]);
  auto([2957, 5073], [2957, 5076], 'northwestern-spinning-saw');
  passage(2955, 5095, [2955, 5094], [2955, 5098]);
  passage(2972, 5097, [2972, 5098], [2972, 5094]);
  grille(2972, 5094, [2972, 5094], [2972, 5093]);
  cross('roguesden_obstacle_wall_hanging_ledge', 2983, 5090, [2982, 5090], [2991, 5090]);
  walk(p, point(2992, 5088));
  walk(p, point(2997, 5088));
  auto([2999, 5088], [3005, 5088], 'northern-two-floor-blades');
  walk(p, point(3018, 5085));
  pickup(p, 'roguesden_puzzle_mosaic_tile4', point(3018, 5086));
  cross('roguesden_puzzle_door_mosaic', 3023, 5082, [3023, 5082], [3024, 5082], [4]);
  grille(3030, 5079, [3030, 5079], [3031, 5079]);
  grille(3032, 5078, [3032, 5078], [3032, 5077]);
  grille(3032, 5069, [3032, 5069], [3032, 5068]);
  grille(3037, 5067, [3036, 5067], [3037, 5067]);
  passage(3044, 5037, [3043, 5037], [3047, 5037]);
  grille(3048, 5037, [3047, 5037], [3048, 5037]);
  passage(3054, 5061, [3054, 5060], [3054, 5064]);
  passage(3054, 5068, [3054, 5067], [3054, 5071]);
  // The northern pendulum loop is optional; use the original connected main corridor.
  grille(3018, 5021, [3018, 5021], [3017, 5021]);
  passage(3015, 5021, [3016, 5021], [3012, 5021]);
  grille(2995, 5021, [2995, 5021], [2994, 5021]);
  auto([2971, 5036], [2971, 5040], 'southern-wall-scythe');
  grille(2989, 5057, [2989, 5057], [2990, 5057]);
  walk(p, point(3009, 5069));
  pickup(p, 'roguesden_flash_powder', point(3009, 5070));
  walk(p, point(3015, 5072));
  const guard = [...World.npcs].find(n => n.x === 3018 && n.z === 5072);
  assert(guard, 'original northern vault guard exists');
  const powderBefore = count(p, 'roguesden_flash_powder');
  useOnNpc(p, 'roguesden_flash_powder', guard);
  assert.equal(count(p, 'roguesden_flash_powder'), powderBefore - 1, 'the genuine stun consumes one earned powder');
  walk(p, point(3019, 5072));
  auto([3029, 5055], [3029, 5047], 'vault-two-pendulums');
  walk(p, point(3013, 5047));
  const route = { version: 1, label: 'native packed-map full route, no maze state or item seeds', agility: 50, thieving: 50, actions: mazeTrace };
  mazeTrace = null; beforeMazeStep = null;
  const agilityDrained = 50 - p.levels[PlayerStat.AGILITY], thievingDrained = 50 - p.levels[PlayerStat.THIEVING];
  assert(agilityDrained > 0 && thievingDrained > 0 && active(p), 'the real route earns both skill drains without exhausting fifty-level admission');
  withRolls([0, 0.99, 0], () => operation(p, location('roguesden_walldecor_mazesafe', 3013, 5047), 'Crack'));
  clean(p);
  assert.equal(count(p, 'roguesden_body'), 1, 'the original reward was earned at the end of the real route');
  assert.equal(p.stats[PlayerStat.AGILITY] - before[0], agilityDrained * 120);
  assert.equal(p.stats[PlayerStat.THIEVING] - before[1], thievingDrained * 120);
  assert(route.actions.some(row => row.kind === 'loc' && row.option === 'Search'), 'route includes genuine disarm actions');
  if (process.env.ROGUESDEN_ROUTE_TRACE) console.log(`ROGUESDEN_ROUTE ${JSON.stringify(route)}`);
  console.log(`PASS full original maze route: ${route.actions.length} native actions, drains ${agilityDrained}/${thievingDrained}, real safe reward and clean return`);
}
fullMazeRoute();
console.log('PASS Rogues Den packed contracts');
process.exit(0);
