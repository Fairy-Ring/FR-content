// Packed production dispatch, flight ticks, region rebuilds, recovery and collision.
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
const map = await import(pathToFileURL(path.join(engine, 'src/engine/GameMap.ts')).href);
const MoveClick = await load('network/game/client/model/MoveClick.ts');
const MoveClickHandler = await load('network/game/client/handler/MoveClickHandler.ts');
const OpNpc = await load('network/game/client/model/OpNpc.ts');
const OpNpcHandler = await load('network/game/client/handler/OpNpcHandler.ts');
const { PlayerInfoProt } = await import(pathToFileURL(path.join(engine, 'src/network/rsbuf/prot.ts')).href);
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
const carpetVar = types.VarPlayerType.getId('magic_carpet_var');
const flying = types.SeqType.getId('dragon_warhammer_sa_spotanim');
const bas = p => [p.readyanim, p.turnanim, p.walkanim, p.walkanim_b, p.walkanim_l, p.walkanim_r, p.runanim];
function proc(p, name) {
    const script = ScriptProvider.getByName(`[proc,${name}]`);
    assert.ok(script, name);
    const state = ScriptRunner.init(script, p);
    p.executeScript(state, true, true);
    assert.equal(state.execution, ScriptState.FINISHED, name);
}
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
    p.buildArea.rebuild(true);
    p.resetPathingEntity();
    proc(p, 'update_bas');
    return p;
}
const count = p => p.getInventory(inv).getItemCount(coins);
const tile = p => [p.x, p.z];
const text = p => p.packets.map(x => x.text ?? '').join(' ').replace(/[|\s]+/g, ' ');
function run(p, id, choices, interrupt = false) {
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
    p.executeScript(state, true, true);
    const samples = [], animations = [], animationUpdates = [];
    let rebuilds = 0;
    for (let step = 0; state.execution !== ScriptState.FINISHED && step < 250; step++) {
        if (state.execution === ScriptState.PAUSEBUTTON) {
            const menu = state.script.name.match(/^\[proc,p_choice([2345])(?:_header)?\]$/);
            if (menu) {
                assert.ok(choices.length, `unanswered ${state.script.name}`);
                p.lastCom = components.get(`multi${menu[1]}:com_${choices.shift()}`);
                assert.ok(Number.isInteger(p.lastCom));
            }
        } else if (state.execution === ScriptState.SUSPENDED) {
            animations.push(p.animId);
            if (p.masks & PlayerInfoProt.ANIM) animationUpdates.push(p.animId);
            assert.ok(p.delayed && p.protect && !p.canAccess(), 'flight owns protected access across ticks');
            assert.equal(new MoveClickHandler().handle(new MoveClick([{ x: p.x + 10, z: p.z }], 0, false), p), false, 'random walk rejected');
            assert.equal(new OpNpcHandler().handle(new OpNpc(1, n.nid), p), false, 'random operation rejected');
            if (p.exactStartX !== -1) {
                const start = [p.exactStartX, p.exactStartZ], end = tile(p);
                assert.deepEqual([p.exactEndX, p.exactEndZ], end);
                assert.ok(Math.max(...end.map((v, i) => Math.abs(v - start[i]))) <= 2, 'every server hop stays below forced-jump threshold');
                p.validateDistanceWalked();
                assert.equal(p.jump, false, 'no client path reset/snap');
                assert.equal(p.exactMoveStart, 0);
                assert.equal(p.exactMoveEnd, 30, 'one 600ms tick at 20ms client cycles');
                const previousOrigin = [p.originX, p.originZ];
                p.buildArea.rebuild();
                if (p.originX !== previousOrigin[0] || p.originZ !== previousOrigin[1]) rebuilds++;
                const base = [((p.originX >> 3) - 6) << 3, ((p.originZ >> 3) - 6) << 3];
                for (const point of [start, end]) for (let axis = 0; axis < 2; axis++) {
                    const local = point[axis] - base[axis];
                    assert.ok(local >= 12 && local < 92, 'both exact endpoints stay in client safe area after rebuild');
                    assert.ok(local >= 0 && local <= 255, 'unsigned-byte exact coordinates cannot wrap');
                }
                samples.push({ start, end, bas: bas(p), destination: p.getVar(carpetVar) });
                if (interrupt && samples.filter(x => x.bas[0] === flying).length === 5) return { samples, animations, rebuilds };
            }
            World.currentTick = p.delayedUntil;
            p.delayed = false;
            p.resetPathingEntity();
        } else assert.fail(`unexpected ${state.execution} in ${state.script.name}`);
        p.executeScript(state, true, true);
    }
    assert.equal(state.execution, ScriptState.FINISHED, 'journey completes');
    assert.equal(choices.length, 0, `all intended choices consumed from ${name}: ${text(p)}`);
    return { samples, animations, animationUpdates, rebuilds };
}
function trip(from, to, route, setup = () => {}, fare = 200) {
    const p = fixture(fare);
    [p.x, p.z] = station(from).arrival;
    p.buildArea.rebuild(true); p.resetPathingEntity();
    setup(p);
    const vars = [...p.vars], originalBas = bas(p);
    const { samples, animations, animationUpdates, rebuilds } = run(p, from, [1, route, 1]);
    assert.equal(count(p), 0, 'exact fare consumed');
    assert.deepEqual(tile(p), station(to).arrival, 'independent mapped-station arrival, not a read of product constants');
    if (station(from).morph === undefined) assert.deepEqual([...p.vars], vars);
    assert.equal(p.getVar(carpetVar), 0, 'station rug restored');
    assert.deepEqual(bas(p), originalBas, 'normal appearance restored');
    assert.equal(p.animId, -1, 'primary flying animation stopped');
    assert.ok(animations.includes(types.SeqType.getId('carpet_sit_down')));
    assert.ok(animations.includes(types.SeqType.getId('carpet_raise')));
    assert.ok(animations.includes(types.SeqType.getId('carpet_land')));
    assert.ok(animations.includes(flying), 'primary loop carries visible carpet model');
    const landingIndex = animationUpdates.indexOf(types.SeqType.getId('carpet_land'));
    assert.ok(landingIndex > 0);
    assert.equal(animationUpdates[landingIndex - 1], -1, 'clear priority-10 primary before priority-5 landing');
    const airborne = samples.filter(x => x.bas[0] === flying);
    assert.ok(airborne.length > 10, 'journey has many distinct flight ticks, not a single teleport');
    assert.ok(airborne.every(x => x.bas.every(seq => seq === flying) && x.destination === to));
    assert.ok(rebuilds >= 1, 'real engine build area recenters during long travel');
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
assert.equal(carpetVar, 499, 'original client rug selector, no new slot');
assert.equal(types.VarPlayerType.get(carpetVar).transmit, true);
assert.equal(types.VarPlayerType.get(carpetVar).scope, 1, 'saved paid destination for crash recovery');
const rug = types.LocType.getByName('carpet_rolledout_multi');
assert.equal(rug.multivarp, carpetVar, 'real client reader for transmitted state');
assert.equal(rug.multiloc[0], types.LocType.getId('carpet_rolledout'));
for (const s of stations) {
    assert.equal(map.isMapBlocked(...s.arrival, 0), false, `${npcName(s.seller)} landing walkable`);
    const escape = [[s.arrival[0] + 4, s.arrival[1]], [s.arrival[0] - 4, s.arrival[1]], [s.arrival[0], s.arrival[1] + 4], [s.arrival[0], s.arrival[1] - 4]]
        .find(([x, z]) => !map.isMapBlocked(x, z, 0) && map.findPath(0, ...s.arrival, x, z).length > 0);
    assert.ok(escape, `${npcName(s.seller)} has a real path out`);
}
console.log('PASS packed landing collision and non-empty escape paths for all eight stations');
const rugAnchors = [[3308, 3109], [3180, 3044], [3351, 2941], [3349, 3003], [3469, 3112], [3285, 2813], [3245, 2813], [3400, 2916]];
for (const [index, [x, z]] of rugAnchors.entries()) {
    // Original multi bases block collision even though the visible rug does not.
    // Boarding is protected transit, NEVER a final or recovery landing.
    const source = fs.readFileSync(path.join(content, 'maps', `${stations[index].map}.jm2`), 'utf8');
    assert.ok(source.split('\n').some(line => line.startsWith(`0 ${x & 63} ${z & 63}: 7395 10`)), 'boarding uses the real mapped rug, not an invented station');
}
for (const [from, to, choice, setup] of [[1, 2, 2, () => {}], [2, 1, 1, () => {}], [6, 3, 1, () => {}], [1, 4, 3, () => {}], [1, 5, 1, golem], [3, 6, 3, helper], [3, 7, 2, helper], [3, 8, 1, () => {}]]) {
    for (const trigger of [triggers.LOGOUT, triggers.LOGIN]) {
        const p = fixture(); [p.x, p.z] = station(from).arrival;
        p.buildArea.rebuild(true); p.resetPathingEntity(); setup(p);
        run(p, from, [1, choice, 1], true);
        assert.equal(p.getVar(carpetVar), to);
        assert.notDeepEqual(tile(p), station(to).arrival, 'interrupt genuinely occurs over desert');
        // Disconnect drops the suspended script; login reloads the original permanent varp.
        p.activeScript = null; p.protect = false; p.delayed = false; p.closeModal();
        const root = ScriptProvider.getByTriggerSpecific(trigger, -1, -1);
        assert.ok(root);
        const state = ScriptRunner.init(root, p);
        p.executeScript(state, true, true);
        assert.notEqual(state.execution, ScriptState.ABORTED, 'real lifecycle root executes');
        assert.equal(p.getVar(carpetVar), 0);
        assert.deepEqual(tile(p), station(to).arrival, 'real lifecycle hook lands at paid destination');
        assert.equal(p.readyanim, types.SeqType.getId('human_ready'));
        assert.equal(p.walkanim, types.SeqType.getId('human_walk_f'));
        assert.equal(p.animId, -1);
        assert.equal(count(p), 0, 'recovery never charges again');
    }
}
console.log('PASS actual login/logout roots recover every destination with normal BAS');
for (const active of [0, 4]) {
    const p = fixture(); p.setVar(carpetVar, active);
    p.getInventory(inv).add(types.ObjType.getId('water_skin4'), 1);
    p.getInventory(inv).add(types.ObjType.getId('jug_water'), 1);
    const before = p.getInventory(inv).getItemCount(types.ObjType.getId('water_skin4'));
    const heat = ScriptRunner.init(ScriptProvider.getByName('[timer,desert_heat]'), p);
    p.executeScript(heat, true, true);
    assert.equal(heat.execution, ScriptState.FINISHED);
    assert.equal(p.getInventory(inv).getItemCount(types.ObjType.getId('water_skin4')), active ? before : 0);
    assert.equal(p.getInventory(inv).getItemCount(types.ObjType.getId('jug_water')), active ? 1 : 0);
    if (active) assert.ok(!text(p).includes('water') && !text(p).includes('thirst'));
}
console.log('PASS airborne heat immunity without weakening normal desert heat');
{
    const p = fixture(); p.setVar(carpetVar, 4);
    const hp = p.levels[3];
    const heat = ScriptRunner.init(ScriptProvider.getByName('[timer,desert_heat]'), p);
    p.executeScript(heat, true, true);
    assert.equal(p.levels[3], hp, 'no airborne heat damage');
    assert.equal([...p.queue.all()].length, 0, 'no deferred thirst damage');
}
console.log('RESULT PASS magic carpets compiled production network');
process.exit(0);
