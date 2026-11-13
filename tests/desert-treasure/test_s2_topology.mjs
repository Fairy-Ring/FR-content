import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// Run from the sibling engine after packing this content. This is a collision
// proof, not a simulated hunt: no actors, inventory, combat or state are mocked.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = path.resolve(root, '../engine');
const require = createRequire(path.join(engine, 'package.json'));
const { unzipSync } = require('fflate');
const eng = rel => import(pathToFileURL(path.join(engine, rel)).href);
await eng('src/engine/World.ts');
const LocType = (await eng('src/cache/config/LocType.ts')).default;
const { default: GameMap, isMapBlocked, isLineOfWalk } = await eng('src/engine/GameMap.ts');
const pack = path.join(engine, 'data/pack');
const constants = fs.readFileSync(path.join(root, 'scripts/quests/quest_deserttreasure/configs/dt_smoke.constant'), 'utf8');
const names = new Set(['m50_146', 'l50_146', 'm51_146', 'l51_146', 'm51_46', 'l51_46']);
const packed = unzipSync(fs.readFileSync(path.join(pack, '.cache/maps-server.zip')), { filter: entry => names.has(entry.name) });
LocType.load(pack);
assert.equal(LocType.getId('sword_haunted_well'), 6279);
assert.equal(LocType.getId('fd_firedungeon_shutchest'), 6420);
const map = new GameMap(true);
for (const [mx, mz] of [[50, 146], [51, 146], [51, 46]]) {
    const m = packed[`m${mx}_${mz}`];
    const l = packed[`l${mx}_${mz}`];
    assert.ok(m?.length && l?.length, `packed 377 mapsquare ${mx}_${mz}`);
    // TypeScript private is intentionally reached only in this test to reuse
    // the actual floor/bridge/loc collision decoder without loading NPC spawns.
    map.loadPackedMapsquare({ m, l, n: new Uint8Array(), o: new Uint8Array() }, mx * 64, mz * 64);
}
function tile(name) {
    const match = constants.match(new RegExp(`^\\^${name} = (\\d+)_(\\d+)_(\\d+)_(\\d+)_(\\d+)$`, 'm'));
    assert.ok(match, `named reconstruction coordinate ${name}`);
    const [, level, mx, mz, lx, lz] = match.map(Number);
    return { level, x: mx * 64 + lx, z: mz * 64 + lz };
}
const expected = {
    dt_smoke_arrival: [0, 3206, 9379],
    dt_smoke_surface: [0, 3310, 2961],
    dt_smoke_gate_inside: [0, 3306, 9375],
    dt_smoke_gate_outside: [0, 3304, 9375],
    dt_fareed_spawn: [0, 3309, 9376]
};
for (const [name, coordinates] of Object.entries(expected)) {
    const { level, x, z } = tile(name);
    assert.deepEqual([level, x, z], coordinates, `${name}: pinned candidate, not historical tile evidence`);
    assert.equal(isMapBlocked(x, z, level), false, `${name}: unblocked by actual packed floor and loc collision`);
    console.log(`PASS ${name}: ${level},${x},${z}, collision unblocked`);
}
const inside = tile('dt_smoke_gate_inside');
const spawn = tile('dt_fareed_spawn');
const roomSw = tile('dt_fareed_room_sw');
const roomNe = tile('dt_fareed_room_ne');
assert.deepEqual([roomSw.level, roomSw.x, roomSw.z], [0, 3305, 9373], 'candidate room includes the east-side doorway');
assert.deepEqual([roomNe.level, roomNe.x, roomNe.z], [0, 3311, 9379], 'candidate room keeps its other bounds');
for (const z of [9375, 9376]) {
    assert.equal(isMapBlocked(3305, z, 0), false, 'original gate east-side doorway floor is walkable');
    assert.equal(isLineOfWalk(0, inside.x, z, 3305, z), true, 'gate landing can walk to the doorway');
    assert.equal(isLineOfWalk(0, 3305, z, inside.x, z), true, 'doorway can walk back into the chamber');
    assert.equal(isLineOfWalk(0, 3305, z, 3304, z), false, 'original gate wall blocks doorway to outside');
    assert.equal(isLineOfWalk(0, 3304, z, 3305, z), false, 'original gate wall blocks outside to doorway');
    assert.equal(isLineOfWalk(0, 3305, z, spawn.x, spawn.z), true, 'doorway and Fareed share open chamber floor');
    assert.equal(isLineOfWalk(0, spawn.x, spawn.z, 3305, z), true, 'Fareed can approach the doorway');
}
assert.equal(isLineOfWalk(0, inside.x, inside.z, spawn.x, spawn.z), true, 'gate landing and owned Fareed share walkable chamber floor');
assert.equal(isLineOfWalk(0, 3206, 9379, 3206, 9378), true, 'rope landing has an open departure step');
assert.equal(isLineOfWalk(0, 3310, 2961, 3309, 2961), true, 'surface landing has an open departure step');
console.log('PASS: three original packed mapsquares, five pinned destinations, chamber/departure and both gate-doorway boundaries');
process.exit(0);
