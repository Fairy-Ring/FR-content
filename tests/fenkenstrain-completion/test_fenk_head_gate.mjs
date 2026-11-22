#!/usr/bin/env node
/** Execute the packed grave handler and real gardener conversation. No server.
 * CANDIDATE started-step gate; the follower itself is not a Dig prerequisite.
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
function player() {
    const p = new Player('', 0n, 0n);
    p.uid = 1; p.pid = 1; p.isActive = true; p.x = 3551; p.z = 3560; p.level = 0; p.lastMovement = 0;
    p.write = () => {}; p.messages = []; p.messageGame = text => p.messages.push(text); p.wrappedMessageGame = p.messageGame;
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
// Authored from the grave's eligibility, one-head reward and space rules.
// Observe resulting state and player messages, never the engine command stream.
function dig(p, outcome, x = 3608, z = 3491) {
    const items = p.getInventory(I.inv);
    const before = items.items.map(item => item && { ...item });
    const heads = items.getItemCount(I.head), xp = [...p.stats], vars = [...p.vars];
    const tick = World.currentTick;
    p.messages = [];
    const loc = new Loc(0, x, z, 1, 1, EntityLifeCycle.RESPAWN, I.grave, 10, 0);
    run(p, '[oploc2,fenk_grave_poor]', loc);
    assert.equal(items.getItemCount(I.head), heads + Number(outcome === 'found'));
    assert.deepEqual([...p.stats], xp, 'Dig awards no XP');
    assert.deepEqual([...p.vars], vars, 'Dig changes no quest or remembered state');
    if (outcome !== 'found') assert.deepEqual(items.items, before, 'refusal preserves every inventory slot');
    else {
        assert.equal(items.getItemCount(I.spade), 1, 'the reward does not consume the spade');
        assert.equal(items.items.filter(Boolean).length, before.filter(Boolean).length + 1, 'exactly one head is added');
    }
    const result = { locked: 'Nothing interesting happens.', empty: '...but the grave is empty.',
        found: '...and you find a decapitated head.', full: "You don't have enough inventory space." }[outcome];
    assert(result, 'named authored outcome');
    assert.deepEqual(p.messages, outcome === 'locked' ? [result] : ['You start digging...', result]);
    if (outcome !== 'locked') {
        assert.equal(p.animId, I.dig, 'eligible Dig plays its digging animation');
        assert(World.currentTick > tick, 'eligible Dig suspends before its result');
    }
}
let p = player();
dig(p, 'locked');
dig(p, 'empty', 3542, 3486);
for (let slot = 1; slot < 28; slot++) p.getInventory(I.inv).set(slot, { id: I.spade, count: 1 });
dig(p, 'locked'); // A full bag must not disclose the head before the conversation.
for (const stage of [0, 1, 3, 8]) {
    p = player(); p.setVar(I.stage, stage);
    dig(p, 'locked'); // Quest stage alone never substitutes for the conversation.
}
for (const head of [I.head, I.full]) {
    p = player(); p.getInventory(I.inv).add(head, 1);
    dig(p, 'empty');
    assert.equal(p.getInventory(I.inv).getItemCount(head), 1);
}
p = player(); p.setVarBit(I.handed, 1);
dig(p, 'empty');
p = player(); p.setVar(I.stage, 1); p.getInventory(I.worn).add(I.amulet, 1);
const npc = new Npc(0, 3551, 3561, 1, 1, EntityLifeCycle.RESPAWN, 1, I.gardener, 0);
npc.isActive = true;
assert.equal(p.getVarBit(I.spoken), 0);
run(p, '[opnpc1,fenk_gardener]', npc, [1]);
assert.equal(p.getVarBit(I.spoken), 1, 'real completed head conversation writes the bit');
run(p, '[proc,fenk_clear_gardener_follow]');
assert.equal(p.getVar(I.follower), -1, 'positive Dig needs no active follower');
dig(p, 'found');
p.getInventory(I.inv).remove(I.head, 1);
for (let slot = 1; slot < 28; slot++) p.getInventory(I.inv).set(slot, { id: I.spade, count: 1 });
dig(p, 'full');
for (let slot = 1; slot < 28; slot++) p.getInventory(I.inv).set(slot, null);
dig(p, 'found'); // Free-space retry after the conversation succeeds.
dig(p, 'empty'); // A second head is refused.
p.getInventory(I.inv).remove(I.head, 1);
dig(p, 'found'); // A lost pre-hand-in head remains recoverable.
console.log('PASS packed head eligibility, exact reward, refusals, presentation and retry outcomes');
process.exit(0);
