import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
export const pack = path.join(engine, 'data/pack');
process.chdir(engine);

const load = async rel => (await import(pathToFileURL(path.join(engine, 'src', rel)).href)).default;
export const World = await load('engine/World.ts');
export const Player = await load('engine/entity/Player.ts');
export const Npc = await load('engine/entity/Npc.ts');
export const ScriptProvider = await load('engine/script/ScriptProvider.ts');
export const ScriptRunner = await load('engine/script/ScriptRunner.ts');
export const ScriptState = await load('engine/script/ScriptState.ts');
export const ServerTriggerType = await load('engine/script/ServerTriggerType.ts');
export const ResumePauseButtonHandler = await load('network/game/client/handler/ResumePauseButtonHandler.ts');
export const ResumePauseButton = await load('network/game/client/model/ResumePauseButton.ts');
export const InvButtonHandler = await load('network/game/client/handler/InvButtonHandler.ts');
export const InvButton = await load('network/game/client/model/InvButton.ts');
export const IfSetText = await load('network/game/server/model/IfSetText.ts');
export const MessageGame = await load('network/game/server/model/MessageGame.ts');
export const { EntityLifeCycle } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/EntityLifeCycle.ts')).href);
export const { BlockWalk } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/BlockWalk.ts')).href);
export const { PlayerStatMap } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/PlayerStat.ts')).href);
export const map = await import(pathToFileURL(path.join(engine, 'src/engine/GameMap.ts')).href);

export const types = {};
for (const name of [
  'VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType',
  'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType',
  'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType'
]) {
  types[name] = await load(`cache/config/${name}.ts`);
  types[name].load(pack);
}
(await load('cache/config/DbTableIndex.ts')).init();
assert.ok(ScriptProvider.load(pack) > 0, 'a complete packed world is required');
World.currentTick = 100;
World.gameMap.init();

function readNameTable(kind) {
  const lines = readFileSync(path.join(content, 'pack', `${kind}.pack`), 'utf8').trim().split(/\r?\n/);
  return new Map(lines.map(line => {
    const split = line.indexOf('=');
    return [Number(line.slice(0, split)), line.slice(split + 1)];
  }));
}

const locNames = readNameTable('loc');
const npcNames = readNameTable('npc');
const locRows = [];
const npcRows = [];
export const floorTiles = new Set();
const mapFiles = readdirSync(path.join(content, 'maps')).filter(name => /^m\d+_\d+\.jm2$/.test(name)).sort();

for (const file of mapFiles) {
  const [, mx, mz] = /^m(\d+)_(\d+)\.jm2$/.exec(file).map(Number);
  const groundFlags = new Map();
  let section = '';
  for (const line of readFileSync(path.join(content, 'maps', file), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('====')) {
      section = line.split(/\s+/)[1];
      continue;
    }
    const match = /^([0-3]) (\d+) (\d+): (.*)$/.exec(line);
    if (!match) continue;
    const level = Number(match[1]);
    const localX = Number(match[2]);
    const localZ = Number(match[3]);
    const x = mx * 64 + localX;
    const z = mz * 64 + localZ;
    const fields = match[4].trim().split(/\s+/);
    if (section === 'MAP') {
      const flags = /(?:^| )f(\d+)(?: |$)/.exec(match[4]);
      groundFlags.set(`${level},${localX},${localZ}`, flags ? Number(flags[1]) : 0);
      if (/(?:^| )(?:u\d+|o-?\d+)(?:[; ]|$)/.test(match[4])) floorTiles.add(`${level},${x},${z}`);
      continue;
    }
    const id = Number(fields[0]);
    if (!Number.isInteger(id)) continue;
    const coord = `${level}_${mx}_${mz}_${localX}_${localZ}`;
    if (section === 'LOC') {
      // GameMap.loadLocations applies LINK_BELOW from the level-one ground tile.
      const bridged = ((groundFlags.get(`1,${localX},${localZ}`) ?? 0) & 2) !== 0;
      const actualLevel = bridged ? level - 1 : level;
      if (actualLevel < 0) continue;
      locRows.push({
        name: locNames.get(id), id, sourceLevel: level, level: actualLevel, x, z, localX, localZ, mx, mz, coord,
        shape: Number(fields[1] ?? 10), angle: Number(fields[2] ?? 0)
      });
    } else if (section === 'NPC') {
      npcRows.push({ name: npcNames.get(id), id, level, x, z, localX, localZ, mx, mz, coord });
    }
  }
}

export const sourceMapCount = mapFiles.length;
export const nativeLocRows = name => locRows.filter(row => row.name === name);
export const nativeNpcRows = name => npcRows.filter(row => row.name === name);
export const nativeLocInventory = () => locRows;

export function requiredId(Type, name) {
  const id = Type.getId(name);
  assert.ok(Number.isInteger(id) && id >= 0, `missing packed ${Type.name ?? 'config'} ${name}`);
  return id;
}

export function packed(name) {
  const script = ScriptProvider.getByName(name);
  assert.ok(script, `missing packed script ${name}`);
  return script;
}

export function locFor(row) {
  const id = requiredId(types.LocType, row.name);
  const loc = World.getLoc(row.x, row.z, row.level, id);
  assert.ok(loc, `native packed placement missing: ${row.name} ${row.coord}`);
  assert.equal(loc.shape, row.shape, `${row.name} packed shape agrees with its native map placement`);
  assert.equal(loc.angle, row.angle, `${row.name} packed rotation agrees with its native map placement`);
  return loc;
}

export function tileOf(entity) {
  return [entity.level, entity.x, entity.z];
}

export function tileFromCoord(coord) {
  const [level, mx, mz, localX, localZ] = coord.split('_').map(Number);
  return [level, mx * 64 + localX, mz * 64 + localZ];
}

export function reachable(start, row) {
  const type = types.LocType.get(requiredId(types.LocType, row.name));
  return start[0] === row.level && map.reachedLoc(
    start[0], start[1], start[2], row.x, row.z, type.width, type.length, 1,
    row.angle, row.shape, type.forceapproach
  );
}

export function walkable(tile, label) {
  assert.ok(floorTiles.has(tile.join(',')), `${label}: destination has a 377 map floor`);
  assert.equal(map.isMapBlocked(tile[1], tile[2], tile[0]), false, `${label}: packed-map collision leaves the tile walkable`);
}
