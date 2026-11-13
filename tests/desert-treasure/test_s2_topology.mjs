import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// Run from the sibling engine after packing this content. Every collision and
// S2 decision below comes from the packed 377 map and compiled server scripts.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = path.resolve(root, '../engine');
const require = createRequire(path.join(engine, 'package.json'));
const { unzipSync } = require('fflate');
const eng = rel => import(pathToFileURL(path.join(engine, rel)).href);
const World = (await eng('src/engine/World.ts')).default;
const ScriptProvider = (await eng('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await eng('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await eng('src/engine/script/ScriptState.ts')).default;
const Player = (await eng('src/engine/entity/Player.ts')).default;
const { CoordGrid } = await eng('src/engine/CoordGrid.ts');
const { isMapBlocked, isLineOfWalk } = await eng('src/engine/GameMap.ts');
const pack = path.join(engine, 'data/pack');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'NpcType', 'ParamType', 'LocType', 'SeqType', 'InvType', 'ObjType', 'FontType', 'Component']) {
    types[name] = (await eng(`src/cache/config/${name}.ts`)).default;
    types[name].load(pack);
}
assert.equal(types.LocType.getId('sword_haunted_well'), 6279);
assert.equal(types.LocType.getId('fd_firedungeon_shutchest'), 6420);
assert(ScriptProvider.load(pack) > 0, 'pack the sibling engine before this test');

