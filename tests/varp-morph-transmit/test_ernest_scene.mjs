#!/usr/bin/env node
/** Execute the real completion scene against NPCs derived from the tested map. No server. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const ResumePauseButtonHandler = (await load('src/network/game/client/handler/ResumePauseButtonHandler.ts')).default;
const ResumePauseButton = (await load('src/network/game/client/model/ResumePauseButton.ts')).default;
const configs = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'ParamType', 'ObjType',
    'LocType', 'NpcType', 'InvType', 'CategoryType', 'EnumType', 'StructType', 'SeqType',
    'MesanimType', 'DbTableType', 'DbRowType', 'Component', 'FontType']) {
    configs[name] = (await load(`src/cache/config/${name}.ts`)).default;
    configs[name].load(pack);
}
(await load('src/cache/config/DbTableIndex.ts')).default.init();
assert(ScriptProvider.load(pack) > 0, 'build the tested sibling engine pack first');
World.currentTick = 10;

const map = readFileSync(path.join(content, 'maps/m48_52.jm2'), 'utf8').split('==== NPC ====')[1];
assert(map, 'the tested manor map has an NPC section');
const placements = [...map.matchAll(/^(\d+) (\d+) (\d+): (\d+)$/gm)].map(match => ({
    level: Number(match[1]), x: 48 * 64 + Number(match[2]), z: 52 * 64 + Number(match[3]), id: Number(match[4])
}));
let serial = 0;
function naturalNpc(name) {
    const type = configs.NpcType.getByName(name);
    assert(type, `missing packed ${name}`);
    const placement = placements.find(row => row.id === type.id);
    assert(placement, `the tested map must place ${name}`);
    const npc = new Npc(placement.level, placement.x, placement.z, type.size, type.size,
        EntityLifeCycle.RESPAWN, ++serial, type.id, type.blockwalk);
    World.addNpc(npc, -1);
    return npc;
}
const chicken = naturalNpc('ernest_multichicken');
const professor = naturalNpc('professor_oddenstein');
const hero = new Player('', 0n, 0n);
hero.uid = 1;
hero.pid = 1;
hero.x = chicken.x + 1;
hero.z = chicken.z;
hero.level = chicken.level;
hero.vars.fill(0);
const haunted = configs.VarPlayerType.getId('haunted');
assert(haunted >= 0);
hero.setVar(haunted, 2); // Disclosed prerequisite, not the completion under test.
const packets = [];
hero.write = packet => packets.push(packet); // Capture transport only, never replace gameplay.
const inv = configs.InvType.getId('inv');
const parts = ['pressure_gauge', 'oil_can', 'rubber_tube'].map(name => configs.ObjType.getId(name));
assert(parts.every(id => id >= 0));
for (const id of parts) hero.invAdd(inv, id, 1);
const script = ScriptProvider.getByName('[label,oddenstein_items]');
assert(script, 'published completion branch exists');
const state = ScriptRunner.init(script, hero, professor);
hero.executeScript(state, true);
for (let turn = 0; state.execution !== ScriptState.FINISHED && turn < 100; turn++) {
    assert.notEqual(state.execution, ScriptState.ABORTED, `${state.script.name} aborted`);
    if (state.execution === ScriptState.PAUSEBUTTON) {
        assert(new ResumePauseButtonHandler().handle(new ResumePauseButton(), hero));
    } else if (state.execution === ScriptState.SUSPENDED) {
        World.currentTick = Math.max(World.currentTick + 1, hero.delayedUntil);
        hero.delayed = false;
        hero.executeScript(state, true, true);
    } else {
        assert.fail(`unexpected completion execution state ${state.execution}`);
    }
}
assert.equal(state.execution, ScriptState.FINISHED, 'the real completion dialogue finishes');
for (let tick = 0; tick < 3; tick++) {
    World.currentTick++;
    hero.processQueues();
}
const observed = {
    mapParent: configs.NpcType.getId('ernest_multichicken'),
    actualType: chicken.type,
    expectedType: configs.NpcType.getId('ernest'),
    stage: hero.getVar(haunted),
    remainingParts: parts.map(id => hero.invTotal(inv, id)),
    coins: hero.invTotal(inv, configs.ObjType.getId('coins')),
    execution: state.execution,
    packetClasses: packets.map(packet => packet.constructor.name)
};
console.log(`Ernest completion observation ${JSON.stringify(observed)}`);
assert.equal(observed.stage, 3, 'product writes completion even if the transformation lookup misses');
assert.deepEqual(observed.remainingParts, [0, 0, 0], 'product consumes all three parts');
assert.equal(observed.coins, 300, 'the genuine completion queue still gives the reward');
assert.equal(observed.actualType, observed.expectedType, 'the intended scene must transform the placed multi parent, not search an absent raw chicken');
console.log('PASS packed Ernest scene: placed parent becomes Ernest before completion; quest and reward still complete');
process.exit(0);
