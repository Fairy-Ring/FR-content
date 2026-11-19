/** Run from the sibling engine after its full content build. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { content, World, map, CollisionType, types, locFor, reachable } from '../stair-links/runtime.mjs';

const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const load = async rel => (await import(pathToFileURL(path.join(engine, 'src', rel)).href)).default;
const Player = await load('engine/entity/Player.ts');
const JavaRandom = await load('util/JavaRandom.ts');
const { PlayerStatMap } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const OpLocHandler = await load('network/game/client/handler/OpLocHandler.ts');
const OpLoc = await load('network/game/client/model/OpLoc.ts');
const links = JSON.parse(readFileSync(new URL('./vertical-placements.json', import.meta.url), 'utf8'));
const source = readFileSync(path.join(content, 'scripts/ladders+stairs/scripts/ordinary_377.rs2'), 'utf8');
const boundNames = new Set([...source.matchAll(/^\[oploc[1-5],([^\]]+)\]/gm)].map(m => m[1]));
const packNames = new Map(readFileSync(path.join(content, 'pack/loc.pack'), 'utf8').trim().split('\n').map(line => {
  const split = line.indexOf('='); return [Number(line.slice(0, split)), line.slice(split + 1)];
}));
const floors = new Set();
const native = [];
const hamNative = [];
const nativeDoors = [];
const key = r => `${r.name}@${r.level},${r.x},${r.z}`;
for (const name of readdirSync(path.join(content, 'maps')).filter(n => /^m\d+_\d+\.jm2$/.test(n))) {
  const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(name).map(Number);
  let section = '';
  for (const line of readFileSync(path.join(content, 'maps', name), 'utf8').split('\n')) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    const match = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
    if (!match) continue;
    const [level, x, z] = [Number(match[1]), mx * 64 + Number(match[2]), mz * 64 + Number(match[3])];
    if (section === 'MAP' && /(?:^| )(?:u\d+|o-?\d+)(?:[; ]|$)/.test(match[4])) floors.add(`${level},${x},${z}`);
    if (section !== 'LOC') continue;
    const [id, shape = 10, angle = 0] = match[4].split(' ').map(Number);
    if (boundNames.has(packNames.get(id))) native.push({ name: packNames.get(id), level, x, z, shape, angle });
    if (['ham_multi_trapdoor', 'osf_ham_ladder'].includes(packNames.get(id))) hamNative.push({ name: packNames.get(id), level, x, z, shape, angle });
    if (packNames.get(id) === 'wild_door') nativeDoors.push({ name: packNames.get(id), level, x, z, shape, angle });
  }
}
assert.deepEqual([...new Set(links.map(key))].sort(), native.map(key).sort(), 'every native placement of every bound ordinary loc is inventoried');
assert.equal(new Set(links.map(r => `${key(r)}:${r.direction}`)).size, links.length, 'one expectation per placement and direction');
for (const row of links) {
  const original = native.find(n => key(n) === key(row));
  assert.deepEqual([row.shape, row.angle], [original.shape, original.angle], `${key(row)} keeps original geometry`);
}

let serial = 0;
function playerAt(start) {
  const id = ++serial;
  const p = new Player(`ordinary_${id}`, BigInt(id), BigInt(id));
  p.slot = id; p.pid = id; p.uid = BigInt(id);
  p.vars.fill(0);
  [p.level, p.x, p.z] = start;
  return p;
}
function executeNative(p, row, slot, choice = null, phase = 'OP') {
  const loc = locFor(row);
  p.originX = p.x; p.originZ = p.z;
  assert.equal(new OpLocHandler().handle(new OpLoc(slot, row.x, row.z, loc.type), p), true, `${key(row)}: production client operation accepted`);
  assert.equal(p.target, loc, `${key(row)}: production handler targets the original packed loc`);
  const script = phase === 'AP' ? p.getApTrigger() : p.getOpTrigger();
  assert.ok(script, `${key(row)}: production ${phase} dispatch resolves slot ${slot}`);
  const state = ScriptRunner.init(script, p, loc);
  let result = p.runScript(state, true, true);
  let pauses = 0;
  for (let boundary = 0; result !== ScriptState.FINISHED && boundary < 12; boundary++) {
    if (result === ScriptState.SUSPENDED) {
      World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil);
      p.delayed = false;
    } else if (result === ScriptState.PAUSEBUTTON) {
      assert.equal(p.modalChat, types.Component.getId('multi2'), 'only the published two-way ladder menu may pause');
      assert.ok(choice === 1 || choice === 2, 'a real offered ladder choice is required');
      const component = types.Component.getId(`multi2:com_${choice}`);
      assert.ok(p.resumeButtons.includes(component), 'the chosen component is actually offered');
      p.lastCom = component;
      pauses++;
    } else assert.fail(`${key(row)}: unexpected interpreter boundary ${result}`);
    result = p.runScript(state, true, true);
  }
  assert.equal(result, ScriptState.FINISHED, `${key(row)}: operation finishes`);
  return { destination: [p.level, p.x, p.z], pauses };
}
function walkable(at) {
  assert.ok(floors.has(at.join(',')), `original map floor at ${at}`);
  assert.equal(map.isMapBlocked(at[1], at[2], at[0]), false, `original packed collision allows standing at ${at}`);
}
function routeEnd(start, accepts, radius = 10) {
  const pending = [start];
  const seen = new Set([start.join(',')]);
  for (let i = 0; i < pending.length; i++) {
    const at = pending[i];
    if (accepts(at)) return at;
    for (const [dx, dz] of [[-1, 0], [0, -1], [1, 0], [0, 1]]) {
      const next = [at[0], at[1] + dx, at[2] + dz];
      if (Math.max(Math.abs(next[1] - start[1]), Math.abs(next[2] - start[2])) > radius || seen.has(next.join(',')) || !floors.has(next.join(','))) continue;
      if (!map.canTravel(at[0], at[1], at[2], dx, dz, 1, 0, CollisionType.NORMAL)) continue;
      seen.add(next.join(',')); pending.push(next);
    }
  }
  return null;
}
function returnApproach(at, row) {
  if (row.name === 'ladder_11741' && row.level === 1 && row.x === 2946 && row.z === 3363) {
    return at[0] === 1 && at[1] === 2947 && at[2] === 3363;
  }
  return reachable(at, row);
}
const openedName = new Map([
  ['vampire_trap1', 'vampire_trap2'],
]);
let directions = 0;
let menus = 0;
let returns = 0;
for (const row of links) {
  walkable(row.start);
  const specialApproach = row.name === 'ladder_11741' && row.level === 1 && row.x === 2946 && row.z === 3363;
  if (specialApproach) {
    assert.equal(reachable(row.start, row), false, 'the original Falador reach check rejects its eastern floor');
    assert.equal(reachable([row.level, row.x, row.z], row), true, 'the original reach check accepts the loc square');
    assert.equal(map.isMapBlocked(row.x, row.z, row.level), true, 'that accepted loc square is blocked');
    for (const [dx, dz] of [[-1, 0], [0, -1], [1, 0], [0, 1]]) {
      assert.equal(reachable([row.level, row.x + dx, row.z + dz], row), false, 'the original reach check rejects every adjacent approach');
    }
  } else assert.ok(reachable(row.start, row), `${key(row)}: source is a reachable native approach`);
  const isTrap = openedName.has(row.name);
  const operations = row.name === 'wild_ladder_middle'
    ? [[1, row.direction === 'up' ? 1 : 2], [row.direction === 'up' ? 2 : 3, null]]
    : [[1, null]];
  for (const [slot, choice] of operations) {
    const p = playerAt(row.start);
    let visible = row;
    if (isTrap) {
      executeNative(p, row, 1);
      visible = { ...row, name: openedName.get(row.name) };
      locFor(visible);
    }
    const result = executeNative(p, visible, slot, choice, specialApproach ? 'AP' : 'OP');
    assert.deepEqual(result.destination, row.destination, `${key(row)}: ${row.direction} destination`);
    assert.equal(result.pauses, choice === null ? 0 : 1, 'menu is offered only by the original Climb option');
    walkable(result.destination);
    directions++; menus += result.pauses;
    if (row.target) {
      const targetAt = routeEnd(result.destination, at => returnApproach(at, row.target));
      assert.ok(targetAt, `${key(row)}: player can walk from landing to its native return partner`);
      const reverse = links.find(r => key(r) === key(row.target) && r.direction !== row.direction)
        ?? (row.target.name === 'ladder_1755' ? { ...row.target, direction: 'up' } : null);
      if (reverse && !openedName.has(reverse.name)) {
        [p.level, p.x, p.z] = targetAt;
        const ap = reverse.name === 'ladder_11741' && reverse.x === 2946 && reverse.z === 3363;
        const back = executeNative(p, reverse, reverse.name === 'wild_ladder_middle' ? (reverse.direction === 'up' ? 2 : 3) : 1, null, ap ? 'AP' : 'OP');
        walkable(back.destination);
        assert.ok(routeEnd(back.destination, at => returnApproach(at, row)), `${key(row)}: return reaches the starting approach`);
        returns++;
      }
    } else {
      assert.equal(row.label, 'UNKNOWN');
      const alternatives = links.filter(r => r.name === 'wild_ladder' && r.direction === 'up');
      const findAscent = start => alternatives.map(r => ({ row: r, at: routeEnd(start, at => reachable(at, r), 40) })).find(r => r.at);
      let alternate = findAscent(result.destination);
      const pendingDoors = nativeDoors.filter(r => r.level === row.level - 1
        && Math.max(Math.abs(r.x - row.x), Math.abs(r.z - row.z)) <= 40
        && World.getLoc(r.x, r.z, r.level, types.LocType.getId(r.name)));
      const opened = [];
      while (!alternate && pendingDoors.length) {
        const start = [p.level, p.x, p.z];
        const next = pendingDoors.map(door => ({ door, at: routeEnd(start, at => reachable(at, door), 40) })).find(r => r.at);
        if (!next) break;
        pendingDoors.splice(pendingDoors.indexOf(next.door), 1);
        [p.level, p.x, p.z] = next.at;
        executeNative(p, next.door, 1);
        opened.push(key(next.door));
        alternate = findAscent([p.level, p.x, p.z]);
      }
      assert.ok(alternate, 'the corner without a ground ladder can open reachable native doors and walk to another original ascent');
      [p.level, p.x, p.z] = alternate.at;
      const back = executeNative(p, alternate.row, 1);
      assert.deepEqual(back.destination, alternate.row.destination, 'the alternate original ascent actually returns upstairs');
      walkable(back.destination);
      returns++;
      console.log(`UNKNOWN northwest descent returns through ${key(alternate.row)}; native doors opened: ${opened.join(', ') || 'already open'}`);
    }
  }
}
assert.equal(directions, 87, 'all original direct and menu ladder directions are executed');
assert.equal(menus, 16, 'both choices of each original middle-ladder menu are executed');
console.log(`RESULT PASS ordinary vertical: ${links.length} mapped directions, ${directions} native operations, ${menus} menu choices, ${returns} collision-checked returns`);
assert.equal(hamNative.length, 2, 'both HAM locs have exactly one original native placement');
const hamRoot = hamNative.find(r => r.name === 'ham_multi_trapdoor');
const hamLadder = hamNative.find(r => r.name === 'osf_ham_ladder');
assert.deepEqual([hamRoot.level, hamRoot.x, hamRoot.z], [0, 3166, 3252]);
assert.deepEqual([hamLadder.level, hamLadder.x, hamLadder.z], [0, 3149, 9653]);
const hamBit = types.VarBitType.getId('ham_thief');
assert.equal(types.LocType.get(types.LocType.getId(hamRoot.name)).multivarbit, hamBit, 'the original multiloc reads the original HAM varbit');
const thieving = PlayerStatMap.get('THIEVING');
assert.ok(Number.isInteger(thieving));
const inv = types.InvType.getId('inv'), lockpick = types.ObjType.getId('lockpick');
assert.ok(inv >= 0 && lockpick >= 0);
function hamPlayer(level, hasLockpick) {
  const p = playerAt([0, 3165, 3252]);
  p.setLevel(thieving, level);
  if (hasLockpick) p.getInventory(inv).add(lockpick, 1);
  assert.equal(p.getVarBit(hamBit), 0, 'no state under test is seeded');
  return p;
}
function seedForDraw(draw, failureReward) {
  // Select the fixture through the real native RNG; no opcode or product stub.
  for (let seed = 0; seed < 100000; seed++) {
    JavaRandom.setSeed(seed);
    if (Math.floor(JavaRandom.nextDouble() * 256) !== draw) continue;
    if (failureReward !== null && Math.floor(JavaRandom.nextDouble() * 2) !== failureReward) continue;
    JavaRandom.setSeed(seed);
    return;
  }
  assert.fail(`no bounded native RNG fixture for draw ${draw}, reward ${failureReward}`);
}
let hamAttempts = 0, hamRoundTrips = 0;
for (const [level, hasLockpick, threshold] of [[1, false, 11], [99, false, 251], [1, true, 61], [99, true, 255]]) {
  for (const [draw, reward, succeeds] of [[threshold - 1, null, true], [threshold, 0, false], [threshold, 1, false]]) {
    const p = hamPlayer(level, hasLockpick);
    const before = p.stats[thieving];
    seedForDraw(draw, reward);
    executeNative(p, hamRoot, 5);
    assert.equal(p.getVarBit(hamBit), succeeds ? 1 : 0, 'actual visible-form picklock dispatch writes only successful opening');
    assert.equal(p.levels[thieving], succeeds ? level : level - 1, 'each failed attempt drains one current Thieving level');
    assert.equal(p.stats[thieving] - before, succeeds ? 40 : reward === 0 ? 10 : 0, 'success and both occasional-failure XP outcomes use tenths of XP');
    assert.equal(p.getInventory(inv).getItemCount(lockpick), hasLockpick ? 1 : 0, 'lockpick is a chance aid, not a consumed key');
    hamAttempts++;
    if (succeeds) {
      executeNative(p, hamRoot, 1);
      const bottom = [p.level, p.x, p.z];
      assert.deepEqual(bottom, [0, 3148, 9653], 'the player-written open form dispatches descent');
      walkable(bottom);
      assert.ok(routeEnd(bottom, at => reachable(at, hamLadder)), 'the hideout landing reaches its original ladder');
      executeNative(p, hamLadder, 1);
      const top = [p.level, p.x, p.z];
      assert.deepEqual(top, [0, 3165, 3252], 'the original ladder returns to the surface entrance');
      walkable(top);
      assert.ok(reachable(top, hamRoot));
      executeNative(p, hamRoot, 2);
      assert.equal(p.getVarBit(hamBit), 0, 'the visible open form closes through its own native operation');
      assert.equal(p.stats[thieving] - before, 40, 'traversal and closing do not farm picklock XP');
      hamRoundTrips++;
    }
  }
}
assert.equal(hamAttempts, 12);
assert.equal(hamRoundTrips, 4);
console.log(`RESULT PASS HAM entrance: ${hamAttempts} seeded native-RNG boundary attempts, ${hamRoundTrips} player-produced open/descent/return/close round trips`);
process.exit(0);
