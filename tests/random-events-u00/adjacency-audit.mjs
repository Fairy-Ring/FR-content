// Extend the reviewer's whole-map differential audit with NPC and chest coverage.
// Run the real packed selectors against the engine's actual operate-reach test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Player, ScriptRunner, ScriptState, World, content, map, nativeLocInventory, packed, requiredId, types } from '../regicide-travel/runtime.mjs';
const tableNames = (file, column) => new Set(readFileSync(path.join(content, file), 'utf8').split(/\r?\n/).filter(l => l.startsWith(`data=${column},`)).map(l => l.slice(`data=${column},`.length).trim()));
const inv = requiredId(types.InvType, 'inv');
const empty = requiredId(types.ParamType, 'mining_rock_empty');
const gas = requiredId(types.CategoryType, 'mining_rock_macro_gas');
const rocks = tableNames('scripts/skill_mining/configs/mine.dbrow', 'rock');
const trees = tableNames('scripts/skill_woodcutting/configs/trees.dbrow', 'tree');
const chests = tableNames('scripts/skill_thieving/configs/chests/trapped_chest.dbrow', 'loc');
chests.delete('chest_steel_arrowtips');
const pickpockets = tableNames('scripts/skill_thieving/configs/pickpocking/pickpocket.dbrow', 'npc');
const salt = requiredId(types.CategoryType, 'saltfish');
function player(tile, tool) {
  const p = new Player('reach_audit', 1900n, 0n);
  p.slot = 1900; p.pid = 1900; p.uid = 1900;
  p.vars.fill(0); p.baseLevels.fill(99); p.levels.fill(99);
  [p.level, p.x, p.z] = tile;
  p.buildArea.originX = Math.floor(p.x / 8) * 8;
  p.buildArea.originZ = Math.floor(p.z / 8) * 8;
  World.players[p.slot] = p;
  if (tool) p.invAdd(inv, requiredId(types.ObjType, tool), 1);
  return p;
}
function select(tile, proc, args, tool) {
  const p = player(tile, tool);
  const s = ScriptRunner.init(packed(`[proc,${proc}]`), p, null, args);
  ScriptRunner.execute(s);
  World.players[p.slot] = null;
  assert.equal(s.execution, ScriptState.FINISHED);
  return s.intStack.slice(s.isp - 2, s.isp);
}
function audit(label, rows, selectTarget, reaches) {
  const tiles = new Map();
  for (const row of rows) for (let x = row.x - 1; x <= row.x + row.w; x++) for (let z = row.z - 1; z <= row.z + row.l; z++) {
    if (x >= row.x && x < row.x + row.w && z >= row.z && z < row.z + row.l) continue;
    if (map.isMapBlocked(x, z, row.level)) continue;
    const key = `${row.level},${x},${z}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(row);
  }
  const out = { label, placements: rows.length, tiles: tiles.size, dimensions: [...new Set(rows.map(r => `${r.w}x${r.l}`))].sort(), admittedUnreachable: 0, refusedReachable: 0, admittedReachable: 0, refusedUnreachable: 0, examples: [] };
  for (const [key, candidates] of tiles) {
    const tile = key.split(',').map(Number);
    const selected = selectTarget(tile);
    const any = candidates.some(r => reaches(tile, r));
    if (selected && reaches(tile, selected)) out.admittedReachable++;
    else if (selected) {
      out.admittedUnreachable++;
      if (out.examples.length < 8) out.examples.push({ kind: 'admitted-unreachable', tile, selected });
    } else if (any) {
      out.refusedReachable++;
      if (out.examples.length < 8) out.examples.push({ kind: 'refused-reachable', tile, candidates: candidates.filter(r => reaches(tile, r)).slice(0, 2) });
    } else out.refusedUnreachable++;
  }
  return out;
}
function locAudit(label, names, kind, event, tool) {
  const rows = nativeLocInventory().filter(r => names.has(r.name) && World.getLoc(r.x, r.z, r.level, r.id)).filter(r => {
    const t = types.LocType.get(r.id);
    return kind !== 0 || (t.category !== gas && t.params?.get(empty) !== 1);
  }).map(r => {
    const t = types.LocType.get(r.id);
    return { ...r, w: r.angle & 1 ? t.length : t.width, l: r.angle & 1 ? t.width : t.length };
  });
  const byKey = new Map(rows.map(r => [`${r.level},${r.x},${r.z},${r.id}`, r]));
  return audit(label, rows, tile => {
    const [coord, id] = select(tile, 'macro_fixture_loc', [kind, event], tool);
    if (id === -1) return null;
    const found = byKey.get(`${coord >>> 28},${(coord >>> 14) & 0x3fff},${coord & 0x3fff},${id}`);
    assert(found, `selector returned an unlisted ${label} target`);
    return found;
  }, (tile, r) => {
    const t = types.LocType.get(r.id);
    return tile[0] === r.level && map.reachedLoc(tile[0], tile[1], tile[2], r.x, r.z, t.width, t.length, 1, r.angle, r.shape, t.forceapproach);
  });
}
const results = [locAudit('rocks', rocks, 0, 7, 'bronze_pickaxe'), locAudit('trees', trees, 1, 10, 'bronze_axe'), locAudit('chests', chests, 2, 19)];
for (const [label, event] of [['saltfish', 13], ['pickpockets', 18]]) {
  const npcs = [...World.npcs].filter(n => event === 13 ? types.NpcType.get(n.type).category === salt : pickpockets.has(types.NpcType.get(n.type).debugname));
  const rows = npcs.map(n => ({ uid: n.uid, type: n.type, level: n.level, x: n.x, z: n.z, w: n.width, l: n.length }));
  const byUid = new Map(rows.map(r => [r.uid >>> 0, r]));
  results.push(audit(label, rows, tile => {
    const [uid] = select(tile, 'macro_fixture_npc', [event], event === 13 ? 'net' : null);
    if (uid === -1) return null;
    const row = byUid.get(uid >>> 0);
    assert(row, `selector returned an unlisted ${label} target`);
    return row;
  }, (tile, r) => tile[0] === r.level && map.reachedEntity(tile[0], tile[1], tile[2], r.x, r.z, r.w, r.l, 1)));
}
console.log(JSON.stringify(results, null, 2));
const failures = results.reduce((n, r) => n + r.admittedUnreachable, 0);
console.log(`RESULT ${failures ? 'FAIL' : 'PASS'} whole-map classes=${results.length} unsafe-admits=${failures}`);
process.exit(failures ? 1 : 0);
