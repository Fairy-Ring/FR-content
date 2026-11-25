import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(root, '../engine');
const eng = relative => import(pathToFileURL(path.join(engine, relative)).href);
const { unzipSync } = createRequire(path.join(engine, 'package.json'))('fflate');
const World = (await eng('src/engine/World.ts')).default;
const { isMapBlocked, isLineOfWalk } = await eng('src/engine/GameMap.ts');
const pack = path.join(engine, 'data/pack');
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'NpcType', 'ParamType', 'LocType', 'SeqType', 'InvType', 'ObjType', 'FontType', 'Component']) {
  (await eng(`src/cache/config/${name}.ts`)).default.load(pack);
}
const squares = [[45, 77], [44, 77], [43, 77], [50, 145], [50, 45]];
const names = new Set(squares.flatMap(([x, z]) => [`m${x}_${z}`, `l${x}_${z}`]));
const maps = unzipSync(fs.readFileSync(path.join(pack, '.cache/maps-server.zip')), { filter: entry => names.has(entry.name) });
for (const [x, z] of squares) {
  const m = maps[`m${x}_${z}`], l = maps[`l${x}_${z}`];
  assert(m?.length && l?.length, `packed map ${x}_${z}`);
  World.gameMap.loadPackedMapsquare({ m, l, n: new Uint8Array(), o: new Uint8Array() }, x * 64, z * 64);
}
const constants = fs.readFileSync(path.join(root, 'scripts/quests/quest_deserttreasure/configs/dt_pyramid.constant'), 'utf8');
function tile(name) {
  const match = constants.match(new RegExp(`^\\^${name} = (\\d+)_(\\d+)_(\\d+)_(\\d+)_(\\d+)$`, 'm'));
  assert(match, name);
  const [, level, mx, mz, x, z] = match.map(Number);
  return { level, x: mx * 64 + x, z: mz * 64 + z };
}
for (const [floor, goal] of [[1, [2909, 4963]], [2, [2845, 4973]], [3, [2784, 4940]], [4, [3234, 9325]]]) {
  const start = tile(`dt_pyramid_floor${floor}`), { level } = start;
  assert.equal(isMapBlocked(start.x, start.z, level), false, `floor ${floor} landing is walkable`);
  const queue = [start], seen = new Map([[`${start.x},${start.z}`, null]]);
  const [mx, mz] = [start.x >> 6, start.z >> 6];
  for (let head = 0; head < queue.length && !seen.has(goal.join(',')); head++) {
    const current = queue[head];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = current.x + dx, z = current.z + dz, key = `${x},${z}`;
      if ((x >> 6) !== mx || (z >> 6) !== mz || seen.has(key) || !isLineOfWalk(level, current.x, current.z, x, z)) continue;
      seen.set(key, `${current.x},${current.z}`); queue.push({ x, z, level });
    }
  }
  assert(seen.has(goal.join(',')), `floor ${floor} landing connects to the next mapped ladder/door`);
  let cursor = goal.join(','), steps = 0;
  while (seen.get(cursor) !== null) { cursor = seen.get(cursor); steps++; }
  assert(steps > 5, `floor ${floor} requires a real corridor traversal`);
  console.log(`PASS packed pyramid floor ${floor}: landing=${JSON.stringify(start)} goal=${goal} routeSteps=${steps}`);
}
for (const name of ['dt_pyramid_up1', 'dt_pyramid_up2', 'dt_pyramid_up3', 'dt_pyramid_surface', 'dt_pyramid_fall_exit']) {
  const p = tile(name);
  assert.equal(isMapBlocked(p.x, p.z, p.level), false, `${name} walkable outside arrival`);
}
process.exit(0);
