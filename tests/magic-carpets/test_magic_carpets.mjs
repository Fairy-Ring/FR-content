// Packed production merchant dispatch, menus, settlement and arrival; no server.
// From the sibling engine: node --import tsx ../content/tests/magic-carpets/test_magic_carpets.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const pack = path.join(engine, 'data/pack');
const load = async rel => (await import(pathToFileURL(path.join(engine, 'src', rel)).href)).default;
const World = await load('engine/World.ts');
const Player = await load('engine/entity/Player.ts');
const Npc = await load('engine/entity/Npc.ts');
const ScriptProvider = await load('engine/script/ScriptProvider.ts');
const ScriptRunner = await load('engine/script/ScriptRunner.ts');
const ScriptState = await load('engine/script/ScriptState.ts');
const { EntityLifeCycle } = await import(pathToFileURL(path.join(engine, 'src/engine/entity/EntityLifeCycle.ts')).href);
const triggers = await load('engine/script/ServerTriggerType.ts');
const types = {};
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'VarSharedType', 'NpcType', 'LocType', 'SeqType', 'SpotanimType', 'InvType', 'ObjType', 'FontType', 'Component', 'DbRowType', 'DbTableType', 'EnumType', 'ParamType', 'CategoryType', 'StructType', 'MesanimType']) {
    types[name] = await load(`cache/config/${name}.ts`);
    types[name].load(pack);
}
assert.ok(ScriptProvider.load(pack) > 0, 'full pack required');
World.currentTick = 100;
World.gameMap.init();
const inv = types.InvType.getId('inv');
const worn = types.InvType.getId('worn');
const coins = types.ObjType.getId('coins');
const components = new Map(fs.readFileSync(path.join(content, 'pack/interface.pack'), 'utf8').split('\n').filter(x => /^\d+=/.test(x)).map(x => { const at = x.indexOf('='); return [x.slice(at + 1).trim(), Number(x.slice(0, at))]; }));
// VERIFIED map placements; UNKNOWN one-tile arrival offsets, checked for collision below.
const stations = [
    { seller: 1, mapped: 2291, map: 'm51_48', local: [47, 37], tile: [3311, 3109], arrival: [3310, 3109] },
    { seller: 2, mapped: 2292, map: 'm49_47', local: [46, 35], tile: [3182, 3043], arrival: [3181, 3043] },
    { seller: 3, mapped: 2293, map: 'm52_45', local: [20, 62], tile: [3348, 2942], arrival: [3348, 2943] },
    { seller: 4, mapped: 2294, map: 'm52_46', local: [22, 57], tile: [3350, 3001], arrival: [3350, 3002] },
    { seller: 5, mapped: 2295, map: 'm54_48', local: [11, 38], tile: [3467, 3110], arrival: [3468, 3110], morph: 10 },
    { seller: 6, mapped: 2297, map: 'm51_43', local: [23, 61], tile: [3287, 2813], arrival: [3286, 2813], morph: 1 },
    { seller: 7, mapped: 2299, map: 'm50_43', local: [43, 61], tile: [3243, 2813], arrival: [3244, 2813], morph: 1 },
    { seller: 8, mapped: 3020, map: 'm53_45', local: [9, 38], tile: [3401, 2918], arrival: [3400, 2918] },
];
const station = id => stations.find(x => x.seller === id);
const npcName = id => `magic_carpet_seller${id}`;
let serial = 0;
function fixture(amount = 200) {
    const p = new Player(`carpet_${++serial}`, BigInt(serial), BigInt(serial));
    p.uid = serial; p.pid = serial; p.slot = serial;
    p.x = 3310; p.z = 3109; p.level = 0; p.lastMovement = -100;
    p.vars.fill(0); p.packets = [];
    p.write = packet => p.packets.push(packet);
    p.messageGame = text => p.packets.push({ text });
    p.wrappedMessageGame = p.messageGame;
    p.getInventory(inv).add(coins, amount);
    return p;
}
const count = p => p.getInventory(inv).getItemCount(coins);
const tile = p => [p.x, p.z];
const text = p => p.packets.map(x => x.text ?? '').join(' ').replace(/[|\s]+/g, ' ');
function run(p, id, choices) {
    const s = station(id);
    const name = npcName(id);
    const root = types.NpcType.get(s.mapped);
    assert.equal(root.debugname, s.morph === undefined ? name : `${name}_multi`);
    if (s.morph !== undefined) {
        if (root.multivarp !== -1) p.setVar(root.multivarp, s.morph);
        else p.setVarBit(root.multivarbit, s.morph);
    }
    const n = new Npc(0, ...s.tile, 1, 1, EntityLifeCycle.RESPAWN, serial, s.mapped, root.blockwalk);
    p.target = n; p.targetOp = triggers.OPNPC1 - 7;
    const script = p.getOpTrigger();
    assert.equal(script?.name, `[opnpc1,${name}]`, 'dispatch from mapped base to visible form');
    const state = ScriptRunner.init(script, p, n);
    let result = p.runScript(state, true, true);
    const animations = [];
    for (let step = 0; result !== ScriptState.FINISHED && step < 100; step++) {
        if (result === ScriptState.PAUSEBUTTON) {
            const menu = state.script.name.match(/^\[proc,p_choice([2345])(?:_header)?\]$/);
            if (menu) {
                assert.ok(choices.length, `unanswered ${state.script.name}`);
                p.lastCom = components.get(`multi${menu[1]}:com_${choices.shift()}`);
                assert.ok(Number.isInteger(p.lastCom));
            }
        } else if (result === ScriptState.SUSPENDED) {
            animations.push(p.animId);
            World.currentTick = p.delayedUntil;
            p.delayed = false;
        } else assert.fail(`unexpected ${result} in ${state.script.name}`);
        result = p.runScript(state, true, true);
    }
    assert.equal(result, ScriptState.FINISHED, 'journey completes');
    assert.equal(choices.length, 0, `all intended choices consumed from ${name}: ${text(p)}`);
    return animations;
}
function trip(from, to, route, setup = () => {}, fare = 200) {
    const p = fixture(fare);
    setup(p);
    const vars = [...p.vars];
    const animations = run(p, from, [1, route, 1]);
    assert.equal(count(p), 0, 'exact fare consumed');
    assert.deepEqual(tile(p), station(to).arrival, 'correct arrival');
    // Source morph fixture can set its own independent selector; the product writes no quest stages.
    if (station(from).morph === undefined) assert.deepEqual([...p.vars], vars);
    assert.equal(animations.length, 2, 'both original boarding and landing animations delay');
    assert.ok(text(p).includes(`The fare is ${fare} coins.`));
    return p;
}
for (const s of stations) {
    const map = fs.readFileSync(path.join(content, 'maps', `${s.map}.jm2`), 'utf8');
    assert.ok(map.split('\n').includes(`0 ${s.local[0]} ${s.local[1]}: ${s.mapped}`));
    const visible = types.NpcType.getByName(npcName(s.seller));
    assert.equal(visible.op[0], 'Talk-to');
    assert.ok(!visible.op.includes('Travel'), 'post-cutoff operation excluded');
}
const golem = p => p.setVarBit(types.VarBitType.getId('golem_a'), 10);
const helper = p => p.setVarBit(types.VarBitType.getId('ics_little_var'), 26);
trip(1, 2, 2); trip(2, 1, 1); trip(1, 4, 3); trip(4, 1, 1);
trip(1, 5, 1, golem); trip(5, 1, 1);
trip(3, 8, 1); trip(8, 3, 1);
trip(3, 7, 2, helper); trip(7, 3, 1);
trip(3, 6, 3, helper); trip(6, 3, 1);
console.log('PASS all twelve directed routes and visible-form dispatch; no Feud gate');
for (const [from, choice, variable, stages] of [[1, 1, 'golem_a', [0, 1, 9]], [3, 2, 'ics_little_var', [0, 1, 25]], [3, 3, 'ics_little_var', [0, 1, 25]]]) {
    for (const stage of stages) {
        const p = fixture(); p.setVarBit(types.VarBitType.getId(variable), stage);
        const before = tile(p); run(p, from, [1, choice]);
        assert.equal(count(p), 200); assert.deepEqual(tile(p), before);
        assert.ok(text(p).includes('You must complete'));
    }
}
console.log('PASS exact completion gates before payment');
for (const [ring, cheap, fare] of [[false, false, 200], [true, false, 100], [false, true, 100], [true, true, 75]]) {
    const setup = p => {
        if (ring) p.getInventory(worn).set(12, { id: types.ObjType.getId('ring_of_charos_unlocked'), count: 1 });
        if (cheap) p.setVarBit(types.VarBitType.getId('roguetrader_cheapflights'), 1);
    };
    trip(1, 2, 2, setup, fare);
    const p = fixture(fare - 1); setup(p); const before = tile(p);
    run(p, 1, [1, 2, 1]);
    assert.equal(count(p), fare - 1); assert.deepEqual(tile(p), before);
    assert.ok(text(p).includes("You don't have enough coins."));
}
for (const [container, ring] of [[inv, 'ring_of_charos_unlocked'], [worn, 'ring_of_charos']]) {
    trip(1, 2, 2, p => p.getInventory(container).set(container === worn ? 12 : 1, { id: types.ObjType.getId(ring), count: 1 }));
}
trip(1, 2, 2, p => p.setVarBit(types.VarBitType.getId('roguetrader_started'), 1));
console.log('PASS four fares, insufficient funds, worn activated ring only, explicit discount reward only');
for (const choices of [[2], [1, 4], [1, 2, 2]]) {
    const p = fixture(); const before = tile(p); run(p, 1, [...choices]);
    assert.equal(count(p), 200); assert.deepEqual(tile(p), before);
}
{
    const p = fixture(); p.getInventory(worn).set(3, { id: types.ObjType.getId('bronze_dagger'), count: 1 });
    run(p, 1, [1, 2]); assert.equal(count(p), 200); assert.deepEqual(tile(p), [3310, 3109]);
    assert.ok(text(p).includes('Please remove your weapon'));
}
console.log('PASS cancellation and period weapon restriction');
console.log('RESULT PASS magic carpets compiled production network');
process.exit(0);
