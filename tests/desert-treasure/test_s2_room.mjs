#!/usr/bin/env node
/** Packed Fareed gate, chamber target range, and owner-scoped lifecycle regressions. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

process.on('uncaughtException', error => {
    console.error(error);
    process.exit(1);
});
process.on('unhandledRejection', error => {
    console.error(error);
    process.exit(1);
});

const scenarioArg = process.argv.find(argument => argument.startsWith('--scenario='));
const scenario = scenarioArg?.slice('--scenario='.length) ?? process.env.S2_ROOM_SCENARIO ?? 'all';
assert(['all', 'chase', 'reuse'].includes(scenario), `unknown S2 room scenario: ${scenario}`);

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = relative => import(pathToFileURL(path.join(engine, relative)).href);
const World = (await load('src/engine/World.ts')).default;
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const { Interaction } = await load('src/engine/entity/Interaction.ts');
const { NpcModeMap } = await load('src/engine/entity/NpcMode.ts');
const { isMapBlocked, isLineOfWalk } = await load('src/engine/GameMap.ts');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'NpcType', 'ParamType', 'LocType', 'SeqType', 'InvType', 'ObjType', 'FontType', 'Component']) {
    types[name] = (await load(`src/cache/config/${name}.ts`)).default;
    types[name].load(pack);
}
assert(ScriptProvider.load(pack) > 0, 'pack the sibling engine before this test');

const require = createRequire(path.join(engine, 'package.json'));
const { unzipSync } = require('fflate');
const names = new Set(['m50_146', 'l50_146', 'm51_146', 'l51_146']);
const maps = unzipSync(fs.readFileSync(path.join(pack, '.cache/maps-server.zip')), { filter: entry => names.has(entry.name) });
for (const [mx, mz] of [[50, 146], [51, 146]]) {
    const m = maps[`m${mx}_${mz}`];
    const l = maps[`l${mx}_${mz}`];
    assert.ok(m?.length && l?.length, `packed 377 mapsquare ${mx}_${mz}`);
    World.gameMap.loadPackedMapsquare({ m, l, n: new Uint8Array(), o: new Uint8Array() }, mx * 64, mz * 64);
}

const constants = fs.readFileSync(path.join(content, 'scripts/quests/quest_deserttreasure/configs/dt_smoke.constant'), 'utf8');
function tile(name) {
    const match = constants.match(new RegExp(`^\\^${name} = (\\d+)_(\\d+)_(\\d+)_(\\d+)_(\\d+)$`, 'm'));
    assert.ok(match, `named reconstruction coordinate ${name}`);
    const [, level, mx, mz, lx, lz] = match.map(Number);
    return { level, x: mx * 64 + lx, z: mz * 64 + lz };
}

const gateInside = tile('dt_smoke_gate_inside');
const gateOutside = tile('dt_smoke_gate_outside');
const fareedSpawn = tile('dt_fareed_spawn');
assert.deepEqual([gateInside.level, gateInside.x, gateInside.z], [0, 3306, 9375]);
assert.deepEqual([gateOutside.level, gateOutside.x, gateOutside.z], [0, 3304, 9375]);
assert.deepEqual([fareedSpawn.level, fareedSpawn.x, fareedSpawn.z], [0, 3309, 9376]);
assert.equal(isMapBlocked(gateInside.x, gateInside.z, gateInside.level), false);

const start = { x: gateInside.x, z: gateInside.z };
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
}).sort((a, b) => a.z - b.z || a.x - b.x);
const extents = chamberTiles.reduce((result, { x, z }) => ({
    minX: Math.min(result.minX, x),
    maxX: Math.max(result.maxX, x),
    minZ: Math.min(result.minZ, z),
    maxZ: Math.max(result.maxZ, z)
}), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
assert.deepEqual([chamberTiles.length, extents.minX, extents.maxX, extents.minZ, extents.maxZ], [474, 3305, 3325, 9361, 9393],
    'target traversal uses the complete packed chamber, independent of the source predicate');
for (const z of [9375, 9376]) {
    assert.equal(isMapBlocked(3305, z, 0), false, `doorway 3305,${z} is walkable`);
    assert.ok(reachable.has(`3305,${z}`), `doorway 3305,${z} is part of the chamber`);
}

const packIds = new Map();
function id(kind, name) {
    if (!packIds.has(kind)) {
        packIds.set(kind, new Map(fs.readFileSync(path.join(content, `pack/${kind}.pack`), 'utf8')
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
function runPlayer(player, name) {
    const state = ScriptRunner.init(script(name), player);
    assert.equal(player.runScript(state, true, true), ScriptState.FINISHED, `${name} must finish`);
    return state;
}
function activeFareeds() {
    return [...World.npcs].filter(actor => actor.type === 1977 && actor.isActive);
}

const npcAttackingUid = id('varn', 'npc_attacking_uid');
const npcAggressivePlayer = id('varn', 'npc_aggressive_player');
const varbitGateUnlocked = id('varbit', 'fd_firewargate');
const varbitKilledFareed = id('varbit', 'fd_killed_firewarrior');
const opPlayer2 = NpcModeMap.get('OPPLAYER2');
assert.notEqual(opPlayer2, undefined, 'engine NPC opplayer2 target mode is available');

World.currentTick = 100;
let serial = 0;
function addOwner(name, x, z) {
    const slot = ++serial;
    const username37 = BigInt(slot);
    const hash64 = BigInt(0x100000 + slot);
    const player = new Player(name, username37, hash64);
    player.slot = slot;
    player.pid = slot;
    player.uid = ((Number(username37 & 0x1fffffn) << 11) | slot) >>> 0;
    player.x = x;
    player.z = z;
    player.level = 0;
    player.isActive = true;
    player.setVarBit(id('varbit', 'deserttreasure'), 10);
    player.setVarBit(varbitGateUnlocked, 1);
    World.players[slot] = player;
    World.playerLoop.add(hash64, player);
    World.gameMap.getZone(player.x, player.z, player.level).enter(player);
    return player;
}
function gateDispatch(player, gate) {
    return runPlayer(player, `[oploc1,${gate}]`);
}
function ownerFareed(player) {
    const matches = activeFareeds().filter(actor => actor.getVar(npcAttackingUid) === player.uid);
    assert.equal(matches.length, 1, `${player.username}: exactly one active Fareed belongs to this account`);
    return matches[0];
}
function runAiTimer(actor) {
    const state = ScriptRunner.init(script('[ai_timer,firediamond_firewarrior]'), actor);
    actor.executeScript(state);
    assert.equal(state.execution, ScriptState.FINISHED, 'compiled Fareed AI_TIMER must finish');
    return state;
}
function assertTarget(player, actor, x, z, context, acquire = false) {
    player.x = x;
    player.z = z;
    player.level = 0;
    const owner = World.getPlayer(player.slot);
    assert.strictEqual(owner, player, `${context}: engine player lookup returns this owner`);
    if (acquire) {
        assert.equal(actor.setInteraction(Interaction.SCRIPT, owner, opPlayer2), true, `${context}: engine acquires the owner target`);
    }
    assert.strictEqual(actor.target, owner, `${context}: Fareed retains the same owner target`);
    assert.equal(actor.targetWithinMaxRange(), true, `${context}: engine validates the owner's target range`);
    assert.equal(actor.isActive, true, `${context}: Fareed remains alive`);
    assert.strictEqual(World.getNpc(actor.nid), actor, `${context}: engine still registers this Fareed`);
}
function assertGateExit(player, gate, actor, npcId, context) {
    gateDispatch(player, gate);
    assert.deepEqual([player.level, player.x, player.z], [0, 3304, 9375], `${context}: compiled gate dispatch exits to the outside destination`);
    assert.equal(actor.isActive, false, `${context}: normal exit removes the owner's Fareed`);
    assert.strictEqual(World.getNpc(npcId), undefined, `${context}: normal exit removes the registered actor`);
    assert.equal(activeFareeds().length, 0, `${context}: normal exit leaves no Fareed behind`);
    assert.equal(player.getVarBit(varbitGateUnlocked), 1, `${context}: normal exit preserves permanent gate unlock`);
    assert.equal(player.getVarBit(varbitKilledFareed), 0, `${context}: normal exit grants no kill credit`);
}

function runChaseScenario() {
    for (const [gate, doorwayZ] of [['fd_fw_metalgateclosed_l', 9375], ['fd_fw_metalgateclosed_r', 9376]]) {
        const player = addOwner(`dts2_room_${++serial}`, gateOutside.x, doorwayZ);
        gateDispatch(player, gate);
        assert.deepEqual([player.level, player.x, player.z], [0, gateInside.x, gateInside.z], `${gate}: compiled gate dispatch enters the room`);
        assert.equal(player.getVarBit(varbitGateUnlocked), 1, `${gate}: fixture uses this account's unlocked gate`);

        const actor = ownerFareed(player);
        const npcId = actor.nid;
        assert.equal(actor.getVar(npcAggressivePlayer), player.uid, `${gate}: compiled dispatch assigns the same owner`);
        assert.equal(actor.targetOp, opPlayer2, `${gate}: compiled dispatch selects Fareed's opplayer2 target mode`);
        assert.strictEqual(World.getNpc(npcId), actor, `${gate}: Fareed is the real registered actor`);

        for (const z of [9375, 9376]) {
            assert.equal(isLineOfWalk(0, gateInside.x, z, 3305, z), true, `gate doorway 3305,${z} connects to the landing`);
            assert.equal(isLineOfWalk(0, 3305, z, 3304, z), false, `closed gate blocks doorway 3305,${z} to the outside`);
            assertTarget(player, actor, 3305, z, `${gate}: doorway 3305,${z}`, z === 9375);
        }

        for (const { x, z } of chamberTiles) {
            assertTarget(player, actor, x, z, `${gate}: admitted walkable tile ${x},${z}`);
            runAiTimer(actor);
            assert.equal(actor.isActive, true, `${gate}: AI keeps Fareed alive on chamber tile ${x},${z}`);
            assert.strictEqual(actor.target, player, `${gate}: AI retains the owner on chamber tile ${x},${z}`);
        }
        assert.equal(activeFareeds().length, 1, `${gate}: target traversal never duplicates Fareed`);
        console.log(`PASS ${gate}: real NPC target stays with its owner over all ${chamberTiles.length} packed chamber tiles`);

        player.teleport(gateOutside.x, doorwayZ, 0);
        runAiTimer(actor);
        assert.equal(actor.isActive, false, `${gate}: Fareed AI lifecycle removes the actor after its owner leaves the chamber`);
        assert.strictEqual(World.getNpc(npcId), undefined, `${gate}: outside-owner lifecycle uses real World removal`);
        assert.equal(activeFareeds().length, 0, `${gate}: leaving the chamber leaves no owned Fareed`);

        gateDispatch(player, gate);
        const replacement = ownerFareed(player);
        assert.notStrictEqual(replacement, actor, `${gate}: a new gate entry after lifecycle removal creates a new actor`);
        assertTarget(player, replacement, 3305, doorwayZ, `${gate}: replacement Fareed targets the owner at its doorway`, true);
        assertGateExit(player, gate, replacement, replacement.nid, `${gate}: normal exit cleanup`);
        console.log(`PASS ${gate}: owner departure removes Fareed and normal gate exit cleans the replacement`);
    }
}

function runReuseScenario() {
    const gate = 'fd_fw_metalgateclosed_l';
    const startTile = fareedSpawn;
    const farthest = chamberTiles.reduce((best, candidate) => {
        const distance = Math.max(Math.abs(candidate.x - startTile.x), Math.abs(candidate.z - startTile.z));
        const bestDistance = Math.max(Math.abs(best.x - startTile.x), Math.abs(best.z - startTile.z));
        return distance > bestDistance || (distance === bestDistance && (candidate.x < best.x || (candidate.x === best.x && candidate.z < best.z)))
            ? candidate
            : best;
    });
    const searchDistance = Math.max(Math.abs(farthest.x - startTile.x), Math.abs(farthest.z - startTile.z));
    assert.ok(searchDistance > 10, `farthest chamber tile ${farthest.x},${farthest.z} exceeds the old search radius`);

    const ownerA = addOwner('dts2_reuse_a', gateOutside.x, gateOutside.z);
    gateDispatch(ownerA, gate);
    const fareedA = ownerFareed(ownerA);
    const fareedAId = fareedA.nid;
    fareedA.teleport(farthest.x, farthest.z, 0);
    assert.deepEqual([fareedA.x, fareedA.z], [farthest.x, farthest.z], 'owned Fareed moves using the engine teleport method');

    ownerA.teleport(gateOutside.x, gateOutside.z, 0);
    gateDispatch(ownerA, gate);
    assert.strictEqual(ownerFareed(ownerA), fareedA, "re-entry reuses this owner's Fareed at the chamber tile farthest from spawn");
    assert.equal(activeFareeds().length, 1, 're-entry does not spawn a second Fareed');
    assert.strictEqual(World.getNpc(fareedAId), fareedA, 're-entry preserves the same registered Fareed');
    assert.deepEqual([fareedA.x, fareedA.z], [farthest.x, farthest.z], 'reused Fareed stays on the far chamber tile');
    assertGateExit(ownerA, gate, fareedA, fareedAId, 'far owned Fareed cleanup');
    console.log(`PASS owned Fareed at farthest chamber tile ${farthest.x},${farthest.z}: reused on entry and removed on exit`);

    const ownerB = addOwner('dts2_reuse_b', gateOutside.x, gateOutside.z);
    gateDispatch(ownerB, gate);
    const fareedB = ownerFareed(ownerB);
    const fareedBId = fareedB.nid;
    fareedB.teleport(farthest.x, farthest.z, 0);

    gateDispatch(ownerA, gate);
    const secondFareedA = ownerFareed(ownerA);
    assert.notStrictEqual(secondFareedA, fareedB, 'one account never reuses another account\'s Fareed');
    assert.equal(activeFareeds().length, 2, 'the new owner gets a separate Fareed while the other account keeps its own');
    assert.equal(fareedB.getVar(npcAttackingUid), ownerB.uid, 'the distant Fareed retains the other account owner id');
    assert.strictEqual(World.getNpc(fareedBId), fareedB, 'the other account\'s Fareed remains registered after the new entry');

    const secondFareedAId = secondFareedA.nid;
    gateDispatch(ownerA, gate);
    assert.equal(secondFareedA.isActive, false, 'owner A exit removes only owner A Fareed');
    assert.strictEqual(World.getNpc(secondFareedAId), undefined, 'owner A Fareed is removed from the engine world');
    assert.equal(fareedB.isActive, true, 'owner A exit leaves owner B Fareed alive');
    assert.strictEqual(World.getNpc(fareedBId), fareedB, 'owner A exit does not delete owner B Fareed');
    assert.deepEqual(activeFareeds(), [fareedB], 'the other account remains the only active Fareed');

    assertGateExit(ownerB, gate, fareedB, fareedBId, 'owner B far Fareed cleanup');
    console.log('PASS account isolation: owner B Fareed is neither reused nor removed by owner A');
}

if (scenario === 'all' || scenario === 'chase') runChaseScenario();
if (scenario === 'all' || scenario === 'reuse') runReuseScenario();

// The real World imports own workers; no network listener or world loop is started.
process.exit(0);
