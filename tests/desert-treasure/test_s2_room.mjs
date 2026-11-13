#!/usr/bin/env node
/** Real compiled Fareed doorway dispatch; no handler, actor or map API stubs. */
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

const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = relative => import(pathToFileURL(path.join(engine, relative)).href);
const World = (await load('src/engine/World.ts')).default;
const ScriptProvider = (await load('src/engine/script/ScriptProvider.ts')).default;
const ScriptRunner = (await load('src/engine/script/ScriptRunner.ts')).default;
const ScriptState = (await load('src/engine/script/ScriptState.ts')).default;
const Player = (await load('src/engine/entity/Player.ts')).default;
const Npc = (await load('src/engine/entity/Npc.ts')).default;
const { EntityLifeCycle } = await load('src/engine/entity/EntityLifeCycle.ts');
const { isLineOfWalk } = await load('src/engine/GameMap.ts');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'NpcType', 'ParamType', 'LocType', 'SeqType', 'InvType', 'ObjType', 'FontType', 'Component']) {
    types[name] = (await load(`src/cache/config/${name}.ts`)).default;
    types[name].load(pack);
}
assert(ScriptProvider.load(pack) > 0, 'pack the sibling engine before this test');
const require = createRequire(path.join(engine, 'package.json'));
const { unzipSync } = require('fflate');
const names = new Set(['m51_146', 'l51_146']);
const maps = unzipSync(fs.readFileSync(path.join(pack, '.cache/maps-server.zip')), { filter: entry => names.has(entry.name) });
World.gameMap.loadPackedMapsquare({ m: maps.m51_146, l: maps.l51_146, n: new Uint8Array(), o: new Uint8Array() }, 51 * 64, 146 * 64);

const packs = new Map();
function id(kind, name) {
    if (!packs.has(kind)) {
        packs.set(kind, new Map(fs.readFileSync(path.join(content, `pack/${kind}.pack`), 'utf8')
            .split('\n').filter(line => /^\d+=/.test(line)).map(line => {
                const at = line.indexOf('=');
                return [line.slice(at + 1).trim(), Number(line.slice(0, at))];
            })));
    }
    const value = packs.get(kind).get(name);
    assert.notEqual(value, undefined, `${kind}:${name}`);
    return value;
}
function script(name) {
    const result = ScriptProvider.getByName(name);
    assert(result, `compiled ${name} must exist`);
    return result;
}
function runPlayer(player, name, actor = null) {
    const state = ScriptRunner.init(script(name), player, actor);
    assert.equal(player.runScript(state, true, true), ScriptState.FINISHED, `${name} must finish`);
    return state;
}
function activeFareeds() {
    return [...World.npcs].filter(actor => actor.type === 1977 && actor.isActive);
}

World.currentTick = 100;
let serial = 0;
for (const [gate, z] of [['fd_fw_metalgateclosed_l', 9375], ['fd_fw_metalgateclosed_r', 9376]]) {
    const slot = ++serial;
    const username37 = BigInt(slot);
    const hash64 = BigInt(0x100000 + slot);
    const player = new Player(`dts2_room_${slot}`, username37, hash64);
    player.slot = slot;
    player.pid = slot;
    player.uid = ((Number(username37 & 0x1fffffn) << 11) | slot) >>> 0;
    player.x = 3305;
    player.z = z;
    player.level = 0;
    player.isActive = true;
    player.setVarBit(id('varbit', 'deserttreasure'), 10);
    player.setVarBit(id('varbit', 'fd_firewargate'), 1);
    World.players[slot] = player;
    World.playerLoop.add(hash64, player);
    World.gameMap.getZone(player.x, player.z, player.level).enter(player);

    const type = types.NpcType.get(1977);
    const actor = new Npc(0, 3309, 9376, type.size, type.size, EntityLifeCycle.DESPAWN, World.getNextNid(), type.id, type.blockwalk);
    World.addNpc(actor, 1000);
    actor.setVar(id('varn', 'npc_attacking_uid'), player.uid);
    actor.setVar(id('varn', 'npc_aggressive_player'), player.uid);
    assert.deepEqual(activeFareeds(), [actor], 'fixture registers exactly one real Fareed');

    const timer = ScriptRunner.init(script('[ai_timer,firediamond_firewarrior]'), actor);
    actor.executeScript(timer);
    assert.equal(timer.execution, ScriptState.FINISHED, 'compiled doorway AI timer must finish');
    assert.equal(actor.isActive, true, 'AI_TIMER must not delete the doorway owner\'s Fareed');
    assert.strictEqual(World.getNpc(actor.nid), actor, 'AI_TIMER preserves the same registered actor');
    assert.deepEqual(activeFareeds(), [actor], 'AI_TIMER neither deletes nor spawns a second Fareed');
    console.log(`PASS compiled AI_TIMER at 3305,${z}: sole owner actor retained`);

    for (const [x, expected] of [[3305, 1], [3306, 1], [3304, 0]]) {
        player.x = x;
        const admission = runPlayer(player, '[proc,dt_fareed_attackable]', actor);
        assert.equal(admission.popInt(), expected, `compiled Attack admission at ${x},${z}`);
    }
    player.x = 3305;
    assert.equal(isLineOfWalk(0, player.x, z, actor.x, actor.z), true, 'doorway and Fareed share open chamber floor');
    assert.equal(isLineOfWalk(0, actor.x, actor.z, player.x, z), true, 'Fareed can approach the doorway without a wall safe spot');

    runPlayer(player, `[oploc1,${gate}]`);
    assert.deepEqual([player.level, player.x, player.z], [0, 3304, 9375], 'compiled doorway gate dispatch exits to the outside destination');
    assert.equal(actor.isActive, false, 'normal exit performs its intended owner cleanup');
    assert.equal(World.getNpc(actor.nid), undefined, 'normal exit removes the original registered actor');
    assert.equal(activeFareeds().length, 0, 'normal exit spawns no replacement actor');
    assert.equal(player.getVarBit(id('varbit', 'fd_firewargate')), 1, 'normal exit preserves permanent gate unlock');
    assert.equal(player.getVarBit(id('varbit', 'fd_killed_firewarrior')), 0, 'normal exit grants no kill credit');
    console.log(`PASS compiled ${gate} at 3305,${z}: one intended cleanup, outside teleport, no second actor`);
}

// The real World imports own workers; no network listener or world loop is started.
process.exit(0);
