import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
process.env.NODE_MEMBERS = 'true';
const { World, map, CollisionType, types } = await import('../stair-links/runtime.mjs');
const load = async relative => (await import(pathToFileURL(path.join(engine, 'src', relative)).href)).default;
const Player = await load('engine/entity/Player.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const OpLocHandler = await load('network/game/client/handler/OpLocHandler.ts');
const OpLoc = await load('network/game/client/model/OpLoc.ts');
const { CoordGrid } = await import(pathToFileURL(path.join(engine, 'src/engine/CoordGrid.ts')).href);
const floors = new Set(), placements = [], spawns = [];
for (const [mx, mz] of [[46, 49], [47, 49], [46, 149], [47, 149]]) {
  let section = '';
  for (const line of readFileSync(path.join(content, `maps/m${mx}_${mz}.jm2`), 'utf8').split('\n')) {
    if (line.startsWith('====')) { section = line.split(' ')[1]; continue; }
    const match = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
    if (!match) continue;
    const at = [Number(match[1]), mx * 64 + Number(match[2]), mz * 64 + Number(match[3])];
    if (section === 'MAP' && /(?:^| )(?:u\d+|o-?\d+)(?:[; ]|$)/.test(match[4])) floors.add(at.join(','));
    if (section === 'LOC') {
      const [id, shape = 10, angle = 0] = match[4].split(' ').map(Number);
      placements.push({ at, id, shape, angle });
    }
    if (section === 'NPC') spawns.push({ at, id: Number(match[4]) });
  }
}
function placement(name, at) {
  const id = types.LocType.getId(name);
  assert.ok(id >= 0, `packed type ${name}`);
  const rows = placements.filter(row => row.id === id && (!at || row.at.join(',') === at.join(',')));
  assert.equal(rows.length, 1, `one native placement for ${name}`);
  const row = { ...rows[0], name, type: types.LocType.get(id) };
  row.loc = World.getLoc(row.at[1], row.at[2], row.at[0], id);
  assert.ok(row.loc, `${name} is loaded from the packed map`);
  assert.deepEqual([row.loc.shape, row.loc.angle], [row.shape, row.angle], `${name} packed shape and rotation`);
  return row;
}
const entrance = placement('wyvern_snow_cave_entrance');
const exit = placement('wyvern_snow_cave_exit');
assert.deepEqual(entrance.at, [0, 3055, 9560], 'entrance is in the ice dungeon, not on the surface');
assert.deepEqual(exit.at, [0, 3055, 9556], 'exit is in the same map, south of the entrance');
assert.deepEqual([exit.angle, entrance.angle], [0, 2], 'paired mouths face south and north respectively');
for (const row of [entrance, exit]) assert.deepEqual([row.type.width, row.type.length], [3, 2], `${row.name} original footprint`);
// UNKNOWN engineering landing choices: centre of the first tile row in front of
// the opposite mouth. Geometry comes from the map, not from the product constants.
function front(row) {
  assert.ok(row.angle === 0 || row.angle === 2, 'these original mouths face north/south');
  return [row.at[0], row.at[1] + Math.floor(row.type.width / 2), row.at[2] + (row.angle === 0 ? -1 : row.type.length)];
}
const entryLanding = front(exit), exitLanding = front(entrance);
const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
function open(at) {
  assert.ok(floors.has(at.join(',')), `original floor at ${at}`);
  assert.equal(map.isMapBlocked(at[1], at[2], at[0]), false, `packed collision allows standing at ${at}`);
}
function flood(start) {
  const pending = [start], seen = new Set([start.join(',')]);
  for (let i = 0; i < pending.length; i++) {
    const [level, x, z] = pending[i];
    for (const [dx, dz] of directions) {
      const next = [level, x + dx, z + dz], key = next.join(',');
      if (seen.has(key) || !floors.has(key) || !map.canTravel(level, x, z, dx, dz, 1, 0, CollisionType.NORMAL)) continue;
      seen.add(key); pending.push(next);
    }
  }
  return pending;
}
const reaches = (at, row) => map.reachedLoc(at[0], at[1], at[2], row.at[1], row.at[2], row.type.width, row.type.length, 1, row.angle, row.shape, row.type.forceapproach);
let serial = 0;
function playerAt(at) {
  const p = new Player(`wyvroute${++serial}`, BigInt(serial), BigInt(serial));
  p.slot = serial; p.pid = serial; p.uid = serial; p.vars.fill(0);
  [p.level, p.x, p.z] = at;
  // No Slayer requirement for either cave operation.
  p.baseLevels[18] = 0; p.levels[18] = 0;
  return p;
}
function operate(player, row) {
  player.originX = player.x; player.originZ = player.z;
  assert.equal(new OpLocHandler().handle(new OpLoc(1, row.at[1], row.at[2], row.id), player), true, `${row.name} accepts the real client operation`);
  assert.equal(player.target, row.loc, 'operation targets the real packed loc');
  const script = player.getOpTrigger();
  assert.ok(script, `${row.name} resolves a packed OP trigger`);
  const state = ScriptRunner.init(script, player, row.loc);
  let result = player.runScript(state, true, true);
  for (let boundary = 0; result === ScriptState.SUSPENDED && boundary < 12; boundary++) {
    World.currentTick = Math.max(World.currentTick + 1, player.delayedUntil);
    player.delayed = false;
    result = player.runScript(state, true, true);
  }
  assert.equal(result, ScriptState.FINISHED, `${row.name} operation finishes`);
  return [player.level, player.x, player.z];
}
for (const [source, destination, landing] of [[entrance, exit, entryLanding], [exit, entrance, exitLanding]]) {
  const start = front(source);
  open(start);
  assert.ok(reaches(start, source), `${source.name} is operable from its front tile`);
  const player = playerAt(start), actual = operate(player, source);
  // This assertion rejects the original blocked destination and a mutant restoring it.
  open(actual);
  assert.deepEqual(actual, landing, `${source.name} lands in front of the opposite mouth`);
  assert.ok(reaches(actual, destination), 'the reverse mouth is immediately operable');
  const facing = [actual[1], actual[2] + (destination.angle === 0 ? 1 : -1)];
  assert.deepEqual([player.faceSquareX, player.faceSquareZ], facing.map(value => CoordGrid.fine(value, 1)), 'player faces the opposite mouth');
  const step = [actual[0], actual[1], actual[2] + (destination.angle === 0 ? -1 : 1)];
  open(step);
  assert.ok(map.canTravel(actual[0], actual[1], actual[2], 0, step[2] - actual[2], 1, 0, CollisionType.NORMAL), 'player can walk one step away from the landing');
}
const inside = flood(entryLanding), outside = flood(exitLanding);
const wyvernIds = new Set(['skeletal_wyvern1', 'skeletal_wyvern2', 'skeletal_wyvern3', 'skeletal_wyvern4'].map(name => types.NpcType.getId(name)));
const wyverns = spawns.filter(npc => wyvernIds.has(npc.id));
assert.ok(wyverns.length > 0, 'original map contains wyverns');
for (const npc of wyverns) {
  const size = types.NpcType.get(npc.id).size;
  assert.ok(inside.some(at => map.reachedEntity(at[0], at[1], at[2], npc.at[1], npc.at[2], size, size, 1)), `landing reaches mapped wyvern ${npc.id} at ${npc.at}`);
}
assert.ok(inside.some(at => reaches(at, exit)), 'inside component reaches its exit');
const ladder = placement('ladder_1755', [0, 3008, 9550]);
const ladderApproach = outside.find(at => reaches(at, ladder));
assert.ok(ladderApproach, 'outside component reaches the ordinary surface ladder');
const surface = operate(playerAt(ladderApproach), ladder);
open(surface);
assert.ok(surface[2] < 6400, 'ordinary ladder returns to the surface, not to another cave');
assert.ok(flood(surface).some(at => Math.abs(at[1] - surface[1]) + Math.abs(at[2] - surface[2]) >= 10), 'surface arrival reaches open ground');
console.log(`PASS wyvern traversal: paired native operations, open landings, ${inside.length}/${outside.length} reachable tiles, all ${wyverns.length} mapped wyverns, surface ladder and open ground`);
process.exit(0);
