#!/usr/bin/env node
/** Execute the packed grave handler and real gardener conversation. No server.
 * CANDIDATE started-step gate; the follower itself is not a Dig prerequisite.
 * Held/handed-in command lists were captured from published ffffb3b6fdd60632c032e185435e18444a85449e.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const content = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = process.env.HARNESS_ENGINE_DIR ?? path.resolve(content, '../engine');
const eng = rel => import(pathToFileURL(path.join(engine, rel)).href);
const { default: World } = await eng('src/engine/World.ts');
for (const name of ['VarPlayerType', 'VarBitType', 'VarNpcType', 'NpcType', 'LocType', 'InvType', 'ObjType', 'SeqType', 'FontType', 'Component', 'EnumType']) {
    const { default: type } = await eng(`src/cache/config/${name}.ts`);
    type.load(path.join(engine, 'data/pack'));
}
const { default: ScriptProvider } = await eng('src/engine/script/ScriptProvider.ts');
const { default: ScriptRunner } = await eng('src/engine/script/ScriptRunner.ts');
const { default: ScriptState } = await eng('src/engine/script/ScriptState.ts');
const { ScriptOpcode } = await eng('src/engine/script/ScriptOpcode.ts');
const { default: Player } = await eng('src/engine/entity/Player.ts');
const { default: Npc } = await eng('src/engine/entity/Npc.ts');
const { default: Loc } = await eng('src/engine/entity/Loc.ts');
const { default: GameMap } = await eng('src/engine/GameMap.ts');
const { default: Packet } = await eng('src/io/Packet.ts');
const { EntityLifeCycle } = await eng('src/engine/entity/EntityLifeCycle.ts');
const id = (kind, name) => {
    const match = fs.readFileSync(path.join(content, `pack/${kind}.pack`), 'utf8').match(new RegExp(`^(\\d+)=${name}$`, 'm'));
    assert(match, `missing ${kind} ${name}`);
    return Number(match[1]);
};
const I = { inv: id('inv', 'inv'), worn: id('inv', 'worn'), spade: id('obj', 'spade'), head: id('obj', 'fenk_head_empty'), full: id('obj', 'fenk_head_full'), amulet: id('obj', 'amulet_of_ghostspeak'), spoken: id('varbit', 'fenk_spoken_to_gardener'), handed: id('varbit', 'fenk_head'), stage: id('varp', 'fenk_quest'), follower: id('varp', 'fenk_follower_uid'), grave: id('loc', 'fenk_grave_poor'), gardener: id('npc', 'fenk_gardener'), dig: id('seq', 'human_dig') };
assert(ScriptProvider.load(path.join(engine, 'data/pack')) > 0);
// Real map collision and zones let the ordinary head conversation create its follower.
const map = new GameMap(true);
Object.defineProperty(World, 'gameMap', { configurable: true, value: map });
const { unzipSync } = createRequire(path.join(engine, 'package.json'))('fflate');
const zip = unzipSync(fs.readFileSync(path.join(engine, 'data/pack/.cache/maps-server.zip')));
const lands = new Int8Array(4 * 64 * 64);
map.loadGround(lands, new Packet(zip.m55_55), 3520, 3520);
map.loadLocations(lands, new Packet(zip.l55_55), 3520, 3520);
World.currentTick = 10;
let commands = [];
const originals = new Map();
for (const [name, ints, strings] of [['P_ARRIVEDELAY', 0, 0], ['ANIM', 2, 0], ['P_DELAY', 1, 0], ['MES', 0, 1], ['INV_ADD', 3, 0]]) {
    const opcode = ScriptOpcode[name], original = ScriptRunner.HANDLERS[opcode];
    originals.set(opcode, original);
    ScriptRunner.HANDLERS[opcode] = state => {
        commands.push([name, ...state.intStack.slice(state.isp - ints, state.isp), ...state.stringStack.slice(state.ssp - strings, state.ssp)]);
        original(state); // Observe only: execute the real production command unchanged.
    };
}
function player() {
    const p = new Player('', 0n, 0n);
    p.uid = 1; p.pid = 1; p.isActive = true; p.x = 3551; p.z = 3560; p.level = 0; p.lastMovement = 0;
    p.write = () => {}; p.messageGame = () => {}; p.wrappedMessageGame = () => {};
    p.getInventory(I.inv).add(I.spade, 1);
    return p;
}
function run(p, name, target, choices = []) {
    const script = ScriptProvider.getByName(name);
    assert(script, name);
    const state = ScriptRunner.init(script, p, target);
    let result = p.runScript(state, true, true), steps = 0;
    while (result === ScriptState.SUSPENDED || result === ScriptState.PAUSEBUTTON) {
        assert(++steps < 100, 'bounded production continuations');
        if (result === ScriptState.SUSPENDED) { World.currentTick = Math.max(World.currentTick + 1, p.delayedUntil); p.delayed = false; }
        else if (/^\[proc,p_choice/.test(state.script.name)) {
            assert(choices.length, 'answer every menu');
            p.lastCom = id('interface', `multi4:com_${choices.shift()}`);
        }
        result = p.runScript(state, true, true);
    }
    assert.equal(result, ScriptState.FINISHED, `${name} must finish, never swallow an abort`);
    assert.equal(choices.length, 0);
}
function dig(p, x = 3608, z = 3491) {
    commands = [];
    const loc = new Loc(0, x, z, 1, 1, EntityLifeCycle.RESPAWN, I.grave, 10, 0);
    run(p, '[oploc2,fenk_grave_poor]', loc);
    return structuredClone(commands);
}
const prefix = [['P_ARRIVEDELAY'], ['ANIM', I.dig, 0], ['P_DELAY', 1], ['MES', 'You start digging...']];
const empty = [...prefix, ['MES', '...but the grave is empty.']];
const found = [...prefix, ['INV_ADD', I.inv, I.head, 1], ['MES', '...and you find a decapitated head.']];
const traces = {};
try {
    let p = player();
    traces.notTalked = dig(p);
    assert.deepEqual(traces.notTalked, [['P_ARRIVEDELAY'], ['MES', 'Nothing interesting happens.']]);
    assert.equal(p.getInventory(I.inv).getItemCount(I.head), 0);
    assert.deepEqual(dig(p, 3542, 3486), empty, 'wrong grave retains published Dig');
    for (let slot = 1; slot < 28; slot++) p.getInventory(I.inv).set(slot, { id: I.spade, count: 1 });
    traces.notTalkedFullInventory = dig(p);
    assert.deepEqual(commands, traces.notTalked, 'full inventory must not disclose the head before talking');
    for (const stage of [0, 1, 3, 8]) {
        p = player(); p.setVar(I.stage, stage);
        const got = dig(p);
        assert.deepEqual(got, traces.notTalked, `quest stage ${stage} alone never replaces the talk`);
    }
    for (const head of [I.head, I.full]) {
        p = player(); p.getInventory(I.inv).add(head, 1);
        traces[head === I.head ? 'held' : 'heldFull'] = dig(p);
        assert.deepEqual(commands, empty, 'held head with spoken bit 0 retains published commands');
        assert.equal(p.getInventory(I.inv).getItemCount(head), 1);
    }
    p = player(); p.setVarBit(I.handed, 1);
    traces.handedIn = dig(p);
    assert.deepEqual(commands, empty, 'handed-in head with spoken bit 0 retains published commands');
    assert.equal(p.getInventory(I.inv).getItemCount(I.head), 0);
    p = player(); p.setVar(I.stage, 1); p.getInventory(I.worn).add(I.amulet, 1);
    const npc = new Npc(0, 3551, 3561, 1, 1, EntityLifeCycle.RESPAWN, 1, I.gardener, 0);
    npc.isActive = true;
    assert.equal(p.getVarBit(I.spoken), 0);
    run(p, '[opnpc1,fenk_gardener]', npc, [1]);
    assert.equal(p.getVarBit(I.spoken), 1, 'real completed head conversation writes the bit');
    run(p, '[proc,fenk_clear_gardener_follow]');
    assert.equal(p.getVar(I.follower), -1, 'positive Dig needs no active follower');
    traces.talked = dig(p);
    assert.deepEqual(commands, found);
    assert.equal(p.getInventory(I.inv).getItemCount(I.head), 1);
    p.getInventory(I.inv).remove(I.head, 1);
    for (let slot = 1; slot < 28; slot++) p.getInventory(I.inv).set(slot, { id: I.spade, count: 1 });
    traces.talkedFullInventory = dig(p);
    assert.deepEqual(commands, [...prefix, ['MES', "You don't have enough inventory space."]], 'talked full-inventory commands remain published');
    for (let slot = 1; slot < 28; slot++) p.getInventory(I.inv).set(slot, null);
    assert.deepEqual(dig(p), found, 'free-space retry after talk succeeds');
    assert.deepEqual(dig(p), empty, 'second head refused');
    p.getInventory(I.inv).remove(I.head, 1);
    assert.deepEqual(dig(p), found, 'lost pre-hand-in head remains recoverable after talk');
    console.log(JSON.stringify(traces, null, 2));
    console.log('PASS packed head gate command lists, quest stages, real conversation, no follower, duplicate and recovery controls');
} finally {
    for (const [opcode, original] of originals) ScriptRunner.HANDLERS[opcode] = original;
}
process.exit(0);