const constants = fs.readFileSync(path.join(root, 'scripts/quests/quest_deserttreasure/configs/dt_smoke.constant'), 'utf8');
const names = new Set(['m50_146', 'l50_146', 'm51_146', 'l51_146', 'm51_46', 'l51_46']);
const packed = unzipSync(fs.readFileSync(path.join(pack, '.cache/maps-server.zip')), { filter: entry => names.has(entry.name) });
for (const [mx, mz] of [[50, 146], [51, 146], [51, 46]]) {
    const m = packed[`m${mx}_${mz}`];
    const l = packed[`l${mx}_${mz}`];
    assert.ok(m?.length && l?.length, `packed 377 mapsquare ${mx}_${mz}`);
    // Reuse the engine's real floor/bridge/loc collision decoder without loading static NPC spawns.
    World.gameMap.loadPackedMapsquare({ m, l, n: new Uint8Array(), o: new Uint8Array() }, mx * 64, mz * 64);
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
const outside = tile('dt_smoke_gate_outside');
const spawn = tile('dt_fareed_spawn');
const roomSw = tile('dt_fareed_room_sw');
const roomNe = tile('dt_fareed_room_ne');
const westSw = tile('dt_fareed_room_west_sw');
const westNe = tile('dt_fareed_room_west_ne');

const start = { x: 3306, z: 9375 };
assert.equal(isMapBlocked(start.x, start.z, 0), false, 'gate landing is walkable in the packed map');
const reachable = new Set([`${start.x},${start.z}`]);
const queue = [start];
for (let head = 0; head < queue.length; head++) {
    const { x, z } = queue[head];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 3200 || nx > 3327 || nz < 9344 || nz > 9407) continue;
        const key = `${nx},${nz}`;
        if (reachable.has(key) || !isLineOfWalk(0, x, z, nx, nz)) continue;
        reachable.add(key);
        queue.push({ x: nx, z: nz });
    }
}
const chamberTiles = [...reachable].map(key => {
    const [x, z] = key.split(',').map(Number);
    return { x, z };
});
const extent = chamberTiles.reduce((result, { x, z }) => ({
    minX: Math.min(result.minX, x),
    maxX: Math.max(result.maxX, x),
    minZ: Math.min(result.minZ, z),
    maxZ: Math.max(result.maxZ, z)
}), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
assert.deepEqual([chamberTiles.length, extent.minX, extent.maxX, extent.minZ, extent.maxZ], [474, 3305, 3325, 9361, 9393],
    'packed flood fill from the gate landing, without crossing the closed gate');
assert.equal(reachable.has(`${outside.x},${outside.z}`), false, 'closed gate separates the outside landing from the chamber');

for (const z of [9375, 9376]) {
    assert.equal(isMapBlocked(3305, z, 0), false, 'original gate east-side doorway floor is walkable');
    assert.equal(isLineOfWalk(0, inside.x, z, 3305, z), true, 'gate landing can walk to the doorway');
    assert.equal(isLineOfWalk(0, 3305, z, inside.x, z), true, 'doorway can walk back into the chamber');
    assert.equal(isLineOfWalk(0, 3305, z, 3304, z), false, 'original gate wall blocks doorway to outside');
    assert.equal(isLineOfWalk(0, 3304, z, 3305, z), false, 'original gate wall blocks outside to doorway');
    assert.ok(reachable.has(`3305,${z}`), `doorway ${z} belongs to the gate-side flood fill`);
}
assert.equal(isLineOfWalk(0, inside.x, inside.z, spawn.x, spawn.z), true, 'gate landing and Fareed share walkable chamber floor');
assert.equal(isLineOfWalk(0, 3206, 9379, 3206, 9378), true, 'rope landing has an open departure step');
assert.equal(isLineOfWalk(0, 3310, 2961, 3309, 2961), true, 'surface landing has an open departure step');

const packIds = new Map();
function id(kind, name) {
    if (!packIds.has(kind)) {
        packIds.set(kind, new Map(fs.readFileSync(path.join(root, `pack/${kind}.pack`), 'utf8')
            .split('\n').filter(line => /^\d+=/.test(line)).map(line => {
                const at = line.indexOf('=');
                return [line.slice(at + 1).trim(), Number(line.slice(0, at))];
            })));
    }
    const value = packIds.get(kind).get(name);
    assert.notEqual(value, undefined, `${kind}:${name}`);
    return value;
}
function script(name) {
    const result = ScriptProvider.getByName(name);
    assert(result, `compiled ${name} must exist`);
    return result;
}
function runPlayer(player, name, actor = null, args = []) {
    const state = ScriptRunner.init(script(name), player, actor, args);
    assert.equal(player.runScript(state, true, true), ScriptState.FINISHED, `${name} must finish`);
    return state;
}
function activeFareeds() {
    return [...World.npcs].filter(actor => actor.type === 1977 && actor.isActive);
}

World.currentTick = 100;
const player = new Player('dts2_topology', 1n, 0x100001n);
player.slot = 1;
player.pid = 1;
player.uid = ((1 << 11) | 1) >>> 0;
player.x = outside.x;
player.z = outside.z;
player.level = 0;
player.isActive = true;
player.setVarBit(id('varbit', 'deserttreasure'), 10);
player.setVarBit(id('varbit', 'fd_firewargate'), 1);
World.players[player.slot] = player;
World.playerLoop.add(0x100001n, player);
World.gameMap.getZone(player.x, player.z, player.level).enter(player);
runPlayer(player, '[oploc1,fd_fw_metalgateclosed_l]');
assert.deepEqual([player.level, player.x, player.z], [0, inside.x, inside.z], 'compiled unlocked-gate dispatch enters the room');

const [actor] = activeFareeds();
assert(actor, 'compiled gate dispatch creates Fareed');
assert.equal(activeFareeds().length, 1, 'gate dispatch creates exactly one Fareed');
assert.equal(actor.getVar(id('varn', 'npc_attacking_uid')), player.uid, 'compiled gate dispatch assigns Fareed to this account');
assert.equal(actor.getVar(id('varn', 'npc_aggressive_player')), player.uid, 'compiled gate dispatch sets this account as aggressive target');
assert.strictEqual(World.getNpc(actor.nid), actor, 'Fareed is the real registered world actor');

for (const { x, z } of chamberTiles) {
    const key = `${x},${z}`;
    player.x = x;
    player.z = z;
    const insideResult = runPlayer(player, '[proc,dt_fareed_inside]', actor, [CoordGrid.packCoord(0, x, z)]).popInt();
    assert.equal(insideResult, 1, `compiled dt_fareed_inside admits flood-fill chamber tile ${key}`);
    const attackable = runPlayer(player, '[proc,dt_fareed_attackable]', actor).popInt();
    assert.equal(attackable, 1, `compiled dt_fareed_attackable admits flood-fill chamber tile ${key}`);
}

assert.deepEqual([roomSw.level, roomSw.x, roomSw.z], [0, 3306, 9361], 'main chamber rectangle southwest corner');
assert.deepEqual([roomNe.level, roomNe.x, roomNe.z], [0, 3325, 9393], 'main chamber rectangle northeast corner');
assert.deepEqual([westSw.level, westSw.x, westSw.z], [0, 3305, 9373], 'west strip southwest corner');
assert.deepEqual([westNe.level, westNe.x, westNe.z], [0, 3305, 9378], 'west strip northeast corner');
let walkableInside = 0;
let walkableOutside = 0;
for (let z = extent.minZ; z <= extent.maxZ; z++) {
    for (let x = extent.minX; x <= extent.maxX; x++) {
        if (isMapBlocked(x, z, 0)) continue;
        const key = `${x},${z}`;
        const insideResult = runPlayer(player, '[proc,dt_fareed_inside]', actor, [CoordGrid.packCoord(0, x, z)]).popInt();
        assert.equal(insideResult, Number(reachable.has(key)), `compiled rectangles admit no walkable tile outside the chamber: ${key}`);
        if (insideResult) walkableInside++;
        else walkableOutside++;
    }
}
assert.equal(walkableInside, chamberTiles.length, 'two rectangles cover all 474 chamber tiles and no other walkable tile');
assert.equal(walkableOutside, 2, 'one rectangle is impossible: its required bounding box contains two isolated outside floor tiles');
player.x = outside.x;
player.z = outside.z;
assert.equal(runPlayer(player, '[proc,dt_fareed_inside]', actor, [CoordGrid.packCoord(0, outside.x, outside.z)]).popInt(), 0,
    'compiled dt_fareed_inside rejects the closed-gate outside landing');
assert.equal(runPlayer(player, '[proc,dt_fareed_attackable]', actor).popInt(), 0,
    'compiled dt_fareed_attackable rejects the closed-gate outside landing');

console.log('PASS: packed flood fill = 474 tiles; minimum two-rectangle cover, every walkable inside/attack admission, and closed-gate exclusion agree');
process.exit(0);
